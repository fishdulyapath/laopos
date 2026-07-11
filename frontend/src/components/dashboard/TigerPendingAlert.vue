<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from 'primevue/button'
import { useToast } from 'primevue/usetoast'
import { useRouter } from 'vue-router'
import { TIGER_PENDING_MOCK, checkNextTigerPendingPayment, getTigerPendingPayments, mockTigerPendingPaid } from '@/services/tigerService'
import { formatCurrency, formatDate } from '@/utils/formatters'

const router = useRouter()
const toast = useToast()
const { t } = useI18n()

const rows = ref([])
const loading = ref(false)
const checking = ref(false)
const mockingDocNo = ref('')
let timer = null

const totalAmount = computed(() =>
  rows.value.reduce((sum, row) => sum + Number(row.tiger_amount || 0), 0)
)

async function loadPending() {
  loading.value = true
  try {
    rows.value = await getTigerPendingPayments()
  } catch {
    rows.value = []
  } finally {
    loading.value = false
  }
}

async function checkNext() {
  if (checking.value) return
  checking.value = true
  try {
    const result = await checkNextTigerPendingPayment()
    if (result?.checked || result?.paid) await loadPending()
  } catch {
    // รอรอบถัดไป
  } finally {
    checking.value = false
  }
}

async function mockPaid(row) {
  if (!row?.doc_no || mockingDocNo.value) return
  mockingDocNo.value = row.doc_no
  try {
    const result = await mockTigerPendingPaid({ doc_no: row.doc_no })
    if (result?.paid) {
      toast.add({ severity: 'success', summary: t('dashboard.tigerMockPaid'), detail: row.doc_no, life: 2500 })
      await loadPending()
    } else if (result?.busy) {
      toast.add({ severity: 'warn', summary: t('dashboard.tigerBusy'), detail: t('dashboard.retryAgain'), life: 2500 })
    }
  } catch (err) {
    toast.add({ severity: 'error', summary: t('dashboard.tigerMockFailed'), detail: err.message, life: 3000 })
  } finally {
    mockingDocNo.value = ''
  }
}

onMounted(async () => {
  await loadPending()
  await checkNext()
  timer = setInterval(checkNext, 9000)
})

onUnmounted(() => clearInterval(timer))
</script>

<template>
  <section v-if="rows.length || loading" class="tiger-alert">
    <div class="alert-head">
      <div>
        <div class="alert-title">
          <i class="pi pi-clock" />
          {{ t('dashboard.tigerPendingTitle') }}
        </div>
        <div class="alert-subtitle">
          {{ t('dashboard.tigerPendingSubtitle', { count: rows.length, amount: formatCurrency(totalAmount) }) }}
        </div>
      </div>
      <div class="alert-actions">
        <Button
          icon="pi pi-refresh"
          text
          rounded
          size="small"
          :loading="checking"
          :aria-label="t('dashboard.checkTigerStatus')"
          @click="checkNext"
        />
        <Button
          :label="t('dashboard.viewHistory')"
          icon="pi pi-list"
          size="small"
          severity="warning"
          outlined
          @click="router.push({ name: 'SalesHistory', query: { sale_kind: 'cash' } })"
        />
      </div>
    </div>

    <div v-if="rows.length" class="pending-list">
      <div v-for="row in rows.slice(0, 5)" :key="row.doc_no" class="pending-row">
        <div class="pending-main">
          <strong>{{ row.doc_no }}</strong>
          <span>{{ formatDate(row.doc_date) }} {{ row.doc_time || '' }}</span>
          <span class="pending-customer">{{ row.cust_name || t('sell.walkIn') }}</span>
        </div>
        <div class="pending-side">
          <span class="pending-amount">{{ formatCurrency(row.tiger_amount) }}</span>
          <span class="pending-id">{{ row.tiger_order_id }}</span>
          <Button
            v-if="TIGER_PENDING_MOCK"
            :label="t('dashboard.mockPaid')"
            icon="pi pi-check"
            size="small"
            severity="warning"
            outlined
            :loading="mockingDocNo === row.doc_no"
            :disabled="!!mockingDocNo || checking"
            @click="mockPaid(row)"
          />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.tiger-alert {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  margin-bottom: 1rem;
  border: 1px solid #fed7aa;
  border-radius: 8px;
  background: #fff7ed;
}

.alert-head {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: center;
}

.alert-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 800;
  color: #9a3412;
}

.alert-subtitle {
  margin-top: 0.25rem;
  font-size: 0.875rem;
  color: #c2410c;
}

.alert-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.pending-list {
  display: grid;
  gap: 0.5rem;
}

.pending-row {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.625rem 0.75rem;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.72);
}

.pending-main,
.pending-side {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  min-width: 0;
}

.pending-main {
  flex: 1;
}

.pending-main span,
.pending-id {
  color: #9a3412;
  font-size: 0.8125rem;
}

.pending-id {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pending-customer {
  display: block;
  min-width: 0;
  max-width: 22rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pending-amount {
  font-weight: 800;
  color: #7c2d12;
}

@media (max-width: 768px) {
  .alert-head,
  .pending-row,
  .pending-main,
  .pending-side {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
