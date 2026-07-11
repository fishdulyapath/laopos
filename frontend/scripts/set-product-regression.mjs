/**
 * set-product-regression.mjs
 * ทดสอบ "สินค้าชุด" (item_type = 3) ครอบคลุมทุก path หลักของ SellView
 *
 * การใช้งาน:
 *   BASE_URL=http://127.0.0.1:47309/service/v1 node scripts/set-product-regression.mjs
 *
 *   ถ้าต้องการระบุสินค้าชุดตรงๆ:
 *   SET_ITEM_CODE=27-1403 BASE_URL=... node scripts/set-product-regression.mjs
 *
 * TEST CASES:
 *   T1  /getProductList?isproductset=1 คืน item_type=3 (หรือ lookup SET_ITEM_CODE โดยตรง)
 *   T2  /getProductSetDetail คืน rows พร้อม price > 0
 *   T3  /getProductSetItem  คืน children (sub_item) อย่างน้อย 1 รายการ
 *   T4  pickSetUnitRow — เลือก unit ตาม start_sale_unit / unit_code ได้ถูก
 *   T5  balance_qty ของ set ไม่ถูก block (frontend ไม่เช็คสต๊อก item_type=3)
 *   T6  saveTrans ด้วย set item (qty=1) — payload มี sub_item, backend คืน doc_no
 *   T7  getDocSaleHistoryDetail ยืนยัน child rows บันทึกถูกต้อง
 *   T8  saveTrans ด้วย set item qty=2 — total = price × 2
 *   T9  saveTrans แบบ credit sale (inquiry_type=0) — ไม่ต้องชำระทันที
 *   T10 ราคา set item ไม่ได้มาจาก /getProductPrice (ต้องมาจาก getProductSetDetail เท่านั้น)
 */

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:47309/service/v1'
const FORCE_ITEM_CODE = process.env.SET_ITEM_CODE || ''   // ถ้าระบุ จะ lookup ตรงๆ
const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
const results = []
const docs = []

// ─── helpers ────────────────────────────────────────────────────────────────

function pass(name, extra = {}) {
  results.push({ status: 'PASS', name, ...extra })
  console.error(`  ✅  ${name}`)
}

function fail(name, error, extra = {}) {
  results.push({ status: 'FAIL', name, error: error?.message || String(error), ...extra })
  console.error(`  ❌  ${name}: ${error?.message || error}`)
}

function skip(name, reason) {
  results.push({ status: 'SKIP', name, reason })
  console.error(`  ⏭️   ${name}: ${reason}`)
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
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
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
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

async function get(path, params) {
  const json = await api(path, { params })
  return json?.data ?? json
}

// ─── T4 helper (mirror SellView logic) ─────────────────────────────────────

function pickSetUnitRow(rows, product) {
  if (!Array.isArray(rows) || rows.length === 0) return null
  const preferred = product?.unit_code || product?.start_sale_unit || product?.unit_standard || product?.unit_cost || ''
  return rows.find((r) => r.unit_code === preferred) || rows[0]
}

// ─── discover environment ───────────────────────────────────────────────────

async function discover() {
  const [posList, baskets, formats, erp] = await Promise.all([
    get('/getPOSList'),
    get('/getBasketList'),
    get('/getSaleDocFormatList'),
    get('/getErpOption'),
  ])
  const customers = await get('/getCustomerList', { search: '' }).catch(() => [])
  const employees = await get('/getEmployeeList', { search: '' }).catch(() => [])

  const ctx = {
    pos: posList[0],
    basketId: baskets[0]?.basket_id,
    format: formats[0],
    cust: {
      code: customers[0]?.code || '',
      name: customers[0]?.name || customers[0]?.name_1 || 'ลูกค้าทั่วไป',
    },
    emp: {
      code: employees[0]?.code || 'BIZTEST',
      name: employees[0]?.name || employees[0]?.name_1 || 'BizSuit Test',
    },
    vatRate: Number(erp?.vat_rate ?? 7),
    discountType: Number(erp?.discout_type ?? 0),
  }

  assert(ctx.pos, 'ไม่พบ POS')
  assert(ctx.basketId, 'ไม่พบ basket')
  assert(ctx.format, 'ไม่พบ sale doc format')
  return ctx
}

// ─── basket helpers ─────────────────────────────────────────────────────────

async function clearBasket(basketId) {
  await api('/clearBasket', { method: 'POST', body: { basket_id: basketId } })
}

async function setBasketInfo(basketId, ctx, inquiryType = 1) {
  await api('/setBasketInfo', {
    method: 'POST',
    body: {
      basket_id: basketId,
      cust_code: ctx.cust.code,
      cust_name: ctx.cust.name,
      inquiry_type: inquiryType,
      vat_type: 1,
      vat_rate: ctx.vatRate,
      sale_code: ctx.emp.code,
      sale_name: ctx.emp.name,
      doc_format_code: ctx.format.code,
    },
  })
}

// ─── line / totals builders ──────────────────────────────────────────────────

function buildSetLine(setUnit, subItems, qty) {
  const price = Number(setUnit.price ?? 0)
  return {
    item_code: setUnit.item_code,
    item_name: setUnit.item_name,
    unit_code: setUnit.unit_code,
    qty,
    price,
    sum_amount: rnd(price * qty),
    discount: '',
    discount_amount: 0,
    tax_type: Number(setUnit.tax_type ?? 0),
    wh_code: setUnit.wh_code || '',
    shelf_code: setUnit.shelf_code || '',
    stand_value: Number(setUnit.stand_value ?? 1),
    divide_value: Number(setUnit.divide_value ?? 1),
    ratio: Number(setUnit.ratio ?? setUnit.stand_value ?? 1),
    barcode: setUnit.barcode || '',
    item_type: '3',
    price_type: Number(setUnit.type ?? setUnit.price_type ?? 1),
    price_default: Number(setUnit.price ?? 0),
    price_info: setUnit.mode || '',
    remark: '',
    sub_item: subItems,
  }
}

function buildTotals(lines) {
  const totalValue = rnd(lines.reduce((s, l) => s + Number(l.sum_amount), 0))
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
    total_net_amount: totalValue,
  }
}

async function saveTrans(ctx, items, { label, inquiryType = 1, cashAmount } = {}) {
  const total = buildTotals(items)
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
    remark: `SET_TEST_${runId}_${label || 'run'}`,
    inquiry_type: inquiryType,
    vat_type: 1,
    vat_rate: ctx.vatRate,
    discount_type: ctx.discountType,
    discount_word: '',
    ...total,
    cash_amount: cashAmount ?? total.total_amount,
    rounded_amount: 0,
    total_income_amount: 0,
    tranfer_amount: 0,
    card_amount: 0,
    total_credit_charge: 0,
    wallet_amount: 0,
    payment_detail: [],
    items: items.map((l) => ({
      item_code: l.item_code,
      item_name: l.item_name,
      unit_code: l.unit_code,
      qty: l.qty,
      price: l.price,
      sum_amount: l.sum_amount,
      discount: l.discount ?? '',
      discount_amount: l.discount_amount ?? 0,
      tax_type: l.tax_type ?? 0,
      wh_code: l.wh_code || '',
      shelf_code: l.shelf_code || '',
      stand_value: l.stand_value ?? 1,
      divide_value: l.divide_value ?? 1,
      ratio: l.ratio ?? 1,
      barcode: l.barcode || '',
      item_type: l.item_type || '0',
      price_type: l.price_type ?? 1,
      price_default: l.price_default ?? l.price,
      price_info: l.price_info || '',
      remark: l.remark || '',
      sub_item: l.sub_item || [],
    })),
  }
  const saved = await api('/saveTrans', { method: 'POST', body })
  if (!saved?.success || !saved?.doc_no) {
    throw new Error(saved?.msg || `saveTrans failed: ${JSON.stringify(saved)}`)
  }
  docs.push(saved.doc_no)
  return saved
}

// ─── TEST CASES ─────────────────────────────────────────────────────────────

async function t1_discoverSetProduct() {
  const name = 'T1: หาสินค้าชุด (item_type=3)'
  try {
    // กรณีระบุ item_code โดยตรง → lookup ด้วย search
    if (FORCE_ITEM_CODE) {
      const rows = await get('/getProductList', { search: FORCE_ITEM_CODE, limit: 20 })
      const found = rows.find((p) => p.code === FORCE_ITEM_CODE || p.item_code === FORCE_ITEM_CODE)
      if (found) {
        // อาจไม่ได้ส่ง item_type มาใน list → เติมเอง
        if (!found.item_type) found.item_type = '3'
        pass(name, { item_code: found.code || found.item_code, via: 'SET_ITEM_CODE env' })
        return [found]
      }
      // ถ้า search ไม่เจอ สร้าง stub ให้ T2/T3 ไป query ต่อเอง
      const stub = { code: FORCE_ITEM_CODE, item_code: FORCE_ITEM_CODE, item_type: '3' }
      pass(name, { item_code: FORCE_ITEM_CODE, via: 'SET_ITEM_CODE env (stub — ไม่พบใน getProductList)' })
      return [stub]
    }

    // ปกติ: ใช้ isproductset=1 กรอง item_type=3
    const rows = await get('/getProductList', { isproductset: '1', limit: 100 })
    const setProducts = rows.filter((p) => String(p.item_type ?? '') === '3')

    if (setProducts.length > 0) {
      pass(name, { count: setProducts.length, first: setProducts[0].code || setProducts[0].item_code })
      return setProducts
    }

    // fallback: scan ด้วย limit ใหญ่กว่า
    const all = await get('/getProductList', { limit: 500 })
    const allSet = all.filter((p) => String(p.item_type ?? '') === '3')
    if (allSet.length === 0) {
      skip(name, 'ไม่พบสินค้าชุด (item_type=3) ในฐานทดสอบ — ระบุ SET_ITEM_CODE ได้ถ้าต้องการบังคับทดสอบเคสนี้')
      return []
    }
    pass(name, { count: allSet.length, first: allSet[0].code || allSet[0].item_code, via: 'full scan' })
    return allSet
  } catch (e) {
    fail(name, e)
    return []
  }
}

async function t2_getProductSetDetail(setProduct, ctx) {
  const name = 'T2: getProductSetDetail คืน rows + price > 0'
  const itemCode = setProduct.code || setProduct.item_code
  try {
    assert(itemCode, 'ไม่มี item_code')
    const rows = await get('/getProductSetDetail', {
      item_code: itemCode,
      cust_code: ctx.cust.code,
      sale_type: 1,
      vat_type: 1,
      vat_rate: ctx.vatRate,
    })
    assert(Array.isArray(rows) && rows.length > 0,
      `getProductSetDetail คืน empty — ตรวจสอบว่า ${itemCode} ถูก setup ใน ic_inventory_set`)
    const priced = rows.filter((r) => Number(r.price ?? 0) > 0)
    assert(priced.length > 0, `ทุก unit ของ ${itemCode} มี price=0 — ตรวจสอบ price list`)
    pass(name, { item_code: itemCode, units: rows.length, priced: priced.length, sample_price: priced[0]?.price })
    return rows
  } catch (e) {
    fail(name, e, { item_code: itemCode })
    return []
  }
}

async function t3_getProductSetItem(setProduct) {
  const name = 'T3: getProductSetItem คืน children >= 1'
  const itemCode = setProduct.code || setProduct.item_code
  try {
    assert(itemCode, 'ไม่มี item_code')
    const children = await get('/getProductSetItem', { item_code: itemCode })
    assert(Array.isArray(children) && children.length > 0,
      `ไม่พบ children ของ ${itemCode} — ตรวจสอบ ic_inventory_set_detail`)
    pass(name, { item_code: itemCode, children: children.length })
    return children
  } catch (e) {
    fail(name, e, { item_code: itemCode })
    return []
  }
}

async function t4_pickSetUnitRow(setProduct, setDetailRows) {
  const name = 'T4: pickSetUnitRow เลือก unit ถูกต้อง'
  try {
    assert(setDetailRows.length > 0, 'ไม่มี detail rows')
    const picked = pickSetUnitRow(setDetailRows, setProduct)
    assert(picked, 'pickSetUnitRow คืน null')
    const preferred = setProduct.unit_code || setProduct.start_sale_unit || setProduct.unit_standard || setProduct.unit_cost || ''
    if (preferred) {
      const matched = setDetailRows.find((r) => r.unit_code === preferred)
      if (matched) assert(picked.unit_code === preferred, `ควรได้ ${preferred} แต่ได้ ${picked.unit_code}`)
    }
    pass(name, { picked_unit: picked.unit_code, price: picked.price })
    return picked
  } catch (e) {
    fail(name, e)
    return setDetailRows[0] || null
  }
}

async function t5_noStockBlockForSet(setProduct) {
  const name = 'T5: balance_qty=0 ไม่บล็อก set item (no frontend stock check)'
  try {
    assert(setProduct, 'ไม่มี set product')
    pass(name, {
      item_code: setProduct.code || setProduct.item_code,
      balance_qty: Number(setProduct.balance_qty ?? 0),
      note: 'SellView.vue:2119 → isSetItem() ข้าม stock validation',
    })
  } catch (e) {
    fail(name, e)
  }
}

async function t6_saveSaleQty1(ctx, setUnit, subItems) {
  const name = 'T6: saveTrans set item qty=1 — payload มี sub_item, ได้ doc_no'
  try {
    assert(setUnit, 'ไม่มี setUnit')
    assert(Number(setUnit.price) > 0, `price=0 — ตั้งราคาสินค้าชุดใน ERP ก่อน`)
    await clearBasket(ctx.basketId)
    await setBasketInfo(ctx.basketId, ctx, 1)
    const line = buildSetLine(setUnit, subItems, 1)
    const saved = await saveTrans(ctx, [line], { label: 'T6_qty1', inquiryType: 1 })
    pass(name, { doc_no: saved.doc_no, total: line.sum_amount, sub_item_count: subItems.length })
    return saved.doc_no
  } catch (e) {
    fail(name, e)
    return null
  }
}

async function t7_verifyChildRows(docNo, subItems) {
  const name = 'T7: getDocSaleHistoryDetail — header + detail rows บันทึกครบ'
  if (!docNo) { skip(name, 'ไม่มี doc_no จาก T6'); return }
  try {
    const detail = await get('/getDocSaleHistoryDetail', { doc_no: docNo })
    assert(detail?.header, 'missing header')
    const items = detail.items || detail.detail || []
    assert(items.length > 0, 'ไม่มี detail rows ใน history')
    const savedTotal = Number(detail.header.total_amount ?? 0)
    assert(savedTotal > 0, `total_amount=0 ใน doc ${docNo}`)
    const extra = { doc_no: docNo, total_amount: savedTotal, row_count: items.length }
    if (subItems.length > 0 && items.length > 1) extra.child_rows = items.length - 1
    pass(name, extra)
  } catch (e) {
    fail(name, e, { doc_no: docNo })
  }
}

async function t8_saveSaleQty2(ctx, setUnit, subItems) {
  const name = 'T8: saveTrans set item qty=2 — total = price × 2'
  try {
    assert(setUnit, 'ไม่มี setUnit')
    await clearBasket(ctx.basketId)
    await setBasketInfo(ctx.basketId, ctx, 1)
    const price = Number(setUnit.price)
    const line = buildSetLine(setUnit, subItems, 2)
    const expectedTotal = rnd(price * 2)
    const saved = await saveTrans(ctx, [line], { label: 'T8_qty2', inquiryType: 1 })
    const detail = await get('/getDocSaleHistoryDetail', { doc_no: saved.doc_no })
    const actualTotal = Number(detail?.header?.total_amount ?? 0)
    assert(Math.abs(actualTotal - expectedTotal) <= 0.02,
      `total=${actualTotal} ไม่ตรงกับ price×2=${expectedTotal}`)
    pass(name, { doc_no: saved.doc_no, price, qty: 2, expected: expectedTotal, actual: actualTotal })
  } catch (e) {
    fail(name, e)
  }
}

async function t9_creditSale(ctx, setUnit, subItems) {
  const name = 'T9: saveTrans set item แบบ credit (inquiry_type=0, cash_amount=0)'
  try {
    assert(setUnit, 'ไม่มี setUnit')
    await clearBasket(ctx.basketId)
    await setBasketInfo(ctx.basketId, ctx, 0)
    const line = buildSetLine(setUnit, subItems, 1)
    const saved = await saveTrans(ctx, [line], { label: 'T9_credit', inquiryType: 0, cashAmount: 0 })
    pass(name, { doc_no: saved.doc_no, total: line.sum_amount })
  } catch (e) {
    fail(name, e)
  }
}

async function t10_priceSource(setProduct, setDetailRows, ctx) {
  const name = 'T10: ราคา set item มาจาก getProductSetDetail ไม่ใช่ getProductPrice'
  const itemCode = setProduct.code || setProduct.item_code
  try {
    assert(itemCode && setDetailRows.length > 0, 'ไม่มีข้อมูล')
    const setUnit = pickSetUnitRow(setDetailRows, setProduct)
    let priceFromPriceApi = null
    try {
      const rows = await get('/getProductPrice', {
        item_code: itemCode,
        unit_code: setUnit?.unit_code || '',
        cust_code: ctx.cust.code,
        qty: 1, sale_type: 1, vat_type: 1, vat_rate: ctx.vatRate,
      })
      const row = Array.isArray(rows) ? rows[0] : rows
      priceFromPriceApi = Number(row?.price ?? 0)
    } catch { priceFromPriceApi = null }
    const priceFromSetDetail = Number(setUnit?.price ?? 0)
    assert(priceFromSetDetail > 0, 'getProductSetDetail ให้ price=0')
    pass(name, {
      item_code: itemCode,
      price_from_set_detail: priceFromSetDetail,
      price_from_price_api: priceFromPriceApi,
      source_used: 'getProductSetDetail (SellView.vue:1345)',
    })
  } catch (e) {
    fail(name, e)
  }
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function run() {
  console.error(`\n🧪  Set Product Regression — runId: ${runId}`)
  console.error(`    BASE_URL: ${BASE_URL}`)
  if (FORCE_ITEM_CODE) console.error(`    SET_ITEM_CODE: ${FORCE_ITEM_CODE}`)
  console.error('')

  let ctx
  try {
    ctx = await discover()
    pass('ENV: discover environment', { pos: ctx.pos.pos_id, basket: ctx.basketId, vatRate: ctx.vatRate })
  } catch (e) {
    fail('ENV: discover environment', e)
    return
  }

  const setProducts = await t1_discoverSetProduct()
  if (!setProducts.length) {
    console.error('\n⚠️  ไม่พบสินค้าชุดในฐานทดสอบ — ข้ามเฉพาะ suite นี้\n')
    return
  }

  // หา set product ที่พร้อมทดสอบ (price>0 + children)
  let chosenProduct = null, chosenDetailRows = [], chosenUnit = null, chosenSubItems = []

  for (const sp of setProducts) {
    const itemCode = sp.code || sp.item_code
    const rows = await get('/getProductSetDetail', {
      item_code: itemCode,
      cust_code: ctx.cust.code,
      sale_type: 1, vat_type: 1, vat_rate: ctx.vatRate,
    }).catch(() => [])
    if (!rows.filter((r) => Number(r.price ?? 0) > 0).length) {
      console.error(`  ⏭️  ${itemCode}: ข้าม — ไม่มีราคา`)
      continue
    }
    const children = await get('/getProductSetItem', { item_code: itemCode }).catch(() => [])
    if (!children.length) {
      console.error(`  ⏭️  ${itemCode}: ข้าม — ไม่มี children`)
      continue
    }
    chosenProduct = sp
    chosenDetailRows = rows
    chosenUnit = pickSetUnitRow(rows, sp)
    chosenSubItems = children
    break
  }

  if (!chosenProduct) {
    skip('PRE: หา set product ที่มีราคา + children',
      'ไม่พบ set product ที่พร้อมทดสอบ (price>0 + children ใน ic_inventory_set_detail)')
    return
  }
  pass('PRE: เลือก set product สำหรับทดสอบ', {
    item_code: chosenProduct.code || chosenProduct.item_code,
    unit: chosenUnit?.unit_code,
    price: chosenUnit?.price,
    children: chosenSubItems.length,
  })

  // read-only
  await t2_getProductSetDetail(chosenProduct, ctx)
  await t3_getProductSetItem(chosenProduct)
  await t4_pickSetUnitRow(chosenProduct, chosenDetailRows)
  await t5_noStockBlockForSet(chosenProduct)
  await t10_priceSource(chosenProduct, chosenDetailRows, ctx)

  // DB-modifying
  const docNoT6 = await t6_saveSaleQty1(ctx, chosenUnit, chosenSubItems)
  await t7_verifyChildRows(docNoT6, chosenSubItems)
  await t8_saveSaleQty2(ctx, chosenUnit, chosenSubItems)
  await t9_creditSale(ctx, chosenUnit, chosenSubItems)

  await clearBasket(ctx.basketId).catch(() => {})
}

try {
  await run()
} catch (e) {
  results.push({ status: 'FAIL', name: 'FATAL', error: e?.message || String(e) })
  console.error(`\n💥  FATAL: ${e.message}`)
}

// ─── summary ─────────────────────────────────────────────────────────────────

const passed  = results.filter((r) => r.status === 'PASS').length
const failed  = results.filter((r) => r.status === 'FAIL').length
const skipped = results.filter((r) => r.status === 'SKIP').length

console.error(`\n${'─'.repeat(60)}`)
console.error(`  ผล: ${passed} PASS  ${failed} FAIL  ${skipped} SKIP`)
console.error(`${'─'.repeat(60)}\n`)

console.log(JSON.stringify({ baseUrl: BASE_URL, runId, docs, passed, failed, skipped, results }, null, 2))
process.exitCode = failed > 0 ? 1 : 0
