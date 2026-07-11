<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { todayISO, toISO } from '@/utils/formatters'
import SelectButton from 'primevue/selectbutton'
import DatePicker from 'primevue/datepicker'
import InputText from 'primevue/inputtext'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import Button from 'primevue/button'
import Select from 'primevue/select'

const props = defineProps({
  initialSaleKind: { type: String, default: '' },
  allowedSaleKinds: { type: Array, default: () => ['cash', 'credit'] },
  initialFromDate: { type: String, default: '' },
  initialToDate: { type: String, default: '' },
  initialPosId: { type: String, default: '' },
  posOptions: { type: Array, default: () => [] },
})

const emit = defineEmits(['search'])
const { t } = useI18n()

function todayDate() {
  return isoToDate(todayISO()) || new Date()
}

function isoToDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d
}

const fromDate = ref(isoToDate(props.initialFromDate) || todayDate())
const toDate = ref(isoToDate(props.initialToDate) || todayDate())
const docNoText = ref('')
const searchText = ref('')
const selectedPosId = ref(String(props.initialPosId || ''))

function normalizeSaleKind(value, allowed = props.allowedSaleKinds) {
  if (['cash', 'credit'].includes(value) && allowed.includes(value)) return value
  return allowed.length === 1 ? allowed[0] : ''
}

const saleKind = ref(normalizeSaleKind(props.initialSaleKind))

const saleKindOptions = computed(() => {
  const allowed = new Set(props.allowedSaleKinds)
  const options = []
  if (allowed.has('cash') && allowed.has('credit')) options.push({ label: t('salesHistory.all'), value: '' })
  if (allowed.has('cash')) options.push({ label: t('sell.cashSale'), value: 'cash' })
  if (allowed.has('credit')) options.push({ label: t('sell.creditSale'), value: 'credit' })
  return options
})

const posFilterOptions = computed(() => [
  { label: t('salesHistory.allPos'), value: '' },
  ...props.posOptions.map((pos) => {
    const posId = String(pos.pos_id || pos.code || '').trim()
    const name = String(pos.name_1 || pos.name || '').trim()
    const machine = String(pos.machinecode || '').trim()
    const label = [machine, posId, name].filter(Boolean).join(' / ')
    return { label: label || posId || '-', value: posId }
  }).filter((pos) => pos.value),
])

function buildParams() {
  if (docNoText.value.trim()) {
    return { doc_no: docNoText.value.trim(), search: '', from_date: '', to_date: '', sale_kind: saleKind.value, pos_id: selectedPosId.value }
  }
  if (searchText.value.trim()) {
    return { doc_no: '', search: searchText.value.trim(), from_date: '', to_date: '', sale_kind: saleKind.value, pos_id: selectedPosId.value }
  }
  return {
    doc_no: '',
    search: '',
    from_date: toISO(fromDate.value) || todayISO(),
    to_date: toISO(toDate.value) || todayISO(),
    sale_kind: saleKind.value,
    pos_id: selectedPosId.value,
  }
}

function doSearch() {
  emit('search', buildParams())
}

watch(fromDate, () => { if (!docNoText.value.trim() && !searchText.value.trim()) doSearch() })
watch(toDate, () => { if (!docNoText.value.trim() && !searchText.value.trim()) doSearch() })
watch(saleKind, () => doSearch())
watch(selectedPosId, () => doSearch())

watch(() => props.initialSaleKind, (value) => {
  const nextSaleKind = normalizeSaleKind(value)
  if (saleKind.value !== nextSaleKind) saleKind.value = nextSaleKind
})

watch(() => props.allowedSaleKinds, (value) => {
  const nextSaleKind = normalizeSaleKind(saleKind.value, value)
  if (saleKind.value !== nextSaleKind) saleKind.value = nextSaleKind
})

watch(() => props.initialPosId, (value) => {
  const nextPosId = String(value || '')
  if (selectedPosId.value !== nextPosId) selectedPosId.value = nextPosId
})

function onSearchInput(e) {
  if (!e.target.value.trim() && !docNoText.value.trim()) doSearch()
}

function onDocNoInput(e) {
  if (!e.target.value.trim() && !searchText.value.trim()) doSearch()
}

defineExpose({ initialSearch: doSearch })
</script>

<template>
  <div class="filter-bar">
    <div class="filter-row">
      <div class="date-range-group">
        <DatePicker
          v-model="fromDate"
          :manual-input="false"
          date-format="dd/mm/yy"
          :placeholder="t('salesHistory.fromDate')"
          show-icon
          class="date-picker"
        />
        <span class="date-sep">–</span>
        <DatePicker
          v-model="toDate"
          :manual-input="false"
          date-format="dd/mm/yy"
          :placeholder="t('salesHistory.toDate')"
          show-icon
          class="date-picker"
        />
      </div>

      <Select
        v-model="selectedPosId"
        :options="posFilterOptions"
        option-label="label"
        option-value="value"
        :placeholder="t('salesHistory.posMachine')"
        class="pos-filter"
      />

      <IconField class="search-field">
        <InputIcon class="pi pi-search" />
        <InputText
          v-model="docNoText"
          :placeholder="t('salesHistory.docNo')"
          @input="onDocNoInput"
          @keyup.enter="doSearch"
        />
      </IconField>

      <IconField class="search-field general-search-field">
        <InputIcon class="pi pi-search" />
        <InputText
          v-model="searchText"
          :placeholder="`${t('salesHistory.customer')} / ${t('salesHistory.creator')}`"
          @input="onSearchInput"
          @keyup.enter="doSearch"
        />
      </IconField>

      <Button icon="pi pi-search" :label="t('common.search')" @click="doSearch" />

      <SelectButton
        v-model="saleKind"
        :options="saleKindOptions"
        option-label="label"
        option-value="value"
        :allow-empty="false"
        class="sale-kind-filter"
      />
    </div>
  </div>
</template>

<style scoped>
.filter-bar {
  padding: 0.75rem 1rem;
  background: var(--p-surface-card);
  border-radius: 8px;
  border: 1px solid var(--p-surface-border);
}

.filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: center;
}

.date-range-group {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.date-picker {
  width: 150px;
}

.date-sep {
  color: var(--p-text-color-secondary);
  font-weight: 600;
  flex-shrink: 0;
}

.search-field {
  flex: 0 1 230px;
  min-width: 180px;
}

.pos-filter {
  flex: 0 1 220px;
  min-width: 180px;
}

.search-field :deep(input) {
  width: 100%;
}

.general-search-field {
  flex: 1 1 280px;
}

.sale-kind-filter {
  margin-left: auto;
}

@media (max-width: 768px) {
  .filter-bar {
    padding: 0.65rem;
  }

  .filter-row {
    gap: 0.5rem;
  }

  .date-range-group {
    width: 100%;
  }

  .date-picker {
    flex: 1;
    width: auto;
  }

  .search-field {
    flex: 1;
    min-width: 0;
  }

  .pos-filter {
    flex: 1;
    min-width: 0;
  }

  .sale-kind-filter {
    margin-left: 0;
  }

  .sale-kind-filter :deep(.p-button) {
    padding: 0.4rem 0.6rem;
    font-size: 0.8rem;
  }
}

@media (max-width: 480px) {
  .filter-row {
    flex-direction: column;
    align-items: stretch;
  }

  .sale-kind-filter :deep(.p-button) {
    padding: 0.35rem 0.5rem;
    font-size: 0.75rem;
  }
}
</style>
