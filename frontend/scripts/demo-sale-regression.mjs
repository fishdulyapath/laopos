const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:47300/service/v1'
const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
const results = []
const docs = []

function pass(name, extra = {}) {
  results.push({ status: 'PASS', name, ...extra })
}

function skip(name, reason) {
  results.push({ status: 'SKIP', name, reason })
}

function fail(name, error) {
  results.push({ status: 'FAIL', name, error: error?.message || String(error) })
}

function rnd(value, point = 2) {
  const f = 10 ** point
  return Math.round((Number(value) || 0) * f) / f
}

function localDateISO(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

async function api(path, { method = 'GET', params, body } = {}) {
  const url = new URL(`${BASE_URL}${path}`)
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  })
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`)
  return data
}

async function data(path, opts) {
  const json = await api(path, opts)
  return json?.data ?? json
}

async function clearBasket(basketId) {
  await api('/clearBasket', { method: 'POST', body: { basket_id: basketId } })
}

async function setBasketInfo(basketId, ctx, override = {}) {
  await api('/setBasketInfo', {
    method: 'POST',
    body: {
      basket_id: basketId,
      cust_code: ctx.cust.code,
      cust_name: ctx.cust.name,
      inquiry_type: override.inquiry_type ?? 1,
      vat_type: override.vat_type ?? 1,
      vat_rate: ctx.vatRate,
      sale_code: ctx.emp.code,
      sale_name: ctx.emp.name,
      doc_format_code: ctx.format.code,
    },
  })
}

async function priceFor(unit, ctx, qty = 1, inquiryType = 1, vatType = 1) {
  const priceRows = await data('/getProductPrice', {
    params: {
      item_code: unit.item_code,
      unit_code: unit.unit_code,
      cust_code: ctx.cust.code,
      qty,
      sale_type: inquiryType,
      vat_type: vatType,
      vat_rate: ctx.vatRate,
    },
  })
  const row = Array.isArray(priceRows) ? priceRows[0] : priceRows
  return Number(row?.price ?? unit.price ?? 0)
}

function line(unit, price, qty = 1, remark = '') {
  const sum = rnd(price * qty)
  return {
    item_code: unit.item_code,
    item_name: unit.item_name,
    unit_code: unit.unit_code,
    qty,
    price,
    sum_amount: sum,
    discount: '',
    discount_amount: 0,
    tax_type: Number(unit.tax_type ?? 0),
    wh_code: unit.wh_code || '',
    shelf_code: unit.shelf_code || '',
    stand_value: Number(unit.stand_value) || 1,
    divide_value: Number(unit.divide_value) || 1,
    ratio: Number(unit.ratio) || 1,
    barcode: unit.barcode || '',
    remark,
  }
}

function totals(lines, discountWord = '') {
  const totalValue = rnd(lines.reduce((sum, item) => sum + Number(item.sum_amount), 0))
  const totalDiscount = discountWord === '5%' ? rnd(totalValue * 0.05) : 0
  const totalAmount = rnd(totalValue - totalDiscount)
  const beforeVat = rnd((totalAmount * 100) / 107)
  const vatValue = rnd(totalAmount - beforeVat)
  return {
    total_value: totalValue,
    total_discount: totalDiscount,
    total_before_vat: beforeVat,
    total_vat_value: vatValue,
    total_after_vat: totalAmount,
    total_except_vat: 0,
    total_amount: totalAmount,
    total_net_amount: totalAmount,
  }
}

async function saveSale(ctx, { name, unit, qty = 1, inquiryType = 1, discountWord = '', lineRemark = '', cashAmount }) {
  const price = await priceFor(unit, ctx, qty, inquiryType, 1)
  if (price <= 0) throw new Error(`${unit.item_code}/${unit.unit_code} has zero price`)
  const items = [line(unit, price, qty, lineRemark)]
  const total = totals(items, discountWord)
  const body = {
    pos_id: ctx.pos.pos_id,
    basket_id: ctx.basketId,
    doc_date: localDateISO(),
    doc_time: new Date().toTimeString().slice(0, 5),
    creator_code: 'bizsuit',
    doc_format_code: ctx.format.code,
    form_code: ctx.format.form_code || '',
    branch_code: ctx.pos.branch_code || '',
    cust_code: ctx.cust.code,
    emp_code: ctx.emp.code,
    shelf_code: ctx.pos.pos_ic_shelf || '',
    remark: `BIZSUIT_TEST_${runId}_${name}`,
    inquiry_type: inquiryType,
    vat_type: 1,
    vat_rate: ctx.vatRate,
    discount_type: ctx.discountType,
    discount_word: discountWord,
    ...total,
    cash_amount: cashAmount ?? total.total_amount,
    rounded_amount: 0,
    total_income_amount: 0,
    tranfer_amount: 0,
    card_amount: 0,
    total_credit_charge: 0,
    wallet_amount: 0,
    payment_detail: [],
    items,
  }
  let saved = await api('/saveTrans', { method: 'POST', body })
  if (!saved?.success && ['overdue_warning', 'credit_over_limit_warning'].includes(saved?.require_confirm)) {
    const confirmations = [saved.require_confirm]
    saved = await api('/saveTrans', {
      method: 'POST',
      body: {
        ...body,
        credit_confirmations: confirmations,
      },
    })
  }
  if (!saved.success || !saved.doc_no) throw new Error(saved.msg || 'saveTrans did not return doc_no')
  docs.push(saved.doc_no)
  const detail = await data('/getDocSaleHistoryDetail', { params: { doc_no: saved.doc_no } })
  if (!detail?.header) throw new Error('missing sale detail header')
  if (Math.abs(Number(detail.header.total_amount) - Number(total.total_amount)) > 0.01) throw new Error('saved total mismatch')
  pass(name, { doc_no: saved.doc_no, total: total.total_amount })
  return saved.doc_no
}

async function firstPricedUnit(product, ctx, inquiryType = 1) {
  const details = await data('/getProductDetail', {
    params: {
      item_code: product.item_code,
      cust_code: ctx.cust.code,
      sale_type: inquiryType,
      vat_type: 1,
      vat_rate: ctx.vatRate,
    },
  }).catch(() => [])
  for (const unit of details) {
    const price = await priceFor(unit, ctx, 1, inquiryType, 1).catch(() => 0)
    if (price > 0) return unit
  }
  if (String(product.item_type ?? '') === '1' && details[0]) return details[0]
  return null
}

async function discover() {
  const [posList, baskets, formats, erp] = await Promise.all([
    data('/getPOSList'),
    data('/getBasketList'),
    data('/getSaleDocFormatList'),
    data('/getErpOption'),
  ])
  const customers = await data('/getCustomerList', { params: { search: 'AR' } }).catch(() => [])
  const employees = await data('/getEmployeeList', { params: { search: '' } }).catch(() => [])
  const ctx = {
    pos: posList[0],
    basketId: baskets[0]?.basket_id,
    format: formats[0],
    cust: { code: customers[0]?.code || '', name: customers[0]?.name || customers[0]?.name_1 || 'ลูกค้าทั่วไป' },
    emp: { code: employees[0]?.code || 'BIZTEST', name: employees[0]?.name || employees[0]?.name_1 || 'BizSuit Test' },
    vatRate: Number(erp.vat_rate ?? 7),
    discountType: Number(erp.discout_type ?? 0),
  }
  if (!ctx.pos || !ctx.basketId || !ctx.format) throw new Error('missing POS, basket, or sale doc format')

  const products = await data('/getProductList', { params: { isstock: '1', limit: 100 } })
  for (const product of products) {
    if (String(product.item_type ?? '') === '1') continue
    const unit = await firstPricedUnit(product, ctx, 1)
    if (unit && Number(unit.balance_qty ?? 0) >= 3) {
      ctx.stockUnit = unit
      break
    }
  }
  if (!ctx.stockUnit) throw new Error('missing priced stock unit')

  const serviceCandidates = await data('/getProductList', { params: { search: 'ค่าตักพาเลท', limit: 20 } }).catch(() => [])
  for (const product of serviceCandidates) {
    if (String(product.item_type ?? '') !== '1') continue
    const unit = await firstPricedUnit(product, ctx, 3)
    if (unit) {
      ctx.serviceUnit = unit
      break
    }
  }

  const detailUnits = await data('/getProductDetail', {
    params: {
      item_code: ctx.stockUnit.item_code,
      cust_code: ctx.cust.code,
      sale_type: 1,
      vat_type: 1,
      vat_rate: ctx.vatRate,
    },
  })
  ctx.barcodeUnit = detailUnits.find((unit) => unit.barcode) || null
  return ctx
}

async function testServiceStockBypass(ctx) {
  if (!ctx.serviceUnit) {
    skip('service item stock bypass', 'service item not found via product API')
    return
  }
  skip('service item stock bypass', 'shared cart stock endpoints are intentionally unchanged')
}

async function run() {
  const ctx = await discover()
  await clearBasket(ctx.basketId)
  await setBasketInfo(ctx.basketId, ctx)
  pass('reference data', {
    pos: ctx.pos.pos_id,
    basket: ctx.basketId,
    doc_format: ctx.format.code,
    stock_item: `${ctx.stockUnit.item_code}/${ctx.stockUnit.unit_code}`,
    service_item: ctx.serviceUnit ? `${ctx.serviceUnit.item_code}/${ctx.serviceUnit.unit_code}` : 'none',
  })

  await testServiceStockBypass(ctx)

  await saveSale(ctx, { name: 'cash sale with bill discount', unit: ctx.stockUnit, discountWord: '5%' })
  await saveSale(ctx, { name: 'credit sale without payment', unit: ctx.stockUnit, inquiryType: 0, cashAmount: 0 })

  if (ctx.serviceUnit) {
    await saveSale(ctx, { name: 'service item sale stock exempt', unit: ctx.serviceUnit, inquiryType: 3 })
  }

  if (ctx.barcodeUnit?.barcode) {
    const barcodeDetail = await data('/getProductByBarcodeDetail', { params: { barcode: ctx.barcodeUnit.barcode } })
    if (barcodeDetail.unit_code !== ctx.barcodeUnit.unit_code) throw new Error('barcode unit mismatch')
    pass('barcode resolves selling unit', { item: barcodeDetail.item_code, unit: barcodeDetail.unit_code })
  } else {
    skip('barcode resolves selling unit', 'stock item has no barcode unit')
  }

  await clearBasket(ctx.basketId)
}

try {
  await run()
} catch (error) {
  fail('fatal', error)
}

const failed = results.filter((row) => row.status === 'FAIL')
console.log(JSON.stringify({ baseUrl: BASE_URL, runId, docs, failed: failed.length, results }, null, 2))
process.exitCode = failed.length ? 1 : 0
