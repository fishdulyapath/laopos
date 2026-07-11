<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { DecodeHintType, BarcodeFormat } from '@zxing/library'

const emit = defineEmits(['detected'])

const videoRef = ref(null)
const manualBarcode = ref('')
const errorMsg = ref('')
const cameras = ref([])
const selectedDeviceId = ref('')

let reader = null
let controls = null

function hasMediaSupport() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
}

async function requestCameraPermission() {
  if (!hasMediaSupport()) {
    errorMsg.value = 'เบราว์เซอร์นี้ไม่รองรับการใช้งานกล้อง'
    return false
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    })
    stream.getTracks().forEach(track => track.stop())
    return true
  } catch (ex) {
    const reason = ex?.name === 'NotAllowedError'
      ? 'กรุณาอนุญาตการใช้งานกล้องในเบราว์เซอร์'
      : (ex?.message || 'ไม่สามารถเข้าถึงกล้องได้')
    errorMsg.value = reason
    return false
  }
}

async function listCameras() {
  try {
    const devices = await BrowserMultiFormatReader.listVideoInputDevices()
    cameras.value = devices
    // เลือกกล้องหลัง (back/environment) ถ้ามี ไม่งั้นใช้ตัวแรก
    const back = devices.find(d => /back|rear|environment/i.test(d.label))
    selectedDeviceId.value = back?.deviceId || devices[0]?.deviceId || ''
  } catch (ex) {
    errorMsg.value = 'ไม่พบกล้อง: ' + ex.message
  }
}

async function startScan() {
  try {
    errorMsg.value = ''
    controls = await reader.decodeFromVideoDevice(
      selectedDeviceId.value || undefined,
      videoRef.value,
      (result, err, ctrl) => {
        if (result) {
          ctrl.stop()
          emit('detected', result.getText())
        }
      },
    )
  } catch (ex) {
    errorMsg.value = 'เปิดกล้องไม่สำเร็จ: ' + (ex.message || 'อนุญาตการใช้งานกล้อง')
  }
}

async function initScanner() {
  const granted = await requestCameraPermission()
  if (!granted) return

  await listCameras()
  if (!selectedDeviceId.value && cameras.value.length === 0) {
    errorMsg.value = 'ไม่พบกล้องที่ใช้งานได้'
    return
  }
  await startScan()
}

function stopScan() {
  try { controls?.stop() } catch { /* noop */ }
  controls = null
}

async function changeCamera(deviceId) {
  selectedDeviceId.value = deviceId
  stopScan()
  await startScan()
}

function submitManual() {
  if (!manualBarcode.value.trim()) return
  emit('detected', manualBarcode.value.trim())
}

onMounted(async () => {
  const hints = new Map()
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.QR_CODE,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.ITF,
  ])
  hints.set(DecodeHintType.TRY_HARDER, true)
  reader = new BrowserMultiFormatReader(hints)

  await initScanner()
})

onBeforeUnmount(() => {
  stopScan()
})
</script>

<template>
  <div class="scanner-wrap">
    <div class="video-container">
      <video ref="videoRef" class="scanner-video" playsinline muted autoplay />
      <div class="scan-overlay">
        <div class="scan-line" />
      </div>
    </div>

    <p v-if="errorMsg" class="error-msg">{{ errorMsg }}</p>

    <Button
      v-if="errorMsg"
      label="ลองเปิดกล้องอีกครั้ง"
      text
      size="small"
      @click="initScanner"
    />

    <div v-if="cameras.length > 1" class="camera-select">
      <select :value="selectedDeviceId" @change="e => changeCamera(e.target.value)">
        <option v-for="cam in cameras" :key="cam.deviceId" :value="cam.deviceId">
          {{ cam.label || `กล้อง ${cam.deviceId.slice(0, 6)}` }}
        </option>
      </select>
    </div>

    <div class="manual-row">
      <InputText
        v-model="manualBarcode"
        placeholder="หรือกรอกบาร์โค้ดเอง..."
        class="manual-input"
        @keydown.enter="submitManual"
      />
      <Button label="ค้นหา" @click="submitManual" />
    </div>
  </div>
</template>

<style scoped>
.scanner-wrap {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
}

.video-container {
  position: relative;
  width: 100%;
  max-width: 360px;
  border-radius: 12px;
  overflow: hidden;
  background: #000;
  aspect-ratio: 4/3;
}

.scanner-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.scan-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.scan-line {
  width: 70%;
  height: 2px;
  background: rgba(99, 200, 100, 0.85);
  box-shadow: 0 0 8px rgba(99, 200, 100, 0.7);
  animation: scan-move 1.8s ease-in-out infinite alternate;
}

@keyframes scan-move {
  from { transform: translateY(-60px); }
  to   { transform: translateY(60px); }
}

.error-msg {
  text-align: center;
  color: #dc2626;
  font-size: 0.9rem;
  line-height: 1.5;
}

.camera-select select {
  font-size: 0.85rem;
  padding: 0.4rem 0.6rem;
  border-radius: 6px;
  border: 1px solid var(--p-surface-border);
  background: var(--p-surface-0, #fff);
}

.manual-row {
  display: flex;
  gap: 0.5rem;
  width: 100%;
  max-width: 360px;
}

.manual-input { flex: 1; }
</style>
