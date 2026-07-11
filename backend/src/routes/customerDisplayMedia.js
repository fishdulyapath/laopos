const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { query, withTransaction } = require('../db');

const router = express.Router();
const uploadDir = process.env.CUSTOMER_DISPLAY_UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads', 'customer-display');
const publicPrefix = '/service/uploads/customer-display';
const allowedTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['video/mp4', 'mp4'],
  ['video/webm', 'webm'],
  ['video/ogg', 'ogv'],
]);

let ensureTablePromise = null;

function ensureUploadDir() {
  try {
    fs.mkdirSync(uploadDir, { recursive: true });
  } catch (error) {
    error.message = `cannot create upload directory ${uploadDir}: ${error.message}`;
    throw error;
  }
}

function ensureTable() {
  if (!ensureTablePromise) {
    ensureTablePromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS sml_customer_display_media (
          id BIGSERIAL PRIMARY KEY,
          title TEXT NOT NULL DEFAULT '',
          media_type TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          file_name TEXT NOT NULL,
          original_name TEXT NOT NULL DEFAULT '',
          url_path TEXT NOT NULL,
          file_size BIGINT NOT NULL DEFAULT 0,
          duration_seconds INTEGER NOT NULL DEFAULT 10,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      await query(`
        ALTER TABLE sml_customer_display_media
        ADD COLUMN IF NOT EXISTS sound_enabled BOOLEAN NOT NULL DEFAULT FALSE
      `);
      await query(`
        ALTER TABLE sml_customer_display_media
        ADD COLUMN IF NOT EXISTS display_zone TEXT NOT NULL DEFAULT 'right'
      `);
    })();
  }
  return ensureTablePromise;
}

function normalizeDisplayZone(value) {
  const zone = String(value || 'right').trim().toLowerCase();
  if (zone === 'summary' || zone === 'summary_secondary') return zone;
  return 'right';
}

function absoluteUrl(req, urlPath) {
  if (!urlPath) return '';
  if (/^https?:\/\//i.test(urlPath)) return urlPath;
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host');
  return host ? `${proto}://${host}${urlPath}` : urlPath;
}

function mediaRow(req, row) {
  return {
    ...row,
    id: Number(row.id),
    file_size: Number(row.file_size || 0),
    duration_seconds: Number(row.duration_seconds || 10),
    sort_order: Number(row.sort_order || 0),
    enabled: row.enabled === true,
    sound_enabled: row.sound_enabled === true,
    display_zone: normalizeDisplayZone(row.display_zone),
    url: absoluteUrl(req, row.url_path),
  };
}

function parseUploadBody(body = {}) {
  const rawData = String(body.data_url || body.base64 || '').trim();
  const dataUrlMatch = rawData.match(/^data:([^;]+);base64,(.+)$/);
  const mimeType = String(body.mime_type || dataUrlMatch?.[1] || '').trim().toLowerCase();
  const base64 = dataUrlMatch ? dataUrlMatch[2] : rawData;
  if (!allowedTypes.has(mimeType)) {
    const allowed = Array.from(allowedTypes.keys()).join(', ');
    const error = new Error(`unsupported media type. allowed: ${allowed}`);
    error.status = 400;
    throw error;
  }
  if (!base64) {
    const error = new Error('file data is required');
    error.status = 400;
    throw error;
  }
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) {
    const error = new Error('invalid file data');
    error.status = 400;
    throw error;
  }
  return { mimeType, buffer };
}

function cleanFileStem(value = '') {
  const parsed = path.parse(String(value || 'media').trim()).name || 'media';
  return parsed
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'media';
}

async function nextSortOrder(displayZone = 'right') {
  const result = await query(
    'SELECT COALESCE(MAX(sort_order), 0) + 10 AS next_order FROM sml_customer_display_media WHERE display_zone = $1',
    [normalizeDisplayZone(displayZone)],
  );
  return Number(result.rows[0]?.next_order || 10);
}

router.get('/customer-display-media', async (req, res) => {
  try {
    await ensureTable();
    const enabledOnly = ['1', 'true', 'yes'].includes(String(req.query.enabled || '').toLowerCase());
    const rawZone = String(req.query.zone || req.query.display_zone || '').trim().toLowerCase();
    const conditions = [];
    const params = [];
    if (enabledOnly) conditions.push('enabled = TRUE');
    if (rawZone) {
      params.push(normalizeDisplayZone(rawZone));
      conditions.push(`display_zone = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await query(
      `SELECT *
       FROM sml_customer_display_media
       ${where}
       ORDER BY sort_order ASC, id ASC`,
      params,
    );
    return res.json({ success: true, data: result.rows.map((row) => mediaRow(req, row)) });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

router.post('/customer-display-media/upload', async (req, res) => {
  try {
    await ensureTable();
    ensureUploadDir();
    const { mimeType, buffer } = parseUploadBody(req.body);
    const mediaType = mimeType.startsWith('video/') ? 'video' : 'image';
    const originalName = String(req.body.file_name || req.body.original_name || 'media').trim() || 'media';
    const ext = allowedTypes.get(mimeType);
    const stem = cleanFileStem(originalName);
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${stem}.${ext}`;
    const filePath = path.join(uploadDir, fileName);
    try {
      fs.writeFileSync(filePath, buffer);
    } catch (error) {
      error.message = `cannot save upload file ${filePath}: ${error.message}`;
      throw error;
    }
    const urlPath = `${publicPrefix}/${fileName}`;
    const duration = Math.max(1, Number.parseInt(req.body.duration_seconds || req.body.duration || '10', 10) || 10);
    const soundEnabled = req.body.sound_enabled === true || String(req.body.sound_enabled || '').toLowerCase() === 'true';
    const displayZone = normalizeDisplayZone(req.body.display_zone || req.body.zone);
    const sortOrder = await nextSortOrder(displayZone);
    const title = String(req.body.title || path.parse(originalName).name || '').trim();
    const createdBy = String(req.body.created_by || '').trim();
    const result = await query(
      `INSERT INTO sml_customer_display_media
       (title, media_type, mime_type, file_name, original_name, url_path, file_size, duration_seconds, enabled, sound_enabled, display_zone, sort_order, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [title, mediaType, mimeType, fileName, originalName, urlPath, buffer.length, duration, true, soundEnabled, displayZone, sortOrder, createdBy],
    );
    return res.json({ success: true, data: mediaRow(req, result.rows[0]) });
  } catch (ex) {
    return res.status(ex.status || 500).json({ success: false, msg: ex.message });
  }
});

router.put('/customer-display-media/:id', async (req, res) => {
  try {
    await ensureTable();
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ success: false, msg: 'invalid id' });
    const title = String(req.body.title || '').trim();
    const duration = Math.max(1, Number.parseInt(req.body.duration_seconds || req.body.duration || '10', 10) || 10);
    const enabled = req.body.enabled !== false && String(req.body.enabled || 'true').toLowerCase() !== 'false';
    const soundEnabled = req.body.sound_enabled === true || String(req.body.sound_enabled || '').toLowerCase() === 'true';
    const hasDisplayZone = req.body.display_zone !== undefined || req.body.zone !== undefined;
    const displayZone = hasDisplayZone ? normalizeDisplayZone(req.body.display_zone || req.body.zone) : null;
    const result = await query(
      `UPDATE sml_customer_display_media
       SET title = $2, duration_seconds = $3, enabled = $4, sound_enabled = $5, display_zone = COALESCE($6, display_zone), updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, title, duration, enabled, soundEnabled, displayZone],
    );
    if (!result.rows.length) return res.status(404).json({ success: false, msg: 'media not found' });
    return res.json({ success: true, data: mediaRow(req, result.rows[0]) });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

router.post('/customer-display-media/reorder', async (req, res) => {
  try {
    await ensureTable();
    const orders = Array.isArray(req.body.orders) ? req.body.orders : [];
    await withTransaction(async (client) => {
      for (const item of orders) {
        const id = Number(item.id);
        const sortOrder = Number(item.sort_order);
        if (Number.isFinite(id) && Number.isFinite(sortOrder)) {
          await client.query(
            'UPDATE sml_customer_display_media SET sort_order = $2, updated_at = NOW() WHERE id = $1',
            [id, sortOrder],
          );
        }
      }
    });
    const result = await query('SELECT * FROM sml_customer_display_media ORDER BY sort_order ASC, id ASC');
    return res.json({ success: true, data: result.rows.map((row) => mediaRow(req, row)) });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

router.delete('/customer-display-media/:id', async (req, res) => {
  try {
    await ensureTable();
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ success: false, msg: 'invalid id' });
    const result = await query('DELETE FROM sml_customer_display_media WHERE id = $1 RETURNING *', [id]);
    if (!result.rows.length) return res.status(404).json({ success: false, msg: 'media not found' });
    const fileName = path.basename(result.rows[0].file_name || '');
    if (fileName) {
      try {
        fs.unlinkSync(path.join(uploadDir, fileName));
      } catch {}
    }
    return res.json({ success: true });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

module.exports = router;
