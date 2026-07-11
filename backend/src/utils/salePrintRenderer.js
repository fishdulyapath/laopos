const zlib = require('zlib');
const QRCode = require('qrcode');

const COORD_SCALE = 0.75;
const DEFAULT_FONT = "'Angsana New', 'AngsanaUPC', Thonburi, 'TH Sarabun New', Tahoma, sans-serif";
const DEFAULT_FONT_SIZE_PT = 10;
const PREPRINTED_TABLE_FORM_CODES = new Set(['cr-008']);
const SUMMARY_EVERY_PAGE_FORM_CODES = new Set(['cr-008']);
const SUMMARY_FIELD_NAMES = new Set([
  'total_value',
  'total_discount',
  'discount_word',
  'total_before_vat',
  'total_vat_value',
  'total_after_vat',
  'total_except_vat',
  'total_amount',
  'total_net_amount',
  'cash_amount',
  'tranfer_amount',
  'transfer_amount',
  'card_amount',
  'total_credit_charge',
  'total_income_amount',
  'rounded_amount',
  'change_amount',
  'change_money',
  'money_change',
]);

function asBuffer(value) {
  if (!value) return Buffer.alloc(0);
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string' && value.startsWith('\\x')) return Buffer.from(value.slice(2), 'hex');
  return Buffer.from(value);
}

function decodeZipEntry(bufferLike) {
  const buffer = asBuffer(bufferLike);
  if (!buffer.length) return '';

  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    const flags = buffer.readUInt16LE(6);
    const compression = buffer.readUInt16LE(8);
    const compressedSize = buffer.readUInt32LE(18);
    const fileNameLength = buffer.readUInt16LE(26);
    const extraLength = buffer.readUInt16LE(28);
    const dataOffset = 30 + fileNameLength + extraLength;
    let dataEnd = compressedSize ? dataOffset + compressedSize : buffer.length;

    if (flags & 0x08) {
      const descriptor = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x07, 0x08]), dataOffset);
      if (descriptor > dataOffset) dataEnd = descriptor;
    }

    const compressed = buffer.subarray(dataOffset, Math.min(dataEnd, buffer.length));
    if (compression === 0) return compressed.toString('utf8');
    if (compression === 8) return zlib.inflateRawSync(compressed).toString('utf8');
  }

  return buffer.toString('utf8');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeHtmlWithPrintGaps(value, objectWidth = 0) {
  return String(value ?? '').split(/( {8,})/g).map((part) => {
    if (!/^ {8,}$/.test(part)) return escapeHtml(part);

    const maxGapWidth = objectWidth > 0 ? objectWidth * 0.65 : 240;
    const gapWidth = Math.min(
      Math.max(24, maxGapWidth),
      Math.max(24, part.length * 4.7)
    );
    return `<span class="sml-text-gap" style="width:${gapWidth.toFixed(2)}pt"></span>`;
  }).join('');
}

function tagValues(source, tagName) {
  const pattern = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'g');
  return Array.from(String(source || '').matchAll(pattern), (match) => decodeXml(match[1] || ''));
}

function firstTag(source, tagName, fallback = '') {
  const values = tagValues(source, tagName);
  return values.length ? values[0] : fallback;
}

function firstAnyTag(source, tagNames, fallback = '') {
  for (const tagName of tagNames) {
    const value = firstTag(source, tagName);
    if (value !== '') return value;
  }
  return fallback;
}

function lastTag(source, tagName, fallback = '') {
  const values = tagValues(source, tagName);
  return values.length ? values[values.length - 1] : fallback;
}

function blockValues(source, tagName) {
  const pattern = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'g');
  return Array.from(String(source || '').matchAll(pattern), (match) => match[1] || '');
}

function decodeXml(value) {
  return String(value ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const num = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(num) ? num : fallback;
}

function toPt(value, fallback = 0) {
  return toNumber(value, fallback) * COORD_SCALE;
}

function getStyleColor(value, fallback = '#000000') {
  const text = String(value || '').trim();
  if (!text) return fallback;
  if (text.startsWith('#')) return text;
  if (/^[0-9a-f]{6}$/i.test(text)) return `#${text}`;
  const lower = text.toLowerCase();
  if (lower.includes('transparent')) return 'transparent';
  if (lower.includes('white')) return '#ffffff';
  if (lower.includes('black')) return '#000000';
  if (lower.includes('red')) return '#ff0000';
  if (lower.includes('green')) return '#008000';
  if (lower.includes('blue')) return '#0000ff';

  const rgba = text.match(/A\s*=\s*(\d+)\s*,\s*R\s*=\s*(\d+)\s*,\s*G\s*=\s*(\d+)\s*,\s*B\s*=\s*(\d+)/i);
  if (rgba) {
    const [, a, r, g, b] = rgba.map(Number);
    const alpha = Math.max(0, Math.min(1, a / 255));
    return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
  }
  return fallback;
}

function mimeFromBase64(base64) {
  const head = String(base64 || '').slice(0, 16);
  if (head.startsWith('/9j/')) return 'image/jpeg';
  if (head.startsWith('iVBOR')) return 'image/png';
  if (head.startsWith('R0lGOD')) return 'image/gif';
  return 'image/png';
}

function parsePageSetup(pageBlock) {
  const setupBlock = blockValues(pageBlock, 'PageSetup')[0] || '';
  const width = toNumber(firstTag(setupBlock, 'PaperWidth'), 595);
  const height = toNumber(firstTag(setupBlock, 'PaperHeight'), 842);
  const orientation = firstTag(setupBlock, 'Orientation');
  const landscapeFlag = firstTag(setupBlock, 'LandScape');
  return {
    width,
    height,
    orientation,
    landscape: /landscape/i.test(orientation) || landscapeFlag.toLowerCase() === 'true' || width > height,
  };
}

function parseFont(objectBlock, fallback = null) {
  const fontBlock = blockValues(objectBlock, 'Font')[0] || '';
  const fontName = firstTag(fontBlock, 'Name') || firstTag(objectBlock, 'FontName');
  const fontSize = firstTag(fontBlock, 'Size') || firstTag(objectBlock, 'FontSize');
  const fontStyle = (firstTag(fontBlock, 'Style') || firstTag(objectBlock, 'FontStyle')).toLowerCase();
  return {
    name: fontName || fallback?.name || DEFAULT_FONT,
    size: fontSize === '' ? (fallback?.size || DEFAULT_FONT_SIZE_PT) : Math.max(1, toNumber(fontSize, DEFAULT_FONT_SIZE_PT)),
    bold: fontStyle ? fontStyle.includes('bold') : !!fallback?.bold,
    italic: fontStyle ? fontStyle.includes('italic') : !!fallback?.italic,
    underline: fontStyle ? fontStyle.includes('underline') : !!fallback?.underline,
  };
}

function parseTableHeaderFont(objectBlock, fallback = null) {
  const fontName = firstTag(objectBlock, 'HeaderFontName');
  const fontSize = firstTag(objectBlock, 'HeaderFontSize');
  const fontStyle = (firstTag(objectBlock, 'HeaderFontStyle') || '').toLowerCase();
  return {
    name: fontName || fallback?.name || DEFAULT_FONT,
    size: fontSize === '' || toNumber(fontSize, 0) <= 0 ? (fallback?.size || DEFAULT_FONT_SIZE_PT) : Math.max(1, toNumber(fontSize, DEFAULT_FONT_SIZE_PT)),
    bold: fontStyle ? fontStyle.includes('bold') : !!fallback?.bold,
    italic: fontStyle ? fontStyle.includes('italic') : !!fallback?.italic,
    underline: fontStyle ? fontStyle.includes('underline') : !!fallback?.underline,
  };
}

function parseBorder(objectBlock) {
  const lineBlock = blockValues(objectBlock, 'LineColor')[0] || '';
  const lineColor = firstTag(lineBlock, 'ColorCode') || firstTag(objectBlock, 'LineColor');
  return {
    color: getStyleColor(lineColor, '#000000'),
    width: Math.max(0.25, toNumber(firstTag(objectBlock, 'PenWidth'), 1) * COORD_SCALE),
  };
}

function parsePadding(objectBlock) {
  const paddingBlock = blockValues(objectBlock, 'Padding')[0] || '';
  const all = toNumber(firstTag(paddingBlock, 'All'), 0);
  const fallback = all >= 0 ? all : 0;
  return {
    top: toPt(firstTag(paddingBlock, 'Top'), fallback),
    right: toPt(firstTag(paddingBlock, 'Right'), fallback),
    bottom: toPt(firstTag(paddingBlock, 'Bottom'), fallback),
    left: toPt(firstTag(paddingBlock, 'Left'), fallback),
  };
}

function parseTableColumn(columnBlock, objectBlock) {
  const displayFormat = firstTag(columnBlock, 'DisplayFormat');
  const fieldFormat = firstTag(columnBlock, 'FieldFormat');
  const text = firstTag(columnBlock, 'Text');
  const headerText = firstTag(columnBlock, 'HeaderText');
  const replaceText = firstTag(columnBlock, 'ReplaceText');
  const tableFont = parseFont(objectBlock);
  const headerFont = parseTableHeaderFont(objectBlock, tableFont);
  return {
    queryRule: firstAnyTag(columnBlock, ['QueryRule', 'queryRule'])
      || extractQueryRuleSuffix(text)
      || extractQueryRuleSuffix(headerText)
      || extractQueryRuleSuffix(replaceText)
      || firstAnyTag(objectBlock, ['QueryRule', 'queryRule']),
    fieldName: firstTag(columnBlock, 'FieldName') || extractPlaceholder(text),
    headerText: headerText || text,
    replaceText,
    displayFormat,
    fieldFormat,
    format: displayFormat || fieldFormat,
    width: toNumber(firstTag(columnBlock, 'ColumnsWidth'), 1),
    align: firstTag(columnBlock, 'ContentAlign'),
    headerAlign: firstTag(columnBlock, 'ContentHeaderAlign') || firstTag(columnBlock, 'HeaderAlignment') || firstTag(columnBlock, 'ContentAlign'),
    font: parseFont(columnBlock, tableFont),
    headerFont,
    padding: parsePadding(columnBlock),
  };
}

function parseTableColumns(objectBlock) {
  const columns = [];
  for (const tableColumnsBlock of blockValues(objectBlock, 'TableColumns')) {
    const nestedColumns = blockValues(tableColumnsBlock, 'Column');
    if (nestedColumns.length) {
      columns.push(...nestedColumns.map((columnBlock) => parseTableColumn(columnBlock, objectBlock)));
    } else if (tableColumnsBlock.trim()) {
      columns.push(parseTableColumn(tableColumnsBlock, objectBlock));
    }
  }
  return columns;
}

function parseDrawObject(objectBlock) {
  const objectOnlyBlock = objectBlock.split('<TableColumns>')[0] || objectBlock;
  const toolType = firstTag(objectOnlyBlock, 'ToolType');
  const roundedBlock = blockValues(objectOnlyBlock, 'RoundedRectangleRadius')[0] || '';

  return {
    toolType,
    queryRule: firstAnyTag(objectOnlyBlock, ['QueryRule', 'queryRule'])
      || extractQueryRuleSuffix(firstTag(objectOnlyBlock, 'Text'))
      || extractQueryRuleSuffix(firstTag(objectOnlyBlock, 'ReplaceText')),
    fieldName: firstTag(objectOnlyBlock, 'FieldName'),
    fieldType: firstTag(objectOnlyBlock, 'FieldType'),
    fieldFormat: firstTag(objectOnlyBlock, 'FieldFormat'),
    displayFormat: firstTag(objectOnlyBlock, 'DisplayFormat'),
    text: firstTag(objectOnlyBlock, 'Text'),
    replaceText: firstTag(objectOnlyBlock, 'ReplaceText'),
    align: firstTag(objectOnlyBlock, 'ContentAlign'),
    left: toPt(lastTag(objectOnlyBlock, 'Left')),
    top: toPt(lastTag(objectOnlyBlock, 'Top')),
    width: toPt(lastTag(objectOnlyBlock, 'Width')),
    height: toPt(lastTag(objectOnlyBlock, 'Height')),
    startX: toPt(firstTag(objectOnlyBlock, 'StartPointX')),
    startY: toPt(firstTag(objectOnlyBlock, 'StartPointY')),
    stopX: toPt(firstTag(objectOnlyBlock, 'StopPointX')),
    stopY: toPt(firstTag(objectOnlyBlock, 'StopPointY')),
    lineSpace: toPt(firstTag(objectOnlyBlock, 'LineSpace')),
    rowPerPage: toNumber(firstTag(objectOnlyBlock, 'RowPerPage'), 0),
    radius: toPt(firstTag(roundedBlock, 'All')),
    image: firstTag(objectOnlyBlock, 'Image'),
    pictureMode: firstTag(objectOnlyBlock, 'PictureBoxSizeMode'),
    barcodeType: firstTag(objectOnlyBlock, 'BarcodeType'),
    font: parseFont(objectOnlyBlock),
    border: parseBorder(objectOnlyBlock),
    color: getStyleColor(firstTag(objectOnlyBlock, 'Color'), '#000000'),
    backgroundColor: getStyleColor(firstTag(objectOnlyBlock, 'BackgroundColor'), 'transparent'),
    padding: parsePadding(objectOnlyBlock),
    columns: parseTableColumns(objectBlock),
  };
}

function parseFormDesign(form) {
  const xml = decodeZipEntry(form.formdesigntext);
  const pages = blockValues(xml, 'PageList').map((pageBlock) => ({
    setup: parsePageSetup(pageBlock),
    objects: blockValues(pageBlock, 'DrawObjectList').map(parseDrawObject),
  }));

  return {
    formcode: form.formcode,
    formname: form.formname || form.formcode,
    pages,
  };
}

function normalizeRows(rows) {
  return (rows || []).map((row, index) => ({ ...row, __rowNumber: index + 1 }));
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatThaiDate(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return `${pad2(day)}/${pad2(month)}/${year}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const bangkok = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return `${pad2(bangkok.getUTCDate())}/${pad2(bangkok.getUTCMonth() + 1)}/${bangkok.getUTCFullYear()}`;
}

function isDateField(fieldName) {
  return /(^|_)(date|due_date)$/i.test(String(fieldName || ''));
}

function decimalPlaces(format) {
  const text = String(format || '');
  const dot = text.lastIndexOf('.');
  if (dot < 0) return 0;
  const decimals = text.slice(dot + 1).match(/[0#]/g);
  return decimals ? decimals.length : 0;
}

function isNumericFormat(format) {
  const text = String(format || '');
  return /[#0]/.test(text) && !text.toLowerCase().startsWith('text:');
}

function formatNumberValue(value, format = '') {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  const fractionDigits = Math.min(10, Math.max(0, decimalPlaces(format || '#,##0.00')));
  return num.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

const THAI_DIGITS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const THAI_UNITS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];

function readThaiNumber(integerText) {
  const text = String(integerText || '').replace(/^0+/, '') || '0';
  if (text === '0') return THAI_DIGITS[0];
  let result = '';
  const length = text.length;

  for (let index = 0; index < length; index += 1) {
    const digit = Number(text[index]);
    const position = length - index - 1;
    const unitIndex = position % 6;

    if (digit === 0) {
      if (unitIndex === 0 && position > 0 && position % 6 === 0) result += THAI_UNITS[6];
      continue;
    }

    const groupStart = Math.max(0, index - unitIndex);
    const hasPreviousDigitInGroup = text.slice(groupStart, index).split('').some((char) => char !== '0');

    if (unitIndex === 1 && digit === 1) {
      result += THAI_UNITS[1];
    } else if (unitIndex === 1 && digit === 2) {
      result += `ยี่${THAI_UNITS[1]}`;
    } else if (unitIndex === 0 && digit === 1 && hasPreviousDigitInGroup) {
      result += 'เอ็ด';
    } else {
      result += `${THAI_DIGITS[digit]}${THAI_UNITS[unitIndex]}`;
    }

    if (unitIndex === 0 && position > 0 && position % 6 === 0) result += THAI_UNITS[6];
  }

  return result;
}

function formatThaiBaht(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  const fixed = Math.abs(num).toFixed(2);
  const [bahtText, satangText] = fixed.split('.');
  const prefix = num < 0 ? 'ลบ' : '';
  const baht = readThaiNumber(bahtText);
  const satang = Number(satangText);
  if (!satang) return `${prefix}${baht}บาทถ้วน`;
  return `${prefix}${baht}บาท${readThaiNumber(satangText)}สตางค์`;
}

function normalizeKey(key) {
  return String(key || '').toLowerCase();
}

function normalizeQueryRule(queryRule) {
  return String(queryRule || '').trim().toUpperCase();
}

function queryTableRows(queryRule, data) {
  const rule = normalizeQueryRule(queryRule);
  const rows = data.queryTables?.[rule];
  return Array.isArray(rows) ? rows : null;
}

function tableQueryRule(object) {
  const rules = [
    object.queryRule,
    ...(object.columns || []).map((column) => column.queryRule),
  ].map(normalizeQueryRule).filter(Boolean);

  if (rules.includes('B')) return 'B';
  if (rules.includes('G')) return 'G';
  if (rules.includes('F')) return 'F';
  if (rules.includes('I')) return 'I';
  const formQueryRule = rules.find((rule) => /^[A-I]$/.test(rule));
  if (formQueryRule) return formQueryRule;
  return 'B';
}

function rowsForQueryRule(queryRule, data) {
  const queryRows = queryTableRows(queryRule, data);
  if (queryRows) return queryRows;

  switch (normalizeQueryRule(queryRule)) {
    case 'B':
      return data.details || [];
    case 'G':
      return data.promotions || data.promotion_details || data.promotionDetail || [];
    case 'F':
      return data.campaigns || data.campaign_details || [];
    case 'I':
      return data.payments || data.payment_details || [];
    default:
      return [];
  }
}

function isDetailTable(object) {
  return tableQueryRule(object) === 'B';
}

function shouldHideTableHeader(formCode) {
  return PREPRINTED_TABLE_FORM_CODES.has(String(formCode || '').trim().toLowerCase());
}

function shouldHideTableLines(formCode) {
  return PREPRINTED_TABLE_FORM_CODES.has(String(formCode || '').trim().toLowerCase());
}

function shouldRepeatSummaryOnEveryPage(formCode) {
  return SUMMARY_EVERY_PAGE_FORM_CODES.has(String(formCode || '').trim().toLowerCase());
}

function getRawValue(fieldName, queryRule, data, row) {
  const key = normalizeKey(fieldName);
  if (!key) return '';
  if (key === 'rownumber' || key === '__rownumber') return row?.__rowNumber || '';
  if (row && Object.prototype.hasOwnProperty.call(row, key)) return row[key];

  const rule = normalizeQueryRule(queryRule);
  if (rule === 'B') return '';
  const querySource = queryTableRows(rule, data)?.[0] || null;
  if (querySource && Object.prototype.hasOwnProperty.call(querySource, key)) return querySource[key];
  if (rule === 'C') return data.company?.[key] ?? '';
  if (['F', 'G', 'I'].includes(rule)) {
    const source = rowsForQueryRule(rule, data)[0] || {};
    return source[key] ?? '';
  }
  return data.header?.[key] ?? data.company?.[key] ?? '';
}

function extractPlaceholder(text) {
  const match = String(text || '').match(/\[([^\]]+)\]/);
  return match ? match[1] : '';
}

function extractQueryRuleSuffix(text) {
  const match = String(text || '').match(/\[[^\]]+\]\s*,\s*([A-I])\s*$/i);
  return match ? match[1].toUpperCase() : '';
}

function extractPlaceholders(text) {
  return Array.from(String(text || '').matchAll(/\[([^\]]+)\]/g), (match) => match[1]).filter(Boolean);
}

function formatObjectValue(rawValue, fieldName, format) {
  if (isDateField(fieldName)) return formatThaiDate(rawValue);
  if (String(format || '').toLowerCase().startsWith('text:')) return formatThaiBaht(rawValue);
  if (isNumericFormat(format)) return formatNumberValue(rawValue, format);
  if (!format && /^qty$/i.test(String(fieldName || '')) && rawValue !== null && rawValue !== undefined && rawValue !== '') {
    return formatNumberValue(rawValue, '#,##0.00');
  }
  return rawValue ?? '';
}

function specialTokenValue(token, data, row, pageMeta) {
  const key = normalizeKey(token);
  const header = data.header || {};
  switch (key) {
    case 'page':
      return String(pageMeta.pageNumber || 1);
    case 'totalpage':
      return String(pageMeta.totalPages || 1);
    case 'rownumber':
      return String(row?.__rowNumber || '');
    case 'printby':
      return header.printby || header.print_by || header.print_user_code || '';
    case 'printbyname':
      return header.printbyname || header.print_by_name || header.print_user_name || '';
    default:
      return `&${token}&`;
  }
}

function replaceSpecialTokens(text, data, row, pageMeta) {
  return String(text || '').replace(/&(totalpage|page|rownumber|printbyname|printby)&/gi, (_, token) => (
    specialTokenValue(token, data, row, pageMeta)
  ));
}

function resolveText(object, data, row, pageMeta) {
  let text = replaceSpecialTokens(object.text || '', data, row, pageMeta);
  const replaceText = replaceSpecialTokens(object.replaceText || '', data, row, pageMeta);

  if (/&rownumber&/i.test(object.replaceText || '')) return replaceText;

  const placeholder = extractPlaceholder(text) || object.fieldName;
  if (!placeholder) return (replaceText || text).replace(/\\n/g, '\n');

  const rawValue = getRawValue(placeholder, object.queryRule, data, row);
  const value = formatObjectValue(rawValue, placeholder, object.fieldFormat || object.displayFormat);
  if (replaceText) return replaceText.includes('@') ? replaceText.replace(/@/g, value) : replaceText;
  if (/^\s*\[[^\]]+\]\s*,\s*[A-Za-z0-9_]+\s*$/.test(text)) return value;
  return text.replace(/\[[^\]]+\]/g, value).replace(/\\n/g, '\n');
}

function cssAlign(align) {
  const text = String(align || '').toLowerCase();
  if (text.includes('right')) return 'right';
  if (text.includes('left')) return 'left';
  if (text.includes('center')) return 'center';
  return 'left';
}

function cssJustify(align) {
  const text = String(align || '').toLowerCase();
  if (text.includes('right')) return 'flex-end';
  if (text.includes('left')) return 'flex-start';
  if (text.includes('center')) return 'center';
  return 'flex-start';
}

function cssVAlign(align) {
  const text = String(align || '').toLowerCase();
  if (text.includes('top')) return 'flex-start';
  if (text.includes('bottom')) return 'flex-end';
  if (text.includes('middle') || text.includes('center')) return 'center';
  return 'flex-start';
}

function fontCss(font, options = {}) {
  const sizeDeltaPt = Number(options.sizeDeltaPt || 0);
  const fontSize = Math.max(1, font.size + sizeDeltaPt);
  const fontName = String(font.name || '').trim();
  const quotedName = fontName ? `'${fontName.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : '';
  const fontFamily = !fontName || fontName === DEFAULT_FONT || DEFAULT_FONT.toLowerCase().includes(fontName.toLowerCase())
    ? DEFAULT_FONT
    : `${quotedName}, ${DEFAULT_FONT}`;
  return [
    `font-family:${fontFamily}`,
    `font-size:${fontSize.toFixed(2)}pt`,
    font.bold ? 'font-weight:700' : '',
    font.italic ? 'font-style:italic' : '',
    font.underline ? 'text-decoration:underline' : '',
  ].filter(Boolean).join(';');
}

function objectTop(object) {
  if (object.toolType === 'Line') return Math.min(object.startY || 0, object.stopY || 0);
  return object.top || 0;
}

function isPageCounterObject(object) {
  return /&(?:total)?page&/i.test(`${object.text || ''} ${object.replaceText || ''}`);
}

function objectFieldNames(object) {
  return [
    object.fieldName,
    ...extractPlaceholders(object.text),
    ...extractPlaceholders(object.replaceText),
  ].filter(Boolean).map(normalizeKey);
}

function isSummaryFieldObject(object, page) {
  if (!['Label', 'TextField', 'ImageField'].includes(object.toolType)) return false;
  if (isPageCounterObject(object)) return false;
  if (objectTop(object) < page.setup.height * 0.45) return false;
  return objectFieldNames(object).some((fieldName) => SUMMARY_FIELD_NAMES.has(fieldName));
}

function summaryStartTop(page) {
  const tops = page.objects
    .filter((object) => isSummaryFieldObject(object, page))
    .map(objectTop);
  if (!tops.length) return null;
  return Math.max(page.setup.height * 0.45, Math.min(...tops) - 6);
}

function shouldRenderObjectOnPage(object, pageMeta) {
  if (object.toolType === 'Table') return isDetailTable(object) || pageMeta.isSummaryPage || pageMeta.repeatSummaryOnEveryPage;
  if (isPageCounterObject(object)) return true;
  if (pageMeta.isSummaryPage || pageMeta.repeatSummaryOnEveryPage) return true;
  if (isSummaryFieldObject(object, pageMeta.page)) return false;
  return true;
}

function renderTextObject(object, data, row, pageMeta) {
  const value = resolveText(object, data, row, pageMeta);
  const htmlValue = escapeHtmlWithPrintGaps(value, object.width);
  const verticalAlign = cssVAlign(object.align);
  const contentNudge = verticalAlign === 'center' ? 'transform:translateY(-0.08em)' : verticalAlign === 'flex-end' ? 'transform:translateY(-0.12em)' : '';
  const contentStyle = [
    'display:block',
    'width:100%',
    'white-space:inherit',
    'line-height:1.25',
    'overflow:visible',
    contentNudge,
  ].filter(Boolean).join(';');
  const style = [
    `left:${object.left.toFixed(2)}pt`,
    `top:${object.top.toFixed(2)}pt`,
    `width:${object.width.toFixed(2)}pt`,
    `height:${object.height.toFixed(2)}pt`,
    fontCss(object.font),
    `text-align:${cssAlign(object.align)}`,
    `align-items:${verticalAlign}`,
    `color:${object.color || '#000000'}`,
    object.backgroundColor && object.backgroundColor !== 'transparent' ? `background:${object.backgroundColor}` : '',
    `padding:${object.padding.top.toFixed(2)}pt ${object.padding.right.toFixed(2)}pt ${object.padding.bottom.toFixed(2)}pt ${object.padding.left.toFixed(2)}pt`,
    'position:absolute',
    'z-index:4',
    'display:flex',
    'white-space:pre',
    'word-break:normal',
    'overflow:visible',
    'box-sizing:border-box',
    'line-height:1.25',
  ].join(';');
  return `<div class="sml-text" style="${style}"><span class="sml-text-content" style="${contentStyle}">${htmlValue}</span></div>`;
}

function renderLineObject(object) {
  const x1 = object.startX;
  const y1 = object.startY;
  const x2 = object.stopX;
  const y2 = object.stopY;
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const color = object.border.color;

  if (height <= 0.5) {
    return `<div style="position:absolute;z-index:1;left:${left.toFixed(2)}pt;top:${top.toFixed(2)}pt;width:${width.toFixed(2)}pt;border-top:${object.border.width.toFixed(2)}pt solid ${color};"></div>`;
  }
  if (width <= 0.5) {
    return `<div style="position:absolute;z-index:1;left:${left.toFixed(2)}pt;top:${top.toFixed(2)}pt;height:${height.toFixed(2)}pt;border-left:${object.border.width.toFixed(2)}pt solid ${color};"></div>`;
  }

  const length = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
  return `<div style="position:absolute;z-index:1;left:${x1.toFixed(2)}pt;top:${y1.toFixed(2)}pt;width:${length.toFixed(2)}pt;border-top:${object.border.width.toFixed(2)}pt solid ${color};transform-origin:0 0;transform:rotate(${angle.toFixed(3)}deg);"></div>`;
}

function renderBoxObject(object, rounded = false) {
  const radius = rounded ? Math.max(2, object.radius || 4) : 0;
  return `<div style="position:absolute;z-index:0;left:${object.left.toFixed(2)}pt;top:${object.top.toFixed(2)}pt;width:${object.width.toFixed(2)}pt;height:${object.height.toFixed(2)}pt;border:${object.border.width.toFixed(2)}pt solid ${object.border.color};border-radius:${radius.toFixed(2)}pt;box-sizing:border-box;"></div>`;
}

function renderPictureObject(object) {
  if (!object.image) return '';
  const mime = mimeFromBase64(object.image);
  return `<img alt="" src="data:${mime};base64,${object.image}" style="position:absolute;z-index:2;left:${object.left.toFixed(2)}pt;top:${object.top.toFixed(2)}pt;width:${object.width.toFixed(2)}pt;height:${object.height.toFixed(2)}pt;object-fit:fill;" />`;
}

function qrSvgDataUrl(value) {
  const qr = QRCode.create(String(value || ''), { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  const cells = qr.modules.data;
  const rects = [];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (cells[y * size + x]) rects.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><g fill="#000">${rects.join('')}</g></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function renderImageFieldObject(object, data, pageMeta) {
  if (object.image) return renderPictureObject(object);

  const placeholder = extractPlaceholder(object.text) || object.fieldName;
  const rawValue = getRawValue(placeholder, object.queryRule, data, null);
  const value = rawValue || resolveText({ ...object, replaceText: '' }, data, null, pageMeta);
  const barcodeType = String(object.barcodeType || '').toLowerCase();

  if (barcodeType.includes('qrcode') && value) {
    return `<img alt="" src="${qrSvgDataUrl(value)}" style="position:absolute;z-index:2;left:${object.left.toFixed(2)}pt;top:${object.top.toFixed(2)}pt;width:${object.width.toFixed(2)}pt;height:${object.height.toFixed(2)}pt;object-fit:contain;" />`;
  }

  return renderTextObject({ ...object, text: value, replaceText: '' }, data, null, pageMeta);
}

function resolveTableCell(column, data, row) {
  if (/&(totalpage|page|rownumber|printbyname|printby)&/i.test(column.replaceText || '')) {
    return replaceSpecialTokens(column.replaceText, data, row, { pageNumber: 1, totalPages: 1 });
  }
  const raw = getRawValue(column.fieldName, column.queryRule, data, row);
  return formatObjectValue(raw, column.fieldName, column.format);
}

function renderTableObject(object, data, pageRows, pageMeta = {}) {
  const rowHeight = Math.max(14, object.lineSpace || 18);
  const columns = tableColumns(object);
  const hasHeader = columns.some((column) => tableHeaderText(column));
  const visibleHeader = hasHeader && !shouldHideTableHeader(pageMeta.formCode);
  const headerHeight = hasHeader ? Math.max(18, Math.min(42, object.height * 0.13)) : 0;
  const visibleLines = !shouldHideTableLines(pageMeta.formCode);
  const borderWidth = object.border.width.toFixed(2);
  const borderColor = object.border.color;

  const verticalLines = visibleLines ? columns.slice(1).map((column) => (
    `<div class="sml-table-line" style="left:${column.left.toFixed(2)}pt;top:0;width:0;height:${object.height.toFixed(2)}pt;border-left:${borderWidth}pt solid ${borderColor};"></div>`
  )).join('') : '';

  const header = visibleHeader ? columns.map((column) => {
    const text = escapeHtml(tableHeaderText(column)).replace(/\\n/g, '<br>');
    const padding = `${column.padding.top.toFixed(2)}pt ${column.padding.right.toFixed(2)}pt ${column.padding.bottom.toFixed(2)}pt ${column.padding.left.toFixed(2)}pt`;
    return `<div class="sml-table-cell sml-table-header-cell" style="left:${column.left.toFixed(2)}pt;top:0;width:${column.width.toFixed(2)}pt;height:${headerHeight.toFixed(2)}pt;text-align:${cssAlign(column.headerAlign)};justify-content:${cssJustify(column.headerAlign)};align-items:${cssVAlign(column.headerAlign)};${fontCss(column.headerFont || column.font)};padding:${padding};">${text}</div>`;
  }).join('') : '';

  const headerLine = visibleHeader
    ? `<div class="sml-table-line" style="left:0;top:${headerHeight.toFixed(2)}pt;width:${object.width.toFixed(2)}pt;height:0;border-top:${borderWidth}pt solid ${borderColor};"></div>`
    : '';

  let bodyTop = headerHeight;
  const body = pageRows.map((row) => {
    const rowUnits = Math.max(1, row.__printLineUnits || estimateTableRowUnits(row, columns, data));
    const top = bodyTop;
    const height = rowHeight * rowUnits;
    bodyTop += height;
    const cells = columns.map((column) => {
      const value = resolveTableCell(column, data, row);
      const padding = `${column.padding.top.toFixed(2)}pt ${column.padding.right.toFixed(2)}pt ${column.padding.bottom.toFixed(2)}pt ${column.padding.left.toFixed(2)}pt`;
      const text = escapeHtml(value).replace(/\n/g, '<br>');
      return `<div class="sml-table-cell" style="left:${column.left.toFixed(2)}pt;top:${top.toFixed(2)}pt;width:${column.width.toFixed(2)}pt;height:${height.toFixed(2)}pt;text-align:${cssAlign(column.align)};justify-content:${cssJustify(column.align)};align-items:${cssVAlign(column.align)};${fontCss(column.font)};padding:${padding};">${text}</div>`;
    }).join('');
    return cells;
  }).join('');

  return `
    <div class="sml-table-box" style="left:${object.left.toFixed(2)}pt;top:${object.top.toFixed(2)}pt;width:${object.width.toFixed(2)}pt;height:${object.height.toFixed(2)}pt;">
      ${visibleLines ? `<div class="sml-table-border" style="border:${borderWidth}pt solid ${borderColor};"></div>` : ''}
      ${verticalLines}
      ${headerLine}
      ${header}
      ${body}
    </div>`;
}

function renderObject(object, data, pageRows, pageMeta) {
  switch (object.toolType) {
    case 'Label':
    case 'TextField':
      return renderTextObject(object, data, null, pageMeta);
    case 'Line':
      return renderLineObject(object);
    case 'Rectangle':
      return renderBoxObject(object, false);
    case 'RoundedRectangle':
      return renderBoxObject(object, true);
    case 'Picture':
      return renderPictureObject(object);
    case 'ImageField':
      return renderImageFieldObject(object, data, pageMeta);
    case 'Table':
      return renderTableObject(object, data, isDetailTable(object) ? pageRows : normalizeRows(rowsForQueryRule(tableQueryRule(object), data)), pageMeta);
    default:
      return '';
  }
}

function primaryDetailTable(page) {
  return page.objects.find((object) => object.toolType === 'Table' && isDetailTable(object))
    || page.objects.find((object) => object.toolType === 'Table');
}

function maxRowsForPage(page, form) {
  const table = primaryDetailTable(page);
  if (!table) return 0;
  if (table.rowPerPage > 0) return table.rowPerPage;
  const hasHeader = tableColumns(table).some((column) => tableHeaderText(column));
  const headerHeight = hasHeader ? Math.max(18, Math.min(42, table.height * 0.13)) : 0;
  const rowHeight = Math.max(14, table.lineSpace || 18);
  return Math.max(1, Math.floor((table.height - headerHeight) / rowHeight));
}

function tableColumns(object) {
  const totalWidth = object.columns.reduce((sum, column) => sum + (column.width || 1), 0) || 1;
  let currentLeft = 0;
  return object.columns.map((column, index) => {
    const width = index === object.columns.length - 1
      ? Math.max(0, object.width - currentLeft)
      : object.width * ((column.width || 1) / totalWidth);
    const left = currentLeft;
    currentLeft += width;
    return { ...column, left, width };
  });
}

function isFieldBindingHeader(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return /^\[[^\]]+\](?:\s*,\s*[\w ]+)?$/i.test(text);
}

function tableHeaderText(column) {
  const text = column.headerText || '';
  return isFieldBindingHeader(text) ? '' : text;
}

function estimateCellLineCount(value, column) {
  const text = String(value ?? '').replace(/\r/g, '').trim();
  if (!text) return 1;
  const fontSize = Math.max(1, column.font?.size || DEFAULT_FONT_SIZE_PT);
  const charsPerLine = Math.max(4, Math.floor(column.width / (fontSize * 0.46)));
  return Math.max(1, ...text.split('\n').map((line) => Math.max(1, Math.ceil(line.length / charsPerLine))));
}

function estimateTableRowUnits(row, columns, data) {
  const units = columns.map((column) => estimateCellLineCount(resolveTableCell(column, data, row), column));
  return Math.max(1, Math.min(4, Math.max(...units)));
}

function chunkTableRows(rows, form, data) {
  if (!rows.length) return [[]];

  const tablePage = form.pages.find((page) => page.objects.some((object) => object.toolType === 'Table' && isDetailTable(object)))
    || form.pages.find((page) => page.objects.some((object) => object.toolType === 'Table'));
  const table = tablePage ? primaryDetailTable(tablePage) : null;
  if (!table) return [rows];
  if (table.rowPerPage > 0) return chunkRows(rows, table.rowPerPage);

  const maxRowUnits = Math.max(1, maxRowsForPage(tablePage, form));
  const columns = tableColumns(table);
  const chunks = [];
  let chunk = [];
  let usedUnits = 0;

  for (const row of rows) {
    const rowUnits = estimateTableRowUnits(row, columns, data);
    if (chunk.length && usedUnits + rowUnits > maxRowUnits) {
      chunks.push(chunk);
      chunk = [];
      usedUnits = 0;
    }
    chunk.push({ ...row, __printLineUnits: rowUnits });
    usedUnits += rowUnits;
  }

  if (chunk.length) chunks.push(chunk);
  return chunks;
}

function chunkRows(rows, size) {
  if (!rows.length) return [[]];
  if (!size || size >= rows.length) return [rows];
  const chunks = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}

function pageHasCopyLabel(page) {
  return page.objects.some((object) => /ต้นฉบับ|สำเนา|original|copy/i.test(`${object.text || ''} ${object.replaceText || ''}`));
}

function isCopyPageSet(form) {
  return form.pages.length > 1 && form.pages.some(pageHasCopyLabel);
}

function renderPage(form, page, data, pageRows, pageMeta) {
  const pageRenderMeta = {
    ...pageMeta,
    formCode: form.formcode,
    page,
    repeatSummaryOnEveryPage: shouldRepeatSummaryOnEveryPage(form.formcode),
    summaryStartTop: summaryStartTop(page),
  };
  const content = page.objects
    .filter((object) => shouldRenderObjectOnPage(object, pageRenderMeta))
    .map((object) => renderObject(object, data, pageRows, pageRenderMeta))
    .filter(Boolean)
    .join('\n');

  return `
    <section class="sml-page" data-form="${escapeHtml(form.formcode)}" style="width:${page.setup.width.toFixed(2)}pt;height:${page.setup.height.toFixed(2)}pt;">
      ${content}
    </section>`;
}

function renderForm(form, data) {
  const rows = normalizeRows(data.details);
  const chunks = chunkTableRows(rows, form, data);
  const totalPages = Math.max(1, chunks.length * Math.max(1, form.pages.length));
  let pageNumber = 0;

  if (!isCopyPageSet(form)) {
    return chunks.map((chunk, chunkIndex) => form.pages.map((page, pageIndex) => {
      pageNumber += 1;
      const isLastPhysicalPage = pageNumber === totalPages;
      return renderPage(form, page, data, chunk, {
        pageNumber,
        totalPages,
        copyIndex: pageIndex,
        chunkIndex,
        totalChunks: chunks.length,
        isSummaryPage: isLastPhysicalPage,
        isLastPage: isLastPhysicalPage,
        isLastPhysicalPage,
      });
    }).join('\n')).join('\n');
  }

  return form.pages.map((page, copyIndex) => chunks.map((chunk, chunkIndex) => {
    pageNumber += 1;
    const isSummaryPage = chunkIndex === chunks.length - 1;
    const isLastPhysicalPage = pageNumber === totalPages;
    return renderPage(form, page, data, chunk, {
      pageNumber,
      totalPages,
      copyIndex,
      chunkIndex,
      totalChunks: chunks.length,
      isSummaryPage,
      isLastPage: isLastPhysicalPage,
      isLastPhysicalPage,
    });
  }).join('\n')).join('\n');
}

function renderSalePrintHtml({ formRows, data, dataByFormCode = {}, autoPrint = true }) {
  const forms = formRows.map(parseFormDesign).filter((form) => form.pages.length);
  const firstPageSetup = forms[0]?.pages?.[0]?.setup || { width: 595, height: 842 };
  const printPageWidth = Math.max(1, Number(firstPageSetup.width || 595));
  const printPageHeight = Math.max(1, Number(firstPageSetup.height || 842));
  const printLandscape = Boolean(firstPageSetup.landscape || printPageWidth > printPageHeight);
  const pages = forms.map((form) => {
    const formData = dataByFormCode[String(form.formcode || '').toLowerCase()] || data;
    return renderForm(form, formData);
  }).join('\n');

  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(data.header?.doc_no || 'sale-print')}</title>
  <style>
    @page { size: ${printPageWidth.toFixed(2)}pt ${printPageHeight.toFixed(2)}pt; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; background: #e5e7eb; }
    body { font-family: ${DEFAULT_FONT}; color: #000; }
    .sml-page {
      position: relative;
      overflow: hidden;
      margin: 16px auto;
      background: #fff;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.16);
    }
    .sml-text { color: #000; }
    .sml-text-content {
      display: block;
      width: 100%;
      white-space: inherit;
    }
    .sml-text-gap {
      display: inline-block;
      height: 1em;
      vertical-align: baseline;
      white-space: normal;
    }
    .sml-table-box {
      position: absolute;
      z-index: 2;
      color: #000;
      overflow: hidden;
    }
    .sml-table-border,
    .sml-table-line {
      position: absolute;
      z-index: 1;
      box-sizing: border-box;
      pointer-events: none;
    }
    .sml-table-border {
      inset: 0;
    }
    .sml-table-cell {
      position: absolute;
      z-index: 2;
      display: flex;
      justify-content: flex-start;
      line-height: 1.08;
      white-space: pre-wrap;
      overflow: hidden;
      box-sizing: border-box;
    }
    .sml-table-header-cell {
      font-weight: 400;
    }
    @media print {
      html, body { width: 100%; background: #fff; }
      .sml-page {
        margin: 0;
        box-shadow: none;
        break-after: auto;
        page-break-after: auto;
      }
      .sml-page + .sml-page {
        break-before: page;
        page-break-before: always;
      }
    }
  </style>
</head>
<body data-print-width-pt="${printPageWidth.toFixed(2)}" data-print-height-pt="${printPageHeight.toFixed(2)}" data-print-landscape="${printLandscape ? '1' : '0'}">
${pages || '<div style="padding:24px">ไม่พบแบบฟอร์มสำหรับพิมพ์</div>'}
<script>
  function fitSmlPrintText() {
    document.querySelectorAll('.sml-text').forEach(function (el) {
      var content = el.querySelector('.sml-text-content');
      if (!content) return;
      var style = window.getComputedStyle(el);
      var size = parseFloat(style.fontSize) || 12;
      var minSize = 7;
      var guard = 0;
      while (content.scrollWidth > el.clientWidth + 1 && size > minSize && guard < 24) {
        size -= 0.5;
        el.style.fontSize = size + 'px';
        guard += 1;
      }
    });
  }
  window.addEventListener("load", function () {
    fitSmlPrintText();
    ${autoPrint ? 'setTimeout(function(){window.print()},350);' : ''}
  });
</script>
</body>
</html>`;
}

module.exports = {
  decodeZipEntry,
  parseFormDesign,
  renderSalePrintHtml,
  formatThaiBaht,
  formatThaiDate,
};
