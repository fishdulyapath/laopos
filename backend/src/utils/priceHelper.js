// เลียนแบบ getProductPriceLocalx() ใน RestService.java บรรทัด 4642–5165
// sequential queries, ผลลัพธ์มี roworder field จาก DB จริง

const { pool } = require('../db');

function normalizeCurrencyCode(value) {
  return String(value || '').trim().toUpperCase();
}

// คืนวันปัจจุบันรูปแบบ YYYY-MM-DD ตาม local timezone
// (toISOString จะให้ UTC ทำให้ช่วง 00:00–06:59 ตามเวลาไทยได้วันก่อนหน้า)
function todayLocalDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function toNumber(value, fallback = 0) {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBool(value) {
  if (typeof value === 'boolean') return value;
  const text = cleanText(value).toLowerCase();
  return text === '1' || text === 'true' || text === 'yes' || text === 'y';
}

async function getColumnSet(client, tableName) {
  try {
    const result = await client.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = $1`,
      [tableName]
    );
    return new Set(result.rows.map((row) => row.column_name));
  } catch (_) {
    return new Set();
  }
}

function numericColumn(columns, alias, column, fallback = 0) {
  return columns.has(column)
    ? `COALESCE(NULLIF(${alias}.${column}::text, '')::numeric, ${fallback}) AS ${column}`
    : `${fallback}::numeric AS ${column}`;
}

function textColumn(columns, alias, column, fallback = "''") {
  return columns.has(column)
    ? `COALESCE(${alias}.${column}::text, '') AS ${column}`
    : `${fallback} AS ${column}`;
}

function pickPosBarcodePrices(row, priceNumber) {
  const level = Number(priceNumber) || 1;
  if (level === 2) return { normal: toNumber(row.price_2), member: toNumber(row.price_member_2) };
  if (level === 3) return { normal: toNumber(row.price_3), member: toNumber(row.price_member_3) };
  if (level === 4) return { normal: toNumber(row.price_4), member: toNumber(row.price_member_4) };
  return { normal: toNumber(row.price), member: toNumber(row.price_member) };
}

function parsePosDiscountWord(word, { keepCommaInDiscount = false } = {}) {
  const text = cleanText(word);
  if (!text) return null;
  if (!text.startsWith('#')) return { price: null, discountWord: text };
  const body = text.slice(1);
  const commaIndex = body.indexOf(',');
  const priceText = commaIndex === -1 ? body : body.slice(0, commaIndex);
  const discountWord = commaIndex === -1
    ? ''
    : body.slice(keepCommaInDiscount ? commaIndex : commaIndex + 1).trim();
  return { price: toNumber(priceText), discountWord };
}

function buildPosDiscountApply({ word, discountNumber, priceLabel, discountLabel, currentPrice, keepCommaInDiscount = false }) {
  const parsed = parsePosDiscountWord(word, { keepCommaInDiscount });
  if (!parsed) return null;
  const hasOverridePrice = parsed.price !== null;
  const price = hasOverridePrice ? parsed.price : currentPrice;
  const discountWord = parsed.discountWord || '';
  return {
    price,
    discount_word: discountWord,
    defaultDiscount: discountWord,
    discount_number: discountNumber,
    price_info: hasOverridePrice && !discountWord
      ? `${priceLabel} ${price}`
      : `${discountLabel} ${discountWord}`.trim(),
    found_price: true,
  };
}

function createEmptyPosPriceRow(source = 'pos_fallback') {
  return {
    price: 0,
    price1: 0,
    price2: 0,
    mode: -1,
    type: -1,
    roworder: -1,
    price_type: -1,
    price_mode: -1,
    defaultDiscount: '',
    discount_word: '',
    discount_number: 0,
    price_info: '',
    price_default: 0,
    found_price: false,
    foundPrice: false,
    foundByCondition: false,
    _price: 0,
    _price1: 0,
    _price2: 0,
    _type: -1,
    _mode: -1,
    _roworder: -1,
    _discountNumber: 0,
    _discountWord: '',
    _price_info: '',
    _foundPrice: false,
    _foundByCondition: false,
    source,
  };
}

async function getPriceCenterPos({
  priceListServer = '',
  branchCode = '',
  itemCode = '',
  unitCode = '',
  qty = '1',
  custCode = '',
  docDate = '',
} = {}) {
  if (typeof fetch !== 'function') return createEmptyPosPriceRow('pos_price_center');
  const serverText = cleanText(priceListServer);
  if (!serverText) return createEmptyPosPriceRow('pos_price_center');

  const splitIndex = serverText.indexOf('?');
  const baseServer = splitIndex === -1 ? serverText : serverText.slice(0, splitIndex);
  const serverParameter = splitIndex === -1 ? '' : serverText.slice(splitIndex + 1);
  const normalizedBase = /^https?:\/\//i.test(baseServer) ? baseServer : `http://${baseServer}`;
  const params = new URLSearchParams();
  params.set('item_code', itemCode);
  params.set('unit_code', unitCode);
  params.set('qty', String(qty));
  if (cleanText(custCode)) params.set('cust_code', cleanText(custCode));
  params.set('doc_date', docDate);
  params.set('sale_type', '1');
  params.set('vat_type', '2');
  if (serverParameter) {
    for (const part of serverParameter.split('&')) {
      const [key, ...valueParts] = part.split('=');
      if (key) params.set(key, valueParts.join('='));
    }
  }
  params.set('branch', cleanText(branchCode));

  const urls = [
    `${normalizedBase}/SMLPriceCenter/pricelistservice/price?${params.toString()}`,
    `${normalizedBase}/SMLJavaRESTService/service/pricelist/price?${params.toString()}`,
  ];

  for (const url of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) continue;
      const json = await response.json();
      const price = toNumber(json?.price);
      if (price === 0) return createEmptyPosPriceRow('pos_price_center');
      return {
        ...createEmptyPosPriceRow('pos_price_center'),
        price,
        mode: 99,
        type: 99,
        roworder: -1,
        price_type: 99,
        price_mode: 99,
        price_info: cleanText(json?.price_info),
        price_guid: cleanText(json?.price_guid),
        price_default: price,
        found_price: true,
        foundPrice: true,
        _price: price,
        _type: 99,
        _mode: 99,
        _price_info: cleanText(json?.price_info),
        _price_guid: cleanText(json?.price_guid),
        _foundPrice: true,
      };
    } catch (_) {
      // Try legacy URL next, matching the C# fallback path.
    } finally {
      clearTimeout(timer);
    }
  }

  return createEmptyPosPriceRow('pos_price_center');
}

// เลียนแบบ myglobal._calcFormulaPrice()
function calcFormulaPrice(qty, price, formula) {
  let newPrice = price;
  if (!formula || formula.trim().length === 0) return price;

  const first = formula.trim().charAt(0);
  if (first === '=' || first === '-' || first === '+') {
    const parts = formula.split(',');
    if (parts.length > 0) {
      const valStr = parts[0].replace(/^[=+\-]/, '');
      if (first === '=') {
        newPrice = valStr;
      } else if (first === '-') {
        newPrice = String(parseFloat(newPrice) - parseFloat(valStr));
      } else if (first === '+') {
        newPrice = String(parseFloat(newPrice) + parseFloat(valStr));
      }
    }
  } else {
    newPrice = formula;
  }
  return newPrice;
}


async function getProductPriceLocalx(
  icCode,
  unitCode,
  qty,
  custCode,
  vatType = 0,
  vatRate = null,
  saleType = 0,
  barcode = '',
  docDate = null,
  currencyCode = ''
) {
  const today = docDate || todayLocalDate();
  const qtyVal = (!qty || qty === '0' || qty === 0) ? 1 : (parseInt(qty) || 1);
  const vatTypeVal = parseInt(vatType, 10);
  const isVatExcluded = vatTypeVal === 0;
  const saleTypeVal = parseInt(saleType, 10);
  const saleTypeSecondary = (saleTypeVal === 0 || saleTypeVal === 2) ? 2 : 1;
  const saleTypeInClause = `(0,${saleTypeSecondary})`;
  let formulaSaleTypeInClause = '(0)';
  if (saleTypeVal === 0) {
    formulaSaleTypeInClause = '(0,2)';
  } else if (saleTypeVal === 1) {
    formulaSaleTypeInClause = '(0,1)';
  }

  let formulaTaxTypeInClause = '(0)';
  if (vatTypeVal === 0) {
    formulaTaxTypeInClause = '(0,1)';
  } else if (vatTypeVal === 1) {
    formulaTaxTypeInClause = '(0,2)';
  } else if (vatTypeVal === 2 || vatTypeVal === 3) {
    formulaTaxTypeInClause = '(0,3)';
  }

  let whereInventoryPriceCurrency = '';
  let whereInventoryPriceFormulaCurrency = '';
  const hasCurrency = String(currencyCode || '').trim().length > 0;
  let homeCurrencyCode = '';
  let useCurrencyFilter = false;

  const client = await pool.connect();
  const res = { success: false, data: [] };

  try {
    // โหลด erp_option
    let get_last_price_type = 0;
    let ic_price_formula_control = 0;
    let defaultVatRate = 0;
    try {
      const optRes = await client.query('SELECT get_last_price_type, ic_price_formula_control FROM erp_option LIMIT 1');
      if (optRes.rows.length > 0) {
        get_last_price_type = optRes.rows[0].get_last_price_type || 0;
        ic_price_formula_control = optRes.rows[0].ic_price_formula_control || 0;
      }
    } catch (_) {}

    if (hasCurrency) {
      try {
        const homeCurrencyRes = await client.query("SELECT COALESCE(home_currency,'') AS home_currency FROM erp_option LIMIT 1");
        homeCurrencyCode = normalizeCurrencyCode(homeCurrencyRes.rows[0]?.home_currency);
        useCurrencyFilter = homeCurrencyCode.length > 0;
        if (useCurrencyFilter) {
          whereInventoryPriceCurrency = `
           AND (
             COALESCE(price_currency,0)=0
             OR (upper(trim(COALESCE(currency_code,'')))=$6 AND COALESCE(price_currency,0)=1)
           )`;
          whereInventoryPriceFormulaCurrency = `
             AND (
               COALESCE(price_currency,0)=0
               OR (upper(trim(COALESCE(currency_code,'')))=$3 AND COALESCE(price_currency,0)=1)
             )`;
        }
      } catch (_) {}
    }

    try {
      const vatRateColRes = await client.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_name='erp_option' AND column_name IN ('vat_rate','default_vat_rate','sale_vat_rate')
         ORDER BY CASE column_name
           WHEN 'vat_rate' THEN 1
           WHEN 'default_vat_rate' THEN 2
           WHEN 'sale_vat_rate' THEN 3
           ELSE 99 END
         LIMIT 1`
      );
      if (vatRateColRes.rows.length > 0) {
        const vatCol = vatRateColRes.rows[0].column_name;
        const vatRes = await client.query(`SELECT COALESCE(${vatCol},0) AS vat_rate FROM erp_option LIMIT 1`);
        if (vatRes.rows.length > 0) {
          defaultVatRate = parseFloat(vatRes.rows[0].vat_rate) || 0;
        }
      }
    } catch (_) {}

    let foundPrice = false;
    let foundByCondition = false;
    const tmpList = {};

    // Query 0: ราคาตามลูกค้า (price_type=3)
    try {
      const r0 = await client.query(
        `SELECT roworder, sale_price1, sale_price2, price_mode, price_type
         FROM ic_inventory_price
         WHERE ic_code=$1 AND unit_code=$2 AND cust_code=$3 AND price_type=3
           AND ($4::date BETWEEN from_date AND to_date)
           AND ($5::numeric BETWEEN from_qty AND to_qty)
           AND sale_type IN ${saleTypeInClause}
           ${whereInventoryPriceCurrency}
           ORDER BY price_mode DESC, sale_type DESC, transport_type DESC
           LIMIT 1`,
        useCurrencyFilter
          ? [icCode, unitCode, custCode, today, qtyVal, homeCurrencyCode]
          : [icCode, unitCode, custCode, today, qtyVal]
      );
      if (r0.rows.length > 0) {
        const r = r0.rows[0];
        foundPrice = true;
        foundByCondition = true;
        tmpList.price1 = r.sale_price1;
        tmpList.price2 = r.sale_price2;
        tmpList.price = isVatExcluded ? r.sale_price1 : r.sale_price2;
        tmpList.mode = r.price_mode;
        tmpList.roworder = String(r.roworder || 0);
        tmpList.type = '1';
      }
    } catch (_) {}

    // Query 1: ราคาตามกลุ่มลูกค้า (price_type=2)
    if (!foundByCondition) {
      try {
        const r1 = await client.query(
          `SELECT roworder, sale_price1, sale_price2, price_mode, price_type
           FROM ic_inventory_price
           WHERE ic_code=$1 AND unit_code=$2 AND price_type=2
             AND cust_group_1=(SELECT group_main FROM ar_customer_detail WHERE ar_code=$3)
             AND (
               cust_group_2=(SELECT group_sub_1 FROM ar_customer_detail WHERE ar_code=$3)
               OR cust_group_2=(SELECT group_sub_1 FROM ar_customer_detail WHERE ar_code=$3)
               OR cust_group_2=(SELECT group_sub_3 FROM ar_customer_detail WHERE ar_code=$3)
               OR cust_group_2=(SELECT group_sub_4 FROM ar_customer_detail WHERE ar_code=$3)
               OR COALESCE(cust_group_2,'')=''
             )
             AND ($4::date BETWEEN from_date AND to_date)
             AND ($5::numeric BETWEEN from_qty AND to_qty)
             AND sale_type IN ${saleTypeInClause}
             ${whereInventoryPriceCurrency}
           ORDER BY price_mode DESC, sale_type DESC, transport_type DESC, cust_group_2
           LIMIT 1`,
          useCurrencyFilter
            ? [icCode, unitCode, custCode, today, qtyVal, homeCurrencyCode]
            : [icCode, unitCode, custCode, today, qtyVal]
        );
        if (r1.rows.length > 0) {
          const r = r1.rows[0];
          foundPrice = true;
          foundByCondition = true;
          tmpList.price1 = r.sale_price1;
          tmpList.price2 = r.sale_price2;
          tmpList.price = isVatExcluded ? r.sale_price1 : r.sale_price2;
          tmpList.mode = r.price_mode;
          tmpList.roworder = String(r.roworder || 0);
          tmpList.type = '2';
        }
      } catch (_) {}
    }

    // Query 2: ราคาขายทั่วไป (price_type=1, price_mode=1)
    if (!foundByCondition) {
      try {
        const wherePriceCurrency2 = useCurrencyFilter ? `
           AND (
             COALESCE(price_currency,0)=0
             OR (upper(trim(COALESCE(currency_code,'')))=$5 AND COALESCE(price_currency,0)=1)
           )` : '';
        const r2 = await client.query(
          `SELECT roworder, sale_price1, sale_price2, price_mode, price_type
           FROM ic_inventory_price
           WHERE ic_code=$1 AND unit_code=$2 AND price_type=1 AND price_mode=1
             AND ($3::date BETWEEN from_date AND to_date)
             AND ($4::numeric BETWEEN from_qty AND to_qty)
             AND sale_type IN ${saleTypeInClause}
             ${wherePriceCurrency2}
             ORDER BY price_mode DESC, sale_type DESC, transport_type DESC
             LIMIT 1`,
          useCurrencyFilter
            ? [icCode, unitCode, today, qtyVal, homeCurrencyCode]
            : [icCode, unitCode, today, qtyVal]
        );
        if (r2.rows.length > 0) {
          const r = r2.rows[0];
          foundPrice = true;
          foundByCondition = true;
          tmpList.price1 = r.sale_price1;
          tmpList.price2 = r.sale_price2;
          tmpList.price = isVatExcluded ? r.sale_price1 : r.sale_price2;
          tmpList.mode = r.price_mode;
          tmpList.roworder = String(r.roworder || 0);
          tmpList.type = '3';
        }
      } catch (_) {}
    }

    // Query 3: ราคามาตราฐาน (price_type=1, price_mode=0)
    if (!foundByCondition) {
      try {
        const wherePriceCurrency3 = useCurrencyFilter ? `
           AND (
             COALESCE(price_currency,0)=0
             OR (upper(trim(COALESCE(currency_code,'')))=$5 AND COALESCE(price_currency,0)=1)
           )` : '';
        const r3 = await client.query(
          `SELECT roworder, sale_price1, sale_price2, price_mode, price_type
           FROM ic_inventory_price
           WHERE ic_code=$1 AND unit_code=$2 AND price_type=1 AND price_mode=0
             AND ($3::date BETWEEN from_date AND to_date)
             AND ($4::numeric BETWEEN from_qty AND to_qty)
             AND sale_type IN ${saleTypeInClause}
             ${wherePriceCurrency3}
             ORDER BY price_mode DESC, sale_type DESC, transport_type DESC
             LIMIT 1`,
          useCurrencyFilter
            ? [icCode, unitCode, today, qtyVal, homeCurrencyCode]
            : [icCode, unitCode, today, qtyVal]
        );
        if (r3.rows.length > 0) {
          const r = r3.rows[0];
          foundPrice = true;
          foundByCondition = true;
          tmpList.price1 = r.sale_price1;
          tmpList.price2 = r.sale_price2;
          tmpList.price = isVatExcluded ? r.sale_price1 : r.sale_price2;
          tmpList.mode = r.price_mode;
          tmpList.roworder = String(r.roworder || 0);
          tmpList.type = '3';
        }
      } catch (_) {}
    }

    // Query 4+5: ราคาตามสูตร (formula)
    if (!foundPrice) {
      try {
        let priceLevel = 0;
        const r4 = await client.query(
          'SELECT price_level FROM ar_customer WHERE code=$1',
          [custCode]
        );
        if (r4.rows.length > 0) priceLevel = r4.rows[0].price_level || 0;

        // strResultVatType = "0,2,3" (ภาษีรวมใน case fallthrough → adds ,2 then ,3)
        // strResultSaleType = "0,2" (saleType=0)
        const r5 = await client.query(
          `SELECT * FROM ic_inventory_price_formula
           WHERE ic_code=$1 AND unit_code=$2
             AND sale_type IN ${formulaSaleTypeInClause}
             AND COALESCE(tax_type,0) IN ${formulaTaxTypeInClause}
             ${whereInventoryPriceFormulaCurrency}
           ORDER BY sale_type DESC LIMIT 1`,
          useCurrencyFilter ? [icCode, unitCode, homeCurrencyCode] : [icCode, unitCode]
        );
        if (r5.rows.length > 0) {
          const row = r5.rows[0];
          const strPriceStandard = row.price_0 || '';
          let strFormula = strPriceStandard;
          const level = parseInt(priceLevel) || 0;
          if (level >= 1 && level <= 9) {
            strFormula = row[`price_${level}`] || strPriceStandard;
          }
          const resultPrice = calcFormulaPrice(String(qtyVal), strPriceStandard, strFormula);
          foundPrice = true;
          tmpList.price = resultPrice;
          tmpList.price2 = resultPrice;
          tmpList.mode = '6';
          tmpList.roworder = '0';
          tmpList.type = '6';
        }
      } catch (_) {}
    }

    // barcode price fallback (เหมือน C#: ใช้ barcode input โดยตรง)
    if (!foundPrice && String(barcode).trim().length > 0) {
      try {
        const bcPriceRes = await client.query(
          'SELECT price FROM ic_inventory_barcode WHERE barcode=$1',
          [String(barcode).trim()]
        );
        if (bcPriceRes.rows.length > 0) {
          foundPrice = true;
          tmpList.price = bcPriceRes.rows[0].price;
          tmpList.price2 = bcPriceRes.rows[0].price;
          tmpList.mode = '5';
          tmpList.roworder = '0';
          tmpList.type = '5';
        }
      } catch (_) {}
    }

    // Last price (get_last_price_type=1: latest, =2: average)
    if (!foundPrice && get_last_price_type !== 0) {
      try {
        let lastSql = '';
        if (get_last_price_type === 1) {
          lastSql = `SELECT price_exclude_vat,
            price,
            (SELECT vat_type FROM ic_trans
              WHERE ic_trans.doc_no = ic_trans_detail.doc_no
                AND ic_trans.trans_flag = ic_trans_detail.trans_flag) AS vat_type
            FROM ic_trans_detail
            WHERE cust_code=$1 AND item_code=$2 AND unit_code=$3
              AND last_status=0 AND trans_flag=44 AND price_exclude_vat>0
            ORDER BY doc_date DESC, doc_time DESC LIMIT 1`;
        } else if (get_last_price_type === 2) {
          lastSql = `SELECT SUM(price_exclude_vat)/COUNT(*) AS price_exclude_vat
            FROM ic_trans_detail
            WHERE cust_code=$1 AND item_code=$2 AND unit_code=$3
              AND last_status=0 AND trans_flag=44 AND price_exclude_vat>0`;
        }
        if (lastSql) {
          const lastRes = await client.query(lastSql, [custCode, icCode, unitCode]);
          const rows = lastRes.rows;
          if (rows.length > 0) {
            let p = parseFloat(rows[0].price_exclude_vat) || 0;
            const effectiveVatRate = Number.isFinite(parseFloat(vatRate))
              ? (parseFloat(vatRate) || 0)
              : defaultVatRate;
            if (vatTypeVal === 1 && effectiveVatRate > 0) {
              p = p + (p * (effectiveVatRate / 100));
            }
            if (
              vatTypeVal === 1 &&
              String(rows[0].vat_type || '') === '1' &&
              rows[0].price !== undefined &&
              rows[0].price !== null
            ) {
              p = parseFloat(rows[0].price) || p;
            }
            foundPrice = true;
            tmpList.price = String(p);
            tmpList.price2 = String(p);
            tmpList.mode = '5';
            tmpList.roworder = '0';
            tmpList.type = '7';
          }
        }
      } catch (_) {}
    }

    // formula_control: get stand_price if ic_price_formula_control=1 and foundPrice
    if (foundPrice && ic_price_formula_control === 1) {
      try {
        const fcRes = await client.query(
          `SELECT * FROM ic_inventory_price_formula
           WHERE ic_code=$1 AND unit_code=$2
             AND sale_type IN ${formulaSaleTypeInClause}
             AND COALESCE(tax_type,0) IN ${formulaTaxTypeInClause}
             ${whereInventoryPriceFormulaCurrency}
           ORDER BY sale_type DESC LIMIT 1`,
          useCurrencyFilter ? [icCode, unitCode, homeCurrencyCode] : [icCode, unitCode]
        );
        if (fcRes.rows.length > 0) {
          tmpList.stand_price = fcRes.rows[0].price_0 || '';
        }
      } catch (_) {}
    }

    // find discount (C#: customer -> group -> normal)
    let foundDiscount = false;
    // Discount Query 8: ลดตามลูกค้า (ic_inventory_discount, discount_type=2)
    if (!foundDiscount) {
      try {
        const dq8 = await client.query(
          `SELECT roworder, discount FROM ic_inventory_discount
           WHERE ic_code=$1 AND unit_code=$2 AND cust_code=$3 AND discount_type=2
             AND ($4::date BETWEEN from_date AND to_date)
             AND ($5::numeric BETWEEN from_qty AND to_qty)
             AND sale_type IN ${saleTypeInClause}
           ORDER BY line_number
           LIMIT 1`,
          [icCode, unitCode, custCode, today, qtyVal]
        );
        if (dq8.rows.length > 0) {
          foundDiscount = true;
          tmpList.defaultDiscount = dq8.rows[0].discount;
        }
      } catch (_) {}
    }

    // Discount Query 9: ลดตามกลุ่ม (ic_inventory_discount, discount_type=1)
    if (!foundDiscount) {
      try {
        const dq9 = await client.query(
          `SELECT roworder, discount FROM ic_inventory_discount
           WHERE ic_code=$1 AND unit_code=$2 AND discount_type=1
             AND cust_group_1=(SELECT group_main FROM ar_customer_detail WHERE ar_code=$3)
             AND (
               cust_group_2=(SELECT group_sub_1 FROM ar_customer_detail WHERE ar_code=$3)
               OR cust_group_2=(SELECT group_sub_1 FROM ar_customer_detail WHERE ar_code=$3)
               OR cust_group_2=(SELECT group_sub_3 FROM ar_customer_detail WHERE ar_code=$3)
               OR cust_group_2=(SELECT group_sub_4 FROM ar_customer_detail WHERE ar_code=$3)
               OR COALESCE(cust_group_2,'')=''
             )
             AND ($4::date BETWEEN from_date AND to_date)
             AND ($5::numeric BETWEEN from_qty AND to_qty)
             AND sale_type IN ${saleTypeInClause}
           ORDER BY roworder
           LIMIT 1`,
          [icCode, unitCode, custCode, today, qtyVal]
        );
        if (dq9.rows.length > 0) {
          foundDiscount = true;
          tmpList.defaultDiscount = dq9.rows[0].discount;
        }
      } catch (_) {}
    }

        // Discount Query 10: ลดทั่วไป (ic_inventory_discount, discount_type=0)
    if (!foundDiscount) {
      try {
        const dq10 = await client.query(
          `SELECT roworder, discount FROM ic_inventory_discount
           WHERE ic_code=$1 AND unit_code=$2 AND discount_type=0
             AND ($3::date BETWEEN from_date AND to_date)
             AND ($4::numeric BETWEEN from_qty AND to_qty)
             AND sale_type IN ${saleTypeInClause}
           ORDER BY line_number
           LIMIT 1`,
          [icCode, unitCode, today, qtyVal]
        );
        if (dq10.rows.length > 0) {
          foundDiscount = true;
          tmpList.defaultDiscount = dq10.rows[0].discount;
        }
      } catch (_) {}
    }


    res.success = true;
    if (foundPrice || Object.keys(tmpList).length > 0) {
      tmpList.found_price = foundPrice;
      tmpList.foundPrice = foundPrice;
      tmpList.foundByCondition = foundByCondition;
      tmpList._foundPrice = foundPrice;
      tmpList._foundByCondition = foundByCondition;
      res.data = [tmpList];
    }
    return res;
  } finally {
    client.release();
  }
}

async function getPricePos({
  itemCode = '',
  barcode = '',
  unitCode = '',
  qty = '1',
  custCode = '',
  memberCode = '',
  priceNumber = 1,
  isStaff = false,
  posId = '',
  branchCode = '',
  defaultCustCode = '',
  docDate = null,
  currencyCode = 'LAK',
} = {}) {
  const today = docDate || todayLocalDate();
  const qtyVal = (!qty || qty === '0' || qty === 0) ? 1 : (toNumber(qty, 1) || 1);
  const barcodeText = cleanText(barcode);
  const itemCodeText = cleanText(itemCode);
  const unitCodeText = cleanText(unitCode);
  const custCodeText = cleanText(custCode);
  const memberCodeText = cleanText(memberCode);
  const defaultCustText = cleanText(defaultCustCode);
  const hasMember = memberCodeText.length > 0 && memberCodeText !== defaultCustText;
  const staff = toBool(isStaff);
  const posText = cleanText(posId);
  let branchText = cleanText(branchCode);

  let posRow = null;
  let fallbackItemCode = itemCodeText;
  let fallbackUnitCode = unitCodeText;
  let fallbackBarcode = barcodeText;
  let usePriceCenter = false;
  let priceListServer = '';

  const client = await pool.connect();
  try {
    const barcodeColumns = await getColumnSet(client, 'ic_inventory_barcode');
    const inventoryColumns = await getColumnSet(client, 'ic_inventory');
    const detailColumns = await getColumnSet(client, 'ic_inventory_detail');
    const formulaColumns = await getColumnSet(client, 'ic_inventory_price_formula');

    const selectSql = `
      SELECT
        b.barcode,
        b.ic_code AS item_code,
        COALESCE(NULLIF(b.unit_code::text, ''), $2::text, '') AS unit_code,
        COALESCE(i.name_1, '') AS item_name,
        COALESCE(NULLIF(i.item_type::text, '')::numeric, 0) AS item_type,
        COALESCE(NULLIF(i.tax_type::text, '')::numeric, 0) AS tax_type,
        ${numericColumn(barcodeColumns, 'b', 'price')},
        ${numericColumn(barcodeColumns, 'b', 'price_2')},
        ${numericColumn(barcodeColumns, 'b', 'price_3')},
        ${numericColumn(barcodeColumns, 'b', 'price_4')},
        ${numericColumn(barcodeColumns, 'b', 'price_member')},
        ${numericColumn(barcodeColumns, 'b', 'price_member_2')},
        ${numericColumn(barcodeColumns, 'b', 'price_member_3')},
        ${numericColumn(barcodeColumns, 'b', 'price_member_4')},
        ${textColumn(barcodeColumns, 'b', 'hidden_text')},
        COALESCE(NULLIF(u.stand_value::text, '')::numeric, NULLIF(i.unit_standard_stand_value::text, '')::numeric, 1) AS stand_value,
        COALESCE(NULLIF(u.divide_value::text, '')::numeric, NULLIF(i.unit_standard_divide_value::text, '')::numeric, 1) AS divide_value,
        COALESCE(NULLIF(u.ratio::text, '')::numeric, CASE WHEN COALESCE(NULLIF(i.unit_standard_divide_value::text, '')::numeric, 1) <> 0
          THEN COALESCE(NULLIF(i.unit_standard_stand_value::text, '')::numeric, 1) / COALESCE(NULLIF(i.unit_standard_divide_value::text, '')::numeric, 1)
          ELSE 1 END)::numeric AS ratio,
        ${detailColumns.has('have_point') ? "COALESCE(NULLIF(d.have_point::text, '')::numeric, 0)" : '0'} AS have_point,
        ${detailColumns.has('no_discount') ? "COALESCE(NULLIF(d.no_discount::text, '')::numeric, 0)" : '0'} AS no_discount,
        ${detailColumns.has('drink_type') ? "COALESCE(NULLIF(d.drink_type::text, '')::numeric, 0)" : '0'} AS drink_type,
        ${inventoryColumns.has('balance_control') ? "COALESCE(NULLIF(i.balance_control::text, '')::numeric, 0)" : '0'} AS balance_control,
        ${inventoryColumns.has('pos_no_sum') ? "COALESCE(NULLIF(i.pos_no_sum::text, '')::numeric, 0)" : '0'} AS pos_no_sum,
        ${inventoryColumns.has('is_hold_sale') ? "COALESCE(NULLIF(i.is_hold_sale::text, '')::numeric, 0)" : '0'} AS is_hold_sale,
        ${formulaColumns.has('price_0') ? "COALESCE(NULLIF(f.price_0::text, '')::numeric, 0)" : '0'} AS price_base
      FROM ic_inventory_barcode b
      LEFT JOIN ic_inventory i ON i.code = b.ic_code
      LEFT JOIN ic_inventory_detail d ON d.ic_code = b.ic_code
      LEFT JOIN ic_unit_use u ON u.ic_code = b.ic_code AND u.code::text = COALESCE(NULLIF(b.unit_code::text, ''), $2::text, '')
      LEFT JOIN ic_inventory_price_formula f ON f.ic_code = b.ic_code AND f.unit_code::text = COALESCE(NULLIF(b.unit_code::text, ''), $2::text, '')
    `;

    let barcodeResult = { rows: [] };
    if (barcodeText) {
      barcodeResult = await client.query(
        `${selectSql}
         WHERE b.barcode = $1
         ORDER BY b.barcode
         LIMIT 1`,
        [barcodeText, unitCodeText]
      );
    }

    if (barcodeResult.rows.length > 0) {
      const row = barcodeResult.rows[0];
      fallbackItemCode = cleanText(row.item_code) || fallbackItemCode;
      fallbackUnitCode = cleanText(row.unit_code) || fallbackUnitCode;
      fallbackBarcode = cleanText(row.barcode) || fallbackBarcode;

      const priceColumns = await getColumnSet(client, 'ic_inventory_barcode_price');
      const discountConditions = [];
      if (priceColumns.has('date_begin') && priceColumns.has('date_end')) {
        discountConditions.push(`$2::date BETWEEN date_begin AND date_end`);
      }
      if (priceColumns.has('status')) {
        discountConditions.push(`COALESCE(status, 0) = 1`);
      }
      if (priceColumns.has('qty_begin') && priceColumns.has('qty_end')) {
        discountConditions.push(`$3::numeric BETWEEN qty_begin AND qty_end`);
      }
      if (priceColumns.has('lock_discount') && priceColumns.has('lock_code_list')) {
        discountConditions.push(`((COALESCE(lock_discount, 0) = 0) OR (COALESCE(lock_discount, 0) = 1 AND COALESCE(lock_code_list, '') LIKE $4))`);
      }
      if (priceColumns.has('lock_day')) {
        const dayOfWeek = new Date(`${today}T00:00:00`).getDay();
        discountConditions.push(`((COALESCE(lock_day, '') = '') OR (COALESCE(lock_day, '') LIKE '%${dayOfWeek}%'))`);
      }

      let discountRows = [];
      if (priceColumns.has('discount_word') && priceColumns.has('discount_type')) {
        try {
          const discountResult = await client.query(
            `SELECT discount_word, discount_type
             FROM ic_inventory_barcode_price
             WHERE barcode = $1
               ${discountConditions.length ? `AND ${discountConditions.join('\n               AND ')}` : ''}
             ORDER BY discount_type, ${priceColumns.has('priority') ? 'priority' : 'discount_type'}`,
            [fallbackBarcode, today, qtyVal, `%${posText}%`]
          );
          discountRows = discountResult.rows;
        } catch (_) {
          discountRows = [];
        }
      }

      const firstDiscountByType = new Map();
      for (const discountRow of discountRows) {
        const type = Number(discountRow.discount_type) || 0;
        if (!firstDiscountByType.has(type)) firstDiscountByType.set(type, cleanText(discountRow.discount_word));
      }

      const { normal: normalPrice, member: memberPrice } = pickPosBarcodePrices(row, priceNumber);
      let selected = null;
      if (hasMember && staff && firstDiscountByType.get(5)) {
        selected = buildPosDiscountApply({
          word: firstDiscountByType.get(5),
          discountNumber: 5,
          priceLabel: 'ราคาพนักงาน',
          discountLabel: 'ส่วนลดพนักงาน',
          currentPrice: normalPrice,
        });
      }
      if (!selected && hasMember && firstDiscountByType.get(2)) {
        selected = buildPosDiscountApply({
          word: firstDiscountByType.get(2),
          discountNumber: 2,
          priceLabel: 'ราคาพิเศษ+สมาชิก',
          discountLabel: 'ส่วนลดพิเศษ+สมาชิก',
          currentPrice: normalPrice,
        });
      }
      if (!selected && firstDiscountByType.get(1)) {
        selected = buildPosDiscountApply({
          word: firstDiscountByType.get(1),
          discountNumber: 1,
          priceLabel: 'ราคาพิเศษ+โปรโมชั่น',
          discountLabel: 'ส่วนลดพิเศษ+โปรโมชั่น',
          currentPrice: normalPrice,
        });
      }
      if (!selected && hasMember && firstDiscountByType.get(4)) {
        selected = buildPosDiscountApply({
          word: firstDiscountByType.get(4),
          discountNumber: 4,
          priceLabel: 'ราคาสมาชิก',
          discountLabel: 'ส่วนลดสมาชิก',
          currentPrice: normalPrice,
        });
      }
      if (!selected && firstDiscountByType.get(3)) {
        selected = buildPosDiscountApply({
          word: firstDiscountByType.get(3),
          discountNumber: 3,
          priceLabel: 'ราคาโปรโมชั่น',
          discountLabel: 'ส่วนลดโปรโมชั่น',
          currentPrice: normalPrice,
          keepCommaInDiscount: true,
        });
      }
      if (!selected && hasMember && memberPrice > 0) {
        selected = {
          price: memberPrice,
          discount_word: '',
          defaultDiscount: '',
          discount_number: 0,
          price_info: `ราคาสมาชิก ${memberPrice}`,
          found_price: true,
          type: 7,
          price_type: 7,
        };
      }
      if (!selected && normalPrice > 0) {
        selected = {
          price: normalPrice,
          discount_word: '',
          defaultDiscount: '',
          discount_number: 0,
          price_info: `ราคาปรกติ ${normalPrice}`,
          found_price: true,
        };
      }

      if (selected?.found_price) {
        const priceType = Number(selected.type ?? selected.price_type ?? 5) || 5;
        posRow = {
          ...row,
          price: String(selected.price ?? 0),
          price1: 0,
          price2: 0,
          mode: -1,
          type: String(priceType),
          price_type: priceType,
          price_mode: -1,
          roworder: -1,
          defaultDiscount: selected.defaultDiscount || '',
          discount_word: selected.discount_word || '',
          discount_number: selected.discount_number || 0,
          price_info: selected.price_info || '',
          price_default: String(selected.price ?? 0),
          price_stand: row.price_base || 0,
          stand_price: row.price_base || 0,
          price_base: row.price_base || 0,
          price_normal: normalPrice,
          price_member: memberPrice,
          priceBarcodeNornal: row.price,
          priceBarcodeMember: row.price_member,
          priceBarcodeNornal2: row.price_2,
          priceBarcodeMember2: row.price_member_2,
          priceBarcodeNornal3: row.price_3,
          priceBarcodeMember3: row.price_member_3,
          priceBarcodeNornal4: row.price_4,
          priceBarcodeMember4: row.price_member_4,
          found_price: true,
          foundPrice: true,
          _price: String(selected.price ?? 0),
          _price1: 0,
          _price2: 0,
          _type: priceType,
          _mode: -1,
          _roworder: -1,
          _discountNumber: selected.discount_number || 0,
          _discountWord: selected.discount_word || '',
          _price_info: selected.price_info || '',
          _foundPrice: true,
          _foundByCondition: false,
          _stand_price: row.price_base || 0,
          source: 'pos_barcode',
          barcode_price_rows: discountRows,
          inventoryBarcodePriceTable: discountRows,
        };
      }
    }

    const optionResult = await client.query(
      `SELECT COALESCE(use_price_center, 0) AS use_price_center,
              COALESCE(price_list_server, '') AS price_list_server
       FROM erp_option
       LIMIT 1`
    ).catch(() => ({ rows: [] }));
    usePriceCenter = Number(optionResult.rows[0]?.use_price_center || 0) === 1;
    priceListServer = cleanText(optionResult.rows[0]?.price_list_server);

    if (usePriceCenter && !branchText && posText) {
      const branchResult = await client.query(
        `SELECT COALESCE(branch_code, '') AS branch_code
         FROM pos_id
         WHERE pos_id = $1
         LIMIT 1`,
        [posText]
      ).catch(() => ({ rows: [] }));
      branchText = cleanText(branchResult.rows[0]?.branch_code);
    }
  } finally {
    client.release();
  }

  if (posRow) {
    return { success: true, data: [posRow] };
  }

  if (usePriceCenter) {
    const centerRow = await getPriceCenterPos({
      priceListServer,
      branchCode: branchText,
      itemCode: itemCodeText,
      unitCode: unitCodeText,
      qty: String(qtyVal),
      custCode: custCodeText,
      docDate: today,
    });
    return { success: true, data: [centerRow] };
  }

  const fallback = await getProductPriceLocalx(
    fallbackItemCode,
    fallbackUnitCode,
    String(qtyVal),
    custCodeText,
    1,
    null,
    1,
    fallbackBarcode,
    today,
    currencyCode
  );
  const fallbackData = (fallback.data || []).map((row) => {
    const rowFound = row.found_price ?? row.foundPrice ?? row._foundPrice ?? false;
    const rowFoundByCondition = row.foundByCondition ?? row._foundByCondition ?? false;
    return {
      ...row,
      price_type: Number(row.type ?? row.price_type ?? 1) || 1,
      price_mode: Number(row.mode ?? row.price_mode ?? 0) || 0,
      price_info: row.price_info ?? row.mode ?? '',
      price_default: row.price ?? row.price_default ?? 0,
      price_stand: row.stand_price ?? row.price_stand ?? 0,
      discount_word: row.defaultDiscount || row.discount_word || '',
      discount_number: row.discount_number || 0,
      found_price: Boolean(rowFound),
      foundPrice: Boolean(rowFound),
      foundByCondition: Boolean(rowFoundByCondition),
      _price: row.price ?? 0,
      _price1: row.price1 ?? row.price_1 ?? 0,
      _price2: row.price2 ?? row.price_2 ?? 0,
      _type: Number(row.type ?? row.price_type ?? 1) || 1,
      _mode: Number(row.mode ?? row.price_mode ?? 0) || 0,
      _roworder: row.roworder ?? 0,
      _discountNumber: row.discount_number || 0,
      _discountWord: row.defaultDiscount || row.discount_word || '',
      _price_info: row.price_info ?? row.mode ?? '',
      _foundPrice: Boolean(rowFound),
      _foundByCondition: Boolean(rowFoundByCondition),
      _stand_price: row.stand_price ?? row.price_stand ?? 0,
      source: 'pos_fallback',
    };
  });
  return { success: true, data: fallbackData.length ? fallbackData : [createEmptyPosPriceRow('pos_fallback')] };
}

module.exports = { getProductPriceLocalx, getPricePos, calcFormulaPrice };
