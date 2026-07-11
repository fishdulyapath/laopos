<script setup>
import { ref, computed, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputNumber from 'primevue/inputnumber'
import Skeleton from 'primevue/skeleton'
import { useToast } from 'primevue/usetoast'
import {
  getProductDetail,
  getProductImageGuidUrl,
  getProductImageList,
  getProductImageUrl,
  getProductPrice,
} from '@/services/sellService'
import { getItemReservedQty } from '@/services/basketService'
import { formatCurrency } from '@/utils/formatters'
import { runtimeApiBaseUrl } from '@/config/runtime'
import { useCartStore } from '@/stores/cart'
import { useAuthStore } from '@/stores/auth'
import { usePosStore } from '@/stores/pos'

const props = defineProps({
  product: { type: Object, required: true },
  basket: { type: Object, required: true },
  visible: { type: Boolean, default: false },
})
const emit = defineEmits(['update:visible'])

const toast = useToast()
const cartStore = useCartStore()
const authStore = useAuthStore()
const posStore = usePosStore()

const cartKey = computed(() => `BASKET-${props.basket.basket_id}`)
const custCode = computed(() => props.basket.cust_code || '')
const priceOpts = computed(() => ({
  sale_type: props.basket.inquiry_type,
  vat_type: props.basket.vat_type,
  vat_rate: props.basket.vat_rate,
}))


// ─── detail state ────────────────────────────────────────────────────
const loading = ref(false)
const units = ref([])
const selectedUnit = ref(null)
const price = ref(null)
const priceLoading = ref(false)
const qty = ref(1)
const adding = ref(false)
const reservedBaseUnits = ref(0)
const reservedLoading = ref(false)
const productImages = ref([])
const activeImageIndex = ref(0)
const debugImagesEnabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug_images')
const imageDebugLogs = ref([])

const activeImage = computed(() => productImages.value[activeImageIndex.value] ?? null)
const isServiceItem = computed(() =>
  String(selectedUnit.value?.item_type ?? props.product.item_type ?? '') === '1'
)
const stockControlEnabled = computed(() => {
  const value = posStore.erpOption?.ic_stock_control
  if (value === undefined || value === null || value === '') return false
  return ['1', 'true', 't', 'yes', 'y'].includes(String(value).toLowerCase())
})
const qtyMax = computed(() => (isServiceItem.value || !stockControlEnabled.value) ? undefined : effectiveBalance.value)

// ─── balance calculation (cross-basket aware) ────────────────────────
const effectiveBalance = computed(() => {
  if (!selectedUnit.value) return 0
  if (isServiceItem.value) return 0
  const safeRatio = Math.max(1, Number(selectedUnit.value.ratio) || 1)
  const baseBalance = Number(selectedUnit.value.sum_balance_qty ?? (Number(selectedUnit.value.balance_qty ?? 0) * safeRatio))
  const base = baseBalance - reservedBaseUnits.value
  return Math.max(0, Math.floor(base / safeRatio))
})

const canOrder = computed(() =>
  !loading.value && !reservedLoading.value &&
  selectedUnit.value !== null && price.value !== null &&
  (isServiceItem.value || !stockControlEnabled.value || effectiveBalance.value > 0) && qty.value > 0,
)

function isServiceUnit(unit) {
  return String(unit?.item_type ?? props.product.item_type ?? '') === '1'
}

function addImageDebug(message, detail = {}) {
  if (!debugImagesEnabled) return
  const time = new Date().toLocaleTimeString('th-TH', { hour12: false })
  imageDebugLogs.value = [
    {
      time,
      message,
      detail: JSON.stringify(detail, null, 2),
    },
    ...imageDebugLogs.value,
  ].slice(0, 80)
}

function clearImageDebugLogs() {
  imageDebugLogs.value = []
}

async function probeImageUrl(label, url) {
  if (!debugImagesEnabled || !url) return
  const startedAt = performance.now()
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { 'ngrok-skip-browser-warning': '1' },
    })
    const blob = await response.blob()
    addImageDebug(`probe ${label}`, {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      contentLength: response.headers.get('content-length') || '',
      cacheControl: response.headers.get('cache-control') || '',
      blobSize: blob.size,
      elapsedMs: Math.round(performance.now() - startedAt),
      url,
    })
  } catch (error) {
    addImageDebug(`probe ${label} failed`, {
      error: error?.message || String(error),
      url,
    })
  }
}

function probeProductImages(images) {
  if (!debugImagesEnabled) return
  images.forEach((image, index) => {
    void probeImageUrl(`image ${index + 1}`, image.src)
    if (image.fallbackSrc) void probeImageUrl(`fallback ${index + 1}`, image.fallbackSrc)
  })
}

// ─── load detail on open ─────────────────────────────────────────────
async function loadDetail() {
  loading.value = true
  reservedLoading.value = true
  units.value = []
  selectedUnit.value = null
  price.value = null
  qty.value = 1
  reservedBaseUnits.value = 0
  productImages.value = []
  activeImageIndex.value = 0
  clearImageDebugLogs()
  addImageDebug('open product detail', {
    itemCode: props.product.item_code,
    apiBase: runtimeApiBaseUrl(),
    userAgent: navigator.userAgent,
  })

  try {
    const shouldSkipReservedQty = String(props.product.item_type ?? '') === '1'
    const imageListRequest = getProductImageList(props.product.item_code).catch((error) => {
      addImageDebug('getImageList failed', {
        error: error?.message || String(error),
      })
      return []
    })
    const [unitData, reserved, imageList] = await Promise.all([
      getProductDetail(props.product.item_code, custCode.value, priceOpts.value),
      shouldSkipReservedQty ? Promise.resolve(0) : getItemReservedQty(props.product.item_code),
      imageListRequest,
    ])
    reservedBaseUnits.value = reserved
    units.value = unitData
    productImages.value = mapProductImages(props.product.item_code, imageList)
    addImageDebug('image list mapped', {
      sourceCount: Array.isArray(imageList) ? imageList.length : 0,
      source: imageList,
      mapped: productImages.value,
    })
    probeProductImages(productImages.value)
    if (units.value.length) await selectUnit(units.value[0])
  } catch {
    toast.add({ severity: 'error', summary: 'โหลดข้อมูลล้มเหลว', detail: props.product.item_name, life: 3000 })
  } finally {
    loading.value = false
    reservedLoading.value = false
  }
}

function mapProductImages(itemCode, imageList) {
  if (Array.isArray(imageList) && imageList.length > 0) {
    return imageList.map((image, index) => ({
      key: image.guid_code || `${itemCode}-${index}`,
      src: image.guid_code ? getProductImageGuidUrl(image.guid_code) : getProductImageUrl(itemCode),
      fallbackSrc: image.guid_code ? getProductImageUrl(itemCode) : '',
    }))
  }

  return [
    {
      key: `${itemCode}-default`,
      src: getProductImageUrl(itemCode),
      fallbackSrc: '',
    },
  ]
}

async function selectUnit(unit) {
  selectedUnit.value = unit
  qty.value = 1
  price.value = null
  priceLoading.value = true
  try {
    const result = await getProductPrice(unit.item_code, unit.unit_code, custCode.value, '1', priceOpts.value)
    price.value = result?.price ?? null
  } catch {
    price.value = null
  } finally {
    priceLoading.value = false
  }
}

watch(() => props.visible, async (v) => {
  if (v) await loadDetail()
}, { immediate: true })

// ─── add to cart ─────────────────────────────────────────────────────
async function addToCart() {
  if (adding.value) return
  if (stockControlEnabled.value && !isServiceItem.value && qty.value > effectiveBalance.value) {
    toast.add({
      severity: 'warn',
      summary: 'สต็อกไม่พอ',
      detail: `${selectedUnit.value.item_name} คงเหลือ ${effectiveBalance.value} ${selectedUnit.value.unit_code}`,
      life: 2500,
    })
    return
  }
  adding.value = true
  try {
    await cartStore.addItem({
      cart_key: cartKey.value,
      emp_code: authStore.employee?.user_code ?? '',
      item_code: selectedUnit.value.item_code,
      item_name: selectedUnit.value.item_name,
      unit_code: selectedUnit.value.unit_code,
      barcode: selectedUnit.value.barcode ?? '',
      qty: qty.value,
      price: price.value,
      item_type: String(selectedUnit.value.item_type ?? '0'),
      wh_code: selectedUnit.value.wh_code ?? '',
      shelf_code: selectedUnit.value.shelf_code ?? '',
      stand_value: Number(selectedUnit.value.stand_value) || 1,
      divide_value: Number(selectedUnit.value.divide_value) || 1,
      ratio: Number(selectedUnit.value.ratio) || 1,
    })
    toast.add({
      severity: 'success',
      summary: 'เพิ่มสินค้าแล้ว',
      detail: `${selectedUnit.value.item_name} × ${qty.value} ${selectedUnit.value.unit_code}`,
      life: 1500,
    })
    emit('update:visible', false)
  } catch {
    toast.add({ severity: 'error', summary: 'เกิดข้อผิดพลาด', detail: 'ไม่สามารถเพิ่มสินค้าได้', life: 3000 })
  } finally {
    adding.value = false
  }
}

function showImagePlaceholder(event) {
  const image = event.target
  const fallbackSrc = image.dataset.fallbackSrc
  addImageDebug('img error', {
    src: image.currentSrc || image.src,
    fallbackSrc,
    fallbackTried: image.dataset.fallbackTried || '0',
  })
  if (fallbackSrc && image.dataset.fallbackTried !== '1') {
    image.dataset.fallbackTried = '1'
    image.style.display = 'block'
    image.src = fallbackSrc
    addImageDebug('retry fallback image', { fallbackSrc })
    return
  }
  image.style.display = 'none'
  image.nextElementSibling?.style.setProperty('display', 'flex')
}

function resetImagePlaceholder(event) {
  const image = event.target
  addImageDebug('img loaded', {
    src: image.currentSrc || image.src,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
  })
  image.style.display = 'block'
  image.nextElementSibling?.style.setProperty('display', 'none')
}

</script>

<template>
  <Dialog
    :visible="visible"
    :modal="true"
    :draggable="false"
    :closable="true"
    :pt="{
      root: { class: 'detail-sheet' },
      header: { class: 'detail-dialog-header' },
      content: { class: 'detail-dialog-content' },
    }"
    @update:visible="emit('update:visible', $event)"
  >
    <template #header>
      <div class="sheet-header">
        <div class="sheet-title-wrap">
          <div class="sheet-item-name">{{ product.item_name }}</div>
          <div class="sheet-item-code">{{ product.item_code }}</div>
        </div>
      </div>
    </template>

    <div class="sheet-body">
      <template v-if="loading">
        <div class="sheet-layout sheet-layout-loading">
          <Skeleton height="22rem" />
          <div class="sheet-loading-side">
            <Skeleton height="2.5rem" class="mb-2" />
            <Skeleton height="1.5rem" width="60%" class="mb-2" />
            <Skeleton height="7rem" class="mb-2" />
            <Skeleton height="5rem" />
          </div>
        </div>
      </template>

      <template v-else>
        <div class="sheet-layout">
          <div class="sheet-gallery-card">
            <div class="sheet-gallery">
              <div class="sheet-preview" :key="activeImage?.key || product.item_code">
                <img
                  v-if="activeImage"
                  :src="activeImage.src"
                  :data-fallback-src="activeImage.fallbackSrc"
                  :alt="product.item_name"
                  class="sheet-preview-img"
                  @load="resetImagePlaceholder"
                  @error="showImagePlaceholder"
                />
                <div class="sheet-preview-placeholder"><i class="pi pi-box" /></div>
              </div>

              <div v-if="productImages.length > 1" class="sheet-thumbs">
                <button
                  v-for="(image, index) in productImages"
                  :key="image.key"
                  type="button"
                  class="sheet-thumb-btn"
                  :class="{ active: activeImageIndex === index }"
                  @click="activeImageIndex = index"
                >
                  <img
                    :src="image.src"
                    :data-fallback-src="image.fallbackSrc"
                    :alt="`${product.item_name} ${index + 1}`"
                    class="sheet-thumb-img"
                    @load="resetImagePlaceholder"
                    @error="showImagePlaceholder"
                  />
                  <div class="sheet-thumb-placeholder"><i class="pi pi-image" /></div>
                </button>
              </div>
            </div>
          </div>

          <div class="sheet-info-card">
            <!-- หน่วยนับ -->
            <div class="sheet-section">
              <div class="section-label">เลือกหน่วยนับ</div>
              <div class="unit-chips">
                <button
                  v-for="u in units"
                  :key="u.unit_code"
                  class="unit-chip"
                  :class="{ active: selectedUnit?.unit_code === u.unit_code }"
                  @click="selectUnit(u)"
                >
                  {{ u.unit_code }}
                  <span v-if="!isServiceUnit(u) && u.sold_out === '1'" class="chip-warn" title="ใกล้หมด">⚠</span>
                </button>
              </div>
            </div>

            <div class="sheet-summary-grid">
              <div class="summary-card price-block">
                <div class="section-label">ราคา</div>
                <div class="price-value">
                  <Skeleton v-if="priceLoading" width="5rem" height="1.5rem" />
                  <span v-else-if="price !== null" class="price-text">{{ formatCurrency(price) }}</span>
                  <span v-else class="price-na">-</span>
                </div>
              </div>

              <div v-if="!isServiceItem" class="summary-card stock-block">
                <div class="section-label">คงเหลือ</div>
                <div class="stock-value" :class="{ 'stock-zero': effectiveBalance <= 0 }">
                  {{ effectiveBalance.toLocaleString() }} {{ selectedUnit?.unit_code ?? '' }}
                </div>
                <div v-if="cartStore.qtyInCart(selectedUnit?.item_code, selectedUnit?.unit_code) > 0" class="in-cart-label">
                  ในตะกร้า: {{ cartStore.qtyInCart(selectedUnit?.item_code, selectedUnit?.unit_code) }} {{ selectedUnit?.unit_code }}
                </div>
              </div>
              <div v-else class="summary-card stock-block">
                <div class="section-label">ประเภท</div>
                <div class="stock-value">บริการ</div>
                <div class="in-cart-label">ไม่ตัดสต๊อก</div>
              </div>
            </div>

            <div
              v-if="selectedUnit?.promotion?.length"
              class="sheet-section promotion-section"
            >
              <div class="section-label">
                <i class="pi pi-tag promotion-icon" />
                รายละเอียดโปรโมชั่น
              </div>
              <div class="promotion-table">
                <div class="promotion-row promotion-head">
                  <span>ช่วงจำนวน</span>
                  <span>หน่วย</span>
                  <span class="promotion-price-cell">ราคา</span>
                </div>
                <div
                  v-for="p in selectedUnit.promotion"
                  :key="p.line_number"
                  class="promotion-row"
                >
                  <span>{{ Number(p.from_qty).toLocaleString() }} - {{ Number(p.to_qty).toLocaleString() }}</span>
                  <span>{{ p.unit_name }}</span>
                  <span class="promotion-price-cell">{{ formatCurrency(p.price) }}</span>
                </div>
              </div>
            </div>

            <div
              v-if="selectedUnit?.discount_promotion?.length"
              class="sheet-section discount-section"
            >
              <div class="section-label">
                <i class="pi pi-percentage promotion-icon" />
                ส่วนลดพิเศษ
              </div>
              <div class="promotion-table">
                <div class="promotion-row discount-head">
                  <span>ช่วงจำนวน</span>
                  <span class="promotion-price-cell">ส่วนลด</span>
                </div>
                <div
                  v-for="(d, idx) in selectedUnit.discount_promotion"
                  :key="`${d.discount_type}-${idx}`"
                  class="promotion-row discount-row-2col"
                >
                  <span>{{ Number(d.from_qty).toLocaleString() }} - {{ Number(d.to_qty).toLocaleString() }}</span>
                  <span class="promotion-price-cell discount-text">{{ d.discount }}</span>
                </div>
              </div>
            </div>

            <div v-if="stockControlEnabled && !isServiceItem && effectiveBalance <= 0 && selectedUnit" class="out-of-stock-banner">
              <i class="pi pi-exclamation-triangle" />
              ยอดคงเหลือหมด (ไม่สามารถสั่งซื้อได้)
            </div>

            <div v-if="isServiceItem || effectiveBalance > 0" class="sheet-section qty-section">
              <div class="section-label">จำนวน</div>
              <InputNumber
                v-model="qty"
                :min="1"
                :max="qtyMax"
                show-buttons
                button-layout="horizontal"
                :input-style="{ width: '5rem', textAlign: 'center' }"
                decrement-button-class="p-button-secondary"
                increment-button-class="p-button-secondary"
                decrement-button-icon="pi pi-minus"
                increment-button-icon="pi pi-plus"
              />
            </div>
          </div>
        </div>

        <div v-if="debugImagesEnabled" class="image-debug-panel">
          <div class="image-debug-header">
            <strong>Image debug</strong>
            <button type="button" class="image-debug-clear" @click="clearImageDebugLogs">ล้าง</button>
          </div>
          <div v-if="imageDebugLogs.length === 0" class="image-debug-empty">ยังไม่มี log</div>
          <div
            v-for="(log, index) in imageDebugLogs"
            :key="`${log.time}-${index}`"
            class="image-debug-row"
          >
            <div class="image-debug-title">{{ log.time }} - {{ log.message }}</div>
            <pre>{{ log.detail }}</pre>
          </div>
        </div>
      </template>
    </div>

    <template #footer>
      <Button
        label="ใส่ตะกร้า"
        icon="pi pi-shopping-cart"
        :disabled="!canOrder"
        :loading="adding"
        class="w-full"
        @click="addToCart"
      />
    </template>
  </Dialog>
</template>

<style>
/* global — ต้องไม่ใช้ scoped เพราะ Dialog teleport ออกนอก component */
.detail-sheet {
  width: min(920px, calc(100vw - 3rem)) !important;
  max-width: none !important;
  max-height: calc(100dvh - 2rem) !important;
  display: flex !important;
  flex-direction: column;
}

@media (max-width: 860px) {
  .detail-sheet {
    width: min(640px, calc(100vw - 2rem)) !important;
    max-height: calc(100dvh - 1.5rem) !important;
  }
}

.detail-dialog-header {
  padding: 0 !important;
  border-bottom: 1px solid var(--p-surface-200);
}

.detail-dialog-content {
  padding: 1.25rem !important;
  overflow-y: auto !important;
  min-height: 0;
}

.detail-sheet .p-dialog-footer {
  padding: 1rem 1.25rem calc(1rem + env(safe-area-inset-bottom)) !important;
  border-top: 1px solid var(--p-surface-200);
  flex-shrink: 0;
}

@media (max-width: 860px) {
  .detail-dialog-content {
    padding: 1rem !important;
  }

  .detail-sheet .p-dialog-footer {
    padding: 0.875rem 1rem calc(0.875rem + env(safe-area-inset-bottom)) !important;
  }
}
</style>

<style scoped>
.sheet-header {
  display: flex;
  align-items: flex-start;
  padding: 1.125rem 1.25rem;
  width: 100%;
}

.sheet-title-wrap {
  flex: 1;
  min-width: 0;
}

.sheet-item-name {
  font-size: 1.25rem;
  font-weight: 700;
  line-height: 1.3;
}

.sheet-item-code {
  font-size: 0.82rem;
  color: var(--p-text-color-secondary);
  margin-top: 0.25rem;
}

.sheet-body {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.image-debug-panel {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 260px;
  padding: 0.75rem;
  overflow: auto;
  border: 1px solid #334155;
  border-radius: 12px;
  background: #0f172a;
  color: #e2e8f0;
  font-size: 0.78rem;
}

.image-debug-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.image-debug-clear {
  border: 1px solid #94a3b8;
  border-radius: 8px;
  background: transparent;
  color: #e2e8f0;
  font: inherit;
  padding: 0.25rem 0.5rem;
}

.image-debug-empty {
  color: #94a3b8;
}

.image-debug-row {
  padding: 0.5rem;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid rgba(148, 163, 184, 0.3);
}

.image-debug-title {
  font-weight: 700;
  margin-bottom: 0.35rem;
}

.image-debug-row pre {
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
  color: #bfdbfe;
  font-size: 0.72rem;
}

.sheet-layout {
  display: grid;
  grid-template-columns: minmax(320px, 1.05fr) minmax(300px, 0.95fr);
  gap: 1.25rem;
  align-items: start;
}

.sheet-layout-loading {
  align-items: stretch;
}

.sheet-loading-side {
  display: flex;
  flex-direction: column;
}

.sheet-gallery-card,
.sheet-info-card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
  border-radius: 18px;
  border: 1px solid var(--p-surface-200);
  background: var(--p-surface-0);
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06);
}

.sheet-gallery {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.sheet-preview {
  position: relative;
  width: 100%;
  aspect-ratio: 1.08;
  overflow: hidden;
  background: var(--p-surface-ground);
  border-radius: 14px;
}

.sheet-preview-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  background: var(--p-surface-0);
}

.sheet-preview-placeholder,
.sheet-thumb-placeholder {
  position: absolute;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  color: var(--p-surface-400);
}

.sheet-preview-placeholder {
  font-size: 2rem;
}

.sheet-thumbs {
  display: flex;
  gap: 0.5rem;
  overflow-x: auto;
  padding-bottom: 0.125rem;
}

.sheet-thumb-btn {
  position: relative;
  width: 64px;
  height: 64px;
  padding: 0;
  border-radius: 10px;
  border: 2px solid transparent;
  background: var(--p-surface-ground);
  overflow: hidden;
  flex-shrink: 0;
  cursor: pointer;
  transition: transform 0.14s ease, border-color 0.14s ease;
}

.sheet-thumb-btn:hover {
  transform: translateY(-1px);
}

.sheet-thumb-btn.active {
  border-color: var(--p-primary-color);
}

.sheet-thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.sheet-thumb-placeholder {
  font-size: 1rem;
}

.sheet-section {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.section-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--p-text-color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.unit-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.unit-chip {
  padding: 0.35rem 0.875rem;
  border-radius: 999px;
  border: 2px solid var(--p-surface-border);
  background: transparent;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.12s;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-family: inherit;
  color: var(--p-text-color);
}

.unit-chip.active {
  border-color: var(--p-primary-color);
  background: var(--p-primary-color);
  color: #fff;
}

.chip-warn {
  font-size: 0.75rem;
  color: #f59e0b;
}

.unit-chip.active .chip-warn {
  color: #fde68a;
}

.sheet-summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.875rem;
}

.summary-card,
.price-block,
.stock-block {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.summary-card {
  min-height: 112px;
  padding: 0.875rem 1rem;
  border-radius: 14px;
  background: linear-gradient(180deg, var(--p-surface-50), var(--p-surface-0));
  border: 1px solid var(--p-surface-200);
}

.price-text {
  font-size: 1.65rem;
  font-weight: 700;
  color: var(--p-primary-color);
}

.price-na {
  font-size: 1rem;
  color: var(--p-text-color-secondary);
}

.stock-value {
  font-size: 1.15rem;
  font-weight: 600;
}

.stock-zero {
  color: #dc2626;
}

.in-cart-label {
  font-size: 0.75rem;
  color: var(--p-text-color-secondary);
}

.promotion-section {
  background: linear-gradient(180deg, #fff7ed, #fffbeb);
  border: 1px solid #fcd34d;
  border-radius: 12px;
  padding: 0.75rem 0.875rem;
}

.promotion-icon {
  color: #d97706;
  margin-right: 0.35rem;
}

.promotion-table {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.promotion-row {
  display: grid;
  grid-template-columns: 1.4fr 0.8fr 1fr;
  gap: 0.5rem;
  padding: 0.4rem 0.5rem;
  border-radius: 8px;
  font-size: 0.875rem;
  background: rgba(255, 255, 255, 0.6);
}

.promotion-head {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--p-text-color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: transparent;
  padding-bottom: 0.1rem;
}

.promotion-price-cell {
  text-align: right;
  font-weight: 600;
  color: #b45309;
}

.discount-section {
  background: linear-gradient(180deg, #ecfeff, #f0fdfa);
  border: 1px solid #5eead4;
  border-radius: 12px;
  padding: 0.75rem 0.875rem;
}
.discount-section .promotion-icon { color: #0d9488; }
.discount-row-2col {
  grid-template-columns: 1.4fr 1fr;
}
.discount-head {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--p-text-color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: transparent;
  padding-bottom: 0.1rem;
  grid-template-columns: 1.4fr 1fr;
}
.discount-text { color: #0d9488; }

.out-of-stock-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: #fef2f2;
  border: 1px solid #fca5a5;
  color: #dc2626;
  border-radius: 8px;
  padding: 0.625rem 0.875rem;
  font-size: 0.875rem;
  font-weight: 500;
}

.qty-section {
  padding-top: 0.25rem;
}

.w-full { width: 100%; }
.mb-2 { margin-bottom: 0.5rem; }

@media (max-width: 860px) {
  .sheet-layout {
    grid-template-columns: 1fr;
    gap: 1rem;
  }

  .sheet-body {
    gap: 1rem;
  }

  .sheet-preview {
    aspect-ratio: auto;
    height: clamp(220px, 32dvh, 320px);
  }

  .sheet-gallery-card,
  .sheet-info-card {
    gap: 0.75rem;
  }

  .sheet-summary-grid {
    gap: 0.75rem;
  }

  .summary-card {
    min-height: 96px;
  }
}

@media (max-width: 640px) {
  .sheet-header {
    padding: 1rem;
  }

  .sheet-item-name {
    font-size: 1.05rem;
  }

  .sheet-gallery-card,
  .sheet-info-card {
    padding: 0.875rem;
    border-radius: 14px;
  }

  .sheet-preview {
    height: clamp(200px, 30dvh, 280px);
  }

  .sheet-summary-grid {
    grid-template-columns: 1fr;
  }
}
</style>
