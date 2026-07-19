<script setup>
import { ref, watch, computed, onMounted, onUnmounted } from 'vue'
import { getDocSaleHistoryDetail, getSalePrintForms, getSalePrintUrl, getSalePosSlipPrintUrl } from '@/services/salesService'
import { deleteDocImage, getDocImageUrl, getDocImagesList, saveDocImage } from '@/services/docImageService'
import { TIGER_PENDING_MOCK, mockTigerPendingPaid } from '@/services/tigerService'
import { useAuthStore } from '@/stores/auth'
import { formatDate, formatCurrency, formatNumber } from '@/utils/formatters'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import ProgressSpinner from 'primevue/progressspinner'
import Message from 'primevue/message'
import { useToast } from 'primevue/usetoast'

const props = defineProps({
  visible: { type: Boolean, default: false },
  docHeader: { type: Object, default: null },
})

const emit = defineEmits(['update:visible', 'tiger-paid', 'edit-doc'])
const toast = useToast()
const authStore = useAuthStore()

const windowWidth = ref(window.innerWidth)

const isMobile = computed(() => windowWidth.value < 768)

function handleResize() {
  windowWidth.value = window.innerWidth
}

onMounted(() => {
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
})

const loading = ref(false)
const detailData = ref(null)
const docImages = ref([])
const imageUploading = ref(false)
const imageError = ref('')
const confirmDeleteVisible = ref(false)
const pendingDeleteImage = ref(null)
const errorMsg = ref('')
const tigerMocking = ref(false)
const printDialogVisible = ref(false)
const printLoading = ref(false)
const printError = ref('')
const printForms = ref([])
const selectedPrintForm = ref('')

function isPosSlipFormCode(formCode) {
  return String(formCode || '').trim().toUpperCase() === 'CR-0088'
}

async function loadDocImages() {
  if (!props.docHeader?.doc_no) {
    docImages.value = []
    return
  }
  docImages.value = await getDocImagesList(props.docHeader.doc_no)
}

async function loadDetail() {
  if (!props.docHeader?.doc_no) return
  loading.value = true
  errorMsg.value = ''
  imageError.value = ''
  docImages.value = []
  try {
    const [detail] = await Promise.all([
      getDocSaleHistoryDetail(props.docHeader.doc_no),
      loadDocImages(),
    ])
    detailData.value = detail
  } catch (err) {
    errorMsg.value = err.message
  } finally {
    loading.value = false
  }
}

watch(() => props.visible, async (val) => {
  if (val && props.docHeader?.doc_no) {
    await loadDetail()
  } else {
    detailData.value = null
    docImages.value = []
    imageError.value = ''
    confirmDeleteVisible.value = false
    pendingDeleteImage.value = null
    printDialogVisible.value = false
    printError.value = ''
    printForms.value = []
    selectedPrintForm.value = ''
  }
})

const header = computed(() => detailData.value?.header || {})
const items = computed(() => detailData.value?.items || [])
const promotions = computed(() =>
  detailData.value?.promotions || detailData.value?.promotion_detail || [],
)
const promotionTotal = computed(() =>
  promotions.value.reduce((sum, promotion) => sum + Math.abs(Number(promotion.sum_amount || promotion.amount || 0)), 0),
)

const inquiryLabel = computed(() => {
  const t = Number(header.value.inquiry_type)
  if (t === 0 || t === 2) return 'เชื่อ'
  return 'สด'
})

function formatVatRate(rate) {
  const value = Number(rate)
  return Number.isFinite(value) ? String(Math.round(value)) : '0'
}

const vatLabel = computed(() => {
  const vt = Number(header.value.vat_type)
  const rate = formatVatRate(header.value.vat_rate)
  if (vt === 0) return `แยกนอก ${rate}%`
  if (vt === 1) return `รวมใน ${rate}%`
  return 'ไม่มีภาษี'
})

const showVatBreakdown = computed(() => Number(header.value.vat_type) !== 2)
const isTigerPending = computed(() => Number(header.value.send_sms) === 1 && !!header.value.tiger_order_id)

const tigerStatusNote = computed(() => {
  try {
    return JSON.parse(header.value.tiger_status_note || '{}')
  } catch {
    return {}
  }
})

async function openPrintDialog() {
  if (!props.docHeader?.doc_no || printLoading.value) return
  printDialogVisible.value = true
  printLoading.value = true
  printError.value = ''
  printForms.value = []
  selectedPrintForm.value = ''
  try {
    const result = await getSalePrintForms(props.docHeader.doc_no)
    const forms = result?.forms || []
    printForms.value = forms
    const available = forms.filter((form) => form.available)
    if (forms.length === 1 && available.length === 1) {
      printDialogVisible.value = false
      const code = available[0].formcode
      const url = isPosSlipFormCode(code)
        ? getSalePosSlipPrintUrl(props.docHeader.doc_no, authStore.employee?.user_code || '')
        : getSalePrintUrl(props.docHeader.doc_no, [code], authStore.employee?.user_code || '')
      window.open(url, '_blank', 'noopener')
      return
    }
    selectedPrintForm.value = available.find((form) => form.is_default)?.formcode || available[0]?.formcode || ''
    if (!forms.length) {
      printError.value = 'เอกสารนี้ยังไม่ได้กำหนด form_code สำหรับพิมพ์'
    } else if (!selectedPrintForm.value) {
      printError.value = 'ไม่พบฟอร์มที่พร้อมใช้งานใน formdesign'
    }
  } catch (err) {
    printError.value = err.message || 'โหลดฟอร์มพิมพ์ไม่สำเร็จ'
  } finally {
    printLoading.value = false
  }
}

function confirmPrintForms() {
  if (!props.docHeader?.doc_no || !selectedPrintForm.value) return
  const url = isPosSlipFormCode(selectedPrintForm.value)
    ? getSalePosSlipPrintUrl(props.docHeader.doc_no, authStore.employee?.user_code || '')
    : getSalePrintUrl(props.docHeader.doc_no, [selectedPrintForm.value], authStore.employee?.user_code || '')
  window.open(url, '_blank', 'noopener')
  printDialogVisible.value = false
}

function openEditDocument() {
  if (!props.docHeader?.doc_no) return
  emit('edit-doc', props.docHeader)
}

async function mockTigerPaid() {
  if (!props.docHeader?.doc_no || tigerMocking.value) return
  tigerMocking.value = true
  errorMsg.value = ''
  try {
    const result = await mockTigerPendingPaid({ doc_no: props.docHeader.doc_no })
    if (result?.paid) {
      toast.add({ severity: 'success', summary: 'Mock ชำระ Tiger แล้ว', detail: props.docHeader.doc_no, life: 2500 })
      await loadDetail()
      emit('tiger-paid', result.data)
    } else if (result?.busy) {
      toast.add({ severity: 'warn', summary: 'Tiger กำลังตรวจรายการอื่น', detail: 'ลองใหม่อีกครั้ง', life: 2500 })
    }
  } catch (err) {
    errorMsg.value = err.message || 'Mock ชำระ Tiger ไม่สำเร็จ'
    toast.add({ severity: 'error', summary: 'Mock ไม่สำเร็จ', detail: errorMsg.value, life: 3000 })
  } finally {
    tigerMocking.value = false
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

async function onDocImageSelected(event) {
  const files = Array.from(event.target.files || [])
  if (!files.length || !props.docHeader?.doc_no) return

  imageUploading.value = true
  imageError.value = ''
  try {
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        throw new Error('กรุณาเลือกไฟล์รูปภาพเท่านั้น')
      }
      const imageFile = await fileToDataUrl(file)
      const result = await saveDocImage(props.docHeader.doc_no, imageFile)
      if (!result.success) throw new Error(result.msg || 'บันทึกรูปไม่สำเร็จ')
    }
    await loadDocImages()
    event.target.value = ''
  } catch (err) {
    imageError.value = err.message || 'บันทึกรูปไม่สำเร็จ'
  } finally {
    imageUploading.value = false
  }
}

function askDeleteImage(image) {
  pendingDeleteImage.value = image
  confirmDeleteVisible.value = true
}

async function confirmDeleteImage() {
  const guidCode = pendingDeleteImage.value?.guid_code
  if (!guidCode) return

  imageError.value = ''
  try {
    await deleteDocImage(guidCode)
    await loadDocImages()
  } catch (err) {
    imageError.value = err.message || 'ลบรูปไม่สำเร็จ'
  } finally {
    confirmDeleteVisible.value = false
    pendingDeleteImage.value = null
  }
}
</script>

<template>
  <div class="sale-detail-modal-root">
    <Dialog
    :visible="visible"
    modal
    :draggable="false"
    dismissable-mask
    maximizable
    :style="isMobile ? { width: '95vw', height: '95vh' } : { width: '90vw', maxWidth: '1400px' }"
    @update:visible="emit('update:visible', $event)"
  >
    <template #header>
      <div class="modal-header">
        <div class="header-left">
          <span class="doc-no">{{ docHeader?.doc_no }}</span>
          <span class="doc-date">{{ formatDate(docHeader?.doc_date) }} {{ docHeader?.doc_time }}</span>
        </div>
        <Button
          label="แก้ไข"
          icon="pi pi-pencil"
          size="small"
          outlined
          @click="openEditDocument"
        />
        <Button
          label="พิมพ์ฟอร์ม"
          icon="pi pi-print"
          size="small"
          outlined
          @click="openPrintDialog"
        />
      </div>
    </template>

    <div class="modal-body">
      <!-- customer + total -->
      <div class="doc-meta">
        <span class="cust-name">{{ docHeader?.cust_name || 'ลูกค้าทั่วไป' }}</span>
        <span class="doc-total">{{ formatCurrency(docHeader?.total_net_amount ?? docHeader?.total_amount) }}</span>
      </div>

      <!-- badges: ประเภทขาย + ภาษี -->
      <div class="badge-row">
        <span class="badge" :class="inquiryLabel === 'สด' ? 'badge-cash' : 'badge-credit'">
          {{ inquiryLabel === 'สด' ? 'ขายสด' : 'ขายเชื่อ' }}
        </span>
        <span class="badge badge-vat">{{ vatLabel }}</span>
        <span v-if="isTigerPending" class="badge badge-tiger-pending">
          <i class="pi pi-clock" />
          รอรับชำระ Tiger
        </span>
      </div>

      <div v-if="isTigerPending" class="tiger-pending-box">
        <div class="tiger-pending-row">
          <span>Transaction ID</span>
          <strong>{{ header.tiger_order_id }}</strong>
        </div>
        <div class="tiger-pending-row">
          <span>ยอดรอรับชำระ</span>
          <strong>{{ formatCurrency(tigerStatusNote.amount || 0) }}</strong>
        </div>
        <div v-if="tigerStatusNote.status" class="tiger-pending-row">
          <span>สถานะล่าสุด</span>
          <strong>{{ tigerStatusNote.status }}</strong>
        </div>
        <Button
          v-if="TIGER_PENDING_MOCK"
          label="Mock จ่ายแล้ว"
          icon="pi pi-check"
          severity="warning"
          outlined
          size="small"
          class="tiger-mock-btn"
          :loading="tigerMocking"
          @click="mockTigerPaid"
        />
      </div>

      <div class="proof-section">
        <div class="proof-head">
          <div>
            <div class="proof-title">หลักฐานการโอน</div>
            <div class="proof-subtitle">เพิ่มหรือลบรูปหลักฐานของบิลนี้</div>
          </div>
          <label class="proof-upload-btn" :class="{ disabled: imageUploading }">
            <i class="pi pi-upload" />
            <span>{{ imageUploading ? 'กำลังบันทึก...' : 'เพิ่มรูป' }}</span>
            <input type="file" accept="image/*" multiple :disabled="imageUploading" @change="onDocImageSelected" />
          </label>
        </div>
        <Message v-if="imageError" severity="error" :closable="false">{{ imageError }}</Message>
        <div v-if="docImages.length" class="proof-grid">
          <div v-for="image in docImages" :key="image.guid_code" class="proof-item">
            <a :href="getDocImageUrl(image.guid_code)" target="_blank" rel="noopener">
              <img :src="getDocImageUrl(image.guid_code)" alt="หลักฐานการโอน" />
            </a>
            <button type="button" class="proof-remove" @click="askDeleteImage(image)" aria-label="ลบรูป">
              <i class="pi pi-trash" />
            </button>
          </div>
        </div>
        <div v-else class="proof-empty">ยังไม่มีรูปหลักฐาน</div>
      </div>

      <Message v-if="errorMsg" severity="error" :closable="false">{{ errorMsg }}</Message>

      <div v-if="loading" class="loading-center">
        <ProgressSpinner style="width: 40px; height: 40px" />
      </div>

      <template v-else>
        <!-- items table -->
        <DataTable :value="items" responsive-layout="stack" size="small">
          <template #empty>
            <div class="empty-msg">ไม่มีรายการสินค้า</div>
          </template>
          <Column field="item_code" header="รหัสสินค้า" />
          <Column field="item_name" header="ชื่อสินค้า">
            <template #body="{ data }">
              <div>{{ data.item_name }}</div>
              <div v-if="data.discount" class="item-discount-sub">
                ลด {{ data.discount }} (-{{ formatCurrency(data.discount_amount) }})
              </div>
            </template>
          </Column>
          <Column field="unit_code" header="หน่วย" />
          <Column field="qty" header="จำนวน">
            <template #body="{ data }">{{ formatNumber(data.qty) }}</template>
          </Column>
          <Column field="price" header="ราคา/หน่วย">
            <template #body="{ data }">{{ formatCurrency(data.price) }}</template>
          </Column>
          <Column header="ยอดรวม">
            <template #body="{ data }">{{ formatCurrency(data.sum_amount) }}</template>
          </Column>
        </DataTable>

        <section v-if="promotions.length" class="promotion-detail-section">
          <div class="promotion-detail-head">
            <div>
              <strong>โปรโมชั่น</strong>
              <span>{{ promotions.length }} รายการ</span>
            </div>
            <b>-{{ formatCurrency(promotionTotal) }}</b>
          </div>
          <div class="promotion-detail-list">
            <article
              v-for="promotion in promotions"
              :key="`${promotion.promotion_code}-${promotion.line_number}`"
              class="promotion-detail-row"
            >
              <div>
                <strong>{{ promotion.promotion_code || '-' }}</strong>
                <span>{{ promotion.promotion_name || '-' }}</span>
              </div>
              <div class="promotion-detail-meta">
                <span>จำนวน {{ formatNumber(promotion.qty || 0) }}</span>
                <b>-{{ formatCurrency(Math.abs(Number(promotion.sum_amount || 0))) }}</b>
              </div>
            </article>
          </div>
        </section>

        <!-- totals breakdown -->
        <div class="totals-section">
          <div v-if="Number(header.total_discount) > 0" class="total-row">
            <span class="total-label">ส่วนลด</span>
            <span class="total-val discount-val">-{{ formatCurrency(header.total_discount) }}</span>
          </div>
          <template v-if="showVatBreakdown">
            <div class="total-row">
              <span class="total-label">ยอดก่อนภาษี</span>
              <span class="total-val">{{ formatCurrency(header.total_before_vat) }}</span>
            </div>
            <div class="total-row">
              <span class="total-label">ภาษีมูลค่าเพิ่ม ({{ formatVatRate(header.vat_rate) }}%)</span>
              <span class="total-val">{{ formatCurrency(header.total_vat_value) }}</span>
            </div>
          </template>
          <div class="total-row total-net-row">
            <span class="total-label">ยอดสุทธิ</span>
            <span class="total-val net-val">{{ formatCurrency(header.total_net_amount ?? header.total_amount) }}</span>
          </div>
        </div>
      </template>
    </div>
    </Dialog>

    <Dialog
    :visible="printDialogVisible"
    header="เลือกฟอร์มสำหรับพิมพ์"
    modal
    :draggable="false"
    :style="{ width: 'min(460px, 95vw)' }"
    @update:visible="printDialogVisible = $event"
  >
    <div class="print-dialog-body">
      <div class="print-doc-no">{{ docHeader?.doc_no }}</div>
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
            name="sale-detail-print-form"
            :value="form.formcode"
            :disabled="!form.available"
          />
          <span>
            <strong>{{ form.formname }}</strong>
            <small>{{ form.formcode }}<template v-if="!form.available"> · ไม่พบใน formdesign</template></small>
          </span>
        </label>
      </div>
    </div>
    <template #footer>
      <Button label="ยกเลิก" severity="secondary" outlined @click="printDialogVisible = false" />
      <Button
        label="พิมพ์"
        icon="pi pi-print"
        :disabled="printLoading || !selectedPrintForm"
        @click="confirmPrintForms"
      />
    </template>
    </Dialog>

    <Dialog
    :visible="confirmDeleteVisible"
    header="ยืนยันการลบ"
    modal
    :draggable="false"
    :style="{ width: 'min(400px, 95vw)' }"
    @update:visible="confirmDeleteVisible = $event"
  >
    <div class="confirm-body">
      ต้องการลบรูปหลักฐานการโอนนี้หรือไม่
    </div>
    <template #footer>
      <Button label="ยกเลิก" severity="secondary" outlined @click="confirmDeleteVisible = false" />
      <Button label="ลบรูป" severity="danger" icon="pi pi-trash" @click="confirmDeleteImage" />
    </template>
    </Dialog>
  </div>
</template>

<style scoped>
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 1rem;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex: 1;
  flex-wrap: wrap;
}

.doc-no {
  font-weight: 700;
  font-size: 1rem;
}

.doc-date {
  font-size: 0.875rem;
  color: var(--p-text-color-secondary);
}

@media (max-width: 768px) {
  .modal-header {
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .header-left {
    width: 100%;
    gap: 0.5rem;
  }

  .doc-no {
    font-size: 0.95rem;
  }

  .doc-date {
    font-size: 0.8rem;
  }
}

@media (max-width: 480px) {
  .header-left {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
  }

  .doc-no {
    font-size: 0.9rem;
  }
}

.modal-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.doc-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--p-surface-border);
}

.cust-name {
  font-weight: 500;
}

.doc-total {
  font-weight: 700;
  font-size: 1.1rem;
  color: var(--p-primary-color);
}

.badge-row {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

@media (max-width: 768px) {
  .modal-body {
    gap: 0.75rem;
  }

  .doc-meta {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
    padding: 0.4rem 0;
  }

  .doc-total {
    font-size: 1rem;
  }
}

@media (max-width: 480px) {
  .modal-body {
    gap: 0.5rem;
  }
}

.badge {
  display: inline-flex;
  align-items: center;
  padding: 0.2rem 0.65rem;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 600;
}

.badge-cash {
  background: #dcfce7;
  color: #15803d;
}

.badge-credit {
  background: #fef9c3;
  color: #854d0e;
}

.badge-vat {
  background: var(--p-surface-100, #f3f4f6);
  color: var(--p-text-color-secondary);
}

.badge-tiger-pending {
  gap: 0.25rem;
  background: #eff6ff;
  color: #0369a1;
}

.tiger-pending-box {
  display: grid;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 1px solid #bae6fd;
  border-radius: 8px;
  background: #eff6ff;
}

.tiger-pending-row {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  font-size: 0.875rem;
}

.tiger-pending-row span {
  color: #075985;
}

.tiger-pending-row strong {
  color: #0c4a6e;
  word-break: break-all;
}

.tiger-mock-btn {
  justify-self: end;
  margin-top: 0.25rem;
}

.proof-section {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
  padding: 0.75rem;
}

.proof-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.proof-title {
  font-weight: 700;
  font-size: 0.9rem;
}

.proof-subtitle {
  color: var(--p-text-color-secondary);
  font-size: 0.78rem;
  margin-top: 0.15rem;
}

.proof-upload-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  border: 1px solid var(--p-primary-color);
  border-radius: 6px;
  padding: 0.45rem 0.75rem;
  color: var(--p-primary-color);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.proof-upload-btn.disabled {
  opacity: 0.6;
  cursor: default;
}

.proof-upload-btn input {
  display: none;
}

.proof-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 0.625rem;
}

.proof-item {
  position: relative;
  aspect-ratio: 1;
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--p-surface-ground);
}

.proof-item a {
  display: block;
  width: 100%;
  height: 100%;
}

.proof-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.proof-remove {
  position: absolute;
  top: 0.25rem;
  right: 0.25rem;
  width: 1.75rem;
  height: 1.75rem;
  border: none;
  border-radius: 50%;
  background: rgba(15, 23, 42, 0.72);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.proof-empty {
  text-align: center;
  color: var(--p-text-color-secondary);
  border: 1px dashed var(--p-surface-border);
  border-radius: 8px;
  padding: 1rem;
  font-size: 0.9rem;
}

.confirm-body {
  color: var(--p-text-color);
  line-height: 1.6;
}

.print-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.print-doc-no {
  font-weight: 700;
  color: var(--p-text-color);
}

.print-loading {
  display: flex;
  justify-content: center;
  padding: 1rem;
}

.print-form-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.print-form-row {
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
  cursor: pointer;
}

.print-form-row.disabled {
  opacity: 0.55;
  cursor: default;
}

.print-form-row span {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.print-form-row strong,
.print-form-row small {
  overflow-wrap: anywhere;
}

.print-form-row small {
  color: var(--p-text-color-secondary);
}

.loading-center {
  display: flex;
  justify-content: center;
  padding: 2rem;
}

.empty-msg {
  text-align: center;
  padding: 1rem;
  color: var(--p-text-color-secondary);
}

.totals-section {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.75rem 0 0.25rem;
  border-top: 1px solid var(--p-surface-border);
  max-width: 320px;
  margin-left: auto;
}

.total-row {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  font-size: 0.9rem;
  line-height: 1.7;
}

.total-label {
  color: var(--p-text-color-secondary);
}

.total-val {
  font-weight: 500;
}

.item-discount-sub { font-size: 0.72rem; color: #0369a1; margin-top: 0.15rem; }

.promotion-detail-section {
  display: grid;
  gap: 0.625rem;
  padding: 0.75rem;
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
  background: var(--p-surface-ground);
}

.promotion-detail-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}

.promotion-detail-head > div {
  display: grid;
  gap: 0.125rem;
}

.promotion-detail-head span {
  color: var(--p-text-color-secondary);
  font-size: 0.76rem;
}

.promotion-detail-head b,
.promotion-detail-meta b {
  color: #dc2626;
}

.promotion-detail-list {
  display: grid;
  gap: 0.5rem;
}

.promotion-detail-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 1rem;
  align-items: center;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
  background: var(--app-panel-bg);
}

.promotion-detail-row > div:first-child {
  display: grid;
  min-width: 0;
  gap: 0.125rem;
}

.promotion-detail-row strong,
.promotion-detail-row span {
  overflow-wrap: anywhere;
}

.promotion-detail-row > div:first-child span {
  color: var(--p-text-color-secondary);
  font-size: 0.82rem;
}

.promotion-detail-meta {
  display: grid;
  gap: 0.125rem;
  text-align: right;
  white-space: nowrap;
}

.promotion-detail-meta span {
  color: var(--p-text-color-secondary);
  font-size: 0.76rem;
}

.discount-val {
  color: #dc2626;
}

.total-net-row {
  border-top: 1px solid var(--p-surface-border);
  margin-top: 0.25rem;
  padding-top: 0.35rem;
  font-size: 1rem;
}

.net-val {
  font-weight: 700;
  color: var(--p-primary-color);
  font-size: 1.05rem;
}

@media (max-width: 768px) {
  .promotion-detail-row {
    grid-template-columns: 1fr;
  }

  .promotion-detail-meta {
    text-align: left;
    white-space: normal;
  }

  .totals-section {
    max-width: 100%;
    margin-left: 0;
    padding: 0.5rem 0 0;
  }

  .total-row {
    font-size: 0.85rem;
    line-height: 1.5;
  }

  .total-net-row {
    font-size: 0.95rem;
  }

  .net-val {
    font-size: 1rem;
  }
}

@media (max-width: 480px) {
  .totals-section {
    padding: 0.4rem 0 0;
  }

  .total-row {
    font-size: 0.8rem;
    line-height: 1.4;
    gap: 0.75rem;
  }

  .total-net-row {
    font-size: 0.9rem;
  }

  .net-val {
    font-size: 0.95rem;
  }
}
</style>
