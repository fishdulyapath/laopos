<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import { useConfirm } from 'primevue/useconfirm'
import { useCartStore } from '@/stores/cart'
import { formatCurrency } from '@/utils/formatters'
import { productImageUrl } from '@/utils/imageUrls'

const props = defineProps({
  basket: { type: Object, required: true },
})
const emit = defineEmits(['back', 'next'])

const cartStore = useCartStore()
const cartKey = computed(() => `BASKET-${props.basket.basket_id}`)
const confirm = useConfirm()

const updating = ref({})
const clearing = ref(false)
const remarkOpen = ref({})
let qtyTimers = {}

const total = computed(() =>
  cartStore.items.reduce((sum, i) => sum + Number(i.qty) * Number(i.price), 0)
)

// เปิด remark ทันทีสำหรับ item ที่มี remark อยู่แล้ว
watch(() => cartStore.items, (items) => {
  items.forEach(i => {
    if (i.remark && !remarkOpen.value[i.guid_code]) {
      remarkOpen.value[i.guid_code] = true
    }
  })
}, { immediate: true })

onMounted(async () => {
  await cartStore.fetchCart(cartKey.value)
})

function imageUrl(item_code) {
  return productImageUrl(item_code)
}

function onImgError(e) {
  e.target.style.display = 'none'
  e.target.nextElementSibling?.style.setProperty('display', 'flex')
}

function toggleRemark(guid_code) {
  remarkOpen.value[guid_code] = !remarkOpen.value[guid_code]
}

function onQtyInput(item, raw) {
  const val = Number(String(raw ?? '').trim().replace(',', '.'))
  if (isNaN(val) || val < 0) return
  clearTimeout(qtyTimers[item.guid_code])
  qtyTimers[item.guid_code] = setTimeout(async () => {
    updating.value[item.guid_code] = true
    try {
      await cartStore.updateItemQty(item, val, cartKey.value)
    } finally {
      updating.value[item.guid_code] = false
    }
  }, 400)
}

async function incrementQty(item) {
  updating.value[item.guid_code] = true
  try {
    await cartStore.updateItemQty(item, Number(item.qty) + 1, cartKey.value)
  } finally {
    updating.value[item.guid_code] = false
  }
}

async function decrementQty(item) {
  updating.value[item.guid_code] = true
  try {
    await cartStore.updateItemQty(item, Number(item.qty) - 1, cartKey.value)
  } finally {
    updating.value[item.guid_code] = false
  }
}

async function removeItem(item) {
  updating.value[item.guid_code] = true
  try {
    await cartStore.updateItemQty(item, 0, cartKey.value)
  } finally {
    updating.value[item.guid_code] = false
  }
}

function confirmClearCart() {
  confirm.require({
    message: 'ล้างสินค้าทั้งหมดในตะกร้า?',
    header: 'ยืนยันการล้างตะกร้า',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'ล้าง',
    rejectLabel: 'ยกเลิก',
    acceptClass: 'p-button-danger p-button-sm',
    rejectClass: 'p-button-text p-button-sm',
    accept: async () => {
      clearing.value = true
      try {
        await cartStore.clearCart(cartKey.value)
      } finally {
        clearing.value = false
      }
    },
  })
}

let remarkTimers = {}

function onRemarkBlur(item, value) {
  clearTimeout(remarkTimers[item.guid_code])
  if (value === (item.remark || '')) return
  remarkTimers[item.guid_code] = setTimeout(async () => {
    await cartStore.updateItemRemark(item, value, cartKey.value)
  }, 0)
}
</script>

<template>
  <div class="cart-items-view">
    <div class="cart-header">
      <Button icon="pi pi-arrow-left" text rounded size="small" @click="emit('back')" aria-label="กลับ" />
      <span class="cart-title">ตะกร้า #{{ basket.basket_id }} · {{ basket.cust_name || 'ลูกค้าทั่วไป' }}</span>
    </div>

    <div class="cart-body">
      <div v-if="cartStore.loading" class="empty-hint">กำลังโหลด...</div>

      <div v-else-if="cartStore.items.length === 0" class="empty-hint">
        <i class="pi pi-shopping-cart" style="font-size:2rem;opacity:.3" />
        <div>ไม่มีสินค้าในตะกร้า</div>
      </div>

      <template v-else>
        <div v-for="item in cartStore.items" :key="item.guid_code" class="cart-row">
          <!-- บนสุด: รูป + ข้อมูลสินค้า + ปุ่มลบ -->
          <div class="cart-row-top">
            <div class="item-img-wrap">
              <img
                :src="imageUrl(item.item_code)"
                :alt="item.item_name"
                class="item-img"
                @error="onImgError"
              />
              <div class="item-img-placeholder"><i class="pi pi-box" /></div>
            </div>
            <div class="item-info">
              <div class="item-name">{{ item.item_name }}</div>
              <div class="item-meta">{{ item.item_code }} · {{ item.unit_code }}</div>
              <div class="item-price">{{ formatCurrency(Number(item.price)) }} / {{ item.unit_code }}</div>
            </div>
            <Button
              icon="pi pi-trash"
              text
              rounded
              severity="danger"
              size="small"
              :loading="updating[item.guid_code]"
              @click="removeItem(item)"
            />
          </div>

          <!-- ควบคุมจำนวน + ยอดย่อย -->
          <div class="cart-row-controls">
            <div class="qty-control">
              <button
                class="qty-btn"
                :disabled="updating[item.guid_code] || Number(item.qty) <= 1"
                @click="decrementQty(item)"
              >
                <i class="pi pi-minus" />
              </button>
              <input
                class="qty-input"
                type="text"
                inputmode="decimal"
                min="0"
                step="0.01"
                :value="item.qty"
                :disabled="updating[item.guid_code]"
                @change="e => onQtyInput(item, e.target.value)"
              />
              <button
                class="qty-btn"
                :disabled="updating[item.guid_code]"
                @click="incrementQty(item)"
              >
                <i class="pi pi-plus" />
              </button>
            </div>
            <div class="row-subtotal">{{ formatCurrency(Number(item.qty) * Number(item.price)) }}</div>
          </div>

          <!-- หมายเหตุ: ซ่อนเริ่มต้น -->
          <div class="remark-row">
            <button
              v-if="!remarkOpen[item.guid_code]"
              class="remark-toggle"
              @click="toggleRemark(item.guid_code)"
            >
              <i class="pi pi-plus-circle" />
              เพิ่มหมายเหตุ
            </button>
            <div v-else class="remark-open-row">
              <InputText
                :default-value="item.remark || ''"
                placeholder="หมายเหตุสินค้านี้..."
                class="remark-input"
                size="small"
                @blur="e => onRemarkBlur(item, e.target.value)"
              />
              <button class="remark-close-btn" @click="toggleRemark(item.guid_code)">
                <i class="pi pi-times" />
              </button>
            </div>
          </div>
        </div>
      </template>
    </div>

    <div class="cart-footer">
      <div v-if="cartStore.items.length > 0" class="footer-clear-row">
        <Button
          label="ล้างตะกร้า"
          icon="pi pi-trash"
          text
          severity="danger"
          size="small"
          :loading="clearing"
          @click="confirmClearCart"
        />
      </div>
      <div class="footer-bottom-row">
        <div class="footer-total">
          <span class="total-label">รวม</span>
          <span class="total-value">{{ formatCurrency(total) }}</span>
        </div>
        <Button
          label="ถัดไป"
          icon="pi pi-arrow-right"
          icon-pos="right"
          :disabled="cartStore.items.length === 0"
          class="next-btn"
          @click="emit('next')"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.cart-items-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
}

.cart-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--p-surface-border);
  flex-shrink: 0;
}

.cart-title {
  font-size: 1.05rem;
  font-weight: 600;
}

.cart-body {
  flex: 1;
  overflow-y: auto;
  padding: 0.75rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.empty-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  height: 100%;
  color: var(--p-text-color-secondary);
  font-size: 0.9rem;
}

.cart-row {
  border: 1px solid var(--p-surface-border);
  border-radius: 10px;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  background: var(--p-surface-card);
}

/* ─── row top: รูป + ข้อมูล + ลบ ─── */
.cart-row-top {
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
}

.item-img-wrap {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  background: var(--p-surface-ground);
  flex-shrink: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.item-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 3px;
}

.item-img-placeholder {
  display: none;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 1.25rem;
  color: var(--p-surface-400);
}

.item-info {
  flex: 1;
  min-width: 0;
}

.item-name {
  font-weight: 600;
  font-size: 0.875rem;
  line-height: 1.3;
}

.item-meta {
  font-size: 0.72rem;
  color: var(--p-text-color-secondary);
  margin-top: 2px;
}

.item-price {
  font-size: 0.78rem;
  color: var(--p-primary-color);
  margin-top: 2px;
}

/* ─── qty controls ─── */
.cart-row-controls {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.qty-control {
  display: flex;
  align-items: center;
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
  overflow: hidden;
}

.qty-btn {
  width: 2rem;
  height: 2rem;
  border: none;
  background: var(--p-surface-ground);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  color: var(--p-text-color);
  transition: background 0.1s;
}

.qty-btn:hover:not(:disabled) {
  background: var(--p-surface-hover);
}

.qty-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.qty-input {
  width: 3.5rem;
  height: 2rem;
  border: none;
  border-left: 1px solid var(--p-surface-border);
  border-right: 1px solid var(--p-surface-border);
  text-align: center;
  font-size: 0.875rem;
  font-family: inherit;
  background: transparent;
  color: var(--p-text-color);
  outline: none;
  padding: 0;
}

.qty-input::-webkit-outer-spin-button,
.qty-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
}

.row-subtotal {
  font-weight: 700;
  font-size: 0.95rem;
  color: var(--p-primary-color);
  margin-left: auto;
}

/* ─── remark ─── */
.remark-row {
  display: flex;
}

.remark-toggle {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  border: none;
  background: none;
  padding: 0.15rem 0;
  font-size: 0.78rem;
  color: var(--p-text-color-secondary);
  cursor: pointer;
  font-family: inherit;
}

.remark-toggle:hover {
  color: var(--p-primary-color);
}

.remark-toggle .pi {
  font-size: 0.72rem;
}

.remark-open-row {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  width: 100%;
}

.remark-input {
  flex: 1;
  font-size: 0.8rem !important;
}

.remark-close-btn {
  flex-shrink: 0;
  width: 1.75rem;
  height: 1.75rem;
  border: none;
  background: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--p-text-color-secondary);
  font-size: 0.75rem;
  border-radius: 50%;
}

.remark-close-btn:hover {
  background: var(--p-surface-hover);
  color: var(--p-text-color);
}

/* ─── footer ─── */
.cart-footer {
  padding: 0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom));
  border-top: 1px solid var(--p-surface-border);
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex-shrink: 0;
  background: var(--p-surface-0, #ffffff);
  position: sticky;
  bottom: 0;
  z-index: 5;
}

.footer-clear-row {
  display: flex;
  border-bottom: 1px solid var(--p-surface-border);
  padding-bottom: 0.25rem;
}

.footer-bottom-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding-top: 0.25rem;
}

.footer-total {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.total-label {
  font-size: 0.75rem;
  color: var(--p-text-color-secondary);
  text-transform: uppercase;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.total-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--p-primary-color);
}

.next-btn {
  margin-left: auto;
}
</style>
