<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useToast } from 'primevue/usetoast'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import InputNumber from 'primevue/inputnumber'
import Skeleton from 'primevue/skeleton'
import Dialog from 'primevue/dialog'
import Select from 'primevue/select'
import { getProductList, getProductDetail } from '@/services/sellService'
import { getItemReservedQty } from '@/services/basketService'
import { adjustStock, getWarehouseList, getShelfList, getInventoryBalance } from '@/services/inventoryService'
import { useAuthStore } from '@/stores/auth'
import { usePosStore } from '@/stores/pos'
import { PERMISSIONS } from '@/utils/permissions'

const toast = useToast()
const authStore = useAuthStore()
const posStore = usePosStore()

// ─── ค้นหา ────────────────────────────────────────────────────────────
const search = ref('')
const searchResults = ref([])
const searchLoading = ref(false)
let searchTimer = null

function onSearchInput() {
  clearTimeout(searchTimer)
  selectedProduct.value = null
  units.value = []
  if (!search.value.trim()) {
    searchResults.value = []
    return
  }
  searchTimer = setTimeout(doSearch, 600)
}

async function doSearch() {
  searchLoading.value = true
  try {
    searchResults.value = await getProductList({ search: search.value.trim(), limit: 30 })
  } catch {
    searchResults.value = []
  } finally {
    searchLoading.value = false
  }
}

// ─── ผลลัพธ์ & รายละเอียด ─────────────────────────────────────────────
const selectedProduct = ref(null)
const units = ref([])
const reservedBaseUnits = ref(0)
const detailLoading = ref(false)

// ─── คลัง / ที่เก็บ ────────────────────────────────────────────────────
const whList = ref([])
const shelfList = ref([])
const selectedWh = ref('')
const selectedShelf = ref('')
const locationBalance = ref(null)

const canAdjustStock = computed(() => authStore.hasPermission(PERMISSIONS.inventoryAdjustStock))
const canAdjust = computed(() => canAdjustStock.value && selectedWh.value !== '' && selectedShelf.value !== '')

onMounted(async () => {
  try {
    const list = await getWarehouseList()
    whList.value = [{ code: '', name_1: 'คลังทั้งหมด' }, ...list]
  } catch { /* silent */ }
})

watch(selectedWh, async (wh) => {
  selectedShelf.value = ''
  if (wh) {
    const fetches = [getShelfList(wh)]
    if (selectedProduct.value) fetches.push(getInventoryBalance(selectedProduct.value.item_code, wh, ''))
    const [list, bal] = await Promise.all(fetches)
    shelfList.value = [{ code: '', name_1: 'ที่เก็บทั้งหมด' }, ...list]
    locationBalance.value = bal ?? null
  } else {
    shelfList.value = []
    locationBalance.value = null
  }
})

watch(selectedShelf, async (shelf) => {
  if (selectedWh.value && selectedProduct.value) {
    locationBalance.value = await getInventoryBalance(
      selectedProduct.value.item_code, selectedWh.value, shelf,
    )
  } else {
    locationBalance.value = null
  }
})

async function selectProduct(product) {
  if (detailLoading.value) return
  selectedProduct.value = product
  units.value = []
  reservedBaseUnits.value = 0
  locationBalance.value = null
  detailLoading.value = true
  try {
    const fetches = [
      getProductDetail(product.item_code, ''),
      getItemReservedQty(product.item_code),
    ]
    if (selectedWh.value && selectedShelf.value) {
      fetches.push(getInventoryBalance(product.item_code, selectedWh.value, selectedShelf.value))
    }
    const [unitData, reserved, locBal] = await Promise.all(fetches)
    units.value = unitData
    reservedBaseUnits.value = reserved
    if (locBal !== undefined) locationBalance.value = locBal
  } catch {
    toast.add({ severity: 'error', summary: 'โหลดข้อมูลล้มเหลว', detail: product.item_name, life: 3000 })
  } finally {
    detailLoading.value = false
  }
}

function getSumBalance(unit) {
  return locationBalance.value !== null ? locationBalance.value : Number(unit.sum_balance_qty ?? 0)
}

function rawBalance(unit) {
  const safeRatio = Math.max(1, Number(unit.ratio))
  return Math.floor(getSumBalance(unit) / safeRatio)
}

function reservedInUnit(unit) {
  const safeRatio = Math.max(1, Number(unit.ratio))
  return Math.floor(reservedBaseUnits.value / safeRatio)
}

function effectiveBalance(unit) {
  return Math.max(0, rawBalance(unit) - reservedInUnit(unit))
}

function isBaseUnit(unit) {
  return unit.unit_code === selectedProduct.value?.unit_standard
}

// ─── สแกนบาร์โค้ด ─────────────────────────────────────────────────────
// ─── ปรับปรุงสต๊อก ────────────────────────────────────────────────────
const showAdjust = ref(false)
const adjustUnit = ref(null)
const adjustQty = ref(null)
const adjustSaving = ref(false)

function openAdjust(unit) {
  adjustUnit.value = { ...unit, wh_code: selectedWh.value, shelf_code: selectedShelf.value }
  adjustQty.value = Math.max(0, rawBalance(unit))
  showAdjust.value = true
}

const adjustCurrentBalance = computed(() =>
  adjustUnit.value ? effectiveBalance(adjustUnit.value) : 0
)

async function confirmAdjust() {
  if (adjustQty.value === null || adjustQty.value < 0) return
  adjustSaving.value = true
  try {
    const result = await adjustStock({
      item_code: selectedProduct.value.item_code,
      item_name: selectedProduct.value.item_name,
      unit_code: adjustUnit.value.unit_code,
      barcode: adjustUnit.value.barcode || '',
      wh_code: adjustUnit.value.wh_code || '',
      shelf_code: adjustUnit.value.shelf_code || '',
      branch_code: posStore.selectedPos?.branch_code || '',
      emp_code: authStore.employee?.user_code || '',
      qty: adjustQty.value,
    })
    const doc_no = result?.doc_no ?? ''
    toast.add({ severity: 'success', summary: 'บันทึกสำเร็จ', detail: `เลขที่เอกสาร: ${doc_no}`, life: 5000 })
    showAdjust.value = false
    // โหลดยอดใหม่หลังปรับ — ไม่ reset wh/shelf ที่เลือกไว้
    const [unitData, reserved] = await Promise.all([
      getProductDetail(selectedProduct.value.item_code, ''),
      getItemReservedQty(selectedProduct.value.item_code),
    ])
    units.value = unitData
    reservedBaseUnits.value = reserved
    if (selectedWh.value && selectedShelf.value) {
      locationBalance.value = await getInventoryBalance(
        selectedProduct.value.item_code, selectedWh.value, selectedShelf.value,
      )
    }
  } catch {
    toast.add({ severity: 'error', summary: 'บันทึกไม่สำเร็จ', detail: 'กรุณาลองใหม่อีกครั้ง', life: 3000 })
  } finally {
    adjustSaving.value = false
  }
}
</script>

<template>
  <div class="inventory-page biz-page">

    <!-- Header -->
    <div class="biz-page-header">
      <div class="biz-page-title-wrap">
        <i class="pi pi-box biz-page-icon" />
        <div>
          <h1 class="biz-page-title">คลังสินค้า</h1>
          <p class="biz-page-subtitle">ค้นหาสต็อก ตรวจยอดจอง และปรับปรุงยอดจริง</p>
        </div>
      </div>
    </div>

    <!-- Filter: คลัง / ที่เก็บ -->
    <div class="location-row biz-search-panel">
      <Select
        v-model="selectedWh"
        :options="whList"
        optionLabel="name_1"
        optionValue="code"
        placeholder="-- เลือกคลัง --"
        class="location-select"
      >
        <template #value="{ value }">
          <template v-if="value !== undefined && value !== null">
            {{ whList.find(w => w.code === value)?.code || '' }}
            {{ whList.find(w => w.code === value)?.name_1 || '' }}
          </template>
        </template>
        <template #option="{ option }">
          <span class="loc-code">{{ option.code }}</span>
          <span class="loc-name">{{ option.name_1 }}</span>
        </template>
      </Select>
      <Select
        v-model="selectedShelf"
        :options="shelfList"
        optionLabel="name_1"
        optionValue="code"
        placeholder="-- เลือกที่เก็บ --"
        :disabled="!selectedWh"
        class="location-select"
      >
        <template #value="{ value }">
          <template v-if="value !== undefined && value !== null">
            {{ shelfList.find(s => s.code === value)?.code || '' }}
            {{ shelfList.find(s => s.code === value)?.name_1 || '' }}
          </template>
        </template>
        <template #option="{ option }">
          <span class="loc-code">{{ option.code }}</span>
          <span class="loc-name">{{ option.name_1 }}</span>
        </template>
      </Select>
    </div>

    <!-- Search bar -->
    <div class="search-row biz-search-panel">
      <span class="search-wrap">
        <InputText
          v-model="search"
          placeholder="ค้นหาชื่อ / รหัสสินค้า..."
          class="search-input"
          @input="onSearchInput"
        />
      </span>
    </div>

    <!-- Search results list -->
    <div v-if="searchLoading" class="skeleton-list">
      <Skeleton v-for="n in 5" :key="n" height="2.75rem" class="sk-row" />
    </div>

    <ul
      v-else-if="searchResults.length > 0 && !selectedProduct"
      class="result-list"
    >
      <li
        v-for="p in searchResults"
        :key="p.item_code"
        class="result-item"
        @click="selectProduct(p)"
      >
        <span class="result-name">{{ p.item_name }}</span>
        <span class="result-code">{{ p.item_code }}</span>
      </li>
    </ul>

    <div
      v-else-if="search.trim() && !searchLoading && searchResults.length === 0"
      class="empty-state biz-empty-state"
    >
      <i class="pi pi-search empty-icon" />
      <p>ไม่พบสินค้าที่ค้นหา</p>
    </div>

    <!-- Product detail card -->
    <div v-if="selectedProduct" class="detail-card biz-data-surface">
      <div class="detail-header">
        <div class="detail-title-wrap">
          <Button
            icon="pi pi-arrow-left"
            text
            severity="secondary"
            class="back-btn"
            @click="selectedProduct = null; searchResults = []"
          />
          <div>
            <div class="detail-name">{{ selectedProduct.item_name }}</div>
            <div class="detail-code">{{ selectedProduct.item_code }}</div>
          </div>
        </div>
      </div>

      <div v-if="detailLoading" class="skeleton-list">
        <Skeleton v-for="n in 3" :key="n" height="3rem" class="sk-row" />
      </div>

      <table v-else-if="units.length > 0" class="unit-table">
        <thead>
          <tr>
            <th>หน่วย</th>
            <th class="num-col" style="text-align:center">คงเหลือ</th>
            <th class="num-col" style="text-align:center">ชั้นวาง</th>
            <th class="num-col" style="text-align:center">ตะกร้า</th>
            <th class="num-col" style="text-align:center">สถานะ</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="unit in units" :key="unit.unit_code">
            <td>
              {{ unit.unit_code }}
              <span v-if="isBaseUnit(unit)" class="base-badge">หน่วยฐาน</span>
            </td>
            <td class="num-col">
              {{ rawBalance(unit).toLocaleString('th-TH') }}
            </td>
            <td class="num-col">
              {{ effectiveBalance(unit).toLocaleString('th-TH') }}
            </td>
            <td class="num-col reserved-col">
              {{ reservedInUnit(unit).toLocaleString('th-TH') }}
            </td>
            <td class="num-col">
              <span
                class="status-badge"
                :class="effectiveBalance(unit) <= 0 ? 'out' : 'ok'"
              >
                {{ effectiveBalance(unit) <= 0 ? 'หมด' : 'มีสินค้า' }}
              </span>
            </td>
            <td class="action-col">
              <Button
                label="ปรับปรุงสต๊อก"
                size="small"
                severity="warning"
                outlined
                :disabled="!canAdjust"
                v-tooltip.top="!canAdjustStock ? 'ไม่มีสิทธิ์ปรับปรุงสต๊อก' : !canAdjust ? 'เลือกคลังและที่เก็บก่อน' : undefined"
                @click="openAdjust(unit)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Adjust stock dialog -->
    <Dialog
      :visible="showAdjust"
      header="ปรับปรุงสต๊อก"
      :modal="true"
      :draggable="false"
      style="width: min(420px, 95vw)"
      @update:visible="showAdjust = $event"
    >
      <div v-if="adjustUnit" class="adjust-body">
        <div class="adjust-info">
          <span class="adjust-label">สินค้า</span>
          <span class="adjust-value">{{ selectedProduct?.item_name }}</span>
        </div>
        <div class="adjust-info">
          <span class="adjust-label">หน่วย</span>
          <span class="adjust-value">{{ adjustUnit.unit_code }}</span>
        </div>
        <div class="adjust-info">
          <span class="adjust-label">ยอดปัจจุบัน</span>
          <span class="adjust-value bold">{{ adjustCurrentBalance.toLocaleString('th-TH') }}</span>
        </div>

        <div class="adjust-field">
          <label class="adjust-label">จำนวนสต๊อกจริง</label>
          <InputNumber
            v-model="adjustQty"
            :min="0"
            :use-grouping="false"
            class="adjust-input"
            autofocus
          />
        </div>

        <div class="adjust-actions">
          <Button
            label="ยกเลิก"
            severity="secondary"
            outlined
            @click="showAdjust = false"
            :disabled="adjustSaving"
          />
          <Button
            label="ยืนยันบันทึก"
            icon="pi pi-check"
            :loading="adjustSaving"
            :disabled="adjustQty === null"
            @click="confirmAdjust"
          />
        </div>
      </div>
    </Dialog>

  </div>
</template>

<style scoped>
.inventory-page {
  padding: 0;
}

/* Search */
.search-row {
  display: flex;
  gap: 0.5rem;
}

.search-wrap {
  flex: 1;
}

.search-input {
  width: 100%;
}

/* Skeletons */
.skeleton-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.sk-row {
  border-radius: 8px;
}

/* Result list */
.result-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.result-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  border: 1px solid var(--p-surface-border);
  background: var(--p-surface-0);
  cursor: pointer;
  transition: background 0.15s;
}

.result-item:hover {
  background: var(--app-hover-bg);
}

.result-name {
  font-size: 0.95rem;
  font-weight: 500;
}

.result-code {
  font-size: 0.8rem;
  color: var(--p-text-color-secondary);
}

/* Empty */
.empty-state {
  padding: 3rem 0;
}

.empty-icon {
  font-size: 2.5rem;
}

.empty-state p {
  margin: 0;
}

/* Detail card */
.detail-card {
  overflow: hidden;
}

.detail-header {
  padding: 0.75rem 1rem;
  background: var(--p-surface-50);
  border-bottom: 1px solid var(--p-surface-200);
}

.detail-title-wrap {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.back-btn {
  flex-shrink: 0;
}

.detail-name {
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.3;
}

.detail-code {
  font-size: 0.8rem;
  color: var(--p-text-color-secondary);
}

/* Location selectors */
.location-row {
  display: flex;
  gap: 0.5rem;
}

.location-select {
  flex: 1;
}

.loc-code {
  font-weight: 600;
  margin-right: 0.4rem;
  color: var(--p-text-color);
}

.loc-name {
  color: var(--p-text-color-secondary);
  font-size: 0.85rem;
}

/* Unit table */
.unit-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.unit-table th {
  padding: 0.6rem 0.875rem;
  text-align: left;
  font-weight: 600;
  font-size: 0.8rem;
  color: var(--p-text-color-secondary);
  background: var(--p-surface-50);
  border-bottom: 1px solid var(--p-surface-200);
}

.unit-table td {
  padding: 0.7rem 0.875rem;
  border-bottom: 1px solid var(--p-surface-100);
  vertical-align: middle;
}

.unit-table tbody tr:last-child td {
  border-bottom: none;
}

.num-col {
  text-align: right;
}

.reserved-col {
  color: var(--p-text-color-secondary);
  font-size: 0.85rem;
}

.action-col {
  text-align: right;
  white-space: nowrap;
}

.base-badge {
  display: inline-block;
  margin-left: 0.4rem;
  font-size: 0.7rem;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  background: var(--p-primary-100, #e8f4fd);
  color: var(--p-primary-color);
  vertical-align: middle;
}

.status-badge {
  display: inline-block;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
}

.status-badge.ok {
  background: var(--p-green-100, #dcfce7);
  color: var(--p-green-700, #15803d);
}

.status-badge.out {
  background: var(--p-red-100, #fee2e2);
  color: var(--p-red-600, #dc2626);
}

/* Adjust dialog */
.adjust-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding-top: 0.25rem;
}

.adjust-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.9rem;
}

.adjust-label {
  color: var(--p-text-color-secondary);
}

.adjust-value {
  font-weight: 500;
}

.adjust-value.bold {
  font-weight: 700;
  font-size: 1.05rem;
  color: var(--p-primary-color);
}

.adjust-field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--p-surface-200);
}

.adjust-input {
  width: 100%;
}

.adjust-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
