<script setup>
import { ref, computed, onMounted } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import ProgressSpinner from 'primevue/progressspinner'
import { getBasketList } from '@/services/basketService'
import { formatCurrency } from '@/utils/formatters'

const emit = defineEmits(['select'])

const baskets = ref([])
const loading = ref(false)
const search = ref('')
const filterStatus = ref('all')

async function loadBaskets() {
  loading.value = true
  try {
    baskets.value = await getBasketList()
  } finally {
    loading.value = false
  }
}

const filteredBaskets = computed(() => {
  let list = baskets.value
  if (filterStatus.value === 'empty') list = list.filter(b => b.status !== 'active')
  else if (filterStatus.value === 'active') list = list.filter(b => b.status === 'active')
  const q = search.value.trim()
  if (q) {
    const lower = q.toLowerCase()
    list = list.filter(b =>
      String(b.basket_id).includes(q) ||
      (b.cust_code || '').toLowerCase().includes(lower) ||
      (b.cust_name || '').toLowerCase().includes(lower) ||
      (b.sale_code || '').toLowerCase().includes(lower) ||
      (b.sale_name || '').toLowerCase().includes(lower) ||
      (b.doc_format_code || '').toLowerCase().includes(lower) ||
      (b.doc_format_name || '').toLowerCase().includes(lower)
    )
  }
  return list
})

onMounted(loadBaskets)
</script>

<template>
  <div class="basket-grid-view">
    <div class="basket-grid-header">
      <span class="basket-grid-title">เลือกตะกร้า</span>
      <Button
        icon="pi pi-refresh"
        text
        rounded
        :loading="loading"
        @click="loadBaskets"
        aria-label="รีเฟรช"
      />
    </div>

    <div class="basket-filter-bar">
      <div class="search-wrap">
        <i class="pi pi-search search-icon" />
        <InputText v-model="search" placeholder="เลขตะกร้า / ลูกค้า / พนักงาน" class="basket-search" />
      </div>
      <div class="status-tabs">
        <button class="status-tab" :class="{ active: filterStatus === 'all' }" @click="filterStatus = 'all'">ทั้งหมด</button>
        <button class="status-tab" :class="{ active: filterStatus === 'empty' }" @click="filterStatus = 'empty'">ว่าง</button>
        <button class="status-tab" :class="{ active: filterStatus === 'active' }" @click="filterStatus = 'active'">ไม่ว่าง</button>
      </div>
    </div>

    <div v-if="loading && baskets.length === 0" class="basket-loading">
      <ProgressSpinner style="width:40px;height:40px" />
    </div>

    <div v-else class="basket-grid">
      <button
        v-for="basket in filteredBaskets"
        :key="basket.basket_id"
        class="basket-cell"
        :data-testid="`sale-basket-${basket.basket_id}`"
        :class="basket.status === 'active' ? 'basket-cell--active' : 'basket-cell--empty'"
        @click="emit('select', basket)"
      >
        <span class="basket-number">#{{ basket.basket_id }}</span>

        <template v-if="basket.status === 'active'">
          <span class="basket-cust-name">{{ basket.cust_name || 'ลูกค้าทั่วไป' }}</span>
          <span v-if="basket.doc_format_code" class="basket-doc-format">
            {{ basket.doc_format_code }}<template v-if="basket.doc_format_name"> · {{ basket.doc_format_name }}</template>
          </span>
          <span class="basket-items">{{ basket.total_items }} รายการ</span>
          <span class="basket-total">{{ formatCurrency(basket.total_price) }}</span>
        </template>

        <template v-else>
          <span class="basket-empty-label">ว่าง</span>
        </template>
      </button>
    </div>
  </div>
</template>

<style scoped>
.basket-grid-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 1rem;
}

.basket-grid-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.basket-grid-title {
  font-size: 1.1rem;
  font-weight: 600;
}

.basket-filter-bar {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.search-wrap {
  position: relative;
}

.search-icon {
  position: absolute;
  left: 0.75rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--p-text-color-secondary);
  font-size: 0.875rem;
  pointer-events: none;
}

.basket-search {
  width: 100%;
  padding-left: 2.25rem !important;
}

.status-tabs {
  display: flex;
  gap: 0.375rem;
}

.status-tab {
  flex: 1;
  padding: 0.3rem 0.5rem;
  border-radius: 8px;
  border: 1px solid var(--p-surface-border);
  background: transparent;
  font-size: 0.8125rem;
  cursor: pointer;
  color: var(--p-text-color-secondary);
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}

.status-tab.active {
  background: var(--p-primary-color);
  color: #fff;
  border-color: var(--p-primary-color);
}

.basket-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.basket-grid {
  flex: 1;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 1rem;
  align-content: start;
}

.basket-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 12px;
  /* padding: 1rem 0.75rem; */
  min-height: 180px;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.1s;
  background: none;
  font-family: inherit;
}

.basket-cell:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.12);
}

.basket-cell:active {
  transform: translateY(0);
}

.basket-cell--empty {
  background: var(--surface-100, #f8f9fa);
  border-color: var(--surface-300, #dee2e6);
  color: var(--text-color-secondary, #6c757d);
}

.basket-cell--active {
  background: #fff3e0;
  border-color: #fb8c00;
  color: #e65100;
}

.basket-number {
  font-size: 0.95rem;
  font-weight: 700;
  opacity: 0.65;
}

.basket-empty-label {
  font-size: 1.15rem;
  font-weight: 500;
  margin-top: 4px;
}

.basket-cust-name {
  font-size: 1.05rem;
  font-weight: 700;
  text-align: center;
  line-height: 1.25;
  word-break: break-all;
  max-width: 100%;
}

.basket-items {
  font-size: 0.9rem;
  opacity: 0.8;
}

.basket-doc-format {
  max-width: 100%;
  padding: 0.15rem 0.45rem;
  border-radius: 999px;
  background: rgba(234, 88, 12, 0.12);
  color: #9a3412;
  font-size: 0.75rem;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.basket-total {
  font-size: 1rem;
  font-weight: 600;
}

@media (max-width: 480px) {
  .basket-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 0.6rem;
  }

  .basket-cell {
    min-height: 160px;
    padding: 0.9rem 0.6rem;
    gap: 4px;
  }

  .basket-number {
    font-size: 0.95rem;
  }

  .basket-cust-name {
    font-size: 1.05rem;
    line-height: 1.25;
  }

  .basket-items {
    font-size: 0.85rem;
  }

  .basket-total {
    font-size: 0.95rem;
  }

  .basket-empty-label {
    font-size: 1.1rem;
  }
}
</style>
