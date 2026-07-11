'use strict';

// ESC/POS command bytes
const CMD = {
  INIT: Buffer.from([0x1b, 0x40]),
  CODEPAGE_874: Buffer.from([0x1b, 0x74, 0x15]), // Windows-874 / TIS-620 (Thai)
  ALIGN_LEFT: Buffer.from([0x1b, 0x61, 0x00]),
  ALIGN_CENTER: Buffer.from([0x1b, 0x61, 0x01]),
  ALIGN_RIGHT: Buffer.from([0x1b, 0x61, 0x02]),
  BOLD_ON: Buffer.from([0x1b, 0x45, 0x01]),
  BOLD_OFF: Buffer.from([0x1b, 0x45, 0x00]),
  DOUBLE_WH: Buffer.from([0x1d, 0x21, 0x11]), // double width + height
  DOUBLE_H: Buffer.from([0x1d, 0x21, 0x01]), // double height only
  NORMAL_SIZE: Buffer.from([0x1d, 0x21, 0x00]),
  LF: Buffer.from([0x0a]),
  CUT: Buffer.from([0x1d, 0x56, 0x41, 0x03]), // partial cut with feed
};

const COLS = 48; // 80mm paper at 12 CPI = 48 columns

// TIS-620 / Windows-874 encoder — no external library needed.
// Thai Unicode block U+0E00-U+0E7F maps directly to 0xA0-0xFF in TIS-620.
function encodeTis620(text) {
  const out = [];
  for (const ch of String(text || '')) {
    const cp = ch.charCodeAt(0);
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp >= 0x0e00 && cp <= 0x0e7f) {
      out.push(cp - 0x0e00 + 0xa0);
    }
    // characters outside ASCII and Thai block are skipped
  }
  return Buffer.from(out);
}

function lf(n = 1) {
  return Buffer.concat(Array(n).fill(CMD.LF));
}

// Right-justify a number string within `width` chars
function fmtAmt(value, width = 10) {
  const s = Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return s.padStart(width);
}

// Left text + right text padded to totalWidth
function padRow(left, right, totalWidth = COLS) {
  const gap = totalWidth - left.length - right.length;
  return left + ' '.repeat(Math.max(1, gap)) + right;
}

function separator() {
  return encodeTis620('-'.repeat(COLS));
}

function thaiDate(dateStr) {
  if (!dateStr) return '';
  // dateStr can be ISO or DD/MM/YYYY — normalise to DD/MM/YYYY (Buddhist era optional)
  const d = new Date(dateStr);
  if (isNaN(d)) return String(dateStr).substring(0, 10);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Build ESC/POS receipt bytes from saleData returned by loadSaleDocument().
 * Also expects saleData.header.pay_cash_amount and saleData.header.money_change
 * (fetched separately from cb_trans).
 *
 * Returns a hex string ready for window.bizsuitDevices.printRawHex().
 */
function buildThermalReceiptHex({ header, company, details, payments }) {
  const parts = [];

  const push = (...buffers) => parts.push(...buffers);
  const pushText = (text) => parts.push(encodeTis620(text));

  // --- Init ---
  push(CMD.INIT, CMD.CODEPAGE_874);

  // --- Shop header (centered, double-width) ---
  push(CMD.ALIGN_CENTER, CMD.BOLD_ON, CMD.DOUBLE_WH);
  pushText(String(company.name_1 || '').substring(0, 24));
  push(lf(), CMD.NORMAL_SIZE, CMD.BOLD_OFF);

  if (company.address) {
    pushText(String(company.address).substring(0, COLS));
    push(lf());
  }
  if (company.telephone_text) {
    pushText(company.telephone_text.substring(0, COLS));
    push(lf());
  }
  if (company.tax_text) {
    pushText(company.tax_text.substring(0, COLS));
    push(lf());
  }

  // --- Separator ---
  push(CMD.ALIGN_LEFT);
  push(separator(), lf());

  // --- Doc info ---
  const docDate = thaiDate(header.doc_date);
  const docTime = String(header.doc_time || '').substring(0, 5);
  const dateStr = [docDate, docTime].filter(Boolean).join(' ');
  pushText(padRow(`เลขที่: ${String(header.doc_no || '')}`, dateStr));
  push(lf());

  if (header.name_1) {
    pushText(`ลูกค้า: ${String(header.name_1).substring(0, COLS - 8)}`);
    push(lf());
  }

  // --- Column headers ---
  push(separator(), lf());
  push(CMD.BOLD_ON);
  // name(28) qty(5) price(8) subtotal(7)
  pushText('รายการ'.padEnd(28) + 'จน.'.padStart(5) + 'ราคา'.padStart(8) + 'รวม'.padStart(7));
  push(lf(), CMD.BOLD_OFF);
  push(separator(), lf());

  // --- Detail rows ---
  for (const row of details) {
    if (!row.item_code || row.item_code === '.') continue;
    const name = String(row.item_name || row.item_code || '').substring(0, 28).padEnd(28);
    const qty = fmtAmt(row.qty, 5);
    const price = fmtAmt(row.price, 8);
    const subtotal = fmtAmt(row.sum_amount, 7);
    pushText(name + qty + price + subtotal);
    push(lf());
  }

  // --- Totals ---
  push(separator(), lf());
  push(CMD.ALIGN_RIGHT);

  const totalValue = Number(header.total_value || header.total_before_vat || 0);
  const totalDiscount = Number(header.total_discount || 0);
  const totalVat = Number(header.total_vat_value || 0);
  const totalAmount = Number(header.total_amount || 0);

  pushText(padRow('รวมก่อนส่วนลด', fmtAmt(totalValue)));
  push(lf());

  if (totalDiscount > 0) {
    pushText(padRow('ส่วนลด', fmtAmt(totalDiscount)));
    push(lf());
  }

  if (totalVat > 0) {
    pushText(padRow('ภาษีมูลค่าเพิ่ม 7%', fmtAmt(totalVat)));
    push(lf());
  }

  // Grand total — double height for emphasis
  push(CMD.BOLD_ON, CMD.DOUBLE_H);
  pushText(padRow('ยอดรวมสุทธิ', fmtAmt(totalAmount)));
  push(lf(), CMD.NORMAL_SIZE, CMD.BOLD_OFF);

  // --- Payment rows ---
  push(CMD.ALIGN_LEFT);
  push(separator(), lf());

  for (const pay of payments || []) {
    const labels = String(pay.trans_number || '').split('\n');
    const amounts = String(pay.amount || '').split('\n');
    for (let i = 0; i < labels.length; i++) {
      const label = (labels[i] || '').trim();
      const amount = (amounts[i] || '').trim();
      if (label || amount) {
        pushText(padRow(label, amount.padStart(10)));
        push(lf());
      }
    }
  }

  const payCash = Number(header.pay_cash_amount || 0);
  const change = Number(header.money_change || 0);
  if (payCash > 0) {
    pushText(padRow('รับเงิน', fmtAmt(payCash)));
    push(lf());
  }
  if (change > 0) {
    pushText(padRow('เงินทอน', fmtAmt(change)));
    push(lf());
  }

  // --- Footer ---
  push(separator(), lf());
  push(CMD.ALIGN_CENTER);
  pushText('ขอบคุณที่ใช้บริการ');
  push(lf(4));

  // --- Cut ---
  push(CMD.CUT);

  return Buffer.concat(parts).toString('hex');
}

module.exports = { buildThermalReceiptHex };
