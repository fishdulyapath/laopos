const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:47309/service/v1'
const RUN_ID = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(2, 14)
const results = []

function pass(name, extra = {}) { results.push({ status: 'PASS', name, ...extra }) }
function fail(name, error) { results.push({ status: 'FAIL', name, error: error?.message || String(error) }) }
function skip(name, reason) { results.push({ status: 'SKIP', name, reason }) }

function rnd(value, point = 2) {
  const factor = 10 ** point
  return Math.round((Number(value) || 0) * factor) / factor
}

function localDateISO(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
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
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!response.ok && !allowStatus.includes(response.status)) {
    throw new Error(`${method} ${pathname} ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`)
  }
  return { status: response.status, data }
}

async function getData(pathname, options) {
  const result = await api(pathname, options)
  return result.data?.data ?? result.data
}

async function priceFor(unit, ctx, qty = 1) {
  const rows = await getData('/getProductPrice', {
    params: {
      item_code: unit.item_code,
      unit_code: unit.unit_code,
      cust_code: ctx.customer.code,
      qty,
      sale_type: 1,
      vat_type: 1,
      vat_rate: ctx.vatRate,
    },
  })
  const row = Array.isArray(rows) ? rows[0] : rows
  return Number(row?.price ?? unit.price ?? 0)
}

function buildLine(unit, price, qty = 1, vatRate = 7) {
  return {
    item_code: unit.item_code,
    item_name: unit.item_name,
    unit_code: unit.unit_code,
    qty,
    price,
    sum_amount: rnd(price * qty),
    discount: '',
    discount_amount: 0,
    tax_type: Number(unit.tax_type ?? 0),
    vat_type: 1,
    vat_rate: vatRate,
    wh_code: unit.wh_code || '',
    shelf_code: unit.shelf_code || '',
    stand_value: Number(unit.stand_value) || 1,
    divide_value: Number(unit.divide_value) || 1,
    ratio: Number(unit.ratio) || 1,
    item_type: Number(unit.item_type) || 0,
    barcode: unit.barcode || '',
    sub_item: [],
  }
}

function totalsForVatIncluded(items, vatRate) {
  const totalValue = rnd(items.reduce((sum, item) => sum + Number(item.sum_amount), 0))
  const beforeVat = rnd((totalValue * 100) / (100 + Number(vatRate || 7)))
  const vatValue = rnd(totalValue - beforeVat)
  return {
    total_value: totalValue,
    total_discount: 0,
    total_before_vat: beforeVat,
    total_vat_value: vatValue,
    total_after_vat: totalValue,
    total_except_vat: 0,
    total_amount: totalValue,
    total_value_2: totalValue,
    total_discount_2: 0,
    total_amount_2: totalValue,
    total_net_amount: totalValue,
  }
}

function baseBody(ctx, items, totals, overrides = {}) {
  return {
    pos_id: ctx.pos.pos_id,
    doc_date: localDateISO(),
    doc_time: new Date().toTimeString().slice(0, 5),
    creator_code: 'bizsuit-regression',
    doc_format_code: ctx.format.code,
    form_code: ctx.format.form_code || '',
    branch_code: ctx.pos.branch_code || '',
    cust_code: ctx.customer.code,
    emp_code: ctx.employee.code || '001',
    shelf_code: ctx.pos.pos_ic_shelf || '',
    remark: `SALE_TOTAL_MISMATCH_${RUN_ID}`,
    inquiry_type: 1,
    vat_type: 1,
    vat_rate: ctx.vatRate,
    discount_type: ctx.discountType,
    discount_word: '',
    promotion_discount_amount: 0,
    promotion_extra_discount_amount: 0,
    currency_code: '',
    exchange_rate: 1,
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
    payment_detail: [],
    promotion_detail: [],
    items,
    ...totals,
    cash_amount: totals.total_net_amount,
    cash_detail: [{ currency_code: 'THB', currency_amount: totals.total_net_amount, exchange_rate: 1, amount: totals.total_net_amount }],
    ...overrides,
  }
}

async function discoverContext() {
  const [posList, formats, erp] = await Promise.all([
    getData('/getPOSList'),
    getData('/getSaleDocFormatList'),
    getData('/getErpOption'),
  ])
  const customers = await getData('/getCustomerList', { params: { search: '' } })
  const employees = await getData('/getEmployeeList', { params: { search: '' } }).catch(() => [])
  const ctx = {
    pos: posList[0],
    format: formats.find((row) => row.code === 'CSP') || formats[0],
    customer: customers[0],
    employee: employees[0] || { code: '001' },
    vatRate: Number(erp.vat_rate ?? 7),
    discountType: Number(erp.discout_type ?? 0),
  }
  if (!ctx.pos || !ctx.format || !ctx.customer) throw new Error('missing POS, sale format, or customer')
  return ctx
}

async function discoverStockUnit(ctx) {
  const products = await getData('/getProductList', { params: { isstock: '1', limit: 100 } })
  for (const product of products || []) {
    const details = await getData('/getProductDetail', {
      params: {
        item_code: product.item_code,
        cust_code: ctx.customer.code,
        sale_type: 1,
        vat_type: 1,
        vat_rate: ctx.vatRate,
      },
    }).catch(() => [])
    for (const unit of details || []) {
      const price = await priceFor(unit, ctx).catch(() => 0)
      if (price > 0) return { unit, price }
    }
  }
  return null
}

async function testMismatchRejectAndRetry(ctx, unit, price) {
  const name = 'saveTransAndPro rejects mismatched totals and accepts server totals retry'
  try {
    const items = [buildLine(unit, price, 1, ctx.vatRate)]
    const canonical = totalsForVatIncluded(items, ctx.vatRate)
    const wrongTotals = {
      ...canonical,
      total_amount: rnd(canonical.total_amount + 1),
      total_amount_2: rnd(canonical.total_amount_2 + 1),
      total_net_amount: rnd(canonical.total_net_amount + 1),
    }
    const wrongBody = baseBody(ctx, items, wrongTotals)
    const rejected = await api('/saveTransAndPro', { method: 'POST', body: wrongBody, allowStatus: [422] })
    if (rejected.status !== 422 || rejected.data?.code !== 'SALE_TOTAL_MISMATCH') {
      throw new Error(`expected 422 SALE_TOTAL_MISMATCH, got ${rejected.status}: ${JSON.stringify(rejected.data)}`)
    }

    const serverTotals = rejected.data.server_totals || {}
    const retryBody = baseBody(ctx, items, canonical, {
      ...serverTotals,
      accept_server_totals: true,
      cash_amount: Number(serverTotals.total_net_amount ?? serverTotals.total_amount ?? canonical.total_amount),
      cash_detail: [{
        currency_code: 'THB',
        currency_amount: Number(serverTotals.total_net_amount ?? serverTotals.total_amount ?? canonical.total_amount),
        exchange_rate: 1,
        amount: Number(serverTotals.total_net_amount ?? serverTotals.total_amount ?? canonical.total_amount),
      }],
    })
    const saved = await api('/saveTransAndPro', { method: 'POST', body: retryBody })
    if (!saved.data?.success || !saved.data.doc_no) throw new Error(saved.data?.msg || 'retry saveTransAndPro did not return doc_no')
    pass(name, { doc_no: saved.data.doc_no })
  } catch (error) {
    fail(name, error)
  }
}

async function run() {
  try {
    const ctx = await discoverContext()
    const stock = await discoverStockUnit(ctx)
    if (!stock) {
      skip('saveTransAndPro total mismatch regression', 'missing priced stock unit')
    } else {
      await testMismatchRejectAndRetry(ctx, stock.unit, stock.price)
    }
  } catch (error) {
    fail('discover context', error)
  }

  console.table(results)
  const failed = results.filter((row) => row.status === 'FAIL')
  if (failed.length) process.exitCode = 1
}

await run()
