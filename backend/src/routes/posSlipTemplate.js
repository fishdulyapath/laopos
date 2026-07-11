const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { query } = require('../db');

const router = express.Router();
const uploadDir = process.env.POS_SLIP_UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads', 'print-slip');
const publicPrefix = '/service/uploads/print-slip';
const allowedTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);

const DEFAULT_SECTIONS = [
  'logo',
  'company',
  'doc',
  'customer',
  'items',
  'promotions',
  'totals',
  'remark',
  'campaigns',
  'footer',
  'sale',
  'ads',
];

const DEFAULT_FIELD_LAYOUT = {
  company: [
    { key: 'shop_name', enabled: true },
    { key: 'shop_address', enabled: true },
    { key: 'shop_tel', enabled: true },
    { key: 'shop_tax', enabled: true },
  ],
  doc: [
    { key: 'doc_no', enabled: true },
    { key: 'doc_date', enabled: true },
    { key: 'print_count', enabled: true },
  ],
  customer: [
    { key: 'customer_code_name', enabled: true },
    { key: 'customer_tel', enabled: true },
    { key: 'customer_address', enabled: true },
  ],
  item_title: [
    { key: 'row_no', enabled: true },
    { key: 'item_code', enabled: true },
    { key: 'item_name', enabled: true },
  ],
  item_detail: [
    { key: 'qty_unit', enabled: true },
    { key: 'unit_price', enabled: true },
    { key: 'amount', enabled: true },
  ],
  footer: [
    { key: 'footer_text', enabled: true },
    { key: 'print_by', enabled: true },
  ],
};

const ALIGN_VALUES = new Set(['left', 'center', 'right']);
const DISPLAY_VALUES = new Set(['inline', 'block']);
const WHITE_SPACE_VALUES = new Set(['normal', 'nowrap', 'pre-wrap']);
const POSITION_MODE_VALUES = new Set(['flow', 'absolute']);

const DEFAULT_SECTION_STYLES = Object.fromEntries(DEFAULT_SECTIONS.map((key) => [key, {
  position_mode: 'flow',
  align: key === 'company' || key === 'title' || key === 'logo' || key === 'footer' ? 'center' : 'left',
  x_offset_pt: 0,
  width_pct: 100,
  abs_x_pt: 0,
  abs_y_pt: 0,
  height_pt: 0,
  z_index: 1,
  margin_top_pt: key === 'logo' ? 0 : 4,
  margin_bottom_pt: key === 'footer' ? 0 : 4,
  padding_left_pt: 0,
  padding_right_pt: 0,
  font_scale: 1,
  line_height: 1.28,
  border_top: false,
  border_bottom: false,
}]));

const DEFAULT_FIELD_STYLES = Object.fromEntries(Object.entries(DEFAULT_FIELD_LAYOUT).map(([groupKey, fields]) => [
  groupKey,
  Object.fromEntries(fields.map((field) => [field.key, {
    position_mode: 'flow',
    display: groupKey === 'item_title' || groupKey === 'item_detail' ? 'inline' : 'block',
    align: field.key === 'amount' || field.key === 'unit_price' ? 'right' : 'left',
    width_pct: field.key === 'item_name' ? 55 : (field.key === 'amount' ? 25 : 20),
    abs_x_pt: 0,
    abs_y_pt: 0,
    height_pt: 0,
    z_index: 1,
    margin_left_pt: 0,
    margin_right_pt: 0,
    margin_top_pt: 0,
    margin_bottom_pt: 0,
    padding_left_pt: 0,
    padding_right_pt: 0,
    padding_top_pt: 0,
    padding_bottom_pt: 0,
    font_scale: field.key === 'item_name' || field.key === 'shop_name' ? 1.08 : 1,
    line_height: 1.18,
    letter_spacing_pt: 0,
    white_space: 'normal',
    bold: ['shop_name', 'item_name', 'amount', 'footer_text'].includes(field.key),
  }])),
]));

const DEFAULT_LAYOUT = {
  enabled: true,
  title: 'ໃບຮັບເງິນ/ໃບສົ່ງສິນຄ້າ',
  shop_name: 'ສັນຕິພາບ',
  branch_name: 'ໜອງໄຮ',
  footer_text: 'ຂອບໃຈທີ່ໃຊ້ບໍລິການຂອງພວກເຮົາ.',
  font_scale: 1,
  padding_pt: 8,
  show_grid: true,
  snap_enabled: true,
  snap_pt: 2,
  nudge_step_pt: 1,
  logo_url: '',
  logo_max_height_mm: 18,
  ad_max_height_mm: 34,
  sections: DEFAULT_SECTIONS.map((key) => ({ key, enabled: true })),
  fields: {
    show_shop_address: true,
    show_shop_tel: true,
    show_shop_tax: true,
    show_customer_address: true,
    show_customer_tel: true,
    show_item_code: true,
    show_item_remark: true,
    show_unit_price: true,
    show_payments: true,
  },
  field_layout: DEFAULT_FIELD_LAYOUT,
  section_styles: DEFAULT_SECTION_STYLES,
  field_styles: DEFAULT_FIELD_STYLES,
  ads: [],
};

let ensureTablePromise = null;

function ensureUploadDir() {
  fs.mkdirSync(uploadDir, { recursive: true });
}

function ensureTable() {
  if (!ensureTablePromise) {
    ensureTablePromise = query(`
      CREATE TABLE IF NOT EXISTS sml_pos_slip_template (
        form_code TEXT PRIMARY KEY,
        layout_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_by TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
  }
  return ensureTablePromise;
}

function absoluteUrl(req, urlPath) {
  if (!urlPath) return '';
  if (/^https?:\/\//i.test(urlPath)) return urlPath;
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host');
  return host ? `${proto}://${host}${urlPath}` : urlPath;
}

function safeLayout(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const { paper_width_pt: _paperWidthPt, ...sourceWithoutPaperSize } = source;
  const fields = { ...DEFAULT_LAYOUT.fields, ...(source.fields || {}) };
  const known = new Set(DEFAULT_SECTIONS);
  const seen = new Set();
  const sections = (Array.isArray(source.sections) ? source.sections : [])
    .map((section) => (typeof section === 'string' ? { key: section, enabled: true } : section))
    .filter((section) => known.has(section?.key) && !seen.has(section.key) && seen.add(section.key))
    .map((section) => ({ key: section.key, enabled: section.enabled !== false }));
  for (const section of DEFAULT_LAYOUT.sections) {
    if (!seen.has(section.key)) sections.push({ ...section });
  }
  const ads = (Array.isArray(source.ads) ? source.ads : [])
    .map((ad) => (typeof ad === 'string' ? { url: ad, image_url: ad, enabled: true } : ad))
    .filter((ad) => (
      String(ad?.url || ad?.image_url || ad?.src || '').trim()
      || String(ad?.title || '').trim()
      || String(ad?.body || ad?.text || '').trim()
    ))
    .map((ad, index) => ({
      id: ad.id || `ad-${index + 1}`,
      url: String(ad.url || ad.image_url || ad.src || '').trim(),
      image_url: String(ad.image_url || ad.url || ad.src || '').trim(),
      title: String(ad.title || '').trim(),
      body: String(ad.body || ad.text || '').trim(),
      enabled: ad.enabled !== false,
      divider: ad.divider !== false,
      image_position: ['top', 'bottom'].includes(String(ad.image_position || '').toLowerCase())
        ? String(ad.image_position).toLowerCase()
        : 'top',
      image_max_height_mm: Math.max(10, Math.min(120, Number(ad.image_max_height_mm || source.ad_max_height_mm || DEFAULT_LAYOUT.ad_max_height_mm))),
      title_font_size_px: boundedNumber(ad.title_font_size_px, 14, 8, 32),
      title_bold: ad.title_bold === undefined ? true : ad.title_bold === true,
      title_italic: ad.title_italic === true,
      body_font_size_px: boundedNumber(ad.body_font_size_px, 11, 8, 32),
      body_bold: ad.body_bold === true,
      body_italic: ad.body_italic === true,
      sort_order: Number.isFinite(Number(ad.sort_order)) ? Number(ad.sort_order) : (index + 1) * 10,
    }))
    .sort((a, b) => a.sort_order - b.sort_order);
  const fieldLayout = normalizeFieldLayout(source.field_layout, fields);
  const sectionStyles = normalizeSectionStyles(source.section_styles);
  const fieldStyles = normalizeFieldStyles(source.field_styles);

  return {
    ...DEFAULT_LAYOUT,
    ...sourceWithoutPaperSize,
    enabled: source.enabled !== false,
    title: String(source.title || DEFAULT_LAYOUT.title),
    shop_name: String(source.shop_name || DEFAULT_LAYOUT.shop_name),
    branch_name: String(source.branch_name || DEFAULT_LAYOUT.branch_name),
    footer_text: String(source.footer_text || DEFAULT_LAYOUT.footer_text),
    font_scale: Math.max(0.75, Math.min(1.35, Number(source.font_scale || DEFAULT_LAYOUT.font_scale))),
    padding_pt: Math.max(2, Math.min(16, Number(source.padding_pt || DEFAULT_LAYOUT.padding_pt))),
    show_grid: source.show_grid !== false,
    snap_enabled: source.snap_enabled !== false,
    snap_pt: Math.max(0.5, Math.min(12, Number(source.snap_pt || DEFAULT_LAYOUT.snap_pt))),
    nudge_step_pt: Math.max(0.1, Math.min(20, Number(source.nudge_step_pt || DEFAULT_LAYOUT.nudge_step_pt))),
    logo_url: String(source.logo_url || '').trim(),
    logo_max_height_mm: Math.max(8, Math.min(45, Number(source.logo_max_height_mm || DEFAULT_LAYOUT.logo_max_height_mm))),
    ad_max_height_mm: Math.max(10, Math.min(90, Number(source.ad_max_height_mm || DEFAULT_LAYOUT.ad_max_height_mm))),
    fields,
    field_layout: fieldLayout,
    section_styles: sectionStyles,
    field_styles: fieldStyles,
    sections,
    ads,
  };
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizeSectionStyle(value = {}, defaults = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const align = ALIGN_VALUES.has(source.align) ? source.align : defaults.align;
  return {
    position_mode: POSITION_MODE_VALUES.has(source.position_mode) ? source.position_mode : defaults.position_mode,
    align,
    x_offset_pt: boundedNumber(source.x_offset_pt, defaults.x_offset_pt, -80, 80),
    width_pct: boundedNumber(source.width_pct, defaults.width_pct, 20, 120),
    abs_x_pt: boundedNumber(source.abs_x_pt, defaults.abs_x_pt, -80, 320),
    abs_y_pt: boundedNumber(source.abs_y_pt, defaults.abs_y_pt, 0, 2400),
    height_pt: boundedNumber(source.height_pt, defaults.height_pt, 0, 2400),
    z_index: boundedNumber(source.z_index, defaults.z_index, 0, 99),
    margin_top_pt: boundedNumber(source.margin_top_pt, defaults.margin_top_pt, 0, 36),
    margin_bottom_pt: boundedNumber(source.margin_bottom_pt, defaults.margin_bottom_pt, 0, 36),
    padding_left_pt: boundedNumber(source.padding_left_pt, defaults.padding_left_pt, 0, 36),
    padding_right_pt: boundedNumber(source.padding_right_pt, defaults.padding_right_pt, 0, 36),
    font_scale: boundedNumber(source.font_scale, defaults.font_scale, 0.65, 1.8),
    line_height: boundedNumber(source.line_height, defaults.line_height, 0.9, 2.2),
    border_top: source.border_top === true,
    border_bottom: source.border_bottom === true,
  };
}

function normalizeSectionStyles(sourceStyles = {}) {
  const styles = {};
  for (const key of DEFAULT_SECTIONS) {
    styles[key] = normalizeSectionStyle(sourceStyles?.[key], DEFAULT_SECTION_STYLES[key]);
  }
  return styles;
}

function normalizeFieldStyle(value = {}, defaults = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    position_mode: POSITION_MODE_VALUES.has(source.position_mode) ? source.position_mode : defaults.position_mode,
    display: DISPLAY_VALUES.has(source.display) ? source.display : defaults.display,
    align: ALIGN_VALUES.has(source.align) ? source.align : defaults.align,
    width_pct: boundedNumber(source.width_pct, defaults.width_pct, 5, 120),
    abs_x_pt: boundedNumber(source.abs_x_pt, defaults.abs_x_pt, -80, 320),
    abs_y_pt: boundedNumber(source.abs_y_pt, defaults.abs_y_pt, -80, 320),
    height_pt: boundedNumber(source.height_pt, defaults.height_pt, 0, 2400),
    z_index: boundedNumber(source.z_index, defaults.z_index, 0, 99),
    margin_left_pt: boundedNumber(source.margin_left_pt, defaults.margin_left_pt, -40, 80),
    margin_right_pt: boundedNumber(source.margin_right_pt, defaults.margin_right_pt, -40, 80),
    margin_top_pt: boundedNumber(source.margin_top_pt, defaults.margin_top_pt, -20, 60),
    margin_bottom_pt: boundedNumber(source.margin_bottom_pt, defaults.margin_bottom_pt, -20, 60),
    padding_left_pt: boundedNumber(source.padding_left_pt, defaults.padding_left_pt, 0, 36),
    padding_right_pt: boundedNumber(source.padding_right_pt, defaults.padding_right_pt, 0, 36),
    padding_top_pt: boundedNumber(source.padding_top_pt, defaults.padding_top_pt, 0, 36),
    padding_bottom_pt: boundedNumber(source.padding_bottom_pt, defaults.padding_bottom_pt, 0, 36),
    font_scale: boundedNumber(source.font_scale, defaults.font_scale, 0.65, 1.8),
    line_height: boundedNumber(source.line_height, defaults.line_height, 0.9, 2.2),
    letter_spacing_pt: boundedNumber(source.letter_spacing_pt, defaults.letter_spacing_pt, -1, 4),
    white_space: WHITE_SPACE_VALUES.has(source.white_space) ? source.white_space : defaults.white_space,
    bold: source.bold === undefined ? !!defaults.bold : source.bold === true,
  };
}

function normalizeFieldStyles(sourceStyles = {}) {
  const styles = {};
  for (const [groupKey, fields] of Object.entries(DEFAULT_FIELD_LAYOUT)) {
    styles[groupKey] = {};
    for (const field of fields) {
      styles[groupKey][field.key] = normalizeFieldStyle(
        sourceStyles?.[groupKey]?.[field.key],
        DEFAULT_FIELD_STYLES[groupKey][field.key],
      );
    }
  }
  return styles;
}

function normalizeFieldGroup(sourceGroup, defaultGroup, fields = {}, groupKey = '') {
  const sourceItems = Array.isArray(sourceGroup) ? sourceGroup : [];
  const known = new Set(defaultGroup.map((field) => field.key));
  const seen = new Set();
  const items = sourceItems
    .map((field) => (typeof field === 'string' ? { key: field, enabled: true } : field))
    .filter((field) => known.has(field?.key) && !seen.has(field.key) && seen.add(field.key))
    .map((field) => ({ key: field.key, enabled: field.enabled !== false }));

  for (const field of defaultGroup) {
    if (seen.has(field.key)) continue;
    let enabled = field.enabled !== false;
    if (groupKey === 'company' && field.key === 'shop_address') enabled = fields.show_shop_address !== false;
    if (groupKey === 'company' && field.key === 'shop_tel') enabled = fields.show_shop_tel !== false;
    if (groupKey === 'company' && field.key === 'shop_tax') enabled = fields.show_shop_tax !== false;
    if (groupKey === 'customer' && field.key === 'customer_address') enabled = fields.show_customer_address !== false;
    if (groupKey === 'customer' && field.key === 'customer_tel') enabled = fields.show_customer_tel !== false;
    if (groupKey === 'item_title' && field.key === 'item_code') enabled = fields.show_item_code !== false;
    if (groupKey === 'item_detail' && field.key === 'unit_price') enabled = fields.show_unit_price !== false;
    if (groupKey === 'footer' && field.key === 'print_by') enabled = true;
    items.push({ key: field.key, enabled });
  }
  return items;
}

function normalizeFieldLayout(sourceLayout = {}, fields = {}) {
  const layout = {};
  for (const [groupKey, defaultGroup] of Object.entries(DEFAULT_FIELD_LAYOUT)) {
    layout[groupKey] = normalizeFieldGroup(sourceLayout?.[groupKey], defaultGroup, fields, groupKey);
  }
  return layout;
}

function rowToPayload(req, formCode, row) {
  const layout = safeLayout(row?.layout_json || {});
  return {
    form_code: formCode,
    saved: !!row,
    layout: {
      ...layout,
      logo_url: absoluteUrl(req, layout.logo_url),
      ads: layout.ads.map((ad) => ({
        ...ad,
        url: absoluteUrl(req, ad.url),
        image_url: absoluteUrl(req, ad.image_url || ad.url),
      })),
    },
    updated_by: row?.updated_by || '',
    updated_at: row?.updated_at || null,
  };
}

function parseUploadBody(body = {}) {
  const rawData = String(body.data_url || body.base64 || '').trim();
  const dataUrlMatch = rawData.match(/^data:([^;]+);base64,(.+)$/);
  const mimeType = String(body.mime_type || dataUrlMatch?.[1] || '').trim().toLowerCase();
  const base64 = dataUrlMatch ? dataUrlMatch[2] : rawData;
  if (!allowedTypes.has(mimeType)) {
    const error = new Error(`unsupported image type. allowed: ${Array.from(allowedTypes.keys()).join(', ')}`);
    error.status = 400;
    throw error;
  }
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) {
    const error = new Error('file data is required');
    error.status = 400;
    throw error;
  }
  return { mimeType, buffer };
}

function cleanFileStem(value = '') {
  const parsed = path.parse(String(value || 'slip').trim()).name || 'slip';
  return parsed.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'slip';
}

router.get('/pos-slip-template/:formCode', async (req, res) => {
  try {
    await ensureTable();
    const formCode = String(req.params.formCode || 'CR-0088').trim().toUpperCase();
    const result = await query('SELECT * FROM sml_pos_slip_template WHERE lower(form_code) = lower($1)', [formCode]);
    return res.json({ success: true, data: rowToPayload(req, formCode, result.rows[0]) });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

router.post('/pos-slip-template/:formCode', async (req, res) => {
  try {
    await ensureTable();
    const formCode = String(req.params.formCode || 'CR-0088').trim().toUpperCase();
    const layout = safeLayout(req.body.layout || req.body);
    const updatedBy = String(req.body.updated_by || '').trim();
    const result = await query(
      `INSERT INTO sml_pos_slip_template (form_code, layout_json, updated_by, updated_at)
       VALUES ($1, $2::jsonb, $3, NOW())
       ON CONFLICT (form_code)
       DO UPDATE SET layout_json = EXCLUDED.layout_json, updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING *`,
      [formCode, JSON.stringify(layout), updatedBy],
    );
    return res.json({ success: true, data: rowToPayload(req, formCode, result.rows[0]) });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

router.post('/pos-slip-template/:formCode/upload', async (req, res) => {
  try {
    ensureUploadDir();
    const { mimeType, buffer } = parseUploadBody(req.body);
    const formCode = String(req.params.formCode || 'CR-0088').trim().toUpperCase();
    const ext = allowedTypes.get(mimeType);
    const originalName = String(req.body.file_name || req.body.original_name || 'slip-image').trim() || 'slip-image';
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${formCode.toLowerCase()}-${cleanFileStem(originalName)}.${ext}`;
    fs.writeFileSync(path.join(uploadDir, fileName), buffer);
    const urlPath = `${publicPrefix}/${fileName}`;
    return res.json({
      success: true,
      data: {
        url_path: urlPath,
        url: absoluteUrl(req, urlPath),
        mime_type: mimeType,
        file_name: fileName,
        file_size: buffer.length,
      },
    });
  } catch (ex) {
    return res.status(ex.status || 500).json({ success: false, msg: ex.message });
  }
});

module.exports = {
  router,
  safeLayout,
  DEFAULT_LAYOUT,
  DEFAULT_FIELD_LAYOUT,
  DEFAULT_SECTION_STYLES,
  DEFAULT_FIELD_STYLES,
};
