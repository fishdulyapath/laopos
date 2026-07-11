<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputNumber from 'primevue/inputnumber'
import InputText from 'primevue/inputtext'
import Skeleton from 'primevue/skeleton'
import { getCategoryList, getProductList } from '@/services/sellService'
import { getPurchaseProductDetail, withLatestPurchasePrices } from '@/services/purchaseService'
import { formatCurrency } from '@/utils/formatters'
import { productImageUrl } from '@/utils/imageUrls'

const props = defineProps({
  visible: { type: Boolean, default: false },
  custCode: { type: String, default: '' },
})

const emit = defineEmits(['update:visible', 'confirm'])

const search = ref('')
const activeCategory = ref('')
const categoryTabsRef = ref(null)
const categories = ref([])
const products = ref([])
const loading = ref(false)
const cartItems = ref([])
const detailVisible = ref(false)
const detailLoading = ref(false)
const selectedProduct = ref(null)
const unitOptions = ref([])
const selectedUnitKey = ref('')
const detailQty = ref(1)
let searchTimer = null
let loadRunId = 0

const categoryTabs = computed(() => [
  { code: '', name: 'ทั้งหมด', icon: 'pi pi-th-large' },
  { code: 'promo', name: 'โปรโมชั่น', icon: 'pi pi-tag' },
  ...categories.value.map((cat) => ({ code: cat.code, name: cat.name, icon: 'pi pi-folder' })),
])

const cartCount = computed(() => cartItems.value.reduce((sum, item) => sum + Number(item.qty || 0), 0))
const cartTotal = computed(() => cartItems.value.reduce((sum, item) => sum + (Number(item.qty || 0) * unitPrice(item.product)), 0))
const selectedUnit = computed(() =>
  unitOptions.value.find((unit) => productKey(unit) === selectedUnitKey.value) || unitOptions.value[0] || null
)
const selectedLineTotal = computed(() => Number(detailQty.value || 0) * unitPrice(selectedUnit.value || {}))

function unitCode(product) {
  return product.unit_code || product.unit_cost || product.unit_standard || product.start_sale_unit || ''
}

function unitPrice(product) {
  return Number(product.price_0 ?? product.price ?? product.sale_price ?? 0)
}

function productKey(product) {
  return `${product.item_code || product.code || product.ic_code || ''}::${unitCode(product)}`
}

function productQty(product) {
  const key = productKey(product)
  return cartItems.value.find((item) => item.key === key)?.qty || 0
}

function close() {
  emit('update:visible', false)
}

function clearCart() {
  cartItems.value = []
}

function normalizeProductUnit(product) {
  return {
    ...product,
    item_code: product.item_code || product.code || product.ic_code || selectedProduct.value?.item_code || selectedProduct.value?.code || '',
    item_name: product.item_name || product.name_1 || selectedProduct.value?.item_name || selectedProduct.value?.name_1 || '',
    unit_code: unitCode(product),
    price: unitPrice(product),
  }
}

function onImgError(event) {
  event.target.style.display = 'none'
  event.target.nextElementSibling?.style.setProperty('display', 'flex')
}

async function loadCategories() {
  try {
    categories.value = await getCategoryList()
  } catch {
    categories.value = []
  }
}

async function loadProducts() {
  const runId = ++loadRunId
  loading.value = true
  try {
    const rows = await getProductList({
      cust_code: props.custCode,
      category: activeCategory.value === 'promo' ? '' : activeCategory.value,
      ispromotion: activeCategory.value === 'promo' ? '1' : '',
      search: search.value.trim(),
      isstock: '',
      offset: 0,
      limit: 60,
    })
    const purchaseRows = rows.map((row) => ({ ...row, unit_code: unitCode(row) }))
    let pricedRows = purchaseRows
    try {
      pricedRows = await withLatestPurchasePrices(purchaseRows)
    } catch {
      pricedRows = purchaseRows
    }
    if (runId === loadRunId) products.value = pricedRows
  } catch {
    if (runId === loadRunId) products.value = []
  } finally {
    if (runId === loadRunId) loading.value = false
  }
}

function scheduleSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => loadProducts(), 300)
}

function selectCategory(code) {
  activeCategory.value = code
  loadProducts()
}

function scrollCategoryTabs(direction) {
  const el = categoryTabsRef.value
  if (!el) return
  el.scrollBy({ left: direction * Math.max(240, el.clientWidth * 0.72), behavior: 'smooth' })
}

function addProduct(product, qty = 1) {
  const key = productKey(product)
  const addQty = Number(qty || 0)
  if (!key || addQty <= 0) return
  const existing = cartItems.value.find((item) => item.key === key)
  if (existing) {
    existing.qty = Number(existing.qty || 0) + addQty
    return
  }
  cartItems.value.push({
    key,
    product: normalizeProductUnit(product),
    qty: addQty,
  })
}

async function openProductDetail(product) {
  selectedProduct.value = product
  detailQty.value = 1
  unitOptions.value = []
  selectedUnitKey.value = ''
  detailVisible.value = true
  detailLoading.value = true
  try {
    const itemCode = product.item_code || product.code || product.ic_code || ''
    const rows = itemCode ? await getPurchaseProductDetail(itemCode) : []
    const normalizedRows = rows.length
      ? rows.map((row) => normalizeProductUnit(row))
      : [normalizeProductUnit(product)]
    unitOptions.value = normalizedRows
    const defaultKey = productKey(product)
    selectedUnitKey.value = unitOptions.value.some((unit) => productKey(unit) === defaultKey)
      ? defaultKey
      : productKey(unitOptions.value[0] || product)
  } catch {
    unitOptions.value = [normalizeProductUnit(product)]
    selectedUnitKey.value = productKey(unitOptions.value[0])
  } finally {
    detailLoading.value = false
  }
}

function addSelectedUnitToCart() {
  if (!selectedUnit.value) return
  addProduct(selectedUnit.value, detailQty.value)
  detailVisible.value = false
}

function setQty(item, qty) {
  const nextQty = Number(qty || 0)
  if (nextQty <= 0) {
    removeItem(item)
    return
  }
  item.qty = nextQty
}

function removeItem(item) {
  cartItems.value = cartItems.value.filter((row) => row.key !== item.key)
}

function confirmCart() {
  if (!cartItems.value.length) return
  emit('confirm', cartItems.value.map((item) => ({
    product: item.product,
    qty: Number(item.qty || 0),
  })))
  clearCart()
  close()
}

watch(() => props.visible, async (visible) => {
  if (!visible) return
  if (!categories.value.length) await loadCategories()
  await loadProducts()
})

onBeforeUnmount(() => clearTimeout(searchTimer))
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    class="purchase-basket-dialog"
    :closable="false"
    :draggable="false"
    :style="{ width: '100vw', height: '100dvh', maxHeight: '100dvh' }"
    content-class="purchase-basket-content"
    @update:visible="emit('update:visible', $event)"
  >
    <template #container>
      <div class="purchase-basket-shell">
        <header class="purchase-basket-header">
          <div class="basket-title-block">
            <Button icon="pi pi-times" rounded text severity="secondary" aria-label="ปิด" @click="close" />
            <div>
              <h2>ตะกร้าสินค้า</h2>
              <span>{{ cartCount }} ชิ้น · {{ formatCurrency(cartTotal) }}</span>
            </div>
          </div>
          <div class="basket-search-row">
            <span class="basket-search-wrap">
              <i class="pi pi-search" />
              <InputText v-model.trim="search" placeholder="ค้นหารหัส / ชื่อ / บาร์โค้ด" @input="scheduleSearch" @keyup.enter="loadProducts" />
            </span>
          </div>
        </header>

        <div class="purchase-category-strip">
          <Button icon="pi pi-chevron-left" rounded text severity="secondary" aria-label="เลื่อนหมวดหมู่ซ้าย" @click="scrollCategoryTabs(-1)" />
          <nav ref="categoryTabsRef" class="purchase-category-tabs">
            <button
              v-for="cat in categoryTabs"
              :key="cat.code || 'all'"
              class="purchase-category-tab"
              :class="{ active: activeCategory === cat.code }"
              @click="selectCategory(cat.code)"
            >
              <i :class="cat.icon" />
              <span>{{ cat.name }}</span>
            </button>
          </nav>
          <Button icon="pi pi-chevron-right" rounded text severity="secondary" aria-label="เลื่อนหมวดหมู่ขวา" @click="scrollCategoryTabs(1)" />
        </div>

        <main class="purchase-basket-body">
          <section class="purchase-product-area">
            <div class="purchase-product-grid">
              <button
                v-for="product in products"
                :key="productKey(product)"
                type="button"
                class="purchase-product-card"
                @click="openProductDetail(product)"
              >
                <div class="purchase-product-image">
                  <img :src="productImageUrl(product.item_code)" :alt="product.item_name || product.name_1" @error="onImgError" />
                  <i class="pi pi-box purchase-image-placeholder" style="display:none" />
                  <span v-if="productQty(product)" class="purchase-qty-badge">{{ productQty(product) }}</span>
                </div>
                <div class="purchase-product-info">
                  <strong>{{ product.item_name || product.name_1 }}</strong>
                  <span>{{ product.item_code || product.code }}</span>
                  <div>
                    <small>{{ unitCode(product) || '-' }}</small>
                    <b>{{ formatCurrency(unitPrice(product)) }}</b>
                  </div>
                  <small v-if="product.last_purchase_doc_no" class="purchase-price-source">
                    PU ล่าสุด {{ product.last_purchase_doc_no }}
                  </small>
                </div>
              </button>

              <template v-if="loading && !products.length">
                <div v-for="n in 12" :key="`basket-sk-${n}`" class="purchase-product-card skeleton-card">
                  <Skeleton height="7rem" />
                  <div class="purchase-product-info">
                    <Skeleton width="85%" height="1rem" />
                    <Skeleton width="50%" height="0.75rem" />
                  </div>
                </div>
              </template>
            </div>
            <div v-if="!loading && !products.length" class="purchase-empty-products">
              <i class="pi pi-search" />
              <span>ไม่พบสินค้า</span>
            </div>
          </section>

          <aside class="purchase-cart-panel">
            <div class="purchase-cart-head">
              <strong>รายการในตะกร้า</strong>
              <Button v-if="cartItems.length" label="ล้าง" text severity="danger" size="small" @click="clearCart" />
            </div>
            <div v-if="!cartItems.length" class="purchase-cart-empty">
              <i class="pi pi-shopping-cart" />
              <span>แตะสินค้าเพื่อเพิ่มเข้าตะกร้า</span>
            </div>
            <div v-else class="purchase-cart-list">
              <div v-for="item in cartItems" :key="item.key" class="purchase-cart-row">
                <div class="purchase-cart-text">
                  <strong>{{ item.product.item_name || item.product.name_1 }}</strong>
                  <span>{{ item.product.item_code }} · {{ item.product.unit_code || '-' }}</span>
                </div>
                <div class="purchase-cart-controls">
                  <Button icon="pi pi-minus" rounded outlined size="small" severity="secondary" @click="setQty(item, Number(item.qty) - 1)" />
                  <InputNumber :model-value="item.qty" input-class="purchase-cart-qty" :min="0" :max-fraction-digits="2" @update:model-value="setQty(item, $event)" />
                  <Button icon="pi pi-plus" rounded outlined size="small" severity="secondary" @click="setQty(item, Number(item.qty) + 1)" />
                  <Button icon="pi pi-trash" rounded text size="small" severity="danger" @click="removeItem(item)" />
                </div>
              </div>
            </div>
          </aside>
        </main>

        <footer class="purchase-basket-footer">
          <div>
            <span>รวม</span>
            <strong>{{ cartCount }} ชิ้น · {{ formatCurrency(cartTotal) }}</strong>
          </div>
          <Button label="เพิ่มเข้า PU" icon="pi pi-check" :disabled="!cartItems.length" @click="confirmCart" />
        </footer>
      </div>
    </template>
  </Dialog>

  <Dialog
    v-model:visible="detailVisible"
    modal
    :draggable="false"
    class="purchase-unit-dialog"
    :style="{ width: 'min(760px, 96vw)' }"
    header="เลือกหน่วยสินค้า"
  >
    <div class="purchase-unit-body">
      <div class="purchase-unit-hero">
        <div class="purchase-unit-image">
          <img
            v-if="selectedProduct"
            :src="productImageUrl(selectedProduct.item_code || selectedProduct.code)"
            :alt="selectedProduct.item_name || selectedProduct.name_1"
            @error="onImgError"
          />
          <i class="pi pi-box purchase-image-placeholder" style="display:none" />
        </div>
        <div class="purchase-unit-title">
          <strong>{{ selectedProduct?.item_name || selectedProduct?.name_1 || '-' }}</strong>
          <span>{{ selectedProduct?.item_code || selectedProduct?.code || '-' }}</span>
        </div>
      </div>

      <div v-if="detailLoading" class="purchase-unit-loading">
        <Skeleton height="3.5rem" />
        <Skeleton height="3.5rem" />
        <Skeleton height="3.5rem" />
      </div>
      <div v-else class="purchase-unit-list">
        <button
          v-for="unit in unitOptions"
          :key="productKey(unit)"
          type="button"
          class="purchase-unit-row"
          :class="{ active: productKey(unit) === selectedUnitKey }"
          @click="selectedUnitKey = productKey(unit)"
        >
          <span>
            <strong>{{ unit.unit_code || '-' }}</strong>
            <small v-if="unit.barcode">{{ unit.barcode }}</small>
          </span>
          <span>
            <b>{{ formatCurrency(unitPrice(unit)) }}</b>
            <small v-if="unit.last_purchase_doc_no">PU ล่าสุด {{ unit.last_purchase_doc_no }}</small>
            <small v-else>ยังไม่มีราคา PU ล่าสุด</small>
          </span>
          <i :class="productKey(unit) === selectedUnitKey ? 'pi pi-check-circle' : 'pi pi-circle'" />
        </button>
      </div>

      <div class="purchase-unit-qty-row">
        <span>จำนวน</span>
        <div class="purchase-unit-qty-control">
          <Button icon="pi pi-minus" rounded outlined severity="secondary" @click="detailQty = Math.max(0, Number(detailQty || 0) - 1)" />
          <InputNumber v-model="detailQty" :min="0" :max-fraction-digits="2" input-class="purchase-unit-qty" />
          <Button icon="pi pi-plus" rounded outlined severity="secondary" @click="detailQty = Number(detailQty || 0) + 1" />
        </div>
      </div>
    </div>

    <template #footer>
      <div class="purchase-unit-footer">
        <div>
          <span>รวม</span>
          <strong>{{ formatCurrency(selectedLineTotal) }}</strong>
        </div>
        <Button label="ยกเลิก" severity="secondary" outlined @click="detailVisible = false" />
        <Button label="ใส่ตะกร้า" icon="pi pi-shopping-cart" :disabled="!selectedUnit || detailQty <= 0" @click="addSelectedUnitToCart" />
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
.purchase-basket-shell {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  height: 100dvh;
  background: var(--p-surface-ground);
  color: var(--p-text-color);
}

.purchase-basket-header {
  display: grid;
  gap: 0.75rem;
  border-bottom: 1px solid var(--p-surface-border);
  background: var(--p-surface-0);
  padding: calc(0.75rem + env(safe-area-inset-top)) 1rem 0.75rem;
}

.basket-title-block,
.basket-search-row,
.purchase-cart-head,
.purchase-basket-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.basket-title-block h2 {
  margin: 0;
  font-size: 1.25rem;
  line-height: 1.2;
}

.basket-title-block span,
.purchase-basket-footer span {
  color: var(--p-text-color-secondary);
  font-size: 0.84rem;
}

.basket-search-wrap {
  position: relative;
  flex: 1;
}

.basket-search-wrap i {
  position: absolute;
  z-index: 1;
  top: 50%;
  left: 0.8rem;
  color: var(--p-text-color-secondary);
  transform: translateY(-50%);
}

.basket-search-wrap :deep(.p-inputtext) {
  width: 100%;
  padding-left: 2.25rem;
}

.purchase-category-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border: 1px solid var(--p-surface-border);
  border-radius: 999px;
  background: var(--p-surface-0);
  color: var(--p-text-color-secondary);
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  min-height: 42px;
  padding: 0 0.9rem;
  white-space: nowrap;
}

.purchase-category-tab.active {
  border-color: var(--p-primary-color);
  background: color-mix(in srgb, var(--p-primary-color) 12%, var(--p-surface-0));
  color: var(--p-primary-color);
}

.purchase-category-strip {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  border-bottom: 1px solid var(--p-surface-border);
  background: var(--p-surface-0);
  padding: 0.45rem 0.55rem;
}

.purchase-category-tabs {
  display: flex;
  gap: 0.5rem;
  min-width: 0;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  padding: 0.2rem 0.35rem;
  scrollbar-width: none;
}

.purchase-category-tabs::-webkit-scrollbar {
  display: none;
}

.purchase-basket-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 34%);
  min-height: 0;
}

.purchase-product-area,
.purchase-cart-panel {
  min-height: 0;
  overflow: auto;
}

.purchase-product-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
  padding: 1rem;
}

.purchase-product-card {
  display: flex;
  min-height: 190px;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--p-surface-border);
  border-radius: 10px;
  background: var(--p-surface-0);
  color: var(--p-text-color);
  cursor: pointer;
  padding: 0;
  text-align: left;
}

.purchase-product-card:active {
  transform: scale(0.99);
}

.purchase-product-image {
  position: relative;
  display: flex;
  height: 7.5rem;
  align-items: center;
  justify-content: center;
  background: var(--p-surface-50);
}

.purchase-product-image img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 0.45rem;
}

.purchase-image-placeholder {
  color: var(--p-surface-400);
  font-size: 2.3rem;
}

.purchase-qty-badge {
  position: absolute;
  right: 0.5rem;
  top: 0.5rem;
  display: inline-flex;
  min-width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--p-primary-color);
  color: var(--p-primary-contrast-color);
  font-weight: 800;
}

.purchase-product-info {
  display: grid;
  gap: 0.35rem;
  padding: 0.65rem;
}

.purchase-product-info strong {
  display: -webkit-box;
  overflow: hidden;
  min-height: 2.6em;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font-size: 0.9rem;
  line-height: 1.3;
}

.purchase-product-info span,
.purchase-product-info small,
.purchase-cart-text span {
  color: var(--p-text-color-secondary);
}

.purchase-product-info div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.purchase-product-info b {
  color: var(--p-primary-color);
}

.purchase-price-source {
  color: var(--p-text-color-secondary);
  font-size: 0.72rem;
}

.purchase-cart-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  border-left: 1px solid var(--p-surface-border);
  background: var(--p-surface-0);
  padding: 1rem;
}

.purchase-cart-empty,
.purchase-empty-products {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 0.5rem;
  min-height: 220px;
  color: var(--p-text-color-secondary);
  text-align: center;
}

.purchase-cart-empty i,
.purchase-empty-products i {
  font-size: 2rem;
  opacity: 0.45;
}

.purchase-cart-list {
  display: grid;
  align-content: start;
  gap: 0.6rem;
  overflow: auto;
  padding-top: 0.75rem;
}

.purchase-cart-row {
  display: grid;
  gap: 0.55rem;
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
  background: var(--p-surface-50);
  padding: 0.65rem;
}

.purchase-cart-text {
  display: grid;
  gap: 0.15rem;
}

.purchase-cart-text strong {
  font-size: 0.88rem;
  line-height: 1.25;
}

.purchase-cart-controls {
  display: grid;
  grid-template-columns: auto minmax(74px, 1fr) auto auto;
  gap: 0.35rem;
  align-items: center;
}

:deep(.purchase-cart-qty) {
  width: 100%;
  text-align: center;
}

.purchase-basket-footer {
  border-top: 1px solid var(--p-surface-border);
  background: var(--p-surface-0);
  padding: 0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom));
}

.purchase-basket-footer div {
  display: grid;
  gap: 0.12rem;
}

.purchase-basket-footer strong {
  font-size: 1.05rem;
}

.purchase-unit-body {
  display: grid;
  gap: 1rem;
}

.purchase-unit-hero {
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr);
  gap: 0.85rem;
  align-items: center;
}

.purchase-unit-image {
  display: flex;
  aspect-ratio: 1;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--p-surface-border);
  border-radius: 10px;
  background: var(--p-surface-50);
}

.purchase-unit-image img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 0.5rem;
}

.purchase-unit-title {
  display: grid;
  gap: 0.25rem;
  min-width: 0;
}

.purchase-unit-title strong {
  font-size: 1.05rem;
  line-height: 1.3;
}

.purchase-unit-title span,
.purchase-unit-row small,
.purchase-unit-qty-row span,
.purchase-unit-footer span {
  color: var(--p-text-color-secondary);
}

.purchase-unit-loading,
.purchase-unit-list {
  display: grid;
  gap: 0.55rem;
}

.purchase-unit-list {
  max-height: min(42dvh, 360px);
  overflow: auto;
}

.purchase-unit-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 0.8rem;
  align-items: center;
  border: 1px solid var(--p-surface-border);
  border-radius: 10px;
  background: var(--p-surface-0);
  color: var(--p-text-color);
  cursor: pointer;
  padding: 0.75rem;
  text-align: left;
}

.purchase-unit-row.active {
  border-color: var(--p-primary-color);
  background: color-mix(in srgb, var(--p-primary-color) 8%, var(--p-surface-0));
}

.purchase-unit-row > span {
  display: grid;
  gap: 0.18rem;
  min-width: 0;
}

.purchase-unit-row b {
  color: var(--p-primary-color);
}

.purchase-unit-row i {
  color: var(--p-primary-color);
  font-size: 1.2rem;
}

.purchase-unit-qty-row {
  display: grid;
  grid-template-columns: auto minmax(220px, 280px);
  gap: 0.75rem;
  align-items: center;
  justify-content: end;
}

.purchase-unit-qty-control {
  display: grid;
  grid-template-columns: auto minmax(90px, 1fr) auto;
  gap: 0.45rem;
  align-items: center;
}

:deep(.purchase-unit-qty) {
  width: 100%;
  text-align: center;
}

.purchase-unit-footer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 0.65rem;
  align-items: center;
  width: 100%;
}

.purchase-unit-footer > div {
  display: grid;
  gap: 0.12rem;
}

@media (orientation: portrait) and (max-width: 900px) {
  .purchase-basket-body {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1fr) minmax(180px, 30dvh);
  }

  .purchase-product-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .purchase-cart-panel {
    border-top: 1px solid var(--p-surface-border);
    border-left: none;
  }
}

@media (max-width: 640px) {
  .purchase-product-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .basket-search-row {
    align-items: stretch;
    flex-direction: column;
  }

  .purchase-basket-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .purchase-unit-hero {
    grid-template-columns: 96px minmax(0, 1fr);
  }

  .purchase-unit-row,
  .purchase-unit-footer,
  .purchase-unit-qty-row {
    grid-template-columns: 1fr;
  }

  .purchase-unit-qty-control {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }
}
</style>
