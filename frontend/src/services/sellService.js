import api from './api'
import { productImageGuidUrl, productImageUrl } from '@/utils/imageUrls'

export function getProductImageUrl(item_code) {
  return productImageUrl(item_code)
}

export function getProductImageGuidUrl(guid_code) {
  return productImageGuidUrl(guid_code)
}

export async function getCustomerList(search = '') {
  const { data } = await api.get('/getCustomerList', { params: { search } })
  return (data.data || []).map((row) => {
    const customerCode = String(row.customer_code || row.code || '').trim()
    const customerName = String(row.customer_name || row.name || row.name_1 || '').trim()
    const customerTelephone = String(row.customer_telephone || row.telephone || '').trim()
    const memberCode = String(row.member_code || row.dealer_code || '').trim()
    const mobilePhone = String(row.mobile_phone || row.dealer_mobile_phone || '').trim()
    return {
      ...row,
      code: customerCode,
      name: customerName,
      telephone: customerTelephone,
      customer_code: customerCode,
      customer_name: customerName,
      customer_telephone: customerTelephone,
      member_code: memberCode,
      dealer_code: memberCode,
      mobile_phone: mobilePhone,
      dealer_mobile_phone: mobilePhone,
      row_key: String(row.row_key || `${customerCode}|${memberCode}|${mobilePhone}`),
    }
  })
}

export async function getProductBarcodeSearch({ search = '', offset = 0, limit = 30, include_balance = '', wh_code = '', shelf_code = '' } = {}) {
  const params = { search, offset, limit }
  if (include_balance !== undefined && include_balance !== null && include_balance !== '') params.include_balance = include_balance
  if (wh_code) params.wh_code = wh_code
  if (shelf_code) params.shelf_code = shelf_code
  const { data } = await api.get('/getProductBarcodeSearch', { params })
  return data.data || []
}

export async function getCategoryList() {
  const { data } = await api.get('/getCategoryList')
  return data.data || []
}

export async function getProductList({ cust_code = '', category = '', search = '', isstock = '', ispromotion = '', offset = 0, limit = 30 } = {}) {
  const { data } = await api.get('/getProductList', {
    params: { cust_code, category, search, isstock, ispromotion, offset, limit },
  })
  return data.data || []
}

// doc_date จงใจไม่ส่งจาก frontend — ใช้ server time เป็นแหล่งความจริง
// (กันผู้ใช้แก้นาฬิกาในเครื่องแล้วได้ราคาย้อนหลัง)
export async function getProductPrice(item_code, unit_code, cust_code = '', qty = '1', opts = {}) {
  const params = { item_code, unit_code, qty, cust_code }
  if (opts.sale_type !== undefined && opts.sale_type !== null && opts.sale_type !== '') params.sale_type = opts.sale_type
  if (opts.vat_type !== undefined && opts.vat_type !== null && opts.vat_type !== '') params.vat_type = opts.vat_type
  if (opts.vat_rate !== undefined && opts.vat_rate !== null && opts.vat_rate !== '') params.vat_rate = opts.vat_rate
  if (opts.barcode !== undefined && opts.barcode !== null && opts.barcode !== '') params.barcode = opts.barcode
  if (opts.doc_date !== undefined && opts.doc_date !== null && opts.doc_date !== '') params.doc_date = opts.doc_date
  if (opts.currency_code !== undefined && opts.currency_code !== null && opts.currency_code !== '') params.currency_code = opts.currency_code
  const { data } = await api.get('/getProductPrice', { params })
  return data.data?.[0] || null
}

export async function getPricePos(item_code, unit_code, cust_code = '', qty = '1', opts = {}) {
  const params = { item_code, unit_code, qty, cust_code }
  if (opts.barcode !== undefined && opts.barcode !== null && opts.barcode !== '') params.barcode = opts.barcode
  if (opts.member_code !== undefined && opts.member_code !== null && opts.member_code !== '') params.member_code = opts.member_code
  if (opts.price_number !== undefined && opts.price_number !== null && opts.price_number !== '') params.price_number = opts.price_number
  if (opts.is_staff !== undefined && opts.is_staff !== null && opts.is_staff !== '') params.is_staff = opts.is_staff
  if (opts.pos_id !== undefined && opts.pos_id !== null && opts.pos_id !== '') params.pos_id = opts.pos_id
  if (opts.branch_code !== undefined && opts.branch_code !== null && opts.branch_code !== '') params.branch_code = opts.branch_code
  if (opts.default_cust_code !== undefined && opts.default_cust_code !== null && opts.default_cust_code !== '') params.default_cust_code = opts.default_cust_code
  if (opts.doc_date !== undefined && opts.doc_date !== null && opts.doc_date !== '') params.doc_date = opts.doc_date
  const { data } = await api.get('/getpricepos', { params })
  return data.data?.[0] || null
}

export async function getProductDetail(item_code, cust_code = '', opts = {}) {
  const params = { item_code, cust_code, show_promotion: '1' }
  if (opts.sale_type !== undefined && opts.sale_type !== null && opts.sale_type !== '') params.sale_type = opts.sale_type
  if (opts.vat_type !== undefined && opts.vat_type !== null && opts.vat_type !== '') params.vat_type = opts.vat_type
  if (opts.vat_rate !== undefined && opts.vat_rate !== null && opts.vat_rate !== '') params.vat_rate = opts.vat_rate
  if (opts.currency_code !== undefined && opts.currency_code !== null && opts.currency_code !== '') params.currency_code = opts.currency_code
  const { data } = await api.get('/getProductDetail', { params })
  return data.data || []
}

// สินค้าชุด (item_type=3): ราคา/หน่วยของ parent set
// ใช้แทน getProductDetail เมื่อ item_type === '3'
// backend จะคำนวณ stock จาก min(component balance / qty_per_set) ให้
export async function getProductSetDetail(item_code, cust_code = '', opts = {}) {
  const params = { item_code, cust_code }
  if (opts.sale_type !== undefined && opts.sale_type !== null && opts.sale_type !== '') params.sale_type = opts.sale_type
  if (opts.vat_type !== undefined && opts.vat_type !== null && opts.vat_type !== '') params.vat_type = opts.vat_type
  if (opts.vat_rate !== undefined && opts.vat_rate !== null && opts.vat_rate !== '') params.vat_rate = opts.vat_rate
  if (opts.currency_code !== undefined && opts.currency_code !== null && opts.currency_code !== '') params.currency_code = opts.currency_code
  const { data } = await api.get('/getProductSetDetail', { params })
  return data.data || []
}

// สินค้าชุด: รายการสินค้าย่อย (children) ของ set parent
// คืน rows จาก ic_inventory_set_detail พร้อม price/qty/unit/price_ratio/stand_value/divide_value
// ต้องส่ง array นี้เป็น sub_item ใน save payload เพื่อให้ backend persist child rows ครบ
export async function getProductSetItem(item_code) {
  const { data } = await api.get('/getProductSetItem', { params: { item_code } })
  return data.data || []
}

export async function getProductImageList(item_code) {
  const { data } = await api.get('/getImageList', {
    params: { item_code },
  })
  return data.data || []
}

export async function getPassBookList() {
  const { data } = await api.get('/getPassBookList')
  return data.data || []
}

export async function getCreditTypeList() {
  const { data } = await api.get('/getCreditTypeList')
  return data.data || []
}

export async function getPaymentMasterLists() {
  const { data } = await api.get('/getPaymentMasterLists')
  return data.data || {}
}

export async function getLaoQrConfig() {
  const { data } = await api.get('/lao-qr/config')
  return data.data || {}
}

export async function createLaoQrPayment(body) {
  const { data } = await api.post('/lao-qr/create', body)
  return data.data || {}
}

export async function checkLaoQrPaymentStatus(body) {
  const { data } = await api.post('/lao-qr/status', body)
  return data.data || {}
}

export async function getCustomerCredit(cust_code = '') {
  const { data } = await api.get('/getCustomerCredit', { params: { cust_code } })
  return data.data || {}
}

export async function getCustomerContactorList(cust_code = '') {
  const { data } = await api.get('/getCustomerContactorList', { params: { cust_code } })
  return data.data || []
}

export async function getCustomerTotalBalance(cust_code = '') {
  const { data } = await api.get('/getTotalBalance', { params: { cust_code } })
  return Number(data.total_balance) || 0
}

export async function getCouponList({ search = '', cust_code = '', doc_date = '', total_amount = 0, doc_no = '' } = {}) {
  const { data } = await api.get('/getCouponList', {
    params: { search, cust_code, doc_date, total_amount, doc_no },
  })
  return data.data || []
}

export async function getSaleDepositBalanceList({ search = '', cust_code = '', doc_date = '' } = {}) {
  const { data } = await api.get('/getSaleDepositBalanceList', {
    params: { search, cust_code, doc_date },
  })
  return data.data || []
}

export async function getSaleDepositMoneyBalanceList({ search = '', cust_code = '', doc_date = '' } = {}) {
  const { data } = await api.get('/getSaleDepositMoneyBalanceList', {
    params: { search, cust_code, doc_date },
  })
  return data.data || []
}

export async function saveTrans(body) {
  const { data } = await api.post('/saveTrans', body)
  return data
}

export async function saveTransAndPro(body) {
  try {
    const payment_detail = Array.isArray(body.payment_detail) ? body.payment_detail : []

    const adjustedPayment = payment_detail.map((entry) => {
      if (entry.type !== 'credit_transfer') return entry

      const rdCharge = payment_detail.find(
        (p) => p.type === 'income' && p.trans_number === 'RD-012'
      )
      if (!rdCharge) return entry

      const chargeAmount = Number(rdCharge.amount) || 0
      const isTHB = ['THB', 'BTH'].includes((entry.currency_code || '').toUpperCase())

      if (isTHB) {
        return {
          ...entry,
          amount: (Number(entry.amount) || 0) + chargeAmount,
          sum_amount: (Number(entry.sum_amount) || 0) + chargeAmount,
          sum_amount_2: (Number(entry.sum_amount_2) || 0) + chargeAmount,
        }
      } else {
        return {
          ...entry,
          sum_amount_2: (Number(entry.sum_amount_2) || 0) + chargeAmount,
        }
      }
    })

    const adjustedBody = { ...body, payment_detail: adjustedPayment }
    console.log('saveTransAndPro body:', adjustedBody)
    const { data } = await api.post('/saveTransAndPro', adjustedBody)
    return data
  } catch (error) {
    if (error?.data?.success === false && [400, 409, 422].includes(Number(error?.status))) return error.data
    throw error
  }
}

export async function checkSaleItemPolicies(body) {
  const { data } = await api.post('/checkSaleItemPolicies', body)
  return data.data || { errors: [], warnings: [] }
}

export async function verifyPriceEditPermission(user_code, password) {
  const { data } = await api.post('/verifyPriceEditPermission', { user_code, password })
  return data.data || { allowed: false }
}

export async function verifyCashDrawerPermission(user_code, password) {
  const { data } = await api.post('/verifyCashDrawerPermission', { user_code, password })
  return data.data || { allowed: false }
}

export async function processPromotion(body) {
  const { data } = await api.post('/processPromotion', body)
  return data
}

export async function processPosSlipCampaign(body) {
  const { data } = await api.post('/processPosSlipCampaign', body)
  return data
}

export async function getPromotionItemHints(body) {
  const { data } = await api.post('/getPromotionItemHints', body)
  return data
}

export async function getReceiptDetail(doc_no) {
  const { data } = await api.get('/getReceiptDetail', { params: { doc_no } })
  return data.data || null
}

export async function getProductByBarcode(barcode) {
  const { data } = await api.get('/getProductByBarcode', { params: { barcode } })
  return data.data || null
}

export async function getProductByBarcodeDetail(barcode, opts = {}) {
  const params = { barcode }
  if (opts.wh_code !== undefined && opts.wh_code !== null && opts.wh_code !== '') params.wh_code = opts.wh_code
  if (opts.shelf_code !== undefined && opts.shelf_code !== null && opts.shelf_code !== '') params.shelf_code = opts.shelf_code
  const { data } = await api.get('/getProductByBarcodeDetail', { params })
  return data.data || null
}

export async function getBranchList() {
  const { data } = await api.get('/getBranchList')
  return data.data || []
}

export async function getDocGroupList() {
  const { data } = await api.get('/getDocGroupList')
  return data.data || []
}

export async function getSideList() {
  const { data } = await api.get('/getSideList')
  return data.data || []
}

export async function getDepartmentList() {
  const { data } = await api.get('/getDepartmentList')
  return data.data || []
}

export async function getAllocateList() {
  const { data } = await api.get('/getAllocateList')
  return data.data || []
}

export async function getProjectList() {
  const { data } = await api.get('/getProjectList')
  return data.data || []
}

export async function getJobList() {
  const { data } = await api.get('/getJobList')
  return data.data || []
}

export async function getContactorList() {
  const { data } = await api.get('/getContactorList')
  return data.data || []
}

export async function getSaleGroupList() {
  const { data } = await api.get('/getSaleGroupList')
  return data.data || []
}

export async function getNextSaleDocumentNo(doc_format_code = '') {
  const { data } = await api.get('/getNextSaleDocumentNo', { params: { doc_format_code } })
  return data.data?.doc_no || ''
}

export async function getProvinceList(search = '') {
  const { data } = await api.get('/getProvinceList', { params: { search } })
  return data.data || []
}

export async function getAmperList({ province = '', search = '' } = {}) {
  const { data } = await api.get('/getAmperList', { params: { province, search } })
  return data.data || []
}

export async function getTambonList({ province = '', amper = '', search = '' } = {}) {
  const { data } = await api.get('/getTambonList', { params: { province, amper, search } })
  return data.data || []
}

export async function getLogisticAreaList(search = '') {
  const { data } = await api.get('/getLogisticAreaList', { params: { search } })
  return data.data || []
}

export async function getShippingLabelList({ cust_code = '', search = '' } = {}) {
  const { data } = await api.get('/getShippingLabelList', { params: { cust_code, search } })
  return data.data || []
}

export async function getShipmentTransportTypeList() {
  const { data } = await api.get('/getShipmentTransportTypeList')
  return data.data || []
}

// ดึงเอกสารอ้างอิงของลูกค้า (ใบเสนอราคา/ใบสั่งจอง/ใบสั่งขาย)
// doc_type: 'qt' | 'reserve' | 'so'  → backend แปลงเป็น trans_flag 30/34/36
export async function getSaleRefDocList({ cust_code, doc_type, from_date = '', to_date = '', search = '' }) {
  const { data } = await api.get('/getSaleRefDocList', {
    params: { cust_code, doc_type, from_date, to_date, search },
  })
  return data.data || []
}

// ดึงรายการสินค้าจากเอกสารต้นทาง (qty เฉพาะส่วนที่ยังค้าง)
export async function getSaleRefDocItems(doc_no) {
  const { data } = await api.get('/getSaleRefDocItems', { params: { doc_no } })
  return data.data || []
}
