<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import Toast from 'primevue/toast'
import ConfirmDialog from 'primevue/confirmdialog'
import AuthLayout from '@/layouts/AuthLayout.vue'
import AppLayout from '@/layouts/AppLayout.vue'
import BlankLayout from '@/layouts/BlankLayout.vue'
import ScreenFontSizeShortcut from '@/components/common/ScreenFontSizeShortcut.vue'

const route = useRoute()

const layout = computed(() => {
  if (route.meta.layout === 'AuthLayout') return AuthLayout
  if (route.meta.layout === 'BlankLayout') return BlankLayout
  if (route.meta.layout === 'AppLayout') return AppLayout
  return AppLayout
})

const routeViewKey = computed(() => (route.name === 'Sell' ? route.fullPath : route.name || route.fullPath))
</script>

<template>
  <div>
    <component :is="layout">
      <router-view :key="routeViewKey" />
    </component>
    <Toast />
    <ConfirmDialog />
    <ScreenFontSizeShortcut />
  </div>
</template>
