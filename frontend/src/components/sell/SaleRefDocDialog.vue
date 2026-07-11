<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import { getSaleRefDocItems, getSaleRefDocList } from '@/services/sellService'
import { formatCurrency, formatDate } from '@/utils/formatters'

const props = defineProps({
  visible: { type: Boolean, default: false },
  custCode: { type: String, default: '' },
  custName: { type: String, default: '' },
  // เลขเอกสารที่ดึงไปแล้ว — กรองออกจาก list (รองรับดึงหลายใบ ห้ามซ้ำ)
  excludeDocNos: { type: Array, default: () => [] },
})

// C# _icTransRefControl stores sale reference bill_type as combobox docType: 1=QT, 2=Reserve, 3=SO.
const BILL_TYPE_MAP = { qt: 1, reserve: 2, so: 3 }

const emit = defineEmits(['update:visible', 'confirm'])
const { locale } = useI18n()

function tl(th, en, lo = en) {
  const lang = String(locale.value || 'th').toLowerCase()
  if (lang.startsWith('en')) return en
  if (lang.startsWith('lo')) return lo
  return th
}

const docType = ref('qt')
const docList = ref([])
const selectedDoc = ref(null)
const selectedDocItems = ref([])
const selectedDocItemsDocNo = ref('')
const selectedDocItemsLoading = ref(false)
const selectedDocItemsError = ref('')
const search = ref('')
const loading = ref(false)
const fetchingItems = ref(false)
const errorMsg = ref('')
let selectedDocItemsRequestId = 0

const docTypeTabs = computed(() => [
  { value: 'qt', label: tl('ใบเสนอราคา', 'Quotation', 'ໃບສະເໜີລາຄາ') },
  { value: 'reserve', label: tl('ใบสั่งจอง', 'Reservation', 'ໃບສັ່ງຈອງ') },
  { value: 'so', label: tl('ใบสั่งขาย', 'Sales Order', 'ໃບສັ່ງຂາຍ') },
])

async function loadList() {
  if (!props.custCode) {
    docList.value = []
    selectedDoc.value = null
    clearSelectedDocItems()
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    const rows = await getSaleRefDocList({
      cust_code: props.custCode,
      doc_type: docType.value,
      search: search.value || '',
    })
    // กรองเอกสารที่ดึงไปแล้วออก (ห้ามดึงซ้ำ)
    const excluded = new Set(props.excludeDocNos || [])
    docList.value = excluded.size ? rows.filter((r) => !excluded.has(r.doc_no)) : rows
    selectedDoc.value = null
    clearSelectedDocItems()
  } catch (ex) {
    errorMsg.value = ex?.message || tl('โหลดข้อมูลไม่สำเร็จ', 'Failed to load', 'ໂຫຼດຂໍ້ມູນບໍ່ສຳເລັດ')
    docList.value = []
    selectedDoc.value = null
    clearSelectedDocItems()
  } finally {
    loading.value = false
  }
}

function selectDocType(value) {
  if (docType.value === value) return
  docType.value = value
  loadList()
}

function clearSelectedDocItems() {
  selectedDocItemsRequestId += 1
  selectedDocItems.value = []
  selectedDocItemsDocNo.value = ''
  selectedDocItemsLoading.value = false
  selectedDocItemsError.value = ''
}

function formatQty(value) {
  const amount = Number(value || 0)
  return amount.toLocaleString('th-TH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  })
}

async function loadSelectedDocItems(doc = selectedDoc.value) {
  const docNo = String(doc?.doc_no || '').trim()
  if (!docNo) {
    clearSelectedDocItems()
    return []
  }
  const requestId = ++selectedDocItemsRequestId
  selectedDocItemsLoading.value = true
  selectedDocItemsError.value = ''
  selectedDocItems.value = []
  selectedDocItemsDocNo.value = docNo
  try {
    const items = await getSaleRefDocItems(docNo)
    if (requestId !== selectedDocItemsRequestId) return []
    selectedDocItems.value = items
    if (!items.length) {
      selectedDocItemsError.value = tl(
        'เอกสารนี้ไม่มีรายการคงค้าง',
        'No remaining items on this document',
        'ເອກະສານນີ້ບໍ່ມີລາຍການຄ້າງ',
      )
    }
    return items
  } catch (ex) {
    if (requestId === selectedDocItemsRequestId) {
      selectedDocItemsError.value = ex?.message || tl('โหลดรายการสินค้าไม่สำเร็จ', 'Failed to load item lines', 'ໂຫຼດລາຍການສິນຄ້າບໍ່ສຳເລັດ')
      selectedDocItems.value = []
    }
    return []
  } finally {
    if (requestId === selectedDocItemsRequestId) selectedDocItemsLoading.value = false
  }
}

async function confirmSelection() {
  if (!selectedDoc.value) return
  fetchingItems.value = true
  errorMsg.value = ''
  try {
    const selectedDocNo = String(selectedDoc.value.doc_no || '').trim()
    const items = selectedDocItemsDocNo.value === selectedDocNo && selectedDocItems.value.length ? selectedDocItems.value : await loadSelectedDocItems(selectedDoc.value)
    if (!items.length) {
      errorMsg.value = tl(
        'เอกสารนี้ไม่มีรายการคงค้าง',
        'No remaining items on this document',
        'ເອກະສານນີ້ບໍ່ມີລາຍການຄ້າງ',
      )
      return
    }
    emit('confirm', {
      docNo: selectedDoc.value.doc_no,
      docDate: selectedDoc.value.doc_date,
      billType: BILL_TYPE_MAP[docType.value] || 0,
      saleCode: selectedDoc.value.sale_code || '',
      saleName: selectedDoc.value.sale_name || '',
      items,
    })
    emit('update:visible', false)
  } catch (ex) {
    errorMsg.value = ex?.message || tl('ดึงรายการไม่สำเร็จ', 'Failed to fetch items', 'ດຶງລາຍການບໍ່ສຳເລັດ')
  } finally {
    fetchingItems.value = false
  }
}

function close() {
  emit('update:visible', false)
}

// reload เมื่อเปิด dialog หรือเมื่อ custCode เปลี่ยนระหว่างเปิดอยู่
watch(
  () => [props.visible, props.custCode],
  ([vis]) => {
    if (vis) {
      selectedDoc.value = null
      search.value = ''
      errorMsg.value = ''
      loadList()
    }
  },
  { immediate: false },
)

watch(selectedDoc, (doc) => {
  if (!props.visible) return
  void loadSelectedDocItems(doc)
})
</script>

<template>
  <Dialog
    :visible="visible"
    :header="tl('ดึงเอกสารอ้างอิง', 'Pull Reference Document', 'ດຶງເອກະສານອ້າງອີງ')"
    modal
    :draggable="false"
    :style="{ width: 'min(1180px, 96vw)' }"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="ref-doc-dialog">
      <div class="cust-line">
        <span class="cust-label">{{ tl('ลูกค้า', 'Customer', 'ລູກຄ້າ') }}:</span>
        <strong>{{ custCode }}</strong>
        <span v-if="custName">{{ custName }}</span>
      </div>

      <div class="type-tabs" role="tablist">
        <button
          v-for="tab in docTypeTabs"
          :key="tab.value"
          type="button"
          role="tab"
          :aria-selected="docType === tab.value"
          :class="{ active: docType === tab.value }"
          :disabled="loading"
          @click="selectDocType(tab.value)"
        >
          {{ tab.label }}
        </button>
      </div>

      <div class="search-row">
        <InputText
          v-model.trim="search"
          :placeholder="tl('ค้นเลขที่เอกสาร', 'Search doc no.', 'ຄົ້ນເລກທີ່ເອກະສານ')"
          @keyup.enter="loadList"
        />
        <Button
          :label="tl('ค้นหา', 'Search', 'ຄົ້ນຫາ')"
          icon="pi pi-search"
          :loading="loading"
          @click="loadList"
        />
      </div>

      <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

      <DataTable
        :value="docList"
        v-model:selection="selectedDoc"
        selection-mode="single"
        data-key="doc_no"
        :loading="loading"
        scrollable
        scroll-height="260px"
        :empty-message="tl('ไม่พบเอกสาร', 'No documents', 'ບໍ່ພົບເອກະສານ')"
        :pt="{ table: { style: 'min-width: 600px' } }"
      >
        <Column field="doc_no" :header="tl('เลขที่', 'Doc No.', 'ເລກທີ່')" style="min-width: 160px" />
        <Column field="doc_date" :header="tl('วันที่', 'Date', 'ວັນທີ່')" style="min-width: 110px">
          <template #body="{ data }">{{ formatDate(data.doc_date) }}</template>
        </Column>
        <Column field="total_amount" :header="tl('ยอดรวม', 'Total', 'ຍອດລວມ')" style="min-width: 110px; text-align: right">
          <template #body="{ data }">{{ formatCurrency(data.total_amount) }}</template>
        </Column>
        <Column :header="tl('พนักงานขาย', 'Salesperson', 'ພະນັກງານຂາຍ')" style="min-width: 150px">
          <template #body="{ data }">
            {{ [data.sale_code, data.sale_name].filter(Boolean).join(" ") || "-" }}
          </template>
        </Column>
        <Column field="remark" :header="tl('หมายเหตุ', 'Remark', 'ໝາຍເຫດ')" />
      </DataTable>

      <section class="ref-item-preview">
        <div class="preview-title">
          <div>
            <strong>{{ tl('รายการสินค้าในเอกสาร', 'Document items', 'ລາຍການສິນຄ້າໃນເອກະສານ') }}</strong>
            <span v-if="selectedDoc">{{ selectedDoc.doc_no }} · {{ selectedDocItems.length }} {{ tl('รายการ', 'items', 'ລາຍການ') }}</span>
            <span v-else>{{ tl('เลือกเอกสารด้านบนเพื่อดูสินค้าและจำนวน', 'Select a document above to preview items and quantities.', 'ເລືອກເອກະສານດ້ານເທິງເພື່ອເບິ່ງສິນຄ້າ ແລະ ຈຳນວນ') }}</span>
          </div>
        </div>
        <div v-if="selectedDocItemsError" class="error-msg">{{ selectedDocItemsError }}</div>
        <DataTable
          :value="selectedDocItems"
          :loading="selectedDocItemsLoading"
          size="small"
          scrollable
          scroll-height="260px"
          :empty-message="selectedDoc ? tl('ไม่พบรายการสินค้า', 'No item lines', 'ບໍ່ພົບລາຍການສິນຄ້າ') : tl('ยังไม่ได้เลือกเอกสาร', 'No document selected', 'ຍັງບໍ່ໄດ້ເລືອກເອກະສານ')"
          :pt="{ table: { style: 'min-width: 780px' } }"
          class="ref-item-table"
        >
          <Column :header="tl('ลำดับ', 'No.', 'ລຳດັບ')" bodyClass="text-center" style="width: 72px; min-width: 72px">
            <template #body="{ index }">{{ index + 1 }}</template>
          </Column>
          <Column field="item_code" :header="tl('รหัสสินค้า', 'Item code', 'ລະຫັດສິນຄ້າ')" style="min-width: 130px" />
          <Column field="item_name" :header="tl('ชื่อสินค้า', 'Item name', 'ຊື່ສິນຄ້າ')" style="min-width: 280px" />
          <Column :header="tl('จำนวนคงค้าง', 'Remaining qty', 'ຈຳນວນຄ້າງ')" bodyClass="text-right" style="min-width: 110px">
            <template #body="{ data }">
              <strong>{{ formatQty(data.qty) }}</strong>
            </template>
          </Column>
          <Column field="unit_code" :header="tl('หน่วย', 'Unit', 'ຫົວໜ່ວຍ')" style="min-width: 80px" />
          <Column :header="tl('ราคา', 'Price', 'ລາຄາ')" bodyClass="text-right" style="min-width: 100px">
            <template #body="{ data }">{{ formatCurrency(data.price) }}</template>
          </Column>
          <Column field="discount" :header="tl('ส่วนลด', 'Discount', 'ສ່ວນຫຼຸດ')" style="min-width: 90px" />
        </DataTable>
      </section>
    </div>

    <template #footer>
      <Button
        :label="tl('ยกเลิก', 'Cancel', 'ຍົກເລີກ')"
        icon="pi pi-times"
        severity="secondary"
        outlined
        @click="close"
      />
      <Button
        :label="tl('ดึงรายการ', 'Pull Items', 'ດຶງລາຍການ')"
        icon="pi pi-download"
        :disabled="!selectedDoc || selectedDocItemsLoading || !!selectedDocItemsError || !selectedDocItems.length"
        :loading="fetchingItems"
        @click="confirmSelection"
      />
    </template>
  </Dialog>
</template>

<style scoped>
.ref-doc-dialog {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cust-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 12px;
  background: var(--surface-100, #f5f5f5);
  border-radius: 6px;
  font-size: 0.95rem;
}

.cust-label {
  color: var(--text-color-secondary, #6c757d);
}

.type-tabs {
  display: flex;
  gap: 6px;
  border-bottom: 1px solid var(--surface-border, #e0e0e0);
}

.type-tabs button {
  padding: 8px 16px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  font-size: 0.95rem;
  color: var(--text-color-secondary, #6c757d);
  transition: color 0.15s, border-color 0.15s;
}

.type-tabs button:hover:not(:disabled) {
  color: var(--primary-color, #2563eb);
}

.type-tabs button.active {
  color: var(--primary-color, #2563eb);
  border-bottom-color: var(--primary-color, #2563eb);
  font-weight: 600;
}

.type-tabs button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.search-row {
  display: flex;
  gap: 8px;
}

.search-row :deep(.p-inputtext) {
  flex: 1;
}

.error-msg {
  padding: 8px 12px;
  background: var(--red-50, #fef2f2);
  color: var(--red-700, #b91c1c);
  border-radius: 4px;
  font-size: 0.9rem;
}

.ref-item-preview {
  display: grid;
  gap: 8px;
  min-height: 0;
  padding-top: 2px;
}

.preview-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border: 1px solid var(--surface-border, #e0e0e0);
  border-radius: 6px;
  background: var(--surface-50, #fafafa);
}

.preview-title > div {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.preview-title strong,
.preview-title span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-title strong {
  color: var(--text-color, #1f2937);
  font-weight: 700;
}

.preview-title span {
  color: var(--text-color-secondary, #6c757d);
  font-size: 0.88rem;
}

.ref-item-table :deep(.p-datatable-tbody > tr > td),
.ref-item-table :deep(.p-datatable-thead > tr > th) {
  white-space: nowrap;
}
</style>
