<script setup>
import { computed, onMounted, ref } from 'vue'
import { useToast } from 'primevue/usetoast'
import { useAuthStore } from '@/stores/auth'
import {
  getPosSlipTemplate,
  getPosSlipTemplatePreview,
  savePosSlipTemplate,
  uploadPosSlipImage,
} from '@/services/posSlipTemplateService'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import ToggleSwitch from 'primevue/toggleswitch'

const FORM_CODE = 'CR-0088'
const toast = useToast()
const authStore = useAuthStore()

const loading = ref(false)
const saving = ref(false)
const uploading = ref(false)
const logoInput = ref(null)
const adInput = ref(null)
const adImageInput = ref(null)
const pendingAdImageIndex = ref(-1)
const updatedAt = ref('')
const savedTemplate = ref(false)
const previewDocNo = ref('')
const previewData = ref(null)

const SECTION_ORDER = [
  'logo',
  'company',
  'doc',
  'customer',
  'items',
  'promotions',
  'totals',
  'remark',
  'campaigns',
  'footer',
  'sale',
  'ads',
]

const SECTION_LABELS = {
  logo: 'Logo',
  company: 'ຊື່ຮ້ານ / ສາຂາ',
  doc: 'ວັນທີ ເວລາ / ເລກທີ່ບິນ',
  customer: 'ລູກຄ້າ',
  items: 'ລາຍການສິນຄ້າ',
  totals: 'ຍອດລວມ',
  remark: 'ໝາຍເຫດ',
  promotions: 'ໂປຣໂມຊັນ',
  campaigns: 'ແຄມເປນ',
  footer: 'ຂໍ້ຄວາມທ້າຍບິນ',
  sale: 'ພະນັກງານຂາຍ',
  ads: 'ໂຄສະນາ',
}

const DEFAULT_LAYOUT = {
  enabled: true,
  title: 'ໃບຮັບເງິນ/ໃບສົ່ງສິນຄ້າ',
  shop_name: 'ร้านทดสอบ',
  branch_name: 'ໜອງໄຮ',
  footer_text: 'ຂອບໃຈທີ່ໃຊ້ບໍລິການຂອງພວກເຮົາ.',
  font_scale: 1,
  padding_pt: 8,
  show_grid: true,
  snap_enabled: true,
  snap_pt: 2,
  nudge_step_pt: 1,
  logo_url: '',
  logo_max_height_mm: 18,
  ad_max_height_mm: 34,
  sections: SECTION_ORDER.map((key) => ({ key, enabled: true })),
  fields: {
    show_shop_address: true,
    show_shop_tel: true,
    show_shop_tax: true,
    show_customer_address: true,
    show_customer_tel: true,
    show_item_code: true,
    show_item_remark: true,
    show_unit_price: true,
    show_payments: true,
  },
  ads: [],
}

const layout = ref(structuredClone(DEFAULT_LAYOUT))

const enabledSections = computed(() => (layout.value.sections || []).filter((section) => section.enabled !== false))
const enabledAds = computed(() => (layout.value.ads || []).filter((ad) => (
  ad.enabled !== false && (ad.url || ad.image_url || ad.title || ad.body)
)))
const previewHeader = computed(() => previewData.value?.header || {})
const previewShipment = computed(() => previewData.value?.shipment || {})
const previewItems = computed(() => previewData.value?.details?.length ? previewData.value.details : [
  {
    __rowNumber: 1,
    item_code: '112-0012',
    item_name: 'มาม่าหมูสับ',
    qty: 1,
    unit_code: 'ลัง',
    kip_price: 30000,
    kip_amount: 30000,
    kip_discount: 0,
  },
])
const previewPromotions = computed(() => previewData.value?.promotions || [])
const previewCampaigns = computed(() => previewData.value?.campaigns || [])

const previewTotals = computed(() => {
  const items = previewItems.value
  const gross = items.reduce((sum, row) => {
    const qty = Number(row.qty || row.quantity || 0)
    const price = Number(row.kip_price || 0)
    return sum + (qty * price)
  }, 0)
  const discount = items.reduce((sum, row) => sum + Number(row.kip_discount || 0), 0)
  const amount = Number(previewHeader.value.kip_amount || 0)
    || items.reduce((sum, row) => sum + Number(row.kip_amount || 0), 0)
  return { gross: gross || amount + discount, discount, amount }
})

const previewRemark = computed(() => {
  const headerRemark = String(previewHeader.value.remark || '').trim()
  const itemRemarks = previewItems.value
    .map((row) => String(row.remark || '').trim())
    .filter(Boolean)
  return [headerRemark, ...itemRemarks].filter(Boolean).join('\n')
})

function firstText(...values) {
  return values.map((value) => String(value ?? '').trim()).find(Boolean) || ''
}

const previewIsDeliver = computed(() => {
  const header = previewHeader.value
  const shipment = previewShipment.value
  const manageType = firstText(
    header.manage_type,
    header.management_type,
    header.manage_code,
    header.transport_code,
    header.delivery_type,
    header.shipping_type,
    shipment.manage_type,
    shipment.management_type,
    shipment.transport_code,
    shipment.delivery_type,
    shipment.shipping_type,
  ).toUpperCase()
  return manageType === 'DELIVER' || manageType === 'DELIVERY'
})

const previewDeliveryPhone = computed(() => firstText(
  previewShipment.value.transport_telephone,
  previewShipment.value.telephone,
  previewHeader.value.transport_telephone,
  previewHeader.value.cust_telephone,
  previewHeader.value.customer_telephone,
  previewHeader.value.telephone,
))

const previewDeliveryAddress = computed(() => firstText(
  previewShipment.value.transport_address,
  previewShipment.value.address,
  previewHeader.value.transport_address,
  previewHeader.value.cust_address,
  previewHeader.value.customer_address,
  previewHeader.value.address,
))

function money(value) {
  return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function qty(value) {
  const number = Number(value || 0)
  return Number.isInteger(number) ? String(number) : number.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function dateTimeText() {
  const header = previewHeader.value
  return [header.doc_date, String(header.doc_time || '').slice(0, 5)].filter(Boolean).join(' ')
}

function customerText() {
  const header = previewHeader.value
  return [header.cust_code, header.cust_name].filter(Boolean).join('-')
}

function saleName() {
  const header = previewHeader.value
  return header.sale_name || header.printbyname || ''
}

function itemQtyPriceText(item) {
  const base = [item.unit_code || item.unit_name, qty(item.qty)].filter(Boolean).join(' ')
  if (layout.value.fields.show_unit_price === false) return base
  return `${base} x ${money(item.kip_price)}`.trim()
}

function promotionText(row) {
  return row.display_text || row.promotion_name || row.display_wording || row.name_1 || row.promotion_code || ''
}

function campaignText(row) {
  return row.display_text || row.all_display || row.display_wording || row.name_1 || row.campaign_code || ''
}

function normalizeLayout(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  const { paper_width_pt: _paperWidthPt, ...sourceWithoutPaperSize } = source
  const known = new Set(SECTION_ORDER)
  const seen = new Set()
  const sections = (Array.isArray(source.sections) ? source.sections : [])
    .map((section) => (typeof section === 'string' ? { key: section, enabled: true } : section))
    .filter((section) => known.has(section?.key) && !seen.has(section.key) && seen.add(section.key))
    .map((section) => ({ key: section.key, enabled: section.enabled !== false }))
  for (const key of SECTION_ORDER) {
    if (!seen.has(key)) sections.push({ key, enabled: true })
  }
  return {
    ...structuredClone(DEFAULT_LAYOUT),
    ...sourceWithoutPaperSize,
    title: sourceWithoutPaperSize.title || DEFAULT_LAYOUT.title,
    shop_name: sourceWithoutPaperSize.shop_name || DEFAULT_LAYOUT.shop_name,
    branch_name: sourceWithoutPaperSize.branch_name || DEFAULT_LAYOUT.branch_name,
    footer_text: sourceWithoutPaperSize.footer_text || DEFAULT_LAYOUT.footer_text,
    font_scale: boundedNumber(source.font_scale, DEFAULT_LAYOUT.font_scale, 0.75, 1.35),
    padding_pt: boundedNumber(source.padding_pt, DEFAULT_LAYOUT.padding_pt, 2, 16),
    logo_max_height_mm: boundedNumber(source.logo_max_height_mm, DEFAULT_LAYOUT.logo_max_height_mm, 8, 45),
    ad_max_height_mm: boundedNumber(source.ad_max_height_mm, DEFAULT_LAYOUT.ad_max_height_mm, 10, 90),
    sections,
    fields: {
      ...DEFAULT_LAYOUT.fields,
      ...(source.fields || {}),
    },
    ads: (Array.isArray(source.ads) ? source.ads : []).map((ad, index) => ({
      id: ad.id || `ad-${Date.now()}-${index}`,
      title: ad.title || '',
      body: ad.body || ad.text || '',
      url: ad.url || ad.image_url || ad.src || '',
      image_url: ad.image_url || ad.url || ad.src || '',
      enabled: ad.enabled !== false,
      divider: ad.divider !== false,
      image_position: ['top', 'bottom'].includes(String(ad.image_position || '').toLowerCase()) ? String(ad.image_position).toLowerCase() : 'top',
      image_max_height_mm: boundedNumber(ad.image_max_height_mm, source.ad_max_height_mm || DEFAULT_LAYOUT.ad_max_height_mm, 10, 120),
      title_font_size_px: boundedNumber(ad.title_font_size_px, 14, 8, 32),
      title_bold: ad.title_bold === undefined ? true : ad.title_bold === true,
      title_italic: ad.title_italic === true,
      body_font_size_px: boundedNumber(ad.body_font_size_px, 11, 8, 32),
      body_bold: ad.body_bold === true,
      body_italic: ad.body_italic === true,
      sort_order: Number(ad.sort_order || (index + 1) * 10),
    })).sort((a, b) => a.sort_order - b.sort_order),
  }
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, number))
}

async function loadTemplate() {
  loading.value = true
  try {
    const [template, preview] = await Promise.all([
      getPosSlipTemplate(FORM_CODE),
      getPosSlipTemplatePreview(FORM_CODE).catch(() => null),
    ])
    layout.value = normalizeLayout(template?.layout || {})
    savedTemplate.value = Boolean(template?.saved)
    updatedAt.value = template?.updated_at || ''
    previewData.value = preview?.preview || null
    previewDocNo.value = preview?.doc_no || ''
  } catch (error) {
    toast.add({ severity: 'error', summary: 'โหลดแบบพิมพ์ไม่สำเร็จ', detail: error.message, life: 3500 })
  } finally {
    loading.value = false
  }
}

async function saveTemplate() {
  saving.value = true
  try {
    const result = await savePosSlipTemplate(FORM_CODE, layout.value, authStore.employee?.user_code || '')
    layout.value = normalizeLayout(result?.layout || layout.value)
    savedTemplate.value = true
    updatedAt.value = result?.updated_at || ''
    toast.add({ severity: 'success', summary: 'บันทึกแบบพิมพ์แล้ว', detail: FORM_CODE, life: 2200 })
  } catch (error) {
    toast.add({ severity: 'error', summary: 'บันทึกไม่สำเร็จ', detail: error.message, life: 3500 })
  } finally {
    saving.value = false
  }
}

function resetTemplate() {
  layout.value = structuredClone(DEFAULT_LAYOUT)
}

function moveSection(index, direction) {
  const next = index + direction
  if (next < 0 || next >= layout.value.sections.length) return
  const list = [...layout.value.sections]
  const [item] = list.splice(index, 1)
  list.splice(next, 0, item)
  layout.value.sections = list
}

function moveAd(index, direction) {
  const next = index + direction
  if (next < 0 || next >= layout.value.ads.length) return
  const list = [...layout.value.ads]
  const [item] = list.splice(index, 1)
  list.splice(next, 0, item)
  layout.value.ads = list.map((ad, idx) => ({ ...ad, sort_order: (idx + 1) * 10 }))
}

function removeAd(index) {
  layout.value.ads.splice(index, 1)
}

function openLogoPicker() {
  logoInput.value?.click()
}

function openAdPicker() {
  adInput.value?.click()
}

function newAdBlock(extra = {}) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: '',
    body: '',
    url: '',
    image_url: '',
    enabled: true,
    divider: true,
    image_position: 'top',
    image_max_height_mm: layout.value.ad_max_height_mm,
    title_font_size_px: 14,
    title_bold: true,
    title_italic: false,
    body_font_size_px: 11,
    body_bold: false,
    body_italic: false,
    sort_order: (layout.value.ads.length + 1) * 10,
    ...extra,
  }
}

function adTitleStyle(ad) {
  return {
    fontSize: `${boundedNumber(ad.title_font_size_px, 14, 8, 32)}px`,
    fontWeight: ad.title_bold === false ? 400 : 900,
    fontStyle: ad.title_italic ? 'italic' : 'normal',
  }
}

function adBodyStyle(ad) {
  return {
    fontSize: `${boundedNumber(ad.body_font_size_px, 11, 8, 32)}px`,
    fontWeight: ad.body_bold ? 800 : 400,
    fontStyle: ad.body_italic ? 'italic' : 'normal',
  }
}

function addTextAd() {
  layout.value.ads.push(newAdBlock({ title: '', body: '' }))
}

function openAdImagePicker(index) {
  pendingAdImageIndex.value = index
  adImageInput.value?.click()
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('read file failed'))
    reader.readAsDataURL(file)
  })
}

async function uploadFile(file) {
  const dataUrl = await readFileAsDataUrl(file)
  return uploadPosSlipImage({
    formCode: FORM_CODE,
    fileName: file.name,
    mimeType: file.type,
    dataUrl,
  })
}

async function uploadLogo(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  uploading.value = true
  try {
    const result = await uploadFile(file)
    layout.value.logo_url = result.url
    toast.add({ severity: 'success', summary: 'อัปโหลด Logo แล้ว', life: 1800 })
  } catch (error) {
    toast.add({ severity: 'error', summary: 'อัปโหลดไม่สำเร็จ', detail: error.message, life: 3500 })
  } finally {
    uploading.value = false
  }
}

async function uploadAds(event) {
  const files = Array.from(event.target.files || [])
  event.target.value = ''
  if (!files.length) return
  uploading.value = true
  try {
    for (const file of files) {
      const result = await uploadFile(file)
      layout.value.ads.push({
        ...newAdBlock(),
        title: file.name,
        url: result.url,
        image_url: result.url,
      })
    }
    toast.add({ severity: 'success', summary: 'เพิ่มโฆษณาแล้ว', detail: `${files.length} ไฟล์`, life: 2000 })
  } catch (error) {
    toast.add({ severity: 'error', summary: 'อัปโหลดไม่สำเร็จ', detail: error.message, life: 3500 })
  } finally {
    uploading.value = false
  }
}

async function uploadAdImage(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  const index = pendingAdImageIndex.value
  pendingAdImageIndex.value = -1
  if (!file || index < 0 || !layout.value.ads[index]) return
  uploading.value = true
  try {
    const result = await uploadFile(file)
    layout.value.ads[index].url = result.url
    layout.value.ads[index].image_url = result.url
    if (!layout.value.ads[index].title) layout.value.ads[index].title = file.name
    toast.add({ severity: 'success', summary: 'อัปโหลดรูปโฆษณาแล้ว', life: 1800 })
  } catch (error) {
    toast.add({ severity: 'error', summary: 'อัปโหลดไม่สำเร็จ', detail: error.message, life: 3500 })
  } finally {
    uploading.value = false
  }
}

onMounted(loadTemplate)
</script>

<template>
  <div class="slip-page">
    <header class="slip-page-header">
      <div>
        <p>POS Thermal Slip</p>
        <h1>ฟอร์มพิมพ์ {{ FORM_CODE }}</h1>
        <small>รูปแบบ fixed สำหรับ thermal 80mm ใช้ query ของ {{ FORM_CODE }} และบันทึกไว้กลาง server</small>
      </div>
      <div class="header-actions">
        <Button label="โหลดใหม่" icon="pi pi-refresh" severity="secondary" :loading="loading" @click="loadTemplate" />
        <Button label="ค่าเริ่มต้น" icon="pi pi-undo" severity="secondary" @click="resetTemplate" />
        <Button label="บันทึก" icon="pi pi-save" :loading="saving" @click="saveTemplate" />
      </div>
    </header>

    <main class="slip-layout">
      <section class="slip-editor">
        <div class="editor-section">
          <h2>ข้อมูลที่พิมพ์เอง</h2>
          <div class="field">
            <label>ชื่อร้าน</label>
            <InputText v-model="layout.shop_name" class="w-full" />
          </div>
          <div class="field">
            <label>ສາຂາ</label>
            <InputText v-model="layout.branch_name" class="w-full" />
          </div>
          <div class="field">
            <label>หัวบิล</label>
            <InputText v-model="layout.title" class="w-full" />
          </div>
          <div class="field">
            <label>ข้อความท้ายใบเสร็จ</label>
            <InputText v-model="layout.footer_text" class="w-full" />
          </div>
        </div>

        <div class="editor-section">
          <h2>ตัวอักษรและระยะขอบ</h2>
          <div class="number-grid">
            <div class="field">
              <label>ขนาดตัวอักษร</label>
              <InputNumber v-model="layout.font_scale" :min="0.75" :max="1.35" :step="0.05" :min-fraction-digits="2" class="w-full" />
            </div>
            <div class="field">
              <label>ขอบใน pt</label>
              <InputNumber v-model="layout.padding_pt" :min="2" :max="16" class="w-full" />
            </div>
          </div>
          <div class="toggle-grid compact">
            <label><ToggleSwitch v-model="layout.fields.show_item_code" /> แสดงรหัสสินค้า</label>
            <label><ToggleSwitch v-model="layout.fields.show_unit_price" /> แสดงราคา/หน่วย</label>
          </div>
        </div>

        <div class="editor-section">
          <h2>ลำดับบน slip</h2>
          <div class="section-list">
            <article v-for="(section, index) in layout.sections" :key="section.key" class="section-row">
              <ToggleSwitch v-model="section.enabled" />
              <span>{{ SECTION_LABELS[section.key] || section.key }}</span>
              <div class="row-actions">
                <Button icon="pi pi-arrow-up" text rounded size="small" :disabled="index === 0" @click="moveSection(index, -1)" />
                <Button icon="pi pi-arrow-down" text rounded size="small" :disabled="index === layout.sections.length - 1" @click="moveSection(index, 1)" />
              </div>
            </article>
          </div>
        </div>

        <div class="editor-section">
          <h2>Logo และโฆษณา</h2>
          <div class="asset-tools">
            <Button label="เลือก Logo" icon="pi pi-image" severity="secondary" :loading="uploading" @click="openLogoPicker" />
            <Button label="เพิ่มโฆษณา" icon="pi pi-upload" severity="secondary" :loading="uploading" @click="openAdPicker" />
            <input ref="logoInput" type="file" class="hidden-input" accept="image/jpeg,image/png,image/webp,image/gif" @change="uploadLogo" />
            <Button label="เพิ่มข้อความโฆษณา" icon="pi pi-plus" severity="secondary" @click="addTextAd" />
            <input ref="adInput" type="file" class="hidden-input" accept="image/jpeg,image/png,image/webp,image/gif" multiple @change="uploadAds" />
            <input ref="adImageInput" type="file" class="hidden-input" accept="image/jpeg,image/png,image/webp,image/gif" @change="uploadAdImage" />
          </div>
          <div class="number-grid">
            <div class="field">
              <label>ความสูง Logo mm</label>
              <InputNumber v-model="layout.logo_max_height_mm" :min="8" :max="45" class="w-full" />
            </div>
            <div class="field">
              <label>ความสูงโฆษณา mm</label>
              <InputNumber v-model="layout.ad_max_height_mm" :min="10" :max="90" class="w-full" />
            </div>
          </div>
          <div v-if="layout.logo_url" class="logo-row">
            <img :src="layout.logo_url" alt="logo" />
            <Button icon="pi pi-times" text rounded severity="danger" @click="layout.logo_url = ''" />
          </div>
          <div v-if="layout.ads.length" class="ad-list">
            <article v-for="(ad, index) in layout.ads" :key="ad.id" class="ad-row">
              <div class="ad-thumb">
                <img v-if="ad.image_url || ad.url" :src="ad.image_url || ad.url" :alt="ad.title" />
                <span v-else>Text</span>
              </div>
              <div class="ad-fields">
                <InputText v-model="ad.title" class="w-full" placeholder="ชื่อโฆษณา" />
                <label class="inline-toggle"><ToggleSwitch v-model="ad.enabled" /> เปิดใช้</label>
                <textarea v-model="ad.body" class="ad-textarea" rows="4" placeholder="ข้อความโฆษณา / เงื่อนไข / วันที่"></textarea>
                <div class="ad-options">
                  <label class="inline-toggle"><ToggleSwitch v-model="ad.divider" /> เส้นคั่น</label>
                  <InputNumber v-model="ad.image_max_height_mm" :min="10" :max="120" suffix=" mm" input-class="ad-size-input" />
                  <label class="ad-position-select">
                    <span>ตำแหน่งรูป</span>
                    <select v-model="ad.image_position">
                      <option value="top">รูปอยู่บน</option>
                      <option value="bottom">รูปอยู่ล่าง</option>
                    </select>
                  </label>
                </div>
                <div class="ad-typography">
                  <label>
                    <span>หัวข้อ px</span>
                    <InputNumber v-model="ad.title_font_size_px" :min="8" :max="32" input-class="ad-font-input" />
                  </label>
                  <label class="inline-toggle"><ToggleSwitch v-model="ad.title_bold" /> หัวข้อหนา</label>
                  <label class="inline-toggle"><ToggleSwitch v-model="ad.title_italic" /> หัวข้อเอียง</label>
                  <label>
                    <span>ข้อความ px</span>
                    <InputNumber v-model="ad.body_font_size_px" :min="8" :max="32" input-class="ad-font-input" />
                  </label>
                  <label class="inline-toggle"><ToggleSwitch v-model="ad.body_bold" /> ข้อความหนา</label>
                  <label class="inline-toggle"><ToggleSwitch v-model="ad.body_italic" /> ข้อความเอียง</label>
                </div>
              </div>
              <div class="row-actions">
                <Button icon="pi pi-image" text rounded size="small" :loading="uploading && pendingAdImageIndex === index" @click="openAdImagePicker(index)" />
                <Button v-if="ad.image_url || ad.url" icon="pi pi-times" text rounded severity="secondary" size="small" @click="ad.url = ''; ad.image_url = ''" />
                <Button icon="pi pi-arrow-up" text rounded size="small" :disabled="index === 0" @click="moveAd(index, -1)" />
                <Button icon="pi pi-arrow-down" text rounded size="small" :disabled="index === layout.ads.length - 1" @click="moveAd(index, 1)" />
                <Button icon="pi pi-trash" text rounded severity="danger" size="small" @click="removeAd(index)" />
              </div>
            </article>
          </div>
        </div>
      </section>

      <aside class="slip-preview-wrap">
        <div class="preview-meta">
          <strong>Preview 80mm</strong>
          <span v-if="updatedAt">อัปเดตล่าสุด {{ updatedAt }}</span>
          <span v-else-if="!savedTemplate">ยังไม่มี template ที่บันทึก</span>
        </div>
        <div class="slip-preview" :style="{ padding: `${layout.padding_pt}pt`, fontSize: `${13 * layout.font_scale}px` }">
          <template v-for="section in enabledSections" :key="section.key">
            <div v-if="section.key === 'logo' && layout.logo_url" class="preview-logo">
              <img :src="layout.logo_url" alt="logo" :style="{ maxHeight: `${layout.logo_max_height_mm}mm` }" />
            </div>

            <div v-else-if="section.key === 'company'" class="preview-center preview-company">
              <strong>{{ layout.shop_name }}</strong>
              <span v-if="layout.branch_name">ສາຂາ {{ layout.branch_name }}</span>
              <span v-if="layout.title" class="preview-slip-title">{{ layout.title }}</span>
            </div>

            <div v-else-if="section.key === 'doc'" class="preview-lines">
              <div><span>ວັນທີ ເວລາ</span><strong>{{ dateTimeText() }}</strong></div>
              <div><span>ເລກທີ່ບິນ</span><strong>{{ previewHeader.doc_no || previewDocNo }}</strong></div>
            </div>

            <div v-else-if="section.key === 'customer'" class="preview-lines">
              <div><span>ລູກຄ້າ</span><strong>{{ customerText() }}</strong></div>
              <div v-if="previewIsDeliver" class="preview-delivery">
                <strong>จัดส่ง</strong>
                <span v-if="previewDeliveryPhone">เบอร์โทร {{ previewDeliveryPhone }}</span>
                <span v-if="previewDeliveryAddress">ที่อยู่ {{ previewDeliveryAddress }}</span>
              </div>
            </div>

            <div v-else-if="section.key === 'items'" class="preview-items">
              <div class="preview-head"><span>ລາຍການສິນຄ້າ</span><strong>KIP</strong></div>
              <div v-for="item in previewItems" :key="`${item.__rowNumber}-${item.item_code}`" class="preview-item">
                <div class="preview-item-title-line">
                  <span v-if="layout.fields.show_item_code">{{ item.item_code }}</span>
                  <strong>{{ item.item_name }}</strong>
                </div>
                <small>
                  <span>{{ itemQtyPriceText(item) }}</span>
                  <b>{{ money(item.kip_amount) }}</b>
                </small>
              </div>
            </div>

            <div v-else-if="section.key === 'totals'" class="preview-lines preview-total">
              <div><span>ຍອດລວມ</span><strong>{{ money(previewTotals.gross) }}</strong></div>
              <div v-if="previewTotals.discount"><span>ສ່ວນຫຼຸດ</span><strong>{{ money(previewTotals.discount) }}</strong></div>
              <div><span>ຍອດຊຳລະ</span><strong>{{ money(previewTotals.amount) }}</strong></div>
            </div>

            <div v-else-if="section.key === 'remark' && previewRemark" class="preview-note preview-remark-note">
              <strong>ໝາຍເຫດ</strong>
              <span>{{ previewRemark }}</span>
            </div>

            <div v-else-if="section.key === 'promotions' && previewPromotions.length" class="preview-note">
              <em class="preview-section-marker">ຕຳແໜ່ງ: ໂປຣໂມຊັນ</em>
              <span v-for="(row, index) in previewPromotions" :key="`pro-${index}`">{{ promotionText(row) }}</span>
            </div>

            <div v-else-if="section.key === 'campaigns' && previewCampaigns.length" class="preview-note">
              <em class="preview-section-marker">ຕຳແໜ່ງ: ແຄມເປນ</em>
              <span v-for="(row, index) in previewCampaigns" :key="`cam-${index}`">{{ campaignText(row) }}</span>
            </div>

            <div v-else-if="section.key === 'footer' && layout.footer_text" class="preview-footer">
              {{ layout.footer_text }}
            </div>

            <div v-else-if="section.key === 'sale' && saleName()" class="preview-lines">
              <div><span>ພະນັກງານຂາຍ</span><strong>{{ saleName() }}</strong></div>
            </div>

            <div v-else-if="section.key === 'ads' && enabledAds.length" class="preview-ads">
              <article v-for="ad in enabledAds" :key="ad.id" class="preview-ad-block" :class="{ divided: ad.divider !== false }">
                <img v-if="(ad.image_url || ad.url) && ad.image_position !== 'bottom'" :src="ad.image_url || ad.url" :alt="ad.title" :style="{ maxHeight: `${ad.image_max_height_mm || layout.ad_max_height_mm}mm` }" />
                <strong v-if="ad.title" :style="adTitleStyle(ad)">{{ ad.title }}</strong>
                <span v-if="ad.body" :style="adBodyStyle(ad)">{{ ad.body }}</span>
                <img v-if="(ad.image_url || ad.url) && ad.image_position === 'bottom'" :src="ad.image_url || ad.url" :alt="ad.title" :style="{ maxHeight: `${ad.image_max_height_mm || layout.ad_max_height_mm}mm` }" />
              </article>
            </div>
          </template>
        </div>
      </aside>
    </main>
  </div>
</template>

<style scoped>
.slip-page {
  min-height: 100%;
  padding: 18px;
  background: #f6f7fb;
  overflow: auto;
}

.slip-page-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 16px;
}

.slip-page-header p {
  margin: 0 0 4px;
  color: #64748b;
  font-weight: 700;
}

.slip-page-header h1 {
  margin: 0;
  font-size: 24px;
  color: #0f172a;
}

.slip-page-header small {
  display: block;
  margin-top: 4px;
  color: #64748b;
}

.header-actions,
.asset-tools,
.row-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.slip-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 16px;
  align-items: start;
}

.slip-editor {
  display: grid;
  gap: 12px;
}

.editor-section {
  padding: 14px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.editor-section h2 {
  margin: 0 0 12px;
  font-size: 16px;
  color: #0f172a;
}

.field {
  display: grid;
  gap: 6px;
  margin-bottom: 10px;
}

.field label,
.inline-toggle {
  color: #334155;
  font-size: 13px;
  font-weight: 700;
}

.number-grid,
.toggle-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
}

.toggle-grid.compact {
  margin-top: 8px;
}

.inline-toggle,
.toggle-grid label {
  display: inline-flex;
  gap: 8px;
  align-items: center;
}

.section-list {
  display: grid;
  gap: 8px;
}

.section-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 10px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.section-row span {
  min-width: 0;
  color: #0f172a;
  font-weight: 700;
}

.hidden-input {
  display: none;
}

.logo-row,
.ad-row {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  margin-top: 10px;
  padding: 10px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.logo-row {
  grid-template-columns: 72px auto;
  justify-content: start;
}

.logo-row img,
.ad-row img {
  width: 72px;
  max-height: 72px;
  object-fit: contain;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.ad-thumb {
  width: 72px;
  min-height: 72px;
  display: grid;
  place-items: center;
  color: #64748b;
  font-weight: 700;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.ad-thumb img {
  width: 100%;
  max-height: 72px;
  border: 0;
}

.ad-fields {
  display: grid;
  gap: 8px;
}

.ad-textarea {
  width: 100%;
  min-height: 88px;
  resize: vertical;
  padding: 8px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font: inherit;
  color: #0f172a;
}

.ad-options {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

:deep(.ad-size-input) {
  width: 92px;
}

.ad-position-select {
  display: inline-grid;
  gap: 4px;
  color: #334155;
  font-size: 12px;
  font-weight: 700;
}

.ad-position-select select {
  min-height: 32px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #fff;
  color: #0f172a;
  font: inherit;
  padding: 0 8px;
}

.ad-typography {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px 10px;
  align-items: center;
}

.ad-typography label:not(.inline-toggle) {
  display: grid;
  gap: 4px;
  color: #334155;
  font-size: 12px;
  font-weight: 700;
}

:deep(.ad-font-input) {
  width: 78px;
}

.slip-preview-wrap {
  position: sticky;
  top: 12px;
  display: grid;
  gap: 10px;
}

.preview-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
  color: #475569;
  font-size: 12px;
}

.preview-meta strong {
  color: #0f172a;
}

.slip-preview {
  width: 302px;
  min-height: 520px;
  margin: 0 auto;
  background: #fff;
  border: 1px solid #cbd5e1;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.18);
  color: #000;
  font-family: 'BizSuit Noto Sans Lao', 'Noto Sans Lao', 'Phetsarath OT', 'Saysettha OT', 'Noto Sans Thai', Tahoma, sans-serif;
  line-height: 1.28;
}

.preview-logo,
.preview-center,
.preview-footer,
.preview-ads {
  text-align: center;
}

.preview-logo img {
  max-width: 42mm;
  object-fit: contain;
}

.preview-company {
  display: grid;
  gap: 2px;
  padding-bottom: 7px;
  border-bottom: 1px solid #111;
}

.preview-company strong {
  font-size: 18px;
}

.preview-slip-title {
  font-weight: 800;
}

.preview-lines {
  display: grid;
  gap: 3px;
  margin-top: 7px;
}

.preview-lines div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: baseline;
}

.preview-lines strong {
  text-align: right;
  overflow-wrap: anywhere;
}

.preview-lines .preview-delivery {
  display: grid;
  justify-content: stretch;
  gap: 2px;
  align-items: start;
  padding: 5px 0;
  border-top: 1px dashed #111;
  border-bottom: 1px dashed #111;
}

.preview-delivery strong {
  text-align: left;
}

.preview-delivery span {
  overflow-wrap: anywhere;
}

.preview-items {
  margin-top: 8px;
  border-top: 1px solid #111;
  border-bottom: 1px solid #111;
}

.preview-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 0;
  border-bottom: 1px solid #111;
  font-weight: 700;
}

.preview-item {
  padding: 6px 0;
  border-bottom: 1px dashed #555;
}

.preview-item:last-child {
  border-bottom: 0;
}

.preview-item-title-line {
  display: flex;
  gap: 5px;
  align-items: baseline;
}

.preview-item-title-line span {
  font-weight: 700;
}

.preview-item-title-line strong {
  overflow-wrap: anywhere;
}

.preview-item small {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  margin-top: 3px;
  font-size: 12px;
}

.preview-total {
  margin-top: 8px;
  padding-top: 5px;
  border-top: 1px solid #111;
}

.preview-total div:last-child {
  margin-top: 5px;
  padding-top: 5px;
  border-top: 1px solid #111;
  font-size: 15px;
}

.preview-note {
  display: grid;
  gap: 3px;
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px dashed #111;
  white-space: pre-wrap;
}

.preview-remark-note {
  border-top-style: solid;
}

.preview-section-marker {
  justify-self: start;
  padding: 1px 6px;
  border: 1px dashed #94a3b8;
  border-radius: 999px;
  color: #64748b;
  font-size: 10px;
  font-style: normal;
  background: #f8fafc;
}

.preview-footer {
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px dashed #111;
  font-weight: 700;
}

.preview-ads {
  display: grid;
  gap: 8px;
  margin-top: 8px;
}

.preview-ads img {
  max-width: 100%;
  object-fit: contain;
}

.preview-ad-block {
  display: grid;
  gap: 5px;
  justify-items: center;
  padding-top: 8px;
  white-space: pre-wrap;
}

.preview-ad-block.divided {
  border-top: 1px dashed #111;
}

.preview-ad-block strong {
  font-size: 16px;
  line-height: 1.18;
}

.preview-ad-block span {
  display: block;
  line-height: 1.28;
}

@media (max-width: 980px) {
  .slip-layout {
    grid-template-columns: 1fr;
  }

  .slip-preview-wrap {
    position: static;
  }
}
</style>
