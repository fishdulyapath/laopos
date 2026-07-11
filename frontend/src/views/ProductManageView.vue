<script setup>
import { createProductItemMain, getProductImageUrl, getProductManageList, getUnitManageList } from '@/services/productManageService'
import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import { useToast } from 'primevue/usetoast'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { PERMISSIONS } from '@/utils/permissions'

const router = useRouter()
const toast  = useToast()
const authStore = useAuthStore()

const searchText = ref('')
const products   = ref([])
const isLoading  = ref(false)
const pageSize   = ref(20)
const pageOffset = ref(0)
const totalCount = ref(0)
const sortField  = ref('')
const sortOrder  = ref(0)
const isMobile   = ref(false)
const unitOptions = ref([])
const showCreateDialog = ref(false)
const isCreating = ref(false)
const createForm = ref({
  code: '',
  name_1: '',
  unit_standard: '',
  unit_cost: '',
  item_category: '',
})

const MOBILE_BREAKPOINT = 768
const PRODUCT_CODE_PATTERN = /^[A-Z0-9_-]+$/
let mobileMediaQuery = null

const PLACEHOLDER_IMG =
  'data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2248%22 height=%2248%22 viewBox=%220 0 48 48%22%3E%3Crect width=%2248%22 height=%2248%22 fill=%22%23e5e7eb%22/%3E%3Cpath d=%22M12 34l8-10 6 7 4-5 6 8z%22 fill=%22%239ca3af%22/%3E%3Ccircle cx=%2218%22 cy=%2218%22 r=%223%22 fill=%22%239ca3af%22/%3E%3C/svg%3E'

function onImgError(e) { e.target.src = PLACEHOLDER_IMG }

function formatQty(v) {
  return (Number(v) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const currentPage = computed(() => Math.floor(pageOffset.value / pageSize.value) + 1)
const totalPages = computed(() => Math.max(1, Math.ceil(totalCount.value / pageSize.value)))
const canGoPrev = computed(() => currentPage.value > 1)
const canGoNext = computed(() => currentPage.value < totalPages.value)
const canEditProductMain = computed(() => authStore.hasPermission(PERMISSIONS.productMainEdit))
const canEditAnyProductDetail = computed(() =>
  authStore.hasPermission(PERMISSIONS.productImagesEdit) ||
  authStore.hasPermission(PERMISSIONS.productMainEdit) ||
  authStore.hasPermission(PERMISSIONS.productPriceFormulaEdit) ||
  authStore.hasPermission(PERMISSIONS.productUnitsEdit) ||
  authStore.hasPermission(PERMISSIONS.productBarcodesEdit)
)
const productDetailIcon = computed(() => canEditAnyProductDetail.value ? 'pi pi-pencil' : 'pi pi-eye')

function syncMobileState(eventOrQuery) {
  if (typeof eventOrQuery?.matches === 'boolean') {
    isMobile.value = eventOrQuery.matches
    return
  }
  if (typeof window !== 'undefined') {
    isMobile.value = window.innerWidth <= MOBILE_BREAKPOINT
  }
}

async function loadProducts() {
  isLoading.value = true
  try {
    const res = await getProductManageList({
      search:     searchText.value.trim(),
      sort_field: sortField.value || '',
      sort_order: sortOrder.value === -1 ? 'desc' : sortOrder.value === 1 ? 'asc' : '',
      offset:     pageOffset.value,
      limit:      pageSize.value,
    })
    products.value   = res.data
    totalCount.value = res.totalCount
  } catch (e) {
    toast.add({ severity: 'error', summary: 'โหลดสินค้าไม่สำเร็จ', detail: e.message, life: 3000 })
    products.value   = []
    totalCount.value = 0
  } finally {
    isLoading.value = false
  }
}

async function loadUnitOptions() {
  try {
    const res = await getUnitManageList('')
    unitOptions.value = (res.data || []).map((u) => ({ value: u.code, label: `${u.code} - ${u.name_1}` }))
  } catch {
    unitOptions.value = []
  }
}

function onPage(event) {
  pageOffset.value = event.first
  pageSize.value   = event.rows
  loadProducts()
}

function onSort(event) {
  sortField.value  = event.sortField || ''
  sortOrder.value  = event.sortOrder || 0
  pageOffset.value = 0
  loadProducts()
}

function onSearch() {
  pageOffset.value = 0
  loadProducts()
}

function openCreateDialog() {
  if (!canEditProductMain.value) return
  createForm.value = {
    code: '',
    name_1: '',
    unit_standard: '',
    unit_cost: '',
    item_category: '',
  }
  showCreateDialog.value = true
}

function normalizeProductCodeInput(value) {
  createForm.value.code = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
}

async function createProduct() {
  if (!canEditProductMain.value) return
  const code = createForm.value.code.trim().toUpperCase()
  const name = createForm.value.name_1.trim()
  const unit = createForm.value.unit_standard

  if (!code) {
    toast.add({ severity: 'warn', summary: 'กรุณาระบุรหัสสินค้า', life: 2500 })
    return
  }
  if (!PRODUCT_CODE_PATTERN.test(code)) {
    toast.add({ severity: 'warn', summary: 'รูปแบบรหัสสินค้าไม่ถูกต้อง', detail: 'ใช้ได้เฉพาะ A-Z, 0-9, - และ _', life: 3000 })
    return
  }
  if (!name) {
    toast.add({ severity: 'warn', summary: 'กรุณาระบุชื่อสินค้า', life: 2500 })
    return
  }
  if (!unit) {
    toast.add({ severity: 'warn', summary: 'กรุณาเลือกหน่วยมาตรฐาน', life: 2500 })
    return
  }

  isCreating.value = true
  try {
    const res = await createProductItemMain({
      ...createForm.value,
      code,
      name_1: name,
      unit_standard: unit,
      unit_cost: createForm.value.unit_cost || unit,
    })
    if (res.success) {
      toast.add({ severity: 'success', summary: 'เพิ่มสินค้าสำเร็จ', life: 2000 })
      showCreateDialog.value = false
      await loadProducts()
      router.push({ name: 'ProductManageEdit', params: { code } })
    } else {
      toast.add({ severity: 'error', summary: 'เพิ่มสินค้าไม่สำเร็จ', detail: res.message || '', life: 3000 })
    }
  } catch (e) {
    toast.add({ severity: 'error', summary: 'เพิ่มสินค้าไม่สำเร็จ', detail: e.message, life: 3000 })
  } finally {
    isCreating.value = false
  }
}

function goToPage(page) {
  const safePage = Math.min(Math.max(page, 1), totalPages.value)
  pageOffset.value = (safePage - 1) * pageSize.value
  loadProducts()
}

onMounted(() => {
  if (typeof window !== 'undefined') {
    mobileMediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`)
    syncMobileState(mobileMediaQuery)
    if (typeof mobileMediaQuery.addEventListener === 'function') {
      mobileMediaQuery.addEventListener('change', syncMobileState)
    } else {
      mobileMediaQuery.addListener(syncMobileState)
    }
  }

  loadUnitOptions()
  loadProducts()
})

onBeforeUnmount(() => {
  if (!mobileMediaQuery) return
  if (typeof mobileMediaQuery.removeEventListener === 'function') {
    mobileMediaQuery.removeEventListener('change', syncMobileState)
  } else {
    mobileMediaQuery.removeListener(syncMobileState)
  }
})
</script>

<template>
  <div class="manage-page biz-page">
    <div class="biz-page-header">
      <div class="biz-page-title-wrap">
        <i class="pi pi-tag biz-page-icon" />
        <div>
          <h1 class="biz-page-title">จัดการสินค้า</h1>
          <p class="biz-page-subtitle">ค้นหา เพิ่ม และแก้ไขข้อมูลสินค้าหลัก</p>
        </div>
      </div>
      <Button v-if="canEditProductMain" label="เพิ่มสินค้า" icon="pi pi-plus" @click="openCreateDialog" />
    </div>

    <div class="search-row biz-search-panel">
      <InputText v-model="searchText" placeholder="ค้นหารหัส / ชื่อ / ชื่อ EN / บาร์โค้ด" class="search-input" @keyup.enter="onSearch" />
      <Button icon="pi pi-search" @click="onSearch" />
    </div>

    <DataTable
      v-if="!isMobile"
      :value="products"
      :loading="isLoading"
      :lazy="true"
      :paginator="true"
      :rows="pageSize"
      :first="pageOffset"
      :totalRecords="totalCount"
      :rowsPerPageOptions="[20, 50, 100]"
      :sortField="sortField"
      :sortOrder="sortOrder"
      stripedRows
      scrollable
      class="product-table biz-data-surface"
      @page="onPage"
      @sort="onSort"
    >
      <Column header="รูป" style="width: 68px; min-width: 68px">
        <template #body="{ data }">
          <img :src="getProductImageUrl(data.code)" @error="onImgError" class="product-thumb" loading="lazy" alt="" />
        </template>
      </Column>
      <Column field="code" header="รหัส" style="min-width: 120px" sortable />
      <Column field="name_1" header="ชื่อสินค้า" style="min-width: 220px" sortable />
      <Column field="name_eng_1" header="ชื่อ EN" style="min-width: 180px" />
      <Column field="unit_standard" header="หน่วย" style="min-width: 70px" />
      <Column field="balance_qty" header="คงเหลือ" style="min-width: 100px" bodyClass="col-num" headerClass="col-num" sortable>
        <template #body="{ data }">{{ formatQty(data.balance_qty) }}</template>
      </Column>
      <Column field="book_out_qty" header="ค้างจอง" style="min-width: 100px" bodyClass="col-num" headerClass="col-num" sortable>
        <template #body="{ data }">{{ formatQty(data.book_out_qty) }}</template>
      </Column>
      <Column field="accrued_out_qty" header="ค้างส่ง" style="min-width: 100px" bodyClass="col-num" headerClass="col-num" sortable>
        <template #body="{ data }">{{ formatQty(data.accrued_out_qty) }}</template>
      </Column>
      <Column field="accrued_in_qty" header="ค้างรับ" style="min-width: 100px" bodyClass="col-num" headerClass="col-num" sortable>
        <template #body="{ data }">{{ formatQty(data.accrued_in_qty) }}</template>
      </Column>
      <Column style="width: 52px; min-width: 52px">
        <template #body="{ data }">
          <Button :icon="productDetailIcon" text rounded size="small" @click="router.push({ name: 'ProductManageEdit', params: { code: data.code } })" />
        </template>
      </Column>
      <template #empty>
        <div class="table-empty">ไม่พบข้อมูล</div>
      </template>
    </DataTable>

    <div v-else-if="isLoading" class="mobile-loading">
      <i class="pi pi-spinner pi-spin" />
    </div>

    <div v-else-if="products.length" class="mobile-list">
      <div v-for="product in products" :key="product.code" class="product-card">
        <div class="product-card-main">
          <img :src="getProductImageUrl(product.code)" @error="onImgError" class="product-thumb product-thumb-mobile" loading="lazy" alt="" />
          <div class="product-card-body">
            <div class="product-card-top">
              <div class="product-card-meta">
                <p class="product-code">{{ product.code }}</p>
                <h2 class="product-name">{{ product.name_1 || '-' }}</h2>
                <p v-if="product.name_eng_1" class="product-name-en">{{ product.name_eng_1 }}</p>
              </div>
              <Button :icon="productDetailIcon" text rounded size="small" @click="router.push({ name: 'ProductManageEdit', params: { code: product.code } })" />
            </div>

            <div class="product-badges">
              <span class="product-badge">หน่วย {{ product.unit_standard || '-' }}</span>
            </div>

            <div class="product-stats">
              <div class="product-stat">
                <span>คงเหลือ</span>
                <strong>{{ formatQty(product.balance_qty) }}</strong>
              </div>
              <div class="product-stat">
                <span>ค้างจอง</span>
                <strong>{{ formatQty(product.book_out_qty) }}</strong>
              </div>
              <div class="product-stat">
                <span>ค้างส่ง</span>
                <strong>{{ formatQty(product.accrued_out_qty) }}</strong>
              </div>
              <div class="product-stat">
                <span>ค้างรับ</span>
                <strong>{{ formatQty(product.accrued_in_qty) }}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="mobile-pager">
        <span class="mobile-pager-summary">{{ totalCount }} รายการ</span>
        <div class="mobile-pager-controls">
          <Button icon="pi pi-angle-left" text rounded :disabled="!canGoPrev" @click="goToPage(currentPage - 1)" />
          <span>{{ currentPage }} / {{ totalPages }}</span>
          <Button icon="pi pi-angle-right" text rounded :disabled="!canGoNext" @click="goToPage(currentPage + 1)" />
        </div>
      </div>
    </div>

    <div v-else class="table-empty biz-empty-state">ไม่พบข้อมูล</div>

    <Dialog
      :visible="showCreateDialog"
      @update:visible="showCreateDialog = $event"
      header="เพิ่มสินค้าใหม่"
      :modal="true"
      :draggable="false"
      style="width: min(520px, 95vw)"
    >
      <div class="create-form">
        <div class="create-field">
          <label>รหัสสินค้า <span class="required">*</span></label>
          <InputText
            :modelValue="createForm.code"
            class="w-full"
            placeholder="เช่น ITM001"
            @update:modelValue="normalizeProductCodeInput"
          />
          <small class="code-help">อนุญาตเฉพาะ A-Z, 0-9, - และ _</small>
        </div>
        <div class="create-field">
          <label>ชื่อสินค้า <span class="required">*</span></label>
          <InputText v-model="createForm.name_1" class="w-full" placeholder="ชื่อสินค้า" />
        </div>
        <div class="create-grid-2">
          <div class="create-field">
            <label>หน่วยมาตรฐาน <span class="required">*</span></label>
            <Select
              v-model="createForm.unit_standard"
              :options="unitOptions"
              optionLabel="label"
              optionValue="value"
              class="w-full"
              placeholder="เลือกหน่วย"
              filter
            />
          </div>
          <div class="create-field">
            <label>หน่วยต้นทุน</label>
            <Select
              v-model="createForm.unit_cost"
              :options="unitOptions"
              optionLabel="label"
              optionValue="value"
              class="w-full"
              placeholder="(ไม่เลือก = ใช้หน่วยมาตรฐาน)"
              filter
              showClear
            />
          </div>
        </div>
      </div>

      <template #footer>
        <Button label="ยกเลิก" severity="secondary" outlined @click="showCreateDialog = false" />
        <Button label="บันทึกและแก้ไขต่อ" icon="pi pi-save" :loading="isCreating" @click="createProduct" />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.manage-page {
  padding: 0;
}

/* Search */
.search-row {
  display: flex;
  gap: 0.5rem;
}

.search-input {
  flex: 1;
  max-width: 400px;
}

.create-form {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  padding-top: 0.25rem;
}

.create-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.create-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.create-field label {
  font-size: 0.8rem;
  color: var(--p-text-color-secondary);
}

.code-help {
  font-size: 0.74rem;
  color: var(--p-text-color-secondary);
}

.required {
  color: var(--p-red-500);
}

/* Table */
.product-thumb {
  width: 44px;
  height: 44px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--p-surface-200);
  display: block;
}

.table-empty {
  text-align: center;
  padding: 2.5rem 0;
  color: var(--p-text-color-secondary);
}

.mobile-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 220px;
  font-size: 1.5rem;
  color: var(--p-text-color-secondary);
}

.mobile-list {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
}

.product-card {
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
  background: var(--p-surface-0);
  box-shadow: var(--app-card-shadow);
  padding: 0.875rem;
}

.product-card-main {
  display: flex;
  gap: 0.875rem;
}

.product-thumb-mobile {
  width: 72px;
  height: 72px;
  border-radius: 10px;
  flex-shrink: 0;
}

.product-card-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.product-card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.product-card-meta {
  min-width: 0;
}

.product-code {
  margin: 0;
  font-size: 0.76rem;
  color: var(--p-text-color-secondary);
}

.product-name {
  margin: 0.18rem 0 0;
  font-size: 1rem;
  font-weight: 700;
  line-height: 1.3;
  word-break: break-word;
}

.product-name-en {
  margin: 0.2rem 0 0;
  font-size: 0.8rem;
  color: var(--p-text-color-secondary);
  word-break: break-word;
}

.product-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.product-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.35rem 0.6rem;
  border-radius: 999px;
  background: var(--p-surface-100);
  font-size: 0.75rem;
  color: var(--p-text-color-secondary);
}

.product-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.625rem;
}

.product-stat {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.625rem 0.7rem;
  border-radius: 10px;
  background: var(--p-surface-50);
}

.product-stat span {
  font-size: 0.72rem;
  color: var(--p-text-color-secondary);
}

.product-stat strong {
  font-size: 0.92rem;
}

.mobile-pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.25rem 0;
  color: var(--p-text-color-secondary);
}

.mobile-pager-summary {
  font-size: 0.82rem;
}

.mobile-pager-controls {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

@media (max-width: 768px) {
  .manage-page {
    gap: 0.875rem;
  }

  .search-row {
    flex-direction: column;
  }

  .search-row :deep(.p-button) {
    width: 100%;
    justify-content: center;
  }

  .search-input {
    max-width: none;
  }

  .product-card-main {
    flex-direction: column;
  }

  .product-thumb-mobile {
    width: 100%;
    height: 180px;
  }

  .product-card-top,
  .mobile-pager {
    flex-direction: column;
    align-items: stretch;
  }

  .product-card-top :deep(.p-button) {
    align-self: flex-end;
  }

  .product-stats {
    grid-template-columns: 1fr;
  }

  .create-grid-2 {
    grid-template-columns: 1fr;
  }

  .mobile-pager-controls {
    justify-content: space-between;
  }
}
</style>
