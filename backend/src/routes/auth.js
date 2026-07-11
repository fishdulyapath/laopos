const express = require('express');
const router = express.Router();
const { query, withTransaction } = require('../db');
const { PERMISSIONS, ALL_PERMISSION_KEYS, getEmployeePermissions } = require('../utils/permissions');

// POST /service/v1/loginemp
// Additive endpoint for clients that must not send employee passwords in query strings.
router.post('/loginemp', async (req, res) => {
  const { user_code, password } = req.body || {};

  const resp = { success: false };
  try {
    const sql = `
      SELECT code AS user_code, COALESCE(name_1, '') AS user_name, COALESCE(name_2, '') AS user_name_2
      FROM erp_user
      WHERE UPPER(code) = UPPER($1) AND password = $2
      ORDER BY code
    `;
    const result = await query(sql, [user_code || '', password || '']);

    const data = [];
    for (const r of result.rows) {
      data.push({
        user_code: r.user_code,
        user_name: r.user_name,
        user_name_2: r.user_name_2,
        permissions: await getEmployeePermissions(query, r.user_code),
      });
    }

    resp.success = true;
    resp.data = data;
    return res.json(resp);
  } catch (ex) {
    return res.status(400).json({ ERROR: ex.message });
  }
});

// GET /service/v1/loginemp
// Java: query erp_user WHERE upper(code)=upper(user_code) AND password=password
router.get('/loginemp', async (req, res) => {
  const { user_code, password } = req.query;

  const resp = { success: false };
  try {
    const sql = `
      SELECT code AS user_code, COALESCE(name_1, '') AS user_name, COALESCE(name_2, '') AS user_name_2
      FROM erp_user
      WHERE UPPER(code) = UPPER($1) AND password = $2
      ORDER BY code
    `;
    const result = await query(sql, [user_code || '', password || '']);

    const data = [];
    for (const r of result.rows) {
      data.push({
        user_code: r.user_code,
        user_name: r.user_name,
        user_name_2: r.user_name_2,
        permissions: await getEmployeePermissions(query, r.user_code),
      });
    }

    resp.success = true;
    resp.data = data;
    return res.json(resp);
  } catch (ex) {
    return res.status(400).json({ ERROR: ex.message });
  }
});

router.post('/verifyPriceEditPermission', async (req, res) => {
  const { user_code, password } = req.body || {};
  const resp = { success: false };
  try {
    const result = await query(
      `SELECT code AS user_code, name_1 AS user_name, COALESCE(price_level_1, 0) AS price_level_1
       FROM erp_user
       WHERE UPPER(code) = UPPER($1) AND password = $2
       ORDER BY code
       LIMIT 1`,
      [user_code || '', password || ''],
    );
    if (!result.rows.length) {
      return res.status(401).json({ success: false, msg: 'invalid user or password' });
    }
    const row = result.rows[0];
    const allowed = Number(row.price_level_1) === 1;
    return res.json({
      success: true,
      data: {
        allowed,
        user_code: row.user_code,
        user_name: row.user_name,
        price_level_1: Number(row.price_level_1) || 0,
      },
    });
  } catch (ex) {
    return res.status(400).json({ success: false, msg: ex.message });
  }
});

router.post('/verifyCashDrawerPermission', async (req, res) => {
  const { user_code, password } = req.body || {};
  try {
    const result = await query(
      `SELECT code AS user_code, name_1 AS user_name, COALESCE(open_cash_drawer::text, '0') AS open_cash_drawer
       FROM erp_user
       WHERE UPPER(code) = UPPER($1) AND password = $2
       ORDER BY code
       LIMIT 1`,
      [user_code || '', password || ''],
    );
    if (!result.rows.length) {
      return res.status(401).json({ success: false, msg: 'invalid user or password' });
    }
    const row = result.rows[0];
    const permissionValue = String(row.open_cash_drawer || '').trim().toLowerCase();
    const allowed = ['1', 'true', 't', 'yes', 'y'].includes(permissionValue);
    return res.json({
      success: true,
      data: {
        allowed,
        user_code: row.user_code,
        user_name: row.user_name,
        open_cash_drawer: row.open_cash_drawer,
      },
    });
  } catch (ex) {
    return res.status(400).json({ success: false, msg: ex.message });
  }
});

// GET /service/v1/logincus
// Java: query ar_customer WHERE upper(code)=upper(user_code) AND country=password
// country field ใช้เก็บ password ของ customer
router.get('/logincus', async (req, res) => {
  const { user_code, password } = req.query;

  const resp = { success: false };
  try {
    const sql = `
      SELECT
        code AS user_code,
        name_1 AS user_name,
        address,
        telephone,
        COALESCE(
          (SELECT tax_id FROM ar_customer_detail WHERE ar_code = code),
          ''
        ) AS tax_id
      FROM ar_customer
      WHERE UPPER(code) = UPPER($1) AND country = $2
      ORDER BY code
    `;
    const result = await query(sql, [user_code || '', password || '']);

    const data = result.rows.map(r => ({
      user_code: r.user_code,
      user_name: r.user_name,
      address: r.address,
      telephone: r.telephone,
      tax_id: r.tax_id,
    }));

    resp.success = true;
    resp.data = data;
    return res.json(resp);
  } catch (ex) {
    return res.status(400).json({ ERROR: ex.message });
  }
});

router.get('/getPermissionList', async (req, res) => {
  return res.json({ success: true, data: PERMISSIONS });
});

router.get('/getEmployeePermissions', async (req, res) => {
  const { user_code = '' } = req.query;
  if (!user_code.trim()) return res.status(400).json({ success: false, msg: 'user_code is required' });
  try {
    const permissions = await getEmployeePermissions(query, user_code.trim());
    return res.json({ success: true, data: permissions });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

router.post('/setEmployeePermissions', async (req, res) => {
  const { user_code = '', permissions = [] } = req.body || {};
  const userCode = String(user_code).trim();
  if (!userCode) return res.status(400).json({ success: false, msg: 'user_code is required' });
  if (!Array.isArray(permissions)) return res.status(400).json({ success: false, msg: 'permissions must be an array' });

  const allowed = new Set(permissions.filter((key) => ALL_PERMISSION_KEYS.includes(key)));
  try {
    await withTransaction(async (client) => {
      await client.query('DELETE FROM sml_staff_permission WHERE UPPER(user_code) = UPPER($1)', [userCode]);
      for (const key of ALL_PERMISSION_KEYS) {
        await client.query(
          `INSERT INTO sml_staff_permission (user_code, permission_key, is_allowed, updated_at)
           VALUES ($1, $2, $3, NOW())`,
          [userCode, key, allowed.has(key)],
        );
      }
    });
    return res.json({ success: true });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

module.exports = router;
