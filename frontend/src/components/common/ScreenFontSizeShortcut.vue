<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import { useScreenFontSize } from '@/composables/useScreenFontSize'

const PANEL_WIDTH = 280
const PANEL_HEIGHT = 286
const PANEL_MARGIN = 12

const { locale } = useI18n()
const {
  activeZoneKey,
  applyCurrentScreenFontSizes,
  currentZoneFontSize,
  defaultFontSize,
  effectiveFontSize,
  hasCurrentZoneFontSize,
  isValidFontSize,
  resetCurrentZone,
  resetCurrentScreen,
  screenKey,
  screenZoneKey,
  screenZoneSizes,
  setActiveZone,
  setFontSize,
  setHoveredZone,
} = useScreenFontSize()

const open = ref(false)
const inputValue = ref('')
const panelPosition = ref({ left: 24, top: 24 })
const lastPointer = ref({ left: 24, top: 24 })
const inputRef = ref(null)
const syncingInput = ref(false)
let observer = null

const isInputValid = computed(() => isValidFontSize(inputValue.value))
const isScreenScope = computed(() => activeZoneKey.value === screenZoneKey)
const hasCurrentScreenCustomFontSizes = computed(() => Object.keys(screenZoneSizes.value).length > 0)
const activeZoneLabel = computed(() => zoneLabel(activeZoneKey.value))
const scopeDescription = computed(() =>
  isScreenScope.value ? tl('ทั้งจอนี้', 'This screen', 'ທັງໜ້າຈໍນີ້') : tl('เฉพาะส่วนนี้', 'This section only', 'ສະເພາະສ່ວນນີ້')
)

const panelStyle = computed(() => ({
  left: `${panelPosition.value.left}px`,
  top: `${panelPosition.value.top}px`,
}))

const presetItems = [
  { label: '10px', value: '10px' },
  { label: '12px', value: '12px' },
  { label: '16px', value: '16px' },
  { label: '1rem', value: '1rem' },
  { label: '1.25rem', value: '1.25rem' },
  { label: '1.5em', value: '1.5em' },
]

const zoneLabelMap = {
  screen: { th: 'ทั้งจอ', en: 'Whole screen', lo: 'ທັງໜ້າຈໍ' },
  appbar: { th: 'แถบบน', en: 'App bar', lo: 'ແຖບເທິງ' },
  'main-menu': { th: 'ปุ่มเมนู/คำสั่ง', en: 'Menu buttons', lo: 'ປຸ່ມເມນູ' },
  'menu-drawer': { th: 'เมนูด้านข้าง', en: 'Side menu', lo: 'ເມນູດ້ານຂ້າງ' },
  'main-tabs': { th: 'แท็บเอกสาร', en: 'Document tabs', lo: 'ແທັບເອກະສານ' },
  'doc-header': { th: 'หัวเอกสาร', en: 'Document header', lo: 'ຫົວເອກະສານ' },
  toolbar: { th: 'แถบค้นหา/เครื่องมือ', en: 'Toolbar/search', lo: 'ແຖບຄົ້ນຫາ' },
  'product-search-dialog': { th: 'popup ค้นหาสินค้า', en: 'Product search popup', lo: 'popup ຄົ້ນຫາສິນຄ້າ' },
  'customer-dialog': { th: 'popup เลือกลูกค้า', en: 'Customer popup', lo: 'popup ເລືອກລູກຄ້າ' },
  'employee-dialog': { th: 'popup เลือกพนักงานขาย', en: 'Employee popup', lo: 'popup ເລືອກພະນັກງານ' },
  'product-table': { th: 'ตารางรายการสินค้า', en: 'Product table', lo: 'ຕາຕະລາງສິນຄ້າ' },
  'product-table-head': { th: 'หัวตารางสินค้า', en: 'Product table header', lo: 'ຫົວຕາຕະລາງສິນຄ້າ' },
  'product-table-body': { th: 'รายการสินค้า', en: 'Product rows', lo: 'ລາຍການສິນຄ້າ' },
  'doc-footer': { th: 'footer เอกสาร', en: 'Document footer', lo: 'ທ້າຍເອກະສານ' },
  'summary-rail': { th: 'ส่วนยอดรวมด้านขวา', en: 'Summary rail', lo: 'ສະຫຼຸບດ້ານຂວາ' },
  'summary-totals': { th: 'ยอดรวม/ยอดสุทธิ', en: 'Totals', lo: 'ຍອດລວມ' },
  'summary-actions': { th: 'ปุ่มรับชำระ/บันทึก', en: 'Summary actions', lo: 'ປຸ່ມຮັບຊຳລະ' },
  'promotion-detail-dialog': { th: 'รายละเอียดโปร/แคมเปญ', en: 'Promotion detail popup', lo: 'ລາຍລະອຽດໂປຣ/ແຄມເປນ' },
  'held-bill-dialog': { th: 'popup บิลพัก', en: 'Held bills popup', lo: 'popup ບິນພັກ' },
  'payment-dialog': { th: 'หน้ารับชำระ', en: 'Payment dialog', lo: 'ໜ້າຮັບຊຳລະ' },
  'payment-methods': { th: 'วิธีรับชำระ', en: 'Payment methods', lo: 'ວິທີຮັບຊຳລະ' },
  'payment-form': { th: 'ฟอร์มรับชำระ', en: 'Payment form', lo: 'ຟອມຮັບຊຳລະ' },
  'payment-summary': { th: 'สรุปการรับชำระ', en: 'Payment summary', lo: 'ສະຫຼຸບການຮັບຊຳລະ' },
  'customer-display-header': { th: 'จอลูกค้า: หัวจอ', en: 'Customer display: header', lo: 'ຈໍລູກຄ້າ: ຫົວຈໍ' },
  'customer-display-table-head': { th: 'จอลูกค้า: หัวตาราง', en: 'Customer display: table header', lo: 'ຈໍລູກຄ້າ: ຫົວຕາຕະລາງ' },
  'customer-display-table-body': { th: 'จอลูกค้า: รายการสินค้า', en: 'Customer display: item rows', lo: 'ຈໍລູກຄ້າ: ລາຍການສິນຄ້າ' },
  'customer-display-empty': { th: 'จอลูกค้า: หน้าว่าง', en: 'Customer display: empty state', lo: 'ຈໍລູກຄ້າ: ໜ້າວ່າງ' },
  'customer-display-summary-total': { th: 'จอลูกค้า: ยอดรวมใหญ่', en: 'Customer display: main total', lo: 'ຈໍລູກຄ້າ: ຍອດລວມໃຫຍ່' },
  'customer-display-summary-lines': { th: 'จอลูกค้า: รายละเอียดยอด', en: 'Customer display: total lines', lo: 'ຈໍລູກຄ້າ: ລາຍລະອຽດຍອດ' },
  'customer-display-qr': { th: 'จอลูกค้า: กล่อง QR', en: 'Customer display: QR panel', lo: 'ຈໍລູກຄ້າ: ກ່ອງ QR' },
  'customer-display-scanner': { th: 'จอลูกค้า: ช่องสแกน', en: 'Customer display: scanner box', lo: 'ຈໍລູກຄ້າ: ຊ່ອງສະແກນ' },
  'customer-display-ad': { th: 'จอลูกค้า: โฆษณา/วิดีโอ', en: 'Customer display: ad/video', lo: 'ຈໍລູກຄ້າ: ໂຄສະນາ/ວິດີໂອ' },
  'customer-display-thankyou': { th: 'จอลูกค้า: หน้าขอบคุณ', en: 'Customer display: thank you', lo: 'ຈໍລູກຄ້າ: ໜ້າຂອບໃຈ' },
  dialog: { th: 'Dialog', en: 'Dialog', lo: 'Dialog' },
}

watch([currentZoneFontSize, activeZoneKey], ([value]) => {
  syncingInput.value = true
  inputValue.value = value || defaultFontSize
  nextTick(() => {
    syncingInput.value = false
  })
}, { immediate: true })

watch(inputValue, (value) => {
  if (!open.value || syncingInput.value || !isValidFontSize(value)) return
  setFontSize(value)
})

function tl(th, en, lo = en) {
  const lang = String(locale.value || 'th').toLowerCase()
  if (lang.startsWith('en')) return en
  if (lang.startsWith('lo')) return lo
  return th
}

function zoneLabel(zoneKey) {
  const labels = zoneLabelMap[zoneKey] || {}
  const lang = String(locale.value || 'th').toLowerCase()
  if (lang.startsWith('en')) return labels.en || zoneKey
  if (lang.startsWith('lo')) return labels.lo || labels.en || zoneKey
  return labels.th || labels.en || zoneKey
}

function clampPanelPosition(pointer) {
  const viewportWidth = window.innerWidth || PANEL_WIDTH
  const viewportHeight = window.innerHeight || PANEL_HEIGHT

  return {
    left: Math.min(Math.max(pointer.left, PANEL_MARGIN), Math.max(PANEL_MARGIN, viewportWidth - PANEL_WIDTH - PANEL_MARGIN)),
    top: Math.min(Math.max(pointer.top, PANEL_MARGIN), Math.max(PANEL_MARGIN, viewportHeight - PANEL_HEIGHT - PANEL_MARGIN)),
  }
}

function handlePointerMove(event) {
  const target = event.target
  lastPointer.value = {
    left: event.clientX,
    top: event.clientY,
  }
  if (target?.closest?.('.screen-font-panel')) return
  const zoneElement = target?.closest?.('[data-font-zone]')
  setHoveredZone(zoneElement?.dataset?.fontZone || screenZoneKey)
}

async function openPanel() {
  setActiveZone(hoveredZoneKeyFromPointer())
  syncingInput.value = true
  inputValue.value = currentZoneFontSize.value || defaultFontSize
  panelPosition.value = clampPanelPosition({
    left: lastPointer.value.left + 8,
    top: lastPointer.value.top + 8,
  })
  open.value = true
  await nextTick()
  syncingInput.value = false
  const inputElement = inputRef.value?.$el || inputRef.value
  inputElement?.focus?.()
  inputElement?.select?.()
}

function hoveredZoneKeyFromPointer() {
  const element = document.elementFromPoint(lastPointer.value.left, lastPointer.value.top)
  if (element?.closest?.('.screen-font-panel')) return activeZoneKey.value
  return element?.closest?.('[data-font-zone]')?.dataset?.fontZone || screenZoneKey
}

function closePanel() {
  open.value = false
}

function handleKeyDown(event) {
  if (event.key === 'F8') {
    event.preventDefault()
    if (open.value) closePanel()
    else openPanel()
    return
  }

  if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    closePanel()
  }
}

function applyInputFontSize() {
  setFontSize(inputValue.value)
}

function applyPreset(value) {
  inputValue.value = value
  setFontSize(value)
}

function selectZone(zoneKey) {
  setActiveZone(zoneKey)
  syncingInput.value = true
  inputValue.value = currentZoneFontSize.value || defaultFontSize
  nextTick(() => {
    syncingInput.value = false
  })
}

function resetZoneFontSize() {
  syncingInput.value = true
  resetCurrentZone()
  inputValue.value = defaultFontSize
  nextTick(() => {
    syncingInput.value = false
  })
}

function resetScreenFontSizes() {
  syncingInput.value = true
  resetCurrentScreen()
  inputValue.value = defaultFontSize
  nextTick(() => {
    syncingInput.value = false
  })
}

onMounted(() => {
  window.addEventListener('pointermove', handlePointerMove, { passive: true })
  window.addEventListener('keydown', handleKeyDown)
  observer = new MutationObserver(() => applyCurrentScreenFontSizes())
  observer.observe(document.body, { childList: true, subtree: true })
})

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', handlePointerMove)
  window.removeEventListener('keydown', handleKeyDown)
  observer?.disconnect?.()
  observer = null
})
</script>

<template>
  <div
    v-if="open"
    class="screen-font-panel"
    :style="panelStyle"
    role="dialog"
    aria-modal="false"
    aria-labelledby="screen-font-title"
  >
    <div class="flex align-items-start justify-content-between gap-2">
      <div class="min-w-0">
        <div id="screen-font-title" class="screen-font-title">ขนาดตัวหนังสือ</div>
        <div class="screen-font-meta">
          {{ scopeDescription }}: {{ activeZoneLabel }} · {{ screenKey }}
        </div>
      </div>
      <Button icon="pi pi-times" text rounded severity="secondary" size="small" aria-label="ปิด" @click="closePanel" />
    </div>

    <div class="screen-font-scope">
      <Button
        :label="tl('ส่วนนี้', 'Section', 'ສ່ວນນີ້')"
        size="small"
        :outlined="isScreenScope"
        @click="selectZone(hoveredZoneKeyFromPointer())"
      />
      <Button
        :label="tl('ทั้งจอ', 'Screen', 'ທັງຈໍ')"
        size="small"
        :outlined="!isScreenScope"
        severity="secondary"
        @click="selectZone(screenZoneKey)"
      />
    </div>

    <div class="screen-font-preview">
      ตัวอย่างข้อความ {{ effectiveFontSize }}
    </div>

    <div class="flex gap-2">
      <InputText
        ref="inputRef"
        v-model="inputValue"
        class="flex-1"
        :class="{ 'p-invalid': inputValue && !isInputValid }"
        placeholder="เช่น 10px, 1rem, 1.2em"
        @keyup.enter="applyInputFontSize"
      />
      <Button icon="pi pi-check" :disabled="!isInputValid" aria-label="ใช้ขนาดนี้" @click="applyInputFontSize" />
    </div>

    <div class="screen-font-hint">
      รองรับ px, rem, em และจะบันทึกแยกตามจอ/ส่วน layout ทันที
    </div>

    <div class="screen-font-presets">
      <Button
        v-for="item in presetItems"
        :key="item.value"
        :label="item.label"
        size="small"
        outlined
        @click="applyPreset(item.value)"
      />
    </div>

    <div class="flex justify-content-end">
      <Button
        :label="tl('คืนค่าส่วนนี้', 'Reset section', 'ຄືນຄ່າສ່ວນນີ້')"
        icon="pi pi-refresh"
        text
        severity="secondary"
        size="small"
        :disabled="!hasCurrentZoneFontSize"
        @click="resetZoneFontSize"
      />
      <Button
        :label="tl('คืนค่าทั้งจอ', 'Reset screen', 'ຄືນຄ່າທັງຈໍ')"
        icon="pi pi-undo"
        text
        severity="secondary"
        size="small"
        :disabled="!hasCurrentScreenCustomFontSizes"
        @click="resetScreenFontSizes"
      />
    </div>
  </div>
</template>

<style scoped>
.screen-font-panel {
  position: fixed;
  z-index: 10000;
  width: 280px;
  padding: 12px;
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
  background: var(--app-panel-bg);
  box-shadow: 0 14px 38px rgba(15, 23, 42, 0.22);
  font-size: 14px;
}

.screen-font-title {
  color: var(--p-text-color);
  font-size: 14px;
  font-weight: 800;
  line-height: 1.2;
}

.screen-font-meta {
  margin-top: 2px;
  overflow: hidden;
  color: var(--p-text-color-secondary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.screen-font-preview {
  margin: 10px 0;
  padding: 8px 10px;
  overflow: hidden;
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
  background: var(--app-shell-bg);
  color: var(--p-text-color);
  font-size: var(--biz-screen-font-size, 16px);
  font-weight: 700;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.screen-font-scope {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-top: 10px;
}

.screen-font-hint {
  margin-top: 6px;
  color: var(--p-text-color-secondary);
  font-size: 11px;
  line-height: 1.35;
}

.screen-font-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 10px 0 4px;
}

.screen-font-panel :deep(.p-inputtext) {
  min-height: 34px;
  padding: 6px 8px;
  font-size: 13px;
}

.screen-font-panel :deep(.p-button) {
  min-height: 30px;
  padding: 6px 10px;
  font-size: 12px;
}

.screen-font-panel :deep(.p-button-icon-only) {
  width: 34px;
  padding: 6px;
}

.screen-font-panel :deep(.p-button-icon) {
  font-size: 13px;
}
</style>
