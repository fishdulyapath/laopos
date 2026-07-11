<script setup>
import { computed, onMounted, onActivated } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePosStore } from '@/stores/pos'
import { useAuthStore } from '@/stores/auth'
import { PERMISSIONS } from '@/utils/permissions'
import PosInfoCard from '@/components/dashboard/PosInfoCard.vue'
import SalesSummaryCard from '@/components/dashboard/SalesSummaryCard.vue'
import TopProductsCard from '@/components/dashboard/TopProductsCard.vue'
import TopCustomersCard from '@/components/dashboard/TopCustomersCard.vue'
import TopSalesmenCard from '@/components/dashboard/TopSalesmenCard.vue'
import AppUpdateStatus from '@/components/common/AppUpdateStatus.vue'


const posStore = usePosStore()
const authStore = useAuthStore()
const { t } = useI18n()

const canViewTodaySales = computed(() => authStore.hasPermission(PERMISSIONS.dashboardTodaySales))
const canViewMonthlySummary = computed(() => authStore.hasPermission(PERMISSIONS.dashboardMonthlySummary))

async function refresh() {
  try { await posStore.refreshErpOption() } catch {}
}

onMounted(refresh)
onActivated(refresh)
</script>

<template>
  <div class="dashboard biz-page">


    <div class="biz-page-header">
      <div class="biz-page-title-wrap">
        <i class="pi pi-home biz-page-icon" />
        <div>
          <h1 class="biz-page-title">{{ t('dashboard.title') }}</h1>
          <p class="biz-page-subtitle">{{ t('dashboard.subtitle') }}</p>
        </div>
      </div>
      <AppUpdateStatus class="dashboard-update-status" align="right" />
    </div>
    <!-- row 1: POS info + ยอดขายวันนี้ -->
    <div class="dashboard-grid top-grid" :class="{ 'has-today-sales': canViewTodaySales }">
      <PosInfoCard />
      <!-- <SalesSummaryCard v-if="canViewTodaySales" /> -->
    </div>

    <!-- row 2: ranking cards -->
    <!-- <p v-if="canViewMonthlySummary" class="section-label">
      <i class="pi pi-chart-bar" />
      {{ t('dashboard.monthlySummary') }}
    </p>
    <div v-if="canViewMonthlySummary" class="dashboard-grid rank-grid">
      <TopProductsCard />
      <TopCustomersCard />
      <TopSalesmenCard />
    </div> -->
  </div>
</template>

<style scoped>
.dashboard {
  width: 100%;
  max-width: 100%;
  gap: 0.75rem;
  overflow-x: hidden;
}

.dashboard :deep(.p-card-body) {
  padding: 0.75rem;
}

.dashboard :deep(.p-card-title) {
  margin-bottom: 0.625rem;
}

.dashboard .biz-page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-shrink: 0;
  padding: 0.75rem 0.875rem;
}

.dashboard-update-status {
  flex: 0 1 auto;
}

/* ─── section divider label ──────────────────────────────── */
.section-label {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--p-text-color-secondary);
  margin: 0;
}

/* ─── shared grid wrapper ────────────────────────────────── */
.dashboard-grid {
  display: grid;
  min-height: 0;
  gap: 0.75rem;
}

/* ─── row 1: PosInfo + ยอดขายวันนี้ ────────────────────── */
.top-grid {
  grid-template-columns: minmax(280px, 1fr);
  flex: 0 0 auto;
  align-items: stretch;
  min-height: 0;
}

.top-grid.has-today-sales {
  grid-template-columns: minmax(280px, 0.8fr) minmax(0, 1.2fr);
}

.top-grid > * {
  height: 100%;
}

.top-grid :deep(.p-card) {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
  box-shadow: var(--app-card-shadow);
}

.top-grid :deep(.p-card-body) {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.top-grid :deep(.p-card-content) {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* ─── row 2: three equal columns ────────────────────────── */
.rank-grid {
  flex: 0 0 auto;
  grid-template-columns: repeat(3, 1fr);
  overflow: visible;
}

.rank-grid :deep(.p-card),
.rank-grid :deep(.p-card-body),
.rank-grid :deep(.p-card-content) {
  min-height: 0;
}

.rank-grid :deep(.p-card) {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.rank-grid :deep(.p-card-body),
.rank-grid :deep(.p-card-content) {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.rank-grid :deep(.rank-list),
.top-grid :deep(.rank-list) {
  min-height: 0;
  gap: 0.375rem;
}

.rank-grid :deep(.rank-list) {
  flex: 1;
  padding-right: 0.125rem;
}

.rank-grid :deep(.empty-msg) {
  flex: 1;
  min-height: 0;
}

.rank-grid :deep(.rank-item),
.top-grid :deep(.rank-item) {
  padding: 0.42rem 0.55rem;
}

@media (max-width: 1199px) {
  .top-grid.has-today-sales {
    grid-template-columns: minmax(260px, 0.85fr) minmax(0, 1.15fr);
  }
}

/* ─── collapse to single column on mobile ────────────────── */
@media (max-width: 767px) {
  .dashboard .biz-page-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .dashboard-update-status {
    align-self: stretch;
    justify-content: flex-start;
  }

  .top-grid,
  .rank-grid {
    grid-template-columns: 1fr;
    overflow: visible;
  }
}
</style>
