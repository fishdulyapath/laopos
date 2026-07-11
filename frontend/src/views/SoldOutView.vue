<script setup>
import { ref, watch, onMounted } from 'vue'
import { getDashboardSoldOut } from '@/services/salesService'
import { formatNumber, toISO } from '@/utils/formatters'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import DatePicker from 'primevue/datepicker'
import Skeleton from 'primevue/skeleton'

const selectedDate = ref(new Date())
const loading = ref(false)
const rows = ref([])

async function load() {
  loading.value = true
  try {
    rows.value = await getDashboardSoldOut(toISO(selectedDate.value))
  } catch {
    rows.value = []
  } finally {
    loading.value = false
  }
}

watch(selectedDate, (val) => {
  if (val) load()
})

onMounted(load)
</script>

<template>
  <div class="soldout-page biz-page">
    <div class="biz-page-header">
      <div class="biz-page-title-wrap">
        <i class="pi pi-exclamation-circle biz-page-icon danger-icon" />
        <div>
          <h1 class="biz-page-title">สินค้าขายหมด</h1>
          <p class="biz-page-subtitle">ติดตามสินค้าที่คงเหลือไม่พอขายตามวันที่เลือก</p>
        </div>
      </div>
      <DatePicker
        v-model="selectedDate"
        date-format="dd/mm/yy"
        :manual-input="false"
        show-icon
        class="date-picker"
      />
    </div>

    <div v-if="loading" class="skeleton-wrap">
      <Skeleton v-for="n in 8" :key="n" height="2.5rem" class="mb-2" />
    </div>

    <div v-else-if="rows.length === 0" class="empty-state biz-empty-state">
      <i class="pi pi-check-circle empty-icon" />
      <p>ไม่มีสินค้าขายหมดในวันที่เลือก</p>
    </div>

    <DataTable
      v-else
      :value="rows"
      striped-rows
      size="small"
      class="soldout-table biz-data-surface"
    >
      <Column field="item_code" header="รหัสสินค้า" style="width: 140px" />
      <Column field="item_name" header="ชื่อสินค้า" />
      <Column header="หน่วย" style="width: 90px">
        <template #body="{ data }">
          {{ data.unit_name || data.unit_code }}
        </template>
      </Column>
      <Column header="จำนวนในคลัง" style="width: 130px; text-align: right">
        <template #body="{ data }">
          <span class="num-cell">{{ formatNumber(data.stock_qty) }}</span>
        </template>
      </Column>
      <Column header="จำนวนในตะกร้า" style="width: 130px; text-align: right">
        <template #body="{ data }">
          <span class="num-cell">{{ formatNumber(data.cart_qty) }}</span>
        </template>
      </Column>
      <Column header="คงเหลือ" style="width: 110px; text-align: right">
        <template #body="{ data }">
          <span class="num-cell remaining">{{ formatNumber(data.remaining_qty) }}</span>
        </template>
      </Column>
    </DataTable>
  </div>
</template>

<style scoped>
.soldout-page {
  padding: 0;
}

.danger-icon {
  background: color-mix(in srgb, var(--p-red-500) 10%, var(--p-surface-0));
  color: var(--p-red-500);
}

.date-picker {
  width: 180px;
}

.mb-2 { margin-bottom: 0.5rem; }

.skeleton-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.empty-state {
  padding: 4rem 0;
}

.empty-icon {
  font-size: 2.5rem;
  color: var(--p-green-500);
}

.empty-state p {
  margin: 0;
  font-size: 1rem;
}

.soldout-table {
  width: 100%;
}

.num-cell {
  display: block;
  text-align: right;
}

.remaining {
  font-weight: 600;
  color: var(--p-red-500);
}
</style>
