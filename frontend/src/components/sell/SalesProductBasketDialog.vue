<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'
import Skeleton from 'primevue/skeleton'
import { getCategoryList, getProductDetail, getProductList, getProductPrice } from '@/services/sellService'
import { formatCurrency } from '@/utils/formatters'
import { productImageUrl } from '@/utils/imageUrls'

const props = defineProps({
  visible: { type: Boolean, default: false },
  custCode: { type: String, default: '' },
  priceOpts: { type: Object, default: () => ({}) },
})

const emit = defineEmits(['update:visible', 'confirm'])
const { t, locale } = useI18n()

function tl(th, en, lo = en) {
  const lang = String(locale.value || 'th').toLowerCase()
  if (lang.startsWith('en')) return en
  if (lang.startsWith('lo')) return lo
  return th
}

const search = ref('')
const activeCategory = ref('')
const stockError = ref('')
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
  { code: '', name: tl('ทั้งหมด', 'All', 'ທັງໝົດ'), icon: 'pi pi-th-large' },
  { code: 'promo', name: t('sell.promotion'), icon: 'pi pi-tag' },
  ...categories.value.map((cat) => ({ code: cat.code, name: cat.name, icon: 'pi pi-folder' })),
])

const cartCount = computed(() => cartItems.value.reduce((sum, item) => sum + Number(item.qty || 0), 0))
const cartTotal = computed(() => cartItems.value.reduce((sum, item) => sum + (Number(item.qty || 0) * unitPrice(item.product)), 0))
const selectedUnit = computed(() =>
  unitOptions.value.find((unit) => productKey(unit) === selectedUnitKey.value) || unitOptions.value[0] || null
)
const selectedLineTotal = computed(() => Number(detailQty.value || 0) * unitPrice(selectedUnit.value || {}))

function itemCode(product) {
  return product?.item_code || product?.code || product?.ic_code || selectedProduct.value?.item_code || selectedProduct.value?.code || ''
}

function unitCode(product) {
  return product?.unit_code || product?.start_sale_unit || product?.unit_standard || product?.unit_cost || ''
}

function unitPrice(product) {
  return Number(product?.price ?? product?.price_0 ?? product?.sale_price ?? 0)
}

function unitRatio(unit) {
  return Math.max(1, Number(unit?.ratio) || (Number(unit?.stand_value) / Number(unit?.divide_value || 1)) || 1)
}

function stockBalanceByUnit(unit) {
  const directBalance = Number(unit?.balance_qty)
  if (Number.isFinite(directBalance)) return directBalance
  const baseBalance = Number(unit?.sum_balance_qty)
  if (!Number.isFinite(baseBalance)) return null
  return baseBalance / unitRatio(unit)
}

function formatStockQty(value) {
  const qty = Number(value)
  if (!Number.isFinite(qty)) return '-'
  return qty.toLocaleString('th-TH', { maximumFractionDigits: 2 })
}

function productKey(product) {
  return `${itemCode(product)}::${unitCode(product)}::${product?.barcode || ''}`
}

function productQty(product) {
  const code = itemCode(product)
  const unit = unitCode(product)
  return cartItems.value
    .filter((item) => itemCode(item.product) === code && unitCode(item.product) === unit)
    .reduce((sum, item) => sum + Number(item.qty || 0), 0)
}

function normalizedPriceOpts(extra = {}) {
  return {
    ...props.priceOpts,
    ...extra,
  }
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
    item_code: itemCode(product),
    item_name: product.item_name || product.name_1 || selectedProduct.value?.item_name || selectedProduct.value?.name_1 || '',
    unit_code: unitCode(product),
    price: unitPrice(product),
    defaultDiscount: product.defaultDiscount ?? product.default_discount ?? '',
    price_type: product.type ?? product.price_type ?? 1,
    price_info: product.mode ?? product.price_info ?? '',
    price_default: unitPrice(product),
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

async function priceProduct(product, qty = 1) {
  const code = itemCode(product)
  const unit = unitCode(product)
  if (!code || !unit) return normalizeProductUnit(product)
  try {
    const price = await getProductPrice(code, unit, props.custCode, String(qty || 1), normalizedPriceOpts({ barcode: product.barcode || '' }))
    return normalizeProductUnit({
      ...product,
      price: Number(price?.price ?? product.price ?? 0),
      defaultDiscount: price?.defaultDiscount ?? product.defaultDiscount ?? '',
      type: price?.type ?? product.type ?? product.price_type,
      mode: price?.mode ?? product.mode ?? product.price_info,
      price_default: Number(price?.price ?? product.price ?? 0),
    })
  } catch {
    return normalizeProductUnit(product)
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
      isstock: '1',
      offset: 0,
      limit: 60,
    })
    if (runId === loadRunId) products.value = rows.map((row) => normalizeProductUnit(row))
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
  const normalized = normalizeProductUnit(product)
  const key = productKey(normalized)
  const addQty = Number(qty || 0)
  if (!key || addQty <= 0) return
  const existing = cartItems.value.find((item) => item.key === key)
  if (existing) {
    existing.qty = Number(existing.qty || 0) + addQty
    return
  }
  cartItems.value.push({
    key,
    product: normalized,
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
    const code = itemCode(product)
    const rows = code ? await getProductDetail(code, props.custCode, props.priceOpts) : []
    const normalizedRows = rows.length
      ? rows.map((row) => normalizeProductUnit(row))
      : [normalizeProductUnit(product)]
    unitOptions.value = normalizedRows
    const defaultUnitCode = unitCode(product)
    const defaultUnit = unitOptions.value.find((unit) => unitCode(unit) === defaultUnitCode)
    selectedUnitKey.value = productKey(defaultUnit || unitOptions.value[0] || product)
  } catch {
    unitOptions.value = [normalizeProductUnit(product)]
    selectedUnitKey.value = productKey(unitOptions.value[0])
  } finally {
    detailLoading.value = false
  }
}

async function addSelectedUnitToCart() {
  if (!selectedUnit.value || detailQty.value <= 0) return
  const priced = await priceProduct(selectedUnit.value, detailQty.value)
  addProduct(priced, detailQty.value)
  detailVisible.value = false
}

function parseQtyInput(qty) {
  return Number(String(qty ?? '').trim().replace(',', '.'))
}

function setQty(item, qty) {
  const nextQty = parseQtyInput(qty)
  if (!Number.isFinite(nextQty)) return
  if (nextQty <= 0) {
    removeItem(item)
    return
  }
  item.qty = nextQty
}

function setDetailQty(qty) {
  const nextQty = parseQtyInput(qty)
  if (!Number.isFinite(nextQty) || nextQty < 0) return
  detailQty.value = nextQty
}

function removeItem(item) {
  cartItems.value = cartItems.value.filter((row) => row.key !== item.key)
}

function confirmCart() {
  if (!cartItems.value.length) return
  stockError.value = ''
  for (const item of cartItems.value) {
    const balance = stockBalanceByUnit(item.product)
    if (balance === null) continue
    if (Number(item.qty || 0) > balance) {
      const name = item.product.item_name || item.product.name_1 || item.product.item_code || ''
      stockError.value = tl(
        `${name} คงเหลือ ${formatStockQty(balance)} ${item.product.unit_code || ''}`,
        `${name} remaining ${formatStockQty(balance)} ${item.product.unit_code || ''}`,
        `${name} ຄົງເຫຼືອ ${formatStockQty(balance)} ${item.product.unit_code || ''}`,
      )
      return
    }
  }
  emit('confirm', cartItems.value.map((item) => ({
    product: item.product,
    qty: Number(item.qty || 0),
  })))
  clearCart()
  close()
}

watch(cartItems, () => { stockError.value = '' }, { deep: true })

watch(() => props.visible, async (visible) => {
  if (!visible) return
  if (!categories.value.length) await loadCategories()
  await loadProducts()
})

watch(() => [props.custCode, props.priceOpts?.sale_type, props.priceOpts?.vat_type, props.priceOpts?.vat_rate], () => {
  if (props.visible) loadProducts()
})

onBeforeUnmount(() => clearTimeout(searchTimer))
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    class="sales-basket-dialog"
    :closable="false"
    :draggable="false"
    :style="{ width: '100vw', height: '100dvh', maxHeight: '100dvh' }"
    content-class="sales-basket-content"
    @update:visible="emit('update:visible', $event)"
  >
    <template #container>
      <div class="sales-basket-shell">
        <header class="sales-basket-header">
          <div class="sales-basket-title-block">
            <Button icon="pi pi-times" rounded text severity="secondary" :aria-label="t('sell.close')" @click="close" />
            <div>
              <h2>{{ t('sell.cart') }}</h2>
              <span>{{ cartCount }} {{ t('sell.items') }} · {{ formatCurrency(cartTotal) }}</span>
            </div>
          </div>
          <div class="sales-basket-search-row">
            <span class="sales-basket-search-wrap">
              <i class="pi pi-search" />
              <InputText v-model.trim="search" :placeholder="tl('ค้นหารหัส / ชื่อ / บาร์โค้ด', 'Search code / name / barcode', 'ຄົ້ນຫາລະຫັດ / ຊື່ / ບາໂຄດ')" @input="scheduleSearch" @keyup.enter="loadProducts" />
            </span>
          </div>
        </header>

        <div class="sales-category-strip">
          <Button icon="pi pi-chevron-left" rounded text severity="secondary" :aria-label="tl('เลื่อนหมวดหมู่ซ้าย', 'Scroll categories left', 'ເລື່ອນໝວດໄປຊ້າຍ')" @click="scrollCategoryTabs(-1)" />
          <nav ref="categoryTabsRef" class="sales-category-tabs">
            <button
              v-for="cat in categoryTabs"
              :key="cat.code || 'all'"
              type="button"
              class="sales-category-tab"
              :class="{ active: activeCategory === cat.code }"
              @click="selectCategory(cat.code)"
            >
              <i :class="cat.icon" />
              <span>{{ cat.name }}</span>
            </button>
          </nav>
          <Button icon="pi pi-chevron-right" rounded text severity="secondary" :aria-label="tl('เลื่อนหมวดหมู่ขวา', 'Scroll categories right', 'ເລື່ອນໝວດໄປຂວາ')" @click="scrollCategoryTabs(1)" />
        </div>

        <main class="sales-basket-body">
          <section class="sales-product-area">
            <div class="sales-product-grid">
              <button
                v-for="product in products"
                :key="productKey(product)"
                type="button"
                class="sales-product-card"
                @click="openProductDetail(product)"
              >
                <div class="sales-product-image">
                  <img :src="productImageUrl(product.item_code)" :alt="product.item_name || product.name_1" @error="onImgError" />
                  <i class="pi pi-box sales-image-placeholder" style="display:none" />
                  <span v-if="productQty(product)" class="sales-qty-badge">{{ productQty(product) }}</span>
                </div>
                <div class="sales-product-info">
                  <strong>{{ product.item_name || product.name_1 }}</strong>
                  <span>{{ product.item_code || product.code }}</span>
                  <small>{{ unitCode(product) || '-' }}</small>
                </div>
              </button>

              <template v-if="loading && !products.length">
                <div v-for="n in 12" :key="`sales-basket-sk-${n}`" class="sales-product-card skeleton-card">
                  <Skeleton height="7rem" />
                  <div class="sales-product-info">
                    <Skeleton width="85%" height="1rem" />
                    <Skeleton width="50%" height="0.75rem" />
                  </div>
                </div>
              </template>
            </div>
            <div v-if="!loading && !products.length" class="sales-empty-products">
              <i class="pi pi-search" />
              <span>{{ t('product.notFound') }}</span>
            </div>
          </section>

          <aside class="sales-cart-panel">
            <div class="sales-cart-head">
              <strong>{{ tl('รายการในตะกร้า', 'Items in basket', 'ລາຍການໃນກະຕ່າ') }}</strong>
              <Button v-if="cartItems.length" :label="t('sell.clear')" text severity="danger" size="small" @click="clearCart" />
            </div>
            <div v-if="!cartItems.length" class="sales-cart-empty">
              <i class="pi pi-shopping-cart" />
              <span>{{ tl('แตะสินค้าเพื่อเลือกหน่วยและเพิ่มเข้าตะกร้า', 'Tap a product to choose unit and add to basket', 'ແຕະສິນຄ້າເພື່ອເລືອກໜ່ວຍແລະເພີ່ມໃສ່ກະຕ່າ') }}</span>
            </div>
            <div v-else class="sales-cart-list">
              <div v-for="item in cartItems" :key="item.key" class="sales-cart-row">
                <div class="sales-cart-text">
                  <strong>{{ item.product.item_name || item.product.name_1 }}</strong>
                  <span>{{ item.product.item_code }} · {{ item.product.unit_code || '-' }}</span>
                  <small>{{ formatCurrency(unitPrice(item.product)) }}</small>
                </div>
                <div class="sales-cart-controls">
                  <Button icon="pi pi-minus" rounded outlined size="small" severity="secondary" @click="setQty(item, Number(item.qty) - 1)" />
                  <InputText :model-value="item.qty" class="sales-cart-qty" inputmode="decimal" @change="event => setQty(item, event.target.value)" @keyup.enter="event => setQty(item, event.target.value)" />
                  <Button icon="pi pi-plus" rounded outlined size="small" severity="secondary" @click="setQty(item, Number(item.qty) + 1)" />
                  <Button icon="pi pi-trash" rounded text size="small" severity="danger" @click="removeItem(item)" />
                </div>
              </div>
            </div>
          </aside>
        </main>

        <footer class="sales-basket-footer">
          <Message v-if="stockError" severity="error" :closable="false" class="stock-error-msg">{{ stockError }}</Message>
          <div class="sales-basket-footer-row">
            <div>
              <span>{{ tl('รวม', 'Total', 'ລວມ') }}</span>
              <strong>{{ cartCount }} {{ t('sell.items') }} · {{ formatCurrency(cartTotal) }}</strong>
            </div>
            <Button :label="tl('เพิ่มเข้าเอกสารขาย', 'Add to sale document', 'ເພີ່ມເຂົ້າເອກະສານຂາຍ')" icon="pi pi-check" :disabled="!cartItems.length" @click="confirmCart" />
          </div>
        </footer>
      </div>
    </template>
  </Dialog>

  <Dialog
    v-model:visible="detailVisible"
    modal
    :draggable="false"
    class="sales-unit-dialog"
    :style="{ width: 'min(760px, 96vw)' }"
    :header="tl('เลือกหน่วยสินค้า', 'Select product unit', 'ເລືອກໜ່ວຍສິນຄ້າ')"
  >
    <div class="sales-unit-body">
      <div class="sales-unit-hero">
        <div class="sales-unit-image">
          <img
            v-if="selectedProduct"
            :src="productImageUrl(selectedProduct.item_code || selectedProduct.code)"
            :alt="selectedProduct.item_name || selectedProduct.name_1"
            @error="onImgError"
          />
          <i class="pi pi-box sales-image-placeholder" style="display:none" />
        </div>
        <div class="sales-unit-title">
          <strong>{{ selectedProduct?.item_name || selectedProduct?.name_1 || '-' }}</strong>
          <span>{{ selectedProduct?.item_code || selectedProduct?.code || '-' }}</span>
        </div>
      </div>

      <div v-if="detailLoading" class="sales-unit-loading">
        <Skeleton height="3.5rem" />
        <Skeleton height="3.5rem" />
        <Skeleton height="3.5rem" />
      </div>
      <div v-else class="sales-unit-list">
        <button
          v-for="unit in unitOptions"
          :key="productKey(unit)"
          type="button"
          class="sales-unit-row"
          :class="{ active: productKey(unit) === selectedUnitKey }"
          @click="selectedUnitKey = productKey(unit)"
        >
          <span>
            <strong>{{ unit.unit_code || '-' }}</strong>
            <small v-if="unit.barcode">{{ unit.barcode }}</small>
            <small>{{ t('sell.remaining') }} {{ formatStockQty(stockBalanceByUnit(unit)) }} {{ unit.unit_code || '' }}</small>
          </span>
          <span>
            <b>{{ formatCurrency(unitPrice(unit)) }}</b>
            <small v-if="unit.defaultDiscount">{{ tl('ส่วนลด', 'Discount', 'ສ່ວນຫຼຸດ') }} {{ unit.defaultDiscount }}</small>
            <small v-else>{{ tl('ราคาขาย', 'Sale price', 'ລາຄາຂາຍ') }}</small>
          </span>
          <i :class="productKey(unit) === selectedUnitKey ? 'pi pi-check-circle' : 'pi pi-circle'" />
        </button>
      </div>

      <div class="sales-unit-qty-row">
        <span>{{ tl('จำนวน', 'Qty', 'ຈຳນວນ') }}</span>
        <div class="sales-unit-qty-control">
          <Button icon="pi pi-minus" rounded outlined severity="secondary" @click="detailQty = Math.max(0, Number(detailQty || 0) - 1)" />
          <InputText :model-value="detailQty" class="sales-unit-qty" inputmode="decimal" @change="event => setDetailQty(event.target.value)" @keyup.enter="event => setDetailQty(event.target.value)" />
          <Button icon="pi pi-plus" rounded outlined severity="secondary" @click="detailQty = Number(detailQty || 0) + 1" />
        </div>
      </div>
    </div>

    <template #footer>
      <div class="sales-unit-footer">
        <div>
          <span>{{ tl('รวม', 'Total', 'ລວມ') }}</span>
          <strong>{{ formatCurrency(selectedLineTotal) }}</strong>
        </div>
        <Button :label="t('sell.cancel')" severity="secondary" outlined @click="detailVisible = false" />
        <Button :label="tl('ใส่ตะกร้า', 'Add to basket', 'ໃສ່ກະຕ່າ')" icon="pi pi-shopping-cart" :disabled="!selectedUnit || detailQty <= 0" @click="addSelectedUnitToCart" />
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
.sales-basket-shell {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  height: 100dvh;
  background: var(--p-surface-ground);
  color: var(--p-text-color);
}

.sales-basket-header {
  display: grid;
  gap: 0.75rem;
  border-bottom: 1px solid var(--p-surface-border);
  background: var(--p-surface-0);
  padding: calc(0.75rem + env(safe-area-inset-top)) 1rem 0.75rem;
}

.sales-basket-title-block,
.sales-basket-search-row,
.sales-cart-head,
.sales-basket-footer {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.sales-basket-footer-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.stock-error-msg {
  width: 100%;
}

.sales-basket-title-block h2 {
  margin: 0;
  font-size: 1.25rem;
  line-height: 1.2;
}

.sales-basket-title-block span,
.sales-basket-footer span {
  color: var(--p-text-color-secondary);
  font-size: 0.84rem;
}

.sales-basket-search-wrap {
  position: relative;
  flex: 1;
}

.sales-basket-search-wrap i {
  position: absolute;
  z-index: 1;
  top: 50%;
  left: 0.8rem;
  color: var(--p-text-color-secondary);
  transform: translateY(-50%);
}

.sales-basket-search-wrap :deep(.p-inputtext) {
  width: 100%;
  padding-left: 2.25rem;
}

.sales-category-strip {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  border-bottom: 1px solid var(--p-surface-border);
  background: var(--p-surface-0);
  padding: 0.45rem 0.55rem;
}

.sales-category-tabs {
  display: flex;
  gap: 0.5rem;
  min-width: 0;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  padding: 0.2rem 0.35rem;
  scrollbar-width: none;
}

.sales-category-tabs::-webkit-scrollbar {
  display: none;
}

.sales-category-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 42px;
  border: 1px solid var(--p-surface-border);
  border-radius: 999px;
  background: var(--p-surface-0);
  color: var(--p-text-color-secondary);
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  padding: 0 0.9rem;
  white-space: nowrap;
}

.sales-category-tab.active {
  border-color: var(--p-primary-color);
  background: color-mix(in srgb, var(--p-primary-color) 12%, var(--p-surface-0));
  color: var(--p-primary-color);
}

.sales-basket-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 34%);
  min-height: 0;
}

.sales-product-area,
.sales-cart-panel {
  min-height: 0;
  overflow: auto;
}

.sales-product-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
  padding: 1rem;
}

.sales-product-card {
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

.sales-product-card:active {
  transform: scale(0.99);
}

.sales-product-image {
  position: relative;
  display: flex;
  height: 7.5rem;
  align-items: center;
  justify-content: center;
  background: var(--p-surface-50);
}

.sales-product-image img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 0.45rem;
}

.sales-image-placeholder {
  color: var(--p-surface-400);
  font-size: 2.3rem;
}

.sales-qty-badge {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
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

.sales-product-info {
  display: grid;
  gap: 0.35rem;
  padding: 0.65rem;
}

.sales-product-info strong {
  display: -webkit-box;
  overflow: hidden;
  min-height: 2.6em;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font-size: 0.9rem;
  line-height: 1.3;
}

.sales-product-info span,
.sales-product-info small,
.sales-cart-text span,
.sales-cart-text small {
  color: var(--p-text-color-secondary);
}

.sales-product-info b,
.sales-unit-row b {
  color: var(--p-primary-color);
}

.sales-cart-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  border-left: 1px solid var(--p-surface-border);
  background: var(--p-surface-0);
}

.sales-cart-head {
  border-bottom: 1px solid var(--p-surface-border);
  padding: 0.85rem 1rem;
}

.sales-cart-empty,
.sales-empty-products {
  display: flex;
  height: 100%;
  min-height: 180px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  color: var(--p-text-color-secondary);
  text-align: center;
}

.sales-cart-list {
  display: grid;
  align-content: start;
  gap: 0.5rem;
  padding: 0.75rem;
}

.sales-cart-row {
  display: grid;
  gap: 0.55rem;
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
  padding: 0.65rem;
}

.sales-cart-text {
  display: grid;
  gap: 0.15rem;
}

.sales-cart-controls {
  display: grid;
  grid-template-columns: 2rem minmax(0, 1fr) 2rem 2rem;
  gap: 0.35rem;
  align-items: center;
}

.sales-cart-controls :deep(.p-button) {
  width: 2rem;
  height: 2rem;
}

.sales-cart-controls :deep(.p-inputnumber),
.sales-unit-qty-control :deep(.p-inputnumber) {
  width: 100%;
  min-width: 0;
}

:deep(.sales-cart-qty),
:deep(.sales-unit-qty) {
  width: 100%;
  min-width: 0;
  text-align: center;
}

.sales-basket-footer {
  border-top: 1px solid var(--p-surface-border);
  background: var(--p-surface-0);
  padding: 0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom));
}

.sales-basket-footer div {
  display: grid;
  gap: 0.1rem;
}

.sales-unit-body {
  display: grid;
  gap: 1rem;
  overflow-x: hidden;
}

.sales-unit-hero {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 0.75rem;
  align-items: center;
}

.sales-unit-image {
  display: flex;
  width: 96px;
  height: 96px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
  background: var(--p-surface-50);
}

.sales-unit-image img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 0.4rem;
}

.sales-unit-title {
  display: grid;
  min-width: 0;
  gap: 0.2rem;
}

.sales-unit-title span {
  color: var(--p-text-color-secondary);
}

.sales-unit-loading,
.sales-unit-list {
  display: grid;
  gap: 0.5rem;
}

.sales-unit-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 0.75rem;
  align-items: center;
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
  background: var(--p-surface-0);
  color: var(--p-text-color);
  cursor: pointer;
  font: inherit;
  padding: 0.65rem;
  text-align: left;
}

.sales-unit-row.active {
  border-color: var(--p-primary-color);
  background: color-mix(in srgb, var(--p-primary-color) 9%, var(--p-surface-0));
}

.sales-unit-row span {
  display: grid;
  gap: 0.1rem;
}

.sales-unit-row small {
  color: var(--p-text-color-secondary);
}

.sales-unit-qty-row,
.sales-unit-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.sales-unit-qty-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 240px);
}

.sales-unit-qty-control {
  display: grid;
  width: 100%;
  min-width: 0;
  grid-template-columns: 2.5rem minmax(0, 1fr) 2.5rem;
  gap: 0.4rem;
  align-items: center;
}

.sales-unit-qty-control :deep(.p-button) {
  width: 2.5rem;
  height: 2.5rem;
}

.sales-unit-footer {
  width: 100%;
}

.sales-unit-footer > div {
  display: grid;
  margin-right: auto;
}

.sales-unit-footer span {
  color: var(--p-text-color-secondary);
  font-size: 0.78rem;
}

@media (max-width: 980px) {
  .sales-basket-body {
    grid-template-columns: 1fr;
  }

  .sales-cart-panel {
    min-height: 280px;
    border-left: 0;
    border-top: 1px solid var(--p-surface-border);
  }

  .sales-product-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .sales-product-grid {
    grid-template-columns: 1fr;
  }

  .sales-unit-hero,
  .sales-unit-row {
    grid-template-columns: 1fr;
  }

  .sales-unit-footer {
    flex-wrap: wrap;
  }

  .sales-unit-qty-row {
    grid-template-columns: 1fr;
  }
}
</style>
