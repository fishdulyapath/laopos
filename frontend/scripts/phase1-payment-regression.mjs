import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:47309/service/v1'
const ROOT_DIR = path.resolve(new URL('../..', import.meta.url).pathname.slice(1))
const ENV_PATH = process.env.BACKEND_ENV || path.join(ROOT_DIR, 'MarketPlaceWebServiceExpress', '.env')
const requireBackend = createRequire(path.join(ROOT_DIR, 'MarketPlaceWebServiceExpress', 'package.json'))
const { Client } = requireBackend('pg')
const RUN_ID = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
const TEST_CREDIT_TYPE = 'BZTEST_CC'
const TEST_WALLET = 'BZTEST_WALLET'
const TEST_COUPON = 'BZTEST_COUPON'
const results = []

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

function rnd(value, point = 2) {
  const factor = 10 ** point
  return Math.round((Number(value) || 0) * factor) / factor
}

function localDateISO(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function pass(name, extra = {}) {
  results.push({ status: 'PASS', name, ...extra })
}

function fail(name, error) {
  results.push({ status: 'FAIL', name, error: error?.message || String(error) })
}

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

function money(value) {
  return rnd(Number(value) || 0)
}

async function api(pathname, { method = 'GET', params, body, allowStatus = [] } = {}) {
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
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!response.ok && !allowStatus.includes(response.status)) {
    throw new Error(`${method} ${pathname} ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`)
  }
  return data
}

async function data(pathname, options) {
  const json = await api(pathname, options)
  return json?.data ?? json
}

const columnCache = new Map()
async function tableColumns(client, tableName) {
  if (columnCache.has(tableName)) return columnCache.get(tableName)
  const result = await client.query(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = $1
     ORDER BY ordinal_position`,
    [tableName],
  )
  columnCache.set(tableName, result.rows)
  return result.rows
}

async function tableColumnSet(client, tableName) {
  return new Set((await tableColumns(client, tableName)).map((row) => row.column_name))
}

function defaultForColumn(column) {
  const type = column.data_type || ''
  if (type.includes('char') || type === 'text') return ''
  if (type === 'date') return localDateISO()
  if (type.includes('time')) return '00:00'
  if (type === 'boolean') return false
  if (type.includes('int') || type === 'numeric' || type === 'real' || type === 'double precision') return 0
  return null
}

async function completeData(client, tableName, data) {
  const columns = await tableColumns(client, tableName)
  const output = { ...data }
  for (const column of columns) {
    if (
      column.is_nullable === 'NO'
      && !column.column_default
      && output[column.column_name] === undefined
    ) {
      output[column.column_name] = defaultForColumn(column)
    }
  }
  return output
}

async function insertExistingColumns(client, tableName, data) {
  const columns = await tableColumnSet(client, tableName)
  const completed = await completeData(client, tableName, data)
  const names = Object.keys(completed).filter((name) => columns.has(name) && completed[name] !== undefined)
  const values = names.map((name) => completed[name])
  const params = names.map((_, index) => `$${index + 1}`)
  await client.query(`INSERT INTO ${tableName} (${names.join(',')}) VALUES (${params.join(',')})`, values)
}

async function updateExistingColumns(client, tableName, data, whereSql, whereValues) {
  const columns = await tableColumnSet(client, tableName)
  const names = Object.keys(data).filter((name) => columns.has(name) && data[name] !== undefined)
  if (!names.length) return
  const sets = names.map((name, index) => `${name}=$${index + 1}`)
  const values = names.map((name) => data[name])
  const adjustedWhereSql = whereSql.replace(/\$(\d+)/g, (_, index) => `$${Number(index) + values.length}`)
  await client.query(`UPDATE ${tableName} SET ${sets.join(',')} WHERE ${adjustedWhereSql}`, [...values, ...whereValues])
}

async function ensureTestMasters(client) {
  await client.query(
    `INSERT INTO erp_credit_type (code, name_1, charge_rate, use_charge_rate)
     SELECT $1::varchar, $2::varchar, $3::varchar, 1
     WHERE NOT EXISTS (SELECT 1 FROM erp_credit_type WHERE code = $1)`,
    [TEST_CREDIT_TYPE, 'BizSuit Test Credit 5%', '5%'],
  )
  await client.query(
    `INSERT INTO erp_wallet_list (code, name_1, account_code)
     SELECT $1::varchar, $2::varchar, ''
     WHERE NOT EXISTS (SELECT 1 FROM erp_wallet_list WHERE code = $1)`,
    [TEST_WALLET, 'BizSuit Test Wallet'],
  )
  const couponData = {
    number: TEST_COUPON,
    amount: 500,
    balance_amount: 500,
    date: localDateISO(),
    date_expire: '2099-12-31',
    last_status: '0',
    coupon_type: '0',
    single_use: '0',
    cust_code: '',
    remark: 'BizSuit regression coupon',
  }
  const existingCoupon = await client.query('SELECT 1 FROM coupon_list WHERE number = $1 LIMIT 1', [TEST_COUPON])
  if (existingCoupon.rows.length) {
    await updateExistingColumns(client, 'coupon_list', couponData, 'number=$1', [TEST_COUPON])
  } else {
    await insertExistingColumns(client, 'coupon_list', couponData)
  }
}

async function firstPrice(item, ctx, qty) {
  const row = await data('/getProductPrice', {
    params: {
      item_code: item.item_code,
      unit_code: item.unit_code,
      barcode: item.barcode || '',
      cust_code: ctx.customer.code,
      qty,
      sale_type: 1,
      vat_type: 1,
      vat_rate: ctx.vatRate,
    },
  })
  return Number((Array.isArray(row) ? row[0] : row)?.price || 0)
}

async function discoverContext() {
  const [posList, formats, erp, masters] = await Promise.all([
    data('/getPOSList'),
    data('/getSaleDocFormatList'),
    data('/getErpOption'),
    data('/getPaymentMasterLists'),
  ])
  const customerRows = await data('/getCustomerList', { params: { search: 'AR00002' } })
  const employees = await data('/getEmployeeList', { params: { search: '' } }).catch(() => [])
  const products = await data('/getProductBarcodeSearch', { params: { search: '10-00001', limit: 20 } })

  const ctx = {
    pos: posList.find((row) => row.pos_id === '880088') || posList[0],
    format: formats.find((row) => row.code === 'CSP') || formats[0],
    customer: customerRows.find((row) => row.code === 'AR00002') || customerRows[0],
    employee: employees[0] || { code: '001', name: 'BizSuit Test' },
    vatRate: Number(erp.vat_rate ?? 7),
    discountType: Number(erp.discout_type ?? 0),
    currencyExchangeDecimal: Number(erp.currency_exchange_decimal ?? 2),
    masters,
  }
  expect(ctx.pos, 'missing POS master')
  expect(ctx.format, 'missing sale doc format')
  expect(ctx.customer?.code, 'missing AR00002 customer')

  const product = products.find((row) => row.item_code && row.unit_code)
  expect(product, 'missing product for sale test')
  const price = await firstPrice(product, ctx, 20)
  expect(price > 0, `product ${product.item_code}/${product.unit_code} has zero sale price`)
  ctx.product = product
  ctx.price = price
  return ctx
}

function buildLine(ctx, qty) {
  const amount = rnd(ctx.price * qty)
  return {
    item_code: ctx.product.item_code,
    item_name: ctx.product.item_name,
    unit_code: ctx.product.unit_code,
    qty,
    price: ctx.price,
    sum_amount: amount,
    discount: '',
    discount_amount: 0,
    tax_type: Number(ctx.product.tax_type ?? 0),
    vat_type: 1,
    vat_rate: ctx.vatRate,
    wh_code: ctx.pos.pos_ic_wht || '',
    shelf_code: ctx.pos.pos_ic_shelf || '',
    stand_value: Number(ctx.product.stand_value) || 1,
    divide_value: Number(ctx.product.divide_value) || 1,
    ratio: Number(ctx.product.ratio) || 1,
    barcode: ctx.product.barcode || '',
    remark: `PHASE1_PAYMENT_${RUN_ID}`,
  }
}

function calcTotals(items) {
  const totalValue = rnd(items.reduce((sum, item) => sum + Number(item.sum_amount), 0))
  const beforeVat = rnd((totalValue * 100) / 107)
  const vatValue = rnd(totalValue - beforeVat)
  return {
    total_value: totalValue,
    total_discount: 0,
    total_before_vat: beforeVat,
    total_vat_value: vatValue,
    total_after_vat: totalValue,
    total_except_vat: 0,
    total_amount: totalValue,
  }
}

function convertItemsToHomeCurrency(items, exchangeRate) {
  return items.map((item) => ({
    ...item,
    price_2: item.price,
    sum_amount_2: item.sum_amount,
    discount_amount_2: item.discount_amount || 0,
    price: rnd(Number(item.price || 0) * exchangeRate),
    sum_amount: rnd(Number(item.sum_amount || 0) * exchangeRate),
    discount_amount: rnd(Number(item.discount_amount || 0) * exchangeRate),
  }))
}

async function chooseCoupon(ctx, totalAmount) {
  const coupons = await data('/getCouponList', {
    params: {
      cust_code: ctx.customer.code,
      doc_date: localDateISO(),
      total_amount: totalAmount,
    },
  }).catch(() => [])
  const coupon = coupons.find((row) => Number(row.available_amount ?? row.balance_amount ?? row.amount) >= 5)
  expect(coupon, 'missing usable coupon >= 5')
  return coupon
}

async function chooseDeposit(ctx) {
  const deposits = await data('/getSaleDepositBalanceList', {
    params: {
      cust_code: ctx.customer.code,
      doc_date: localDateISO(),
    },
  }).catch(() => [])
  const deposit = deposits.find((row) => Number(row.balance_amount) >= 14)
  expect(deposit, 'missing usable sale deposit >= 14 for AR00002')
  return deposit
}

function paymentRows({ masters, coupon, deposit, foreignCurrency }) {
  const homeCurrencyCodes = ['', 'THB', 'BTH', 'TH']
  const passBook = (masters.pass_books || []).find((row) => homeCurrencyCodes.includes(String(row.currency_code || '').toUpperCase())) || masters.pass_books?.[0]
  const pettyCash = (masters.petty_cash || []).find((row) => homeCurrencyCodes.includes(String(row.currency_code || '').toUpperCase())) || masters.petty_cash?.[0]
  const income = masters.income_list?.[0]
  const expense = masters.expense_list?.[0]
  expect(passBook, 'missing pass book master')
  expect(pettyCash, 'missing petty cash master')
  expect(income, 'missing income master')
  expect(expense, 'missing expense master')

  const currencyAmount = 5
  const currencyRate = Number(foreignCurrency.exchange_rate_present)
  const currencyBaht = rnd(currencyAmount * currencyRate)

  return [
    {
      type: 'transfer',
      doc_type: 1,
      amount: 10,
      trans_number: passBook.code,
      pass_book_code: passBook.code,
      bank_code: passBook.bank_code || '',
      bank_branch: passBook.bank_branch || '',
      currency_code: passBook.currency_code || '',
    },
    {
      type: 'cheque',
      doc_type: 2,
      amount: 11,
      sum_amount: 11,
      trans_number: `CHQ${RUN_ID.slice(-8)}`,
      pass_book_code: passBook.code,
      bank_code: passBook.bank_code || '',
      bank_branch: passBook.bank_branch || '',
      chq_due_date: localDateISO(),
      chq_on_hand: 0,
      currency_code: passBook.currency_code || '',
    },
    {
      type: 'credit',
      doc_type: 3,
      amount: 12,
      trans_number: `CARD${RUN_ID.slice(-8)}`,
      credit_card_type: TEST_CREDIT_TYPE,
      no_approved: `APP${RUN_ID.slice(-6)}`,
    },
    {
      type: 'petty',
      doc_type: 4,
      amount: 13,
      trans_number: pettyCash.code,
      currency_code: pettyCash.currency_code || '',
    },
    {
      type: 'deposit',
      doc_type: 5,
      amount: 14,
      trans_number: deposit.doc_no,
      doc_date_ref: deposit.doc_date || '',
      balance_amount: Number(deposit.balance_amount),
    },
    {
      type: 'coupon',
      doc_type: 9,
      amount: 5,
      trans_number: coupon.number,
      balance_amount: Number(coupon.available_amount ?? coupon.balance_amount ?? coupon.amount),
    },
    {
      type: 'expense',
      doc_type: 11,
      amount: 16,
      trans_number: expense.code,
    },
    {
      type: 'income',
      doc_type: 12,
      amount: 15,
      trans_number: income.code,
    },
    {
      type: 'currency',
      doc_type: 19,
      amount: currencyAmount,
      sum_amount: currencyBaht,
      trans_number: foreignCurrency.code,
      currency_code: foreignCurrency.code,
      exchange_rate: currencyRate,
    },
    {
      type: 'wallet',
      doc_type: 21,
      amount: 17,
      trans_number: `WAL${RUN_ID.slice(-8)}`,
      credit_card_type: TEST_WALLET,
      no_approved: `WAPP${RUN_ID.slice(-6)}`,
      ref1: `REF1-${RUN_ID.slice(-6)}`,
      ref2: `REF2-${RUN_ID.slice(-6)}`,
    },
  ]
}

function buildSaveBody(ctx, items, payments, totals) {
  const documentCurrency = (ctx.masters.currencies || []).find((row) => row.code !== 'THB' && Number(row.exchange_rate_present) > 0)
  const documentRate = Number(documentCurrency?.exchange_rate_present || 1)
  const currencyPoint = Number(ctx.currencyExchangeDecimal ?? 2)
  const currencyTotals = totals
  const saveItems = documentCurrency ? convertItemsToHomeCurrency(items, documentRate) : items
  const saveTotals = documentCurrency ? calcTotals(saveItems) : totals
  const creditAmount = payments.filter((row) => row.doc_type === 3).reduce((sum, row) => sum + Number(row.amount), 0)
  const creditCharge = rnd(creditAmount * 0.05)
  const expenseAmount = payments.filter((row) => row.doc_type === 11).reduce((sum, row) => sum + Number(row.amount), 0)
  const currencyBaht = payments.filter((row) => row.doc_type === 19).reduce((sum, row) => sum + Number(row.sum_amount), 0)
  const nonCashPay = payments.reduce((sum, row) => {
    if (row.doc_type === 3) return sum + Number(row.amount) + creditCharge
    if (row.doc_type === 19) return sum + Number(row.sum_amount)
    return sum + Number(row.amount)
  }, 0)
  const totalNet = rnd(saveTotals.total_amount + creditCharge + expenseAmount)
  const cashAmount = rnd(totalNet - nonCashPay)
  expect(cashAmount > 0, 'computed cash balance must be positive')

  return {
    pos_id: ctx.pos.pos_id,
    doc_date: localDateISO(),
    doc_time: new Date().toTimeString().slice(0, 5),
    creator_code: 'bizsuit',
    doc_format_code: ctx.format.code,
    form_code: ctx.format.form_code || '',
    branch_code: ctx.pos.branch_code || '',
    doc_group: 'BZGROUP',
    side_code: 'BZSIDE',
    department_code: 'BZDEPT',
    allocate_code: 'BZALLOC',
    project_code: 'BZPROJ',
    job_code: 'BZJOB',
    contactor: 'BZCONTACT',
    doc_ref: `BZREF-${RUN_ID.slice(-6)}`,
    doc_ref_date: localDateISO(),
    sale_group: 'BZSALE',
    cashier_code: 'BZCASH',
    cust_code: ctx.customer.code,
    emp_code: ctx.employee.code || '001',
    shelf_code: ctx.pos.pos_ic_shelf || '',
    remark: `PHASE1_PAYMENT_${RUN_ID}`,
    inquiry_type: 1,
    vat_type: 1,
    vat_rate: ctx.vatRate,
    discount_type: ctx.discountType,
    discount_word: '',
    discount_word_2: '',
    promotion_discount_amount: 0,
    promotion_extra_discount_amount: 0,
    currency_code: documentCurrency?.code || '',
    exchange_rate: documentRate,
    total_value_2: documentCurrency ? rnd(Number(currencyTotals.total_value || 0), currencyPoint) : 0,
    total_discount_2: documentCurrency ? rnd(Number(currencyTotals.total_discount || 0), currencyPoint) : 0,
    total_amount_2: documentCurrency ? rnd(Number(currencyTotals.total_amount || 0), currencyPoint) : 0,
    ...saveTotals,
    total_net_amount: totalNet,
    cash_amount: cashAmount,
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
    total_other_currency: currencyBaht,
    total_other_currency_charge: 0,
    wallet_amount: 0,
    payment_detail: payments,
    promotion_detail: [],
    items: saveItems,
  }
}

function buildNonCashOverpayBody(ctx, items, totals) {
  const passBook = (ctx.masters.pass_books || []).find((row) => ['', 'THB', 'BTH', 'TH'].includes(String(row.currency_code || '').toUpperCase())) || ctx.masters.pass_books?.[0]
  expect(passBook, 'missing pass book master')
  const totalNet = rnd(totals.total_amount)

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
    remark: `PHASE1_NONCASH_OVERPAY_${RUN_ID}`,
    inquiry_type: 1,
    vat_type: 1,
    vat_rate: ctx.vatRate,
    discount_type: ctx.discountType,
    discount_word: '',
    discount_word_2: '',
    promotion_discount_amount: 0,
    promotion_extra_discount_amount: 0,
    currency_code: '',
    exchange_rate: 1,
    total_value_2: 0,
    total_discount_2: 0,
    total_amount_2: 0,
    ...totals,
    total_net_amount: totalNet,
    cash_amount: 0,
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
    payment_detail: [{
      type: 'transfer',
      doc_type: 1,
      amount: rnd(totalNet + 1),
      trans_number: passBook.code,
      pass_book_code: passBook.code,
      bank_code: passBook.bank_code || '',
      bank_branch: passBook.bank_branch || '',
      currency_code: passBook.currency_code || '',
    }],
    promotion_detail: [],
    items,
  }
}

async function verifySaved(client, docNo, expected) {
  const cb = await client.query('SELECT * FROM cb_trans WHERE doc_no = $1 AND trans_flag = 44 LIMIT 1', [docNo])
  expect(cb.rows[0], `missing cb_trans for ${docNo}`)
  const ic = await client.query(
    `SELECT COALESCE(creator_code, '') AS creator_code,
            COALESCE(currency_code, '') AS currency_code,
            COALESCE(exchange_rate, 1) AS exchange_rate,
            COALESCE(total_amount_2, 0) AS total_amount_2,
            COALESCE(doc_group, '') AS doc_group,
            COALESCE(side_code, '') AS side_code,
            COALESCE(department_code, '') AS department_code,
            COALESCE(allocate_code, '') AS allocate_code,
            COALESCE(project_code, '') AS project_code,
            COALESCE(job_code, '') AS job_code,
            COALESCE(contactor, '') AS contactor,
            COALESCE(doc_ref, '') AS doc_ref,
            doc_ref_date,
            COALESCE(sale_group, '') AS sale_group,
            COALESCE(cashier_code, '') AS cashier_code
     FROM ic_trans WHERE doc_no = $1 AND trans_flag = 44 LIMIT 1`,
    [docNo],
  )
  expect(ic.rows[0]?.creator_code === 'bizsuit', `ic_trans.creator_code expected bizsuit, got ${ic.rows[0]?.creator_code}`)
  expect(money(ic.rows[0]?.exchange_rate) === money(expected.documentRate), `ic_trans exchange_rate expected ${expected.documentRate}, got ${ic.rows[0]?.exchange_rate}`)
  expect(money(ic.rows[0]?.total_amount_2) === money(expected.documentAmount), `ic_trans total_amount_2 expected ${expected.documentAmount}, got ${ic.rows[0]?.total_amount_2}`)
  expect(ic.rows[0]?.doc_group === expected.header.doc_group, `ic_trans doc_group expected ${expected.header.doc_group}, got ${ic.rows[0]?.doc_group}`)
  expect(ic.rows[0]?.side_code === expected.header.side_code, `ic_trans side_code expected ${expected.header.side_code}, got ${ic.rows[0]?.side_code}`)
  expect(ic.rows[0]?.department_code === expected.header.department_code, `ic_trans department_code expected ${expected.header.department_code}, got ${ic.rows[0]?.department_code}`)
  expect(ic.rows[0]?.allocate_code === expected.header.allocate_code, `ic_trans allocate_code expected ${expected.header.allocate_code}, got ${ic.rows[0]?.allocate_code}`)
  expect(ic.rows[0]?.project_code === expected.header.project_code, `ic_trans project_code expected ${expected.header.project_code}, got ${ic.rows[0]?.project_code}`)
  expect(ic.rows[0]?.job_code === expected.header.job_code, `ic_trans job_code expected ${expected.header.job_code}, got ${ic.rows[0]?.job_code}`)
  expect(ic.rows[0]?.contactor === expected.header.contactor, `ic_trans contactor expected ${expected.header.contactor}, got ${ic.rows[0]?.contactor}`)
  expect(ic.rows[0]?.doc_ref === expected.header.doc_ref, `ic_trans doc_ref expected ${expected.header.doc_ref}, got ${ic.rows[0]?.doc_ref}`)
  const actualDocRefDate = ic.rows[0]?.doc_ref_date ? localDateISO(new Date(ic.rows[0].doc_ref_date)) : ''
  expect(actualDocRefDate === expected.header.doc_ref_date, `ic_trans doc_ref_date expected ${expected.header.doc_ref_date}, got ${ic.rows[0]?.doc_ref_date}`)
  expect(ic.rows[0]?.sale_group === expected.header.sale_group, `ic_trans sale_group expected ${expected.header.sale_group}, got ${ic.rows[0]?.sale_group}`)
  expect(ic.rows[0]?.cashier_code === expected.header.cashier_code, `ic_trans cashier_code expected ${expected.header.cashier_code}, got ${ic.rows[0]?.cashier_code}`)
  const itemCurrency = await client.query(
    `SELECT COALESCE(SUM(sum_amount), 0) AS sum_amount,
            COALESCE(SUM(sum_amount_2), 0) AS sum_amount_2
     FROM ic_trans_detail
     WHERE doc_no = $1 AND trans_flag = 44`,
    [docNo],
  )
  expect(money(itemCurrency.rows[0]?.sum_amount_2) === money(expected.documentValue), `ic_trans_detail sum_amount_2 expected ${expected.documentValue}, got ${itemCurrency.rows[0]?.sum_amount_2}`)
  const detail = await client.query(
    `SELECT doc_type, trans_number, amount, sum_amount, charge, pass_book_code, bank_code, bank_branch,
            credit_card_type, no_approved, balance_amount, currency_code, exchange_rate, sum_amount_2,
            ref1, ref2
     FROM cb_trans_detail
     WHERE doc_no = $1 AND trans_flag = 44
     ORDER BY doc_type, line_number`,
    [docNo],
  )
  const rows = detail.rows
  const docTypes = rows.map((row) => Number(row.doc_type)).sort((a, b) => a - b)
  const expectedTypes = [1, 2, 3, 4, 5, 9, 11, 12, 19, 21]
  expect(JSON.stringify(docTypes) === JSON.stringify(expectedTypes), `doc_type mismatch: ${JSON.stringify(docTypes)}`)

  const byType = new Map(rows.map((row) => [Number(row.doc_type), row]))
  expect(money(byType.get(3).charge) === 0.6, `credit charge expected 0.60, got ${byType.get(3).charge}`)
  expect(money(byType.get(3).sum_amount) === 12.6, `credit sum_amount expected 12.60, got ${byType.get(3).sum_amount}`)
  expect(byType.get(3).credit_card_type === TEST_CREDIT_TYPE, 'credit type was not saved')
  expect(byType.get(21).credit_card_type === TEST_WALLET, 'wallet type was not saved')
  expect(money(byType.get(19).sum_amount) === expected.currencyBaht, `currency baht expected ${expected.currencyBaht}, got ${byType.get(19).sum_amount}`)
  expect(money(byType.get(1).sum_amount_2) === 10, 'transfer sum_amount_2 should be filled from currency master')
  expect(money(byType.get(2).sum_amount_2) === 11, 'cheque sum_amount_2 should be filled from currency master')
  expect(money(byType.get(4).sum_amount_2) === 13, 'petty cash sum_amount_2 should be filled from currency master')

  const header = cb.rows[0]
  expect(money(header.total_credit_charge) === 0.6, `cb_trans total_credit_charge expected 0.60, got ${header.total_credit_charge}`)
  expect(money(header.wallet_amount) === 17, `cb_trans wallet_amount expected 17, got ${header.wallet_amount}`)
  expect(money(header.deposit_amount) === 14, `cb_trans deposit_amount expected 14, got ${header.deposit_amount}`)
  expect(money(header.coupon_amount) === 5, `cb_trans coupon_amount expected 5, got ${header.coupon_amount}`)
  expect(money(header.total_other_currency) === expected.currencyBaht, `cb_trans total_other_currency expected ${expected.currencyBaht}, got ${header.total_other_currency}`)
  if (expected.cashAmount !== undefined) {
    expect(money(header.cash_amount) === money(expected.cashAmount), `cb_trans cash_amount expected ${expected.cashAmount}, got ${header.cash_amount}`)
  }
  if (expected.payCashAmount !== undefined) {
    expect(money(header.pay_cash_amount) === money(expected.payCashAmount), `cb_trans pay_cash_amount expected ${expected.payCashAmount}, got ${header.pay_cash_amount}`)
  }
  if (expected.moneyChange !== undefined) {
    expect(money(header.money_change) === money(expected.moneyChange), `cb_trans money_change expected ${expected.moneyChange}, got ${header.money_change}`)
  }
  expect(
    money(header.pay_cash_amount) === money(header.cash_amount) + money(header.money_change),
    `pay_cash_amount should equal cash_amount + money_change, got pay=${header.pay_cash_amount}, cash=${header.cash_amount}, change=${header.money_change}`,
  )

  pass('cb_trans + cb_trans_detail payment doc_type validation', {
    doc_no: docNo,
    doc_types: docTypes.join(','),
    cash_amount: money(header.cash_amount),
    pay_cash_amount: money(header.pay_cash_amount),
    money_change: money(header.money_change),
    total_net_amount: money(header.total_net_amount),
    total_amount_pay: money(header.total_amount_pay),
  })
}

async function verifyNonCashOverpayRejected(body) {
  const result = await api('/saveTransAndPro', { method: 'POST', body, allowStatus: [400] })
  expect(result?.success === false, result?.msg || 'non-cash overpay should be rejected')
  expect(
    /เงินทอนต้องมาจากเงินสด|ไม่ใช่เงินสด/.test(result?.msg || ''),
    `unexpected non-cash overpay message: ${result?.msg || JSON.stringify(result)}`,
  )
  pass('saveTransAndPro rejects non-cash overpay change', { msg: result.msg })
}

function buildForeignCashBody(ctx, items, totals, foreignCurrency) {
  const foreignAmount = 2
  const declaredCashAmount = rnd(foreignAmount * Number(foreignCurrency.exchange_rate_present))
  const currencyPoint = Number(ctx.currencyExchangeDecimal ?? 2)
  const documentRate = Number(foreignCurrency.exchange_rate_present) || 1
  const saveItems = convertItemsToHomeCurrency(items, documentRate)
  const saveTotals = calcTotals(saveItems)
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
    remark: `PHASE1_CASH_FCY_${RUN_ID}`,
    inquiry_type: 1,
    vat_type: 1,
    vat_rate: ctx.vatRate,
    discount_type: ctx.discountType,
    discount_word: '',
    discount_word_2: '',
    promotion_discount_amount: 0,
    promotion_extra_discount_amount: 0,
    currency_code: foreignCurrency?.code || '',
    exchange_rate: documentRate,
    total_value_2: rnd(Number(totals.total_value || 0), currencyPoint),
    total_discount_2: 0,
    total_amount_2: rnd(Number(totals.total_amount || 0), currencyPoint),
    ...saveTotals,
    total_net_amount: saveTotals.total_amount,
    cash_amount: declaredCashAmount,
    pay_cash_amount: declaredCashAmount,
    cash_detail: [{
      currency_code: foreignCurrency.code,
      currency_amount: foreignAmount,
      exchange_rate: 1,
      amount: declaredCashAmount,
    }],
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
    payment_detail: [],
    promotion_detail: [],
    items: saveItems,
  }
}

async function run() {
  const env = readEnv(ENV_PATH)
  const client = new Client({
    host: env.DB_HOST,
    port: Number(env.DB_PORT),
    user: env.DB_USER,
    password: env.DB_PASSWORD || env.DB_PASS,
    database: env.DB_NAME,
  })
  await client.connect()
  try {
    await ensureTestMasters(client)
    pass('test payment masters ensured', { credit_type: TEST_CREDIT_TYPE, wallet: TEST_WALLET })

    const ctx = await discoverContext()
    ctx.masters = await data('/getPaymentMasterLists')
    const foreignCurrency = (ctx.masters.currencies || []).find((row) => row.code !== 'THB' && Number(row.exchange_rate_present) > 0)
    expect(foreignCurrency, 'missing non-THB currency master')
    const qty = 20
    const items = [buildLine(ctx, qty)]
    const total = calcTotals(items)
    const coupon = await chooseCoupon(ctx, total.total_amount)
    const deposit = await chooseDeposit(ctx)
    const payments = paymentRows({ masters: ctx.masters, coupon, deposit, foreignCurrency })
    const body = buildSaveBody(ctx, items, payments, total)
    const oneItem = [buildLine(ctx, 1)]
    await verifyNonCashOverpayRejected(buildNonCashOverpayBody(ctx, oneItem, calcTotals(oneItem)))

    const cashAmountDue = body.cash_amount
    const cashChangeAmount = 7
    body.pay_cash_amount = rnd(body.cash_amount + cashChangeAmount)

    const saved = await api('/saveTransAndPro', { method: 'POST', body })
    expect(saved?.success && saved.doc_no, saved?.msg || 'saveTransAndPro did not return doc_no')
    pass('saveTransAndPro payment document', { doc_no: saved.doc_no, total_amount: total.total_amount, cash_change: cashChangeAmount })

    await verifySaved(client, saved.doc_no, {
      currencyBaht: rnd(5 * Number(foreignCurrency.exchange_rate_present)),
      documentRate: Number(foreignCurrency.exchange_rate_present),
      documentAmount: rnd(total.total_amount, ctx.currencyExchangeDecimal),
      documentValue: rnd(total.total_value, ctx.currencyExchangeDecimal),
      cashAmount: cashAmountDue,
      payCashAmount: body.pay_cash_amount,
      moneyChange: cashChangeAmount,
      header: {
        doc_group: body.doc_group,
        side_code: body.side_code,
        department_code: body.department_code,
        allocate_code: body.allocate_code,
        project_code: body.project_code,
        job_code: body.job_code,
        contactor: body.contactor,
        doc_ref: body.doc_ref,
        doc_ref_date: body.doc_ref_date,
        sale_group: body.sale_group,
        cashier_code: body.cashier_code,
      },
    })

    const cashBody = buildForeignCashBody(ctx, [buildLine(ctx, 1)], calcTotals([buildLine(ctx, 1)]), foreignCurrency)
    const cashSaved = await api('/saveTrans', { method: 'POST', body: cashBody })
    expect(cashSaved?.success && cashSaved.doc_no, cashSaved?.msg || 'saveTrans cash FCY did not return doc_no')
    const cashHeader = await client.query('SELECT COALESCE(cash_amount, 0) AS cash_amount, COALESCE(pay_cash_amount, 0) AS pay_cash_amount FROM cb_trans WHERE doc_no = $1 AND trans_flag = 44 LIMIT 1', [cashSaved.doc_no])
    expect(money(cashHeader.rows[0]?.cash_amount) === money(cashBody.cash_amount), `cash_amount expected ${cashBody.cash_amount}, got ${cashHeader.rows[0]?.cash_amount}`)
    expect(money(cashHeader.rows[0]?.pay_cash_amount) === money(cashBody.cash_amount), `pay_cash_amount expected ${cashBody.cash_amount}, got ${cashHeader.rows[0]?.pay_cash_amount}`)
    pass('foreign cash master-rate validation', { doc_no: cashSaved.doc_no, cash_amount: money(cashHeader.rows[0]?.cash_amount) })
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
