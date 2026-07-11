<script setup>
import {
  checkBarcodeInUse,
  checkUnitUseInUse,
  createProductItemBarcode,
  createProductItemUnitUse,
  deleteProductImage,
  deleteProductItemBarcode,
  deleteProductItemUnitUse,
  deleteProductPriceFormula,
  generateProductItemBarcode,
  getProductCategoryList,
  getProductImageGuidUrl,
  getProductImages,
  getProductItemBarcodes,
  getProductItemDetail,
  getProductItemUnitUse,
  getProductPriceFormulas,
  getUnitManageList,
  reorderProductImages,
  saveProductImage,
  saveProductPriceFormula,
  updateProductItemBarcode,
  updateProductItemMain,
  updateProductItemUnitUse,
} from "@/services/productManageService";
import Button from "primevue/button";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import Dialog from "primevue/dialog";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import { useToast } from "primevue/usetoast";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { PERMISSIONS } from "@/utils/permissions";

const route = useRoute();
const router = useRouter();
const toast = useToast();
const authStore = useAuthStore();

const itemCode = route.params.code;

// ส่วนที่ 1 — ข้อมูลหลัก
const form = ref({
  code: "",
  name_1: "",
  name_2: "",
  name_eng_1: "",
  name_eng_2: "",
  unit_standard: "",
  unit_cost: "",
  item_category: "",
  item_brand: "",
  group_main: "",
  group_sub: "",
  group_sub2: "",
  item_design: "",
  item_model: "",
});
const isLoadingMain = ref(false);
const isSavingMain = ref(false);

// dropdowns
const unitOptions = ref([]);
const categoryOptions = ref([]);

// ส่วนที่ 2 — บาร์โค้ด
const barcodes = ref([]);
const isLoadingBarcodes = ref(false);
const barcodeSearch = ref("");
const barcodePage = ref(1);
const BARCODE_PAGE_SIZE = 10;

const filteredBarcodes = computed(() => {
  const q = barcodeSearch.value.trim().toLowerCase();
  if (!q) return barcodes.value;
  return barcodes.value.filter((b) => b.barcode.toLowerCase().includes(q) || (b.unit_name || b.unit_code).toLowerCase().includes(q));
});
const barcodeTotalPages = computed(() => Math.max(1, Math.ceil(filteredBarcodes.value.length / BARCODE_PAGE_SIZE)));
const pagedBarcodes = computed(() => {
  const start = (barcodePage.value - 1) * BARCODE_PAGE_SIZE;
  return filteredBarcodes.value.slice(start, start + BARCODE_PAGE_SIZE);
});

const showBarcodeDialog = ref(false);
const barcodeMode = ref("create");
const barcodeForm = ref({ ic_code: itemCode, barcode: "", unit_code: "", price: 0, price_member: 0, price_2: 0, price_member_2: 0 });
const isGeneratingBarcode = ref(false);
const isSavingBarcode = ref(false);

// ส่วนที่ 3 — หน่วยนับ
const unitUseList = ref([]);
const isLoadingUnitUse = ref(false);
const showUnitUseDialog = ref(false);
const unitUseMode = ref("create");
const unitUseForm = ref({ ic_code: itemCode, code: "", stand_value: 1, divide_value: 1, row_order: 0, width_length_height: "", weight: "" });
const isSavingUnitUse = ref(false);

// ส่วนที่ 4 — รูปภาพ
const images = ref([]);
const isLoadingImages = ref(false);
const isSavingImage = ref(false);
const dragFromIndex = ref(-1);
const imageFileInput = ref(null);

// confirm dialog
const showConfirmDialog = ref(false);
const confirmMessage = ref("");
const confirmAction = ref(null);
const isDeleting = ref(false);
const isMobile = ref(false);

const MOBILE_BREAKPOINT = 768;
let mobileMediaQuery = null;

const unitUseRatio = computed(() => {
  const s = Number(unitUseForm.value.stand_value) || 0;
  const d = Number(unitUseForm.value.divide_value) || 0;
  if (d === 0) return 0;
  return Math.round((s / d) * 1000000) / 1000000;
});

const barcodeUnitOptions = computed(() => unitUseList.value.map((u) => ({ value: u.code, label: u.unit_name || u.code })));
const canEditImages = computed(() => authStore.hasPermission(PERMISSIONS.productImagesEdit));
const canEditMain = computed(() => authStore.hasPermission(PERMISSIONS.productMainEdit));
const canEditPriceFormula = computed(() => authStore.hasPermission(PERMISSIONS.productPriceFormulaEdit));
const canEditUnits = computed(() => authStore.hasPermission(PERMISSIONS.productUnitsEdit));
const canEditBarcodes = computed(() => authStore.hasPermission(PERMISSIONS.productBarcodesEdit));
const canViewImages = computed(() => authStore.hasPermission(PERMISSIONS.productImages) || canEditImages.value);
const canViewMain = computed(() => authStore.hasPermission(PERMISSIONS.productMain) || canEditMain.value);
const canViewPriceFormula = computed(() => authStore.hasPermission(PERMISSIONS.productPriceFormula) || canEditPriceFormula.value);
const canViewUnits = computed(() => authStore.hasPermission(PERMISSIONS.productUnits) || canEditUnits.value);
const canViewBarcodes = computed(() => authStore.hasPermission(PERMISSIONS.productBarcodes) || canEditBarcodes.value);
const hasAnyProductSection = computed(() =>
  canViewImages.value || canViewMain.value || canViewPriceFormula.value || canViewUnits.value || canViewBarcodes.value
);

watch(barcodeSearch, () => {
  barcodePage.value = 1;
});

async function reloadAll() {
  const tasks = [];
  if (canViewMain.value) tasks.push(loadMain());
  if (canViewBarcodes.value) tasks.push(loadBarcodes());
  if (canViewUnits.value || canViewBarcodes.value || canViewPriceFormula.value) tasks.push(loadUnitUse());
  if (canViewImages.value) tasks.push(loadImages());
  if (canViewPriceFormula.value) tasks.push(loadFormulas());
  await Promise.all(tasks);
}

async function loadMain() {
  isLoadingMain.value = true;
  try {
    const res = await getProductItemDetail(itemCode);
    if (res.success) Object.assign(form.value, res.data);
    else toast.add({ severity: "error", summary: "โหลดข้อมูลไม่สำเร็จ", detail: res.message, life: 3000 });
  } catch (e) {
    toast.add({ severity: "error", summary: "โหลดข้อมูลไม่สำเร็จ", detail: e.message, life: 3000 });
  } finally {
    isLoadingMain.value = false;
  }
}

async function loadBarcodes() {
  isLoadingBarcodes.value = true;
  try {
    const res = await getProductItemBarcodes(itemCode);
    if (res.success) barcodes.value = res.data || [];
  } catch (e) {
    toast.add({ severity: "error", summary: "โหลดบาร์โค้ดไม่สำเร็จ", detail: e.message, life: 3000 });
  } finally {
    isLoadingBarcodes.value = false;
  }
}

async function loadUnitUse() {
  isLoadingUnitUse.value = true;
  try {
    const res = await getProductItemUnitUse(itemCode);
    if (res.success) unitUseList.value = res.data || [];
  } catch (e) {
    toast.add({ severity: "error", summary: "โหลดหน่วยนับไม่สำเร็จ", detail: e.message, life: 3000 });
  } finally {
    isLoadingUnitUse.value = false;
  }
}

async function loadImages() {
  isLoadingImages.value = true;
  try {
    const res = await getProductImages(itemCode);
    if (res.success) images.value = res.data || [];
  } catch (e) {
    toast.add({ severity: "error", summary: "โหลดรูปภาพไม่สำเร็จ", detail: e.message, life: 3000 });
  } finally {
    isLoadingImages.value = false;
  }
}

async function saveMain() {
  if (!canEditMain.value) return;
  isSavingMain.value = true;
  try {
    const res = await updateProductItemMain({ ...form.value });
    if (res.success) {
      toast.add({ severity: "success", summary: "บันทึกสำเร็จ", life: 2000 });
      await reloadAll();
    } else {
      toast.add({ severity: "error", summary: "บันทึกไม่สำเร็จ", detail: res.message, life: 3000 });
    }
  } catch (e) {
    toast.add({ severity: "error", summary: "บันทึกไม่สำเร็จ", detail: e.message, life: 3000 });
  } finally {
    isSavingMain.value = false;
  }
}

// บาร์โค้ด
async function generateBarcode() {
  if (!canEditBarcodes.value || barcodeMode.value !== "create") return;
  isGeneratingBarcode.value = true;
  try {
    const res = await generateProductItemBarcode(itemCode);
    if (res.success && res.barcode) {
      barcodeForm.value.barcode = res.barcode;
    } else {
      toast.add({ severity: "error", summary: "Generate EAN-13 failed", detail: res.message, life: 3000 });
    }
  } catch (e) {
    toast.add({ severity: "error", summary: "Generate EAN-13 failed", detail: e.message, life: 3000 });
  } finally {
    isGeneratingBarcode.value = false;
  }
}

async function openAddBarcode() {
  if (!canEditBarcodes.value) return;
  barcodeMode.value = "create";
  barcodeForm.value = { ic_code: itemCode, barcode: "", unit_code: "", price: 0, price_member: 0, price_2: 0, price_member_2: 0 };
  showBarcodeDialog.value = true;
  await generateBarcode();
}

function openEditBarcode(row) {
  if (!canEditBarcodes.value) return;
  barcodeMode.value = "edit";
  barcodeForm.value = { ic_code: itemCode, ...row };
  showBarcodeDialog.value = true;
}

async function saveBarcode() {
  if (!canEditBarcodes.value) return;
  if (!barcodeForm.value.barcode.trim()) {
    toast.add({ severity: "warn", summary: "กรุณากรอกบาร์โค้ด", life: 2500 });
    return;
  }
  isSavingBarcode.value = true;
  try {
    const fn = barcodeMode.value === "create" ? createProductItemBarcode : updateProductItemBarcode;
    const res = await fn(barcodeForm.value);
    if (res.success) {
      toast.add({ severity: "success", summary: "บันทึกสำเร็จ", life: 2000 });
      showBarcodeDialog.value = false;
      await reloadAll();
    } else {
      toast.add({ severity: "error", summary: "บันทึกไม่สำเร็จ", detail: res.message, life: 3000 });
    }
  } catch (e) {
    toast.add({ severity: "error", summary: "บันทึกไม่สำเร็จ", detail: e.message, life: 3000 });
  } finally {
    isSavingBarcode.value = false;
  }
}

async function confirmDeleteBarcode(row) {
  if (!canEditBarcodes.value) return;
  try {
    const check = await checkBarcodeInUse(itemCode, row.barcode);
    if (check.in_use) {
      toast.add({ severity: "warn", summary: "ไม่สามารถลบได้", detail: `บาร์โค้ด "${row.barcode}" ถูกใช้งานในเอกสารแล้ว`, life: 4000 });
      return;
    }
  } catch (e) {
    toast.add({ severity: "error", summary: "เกิดข้อผิดพลาด", detail: e.message, life: 3000 });
    return;
  }
  confirmMessage.value = `ต้องการลบบาร์โค้ด "${row.barcode}" ใช่หรือไม่?`;
  confirmAction.value = async () => {
    const res = await deleteProductItemBarcode({ ic_code: itemCode, barcode: row.barcode });
    if (res.success) {
      toast.add({ severity: "success", summary: "ลบสำเร็จ", life: 2000 });
      await reloadAll();
    } else {
      toast.add({ severity: "error", summary: "ลบไม่สำเร็จ", detail: res.message, life: 3000 });
    }
  };
  showConfirmDialog.value = true;
}

async function executeConfirm() {
  if (!confirmAction.value) return;
  isDeleting.value = true;
  try {
    await confirmAction.value();
  } catch (e) {
    toast.add({ severity: "error", summary: "เกิดข้อผิดพลาด", detail: e.message, life: 3000 });
  } finally {
    isDeleting.value = false;
    showConfirmDialog.value = false;
    confirmAction.value = null;
  }
}

// หน่วยนับ
function openAddUnitUse() {
  if (!canEditUnits.value) return;
  unitUseMode.value = "create";
  unitUseForm.value = { ic_code: itemCode, code: "", stand_value: 1, divide_value: 1, row_order: 0, width_length_height: "", weight: "" };
  showUnitUseDialog.value = true;
}

function openEditUnitUse(row) {
  if (!canEditUnits.value) return;
  unitUseMode.value = "edit";
  unitUseForm.value = { ic_code: itemCode, ...row };
  showUnitUseDialog.value = true;
}

async function saveUnitUse() {
  if (!canEditUnits.value) return;
  if (!unitUseForm.value.code) {
    toast.add({ severity: "warn", summary: "กรุณาเลือกหน่วยนับ", life: 2500 });
    return;
  }
  isSavingUnitUse.value = true;
  try {
    const fn = unitUseMode.value === "create" ? createProductItemUnitUse : updateProductItemUnitUse;
    const res = await fn(unitUseForm.value);
    if (res.success) {
      toast.add({ severity: "success", summary: "บันทึกสำเร็จ", life: 2000 });
      showUnitUseDialog.value = false;
      await reloadAll();
    } else {
      toast.add({ severity: "error", summary: "บันทึกไม่สำเร็จ", detail: res.message, life: 3000 });
    }
  } catch (e) {
    toast.add({ severity: "error", summary: "บันทึกไม่สำเร็จ", detail: e.message, life: 3000 });
  } finally {
    isSavingUnitUse.value = false;
  }
}

async function confirmDeleteUnitUse(row) {
  if (!canEditUnits.value) return;
  try {
    const check = await checkUnitUseInUse(itemCode, row.code);
    if (check.in_use) {
      toast.add({ severity: "warn", summary: "ไม่สามารถลบได้", detail: `หน่วยนับ "${row.code}" ถูกใช้งานในเอกสารแล้ว`, life: 4000 });
      return;
    }
  } catch (e) {
    toast.add({ severity: "error", summary: "เกิดข้อผิดพลาด", detail: e.message, life: 3000 });
    return;
  }
  confirmMessage.value = `ต้องการลบหน่วยนับ "${row.code} - ${row.unit_name}" ใช่หรือไม่?`;
  confirmAction.value = async () => {
    const res = await deleteProductItemUnitUse({ ic_code: itemCode, code: row.code });
    if (res.success) {
      toast.add({ severity: "success", summary: "ลบสำเร็จ", life: 2000 });
      await loadUnitUse();
    } else {
      toast.add({ severity: "error", summary: "ลบไม่สำเร็จ", detail: res.message, life: 3000 });
    }
  };
  showConfirmDialog.value = true;
}

// รูปภาพ
function onClickAddImage() {
  if (!canEditImages.value) return;
  if (imageFileInput.value) imageFileInput.value.click();
}

function onImageFileSelected(event) {
  if (!canEditImages.value) return;
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = "";
  const reader = new FileReader();
  reader.onload = async (e) => {
    isSavingImage.value = true;
    try {
      const res = await saveProductImage(itemCode, e.target.result);
      if (res.success) {
        toast.add({ severity: "success", summary: "เพิ่มรูปภาพสำเร็จ", life: 2000 });
        await loadImages();
      } else {
        toast.add({ severity: "error", summary: "เพิ่มรูปภาพไม่สำเร็จ", detail: res.message, life: 3000 });
      }
    } catch (err) {
      toast.add({ severity: "error", summary: "เพิ่มรูปภาพไม่สำเร็จ", detail: err.message, life: 3000 });
    } finally {
      isSavingImage.value = false;
    }
  };
  reader.readAsDataURL(file);
}

function confirmDeleteImage(img) {
  if (!canEditImages.value) return;
  confirmMessage.value = "ต้องการลบรูปภาพนี้ใช่หรือไม่?";
  confirmAction.value = async () => {
    const res = await deleteProductImage(img.guid_code);
    if (res.success) {
      toast.add({ severity: "success", summary: "ลบรูปภาพสำเร็จ", life: 2000 });
      await loadImages();
    } else {
      toast.add({ severity: "error", summary: "ลบไม่สำเร็จ", detail: res.message, life: 3000 });
    }
  };
  showConfirmDialog.value = true;
}

function onDragStart(index) {
  if (!canEditImages.value) return;
  dragFromIndex.value = index;
}
function onDragOver(event, index) {
  if (!canEditImages.value) return;
  event.preventDefault();
  if (dragFromIndex.value === -1 || dragFromIndex.value === index) return;
  const arr = [...images.value];
  const dragged = arr.splice(dragFromIndex.value, 1)[0];
  arr.splice(index, 0, dragged);
  images.value = arr;
  dragFromIndex.value = index;
}
function onDragEnd() {
  dragFromIndex.value = -1;
}

async function saveImageOrder() {
  if (!canEditImages.value) return;
  try {
    const orders = images.value.map((img, idx) => ({ guid_code: img.guid_code, image_order: idx + 1 }));
    const res = await reorderProductImages(itemCode, orders);
    if (res.success) {
      toast.add({ severity: "success", summary: "บันทึกลำดับสำเร็จ", life: 2000 });
      await loadImages();
    } else {
      toast.add({ severity: "error", summary: "บันทึกลำดับไม่สำเร็จ", detail: res.message, life: 3000 });
    }
  } catch (e) {
    toast.add({ severity: "error", summary: "บันทึกลำดับไม่สำเร็จ", detail: e.message, life: 3000 });
  }
}

// ส่วนที่ 5 — สูตรราคาขาย
const priceFormulas = ref([]);
const isLoadingFormulas = ref(false);
const showFormulaDialog = ref(false);
const formulaMode = ref("create");
const isSavingFormula = ref(false);

const EMPTY_FORMULA = () => ({
  ic_code: itemCode,
  unit_code: "",
  sale_type: 0,
  tax_type: 0,
  price_0: "",
  price_1: "",
  price_2: "",
  price_3: "",
  price_4: "",
  price_5: "",
  price_6: "",
  price_7: "",
  price_8: "",
  price_9: "",
});
const formulaForm = ref(EMPTY_FORMULA());

const SALE_TYPE_OPTIONS = [
  { value: 0, label: "ไม่เลือก" },
  { value: 1, label: "ขายสด" },
  { value: 2, label: "ขายเชื่อ" },
];
const TAX_TYPE_OPTIONS = [
  { value: 0, label: "ไม่เลือก" },
  { value: 1, label: "แยกนอก" },
  { value: 2, label: "รวมใน" },
  { value: 3, label: "ภาษีศูนย์" },
];

function saleTypeLabel(v) {
  return SALE_TYPE_OPTIONS.find((o) => o.value === Number(v))?.label ?? v;
}
function taxTypeLabel(v) {
  return TAX_TYPE_OPTIONS.find((o) => o.value === Number(v))?.label ?? v;
}

async function loadFormulas() {
  isLoadingFormulas.value = true;
  try {
    const res = await getProductPriceFormulas(itemCode);
    if (res.success) priceFormulas.value = res.data || [];
  } catch (e) {
    toast.add({ severity: "error", summary: "โหลดสูตรราคาไม่สำเร็จ", detail: e.message, life: 3000 });
  } finally {
    isLoadingFormulas.value = false;
  }
}

function openAddFormula() {
  if (!canEditPriceFormula.value) return;
  formulaMode.value = "create";
  formulaForm.value = EMPTY_FORMULA();
  showFormulaDialog.value = true;
}

function openEditFormula(row) {
  if (!canEditPriceFormula.value) return;
  formulaMode.value = "edit";
  formulaForm.value = {
    ic_code: itemCode,
    unit_code: row.unit_code,
    sale_type: Number(row.sale_type),
    tax_type: Number(row.tax_type),
    price_0: row.price_0,
    price_1: row.price_1,
    price_2: row.price_2,
    price_3: row.price_3,
    price_4: row.price_4,
    price_5: row.price_5,
    price_6: row.price_6,
    price_7: row.price_7,
    price_8: row.price_8,
    price_9: row.price_9,
  };
  showFormulaDialog.value = true;
}

async function saveFormula() {
  if (!canEditPriceFormula.value) return;
  if (!formulaForm.value.unit_code) {
    toast.add({ severity: "warn", summary: "กรุณาเลือกหน่วยนับ", life: 2500 });
    return;
  }
  isSavingFormula.value = true;
  try {
    const res = await saveProductPriceFormula(formulaForm.value);
    if (res.success) {
      toast.add({ severity: "success", summary: "บันทึกสำเร็จ", life: 2000 });
      showFormulaDialog.value = false;
      await loadFormulas();
    } else {
      toast.add({ severity: "error", summary: "บันทึกไม่สำเร็จ", detail: res.message, life: 3000 });
    }
  } catch (e) {
    toast.add({ severity: "error", summary: "บันทึกไม่สำเร็จ", detail: e.message, life: 3000 });
  } finally {
    isSavingFormula.value = false;
  }
}

function confirmDeleteFormula(row) {
  if (!canEditPriceFormula.value) return;
  confirmMessage.value = `ต้องการลบสูตรราคา [${row.unit_code} / ${saleTypeLabel(row.sale_type)} / ${taxTypeLabel(row.tax_type)}] ใช่หรือไม่?`;
  confirmAction.value = async () => {
    const res = await deleteProductPriceFormula({
      ic_code: itemCode,
      unit_code: row.unit_code,
      sale_type: row.sale_type,
      tax_type: row.tax_type,
    });
    if (res.success) {
      toast.add({ severity: "success", summary: "ลบสำเร็จ", life: 2000 });
      await loadFormulas();
    } else {
      toast.add({ severity: "error", summary: "ลบไม่สำเร็จ", detail: res.message, life: 3000 });
    }
  };
  showConfirmDialog.value = true;
}

function formatNum(v) {
  const n = Number(v) || 0;
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function syncMobileState(eventOrQuery) {
  if (typeof eventOrQuery?.matches === "boolean") {
    isMobile.value = eventOrQuery.matches;
    return;
  }
  if (typeof window !== "undefined") {
    isMobile.value = window.innerWidth <= MOBILE_BREAKPOINT;
  }
}

function getFormulaPriceEntries(row) {
  return Array.from({ length: 10 }, (_, index) => ({
    label: `ราคา ${index}`,
    value: row[`price_${index}`],
  })).filter((entry) => String(entry.value ?? "").trim() !== "");
}

onMounted(async () => {
  if (typeof window !== "undefined") {
    mobileMediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    syncMobileState(mobileMediaQuery);
    if (typeof mobileMediaQuery.addEventListener === "function") {
      mobileMediaQuery.addEventListener("change", syncMobileState);
    } else {
      mobileMediaQuery.addListener(syncMobileState);
    }
  }

  const [unitRes, catRes] = await Promise.all([getUnitManageList(""), getProductCategoryList("")]);
  unitOptions.value = (unitRes.data || []).map((u) => ({ value: u.code, label: `${u.code} - ${u.name_1}` }));
  categoryOptions.value = (catRes.data || []).map((g) => ({ value: g.code, label: `${g.code} - ${g.name_1}` }));

  await reloadAll();
});

onBeforeUnmount(() => {
  if (!mobileMediaQuery) return;
  if (typeof mobileMediaQuery.removeEventListener === "function") {
    mobileMediaQuery.removeEventListener("change", syncMobileState);
  } else {
    mobileMediaQuery.removeListener(syncMobileState);
  }
});
</script>

<template>
  <div class="edit-page">
    <!-- Header -->
    <div class="page-header">
      <Button icon="pi pi-arrow-left" text rounded severity="secondary" @click="router.push({ name: 'ProductManage' })" />
      <div class="page-header-meta">
        <h1 class="page-title">แก้ไขสินค้า</h1>
        <p class="page-subtitle">
          {{ form.code }}<span v-if="form.name_1"> — {{ form.name_1 }}</span>
        </p>
      </div>
    </div>

    <!-- ส่วนที่ 4: รูปภาพ -->
    <div v-if="!hasAnyProductSection" class="section-card">
      <div class="table-empty">ไม่มีสิทธิ์ดูรายละเอียดสินค้า</div>
    </div>

    <div v-if="canViewImages" class="section-card">
      <div class="section-header">
        <h2 class="section-title">รูปภาพสินค้า</h2>
        <div v-if="canEditImages" class="header-actions">
          <Button label="บันทึกลำดับ" icon="pi pi-sort" size="small" severity="secondary" outlined :disabled="images.length < 2" @click="saveImageOrder" />
          <Button label="เพิ่มรูปภาพ" icon="pi pi-plus" size="small" :loading="isSavingImage" @click="onClickAddImage" />
        </div>
      </div>
      <input ref="imageFileInput" type="file" accept="image/*" style="display: none" @change="onImageFileSelected" />

      <div v-if="isLoadingImages" class="section-loading">
        <i class="pi pi-spinner pi-spin" />
      </div>
      <div v-else-if="images.length === 0" class="image-empty">
        <i class="pi pi-image image-empty-icon" />
        <p>{{ canEditImages ? 'ยังไม่มีรูปภาพ — กด "เพิ่มรูปภาพ" เพื่ออัพโหลด' : 'ยังไม่มีรูปภาพ' }}</p>
      </div>
      <div v-else class="image-grid">
        <div v-for="(img, idx) in images" :key="img.guid_code" class="image-card" :draggable="canEditImages" @dragstart="onDragStart(idx)" @dragover="onDragOver($event, idx)" @dragend="onDragEnd">
          <img
            :src="getProductImageGuidUrl(img.guid_code)"
            class="image-thumb"
            loading="lazy"
            alt=""
            @error="
              (e) =>
                (e.target.src =
                  'data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2248%22 height=%2248%22 viewBox=%220 0 48 48%22%3E%3Crect width=%2248%22 height=%2248%22 fill=%22%23e5e7eb%22/%3E%3Cpath d=%22M12 34l8-10 6 7 4-5 6 8z%22 fill=%22%239ca3af%22/%3E%3C/svg%3E')
            "
          />
          <div v-if="canEditImages" class="image-overlay">
            <Button icon="pi pi-trash" rounded severity="danger" size="small" @click.stop="confirmDeleteImage(img)" />
          </div>
          <span class="image-order">{{ idx + 1 }}</span>
          <i v-if="canEditImages" class="pi pi-bars image-drag-icon" />
        </div>
      </div>
      <p v-if="canEditImages && images.length > 1" class="image-hint">ลากเพื่อเรียงลำดับ แล้วกด "บันทึกลำดับ"</p>
    </div>

    <!-- ส่วนที่ 1: ข้อมูลหลัก -->
    <div v-if="canViewMain" class="section-card">
      <div class="section-header">
        <h2 class="section-title">ข้อมูลหลัก</h2>
      </div>
      <div v-if="isLoadingMain" class="section-loading">
        <i class="pi pi-spinner pi-spin" />
      </div>
      <div v-else class="form-grid">
        <div class="form-field">
          <label class="field-label">ชื่อสินค้า 1</label>
          <InputText v-model="form.name_1" class="w-full" :disabled="!canEditMain" />
        </div>
        <div class="form-field">
          <label class="field-label">ชื่อสินค้า 2</label>
          <InputText v-model="form.name_2" class="w-full" :disabled="!canEditMain" />
        </div>
        <div class="form-field">
          <label class="field-label">ชื่อ EN 1</label>
          <InputText v-model="form.name_eng_1" class="w-full" :disabled="!canEditMain" />
        </div>
        <div class="form-field">
          <label class="field-label">ชื่อ EN 2</label>
          <InputText v-model="form.name_eng_2" class="w-full" :disabled="!canEditMain" />
        </div>
        <div class="form-field">
          <label class="field-label">หน่วยมาตรฐาน</label>
          <Select v-model="form.unit_standard" :options="unitOptions" optionLabel="label" optionValue="value" placeholder="เลือกหน่วย" class="w-full" filter :disabled="!canEditMain" />
        </div>
        <div class="form-field">
          <label class="field-label">หน่วยต้นทุน</label>
          <Select v-model="form.unit_cost" :options="unitOptions" optionLabel="label" optionValue="value" placeholder="เลือกหน่วย" class="w-full" filter showClear :disabled="!canEditMain" />
        </div>
        <div class="form-field">
          <label class="field-label">หมวด</label>
          <Select v-model="form.item_category" :options="categoryOptions" optionLabel="label" optionValue="value" placeholder="เลือกหมวด" class="w-full" filter showClear :disabled="!canEditMain" />
        </div>
      </div>

      <div v-if="canEditMain" class="section-footer">
        <Button label="บันทึกข้อมูลหลัก" icon="pi pi-save" :loading="isSavingMain" @click="saveMain" />
      </div>
    </div>

    <!-- ส่วนที่ 2: สูตรราคาขาย -->
    <div v-if="canViewPriceFormula" class="section-card">
      <div class="section-header">
        <h2 class="section-title">สูตรราคาขาย</h2>
        <Button v-if="canEditPriceFormula" label="เพิ่มสูตรราคา" icon="pi pi-plus" size="small" @click="openAddFormula" />
      </div>
      <DataTable v-if="!isMobile" :value="priceFormulas" :loading="isLoadingFormulas" scrollable class="section-table">
        <Column field="unit_code" header="หน่วยนับ" style="min-width: 100px" />
        <Column field="sale_type" header="ประเภทการขาย" style="min-width: 120px">
          <template #body="{ data }">{{ saleTypeLabel(data.sale_type) }}</template>
        </Column>
        <Column field="tax_type" header="ภาษี" style="min-width: 100px">
          <template #body="{ data }">{{ taxTypeLabel(data.tax_type) }}</template>
        </Column>
        <Column v-for="n in 10" :key="n - 1" :field="'price_' + (n - 1)" :header="'ราคา ' + (n - 1)" style="min-width: 90px" bodyClass="col-num" headerClass="col-num" />
        <Column v-if="canEditPriceFormula" style="width: 88px" bodyClass="col-actions">
          <template #body="{ data }">
            <Button icon="pi pi-pencil" text rounded size="small" @click="openEditFormula(data)" />
            <Button icon="pi pi-trash" text rounded size="small" severity="danger" @click="confirmDeleteFormula(data)" />
          </template>
        </Column>
        <template #empty><div class="table-empty">ไม่มีสูตรราคา</div></template>
      </DataTable>
      <div v-else-if="isLoadingFormulas" class="section-loading">
        <i class="pi pi-spinner pi-spin" />
      </div>
      <div v-else-if="priceFormulas.length" class="mobile-list">
        <div v-for="data in priceFormulas" :key="`${data.unit_code}-${data.sale_type}-${data.tax_type}`" class="mobile-card">
          <div class="mobile-card-header">
            <div>
              <p class="mobile-card-title">{{ data.unit_code }}</p>
              <p class="mobile-card-subtitle">{{ saleTypeLabel(data.sale_type) }} / {{ taxTypeLabel(data.tax_type) }}</p>
            </div>
            <div v-if="canEditPriceFormula" class="mobile-card-actions">
              <Button icon="pi pi-pencil" text rounded size="small" @click="openEditFormula(data)" />
              <Button icon="pi pi-trash" text rounded size="small" severity="danger" @click="confirmDeleteFormula(data)" />
            </div>
          </div>
          <div class="formula-chip-list">
            <span v-for="entry in getFormulaPriceEntries(data)" :key="entry.label" class="formula-chip">
              <strong>{{ entry.label }}</strong>
              <span>{{ entry.value }}</span>
            </span>
            <span v-if="getFormulaPriceEntries(data).length === 0" class="formula-empty">ไม่มีสูตรย่อย</span>
          </div>
        </div>
      </div>
      <div v-else class="table-empty">ไม่มีสูตรราคา</div>
    </div>

    <!-- ส่วนที่ 3: หน่วยนับ -->
    <div v-if="canViewUnits" class="section-card">
      <div class="section-header">
        <h2 class="section-title">หน่วยนับ</h2>
        <Button v-if="canEditUnits" label="เพิ่มหน่วยนับ" icon="pi pi-plus" size="small" @click="openAddUnitUse" />
      </div>
      <DataTable v-if="!isMobile" :value="unitUseList" :loading="isLoadingUnitUse" scrollable class="section-table">
        <Column field="code" header="รหัส" style="min-width: 90px" />
        <Column field="unit_name" header="ชื่อ" style="min-width: 140px" />
        <Column field="stand_value" header="ตัวตั้ง" style="min-width: 90px" bodyClass="col-num" headerClass="col-num">
          <template #body="{ data }">{{ formatNum(data.stand_value) }}</template>
        </Column>
        <Column field="divide_value" header="ตัวหาร" style="min-width: 90px" bodyClass="col-num" headerClass="col-num">
          <template #body="{ data }">{{ formatNum(data.divide_value) }}</template>
        </Column>
        <Column field="ratio" header="อัตราส่วน" style="min-width: 100px" bodyClass="col-num" headerClass="col-num">
          <template #body="{ data }">{{ formatNum(data.ratio) }}</template>
        </Column>
        <Column field="row_order" header="ลำดับ" style="min-width: 70px" bodyClass="col-center" headerClass="col-center" />
        <Column field="width_length_height" header="กว้างxยาวxสูง" style="min-width: 130px" />
        <Column field="weight" header="น้ำหนัก" style="min-width: 90px" />
        <Column v-if="canEditUnits" style="width: 88px" bodyClass="col-actions">
          <template #body="{ data }">
            <Button icon="pi pi-pencil" text rounded size="small" @click="openEditUnitUse(data)" />
            <Button icon="pi pi-trash" text rounded size="small" severity="danger" @click="confirmDeleteUnitUse(data)" />
          </template>
        </Column>
        <template #empty><div class="table-empty">ไม่มีหน่วยนับ</div></template>
      </DataTable>
      <div v-else-if="isLoadingUnitUse" class="section-loading">
        <i class="pi pi-spinner pi-spin" />
      </div>
      <div v-else-if="unitUseList.length" class="mobile-list">
        <div v-for="data in unitUseList" :key="data.code" class="mobile-card">
          <div class="mobile-card-header">
            <div>
              <p class="mobile-card-title">{{ data.code }}</p>
              <p class="mobile-card-subtitle">{{ data.unit_name || "-" }}</p>
            </div>
            <div v-if="canEditUnits" class="mobile-card-actions">
              <Button icon="pi pi-pencil" text rounded size="small" @click="openEditUnitUse(data)" />
              <Button icon="pi pi-trash" text rounded size="small" severity="danger" @click="confirmDeleteUnitUse(data)" />
            </div>
          </div>
          <div class="mobile-card-grid mobile-card-grid-2">
            <div class="mobile-stat">
              <span class="mobile-stat-label">ตัวตั้ง</span>
              <strong>{{ formatNum(data.stand_value) }}</strong>
            </div>
            <div class="mobile-stat">
              <span class="mobile-stat-label">ตัวหาร</span>
              <strong>{{ formatNum(data.divide_value) }}</strong>
            </div>
            <div class="mobile-stat">
              <span class="mobile-stat-label">อัตราส่วน</span>
              <strong>{{ formatNum(data.ratio) }}</strong>
            </div>
            <div class="mobile-stat">
              <span class="mobile-stat-label">ลำดับ</span>
              <strong>{{ data.row_order ?? "-" }}</strong>
            </div>
          </div>
          <div class="mobile-card-meta">
            <span>กว้างxยาวxสูง: {{ data.width_length_height || "-" }}</span>
            <span>น้ำหนัก: {{ data.weight || "-" }}</span>
          </div>
        </div>
      </div>
      <div v-else class="table-empty">ไม่มีหน่วยนับ</div>
    </div>

    <!-- ส่วนที่ 5: บาร์โค้ดสินค้า -->
    <div v-if="canViewBarcodes" class="section-card">
      <div class="section-header">
        <h2 class="section-title">บาร์โค้ดสินค้า</h2>
        <Button v-if="canEditBarcodes" label="เพิ่มบาร์โค้ด" icon="pi pi-plus" size="small" @click="openAddBarcode" />
      </div>
      <div class="search-bar">
        <InputText v-model="barcodeSearch" placeholder="ค้นหาบาร์โค้ด / หน่วยนับ" class="w-full search-input" />
      </div>
      <DataTable v-if="!isMobile" :value="pagedBarcodes" :loading="isLoadingBarcodes" scrollable class="section-table">
        <Column field="barcode" header="บาร์โค้ด" style="min-width: 160px" />
        <Column field="unit_code" header="หน่วยนับ" style="min-width: 100px">
          <template #body="{ data }">{{ data.unit_name || data.unit_code }}</template>
        </Column>
        <Column field="price" header="ราคา" style="min-width: 110px" bodyClass="col-num" headerClass="col-num">
          <template #body="{ data }">{{ formatNum(data.price) }}</template>
        </Column>
        <Column field="price_member" header="ราคาสมาชิก" style="min-width: 120px" bodyClass="col-num" headerClass="col-num">
          <template #body="{ data }">{{ formatNum(data.price_member) }}</template>
        </Column>
        <Column v-if="canEditBarcodes" style="width: 88px" bodyClass="col-actions">
          <template #body="{ data }">
            <Button icon="pi pi-pencil" text rounded size="small" @click="openEditBarcode(data)" />
            <Button icon="pi pi-trash" text rounded size="small" severity="danger" @click="confirmDeleteBarcode(data)" />
          </template>
        </Column>
        <template #empty><div class="table-empty">ไม่มีบาร์โค้ด</div></template>
      </DataTable>
      <div v-else-if="isLoadingBarcodes" class="section-loading">
        <i class="pi pi-spinner pi-spin" />
      </div>
      <div v-else-if="pagedBarcodes.length" class="mobile-list">
        <div v-for="data in pagedBarcodes" :key="data.barcode" class="mobile-card">
          <div class="mobile-card-header">
            <div>
              <p class="mobile-card-title">{{ data.barcode }}</p>
              <p class="mobile-card-subtitle">{{ data.unit_name || data.unit_code }}</p>
            </div>
            <div v-if="canEditBarcodes" class="mobile-card-actions">
              <Button icon="pi pi-pencil" text rounded size="small" @click="openEditBarcode(data)" />
              <Button icon="pi pi-trash" text rounded size="small" severity="danger" @click="confirmDeleteBarcode(data)" />
            </div>
          </div>
          <div class="mobile-card-grid mobile-card-grid-2">
            <div class="mobile-stat">
              <span class="mobile-stat-label">ราคา</span>
              <strong>{{ formatNum(data.price) }}</strong>
            </div>
            <div class="mobile-stat">
              <span class="mobile-stat-label">ราคาสมาชิก</span>
              <strong>{{ formatNum(data.price_member) }}</strong>
            </div>
            <div class="mobile-stat">
              <span class="mobile-stat-label">ราคา 2</span>
              <strong>{{ formatNum(data.price_2) }}</strong>
            </div>
            <div class="mobile-stat">
              <span class="mobile-stat-label">ราคาสมาชิก 2</span>
              <strong>{{ formatNum(data.price_member_2) }}</strong>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="table-empty">ไม่มีบาร์โค้ด</div>
      <div v-if="filteredBarcodes.length > 0" class="pager-row">
        <span class="pager-count">{{ filteredBarcodes.length }} รายการ</span>
        <div class="pager-nav">
          <Button icon="pi pi-angle-left" text rounded size="small" :disabled="barcodePage === 1" @click="barcodePage--" />
          <span>{{ barcodePage }} / {{ barcodeTotalPages }}</span>
          <Button icon="pi pi-angle-right" text rounded size="small" :disabled="barcodePage >= barcodeTotalPages" @click="barcodePage++" />
        </div>
      </div>
    </div>

    <!-- Confirm Dialog -->
    <Dialog :visible="showConfirmDialog" @update:visible="showConfirmDialog = $event" header="ยืนยันการลบ" :modal="true" :draggable="false" style="width: min(400px, 95vw)">
      <div class="confirm-body">
        <i class="pi pi-exclamation-triangle confirm-icon" />
        <span>{{ confirmMessage }}</span>
      </div>
      <template #footer>
        <Button label="ยกเลิก" severity="secondary" outlined @click="showConfirmDialog = false" />
        <Button label="ลบ" icon="pi pi-trash" severity="danger" :loading="isDeleting" @click="executeConfirm" />
      </template>
    </Dialog>

    <!-- Dialog: บาร์โค้ด -->
    <Dialog
      v-if="canEditBarcodes"
      :visible="showBarcodeDialog"
      @update:visible="showBarcodeDialog = $event"
      :header="barcodeMode === 'create' ? 'เพิ่มบาร์โค้ด' : 'แก้ไขบาร์โค้ด'"
      :modal="true"
      :draggable="false"
      style="width: min(480px, 95vw)"
    >
      <div class="dialog-form">
        <div class="form-field">
          <label class="field-label">บาร์โค้ด <span class="required">*</span></label>
          <div class="barcode-input-row">
            <InputText v-model="barcodeForm.barcode" class="w-full" :disabled="barcodeMode === 'edit' || isGeneratingBarcode" />
            <Button
              v-if="barcodeMode === 'create'"
              label=""
              icon="pi pi-refresh"
              outlined
              :loading="isGeneratingBarcode"
              @click="generateBarcode"
            />
          </div>
        </div>
        <div class="form-field">
          <label class="field-label">หน่วยนับ</label>
          <Select v-model="barcodeForm.unit_code" :options="barcodeUnitOptions" optionLabel="label" optionValue="value" placeholder="เลือกหน่วยนับ" class="w-full" showClear />
        </div>
        <div class="form-grid-2">
          <div class="form-field">
            <label class="field-label">ราคา</label>
            <InputNumber v-model="barcodeForm.price" :minFractionDigits="2" :maxFractionDigits="4" class="w-full" />
          </div>
          <div class="form-field">
            <label class="field-label">ราคาสมาชิก</label>
            <InputNumber v-model="barcodeForm.price_member" :minFractionDigits="2" :maxFractionDigits="4" class="w-full" />
          </div>
          <div class="form-field">
            <label class="field-label">ราคา 2</label>
            <InputNumber v-model="barcodeForm.price_2" :minFractionDigits="2" :maxFractionDigits="4" class="w-full" />
          </div>
          <div class="form-field">
            <label class="field-label">ราคาสมาชิก 2</label>
            <InputNumber v-model="barcodeForm.price_member_2" :minFractionDigits="2" :maxFractionDigits="4" class="w-full" />
          </div>
        </div>
      </div>
      <template #footer>
        <Button label="ยกเลิก" severity="secondary" outlined @click="showBarcodeDialog = false" />
        <Button label="บันทึก" icon="pi pi-save" :loading="isSavingBarcode" @click="saveBarcode" />
      </template>
    </Dialog>

    <!-- Dialog: หน่วยนับ -->
    <Dialog
      v-if="canEditUnits"
      :visible="showUnitUseDialog"
      @update:visible="showUnitUseDialog = $event"
      :header="unitUseMode === 'create' ? 'เพิ่มหน่วยนับ' : 'แก้ไขหน่วยนับ'"
      :modal="true"
      :draggable="false"
      style="width: min(500px, 95vw)"
    >
      <div class="dialog-form">
        <div class="form-field">
          <label class="field-label">รหัสหน่วยนับ <span class="required">*</span></label>
          <Select v-model="unitUseForm.code" :options="unitOptions" optionLabel="label" optionValue="value" placeholder="เลือกหน่วยนับ" class="w-full" filter :disabled="unitUseMode === 'edit'" />
        </div>
        <div class="form-grid-2">
          <div class="form-field">
            <label class="field-label">ตัวตั้ง</label>
            <InputNumber v-model="unitUseForm.stand_value" :minFractionDigits="0" :maxFractionDigits="6" class="w-full" />
          </div>
          <div class="form-field">
            <label class="field-label">ตัวหาร</label>
            <InputNumber v-model="unitUseForm.divide_value" :minFractionDigits="0" :maxFractionDigits="6" class="w-full" />
          </div>
        </div>
        <div class="form-field">
          <label class="field-label">อัตราส่วน (คำนวณอัตโนมัติ)</label>
          <InputText :value="String(unitUseRatio)" disabled class="w-full ratio-input" />
        </div>
        <div class="form-grid-2">
          <div class="form-field">
            <label class="field-label">ลำดับ</label>
            <InputNumber v-model="unitUseForm.row_order" :minFractionDigits="0" :maxFractionDigits="0" class="w-full" />
          </div>
          <div class="form-field">
            <label class="field-label">น้ำหนัก</label>
            <InputText v-model="unitUseForm.weight" placeholder="เช่น 1.5 kg" class="w-full" />
          </div>
        </div>
        <div class="form-field">
          <label class="field-label">กว้างxยาวxสูง</label>
          <InputText v-model="unitUseForm.width_length_height" placeholder="เช่น 10x20x30" class="w-full" />
        </div>
      </div>
      <template #footer>
        <Button label="ยกเลิก" severity="secondary" outlined @click="showUnitUseDialog = false" />
        <Button label="บันทึก" icon="pi pi-save" :loading="isSavingUnitUse" @click="saveUnitUse" />
      </template>
    </Dialog>

    <!-- Dialog: สูตรราคาขาย -->
    <Dialog
      v-if="canEditPriceFormula"
      :visible="showFormulaDialog"
      @update:visible="showFormulaDialog = $event"
      :header="formulaMode === 'create' ? 'เพิ่มสูตรราคาขาย' : 'แก้ไขสูตรราคาขาย'"
      :modal="true"
      :draggable="false"
      style="width: min(560px, 95vw)"
    >
      <div class="dialog-form">
        <div class="form-grid-3">
          <div class="form-field">
            <label class="field-label">หน่วยนับ <span class="required">*</span></label>
            <Select v-model="formulaForm.unit_code" :options="barcodeUnitOptions" optionLabel="label" optionValue="value" placeholder="เลือก" class="w-full" :disabled="formulaMode === 'edit'" />
          </div>
          <div class="form-field">
            <label class="field-label">ประเภทการขาย</label>
            <Select v-model="formulaForm.sale_type" :options="SALE_TYPE_OPTIONS" optionLabel="label" optionValue="value" class="w-full" :disabled="formulaMode === 'edit'" />
          </div>
          <div class="form-field">
            <label class="field-label">ภาษี</label>
            <Select v-model="formulaForm.tax_type" :options="TAX_TYPE_OPTIONS" optionLabel="label" optionValue="value" class="w-full" :disabled="formulaMode === 'edit'" />
          </div>
        </div>
        <div class="form-grid-2">
          <div v-for="n in 10" :key="n - 1" class="form-field">
            <label class="field-label">ราคา {{ n - 1 }}</label>
            <InputText :value="formulaForm['price_' + (n - 1)]" @update:modelValue="(v) => (formulaForm['price_' + (n - 1)] = v)" class="w-full" placeholder="" />
          </div>
        </div>
      </div>
      <template #footer>
        <Button label="ยกเลิก" severity="secondary" outlined @click="showFormulaDialog = false" />
        <Button label="บันทึก" icon="pi pi-save" :loading="isSavingFormula" @click="saveFormula" />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.edit-page {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 1100px;
}

/* Header */
.page-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.page-header-meta {
  min-width: 0;
}

.page-title {
  font-size: 1.375rem;
  font-weight: 700;
  margin: 0;
  line-height: 1.2;
}

.page-subtitle {
  font-size: 0.825rem;
  color: var(--p-text-color-secondary);
  margin: 0.1rem 0 0;
}

/* Section card */
.section-card {
  border: 1px solid var(--p-surface-200);
  border-radius: 10px;
  background: var(--p-surface-0);
  overflow: hidden;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.875rem 1.125rem;
  border-bottom: 1px solid var(--p-surface-200);
  background: var(--p-surface-50);
}

.section-title {
  font-size: 0.9375rem;
  font-weight: 600;
  margin: 0;
}

.header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.section-footer {
  display: flex;
  justify-content: flex-end;
  padding: 0.875rem 1.125rem;
  border-top: 1px solid var(--p-surface-200);
  background: var(--p-surface-50);
}

.section-loading {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 2.5rem;
  color: var(--p-text-color-secondary);
  font-size: 1.5rem;
}

/* Forms */
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  padding: 1.125rem;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.barcode-input-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.barcode-input-row :deep(.p-button) {
  flex-shrink: 0;
}

.field-label {
  font-size: 0.775rem;
  font-weight: 500;
  color: var(--p-text-color-secondary);
}

.required {
  color: var(--p-red-500);
}

/* Search bar */
.search-bar {
  padding: 0.75rem 1.125rem 0;
}

.search-input {
  max-width: 320px;
}

/* Table */
.section-table {
  font-size: 0.875rem;
}

.table-empty {
  text-align: center;
  padding: 2rem 0;
  color: var(--p-text-color-secondary);
}

/* Pager */
.pager-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.625rem 1.125rem;
  border-top: 1px solid var(--p-surface-100);
  font-size: 0.85rem;
  color: var(--p-text-color-secondary);
}

.pager-nav {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.mobile-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem 1.125rem;
}

.mobile-card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.875rem;
  border: 1px solid var(--p-surface-200);
  border-radius: 12px;
  background: var(--p-surface-0);
}

.mobile-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.mobile-card-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  word-break: break-word;
}

.mobile-card-subtitle {
  margin: 0.2rem 0 0;
  font-size: 0.775rem;
  color: var(--p-text-color-secondary);
}

.mobile-card-actions {
  display: flex;
  align-items: center;
  gap: 0.125rem;
  flex-shrink: 0;
}

.mobile-card-grid {
  display: grid;
  gap: 0.625rem;
}

.mobile-card-grid-2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.mobile-stat {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.625rem;
  border-radius: 10px;
  background: var(--p-surface-50);
}

.mobile-stat-label {
  font-size: 0.72rem;
  color: var(--p-text-color-secondary);
}

.mobile-card-meta {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.8rem;
  color: var(--p-text-color-secondary);
}

.formula-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.formula-chip {
  display: inline-flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 110px;
  padding: 0.5rem 0.625rem;
  border-radius: 10px;
  background: var(--p-surface-50);
  font-size: 0.78rem;
}

.formula-empty {
  font-size: 0.8rem;
  color: var(--p-text-color-secondary);
}

/* Images */
.image-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2.5rem;
  color: var(--p-text-color-secondary);
}

.image-empty-icon {
  font-size: 2.5rem;
}

.image-empty p {
  margin: 0;
  font-size: 0.9rem;
}

.image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 0.875rem;
  padding: 1rem 1.125rem;
}

.image-card {
  position: relative;
  border-radius: 8px;
  border: 1px solid var(--p-surface-200);
  overflow: hidden;
  background: var(--p-surface-50);
  cursor: grab;
  aspect-ratio: 1;
}

.image-card:active {
  cursor: grabbing;
}

.image-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.image-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition:
    background 0.15s,
    opacity 0.15s;
}

.image-card:hover .image-overlay {
  background: rgba(0, 0, 0, 0.3);
  opacity: 1;
}

.image-order {
  position: absolute;
  top: 4px;
  left: 4px;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 0.7rem;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
}

.image-drag-icon {
  position: absolute;
  top: 5px;
  right: 6px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.8rem;
}

.image-hint {
  margin: 0;
  padding: 0 1.125rem 0.75rem;
  font-size: 0.75rem;
  color: var(--p-text-color-secondary);
}

/* Dialog forms */
.dialog-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding-top: 0.25rem;
}

.form-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.form-grid-3 {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0.75rem;
}

.ratio-input {
  background: var(--p-surface-100);
}

/* Confirm dialog */
.confirm-body {
  display: flex;
  align-items: flex-start;
  gap: 0.875rem;
  padding: 0.5rem 0;
}

.confirm-icon {
  font-size: 1.5rem;
  color: var(--p-yellow-500);
  flex-shrink: 0;
  margin-top: 0.1rem;
}

@media (max-width: 768px) {
  .edit-page {
    gap: 0.875rem;
  }

  .page-header {
    align-items: flex-start;
  }

  .page-title {
    font-size: 1.2rem;
  }

  .section-header,
  .section-footer,
  .pager-row {
    flex-direction: column;
    align-items: stretch;
    gap: 0.75rem;
  }

  .section-header > :last-child,
  .section-footer > :last-child,
  .header-actions {
    width: 100%;
  }

  .section-header :deep(.p-button),
  .section-footer :deep(.p-button),
  .header-actions :deep(.p-button) {
    width: 100%;
    justify-content: center;
  }

  .search-bar,
  .mobile-list,
  .image-grid,
  .image-hint,
  .form-grid,
  .section-header,
  .section-footer,
  .pager-row {
    padding-left: 0.875rem;
    padding-right: 0.875rem;
  }

  .search-input {
    max-width: none;
  }

  .form-grid,
  .form-grid-2,
  .form-grid-3,
  .mobile-card-grid-2 {
    grid-template-columns: 1fr;
  }

  .barcode-input-row {
    flex-direction: column;
    align-items: stretch;
  }

  .image-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
  }

  .image-empty {
    padding: 2rem 1rem;
  }

  .mobile-card-header {
    flex-direction: column;
  }

  .mobile-card-actions {
    width: 100%;
    justify-content: flex-end;
  }

  .formula-chip {
    width: 100%;
    min-width: 0;
  }

  .confirm-body {
    gap: 0.625rem;
  }
}
</style>
