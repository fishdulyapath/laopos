<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Button from 'primevue/button'
import { useToast } from 'primevue/usetoast'

const props = defineProps({
  compact: {
    type: Boolean,
    default: false,
  },
  align: {
    type: String,
    default: 'left',
  },
})

const toast = useToast()
const buildVersion = typeof __APP_VERSION__ === 'undefined' ? '' : __APP_VERSION__
const status = ref({
  enabled: false,
  currentVersion: buildVersion,
  status: 'disabled',
  availableVersion: null,
  downloadedVersion: null,
  percent: 0,
  error: null,
})
const loading = ref(false)
let stopStatusListener = null
let lastToastStatus = ''

const desktopApi = computed(() => {
  if (typeof window === 'undefined') return null
  return window.bizsuitDesktop || null
})

const currentVersion = computed(() => status.value.currentVersion || buildVersion || '-')
const updateVersion = computed(() => status.value.downloadedVersion || status.value.availableVersion || '')
const canUseUpdater = computed(() => Boolean(desktopApi.value?.checkForUpdates && desktopApi.value?.installUpdate && status.value.enabled))
const isChecking = computed(() => status.value.status === 'checking')
const isDownloading = computed(() => status.value.status === 'downloading')
const isDownloaded = computed(() => status.value.status === 'downloaded')
const showUpdateVersion = computed(() => ['available', 'downloading', 'downloaded'].includes(status.value.status) && updateVersion.value)
const errorDetail = computed(() => {
  if (status.value.status !== 'error' || !status.value.error) return ''
  return String(status.value.error).replace(/\s+/g, ' ').slice(0, 180)
})

const statusLabel = computed(() => {
  if (isChecking.value) return 'กำลังตรวจสอบอัปเดต'
  if (isDownloading.value) return `กำลังดาวน์โหลด ${status.value.percent || 0}%`
  if (isDownloaded.value) return 'เวอร์ชันใหม่พร้อมติดตั้ง'
  if (status.value.status === 'available') return 'กำลังดาวน์โหลดอัปเดต'
  if (status.value.status === 'not-available') return 'เป็นเวอร์ชันล่าสุด'
  if (status.value.status === 'error') return 'ตรวจสอบอัปเดตไม่สำเร็จ'
  return status.value.enabled ? 'พร้อมตรวจสอบอัปเดต' : 'อัปเดตได้เมื่อเปิดจากแอป Windows'
})

const actionLabel = computed(() => {
  if (isDownloaded.value) return 'ติดตั้ง'
  if (isChecking.value) return 'ตรวจสอบ...'
  if (isDownloading.value) return `${status.value.percent || 0}%`
  return 'ตรวจสอบ'
})

const actionIcon = computed(() => {
  if (isDownloaded.value) return 'pi pi-download'
  if (isChecking.value || isDownloading.value) return 'pi pi-spin pi-spinner'
  return 'pi pi-refresh'
})

function applyStatus(nextStatus) {
  if (!nextStatus || typeof nextStatus !== 'object') return
  status.value = {
    ...status.value,
    ...nextStatus,
  }
}

function updateNoticeDetail() {
  const version = updateVersion.value ? `v${updateVersion.value}` : ''
  if (isDownloading.value) return [version, `${status.value.percent || 0}%`].filter(Boolean).join(' ')
  return version
}

watch(
  () => status.value.status,
  (nextStatus) => {
    if (!['downloading', 'downloaded'].includes(nextStatus)) return
    const noticeKey = `${nextStatus}:${updateVersion.value || ''}`
    if (noticeKey === lastToastStatus) return
    lastToastStatus = noticeKey
    if (nextStatus === 'downloading') {
      toast.add({ severity: 'info', summary: 'กำลังดาวน์โหลดอัปเดต', detail: updateNoticeDetail(), life: 5000 })
    } else if (nextStatus === 'downloaded') {
      toast.add({ severity: 'success', summary: 'เวอร์ชันใหม่พร้อมติดตั้ง', detail: updateNoticeDetail(), life: 9000 })
    }
  }
)

async function loadStatus() {
  if (!desktopApi.value?.getUpdateStatus) return
  try {
    applyStatus(await desktopApi.value.getUpdateStatus())
  } catch {}
}

async function handleAction() {
  if (!canUseUpdater.value || loading.value || isChecking.value || isDownloading.value) return
  loading.value = true
  try {
    if (isDownloaded.value) {
      applyStatus(await desktopApi.value.installUpdate())
    } else {
      applyStatus(await desktopApi.value.checkForUpdates())
    }
  } catch (error) {
    status.value = {
      ...status.value,
      status: 'error',
      error: error?.message || String(error),
    }
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadStatus()
  stopStatusListener = desktopApi.value?.onUpdateStatus?.((nextStatus) => applyStatus(nextStatus)) || null
})

onBeforeUnmount(() => {
  stopStatusListener?.()
})
</script>

<template>
  <div class="app-update-status" :class="[{ compact }, `align-${props.align}`, `status-${status.status}`]">
    <div class="version-text">
      <span class="version-current">v{{ currentVersion }}</span>
      <span v-if="showUpdateVersion" class="version-next">ใหม่ v{{ updateVersion }}</span>
      <span class="version-state">{{ statusLabel }}</span>
      <span v-if="errorDetail && !compact" class="version-error" :title="String(status.error || '')">{{ errorDetail }}</span>
    </div>
    <Button
      v-if="desktopApi"
      class="update-action"
      size="small"
      severity="secondary"
      :icon="actionIcon"
      :label="compact && !isDownloaded ? undefined : actionLabel"
      :aria-label="actionLabel"
      :disabled="!canUseUpdater || loading || isChecking || isDownloading"
      text
      rounded
      @click="handleAction"
    />
  </div>
</template>

<style scoped>
.app-update-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  color: #64748b;
  font-size: 0.8125rem;
}

.align-center {
  justify-content: center;
}

.align-right {
  justify-content: flex-end;
}

.version-text {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem;
  min-width: 0;
}

.version-current {
  color: #334155;
  font-weight: 800;
}

.version-next {
  border-radius: 999px;
  background: #dcfce7;
  color: #166534;
  font-size: 0.75rem;
  font-weight: 800;
  line-height: 1;
  padding: 0.25rem 0.45rem;
}

.version-state {
  color: #64748b;
}

.status-available .version-state,
.status-downloading .version-state,
.status-downloaded .version-state {
  border-radius: 999px;
  background: #eff6ff;
  color: #1d4ed8;
  font-weight: 800;
  line-height: 1;
  padding: 0.25rem 0.45rem;
}

.status-downloaded .version-state {
  background: #fef2f2;
  color: #b91c1c;
}

.version-error {
  max-width: min(34rem, 100%);
  overflow: hidden;
  color: #b91c1c;
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.compact:not(.status-available):not(.status-downloading):not(.status-downloaded) .version-state {
  display: none;
}

.update-action {
  flex: 0 0 auto;
  min-width: 2rem;
  height: 2rem;
}

.app-update-status :deep(.p-button-label) {
  font-size: 0.75rem;
  font-weight: 800;
}
</style>
