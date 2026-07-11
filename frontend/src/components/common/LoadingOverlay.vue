<script setup>
defineProps({ message: { type: String, default: 'กำลังโหลด...' } })
</script>

<template>
  <div class="loading-overlay">
    <div class="loading-content">
      <i class="pi pi-spin pi-spinner loading-icon" />
      <span>{{ message }}</span>
    </div>
  </div>
</template>

<style scoped>
.loading-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.loading-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  background: var(--p-surface-card);
  padding: 2rem;
  border-radius: 12px;
  color: var(--p-text-color);
}

.loading-icon {
  font-size: 2rem;
  color: var(--p-primary-color);
}
</style>
