<script setup>
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { usePosStore } from '@/stores/pos'
import { APP_NAV_ITEMS } from '@/config/navigation'

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const authStore = useAuthStore()
const posStore = usePosStore()

const visibleMenuItems = computed(() => APP_NAV_ITEMS.filter((item) => (
  item.permissionsAny ? authStore.hasAnyPermission(item.permissionsAny) : authStore.hasPermission(item.permission)
)))

function navigate(to) {
  router.push(to)
}

function logout() {
  authStore.logout()
  posStore.clearPos()
  router.push('/login')
}
</script>

<template>
  <nav class="sidebar-nav">
    <ul class="sidebar-menu">
      <li
        v-for="item in visibleMenuItems"
        :key="item.to"
        class="sidebar-item"
        :class="{ active: item.base ? route.path.startsWith(item.base) : route.path === item.to }"
        @click="navigate(item.to)"
      >
        <i :class="item.icon" />
        <span>{{ item.labelKey ? t(item.labelKey) : item.label }}</span>
      </li>
    </ul>

    <div class="sidebar-footer">
      <div class="sidebar-item logout" @click="logout">
        <i class="pi pi-sign-out" />
        <span>{{ t('common.logout') }}</span>
      </div>
    </div>
  </nav>
</template>

<style scoped>
.sidebar-nav {
  width: 264px;
  background: linear-gradient(180deg, #fffdf8 0%, #fff7ed 100%);
  border-right: 1px solid #fed7aa;
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 0.75rem 0.625rem;
  box-shadow: 10px 0 24px rgba(249, 115, 22, 0.08);
}

.sidebar-menu {
  list-style: none;
  margin: 0;
  padding: 0;
  flex: 1;
}

.sidebar-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 0.875rem;
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: 8px;
  margin: 0.125rem 0;
  color: #7c5740;
  transition: background 0.15s, border-color 0.15s, color 0.15s, transform 0.15s;
  font-size: 0.9375rem;
  min-height: 42px;
}

.sidebar-item i {
  width: 1.25rem;
  text-align: center;
  flex-shrink: 0;
  color: #c2410c;
}

.sidebar-item:hover {
  border-color: #fed7aa;
  background: #ffffff;
  color: #1f2937;
  transform: translateX(2px);
}

.sidebar-item.active {
  border-color: transparent;
  background: linear-gradient(135deg, #ff8a00 0%, #ff3d00 100%);
  color: #ffffff;
  font-weight: 900;
  box-shadow: 0 10px 20px rgba(249, 115, 22, 0.22);
}

.sidebar-item.active i {
  color: #ffffff;
}

.sidebar-footer {
  padding-top: 0.625rem;
  border-top: 1px solid #fed7aa;
}

.sidebar-item.logout {
  color: #9f1239;
}

.sidebar-item.logout i {
  color: #e11d48;
}

.sidebar-item.logout:hover {
  border-color: #fecdd3;
  color: #be123c;
  background: #fff1f2;
}
</style>
