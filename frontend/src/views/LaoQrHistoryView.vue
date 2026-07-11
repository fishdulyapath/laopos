<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import DatePicker from 'primevue/datepicker'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'
import Select from 'primevue/select'
import Tag from 'primevue/tag'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { checkLaoQrPaymentHistory, deleteLaoQrPaymentHistory, getLaoQrPaymentHistory } from '@/services/laoQrService'
import { usePosStore } from '@/stores/pos'
import { formatCurrency, toISO } from '@/utils/formatters'

const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const posStore = usePosStore()
const { locale } = useI18n()

function tl(th, en, lo = en) {
  const lang = String(locale.value || 'th').toLowerCase()
  if (lang.startsWith('en')) return en
  if (lang.startsWith('lo')) return lo
  return th
}

const now = new Date()
const fromDate = ref(new Date(now.getFullYear(), now.getMonth(), now.getDate()))
const toDate = ref(new Date(now.getFullYear(), now.getMonth(), now.getDate()))
const statusFilter = ref('all')
const search = ref('')
const rows = ref([])
const loading = ref(false)
const checkingId = ref(null)
const deletingId = ref(null)
const errorMsg = ref('')

const statusOptions = computed(() => [
  { label: tl('ทั้งหมด', 'All', 'ທັງໝົດ'), value: 'all' },
  { label: tl('รอชำระ', 'Pending', 'ລໍຖ້າຊຳລະ'), value: 'pending' },
  { label: tl('สแกนแล้ว', 'Scanned', 'ສະແກນແລ້ວ'), value: 'scanned' },
  { label: tl('ชำระสำเร็จ', 'Paid', 'ຊຳລະສຳເລັດ'), value: 'paid' },
  { label: tl('ตรวจสอบไม่สำเร็จ', 'Check failed', 'ກວດສອບບໍ່ສຳເລັດ'), value: 'check_failed' },
  { label: tl('สร้างไม่สำเร็จ', 'Create failed', 'ສ້າງບໍ່ສຳເລັດ'), value: 'create_failed' },
  { label: tl('ไม่ทราบสถานะ', 'Unknown', 'ບໍ່ຮູ້ສະຖານະ'), value: 'unknown' },
])

const totalAmount = computed(() => rows.value.reduce((sum, row) => sum + Number(row.amount_lak || 0), 0))
const paidCount = computed(() => rows.value.filter((row) => ['paid', 'saved'].includes(String(row.status || ''))).length)
const pendingCount = computed(() => rows.value.filter((row) => canCheck(row)).length)

function statusLabel(status) {
  const value = String(status || '').trim()
  return statusOptions.value.find((option) => option.value === value)?.label || value || '-'
}

function statusSeverity(status) {
  const value = String(status || '').trim()
  if (['paid', 'saved'].includes(value)) return 'success'
  if (['create_failed', 'check_failed'].includes(value)) return 'danger'
  if (value === 'scanned') return 'warn'
  if (value === 'pending') return 'info'
  return 'secondary'
}

function canCheck(row) {
  return !['paid', 'saved'].includes(String(row?.status || '').trim())
}

function canDelete(row) {
  return ['create_failed', 'check_failed'].includes(String(row?.status || '').trim())
}

function formatDateTime(value) {
  const text = String(value || '').trim()
  if (!text) return '-'
  const [datePart, timePart = ''] = text.replace('T', ' ').split(' ')
  const [year, month, day] = datePart.split('-')
  if (!year || !month || !day) return text
  const time = timePart.slice(0, 5)
  return `${day}/${month}/${year}${time ? ` ${time}` : ''}`
}

function posText(row) {
  return [row.pos_code || row.pos_id, row.machinecode].filter(Boolean).join(' / ') || '-'
}

function creatorText(row) {
  return [row.creator_code, row.creator_name].filter(Boolean).join(' ') || '-'
}

function bankRefText(row) {
  return row.fccref || row.ticket || '-'
}

function searchParams() {
  return {
    from_date: toISO(fromDate.value),
    to_date: toISO(toDate.value),
    status: statusFilter.value,
    search: search.value.trim(),
    branch_code: posStore.selectedPos?.branch_code || '',
    limit: 300,
  }
}

async function loadHistory() {
  loading.value = true
  errorMsg.value = ''
  try {
    rows.value = await getLaoQrPaymentHistory(searchParams())
  } catch (error) {
    rows.value = []
    errorMsg.value = error.message || tl('โหลดประวัติไม่สำเร็จ', 'Failed to load history', 'ໂຫຼດປະຫວັດບໍ່ສຳເລັດ')
  } finally {
    loading.value = false
  }
}

async function checkRow(row) {
  if (!row?.id || checkingId.value || !canCheck(row)) return
  checkingId.value = row.id
  try {
    const result = await checkLaoQrPaymentHistory(row.id)
    const updated = result.row
    if (updated?.id) {
      rows.value = rows.value.map((item) => (item.id === updated.id ? updated : item))
    } else {
      await loadHistory()
    }
    const statusText = statusLabel(updated?.status || result.status_result?.status_text)
    toast.add({
      severity: updated?.status === 'paid' || result.status_result?.paid ? 'success' : 'info',
      summary: tl('ตรวจสอบแล้ว', 'Checked', 'ກວດສອບແລ້ວ'),
      detail: statusText,
      life: 2200,
    })
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: tl('ตรวจสอบไม่สำเร็จ', 'Check failed', 'ກວດສອບບໍ່ສຳເລັດ'),
      detail: error.message,
      life: 3500,
    })
    await loadHistory()
  } finally {
    checkingId.value = null
  }
}

function requestDeleteRow(row) {
  if (!row?.id || !canDelete(row)) return
  confirm.require({
    header: tl('ยืนยันการลบ', 'Confirm delete', 'ຢືນຢັນການລຶບ'),
    message: tl('ต้องการลบรายการ QRLao ที่ล้มเหลวนี้ใช่หรือไม่', 'Delete this failed QRLao row?', 'ຕ້ອງການລຶບລາຍການ QRLao ທີ່ລົ້ມເຫຼວນີ້ບໍ?'),
    icon: 'pi pi-exclamation-triangle',
    rejectLabel: tl('ยกเลิก', 'Cancel', 'ຍົກເລີກ'),
    acceptLabel: tl('ลบ', 'Delete', 'ລຶບ'),
    acceptClass: 'p-button-danger',
    accept: () => {
      void deleteRow(row)
    },
  })
}

async function deleteRow(row) {
  if (!row?.id || deletingId.value || !canDelete(row)) return
  deletingId.value = row.id
  try {
    await deleteLaoQrPaymentHistory(row.id)
    rows.value = rows.value.filter((item) => item.id !== row.id)
    toast.add({
      severity: 'success',
      summary: tl('ลบรายการแล้ว', 'Row deleted', 'ລຶບລາຍການແລ້ວ'),
      life: 2200,
    })
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: tl('ลบไม่สำเร็จ', 'Delete failed', 'ລຶບບໍ່ສຳເລັດ'),
      detail: error.message,
      life: 3500,
    })
  } finally {
    deletingId.value = null
  }
}

function openSaleDoc(row) {
  const docNo = String(row?.sale_doc_no || '').trim()
  if (!docNo) return
  router.push({ name: 'Sell', query: { doc_no: docNo, view: '1' } })
}

onMounted(loadHistory)
</script>

<template>
  <div class="lao-qr-history-page biz-page">
    <div class="biz-page-header">
      <div class="biz-page-title-wrap">
        <i class="pi pi-qrcode biz-page-icon lao-qr-icon" />
        <div>
          <h1 class="biz-page-title">{{ tl('ประวัติรับเงิน QRLao', 'QRLao payment history', 'ປະຫວັດຮັບເງິນ QRLao') }}</h1>
          <p class="biz-page-subtitle">{{ tl('รายการสร้าง QR และผลตรวจสอบจากธนาคาร', 'QR requests and bank check results', 'ລາຍການ QR ແລະຜົນກວດສອບຈາກທະນາຄານ') }}</p>
        </div>
      </div>
      <Button :label="tl('โหลดใหม่', 'Refresh', 'ໂຫຼດໃໝ່')" icon="pi pi-refresh" :loading="loading" outlined @click="loadHistory" />
    </div>

    <section class="history-toolbar">
      <DatePicker v-model="fromDate" date-format="dd/mm/yy" :manual-input="false" show-icon class="date-filter" />
      <DatePicker v-model="toDate" date-format="dd/mm/yy" :manual-input="false" show-icon class="date-filter" />
      <Select v-model="statusFilter" :options="statusOptions" option-label="label" option-value="value" class="status-filter" />
      <IconField class="search-field">
        <InputIcon class="pi pi-search" />
        <InputText v-model="search" :placeholder="tl('ค้นหา UUID / Invoice / อ้างอิง / ผู้สร้าง', 'Search UUID / invoice / reference / creator', 'ຄົ້ນຫາ UUID / invoice / reference / ຜູ້ສ້າງ')" @keyup.enter="loadHistory" />
      </IconField>
      <Button :label="tl('ค้นหา', 'Search', 'ຄົ້ນຫາ')" icon="pi pi-search" :loading="loading" @click="loadHistory" />
    </section>

    <Message v-if="errorMsg" severity="error" :closable="false" class="mb-3">{{ errorMsg }}</Message>

    <DataTable
      :value="rows"
      :loading="loading"
      striped-rows
      paginator
      :rows="25"
      :rows-per-page-options="[25, 50, 100]"
      size="small"
      scrollable
      scroll-height="flex"
      table-style="min-width: 1500px"
      class="biz-data-surface lao-qr-history-table"
      data-key="id"
    >
      <Column :header="tl('วันที่เวลา', 'Date/time', 'ວັນເວລາ')" style="min-width: 140px">
        <template #body="{ data }">{{ formatDateTime(data.created_at) }}</template>
      </Column>
      <Column :header="tl('POS / เครื่อง', 'POS / terminal', 'POS / ເຄື່ອງ')" style="min-width: 140px">
        <template #body="{ data }">{{ posText(data) }}</template>
      </Column>
      <Column :header="tl('ผู้สร้าง', 'Creator', 'ຜູ້ສ້າງ')" style="min-width: 150px">
        <template #body="{ data }">{{ creatorText(data) }}</template>
      </Column>
      <Column field="invoiceid" header="Invoice" style="min-width: 120px" />
      <Column field="uuid" header="UUID" style="min-width: 210px" />
      <Column :header="tl('ยอด LAK', 'Amount LAK', 'ຍອດ LAK')" style="min-width: 120px">
        <template #body="{ data }">
          <span class="num-cell">{{ formatCurrency(data.amount_lak) }}</span>
        </template>
      </Column>
      <Column :header="tl('สถานะ', 'Status', 'ສະຖານະ')" style="min-width: 130px">
        <template #body="{ data }">
          <Tag :value="statusLabel(data.status)" :severity="statusSeverity(data.status)" />
        </template>
      </Column>
      <Column :header="tl('เช็คล่าสุด', 'Last checked', 'ກວດລ່າສຸດ')" style="min-width: 140px">
        <template #body="{ data }">{{ formatDateTime(data.last_checked_at) }}</template>
      </Column>
      <Column :header="tl('อ้างอิงธนาคาร', 'Bank ref', 'ອ້າງອີງທະນາຄານ')" style="min-width: 150px">
        <template #body="{ data }">{{ bankRefText(data) }}</template>
      </Column>
      <Column :header="tl('เอกสารขาย', 'Sale doc', 'ເອກະສານຂາຍ')" style="min-width: 120px">
        <template #body="{ data }">
          <Button
            v-if="data.sale_doc_no"
            :label="data.sale_doc_no"
            icon="pi pi-file"
            text
            size="small"
            @click="openSaleDoc(data)"
          />
          <span v-else>-</span>
        </template>
      </Column>
      <Column :header="tl('จัดการ', 'Actions', 'ຈັດການ')" frozen align-frozen="right" style="min-width: 150px">
        <template #body="{ data }">
          <Button
            v-if="canCheck(data)"
            :label="tl('ตรวจสอบ', 'Check', 'ກວດສອບ')"
            icon="pi pi-sync"
            size="small"
            :loading="checkingId === data.id"
            :disabled="!!checkingId || !!deletingId"
            @click="checkRow(data)"
          />
          <span v-else class="paid-text">{{ tl('สำเร็จ', 'Done', 'ສຳເລັດ') }}</span>
          <Button
            v-if="canDelete(data)"
            icon="pi pi-trash"
            size="small"
            severity="danger"
            outlined
            class="ml-2"
            :aria-label="tl('ลบ', 'Delete', 'ລຶບ')"
            :loading="deletingId === data.id"
            :disabled="!!checkingId || !!deletingId"
            @click="requestDeleteRow(data)"
          />
        </template>
      </Column>
    </DataTable>
  </div>
</template>

<style scoped>
.lao-qr-history-page {
  padding: 0;
  min-height: 0;
  overflow: hidden;
}

.lao-qr-icon {
  background: color-mix(in srgb, var(--p-blue-500) 10%, var(--p-surface-0));
  color: var(--p-blue-600);
}

.history-toolbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 0.875rem;
}

.date-filter {
  width: 170px;
}

.status-filter {
  width: 180px;
}

.search-field {
  flex: 1 1 260px;
  min-width: 240px;
}

.search-field :deep(.p-inputtext) {
  width: 100%;
}

.history-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
  margin-bottom: 0.875rem;
}

.history-summary > div {
  border: 1px solid var(--p-surface-200);
  border-radius: 8px;
  background: var(--p-surface-0);
  padding: 0.75rem 0.875rem;
}

.history-summary span {
  display: block;
  color: var(--p-surface-500);
  font-size: 0.78rem;
}

.history-summary strong {
  display: block;
  margin-top: 0.25rem;
  color: var(--p-surface-900);
  font-size: 1.05rem;
}

.mb-3 {
  margin-bottom: 0.75rem;
}

.lao-qr-history-table {
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
}

.lao-qr-history-table :deep(.p-datatable-table-container) {
  min-height: 0;
}

.num-cell {
  display: block;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.paid-text {
  color: var(--p-green-600);
  font-weight: 700;
}

@media (max-width: 900px) {
  .history-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .date-filter,
  .status-filter,
  .history-toolbar > button {
    width: 100%;
  }
}
</style>
