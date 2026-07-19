<script setup>
import LanguageSwitcher from '@/components/common/LanguageSwitcher.vue'
import ServiceEndpointSettings from '@/components/common/ServiceEndpointSettings.vue'
</script>

<template>
  <div class="auth-wrapper">
    <div class="auth-toolbar">
      <ServiceEndpointSettings />
      <LanguageSwitcher />
    </div>
    <slot />
  </div>
</template>

<style scoped>
.auth-wrapper {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #eff6ff 0%, #f8fbff 45%, #ffffff 100%);
  padding: 1rem;
}

.auth-toolbar {
  position: fixed;
  top: 1rem;
  right: 1rem;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem;
  border: 1px solid #bae6fd;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.86);
  box-shadow: 0 10px 24px rgba(249, 115, 22, 0.12);
}

@media (max-width: 480px) {
  .auth-toolbar {
    top: 0.75rem;
    right: 0.75rem;
    left: 0.75rem;
    justify-content: flex-end;
  }
}
</style>
