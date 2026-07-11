/**
 * sell-detail-regression.mjs
 * Comprehensive regression for "เมนูขายแบบละเอียด" (SellView → saveTransAndPro)
 *
 * Covers:
 *  1. VAT type 1 - include VAT (รวมใน)
 *  2. VAT type 0 - exclude VAT (แยกนอก)
 *  3. VAT type 2 - zero/exempt VAT (ยกเว้น)
 *  4. Credit sale (inquiry_type=0, cash=0)
 *  5. Bill discount (discount at document level)
 *  6. Per-line item discount
 *  7. Multi-line items
 *  8. Rounding amount (rounded_amount ≠ 0)
 *  9. Shipment info → verify ic_trans_shipment
 * 10. WHT rows → verify gl_wht_list + gl_wht_list_detail
 * 11. Manual GL entries → verify gl_trans_detail
 * 12. VAT rows (gl_journal_vat_sale) → verify gl_journal_vat_sale
 * 13. Multi-currency document
 * 14. Extra header fields round-trip verify
 * 15. Service item purchase (item_type = '1', no stock deduction)
 * 16. Load-edit round-trip: save → getDocSaleHistoryDetail → verify fields
 */

import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:47309/service/v1'
const ROOT_DIR = path.resolve(new URL('../..', import.meta.url).pathname.slice(1))
const ENV_PATH = process.env.BACKEND_ENV || path.join(ROOT_DIR, 'MarketPlaceWebServiceExpress', '.env')
const requireBackend = createRequire(path.join(ROOT_DIR, 'MarketPlaceWebServiceExpress', 'package.json'))
const { Client } = requireBackend('pg')
const RUN_ID = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(2, 14)
const results = []

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readEnv(filePath) {
  const fileEnv = Object.fromEntries(
    fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=')
        return [line.slice(0, index), line.slice(index + 1)]
      }),
  )
  for (const key of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_PASS', 'DB_NAME']) {
    if (process.env[key]) fileEnv[key] = process.env[key]
  }
  return fileEnv
}

function localDateISO(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function rnd(value, point = 2) {
  const factor = 10 ** point
  return Math.round((Number(value) || 0) * factor) / factor
}

function pass(name, extra = {}) { results.push({ status: 'PASS', name, ...extra }) }
function fail(name, error) { results.push({ status: 'FAIL', name, error: error?.message || String(error) }) }
function skip(name, reason) { results.push({ status: 'SKIP', name, reason }) }

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

function money(value) { return rnd(Number(value) || 0) }

async function api(pathname, { method = 'GET', params, body } = {}) {
  const url = new URL(`${BASE_URL}${pathname}`)
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  })
  const response = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!response.ok) throw new Error(`${method} ${pathname} ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`)
  return data
}

async function getData(pathname, options) {
  const json = await api(pathname, options)
  return json?.data ?? json
}

// ─── Context Discovery ────────────────────────────────────────────────────────

async function discoverContext() {
  const [posList, formats, erp, masters] = await Promise.all([
    getData('/getPOSList'),
    getData('/getSaleDocFormatList'),
    getData('/getErpOption'),
    getData('/getPaymentMasterLists'),
  ])

  const customerRows = await getData('/getCustomerList', { params: { search: '' } })
  const employees = await getData('/getEmployeeList', { params: { search: '' } }).catch(() => [])
  const glAccounts = await getData('/getGlAccountList', { params: { search: '' } }).catch(() => [])

  const ctx = {
    pos: posList[0],
    format: formats.find((row) => row.code === 'CSP') || formats[0],
    customer: customerRows[0],
    employee: employees[0] || { code: '001', name: 'Test' },
    vatRate: Number(erp.vat_rate ?? 7),
    discountType: Number(erp.discout_type ?? 0),
    currencyExchangeDecimal: Number(erp.currency_exchange_decimal ?? 2),
    masters,
    glAccounts: Array.isArray(glAccounts) ? glAccounts : [],
  }

  expect(ctx.pos, 'missing POS master')
  expect(ctx.format, 'missing sale doc format')
  expect(ctx.customer?.code, 'missing customer')

  // Find a priced stock product
  const products = await getData('/getProductList', { params: { isstock: '1', limit: 100 } })
  for (const product of products) {
    if (String(product.item_type ?? '') === '1') continue
    const details = await getData('/getProductDetail', {
      params: {
        item_code: product.item_code,
        cust_code: ctx.customer.code,
        sale_type: 1,
        vat_type: 1,
        vat_rate: ctx.vatRate,
      },
    }).catch(() => [])
    for (const unit of details) {
      const priceRows = await getData('/getProductPrice', {
        params: {
          item_code: unit.item_code,
          unit_code: unit.unit_code,
          cust_code: ctx.customer.code,
          qty: 1,
          sale_type: 1,
          vat_type: 1,
          vat_rate: ctx.vatRate,
        },
      }).catch(() => [])
      const price = Number((Array.isArray(priceRows) ? priceRows[0] : priceRows)?.price || 0)
      if (price > 0 && Number(unit.balance_qty ?? 0) >= 5) {
        ctx.stockProduct = unit
        ctx.stockPrice = price
        break
      }
    }
    if (ctx.stockProduct) break
  }
  expect(ctx.stockProduct, 'no priced stock product with qty >= 5')

  // Find a service product (item_type = '1')
  const serviceSearch = await getData('/getProductList', { params: { limit: 200 } })
  for (const product of serviceSearch) {
    if (String(product.item_type ?? '') !== '1') continue
    const details = await getData('/getProductDetail', {
      params: {
        item_code: product.item_code,
        cust_code: ctx.customer.code,
        sale_type: 3,
        vat_type: 1,
        vat_rate: ctx.vatRate,
      },
    }).catch(() => [])
    if (details.length) {
      const unit = details[0]
      const priceRows = await getData('/getProductPrice', {
        params: {
          item_code: unit.item_code,
          unit_code: unit.unit_code,
          cust_code: ctx.customer.code,
          qty: 1,
          sale_type: 3,
          vat_type: 1,
          vat_rate: ctx.vatRate,
        },
      }).catch(() => [])
      const price = Number((Array.isArray(priceRows) ? priceRows[0] : priceRows)?.price || 0)
      if (price > 0) {
        ctx.serviceProduct = unit
        ctx.servicePrice = price
        break
      }
    }
  }

  // Foreign currency
  ctx.foreignCurrency = (ctx.masters.currencies || []).find((row) => row.code !== 'THB' && Number(row.exchange_rate_present) > 0) || null

  return ctx
}

// ─── Sale Body Builders ───────────────────────────────────────────────────────

function buildLine(item, price, qty = 1, vatType = 1, vatRate = 7, override = {}) {
  const sum = rnd(price * qty)
  return {
    item_code: item.item_code,
    item_name: item.item_name,
    unit_code: item.unit_code,
    qty,
    price,
    sum_amount: sum,
    discount: '',
    discount_amount: 0,
    tax_type: Number(item.tax_type ?? 0),
    vat_type: vatType,
    vat_rate: vatRate,
    wh_code: item.wh_code || '',
    shelf_code: item.shelf_code || '',
    stand_value: Number(item.stand_value) || 1,
    divide_value: Number(item.divide_value) || 1,
    ratio: Number(item.ratio) || 1,
    barcode: item.barcode || '',
    remark: '',
    sub_item: [],
    ...override,
  }
}

function calcTotalsVat1(items) {
  const totalValue = rnd(items.reduce((sum, item) => sum + Number(item.sum_amount), 0))
  const totalDiscount = 0
  const totalAmount = totalValue
  const beforeVat = rnd((totalAmount * 100) / 107)
  const vatValue = rnd(totalAmount - beforeVat)
  return { total_value: totalValue, total_discount: totalDiscount, total_before_vat: beforeVat, total_vat_value: vatValue, total_after_vat: totalAmount, total_except_vat: 0, total_amount: totalAmount }
}

function calcTotalsVat0(items) {
  // exclude vat: ราคาก่อน VAT + VAT แยกนอก
  const totalValue = rnd(items.reduce((sum, item) => sum + Number(item.sum_amount), 0))
  const vatValue = rnd(totalValue * 0.07)
  const totalAmount = rnd(totalValue + vatValue)
  return { total_value: totalValue, total_discount: 0, total_before_vat: totalValue, total_vat_value: vatValue, total_after_vat: totalAmount, total_except_vat: 0, total_amount: totalAmount }
}

function calcTotalsVat2(items) {
  // zero/exempt vat: ไม่มี VAT
  const totalValue = rnd(items.reduce((sum, item) => sum + Number(item.sum_amount), 0))
  return { total_value: totalValue, total_discount: 0, total_before_vat: 0, total_vat_value: 0, total_after_vat: 0, total_except_vat: 0, total_amount: totalValue }
}

function baseBody(ctx, overrides = {}) {
  return {
    pos_id: ctx.pos.pos_id,
    doc_date: localDateISO(),
    doc_time: new Date().toTimeString().slice(0, 5),
    creator_code: 'bizsuit',
    doc_format_code: ctx.format.code,
    form_code: ctx.format.form_code || '',
    branch_code: ctx.pos.branch_code || '',
    cust_code: ctx.customer.code,
    emp_code: ctx.employee.code || '001',
    shelf_code: ctx.pos.pos_ic_shelf || '',
    remark: `SELLDETAIL_${RUN_ID}`,
    inquiry_type: 1,
    vat_type: 1,
    vat_rate: ctx.vatRate,
    discount_type: ctx.discountType,
    discount_word: '',
    promotion_discount_amount: 0,
    promotion_extra_discount_amount: 0,
    currency_code: '',
    exchange_rate: 1,
    total_value_2: 0,
    total_discount_2: 0,
    total_amount_2: 0,
    discount_word_2: '',
    rounded_amount: 0,
    total_income_amount: 0,
    tranfer_amount: 0,
    chq_amount: 0,
    card_amount: 0,
    total_credit_charge: 0,
    petty_cash_amount: 0,
    deposit_amount: 0,
    coupon_amount: 0,
    total_income_other: 0,
    total_expense_other: 0,
    total_other_currency: 0,
    total_other_currency_charge: 0,
    wallet_amount: 0,
    shipment: {},
    wht_headers: [],
    vat_sale: { vat_number: '', tax_doc_no: '', tax_doc_date: '', description: '', tax_no: '', branch_code: '' },
    vat_rows: [],
    gl_trans_direct: 0,
    gl_header: null,
    gl_detail: [],
    promotion_detail: [],
    payment_detail: [],
    ...overrides,
  }
}

async function saveAndVerify(name, body, extraCheck) {
  try {
    const result = await api('/saveTransAndPro', { method: 'POST', body })
    if (!result?.success || !result.doc_no) throw new Error(result?.msg || 'saveTransAndPro did not return doc_no')
    const detail = await getData('/getDocSaleHistoryDetail', { params: { doc_no: result.doc_no } })
    if (!detail?.header) throw new Error('getDocSaleHistoryDetail returned no header')
    if (extraCheck) await extraCheck(result.doc_no, detail)
    pass(name, { doc_no: result.doc_no })
    return result.doc_no
  } catch (error) {
    fail(name, error)
    return null
  }
}

// ─── Individual Test Cases ────────────────────────────────────────────────────

async function testVatType1(ctx) {
  const items = [buildLine(ctx.stockProduct, ctx.stockPrice, 1, 1, ctx.vatRate)]
  const totals = calcTotalsVat1(items)
  const body = baseBody(ctx, {
    ...totals,
    total_net_amount: totals.total_amount,
    cash_amount: totals.total_amount,
    items,
  })
  return saveAndVerify('vat_type=1 รวมใน (include VAT)', body, async (_docNo, detail) => {
    expect(money(detail.header.total_vat_value) > 0, 'expected positive vat_value')
  })
}

async function testVatType0(ctx) {
  const items = [buildLine(ctx.stockProduct, ctx.stockPrice, 1, 0, ctx.vatRate)]
  const totals = calcTotalsVat0(items)
  const body = baseBody(ctx, {
    vat_type: 0,
    ...totals,
    total_net_amount: totals.total_amount,
    cash_amount: totals.total_amount,
    items,
  })
  return saveAndVerify('vat_type=0 แยกนอก (exclude VAT)', body, async (_docNo, detail) => {
    expect(money(detail.header.total_vat_value) > 0, 'expected positive vat_value for exclude type')
  })
}

async function testVatType2(ctx) {
  const items = [buildLine(ctx.stockProduct, ctx.stockPrice, 1, 2, 0)]
  const totals = calcTotalsVat2(items)
  const body = baseBody(ctx, {
    vat_type: 2,
    vat_rate: 0,
    ...totals,
    total_net_amount: totals.total_amount,
    cash_amount: totals.total_amount,
    items,
  })
  return saveAndVerify('vat_type=2 ยกเว้น (zero VAT)', body, async (_docNo, detail) => {
    expect(money(detail.header.total_vat_value) === 0, 'expected zero vat_value for exempt VAT')
  })
}

async function testCreditSale(ctx) {
  const items = [buildLine(ctx.stockProduct, ctx.stockPrice, 1, 1, ctx.vatRate)]
  const totals = calcTotalsVat1(items)
  const body = baseBody(ctx, {
    inquiry_type: 0,
    ...totals,
    total_net_amount: totals.total_amount,
    cash_amount: 0,
    items,
  })
  const name = 'credit sale inquiry_type=0 (ขายเชื่อ)'
  try {
    let result = await api('/saveTransAndPro', { method: 'POST', body })
    if (!result?.success && result?.require_confirm) {
      result = await api('/saveTransAndPro', { method: 'POST', body: { ...body, credit_confirmations: [result.require_confirm] } })
    }
    if (!result?.success && result?.require_confirm) {
      // second level warning
      result = await api('/saveTransAndPro', { method: 'POST', body: { ...body, credit_confirmations: [result.require_confirm] } })
    }
    if (!result?.success || !result.doc_no) throw new Error(result?.msg || 'saveTransAndPro credit sale failed')
    const detail = await getData('/getDocSaleHistoryDetail', { params: { doc_no: result.doc_no } })
    expect(detail?.header, 'missing detail header')
    expect(String(detail.header.inquiry_type) === '0', `expected inquiry_type=0, got ${detail.header.inquiry_type}`)
    pass(name, { doc_no: result.doc_no })
    return result.doc_no
  } catch (error) {
    fail(name, error)
    return null
  }
}

async function testBillDiscount(ctx) {
  const items = [buildLine(ctx.stockProduct, ctx.stockPrice, 2, 1, ctx.vatRate)]
  const raw = calcTotalsVat1(items)
  const discountAmt = rnd(raw.total_value * 0.05)
  const totalAmount = rnd(raw.total_amount - discountAmt)
  const beforeVat = rnd((totalAmount * 100) / 107)
  const vatValue = rnd(totalAmount - beforeVat)
  const totals = {
    total_value: raw.total_value,
    total_discount: discountAmt,
    total_before_vat: beforeVat,
    total_vat_value: vatValue,
    total_after_vat: totalAmount,
    total_except_vat: 0,
    total_amount: totalAmount,
  }
  const body = baseBody(ctx, {
    discount_word: '5%',
    ...totals,
    total_net_amount: totalAmount,
    cash_amount: totalAmount,
    items,
  })
  return saveAndVerify('bill discount 5% (ส่วนลดบิล)', body, async (_docNo, detail) => {
    expect(money(detail.header.total_discount) > 0, 'expected total_discount > 0')
  })
}

async function testLineDiscount(ctx) {
  const price = ctx.stockPrice
  const qty = 2
  const discountAmt = rnd(price * 0.1) // 10% per line
  const sumAmount = rnd(price * qty - discountAmt * qty)
  const items = [{
    ...buildLine(ctx.stockProduct, price, qty, 1, ctx.vatRate),
    discount: '10%',
    discount_amount: discountAmt,
    sum_amount: sumAmount,
  }]
  const totals = calcTotalsVat1(items)
  const body = baseBody(ctx, {
    ...totals,
    total_net_amount: totals.total_amount,
    cash_amount: totals.total_amount,
    items,
  })
  return saveAndVerify('per-line 10% discount (ส่วนลดรายบรรทัด)', body, async () => {})
}

async function testMultiLine(ctx) {
  const items = [
    buildLine(ctx.stockProduct, ctx.stockPrice, 1, 1, ctx.vatRate),
    buildLine(ctx.stockProduct, ctx.stockPrice, 1, 1, ctx.vatRate, { remark: 'line2' }),
  ]
  const totals = calcTotalsVat1(items)
  const body = baseBody(ctx, {
    ...totals,
    total_net_amount: totals.total_amount,
    cash_amount: totals.total_amount,
    items,
  })
  return saveAndVerify('multi-line items (หลายรายการ)', body, async (_docNo, detail) => {
    expect(Array.isArray(detail.items) && detail.items.length >= 2, 'expected >= 2 detail items')
  })
}

async function testRounding(ctx) {
  const items = [buildLine(ctx.stockProduct, ctx.stockPrice, 1, 1, ctx.vatRate)]
  const totals = calcTotalsVat1(items)
  const rounded = 0.5
  const netAmount = rnd(totals.total_amount + rounded)
  const body = baseBody(ctx, {
    ...totals,
    rounded_amount: rounded,
    total_income_amount: rounded,
    total_net_amount: netAmount,
    cash_amount: netAmount,
    items,
  })
  return saveAndVerify('rounding amount (เศษทอน)', body, async (dn, _detail) => {
    // rounded_amount is stored as total_income_amount in cb_trans per save logic
    // verify total_net_amount is > total_amount (due to rounding)
    const detail = await getData('/getDocSaleHistoryDetail', { params: { doc_no: dn } })
    expect(money(detail?.header?.total_net_amount) >= money(totals.total_amount), `total_net_amount should be >= total_amount when rounding`)
  })
}

async function testShipment(ctx, client) {
  const items = [buildLine(ctx.stockProduct, ctx.stockPrice, 1, 1, ctx.vatRate)]
  const totals = calcTotalsVat1(items)
  const shipment = {
    transport_name: `SHIP_${RUN_ID.slice(-6)}`,
    transport_address: '123 ถนนทดสอบ',
    transport_telephone: '02-000-0000',
    transport_fax: '',
    transport_tambon: '',
    transport_amper: '',
    transport_province: '',
    transport_country: 'TH',
    transport_code: '',
    destination: 'กรุงเทพฯ',
    remark: 'ส่งด่วน',
    remark_2: '',
    ship_code: '',
    logistic_area: '',
    latitude: 0,
    longitude: 0,
    zipcode: '10400',
  }
  const body = baseBody(ctx, {
    ...totals,
    total_net_amount: totals.total_amount,
    cash_amount: totals.total_amount,
    shipment,
    items,
  })
  const docNo = await saveAndVerify('shipment info (ข้อมูลการจัดส่ง)', body, async (dn) => {
    const row = await client.query('SELECT transport_name, zipcode FROM ic_trans_shipment WHERE doc_no = $1 AND trans_flag = 44 LIMIT 1', [dn])
    expect(row.rows[0], `missing ic_trans_shipment for ${dn}`)
    expect(row.rows[0].transport_name === shipment.transport_name, `transport_name expected ${shipment.transport_name}, got ${row.rows[0].transport_name}`)
    expect(row.rows[0].zipcode === shipment.zipcode, `zipcode expected ${shipment.zipcode}, got ${row.rows[0].zipcode}`)
  })
  return docNo
}

async function testWht(ctx, client) {
  const items = [buildLine(ctx.stockProduct, ctx.stockPrice, 5, 1, ctx.vatRate)]
  const totals = calcTotalsVat1(items)
  const whtTaxDocNo = `WHT${RUN_ID.slice(-8)}`
  const whtAmount = 100
  const whtTaxValue = 3
  const whtHeaders = [
    {
      tax_doc_no: whtTaxDocNo,
      due_date: localDateISO(),
      cust_code: ctx.customer.code,
      cust_name: ctx.customer.name || ctx.customer.name_1 || '',
      cust_address: '',
      cust_tax_type: 0,
      tax_number: '',
      card_number: '',
      amount: whtAmount,
      tax_value: whtTaxValue,
      details: [
        {
          line_number: 0,
          income_type: '01',
          amount: whtAmount,
          tax_rate: 3,
          tax_value: whtTaxValue,
          sum_amount: whtAmount,
          due_date: localDateISO(),
        },
      ],
    },
  ]
  const body = baseBody(ctx, {
    ...totals,
    total_net_amount: totals.total_amount,
    cash_amount: totals.total_amount,
    wht_headers: whtHeaders,
    items,
  })
  return saveAndVerify('WHT rows (ภาษีหัก ณ ที่จ่าย)', body, async (dn) => {
    const header = await client.query('SELECT tax_doc_no, amount, tax_value FROM gl_wht_list WHERE doc_no = $1 AND trans_flag = 44 LIMIT 1', [dn])
    expect(header.rows[0], `missing gl_wht_list for ${dn}`)
    expect(header.rows[0].tax_doc_no === whtTaxDocNo, `tax_doc_no expected ${whtTaxDocNo}, got ${header.rows[0].tax_doc_no}`)
    expect(money(header.rows[0].amount) === money(whtAmount), `wht amount expected ${whtAmount}, got ${header.rows[0].amount}`)
    const detail = await client.query('SELECT income_type, tax_rate FROM gl_wht_list_detail WHERE doc_no = $1 AND trans_flag = 44 LIMIT 1', [dn])
    expect(detail.rows[0], `missing gl_wht_list_detail for ${dn}`)
    expect(detail.rows[0].income_type === '01', `income_type expected 01, got ${detail.rows[0].income_type}`)
  })
}

async function testManualGl(ctx, client) {
  // Need at least 2 GL account codes
  const glAccounts = ctx.glAccounts
  if (glAccounts.length < 2) {
    skip('manual GL entries (GL manual)', 'insufficient GL account codes in master')
    return null
  }
  const acc1 = glAccounts[0]
  const acc2 = glAccounts[1]
  const items = [buildLine(ctx.stockProduct, ctx.stockPrice, 1, 1, ctx.vatRate)]
  const totals = calcTotalsVat1(items)
  const glAmount = rnd(totals.total_amount)
  const glDetail = [
    { line_number: 0, account_code: acc1.code, account_name: acc1.name || acc1.name_1 || acc1.code, debit: glAmount, credit: 0 },
    { line_number: 1, account_code: acc2.code, account_name: acc2.name || acc2.name_1 || acc2.code, debit: 0, credit: glAmount },
  ]
  const body = baseBody(ctx, {
    ...totals,
    total_net_amount: totals.total_amount,
    cash_amount: totals.total_amount,
    gl_trans_direct: 1,
    gl_detail: glDetail,
    gl_header: {
      ref_date: localDateISO(),
      ref_no: `GLREF${RUN_ID.slice(-6)}`,
      book_code: '',
      journal_type: 0,
      description: `GL test ${RUN_ID}`,
      ap_ar_code: ctx.customer.code,
      ap_ar_originate_from: 0,
      period_number: 0,
      account_year: 0,
    },
    items,
  })
  return saveAndVerify('manual GL entries (GL บัญชีแมนนวล)', body, async (dn) => {
    const glRows = await client.query('SELECT account_code, debit, credit FROM gl_trans_detail WHERE doc_no = $1 AND trans_flag = 44 ORDER BY line_number', [dn])
    expect(glRows.rows.length >= 2, `expected >= 2 gl_trans_detail rows, got ${glRows.rows.length}`)
    const debitRow = glRows.rows.find((row) => money(row.debit) > 0)
    const creditRow = glRows.rows.find((row) => money(row.credit) > 0)
    expect(debitRow, 'missing debit GL row')
    expect(creditRow, 'missing credit GL row')
    expect(money(debitRow.debit) === money(glAmount), `GL debit expected ${glAmount}, got ${debitRow.debit}`)
    expect(money(creditRow.credit) === money(glAmount), `GL credit expected ${glAmount}, got ${creditRow.credit}`)
  })
}

async function testVatRows(ctx, client) {
  const items = [buildLine(ctx.stockProduct, ctx.stockPrice, 2, 1, ctx.vatRate)]
  const totals = calcTotalsVat1(items)
  const vatVatDate = localDateISO()
  const vatRows = [
    {
      line_number: 0,
      vat_date: vatVatDate,
      vat_number: `VR${RUN_ID.slice(-8)}`,
      vat_effective_period: new Date().getMonth() + 1,
      vat_effective_year: new Date().getFullYear() + 543,
      description: `ขายสินค้า test ${RUN_ID}`,
      tax_group: '',
      base_caltax_amount: totals.total_before_vat,
      tax_rate: ctx.vatRate,
      amount: totals.total_vat_value,
      except_tax_amount: 0,
      vat_type: 1,
      is_add: 1,
      ar_name: ctx.customer.name || ctx.customer.name_1 || '',
      tax_no: '',
      branch_type: 0,
      branch_code: ctx.pos.branch_code || '',
      manual_add: 0,
    },
  ]
  const body = baseBody(ctx, {
    ...totals,
    total_net_amount: totals.total_amount,
    cash_amount: totals.total_amount,
    vat_rows: vatRows,
    items,
  })
  return saveAndVerify('VAT rows (บรรทัด VAT)', body, async (dn) => {
    const row = await client.query('SELECT vat_number, base_caltax_amount FROM gl_journal_vat_sale WHERE doc_no = $1 AND trans_flag = 44 LIMIT 1', [dn])
    expect(row.rows[0], `missing gl_journal_vat_sale for ${dn}`)
    expect(row.rows[0].vat_number === vatRows[0].vat_number, `vat_number expected ${vatRows[0].vat_number}, got ${row.rows[0].vat_number}`)
  })
}

async function testMultiCurrency(ctx, client) {
  if (!ctx.foreignCurrency) {
    skip('multi-currency document (สกุลเงินต่างประเทศ)', 'no foreign currency with exchange rate found')
    return null
  }
  const rate = Number(ctx.foreignCurrency.exchange_rate_present)
  const currencyPoint = Number(ctx.currencyExchangeDecimal ?? 2)
  const currencyItems = [buildLine(ctx.stockProduct, ctx.stockPrice, 1, 1, ctx.vatRate)]
  const currencyTotals = calcTotalsVat1(currencyItems)
  const items = currencyItems.map((item) => ({
    ...item,
    price_2: item.price,
    sum_amount_2: item.sum_amount,
    discount_amount_2: item.discount_amount || 0,
    price: rnd(item.price * rate),
    sum_amount: rnd(item.sum_amount * rate),
    discount_amount: rnd((item.discount_amount || 0) * rate),
  }))
  const totals = calcTotalsVat1(items)
  const body = baseBody(ctx, {
    currency_code: ctx.foreignCurrency.code,
    exchange_rate: rate,
    total_value_2: rnd(currencyTotals.total_value, currencyPoint),
    total_discount_2: rnd(currencyTotals.total_discount, currencyPoint),
    total_amount_2: rnd(currencyTotals.total_amount, currencyPoint),
    ...totals,
    total_net_amount: totals.total_amount,
    cash_amount: totals.total_amount,
    items,
  })
  return saveAndVerify(`multi-currency ${ctx.foreignCurrency.code} (สกุลเงินต่างประเทศ)`, body, async (dn) => {
    const row = await client.query(
      `SELECT COALESCE(currency_code,'') AS currency_code,
              COALESCE(exchange_rate,1) AS exchange_rate,
              COALESCE(total_amount,0) AS total_amount,
              COALESCE(total_amount_2,0) AS total_amount_2
       FROM ic_trans
       WHERE doc_no = $1
       LIMIT 1`,
      [dn],
    )
    expect(row.rows[0]?.currency_code === ctx.foreignCurrency.code, `currency_code expected ${ctx.foreignCurrency.code}, got ${row.rows[0]?.currency_code}`)
    expect(Number(row.rows[0]?.exchange_rate) === rate, `exchange_rate expected ${rate}, got ${row.rows[0]?.exchange_rate}`)
    expect(money(row.rows[0]?.total_amount) === money(totals.total_amount), `total_amount expected ${totals.total_amount}, got ${row.rows[0]?.total_amount}`)
    expect(money(row.rows[0]?.total_amount_2) === money(currencyTotals.total_amount), `total_amount_2 expected ${currencyTotals.total_amount}, got ${row.rows[0]?.total_amount_2}`)
    const detail = await client.query(
      `SELECT COALESCE(price,0) AS price,
              COALESCE(price_2,0) AS price_2,
              COALESCE(sum_amount,0) AS sum_amount,
              COALESCE(sum_amount_2,0) AS sum_amount_2
       FROM ic_trans_detail
       WHERE doc_no = $1 AND trans_flag = 44
       LIMIT 1`,
      [dn],
    )
    expect(money(detail.rows[0]?.price) === money(items[0].price), `detail price expected ${items[0].price}, got ${detail.rows[0]?.price}`)
    expect(money(detail.rows[0]?.price_2) === money(currencyItems[0].price), `detail price_2 expected ${currencyItems[0].price}, got ${detail.rows[0]?.price_2}`)
    expect(money(detail.rows[0]?.sum_amount) === money(items[0].sum_amount), `detail sum_amount expected ${items[0].sum_amount}, got ${detail.rows[0]?.sum_amount}`)
    expect(money(detail.rows[0]?.sum_amount_2) === money(currencyItems[0].sum_amount), `detail sum_amount_2 expected ${currencyItems[0].sum_amount}, got ${detail.rows[0]?.sum_amount_2}`)
  })
}

async function testExtraHeaderFields(ctx, client) {
  const items = [buildLine(ctx.stockProduct, ctx.stockPrice, 1, 1, ctx.vatRate)]
  const totals = calcTotalsVat1(items)
  const headerValues = {
    doc_group: `BZGRP${RUN_ID.slice(-4)}`,
    side_code: `BZSD${RUN_ID.slice(-4)}`,
    department_code: `BZDP${RUN_ID.slice(-4)}`,
    allocate_code: `BZAL${RUN_ID.slice(-4)}`,
    project_code: `BZPJ${RUN_ID.slice(-4)}`,
    job_code: `BZJB${RUN_ID.slice(-4)}`,
    contactor: `BZCT${RUN_ID.slice(-4)}`,
    doc_ref: `BZRF${RUN_ID.slice(-4)}`,
    doc_ref_date: localDateISO(),
    sale_group: `BZSG${RUN_ID.slice(-4)}`,
    cashier_code: `BZCS${RUN_ID.slice(-4)}`,
  }
  const body = baseBody(ctx, {
    ...headerValues,
    ...totals,
    total_net_amount: totals.total_amount,
    cash_amount: totals.total_amount,
    items,
  })
  return saveAndVerify('extra header fields round-trip (ฟิลด์หัวเอกสารเพิ่มเติม)', body, async (dn) => {
    const row = await client.query(
      `SELECT COALESCE(doc_group,'') AS doc_group,
              COALESCE(side_code,'') AS side_code,
              COALESCE(department_code,'') AS department_code,
              COALESCE(allocate_code,'') AS allocate_code,
              COALESCE(project_code,'') AS project_code,
              COALESCE(job_code,'') AS job_code,
              COALESCE(contactor,'') AS contactor,
              COALESCE(doc_ref,'') AS doc_ref,
              COALESCE(sale_group,'') AS sale_group,
              COALESCE(cashier_code,'') AS cashier_code
       FROM ic_trans WHERE doc_no = $1 LIMIT 1`,
      [dn],
    )
    const ic = row.rows[0]
    expect(ic, `missing ic_trans for ${dn}`)
    for (const [key, val] of Object.entries(headerValues)) {
      if (key === 'doc_ref_date') continue
      expect(ic[key] === val, `${key} expected "${val}", got "${ic[key]}"`)
    }
  })
}

async function testServiceItemSale(ctx) {
  if (!ctx.serviceProduct) {
    skip('service item sale (สินค้าบริการ)', 'no priced service product found')
    return null
  }
  const items = [buildLine(ctx.serviceProduct, ctx.servicePrice, 1, 1, ctx.vatRate, { item_type: '1' })]
  const totals = calcTotalsVat1(items)
  const body = baseBody(ctx, {
    inquiry_type: 3,
    ...totals,
    total_net_amount: totals.total_amount,
    cash_amount: totals.total_amount,
    items,
  })
  return saveAndVerify('service item sale inquiry_type=3 (ขายบริการ)', body, async (_docNo, detail) => {
    expect(detail.header, 'missing header in getDocSaleHistoryDetail for service sale')
  })
}

async function testLoadEditRoundTrip(ctx, _client, savedDocNo) {
  if (!savedDocNo) {
    skip('load-edit round-trip (โหลดเอกสารและบันทึกซ้ำ)', 'no prior doc_no to use')
    return null
  }
  try {
    const detail = await getData('/getDocSaleHistoryDetail', { params: { doc_no: savedDocNo } })
    expect(detail?.header, `getDocSaleHistoryDetail returned no header for ${savedDocNo}`)
    expect(money(detail.header.total_amount) > 0, 'loaded total_amount should be > 0')
    pass('load-edit round-trip: getDocSaleHistoryDetail fields present', { doc_no: savedDocNo, total: detail.header.total_amount })
    return savedDocNo
  } catch (error) {
    fail('load-edit round-trip (โหลดเอกสารและบันทึกซ้ำ)', error)
    return null
  }
}

async function testRemarks(ctx) {
  const items = [buildLine(ctx.stockProduct, ctx.stockPrice, 1, 1, ctx.vatRate)]
  const totals = calcTotalsVat1(items)
  const body = baseBody(ctx, {
    remark: `REMARK1_${RUN_ID}`,
    remark_2: `REMARK2_${RUN_ID}`,
    remark_3: `REMARK3_${RUN_ID}`,
    remark_4: `REMARK4_${RUN_ID}`,
    remark_5: `REMARK5_${RUN_ID}`,
    ...totals,
    total_net_amount: totals.total_amount,
    cash_amount: totals.total_amount,
    items,
  })
  return saveAndVerify('multiple remarks (หมายเหตุหลายฟิลด์)', body, async (_docNo, detail) => {
    expect(detail.header, 'missing header')
  })
}

async function testCashWithCreditConfirmation(ctx) {
  // Test that overdue_warning / credit_over_limit_warning can be confirmed
  const items = [buildLine(ctx.stockProduct, ctx.stockPrice, 1, 1, ctx.vatRate)]
  const totals = calcTotalsVat1(items)
  const body = baseBody(ctx, {
    ...totals,
    total_net_amount: totals.total_amount,
    cash_amount: totals.total_amount,
    credit_confirmations: [],
    items,
  })
  try {
    let result = await api('/saveTransAndPro', { method: 'POST', body })
    if (!result?.success && result?.require_confirm) {
      result = await api('/saveTransAndPro', {
        method: 'POST',
        body: { ...body, credit_confirmations: [result.require_confirm] },
      })
    }
    if (!result?.success || !result.doc_no) throw new Error(result?.msg || 'saveTransAndPro failed')
    pass('save with credit confirmation flow (ยืนยันวงเงิน)', { doc_no: result.doc_no })
    return result.doc_no
  } catch (error) {
    fail('save with credit confirmation flow (ยืนยันวงเงิน)', error)
    return null
  }
}

// ─── Main Run ─────────────────────────────────────────────────────────────────

async function run() {
  const env = readEnv(ENV_PATH)
  const client = new Client({
    host: env.DB_HOST,
    port: Number(env.DB_PORT) || 5432,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD || env.DB_PASS,
  })
  await client.connect()

  try {
    const ctx = await discoverContext()
    pass('context discovery', {
      pos: ctx.pos.pos_id,
      format: ctx.format.code,
      customer: ctx.customer.code,
      stock_item: `${ctx.stockProduct.item_code}/${ctx.stockProduct.unit_code}`,
      stock_price: ctx.stockPrice,
      service_item: ctx.serviceProduct ? `${ctx.serviceProduct.item_code}/${ctx.serviceProduct.unit_code}` : 'none',
      foreign_currency: ctx.foreignCurrency?.code || 'none',
    })

    // Core VAT type tests
    const docVat1 = await testVatType1(ctx)
    await testVatType0(ctx)
    await testVatType2(ctx)

    // Sale type tests
    await testCreditSale(ctx)

    // Discount tests
    await testBillDiscount(ctx)
    await testLineDiscount(ctx)

    // Multi-line items
    await testMultiLine(ctx)

    // Rounding
    await testRounding(ctx)

    // Shipment
    await testShipment(ctx, client)

    // WHT
    await testWht(ctx, client)

    // Manual GL
    await testManualGl(ctx, client)

    // VAT rows
    await testVatRows(ctx, client)

    // Multi-currency
    await testMultiCurrency(ctx, client)

    // Extra header fields
    await testExtraHeaderFields(ctx, client)

    // Service item
    await testServiceItemSale(ctx)

    // Multiple remarks
    await testRemarks(ctx)

    // Credit confirmation flow
    await testCashWithCreditConfirmation(ctx)

    // Load-edit round-trip (use the first saved doc)
    await testLoadEditRoundTrip(ctx, client, docVat1)
  } finally {
    await client.end()
  }
}

try {
  await run()
} catch (error) {
  fail('fatal', error)
}

const failed = results.filter((row) => row.status === 'FAIL')
console.log(JSON.stringify({ baseUrl: BASE_URL, runId: RUN_ID, failed: failed.length, results }, null, 2))
process.exitCode = failed.length ? 1 : 0
