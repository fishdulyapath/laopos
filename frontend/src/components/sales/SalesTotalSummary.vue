<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatCurrency } from '@/utils/formatters'

const props = defineProps({
  rows: { type: Array, default: () => [] },
})
const { t } = useI18n()

const total = computed(() =>
  props.rows.reduce((sum, r) => sum + Number(r.total_amount ?? 0), 0)
)

const cashRows = computed(() => props.rows.filter((r) => [1, 3].includes(Number(r.inquiry_type))))
const creditRows = computed(() => props.rows.filter((r) => [0, 2].includes(Number(r.inquiry_type))))
const cashTotal = computed(() =>
  cashRows.value.reduce((sum, r) => sum + Number(r.total_amount ?? 0), 0)
)
const creditTotal = computed(() =>
  creditRows.value.reduce((sum, r) => sum + Number(r.total_amount ?? 0), 0)
)
</script>

<template>
  <div class="summary-bar">
    <span class="summary-count">{{ t('salesHistory.itemCount', { count: rows.length }) }}</span>
    <span class="summary-divider" />
    <span class="summary-chip cash">{{ t('salesHistory.cashSummary', { count: cashRows.length, amount: formatCurrency(cashTotal) }) }}</span>
    <span class="summary-chip credit">{{ t('salesHistory.creditSummary', { count: creditRows.length, amount: formatCurrency(creditTotal) }) }}</span>
    <span class="summary-label">{{ t('salesHistory.total') }}</span>
    <span class="summary-amount">{{ formatCurrency(total) }}</span>
  </div>
</template>

<style scoped>
.summary-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 1rem;
  background: var(--p-primary-50);
  border-radius: 8px;
  border: 1px solid var(--p-primary-200);
}

.summary-count {
  font-size: 0.875rem;
  color: var(--p-text-color-secondary);
}

.summary-divider {
  width: 1px;
  height: 1rem;
  background: var(--p-surface-border);
}

.summary-label {
  font-size: 0.875rem;
  color: var(--p-text-color-secondary);
}

.summary-chip {
  border-radius: 999px;
  font-size: 0.82rem;
  font-weight: 800;
  line-height: 1;
  padding: 0.4rem 0.62rem;
  white-space: nowrap;
}

.summary-chip.cash {
  background: #e0f2fe;
  color: #075985;
}

.summary-chip.credit {
  background: #e0f2fe;
  color: #075985;
}

.summary-amount {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--p-primary-color);
  margin-left: auto;
}

@media (max-width: 768px) {
  .summary-bar {
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
  }

  .summary-count,
  .summary-label {
    font-size: 0.8rem;
  }

  .summary-amount {
    font-size: 1rem;
    margin-left: auto;
  }
}

@media (max-width: 480px) {
  .summary-bar {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
    padding: 0.5rem;
  }

  .summary-divider {
    display: none;
  }

  .summary-amount {
    margin-left: 0;
    width: 100%;
    text-align: right;
  }
}
</style>
