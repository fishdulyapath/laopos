<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import Button from 'primevue/button'
import InputNumber from 'primevue/inputnumber'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Dialog from 'primevue/dialog'
import IsoDatePicker from '@/components/common/IsoDatePicker.vue'
import { useAuthStore } from '@/stores/auth'
import { useCartStore } from '@/stores/cart'
import { usePosStore } from '@/stores/pos'
import { formatCurrency } from '@/utils/formatters'
import { getPassBookList, getCreditTypeList, getProductDetail, saveTrans } from '@/services/sellService'
import { getItemReservedQty } from '@/services/basketService'
import { calcDiscountAmount } from '@/utils/discount'
import { createTigerOrder, inquireTigerOrder, cancelTigerOrder, getTigerConfig, TIGER_MOCK } from '@/services/tigerService'

function localDateISO(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const props = defineProps({
  basket: { type: Object, required: true },
  orderData: { type: Object, required: true },
})
const emit = defineEmits(['back', 'complete'])

const cartStore = useCartStore()
const posStore = usePosStore()
const authStore = useAuthStore()

function rnd(value, point) {
  const f = Math.pow(10, point)
  return Math.round(value * f) / f
}

function isServiceItem(item) {
  return String(item?.item_type ?? '') === '1'
}

function unitRatio(unit, fallback = 1) {
  return Math.max(1, Number(unit?.ratio ?? fallback) || 1)
}

function unitBaseBalance(unit, ratio) {
  return Number(unit?.sum_balance_qty ?? (Number(unit?.balance_qty ?? 0) * ratio))
}

function stockControlEnabled() {
  const value = posStore.erpOption?.ic_stock_control
  if (value === undefined || value === null || value === '') return false
  return ['1', 'true', 't', 'yes', 'y'].includes(String(value).toLowerCase())
}

// ─── Sale type ───────────────────────────────────────────────────────────────

const isCreditSale = computed(() => [0, 2].includes(Number(props.orderData.inquiry_type)))

const saleTypeLabel = computed(() => {
  const t = Number(props.orderData.inquiry_type)
  if (t === 0) return 'ขายเชื่อ'
  if (t === 1) return 'ขายสด'
  if (t === 2) return 'เชื่อ (บริการ)'
  if (t === 3) return 'สด (บริการ)'
  return ''
})

// ─── Payment entries ─────────────────────────────────────────────────────────

const paymentEntries = ref([])

// ปัดเศษ: ทำหน้าที่เหมือนการจ่ายเงินชนิดหนึ่ง (เงินที่จ่าย + ปัดเศษ = ยอดสุทธิ)
const roundedAmount = ref(null)

const totalPaid = computed(() => rnd(paymentEntries.value.reduce((s, e) => s + e.amount, 0), 2))
const totalDue = computed(() => rnd(Number(props.orderData.total_amount) || 0, 2))
const remaining = computed(() => Math.max(0, rnd(totalDue.value - totalPaid.value - (roundedAmount.value || 0), 2)))
const change = computed(() => Math.max(0, rnd(totalPaid.value + (roundedAmount.value || 0) - totalDue.value, 2)))
const employeeCode = computed(() => String(authStore.employee?.user_code || '').trim())

// ─── UI state ────────────────────────────────────────────────────────────────

const activeType = ref('cash')
const saving = ref(false)
const saveError = ref('')

// ─── Reference data ──────────────────────────────────────────────────────────

const passBooks = ref([])
const creditTypes = ref([])
const tigerEnabled = ref(false)

const paymentTabs = computed(() => {
  const tabs = [
    { key: 'cash', label: 'เงินสด', icon: 'pi pi-money-bill' },
    { key: 'transfer', label: 'โอน', icon: 'pi pi-send' },
    { key: 'credit', label: 'บัตรเครดิต', icon: 'pi pi-credit-card' },
  ]
  if (tigerEnabled.value) {
    tabs.push({ key: 'tiger', label: 'Tiger', icon: 'pi pi-desktop' })
  }
  return tabs
})

onMounted(async () => {
  const tasks = [getTigerConfig().then(c => { tigerEnabled.value = !!c.enabled })]
  if (!isCreditSale.value) {
    tasks.push(
      Promise.all([getPassBookList(), getCreditTypeList()]).then(([pb, ct]) => {
        passBooks.value = pb
        creditTypes.value = ct
      }),
    )
  }
  await Promise.all(tasks)
})

// ─── Denomination helpers ────────────────────────────────────────────────────

const DENOMS = [20, 50, 100, 500, 1000]

function addDenom(val) {
  cashAmount.value = rnd((cashAmount.value || 0) + val, 2)
}

// ─── Cash form ───────────────────────────────────────────────────────────────

const cashAmount = ref(null)

function addCash() {
  if (!cashAmount.value || cashAmount.value <= 0) return
  paymentEntries.value.push({
    id: Date.now(),
    type: 'cash',
    label: 'เงินสด',
    amount: cashAmount.value,
    details: {},
  })
  cashAmount.value = null
}

// ─── Transfer form ───────────────────────────────────────────────────────────

const today = localDateISO()
const transferDate = ref(today)
const transferPassBook = ref(null)
const transferAmount = ref(null)

function addTransfer() {
  if (!transferPassBook.value || !transferAmount.value || transferAmount.value <= 0) return
  const book = transferPassBook.value
  paymentEntries.value.push({
    id: Date.now(),
    type: 'transfer',
    label: `${book.book_name} (${book.bank_name || book.bank_code})`,
    amount: transferAmount.value,
    details: {
      pass_book_code: book.code,
      bank_code: book.bank_code,
      bank_branch: book.bank_branch,
      transfer_date: transferDate.value,
    },
  })
  transferAmount.value = null
  transferPassBook.value = null
}

// ─── Credit card form ────────────────────────────────────────────────────────

const selectedCreditType = ref(null)
const creditCardNumber = ref('')
const creditApprovalNo = ref('')
const creditAmount = ref(null)

const creditChargeRate = computed(() => parseFloat(selectedCreditType.value?.charge_rate) || 0)
const creditCharge = computed(() => rnd((creditAmount.value || 0) * creditChargeRate.value / 100, 2))
const creditSumAmount = computed(() => rnd((creditAmount.value || 0) + creditCharge.value, 2))

function addCredit() {
  if (!selectedCreditType.value || !creditAmount.value || creditAmount.value <= 0) return
  const ct = selectedCreditType.value
  paymentEntries.value.push({
    id: Date.now(),
    type: 'credit',
    label: ct.name_1,
    amount: creditAmount.value,
    details: {
      credit_card_type: ct.code,
      card_number: creditCardNumber.value,
      no_approved: creditApprovalNo.value,
      charge: creditCharge.value,
      sum_amount: creditSumAmount.value,
    },
  })
  creditAmount.value = null
  creditCardNumber.value = ''
  creditApprovalNo.value = ''
  selectedCreditType.value = null
}

function removeEntry(id) {
  paymentEntries.value = paymentEntries.value.filter(e => e.id !== id)
}

// ─── Tiger ────────────────────────────────────────────────────────────────────
// status: idle | requesting | waiting | processing | success | cancel | failed
// ตรงกับ status ที่ Tiger API ส่งกลับมา: new, processing, success, cancel, failed

const tigerStatus = ref('idle')
const tigerId = ref(null)        // Tiger order id (string) จาก /orders response
const tigerError = ref('')
const tigerPollInterval = ref(null)
const tigerCancel = ref(false)   // true เมื่อ status=new, false เมื่อ processing

function genRef() {
  return `${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 90 + 10)}`
}

const tigerRef1 = ref('')
const tigerRef2 = ref('')
const tigerPayAmount = computed(() => rnd(remaining.value > 0 ? remaining.value : totalDue.value - (roundedAmount.value || 0), 2))

async function startTigerPayment() {
  tigerStatus.value = 'requesting'
  tigerError.value = ''
  tigerCancel.value = false
  const amount = tigerPayAmount.value
  const orderId = crypto.randomUUID()
  tigerRef1.value = genRef()
  tigerRef2.value = genRef()
  try {
    const res = await createTigerOrder({
      orderId,
      custName: props.orderData.cust_name || '',
      posId: posStore.posId,
      amount,
      ref1: tigerRef1.value,
      ref2: tigerRef2.value,
    })
    // สร้างสำเร็จเมื่อ status === "new" (ตรงกับ case 401 ใน Flutter)
    if (res.status === 'new') {
      tigerId.value = String(res.id)
      tigerStatus.value = 'waiting'
      tigerCancel.value = true
      tigerPollInterval.value = setInterval(pollTiger, 3000)
    } else {
      throw new Error('ไม่สามารถสร้างรายการชำระเงินได้')
    }
  } catch (e) {
    tigerStatus.value = 'failed'
    tigerError.value = e.message
  }
}

async function pollTiger() {
  if (!tigerId.value) return
  try {
    const res = await inquireTigerOrder(tigerId.value)
    // ตรงกับ polling logic qrType == 401 ใน Flutter
    if (res.status === 'success') {
      clearInterval(tigerPollInterval.value)
      tigerStatus.value = 'success'
      paymentEntries.value.push({
        id: Date.now(),
        type: 'tiger',
        label: 'เครื่องชำระเงิน Tiger',
        amount: tigerPayAmount.value,
        details: { tiger_order_id: tigerId.value },
      })
      await save()
    } else if (res.status === 'cancel') {
      clearInterval(tigerPollInterval.value)
      tigerStatus.value = 'cancel'
    } else if (res.status === 'failed') {
      clearInterval(tigerPollInterval.value)
      tigerStatus.value = 'failed'
      tigerError.value = 'Tiger: การชำระเงินล้มเหลว'
    } else if (res.status === 'new') {
      tigerCancel.value = true
    } else if (res.status === 'processing') {
      tigerCancel.value = false
    }
  } catch (_) {
    // network error — poll ต่อ
  }
}

async function cancelTiger() {
  clearInterval(tigerPollInterval.value)
  try { await cancelTigerOrder(tigerId.value) } catch (_) {}
  tigerStatus.value = 'idle'
  tigerId.value = null
  tigerCancel.value = false
}

onUnmounted(() => clearInterval(tigerPollInterval.value))

// ─── Save ─────────────────────────────────────────────────────────────────────

const missingFreshPriceItems = computed(() => cartStore.items.filter((item) => {
  const fresh = props.orderData.fresh_prices?.[item.guid_code]
  return !fresh || fresh.loading || !fresh.success || fresh.price === null || fresh.price === undefined
}))

const saveBlockReason = computed(() => {
  if (!employeeCode.value) return 'กรุณาเข้าสู่ระบบพนักงานใหม่ก่อนบันทึกเอกสาร'
  if (missingFreshPriceItems.value.length) return 'กรุณาดึงราคาสินค้าทุกรายการให้สำเร็จก่อนบันทึก'
  return ''
})

const canSave = computed(() =>
  !saving.value &&
  !saveBlockReason.value &&
  (isCreditSale.value || totalPaid.value + (roundedAmount.value || 0) >= totalDue.value)
)

async function validateStockBeforeSave() {
  if (!stockControlEnabled()) return
  const groups = new Map()
  for (const item of cartStore.items) {
    if (isServiceItem(item)) continue
    const group = groups.get(item.item_code) || { item, requestedBase: 0, currentCartBase: 0 }
    const ratio = unitRatio(item)
    group.requestedBase += Number(item.qty || 0) * ratio
    group.currentCartBase += Number(item.qty || 0) * ratio
    groups.set(item.item_code, group)
  }

  const priceOpts = {
    sale_type: props.orderData.inquiry_type,
    vat_type: props.orderData.vat_type,
    vat_rate: props.orderData.vat_rate,
  }

  for (const { item, requestedBase, currentCartBase } of groups.values()) {
    const units = await getProductDetail(item.item_code, props.orderData.cust_code || '', priceOpts)
    const unit = units.find((row) => row.unit_code === item.unit_code) || units[0] || item
    if (isServiceItem(unit)) continue
    const ratio = unitRatio(unit, item.ratio)
    const balanceBase = unitBaseBalance(unit, ratio)
    const reservedBase = await getItemReservedQty(item.item_code)
    const availableBase = Math.max(0, balanceBase - reservedBase + currentCartBase)
    if (requestedBase > availableBase) {
      const availableQty = Math.max(0, Math.floor(availableBase / ratio))
      throw new Error(`${item.item_name} คงเหลือ ${availableQty} ${item.unit_code}`)
    }
  }
}

function buildSaveBody({ tigerPending = false } = {}) {
  const pos = posStore.selectedPos
  const now = new Date()
  // Tiger คือเงินสดที่รับผ่านเครื่อง — รวมเข้ากับ cash เพื่อให้ backend คิดเป็นเงินสด
  const cashEntries = paymentEntries.value.filter(e => e.type === 'cash' || e.type === 'tiger')
  const transfers = paymentEntries.value.filter(e => e.type === 'transfer')
  const credits = paymentEntries.value.filter(e => e.type === 'credit')

  return {
    pos_id: posStore.posId,
    basket_id: props.basket.basket_id,
    doc_date: localDateISO(now),
    doc_time: now.toTimeString().slice(0, 5),
    creator_code: 'bizsuit',
    doc_format_code: props.orderData.doc_format_code || props.basket.doc_format_code || pos?.doc_format_code || '',
    form_code: props.orderData.form_code || props.basket.form_code || '',
    branch_code: pos?.branch_code || '',
    cust_code: props.orderData.cust_code || 'AR00001',
    emp_code: props.orderData.sale_code,
    shelf_code: pos?.pos_ic_shelf || '',
    remark: props.orderData.order_remark || '',
    inquiry_type: props.orderData.inquiry_type,
    vat_type: props.orderData.vat_type,
    vat_rate: props.orderData.vat_rate,
    discount_type: posStore.erpOption?.discout_type ?? 0,
    discount_word: props.orderData.discount_word,
    total_value: props.orderData.total_value,
    total_discount: props.orderData.total_discount,
    total_before_vat: props.orderData.total_before_vat ?? null,
    total_vat_value: props.orderData.vat_value ?? null,
    total_after_vat: props.orderData.total_after_vat ?? null,
    total_except_vat: props.orderData.total_except_vat ?? 0,
    total_amount: props.orderData.total_amount ?? null,
    total_net_amount: props.orderData.total_amount,
    cash_amount: cashEntries.reduce((s, e) => s + e.amount, 0),
    rounded_amount: roundedAmount.value || 0,
    total_income_amount: roundedAmount.value || 0,
    tranfer_amount: transfers.reduce((s, e) => s + e.amount, 0),
    card_amount: credits.reduce((s, e) => s + e.amount, 0),
    total_credit_charge: credits.reduce((s, e) => s + e.details.charge, 0),
    tiger_pending: tigerPending,
    tiger_order_id: tigerPending ? tigerId.value : '',
    tiger_ref1: tigerPending ? tigerRef1.value : '',
    tiger_ref2: tigerPending ? tigerRef2.value : '',
    tiger_amount: tigerPending ? tigerPayAmount.value : paymentEntries.value.filter(e => e.type === 'tiger').reduce((s, e) => s + e.amount, 0),
    wallet_amount: 0,
    payment_detail: [
      ...transfers.map(e => ({
        pay_type: '0',
        pay_amount: e.amount,
        trans_number: e.details.pass_book_code,
        bank_code: e.details.bank_code,
        bank_branch: e.details.bank_branch,
        charge: 0,
      })),
      ...credits.map(e => ({
        pay_type: '21',
        pay_amount: e.amount,
        trans_number: e.details.card_number,
        no_approved: e.details.no_approved,
        credit_card_type: e.details.credit_card_type,
        charge: e.details.charge,
      })),
    ],
    items: cartStore.items.map(item => {
      const fresh = props.orderData.fresh_prices[item.guid_code]
      const unitPrice = Number(fresh.price ?? 0)
      const discWord = fresh.default_discount || ''
      const { discount_amount, sum_amount } = calcDiscountAmount(unitPrice, item.qty, discWord)
      return {
        item_code: item.item_code,
        item_name: item.item_name,
        unit_code: item.unit_code,
        qty: item.qty,
        price: unitPrice,
        sum_amount,
        discount: discWord,
        discount_amount,
        tax_type: Number(item.tax_type ?? 0),
        item_type: item.item_type ?? '0',
        is_permium: item.is_permium,
        is_premium: item.is_premium,
        is_free: item.is_free,
        promotion_free: item.promotion_free,
        premium: item.premium,
        wh_code: item.wh_code || pos?.pos_ic_wht || '',
        shelf_code: item.shelf_code || pos?.pos_ic_shelf || '',
        stand_value: item.stand_value ?? 1,
        divide_value: item.divide_value ?? 1,
        ratio: item.ratio ?? 1,
        barcode: item.barcode || '',
        remark: item.remark || '',
      }
    }),
  }
}

async function save(options = {}) {
  if (saving.value) return
  if (saveBlockReason.value) {
    saveError.value = saveBlockReason.value
    if (!employeeCode.value) authStore.logout()
    return
  }
  saving.value = true
  saveError.value = ''
  try {
    await validateStockBeforeSave()
    const result = await saveTrans(buildSaveBody(options))
    if (result.success) {
      emit('complete', result.doc_no)
    } else {
      saveError.value = result.msg || 'บันทึกไม่สำเร็จ'
    }
  } catch (ex) {
    saveError.value = ex.message || 'เกิดข้อผิดพลาด'
  } finally {
    saving.value = false
  }
}

async function saveTigerPending() {
  if (!tigerId.value) return
  clearInterval(tigerPollInterval.value)
  await save({ tigerPending: true })
}
</script>

<template>
  <div class="payment-view">
    <!-- Header -->
    <div class="payment-header">
      <Button icon="pi pi-arrow-left" text rounded size="small" @click="emit('back')" aria-label="กลับ" />
      <span class="header-title">รับชำระเงิน</span>
    </div>

    <!-- ─── ขายเชื่อ ─────────────────────────────────────────────────────── -->
    <template v-if="isCreditSale">
      <div class="credit-body">
        <div class="credit-total-card">
          <div class="credit-total-label">ยอดที่ต้องชำระ</div>
          <div class="credit-total-value">{{ formatCurrency(totalDue) }}</div>
          <div class="credit-badge">
            <i class="pi pi-credit-card" />
            {{ saleTypeLabel }}
          </div>
        </div>
      </div>
    </template>

    <!-- ─── ขายสด ─────────────────────────────────────────────────────────── -->
    <template v-else>
      <!-- Summary bar -->
      <div class="summary-bar">
        <div class="summary-item">
          <span class="summary-label">ยอดสุทธิ</span>
          <span class="summary-total">{{ formatCurrency(totalDue) }}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">ชำระแล้ว</span>
          <span class="summary-paid">{{ formatCurrency(totalPaid) }}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">{{ change > 0 ? 'เงินทอน' : 'คงเหลือ' }}</span>
          <span :class="change > 0 ? 'summary-change' : 'summary-remaining'">
            {{ formatCurrency(change > 0 ? change : remaining) }}
          </span>
        </div>
      </div>

      <!-- ปัดเศษ -->
      <div class="rounding-bar">
        <label class="rounding-label">
          <i class="pi pi-percentage" />
          ปัดเศษ
        </label>
        <InputNumber
          v-model="roundedAmount"
          :min="0"
          :max-fraction-digits="2"
          :min-fraction-digits="2"
          suffix=" บาท"
          class="rounding-input"
          size="small"
        />
        <button
          v-if="remaining > 0 && remaining < 1"
          class="rounding-fill-btn"
          @click="roundedAmount = rnd((roundedAmount || 0) + remaining, 2)"
        >เติมเศษ {{ formatCurrency(remaining) }}</button>
      </div>

      <!-- Payment entries list -->
      <div class="entries-section">
        <div v-if="paymentEntries.length === 0" class="entries-empty">ยังไม่มีรายการชำระเงิน</div>
        <div v-else class="entries-list">
          <div v-for="entry in paymentEntries" :key="entry.id" class="entry-row">
            <div class="entry-icon-wrap">
              <i :class="entry.type === 'cash' ? 'pi pi-money-bill' : entry.type === 'transfer' ? 'pi pi-send' : 'pi pi-credit-card'" class="entry-icon" />
            </div>
            <div class="entry-info">
              <div class="entry-label">{{ entry.label }}</div>
              <div v-if="entry.type === 'credit'" class="entry-sub">
                ค่าธรรมเนียม {{ formatCurrency(entry.details.charge) }} / รวม {{ formatCurrency(entry.details.sum_amount) }}
              </div>
            </div>
            <span class="entry-amount">{{ formatCurrency(entry.amount) }}</span>
            <Button icon="pi pi-times" text rounded size="small" class="entry-remove" @click="removeEntry(entry.id)" />
          </div>
        </div>
      </div>

      <!-- Add payment panel -->
      <div class="add-payment-panel">
        <!-- Type tabs -->
        <div class="type-tabs">
          <button
            v-for="tab in paymentTabs"
            :key="tab.key"
            class="type-tab"
            :class="{ 'type-tab-active': activeType === tab.key }"
            @click="activeType = tab.key"
          >
            <i :class="tab.icon" />
            {{ tab.label }}
          </button>
        </div>

        <div class="type-form">
          <!-- เงินสด -->
          <template v-if="activeType === 'cash'">
            <!-- denomination shortcuts -->
            <div class="denom-row">
              <button
                v-for="d in DENOMS"
                :key="d"
                class="denom-btn"
                @click="addDenom(d)"
              >฿{{ d >= 1000 ? (d / 1000) + 'K' : d }}</button>
              <button
                class="denom-btn denom-exact"
                :disabled="remaining <= 0"
                @click="cashAmount = remaining"
              >พอดี</button>
            </div>
            <div class="form-row">
              <label class="form-label">จำนวนรับ</label>
              <InputNumber
                v-model="cashAmount"
                input-id="payment-cash-amount"
                :min="0"
                :max-fraction-digits="2"
                :min-fraction-digits="2"
                suffix=" บาท"
                class="form-input"
                size="small"
              />
            </div>
            <Button data-testid="payment-add-cash" label="เพิ่มรายการ" icon="pi pi-plus" size="small" class="add-btn" @click="addCash" :disabled="!cashAmount || cashAmount <= 0" />
          </template>

          <!-- โอน -->
          <template v-else-if="activeType === 'transfer'">
            <div class="form-row">
              <label class="form-label">วันที่โอน</label>
              <IsoDatePicker v-model="transferDate" class="form-input" size="small" />
            </div>
            <div class="form-row">
              <label class="form-label">สมุดเงินฝาก</label>
              <Select
                v-model="transferPassBook"
                :options="passBooks"
                option-label="book_name"
                placeholder="เลือกสมุดเงินฝาก"
                class="form-input"
                size="small"
              >
                <template #option="{ option }">
                  <div class="book-option">
                    <div class="book-name">{{ option.book_name }}</div>
                    <div class="book-sub">{{ option.bank_name || option.bank_code }} {{ option.branch_name ? '/ ' + option.branch_name : '' }}</div>
                  </div>
                </template>
                <template #value="{ value }">
                  <span v-if="value">{{ value.book_name }} ({{ value.bank_name || value.bank_code }})</span>
                  <span v-else class="placeholder-text">เลือกสมุดเงินฝาก</span>
                </template>
              </Select>
            </div>
            <div class="form-row">
              <label class="form-label">จำนวนเงิน</label>
              <InputNumber
                v-model="transferAmount"
                :min="0"
                :max-fraction-digits="2"
                :min-fraction-digits="2"
                suffix=" บาท"
                class="form-input"
                size="small"
              />
            </div>
            <button v-if="remaining > 0" class="fill-remaining-btn" @click="transferAmount = remaining">
              คงเหลือ {{ formatCurrency(remaining) }}
            </button>
            <Button label="เพิ่มรายการ" icon="pi pi-plus" size="small" class="add-btn" @click="addTransfer" :disabled="!transferPassBook || !transferAmount || transferAmount <= 0" />
          </template>

          <!-- บัตรเครดิต -->
          <template v-else-if="activeType === 'credit'">
            <div class="form-row">
              <label class="form-label">ประเภทบัตร</label>
              <Select
                v-model="selectedCreditType"
                :options="creditTypes"
                option-label="name_1"
                placeholder="เลือกประเภทบัตร"
                class="form-input"
                size="small"
              >
                <template #option="{ option }">
                  <div class="ct-option">
                    <span class="ct-name">{{ option.name_1 }}</span>
                    <span class="ct-rate">{{ option.charge_rate }}%</span>
                  </div>
                </template>
              </Select>
            </div>
            <div class="form-row">
              <label class="form-label">เลขที่บัตร</label>
              <InputText v-model="creditCardNumber" placeholder="เลขที่บัตรเครดิต" class="form-input" size="small" />
            </div>
            <div class="form-row">
              <label class="form-label">เลขที่อนุมัติ</label>
              <InputText v-model="creditApprovalNo" placeholder="รหัสอนุมัติ" class="form-input" size="small" />
            </div>
            <div class="form-row">
              <label class="form-label">จำนวนเงิน</label>
              <InputNumber
                v-model="creditAmount"
                :min="0"
                :max-fraction-digits="2"
                :min-fraction-digits="2"
                suffix=" บาท"
                class="form-input"
                size="small"
              />
            </div>
            <button v-if="remaining > 0" class="fill-remaining-btn" @click="creditAmount = remaining">
              คงเหลือ {{ formatCurrency(remaining) }}
            </button>
            <div v-if="selectedCreditType && creditAmount > 0" class="credit-calc">
              <div class="calc-row">
                <span class="calc-label">ค่าธรรมเนียม ({{ creditChargeRate }}%)</span>
                <span class="calc-value">{{ formatCurrency(creditCharge) }}</span>
              </div>
              <div class="calc-row calc-total">
                <span class="calc-label">รวมทั้งสิ้น</span>
                <span class="calc-value">{{ formatCurrency(creditSumAmount) }}</span>
              </div>
            </div>
            <Button label="เพิ่มรายการ" icon="pi pi-plus" size="small" class="add-btn" @click="addCredit" :disabled="!selectedCreditType || !creditAmount || creditAmount <= 0" />
          </template>

          <!-- Tiger -->
          <template v-else-if="activeType === 'tiger'">
            <div class="tiger-panel">

              <!-- idle: แสดงปุ่มส่งคำสั่ง -->
              <div v-if="tigerStatus === 'idle'" class="tiger-idle">
                <div class="tiger-amount-label">ยอดชำระ</div>
                <div class="tiger-amount-value">{{ formatCurrency(tigerPayAmount) }}</div>
                <Button label="ส่งคำสั่งชำระที่เครื่อง Tiger" icon="pi pi-desktop" class="w-full" @click="startTigerPayment" />
              </div>

              <!-- requesting: กำลังสร้าง order -->
              <div v-else-if="tigerStatus === 'requesting'" class="tiger-status">
                <i class="pi pi-spin pi-spinner tiger-spinner" />
                <span>กำลังส่งคำสั่งไปเครื่อง Tiger...</span>
              </div>

              <!-- waiting / processing: แสดงในรูปแบบ Dialog กลางจอ ปิดไม่ได้ — ดูด้านล่าง -->
              <div v-else-if="tigerStatus === 'waiting' || tigerStatus === 'processing'" class="tiger-status">
                <i class="pi pi-spin pi-spinner tiger-spinner" />
                <span>กำลังรอการชำระเงินที่เครื่อง Tiger...</span>
              </div>

              <!-- success: ชำระสำเร็จ กำลัง save -->
              <div v-else-if="tigerStatus === 'success'" class="tiger-status tiger-success">
                <i class="pi pi-check-circle tiger-check" />
                <span>ชำระเงินสำเร็จ กำลังบันทึก...</span>
              </div>

              <!-- cancel: Tiger ยกเลิกจากเครื่อง -->
              <div v-else-if="tigerStatus === 'cancel'" class="tiger-status tiger-error">
                <i class="pi pi-times-circle tiger-err-icon" />
                <span>การชำระเงินถูกยกเลิกจากเครื่อง Tiger</span>
                <Button label="ลองใหม่" size="small" severity="secondary" @click="tigerStatus = 'idle'" />
              </div>

              <!-- failed: ล้มเหลว -->
              <div v-else class="tiger-status tiger-error">
                <i class="pi pi-times-circle tiger-err-icon" />
                <span>{{ tigerError || 'การชำระเงินล้มเหลว' }}</span>
                <Button label="ลองใหม่" size="small" severity="secondary" @click="tigerStatus = 'idle'" />
              </div>

            </div>
          </template>
        </div>
      </div>
    </template>

    <!-- Tiger payment dialog: กลางจอ, ปิดไม่ได้จนกว่าจะยกเลิก/สำเร็จ/ถูกยกเลิกจากเครื่อง -->
    <Dialog
      :visible="tigerStatus === 'waiting' || tigerStatus === 'processing'"
      modal
      :closable="false"
      :close-on-escape="false"
      :draggable="false"
      :header="TIGER_MOCK ? '🧪 TEST MODE — กรุณาชำระที่เครื่องรับเงิน' : 'กรุณาชำระที่เครื่องรับเงิน'"
      :style="{ width: '420px', maxWidth: '95vw' }"
    >
      <div class="tiger-dialog-body">
        <div v-if="TIGER_MOCK" class="tiger-mock-banner">
          กำลังจำลองการชำระเงิน — จะสำเร็จอัตโนมัติใน ~5 วินาที (ไม่มีการเรียก API จริง)
        </div>
        <i class="pi pi-spin pi-spinner tiger-spinner" />
        <div class="tiger-amount-value">{{ formatCurrency(tigerPayAmount) }}</div>
        <div class="tiger-info-box">
          <div class="tiger-info-row">
            <span class="tiger-info-label">Transaction ID:</span>
            <span class="tiger-info-val">{{ tigerId }}</span>
          </div>
          <div class="tiger-info-row">
            <span class="tiger-info-label">รหัส:</span>
            <span class="tiger-info-val">{{ posStore.posId }} - {{ orderData.cust_name || 'ลูกค้าทั่วไป' }}</span>
          </div>
        </div>
      </div>
      <template #footer>
        <Button
          label="ปิดเอกสารไว้ก่อน"
          severity="warning"
          icon="pi pi-clock"
          :loading="saving"
          :disabled="saving"
          @click="saveTigerPending"
        />
        <Button
          v-if="tigerCancel"
          label="ยกเลิก"
          severity="secondary"
          icon="pi pi-times"
          :disabled="saving"
          @click="cancelTiger"
        />
      </template>
    </Dialog>

    <!-- Footer -->
    <div class="payment-footer">
      <div v-if="saveError || saveBlockReason" class="save-error">
        <i class="pi pi-exclamation-circle" />
        {{ saveError || saveBlockReason }}
      </div>
      <Button
        data-testid="payment-save-document"
        :label="saving ? 'กำลังบันทึก...' : 'บันทึกเอกสาร'"
        icon="pi pi-check"
        icon-pos="right"
        :loading="saving"
        :disabled="!canSave"
        class="w-full"
        size="large"
        @click="save"
      />
    </div>
  </div>
</template>

<style scoped>
.payment-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
}

.payment-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--p-surface-border);
  flex-shrink: 0;
}

.header-title {
  font-size: 1.05rem;
  font-weight: 600;
}

/* ─── ขายเชื่อ ─── */
.credit-body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem 1rem;
}

.credit-total-card {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

.credit-total-label {
  font-size: 0.95rem;
  color: var(--p-text-color-secondary);
}

.credit-total-value {
  font-size: 2.25rem;
  font-weight: 700;
  color: var(--p-primary-color);
}

.credit-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: #eff6ff;
  color: #1d4ed8;
  border: 1px solid #bfdbfe;
  border-radius: 999px;
  padding: 0.3rem 0.85rem;
  font-size: 0.83rem;
  font-weight: 500;
}

/* ─── Summary bar ─── */
.summary-bar {
  display: flex;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  background: var(--p-surface-ground);
  border-bottom: 1px solid var(--p-surface-border);
  flex-shrink: 0;
  gap: 0.5rem;
}

.summary-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  flex: 1;
}

.summary-label {
  font-size: 0.72rem;
  color: var(--p-text-color-secondary);
}

.summary-total {
  font-size: 1rem;
  font-weight: 700;
  color: var(--p-primary-color);
}

.summary-paid {
  font-size: 1rem;
  font-weight: 600;
  color: #16a34a;
}

.summary-remaining {
  font-size: 1rem;
  font-weight: 600;
  color: #dc2626;
}

.summary-change {
  font-size: 1rem;
  font-weight: 600;
  color: #16a34a;
}

/* ─── ปัดเศษ ─── */
.rounding-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: var(--p-surface-0, #fff);
  border-bottom: 1px solid var(--p-surface-border);
  flex-shrink: 0;
}

.rounding-label {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.83rem;
  color: var(--p-text-color-secondary);
  flex-shrink: 0;
}

.rounding-input {
  flex: 1;
  min-width: 0;
  max-width: 10rem;
}

.rounding-fill-btn {
  border: 1px dashed var(--p-primary-color);
  border-radius: 6px;
  background: transparent;
  color: var(--p-primary-color);
  font-size: 0.78rem;
  font-weight: 500;
  padding: 0.25rem 0.625rem;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  transition: background 0.12s;
}

.rounding-fill-btn:hover {
  background: var(--p-primary-50, #eff6ff);
}

/* ─── Entries list ─── */
.entries-section {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 0.5rem 1rem;
}

.entries-empty {
  text-align: center;
  color: var(--p-text-color-secondary);
  font-size: 0.85rem;
  padding: 1.5rem 0;
}

.entries-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.entry-row {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  background: var(--p-surface-ground);
  border-radius: 8px;
  padding: 0.5rem 0.75rem;
}

.entry-icon-wrap {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--p-surface-200, #e2e8f0);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.entry-icon { font-size: 0.85rem; color: var(--p-text-color-secondary); }

.entry-info {
  flex: 1;
  min-width: 0;
}

.entry-label {
  font-size: 0.875rem;
  font-weight: 500;
}

.entry-sub {
  font-size: 0.72rem;
  color: var(--p-text-color-secondary);
  margin-top: 1px;
}

.entry-amount {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--p-primary-color);
  flex-shrink: 0;
}

.entry-remove { flex-shrink: 0; }

/* ─── Add payment panel ─── */
.add-payment-panel {
  border-top: 1px solid var(--p-surface-border);
  flex-shrink: 0;
  background: var(--p-surface-0, #fff);
  max-height: 50vh;
  overflow-y: auto;
}

.type-tabs {
  display: flex;
  border-bottom: 1px solid var(--p-surface-border);
}

.type-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  padding: 0.625rem 0.5rem;
  border: none;
  background: none;
  font-size: 0.83rem;
  color: var(--p-text-color-secondary);
  cursor: pointer;
  font-family: inherit;
  border-bottom: 2px solid transparent;
  transition: color 0.15s, border-color 0.15s;
}

.type-tab-active {
  color: var(--p-primary-color);
  border-bottom-color: var(--p-primary-color);
  font-weight: 600;
}

.type-tab .pi { font-size: 0.78rem; }

.type-form {
  padding: 0.75rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.form-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.form-label {
  font-size: 0.83rem;
  color: var(--p-text-color-secondary);
  width: 6rem;
  flex-shrink: 0;
}

.form-input {
  flex: 1;
  min-width: 0;
}

.add-btn {
  align-self: flex-end;
}

/* denomination shortcuts */
.denom-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.denom-btn {
  flex: 1;
  min-width: 3rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--p-surface-border);
  border-radius: 6px;
  background: var(--p-surface-ground);
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--p-text-color);
  cursor: pointer;
  font-family: inherit;
  transition: background 0.12s, border-color 0.12s;
}

.denom-btn:hover:not(:disabled) {
  background: var(--p-primary-50, #eff6ff);
  border-color: var(--p-primary-color);
  color: var(--p-primary-color);
}

.denom-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.denom-exact {
  background: var(--p-primary-color);
  border-color: var(--p-primary-color);
  color: #fff;
}

.denom-exact:hover:not(:disabled) {
  background: var(--p-primary-600, #2563eb);
  border-color: var(--p-primary-600, #2563eb);
  color: #fff;
}

/* fill remaining button */
.fill-remaining-btn {
  align-self: flex-start;
  border: 1px dashed var(--p-primary-color);
  border-radius: 6px;
  background: transparent;
  color: var(--p-primary-color);
  font-size: 0.78rem;
  font-weight: 500;
  padding: 0.25rem 0.625rem;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.12s;
}

.fill-remaining-btn:hover {
  background: var(--p-primary-50, #eff6ff);
}

/* credit calc */
.credit-calc {
  background: var(--p-surface-ground);
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.calc-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.82rem;
  color: var(--p-text-color-secondary);
}

.calc-total .calc-label,
.calc-total .calc-value {
  font-weight: 600;
  color: var(--p-text-color);
}

/* book / credit type option */
.book-option {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.book-name { font-size: 0.875rem; font-weight: 500; }
.book-sub { font-size: 0.72rem; color: var(--p-text-color-secondary); }

.ct-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  width: 100%;
}

.ct-name { font-size: 0.875rem; }
.ct-rate { font-size: 0.78rem; color: var(--p-text-color-secondary); }

.placeholder-text { color: var(--p-text-color-secondary); }

/* ─── Footer ─── */
.payment-footer {
  border-top: 2px solid var(--p-surface-border);
  padding: 0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom));
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  background: var(--p-surface-0, #fff);
  position: sticky;
  bottom: 0;
  z-index: 5;
}

.save-error {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.83rem;
  color: #dc2626;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
}

.w-full { width: 100%; }

/* ─── Tiger ─── */
.tiger-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0;
}

.tiger-idle {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
}

.tiger-amount-label {
  font-size: 0.83rem;
  color: var(--p-text-color-secondary);
}

.tiger-amount-value {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--p-primary-color);
}

.tiger-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.625rem;
  text-align: center;
  font-size: 0.9rem;
}

.tiger-spinner {
  font-size: 1.75rem;
  color: var(--p-primary-color);
}

.tiger-wait-text {
  font-size: 0.9rem;
  color: var(--p-text-color-secondary);
}

.tiger-success {
  color: #16a34a;
}

.tiger-check {
  font-size: 2rem;
  color: #16a34a;
}

.tiger-error {
  color: #dc2626;
}

.tiger-err-icon {
  font-size: 2rem;
  color: #dc2626;
}

.tiger-info-box {
  width: 100%;
  background: var(--p-surface-ground);
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
  padding: 0.625rem 0.875rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.tiger-info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.82rem;
}

.tiger-info-label {
  color: var(--p-text-color-secondary);
  flex-shrink: 0;
}

.tiger-info-val {
  font-weight: 600;
  color: var(--p-text-color);
  text-align: right;
  word-break: break-all;
}

.tiger-dialog-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 0.5rem 0.25rem 0.25rem;
}

.tiger-dialog-body .tiger-spinner {
  font-size: 2rem;
  color: var(--p-primary-color);
}

.tiger-dialog-body .tiger-amount-value {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--p-text-color);
}

.tiger-dialog-body .tiger-info-box {
  width: 100%;
}

.tiger-mock-banner {
  width: 100%;
  background: #fff7e6;
  color: #ad6800;
  border: 1px dashed #ffa940;
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  font-size: 0.8rem;
  text-align: center;
}
</style>
