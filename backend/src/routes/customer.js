const express = require('express');
const router = express.Router();
const { query } = require('../db');

// GET /service/v1/getCustomerList
router.get('/getCustomerList', async (req, res) => {
  const { search = '' } = req.query;
  try {
    const params = [];
    let dealerWhere = '';
    let customerOnlyWhere = '';
    if (search) {
      params.push(`%${search}%`);
      dealerWhere = `
        AND (
          c.code ILIKE $1
          OR c.name_1 ILIKE $1
          OR COALESCE(c.telephone, '') ILIKE $1
          OR d.code ILIKE $1
          OR COALESCE(d.mobile_phone, '') ILIKE $1
        )`;
      customerOnlyWhere = `
        AND (
          c.code ILIKE $1
          OR c.name_1 ILIKE $1
          OR COALESCE(c.telephone, '') ILIKE $1
        )`;
    }

    const sql = `
      WITH dealer_rows AS (
        SELECT
          c.code AS customer_code,
          c.name_1 AS customer_name,
          COALESCE(c.address, '') AS address,
          COALESCE(c.telephone, '') AS customer_telephone,
          COALESCE((SELECT tax_id FROM ar_customer_detail WHERE ar_code = c.code), '') AS tax_id,
          d.code AS member_code,
          COALESCE(d.mobile_phone, '') AS mobile_phone
        FROM ar_dealer d
        INNER JOIN ar_customer c ON c.code = d.ar_code
        WHERE 1=1 ${dealerWhere}
      ),
      customer_only_rows AS (
        SELECT
          c.code AS customer_code,
          c.name_1 AS customer_name,
          COALESCE(c.address, '') AS address,
          COALESCE(c.telephone, '') AS customer_telephone,
          COALESCE((SELECT tax_id FROM ar_customer_detail WHERE ar_code = c.code), '') AS tax_id,
          ''::text AS member_code,
          ''::text AS mobile_phone
        FROM ar_customer c
        WHERE NOT EXISTS (SELECT 1 FROM ar_dealer d WHERE d.ar_code = c.code)
          ${customerOnlyWhere}
      )
      SELECT *
      FROM (
        SELECT * FROM dealer_rows
        UNION ALL
        SELECT * FROM customer_only_rows
      ) q
      ORDER BY customer_code, member_code
      LIMIT 50`;

    const result = await query(sql, params);
    const data = result.rows.map(r => ({
      // Backward-compatible fields for existing callers.
      code: r.customer_code,
      name: r.customer_name,
      address: r.address,
      telephone: r.customer_telephone,
      tax_id: r.tax_id,

      // Additive member/dealer fields.
      customer_code: r.customer_code,
      customer_name: r.customer_name,
      customer_telephone: r.customer_telephone,
      member_code: r.member_code || '',
      dealer_code: r.member_code || '',
      mobile_phone: r.mobile_phone || '',
      dealer_mobile_phone: r.mobile_phone || '',
      row_key: `${r.customer_code || ''}|${r.member_code || ''}|${r.mobile_phone || ''}`,
    }));
    return res.json({ success: true, data });
  } catch (ex) {
    return res.status(400).json({ ERROR: ex.message });
  }
});

// GET /service/v1/getEmployeeList
router.get('/getEmployeeList', async (req, res) => {
  const { search = '' } = req.query;
  try {
    const params = [];
    let where = '';
    if (search) {
      params.push(`%${search}%`);
      where = ` AND (code ILIKE $1 OR name_1 ILIKE $1 OR name_2 ILIKE $1)`;
    }
    const sql = `SELECT code, COALESCE(name_1, '') AS name_1, COALESCE(name_2, '') AS name_2 FROM erp_user WHERE 1=1 ${where} LIMIT 50`;
    const result = await query(sql, params);
    const data = result.rows.map(r => ({
      code: r.code,
      name_1: r.name_1,
      name_2: r.name_2,
      name: [r.name_1, r.name_2].filter(Boolean).join(' | '),
    }));
    return res.json({ success: true, data });
  } catch (ex) {
    return res.status(400).json({ ERROR: ex.message });
  }
});

// GET /service/v1/getCustomerCRM
router.get('/getCustomerCRM', async (req, res) => {
  const { search = '', limit = '50', offset = '0' } = req.query;
  const lim = parseInt(limit) || 50;
  const off = parseInt(offset) || 0;
  try {
    const params = [];
    let where = '';
    if (search) {
      params.push(`%${search}%`);
      where = ` AND (code ILIKE $1 OR name_1 ILIKE $1)`;
    }

    const countSql = `SELECT COUNT(*) AS total FROM ar_customer WHERE 1=1 ${where}`;
    const countResult = await query(countSql, params);
    const total = parseInt(countResult.rows[0].total);

    const paramIdx = params.length + 1;
    const dataSql = `
      SELECT code AS user_code, name_1 AS user_name,
        COALESCE(address,'') AS address, COALESCE(telephone,'') AS telephone,
        COALESCE(website,'') AS website,
        COALESCE((SELECT logistic_area FROM ar_customer_detail WHERE ar_code=code),'') AS logistic_area,
        COALESCE((SELECT group_main FROM ar_customer_detail WHERE ar_code=code),'') AS group_main
      FROM ar_customer WHERE 1=1 ${where}
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `;
    const dataResult = await query(dataSql, [...params, lim, off]);
    const data = dataResult.rows.map(r => ({
      code: r.user_code,
      name: r.user_name,
      address: r.address,
      telephone: r.telephone,
      logistic_area: r.logistic_area,
      gps: r.website,
      group_main: r.group_main,
    }));

    const currentPage = Math.floor(off / lim) + 1;
    const totalPage = Math.ceil(total / lim);

    return res.json({
      success: true,
      data,
      pagination: { total, limit: lim, offset: off, current_page: currentPage, total_page: totalPage },
    });
  } catch (ex) {
    return res.status(400).json({ ERROR: ex.message });
  }
});

// GET /service/v1/getEmployeeCRM
router.get('/getEmployeeCRM', async (req, res) => {
  const { search = '', limit = '50', offset = '0' } = req.query;
  const lim = parseInt(limit) || 50;
  const off = parseInt(offset) || 0;
  try {
    const params = [];
    let where = '';
    if (search) {
      params.push(`%${search}%`);
      where = ` AND (code ILIKE $1 OR name_1 ILIKE $1 OR name_2 ILIKE $1)`;
    }
    const paramIdx = params.length + 1;
    const sql = `SELECT code, COALESCE(name_1, '') AS name_1, COALESCE(name_2, '') AS name_2 FROM erp_user WHERE 1=1 ${where}
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
    const result = await query(sql, [...params, lim, off]);
    const data = result.rows.map(r => ({
      code: r.code,
      name_1: r.name_1,
      name_2: r.name_2,
      name: [r.name_1, r.name_2].filter(Boolean).join(' | '),
    }));
    return res.json({ success: true, data });
  } catch (ex) {
    return res.status(400).json({ ERROR: ex.message });
  }
});

module.exports = router;
