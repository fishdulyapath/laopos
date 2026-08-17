const express = require('express');
const router = express.Router();
const { query, withTransaction } = require('../db');
const { decodeZipEntry, renderSalePrintHtml } = require('../utils/salePrintRenderer');
const { buildThermalReceiptHex } = require('../utils/thermalReceiptBuilder');
const { safeLayout } = require('./posSlipTemplate');

function splitFormCodes(value) {
  return String(value || '')
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean);
}

function uniqueCodes(codes) {
  const seen = new Set();
  return codes.filter((code) => {
    const key = code.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function lowerCodes(codes) {
  return codes.map((code) => code.toLowerCase());
}

function asAmountText(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || Math.abs(num) < 0.005) return '';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const num = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(num) ? num : fallback;
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function roundAmount(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

const PAYABLE_DERIVED_FIELDS = new Set([
  'total_amount',
  'bth_amount',
  'kip_amount',
  'usd_amount',
  'bth_amount_1',
  'kip_amount_1',
  'usd_amount_1',
  'amount_usd',
  'amount_usd_1',
  'amount_ktp',
  'amount_ktp_1',
  'r_amount_ktp',
  'r_amount_ktp_1',
  'tenper',
  'sum_total_amount',
]);

function applyPayableTotalToRow(row, originalAmount, payableAmount) {
  if (!row || typeof row !== 'object') return;
  const rowTotal = toNumber(row.total_amount, originalAmount);
  if (rowTotal <= 0) return;
  const ratio = payableAmount / rowTotal;

  for (const key of Object.keys(row)) {
    const normalizedKey = key.toLowerCase();
    if (!PAYABLE_DERIVED_FIELDS.has(normalizedKey)) continue;
    const current = toNumber(row[key], NaN);
    if (!Number.isFinite(current)) continue;
    row[key] = normalizedKey === 'total_amount' ? payableAmount : roundAmount(current * ratio);
  }
}

function normalizeSalePrintPayableTotals(data) {
  if (!data?.header) return data;
  const header = data.header;
  const depositAmount = toNumber(header.print_deposit_amount ?? header.deposit_amount);
  const originalAmount = toNumber(header.print_original_total_amount ?? header.total_amount);
  const grossAmount = toNumber(header.total_value);
  if (depositAmount <= 0 || originalAmount <= 0) return data;
  if (grossAmount > 0 && Math.abs(originalAmount - grossAmount) > 0.01) return data;

  const payableAmount = roundAmount(Math.max(0, originalAmount - depositAmount));
  header.print_original_total_amount = originalAmount;
  header.print_deposit_amount = depositAmount;
  header.print_payable_amount = payableAmount;
  header.amount_after_deposit = payableAmount;
  applyPayableTotalToRow(header, originalAmount, payableAmount);

  if (data.queryTables) {
    for (const rule of ['A', 'F', 'G', 'H']) {
      const rows = data.queryTables[rule];
      if (!Array.isArray(rows)) continue;
      rows.forEach((row) => applyPayableTotalToRow(row, originalAmount, payableAmount));
    }
  }

  return data;
}

const FORM_QUERY_RULES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
const READ_ONLY_SQL_START = /^(select|with)\b/i;
const BLOCKED_SQL_WORDS = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do|execute|vacuum|refresh|reindex|listen|notify|into|merge|lock)\b/i;

function decodeXmlEntities(value) {
  return String(value ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractFormDesignQueries(formRows) {
  const queries = {};

  for (const form of formRows || []) {
    const xml = decodeZipEntry(form.formdesigntext);
    const queryBlocks = Array.from(xml.matchAll(/<Query>([\s\S]*?)<\/Query>/g), (match) => match[1] || '');

    queryBlocks.forEach((block, index) => {
      const rule = FORM_QUERY_RULES[index];
      if (!rule || queries[rule]) return;

      const queryMatch = block.match(/<_queryString>([\s\S]*?)<\/_queryString>/i);
      const sql = decodeXmlEntities(queryMatch?.[1] || '').trim();
      if (sql) queries[rule] = sql;
    });
  }

  return queries;
}

function sqlLiteral(value) {
  return String(value ?? '').replace(/'/g, "''");
}

function replaceFormConditions(sql, { docNo, transFlag }) {
  return String(sql || '')
    .replace(/#doc_no#/gi, sqlLiteral(docNo))
    .replace(/#trans_flag#/gi, String(Number(transFlag || 44)));
}

function assertReadOnlyFormQuery(sql, rule) {
  const text = String(sql || '').trim();
  if (!text) return false;
  if (text.includes(';')) throw new Error(`form query ${rule} contains multiple statements`);
  if (!READ_ONLY_SQL_START.test(text)) throw new Error(`form query ${rule} must start with SELECT or WITH`);
  if (BLOCKED_SQL_WORDS.test(text)) throw new Error(`form query ${rule} contains a blocked SQL keyword`);
  return true;
}

async function executeFormDesignQueries(formRows, { docNo, transFlag = 44 }) {
  const formQueries = extractFormDesignQueries(formRows);
  const queryTables = {};

  for (const rule of FORM_QUERY_RULES) {
    const sourceSql = formQueries[rule];
    if (!sourceSql) continue;

    const sql = replaceFormConditions(sourceSql, { docNo, transFlag });
    if (/#.+?#/.test(sql)) continue;
    assertReadOnlyFormQuery(sql, rule);

    try {
      const result = await query(sql);
      queryTables[rule] = result.rows || [];
    } catch (ex) {
      throw new Error(`form query ${rule} failed: ${ex.message}`);
    }
  }

  return queryTables;
}

function applyFormQueryTables(data, queryTables) {
  if (!queryTables || !Object.keys(queryTables).length) return data;

  const fallbackDetails = Array.isArray(data.details) ? data.details : [];
  const formDetails = Array.isArray(queryTables.B) ? queryTables.B : null;
  const details = formDetails
    ? formDetails.map((row, index) => ({
        ...(fallbackDetails[index] || {}),
        ...row,
      }))
    : fallbackDetails;

  return {
    ...data,
    header: {
      ...(data.header || {}),
      ...(queryTables.A?.[0] || {}),
    },
    company: {
      ...(data.company || {}),
      ...(queryTables.C?.[0] || {}),
    },
    details,
    promotions: queryTables.G || data.promotions || [],
    campaigns: queryTables.F || data.campaigns || [],
    payments: queryTables.I || data.payments || [],
    queryTables,
  };
}

async function buildPrintDataForForms(formRows, saleData, { docNo, transFlag = 44, printCount = 0 }) {
  const dataByFormCode = {};
  let firstPrintData = null;

  for (const formRow of formRows || []) {
    const queryTables = await executeFormDesignQueries([formRow], { docNo, transFlag });
    const printData = normalizeSalePrintPayableTotals(applyFormQueryTables(saleData, queryTables));
    printData.header = {
      ...(printData.header || {}),
      print_count: printCount,
    };

    const key = String(formRow.formcode || '').toLowerCase();
    if (key) dataByFormCode[key] = printData;
    if (!firstPrintData) firstPrintData = printData;
  }

  return {
    printData: firstPrintData || saleData,
    dataByFormCode,
  };
}

async function loadSalePromotionRows(docNo) {
  const tableRes = await query(`SELECT to_regclass('public.ic_trans_detail_promotion') AS table_name`);
  if (!tableRes.rows[0]?.table_name) return [];

  const result = await query(
    `SELECT
        COALESCE(promotion_code,'') AS promotion_code,
        COALESCE(promotion_name,'') AS promotion_name,
        COALESCE(qty,0) AS qty,
        COALESCE(price,0) AS price,
        COALESCE(sum_amount,0) AS sum_amount,
        COALESCE(line_number,0) AS line_number,
        c.bth,
        c.kip,
        c.usd,
        COALESCE(price,0) * c.kip_rate AS kip_price,
        ABS(COALESCE(sum_amount,0)) * c.kip_rate AS kip_discount,
        COALESCE(sum_amount,0) * c.kip_rate AS kip_amount
     FROM ic_trans_detail_promotion
     CROSS JOIN (
        SELECT
          (SELECT name_2 FROM erp_currency WHERE code IN ('THB','BTH') ORDER BY CASE WHEN code='THB' THEN 0 ELSE 1 END LIMIT 1) AS bth,
          (SELECT name_2 FROM erp_currency WHERE code = 'KIP' LIMIT 1) AS kip,
          (SELECT name_2 FROM erp_currency WHERE code = 'USD' LIMIT 1) AS usd,
          (SELECT CASE
             WHEN COALESCE(NULLIF(UPPER(TRIM(home_currency)), ''), 'LAK') IN ('LAK','KIP','KIPP','KIP2','LAO') THEN 1
             ELSE COALESCE((SELECT exchange_rate_present FROM erp_currency WHERE code IN ('LAK','KIP') ORDER BY CASE WHEN code='LAK' THEN 0 ELSE 1 END LIMIT 1), 1)
           END FROM erp_option LIMIT 1) AS kip_rate
     ) c
     WHERE trans_flag = 44 AND doc_no = $1
     ORDER BY line_number, promotion_code`,
    [docNo]
  );
  return result.rows || [];
}

async function loadSaleCampaignRows(docNo) {
  const tableRes = await query(
    `SELECT
        to_regclass('public.ic_trans_pos_campaign') AS trans_table,
        to_regclass('public.pos_slip_campaign') AS campaign_table`
  );
  if (!tableRes.rows[0]?.trans_table || !tableRes.rows[0]?.campaign_table) return [];

  const result = await query(
    `SELECT
        tc.doc_no,
        COALESCE(tc.campaign_code,'') AS campaign_code,
        COALESCE(tc.qty,0) AS qty,
        COALESCE(tc.line_number,0) AS line_number,
        COALESCE(pc.display_wording,'') AS display_wording,
        COALESCE(pc.name_1,'') AS name_1,
        c.bth,
        c.kip,
        c.usd
     FROM ic_trans_pos_campaign tc
     JOIN pos_slip_campaign pc ON pc.code = tc.campaign_code
     CROSS JOIN (
        SELECT
          (SELECT name_2 FROM erp_currency WHERE code IN ('THB','BTH') ORDER BY CASE WHEN code='THB' THEN 0 ELSE 1 END LIMIT 1) AS bth,
          (SELECT name_2 FROM erp_currency WHERE code = 'KIP' LIMIT 1) AS kip,
          (SELECT name_2 FROM erp_currency WHERE code = 'USD' LIMIT 1) AS usd
     ) c
     WHERE tc.doc_no = $1 AND tc.trans_flag = 44
     ORDER BY tc.line_number, tc.campaign_code`,
    [docNo]
  );
  const rows = result.rows || [];
  const allDisplay = rows
    .map((row) => `${row.display_wording || row.name_1 || row.campaign_code} x ${row.qty}`)
    .filter(Boolean)
    .join('\n');
  return rows.map((row) => ({ ...row, all_display: allDisplay }));
}

async function loadSalePaymentRows(docNo) {
  const tableRes = await query(
    `SELECT
        to_regclass('public.cb_trans') AS cb_table,
        to_regclass('public.cb_trans_detail') AS cb_detail_table`
  );
  if (!tableRes.rows[0]?.cb_table) return [];

  const cbRes = await query(
    `SELECT
        COALESCE(cash_amount,0) AS cash_amount,
        COALESCE(tranfer_amount,0) AS tranfer_amount,
        COALESCE(card_amount,0) AS card_amount
     FROM cb_trans
     WHERE doc_no = $1 AND trans_flag = 44
     LIMIT 1`,
    [docNo]
  );

  const labels = [];
  const amounts = [];
  const cashAmount = asAmountText(cbRes.rows[0]?.cash_amount);
  if (cashAmount) {
    labels.push('เงินสด');
    amounts.push(cashAmount);
  }

  if (tableRes.rows[0]?.cb_detail_table) {
    const detailRes = await query(
      `SELECT doc_type, COALESCE(trans_number,'') AS trans_number, COALESCE(amount,0) AS amount
       FROM cb_trans_detail
       WHERE doc_no = $1 AND trans_flag = 44
       ORDER BY roworder`,
      [docNo]
    );

    for (const row of detailRes.rows) {
      const amount = asAmountText(row.amount);
      if (!amount) continue;
      const docType = Number(row.doc_type || 0);
      let label = String(row.trans_number || '').trim();
      if (docType === 1) label = label ? `เงินโอน ~ ${label}` : 'เงินโอน';
      else if (docType === 3) label = label ? `เลขที่บัตรเครดิต ~ ${label}` : 'บัตรเครดิต';
      else if (docType === 2) label = label ? `เลขที่เช็ค ~ ${label}` : 'เช็ค';
      else if (docType === 4) label = label ? `เงินสดย่อย ~ ${label}` : 'เงินสดย่อย';
      labels.push(label || 'ชำระเงิน');
      amounts.push(amount);
    }
  }

  return labels.length
    ? [{ trans_number: labels.join('\n'), amount: amounts.join('\n') }]
    : [];
}

async function loadSaleDocument(docNo) {
  const [headerRes, companyRes, detailsRes, promotions, campaigns, payments, shipmentRes] = await Promise.all([
    query(
      `SELECT t.*,
          COALESCE(df.name_1,'') AS doc_format_name,
          COALESCE(df.form_code,'') AS form_code,
          COALESCE(ar.name_1,'') AS name_1,
          COALESCE(ar.address,'') AS address,
          COALESCE(ar.telephone,'') AS telephone,
          COALESCE(ar.fax,'') AS fax,
          COALESCE(cd.tax_id,'') AS tax_id,
          COALESCE(t.contactor,'') AS contactor,
          COALESCE(u.name_1, t.sale_code, '') AS sale_name,
          COALESCE(cb.deposit_amount, 0) AS print_deposit_amount,
          c.kip_rate,
          (COALESCE(NULLIF(t.total_value, 0), t.total_amount, 0) * c.kip_rate) AS document_total_kip,
          (COALESCE(t.total_discount, 0) * c.kip_rate) AS document_discount_kip,
          (COALESCE(t.total_amount, 0) * c.kip_rate) AS document_payable_kip
       FROM ic_trans t
       LEFT JOIN cb_trans cb ON cb.doc_no = t.doc_no AND cb.trans_flag = t.trans_flag
       LEFT JOIN erp_doc_format df ON df.screen_code in ('SI','SIP') AND df.code = t.doc_format_code
       LEFT JOIN ar_customer ar ON ar.code = t.cust_code
       LEFT JOIN ar_customer_detail cd ON cd.ar_code = t.cust_code
       LEFT JOIN erp_user u ON UPPER(u.code) = UPPER(t.sale_code)
       CROSS JOIN (
          SELECT (SELECT CASE
             WHEN COALESCE(NULLIF(UPPER(TRIM(home_currency)), ''), 'LAK') IN ('LAK','KIP','KIPP','KIP2','LAO') THEN 1
             ELSE COALESCE((SELECT exchange_rate_present FROM erp_currency WHERE code IN ('LAK','KIP') ORDER BY CASE WHEN code='LAK' THEN 0 ELSE 1 END LIMIT 1), 1)
           END FROM erp_option LIMIT 1) AS kip_rate
       ) c
       WHERE t.trans_flag = 44 AND t.doc_no = $1
       LIMIT 1`,
      [docNo]
    ),
    query('SELECT * FROM erp_company_profile ORDER BY roworder LIMIT 1'),
    query(
      `SELECT d.*,
          COALESCE(u.name_1, d.unit_code, '') AS unit_name,
          c.bth,
          c.kip,
          c.usd,
          COALESCE(d.price,0) * c.kip_rate AS kip_price,
          ((COALESCE(d.qty,0) * COALESCE(d.price,0)) - COALESCE(d.sum_amount,0)) * c.kip_rate AS kip_discount,
          COALESCE(d.sum_amount,0) * c.kip_rate AS kip_amount
       FROM ic_trans_detail d
       LEFT JOIN ic_unit u ON u.code = d.unit_code
       CROSS JOIN (
          SELECT
            (SELECT name_2 FROM erp_currency WHERE code IN ('THB','BTH') ORDER BY CASE WHEN code='THB' THEN 0 ELSE 1 END LIMIT 1) AS bth,
            (SELECT name_2 FROM erp_currency WHERE code = 'KIP' LIMIT 1) AS kip,
            (SELECT name_2 FROM erp_currency WHERE code = 'USD' LIMIT 1) AS usd,
            (SELECT CASE
               WHEN COALESCE(NULLIF(UPPER(TRIM(home_currency)), ''), 'LAK') IN ('LAK','KIP','KIPP','KIP2','LAO') THEN 1
               ELSE COALESCE((SELECT exchange_rate_present FROM erp_currency WHERE code IN ('LAK','KIP') ORDER BY CASE WHEN code='LAK' THEN 0 ELSE 1 END LIMIT 1), 1)
             END FROM erp_option LIMIT 1) AS kip_rate
       ) c
       WHERE d.trans_flag = 44 AND d.doc_no = $1
       ORDER BY d.line_number`,
      [docNo]
    ),
    loadSalePromotionRows(docNo),
    loadSaleCampaignRows(docNo),
    loadSalePaymentRows(docNo),
    query(
      `SELECT *
       FROM ic_trans_shipment
       WHERE trans_flag = 44 AND doc_no = $1
       LIMIT 1`,
      [docNo]
    ),
  ]);

  const header = headerRes.rows[0];
  if (!header) return null;
  const company = companyRes.rows[0] || {};
  company.tax_text = company.tax_number ? `หมายเลขประจำตัวผู้เสียภาษี ${company.tax_number}` : '';
  company.telephone_text = company.telephone_number ? `โทร. ${company.telephone_number}` : '';

  header.promotion_count = promotions.length;
  header.promotion_code = promotions.map((row) => row.promotion_code).filter(Boolean).join('\n');
  header.promotion_name = promotions.map((row) => row.promotion_name).filter(Boolean).join('\n');
  header.promotion_discount_amount = promotions.reduce((sum, row) => sum + Math.abs(Number(row.sum_amount || 0)), 0);
  header.promotion_amount = promotions.reduce((sum, row) => sum + Number(row.sum_amount || 0), 0);

  return {
    header,
    company,
    details: detailsRes.rows || [],
    promotions,
    campaigns,
    payments,
    shipment: shipmentRes.rows[0] || {},
  };
}

function shouldLogPrint(logPrint, autoPrint) {
  if (logPrint !== undefined) {
    const value = String(logPrint).trim().toLowerCase();
    return value !== '0' && value !== 'false' && value !== 'no';
  }
  return String(autoPrint) !== '0';
}

async function getPrintCount(docNo) {
  const result = await query(
    `SELECT COUNT(*)::int AS print_count
     FROM erp_print_logs
     WHERE trans_flag = 44 AND doc_no = $1`,
    [docNo]
  );
  return Number(result.rows[0]?.print_count || 0);
}

async function loadPrintUser(userCode) {
  const code = String(userCode || '').trim();
  if (!code) return { code: '', name: '' };

  const result = await query(
    `SELECT code, COALESCE(name_1, code) AS name_1
     FROM erp_user
     WHERE UPPER(code) = UPPER($1)
     LIMIT 1`,
    [code]
  );
  const row = result.rows[0] || {};
  return {
    code: row.code || code,
    name: row.name_1 || code,
  };
}

function applyPrintUser(data, printUser) {
  if (!data) return;
  data.header = {
    ...(data.header || {}),
    printby: printUser.code || '',
    print_by: printUser.code || '',
    print_user_code: printUser.code || '',
    printbyname: printUser.name || printUser.code || '',
    print_by_name: printUser.name || printUser.code || '',
    print_user_name: printUser.name || printUser.code || '',
  };
}

async function createPrintLog(docNo, userCode) {
  return withTransaction(async (client) => {
    await client.query(
      `INSERT INTO erp_print_logs (doc_no, trans_flag, user_code, print_datetime)
       VALUES ($1, 44, $2, NOW())`,
      [docNo, String(userCode || 'WEB').trim() || 'WEB']
    );
    const result = await client.query(
      `SELECT COUNT(*)::int AS print_count
       FROM erp_print_logs
       WHERE trans_flag = 44 AND doc_no = $1`,
      [docNo]
    );
    return Number(result.rows[0]?.print_count || 0);
  });
}

async function loadPrintFormOptions(docNo) {
  const docRes = await query(
    `SELECT t.doc_no, COALESCE(t.doc_format_code,'') AS doc_format_code,
        COALESCE(df.name_1,'') AS doc_format_name,
        COALESCE(df.form_code,'') AS form_code
     FROM ic_trans t
     LEFT JOIN erp_doc_format df ON df.screen_code in ('SI','SIP') AND df.code = t.doc_format_code
     WHERE t.trans_flag = 44 AND t.doc_no = $1
     LIMIT 1`,
    [docNo]
  );

  const doc = docRes.rows[0];
  if (!doc) return null;

  const codes = uniqueCodes(splitFormCodes(doc.form_code));
  let formRows = [];
  if (codes.length) {
    const result = await query(
      `SELECT formcode, formname
       FROM formdesign
       WHERE lower(formcode) = ANY($1::text[])`,
      [lowerCodes(codes)]
    );
    formRows = result.rows;
  }

  const byCode = new Map(formRows.map((row) => [String(row.formcode || '').toLowerCase(), row]));
  const forms = codes.map((code, index) => {
    const row = byCode.get(code.toLowerCase());
    return {
      formcode: row?.formcode || code,
      formname: row?.formname || code,
      available: !!row,
      is_default: index === 0,
    };
  });

  return {
    doc_no: doc.doc_no,
    doc_format_code: doc.doc_format_code,
    doc_format_name: doc.doc_format_name,
    form_code: doc.form_code,
    forms,
  };
}

async function loadFormDesignRows(formCodes) {
  if (!formCodes.length) return [];
  const result = await query(
    `SELECT formcode, formname, formdesigntext, formbackground
     FROM formdesign
     WHERE lower(formcode) = ANY($1::text[])`,
    [lowerCodes(formCodes)]
  );
  const byCode = new Map(result.rows.map((row) => [String(row.formcode || '').toLowerCase(), row]));
  return formCodes.map((code) => byCode.get(code.toLowerCase())).filter(Boolean);
}

async function findSlipTemplatePreviewDocNo(formCode = 'CR-0088') {
  const preferred = await query(
    `SELECT t.doc_no
     FROM ic_trans t
     LEFT JOIN erp_doc_format df ON df.screen_code in ('SI','SIP') AND df.code = t.doc_format_code
     WHERE t.trans_flag = 44
       AND COALESCE(df.form_code,'') <> ''
       AND lower(COALESCE(df.form_code,'')) LIKE $1
     ORDER BY t.doc_date DESC NULLS LAST, t.doc_time DESC NULLS LAST, t.doc_no DESC
     LIMIT 1`,
    [`%${String(formCode || 'CR-0088').toLowerCase()}%`],
  );
  if (preferred.rows[0]?.doc_no) return preferred.rows[0].doc_no;

  const fallback = await query(
    `SELECT doc_no
     FROM ic_trans
     WHERE trans_flag = 44
     ORDER BY doc_date DESC NULLS LAST, doc_time DESC NULLS LAST, doc_no DESC
     LIMIT 1`,
  );
  return fallback.rows[0]?.doc_no || '';
}

function pickPreviewRows(rows, limit = 5) {
  return Array.isArray(rows) ? rows.slice(0, limit) : [];
}

function slipTemplateUnionRowType(row = {}) {
  const name = String(row.item_name || row.name_1 || row.item_name_1 || row.name || '').trim();
  if (/^\*{0,8}\s*promotion\s*:/i.test(name)) return 'promotion';
  if (/^\*{0,8}\s*campaign\s*:/i.test(name)) return 'campaign';
  if (/^(โปรโมชั่น|promotion)\s*:/i.test(name)) return 'promotion';
  if (/^(แคมเปญ|เคมเปญ|campaign)\s*:/i.test(name)) return 'campaign';
  return 'item';
}

function slipTemplateUnionText(row = {}) {
  return String(row.item_name || row.name_1 || row.item_name_1 || row.name || '')
    .replace(/^\*{0,8}\s*(promotion|campaign)\s*:\s*/i, '')
    .replace(/^(โปรโมชั่น|promotion|แคมเปญ|เคมเปญ|campaign)\s*:\s*/i, '')
    .trim();
}

function buildSlipTemplatePreviewData(data = {}) {
  const header = data.header || {};
  const company = data.company || {};
  const shipment = data.shipment || {};
  const detailRows = Array.isArray(data.details) ? data.details : [];
  const itemRows = detailRows.filter((row) => slipTemplateUnionRowType(row) === 'item');
  const promotionRows = detailRows.filter((row) => slipTemplateUnionRowType(row) === 'promotion');
  const campaignRows = detailRows.filter((row) => slipTemplateUnionRowType(row) === 'campaign');
  return {
    header: {
      doc_no: header.doc_no || '',
      doc_date: header.doc_date || '',
      doc_time: header.doc_time || header.doc_time_calc || '',
      cust_code: header.cust_code || header.ar_code || '',
      cust_name: header.cust_name || header.name_1 || header.ar_name || '',
      cust_address: header.cust_address || header.address || '',
      cust_telephone: header.cust_telephone || header.telephone || '',
      manage_type: header.manage_type || '',
      management_type: header.management_type || '',
      manage_code: header.manage_code || '',
      transport_code: header.transport_code || '',
      delivery_type: header.delivery_type || '',
      shipping_type: header.shipping_type || '',
      total_value: header.total_value || 0,
      total_discount: header.total_discount || header.discount_amount || 0,
      total_vat_value: header.total_vat_value || header.vat_value || 0,
      total_amount: header.total_amount || 0,
      kip_amount: header.kip_amount || 0,
      remark: header.remark || header.remark_1 || '',
      print_count: header.print_count || 0,
      printbyname: header.printbyname || header.print_by_name || header.creator_code || header.sale_name || '',
      sale_name: header.sale_name || header.sale_code || '',
    },
    shipment,
    company: {
      name_1: company.name_1 || company.name || company.company_name || '',
      address: company.address || company.address_1 || '',
      telephone_text: company.telephone_text || company.telephone || '',
      tax_text: company.tax_text || company.tax_id || '',
    },
    details: pickPreviewRows(itemRows).map((row, index) => ({
      __rowNumber: row.__rowNumber || index + 1,
      item_code: row.item_code || row.code || row.ic_code || '',
      item_name: row.item_name || row.name_1 || row.item_name_1 || '',
      shelf_code: row.shelf_code || '',
      qty: row.qty || row.quantity || 0,
      unit_code: row.unit_code || row.unit_name || '',
      price: row.price || row.price_2 || 0,
      kip_price: row.kip_price || 0,
      sum_amount: row.sum_amount || row.amount || row.total_amount || 0,
      kip_amount: row.kip_amount || 0,
      kip_discount: row.kip_discount || 0,
      remark: row.remark || row.line_remark || row.description || '',
    })),
    payments: pickPreviewRows(data.payments || [], 8),
    promotions: pickPreviewRows(promotionRows.length ? promotionRows : (data.promotions || []), 8)
      .map((row) => ({ ...row, display_text: slipTemplateUnionText(row) || row.promotion_name || row.display_wording || row.name_1 || row.promotion_code || '' })),
    campaigns: pickPreviewRows(campaignRows.length ? campaignRows : (data.campaigns || []), 8)
      .map((row) => ({ ...row, display_text: slipTemplateUnionText(row) || row.all_display || row.display_wording || row.name_1 || row.campaign_code || '' })),
  };
}

function escapeSlipHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatSlipAmount(value, decimals = 2) {
  const num = toNumber(value);
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatSlipQty(value) {
  const num = toNumber(value);
  const decimals = Math.abs(num - Math.trunc(num)) > 0.000001 ? 2 : 0;
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatSlipDate(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const day = String(value.getDate()).padStart(2, '0');
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const year = value.getFullYear();
    return `${day}/${month}/${year}`;
  }
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  return text;
}

function isPosSlipDeliver(header = {}, shipment = {}) {
  const manageType = firstText(
    header.manage_type,
    header.management_type,
    header.manage_code,
    header.transport_code,
    header.delivery_type,
    header.shipping_type,
    shipment.manage_type,
    shipment.management_type,
    shipment.transport_code,
    shipment.delivery_type,
    shipment.shipping_type,
  ).toUpperCase();
  return manageType === 'DELIVER' || manageType === 'DELIVERY';
}

function posSlipDeliveryInfo(header = {}, shipment = {}) {
  return {
    phone: firstText(
      shipment.transport_telephone,
      shipment.telephone,
      header.transport_telephone,
      header.cust_telephone,
      header.customer_telephone,
      header.telephone,
    ),
    address: firstText(
      shipment.transport_address,
      shipment.address,
      header.transport_address,
      header.cust_address,
      header.customer_address,
      header.address,
    ),
  };
}

function posSlipRowText(row = {}, type = '') {
  if (type === 'campaign') {
    const text = cleanPosSlipSectionText(row);
    const qty = toNumber(row.qty);
    return text && qty ? `${text} จำนวนสิทธิ์ที่ได้รับ ${formatSlipQty(qty)}` : text;
  }
  if (type === 'promotion') {
    return cleanPosSlipSectionText(row);
  }
  return cleanPosSlipSectionText(row);
}

function posSlipItemName(row = {}) {
  return String(row.item_name || row.name_1 || row.item_name_1 || row.name || row.display_text || '').trim();
}

function cleanPosSlipSectionText(row = {}) {
  return String(
    row.display_text
    || row.promotion_name
    || row.display_wording
    || row.item_name
    || row.name_1
    || row.item_name_1
    || row.campaign_name
    || row.name
    || ''
  )
    .replace(/^\*{0,8}\s*(promotion|campaign)\s*:\s*/i, '')
    .replace(/^(โปรโมชั่น|promotion|แคมเปญ|เคมเปญ|campaign)\s*:\s*/i, '')
    .trim();
}

function hasPosSlipItemPrefix(row = {}, pattern) {
  return pattern.test(posSlipItemName(row));
}

function isPosSlipCampaignItem(row = {}) {
  if (hasPosSlipItemPrefix(row, /^\*{0,8}\s*campaign\s*:/i)) return true;
  return hasPosSlipItemPrefix(row, /(แคมเปญ|เคมเปญ|campaign)\s*:/i) || Boolean(row.campaign_code);
}

function isPosSlipPromotionItem(row = {}) {
  if (hasPosSlipItemPrefix(row, /^\*{0,8}\s*promotion\s*:/i)) return true;
  return hasPosSlipItemPrefix(row, /(โปรโมชั่น|promotion)\s*:/i) || Boolean(row.promotion_code || row.promotion_name);
}

function shouldShowPosSlipItemCode(row = {}) {
  const code = String(row.item_code || row.code || row.ic_code || '').trim();
  return Boolean(code) && !isPosSlipCampaignItem(row) && !isPosSlipPromotionItem(row);
}

function posSlipRowUnitName(row = {}) {
  return String(row.unit_name || row.unit_code || '').trim();
}

function posSlipRowQty(row = {}) {
  return row.qty ?? row.quantity ?? 0;
}

function posSlipRowPrice(row = {}) {
  return row.kip_price ?? row.price ?? row.price_2 ?? 0;
}

function posSlipRowAmount(row = {}) {
  return row.kip_amount ?? row.sum_amount ?? row.amount ?? row.total_amount ?? 0;
}

function isRenderablePosSlipDetail(row = {}) {
  const text = String(
    row.item_code
    || row.code
    || row.ic_code
    || row.item_name
    || row.name_1
    || row.item_name_1
    || row.name
    || row.remark
    || row.line_remark
    || row.description
    || ''
  ).trim();
  if (text) return true;

  return [
    posSlipRowQty(row),
    posSlipRowPrice(row),
    posSlipRowAmount(row),
  ].some((value) => Math.abs(toNumber(value)) > 0.005);
}

function parseDisplayAmount(value) {
  const text = String(value || '').replace(/,/g, '');
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const amount = Number(match[0]);
  return Number.isFinite(amount) ? amount : null;
}

function finiteAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(num) ? num : null;
}

function firstFiniteAmount(...values) {
  for (const value of values) {
    const amount = finiteAmount(value);
    if (amount !== null) return amount;
  }
  return null;
}

function isMeaningfulAmount(value) {
  const amount = finiteAmount(value);
  return amount !== null && Math.abs(amount) > 0.005;
}

function firstMeaningfulAmount(...values) {
  for (const value of values) {
    const amount = finiteAmount(value);
    if (amount !== null && Math.abs(amount) > 0.005) return amount;
  }
  return null;
}

function convertDocumentHomeToKip(header, value) {
  const amount = finiteAmount(value);
  if (amount === null || Math.abs(amount) <= 0.005) return 0;
  const kipRate = firstFiniteAmount(header.kip_rate);
  if (kipRate === null || Math.abs(kipRate) <= 0.005) return 0;
  return amount * kipRate;
}

function calculateDetailKipTotal(details) {
  return details.reduce((sum, row) => {
    const kipAmount = firstFiniteAmount(row.kip_amount);
    if (kipAmount !== null && Math.abs(kipAmount) > 0.005) return sum + kipAmount;
    return sum + toNumber(row.sum_amount ?? row.amount ?? row.total_amount);
  }, 0);
}

function calculateDocumentDiscountKip(header) {
  const directKip = firstMeaningfulAmount(
    header.discount_kip,
    header.total_discount_kip,
    header.discount_amount_kip,
    header.document_discount_kip
  );
  if (directKip !== null) return Math.abs(directKip);
  const discountHome = firstFiniteAmount(header.total_discount, header.discount_amount);
  if (discountHome === null || Math.abs(discountHome) <= 0.005) return 0;
  return Math.abs(convertDocumentHomeToKip(header, discountHome));
}

function calculateDocumentTotalKip(header) {
  const directKip = firstMeaningfulAmount(
    header.kip_amount_total,
    header.total_kip,
    header.total_amount_kip,
    header.sum_amount_kip,
    header.gross_kip,
    header.document_total_kip
  );
  if (directKip !== null) return directKip;
  const totalHome = firstMeaningfulAmount(header.total_value, header.total_amount);
  return convertDocumentHomeToKip(header, totalHome);
}

function calculateDocumentPayableKip(header) {
  const directKip = firstMeaningfulAmount(
    header.kip_amount,
    header.payable_kip,
    header.net_kip,
    header.total_net_kip,
    header.total_amount_pay_kip,
    header.paid_kip,
    header.document_payable_kip,
    parseDisplayAmount(header.display_net_lak_text)
  );
  if (directKip !== null) return directKip;
  const payableHome = firstMeaningfulAmount(header.print_payable_amount, header.amount_after_deposit, header.total_amount);
  const payableFromHome = convertDocumentHomeToKip(header, payableHome);
  if (isMeaningfulAmount(payableFromHome)) return payableFromHome;
  return 0;
}

function isPaymentMethodChecked(value) {
  const text = String(value ?? '').trim().toUpperCase();
  if (text === 'X' || text === 'Y' || text === 'TRUE' || text === '1') return true;
  const amount = finiteAmount(value);
  return amount !== null && Math.abs(amount) > 0.005;
}

function buildPosSlipPaymentMethods(data = {}) {
  const company = data.company || {};
  const header = data.header || {};
  const queryC = Array.isArray(data.queryTables?.C) ? data.queryTables.C[0] || {} : {};
  const flags = { ...header, ...company, ...queryC };
  return {
    transfer: isPaymentMethodChecked(flags.check_tranfer || flags.check_transfer || flags.tranfer_amount || flags.transfer_amount),
    cheque: isPaymentMethodChecked(flags.chq_amount || flags.cheque_amount || flags.check_chq || flags.check_cheque),
    cash: isPaymentMethodChecked(flags.cash_amount || flags.check_cash),
  };
}

function buildPosSlipData(data = {}, { copy = false } = {}) {
  const header = data.header || {};
  const company = data.company || {};
  const shipment = data.shipment || {};
  const details = Array.isArray(data.details) ? data.details : [];
  const detailPromotions = details.filter((row) => isPosSlipPromotionItem(row));
  const detailCampaigns = details.filter((row) => isPosSlipCampaignItem(row));
  const saleDetails = details.filter((row) => !isPosSlipPromotionItem(row) && !isPosSlipCampaignItem(row) && isRenderablePosSlipDetail(row));
  const promotions = [
    ...(Array.isArray(data.promotions) ? data.promotions : []),
    ...detailPromotions,
  ];
  const campaigns = [
    ...(Array.isArray(data.campaigns) ? data.campaigns : []),
    ...detailCampaigns,
  ];
  const payableKip = calculateDocumentPayableKip(header);
  const grossKip = calculateDocumentTotalKip(header) || payableKip;
  const documentDiscountKip = calculateDocumentDiscountKip(header);
  const discountKip = documentDiscountKip;

  return {
    header: {
      ...header,
      doc_date_text: formatSlipDate(header.doc_date),
      doc_time_text: String(header.doc_time || header.doc_time_calc || '').trim(),
      customer_text: [header.cust_code || header.ar_code || '', header.name_1 || header.cust_name || header.ar_name || ''].filter(Boolean).join('-'),
      total_kip: grossKip || payableKip,
      discount_kip: discountKip,
      payable_kip: payableKip || Math.max(0, grossKip - discountKip) || grossKip,
      payment_methods: buildPosSlipPaymentMethods(data),
      copy,
    },
    company,
    shipment,
    details: saleDetails,
    promotions: promotions
      .map((row) => ({ ...row, display_text: posSlipRowText(row, 'promotion') }))
      .filter((row) => row.display_text),
    campaigns: campaigns
      .map((row) => ({ ...row, display_text: posSlipRowText(row, 'campaign') }))
      .filter((row) => row.display_text),
  };
}

async function loadPosSlipTemplateLayout(formCode = 'CR-0088') {
  const exists = await query(`SELECT to_regclass('public.sml_pos_slip_template') AS table_name`);
  if (!exists.rows[0]?.table_name) return safeLayout({});
  const result = await query(
    `SELECT layout_json FROM sml_pos_slip_template WHERE lower(form_code) = lower($1) LIMIT 1`,
    [formCode],
  );
  return safeLayout(result.rows[0]?.layout_json || {});
}

function renderPosSlipAds(layout = {}) {
  const ads = (Array.isArray(layout.ads) ? layout.ads : []).filter((ad) => ad.enabled !== false);
  if (!ads.length) return '';
  return ads.map((ad) => {
    const image = ad.image_url || ad.url || '';
    const title = String(ad.title || '').trim();
    const body = String(ad.body || '').trim();
    const maxHeight = Math.max(10, Math.min(120, Number(ad.image_max_height_mm || layout.ad_max_height_mm || 34)));
    const imagePosition = String(ad.image_position || 'top').toLowerCase() === 'bottom' ? 'bottom' : 'top';
    const titleFontSize = Math.max(8, Math.min(32, Number(ad.title_font_size_px || 14)));
    const bodyFontSize = Math.max(8, Math.min(32, Number(ad.body_font_size_px || 11)));
    const titleStyle = [
      `font-size:${titleFontSize}px`,
      `font-weight:${ad.title_bold === false ? 400 : 900}`,
      `font-style:${ad.title_italic === true ? 'italic' : 'normal'}`,
    ].join(';');
    const bodyStyle = [
      `font-size:${bodyFontSize}px`,
      `font-weight:${ad.body_bold === true ? 800 : 400}`,
      `font-style:${ad.body_italic === true ? 'italic' : 'normal'}`,
    ].join(';');
    const imageHtml = image ? `<img class="ad-image" src="${escapeSlipHtml(image)}" style="max-height:${maxHeight}mm" alt="">` : '';
    const textHtml = `
        ${title ? `<div class="ad-title" style="${titleStyle}">${escapeSlipHtml(title).replace(/\n/g, '<br>')}</div>` : ''}
        ${body ? `<div class="ad-body" style="${bodyStyle}">${escapeSlipHtml(body).replace(/\n/g, '<br>')}</div>` : ''}
    `;
    return `
      <section class="slip-ad">
        ${ad.divider !== false ? '<div class="dash"></div>' : ''}
        ${imagePosition === 'top' ? imageHtml : ''}
        ${textHtml}
        ${imagePosition === 'bottom' ? imageHtml : ''}
      </section>
    `;
  }).join('');
}

function posSlipSalespersonName(header = {}) {
  return header.sale_name || header.printbyname || header.print_by_name || header.sale_code || header.creator_code || '';
}

function posSlipItemDisplayName(row = {}, index = 0) {
  const itemName = String(row.item_name || row.name_1 || row.item_name_1 || '').trim();
  const itemCode = String(row.item_code || row.code || row.ic_code || '').trim();
  const barcode = String(row.barcode || '').trim();
  const shelfCode = String(row.shelf_code || '').trim();
  const itemLabel = shouldShowPosSlipItemCode(row) ? `${barcode || itemCode} ${itemName}` : itemName;
  const itemLabelWithShelf = shelfCode ? `${itemLabel} (${shelfCode})` : itemLabel;
  return `${index + 1}. ${itemLabelWithShelf}`.trim();
}

function renderPosSlipHtml({ data, layout, displayTexts = {} }) {
  const slip = buildPosSlipData(data, { copy: displayTexts.copy });
  const header = slip.header;
  const company = slip.company;
  const shipment = slip.shipment || {};
  const shopName = layout.shop_name || company.name_1 || company.company_name || '';
  const branchName = layout.branch_name || header.branch_code || '';
  const slipTitle = String(layout.title || '').trim();
  const logoUrl = layout.logo_url || '';
  const footerText = layout.footer_text || 'ຂອບໃຈທີ່ໃຊ້ບໍລິການ';
  const printBy = posSlipSalespersonName(header);
  const deliveryInfo = posSlipDeliveryInfo(header, shipment);
  const deliveryBlock = isPosSlipDeliver(header, shipment) ? `
    <div class="delivery-block">
      <div class="delivery-title">ຈັດສົ່ງ</div>
      ${deliveryInfo.phone ? `<div class="delivery-row"><span>ເບີໂທ</span><strong>${escapeSlipHtml(deliveryInfo.phone)}</strong></div>` : ''}
      ${deliveryInfo.address ? `<div class="delivery-row"><span>ທີ່ຢູ່</span><strong>${escapeSlipHtml(deliveryInfo.address)}</strong></div>` : ''}
    </div>
  ` : '';
  const itemRows = slip.details.map((row, index) => {
    const displayName = posSlipItemDisplayName(row, index);
    const unitName = posSlipRowUnitName(row);
    const qtyText = formatSlipQty(posSlipRowQty(row));
    const priceText = formatSlipAmount(posSlipRowPrice(row));
    const amountText = formatSlipAmount(posSlipRowAmount(row));
    const remark = String(row.remark || row.line_remark || row.description || '').trim();
    return `
      <div class="item-row">
        <div class="item-name">${escapeSlipHtml(displayName)}</div>
        <div class="item-sub">
          <span>${escapeSlipHtml(`${unitName} ${qtyText} x ${priceText}`.trim())}</span>
          <strong>${escapeSlipHtml(amountText)}</strong>
        </div>
        ${remark ? `<div class="item-remark">${escapeSlipHtml(remark).replace(/\n/g, '<br>')}</div>` : ''}
      </div>
    `;
  }).join('');
  const promotionRows = slip.promotions.map((row) => {
    const text = cleanPosSlipSectionText(row);
    const unitName = posSlipRowUnitName(row);
    const qtyText = formatSlipQty(posSlipRowQty(row));
    const priceText = formatSlipAmount(posSlipRowPrice(row));
    const amountText = formatSlipAmount(posSlipRowAmount(row));
    return `
      <div class="promo-row">
        <div class="promo-name">${escapeSlipHtml(text).replace(/\n/g, '<br>')}</div>
        <div class="item-sub">
          <span>${escapeSlipHtml(`${unitName} ${qtyText} x ${priceText}`.trim())}</span>
          <strong>${escapeSlipHtml(amountText)}</strong>
        </div>
      </div>
    `;
  }).join('');
  const campaignRows = slip.campaigns.map((row) => {
    const text = row.display_text || posSlipRowText(row, 'campaign');
    return `<div class="campaign-row">${escapeSlipHtml(text).replace(/\n/g, '<br>')}</div>`;
  }).join('');
  const remark = String(header.remark || header.remark_1 || '').trim();
  const remarkBlock = remark
    ? `<div class="remark-block"><strong>ໝາຍເຫດ</strong><div>${escapeSlipHtml(remark).replace(/\n/g, '<br>')}</div></div>`
    : '';
  const sectionOrder = (Array.isArray(layout.sections) ? layout.sections : [])
    .filter((section) => section?.enabled !== false)
    .map((section) => String(section?.key || '').trim())
    .filter(Boolean);
  const sectionPosition = (key) => {
    const index = sectionOrder.indexOf(key);
    return index >= 0 ? index : 999;
  };
  const sectionEnabled = (key) => !sectionOrder.length || sectionOrder.includes(key);
  const payableKip = toNumber(header.payable_kip || header.total_kip);
  const discountKip = toNumber(header.discount_kip);
  const paymentMethods = header.payment_methods || {};
  const hasPaymentMethod = Boolean(paymentMethods.transfer || paymentMethods.cheque || paymentMethods.cash);
  const paymentMethodBlock = hasPaymentMethod ? `
    <div class="payment-method-row">
      <span>ການຈ່າຍເງິນ</span>
      <div class="payment-checks">
        <span><b class="pay-box">${paymentMethods.transfer ? 'X' : ''}</b> ໂອນ</span>
        <span><b class="pay-box">${paymentMethods.cheque ? 'X' : ''}</b> ເຊັກ</span>
        <span><b class="pay-box">${paymentMethods.cash ? 'X' : ''}</b> ເງິນສົດ</span>
      </div>
    </div>
  ` : '';
  const totalsBlock = `
    <div class="total-row"><span>ທັງໝົດ</span><strong>${escapeSlipHtml(formatSlipAmount(header.total_kip))}</strong></div>
    ${discountKip > 0 ? `<div class="total-row discount-row"><span>ສ່ວນຫຼຸດ</span><strong>-${escapeSlipHtml(formatSlipAmount(discountKip))}</strong></div>` : ''}
    <div class="line"></div>
    <div class="total-row"><span><b>ຈຳນວນເງິນທີ່ຈ່າຍ</b></span><strong>${escapeSlipHtml(formatSlipAmount(payableKip))}</strong></div>
    ${paymentMethodBlock}
  `;
  const afterItemSections = [
    sectionEnabled('promotions') && promotionRows ? { key: 'promotions', html: `<div class="body-text">${promotionRows}</div>` } : null,
    sectionEnabled('totals') ? { key: 'totals', html: totalsBlock } : null,
    sectionEnabled('campaigns') && campaignRows ? { key: 'campaigns', html: `<div class="campaign-block">${campaignRows}</div>` } : null,
    sectionEnabled('remark') && remarkBlock ? { key: 'remark', html: remarkBlock } : null,
  ]
    .filter(Boolean)
    .sort((a, b) => sectionPosition(a.key) - sectionPosition(b.key))
    .map((section) => section.html)
    .join('');
  return `<!doctype html>
<html lang="lo">
<head>
  <meta charset="utf-8">
  <title>${escapeSlipHtml(header.doc_no || 'pos-slip')}</title>
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { box-sizing: border-box; }
    html, body { width: 80mm; margin: 0; padding: 0; background: #fff; color: #111; }
    body {
      font-family: "Noto Sans Lao", "Phetsarath OT", "Saysettha OT", "DejaVu Sans", Arial, sans-serif;
      font-size: 11px;
      font-weight: 600;
      line-height: 1.28;
      text-rendering: geometricPrecision;
      -webkit-font-smoothing: antialiased;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .receipt { width: 72mm; margin-left: 1.5mm; margin-right: 0; padding: 3mm 0 4mm; overflow: hidden; }
    .center { text-align: center; }
    .logo { max-width: 38mm; max-height: ${Math.max(8, Math.min(45, Number(layout.logo_max_height_mm || 18)))}mm; object-fit: contain; display: block; margin: 0 auto 1.5mm; }
    .shop { font-weight: 800; font-size: 16px; }
    .branch { font-size: 10px; font-weight: 700; }
    .slip-title { font-size: 13px; font-weight: 800; margin-top: .8mm; overflow-wrap: anywhere; }
    .copy { font-size: 12px; font-weight: 800; margin-top: 1mm; }
    .line { border-top: 1px solid #111; margin: 2mm 0; }
    .dash { border-top: 1px dashed #111; margin: 3mm 0; }
    .kv { display: grid; grid-template-columns: 28mm 1fr; gap: 1mm; margin: .5mm 0; }
    .kv span:first-child { color: #111; font-weight: 700; }
    .kv strong { text-align: right; font-weight: 900; overflow-wrap: anywhere; }
    .delivery-block { margin: 1mm 0 1.5mm; padding: 1mm 0; border-top: 1px dashed #111; border-bottom: 1px dashed #111; }
    .delivery-title { font-weight: 900; margin-bottom: .8mm; }
    .delivery-row { display: grid; grid-template-columns: 16mm 1fr; gap: 1mm; margin: .5mm 0; }
    .delivery-row span { color: #111; font-weight: 700; }
    .delivery-row strong { font-weight: 900; overflow-wrap: anywhere; }
    .section-title { font-weight: 800; border-bottom: 1px solid #111; padding-bottom: .8mm; margin: 2mm 0 1.2mm; }
    .item-row { padding: 1.2mm 0; break-inside: avoid; }
    .item-name { font-weight: 800; text-align: left; overflow-wrap: anywhere; }
    .item-sub { display: grid; grid-template-columns: 1fr auto; gap: 1.5mm; align-items: start; margin-top: .8mm; }
    .item-sub span { font-weight: 700; }
    .item-sub strong { font-weight: 900; text-align: right; white-space: nowrap; }
    .item-remark { margin-top: .8mm; font-size: 10px; font-weight: 700; overflow-wrap: anywhere; }
    .promo-row { padding: 1mm 0; break-inside: avoid; }
    .promo-name { font-weight: 800; text-align: left; overflow-wrap: anywhere; }
    .campaign-block { margin: 1.8mm 0; border-top: 1px dashed #111; border-bottom: 1px dashed #111; }
    .campaign-row { padding: 1.1mm 0; border-top: 1px dashed #111; font-weight: 700; overflow-wrap: anywhere; }
    .campaign-row:first-child { border-top: 0; }
    .total-row { display: grid; grid-template-columns: 1fr auto; gap: 2mm; align-items: baseline; margin: 1.2mm 0; }
    .total-row strong { font-size: 15px; font-weight: 900; white-space: nowrap; }
    .discount-row strong { font-size: 13px; }
    .payment-method-row { display: grid; grid-template-columns: 18mm 1fr; gap: 1.5mm; align-items: center; margin: 1.2mm 0; }
    .payment-method-row > span { font-weight: 700; }
    .payment-checks { display: flex; justify-content: space-between; gap: 1.2mm; font-size: 10.5px; font-weight: 800; white-space: nowrap; }
    .payment-checks span { display: inline-flex; align-items: center; gap: .7mm; }
    .pay-box { display: inline-flex; align-items: center; justify-content: center; width: 3.3mm; height: 3.3mm; border: 1px solid #111; font-size: 8.5px; line-height: 1; }
    .body-text { margin: 1.4mm 0; font-weight: 700; overflow-wrap: anywhere; }
    .remark-block { margin: 1.4mm 0; padding-top: 1mm; border-top: 1px solid #111; overflow-wrap: anywhere; }
    .remark-block strong { display: block; font-weight: 900; margin-bottom: .6mm; }
    .footer-row { display: grid; grid-template-columns: 1fr auto; gap: 2mm; margin-top: 1.5mm; align-items: start; }
    .footer-row span { font-weight: 700; }
    .footer-row strong { font-weight: 900; white-space: nowrap; }
    .slip-ad { text-align: center; break-inside: avoid; }
    .ad-image { max-width: 100%; object-fit: contain; display: block; margin: 1mm auto; }
    .ad-title { font-weight: 900; font-size: 14px; margin-top: 2mm; }
    .ad-body { margin-top: 1.5mm; overflow-wrap: anywhere; }
    @media screen { body { margin: 0 auto; box-shadow: 0 0 0 1px #ddd; } }
    @media print {
      .receipt { margin-left: 1.5mm; margin-right: 0; }
    }
  </style>
</head>
<body data-print-width-pt="226.77">
  <main class="receipt">
    <div class="center">
      ${logoUrl ? `<img class="logo" src="${escapeSlipHtml(logoUrl)}" alt="">` : ''}
      <div class="shop">${escapeSlipHtml(shopName)}</div>
      ${branchName ? `<div class="branch">ສາຂາ ${escapeSlipHtml(branchName)}</div>` : ''}
      ${slipTitle ? `<div class="slip-title">${escapeSlipHtml(slipTitle)}</div>` : ''}
      ${header.copy ? '<div class="copy">ສຳເນົາ</div>' : ''}
    </div>
    <div class="line"></div>
    <div class="kv"><span>ວັນທີ ເວລາ</span><strong>${escapeSlipHtml(`${header.doc_date_text} ${header.doc_time_text}`.trim())}</strong></div>
    <div class="kv"><span>ເລກທີບິນ</span><strong>${escapeSlipHtml(header.doc_no || '')}</strong></div>
    <div class="kv"><span>ລູກຄ້າ</span><strong>${escapeSlipHtml(header.customer_text || '')}</strong></div>
    ${deliveryBlock}
    <div class="section-title">ລາຍການສິນຄ້າ</div>
    ${itemRows || '<div class="body-text center">-</div>'}
    ${afterItemSections}
    <div class="dash"></div>
    <div class="center">${escapeSlipHtml(footerText).replace(/\n/g, '<br>')}</div>
    <div class="footer-row"><span>ພະນັກງານຂາຍ</span><strong>${escapeSlipHtml(printBy)}</strong></div>
    <div class="dash"></div>
    ${renderPosSlipAds(layout)}
  </main>
</body>
</html>`;
}

router.get('/getSalePrintForms', async (req, res) => {
  const { doc_no = '' } = req.query;
  if (!doc_no) return res.status(400).json({ success: false, msg: 'doc_no is required' });

  try {
    const options = await loadPrintFormOptions(doc_no);
    if (!options) return res.status(404).json({ success: false, msg: 'document not found' });
    return res.json({ success: true, data: options });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

router.get('/sale-print/slip-template-preview', async (req, res) => {
  const formCode = String(req.query.form_code || 'CR-0088').trim().toUpperCase();
  const requestedDocNo = String(req.query.doc_no || '').trim();

  try {
    const docNo = requestedDocNo || await findSlipTemplatePreviewDocNo(formCode);
    if (!docNo) return res.status(404).json({ success: false, msg: 'preview document not found' });

    const [formRows, saleData] = await Promise.all([
      loadFormDesignRows([formCode]),
      loadSaleDocument(docNo),
    ]);
    if (!formRows.length) return res.status(404).json({ success: false, msg: 'print form not found' });
    if (!saleData) return res.status(404).json({ success: false, msg: 'document not found' });

    const { printData, dataByFormCode } = await buildPrintDataForForms(formRows, saleData, {
      docNo,
      transFlag: 44,
    });
    const formData = dataByFormCode[String(formCode).toLowerCase()] || printData;
    return res.json({
      success: true,
      data: {
        form_code: formCode,
        doc_no: docNo,
        preview: buildSlipTemplatePreviewData(formData),
      },
    });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

router.get('/sale-print/pos-slip', async (req, res) => {
  const {
    doc_no = '',
    auto_print = '1',
    log_print,
    user_code = '',
    copy = '',
    display_net_lak_text = '',
  } = req.query;
  if (!doc_no) return res.status(400).type('text/plain').send('doc_no is required');

  try {
    const [options, saleData] = await Promise.all([
      loadPrintFormOptions(doc_no),
      loadSaleDocument(doc_no),
    ]);
    if (!saleData) return res.status(404).type('text/plain').send('document not found');

    const availableCodes = (options?.forms || []).filter((form) => form.available).map((form) => form.formcode);
    const formCode = availableCodes.find((code) => String(code).toUpperCase() === 'CR-0088');
    if (!formCode) {
      const fallbackCodes = availableCodes.slice(0, 1);
      const fallbackRows = await loadFormDesignRows(fallbackCodes);
      if (!fallbackRows.length) return res.status(404).type('text/plain').send('print form not found');

      const { printData, dataByFormCode } = await buildPrintDataForForms(fallbackRows, saleData, {
        docNo: doc_no,
        transFlag: 44,
      });
      const printUserCode = user_code || saleData.header.creator_code || saleData.header.cashier_code;
      const printUser = await loadPrintUser(printUserCode);
      const logThisPrint = req.method !== 'HEAD' && shouldLogPrint(log_print, auto_print);
      const printCount = logThisPrint
        ? await createPrintLog(doc_no, printUser.code || printUserCode)
        : await getPrintCount(doc_no);
      saleData.header.print_count = printCount;
      printData.header.print_count = printCount;
      applyPrintUser(saleData, printUser);
      applyPrintUser(printData, printUser);
      Object.values(dataByFormCode).forEach((formData) => {
        formData.header.print_count = printCount;
        applyPrintUser(formData, printUser);
      });

      const html = renderSalePrintHtml({
        formRows: fallbackRows,
        data: printData,
        dataByFormCode,
        autoPrint: String(auto_print) !== '0',
      });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).type('html').send(html);
    }
    const formRows = await loadFormDesignRows([formCode]);
    const { printData } = formRows.length
      ? await buildPrintDataForForms(formRows, saleData, { docNo: doc_no, transFlag: 44 })
      : { printData: saleData };

    const printUserCode = user_code || saleData.header.creator_code || saleData.header.cashier_code;
    const printUser = await loadPrintUser(printUserCode);
    const logThisPrint = req.method !== 'HEAD' && shouldLogPrint(log_print, auto_print);
    const printCount = logThisPrint
      ? await createPrintLog(doc_no, printUser.code || printUserCode)
      : await getPrintCount(doc_no);
    saleData.header.print_count = printCount;
    printData.header.print_count = printCount;
    applyPrintUser(saleData, printUser);
    applyPrintUser(printData, printUser);

    const layout = await loadPosSlipTemplateLayout('CR-0088');
    const html = renderPosSlipHtml({
      data: normalizeSalePrintPayableTotals(printData),
      layout,
      displayTexts: {
        copy: String(copy) === '1',
        display_net_lak_text: String(display_net_lak_text || '').trim(),
      },
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).type('html').send(html);
  } catch (ex) {
    return res.status(500).type('text/plain').send(ex.message);
  }
});

router.get('/sale-print/render', async (req, res) => {
  const { doc_no = '', formcodes = '', auto_print = '1', log_print, user_code = '' } = req.query;
  if (!doc_no) return res.status(400).type('text/plain').send('doc_no is required');

  try {
    const [options, saleData] = await Promise.all([
      loadPrintFormOptions(doc_no),
      loadSaleDocument(doc_no),
    ]);

    if (!options || !saleData) return res.status(404).type('text/plain').send('document not found');

    const availableCodes = options.forms.filter((form) => form.available).map((form) => form.formcode);
    const requestedCodes = uniqueCodes(splitFormCodes(formcodes));
    const selectedCodes = requestedCodes.length
      ? requestedCodes.filter((code) => availableCodes.some((available) => available.toLowerCase() === code.toLowerCase()))
      : availableCodes.slice(0, 1);

    if (!selectedCodes.length) return res.status(404).type('text/plain').send('print form not found');

    const formRows = await loadFormDesignRows(selectedCodes);
    if (!formRows.length) return res.status(404).type('text/plain').send('print form not found');

    const { printData, dataByFormCode } = await buildPrintDataForForms(formRows, saleData, {
      docNo: doc_no,
      transFlag: 44,
    });
    const printUserCode = user_code || saleData.header.creator_code || saleData.header.cashier_code;
    const printUser = await loadPrintUser(printUserCode);
    const logThisPrint = req.method !== 'HEAD' && shouldLogPrint(log_print, auto_print);
    const printCount = logThisPrint
      ? await createPrintLog(doc_no, printUser.code || printUserCode)
      : await getPrintCount(doc_no);
    saleData.header.print_count = printCount;
    printData.header.print_count = printCount;
    applyPrintUser(saleData, printUser);
    applyPrintUser(printData, printUser);
    Object.values(dataByFormCode).forEach((formData) => {
      formData.header.print_count = printCount;
      applyPrintUser(formData, printUser);
    });

    const html = renderSalePrintHtml({
      formRows,
      data: printData,
      dataByFormCode,
      autoPrint: String(auto_print) !== '0',
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).type('html').send(html);
  } catch (ex) {
    return res.status(500).type('text/plain').send(ex.message);
  }
});

// พิมพ์ใบเสร็จ ESC/POS สำหรับ thermal printer — คืนค่าเป็น hex string
router.get('/sale-print/thermal', async (req, res) => {
  const { doc_no = '' } = req.query;
  if (!doc_no) return res.status(400).json({ success: false, msg: 'doc_no is required' });
  try {
    const saleData = await loadSaleDocument(doc_no);
    if (!saleData) return res.status(404).json({ success: false, msg: 'document not found' });

    // ดึง pay_cash_amount และ money_change จาก cb_trans (ไม่อยู่ใน loadSaleDocument)
    const cbRes = await query(
      `SELECT COALESCE(pay_cash_amount,0) AS pay_cash_amount, COALESCE(money_change,0) AS money_change
       FROM cb_trans WHERE doc_no=$1 AND trans_flag=44 LIMIT 1`,
      [doc_no]
    );
    saleData.header.pay_cash_amount = cbRes.rows[0]?.pay_cash_amount ?? 0;
    saleData.header.money_change = cbRes.rows[0]?.money_change ?? 0;

    const hex = buildThermalReceiptHex(saleData);
    return res.json({ success: true, hex });
  } catch (ex) {
    console.error('[sale-print/thermal]', ex.message);
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

router._test = { posSlipItemDisplayName, posSlipSalespersonName };

module.exports = router;
