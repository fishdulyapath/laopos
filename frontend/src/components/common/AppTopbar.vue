<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { usePosStore } from '@/stores/pos'
import Avatar from 'primevue/avatar'
import Tag from 'primevue/tag'
import Menu from 'primevue/menu'
import { APP_NAME } from '@/config/app'
import LanguageSwitcher from '@/components/common/LanguageSwitcher.vue'

const router = useRouter()
const route = useRoute()
const { t, locale } = useI18n()
const authStore = useAuthStore()
const posStore = usePosStore()

const emit = defineEmits(['menu-click'])

const menu = ref(null)
const fullscreenActive = ref(false)
const customerDisplayOpen = ref(false)
const customerDisplayBusy = ref(false)
const saleLayoutPreferenceKey = 'bizsuit_sell_layout_preferences_v1'
const saleLayoutPreferenceEvent = 'bizsuit:sale-layout-preferences'
let unsubscribeCustomerDisplayStatus = null
const showSaleLayoutControls = computed(() => route.name === 'Sell')
const customerDisplayAvailable = computed(() => (
  typeof window !== 'undefined' && !!window.bizsuitCustomerDisplay?.open
))
const menuItems = computed(() => [
  {
    label: t('pos.changeTitle'),
    icon: 'pi pi-desktop',
    command: () => router.push('/select-pos?change=true'),
  },
  { separator: true },
  {
    label: t('common.logout'),
    icon: 'pi pi-sign-out',
    command: () => {
      authStore.logout()
      posStore.clearPos()
      router.push('/login')
    },
  },
])

const initials = computed(() => {
  const name = authStore.employee?.user_name || ''
  return name.slice(0, 2) || 'U'
})

function tl(th, en, lo = en) {
  const lang = String(locale.value || 'th').toLowerCase()
  if (lang.startsWith('en')) return en
  if (lang.startsWith('lo')) return lo
  return th
}

function toNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function readSaleLayoutPreferences() {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(window.localStorage.getItem(saleLayoutPreferenceKey) || '{}')
  } catch {
    return {}
  }
}

const saleLayoutPreferences = readSaleLayoutPreferences()
const saleFontScale = ref(
  Math.min(1.8, Math.max(0.88, toNumber(saleLayoutPreferences.fontScale, 1)))
)
const saleDensity = ref(
  ['compact', 'normal', 'comfortable'].includes(saleLayoutPreferences.density)
    ? saleLayoutPreferences.density
    : 'normal'
)
const saleFontScaleLabel = computed(() => `${Math.round(saleFontScale.value * 100)}%`)
const saleDensityLabel = computed(() => {
  if (saleDensity.value === 'compact') return tl('กระชับ', 'Compact', 'ກະຊັບ')
  if (saleDensity.value === 'comfortable') return tl('สบายตา', 'Comfort', 'ສະບາຍຕາ')
  return tl('ปกติ', 'Normal', 'ປົກກະຕິ')
})

function saveSaleLayoutPreferences() {
  const preferences = {
    fontScale: saleFontScale.value,
    density: saleDensity.value,
  }
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(saleLayoutPreferenceKey, JSON.stringify(preferences))
    window.dispatchEvent(new CustomEvent(saleLayoutPreferenceEvent, { detail: preferences }))
  } catch {}
}

function setSaleFontScale(value) {
  saleFontScale.value = Math.min(1.8, Math.max(0.88, Math.round(value * 100) / 100))
  saveSaleLayoutPreferences()
}

function resetSaleLayoutScale() {
  saleFontScale.value = 1
  saleDensity.value = 'normal'
  saveSaleLayoutPreferences()
}

function cycleSaleDensity() {
  const next = {
    compact: 'normal',
    normal: 'comfortable',
    comfortable: 'compact',
  }
  saleDensity.value = next[saleDensity.value] || 'normal'
  saveSaleLayoutPreferences()
}

function currentFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null
}

function syncFullscreenState() {
  fullscreenActive.value = !!currentFullscreenElement()
}

async function toggleFullscreen() {
  const root = document.documentElement
  try {
    if (currentFullscreenElement()) {
      if (document.exitFullscreen) await document.exitFullscreen()
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen()
    } else if (root.requestFullscreen) {
      await root.requestFullscreen()
    } else if (root.webkitRequestFullscreen) {
      root.webkitRequestFullscreen()
    }
  } catch {
    // Browser blocked fullscreen request; keep current state.
  } finally {
    syncFullscreenState()
  }
}

async function syncCustomerDisplayStatus() {
  if (!customerDisplayAvailable.value || !window.bizsuitCustomerDisplay?.status) {
    customerDisplayOpen.value = false
    return
  }

  try {
    const status = await window.bizsuitCustomerDisplay.status()
    customerDisplayOpen.value = !!status?.open
  } catch {
    customerDisplayOpen.value = false
  }
}

async function toggleCustomerDisplay() {
  if (!customerDisplayAvailable.value || customerDisplayBusy.value) return
  customerDisplayBusy.value = true

  try {
    if (customerDisplayOpen.value) {
      await window.bizsuitCustomerDisplay.close()
      customerDisplayOpen.value = false
    } else {
      await window.bizsuitCustomerDisplay.open()
      customerDisplayOpen.value = true
    }
  } catch {
    await syncCustomerDisplayStatus()
  } finally {
    customerDisplayBusy.value = false
  }
}

onMounted(() => {
  syncFullscreenState()
  document.addEventListener('fullscreenchange', syncFullscreenState)
  document.addEventListener('webkitfullscreenchange', syncFullscreenState)
  void syncCustomerDisplayStatus()
  unsubscribeCustomerDisplayStatus = window.bizsuitCustomerDisplay?.onStatus?.((status) => {
    customerDisplayOpen.value = !!status?.open
  }) || null
})

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', syncFullscreenState)
  document.removeEventListener('webkitfullscreenchange', syncFullscreenState)
  if (typeof unsubscribeCustomerDisplayStatus === 'function') {
    unsubscribeCustomerDisplayStatus()
    unsubscribeCustomerDisplayStatus = null
  }
})

function toggleMenu(event) {
  menu.value.toggle(event)
}
</script>

<template>
  <header class="topbar" data-font-zone="appbar">
    <div class="topbar-left">
      <button class="hamburger" :aria-label="t('common.menu')" @click="emit('menu-click')">
        <i class="pi pi-bars" />
      </button>
      <img src="@/assets/santipab.png" class="topbar-logo" alt="Santipab Logo" />
      <span class="topbar-brand">
        <span>ສັນຕິພາບ</span>
        <strong>POS</strong>
      </span>
    </div>

    <div class="topbar-right">
      <div
        v-if="showSaleLayoutControls"
        class="sale-layout-controls"
        data-font-zone="main-menu"
        role="group"
        :aria-label="tl('ปรับหน้าจอขาย', 'Adjust sale screen', 'ປັບໜ້າຈໍຂາຍ')"
      >
        <button
          type="button"
          class="layout-icon-button"
          :aria-label="tl('ลดขนาดตัวหนังสือ', 'Decrease font size', 'ຫຼຸດຂະໜາດຕົວໜັງສື')"
          @click="setSaleFontScale(saleFontScale - 0.05)"
        >
          A-
        </button>
        <button
          type="button"
          class="layout-scale-button"
          :aria-label="tl('รีเซ็ตขนาดหน้าจอ', 'Reset screen size', 'ຣີເຊັດຂະໜາດໜ້າຈໍ')"
          @click="resetSaleLayoutScale"
        >
          {{ saleFontScaleLabel }}
        </button>
        <button
          type="button"
          class="layout-icon-button"
          :aria-label="tl('เพิ่มขนาดตัวหนังสือ', 'Increase font size', 'ເພີ່ມຂະໜາດຕົວໜັງສື')"
          @click="setSaleFontScale(saleFontScale + 0.05)"
        >
          A+
        </button>
        <!-- <button
          type="button"
          class="layout-density-button"
          :aria-label="tl('เปลี่ยนความแน่นหน้าจอ', 'Change screen density', 'ປ່ຽນຄວາມແໜ້ນໜ້າຈໍ')"
          @click="cycleSaleDensity"
        >
          <i class="pi pi-table" />
          <span>{{ saleDensityLabel }}</span>
        </button> -->
      </div>
      <Tag v-if="posStore.posId" :value="posStore.posId" severity="info" class="pos-tag" />
      <LanguageSwitcher class="topbar-language" />
      <button
        v-if="customerDisplayAvailable"
        class="topbar-icon-btn customer-display-btn"
        :class="{ active: customerDisplayOpen }"
        type="button"
        :aria-label="customerDisplayOpen ? tl('ปิดจอลูกค้า', 'Close customer display', 'ປິດຈໍລູກຄ້າ') : tl('เปิดจอลูกค้า', 'Open customer display', 'ເປີດຈໍລູກຄ້າ')"
        :title="customerDisplayOpen ? tl('ปิดจอลูกค้า', 'Close customer display', 'ປິດຈໍລູກຄ້າ') : tl('เปิดจอลูกค้า', 'Open customer display', 'ເປີດຈໍລູກຄ້າ')"
        :disabled="customerDisplayBusy"
        @click="toggleCustomerDisplay"
      >
        <i :class="customerDisplayBusy ? 'pi pi-spin pi-spinner' : 'pi pi-desktop'" />
      </button>
      <button
        class="topbar-icon-btn fullscreen-btn"
        type="button"
        :aria-label="fullscreenActive ? tl('ออกเต็มจอ', 'Exit fullscreen', 'ອອກເຕັມຈໍ') : tl('เต็มจอ', 'Fullscreen', 'ເຕັມຈໍ')"
        :title="fullscreenActive ? tl('ออกเต็มจอ', 'Exit fullscreen', 'ອອກເຕັມຈໍ') : tl('เต็มจอ', 'Fullscreen', 'ເຕັມຈໍ')"
        @click="toggleFullscreen"
      >
        <i :class="fullscreenActive ? 'pi pi-window-minimize' : 'pi pi-window-maximize'" />
      </button>
      <span class="topbar-username"  @click="toggleMenu">{{ authStore.employee?.user_name }}</span>
      <!-- <Avatar
        :label="initials"
        shape="circle"
        size="normal"
        class="avatar-btn"
       
      /> -->
      <Menu ref="menu" :model="menuItems" popup />
    </div>
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 1rem;
  height: 60px;
  background: linear-gradient(90deg, #fffdf8 0%, #fff7ed 54%, #ffedd5 100%);
  border-bottom: 1px solid #fed7aa;
  box-shadow: 0 2px 14px rgba(249, 115, 22, 0.1);
  position: sticky;
  top: 0;
  z-index: 100;
  font-size: var(--biz-zone-font-size, 1rem);
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.hamburger {
  display: flex;
  width: 2rem;
  height: 2rem;
  border: 1px solid #fed7aa;
  background: #ffffff;
  cursor: pointer;
  font-size: 1.1em;
  color: #c2410c;
  border-radius: 6px;
  align-items: center;
  justify-content: center;
  -webkit-tap-highlight-color: transparent;
}

.hamburger:hover {
  background: #fff7ed;
}

.topbar-icon-btn {
  display: inline-flex;
  width: 2rem;
  height: 2rem;
  border: 1px solid #fed7aa;
  border-radius: 6px;
  background: #ffffff;
  color: #9a3412;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.topbar-icon-btn:hover {
  background: #fff7ed;
}

.topbar-icon-btn:disabled {
  cursor: wait;
  opacity: 0.65;
}

.topbar-icon-btn:focus-visible {
  outline: 2px solid var(--app-brand-color);
  outline-offset: 1px;
}

.customer-display-btn.active {
  border-color: #86efac;
  background: #dcfce7;
  color: #15803d;
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.12);
}

.customer-display-btn.active:hover {
  background: #bbf7d0;
}

.topbar-brand {
  display: inline-flex;
  align-items: baseline;
  gap: 0.35rem;
  font-size: 1.35em;
  font-weight: 900;
  color: #1f2937;
  letter-spacing: 0;
}

.topbar-brand strong {
  color: #ea580c;
  font: inherit;
}

.topbar-logo {
  display: inline-flex;
  width: 2rem;
  height: 2rem;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: linear-gradient(135deg, #ff8a00 0%, #ff3d00 100%);
  color: #ffffff;
  font-size: 1.05em;
  font-weight: 900;
  box-shadow: 0 8px 18px rgba(249, 115, 22, 0.24);
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.sale-layout-controls {
  display: inline-flex;
  align-items: center;
  gap: 0.18rem;
  min-width: 0;
  padding: 0.16rem;
  /* border: 1px solid #fed7aa;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.78); */
}

.sale-layout-controls button {
  display: inline-flex;
  min-height: 2rem;
  align-items: center;
  justify-content: center;
  gap: 0.28rem;
  border: 1px solid #fed7aa;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  cursor: pointer;
  font: inherit;
  font-size: 1em;
  font-weight: 900;
  padding: 0.24rem 0.48rem;
  white-space: nowrap;
}

.sale-layout-controls button:hover {
  border-color: #fb923c;
  background: #fff7ed;
  color: #ea580c;
}

.sale-layout-controls .layout-scale-button {
  min-width: 3.45rem;
  color: #ea580c;
  font-variant-numeric: tabular-nums;
}

.sale-layout-controls .layout-density-button {
  min-width: 6rem;
}

.pos-tag {
  border: 1px solid #fed7aa;
  background: #fff7ed;
  color: #ea580c;
  font-weight: 900;
}

.topbar-language :deep(.p-select) {
  border-color: #fed7aa;
  background: rgba(255, 255, 255, 0.86);
  color: #3f2a1d;
}

.topbar-language :deep(.p-select:not(.p-disabled).p-focus) {
  border-color: #fb923c;
  box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.14);
}

.topbar-username {
  border: 1px solid #fed7aa;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.82);
  color: #3f2a1d;
  font-size: 1em;
  cursor: pointer;
  font-weight: 800;
  padding: 0.45rem 0.75rem;
}

.avatar-btn {
  cursor: pointer;
}

.avatar-btn:hover {
  opacity: 0.85;
}

@media (max-width: 767px) {
  .topbar {
    gap: 0.35rem;
    padding: 0 0.5rem;
  }

  .topbar-left {
    flex: 0 0 auto;
    min-width: 0;
  }

  .topbar-brand {
    display: none;
  }

  .topbar-right {
    flex: 1 1 auto;
    gap: 0.28rem;
    justify-content: flex-end;
  }

  .sale-layout-controls {
    gap: 0.1rem;
    padding: 0.1rem;
  }

  .sale-layout-controls button {
    min-height: 1.9rem;
    padding: 0.18rem 0.3rem;
    font-size: 0.72rem;
  }

  .sale-layout-controls .layout-scale-button {
    min-width: 2.85rem;
  }

  .sale-layout-controls .layout-density-button {
    width: 2rem;
    min-width: 2rem;
  }

  .sale-layout-controls .layout-density-button span {
    display: none;
  }

  .topbar-username {
    display: none;
  }

  .pos-tag {
    display: none;
  }

  .topbar-language {
    max-width: 8.75rem;
  }
}
</style>
