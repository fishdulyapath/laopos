<script setup>
import { ref, watch } from 'vue'
import { getCustomerList } from '@/services/sellService'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import Skeleton from 'primevue/skeleton'

const emit = defineEmits(['select'])

const search = ref('')
const loading = ref(false)
const customers = ref([])
let debounceTimer = null

watch(search, (val) => {
  clearTimeout(debounceTimer)
  if (!val.trim()) { customers.value = []; return }
  debounceTimer = setTimeout(() => fetchCustomers(val.trim()), 300)
})

async function fetchCustomers(q) {
  loading.value = true
  try {
    customers.value = await getCustomerList(q)
  } catch {
    customers.value = []
  } finally {
    loading.value = false
  }
}

function selectWalkIn() {
  emit('select', { code: '', name: 'ลูกค้าทั่วไป' })
}

function selectCustomer(c) {
  emit('select', { code: c.code, name: c.name, member_code: c.member_code || '' })
}
</script>

<template>
  <div class="customer-step">
    <div class="step-header">
      <i class="pi pi-user step-icon" />
      <h2 class="step-title">เลือกลูกค้า</h2>
    </div>

    <Button
      label="ลูกค้าทั่วไป"
      icon="pi pi-user"
      size="large"
      class="walkin-btn"
      @click="selectWalkIn"
    />

    <div class="divider-row">
      <span class="divider-line" />
      <span class="divider-text">หรือค้นหาลูกค้า</span>
      <span class="divider-line" />
    </div>

    <div class="search-wrap">
      <InputText
        v-model="search"
        placeholder="รหัสลูกค้า / ชื่อลูกค้า / รหัสสมาชิก / เบอร์สมาชิก..."
        class="search-input"
        autofocus
      />
    </div>

    <div class="customer-list">
      <template v-if="loading">
        <div v-for="n in 4" :key="n" class="customer-skeleton">
          <Skeleton width="8rem" height="0.875rem" />
          <Skeleton width="12rem" height="0.75rem" class="mt-1" />
        </div>
      </template>

      <template v-else-if="customers.length > 0">
        <button
          v-for="c in customers"
          :key="c.row_key || `${c.code || ''}|${c.member_code || ''}|${c.mobile_phone || ''}`"
          class="customer-item"
          @click="selectCustomer(c)"
        >
          <div class="customer-avatar">{{ (c.name || c.code).charAt(0).toUpperCase() }}</div>
          <div class="customer-info">
            <span class="customer-name">{{ c.name }}</span>
            <span class="customer-meta">
              {{ c.code }}<template v-if="c.member_code"> / {{ c.member_code }}</template><template v-if="c.mobile_phone || c.telephone"> · {{ c.mobile_phone || c.telephone }}</template>
            </span>
          </div>
          <i class="pi pi-angle-right customer-arrow" />
        </button>
      </template>

      <div v-else-if="search.trim() && !loading" class="customer-empty">
        ไม่พบลูกค้า "{{ search }}"
      </div>
    </div>
  </div>
</template>

<style scoped>
.customer-step {
  max-width: 540px;
  margin: 0 auto;
  padding: 1.5rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.step-header {
  display: flex;
  align-items: center;
  gap: 0.625rem;
}

.step-icon {
  font-size: 1.375rem;
  color: var(--p-primary-color);
}

.step-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
}

.walkin-btn {
  width: 100%;
  justify-content: center;
  font-size: 1.0625rem;
  padding: 0.875rem;
}

.divider-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.divider-line {
  flex: 1;
  height: 1px;
  background: var(--p-surface-border);
}

.divider-text {
  font-size: 0.75rem;
  color: var(--p-text-color-secondary);
  white-space: nowrap;
}

.search-wrap {
  width: 100%;
}

.search-input {
  width: 100%;
}

.customer-list {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  max-height: 360px;
  overflow-y: auto;
}

.customer-skeleton {
  padding: 0.625rem 0.75rem;
  border-radius: 8px;
  background: var(--p-surface-ground);
}

.mt-1 { margin-top: 0.25rem; }

.customer-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 0.75rem;
  border-radius: 8px;
  border: none;
  background: var(--p-surface-ground);
  cursor: pointer;
  text-align: left;
  width: 100%;
  transition: background 0.12s;
}

.customer-item:hover {
  background: var(--p-surface-hover);
}

.customer-avatar {
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 50%;
  background: var(--p-primary-color);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9375rem;
  font-weight: 700;
  flex-shrink: 0;
}

.customer-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.customer-name {
  font-size: 0.9375rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.customer-meta {
  font-size: 0.75rem;
  color: var(--p-text-color-secondary);
}

.customer-arrow {
  color: var(--p-text-color-secondary);
  font-size: 0.875rem;
  flex-shrink: 0;
}

.customer-empty {
  text-align: center;
  padding: 1.5rem 0;
  font-size: 0.875rem;
  color: var(--p-text-color-secondary);
}
</style>
