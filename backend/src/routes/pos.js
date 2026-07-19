const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { pool, query, withTransaction } = require('../db');
const { calcDiscount } = require('../utils/vatHelper');
const { getProductPriceLocalx } = require('../utils/priceHelper');
const { smlRound } = require('../utils/smlMoney');
const {
  calculateSaleCurrencyTotals,
  calculateSaleDocumentTotals,
  prepareSaleItemAmounts,
  normalizeCurrencyCode,
  homeCurrencyCode,
  isForeignCurrencyContext,
  roundLakChange,
  convertCurrencyToHome,
} = require('../utils/saleCalculator');
const { processPosSlipCampaign } = require('../utils/posSlipCampaign');
const { bangkokTimestamp } = require('../utils/bangkokTime');

const uuidv4 = () => crypto.randomUUID();
const DEFAULT_SUMMARY_CURRENCY_CODES = ['LAK', 'THB', 'USD', 'CNY'];
const SALE_FEEDBACK_ANSWER_TYPES = [1, 2, 3];

function parseSummaryCurrencyCodes(rawValue) {
  const source = String(rawValue || '').trim();
  const list = source
    ? source.split(',').map((word) => String(word || '').trim().toUpperCase()).filter(Boolean)
    : DEFAULT_SUMMARY_CURRENCY_CODES;
  return Array.from(new Set(list));
}


router.post('/sale-feedback', async (req, res) => {
  try {
    const docNo = String(req.body?.doc_no || req.body?.docNo || '').trim();
    const answerType = Number(req.body?.answer_type ?? req.body?.answerType);
    if (!docNo) return res.status(400).json({ success: false, msg: 'doc_no is required' });
    if (!Number.isInteger(answerType) || !SALE_FEEDBACK_ANSWER_TYPES.includes(answerType)) {
      return res.status(400).json({ success: false, msg: 'answer_type must be 1, 2, or 3' });
    }
    const result = await query(
      `UPDATE ic_trans
       SET answer_type = $1
       WHERE doc_no = $2 AND trans_flag = 44
       RETURNING doc_no, answer_type`,
      [answerType, docNo],
    );
    if (!result.rows.length) return res.status(404).json({ success: false, msg: 'sale document not found' });
    return res.json({ success: true, data: result.rows[0] });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── helper: buildDocPattern ────────────────────────────────────────────────
// แปลง doc_format จาก pos_id table เป็น pattern จริง
// เช่น "@-yyyy-####" + posId="MPOS01" → "MPOS01-2026-####"
function buildDocPattern(docFormat, posId) {
  if (!docFormat || docFormat.trim() === '') return posId + '-####';
  const now = new Date();
  const year4 = String(now.getFullYear());
  const year2 = year4.substring(2);
  const buddhistYear4 = String(now.getFullYear() + 543);
  const buddhistYear2 = buddhistYear4.substring(2);
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return docFormat
    .replace(/@/g, posId)
    .replace(/\u0e1b\u0e1b\u0e1b\u0e1b/g, buddhistYear4)
    .replace(/\u0e1b\u0e1b/g, buddhistYear2)
    .replace(/\u0e14\u0e14/g, month)
    .replace(/\u0e27\u0e27/g, day)
    .replace(/ปปปป/g, year4)
    .replace(/ปป/g, year2)
    .replace(/ดด/g, month)
    .replace(/วว/g, day)
    .replace(/yyyy/g, year4)
    .replace(/YYYY/g, year4)
    .replace(/yy/g, year2)
    .replace(/YY/g, year2)
    .replace(/MM/g, month)
    .replace(/dd/g, day)
    .replace(/DD/g, day);
}

async function resolveDocNoFromPattern(client, pattern, transFlag) {
  const firstHash = pattern.indexOf('#');
  if (firstHash < 0) return pattern;

  let runLen = 0;
  while (firstHash + runLen < pattern.length && pattern[firstHash + runLen] === '#') runLen++;

  const likePattern = pattern.replace(/#/g, '_');
  const patternLen = pattern.length;

  const rows = await client.query(
    'SELECT doc_no FROM ic_trans WHERE trans_flag=$1 AND char_length(doc_no)=$2 AND doc_no LIKE $3',
    [transFlag, patternLen, likePattern]
  );

  let maxRunning = 0;
  for (const row of rows.rows) {
    const docNo = row.doc_no;
    if (!docNo || docNo.length !== patternLen) continue;
    const runText = docNo.substring(firstHash, firstHash + runLen);
    if (!/^\d+$/.test(runText)) continue;
    const run = parseInt(runText, 10);
    if (run > maxRunning) maxRunning = run;
  }

  const nextRunning = maxRunning + 1;
  if (nextRunning > Math.pow(10, runLen) - 1) throw new Error('running overflow');

  const prefix = pattern.substring(0, firstHash);
  const suffix = pattern.substring(firstHash + runLen);
  return prefix + String(nextRunning).padStart(runLen, '0') + suffix;
}

// ── helper: resolveDocNo ────────────────────────────────────────────────────
// Query ic_trans → หา max running number → คืน doc_no ถัดไป
// ต้องเรียกภายใน transaction (client) เพื่อ consistency
async function resolveDocNo(client, posId, transFlag) {
  const posRes = await client.query(
    'SELECT doc_format FROM pos_id WHERE pos_id = $1 LIMIT 1',
    [posId]
  );
  if (posRes.rows.length === 0) throw new Error(`pos_id not found: ${posId}`);

  const docFormat = posRes.rows[0].doc_format || '';
  const pattern = buildDocPattern(docFormat, posId);
  return resolveDocNoFromPattern(client, pattern, transFlag);
}

async function resolveSaleDocFormat(client, docFormatCode) {
  const code = String(docFormatCode || '').trim();
  const result = code
    ? await client.query(
      `SELECT code, name_1, screen_code, format, COALESCE(form_code,'') AS form_code
       FROM erp_doc_format
       WHERE code = $1
       ORDER BY code
       LIMIT 1`,
      [code]
    )
    : await client.query(
      `SELECT code, name_1, screen_code, format, COALESCE(form_code,'') AS form_code
       FROM erp_doc_format
       WHERE screen_code = 'SI'
       ORDER BY code
       LIMIT 1`
    );

  const docFormat = result.rows[0];
  if (!docFormat) throw new Error(code ? `sale doc_format_code not found: ${code}` : 'sale doc_format_code is required');
  docFormat.save_doc_format_code = String(docFormat.code || '').trim();
  return docFormat;
}

async function resolveSaleDocNo(client, docFormatCode, transFlag) {
  const docFormat = await resolveSaleDocFormat(client, docFormatCode);
  const pattern = buildDocPattern(docFormat.format || '@-YYMM####', docFormat.code);
  const docNo = await resolveDocNoFromPattern(client, pattern, transFlag);
  return {
    doc_no: docNo,
    doc_format_code: docFormat.save_doc_format_code,
    form_code: docFormat.form_code || '',
  };
}

// ── GET /service/v1/getBranchList ──────────────────────────────────────────
router.get('/getBranchList', async (req, res) => {
  try {
    const result = await query('SELECT code, name_1 FROM erp_branch_list ORDER BY code');
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getWarehouseList ───────────────────────────────────────
router.get('/getWarehouseList', async (req, res) => {
  try {
    const branchCode = String(req.query.branch_code || '').trim();
    const result = await query(
      `SELECT code, name_1, branch_code
       FROM ic_warehouse
       ORDER BY
         CASE WHEN $1 <> '' AND branch_code = $1 THEN 0 ELSE 1 END,
         code`,
      [branchCode],
    );
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getShelfList ───────────────────────────────────────────
router.get('/getShelfList', async (req, res) => {
  const { wh_code = '' } = req.query;
  try {
    let result;
    if (wh_code) {
      result = await query(
        "SELECT whcode, code, COALESCE(name_1,'') AS name_1 FROM ic_shelf WHERE whcode=$1 ORDER BY whcode, code",
        [wh_code]
      );
    } else {
      result = await query(
        "SELECT whcode, code, COALESCE(name_1,'') AS name_1 FROM ic_shelf ORDER BY whcode, code"
      );
    }
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getPOSList ─────────────────────────────────────────────
router.get('/getPOSList', async (req, res) => {
  try {
    const columnsResult = await query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'pos_id'`
    );
    const columns = new Set(columnsResult.rows.map((row) => row.column_name));
    const inquiryTypeExpr = columns.has('inquiry_type') ? 'COALESCE(p.inquiry_type, 1) AS inquiry_type' : '1 AS inquiry_type';
    const saleTypeExpr = columns.has('inquiry_type') ? 'COALESCE(p.inquiry_type, 1) AS sale_type' : '1 AS sale_type';
    const vatTypeExpr = columns.has('vat_type') ? 'COALESCE(p.vat_type, 1) AS vat_type' : '1 AS vat_type';
    const priceNumberExpr = columns.has('price_number') ? 'COALESCE(p.price_number, 1) AS price_number' : '1 AS price_number';
    const machinecodeExpr = columns.has('machinecode') ? "COALESCE(p.machinecode, '') AS machinecode" : "'' AS machinecode";
    const result = await query(`
      SELECT
        p.pos_id,
        p.doc_format_code,
        p.doc_format,
        ${inquiryTypeExpr},
        ${saleTypeExpr},
        ${vatTypeExpr},
        ${priceNumberExpr},
        ${machinecodeExpr},
        p.pos_ic_wht, p.pos_ic_shelf, p.branch_code,
        COALESCE(b.name_1, '') AS branch_name,
        COALESCE(w.name_1, '') AS wh_name,
        COALESCE(s.name_1, '') AS shelf_name
      FROM pos_id p
      LEFT JOIN erp_branch_list b ON b.code = p.branch_code
      LEFT JOIN ic_warehouse    w ON w.code = p.pos_ic_wht
      LEFT JOIN ic_shelf        s ON s.code = p.pos_ic_shelf AND s.whcode = p.pos_ic_wht
      ORDER BY p.pos_id
    `);
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getErpOption ───────────────────────────────────────────
router.get('/getErpOption', async (req, res) => {
  try {
    const columnsResult = await query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'erp_option'`
    );
    const columns = new Set(columnsResult.rows.map((row) => row.column_name));
    const optionColumns = {
      vat_type: '1',
      vat_rate: '7',
      discout_type: '0',
      discount_vat_type: '0',
      item_qty_decimal: '2',
      item_price_decimal: '2',
      item_amount_decimal: '2',
      round_type: '0',
      discount_step_round_off: '0',
      currency_exchange_decimal: '2',
      home_currency: 'LAK',
      multi_currency: '1',
      ic_stock_control: '0',
      issue_stock_control: '0',
      stock_balance_control: '0',
      balance_control_type: '0',
      warning_price_1: '0',
      warning_price_2: '0',
      disable_sale_no_price: '0',
      warning_low_cost: '0',
      lock_low_cost: '0',
      ic_price_formula_control: '0',
      use_doc_group: '0',
      use_department: '0',
      use_job: '0',
      use_allocate: '0',
      use_unit: '0',
      use_project: '0',
    };
    const selectList = Object.entries(optionColumns).map(([name, fallback]) => (
      columns.has(name) ? `COALESCE(${name}::text, '${fallback}') AS ${name}` : `'${fallback}' AS ${name}`
    ));
    const result = await query(
      `SELECT ${selectList.join(', ')}
       FROM erp_option
       LIMIT 1`
    );
    return res.json({ success: true, data: result.rows[0] || {} });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getDocGroupList ───────────────────────────────────────
// ── POST /service/v1/checkSaleItemPolicies ─────────────────────────────────
router.post('/checkSaleItemPolicies', async (req, res) => {
  const client = await pool.connect();
  try {
    const obj = req.body || {};
    const items = Array.isArray(obj.items)
      ? JSON.parse(JSON.stringify(obj.items))
      : [];
    const companyOptions = await loadSaleCompanyOptions(client);
    const options = {
      ...companyOptions,
      vat_type: Number.isFinite(asNumber(obj.vat_type, Number.NaN)) ? asNumber(obj.vat_type) : companyOptions.vat_type,
      vat_rate: Number.isFinite(asNumber(obj.vat_rate, Number.NaN)) ? asNumber(obj.vat_rate) : companyOptions.vat_rate,
      currency_code: asText(obj.currency_code),
      exchange_rate: asNumber(obj.exchange_rate, 1) || 1,
    };
    prepareSaleItemAmounts(items, options);
    const policyIssues = await collectSaleItemPolicyIssues(client, {
      items,
      docDate: obj.doc_date,
      options,
    });
    return res.json({
      success: true,
      data: {
        errors: policyIssues.errors,
        warnings: policyIssues.warnings,
      },
    });
  } catch (ex) {
    return res.status(ex.statusCode || 500).json({ success: false, msg: ex.message });
  } finally {
    client.release();
  }
});

router.get('/getDocGroupList', async (req, res) => {
  try {
    const result = await query('SELECT code, name_1 FROM erp_doc_group ORDER BY code');
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getSideList ────────────────────────────────────────────
router.get('/getSideList', async (req, res) => {
  try {
    const result = await query('SELECT code, name_1 FROM erp_side_list ORDER BY code');
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getDepartmentList ─────────────────────────────────────
router.get('/getDepartmentList', async (req, res) => {
  try {
    const result = await query('SELECT code, name_1 FROM erp_department_list ORDER BY code');
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getAllocateList ────────────────────────────────────────
router.get('/getAllocateList', async (req, res) => {
  try {
    const result = await query('SELECT code, name_1 FROM erp_allocate_list ORDER BY code');
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getProjectList ────────────────────────────────────────
router.get('/getProjectList', async (req, res) => {
  try {
    const result = await query('SELECT code, name_1 FROM erp_project_list ORDER BY code');
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getJobList ─────────────────────────────────────────────
router.get('/getJobList', async (req, res) => {
  try {
    const result = await query('SELECT code, name_1 FROM erp_job_list ORDER BY code');
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getProvinceList ───────────────────────────────────────
router.get('/getProvinceList', async (req, res) => {
  const { search = '' } = req.query;
  const keyword = String(search || '').trim();
  try {
    let result;
    if (keyword) {
      result = await query(
        `SELECT code, COALESCE(name_1, '') AS name_1
         FROM erp_province
         WHERE code ILIKE $1 OR COALESCE(name_1, '') ILIKE $1
         ORDER BY code
         LIMIT 200`,
        [`%${keyword}%`],
      );
    } else {
      result = await query(
        `SELECT code, COALESCE(name_1, '') AS name_1
         FROM erp_province
         ORDER BY code
         LIMIT 200`,
      );
    }
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getAmperList ──────────────────────────────────────────
router.get('/getAmperList', async (req, res) => {
  const { province = '', search = '' } = req.query;
  const provinceCode = String(province || '').trim();
  const keyword = String(search || '').trim();
  if (!provinceCode) return res.json({ success: true, data: [] });
  try {
    let result;
    if (keyword) {
      result = await query(
        `SELECT code, COALESCE(name_1, '') AS name_1, province
         FROM erp_amper
         WHERE province = $1
           AND (code ILIKE $2 OR COALESCE(name_1, '') ILIKE $2)
         ORDER BY code
         LIMIT 300`,
        [provinceCode, `%${keyword}%`],
      );
    } else {
      result = await query(
        `SELECT code, COALESCE(name_1, '') AS name_1, province
         FROM erp_amper
         WHERE province = $1
         ORDER BY code
         LIMIT 300`,
        [provinceCode],
      );
    }
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getTambonList ─────────────────────────────────────────
router.get('/getTambonList', async (req, res) => {
  const { province = '', amper = '', search = '' } = req.query;
  const provinceCode = String(province || '').trim();
  const amperCode = String(amper || '').trim();
  const keyword = String(search || '').trim();
  if (!provinceCode || !amperCode) return res.json({ success: true, data: [] });
  try {
    let result;
    if (keyword) {
      result = await query(
        `SELECT code, COALESCE(name_1, '') AS name_1,
                COALESCE(zip_code, '') AS zip_code,
                province, amper
         FROM erp_tambon
         WHERE province = $1 AND amper = $2
           AND (code ILIKE $3 OR COALESCE(name_1, '') ILIKE $3)
         ORDER BY code
         LIMIT 500`,
        [provinceCode, amperCode, `%${keyword}%`],
      );
    } else {
      result = await query(
        `SELECT code, COALESCE(name_1, '') AS name_1,
                COALESCE(zip_code, '') AS zip_code,
                province, amper
         FROM erp_tambon
         WHERE province = $1 AND amper = $2
         ORDER BY code
         LIMIT 500`,
        [provinceCode, amperCode],
      );
    }
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getLogisticAreaList ──────────────────────────────────
router.get('/getLogisticAreaList', async (req, res) => {
  const { search = '' } = req.query;
  const keyword = String(search || '').trim();
  try {
    let result;
    if (keyword) {
      result = await query(
        `SELECT code, COALESCE(name_1, '') AS name_1
         FROM ar_logistic_area
         WHERE code ILIKE $1 OR COALESCE(name_1, '') ILIKE $1
         ORDER BY CASE WHEN code = $2 THEN 0 ELSE 1 END, code
         LIMIT 300`,
        [`%${keyword}%`, keyword],
      );
    } else {
      result = await query(
        `SELECT code, COALESCE(name_1, '') AS name_1
         FROM ar_logistic_area
         ORDER BY code
         LIMIT 300`,
      );
    }
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getShippingLabelList ─────────────────────────────────
router.get('/getShippingLabelList', async (req, res) => {
  const { cust_code = '', search = '' } = req.query;
  const custCode = String(cust_code || '').trim();
  const keyword = String(search || '').trim();
  const customerCodes = custCode ? ['', 'AR00001', custCode] : ['', 'AR00001'];
  try {
    const labelKeyword = keyword
      ? `
        AND (
          ship_code ILIKE $3
          OR COALESCE(name_1, '') ILIKE $3
          OR COALESCE(address, '') ILIKE $3
          OR COALESCE(telephone, '') ILIKE $3
          OR COALESCE(zip_code, '') ILIKE $3
        )`
      : '';
    const customerKeyword = keyword
      ? `
        AND (
          c.code ILIKE $3
          OR COALESCE(c.name_1, '') ILIKE $3
          OR COALESCE(c.address, '') ILIKE $3
          OR COALESCE(c.telephone, '') ILIKE $3
          OR COALESCE(c.zip_code, '') ILIKE $3
        )`
      : '';
    const params = keyword ? [customerCodes, custCode, `%${keyword}%`] : [customerCodes, custCode];
    const result = await query(
      `SELECT ship_code, name_1, address, telephone, fax, tambon, amper,
              province, country, zip_code, transport_type, logistic_area,
              latitude, longitude, remark_1, remark_2, cust_code
       FROM (
         SELECT COALESCE(BTRIM(ship_code), '') AS ship_code,
                COALESCE(BTRIM(name_1), '') AS name_1,
                COALESCE(BTRIM(address), '') AS address,
                COALESCE(BTRIM(telephone), '') AS telephone,
                COALESCE(BTRIM(fax), '') AS fax,
                COALESCE(BTRIM(tambon), '') AS tambon,
                COALESCE(BTRIM(amper), '') AS amper,
                COALESCE(BTRIM(province), '') AS province,
                COALESCE(BTRIM(country), '') AS country,
                COALESCE(BTRIM(zip_code), '') AS zip_code,
                COALESCE(BTRIM(transport_type), '') AS transport_type,
                COALESCE(BTRIM(logistic_area), '') AS logistic_area,
                COALESCE(latitude, 0) AS latitude,
                COALESCE(longitude, 0) AS longitude,
                COALESCE(BTRIM(remark_1), '') AS remark_1,
                COALESCE(BTRIM(remark_2), '') AS remark_2,
                COALESCE(BTRIM(cust_code), '') AS cust_code,
                CASE
                  WHEN $2 <> '' AND COALESCE(BTRIM(cust_code), '') = $2 THEN 0
                  WHEN COALESCE(BTRIM(cust_code), '') = 'AR00001' THEN 2
                  WHEN COALESCE(BTRIM(cust_code), '') = '' THEN 3
                  ELSE 4
                END AS source_rank
         FROM ap_ar_transport_label
         WHERE COALESCE(BTRIM(cust_code), '') = ANY($1)
         ${labelKeyword}

         UNION ALL

         SELECT '' AS ship_code,
                COALESCE(BTRIM(c.name_1), '') AS name_1,
                COALESCE(BTRIM(c.address), '') AS address,
                COALESCE(BTRIM(c.telephone), '') AS telephone,
                COALESCE(BTRIM(c.fax), '') AS fax,
                COALESCE(BTRIM(c.tambon), '') AS tambon,
                COALESCE(BTRIM(c.amper), '') AS amper,
                COALESCE(BTRIM(c.province), '') AS province,
                COALESCE(BTRIM(c.country), '') AS country,
                COALESCE(BTRIM(c.zip_code), '') AS zip_code,
                '' AS transport_type,
                COALESCE(BTRIM(detail.logistic_area), '') AS logistic_area,
                0 AS latitude,
                0 AS longitude,
                '' AS remark_1,
                '' AS remark_2,
                COALESCE(BTRIM(c.code), '') AS cust_code,
                1 AS source_rank
         FROM ar_customer c
         LEFT JOIN LATERAL (
           SELECT logistic_area
           FROM ar_customer_detail
           WHERE COALESCE(BTRIM(ar_code), '') = COALESCE(BTRIM(c.code), '')
           LIMIT 1
         ) detail ON TRUE
         WHERE $2 <> ''
           AND COALESCE(BTRIM(c.code), '') = $2
           ${customerKeyword}
       ) AS shipping_master
       ORDER BY source_rank, ship_code, name_1
       LIMIT 200`,
      params,
    );
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getContactorList ─────────────────────────────────────
// ดึงรายชื่อผู้ติดต่อทั้งหมด
router.get('/getContactorList', async (req, res) => {
  try {
    const result = await query('SELECT line_number as code, name FROM ar_contactor ORDER BY ar_code, line_number');
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getCustomerContactorList ────────────────────────────
// ดึงรายชื่อผู้ติดต่อของลูกค้าที่ระบุ (cust_code)
router.get('/getCustomerContactorList', async (req, res) => {
  const { cust_code = '' } = req.query;
  try {
    const result = await query(
      'SELECT line_number as code, name FROM ar_contactor WHERE ar_code = $1 ORDER BY line_number',
      [cust_code]
    );
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getSaleGroupList ────────────────────────────────────
// ดึงรายชื่อกลุ่มพนักงาน
router.get('/getSaleGroupList', async (req, res) => {
  try {
    const result = await query('SELECT code, name_1 FROM ar_sale_group ORDER BY code');
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getShipmentTransportTypeList ─────────────────────────
router.get('/getShipmentTransportTypeList', async (req, res) => {
  try {
    const result = await query(
      `SELECT code, name_1
       FROM transport_type
       WHERE code in ('PICK','DELIVER')
       ORDER BY code desc`
    );
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getNextSaleDocumentNo ───────────────────────────────
// ดึงเลขที่เอกสารถัดไปตามรูปแบบเอกสาร
router.get('/getNextSaleDocumentNo', async (req, res) => {
  const { doc_format_code = '' } = req.query;
  try {
    const saleDoc = await resolveSaleDocNo({ query }, doc_format_code, 44);
    return res.json({ success: true, data: saleDoc });
    let nextDocNo = '1';
    if (doc_format_code) {
      // ดึง doc_no ล่าสุด
      const result = await query(
        `SELECT doc_no FROM ic_trans 
         WHERE doc_format_code = $1 AND trans_flag = 44
         ORDER BY doc_date DESC, CAST(doc_time AS TEXT) DESC
         LIMIT 1`,
        [doc_format_code]
      );
      
      if (result.rows?.length > 0) {
        const lastDocNo = result.rows[0].doc_no;
        // ดึงตัวเลขจากท้ายสุด (serial number)
        const match = lastDocNo.match(/(\d+)$/);
        if (match) {
          const serialNum = parseInt(match[1], 10);
          const serialLen = match[1].length;
          const nextSerial = (serialNum + 1).toString().padStart(serialLen, '0');
          // นำส่วนที่ไม่ใช่ตัวเลข + serial ใหม่
          const prefix = lastDocNo.substring(0, lastDocNo.length - match[1].length);
          nextDocNo = prefix + nextSerial;
        } else {
          nextDocNo = '1';
        }
      } else {
        nextDocNo = '1';
      }
    }
    return res.json({ success: true, data: { doc_no: nextDocNo } });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getDashboardTopProducts ────────────────────────────────
// สินค้าขายดีประจำวัน 10 รายการ (จาก ic_trans_detail JOIN ic_trans, trans_flag=44)
router.get('/getDashboardTopProducts', async (req, res) => {
  const { date = '' } = req.query;
  const targetDate = date || new Date().toISOString().slice(0, 10);
  try {
    const result = await query(
      `SELECT d.item_code, d.item_name, d.unit_code,
              SUM(d.qty)::numeric AS total_qty,
              SUM(d.qty * d.price)::numeric AS total_amount
       FROM ic_trans_detail d
       JOIN ic_trans t ON t.doc_no = d.doc_no AND t.trans_flag = 44
       WHERE d.trans_flag = 44
         AND t.doc_date = $1::date
         AND t.last_status = 0
       GROUP BY d.item_code, d.item_name, d.unit_code
       ORDER BY total_qty DESC
       LIMIT 10`,
      [targetDate]
    );
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getDashboardSoldOut ───────────────────────────────────
// สินค้าขายหมด: รายการที่ขายในวันที่เลือก ยอดคงเหลือ (net) - ตะกร้า <= 0
router.get('/getDashboardSoldOut', async (req, res) => {
  const { date = '' } = req.query;
  const targetDate = date || new Date().toISOString().slice(0, 10);
  try {
    const result = await query(
      `WITH sold_today AS (
         SELECT DISTINCT d.item_code
         FROM ic_trans_detail d
         JOIN ic_trans t ON t.doc_no = d.doc_no AND t.trans_flag = 44
         LEFT JOIN ic_inventory inv_sold ON inv_sold.code = d.item_code
         WHERE d.trans_flag = 44
           AND t.doc_date = $1::date
           AND t.last_status = 0
           AND COALESCE(inv_sold.item_type, 0) NOT IN (1, 3)
       ),
       item_code_list AS (
         SELECT string_agg(item_code, ',') AS codes
         FROM sold_today
         WHERE item_code IS NOT NULL
       ),
       stock AS (
         SELECT s.ic_code, SUM(s.balance_qty) AS sum_balance_qty
         FROM item_code_list icl
         CROSS JOIN LATERAL sml_ic_function_stock_balance_warehouse_location(
           current_date, icl.codes, '', ''
         ) s
         GROUP BY s.ic_code
       ),
       cart AS (
         SELECT
           c.item_code,
           SUM(
             c.qty
             * COALESCE(u.stand_value, 1)::numeric
             / NULLIF(COALESCE(u.divide_value, 1), 0)::numeric
           ) AS cart_qty_std
         FROM staff_cart_order c
         LEFT JOIN ic_unit_use u
                ON u.ic_code = c.item_code
               AND u.code    = c.unit_code
         WHERE c.item_code IN (SELECT item_code FROM sold_today)
         GROUP BY c.item_code
       )
       SELECT
         st.item_code,
         COALESCE(inv.name_1, st.item_code)                                    AS item_name,
         COALESCE(stk.sum_balance_qty, 0)::numeric                             AS stock_qty,
         COALESCE(crt.cart_qty_std, 0)::numeric                                AS cart_qty,
         (COALESCE(stk.sum_balance_qty, 0) - COALESCE(crt.cart_qty_std, 0))::numeric AS remaining_qty,
         COALESCE(inv.unit_standard, '')                                        AS unit_code,
         COALESCE(un.name_1, inv.unit_standard, '')                            AS unit_name
       FROM sold_today st
       LEFT JOIN ic_inventory inv ON inv.code = st.item_code
       LEFT JOIN stock stk        ON stk.ic_code = st.item_code
       LEFT JOIN cart crt         ON crt.item_code = st.item_code
       LEFT JOIN ic_unit un       ON un.code = inv.unit_standard
       WHERE (COALESCE(stk.sum_balance_qty, 0) - COALESCE(crt.cart_qty_std, 0)) <= 0
       ORDER BY remaining_qty ASC`,
      [targetDate]
    );
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getDashboardTopCustomers ───────────────────────────────
// ลูกค้าดีเด่นประจำเดือน 5 คน (ยอดสั่งซื้อสูงสุด, trans_flag=44)
router.get('/getDashboardTopCustomers', async (req, res) => {
  try {
    const result = await query(
      `SELECT t.cust_code,
              COALESCE(ar.name_1, t.cust_code) AS cust_name,
              SUM(COALESCE(cb.total_net_amount, t.total_amount))::numeric AS total_amount,
              COUNT(t.doc_no)::int AS total_docs
       FROM ic_trans t
       LEFT JOIN ar_customer ar ON ar.code = t.cust_code
       LEFT JOIN cb_trans cb ON cb.doc_no = t.doc_no AND cb.trans_flag = 44
       WHERE t.trans_flag = 44
         AND t.last_status = 0
         AND t.doc_date >= date_trunc('month', current_date)
         AND t.doc_date <= current_date
         AND t.cust_code IS NOT NULL AND t.cust_code <> ''
       GROUP BY t.cust_code, ar.name_1
       ORDER BY total_amount DESC
       LIMIT 5`
    );
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getDashboardTopSalesmen ────────────────────────────────
// พนักงานขายดีเด่นประจำเดือน 5 คน (ยอดขายสูงสุด, trans_flag=44)
router.get('/getDashboardTopSalesmen', async (req, res) => {
  try {
    const result = await query(
      `SELECT t.sale_code,
              COALESCE(
                (SELECT name_1 FROM erp_user WHERE UPPER(code) = UPPER(t.sale_code) LIMIT 1),
                t.sale_code
              ) AS emp_name,
              SUM(COALESCE(cb.total_net_amount, t.total_amount))::numeric AS total_amount,
              COUNT(t.doc_no)::int AS total_docs
       FROM ic_trans t
       LEFT JOIN cb_trans cb ON cb.doc_no = t.doc_no AND cb.trans_flag = 44
       WHERE t.trans_flag = 44
         AND t.last_status = 0
         AND t.doc_date >= date_trunc('month', current_date)
         AND t.doc_date <= current_date
         AND t.sale_code IS NOT NULL AND t.sale_code <> ''
       GROUP BY t.sale_code
       ORDER BY total_amount DESC
       LIMIT 5`
    );
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getLastDocNo ───────────────────────────────────────────
router.get('/getLastDocNo', async (req, res) => {
  const { pos_id, doc_format_code, trans_flag } = req.query;
  if (!pos_id && !doc_format_code) {
    return res.status(400).json({ success: false, msg: 'pos_id or doc_format_code is required' });
  }

  const tf = parseInt(trans_flag) || 44;
  try {
    let pattern;
    let resolvedDocFormatCode = '';
    if (doc_format_code) {
      const docFormat = await resolveSaleDocFormat({ query }, doc_format_code);
      resolvedDocFormatCode = docFormat.code;
      pattern = buildDocPattern(docFormat.format || '@-YYMM####', docFormat.code);
    } else {
      const posRes = await query('SELECT doc_format FROM pos_id WHERE pos_id=$1 LIMIT 1', [pos_id]);
      if (posRes.rows.length === 0) {
        return res.status(400).json({ success: false, msg: `pos_id not found: ${pos_id}` });
      }
      const docFormat = posRes.rows[0].doc_format || '';
      pattern = buildDocPattern(docFormat, pos_id);
    }

    const firstHash = pattern.indexOf('#');
    let latestRunning = 0;
    let latestDocNo = '';

    if (firstHash >= 0) {
      let runLen = 0;
      while (firstHash + runLen < pattern.length && pattern[firstHash + runLen] === '#') runLen++;

      const likePattern = pattern.replace(/#/g, '_');
      const rows = await query(
        'SELECT doc_no FROM ic_trans WHERE trans_flag=$1 AND char_length(doc_no)=$2 AND doc_no LIKE $3',
        [tf, pattern.length, likePattern]
      );

      for (const row of rows.rows) {
        const docNo = row.doc_no;
        if (!docNo || docNo.length !== pattern.length) continue;
        const runText = docNo.substring(firstHash, firstHash + runLen);
        if (!/^\d+$/.test(runText)) continue;
        const run = parseInt(runText, 10);
        if (run > latestRunning) { latestRunning = run; latestDocNo = docNo; }
      }
    }

    return res.json({
      success: true,
      data: {
        pos_id,
        doc_format_code: resolvedDocFormatCode || doc_format_code || '',
        trans_flag: tf,
        last_doc_no: latestDocNo,
        last_running: latestRunning,
        doc_pattern: pattern,
      },
    });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getPassBookList ───────────────────────────────────────
router.get('/getPassBookList', async (req, res) => {
  try {
    const result = await query(`
      SELECT code, bank_code,
        (SELECT name_1 FROM erp_bank WHERE code = bank_code) AS bank_name,
        bank_branch,
        (SELECT name_1 FROM erp_bank_branch WHERE code = bank_branch) AS branch_name,
        name_1 AS book_name,
        COALESCE(book_number, '') AS book_number,
        COALESCE(currency_code, '') AS currency_code
      FROM erp_pass_book
      WHERE tax_number = '1'
      ORDER BY code
    `);
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getCreditTypeList ─────────────────────────────────────
router.get('/getCreditTypeList', async (req, res) => {
  try {
    const result = await query(`
      SELECT code, name_1,
        COALESCE(charge_rate::text, '') AS charge_rate_word,
        CASE
          WHEN COALESCE(charge_rate::text, '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
          THEN charge_rate::numeric
          ELSE 0
        END AS charge_rate
      FROM erp_credit_type
      ORDER BY code
    `);
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getPaymentMasterLists ─────────────────────────────────
router.get('/getPaymentMasterLists', async (req, res) => {
  try {
    const summaryCurrencyCodes = parseSummaryCurrencyCodes(process.env.SELL_SUMMARY_CURRENCY_CODES);
    const [
      passBooks,
      creditTypes,
      pettyCash,
      incomeList,
      expenseList,
      currencies,
      wallets,
      transportTypes,
      shippingLabels,
      glAccounts,
      optionRows,
    ] = await Promise.all([
        query(`
          SELECT code, bank_code,
            COALESCE((SELECT name_1 FROM erp_bank WHERE code = erp_pass_book.bank_code), '') AS bank_name,
            bank_branch,
            COALESCE((SELECT name_1 FROM erp_bank_branch WHERE code = erp_pass_book.bank_branch AND bank_code = erp_pass_book.bank_code), '') AS branch_name,
            name_1 AS book_name,
            COALESCE(book_number, '') AS book_number,
            COALESCE(currency_code, '') AS currency_code
          FROM erp_pass_book
          WHERE COALESCE(status::text, '0') IN ('0', '') and COALESCE(tax_number::text, '0') IN ('1')
          ORDER BY code
        `),
        query(`
          SELECT code, name_1,
            COALESCE(charge_rate::text, '') AS charge_rate_word,
            CASE
              WHEN COALESCE(charge_rate::text, '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
              THEN charge_rate::numeric
              ELSE 0
            END AS charge_rate,
            COALESCE(use_charge_rate::text, '0') AS use_charge_rate
          FROM erp_credit_type
          ORDER BY code
        `),
        query(`
          SELECT code, name_1, COALESCE(currency_code, '') AS currency_code,
            CASE
              WHEN COALESCE(balance_money::text, '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
              THEN balance_money::numeric
              ELSE 0
            END AS balance_money
          FROM cb_petty_cash
          WHERE COALESCE(status::text, '0') IN ('0', '')
          ORDER BY code
        `),
        query('SELECT code, name_1, COALESCE(gl_account_code, \'\') AS gl_account_code FROM erp_income_list ORDER BY code'),
        query('SELECT code, name_1, COALESCE(gl_account_code, \'\') AS gl_account_code FROM erp_expenses_list ORDER BY code'),
        query(`
          SELECT code, name_1, COALESCE(name_2, '') AS name_2, COALESCE(symbol, '') AS symbol,
            CASE
              WHEN COALESCE(exchange_rate_present::text, '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
              THEN exchange_rate_present::numeric
              ELSE 1
            END AS exchange_rate_present
          FROM erp_currency
          ORDER BY code
        `),
        query(`
          SELECT code, name_1, COALESCE(account_code, '') AS account_code
          FROM erp_wallet_list
          ORDER BY code
        `),
        query(`
          SELECT code, name_1
          FROM transport_type
          WHERE COALESCE(status::text, '0') IN ('0', '')
          ORDER BY code
        `),
        query(`
          SELECT ship_code, name_1, COALESCE(address, '') AS address,
                 COALESCE(telephone, '') AS telephone, COALESCE(fax, '') AS fax,
                 COALESCE(tambon, '') AS tambon, COALESCE(amper, '') AS amper,
                 COALESCE(province, '') AS province, COALESCE(country, '') AS country,
                 COALESCE(zip_code, '') AS zip_code, COALESCE(transport_type, '') AS transport_type,
                 COALESCE(logistic_area, '') AS logistic_area,
                 COALESCE(latitude, 0) AS latitude, COALESCE(longitude, 0) AS longitude,
                 COALESCE(remark_1, '') AS remark_1, COALESCE(remark_2, '') AS remark_2
          FROM ap_ar_transport_label
          WHERE COALESCE(cust_code, '') IN ('', 'AR00001')
          ORDER BY ship_code, name_1
          LIMIT 100
        `),
        query(`
          SELECT code, name_1
          FROM gl_chart_of_account
          WHERE COALESCE(active_status, 1) = 1
            AND COALESCE(status, 0) = 0
          ORDER BY code
          LIMIT 300
        `),
        query(`SELECT COALESCE(multi_currency::text, '0') AS multi_currency,
                      COALESCE(input_credit_card_charge::text, '0') AS input_credit_card_charge,
                      COALESCE(coupon_full_amount::text, '0') AS coupon_full_amount,
             COALESCE(inventory_gl_post::text, '') AS inventory_gl_post,
                      COALESCE(home_currency, '') AS home_currency,
                      COALESCE(currency_exchange_decimal::text, '2') AS currency_exchange_decimal
               FROM erp_option
               LIMIT 1`),
    ]);

    return res.json({
      success: true,
      data: {
        pass_books: passBooks.rows,
        credit_types: creditTypes.rows,
        petty_cash: pettyCash.rows,
        income_list: incomeList.rows,
        expense_list: expenseList.rows,
        currencies: currencies.rows,
        wallets: wallets.rows,
        transport_types: transportTypes.rows,
        shipping_labels: shippingLabels.rows,
        gl_accounts: glAccounts.rows,
        options: optionRows.rows[0] || {
          multi_currency: 0,
          input_credit_card_charge: 0,
          coupon_full_amount: 0,
          inventory_gl_post: '',
          home_currency: '',
          currency_exchange_decimal: 2,
          summary_currency_codes: summaryCurrencyCodes,
        },
        summary_currency_codes: summaryCurrencyCodes,
      },
    });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getCouponList ─────────────────────────────────────────
router.get('/getCouponList', async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const custCode = String(req.query.cust_code || '').trim();
    const docDate = String(req.query.doc_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const totalAmount = asNumber(req.query.total_amount);
    const docNo = String(req.query.doc_no || '').trim();
    const searchLike = `%${search.toUpperCase()}%`;
    const result = await query(
      `WITH coupon_source AS (
         SELECT number,
                CASE
                  WHEN COALESCE(amount::text, '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                  THEN amount::numeric
                  ELSE 0
                END AS amount,
                CASE
                  WHEN COALESCE(balance_amount::text, '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                  THEN balance_amount::numeric
                  WHEN COALESCE(amount::text, '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                  THEN amount::numeric
                  ELSE 0
                END AS balance_amount,
                date, date_expire, COALESCE(last_status::text, '0') AS last_status,
                COALESCE(coupon_type::text, '0') AS coupon_type,
                COALESCE(single_use::text, '0') AS single_use,
                COALESCE(cust_code, '') AS cust_code,
                COALESCE(remark, '') AS remark,
                COALESCE((
                  SELECT SUM(COALESCE(d.amount, d.sum_amount, 0))
                  FROM cb_trans_detail d
                  WHERE d.trans_number = coupon_list.number
                    AND d.doc_type = 9
                    AND COALESCE(d.last_status::text, '0') = '0'
                    AND COALESCE(d.trans_flag, 0) <> 144
                    AND ($5 = '' OR d.doc_no <> $5)
                ), 0) AS used_amount,
                CASE WHEN COALESCE((
                  SELECT doc_no FROM cb_trans_detail
                  WHERE trans_number = coupon_list.number
                    AND doc_type = 9
                    AND COALESCE(last_status::text, '0') = '0'
                    AND COALESCE(trans_flag, 0) <> 144
                    AND ($5 = '' OR doc_no <> $5)
                  LIMIT 1
                ), '') = '' THEN 0 ELSE 1 END AS used_status
         FROM coupon_list
         WHERE ($1 = '' OR UPPER(number) LIKE $2 OR UPPER(COALESCE(remark, '')) LIKE $2)
           AND (COALESCE(cust_code, '') = '' OR COALESCE(cust_code, '') = $3)
           AND COALESCE(last_status::text, '0') = '0'
           AND (date_expire IS NULL OR date_expire >= $4::date)
       )
       SELECT *
       FROM coupon_source
       WHERE NOT (single_use = '1' AND used_status = 1)
       ORDER BY number
      LIMIT 50`,
      [search, searchLike, custCode, docDate, docNo],
    );
    const rows = result.rows.map((row) => {
      const amount = asNumber(row.amount);
      const balanceAmount = asNumber(row.balance_amount, amount);
      const usedAmount = asNumber(row.used_amount);
      const availableAmount = String(row.coupon_type) === '1'
        ? roundMoney(calcDiscount(`${amount}%`, totalAmount))
        : roundMoney(balanceAmount - usedAmount);
      return {
        ...row,
        used_amount: usedAmount,
        available_amount: Math.max(0, availableAmount),
        usable_amount: Math.max(0, availableAmount),
      };
    });
    return res.json({ success: true, data: rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getSaleDepositBalanceList ─────────────────────────────
router.get('/getSaleDepositBalanceList', async (req, res) => {
  try {
    const custCode = String(req.query.cust_code || '').trim();
    if (!custCode) {
      return res.status(400).json({ success: false, msg: 'กรุณาระบุรหัสลูกค้าก่อนเลือกเงินล่วงหน้า' });
    }
    const search = String(req.query.search || '').trim();
    const docDate = String(req.query.doc_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const searchLike = `%${search.toUpperCase()}%`;
    const result = await query(
      `WITH cb_total AS (
        SELECT doc_no, trans_flag, MAX(COALESCE(total_net_amount, 0)) AS total_net_amount
        FROM cb_trans
        GROUP BY doc_no, trans_flag
      ), base AS (
        SELECT t.doc_no, t.doc_date, t.cust_code,
               COALESCE(NULLIF(cb.total_net_amount, 0), t.total_amount, 0) AS total_amount,
               CASE
                 WHEN COALESCE(t.currency_code, '') <> '' THEN COALESCE(NULLIF(t.total_value_2, 0), COALESCE(NULLIF(cb.total_net_amount, 0), t.total_amount, 0))
                 ELSE COALESCE(NULLIF(cb.total_net_amount, 0), t.total_amount, 0)
               END AS currency_total_amount,
               COALESCE(t.currency_code, '') AS currency_code,
               COALESCE(NULLIF(t.exchange_rate, 0), 1) AS exchange_rate,
               COALESCE((
                 SELECT SUM(total_amount)
                 FROM ic_trans r
                 WHERE r.doc_ref = t.doc_no
                   AND COALESCE(r.last_status::text, '0') = '0'
                   AND r.trans_flag IN (42)
               ), 0) +
               COALESCE((
                 SELECT SUM(amount)
                 FROM cb_trans_detail d
                 WHERE d.trans_number = t.doc_no
                   AND d.doc_type = 5
                   AND COALESCE(d.last_status::text, '0') = '0'
                   AND d.trans_flag <> 144
               ), 0) AS use_amount
        FROM ic_trans t
        LEFT JOIN cb_total cb ON cb.doc_no = t.doc_no AND cb.trans_flag = t.trans_flag
        WHERE COALESCE(t.last_status::text, '0') = '0'
          AND t.trans_flag IN (40, 9040)
          AND t.cust_code = $1
          AND ($2 = '' OR UPPER(t.doc_no) LIKE $3)
          AND t.doc_date <= $4::date
      )
      SELECT doc_no, doc_date, cust_code, total_amount AS amount, use_amount,
             total_amount - use_amount AS balance_amount,
             currency_total_amount - use_amount AS currency_amount,
             currency_total_amount, currency_code, exchange_rate
      FROM base
      WHERE total_amount - use_amount <> 0
      ORDER BY doc_date, doc_no
      LIMIT 50`,
      [custCode, search, searchLike, docDate],
    );
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getSaleDepositMoneyBalanceList ────────────────────────
router.get('/getSaleDepositMoneyBalanceList', async (req, res) => {
  try {
    const custCode = String(req.query.cust_code || '').trim();
    if (!custCode) {
      return res.status(400).json({ success: false, msg: 'กรุณาระบุรหัสลูกค้าก่อนเลือกเงินมัดจำ' });
    }
    const search = String(req.query.search || '').trim();
    const docDate = String(req.query.doc_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const searchLike = `%${search.toUpperCase()}%`;
    const result = await query(
      `WITH cb_total AS (
        SELECT doc_no, trans_flag, MAX(COALESCE(total_net_amount, 0)) AS total_net_amount
        FROM cb_trans
        GROUP BY doc_no, trans_flag
      ), base AS (
        SELECT t.doc_no, t.doc_date, t.cust_code,
               COALESCE(NULLIF(cb.total_net_amount, 0), t.total_amount, 0) AS total_amount,
               CASE
                 WHEN COALESCE(t.currency_code, '') <> '' THEN COALESCE(NULLIF(t.total_value_2, 0), COALESCE(NULLIF(cb.total_net_amount, 0), t.total_amount, 0))
                 ELSE COALESCE(NULLIF(cb.total_net_amount, 0), t.total_amount, 0)
               END AS currency_total_amount,
               COALESCE(t.currency_code, '') AS currency_code,
               COALESCE(NULLIF(t.exchange_rate, 0), 1) AS exchange_rate,
               COALESCE((
                 SELECT SUM(total_amount)
                 FROM ic_trans r
                 WHERE r.doc_ref = t.doc_no
                   AND COALESCE(r.last_status::text, '0') = '0'
                   AND r.trans_flag IN (112)
               ), 0) +
               COALESCE((
                 SELECT SUM(amount)
                 FROM cb_trans_detail d
                 WHERE d.trans_number = t.doc_no
                   AND d.doc_type = 6
                   AND COALESCE(d.last_status::text, '0') = '0'
                   AND d.trans_flag <> 144
               ), 0) AS use_amount
        FROM ic_trans t
        LEFT JOIN cb_total cb ON cb.doc_no = t.doc_no AND cb.trans_flag = t.trans_flag
        WHERE COALESCE(t.last_status::text, '0') = '0'
          AND t.trans_flag IN (110, 9110)
          AND t.cust_code = $1
          AND ($2 = '' OR UPPER(t.doc_no) LIKE $3)
          AND t.doc_date <= $4::date
      )
      SELECT doc_no, doc_date, cust_code, total_amount AS amount, use_amount,
             total_amount - use_amount AS balance_amount,
             currency_total_amount - use_amount AS currency_amount,
             currency_total_amount, currency_code, exchange_rate
      FROM base
      WHERE total_amount - use_amount <> 0
      ORDER BY doc_date, doc_no
      LIMIT 50`,
      [custCode, search, searchLike, docDate],
    );
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

function getPromotionRows(obj) {
  const rows = obj.promotion_detail
    ?? obj.promotion_details
    ?? obj.promotion_product_rows
    ?? obj.promotions
    ?? [];
  return Array.isArray(rows) ? rows : [];
}

function getPromotionValue(row, ...keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key];
  }
  return undefined;
}

const tableColumnCache = new Map();

async function getTableColumnSet(client, tableName) {
  if (tableColumnCache.has(tableName)) return tableColumnCache.get(tableName);
  const result = await client.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [tableName],
  );
  const columns = new Set(result.rows.map((row) => row.column_name));
  tableColumnCache.set(tableName, columns);
  return columns;
}

async function insertExistingColumns(client, tableName, data) {
  const tableColumns = await getTableColumnSet(client, tableName);
  const insertData = { ...data };
  // Keep serial columns owned by PostgreSQL, matching the C# save flow.
  delete insertData.roworder;
  delete insertData.row_number;
  if (tableColumns.has('create_date_time_now') && (insertData.create_date_time_now === undefined || insertData.create_date_time_now instanceof Date)) {
    insertData.create_date_time_now = bangkokTimestamp(insertData.create_date_time_now);
  }
  const columns = Object.keys(insertData).filter((column) => tableColumns.has(column) && insertData[column] !== undefined);
  if (columns.length === 0) return;
  const values = columns.map((column) => insertData[column]);
  const params = columns.map((_, index) => `$${index + 1}`);
  await client.query(
    `INSERT INTO ${tableName} (${columns.join(',')}) VALUES (${params.join(',')})`,
    values,
  );
}

function assertSafeTableIdentifier(tableName) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(String(tableName || ''))) {
    throw new Error(`unsafe table name: ${tableName}`);
  }
}

async function ensureRoworderSequenceAhead(client, tableName) {
  assertSafeTableIdentifier(tableName);
  const tableColumns = await getTableColumnSet(client, tableName);
  if (!tableColumns.has('roworder')) return;

  const seqResult = await client.query(
    "SELECT pg_get_serial_sequence($1, 'roworder') AS seq_name",
    [`public.${tableName}`],
  );
  const seqName = asText(seqResult.rows[0]?.seq_name);
  if (!seqName) return;

  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`roworder-seq:${seqName}`]);
  const [maxResult, seqStateResult] = await Promise.all([
    client.query(`SELECT COALESCE(MAX(roworder),0)::bigint AS max_value FROM ${tableName}`),
    client.query(`SELECT last_value::bigint AS last_value, is_called FROM ${seqName}`),
  ]);
  const maxValue = Number(maxResult.rows[0]?.max_value || 0);
  const lastValue = Number(seqStateResult.rows[0]?.last_value || 0);
  const isCalled = seqStateResult.rows[0]?.is_called === true;
  const nextValue = isCalled ? lastValue + 1 : lastValue;
  if (nextValue <= maxValue) {
    await client.query('SELECT setval($1::regclass, $2::bigint, false)', [seqName, maxValue + 1]);
  }
}

async function ensureSaleSaveRoworderSequences(client) {
  const tables = [
    'ic_trans',
    'ic_trans_detail',
    'ic_trans_detail_promotion',
    'ic_trans_shipment',
    'cb_trans',
    'cb_trans_detail',
    'gl_journal_vat_sale',
    'gl_wht_list',
    'gl_wht_list_detail',
    'gl_trans',
    'gl_trans_detail',
  ];
  for (const tableName of tables) {
    if (await tableExists(client, tableName)) await ensureRoworderSequenceAhead(client, tableName);
  }
}

async function deleteExistingTableRows(client, tableName, whereSql, values) {
  const tableColumns = await getTableColumnSet(client, tableName);
  if (tableColumns.size === 0) return;
  await client.query(`DELETE FROM ${tableName} WHERE ${whereSql}`, values);
}

async function deleteSaleDocumentRows(client, tableName, docNo, transFlag = 44) {
  assertSafeTableIdentifier(tableName);
  const tableColumns = await getTableColumnSet(client, tableName);
  if (!tableColumns.has('doc_no')) return;
  const clauses = ['doc_no = $1'];
  const values = [docNo];
  if (tableColumns.has('trans_flag')) {
    clauses.push(`trans_flag = $${values.length + 1}`);
    values.push(transFlag);
  }
  await client.query(`DELETE FROM ${tableName} WHERE ${clauses.join(' AND ')}`, values);
}

async function deleteSaleDocumentSetForEdit(client, docNo) {
  const tables = [
    'gl_trans_detail',
    'gl_trans',
    'gl_wht_list_detail',
    'gl_wht_list',
    'gl_journal_vat_sale',
    'ic_trans_shipment',
    'ic_trans_detail_promotion',
    'ic_trans_serial_number',
    'ic_trans_detail_department',
    'ic_trans_detail_project',
    'ic_trans_detail_allocate',
    'ic_trans_detail_jobs',
    'ic_trans_detail_site',
    'ap_ar_trans_detail',
    'cb_trans_detail',
    'cb_trans',
    'ic_qc_lab_transaction',
    'ic_trans_detail',
    'ic_trans',
  ];
  for (const tableName of tables) {
    if (await tableExists(client, tableName)) {
      await deleteSaleDocumentRows(client, tableName, docNo, 44);
    }
  }
}

async function loadSaleDocumentForEditGuard(client, docNo) {
  const columns = await getTableColumnSet(client, 'ic_trans');
  const optionalNumber = (column) => (columns.has(column) ? `COALESCE(${column}, 0)::numeric AS ${column}` : `0::numeric AS ${column}`);
  const result = await client.query(
     `SELECT doc_no,
            ${optionalNumber('used_status')},
            ${optionalNumber('used_status_2')},
            ${optionalNumber('doc_success')},
            ${optionalNumber('last_status')},
            ${optionalNumber('is_doc_copy')},
            ${columns.has('creator_code') ? "COALESCE(creator_code, '') AS creator_code" : "'' AS creator_code"},
            ${columns.has('create_datetime') ? 'create_datetime' : 'NULL::timestamp AS create_datetime'}
     FROM ic_trans
     WHERE trans_flag = 44 AND doc_no = $1
     LIMIT 1`,
    [docNo],
  );
  return result.rows[0] || null;
}

function assertSaleDocumentCanEdit(existingDoc, docNo) {
  if (!existingDoc) throw userValidationError(`ไม่พบเอกสารขาย ${docNo} สำหรับแก้ไข`);
  if (asNumber(existingDoc.used_status) === 1) throw userValidationError(`เอกสาร ${docNo} ถูกอ้างอิงแล้ว ไม่สามารถแก้ไขได้`);
  if (asNumber(existingDoc.used_status_2) === 1) throw userValidationError(`เอกสาร ${docNo} ถูกใช้งานแล้ว ไม่สามารถแก้ไขได้`);
  if (asNumber(existingDoc.doc_success) === 1) throw userValidationError(`เอกสาร ${docNo} ปิดงานแล้ว ไม่สามารถแก้ไขได้`);
  if (asNumber(existingDoc.last_status) === 1) throw userValidationError(`เอกสาร ${docNo} ถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้`);
  if (asNumber(existingDoc.is_doc_copy) === 1) throw userValidationError(`เอกสาร ${docNo} เป็นเอกสารออกแทน ไม่สามารถแก้ไขได้`);
}

async function tableExists(client, tableName) {
  const result = await client.query('SELECT to_regclass($1) AS table_name', [`public.${tableName}`]);
  return !!result.rows[0]?.table_name;
}

function asText(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function asNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundMoney(value, precision = 2) {
  const number = asNumber(value);
  const multiplier = Math.pow(10, precision);
  return Math.round(number * multiplier) / multiplier;
}


function normalizeDateString(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function userValidationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function salePolicyValidationError({ message, details = [], errors = [], warnings = [] } = {}) {
  const error = userValidationError(message || 'Sale item policy validation failed');
  error.code = 'SALE_ITEM_POLICY_BLOCKED';
  error.details = Array.isArray(details) ? details.filter(Boolean) : [];
  error.policyErrors = Array.isArray(errors) ? errors : [];
  error.policyWarnings = Array.isArray(warnings) ? warnings : [];
  return error;
}

function stockValidationError(issue = {}) {
  const detail = issue.message || `Insufficient stock: ${issue.item_code || ''}`.trim();
  const error = userValidationError(detail || 'Insufficient stock');
  error.code = 'STOCK_INSUFFICIENT';
  error.details = [detail].filter(Boolean);
  error.stockIssues = [issue];
  return error;
}

function saleConfirmations(obj) {
  const list = Array.isArray(obj.credit_confirmations) ? obj.credit_confirmations : [];
  const confirmations = new Set(list.map((value) => asText(value)));
  if (obj.overdue_warning_confirmed === true || obj.overdue_warning_confirmed === 1 || obj.overdue_warning_confirmed === '1') {
    confirmations.add('overdue_warning');
  }
  if (obj.credit_warning_confirmed === true || obj.credit_warning_confirmed === 1 || obj.credit_warning_confirmed === '1') {
    confirmations.add('credit_over_limit_warning');
  }
  return confirmations;
}

function saleValidationResponse({
  code,
  level = 'error',
  requireConfirm = '',
  title = '',
  message = '',
  details = [],
  extra = {},
}) {
  return {
    success: false,
    code,
    level,
    require_confirm: requireConfirm,
    title,
    msg: message,
    message,
    details: Array.isArray(details) ? details.filter(Boolean) : [],
    ...extra,
  };
}

function firstPaymentValue(row, ...keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
  }
  return undefined;
}

function resolvePaymentDocType(row) {
  const explicitDocType = firstPaymentValue(row, 'doc_type', 'docType');
  if (explicitDocType !== undefined) {
    const docType = parseInt(explicitDocType, 10);
    if (Number.isFinite(docType)) return docType;
  }

  const rawType = asText(firstPaymentValue(row, 'type', 'kind', 'payment_type', 'paymentType', 'pay_type'));
  const normalizedType = rawType.toLowerCase().replace(/[-\s]/g, '_');
  const aliases = {
    '0': 1,
    transfer: 1,
    bank_transfer: 1,
    cheque: 2,
    check: 2,
    chq: 2,
    '2': 2,
    credit: 3,
    card: 3,
    credit_card: 3,
    '21': 3,
    petty_cash: 4,
    petty: 4,
    '4': 4,
    deposit: 5,
    advance: 5,
    deposit_advance: 5,
    '5': 5,
    deposit_money: 6,
    earnest: 6,
    sale_deposit: 6,
    '6': 6,
    coupon: 9,
    '9': 9,
    expense: 11,
    expense_other: 11,
    other_expense: 11,
    '11': 11,
    income: 12,
    income_other: 12,
    other_income: 12,
    '12': 12,
    other_currency: 19,
    currency: 19,
    foreign_currency: 19,
    '19': 19,
    wallet: 21,
    ewallet: 21,
    e_wallet: 21,
  };
  return aliases[normalizedType] || 0;
}

function getPaymentBaseAmount(row) {
  if (row.doc_type === 19) return row.sum_amount || row.amount;
  if (row.doc_type === 3 && row.sum_amount_2) return row.sum_amount_2;
  if (row.sum_amount_2) return row.sum_amount_2;
  if (row.doc_type === 3) return row.sum_amount || (row.amount + row.charge);
  return row.amount || row.sum_amount || 0;
}

function normalizePromotionPayment(row, lineNumber) {
  const source = row || {};
  const docType = resolvePaymentDocType(source);
  if (!docType) return null;

  const payAmount = asNumber(firstPaymentValue(source, 'amount', 'pay_amount', 'sum_pay_money', 'value'));
  const charge = asNumber(firstPaymentValue(source, 'charge', 'fee', 'credit_charge'));
  const exchangeRate = asNumber(firstPaymentValue(source, 'exchange_rate', 'rate'), 1);
  let sumAmount = asNumber(firstPaymentValue(source, 'sum_amount', 'sumAmount'), 0);
  if (sumAmount === 0) {
    if (docType === 3) sumAmount = payAmount + charge;
    else if (docType === 19) sumAmount = payAmount * exchangeRate;
    else sumAmount = payAmount;
  }

  const sumAmount2 = asNumber(firstPaymentValue(source, 'sum_amount_2', 'sumAmount2'), 0);
  const amount2 = asNumber(firstPaymentValue(source, 'amount_2', 'amount2'), 0);
  const charge2 = asNumber(firstPaymentValue(source, 'charge_2', 'charge2'), 0);
  const exchangeRateOld = asNumber(firstPaymentValue(source, 'exchange_rate_old', 'exchangeRateOld'), 0);
  const lostProfitExchangeAmount = asNumber(firstPaymentValue(source, 'lost_profit_exchange_amount', 'lostProfitExchangeAmount'), 0);
  const transNumber = asText(firstPaymentValue(
    source,
    'trans_number',
    'transNumber',
    'pass_book_code',
    'book_code',
    'card_number',
    'credit_card_no',
    'coupon_no',
    'coupon_code',
    'code',
  ));

  return {
    doc_type: docType,
    line_number: asNumber(firstPaymentValue(source, 'line_number', 'lineNumber'), lineNumber),
    trans_number: transNumber,
    amount: payAmount,
    sum_amount: sumAmount,
    charge,
    bank_code: asText(firstPaymentValue(source, 'bank_code', 'bankCode')),
    bank_branch: asText(firstPaymentValue(source, 'bank_branch', 'bankBranch')),
    pass_book_code: asText(firstPaymentValue(source, 'pass_book_code', 'book_code')),
    credit_card_type: asText(firstPaymentValue(source, 'credit_card_type', 'creditCardType')),
    no_approved: asText(firstPaymentValue(source, 'no_approved', 'approval_no', 'approve_no')),
    ref1: asText(firstPaymentValue(source, 'ref1', 'reference_1')),
    ref2: asText(firstPaymentValue(source, 'ref2', 'reference_2')),
    doc_ref: asText(firstPaymentValue(source, 'doc_ref', 'ref_doc_no', 'refDocNo')),
    doc_date_ref: asText(firstPaymentValue(source, 'doc_date_ref', 'ref_date', 'deposit_date')),
    chq_due_date: asText(firstPaymentValue(source, 'chq_due_date', 'transfer_date', 'cheque_date', 'due_date')),
    balance_amount: asNumber(firstPaymentValue(source, 'balance_amount', 'balance')),
    description: asText(firstPaymentValue(source, 'description', 'name_1', 'name')),
    remark: asText(firstPaymentValue(source, 'remark', 'note')),
    currency_code: asText(firstPaymentValue(source, 'currency_code', 'currency')),
    exchange_rate: exchangeRate,
    sum_amount_2: sumAmount2,
    amount_2: amount2,
    charge_2: charge2,
    exchange_rate_old: exchangeRateOld,
    lost_profit_exchange_amount: lostProfitExchangeAmount,
    trans_number_type: asNumber(firstPaymentValue(source, 'trans_number_type', 'transNumberType')),
    ap_ar_type: asNumber(firstPaymentValue(source, 'ap_ar_type', 'apArType')),
    chq_on_hand: asNumber(firstPaymentValue(source, 'chq_on_hand', 'chqOnHand')),
  };
}

function normalizePromotionPayments(payments) {
  return payments
    .map((payment, index) => normalizePromotionPayment(payment, index))
    .filter((payment) => payment && (payment.trans_number || payment.amount !== 0 || payment.sum_amount !== 0));
}

function sumPaymentRows(payments, docType, selector) {
  return payments
    .filter((payment) => payment.doc_type === docType)
    .reduce((sum, payment) => sum + selector(payment), 0);
}

function buildPromotionPaymentSummary({ payments, totalAmount, roundedAmount, cashAmountRaw, payCashAmountRaw = 0, obj }) {
  const totalCreditCharge = sumPaymentRows(payments, 3, (payment) => payment.charge_2 || payment.charge) || asNumber(obj.total_credit_charge);
  const tranferAmount = sumPaymentRows(payments, 1, getPaymentBaseAmount) || asNumber(obj.tranfer_amount);
  const chqAmount = sumPaymentRows(payments, 2, getPaymentBaseAmount) || asNumber(obj.chq_amount);
  const cardAmount = sumPaymentRows(payments, 3, getPaymentBaseAmount)
    || (asNumber(obj.card_amount) + totalCreditCharge);
  const pettyCashAmount = sumPaymentRows(payments, 4, getPaymentBaseAmount) || asNumber(obj.petty_cash_amount);
  const hasDepositRows = payments.some((payment) => [5, 6].includes(asNumber(payment.doc_type)));
  const depositAmount = hasDepositRows
    ? sumPaymentRows(payments, 5, (payment) => payment.amount)
    : asNumber(obj.deposit_amount);
  const saleAdvanceAmount = hasDepositRows
    ? sumPaymentRows(payments, 6, (payment) => payment.amount)
    : asNumber(obj.advance_amount);
  const couponAmount = sumPaymentRows(payments, 9, (payment) => payment.amount) || asNumber(obj.coupon_amount);
  const totalExpenseOther = sumPaymentRows(payments, 11, (payment) => payment.amount) || asNumber(obj.total_expense_other);
  const totalIncomeOther = sumPaymentRows(payments, 12, (payment) => payment.amount) || asNumber(obj.total_income_other);
  const totalExpenseOtherForSave = totalExpenseOther + totalIncomeOther;
  const totalOtherCurrency = sumPaymentRows(payments, 19, (payment) => payment.sum_amount || payment.amount) || asNumber(obj.total_other_currency);
  const totalOtherCurrencyCharge = sumPaymentRows(payments, 19, (payment) => payment.charge) || asNumber(obj.total_other_currency_charge);
  const walletAmount = sumPaymentRows(payments, 21, (payment) => payment.amount || payment.sum_amount) || asNumber(obj.wallet_amount);
  const totalIncomeAmount = asNumber(obj.total_income_amount, 0);
  const totalTaxAtPay = asNumber(obj.total_tax_at_pay);
  const pointAmount = asNumber(obj.point_amount);
  const discountAmount = asNumber(obj.discount_amount);

  const totalDepositCutAmount = roundMoney(depositAmount + saleAdvanceAmount);
  if (roundMoney(totalDepositCutAmount - totalAmount) > 0) {
    throw userValidationError(`ยอดตัดเงินมัดจำ/เงินล่วงหน้า ${totalDepositCutAmount.toFixed(2)} ต้องไม่เกินยอดขาย ${totalAmount.toFixed(2)}`);
  }

  const payableAmount = roundMoney(Math.max(0, totalAmount - totalDepositCutAmount));
  const totalNetAmount = payableAmount + totalCreditCharge + totalIncomeOther;
  const nonDepositPay =
    pettyCashAmount +
    totalIncomeAmount +
    totalTaxAtPay +
    chqAmount +
    cardAmount +
    tranferAmount +
    pointAmount +
    discountAmount +
    couponAmount +
    totalExpenseOther +
    totalOtherCurrency +
    walletAmount +
    totalOtherCurrencyCharge;
  const nonCashOverpay = roundMoney(nonDepositPay - totalNetAmount);
  if (nonCashOverpay > 0) {
    throw userValidationError(`ยอดชำระที่ไม่ใช่เงินสดเกินยอดสุทธิ ${nonCashOverpay.toFixed(2)}: เงินทอนต้องมาจากเงินสดเท่านั้น`);
  }
  const cashAmount = roundMoney(cashAmountRaw > 0
    ? Math.max(0, Math.min(cashAmountRaw, totalNetAmount - nonDepositPay))
    : 0);
  const payCashAmountInput = asNumber(payCashAmountRaw, asNumber(obj.pay_cash_amount));
  const payCashAmount = roundMoney(payCashAmountInput > 0
    ? payCashAmountInput
    : (cashAmountRaw > cashAmount ? cashAmountRaw : 0));
  const moneyChange = payCashAmount > 0 ? roundMoney(payCashAmount - cashAmount) : 0;

  return {
    total_amount: payableAmount,
    total_net_amount: totalNetAmount,
    cash_amount: cashAmount,
    tranfer_amount: tranferAmount,
    card_amount: cardAmount,
    total_amount_pay: cashAmount + nonDepositPay,
    total_credit_charge: totalCreditCharge,
    wallet_amount: walletAmount,
    total_income_amount: totalIncomeAmount,
    pay_cash_amount: payCashAmount,
    money_change: moneyChange,
    chq_amount: chqAmount,
    petty_cash_amount: pettyCashAmount,
    deposit_amount: depositAmount,
    ic_advance_amount: saleAdvanceAmount,
    coupon_amount: couponAmount,
    total_tax_at_pay: totalTaxAtPay,
    total_income_other: 0,
    total_expense_other: totalExpenseOtherForSave,
    total_other_currency: totalOtherCurrency,
    total_other_currency_charge: totalOtherCurrencyCharge,
    point_amount: pointAmount,
    discount_amount: discountAmount,
  };
}

function calculatePaymentCharge(amount, chargeRateValue) {
  const word = asText(chargeRateValue);
  if (!word) return 0;
  const number = asNumber(word.replace('%', ''));
  if (number === 0) return 0;
  return word.includes('%')
    ? roundMoney(amount * (number / 100))
    : roundMoney(number);
}

function unitRatioValue(item = {}) {
  const explicitRatio = asNumber(item.ratio);
  if (explicitRatio > 0) return explicitRatio;
  const standValue = asNumber(item.stand_value, 1);
  const divideValue = asNumber(item.divide_value, 1);
  return standValue / (divideValue || 1);
}

function buildStockValidationGroups(items = [], balanceControlType = 2) {
  const groups = new Map();
  const level = Math.max(0, Math.min(2, parseInt(balanceControlType, 10) || 0));
  for (const item of items) {
    const itemCode = asText(item?.item_code);
    if (!itemCode || itemCode === '.') continue;

    const itemType = asNumber(item?.item_type);
    // service/set header rows do not deduct direct stock here
    if (itemType === 1 || itemType === 3) continue;

    const qty = asNumber(item?.qty);
    if (qty <= 0) continue;

    const ratio = unitRatioValue(item);
    const requestedBase = qty * ratio;
    if (requestedBase <= 0) continue;

    const whCode = level >= 1 ? asText(item?.wh_code) : '';
    const shelfCode = level >= 2 ? asText(item?.shelf_code) : '';
    const key = `${itemCode}|${whCode}|${shelfCode}`;
    const current = groups.get(key) || { itemCode, whCode, shelfCode, requestedBase: 0 };
    current.requestedBase += requestedBase;
    groups.set(key, current);
  }
  return [...groups.values()];
}

async function getStockBalanceBaseQty(client, { itemCode, whCode, shelfCode, docDate }) {
  const targetDate = normalizeDateString(docDate) || new Date().toISOString().slice(0, 10);
  const result = await client.query(
    `SELECT COALESCE(SUM(balance_qty), 0)::numeric AS balance_qty
     FROM sml_ic_function_stock_balance_warehouse_location(
       $1::date,
       $2,
       $3,
       $4
     )`,
    [targetDate, itemCode, whCode || '', shelfCode || ''],
  );
  return asNumber(result.rows[0]?.balance_qty);
}

async function loadNegativeStockAllowedItemCodes(client, itemCodes = []) {
  const codes = [...new Set(itemCodes.map((code) => asText(code)).filter(Boolean))];
  if (!codes.length || !(await tableExists(client, 'ic_inventory_detail'))) return new Set();
  const columns = await getTableColumnSet(client, 'ic_inventory_detail');
  if (!columns.has('ic_code') || !columns.has('balance_control')) return new Set();
  const result = await client.query(
    `SELECT DISTINCT ic_code
     FROM ic_inventory_detail
     WHERE ic_code = ANY($1::text[])
       AND COALESCE(balance_control, 0)::numeric = 1`,
    [codes],
  );
  return new Set(result.rows.map((row) => asText(row.ic_code)).filter(Boolean));
}

async function validateStockBeforeSave(client, { items, docDate, balanceControlType = 2 }) {
  const groups = buildStockValidationGroups(items, balanceControlType);
  const allowedNegativeItems = await loadNegativeStockAllowedItemCodes(client, groups.map((group) => group.itemCode));
  for (const group of groups) {
    if (allowedNegativeItems.has(group.itemCode)) continue;
    const availableBase = await getStockBalanceBaseQty(client, {
      itemCode: group.itemCode,
      whCode: group.whCode,
      shelfCode: group.shelfCode,
      docDate,
    });
    if (group.requestedBase > availableBase) {
      const issue = {
        item_code: group.itemCode,
        wh_code: group.whCode,
        shelf_code: group.shelfCode,
        available_qty: roundMoney(availableBase),
        requested_qty: roundMoney(group.requestedBase),
      };
      issue.message = `สต๊อกสินค้าไม่พอ ${issue.item_code} (WH:${issue.wh_code || '-'} SHELF:${issue.shelf_code || '-'}) คงเหลือ ${issue.available_qty} ต้องการ ${issue.requested_qty}`;
      throw stockValidationError(issue);
      throw userValidationError(
        `สต๊อกสินค้าไม่พอ ${group.itemCode} (WH:${group.whCode || '-'} SHELF:${group.shelfCode || '-'}) คงเหลือ ${roundMoney(availableBase)} ต้องการ ${roundMoney(group.requestedBase)}`,
      );
    }
  }
}

async function validateItemExpirationBeforeSave(client, { items, docDate, enabled }) {
  if (!enabled) return;
  if (!(await tableExists(client, 'ic_inventory'))) return;

  const itemCodes = [...new Set((Array.isArray(items) ? items : [])
    .map((item) => asText(item?.item_code))
    .filter((code) => code && code !== '.'))];
  if (!itemCodes.length) return;

  const columns = await getTableColumnSet(client, 'ic_inventory');
  const expireColumn = ['date_expire', 'expire_date', 'date_expired'].find((column) => columns.has(column));
  if (!expireColumn) return;

  const targetDate = normalizeDateString(docDate) || new Date().toISOString().slice(0, 10);
  const result = await client.query(
    `SELECT code, COALESCE(name_1, code) AS name_1,
            CASE
              WHEN COALESCE(${expireColumn}::text, '') ~ '^\\d{4}-\\d{2}-\\d{2}$'
              THEN ${expireColumn}::date::text
              ELSE ''
            END AS expire_date
     FROM ic_inventory
     WHERE code = ANY($1::text[])
       AND COALESCE(${expireColumn}::text, '') ~ '^\\d{4}-\\d{2}-\\d{2}$'
       AND ${expireColumn}::date < $2::date
     ORDER BY code
     LIMIT 5`,
    [itemCodes, targetDate],
  );
  if (!result.rows.length) return;

  const detail = result.rows
    .map((row) => `${asText(row.code)} (${asText(row.name_1)}) หมดอายุ ${normalizeDateString(row.expire_date)}`)
    .join(', ');
  throw userValidationError(`พบสินค้าหมดอายุในเอกสาร: ${detail}`);
}

async function loadCurrency(client, code) {
  const currencyCode = asText(code);
  if (!currencyCode) return null;
  const result = await client.query(
    `SELECT code, COALESCE(name_1, '') AS name_1,
            CASE
              WHEN COALESCE(exchange_rate_present::text, '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
              THEN exchange_rate_present::numeric
              ELSE 0
            END AS exchange_rate_present
     FROM erp_currency
     WHERE code = $1
     LIMIT 1`,
    [currencyCode],
  );
  return result.rows[0] || null;
}

async function validateCashCurrencyEntries(client, cashEntries, { totalCashAmount, options }) {
  const entries = Array.isArray(cashEntries) ? cashEntries : [];
  if (!entries.length) return roundMoney(asNumber(totalCashAmount));

  let normalizedTotal = 0;
  for (const entry of entries) {
    const homeCode = homeCurrencyCode(options);
    const currencyCode = normalizeCurrencyCode(entry.currency_code, homeCode);
    const foreignAmount = asNumber(entry.currency_amount, asNumber(entry.amount));

    if (!currencyCode || currencyCode === homeCode) {
      const homeAmount = roundMoney(asNumber(entry.amount, foreignAmount));
      normalizedTotal += homeAmount;
      entry.currency_code = homeCode;
      entry.exchange_rate = 1;
      entry.amount = homeAmount;
      entry.currency_amount = foreignAmount > 0 ? foreignAmount : homeAmount;
      continue;
    }

    if (!options?.multi_currency && currencyCode !== 'THB') {
      throw userValidationError('ยังไม่ได้เปิดใช้งานระบบหลายสกุลเงิน');
    }

    if (homeCode === 'LAK' && currencyCode !== 'THB') {
      throw userValidationError(`Cash currency must be LAK/KIP or THB (${currencyCode})`);
    }

    const currency = await loadCurrency(client, currencyCode);
    if (!currency) throw userValidationError(`ไม่พบสกุลเงิน ${currencyCode}`);
    const masterRate = asNumber(currency.exchange_rate_present);
    const inputRate = asNumber(entry.exchange_rate);
    const resolvedRate = inputRate > 0 && (inputRate !== 1 || masterRate === 1) ? inputRate : masterRate;
    if (resolvedRate <= 0) throw userValidationError(`สกุลเงิน ${currencyCode} ยังไม่มีอัตราแลกเปลี่ยน`);
    if (foreignAmount <= 0) throw userValidationError(`จำนวนเงินสดสกุล ${currencyCode} ต้องมากกว่า 0`);

    const homeAmount = roundMoney(convertCurrencyToHome(foreignAmount, resolvedRate, options, currencyCode));
    normalizedTotal += homeAmount;
    entry.currency_code = currencyCode;
    entry.exchange_rate = resolvedRate;
    entry.currency_amount = foreignAmount;
    entry.amount = homeAmount;
  }

  normalizedTotal = roundMoney(normalizedTotal);
  const declaredTotal = roundMoney(asNumber(totalCashAmount));
  if (Math.abs(normalizedTotal - declaredTotal) > 0.01) {
    throw userValidationError(`ยอดเงินสดรวมไม่ตรงกับรายละเอียดสกุลเงิน (${normalizedTotal.toFixed(2)} != ${declaredTotal.toFixed(2)})`);
  }
  return normalizedTotal;
}

async function applyCurrencyAmount(client, payment, codeValue = payment.currency_code) {
  const code = asText(codeValue);
  if (!code) return;
  const currency = await loadCurrency(client, code);
  if (!currency) throw userValidationError(`ไม่พบสกุลเงิน ${code}`);
  const masterRate = asNumber(currency.exchange_rate_present);
  const inputRate = asNumber(payment.exchange_rate);
  const exchangeRate = inputRate > 0 && (inputRate !== 1 || masterRate === 1) ? inputRate : masterRate;
  if (exchangeRate <= 0) throw userValidationError(`สกุลเงิน ${code} ยังไม่มีอัตราแลกเปลี่ยน`);
  payment.currency_code = code;
  payment.exchange_rate = exchangeRate;
  const sourceAmount = asNumber(payment.sum_amount, asNumber(payment.amount));
  payment.sum_amount = sourceAmount;
  payment.sum_amount_2 = roundMoney(sourceAmount * exchangeRate);
}

async function applyCardCurrencyAmount(client, payment) {
  const code = asText(payment.currency_code);
  let exchangeRate = asNumber(payment.exchange_rate, 1) || 1;
  if (code) {
    const currency = await loadCurrency(client, code);
    if (!currency) throw userValidationError(`ไม่พบสกุลเงิน ${code}`);
    const masterRate = asNumber(currency.exchange_rate_present);
    const inputRate = asNumber(payment.exchange_rate);
    exchangeRate = inputRate > 0 && (inputRate !== 1 || masterRate === 1) ? inputRate : masterRate;
    if (exchangeRate <= 0) throw userValidationError(`สกุลเงิน ${code} ยังไม่มีอัตราแลกเปลี่ยน`);
    payment.currency_code = code;
    payment.exchange_rate = exchangeRate;
  }
  const sumAmount = asNumber(payment.sum_amount, asNumber(payment.amount) + asNumber(payment.charge));
  payment.sum_amount = sumAmount;
  payment.sum_amount_2 = roundMoney(sumAmount * exchangeRate);
  payment.charge_2 = roundMoney(asNumber(payment.charge) * exchangeRate);
}

async function validateCreditCardPayments(client, payments) {
  const cardPayments = payments.filter((payment) => payment.doc_type === 3);
  if (cardPayments.length === 0) return;

  const optionResult = await client.query("SELECT COALESCE(input_credit_card_charge::text, '0') AS input_credit_card_charge FROM erp_option LIMIT 1");
  const isManualCharge = String(optionResult.rows[0]?.input_credit_card_charge || '0') === '1';
  const creditTypeCodes = [...new Set(cardPayments.map((payment) => asText(payment.credit_card_type)).filter(Boolean))];
  const creditTypeMap = new Map();
  if (creditTypeCodes.length) {
    const typeResult = await client.query(
      `SELECT code, COALESCE(name_1, '') AS name_1,
              COALESCE(charge_rate::text, '') AS charge_rate_word
       FROM erp_credit_type
       WHERE code = ANY($1::text[])`,
      [creditTypeCodes],
    );
    for (const row of typeResult.rows) creditTypeMap.set(String(row.code), row);
  }

  for (const payment of cardPayments) {
    if (!asText(payment.trans_number)) throw userValidationError('กรุณาระบุเลขที่บัตรเครดิตให้ครบทุกรายการ');
    if (asNumber(payment.amount) <= 0) throw userValidationError(`ยอดบัตรเครดิต ${payment.trans_number} ต้องมากกว่า 0`);
    const creditType = asText(payment.credit_card_type) ? creditTypeMap.get(asText(payment.credit_card_type)) : null;
    if (asText(payment.credit_card_type) && !creditType) throw userValidationError(`ไม่พบประเภทบัตรเครดิต ${payment.credit_card_type}`);
    if (!isManualCharge && creditType) {
      payment.charge = calculatePaymentCharge(payment.amount, creditType.charge_rate_word);
    } else {
      payment.charge = asNumber(payment.charge);
    }
    payment.sum_amount = roundMoney(payment.amount + payment.charge);
    if (asText(payment.currency_code)) await applyCardCurrencyAmount(client, payment);
    payment.description = payment.description || creditType?.name_1 || '';
    payment.trans_number_type = payment.trans_number_type || 1;
    payment.ap_ar_type = payment.ap_ar_type || 1;
  }
}

async function validateTransferPayments(client, payments) {
  const transferPayments = payments.filter((payment) => payment.doc_type === 1);
  if (transferPayments.length === 0) return;

  for (const payment of transferPayments) {
    payment.pass_book_code = payment.pass_book_code || payment.trans_number;
    if (!asText(payment.pass_book_code)) throw userValidationError('กรุณาระบุบัญชีโอนเงินให้ครบทุกรายการ');
    if (asNumber(payment.amount) <= 0) throw userValidationError(`ยอดโอน ${payment.pass_book_code} ต้องมากกว่า 0`);
    const passBookResult = await client.query(
      `SELECT code, COALESCE(bank_code, '') AS bank_code, COALESCE(bank_branch, '') AS bank_branch,
              COALESCE(currency_code, '') AS currency_code
       FROM erp_pass_book
       WHERE code = $1 AND COALESCE(status::text, '0') IN ('0', '')
       LIMIT 1`,
      [payment.pass_book_code],
    );
    const passBook = passBookResult.rows[0];
    if (!passBook) throw userValidationError(`ไม่พบบัญชีโอนเงิน ${payment.pass_book_code}`);
    payment.trans_number = payment.pass_book_code;
    payment.bank_code = payment.bank_code || passBook.bank_code || '';
    payment.bank_branch = payment.bank_branch || passBook.bank_branch || '';
    payment.currency_code = payment.currency_code || passBook.currency_code || '';
    const submittedSumAmount2 = asNumber(payment.sum_amount_2);
    payment.sum_amount = payment.amount;
    if (asText(payment.currency_code)) {
      await applyCurrencyAmount(client, payment, payment.currency_code);
      payment.sum_amount_2 = submittedSumAmount2;
    }
  }
}

async function validateChequePayments(client, payments, { docDate }) {
  const chequePayments = payments.filter((payment) => payment.doc_type === 2);
  if (chequePayments.length === 0) return;

  for (const payment of chequePayments) {
    if (!asText(payment.trans_number)) throw userValidationError('กรุณาระบุเลขที่เช็คให้ครบทุกรายการ');
    if (asNumber(payment.amount) <= 0) throw userValidationError(`ยอดเช็ค ${payment.trans_number} ต้องมากกว่า 0`);

    if (asText(payment.pass_book_code)) {
      const passBookResult = await client.query(
        `SELECT code, COALESCE(bank_code, '') AS bank_code, COALESCE(bank_branch, '') AS bank_branch,
                COALESCE(currency_code, '') AS currency_code
         FROM erp_pass_book
         WHERE code = $1 AND COALESCE(status::text, '0') IN ('0', '')
         LIMIT 1`,
        [payment.pass_book_code],
      );
      const passBook = passBookResult.rows[0];
      if (!passBook) throw userValidationError(`ไม่พบบัญชีธนาคาร ${payment.pass_book_code}`);
      payment.bank_code = payment.bank_code || passBook.bank_code || '';
      payment.bank_branch = payment.bank_branch || passBook.bank_branch || '';
      payment.currency_code = payment.currency_code || passBook.currency_code || '';
    }

    if (asText(payment.bank_code)) {
      const bankResult = await client.query(
        `SELECT code FROM erp_bank WHERE code = $1 AND COALESCE(status::text, '0') IN ('0', '') LIMIT 1`,
        [payment.bank_code],
      );
      if (!bankResult.rows[0]) throw userValidationError(`ไม่พบธนาคาร ${payment.bank_code}`);
    }

    if (asText(payment.bank_branch)) {
      const branchResult = await client.query(
        `SELECT code FROM erp_bank_branch
         WHERE code = $1 AND ($2 = '' OR bank_code = $2) AND COALESCE(status::text, '0') IN ('0', '')
         LIMIT 1`,
        [payment.bank_branch, payment.bank_code || ''],
      );
      if (!branchResult.rows[0]) throw userValidationError(`ไม่พบสาขาธนาคาร ${payment.bank_branch}`);
    }

    if (payment.sum_amount <= 0) payment.sum_amount = payment.amount;
    if (payment.chq_on_hand === 1) {
      if (payment.balance_amount <= 0) throw userValidationError(`เช็ค ${payment.trans_number} ไม่มียอดคงเหลือ`);
      if (payment.amount > payment.balance_amount) throw userValidationError(`ยอดเช็ค ${payment.trans_number} ต้องไม่เกินยอดคงเหลือ ${payment.balance_amount.toFixed(2)}`);
    } else if (payment.amount > payment.sum_amount) {
      throw userValidationError(`ยอดเช็ค ${payment.trans_number} ต้องไม่เกินมูลค่าเช็ค ${payment.sum_amount.toFixed(2)}`);
    }

    if (asText(payment.currency_code)) await applyCurrencyAmount(client, payment, payment.currency_code);
    payment.chq_due_date = payment.chq_due_date || normalizeDateString(docDate);
    payment.trans_number_type = payment.trans_number_type || 1;
    payment.ap_ar_type = payment.ap_ar_type || 1;
  }
}

async function validateOtherIncomeExpensePayments(client, payments) {
  const incomePayments = payments.filter((payment) => payment.doc_type === 12);
  const expensePayments = payments.filter((payment) => payment.doc_type === 11);

  for (const payment of incomePayments) {
    if (!asText(payment.trans_number)) throw userValidationError('กรุณาระบุรหัสรายได้อื่นให้ครบทุกรายการ');
    if (asNumber(payment.amount) <= 0) throw userValidationError(`ยอดรายได้อื่น ${payment.trans_number} ต้องมากกว่า 0`);
    const result = await client.query(
      `SELECT code, COALESCE(name_1, '') AS name_1
       FROM erp_income_list
       WHERE code = $1
       LIMIT 1`,
      [payment.trans_number],
    );
    const master = result.rows[0];
    if (!master) throw userValidationError(`ไม่พบรหัสรายได้อื่น ${payment.trans_number}`);
    payment.description = payment.description || master.name_1 || '';
    payment.sum_amount = payment.amount;
  }

  for (const payment of expensePayments) {
    if (!asText(payment.trans_number)) throw userValidationError('กรุณาระบุรหัสรายจ่ายอื่นให้ครบทุกรายการ');
    if (asNumber(payment.amount) <= 0) throw userValidationError(`ยอดรายจ่ายอื่น ${payment.trans_number} ต้องมากกว่า 0`);
    const result = await client.query(
      `SELECT code, COALESCE(name_1, '') AS name_1
       FROM erp_expenses_list
       WHERE code = $1
       LIMIT 1`,
      [payment.trans_number],
    );
    const master = result.rows[0];
    if (!master) throw userValidationError(`ไม่พบรหัสรายจ่ายอื่น ${payment.trans_number}`);
    payment.description = payment.description || master.name_1 || '';
    payment.sum_amount = payment.amount;
  }
}

async function validatePettyCashPayments(client, payments) {
  const pettyPayments = payments.filter((payment) => payment.doc_type === 4);
  if (pettyPayments.length === 0) return;

  for (const payment of pettyPayments) {
    if (!asText(payment.trans_number)) throw userValidationError('กรุณาระบุรหัสเงินสดย่อยให้ครบทุกรายการ');
    if (asNumber(payment.amount) <= 0) throw userValidationError(`ยอดเงินสดย่อย ${payment.trans_number} ต้องมากกว่า 0`);
    const pettyResult = await client.query(
      `SELECT code, COALESCE(name_1, '') AS name_1, COALESCE(currency_code, '') AS currency_code
       FROM cb_petty_cash
       WHERE code = $1 AND COALESCE(status::text, '0') IN ('0', '')
       LIMIT 1`,
      [payment.trans_number],
    );
    const petty = pettyResult.rows[0];
    if (!petty) throw userValidationError(`ไม่พบรหัสเงินสดย่อย ${payment.trans_number}`);
    payment.description = payment.description || petty.name_1 || '';
    payment.currency_code = payment.currency_code || petty.currency_code || '';
    payment.sum_amount = payment.amount;
    if (asText(payment.currency_code)) await applyCurrencyAmount(client, payment, payment.currency_code);
  }
}

async function validateWalletPayments(client, payments) {
  const walletPayments = payments.filter((payment) => payment.doc_type === 21);
  if (walletPayments.length === 0) return;

  const walletCodes = [...new Set(walletPayments.map((payment) => asText(payment.credit_card_type)).filter(Boolean))];
  const walletMap = new Map();
  if (walletCodes.length) {
    const walletResult = await client.query(
      `SELECT code, COALESCE(name_1, '') AS name_1
       FROM erp_wallet_list
       WHERE code = ANY($1::text[])`,
      [walletCodes],
    );
    for (const row of walletResult.rows) walletMap.set(String(row.code), row);
  }

  for (const payment of walletPayments) {
    if (!asText(payment.trans_number)) throw userValidationError('กรุณาระบุเลขที่รายการ Wallet ให้ครบทุกรายการ');
    if (asNumber(payment.amount) <= 0) throw userValidationError(`ยอด Wallet ${payment.trans_number} ต้องมากกว่า 0`);
    const wallet = asText(payment.credit_card_type) ? walletMap.get(asText(payment.credit_card_type)) : null;
    if (asText(payment.credit_card_type) && !wallet) throw userValidationError(`ไม่พบประเภท Wallet ${payment.credit_card_type}`);
    payment.sum_amount = payment.amount;
    payment.description = payment.description || wallet?.name_1 || '';
  }
}

async function validateCouponPayments(client, payments, { custCode, docDate, totalAmount, docNo }) {
  const couponPayments = payments.filter((payment) => payment.doc_type === 9);
  if (couponPayments.length === 0) return;

  const couponNumbers = [...new Set(couponPayments.map((payment) => asText(payment.trans_number)).filter(Boolean))];
  if (couponPayments.some((payment) => !asText(payment.trans_number))) {
    throw userValidationError('กรุณาระบุเลขที่คูปองให้ครบทุกรายการ');
  }

  const result = await client.query(
    `SELECT number,
            CASE
              WHEN COALESCE(amount::text, '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
              THEN amount::numeric
              ELSE 0
            END AS amount,
            CASE
              WHEN COALESCE(balance_amount::text, '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
              THEN balance_amount::numeric
              WHEN COALESCE(amount::text, '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
              THEN amount::numeric
              ELSE 0
            END AS balance_amount,
            date_expire::date::text AS date_expire,
            COALESCE(last_status::text, '0') AS last_status,
            COALESCE(coupon_type::text, '0') AS coupon_type,
            COALESCE(single_use::text, '0') AS single_use,
            COALESCE(cust_code, '') AS cust_code,
            COALESCE(remark, '') AS remark,
            COALESCE((
              SELECT SUM(COALESCE(d.amount, d.sum_amount, 0))
              FROM cb_trans_detail d
              WHERE d.trans_number = coupon_list.number
                AND d.doc_type = 9
                AND COALESCE(d.last_status::text, '0') = '0'
                AND COALESCE(d.trans_flag, 0) <> 144
                AND ($2 = '' OR d.doc_no <> $2)
            ), 0) AS used_amount,
            CASE WHEN COALESCE((
              SELECT d.doc_no
              FROM cb_trans_detail d
              WHERE d.trans_number = coupon_list.number
                AND d.doc_type = 9
                AND COALESCE(d.last_status::text, '0') = '0'
                AND COALESCE(d.trans_flag, 0) <> 144
                AND ($2 = '' OR d.doc_no <> $2)
              LIMIT 1
            ), '') = '' THEN 0 ELSE 1 END AS used_status
     FROM coupon_list
     WHERE number = ANY($1::text[])
     FOR UPDATE`,
    [couponNumbers, docNo || ''],
  );

  const couponMap = new Map(result.rows.map((row) => [String(row.number), row]));
  const docDateText = normalizeDateString(docDate);
  const amountByCoupon = new Map();
  for (const payment of couponPayments) {
    const number = asText(payment.trans_number);
    amountByCoupon.set(number, roundMoney((amountByCoupon.get(number) || 0) + payment.amount));
  }

  for (const [couponNumber, paymentAmount] of amountByCoupon.entries()) {
    const coupon = couponMap.get(couponNumber);
    if (!coupon) throw userValidationError(`ไม่พบคูปอง ${couponNumber}`);
    if (String(coupon.last_status) !== '0') throw userValidationError(`คูปอง ${couponNumber} ถูกยกเลิกแล้ว`);
    if (coupon.cust_code && coupon.cust_code !== custCode) throw userValidationError(`คูปอง ${couponNumber} ไม่ตรงกับลูกค้าในเอกสาร`);
    if (coupon.date_expire && docDateText && docDateText > normalizeDateString(coupon.date_expire)) {
      throw userValidationError(`คูปอง ${couponNumber} หมดอายุแล้ว`);
    }
    if (String(coupon.single_use) === '1' && Number(coupon.used_status) === 1) {
      throw userValidationError(`คูปอง ${couponNumber} ถูกใช้งานแล้ว`);
    }
    if (String(coupon.single_use) === '1' && couponPayments.filter((payment) => payment.trans_number === couponNumber).length > 1) {
      throw userValidationError(`คูปอง ${couponNumber} ใช้ได้ครั้งเดียวต่อเอกสาร`);
    }

    const masterAmount = asNumber(coupon.amount);
    const usedAmount = asNumber(coupon.used_amount);
    const availableAmount = String(coupon.coupon_type) === '1'
      ? roundMoney(calcDiscount(`${masterAmount}%`, totalAmount))
      : roundMoney(asNumber(coupon.balance_amount, masterAmount) - usedAmount);

    if (availableAmount <= 0) throw userValidationError(`คูปอง ${couponNumber} ไม่มียอดคงเหลือให้ใช้`);
    if (paymentAmount <= 0 || paymentAmount > availableAmount) {
      throw userValidationError(`ยอดใช้คูปอง ${couponNumber} ต้องไม่เกิน ${availableAmount.toFixed(2)}`);
    }

    for (const payment of couponPayments.filter((row) => row.trans_number === couponNumber)) {
      payment.balance_amount = availableAmount;
      payment.sum_amount = payment.amount;
      payment.description = payment.description || 'coupon';
      payment.remark = payment.remark || coupon.remark || '';
    }
  }
}

async function validateDepositPayments(client, payments, { custCode, docDate, docNo }) {
  const depositPayments = payments.filter((payment) => payment.doc_type === 5);
  if (depositPayments.length === 0) return;
  if (!asText(custCode)) {
    throw userValidationError('กรุณาระบุรหัสลูกค้าก่อนใช้เงินล่วงหน้า');
  }

  const docNumbers = [...new Set(depositPayments.map((payment) => asText(payment.trans_number)).filter(Boolean))];
  if (depositPayments.some((payment) => !asText(payment.trans_number))) {
    throw userValidationError('กรุณาระบุเลขที่เงินล่วงหน้าให้ครบทุกรายการ');
  }

  const result = await client.query(
    `WITH cb_total AS (
       SELECT doc_no, trans_flag, MAX(COALESCE(total_net_amount, 0)) AS total_net_amount
       FROM cb_trans
       GROUP BY doc_no, trans_flag
     ), base AS (
       SELECT t.doc_no, t.doc_date::date::text AS doc_date, t.cust_code,
              COALESCE(NULLIF(cb.total_net_amount, 0), t.total_amount, 0) AS total_amount,
              CASE
                WHEN COALESCE(t.currency_code, '') <> '' THEN COALESCE(NULLIF(t.total_value_2, 0), COALESCE(NULLIF(cb.total_net_amount, 0), t.total_amount, 0))
                ELSE COALESCE(NULLIF(cb.total_net_amount, 0), t.total_amount, 0)
              END AS currency_total_amount,
              COALESCE(t.currency_code, '') AS currency_code,
              COALESCE(NULLIF(t.exchange_rate, 0), 1) AS exchange_rate,
              COALESCE((
                SELECT SUM(COALESCE(r.total_amount, 0))
                FROM ic_trans r
                WHERE r.doc_ref = t.doc_no
                  AND ($4 = '' OR r.doc_no <> $4)
                  AND COALESCE(r.last_status::text, '0') = '0'
                  AND r.trans_flag IN (42)
              ), 0) +
              COALESCE((
                SELECT SUM(COALESCE(d.amount, 0))
                FROM cb_trans_detail d
                WHERE d.trans_number = t.doc_no
                  AND ($4 = '' OR d.doc_no <> $4)
                  AND d.doc_type = 5
                  AND COALESCE(d.last_status::text, '0') = '0'
                  AND d.trans_flag <> 144
              ), 0) AS use_amount
       FROM ic_trans t
       LEFT JOIN cb_total cb ON cb.doc_no = t.doc_no AND cb.trans_flag = t.trans_flag
       WHERE COALESCE(t.last_status::text, '0') = '0'
         AND t.trans_flag IN (40, 9040)
         AND t.doc_no = ANY($1::text[])
         AND t.cust_code = $2
         AND t.doc_date <= $3::date
       FOR UPDATE OF t
     )
     SELECT doc_no, doc_date, cust_code, total_amount, use_amount,
            total_amount - use_amount AS balance_amount,
            currency_total_amount - use_amount AS currency_amount,
            currency_total_amount, currency_code, exchange_rate
     FROM base`,
    [docNumbers, custCode || '', normalizeDateString(docDate), docNo || ''],
  );

  const depositMap = new Map(result.rows.map((row) => [String(row.doc_no), row]));
  const amountByDoc = new Map();
  for (const payment of depositPayments) {
    const docNumber = asText(payment.trans_number);
    amountByDoc.set(docNumber, roundMoney((amountByDoc.get(docNumber) || 0) + payment.amount));
  }

  for (const [docNumber, paymentAmount] of amountByDoc.entries()) {
    const deposit = depositMap.get(docNumber);
    if (!deposit) throw userValidationError(`ไม่พบเอกสารเงินล่วงหน้า ${docNumber} หรือไม่ตรงกับลูกค้า`);
    const balanceAmount = roundMoney(deposit.balance_amount);
    const csharpCurrencyAmount = roundMoney(asNumber(deposit.currency_amount));
    const minAmount = Math.min(0, csharpCurrencyAmount);
    if (balanceAmount <= 0) throw userValidationError(`เงินล่วงหน้า ${docNumber} ไม่มียอดคงเหลือ`);
    if (paymentAmount === 0 || paymentAmount < minAmount || paymentAmount > balanceAmount) {
      throw userValidationError(`ยอดตัดเงินล่วงหน้า ${docNumber} ต้องไม่เกิน ${balanceAmount.toFixed(2)}`);
    }

    for (const payment of depositPayments.filter((row) => row.trans_number === docNumber)) {
      payment.doc_date_ref = payment.doc_date_ref || deposit.doc_date || '';
      payment.sum_amount = asNumber(deposit.total_amount);
      payment.balance_amount = balanceAmount;
      payment.currency_code = payment.currency_code || deposit.currency_code || '';
      payment.exchange_rate = asNumber(deposit.exchange_rate, 1);
      payment.sum_amount_2 = payment.sum_amount_2 || asNumber(deposit.currency_amount);
      const exchangeRate = asNumber(payment.exchange_rate, 1) || 1;
      payment.amount_2 = payment.amount_2 || roundMoney(asNumber(payment.amount) / exchangeRate);
      payment.exchange_rate_old = payment.exchange_rate_old || exchangeRate;
      payment.lost_profit_exchange_amount = payment.lost_profit_exchange_amount || 0;
    }
  }
}

async function validateDepositMoneyPayments(client, payments, { custCode, docDate, docNo }) {
  const depositPayments = payments.filter((payment) => payment.doc_type === 6);
  if (depositPayments.length === 0) return;
  if (!asText(custCode)) {
    throw userValidationError('กรุณาระบุรหัสลูกค้าก่อนใช้เงินมัดจำ');
  }

  const docNumbers = [...new Set(depositPayments.map((payment) => asText(payment.trans_number)).filter(Boolean))];
  if (depositPayments.some((payment) => !asText(payment.trans_number))) {
    throw userValidationError('กรุณาระบุเลขที่เงินมัดจำให้ครบทุกรายการ');
  }

  const result = await client.query(
    `WITH cb_total AS (
       SELECT doc_no, trans_flag, MAX(COALESCE(total_net_amount, 0)) AS total_net_amount
       FROM cb_trans
       GROUP BY doc_no, trans_flag
     ), base AS (
       SELECT t.doc_no, t.doc_date::date::text AS doc_date, t.cust_code,
              COALESCE(NULLIF(cb.total_net_amount, 0), t.total_amount, 0) AS total_amount,
              CASE
                WHEN COALESCE(t.currency_code, '') <> '' THEN COALESCE(NULLIF(t.total_value_2, 0), COALESCE(NULLIF(cb.total_net_amount, 0), t.total_amount, 0))
                ELSE COALESCE(NULLIF(cb.total_net_amount, 0), t.total_amount, 0)
              END AS currency_total_amount,
              COALESCE(t.currency_code, '') AS currency_code,
              COALESCE(NULLIF(t.exchange_rate, 0), 1) AS exchange_rate,
              COALESCE((
                SELECT SUM(COALESCE(r.total_amount, 0))
                FROM ic_trans r
                WHERE r.doc_ref = t.doc_no
                  AND ($4 = '' OR r.doc_no <> $4)
                  AND COALESCE(r.last_status::text, '0') = '0'
                  AND r.trans_flag IN (112)
              ), 0) +
              COALESCE((
                SELECT SUM(COALESCE(d.amount, 0))
                FROM cb_trans_detail d
                WHERE d.trans_number = t.doc_no
                  AND ($4 = '' OR d.doc_no <> $4)
                  AND d.doc_type = 6
                  AND COALESCE(d.last_status::text, '0') = '0'
                  AND d.trans_flag <> 144
              ), 0) AS use_amount
       FROM ic_trans t
       LEFT JOIN cb_total cb ON cb.doc_no = t.doc_no AND cb.trans_flag = t.trans_flag
       WHERE COALESCE(t.last_status::text, '0') = '0'
         AND t.trans_flag IN (110, 9110)
         AND t.doc_no = ANY($1::text[])
         AND t.cust_code = $2
         AND t.doc_date <= $3::date
       FOR UPDATE OF t
     )
     SELECT doc_no, doc_date, cust_code, total_amount, use_amount,
            total_amount - use_amount AS balance_amount,
            currency_total_amount - use_amount AS currency_amount,
            currency_total_amount, currency_code, exchange_rate
     FROM base`,
    [docNumbers, custCode || '', normalizeDateString(docDate), docNo || ''],
  );

  const depositMap = new Map(result.rows.map((row) => [String(row.doc_no), row]));
  const amountByDoc = new Map();
  for (const payment of depositPayments) {
    const docNumber = asText(payment.trans_number);
    amountByDoc.set(docNumber, roundMoney((amountByDoc.get(docNumber) || 0) + payment.amount));
  }

  for (const [docNumber, paymentAmount] of amountByDoc.entries()) {
    const deposit = depositMap.get(docNumber);
    if (!deposit) throw userValidationError(`ไม่พบเอกสารเงินมัดจำ ${docNumber} หรือไม่ตรงกับลูกค้า`);
    const balanceAmount = roundMoney(deposit.balance_amount);
    if (balanceAmount <= 0) throw userValidationError(`เงินมัดจำ ${docNumber} ไม่มียอดคงเหลือ`);
    if (paymentAmount <= 0 || paymentAmount > balanceAmount) {
      throw userValidationError(`ยอดตัดเงินมัดจำ ${docNumber} ต้องไม่เกิน ${balanceAmount.toFixed(2)}`);
    }

    for (const payment of depositPayments.filter((row) => row.trans_number === docNumber)) {
      payment.doc_date_ref = payment.doc_date_ref || deposit.doc_date || '';
      payment.sum_amount = asNumber(deposit.total_amount);
      payment.balance_amount = balanceAmount;
      payment.currency_code = payment.currency_code || deposit.currency_code || '';
      payment.exchange_rate = asNumber(deposit.exchange_rate, 1);
      payment.sum_amount_2 = payment.sum_amount_2 || asNumber(deposit.currency_amount);
      const exchangeRate = asNumber(payment.exchange_rate, 1) || 1;
      payment.amount_2 = payment.amount_2 || roundMoney(asNumber(payment.amount) / exchangeRate);
      payment.exchange_rate_old = payment.exchange_rate_old || exchangeRate;
      payment.lost_profit_exchange_amount = payment.lost_profit_exchange_amount || 0;
    }
  }
}

function getSaleDepositSourceConfig(docType) {
  if (asNumber(docType) === 5) {
    return { docType: 5, transFlags: [40, 9040], returnFlag: 42 };
  }
  if (asNumber(docType) === 6) {
    return { docType: 6, transFlags: [110, 9110], returnFlag: 112 };
  }
  return null;
}

async function recomputeSaleDepositSourceStatuses(client, depositSources = []) {
  const uniqueSources = new Map();
  for (const source of depositSources) {
    const docNo = asText(source?.doc_no || source?.trans_number);
    const config = getSaleDepositSourceConfig(source?.doc_type);
    if (!docNo || !config) continue;
    uniqueSources.set(`${config.docType}|${docNo}`, { docNo, ...config });
  }

  for (const source of uniqueSources.values()) {
    await client.query(
      `UPDATE ic_trans t
          SET used_status = CASE WHEN calc.use_amount <> 0 THEN 1 ELSE 0 END,
              doc_success = CASE
                WHEN calc.base_amount <> 0 AND calc.base_amount - calc.use_amount <= 0 THEN 1
                ELSE 0
              END
         FROM (
           SELECT t2.doc_no,
                  COALESCE(NULLIF(cb.total_net_amount, 0), t2.total_amount, 0) AS base_amount,
                  COALESCE((
                    SELECT SUM(COALESCE(r.total_amount, 0))
                    FROM ic_trans r
                    WHERE r.doc_ref = t2.doc_no
                      AND COALESCE(r.last_status::text, '0') = '0'
                      AND r.trans_flag = $3
                  ), 0) +
                  COALESCE((
                    SELECT SUM(COALESCE(d.amount, 0))
                    FROM cb_trans_detail d
                    WHERE d.trans_number = t2.doc_no
                      AND d.doc_type = $2
                      AND COALESCE(d.last_status::text, '0') = '0'
                      AND d.trans_flag <> 144
                  ), 0) AS use_amount
           FROM ic_trans t2
           LEFT JOIN (
             SELECT doc_no, trans_flag, MAX(COALESCE(total_net_amount, 0)) AS total_net_amount
             FROM cb_trans
             GROUP BY doc_no, trans_flag
           ) cb ON cb.doc_no = t2.doc_no AND cb.trans_flag = t2.trans_flag
           WHERE t2.doc_no = $1
             AND t2.trans_flag = ANY($4::int[])
         ) calc
         WHERE t.doc_no = calc.doc_no
           AND t.trans_flag = ANY($4::int[])`,
      [source.docNo, source.docType, source.returnFlag, source.transFlags],
    );
  }
}

async function validateOtherCurrencyPayments(client, payments) {
  const currencyPayments = payments.filter((payment) => payment.doc_type === 19);
  if (currencyPayments.length === 0) return;

  const optionResult = await client.query("SELECT COALESCE(multi_currency::text, '0') AS multi_currency FROM erp_option LIMIT 1");
  if (String(optionResult.rows[0]?.multi_currency || '0') !== '1') {
    throw userValidationError('ยังไม่ได้เปิดใช้งานระบบหลายสกุลเงิน');
  }

  const currencyCodes = [...new Set(currencyPayments.map((payment) => asText(payment.currency_code || payment.trans_number)).filter(Boolean))];
  if (currencyPayments.some((payment) => !asText(payment.currency_code || payment.trans_number))) {
    throw userValidationError('กรุณาระบุรหัสสกุลเงินให้ครบทุกรายการ');
  }

  const result = await client.query(
    `SELECT code, COALESCE(name_1, '') AS name_1,
            CASE
              WHEN COALESCE(exchange_rate_present::text, '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
              THEN exchange_rate_present::numeric
              ELSE 0
            END AS exchange_rate_present
     FROM erp_currency
     WHERE code = ANY($1::text[])`,
    [currencyCodes],
  );
  const currencyMap = new Map(result.rows.map((row) => [String(row.code), row]));

  for (const payment of currencyPayments) {
    const code = asText(payment.currency_code || payment.trans_number);
    const currency = currencyMap.get(code);
    if (!currency) throw userValidationError(`ไม่พบสกุลเงิน ${code}`);
    const foreignAmount = asNumber(payment.amount);
    const exchangeRate = asNumber(payment.exchange_rate, asNumber(currency.exchange_rate_present));
    if (foreignAmount <= 0) throw userValidationError(`จำนวนเงินสกุล ${code} ต้องมากกว่า 0`);
    if (exchangeRate <= 0) throw userValidationError(`สกุลเงิน ${code} ยังไม่มีอัตราแลกเปลี่ยน`);

    payment.trans_number = code;
    payment.currency_code = code;
    payment.description = payment.description || currency.name_1 || '';
    payment.exchange_rate = exchangeRate;
    payment.sum_amount = roundMoney(foreignAmount * exchangeRate);
    payment.sum_amount_2 = payment.sum_amount;
    payment.amount_2 = foreignAmount;
    payment.charge = asNumber(payment.charge);
  }
}

async function validatePromotionPayments(client, payments, context) {
  await validateTransferPayments(client, payments, context);
  await validateCreditCardPayments(client, payments, context);
  await validateChequePayments(client, payments, context);
  await validatePettyCashPayments(client, payments, context);
  await validateCouponPayments(client, payments, context);
  await validateDepositPayments(client, payments, context);
  await validateDepositMoneyPayments(client, payments, context);
  await validateOtherIncomeExpensePayments(client, payments, context);
  await validateOtherCurrencyPayments(client, payments, context);
  await validateWalletPayments(client, payments, context);
}

async function loadSaleCreditOptions(client) {
  const columns = await getTableColumnSet(client, 'erp_option');
  const optionNames = [
    'check_overdue',
    'warning_overdue',
    'warning_credit_money',
    'lock_credit_money',
    'request_ar_credit',
    'password_ar_credit',
    'credit_sale_include_deposit',
    'ar_credit_chq_outstanding',
    'sr_ss_credit_check',
    'check_input_vat',
    'check_open_period',
    'auto_insert_time',
    'multi_currency',
    'check_expiration_date',
    'check_lot_auto',
    'find_lot_auto',
    'use_department',
    'use_project',
    'discount_type',
    'discout_type',
    'discount_vat_type',
  ];
  const inquiryScopeColumn = columns.has('credit_check_inquiry_scope')
    ? 'credit_check_inquiry_scope'
    : (columns.has('credit_sale_inquiry_scope') ? 'credit_sale_inquiry_scope' : '');
  const selectList = optionNames.map((name) => (
    columns.has(name) ? `COALESCE(${name}::text, '0') AS ${name}` : `'0' AS ${name}`
  ));
  selectList.push(
    inquiryScopeColumn
      ? `COALESCE(${inquiryScopeColumn}::text, '') AS credit_check_inquiry_scope`
      : "'' AS credit_check_inquiry_scope",
  );
  const result = await client.query(`SELECT ${selectList.join(', ')} FROM erp_option LIMIT 1`);
  const row = result.rows[0] || {};
  const isEnabled = (name) => ['1', 'true', 't', 'yes', 'y'].includes(String(row[name] || '0').toLowerCase());
  return {
    ...Object.fromEntries(optionNames.map((name) => [name, isEnabled(name)])),
    credit_check_inquiry_scope: asText(row.credit_check_inquiry_scope),
  };
}

async function loadSaleCompanyOptions(client) {
  const columns = await getTableColumnSet(client, 'erp_option');
  const numericDefaults = {
    item_qty_decimal: 2,
    item_price_decimal: 2,
    item_amount_decimal: 2,
    round_type: 0,
    vat_type: 1,
    vat_rate: 7,
    discount_type: 0,
    discout_type: 0,
    discount_vat_type: 0,
    currency_exchange_decimal: 2,
    balance_control_type: 0,
  };
  const booleanDefaults = {
    discount_step_round_off: false,
    ic_stock_control: false,
    issue_stock_control: false,
    stock_balance_control: false,
    stock_reserved_control: false,
    stock_reserved_control_location: false,
    fix_item_set_price: false,
    warning_price_1: false,
    warning_price_2: false,
    disable_sale_no_price: false,
    warning_low_cost: false,
    lock_low_cost: false,
    ic_price_formula_control: false,
  };
  const selectList = [];
  for (const [name, fallback] of Object.entries(numericDefaults)) {
    selectList.push(columns.has(name) ? `COALESCE(${name}::text, '${fallback}') AS ${name}` : `'${fallback}' AS ${name}`);
  }
  for (const [name, fallback] of Object.entries(booleanDefaults)) {
    selectList.push(columns.has(name) ? `COALESCE(${name}::text, '${fallback ? 1 : 0}') AS ${name}` : `'${fallback ? 1 : 0}' AS ${name}`);
  }
  selectList.push(columns.has('home_currency') ? "COALESCE(home_currency::text, 'LAK') AS home_currency" : "'LAK' AS home_currency");
  selectList.push(columns.has('multi_currency') ? "COALESCE(multi_currency::text, '1') AS multi_currency" : "'1' AS multi_currency");

  const result = await client.query(`SELECT ${selectList.join(', ')} FROM erp_option LIMIT 1`);
  const row = result.rows[0] || {};
  const isEnabled = (name, fallback = false) => {
    const value = row[name];
    if (value === undefined || value === null || value === '') return fallback;
    return ['1', 'true', 't', 'yes', 'y'].includes(String(value).toLowerCase());
  };
  const asIntegerOption = (name) => parseInt(asNumber(row[name], numericDefaults[name]), 10) || 0;
  return {
    home_currency: normalizeCurrencyCode(row.home_currency, 'LAK') || 'LAK',
    multi_currency: isEnabled('multi_currency', true),
    item_qty_decimal: asIntegerOption('item_qty_decimal'),
    item_price_decimal: asIntegerOption('item_price_decimal'),
    item_amount_decimal: asIntegerOption('item_amount_decimal'),
    round_type: asIntegerOption('round_type'),
    vat_type: asIntegerOption('vat_type'),
    vat_rate: asNumber(row.vat_rate, numericDefaults.vat_rate),
    discount_type: columns.has('discount_type')
      ? asIntegerOption('discount_type')
      : asIntegerOption('discout_type'),
    discout_type: asIntegerOption('discout_type'),
    discount_vat_type: asIntegerOption('discount_vat_type'),
    currency_exchange_decimal: asIntegerOption('currency_exchange_decimal') || 2,
    balance_control_type: asIntegerOption('balance_control_type'),
    discount_step_round_off: isEnabled('discount_step_round_off', booleanDefaults.discount_step_round_off),
    ic_stock_control: isEnabled('ic_stock_control', booleanDefaults.ic_stock_control),
    issue_stock_control: isEnabled('issue_stock_control', booleanDefaults.issue_stock_control),
    stock_balance_control: isEnabled('stock_balance_control', booleanDefaults.stock_balance_control),
    stock_reserved_control: isEnabled('stock_reserved_control', booleanDefaults.stock_reserved_control),
    stock_reserved_control_location: isEnabled('stock_reserved_control_location', booleanDefaults.stock_reserved_control_location),
    fix_item_set_price: isEnabled('fix_item_set_price', booleanDefaults.fix_item_set_price),
    warning_price_1: isEnabled('warning_price_1', booleanDefaults.warning_price_1),
    warning_price_2: isEnabled('warning_price_2', booleanDefaults.warning_price_2),
    disable_sale_no_price: isEnabled('disable_sale_no_price', booleanDefaults.disable_sale_no_price),
    warning_low_cost: isEnabled('warning_low_cost', booleanDefaults.warning_low_cost),
    lock_low_cost: isEnabled('lock_low_cost', booleanDefaults.lock_low_cost),
    ic_price_formula_control: isEnabled('ic_price_formula_control', booleanDefaults.ic_price_formula_control),
  };
}

function resolveSaleCreditInquiryScope(options = {}) {
  // Default to C# sale behavior: check credit only when inquiry_type == 0.
  const rawScope = asText(
    process.env.SALE_CREDIT_INQUIRY_SCOPE || options.credit_check_inquiry_scope || '0',
    '0',
  );
  const tokens = rawScope
    .split(/[^0-9]+/)
    .map((token) => Number(token))
    .filter((value) => Number.isFinite(value) && (value === 0 || value === 2));
  const scope = new Set(tokens);
  if (scope.size === 0) scope.add(0);
  return scope;
}

function validateVatTaxDocumentInput({ options, vatType, taxDocNo, rawTaxDocDate }) {
  if (!options?.check_input_vat) return;
  if (![0, 1].includes(Number(vatType))) return;
  if (!asText(taxDocNo)) {
    throw userValidationError('กรุณาป้อนเลขที่ใบกำกับภาษี');
  }
  if (!asText(rawTaxDocDate)) {
    throw userValidationError('กรุณาป้อนวันที่ใบกำกับภาษี');
  }
}

function validateWarehouseShelfRequired(items = []) {
  for (const item of items) {
    const itemCode = asText(item?.item_code);
    if (!itemCode || itemCode === '.') continue;
    const itemType = asNumber(item?.item_type);
    // service does not use inventory locations
    if (itemType === 1) continue;

    const whCode = asText(item?.wh_code);
    const shelfCode = asText(item?.shelf_code);
    if (!whCode) {
      throw userValidationError(`ป้อนข้อมูลคลังสินค้าไม่ครบ (${itemCode})`);
    }
    if (!shelfCode) {
      throw userValidationError(`ป้อนข้อมูลที่เก็บสินค้าไม่ครบ (${itemCode})`);
    }
  }
}

async function loadPosWarehouseShelfDefaults(client, posId) {
  const key = asText(posId);
  if (!key) return { wh_code: '', shelf_code: '' };
  const result = await client.query(
    `SELECT COALESCE(pos_ic_wht, '') AS wh_code,
            COALESCE(pos_ic_shelf, '') AS shelf_code
     FROM pos_id
     WHERE pos_id = $1
     LIMIT 1`,
    [key],
  );
  const row = result.rows[0] || {};
  return {
    wh_code: asText(row.wh_code),
    shelf_code: asText(row.shelf_code),
  };
}

async function loadAnyPosWarehouseShelfDefaults(client) {
  const result = await client.query(
    `SELECT COALESCE(pos_ic_wht, '') AS wh_code,
            COALESCE(pos_ic_shelf, '') AS shelf_code
     FROM pos_id
     WHERE COALESCE(pos_ic_wht, '') <> ''
       AND COALESCE(pos_ic_shelf, '') <> ''
     ORDER BY pos_id
     LIMIT 1`,
    [],
  );
  const row = result.rows[0] || {};
  return {
    wh_code: asText(row.wh_code),
    shelf_code: asText(row.shelf_code),
  };
}

function applyWarehouseShelfDefaults(items = [], defaults = {}) {
  const defaultWh = asText(defaults.wh_code);
  const defaultShelf = asText(defaults.shelf_code);
  for (const item of items) {
    const itemCode = asText(item?.item_code);
    if (!itemCode || itemCode === '.') continue;
    const itemType = asNumber(item?.item_type);
    if (itemType === 1) continue;
    if (!asText(item.wh_code) && defaultWh) item.wh_code = defaultWh;
    if (!asText(item.shelf_code) && defaultShelf) item.shelf_code = defaultShelf;
  }
}

async function loadItemWarehouseShelfFromHistory(client, itemCode) {
  const code = asText(itemCode);
  if (!code) return { wh_code: '', shelf_code: '' };
  const result = await client.query(
    `SELECT COALESCE(wh_code, '') AS wh_code,
            COALESCE(shelf_code, '') AS shelf_code
     FROM ic_trans_detail
     WHERE item_code = $1
       AND COALESCE(wh_code, '') <> ''
       AND COALESCE(shelf_code, '') <> ''
     ORDER BY doc_date DESC, COALESCE(line_number, 0) DESC
     LIMIT 1`,
    [code],
  );
  const row = result.rows[0] || {};
  return {
    wh_code: asText(row.wh_code),
    shelf_code: asText(row.shelf_code),
  };
}

async function applyWarehouseShelfFromHistory(client, items = []) {
  const cache = new Map();
  for (const item of items) {
    const itemCode = asText(item?.item_code);
    if (!itemCode || itemCode === '.') continue;
    const itemType = asNumber(item?.item_type);
    if (itemType === 1) continue;
    if (asText(item.wh_code) && asText(item.shelf_code)) continue;
    if (!cache.has(itemCode)) {
      cache.set(itemCode, await loadItemWarehouseShelfFromHistory(client, itemCode));
    }
    const fallback = cache.get(itemCode) || {};
    if (!asText(item.wh_code) && asText(fallback.wh_code)) item.wh_code = asText(fallback.wh_code);
    if (!asText(item.shelf_code) && asText(fallback.shelf_code)) item.shelf_code = asText(fallback.shelf_code);
  }
}

async function loadItemWarehouseShelfFromStockBalance(client, itemCode, docDate) {
  const code = asText(itemCode);
  if (!code) return { wh_code: '', shelf_code: '' };
  const targetDate = normalizeDateString(docDate) || new Date().toISOString().slice(0, 10);
  const queryByDate = async (dateValue) => client.query(
    `SELECT COALESCE(warehouse, '') AS wh_code,
            COALESCE(location, '') AS shelf_code,
            COALESCE(balance_qty, 0)::numeric AS balance_qty
     FROM sml_ic_function_stock_balance_warehouse_location($1::date, $2, '', '')
     WHERE COALESCE(warehouse, '') <> ''
       AND COALESCE(location, '') <> ''
     ORDER BY (COALESCE(balance_qty, 0)::numeric > 0) DESC,
              COALESCE(balance_qty, 0)::numeric DESC
     LIMIT 1`,
    [dateValue, code],
  );
  let result = await queryByDate(targetDate);
  if (!result.rows.length) {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== targetDate) result = await queryByDate(today);
  }
  const row = result.rows[0] || {};
  return {
    wh_code: asText(row.wh_code),
    shelf_code: asText(row.shelf_code),
  };
}

async function applyWarehouseShelfFromStockBalance(client, items = [], docDate) {
  const cache = new Map();
  for (const item of items) {
    const itemCode = asText(item?.item_code);
    if (!itemCode || itemCode === '.') continue;
    const itemType = asNumber(item?.item_type);
    if (itemType === 1) continue;
    if (asText(item.wh_code) && asText(item.shelf_code)) continue;
    if (!cache.has(itemCode)) {
      cache.set(itemCode, await loadItemWarehouseShelfFromStockBalance(client, itemCode, docDate));
    }
    const fallback = cache.get(itemCode) || {};
    if (!asText(item.wh_code) && asText(fallback.wh_code)) item.wh_code = asText(fallback.wh_code);
    if (!asText(item.shelf_code) && asText(fallback.shelf_code)) item.shelf_code = asText(fallback.shelf_code);
  }
}

async function loadWarehouseShelfMasterDefault(client) {
  const result = await client.query(
    `SELECT COALESCE(wh_code, '') AS wh_code,
            COALESCE(shelf_code, '') AS shelf_code
     FROM ic_wh_shelf
     WHERE COALESCE(wh_code, '') <> ''
       AND COALESCE(shelf_code, '') <> ''
     ORDER BY wh_code, shelf_code
     LIMIT 1`,
    [],
  );
  const row = result.rows[0] || {};
  return {
    wh_code: asText(row.wh_code),
    shelf_code: asText(row.shelf_code),
  };
}

function validateItemDiscountNotExceedPrice(items = []) {
  for (const item of items) {
    const itemCode = asText(item?.item_code);
    if (!itemCode || itemCode === '.') continue;
    const sumAmount = asNumber(item?.sum_amount);
    if (sumAmount < 0) {
      const name = asText(item?.item_name) || itemCode;
      throw userValidationError(`ส่วนลดมากกว่าราคาขาย: ${name} (${itemCode})`);
    }
  }
}

function isTruthySaleValue(value) {
  return value === true || value === 1 || value === '1' || String(value || '').toLowerCase() === 'true';
}

function isPremiumSaleSource(item = {}) {
  return [
    item?.is_permium,
    item?.is_premium,
    item?.is_free,
    item?.promotion_free,
    item?.premium,
  ].some(isTruthySaleValue);
}

function isSalePricePolicySkipped(item = {}) {
  const itemCode = asText(item?.item_code);
  if (!itemCode || itemCode === '.') return true;
  const itemType = asNumber(item?.item_type);
  if (itemType === 1 || itemType === 3) return true;
  if (asText(item?.set_ref_line)) return true;
  return isPremiumSaleSource(item);
}

function saleItemDisplayName(item = {}) {
  const itemCode = asText(item?.item_code);
  const itemName = asText(item?.item_name) || itemCode;
  return itemName && itemCode && itemName !== itemCode ? `${itemName} (${itemCode})` : itemCode || itemName;
}

function salePolicyIssue(level, code, item, message, extra = {}) {
  return {
    level,
    code,
    item_code: asText(item?.item_code),
    item_name: asText(item?.item_name),
    unit_code: asText(item?.unit_code),
    message,
    ...extra,
  };
}

function collectNoPriceSalePolicyIssues(items = [], options = {}) {
  const issues = [];
  const shouldBlock = options.disable_sale_no_price === true;
  const shouldWarn = !shouldBlock && (options.warning_price_1 === true || options.warning_price_2 === true);
  if (!shouldBlock && !shouldWarn) return issues;

  for (const item of items) {
    if (isSalePricePolicySkipped(item)) continue;
    const price = asNumber(firstPaymentValue(item, 'price_2', 'price'));
    if (price > 0) continue;
    const message = `ไม่พบราคาสินค้า: ${saleItemDisplayName(item)}`;
    issues.push(salePolicyIssue(
      shouldBlock ? 'error' : 'warning',
      'SALE_ITEM_NO_PRICE',
      item,
      message,
      { price },
    ));
  }
  return issues;
}

function saleBaseUnitNetPrice(item = {}, options = {}) {
  const qty = asNumber(item?.qty);
  const standValue = asNumber(item?.stand_value, 1) || 1;
  const divideValue = asNumber(item?.divide_value, 1) || 1;
  const ratio = asNumber(item?.ratio, standValue / divideValue) || 1;
  const baseQty = qty * ratio;
  if (baseQty <= 0) return 0;

  let amount = asNumber(item?.sum_amount);
  if (amount <= 0) amount = asNumber(item?.price) * qty;
  if (amount <= 0) return 0;

  const isVatIncluded = asNumber(item?.vat_type, options.vat_type) === 1 && asNumber(item?.tax_type) !== 1;
  if (isVatIncluded) {
    const vatRate = asNumber(item?.vat_rate, options.vat_rate);
    if (vatRate > 0) amount = (amount * 100) / (100 + vatRate);
  }
  return amount / baseQty;
}

async function collectLowCostSalePolicyIssues(client, items = [], options = {}, docDate = '') {
  const lowCostCheckEnabled = options.warning_low_cost === true;
  const shouldBlock = lowCostCheckEnabled && options.lock_low_cost === true;
  const shouldWarn = lowCostCheckEnabled && !shouldBlock;
  if (!shouldBlock && !shouldWarn) return [];

  const rows = items
    .filter((item) => !isSalePricePolicySkipped(item))
    .filter((item) => asNumber(item?.qty) > 0)
    .map((item) => ({
      item,
      item_code: asText(item?.item_code),
      wh_code: asText(item?.wh_code),
      shelf_code: asText(item?.shelf_code),
    }));
  if (!rows.length) return [];

  const itemCostMap = await loadItemCostAndAccountsMap(client, rows.map((row) => row.item_code));
  const movementCostMap = await loadMovementUnitCostMap(client, rows, docDate);
  const issues = [];

  for (const row of rows) {
    const item = row.item;
    const key = `${row.item_code}|${row.wh_code || ''}|${row.shelf_code || ''}`;
    const movementCost = asNumber(movementCostMap.get(key));
    const masterCost = asNumber(itemCostMap.get(row.item_code)?.unit_cost);
    const unitCost = movementCost > 0 ? movementCost : masterCost;
    if (unitCost <= 0) continue;

    const baseNetPrice = saleBaseUnitNetPrice(item, options);
    if (baseNetPrice < unitCost) {
      const message = `ราคาขายต่ำกว่าทุน: ${saleItemDisplayName(item)} (${baseNetPrice.toFixed(2)} < ${unitCost.toFixed(2)})`;
      issues.push(salePolicyIssue(
        shouldBlock ? 'error' : 'warning',
        'SALE_ITEM_LOW_COST',
        item,
        message,
        {
          price: baseNetPrice,
          cost: unitCost,
          wh_code: row.wh_code,
          shelf_code: row.shelf_code,
        },
      ));
    }
  }
  return issues;
}

async function collectSaleItemPolicyIssues(client, { items = [], docDate = '', options = {} } = {}) {
  const issues = [
    ...collectNoPriceSalePolicyIssues(items, options),
    ...(await collectLowCostSalePolicyIssues(client, items, options, docDate)),
  ];
  return {
    errors: issues.filter((issue) => issue.level === 'error'),
    warnings: issues.filter((issue) => issue.level === 'warning'),
  };
}

function throwSaleItemPolicyErrors(issues = {}) {
  const errors = Array.isArray(issues.errors) ? issues.errors : [];
  if (!errors.length) return;
  const detail = errors.map((issue) => issue.message).filter(Boolean).join(', ');
  throw userValidationError(detail || 'รายการสินค้าไม่ผ่านเงื่อนไขการขาย');
}

function throwSaleItemPolicyBlockedIssues(issues = {}) {
  const errors = Array.isArray(issues.errors) ? issues.errors : [];
  const warnings = Array.isArray(issues.warnings) ? issues.warnings : [];
  const blockingWarnings = warnings.filter((issue) => String(issue?.code || '').toUpperCase() === 'SALE_ITEM_NO_PRICE');
  const blockedIssues = [...errors, ...blockingWarnings];
  if (!blockedIssues.length) return;
  const details = blockedIssues.map((issue) => issue.message).filter(Boolean);
  throw salePolicyValidationError({
    message: details.join(', ') || 'Sale item policy validation failed',
    details,
    errors,
    warnings: blockingWarnings,
  });
}

async function validateOpenAccountPeriod(client, docDate) {
  // Check if any accounting periods are configured
  const countRes = await client.query('SELECT COUNT(*) AS cnt FROM erp_account_period');
  const total = parseInt(countRes.rows[0].cnt, 10);
  if (total === 0) return; // No periods configured → skip check

  const res = await client.query(
    `SELECT 1 FROM erp_account_period
     WHERE $1::date BETWEEN date_start AND date_end
       AND status = 0
     LIMIT 1`,
    [docDate],
  );
  if (res.rows.length === 0) {
    throw userValidationError(
      'วันที่เอกสารอยู่ในงวดบัญชีที่ปิดแล้ว หรือยังไม่ได้กำหนดงวดบัญชี กรุณาตรวจสอบ',
    );
  }
}

async function loadCustomerCreditInfo(client, custCode) {
  if (!custCode) return null;
  const detailColumns = await getTableColumnSet(client, 'ar_customer_detail');
  const optionalNumber = (column) => (
    detailColumns.has(column) ? `COALESCE(d.${column}, 0)::numeric` : '0::numeric'
  );
  const optionalInt = (column) => (
    detailColumns.has(column) ? `COALESCE(d.${column}, 0)::int` : '0::int'
  );
  const optionalText = (column) => (
    detailColumns.has(column) ? `COALESCE(d.${column}, '')` : "''"
  );
  const result = await client.query(
    `SELECT c.code,
            COALESCE(c.name_1, c.code) AS name_1,
            ${optionalNumber('credit_money')} AS credit_money,
            ${optionalNumber('credit_money_max')} AS credit_money_max,
            ${optionalInt('credit_status')} AS credit_status,
            ${optionalInt('past_due_day')} AS past_due_day,
            ${optionalText('close_reason')} AS close_reason
     FROM ar_customer c
     LEFT JOIN ar_customer_detail d ON d.ar_code = c.code
     WHERE c.code = $1
     LIMIT 1`,
    [custCode],
  );
  return result.rows[0] || null;
}

const AR_CREDIT_FLAGS = {
  sale: 44,
  saleReturn: 48,
  saleDebit: 46,
  arOpeningDebt: 93,
  arOtherDebt: 99,
  arOpeningDebit: 95,
  arOtherDebit: 101,
  arOpeningCredit: 97,
  arOtherCredit: 103,
  arPay: 239,
  cashBankIncomeOther: 250,
  cashBankIncomeOtherCredit: 252,
  cashBankIncomeOtherDebit: 254,
  receiveChequeNewDebt: 418,
  saleReserve: 34,
  saleOrder: 36,
  saleOrderConsume: [44, 39, 36],
  saleReserveConsume: [44, 37],
  saleDeposit: 40,
  saleAdvance: 9040,
  saleDepositReturn: 112,
  saleAdvanceReturn: 42,
};

function sqlNumberList(values) {
  return values.map((value) => Number(value)).filter((value) => Number.isFinite(value)).join(',');
}

function arCreditMovementSql() {
  const debtFlags = sqlNumberList([AR_CREDIT_FLAGS.arOpeningDebt, AR_CREDIT_FLAGS.arOtherDebt]);
  const saleDebtFlags = sqlNumberList([
    AR_CREDIT_FLAGS.sale,
    AR_CREDIT_FLAGS.cashBankIncomeOther,
    AR_CREDIT_FLAGS.receiveChequeNewDebt,
  ]);
  const debitFlags = sqlNumberList([
    AR_CREDIT_FLAGS.saleDebit,
    AR_CREDIT_FLAGS.arOpeningDebit,
    AR_CREDIT_FLAGS.arOtherDebit,
    AR_CREDIT_FLAGS.cashBankIncomeOtherDebit,
  ]);
  const creditFlags = sqlNumberList([
    AR_CREDIT_FLAGS.arOpeningCredit,
    AR_CREDIT_FLAGS.arOtherCredit,
    AR_CREDIT_FLAGS.cashBankIncomeOtherCredit,
  ]);
  return `
    SELECT roworder, 1 AS calc_type, doc_no, cust_code, COALESCE(total_amount,0) AS amount
    FROM ic_trans
    WHERE COALESCE(last_status,0)=0
      AND trans_flag IN (${saleDebtFlags})
      AND inquiry_type IN (0,2)
      AND ar_customer.code = ic_trans.cust_code
    UNION ALL
    SELECT roworder, 1 AS calc_type, doc_no, cust_code, COALESCE(total_amount,0) AS amount
    FROM ic_trans
    WHERE COALESCE(last_status,0)=0
      AND trans_flag IN (${debtFlags})
      AND ar_customer.code = ic_trans.cust_code
    UNION ALL
    SELECT roworder, 2 AS calc_type, doc_no, cust_code, COALESCE(total_amount,0) AS amount
    FROM ic_trans
    WHERE COALESCE(last_status,0)=0
      AND trans_flag IN (${debitFlags})
      AND ar_customer.code = ic_trans.cust_code
    UNION ALL
    SELECT roworder, 3 AS calc_type, doc_no, cust_code, -1*COALESCE(total_amount,0) AS amount
    FROM ic_trans
    WHERE COALESCE(last_status,0)=0
      AND trans_flag=${AR_CREDIT_FLAGS.saleReturn}
      AND inquiry_type IN (0,2,4)
      AND ar_customer.code = ic_trans.cust_code
    UNION ALL
    SELECT roworder, 3 AS calc_type, doc_no, cust_code, -1*COALESCE(total_amount,0) AS amount
    FROM ic_trans
    WHERE COALESCE(last_status,0)=0
      AND trans_flag IN (${creditFlags})
      AND ar_customer.code = ic_trans.cust_code
    UNION ALL
    SELECT roworder, 4 AS calc_type, doc_no, cust_code, -1*COALESCE(total_net_value,0) AS amount
    FROM ap_ar_trans
    WHERE COALESCE(last_status,0)=0
      AND trans_flag=${AR_CREDIT_FLAGS.arPay}
      AND ar_customer.code = ap_ar_trans.cust_code`;
}

async function getCustomerCreditMoneyBalance(client, custCode, exceptDocNo, options) {
  if (!custCode) return null;
  const hasApArTrans = await tableExists(client, 'ap_ar_trans');
  const hasChqList = await tableExists(client, 'cb_chq_list');
  const chqColumns = hasChqList ? await getTableColumnSet(client, 'cb_chq_list') : new Set();
  const detailColumns = await getTableColumnSet(client, 'ar_customer_detail');
  const optionalNumber = (column) => (
    detailColumns.has(column) ? `COALESCE((SELECT ${column} FROM ar_customer_detail WHERE ar_customer_detail.ar_code=ar_customer.code), 0)::numeric` : '0::numeric'
  );
  const optionalInt = (column) => (
    detailColumns.has(column) ? `COALESCE((SELECT ${column} FROM ar_customer_detail WHERE ar_customer_detail.ar_code=ar_customer.code), 0)::int` : '0::int'
  );
  const optionalText = (column) => (
    detailColumns.has(column) ? `COALESCE((SELECT ${column} FROM ar_customer_detail WHERE ar_customer_detail.ar_code=ar_customer.code), '')` : "''"
  );
  const closeDateExpr = detailColumns.has('close_credit_date')
    ? '(SELECT close_credit_date FROM ar_customer_detail WHERE ar_customer_detail.ar_code=ar_customer.code)'
    : 'NULL::date';
  const closeReasonFlag = (column) => (
    detailColumns.has(column) ? `(SELECT ${column} FROM ar_customer_detail WHERE ar_customer_detail.ar_code=ar_customer.code)` : '0'
  );

  const movementSql = hasApArTrans
    ? arCreditMovementSql()
    : `
      SELECT roworder, 1 AS calc_type, doc_no, cust_code,
             COALESCE(total_amount,0)
             - (SELECT COALESCE(SUM(COALESCE(sum_pay_money,0)),0)
                FROM ap_ar_trans_detail
                WHERE COALESCE(last_status,0)=0
                  AND trans_flag IN (${AR_CREDIT_FLAGS.arPay})
                  AND ic_trans.doc_no=ap_ar_trans_detail.billing_no
                  AND ic_trans.trans_flag=ap_ar_trans_detail.bill_type) AS amount
      FROM ic_trans
      WHERE COALESCE(last_status,0)=0
        AND trans_flag IN (${sqlNumberList([
          AR_CREDIT_FLAGS.sale,
          AR_CREDIT_FLAGS.cashBankIncomeOther,
          AR_CREDIT_FLAGS.receiveChequeNewDebt,
        ])})
        AND inquiry_type IN (0,2)
        AND ar_customer.code=ic_trans.cust_code
      UNION ALL
      SELECT roworder, 1 AS calc_type, doc_no, cust_code,
             COALESCE(total_amount,0)
             - (SELECT COALESCE(SUM(COALESCE(sum_pay_money,0)),0)
                FROM ap_ar_trans_detail
                WHERE COALESCE(last_status,0)=0
                  AND trans_flag IN (${AR_CREDIT_FLAGS.arPay})
                  AND ic_trans.doc_no=ap_ar_trans_detail.billing_no
                  AND ic_trans.trans_flag=ap_ar_trans_detail.bill_type) AS amount
      FROM ic_trans
      WHERE COALESCE(last_status,0)=0
        AND (trans_flag IN (${sqlNumberList([
          AR_CREDIT_FLAGS.saleDebit,
          AR_CREDIT_FLAGS.arOpeningDebt,
          AR_CREDIT_FLAGS.arOtherDebt,
          AR_CREDIT_FLAGS.arOpeningDebit,
          AR_CREDIT_FLAGS.arOtherDebit,
        ])})
          OR (trans_flag=${AR_CREDIT_FLAGS.cashBankIncomeOtherDebit} AND inquiry_type IN (0,2)))
        AND ar_customer.code=ic_trans.cust_code
      UNION ALL
      SELECT roworder, 3 AS calc_type, doc_no, cust_code,
             -1*(COALESCE(total_amount,0)
             + (SELECT COALESCE(SUM(COALESCE(sum_pay_money,0)),0)
                FROM ap_ar_trans_detail
                WHERE COALESCE(last_status,0)=0
                  AND trans_flag IN (${AR_CREDIT_FLAGS.arPay})
                  AND ic_trans.doc_no=ap_ar_trans_detail.billing_no
                  AND ic_trans.trans_flag=ap_ar_trans_detail.bill_type)) AS amount
      FROM ic_trans
      WHERE COALESCE(last_status,0)=0
        AND ((trans_flag=${AR_CREDIT_FLAGS.saleReturn} AND inquiry_type IN (0,2,4))
          OR trans_flag IN (${sqlNumberList([AR_CREDIT_FLAGS.arOpeningCredit, AR_CREDIT_FLAGS.arOtherCredit])})
          OR (trans_flag=${AR_CREDIT_FLAGS.cashBankIncomeOtherCredit} AND inquiry_type IN (0,2)))
        AND ar_customer.code=ic_trans.cust_code`;

  const exceptWhere = asText(exceptDocNo) ? 'WHERE doc_no <> $2' : '';
  const chqStatusExpr = chqColumns.has('status') ? 'status' : '0';
  const chqOutstandingExpr = options.ar_credit_chq_outstanding
    && hasChqList
    && chqColumns.has('chq_type')
    && chqColumns.has('ap_ar_code')
    && chqColumns.has('amount')
    ? `COALESCE((SELECT SUM(CASE WHEN ${chqStatusExpr} NOT IN (2,7,8) THEN amount ELSE 0 END)
                 FROM cb_chq_list
                 WHERE chq_type=1 AND ap_ar_code=ar_customer.code), 0)`
    : '0';
  const srRemainExpr = options.sr_ss_credit_check
    ? `COALESCE((SELECT SUM(total_amount
                - COALESCE((SELECT SUM(sum_amount)
                            FROM ic_trans_detail AS x
                            WHERE x.trans_flag IN (${sqlNumberList(AR_CREDIT_FLAGS.saleOrderConsume)})
                              AND x.last_status=0
                              AND x.ref_doc_no=ic_trans.doc_no), 0))
                 FROM ic_trans
                 WHERE trans_flag=${AR_CREDIT_FLAGS.saleReserve}
                   AND last_status=0
                   AND inquiry_type IN (0,2)
                   AND doc_success=0
                   AND approve_status IN (0,1)
                   AND ic_trans.cust_code=ar_customer.code
                   ${asText(exceptDocNo) ? 'AND doc_no <> $2' : ''}), 0)`
    : '0';
  const ssRemainExpr = options.sr_ss_credit_check
    ? `COALESCE((SELECT SUM(total_amount
                - COALESCE((SELECT SUM(sum_amount)
                            FROM ic_trans_detail AS x
                            WHERE x.trans_flag IN (${sqlNumberList(AR_CREDIT_FLAGS.saleReserveConsume)})
                              AND x.last_status=0
                              AND x.ref_doc_no=ic_trans.doc_no), 0))
                 FROM ic_trans
                 WHERE trans_flag=${AR_CREDIT_FLAGS.saleOrder}
                   AND last_status=0
                   AND inquiry_type IN (0,2)
                   AND doc_success=0
                   AND approve_status IN (0,1)
                   AND ic_trans.cust_code=ar_customer.code
                   ${asText(exceptDocNo) ? 'AND doc_no <> $2' : ''}), 0)`
    : '0';
  const advanceExpr = (options.sr_ss_credit_check || options.credit_sale_include_deposit)
    ? `COALESCE((SELECT SUM(CASE WHEN _def_last_status=1 THEN 0 ELSE total_amount-(deposit_buy2+sum_used) END)
                 FROM (
                   SELECT cust_code,
                          COALESCE((SELECT SUM(total_amount)
                                    FROM ic_trans AS x1
                                    WHERE x1.last_status=0
                                      AND x1.doc_ref=deposit.doc_no), 0) AS deposit_buy2,
                          COALESCE((SELECT SUM(amount)
                                    FROM cb_trans_detail AS x2
                                    WHERE x2.last_status=0
                                      AND x2.trans_number=deposit.doc_no), 0) AS sum_used,
                          total_amount,
                          last_status AS _def_last_status
                   FROM ic_trans AS deposit
                   WHERE deposit.trans_flag IN (${AR_CREDIT_FLAGS.saleDeposit})
                     AND deposit.cust_code=ar_customer.code
                 ) AS temp1), 0)`
    : '0';

  const result = await client.query(
    `SELECT code,
            name_1,
            ${optionalNumber('credit_money')} AS credit_money,
            ${optionalNumber('credit_money_max')} AS credit_money_max,
            ${optionalInt('credit_status')} AS credit_status,
            ${optionalInt('past_due_day')} AS past_due_day,
            ${optionalText('close_reason')} AS close_reason,
            ${closeReasonFlag('close_reason_1')} AS close_reason_1,
            ${closeReasonFlag('close_reason_2')} AS close_reason_2,
            ${closeReasonFlag('close_reason_3')} AS close_reason_3,
            ${closeReasonFlag('close_reason_4')} AS close_reason_4,
            ${closeDateExpr} AS close_credit_date,
            (SELECT COALESCE(SUM(amount),0) FROM (${movementSql}) AS temp6 ${exceptWhere}) AS balance_end,
            ${chqOutstandingExpr} AS chq_outstanding,
            ${srRemainExpr} AS sr_remain,
            ${ssRemainExpr} AS ss_remain,
            ${advanceExpr} AS advance_amount
     FROM ar_customer
     WHERE code = $1
     LIMIT 1`,
    asText(exceptDocNo) ? [custCode, exceptDocNo] : [custCode],
  );
  return result.rows[0] || null;
}

async function getCustomerOldestOverdueDoc(client, custCode, docDate, pastDueDay) {
  const result = await client.query(
    `SELECT doc_no,
            doc_date::date::text AS doc_date,
            COALESCE(due_date, doc_date)::date::text AS due_date,
            balance_amount
     FROM (
       SELECT cust_code, doc_date, credit_date AS due_date, doc_no,
              COALESCE(total_amount,0)
              - (SELECT COALESCE(SUM(COALESCE(sum_pay_money,0)),0)
                 FROM ap_ar_trans_detail
                 WHERE COALESCE(last_status,0)=0
                   AND trans_flag IN (239)
                   AND ic_trans.doc_no = ap_ar_trans_detail.billing_no
                   AND ic_trans.doc_date = ap_ar_trans_detail.billing_date) AS balance_amount
       FROM ic_trans
       WHERE COALESCE(last_status,0)=0
         AND trans_flag IN (44,250,418)
         AND (inquiry_type=0 OR inquiry_type=2)
         AND doc_date <= $2::date
       UNION ALL
       SELECT cust_code, doc_date, credit_date AS due_date, doc_no,
              COALESCE(total_amount,0)
              - (SELECT COALESCE(SUM(COALESCE(sum_pay_money,0)),0)
                 FROM ap_ar_trans_detail
                 WHERE COALESCE(last_status,0)=0
                   AND trans_flag IN (239)
                   AND ic_trans.doc_no = ap_ar_trans_detail.billing_no
                   AND ic_trans.doc_date = ap_ar_trans_detail.billing_date) AS balance_amount
       FROM ic_trans
       WHERE COALESCE(last_status,0)=0
         AND (trans_flag IN (46,93,99,95,101)
           OR (trans_flag=254 AND inquiry_type IN (0,2)))
         AND doc_date <= $2::date
       UNION ALL
       SELECT cust_code, doc_date, credit_date AS due_date, doc_no,
              -1 * (COALESCE(total_amount,0)
              + (SELECT COALESCE(SUM(COALESCE(sum_pay_money,0)),0)
                 FROM ap_ar_trans_detail
                 WHERE COALESCE(last_status,0)=0
                   AND trans_flag IN (239)
                   AND ic_trans.doc_no = ap_ar_trans_detail.billing_no
                   AND ic_trans.doc_date = ap_ar_trans_detail.billing_date)) AS balance_amount
       FROM ic_trans
       WHERE COALESCE(last_status,0)=0
         AND ((trans_flag=48 AND inquiry_type IN (0,2,4))
           OR trans_flag=97 OR trans_flag=103
           OR (trans_flag=252 AND inquiry_type IN (0,2)))
         AND doc_date <= $2::date
     ) AS doc_balance
     WHERE cust_code = $1
       AND balance_amount > 0
       AND (COALESCE(due_date, doc_date) + ($3::text || ' days')::interval)::date <= CURRENT_DATE
     ORDER BY COALESCE(due_date, doc_date), doc_date, doc_no
     LIMIT 1`,
    [custCode, normalizeDateString(docDate) || new Date().toISOString().slice(0, 10), asNumber(pastDueDay)],
  );
  return result.rows[0] || null;
}

async function getCustomerDepositAdvanceBalance(client, custCode, docDate) {
  const docDateFilter = normalizeDateString(docDate) || new Date().toISOString().slice(0, 10);
  const depositBalanceSql = ({ transFlags, returnFlag, useDocType }) => `
    SELECT COALESCE(SUM(balance_amount),0)::numeric AS balance_amount
    FROM (
      SELECT base_amount-use_amount AS balance_amount
      FROM (
        SELECT COALESCE(NULLIF((
                 SELECT cb.total_net_amount
                 FROM cb_trans cb
                 WHERE cb.doc_no = ic_trans.doc_no
                   AND cb.trans_flag = ic_trans.trans_flag
                 LIMIT 1
               ), 0), total_amount, 0) AS base_amount,
               COALESCE((SELECT SUM(COALESCE(total_amount,0))
                         FROM ic_trans AS a
                         WHERE a.doc_ref=ic_trans.doc_no
                           AND a.trans_flag=${returnFlag}
                           AND COALESCE(a.last_status,0)=0), 0)
               + COALESCE((SELECT SUM(COALESCE(amount,0))
                           FROM cb_trans_detail
                           WHERE cb_trans_detail.trans_flag <> 144
                             AND cb_trans_detail.doc_type=${useDocType}
                             AND cb_trans_detail.trans_number=ic_trans.doc_no
                             AND COALESCE(cb_trans_detail.last_status,0)=0), 0) AS use_amount
        FROM ic_trans
        WHERE COALESCE(last_status,0)=0
          AND trans_flag IN (${sqlNumberList(transFlags)})
          AND cust_code=$1
          AND doc_date <= $2::date
      ) AS temp3
      WHERE base_amount-use_amount <> 0
    ) AS temp4`;
  const result = await client.query(
    `SELECT COALESCE(
       (${depositBalanceSql({ transFlags: [AR_CREDIT_FLAGS.saleDeposit], returnFlag: AR_CREDIT_FLAGS.saleDepositReturn, useDocType: 6 })})
       + (${depositBalanceSql({ transFlags: [AR_CREDIT_FLAGS.saleAdvance], returnFlag: AR_CREDIT_FLAGS.saleAdvanceReturn, useDocType: 5 })}),
       0
     )::numeric AS balance_amount`,
    [custCode, docDateFilter],
  );
  return asNumber(result.rows[0]?.balance_amount);
}

async function getCustomerChequeOutstanding(client, custCode) {
  if (!(await tableExists(client, 'cb_chq_list'))) return 0;
  const chqColumns = await getTableColumnSet(client, 'cb_chq_list');
  if (!chqColumns.has('chq_type') || !chqColumns.has('ap_ar_code') || !chqColumns.has('amount')) return 0;
  const statusExpr = chqColumns.has('status') ? 'status' : '0';
  const result = await client.query(
    `SELECT COALESCE(SUM(CASE WHEN ${statusExpr} NOT IN (2,7,8) THEN amount ELSE 0 END), 0)::numeric AS chq_amount
     FROM cb_chq_list
     WHERE chq_type = 1
       AND ap_ar_code = $1
       `,
    [custCode],
  );
  return asNumber(result.rows[0]?.chq_amount);
}

function randomDigits(length) {
  let text = '';
  for (let index = 0; index < length; index += 1) {
    text += Math.floor(Math.random() * 10).toString();
  }
  return text;
}

async function generateCreditRequestNo(client) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const refNo = crypto.randomBytes(4).toString('hex').toUpperCase();
    const result = await client.query('SELECT 1 FROM erp_request_order WHERE doc_no = $1 LIMIT 1', [refNo]);
    if (result.rows.length === 0) return refNo;
  }
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
}

async function verifyCreditApprovalPassword(client, approve = {}) {
  const userCode = asText(approve.user_code || approve.userCode || approve.code);
  const password = approve.password === undefined || approve.password === null ? '' : String(approve.password);
  if (!userCode || !password) {
    return { ok: false, reason: 'missing' };
  }

  const result = await client.query(
    `SELECT code, COALESCE(approve_ar_credit,0) AS approve_ar_credit
     FROM erp_user
     WHERE UPPER(code)=UPPER($1)
       AND password=$2
     LIMIT 1`,
    [userCode, password],
  );
  if (result.rows.length === 0) {
    return { ok: false, reason: 'invalid' };
  }
  const row = result.rows[0];
  if (asNumber(row.approve_ar_credit) !== 1) {
    return { ok: false, reason: 'permission', user_code: row.code };
  }
  return { ok: true, user_code: row.code };
}

async function createCreditStatusRequest(client, {
  docNo,
  totalAmount,
  creditInfo,
  creditBalance,
}) {
  if (!(await tableExists(client, 'erp_credit_request'))) return null;
  await insertExistingColumns(client, 'erp_credit_request', {
    doc_no: docNo,
    trans_flag: 44,
    credit_money: asNumber(creditInfo?.credit_money),
    credit_money_max: asNumber(creditInfo?.credit_money_max),
    chq_amount: asNumber(creditInfo?.chq_outstanding),
    advance_amount: asNumber(creditInfo?.advance_amount),
    ar_balance_amount: creditBalance,
    sr_amount: asNumber(creditInfo?.sr_remain),
    ss_amount: asNumber(creditInfo?.ss_remain),
    bill_amount: totalAmount,
    over_amount: totalAmount,
    over_percent: 0,
    credit_status: asNumber(creditInfo?.credit_status),
  });
  return docNo;
}

async function createSaleCreditRequestDraft(client, {
  obj,
  docNo,
  docDate,
  docTime,
  custCode,
  creatorCode,
  docFormatCode,
  inquiryType,
  vatType,
  empCode,
  totalAmount,
  totalValue,
  beforeVat,
  vatValue,
  afterVat,
  totalDiscount,
  items,
  creditInfo,
  creditBalance,
}) {
  const requiredTables = ['ic_trans_draft', 'ic_trans_detail_draft', 'erp_request_order'];
  for (const tableName of requiredTables) {
    if (!(await tableExists(client, tableName))) {
      throw userValidationError(`ไม่พบตาราง ${tableName} สำหรับบันทึกคำขออนุมัติเครดิต`);
    }
  }

  const refNo = await generateCreditRequestNo(client);
  const approveCode = randomDigits(6);
  await insertExistingColumns(client, 'ic_trans_draft', {
    trans_flag: 44,
    trans_type: 2,
    doc_no: refNo,
    doc_date: docDate,
    doc_time: docTime,
    creator_code: creatorCode,
    create_datetime: new Date(),
    cust_code: custCode,
    doc_format_code: docFormatCode,
    inquiry_type: inquiryType,
    vat_type: vatType,
    sale_code: empCode,
    vat_rate: asNumber(obj.vat_rate, 7),
    total_value: totalValue,
    total_discount: totalDiscount,
    total_before_vat: beforeVat,
    total_vat_value: vatValue,
    total_after_vat: afterVat,
    total_amount: totalAmount,
    discount_word: obj.discount_word || '',
    remark: obj.remark || '',
    remark_2: obj.remark_2 || '',
    remark_3: obj.remark_3 || '',
    remark_4: obj.remark_4 || '',
    remark_5: obj.remark_5 || '',
  });

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] || {};
    await insertExistingColumns(client, 'ic_trans_detail_draft', {
      trans_flag: 44,
      trans_type: 2,
      doc_no: refNo,
      doc_date: docDate,
      doc_time: docTime,
      line_number: index,
      item_code: item.item_code || '',
      item_name: item.item_name || '',
      unit_code: item.unit_code || '',
      qty: asNumber(item.qty),
      price: asNumber(item.price),
      sum_amount: asNumber(item.sum_amount),
      discount: item.discount || '',
      discount_amount: asNumber(item.discount_amount),
      wh_code: item.wh_code || '',
      shelf_code: item.shelf_code || '',
      stand_value: asNumber(item.stand_value, 1),
      divide_value: asNumber(item.divide_value, 1),
      cust_code: custCode,
      inquiry_type: inquiryType,
      vat_type: vatType,
      vat_rate: asNumber(item.vat_rate, asNumber(obj.vat_rate, 7)),
    });
  }

  await insertExistingColumns(client, 'erp_request_order', {
    trans_flag: 44,
    trans_type: 2,
    doc_no: refNo,
    req_datetime: new Date(),
    approve_code: approveCode,
    cust_code: custCode,
    send_success: 0,
  });

  return {
    ref_no: refNo,
    approve_code: approveCode,
    credit_money: asNumber(creditInfo?.credit_money),
    credit_balance: creditBalance,
  };
}

async function validateSaleCreditBeforeSave(client, {
  obj,
  docNo,
  docDate,
  docTime,
  custCode,
  creatorCode,
  docFormatCode,
  inquiryType,
  vatType,
  empCode,
  totalAmount,
  totalValue,
  beforeVat,
  vatValue,
  afterVat,
  totalDiscount,
  items,
  options: preloadedOptions = null,
}) {
  const options = preloadedOptions || await loadSaleCreditOptions(client);
  const inquiryScope = resolveSaleCreditInquiryScope(options);
  if (!inquiryScope.has(Number(inquiryType)) || !custCode) return null;

  const confirmations = saleConfirmations(obj);
  const creditInfo = await getCustomerCreditMoneyBalance(client, custCode, docNo, options);
  if (!creditInfo) return null;

  if (Number(inquiryType) === 0 && (options.check_overdue || options.warning_overdue) && !confirmations.has('overdue_warning')) {
    const overdueDoc = await getCustomerOldestOverdueDoc(client, custCode, docDate, creditInfo.past_due_day);
    if (overdueDoc) {
      const details = [
        `เอกสารค้างชำระ ${overdueDoc.doc_no}`,
        `ครบกำหนด ${overdueDoc.due_date}`,
        `ยอดค้าง ${roundMoney(overdueDoc.balance_amount).toFixed(2)}`,
      ];
      if (options.check_overdue) {
        return saleValidationResponse({
          code: 'SALE_CREDIT_OVERDUE_BLOCKED',
          level: 'error',
          title: 'ห้ามขายเมื่อเกินกำหนดชำระ',
          message: 'ลูกหนี้มีเอกสารเกินกำหนดชำระ จึงยังบันทึกขายเชื่อไม่ได้',
          details,
        });
      }
      return saleValidationResponse({
        code: 'SALE_CREDIT_OVERDUE_WARNING',
        level: 'warn',
        requireConfirm: 'overdue_warning',
        title: 'ลูกหนี้เกินกำหนดชำระ',
        message: 'ลูกหนี้มีเอกสารเกินกำหนดชำระ ต้องการดำเนินการต่อหรือไม่',
        details,
      });
    }
  }

  const creditStatus = asNumber(creditInfo.credit_status);
  const closeReason = asText(creditInfo.close_reason);
  const arBalance = asNumber(creditInfo.balance_end);
  const chqOutstanding = asNumber(creditInfo.chq_outstanding);
  if (creditStatus !== 0) {
    if (creditStatus === 2 && options.request_ar_credit) {
      const creditBalance = roundMoney(arBalance + chqOutstanding);
      const requestDocNo = await createCreditStatusRequest(client, {
        docNo,
        totalAmount,
        creditInfo,
        creditBalance,
      });
      return {
        ...saleValidationResponse({
          code: 'SALE_CREDIT_STATUS_REQUEST_CREATED',
          level: 'info',
          title: 'บันทึกคำขอเปิดสถานะเครดิตแล้ว',
          message: `บันทึกคำขอเปิดสถานะเครดิตแล้ว ยังไม่ได้บันทึกเอกสารขาย${closeReason ? `: ${closeReason}` : ''}`,
          details: [
            `ลูกค้า ${custCode} : ${creditInfo.name_1 || ''}`,
            `วงเงินเครดิต ${asNumber(creditInfo.credit_money).toFixed(2)}`,
            `ยอดหนี้ปัจจุบัน ${creditBalance.toFixed(2)}`,
            `ยอดขายครั้งนี้ ${roundMoney(totalAmount).toFixed(2)}`,
          ],
        }),
        request_ref_no: requestDocNo || docNo,
      };
    }
    return saleValidationResponse({
      code: 'SALE_CREDIT_STATUS_BLOCKED',
      level: 'error',
      title: 'ลูกค้าถูกปิดสถานะเครดิต',
      message: `ลูกค้า ${custCode} : ${creditInfo.name_1 || ''} ถูกปิดสถานะเครดิต${closeReason ? `: ${closeReason}` : ''}`,
    });
  }

  const creditMoney = asNumber(creditInfo.credit_money);
  if (creditMoney === 0 || !(options.warning_credit_money || options.lock_credit_money || options.request_ar_credit)) {
    return null;
  }

  const depositAdvanceBalance = options.credit_sale_include_deposit
    ? await getCustomerDepositAdvanceBalance(client, custCode, docDate)
    : 0;
  const creditBalance = roundMoney(arBalance + chqOutstanding - depositAdvanceBalance);
  const creditRemain = roundMoney(creditMoney - creditBalance);
  if (totalAmount <= creditRemain) return null;

  const details = [
    `วงเงินเครดิต ${creditMoney.toFixed(2)}`,
    `ยอดหนี้ปัจจุบัน ${creditBalance.toFixed(2)}`,
    `ยอดขายครั้งนี้ ${roundMoney(totalAmount).toFixed(2)}`,
    `เกินวงเงิน ${roundMoney(totalAmount - creditRemain).toFixed(2)}`,
  ];

  if (options.request_ar_credit) {
    const requestInfo = await createSaleCreditRequestDraft(client, {
      obj,
      docDate,
      docTime,
      custCode,
      creatorCode,
      docFormatCode,
      inquiryType,
      vatType,
      empCode,
      totalAmount,
      totalValue,
      beforeVat,
      vatValue,
      afterVat,
      totalDiscount,
      items,
      creditInfo,
      creditBalance,
    });
    return {
      ...saleValidationResponse({
        code: 'SALE_CREDIT_REQUEST_CREATED',
        level: 'info',
        title: 'สร้างคำขออนุมัติเครดิตแล้ว',
        message: `บันทึกคำขออนุมัติเลขที่ ${requestInfo.ref_no} แล้ว ยังไม่ได้บันทึกเอกสารขายจริง`,
        details,
      }),
      request_ref_no: requestInfo.ref_no,
    };
  }

  if (options.lock_credit_money) {
    if (options.password_ar_credit) {
      const approval = await verifyCreditApprovalPassword(client, obj.credit_approve || {});
      if (approval.ok) {
        obj._credit_approve_user = approval.user_code;
        return null;
      }
      return saleValidationResponse({
        code: approval.reason === 'missing' ? 'SALE_CREDIT_APPROVAL_REQUIRED' : 'SALE_CREDIT_APPROVAL_FAILED',
        level: approval.reason === 'missing' ? 'warn' : 'error',
        title: 'ต้องอนุมัติวงเงินเครดิต',
        message: approval.reason === 'permission'
          ? 'ผู้ใช้นี้ไม่มีสิทธิ์อนุมัติวงเงินเครดิต'
          : 'กรุณาระบุผู้อนุมัติและรหัสผ่านให้ถูกต้อง',
        details,
        extra: { require_approve_password: true },
      });
    }
    return saleValidationResponse({
      code: 'SALE_CREDIT_OVER_LIMIT_BLOCKED',
      level: 'error',
      title: 'เกินวงเงินเครดิต',
      message: options.password_ar_credit
        ? 'ยอดวงเงินเครดิตของลูกค้าเกินที่กำหนดไว้ ต้องใช้สิทธิ์อนุมัติวงเงินก่อนบันทึก'
        : 'ยอดวงเงินเครดิตของลูกค้าเกินที่กำหนดไว้ จึงยังบันทึกไม่ได้',
      details,
    });
  }

  if (!confirmations.has('credit_over_limit_warning')) {
    return saleValidationResponse({
      code: 'SALE_CREDIT_OVER_LIMIT_WARNING',
      level: 'warn',
      requireConfirm: 'credit_over_limit_warning',
      title: 'เกินวงเงินเครดิต',
      message: 'ยอดวงเงินเครดิตของลูกค้าเกินที่กำหนดไว้ ต้องการดำเนินการต่อหรือไม่',
      details,
    });
  }

  return null;
}

function normalizeWhtDetailRows(rows, dueDateFallback) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row, index) => {
      const amount = asNumber(firstPaymentValue(row, 'amount', 'sum_amount', 'base_amount'));
      const taxRate = asNumber(firstPaymentValue(row, 'tax_rate', 'rate'));
      const taxValueInput = firstPaymentValue(row, 'tax_value', 'tax_amount');
      const taxValue = taxValueInput === undefined ? roundMoney(amount * (taxRate / 100)) : asNumber(taxValueInput);
      return {
        line_number: asNumber(firstPaymentValue(row, 'line_number', 'lineNumber'), index),
        income_type: asText(firstPaymentValue(row, 'income_type', 'tax_type', 'code')),
        amount,
        tax_rate: taxRate,
        tax_value: taxValue,
        sum_amount: asNumber(firstPaymentValue(row, 'sum_amount'), amount),
        due_date: normalizeDateString(firstPaymentValue(row, 'due_date')) || dueDateFallback,
      };
    })
    .filter((row) => row.amount > 0 || row.tax_value > 0 || row.income_type);
}

function normalizeWhtHeaders(rows, defaults = {}) {
  if (!Array.isArray(rows)) return [];
  const fallbackDueDate = normalizeDateString(defaults.docDate) || normalizeDateString(new Date());
  const fallbackCustCode = asText(defaults.custCode);
  return rows
    .map((row, index) => {
      const dueDate = normalizeDateString(firstPaymentValue(row, 'due_date', 'doc_date')) || fallbackDueDate;
      const details = normalizeWhtDetailRows(firstPaymentValue(row, 'details', 'detail', 'detail_rows') || [], dueDate);
      const detailAmount = roundMoney(details.reduce((sum, detail) => sum + asNumber(detail.amount), 0));
      const detailTaxValue = roundMoney(details.reduce((sum, detail) => sum + asNumber(detail.tax_value), 0));
      const amount = asNumber(firstPaymentValue(row, 'amount', 'sum_amount'), detailAmount);
      const taxValue = asNumber(firstPaymentValue(row, 'tax_value', 'tax_amount'), detailTaxValue);
      return {
        line_number: asNumber(firstPaymentValue(row, 'line_number', 'lineNumber'), index),
        tax_doc_no: asText(firstPaymentValue(row, 'tax_doc_no', 'taxDocNo', 'wht_doc_no')),
        due_date: dueDate,
        cust_code: asText(firstPaymentValue(row, 'cust_code', 'customer_code'), fallbackCustCode),
        cust_name: asText(firstPaymentValue(row, 'cust_name', 'customer_name')),
        cust_address: asText(firstPaymentValue(row, 'cust_address', 'customer_address')),
        cust_tax_type: asNumber(firstPaymentValue(row, 'cust_tax_type', 'customer_tax_type')),
        tax_number: asText(firstPaymentValue(row, 'tax_number', 'tax_id')),
        card_number: asText(firstPaymentValue(row, 'card_number', 'card_id')),
        amount,
        tax_value: taxValue,
        details,
      };
    })
    .filter((row) => row.tax_doc_no || row.amount > 0 || row.tax_value > 0 || row.details.length > 0);
}

function normalizeGlRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row, index) => ({
      line_number: asNumber(firstPaymentValue(row, 'line_number', 'lineNumber'), index),
      account_code: asText(firstPaymentValue(row, 'account_code', 'code')),
      account_name: asText(firstPaymentValue(row, 'account_name', 'name_1', 'name')),
      debit: asNumber(firstPaymentValue(row, 'debit')),
      credit: asNumber(firstPaymentValue(row, 'credit')),
    }))
    .filter((row) => row.account_code && (row.debit !== 0 || row.credit !== 0));
}

function normalizeGlHeader(rawHeader) {
  if (!rawHeader || typeof rawHeader !== 'object') return null;
  return {
    ref_date: normalizeDateString(firstPaymentValue(rawHeader, 'ref_date', 'refDate')),
    ref_no: asText(firstPaymentValue(rawHeader, 'ref_no', 'refNo')),
    book_code: asText(firstPaymentValue(rawHeader, 'book_code', 'bookCode')),
    journal_type: asNumber(firstPaymentValue(rawHeader, 'journal_type', 'journalType')),
    description: asText(firstPaymentValue(rawHeader, 'description', 'remark')),
    ap_ar_code: asText(firstPaymentValue(rawHeader, 'ap_ar_code', 'apArCode')),
    ap_ar_originate_from: asNumber(firstPaymentValue(rawHeader, 'ap_ar_originate_from', 'apArOriginateFrom')),
  };
}

function normalizeSaleRefBillType(value) {
  const type = parseInt(value, 10) || 0;
  if (type === 1 || type === 2 || type === 3) return type;
  if (type === 30) return 1;
  if (type === 34) return 2;
  if (type === 36) return 3;
  return 0;
}

function normalizeVatRows(rows, defaults = {}) {
  const fallbackDocDate = normalizeDateString(defaults.docDate) || normalizeDateString(new Date());
  const fallbackVatDate = normalizeDateString(defaults.taxDocDate) || fallbackDocDate;
  const fallbackVatNumber = asText(defaults.taxDocNo);
  const fallbackRate = asNumber(defaults.vatRate, 7);
  const fallbackBase = asNumber(defaults.beforeVat);
  const fallbackAmount = asNumber(defaults.vatValue);
  const fallbackExcept = asNumber(defaults.totalExceptVat);
  const fallbackBranchCode = asText(defaults.branchCode);
  const fallbackTaxNo = asText(defaults.taxNo);

  if (Array.isArray(rows) && rows.length) {
    return rows
      .map((row, index) => {
        const vatDate = normalizeDateString(firstPaymentValue(row, 'vat_date', 'vatDate')) || fallbackVatDate;
        const vatDateObj = new Date(vatDate || fallbackDocDate);
        const period = asNumber(firstPaymentValue(row, 'vat_effective_period', 'period'), Number.isFinite(vatDateObj.getTime()) ? vatDateObj.getMonth() + 1 : 0);
        const year = asNumber(firstPaymentValue(row, 'vat_effective_year', 'year'), Number.isFinite(vatDateObj.getTime()) ? vatDateObj.getFullYear() + 543 : 0);
        const inputBaseAmount = asNumber(firstPaymentValue(row, 'base_caltax_amount', 'base_amount'));
        const taxRate = asNumber(firstPaymentValue(row, 'tax_rate', 'rate'), fallbackRate);
        const amountInput = firstPaymentValue(row, 'amount', 'tax_amount');
        const inputAmount = amountInput === undefined ? roundMoney((inputBaseAmount * taxRate) / 100) : asNumber(amountInput);
        const inputExcept = asNumber(firstPaymentValue(row, 'except_tax_amount', 'except_amount'));
        const manualAdd = asNumber(firstPaymentValue(row, 'manual_add', 'manualAdd'));
        const useDocumentVat =
          index === 0
          && manualAdd === 0
          && inputBaseAmount === 0
          && inputAmount === 0
          && inputExcept === 0
          && fallbackBase > 0
          && fallbackAmount > 0;
        const baseAmount = useDocumentVat ? fallbackBase : inputBaseAmount;
        const amount = useDocumentVat ? fallbackAmount : inputAmount;
        return {
          line_number: asNumber(firstPaymentValue(row, 'line_number', 'lineNumber'), index),
          vat_date: vatDate,
          vat_number: asText(firstPaymentValue(row, 'vat_number', 'vat_doc_no', 'tax_doc_no'), fallbackVatNumber),
          vat_effective_period: period,
          vat_effective_year: year,
          description: asText(firstPaymentValue(row, 'description', 'remark')),
          tax_group: asText(firstPaymentValue(row, 'tax_group', 'taxGroup')),
          base_caltax_amount: baseAmount,
          tax_rate: taxRate,
          amount,
          except_tax_amount: useDocumentVat ? fallbackExcept : inputExcept,
          vat_type: asNumber(firstPaymentValue(row, 'vat_type', 'vatType')),
          is_add: asNumber(firstPaymentValue(row, 'is_add', 'isAdd')),
          ar_name: asText(firstPaymentValue(row, 'ar_name', 'customer_name')),
          tax_no: asText(firstPaymentValue(row, 'tax_no', 'tax_number'), fallbackTaxNo),
          branch_type: asNumber(firstPaymentValue(row, 'branch_type', 'branchType')),
          branch_code: asText(firstPaymentValue(row, 'branch_code', 'branchCode'), fallbackBranchCode),
          manual_add: manualAdd,
          ref_vat_no: asText(firstPaymentValue(row, 'ref_vat_no')),
          ref_vat_date: normalizeDateString(firstPaymentValue(row, 'ref_vat_date')),
          ref_doc_no: asText(firstPaymentValue(row, 'ref_doc_no')),
          ref_doc_date: normalizeDateString(firstPaymentValue(row, 'ref_doc_date')),
        };
      })
      .filter((row) => row.vat_number || row.base_caltax_amount > 0 || row.amount > 0 || row.description);
  }

  if (!fallbackVatNumber && fallbackBase <= 0 && fallbackAmount <= 0 && fallbackExcept <= 0) return [];
  const dateObj = new Date(fallbackVatDate || fallbackDocDate);
  return [
    {
      line_number: 0,
      vat_date: fallbackVatDate,
      vat_number: fallbackVatNumber,
      vat_effective_period: Number.isFinite(dateObj.getTime()) ? dateObj.getMonth() + 1 : 0,
      vat_effective_year: Number.isFinite(dateObj.getTime()) ? dateObj.getFullYear() + 543 : 0,
      description: asText(defaults.description),
      tax_group: '',
      base_caltax_amount: fallbackBase,
      tax_rate: fallbackRate,
      amount: fallbackAmount,
      except_tax_amount: fallbackExcept,
      vat_type: 0,
      is_add: 0,
      ar_name: asText(defaults.arName),
      tax_no: fallbackTaxNo,
      branch_type: 0,
      branch_code: fallbackBranchCode,
      manual_add: 0,
      ref_vat_no: '',
      ref_vat_date: null,
      ref_doc_no: '',
      ref_doc_date: null,
    },
  ];
}

async function loadCustomerTaxInfo(client, custCode) {
  const result = await client.query(
    `SELECT c.code, COALESCE(c.name_1, '') AS name_1, COALESCE(c.address, '') AS address,
            COALESCE(d.tax_id, '') AS tax_id, COALESCE(d.branch_code, '') AS branch_code
     FROM ar_customer c
     LEFT JOIN ar_customer_detail d ON d.ar_code = c.code
     WHERE c.code = $1
     LIMIT 1`,
    [custCode],
  );
  return result.rows[0] || {};
}

async function saveSaleShipment(client, { docNo, docDate, custCode, shipment = {} }) {
  await deleteExistingTableRows(client, 'ic_trans_shipment', 'doc_no = $1 AND trans_flag = 44', [docNo]);
  const hasShipment = Object.values(shipment || {}).some((value) => asText(value) !== '');
  if (!hasShipment) return;
  await insertExistingColumns(client, 'ic_trans_shipment', {
    doc_no: docNo,
    doc_date: docDate,
    trans_flag: 44,
    cust_code: custCode,
    transport_name: asText(shipment.transport_name),
    transport_address: asText(shipment.transport_address),
    transport_telephone: asText(shipment.transport_telephone),
    transport_fax: asText(shipment.transport_fax),
    transport_tambon: asText(shipment.transport_tambon),
    transport_amper: asText(shipment.transport_amper),
    transport_province: asText(shipment.transport_province),
    transport_country: asText(shipment.transport_country),
    transport_code: asText(shipment.transport_code),
    destination: asText(shipment.destination),
    remark: asText(shipment.remark),
    remark_2: asText(shipment.remark_2),
    ship_code: asText(shipment.ship_code),
    logistic_area: asText(shipment.logistic_area),
    latitude: asNumber(shipment.latitude),
    longitude: asNumber(shipment.longitude),
    zipcode: asText(shipment.zipcode),
    create_date_time_now: new Date(),
  });
}

async function saveSaleVatRows(client, { docNo, docDate, transFlag, custCode, branchCode, arName, vatRows = [] }) {
  await deleteExistingTableRows(client, 'gl_journal_vat_sale', 'doc_no = $1 AND trans_flag = $2', [docNo, transFlag]);
  if (!vatRows.length) return;

  for (let index = 0; index < vatRows.length; index += 1) {
    const row = vatRows[index];
    const vatDate = normalizeDateString(row.vat_date) || docDate;
    const dateObj = new Date(vatDate || docDate);
    const effectivePeriod = asNumber(row.vat_effective_period, Number.isFinite(dateObj.getTime()) ? dateObj.getMonth() + 1 : 0);
    const effectiveYear = asNumber(row.vat_effective_year, Number.isFinite(dateObj.getTime()) ? dateObj.getFullYear() + 543 : 0);
    await insertExistingColumns(client, 'gl_journal_vat_sale', {
      ignore_sync: 0,
      is_lock_record: 0,
      doc_date: docDate,
      doc_no: docNo,
      book_code: '',
      line_number: index,
      vat_number: asText(row.vat_number),
      tax_group: asText(row.tax_group),
      description: asText(row.description),
      base_caltax_amount: asNumber(row.base_caltax_amount),
      tax_rate: asNumber(row.tax_rate),
      amount: asNumber(row.amount),
      except_tax_amount: asNumber(row.except_tax_amount),
      period_number: 0,
      is_add: asNumber(row.is_add),
      vat_date: vatDate,
      trans_type: 2,
      trans_flag: transFlag,
      vat_effective_period: effectivePeriod,
      ar_code: custCode,
      ar_name: asText(row.ar_name, arName),
      vat_calc: 1,
      vat_effective_year: effectiveYear,
      branch_type: asNumber(row.branch_type),
      branch_code: asText(row.branch_code, branchCode),
      tax_no: asText(row.tax_no),
      manual_add: asNumber(row.manual_add),
      is_doc_copy: 0,
      create_date_time_now: new Date(),
      vat_type: asNumber(row.vat_type),
      ref_vat_no: asText(row.ref_vat_no),
      ref_vat_date: normalizeDateString(row.ref_vat_date) || null,
      ref_doc_no: asText(row.ref_doc_no),
      ref_doc_date: normalizeDateString(row.ref_doc_date) || null,
    });
  }
}

async function saveSaleWht(client, { docNo, docDate, custCode, whtHeaders, customerInfo }) {
  await deleteExistingTableRows(client, 'gl_wht_list_detail', 'doc_no = $1 AND trans_flag = 44', [docNo]);
  await deleteExistingTableRows(client, 'gl_wht_list', 'doc_no = $1 AND trans_flag = 44', [docNo]);
  if (!whtHeaders.length) return;

  for (let headerIndex = 0; headerIndex < whtHeaders.length; headerIndex += 1) {
    const header = whtHeaders[headerIndex];
    if (!asText(header.tax_doc_no) && asNumber(header.amount) > 0) {
      throw new Error(`WHT header ${headerIndex + 1} missing tax_doc_no`);
    }
    const details = Array.isArray(header.details) ? header.details : [];
    const amount = roundMoney(details.reduce((sum, row) => sum + asNumber(row.amount), 0));
    const taxValue = roundMoney(details.reduce((sum, row) => sum + asNumber(row.tax_value), 0));
    if (!header.tax_doc_no && amount <= 0 && taxValue <= 0) continue;

    await insertExistingColumns(client, 'gl_wht_list', {
      doc_date: docDate,
      doc_no: docNo,
      amount,
      tax_value: taxValue,
      status: 0,
      trans_flag: 44,
      due_date: header.due_date || docDate,
      line_number: headerIndex,
      cust_code: asText(header.cust_code, custCode),
      card_number: asText(header.card_number, customerInfo.tax_id),
      tax_number: asText(header.tax_number, customerInfo.tax_id),
      cust_tax_type: asNumber(header.cust_tax_type),
      cust_name: asText(header.cust_name, customerInfo.name_1),
      tax_doc_no: asText(header.tax_doc_no),
      cust_address: asText(header.cust_address, customerInfo.address),
      create_date_time_now: new Date(),
    });

    for (const detail of details) {
      await insertExistingColumns(client, 'gl_wht_list_detail', {
        doc_date: docDate,
        doc_no: docNo,
        income_type: detail.income_type,
        tax_rate: detail.tax_rate,
        amount: detail.amount,
        tax_value: detail.tax_value,
        status: 0,
        trans_flag: 44,
        due_date: detail.due_date || header.due_date || docDate,
        line_number: detail.line_number,
        cust_code: asText(header.cust_code, custCode),
        sum_amount: detail.sum_amount || detail.amount,
        tax_doc_no: asText(header.tax_doc_no),
        create_date_time_now: new Date(),
      });
    }
  }
}

async function loadErpOptionTextValues(client, candidateColumns = []) {
  if (!candidateColumns.length) return {};
  const columns = await getTableColumnSet(client, 'erp_option');
  const availableColumns = candidateColumns.filter((column) => columns.has(column));
  if (!availableColumns.length) return {};

  const selectList = availableColumns.map((column) => `COALESCE(${column}::text, '') AS ${column}`);
  const result = await client.query(`SELECT ${selectList.join(', ')} FROM erp_option LIMIT 1`);
  return result.rows[0] || {};
}

function pickFirstTextValue(source, keys = []) {
  for (const key of keys) {
    const value = asText(source?.[key]);
    if (value) return value;
  }
  return '';
}

async function loadCustomerArAccountCode(client, custCode) {
  if (!asText(custCode)) return '';
  const columns = await getTableColumnSet(client, 'ar_customer_detail');
  if (!columns.has('account_code')) return '';
  const result = await client.query(
    `SELECT COALESCE(account_code, '') AS account_code
     FROM ar_customer_detail
     WHERE ar_code = $1
     LIMIT 1`,
    [custCode],
  );
  return asText(result.rows[0]?.account_code);
}

async function loadItemIncomeAccountMap(client, items = []) {
  const itemCodes = [...new Set(items.map((item) => asText(item?.item_code)).filter((code) => code && code !== '.'))];
  if (!itemCodes.length) return new Map();

  let tableName = '';
  if (await tableExists(client, 'ic_inventory')) tableName = 'ic_inventory';
  else if (await tableExists(client, 'ic_item')) tableName = 'ic_item';
  if (!tableName) return new Map();

  const tableColumns = await getTableColumnSet(client, tableName);
  const accountColumn = ['account_code_3', 'income_acc_code', 'sale_account_code', 'account_code']
    .find((column) => tableColumns.has(column));
  if (!accountColumn) return new Map();

  const result = await client.query(
    `SELECT code, COALESCE(${accountColumn}, '') AS income_account_code
     FROM ${tableName}
     WHERE code = ANY($1::text[])`,
    [itemCodes],
  );
  return new Map(result.rows.map((row) => [asText(row.code), asText(row.income_account_code)]));
}

function resolveInventoryGlMode(rawValue) {
  const normalized = asText(rawValue).toLowerCase();
  if (!normalized) return 'unknown';
  if (normalized.includes('perpetual')) return 'perpetual';
  if (normalized.includes('periodic')) return 'periodic';
  if (normalized === '1' || normalized === 'true' || normalized === 't') return 'perpetual';
  if (normalized === '0' || normalized === 'false' || normalized === 'f') return 'periodic';
  return 'unknown';
}

function flattenCostPostingItems(items = []) {
  const rows = [];
  for (const item of items) {
    const itemCode = asText(item?.item_code);
    if (!itemCode || itemCode === '.') continue;

    const itemType = asNumber(item?.item_type);
    if (itemType === 1) continue; // service

    if (itemType === 3 && Array.isArray(item.sub_item) && item.sub_item.length) {
      const parentQty = asNumber(item.qty);
      if (parentQty <= 0) continue;
      for (const child of item.sub_item) {
        const childCode = asText(child?.item_code);
        if (!childCode || childCode === '.') continue;
        const childQtyPerSet = asNumber(child?.qty);
        const totalQty = parentQty * childQtyPerSet;
        if (totalQty <= 0) continue;
        rows.push({
          item_code: childCode,
          qty: totalQty,
          stand_value: asNumber(child?.stand_value, 1),
          divide_value: asNumber(child?.divide_value, 1),
          wh_code: asText(child?.wh_code) || asText(item?.wh_code),
          shelf_code: asText(child?.shelf_code) || asText(item?.shelf_code),
          unit_cost_hint: asNumber(
            firstPaymentValue(
              child,
              'unit_cost',
              'cost_price',
              'cost',
              'average_cost',
              'last_cost',
              'std_cost',
            ),
          ),
          total_cost_hint: asNumber(
            firstPaymentValue(
              child,
              'sum_cost',
              'cost_amount',
              'total_cost',
            ),
          ),
        });
      }
      continue;
    }

    const qty = asNumber(item?.qty);
    if (qty <= 0) continue;
    rows.push({
      item_code: itemCode,
      qty,
      stand_value: asNumber(item?.stand_value, 1),
      divide_value: asNumber(item?.divide_value, 1),
      wh_code: asText(item?.wh_code),
      shelf_code: asText(item?.shelf_code),
      unit_cost_hint: asNumber(
        firstPaymentValue(
          item,
          'unit_cost',
          'cost_price',
          'cost',
          'average_cost',
          'last_cost',
          'std_cost',
        ),
      ),
      total_cost_hint: asNumber(
        firstPaymentValue(
          item,
          'sum_cost',
          'cost_amount',
          'total_cost',
        ),
      ),
    });
  }
  return rows;
}

async function loadItemCostAndAccountsMap(client, itemCodes = []) {
  const codes = [...new Set(itemCodes.map((code) => asText(code)).filter((code) => code && code !== '.'))];
  if (!codes.length) return new Map();

  let tableName = '';
  if (await tableExists(client, 'ic_inventory')) tableName = 'ic_inventory';
  else if (await tableExists(client, 'ic_item')) tableName = 'ic_item';
  if (!tableName) return new Map();

  const columns = await getTableColumnSet(client, tableName);
  const inventoryAccountColumn = ['account_code_1', 'item_acc_code', 'stock_account_code'].find((column) => columns.has(column));
  const costAccountColumn = ['account_code_2', 'cost_acc_code', 'cogs_account_code'].find((column) => columns.has(column));
  const costColumn = ['average_cost', 'cost_price', 'last_cost', 'std_cost', 'cost', 'balance_cost'].find((column) => columns.has(column));

  if (!inventoryAccountColumn && !costAccountColumn) return new Map();
  const selectColumns = [
    'code',
    inventoryAccountColumn ? `COALESCE(${inventoryAccountColumn}, '') AS inventory_account_code` : "'' AS inventory_account_code",
    costAccountColumn ? `COALESCE(${costAccountColumn}, '') AS cost_account_code` : "'' AS cost_account_code",
    costColumn ? `COALESCE(${costColumn}, 0)::numeric AS unit_cost` : '0::numeric AS unit_cost',
  ];

  const result = await client.query(
    `SELECT ${selectColumns.join(', ')}
     FROM ${tableName}
     WHERE code = ANY($1::text[])`,
    [codes],
  );

  return new Map(result.rows.map((row) => [asText(row.code), {
    inventory_account_code: asText(row.inventory_account_code),
    cost_account_code: asText(row.cost_account_code),
    unit_cost: asNumber(row.unit_cost),
  }]));
}

async function loadMovementUnitCostMap(client, rows = [], docDate = '') {
  const targetDate = normalizeDateString(docDate) || new Date().toISOString().slice(0, 10);
  const uniqueRows = [];
  const seen = new Set();

  for (const row of rows || []) {
    const itemCode = asText(row?.item_code);
    if (!itemCode || itemCode === '.') continue;
    const whCode = asText(row?.wh_code);
    const shelfCode = asText(row?.shelf_code);
    const key = `${itemCode}|${whCode}|${shelfCode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueRows.push({ itemCode, whCode, shelfCode, key });
  }

  if (!uniqueRows.length) return new Map();

  const costMap = new Map();
  for (const row of uniqueRows) {
    try {
      const result = await client.query(
        `SELECT COALESCE(MAX(average_cost_end), MAX(average_cost), 0)::numeric AS unit_cost
         FROM sml_ic_function_stock_balance_warehouse_location(
           $1::date,
           $2,
           $3,
           $4
         )`,
        [targetDate, row.itemCode, row.whCode || '', row.shelfCode || ''],
      );
      costMap.set(row.key, asNumber(result.rows[0]?.unit_cost));
    } catch (error) {
      // Keep save flow resilient when movement function is unavailable in some environments.
      costMap.set(row.key, 0);
    }
  }

  return costMap;
}

function addAmountByAccount(targetMap, accountCode, amount) {
  const code = asText(accountCode);
  const value = roundMoney(amount);
  if (!code || value === 0) return;
  targetMap.set(code, roundMoney((targetMap.get(code) || 0) + value));
}

async function loadPaymentDebitAccountMaps(client, payments = []) {
  const maps = {
    passBook: new Map(),
    creditType: new Map(),
    pettyCash: new Map(),
    wallet: new Map(),
    incomeType: new Map(),
    expenseType: new Map(),
  };

  const passBookCodes = [...new Set(payments
    .filter((payment) => payment.doc_type === 1 || payment.doc_type === 2)
    .map((payment) => asText(payment.pass_book_code || payment.trans_number))
    .filter(Boolean))];
  if (passBookCodes.length && await tableExists(client, 'erp_pass_book')) {
    const columns = await getTableColumnSet(client, 'erp_pass_book');
    const accountColumn = ['account_code_1', 'account_code', 'gl_account_code'].find((column) => columns.has(column));
    if (accountColumn) {
      const result = await client.query(
        `SELECT code, COALESCE(${accountColumn}, '') AS account_code
         FROM erp_pass_book
         WHERE code = ANY($1::text[])`,
        [passBookCodes],
      );
      maps.passBook = new Map(result.rows.map((row) => [asText(row.code), asText(row.account_code)]));
    }
  }

  const creditTypeCodes = [...new Set(payments
    .filter((payment) => payment.doc_type === 3)
    .map((payment) => asText(payment.credit_card_type))
    .filter(Boolean))];
  if (creditTypeCodes.length && await tableExists(client, 'erp_credit_type')) {
    const columns = await getTableColumnSet(client, 'erp_credit_type');
    const accountColumn = ['account_code', 'gl_account_code', 'account_code_1'].find((column) => columns.has(column));
    if (accountColumn) {
      const result = await client.query(
        `SELECT code, COALESCE(${accountColumn}, '') AS account_code
         FROM erp_credit_type
         WHERE code = ANY($1::text[])`,
        [creditTypeCodes],
      );
      maps.creditType = new Map(result.rows.map((row) => [asText(row.code), asText(row.account_code)]));
    }
  }

  const pettyCodes = [...new Set(payments
    .filter((payment) => payment.doc_type === 4)
    .map((payment) => asText(payment.trans_number))
    .filter(Boolean))];
  if (pettyCodes.length && await tableExists(client, 'cb_petty_cash')) {
    const columns = await getTableColumnSet(client, 'cb_petty_cash');
    const accountColumn = ['account_code', 'gl_account_code'].find((column) => columns.has(column));
    if (accountColumn) {
      const result = await client.query(
        `SELECT code, COALESCE(${accountColumn}, '') AS account_code
         FROM cb_petty_cash
         WHERE code = ANY($1::text[])`,
        [pettyCodes],
      );
      maps.pettyCash = new Map(result.rows.map((row) => [asText(row.code), asText(row.account_code)]));
    }
  }

  const walletCodes = [...new Set(payments
    .filter((payment) => payment.doc_type === 21)
    .map((payment) => asText(payment.credit_card_type))
    .filter(Boolean))];
  if (walletCodes.length && await tableExists(client, 'erp_wallet_list')) {
    const columns = await getTableColumnSet(client, 'erp_wallet_list');
    const accountColumn = ['account_code', 'gl_account_code'].find((column) => columns.has(column));
    if (accountColumn) {
      const result = await client.query(
        `SELECT code, COALESCE(${accountColumn}, '') AS account_code
         FROM erp_wallet_list
         WHERE code = ANY($1::text[])`,
        [walletCodes],
      );
      maps.wallet = new Map(result.rows.map((row) => [asText(row.code), asText(row.account_code)]));
    }
  }

  const incomeCodes = [...new Set(payments
    .filter((payment) => payment.doc_type === 12)
    .map((payment) => asText(payment.trans_number))
    .filter(Boolean))];
  if (incomeCodes.length && await tableExists(client, 'erp_income_list')) {
    const columns = await getTableColumnSet(client, 'erp_income_list');
    const accountColumn = ['gl_account_code', 'account_code'].find((column) => columns.has(column));
    if (accountColumn) {
      const result = await client.query(
        `SELECT code, COALESCE(${accountColumn}, '') AS account_code
         FROM erp_income_list
         WHERE code = ANY($1::text[])`,
        [incomeCodes],
      );
      maps.incomeType = new Map(result.rows.map((row) => [asText(row.code), asText(row.account_code)]));
    }
  }

  const expenseCodes = [...new Set(payments
    .filter((payment) => payment.doc_type === 11)
    .map((payment) => asText(payment.trans_number))
    .filter(Boolean))];
  if (expenseCodes.length && await tableExists(client, 'erp_expenses_list')) {
    const columns = await getTableColumnSet(client, 'erp_expenses_list');
    const accountColumn = ['gl_account_code', 'account_code'].find((column) => columns.has(column));
    if (accountColumn) {
      const result = await client.query(
        `SELECT code, COALESCE(${accountColumn}, '') AS account_code
         FROM erp_expenses_list
         WHERE code = ANY($1::text[])`,
        [expenseCodes],
      );
      maps.expenseType = new Map(result.rows.map((row) => [asText(row.code), asText(row.account_code)]));
    }
  }

  return maps;
}

async function loadGlAccountNameMap(client, accountCodes = []) {
  const uniqueCodes = [...new Set(accountCodes.map((code) => asText(code)).filter(Boolean))];
  if (!uniqueCodes.length) return new Map();
  if (!(await tableExists(client, 'gl_chart_of_account'))) return new Map();

  const result = await client.query(
    `SELECT code, COALESCE(name_1, code) AS name_1
     FROM gl_chart_of_account
     WHERE code = ANY($1::text[])`,
    [uniqueCodes],
  );
  return new Map(result.rows.map((row) => [asText(row.code), asText(row.name_1, asText(row.code))]));
}

async function buildAutoSaleGlRows(client, {
  custCode,
  items,
  payments,
  docDate,
  beforeVat,
  vatValue,
  totalAmount,
  isCreditSale,
  inventoryGlModeOverride,
}) {
  const optionCandidates = [
    'sale_account_code',
    'income_account_code',
    'sale_income_account_code',
    'income_acc_code',
    'account_code_3',
    'sale_cash_account_code',
    'cash_account_code',
    'cash_in_hand_account_code',
    'receive_cash_account_code',
    'sale_ar_account_code',
    'ar_account_code',
    'ar_sale_account_code',
    'credit_card_account_code',
    'wallet_account_code',
    'deposit_account_code',
    'coupon_account_code',
    'income_other_account_code',
    'expense_other_account_code',
    'chq_income_account_code',
    'vat_sale_account_code',
    'vat_output_account_code',
    'output_vat_account_code',
    'sale_vat_account_code',
    'vat_account_code',
    'inventory_gl_post',
  ];
  const optionValues = await loadErpOptionTextValues(client, optionCandidates);
  const customerArAccount = await loadCustomerArAccountCode(client, custCode);
  const itemIncomeAccountMap = await loadItemIncomeAccountMap(client, items);
  const paymentAccountMaps = await loadPaymentDebitAccountMaps(client, payments);

  const debitAccountCode = isCreditSale
    ? (customerArAccount || pickFirstTextValue(optionValues, ['sale_ar_account_code', 'ar_account_code', 'ar_sale_account_code']))
    : pickFirstTextValue(optionValues, ['sale_cash_account_code', 'cash_account_code', 'cash_in_hand_account_code', 'receive_cash_account_code'])
      || customerArAccount
      || pickFirstTextValue(optionValues, ['sale_ar_account_code', 'ar_account_code', 'ar_sale_account_code']);

  const defaultSaleAccountCode = pickFirstTextValue(optionValues, [
    'sale_account_code',
    'income_account_code',
    'sale_income_account_code',
    'income_acc_code',
    'account_code_3',
  ]);
  const vatAccountCode = pickFirstTextValue(optionValues, [
    'vat_sale_account_code',
    'vat_output_account_code',
    'output_vat_account_code',
    'sale_vat_account_code',
    'vat_account_code',
  ]);

  const salesByAccount = new Map();
  for (const item of items) {
    const itemCode = asText(item?.item_code);
    if (!itemCode || itemCode === '.') continue;
    const rawSumAmount = asNumber(item?.sum_amount);
    if (rawSumAmount <= 0) continue;
    const taxType = asNumber(item?.tax_type);
    const baseAmount = taxType === 1
      ? rawSumAmount
      : (vatValue > 0 && totalAmount > 0
        ? roundMoney(rawSumAmount * (asNumber(beforeVat) / asNumber(totalAmount)))
        : rawSumAmount);
    if (baseAmount <= 0) continue;

    const accountCode = asText(itemIncomeAccountMap.get(itemCode)) || defaultSaleAccountCode;
    if (!accountCode) continue;
    salesByAccount.set(accountCode, roundMoney((salesByAccount.get(accountCode) || 0) + baseAmount));
  }

  const rows = [];
  const debitByAccount = new Map();
  if (isCreditSale) {
    addAmountByAccount(debitByAccount, debitAccountCode, totalAmount);
  } else {
    const safePayments = Array.isArray(payments) ? payments : [];
    for (const payment of safePayments) {
      const amount = roundMoney(getPaymentBaseAmount(payment));
      if (amount <= 0) continue;
      const transNumber = asText(payment.trans_number);
      const passBookCode = asText(payment.pass_book_code || transNumber);
      const creditCardType = asText(payment.credit_card_type);
      let accountCode = '';
      switch (asNumber(payment.doc_type)) {
        case 1: // transfer
          accountCode = asText(paymentAccountMaps.passBook.get(passBookCode));
          break;
        case 2: // cheque
          accountCode = asText(paymentAccountMaps.passBook.get(passBookCode))
            || pickFirstTextValue(optionValues, ['chq_income_account_code']);
          break;
        case 3: // credit card
          accountCode = asText(paymentAccountMaps.creditType.get(creditCardType))
            || pickFirstTextValue(optionValues, ['credit_card_account_code']);
          break;
        case 4: // petty cash
          accountCode = asText(paymentAccountMaps.pettyCash.get(transNumber));
          break;
        case 5: // advance
        case 6: // deposit
          accountCode = pickFirstTextValue(optionValues, ['deposit_account_code']);
          break;
        case 9: // coupon
          accountCode = pickFirstTextValue(optionValues, ['coupon_account_code']);
          break;
        case 11: // expense other
          accountCode = asText(paymentAccountMaps.expenseType.get(transNumber))
            || pickFirstTextValue(optionValues, ['expense_other_account_code']);
          break;
        case 12: // income other
          accountCode = asText(paymentAccountMaps.incomeType.get(transNumber))
            || pickFirstTextValue(optionValues, ['income_other_account_code']);
          break;
        case 19: // other currency
          accountCode = pickFirstTextValue(optionValues, ['cash_account_code', 'cash_in_hand_account_code', 'receive_cash_account_code']);
          break;
        case 21: // wallet
          accountCode = asText(paymentAccountMaps.wallet.get(creditCardType))
            || pickFirstTextValue(optionValues, ['wallet_account_code']);
          break;
        default:
          break;
      }
      addAmountByAccount(debitByAccount, accountCode || debitAccountCode, amount);
    }
    if (debitByAccount.size === 0) {
      addAmountByAccount(debitByAccount, debitAccountCode, totalAmount);
    }
  }

  for (const [accountCode, amount] of debitByAccount.entries()) {
    rows.push({
      line_number: rows.length,
      account_code: accountCode,
      debit: roundMoney(amount),
      credit: 0,
    });
  }

  for (const [accountCode, amount] of salesByAccount.entries()) {
    if (amount <= 0) continue;
    rows.push({
      line_number: rows.length,
      account_code: accountCode,
      debit: 0,
      credit: roundMoney(amount),
    });
  }

  if (vatAccountCode && asNumber(vatValue) > 0) {
    rows.push({
      line_number: rows.length,
      account_code: vatAccountCode,
      debit: 0,
      credit: roundMoney(vatValue),
    });
  }

  const inventoryGlMode = resolveInventoryGlMode(inventoryGlModeOverride) !== 'unknown'
    ? resolveInventoryGlMode(inventoryGlModeOverride)
    : resolveInventoryGlMode(optionValues.inventory_gl_post);
  if (inventoryGlMode === 'perpetual') {
    const costItems = flattenCostPostingItems(items);
    const itemCostMap = await loadItemCostAndAccountsMap(client, costItems.map((row) => row.item_code));
    const movementCostMap = await loadMovementUnitCostMap(client, costItems, docDate);
    const cogsByAccount = new Map();
    const inventoryByAccount = new Map();

    for (const row of costItems) {
      const itemInfo = itemCostMap.get(asText(row.item_code));
      if (!itemInfo) continue;
      const ratio = unitRatioValue(row);
      const qtyBase = asNumber(row.qty) * ratio;
      if (qtyBase <= 0) continue;

      const movementUnitCost = asNumber(
        movementCostMap.get(`${asText(row.item_code)}|${asText(row.wh_code)}|${asText(row.shelf_code)}`),
      );
      // Prefer movement/layer cost ณ วันที่เอกสาร; fallback to payload/master cost.
      const payloadUnitCost = asNumber(row.unit_cost_hint);
      const payloadTotalCost = asNumber(row.total_cost_hint);
      const unitCost = movementUnitCost > 0
        ? movementUnitCost
        : (payloadUnitCost > 0 ? payloadUnitCost : asNumber(itemInfo.unit_cost));
      const lineCost = payloadTotalCost > 0
        ? (movementUnitCost > 0 ? roundMoney(qtyBase * movementUnitCost) : roundMoney(payloadTotalCost))
        : roundMoney(qtyBase * unitCost);
      if (lineCost <= 0) continue;
      addAmountByAccount(cogsByAccount, itemInfo.cost_account_code, lineCost);
      addAmountByAccount(inventoryByAccount, itemInfo.inventory_account_code, lineCost);
    }

    for (const [accountCode, amount] of cogsByAccount.entries()) {
      rows.push({
        line_number: rows.length,
        account_code: accountCode,
        debit: roundMoney(amount),
        credit: 0,
      });
    }
    for (const [accountCode, amount] of inventoryByAccount.entries()) {
      rows.push({
        line_number: rows.length,
        account_code: accountCode,
        debit: 0,
        credit: roundMoney(amount),
      });
    }
  }

  // Balance safeguard: if VAT account isn't configured (or rounding differs), adjust last credit line.
  const totalDebit = roundMoney(rows.reduce((sum, row) => sum + asNumber(row.debit), 0));
  const totalCredit = roundMoney(rows.reduce((sum, row) => sum + asNumber(row.credit), 0));
  const diff = roundMoney(totalDebit - totalCredit);
  if (Math.abs(diff) > 0) {
    const lastCreditIndex = rows.map((row, index) => ({ row, index })).reverse().find(({ row }) => asNumber(row.credit) > 0)?.index;
    if (lastCreditIndex !== undefined) {
      rows[lastCreditIndex].credit = roundMoney(asNumber(rows[lastCreditIndex].credit) + diff);
    }
  }

  const accountNameMap = await loadGlAccountNameMap(client, rows.map((row) => row.account_code));
  return rows
    .map((row, index) => ({
      line_number: index,
      account_code: row.account_code,
      account_name: asText(accountNameMap.get(row.account_code), row.account_code),
      debit: roundMoney(row.debit),
      credit: roundMoney(row.credit),
    }))
    .filter((row) => row.account_code && (row.debit !== 0 || row.credit !== 0));
}

async function saveSaleManualGl(client, {
  docNo,
  docDate,
  docTime,
  docFormatCode,
  branchCode,
  remark,
  transDirect,
  glRows,
  glHeader,
  autoGlContext,
}) {
  await deleteExistingTableRows(client, 'gl_trans_detail', 'doc_no = $1 AND trans_flag = 44', [docNo]);
  await deleteExistingTableRows(client, 'gl_trans', 'doc_no = $1 AND trans_flag = 44', [docNo]);
  const glMode = asNumber(transDirect, 1) === 1 ? 1 : 0;
  let finalGlRows = glMode === 1 ? glRows : [];
  if (glMode === 0 && autoGlContext) {
    finalGlRows = await buildAutoSaleGlRows(client, autoGlContext);
  }
  if (!finalGlRows.length) return;

  const date = new Date(docDate);
  const period = Number.isNaN(date.getTime()) ? 0 : date.getMonth() + 1;
  const accountYear = Number.isNaN(date.getTime()) ? 0 : date.getFullYear() + 543;
  await insertExistingColumns(client, 'gl_trans', {
    doc_date: docDate,
    doc_no: docNo,
    trans_flag: 44,
    doc_format_code: docFormatCode,
    account_period: period,
    account_year: accountYear,
    branch_code: branchCode,
    remark,
    trans_direct: glMode,
    book_code: asText(glHeader?.book_code),
    ref_date: normalizeDateString(glHeader?.ref_date),
    ref_no: asText(glHeader?.ref_no),
    journal_type: asNumber(glHeader?.journal_type),
    description: asText(glHeader?.description),
    ap_ar_code: asText(glHeader?.ap_ar_code),
    ap_ar_originate_from: asNumber(glHeader?.ap_ar_originate_from),
    doc_time: docTime,
    create_date_time_now: new Date(),
  });

  for (const row of finalGlRows) {
    await insertExistingColumns(client, 'gl_trans_detail', {
      doc_date: docDate,
      doc_no: docNo,
      trans_flag: 44,
      account_code: row.account_code,
      account_name: row.account_name,
      debit: row.debit,
      credit: row.credit,
      line_number: row.line_number,
      create_date_time_now: new Date(),
    });
  }
}

async function getSetSubItemsForSale(client, setCode) {
  const result = await client.query(
    `SELECT d.ic_code AS item_code,
            COALESCE(i.name_1, d.ic_code) AS item_name,
            COALESCE(i.item_type, 0) AS item_type,
            COALESCE(i.tax_type, 0) AS tax_type,
            d.unit_code,
            COALESCE(d.qty, 0) AS qty,
            COALESCE(d.price, 0) AS price,
            COALESCE(d.sum_amount, 0) AS sum_amount,
            COALESCE(d.barcode, '') AS barcode,
            COALESCE(d.price_ratio, 0) AS price_ratio,
            COALESCE(u.stand_value, 1) AS stand_value,
            COALESCE(u.divide_value, 1) AS divide_value,
            d.line_number,
            d.roworder
     FROM ic_inventory_set_detail d
     LEFT JOIN ic_inventory i ON i.code = d.ic_code
     LEFT JOIN ic_unit_use u ON u.ic_code = d.ic_code AND u.code = d.unit_code
     WHERE d.ic_set_code = $1
     ORDER BY COALESCE(d.line_number, d.roworder, 0), COALESCE(d.roworder, 0), d.ic_code`,
    [setCode],
  );
  return result.rows;
}

function mergeSetSubItems(masterSubItems = [], payloadSubItems = []) {
  const payloadByKey = new Map();
  for (const row of payloadSubItems) {
    const key = `${asText(row?.item_code)}|${asText(row?.unit_code)}`;
    if (key !== '|') payloadByKey.set(key, row);
  }
  return masterSubItems.map((master) => {
    const payload = payloadByKey.get(`${asText(master.item_code)}|${asText(master.unit_code)}`) || {};
    return {
      ...master,
      price: payload.price != null ? asNumber(payload.price, asNumber(master.price)) : asNumber(master.price),
      price_ratio: payload.price_ratio != null ? asNumber(payload.price_ratio, asNumber(master.price_ratio)) : asNumber(master.price_ratio),
      barcode: asText(payload.barcode, asText(master.barcode)),
      wh_code: asText(payload.wh_code),
      shelf_code: asText(payload.shelf_code),
    };
  });
}

async function resolveSaleSetChildPrice(subItem, context = {}) {
  const rawPrice = asNumber(subItem?.price);
  if (rawPrice >= 0) {
    return smlRound(rawPrice, context.options?.item_price_decimal ?? 2, context.options?.round_type ?? 0);
  }

  const qty = asNumber(context.parentQty, 1) * asNumber(subItem?.qty, 1);
  const result = await getProductPriceLocalx(
    asText(subItem?.item_code),
    asText(subItem?.unit_code),
    String(qty || 1),
    asText(context.custCode),
    context.vatType,
    context.vatRate,
    context.saleType,
    asText(subItem?.barcode),
    context.docDate,
    asText(context.currencyCode),
  );
  const priceRow = Array.isArray(result?.data) ? result.data[0] : null;
  const resolvedPrice = priceRow ? asNumber(priceRow.price, 0) : 0;
  subItem.price_type = asText(priceRow?.type);
  subItem.price_mode = asText(priceRow?.mode);
  subItem.price_roworder = asText(priceRow?.roworder);
  return smlRound(resolvedPrice, context.options?.item_price_decimal ?? 2, context.options?.round_type ?? 0);
}

function normalizeSetPriceRatios(subItems = [], options = {}) {
  if (!options.fix_item_set_price) return;

  const ratioPoint = 2;
  const roundType = options.round_type ?? 0;
  const totalSetPrice = subItems.reduce((sum, sub) => (
    sum + (asNumber(sub.qty) * asNumber(sub.price))
  ), 0);
  if (totalSetPrice <= 0) return;

  let calcRate = 0;
  let lastRatioIndex = -1;
  for (let index = 0; index < subItems.length; index += 1) {
    const sub = subItems[index];
    const qty = asNumber(sub.qty);
    if (qty <= 0) {
      sub.price_ratio = 0;
      continue;
    }
    const ratio = smlRound(asNumber(sub.price) / totalSetPrice, ratioPoint, roundType);
    sub.price_ratio = ratio;
    calcRate += qty * ratio;
    lastRatioIndex = index;
  }

  const diff = smlRound(1 - calcRate, ratioPoint, roundType);
  if (diff !== 0 && lastRatioIndex >= 0) {
    subItems[lastRatioIndex].price_ratio = smlRound(
      asNumber(subItems[lastRatioIndex].price_ratio) + diff,
      ratioPoint,
      roundType,
    );
  }
}

async function hydrateSaleSetItems(client, items = [], context = {}) {
  for (const item of items) {
    if (String(item?.item_type ?? '0') !== '3') continue;
    const masterSubItems = await getSetSubItemsForSale(client, item.item_code);
    const subItems = mergeSetSubItems(masterSubItems, Array.isArray(item.sub_item) ? item.sub_item : []);
    for (const sub of subItems) {
      sub.price = await resolveSaleSetChildPrice(sub, {
        ...context,
        parentQty: asNumber(item.qty),
      });
    }
    normalizeSetPriceRatios(subItems, context.options || {});
    item.sub_item = subItems;
  }
}

function buildStockValidationItemsFromSaleItems(items = []) {
  const stockItems = [];
  for (const item of items) {
    const itemType = asNumber(item?.item_type);
    if (itemType === 3) {
      const parentQty = asNumber(item.qty);
      const subItems = Array.isArray(item.sub_item) ? item.sub_item : [];
      for (const sub of subItems) {
        const subQty = asNumber(sub.qty);
        stockItems.push({
          ...sub,
          item_type: asNumber(sub.item_type),
          qty: parentQty * subQty,
          wh_code: asText(item.wh_code, asText(sub.wh_code)),
          shelf_code: asText(item.shelf_code, asText(sub.shelf_code)),
          stand_value: asNumber(sub.stand_value, 1),
          divide_value: asNumber(sub.divide_value, 1),
          ratio: 0,
        });
      }
      continue;
    }
    stockItems.push(item);
  }
  return stockItems;
}

function buildSaleTotalMismatchResponse(obj = {}, serverTotals = {}, options = {}) {
  if (obj.accept_server_totals === true || obj.accept_server_totals === 1 || obj.accept_server_totals === '1') return null;

  const amountPoint = options.item_amount_decimal ?? 2;
  const currencyPoint = options.currency_exchange_decimal ?? amountPoint;
  const amountTolerance = 1 / Math.pow(10, amountPoint);
  const currencyTolerance = 1 / Math.pow(10, currencyPoint);
  const hasCurrencyTotals = ['total_value_2', 'total_discount_2', 'total_amount_2'].some((key) => (
    obj[key] !== undefined && obj[key] !== null && obj[key] !== '' && asNumber(obj[key]) !== 0
  ));
  const shouldCheckCurrencyTotals = asText(obj.currency_code) || hasCurrencyTotals;
  const checks = [
    ['total_value', serverTotals.total_value, amountTolerance],
    ['total_discount', serverTotals.total_discount, amountTolerance],
    ['total_before_vat', serverTotals.total_before_vat, amountTolerance],
    ['total_vat_value', serverTotals.total_vat_value, amountTolerance],
    ['total_after_vat', serverTotals.total_after_vat, amountTolerance],
    ['total_except_vat', serverTotals.total_except_vat, amountTolerance],
    ['total_amount', serverTotals.total_amount, amountTolerance],
    ['total_net_amount', serverTotals.total_net_amount, amountTolerance],
  ];
  if (shouldCheckCurrencyTotals) {
    checks.push(
      ['total_value_2', serverTotals.total_value_2, currencyTolerance],
      ['total_discount_2', serverTotals.total_discount_2, currencyTolerance],
      ['total_amount_2', serverTotals.total_amount_2, currencyTolerance],
    );
  }

  const details = [];
  const clientTotals = {};
  for (const [key, serverValue, tolerance] of checks) {
    if (obj[key] === undefined || obj[key] === null || obj[key] === '') continue;
    const clientValue = asNumber(obj[key]);
    clientTotals[key] = clientValue;
    if (Math.abs(clientValue - asNumber(serverValue)) > tolerance) {
      details.push(`${key}: client=${clientValue} server=${serverValue}`);
    }
  }

  if (!details.length) return null;
  return {
    statusCode: 422,
    body: {
      success: false,
      code: 'SALE_TOTAL_MISMATCH',
      level: 'warn',
      title: 'ยอดขายถูกคำนวณใหม่',
      msg: 'ยอดที่หน้าจอส่งมาไม่ตรงกับยอดที่ backend คำนวณจาก company setting',
      message: 'ยอดที่หน้าจอส่งมาไม่ตรงกับยอดที่ backend คำนวณจาก company setting',
      details,
      server_totals: serverTotals,
      client_totals: clientTotals,
    },
  };
}

async function handleSaveTrans(req, res, options = {}) {
  const savePromotionDetails = options.savePromotionDetails === true;
  const enforceTotalMismatch = options.enforceTotalMismatch === true;
  try {
    let obj = req.body;
    if (typeof obj === 'string') obj = JSON.parse(obj);

    const doc_date = obj.doc_date || '';
    let doc_time = obj.doc_time || '';
    const requested_doc_no = asText(obj.doc_no);
    const saveMode = asText(obj.mode || obj.save_mode || obj.edit_mode).toLowerCase();
    const old_doc_no = asText(obj.old_doc_no || obj.original_doc_no || obj.edit_doc_no);
    const isEditSave = saveMode === 'edit' || (!!old_doc_no && old_doc_no === requested_doc_no);
    let doc_format_code = String(obj.doc_format_code || '').trim();
    let form_code = String(obj.form_code || '').trim();
    const cust_code = obj.cust_code || 'AR00001';
    const member_code = asText(obj.member_code);
    const branch_code = obj.branch_code || '';
    const emp_code = obj.emp_code || '';
    const creator_code = String(obj.creator_code || '').trim();
    const pos_id = obj.pos_id || '';
    const wh_code = obj.wh_code || '';
    const shelf_code = obj.shelf_code || '';
    const remark = obj.remark || '';
    const remark_2 = obj.remark_2 || '';
    const remark_3 = obj.remark_3 || '';
    const remark_4 = obj.remark_4 || '';
    const remark_5 = obj.remark_5 || '';
    const send_type = obj.send_type != null ? parseInt(obj.send_type, 10) || 0 : 0;
    const send_day = obj.send_day != null ? parseInt(obj.send_day, 10) || 0 : 0;
    const send_date = normalizeDateString(obj.send_date) || doc_date;
    const delivery_date = normalizeDateString(obj.delivery_date) || send_date;
    const credit_day = obj.credit_day != null ? parseInt(obj.credit_day, 10) || 0 : 0;
    const due_date = normalizeDateString(obj.due_date) || normalizeDateString(obj.credit_date) || doc_date;
    const credit_date = normalizeDateString(obj.credit_date) || due_date;
    const transport_code = obj.transport_code || '';
    const currency_code = obj.currency_code || '';
    const exchange_rate = asNumber(obj.exchange_rate, 1);
    let total_value_2 = asNumber(obj.total_value_2);
    let total_discount_2 = asNumber(obj.total_discount_2);
    let total_amount_2 = asNumber(obj.total_amount_2);
    const discount_word_2 = obj.discount_word_2 || '';
    const tax_doc_no_input = asText(obj.tax_doc_no);
    const raw_tax_doc_date_input = asText(obj.tax_doc_date);
    const tax_doc_date_input = normalizeDateString(raw_tax_doc_date_input) || doc_date;
    const vat_sale = obj.vat_sale && typeof obj.vat_sale === 'object' ? obj.vat_sale : {};
    const vatRows = normalizeVatRows(obj.vat_rows, {
      docDate: doc_date,
      taxDocDate: tax_doc_date_input,
      taxDocNo: tax_doc_no_input || asText(vat_sale.vat_number || vat_sale.tax_doc_no || vat_sale.vat_doc_no),
      vatRate: obj.vat_rate,
      beforeVat: obj.total_before_vat,
      vatValue: obj.total_vat_value,
      totalExceptVat: obj.total_except_vat,
      branchCode: branch_code,
      taxNo: asText(vat_sale.tax_no),
      description: asText(vat_sale.description),
    });
    const shipment = obj.shipment && typeof obj.shipment === 'object' ? obj.shipment : {};
    if (obj.withholding_detail !== undefined) {
      return res.status(400).json({ success: false, msg: 'withholding_detail is no longer supported; please send wht_headers' });
    }
    const whtHeaders = normalizeWhtHeaders(obj.wht_headers, { docDate: doc_date, custCode: cust_code });
    const glRows = normalizeGlRows(obj.gl_detail);
    const glTransDirect = asNumber(obj.gl_trans_direct, glRows.length > 0 ? 1 : 0) === 1 ? 1 : 0;
    const glHeader = glTransDirect === 1 ? normalizeGlHeader(obj.gl_header) : null;
    const inventoryGlModeOverride = asText(obj.inventory_gl_post_override || obj.inventory_gl_post).toLowerCase();
    const normalizedInventoryGlOverride = ['perpetual', 'periodic'].includes(inventoryGlModeOverride)
      ? inventoryGlModeOverride
      : '';
    const basket_id = obj.basket_id || '';
    const doc_group = asText(obj.doc_group);
    const side_code = asText(obj.side_code);
    const department_code = asText(obj.department_code);
    const allocate_code = asText(obj.allocate_code);
    const project_code = asText(obj.project_code);
    const job_code = asText(obj.job_code);
    const contactor = asText(obj.contactor);
    const doc_ref = asText(obj.doc_ref);
    const doc_ref_date = normalizeDateString(obj.doc_ref_date) || null;
    const sale_group = asText(obj.sale_group);
    const cashier_code = asText(obj.cashier_code);

    const inquiry_type = obj.inquiry_type != null ? parseInt(obj.inquiry_type) : 1;
    const isCreditSale = [0, 2].includes(inquiry_type);
    const vat_type = obj.vat_type != null ? parseInt(obj.vat_type) : 1;
    const vat_rate = obj.vat_rate != null ? parseFloat(obj.vat_rate) : 7.0;
    const discount_type = obj.discount_type != null ? parseInt(obj.discount_type) : 0;
    const discount_word = obj.discount_word || '';

    let total_value_dbl = parseFloat(obj.total_value || 0);
    let total_net_amount_dbl = parseFloat(obj.total_net_amount || 0);
    const client_total_amount_dbl = parseFloat(obj.total_amount || 0);
    const total_net_extra_dbl = Math.max(0, total_net_amount_dbl - client_total_amount_dbl);
    const total_credit_charge_dbl = isCreditSale ? 0 : parseFloat(obj.total_credit_charge || 0);
    const tranfer_amount_dbl = isCreditSale ? 0 : parseFloat(obj.tranfer_amount || 0);
    const card_amount_dbl = isCreditSale ? 0 : parseFloat(obj.card_amount || 0);
    const wallet_amount_dbl = isCreditSale ? 0 : parseFloat(obj.wallet_amount || 0);
    let cash_amount_raw = isCreditSale ? 0 : parseFloat(obj.cash_amount || 0);
    let pay_cash_amount_raw = isCreditSale ? 0 : parseFloat(obj.pay_cash_amount || 0);
    const rounded_amount_dbl = parseFloat(obj.rounded_amount || 0);
    const total_income_amount_dbl = isCreditSale ? 0 : parseFloat(obj.total_income_amount || 0);
    let total_except_vat_dbl = parseFloat(obj.total_except_vat || 0);

    const items = Array.isArray(obj.items) ? obj.items : [];
    const payments = isCreditSale ? [] : (Array.isArray(obj.payment_detail) ? obj.payment_detail : []);
    const cashEntries = isCreditSale ? [] : (Array.isArray(obj.cash_detail) ? obj.cash_detail : []);
    const promotionRows = savePromotionDetails ? getPromotionRows(obj) : [];
    const tiger_pending = obj.tiger_pending === true || obj.tiger_pending === '1' || obj.tiger_pending === 1;
    const tiger_order_id = String(obj.tiger_order_id || '').trim();
    const tiger_amount_dbl = parseFloat(obj.tiger_amount || 0);
    const tiger_ref1 = String(obj.tiger_ref1 || '').trim();
    const tiger_ref2 = String(obj.tiger_ref2 || '').trim();
    const tigerSendSms = tiger_pending ? 1 : 0;
    const tigerRemark5 = tiger_pending
      ? JSON.stringify({
        tiger: 'pending',
        amount: tiger_amount_dbl,
        ref1: tiger_ref1,
        ref2: tiger_ref2,
        status: 'pending',
      }).slice(0, 255)
      : '';

    if (!pos_id) return res.status(400).json({ success: false, msg: 'pos_id is required' });
    if (items.length === 0) return res.status(400).json({ success: false, msg: 'items is empty' });
    if (tiger_pending && !tiger_order_id) return res.status(400).json({ success: false, msg: 'tiger_order_id is required' });
    if (isEditSave && !old_doc_no) return res.status(400).json({ success: false, msg: 'old_doc_no is required for edit' });
    if (isEditSave && !requested_doc_no) return res.status(400).json({ success: false, msg: 'doc_no is required for edit' });
    if (isEditSave && old_doc_no !== requested_doc_no) {
      return res.status(400).json({ success: false, msg: 'ระยะแรกยังไม่อนุญาตให้เปลี่ยนเลขที่เอกสารตอนแก้ไข' });
    }

    // VAT/discount are recalculated inside the DB transaction from company decimal settings.
    let total_disc, before_vat, vat_value, after_vat, total_amount;
    let lost_profit_exchange_amount = 0;

    // ── คำนวณ payment amounts ────────────────────────────────────────────────
    // หลักการใหม่: ปัดเศษเป็น "ชนิดการจ่ายเงิน" — จ่ายจริง + ปัดเศษ = ยอดสุทธิ
    //   total_net_amount  = ยอดสุทธิ (ไม่บวกปัดเศษ)
    //   cash_amount_raw   = เงินสดที่ใช้ปิดยอดเอกสาร
    //   pay_cash_amount   = เงินสดที่ลูกค้าจ่ายจริง (ใช้คำนวณเงินทอน)
    //   rounded_amount    = ปัดเศษ (frontend ส่งมา; เก็บลง total_income_amount เช่นกัน)
    //   money_change      = pay_cash_amount − cash_amount
    const proPayments = savePromotionDetails && !isCreditSale
      ? normalizePromotionPayments(payments)
      : [];
    let proPaymentSummary = null;

    let cash_amount_in_db = cash_amount_raw;
    let total_amount_pay = total_net_amount_dbl;
    const card_with_charge = card_amount_dbl + total_credit_charge_dbl;
    let total_income_amount = total_income_amount_dbl || rounded_amount_dbl;
    let money_change = pay_cash_amount_raw > 0
      ? Math.max(0, pay_cash_amount_raw - cash_amount_raw)
      : 0;
    let payable_total_amount = 0;

    let doc_no;
    let promotion_count = 0;
    let pos_campaign_count = 0;
    let earlyResponse = null;
    let editOriginalDoc = null;
    await withTransaction(async (client) => {
      const salePolicyOptions = {
        ...(await loadSaleCreditOptions(client)),
        ...(await loadSaleCompanyOptions(client)),
      };

      const saleCurrencyOptions = {
        ...salePolicyOptions,
        currency_code,
        exchange_rate,
      };
      const isForeignCurrencyDoc = isForeignCurrencyContext(saleCurrencyOptions);
      const promotionDiscountInput = obj.promotion_extra_discount_amount ?? obj.promotion_discount_amount;
      const homePromotionDiscountAmount = isForeignCurrencyDoc
        ? smlRound(asNumber(promotionDiscountInput) * (exchange_rate || 1), salePolicyOptions.item_amount_decimal, salePolicyOptions.round_type)
        : promotionDiscountInput;
      prepareSaleItemAmounts(items, saleCurrencyOptions);
      const canonicalTotals = calculateSaleDocumentTotals(items, {
        ...saleCurrencyOptions,
        vat_type,
        vat_rate,
        discount_type: salePolicyOptions.discount_type,
        discount_word,
        discount_word_2,
        promotion_discount_amount: homePromotionDiscountAmount,
      });
      total_value_dbl = canonicalTotals.totalValue;
      total_disc = canonicalTotals.totalDiscount;
      before_vat = canonicalTotals.beforeVat;
      vat_value = canonicalTotals.vatValue;
      after_vat = canonicalTotals.afterVat;
      total_amount = canonicalTotals.totalAmount;
      total_except_vat_dbl = canonicalTotals.totalExceptVat;
      const canonicalCurrencyTotals = calculateSaleCurrencyTotals(canonicalTotals, {
        ...saleCurrencyOptions,
        items,
        exchange_rate,
        vat_type,
        vat_rate,
        discount_type: salePolicyOptions.discount_type,
        discount_word,
        discount_word_2,
        promotion_discount_amount: promotionDiscountInput,
      });
      total_value_2 = canonicalCurrencyTotals.totalValue2;
      total_discount_2 = canonicalCurrencyTotals.totalDiscount2;
      total_amount_2 = canonicalCurrencyTotals.totalAmount2;
      total_net_amount_dbl = smlRound(
        total_amount + total_net_extra_dbl,
        salePolicyOptions.item_amount_decimal,
        salePolicyOptions.round_type,
      );
      total_amount_pay = total_net_amount_dbl;
      total_income_amount = total_income_amount_dbl || rounded_amount_dbl;
      lost_profit_exchange_amount = 0;

      if (enforceTotalMismatch) {
        const totalMismatch = buildSaleTotalMismatchResponse(obj, {
          total_value: total_value_dbl,
          total_discount: total_disc,
          total_before_vat: before_vat,
          total_vat_value: vat_value,
          total_after_vat: after_vat,
          total_except_vat: total_except_vat_dbl,
          total_amount,
          total_value_2,
          total_discount_2,
          total_amount_2,
          total_net_amount: total_net_amount_dbl,
        }, salePolicyOptions);
        if (totalMismatch) {
          earlyResponse = totalMismatch;
          return;
        }
      }

      if (salePolicyOptions.auto_insert_time && !asText(doc_time)) {
        // Keep HH:mm format like legacy desktop flow when auto time is enabled.
        doc_time = new Date().toTimeString().slice(0, 5);
      }

      if (basket_id && (!doc_format_code || !form_code)) {
        const basketDocRes = await client.query(
          `SELECT COALESCE(doc_format_code,'') AS doc_format_code,
                  COALESCE(form_code,'') AS form_code
           FROM pos_basket
           WHERE basket_id = $1
           LIMIT 1`,
          [basket_id],
        );
        doc_format_code = doc_format_code || basketDocRes.rows[0]?.doc_format_code || '';
        form_code = form_code || basketDocRes.rows[0]?.form_code || '';
      }

      const validatedCashTendered = await validateCashCurrencyEntries(client, cashEntries, {
        totalCashAmount: pay_cash_amount_raw > 0 ? pay_cash_amount_raw : cash_amount_raw,
        options: salePolicyOptions,
      });
      if (pay_cash_amount_raw > 0) {
        pay_cash_amount_raw = validatedCashTendered;
      } else {
        cash_amount_raw = validatedCashTendered;
      }
      cash_amount_in_db = cash_amount_raw;
      money_change = pay_cash_amount_raw > 0
        ? Math.max(0, pay_cash_amount_raw - cash_amount_in_db)
        : 0;
      if (homeCurrencyCode(salePolicyOptions) === 'LAK' && money_change > 0) {
        const roundedChange = roundLakChange(money_change);
        if (Math.abs(money_change - roundedChange) > 0.01) {
          throw userValidationError(`LAK change must be rounded down to a 500 LAK unit (${money_change} LAK)`);
        }
      }

      const posLocationDefaults = await loadPosWarehouseShelfDefaults(client, pos_id);
      const anyPosLocationDefaults = (!asText(posLocationDefaults.wh_code) || !asText(posLocationDefaults.shelf_code))
        ? await loadAnyPosWarehouseShelfDefaults(client)
        : { wh_code: '', shelf_code: '' };
      applyWarehouseShelfDefaults(items, {
        wh_code: asText(wh_code, posLocationDefaults.wh_code || anyPosLocationDefaults.wh_code),
        shelf_code: asText(shelf_code, posLocationDefaults.shelf_code || anyPosLocationDefaults.shelf_code),
      });
      await applyWarehouseShelfFromHistory(client, items);
      await applyWarehouseShelfFromStockBalance(client, items, doc_date);
      const masterLocationDefaults = await loadWarehouseShelfMasterDefault(client);
      applyWarehouseShelfDefaults(items, masterLocationDefaults);
      await hydrateSaleSetItems(client, items, {
        custCode: cust_code,
        vatType: vat_type,
        vatRate: vat_rate,
        saleType: inquiry_type,
        docDate: doc_date,
        currencyCode: currency_code,
        options: salePolicyOptions,
      });

      validateWarehouseShelfRequired(items);
      validateItemDiscountNotExceedPrice(items);
      const saleItemPolicyIssues = await collectSaleItemPolicyIssues(client, {
        items,
        docDate: doc_date,
        options: salePolicyOptions,
      });
      throwSaleItemPolicyBlockedIssues(saleItemPolicyIssues);
      // ตรวจสต๊อกเฉพาะ create เท่านั้น (เหมือน C# _mode==1) — edit ข้ามเพราะ process จะ recalc หลัง save
      if (salePolicyOptions.ic_stock_control === true && !isEditSave) {
        await validateStockBeforeSave(client, {
          items: buildStockValidationItemsFromSaleItems(items),
          docDate: doc_date,
          balanceControlType: salePolicyOptions.balance_control_type,
        });
      }
      const shouldCheckOpenPeriod = salePolicyOptions.check_open_period !== false;
      if (shouldCheckOpenPeriod) {
        await validateOpenAccountPeriod(client, doc_date);
      }
      await validateItemExpirationBeforeSave(client, {
        items,
        docDate: doc_date,
        enabled: salePolicyOptions.check_expiration_date === true,
      });

      // 1. Resolve doc_no. Prefer the number already shown on the sale screen.
      if (isEditSave) {
        const saleDocFormat = await resolveSaleDocFormat(client, doc_format_code);
        doc_no = requested_doc_no;
        doc_format_code = saleDocFormat.save_doc_format_code;
        form_code = form_code || saleDocFormat.form_code;
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ic_trans:44:${old_doc_no}`]);
        const existingDoc = await loadSaleDocumentForEditGuard(client, old_doc_no);
        assertSaleDocumentCanEdit(existingDoc, old_doc_no);
        editOriginalDoc = existingDoc;
      } else if (requested_doc_no) {
        const saleDocFormat = await resolveSaleDocFormat(client, doc_format_code);
        doc_no = requested_doc_no;
        doc_format_code = saleDocFormat.save_doc_format_code;
        form_code = form_code || saleDocFormat.form_code;
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ic_trans:44:${doc_no}`]);
        const duplicateDoc = await client.query(
          'SELECT 1 FROM ic_trans WHERE trans_flag = $1 AND doc_no = $2 LIMIT 1',
          [44, doc_no],
        );
        if (duplicateDoc.rows.length > 0) {
          throw userValidationError(`เลขที่เอกสาร ${doc_no} ถูกใช้แล้ว กรุณากดเอกสารใหม่`);
        }
      } else {
        const saleDoc = await resolveSaleDocNo(client, doc_format_code, 44);
        doc_no = saleDoc.doc_no;
        doc_format_code = saleDoc.doc_format_code;
        form_code = form_code || saleDoc.form_code;
      }

      validateVatTaxDocumentInput({
        options: salePolicyOptions,
        vatType: vat_type,
        taxDocNo: tax_doc_no_input || doc_no,
        rawTaxDocDate: raw_tax_doc_date_input,
      });

      const saleCreditValidation = await validateSaleCreditBeforeSave(client, {
        obj,
        docNo: doc_no,
        docDate: doc_date,
        docTime: doc_time,
        custCode: cust_code,
        creatorCode: creator_code,
        docFormatCode: doc_format_code,
        inquiryType: inquiry_type,
        vatType: vat_type,
        empCode: emp_code,
        totalAmount: total_amount,
        totalValue: total_value_dbl,
        beforeVat: before_vat,
        vatValue: vat_value,
        afterVat: after_vat,
        totalDiscount: total_disc,
        items,
        options: salePolicyOptions,
      });
      if (saleCreditValidation) {
        earlyResponse = saleCreditValidation;
        return;
      }

      if (savePromotionDetails && !isCreditSale) {
        await validatePromotionPayments(client, proPayments, {
          custCode: cust_code,
          docDate: doc_date,
          totalAmount: total_amount,
          docNo: doc_no,
        });
        proPaymentSummary = buildPromotionPaymentSummary({
          payments: proPayments,
          totalAmount: total_amount,
          roundedAmount: rounded_amount_dbl,
          cashAmountRaw: cash_amount_raw,
          payCashAmountRaw: pay_cash_amount_raw,
          obj,
        });
      }
      payable_total_amount = proPaymentSummary?.total_amount ?? total_amount;
      const saleAdvanceAmountForIc = asNumber(proPaymentSummary?.ic_advance_amount, asNumber(obj.advance_amount));
      const icAdvanceAmountForSave = (vat_type === 1 && saleAdvanceAmountForIc !== 0)
        ? (saleAdvanceAmountForIc * 100) / (100 + vat_rate)
        : saleAdvanceAmountForIc;

      // เก็บรายการเอกสารต้นทางที่ผูกอยู่ก่อน delete (เพื่อ recompute doc_success/used_status หลัง save)
      // ถ้า user เอา ref ใบเดิมออก ใบนั้นต้องถูก reset state กลับ
      let preExistingRefDocs = [];
      let preExistingDepositSources = [];
      if (isEditSave) {
        const preRefRes = await client.query(
          `SELECT DISTINCT billing_no FROM ap_ar_trans_detail
            WHERE doc_no = $1 AND trans_flag = 44 AND COALESCE(billing_no, '') <> ''`,
          [old_doc_no]
        );
        preExistingRefDocs = preRefRes.rows.map((r) => r.billing_no);
        const preDepositRes = await client.query(
          `SELECT DISTINCT trans_number, doc_type
             FROM cb_trans_detail
            WHERE doc_no = $1
              AND trans_flag = 44
              AND doc_type IN (5, 6)
              AND COALESCE(trans_number, '') <> ''`,
          [old_doc_no],
        );
        preExistingDepositSources = preDepositRes.rows.map((row) => ({
          doc_no: row.trans_number,
          doc_type: asNumber(row.doc_type),
        }));
        await deleteSaleDocumentSetForEdit(client, old_doc_no);
      }

      // 2. INSERT ic_trans
      await insertExistingColumns(client, 'ic_trans', {
        inquiry_type,
        vat_type,
        trans_type: 2,
        trans_flag: 44,
        doc_date,
        doc_no,
        tax_doc_no: tax_doc_no_input || doc_no,
        tax_doc_date: tax_doc_date_input,
        cust_code,
        member_code,
        branch_code,
        send_type,
        send_day,
        send_date,
        delivery_date,
        credit_day: isCreditSale ? credit_day : 0,
        due_date: null,
        credit_date: isCreditSale ? credit_date : doc_date,
        transport_code,
        vat_rate,
        currency_code,
        exchange_rate,
        total_value: total_value_dbl,
        total_vat_value: vat_value,
        total_after_vat: after_vat,
        total_amount: payable_total_amount,
        advance_amount: icAdvanceAmountForSave,
        total_before_vat: before_vat,
        total_except_vat: total_except_vat_dbl,
        total_value_2,
        total_discount_2,
        total_amount_2,
        lost_profit_exchange_amount,
        discount_word_2,
        doc_time,
        doc_format_code,
        creator_code: isEditSave ? asText(editOriginalDoc?.creator_code, creator_code) : creator_code,
        create_datetime: isEditSave && editOriginalDoc?.create_datetime ? editOriginalDoc.create_datetime : new Date(),
        last_editor_code: isEditSave ? creator_code : undefined,
        lastedit_datetime: isEditSave ? new Date() : undefined,
        user_approve: asText(obj._credit_approve_user || obj.user_approve),
        sale_code: emp_code,
        total_discount: total_disc,
        discount_word,
        remark,
        remark_2,
        remark_3: tiger_order_id || remark_3,
        remark_4: remark_4 || shelf_code,
        remark_5: tigerRemark5 || remark_5,
        send_sms: tigerSendSms,
        pos_id,
        inventory_gl_post_override: normalizedInventoryGlOverride,
        inventory_gl_post: normalizedInventoryGlOverride,
        ...(savePromotionDetails ? {
          doc_group,
          side_code,
          department_code,
          allocate_code,
          project_code,
          job_code,
          contactor,
          doc_ref,
          doc_ref_date,
          sale_group,
          cashier_code,
        } : {}),
      });

      // 3. INSERT cb_trans
      if (!isCreditSale) {
        if (savePromotionDetails && proPaymentSummary) {
          await insertExistingColumns(client, 'cb_trans', {
            trans_type: 2,
            trans_flag: 44,
            doc_no,
            doc_date,
            doc_time,
            ap_ar_code: cust_code,
            pay_type: 1,
            doc_format_code,
            remark,
            ...proPaymentSummary,
          });
        } else {
          await insertExistingColumns(client, 'cb_trans', {
            trans_type: 2,
            trans_flag: 44,
            doc_no,
            doc_date,
            doc_time,
            ap_ar_code: cust_code,
            pay_type: 1,
            doc_format_code,
            total_amount,
            total_net_amount: total_net_amount_dbl,
            cash_amount: cash_amount_in_db,
            tranfer_amount: tranfer_amount_dbl,
            card_amount: card_with_charge,
            total_amount_pay,
            total_credit_charge: total_credit_charge_dbl,
            wallet_amount: wallet_amount_dbl,
            total_income_amount,
            pay_cash_amount: pay_cash_amount_raw,
            money_change,
            remark,
          });
        }
      }

      // 3.5 INSERT gl_journal_vat_sale (รองรับหลายบรรทัด)
      const arNameRow = await client.query(
        'SELECT COALESCE(name_1, $2) AS name_1 FROM ar_customer WHERE code = $1 LIMIT 1',
        [cust_code, '']
      );
      const ar_name = arNameRow.rows[0]?.name_1 || '';
      await saveSaleVatRows(client, {
        docNo: doc_no,
        docDate: doc_date,
        transFlag: 44,
        custCode: cust_code,
        branchCode: asText(vat_sale.branch_code, branch_code),
        arName: ar_name,
        vatRows,
      });

      const customerTaxInfo = await loadCustomerTaxInfo(client, cust_code);
      await saveSaleShipment(client, { docNo: doc_no, docDate: doc_date, custCode: cust_code, shipment });
      await saveSaleWht(client, {
        docNo: doc_no,
        docDate: doc_date,
        custCode: cust_code,
        whtHeaders,
        customerInfo: {
          ...customerTaxInfo,
          tax_id: asText(vat_sale.tax_no, customerTaxInfo.tax_id),
          branch_code: asText(vat_sale.branch_code, customerTaxInfo.branch_code),
        },
      });
      await saveSaleManualGl(client, {
        docNo: doc_no,
        docDate: doc_date,
        docTime: doc_time,
        docFormatCode: doc_format_code,
        branchCode: branch_code,
        remark,
        transDirect: glTransDirect,
        glRows,
        glHeader,
        autoGlContext: {
          custCode: cust_code,
          items,
          payments: proPayments,
          docDate: doc_date,
          beforeVat: before_vat,
          vatValue: vat_value,
          totalAmount: total_amount,
          isCreditSale,
          inventoryGlModeOverride,
        },
      });

      // 4. DELETE + INSERT ic_trans_detail
      await client.query('DELETE FROM ic_trans_detail WHERE doc_no=$1 AND trans_flag=44', [doc_no]);
      const calcLineVat = (sumAmount, price, taxType) => {
        const amountPoint = salePolicyOptions.item_amount_decimal;
        const pricePoint = salePolicyOptions.item_price_decimal;
        const roundType = salePolicyOptions.round_type;
        if (taxType === 1) {
          return { sumExcludeVat: sumAmount, vatValue: 0, priceExcludeVat: price };
        }
        if (vat_type === 1) {
          const sumExcludeVat = smlRound((sumAmount * 100) / (100 + vat_rate), amountPoint, roundType);
          return {
            sumExcludeVat,
            vatValue: smlRound(sumAmount - sumExcludeVat, amountPoint, roundType),
            priceExcludeVat: smlRound((price * 100) / (100 + vat_rate), pricePoint, roundType),
          };
        }
        if (vat_type === 0) {
          return {
            sumExcludeVat: sumAmount,
            vatValue: smlRound(sumAmount * (vat_rate / 100), amountPoint, roundType),
            priceExcludeVat: price,
          };
        }
        return { sumExcludeVat: sumAmount, vatValue: 0, priceExcludeVat: price };
      };

      const insertDetailLine = async ({
        item,
        qty,
        price,
        sumAmount,
        lineNumber,
        itemType = 0,
        setRefLine = '',
        setRefPrice = price,
        setRefQty = 0,
        itemCodeMain = '',
        refGuid = '',
        priceSetRatio = 0,
        taxType = Number(item.tax_type ?? 0),
        discount = item.discount || '',
        discountAmount = parseFloat(item.discount_amount || 0),
      }) => {
        const tax = calcLineVat(sumAmount, price, taxType);
        const detailExchangeRate = exchange_rate > 0 ? exchange_rate : 1;
        const price2 = item.price_2 != null
          ? asNumber(item.price_2)
          : smlRound(asNumber(price) / detailExchangeRate, salePolicyOptions.item_price_decimal, salePolicyOptions.round_type);
        const sumAmount2 = item.sum_amount_2 != null
          ? asNumber(item.sum_amount_2)
          : smlRound(asNumber(sumAmount) / detailExchangeRate, salePolicyOptions.item_amount_decimal, salePolicyOptions.round_type);
        const discountAmount2 = item.discount_amount_2 != null
          ? asNumber(item.discount_amount_2)
          : smlRound(asNumber(discountAmount) / detailExchangeRate, salePolicyOptions.item_amount_decimal, salePolicyOptions.round_type);
        await insertExistingColumns(client, 'ic_trans_detail', {
          set_ref_line: setRefLine,
          set_ref_price: parseFloat(setRefPrice || 0),
          set_ref_qty: parseFloat(setRefQty || 0),
          item_type: parseInt(itemType || '0', 10) || 0,
          is_permium: isPremiumSaleSource(item) ? 1 : 0,
          item_code_main: itemCodeMain,
          ref_guid: refGuid,
          price_set_ratio: parseFloat(priceSetRatio || 0),
          inquiry_type,
          vat_type,
          trans_type: 2,
          trans_flag: 44,
          doc_date,
          doc_no,
          cust_code,
          branch_code,
          item_code: item.item_code || '',
          item_name: item.item_name || '',
          unit_code: item.unit_code || '',
          qty: parseFloat(qty || 0),
          price: parseFloat(price || 0),
          price_2: price2,
          sum_amount: parseFloat(sumAmount || 0),
          sum_amount_2: sumAmount2,
          line_number: lineNumber,
          remark: item.remark || '',
          wh_code: item.wh_code || '',
          shelf_code: item.shelf_code || '',
          stand_value: parseFloat(item.stand_value || 0),
          divide_value: parseFloat(item.divide_value || 0),
          ratio: 0,
          doc_time,
          doc_date_calc: doc_date,
          doc_time_calc: doc_time,
          discount,
          discount_amount: discountAmount,
          discount_amount_2: discountAmount2,
          barcode: item.barcode || '',
          calc_flag: -1,
          tax_type: taxType,
          sum_amount_exclude_vat: tax.sumExcludeVat,
          total_vat_value: tax.vatValue,
          price_exclude_vat: tax.priceExcludeVat,
          price_type: parseInt(item.price_type ?? item.type ?? 0, 10) || 0,
          price_mode: parseInt(item.price_mode ?? item.mode ?? item.price_info ?? item.price_type ?? 0, 10) || 0,
          is_get_price: 1,
          currency_code: '',
          ref_doc_no: asText(item.ref_doc_no),
          ref_row: -1,
        });
      };

      let detailLineNumber = 0;
      for (const it of items) {
        const itQty = parseFloat(it.qty || 0);
        const itPrice = parseFloat(it.price || 0);
        const itSum = parseFloat(it.sum_amount || 0);
        const itTaxType = Number(it.tax_type ?? 0);
        const itemType = String(it.item_type ?? '0');

        if (itemType !== '3') {
          await insertDetailLine({
            item: it,
            qty: itQty,
            price: itPrice,
            sumAmount: itSum,
            lineNumber: detailLineNumber++,
            itemType: parseInt(itemType || '0', 10) || 0,
            setRefPrice: itPrice,
            taxType: itTaxType,
          });
          continue;
        }

        const parentGuid = uuidv4();
        await insertDetailLine({
          item: it,
          qty: itQty,
          price: itPrice,
          sumAmount: itSum,
          lineNumber: detailLineNumber++,
          itemType: 3,
          setRefPrice: 0,
          refGuid: parentGuid,
          taxType: itTaxType,
        });

        const subItems = Array.isArray(it.sub_item) && it.sub_item.length > 0
          ? it.sub_item
          : await getSetSubItemsForSale(client, it.item_code);

        for (const sub of subItems) {
          const subQtyPerSet = smlRound(asNumber(sub.qty), salePolicyOptions.item_qty_decimal, salePolicyOptions.round_type);
          const subPrice = smlRound(asNumber(sub.price), salePolicyOptions.item_price_decimal, salePolicyOptions.round_type);
          const childQty = smlRound(itQty * subQtyPerSet, salePolicyOptions.item_qty_decimal, salePolicyOptions.round_type);
          const childSumAmount = smlRound(subPrice * childQty, salePolicyOptions.item_amount_decimal, salePolicyOptions.round_type);
          const childTaxType = Number(sub.tax_type ?? itTaxType);
          await insertDetailLine({
            item: {
              ...sub,
              wh_code: it.wh_code || '',
              shelf_code: it.shelf_code || '',
              stand_value: 1,
              divide_value: 1,
              ratio: 0,
              tax_type: childTaxType,
            },
            qty: childQty,
            price: subPrice,
            sumAmount: childSumAmount,
            lineNumber: detailLineNumber++,
            itemType: 0,
            setRefLine: parentGuid,
            setRefPrice: subPrice,
            setRefQty: subQtyPerSet,
            itemCodeMain: it.item_code || '',
            priceSetRatio: parseFloat(sub.price_ratio || 0),
            taxType: childTaxType,
            discount: '',
            discountAmount: 0,
          });
        }
      }

      for (let i = 0; false && i < items.length; i++) {
        const it = items[i];
        const it_qty = parseFloat(it.qty || 0);
        const it_price = parseFloat(it.price || 0);
        const it_sum = parseFloat(it.sum_amount || 0);
        const it_tax_type = Number(it.tax_type ?? 0);

        // คำนวณ base/vat รายบรรทัด ตาม tax_type ของสินค้าและ vat_type ของเอกสาร
        // tax_type=1 (ยกเว้น): ไม่มี VAT — ใช้ราคา/ยอดเดิม
        // tax_type=0 + vat_type=1 (รวมใน): แยก VAT ออกจากยอด
        // tax_type=0 + vat_type=0 (แยกนอก): VAT คิดเพิ่มจากยอด, base=ยอดเดิม
        // อื่น ๆ (ไม่กระทบ/ศูนย์): ไม่มี VAT
        let sum_amount_exclude_vat, line_vat_value, price_exclude_vat;
        if (it_tax_type === 1) {
          sum_amount_exclude_vat = it_sum;
          line_vat_value = 0;
          price_exclude_vat = it_price;
        } else if (vat_type === 1) {
          sum_amount_exclude_vat = r2((it_sum * 100) / (100 + vat_rate));
          line_vat_value = r2(it_sum - sum_amount_exclude_vat);
          price_exclude_vat = r2((it_price * 100) / (100 + vat_rate));
        } else if (vat_type === 0) {
          sum_amount_exclude_vat = it_sum;
          line_vat_value = r2(it_sum * (vat_rate / 100));
          price_exclude_vat = it_price;
        } else {
          sum_amount_exclude_vat = it_sum;
          line_vat_value = 0;
          price_exclude_vat = it_price;
        }

        await client.query(
          `INSERT INTO ic_trans_detail (
            inquiry_type,vat_type,trans_type,trans_flag,doc_date,doc_no,cust_code,
            item_code,item_name,unit_code,qty,price,sum_amount,line_number,remark,
            wh_code,shelf_code,stand_value,divide_value,ratio,doc_time,doc_date_calc,doc_time_calc,
            discount,discount_amount,barcode,calc_flag,
            tax_type,sum_amount_exclude_vat,total_vat_value,price_exclude_vat,
            ref_doc_no,ref_row,is_get_price
          ) VALUES ($1,$2,2,44,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,'',$13,$14,$15,$16,$17,$18,$3::date,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,-1,1)`,
          [
            1, vat_type,
            doc_date, doc_no, cust_code,
            it.item_code, it.item_name, it.unit_code,
            it_qty, it_price,
            it_sum, i,
            it.wh_code || '', it.shelf_code || '',
            parseFloat(it.stand_value || 0), parseFloat(it.divide_value || 0), 0,
            doc_time,
            doc_time,
            it.discount || '', parseFloat(it.discount_amount || 0), it.barcode || '', -1,
            it_tax_type, sum_amount_exclude_vat, line_vat_value, price_exclude_vat,
            String(it.ref_doc_no || ''),
          ]
        );
      }

      // ── เอกสารอ้างอิงที่ดึงมา (ใบเสนอราคา/ใบสั่งจอง/ใบสั่งขาย) ─────────────
      // เก็บใน ap_ar_trans_detail ตาม C# _icTransRefControl._transGrid
      // 1 row ต่อ 1 ใบ — bill_type = C# docType (1=QT, 2=Reserve, 3=SO), ไม่ใช่ trans_flag
      const refBillings = Array.isArray(obj.ref_billings) ? obj.ref_billings : [];
      if (refBillings.length > 0) {
        await client.query(
          `DELETE FROM ap_ar_trans_detail WHERE doc_no = $1 AND trans_flag = 44`,
          [doc_no]
        );
        for (let i = 0; i < refBillings.length; i++) {
          const r = refBillings[i];
          if (!r || !r.doc_no) continue;
          const billingNo = String(r.doc_no).trim();
          const billingDate = String(r.doc_date || '').trim();
          const refDocNo = String(r.ref_doc_no || '').trim();
          const refDocDate = String(r.ref_doc_date || '').trim();
          const refRemark = String(r.remark || '').trim();
          const billType = normalizeSaleRefBillType(r.bill_type);
          if (!billingNo) continue;
          await client.query(
            `INSERT INTO ap_ar_trans_detail
               (trans_type, trans_flag, doc_date, doc_no, billing_no, billing_date,
                ref_doc_no, ref_doc_date, bill_type, line_number, calc_flag, remark)
             VALUES (2, 44, $1::date, $2, $3, NULLIF($4, '')::date,
                     $5, NULLIF($6, '')::date, $7, $8, -1, $9)`,
            [doc_date, doc_no, billingNo, billingDate, refDocNo, refDocDate, billType, i, refRemark]
          );
        }
      }

      // ── อัปเดต doc_success / used_status ของเอกสารต้นทาง (QT/Reserve/SO) ──
      // ทุกใบที่ "เคยถูกผูก" (preExisting จาก edit) หรือ "ถูกผูกใหม่" (refBillings) ต้อง recompute
      //   used_status = 1 ⇔ มี ic_trans_detail ของ doc อื่นที่ ref_doc_no = src.doc_no (active)
      //   doc_success = 1 ⇔ ทุก item_code มี balance qty = 0 (ถูกดึงไปครบทั้งหมดแล้ว)
      // อ้างอิง: SMLDocs/copilot-instructions.md → "used_status / doc_success" + C# _docFlowThread
      const newRefDocs = refBillings.map((r) => String(r?.doc_no || '').trim()).filter(Boolean);
      const affectedRefDocs = Array.from(new Set([...preExistingRefDocs, ...newRefDocs]));
      for (const refDocNo of affectedRefDocs) {
        await client.query(
          `UPDATE ic_trans SET
             used_status = CASE WHEN EXISTS (
               SELECT 1 FROM ic_trans_detail x
                WHERE x.ref_doc_no = ic_trans.doc_no
                  AND COALESCE(x.last_status, 0) = 0
                  AND x.trans_flag = ANY((
                    CASE
                      WHEN ic_trans.trans_flag = 30 THEN ARRAY[34, 36, 44]
                      WHEN ic_trans.trans_flag = 34 THEN ARRAY[36, 44]
                      WHEN ic_trans.trans_flag = 36 THEN ARRAY[37, 44]
                      ELSE ARRAY[44]
                    END
                  )::int[])
             ) THEN 1 ELSE 0 END,
             doc_success = CASE WHEN EXISTS (
               SELECT 1
                 FROM (
                   SELECT src.item_code,
                          SUM(COALESCE(src.qty, 0) * (COALESCE(src.stand_value, 1)::numeric / NULLIF(COALESCE(src.divide_value, 1), 0))) AS source_qty
                     FROM ic_trans_detail src
                    WHERE src.doc_no = ic_trans.doc_no
                      AND src.trans_flag = ic_trans.trans_flag
                      AND COALESCE(src.last_status, 0) = 0
                      AND COALESCE(src.item_code, '') <> ''
                      AND (ic_trans.trans_flag <> 36 OR COALESCE(src.item_type, 0) <> 3)
                    GROUP BY src.item_code
                 ) src_sum
                WHERE (
                    src_sum.source_qty
                    - COALESCE((
                        SELECT SUM(COALESCE(x.qty, 0) * (COALESCE(x.stand_value, 1)::numeric / NULLIF(COALESCE(x.divide_value, 1), 0)))
                        FROM ic_trans_detail x
                        WHERE x.ref_doc_no = ic_trans.doc_no
                          AND x.item_code = src_sum.item_code
                          AND COALESCE(x.last_status, 0) = 0
                          AND x.trans_flag = ANY((
                            CASE
                              WHEN ic_trans.trans_flag = 30 THEN ARRAY[34, 36, 44]
                              WHEN ic_trans.trans_flag = 34 THEN ARRAY[36, 44]
                              WHEN ic_trans.trans_flag = 36 THEN ARRAY[37, 44]
                              ELSE ARRAY[44]
                            END
                          )::int[])
                          AND (ic_trans.trans_flag <> 36 OR COALESCE(x.item_type, 0) <> 3)
                      ), 0)
                  ) > 0
             ) THEN 0 ELSE 1 END
           WHERE doc_no = $1 AND trans_flag IN (30, 34, 36)`,
          [refDocNo]
        );
      }

      if (savePromotionDetails) {
        await client.query('DELETE FROM ic_trans_detail_promotion WHERE doc_no=$1 AND trans_flag=44', [doc_no]);
        for (let i = 0; i < promotionRows.length; i++) {
          const row = promotionRows[i] || {};
          const promotion_code = String(getPromotionValue(row, 'promotion_code', '_promotionCode', 'code') || '').trim();
          const promotion_name = String(getPromotionValue(row, 'promotion_name', 'item_name', '_promotionName', 'name_1') || '').trim();
          const qty = parseFloat(getPromotionValue(row, 'qty', '_qty', 'count', '_count') || 0);
          const amount = parseFloat(getPromotionValue(row, 'sum_amount', 'amount', '_amount') || 0);
          const rawPrice = getPromotionValue(row, 'price', '_price');
          const price = rawPrice == null || rawPrice === ''
            ? (qty === 0 ? 0 : amount / qty)
            : parseFloat(rawPrice || 0);
          const lineNumberRaw = getPromotionValue(row, 'line_number', 'lineNumber');
          const lineNumber = lineNumberRaw == null || lineNumberRaw === ''
            ? detailLineNumber + i
            : parseInt(lineNumberRaw, 10);

          if (!promotion_code && !promotion_name && qty === 0 && amount === 0) continue;

          await client.query(
            `INSERT INTO ic_trans_detail_promotion (
              doc_no,doc_date,trans_flag,promotion_code,promotion_name,qty,price,sum_amount,line_number
            ) VALUES ($1,$2::date,44,$3,$4,$5,$6,$7,$8)`,
            [doc_no, doc_date, promotion_code, promotion_name, qty, price, amount, Number.isFinite(lineNumber) ? lineNumber : detailLineNumber + i]
          );
          promotion_count++;
        }
      }

      if (savePromotionDetails) {
        const campaignColumns = await getTableColumnSet(client, 'ic_trans_pos_campaign');
        if (campaignColumns.size > 0) {
          await client.query('DELETE FROM ic_trans_pos_campaign WHERE doc_no=$1 AND trans_flag=44', [doc_no]);
          const campaignRows = await processPosSlipCampaign(client, { docDate: doc_date, docTime: doc_time, items });
          for (let i = 0; i < campaignRows.length; i++) {
            const row = campaignRows[i] || {};
            const campaignCode = String(getPromotionValue(row, 'campaign_code', 'campaignCode', 'code') || '').trim();
            const qty = parseInt(getPromotionValue(row, 'qty', 'count') || 0, 10) || 0;
            const lineNumberRaw = getPromotionValue(row, 'line_number', 'lineNumber');
            const lineNumber = lineNumberRaw == null || lineNumberRaw === ''
              ? i
              : parseInt(lineNumberRaw, 10);
            if (!campaignCode || qty <= 0) continue;
            await insertExistingColumns(client, 'ic_trans_pos_campaign', {
              trans_flag: 44,
              doc_no,
              doc_date,
              campaign_code: campaignCode,
              qty,
              line_number: Number.isFinite(lineNumber) ? lineNumber : i,
            });
            pos_campaign_count++;
          }
        }
      }

      // 5. DELETE + INSERT cb_trans_detail
      await client.query('DELETE FROM cb_trans_detail WHERE doc_no=$1 AND trans_flag=44', [doc_no]);
      if (!isCreditSale) {
        if (savePromotionDetails) {
          for (const p of proPayments) {
            const amountOnlyDetail = [1, 11, 12].includes(asNumber(p.doc_type));
            const blankArDetail = [1, 11, 12, 19].includes(asNumber(p.doc_type));
            const otherCurrencyDetail = asNumber(p.doc_type) === 19;
            await insertExistingColumns(client, 'cb_trans_detail', {
              trans_type: 2,
              trans_flag: 44,
              doc_no,
              doc_date,
              doc_time,
              line_number: amountOnlyDetail ? 0 : p.line_number,
              doc_type: p.doc_type,
              trans_number: p.trans_number,
              amount: p.amount,
              sum_amount: amountOnlyDetail ? 0 : p.sum_amount,
              charge: p.charge,
              bank_code: p.bank_code,
              bank_branch: p.bank_branch,
              pass_book_code: p.doc_type === 1 ? '' : p.pass_book_code,
              credit_card_type: p.credit_card_type,
              no_approved: p.no_approved,
              ref1: p.ref1 || (p.doc_type === 3 ? doc_no : ''),
              ref2: p.ref2,
              doc_ref: p.doc_ref,
              doc_date_ref: p.doc_date_ref || null,
              chq_due_date: p.chq_due_date || null,
              balance_amount: amountOnlyDetail ? 0 : p.balance_amount,
              description: p.description,
              remark: p.remark,
              currency_code: otherCurrencyDetail ? '' : p.currency_code,
              exchange_rate: amountOnlyDetail && !asText(p.currency_code) ? 0 : p.exchange_rate,
              sum_amount_2: otherCurrencyDetail ? 0 : p.sum_amount_2,
              amount_2: otherCurrencyDetail ? 0 : p.amount_2,
              charge_2: p.charge_2,
              exchange_rate_old: p.exchange_rate_old,
              lost_profit_exchange_amount: p.lost_profit_exchange_amount,
              trans_number_type: p.trans_number_type || (p.doc_type === 3 ? 1 : 0),
              ap_ar_type: p.ap_ar_type || ([2, 3, 5, 6].includes(p.doc_type) ? 1 : 0),
              ap_ar_code: blankArDetail ? '' : cust_code,
              chq_on_hand: p.chq_on_hand,
            });
          }
        } else {
          for (const p of payments) {
          const pay_type = String(p.pay_type || '0');
          const pay_amount = parseFloat(p.pay_amount || 0);
          const trans_number = p.trans_number || '';
          const charge = parseFloat(p.charge || 0);

          if (pay_type === '0') {
            // โอน
            const pb_bank_code = p.bank_code || 'KBANK';
            const pb_bank_branch = p.bank_branch || 'KBANK2';
            await client.query(
              `INSERT INTO cb_trans_detail (
                trans_type,trans_flag,doc_no,doc_date,doc_time,trans_number,
                bank_code,bank_branch,amount,sum_amount,doc_type,ap_ar_code,
                trans_number_type,ap_ar_type,remark
              ) VALUES (2,$1,$2,$3::date,$4,$5,$6,$7,$8,0,'1','',0,0,$9)`,
              [44, doc_no, doc_date, doc_time, trans_number, pb_bank_code, pb_bank_branch, pay_amount, asText(p.remark || p.description || '')]
            );
          } else if (pay_type === '21') {
            // บัตรเครดิต
            const cc_type = p.credit_card_type || 'NONE';
            const sum_amt = pay_amount + charge;
            await client.query(
              `INSERT INTO cb_trans_detail (
                trans_type,trans_flag,doc_no,doc_date,doc_time,trans_number,
                credit_card_type,amount,sum_amount,doc_type,ap_ar_code,
                trans_number_type,ap_ar_type,charge,ref1,no_approved,remark
              ) VALUES (2,$1,$2,$3::date,$4,$5,$6,$7,$8,'21',$9,1,1,$10,$2,$11,$12)`,
              [44, doc_no, doc_date, doc_time, trans_number, cc_type, pay_amount, sum_amt, cust_code, charge, p.no_approved || '', asText(p.remark || p.description || '')]
            );
          } else {
            // wallet
            const sum_amt = pay_amount + charge;
            await client.query(
              `INSERT INTO cb_trans_detail (
                trans_type,trans_flag,doc_no,doc_date,doc_time,trans_number,
                credit_card_type,amount,sum_amount,doc_type,ap_ar_code,
                trans_number_type,ap_ar_type,charge,remark
              ) VALUES (2,$1,$2,$3::date,$4,$5,'WC',$6,$7,'3',$8,1,1,$9,$10)`,
              [44, doc_no, doc_date, doc_time, trans_number, pay_amount, sum_amt, cust_code, charge, asText(p.remark || p.description || '')]
            );
          }
          }
        }
      }

      const newDepositSources = savePromotionDetails
        ? proPayments
          .filter((payment) => [5, 6].includes(asNumber(payment.doc_type)) && asText(payment.trans_number))
          .map((payment) => ({ doc_no: asText(payment.trans_number), doc_type: asNumber(payment.doc_type) }))
        : [];
      await recomputeSaleDepositSourceStatuses(client, [...preExistingDepositSources, ...newDepositSources]);

      // 6. Clear cart only for new sale saves. Editing a posted document should not touch the live POS basket.
      if (!isEditSave) {
        const cart_key = basket_id ? `BASKET-${basket_id}` : cust_code;
        const staffCartTable = await client.query("SELECT to_regclass('public.staff_cart_order') AS table_name");
        if (staffCartTable.rows[0]?.table_name) {
          await client.query('DELETE FROM staff_cart_order WHERE cust_code=$1', [cart_key]);
        }

        if (basket_id) {
          await client.query(
            `UPDATE pos_basket
             SET cust_code='', cust_name='', sale_code='', sale_name='',
                 doc_format_code='', form_code='',
                 status='empty', updated_at=NOW()
             WHERE basket_id=$1`,
            [basket_id]
          );
        }
      }

      // 7. Queue IC process for sold items
      await client.query(
        `INSERT INTO process (process_name, wherein)
         SELECT 'IC', item_code FROM ic_trans_detail WHERE doc_no = $1 AND trans_flag = 44`,
        [doc_no]
      );
    });

    if (earlyResponse) {
      if (earlyResponse.statusCode) return res.status(earlyResponse.statusCode).json(earlyResponse.body || {});
      return res.json(earlyResponse);
    }

    return res.json({
      success: true,
      doc_no,
      doc_format_code,
      form_code,
      promotion_count,
      pos_campaign_count,
      msg: 'success',
    });
  } catch (ex) {
    const msg = ex.message || '';
    if (msg.includes('running overflow')) {
      return res.status(409).json({ success: false, msg: 'ERR_DOC_RUNNING_OVERFLOW: ' + msg });
    }
    if (ex.statusCode) {
      const body = { success: false, msg };
      if (ex.code) body.code = ex.code;
      if (Array.isArray(ex.details)) body.details = ex.details;
      if (Array.isArray(ex.policyErrors)) body.policy_errors = ex.policyErrors;
      if (Array.isArray(ex.policyWarnings)) body.policy_warnings = ex.policyWarnings;
      if (Array.isArray(ex.stockIssues)) body.stock_issues = ex.stockIssues;
      return res.status(ex.statusCode).json(body);
    }
    return res.status(500).json({ success: false, msg });
  }
}

// ── POST /service/v1/saveTrans ─────────────────────────────────────────────
router.post('/saveTrans', async (req, res) => {
  return handleSaveTrans(req, res);
});

// ── POST /service/v1/saveTransAndPro ───────────────────────────────────────
router.post('/saveTransAndPro', async (req, res) => {
  return handleSaveTrans(req, res, { savePromotionDetails: true, enforceTotalMismatch: true });
});

router.post('/savetransandpro', async (req, res) => {
  return handleSaveTrans(req, res, { savePromotionDetails: true, enforceTotalMismatch: true });
});

// ── GET /service/v1/getDocSaleHistory ──────────────────────────────────────
// ลอกจาก Java: ถ้ามี search → ยกเลิก date filter และค้นด้วย cust_code/name_1/creator แทน
// doc_no แยกเป็นช่องค้นหาเลขเอกสาร และใช้ ILIKE เพื่อค้นบางส่วนได้
router.get('/getDocSaleHistory', async (req, res) => {
  const { doc_no = '', search = '', from_date = '', to_date = '', sale_kind = '', branch_code = '', pos_id = '' } = req.query;
  try {
    const params = [];
    let whereExtra = '';
    let saleKindWhere = '';
    let posWhere = '';

    if (branch_code.trim()) {
      params.push(branch_code.trim());
      posWhere = ` AND ict.branch_code = $${params.length}`;
    }

    if (String(pos_id || '').trim()) {
      params.push(String(pos_id || '').trim());
      posWhere += ` AND ict.pos_id = $${params.length}`;
    }

    if (sale_kind === 'cash') {
      saleKindWhere = ' AND ict.inquiry_type IN (1,3)';
    } else if (sale_kind === 'credit') {
      saleKindWhere = ' AND ict.inquiry_type IN (0,2)';
    }

    if (doc_no.trim()) {
      params.push(`%${doc_no.trim()}%`);
      whereExtra = ` AND ict.doc_no ILIKE $${params.length}`;
    } else if (search.trim()) {
      const like = `%${search.trim()}%`;
      params.push(like, like, like, like, like);
      const n = params.length;
      whereExtra = ` AND (ict.doc_no ILIKE $${n - 4} OR ict.cust_code ILIKE $${n - 3} OR ar.name_1 ILIKE $${n - 2} OR ict.creator_code ILIKE $${n - 1} OR (SELECT u.name_1 FROM erp_user u WHERE UPPER(u.code) = UPPER(ict.creator_code) LIMIT 1) ILIKE $${n})`;
    } else if (from_date.trim() && to_date.trim()) {
      params.push(from_date.trim(), to_date.trim());
      whereExtra = ` AND ict.doc_date BETWEEN $${params.length - 1}::date AND $${params.length}::date`;
    }

    const sql = `
      SELECT ict.doc_no, ict.doc_date, ict.doc_time, ict.inquiry_type, ict.total_amount,
        COALESCE(ict.doc_format_code,'') AS doc_format_code,
        COALESCE(df.name_1,'') AS doc_format_name,
        COALESCE(df.form_code,'') AS form_code,
        ict.cust_code, COALESCE(ar.name_1,'') AS cust_name,
        COALESCE(ict.sale_code,'') AS sale_code,
        COALESCE((SELECT u.name_1 FROM erp_user u WHERE UPPER(u.code) = UPPER(ict.sale_code) LIMIT 1),'') AS sale_name,
        COALESCE(ict.creator_code,'') AS creator_code,
        COALESCE((SELECT u.name_1 FROM erp_user u WHERE UPPER(u.code) = UPPER(ict.creator_code) LIMIT 1),'') AS creator_name,
        COALESCE(ict.used_status,0) AS used_status,
        COALESCE(ict.used_status_2,0) AS used_status_2,
        COALESCE(ict.doc_success,0) AS doc_success,
        COALESCE(ict.is_doc_copy,0) AS is_doc_copy,
        COALESCE(ict.send_sms,0) AS send_sms,
        COALESCE(ict.remark_3,'') AS tiger_order_id,
        COALESCE(ict.remark_5,'') AS tiger_status_note,
        cb.cash_amount, cb.tranfer_amount, cb.card_amount, cb.wallet_amount,
        cb.total_credit_charge, cb.total_net_amount, cb.total_amount_pay
      FROM ic_trans ict
      LEFT JOIN ar_customer ar ON ar.code = ict.cust_code
      LEFT JOIN cb_trans cb ON cb.doc_no = ict.doc_no AND cb.trans_flag = 44
      LEFT JOIN erp_doc_format df ON df.screen_code = 'SI' AND df.code = ict.doc_format_code
      WHERE ict.trans_flag = 44
        AND ict.last_status = 0
        ${posWhere}
        ${saleKindWhere}
        ${whereExtra}
      ORDER BY ict.doc_date DESC, ict.doc_time DESC
    `;

    const result = await query(sql, params);
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getDocSaleHistoryDetail ────────────────────────────────
router.get('/getDocSaleHistoryDetail', async (req, res) => {
  const { doc_no = '' } = req.query;
  if (!doc_no) return res.status(400).json({ success: false, msg: 'doc_no is required' });
  try {
    const [glColumnsRes, icTransColumnsRes, cbTransDetailColumnsRes, cbTransColumnsRes, icTransDetailColumnsRes] = await Promise.all([
      query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'gl_trans'`,
        []
      ),
      query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'ic_trans'`,
        []
      ),
      query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'cb_trans_detail'`,
        []
      ),
      query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'cb_trans'`,
        []
      ),
      query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'ic_trans_detail'`,
        []
      ),
    ]);
    const glColumns = new Set(glColumnsRes.rows.map((row) => row.column_name));
    const icTransColumns = new Set(icTransColumnsRes.rows.map((row) => row.column_name));
    const cbTransDetailColumns = new Set(cbTransDetailColumnsRes.rows.map((row) => row.column_name));
    const cbTransColumns = new Set(cbTransColumnsRes.rows.map((row) => row.column_name));
    const icTransDetailColumns = new Set(icTransDetailColumnsRes.rows.map((row) => row.column_name));
    const selectText = (columns, alias, column, output = column) =>
      columns.has(column) ? `COALESCE(${alias}.${column}, '') AS ${output}` : `'' AS ${output}`;
    const selectNumber = (columns, alias, column, output = column) =>
      columns.has(column) ? `COALESCE(${alias}.${column}, 0) AS ${output}` : `0 AS ${output}`;
    const selectDate = (columns, alias, column, output = column) =>
      columns.has(column) ? `${alias}.${column} AS ${output}` : `NULL::date AS ${output}`;
    const cbNumberSelect = (column, output = column) => selectNumber(cbTransColumns, 'cb', column, output);
    const detailTextSelect = (column, output = column) => selectText(icTransDetailColumns, 'd', column, output);
    const detailNumberSelect = (column, output = column) => selectNumber(icTransDetailColumns, 'd', column, output);
    const detailDateSelect = (column, output = column) => selectDate(icTransDetailColumns, 'd', column, output);
    const hasGlTransDirectColumn = glColumns.has('trans_direct');
    const inventoryGlOverrideSelect = icTransColumns.has('inventory_gl_post_override')
      ? "COALESCE(t.inventory_gl_post_override, '') AS inventory_gl_post_override"
      : (icTransColumns.has('inventory_gl_post')
        ? "COALESCE(t.inventory_gl_post, '') AS inventory_gl_post_override"
        : "'' AS inventory_gl_post_override");
    const docGroupSelect = icTransColumns.has('doc_group')
      ? "COALESCE(t.doc_group, '') AS doc_group"
      : "'' AS doc_group";
    const sideCodeSelect = icTransColumns.has('side_code')
      ? "COALESCE(t.side_code, '') AS side_code"
      : "'' AS side_code";
    const departmentCodeSelect = icTransColumns.has('department_code')
      ? "COALESCE(t.department_code, '') AS department_code"
      : "'' AS department_code";
    const allocateCodeSelect = icTransColumns.has('allocate_code')
      ? "COALESCE(t.allocate_code, '') AS allocate_code"
      : "'' AS allocate_code";
    const projectCodeSelect = icTransColumns.has('project_code')
      ? "COALESCE(t.project_code, '') AS project_code"
      : "'' AS project_code";
    const jobCodeSelect = icTransColumns.has('job_code')
      ? "COALESCE(t.job_code, '') AS job_code"
      : "'' AS job_code";
    const contactorSelect = icTransColumns.has('contactor')
      ? "COALESCE(t.contactor, '') AS contactor"
      : "'' AS contactor";
    const docRefSelect = icTransColumns.has('doc_ref')
      ? "COALESCE(t.doc_ref, '') AS doc_ref"
      : "'' AS doc_ref";
    const docRefDateSelect = icTransColumns.has('doc_ref_date')
      ? 't.doc_ref_date AS doc_ref_date'
      : 'NULL::date AS doc_ref_date';
    const saleGroupSelect = icTransColumns.has('sale_group')
      ? "COALESCE(t.sale_group, '') AS sale_group"
      : "'' AS sale_group";
    const cashierCodeSelect = icTransColumns.has('cashier_code')
      ? "COALESCE(t.cashier_code, '') AS cashier_code"
      : "'' AS cashier_code";
    const cbDescriptionSelect = cbTransDetailColumns.has('description')
      ? "COALESCE(description, '') AS description"
      : "'' AS description";
    const cbRemarkSelect = cbTransDetailColumns.has('remark')
      ? "COALESCE(remark, '') AS remark"
      : "'' AS remark";
    const cbCurrencyCodeSelect = cbTransDetailColumns.has('currency_code')
      ? "COALESCE(currency_code, '') AS currency_code"
      : "'' AS currency_code";
    const cbExchangeRateSelect = cbTransDetailColumns.has('exchange_rate')
      ? 'COALESCE(exchange_rate, 1) AS exchange_rate'
      : '1 AS exchange_rate';
    const cbSumAmount2Select = cbTransDetailColumns.has('sum_amount_2')
      ? 'COALESCE(sum_amount_2, 0) AS sum_amount_2'
      : '0 AS sum_amount_2';
    const cbAmount2Select = cbTransDetailColumns.has('amount_2')
      ? 'COALESCE(amount_2, 0) AS amount_2'
      : '0 AS amount_2';
    const cbCharge2Select = cbTransDetailColumns.has('charge_2')
      ? 'COALESCE(charge_2, 0) AS charge_2'
      : '0 AS charge_2';
    const cbExchangeRateOldSelect = cbTransDetailColumns.has('exchange_rate_old')
      ? 'COALESCE(exchange_rate_old, 0) AS exchange_rate_old'
      : '0 AS exchange_rate_old';
    const cbLostProfitExchangeAmountSelect = cbTransDetailColumns.has('lost_profit_exchange_amount')
      ? 'COALESCE(lost_profit_exchange_amount, 0) AS lost_profit_exchange_amount'
      : '0 AS lost_profit_exchange_amount';
    const cbTransNumberTypeSelect = cbTransDetailColumns.has('trans_number_type')
      ? 'COALESCE(trans_number_type, 0) AS trans_number_type'
      : '0 AS trans_number_type';
    const cbApArTypeSelect = cbTransDetailColumns.has('ap_ar_type')
      ? 'COALESCE(ap_ar_type, 0) AS ap_ar_type'
      : '0 AS ap_ar_type';
    const cbChqOnHandSelect = cbTransDetailColumns.has('chq_on_hand')
      ? 'COALESCE(chq_on_hand, 0) AS chq_on_hand'
      : '0 AS chq_on_hand';
    const glHeaderSelectParts = [
      hasGlTransDirectColumn
        ? 'COALESCE(trans_direct, 0) AS trans_direct'
        : '1 AS trans_direct',
      glColumns.has('ref_date') ? 'ref_date' : 'NULL::date AS ref_date',
      glColumns.has('ref_no') ? "COALESCE(ref_no, '') AS ref_no" : "'' AS ref_no",
      glColumns.has('book_code') ? "COALESCE(book_code, '') AS book_code" : "'' AS book_code",
      glColumns.has('journal_type') ? 'COALESCE(journal_type, 0) AS journal_type' : '0 AS journal_type',
      glColumns.has('description') ? "COALESCE(description, '') AS description" : "'' AS description",
      glColumns.has('ap_ar_code') ? "COALESCE(ap_ar_code, '') AS ap_ar_code" : "'' AS ap_ar_code",
      glColumns.has('ap_ar_originate_from') ? 'COALESCE(ap_ar_originate_from, 0) AS ap_ar_originate_from' : '0 AS ap_ar_originate_from',
      glColumns.has('account_period') ? 'COALESCE(account_period, 0) AS period_number' : '0 AS period_number',
      glColumns.has('account_year') ? 'COALESCE(account_year, 0) AS account_year' : '0 AS account_year',
    ];
    const [headerRes, itemsRes, promotionTableRes, posCampaignTableRes, whtHeaderRes, whtDetailRes, vatRowsRes, shipmentRes, paymentDetailRes, glHeaderRes, glDetailRes] = await Promise.all([
      query(
        `SELECT t.inquiry_type, t.vat_type, t.vat_rate,
            t.doc_no, t.doc_date, COALESCE(t.doc_time,'') AS doc_time,
            COALESCE(t.cust_code,'') AS cust_code,
            COALESCE(ar.name_1,'') AS cust_name,
            COALESCE(t.sale_code,'') AS sale_code,
            COALESCE(t.branch_code,'') AS branch_code,
            COALESCE(t.tax_doc_no,'') AS tax_doc_no,
            t.tax_doc_date,
            COALESCE(t.currency_code,'') AS currency_code,
            COALESCE(t.exchange_rate,1) AS exchange_rate,
            COALESCE(t.total_value,0) AS total_value,
            COALESCE(t.total_except_vat,0) AS total_except_vat,
            COALESCE(t.total_value_2,0) AS total_value_2,
            COALESCE(t.total_discount_2,0) AS total_discount_2,
            COALESCE(t.total_amount_2,0) AS total_amount_2,
            ${selectNumber(icTransColumns, 't', 'send_type')},
            ${selectNumber(icTransColumns, 't', 'send_day')},
            ${selectDate(icTransColumns, 't', 'send_date')},
            ${selectDate(icTransColumns, 't', 'delivery_date')},
            ${selectNumber(icTransColumns, 't', 'credit_day')},
            ${selectDate(icTransColumns, 't', 'credit_date')},
            ${selectDate(icTransColumns, 't', 'due_date')},
            ${selectText(icTransColumns, 't', 'transport_code')},
            COALESCE(t.discount_word,'') AS discount_word,
            COALESCE(t.discount_word_2,'') AS discount_word_2,
            COALESCE(t.doc_format_code,'') AS doc_format_code,
            COALESCE(df.name_1,'') AS doc_format_name,
            COALESCE(df.form_code,'') AS form_code,
          ${inventoryGlOverrideSelect},
          ${docGroupSelect},
          ${sideCodeSelect},
          ${departmentCodeSelect},
          ${allocateCodeSelect},
          ${projectCodeSelect},
          ${jobCodeSelect},
          ${contactorSelect},
          ${docRefSelect},
          ${docRefDateSelect},
          ${saleGroupSelect},
          ${cashierCodeSelect},
            t.total_amount, ${selectNumber(icTransColumns, 't', 'advance_amount')}, t.total_before_vat, t.total_vat_value,
            t.total_after_vat, t.total_discount, t.remark,
            ${selectText(icTransColumns, 't', 'remark_2')},
            ${selectText(icTransColumns, 't', 'remark_3')},
            ${selectText(icTransColumns, 't', 'remark_4')},
            ${selectText(icTransColumns, 't', 'remark_5')},
            ${selectText(icTransColumns, 't', 'user_approve')},
            COALESCE(t.send_sms,0) AS send_sms,
            ${selectNumber(icTransColumns, 't', 'used_status')},
            ${selectNumber(icTransColumns, 't', 'used_status_2')},
            ${selectNumber(icTransColumns, 't', 'doc_success')},
            ${selectNumber(icTransColumns, 't', 'last_status')},
            ${selectNumber(icTransColumns, 't', 'is_doc_copy')},
            COALESCE(t.remark_3,'') AS tiger_order_id,
            COALESCE(t.remark_5,'') AS tiger_status_note,
            ${cbTransColumns.has('total_net_amount') ? 'COALESCE(cb.total_net_amount, t.total_amount)' : 't.total_amount'} AS total_net_amount,
            ${cbNumberSelect('total_amount', 'cb_total_amount')},
            ${cbNumberSelect('total_amount_pay')},
            ${cbNumberSelect('cash_amount')},
            ${cbNumberSelect('pay_cash_amount')},
            ${cbNumberSelect('tranfer_amount')},
            ${cbNumberSelect('card_amount')},
            ${cbNumberSelect('chq_amount')},
            ${cbNumberSelect('petty_cash_amount')},
            ${cbNumberSelect('deposit_amount')},
            ${cbNumberSelect('coupon_amount')},
            ${cbNumberSelect('wallet_amount')},
            ${cbNumberSelect('total_credit_charge')},
            ${cbNumberSelect('total_income_amount')},
            ${cbNumberSelect('total_income_other')},
            ${cbNumberSelect('total_expense_other')},
            ${cbNumberSelect('money_change')}
         FROM ic_trans t
         LEFT JOIN cb_trans cb ON cb.doc_no = t.doc_no AND cb.trans_flag = 44
         LEFT JOIN ar_customer ar ON ar.code = t.cust_code
         LEFT JOIN erp_doc_format df ON df.screen_code = 'SI' AND df.code = t.doc_format_code
         WHERE t.trans_flag = 44 AND t.doc_no = $1 LIMIT 1`,
        [doc_no]
      ),
      query(
        `SELECT ${detailNumberSelect('line_number')},
          ${detailTextSelect('item_code')},
          ${detailTextSelect('item_name')},
          ${detailTextSelect('barcode')},
          ${detailTextSelect('unit_code')},
          ${detailNumberSelect('qty')},
          ${detailNumberSelect('price')},
          ${detailNumberSelect('price_2')},
          ${detailNumberSelect('price_type')},
          ${detailNumberSelect('price_mode')},
          ${detailTextSelect('price_info')},
          ${detailNumberSelect('price_default')},
          ${detailNumberSelect('have_point')},
          ${detailNumberSelect('drink_type')},
          ${detailNumberSelect('no_discount')},
          ${detailNumberSelect('sum_amount')},
          ${detailNumberSelect('sum_amount_2')},
          ${detailTextSelect('discount')},
          ${detailNumberSelect('discount_amount')},
          ${detailNumberSelect('discount_amount_2')},
          ${detailTextSelect('wh_code')},
          ${detailTextSelect('shelf_code')},
          ${detailTextSelect('remark')},
          ${detailNumberSelect('stand_value')},
          ${detailNumberSelect('divide_value')},
          ${detailNumberSelect('ratio')},
          ${detailNumberSelect('tax_type')},
          ${detailNumberSelect('vat_type')},
          ${detailNumberSelect('total_vat_value')},
          ${detailNumberSelect('sum_amount_exclude_vat')},
          ${detailNumberSelect('price_exclude_vat')},
          ${detailTextSelect('currency_code')},
          ${detailNumberSelect('item_type')},
          ${detailTextSelect('set_ref_line')},
          ${detailNumberSelect('set_ref_price')},
          ${detailNumberSelect('set_ref_qty')},
          ${detailTextSelect('item_code_main')},
          ${detailTextSelect('ref_guid')},
          ${detailNumberSelect('price_set_ratio')},
          ${detailTextSelect('ref_doc_no')},
          ${detailNumberSelect('ref_row')},
          ${detailDateSelect('doc_date_calc')}
         FROM ic_trans_detail d
         WHERE d.trans_flag = 44 AND d.doc_no = $1
         ORDER BY ${icTransDetailColumns.has('line_number') ? 'COALESCE(d.line_number, 0)' : 'NULL'},
                  ${icTransDetailColumns.has('roworder') ? 'COALESCE(d.roworder, 0)' : 'NULL'},
                  ${icTransDetailColumns.has('item_code') ? 'd.item_code' : 'NULL'}`,
        [doc_no]
      ),
      query(
        `SELECT to_regclass('public.ic_trans_detail_promotion') IS NOT NULL AS table_exists`,
        []
      ),
      query(
        `SELECT to_regclass('public.ic_trans_pos_campaign') IS NOT NULL AS trans_table_exists,
                to_regclass('public.pos_slip_campaign') IS NOT NULL AS campaign_table_exists`,
        []
      ),
      query(
        `SELECT tax_doc_no, due_date, cust_code, cust_name, cust_address,
                COALESCE(cust_tax_type, 0) AS cust_tax_type,
                COALESCE(tax_number, '') AS tax_number,
                COALESCE(card_number, '') AS card_number,
                COALESCE(amount, 0) AS amount,
                COALESCE(tax_value, 0) AS tax_value,
                COALESCE(line_number, 0) AS line_number
         FROM gl_wht_list
         WHERE trans_flag = 44 AND doc_no = $1
         ORDER BY line_number, tax_doc_no`,
        [doc_no]
      ),
      query(
        `SELECT tax_doc_no, income_type, amount, tax_rate, tax_value,
                COALESCE(sum_amount, amount) AS sum_amount,
                due_date,
                COALESCE(line_number, 0) AS line_number
         FROM gl_wht_list_detail
         WHERE trans_flag = 44 AND doc_no = $1
         ORDER BY tax_doc_no, line_number`,
        [doc_no]
      ),
      query(
        `SELECT COALESCE(line_number, 0) AS line_number,
                vat_date, vat_number, vat_effective_period, vat_effective_year,
                COALESCE(description, '') AS description,
                COALESCE(tax_group, '') AS tax_group,
                COALESCE(base_caltax_amount, 0) AS base_caltax_amount,
                COALESCE(tax_rate, 0) AS tax_rate,
                COALESCE(amount, 0) AS amount,
                COALESCE(except_tax_amount, 0) AS except_tax_amount,
                COALESCE(vat_type, 0) AS vat_type,
                COALESCE(is_add, 0) AS is_add,
                COALESCE(ar_name, '') AS ar_name,
                COALESCE(tax_no, '') AS tax_no,
                COALESCE(branch_type, 0) AS branch_type,
                COALESCE(branch_code, '') AS branch_code,
                COALESCE(manual_add, 0) AS manual_add,
                COALESCE(ref_vat_no, '') AS ref_vat_no,
                ref_vat_date,
                COALESCE(ref_doc_no, '') AS ref_doc_no,
                ref_doc_date
         FROM gl_journal_vat_sale
         WHERE trans_flag = 44 AND doc_no = $1
         ORDER BY line_number`,
        [doc_no]
      ),
      query(
        `SELECT COALESCE(transport_name, '') AS transport_name,
                COALESCE(transport_address, '') AS transport_address,
                COALESCE(transport_telephone, '') AS transport_telephone,
                COALESCE(transport_fax, '') AS transport_fax,
                COALESCE(transport_tambon, '') AS transport_tambon,
                COALESCE(transport_amper, '') AS transport_amper,
                COALESCE(transport_province, '') AS transport_province,
                COALESCE(transport_country, '') AS transport_country,
                COALESCE(zipcode, '') AS zipcode,
                COALESCE(transport_code, '') AS transport_code,
                COALESCE(destination, '') AS destination,
                COALESCE(remark, '') AS remark,
                COALESCE(remark_2, '') AS remark_2,
                COALESCE(ship_code, '') AS ship_code,
                COALESCE(logistic_area, '') AS logistic_area,
                COALESCE(latitude, 0) AS latitude,
                COALESCE(longitude, 0) AS longitude
         FROM ic_trans_shipment
         WHERE trans_flag = 44 AND doc_no = $1
         LIMIT 1`,
        [doc_no]
      ),
      query(
        `SELECT COALESCE(line_number, 0) AS line_number,
                COALESCE(doc_type, 0) AS doc_type,
                COALESCE(trans_number, '') AS trans_number,
                COALESCE(pass_book_code, '') AS pass_book_code,
                COALESCE((SELECT name_1 FROM erp_pass_book WHERE code = COALESCE(NULLIF(cb_trans_detail.pass_book_code, ''), cb_trans_detail.trans_number) LIMIT 1), '') AS book_name,
                COALESCE((SELECT book_number FROM erp_pass_book WHERE code = COALESCE(NULLIF(cb_trans_detail.pass_book_code, ''), cb_trans_detail.trans_number) LIMIT 1), '') AS book_number,
                COALESCE(bank_code, '') AS bank_code,
                COALESCE(bank_branch, '') AS bank_branch,
                COALESCE(credit_card_type, '') AS credit_card_type,
                COALESCE(no_approved, '') AS no_approved,
                COALESCE(ref1, '') AS ref1,
                COALESCE(ref2, '') AS ref2,
                COALESCE(doc_ref, '') AS doc_ref,
                doc_date_ref,
                chq_due_date,
                ${cbDescriptionSelect},
                ${cbRemarkSelect},
                ${cbCurrencyCodeSelect},
                ${cbExchangeRateSelect},
                COALESCE(amount, 0) AS amount,
                COALESCE(sum_amount, 0) AS sum_amount,
                COALESCE(charge, 0) AS charge,
                COALESCE(balance_amount, 0) AS balance_amount,
                ${cbSumAmount2Select},
                ${cbAmount2Select},
                ${cbCharge2Select},
                ${cbExchangeRateOldSelect},
                ${cbLostProfitExchangeAmountSelect},
                ${cbTransNumberTypeSelect},
                ${cbApArTypeSelect},
                ${cbChqOnHandSelect}
         FROM cb_trans_detail
         WHERE trans_flag = 44 AND doc_no = $1
         ORDER BY line_number`,
        [doc_no]
      ),
      query(
        `SELECT ${glHeaderSelectParts.join(', ')}
         FROM gl_trans
         WHERE trans_flag = 44 AND doc_no = $1
         LIMIT 1`,
        [doc_no]
      ),
      query(
        `SELECT COALESCE(line_number, 0) AS line_number,
                COALESCE(account_code, '') AS account_code,
                COALESCE(account_name, '') AS account_name,
                COALESCE(debit, 0) AS debit,
                COALESCE(credit, 0) AS credit
         FROM gl_trans_detail
         WHERE trans_flag = 44 AND doc_no = $1
         ORDER BY line_number`,
        [doc_no]
      ),
    ]);
    let promotions = [];
    if (promotionTableRes.rows[0]?.table_exists) {
      const promotionRes = await query(
        `SELECT promotion_code, promotion_name, qty, price, sum_amount, line_number
         FROM ic_trans_detail_promotion
         WHERE trans_flag = 44 AND doc_no = $1
         ORDER BY line_number`,
        [doc_no]
      );
      promotions = promotionRes.rows;
    }
    let pos_campaign_detail = [];
    const posCampaignTable = posCampaignTableRes.rows[0] || {};
    if (posCampaignTable.trans_table_exists) {
      const posCampaignRes = await query(
        `SELECT tc.campaign_code,
                COALESCE(pc.name_1, '') AS campaign_name,
                COALESCE(pc.display_wording, '') AS display_wording,
                COALESCE(tc.qty, 0) AS qty,
                COALESCE(tc.line_number, 0) AS line_number
         FROM ic_trans_pos_campaign tc
         ${posCampaignTable.campaign_table_exists ? 'LEFT JOIN pos_slip_campaign pc ON pc.code = tc.campaign_code' : "LEFT JOIN (SELECT ''::text AS code, ''::text AS name_1, ''::text AS display_wording) pc ON false"}
         WHERE tc.trans_flag = 44 AND tc.doc_no = $1
         ORDER BY COALESCE(tc.line_number, 0), tc.campaign_code`,
        [doc_no]
      );
      pos_campaign_detail = posCampaignRes.rows.map((row, index) => ({
        line_number: asNumber(row.line_number, index),
        campaign_code: asText(row.campaign_code),
        campaign_name: asText(row.campaign_name),
        display_wording: asText(row.display_wording),
        promotion_text: asText(row.display_wording),
        qty: asNumber(row.qty),
      }));
    }
    // เอกสารอ้างอิงที่ดึงมา (ใบเสนอราคา/ใบสั่งจอง/ใบสั่งขาย) — บันทึกใน ap_ar_trans_detail ตอน save
    const refBillingsRes = await query(
      `SELECT COALESCE(billing_no, '') AS billing_no,
              billing_date,
              COALESCE(ref_doc_no, '') AS ref_doc_no,
              ref_doc_date,
              COALESCE(bill_type, 0) AS bill_type,
              COALESCE(line_number, 0) AS line_number,
              COALESCE(remark, '') AS remark
       FROM ap_ar_trans_detail
       WHERE doc_no = $1 AND trans_flag = 44
       ORDER BY COALESCE(line_number, 0)`,
      [doc_no]
    );
    const ref_billings = refBillingsRes.rows.map((row, index) => ({
      doc_no: asText(row.billing_no),
      doc_date: normalizeDateString(row.billing_date),
      ref_doc_no: asText(row.ref_doc_no),
      ref_doc_date: normalizeDateString(row.ref_doc_date),
      bill_type: asNumber(row.bill_type),
      line_number: asNumber(row.line_number, index),
      remark: asText(row.remark),
    }));
    const detailsByTaxDocNo = new Map();
    for (const row of whtDetailRes.rows) {
      const taxDocNo = asText(row.tax_doc_no);
      const bucket = detailsByTaxDocNo.get(taxDocNo) || [];
      bucket.push({
        line_number: asNumber(row.line_number),
        income_type: asText(row.income_type),
        amount: asNumber(row.amount),
        tax_rate: asNumber(row.tax_rate),
        tax_value: asNumber(row.tax_value),
        sum_amount: asNumber(row.sum_amount),
        due_date: normalizeDateString(row.due_date),
      });
      detailsByTaxDocNo.set(taxDocNo, bucket);
    }
    const wht_headers = whtHeaderRes.rows.map((row, index) => ({
      line_number: asNumber(row.line_number, index),
      tax_doc_no: asText(row.tax_doc_no),
      due_date: normalizeDateString(row.due_date),
      cust_code: asText(row.cust_code),
      cust_name: asText(row.cust_name),
      cust_address: asText(row.cust_address),
      cust_tax_type: asNumber(row.cust_tax_type),
      tax_number: asText(row.tax_number),
      card_number: asText(row.card_number),
      amount: asNumber(row.amount),
      tax_value: asNumber(row.tax_value),
      details: detailsByTaxDocNo.get(asText(row.tax_doc_no)) || [],
    }));
    const vat_rows = vatRowsRes.rows.map((row, index) => ({
      line_number: asNumber(row.line_number, index),
      vat_date: normalizeDateString(row.vat_date),
      vat_number: asText(row.vat_number),
      vat_effective_period: asNumber(row.vat_effective_period),
      vat_effective_year: asNumber(row.vat_effective_year),
      description: asText(row.description),
      tax_group: asText(row.tax_group),
      base_caltax_amount: asNumber(row.base_caltax_amount),
      tax_rate: asNumber(row.tax_rate),
      amount: asNumber(row.amount),
      except_tax_amount: asNumber(row.except_tax_amount),
      vat_type: asNumber(row.vat_type),
      is_add: asNumber(row.is_add),
      ar_name: asText(row.ar_name),
      tax_no: asText(row.tax_no),
      branch_type: asNumber(row.branch_type),
      branch_code: asText(row.branch_code),
      manual_add: asNumber(row.manual_add),
      ref_vat_no: asText(row.ref_vat_no),
      ref_vat_date: normalizeDateString(row.ref_vat_date),
      ref_doc_no: asText(row.ref_doc_no),
      ref_doc_date: normalizeDateString(row.ref_doc_date),
    }));
    const gl_detail = glDetailRes.rows.map((row, index) => ({
      line_number: asNumber(row.line_number, index),
      account_code: asText(row.account_code),
      account_name: asText(row.account_name),
      debit: asNumber(row.debit),
      credit: asNumber(row.credit),
    }));
    const glHeaderData = glHeaderRes.rows[0] || {};
    const gl_trans_direct = asNumber(glHeaderData.trans_direct, gl_detail.length > 0 ? 1 : 0) === 1 ? 1 : 0;
    const gl_header = {
      ref_date: normalizeDateString(glHeaderData.ref_date),
      ref_no: asText(glHeaderData.ref_no),
      book_code: asText(glHeaderData.book_code),
      journal_type: asNumber(glHeaderData.journal_type),
      description: asText(glHeaderData.description),
      ap_ar_code: asText(glHeaderData.ap_ar_code),
      ap_ar_originate_from: asNumber(glHeaderData.ap_ar_originate_from),
      period_number: asNumber(glHeaderData.period_number),
      account_year: asNumber(glHeaderData.account_year),
    };
    const shipmentData = shipmentRes.rows[0] || {};
    const shipment = {
      transport_name: asText(shipmentData.transport_name),
      transport_address: asText(shipmentData.transport_address),
      transport_telephone: asText(shipmentData.transport_telephone),
      transport_fax: asText(shipmentData.transport_fax),
      transport_tambon: asText(shipmentData.transport_tambon),
      transport_amper: asText(shipmentData.transport_amper),
      transport_province: asText(shipmentData.transport_province),
      transport_country: asText(shipmentData.transport_country),
      zipcode: asText(shipmentData.zipcode),
      transport_code: asText(shipmentData.transport_code),
      destination: asText(shipmentData.destination),
      remark: asText(shipmentData.remark),
      remark_2: asText(shipmentData.remark_2),
      ship_code: asText(shipmentData.ship_code),
      logistic_area: asText(shipmentData.logistic_area),
      latitude: asNumber(shipmentData.latitude),
      longitude: asNumber(shipmentData.longitude),
    };
    const payment_detail = paymentDetailRes.rows.map((row, index) => ({
      line_number: asNumber(row.line_number, index),
      doc_type: asNumber(row.doc_type),
      payment_type_name: ({
        1: 'โอน',
        2: 'เช็ค',
        3: 'บัตรเครดิต',
        4: 'เงินสดย่อย',
        5: 'เงินล่วงหน้า',
        6: 'เงินมัดจำ',
        9: 'คูปอง',
        11: 'ค่าใช้จ่ายอื่น',
        12: 'รายได้อื่น',
        21: 'Wallet',
      })[asNumber(row.doc_type)] || '',
      trans_number: asText(row.trans_number),
      pass_book_code: asText(row.pass_book_code),
      book_name: asText(row.book_name),
      book_number: asText(row.book_number),
      bank_code: asText(row.bank_code),
      bank_branch: asText(row.bank_branch),
      credit_card_type: asText(row.credit_card_type),
      no_approved: asText(row.no_approved),
      ref1: asText(row.ref1),
      ref2: asText(row.ref2),
      doc_ref: asText(row.doc_ref),
      doc_date_ref: normalizeDateString(row.doc_date_ref),
      chq_due_date: normalizeDateString(row.chq_due_date),
      description: asText(row.description),
      remark: asText(row.remark),
      currency_code: asText(row.currency_code),
      exchange_rate: asNumber(row.exchange_rate, 1),
      amount: asNumber(row.amount),
      sum_amount: asNumber(row.sum_amount),
      charge: asNumber(row.charge),
      balance_amount: asNumber(row.balance_amount),
      sum_amount_2: asNumber(row.sum_amount_2),
      amount_2: asNumber(row.amount_2),
      charge_2: asNumber(row.charge_2),
      exchange_rate_old: asNumber(row.exchange_rate_old),
      lost_profit_exchange_amount: asNumber(row.lost_profit_exchange_amount),
      trans_number_type: asNumber(row.trans_number_type),
      ap_ar_type: asNumber(row.ap_ar_type),
      chq_on_hand: asNumber(row.chq_on_hand),
    }));
    const h = headerRes.rows[0] || {};
    const sumPayments = (types, amountPicker = (row) => row.amount || row.sum_amount) => {
      const typeSet = new Set(Array.isArray(types) ? types : [types]);
      return payment_detail.reduce((sum, row) => (
        typeSet.has(asNumber(row.doc_type)) ? sum + asNumber(amountPicker(row)) : sum
      ), 0);
    };
    const payment_summary = {
      document_amount: asNumber(h.total_net_amount, asNumber(h.total_amount)),
      total_paid: asNumber(h.total_amount_pay),
      cash_amount: asNumber(h.cash_amount),
      pay_cash_amount: asNumber(h.pay_cash_amount),
      money_change: asNumber(h.money_change),
      transfer_amount: asNumber(h.tranfer_amount) || sumPayments(1),
      cheque_amount: asNumber(h.chq_amount) || sumPayments(2),
      credit_card_amount: asNumber(h.card_amount) || sumPayments(3, (row) => asNumber(row.amount) + asNumber(row.charge)),
      credit_card_charge: asNumber(h.total_credit_charge) || sumPayments(3, (row) => row.charge),
      petty_cash_amount: asNumber(h.petty_cash_amount) || sumPayments(4),
      deposit_amount: sumPayments(5) || asNumber(h.deposit_amount),
      advance_amount: sumPayments(6) || asNumber(h.advance_amount),
      coupon_amount: asNumber(h.coupon_amount) || sumPayments(9),
      expense_other_amount: asNumber(h.total_expense_other) || sumPayments(11),
      income_other_amount: asNumber(h.total_income_other) || sumPayments(12),
      wallet_amount: asNumber(h.wallet_amount) || sumPayments(21),
    };
    if (!payment_summary.total_paid) {
      payment_summary.total_paid = payment_summary.cash_amount
        + payment_summary.transfer_amount
        + payment_summary.cheque_amount
        + payment_summary.credit_card_amount
        + payment_summary.petty_cash_amount
        + payment_summary.deposit_amount
        + payment_summary.coupon_amount
        + payment_summary.income_other_amount
        + payment_summary.wallet_amount
        - payment_summary.expense_other_amount;
    }
    payment_summary.non_cash_amount = payment_summary.total_paid - payment_summary.cash_amount;
    return res.json({
      success: true,
      data: {
        header: h,
        items: itemsRes.rows,
        shipment,
        payment_summary,
        payment_detail,
        wht_headers,
        vat_rows,
        gl_trans_direct,
        gl_header,
        gl_detail,
        promotions,
        promotion_detail: promotions,
        pos_campaign_detail,
        ref_billings,
      },
    });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

module.exports = router;
