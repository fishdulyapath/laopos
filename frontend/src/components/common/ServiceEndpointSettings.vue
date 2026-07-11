<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'primevue/usetoast'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import { defaultApiBaseUrl, normalizeApiBaseUrl, runtimeApiBaseUrl, saveApiBaseUrl } from '@/config/runtime'

const { locale } = useI18n()
const toast = useToast()

const visible = ref(false)
const serviceEndpoint = ref('')
const saving = ref(false)
const testing = ref(false)
const status = ref(null)

const normalizedServiceEndpoint = computed(() => normalizeApiBaseUrl(serviceEndpoint.value))
const serviceEndpointChanged = computed(() => normalizedServiceEndpoint.value !== runtimeApiBaseUrl())

function tl(th, en, lo = en) {
  const lang = String(locale.value || 'th').toLowerCase()
  if (lang.startsWith('en')) return en
  if (lang.startsWith('lo')) return lo
  return th
}

function openDialog() {
  serviceEndpoint.value = runtimeApiBaseUrl()
  status.value = null
  visible.value = true
}

function serviceEndpointHelpText() {
  const fallback = defaultApiBaseUrl()
  if (!fallback) return tl('ระบุ URL เต็มที่ลงท้ายด้วย /service/v1', 'Enter the full URL ending with /service/v1', 'ໃສ່ URL ເຕັມທີ່ລົງທ້າຍດ້ວຍ /service/v1')
  return tl(`ค่าเริ่มต้น: ${fallback}`, `Default: ${fallback}`, `ຄ່າເລີ່ມຕົ້ນ: ${fallback}`)
}

function validateServiceEndpoint(value) {
  const endpoint = normalizeApiBaseUrl(value)
  if (!endpoint) {
    throw new Error(tl('กรุณาระบุ Service endpoint', 'Please enter the service endpoint', 'ກະລຸນາໃສ່ Service endpoint'))
  }
  if (!endpoint.startsWith('/') && !/^https?:\/\//i.test(endpoint)) {
    throw new Error(tl('Endpoint ต้องขึ้นต้นด้วย http://, https:// หรือ /service/v1', 'Endpoint must start with http://, https://, or /service/v1', 'Endpoint ຕ້ອງຂຶ້ນຕົ້ນດ້ວຍ http://, https:// ຫຼື /service/v1'))
  }
  return endpoint
}

function serviceEndpointUrl(pathname) {
  const baseUrl = validateServiceEndpoint(serviceEndpoint.value)
  return `${baseUrl}${pathname.startsWith('/') ? pathname : `/${pathname}`}`
}

async function saveEndpoint() {
  let nextEndpoint = ''
  try {
    nextEndpoint = validateServiceEndpoint(serviceEndpoint.value)
  } catch (err) {
    status.value = { severity: 'error', text: err.message }
    toast.add({ severity: 'warn', summary: tl('Endpoint ไม่ถูกต้อง', 'Invalid endpoint', 'Endpoint ບໍ່ຖືກຕ້ອງ'), detail: err.message, life: 3500 })
    return
  }

  saving.value = true
  status.value = null
  try {
    if (window.bizsuitDesktop?.setApiBaseUrl) {
      const config = await window.bizsuitDesktop.setApiBaseUrl(nextEndpoint)
      nextEndpoint = normalizeApiBaseUrl(config?.apiBaseUrl || nextEndpoint)
    }
    saveApiBaseUrl(nextEndpoint)
    serviceEndpoint.value = nextEndpoint
    status.value = {
      severity: 'success',
      text: tl('บันทึกแล้ว สามารถเข้าสู่ระบบกับ server นี้ได้ทันที', 'Saved. You can sign in with this server now.', 'ບັນທຶກແລ້ວ ສາມາດເຂົ້າລະບົບກັບ server ນີ້ໄດ້ທັນທີ'),
    }
    toast.add({ severity: 'success', summary: tl('บันทึก Endpoint แล้ว', 'Endpoint saved', 'ບັນທຶກ Endpoint ແລ້ວ'), detail: nextEndpoint, life: 3000 })
  } catch (err) {
    status.value = { severity: 'error', text: err.message || 'Save failed' }
    toast.add({ severity: 'error', summary: tl('บันทึก Endpoint ไม่สำเร็จ', 'Endpoint save failed', 'ບັນທຶກ Endpoint ບໍ່ສຳເລັດ'), detail: status.value.text, life: 4500 })
  } finally {
    saving.value = false
  }
}

async function testEndpoint() {
  let url = ''
  try {
    url = serviceEndpointUrl('/getErpOption')
  } catch (err) {
    status.value = { severity: 'error', text: err.message }
    return
  }

  testing.value = true
  status.value = null
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(url, {
      headers: { 'ngrok-skip-browser-warning': '1' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    status.value = {
      severity: 'success',
      text: tl('เชื่อมต่อ Service ได้', 'Service connection OK', 'ເຊື່ອມຕໍ່ Service ໄດ້'),
    }
  } catch (err) {
    status.value = {
      severity: 'error',
      text: err.name === 'AbortError' ? tl('เชื่อมต่อเกินเวลา', 'Connection timed out', 'ເຊື່ອມຕໍ່ເກີນເວລາ') : err.message || 'Connection failed',
    }
  } finally {
    window.clearTimeout(timeout)
    testing.value = false
  }
}
</script>

<template>
  <Button
    class="endpoint-button"
    icon="pi pi-cog"
    text
    rounded
    :aria-label="tl('ตั้งค่า Service Endpoint', 'Service endpoint settings', 'ຕັ້ງຄ່າ Service Endpoint')"
    @click="openDialog"
  />

  <Dialog
    v-model:visible="visible"
    modal
    :header="tl('ตั้งค่า Service Endpoint', 'Service Endpoint Settings', 'ຕັ້ງຄ່າ Service Endpoint')"
    class="endpoint-dialog"
    :style="{ width: 'min(92vw, 34rem)' }"
  >
    <div class="endpoint-form">
      <div class="field">
        <label for="service-endpoint">{{ tl('URL สำหรับเชื่อมต่อ Service', 'Service base URL', 'URL ສຳລັບເຊື່ອມຕໍ່ Service') }}</label>
        <InputText
          id="service-endpoint"
          v-model.trim="serviceEndpoint"
          class="w-full"
          placeholder="http://127.0.0.1:47302/service/v1"
          @keyup.enter="saveEndpoint"
        />
        <small class="field-help">{{ serviceEndpointHelpText() }}</small>
      </div>

      <div v-if="status" class="endpoint-status" :class="status.severity">
        <i :class="status.severity === 'success' ? 'pi pi-check-circle' : 'pi pi-exclamation-triangle'" />
        <span>{{ status.text }}</span>
      </div>

      <div class="endpoint-actions">
        <Button
          :label="tl('ทดสอบ', 'Test', 'ທົດສອບ')"
          icon="pi pi-wifi"
          severity="secondary"
          outlined
          :loading="testing"
          @click="testEndpoint"
        />
        <Button
          :label="tl('บันทึก', 'Save', 'ບັນທຶກ')"
          icon="pi pi-save"
          :loading="saving"
          :disabled="Boolean(normalizedServiceEndpoint) && !serviceEndpointChanged"
          @click="saveEndpoint"
        />
      </div>
    </div>
  </Dialog>
</template>

<style scoped>
.endpoint-button {
  width: 2.45rem;
  height: 2.45rem;
  color: #c2410c;
}

.endpoint-button:hover {
  background: #fff7ed;
}

.endpoint-form {
  display: grid;
  gap: 1rem;
}

.field {
  display: grid;
  gap: 0.45rem;
}

.field label {
  color: #9a3412;
  font-size: 0.875rem;
  font-weight: 800;
}

.field :deep(.p-inputtext) {
  border-color: #fed7aa;
}

.field :deep(.p-inputtext:enabled:focus) {
  border-color: #fb923c;
  box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.14);
}

.field-help {
  color: #9a3412;
  font-size: 0.78rem;
  font-weight: 650;
}

.endpoint-status {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  padding: 0.65rem 0.75rem;
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 760;
}

.endpoint-status.success {
  border: 1px solid #bbf7d0;
  background: #f0fdf4;
  color: #166534;
}

.endpoint-status.error {
  border: 1px solid #fecaca;
  background: #fef2f2;
  color: #b91c1c;
}

.endpoint-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.w-full {
  width: 100%;
}
</style>
