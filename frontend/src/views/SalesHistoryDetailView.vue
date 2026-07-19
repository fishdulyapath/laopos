<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { getDocSaleHistoryDetail, getSalePrintForms, getSalePrintUrl, getSalePosSlipPrintUrl } from '@/services/salesService'
import { deleteDocImage, getDocImageUrl, getDocImagesList, saveDocImage } from '@/services/docImageService'
import { useAuthStore } from '@/stores/auth'
import { formatCurrency, formatDate, formatNumber } from '@/utils/formatters'
import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import Message from 'primevue/message'
import ProgressSpinner from 'primevue/progressspinner'

const props = defineProps({
  docNo: { type: String, required: true },
})

const router = useRouter()
const authStore = useAuthStore()
const loading = ref(false)
const printing = ref(false)
const imageUploading = ref(false)
const errorMsg = ref('')
const imageError = ref('')
const detail = ref(null)
const docImages = ref([])
const activeTab = ref('details')
const promotionAuditExpanded = ref(false)
const promotionFooterRef = ref(null)

const header = computed(() => detail.value?.header || {})
const items = computed(() => detail.value?.items || [])
const payments = computed(() => detail.value?.payment_detail || [])
const paymentSummary = computed(() => detail.value?.payment_summary || {})
const vatRows = computed(() => detail.value?.vat_rows || [])
const whtHeaders = computed(() => detail.value?.wht_headers || [])
const glDetail = computed(() => detail.value?.gl_detail || [])
const promotions = computed(() => detail.value?.promotions || detail.value?.promotion_detail || [])
const shipment = computed(() => detail.value?.shipment || {})
const homeCurrencyCode = 'LAK'

function normalizeCurrencyCode(value) {
  const code = String(value || '').trim().toUpperCase()
  if (['LAK', 'KIP', 'KIPP', 'KIP2', 'LAO'].includes(code)) return 'LAK'
  if (['THB', 'BTH', 'TH'].includes(code)) return 'THB'
  return code
}

function moneyValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return Number(value) || 0
  }
  return 0
}

function formatCount(value) {
  return Number(value || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })
}

const documentAmount = computed(() => moneyValue(header.value.total_net_amount, header.value.total_amount))
const totalPaidAmount = computed(() => moneyValue(paymentSummary.value.total_paid))
const balanceAmount = computed(() => moneyValue(documentAmount.value - totalPaidAmount.value))

const saleTypeLabel = computed(() => {
  const type = Number(header.value.inquiry_type)
  if (type === 0 || type === 2) return 'ขายเชื่อ'
  return 'ขายสด'
})

const vatTypeLabel = computed(() => {
  const type = Number(header.value.vat_type)
  const rate = Number(header.value.vat_rate || 0)
  if (type === 0) return `แยกนอก ${rate}%`
  if (type === 1) return `รวมใน ${rate}%`
  return 'ไม่มีภาษี'
})

const documentChips = computed(() => [
  saleTypeLabel.value,
  vatTypeLabel.value,
  header.value.currency_code ? `${header.value.currency_code} @ ${formatNumber(header.value.exchange_rate || 1)}` : '',
  header.value.form_code ? `ฟอร์ม ${header.value.form_code}` : '',
].filter(Boolean))

const tabs = computed(() => [
  { key: 'details', label: 'รายละเอียด', icon: 'pi pi-file-edit', badge: itemDisplayRows.value.length },
  { key: 'vat', label: 'VAT', icon: 'pi pi-receipt', badge: vatRows.value.length },
  { key: 'wht', label: 'WHT', icon: 'pi pi-percentage', badge: whtHeaders.value.length },
  { key: 'shipment', label: 'ขนส่ง', icon: 'pi pi-send', badge: hasShipment.value ? 1 : 0 },
  { key: 'gl', label: 'GL', icon: 'pi pi-sitemap', badge: glDetail.value.length },
  { key: 'more', label: 'เพิ่มเติม', icon: 'pi pi-plus-circle', badge: docImages.value.length },
])

const activeTabMeta = computed(() => tabs.value.find((tab) => tab.key === activeTab.value) || tabs.value[0])

const documentFieldRows = computed(() => [
  { label: 'วันที่เอกสาร', value: formatDate(header.value.doc_date) },
  { label: 'เวลา', value: header.value.doc_time || '-' },
  { label: 'รหัสเอกสาร', value: `${header.value.doc_format_code || '-'} ${header.value.doc_format_name || ''}`.trim() },
  { label: 'เลขที่เอกสาร', value: header.value.doc_no || props.docNo },
  { label: 'ลูกค้า', value: `${header.value.cust_code || '-'} ${header.value.cust_name || ''}`.trim() },
  { label: 'ผู้ติดต่อ', value: header.value.contactor || '-' },
  { label: 'วันที่ใบกำกับภาษี', value: formatDate(header.value.tax_doc_date) },
  { label: 'เลขที่ใบกำกับภาษี', value: header.value.tax_doc_no || '-' },
  { label: 'อ้างอิงเลขที่', value: header.value.doc_ref || '-' },
  { label: 'อ้างอิงวันที่', value: formatDate(header.value.doc_ref_date) },
  { label: 'ประเภทขาย', value: saleTypeLabel.value },
  { label: 'ประเภทภาษี', value: vatTypeLabel.value },
  { label: 'พนักงานขาย', value: header.value.sale_code || '-' },
  { label: 'กลุ่มพนักงาน', value: header.value.sale_group || '-' },
  { label: 'หมายเหตุ', value: header.value.remark || '-', wide: true },
])

const footerInfoRows = computed(() => [
  { label: 'รหัสสกุลเงิน', value: header.value.currency_code || homeCurrencyCode },
  { label: 'อัตราแลกเปลี่ยน', value: formatNumber(header.value.exchange_rate || 1) },
  { label: 'มูลค่าสุทธิ (สกุลเงิน)', value: formatCurrency(header.value.total_amount_2 || header.value.total_net_amount || header.value.total_amount || 0) },
  { label: 'เครดิต (วัน)', value: formatNumber(header.value.credit_day || 0) },
  { label: 'วันครบกำหนด', value: formatDate(header.value.due_date) },
  { label: 'วันส่ง', value: formatDate(header.value.send_date) },
])

const currencyFooterRows = computed(() => [
  { label: 'รหัสสกุลเงิน', value: header.value.currency_code || homeCurrencyCode },
  { label: 'อัตราแลกเปลี่ยน', value: formatNumber(header.value.exchange_rate || 1) },
])

const shipmentFooterRows = computed(() => [
  { label: 'ประเภทการส่ง', value: header.value.send_type || shipment.value.send_type || 'รับเอง' },
  { label: 'วันที่ส่ง', value: formatDate(header.value.send_date || shipment.value.send_date) },
  { label: 'วันที่รับ/ส่งสินค้า', value: formatDate(header.value.delivery_date || shipment.value.delivery_date || shipment.value.receive_date) },
  { label: 'ขนส่ง', value: header.value.transport_code || shipment.value.transport_code || shipment.value.transport_name || '-' },
])

const creditFooterRows = computed(() => [
  { label: 'เครดิต (วัน)', value: formatNumber(header.value.credit_day || 0) },
  { label: 'วันครบกำหนด', value: formatDate(header.value.due_date) },
])

const showDocumentCurrencySummary = computed(() => {
  const code = normalizeCurrencyCode(header.value.currency_code || homeCurrencyCode)
  return code && code !== homeCurrencyCode
})

const documentCurrencySummaryRows = computed(() => [
  { label: 'มูลค่าสินค้า (สกุลเงิน)', value: moneyValue(header.value.total_value_2, header.value.total_amount_2) },
  { label: 'ส่วนลดท้ายบิล (สกุลเงิน)', value: moneyValue(header.value.total_discount_2), negative: true, hideWhenZero: true },
  { label: 'มูลค่าก่อนภาษี (สกุลเงิน)', value: moneyValue(header.value.total_before_vat_2) },
  { label: 'ภาษีมูลค่าเพิ่ม (สกุลเงิน)', value: moneyValue(header.value.total_vat_value_2) },
  { label: 'มูลค่าสุทธิ (สกุลเงิน)', value: moneyValue(header.value.total_amount_2), strong: true },
])

const bahtSummaryRows = computed(() => [
  { label: 'มูลค่าสินค้า', value: moneyValue(header.value.total_value, header.value.total_amount) },
  { label: 'ส่วนลดท้ายบิล', value: moneyValue(header.value.total_discount), negative: true, hideWhenZero: true },
  { label: 'โปรโมชั่น', value: Math.abs(moneyValue(header.value.promotion_amount, header.value.total_promotion_amount)), negative: true, hideWhenZero: true },
  { label: 'มูลค่าก่อนภาษี', value: moneyValue(header.value.total_before_vat) },
  { label: 'ภาษีมูลค่าเพิ่ม', value: moneyValue(header.value.total_vat_value) },
  { label: 'มูลค่าสุทธิ', value: moneyValue(header.value.total_amount, documentAmount.value), strong: true },
])

const hasShipment = computed(() =>
  Object.values(shipment.value || {}).some((value) => value !== null && value !== undefined && String(value).trim() !== '' && Number(value) !== 0),
)

const summaryCards = computed(() => [
  { label: 'รายการ', value: topLevelItemCount.value, kind: 'count' },
  { label: 'รวมยอดเงิน', value: header.value.total_value ?? header.value.total_amount },
  { label: 'ส่วนลด', value: header.value.total_discount },
  { label: 'VAT', value: header.value.total_vat_value },
  { label: 'ยอดสุทธิ', value: documentAmount.value, strong: true },
  { label: 'รับชำระ', value: totalPaidAmount.value },
  { label: 'คงเหลือ', value: balanceAmount.value },
])

const documentSummaryRows = computed(() => [
  { label: 'รวมยอดเงิน', value: moneyValue(header.value.total_value, header.value.total_amount) },
  { label: 'ส่วนลด', value: moneyValue(header.value.total_discount), negative: true },
  { label: 'ยอดก่อนภาษี', value: moneyValue(header.value.total_before_vat) },
  { label: 'ภาษีมูลค่าเพิ่ม', value: moneyValue(header.value.total_vat_value) },
  { label: 'ยอดหลังภาษี', value: moneyValue(header.value.total_after_vat) },
  { label: 'ยอดยกเว้นภาษี', value: moneyValue(header.value.total_except_vat) },
  { label: 'ค่า Charge บัตรเครดิต', value: moneyValue(header.value.total_credit_charge, paymentSummary.value.credit_card_charge) },
  { label: 'รับอื่น ๆ', value: moneyValue(header.value.total_income_other, paymentSummary.value.income_other_amount) },
  { label: 'ปิดเศษ', value: moneyValue(header.value.total_income_amount) },
  { label: 'ยอดรวมทั้งสิ้น', value: documentAmount.value, strong: true },
])

const paymentSummaryRows = computed(() => [
  { label: 'เงินสด', value: moneyValue(paymentSummary.value.cash_amount, header.value.cash_amount) },
  { label: 'รับเงิน', value: moneyValue(paymentSummary.value.pay_cash_amount, header.value.pay_cash_amount) },
  { label: 'เงินทอน', value: moneyValue(paymentSummary.value.money_change, header.value.money_change), accent: true },
  { label: 'เงินโอน', value: moneyValue(paymentSummary.value.transfer_amount, header.value.tranfer_amount) },
  { label: 'เช็ค', value: moneyValue(paymentSummary.value.cheque_amount, header.value.chq_amount) },
  { label: 'บัตรเครดิต', value: moneyValue(paymentSummary.value.credit_card_amount, header.value.card_amount) },
  { label: 'เงินสดย่อย', value: moneyValue(paymentSummary.value.petty_cash_amount, header.value.petty_cash_amount) },
  { label: 'ตัดเงินล่วงหน้า', value: moneyValue(paymentSummary.value.deposit_amount, header.value.deposit_amount) },
  { label: 'ชำระด้วยคูปอง', value: moneyValue(paymentSummary.value.coupon_amount, header.value.coupon_amount) },
  { label: 'หักอื่น ๆ', value: moneyValue(paymentSummary.value.expense_other_amount, header.value.total_expense_other), negative: true },
  { label: 'Wallet Payment', value: moneyValue(paymentSummary.value.wallet_amount, header.value.wallet_amount) },
  { label: 'รวมจ่าย', value: totalPaidAmount.value, strong: true },
])

function paymentRowTotal(row) {
  const docType = Number(row?.doc_type)
  if ([5, 9, 11, 12, 21].includes(docType)) return Number(row?.amount || row?.sum_amount || 0)
  const sumAmount = Number(row?.sum_amount || 0)
  if (sumAmount) return sumAmount
  if (docType === 3) return Number(row?.amount || 0) + Number(row?.charge || 0)
  return Number(row?.amount || 0)
}

function paymentRowCharge(row) {
  return Number(row?.charge || 0)
}

function sumPaymentRowsByType(docType, picker = paymentRowTotal) {
  return payments.value
    .filter((row) => Number(row.doc_type) === docType)
    .reduce((sum, row) => sum + Number(picker(row) || 0), 0)
}

const cashSummaryCards = computed(() => [
  { label: 'ยอดเอกสาร', value: documentAmount.value },
  { label: 'เงินสด', value: moneyValue(paymentSummary.value.cash_amount, header.value.cash_amount) },
  { label: 'รับเงิน', value: moneyValue(paymentSummary.value.pay_cash_amount, header.value.pay_cash_amount) },
  { label: 'เงินทอน', value: moneyValue(paymentSummary.value.money_change, header.value.money_change), accent: true },
  { label: 'รวมจ่าย', value: totalPaidAmount.value, strong: true },
  { label: 'คงเหลือ', value: balanceAmount.value },
])

const paymentGroups = computed(() => {
  const defs = [
    { docType: 1, key: 'transfer', label: 'เงินโอน', summaryKey: 'transfer_amount', headerKey: 'tranfer_amount', icon: 'pi pi-building-columns' },
    { docType: 3, key: 'credit', label: 'บัตรเครดิต', summaryKey: 'credit_card_amount', headerKey: 'card_amount', icon: 'pi pi-credit-card', charge: true },
    { docType: 2, key: 'cheque', label: 'เช็ค', summaryKey: 'cheque_amount', headerKey: 'chq_amount', icon: 'pi pi-file-edit' },
    { docType: 5, key: 'deposit', label: 'เงินล่วงหน้า', summaryKey: 'deposit_amount', headerKey: 'deposit_amount', icon: 'pi pi-receipt' },
    { docType: 9, key: 'coupon', label: 'คูปอง', summaryKey: 'coupon_amount', headerKey: 'coupon_amount', icon: 'pi pi-ticket' },
    { docType: 4, key: 'petty', label: 'เงินสดย่อย', summaryKey: 'petty_cash_amount', headerKey: 'petty_cash_amount', icon: 'pi pi-briefcase' },
    { docType: 12, key: 'income', label: 'รายได้อื่น', summaryKey: 'income_other_amount', headerKey: 'total_income_other', icon: 'pi pi-plus-circle' },
    { docType: 11, key: 'expense', label: 'ค่าใช้จ่ายอื่น', summaryKey: 'expense_other_amount', headerKey: 'total_expense_other', icon: 'pi pi-minus-circle', negative: true },
    { docType: 21, key: 'wallet', label: 'Wallet Payment', summaryKey: 'wallet_amount', headerKey: 'wallet_amount', icon: 'pi pi-wallet' },
    { docType: 19, key: 'currency', label: 'สกุลเงินอื่น ๆ', summaryKey: 'other_currency_amount', headerKey: 'total_other_currency', icon: 'pi pi-globe' },
  ]
  return defs.map((def) => {
    const rows = payments.value.filter((row) => Number(row.doc_type) === def.docType)
    const fallback = sumPaymentRowsByType(def.docType)
    const chargeTotal = def.charge ? sumPaymentRowsByType(def.docType, paymentRowCharge) : 0
    const total = moneyValue(paymentSummary.value[def.summaryKey], header.value[def.headerKey], fallback)
    return {
      ...def,
      rows,
      total,
      chargeTotal: def.charge ? moneyValue(paymentSummary.value.credit_card_charge, header.value.total_credit_charge, chargeTotal) : 0,
      count: rows.length,
    }
  }).filter((group) => group.rows.length || group.total || group.chargeTotal)
})

const vatSummaryRows = computed(() => [
  { label: 'จำนวนรายการ', value: vatRows.value.length, kind: 'count' },
  { label: 'ฐานภาษี', value: vatRows.value.reduce((sum, row) => sum + moneyValue(row.base_caltax_amount), 0) },
  { label: 'VAT', value: vatRows.value.reduce((sum, row) => sum + moneyValue(row.amount), 0), strong: true },
  { label: 'ยกเว้นภาษี', value: vatRows.value.reduce((sum, row) => sum + moneyValue(row.except_tax_amount), 0) },
])

const whtSummaryRows = computed(() => [
  { label: 'จำนวนเอกสาร', value: whtHeaders.value.length, kind: 'count' },
  { label: 'ฐานหัก ณ ที่จ่าย', value: whtHeaders.value.reduce((sum, row) => sum + moneyValue(row.amount), 0) },
  { label: 'ภาษีหักไว้', value: whtHeaders.value.reduce((sum, row) => sum + moneyValue(row.tax_value), 0), strong: true },
])

const glHeader = computed(() => detail.value?.gl_header || {})
const glDebitTotal = computed(() => glDetail.value.reduce((sum, row) => sum + moneyValue(row.debit), 0))
const glCreditTotal = computed(() => glDetail.value.reduce((sum, row) => sum + moneyValue(row.credit), 0))
const glBalanceDiff = computed(() => glDebitTotal.value - glCreditTotal.value)

function promotionKey(row, index = 0) {
  return `${row?.promotion_code || 'promotion'}-${row?.line_number ?? index}-${index}`
}

function promotionAmount(row) {
  return Math.abs(moneyValue(row?.sum_amount, row?.amount))
}

function promotionRelatedItems(row) {
  const itemCode = String(row?.item_code || row?._itemCode || row?.ic_code || '').trim()
  if (itemCode) return itemDisplayRows.value.filter((item) => String(item.item_code || '').trim() === itemCode)
  const lineNumber = Number(row?.line_number)
  if (Number.isFinite(lineNumber)) {
    const matched = itemDisplayRows.value.filter((item) => {
      const itemLineNumber = Number(item.line_number)
      return itemLineNumber === lineNumber
    })
    if (matched.length) return matched
  }
  return []
}

const promotionCards = computed(() =>
  promotions.value.map((row, index) => ({
    key: promotionKey(row, index),
    code: String(row.promotion_code || row.code || '').trim() || '-',
    name: String(row.promotion_name || row.name_1 || row.name || '').trim() || '-',
    qty: moneyValue(row.qty),
    price: moneyValue(row.price),
    amount: promotionAmount(row),
    lineNumber: row.line_number,
    relatedItems: promotionRelatedItems(row),
    raw: row,
  })),
)

const promotionAuditRows = computed(() =>
  promotionCards.value.map((card) => ({
    key: card.key,
    code: card.code,
    name: card.name,
    qty: card.qty,
    count: card.qty,
    amount: card.amount,
    relatedItems: card.relatedItems.map((item) => ({
      item_code: item.item_code,
      item_name: item.item_name,
      unit_code: item.unit_code,
      qty: item.qty,
    })),
  })),
)

const promotionStatusText = computed(() => (promotions.value.length ? 'คำนวณแล้ว' : 'ไม่มีโปรโมชั่นที่เข้าเงื่อนไข'))
const promotionDiscountAmount = computed(() => promotionCards.value.reduce((sum, card) => sum + card.amount, 0))

function itemPromotionRows(row) {
  const itemCode = String(row?.item_code || '').trim()
  const unitCode = String(row?.unit_code || '').trim()
  const lineNumber = Number(row?.line_number)
  return promotionCards.value.filter((card) => {
    if (Number.isFinite(lineNumber) && Number.isFinite(Number(card.lineNumber)) && Number(card.lineNumber) === lineNumber) return true
    return card.relatedItems.some((item) => {
      const matchedItem = String(item.item_code || '').trim() === itemCode
      if (!matchedItem) return false
      const matchedUnit = !unitCode || !item.unit_code || String(item.unit_code).trim() === unitCode
      return matchedUnit
    })
  })
}

function itemHasPromotions(row) {
  return itemPromotionRows(row).length > 0
}

function openItemPromotionDetails(row) {
  if (!itemHasPromotions(row)) return
  openPromotionDetails()
}

function openPromotionDetails() {
  if (!promotions.value.length) return
  promotionAuditExpanded.value = true
  nextTick(() => {
    promotionFooterRef.value?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  })
}

watch(promotions, () => {
  promotionAuditExpanded.value = false
})

const shipmentRows = computed(() => [
  ['ผู้รับ/ขนส่ง', shipment.value.transport_name],
  ['ที่อยู่', shipment.value.transport_address],
  ['โทรศัพท์', shipment.value.transport_telephone],
  ['แฟกซ์', shipment.value.transport_fax],
  ['ตำบล', shipment.value.transport_tambon],
  ['อำเภอ', shipment.value.transport_amper],
  ['จังหวัด', shipment.value.transport_province],
  ['ประเทศ', shipment.value.transport_country],
  ['รหัสไปรษณีย์', shipment.value.zipcode],
  ['รหัสขนส่ง', shipment.value.transport_code],
  ['ปลายทาง', shipment.value.destination],
  ['รหัสจัดส่ง', shipment.value.ship_code],
  ['พื้นที่จัดส่ง', shipment.value.logistic_area],
  ['ละติจูด', shipment.value.latitude],
  ['ลองจิจูด', shipment.value.longitude],
  ['หมายเหตุ', shipment.value.remark],
  ['หมายเหตุ 2', shipment.value.remark_2],
].map(([label, value]) => ({ label, value }))
)

function isSetChild(row) {
  return String(row?.set_ref_line || '').trim() !== '' && Number(row?.item_type) !== 3
}

function isSetParent(row) {
  return Number(row?.item_type) === 3
}

const itemDisplayRows = computed(() => {
  const rows = items.value.map((row, index) => ({
    ...row,
    _row_key: `${row.line_number ?? index}-${row.item_code || ''}-${index}`,
    _is_child: isSetChild(row),
    _is_set_parent: isSetParent(row),
    _display_no: Number(row.line_number ?? index) + 1,
    _child_count: 0,
  }))
  const parentByGuid = new Map()
  for (const row of rows) {
    const guid = String(row.ref_guid || '').trim()
    if (guid) parentByGuid.set(guid, row)
  }
  for (const row of rows) {
    if (!row._is_child) continue
    const parent = parentByGuid.get(String(row.set_ref_line || '').trim())
    if (parent) parent._child_count += 1
  }
  return rows
})

const topLevelItemCount = computed(() => itemDisplayRows.value.filter((row) => !row._is_child).length)
const setParentCount = computed(() => itemDisplayRows.value.filter((row) => row._is_set_parent).length)
const setChildCount = computed(() => itemDisplayRows.value.filter((row) => row._is_child).length)
const itemQtyTotal = computed(() =>
  itemDisplayRows.value.filter((row) => !row._is_child).reduce((sum, row) => sum + moneyValue(row.qty), 0),
)
const itemSumTotal = computed(() =>
  itemDisplayRows.value.filter((row) => !row._is_child).reduce((sum, row) => sum + moneyValue(row.sum_amount), 0),
)

const itemSummaryRows = computed(() => [
  { label: 'รายการหลัก', value: topLevelItemCount.value, kind: 'count' },
  { label: 'สินค้าชุด', value: setParentCount.value, kind: 'count' },
  { label: 'รายการลูก', value: setChildCount.value, kind: 'count' },
  { label: 'จำนวนรวม', value: itemQtyTotal.value, kind: 'number' },
  { label: 'รวมตามรายการหลัก', value: itemSumTotal.value, kind: 'currency', strong: true },
])

function itemRowClass(row) {
  if (row?._is_child) return 'set-child-row'
  if (row?._is_set_parent) return 'set-parent-row'
  return ''
}

function itemNameClass(row) {
  if (row?._is_child) return 'item-child-name'
  if (row?._is_set_parent) return 'item-set-name'
  return ''
}

function itemTypeLabel(row) {
  if (row?._is_set_parent) return `ชุด${row._child_count ? ` ${row._child_count}` : ''}`
  if (row?._is_child) return 'ลูกชุด'
  return 'สินค้า'
}

function itemTaxLabel(row) {
  if (Number(row?.tax_type) === 1) return 'ยกเว้น'
  const rate = Number(header.value.vat_rate || 0)
  const vatType = Number(row?.vat_type ?? header.value.vat_type)
  if (vatType === 0) return `แยกนอก ${rate}%`
  if (vatType === 1) return `รวมใน ${rate}%`
  return 'ไม่มี VAT'
}

function itemLocation(row) {
  const wh = String(row?.wh_code || '').trim()
  const shelf = String(row?.shelf_code || '').trim()
  if (!wh && !shelf) return '-'
  return `${wh || '-'} / ${shelf || '-'}`
}

function itemUnitRatio(row) {
  const stand = Number(row?.stand_value || 0)
  const divide = Number(row?.divide_value || 0)
  const ratio = Number(row?.ratio || 0)
  if (stand || divide) return `${formatNumber(stand || 0)}:${formatNumber(divide || 0)}`
  if (ratio) return formatNumber(ratio)
  return ''
}

function itemCurrencyAmount(row, key) {
  const code = String(row?.currency_code || header.value.currency_code || '').trim()
  const normalizedCode = code.toUpperCase()
  const value = Number(row?.[key] || 0)
  if (!code || normalizeCurrencyCode(normalizedCode) === homeCurrencyCode || !value) return ''
  return `${formatNumber(value)} ${code}`
}

function paymentTypeName(row) {
  const map = {
    1: 'โอน',
    2: 'เช็ค',
    3: 'บัตรเครดิต',
    4: 'เงินสดย่อย',
    5: 'เงินล่วงหน้า',
    9: 'คูปอง',
    11: 'ค่าใช้จ่ายอื่น',
    12: 'รายได้อื่น',
    21: 'Wallet',
  }
  return row?.payment_type_name || map[Number(row?.doc_type)] || `ประเภท ${row?.doc_type ?? '-'}`
}

function formatCurrencyCode(row) {
  const code = String(row?.currency_code || '').trim()
  if (!code) return '-'
  const rate = Number(row?.exchange_rate || 0)
  return rate > 0 ? `${code} @ ${formatNumber(rate)}` : code
}

function paymentForeignAmount(row) {
  const code = String(row?.currency_code || '').trim()
  if (!code) return ''
  const amount2 = Number(row?.amount_2 || 0)
  const charge2 = Number(row?.charge_2 || 0)
  const sum2 = Number(row?.sum_amount_2 || 0)
  const parts = []
  if (amount2) parts.push(`จำนวน ${formatNumber(amount2)} ${code}`)
  if (charge2) parts.push(`Charge ${formatNumber(charge2)} ${code}`)
  if (sum2) parts.push(`รวม ${formatNumber(sum2)} ${code}`)
  return parts.join(' · ')
}

function paymentReferenceText(row) {
  return [
    row?.trans_number ? `เลขที่ ${row.trans_number}` : '',
    row?.pass_book_code ? `สมุด ${row.pass_book_code}` : '',
    row?.bank_code ? `ธนาคาร ${row.bank_code}` : '',
    row?.bank_branch ? `สาขา ${row.bank_branch}` : '',
    row?.credit_card_type ? `ประเภท ${row.credit_card_type}` : '',
    row?.no_approved ? `อนุมัติ ${row.no_approved}` : '',
    row?.doc_ref ? `อ้างอิง ${row.doc_ref}` : '',
  ].filter(Boolean).join(' · ')
}

function paymentDateText(row) {
  return [
    row?.doc_date_ref ? `วันที่อ้างอิง ${formatDate(row.doc_date_ref)}` : '',
    row?.chq_due_date ? `ครบกำหนด ${formatDate(row.chq_due_date)}` : '',
  ].filter(Boolean).join(' · ')
}

function paymentRemarkText(row) {
  return [row?.description, row?.remark].filter(Boolean).join(' · ')
}

function paymentBalanceText(row) {
  const parts = []
  const sumAmount = Number(row?.sum_amount || 0)
  const amount = Number(row?.amount || 0)
  const balance = Number(row?.balance_amount || 0)
  if (sumAmount && sumAmount !== amount) parts.push(`ยอดรวม ${formatCurrency(sumAmount)}`)
  if (balance) parts.push(`ยอดคงเหลือ ${formatCurrency(balance)}`)
  return parts.join(' · ')
}

function summaryValue(row) {
  if (row.kind === 'count') return formatCount(row.value || 0)
  if (row.kind === 'number') return formatNumber(row.value || 0)
  return formatCurrency(row.value || 0)
}

function signedCurrency(value, forceNegative = false) {
  const number = Number(value || 0)
  const sign = forceNegative && number > 0 ? '-' : ''
  return `${sign}${formatCurrency(forceNegative && number > 0 ? number : number)}`
}

function branchTypeLabel(type) {
  const value = Number(type)
  if (value === 1) return 'สำนักงานใหญ่'
  if (value === 2) return 'สาขา'
  return '-'
}

function vatModeLabel(row) {
  const type = Number(row?.vat_type)
  if (type === 0) return 'แยกนอก'
  if (type === 1) return 'รวมใน'
  return 'ไม่มีภาษี'
}

function whtDetailsTotal(row) {
  return (row?.details || []).reduce((sum, detailRow) => sum + moneyValue(detailRow.tax_value), 0)
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

async function loadDocImages() {
  if (!props.docNo) {
    docImages.value = []
    return
  }
  docImages.value = await getDocImagesList(props.docNo)
}

async function onDocImageSelected(event) {
  const files = Array.from(event.target.files || [])
  if (!files.length || imageUploading.value) return
  imageUploading.value = true
  imageError.value = ''
  try {
    for (const file of files) {
      if (!file.type.startsWith('image/')) throw new Error('กรุณาเลือกไฟล์รูปภาพเท่านั้น')
      await saveDocImage(props.docNo, await fileToDataUrl(file))
    }
    await loadDocImages()
    event.target.value = ''
  } catch (err) {
    imageError.value = err.message || 'บันทึกรูปไม่สำเร็จ'
  } finally {
    imageUploading.value = false
  }
}

async function removeDocImage(image) {
  const guidCode = image?.guid_code
  if (!guidCode) return
  imageError.value = ''
  try {
    await deleteDocImage(guidCode)
    await loadDocImages()
  } catch (err) {
    imageError.value = err.message || 'ลบรูปไม่สำเร็จ'
  }
}

function goBack() {
  router.push({ name: 'SalesHistory' })
}

function editDocument() {
  router.push({ name: 'Sell', query: { doc_no: props.docNo } })
}

function isPosSlipFormCode(formCode) {
  return String(formCode || '').trim().toUpperCase() === 'CR-0088'
}

async function printDocument() {
  if (printing.value) return
  printing.value = true
  errorMsg.value = ''
  try {
    const result = await getSalePrintForms(props.docNo)
    const forms = result?.forms || []
    const selected = forms.filter((form) => form.available && form.is_default).map((form) => form.formcode)
    const fallback = forms.filter((form) => form.available).slice(0, 1).map((form) => form.formcode)
    const formcodes = selected.length ? selected : fallback
    if (!formcodes.length) throw new Error('ไม่พบฟอร์มพิมพ์ที่พร้อมใช้งาน')
    const printUrl = formcodes.length === 1 && isPosSlipFormCode(formcodes[0])
      ? getSalePosSlipPrintUrl(props.docNo, authStore.employee?.user_code || '')
      : getSalePrintUrl(props.docNo, formcodes, authStore.employee?.user_code || '')
    window.open(printUrl, '_blank', 'noopener')
  } catch (err) {
    errorMsg.value = err.message || 'พิมพ์เอกสารไม่สำเร็จ'
  } finally {
    printing.value = false
  }
}

async function loadDetail() {
  if (!props.docNo) return
  loading.value = true
  errorMsg.value = ''
  imageError.value = ''
  detail.value = null
  docImages.value = []
  try {
    const [docDetail] = await Promise.all([
      getDocSaleHistoryDetail(props.docNo),
      loadDocImages(),
    ])
    detail.value = docDetail
  } catch (err) {
    errorMsg.value = err.message || 'โหลดรายละเอียดเอกสารไม่สำเร็จ'
  } finally {
    loading.value = false
  }
}

watch(() => props.docNo, loadDetail, { immediate: true })
</script>

<template>
  <div class="sale-detail-page biz-page">
    <div class="biz-page-header">
      <div class="biz-page-title-wrap">
        <Button icon="pi pi-arrow-left" text rounded aria-label="กลับ" @click="goBack" />
        <div>
          <h1 class="biz-page-title">ขายสินค้า</h1>
          <div class="header-meta-pills">
            <span class="readonly-pill"><i class="pi pi-lock" /> อ่านอย่างเดียว</span>
            <span><i class="pi pi-id-card" /> {{ props.docNo }}</span>
            <span><i class="pi pi-calendar" /> {{ formatDate(header.doc_date) }}</span>
            <span v-if="header.doc_time"><i class="pi pi-clock" /> {{ header.doc_time }}</span>
            <span v-for="chip in documentChips" :key="chip" class="header-chip">{{ chip }}</span>
          </div>
        </div>
      </div>
      <div class="header-actions">
        <Button label="กลับ" icon="pi pi-arrow-left" severity="secondary" outlined @click="goBack" />
        <Button label="แก้ไขเอกสาร" icon="pi pi-pencil" severity="secondary" outlined @click="editDocument" />
        <Button label="พิมพ์" icon="pi pi-print" :loading="printing" @click="printDocument" />
      </div>
    </div>

    <Message v-if="errorMsg" severity="error" :closable="false">{{ errorMsg }}</Message>

    <div v-if="loading" class="loading-panel">
      <ProgressSpinner style="width: 42px; height: 42px" />
    </div>

    <template v-else-if="detail">
      <section class="sell-grid">
        <main class="document-workspace">
          <section class="workspace-tabs-card" aria-label="ส่วนรายละเอียดเอกสารขาย">
            <div class="workspace-tabs" role="tablist" aria-label="เลือกส่วนงานเอกสารขาย">
              <button
                v-for="tab in tabs"
                :key="tab.key"
                type="button"
                role="tab"
                :aria-selected="activeTab === tab.key"
                :class="{ active: activeTab === tab.key }"
                @click="activeTab = tab.key"
              >
                <i :class="tab.icon" />
                <span>{{ tab.label }}</span>
                <b v-if="tab.badge">{{ tab.badge }}</b>
              </button>
            </div>
          </section>

          <div v-if="activeTab === 'details'" class="details-layout">
            <section class="biz-panel document-panel">
              <div class="panel-title">
                <i class="pi pi-file-edit" />
                <strong>เอกสาร</strong>
              </div>
              <div class="doc-grid read-grid">
                <label
                  v-for="row in documentFieldRows"
                  :key="row.label"
                  class="field readonly-field"
                  :class="{ 'wide-field': row.wide }"
                >
                  <span>{{ row.label }}</span>
                  <strong>{{ row.value || '-' }}</strong>
                </label>
              </div>
            </section>

            <section class="biz-panel lines-panel">
              <div class="panel-title">
                <i class="pi pi-list" />
                <strong>รายการสินค้า</strong>
                <span class="panel-count">{{ itemDisplayRows.length }} รายการ</span>
              </div>
              <div class="items-layout">
                <DataTable
                  :value="itemDisplayRows"
                  size="small"
                  scrollable
                  responsive-layout="scroll"
                  :row-class="itemRowClass"
                >
                  <template #empty><div class="empty-msg">ไม่มีรายการสินค้า</div></template>
                  <Column header="#" style="width: 56px">
                    <template #body="{ data }">{{ data._display_no }}</template>
                  </Column>
                  <Column header="สินค้า" style="min-width: 280px">
                    <template #body="{ data }">
                      <div :class="['item-name-main', itemNameClass(data)]">
                        <span v-if="data._is_child" class="child-marker">└</span>
                        <strong>{{ data.item_name || '-' }}</strong>
                        <span v-if="data._is_set_parent" class="item-type-badge set">ชุด {{ data._child_count || '' }}</span>
                        <button
                          v-if="itemHasPromotions(data)"
                          type="button"
                          class="item-promotion-btn"
                          title="ดูโปรโมชั่น"
                          @click.stop="openItemPromotionDetails(data)"
                        >
                          <i class="pi pi-tag" />
                        </button>
                      </div>
                    </template>
                  </Column>
                  <Column field="item_code" header="รหัส" style="min-width: 120px" />
                  <Column header="หน่วย" style="min-width: 90px">
                    <template #body="{ data }">{{ data.unit_code || '-' }}</template>
                  </Column>
                  <Column header="คลัง/ที่เก็บ" style="min-width: 150px">
                    <template #body="{ data }">{{ itemLocation(data) }}</template>
                  </Column>
                  <Column header="จำนวน" body-class="col-num" header-class="col-num" header-style="text-align:center" style="min-width: 100px;">
                    <template #body="{ data }">{{ formatNumber(data.qty) }}</template>
                  </Column>
                  <Column header="ราคา" body-class="col-num" header-class="col-num" style="min-width: 110px" header-style="text-align:center">
                    <template #body="{ data }">{{ formatCurrency(data.price) }}</template>
                  </Column>
                  <Column header="ส่วนลด" body-class="col-num" header-class="col-num" style="min-width: 110px" header-style="text-align:center">
                    <template #body="{ data }">{{ data.discount || formatCurrency(data.discount_amount || 0) }}</template>
                  </Column>
                  <Column header="รวม" body-class="col-num" header-class="col-num" style="min-width: 120px" header-style="text-align:center">
                    <template #body="{ data }">
                      <div>{{ formatCurrency(data.sum_amount) }}</div>
                      <small v-if="itemCurrencyAmount(data, 'sum_amount_2')">{{ itemCurrencyAmount(data, 'sum_amount_2') }}</small>
                    </template>
                  </Column>
                  <Column header="หมายเหตุ" style="min-width: 120px">
                    <template #body="{ data }">{{ data.remark || '-' }}</template>
                  </Column>
                </DataTable>
              </div>
            </section>

          </div>

          <section v-else class="biz-panel additional-panel">
            <div class="panel-title">
              <i :class="activeTabMeta.icon" />
              <strong>{{ activeTabMeta.label }}</strong>
            </div>
            <div v-if="activeTab === 'vat'" class="section-layout">
          <div class="mini-summary-strip">
            <article v-for="row in vatSummaryRows" :key="row.label" :class="{ strong: row.strong }">
              <span>{{ row.label }}</span>
              <strong>{{ summaryValue(row) }}</strong>
            </article>
          </div>
          <DataTable :value="vatRows" size="small" scrollable responsive-layout="scroll">
            <template #empty><div class="empty-msg">ไม่มีรายการ VAT</div></template>
            <Column field="vat_number" header="เลขที่ภาษี" style="min-width: 150px" />
            <Column header="วันที่" style="min-width: 120px"><template #body="{ data }">{{ formatDate(data.vat_date) }}</template></Column>
            <Column field="description" header="รายละเอียด" style="min-width: 220px" />
            <Column header="ประเภท" style="min-width: 130px"><template #body="{ data }">{{ vatModeLabel(data) }} {{ formatNumber(data.tax_rate || 0) }}%</template></Column>
            <Column header="สาขา" style="min-width: 130px"><template #body="{ data }">{{ branchTypeLabel(data.branch_type) }} {{ data.branch_code || '' }}</template></Column>
            <Column field="tax_no" header="เลขประจำตัวภาษี" style="min-width: 160px" />
            <Column header="ฐานภาษี" body-class="col-num" header-class="col-num"><template #body="{ data }">{{ formatCurrency(data.base_caltax_amount) }}</template></Column>
            <Column header="VAT" body-class="col-num" header-class="col-num"><template #body="{ data }">{{ formatCurrency(data.amount) }}</template></Column>
            <Column header="ยกเว้น" body-class="col-num" header-class="col-num"><template #body="{ data }">{{ formatCurrency(data.except_tax_amount) }}</template></Column>
          </DataTable>
        </div>

        <div v-else-if="activeTab === 'wht'" class="section-layout">
          <div class="mini-summary-strip">
            <article v-for="row in whtSummaryRows" :key="row.label" :class="{ strong: row.strong }">
              <span>{{ row.label }}</span>
              <strong>{{ summaryValue(row) }}</strong>
            </article>
          </div>
          <div class="stack-list">
            <article v-for="row in whtHeaders" :key="`${row.tax_doc_no}-${row.line_number}`" class="wht-card">
              <header>
                <div>
                  <strong>{{ row.tax_doc_no || '-' }}</strong>
                  <span>{{ formatDate(row.due_date) }} · {{ row.cust_code || '-' }} {{ row.cust_name || '' }}</span>
                </div>
                <b>{{ formatCurrency(row.tax_value || whtDetailsTotal(row) || 0) }}</b>
              </header>
              <div class="wht-meta">
                <span>ฐาน {{ formatCurrency(row.amount || 0) }}</span>
                <span>เลขภาษี {{ row.tax_number || '-' }}</span>
                <span>บัตร {{ row.card_number || '-' }}</span>
              </div>
              <DataTable v-if="row.details?.length" :value="row.details" size="small" responsive-layout="scroll">
                <Column field="income_type" header="ประเภทเงินได้" />
                <Column header="ฐาน" body-class="col-num" header-class="col-num"><template #body="{ data }">{{ formatCurrency(data.amount) }}</template></Column>
                <Column header="อัตรา" body-class="col-num" header-class="col-num"><template #body="{ data }">{{ formatNumber(data.tax_rate) }}%</template></Column>
                <Column header="ภาษี" body-class="col-num" header-class="col-num"><template #body="{ data }">{{ formatCurrency(data.tax_value) }}</template></Column>
              </DataTable>
            </article>
            <div v-if="!whtHeaders.length" class="empty-msg">ไม่มีรายการหัก ณ ที่จ่าย</div>
          </div>
        </div>

        <div v-else-if="activeTab === 'shipment'" class="section-layout">
          <div class="info-grid labeled">
            <div v-for="row in shipmentRows" :key="row.label">
              <span>{{ row.label }}</span>
              <strong>{{ row.value || '-' }}</strong>
            </div>
          </div>
        </div>

        <div v-else-if="activeTab === 'gl'" class="section-layout">
          <div class="gl-summary">
            <article><span>เล่มบัญชี</span><strong>{{ glHeader.book_code || '-' }}</strong></article>
            <article><span>วันที่อ้างอิง</span><strong>{{ formatDate(glHeader.ref_date) }}</strong></article>
            <article><span>เลขที่อ้างอิง</span><strong>{{ glHeader.ref_no || '-' }}</strong></article>
            <article><span>เดบิต</span><strong>{{ formatCurrency(glDebitTotal) }}</strong></article>
            <article><span>เครดิต</span><strong>{{ formatCurrency(glCreditTotal) }}</strong></article>
            <article :class="{ warn: Math.abs(glBalanceDiff) > 0.005 }"><span>ผลต่าง</span><strong>{{ formatCurrency(glBalanceDiff) }}</strong></article>
          </div>
          <DataTable :value="glDetail" size="small" scrollable responsive-layout="scroll">
            <template #empty><div class="empty-msg">ไม่มีรายการ GL</div></template>
            <Column field="account_code" header="บัญชี" style="min-width: 140px" />
            <Column field="account_name" header="ชื่อบัญชี" style="min-width: 240px" />
            <Column header="เดบิต" body-class="col-num" header-class="col-num"><template #body="{ data }">{{ formatCurrency(data.debit) }}</template></Column>
            <Column header="เครดิต" body-class="col-num" header-class="col-num"><template #body="{ data }">{{ formatCurrency(data.credit) }}</template></Column>
          </DataTable>
        </div>

        <div v-else-if="activeTab === 'more'" class="section-layout">
          <div class="proof-section-full">
          <div class="proof-head-full">
            <div>
              <strong>รูปหลักฐาน</strong>
              <span>{{ docImages.length }} รูป</span>
            </div>
            <label class="proof-upload-btn" :class="{ disabled: imageUploading }">
              <i class="pi pi-upload" />
              <span>{{ imageUploading ? 'กำลังบันทึก...' : 'เพิ่มรูป' }}</span>
              <input type="file" accept="image/*" multiple :disabled="imageUploading" @change="onDocImageSelected" />
            </label>
          </div>
          <Message v-if="imageError" severity="error" :closable="false">{{ imageError }}</Message>
          <div v-if="docImages.length" class="proof-grid-full">
            <article v-for="image in docImages" :key="image.guid_code" class="proof-item-full">
              <a :href="getDocImageUrl(image.guid_code)" target="_blank" rel="noopener">
                <img :src="getDocImageUrl(image.guid_code)" alt="หลักฐานเอกสารขาย" />
              </a>
              <button type="button" @click="removeDocImage(image)" aria-label="ลบรูป">
                <i class="pi pi-trash" />
              </button>
            </article>
          </div>
          <div v-else class="empty-msg">ยังไม่มีรูปหลักฐาน</div>
          </div>
        </div>
          </section>
        </main>

        <aside class="biz-panel payment-card payment-inspector" aria-label="รับชำระเงิน">
          <div class="panel-title">
            <i class="pi pi-wallet" />
            <strong>รับชำระเงิน</strong>
          </div>
          <header class="payment-inspector-head">
            <div>
              <span>รับชำระเงิน</span>
              <strong>{{ formatCurrency(documentAmount) }}</strong>
            </div>
            <small>รวมจ่าย {{ formatCurrency(totalPaidAmount) }} · คงเหลือ {{ formatCurrency(balanceAmount) }}</small>
          </header>

          <div class="cash-summary inspector-cash-summary">
            <div
              v-for="card in cashSummaryCards"
              :key="card.label"
              :class="{ strong: card.strong, accent: card.accent }"
            >
              <span>{{ card.label }}</span>
              <strong>{{ formatCurrency(card.value || 0) }}</strong>
            </div>
          </div>

          <div class="payment-groups inspector-payment-groups">
            <article
              v-for="group in paymentGroups"
              :key="group.key"
              class="payment-group-card"
              :class="{ negative: group.negative || group.total < 0 }"
            >
              <header>
                <div>
                  <i :class="group.icon" />
                  <strong>{{ group.label }}</strong>
                  <span v-if="group.count">{{ group.count }} รายการ</span>
                </div>
                <div class="payment-group-total">
                  <small v-if="group.charge">Charge {{ formatCurrency(group.chargeTotal || 0) }}</small>
                  <b>{{ signedCurrency(group.total || 0, group.negative) }}</b>
                </div>
              </header>

              <div v-if="group.rows.length" class="payment-row-list">
                <div
                  v-for="row in group.rows"
                  :key="`${row.line_number}-${row.doc_type}-${row.trans_number}`"
                  class="payment-row"
                >
                  <div class="payment-row-main">
                    <div>
                      <strong>{{ paymentReferenceText(row) || paymentTypeName(row) }}</strong>
                      <span v-if="paymentDateText(row)">{{ paymentDateText(row) }}</span>
                      <span v-if="paymentBalanceText(row)">{{ paymentBalanceText(row) }}</span>
                      <span v-if="paymentRemarkText(row)">{{ paymentRemarkText(row) }}</span>
                      <span v-if="formatCurrencyCode(row) !== '-'">{{ formatCurrencyCode(row) }}</span>
                      <span v-if="paymentForeignAmount(row)">{{ paymentForeignAmount(row) }}</span>
                    </div>
                    <div class="payment-row-amounts">
                      <strong>{{ formatCurrency(paymentRowTotal(row)) }}</strong>
                      <small v-if="Number(row.charge || 0)">Charge {{ formatCurrency(row.charge || 0) }}</small>
                    </div>
                  </div>
                </div>
              </div>
              <div v-else class="payment-empty-line">มีเฉพาะยอดสรุปจาก cb_trans</div>
            </article>

            <div v-if="!paymentGroups.length" class="empty-msg">ไม่มีรายละเอียดชำระเงิน</div>
          </div>
        </aside>
      </section>

      <section class="biz-panel doc-footer-panel">
        <div class="doc-footer-grid">
          <div class="doc-footer-left">
            <div class="doc-footer-block">
              <div class="panel-title compact">
                <i class="pi pi-globe" />
                <strong>สกุลเงิน</strong>
              </div>
              <div class="doc-footer-inline-grid">
                <label v-for="row in currencyFooterRows" :key="row.label" class="field readonly-field">
                  <span>{{ row.label }}</span>
                  <strong>{{ row.value || '-' }}</strong>
                </label>
              </div>
            </div>

            <div class="doc-footer-block">
              <div class="panel-title compact">
                <i class="pi pi-truck" />
                <strong>การจัดส่ง</strong>
              </div>
              <div class="doc-footer-inline-grid">
                <label v-for="row in shipmentFooterRows" :key="row.label" class="field readonly-field">
                  <span>{{ row.label }}</span>
                  <strong>{{ row.value || '-' }}</strong>
                </label>
              </div>
            </div>

            <div class="doc-footer-block">
              <div class="panel-title compact">
                <i class="pi pi-calendar" />
                <strong>เครดิต</strong>
              </div>
              <div class="doc-footer-inline-grid">
                <label v-for="row in creditFooterRows" :key="row.label" class="field readonly-field">
                  <span>{{ row.label }}</span>
                  <strong>{{ row.value || '-' }}</strong>
                </label>
              </div>
            </div>
          </div>

          <div class="doc-footer-right">
            <div class="doc-footer-block">
              <div class="panel-title compact">
                <i class="pi pi-calculator" />
                <strong>ยอดรวม (บาท)</strong>
              </div>
              <label class="field readonly-field">
                <span>ส่วนลดท้ายบิล</span>
                <strong>{{ header.discount_word || '-' }}</strong>
              </label>

              <template v-if="showDocumentCurrencySummary">
                <div class="summary-list compact currency-summary-list">
                  <div class="summary-list-header">{{ header.currency_code || 'สกุลเงิน' }} (สกุลเงิน)</div>
                  <div
                    v-for="row in documentCurrencySummaryRows.filter((item) => !item.hideWhenZero || item.value)"
                    :key="row.label"
                    :class="{ net: row.strong }"
                  >
                    <span>{{ row.label }}</span>
                    <strong :class="{ discount: row.negative }">{{ signedCurrency(row.value || 0, row.negative) }}</strong>
                  </div>
                </div>
              </template>

              <div class="summary-list compact">
                <div
                  v-for="row in bahtSummaryRows.filter((item) => !item.hideWhenZero || item.value)"
                  :key="row.label"
                  :class="{ net: row.strong }"
                >
                  <span>{{ row.label }}</span>
                  <strong :class="{ discount: row.negative }">{{ signedCurrency(row.value || 0, row.negative) }}</strong>
                </div>
              </div>

              <div ref="promotionFooterRef" class="promotion-panel status-success readonly-audit-panel">
                <div class="promotion-panel-head">
                  <div>
                    <span>สถานะโปรโมชั่น</span>
                    <strong>{{ promotionStatusText }}</strong>
                  </div>
                </div>

                <Message v-if="!promotionAuditRows.length" severity="info" :closable="false"> คำนวณโปรโมชั่นแล้ว ไม่พบโปรโมชั่นที่เข้าเงื่อนไข </Message>

                <div v-if="promotionAuditRows.length" class="promotion-collapse-row">
                  <div>
                    <span>เข้าโปรโมชั่น {{ promotionAuditRows.length }} รายการ</span>
                    <strong class="discount">ลดรวม {{ formatCurrency(promotionDiscountAmount) }}</strong>
                  </div>
                  <Button
                    :label="promotionAuditExpanded ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียด'"
                    :icon="promotionAuditExpanded ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
                    size="small"
                    text
                    @click="promotionAuditExpanded = !promotionAuditExpanded"
                  />
                </div>

                <div v-if="promotionAuditRows.length && promotionAuditExpanded" class="promotion-audit-list">
                  <article v-for="promotion in promotionAuditRows" :key="promotion.key" class="promotion-audit-card">
                    <div class="promotion-audit-main">
                      <div>
                        <span class="promotion-code">{{ promotion.code || '-' }}</span>
                        <strong>{{ promotion.name }}</strong>
                      </div>
                      <strong class="discount">-{{ formatCurrency(promotion.amount) }}</strong>
                    </div>
                    <div class="promotion-audit-meta">
                      <span>จำนวนครั้ง {{ formatNumber(promotion.qty || promotion.count || 0) }}</span>
                      <span>ยอดลด {{ formatCurrency(promotion.amount) }}</span>
                    </div>
                    <div class="promotion-related">
                      <span>สินค้าที่เกี่ยวข้อง</span>
                      <div v-if="promotion.relatedItems.length" class="promotion-related-list">
                        <small v-for="item in promotion.relatedItems" :key="`${promotion.key}-${item.item_code}-${item.unit_code}`">
                          {{ item.item_code }} {{ item.item_name }} / {{ item.unit_code || '-' }} x {{ formatNumber(item.qty) }}
                        </small>
                      </div>
                      <small v-else class="promotion-related-empty">ยังไม่มีรายละเอียดสินค้าจากผลลัพธ์โปรโมชั่น</small>
                    </div>
                  </article>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer class="sell-status-bar" aria-label="สถานะเอกสารขาย">
        <div class="status-metric">
          <span>รายการ</span>
          <strong>{{ topLevelItemCount }}</strong>
        </div>
        <div class="status-metric">
          <span>ชำระ:</span>
          <strong>{{ Math.abs(balanceAmount) <= 0.005 ? 'ชำระครบ' : 'ยังไม่ครบ' }}</strong>
        </div>
        <div class="status-metric net">
          <span>ยอดสุทธิ</span>
          <strong>{{ formatCurrency(documentAmount) }}</strong>
        </div>
        <div class="status-state">
          <i class="pi pi-lock" />
          <strong>อ่านอย่างเดียว</strong>
        </div>
        <Button class="status-save-btn" :label="`บันทึกแล้ว ${props.docNo}`" icon="pi pi-save" disabled />
      </footer>
    </template>
  </div>
</template>

<style scoped>
.sale-detail-page {
  gap: 1rem;
  background: #f4f7fa;
  color: #172033;
  min-height: 100vh;
}

.detail-header,
.doc-identity,
.summary-grid,
.totals-board,
.detail-tabs,
.detail-panel,
.document-workspace {
  width: 100%;
}

.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.detail-title-block,
.detail-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.eyebrow,
.doc-identity span,
.summary-card span,
.info-grid span {
  color: var(--p-text-color-secondary);
  font-size: 0.78rem;
  font-weight: 700;
}

h1 {
  margin: 0;
  font-size: 1.45rem;
}

p {
  margin: 0.15rem 0 0;
  color: var(--p-text-color-secondary);
}

.header-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.45rem;
}

.header-chip {
  border: 1px solid #c7d2fe;
  border-radius: 999px;
  background: #eef2ff;
  color: #3730a3;
  font-size: 0.75rem;
  font-weight: 800;
  line-height: 1;
  padding: 0.32rem 0.55rem;
}

.document-workspace {
  align-items: start;
  display: grid;
  gap: 0.8rem;
  grid-template-columns: minmax(0, 1fr) 390px;
}

.document-main,
.details-layout {
  display: grid;
  gap: 0.85rem;
  min-width: 0;
}

.doc-identity {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
}

.doc-identity > div,
.summary-card,
.detail-panel,
.info-card,
.payment-inspector {
  border: 1px solid #d6dee8;
  border-radius: 8px;
  background: #ffffff;
}

.doc-identity > div,
.summary-card {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.85rem;
}

.net-amount,
.summary-card.strong strong {
  color: #047857;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.6rem;
}

.summary-card strong {
  font-size: 1rem;
}

.totals-board {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.totals-panel {
  border: 1px solid #d6dee8;
  border-radius: 8px;
  background: #ffffff;
  overflow: hidden;
}

.totals-panel header {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  border-bottom: 1px solid #d6dee8;
  background: #f8fafc;
  padding: 0.75rem 0.9rem;
}

.total-line {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: center;
  min-height: 34px;
  padding: 0.45rem 0.9rem;
}

.total-line + .total-line {
  border-top: 1px solid #eef2f7;
}

.total-line span {
  color: var(--p-text-color-secondary);
  font-size: 0.84rem;
}

.total-line b {
  color: var(--p-text-color);
  font-size: 0.9rem;
  text-align: right;
  white-space: nowrap;
}

.total-line.negative b {
  color: #0369a1;
}

.total-line.accent b {
  color: #0284c7;
}

.total-line.strong {
  background: #f0fdfa;
}

.total-line.strong span,
.total-line.strong b {
  color: #047857;
  font-size: 1rem;
  font-weight: 900;
}

.detail-tabs {
  display: flex;
  gap: 0.4rem;
  overflow-x: auto;
  border: 1px solid #d6dee8;
  border-radius: 8px;
  background: #ffffff;
  padding: 0.35rem;
}

.detail-tabs button {
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: #344054;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 38px;
  padding: 0 0.85rem;
  white-space: nowrap;
}

.detail-tabs button.active {
  border-color: #99f6e4;
  background: #f0fdfa;
  color: #0f766e;
  font-weight: 800;
}

.detail-tabs span {
  border-radius: 999px;
  background: rgba(15, 118, 110, 0.12);
  padding: 0.05rem 0.4rem;
  font-size: 0.75rem;
}

.detail-panel {
  padding: 0.75rem;
  overflow: hidden;
}

.detail-panel-embedded {
  padding: 0.7rem;
}

.loading-panel,
.empty-msg {
  display: flex;
  justify-content: center;
  padding: 1.5rem;
  color: var(--p-text-color-secondary);
}

.items-layout {
  display: grid;
  gap: 0.75rem;
}

.item-summary-strip {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.55rem;
}

.item-summary-strip article {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  display: grid;
  gap: 0.2rem;
  min-height: 58px;
  padding: 0.7rem 0.8rem;
}

.item-summary-strip article.strong {
  background: #ecfdf5;
  border-color: #bbf7d0;
}

.item-summary-strip span {
  color: var(--p-text-color-secondary);
  font-size: 0.75rem;
  font-weight: 800;
}

.item-summary-strip strong {
  color: var(--p-text-color);
  font-size: 0.96rem;
}

.item-summary-strip article.strong strong {
  color: #047857;
}

.item-type-badge {
  border-radius: 999px;
  background: #eef2ff;
  color: #3730a3;
  display: inline-flex;
  font-size: 0.72rem;
  font-weight: 900;
  line-height: 1;
  padding: 0.28rem 0.48rem;
  white-space: nowrap;
}

.item-type-badge.set {
  background: #ecfdf5;
  color: #047857;
}

.item-type-badge.child {
  background: #f1f5f9;
  color: #64748b;
}

.item-name-main {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.35rem;
}

.item-name-main strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-promotion-btn {
  display: inline-flex;
  width: 1.7rem;
  height: 1.7rem;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(239, 68, 68, 0.28);
  border-radius: 8px;
  background: #fff1f2;
  color: #e11d48;
  cursor: pointer;
}

.item-promotion-btn:hover,
.item-promotion-btn:focus-visible {
  border-color: rgba(239, 68, 68, 0.45);
  background: #ffe4e6;
  outline: none;
}

.item-subline {
  color: var(--p-text-color-secondary);
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 0.65rem;
  font-size: 0.76rem;
  margin-top: 0.18rem;
}

.item-child-name {
  padding-left: 1rem;
  color: var(--p-text-color-secondary);
}

.item-set-name strong {
  color: #047857;
}

.child-marker {
  margin-right: 0.35rem;
}

:deep(.set-child-row) {
  background: #f8fafc;
}

:deep(.set-child-row td) {
  color: #475569;
}

:deep(.set-parent-row) {
  background: #f0fdf4;
}

.payment-layout {
  display: grid;
  gap: 0.75rem;
}

.cash-summary {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 0.75rem;
}

.cash-summary > div {
  border-radius: 8px;
  background: #f8fafc;
  padding: 0.8rem;
}

.cash-summary span {
  display: block;
  color: var(--p-text-color-secondary);
  font-size: 0.78rem;
  font-weight: 700;
}

.cash-summary strong {
  display: block;
  margin-top: 0.25rem;
  font-size: 1.05rem;
}

.cash-summary > div.strong {
  background: #ecfdf5;
}

.cash-summary > div.strong strong {
  color: #047857;
}

.cash-summary > div.accent {
  background: #eff6ff;
}

.cash-summary > div.accent strong {
  color: #0284c7;
}

.payment-groups {
  display: grid;
  gap: 0.75rem;
}

.payment-group-card {
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  background: var(--p-content-background);
  overflow: hidden;
}

.payment-group-card header {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: center;
  border-bottom: 1px solid var(--p-content-border-color);
  background: #f8fafc;
  padding: 0.75rem 0.9rem;
}

.payment-group-card header > div:first-child {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
}

.payment-group-card header i {
  color: #0f766e;
}

.payment-group-card header span,
.payment-group-total small,
.payment-row-main span,
.payment-row-amounts small,
.payment-empty-line {
  color: var(--p-text-color-secondary);
  font-size: 0.78rem;
}

.payment-group-total {
  display: grid;
  gap: 0.15rem;
  justify-items: end;
  white-space: nowrap;
}

.payment-group-total b {
  color: #047857;
  font-size: 1rem;
}

.payment-group-card.negative .payment-group-total b {
  color: #0369a1;
}

.payment-row-list {
  display: grid;
}

.payment-row + .payment-row {
  border-top: 1px solid #eef2f7;
}

.payment-row {
  padding: 0.72rem 0.9rem;
}

.payment-row-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
}

.payment-row-main > div:first-child {
  display: grid;
  gap: 0.18rem;
  min-width: 0;
}

.payment-row-amounts {
  display: grid;
  gap: 0.15rem;
  justify-items: end;
  text-align: right;
  white-space: nowrap;
}

.payment-empty-line {
  padding: 0.75rem 0.9rem;
}

.payment-inspector {
  display: grid;
  gap: 0.75rem;
  max-height: calc(100vh - 1.5rem);
  overflow: auto;
  padding: 0.85rem;
  position: sticky;
  top: 0.75rem;
}

.payment-inspector-head {
  border-bottom: 1px solid #edf1f5;
  display: grid;
  gap: 0.35rem;
  padding-bottom: 0.75rem;
}

.payment-inspector-head > div {
  align-items: end;
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
}

.payment-inspector-head span,
.payment-inspector-head small {
  color: #667085;
  font-size: 0.78rem;
  font-weight: 700;
}

.payment-inspector-head strong {
  color: #172033;
  font-size: 1.2rem;
  text-align: right;
  white-space: nowrap;
}

.inspector-cash-summary {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.55rem;
}

.inspector-cash-summary > div {
  background: #f8fafc;
  border: 1px solid #edf1f5;
  min-height: 66px;
}

.inspector-payment-groups {
  gap: 0.65rem;
}

.payment-inspector .payment-group-card {
  border-color: #d6dee8;
}

.payment-inspector .payment-group-card header {
  align-items: flex-start;
  background: #f8fafc;
}

.payment-inspector .payment-group-card header > div:first-child {
  align-items: flex-start;
  flex-wrap: wrap;
}

.payment-inspector .payment-row-main {
  grid-template-columns: 1fr;
}

.payment-inspector .payment-row-amounts {
  justify-items: start;
  text-align: left;
}

.section-layout {
  display: grid;
  gap: 0.75rem;
}

.mini-summary-strip,
.gl-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.55rem;
}

.mini-summary-strip article,
.gl-summary article {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  display: grid;
  gap: 0.2rem;
  min-height: 58px;
  padding: 0.7rem 0.8rem;
}

.mini-summary-strip article.strong {
  background: #ecfdf5;
  border-color: #bbf7d0;
}

.gl-summary article.warn {
  background: #eff6ff;
  border-color: #bae6fd;
}

.mini-summary-strip span,
.gl-summary span {
  color: var(--p-text-color-secondary);
  font-size: 0.75rem;
  font-weight: 800;
}

.mini-summary-strip strong,
.gl-summary strong {
  font-size: 0.96rem;
}

.mini-summary-strip article.strong strong {
  color: #047857;
}

.gl-summary article.warn strong {
  color: #0369a1;
}

.info-grid.labeled {
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  background: var(--p-content-background);
  padding: 0 0.8rem;
}

.wht-card {
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  background: var(--p-content-background);
  overflow: hidden;
}

.wht-card header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border-bottom: 1px solid var(--p-content-border-color);
  background: #f8fafc;
  padding: 0.75rem 0.9rem;
}

.wht-card header > div {
  display: grid;
  gap: 0.18rem;
}

.wht-card header span,
.wht-meta {
  color: var(--p-text-color-secondary);
  font-size: 0.78rem;
}

.wht-card header b {
  color: #047857;
  white-space: nowrap;
}

.wht-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem 0.9rem;
  padding: 0.65rem 0.9rem;
}

.proof-section-full {
  display: grid;
  gap: 0.75rem;
}

.proof-head-full {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.proof-head-full > div {
  display: grid;
  gap: 0.15rem;
}

.proof-head-full span {
  color: var(--p-text-color-secondary);
  font-size: 0.82rem;
}

.proof-upload-btn {
  align-items: center;
  background: #10b981;
  border-radius: 8px;
  color: white;
  cursor: pointer;
  display: inline-flex;
  gap: 0.45rem;
  font-weight: 800;
  min-height: 38px;
  padding: 0 0.9rem;
}

.proof-upload-btn.disabled {
  cursor: wait;
  opacity: 0.68;
}

.proof-upload-btn input {
  display: none;
}

.proof-grid-full {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 0.75rem;
}

.proof-item-full {
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  background: var(--p-content-background);
  overflow: hidden;
  position: relative;
}

.proof-item-full a {
  display: block;
  aspect-ratio: 4 / 3;
}

.proof-item-full img {
  display: block;
  height: 100%;
  object-fit: cover;
  width: 100%;
}

.proof-item-full button {
  align-items: center;
  background: rgba(220, 38, 38, 0.95);
  border: 0;
  border-radius: 999px;
  color: white;
  cursor: pointer;
  display: inline-flex;
  height: 32px;
  justify-content: center;
  position: absolute;
  right: 0.5rem;
  top: 0.5rem;
  width: 32px;
}

.stack-list,
.info-grid {
  display: grid;
  gap: 0.75rem;
}

.info-card {
  display: grid;
  grid-template-columns: 1fr 2fr auto;
  gap: 0.75rem;
  padding: 0.85rem;
}

.info-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.info-grid > div {
  border-bottom: 1px solid var(--p-content-border-color);
  display: grid;
  gap: 0.25rem;
  padding: 0.7rem 0;
}

:deep(.col-num) {
  text-align: right;
}

@media (max-width: 1280px) {
  .document-workspace {
    grid-template-columns: 1fr;
  }

  .payment-inspector {
    max-height: none;
    position: static;
  }

  .inspector-cash-summary {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 1024px) {
  .doc-identity,
  .summary-grid,
  .totals-board,
  .item-summary-strip,
  .cash-summary,
  .mini-summary-strip,
  .gl-summary,
  .info-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .detail-header,
  .detail-title-block,
  .detail-actions {
    align-items: stretch;
  }

  .detail-header {
    flex-direction: column;
  }

  .detail-actions,
  .doc-identity,
  .summary-grid,
  .totals-board,
  .item-summary-strip,
  .cash-summary,
  .mini-summary-strip,
  .gl-summary,
  .info-grid {
    grid-template-columns: 1fr;
    width: 100%;
  }

  .payment-group-card header,
  .payment-row-main {
    align-items: stretch;
    grid-template-columns: 1fr;
  }

  .payment-group-card header {
    flex-direction: column;
  }

  .payment-group-total,
  .payment-row-amounts {
    justify-items: start;
    text-align: left;
  }

  .proof-head-full,
  .wht-card header {
    align-items: stretch;
    flex-direction: column;
  }

  .detail-actions {
    display: grid;
  }
}

/* Align read-only sale detail with the sell screen pattern. */
.sale-detail-page {
  --sale-page-bg: #eef5ff;
  --sale-card-bg: #ffffff;
  --sale-card-muted: #f7faff;
  --sale-border: #dbe4f3;
  --sale-border-strong: #c6d4ea;
  --sale-text: #102044;
  --sale-muted: #64748b;
  --sale-primary: #0284c7;
  --sale-primary-2: #2563eb;
  --sale-primary-soft: #eef4ff;
  --sale-primary-border: #c7d2fe;
  --sale-accent: #14b8a6;
  --sale-accent-soft: #ecfeff;
  --sale-success: #10b981;
  --sale-danger: #b42318;
  --sale-gradient: linear-gradient(135deg, #0f6fed 0%, #7c3aed 100%);
  --sale-shadow: 0 14px 35px rgba(30, 64, 175, 0.1);
  background: radial-gradient(circle at top left, rgba(37, 99, 235, 0.12), transparent 34rem), linear-gradient(180deg, #eef5ff 0%, #f8fbff 42%, #f3f6fb 100%);
  color: var(--sale-text);
  overflow-x: hidden;
}

.sale-detail-page .biz-page-header,
.sale-detail-page .workspace-tabs-card,
.sale-detail-page .biz-panel {
  background: var(--sale-card-bg);
  box-shadow: var(--sale-shadow);
}

.sale-detail-page .biz-page-title,
.sale-detail-page .panel-title strong {
  color: var(--sale-text);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.header-actions :deep(.p-button:not(.p-button-secondary)) {
  border-color: transparent;
  background: var(--sale-gradient);
  color: #ffffff;
  box-shadow: 0 12px 24px rgba(79, 70, 229, 0.24);
}

.header-meta-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.45rem;
}

.header-meta-pills span {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 0.3rem;
  padding: 0.18rem 0.5rem;
  border: 1px solid var(--sale-border);
  border-radius: 999px;
  background: var(--sale-card-muted);
  color: #475467;
  font-size: 0.74rem;
  font-weight: 700;
}

.header-meta-pills .header-chip {
  border-color: #c7d2fe;
  background: #eef2ff;
  color: #3730a3;
}

.header-meta-pills .readonly-pill {
  border-color: #bfdbfe;
  background: #eff6ff;
  color: #1d4ed8;
}

.sell-grid {
  display: grid;
  width: 100%;
  grid-template-columns: minmax(0, 1fr) 350px;
  gap: 0.6rem;
  align-items: start;
}

.sale-detail-page .document-workspace {
  display: flex;
  min-width: 0;
  width: 100%;
  max-width: none;
  flex-direction: column;
  align-items: stretch;
  gap: 0.475rem;
}

.sale-detail-page .workspace-tabs-card,
.sale-detail-page .document-panel,
.sale-detail-page .lines-panel,
.sale-detail-page .additional-panel,
.sale-detail-page .doc-footer-panel {
  width: 100%;
  max-width: none;
}

.workspace-tabs-card {
  display: grid;
  gap: 0.75rem;
  border: 1px solid var(--sale-border);
  padding: 0.4rem;
}

.workspace-tabs {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 0.5rem;
}

.workspace-tabs button {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  border: 1px solid var(--sale-border);
  border-radius: 10px;
  background: #ffffff;
  color: #344054;
  cursor: pointer;
  font: inherit;
  font-weight: 800;
  padding: 0.65rem 0.75rem;
}

.workspace-tabs button.active {
  border-color: #c4b5fd;
  background: linear-gradient(135deg, #eef2ff 0%, #ede9fe 100%);
  color: var(--sale-primary);
  transform: translateY(-1px);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.72);
}

.workspace-tabs button span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-tabs button b {
  min-width: 1.45rem;
  max-width: 6.5rem;
  overflow: hidden;
  padding: 0.04rem 0.38rem;
  border-radius: 999px;
  background: var(--sale-gradient);
  color: #fff;
  font-size: 0.72rem;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sale-detail-page .biz-panel {
  border: 1px solid var(--sale-border);
  border-radius: 10px;
  background: var(--sale-card-bg);
}

.document-panel {
  border-top: 4px solid var(--sale-primary) !important;
  padding: 0.85rem;
}

.product-panel,
.lines-panel {
  border-top: 4px solid #6366f1 !important;
  padding: 0.85rem;
}

.additional-panel,
.doc-footer-panel {
  border-top: 4px solid var(--sale-primary-2) !important;
  padding: 0.85rem;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-bottom: 0.7rem;
}

.panel-title.compact {
  margin-bottom: 0.45rem;
}

.panel-title i {
  color: var(--sale-primary);
}

.panel-count {
  margin-left: auto;
  color: var(--sale-muted);
  font-size: 0.82rem;
  font-weight: 800;
}

.readonly-note {
  margin-left: auto;
  border-radius: 999px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 0.76rem;
  font-weight: 900;
  padding: 0.2rem 0.55rem;
}

.readonly-product-row {
  display: grid;
  grid-template-columns: minmax(14rem, 1fr) minmax(16rem, 1fr) auto;
  gap: 0.5rem;
  align-items: center;
}

.readonly-search-box,
.readonly-barcode-box {
  min-height: 42px;
  display: flex;
  align-items: center;
  border: 1px solid var(--sale-border);
  border-radius: 8px;
  background: #f8fafc;
  color: #94a3b8;
  font-weight: 700;
  padding: 0 0.75rem;
}

.readonly-product-row button {
  min-height: 42px;
  border: 0;
  border-radius: 8px;
  background: #e2e8f0;
  color: #64748b;
  cursor: not-allowed;
  font: inherit;
  font-weight: 900;
  padding: 0 0.9rem;
}

.doc-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
}

.field {
  display: grid;
  gap: 0.3rem;
  min-width: 0;
}

.field > span,
.summary-card span,
.info-grid span {
  color: var(--sale-muted);
  font-size: 0.78rem;
  font-weight: 700;
}

.readonly-field strong {
  min-height: 42px;
  display: flex;
  align-items: center;
  border: 1px solid var(--sale-border);
  border-radius: 8px;
  background: #ffffff;
  color: var(--sale-text);
  font-size: 0.9rem;
  padding: 0.55rem 0.65rem;
  word-break: break-word;
}

.wide-field {
  grid-column: span 2;
}

.doc-footer-grid {
  display: grid;
  grid-template-columns: 1fr 1.2fr;
  gap: 0.75rem;
}

.doc-footer-left,
.doc-footer-right {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.75rem;
}

.doc-footer-block {
  border: 1px solid var(--sale-border);
  border-radius: 10px;
  padding: 0.6rem;
  background: var(--sale-card-bg);
}

.doc-footer-inline-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.55rem;
}

.summary-list {
  display: grid;
  gap: 0.55rem;
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--sale-border);
}

.summary-list:first-of-type {
  margin-top: 0.65rem;
}

.summary-list-header {
  color: var(--sale-text);
  font-size: 0.8rem;
  font-weight: 900;
}

.summary-list > div:not(.summary-list-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-height: 1.55rem;
}

.summary-list span {
  color: var(--sale-muted);
  font-size: 0.86rem;
  font-weight: 700;
}

.summary-list strong {
  color: var(--sale-text);
  font-size: 0.9rem;
  font-weight: 900;
  white-space: nowrap;
}

.summary-list strong.discount {
  color: var(--sale-danger);
}

.summary-list .net {
  padding-top: 0.55rem;
  border-top: 1px solid var(--sale-border);
}

.summary-list .net strong {
  color: var(--sale-primary);
  font-size: 1.1rem;
}

.promotion-panel {
  display: grid;
  gap: 0.625rem;
  margin-top: 0.875rem;
  padding: 0.75rem;
  border: 1px solid var(--sale-border);
  border-radius: 8px;
  background: #f8fafc;
}

.readonly-audit-panel {
  margin-top: 0.875rem;
}

.promotion-panel-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: start;
}

.promotion-panel-head > div {
  display: grid;
  gap: 0.125rem;
}

.promotion-panel-head span,
.promotion-panel-head small,
.promotion-related > span,
.promotion-related-empty,
.promotion-audit-meta {
  color: var(--sale-muted);
  font-size: 0.74rem;
}

.promotion-panel-head strong {
  font-size: 0.95rem;
}

.promotion-panel.status-success {
  border-color: rgba(34, 197, 94, 0.35);
}

.promotion-collapse-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.5rem;
  align-items: center;
  padding: 0.55rem 0.65rem;
  border: 1px solid var(--sale-border);
  border-radius: 8px;
  background: #ffffff;
}

.promotion-collapse-row > div {
  display: grid;
  min-width: 0;
  gap: 0.15rem;
}

.promotion-collapse-row span {
  color: var(--sale-muted);
  font-size: 0.74rem;
  font-weight: 700;
}

.promotion-collapse-row strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.promotion-audit-list {
  display: grid;
  gap: 0.625rem;
}

.promotion-audit-card {
  display: grid;
  gap: 0.5rem;
  padding: 0.625rem;
  border: 1px solid var(--sale-border);
  border-radius: 8px;
  background: #ffffff;
}

.promotion-audit-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: start;
}

.promotion-audit-main > div {
  display: grid;
  min-width: 0;
  gap: 0.125rem;
}

.promotion-code {
  width: fit-content;
  padding: 0.08rem 0.35rem;
  border: 1px solid var(--sale-border);
  border-radius: 6px;
  color: var(--sale-muted);
  font-size: 0.72rem;
}

.promotion-audit-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.promotion-related {
  display: grid;
  gap: 0.25rem;
}

.promotion-related-list {
  display: grid;
  gap: 0.2rem;
}

.promotion-related-list small {
  color: var(--sale-text);
}

.discount {
  color: var(--sale-danger);
}

.sale-detail-page .payment-card {
  width: 100%;
  min-width: 0;
  position: sticky;
  top: 0.75rem;
  max-height: calc(100vh - 1.5rem);
  overflow: auto;
  border: 1px solid transparent;
  background:
    linear-gradient(#ffffff, #ffffff) padding-box,
    var(--sale-gradient) border-box;
  box-shadow: 0 18px 45px rgba(79, 70, 229, 0.18);
}

.sell-status-bar {
  position: sticky;
  z-index: 12;
  bottom: 0;
  display: grid;
  grid-template-columns: minmax(7rem, 0.7fr) minmax(9rem, 0.9fr) minmax(9rem, 0.9fr) minmax(18rem, 3fr) minmax(14rem, 1.35fr);
  gap: 0.5rem;
  align-items: center;
  margin-top: 0.35rem;
  padding: 0.45rem;
  border: 1px solid var(--sale-border-strong);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.97);
  box-shadow: 0 -10px 28px rgba(15, 23, 42, 0.12);
  backdrop-filter: blur(10px);
}

.status-metric,
.status-state {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid var(--sale-border);
  border-radius: 8px;
  background: var(--sale-card-bg);
  color: var(--sale-text);
  padding: 0.4rem 0.55rem;
}

.status-metric {
  justify-content: space-between;
}

.status-metric span,
.status-state {
  color: var(--sale-muted);
  font-size: 0.78rem;
  font-weight: 800;
}

.status-metric strong,
.status-state strong {
  color: var(--sale-text);
  font-size: 0.9rem;
  font-weight: 900;
}

.status-metric.net {
  background: var(--sale-primary-soft);
  border-color: var(--sale-primary-border);
}

.status-metric.net strong {
  color: var(--sale-primary);
}

.status-state {
  justify-content: center;
  background: #ecfeff;
  border-color: #99f6e4;
}

.status-state i,
.status-state strong {
  color: var(--sale-accent);
}

.status-save-btn {
  width: 100%;
}

.payment-card::before {
  content: "";
  position: absolute;
  z-index: 0;
  inset: 0 0 auto;
  height: 11.25rem;
  background: radial-gradient(circle at 18% 18%, rgba(255, 255, 255, 0.24), transparent 12rem), var(--sale-gradient);
}

.payment-card > * {
  position: relative;
  z-index: 1;
}

.payment-card .panel-title strong,
.payment-card .panel-title i {
  color: #ffffff;
}

.payment-inspector {
  padding: 0.85rem;
}

.payment-inspector-head {
  border-bottom: 1px solid rgba(255, 255, 255, 0.28);
  margin: 0 -0.85rem 0.75rem;
  padding: 0.15rem 0.85rem 0.85rem;
}

.payment-inspector-head span,
.payment-inspector-head small {
  color: rgba(255, 255, 255, 0.82);
}

.payment-inspector-head strong {
  color: #ffffff;
}

.sale-detail-page .payment-summary strong,
.sale-detail-page .payment-row b,
.payment-group-total b,
.net-amount,
.summary-card.strong strong {
  color: var(--sale-accent);
}

@media (max-width: 1180px) {
  .sell-grid,
  .doc-footer-grid {
    grid-template-columns: 1fr;
  }

  .sale-detail-page .payment-card {
    position: static;
    max-height: none;
  }

  .sell-status-bar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .status-save-btn {
    grid-column: span 2;
  }
}

@media (max-width: 900px) {
  .workspace-tabs,
  .doc-grid,
  .readonly-product-row,
  .doc-footer-inline-grid,
  .summary-grid,
  .totals-board,
  .item-summary-strip,
  .mini-summary-strip,
  .gl-summary,
  .info-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .header-actions,
  .sell-status-bar,
  .workspace-tabs,
  .doc-grid,
  .readonly-product-row,
  .doc-footer-inline-grid,
  .summary-grid,
  .totals-board,
  .item-summary-strip,
  .mini-summary-strip,
  .gl-summary,
  .info-grid {
    grid-template-columns: 1fr;
  }

  .header-actions {
    display: grid;
    width: 100%;
  }

  .status-save-btn {
    grid-column: auto;
  }

  .wide-field {
    grid-column: auto;
  }
}
</style>
