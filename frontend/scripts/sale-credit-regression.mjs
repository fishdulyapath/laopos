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
const CODE_PREFIX = `BZC${RUN_ID.slice(-6)}`
const results = []

const optionNames = [
  'check_overdue',
  'warning_overdue',
  'warning_credit_money',
  'lock_credit_money',
  'request_ar_credit',
  'password_ar_credit',
  'credit_sale_include_deposit',
  'ar_credit_chq_outstanding',
  'sr_ss_credit_check',
]

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
  for (const key of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
    if (process.env[key]) fileEnv[key] = process.env[key]
  }
  return fileEnv
}

function localDateISO(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function rnd(value, point = 2) {
  const factor = 10 ** point
  return Math.round((Number(value) || 0) * factor) / factor
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

function pastDate(days) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return localDateISO(date)
}

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
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!response.ok) {
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
  const columns = result.rows
  columnCache.set(tableName, columns)
  return columns
}

async function tableColumnSet(client, tableName) {
  return new Set((await tableColumns(client, tableName)).map((row) => row.column_name))
}

async function tableExists(client, tableName) {
  const result = await client.query('SELECT to_regclass($1) AS table_name', [`public.${tableName}`])
  return Boolean(result.rows[0]?.table_name)
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
  try {
    await client.query(`INSERT INTO ${tableName} (${names.join(',')}) VALUES (${params.join(',')})`, values)
  } catch (error) {
    error.message = `insert ${tableName} (${names.join(',')}): ${error.message}`
    throw error
  }
}

async function updateExistingColumns(client, tableName, data, whereSql, whereValues) {
  const columns = await tableColumnSet(client, tableName)
  const names = Object.keys(data).filter((name) => columns.has(name) && data[name] !== undefined)
  if (!names.length) return
  const sets = names.map((name, index) => `${name}=$${index + 1}`)
  const values = names.map((name) => data[name])
  const adjustedWhereSql = whereSql.replace(/\$(\d+)/g, (_, index) => `$${Number(index) + values.length}`)
  try {
    await client.query(
      `UPDATE ${tableName} SET ${sets.join(',')} WHERE ${adjustedWhereSql}`,
      [...values, ...whereValues],
    )
  } catch (error) {
    error.message = `update ${tableName} (${names.join(',')}): ${error.message}`
    throw error
  }
}

async function upsertCopiedRow(client, tableName, keyColumn, sourceKey, targetKey, updates) {
  const existing = await client.query(`SELECT 1 FROM ${tableName} WHERE ${keyColumn}=$1 LIMIT 1`, [targetKey])
  if (existing.rows.length) {
    await updateExistingColumns(client, tableName, updates, `${keyColumn}=$${Object.keys(updates).length + 1}`, [targetKey])
    return
  }
  const source = await client.query(`SELECT * FROM ${tableName} WHERE ${keyColumn}=$1 LIMIT 1`, [sourceKey])
  const base = source.rows[0] || {}
  const { roworder: _roworder, ...copyBase } = base
  await insertExistingColumns(client, tableName, { ...copyBase, [keyColumn]: targetKey, ...updates })
}

async function ensureCustomer(client, code, { name, creditMoney, creditStatus = 0, pastDueDay = 0, closeReason = '' }) {
  await upsertCopiedRow(client, 'ar_customer', 'code', 'AR00002', code, {
    code,
    name_1: name,
    search_name: name,
  })
  await upsertCopiedRow(client, 'ar_customer_detail', 'ar_code', 'AR00002', code, {
    ar_code: code,
    credit_money: creditMoney,
    credit_money_max: creditMoney,
    credit_status: creditStatus,
    past_due_day: pastDueDay,
    close_reason: closeReason,
    close_reason_1: 0,
    close_reason_2: 0,
    close_reason_3: 0,
    close_reason_4: 0,
  })
}

async function insertIcTrans(client, data) {
  await insertExistingColumns(client, 'ic_trans', {
    trans_type: 2,
    trans_flag: 44,
    doc_no: data.docNo,
    doc_date: data.docDate || localDateISO(),
    doc_time: '08:00',
    doc_date_calc: data.docDate || localDateISO(),
    credit_date: data.creditDate || data.docDate || localDateISO(),
    due_date: data.creditDate || data.docDate || localDateISO(),
    credit_day: 0,
    cust_code: data.custCode,
    creator_code: 'bizsuit',
    create_datetime: new Date(),
    inquiry_type: data.inquiryType ?? 0,
    vat_type: 1,
    vat_rate: 7,
    total_value: data.totalAmount,
    total_before_vat: data.totalAmount,
    total_after_vat: data.totalAmount,
    total_amount: data.totalAmount,
    total_net_value: data.totalAmount,
    last_status: 0,
    doc_success: 0,
    approve_status: 0,
    is_doc_copy: 0,
    remark: `SALE_CREDIT_REGRESSION_${RUN_ID}`,
  })
}

async function insertCheque(client, { custCode, amount }) {
  if (!(await tableExists(client, 'cb_chq_list'))) return false
  await insertExistingColumns(client, 'cb_chq_list', {
    doc_no: `${CODE_PREFIX}CHQ`,
    trans_number: `${CODE_PREFIX}CHQ`,
    chq_number: `${CODE_PREFIX}CHQ`,
    chq_type: 1,
    ap_ar_code: custCode,
    amount,
    sum_amount: amount,
    status: 0,
    last_status: 0,
    doc_date: localDateISO(),
    chq_due_date: localDateISO(),
    remark: `SALE_CREDIT_REGRESSION_${RUN_ID}`,
  })
  return true
}

async function saveOptions(client) {
  const columns = await tableColumnSet(client, 'erp_option')
  const names = optionNames.filter((name) => columns.has(name))
  const result = await client.query(`SELECT ${names.join(',')} FROM erp_option LIMIT 1`)
  return { names, values: result.rows[0] || {} }
}

async function setOptions(client, saved, values) {
  const data = Object.fromEntries(
    saved.names
      .filter((name) => values[name] !== undefined)
      .map((name) => [name, values[name] ? 1 : 0]),
  )
  await updateExistingColumns(client, 'erp_option', data, '1=1', [])
}

async function restoreOptions(client, saved) {
  await updateExistingColumns(client, 'erp_option', saved.values, '1=1', [])
}

async function ensureApproveUser(client, userCode, password) {
  const exists = await client.query('SELECT 1 FROM erp_user WHERE UPPER(code)=UPPER($1) LIMIT 1', [userCode])
  const data = {
    code: userCode,
    name_1: 'BizSuit Credit Approver',
    password,
    approve_ar_credit: 1,
  }
  if (exists.rows.length > 0) {
    await updateExistingColumns(client, 'erp_user', data, 'UPPER(code)=UPPER($1)', [userCode])
  } else {
    await insertExistingColumns(client, 'erp_user', data)
  }
}

async function firstPrice(item, ctx, qty, custCode) {
  const row = await data('/getProductPrice', {
    params: {
      item_code: item.item_code,
      unit_code: item.unit_code,
      barcode: item.barcode || '',
      cust_code: custCode,
      qty,
      sale_type: 1,
      vat_type: 1,
      vat_rate: ctx.vatRate,
    },
  })
  return Number((Array.isArray(row) ? row[0] : row)?.price || 0)
}

async function discoverContext() {
  const [posList, formats, erp, employees, products] = await Promise.all([
    data('/getPOSList'),
    data('/getSaleDocFormatList'),
    data('/getErpOption'),
    data('/getEmployeeList', { params: { search: '' } }).catch(() => []),
    data('/getProductBarcodeSearch', { params: { search: '10-00001', limit: 20 } }),
  ])
  const product = products.find((row) => row.item_code && row.unit_code)
  expect(product, 'missing product for sale credit test')
  return {
    pos: posList.find((row) => row.pos_id === '880088') || posList[0],
    format: formats.find((row) => row.code === 'CSP') || formats[0],
    employee: employees[0] || { code: '001', name: 'BizSuit Test' },
    vatRate: Number(erp.vat_rate ?? 7),
    discountType: Number(erp.discout_type ?? 0),
    currencyExchangeDecimal: Number(erp.currency_exchange_decimal ?? 2),
    product,
  }
}

function buildLine(ctx, qty, price) {
  const amount = rnd(price * qty)
  return {
    item_code: ctx.product.item_code,
    item_name: ctx.product.item_name,
    unit_code: ctx.product.unit_code,
    qty,
    price,
    sum_amount: amount,
    discount: '',
    discount_amount: 0,
    tax_type: Number(ctx.product.tax_type ?? 0),
    wh_code: ctx.pos.pos_ic_wht || ctx.product.wh_code || '',
    shelf_code: ctx.pos.pos_ic_shelf || ctx.product.shelf_code || '',
    barcode: ctx.product.barcode || '',
    stand_value: 1,
    divide_value: 1,
  }
}

function calcTotals(items, vatRate = 7) {
  const total = rnd(items.reduce((sum, item) => sum + Number(item.sum_amount || 0), 0))
  const beforeVat = rnd((total * 100) / (100 + vatRate))
  const vatValue = rnd(total - beforeVat)
  return {
    total_value: total,
    total_before_vat: beforeVat,
    total_vat_value: vatValue,
    total_after_vat: total,
    total_amount: total,
  }
}

async function buildSaveBody(ctx, custCode, totalAmount, remarkSuffix, confirmations = []) {
  const price = await firstPrice(ctx.product, ctx, 1, custCode)
  expect(price > 0, `product ${ctx.product.item_code}/${ctx.product.unit_code} has zero sale price`)
  const qty = 1
  const line = buildLine(ctx, qty, totalAmount)
  const totals = calcTotals([line], ctx.vatRate)
  return {
    pos_id: ctx.pos.pos_id,
    doc_date: localDateISO(),
    doc_time: new Date().toTimeString().slice(0, 5),
    creator_code: 'bizsuit',
    doc_format_code: ctx.format.code,
    form_code: ctx.format.form_code || '',
    branch_code: ctx.pos.branch_code || '',
    cust_code: custCode,
    emp_code: ctx.employee.code || '001',
    shelf_code: ctx.pos.pos_ic_shelf || '',
    remark: `SALE_CREDIT_${remarkSuffix}_${RUN_ID}`,
    inquiry_type: 0,
    vat_type: 1,
    vat_rate: ctx.vatRate,
    discount_type: ctx.discountType,
    discount_word: '',
    promotion_discount_amount: 0,
    promotion_extra_discount_amount: 0,
    ...totals,
    total_net_amount: totals.total_amount,
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
    payment_detail: [],
    promotion_detail: [],
    credit_confirmations: confirmations,
    items: [line],
  }
}

async function saveSale(ctx, custCode, totalAmount, remarkSuffix, confirmations = [], extra = {}) {
  const body = await buildSaveBody(ctx, custCode, totalAmount, remarkSuffix, confirmations)
  Object.assign(body, extra)
  return api('/saveTransAndPro', { method: 'POST', body })
}

async function run() {
  const env = readEnv(ENV_PATH)
  const client = new Client({
    host: env.DB_HOST,
    port: Number(env.DB_PORT),
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
  })
  await client.connect()
  const savedOptions = await saveOptions(client)
  try {
    const ctx = await discoverContext()
    expect(ctx.pos, 'missing POS master')
    expect(ctx.format, 'missing sale doc format')

    const customers = {
      ok: `${CODE_PREFIX}OK`,
      limit: `${CODE_PREFIX}LM`,
      due: `${CODE_PREFIX}DU`,
      closed: `${CODE_PREFIX}CL`,
      component: `${CODE_PREFIX}CP`,
      password: `${CODE_PREFIX}PW`,
    }
    await ensureCustomer(client, customers.ok, { name: 'BizSuit Credit OK', creditMoney: 100000 })
    await ensureCustomer(client, customers.limit, { name: 'BizSuit Credit Limit', creditMoney: 100 })
    await ensureCustomer(client, customers.due, { name: 'BizSuit Credit Overdue', creditMoney: 100000, pastDueDay: 0 })
    await ensureCustomer(client, customers.closed, { name: 'BizSuit Credit Closed', creditMoney: 100000, creditStatus: 2, closeReason: 'Regression close credit' })
    await ensureCustomer(client, customers.component, { name: 'BizSuit Credit Component', creditMoney: 1000 })
    await ensureCustomer(client, customers.password, { name: 'BizSuit Credit Password', creditMoney: 100 })
    const approveUser = `${CODE_PREFIX}AP`
    const approvePassword = `PW${RUN_ID}`
    await ensureApproveUser(client, approveUser, approvePassword)

    await insertIcTrans(client, {
      docNo: `${CODE_PREFIX}DUE`,
      custCode: customers.due,
      totalAmount: 50,
      docDate: pastDate(30),
      creditDate: pastDate(20),
    })
    await insertIcTrans(client, {
      docNo: `${CODE_PREFIX}AR`,
      custCode: customers.component,
      totalAmount: 800,
      docDate: pastDate(1),
      creditDate: localDateISO(),
    })
    await insertIcTrans(client, {
      docNo: `${CODE_PREFIX}DEP`,
      custCode: customers.component,
      totalAmount: 300,
      docDate: pastDate(1),
      creditDate: localDateISO(),
      inquiryType: 1,
    })
    await updateExistingColumns(client, 'ic_trans', { trans_flag: 40 }, `doc_no=$1`, [`${CODE_PREFIX}DEP`])
    const insertedChq = await insertCheque(client, { custCode: customers.component, amount: 150 })
    pass('test credit customers and balances prepared', {
      prefix: CODE_PREFIX,
      cheque_source: insertedChq ? 'cb_chq_list' : 'missing cb_chq_list',
    })

    await setOptions(client, savedOptions, {
      check_overdue: false,
      warning_overdue: true,
      warning_credit_money: true,
      lock_credit_money: false,
      request_ar_credit: false,
      password_ar_credit: false,
      credit_sale_include_deposit: false,
      ar_credit_chq_outstanding: false,
      sr_ss_credit_check: false,
    })

    const ok = await saveSale(ctx, customers.ok, 300, 'OK')
    expect(ok?.success && ok.doc_no, `credit OK should save: ${JSON.stringify(ok)}`)
    pass('credit sale within limit saved', { cust_code: customers.ok, doc_no: ok.doc_no })

    const limitWarn = await saveSale(ctx, customers.limit, 300, 'LIMIT_WARN')
    expect(limitWarn?.success === false && limitWarn.require_confirm === 'credit_over_limit_warning', `over-limit should warn: ${JSON.stringify(limitWarn)}`)
    pass('credit over-limit returned warning', { cust_code: customers.limit, code: limitWarn.code })
    const limitConfirm = await saveSale(ctx, customers.limit, 300, 'LIMIT_CONFIRM', ['credit_over_limit_warning'])
    expect(limitConfirm?.success && limitConfirm.doc_no, `over-limit confirm should save: ${JSON.stringify(limitConfirm)}`)
    pass('credit over-limit confirmation saved', { cust_code: customers.limit, doc_no: limitConfirm.doc_no })

    const dueWarn = await saveSale(ctx, customers.due, 100, 'DUE_WARN')
    expect(dueWarn?.success === false && dueWarn.require_confirm === 'overdue_warning', `overdue should warn: ${JSON.stringify(dueWarn)}`)
    pass('overdue customer returned warning', { cust_code: customers.due, code: dueWarn.code })
    const dueConfirm = await saveSale(ctx, customers.due, 100, 'DUE_CONFIRM', ['overdue_warning'])
    expect(dueConfirm?.success && dueConfirm.doc_no, `overdue confirm should save: ${JSON.stringify(dueConfirm)}`)
    pass('overdue confirmation saved', { cust_code: customers.due, doc_no: dueConfirm.doc_no })

    const closed = await saveSale(ctx, customers.closed, 100, 'CLOSED')
    expect(closed?.success === false && closed.code === 'SALE_CREDIT_STATUS_BLOCKED', `closed credit should block: ${JSON.stringify(closed)}`)
    pass('closed credit customer blocked', { cust_code: customers.closed, code: closed.code })

    await setOptions(client, savedOptions, {
      check_overdue: false,
      warning_overdue: false,
      warning_credit_money: true,
      lock_credit_money: true,
      request_ar_credit: false,
      password_ar_credit: true,
      credit_sale_include_deposit: false,
      ar_credit_chq_outstanding: false,
      sr_ss_credit_check: false,
    })
    const passwordRequired = await saveSale(ctx, customers.password, 300, 'PASSWORD_REQUIRED')
    expect(passwordRequired?.success === false && passwordRequired.require_approve_password === true, `password approval should be required: ${JSON.stringify(passwordRequired)}`)
    pass('credit password approval required', { cust_code: customers.password, code: passwordRequired.code })
    const passwordApproved = await saveSale(ctx, customers.password, 300, 'PASSWORD_APPROVED', [], {
      credit_approve: { user_code: approveUser, password: approvePassword },
    })
    expect(passwordApproved?.success && passwordApproved.doc_no, `password approval should save: ${JSON.stringify(passwordApproved)}`)
    const approvedDoc = await client.query('SELECT COALESCE(user_approve, \'\') AS user_approve FROM ic_trans WHERE doc_no=$1 AND trans_flag=44 LIMIT 1', [passwordApproved.doc_no])
    expect(approvedDoc.rows[0]?.user_approve === approveUser, `user_approve should be ${approveUser}: ${JSON.stringify(approvedDoc.rows[0])}`)
    pass('credit password approval saved user_approve', { cust_code: customers.password, doc_no: passwordApproved.doc_no, user_approve: approveUser })

    await setOptions(client, savedOptions, {
      check_overdue: false,
      warning_overdue: false,
      warning_credit_money: true,
      lock_credit_money: false,
      request_ar_credit: false,
      password_ar_credit: false,
      credit_sale_include_deposit: true,
      ar_credit_chq_outstanding: true,
      sr_ss_credit_check: false,
    })
    const component = await saveSale(ctx, customers.component, 300, 'COMPONENT')
    expect(component?.success && component.doc_no, `AR+cheque-deposit formula should allow save: ${JSON.stringify(component)}`)
    pass('AR balance plus cheque minus deposit formula allowed save', {
      cust_code: customers.component,
      doc_no: component.doc_no,
      ar_balance: 800,
      cheque: insertedChq ? 150 : 0,
      deposit: 300,
      credit_money: 1000,
    })
  } finally {
    await restoreOptions(client, savedOptions).catch((error) => fail('restore erp_option', error))
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
