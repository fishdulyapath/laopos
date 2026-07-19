<script setup>
import { ref, computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "primevue/usetoast";
import { usePosStore } from "@/stores/pos";
import { DEFAULT_CUSTOMER_DISPLAY_CURRENCY_CODE, DEFAULT_DEVICE_CONFIG, normalizeAllowedSaleWarehouseCodes } from "@/utils/posDeviceSettings";
import { getSaleDocFormatList } from "@/services/basketService";
import { getPaymentMasterLists } from "@/services/sellService";
import { deleteCustomerDisplayMedia, getCustomerDisplayMedia, reorderCustomerDisplayMedia, updateCustomerDisplayMedia, uploadCustomerDisplayMedia } from "@/services/customerDisplayMediaService";
import Select from "primevue/select";
import ToggleSwitch from "primevue/toggleswitch";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import InputNumber from "primevue/inputnumber";
import SelectButton from "primevue/selectbutton";
import Toast from "primevue/toast";

const { locale } = useI18n();
const toast = useToast();
const posStore = usePosStore();

const isElectron = computed(() => !!window.bizsuitDevices);
const customerDisplayAvailable = computed(() => !!window.bizsuitCustomerDisplay?.open);
const printerList = ref([]);
const cashDrawerScanning = ref(false);
const cashDrawerScanResults = ref([]);
const cashDrawerScanError = ref("");
const customerDisplayOpening = ref(false);
const paymentMasters = ref({ currencies: [], summary_currency_codes: [] });
const mediaItems = ref([]);
const mediaLoading = ref(false);
const mediaUploading = ref(false);
const mediaError = ref("");
const mediaFileInput = ref(null);
const mediaUploadZone = ref("right");
const saleDocFormats = ref([]);
const saleDocFormatLoading = ref(false);
const posMachineLoading = ref(false);

const form = ref({ ...DEFAULT_DEVICE_CONFIG });

const rightMediaItems = computed(() => mediaItems.value.filter((item) => normalizeMediaZone(item.display_zone) === "right"));
const summaryMediaItems = computed(() => mediaItems.value.filter((item) => normalizeMediaZone(item.display_zone) === "summary"));
const summarySecondaryMediaItems = computed(() => mediaItems.value.filter((item) => normalizeMediaZone(item.display_zone) === "summary_secondary"));

const rightCustomerDisplayPlaylist = computed(() => buildCustomerDisplayPlaylist(rightMediaItems.value));
const summaryCustomerDisplayPlaylist = computed(() => buildCustomerDisplayPlaylist(summaryMediaItems.value));
const summarySecondaryCustomerDisplayPlaylist = computed(() => buildCustomerDisplayPlaylist(summarySecondaryMediaItems.value));

const defaultSaleDocFormatOptions = computed(() => {
  const branchCode = String(posStore.selectedPos?.branch_code || "").trim();
  return saleDocFormats.value
    .filter((format) => {
      if (!format.use_branch_select) return true;
      if (!branchCode) return true;
      return String(format.branch_list || "")
        .split(",")
        .map((branch) => branch.trim())
        .includes(branchCode);
    })
    .map((format) => ({
      ...format,
      label: `${format.code} - ${format.name_1 || ""}`,
      value: format.code,
    }));
});

const configuredPosOptions = computed(() =>
  posStore.posList.map((pos) => ({
    ...pos,
    label: posOptionLabel(pos),
    value: String(pos.pos_id || "").trim(),
  })),
);

function resolveSaleDocFormatOptionCode(value) {
  const code = String(value || "").trim();
  if (!code) return "";
  const format = saleDocFormats.value.find(
    (row) => String(row.code || "").trim() === code || String(row.screen_code || "").trim() === code,
  );
  return format?.code || code;
}

function normalizeMediaZone(value) {
  const zone = String(value || "right")
    .trim()
    .toLowerCase();
  if (zone === "summary" || zone === "summary_secondary") return zone;
  return "right";
}

function buildCustomerDisplayPlaylist(items) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item.enabled !== false && item.url)
    .map((item) => ({
      id: item.id,
      url: item.url,
      type: item.media_type || item.type,
      title: item.title || item.original_name || "",
      duration: Number(item.duration_seconds || item.duration || 10),
      sound_enabled: item.sound_enabled === true,
    }));
}

function posOptionLabel(pos) {
  const id = String(pos?.pos_id || "").trim();
  const machine = String(pos?.machinecode || "").trim();
  const branch = String(pos?.branch_name || pos?.branch_code || "").trim();
  const warehouse = String(pos?.wh_name || pos?.pos_ic_wht || "").trim();
  return [machine && machine !== id ? `${machine} : ${id}` : id, branch, warehouse].filter(Boolean).join(" - ");
}

const customerDisplayCurrencyOptions = computed(() => {
  const homeCode = String(paymentMasters.value.home_currency || DEFAULT_CUSTOMER_DISPLAY_CURRENCY_CODE).trim().toUpperCase()
  const summaryCodes = normalizeSummaryCurrencyCodes(paymentMasters.value.summary_currency_codes);
  const codes = summaryCodes.includes(DEFAULT_CUSTOMER_DISPLAY_CURRENCY_CODE)
    ? summaryCodes
    : [DEFAULT_CUSTOMER_DISPLAY_CURRENCY_CODE, ...summaryCodes];
  const currencies = Array.isArray(paymentMasters.value.currencies) ? paymentMasters.value.currencies : [];
  const list = codes.map((code) => {
    const currency = currencies.find(
      (row) =>
        String(row.code || "")
          .trim()
          .toUpperCase() === code,
    );
    const name = String(currency?.name_1 || currency?.name || code).trim() || code;
    const ratio = String(currency?.name_2 || "").trim();
    return {
      label: ratio && code !== homeCode ? `${code} - ${name} (${ratio})` : `${code} - ${name}`,
      value: code,
      code,
      name,
      name_2: ratio || "1",
    };
  });
  return list.length ? list : [{ label: `${DEFAULT_CUSTOMER_DISPLAY_CURRENCY_CODE} - ກີບ`, value: DEFAULT_CUSTOMER_DISPLAY_CURRENCY_CODE, code: DEFAULT_CUSTOMER_DISPLAY_CURRENCY_CODE, name: "ກີບ", name_2: "1" }];
});

const printerModeOptions = [
  { label: "ไม่พิมพ์", value: "none" },
  { label: "HTML (Dot Matrix / ทั่วไป)", value: "html" },
  { label: "ESC/POS (Thermal)", value: "escpos" },
];

const cashDrawerModeOptions = [
  { label: "ผ่าน Printer", value: "printer" },
  { label: "Serial Port", value: "serial" },
  { label: "USB (usbcr)", value: "usbcr" },
  { label: "USB (friusb)", value: "friusb" },
];

const cashDrawerIdOptions = computed(() => {
  const detected = cashDrawerScanResults.value.filter((row) => row.available);
  if (detected.length) {
    return detected.map((row) => ({
      label: `${cashDrawerBaseLabel(row.drawerId)} - ${cashDrawerStateLabel(row)}`,
      value: row.drawerId,
    }));
  }
  return Array.from({ length: 8 }, (_, index) => {
    const id = index + 1;
    return { label: cashDrawerBaseLabel(id), value: id };
  });
});

const summaryPanelLayoutOptions = [
  { label: "1 ช่อง", value: "single" },
  { label: "2 ช่อง", value: "split" },
];

function normalizeSummaryPanelLayout(value) {
  return value === "single" ? "single" : "split";
}

function normalizeCashDrawerId(value) {
  const id = Number(value);
  if (!Number.isFinite(id)) return 1;
  return Math.min(8, Math.max(1, Math.trunc(id)));
}

function cashDrawerBaseLabel(id) {
  return Number(id) === 1 ? tl("ลิ้นชัก 1 (ค่าเริ่มต้น)", "Drawer 1 (default)", "ລິ້ນຊັກ 1 (ຄ່າເລີ່ມຕົ້ນ)") : tl(`ลิ้นชัก ${id}`, `Drawer ${id}`, `ລິ້ນຊັກ ${id}`);
}

function cashDrawerStateLabel(row) {
  if (!row?.responded) return tl("ไม่ตอบสนอง", "No response", "ບໍ່ຕອບສະໜອງ");
  if (row.state === "open") return tl("พบช่องนี้ (เปิดอยู่)", "Found (open)", "ພົບຊ່ອງນີ້ (ເປີດຢູ່)");
  if (row.state === "closed") return tl("พบช่องนี้ (ปิดอยู่)", "Found (closed)", "ພົບຊ່ອງນີ້ (ປິດຢູ່)");
  return tl(`ตอบกลับรหัส ${row.status}`, `Returned ${row.status}`, `ຕອບກັບລະຫັດ ${row.status}`);
}

function cashDrawerScanResultClass(row) {
  return {
    detected: row.available,
    selected: Number(row.drawerId) === Number(form.value.cash_drawer_drawer_id),
  };
}

function tl(th, en, lo = en) {
  const lang = String(locale.value || "th").toLowerCase();
  if (lang.startsWith("en")) return en;
  if (lang.startsWith("lo")) return lo;
  return th;
}

function currentDisplayLanguage() {
  const lang = String(locale.value || "th")
    .trim()
    .toLowerCase();
  if (lang.startsWith("en")) return "en";
  if (lang.startsWith("lo")) return "lo";
  return "th";
}

function normalizeSummaryCurrencyCodes(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  return raw
    .map((code) =>
      String(code || "")
        .trim()
        .toUpperCase(),
    )
    .filter(Boolean)
    .filter((code, index, list) => list.indexOf(code) === index);
}

function currencyByCode(code) {
  const target = String(code || "")
    .trim()
    .toUpperCase();
  return customerDisplayCurrencyOptions.value.find((item) => item.code === target) || customerDisplayCurrencyOptions.value[0];
}

function customerDisplayCurrencyState() {
  const currency = currencyByCode(form.value.customer_display_currency_code || DEFAULT_CUSTOMER_DISPLAY_CURRENCY_CODE);
  const homeCode = String(paymentMasters.value.home_currency || DEFAULT_CUSTOMER_DISPLAY_CURRENCY_CODE).trim().toUpperCase();
  const isHome = String(currency?.code || "").trim().toUpperCase() === homeCode;
  const rate = isHome ? 1 : Number(String(currency?.name_2 || "1").replace(/,/g, ""));
  return {
    code: currency?.code || DEFAULT_CUSTOMER_DISPLAY_CURRENCY_CODE,
    label: currency?.name || currency?.code || "ກີບ",
    rate: Number.isFinite(rate) && rate > 0 ? rate : 1,
    decimals: currency?.code === "THB" ? 2 : 0,
  };
}

async function loadPaymentMastersForSettings() {
  try {
    const data = await getPaymentMasterLists();
    paymentMasters.value = {
      currencies: Array.isArray(data.currencies) ? data.currencies : [],
      summary_currency_codes: data.summary_currency_codes || data.options?.summary_currency_codes || [],
      home_currency: data.options?.home_currency || DEFAULT_CUSTOMER_DISPLAY_CURRENCY_CODE,
    };
    const selectedCode = String(form.value.customer_display_currency_code || "")
      .trim()
      .toUpperCase();
    if (!customerDisplayCurrencyOptions.value.some((item) => item.code === selectedCode)) {
      form.value.customer_display_currency_code = customerDisplayCurrencyOptions.value[0]?.value || DEFAULT_CUSTOMER_DISPLAY_CURRENCY_CODE;
    }
  } catch {
    paymentMasters.value = { currencies: [], summary_currency_codes: [DEFAULT_CUSTOMER_DISPLAY_CURRENCY_CODE] };
  }
}

async function loadSaleDocFormatsForSettings() {
  saleDocFormatLoading.value = true;
  try {
    saleDocFormats.value = await getSaleDocFormatList();
    form.value.default_sale_doc_format_code = resolveSaleDocFormatOptionCode(form.value.default_sale_doc_format_code);
    const selectedCode = String(form.value.default_sale_doc_format_code || "").trim();
    if (selectedCode && !defaultSaleDocFormatOptions.value.some((item) => item.value === selectedCode)) {
      form.value.default_sale_doc_format_code = "";
    }
  } catch {
    saleDocFormats.value = [];
  } finally {
    saleDocFormatLoading.value = false;
  }
}

async function loadPosMachinesForSettings() {
  posMachineLoading.value = true;
  try {
    await posStore.loadPosList();
    if (!form.value.configured_pos_id) {
      form.value.configured_pos_id = String(posStore.posId || "").trim();
    }
  } catch {
    // POS list is nice-to-have here; users can still keep already saved settings.
  } finally {
    posMachineLoading.value = false;
  }
}

async function loadPrinters() {
  if (!window.bizsuitDevices?.listPrinters) return;
  try {
    const list = await window.bizsuitDevices.listPrinters();
    printerList.value = (list || []).map((p) => ({ label: p.name, value: p.name }));
  } catch {
    printerList.value = [];
  }
}

function loadForm() {
  form.value = { ...DEFAULT_DEVICE_CONFIG, ...posStore.deviceConfig };
  form.value.configured_pos_id = String(form.value.configured_pos_id || posStore.posId || "").trim();
  form.value.allowed_sale_wh_codes = normalizeAllowedSaleWarehouseCodes(form.value.allowed_sale_wh_codes).join(",");
  form.value.customer_display_summary_layout = normalizeSummaryPanelLayout(form.value.customer_display_summary_layout);
  form.value.cash_drawer_drawer_id = normalizeCashDrawerId(form.value.cash_drawer_drawer_id);
}

async function save() {
  if (!form.value.configured_pos_id) {
    toast.add({
      severity: "warn",
      summary: tl("ยังไม่ได้เลือกเครื่อง POS", "No POS machine selected", "ຍັງບໍ່ໄດ້ເລືອກ POS"),
      detail: tl("กรุณาเลือกเครื่อง POS ประจำเครื่องนี้ก่อนบันทึก", "Please select the POS machine for this device before saving.", "ກະລຸນາເລືອກ POS ປະຈຳເຄື່ອງນີ້ກ່ອນບັນທຶກ"),
      life: 3000,
    });
    return;
  }
  form.value.configured_pos_id = String(form.value.configured_pos_id || "").trim();
  form.value.allowed_sale_wh_codes = normalizeAllowedSaleWarehouseCodes(form.value.allowed_sale_wh_codes).join(",");
  form.value.customer_display_summary_layout = normalizeSummaryPanelLayout(form.value.customer_display_summary_layout);
  form.value.cash_drawer_drawer_id = normalizeCashDrawerId(form.value.cash_drawer_drawer_id);
  form.value.default_sale_doc_format_code = String(form.value.default_sale_doc_format_code || "").trim();
  const selectedConfiguredPos = posStore.posList.find((pos) => String(pos.pos_id || "").trim() === form.value.configured_pos_id);
  if (selectedConfiguredPos) {
    posStore.selectPos(selectedConfiguredPos);
    await posStore.refreshErpOption().catch(() => {});
  }
  posStore.saveDeviceConfig({ ...form.value });
  toast.add({
    severity: "success",
    summary: tl("บันทึกแล้ว", "Saved", "ບັນທຶກແລ້ວ"),
    detail: tl("ตั้งค่าเครื่องนี้สำเร็จ", "Device settings saved", "ບັນທຶກການຕັ້ງຄ່າເຄື່ອງນີ້ສຳເລັດ"),
    life: 2500,
  });
}

async function loadCustomerDisplayMedia() {
  mediaLoading.value = true;
  mediaError.value = "";
  try {
    mediaItems.value = await getCustomerDisplayMedia();
  } catch (err) {
    mediaError.value = err.message || "Load media failed";
    mediaItems.value = [];
  } finally {
    mediaLoading.value = false;
  }
}

function openMediaFilePicker(zone = "right") {
  mediaUploadZone.value = normalizeMediaZone(zone);
  mediaFileInput.value?.click();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Cannot read file"));
    reader.readAsDataURL(file);
  });
}

function formatMediaSize(value) {
  const size = Number(value || 0);
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${size} B`;
}

async function uploadMediaFiles(event) {
  const files = Array.from(event?.target?.files || []);
  if (event?.target) event.target.value = "";
  if (!files.length) return;
  mediaUploading.value = true;
  mediaError.value = "";
  try {
    for (const file of files) {
      const dataUrl = await fileToDataUrl(file);
      await uploadCustomerDisplayMedia({
        fileName: file.name,
        mimeType: file.type,
        dataUrl,
        title: file.name.replace(/\.[^.]+$/, ""),
        duration: 10,
        displayZone: mediaUploadZone.value,
        createdBy: posStore.posId || "",
      });
    }
    await loadCustomerDisplayMedia();
    toast.add({ severity: "success", summary: tl("อัปโหลดสื่อแล้ว", "Media uploaded", "ອັບໂຫຼດສື່ແລ້ວ"), life: 2200 });
  } catch (err) {
    mediaError.value = err.message || "Upload failed";
    toast.add({ severity: "error", summary: tl("อัปโหลดไม่สำเร็จ", "Upload failed", "ອັບໂຫຼດບໍ່ສຳເລັດ"), detail: mediaError.value, life: 4000 });
  } finally {
    mediaUploading.value = false;
  }
}

async function saveMediaItem(item) {
  try {
    const updated = await updateCustomerDisplayMedia(item.id, {
      title: item.title || "",
      duration_seconds: item.duration_seconds || 10,
      enabled: item.enabled !== false,
      sound_enabled: item.sound_enabled === true,
      display_zone: normalizeMediaZone(item.display_zone),
    });
    mediaItems.value = mediaItems.value.map((row) => (row.id === updated.id ? updated : row));
  } catch (err) {
    toast.add({ severity: "error", summary: tl("บันทึกสื่อไม่สำเร็จ", "Media save failed", "ບັນທຶກສື່ບໍ່ສຳເລັດ"), detail: err.message, life: 3500 });
  }
}

async function removeMediaItem(item) {
  try {
    await deleteCustomerDisplayMedia(item.id);
    mediaItems.value = mediaItems.value.filter((row) => row.id !== item.id);
  } catch (err) {
    toast.add({ severity: "error", summary: tl("ลบสื่อไม่สำเร็จ", "Delete failed", "ລຶບສື່ບໍ່ສຳເລັດ"), detail: err.message, life: 3500 });
  }
}

async function moveMediaItem(items, index, direction) {
  const list = Array.isArray(items) ? [...items] : [];
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= list.length) return;
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(targetIndex, 0, item);
  const reordered = next.map((row, rowIndex) => ({ ...row, sort_order: (rowIndex + 1) * 10 }));
  const orderById = new Map(reordered.map((row) => [row.id, row.sort_order]));
  mediaItems.value = mediaItems.value.map((row) => (orderById.has(row.id) ? { ...row, sort_order: orderById.get(row.id) } : row));
  try {
    mediaItems.value = await reorderCustomerDisplayMedia(reordered.map((row) => ({ id: row.id, sort_order: row.sort_order })));
  } catch (err) {
    toast.add({ severity: "error", summary: tl("เรียงลำดับไม่สำเร็จ", "Reorder failed", "ຈັດລຳດັບບໍ່ສຳເລັດ"), detail: err.message, life: 3500 });
    await loadCustomerDisplayMedia();
  }
}

async function testCustomerDisplay() {
  if (!customerDisplayAvailable.value) {
    toast.add({ severity: "warn", summary: tl("ไม่พร้อม", "Not ready", "ບໍ່ພ້ອມ"), detail: tl("ต้องใช้งานผ่าน Electron app", "Requires Electron app", "ຕ້ອງໃຊ້ Electron app"), life: 3000 });
    return;
  }
  customerDisplayOpening.value = true;
  try {
    await window.bizsuitCustomerDisplay.open();
    await window.bizsuitCustomerDisplay.update({
      mode: "sale",
      pos: posStore.posId || "POS",
      customer: tl("ลูกค้าทั่วไป", "Walk-in customer", "ລູກຄ້າທົ່ວໄປ"),
      cashier: "Demo",
      ads: rightCustomerDisplayPlaylist.value,
      summaryAds: summaryCustomerDisplayPlaylist.value,
      summarySecondaryAds: summarySecondaryCustomerDisplayPlaylist.value,
      summaryPanelLayout: form.value.customer_display_summary_layout === "single" ? "single" : "split",
      displayCurrency: customerDisplayCurrencyState(),
      displayLanguage: currentDisplayLanguage(),
      items: [
        { id: "demo-1", code: "DEMO001", name: "Americano เย็น", unit: "แก้ว", qty: 1, price: 50, amount: 50 },
        { id: "demo-2", code: "DEMO002", name: "Latte ร้อน", unit: "แก้ว", qty: 2, price: 60, amount: 120 },
      ],
      totals: { totalValue: 170, discount: 0, netAmount: 170, paid: 100, remaining: 70, change: 0 },
      qr: null,
    });
    toast.add({ severity: "success", summary: tl("จอลูกค้า", "Customer display", "ຈໍລູກຄ້າ"), detail: tl("ส่งหน้าทดสอบแล้ว", "Test screen sent", "ສົ່ງໜ້າທົດສອບແລ້ວ"), life: 2000 });
  } catch (err) {
    toast.add({ severity: "error", summary: tl("เปิดจอลูกค้าไม่สำเร็จ", "Customer display failed", "ເປີດຈໍລູກຄ້າບໍ່ສຳເລັດ"), detail: err.message, life: 4000 });
  } finally {
    customerDisplayOpening.value = false;
  }
}

async function closeCustomerDisplay() {
  if (!window.bizsuitCustomerDisplay?.close) return;
  try {
    await window.bizsuitCustomerDisplay.close();
    toast.add({ severity: "success", summary: tl("จอลูกค้า", "Customer display", "ຈໍລູກຄ້າ"), detail: tl("ปิดจอลูกค้าแล้ว", "Customer display closed", "ປິດຈໍລູກຄ້າແລ້ວ"), life: 1800 });
  } catch (err) {
    toast.add({ severity: "error", summary: tl("ปิดจอลูกค้าไม่สำเร็จ", "Close failed", "ປິດຈໍລູກຄ້າບໍ່ສຳເລັດ"), detail: err.message, life: 4000 });
  }
}

async function testPrint() {
  if (!window.bizsuitDevices?.printRawHex) {
    toast.add({ severity: "warn", summary: tl("ไม่พร้อม", "Not ready", "ບໍ່ພ້ອມ"), detail: tl("ต้องใช้งานผ่าน Electron app", "Requires Electron app", "ຕ້ອງໃຊ້ Electron app"), life: 3000 });
    return;
  }
  if (!form.value.printer_name) {
    toast.add({ severity: "warn", summary: tl("ยังไม่ได้เลือก Printer", "No printer selected", "ຍັງບໍ່ໄດ້ເລືອກ Printer"), life: 2500 });
    return;
  }
  // ESC/POS test receipt
  const testHex =
    "1b40" + // INIT
    "1b7415" + // codepage TIS-620
    "1b6101" + // center
    "1b450148495a5355495420544553540a1b4500" + // BOLD ON + "BIZSUIT TEST" + LF + BOLD OFF
    "1b6100" + // left
    "2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d0a" + // 48 dashes + LF
    "54657374205072696e74204f4b210a" + // "Test Print OK!" + LF
    "0a0a0a" + // 3 LF (feed)
    "1d564103"; // CUT
  if (!form.value.printer_name) {
    toast.add({
      severity: "warn",
      summary: tl("à¹„à¸¡à¹ˆà¸žà¸£à¹‰à¸­à¸¡", "Not ready", "àºšà»à»ˆàºžà»‰àº­àº¡"),
      detail: tl(
        "à¸¢à¸±à¸‡à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¸•à¸±à¹‰à¸‡à¸„à¹ˆà¸²à¹€à¸„à¸£à¸·à¹ˆà¸­à¸‡à¸žà¸´à¸¡à¸žà¹Œ",
        "Printer is not configured",
        "àºàº±àº‡àºšà»à»ˆà»„àº”à»‰àº•àº±à»‰àº‡àº„à»ˆàº²à»€àº„àº·à»ˆàº­àº‡àºžàº´àº¡",
      ),
      life: 3000,
    });
    return;
  }
  try {
    await window.bizsuitDevices.printRawHex(testHex, { printerName: form.value.printer_name });
    toast.add({ severity: "success", summary: tl("ส่งคำสั่งพิมพ์แล้ว", "Print command sent", "ສົ່ງຄຳສັ່ງພິມແລ້ວ"), life: 2000 });
  } catch (err) {
    toast.add({ severity: "error", summary: tl("พิมพ์ไม่สำเร็จ", "Print failed", "ພິມບໍ່ສຳເລັດ"), detail: err.message, life: 4000 });
  }
}

async function scanUsbCrCashDrawers() {
  if (!window.bizsuitDevices?.scanUsbCrDrawers) {
    toast.add({ severity: "warn", summary: tl("ไม่พร้อม", "Not ready", "ບໍ່ພ້ອມ"), detail: tl("ต้องใช้งานผ่าน Electron app", "Requires Electron app", "ຕ້ອງໃຊ້ Electron app"), life: 3000 });
    return;
  }
  cashDrawerScanning.value = true;
  cashDrawerScanError.value = "";
  cashDrawerScanResults.value = [];
  try {
    const result = await window.bizsuitDevices.scanUsbCrDrawers({ maxDrawerId: 8 });
    cashDrawerScanResults.value = Array.isArray(result.drawers) ? result.drawers : [];
    const detected = cashDrawerScanResults.value.filter((row) => row.available);
    if (detected.length) {
      form.value.cash_drawer_drawer_id = normalizeCashDrawerId(detected[0].drawerId);
      toast.add({
        severity: "success",
        summary: tl("พบช่องลิ้นชัก", "Drawer channel found", "ພົບຊ່ອງລິ້ນຊັກ"),
        detail: detected.map((row) => cashDrawerBaseLabel(row.drawerId)).join(", "),
        life: 3000,
      });
    } else {
      toast.add({
        severity: "warn",
        summary: tl("ไม่พบช่องที่ตอบสนอง", "No channel responded", "ບໍ່ພົບຊ່ອງທີ່ຕອບສະໜອງ"),
        detail: tl("ยังเลือกช่องเองและกดทดสอบเปิดลิ้นชักได้", "You can still pick a channel and test the drawer.", "ຍັງເລືອກຊ່ອງເອງແລ້ວທົດສອບໄດ້"),
        life: 4000,
      });
    }
  } catch (err) {
    cashDrawerScanError.value = err.message || "Scan failed";
    toast.add({ severity: "error", summary: tl("สแกนลิ้นชักไม่สำเร็จ", "Drawer scan failed", "ສະແກນລິ້ນຊັກບໍ່ສຳເລັດ"), detail: cashDrawerScanError.value, life: 4000 });
  } finally {
    cashDrawerScanning.value = false;
  }
}

function selectScannedCashDrawer(row) {
  if (!row?.available) return;
  form.value.cash_drawer_drawer_id = normalizeCashDrawerId(row.drawerId);
}

async function testCashDrawer() {
  if (!window.bizsuitDevices?.openCashDrawer) {
    toast.add({ severity: "warn", summary: tl("ไม่พร้อม", "Not ready", "ບໍ່ພ້ອມ"), detail: tl("ต้องใช้งานผ่าน Electron app", "Requires Electron app", "ຕ້ອງໃຊ້ Electron app"), life: 3000 });
    return;
  }
  if (String(form.value.cash_drawer_mode || "printer").toLowerCase() === "printer" && !form.value.cash_drawer_printer_name && !form.value.printer_name) {
    toast.add({
      severity: "warn",
      summary: tl("à¹„à¸¡à¹ˆà¸žà¸£à¹‰à¸­à¸¡", "Not ready", "àºšà»à»ˆàºžà»‰àº­àº¡"),
      detail: tl(
        "à¸¢à¸±à¸‡à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¸•à¸±à¹‰à¸‡à¸„à¹ˆà¸²à¹€à¸„à¸£à¸·à¹ˆà¸­à¸‡à¸žà¸´à¸¡à¸žà¹Œà¸ªà¸³à¸«à¸£à¸±à¸šà¹€à¸›à¸´à¸”à¸¥à¸´à¹‰à¸™à¸Šà¸±à¸",
        "Printer is not configured for the cash drawer",
        "àºàº±àº‡àºšà»à»ˆà»„àº”à»‰àº•àº±à»‰àº‡àº„à»ˆàº²à»€àº„àº·à»ˆàº­àº‡àºžàº´àº¡àºªàº³àº¥àº±àºšà»€àº›àºµàº”àº¥àºµà»‰àº™àºŠàº±àº",
      ),
      life: 3000,
    });
    return;
  }
  form.value.cash_drawer_drawer_id = normalizeCashDrawerId(form.value.cash_drawer_drawer_id);
  try {
    await window.bizsuitDevices.openCashDrawer({
      mode: form.value.cash_drawer_mode,
      printerName: form.value.cash_drawer_printer_name || form.value.printer_name || undefined,
      port: form.value.cash_drawer_port,
      baudRate: form.value.cash_drawer_baud_rate,
      drawerId: form.value.cash_drawer_drawer_id,
      openBytesHex: form.value.cash_drawer_open_bytes_hex,
    });
    toast.add({ severity: "success", summary: tl("เปิดลิ้นชักแล้ว", "Drawer opened", "ເປີດລີ້ນຊັກແລ້ວ"), life: 2000 });
  } catch (err) {
    toast.add({ severity: "error", summary: tl("เปิดลิ้นชักไม่สำเร็จ", "Drawer failed", "ເປີດລີ້ນຊັກບໍ່ສຳເລັດ"), detail: err.message, life: 4000 });
  }
}

onMounted(async () => {
  loadForm();
  await Promise.all([loadPosMachinesForSettings(), loadPrinters(), loadPaymentMastersForSettings(), loadSaleDocFormatsForSettings(), loadCustomerDisplayMedia()]);
});
</script>

<template>
  <div class="settings-view">
    <Toast />
    <div class="settings-header">
      <h2 class="settings-title">
        <i class="pi pi-cog" />
        {{ tl("ตั้งค่าอุปกรณ์", "Device Settings", "ຕັ້ງຄ່າອຸປະກອນ") }}
      </h2>
      <div class="pos-badge" v-if="form.configured_pos_id">POS: {{ form.configured_pos_id }}</div>
    </div>
    <div class="field" style="max-width: 30rem;">
      <label>{{ tl("เครื่อง POS ประจำเครื่องนี้", "POS machine for this device", "POS ປະຈຳເຄື່ອງນີ້") }}</label>
      <Select
        v-model="form.configured_pos_id"
        :options="configuredPosOptions"
        option-label="label"
        option-value="value"
        :placeholder="tl('เลือกเครื่อง POS', 'Select POS machine', 'ເລືອກ POS')"
        :loading="posMachineLoading"
        filter
        class="w-full"
      />
      <small class="field-help">
        {{
          tl(
            "หลัง login หน้าเลือก POS จะแสดงเครื่องนี้เป็นตัวเลือกหลัก และค่าตั้งค่าอุปกรณ์จะจำไว้กับเครื่องนี้",
            "After login, POS selection will show this configured machine first. Device settings stay with this device.",
            "ຫຼັງ login ໜ້າເລືອກ POS ຈະສະແດງເຄື່ອງນີ້ເປັນຕົວເລືອກຫຼັກ",
          )
        }}
      </small>
    </div>
    <div class="field" style="max-width: 30rem;">
      <label>{{ tl("รหัสเอกสารเริ่มต้น", "Default sale document code", "ລະຫັດເອກະສານຂາຍເລີ່ມຕົ້ນ") }}</label>
      <Select
        v-model="form.default_sale_doc_format_code"
        :options="defaultSaleDocFormatOptions"
        option-label="label"
        option-value="value"
        :placeholder="tl('ใช้ค่าเริ่มต้นตาม POS', 'Use POS default', 'ໃຊ້ຄ່າເລີ່ມຕົ້ນຕາມ POS')"
        :loading="saleDocFormatLoading"
        show-clear
        filter
        class="w-full"
      />
      <small class="field-help">
        {{
          tl(
            "เมื่อเปิดบิลใหม่ หน้าจอขายจะเลือกรหัสนี้เป็นค่าเริ่มต้น และยังเปลี่ยนเองในหน้าขายได้",
            "New sales will start with this document code. It can still be changed on the sale screen.",
            "ເມື່ອເປີດບິນໃໝ່ ໜ້າຂາຍຈະໃຊ້ລະຫັດນີ້ເປັນຄ່າເລີ່ມຕົ້ນ ແລະຍັງປ່ຽນໄດ້ໃນໜ້າຂາຍ",
          )
        }}
      </small>
    </div>
    <div class="field" style="max-width: 30rem;">
      <label>{{ tl("คลังที่ขายได้", "Allowed sale warehouses", "ຄັງທີ່ຂາຍໄດ້") }}</label>
      <InputText v-model="form.allowed_sale_wh_codes" placeholder="ST01,ST02,ST03" class="w-full" />
      <small class="field-help">
        {{
          tl(
            "พิมพ์รหัสคลังคั่นด้วย comma; ถ้าเว้นว่างจะขายได้ทุกคลังตามสิทธิ์เดิม",
            "Enter comma-separated warehouse codes. Leave blank to allow all existing warehouse choices.",
            "ປ້ອນລະຫັດຄັງຂັ້ນດ້ວຍ comma; ປ່ອຍວ່າງເພື່ອໃຊ້ທຸກຄັງເດີມ",
          )
        }}
      </small>
    </div>

    <div v-if="!isElectron" class="electron-notice">
      <i class="pi pi-info-circle" />
      {{ tl("การเลือก Printer ใช้ได้เฉพาะใน Electron app เท่านั้น", "Printer selection is only available in the Electron app.", "ການເລືອກ Printer ໃຊ້ໄດ້ສະເພາະໃນ Electron app ເທົ່ານັ້ນ") }}
    </div>

    <div class="settings-grid grid">
      <!-- Printer / Cash Drawer Section -->
      <section class="settings-section settings-card device-settings-card col-12 lg:col-5 xl:col-4">
        <h3 class="section-title">
          <i class="pi pi-print" />
          {{ tl("เครื่องพิมพ์และลิ้นชัก", "Printer & Cash Drawer", "ເຄື່ອງພິມ ແລະ ລີ້ນຊັກ") }}
        </h3>

        <div class="field">
          <label>{{ tl("ประเภทเครื่องพิมพ์", "Printer type", "ປະເພດເຄື່ອງພິມ") }}</label>
          <SelectButton v-model="form.printer_mode" :options="printerModeOptions" option-label="label" option-value="value" />
        </div>

        <div class="field" v-if="form.printer_mode !== 'none'">
          <label>{{ tl("ชื่อเครื่องพิมพ์", "Printer name", "ຊື່ເຄື່ອງພິມ") }}</label>
          <Select
            v-if="isElectron && printerList.length"
            v-model="form.printer_name"
            :options="printerList"
            option-label="label"
            option-value="value"
            :placeholder="tl('เลือกเครื่องพิมพ์', 'Select printer', 'ເລືອກເຄື່ອງພິມ')"
            class="w-full"
          />
          <InputText v-else v-model="form.printer_name" :placeholder="tl('ชื่อเครื่องพิมพ์', 'Printer name', 'ຊື່ເຄື່ອງພິມ')" class="w-full" />
        </div>

        <div class="field" v-if="form.printer_mode !== 'none'">
          <label>{{ tl("พิมพ์อัตโนมัติหลังบันทึกขาย", "Auto-print after sale", "ພິມອັດຕະໂນມັດຫຼັງບັນທຶກຂາຍ") }}</label>
          <ToggleSwitch v-model="form.autoprint" />
        </div>

        <div class="field-actions" v-if="form.printer_mode === 'escpos'">
          <Button :label="tl('ทดสอบพิมพ์', 'Test print', 'ທົດສອບພິມ')" icon="pi pi-print" severity="secondary" size="small" @click="testPrint" />
        </div>

        <div class="settings-subsection drawer-subsection">
          <h4 class="subsection-title">
            <i class="pi pi-inbox" />
            {{ tl("ลิ้นชักเงิน", "Cash Drawer", "ລີ້ນຊັກເງິນ") }}
          </h4>

          <div class="field">
            <label>{{ tl("ประเภทการเชื่อมต่อ", "Connection type", "ປະເພດການເຊື່ອມຕໍ່") }}</label>
            <SelectButton v-model="form.cash_drawer_mode" :options="cashDrawerModeOptions" option-label="label" option-value="value" />
          </div>

          <!-- mode: printer -->
          <div class="field" v-if="form.cash_drawer_mode === 'printer'">
            <label>{{ tl("ผ่านเครื่องพิมพ์", "Via printer", "ຜ່ານເຄື່ອງພິມ") }}</label>
            <Select
              v-if="isElectron && printerList.length"
              v-model="form.cash_drawer_printer_name"
              :options="printerList"
              option-label="label"
              option-value="value"
              :placeholder="tl('เลือกเครื่องพิมพ์', 'Select printer', 'ເລືອກເຄື່ອງພິມ')"
              class="w-full"
            />
            <InputText v-else v-model="form.cash_drawer_printer_name" :placeholder="tl('ชื่อเครื่องพิมพ์', 'Printer name', 'ຊື່ເຄື່ອງພິມ')" class="w-full" />
          </div>

          <!-- mode: serial -->
          <template v-if="form.cash_drawer_mode === 'serial'">
            <div class="field">
              <label>COM Port</label>
              <InputText v-model="form.cash_drawer_port" placeholder="COM1" class="w-full" />
            </div>
            <div class="field">
              <label>Baud Rate</label>
              <InputNumber v-model="form.cash_drawer_baud_rate" :min="1200" :max="115200" class="w-full" />
            </div>
          </template>

          <!-- mode: usbcr / friusb -->
          <div class="field" v-if="form.cash_drawer_mode === 'usbcr' || form.cash_drawer_mode === 'friusb'">
            <label>{{ tl("เลือกลิ้นชัก", "Select drawer", "ເລືອກລິ້ນຊັກ") }}</label>
            <Select v-model="form.cash_drawer_drawer_id" :options="cashDrawerIdOptions" option-label="label" option-value="value" class="w-full" />
            <small v-if="form.cash_drawer_mode === 'usbcr'" class="field-help">
              {{ tl("กดสแกนช่องเพื่อหาหมายเลขลิ้นชักที่ตอบสนองจาก usbcr.dll", "Scan channels to find the drawer ID that responds through usbcr.dll.", "ກົດສະແກນເພື່ອຫາໝາຍເລກລິ້ນຊັກທີ່ຕອບສະໜອງຜ່ານ usbcr.dll") }}
            </small>
            <small v-else class="field-help">
              {{ tl("FRIUSB ไม่รองรับการเลือกช่อง ระบบจะเปิดผ่านไดรเวอร์โดยตรง", "FRIUSB does not expose drawer channels; it opens through the driver directly.", "FRIUSB ບໍ່ຮອງຮັບການເລືອກຊ່ອງ") }}
            </small>
          </div>

          <div class="field-actions">
            <Button v-if="form.cash_drawer_mode === 'usbcr'" :label="tl('สแกนช่อง', 'Scan channels', 'ສະແກນຊ່ອງ')" icon="pi pi-search" severity="secondary" size="small" :loading="cashDrawerScanning" @click="scanUsbCrCashDrawers" />
            <Button :label="tl('ทดสอบเปิดลิ้นชัก', 'Test drawer', 'ທົດສອບລີ້ນຊັກ')" icon="pi pi-inbox" severity="secondary" size="small" @click="testCashDrawer" />
          </div>

          <div v-if="form.cash_drawer_mode === 'usbcr' && (cashDrawerScanResults.length || cashDrawerScanError)" class="drawer-scan-panel">
            <div v-if="cashDrawerScanError" class="drawer-scan-error">
              <i class="pi pi-exclamation-triangle" />
              {{ cashDrawerScanError }}
            </div>
            <template v-else>
              <button
                v-for="row in cashDrawerScanResults"
                :key="row.drawerId"
                type="button"
                class="drawer-scan-item"
                :class="cashDrawerScanResultClass(row)"
                :disabled="!row.available"
                @click="selectScannedCashDrawer(row)"
              >
                <span>{{ cashDrawerBaseLabel(row.drawerId) }}</span>
                <small>{{ cashDrawerStateLabel(row) }}</small>
              </button>
            </template>
          </div>
        </div>
      </section>

      <section class="settings-section settings-card customer-display-config col-12 lg:col-7 xl:col-8">
        <h3 class="section-title">
          <i class="pi pi-desktop" />
          {{ tl("จอลูกค้า", "Customer Display", "ຈໍລູກຄ້າ") }}
        </h3>

        <div class="field inline-field">
          <label>{{ tl("เปิดจอลูกค้าอัตโนมัติเมื่อเข้าหน้าขาย", "Auto-open on sale screen", "ເປີດຈໍລູກຄ້າອັດຕະໂນມັດ") }}</label>
          <ToggleSwitch v-model="form.customer_display_auto_open" />
        </div>

        <div class="field">
          <label>{{ tl("สกุลเงินที่แสดงบนจอลูกค้า", "Customer display currency", "ສະກຸນເງິນທີ່ສະແດງໃນຈໍລູກຄ້າ") }}</label>
          <Select v-model="form.customer_display_currency_code" :options="customerDisplayCurrencyOptions" option-label="label" option-value="value" class="w-full" />
          <small class="field-help">
            {{ tl("ใช้เฉพาะการแสดงผลบนจอลูกค้า ไม่เปลี่ยนยอดเอกสารหลัก", "Display only. The sale document remains in the home currency.", "ສະແດງຜົນເທົ່ານັ້ນ ບໍ່ປ່ຽນຍອດເອກະສານ") }}
          </small>
        </div>

        <div class="field">
          <label>{{ tl("รายการโฆษณา ขวาล่าง", "Right-bottom advertisement media", "ລາຍການໂຄສະນາ ຂວາລຸ່ມ") }}</label>
          <div class="media-manager">
            <div class="media-manager-head">
              <small>{{ tl("ไฟล์กลาง ใช้ร่วมกันทุกเครื่อง POS", "Shared media for every POS", "ສື່ກາງໃຊ້ຮ່ວມກັນທຸກ POS") }}</small>
              <Button :label="tl('อัปโหลด', 'Upload', 'ອັບໂຫຼດ')" icon="pi pi-upload" size="small" :loading="mediaUploading && mediaUploadZone === 'right'" @click="openMediaFilePicker('right')" />
              <input ref="mediaFileInput" type="file" class="hidden-file-input" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/ogg" multiple @change="uploadMediaFiles" />
            </div>

            <div v-if="mediaError" class="media-error">
              <i class="pi pi-exclamation-triangle" />
              {{ mediaError }}
            </div>
            <div v-if="mediaLoading" class="media-empty">
              <i class="pi pi-spinner pi-spin" />
              {{ tl("กำลังโหลดสื่อ", "Loading media", "ກຳລັງໂຫຼດສື່") }}
            </div>
            <div v-else-if="!rightMediaItems.length" class="media-empty">
              <i class="pi pi-images" />
              {{ tl("ยังไม่มีสื่อโฆษณา กดอัปโหลดเพื่อเริ่มใช้งาน", "No media yet. Upload to start.", "ຍັງບໍ່ມີສື່") }}
            </div>
            <div v-else class="media-list">
              <article v-for="(item, index) in rightMediaItems" :key="item.id" class="media-item" :class="{ disabled: item.enabled === false }">
                <div class="media-preview">
                  <video v-if="item.media_type === 'video'" :src="item.url" muted playsinline />
                  <img v-else :src="item.url" :alt="item.title || item.original_name" />
                  <span class="media-type">{{ item.media_type === "video" ? "VIDEO" : "IMAGE" }}</span>
                </div>
                <div class="media-info">
                  <InputText v-model.trim="item.title" class="w-full" :placeholder="tl('ชื่อสื่อ', 'Media title', 'ຊື່ສື່')" @blur="saveMediaItem(item)" />
                  <div class="media-meta">
                    <span>{{ item.original_name || item.file_name }}</span>
                    <span>{{ formatMediaSize(item.file_size) }}</span>
                  </div>
                  <div class="media-controls">
                    <label class="media-toggle">
                      <ToggleSwitch v-model="item.enabled" @change="saveMediaItem(item)" />
                      <span>{{ item.enabled === false ? tl("ปิด", "Off", "ປິດ") : tl("เปิด", "On", "ເປີດ") }}</span>
                    </label>
                    <label v-if="item.media_type === 'video'" class="media-toggle">
                      <ToggleSwitch v-model="item.sound_enabled" @change="saveMediaItem(item)" />
                      <span>{{ item.sound_enabled === true ? tl("เปิดเสียง", "Sound on", "ເປີດສຽງ") : tl("ปิดเสียง", "Muted", "ປິດສຽງ") }}</span>
                    </label>
                    <InputNumber v-if="item.media_type !== 'video'" v-model="item.duration_seconds" :min="1" :max="300" suffix=" s" size="small" class="media-duration" @blur="saveMediaItem(item)" />
                  </div>
                </div>
                <div class="media-actions">
                  <Button icon="pi pi-arrow-up" text rounded size="small" :disabled="index === 0" @click="moveMediaItem(rightMediaItems, index, -1)" />
                  <Button icon="pi pi-arrow-down" text rounded size="small" :disabled="index === rightMediaItems.length - 1" @click="moveMediaItem(rightMediaItems, index, 1)" />
                  <Button icon="pi pi-trash" text rounded severity="danger" size="small" @click="removeMediaItem(item)" />
                </div>
              </article>
            </div>
          </div>
          <small class="field-help">
            {{
              tl(
                "อัปโหลดรูปหรือวิดีโอสำหรับช่องโฆษณามุมขวาล่าง แนะนำ 600 x 500 px หรืออัตราส่วน 4:3",
                "Upload images or videos for the right-bottom ad slot. Recommended: 600 x 500 px or 4:3 ratio.",
                "ອັບໂຫຼດຮູບ ຫຼື ວິດີໂອສຳລັບຊ່ອງຂວາລຸ່ມ ແນະນຳ 600 x 500 px ຫຼື 4:3",
              )
            }}
          </small>
        </div>

        <div class="field">
          <label>{{ tl("รูปแบบกล่องโฆษณา ล่างซ้าย/ขวา", "Ad box layout (bottom left/right)", "ຮູບແບບກ່ອງໂຄສະນາ ລຸ່ມຊ້າຍ/ຂວາ") }}</label>
          <SelectButton
            v-model="form.customer_display_summary_layout"
            :options="summaryPanelLayoutOptions"
            option-label="label"
            option-value="value"
            :allow-empty="false"
            class="summary-layout-selector"
          />
          <small class="field-help">
            {{
              tl(
                "เลือก 1 ช่องเพื่อรวมพื้นที่โฆษณาด้านล่าง หรือ 2 ช่องเพื่อแยกอัปโหลดโฆษณาซ้าย/ขวา โดยใช้อัตราส่วน 960 x 360 px (8:3) ในโหมด 2 ช่อง และ 1920 x 400 px (24:5),1920 x 360 px (16:3) ในโหมด 1 ช่อง",
                "Choose one merged bottom ad slot or two separately managed bottom ad slots. uses 16:3 in two-slot mode and 24:5 in one-slot mode.",
                "ເລືອກ 1 ຊ່ອງ ຫຼື 2 ຊ່ອງ ໂດຍ ໃຊ້ 960 x 360 px (8:3) ໃນໂໝດ 2 ຊ່ອງ ແລະ 1920 x 400 px (24:5),1920 x 360 px (16:3) ໃນໂໝດ 1 ຊ່ອງ",
              )
            }}
          </small>
        </div>

        <div class="field">
          <label>{{ tl("รายการโฆษณา ช่องที่ 1", "Ad slot 1", "ລາຍການໂຄສະນາ ຊ່ອງ 1") }}</label>
          <div class="media-manager">
            <div class="media-manager-head">
              <small>{{
                tl("แสดงในกล่องโฆษณาด้านล่างของจอลูกค้า แยกจากมุมขวาล่าง", "Shown in the bottom summary ad boxes, separate from right-bottom ads.", "ສະແດງໃນກ່ອງໂຄສະນາດ້ານລຸ່ມ ແຍກຈາກຂວາລຸ່ມ")
              }}</small>
              <Button :label="tl('อัปโหลด', 'Upload', 'ອັບໂຫຼດ')" icon="pi pi-upload" size="small" :loading="mediaUploading && mediaUploadZone === 'summary'" @click="openMediaFilePicker('summary')" />
            </div>

            <div v-if="mediaError" class="media-error">
              <i class="pi pi-exclamation-triangle" />
              {{ mediaError }}
            </div>
            <div v-if="mediaLoading" class="media-empty">
              <i class="pi pi-spinner pi-spin" />
              {{ tl("กำลังโหลดสื่อ", "Loading media", "ກຳລັງໂຫຼດສື່") }}
            </div>
            <div v-else-if="!summaryMediaItems.length" class="media-empty">
              <i class="pi pi-images" />
              {{ tl("ยังไม่มีสื่อโฆษณา ", "No media yet.", "ຍັງບໍ່ມີສື່ໂຄສະນາ ") }}
            </div>
            <div v-else class="media-list">
              <article v-for="(item, index) in summaryMediaItems" :key="item.id" class="media-item" :class="{ disabled: item.enabled === false }">
                <div class="media-preview">
                  <video v-if="item.media_type === 'video'" :src="item.url" muted playsinline />
                  <img v-else :src="item.url" :alt="item.title || item.original_name" />
                  <span class="media-type">{{ item.media_type === "video" ? "VIDEO" : "IMAGE" }}</span>
                </div>
                <div class="media-info">
                  <InputText v-model.trim="item.title" class="w-full" :placeholder="tl('ชื่อสื่อ', 'Media title', 'ຊື່ສື່')" @blur="saveMediaItem(item)" />
                  <div class="media-meta">
                    <span>{{ item.original_name || item.file_name }}</span>
                    <span>{{ formatMediaSize(item.file_size) }}</span>
                  </div>
                  <div class="media-controls">
                    <label class="media-toggle">
                      <ToggleSwitch v-model="item.enabled" @change="saveMediaItem(item)" />
                      <span>{{ item.enabled === false ? tl("ปิด", "Off", "ປິດ") : tl("เปิด", "On", "ເປີດ") }}</span>
                    </label>
                    <label v-if="item.media_type === 'video'" class="media-toggle">
                      <ToggleSwitch v-model="item.sound_enabled" @change="saveMediaItem(item)" />
                      <span>{{ item.sound_enabled === true ? tl("เปิดเสียง", "Sound on", "ເປີດສຽງ") : tl("ปิดเสียง", "Muted", "ປິດສຽງ") }}</span>
                    </label>
                    <InputNumber v-if="item.media_type !== 'video'" v-model="item.duration_seconds" :min="1" :max="300" suffix=" s" size="small" class="media-duration" @blur="saveMediaItem(item)" />
                  </div>
                </div>
                <div class="media-actions">
                  <Button icon="pi pi-arrow-up" text rounded size="small" :disabled="index === 0" @click="moveMediaItem(summaryMediaItems, index, -1)" />
                  <Button icon="pi pi-arrow-down" text rounded size="small" :disabled="index === summaryMediaItems.length - 1" @click="moveMediaItem(summaryMediaItems, index, 1)" />
                  <Button icon="pi pi-trash" text rounded severity="danger" size="small" @click="removeMediaItem(item)" />
                </div>
              </article>
            </div>
          </div>
          <small class="field-help">
            {{
              form.customer_display_summary_layout === "single"
                ? tl(
                    "โหมด 1 ช่อง: แนะนำ 1920 x 400 px (อัตราส่วน 24:5) หรือ 1920 x 360 px (16:3)",
                    "One-slot mode: recommended 1920 x 400 px (24:5) or 1920 x 360 px (16:3).",
                    "ໂໝດ 1 ຊ່ອງ: ແນະນຳ 1920 x 400 px (24:5) ຫຼື 1920 x 360 px (16:3)",
                  )
                : tl("โหมด 2 ช่อง ช่องที่ 1: แนะนำ 960 x 360 px (อัตราส่วน 8:3)", "Two-slot mode, slot 1: recommended 960 x 360 px (8:3).", "ໂໝດ 2 ຊ່ອງ ຊ່ອງ 1: ແນະນຳ 960 x 360 px (8:3)")
            }}
          </small>
        </div>

        <div v-if="form.customer_display_summary_layout !== 'single'" class="field">
          <label>{{ tl("รายการโฆษณา Summary Panel ช่องที่ 2", "Summary-panel ad slot 2", "ລາຍການໂຄສະນາ Summary Panel ຊ່ອງ 2") }}</label>
          <div class="media-manager">
            <div class="media-manager-head">
              <small>{{
                tl("แสดงในกล่องโฆษณาด้านล่างช่องที่สอง เมื่อเลือกโหมด 2 ช่อง", "Shown in the second bottom ad box when two-slot mode is selected.", "ສະແດງໃນກ່ອງໂຄສະນາດ້ານລຸ່ມຊ່ອງທີ 2")
              }}</small>
              <Button
                :label="tl('อัปโหลด', 'Upload', 'ອັບໂຫຼດ')"
                icon="pi pi-upload"
                size="small"
                :loading="mediaUploading && mediaUploadZone === 'summary_secondary'"
                @click="openMediaFilePicker('summary_secondary')"
              />
            </div>

            <div v-if="mediaError" class="media-error">
              <i class="pi pi-exclamation-triangle" />
              {{ mediaError }}
            </div>
            <div v-if="mediaLoading" class="media-empty">
              <i class="pi pi-spinner pi-spin" />
              {{ tl("กำลังโหลดสื่อ", "Loading media", "ກຳລັງໂຫຼດສື່") }}
            </div>
            <div v-else-if="!summarySecondaryMediaItems.length" class="media-empty">
              <i class="pi pi-images" />
              {{ tl("ยังไม่มีสื่อโฆษณา ช่องที่ 2", "No slot 2 media yet.", "ຍັງບໍ່ມີສື່ໂຄສະນາຊ່ອງ 2") }}
            </div>
            <div v-else class="media-list">
              <article v-for="(item, index) in summarySecondaryMediaItems" :key="item.id" class="media-item" :class="{ disabled: item.enabled === false }">
                <div class="media-preview">
                  <video v-if="item.media_type === 'video'" :src="item.url" muted playsinline />
                  <img v-else :src="item.url" :alt="item.title || item.original_name" />
                  <span class="media-type">{{ item.media_type === "video" ? "VIDEO" : "IMAGE" }}</span>
                </div>
                <div class="media-info">
                  <InputText v-model.trim="item.title" class="w-full" :placeholder="tl('ชื่อสื่อ', 'Media title', 'ຊື່ສື່')" @blur="saveMediaItem(item)" />
                  <div class="media-meta">
                    <span>{{ item.original_name || item.file_name }}</span>
                    <span>{{ formatMediaSize(item.file_size) }}</span>
                  </div>
                  <div class="media-controls">
                    <label class="media-toggle">
                      <ToggleSwitch v-model="item.enabled" @change="saveMediaItem(item)" />
                      <span>{{ item.enabled === false ? tl("ปิด", "Off", "ປິດ") : tl("เปิด", "On", "ເປີດ") }}</span>
                    </label>
                    <label v-if="item.media_type === 'video'" class="media-toggle">
                      <ToggleSwitch v-model="item.sound_enabled" @change="saveMediaItem(item)" />
                      <span>{{ item.sound_enabled === true ? tl("เปิดเสียง", "Sound on", "ເປີດສຽງ") : tl("ปิดเสียง", "Muted", "ປິດສຽງ") }}</span>
                    </label>
                    <InputNumber v-if="item.media_type !== 'video'" v-model="item.duration_seconds" :min="1" :max="300" suffix=" s" size="small" class="media-duration" @blur="saveMediaItem(item)" />
                  </div>
                </div>
                <div class="media-actions">
                  <Button icon="pi pi-arrow-up" text rounded size="small" :disabled="index === 0" @click="moveMediaItem(summarySecondaryMediaItems, index, -1)" />
                  <Button icon="pi pi-arrow-down" text rounded size="small" :disabled="index === summarySecondaryMediaItems.length - 1" @click="moveMediaItem(summarySecondaryMediaItems, index, 1)" />
                  <Button icon="pi pi-trash" text rounded severity="danger" size="small" @click="removeMediaItem(item)" />
                </div>
              </article>
            </div>
          </div>
          <small class="field-help">
            {{ tl("โหมด 2 ช่อง ช่องที่ 2: แนะนำ 960 x 360 px (อัตราส่วน 8:3)", "Two-slot mode, slot 2: recommended 960 x 360 px (8:3).", "ໂໝດ 2 ຊ່ອງ ຊ່ອງ 2: ແນະນຳ 960 x 360 px (8:3)") }}
          </small>
        </div>

        <div class="field-actions split-actions">
          <Button
            class="customer-display-test-btn"
            :label="tl('ทดสอบจอลูกค้า', 'Test display', 'ທົດສອບຈໍ')"
            icon="pi pi-desktop"
            severity="success"
            size="small"
            :loading="customerDisplayOpening"
            @click="testCustomerDisplay"
          />
          <Button
            class="customer-display-close-btn"
            :label="tl('ปิดจอลูกค้า', 'Close display', 'ປິດຈໍ')"
            icon="pi pi-times"
            severity="danger"
            outlined
            size="small"
            :disabled="!customerDisplayAvailable"
            @click="closeCustomerDisplay"
          />
        </div>
      </section>
    </div>

    <div class="settings-footer">
      <Button :label="tl('บันทึก', 'Save', 'ບັນທຶກ')" icon="pi pi-save" @click="save" />
    </div>
  </div>
</template>

<style scoped>
.settings-view {
  width: 100%;
  max-width: none;
  margin: 0;
  padding: 1.25rem;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.settings-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1.25rem;
  font-weight: 700;
  margin: 0;
  color: #1f2937;
}

.pos-badge {
  font-size: 0.8rem;
  font-weight: 700;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  background: #eff6ff;
  border: 1px solid #bae6fd;
  color: #0284c7;
}

.electron-notice {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  color: #1d4ed8;
  font-size: 0.875rem;
  margin-bottom: 1rem;
}

.settings-grid {
  align-items: stretch;
}

.settings-section {
  min-width: 0;
}

.settings-card {
  min-height: 100%;
  padding: 1rem;
  border: 1px solid rgba(249, 115, 22, 0.24);
  /* border-radius: 14px; */
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 16px 36px rgba(194, 65, 12, 0.08);
}

.section-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1rem;
  font-weight: 600;
  color: #374151;
  margin: 0 0 1rem 0;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid #dbeafe;
}

.settings-subsection {
  margin-top: 1.15rem;
  padding-top: 1rem;
  border-top: 1px solid #dbeafe;
}

.subsection-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.85rem;
  color: #374151;
  font-size: 0.98rem;
  font-weight: 850;
}

.subsection-title i {
  color: #0ea5e9;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-bottom: 1rem;
}

.summary-layout-selector {
  width: fit-content;
  max-width: 100%;
}

.field label {
  font-size: 0.875rem;
  font-weight: 600;
  color: #6b7280;
}

.inline-field {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.field-help {
  color: #075985;
  font-size: 0.78rem;
  font-weight: 600;
}

.drawer-scan-panel {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.drawer-scan-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  min-height: 3.4rem;
  padding: 0.55rem 0.65rem;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f9fafb;
  color: #6b7280;
  font: inherit;
  text-align: left;
}

.drawer-scan-item.detected {
  cursor: pointer;
  border-color: #86efac;
  background: #f0fdf4;
  color: #166534;
}

.drawer-scan-item.selected {
  border-color: #38bdf8;
  box-shadow: 0 0 0 2px rgba(251, 146, 60, 0.18);
}

.drawer-scan-item:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.drawer-scan-item span {
  font-size: 0.85rem;
  font-weight: 800;
}

.drawer-scan-item small {
  font-size: 0.72rem;
  font-weight: 650;
}

.drawer-scan-error {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  grid-column: 1 / -1;
  padding: 0.65rem 0.75rem;
  border: 1px solid #fecaca;
  border-radius: 8px;
  background: #fef2f2;
  color: #b91c1c;
  font-size: 0.8rem;
  font-weight: 700;
}

.customer-display-config {
  padding: 1rem;
  /* border: 1px solid rgba(249, 115, 22, 0.42); */

  /* background: linear-gradient(180deg, rgba(255, 247, 237, 0.96), rgba(255, 255, 255, 0.98)), #fff; */
  box-shadow: 0 18px 42px rgba(194, 65, 12, 0.1);
}

.customer-display-config .section-title {
  padding-bottom: 0.8rem;
  border-bottom: 1px solid #bae6fd;
  color: #0369a1;
  font-size: 1.1rem;
  font-weight: 900;
}

.customer-display-config .section-title i {
  color: #0ea5e9;
}

.customer-display-config .field {
  padding: 0.85rem;
  border: 1px solid #dbeafe;
  border-radius: 12px;
  background: rgba(255, 250, 245, 0.88);
}

.customer-display-config .field label {
  color: #075985;
  font-weight: 850;
}

.customer-display-config .inline-field {
  min-height: 3.25rem;
}

.customer-display-config :deep(.p-select),
.customer-display-config :deep(.p-inputtext),
.customer-display-config :deep(.p-textarea) {
  border-color: #7dd3fc;
  border-radius: 10px;
  background: #fff;
  color: #1f2937;
  box-shadow: none;
}

.customer-display-config :deep(.p-select:not(.p-disabled):hover),
.customer-display-config :deep(.p-inputtext:hover),
.customer-display-config :deep(.p-textarea:hover) {
  border-color: #38bdf8;
}

.customer-display-config :deep(.p-select.p-focus),
.customer-display-config :deep(.p-inputtext:enabled:focus),
.customer-display-config :deep(.p-textarea:enabled:focus) {
  border-color: #0ea5e9;
  box-shadow: 0 0 0 0.2rem rgba(249, 115, 22, 0.14);
}

.customer-display-config :deep(.p-toggleswitch.p-toggleswitch-checked .p-toggleswitch-slider) {
  background: #22c55e;
}

.customer-display-config .split-actions {
  padding-top: 0.25rem;
}

.media-manager {
  display: grid;
  gap: 0.75rem;
}

.media-manager + .field-help {
  display: none;
}

.media-manager-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.media-manager-head small {
  color: #075985;
  font-size: 0.78rem;
  font-weight: 750;
}

.hidden-file-input {
  display: none;
}

.media-error,
.media-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-height: 5rem;
  padding: 1rem;
  border: 1px dashed #7dd3fc;
  border-radius: 12px;
  background: #eff6ff;
  color: #075985;
  font-weight: 800;
  text-align: center;
}

.media-error {
  border-color: #fca5a5;
  background: #fef2f2;
  color: #b91c1c;
}

.media-list {
  display: grid;
  gap: 0.75rem;
  max-height: 32rem;
  overflow: auto;
  padding-right: 0.15rem;
}

.media-item {
  display: grid;
  grid-template-columns: 6.5rem minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: center;
  padding: 0.65rem;
  border: 1px solid #dbeafe;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.82);
}

.media-item.disabled {
  opacity: 0.58;
}

.media-preview {
  position: relative;
  overflow: hidden;
  width: 6.5rem;
  aspect-ratio: 16 / 9;
  border-radius: 10px;
  background: #111827;
}

.media-preview img,
.media-preview video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.media-type {
  position: absolute;
  right: 0.35rem;
  bottom: 0.35rem;
  padding: 0.12rem 0.35rem;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.75);
  color: #fff;
  font-size: 0.62rem;
  font-weight: 950;
}

.media-info {
  display: grid;
  min-width: 0;
  gap: 0.45rem;
}

.media-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  color: #64748b;
  font-size: 0.76rem;
  font-weight: 750;
}

.media-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
}

.media-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: #374151;
  font-size: 0.78rem;
  font-weight: 800;
}

.media-duration {
  max-width: 7.5rem;
}

.media-actions {
  display: grid;
  gap: 0.2rem;
}

@media (min-width: 1280px) {
  .customer-display-config .media-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: start;
  }

  .customer-display-config .media-item {
    grid-template-columns: 7.5rem minmax(0, 1fr) auto;
  }

  .customer-display-config .media-preview {
    width: 7.5rem;
  }
}

.customer-display-test-btn {
  min-width: 10rem;
  font-weight: 900;
}

.customer-display-close-btn {
  min-width: 9rem;
  font-weight: 850;
}

.field-actions {
  margin-bottom: 0;
}

.split-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.settings-footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 1rem;
  margin-top: 0.25rem;
}

.w-full {
  width: 100%;
}

@media (max-width: 767px) {
  .settings-view {
    padding: 0.85rem;
  }

  .settings-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .settings-card {
    padding: 0.85rem;
  }

  .media-item {
    grid-template-columns: 1fr;
  }

  .media-preview {
    width: 100%;
  }

  .media-actions {
    display: flex;
    justify-content: flex-end;
  }
}
</style>
