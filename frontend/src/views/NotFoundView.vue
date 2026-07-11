<script setup>
import { useRouter } from 'vue-router'
import Button from 'primevue/button'

const router = useRouter()
</script>

<template>
  <div class="not-found">
    <span class="not-found-code">404</span>
    <h2>ไม่พบหน้าที่ต้องการ</h2>
    <Button label="กลับหน้าหลัก" icon="pi pi-home" @click="router.push('/dashboard')" />
  </div>
</template>

<style scoped>
.not-found {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 50vh;
  gap: 1rem;
}

.not-found-code {
  font-size: 5rem;
  font-weight: 900;
  color: var(--p-surface-300);
  line-height: 1;
}

h2 {
  margin: 0;
  color: var(--p-text-color-secondary);
}
</style>
