<script setup>
import { useI18n } from 'vue-i18n'
import { formatDate, formatCurrency } from '@/utils/formatters'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import { TIGER_PENDING_MOCK } from '@/services/tigerService'

defineProps({
  rows: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  mockingDocNo: { type: String, default: '' },
  canDetail: { type: Boolean, default: true },
  canPrint: { type: Boolean, default: true },
  canEdit: { type: Boolean, default: true },
})

const emit = defineEmits(['print-doc', 'view-doc', 'edit-doc', 'tiger-mock-paid'])
const { t } = useI18n()

function isTigerPending(row) {
  return Number(row.send_sms) === 1 && !!row.tiger_order_id
}

function customerDisplay(row) {
  const code = String(row.cust_code || '').trim()
  const name = String(row.cust_name || '').trim()
  if (code && name) return `${code}~${name}`
  return name || code || '-'
}

function salesmanDisplay(row) {
  const code = String(row.sale_code || '').trim()
  const name = String(row.sale_name || '').trim()
  if (code && name) return `${code}~${name}`
  return name || code || '-'
}

function creatorDisplay(row) {
  const code = String(row.creator_code || '').trim()
  const name = String(row.creator_name || '').trim()
  if (code && name) return `${code}~${name}`
  return name || code || '-'
}

function isCreditSale(row) {
  return [0, 2].includes(Number(row?.inquiry_type))
}

function saleTypeLabel(row) {
  return isCreditSale(row) ? t('sell.creditSale') : t('sell.cashSale')
}

function canEditDoc(row) {
  if (Number(row.used_status) === 1) return false
  if (Number(row.used_status_2) === 1) return false
  if (Number(row.doc_success) === 1) return false
  if (Number(row.is_doc_copy) === 1) return false
  return true
}

function editBlockReason(row) {
  if (Number(row.used_status) === 1) return t('salesHistory.editBlocked.usedStatus')
  if (Number(row.used_status_2) === 1) return t('salesHistory.editBlocked.usedStatus2')
  if (Number(row.doc_success) === 1) return t('salesHistory.editBlocked.docSuccess')
  if (Number(row.is_doc_copy) === 1) return t('salesHistory.editBlocked.isDocCopy')
  return ''
}

</script>

<template>
  <DataTable
    :value="rows"
    :loading="loading"
    data-key="doc_no"
    sort-field="doc_date"
    :sort-order="-1"
    paginator
    :rows="20"
    :rows-per-page-options="[10, 20, 50]"
    scrollable
    scroll-height="flex"
    responsive-layout="stack"
    class="sales-table"
  >
    <template #empty>
      <div class="empty-msg">{{ t('salesHistory.noData') }}</div>
    </template>

    <Column field="doc_date" :header="t('salesHistory.docDate')" :sortable="true" style="min-width: 140px">
      <template #body="{ data }">
        <div class="date-time-cell">
          <span class="doc-date">{{ formatDate(data.doc_date) }}</span>
          <span v-if="data.doc_time" class="doc-time">{{ String(data.doc_time).slice(0, 5) }}</span>
        </div>
      </template>
    </Column>
    <Column field="doc_no" :header="t('salesHistory.docNo')" :sortable="true" style="min-width: 190px">
      <template #body="{ data }">
        <div class="docno-cell">
          <span>{{ data.doc_no }}</span>
          <span v-if="isTigerPending(data)" class="tiger-pending-badge">
            <i class="pi pi-clock" />
            {{ t('salesHistory.waitingTiger') }}
          </span>
          <Button
            v-if="isTigerPending(data) && TIGER_PENDING_MOCK"
            :label="t('dashboard.mockPaid')"
            icon="pi pi-check"
            size="small"
            severity="warning"
            outlined
            :loading="mockingDocNo === data.doc_no"
            :disabled="!!mockingDocNo"
            @click.stop="emit('tiger-mock-paid', data)"
          />
        </div>
      </template>
    </Column>
    <Column :header="t('salesHistory.saleKind')" style="min-width: 100px">
      <template #body="{ data }">
        <span class="sale-kind-badge" :class="{ credit: isCreditSale(data) }">{{ saleTypeLabel(data) }}</span>
      </template>
    </Column>
    <Column :header="t('salesHistory.customer')" style="min-width: 180px">
      <template #body="{ data }">
        <span class="combined-field">{{ customerDisplay(data) }}</span>
      </template>
    </Column>
    <Column :header="t('salesHistory.salesman')" style="min-width: 150px">
      <template #body="{ data }">
        <span class="combined-field">{{ salesmanDisplay(data) }}</span>
      </template>
    </Column>
    <Column :header="t('salesHistory.creator')" style="min-width: 150px">
      <template #body="{ data }">
        <span class="combined-field">{{ creatorDisplay(data) }}</span>
      </template>
    </Column>
    <Column field="total_amount" :header="t('sell.netTotal')" :sortable="true" style="min-width: 110px; text-align: right">
      <template #body="{ data }">
        {{ formatCurrency(data.total_amount || 0) }}
      </template>
    </Column>
    <Column :header="t('salesHistory.actions')" frozen align-frozen="right" style="min-width: 200px; text-align: center">
      <template #body="{ data }">
        <div class="action-btns">
          <Button
            v-if="canPrint"
            :label="t('salesHistory.print')"
            icon="pi pi-print"
            size="small"
            severity="secondary"
            outlined
            @click.stop="emit('print-doc', data)"
          />
          <Button
            v-if="canDetail"
            :label="t('salesHistory.viewDetail')"
            icon="pi pi-eye"
            size="small"
            severity="info"
            outlined
            @click.stop="emit('view-doc', data)"
          />
          <Button
            v-if="canEdit"
            :label="t('salesHistory.edit')"
            icon="pi pi-pencil"
            size="small"
            severity="secondary"
            outlined
            :disabled="!canEditDoc(data)"
            v-tooltip.top="!canEditDoc(data) ? editBlockReason(data) : undefined"
            @click.stop="emit('edit-doc', data)"
          />
        </div>
      </template>
    </Column>
  </DataTable>
</template>

<style scoped>
.empty-msg {
  text-align: center;
  padding: 1rem;
  color: var(--p-text-color-secondary);
}

.sales-table :deep(.p-datatable-table) {
  font-size: 0.9rem;
}

.sales-table :deep(.p-paginator) {
  padding: 0.5rem;
}

.date-time-cell {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.doc-date {
  font-size: 0.85rem;
  line-height: 1.3;
}

.doc-time {
  font-size: 0.75rem;
  color: var(--p-text-color-secondary);
  font-variant-numeric: tabular-nums;
}

.docno-cell {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.combined-field {
  font-size: 0.88rem;
}

.sale-kind-badge {
  align-items: center;
  border-radius: 999px;
  display: inline-flex;
  font-size: 0.76rem;
  font-weight: 800;
  line-height: 1;
  min-height: 24px;
  padding: 0.32rem 0.55rem;
  white-space: nowrap;
  background: #e0f2fe;
  color: #075985;
}

.sale-kind-badge.credit {
  background: #fef3c7;
  color: #92400e;
}

.tiger-pending-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.2rem 0.45rem;
  border-radius: 999px;
  background: #fff7ed;
  color: #c2410c;
  font-size: 0.72rem;
  font-weight: 700;
  white-space: nowrap;
}

.action-btns {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex-wrap: wrap;
  justify-content: center;
}

@media (max-width: 768px) {
  .sales-table :deep(.p-datatable-table) {
    font-size: 0.85rem;
  }

  .sales-table :deep(.p-paginator-bottom) {
    flex-wrap: wrap;
  }

  .sales-table :deep(.p-paginator .p-paginator-rpp-options) {
    display: none;
  }
}

@media (max-width: 640px) {
  .sales-table :deep(.p-datatable .p-datatable-thead > tr > th) {
    padding: 0.4rem 0.2rem;
    font-size: 0.8rem;
  }

  .sales-table :deep(.p-datatable .p-datatable-tbody > tr > td) {
    padding: 0.4rem 0.2rem;
    font-size: 0.8rem;
  }

  .sales-table :deep(.p-paginator) {
    padding: 0.4rem 0.2rem;
    font-size: 0.75rem;
  }
}

@media (max-width: 480px) {
  .sales-table :deep(.p-datatable .p-datatable-thead > tr > th) {
    padding: 0.3rem 0.15rem;
    font-size: 0.75rem;
  }

  .sales-table :deep(.p-datatable .p-datatable-tbody > tr > td) {
    padding: 0.3rem 0.15rem;
    font-size: 0.75rem;
  }
}
</style>
