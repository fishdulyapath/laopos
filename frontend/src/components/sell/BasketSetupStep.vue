<script setup>
import { computed, ref, watch, onMounted } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import { useToast } from "primevue/usetoast";
import { getCustomerList } from "@/services/sellService";
import { getSaleDocFormatList } from "@/services/basketService";
import { useAuthStore } from "@/stores/auth";
import api from "@/services/api";

const toast = useToast();

const props = defineProps({
  basket: { type: Object, required: true },
});
const emit = defineEmits(["done", "back", "clear"]);

const authStore = useAuthStore();

// --- ลูกค้า ---
const custCode = ref("");
const custName = ref("ลูกค้าทั่วไป");
const custSearch = ref("");
const custResults = ref([]);
const custLoading = ref(false);
const showCustDropdown = ref(false);
let custDebounce = null;

// --- รหัสเอกสารขาย ---
const docFormats = ref([]);
const docFormatCode = ref("");
const docFormatLoading = ref(false);

const docFormatOptions = computed(() =>
  docFormats.value.map((item) => ({
    ...item,
    label: `${item.code} - ${item.name_1 || ""}`,
  })),
);

const selectedDocFormat = computed(() =>
  docFormats.value.find((item) => item.code === docFormatCode.value) || null
);

function firstDocFormatCode() {
  return docFormatOptions.value[0]?.code || "";
}

function setDocFormatCode(code) {
  const nextCode = String(code || "");
  docFormatCode.value = docFormats.value.some((item) => item.code === nextCode)
    ? nextCode
    : firstDocFormatCode();
}

async function loadDocFormats() {
  docFormatLoading.value = true;
  try {
    docFormats.value = await getSaleDocFormatList();
  } catch (ex) {
    docFormats.value = [];
    toast.add({
      severity: "error",
      summary: "โหลดรหัสเอกสารไม่สำเร็จ",
      detail: ex.message,
      life: 3000,
    });
  } finally {
    docFormatLoading.value = false;
  }
}

watch(custSearch, (val) => {
  clearTimeout(custDebounce);
  if (!val.trim()) {
    custResults.value = [];
    showCustDropdown.value = false;
    return;
  }
  custDebounce = setTimeout(async () => {
    custLoading.value = true;
    try {
      custResults.value = await getCustomerList(val.trim());
      showCustDropdown.value = custResults.value.length > 0;
    } finally {
      custLoading.value = false;
    }
  }, 300);
});

function selectWalkIn() {
  custCode.value = "";
  custName.value = "ลูกค้าทั่วไป";
  custSearch.value = "";
  showCustDropdown.value = false;
}

function selectCustomer(c) {
  custCode.value = c.code;
  custName.value = c.name;
  custSearch.value = "";
  showCustDropdown.value = false;
}

// --- ประเภทการขาย ---
const inquiryTypeOptions = [
  { label: "ขายเชื่อ", value: 0 },
  { label: "ขายสด", value: 1 },
  { label: "เชื่อ(บริการ)", value: 2 },
  { label: "สด(บริการ)", value: 3 },
];
const inquiryType = ref(1);

// --- ประเภทภาษี ---
const vatTypeOptions = [
  { label: "แยกนอก", value: 0 },
  { label: "รวมใน", value: 1 },
  { label: "ไม่กระทบ", value: 2 },
  { label: "ศูนย์", value: 3 },
];
const vatType = ref(1);
const vatRate = ref(7.0);

// --- พนักงานขาย ---
const saleCode = ref("");
const saleName = ref("");
const saleName2 = ref("");
const saleSearch = ref("");
const saleResults = ref([]);
const saleLoading = ref(false);
const showSaleDropdown = ref(false);
let saleDebounce = null;

function employeePrimaryName(employee = {}) {
  return String(employee.name_1 ?? employee.name ?? employee.user_name ?? "").trim();
}

function employeeName2(employee = {}) {
  return String(employee.name_2 ?? employee.user_name_2 ?? "").trim();
}

function employeeDisplayLabel(employee = {}) {
  const name1 = employeePrimaryName(employee);
  const name2 = employeeName2(employee);
  return [name1, name2].filter(Boolean).join(" | ");
}

const saleDisplayName = computed(() => [saleName.value, saleName2.value].filter(Boolean).join(" | "));

watch(saleSearch, (val) => {
  clearTimeout(saleDebounce);
  if (!val.trim()) {
    saleResults.value = [];
    showSaleDropdown.value = false;
    return;
  }
  saleDebounce = setTimeout(async () => {
    saleLoading.value = true;
    try {
      const { data } = await api.get("/getEmployeeList", {
        params: { search: val.trim() },
      });
      saleResults.value = data.data || [];
      showSaleDropdown.value = saleResults.value.length > 0;
    } finally {
      saleLoading.value = false;
    }
  }, 300);
});

function selectEmployee(e) {
  saleCode.value = e.code;
  saleName.value = employeePrimaryName(e);
  saleName2.value = employeeName2(e);
  saleSearch.value = "";
  showSaleDropdown.value = false;
}

const isEditMode = props.basket.status === 'active';

onMounted(async () => {
  await loadDocFormats();

  if (isEditMode) {
    custCode.value = props.basket.cust_code || '';
    custName.value = props.basket.cust_name || 'ลูกค้าทั่วไป';
    inquiryType.value = props.basket.inquiry_type ?? 1;
    vatType.value = props.basket.vat_type ?? 1;
    vatRate.value = props.basket.vat_rate ?? 7.0;
    saleCode.value = props.basket.sale_code || '';
    saleName.value = props.basket.sale_name || '';
    saleName2.value = '';
    setDocFormatCode(props.basket.doc_format_code);
  } else {
    const emp = authStore.employee;
    if (emp) {
      saleCode.value = emp.user_code ?? '';
      saleName.value = employeePrimaryName(emp);
      saleName2.value = employeeName2(emp);
    }
    setDocFormatCode("");
  }
});

function confirm() {
  if (inquiryType.value === null || inquiryType.value === undefined) {
    toast.add({
      severity: "warn",
      summary: "กรุณาเลือกประเภทการขาย",
      life: 2500,
    });
    return;
  }
  if (vatType.value === null || vatType.value === undefined) {
    toast.add({
      severity: "warn",
      summary: "กรุณาเลือกประเภทภาษี",
      life: 2500,
    });
    return;
  }
  if (!docFormatCode.value) {
    toast.add({
      severity: "warn",
      summary: "กรุณาเลือกรหัสเอกสาร",
      life: 2500,
    });
    return;
  }
  emit("done", {
    cust_code: custCode.value,
    cust_name: custName.value,
    inquiry_type: inquiryType.value,
    vat_type: vatType.value,
    vat_rate: vatRate.value,
    sale_code: saleCode.value,
    sale_name: saleName.value,
    doc_format_code: docFormatCode.value,
    doc_format_name: selectedDocFormat.value?.name_1 || "",
    doc_format: selectedDocFormat.value?.format || "",
    form_code: selectedDocFormat.value?.form_code || "",
  });
}
</script>

<template>
  <div class="setup-view">
    <div class="setup-header">
      <Button
        icon="pi pi-arrow-left"
        text
        rounded
        @click="emit('back')"
        aria-label="กลับ"
      />
      <span class="setup-title">{{ isEditMode ? 'แก้ไขตะกร้า' : 'ตั้งค่าตะกร้า' }} #{{ basket.basket_id }}</span>
    </div>

    <div class="setup-body">
      <!-- ลูกค้า -->
      <section class="setup-section">
        <div class="section-label">ลูกค้า</div>
        <Button
          label="ลูกค้าทั่วไป"
          icon="pi pi-user"
          :outlined="custCode !== ''"
          size="small"
          class="walkin-btn"
          @click="selectWalkIn"
        />
        <div class="search-wrap">
          <InputText
            v-model="custSearch"
            placeholder="ค้นหาลูกค้า (รหัส/ชื่อ)..."
            class="w-full"
            :loading="custLoading"
          />
          <div v-if="showCustDropdown" class="dropdown-list">
            <button
              v-for="c in custResults"
              :key="c.row_key || `${c.code || ''}|${c.member_code || ''}|${c.mobile_phone || ''}`"
              class="dropdown-item"
              @click="selectCustomer(c)"
            >
              <span class="dropdown-item-code">{{ c.code }}<template v-if="c.member_code"> / {{ c.member_code }}</template></span>
              <span class="dropdown-item-name">{{ c.name }}</span>
            </button>
          </div>
        </div>
        <div v-if="custCode || custName" class="selected-badge">
          <i class="pi pi-check-circle" style="color: var(--p-primary-color)" />
          {{ custName }}<template v-if="custCode"> ({{ custCode }})</template>
        </div>
      </section>

      <!-- รหัสเอกสาร -->
      <section class="setup-section">
        <div class="section-label">รหัสเอกสาร</div>
        <Select
          v-model="docFormatCode"
          :options="docFormatOptions"
          option-label="label"
          option-value="code"
          placeholder="เลือกรหัสเอกสาร"
          class="w-full"
          :loading="docFormatLoading"
          filter
        >
          <template #option="{ option }">
            <div class="doc-format-option">
              <span class="doc-format-code">{{ option.code }}</span>
              <span class="doc-format-name">{{ option.name_1 }}</span>
            </div>
          </template>
        </Select>
        <div v-if="selectedDocFormat" class="selected-badge selected-badge-stack">
          <div>
            <i class="pi pi-file" style="color: var(--p-primary-color)" />
            {{ selectedDocFormat.code }} - {{ selectedDocFormat.name_1 }}
          </div>
          <small>{{ selectedDocFormat.format }} · {{ selectedDocFormat.form_code || '-' }}</small>
        </div>
      </section>

      <!-- ประเภทการขาย -->
      <section class="setup-section">
        <div class="section-label">ประเภทการขาย</div>
        <SelectButton
          v-model="inquiryType"
          :options="inquiryTypeOptions"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          class="inquiry-select"
        />
      </section>

      <!-- ประเภทภาษี -->
      <section class="setup-section">
        <div class="section-label">ประเภทภาษี</div>
        <SelectButton
          v-model="vatType"
          :options="vatTypeOptions"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          class="vat-select"
        />
      </section>

      <!-- พนักงานขาย -->
      <section class="setup-section">
        <div class="section-label">พนักงานขาย</div>
        <div class="search-wrap">
          <InputText
            v-model="saleSearch"
            placeholder="ค้นหาพนักงาน..."
            class="w-full"
            :loading="saleLoading"
          />
          <div v-if="showSaleDropdown" class="dropdown-list">
            <button
              v-for="e in saleResults"
              :key="e.code"
              class="dropdown-item"
              @click="selectEmployee(e)"
            >
              <span class="dropdown-item-code">{{ e.code }}</span>
              <span class="dropdown-item-name">{{ employeeDisplayLabel(e) }}</span>
            </button>
          </div>
        </div>
        <div v-if="saleCode || saleName" class="selected-badge">
          <i class="pi pi-check-circle" style="color: var(--p-primary-color)" />
          {{ saleDisplayName || saleName }}<template v-if="saleCode"> ({{ saleCode }})</template>
        </div>
      </section>
      <div style="margin-top:1rem">
        <Button
          label="ยืนยัน"
          icon="pi pi-check"
          class="w-full confirm-btn"
          size="large"
          @click="confirm"
        />
      </div>

      <div v-if="isEditMode" class="clear-section">
        <div class="clear-divider" />
        <Button
          label="เคลียร์ตะกร้า"
          icon="pi pi-trash"
          severity="danger"
          outlined
          class="w-full"
          @click="emit('clear')"
        />
      </div>
    </div>

    <div class="setup-footer"></div>
  </div>
</template>

<style scoped>
.setup-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.setup-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--p-surface-border);
}

.setup-title {
  font-size: 1.05rem;
  font-weight: 600;
}

.setup-body {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  max-width: 560px;
  width: 100%;
  margin: 0 auto;
}

.setup-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.section-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--p-text-color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.walkin-btn {
  align-self: flex-start;
}

.search-wrap {
  position: relative;
}

.w-full {
  width: 100%;
}

.dropdown-list {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 100;
  background: #ffffff;
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  max-height: 200px;
  overflow-y: auto;
}

.dropdown-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: none;
  background: none;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  font-size: 0.875rem;
}

.dropdown-item:hover {
  background: var(--p-surface-hover);
}

.dropdown-item-code {
  font-weight: 600;
  min-width: 5rem;
  color: var(--p-text-color-secondary);
  font-size: 0.8rem;
}

.dropdown-item-name {
  flex: 1;
}

.selected-badge {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.875rem;
  color: var(--p-text-color);
}

.selected-badge-stack {
  align-items: flex-start;
  flex-direction: column;
  gap: 0.15rem;
}

.selected-badge-stack > div {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.selected-badge-stack small {
  color: var(--p-text-color-secondary);
  font-size: 0.75rem;
}

.doc-format-option {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.doc-format-code {
  min-width: 4.5rem;
  font-weight: 700;
}

.doc-format-name {
  color: var(--p-text-color-secondary);
}

.inquiry-select :deep(.p-selectbutton) {
  flex-wrap: wrap;
}
.vat-select :deep(.p-selectbutton) {
  flex-wrap: wrap;
}

.setup-footer {
  padding: 1rem;
  border-top: 1px solid var(--p-surface-border);
}

.confirm-btn {
  width: 100%;
}

.clear-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.clear-divider {
  height: 1px;
  background: var(--p-surface-border);
}
</style>
