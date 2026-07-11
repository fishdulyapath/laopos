import api from './api'
import { runtimeApiBaseUrl } from '@/config/runtime'

export async function getPurchaseDocFormatList() {
  const { data } = await api.get('/getPurchaseDocFormatList')
  return data.data || []
}

export async function getNextPurchaseDocNo({ doc_format_code = '', doc_date = '' } = {}) {
  const { data } = await api.get('/getNextPurchaseDocNo', {
    params: { doc_format_code, doc_date },
  })
  return data || null
}

export async function getVatRate() {
  const { data } = await api.get('/getVatRate')
  return data?.vat_rate ?? '7'
}

export async function getSupplierList(search = '') {
  const { data } = await api.get('/getSupplierList', { params: { search } })
  return data.data || []
}

export async function getSupplierDetail(cust_code) {
  const { data } = await api.get('/getSupplierDetail', { params: { cust_code } })
  return data.data || null
}

export async function getPODocWait({ search = '', fromdate = '', todate = '', approve_only = '' } = {}) {
  const { data } = await api.get('/getPODocWait', {
    params: { search, fromdate, todate, approve_only },
  })
  return data.data || []
}

export async function getDocPoDetail(doc_no) {
  const { data } = await api.get('/getDocPoDetail', { params: { doc_no } })
  return data.data || null
}

export async function getBarcodeItem(barcode, custcode = '') {
  const { data } = await api.get('/getBarcodeItem', { params: { barcode, custcode } })
  return withLatestPurchasePrices(data.data || [])
}

export async function getBarcodeItemSearch({ search = '', custcode = '', limit = 30 } = {}) {
  const { data } = await api.get('/getBarcodeItemSearch', {
    params: { search, custcode, limit },
  })
  return withLatestPurchasePrices(data.data || [])
}

export async function getPurchaseLatestItemPrices(items = []) {
  const payloadItems = items
    .map((item) => ({
      item_code: item?.item_code || item?.code || item?.ic_code || '',
      unit_code: item?.unit_code || item?.unit_cost || item?.unit_standard || item?.start_sale_unit || '',
      barcode: item?.barcode || '',
    }))
    .filter((item) => String(item.item_code || '').trim() && String(item.unit_code || '').trim())
  if (!payloadItems.length) return []
  const { data } = await api.post('/getPurchaseLatestItemPrices', { items: payloadItems })
  return data.data || []
}

export async function getPurchaseProductDetail(item_code) {
  const { data } = await api.get('/getPurchaseProductDetail', {
    params: { item_code },
  })
  return data.data || []
}

export async function withLatestPurchasePrices(items = []) {
  if (!Array.isArray(items) || !items.length) return items || []
  const prices = await getPurchaseLatestItemPrices(items)
  const priceMap = new Map()
  for (const row of prices) {
    const itemCode = String(row.item_code || '').trim()
    const unitCode = String(row.unit_code || '').trim()
    if (!itemCode || !unitCode) continue
    priceMap.set(`${itemCode}::${unitCode}`, row)
  }
  return items.map((item) => {
    const itemCode = String(item?.item_code || item?.code || item?.ic_code || '').trim()
    const unitCode = String(item?.unit_code || item?.unit_cost || item?.unit_standard || item?.start_sale_unit || '').trim()
    const priceRow = priceMap.get(`${itemCode}::${unitCode}`)
    if (!priceRow) return item
    return {
      ...item,
      price: Number(priceRow.price || 0),
      last_purchase_price: Number(priceRow.price || 0),
      last_purchase_doc_no: priceRow.price_doc_no || '',
      last_purchase_doc_date: priceRow.price_doc_date || '',
    }
  })
}

export async function getPassBookList() {
  const { data } = await api.get('/getPassBookList')
  return data.data || []
}

function assertPUDocPayload(payload = {}) {
  const supplierCode = String(payload.cust_code || payload.ap_cust_code || '').trim()
  if (!supplierCode) throw new Error('กรุณาเลือกเจ้าหนี้')
}

export async function createPUDoc(payload) {
  assertPUDocPayload(payload)
  const { data } = await api.post('/createPUDoc', payload)
  return data
}

export async function updatePUDoc(payload) {
  assertPUDocPayload(payload)
  const { data } = await api.post('/updatePUDoc', payload)
  return data
}

export async function getPUDocList({ search = '', fromdate = '', todate = '' } = {}) {
  const { data } = await api.get('/getPUDocList', {
    params: { search, fromdate, todate },
  })
  return data.data || []
}

export async function getPUDocDetail(doc_no) {
  const { data } = await api.get('/getPUDocDetail', { params: { doc_no } })
  return data.data || null
}

export async function getPurchasePrintForms(doc_no) {
  const { data } = await api.get('/getPurchasePrintForms', { params: { doc_no } })
  return data.data || null
}

export function getPurchasePrintUrl(doc_no, formcodes = [], user_code = '') {
  const baseUrl = runtimeApiBaseUrl()
  const params = new URLSearchParams({
    doc_no,
    formcodes: formcodes.join(','),
    auto_print: '1',
    log_print: '1',
  })
  if (user_code) params.set('user_code', user_code)
  return `${baseUrl}/purchase-print/render?${params.toString()}`
}
