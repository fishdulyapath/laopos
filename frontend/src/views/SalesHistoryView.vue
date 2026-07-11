<script setup>
import { computed, ref, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { getDocSaleHistory, getSalePrintForms, getSalePrintUrl, getSalePosSlipPrintUrl } from '@/services/salesService'
import { verifyPriceEditPermission } from '@/services/sellService'
import { checkNextTigerPendingPayment, mockTigerPendingPaid } from '@/services/tigerService'
import { useAuthStore } from '@/stores/auth'
import { usePosStore } from '@/stores/pos'
import { todayISO, toISO } from '@/utils/formatters'
import { PERMISSIONS } from '@/utils/permissions'
import SalesFilterBar from '@/components/sales/SalesFilterBar.vue'
import SalesTotalSummary from '@/components/sales/SalesTotalSummary.vue'
import SalesTable from '@/components/sales/SalesTable.vue'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'
import ProgressSpinner from 'primevue/progressspinner'
import { useToast } from 'primevue/usetoast'

const props = defineProps({
  title: { type: String, default: '' },
})

const toast = useToast()
const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const posStore = usePosStore()
const { t, locale } = useI18n()
function tl(th, en, lo = en) {
  const lang = String(locale.value || 'th').toLowerCase()
  if (lang.startsWith('en')) return en
  if (lang.startsWith('lo')) return lo
  return th
}
const filterBar = ref(null)

const rows = ref([])
const loading = ref(false)
const errorMsg = ref('')
const currentParams = ref(null)
const checkingTiger = ref(false)
const mockingTigerDocNo = ref('')
let tigerPendingTimer = null
const pageTitle = computed(() => props.title || t('salesHistory.title'))

// print dialog state
const printDialogVisible = ref(false)
const printLoading = ref(false)
const printError = ref('')
const printForms = ref([])
const selectedPrintForm = ref('')
const printDocNo = ref('')

// permission dialog (ตรวจสิทธิ์ด้วย user/password เหมือน dialog แก้ไขส่วนลดท้ายบิล/แก้ไขราคา)
const permissionDialogVisible = ref(false)
const permissionUser = ref('')
const permissionPassword = ref('')
const permissionLoading = ref(false)
const permissionError = ref('')
const permissionActionLabel = ref('')
const permissionHeader = ref('')
const permissionHelpText = ref('')
const permissionDeniedText = ref('')
const permissionAction = ref(null)

const allowedSaleKinds = computed(() => {
  if (!authStore.hasPermission(PERMISSIONS.salesCashView)) return []
  return ['cash', 'credit']
})

const canDetail = computed(() => authStore.hasPermission(PERMISSIONS.salesCashDetail))
const canPrint = computed(() => authStore.hasPermission(PERMISSIONS.salesCashPrint))
const canEdit = computed(() => authStore.hasPermission(PERMISSIONS.salesCashEdit))

function normalizeSaleKind(value) {
  if (['cash', 'credit'].includes(value) && allowedSaleKinds.value.includes(value)) return value
  return allowedSaleKinds.value.length === 1 ? allowedSaleKinds.value[0] : ''
}

const initialSaleKind = computed(() => {
  const saleKind = String(route.query.sale_kind || '')
  return normalizeSaleKind(saleKind)
})

function defaultParams() {
  const today = todayISO()
  return { from_date: today, to_date: today, sale_kind: initialSaleKind.value, pos_id: String(posStore.posId || '') }
}

async function loadSales(params) {
  loading.value = true
  errorMsg.value = ''
  const normalizedParams = {
    ...params,
    sale_kind: normalizeSaleKind(String(params?.sale_kind || '')),
    branch_code: posStore.selectedPos?.branch_code || '',
    pos_id: String(params?.pos_id || ''),
  }
  currentParams.value = normalizedParams
  try {
    rows.value = await getDocSaleHistory(normalizedParams)
  } catch (err) {
    errorMsg.value = err.message
    rows.value = []
  } finally {
    loading.value = false
  }
}

function onSearch(params) {
  loadSales(params)
}

function onViewDoc(doc) {
  const docNo = String(doc?.doc_no || '').trim()
  if (!docNo) return
  router.push({ name: 'Sell', query: { doc_no: docNo, view: '1' } })
}

function requestPriceEditPermissionAction({ actionLabel, header, action }) {
  if (typeof action !== 'function') return
  permissionActionLabel.value = actionLabel
  permissionHeader.value = header
  permissionHelpText.value = ''
  permissionDeniedText.value = tl('ผู้ใช้นี้ไม่มีสิทธิ์แก้ไขราคา/ส่วนลด', 'This user cannot edit price or discount', 'ຜູ້ໃຊ້ນີ້ບໍ່ມີສິດແກ້ໄຂລາຄາ/ສ່ວນຫຼຸດ')
  permissionAction.value = action
  permissionUser.value = ''
  permissionPassword.value = ''
  permissionError.value = ''
  permissionDialogVisible.value = true
}

function closePermissionDialog() {
  if (permissionLoading.value) return
  permissionDialogVisible.value = false
  permissionAction.value = null
  permissionPassword.value = ''
  permissionError.value = ''
}

async function submitPermission() {
  if (permissionLoading.value) return
  const userCode = String(permissionUser.value || '').trim()
  const password = String(permissionPassword.value || '')
  if (!userCode || !password) {
    permissionError.value = tl('กรุณาระบุรหัสผู้ใช้และรหัสผ่าน', 'Please enter user code and password', 'ກະລຸນາລະບຸລະຫັດຜູ້ໃຊ້ແລະລະຫັດຜ່ານ')
    return
  }
  permissionLoading.value = true
  permissionError.value = ''
  try {
    const result = await verifyPriceEditPermission(userCode, password)
    if (!result?.allowed) {
      permissionError.value = permissionDeniedText.value
      return
    }
    const action = permissionAction.value
    permissionDialogVisible.value = false
    permissionAction.value = null
    permissionPassword.value = ''
    if (typeof action === 'function') action()
  } catch (error) {
    permissionError.value = error?.data?.msg || error.message || tl('รหัสผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', 'Invalid user code or password', 'ລະຫັດຜູ້ໃຊ້ ຫຼື ລະຫັດຜ່ານບໍ່ຖືກຕ້ອງ')
  } finally {
    permissionLoading.value = false
  }
}

function requestEditDoc(doc) {
  const docNo = String(doc?.doc_no || '').trim()
  if (!docNo) return
  requestPriceEditPermissionAction({
    actionLabel: tl('แก้ไขเอกสาร', 'Edit document', 'ແກ້ໄຂເອກະສານ') + ' ' + docNo,
    header: tl('ยืนยันสิทธิ์แก้ไขเอกสาร', 'Authorize document edit', 'ຢືນຢັນສິດແກ້ໄຂເອກະສານ'),
    action: () => onEditDoc(doc),
  })
}

function onEditDoc(doc) {
  const docNo = String(doc?.doc_no || '').trim()
  if (!docNo) return
  router.push({ name: 'Sell', query: { doc_no: docNo } })
}

function configuredDocumentPrinter() {
  const cfg = posStore.deviceConfig || {}
  const mode = String(cfg.printer_mode || 'html').toLowerCase()
  const printerName = String(cfg.printer_name || '').trim()
  if (mode === 'none' || !printerName) return null
  return { mode, printerName }
}

function isPosSlipFormCode(formCode) {
  return String(formCode || '').trim().toUpperCase() === 'CR-0088'
}

async function printSaleDocumentForm(docNo, formCode, { silentWhenConfigured = false } = {}) {
  const code = String(formCode || '').trim()
  if (!docNo || !code) return false
  const printUrl = isPosSlipFormCode(code)
    ? getSalePosSlipPrintUrl(docNo, authStore.employee?.user_code || '')
    : getSalePrintUrl(docNo, [code], authStore.employee?.user_code || '')
  const printer = configuredDocumentPrinter()
  if (window.bizsuitDevices?.printUrl) {
    try {
      const url = new URL(printUrl, window.location.href)
      url.searchParams.set('auto_print', '0')
      const printOptions = printer
        ? { printerName: printer.printerName, silent: true, docName: `${docNo}-${code}` }
        : { silent: silentWhenConfigured ? false : undefined }
      await window.bizsuitDevices.printUrl(url.toString(), printOptions)
      toast.add({
        severity: 'success',
        summary: t('salesHistory.print'),
        detail: tl('ส่งงานพิมพ์แล้ว', 'Print job sent', 'ສົ່ງວຽກພິມແລ້ວ'),
        life: 1800,
      })
      return true
    } catch (error) {
      toast.add({
        severity: 'warn',
        summary: t('salesHistory.print'),
        detail: error.message || tl('พิมพ์ผ่านเครื่องลูกข่ายไม่สำเร็จ', 'Client printer failed', 'ພິມຜ່ານເຄື່ອງລູກຂ່າຍບໍ່ສຳເລັດ'),
        life: 3000,
      })
      return false
    }
  }
  window.open(printUrl, '_blank', 'noopener')
  return true
}

function requestPrintDoc(doc) {
  const docNo = String(doc?.doc_no || '').trim()
  if (!docNo || printLoading.value) return
  requestPriceEditPermissionAction({
    actionLabel: tl('พิมพ์เอกสาร', 'Print document', 'ພິມເອກະສານ') + ' ' + docNo,
    header: tl('ยืนยันสิทธิ์พิมพ์เอกสาร', 'Authorize document print', 'ຢືນຢັນສິດພິມເອກະສານ'),
    action: () => onPrintDoc(doc),
  })
}

async function onPrintDoc(doc) {
  const docNo = String(doc?.doc_no || '').trim()
  if (!docNo || printLoading.value) return
  printDocNo.value = docNo
  printLoading.value = true
  printError.value = ''
  printForms.value = []
  selectedPrintForm.value = ''
  try {
    const result = await getSalePrintForms(docNo)
    const forms = result?.forms || []
    printForms.value = forms
    const available = forms.filter((f) => f.available)
    if (forms.length === 1 && available.length === 1) {
      await printSaleDocumentForm(docNo, available[0].formcode, { silentWhenConfigured: true })
      return
    }
    selectedPrintForm.value = available.find((f) => f.is_default)?.formcode || available[0]?.formcode || ''
    if (!forms.length) {
      printError.value = t('salesHistory.printFormMissing')
    } else if (!selectedPrintForm.value) {
      printError.value = t('salesHistory.noAvailablePrintForms')
    }
    printDialogVisible.value = true
  } catch (err) {
    printError.value = err.message || t('salesHistory.loadPrintFormsFailed')
    printDialogVisible.value = true
  } finally {
    printLoading.value = false
  }
}

async function confirmPrintForms() {
  if (!printDocNo.value || !selectedPrintForm.value) return
  const printed = await printSaleDocumentForm(printDocNo.value, selectedPrintForm.value, { silentWhenConfigured: true })
  if (printed) printDialogVisible.value = false
}

async function checkTigerPendingOnce() {
  if (checkingTiger.value) return
  checkingTiger.value = true
  try {
    const result = await checkNextTigerPendingPayment()
    if (result?.checked && currentParams.value) {
      await loadSales(currentParams.value)
    }
  } catch {
    // เครื่อง Tiger อาจไม่พร้อมเป็นช่วง ๆ ให้รอบถัดไปลองใหม่
  } finally {
    checkingTiger.value = false
  }
}

async function reloadCurrentSales() {
  if (currentParams.value) await loadSales(currentParams.value)
}

async function onTigerMockPaid(doc) {
  if (!doc?.doc_no || mockingTigerDocNo.value) return
  mockingTigerDocNo.value = doc.doc_no
  try {
    const result = await mockTigerPendingPaid({ doc_no: doc.doc_no })
    if (result?.paid) {
      toast.add({ severity: 'success', summary: t('dashboard.tigerMockPaid'), detail: doc.doc_no, life: 2500 })
      await reloadCurrentSales()
    } else if (result?.busy) {
      toast.add({ severity: 'warn', summary: t('dashboard.tigerBusy'), detail: t('dashboard.retryAgain'), life: 2500 })
    }
  } catch (err) {
    toast.add({ severity: 'error', summary: t('dashboard.tigerMockFailed'), detail: err.message, life: 3000 })
  } finally {
    mockingTigerDocNo.value = ''
  }
}

onMounted(() => {
  if (!posStore.posList.length) void posStore.loadPosList()
  loadSales(defaultParams())
  tigerPendingTimer = setInterval(checkTigerPendingOnce, 9000)
  checkTigerPendingOnce()
})

onUnmounted(() => clearInterval(tigerPendingTimer))

watch(initialSaleKind, (saleKind) => {
  const nextParams = { ...(currentParams.value || defaultParams()), sale_kind: saleKind }
  loadSales(nextParams)
})
</script>

<template>
  <div class="sales-history biz-page">


    <SalesFilterBar
      ref="filterBar"
      :initial-sale-kind="initialSaleKind"
      :allowed-sale-kinds="allowedSaleKinds"
      :initial-from-date="defaultParams().from_date"
      :initial-to-date="defaultParams().to_date"
      :initial-pos-id="posStore.posId"
      :pos-options="posStore.posList"
      @search="onSearch"
    />

    <Message v-if="errorMsg" severity="error" :closable="false" class="mt-1">{{ errorMsg }}</Message>

    <div class="biz-data-surface">
      <SalesTable
        :rows="rows"
        :loading="loading"
        :mocking-doc-no="mockingTigerDocNo"
        :can-detail="canDetail"
        :can-print="canPrint"
        :can-edit="canEdit"
        @print-doc="requestPrintDoc"
        @view-doc="onViewDoc"
        @edit-doc="requestEditDoc"
        @tiger-mock-paid="onTigerMockPaid"
      />
    </div>

    <Dialog
      :visible="printDialogVisible"
      :header="t('salesHistory.printFormSelect')"
      modal
      :draggable="false"
      :style="{ width: 'min(460px, 95vw)' }"
      @update:visible="printDialogVisible = $event"
    >
      <div class="print-dialog-body">
        <div class="print-doc-no">{{ printDocNo }}</div>
        <div v-if="printLoading" class="print-loading">
          <ProgressSpinner style="width: 32px; height: 32px" />
        </div>
        <Message v-else-if="printError" severity="error" :closable="false">{{ printError }}</Message>
        <div v-else class="print-form-list">
          <label
            v-for="form in printForms"
            :key="form.formcode"
            class="print-form-row"
            :class="{ disabled: !form.available }"
          >
            <input
              v-model="selectedPrintForm"
              type="radio"
              name="sales-history-print-form"
              :value="form.formcode"
              :disabled="!form.available"
            />
            <span>
              <strong>{{ form.formname }}</strong>
              <small>{{ form.formcode }}<template v-if="!form.available"> · {{ t('salesHistory.formNotFound') }}</template></small>
            </span>
          </label>
        </div>
      </div>
      <template #footer>
        <Button :label="t('sell.cancel')" severity="secondary" outlined @click="printDialogVisible = false" />
        <Button
          :label="t('salesHistory.print')"
          icon="pi pi-print"
          :disabled="printLoading || !selectedPrintForm"
          @click="confirmPrintForms"
        />
      </template>
    </Dialog>

    <Dialog
      :visible="permissionDialogVisible"
      :header="permissionHeader || tl('ยืนยันสิทธิ์', 'Authorize action', 'ຢືນຢັນສິດ')"
      modal
      :draggable="false"
      class="price-permission-dialog"
      :style="{ width: 'min(460px, 94vw)' }"
      @update:visible="($event) => ($event ? (permissionDialogVisible = true) : closePermissionDialog())"
    >
      <div class="permission-dialog-body">
        <div class="permission-dialog-intro">
          <i class="pi pi-lock" />
          <div>
            <strong>{{ permissionActionLabel }}</strong>
            <span>{{ permissionHelpText }}</span>
          </div>
        </div>
        <Message v-if="permissionError" severity="warn" :closable="false">{{ permissionError }}</Message>
        <label class="field">
          <span>{{ tl('รหัสผู้ใช้', 'User code', 'ລະຫັດຜູ້ໃຊ້') }}</span>
          <InputText v-model.trim="permissionUser" autofocus autocomplete="off" @keyup.enter="submitPermission" />
        </label>
        <label class="field">
          <span>{{ tl('รหัสผ่าน', 'Password', 'ລະຫັດຜ່ານ') }}</span>
          <InputText v-model="permissionPassword" type="password" autocomplete="off" @keyup.enter="submitPermission" />
        </label>
      </div>
      <template #footer>
        <Button :label="tl('ยกเลิก', 'Cancel', 'ຍົກເລີກ')" severity="secondary" outlined :disabled="permissionLoading" @click="closePermissionDialog" />
        <Button :label="tl('ยืนยัน', 'Authorize', 'ຢືນຢັນ')" icon="pi pi-check" :loading="permissionLoading" @click="submitPermission" />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.sales-history {
  padding: 0;
}

.mt-1 {
  margin-top: 0.25rem;
}

.print-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-height: 80px;
}

.permission-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.permission-dialog-intro {
  display: flex;
  gap: 0.65rem;
  align-items: flex-start;
}

.permission-dialog-intro i {
  margin-top: 0.15rem;
  font-size: 1.1rem;
  color: var(--p-primary-color);
}

.permission-dialog-intro strong {
  display: block;
  font-size: 0.98rem;
}

.permission-dialog-intro span {
  font-size: 0.85rem;
  color: var(--p-text-color-secondary);
}

.permission-dialog-body .field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.permission-dialog-body .field > span {
  font-size: 0.85rem;
  font-weight: 600;
}

.permission-dialog-body .field :deep(.p-inputtext) {
  width: 100%;
}

.print-doc-no {
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--p-text-color-secondary);
}

.print-loading {
  display: flex;
  justify-content: center;
  padding: 1rem 0;
}

.print-form-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.print-form-row {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  cursor: pointer;
  padding: 0.35rem 0.5rem;
  border-radius: 6px;
  transition: background 0.15s;
}

.print-form-row:hover:not(.disabled) {
  background: var(--p-surface-hover);
}

.print-form-row.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.print-form-row span {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.print-form-row small {
  color: var(--p-text-color-secondary);
  font-size: 0.78rem;
}

@media (max-width: 768px) {
  .sales-history {
    gap: 0.75rem;
    padding: 0;
  }
}
</style>
