<script setup>
import { computed, ref } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import AppTopbar from "@/components/common/AppTopbar.vue";
import Drawer from "primevue/drawer";
import { useAuthStore } from "@/stores/auth";
import { usePosStore } from "@/stores/pos";
import { APP_NAME } from "@/config/app";
import { APP_NAV_ITEMS } from "@/config/navigation";

const router = useRouter();
const route = useRoute();
const { t } = useI18n();
const authStore = useAuthStore();
const posStore = usePosStore();

const drawerOpen = ref(false);

const visibleNavItems = computed(() => APP_NAV_ITEMS.filter((item) => (
  item.permissionsAny ? authStore.hasAnyPermission(item.permissionsAny) : authStore.hasPermission(item.permission)
)));

function navigate(to) {
  router.push(to);
  drawerOpen.value = false;
}

function logout() {
  drawerOpen.value = false;
  authStore.logout();
  posStore.clearPos();
  router.push("/login");
}
</script>

<template>
  <div class="app-layout">
    <AppTopbar @menu-click="drawerOpen = true" />

    <div class="app-body">
      <main class="layout-main">
        <div class="layout-content" data-font-zone="screen">
          <slot />
        </div>
      </main>
    </div>

    <Drawer :visible="drawerOpen" position="left" :pt="{ root: { class: 'app-nav-drawer' } }" @update:visible="drawerOpen = $event">
      <template #header>
        <span class="drawer-title" data-font-zone="menu-drawer">ສັນຕິພາບ POS</span>
      </template>
      <!-- ข้อมูลผู้ใช้ + POS -->
      <div class="drawer-user-card" data-font-zone="menu-drawer">
        <div class="drawer-user-row">
          <i class="pi pi-user drawer-user-icon" />
          <div class="drawer-user-info">
            <div class="drawer-user-name">{{ authStore.employee?.user_name || "-" }}</div>
            <div class="drawer-user-code">{{ authStore.employee?.user_code || "" }}</div>
          </div>
        </div>
        <div class="drawer-pos-row">
          <i class="pi pi-desktop drawer-pos-icon" />
          <span class="drawer-pos-label">{{ t("pos.machine") }}</span>
          <span class="drawer-pos-value">{{ posStore.posId || "-" }}</span>
          <button class="drawer-change-pos" @click="navigate('/select-pos?change=true')">{{ t("common.change") }}</button>
        </div>
      </div>

      <div class="drawer-divider" />

      <nav class="drawer-nav" data-font-zone="menu-drawer">
        <button v-for="item in visibleNavItems" :key="item.to" class="drawer-nav-item" :class="{ active: item.base ? route.path.startsWith(item.base) : route.path === item.to }" @click="navigate(item.to)">
          <i :class="item.icon" class="nav-icon" />
          <span class="nav-label">{{ item.labelKey ? t(item.labelKey) : item.label }}</span>
        </button>

        <div class="drawer-divider" />

        <button class="drawer-nav-item logout-item" @click="logout">
          <i class="pi pi-sign-out nav-icon" />
          <span class="nav-label">{{ t("common.logout") }}</span>
        </button>
      </nav>

      <div class="drawer-footer" data-font-zone="menu-drawer">
        <span class="drawer-powered-by">Powered by FishSoft</span>
      </div>
    </Drawer>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background: #fff7ed;
}

.app-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.layout-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.layout-content {
  flex: 1;
  min-height: 0;
  padding: 0.3rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

@media (max-width: 767px) {
  .layout-content {
    padding: 0.875rem;
  }
}

@media (min-width: 768px) and (max-width: 1180px) {
  .layout-content {
    padding: 1rem;
  }
}

/* Drawer content styles (global because Drawer teleports out) */
.drawer-title {
  font-size: 1.05em;
  font-weight: 900;
  color: #c2410c;
}

.drawer-user-card {
  padding: 0.75rem 0.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border: 1px solid #fed7aa;
  border-radius: 8px;
  background: linear-gradient(180deg, #fff7ed 0%, #ffffff 100%);
}

.drawer-user-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.drawer-user-icon {
  font-size: 1.1em;
  color: #f15a00;
  width: 1.25rem;
  text-align: center;
  flex-shrink: 0;
}

.drawer-user-info {
  min-width: 0;
}

.drawer-user-name {
  font-size: 0.9em;
  font-weight: 800;
  color: #1f2937;
  line-height: 1.3;
}

.drawer-user-code {
  font-size: 0.75em;
  color: #7c5740;
}

.drawer-pos-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.drawer-pos-icon {
  font-size: 0.9em;
  color: #c2410c;
  width: 1.25rem;
  text-align: center;
  flex-shrink: 0;
}

.drawer-pos-label {
  font-size: 0.8em;
  color: #7c5740;
}

.drawer-pos-value {
  font-size: 0.8em;
  font-weight: 800;
  color: #1f2937;
}

.drawer-change-pos {
  margin-left: auto;
  border: 1px solid #fdba74;
  background: #fff7ed;
  color: #c2410c;
  font-size: 0.75em;
  font-family: inherit;
  padding: 0.2rem 0.625rem;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.12s;
  -webkit-tap-highlight-color: transparent;
}

.drawer-change-pos:hover {
  border-color: #fb923c;
  background: #ffedd5;
}

.drawer-nav {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.5rem 0;
}

.drawer-nav-item {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  width: 100%;
  padding: 0.75rem 1rem;
  border: 1px solid transparent;
  background: none;
  border-radius: 8px;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.9em;
  color: #7c5740;
  text-align: left;
  transition: background 0.12s;
  -webkit-tap-highlight-color: transparent;
}

.drawer-nav-item:hover {
  border-color: #fed7aa;
  background: #fff7ed;
  color: #1f2937;
}

.drawer-nav-item.active {
  border-color: transparent;
  background: linear-gradient(135deg, #ff8a00 0%, #ff3d00 100%);
  color: #ffffff;
  font-weight: 900;
  box-shadow: 0 10px 20px rgba(249, 115, 22, 0.22);
}

.nav-icon {
  font-size: 1.1em;
  width: 1.25rem;
  text-align: center;
  flex-shrink: 0;
}

.drawer-divider {
  height: 1px;
  background: #fed7aa;
  margin: 0.5rem 0;
}

.logout-item {
  color: #dc2626;
}

.logout-item:hover {
  border-color: #fecdd3;
  background: #fff1f2;
}

.drawer-footer {
  margin-top: auto;
  padding: 1rem 0.5rem 0.5rem;
  text-align: center;
}

.drawer-powered-by {
  font-size: 0.7em;
  color: #9a3412;
  opacity: 0.6;
}
</style>
