<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { getDashboardTopProducts } from '@/services/salesService'
import { formatNumber, formatCurrency, todayISO } from '@/utils/formatters'
import { useLazyLoad } from '@/composables/useLazyLoad'
import Card from 'primevue/card'
import Skeleton from 'primevue/skeleton'

const loading = ref(false)
const rows = ref([])
const { t } = useI18n()

async function load() {
  loading.value = true
  try {
    rows.value = await getDashboardTopProducts(todayISO())
  } catch {
    rows.value = []
  } finally {
    loading.value = false
  }
}

const { containerRef } = useLazyLoad(load)
defineExpose({ load })
</script>

<template>
  <Card ref="containerRef">
    <template #title>
      <div class="card-title-row">
        <i class="pi pi-star" />
        <span>{{ t('dashboard.topProductsToday') }}</span>
      </div>
    </template>
    <template #content>
      <div v-if="loading" class="skeleton-list">
        <Skeleton v-for="n in 5" :key="n" height="2rem" class="mb-1" />
      </div>
      <div v-else-if="rows.length === 0" class="empty-msg">{{ t('dashboard.noData') }}</div>
      <ol v-else class="rank-list">
        <li v-for="(row, i) in rows" :key="row.item_code" class="rank-item">
          <span class="rank-no" :class="`rank-${i + 1}`">{{ i + 1 }}</span>
          <div class="rank-detail">
            <span class="rank-name">{{ row.item_name || row.item_code }}</span>
            <span class="rank-sub">{{ row.item_code }} · {{ row.unit_code }}</span>
          </div>
          <div class="rank-right">
            <span class="rank-qty">{{ formatNumber(row.total_qty) }}</span>
            <span class="rank-amount">{{ formatCurrency(row.total_amount) }}</span>
          </div>
        </li>
      </ol>
    </template>
  </Card>
</template>

<style scoped>
.card-title-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1rem;
  font-weight: 600;
}

.skeleton-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.mb-1 { margin-bottom: 0.25rem; }

.empty-msg {
  text-align: center;
  padding: 1.5rem 0;
  color: var(--p-text-color-secondary);
  font-size: 0.875rem;
}

.rank-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 18rem; /* keeps the card tall even with few rows */
}

.rank-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.625rem;
  border-radius: 8px;
  background: var(--p-surface-ground);
}

.rank-no {
  width: 1.625rem;
  height: 1.625rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 700;
  flex-shrink: 0;
  background: var(--p-surface-300);
  color: var(--p-surface-700);
}

.rank-1 { background: #FFD700; color: #7a5c00; }
.rank-2 { background: #C0C0C0; color: #444; }
.rank-3 { background: #CD7F32; color: #fff; }

.rank-detail {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.rank-name {
  display: block;
  max-width: 100%;
  font-size: 0.875rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rank-sub {
  font-size: 0.75rem;
  color: var(--p-text-color-secondary);
}

.rank-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.125rem;
  flex-shrink: 0;
}

.rank-qty {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--p-primary-color);
}

.rank-amount {
  font-size: 0.75rem;
  color: var(--p-text-color-secondary);
}
</style>
