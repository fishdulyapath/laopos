const express = require('express');
const QRCode = require('qrcode');
const { query } = require('../db');

const router = express.Router();

let tokenCache = {
  jwt: '',
  expiresAt: 0,
};

const providerPaths = {
  onepay: '/onepayservice/genonepayqr',
  laoqr: '/onepayservice/genlaoqr',
};

const paidStatuses = new Set(['paid', 'saved']);
const deletableFailedStatuses = ['create_failed', 'check_failed'];

function clean(value) {
  return String(value || '').trim();
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function onepayConfig() {
  const defaultTransferPassBookCode = clean(process.env.ONEPAY_QR_TRANSFER_PASS_BOOK_CODE);
  const cfg = {
    baseUrl: clean(process.env.ONEPAY_BASE_URL) || 'https://bcel.la:8093',
    username: clean(process.env.ONEPAY_USERNAME),
    password: clean(process.env.ONEPAY_PASSWORD),
    mcid: clean(process.env.ONEPAY_MCID),
    merchantName: clean(process.env.ONEPAY_MERCHANT_NAME || process.env.ONEPAY_MC_ENG),
    mcc: clean(process.env.ONEPAY_MCC),
    shopcode: clean(process.env.ONEPAY_SHOPCODE),
    accountNo: clean(process.env.ONEPAY_ACCOUNTNO),
    transferPassBookCode: defaultTransferPassBookCode,
    laoQrTransferPassBookCode: clean(process.env.ONEPAY_QR_LAOQR_TRANSFER_PASS_BOOK_CODE) || defaultTransferPassBookCode,
    onepayTransferPassBookCode: clean(process.env.ONEPAY_QR_ONEPAY_TRANSFER_PASS_BOOK_CODE) || defaultTransferPassBookCode,
  };
  const missing = [];
  if (!cfg.username) missing.push('ONEPAY_USERNAME');
  if (!cfg.password) missing.push('ONEPAY_PASSWORD');
  if (!cfg.shopcode) missing.push('ONEPAY_SHOPCODE');
  if (!cfg.transferPassBookCode && (!cfg.laoQrTransferPassBookCode || !cfg.onepayTransferPassBookCode)) {
    missing.push('ONEPAY_QR_TRANSFER_PASS_BOOK_CODE');
  }
  return { ...cfg, enabled: missing.length === 0, missing };
}

function publicConfig() {
  const cfg = onepayConfig();
  return {
    enabled: cfg.enabled,
    missing: cfg.missing,
    base_url: cfg.baseUrl,
    mcid: cfg.mcid,
    merchant_name: cfg.merchantName,
    mcc: cfg.mcc,
    shopcode: cfg.shopcode,
    transfer_pass_book_code: cfg.transferPassBookCode,
    laoqr_transfer_pass_book_code: cfg.laoQrTransferPassBookCode,
    onepay_transfer_pass_book_code: cfg.onepayTransferPassBookCode,
  };
}

function parsePayload(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function onepayUrl(cfg, path) {
  return `${cfg.baseUrl.replace(/\/$/, '')}${path}`;
}

function tokenExpiry(expire) {
  const value = num(expire);
  if (value <= 0) return Date.now() + 25 * 60 * 1000;
  if (value > 1000000000000) return value - 60 * 1000;
  if (value > 1000000000) return value * 1000 - 60 * 1000;
  return Date.now() + Math.max(1, value - 60) * 1000;
}

async function callOnepay(cfg, path, body, jwt = '') {
  const url = onepayUrl(cfg, path);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (ex) {
    const cause = ex.cause || {};
    const causeText = [cause.code, cause.hostname, cause.address, cause.port].filter(Boolean).join(' ');
    const err = new Error(`Onepay network error${causeText ? ` (${causeText})` : ''}: ${ex.message}`);
    err.status = 502;
    err.data = {
      url,
      cause: {
        code: cause.code || '',
        syscall: cause.syscall || '',
        hostname: cause.hostname || '',
        address: cause.address || '',
        port: cause.port || '',
      },
    };
    throw err;
  }
  const text = await response.text();
  const data = parsePayload(text);
  if (!response.ok) {
    const err = new Error(data?.message || data?.msg || `Onepay API ${response.status}`);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function getOnepayToken(cfg) {
  if (tokenCache.jwt && tokenCache.expiresAt > Date.now() + 30000) return tokenCache.jwt;
  const data = await callOnepay(cfg, '/onepayservice/authen', {
    username: cfg.username,
    password: cfg.password,
  });
  const jwt = clean(data?.jwt || data?.token || data?.access_token);
  if (!jwt) {
    const err = new Error('Onepay authentication did not return jwt');
    err.status = 502;
    err.data = data;
    throw err;
  }
  tokenCache = {
    jwt,
    expiresAt: tokenExpiry(data?.expire || data?.expires_in),
  };
  return jwt;
}

function normalizeResult(data = {}) {
  const payload = data?.data && typeof data.data === 'object' ? data.data : data;
  const result = num(payload?.result ?? data?.result, null);
  const message = clean(payload?.message || data?.message || data?.msg);
  return { payload, result, message };
}

function paidFields(payload = {}) {
  return {
    fccref: clean(payload.fccref || payload.fccRef || payload.FCCREF || payload.ref || payload.data?.FCCREF),
    ticket: clean(payload.ticket || payload.TICKET || payload.data?.TICKET),
    service: clean(payload.service || payload.SERVICE || payload.data?.SERVICE),
    frombank: clean(payload.frombank || payload.fromBank || payload.FROMBANK || payload.data?.FROMBANK),
    tx_datetime: clean(payload.tx_datetime || payload.txDateTime || payload.date_time || payload.TXTIME || payload.DATETIME || payload.data?.TXTIME || payload.data?.DATETIME),
    amount_lak: num(payload.amount || payload.amount_lak || payload.AMOUNT || payload.LAKAMOUNT || payload.data?.AMOUNT || payload.data?.LAKAMOUNT),
  };
}

function historyStatusFromBankResult(result, message = '') {
  if (result === 0) return 'paid';
  if (/scan/i.test(message)) return 'scanned';
  if (result === 2) return 'pending';
  return 'unknown';
}

function cleanLimit(value, fallback = 200) {
  const limit = Math.trunc(num(value, fallback));
  return Math.min(Math.max(limit, 1), 500);
}

function jsonParam(value) {
  return JSON.stringify(value ?? {});
}

function historyMetaFromRequest(req, provider, amount, body) {
  const source = req.body || {};
  return {
    uuid: clean(body.uuid),
    invoiceid: clean(body.invoiceid),
    provider,
    amount,
    currencyCode: clean(source.currency_code),
    exchangeRate: num(source.exchange_rate),
    amountBase: num(source.amount_base),
    roundingAmount: num(source.rounding_amount),
    passBookCode: clean(source.pass_book_code),
    shopcode: clean(body.shopcode),
    terminalid: clean(body.terminalid),
    posId: clean(source.pos_id),
    posCode: clean(source.pos_code || source.pos_id),
    posName: clean(source.pos_name),
    machinecode: clean(source.machinecode || body.terminalid),
    branchCode: clean(source.branch_code),
    creatorCode: clean(source.creator_code),
    creatorName: clean(source.creator_name),
  };
}

async function safeHistoryWrite(label, sql, params = []) {
  try {
    const result = await query(sql, params);
    return result.rows[0] || null;
  } catch (ex) {
    // History must not block the live POS payment flow.
    console.error(`lao qr history ${label}:`, ex.message);
    return null;
  }
}

async function insertLaoQrHistory(meta, createRequest) {
  return safeHistoryWrite('insert', `
    INSERT INTO lao_qr_payment_history (
      uuid, invoiceid, provider, status, status_message,
      amount_lak, currency_code, exchange_rate, amount_base, rounding_amount, pass_book_code,
      shopcode, terminalid, pos_id, pos_code, pos_name, machinecode, branch_code, creator_code, creator_name,
      create_request
    ) VALUES (
      $1, $2, $3, 'creating', 'Creating QR',
      $4, $5, $6, $7, $8, $9,
      $10, $11, $12, $13, $14, $15, $16, $17, $18,
      $19::jsonb
    )
    ON CONFLICT (uuid) DO UPDATE SET
      invoiceid = EXCLUDED.invoiceid,
      provider = EXCLUDED.provider,
      status = 'creating',
      status_message = 'Creating QR',
      amount_lak = EXCLUDED.amount_lak,
      currency_code = EXCLUDED.currency_code,
      exchange_rate = EXCLUDED.exchange_rate,
      amount_base = EXCLUDED.amount_base,
      rounding_amount = EXCLUDED.rounding_amount,
      pass_book_code = EXCLUDED.pass_book_code,
      shopcode = EXCLUDED.shopcode,
      terminalid = EXCLUDED.terminalid,
      pos_id = EXCLUDED.pos_id,
      pos_code = EXCLUDED.pos_code,
      pos_name = EXCLUDED.pos_name,
      machinecode = EXCLUDED.machinecode,
      branch_code = EXCLUDED.branch_code,
      creator_code = EXCLUDED.creator_code,
      creator_name = EXCLUDED.creator_name,
      create_request = EXCLUDED.create_request
    RETURNING id
  `, [
    meta.uuid,
    meta.invoiceid,
    meta.provider,
    meta.amount,
    meta.currencyCode,
    meta.exchangeRate,
    meta.amountBase,
    meta.roundingAmount,
    meta.passBookCode,
    meta.shopcode,
    meta.terminalid,
    meta.posId,
    meta.posCode,
    meta.posName,
    meta.machinecode,
    meta.branchCode,
    meta.creatorCode,
    meta.creatorName,
    jsonParam(createRequest),
  ]);
}

async function markLaoQrHistoryCreated({ uuid, result, message, qrc, response }) {
  const status = qrc ? 'pending' : 'unknown';
  return safeHistoryWrite('created', `
    UPDATE lao_qr_payment_history
    SET status = $2,
        status_message = $3,
        bank_result = $4,
        qrc = $5,
        create_response = $6::jsonb
    WHERE uuid = $1
    RETURNING id
  `, [uuid, status, message || 'Waiting for payment', result, qrc, jsonParam(response)]);
}

async function markLaoQrHistoryCreateFailed({ uuid, message, response }) {
  if (!uuid) return null;
  return safeHistoryWrite('create failed', `
    UPDATE lao_qr_payment_history
    SET status = 'create_failed',
        status_message = $2,
        create_response = $3::jsonb
    WHERE uuid = $1
    RETURNING id
  `, [uuid, message || 'Create QR failed', jsonParam(response)]);
}

async function updateLaoQrHistoryFromStatus({ uuid, checkRequest, response, payload, result, message }) {
  const fields = paidFields(payload);
  const status = historyStatusFromBankResult(result, message);
  return safeHistoryWrite('status update', `
    UPDATE lao_qr_payment_history
    SET status = CAST($2 AS varchar),
        status_message = CAST($3 AS text),
        bank_result = $4,
        fccref = COALESCE(NULLIF(CAST($5 AS varchar), ''), fccref),
        ticket = COALESCE(NULLIF(CAST($6 AS varchar), ''), ticket),
        service = COALESCE(NULLIF(CAST($7 AS varchar), ''), service),
        frombank = COALESCE(NULLIF(CAST($8 AS varchar), ''), frombank),
        bank_tx_datetime = COALESCE(NULLIF(CAST($9 AS varchar), ''), bank_tx_datetime),
        bank_amount_lak = CASE WHEN $10::numeric > 0 THEN $10::numeric ELSE bank_amount_lak END,
        last_check_request = $11::jsonb,
        last_check_response = $12::jsonb,
        last_checked_at = NOW(),
        paid_at = CASE WHEN CAST($2 AS varchar) = 'paid' THEN COALESCE(paid_at, NOW()) ELSE paid_at END
    WHERE uuid = $1
    RETURNING id
  `, [
    uuid,
    status,
    message || status,
    result,
    fields.fccref,
    fields.ticket,
    fields.service,
    fields.frombank,
    fields.tx_datetime,
    fields.amount_lak,
    jsonParam(checkRequest),
    jsonParam(response),
  ]);
}

async function updateLaoQrHistoryByIdFromStatus({ id, uuid, checkRequest, response, payload, result, message }) {
  const fields = paidFields(payload);
  const status = historyStatusFromBankResult(result, message);
  const updateResult = await query(
    `UPDATE lao_qr_payment_history
     SET status = CAST($3 AS varchar),
         status_message = CAST($4 AS text),
         bank_result = $5,
         fccref = COALESCE(NULLIF(CAST($6 AS varchar), ''), fccref),
         ticket = COALESCE(NULLIF(CAST($7 AS varchar), ''), ticket),
         service = COALESCE(NULLIF(CAST($8 AS varchar), ''), service),
         frombank = COALESCE(NULLIF(CAST($9 AS varchar), ''), frombank),
         bank_tx_datetime = COALESCE(NULLIF(CAST($10 AS varchar), ''), bank_tx_datetime),
         bank_amount_lak = CASE WHEN $11::numeric > 0 THEN $11::numeric ELSE bank_amount_lak END,
         last_check_request = $12::jsonb,
         last_check_response = $13::jsonb,
         last_checked_at = NOW(),
         paid_at = CASE WHEN CAST($3 AS varchar) = 'paid' THEN COALESCE(paid_at, NOW()) ELSE paid_at END
     WHERE id = $1
       AND uuid = $2
     RETURNING *`,
    [
      id,
      uuid,
      status,
      message || status,
      result,
      fields.fccref,
      fields.ticket,
      fields.service,
      fields.frombank,
      fields.tx_datetime,
      fields.amount_lak,
      jsonParam(checkRequest),
      jsonParam(response),
    ],
  );
  if (!updateResult.rows.length) {
    const err = new Error('QR history update did not match any row');
    err.status = 404;
    throw err;
  }
  return updateResult.rows[0];
}

async function markLaoQrHistoryCheckFailed({ uuid, checkRequest, message, response }) {
  if (!uuid) return null;
  return safeHistoryWrite('check failed', `
    UPDATE lao_qr_payment_history
    SET status = CASE WHEN status IN ('paid', 'saved') THEN status ELSE 'check_failed' END,
        status_message = $2,
        last_check_request = $3::jsonb,
        last_check_response = $4::jsonb,
        last_checked_at = NOW()
    WHERE uuid = $1
    RETURNING id
  `, [uuid, message || 'Check QR status failed', jsonParam(checkRequest), jsonParam(response)]);
}

async function fetchLaoQrHistoryRow(id) {
  const result = await query(
    `SELECT *
     FROM lao_qr_payment_history
     WHERE id = $1
     LIMIT 1`,
    [id],
  );
  return result.rows[0] || null;
}

async function checkOnepayQrStatus(cfg, { uuid, shopcode }) {
  const jwt = await getOnepayToken(cfg);
  const body = { uuid, shopcode: clean(shopcode) || cfg.shopcode };
  const data = await callOnepay(cfg, '/onepayservice/checkonepayqr', body, jwt);
  const { payload, result, message } = normalizeResult(data);
  const paid = result === 0;
  const pending = result === 2;
  await updateLaoQrHistoryFromStatus({ uuid, checkRequest: body, response: data, payload, result, message });
  return {
    body,
    data: {
      uuid,
      result,
      message,
      paid,
      pending,
      status_text: paid ? 'paid' : pending ? 'pending' : 'unknown',
      ...paidFields(payload),
      raw: data,
    },
  };
}

function handleError(res, label, ex) {
  console.error(`${label}:`, ex.message);
  return res.status(ex.status || 500).json({
    status: 'error',
    message: ex.message,
    data: ex.data,
  });
}

router.get('/lao-qr/config', async (req, res) => {
  try {
    return res.json({ status: 'success', data: publicConfig() });
  } catch (ex) {
    return handleError(res, 'lao qr config error', ex);
  }
});

router.post('/lao-qr/create', async (req, res) => {
  let createUuid = '';
  let createRequest = {};
  try {
    const cfg = onepayConfig();
    if (!cfg.enabled) {
      return res.status(503).json({ status: 'error', message: 'Onepay is not configured', missing: cfg.missing });
    }

    const provider = clean(req.body?.provider || 'laoqr').toLowerCase();
    const path = providerPaths[provider];
    if (!path) return res.status(400).json({ status: 'error', message: 'provider must be onepay or laoqr' });

    const amount = Math.round(num(req.body?.amount_lak ?? req.body?.amount));
    const uuid = clean(req.body?.uuid);
    const invoiceid = clean(req.body?.invoiceid).slice(0, 15);
    const desc = clean(req.body?.desc || 'BizSuit QR').slice(0, 25);
    if (amount <= 0) return res.status(400).json({ status: 'error', message: 'amount_lak must be greater than 0' });
    if (!uuid) return res.status(400).json({ status: 'error', message: 'uuid is required' });
    if (!invoiceid) return res.status(400).json({ status: 'error', message: 'invoiceid is required' });

    const body = {
      amount,
      uuid,
      invoiceid,
      desc,
      shopcode: clean(req.body?.shopcode) || cfg.shopcode,
    };
    createUuid = uuid;
    if (req.body?.terminalid) body.terminalid = clean(req.body.terminalid);
    if (provider === 'onepay' && req.body?.expire) {
      // Onepay ต้องการ expire เป็น String(14) format yyyymmddhh24miss
      // frontend ส่งมาเป็นจำนวนนาทีก่อน QR หมดอายุ
      const minutes = num(req.body.expire);
      if (minutes > 0) {
        const d = new Date(Date.now() + minutes * 60 * 1000);
        const pad = (n) => String(n).padStart(2, '0');
        body.expire = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
          + `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
      }
    }
    createRequest = body;
    const historyMeta = historyMetaFromRequest(req, provider, amount, body);
    const historyRow = await insertLaoQrHistory(historyMeta, body);

    const jwt = await getOnepayToken(cfg);
    const data = await callOnepay(cfg, path, body, jwt);
    const { payload, result, message } = normalizeResult(data);
    const qrc = clean(payload?.qrc || payload?.qr || payload?.qrCode);
    const qrImage = qrc ? await QRCode.toDataURL(qrc, { margin: 1, width: 240 }) : '';
    const updatedHistory = await markLaoQrHistoryCreated({ uuid, result, message, qrc, response: data });

    return res.json({
      status: 'success',
      data: {
        history_id: updatedHistory?.id || historyRow?.id || null,
        provider,
        uuid,
        invoiceid,
        amount_lak: amount,
        result,
        message,
        version: payload?.version || '',
        qrc,
        qr_image: qrImage,
        raw: data,
      },
    });
  } catch (ex) {
    await markLaoQrHistoryCreateFailed({ uuid: createUuid, message: ex.message, response: ex.data || { message: ex.message, request: createRequest } });
    return handleError(res, 'lao qr create error', ex);
  }
});

router.post('/lao-qr/status', async (req, res) => {
  let uuid = '';
  let body = {};
  try {
    const cfg = onepayConfig();
    if (!cfg.enabled) {
      return res.status(503).json({ status: 'error', message: 'Onepay is not configured', missing: cfg.missing });
    }
    uuid = clean(req.body?.uuid);
    if (!uuid) return res.status(400).json({ status: 'error', message: 'uuid is required' });

    body = { uuid, shopcode: clean(req.body?.shopcode) || cfg.shopcode };
    const result = await checkOnepayQrStatus(cfg, body);

    return res.json({
      status: 'success',
      data: result.data,
    });
  } catch (ex) {
    await markLaoQrHistoryCheckFailed({ uuid, checkRequest: body, message: ex.message, response: ex.data || { message: ex.message } });
    return handleError(res, 'lao qr status error', ex);
  }
});

router.get('/lao-qr/history', async (req, res) => {
  try {
    const {
      from_date = '',
      to_date = '',
      status = '',
      search = '',
      pos_id = '',
      branch_code = '',
      limit = 200,
    } = req.query;
    const params = [];
    const where = [];

    if (clean(from_date) && clean(to_date)) {
      params.push(clean(from_date), clean(to_date));
      where.push(`created_at::date BETWEEN $${params.length - 1}::date AND $${params.length}::date`);
    }
    if (clean(status) && clean(status) !== 'all') {
      params.push(clean(status));
      where.push(`status = $${params.length}`);
    }
    if (clean(pos_id)) {
      params.push(clean(pos_id));
      where.push(`pos_id = $${params.length}`);
    }
    if (clean(branch_code)) {
      params.push(clean(branch_code));
      where.push(`branch_code = $${params.length}`);
    }
    if (clean(search)) {
      const like = `%${clean(search)}%`;
      params.push(like, like, like, like, like, like, like, like, like, like, like, like, like);
      const n = params.length;
      where.push(`(
        uuid ILIKE $${n - 12}
        OR invoiceid ILIKE $${n - 11}
        OR fccref ILIKE $${n - 10}
        OR ticket ILIKE $${n - 9}
        OR sale_doc_no ILIKE $${n - 8}
        OR creator_code ILIKE $${n - 7}
        OR creator_name ILIKE $${n - 6}
        OR status_message ILIKE $${n - 5}
        OR pos_code ILIKE $${n - 4}
        OR pos_name ILIKE $${n - 3}
        OR machinecode ILIKE $${n - 2}
        OR amount_lak::text ILIKE $${n - 1}
        OR pos_id ILIKE $${n}
      )`);
    }
    params.push(cleanLimit(limit));

    const sql = `
      SELECT id, uuid, invoiceid, provider, status, status_message,
        amount_lak, currency_code, exchange_rate, amount_base, rounding_amount, pass_book_code,
        shopcode, terminalid, pos_id, pos_code, pos_name, machinecode, branch_code, creator_code, creator_name,
        bank_result, fccref, ticket, service, frombank, bank_tx_datetime, bank_amount_lak,
        sale_doc_no, created_at, updated_at, last_checked_at, paid_at
      FROM lao_qr_payment_history
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC
      LIMIT $${params.length}
    `;
    const result = await query(sql, params);
    return res.json({ status: 'success', data: result.rows });
  } catch (ex) {
    return handleError(res, 'lao qr history error', ex);
  }
});

router.post('/lao-qr/history/:id/check', async (req, res) => {
  let uuid = '';
  let body = {};
  try {
    const cfg = onepayConfig();
    if (!cfg.enabled) {
      return res.status(503).json({ status: 'error', message: 'Onepay is not configured', missing: cfg.missing });
    }
    const id = Math.trunc(num(req.params.id));
    if (id <= 0) return res.status(400).json({ status: 'error', message: 'id is required' });
    const row = await fetchLaoQrHistoryRow(id);
    if (!row) return res.status(404).json({ status: 'error', message: 'QR history not found' });
    uuid = clean(row.uuid);
    if (!uuid) return res.status(400).json({ status: 'error', message: 'uuid is missing' });
    if (paidStatuses.has(clean(row.status))) {
      return res.json({ status: 'success', data: { skipped: true, status_result: null, row } });
    }

    body = { uuid, shopcode: clean(row.shopcode || req.body?.shopcode) || cfg.shopcode };
    const checked = await checkOnepayQrStatus(cfg, body);
    const raw = checked.data?.raw || {};
    const payload = raw?.data && typeof raw.data === 'object' ? raw.data : raw;
    const updatedRow = await updateLaoQrHistoryByIdFromStatus({
      id,
      uuid,
      checkRequest: checked.body || body,
      response: raw,
      payload,
      result: checked.data?.result,
      message: checked.data?.message,
    });
    return res.json({ status: 'success', data: { skipped: false, status_result: checked.data, row: updatedRow } });
  } catch (ex) {
    await markLaoQrHistoryCheckFailed({ uuid, checkRequest: body, message: ex.message, response: ex.data || { message: ex.message } });
    return handleError(res, 'lao qr history check error', ex);
  }
});

router.delete('/lao-qr/history/:id', async (req, res) => {
  try {
    const id = Math.trunc(num(req.params.id));
    if (id <= 0) return res.status(400).json({ status: 'error', message: 'id is required' });
    const result = await query(
      `DELETE FROM lao_qr_payment_history
       WHERE id = $1
         AND status = ANY($2::text[])
       RETURNING id, uuid, invoiceid, status`,
      [id, deletableFailedStatuses],
    );
    if (!result.rows.length) {
      return res.status(409).json({ status: 'error', message: 'Only failed QR history rows can be deleted' });
    }
    return res.json({ status: 'success', data: result.rows[0] });
  } catch (ex) {
    return handleError(res, 'lao qr history delete error', ex);
  }
});

module.exports = router;
