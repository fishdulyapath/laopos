// ─────────────────────────────────────────────────────────────────────────────
// BizSuite-specific endpoints
//
// Endpoints ใหม่สำหรับ frontend BizSuite (back-office sales)
// อ้างอิง: trans_flag = 44 = ขาย, last_status = 0 = ปกติ
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { calcFormulaPrice } = require('../utils/priceHelper');

// ── helper: format date YYYY-MM-DD ──────────────────────────────────────────
function todayDateStr() {
  return new Date().toISOString().slice(0, 10);
}

// ── helper: pct change ──────────────────────────────────────────────────────
function pctChange(curr, prev) {
  const c = parseFloat(curr) || 0;
  const p = parseFloat(prev) || 0;
  if (p === 0) return c > 0 ? 100 : 0;
  return ((c - p) / p) * 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /service/v1/getBarcodeItem
// ค้นหาสินค้าจาก barcode → return รายละเอียดเต็ม (price, unit, stock)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/getBarcodeItem', async (req, res) => {
  const { barcode = '', custcode = '' } = req.query;
  if (!barcode.trim()) {
    return res.status(400).json({ success: false, msg: 'barcode is required' });
  }
  try {
    // Resolve item ผ่าน ic_inventory_barcode → ic_inventory
    const result = await query(
      `SELECT
         b.ic_code             AS item_code,
         i.name_1               AS item_name,
         b.barcode              AS barcode,
         COALESCE(b.unit_code, i.unit_standard) AS unit_code,
         COALESCE(b.price, 0) AS price,
         COALESCE(u.stand_value, i.unit_standard_stand_value, 1) AS stand_value,
         COALESCE(u.divide_value, i.unit_standard_divide_value, 1) AS divide_value,
         CASE WHEN COALESCE(u.divide_value, i.unit_standard_divide_value, 1) <> 0
              THEN COALESCE(u.stand_value, i.unit_standard_stand_value, 1)::numeric
                / COALESCE(u.divide_value, i.unit_standard_divide_value, 1)::numeric
              ELSE 1 END AS ratio,
         COALESCE(i.balance_qty, 0) AS stock_qty,
         COALESCE(i.tax_type, '0') AS tax_type
       FROM ic_inventory_barcode b
       JOIN ic_inventory i ON i.code = b.ic_code
       LEFT JOIN ic_unit_use u ON u.ic_code = b.ic_code AND u.code = COALESCE(b.unit_code, i.unit_standard)
       WHERE b.barcode = $1
       LIMIT 1`,
      [barcode.trim()]
    );

    if (result.rows.length === 0) {
      return res.json({ success: true, data: [] });
    }
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /service/v1/getBarcodeItemSearch
// ค้นหาสินค้าด้วย code / name / barcode → return list (ใช้ใน search dialog)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/getBarcodeItemSearch', async (req, res) => {
  const { search = '', custcode = '', limit = '30' } = req.query;
  const q = search.trim();
  if (!q) return res.json({ success: true, data: [] });

  try {
    const lim = Math.min(parseInt(limit, 10) || 30, 100);
    const like = `%${q.toUpperCase()}%`;

    const result = await query(
      `SELECT
         i.code                                    AS item_code,
         i.name_1                                  AS item_name,
         i.unit_standard                           AS unit_code,
         COALESCE((
           SELECT b.barcode FROM ic_inventory_barcode b
           WHERE b.ic_code = i.code AND b.unit_code = i.unit_standard
           LIMIT 1
         ), '')                                    AS barcode,
         COALESCE((
           SELECT b.price FROM ic_inventory_barcode b
           WHERE b.ic_code = i.code AND b.unit_code = i.unit_standard
           LIMIT 1
         ), 0)                                     AS price,
         COALESCE(i.balance_qty, 0)                AS stock_qty,
         COALESCE(u.stand_value, i.unit_standard_stand_value, 1)  AS stand_value,
         COALESCE(u.divide_value, i.unit_standard_divide_value, 1) AS divide_value,
         CASE WHEN COALESCE(u.divide_value, i.unit_standard_divide_value, 1) <> 0
              THEN COALESCE(u.stand_value, i.unit_standard_stand_value, 1)::numeric
                / COALESCE(u.divide_value, i.unit_standard_divide_value, 1)::numeric
              ELSE 1 END AS ratio,
         COALESCE(i.tax_type, '0')                 AS tax_type
       FROM ic_inventory i
       LEFT JOIN ic_unit_use u ON u.ic_code = i.code AND u.code = i.unit_standard
       WHERE
         UPPER(i.code) LIKE $1
         OR UPPER(i.name_1) LIKE $1
         OR EXISTS (
           SELECT 1 FROM ic_inventory_barcode b
           WHERE b.ic_code = i.code AND UPPER(b.barcode) LIKE $1
         )
       ORDER BY i.code
       LIMIT $2`,
      [like, lim]
    );
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /service/v1/getDashboardSummary
// สำหรับ stats cards บน Dashboard (ยอดวันนี้)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/getDashboardSummary', async (req, res) => {
  const date = req.query.date || todayDateStr();
  try {
    // ─── ยอดวันนี้ ─────────────────────────────────────
    const todayRes = await query(
      `SELECT
         COUNT(t.doc_no)::int                                       AS total_bills,
         COALESCE(SUM(COALESCE(cb.total_net_amount, t.total_amount)), 0)::numeric AS total_sales
       FROM ic_trans t
       LEFT JOIN cb_trans cb ON cb.doc_no = t.doc_no AND cb.trans_flag = 44
       WHERE t.trans_flag = 44
         AND t.last_status = 0
         AND t.doc_date = $1::date`,
      [date]
    );
    const today = todayRes.rows[0] || { total_bills: 0, total_sales: 0 };

    // ─── ยอดเมื่อวาน (เทียบ trend) ─────────────────────
    const yRes = await query(
      `SELECT
         COUNT(t.doc_no)::int                                       AS total_bills,
         COALESCE(SUM(COALESCE(cb.total_net_amount, t.total_amount)), 0)::numeric AS total_sales
       FROM ic_trans t
       LEFT JOIN cb_trans cb ON cb.doc_no = t.doc_no AND cb.trans_flag = 44
       WHERE t.trans_flag = 44
         AND t.last_status = 0
         AND t.doc_date = $1::date - 1`,
      [date]
    );
    const y = yRes.rows[0] || { total_bills: 0, total_sales: 0 };

    // ─── เงินเชื่อค้าง (ทั้งระบบ) ─────────────────────
    // inquiry_type = 0 = ขายเงินเชื่อ (ตาม Java), จ่ายไม่ครบ
    const credRes = await query(
      `SELECT
         COUNT(t.doc_no)::int AS credit_pending_count,
         COALESCE(SUM(
           COALESCE(cb.total_net_amount, t.total_amount)
           - COALESCE(cb.cash_amount, 0)
           - COALESCE(cb.tranfer_amount, 0)
           - COALESCE(cb.card_amount, 0)
           - COALESCE(cb.wallet_amount, 0)
         ), 0)::numeric AS credit_pending_amount
       FROM ic_trans t
       LEFT JOIN cb_trans cb ON cb.doc_no = t.doc_no AND cb.trans_flag = 44
       WHERE t.trans_flag = 44
         AND t.last_status = 0
         AND t.inquiry_type = 0
         AND COALESCE(cb.total_net_amount, t.total_amount) >
             COALESCE(cb.cash_amount,0) + COALESCE(cb.tranfer_amount,0)
             + COALESCE(cb.card_amount,0) + COALESCE(cb.wallet_amount,0)`
    );
    const cred = credRes.rows[0] || { credit_pending_count: 0, credit_pending_amount: 0 };

    const total_sales = parseFloat(today.total_sales) || 0;
    const total_bills = parseInt(today.total_bills) || 0;
    const avg_per_bill = total_bills > 0 ? total_sales / total_bills : 0;

    return res.json({
      success: true,
      data: {
        date,
        total_sales,
        total_bills,
        avg_per_bill,
        credit_pending: parseInt(cred.credit_pending_count) || 0,
        credit_pending_amount: parseFloat(cred.credit_pending_amount) || 0,
        trend_sales: pctChange(today.total_sales, y.total_sales),
        trend_bills: pctChange(today.total_bills, y.total_bills),
      },
    });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /service/v1/getRecentBills?limit=5
// บิลล่าสุดสำหรับ Dashboard
// ─────────────────────────────────────────────────────────────────────────────
router.get('/getRecentBills', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 5, 50);
  try {
    const result = await query(
      `SELECT
         t.doc_no,
         t.doc_date,
         t.doc_time,
         t.cust_code,
         COALESCE(ar.name_1, '') AS cust_name,
         t.sale_code AS emp_code,
         (SELECT name_1 FROM erp_user WHERE UPPER(code) = UPPER(t.sale_code) LIMIT 1) AS emp_name,
         t.inquiry_type AS sale_type,
         COALESCE(t.total_amount, 0) AS total_amount,
         COALESCE(cb.total_net_amount, t.total_amount, 0) AS total_net_amount,
         (SELECT COUNT(*) FROM ic_trans_detail d WHERE d.doc_no = t.doc_no AND d.trans_flag = 44)::int AS items_count,
         (t.ref_doc_no IS NOT NULL AND t.ref_doc_no <> '') AS has_reference,
         CASE
           WHEN t.last_status = 1 THEN 'canceled'
           WHEN t.inquiry_type = 0 AND COALESCE(cb.total_net_amount, t.total_amount) >
                COALESCE(cb.cash_amount,0) + COALESCE(cb.tranfer_amount,0)
                + COALESCE(cb.card_amount,0) + COALESCE(cb.wallet_amount,0) THEN 'pending'
           ELSE 'normal'
         END AS status,
         t.create_datetime AS created_at
       FROM ic_trans t
       LEFT JOIN ar_customer ar ON ar.code = t.cust_code
       LEFT JOIN cb_trans cb ON cb.doc_no = t.doc_no AND cb.trans_flag = 44
       WHERE t.trans_flag = 44
       ORDER BY t.create_datetime DESC NULLS LAST, t.doc_date DESC, t.doc_time DESC
       LIMIT $1`,
      [limit]
    );
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /service/v1/getSaleHistorySummary?from_date&to_date
// summary cards สำหรับหน้า SalesHistory (จำนวนบิล / ยอด / เฉลี่ย / ค้างจ่าย)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/getSaleHistorySummary', async (req, res) => {
  const { from_date = '', to_date = '' } = req.query;
  if (!from_date || !to_date) {
    return res.status(400).json({ success: false, msg: 'from_date and to_date are required' });
  }
  try {
    const sumRes = await query(
      `SELECT
         COUNT(t.doc_no)::int AS total_bills,
         COALESCE(SUM(COALESCE(cb.total_net_amount, t.total_amount)), 0)::numeric AS total_amount
       FROM ic_trans t
       LEFT JOIN cb_trans cb ON cb.doc_no = t.doc_no AND cb.trans_flag = 44
       WHERE t.trans_flag = 44
         AND t.last_status = 0
         AND t.doc_date BETWEEN $1::date AND $2::date`,
      [from_date, to_date]
    );
    const sum = sumRes.rows[0] || { total_bills: 0, total_amount: 0 };

    const credRes = await query(
      `SELECT
         COUNT(t.doc_no)::int AS pending_count,
         COALESCE(SUM(
           COALESCE(cb.total_net_amount, t.total_amount)
           - COALESCE(cb.cash_amount, 0)
           - COALESCE(cb.tranfer_amount, 0)
           - COALESCE(cb.card_amount, 0)
           - COALESCE(cb.wallet_amount, 0)
         ), 0)::numeric AS pending_amount
       FROM ic_trans t
       LEFT JOIN cb_trans cb ON cb.doc_no = t.doc_no AND cb.trans_flag = 44
       WHERE t.trans_flag = 44
         AND t.last_status = 0
         AND t.inquiry_type = 0
         AND t.doc_date BETWEEN $1::date AND $2::date
         AND COALESCE(cb.total_net_amount, t.total_amount) >
             COALESCE(cb.cash_amount,0) + COALESCE(cb.tranfer_amount,0)
             + COALESCE(cb.card_amount,0) + COALESCE(cb.wallet_amount,0)`,
      [from_date, to_date]
    );
    const cred = credRes.rows[0] || { pending_count: 0, pending_amount: 0 };

    const total_bills = parseInt(sum.total_bills) || 0;
    const total_amount = parseFloat(sum.total_amount) || 0;

    return res.json({
      success: true,
      data: {
        from_date,
        to_date,
        total_bills,
        total_amount,
        avg_per_bill: total_bills > 0 ? total_amount / total_bills : 0,
        credit_pending_count: parseInt(cred.pending_count) || 0,
        credit_pending_amount: parseFloat(cred.pending_amount) || 0,
      },
    });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /service/v1/getReferenceDocs
// ใบเสนอราคา (QT) / สั่งซื้อ (PO) / สั่งจอง (PB) / สั่งขาย (SO)
// ─────────────────────────────────────────────────────────────────────────────
// trans_flag mapping ที่ใช้ทั่วไปใน SML:
//   13 = ใบเสนอราคา
//   16 = ใบสั่งจอง
//   17 = ใบสั่งขาย
//   30 = ใบสั่งซื้อ (purchase order)
router.get('/getReferenceDocs', async (req, res) => {
  const {
    doc_type = '',  // 'qt' | 'po' | 'pb' | 'so' หรือว่าง = ทั้งหมด
    cust_code = '',
    from_date = '',
    to_date = '',
    search = '',
  } = req.query;

  const flagMap = { qt: 13, pb: 16, so: 17, po: 30 };

  try {
    const params = [];
    const conds = [`t.last_status = 0`];

    if (doc_type && flagMap[doc_type]) {
      params.push(flagMap[doc_type]);
      conds.push(`t.trans_flag = $${params.length}`);
    } else {
      conds.push(`t.trans_flag IN (13, 16, 17, 30)`);
    }

    if (cust_code.trim()) {
      params.push(cust_code.trim());
      conds.push(`t.cust_code = $${params.length}`);
    }

    if (from_date.trim() && to_date.trim()) {
      params.push(from_date.trim(), to_date.trim());
      conds.push(`t.doc_date BETWEEN $${params.length - 1}::date AND $${params.length}::date`);
    }

    if (search.trim()) {
      params.push(`%${search.trim()}%`);
      conds.push(`(t.doc_no ILIKE $${params.length} OR ar.name_1 ILIKE $${params.length})`);
    }

    const sql = `
      SELECT
        t.doc_no, t.doc_date, t.trans_flag,
        CASE t.trans_flag
          WHEN 13 THEN 'qt'
          WHEN 16 THEN 'pb'
          WHEN 17 THEN 'so'
          WHEN 30 THEN 'po'
          ELSE 'other'
        END AS doc_type,
        CASE t.trans_flag
          WHEN 13 THEN 'ใบเสนอราคา'
          WHEN 16 THEN 'ใบสั่งจอง'
          WHEN 17 THEN 'ใบสั่งขาย'
          WHEN 30 THEN 'ใบสั่งซื้อ'
          ELSE ''
        END AS doc_type_name,
        t.cust_code,
        COALESCE(ar.name_1, '') AS cust_name,
        COALESCE(t.sale_code, '') AS sale_code,
        COALESCE((SELECT u.name_1 FROM erp_user u WHERE UPPER(u.code) = UPPER(t.sale_code) LIMIT 1), '') AS sale_name,
        COALESCE(t.total_amount, 0) AS total_amount,
        COALESCE(t.remark, '') AS remark
      FROM ic_trans t
      LEFT JOIN ar_customer ar ON ar.code = t.cust_code
      WHERE ${conds.join(' AND ')}
      ORDER BY t.doc_date DESC, t.doc_no DESC
      LIMIT 200
    `;
    const result = await query(sql, params);
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /service/v1/getSaleRefDocList
// ดึงรายการเอกสารอ้างอิงของลูกค้า สำหรับใช้ในหน้าขาย (SellView "ดึงเอกสารอ้างอิง")
// อ้างอิง C#: SMLInventoryControl/_icTransRefControl.cs _displayIcTransSearch()
//   case ขาย_ขายสินค้าและบริการ: filter cust_code + doc_success=0 + last_status=0
//   3 ประเภท: 1=ใบเสนอราคา(30), 2=ใบสั่งจอง(34), 3=ใบสั่งขาย(36)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/getSaleRefDocList', async (req, res) => {
  const {
    cust_code = '',
    doc_type = '',
    from_date = '',
    to_date = '',
    search = '',
  } = req.query;

  // doc_type → trans_flag (ตาม SML standard)
  const FLAG_MAP = { qt: 30, reserve: 34, so: 36 };
  const flag = FLAG_MAP[doc_type];

  if (!cust_code.trim()) {
    return res.status(400).json({ success: false, msg: 'cust_code is required' });
  }
  if (!flag) {
    return res.status(400).json({ success: false, msg: "doc_type must be 'qt', 'reserve', or 'so'" });
  }

  try {
    const params = [flag, cust_code.trim()];
    const conds = [
      `t.trans_flag = $1`,
      `t.cust_code = $2`,
      `COALESCE(t.last_status, 0) = 0`,
      `COALESCE(t.doc_success, 0) = 0`,
    ];

    if (from_date.trim() && to_date.trim()) {
      params.push(from_date.trim(), to_date.trim());
      conds.push(`t.doc_date BETWEEN $${params.length - 1}::date AND $${params.length}::date`);
    }

    if (search.trim()) {
      params.push(`%${search.trim()}%`);
      conds.push(`t.doc_no ILIKE $${params.length}`);
    }

    const sql = `
      SELECT
        t.doc_no,
        t.doc_date,
        t.trans_flag,
        t.cust_code,
        COALESCE(ar.name_1, '') AS cust_name,
        COALESCE(t.total_amount, 0) AS total_amount,
        COALESCE(t.remark, '') AS remark
      FROM ic_trans t
      LEFT JOIN ar_customer ar ON ar.code = t.cust_code
      WHERE ${conds.join(' AND ')}
      ORDER BY t.doc_date DESC, t.doc_no DESC
      LIMIT 200
    `;
    const result = await query(sql, params);
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    console.error('getSaleRefDocList error:', ex.message);
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /service/v1/getSaleRefDocItems
// ดึงรายการสินค้า (พร้อม balance qty) ของเอกสารต้นทาง
// อ้างอิง C#: SMLProcess/DocRefProcess/_docRefProcess.cs ProcessDocRef()
//   - balance qty = original_qty - sum(referenced qty)
//   - fallback wh/shelf จาก ic_inventory_detail.start_sale_wh/shelf
//   - skip child ของ set (set_ref_line ไม่ว่าง)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/getSaleRefDocItems', async (req, res) => {
  const { doc_no = '' } = req.query;
  if (!doc_no.trim()) {
    return res.status(400).json({ success: false, msg: 'doc_no is required' });
  }

  try {
    // balance qty: เดิม - ที่ถูกอ้างอิงไปแล้ว
    // หน่วยเดียวกับ row (หาร stand/divide กลับ)
    const sql = `
      SELECT
        d.item_code,
        d.item_name,
        COALESCE(d.barcode, '') AS barcode,
        d.doc_no,
        d.unit_code,
        d.vat_type,
        d.tax_type,
        COALESCE(d.price, 0)       AS price,
        COALESCE(d.discount, '')   AS discount,
        d.line_number,
        COALESCE(d.stand_value, 1) AS stand_value,
        COALESCE(d.divide_value, 1) AS divide_value,
        CASE WHEN COALESCE(d.item_code, '') = '' THEN 0
          ELSE (
            (d.qty * (COALESCE(d.stand_value,1)::numeric / NULLIF(COALESCE(d.divide_value,1), 0)))
            - COALESCE((
                SELECT SUM(x.qty * (COALESCE(x.stand_value,1)::numeric / NULLIF(COALESCE(x.divide_value,1), 0)))
                FROM ic_trans_detail x
                WHERE x.ref_doc_no = d.doc_no
                  AND x.item_code  = d.item_code
                  AND x.ref_row    = d.line_number
                  AND COALESCE(x.last_status, 0) = 0
              ), 0)
          ) / (COALESCE(d.stand_value,1)::numeric / NULLIF(COALESCE(d.divide_value,1), 0))
        END AS qty,
        COALESCE(d.wh_code, '')    AS wh_code,
        COALESCE(d.shelf_code, '') AS shelf_code,
        COALESCE((SELECT start_sale_wh    FROM ic_inventory_detail WHERE ic_code = d.item_code LIMIT 1), '') AS default_wh_code,
        COALESCE((SELECT start_sale_shelf FROM ic_inventory_detail WHERE ic_code = d.item_code LIMIT 1), '') AS default_shelf_code,
        COALESCE(d.remark, '')   AS remark,
        d.due_date,
        COALESCE(d.item_type, '0')   AS item_type,
        COALESCE(d.set_ref_line, '') AS set_ref_line
      FROM ic_trans_detail d
      JOIN ic_trans t ON t.doc_no = d.doc_no
        AND t.trans_flag = d.trans_flag
        AND COALESCE(t.last_status, 0) = 0
      WHERE d.doc_no = $1
        AND COALESCE(d.last_status, 0) = 0
        AND (
          COALESCE(d.item_code, '') = ''
          OR (
            (d.qty * (COALESCE(d.stand_value,1)::numeric / NULLIF(COALESCE(d.divide_value,1), 0)))
            - COALESCE((
                SELECT SUM(x.qty * (COALESCE(x.stand_value,1)::numeric / NULLIF(COALESCE(x.divide_value,1), 0)))
                FROM ic_trans_detail x
                WHERE x.ref_doc_no = d.doc_no
                  AND x.item_code  = d.item_code
                  AND x.ref_row    = d.line_number
                  AND COALESCE(x.last_status, 0) = 0
              ), 0)
          ) <> 0
        )
      ORDER BY d.doc_no, d.line_number
    `;
    const result = await query(sql, [doc_no.trim()]);

    // Post-process: drop set children + fill default wh/shelf when empty
    const items = result.rows
      .filter((r) => !r.set_ref_line || String(r.set_ref_line).trim() === '')
      .map((r) => {
        const wh = (r.wh_code || '').trim() || (r.default_wh_code || '').trim();
        const shelf = (r.shelf_code || '').trim() || (r.default_shelf_code || '').trim();
        return {
          item_code: r.item_code,
          item_name: r.item_name,
          barcode: r.barcode,
          unit_code: r.unit_code,
          qty: Number(r.qty) || 0,
          price: Number(r.price) || 0,
          discount: r.discount || '',
          vat_type: r.vat_type,
          tax_type: r.tax_type,
          stand_value: Number(r.stand_value) || 1,
          divide_value: Number(r.divide_value) || 1,
          wh_code: wh,
          shelf_code: shelf,
          remark: r.remark || '',
          due_date: r.due_date,
          item_type: r.item_type,
          // ref linkage
          ref_doc_no: r.doc_no,
          ref_row: Number(r.line_number) || 0,
        };
      });

    return res.json({ success: true, data: items });
  } catch (ex) {
    console.error('getSaleRefDocItems error:', ex.message);
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /service/v1/getSaleItemHistory?cust_code&item_code
// ประวัติการขายของลูกค้า+สินค้า จากหน้าขายสินค้า (เทียบ Ctrl+1 ใน SMLERP)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/getSaleItemHistory', async (req, res) => {
  const { cust_code = '', item_code = '', limit = '200' } = req.query;
  const custCode = String(cust_code || '').trim();
  const itemCode = String(item_code || '').trim();
  const rowLimit = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 500);

  if (!custCode) return res.status(400).json({ success: false, msg: 'cust_code is required' });
  if (!itemCode) return res.status(400).json({ success: false, msg: 'item_code is required' });

  try {
    const result = await query(
      `SELECT
         d.doc_date,
         d.doc_time,
         d.doc_no,
         COALESCE(d.vat_type, 0) AS vat_type,
         COALESCE(t.cust_code, d.cust_code, '') AS cust_code,
         COALESCE(ar.name_1, '') AS cust_name,
         d.item_code,
         COALESCE(i.name_1, d.item_name, '') AS item_name,
         COALESCE(d.unit_code, '') AS unit_code,
         COALESCE(u.name_1, d.unit_code, '') AS unit_name,
         COALESCE(d.wh_code, '') AS wh_code,
         COALESCE(d.shelf_code, '') AS shelf_code,
         COALESCE(d.qty, 0) AS qty,
         COALESCE(d.price_exclude_vat, d.price, 0) AS price_exclude_vat,
         CASE
           WHEN COALESCE(d.vat_type, 0) IN (0, 1) AND COALESCE(d.qty, 0) <> 0
             THEN COALESCE(d.total_vat_value, 0) / d.qty
           ELSE 0
         END AS vat_per_unit,
         CASE
           WHEN COALESCE(d.vat_type, 0) = 0 AND COALESCE(d.qty, 0) <> 0
             THEN COALESCE(d.price_exclude_vat, d.price, 0) + (COALESCE(d.total_vat_value, 0) / d.qty)
           ELSE COALESCE(d.price, 0)
         END AS price,
         COALESCE(d.discount, '') AS discount,
         COALESCE(d.sum_amount_exclude_vat, 0) AS sum_amount_exclude_vat,
         CASE WHEN COALESCE(d.vat_type, 0) IN (0, 1) THEN COALESCE(d.total_vat_value, 0) ELSE 0 END AS total_vat_value,
         CASE
           WHEN COALESCE(d.vat_type, 0) = 0
             THEN COALESCE(d.sum_amount_exclude_vat, 0) + COALESCE(d.total_vat_value, 0)
           ELSE COALESCE(d.sum_amount, 0)
         END AS sum_amount
       FROM ic_trans_detail d
       LEFT JOIN ic_trans t ON t.doc_no = d.doc_no AND t.trans_flag = d.trans_flag
       LEFT JOIN ar_customer ar ON ar.code = COALESCE(t.cust_code, d.cust_code)
       LEFT JOIN ic_inventory i ON i.code = d.item_code
       LEFT JOIN ic_unit u ON u.code = d.unit_code
       WHERE d.trans_flag = 44
         AND COALESCE(d.last_status, t.last_status, 0) = 0
         AND COALESCE(t.last_status, 0) = 0
         AND COALESCE(t.cust_code, d.cust_code, '') = $1
         AND d.item_code = $2
         AND COALESCE(d.qty, 0) > 0
       ORDER BY d.doc_date DESC, d.doc_time DESC, d.doc_no DESC
       LIMIT $3`,
      [custCode, itemCode, rowLimit]
    );
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    console.error('getSaleItemHistory error:', ex.message);
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /service/v1/getSalePriceFormulaInfo?cust_code&item_code
// ตารางราคาขาย/สูตรราคา จากหน้าขายสินค้า (เทียบ Ctrl+3 ใน SMLERP)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/getSalePriceFormulaInfo', async (req, res) => {
  const { cust_code = '', item_code = '', currency_code = '' } = req.query;
  const custCode = String(cust_code || '').trim();
  const itemCode = String(item_code || '').trim();
  const currencyCode = String(currency_code || '').trim().toUpperCase();

  if (!itemCode) return res.status(400).json({ success: false, msg: 'item_code is required' });

  try {
    let priceLevel = 0;
    if (custCode) {
      const custRes = await query('SELECT COALESCE(price_level,0) AS price_level FROM ar_customer WHERE code=$1 LIMIT 1', [custCode]);
      priceLevel = parseInt(custRes.rows[0]?.price_level, 10) || 0;
    }

    const params = [itemCode];
    let currencyWhere = "COALESCE(currency_code,'') = ''";
    if (currencyCode) {
      params.push(currencyCode);
      currencyWhere = `(COALESCE(currency_code,'') = '' OR UPPER(TRIM(COALESCE(currency_code,''))) = $${params.length})`;
    }

    const result = await query(
      `SELECT
         ic_code,
         unit_code,
         COALESCE(sale_type,0) AS sale_type,
         COALESCE(tax_type,0) AS tax_type,
         COALESCE(price_currency,0) AS price_currency,
         COALESCE(currency_code,'') AS currency_code,
         COALESCE(price_0,'') AS price_0,
         COALESCE(price_1,'') AS price_1,
         COALESCE(price_2,'') AS price_2,
         COALESCE(price_3,'') AS price_3,
         COALESCE(price_4,'') AS price_4,
         COALESCE(price_5,'') AS price_5,
         COALESCE(price_6,'') AS price_6,
         COALESCE(price_7,'') AS price_7,
         COALESCE(price_8,'') AS price_8,
         COALESCE(price_9,'') AS price_9
       FROM ic_inventory_price_formula
       WHERE ic_code = $1
         AND ${currencyWhere}
       ORDER BY unit_code, COALESCE(price_currency,0), currency_code, sale_type, tax_type`,
      params
    );

    const priceFields = Array.from({ length: 10 }, (_, index) => `price_${index}`);
    const rows = result.rows.map((row) => {
      const basePrice = row.price_0 || '';
      const calculated = {};
      for (const field of priceFields) {
        calculated[field] = field === 'price_0'
          ? basePrice
          : calcFormulaPrice('1', basePrice, row[field] || basePrice);
      }
      const levelField = priceLevel >= 0 && priceLevel <= 9 ? `price_${priceLevel}` : 'price_0';
      return {
        ...row,
        price_level: priceLevel,
        calculated,
        selected_price_field: levelField,
        selected_price: calculated[levelField] || '',
      };
    });

    return res.json({
      success: true,
      data: {
        cust_code: custCode,
        item_code: itemCode,
        price_level: priceLevel,
        rows,
      },
    });
  } catch (ex) {
    console.error('getSalePriceFormulaInfo error:', ex.message);
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /service/v1/getReceiptPdf?doc_no
// stub: ส่ง HTML กลับ ให้เบราเซอร์เปิดแล้วผู้ใช้ Ctrl+P พิมพ์เอง
// (ยังไม่ทำ PDF generation จริง — ต้อง add pdfkit หรือ puppeteer ภายหลัง)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/getReceiptPdf', async (req, res) => {
  const { doc_no = '' } = req.query;
  if (!doc_no) return res.status(400).send('doc_no is required');

  try {
    const headerRes = await query(
      `SELECT t.doc_no, t.doc_date, t.doc_time, t.cust_code,
              COALESCE(ar.name_1,'') AS cust_name,
              t.sale_code,
              t.total_amount, t.total_before_vat, t.total_vat_value, t.total_after_vat, t.total_discount,
              t.remark, t.vat_rate
       FROM ic_trans t
       LEFT JOIN ar_customer ar ON ar.code = t.cust_code
       WHERE t.trans_flag = 44 AND t.doc_no = $1 LIMIT 1`,
      [doc_no]
    );
    if (headerRes.rows.length === 0) {
      return res.status(404).send('Doc not found');
    }
    const h = headerRes.rows[0];

    const itemsRes = await query(
      `SELECT line_number, item_code, item_name, unit_code, qty, price, sum_amount,
              COALESCE(discount_amount,0) AS discount_amount
       FROM ic_trans_detail
       WHERE trans_flag = 44 AND doc_no = $1
       ORDER BY line_number`,
      [doc_no]
    );

    // simple HTML receipt — frontend เปิดในแท็บใหม่ → ผู้ใช้กด Ctrl+P
    const fmt = (n) =>
      Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const docDateStr = h.doc_date ? new Date(h.doc_date).toLocaleDateString('en-GB') : '';

    const itemsRows = itemsRes.rows
      .map(
        (it, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>
            <b>${escapeHtml(it.item_name || '')}</b><br>
            <small>${escapeHtml(it.item_code || '')}</small>
          </td>
          <td class="r">${fmt(it.qty)}</td>
          <td class="c">${escapeHtml(it.unit_code || '')}</td>
          <td class="r">${fmt(it.price)}</td>
          <td class="r">${fmt(it.discount_amount)}</td>
          <td class="r b">${fmt(it.sum_amount)}</td>
        </tr>`
      )
      .join('');

    const html = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>ใบเสร็จ ${escapeHtml(doc_no)}</title>
<style>
  body { font-family: 'IBM Plex Sans Thai', 'Sarabun', sans-serif; padding: 24px; max-width: 720px; margin: 0 auto; color: #0f172a; }
  h1 { margin: 0 0 4px; font-size: 1.4rem; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #10b981; padding-bottom: 12px; margin-bottom: 16px; }
  .head .right { text-align: right; }
  .info { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; font-size: 0.88rem; margin-bottom: 16px; }
  .info b { color: #475569; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; text-align: left; }
  th { background: #f1f5f9; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; }
  .r { text-align: right; }
  .c { text-align: center; }
  .b { font-weight: 700; }
  .totals { margin-top: 16px; max-width: 320px; margin-left: auto; }
  .totals .row { display: flex; justify-content: space-between; padding: 4px 0; }
  .totals .row.total { font-size: 1.15rem; font-weight: 700; color: #047857; border-top: 2px solid #10b981; padding-top: 8px; margin-top: 4px; }
  .footer { margin-top: 32px; text-align: center; color: #64748b; font-size: 0.78rem; }
  @media print {
    body { padding: 0; }
    .no-print { display: none; }
  }
</style>
</head>
<body>
  <div class="head">
    <div>
      <h1>ใบเสร็จรับเงิน</h1>
      <div style="font-size:.85rem;color:#475569">RECEIPT</div>
    </div>
    <div class="right">
      <div style="font-size:1.05rem;font-weight:700;font-family:ui-monospace,monospace">${escapeHtml(doc_no)}</div>
      <div style="font-size:.82rem;color:#64748b">${docDateStr} ${escapeHtml(h.doc_time || '')}</div>
    </div>
  </div>

  <div class="info">
    <div><b>ลูกค้า:</b> ${escapeHtml(h.cust_name || 'ลูกค้าทั่วไป')}</div>
    <div><b>รหัสลูกค้า:</b> ${escapeHtml(h.cust_code || '—')}</div>
    <div><b>พนักงานขาย:</b> ${escapeHtml(h.sale_code || '—')}</div>
    <div><b>หมายเหตุ:</b> ${escapeHtml(h.remark || '—')}</div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:30px">#</th>
        <th>สินค้า</th>
        <th class="r" style="width:60px">จำนวน</th>
        <th class="c" style="width:50px">หน่วย</th>
        <th class="r" style="width:70px">ราคา</th>
        <th class="r" style="width:60px">ส่วนลด</th>
        <th class="r" style="width:80px">รวม</th>
      </tr>
    </thead>
    <tbody>${itemsRows || '<tr><td colspan="7" style="text-align:center;color:#94a3b8">ไม่มีรายการ</td></tr>'}</tbody>
  </table>

  <div class="totals">
    <div class="row"><span>ยอดก่อนภาษี</span><span>${fmt(h.total_before_vat)}</span></div>
    <div class="row"><span>ส่วนลดท้ายบิล</span><span>−${fmt(h.total_discount)}</span></div>
    <div class="row"><span>ภาษีมูลค่าเพิ่ม ${fmt(h.vat_rate)}%</span><span>${fmt(h.total_vat_value)}</span></div>
    <div class="row total"><span>ยอดสุทธิ</span><span>${fmt(h.total_amount)} ฿</span></div>
  </div>

  <div class="footer no-print">
    <button onclick="window.print()" style="padding:8px 18px;background:#10b981;color:#fff;border:none;border-radius:6px;font-size:.95rem;cursor:pointer">🖨 พิมพ์ใบเสร็จ (Ctrl+P)</button>
  </div>
  <div class="footer">
    BizSuite — ระบบขายหลังบ้าน · พิมพ์เมื่อ ${new Date().toLocaleString('en-GB')}
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  } catch (ex) {
    return res.status(500).send(`Error: ${escapeHtml(ex.message)}`);
  }
});

// helper: HTML escape
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = router;
