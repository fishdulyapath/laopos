<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { usePosStore } from '@/stores/pos'
import { getDocSaleHistory } from '@/services/salesService'
import { todayISO, formatCurrency } from '@/utils/formatters'
import { useLazyLoad } from '@/composables/useLazyLoad'
import Card from 'primevue/card'
import Button from 'primevue/button'
import Skeleton from 'primevue/skeleton'

const router = useRouter()
const posStore = usePosStore()
const { t } = useI18n()

const loading = ref(false)
const rows = ref([])

const totalAmount = computed(() =>
  rows.value.reduce((sum, r) => sum + Number(r.total_net_amount ?? r.total_amount ?? 0), 0)
)
const totalDocs = computed(() => rows.value.length)
const avgPerDoc = computed(() =>
  totalDocs.value > 0 ? totalAmount.value / totalDocs.value : 0
)
const recentBills = computed(() => rows.value.slice(0, 5))

function shortTime(t) {
  if (!t) return ''
  return String(t).slice(0, 5)
}

async function loadTodaySales() {
  loading.value = true
  try {
    const today = todayISO()
    rows.value = await getDocSaleHistory({
      pos_id: posStore.posId,
      from_date: today,
      to_date: today,
    })
  } catch {
    rows.value = []
  } finally {
    loading.value = false
  }
}

const { containerRef } = useLazyLoad(loadTodaySales)
defineExpose({ loadTodaySales })
</script>

<template>
  <Card ref="containerRef">
    <template #title>
      <div class="card-title-row">
        <i class="pi pi-chart-line" />
        <span>{{ t('dashboard.todaySales') }}</span>
      </div>
    </template>
    <template #content>
      <div class="summary-content">
        <!-- hero amount -->
        <div class="summary-amount">
          <Skeleton v-if="loading" width="12rem" height="3rem" />
          <span v-else class="amount-value">{{ formatCurrency(totalAmount) }}</span>
        </div>

        <!-- stat pills -->
        <div class="stat-pills">
          <div class="stat-pill">
            <span class="stat-pill-label">{{ t('dashboard.docCount') }}</span>
            <Skeleton v-if="loading" width="3rem" height="1.25rem" />
            <span v-else class="stat-pill-value">{{ totalDocs }}</span>
          </div>
          <div class="stat-pill">
            <span class="stat-pill-label">{{ t('dashboard.avgPerDoc') }}</span>
            <Skeleton v-if="loading" width="5rem" height="1.25rem" />
            <span v-else class="stat-pill-value">{{ formatCurrency(avgPerDoc) }}</span>
          </div>
        </div>

        <!-- recent bills -->
        <div class="recent-section">
          <span class="recent-label">{{ t('dashboard.recentBills') }}</span>

          <div v-if="loading" class="recent-list">
            <div v-for="n in 5" :key="n" class="recent-skeleton">
              <Skeleton width="5rem" height="0.875rem" />
              <Skeleton width="4rem" height="0.875rem" />
            </div>
          </div>

          <div v-else-if="recentBills.length === 0" class="recent-empty">
            {{ t('dashboard.noBillsToday') }}
          </div>

          <ul v-else class="recent-list">
            <li
              v-for="bill in recentBills"
              :key="bill.doc_no"
              class="recent-item"
            >
              <div class="recent-left">
                <span class="recent-docno">{{ bill.doc_no }}</span>
                <span class="recent-meta">
                  {{ shortTime(bill.doc_time) }}
                  <template v-if="bill.cust_name"> · {{ bill.cust_name }}</template>
                </span>
              </div>
              <span class="recent-amount">{{ formatCurrency(bill.total_net_amount ?? bill.total_amount) }}</span>
            </li>
          </ul>
        </div>

        <Button
          :label="t('dashboard.viewAll')"
          icon="pi pi-list"
          severity="secondary"
          outlined
          size="small"
          class="detail-btn"
          @click="router.push('/sales-history')"
        />
      </div>
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

.summary-content {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.amount-value {
  font-size: 1.55rem;
  font-weight: 700;
  color: var(--p-primary-color);
  line-height: 1.1;
}

.stat-pills {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.stat-pill {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  background: var(--p-surface-ground);
  border-radius: 8px;
  padding: 0.5rem 0.75rem;
  flex: 1;
  min-width: 7rem;
}

.stat-pill-label {
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--p-text-color-secondary);
  font-weight: 600;
}

.stat-pill-value {
  font-size: 1rem;
  font-weight: 700;
  color: var(--p-text-color);
}

/* recent bills section */
.recent-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.recent-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--p-text-color-secondary);
}

.recent-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.recent-skeleton {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--p-surface-border);
}

.recent-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.3rem 0.5rem;
  border-radius: 6px;
  gap: 0.75rem;
  transition: background 0.12s;
}

.recent-item:hover {
  background: var(--p-surface-hover);
}

.recent-left {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
}

.recent-docno {
  font-size: 0.875rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.recent-meta {
  display: block;
  font-size: 0.75rem;
  color: var(--p-text-color-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.recent-amount {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--p-primary-color);
  flex-shrink: 0;
}

.recent-empty {
  font-size: 0.875rem;
  color: var(--p-text-color-secondary);
  padding: 0.5rem 0;
}

.detail-btn {
  align-self: flex-start;
}
</style>
