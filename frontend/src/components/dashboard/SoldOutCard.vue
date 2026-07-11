<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { getDashboardSoldOut } from '@/services/salesService'
import { formatNumber, todayISO } from '@/utils/formatters'
import { useLazyLoad } from '@/composables/useLazyLoad'
import Card from 'primevue/card'
import Button from 'primevue/button'
import Skeleton from 'primevue/skeleton'

const router = useRouter()
const loading = ref(false)
const rows = ref([])
const { t } = useI18n()

async function load() {
  loading.value = true
  try {
    rows.value = await getDashboardSoldOut(todayISO())
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
        <div class="title-left">
          <i class="pi pi-exclamation-circle title-icon" />
          <span>{{ t('dashboard.soldOutToday') }}</span>
        </div>
        <Button
          :label="t('dashboard.viewAll')"
          icon="pi pi-arrow-right"
          iconPos="right"
          size="small"
          text
          @click="router.push('/sold-out')"
        />
      </div>
    </template>
    <template #content>
      <div v-if="loading" class="skeleton-list">
        <Skeleton v-for="n in 5" :key="n" height="2rem" class="mb-1" />
      </div>
      <div v-else-if="rows.length === 0" class="empty-msg">
        <i class="pi pi-check-circle empty-icon" />
        <span>{{ t('dashboard.noSoldOutToday') }}</span>
      </div>
      <ol v-else class="rank-list">
        <li v-for="(row, i) in rows.slice(0, 5)" :key="row.item_code" class="rank-item">
          <span class="rank-no">{{ i + 1 }}</span>
          <div class="rank-detail">
            <span class="rank-name">{{ row.item_name || row.item_code }}</span>
            <span class="rank-sub">{{ row.item_code }} · {{ row.unit_name || row.unit_code }}</span>
          </div>
          <div class="rank-right">
            <span class="rank-remaining">{{ formatNumber(row.remaining_qty) }}</span>
            <span class="rank-sub">{{ t('dashboard.remaining') }}</span>
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
  justify-content: space-between;
  font-size: 1rem;
  font-weight: 600;
}

.title-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.title-icon {
  color: var(--p-red-500);
}

.skeleton-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.mb-1 { margin-bottom: 0.25rem; }

.empty-msg {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2rem 0;
  color: var(--p-text-color-secondary);
  font-size: 0.875rem;
}

.empty-icon {
  font-size: 1.75rem;
  color: var(--p-green-500);
}

.rank-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 18rem;
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
  background: var(--p-red-100);
  color: var(--p-red-600);
}

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

.rank-remaining {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--p-red-500);
}
</style>
