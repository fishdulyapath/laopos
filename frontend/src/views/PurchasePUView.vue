<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import Dialog from 'primevue/dialog'
import InputNumber from 'primevue/inputnumber'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'
import Select from 'primevue/select'
import { useToast } from 'primevue/usetoast'
import IsoDatePicker from '@/components/common/IsoDatePicker.vue'
import PurchaseProductBasketDialog from '@/components/purchase/PurchaseProductBasketDialog.vue'
import {
  createPUDoc,
  getBarcodeItem,
  getBarcodeItemSearch,
  getDocPoDetail,
  getPODocWait,
  getPassBookList,
  getVatRate,
  getNextPurchaseDocNo,
  getPUDocDetail,
  getPUDocList,
  getPurchaseDocFormatList,
  getPurchasePrintForms,
  getPurchasePrintUrl,
  getSupplierDetail,
  getSupplierList,
  updatePUDoc,
} from '@/services/purchaseService'
import { getShelfList, getWarehouseList } from '@/services/inventoryService'
import { useAuthStore } from '@/stores/auth'
import { calcDiscountAmount as calcSmlDiscountAmount } from '@/utils/discount'
import { formatCurrency, formatDate, formatNumber, todayISO } from '@/utils/formatters'
import { PERMISSIONS } from '@/utils/permissions'

const authStore = useAuthStore()
const route = useRoute()
const router = useRouter()
const toast = useToast()

const rows = ref([])
const loading = ref(false)
const errorMsg = ref('')
const searchText = ref('')
const fromDate = ref(todayISO().slice(0, 8) + '01')
const toDate = ref(todayISO())

const docFormats = ref([])
const docFormatCode = ref('')
const nextDocNo = ref(null)
const docFormatLoading = ref(false)
const nextDocLoading = ref(false)

const detailVisible = ref(false)
const detailLoading = ref(false)
const selectedDoc = ref(null)
const printForms = ref([])
const printFormsLoading = ref(false)
const printError = ref('')
const printDialogVisible = ref(false)
const printDocNo = ref('')
const selectedPrintForms = ref([])
const purchaseTaxDetailVisible = ref(false)

const editorVisible = ref(false)
const editorMode = ref('create')
const editorStep = ref('document')
const editorSaving = ref(false)
const editorError = ref('')
const editorResult = ref('')
const draft = ref(emptyDraft())
const supplierDialogVisible = ref(false)
const supplierSearch = ref('')
const supplierOptions = ref([])
const supplierLoading = ref(false)
const poSearch = ref('')
const poWaitRows = ref([])
const poWaitLoading = ref(false)
const refDocDialogVisible = ref(false)
const refDocSelectedNos = ref([])
const refDocError = ref('')
const productSearch = ref('')
const productResults = ref([])
const productDialogVisible = ref(false)
const productBasketVisible = ref(false)
const productLoading = ref(false)
const barcodeInput = ref('')
const paymentEntries = ref([])
const activePayType = ref('cash')
const cashInputAmount = ref(0)
const roundedAmount = ref(0)
const passBooks = ref([])
const passBooksLoading = ref(false)
const transferDate = ref(todayISO())
const transferPassBook = ref(null)
const transferInputAmount = ref(0)
const allPoItems = ref([])
const scannedGroups = ref([])
let scanLineIdSeed = 0
const warehouseOptions = ref([])
const shelfOptions = ref([])
const shelfCache = ref({})
const shelfLoading = ref(false)

function showEditorToast(severity, summary, detail, life = 5200) {
  const text = String(detail || '').trim()
  if (!text) return
  toast.add({ severity, summary, detail: text, life })
}

function setEditorError(message) {
  editorError.value = message
  showEditorToast('warn', 'แจ้งเตือน', message, 6500)
}

function setEditorResult(message) {
  editorResult.value = message
  showEditorToast('success', 'สำเร็จ', message, 4200)
}

function clearEditorError() {
  editorError.value = ''
}

function clearEditorResult() {
  editorResult.value = ''
}

function clearEditorFeedback() {
  clearEditorError()
  clearEditorResult()
}

const canCreate = computed(() => authStore.hasAllPermissions([PERMISSIONS.purchasePuView, PERMISSIONS.purchasePuCreate]))
const canEdit = computed(() => authStore.hasAllPermissions([PERMISSIONS.purchasePuView, PERMISSIONS.purchasePuEdit]))
const canPrint = computed(() => authStore.hasAllPermissions([PERMISSIONS.purchasePuView, PERMISSIONS.purchasePuPrint]))
const isCreateRoute = computed(() => route.name === 'PurchasePUCreate')
const isEditRoute = computed(() => route.name === 'PurchasePUEdit')
const isEditorRoute = computed(() => isCreateRoute.value || isEditRoute.value)
const isCashSale = computed(() => [1, 3].includes(toNumber(draft.value.sale_type)))

const saleTypeOptions = [
  { label: 'เงินเชื่อ', value: 0 },
  { label: 'เงินสด', value: 1 },
  { label: 'สินค้าบริการ (เงินเชื่อ)', value: 2 },
  { label: 'สินค้าบริการเงินสด', value: 3 },
]

const taxTypeOptions = [
  { label: 'ภาษีแยกนอก', value: 0 },
  { label: 'ภาษีรวมใน', value: 1 },
  { label: 'ภาษีอัตราศูนย์', value: 2 },
  { label: 'ไม่กระทบภาษี', value: 3 },
]

const denoms = [20, 50, 100, 500, 1000]

const docFormatOptions = computed(() =>
  docFormats.value.map((format) => ({
    ...format,
    label: `${format.code} - ${format.name_1 || ''}`,
  })),
)

const detailItems = computed(() => selectedDoc.value?.items || [])
const detailPoRefs = computed(() => {
  const refs = new Map()
  for (const row of selectedDoc.value?.po_refs || []) {
    const docNo = String(row?.doc_no || '').trim()
    if (docNo) refs.set(docNo, { doc_no: docNo, doc_date: toDateInput(row?.doc_date) })
  }
  for (const docNo of String(selectedDoc.value?.po_doc_list || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)) {
    if (!refs.has(docNo)) refs.set(docNo, { doc_no: docNo, doc_date: '' })
  }
  for (const item of detailItems.value) {
    const docNo = String(item?.ref_doc_no || '').trim()
    if (!docNo || refs.has(docNo)) continue
    refs.set(docNo, { doc_no: docNo, doc_date: toDateInput(item?.ref_doc_date) })
  }
  return Array.from(refs.values())
})
const draftPoRefText = computed(() => draft.value.po_refs.map((row) => row.doc_no).join(', '))
const displayGroups = computed(() => {
  const rowMap = new Map()
  for (const group of scannedGroups.value) {
    const key = `${group.po_doc_no || ''}::${group.item_code}::${group.unit_code}::${group.scanLines?.[0]?.barcode || group.po_barcode || ''}`
    const existing = rowMap.get(key)
    if (existing) {
      existing.po_qty += toNumber(group.po_qty)
      existing.scanLines.push(...(group.scanLines || []))
    } else {
      rowMap.set(key, {
        ...group,
        po_qty: toNumber(group.po_qty),
        scanLines: [...(group.scanLines || [])],
      })
    }
  }
  return Array.from(rowMap.values())
})
function scanLineEntries() {
  return displayGroups.value.flatMap((group) =>
    (group.scanLines || []).map((line) => ({ group, line }))
  )
}

const allScanLines = computed(() => scanLineEntries())

const canSaveDraft = computed(() => !editorSaving.value)
const saveButtonLabel = computed(() => editorSaving.value ? 'กำลังบันทึก' : 'บันทึกเอกสาร')

function rnd(value, point = 2) {
  const factor = 10 ** point
  return Math.round(toNumber(value) * factor) / factor
}

function toNumber(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function toDateInput(value) {
  if (!value) return ''
  const text = String(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function optionLabel(row) {
  if (!row) return ''
  const name = row.name || row.name_1 || ''
  return name ? `${row.code}~${name}` : row.code
}

function valueLabel(options, value) {
  return options.find((option) => Number(option.value) === Number(value))?.label || '-'
}

function saleTypeLabel(value) {
  return valueLabel(saleTypeOptions, value)
}

function taxTypeLabel(value) {
  return valueLabel(taxTypeOptions, value)
}

function taxTypeShortLabel(value) {
  const type = Number(value)
  if (type === 0) return 'แยกนอก'
  if (type === 1) return 'รวมใน'
  if (type === 2) return 'อัตราศูนย์'
  if (type === 3) return 'ไม่กระทบ'
  return '-'
}

function formatVatRate(value) {
  const rate = toNumber(value, 7)
  return Number.isInteger(rate) ? String(rate) : formatNumber(rate)
}

function vatSummaryLabel(value, rate) {
  const taxType = Number(value)
  if (taxType === 2) return 'ภาษีมูลค่าเพิ่ม 0% (อัตราศูนย์)'
  if (taxType === 3) return 'ภาษีมูลค่าเพิ่ม (ไม่กระทบ)'
  return `ภาษีมูลค่าเพิ่ม ${formatVatRate(rate)}% (${taxTypeShortLabel(value)})`
}

const warehouseSelectOptions = computed(() =>
  warehouseOptions.value.map((row) => ({ ...row, label: optionLabel(row) })),
)

const shelfSelectOptions = computed(() =>
  shelfOptions.value.map((row) => ({ ...row, label: optionLabel(row) })),
)

const suggestedRoundAmount = computed(() => {
  const amount = draftTotals.value.total_amount
  if (!amount) return 0
  const decimal = amount - Math.floor(amount)
  if (!decimal) return 0
  return decimal <= 0.5 ? rnd(Math.floor(amount) - amount) : rnd(Math.ceil(amount) - amount)
})

const totalAfterRounded = computed(() => rnd(draftTotals.value.total_amount + roundedAmount.value))
const totalPaid = computed(() => rnd(paymentEntries.value.reduce((sum, entry) => sum + toNumber(entry.amount), 0)))
const remainingPayment = computed(() => Math.max(0, rnd(totalAfterRounded.value - totalPaid.value)))
const paymentChange = computed(() => Math.max(0, rnd(totalPaid.value - totalAfterRounded.value)))
const editorActionLabel = computed(() => {
  if (editorSaving.value) return 'กำลังบันทึก'
  if (isCashSale.value && editorStep.value === 'document') return 'ถัดไป: รับชำระเงิน'
  return 'บันทึกเอกสาร'
})

function withOptionLabels(rows = []) {
  return rows.map((row) => ({ ...row, label: optionLabel(row) }))
}

async function loadWarehouses() {
  try {
    warehouseOptions.value = await getWarehouseList()
  } catch {
    warehouseOptions.value = []
  }
}

async function loadShelves(whCode, assignHeader = false) {
  if (!whCode) {
    if (assignHeader) shelfOptions.value = []
    return []
  }
  if (shelfCache.value[whCode]) {
    if (assignHeader) shelfOptions.value = shelfCache.value[whCode]
    return shelfCache.value[whCode]
  }
  if (assignHeader) shelfLoading.value = true
  try {
    const list = await getShelfList(whCode)
    shelfCache.value[whCode] = list
    if (assignHeader) shelfOptions.value = list
    return list
  } catch {
    if (assignHeader) shelfOptions.value = []
    return []
  } finally {
    if (assignHeader) shelfLoading.value = false
  }
}

async function onHeaderWarehouseChange() {
  draft.value.location_from = ''
  await loadShelves(draft.value.wh_from, true)
}

async function loadPassBooks() {
  passBooksLoading.value = true
  try {
    passBooks.value = await getPassBookList()
  } catch {
    passBooks.value = []
  } finally {
    passBooksLoading.value = false
  }
}

function addDenom(value) {
  cashInputAmount.value = rnd(toNumber(cashInputAmount.value) + value)
}

function addExactCash() {
  cashInputAmount.value = remainingPayment.value
}

function addCashPayment() {
  const amount = toNumber(cashInputAmount.value)
  if (amount <= 0) return
  paymentEntries.value.push({
    id: `${Date.now()}-${paymentEntries.value.length}`,
    type: 'cash',
    label: 'เงินสด',
    amount,
    details: {},
  })
  cashInputAmount.value = 0
}

function addTransferPayment() {
  const amount = toNumber(transferInputAmount.value)
  const book = transferPassBook.value
  if (!book || amount <= 0) return
  paymentEntries.value.push({
    id: `${Date.now()}-${paymentEntries.value.length}`,
    type: 'transfer',
    label: `${book.book_name || book.name_1 || book.code} (${book.bank_name || book.bank_code || '-'})`,
    amount,
    details: {
      pass_book_code: book.code,
      bank_code: book.bank_code || '',
      bank_branch: book.bank_branch || '',
      transfer_date: transferDate.value || draft.value.doc_date,
    },
  })
  transferInputAmount.value = 0
  transferPassBook.value = null
}

function removePaymentEntry(id) {
  paymentEntries.value = paymentEntries.value.filter((entry) => entry.id !== id)
}

function fillSuggestedRounding() {
  roundedAmount.value = suggestedRoundAmount.value
}

function fillCashRemaining() {
  cashInputAmount.value = remainingPayment.value > 0 ? remainingPayment.value : totalAfterRounded.value
}

async function goPaymentStep() {
  const localErrors = validateDraftLocally({ includePayment: false })
  if (localErrors.length) {
    setEditorError(localErrors.join(' / '))
    return
  }
  if (!passBooks.value.length) await loadPassBooks()
  clearEditorError()
  editorStep.value = 'payment'
}

function handleEditorAction() {
  if (isCashSale.value && editorStep.value === 'document') {
    goPaymentStep()
    return
  }
  saveDraft()
}

function currentTime() {
  return new Date().toTimeString().slice(0, 5)
}

function emptyItem() {
  return {
    ref_doc_no: '',
    ref_doc_date: '',
    item_code: '',
    item_name: '',
    unit_code: '',
    qty: 1,
    price: 0,
    discount_amount: 0,
    sum_amount: 0,
    wh_code: '',
    shelf_code: '',
    barcode: '',
    stand_value: 1,
    divide_value: 1,
    ratio: 1,
    tax_type: 0,
    po_qty: 0,
    balance_qty: 0,
  }
}

function emptyDraft() {
  return {
    doc_no: '',
    doc_date: todayISO(),
    doc_time: currentTime(),
    doc_format_code: '',
    cust_code: '',
    cust_name: '',
    branch_code: '',
    ap_tax_id: '',
    sale_type: 0,
    tax_type: 1,
    vat_rate: 7,
    tax_doc_no: '',
    tax_doc_date: todayISO(),
    doc_ref: '',
    doc_ref_date: '',
    wh_from: '',
    location_from: '',
    remark: '',
    po_refs: [],
    items: [emptyItem()],
  }
}

function docFormatLabel(row) {
  if (!row?.doc_format_code) return '-'
  return row.doc_format_name ? `${row.doc_format_code} · ${row.doc_format_name}` : row.doc_format_code
}

function preferredPUDocFormatCode() {
  return docFormats.value.find((format) => format.code === 'PU')?.code || docFormats.value[0]?.code || ''
}

async function loadDocFormats() {
  docFormatLoading.value = true
  try {
    docFormats.value = await getPurchaseDocFormatList()
    docFormatCode.value = preferredPUDocFormatCode()
    await loadNextDocNo()
  } catch (err) {
    docFormats.value = []
    errorMsg.value = err.message || 'โหลดรหัสเอกสาร PU ไม่สำเร็จ'
  } finally {
    docFormatLoading.value = false
  }
}

async function ensureEditorDefaults() {
  if (!docFormats.value.length) {
    await loadDocFormats()
  }
  try {
    draft.value.vat_rate = toNumber(await getVatRate(), 7)
  } catch {
    draft.value.vat_rate = 7
  }
}

async function loadNextDocNo() {
  const isCreateContext = editorMode.value === 'create' && (editorVisible.value || isCreateRoute.value)
  const formatCode = isCreateContext
    ? draft.value.doc_format_code
    : docFormatCode.value
  const docDate = isCreateContext
    ? draft.value.doc_date
    : todayISO()
  const previousDraftDocNo = draft.value.doc_no
  if (!formatCode) {
    nextDocNo.value = null
    if (isCreateContext) {
      draft.value.doc_no = ''
      if (!draft.value.tax_doc_no || draft.value.tax_doc_no === previousDraftDocNo) {
        draft.value.tax_doc_no = ''
      }
    }
    return
  }
  nextDocLoading.value = true
  try {
    nextDocNo.value = await getNextPurchaseDocNo({
      doc_format_code: formatCode,
      doc_date: docDate || todayISO(),
    })
    if (isCreateContext) {
      const resolvedDocNo = String(nextDocNo.value?.doc_no || '').trim()
      draft.value.doc_no = resolvedDocNo
      if (resolvedDocNo && (!draft.value.tax_doc_no || draft.value.tax_doc_no === previousDraftDocNo)) {
        draft.value.tax_doc_no = resolvedDocNo
      }
      if (!draft.value.tax_doc_date) draft.value.tax_doc_date = draft.value.doc_date
    }
  } catch (err) {
    nextDocNo.value = null
    errorMsg.value = err.message || 'โหลดเลขที่เอกสารถัดไปไม่สำเร็จ'
  } finally {
    nextDocLoading.value = false
  }
}

async function loadDocs() {
  loading.value = true
  errorMsg.value = ''
  try {
    rows.value = await getPUDocList({
      search: searchText.value.trim(),
      fromdate: fromDate.value,
      todate: toDate.value,
    })
  } catch (err) {
    errorMsg.value = err.message || 'โหลดรายการ PU ไม่สำเร็จ'
    rows.value = []
  } finally {
    loading.value = false
  }
}

async function openDetail(row) {
  selectedDoc.value = row
  printDocNo.value = row?.doc_no || ''
  purchaseTaxDetailVisible.value = false
  detailVisible.value = true
  detailLoading.value = true
  printForms.value = []
  printError.value = ''
  try {
    selectedDoc.value = await getPUDocDetail(row.doc_no)
  } catch (err) {
    printError.value = err.message || 'โหลดรายละเอียดไม่สำเร็จ'
  } finally {
    detailLoading.value = false
  }
}

function mapDetailToDraft(doc) {
  return {
    doc_no: doc.doc_no || '',
    doc_date: toDateInput(doc.doc_date) || todayISO(),
    doc_time: doc.doc_time || currentTime(),
    doc_format_code: doc.doc_format_code || '',
    cust_code: doc.cust_code || '',
    cust_name: doc.cust_name || '',
    branch_code: doc.branch_code || '',
    ap_tax_id: doc.ap_tax_id || '',
    sale_type: doc.sale_type ?? doc.inquiry_type ?? 0,
    tax_type: doc.tax_type ?? doc.vat_type ?? 1,
    vat_rate: doc.vat_rate ?? 7,
    tax_doc_no: doc.tax_doc_no || '',
    tax_doc_date: toDateInput(doc.tax_doc_date || doc.doc_date) || todayISO(),
    doc_ref: doc.doc_ref || '',
    doc_ref_date: toDateInput(doc.doc_ref_date),
    wh_from: doc.wh_from || '',
    location_from: doc.location_from || '',
    remark: doc.remark || '',
    po_refs: detailPoRefs.value,
    items: (doc.items || []).map((item) => ({
      ref_doc_no: item.ref_doc_no || '',
      ref_doc_date: toDateInput(item.ref_doc_date),
      item_code: item.item_code || '',
      item_name: item.item_name || '',
      unit_code: item.unit_code || '',
      qty: toNumber(item.qty),
      price: toNumber(item.price),
      discount_amount: toNumber(item.discount_amount),
      sum_amount: toNumber(item.sum_amount),
      wh_code: item.wh_code || '',
      shelf_code: item.shelf_code || '',
      barcode: item.barcode || '',
      stand_value: toNumber(item.stand_value, 1),
      divide_value: toNumber(item.divide_value, 1),
      ratio: toNumber(item.ratio, 1),
      tax_type: item.tax_type ?? 0,
      po_qty: toNumber(item.po_qty),
      balance_qty: toNumber(item.balance_qty),
    })),
  }
}

function resetEditorRuntime() {
  editorStep.value = 'document'
  clearEditorFeedback()
  purchaseTaxDetailVisible.value = false
  supplierOptions.value = []
  supplierDialogVisible.value = false
  poSearch.value = ''
  poWaitRows.value = []
  refDocSelectedNos.value = []
  refDocError.value = ''
  refDocDialogVisible.value = false
  allPoItems.value = []
  scannedGroups.value = []
  productSearch.value = ''
  productResults.value = []
  productDialogVisible.value = false
  productBasketVisible.value = false
  barcodeInput.value = ''
  paymentEntries.value = []
  activePayType.value = 'cash'
  cashInputAmount.value = 0
  roundedAmount.value = 0
  transferDate.value = todayISO()
  transferPassBook.value = null
  transferInputAmount.value = 0
}

function poLineKey(item) {
  return [
    item.doc_no || '',
    item.line_number || '',
    item.item_code || '',
    item.unit_code || '',
    item.barcode || '',
    item.price ?? '',
    item.wh_code || '',
    item.shelf_code || '',
    item.tax_type ?? 0,
    item.stand_value ?? 1,
    item.divide_value ?? 1,
  ].join('::')
}

function currentQtyForPoItem(items, poDocNo, poItem) {
  const strictQty = items
    .filter((item) =>
      item.ref_doc_no === poDocNo
        && item.item_code === poItem.item_code
        && item.unit_code === poItem.unit_code
        && toNumber(item.price) === toNumber(poItem.price)
        && String(item.barcode || '') === String(poItem.barcode || ''),
    )
    .reduce((sum, item) => sum + toNumber(item.qty), 0)
  if (strictQty > 0) return strictQty
  return items
    .filter((item) =>
      item.ref_doc_no === poDocNo
        && item.item_code === poItem.item_code
        && item.unit_code === poItem.unit_code,
    )
    .reduce((sum, item) => sum + toNumber(item.qty), 0)
}

async function addExistingPOContext(poRef, currentItems) {
  const docNo = String(poRef?.doc_no || '').trim()
  if (!docNo) return
  const po = await getDocPoDetail(docNo)
  addDraftPORef(po)
  const poDate = toDateInput(po.doc_date || poRef.doc_date)
  for (const [index, item] of (po.items || []).entries()) {
    const mapped = {
      doc_no: po.doc_no,
      doc_date: poDate,
      ref_doc_date: poDate,
      line_number: toNumber(item.line_number, index + 1),
      item_code: item.item_code || '',
      item_name: item.item_name || '',
      unit_code: item.unit_code || '',
      price: toNumber(item.price),
      wh_code: item.wh_code || po.wh_from || '',
      shelf_code: item.shelf_code || po.location_from || '',
      barcode: item.barcode || '',
      stand_value: toNumber(item.stand_value, 1),
      divide_value: toNumber(item.divide_value, 1),
      ratio: toNumber(item.ratio, 1),
      tax_type: item.tax_type ?? 0,
      po_qty: toNumber(item.po_qty),
      balance_qty: toNumber(item.balance_qty) + currentQtyForPoItem(currentItems, docNo, item),
    }
    if (!mapped.item_code || mapped.balance_qty <= 0) continue
    mapped.po_line_key = poLineKey(mapped)
    allPoItems.value.push(mapped)
  }
}

async function addExistingDetailLine(item) {
  const poItem = item.ref_doc_no
    ? allPoItems.value.find((row) =>
      row.doc_no === item.ref_doc_no
        && row.item_code === item.item_code
        && row.unit_code === item.unit_code
        && (String(row.barcode || '') === String(item.barcode || '') || !row.barcode || !item.barcode),
    )
    : null
  const group = ensureScanGroup(productToDraftItem(item), poItem)
  const lineWh = item.wh_code || draft.value.wh_from || poItem?.wh_code || ''
  const lineShelf = item.shelf_code || draft.value.location_from || poItem?.shelf_code || ''
  const shelfList = lineWh ? await loadShelves(lineWh) : []
  group.scanLines.push({
    _line_id: `scan-${++scanLineIdSeed}`,
    barcode: item.barcode || poItem?.barcode || '',
    qty: toNumber(item.qty),
    price: toNumber(item.price),
    discount: item.discount || '',
    discount_amount: toNumber(item.discount_amount),
    stand_value: toNumber(item.stand_value, 1),
    divide_value: toNumber(item.divide_value, 1),
    ratio: toNumber(item.ratio, 1),
    tax_type: item.tax_type ?? 0,
    wh_code: lineWh,
    shelf_code: lineShelf,
    _shelfList: withOptionLabels(shelfList),
  })
}

async function loadDetailIntoEditor(doc, successMessage = '') {
  editorMode.value = 'update'
  resetEditorRuntime()
  draft.value = mapDetailToDraft(doc)
  roundedAmount.value = toNumber(doc.rounded_amount)
  supplierSearch.value = draft.value.cust_code ? `${draft.value.cust_code} ${draft.value.cust_name || ''}` : ''
  if (draft.value.wh_from) await loadShelves(draft.value.wh_from, true)
  for (const poRef of draft.value.po_refs) {
    await addExistingPOContext(poRef, draft.value.items)
  }
  for (const item of draft.value.items) {
    if (item.item_code) await addExistingDetailLine(item)
  }
  paymentEntries.value = []
  const cashAmount = toNumber(doc.cash_amount)
  if (cashAmount > 0) {
    paymentEntries.value.push({
      id: `cash-${Date.now()}`,
      type: 'cash',
      label: 'เงินสด',
      amount: cashAmount,
      details: {},
    })
  }
  for (const [index, payment] of (doc.payment_detail || []).entries()) {
    const amount = toNumber(payment.pay_amount || payment.amount)
    if (amount <= 0) continue
    paymentEntries.value.push({
      id: `transfer-${Date.now()}-${index}`,
      type: 'transfer',
      label: `${payment.pass_book_code || 'โอน'} (${payment.bank_code || '-'})`,
      amount,
      details: {
        pass_book_code: payment.pass_book_code || '',
        bank_code: payment.bank_code || '',
        bank_branch: payment.bank_branch || '',
        transfer_date: payment.transfer_date || draft.value.doc_date,
      },
    })
  }
  recalcDraftTotals()
  editorVisible.value = true
  setEditorResult(successMessage)
  if (!passBooks.value.length) await loadPassBooks()
}

async function openCreateEditor() {
  editorMode.value = 'create'
  resetEditorRuntime()
  supplierSearch.value = ''
  draft.value = emptyDraft()
  await ensureEditorDefaults()
  draft.value.doc_format_code = docFormatCode.value || preferredPUDocFormatCode()
  draft.value.tax_doc_date = draft.value.doc_date
  recalcDraftTotals()
  editorVisible.value = true
  if (!passBooks.value.length) await loadPassBooks()
  await loadNextDocNo()
}

function openCreatePage() {
  router.push({ name: 'PurchasePUCreate' })
}

function closeEditorPage() {
  router.push({ name: 'PurchasePU' })
}

function backFromEditorHeader() {
  if (editorStep.value === 'payment') {
    editorStep.value = 'document'
    return
  }
  closeEditorPage()
}

function openEditRow(row) {
  const docNo = String(row?.doc_no || '').trim()
  if (!docNo || !canEdit.value) return
  detailVisible.value = false
  router.push({ name: 'PurchasePUEdit', params: { docNo } })
}

async function openEditPage(docNo = route.params.docNo, successMessage = '') {
  if (!canEdit.value) {
    router.push({ name: 'PurchasePU' })
    return
  }
  const targetDocNo = String(docNo || '').trim()
  if (!targetDocNo) {
    setEditorError('ไม่พบเลขที่เอกสารสำหรับแก้ไข')
    return
  }
  editorMode.value = 'update'
  editorSaving.value = false
  clearEditorFeedback()
  try {
    const doc = await getPUDocDetail(targetDocNo)
    selectedDoc.value = doc
    await loadDetailIntoEditor(doc, successMessage)
  } catch (err) {
    setEditorError(err.message || 'โหลดเอกสารสำหรับแก้ไขไม่สำเร็จ')
  }
}

function openSupplierDialog() {
  clearEditorError()
  supplierDialogVisible.value = true
  if (draft.value.cust_code) supplierSearch.value = `${draft.value.cust_code} ${draft.value.cust_name || ''}`.trim()
}

async function searchSuppliers() {
  supplierLoading.value = true
  clearEditorError()
  try {
    const search = supplierSearch.value.trim()
    supplierOptions.value = await getSupplierList(search)
    const exact = supplierOptions.value.length === 1
      && supplierOptions.value[0]?.code?.toUpperCase() === search.toUpperCase()
    if (exact) await selectSupplier(supplierOptions.value[0])
  } catch (err) {
    supplierOptions.value = []
    setEditorError(err.message || 'ค้นหาเจ้าหนี้ไม่สำเร็จ')
  } finally {
    supplierLoading.value = false
  }
}

async function selectSupplier(supplier) {
  if (!supplier?.code) return
  clearEditorError()
  try {
    const detail = await getSupplierDetail(supplier.code)
    const nextCustCode = detail?.cust_code || supplier.code
    if (draft.value.cust_code && draft.value.cust_code !== nextCustCode) {
      draft.value.po_refs = []
      allPoItems.value = []
      scannedGroups.value = []
      poWaitRows.value = []
      refDocSelectedNos.value = []
    }
    refDocError.value = ''
    draft.value.cust_code = nextCustCode
    draft.value.cust_name = detail?.cust_name || supplier.name || ''
    draft.value.branch_code = detail?.branch_code || ''
    draft.value.ap_tax_id = detail?.tax_id || ''
    supplierSearch.value = `${draft.value.cust_code} ${draft.value.cust_name}`.trim()
    supplierOptions.value = []
    supplierDialogVisible.value = false
    poSearch.value = draft.value.cust_code
  } catch (err) {
    setEditorError(err.message || 'โหลดข้อมูลเจ้าหนี้ไม่สำเร็จ')
  }
}

async function searchPOWait() {
  if (!draft.value.cust_code) {
    refDocError.value = 'กรุณาเลือกเจ้าหนี้ก่อนเลือกเอกสารอ้างอิง'
    setEditorError(refDocError.value)
    poWaitRows.value = []
    return
  }
  poWaitLoading.value = true
  clearEditorError()
  refDocError.value = ''
  try {
    const rows = await getPODocWait({
      search: poSearch.value.trim() || draft.value.cust_code,
      fromdate: fromDate.value,
      todate: toDate.value,
    })
    poWaitRows.value = rows.filter((row) => !row.cust_code || row.cust_code === draft.value.cust_code)
  } catch (err) {
    poWaitRows.value = []
    setEditorError(err.message || 'ค้นหา PO รอรับไม่สำเร็จ')
  } finally {
    poWaitLoading.value = false
  }
}

async function openRefDocDialog() {
  if (!draft.value.cust_code) {
    refDocError.value = 'กรุณาเลือกเจ้าหนี้ก่อนเลือกเอกสารอ้างอิง'
    setEditorError(refDocError.value)
    return
  }
  clearEditorError()
  refDocError.value = ''
  poSearch.value = ''
  refDocSelectedNos.value = draft.value.po_refs.map((row) => row.doc_no)
  refDocDialogVisible.value = true
  await searchPOWait()
}

function isRefDocSelected(docNo) {
  return refDocSelectedNos.value.includes(docNo)
}

function toggleRefDocSelection(po) {
  const docNo = String(po?.doc_no || '').trim()
  if (!docNo) return
  if (isRefDocSelected(docNo)) {
    refDocSelectedNos.value = refDocSelectedNos.value.filter((value) => value !== docNo)
  } else {
    refDocSelectedNos.value.push(docNo)
  }
}

async function confirmRefDocs() {
  const selectedNos = new Set(refDocSelectedNos.value)
  const selected = poWaitRows.value.filter((row) => selectedNos.has(row.doc_no))
  if (!selectedNos.size) {
    setEditorError('กรุณาเลือกเอกสารอ้างอิงอย่างน้อย 1 ใบ')
    return
  }
  const removedNos = draft.value.po_refs
    .map((row) => row.doc_no)
    .filter((docNo) => !selectedNos.has(docNo))
  if (removedNos.length) {
    draft.value.po_refs = draft.value.po_refs.filter((row) => !removedNos.includes(row.doc_no))
    allPoItems.value = allPoItems.value.filter((row) => !removedNos.includes(row.doc_no))
    scannedGroups.value = scannedGroups.value.filter((group) => !removedNos.includes(group.po_doc_no))
  }
  for (const row of selected) {
    if (!draft.value.po_refs.some((ref) => ref.doc_no === row.doc_no)) {
      await addPOToDraft(row)
    }
  }
  refDocDialogVisible.value = false
}

function draftHasOnlyBlankItem() {
  return draft.value.items.length === 1 && !String(draft.value.items[0]?.item_code || '').trim()
}

function pushItemsToDraft(items) {
  if (draftHasOnlyBlankItem()) draft.value.items = []
  draft.value.items.push(...items)
  if (!draft.value.items.length) draft.value.items = [emptyItem()]
  recalcDraftTotals()
}

function addDraftPORef(po) {
  const docNo = String(po?.doc_no || '').trim()
  if (!docNo) return
  const context = {
    doc_no: docNo,
    doc_date: toDateInput(po.doc_date),
    doc_success: 0,
    remark: po.remark || '',
    pra_doc_no: po.pra_doc_no || po.pra_doc_list || '',
    pra_remark: po.pra_remark || '',
    pr_doc_no: po.pr_doc_no || '',
    pr_remark: po.pr_remark || '',
  }
  const existing = draft.value.po_refs.find((row) => row.doc_no === docNo)
  if (existing) {
    Object.assign(existing, context)
  } else {
    draft.value.po_refs.push(context)
  }
}

async function addPOToDraft(poRow) {
  const docNo = String(poRow?.doc_no || '').trim()
  if (!docNo) return
  if (draft.value.cust_code && poRow.cust_code && poRow.cust_code !== draft.value.cust_code) {
    setEditorError(`PO ${docNo} เป็นคนละเจ้าหนี้ (${poRow.cust_code})`)
    return
  }
  if (draft.value.po_refs.some((row) => row.doc_no === docNo)) {
    setEditorError(`เลือก PO ${docNo} แล้ว`)
    return
  }
  poWaitLoading.value = true
  clearEditorError()
  try {
    const po = await getDocPoDetail(docNo)
    if (!draft.value.cust_code) {
      draft.value.cust_code = po.cust_code || ''
      draft.value.cust_name = po.cust_name || ''
      supplierSearch.value = `${draft.value.cust_code} ${draft.value.cust_name}`.trim()
    }
    if (!draft.value.wh_from) draft.value.wh_from = po.wh_from || ''
    if (draft.value.wh_from) await loadShelves(draft.value.wh_from, true)
    if (!draft.value.location_from) draft.value.location_from = po.location_from || ''
    addDraftPORef(po)

    const poDate = toDateInput(po.doc_date)
    const poItems = []
    for (const [index, item] of (po.items || []).entries()) {
      const mapped = {
        doc_no: po.doc_no,
        doc_date: poDate,
        ref_doc_date: poDate,
        line_number: toNumber(item.line_number, index + 1),
        item_code: item.item_code || '',
        item_name: item.item_name || '',
        unit_code: item.unit_code || '',
        price: toNumber(item.price),
        wh_code: item.wh_code || po.wh_from || '',
        shelf_code: item.shelf_code || po.location_from || '',
        barcode: item.barcode || '',
        stand_value: toNumber(item.stand_value, 1),
        divide_value: toNumber(item.divide_value, 1),
        ratio: toNumber(item.ratio, 1),
        tax_type: item.tax_type ?? 0,
        po_qty: toNumber(item.po_qty),
        balance_qty: toNumber(item.balance_qty),
      }
      if (!mapped.item_code || mapped.balance_qty <= 0) continue
      mapped.po_line_key = poLineKey(mapped)
      poItems.push(mapped)
    }

    allPoItems.value.push(...poItems)
    for (const poItem of poItems) {
      const group = ensureScanGroup(productToDraftItem(poItem), poItem)
      await addLineToGroup(group, poItem, toNumber(poItem.balance_qty), poItem.barcode || '', '', poItem)
    }
  } catch (err) {
    setEditorError(err.message || 'โหลดรายการ PO ไม่สำเร็จ')
  } finally {
    poWaitLoading.value = false
  }
}

function productToDraftItem(product) {
  const unitCode = product.unit_code || product.unit_cost || product.unit_standard || product.start_sale_unit || ''
  const price = toNumber(product.price_0 ?? product.price ?? product.sale_price)
  const standValue = toNumber(product.stand_value, 1)
  const divideValue = toNumber(product.divide_value, 1)
  return {
    ...emptyItem(),
    item_code: product.item_code || product.code || product.ic_code || '',
    item_name: product.item_name || product.name_1 || '',
    unit_code: unitCode,
    qty: 1,
    price,
    sum_amount: price,
    wh_code: draft.value.wh_from || product.wh_code || '',
    shelf_code: draft.value.location_from || product.shelf_code || '',
    barcode: product.barcode || '',
    stand_value: standValue,
    divide_value: divideValue,
    ratio: toNumber(product.ratio, divideValue ? standValue / divideValue : 1),
    tax_type: product.tax_type ?? 0,
  }
}

function lineSumAmount(line) {
  const discountWord = String(line.discount || '').trim() || String(line.discount_amount || '').trim()
  return Math.max(0, calcSmlDiscountAmount(toNumber(line.price), toNumber(line.qty), discountWord).sum_amount)
}

function lineDiscountAmount(line) {
  const discountWord = String(line.discount || '').trim() || String(line.discount_amount || '').trim()
  return calcSmlDiscountAmount(toNumber(line.price), toNumber(line.qty), discountWord).discount_amount
}

function groupReceivedQty(group) {
  return (group?.scanLines || []).reduce((sum, line) => sum + toNumber(line.qty), 0)
}

function groupPendingQty(group) {
  if (!group?.po_qty) return 0
  return toNumber(group.po_qty)
}

function receivedQtyForPoItem(poItem) {
  return scannedGroups.value
    .filter((group) => group.item_code === poItem.item_code
      && group.unit_code === poItem.unit_code
      && group.po_doc_no === poItem.doc_no)
    .reduce((sum, group) => sum + groupReceivedQty(group), 0)
}

function findAvailablePoItem(itemCode, unitCode) {
  const candidates = allPoItems.value.filter((po) =>
    po.item_code === itemCode && po.unit_code === unitCode && toNumber(po.balance_qty) > 0,
  )
  return candidates.find((po) => receivedQtyForPoItem(po) < toNumber(po.balance_qty)) || null
}

function parseBarcodeInput(raw) {
  let qty = 1
  let rest = String(raw || '').trim()
  const starIndex = rest.indexOf('*')
  if (starIndex > 0) {
    const maybeQty = Number.parseFloat(rest.slice(0, starIndex))
    if (Number.isFinite(maybeQty) && maybeQty > 0) {
      qty = maybeQty
      rest = rest.slice(starIndex + 1).trim()
    }
  }
  let barcode = rest
  let shelfOverride = ''
  const hashIndex = rest.lastIndexOf('#')
  if (hashIndex > 0) {
    barcode = rest.slice(0, hashIndex).trim()
    shelfOverride = rest.slice(hashIndex + 1).trim()
  }
  return { qty, barcode, shelfOverride }
}

async function makeScanLine(data, qty, barcode, shelfOverride, poItem = null) {
  const item = productToDraftItem(data)
  const lineWh = draft.value.wh_from || poItem?.wh_code || item.wh_code || ''
  const lineShelf = shelfOverride || draft.value.location_from || poItem?.shelf_code || item.shelf_code || ''
  const shelfList = lineWh ? await loadShelves(lineWh) : []
  return {
    _line_id: `scan-${++scanLineIdSeed}`,
    barcode: barcode || item.barcode || '',
    qty,
    price: item.price,
    discount: '',
    discount_amount: 0,
    stand_value: item.stand_value,
    divide_value: item.divide_value,
    ratio: item.ratio,
    tax_type: item.tax_type,
    wh_code: lineWh,
    shelf_code: lineShelf,
    _shelfList: withOptionLabels(shelfList),
  }
}

function ensureScanGroup(item, poItem = null) {
  const poDocNo = poItem?.doc_no || ''
  const poLineKey = poItem?.po_line_key || ''
  let group = scannedGroups.value.find((row) =>
    row.item_code === item.item_code
      && row.unit_code === item.unit_code
      && row.po_doc_no === poDocNo
      && (poLineKey ? row.po_line_key === poLineKey : !row.po_line_key),
  )
  if (!group) {
    group = {
      group_key: poLineKey || `nop::${item.item_code}::${item.unit_code}`,
      po_line_key: poLineKey,
      item_code: item.item_code,
      item_name: item.item_name,
      unit_code: item.unit_code,
      po_doc_no: poDocNo,
      po_barcode: poItem?.barcode || '',
      ref_doc_date: poItem?.ref_doc_date || '',
      po_qty: toNumber(poItem?.balance_qty),
      scanLines: [],
    }
    scannedGroups.value.push(group)
    group = scannedGroups.value[scannedGroups.value.length - 1]
  }
  return group
}

async function addLineToGroup(group, data, qty, barcode, shelfOverride, poItem = null) {
  const existingLine = group.scanLines.find((line) =>
    line.barcode === barcode
      && line.wh_code === (poItem?.wh_code || line.wh_code)
      && line.shelf_code === (shelfOverride || poItem?.shelf_code || line.shelf_code),
  )
  if (existingLine) {
    existingLine.qty = toNumber(existingLine.qty) + qty
    return
  }
  group.scanLines.push(await makeScanLine(data, qty, barcode, shelfOverride, poItem))
}

async function addScanLine(data, qty = 1, barcode = '', shelfOverride = '') {
  const item = productToDraftItem(data)
  if (!item.item_code || !item.unit_code) return
  const lineBarcode = barcode || item.barcode || ''

  let remaining = toNumber(qty, 1)
  while (remaining > 0) {
    const poItem = findAvailablePoItem(item.item_code, item.unit_code)
    if (!poItem) {
      const noPoGroup = ensureScanGroup(item, null)
      await addLineToGroup(noPoGroup, item, remaining, lineBarcode, shelfOverride, null)
      remaining = 0
      break
    }

    const group = ensureScanGroup(item, poItem)
    const availableQty = Math.max(0, toNumber(poItem.balance_qty) - groupReceivedQty(group))
    const addQty = Math.min(remaining, availableQty)
    if (addQty <= 0) break
    await addLineToGroup(group, item, addQty, lineBarcode, shelfOverride, poItem)
    remaining -= addQty
  }
}

function removeScanLine(lineId) {
  for (let groupIndex = 0; groupIndex < scannedGroups.value.length; groupIndex += 1) {
    const lineIndex = scannedGroups.value[groupIndex].scanLines.findIndex((line) => line._line_id === lineId)
    if (lineIndex < 0) continue
    scannedGroups.value[groupIndex].scanLines.splice(lineIndex, 1)
    if (!scannedGroups.value[groupIndex].scanLines.length) {
      scannedGroups.value.splice(groupIndex, 1)
    }
    return
  }
}

async function onScanLineWhChange(line) {
  line.shelf_code = ''
  line._shelfList = line.wh_code ? withOptionLabels(await loadShelves(line.wh_code)) : []
}

function isPODocFullyReceived(docNo) {
  const poMap = new Map()
  for (const item of allPoItems.value.filter((row) => row.doc_no === docNo)) {
    const key = `${item.item_code}::${item.unit_code}`
    const existing = poMap.get(key)
    if (existing) existing.balance_qty += toNumber(item.balance_qty)
    else poMap.set(key, { ...item, balance_qty: toNumber(item.balance_qty) })
  }
  const poItems = Array.from(poMap.values())
  if (!poItems.length) return false
  return poItems.every((item) => receivedQtyForPoItem(item) >= toNumber(item.balance_qty))
}

const underReceivedPoItems = computed(() =>
  allPoItems.value
    .map((item) => ({
      ...item,
      received_qty: receivedQtyForPoItem(item),
    }))
    .filter((item) => item.balance_qty > item.received_qty),
)

async function searchProducts() {
  productLoading.value = true
  clearEditorError()
  try {
    productResults.value = await getBarcodeItemSearch({
      search: productSearch.value.trim(),
      custcode: draft.value.cust_code,
      limit: 30,
    })
    productDialogVisible.value = true
  } catch (err) {
    productResults.value = []
    productDialogVisible.value = true
    setEditorError(err.message || 'ค้นหาสินค้าไม่สำเร็จ')
  } finally {
    productLoading.value = false
  }
}

async function addProductToDraft(product) {
  const item = productToDraftItem(product)
  if (!item.item_code) return
  await addScanLine(item, 1, item.barcode || '', '')
  productResults.value = []
  productDialogVisible.value = false
  productSearch.value = ''
}

async function addProductBasketToDraft(items = []) {
  if (!items.length) return
  productLoading.value = true
  clearEditorError()
  try {
    let addedCount = 0
    for (const item of items) {
      const product = item?.product || item
      const qty = toNumber(item?.qty, 1)
      if (!product || qty <= 0) continue
      await addScanLine(product, qty, product.barcode || '', '')
      addedCount += 1
    }
    if (addedCount) setEditorResult(`เพิ่มสินค้าจากตะกร้า ${addedCount} รายการ`)
  } catch (err) {
    setEditorError(err.message || 'เพิ่มสินค้าจากตะกร้าไม่สำเร็จ')
  } finally {
    productLoading.value = false
  }
}

async function addBarcodeToDraft(code = barcodeInput.value) {
  const { qty, barcode, shelfOverride } = parseBarcodeInput(code)
  if (!barcode) return
  productLoading.value = true
  clearEditorError()
  try {
    const product = (await getBarcodeItem(barcode, draft.value.cust_code))[0]
    if (!product) {
      setEditorError(`ไม่พบสินค้าจากบาร์โค้ด ${barcode}`)
      return
    }
    await addScanLine(product, qty, product.barcode || barcode, shelfOverride)
    barcodeInput.value = ''
  } catch (err) {
    setEditorError(err.message || 'ค้นหาบาร์โค้ดไม่สำเร็จ')
  } finally {
    productLoading.value = false
  }
}

async function loadPrintForms(docNo) {
  printFormsLoading.value = true
  printError.value = ''
  selectedPrintForms.value = []
  try {
    const result = await getPurchasePrintForms(docNo)
    const forms = result?.forms || []
    printForms.value = forms
    selectedPrintForms.value = forms.filter((form) => form.available && form.is_default).map((form) => form.formcode)
    if (!selectedPrintForms.value.length) {
      selectedPrintForms.value = forms.filter((form) => form.available).slice(0, 1).map((form) => form.formcode)
    }
    if (!printForms.value.length) {
      printError.value = 'เอกสารนี้ยังไม่ได้กำหนด form_code สำหรับพิมพ์'
    } else if (!selectedPrintForms.value.length) {
      printError.value = 'ไม่พบฟอร์มที่พร้อมใช้งานใน formdesign'
    }
  } catch (err) {
    printForms.value = []
    selectedPrintForms.value = []
    printError.value = err.message || 'โหลดฟอร์มพิมพ์ไม่สำเร็จ'
  } finally {
    printFormsLoading.value = false
  }
}

async function openPrintDialogForDoc(docNo) {
  const targetDocNo = String(docNo || '').trim()
  if (!targetDocNo || !canPrint.value) return
  printDocNo.value = targetDocNo
  printDialogVisible.value = true
  printForms.value = []
  await loadPrintForms(targetDocNo)
}

async function openPrintStatus(row) {
  const docNo = String(row?.doc_no || '').trim()
  await openPrintDialogForDoc(docNo)
}

function confirmPrintForms() {
  if (!printDocNo.value || !selectedPrintForms.value.length) return
  const url = getPurchasePrintUrl(printDocNo.value, selectedPrintForms.value, authStore.employee?.user_code || '')
  window.open(url, '_blank', 'noopener')
  printDialogVisible.value = false
}

function recalcDraftTotals() {
  draft.value.items = draft.value.items.map((item) => {
    const qty = toNumber(item.qty)
    const price = toNumber(item.price)
    const discountAmount = lineDiscountAmount({ ...item, qty, price })
    return {
      ...item,
      qty,
      price,
      discount_amount: discountAmount,
      sum_amount: lineSumAmount({ ...item, qty, price }),
    }
  })
}

const draftTotals = computed(() => {
  const rows = isEditorRoute.value
    ? scanLineEntries().map(({ line }) => line)
    : draft.value.items
  const lineRows = rows.map((item) => {
    const gross = toNumber(item.price) * toNumber(item.qty)
    const discountAmount = lineDiscountAmount(item)
    return {
      sum_amount: Math.max(0, lineSumAmount(item) || (gross - discountAmount)),
      discount_amount: discountAmount,
      tax_type: toNumber(item.tax_type, 0),
    }
  })
  const totalValue = lineRows.reduce((sum, item) => sum + item.sum_amount, 0)
  const totalExceptVat = lineRows
    .filter((item) => String(item.tax_type) === '1')
    .reduce((sum, item) => sum + item.sum_amount, 0)
  const taxableBase = Math.max(0, lineRows
    .filter((item) => String(item.tax_type) !== '1')
    .reduce((sum, item) => sum + item.sum_amount, 0))
  const vatRate = toNumber(draft.value.vat_rate, 7)
  const taxType = toNumber(draft.value.tax_type, 1)
  let totalBeforeVat = 0
  let totalVatValue = 0
  let totalAfterVat = 0
  let totalAmount = 0
  if (taxType === 0) {
    totalBeforeVat = taxableBase
    totalVatValue = rnd(totalBeforeVat * vatRate / 100)
    totalAfterVat = rnd(totalBeforeVat + totalVatValue)
    totalAmount = rnd(totalAfterVat + totalExceptVat)
  } else if (taxType === 1) {
    totalAfterVat = taxableBase
    totalBeforeVat = vatRate > 0 ? rnd(totalAfterVat / (1 + vatRate / 100)) : totalAfterVat
    totalVatValue = rnd(totalAfterVat - totalBeforeVat)
    totalAmount = rnd(totalValue)
  } else {
    totalAmount = rnd(totalValue)
  }
  return {
    total_value: totalValue,
    total_before_vat: totalBeforeVat,
    total_except_vat: totalExceptVat,
    total_after_vat: totalAfterVat,
    total_vat_value: totalVatValue,
    total_amount: totalAmount,
    total_discount: 0,
  }
})

function addDraftItem() {
  draft.value.items.push(emptyItem())
}

function removeDraftItem(index) {
  if (draft.value.items.length === 1) {
    draft.value.items = [emptyItem()]
    return
  }
  draft.value.items.splice(index, 1)
  recalcDraftTotals()
}

function validateDraftLocally({ includePayment = true } = {}) {
  const errors = []
  if (!String(draft.value.cust_code || '').trim()) errors.push('กรุณาเลือกเจ้าหนี้')
  if (!String(draft.value.tax_doc_no || '').trim()) errors.push('กรุณากรอกเลขที่ใบกำกับภาษี')
  if (!draft.value.wh_from) errors.push('กรุณาเลือกคลังเริ่มต้น')
  if (!draft.value.location_from) errors.push('กรุณาเลือกที่เก็บเริ่มต้น')

  const lineRows = isEditorRoute.value
    ? scanLineEntries().map(({ group, line }) => ({
      ...line,
      item_code: group.item_code,
      wh_code: draft.value.wh_from || line.wh_code,
      shelf_code: draft.value.location_from || line.shelf_code,
    }))
    : draft.value.items

  if (!lineRows.length || lineRows.every((line) => !String(line.item_code || '').trim() && !String(line.barcode || '').trim())) {
    errors.push('กรุณาเพิ่มรายการสินค้า')
  }
  if (lineRows.some((line) => !line.wh_code)) errors.push('รายการสินค้าบางรายการยังไม่ได้เลือกคลัง')
  if (lineRows.some((line) => !line.shelf_code)) errors.push('รายการสินค้าบางรายการยังไม่ได้เลือกที่เก็บ')

  if (includePayment && isCashSale.value) {
    if (totalPaid.value <= 0) {
      errors.push('กรุณาใส่การชำระเงินสำหรับการซื้อเงินสด')
    } else if (remainingPayment.value > 0) {
      errors.push(`ยอดชำระยังไม่ครบ คงเหลือ ${formatCurrency(remainingPayment.value)}`)
    }
  }
  return errors
}

function buildDraftPayload() {
  if (!isEditorRoute.value) recalcDraftTotals()
  const totals = draftTotals.value
  const payloadItems = isEditorRoute.value
    ? scanLineEntries().map(({ group, line }) => ({
      doc_no: group.po_doc_no || '',
      ref_doc_no: group.po_doc_no || '',
      ref_doc_date: group.ref_doc_date || allPoItems.value.find((item) =>
        item.doc_no === group.po_doc_no
          && item.item_code === group.item_code
          && item.unit_code === group.unit_code,
      )?.ref_doc_date || '',
      item_code: group.item_code,
      item_name: group.item_name,
      unit_code: group.unit_code,
      qty: toNumber(line.qty),
      price: toNumber(line.price),
      discount: line.discount || '',
      discount_amount: lineDiscountAmount(line),
      sum_amount: lineSumAmount(line),
      wh_code: draft.value.wh_from || line.wh_code,
      shelf_code: draft.value.location_from || line.shelf_code,
      barcode: line.barcode,
      stand_value: toNumber(line.stand_value, 1),
      divide_value: toNumber(line.divide_value, 1),
      ratio: toNumber(line.ratio, 1),
      tax_type: toNumber(line.tax_type),
    }))
    : draft.value.items.map((item) => ({
      doc_no: item.ref_doc_no,
      ref_doc_no: item.ref_doc_no,
      item_code: item.item_code,
      item_name: item.item_name,
      unit_code: item.unit_code,
      qty: toNumber(item.qty),
      price: toNumber(item.price),
      discount: item.discount || '',
      discount_amount: toNumber(item.discount_amount),
      sum_amount: toNumber(item.sum_amount),
      wh_code: item.wh_code,
      shelf_code: item.shelf_code,
      barcode: item.barcode,
      stand_value: toNumber(item.stand_value, 1),
      divide_value: toNumber(item.divide_value, 1),
      ratio: toNumber(item.ratio, 1),
      tax_type: toNumber(item.tax_type),
    }))
  const cashAmount = paymentEntries.value
    .filter((entry) => entry.type === 'cash')
    .reduce((sum, entry) => sum + toNumber(entry.amount), 0)
  const transferAmount = paymentEntries.value
    .filter((entry) => entry.type === 'transfer')
    .reduce((sum, entry) => sum + toNumber(entry.amount), 0)
  const paymentDetail = isCashSale.value
    ? paymentEntries.value
      .filter((entry) => entry.type === 'transfer')
      .map((entry) => ({
        pay_type: '0',
        pay_amount: String(toNumber(entry.amount)),
        amount: String(toNumber(entry.amount)),
        pass_book_code: entry.details?.pass_book_code || '',
        bank_code: entry.details?.bank_code || '',
        bank_branch: entry.details?.bank_branch || '',
        transfer_date: entry.details?.transfer_date || draft.value.doc_date,
      }))
    : []
  return {
    mode: editorMode.value,
    doc_no: editorMode.value === 'update' ? draft.value.doc_no : '',
    doc_date: draft.value.doc_date,
    doc_time: draft.value.doc_time,
    doc_format_code: draft.value.doc_format_code,
    cust_code: draft.value.cust_code,
    ap_cust_code: draft.value.cust_code,
    ap_cust_name: draft.value.cust_name,
    branch_code: draft.value.branch_code,
    ap_branch_code: draft.value.branch_code,
    ap_tax_id: draft.value.ap_tax_id,
    emp_code: authStore.employee?.user_code || '',
    sale_type: toNumber(draft.value.sale_type),
    tax_type: toNumber(draft.value.tax_type, 1),
    vat_rate: toNumber(draft.value.vat_rate, 7),
    tax_doc_no: draft.value.tax_doc_no,
    tax_doc_date: draft.value.tax_doc_date || draft.value.doc_date,
    doc_ref: draft.value.doc_ref,
    doc_ref_date: draft.value.doc_ref_date,
    wh_from: draft.value.wh_from,
    location_from: draft.value.location_from,
    remark: draft.value.remark,
    ...totals,
    rounded_amount: roundedAmount.value,
    total_after_rounded: totalAfterRounded.value,
    cash_amount: cashAmount,
    transfer_amount: transferAmount,
    doc_list: draft.value.po_refs.map((row) => ({
      doc_no: row.doc_no,
      doc_date: row.doc_date,
      doc_success: isPODocFullyReceived(row.doc_no) ? 1 : 0,
    })),
    payment_detail: paymentDetail,
    items: payloadItems,
  }
}

async function saveDraft() {
  if (editorSaving.value) return
  const localErrors = validateDraftLocally()
  if (localErrors.length) {
    setEditorError(localErrors.join(' / '))
    return
  }
  editorSaving.value = true
  clearEditorFeedback()
  try {
    const payload = buildDraftPayload()
    const result = editorMode.value === 'create' ? await createPUDoc(payload) : await updatePUDoc(payload)
    const successMessage = result?.doc_no ? `บันทึกสำเร็จ: ${result.doc_no}` : 'บันทึกสำเร็จ'
    const savedDocNo = result?.doc_no || draft.value.doc_no
    setEditorResult(successMessage)
    if (isEditorRoute.value) {
      await router.push({ name: 'PurchasePU' })
      await Promise.all([loadDocs(), loadNextDocNo()])
    } else {
      editorVisible.value = false
      await Promise.all([loadDocs(), loadNextDocNo()])
    }
    if (savedDocNo) await openPrintDialogForDoc(savedDocNo)
  } catch (err) {
    setEditorError(err.message || 'บันทึกไม่สำเร็จ')
  } finally {
    editorSaving.value = false
  }
}

function resetFilters() {
  searchText.value = ''
  fromDate.value = todayISO().slice(0, 8) + '01'
  toDate.value = todayISO()
  loadDocs()
}

onMounted(async () => {
  await Promise.all([loadDocFormats(), loadWarehouses(), isEditorRoute.value ? Promise.resolve() : loadDocs()])
  if (isCreateRoute.value) await openCreateEditor()
  else if (isEditRoute.value) await openEditPage()
})

watch(() => [route.name, route.params.docNo], async ([name]) => {
  if (name === 'PurchasePUCreate') {
    await openCreateEditor()
  } else if (name === 'PurchasePUEdit') {
    await openEditPage()
  } else if (name === 'PurchasePU') {
    editorVisible.value = false
    detailVisible.value = false
    await loadDocs()
  }
})

</script>

<template>
  <div v-if="isEditorRoute" class="purchase-pu-editor-page">
    <div class="editor-page-header">
      <Button
        icon="pi pi-arrow-left"
        severity="secondary"
        outlined
        aria-label="กลับ"
        @click="backFromEditorHeader"
      />
      <div class="editor-page-title">
        <h1>{{ editorStep === 'payment' ? 'รับชำระเงิน' : (editorMode === 'create' ? 'สร้าง PU' : `แก้ไข PU ${draft.doc_no || ''}`) }}</h1>
        <span>{{ editorStep === 'payment' ? `${saleTypeLabel(draft.sale_type)} · ${draft.doc_no || 'ยังไม่บันทึก'}` : (draft.cust_code || 'ยังไม่เลือกเจ้าหนี้') }}</span>
      </div>
      <div class="editor-page-actions">
        <Button
          :icon="isCashSale && editorStep === 'document' ? 'pi pi-arrow-right' : 'pi pi-save'"
          :label="editorActionLabel"
          :loading="editorSaving"
          :disabled="!canSaveDraft"
          @click="handleEditorAction"
        />
      </div>
    </div>

    <div v-if="editorStep === 'document'" class="editor-page-layout">
      <main class="editor-document">
        <section class="editor-section">
          <div class="editor-grid">
            <label class="field">
              <span>รหัสเอกสาร</span>
              <Select
                v-model="draft.doc_format_code"
                :options="docFormatOptions"
                option-label="label"
                option-value="code"
                class="w-full"
                :loading="docFormatLoading"
                :disabled="editorMode === 'update'"
                @change="editorMode === 'create' && loadNextDocNo()"
              />
            </label>
            <label class="field">
              <span>เลขที่เอกสาร</span>
              <InputText :model-value="nextDocLoading ? 'กำลังโหลด...' : (draft.doc_no || '-')" disabled />
            </label>
            <label class="field">
              <span>วันที่เอกสาร</span>
              <IsoDatePicker v-model="draft.doc_date" @change="editorMode === 'create' && loadNextDocNo()" />
            </label>
            <label class="field">
              <span>เวลา</span>
              <InputText v-model="draft.doc_time" type="time" />
            </label>
            <label class="field">
              <span>เลขที่ใบกำกับ</span>
              <InputText v-model.trim="draft.tax_doc_no" />
            </label>
            <label class="field">
              <span>วันที่ใบกำกับ</span>
              <IsoDatePicker v-model="draft.tax_doc_date" />
            </label>
            <label class="field">
              <span>เอกสารอ้างอิง</span>
              <InputText v-model.trim="draft.doc_ref" />
            </label>
            <label class="field">
              <span>วันที่อ้างอิง</span>
              <IsoDatePicker v-model="draft.doc_ref_date" />
            </label>
            <label class="field">
              <span>ประเภทการซื้อ</span>
              <Select
                v-model="draft.sale_type"
                :options="saleTypeOptions"
                option-label="label"
                option-value="value"
              />
            </label>
            <label class="field">
              <span>ประเภทภาษี</span>
              <Select
                v-model="draft.tax_type"
                :options="taxTypeOptions"
                option-label="label"
                option-value="value"
                @change="recalcDraftTotals"
              />
            </label>
            <label class="field">
              <span>คลัง</span>
              <Select
                v-model="draft.wh_from"
                :options="warehouseSelectOptions"
                option-label="label"
                option-value="code"
                filter
                placeholder="เลือกคลัง"
                @change="onHeaderWarehouseChange"
              />
            </label>
            <label class="field">
              <span>ที่เก็บ</span>
              <Select
                v-model="draft.location_from"
                :options="shelfSelectOptions"
                option-label="label"
                option-value="code"
                filter
                placeholder="เลือกที่เก็บ"
                :loading="shelfLoading"
              />
            </label>
            <label class="field wide">
              <span>หมายเหตุ</span>
              <InputText v-model.trim="draft.remark" />
            </label>
          </div>
        </section>

        <div class="pick-panels compact-pick-panels">
          <section class="pick-panel compact-pick-panel">
            <div class="pick-title">
              <strong>เจ้าหนี้</strong>
              <Button
                icon="pi pi-search"
                :label="draft.cust_code ? 'เปลี่ยน' : 'เลือกเจ้าหนี้'"
                severity="info"
                size="small"
                @click="openSupplierDialog"
              />
            </div>
            <div class="selected-box" :class="{ empty: !draft.cust_code }">
              <strong>{{ draft.cust_code || 'ยังไม่เลือกเจ้าหนี้' }}</strong>
              <span>{{ draft.cust_name || 'กดเลือกเจ้าหนี้เพื่อค้นหาและเลือกจากรายการ' }}</span>
            </div>
          </section>

          <section class="pick-panel compact-pick-panel">
            <div class="pick-title">
              <strong>เอกสารอ้างอิง</strong>
              <Button
                icon="pi pi-file-import"
                label="เลือกเอกสาร"
                severity="warn"
                size="small"
                :loading="poWaitLoading"
                @click="openRefDocDialog"
              />
            </div>
            <div v-if="draft.po_refs.length" class="selected-ref-list">
              <div v-for="ref in draft.po_refs" :key="ref.doc_no" class="selected-ref-row">
                <strong>{{ ref.doc_no }}</strong>
                <span>{{ formatDate(ref.doc_date) }}</span>
              </div>
            </div>
            <div v-else class="selected-box empty">
              <strong>ไม่มีเอกสารอ้างอิง</strong>
              <span>{{ refDocError || (draft.cust_code ? 'เลือกได้หลายใบ หรือสร้าง PU แบบไม่อ้างอิงได้' : 'เลือกเจ้าหนี้ก่อนเลือกเอกสารอ้างอิง') }}</span>
            </div>
          </section>
        </div>

        <section class="pick-panel product-pick-panel">
          <div class="pick-title">
            <strong>สินค้า</strong>
            <span>ค้นหา / ยิงบาร์โค้ด / ตะกร้าสินค้า</span>
          </div>
          <div class="product-tools">
            <div class="pick-search">
              <InputText v-model.trim="productSearch" placeholder="ค้นหารหัสสินค้า / ชื่อ / บาร์โค้ด" @keyup.enter="searchProducts" />
              <Button icon="pi pi-search" severity="secondary" outlined :loading="productLoading" @click="searchProducts" />
            </div>
            <div class="pick-search">
              <InputText v-model.trim="barcodeInput" placeholder="[จำนวน*]บาร์โค้ด[#ที่เก็บ]" @keyup.enter="addBarcodeToDraft()" />
              <Button icon="pi pi-barcode" severity="secondary" outlined :loading="productLoading" @click="addBarcodeToDraft()" />
            </div>
            <div class="product-action-buttons">
              <Button icon="pi pi-shopping-cart" label="ตะกร้าสินค้า" severity="success" @click="productBasketVisible = true" />
            </div>
          </div>

        </section>

        <section class="editor-section item-section">
          <div class="item-toolbar">
            <strong>รายการสินค้า</strong>
            <span v-if="underReceivedPoItems.length" class="item-warning">
              ค้างรับ {{ underReceivedPoItems.length }} รายการ
            </span>
          </div>
          <div class="editor-table-wrap">
            <table class="editor-table">
              <thead>
                <tr>
                  <th>เอกสาร</th>
                  <th>รหัส</th>
                  <th>ชื่อสินค้า</th>
                  <th>หน่วย</th>
                  <th>บาร์โค้ด</th>
                  <th class="num">จำนวน</th>
                  <th class="num">ราคา</th>
                  <th class="num">ส่วนลด</th>
                  <th class="num">ราคารวม</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <template v-for="group in displayGroups" :key="`${group.po_doc_no || 'nop'}-${group.item_code}-${group.unit_code}-${group.scanLines?.[0]?.barcode || group.po_barcode || ''}`">
                  <tr v-for="(line, lineIndex) in group.scanLines" :key="`${group.po_doc_no || 'nop'}-${group.item_code}-${line.barcode}-${lineIndex}`" class="receive-row">
                    <td>{{ group.po_doc_no || '-' }}</td>
                    <td>{{ group.item_code }}</td>
                    <td>{{ group.item_name }}</td>
                    <td>{{ group.unit_code || '-' }}</td>
                    <td><span class="barcode-readonly">{{ line.barcode || '-' }}</span></td>
                    <td><InputText v-model="line.qty" type="number" min="0" step="0.01" class="cell-input num-input" /></td>
                    <td><InputText v-model="line.price" type="number" min="0" step="0.01" class="cell-input num-input" /></td>
                    <td><InputText v-model.trim="line.discount" class="cell-input num-input" placeholder="0 หรือ %" /></td>
                    <td class="num">{{ formatCurrency(lineSumAmount(line)) }}</td>
                    <td>
                      <Button icon="pi pi-trash" text rounded severity="danger" aria-label="ลบรายการ" @click="removeScanLine(line._line_id)" />
                    </td>
                  </tr>
                </template>
                <tr v-if="!displayGroups.length">
                  <td colspan="10" class="empty-lines">เลือกเอกสารอ้างอิง หรือค้นหา/สแกนสินค้าเพื่อเพิ่มรายการ</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="editor-section totals-section">
          <div class="purchase-summary-block document-summary">
            <div class="pu-sum-row">
              <span class="pu-sum-label">ยอดรวมสินค้า</span>
              <span class="pu-sum-value">{{ formatCurrency(draftTotals.total_value) }}</span>
            </div>
            <div class="pu-summary-divider" />
            <div class="pu-sum-row pu-net-row">
              <span class="pu-net-label">ยอดสุทธิ</span>
              <span class="pu-net-value">{{ formatCurrency(draftTotals.total_amount) }}</span>
            </div>
            <button type="button" class="pu-tax-toggle" @click="purchaseTaxDetailVisible = !purchaseTaxDetailVisible">
              <i class="pi pi-receipt" />
              {{ purchaseTaxDetailVisible ? 'ซ่อนรายละเอียดภาษี' : 'รายละเอียดภาษี' }}
              <i :class="purchaseTaxDetailVisible ? 'pi pi-chevron-up' : 'pi pi-chevron-down'" />
            </button>
            <div v-if="purchaseTaxDetailVisible" class="pu-tax-detail">
              <div class="pu-tax-grid">
                <div class="pu-tax-cell">
                  <span>ประเภทภาษี</span>
                  <strong>{{ taxTypeShortLabel(draft.tax_type) }}</strong>
                </div>
                <div class="pu-tax-cell">
                  <span>อัตราภาษี</span>
                  <strong>{{ formatVatRate(draft.vat_rate) }}%</strong>
                </div>
                <div class="pu-tax-cell">
                  <span>ยอดก่อนภาษี</span>
                  <strong>{{ formatCurrency(draftTotals.total_before_vat) }}</strong>
                </div>
                <div class="pu-tax-cell">
                  <span>{{ vatSummaryLabel(draft.tax_type, draft.vat_rate) }}</span>
                  <strong>{{ draftTotals.total_vat_value > 0 ? formatCurrency(draftTotals.total_vat_value) : '-' }}</strong>
                </div>
                <div v-if="draftTotals.total_except_vat > 0" class="pu-tax-cell">
                  <span>มูลค่ายกเว้นภาษี</span>
                  <strong>{{ formatCurrency(draftTotals.total_except_vat) }}</strong>
                </div>
                <div class="pu-tax-cell">
                  <span>ยอดสุทธิ</span>
                  <strong class="pu-tax-net">{{ formatCurrency(draftTotals.total_amount) }}</strong>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

    </div>

    <section v-else class="purchase-payment-step">
      <div class="summary-bar">
        <div class="summary-item">
          <span class="summary-label">ยอดสุทธิ</span>
          <span class="summary-total">{{ formatCurrency(draftTotals.total_amount) }}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">หลังปัดเศษ</span>
          <span class="summary-total">{{ formatCurrency(totalAfterRounded) }}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">ชำระแล้ว</span>
          <span class="summary-paid">{{ formatCurrency(totalPaid) }}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">{{ paymentChange > 0 ? 'เงินทอน' : 'คงเหลือ' }}</span>
          <span :class="paymentChange > 0 ? 'summary-change' : 'summary-remaining'">
            {{ formatCurrency(paymentChange > 0 ? paymentChange : remainingPayment) }}
          </span>
        </div>
      </div>

      <div class="rounding-bar">
        <label class="rounding-label">
          <i class="pi pi-percentage" />
          ปัดเศษ
        </label>
        <InputNumber
          v-model="roundedAmount"
          :min-fraction-digits="2"
          :max-fraction-digits="2"
          suffix=" บาท"
          class="rounding-input"
          size="small"
        />
        <button
          v-if="suggestedRoundAmount"
          class="rounding-fill-btn"
          @click="fillSuggestedRounding"
        >ปัดเป็น {{ formatCurrency(draftTotals.total_amount + suggestedRoundAmount) }}</button>
      </div>

      <div class="entries-section">
        <div v-if="paymentEntries.length === 0" class="entries-empty">ยังไม่มีรายการชำระเงิน</div>
        <div v-else class="entries-list">
          <div v-for="entry in paymentEntries" :key="entry.id" class="entry-row">
            <div class="entry-icon-wrap">
              <i :class="entry.type === 'cash' ? 'pi pi-money-bill' : 'pi pi-send'" class="entry-icon" />
            </div>
            <div class="entry-info">
              <div class="entry-label">{{ entry.label }}</div>
              <div v-if="entry.type === 'transfer'" class="entry-sub">
                {{ entry.details?.pass_book_code || '-' }} {{ entry.details?.bank_code ? `/ ${entry.details.bank_code}` : '' }}
              </div>
            </div>
            <span class="entry-amount">{{ formatCurrency(entry.amount) }}</span>
            <Button icon="pi pi-times" text rounded size="small" severity="danger" aria-label="ลบการชำระ" @click="removePaymentEntry(entry.id)" />
          </div>
        </div>
      </div>

      <div class="add-payment-panel">
        <div class="type-tabs">
          <button class="type-tab" :class="{ 'type-tab-active': activePayType === 'cash' }" @click="activePayType = 'cash'">
            <i class="pi pi-money-bill" />
            เงินสด
          </button>
          <button class="type-tab" :class="{ 'type-tab-active': activePayType === 'transfer' }" @click="activePayType = 'transfer'">
            <i class="pi pi-send" />
            โอน
          </button>
        </div>

        <div v-if="activePayType === 'cash'" class="type-form">
          <div class="denom-row">
            <button v-for="denom in denoms" :key="denom" class="denom-btn" @click="addDenom(denom)">
              ฿{{ denom >= 1000 ? `${denom / 1000}K` : denom }}
            </button>
            <button class="denom-btn exact" :disabled="remainingPayment <= 0" @click="fillCashRemaining">พอดี</button>
          </div>
          <div class="form-row">
            <label class="form-label">จำนวนรับ</label>
            <InputNumber
              v-model="cashInputAmount"
              :min="0"
              :min-fraction-digits="2"
              :max-fraction-digits="2"
              suffix=" บาท"
              class="form-input"
              size="small"
            />
          </div>
          <Button icon="pi pi-plus" label="เพิ่มรายการ" size="small" class="add-btn" :disabled="toNumber(cashInputAmount) <= 0" @click="addCashPayment" />
        </div>

        <div v-else class="type-form">
          <div class="form-row">
            <label class="form-label">วันที่โอน</label>
            <IsoDatePicker v-model="transferDate" class="form-input" size="small" />
          </div>
          <div class="form-row">
            <label class="form-label">สมุดบัญชี</label>
            <Select
              v-model="transferPassBook"
              :options="passBooks"
              option-label="book_name"
              filter
              :loading="passBooksLoading"
              placeholder="เลือกสมุดบัญชี"
              class="form-input"
              size="small"
            />
          </div>
          <div class="form-row">
            <label class="form-label">จำนวนเงิน</label>
            <InputNumber
              v-model="transferInputAmount"
              :min="0"
              :min-fraction-digits="2"
              :max-fraction-digits="2"
              suffix=" บาท"
              class="form-input"
              size="small"
            />
          </div>
          <button v-if="remainingPayment > 0" class="fill-remaining-btn" @click="transferInputAmount = remainingPayment">
            คงเหลือ {{ formatCurrency(remainingPayment) }}
          </button>
          <Button icon="pi pi-plus" label="เพิ่มรายการ" size="small" class="add-btn" :disabled="!transferPassBook || toNumber(transferInputAmount) <= 0" @click="addTransferPayment" />
        </div>
      </div>
    </section>

    <div class="ipad-action-bar">
      <div class="ipad-action-total">
        <span>{{ editorStep === 'payment' ? (paymentChange > 0 ? 'เงินทอน' : 'คงเหลือ') : 'ยอดสุทธิ' }}</span>
        <strong>{{ editorStep === 'payment' ? formatCurrency(paymentChange > 0 ? paymentChange : remainingPayment) : formatCurrency(draftTotals.total_amount) }}</strong>
      </div>
      <Button
        :icon="isCashSale && editorStep === 'document' ? 'pi pi-arrow-right' : 'pi pi-save'"
        :label="editorActionLabel"
        :loading="editorSaving"
        :disabled="!canSaveDraft"
        @click="handleEditorAction"
      />
    </div>

    <Dialog
      v-model:visible="supplierDialogVisible"
      header="เลือกเจ้าหนี้"
      modal
      :draggable="false"
      class="supplier-dialog"
      :style="{ width: 'min(720px, 96vw)' }"
    >
      <div class="supplier-dialog-body">
        <div class="pick-search">
          <InputText v-model.trim="supplierSearch" placeholder="ค้นหารหัส/ชื่อเจ้าหนี้" @keyup.enter="searchSuppliers" />
          <Button icon="pi pi-search" severity="secondary" outlined :loading="supplierLoading" @click="searchSuppliers" />
        </div>
        <div v-if="draft.cust_code" class="selected-box">
          <strong>{{ draft.cust_code }}</strong>
          <span>{{ draft.cust_name || '-' }}</span>
        </div>
        <div v-if="supplierOptions.length" class="supplier-result-list">
          <button v-for="supplier in supplierOptions" :key="supplier.code" class="pick-row" @click="selectSupplier(supplier)">
            <strong>{{ supplier.code }}</strong>
            <span>{{ supplier.name }}</span>
          </button>
        </div>
        <div v-else class="empty-lines">
          {{ supplierLoading ? 'กำลังค้นหาเจ้าหนี้...' : 'ค้นหารหัสหรือชื่อเจ้าหนี้เพื่อเลือก' }}
        </div>
      </div>
      <template #footer>
        <Button label="ปิด" severity="secondary" outlined @click="supplierDialogVisible = false" />
      </template>
    </Dialog>

    <Dialog
      v-model:visible="refDocDialogVisible"
      header="เลือกเอกสารอ้างอิง"
      modal
      :draggable="false"
      class="ref-doc-dialog"
      :style="{ width: 'min(880px, 96vw)' }"
    >
      <div class="ref-doc-body">
        <div class="selected-box">
          <strong>{{ draft.cust_code }}</strong>
          <span>{{ draft.cust_name || '-' }}</span>
        </div>
        <div class="pick-search">
          <InputText v-model.trim="poSearch" placeholder="ค้นหาเลขที่เอกสารอ้างอิง" @keyup.enter="searchPOWait" />
          <Button icon="pi pi-search" severity="secondary" outlined :loading="poWaitLoading" @click="searchPOWait" />
        </div>
        <div v-if="poWaitRows.length" class="ref-doc-list">
          <button
            v-for="po in poWaitRows"
            :key="po.doc_no"
            class="ref-doc-row"
            :class="{ selected: isRefDocSelected(po.doc_no) }"
            @click="toggleRefDocSelection(po)"
          >
            <i :class="isRefDocSelected(po.doc_no) ? 'pi pi-check-circle' : 'pi pi-circle'" />
            <span>
              <strong>{{ po.doc_no }}</strong>
              <small>{{ formatDate(po.doc_date) }} · {{ po.cust_code }} {{ po.cust_name || '' }}</small>
            </span>
            <strong>{{ formatCurrency(po.total_amount || 0) }}</strong>
          </button>
        </div>
        <div v-else class="empty-lines">
          {{ poWaitLoading ? 'กำลังค้นหาเอกสารอ้างอิง...' : 'ไม่พบเอกสารอ้างอิง' }}
        </div>
      </div>
      <template #footer>
        <Button label="ปิด" severity="secondary" outlined @click="refDocDialogVisible = false" />
        <Button
          icon="pi pi-check"
          label="นำเข้าเอกสารที่เลือก"
          :disabled="!refDocSelectedNos.length"
          :loading="poWaitLoading"
          @click="confirmRefDocs"
        />
      </template>
    </Dialog>

    <Dialog
      v-model:visible="productDialogVisible"
      header="เลือกสินค้า"
      modal
      :draggable="false"
      class="product-search-dialog"
      :style="{ width: 'min(860px, 96vw)' }"
    >
      <div class="product-search-dialog-body">
        <div class="pick-search">
          <InputText v-model.trim="productSearch" placeholder="ค้นหารหัสสินค้า / ชื่อ / บาร์โค้ด" @keyup.enter="searchProducts" />
          <Button icon="pi pi-search" severity="secondary" outlined :loading="productLoading" @click="searchProducts" />
        </div>
        <div v-if="productLoading" class="detail-loading compact">
          <i class="pi pi-spin pi-spinner" />
          <span>กำลังค้นหาสินค้า...</span>
        </div>
        <div v-else-if="productResults.length" class="product-result-list">
          <button
            v-for="product in productResults"
            :key="`${product.item_code || product.code}-${product.unit_code || product.unit_standard || ''}`"
            class="product-result-row"
            @click="addProductToDraft(product)"
          >
            <strong>{{ product.item_code || product.code }}</strong>
            <span>{{ product.item_name || product.name_1 }}</span>
            <small>{{ product.unit_code || product.unit_standard || '-' }}</small>
          </button>
        </div>
        <div v-else class="empty-lines">
          ไม่พบสินค้า
        </div>
      </div>
      <template #footer>
        <Button label="ปิด" severity="secondary" outlined @click="productDialogVisible = false" />
      </template>
    </Dialog>

    <PurchaseProductBasketDialog
      v-model:visible="productBasketVisible"
      :cust-code="draft.cust_code"
      @confirm="addProductBasketToDraft"
    />

    <Dialog
      v-model:visible="printDialogVisible"
      modal
      class="pu-print-dialog"
      :style="{ width: 'min(680px, 94vw)' }"
      header="ฟอร์มพิมพ์ PU"
    >
      <div class="print-dialog-body">
        <div class="print-doc-no">{{ printDocNo }}</div>
        <Message severity="info" :closable="false" class="print-note">
          เลือกฟอร์มที่ต้องการพิมพ์
        </Message>
        <Message v-if="printError" severity="warn" :closable="false">{{ printError }}</Message>
        <div v-if="printFormsLoading" class="detail-loading compact">
          <i class="pi pi-spin pi-spinner" />
          <span>กำลังโหลดฟอร์ม...</span>
        </div>
        <div v-else class="print-list">
          <label v-for="form in printForms" :key="form.formcode" class="print-row" :class="{ disabled: !form.available }">
            <Checkbox
              v-model="selectedPrintForms"
              :input-id="`pu-editor-print-form-${form.formcode}`"
              :value="form.formcode"
              :disabled="!form.available"
            />
            <span>
              <strong>{{ form.formname }}</strong>
              <small>{{ form.formcode }}<template v-if="form.is_default"> · ค่าเริ่มต้น</template><template v-if="!form.available"> · ไม่พบใน formdesign</template></small>
            </span>
          </label>
          <span v-if="!printForms.length && !printError" class="muted">ไม่มีฟอร์มพิมพ์</span>
        </div>
      </div>
      <template #footer>
        <Button label="ปิด" severity="secondary" outlined @click="printDialogVisible = false" />
        <Button icon="pi pi-print" label="พิมพ์" :disabled="printFormsLoading || !selectedPrintForms.length" @click="confirmPrintForms" />
      </template>
    </Dialog>
  </div>

  <div v-else class="purchase-pu-view">
    <div class="page-header">
      <div>
        <h1 class="page-title">ซื้อสินค้า/ตั้งหนี้ (PU)</h1>
        <p class="page-subtitle">ตรวจสอบเอกสาร PU, รหัสเอกสาร และฟอร์มพิมพ์จากฐานข้อมูลจริง</p>
      </div>
      <div class="header-actions">
        <Button v-if="canCreate" icon="pi pi-plus" label="สร้าง PU" @click="openCreatePage" />
        <Button icon="pi pi-refresh" label="โหลดใหม่" :loading="loading" outlined @click="loadDocs" />
      </div>
    </div>

    <Message v-if="errorMsg" severity="error" :closable="false">{{ errorMsg }}</Message>

    <section class="filter-bar">
      <InputText v-model="searchText" placeholder="ค้นหาเลขที่เอกสาร / เจ้าหนี้ / ผู้ขอ" class="search-input" @keyup.enter="loadDocs" />
      <IsoDatePicker v-model="fromDate" class="date-input" />
      <IsoDatePicker v-model="toDate" class="date-input" />
      <Button icon="pi pi-search" label="ค้นหา" :loading="loading" @click="loadDocs" />
      <Button icon="pi pi-filter-slash" label="ล้าง" severity="secondary" outlined @click="resetFilters" />
    </section>

    <DataTable
      :value="rows"
      :loading="loading"
      data-key="doc_no"
      scrollable
      scroll-height="flex"
      striped-rows
      class="pu-table"
      paginator
      :rows="20"
      :rows-per-page-options="[20, 50, 100]"
      @row-dblclick="openDetail($event.data)"
    >
      <Column field="doc_no" header="เลขที่" style="min-width: 150px" sortable />
      <Column header="วันที่" style="min-width: 130px" sortable>
        <template #body="{ data }">{{ formatDate(data.doc_date) }} {{ data.doc_time || '' }}</template>
      </Column>
      <Column header="เจ้าหนี้" style="min-width: 220px">
        <template #body="{ data }">
          <div class="supplier-cell">
            <strong>{{ data.cust_code || '-' }}</strong>
            <span>{{ data.cust_name || '-' }}</span>
          </div>
        </template>
      </Column>
      <Column header="PO อ้างอิง" style="min-width: 160px">
        <template #body="{ data }">{{ data.po_doc_list || '-' }}</template>
      </Column>
      <Column header="จำนวน" body-class="col-num" header-class="col-num" style="min-width: 100px">
        <template #body="{ data }">{{ formatNumber(data.total_qty || 0) }}</template>
      </Column>
      <Column header="ยอดรวม" body-class="col-num" header-class="col-num" style="min-width: 130px">
        <template #body="{ data }">{{ formatCurrency(data.total_amount || 0) }}</template>
      </Column>
      <Column header="" style="width: 132px">
        <template #body="{ data }">
          <div class="row-actions">
            <Button icon="pi pi-eye" text rounded severity="secondary" aria-label="ดูรายละเอียด" @click.stop="openDetail(data)" />
            <Button v-if="canEdit" icon="pi pi-pencil" text rounded severity="secondary" aria-label="แก้ไขเอกสาร" @click.stop="openEditRow(data)" />
            <Button v-if="canPrint" icon="pi pi-print" text rounded severity="secondary" aria-label="ดูฟอร์มพิมพ์" @click.stop="openPrintStatus(data)" />
          </div>
        </template>
      </Column>
    </DataTable>

    <Dialog
      v-model:visible="detailVisible"
      modal
      maximizable
      class="pu-detail-dialog"
      :style="{ width: 'min(1080px, 96vw)' }"
    >
      <template #header>
        <div class="detail-dialog-header">
          <span>รายละเอียด PU</span>
          <Button
            v-if="canPrint && selectedDoc?.doc_no"
            icon="pi pi-print"
            label="พิมพ์"
            severity="info"
            size="small"
            @click="openPrintDialogForDoc(selectedDoc.doc_no)"
          />
        </div>
      </template>

      <div v-if="detailLoading" class="detail-loading">
        <i class="pi pi-spin pi-spinner" />
        <span>กำลังโหลดรายละเอียด...</span>
      </div>

      <div v-else-if="selectedDoc" class="detail-body">
        <section class="detail-section">
          <div class="detail-field-grid">
            <div><span>รหัสเอกสาร</span><strong>{{ docFormatLabel(selectedDoc) }}</strong></div>
            <div><span>เลขที่เอกสาร</span><strong>{{ selectedDoc.doc_no }}</strong></div>
            <div><span>วันที่เอกสาร</span><strong>{{ formatDate(selectedDoc.doc_date) }}</strong></div>
            <div><span>เวลา</span><strong>{{ selectedDoc.doc_time || '-' }}</strong></div>
            <div><span>เลขที่ใบกำกับ</span><strong>{{ selectedDoc.tax_doc_no || '-' }}</strong></div>
            <div><span>วันที่ใบกำกับ</span><strong>{{ selectedDoc.tax_doc_date ? formatDate(selectedDoc.tax_doc_date) : '-' }}</strong></div>
            <div><span>ประเภทการซื้อ</span><strong>{{ saleTypeLabel(selectedDoc.sale_type ?? selectedDoc.inquiry_type) }}</strong></div>
            <div><span>ประเภทภาษี</span><strong>{{ taxTypeLabel(selectedDoc.tax_type ?? selectedDoc.vat_type) }}</strong></div>
            <div><span>คลัง</span><strong>{{ selectedDoc.wh_from || '-' }}</strong></div>
            <div><span>ที่เก็บ</span><strong>{{ selectedDoc.location_from || '-' }}</strong></div>
            <div><span>เอกสารอ้างอิง</span><strong>{{ selectedDoc.doc_ref || '-' }}</strong></div>
            <div><span>วันที่อ้างอิง</span><strong>{{ selectedDoc.doc_ref_date ? formatDate(selectedDoc.doc_ref_date) : '-' }}</strong></div>
            <div class="wide"><span>หมายเหตุ</span><strong>{{ selectedDoc.remark || '-' }}</strong></div>
          </div>
        </section>

        <div class="detail-pick-panels">
          <section class="pick-panel">
            <div class="pick-title">
              <strong>เจ้าหนี้</strong>
            </div>
            <div class="detail-selected-box">
              <strong>{{ selectedDoc.cust_code || '-' }}</strong>
              <span>{{ selectedDoc.cust_name || '-' }}</span>
            </div>
          </section>

          <section class="pick-panel">
            <div class="pick-title">
              <strong>เอกสารอ้างอิง</strong>
            </div>
            <div v-if="detailPoRefs.length" class="detail-ref-list">
              <span v-for="ref in detailPoRefs" :key="ref.doc_no" class="detail-ref-chip">
                <strong>{{ ref.doc_no }}</strong>
                <small>{{ ref.doc_date ? formatDate(ref.doc_date) : '' }}</small>
              </span>
            </div>
            <div v-else class="detail-selected-box muted">ไม่มีเอกสารอ้างอิง</div>
          </section>
        </div>

        <Message v-if="printError" severity="warn" :closable="false">{{ printError }}</Message>

        <DataTable :value="detailItems" data-key="item_code" scrollable scroll-height="320px" size="small" striped-rows>
          <Column field="ref_doc_no" header="เอกสาร" style="min-width: 130px">
            <template #body="{ data }">{{ data.ref_doc_no || '-' }}</template>
          </Column>
          <Column field="item_code" header="รหัส" style="min-width: 130px" />
          <Column field="item_name" header="ชื่อสินค้า" style="min-width: 240px" />
          <Column field="unit_code" header="หน่วย" style="min-width: 80px" />
          <Column header="บาร์โค้ด" style="min-width: 140px">
            <template #body="{ data }">{{ data.barcode || '-' }}</template>
          </Column>
          <Column header="จำนวน" body-class="col-num" header-class="col-num" style="min-width: 100px">
            <template #body="{ data }">{{ formatNumber(data.qty || 0) }}</template>
          </Column>
          <Column header="ราคา" body-class="col-num" header-class="col-num" style="min-width: 110px">
            <template #body="{ data }">{{ formatCurrency(data.price || 0) }}</template>
          </Column>
          <Column header="ส่วนลด" body-class="col-num" header-class="col-num" style="min-width: 110px">
            <template #body="{ data }">{{ data.discount || (toNumber(data.discount_amount) ? formatCurrency(data.discount_amount) : '-') }}</template>
          </Column>
          <Column header="ราคารวม" body-class="col-num" header-class="col-num" style="min-width: 120px">
            <template #body="{ data }">{{ formatCurrency(data.sum_amount || 0) }}</template>
          </Column>
        </DataTable>

        <section class="editor-section totals-section">
          <div class="purchase-summary-block document-summary">
            <div class="pu-sum-row">
              <span class="pu-sum-label">ยอดรวมสินค้า</span>
              <span class="pu-sum-value">{{ formatCurrency(selectedDoc.total_value || 0) }}</span>
            </div>
            <div class="pu-summary-divider" />
            <div class="pu-sum-row pu-net-row">
              <span class="pu-net-label">ยอดสุทธิ</span>
              <span class="pu-net-value">{{ formatCurrency(selectedDoc.total_amount || 0) }}</span>
            </div>
            <button type="button" class="pu-tax-toggle" @click="purchaseTaxDetailVisible = !purchaseTaxDetailVisible">
              <i class="pi pi-receipt" />
              {{ purchaseTaxDetailVisible ? 'ซ่อนรายละเอียดภาษี' : 'รายละเอียดภาษี' }}
              <i :class="purchaseTaxDetailVisible ? 'pi pi-chevron-up' : 'pi pi-chevron-down'" />
            </button>
            <div v-if="purchaseTaxDetailVisible" class="pu-tax-detail">
              <div class="pu-tax-grid">
                <div class="pu-tax-cell">
                  <span>ประเภทภาษี</span>
                  <strong>{{ taxTypeShortLabel(selectedDoc.tax_type ?? selectedDoc.vat_type) }}</strong>
                </div>
                <div class="pu-tax-cell">
                  <span>อัตราภาษี</span>
                  <strong>{{ formatVatRate(selectedDoc.vat_rate ?? 7) }}%</strong>
                </div>
                <div class="pu-tax-cell">
                  <span>ยอดก่อนภาษี</span>
                  <strong>{{ formatCurrency(selectedDoc.total_before_vat || 0) }}</strong>
                </div>
                <div class="pu-tax-cell">
                  <span>{{ vatSummaryLabel(selectedDoc.tax_type ?? selectedDoc.vat_type, selectedDoc.vat_rate ?? 7) }}</span>
                  <strong>{{ toNumber(selectedDoc.total_vat_value) > 0 ? formatCurrency(selectedDoc.total_vat_value || 0) : '-' }}</strong>
                </div>
                <div v-if="toNumber(selectedDoc.total_except_vat) > 0" class="pu-tax-cell">
                  <span>มูลค่ายกเว้นภาษี</span>
                  <strong>{{ formatCurrency(selectedDoc.total_except_vat || 0) }}</strong>
                </div>
                <div class="pu-tax-cell">
                  <span>ยอดสุทธิ</span>
                  <strong class="pu-tax-net">{{ formatCurrency(selectedDoc.total_amount || 0) }}</strong>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </Dialog>

    <Dialog
      v-model:visible="printDialogVisible"
      modal
      class="pu-print-dialog"
      :style="{ width: 'min(680px, 94vw)' }"
      header="ฟอร์มพิมพ์ PU"
    >
      <div class="print-dialog-body">
        <div class="print-doc-no">{{ printDocNo }}</div>
        <Message severity="info" :closable="false" class="print-note">
          เลือกฟอร์มที่ต้องการพิมพ์
        </Message>
        <Message v-if="printError" severity="warn" :closable="false">{{ printError }}</Message>
        <div v-if="printFormsLoading" class="detail-loading compact">
          <i class="pi pi-spin pi-spinner" />
          <span>กำลังโหลดฟอร์ม...</span>
        </div>
        <div v-else class="print-list">
          <label v-for="form in printForms" :key="form.formcode" class="print-row" :class="{ disabled: !form.available }">
            <Checkbox
              v-model="selectedPrintForms"
              :input-id="`pu-print-form-${form.formcode}`"
              :value="form.formcode"
              :disabled="!form.available"
            />
            <span>
              <strong>{{ form.formname }}</strong>
              <small>{{ form.formcode }}<template v-if="form.is_default"> · ค่าเริ่มต้น</template><template v-if="!form.available"> · ไม่พบใน formdesign</template></small>
            </span>
          </label>
          <span v-if="!printForms.length && !printError" class="muted">ไม่มีฟอร์มพิมพ์</span>
        </div>
      </div>
      <template #footer>
        <Button label="ปิด" severity="secondary" outlined @click="printDialogVisible = false" />
        <Button icon="pi pi-print" label="พิมพ์" :disabled="printFormsLoading || !selectedPrintForms.length" @click="confirmPrintForms" />
      </template>
    </Dialog>

    <Dialog
      v-model:visible="editorVisible"
      modal
      class="pu-editor-dialog"
      :style="{ width: 'min(1180px, 98vw)' }"
      :header="editorMode === 'create' ? 'สร้าง PU' : `แก้ไข PU ${draft.doc_no}`"
    >
      <div class="editor-body">
        <div class="editor-grid">
          <label class="field">
            <span>รหัสเอกสาร</span>
            <Select
              v-model="draft.doc_format_code"
              :options="docFormatOptions"
              option-label="label"
              option-value="code"
              class="w-full"
              :disabled="editorMode === 'update'"
              @change="loadNextDocNo"
            />
          </label>
          <label v-if="editorMode === 'create'" class="field">
            <span>เลขที่เอกสาร</span>
            <InputText :model-value="nextDocLoading ? 'กำลังโหลด...' : (draft.doc_no || '-')" disabled />
          </label>
          <label class="field">
            <span>วันที่เอกสาร</span>
            <IsoDatePicker v-model="draft.doc_date" @change="editorMode === 'create' && loadNextDocNo()" />
          </label>
          <label class="field">
            <span>เวลา</span>
            <InputText v-model="draft.doc_time" type="time" />
          </label>
          <label class="field">
            <span>เจ้าหนี้</span>
            <InputText v-model.trim="draft.cust_code" placeholder="รหัสเจ้าหนี้" />
          </label>
          <label class="field">
            <span>ใบกำกับภาษี</span>
            <InputText v-model.trim="draft.tax_doc_no" />
          </label>
          <label class="field">
            <span>วันที่ใบกำกับ</span>
            <IsoDatePicker v-model="draft.tax_doc_date" />
          </label>
          <label class="field">
            <span>ประเภทภาษี</span>
            <Select
              v-model="draft.tax_type"
              :options="[
                { label: 'รวม VAT', value: 1 },
                { label: 'แยก VAT', value: 0 },
              ]"
              option-label="label"
              option-value="value"
              @change="recalcDraftTotals"
            />
          </label>
          <label class="field">
            <span>คลัง</span>
            <InputText v-model.trim="draft.wh_from" />
          </label>
          <label class="field">
            <span>ที่เก็บ</span>
            <InputText v-model.trim="draft.location_from" />
          </label>
          <label class="field wide">
            <span>หมายเหตุ</span>
            <InputText v-model.trim="draft.remark" />
          </label>
        </div>

        <div class="pick-panels">
          <section class="pick-panel">
            <div class="pick-title">
              <strong>เจ้าหนี้</strong>
              <span v-if="draft.cust_name">{{ draft.cust_code }} · {{ draft.cust_name }}</span>
            </div>
            <div class="pick-search">
              <InputText v-model.trim="supplierSearch" placeholder="ค้นหารหัส/ชื่อเจ้าหนี้" @keyup.enter="searchSuppliers" />
              <Button icon="pi pi-search" severity="secondary" outlined :loading="supplierLoading" @click="searchSuppliers" />
            </div>
            <div v-if="supplierOptions.length" class="pick-list">
              <button v-for="supplier in supplierOptions" :key="supplier.code" class="pick-row" @click="selectSupplier(supplier)">
                <strong>{{ supplier.code }}</strong>
                <span>{{ supplier.name }}</span>
              </button>
            </div>
          </section>

          <section class="pick-panel">
            <div class="pick-title">
              <strong>PO รอรับ</strong>
              <span v-if="draft.po_refs.length">{{ draftPoRefText }}</span>
            </div>
            <div class="pick-search">
              <InputText v-model.trim="poSearch" placeholder="ค้นหา PO / เจ้าหนี้" @keyup.enter="searchPOWait" />
              <Button icon="pi pi-search" severity="secondary" outlined :loading="poWaitLoading" @click="searchPOWait" />
            </div>
            <div v-if="poWaitRows.length" class="po-wait-list">
              <button v-for="po in poWaitRows" :key="po.doc_no" class="po-wait-row" @click="addPOToDraft(po)">
                <span>
                  <strong>{{ po.doc_no }}</strong>
                  <small>{{ formatDate(po.doc_date) }} · {{ po.cust_code }} {{ po.cust_name || '' }}</small>
                </span>
                <strong>{{ formatCurrency(po.total_amount || 0) }}</strong>
              </button>
            </div>
          </section>
        </div>

        <div class="item-toolbar">
          <strong>รายการสินค้า</strong>
          <Button icon="pi pi-plus" label="เพิ่มรายการ" size="small" severity="secondary" outlined @click="addDraftItem" />
        </div>
        <div class="editor-table-wrap">
          <table class="editor-table">
            <thead>
              <tr>
                <th>PO</th>
                <th>สินค้า</th>
                <th>ชื่อสินค้า</th>
                <th>หน่วย</th>
                <th>คลัง</th>
                <th>ที่เก็บ</th>
                <th class="num">คงเหลือ PO</th>
                <th class="num">จำนวน</th>
                <th class="num">ราคา</th>
                <th class="num">ส่วนลด</th>
                <th class="num">รวม</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, index) in draft.items" :key="index">
                <td><InputText v-model.trim="item.ref_doc_no" class="cell-input po-input" disabled /></td>
                <td><InputText v-model.trim="item.item_code" class="cell-input" /></td>
                <td><InputText v-model.trim="item.item_name" class="cell-input name-input" /></td>
                <td><InputText v-model.trim="item.unit_code" class="cell-input unit-input" /></td>
                <td><InputText v-model.trim="item.wh_code" class="cell-input unit-input" /></td>
                <td><InputText v-model.trim="item.shelf_code" class="cell-input unit-input" /></td>
                <td class="num">{{ item.balance_qty ? formatNumber(item.balance_qty) : '-' }}</td>
                <td><InputText v-model="item.qty" type="number" min="0" step="0.01" class="cell-input num-input" @input="recalcDraftTotals" /></td>
                <td><InputText v-model="item.price" type="number" min="0" step="0.01" class="cell-input num-input" @input="recalcDraftTotals" /></td>
                <td><InputText v-model.trim="item.discount" class="cell-input num-input" placeholder="0 หรือ %" @input="recalcDraftTotals" /></td>
                <td class="num">{{ formatCurrency(item.sum_amount || 0) }}</td>
                <td>
                  <Button icon="pi pi-trash" text rounded severity="danger" aria-label="ลบรายการ" @click="removeDraftItem(index)" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="purchase-summary-block">
          <div class="pu-sum-row">
            <span class="pu-sum-label">ยอดรวมสินค้า</span>
            <span class="pu-sum-value">{{ formatCurrency(draftTotals.total_value) }}</span>
          </div>
          <div class="pu-summary-divider" />
          <div class="pu-sum-row pu-net-row">
            <span class="pu-net-label">ยอดสุทธิ</span>
            <span class="pu-net-value">{{ formatCurrency(draftTotals.total_amount) }}</span>
          </div>
          <button type="button" class="pu-tax-toggle" @click="purchaseTaxDetailVisible = !purchaseTaxDetailVisible">
            <i class="pi pi-receipt" />
            {{ purchaseTaxDetailVisible ? 'ซ่อนรายละเอียดภาษี' : 'รายละเอียดภาษี' }}
            <i :class="purchaseTaxDetailVisible ? 'pi pi-chevron-up' : 'pi pi-chevron-down'" />
          </button>
          <div v-if="purchaseTaxDetailVisible" class="pu-tax-detail">
            <div class="pu-tax-grid">
              <div class="pu-tax-cell">
                <span>ประเภทภาษี</span>
                <strong>{{ taxTypeShortLabel(draft.tax_type) }}</strong>
              </div>
              <div class="pu-tax-cell">
                <span>อัตราภาษี</span>
                <strong>{{ formatVatRate(draft.vat_rate) }}%</strong>
              </div>
              <div class="pu-tax-cell">
                <span>ยอดก่อนภาษี</span>
                <strong>{{ formatCurrency(draftTotals.total_before_vat) }}</strong>
              </div>
              <div class="pu-tax-cell">
                <span>{{ vatSummaryLabel(draft.tax_type, draft.vat_rate) }}</span>
                <strong>{{ draftTotals.total_vat_value > 0 ? formatCurrency(draftTotals.total_vat_value) : '-' }}</strong>
              </div>
              <div v-if="draftTotals.total_except_vat > 0" class="pu-tax-cell">
                <span>มูลค่ายกเว้นภาษี</span>
                <strong>{{ formatCurrency(draftTotals.total_except_vat) }}</strong>
              </div>
              <div class="pu-tax-cell">
                <span>ยอดสุทธิ</span>
                <strong class="pu-tax-net">{{ formatCurrency(draftTotals.total_amount) }}</strong>
              </div>
            </div>
          </div>
        </div>

      </div>

      <template #footer>
        <Button label="ปิด" severity="secondary" outlined @click="editorVisible = false" />
        <Button icon="pi pi-save" :label="saveButtonLabel" :loading="editorSaving" :disabled="!canSaveDraft" @click="saveDraft" />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.purchase-pu-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem 0.5rem;
}

.purchase-pu-editor-page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.5rem 0.25rem 1rem;
  overflow: auto;
}

.ipad-action-bar {
  display: none;
}

.editor-page-header {
  position: sticky;
  top: 0;
  z-index: 5;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.75rem;
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
  background: var(--p-surface-0);
  padding: 0.65rem;
}

.editor-page-title {
  min-width: 0;
}

.editor-page-title h1 {
  margin: 0;
  font-size: 1.15rem;
}

.editor-page-title span {
  color: var(--p-text-color-secondary);
  font-size: 0.85rem;
}

.editor-page-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.editor-page-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.75rem;
  align-items: start;
  width: 100%;
}

.editor-document {
  display: flex;
  min-width: 0;
  width: 100%;
  flex-direction: column;
  gap: 1rem;
}

.editor-section,
.editor-side {
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
  background: var(--p-surface-0);
  padding: 0.75rem;
}

.editor-side {
  order: 0;
  position: static;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.page-header,
.filter-bar {
  flex-shrink: 0;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.header-actions,
.item-toolbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.page-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
}

.page-subtitle {
  margin: 0.25rem 0 0;
  color: var(--p-text-color-secondary);
  font-size: 0.9rem;
}

.filter-bar,
.print-panel {
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
  background: var(--p-surface-0);
  padding: 0.875rem;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 700;
  margin-bottom: 0.75rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.85rem;
  color: var(--p-text-color-secondary);
}

.muted {
  color: var(--p-text-color-secondary);
  font-size: 0.82rem;
}

.filter-bar {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) 150px 150px auto auto;
  gap: 0.75rem;
  align-items: center;
}

.pu-table {
  flex: 1;
  min-height: 360px;
}

.supplier-cell {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.supplier-cell span {
  color: var(--p-text-color-secondary);
  font-size: 0.82rem;
}

.row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.1rem;
}

.detail-loading {
  min-height: 220px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  color: var(--p-text-color-secondary);
}

.detail-dialog-header {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding-right: 0.5rem;
  font-size: 1.18rem;
  font-weight: 800;
}

.detail-body {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.detail-section {
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
  background: var(--p-surface-0);
  padding: 0.6rem;
}

.detail-field-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.45rem;
}

.detail-field-grid > div {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.4rem;
  align-items: baseline;
  border: 1px solid var(--p-surface-border);
  border-radius: 6px;
  padding: 0.45rem 0.55rem;
  background: var(--p-surface-50);
  min-width: 0;
}

.detail-field-grid .wide {
  grid-column: span 2;
}

.detail-field-grid span {
  color: var(--p-text-color-secondary);
  font-size: 0.74rem;
  white-space: nowrap;
}

.detail-field-grid strong {
  font-size: 0.88rem;
  overflow-wrap: anywhere;
}

.amount {
  color: var(--p-primary-color);
}

.detail-pick-panels {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.6rem;
}

.detail-selected-box {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-height: 46px;
  border: 1px dashed var(--p-surface-border);
  border-radius: 6px;
  padding: 0.5rem 0.65rem;
  justify-content: center;
}

.detail-selected-box span {
  color: var(--p-text-color-secondary);
}

.detail-ref-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.detail-ref-chip {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  border: 1px solid var(--p-surface-border);
  border-radius: 999px;
  background: var(--p-surface-50);
  padding: 0.35rem 0.65rem;
}

.detail-ref-chip small {
  color: var(--p-text-color-secondary);
}

.print-panel {
  padding: 0.75rem;
}

.compact {
  margin-top: 0;
}

.editor-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.editor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.editor-grid .wide {
  grid-column: span 2;
}

.pick-panels {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.75rem;
}

.pick-panel {
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
  background: var(--p-surface-0);
  padding: 0.75rem;
  min-width: 0;
}

.compact-pick-panels {
  gap: 0.5rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.compact-pick-panel {
  padding: 0.55rem;
}

.compact-pick-panel .pick-title {
  margin-bottom: 0.4rem;
}

.compact-pick-panel .pick-title strong {
  font-size: 0.9rem;
}

.compact-pick-list {
  max-height: 112px;
  margin-top: 0.45rem;
}

.compact-pick-panel .pick-row,
.compact-pick-panel .po-wait-row {
  min-height: 48px;
  padding: 0.5rem 0.6rem;
}

.pick-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.6rem;
}

.pick-title span {
  color: var(--p-text-color-secondary);
  font-size: 0.82rem;
  overflow-wrap: anywhere;
  text-align: right;
}

.pick-search {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.5rem;
}

.pick-list,
.po-wait-list {
  display: grid;
  gap: 0.35rem;
  margin-top: 0.6rem;
  max-height: 190px;
  overflow: auto;
}

.pick-row,
.po-wait-row {
  width: 100%;
  border: 1px solid var(--p-surface-border);
  border-radius: 6px;
  background: var(--p-surface-50);
  color: var(--p-text-color);
  cursor: pointer;
  min-height: 48px;
  padding: 0.55rem 0.65rem;
  text-align: left;
}

.pick-hint,
.product-entry-hint {
  margin-top: 0.45rem;
  color: var(--p-text-color-secondary);
  font-size: 0.82rem;
}

.product-entry-hint.warning {
  color: var(--p-blue-600);
  font-weight: 700;
}

.pick-row {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 0.5rem;
}

.selected-box {
  display: grid;
  gap: 0.15rem;
  min-height: 48px;
  border: 1px solid var(--p-surface-border);
  border-radius: 6px;
  background: var(--p-surface-50);
  padding: 0.55rem 0.65rem;
}

.selected-box.empty {
  border-style: dashed;
}

.selected-box span,
.selected-ref-row span {
  color: var(--p-text-color-secondary);
  font-size: 0.82rem;
  overflow-wrap: anywhere;
}

.selected-ref-list,
.supplier-dialog-body,
.supplier-result-list {
  display: grid;
  gap: 0.45rem;
}

.selected-ref-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.5rem;
  align-items: center;
  min-height: 44px;
  border: 1px solid var(--p-surface-border);
  border-radius: 6px;
  background: var(--p-surface-50);
  padding: 0.5rem 0.6rem;
}

.supplier-result-list {
  max-height: min(56dvh, 420px);
  overflow: auto;
}

.po-wait-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.po-wait-row span {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.15rem;
}

.ref-doc-body {
  display: grid;
  gap: 0.75rem;
}

.ref-doc-list {
  display: grid;
  gap: 0.45rem;
  max-height: min(58dvh, 520px);
  overflow: auto;
}

.ref-doc-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  border: 1px solid var(--p-surface-border);
  border-radius: 6px;
  background: var(--p-surface-50);
  color: var(--p-text-color);
  cursor: pointer;
  padding: 0.65rem 0.75rem;
  text-align: left;
}

.ref-doc-row.selected {
  border-color: var(--p-primary-color);
  background: color-mix(in srgb, var(--p-primary-color) 8%, var(--p-surface-0));
}

.ref-doc-row i {
  color: var(--p-primary-color);
}

.ref-doc-row span {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.15rem;
}

.po-wait-row small,
.pick-row span,
.ref-doc-row small {
  color: var(--p-text-color-secondary);
  overflow-wrap: anywhere;
}

.po-context-list {
  display: grid;
  gap: 0.5rem;
  margin-top: 0.65rem;
}

.po-context-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
  border: 1px solid var(--p-surface-border);
  border-radius: 6px;
  background: var(--p-surface-50);
  padding: 0.55rem;
}

.po-context-row div {
  min-width: 0;
}

.po-context-row span {
  display: block;
  color: var(--p-text-color-secondary);
  font-size: 0.75rem;
}

.po-context-row strong {
  display: block;
  font-size: 0.82rem;
  font-style: italic;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.pick-row:hover,
.po-wait-row:hover,
.ref-doc-row:hover {
  border-color: var(--p-primary-color);
}

.product-pick-panel {
  background: var(--p-surface-0);
}

.product-tools {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.5rem;
  align-items: center;
}

.product-action-buttons {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}

.product-action-buttons :deep(.p-button) {
  width: 100%;
  justify-content: center;
}

.product-result-list {
  display: grid;
  gap: 0.35rem;
  margin-top: 0.6rem;
  max-height: min(58dvh, 520px);
  overflow: auto;
}

.product-result-row {
  display: grid;
  grid-template-columns: 130px minmax(0, 1fr) 90px;
  gap: 0.5rem;
  align-items: center;
  border: 1px solid var(--p-surface-border);
  border-radius: 6px;
  background: var(--p-surface-50);
  color: var(--p-text-color);
  cursor: pointer;
  padding: 0.55rem 0.65rem;
  text-align: left;
}

.product-result-row span,
.product-result-row small {
  color: var(--p-text-color-secondary);
  overflow-wrap: anywhere;
}

.product-result-row:hover {
  border-color: var(--p-primary-color);
}

.product-search-dialog-body {
  display: grid;
  gap: 0.75rem;
}

.editor-table-wrap {
  overflow: auto;
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
}

.editor-table {
  width: 100%;
  min-width: 1120px;
  border-collapse: collapse;
}

.editor-table th,
.editor-table td {
  border-bottom: 1px solid var(--p-surface-border);
  padding: 0.45rem;
  vertical-align: middle;
}

.editor-table th {
  background: var(--p-surface-50);
  color: var(--p-text-color-secondary);
  font-size: 0.78rem;
  font-weight: 700;
  text-align: left;
}

.editor-table .num {
  text-align: right;
  white-space: nowrap;
}

.item-warning {
  color: var(--p-blue-600);
  font-size: 0.82rem;
  font-weight: 600;
}

.receive-row td {
  background: var(--p-surface-0);
}

.receive-row td:nth-child(2),
.receive-row td:nth-child(3) {
  font-weight: 700;
}

.pending-row td {
  background: color-mix(in srgb, var(--p-primary-color) 5%, var(--p-surface-0));
}

.pending-qty {
  color: var(--p-blue-600);
  font-weight: 700;
}

.pending-status {
  color: var(--p-text-color-secondary);
  font-size: 0.84rem;
}

.barcode-readonly {
  display: inline-block;
  min-width: 120px;
  max-width: 150px;
  overflow-wrap: anywhere;
  color: var(--p-text-color-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.cell-select {
  width: 150px;
}

.empty-lines {
  height: 84px;
  color: var(--p-text-color-secondary);
  text-align: center;
}

.cell-input {
  width: 128px;
}

.po-input {
  width: 118px;
}

.name-input {
  width: 220px;
}

.unit-input {
  width: 82px;
}

.num-input {
  width: 96px;
  text-align: right;
}

.purchase-summary-block {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
  background: var(--p-surface-0);
  padding: 0.75rem 1rem;
}

.pu-summary-divider {
  height: 1px;
  background: var(--p-surface-border);
  margin: 0.125rem 0;
}

.pu-sum-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.pu-sum-label {
  color: var(--p-text-color-secondary);
  font-size: 0.875rem;
}

.pu-sum-value {
  font-size: 0.9rem;
  font-weight: 500;
}

.pu-net-row {
  padding-top: 0.25rem;
}

.pu-net-label {
  font-size: 0.95rem;
  font-weight: 600;
}

.pu-net-value {
  color: var(--p-primary-color);
  font-size: 1.35rem;
  font-weight: 700;
}

.pu-tax-toggle {
  display: flex;
  align-items: center;
  align-self: flex-start;
  gap: 0.4rem;
  border: none;
  background: none;
  color: var(--p-text-color-secondary);
  cursor: pointer;
  font-family: inherit;
  font-size: 0.78rem;
  padding: 0.25rem 0;
}

.pu-tax-toggle:hover {
  color: var(--p-primary-color);
}

.pu-tax-toggle .pi {
  font-size: 0.72rem;
}

.pu-tax-detail {
  border-radius: 8px;
  background: var(--p-surface-ground);
  padding: 0.75rem;
}

.pu-tax-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem 1rem;
}

.pu-tax-cell {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.pu-tax-cell span {
  color: var(--p-text-color-secondary);
  font-size: 0.72rem;
}

.pu-tax-cell strong {
  font-size: 0.82rem;
  font-weight: 500;
}

.pu-tax-net {
  color: var(--p-primary-color);
  font-weight: 700;
}

.purchase-payment-step {
  display: flex;
  min-height: min(620px, calc(100dvh - 190px));
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
  background: var(--p-surface-0);
}

.summary-bar {
  display: flex;
  flex-shrink: 0;
  gap: 0.5rem;
  justify-content: space-between;
  border-bottom: 1px solid var(--p-surface-border);
  background: var(--p-surface-50);
  padding: 0.75rem 1rem;
}

.summary-item {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  min-width: 0;
}

.summary-label {
  color: var(--p-text-color-secondary);
  font-size: 0.72rem;
}

.summary-total,
.summary-paid,
.summary-remaining,
.summary-change {
  font-size: 1rem;
  font-weight: 700;
}

.summary-total {
  color: var(--p-primary-color);
}

.summary-paid,
.summary-change {
  color: #16a34a;
}

.summary-remaining {
  color: #dc2626;
}

.rounding-bar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 0.5rem;
  border-bottom: 1px solid var(--p-surface-border);
  padding: 0.5rem 1rem;
}

.rounding-label {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 0.35rem;
  color: var(--p-text-color-secondary);
  font-size: 0.83rem;
}

.rounding-input {
  flex: 1;
  max-width: 10rem;
  min-width: 0;
}

.rounding-fill-btn,
.fill-remaining-btn {
  border: 1px dashed var(--p-primary-color);
  border-radius: 6px;
  background: transparent;
  color: var(--p-primary-color);
  cursor: pointer;
  font-family: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  padding: 0.25rem 0.625rem;
  white-space: nowrap;
}

.entries-section {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0.5rem 1rem;
}

.entries-empty {
  color: var(--p-text-color-secondary);
  font-size: 0.85rem;
  padding: 1.5rem 0;
  text-align: center;
}

.entries-list,
.type-form {
  display: flex;
  flex-direction: column;
}

.entries-list {
  gap: 0.4rem;
}

.entry-row {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  border-radius: 8px;
  background: var(--p-surface-50);
  padding: 0.5rem 0.75rem;
}

.entry-icon-wrap {
  display: flex;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--p-surface-200, #e2e8f0);
}

.entry-info {
  flex: 1;
  min-width: 0;
}

.entry-label {
  font-size: 0.875rem;
  font-weight: 600;
}

.entry-sub {
  color: var(--p-text-color-secondary);
  font-size: 0.72rem;
}

.entry-amount {
  flex-shrink: 0;
  color: var(--p-primary-color);
  font-weight: 700;
}

.add-payment-panel {
  flex-shrink: 0;
  border-top: 1px solid var(--p-surface-border);
  background: var(--p-surface-0);
}

.type-tabs {
  display: flex;
  border-bottom: 1px solid var(--p-surface-border);
}

.type-tab {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--p-text-color-secondary);
  cursor: pointer;
  font-family: inherit;
  font-size: 0.83rem;
  padding: 0.625rem 0.5rem;
}

.type-tab-active {
  border-bottom-color: var(--p-primary-color);
  color: var(--p-primary-color);
  font-weight: 700;
}

.type-form {
  gap: 0.6rem;
  padding: 0.75rem 1rem;
}

.form-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.form-label {
  flex-shrink: 0;
  width: 6rem;
  color: var(--p-text-color-secondary);
  font-size: 0.83rem;
}

.form-input {
  flex: 1;
  min-width: 0;
}

.add-btn {
  align-self: flex-end;
}

.payment-panel {
  display: grid;
  gap: 0.75rem;
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
  background: var(--p-surface-0);
  padding: 0.75rem;
}

.payment-head,
.payment-entry-row,
.payment-tabs {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.payment-head {
  justify-content: space-between;
}

.payment-head span {
  color: var(--p-primary-color);
  font-size: 0.85rem;
  font-weight: 700;
}

.payment-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.45rem;
}

.payment-metrics div {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  border: 1px solid var(--p-surface-border);
  border-radius: 6px;
  background: var(--p-surface-50);
  padding: 0.5rem;
}

.payment-metrics span,
.payment-empty {
  color: var(--p-text-color-secondary);
  font-size: 0.78rem;
}

.payment-metrics strong {
  text-align: right;
  font-size: 0.9rem;
}

.payment-entries {
  display: grid;
  gap: 0.4rem;
}

.payment-empty {
  padding: 0.5rem;
  text-align: center;
}

.payment-entry-row {
  border: 1px solid var(--p-surface-border);
  border-radius: 6px;
  background: var(--p-surface-50);
  padding: 0.35rem 0.45rem;
}

.payment-entry-row span {
  flex: 1;
  min-width: 0;
}

.payment-tabs {
  border-bottom: 1px solid var(--p-surface-border);
}

.payment-tabs button {
  flex: 1;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--p-text-color-secondary);
  cursor: pointer;
  padding: 0.55rem 0.25rem;
}

.payment-tabs button.active {
  border-color: var(--p-primary-color);
  color: var(--p-primary-color);
  font-weight: 700;
}

.payment-tabs i {
  margin-right: 0.35rem;
}

.payment-form {
  display: grid;
  gap: 0.55rem;
}

.denom-row {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.denom-btn {
  border: 1px solid var(--p-surface-border);
  border-radius: 6px;
  background: var(--p-surface-50);
  color: var(--p-text-color);
  cursor: pointer;
  padding: 0.4rem 0.55rem;
  font-weight: 700;
}

.denom-btn.exact {
  border-style: dashed;
  color: var(--p-primary-color);
}

.print-note {
  margin-bottom: 0.75rem;
}

.print-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.print-doc-no {
  font-size: 1.1rem;
  font-weight: 800;
}

.print-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.5rem;
}

.print-row {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
  padding: 0.65rem;
}

.print-row i {
  color: var(--p-green-500);
}

.print-row.disabled {
  opacity: 0.65;
}

.print-row.disabled i {
  color: var(--p-red-500);
}

.print-row > div,
.print-row > span {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.print-row small {
  color: var(--p-text-color-secondary);
  overflow-wrap: anywhere;
}

:deep(.col-num) {
  text-align: right;
}

@media (min-width: 900px) {
  .purchase-pu-editor-page {
    padding: 0.75rem 0.5rem 1rem;
  }

  .editor-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .pick-panels {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .product-tools {
    grid-template-columns: minmax(260px, 1fr) minmax(180px, 280px) minmax(230px, auto);
  }
}

@media (min-width: 1181px) {
  .editor-page-layout {
    grid-template-columns: minmax(0, 1fr);
    gap: 1rem;
  }

  .editor-page-layout.has-side {
    grid-template-columns: minmax(0, 1fr) minmax(260px, 320px);
  }

  .editor-side {
    order: 0;
    position: sticky;
    top: 86px;
  }

  .editor-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (max-width: 1180px) {
  .purchase-pu-editor-page {
    padding-bottom: 1rem;
  }

  .editor-page-actions {
    display: none;
  }

  .ipad-action-bar {
    display: grid;
    grid-template-columns: minmax(150px, 1fr) auto;
    gap: 0.5rem;
    align-items: center;
    margin-top: 0.25rem;
    border: 1px solid var(--p-surface-border);
    border-radius: 8px;
    background: var(--p-surface-0);
    padding: 0.55rem;
  }

  .ipad-action-total {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.1rem;
  }

  .ipad-action-total span,
  .ipad-action-total small {
    color: var(--p-text-color-secondary);
    font-size: 0.76rem;
  }

  .ipad-action-total strong {
    color: var(--p-primary-color);
    font-size: 1.08rem;
    line-height: 1.15;
  }
}

@media (max-width: 900px) {
  .page-header,
  .filter-bar,
  .editor-page-layout {
    grid-template-columns: 1fr;
  }

  .detail-field-grid,
  .detail-pick-panels {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .page-header {
    display: grid;
  }

  .editor-page-header {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .editor-page-actions {
    grid-column: 1 / -1;
    justify-content: stretch;
  }

  .editor-page-actions :deep(.p-button) {
    flex: 1;
  }

  .detail-field-grid .wide {
    grid-column: span 2;
  }

  .editor-grid .wide {
    grid-column: auto;
  }

}

@media (max-width: 640px) {
  .detail-field-grid,
  .detail-pick-panels {
    grid-template-columns: 1fr;
  }

  .detail-field-grid .wide {
    grid-column: auto;
  }

  .detail-field-grid > div {
    grid-template-columns: 1fr;
    gap: 0.15rem;
  }
}

@media (max-width: 640px) {
  .compact-pick-panels {
    grid-template-columns: 1fr;
  }

  .ipad-action-bar {
    grid-template-columns: 1fr 1fr;
  }

  .ipad-action-total {
    grid-column: 1 / -1;
  }

  .ipad-action-bar :deep(.p-button) {
    width: 100%;
  }

  .pu-tax-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 767px) {
  .purchase-pu-view {
    padding: 0.75rem 0.25rem;
  }

  .page-title {
    font-size: 1.25rem;
  }
}
</style>
