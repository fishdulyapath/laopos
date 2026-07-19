<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'
import SelectButton from 'primevue/selectbutton'
import Skeleton from 'primevue/skeleton'
import Textarea from 'primevue/textarea'
import { useToast } from 'primevue/usetoast'
import api from '@/services/api'
import { getItemReservedQty } from '@/services/basketService'
import { getCustomerList, getProductByBarcodeDetail, getProductDetail, getProductList, getProductPrice } from '@/services/sellService'
import { useAuthStore } from '@/stores/auth'
import { useCartStore } from '@/stores/cart'
import { usePosStore } from '@/stores/pos'
import { calcAfterDiscount, calcDiscountAmount } from '@/utils/discount'
import { formatCurrency } from '@/utils/formatters'
import { productImageUrl } from '@/utils/imageUrls'
import ProductDetailSheet from './ProductDetailSheet.vue'

const props = defineProps({
  basket: { type: Object, required: true },
  orderData: { type: Object, default: null },
})
const emit = defineEmits(['back', 'confirm'])

const toast = useToast()
const authStore = useAuthStore()
const cartStore = useCartStore()
const posStore = usePosStore()

const cartKey = computed(() => `BASKET-${props.basket.basket_id}`)

const inquiryTypeOptions = [
  { label: 'ขายเชื่อ', value: 0 },
  { label: 'ขายสด', value: 1 },
  { label: 'เชื่อ(บริการ)', value: 2 },
  { label: 'สด(บริการ)', value: 3 },
]

const vatTypeOptions = [
  { label: 'แยกนอก', value: 0 },
  { label: 'รวมใน', value: 1 },
  { label: 'ไม่กระทบ', value: 2 },
  { label: 'ศูนย์', value: 3 },
]

const initialInfo = computed(() => props.orderData || props.basket || {})
const custCode = ref('')
const custName = ref('ลูกค้าทั่วไป')
const inquiryType = ref(1)
const vatType = ref(1)
const vatRate = ref(7)
const saleCode = ref('')
const saleName = ref('')
const saleName2 = ref('')
const orderRemark = ref('')
const discountWord = ref('')

const custEditing = ref(false)
const custSearch = ref('')
const custResults = ref([])
const custLoading = ref(false)
const showCustDropdown = ref(false)
let custDebounce = null

const saleEditing = ref(false)
const saleSearch = ref('')
const saleResults = ref([])
const saleLoading = ref(false)
const showSaleDropdown = ref(false)
let saleDebounce = null

function employeePrimaryName(employee = {}) {
  return String(employee.name_1 ?? employee.name ?? employee.user_name ?? '').trim()
}

function employeeName2(employee = {}) {
  return String(employee.name_2 ?? employee.user_name_2 ?? '').trim()
}

function employeeDisplayLabel(employee = {}) {
  const name1 = employeePrimaryName(employee)
  const name2 = employeeName2(employee)
  return [name1, name2].filter(Boolean).join(' | ')
}

const saleDisplayName = computed(() => [saleName.value, saleName2.value].filter(Boolean).join(' | '))

const productSearch = ref('')
const barcodeInput = ref('')
const barcodeRef = ref(null)
const productResults = ref([])
const productLoading = ref(false)
const barcodeAdding = ref(false)
const productDialogVisible = ref(false)
const detailProduct = ref(null)
const detailVisible = ref(false)

const freshPrices = ref({})
const priceLoading = ref(false)
const showTaxDetail = ref(false)
const showZeroPriceDialog = ref(false)
const updating = ref({})
const errorMsg = ref('')
let qtyTimers = {}

function hydrateFromInfo() {
  const info = initialInfo.value
  custCode.value = info.cust_code || ''
  custName.value = info.cust_name || 'ลูกค้าทั่วไป'
  inquiryType.value = Number(info.inquiry_type ?? 1)
  vatType.value = Number(info.vat_type ?? 1)
  vatRate.value = Number(info.vat_rate ?? 7)
  saleCode.value = info.sale_code || authStore.employee?.user_code || ''
  saleName.value = info.sale_name || employeePrimaryName(authStore.employee)
  saleName2.value = info.sale_name ? '' : employeeName2(authStore.employee)
  orderRemark.value = info.order_remark || ''
  discountWord.value = info.discount_word || ''
}

onMounted(async () => {
  hydrateFromInfo()
  await cartStore.fetchCart(cartKey.value)
  await nextTick()
  barcodeRef.value?.$el?.querySelector?.('input')?.focus?.()
})

const rows = computed(() =>
  cartStore.items.map((item) => ({
    ...item,
    fresh: freshPrices.value[item.guid_code],
  })),
)

const priceOpts = computed(() => ({
  sale_type: inquiryType.value,
  vat_type: vatType.value,
  vat_rate: vatRate.value,
}))

function rnd(value, point = 2) {
  const f = 10 ** point
  return Math.round((Number(value) || 0) * f) / f
}

function imageUrl(itemCode) {
  return productImageUrl(itemCode)
}

function onImgError(event) {
  event.target.style.display = 'none'
  event.target.nextElementSibling?.style.setProperty('display', 'flex')
}

function priceSignature(item) {
  return [
    item.item_code,
    item.unit_code,
    item.qty,
    custCode.value,
    inquiryType.value,
    vatType.value,
    vatRate.value,
  ].join('|')
}

async function refreshPrices() {
  if (!cartStore.items.length) {
    freshPrices.value = {}
    return
  }
  priceLoading.value = true
  try {
    const nextPrices = { ...freshPrices.value }
    await Promise.all(cartStore.items.map(async (item) => {
      const signature = priceSignature(item)
      if (nextPrices[item.guid_code]?.signature === signature) return
      nextPrices[item.guid_code] = { price: null, list_price: null, default_discount: '', loading: true, success: false, signature }
      try {
        const result = await getProductPrice(item.item_code, item.unit_code, custCode.value, String(item.qty), priceOpts.value)
        nextPrices[item.guid_code] = {
          price: Number(result?.price ?? 0),
          list_price: Number(result?.price1 ?? result?.price ?? 0),
          default_discount: result?.defaultDiscount ?? '',
          loading: false,
          success: true,
          signature,
        }
      } catch {
        nextPrices[item.guid_code] = {
          price: 0,
          list_price: 0,
          default_discount: '',
          loading: false,
          success: false,
          signature,
        }
      }
    }))
    const activeGuids = new Set(cartStore.items.map((item) => item.guid_code))
    Object.keys(nextPrices).forEach((guid) => {
      if (!activeGuids.has(guid)) delete nextPrices[guid]
    })
    freshPrices.value = nextPrices
  } finally {
    priceLoading.value = false
  }
}

watch(
  () => cartStore.items.map((item) => `${item.guid_code}:${item.item_code}:${item.unit_code}:${item.qty}`).join(','),
  () => { void refreshPrices() },
  { immediate: true },
)

watch([custCode, inquiryType, vatType, vatRate], () => {
  freshPrices.value = {}
  void refreshPrices()
})

function itemNet(row) {
  const fresh = row.fresh
  if (!fresh || !fresh.success) return 0
  return calcDiscountAmount(Number(fresh.price ?? 0), Number(row.qty), fresh.default_discount).sum_amount
}

const fetchErrorItems = computed(() => rows.value.filter((row) => row.fresh && !row.fresh.loading && !row.fresh.success))
const zeroPriceItems = computed(() => rows.value.filter((row) => row.fresh?.success && Number(row.fresh.price) === 0))
const totalValueVat = computed(() =>
  rows.value.reduce((sum, row) => Number(row.tax_type) === 1 ? sum : sum + itemNet(row), 0),
)
const totalValueNoVat = computed(() =>
  rows.value.reduce((sum, row) => Number(row.tax_type) === 1 ? sum + itemNet(row) : sum, 0),
)

function vatCalc(totalVat, totalNoVat, discWord, rate, type, discountType = 0, discountVatType = 0, amountPoint = 2) {
  const p = amountPoint
  const totalValue = totalVat + totalNoVat
  const afterDiscount = calcAfterDiscount(discWord, totalValue, p)
  const totalDiscount = rnd(totalValue - afterDiscount, p)

  let beforeVat = 0
  let vatValue = 0
  let afterVat = 0
  let totalAmount = 0
  let totalExceptVat = totalNoVat
  let discountNoVatAmount = 0

  switch (Number(type)) {
    case 0:
      if (Number(discountType) === 1) {
        if (Number(discountVatType) === 1) {
          const vatDiscount = totalValue > 0 ? rnd(totalDiscount * (totalVat / totalValue), p) : 0
          discountNoVatAmount = totalDiscount - vatDiscount
          beforeVat = totalVat - vatDiscount
        } else if (totalVat < totalDiscount) {
          beforeVat = 0
          discountNoVatAmount = totalDiscount - totalVat
        } else {
          beforeVat = totalVat - totalDiscount
        }
        vatValue = totalVat < totalDiscount && Number(discountVatType) !== 1 ? 0 : rnd(beforeVat * (rate / 100), p)
        afterVat = beforeVat + vatValue
        totalExceptVat -= discountNoVatAmount
        totalAmount = totalExceptVat + afterVat
      } else {
        beforeVat = totalVat
        vatValue = rnd(beforeVat * (rate / 100), p)
        afterVat = beforeVat + vatValue
        totalAmount = beforeVat + totalExceptVat + vatValue - totalDiscount
      }
      break
    case 1:
      totalAmount = totalValue - totalDiscount
      if (Number(discountType) === 1) {
        if (Number(discountVatType) === 1) {
          const vatDiscount = totalValue > 0 ? rnd(totalDiscount * (totalVat / totalValue), p) : 0
          discountNoVatAmount = totalDiscount - vatDiscount
          const base = totalVat - vatDiscount
          beforeVat = rnd((base * 100) / (100 + rate), p)
          vatValue = rnd(base - beforeVat, p)
        } else if (totalVat < totalDiscount) {
          beforeVat = 0
          vatValue = 0
          discountNoVatAmount = totalDiscount - totalVat
        } else {
          const base = totalVat - totalDiscount
          beforeVat = rnd((base * 100) / (100 + rate), p)
          vatValue = rnd(base - beforeVat, p)
        }
        afterVat = beforeVat + vatValue
        totalExceptVat -= discountNoVatAmount
      } else {
        beforeVat = rnd((totalVat * 100) / (100 + rate), p)
        vatValue = rnd(totalVat - beforeVat, p)
        afterVat = beforeVat + vatValue
      }
      break
    default:
      vatValue = 0
      if (Number(discountVatType) === 1 && totalValue > 0) {
        const vatDiscount = rnd(totalDiscount * (totalVat / totalValue), p)
        discountNoVatAmount = totalDiscount - vatDiscount
      }
      totalExceptVat -= discountNoVatAmount
      totalAmount = totalValue - totalDiscount
      break
  }

  return {
    totalValue: rnd(totalValue, p),
    totalDiscount: rnd(totalDiscount, p),
    beforeVat: rnd(beforeVat, p),
    vatValue: rnd(vatValue, p),
    afterVat: rnd(afterVat, p),
    totalExceptVat: rnd(totalExceptVat, p),
    totalAmount: rnd(totalAmount, p),
  }
}

const calcResult = computed(() =>
  vatCalc(totalValueVat.value, totalValueNoVat.value, discountWord.value, Number(vatRate.value || 7), vatType.value, Number(posStore.erpOption?.discout_type ?? 0)),
)

const invalidVatRate = computed(() => {
  const rate = Number(vatRate.value)
  return !Number.isFinite(rate) || rate < 0
})

const invalidBillDiscount = computed(() =>
  calcResult.value.totalValue > 0 && calcResult.value.totalAmount < 0,
)

const validationMessages = computed(() => {
  const messages = []
  if (!cartStore.items.length) messages.push('ยังไม่มีสินค้าในเอกสาร')
  if (priceLoading.value) messages.push('กำลังตรวจสอบราคา')
  if (fetchErrorItems.value.length) messages.push('มีสินค้าที่ดึงราคาไม่ได้')
  if (invalidVatRate.value) messages.push('อัตราภาษีไม่ถูกต้อง')
  if (invalidBillDiscount.value) messages.push('ส่วนลดท้ายบิลมากกว่ายอดสินค้า')
  if (!String(saleCode.value || '').trim()) messages.push('ยังไม่ได้เลือกพนักงานขาย')
  return messages
})

const canConfirm = computed(() =>
  validationMessages.value.length === 0,
)

function taxTypeLabel(value) {
  return vatTypeOptions.find((option) => Number(option.value) === Number(value))?.label || '-'
}

function selectWalkIn() {
  custCode.value = ''
  custName.value = 'ลูกค้าทั่วไป'
  custSearch.value = ''
  showCustDropdown.value = false
  custEditing.value = false
}

function onCustSearchInput(value) {
  clearTimeout(custDebounce)
  const text = String(value || '').trim()
  if (!text) {
    custResults.value = []
    showCustDropdown.value = false
    return
  }
  custDebounce = setTimeout(async () => {
    custLoading.value = true
    try {
      custResults.value = await getCustomerList(text)
      showCustDropdown.value = custResults.value.length > 0
    } finally {
      custLoading.value = false
    }
  }, 250)
}

function selectCustomer(customer) {
  custCode.value = customer.code
  custName.value = customer.name
  custSearch.value = ''
  showCustDropdown.value = false
  custEditing.value = false
}

function onSaleSearchInput(value) {
  clearTimeout(saleDebounce)
  const text = String(value || '').trim()
  if (!text) {
    saleResults.value = []
    showSaleDropdown.value = false
    return
  }
  saleDebounce = setTimeout(async () => {
    saleLoading.value = true
    try {
      const { data } = await api.get('/getEmployeeList', { params: { search: text } })
      saleResults.value = data.data || []
      showSaleDropdown.value = saleResults.value.length > 0
    } finally {
      saleLoading.value = false
    }
  }, 250)
}

function selectEmployee(employee) {
  saleCode.value = employee.code
  saleName.value = employeePrimaryName(employee)
  saleName2.value = employeeName2(employee)
  saleSearch.value = ''
  showSaleDropdown.value = false
  saleEditing.value = false
}

async function searchProducts({ openDialog = true } = {}) {
  const query = productSearch.value.trim()
  if (!query) return
  productLoading.value = true
  errorMsg.value = ''
  try {
    const rows = await getProductList({
      cust_code: custCode.value,
      search: query,
      isstock: '1',
      offset: 0,
      limit: 25,
    })
    productResults.value = rows
    productDialogVisible.value = openDialog
    if (!rows.length) errorMsg.value = 'ไม่พบสินค้า'
  } catch (error) {
    errorMsg.value = error.message || 'ค้นหาสินค้าไม่สำเร็จ'
  } finally {
    productLoading.value = false
  }
}

function isServiceItem(product) {
  return String(product?.item_type ?? '') === '1'
}

function unitRatio(unit) {
  return Math.max(1, Number(unit?.ratio) || 1)
}

function unitBaseBalance(unit, ratio = unitRatio(unit)) {
  return Number(unit?.sum_balance_qty ?? (Number(unit?.balance_qty ?? 0) * ratio))
}

function stockControlEnabled() {
  const value = posStore.erpOption?.ic_stock_control
  if (value === undefined || value === null || value === '') return false
  return ['1', 'true', 't', 'yes', 'y'].includes(String(value).toLowerCase())
}

async function loadComparableUnit(row) {
  if (row.sum_balance_qty != null || row.balance_qty != null) return row
  const units = await getProductDetail(row.item_code, custCode.value, priceOpts.value)
  return units.find((unit) => unit.unit_code === row.unit_code) || row
}

async function assertCanAddStock(product, unit, qty) {
  if (!stockControlEnabled()) return
  if (isServiceItem(unit) || isServiceItem(product)) return
  const ratio = unitRatio(unit)
  const balanceBase = unitBaseBalance(unit, ratio)
  const reservedBase = await getItemReservedQty(unit.item_code)
  const availableBase = Math.max(0, balanceBase - reservedBase)
  const requestedBase = qty * ratio
  const availableQty = Math.floor(availableBase / ratio)
  if (availableBase <= 0 || String(product.sold_out ?? '') === '1') {
    throw new Error(`${product.item_name} ไม่มีสต็อกสำหรับขาย`)
  }
  if (requestedBase > availableBase) {
    throw new Error(`${product.item_name} คงเหลือ ${availableQty} ${unit.unit_code}`)
  }
}

async function assertCanSetLineQty(item, nextQty) {
  if (!stockControlEnabled()) return
  if (nextQty <= 0 || isServiceItem(item)) return
  const unit = await loadComparableUnit(item)
  const ratio = unitRatio(unit)
  const balanceBase = unitBaseBalance(unit, ratio)
  const reservedBase = await getItemReservedQty(item.item_code)
  const currentCartBase = cartStore.totalCartBaseUnits(item.item_code)
  const currentLineBase = Number(item.qty) * ratio
  const otherCartBase = Math.max(0, currentCartBase - currentLineBase)
  const availableBase = Math.max(0, balanceBase - reservedBase + currentCartBase)
  const requestedBase = otherCartBase + (Number(nextQty) * ratio)
  const maxLineQty = Math.max(0, Math.floor((availableBase - otherCartBase) / ratio))
  if (requestedBase > availableBase) {
    throw new Error(`${item.item_name} คงเหลือ ${maxLineQty} ${item.unit_code}`)
  }
}

function parseBarcodeInput(value) {
  let text = String(value || '').trim()
  let qty = 1
  const qtyMatch = text.match(/^(\d+(?:\.\d+)?)\s*\*\s*(.+)$/)
  if (qtyMatch) {
    qty = Number(qtyMatch[1])
    text = qtyMatch[2].trim()
  }
  const shelfIndex = text.indexOf('#')
  if (shelfIndex >= 0) text = text.slice(0, shelfIndex).trim()
  return {
    qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
    barcode: text,
  }
}

async function resolveProductUnit(product, barcode = '') {
  if (product.unit_code) return product
  const units = await getProductDetail(product.item_code, custCode.value, priceOpts.value)
  const preferredUnit = product.start_sale_unit || product.unit_standard || product.unit_cost || ''
  return units.find((row) => row.unit_code === preferredUnit) || units[0] || null
}

async function addProductToCart(product, qty, barcode = '') {
  const unit = await resolveProductUnit(product, barcode)
  if (!unit) throw new Error('ไม่พบหน่วยขายของสินค้า')

  await assertCanAddStock(product, unit, qty)

  const price = await getProductPrice(unit.item_code, unit.unit_code, custCode.value, String(qty), priceOpts.value)
  await cartStore.addItem({
    cart_key: cartKey.value,
    emp_code: authStore.employee?.user_code ?? '',
    item_code: unit.item_code,
    item_name: unit.item_name,
    unit_code: unit.unit_code,
    barcode: barcode || unit.barcode || '',
    qty,
    price: Number(price?.price ?? 0),
    item_type: String(unit.item_type ?? product.item_type ?? '0'),
    wh_code: unit.wh_code ?? unit.start_sale_wh ?? '',
    shelf_code: unit.shelf_code ?? unit.start_sale_shelf ?? '',
    stand_value: Number(unit.stand_value) || 1,
    divide_value: Number(unit.divide_value) || 1,
    ratio: Number(unit.ratio) || 1,
  })
}

async function addBarcodeToDraft() {
  const { qty, barcode } = parseBarcodeInput(barcodeInput.value)
  if (!barcode) return
  barcodeAdding.value = true
  errorMsg.value = ''
  try {
    const product = await getProductByBarcodeDetail(barcode)
    if (!product) {
      errorMsg.value = `ไม่พบสินค้าจากบาร์โค้ด ${barcode}`
      return
    }
    await addProductToCart(product, qty, barcode)
    await refreshPrices()
    toast.add({
      severity: 'success',
      summary: 'เพิ่มสินค้าแล้ว',
      detail: `${product.item_name} × ${qty}`,
      life: 1400,
    })
    barcodeInput.value = ''
  } catch (error) {
    errorMsg.value = error.message || 'เพิ่มสินค้าจากบาร์โค้ดไม่สำเร็จ'
  } finally {
    barcodeAdding.value = false
    await nextTick()
    barcodeRef.value?.$el?.querySelector?.('input')?.focus?.()
  }
}

function openProductDetail(product) {
  detailProduct.value = product
  detailVisible.value = true
  productDialogVisible.value = false
}

async function onProductDetailVisible(value) {
  detailVisible.value = value
  if (!value) await refreshPrices()
}

function onQtyInput(item, raw) {
  const qty = Number(String(raw ?? '').trim().replace(',', '.'))
  if (!Number.isFinite(qty) || qty < 0) return
  clearTimeout(qtyTimers[item.guid_code])
  qtyTimers[item.guid_code] = setTimeout(async () => {
    updating.value[item.guid_code] = true
    try {
      await assertCanSetLineQty(item, qty)
      await cartStore.updateItemQty(item, qty, cartKey.value)
    } catch (error) {
      const message = error.message || 'จำนวนสินค้าเกินสต็อก'
      errorMsg.value = message
      toast.add({ severity: 'warn', summary: 'ตรวจสอบจำนวนสินค้า', detail: message, life: 2500 })
      await cartStore.fetchCart(cartKey.value)
    } finally {
      updating.value[item.guid_code] = false
    }
  }, 250)
}

async function removeItem(item) {
  updating.value[item.guid_code] = true
  try {
    await cartStore.updateItemQty(item, 0, cartKey.value)
  } finally {
    updating.value[item.guid_code] = false
  }
}

async function onRemarkBlur(item, value) {
  if (value === (item.remark || '')) return
  await cartStore.updateItemRemark(item, value, cartKey.value)
}

function emitConfirm() {
  emit('confirm', {
    cust_code: custCode.value,
    cust_name: custName.value,
    inquiry_type: inquiryType.value,
    vat_type: vatType.value,
    vat_rate: Number(vatRate.value || 7),
    sale_code: saleCode.value,
    sale_name: saleName.value,
    doc_format_code: props.basket.doc_format_code || '',
    doc_format_name: props.basket.doc_format_name || '',
    form_code: props.basket.form_code || '',
    order_remark: orderRemark.value,
    discount_word: discountWord.value,
    total_value: calcResult.value.totalValue,
    total_discount: calcResult.value.totalDiscount,
    total_before_vat: calcResult.value.beforeVat,
    vat_value: calcResult.value.vatValue,
    total_after_vat: calcResult.value.afterVat,
    total_except_vat: calcResult.value.totalExceptVat,
    total_amount: calcResult.value.totalAmount,
    fresh_prices: freshPrices.value,
  })
}

function confirmDocument() {
  if (!canConfirm.value) {
    errorMsg.value = validationMessages.value[0] || 'ยังไม่พร้อมรับชำระเงิน'
    return
  }
  if (zeroPriceItems.value.length) {
    showZeroPriceDialog.value = true
    return
  }
  emitConfirm()
}

function confirmZeroPrice() {
  showZeroPriceDialog.value = false
  emitConfirm()
}
</script>

<template>
  <div class="sale-editor">
    <Dialog :visible="showZeroPriceDialog" modal header="ยืนยันสินค้าราคา 0" :style="{ width: '26rem' }" @update:visible="showZeroPriceDialog = $event">
      <div class="zero-dialog">
        <i class="pi pi-exclamation-triangle" />
        <p>มีสินค้าราคา 0 บาท ต้องยืนยันก่อนรับชำระเงิน</p>
        <ul>
          <li v-for="item in zeroPriceItems" :key="item.guid_code">{{ item.item_name }} ({{ item.unit_code }})</li>
        </ul>
      </div>
      <template #footer>
        <Button label="ยกเลิก" severity="secondary" outlined @click="showZeroPriceDialog = false" />
        <Button label="ยืนยันราคา 0" icon="pi pi-check" severity="warning" @click="confirmZeroPrice" />
      </template>
    </Dialog>

    <div class="sale-editor-header">
      <Button icon="pi pi-arrow-left" severity="secondary" outlined aria-label="กลับ" @click="emit('back')" />
      <div class="editor-title">
        <h1>ขายสินค้า</h1>
        <span>ตะกร้า #{{ basket.basket_id }} · {{ custName || 'ลูกค้าทั่วไป' }}</span>
      </div>
      <div class="editor-actions">
        <Button
          data-testid="sale-editor-pay-top"
          :label="`รับชำระ ${formatCurrency(calcResult.totalAmount)}`"
          icon="pi pi-arrow-right"
          icon-pos="right"
          :disabled="!canConfirm"
          @click="confirmDocument"
        />
      </div>
    </div>

    <main class="sale-editor-body">
      <section class="editor-section document-section">
        <div class="editor-grid">
          <label class="field">
            <span>รหัสเอกสาร</span>
            <InputText :model-value="basket.doc_format_code || '-'" disabled />
          </label>
          <label class="field">
            <span>ชื่อลูกค้า</span>
            <InputText :model-value="custName || 'ลูกค้าทั่วไป'" disabled />
          </label>
          <label class="field">
            <span>ประเภทการขาย</span>
            <SelectButton v-model="inquiryType" :options="inquiryTypeOptions" option-label="label" option-value="value" class="dense-select" />
          </label>
          <label class="field">
            <span>ประเภทภาษี</span>
            <SelectButton v-model="vatType" :options="vatTypeOptions" option-label="label" option-value="value" class="dense-select" />
          </label>
          <label class="field">
            <span>อัตราภาษี</span>
            <InputText v-model="vatRate" type="number" min="0" step="0.01" />
          </label>
          <label class="field">
            <span>พนักงานขาย</span>
            <InputText :model-value="saleName || saleCode || '-'" disabled />
          </label>
          <label class="field wide">
            <span>หมายเหตุ</span>
            <Textarea v-model.trim="orderRemark" rows="2" auto-resize />
          </label>
        </div>
      </section>

      <div class="pick-panels">
        <section class="pick-panel">
          <div class="pick-title">
            <strong>ลูกค้า</strong>
            <Button :label="custEditing ? 'ปิด' : 'เปลี่ยน'" icon="pi pi-user" severity="info" size="small" @click="custEditing = !custEditing" />
          </div>
          <div v-if="!custEditing" class="selected-box" :class="{ empty: !custCode }">
            <strong>{{ custCode || 'ลูกค้าทั่วไป' }}</strong>
            <span>{{ custName || 'ลูกค้าทั่วไป' }}</span>
          </div>
          <div v-else class="lookup-box">
            <Button label="ลูกค้าทั่วไป" icon="pi pi-user" size="small" outlined @click="selectWalkIn" />
            <InputText v-model.trim="custSearch" placeholder="ค้นหารหัส/ชื่อลูกค้า" @update:model-value="onCustSearchInput" />
            <div v-if="custLoading" class="lookup-hint">กำลังค้นหา...</div>
            <div v-if="showCustDropdown" class="lookup-list">
              <button
                v-for="customer in custResults"
                :key="customer.row_key || `${customer.code || ''}|${customer.member_code || ''}|${customer.mobile_phone || ''}`"
                type="button"
                class="lookup-row"
                @click="selectCustomer(customer)"
              >
                <strong>{{ customer.code }}<template v-if="customer.member_code"> / {{ customer.member_code }}</template></strong>
                <span>{{ customer.name }}<template v-if="customer.mobile_phone || customer.telephone"> · {{ customer.mobile_phone || customer.telephone }}</template></span>
              </button>
            </div>
          </div>
        </section>

        <section class="pick-panel">
          <div class="pick-title">
            <strong>พนักงานขาย</strong>
            <Button :label="saleEditing ? 'ปิด' : 'เปลี่ยน'" icon="pi pi-id-card" severity="secondary" size="small" @click="saleEditing = !saleEditing" />
          </div>
          <div v-if="!saleEditing" class="selected-box" :class="{ empty: !saleCode }">
            <strong>{{ saleCode || 'ไม่ระบุ' }}</strong>
            <span>{{ saleDisplayName || saleName || 'ยังไม่ได้เลือกพนักงานขาย' }}</span>
          </div>
          <div v-else class="lookup-box">
            <InputText v-model.trim="saleSearch" placeholder="ค้นหาพนักงานขาย" @update:model-value="onSaleSearchInput" />
            <div v-if="saleLoading" class="lookup-hint">กำลังค้นหา...</div>
            <div v-if="showSaleDropdown" class="lookup-list">
              <button v-for="employee in saleResults" :key="employee.code" type="button" class="lookup-row" @click="selectEmployee(employee)">
                <strong>{{ employee.code }}</strong>
                <span>{{ employeeDisplayLabel(employee) }}</span>
              </button>
            </div>
          </div>
        </section>
      </div>

      <section class="pick-panel product-pick-panel">
        <div class="pick-title">
          <strong>สินค้า</strong>
          <span>ค้นหา / ยิงบาร์โค้ด / เพิ่มรายการแบบเดียวกับ PU</span>
        </div>
        <div class="product-tools">
          <div class="pick-search">
            <InputText v-model.trim="productSearch" data-testid="sale-product-search" placeholder="ค้นหารหัสสินค้า / ชื่อ / บาร์โค้ด" @keyup.enter="searchProducts()" />
            <Button data-testid="sale-product-search-submit" icon="pi pi-search" severity="secondary" outlined :loading="productLoading" @click="searchProducts()" />
          </div>
          <div class="pick-search">
            <InputText ref="barcodeRef" v-model.trim="barcodeInput" data-testid="sale-barcode-input" placeholder="[จำนวน*]บาร์โค้ด" @keyup.enter="addBarcodeToDraft" />
            <Button data-testid="sale-barcode-submit" icon="pi pi-barcode" severity="secondary" outlined :loading="barcodeAdding" @click="addBarcodeToDraft" />
          </div>
        </div>
        <div class="product-hints">
          <span><i class="pi pi-keyboard" /> กด Enter หลังยิงบาร์โค้ดเพื่อเพิ่มทันที</span>
          <span><i class="pi pi-hashtag" /> ตัวอย่าง 3*8850000000000</span>
        </div>
        <Message v-if="errorMsg" severity="warn" :closable="false" class="editor-message">{{ errorMsg }}</Message>
      </section>

      <section class="editor-section item-section">
        <div class="item-toolbar">
          <strong>รายการสินค้า</strong>
          <span>{{ rows.length }} รายการ</span>
        </div>
        <div class="editor-table-wrap">
          <table class="editor-table">
            <thead>
              <tr>
                <th>สินค้า</th>
                <th>รหัส</th>
                <th>หน่วย</th>
                <th class="num">จำนวน</th>
                <th class="num">ราคา</th>
                <th class="num">ส่วนลด</th>
                <th class="num">ราคารวม</th>
                <th>หมายเหตุ</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.guid_code" :class="{ 'row-error': row.fresh && !row.fresh.loading && !row.fresh.success }">
                <td>
                  <div class="product-cell">
                    <div class="item-img-wrap">
                      <img :src="imageUrl(row.item_code)" :alt="row.item_name" class="item-img" @error="onImgError" />
                      <div class="item-img-placeholder"><i class="pi pi-box" /></div>
                    </div>
                    <strong>{{ row.item_name }}</strong>
                  </div>
                </td>
                <td>{{ row.item_code }}</td>
                <td>{{ row.unit_code || '-' }}</td>
                <td><InputText :model-value="row.qty" :data-testid="`sale-line-qty-${row.guid_code}`" type="text" inputmode="decimal" class="cell-input num-input" @change="event => onQtyInput(row, event.target.value)" @keyup.enter="event => onQtyInput(row, event.target.value)" /></td>
                <td class="num">
                  <Skeleton v-if="row.fresh?.loading" width="5rem" height="1rem" />
                  <span v-else-if="row.fresh?.success">{{ formatCurrency(row.fresh.price) }}</span>
                  <span v-else class="fetch-error-label">ดึงราคาไม่ได้</span>
                </td>
                <td class="num">
                  <span v-if="row.fresh?.default_discount" class="discount-tag">{{ row.fresh.default_discount }}</span>
                  <span v-else>-</span>
                </td>
                <td class="num">
                  <Skeleton v-if="row.fresh?.loading" width="5rem" height="1rem" />
                  <span v-else>{{ formatCurrency(itemNet(row)) }}</span>
                </td>
                <td>
                  <InputText :default-value="row.remark || ''" class="remark-input" placeholder="หมายเหตุ" @blur="event => onRemarkBlur(row, event.target.value)" />
                </td>
                <td class="action-cell">
                  <Button icon="pi pi-trash" text rounded severity="danger" aria-label="ลบรายการ" :loading="updating[row.guid_code]" @click="removeItem(row)" />
                </td>
              </tr>
              <tr v-if="!rows.length && !cartStore.loading">
                <td colspan="9" class="empty-lines">ค้นหา/ยิงบาร์โค้ดเพื่อเพิ่มสินค้า หรือย้อนกลับไปเลือกจากแคตตาล็อก</td>
              </tr>
              <tr v-if="cartStore.loading">
                <td colspan="9" class="empty-lines">กำลังโหลดรายการ...</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="editor-section totals-section">
        <div v-if="validationMessages.length" class="validation-panel">
          <div class="validation-title">
            <i class="pi pi-info-circle" />
            ยังไม่พร้อมรับชำระเงิน
          </div>
          <div class="validation-list">
            <span v-for="message in validationMessages" :key="message">{{ message }}</span>
          </div>
          <Button
            v-if="fetchErrorItems.length"
            label="ดึงราคาใหม่"
            icon="pi pi-refresh"
            size="small"
            outlined
            :loading="priceLoading"
            @click="refreshPrices"
          />
        </div>
        <div class="sale-summary-block">
          <div class="discount-row">
            <span>ส่วนลดท้ายบิล</span>
            <InputText v-model.trim="discountWord" data-testid="sale-bill-discount"  />
          </div>
          <div class="summary-divider" />
          <div class="sum-row">
            <span>ยอดรวมสินค้า</span>
            <strong>{{ formatCurrency(calcResult.totalValue) }}</strong>
          </div>
          <div v-if="calcResult.totalDiscount > 0" class="sum-row">
            <span>ส่วนลด</span>
            <strong class="discount-value">-{{ formatCurrency(calcResult.totalDiscount) }}</strong>
          </div>
          <div class="sum-row net-row">
            <span>ยอดสุทธิ</span>
            <strong>{{ formatCurrency(calcResult.totalAmount) }}</strong>
          </div>
          <button type="button" class="tax-toggle" @click="showTaxDetail = !showTaxDetail">
            <i class="pi pi-receipt" />
            {{ showTaxDetail ? 'ซ่อนรายละเอียดภาษี' : 'รายละเอียดภาษี' }}
            <i :class="showTaxDetail ? 'pi pi-chevron-up' : 'pi pi-chevron-down'" />
          </button>
          <div v-if="showTaxDetail" class="tax-detail">
            <div class="tax-grid">
              <div><span>ประเภทภาษี</span><strong>{{ taxTypeLabel(vatType) }}</strong></div>
              <div><span>อัตราภาษี</span><strong>{{ vatRate || 0 }}%</strong></div>
              <div><span>ยอดก่อนภาษี</span><strong>{{ formatCurrency(calcResult.beforeVat) }}</strong></div>
              <div><span>ภาษีมูลค่าเพิ่ม</span><strong>{{ calcResult.vatValue > 0 ? formatCurrency(calcResult.vatValue) : '-' }}</strong></div>
              <div v-if="calcResult.totalExceptVat > 0"><span>มูลค่ายกเว้นภาษี</span><strong>{{ formatCurrency(calcResult.totalExceptVat) }}</strong></div>
              <div><span>ยอดสุทธิ</span><strong class="tax-net">{{ formatCurrency(calcResult.totalAmount) }}</strong></div>
            </div>
          </div>
          <Message v-if="fetchErrorItems.length" severity="error" :closable="false">
            ดึงราคาสินค้าบางรายการไม่ได้ กรุณาตรวจสอบก่อนรับชำระเงิน
          </Message>
        </div>
      </section>
    </main>

    <div class="sticky-action">
      <div>
        <span>ยอดสุทธิ</span>
        <strong>{{ formatCurrency(calcResult.totalAmount) }}</strong>
      </div>
      <Button
        data-testid="sale-editor-pay-sticky"
        label="รับชำระเงิน"
        icon="pi pi-arrow-right"
        icon-pos="right"
        :disabled="!canConfirm"
        @click="confirmDocument"
      />
    </div>

    <Dialog
      :visible="productDialogVisible"
      header="เลือกสินค้า"
      modal
      :draggable="false"
      :style="{ width: 'min(760px, 95vw)' }"
      @update:visible="productDialogVisible = $event"
    >
      <div class="product-result-list">
        <button v-for="product in productResults" :key="product.item_code" type="button" class="product-result-row" @click="openProductDetail(product)">
          <strong>{{ product.item_code }}</strong>
          <span>{{ product.item_name }}</span>
          <small>{{ product.start_sale_unit || product.unit_standard || '-' }}</small>
        </button>
        <div v-if="!productResults.length" class="empty-lines compact">ไม่พบสินค้า</div>
      </div>
    </Dialog>

    <ProductDetailSheet
      v-if="detailProduct"
      :product="detailProduct"
      :basket="{ ...basket, cust_code: custCode, inquiry_type: inquiryType, vat_type: vatType, vat_rate: vatRate }"
      :visible="detailVisible"
      @update:visible="onProductDetailVisible"
    />
  </div>
</template>

<style scoped>
.sale-editor {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--app-shell-bg);
}

.sale-editor-header {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 0.875rem 1rem;
  border-bottom: 1px solid var(--p-surface-border);
  background: var(--app-panel-bg);
  flex-shrink: 0;
}

.editor-title {
  min-width: 0;
  flex: 1;
}

.editor-title h1 {
  margin: 0;
  font-size: 1.25rem;
  line-height: 1.2;
}

.editor-title span,
.item-toolbar span,
.pick-title span {
  color: var(--p-text-color-secondary);
  font-size: 0.84rem;
}

.editor-actions {
  flex-shrink: 0;
}

.sale-editor-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.editor-section,
.pick-panel {
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
  background: var(--p-surface-0);
  padding: 0.75rem;
}

.editor-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
  color: var(--p-text-color-secondary);
  font-size: 0.84rem;
}

.field.wide {
  grid-column: span 2;
}

.dense-select {
  min-width: 0;
}

.dense-select :deep(.p-togglebutton-content) {
  padding: 0.42rem 0.55rem;
  font-size: 0.82rem;
}

.pick-panels {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.pick-title,
.item-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.55rem;
}

.selected-box {
  min-height: 50px;
  display: grid;
  gap: 0.15rem;
  border: 1px solid var(--p-surface-border);
  border-radius: 6px;
  background: var(--p-surface-50);
  padding: 0.55rem 0.65rem;
}

.selected-box.empty {
  border-style: dashed;
}

.selected-box span,
.lookup-hint {
  color: var(--p-text-color-secondary);
  font-size: 0.82rem;
}

.lookup-box,
.product-result-list {
  display: grid;
  gap: 0.45rem;
}

.lookup-list {
  display: grid;
  gap: 0.35rem;
  max-height: 190px;
  overflow: auto;
}

.lookup-row,
.product-result-row {
  width: 100%;
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 0.5rem;
  align-items: center;
  border: 1px solid var(--p-surface-border);
  border-radius: 6px;
  background: var(--p-surface-50);
  color: var(--p-text-color);
  cursor: pointer;
  min-height: 44px;
  padding: 0.5rem 0.6rem;
  text-align: left;
}

.lookup-row:hover,
.product-result-row:hover {
  border-color: var(--p-primary-color);
}

.lookup-row span,
.product-result-row span,
.product-result-row small {
  color: var(--p-text-color-secondary);
  overflow-wrap: anywhere;
}

.product-tools {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 0.42fr);
  gap: 0.5rem;
}

.pick-search {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.5rem;
}

.editor-message {
  margin-top: 0.6rem;
}

.product-hints {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem 0.85rem;
  margin-top: 0.55rem;
  color: var(--p-text-color-secondary);
  font-size: 0.8rem;
}

.product-hints span {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
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
  font-size: 0.86rem;
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

.product-cell {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 0.55rem;
  align-items: center;
  min-width: 260px;
}

.product-cell strong {
  overflow-wrap: anywhere;
}

.item-img-wrap {
  position: relative;
  width: 42px;
  height: 42px;
  border-radius: 6px;
  overflow: hidden;
  background: var(--p-surface-100);
  border: 1px solid var(--p-surface-border);
}

.item-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.item-img-placeholder {
  display: none;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  color: var(--p-text-color-secondary);
}

.cell-input {
  width: 112px;
}

.num-input {
  text-align: right;
}

.remark-input {
  width: 180px;
}

.action-cell {
  width: 52px;
  text-align: center;
}

.row-error td {
  background: color-mix(in srgb, var(--p-red-500) 7%, var(--p-surface-0));
}

.fetch-error-label {
  color: var(--p-red-500);
  font-weight: 700;
}

.discount-tag {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.12rem 0.45rem;
  background: color-mix(in srgb, var(--p-primary-color) 10%, var(--p-surface-0));
  color: var(--p-primary-color);
  font-weight: 700;
}

.empty-lines {
  min-height: 84px;
  padding: 1.5rem;
  color: var(--p-text-color-secondary);
  text-align: center;
}

.empty-lines.compact {
  min-height: 48px;
}

.sale-summary-block {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.validation-panel {
  display: grid;
  gap: 0.55rem;
  border: 1px solid color-mix(in srgb, var(--p-blue-500) 35%, var(--p-surface-border));
  border-radius: 8px;
  background: color-mix(in srgb, var(--p-blue-500) 7%, var(--p-surface-0));
  padding: 0.65rem 0.75rem;
  margin-bottom: 0.75rem;
}

.validation-title {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  color: var(--p-blue-600);
  font-weight: 700;
}

.validation-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.validation-list span {
  border: 1px solid var(--p-surface-border);
  border-radius: 999px;
  background: var(--p-surface-0);
  color: var(--p-text-color-secondary);
  padding: 0.2rem 0.55rem;
  font-size: 0.8rem;
}

.discount-row,
.sum-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(180px, 260px);
  gap: 0.75rem;
  align-items: center;
}

.sum-row span,
.discount-row span {
  color: var(--p-text-color-secondary);
}

.sum-row strong {
  text-align: right;
  font-size: 1rem;
}

.summary-divider {
  height: 1px;
  background: var(--p-surface-border);
}

.discount-value {
  color: var(--p-red-500);
}

.net-row strong {
  color: var(--p-primary-color);
  font-size: 1.45rem;
}

.tax-toggle {
  justify-self: flex-start;
  width: fit-content;
  border: none;
  background: none;
  color: var(--p-primary-color);
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
  padding: 0.35rem 0;
  font: inherit;
  font-size: 0.88rem;
}

.tax-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
}

.tax-grid > div {
  display: grid;
  gap: 0.15rem;
  border: 1px solid var(--p-surface-border);
  border-radius: 6px;
  background: var(--p-surface-50);
  padding: 0.55rem 0.65rem;
}

.tax-grid span {
  color: var(--p-text-color-secondary);
  font-size: 0.78rem;
}

.tax-net {
  color: var(--p-primary-color);
}

.sticky-action {
  display: none;
}

.product-result-row {
  grid-template-columns: 140px minmax(0, 1fr) 90px;
}

.zero-dialog {
  display: grid;
  gap: 0.75rem;
}

.zero-dialog i {
  color: var(--p-blue-500);
  font-size: 2rem;
}

@media (max-width: 1180px) {
  .editor-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .pick-panels,
  .product-tools {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 767px) {
  .sale-editor-header {
    padding: 0.75rem;
  }

  .editor-actions {
    display: none;
  }

  .sale-editor-body {
    padding: 0.75rem;
  }

  .editor-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .field.wide {
    grid-column: span 1;
  }

  .discount-row,
  .sum-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .sum-row strong {
    text-align: left;
  }

  .tax-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .sticky-action {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    border-top: 1px solid var(--p-surface-border);
    background: var(--app-panel-bg);
    padding: 0.75rem;
  }

  .sticky-action div {
    display: grid;
    gap: 0.05rem;
  }

  .sticky-action span {
    color: var(--p-text-color-secondary);
    font-size: 0.78rem;
  }

  .sticky-action strong {
    color: var(--p-primary-color);
    font-size: 1.15rem;
  }
}
</style>
