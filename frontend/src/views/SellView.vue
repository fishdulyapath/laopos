<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import Accordion from "primevue/accordion";
import AccordionContent from "primevue/accordioncontent";
import AccordionHeader from "primevue/accordionheader";
import AccordionPanel from "primevue/accordionpanel";
import Button from "primevue/button";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import DatePicker from "primevue/datepicker";
import Dialog from "primevue/dialog";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import Tag from "primevue/tag";
import Textarea from "primevue/textarea";
import { useConfirm } from "primevue/useconfirm";
import { useToast } from "primevue/usetoast";
import IsoDatePicker from "@/components/common/IsoDatePicker.vue";
import SalesProductBasketDialog from "@/components/sell/SalesProductBasketDialog.vue";
import SaleRefDocDialog from "@/components/sell/SaleRefDocDialog.vue";
import api from "@/services/api";
import { getSaleDocFormatList } from "@/services/basketService";
import { getCustomerDisplayMedia } from "@/services/customerDisplayMediaService";
import { checkLaoQrPaymentHistory, getLaoQrPaymentHistory } from "@/services/laoQrService";
import { getDocSaleHistoryDetail, getSaleItemHistory, getSalePriceFormulaInfo, getSalePrintForms, getSalePrintUrl, getSalePosSlipPrintUrl, fetchThermalReceiptHex } from "@/services/salesService";
import {
  getCreditTypeList,
  getCustomerCredit,
  getCustomerTotalBalance,
  getCouponList,
  getCustomerList,
  getPassBookList,
  getPaymentMasterLists,
  getProductByBarcodeDetail,
  getProductBarcodeSearch,
  getProductDetail,
  getProductImageUrl,
  getPricePos,
  getProductSetDetail,
  getProductSetItem,
  getPromotionItemHints,
  getLaoQrConfig,
  getSaleDepositBalanceList,
  getSaleDepositMoneyBalanceList,
  processPosSlipCampaign,
  processPromotion,
  saveTransAndPro,
  checkSaleItemPolicies,
  verifyCashDrawerPermission,
  verifyPriceEditPermission,
  createLaoQrPayment,
  checkLaoQrPaymentStatus,
  getBranchList,
  getDocGroupList,
  getSideList,
  getDepartmentList,
  getAllocateList,
  getProjectList,
  getJobList,
  getSaleGroupList,
  getCustomerContactorList,
  getProvinceList,
  getAmperList,
  getTambonList,
  getLogisticAreaList,
  getShippingLabelList,
  getShipmentTransportTypeList,
} from "@/services/sellService";
import { useAuthStore } from "@/stores/auth";
import { usePosStore } from "@/stores/pos";
import {
  adjustStockFromSale,
  getInventoryBalance,
  getInventoryBalanceBatch,
  getProductWarehouseBalanceBranches,
  getProductWarehouseBalances,
  getShelfList,
  getWarehouseList,
} from "@/services/inventoryService";
import { calcAfterDiscount, calcDiscountAmount } from "@/utils/discount";
import { formatCurrency, todayISO, toISO } from "@/utils/formatters";
import { clearHeldBills, deleteHeldBill, listHeldBills, loadHeldBill, saveHeldBill } from "@/utils/heldBill";
import { PERMISSIONS } from "@/utils/permissions";
import { DEFAULT_CUSTOMER_DISPLAY_CURRENCY_CODE, normalizeAllowedSaleWarehouseCodes } from "@/utils/posDeviceSettings";
import bcelCnyQrImage from "@/assets/bcel_cny.jpg";
import bcelThbQrImage from "@/assets/bcel_thb.jpg";
import bcelUsdQrImage from "@/assets/bcel_usd.jpg";
import laoQrMarkImage from "@/assets/laoqr.svg";
import onePayMarkImage from "@/assets/onepay.png";
import thankYouLaoAudio from "@/assets/thankyoulao.m4a";
import thankYouEndAudio from "@/assets/thankyouend.mp3";

const toast = useToast();
const confirm = useConfirm();
const { t, locale } = useI18n();
const QR_PAYMENT_COUNTDOWN_SECONDS = 15 * 60;
const THANK_YOU_AUDIO_GAIN = 3;
function tl(th, en, lo = en) {
  const lang = String(locale.value || "th").toLowerCase();
  if (lang.startsWith("en")) return en;
  if (lang.startsWith("lo")) return lo;
  return th;
}

function employeePrimaryName(employee = {}) {
  return String(employee.name_1 ?? employee.name ?? employee.user_name ?? "").trim();
}

function employeeName2(employee = {}) {
  return String(employee.name_2 ?? employee.user_name_2 ?? "").trim();
}

function employeeDisplayLabel(employee = {}) {
  const name1 = String(employee.name_1 ?? employee.name ?? employee.user_name ?? "").trim();
  const name2 = String(employee.name_2 ?? employee.user_name_2 ?? "").trim();
  return [name1, name2].filter(Boolean).join(" | ");
}

async function defaultEmployeeNames() {
  const employee = authStore.employee || {};
  const fallback = {
    name_1: employeePrimaryName(employee),
    name_2: employeeName2(employee),
  };
  const code = String(employee.user_code || "").trim();
  if (!code || fallback.name_2) return fallback;
  try {
    const { data } = await api.get("/getEmployeeList", { params: { search: code } });
    const exact = (data.data || []).find(
      (row) =>
        String(row.code || "")
          .trim()
          .toUpperCase() === code.toUpperCase(),
    );
    return exact ? { name_1: employeePrimaryName(exact), name_2: employeeName2(exact) } : fallback;
  } catch {
    return fallback;
  }
}

function playAudioUrl(url) {
  return new Promise((resolve, reject) => {
    if (typeof Audio === "undefined" || !url) {
      resolve(false);
      return;
    }
    const audio = new Audio(url);
    audio.preload = "auto";
    audio.volume = 1;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    let audioContext = null;
    if (AudioContextClass) {
      audioContext = new AudioContextClass();
      const source = audioContext.createMediaElementSource(audio);
      const gainNode = audioContext.createGain();
      gainNode.gain.value = THANK_YOU_AUDIO_GAIN;
      source.connect(gainNode).connect(audioContext.destination);
    }
    const finish = (value) => {
      if (audioContext?.state !== "closed") audioContext.close().catch(() => {});
      resolve(value);
    };
    const fail = (error) => {
      if (audioContext?.state !== "closed") audioContext.close().catch(() => {});
      reject(error);
    };
    audio.addEventListener("ended", () => finish(true), { once: true });
    audio.addEventListener("error", () => fail(new Error(`Unable to play audio: ${url}`)), { once: true });
    Promise.resolve(audioContext?.resume?.())
      .then(() => audio.play())
      .catch(fail);
  });
}

async function playThankYouAudioAfterSaleSave() {
  try {
    await playAudioUrl(thankYouLaoAudio);
    await playAudioUrl(thankYouEndAudio);
  } catch (error) {
    console.warn("Thank-you audio playback failed", error);
  }
}
const authStore = useAuthStore();
const posStore = usePosStore();
const route = useRoute();
const router = useRouter();
const saleLayoutPreferenceKey = "bizsuit_sell_layout_preferences_v1";
const saleLayoutPreferenceEvent = "bizsuit:sale-layout-preferences";

function readSaleLayoutPreferences() {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(saleLayoutPreferenceKey) || "{}");
  } catch {
    return {};
  }
}

const saleLayoutPreferences = readSaleLayoutPreferences();
const saleFontScale = ref(Math.min(1.8, Math.max(0.88, toNumber(saleLayoutPreferences.fontScale, 1))));
const saleDensity = ref(["compact", "normal", "comfortable"].includes(saleLayoutPreferences.density) ? saleLayoutPreferences.density : "normal");
const saleDensityScale = computed(() => (saleDensity.value === "compact" ? 0.84 : saleDensity.value === "comfortable" ? 1.08 : 1));
const saleLayoutStyle = computed(() => ({
  "--sale-font-scale": saleFontScale.value,
  "--sale-density-scale": saleDensityScale.value,
}));

function applySaleLayoutPreferences(preferences = readSaleLayoutPreferences()) {
  saleFontScale.value = Math.min(1.8, Math.max(0.88, toNumber(preferences.fontScale, 1)));
  saleDensity.value = ["compact", "normal", "comfortable"].includes(preferences.density) ? preferences.density : "normal";
}

function onSaleLayoutPreferenceEvent(event) {
  applySaleLayoutPreferences(event?.detail || readSaleLayoutPreferences());
}

function onSaleLayoutPreferenceStorage(event) {
  if (event?.key !== saleLayoutPreferenceKey) return;
  applySaleLayoutPreferences();
}

const itemAmountDecimal = computed(() => Math.max(0, toNumber(posStore.erpOption?.item_amount_decimal, 2)));
const itemPriceDecimal = computed(() => Math.max(0, toNumber(posStore.erpOption?.item_price_decimal, 2)));
const exchangeRateDecimal = 9;

const loading = ref(false);
const saving = ref(false);
const errorMsg = ref("");
const successDocNo = ref("");
const nextDocNo = ref("");
const editMode = ref(false);
const isViewOnly = computed(() => String(route.query.view || "").trim() === "1");
const docCanEdit = ref(true);
const canEditSalesDocument = computed(() => authStore.hasPermission(PERMISSIONS.salesCashEdit));
const canPrintSalesDocument = computed(() => authStore.hasPermission(PERMISSIONS.salesCashPrint));
const oldDocNo = ref("");
const hydratingEditDocument = ref(false);
const editOriginalSignature = ref("");
const saveDialogVisible = ref(false);
const saveDialogType = ref("info");
const saveDialogTitle = ref("");
const saveDialogMessage = ref("");
const saveDialogDetails = ref([]);
const saveDialogPrimaryLabel = ref("");
const saveDialogPrimarySeverity = ref("warning");
const saveDialogPrimaryAction = ref(null);
const saveDialogShowPaymentReviewAction = ref(false);
const salePolicyDialogVisible = ref(false);
const salePolicyDialogType = ref("warn");
const salePolicyDialogTitle = ref("");
const salePolicyDialogMessage = ref("");
const salePolicyDialogDetails = ref([]);
const salePolicyStockAdjustmentContext = ref(null);
const stockAdjustmentDialogVisible = ref(false);
const stockAdjustmentQtyText = ref("");
const stockAdjustmentAuth = ref(null);
const stockAdjustmentSaving = ref(false);
const stockAdjustmentError = ref("");
const stockAdjustmentResult = ref(null);
const refDocWarehouseNoticeVisible = ref(false);
const refDocWarehouseNotices = ref([]);
const paymentDialogVisible = ref(false);
const customerDisplayPaymentDueLock = ref(null);
const salePreflightRunning = ref(false);
const heldBillDialogVisible = ref(false);
const heldBills = ref([]);
const holdingBill = ref(false);
const cashDrawerOpening = ref(false);
const customerDisplayOpening = ref(false);
const customerDisplayMedia = ref([]);
const creditApproveDialogVisible = ref(false);
const creditApproveUser = ref("");
const creditApprovePassword = ref("");
const creditApproveMessage = ref("");
const creditApproveDetails = ref([]);
const creditApproveSnapshot = ref(null);
const creditApproveConfirmations = ref([]);

const docFormats = ref([]);
const docFormatCode = ref("");
const workspaceTab = ref("details");
const extraSubTab = ref("vat");
const extraSubTabs = computed(() => [
  {
    label: t("sell.wht"),
    icon: "pi pi-percentage",
    value: "wht",
    badge: whtValidationCount.value > 0 ? String(whtValidationCount.value) : null,
  },
  {
    label: t("sell.vat"),
    icon: "pi pi-receipt",
    value: "vat",
    badge: vatValidationCount.value > 0 ? String(vatValidationCount.value) : null,
  },
  { label: t("sell.advance"), icon: "pi pi-bookmark", value: "advance", badge: null },
  {
    label: "GL",
    icon: "pi pi-sitemap",
    value: "gl",
    badge: glManualMode.value && !manualGlBalanced.value ? "!" : null,
  },
  { label: t("sell.shipment"), icon: "pi pi-send", value: "shipment", badge: null },
]);
const defaultCustomerCode = "AR00569";
const defaultCustomerName = computed(() => t("sell.walkInCustomer"));
const custCode = ref(defaultCustomerCode);
const memberCode = ref("");
const custName = ref(defaultCustomerName.value);
const previousDefaultCustomerName = ref(defaultCustomerName.value);
const custSearch = ref("");
const custResults = ref([]);
const customerDialogFilter = ref("all");
const custLoading = ref(false);
const customerDialogVisible = ref(false);
const refDocDialogVisible = ref(false);
// pulled reference docs (ตรงกับ C# _icTransRefControl._transGrid + table ap_ar_trans_detail)
// shape: { doc_no, doc_date (YYYY-MM-DD), bill_type (1=QT,2=Reserve,3=SO), item_count }
const pulledRefDocs = ref([]);
const isWalkInCustomer = computed(() => !custCode.value || custCode.value === defaultCustomerCode);
const excludeRefDocNos = computed(() => pulledRefDocs.value.map((r) => r.doc_no));
let custTimer = null;
let shipmentProvinceSearchTimer = null;
let shipmentAmperSearchTimer = null;
let shipmentTambonSearchTimer = null;
let shipmentLogisticAreaSearchTimer = null;
let shippingLabelSearchTimer = null;

const saleCode = ref("");
const saleName = ref("");
const saleName2 = ref("");
const saleSearch = ref("");
const saleResults = ref([]);
const saleLoading = ref(false);
const employeeDialogVisible = ref(false);
let saleTimer = null;
let customerDisplaySyncTimer = null;

const inquiryType = ref(1);
const docDate = ref(todayISO());
const vatType = ref(2);
const vatRate = ref(10);
const remark = ref("");
const remark2 = ref("");
const remark3 = ref("");
const remark4 = ref("");
const remark5 = ref("");
const docTime = ref("");
const contactor = ref("");
const docRef = ref("");
const docRefDate = ref(todayISO());
const saleGroup = ref("");

// ── เพิ่มเติม tab ──────────────────────────────────────────────────────────
const branchCode = ref("");
const docGroup = ref("");
const sideCode = ref("");
const departmentCode = ref("");
const allocateCode = ref("");
const projectCode = ref("");
const jobCode = ref("");
const cashierCode = ref("");
const userApprove = ref("");

const branchList = ref([]);
const docGroupList = ref([]);
const sideList = ref([]);
const departmentList = ref([]);
const allocateList = ref([]);
const projectList = ref([]);
const jobList = ref([]);
const contactorList = ref([]);
const saleGroupList = ref([]);
// ───────────────────────────────────────────────────────────────────────────

const discountWord = ref("");
const creditDay = ref(0);
const dueDate = ref(todayISO());
const sendDate = ref(todayISO());
const deliveryDate = ref(todayISO());
const sendType = ref(0);
const transportType = ref(null);
const documentCurrency = ref(null);
const documentExchangeRate = ref(1);
const documentExchangeRateText = ref("1");
const customerCredit = ref(null);
const customerCreditLoading = ref(false);
const customerCreditError = ref("");

const productSearch = ref("");
const productSearchRef = ref(null);
const productResults = ref([]);
const productLoading = ref(false);
const productDialogVisible = ref(false);
const expandedProductKeys = ref({});
const productResultBalanceLoadingByKey = ref({});
const productResultBalanceErrorByKey = ref({});
const productBalanceRowsByKey = ref({});
const productBalanceTotalByKey = ref({});
const productBalancePageByKey = ref({});
const productBalanceBranchesByKey = ref({});
const productBalanceActiveBranchByKey = ref({});
const productBalanceBranchLoadingByKey = ref({});
const productBalanceLoadingByKey = ref({});
const productBalanceErrorByKey = ref({});
const lineImageErrorById = ref({});
const lineImageDialogVisible = ref(false);
const lineImageDialogSrc = ref("");
const lineImageDialogTitle = ref("");
const saleItemHistoryDialogVisible = ref(false);
const saleItemHistoryLoading = ref(false);
const saleItemHistoryError = ref("");
const saleItemHistoryRows = ref([]);
const saleItemHistoryLine = ref(null);
const salePriceFormulaDialogVisible = ref(false);
const salePriceFormulaLoading = ref(false);
const salePriceFormulaError = ref("");
const salePriceFormulaData = ref({ rows: [] });
const salePriceFormulaLine = ref(null);
const productBasketVisible = ref(false);
const warehouseOptions = ref([]);
const shelfOptionsByWh = ref({});
const barcodeInput = ref("");
const barcodeRef = ref(null);
const barcodeAdding = ref(false);
const barcodeQueue = ref([]);
const barcodeQueueCount = computed(() => barcodeQueue.value.length);
const priceRefreshing = ref(false);
const rows = ref([]);
const productBalanceDefaultRows = 20;
const productResultStockPriorityCount = 16;
const productResultStockBatchSize = 20;
const productResultStockBackgroundDelay = 160;
const productResultStockCacheTtlMs = 45_000;
const productSearchDebounceMs = 2_000;
const productResultStockCache = new Map();
const productResultStockHydrationTimers = new Set();
let lineDisplayOrderCounter = 0;
let priceRefreshTimer = null;
let priceRefreshRunId = 0;
let productSearchRunId = 0;
let productSearchTimer = null;
let whPickerBalanceRunId = 0;
const priceEditorVisible = ref(false);
const priceEditLine = ref(null);
const priceEditValue = ref(0);
const remarkEditorVisible = ref(false);
const remarkEditLine = ref(null);
const remarkEditText = ref("");
const nameEditorVisible = ref(false);
const nameEditLine = ref(null);
const nameEditText = ref("");
const activeLineId = ref(null);
const discountEditorVisible = ref(false);
const discountEditLine = ref(null);
const discountEditText = ref("");
const billDiscountEditorVisible = ref(false);
const billDiscountEditText = ref("");
const pricePermissionDialogVisible = ref(false);
const pricePermissionUser = ref("");
const pricePermissionPassword = ref("");
const pricePermissionLoading = ref(false);
const pricePermissionError = ref("");
const pricePermissionActionLabel = ref("");
const pricePermissionAction = ref(null);
const pricePermissionHeader = ref("");
const pricePermissionHelpText = ref("");
const pricePermissionDeniedText = ref("");
const pricePermissionVerifier = ref(verifyPriceEditPermission);
const unitEditorVisible = ref(false);
const unitEditLine = ref(null);
const whPickerVisible = ref(false);
const whPickerLine = ref(null);
const whPickerSearch = ref("");
const whPickerBalanceLoading = ref(false);
const whPickerSaving = ref(false);
const whPickerBalanceError = ref("");
const whPickerBalanceByCode = ref({});
const unitEditOptions = ref([]);
const unitEditSelectedKey = ref("");
const unitEditLoading = ref(false);
const unitEditSaving = ref(false);
const unitEditError = ref("");
const promotionLoading = ref(false);
const promotionDirty = ref(false);
const promotionError = ref("");
const promotionResults = ref([]);
const promotionProductRows = ref([]);
const promotionDiscountRaw = ref(0);
const promotionLastCalculatedAt = ref("");
const posCampaignLoading = ref(false);
const posCampaignDirty = ref(false);
const posCampaignError = ref("");
const posCampaignRows = ref([]);
const posCampaignLastCalculatedAt = ref("");
const saleBenefitDetailDialogVisible = ref(false);
const promotionGuideLoading = ref(false);
const promotionGuideError = ref("");
const promotionGuideMap = ref({});
const promotionGuideDialogVisible = ref(false);
const promotionGuideDialogLine = ref(null);
let promotionTimer = null;
let promotionRunId = 0;
let promotionGuideTimer = null;
let promotionGuideRunId = 0;

const activePayType = ref("cash");
const paymentEntries = ref([]);
const paymentReviewNeeded = ref(false);
const paymentReviewTotal = ref(null);
const cashInputAmount = ref(0);
const cashTenderText = ref("0");
const cashTenderInputRef = ref(null);
const cashCurrencyCode = ref("THB");
const cashCurrencyAmount = ref(0);
const cashExchangeRate = ref(1);
const cashExchangeRateText = ref("1");
const cashCurrencyDrafts = ref({});
const exchangeRateEditAuthorized = ref({});
const cashQuickAmounts = [20, 50, 100, 500, 1000];
const cashForeignQuickAmounts = [500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
const cashForeignSmallQuickAmounts = [10, 20, 30, 50, 100];
const cashKeypadKeys = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", ".", "backspace"];
const transferInputAmount = ref(0);
const transferCurrency = ref(null);
const transferExchangeRate = ref(1);
const transferExchangeRateText = ref("1");
const transferChargePercent = ref(0);
const transferDate = ref(todayISO());
const transferPassBook = ref(null);
const creditTransferCardRemark = ref("");
const creditTransferApprovalRemark = ref("");
const creditTransferRequiredReady = computed(() => String(creditTransferCardRemark.value || "").trim().length > 0 && String(creditTransferApprovalRemark.value || "").trim().length > 0);
const creditInputAmount = ref(0);
const creditCurrency = ref(null);
const creditExchangeRate = ref(1);
const creditExchangeRateText = ref("1");
const creditType = ref(null);
const creditCardNumber = ref("");
const creditApprovalNo = ref("");
const chequePassBook = ref(null);
const chequeNumber = ref("");
const chequeDueDate = ref(todayISO());
const chequeAmount = ref(0);
const chequeCurrency = ref(null);
const chequeExchangeRate = ref(1);
const chequeExchangeRateText = ref("1");
const pettyCashAccount = ref(null);
const pettyCashAmount = ref(0);
const depositDoc = ref(null);
const depositAmount = ref(0);
const depositOptions = ref([]);
const depositSearch = ref("");
const depositMoneyDoc = ref(null);
const depositMoneyAmount = ref(0);
const depositMoneyOptions = ref([]);
const depositMoneySearch = ref("");
const couponSearch = ref("");
const couponOptions = ref([]);
const couponSelected = ref(null);
const couponAmount = ref(0);
const couponLookupLoading = ref(false);
const couponLookupError = ref("");
const incomeType = ref(null);
const incomeAmount = ref(0);
const expenseType = ref(null);
const expenseAmount = ref(0);
const otherCurrency = ref(null);
const otherCurrencyAmount = ref(0);
const otherCurrencyCharge = ref(0);
const otherCurrencyExchangeRate = ref(1);
const otherCurrencyExchangeRateText = ref("1");
const walletType = ref(null);
const walletAmount = ref(0);
const walletNumber = ref("");
const walletApprovedNo = ref("");
const walletRef1 = ref("");
const walletRef2 = ref("");
const laoQrProvider = ref("laoqr");
const laoQrConfig = ref(null);
const laoQrConfigLoading = ref(false);
const laoQrConfigError = ref("");
const laoQrCurrency = ref(null);
const laoQrAmountLak = ref(0);
const laoQrStatus = ref("idle");
const laoQrMessage = ref("");
const laoQrResponse = ref(null);
const laoQrStatusResponse = ref(null);
const laoQrQrImage = ref("");
const laoQrUuid = ref("");
const laoQrInvoiceId = ref("");
const laoQrExpiresAt = ref(0);
const laoQrCountdownNow = ref(Date.now());
const laoQrSavingPaid = ref(false);
const laoQrDialogVisible = ref(false);
const laoQrPaymentRequests = ref([]);
const activeLaoQrRequestId = ref("");
const laoQrCheckingRequestId = ref("");
const laoQrHistoryDialogVisible = ref(false);
const laoQrHistoryToday = new Date();
const laoQrHistoryFromDate = ref(new Date(laoQrHistoryToday.getFullYear(), laoQrHistoryToday.getMonth(), laoQrHistoryToday.getDate()));
const laoQrHistoryToDate = ref(new Date(laoQrHistoryToday.getFullYear(), laoQrHistoryToday.getMonth(), laoQrHistoryToday.getDate()));
const laoQrHistoryStatus = ref("all");
const laoQrHistorySearch = ref("");
const laoQrHistoryRows = ref([]);
const laoQrHistoryLoading = ref(false);
const laoQrHistoryCheckingId = ref(null);
const laoQrHistoryError = ref("");
const transferQrDialogVisible = ref(false);
const transferQrSelectedCode = ref("");
let laoQrPollTimer = null;
let laoQrCountdownTimer = null;
let laoQrCreateRunId = 0;
let laoQrApplyingRequest = false;
const roundedAmount = ref(0);
const passBooks = ref([]);
const creditTypes = ref([]);
const pettyCashList = ref([]);
const incomeTypes = ref([]);
const expenseTypes = ref([]);
const currencyTypes = ref([]);
const walletTypes = ref([]);
const transportTypes = ref([]);
const shipmentTransportTypeOptions = ref([]);
const shippingLabels = ref([]);
const shippingLabelLoading = ref(false);
const provinceOptions = ref([]);
const amperOptions = ref([]);
const tambonOptions = ref([]);
const logisticAreaOptions = ref([]);
const shipmentMasterLoading = ref({
  province: false,
  amper: false,
  tambon: false,
  logisticArea: false,
});
const glAccounts = ref([]);
const defaultSummaryCurrencyCodes = [DEFAULT_CUSTOMER_DISPLAY_CURRENCY_CODE, "THB", "USD", "CNY"];
const paymentMasterOptions = ref({
  multi_currency: 0,
  input_credit_card_charge: 0,
  coupon_full_amount: 0,
  inventory_gl_post: "",
  home_currency: "",
  currency_exchange_decimal: 2,
  summary_currency_codes: defaultSummaryCurrencyCodes,
});

const taxDocNo = ref("");
const taxDocDate = ref(todayISO());
const vatSaleDescription = ref("");
const vatSaleTaxNo = ref("");
const vatSaleBranchCode = ref("");
const vatRows = ref([]);
const vatAutoInput = ref(true);
const vatAutoNumber = ref(true);
const vatAutoCalc = ref(true);
const vatCreateDefaultRow = ref(true);
const selectedShippingLabel = ref(null);
const shipment = ref({
  transport_name: "",
  transport_address: "",
  transport_telephone: "",
  transport_fax: "",
  transport_tambon: "",
  transport_amper: "",
  transport_province: "",
  transport_country: "",
  zipcode: "",
  transport_code: "",
  destination: "",
  remark: "",
  remark_2: "",
  ship_code: "",
  logistic_area: "",
  latitude: 0,
  longitude: 0,
});
const whtHeaders = ref([]);
const selectedWhtHeaderId = ref("");
const whtIncomeType = ref("");
const whtAmount = ref(0);
const whtRate = ref(0);
const manualGlRows = ref([]);
const glTransDirect = ref(1);
const inventoryGlPostMode = ref("system");
const glRefDate = ref("");
const glRefNo = ref("");
const glBookCode = ref("");
const glJournalType = ref(0);
const glDescription = ref("");
const glApArCode = ref("");
const glApArOriginateFrom = ref(0);
const manualGlAccount = ref(null);
const manualGlDebit = ref(0);
const manualGlCredit = ref(0);

const printDialogVisible = ref(false);
const printLoading = ref(false);
const printError = ref("");
const printForms = ref([]);
const selectedPrintForm = ref("");
const loadedEditDocNo = ref("");
const hydratingShipment = ref(false);

const inquiryTypeOptions = computed(() => [
  { label: t("sell.creditSale"), value: 0 },
  { label: t("sell.cashSale"), value: 1 },
  { label: t("sell.creditService"), value: 2 },
  { label: t("sell.cashService"), value: 3 },
]);

const vatTypeOptions = computed(() => [
  { label: t("sell.vatExclusive"), value: 0 },
  { label: t("sell.vatInclusive"), value: 1 },
  { label: t("sell.vatZero"), value: 2 },
  { label: t("sell.vatNone"), value: 3 },
]);

const workspaceTabs = computed(() => [
  { label: t("sell.details"), value: "details", icon: "pi pi-file-edit" },
  { label: t("sell.documents"), value: "documents", icon: "pi pi-file" },
  { label: tl("เงินมัดจำ", "Deposit", "ເງິນມັດຈຳ"), value: "deposit_money", icon: "pi pi-wallet" },
  { label: t("sell.transport"), value: "shipment", icon: "pi pi-send" },
  { label: t("sell.vat"), value: "vat", icon: "pi pi-receipt" },
  { label: t("sell.wht"), value: "wht", icon: "pi pi-percentage" },
  { label: "GL", value: "gl", icon: "pi pi-sitemap" },
  { label: t("sell.more"), value: "additional", icon: "pi pi-plus-circle" },
]);

const vatBranchTypeOptions = computed(() => [
  { label: t("sell.headOffice"), value: 0 },
  { label: t("sell.branch"), value: 1 },
]);

const vatSaleTypeOptions = computed(() => [
  { label: t("sell.saleProduct"), value: 0 },
  { label: t("sell.saleService"), value: 1 },
  { label: t("sell.otherDocument"), value: 2 },
]);

const sendTypeOptions = computed(() => [
  { label: t("sell.pickup"), value: 0 },
  { label: t("sell.delivery"), value: 1 },
]);

function updateShipmentTransportType(code) {
  const value = String(code || "")
    .trim()
    .toUpperCase();
  transportType.value = optionByCode(shipmentTransportTypeOptions.value, value) || (value ? { code: value, label: value, name_1: value } : null);
  shipment.value.transport_code = transportType.value?.code || value || "";
  if (value === "PICK") sendType.value = 0;
  if (value === "DELIVER") sendType.value = 1;
}

const glJournalTypeOptions = computed(() => [
  { label: t("sell.dailyBusiness"), value: 0 },
  { label: t("sell.dailyProfitLoss"), value: 1 },
  { label: t("sell.closing"), value: 2 },
  { label: t("sell.adjustment"), value: 3 },
  { label: t("sell.openingBalance"), value: 4 },
]);

const glApArOriginateFromOptions = computed(() => [
  { label: t("sell.notSpecified"), value: 0 },
  { label: t("sell.other"), value: 1 },
]);

const inventoryGlPostModeOptions = computed(() => [
  { label: t("sell.systemDefault"), value: "system" },
  { label: "Perpetual", value: "perpetual" },
  { label: "Periodic", value: "periodic" },
]);

const basePaymentTypeOptions = computed(() => [
  { label: t("payment.cash"), value: "cash", icon: "pi pi-money-bill" },
  { label: "LAO QR", value: "laoqr", icon: "pi pi-qrcode" },
  { label: t("sell.transfer"), value: "transfer", icon: "pi pi-building-columns" },
  { label: t("sell.creditCard"), value: "credit_transfer", icon: "pi pi-credit-card" },
  // { label: t("sell.card"), value: "credit", icon: "pi pi-credit-card" },
  // { label: t("sell.cheque"), value: "cheque", icon: "pi pi-file" },
  { label: t("sell.coupon"), value: "coupon", icon: "pi pi-ticket" },
  { label: t("sell.otherIncome"), value: "income", icon: "pi pi-plus-circle" },
  { label: t("sell.otherExpense"), value: "expense", icon: "pi pi-minus-circle" },
  { label: t("sell.deposit"), value: "deposit", icon: "pi pi-receipt" },
  { label: tl("เงินมัดจำ", "Deposit", "ເງິນມັດຈຳ"), value: "deposit_money", icon: "pi pi-wallet" },
  { label: t("payment.pettyCash"), value: "petty", icon: "pi pi-briefcase" },
  // { label: t("sell.otherCurrency"), value: "currency", icon: "pi pi-globe" },
  // { label: "Wallet", value: "wallet", icon: "pi pi-wallet" },
]);

const cashCurrencyPayTypePrefix = "cash-currency:";

function cashCurrencyPayTypeValue(code) {
  return `${cashCurrencyPayTypePrefix}${normalizeCashCurrencyCode(code)}`;
}

function isCashCurrencyPayType(type) {
  return String(type || "").startsWith(cashCurrencyPayTypePrefix);
}

function cashCurrencyCodeFromPayType(type) {
  return normalizeCashCurrencyCode(String(type || "").slice(cashCurrencyPayTypePrefix.length));
}

const homeCashCurrencyAliases = new Set(["BTH", "THB", "TH"]);

function normalizeCashCurrencyCode(code) {
  const value = String(code || "")
    .trim()
    .toUpperCase();
  return homeCashCurrencyAliases.has(value) ? "THB" : value;
}

function isHomeCashCurrencyCode(code) {
  return normalizeCashCurrencyCode(code) === "THB";
}

function isKipCashCurrencyCode(code) {
  return ["LAK", "KIP", "KIPP", "KIP2", "LAO"].includes(normalizeCashCurrencyCode(code));
}

const changeRoundingCurrencyCode = normalizeCashCurrencyCode(import.meta.env.VITE_CHANGE_CURRENCY_CODE || "KIP") || "KIP";
const changeRoundingStep = (() => {
  const value = Number(import.meta.env.VITE_CHANGE_ROUNDING_STEP);
  return Number.isFinite(value) && value > 0 ? value : 500;
})();
const changeRoundingMode = (() => {
  const value = String(import.meta.env.VITE_CHANGE_ROUNDING_MODE || "down")
    .trim()
    .toLowerCase();
  return ["down", "up", "nearest"].includes(value) ? value : "down";
})();
const changeRoundingIncomeCode = String(import.meta.env.VITE_CHANGE_ROUNDING_INCOME_CODE || "RD-002").trim() || "RD-002";
const changeRoundingPrecision = 8;

const foreignCashCurrencyCodes = computed(() => Array.from(new Set(summaryCurrencyCodes.value.map(normalizeCashCurrencyCode).filter((code) => code && code !== "THB"))));

const cashCurrencyTabs = computed(() => {
  const thbTab = { code: "THB", label: "THB", name: t("sell.baht"), name_2: "1", rate: 1, home: true };
  const foreignTabs = foreignCashCurrencyCodes.value.map((code) => {
    const currency = currencyOptionByCode(code, null);
    return {
      code,
      label: code,
      name: String(currency?.name_1 || currency?.name || code).trim() || code,
      name_2: String(currency?.name_2 || "").trim(),
      rate: paymentCurrencyRate(currency, 0),
      home: false,
    };
  });
  const kipTabs = foreignTabs.filter((tab) => isKipCashCurrencyCode(tab.code));
  const otherForeignTabs = foreignTabs.filter((tab) => !isKipCashCurrencyCode(tab.code));
  return [...kipTabs, thbTab, ...otherForeignTabs];
});

const defaultCashCurrencyCode = computed(() => foreignCashCurrencyCodes.value.find((code) => isKipCashCurrencyCode(code)) || "THB");

const otherCurrencyOptions = computed(() => currencyTypes.value.filter((row) => !foreignCashCurrencyCodes.value.includes(normalizeCashCurrencyCode(row.code))));

const foreignCashPaymentTypeOptions = computed(() =>
  toNumber(paymentMasterOptions.value.multi_currency) === 1
    ? foreignCashCurrencyCodes.value.map((code) => {
        const currency = currencyOptionByCode(code, null);
        return {
          label: code,
          value: cashCurrencyPayTypeValue(code),
          icon: "pi pi-money-bill",
          currency_code: code,
          helper: String(currency?.name_1 || currency?.name || code).trim() || code,
          name_2: String(currency?.name_2 || "").trim(),
        };
      })
    : [],
);

const visiblePaymentTypeOptions = computed(() => basePaymentTypeOptions.value.filter((tab) => tab.value !== "currency" || toNumber(paymentMasterOptions.value.multi_currency) === 1));

const docFormatOptions = computed(() => {
  const branchCode = String(posStore.selectedPos?.branch_code || "").trim();
  return docFormats.value
    .filter((format) => {
      if (!format.use_branch_select) return true;
      if (!branchCode) return true;
      return String(format.branch_list || "")
        .split(",")
        .map((b) => b.trim())
        .includes(branchCode);
    })
    .map((format) => ({
      ...format,
      label: `${format.code}`,
    }));
});

function resolveDocFormatOptionCode(value) {
  const code = String(value || "").trim();
  if (!code) return "";
  const format = docFormats.value.find((row) => String(row.code || "").trim() === code || String(row.screen_code || "").trim() === code);
  return format?.code || code;
}

const selectedDocFormat = computed(() => docFormats.value.find((format) => format.code === docFormatCode.value) || null);

function defaultSaleDocFormatCode() {
  const deviceDocFormat = String(posStore.deviceConfig?.default_sale_doc_format_code || "").trim();
  if (deviceDocFormat) {
    const deviceFormat = docFormatOptions.value.find((row) => row.code === deviceDocFormat || String(row.screen_code || "").trim() === deviceDocFormat);
    if (deviceFormat) return deviceFormat.code;
  }
  const posDocFormat = posStore.selectedPos?.doc_format_code || posStore.selectedPos?.doc_format || "";
  return docFormatOptions.value.find((row) => row.code === posDocFormat || String(row.screen_code || "").trim() === posDocFormat)?.code || docFormatOptions.value[0]?.code || "";
}

function defaultSaleInquiryType() {
  return toNumber(posStore.selectedPos?.sale_type ?? posStore.selectedPos?.inquiry_type, 1);
}

function defaultSaleVatType() {
  return toNumber(posStore.selectedPos?.vat_type ?? posStore.selectedPos?.tax_type ?? posStore.erpOption?.vat_type, 1);
}

function defaultDocumentCurrency() {
  return currencyTypes.value.find((row) => row.code === paymentMasterOptions.value.home_currency) || currencyTypes.value.find((row) => row.code === "THB") || null;
}

function currencyOptionByCode(code, fallback = defaultDocumentCurrency()) {
  const target = String(code || "").trim();
  if (!target) return fallback;
  return (
    currencyTypes.value.find((row) => String(row.code || "").trim() === target) || {
      code: target,
      label: target,
      name_1: target,
      exchange_rate_present: target === "THB" ? 1 : 0,
    }
  );
}

function paymentCurrencyCode(currency) {
  return String(currency?.code || "").trim();
}

function normalizeSummaryCurrencyCodes(value) {
  const rawList = Array.isArray(value)
    ? value
    : String(value || "")
        .split(",")
        .map((word) => String(word || "").trim());
  const cleaned = rawList
    .map((word) =>
      String(word || "")
        .trim()
        .toUpperCase(),
    )
    .filter(Boolean);
  return cleaned.length ? Array.from(new Set(cleaned)) : [...defaultSummaryCurrencyCodes];
}

function paymentCurrencyRate(currency, fallback = 1) {
  const code = paymentCurrencyCode(currency);
  if (!code || code === "THB") return 1;
  return toNumber(currency?.exchange_rate_present, masterCurrencyRate(code, fallback)) || fallback;
}

function paymentCurrencyName2Rate(currency, fallback = 1) {
  const code = paymentCurrencyCode(currency);
  if (!code || code === "THB") return 1;
  return toNumber(String(currency?.name_2 || "").replace(/,/g, ""), 0) || paymentCurrencyRate(currency, fallback) || fallback;
}

function applyPaymentCurrency(targetCurrency, targetRate, code) {
  const currency = currencyOptionByCode(code);
  targetCurrency.value = currency;
  targetRate.value = paymentCurrencyRate(currency, paymentCurrencyCode(currency) === "THB" ? 1 : 0);
}

function optionLabel(row) {
  return `${row?.code || ""} ${row?.name_1 || row?.name || ""}`.trim();
}

const allowedSaleWarehouseCodes = computed(() => normalizeAllowedSaleWarehouseCodes(posStore.deviceConfig?.allowed_sale_wh_codes));
const allowedSaleWarehouseCodeSet = computed(() => new Set(allowedSaleWarehouseCodes.value));

function isSaleWarehouseAllowed(whCode) {
  const code = String(whCode || "")
    .trim()
    .toUpperCase();
  return !allowedSaleWarehouseCodeSet.value.size || allowedSaleWarehouseCodeSet.value.has(code);
}

function saleWarehouseNotAllowedMessage(whCode) {
  const code = String(whCode || "").trim();
  return tl(
    `ไม่สามารถขายคลังที่เลือกได้${code ? ` (${code})` : ""}`,
    `The selected warehouse cannot be sold from${code ? ` (${code})` : ""}.`,
    `ບໍ່ສາມາດຂາຍຈາກຄັງທີ່ເລືອກໄດ້${code ? ` (${code})` : ""}`,
  );
}

function assertSaleWarehouseAllowed(whCode) {
  if (String(whCode || "").trim() && !isSaleWarehouseAllowed(whCode)) {
    throw new Error(saleWarehouseNotAllowedMessage(whCode));
  }
}

function balanceRowHasStock(row) {
  return toNumber(row?.balance_base ?? row?.sum_balance_qty ?? row?.balance_qty) > 0;
}

function defaultSaleWarehouseCode(fallbacks = []) {
  const candidates = [...fallbacks, posStore.selectedPos?.pos_ic_wht, ...warehouseOptions.value.map((row) => row.code), ...allowedSaleWarehouseCodes.value];
  return String(candidates.find((code) => String(code || "").trim() && isSaleWarehouseAllowed(code)) || "").trim();
}

const warehouseSelectOptions = computed(() => {
  const posBranch = String(posStore.selectedPos?.branch_code || "").trim();
  return warehouseOptions.value
    .map((row) => ({ ...row, label: optionLabel(row) }))
    .sort((a, b) => {
      const aMatch = posBranch && String(a.branch_code || "").trim() === posBranch ? 0 : 1;
      const bMatch = posBranch && String(b.branch_code || "").trim() === posBranch ? 0 : 1;
      return aMatch - bMatch;
    });
});

function shelfSelectOptions(whCode) {
  return (shelfOptionsByWh.value[whCode || ""] || []).map((row) => ({
    ...row,
    label: optionLabel(row),
  }));
}

async function ensureShelfOptions(whCode) {
  const code = String(whCode || "").trim();
  if (!code || Object.prototype.hasOwnProperty.call(shelfOptionsByWh.value, code)) return;
  shelfOptionsByWh.value = { ...shelfOptionsByWh.value, [code]: [] };
  try {
    const shelves = await getShelfList(code);
    shelfOptionsByWh.value = { ...shelfOptionsByWh.value, [code]: shelves };
  } catch {
    shelfOptionsByWh.value = { ...shelfOptionsByWh.value, [code]: [] };
  }
}

async function setLineWarehouse(line, whCode) {
  if (documentLocked.value) return;
  const nextWhCode = String(whCode || "").trim();
  if (nextWhCode && !isSaleWarehouseAllowed(nextWhCode)) return;
  line.wh_code = nextWhCode;
  line.shelf_code = "";
  delete line._stock_wh_only;
  line.balance_base = null;
  if (!line.wh_code) return;
  await ensureShelfOptions(line.wh_code);
  if (line.wh_code !== nextWhCode || line.shelf_code) return;
  line.shelf_code = shelfSelectOptions(nextWhCode)[0]?.code || shelfSelectOptions(nextWhCode)[0]?.shelf_code || "";
}

function setLineShelf(line, shelfCode) {
  if (documentLocked.value) return;
  line.shelf_code = shelfCode || "";
  delete line._stock_wh_only;
  line.balance_base = null;
}

const whPickerFiltered = computed(() => {
  const q = whPickerSearch.value.trim().toLowerCase();
  const rows = q ? warehouseSelectOptions.value.filter((w) => w.label.toLowerCase().includes(q)) : warehouseSelectOptions.value;
  if (!Object.keys(whPickerBalanceByCode.value).length) return rows;
  return rows
    .map((wh, index) => ({
      wh,
      index,
      balance: whPickerBalanceBase(wh.code),
    }))
    .filter((row) => {
      if (isServiceItem(whPickerLine.value) || isSetItem(whPickerLine.value)) return true;
      return toNumber(row.balance) > 0;
    })
    .sort((a, b) => {
      const aHasStock = toNumber(a.balance) > 0 ? 0 : 1;
      const bHasStock = toNumber(b.balance) > 0 ? 0 : 1;
      if (aHasStock !== bHasStock) return aHasStock - bHasStock;
      const balanceDiff = toNumber(b.balance) - toNumber(a.balance);
      if (balanceDiff !== 0) return balanceDiff;
      return a.index - b.index;
    })
    .map((row) => row.wh);
});

function resetWhPickerBalanceState() {
  whPickerBalanceRunId += 1;
  whPickerBalanceLoading.value = false;
  whPickerBalanceError.value = "";
  whPickerBalanceByCode.value = {};
}

function whPickerBalanceBase(whCode) {
  const key = String(whCode || "").trim();
  const row = whPickerBalanceByCode.value[key];
  return row ? toNumber(row.sum_balance_qty) : null;
}

function whPickerBalanceQty(whCode) {
  const base = whPickerBalanceBase(whCode);
  if (base == null) return null;
  return Math.floor(base / unitRatio(whPickerLine.value));
}

function whPickerBalanceLabel(whCode) {
  if (!whPickerLine.value) return "-";
  if (isServiceItem(whPickerLine.value) || isSetItem(whPickerLine.value)) {
    return tl("ไม่เช็คสต๊อก", "No stock check", "ບໍ່ກວດສະຕ໊ອກ");
  }
  const qty = whPickerBalanceQty(whCode);
  if (qty == null) {
    return whPickerBalanceLoading.value ? tl("กำลังโหลด...", "Loading...", "ກຳລັງໂຫຼດ...") : "-";
  }
  const unitCode = String(whPickerLine.value?.unit_code || "").trim();
  return `${formatQty(qty)}${unitCode ? ` ${unitCode}` : ""}`;
}

function whPickerRequestedBaseForWarehouse(whCode) {
  const line = whPickerLine.value;
  if (!line) return 0;
  const targetWhCode = String(whCode || "").trim();
  return buildStockValidationRowsFromLines(
    validRows.value.map((row) =>
      row === line
        ? {
            ...row,
            wh_code: targetWhCode,
            shelf_code: "",
          }
        : row,
    ),
  )
    .filter((row) => String(row.item_code || "") === String(line.item_code || "") && String(row.wh_code || "") === targetWhCode)
    .reduce((sum, row) => sum + toNumber(row.qty) * unitRatio(row), 0);
}

function whPickerWarehouseInsufficient(whCode) {
  if (!isCompanyOptionEnabled("ic_stock_control", false)) return false;
  const line = whPickerLine.value;
  if (!line || isServiceItem(line) || isSetItem(line)) return false;
  const base = whPickerBalanceBase(whCode);
  if (base == null) return false;
  return whPickerRequestedBaseForWarehouse(whCode) > base;
}

async function loadWhPickerBalances(line, runId = ++whPickerBalanceRunId) {
  const itemCode = String(line?.item_code || "").trim();
  const warehouses = warehouseSelectOptions.value;
  whPickerBalanceByCode.value = {};
  whPickerBalanceError.value = "";
  if (!itemCode || !warehouses.length || isServiceItem(line) || isSetItem(line)) return;

  whPickerBalanceLoading.value = true;
  const nextBalances = {};
  let failedCount = 0;
  try {
    await Promise.all(
      warehouses.map(async (wh) => {
        const whCode = String(wh.code || "").trim();
        if (!whCode) return;
        try {
          const sumBalanceQty = await getInventoryBalance(itemCode, whCode, "");
          nextBalances[whCode] = { sum_balance_qty: sumBalanceQty };
        } catch {
          failedCount += 1;
        }
      }),
    );
    if (runId !== whPickerBalanceRunId) return;
    whPickerBalanceByCode.value = nextBalances;
    if (failedCount && !Object.keys(nextBalances).length) {
      whPickerBalanceError.value = t("product.stockError");
    }
  } finally {
    if (runId === whPickerBalanceRunId) whPickerBalanceLoading.value = false;
  }
}

async function lineWarehouseCandidate(line, whCode) {
  const nextWhCode = String(whCode || "").trim();
  const candidate = {
    ...line,
    wh_code: nextWhCode,
    shelf_code: "",
    _stock_wh_only: false,
  };
  if (!nextWhCode) return candidate;
  await ensureShelfOptions(nextWhCode);
  candidate.shelf_code = shelfSelectOptions(nextWhCode)[0]?.code || shelfSelectOptions(nextWhCode)[0]?.shelf_code || "";
  return candidate;
}

async function validateLineWarehouseChange(line, whCode) {
  assertSaleWarehouseAllowed(whCode);
  const candidate = await lineWarehouseCandidate(line, whCode);
  const stockRows = buildStockValidationRowsFromLines(validRows.value.map((row) => (row === line ? candidate : row)));
  await validateStockBeforeSave(stockRows);
  return candidate;
}

function openWhPicker(line) {
  if (documentLocked.value) return;
  resetWhPickerBalanceState();
  whPickerLine.value = line;
  whPickerSearch.value = "";
  whPickerVisible.value = true;
  void loadWhPickerBalances(line);
}

function closeWhPicker(force = false) {
  if (whPickerSaving.value && !force) return;
  resetWhPickerBalanceState();
  whPickerVisible.value = false;
  whPickerLine.value = null;
  whPickerSearch.value = "";
}

async function pickWarehouse(whCode) {
  if (!whPickerLine.value || whPickerSaving.value) return;
  const line = whPickerLine.value;
  const nextWhCode = String(whCode || "").trim();
  if (nextWhCode && !isSaleWarehouseAllowed(nextWhCode)) {
    openSalePolicyDialog({
      type: "warn",
      title: tl("เปลี่ยนคลังไม่ได้", "Cannot change warehouse", "ບໍ່ສາມາດປ່ຽນຄັງໄດ້"),
      message: saleWarehouseNotAllowedMessage(nextWhCode),
    });
    return;
  }
  if (String(line.wh_code || "").trim() === nextWhCode) {
    closeWhPicker();
    return;
  }
  whPickerSaving.value = true;
  try {
    await validateLineWarehouseChange(line, nextWhCode);
    await setLineWarehouse(line, nextWhCode);
    closeWhPicker(true);
  } catch (error) {
    const detail = error.message || tl("สินค้าไม่พอขาย", "Insufficient stock", "ສິນຄ້າບໍ່ພໍຂາຍ");
    openSalePolicyDialog({
      type: "warn",
      title: tl("เปลี่ยนคลังไม่ได้", "Cannot change warehouse", "ບໍ່ສາມາດປ່ຽນຄັງໄດ້"),
      message: tl("ยอดคงเหลือในคลังที่เลือกไม่พอสำหรับรายการนี้", "The selected warehouse does not have enough stock for this line.", "ສິນຄ້າໃນຄັງທີ່ເລືອກບໍ່ພໍສຳລັບລາຍການນີ້"),
      details: [detail],
    });
  } finally {
    whPickerSaving.value = false;
  }
}

function lineImageSrc(line) {
  const directUrl = [line?.image_url, line?.image, line?.picture_url, line?.thumb_url].find((value) => String(value || "").trim());
  if (directUrl) return String(directUrl).trim();
  const itemCode = String(line?.item_code || "").trim();
  return itemCode ? getProductImageUrl(itemCode) : "";
}

function lineImageError(lineId) {
  return lineImageErrorById.value[lineId] === true;
}

function onLineImageLoad(lineId) {
  if (!Object.prototype.hasOwnProperty.call(lineImageErrorById.value, lineId)) return;
  const next = { ...lineImageErrorById.value };
  delete next[lineId];
  lineImageErrorById.value = next;
}

function onLineImageError(lineId) {
  lineImageErrorById.value = { ...lineImageErrorById.value, [lineId]: true };
}

function openLineImagePreview(line) {
  const src = lineImageSrc(line);
  if (!src) return;
  lineImageDialogSrc.value = src;
  lineImageDialogTitle.value = `${line?.item_code || ""} ${line?.item_name || ""}`.trim();
  lineImageDialogVisible.value = true;
}

const selectedMemberCode = computed(() => String(memberCode.value || "").trim());
const promotionMemberCode = computed(() => selectedMemberCode.value || custCode.value || defaultCustomerCode);
const customerDialogFilterOptions = computed(() => [
  { label: tl("ทั้งหมด", "All", "ທັງໝົດ"), value: "all" },
  { label: tl("มีสมาชิก", "Member", "ມີສະມາຊິກ"), value: "member" },
  { label: tl("ไม่มีสมาชิก", "No member", "ບໍ່ມີສະມາຊິກ"), value: "non-member" },
]);
const filteredCustomerResults = computed(() => {
  if (customerDialogFilter.value === "all") return custResults.value;
  return custResults.value.filter((customer) => {
    const hasMember = String(customer?.member_code || customer?.dealer_code || "").trim().length > 0;
    return customerDialogFilter.value === "member" ? hasMember : !hasMember;
  });
});
const customerDisplay = computed(() => {
  return `${custName.value || defaultCustomerName.value}`.trim();
});
//${saleCode.value || ""}
const employeeDisplay = computed(() => [saleName.value, saleName2.value].filter(Boolean).join(" | ").trim());
const customerDisplayCashier = computed(() => (employeeDisplayLabel(authStore.employee) || saleName.value || "").trim());

const isCreditSale = computed(() => [0, 2].includes(Number(inquiryType.value)));
const isCashSale = computed(() => !isCreditSale.value);

const validRows = computed(() => rows.value.filter((row) => String(row.item_code || "").trim() && Number(row.qty) > 0));
const displayRows = computed(() =>
  rows.value
    .map((row, index) => ({ row, index }))
    .sort((a, b) => lineDisplayOrder(b.row, b.index + 1) - lineDisplayOrder(a.row, a.index + 1))
    .map((entry) => entry.row),
);
const validDisplayRows = computed(() => displayRows.value.filter((row) => String(row.item_code || "").trim() && Number(row.qty) > 0));

function rnd(value, point = 2) {
  const factor = 10 ** point;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function roundUpCurrencyAmount(value, point = 2) {
  const factor = 10 ** point;
  return Math.ceil((Number(value) || 0) * factor - 1e-9) / factor;
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function formatExchangeRateText(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return String(rnd(num, exchangeRateDecimal));
}

function syncExchangeRateText(rateRef, textRef) {
  textRef.value = formatExchangeRateText(rateRef.value);
}

function setExchangeRateValue(rateRef, textRef, value, fallback = 1) {
  const num = Number(value);
  const fallbackNum = Number(fallback);
  const nextValue = Number.isFinite(num) && num > 0 ? num : Number.isFinite(fallbackNum) && fallbackNum > 0 ? fallbackNum : 0;
  rateRef.value = rnd(nextValue, exchangeRateDecimal);
  syncExchangeRateText(rateRef, textRef);
}

function parseExchangeRateExpression(value) {
  const text = String(value ?? "")
    .replace(/,/g, "")
    .trim();
  if (!text)
    return {
      ok: false,
      message: tl("กรุณาระบุอัตราแลกเปลี่ยน", "Please enter exchange rate", "ກະລຸນາປ້ອນອັດຕາແລກປ່ຽນ"),
    };
  if (!/^\d*\.?\d+(?:\s*[*\/]\s*\d*\.?\d+)*$/.test(text))
    return {
      ok: false,
      message: tl("รองรับเฉพาะตัวเลข เครื่องหมาย * และ /", "Only numbers, * and / are supported", "ຮອງຮັບແຕ່ຕົວເລກ, * ແລະ /"),
    };

  const tokens = text.match(/\d*\.?\d+|[*\/]/g) || [];
  if (!tokens.length || tokens.length % 2 === 0)
    return {
      ok: false,
      message: tl("รูปแบบอัตราแลกเปลี่ยนไม่ถูกต้อง", "Invalid exchange rate format", "ຮູບແບບອັດຕາແລກປ່ຽນບໍ່ຖືກຕ້ອງ"),
    };

  let result = Number(tokens[0]);
  for (let index = 1; index < tokens.length; index += 2) {
    const operator = tokens[index];
    const nextValue = Number(tokens[index + 1]);
    if (!Number.isFinite(nextValue))
      return {
        ok: false,
        message: tl("รูปแบบอัตราแลกเปลี่ยนไม่ถูกต้อง", "Invalid exchange rate format", "ຮູບແບບອັດຕາແລກປ່ຽນບໍ່ຖືກຕ້ອງ"),
      };
    if (operator === "/" && nextValue === 0)
      return {
        ok: false,
        message: tl("ไม่สามารถหารด้วยศูนย์ได้", "Cannot divide by zero", "ບໍ່ສາມາດຫານດ້ວຍສູນໄດ້"),
      };
    result = operator === "*" ? result * nextValue : result / nextValue;
  }

  if (!Number.isFinite(result) || result <= 0)
    return {
      ok: false,
      message: tl("อัตราแลกเปลี่ยนต้องมากกว่า 0", "Exchange rate must be greater than 0", "ອັດຕາແລກປ່ຽນຕ້ອງຫຼາຍກວ່າ 0"),
    };
  return { ok: true, value: rnd(result, exchangeRateDecimal) };
}

function commitExchangeRateExpression(rateRef, textRef, event = null, afterCommit = null) {
  const inputValue = event?.target?.value;
  if (inputValue !== undefined) textRef.value = inputValue;
  const parsed = parseExchangeRateExpression(textRef.value);
  if (!parsed.ok) {
    syncExchangeRateText(rateRef, textRef);
    toast.add({
      severity: "warn",
      summary: tl("อัตราแลกเปลี่ยนไม่ถูกต้อง", "Invalid exchange rate", "ອັດຕາແລກປ່ຽນບໍ່ຖືກຕ້ອງ"),
      detail: parsed.message,
      life: 2200,
    });
    return;
  }
  setExchangeRateValue(rateRef, textRef, parsed.value, rateRef.value);
  if (typeof afterCommit === "function") afterCommit(parsed.value);
}

function commitTransferExchangeRate(event = null) {
  commitExchangeRateExpression(transferExchangeRate, transferExchangeRateText, event, syncTransferExchangeRateCalculations);
}

function commitCreditExchangeRate(event = null) {
  commitExchangeRateExpression(creditExchangeRate, creditExchangeRateText, event, syncCreditExchangeRateCalculations);
}

function commitChequeExchangeRate(event = null) {
  commitExchangeRateExpression(chequeExchangeRate, chequeExchangeRateText, event, syncChequeExchangeRateCalculations);
}

function commitOtherCurrencyExchangeRate(event = null) {
  commitExchangeRateExpression(otherCurrencyExchangeRate, otherCurrencyExchangeRateText, event, syncOtherCurrencyExchangeRateCalculations);
}

function commitCashExchangeRate(event = null) {
  commitExchangeRateExpression(cashExchangeRate, cashExchangeRateText, event, (rate) => {
    setCashCurrencyDraft(cashCurrencyCode.value, cashCurrencyAmount.value, rate);
  });
}

function commitDocumentExchangeRate(event = null) {
  commitExchangeRateExpression(documentExchangeRate, documentExchangeRateText, event, syncDocumentExchangeRateCalculations);
}

function calcPaymentCharge(amount, chargeRateValue) {
  const word = String(chargeRateValue ?? "").trim();
  if (!word) return 0;
  const number = toNumber(word.replace("%", ""));
  if (number === 0) return 0;
  return word.includes("%") ? rnd(amount * (number / 100)) : rnd(number);
}

function formatQty(value) {
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(toNumber(value));
}

function formatSaleHistoryDate(value) {
  return String(value || "").slice(0, 10) || "-";
}

function saleHistoryVatLabel(value) {
  const map = {
    0: tl("ภาษีแยกนอก", "VAT exclusive", "ພາສີແຍກນອກ"),
    1: tl("ภาษีรวมใน", "VAT inclusive", "ພາສີລວມໃນ"),
    2: tl("ภาษีศูนย์", "Zero VAT", "ພາສີສູນ"),
    3: tl("ไม่กระทบภาษี", "No VAT", "ບໍ່ກະທົບພາສີ"),
  };
  return map[Number(value)] || "-";
}

const salePriceFormulaColumns = Array.from({ length: 10 }, (_, index) => ({
  field: `price_${index}`,
  label: index === 0 ? "Price 0" : `Price ${index}`,
}));

function salePriceFormulaSaleTypeLabel(value) {
  const map = {
    0: tl("ไม่เลือก", "Not selected", "ບໍ່ເລືອກ"),
    1: tl("ขายสด", "Cash sale", "ຂາຍສົດ"),
    2: tl("ขายเชื่อ", "Credit sale", "ຂາຍເຊື່ອ"),
  };
  return map[Number(value)] || "-";
}

function salePriceFormulaTaxTypeLabel(value) {
  const map = {
    0: tl("ไม่เลือก", "Not selected", "ບໍ່ເລືອກ"),
    1: tl("แยกนอก", "Exclusive", "ແຍກນອກ"),
    2: tl("รวมใน", "Inclusive", "ລວມໃນ"),
    3: tl("ภาษีศูนย์", "Zero VAT", "ພາສີສູນ"),
  };
  return map[Number(value)] || "-";
}

function formatFormulaPriceValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "-";
  const num = Number(raw);
  if (Number.isFinite(num)) return formatCurrency(num);
  return raw;
}

function salePriceFormulaCell(row, field) {
  const formula = String(row?.[field] ?? "").trim();
  const calculated = String(row?.calculated?.[field] ?? "").trim();
  return {
    formula: formula || "-",
    calculated: calculated ? formatFormulaPriceValue(calculated) : "-",
  };
}

function formatExchangeRate(value) {
  const num = toNumber(value);
  const decimals = num > 0 && num < 0.01 ? 8 : num < 1 ? 6 : 2;
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(num);
}

function normalizeCashTenderText(value) {
  const raw = String(value ?? "").replace(/,/g, "");
  let text = raw.replace(/[^\d.]/g, "");
  if (!text) return "0";
  const hasTrailingDot = text.endsWith(".");
  const parts = text.split(".");
  const integerPart = (parts.shift() || "0").replace(/^0+(?=\d)/, "") || "0";
  const decimalPart = parts.join("").slice(0, 2);
  if (hasTrailingDot && !decimalPart) return `${integerPart}.`;
  return decimalPart ? `${integerPart}.${decimalPart}` : integerPart;
}

function groupCashTenderText(text) {
  const clean = String(text ?? "");
  if (!clean) return "0";
  const hasDot = clean.includes(".");
  const [intPart, ...rest] = clean.split(".");
  const grouped = (intPart || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const decimalPart = rest.join("");
  if (hasDot) return decimalPart ? `${grouped}.${decimalPart}` : `${grouped}.`;
  return grouped;
}

function formatCashTenderText(value) {
  const amount = Math.max(0, rnd(toNumber(value)));
  return amount === 0 ? "0" : groupCashTenderText(String(amount));
}

function cashDraftAmountTotal() {
  return rnd(
    Object.values(cashCurrencyDrafts.value || {}).reduce((sum, entry) => {
      return sum + toNumber(entry?.amount);
    }, 0),
  );
}

function refreshCashInputAmountFromDrafts() {
  cashInputAmount.value = cashDraftAmountTotal();
}

function setCashCurrencyDraft(code, currencyAmount, rateValue = cashExchangeRate.value) {
  const currencyCode = normalizeCashCurrencyCode(code);
  const tenderAmount = rnd(toNumber(currencyAmount));
  const nextDrafts = { ...(cashCurrencyDrafts.value || {}) };
  if (tenderAmount <= 0) {
    delete nextDrafts[currencyCode];
    cashCurrencyDrafts.value = nextDrafts;
    refreshCashInputAmountFromDrafts();
    return;
  }
  const currency = currencyOptionByCode(currencyCode, null);
  const masterRate = paymentCurrencyRate(currency, 0);
  const rate = isHomeCashCurrencyCode(currencyCode) ? 1 : toNumber(rateValue, masterRate);
  const amount = rate > 0 ? rnd(tenderAmount * rate) : 0;
  nextDrafts[currencyCode] = {
    currency_code: currencyCode,
    currency_name: String(currency?.name_1 || currency?.name || currencyCode).trim() || currencyCode,
    currency_amount: tenderAmount,
    exchange_rate: rate,
    amount,
  };
  cashCurrencyDrafts.value = nextDrafts;
  refreshCashInputAmountFromDrafts();
}

function loadCashCurrencyDraft(code) {
  const currencyCode = normalizeCashCurrencyCode(code);
  const currency = currencyOptionByCode(currencyCode, null);
  const draft = cashCurrencyDrafts.value?.[currencyCode] || null;
  cashCurrencyCode.value = currencyCode;
  cashExchangeRate.value = draft?.exchange_rate ?? (isHomeCashCurrencyCode(currencyCode) ? 1 : paymentCurrencyRate(currency, 0));
  syncExchangeRateText(cashExchangeRate, cashExchangeRateText);
  cashCurrencyAmount.value = toNumber(draft?.currency_amount);
  cashTenderText.value = formatCashTenderText(cashCurrencyAmount.value);
}

function applyCashTenderText(value) {
  const clean = normalizeCashTenderText(value);
  cashTenderText.value = groupCashTenderText(clean);
  const tenderAmount = rnd(toNumber(clean));
  const currencyCode = normalizeCashCurrencyCode(cashCurrencyCode.value);
  const existingDraft = cashCurrencyDrafts.value?.[currencyCode] || null;
  const existingAmount = rnd(toNumber(existingDraft?.currency_amount));
  const existingRate = toNumber(existingDraft?.exchange_rate, cashExchangeRate.value);
  const cashChanged = existingAmount !== tenderAmount || rnd(existingRate, exchangeRateDecimal) !== rnd(cashExchangeRate.value, exchangeRateDecimal);
  if (cashChanged && !hydratingEditDocument.value) paymentEntries.value = paymentEntries.value.filter((entry) => !isChangeAutoIncomeEntry(entry));
  cashCurrencyCode.value = currencyCode;
  cashCurrencyAmount.value = tenderAmount;
  setCashCurrencyDraft(currencyCode, tenderAmount, cashExchangeRate.value);
  cashExchangeRate.value = cashCurrencyDrafts.value?.[currencyCode]?.exchange_rate ?? cashExchangeRate.value;
  syncExchangeRateText(cashExchangeRate, cashExchangeRateText);
}

function commitCashTenderText(event = null) {
  applyCashTenderText(event?.target?.value ?? cashTenderText.value);
  if (event?.target) event.target.value = cashTenderText.value;
}

function setCashTenderAmount(amount) {
  applyCashTenderText(formatCashTenderText(amount));
}

function setCashAmountFromBaht(amount, code = "THB") {
  cashCurrencyDrafts.value = {};
  cashInputAmount.value = 0;
  loadCashCurrencyDraft(code);
  if (toNumber(amount) > 0) setCashTenderAmount(amount);
}

function removeCashPayment(code) {
  setCashCurrencyDraft(normalizeCashCurrencyCode(code), 0);
  if (normalizeCashCurrencyCode(cashCurrencyCode.value) === normalizeCashCurrencyCode(code)) {
    cashCurrencyAmount.value = 0;
    cashTenderText.value = "0";
  }
  paymentEntries.value = paymentEntries.value.filter((entry) => !isChangeAutoIncomeEntry(entry));
}

function changeCashCurrency(code) {
  const currencyCode = normalizeCashCurrencyCode(code);
  loadCashCurrencyDraft(currencyCode);
}

function focusCashTenderInput() {
  nextTick(() => {
    const input = cashTenderInputRef.value?.$el?.querySelector?.("input") || cashTenderInputRef.value?.$el || cashTenderInputRef.value;
    input?.focus?.();
    input?.select?.();
  });
}

function creditTransferCardLabel(value) {
  const cardNumber = parseCreditTransferRemark(value).card;
  return cardNumber ? `${tl("บัตร", "Card", "ບັດ")} ${cardNumber}` : t("sell.creditCard");
}

function parseCreditTransferRemark(value) {
  const withoutCharge = String(value || "")
    .replace(/\s+charge\s+[\d.,]+\s*%.*$/i, "")
    .trim();
  const parts = withoutCharge.includes(" - ") ? withoutCharge.split(" - ") : withoutCharge.split("-");
  return {
    card: String(parts[0] || "").trim(),
    approval: String(parts.slice(1).join("-") || "").trim(),
  };
}

function paymentEntryTitle(entry) {
  if (entry?.type === "credit_transfer" || entry?.type === "transfer") {
    const currencyCode = String(entry.details?.currency_code || "").trim();
    const label = entry.type === "credit_transfer" ? creditTransferCardLabel(entry.details?.remark || entry.label) : entry.label || entry.details?.book_name || t("sell.transfer");
    return currencyCode ? `${label} (${currencyCode})` : label;
  }
  return entry?.label || paymentEntryDescription(entry);
}

function paymentEntryCurrencyDescription(entry) {
  const details = entry?.details || {};
  const currencyCode = String(details.currency_code || "").trim() || "THB";
  const currency = currencyOptionByCode(currencyCode, null);
  const currencyName = currencyCode === "THB" ? t("sell.baht") : String(currency?.name_1 || currency?.name || currencyCode).trim() || currencyCode;
  const amount = toNumber(details.sum_amount || entry?.amount);
  const textAmount = isKipCashCurrencyCode(currencyCode) ? formatQty(amount) : formatCurrency(amount);
  return `${textAmount} ${currencyName}`;
}

function paymentEntryDescription(entry) {
  if (entry.type === "cash" && entry.details?.currency_code) {
    const details = entry.details;
    if (details.currency_code === "THB") return t("payment.cash");
    return `${formatQty(details.currency_amount)} ${details.currency_name || details.currency_code} x ${formatQty(details.exchange_rate)}`;
  }
  if (entry.type === "transfer" || entry.type === "credit_transfer") {
    return entry.label || entry.details?.book_name || t("sell.transfer");
  }
  if (entry.details?.trans_number) return entry.details.trans_number;
  const labels = {
    transfer: t("sell.transfer"),
    credit: t("sell.card"),
    cheque: t("sell.cheque"),
    petty: t("payment.pettyCash"),
    deposit: t("sell.deposit"),
    deposit_money: tl("เงินมัดจำ", "Deposit", "ເງິນມັດຈຳ"),
    coupon: t("sell.coupon"),
    income: t("sell.otherIncome"),
    expense: t("sell.otherExpense"),
    currency: t("sell.otherCurrency"),
    wallet: "Wallet",
  };
  return labels[entry.type] || entry.type;
}

function cashCurrencyIconInfo(code) {
  const normalized = normalizeCashCurrencyCode(
    String(code || "THB")
      .trim()
      .toUpperCase(),
  );
  if (normalized === "THB") return { icon: "pi pi-money-bill", color: "#3b82f6", bg: "#eff6ff" };
  if (isKipCashCurrencyCode(normalized)) return { icon: "pi pi-money-bill", color: "#e87e2c", bg: "#fff7ed" };
  if (normalized === "USD") return { icon: "pi pi-dollar", color: "#22c55e", bg: "#f0fdf4" };
  if (normalized === "CNY") return { icon: "pi pi-money-bill", color: "#ef4444", bg: "#fef2f2" };
  return { icon: "pi pi-money-bill", color: "#0ea5e9", bg: "#f0f9ff" };
}

function paymentEntryIconInfo(entry) {
  const typeIcons = {
    transfer: { icon: "pi pi-building-columns", color: "#6366f1", bg: "#eef2ff" },
    credit_transfer: { icon: "pi pi-credit-card", color: "#6366f1", bg: "#eef2ff" },
    credit: { icon: "pi pi-credit-card", color: "#a855f7", bg: "#faf5ff" },
    cheque: { icon: "pi pi-file", color: "#64748b", bg: "#f8fafc" },
    petty: { icon: "pi pi-briefcase", color: "#f59e0b", bg: "#fffbeb" },
    deposit: { icon: "pi pi-receipt", color: "#14b8a6", bg: "#f0fdfa" },
    deposit_money: { icon: "pi pi-wallet", color: "#0ea5e9", bg: "#f0f9ff" },
    coupon: { icon: "pi pi-ticket", color: "#ec4899", bg: "#fdf2f8" },
    laoqr: { icon: "pi pi-qrcode", color: "#3b82f6", bg: "#eff6ff" },
    income: { icon: "pi pi-plus-circle", color: "#22c55e", bg: "#f0fdf4" },
    expense: { icon: "pi pi-minus-circle", color: "#ef4444", bg: "#fef2f2" },
    currency: { icon: "pi pi-globe", color: "#0ea5e9", bg: "#f0f9ff" },
    wallet: { icon: "pi pi-wallet", color: "#f97316", bg: "#fff7ed" },
  };
  if (entry.type === "cash") {
    return cashCurrencyIconInfo(entry.details?.currency_code || "THB");
  }
  return (
    typeIcons[entry.type] || {
      icon: "pi pi-credit-card",
      color: "#64748b",
      bg: "#f8fafc",
    }
  );
}

function masterCurrencyRate(code, fallback = 0) {
  const currencyCode = String(code || "").trim();
  if (!currencyCode || currencyCode === "THB") return 1;
  const currency = currencyTypes.value.find((item) => String(item.code || "").trim() === currencyCode);
  return toNumber(currency?.exchange_rate_present, fallback);
}

function paymentEntryChargeAmount(entry) {
  const details = entry.details || {};
  const docType = toNumber(details.doc_type);
  const charge = toNumber(details.charge);
  if (docType !== 3) return charge;
  const currencyCode = String(details.currency_code || "").trim();
  if (!currencyCode || currencyCode === "THB") return charge;
  const exchangeRate = toNumber(details.exchange_rate, masterCurrencyRate(currencyCode, 1)) || 1;
  return rnd(toNumber(details.charge_2, charge * exchangeRate));
}

function paymentEntryAmount(entry) {
  const details = entry.details || {};
  const docType = toNumber(details.doc_type);
  const amount = toNumber(details.amount, entry.amount);
  const charge = toNumber(details.charge);
  const currencyCode = String(details.currency_code || "").trim();
  const exchangeRate = toNumber(details.exchange_rate, masterCurrencyRate(currencyCode, 1)) || 1;
  const sumAmount = toNumber(details.sum_amount, docType === 3 ? amount + charge : amount);

  if (docType === 19) return rnd(sumAmount + charge);
  if (docType === 3) {
    if (currencyCode && currencyCode !== "THB") return rnd(toNumber(details.sum_amount_2, sumAmount * exchangeRate));
    return rnd(sumAmount);
  }
  if ([1, 2, 4].includes(docType)) {
    if (currencyCode && currencyCode !== "THB") return rnd(toNumber(details.sum_amount_2, sumAmount * exchangeRate));
    return rnd(sumAmount);
  }
  return rnd(toNumber(entry.amount) + charge);
}

function refreshPaymentTotalsAfterExchangeRateChange() {
  paymentReviewNeeded.value = false;
  paymentReviewTotal.value = paymentEntries.value.length ? totalDue.value : null;
}

function recalculatePaymentEntryExchangeRate(entry, exchangeRateValue) {
  if (!entry?.details) return;
  const details = entry.details;
  const docType = toNumber(details.doc_type);
  const currencyCode = String(details.currency_code || "").trim();
  if (!currencyCode || currencyCode === "THB") return;
  const exchangeRate = toNumber(exchangeRateValue, details.exchange_rate || 1) || 1;
  const amount = toNumber(details.amount ?? entry.amount);
  const charge = toNumber(details.charge);
  const sumAmount = rnd(toNumber(details.sum_amount ?? (docType === 3 ? amount + charge : amount)));

  details.exchange_rate = exchangeRate;
  if ([1, 2, 4].includes(docType)) {
    entry.amount = amount;
    details.sum_amount = amount;
    details.sum_amount_2 = rnd(amount * exchangeRate);
  } else if (docType === 3) {
    entry.amount = amount;
    details.sum_amount = sumAmount;
    details.sum_amount_2 = rnd(sumAmount * exchangeRate);
    details.charge_2 = rnd(charge * exchangeRate);
  } else if (docType === 19) {
    const convertedAmount = rnd(amount * exchangeRate);
    entry.amount = convertedAmount;
    details.sum_amount = convertedAmount;
    details.sum_amount_2 = convertedAmount;
  }
}

function syncPaymentEntriesExchangeRate(types, currencyCode, exchangeRateValue) {
  const code = String(currencyCode || "").trim();
  if (!code || code === "THB") {
    refreshPaymentTotalsAfterExchangeRateChange();
    return;
  }
  paymentEntries.value
    .filter((entry) => types.includes(entry.type) && String(entry.details?.currency_code || "").trim() === code)
    .forEach((entry) => recalculatePaymentEntryExchangeRate(entry, exchangeRateValue));
  refreshPaymentTotalsAfterExchangeRateChange();
}

function syncTransferExchangeRateCalculations(exchangeRateValue = transferRate.value) {
  syncPaymentEntriesExchangeRate(["transfer"], transferCurrencyCode.value, exchangeRateValue);
}

function syncCreditExchangeRateCalculations(exchangeRateValue = creditRate.value) {
  syncPaymentEntriesExchangeRate(["credit"], creditCurrencyCode.value, exchangeRateValue);
}

function syncChequeExchangeRateCalculations(exchangeRateValue = chequeRate.value) {
  syncPaymentEntriesExchangeRate(["cheque"], chequeCurrencyCode.value, exchangeRateValue);
}

function syncOtherCurrencyExchangeRateCalculations(exchangeRateValue = otherCurrencyRate.value) {
  syncPaymentEntriesExchangeRate(["currency"], paymentCurrencyCode(otherCurrency.value), exchangeRateValue);
}

function syncDocumentExchangeRateCalculations(exchangeRateValue = documentExchangeRateValue()) {
  const code = documentCurrencyCodeValue();
  if (!code || code === "THB") {
    refreshPaymentTotalsAfterExchangeRateChange();
    return;
  }
  if (transferCurrencyCode.value === code) setExchangeRateValue(transferExchangeRate, transferExchangeRateText, exchangeRateValue);
  if (creditCurrencyCode.value === code) setExchangeRateValue(creditExchangeRate, creditExchangeRateText, exchangeRateValue);
  if (chequeCurrencyCode.value === code) setExchangeRateValue(chequeExchangeRate, chequeExchangeRateText, exchangeRateValue);
  if (paymentCurrencyCode(otherCurrency.value) === code) setExchangeRateValue(otherCurrencyExchangeRate, otherCurrencyExchangeRateText, exchangeRateValue);
  syncPaymentEntriesExchangeRate(["transfer", "credit", "cheque", "currency"], code, exchangeRateValue);
}

function productResultKey(product) {
  return [product.item_code || "", product.unit_code || "", product.barcode || ""].join("|");
}

function productWarehouseBalances(product) {
  return productBalanceRowsByKey.value[productResultKey(product)] || [];
}

function productBalanceTotalRecords(product) {
  return toNumber(productBalanceTotalByKey.value[productResultKey(product)]);
}

function productBalanceFirst(product) {
  return toNumber(productBalancePageByKey.value[productResultKey(product)]?.first);
}

function productBalanceRows(product) {
  return toNumber(productBalancePageByKey.value[productResultKey(product)]?.rows, productBalanceDefaultRows);
}

function productBalanceBranches(product) {
  const branches = productBalanceBranchesByKey.value[productResultKey(product)] || [];
  return [...branches].sort((a, b) => {
    const aEmpty = !String(a.branch_code || "").trim() ? 1 : 0;
    const bEmpty = !String(b.branch_code || "").trim() ? 1 : 0;
    return aEmpty - bEmpty;
  });
}

function productBalanceActiveBranchCode(product) {
  const key = productResultKey(product);
  const branches = productBalanceBranches(product);
  return productBalanceActiveBranchByKey.value[key] ?? branches[0]?.branch_code ?? "";
}

function productBalanceActiveBranch(product) {
  const activeBranchCode = productBalanceActiveBranchCode(product);
  return (
    productBalanceBranches(product).find((branch) => String(branch.branch_code || "").trim() === String(activeBranchCode || "").trim()) ||
    productWarehouseBalances(product)[0] || { branch_code: activeBranchCode }
  );
}

function productBalanceBranchTitle(row = {}) {
  const branchCode = String(row.branch_code || "").trim() || "-";
  const branchName = String(row.branch_name || "").trim();
  return branchName ? `${branchCode} ${branchName}` : branchCode;
}

function productBalanceBranchSummary(product, branch = {}) {
  const unitCode = String(product?.unit_code || "").trim();
  const unitText = unitCode ? ` ${unitCode}` : "";

  return `${formatQty(branch.balance_qty)}${unitText}`;
}

function productBalanceIsSelectedBranch(row = {}) {
  const selectedBranchCode = String(posStore.selectedPos?.branch_code || "").trim();
  return !!selectedBranchCode && String(row.branch_code || "").trim() === selectedBranchCode;
}

function passBookAccountName(book) {
  book = book || {};
  return String(book.book_name || book.name_1 || book.account_name || book.name || book.book_name_1 || "").trim();
}

function passBookAccountNumber(book) {
  book = book || {};
  return String(book.book_number || book.account_number || book.bank_account || book.bank_account_no || book.account_no || book.book_no || book.pass_book_number || "").trim();
}

function passBookDisplayLabel(book) {
  book = book || {};
  const code = String(book.book_code || book.pass_book_code || book.code || "").trim();
  const bank = String(book.bank_name || book.bank_code || "").trim();
  const number = passBookAccountNumber(book);
  const name = passBookAccountName(book);
  return [code, bank, number, name].filter(Boolean).join(" ");
}

function productResultBalanceLoading(product) {
  return !!productResultBalanceLoadingByKey.value[productResultKey(product)];
}

function productResultBalanceError(product) {
  return productResultBalanceErrorByKey.value[productResultKey(product)] || "";
}

function productBalanceLoading(product) {
  return !!productBalanceLoadingByKey.value[productResultKey(product)];
}

function productBalanceBranchLoading(product) {
  return !!productBalanceBranchLoadingByKey.value[productResultKey(product)];
}

function productBalanceError(product) {
  return productBalanceErrorByKey.value[productResultKey(product)] || "";
}

function productExpanded(product) {
  return !!expandedProductKeys.value[productResultKey(product)];
}

function localTimeHHMM() {
  return new Date().toTimeString().slice(0, 5);
}

function addDaysISO(value, days = 0) {
  const date = value ? new Date(`${value}T00:00:00`) : new Date();
  if (Number.isNaN(date.getTime())) return todayISO();
  date.setDate(date.getDate() + toNumber(days));
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function makeLineId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `line-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nextLineDisplayOrder() {
  lineDisplayOrderCounter += 1;
  return lineDisplayOrderCounter;
}

function touchLineDisplayOrder(line) {
  if (!line) return;
  line._display_order = nextLineDisplayOrder();
}

function lineDisplayOrder(line, fallback = 0) {
  return toNumber(line?._display_order, fallback);
}

function priceOpts() {
  const currencyCode = documentCurrencyCodeValue();
  return {
    sale_type: inquiryType.value,
    vat_type: vatType.value,
    vat_rate: vatRate.value,
    doc_date: docDate.value,
    ...(currencyCode ? { currency_code: currencyCode } : {}),
  };
}

function posPriceOpts(extra = {}) {
  const pos = posStore.selectedPos || {};
  return {
    barcode: extra.barcode || "",
    pos_id: String(posStore.posId || pos.pos_id || pos.code || pos.pos_code || "").trim(),
    branch_code: String(pos.branch_code || branchCode.value || "").trim(),
    member_code: selectedMemberCode.value,
    default_cust_code: defaultCustomerCode,
    price_number: toNumber(pos.price_number ?? pos.price_no ?? pos.pos_price_number ?? 1, 1),
    ...extra,
  };
}

async function getPosLinePrice(itemCode, unitCode, qty = 1, barcode = "") {
  return getPricePos(itemCode, unitCode, custCode.value, String(qty), posPriceOpts({ barcode }));
}

function lineDiscountAmount(line) {
  const discount = String(line.discount || "").trim() || String(line.discount_amount || "").trim();
  return calcDiscountAmount(toNumber(line.price), toNumber(line.qty), discount, itemAmountDecimal.value).discount_amount;
}

function lineSumAmount(line) {
  const discount = String(line.discount || "").trim() || String(line.discount_amount || "").trim();
  return Math.max(0, calcDiscountAmount(toNumber(line.price), toNumber(line.qty), discount, itemAmountDecimal.value).sum_amount);
}

function documentCurrencyCodeValue() {
  return String(documentCurrency.value?.code || "")
    .trim()
    .toUpperCase();
}

function isDocumentForeignCurrencyValue() {
  const code = documentCurrencyCodeValue();
  return !!code && code !== "THB";
}

function documentExchangeRateValue() {
  return toNumber(documentExchangeRate.value, 1) || 1;
}

function lineHomePrice(line) {
  const price = toNumber(line.price);
  return isDocumentForeignCurrencyValue() ? rnd(price * documentExchangeRateValue(), itemPriceDecimal.value) : price;
}

function lineHomeSumAmount(line) {
  const amount = lineSumAmount(line);
  return isDocumentForeignCurrencyValue() ? rnd(amount * documentExchangeRateValue(), itemAmountDecimal.value) : amount;
}

function lineHomeDiscountAmount(line) {
  const amount = lineDiscountAmount(line);
  return isDocumentForeignCurrencyValue() ? rnd(amount * documentExchangeRateValue(), itemAmountDecimal.value) : amount;
}

const documentTotalValueVat = computed(() => validRows.value.reduce((sum, row) => (Number(row.tax_type) === 1 ? sum : sum + lineSumAmount(row)), 0));

const documentTotalValueNoVat = computed(() => validRows.value.reduce((sum, row) => (Number(row.tax_type) === 1 ? sum + lineSumAmount(row) : sum), 0));

const totalValueVat = computed(() => validRows.value.reduce((sum, row) => (Number(row.tax_type) === 1 ? sum : sum + lineHomeSumAmount(row)), 0));

const totalValueNoVat = computed(() => validRows.value.reduce((sum, row) => (Number(row.tax_type) === 1 ? sum + lineHomeSumAmount(row) : sum), 0));

function vatCalc(totalVat, totalNoVat, discWord, rate, type, discountType = 0, discountVatType = 0, promotionDiscountAmount = 0, amountPoint = 2) {
  const p = amountPoint;
  const totalValue = totalVat + totalNoVat;
  const afterDiscount = calcAfterDiscount(discWord, totalValue, p);
  const billDiscount = rnd(totalValue - afterDiscount, p);
  const promotionDiscount = rnd(Math.abs(toNumber(promotionDiscountAmount)), p);
  const totalDiscount = rnd(billDiscount + promotionDiscount, p);

  let beforeVat = 0;
  let vatValue = 0;
  let afterVat = 0;
  let totalAmount = 0;
  let totalExceptVat = totalNoVat;
  let discountNoVatAmount = 0;

  switch (Number(type)) {
    case 0:
      if (Number(discountType) === 1) {
        if (Number(discountVatType) === 1) {
          const vatDiscount = totalValue > 0 ? rnd(totalDiscount * (totalVat / totalValue), p) : 0;
          discountNoVatAmount = totalDiscount - vatDiscount;
          beforeVat = totalVat - vatDiscount;
        } else if (totalVat < totalDiscount) {
          beforeVat = 0;
          discountNoVatAmount = totalDiscount - totalVat;
        } else {
          beforeVat = totalVat - totalDiscount;
        }
        vatValue = totalVat < totalDiscount && Number(discountVatType) !== 1 ? 0 : rnd(beforeVat * (rate / 100), p);
        afterVat = beforeVat + vatValue;
        totalExceptVat -= discountNoVatAmount;
        totalAmount = totalExceptVat + afterVat;
      } else {
        beforeVat = totalVat;
        vatValue = rnd(beforeVat * (rate / 100), p);
        afterVat = beforeVat + vatValue;
        totalAmount = beforeVat + totalExceptVat + vatValue - totalDiscount;
      }
      break;
    case 1:
      totalAmount = totalValue - totalDiscount;
      if (Number(discountType) === 1) {
        if (Number(discountVatType) === 1) {
          const vatDiscount = totalValue > 0 ? rnd(totalDiscount * (totalVat / totalValue), p) : 0;
          discountNoVatAmount = totalDiscount - vatDiscount;
          const base = totalVat - vatDiscount;
          beforeVat = rnd((base * 100) / (100 + rate), p);
          vatValue = rnd(base - beforeVat, p);
        } else if (totalVat < totalDiscount) {
          beforeVat = 0;
          vatValue = 0;
          discountNoVatAmount = totalDiscount - totalVat;
        } else {
          const base = totalVat - totalDiscount;
          beforeVat = rnd((base * 100) / (100 + rate), p);
          vatValue = rnd(base - beforeVat, p);
        }
        afterVat = beforeVat + vatValue;
        totalExceptVat -= discountNoVatAmount;
      } else {
        beforeVat = rnd((totalVat * 100) / (100 + rate), p);
        vatValue = rnd(totalVat - beforeVat, p);
        afterVat = beforeVat + vatValue;
      }
      break;
    default:
      vatValue = 0;
      if (Number(discountVatType) === 1 && totalValue > 0) {
        const vatDiscount = rnd(totalDiscount * (totalVat / totalValue), p);
        discountNoVatAmount = totalDiscount - vatDiscount;
      }
      totalExceptVat -= discountNoVatAmount;
      totalAmount = totalValue - totalDiscount;
      break;
  }

  return {
    totalValue: rnd(totalValue, p),
    totalDiscount: rnd(totalDiscount, p),
    beforeVat: rnd(beforeVat, p),
    vatValue: rnd(vatValue, p),
    afterVat: rnd(afterVat, p),
    totalExceptVat: rnd(totalExceptVat, p),
    totalAmount: rnd(totalAmount, p),
  };
}

const homePromotionDiscountRaw = computed(() =>
  isDocumentForeignCurrencyValue() ? rnd(toNumber(promotionDiscountRaw.value) * documentExchangeRateValue(), itemAmountDecimal.value) : promotionDiscountRaw.value,
);

const totals = computed(() =>
  vatCalc(
    totalValueVat.value,
    totalValueNoVat.value,
    discountWord.value,
    toNumber(vatRate.value, 7),
    vatType.value,
    Number(posStore.erpOption?.discout_type ?? 0),
    Number(posStore.erpOption?.discount_vat_type ?? posStore.erpOption?._discount_vat_type ?? 0),
    homePromotionDiscountRaw.value,
    itemAmountDecimal.value,
  ),
);

const currencyTotals = computed(() =>
  vatCalc(
    documentTotalValueVat.value,
    documentTotalValueNoVat.value,
    discountWord.value,
    toNumber(vatRate.value, 7),
    vatType.value,
    Number(posStore.erpOption?.discout_type ?? 0),
    Number(posStore.erpOption?.discount_vat_type ?? posStore.erpOption?._discount_vat_type ?? 0),
    promotionDiscountRaw.value,
    itemAmountDecimal.value,
  ),
);

const promotionDiscountAmount = computed(() => rnd(Math.abs(toNumber(promotionDiscountRaw.value)), itemAmountDecimal.value));
const billDiscountAmount = computed(() => Math.max(0, rnd(totals.value.totalDiscount - promotionDiscountAmount.value, itemAmountDecimal.value)));
const totalIncomeOtherEntries = computed(() => paymentEntries.value.filter((entry) => entry.type === "income").reduce((sum, entry) => sum + toNumber(entry.amount), 0));
const totalExpenseOtherEntries = computed(() => paymentEntries.value.filter((entry) => entry.type === "expense").reduce((sum, entry) => sum + toNumber(entry.amount), 0));
const totalCreditChargeEntries = computed(() => rnd(paymentEntries.value.filter((entry) => entry.type === "credit").reduce((sum, entry) => sum + paymentEntryChargeAmount(entry), 0)));
const paymentNetAmount = computed(() => Math.max(0, rnd(totals.value.totalAmount + totalIncomeOtherEntries.value + totalCreditChargeEntries.value)));
const cashReceiveAmount = computed(() => rnd(toNumber(cashInputAmount.value)));
const nonCashPaid = computed(() =>
  rnd(
    paymentEntries.value
      .filter((entry) => {
        if (entry.type === "cash") return false;
        // charge ของเงินโอน (RD-012) คือเงินที่ลูกค้าโอนมาด้วย จึงนับเป็นยอดรับเงิน
        // (income อื่น เช่น ปัดเศษเงินสดจาก change rounding ไม่นับ — ให้เงินสดเป็นตัว cover)
        if (entry.type === "income") return !!entry.details?._transfer_charge_parent_id;
        return true;
      })
      .reduce((sum, entry) => sum + paymentEntryAmount(entry), 0),
  ),
);
const selectedCashCurrency = computed(() => cashCurrencyTabs.value.find((currency) => currency.code === normalizeCashCurrencyCode(cashCurrencyCode.value)) || cashCurrencyTabs.value[0]);
const cashConvertedAmount = computed(() => rnd(toNumber(cashCurrencyAmount.value) * toNumber(cashExchangeRate.value)));
const isHomeCashCurrency = computed(() => isHomeCashCurrencyCode(cashCurrencyCode.value));
const cashDraftAmountExcludingActive = computed(() => {
  const activeCode = normalizeCashCurrencyCode(cashCurrencyCode.value);
  return rnd(
    Object.values(cashCurrencyDrafts.value || {}).reduce((sum, entry) => {
      return normalizeCashCurrencyCode(entry?.currency_code) === activeCode ? sum : sum + toNumber(entry?.amount);
    }, 0),
  );
});
const activeCashDueHomeAmount = computed(() => Math.max(0, rnd(cashPaymentDue.value - cashDraftAmountExcludingActive.value)));
const activeCashDueAmount = computed(() => {
  if (isHomeCashCurrency.value) return activeCashDueHomeAmount.value;
  const rate = toNumber(cashExchangeRate.value);
  if (rate <= 0) return 0;
  const amount = activeCashDueHomeAmount.value / rate;
  return isKipCashCurrencyCode(cashCurrencyCode.value) ? rnd(amount, itemAmountDecimal.value) : roundUpCurrencyAmount(amount, 2);
});
const activeCashChangeAmount = computed(() => {
  const tender = toNumber(cashCurrencyAmount.value);
  return Math.max(0, rnd(tender - activeCashDueAmount.value));
});
const activeCashQuickAmounts = computed(() => (isHomeCashCurrency.value ? cashQuickAmounts : isKipCashCurrencyCode(cashCurrencyCode.value) ? cashForeignQuickAmounts : cashForeignSmallQuickAmounts));
const activeCashExchangeRateValid = computed(() => isHomeCashCurrency.value || toNumber(cashExchangeRate.value) > 0);

const isKipActiveCurrency = computed(() => isKipCashCurrencyCode(cashCurrencyCode.value));
const activeCashRoundingStep = computed(() => (sameCustomerDisplayCurrency(cashCurrencyCode.value, changeRoundingCurrencyCode) ? changeRoundingStep : isKipActiveCurrency.value ? 500 : 0));
const kipSuggestedAmount = computed(() => {
  if (!isKipActiveCurrency.value || !activeCashExchangeRateValid.value) return null;
  const multiplier = toNumber(String(selectedCashCurrency.value?.name_2 || "").replace(/,/g, ""), 0);
  if (multiplier <= 0) return null;
  const kipRaw = rnd(remainingPayment.value * multiplier, 0);
  if (kipRaw <= 0) return { kipRaw: 0, kipRounded: 0 };
  const step = activeCashRoundingStep.value || 500;
  const kipRounded = Math.ceil(kipRaw / step) * step;
  return { kipRaw, kipRounded };
});
function isChangeAutoIncomeEntry(entry) {
  return entry?.type === "income" && String(entry.details?.trans_number || "").trim() === changeRoundingIncomeCode && (entry.details?._change_auto || entry.details?._kip_auto);
}

function isTransferAutoRoundingEntry(entry) {
  return entry?.type === "income" && String(entry.details?.trans_number || "").trim() === changeRoundingIncomeCode && !!entry.details?._transfer_rounding_auto;
}

const appliedChangeAutoIncomeAmount = computed(() =>
  rnd(
    paymentEntries.value.filter(isChangeAutoIncomeEntry).reduce((s, e) => s + toNumber(e.amount), 0),
    changeRoundingPrecision,
  ),
);
const appliedTransferAutoRoundingAmount = computed(() =>
  rnd(
    paymentEntries.value.filter(isTransferAutoRoundingEntry).reduce((s, e) => s + toNumber(e.amount), 0),
    changeRoundingPrecision,
  ),
);
const changeRoundingCurrencyOption = computed(() => currencyOptionByCode(changeRoundingCurrencyCode, null));
const changeRoundingCurrencyName = computed(
  () => String(changeRoundingCurrencyOption.value?.name_1 || changeRoundingCurrencyOption.value?.name || changeRoundingCurrencyCode).trim() || changeRoundingCurrencyCode,
);
const changeRoundingCurrencyRate = computed(() => {
  if (isHomeCashCurrencyCode(changeRoundingCurrencyCode)) return 1;
  if (sameCustomerDisplayCurrency(cashCurrencyCode.value, changeRoundingCurrencyCode)) return toNumber(cashExchangeRate.value, paymentCurrencyRate(changeRoundingCurrencyOption.value, 0));
  return paymentCurrencyRate(changeRoundingCurrencyOption.value, 0);
});

function homeAmountToChangeCurrency(amount) {
  if (isHomeCashCurrencyCode(changeRoundingCurrencyCode)) return rnd(amount, changeRoundingPrecision);
  const rate = toNumber(changeRoundingCurrencyRate.value);
  return rate > 0 ? rnd(toNumber(amount) / rate, changeRoundingPrecision) : 0;
}

function changeCurrencyAmountToHome(amount) {
  if (isHomeCashCurrencyCode(changeRoundingCurrencyCode)) return rnd(amount, changeRoundingPrecision);
  const rate = toNumber(changeRoundingCurrencyRate.value);
  return rate > 0 ? rnd(toNumber(amount) * rate, changeRoundingPrecision) : 0;
}

function roundChangeCurrencyAmount(amount) {
  const raw = Math.max(0, toNumber(amount));
  const step = Math.max(0, toNumber(changeRoundingStep));
  if (raw <= 0 || step <= 0) return raw;
  let rounded = Math.floor(raw / step) * step;
  if (changeRoundingMode === "up") rounded = Math.ceil(raw / step) * step;
  if (changeRoundingMode === "nearest") rounded = Math.round(raw / step) * step;
  return Math.min(raw, rounded);
}

const changeRoundingBaseHomeChangeAmount = computed(() => {
  if (cashReceiveAmount.value <= 0) return 0;
  const incomeOtherBeforeChangeAuto = Math.max(0, rnd(totalIncomeOtherEntries.value - appliedChangeAutoIncomeAmount.value, changeRoundingPrecision));
  const paymentNetBeforeChangeAuto = Math.max(0, rnd(totals.value.totalAmount + incomeOtherBeforeChangeAuto + totalCreditChargeEntries.value));
  const totalDueBeforeChangeAuto = Math.max(0, rnd(paymentNetBeforeChangeAuto - toNumber(roundedAmount.value)));
  const cashDueBeforeChangeAuto = Math.max(0, rnd(totalDueBeforeChangeAuto - nonCashPaid.value));
  return Math.max(0, rnd(cashReceiveAmount.value - cashDueBeforeChangeAuto, changeRoundingPrecision));
});
const changeRoundingRawChangeAmount = computed(() => homeAmountToChangeCurrency(changeRoundingBaseHomeChangeAmount.value));
const changeRoundingRoundedChangeAmount = computed(() => roundChangeCurrencyAmount(changeRoundingRawChangeAmount.value));
const changeRoundingDiffCurrencyAmount = computed(() => Math.max(0, rnd(changeRoundingRawChangeAmount.value - changeRoundingRoundedChangeAmount.value, changeRoundingPrecision)));
const changeRoundingIncomeHomeAmount = computed(() => changeCurrencyAmountToHome(changeRoundingDiffCurrencyAmount.value));
const changeRoundingTargetIncomeAmount = computed(() => rnd(changeRoundingIncomeHomeAmount.value, changeRoundingPrecision));
const changeRoundingIncomeDeltaAmount = computed(() => rnd(changeRoundingTargetIncomeAmount.value - appliedChangeAutoIncomeAmount.value, changeRoundingPrecision));
const changeRoundingPendingIncomeAmount = computed(() => Math.max(0, changeRoundingIncomeDeltaAmount.value));
const changeRoundingAutoIncomeNeedsSync = computed(() => changeRoundingIncomeDeltaAmount.value !== 0 && (paymentChange.value > 0 || appliedChangeAutoIncomeAmount.value > 0));
const showChangeAutoRounding = computed(() => changeRoundingAutoIncomeNeedsSync.value);
const changeAutoRoundingLabel = computed(() => `${tl("ปัดเศษอัตโนมัติ", "Auto rounding", "ປັດເສດອັດຕະໂນມັດ")} (${formatCurrency(changeRoundingTargetIncomeAmount.value)})`);
const hasForeignTransferRoundingCandidate = computed(() => paymentEntries.value.some(isForeignTransferRoundingCandidate));
const transferRoundingBaseDueBeforeAuto = computed(() => {
  const incomeBeforeTransferRounding = Math.max(0, rnd(totalIncomeOtherEntries.value - appliedTransferAutoRoundingAmount.value, changeRoundingPrecision));
  const netBeforeTransferRounding = Math.max(0, rnd(totals.value.totalAmount + incomeBeforeTransferRounding + totalCreditChargeEntries.value, changeRoundingPrecision));
  return Math.max(0, rnd(netBeforeTransferRounding - toNumber(roundedAmount.value), changeRoundingPrecision));
});
const transferRoundingTargetIncomeAmount = computed(() => {
  if (!hasForeignTransferRoundingCandidate.value) return 0;
  return Math.max(0, rnd(nonCashPaid.value - transferRoundingBaseDueBeforeAuto.value, changeRoundingPrecision));
});
const transferRoundingIncomeDeltaAmount = computed(() => rnd(transferRoundingTargetIncomeAmount.value - appliedTransferAutoRoundingAmount.value, changeRoundingPrecision));
const transferAutoRoundingNeedsSync = computed(() => transferRoundingIncomeDeltaAmount.value !== 0 && (transferRoundingTargetIncomeAmount.value > 0 || appliedTransferAutoRoundingAmount.value > 0));
const showTransferAutoRounding = computed(() => transferAutoRoundingNeedsSync.value);
const transferAutoRoundingLabel = computed(() => `${tl("ปัดเศษเงินโอน", "Round transfer", "ປັດເສດເງິນໂອນ")} RD-002 (${formatCurrency(transferRoundingTargetIncomeAmount.value)})`);
const paymentChangeRawCurrencyAmount = computed(() => changeRoundingRawChangeAmount.value);
const paymentChangeRoundedCurrencyAmount = computed(() => changeRoundingRoundedChangeAmount.value);
const paymentChangeCurrencyHasRounding = computed(() => rnd(paymentChangeRawCurrencyAmount.value - paymentChangeRoundedCurrencyAmount.value, changeRoundingPrecision) !== 0);
const paymentChangeRoundedCurrencyName = computed(() => changeRoundingCurrencyName.value);
const cashExchangeRateEditKey = computed(() => `cash:${normalizeCashCurrencyCode(cashCurrencyCode.value)}`);
const cashPaidCurrencyRows = computed(() =>
  Object.values(cashCurrencyDrafts.value || {})
    .filter((entry) => toNumber(entry?.currency_amount) > 0)
    .map((entry) => {
      const code = normalizeCashCurrencyCode(entry.currency_code);
      const currency = currencyOptionByCode(code, null);
      const currencyName = code === "THB" ? t("sell.baht") : String(currency?.name_1 || entry.currency_name || code).trim() || code;
      const rate = toNumber(entry.exchange_rate, code === "THB" ? 1 : paymentCurrencyRate(currency, 0));
      return {
        code,
        label: currencyName,
        amount: toNumber(entry.currency_amount),
        homeAmount: toNumber(entry.amount),
        rate,
      };
    }),
);
const paidCurrencySummaryRows = computed(() => {
  const rows = [...cashPaidCurrencyRows.value];
  if (!rows.length && totalPaid.value > 0)
    rows.push({
      code: "THB",
      label: t("sell.baht"),
      amount: totalPaid.value,
      homeAmount: totalPaid.value,
      rate: 1,
    });
  return rows;
});
const transferCurrencyCode = computed(() => paymentCurrencyCode(transferCurrency.value));
const transferRate = computed(() => (transferCurrencyCode.value === "THB" ? 1 : toNumber(transferExchangeRate.value, paymentCurrencyRate(transferCurrency.value, 0))));
function roundTransferHomeAmount(value, currencyCode = transferCurrencyCode.value) {
  return rnd(value, isKipCashCurrencyCode(currencyCode) ? 0 : itemAmountDecimal.value);
}

const transferConvertedAmount = computed(() => roundTransferHomeAmount(toNumber(transferInputAmount.value) * transferRate.value));
const isKipTransferCurrency = computed(() => isKipCashCurrencyCode(transferCurrencyCode.value));
// KIP/LAK/KIPP/KIP2: ปัดเศษเงินลาว (ทวีคูณ 500 ปัดขึ้น) ที่ "ยอดรับเงินโอน" = base + charge
// (ไม่ใช่ปัดที่ base ก่อน charge) — เศษที่ปัดขึ้นถูกบวกรวมเป็น charge (รายได้ค่าธรรมเนียม)
const transferKipBaseRaw = computed(() => {
  // KIP, ยอดตัดบิล (ก่อน charge, ยังไม่ปัด) = input(THB) × name_2(KIP/THB)
  if (!isKipTransferCurrency.value) return 0;
  const multiplier = toNumber(String(transferCurrency.value?.name_2 || "").replace(/,/g, ""), 0);
  if (multiplier <= 0) return 0;
  return rnd(toNumber(transferInputAmount.value) * multiplier, 0);
});
const transferKipChargeRaw = computed(() => {
  // KIP, charge ตาม % ของ base
  const percent = Math.max(0, toNumber(transferChargePercent.value));
  if (percent <= 0 || transferKipBaseRaw.value <= 0) return 0;
  return rnd(transferKipBaseRaw.value * (percent / 100), 0);
});
const transferKipReceived = computed(() => {
  // KIP, ยอดรับเงินโอน = base + charge ตรง ๆ (ไม่ปัด 500 — เงินโอนอิเล็กทรอนิกส์รับยอดตรงได้)
  const raw = transferKipBaseRaw.value + transferKipChargeRaw.value;
  return raw > 0 ? raw : 0;
});
const transferBaseReceivedAmount = computed(() => (isKipTransferCurrency.value ? transferKipBaseRaw.value : transferConvertedAmount.value));
const transferKipRoundingDiff = computed(() => {
  if (!isKipTransferCurrency.value) return 0;
  const raw = transferKipBaseRaw.value + transferKipChargeRaw.value;
  return Math.max(0, rnd((transferKipReceived.value - raw) * transferRate.value));
});
const transferChargeCurrencyAmount = computed(() => {
  if (isKipTransferCurrency.value) return transferKipChargeRaw.value;
  const percent = Math.max(0, toNumber(transferChargePercent.value));
  if (percent <= 0) return 0;
  return roundTransferHomeAmount(transferConvertedAmount.value * (percent / 100));
});
const transferReceivedAmount = computed(() => (isKipTransferCurrency.value ? transferKipReceived.value : transferConvertedAmount.value));
const transferPercentChargeAmount = computed(() => {
  if (transferChargeCurrencyAmount.value <= 0) return 0;
  return isKipTransferCurrency.value ? roundTransferHomeAmount(transferChargeCurrencyAmount.value * transferRate.value) : transferChargeCurrencyAmount.value;
});
const transferChargeAmount = computed(() => roundTransferHomeAmount(transferPercentChargeAmount.value + transferKipRoundingDiff.value));
// ยอดแสดงผล "ยอดรับเงินโอน" (รวม charge) — แยกจากค่าที่บันทึก เพื่อไม่ให้กระทบ sum_amount_2 ของ non-KIP
const transferReceivedDisplayAmount = computed(() =>
  isKipTransferCurrency.value ? transferReceivedAmount.value : roundTransferHomeAmount(transferConvertedAmount.value + transferChargeAmount.value),
);
// ยอดรับเงินโอนคิดเป็นเงินหลัก (THB) — สำหรับสกุล KIP ที่แสดงยอดหลักเป็น KIP
const transferReceivedThbAmount = computed(() => (isKipTransferCurrency.value ? roundTransferHomeAmount(transferReceivedAmount.value * transferRate.value) : transferReceivedDisplayAmount.value));
// แสดงสรุปในสกุลของการโอน (ทุกสกุลที่ไม่ใช่ THB) — display only
const isForeignTransferCurrency = computed(() => {
  const code = transferCurrencyCode.value;
  return !!code && code !== "THB";
});
// Charge ในสกุลของการโอน (KIP = จำนวนเต็ม, สกุลอื่น = 2 ตำแหน่ง)
const transferChargeInCurrency = computed(() => {
  if (isKipTransferCurrency.value) return transferChargeCurrencyAmount.value;
  const percent = Math.max(0, toNumber(transferChargePercent.value));
  if (percent <= 0) return 0;
  return rnd(toNumber(transferInputAmount.value) * (percent / 100), 2);
});
// ยอดรับเงินโอนในสกุลของการโอน = base + charge (สกุลเดียวกัน)
const transferReceivedInCurrency = computed(() => {
  if (isKipTransferCurrency.value) return transferReceivedAmount.value;
  const base = toNumber(transferInputAmount.value);
  return base > 0 ? rnd(base + transferChargeInCurrency.value, 2) : 0;
});
function isForeignTransferRoundingCandidate(entry) {
  if (!entry || (entry.type !== "transfer" && entry.type !== "credit_transfer")) return false;
  const details = entry.details || {};
  const currencyCode = String(details.currency_code || "").trim();
  return toNumber(details.doc_type) === 1 && !!currencyCode && currencyCode !== "THB" && !isKipCashCurrencyCode(currencyCode);
}
// หน้ากากของช่อง "จำนวนรับชำระ": สกุล KIP กรอกเป็น KIP (base ก่อน charge) แต่เก็บภายในเป็น THB เท่าเดิม
// → สูตรคำนวณปลายน้ำทั้งหมดไม่เปลี่ยน ผลลัพธ์เหมือนเดิมทุกประการ
const transferInputKipMultiplier = computed(() => (isKipTransferCurrency.value ? toNumber(String(transferCurrency.value?.name_2 || "").replace(/,/g, ""), 0) : 1));
const transferInputDisplayAmount = computed({
  get() {
    return isKipTransferCurrency.value && transferInputKipMultiplier.value > 0
      ? rnd(toNumber(transferInputAmount.value) * transferInputKipMultiplier.value, 0) // THB→KIP
      : transferInputAmount.value;
  },
  set(value) {
    // KIP→THB: ห้ามปัด THB เป็น 2 ตำแหน่ง เพราะ 1 สตางค์ ≈ name_2 กีบ จะทำให้ KIP ที่กรอกเพี้ยน
    // (เก็บความละเอียดเต็ม เพื่อให้ transferKipBaseRaw = rnd(THB × name_2, 0) กลับมาเท่ากับที่กรอก)
    transferInputAmount.value = isKipTransferCurrency.value && transferInputKipMultiplier.value > 0 ? toNumber(value) / transferInputKipMultiplier.value : toNumber(value);
  },
});
// แปลงยอดเงินหลัก (THB) เป็นหน่วยที่เก็บใน transferInputAmount ตามสกุลที่เลือก (ใช้ตั้งค่า default)
// - KIP: เก็บเป็น THB (proxy แปลงเป็น KIP เอง), THB: เท่าเดิม
// - สกุลต่างประเทศอื่น: แปลง THB → สกุลนั้น = home / rate (rate = THB ต่อ 1 หน่วยสกุล)
function transferInputFromHome(homeAmount) {
  const amount = toNumber(homeAmount);
  if (isForeignTransferCurrency.value && !isKipTransferCurrency.value) {
    const rate = transferRate.value;
    return rate > 0 ? roundUpCurrencyAmount(amount / rate, 2) : amount;
  }
  return amount;
}
const transferAccountName = computed(() => passBookAccountName(transferPassBook.value));
const transferAccountNumber = computed(() => passBookAccountNumber(transferPassBook.value));
const creditCurrencyCode = computed(() => paymentCurrencyCode(creditCurrency.value));
const creditRate = computed(() => (creditCurrencyCode.value === "THB" ? 1 : toNumber(creditExchangeRate.value, paymentCurrencyRate(creditCurrency.value, 0))));
const creditConvertedAmount = computed(() => rnd(toNumber(creditInputAmount.value) * creditRate.value));
const selectedOtherCurrency = computed(() => otherCurrency.value || null);
const otherCurrencyCode = computed(() => paymentCurrencyCode(otherCurrency.value));
const otherCurrencyRate = computed(() => (otherCurrencyCode.value === "THB" ? 1 : toNumber(otherCurrencyExchangeRate.value, paymentCurrencyRate(selectedOtherCurrency.value, 0))));
const otherCurrencyConvertedAmount = computed(() => rnd(toNumber(otherCurrencyAmount.value) * otherCurrencyRate.value));
const selectedCouponAvailableAmount = computed(() => {
  if (!couponSelected.value) return 0;
  const couponNumber = String(couponSelected.value.number || "").trim();
  const availableAmount = toNumber(couponSelected.value.available_amount ?? couponSelected.value.usable_amount ?? couponSelected.value.balance_amount);
  const usedAmount = paymentEntries.value
    .filter((entry) => entry.type === "coupon" && String(entry.details?.trans_number || entry.label || "").trim() === couponNumber)
    .reduce((sum, entry) => sum + toNumber(entry.amount), 0);
  return Math.max(0, rnd(availableAmount - usedAmount));
});
const selectedCouponMaxAmount = computed(() => Math.max(0, Math.min(selectedCouponAvailableAmount.value, remainingPayment.value)));
const chequeCurrencyCode = computed(() => paymentCurrencyCode(chequeCurrency.value));
const chequeRate = computed(() => (chequeCurrencyCode.value === "THB" ? 1 : toNumber(chequeExchangeRate.value, paymentCurrencyRate(chequeCurrency.value, 0))));
const chequeConvertedAmount = computed(() => rnd(toNumber(chequeAmount.value) * chequeRate.value));
const selectedDocumentCurrency = computed(() => documentCurrency.value || null);
const masterHomeCurrencyCode = computed(() => String(paymentMasterOptions.value.home_currency || "THB").trim() || "THB");

function convertHomeAmountToCurrency(amount, targetCurrencyCode) {
  const targetCode = String(targetCurrencyCode || "")
    .trim()
    .toUpperCase();
  const homeCode = String(masterHomeCurrencyCode.value || "THB")
    .trim()
    .toUpperCase();
  const sourceAmount = toNumber(amount);
  if (!targetCode) return sourceAmount;
  if (targetCode === homeCode) return rnd(sourceAmount, itemAmountDecimal.value);

  const homeRate = toNumber(masterCurrencyRate(homeCode, 1), 1) || 1;
  const amountInThb = homeCode === "THB" ? sourceAmount : sourceAmount * homeRate;
  if (targetCode === "THB") return rnd(amountInThb, itemAmountDecimal.value);

  const targetRate = toNumber(masterCurrencyRate(targetCode, 0), 0);
  if (targetRate <= 0) return 0;
  if (!isKipCashCurrencyCode(targetCode)) return roundUpCurrencyAmount(amountInThb / targetRate, 2);
  return rnd(amountInThb / targetRate, itemAmountDecimal.value);
}

const summaryCurrencyCodes = computed(() => normalizeSummaryCurrencyCodes(paymentMasterOptions.value.summary_currency_codes));
const lastSummaryCurrencyCodes = ["LAK", "KIP"];
const summaryNetAmountRows = computed(() =>
  summaryCurrencyCodes.value
    .map((code) => {
      const currency = currencyTypes.value.find(
        (row) =>
          String(row.code || "")
            .trim()
            .toUpperCase() === code,
      );
      return {
        code,
        label: String(currency?.name_1 || currency?.name || code).trim() || code,
        name_2: String(currency?.name_2).trim() || "1",
        exchange_rate: String(currency?.exchange_rate_present) || "",
        amount: convertHomeAmountToCurrency(paymentNetAmount.value, code),
      };
    })
    .sort((a, b) => {
      const aLast = lastSummaryCurrencyCodes.includes(a.code) ? 1 : 0;
      const bLast = lastSummaryCurrencyCodes.includes(b.code) ? 1 : 0;
      return aLast - bLast;
    }),
);
const paymentExchangeRateRows = computed(() =>
  summaryCurrencyCodes.value
    .map((code) => {
      const currencyCode = normalizeCashCurrencyCode(code);
      const currency = currencyOptionByCode(currencyCode, null);
      return {
        code: currencyCode,
        name: String(currency?.name_1 || currency?.name || currencyCode).trim() || currencyCode,
        name_2: String(currency?.name_2).trim() || "1",
        rate: currencyCode === "THB" ? 1 : masterCurrencyRate(currencyCode, 0),
      };
    })
    .filter((row, index, list) => row.code && list.findIndex((item) => item.code === row.code) === index),
);

const documentCurrencyAmount = computed(() => currencyTotals.value.totalAmount);
const currencyTotalValue = computed(() => currencyTotals.value.totalValue);
const currencyBillDiscountAmount = computed(() => Math.max(0, rnd(currencyTotals.value.totalDiscount - currencyPromotionDiscountAmount.value, itemAmountDecimal.value)));
const currencyPromotionDiscountAmount = computed(() => rnd(Math.abs(toNumber(promotionDiscountRaw.value)), itemAmountDecimal.value));
const currencyBeforeVat = computed(() => currencyTotals.value.beforeVat);
const currencyVatValue = computed(() => currencyTotals.value.vatValue);
const currencyTotalAmount = computed(() => currencyTotals.value.totalAmount);
const totalDue = computed(() => Math.max(0, rnd(paymentNetAmount.value - toNumber(roundedAmount.value))));
const summaryTotalKipCurrency = computed(() => {
  for (const code of ["KIP", "LAK"]) {
    const currency = currencyTypes.value.find(
      (row) =>
        String(row.code || "")
          .trim()
          .toUpperCase() === code,
    );
    if (currency) return currency;
  }
  return null;
});
const summaryTotalKipDisplay = computed(() => {
  const currency = summaryTotalKipCurrency.value;
  const multiplier = toNumber(String(currency?.name_2 || "").replace(/,/g, ""), 0);
  if (!currency || multiplier <= 0) return null;
  return {
    amount: rnd(totalDue.value * multiplier, 0),
    name: String(currency?.name_1 || currency?.name || currency?.code || "").trim(),
  };
});
const cashPaymentDue = computed(() => Math.max(0, rnd(totalDue.value - nonCashPaid.value)));
const cashPaid = computed(() => (cashReceiveAmount.value > 0 ? Math.min(cashReceiveAmount.value, cashPaymentDue.value) : 0));
const totalPaid = computed(() => rnd(nonCashPaid.value + cashPaid.value));
const remainingPayment = computed(() => Math.max(0, rnd(totalDue.value - totalPaid.value)));
const nonCashOverPayment = computed(() => Math.max(0, rnd(nonCashPaid.value - totalDue.value)));
const paymentChange = computed(() => (cashReceiveAmount.value > 0 ? Math.max(0, rnd(cashReceiveAmount.value - cashPaymentDue.value)) : 0));
const cashChangeAllowed = computed(() => paymentChange.value <= 0 || cashReceiveAmount.value > 0);
const paymentLineCount = computed(() => paymentEntries.value.length + (cashPaid.value > 0 ? 1 : 0));
const cashDrawerAvailable = computed(() => typeof window !== "undefined" && !!window.bizsuitDevices?.openCashDrawer);
const customerDisplayAvailable = computed(() => typeof window !== "undefined" && !!window.bizsuitCustomerDisplay?.open);
const laoQrProviderOptions = computed(() => [
  { label: "Lao QR", value: "laoqr" },
  { label: "Onepay", value: "onepay" },
]);
const laoQrProviderLabel = computed(() => laoQrProviderOptions.value.find((option) => option.value === laoQrProvider.value)?.label || "Lao QR");
const activeLaoQrRequest = computed(() => laoQrPaymentRequests.value.find((request) => request.local_id === activeLaoQrRequestId.value) || null);
const laoQrPaymentRequestCount = computed(() => laoQrPaymentRequests.value.length);
const laoQrHistoryStatusOptions = computed(() => [
  { label: tl("ทั้งหมด", "All", "ທັງໝົດ"), value: "all" },
  { label: tl("รอชำระ", "Pending", "ລໍຖ້າຊຳລະ"), value: "pending" },
  { label: tl("สแกนแล้ว", "Scanned", "ສະແກນແລ້ວ"), value: "scanned" },
  { label: tl("ชำระสำเร็จ", "Paid", "ຊຳລະສຳເລັດ"), value: "paid" },
  { label: tl("ตรวจสอบไม่สำเร็จ", "Check failed", "ກວດສອບບໍ່ສຳເລັດ"), value: "check_failed" },
  { label: tl("สร้างไม่สำเร็จ", "Create failed", "ສ້າງບໍ່ສຳເລັດ"), value: "create_failed" },
  { label: tl("ไม่ทราบสถานะ", "Unknown", "ບໍ່ຮູ້ສະຖານະ"), value: "unknown" },
]);
const laoQrHistoryPosId = computed(() => String(posStore.posId || posStore.selectedPos?.pos_id || "").trim());
const laoQrHistoryPosLabel = computed(() =>
  [posStore.selectedPos?.code || posStore.selectedPos?.pos_code || laoQrHistoryPosId.value, posStore.selectedPos?.name_1 || posStore.selectedPos?.name].filter(Boolean).join(" / "),
);
const transferStaticQrOptions = [
  { code: "THB", name: "THB", image: bcelThbQrImage },
  { code: "CNY", name: "CNY", image: bcelCnyQrImage },
  { code: "USD", name: "USD", image: bcelUsdQrImage },
];
const selectedTransferStaticQr = computed(() => transferStaticQrOptions.find((option) => option.code === transferQrSelectedCode.value) || null);
const laoQrBaseDue = computed(() => remainingPayment.value);
const laoQrTransferPassBookCode = computed(() => {
  const config = laoQrConfig.value || {};
  const providerCode = laoQrProvider.value === "onepay" ? config.onepay_transfer_pass_book_code : config.laoqr_transfer_pass_book_code;
  return String(providerCode || config.transfer_pass_book_code || "").trim();
});
const laoQrTransferPassBook = computed(() => {
  const code = laoQrTransferPassBookCode.value;
  if (!code) return null;
  return passBooks.value.find((row) => String(row.book_code || row.pass_book_code || row.code || "").trim() === code) || null;
});
const laoQrCurrencyCode = computed(() => paymentCurrencyCode(laoQrCurrency.value) || String(laoQrTransferPassBook.value?.currency_code || "").trim());
const isLaoQrFrameProvider = computed(() => ["laoqr", "onepay"].includes(String(laoQrProvider.value || "").toLowerCase()));
const laoQrDialogMarkImage = computed(() => (String(laoQrProvider.value || "").toLowerCase() === "onepay" ? onePayMarkImage : laoQrMarkImage));
const laoQrCurrencyInMaster = computed(() => currencyTypes.value.some((row) => String(row.code || "").trim() === laoQrCurrencyCode.value));
const laoQrRate = computed(() => paymentCurrencyRate(laoQrCurrency.value, 0));
const laoQrPaymentThb = computed(() => (toNumber(laoQrRate.value) > 0 ? rnd(toNumber(laoQrAmountLak.value) * toNumber(laoQrRate.value)) : 0));
const laoQrRoundingAmount = computed(() => rnd(laoQrBaseDue.value - laoQrPaymentThb.value));
const laoQrCountdownRemainingSeconds = computed(() => (laoQrExpiresAt.value > 0 ? Math.max(0, Math.ceil((laoQrExpiresAt.value - laoQrCountdownNow.value) / 1000)) : 0));
const laoQrCountdownText = computed(() => formatLaoQrCountdown(laoQrCountdownRemainingSeconds.value));
const laoQrCountdownVisible = computed(() => !!laoQrQrImage.value && laoQrExpiresAt.value > 0 && ["pending", "scanned", "creating"].includes(laoQrStatus.value));
const laoQrUiLocked = computed(() => ["creating", "pending", "scanned", "paid", "saving", "save_failed", "saved"].includes(laoQrStatus.value) || laoQrSavingPaid.value);
const laoQrCloseLocked = computed(() => activePayType.value === "laoqr" && ["creating", "pending", "scanned", "paid", "saving", "save_failed"].includes(laoQrStatus.value));
const laoQrDialogCloseLocked = computed(() => ["creating", "pending", "scanned", "paid", "saving", "save_failed"].includes(laoQrStatus.value));
const laoQrCanCreate = computed(
  () =>
    !saving.value &&
    !successDocNo.value &&
    !isCreditSale.value &&
    laoQrConfig.value?.enabled &&
    !!laoQrTransferPassBook.value &&
    laoQrCurrencyInMaster.value &&
    toNumber(laoQrRate.value) > 0 &&
    toNumber(laoQrAmountLak.value) > 0 &&
    !laoQrUiLocked.value,
);
const selectedDepositApplyLimit = computed(() => depositPaymentLimit(depositDoc.value));
const selectedDepositMinAmount = computed(() => 0);
const selectedDepositMaxAmount = computed(() => Math.max(0, toNumber(depositDoc.value?.balance_amount)));
const selectedDepositAmountValid = computed(() => {
  if (!depositDoc.value) return false;
  const amount = toNumber(depositAmount.value);
  return amount > 0 && amount <= selectedDepositMaxAmount.value;
});
const selectedDepositMoneyApplyLimit = computed(() => depositPaymentLimit(depositMoneyDoc.value));
const selectedDepositMoneyMinAmount = computed(() => 0);
const selectedDepositMoneyMaxAmount = computed(() => Math.max(0, toNumber(depositMoneyDoc.value?.balance_amount)));
const depositMoneyPaymentEntries = computed(() => paymentEntries.value.filter((entry) => entry.type === "deposit_money"));
const selectedDepositMoneyDocNo = computed(() => String(depositMoneyDoc.value?.doc_no || "").trim());
const selectedDepositMoneyAlreadyAdded = computed(() => {
  const docNo = selectedDepositMoneyDocNo.value;
  if (!docNo) return false;
  return depositMoneyPaymentEntries.value.some((entry) => String(entry.details?.trans_number || entry.label || "").trim() === docNo);
});
const selectedDepositMoneyAmountValid = computed(() => {
  if (!depositMoneyDoc.value) return false;
  const amount = toNumber(depositMoneyAmount.value);
  return amount > 0 && amount <= selectedDepositMoneyMaxAmount.value && !selectedDepositMoneyAlreadyAdded.value;
});
const documentLocked = computed(() => saving.value || laoQrUiLocked.value || !!successDocNo.value || isViewOnly.value);
const activePrintDocNo = computed(() => successDocNo.value || oldDocNo.value || nextDocNo.value || "");
const customerDisplayRightAds = computed(() => normalizeCustomerDisplayAds(customerDisplayMedia.value.filter((media) => customerDisplayMediaZone(media) === "right")));
const customerDisplaySummaryAds = computed(() => normalizeCustomerDisplayAds(customerDisplayMedia.value.filter((media) => customerDisplayMediaZone(media) === "summary")));
const customerDisplaySummarySecondaryAds = computed(() => normalizeCustomerDisplayAds(customerDisplayMedia.value.filter((media) => customerDisplayMediaZone(media) === "summary_secondary")));
const customerDisplaySummaryLayout = computed(() => (posStore.deviceConfig?.customer_display_summary_layout === "single" ? "single" : "split"));
const customerDisplayCurrency = computed(() => {
  const code = String(posStore.deviceConfig?.customer_display_currency_code || DEFAULT_CUSTOMER_DISPLAY_CURRENCY_CODE)
    .trim()
    .toUpperCase();
  const normalizedCode = code || DEFAULT_CUSTOMER_DISPLAY_CURRENCY_CODE;
  const currency = currencyOptionByCode(normalizedCode, {
    code: normalizedCode,
    name_1: normalizedCode,
    name_2: "1",
  });
  const summaryCodes = summaryCurrencyCodes.value.length ? summaryCurrencyCodes.value : [DEFAULT_CUSTOMER_DISPLAY_CURRENCY_CODE];
  const allowedCodes = summaryCodes.includes(DEFAULT_CUSTOMER_DISPLAY_CURRENCY_CODE) ? summaryCodes : [DEFAULT_CUSTOMER_DISPLAY_CURRENCY_CODE, ...summaryCodes];
  const selectedCode = allowedCodes.includes(normalizedCode) ? normalizedCode : allowedCodes[0] || DEFAULT_CUSTOMER_DISPLAY_CURRENCY_CODE;
  const selectedCurrency =
    selectedCode === normalizedCode
      ? currency
      : currencyOptionByCode(selectedCode, {
          code: selectedCode,
          name_1: selectedCode,
          name_2: "1",
        });
  const rate = toNumber(String(selectedCurrency?.name_2 || "1").replace(/,/g, ""), 1);
  return {
    code: selectedCode,
    label: String(selectedCurrency?.name_1 || selectedCurrency?.name || selectedCode).trim() || selectedCode,
    name_2: String(selectedCurrency?.name_2 || rate || "1").trim() || "1",
    rate: rate > 0 ? rate : 1,
    decimals: selectedCode === "THB" ? 2 : 0,
  };
});
function sameCustomerDisplayCurrency(sourceCode, targetCode) {
  const source = normalizeCashCurrencyCode(sourceCode);
  const target = normalizeCashCurrencyCode(targetCode);
  return source === target || (isKipCashCurrencyCode(source) && isKipCashCurrencyCode(target));
}

function customerDisplayProjectedAmount(amount) {
  const currency = customerDisplayCurrency.value;
  const code = normalizeCashCurrencyCode(currency.code);
  const decimals = Math.max(0, toNumber(currency.decimals, code === "THB" ? 2 : 0));
  if (code === "THB") return rnd(amount, decimals);
  return rnd(toNumber(amount) * toNumber(currency.rate, 1), decimals);
}

function roundCustomerDisplayPaymentDue(amount, currency = customerDisplayCurrency.value) {
  const code = normalizeCashCurrencyCode(currency?.code);
  const decimals = Math.max(0, toNumber(currency?.decimals, code === "THB" ? 2 : 0));
  const value = Math.max(0, toNumber(amount));
  if (!isKipCashCurrencyCode(code)) return rnd(value, decimals);
  const step = Math.max(1, toNumber(changeRoundingStep, 500));
  return Math.ceil(value / step) * step;
}

function customerDisplayProjectedPaymentDue(amount) {
  return roundCustomerDisplayPaymentDue(customerDisplayProjectedAmount(amount));
}

function lockCustomerDisplayPaymentDue() {
  customerDisplayPaymentDueLock.value = {
    currencyCode: customerDisplayCurrency.value.code,
    amount: customerDisplayProjectedPaymentDue(totalDue.value),
  };
}

function unlockCustomerDisplayPaymentDue() {
  customerDisplayPaymentDueLock.value = null;
}

const customerDisplayNetAmount = computed(() => {
  const lock = customerDisplayPaymentDueLock.value;
  if (lock && sameCustomerDisplayCurrency(lock.currencyCode, customerDisplayCurrency.value.code)) {
    return roundCustomerDisplayPaymentDue(lock.amount);
  }
  return customerDisplayProjectedPaymentDue(totalDue.value);
});

function cashRowCustomerDisplayAmount(row) {
  const currency = customerDisplayCurrency.value;
  const code = normalizeCashCurrencyCode(currency.code);
  const decimals = Math.max(0, toNumber(currency.decimals, code === "THB" ? 2 : 0));
  if (sameCustomerDisplayCurrency(row?.code, code)) return rnd(row?.amount, decimals);
  return customerDisplayProjectedAmount(row?.homeAmount);
}

const customerDisplayPaidAmount = computed(() => {
  const cashRows = cashPaidCurrencyRows.value;
  if (!cashRows.length) return customerDisplayProjectedAmount(totalPaid.value);
  const cashAmount = cashRows.reduce((sum, row) => sum + cashRowCustomerDisplayAmount(row), 0);
  return rnd(cashAmount + customerDisplayProjectedAmount(nonCashPaid.value), customerDisplayCurrency.value.decimals);
});
const customerDisplayChangeAmount = computed(() => {
  if (sameCustomerDisplayCurrency(customerDisplayCurrency.value.code, changeRoundingCurrencyCode) && (changeRoundingIncomeHomeAmount.value > 0 || appliedChangeAutoIncomeAmount.value > 0))
    return rnd(paymentChangeRoundedCurrencyAmount.value, customerDisplayCurrency.value.decimals);
  return customerDisplayProjectedAmount(paymentChange.value);
});
const customerDisplayPayment = computed(() => ({
  currencyCode: customerDisplayCurrency.value.code,
  decimals: customerDisplayCurrency.value.decimals,
  totalValue: customerDisplayProjectedAmount(totals.value.totalValue),
  discount: customerDisplayProjectedAmount(totals.value.totalDiscount),
  netAmount: customerDisplayNetAmount.value,
  paid: customerDisplayPaidAmount.value,
  remaining: customerDisplayProjectedAmount(remainingPayment.value),
  change: customerDisplayChangeAmount.value,
  rounded: customerDisplayProjectedAmount(roundedAmount.value),
}));
const showPaymentSuccessDisplayCurrency = computed(() => normalizeCashCurrencyCode(customerDisplayPayment.value.currencyCode) !== "THB");

function formatCustomerDisplayPaymentAmount(key) {
  const payment = customerDisplayPayment.value || {};
  const code = payment.currencyCode || customerDisplayCurrency.value.code || "";
  const decimals = Math.max(0, toNumber(payment.decimals, customerDisplayCurrency.value.decimals));
  const amount = toNumber(payment[key]);
  const text =
    decimals === 0
      ? new Intl.NumberFormat("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount)
      : new Intl.NumberFormat("th-TH", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(amount);
  return `${text} ${code}`.trim();
}

function buildPaymentSuccessSlipDisplayParams() {
  if (!showPaymentSuccessDisplayCurrency.value) return {};
  return {
    display_net_lak_text: formatCustomerDisplayPaymentAmount("netAmount"),
    display_paid_lak_text: formatCustomerDisplayPaymentAmount("paid"),
    display_change_lak_text: formatCustomerDisplayPaymentAmount("change"),
  };
}

const customerDisplayLanguage = computed(() => {
  const lang = String(locale.value || "th")
    .trim()
    .toLowerCase();
  if (lang.startsWith("en")) return "en";
  if (lang.startsWith("lo")) return "lo";
  return "th";
});
const customerDisplayState = computed(() => buildCustomerDisplayState());
const customerCreditLimit = computed(() => toNumber(customerCredit.value?.credit_money));
const customerCreditBalance = computed(() => toNumber(customerCredit.value?.total_balance));
const customerCreditAfterSale = computed(() => rnd(customerCreditBalance.value + (isCreditSale.value ? totals.value.totalAmount : 0)));
const customerCreditExceeded = computed(() => isCreditSale.value && customerCreditLimit.value > 0 && customerCreditAfterSale.value > customerCreditLimit.value);
const customerCreditClosed = computed(() => isCreditSale.value && toNumber(customerCredit.value?.credit_status) !== 0);
const showDocumentCurrency = computed(() => toNumber(paymentMasterOptions.value.multi_currency) === 1);
const showShipmentDates = computed(() => toNumber(sendType.value) !== 0);

function customerDisplayMediaType(url = "") {
  return /\.(mp4|webm|ogg|mov)(?:\?|#|$)/i.test(String(url || "")) ? "video" : "image";
}

function customerDisplayMediaZone(media = {}) {
  const zone = String(media.display_zone || media.displayZone || media.zone || "right")
    .trim()
    .toLowerCase();
  if (zone === "summary" || zone === "summary_secondary") return zone;
  return "right";
}

function normalizeCustomerDisplayAds(value) {
  let list = value;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return [];
    try {
      list = JSON.parse(text);
      list = Array.isArray(list) ? list : Array.isArray(list?.ads) ? list.ads : [];
    } catch {
      list = text
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((entry, index) => {
      const media = typeof entry === "string" ? { url: entry } : entry || {};
      const url = String(media.url || media.src || "").trim();
      if (!url) return null;
      return {
        id: media.id || `${url}-${index}`,
        url,
        type: media.type || customerDisplayMediaType(url),
        title: media.title || "",
        sound_enabled: media.sound_enabled === true || media.soundEnabled === true,
      };
    })
    .filter(Boolean);
}

async function loadCustomerDisplayMediaForSale() {
  try {
    customerDisplayMedia.value = await getCustomerDisplayMedia({ enabled: true });
  } catch {
    customerDisplayMedia.value = [];
  }
}

function buildCustomerDisplayState() {
  const qrActiveStatuses = ["creating", "pending", "scanned", "paid", "saving", "save_failed"];
  const qrActive = !!laoQrQrImage.value && qrActiveStatuses.includes(laoQrStatus.value);
  const transferQr = selectedTransferStaticQr.value;
  const posParts = [posStore.selectedPos?.code || posStore.posId, posStore.selectedPos?.name_1 || posStore.selectedPos?.name].filter(Boolean);
  const displayItems = validDisplayRows.value;
  const paidState = !!successDocNo.value;
  return {
    mode: paidState ? "thankyou" : qrActive || transferQr ? "qr" : displayItems.length ? "sale" : "idle",
    pos: posParts.join(" "),
    customer: customerDisplay.value,
    cashier: customerDisplayCashier.value,
    docNo: activePrintDocNo.value,
    ads: customerDisplayRightAds.value,
    summaryAds: customerDisplaySummaryAds.value,
    summarySecondaryAds: customerDisplaySummarySecondaryAds.value,
    summaryPanelLayout: customerDisplaySummaryLayout.value,
    displayCurrency: customerDisplayCurrency.value,
    displayLanguage: customerDisplayLanguage.value,
    paymentDisplay: customerDisplayPayment.value,
    items: displayItems.map((line, index) => ({
      id: line.id || `${line.item_code || ""}-${line.unit_code || ""}-${index}`,
      code: line.barcode || line.item_code || "",
      itemCode: line.item_code || "",
      name: line.item_name || line.name_1 || line.name || "",
      unit: line.unit_code || "",
      qty: toNumber(line.qty),
      price: toNumber(line.price),
      discount: String(line.discount || ""),
      amount: lineSumAmount(line),
      remark: line.remark || "",
    })),
    totals: {
      totalValue: totals.value.totalValue,
      discount: totals.value.totalDiscount,
      netAmount: totalDue.value,
      paid: totalPaid.value,
      remaining: remainingPayment.value,
      change: paymentChange.value,
      rounded: roundedAmount.value,
    },
    paidSummary: paidState
      ? {
          docNo: activePrintDocNo.value,
          totalValue: totals.value.totalValue,
          netAmount: totalDue.value,
          paid: totalPaid.value,
          change: paymentChange.value,
          paymentDisplay: customerDisplayPayment.value,
        }
      : null,
    qr: transferQr
      ? {
          kind: "transfer_static",
          provider: "bcel",
          providerLabel: transferQr.name,
          title: transferQr.name,
          image: transferQr.image,
          currencyCode: transferQr.code,
          status: "ready",
          message: tl("กรุณาสแกน QR Code", "Please scan the QR code", "ກະລຸນາສະແກນ QR Code"),
        }
      : qrActive
        ? {
            provider: laoQrProvider.value,
            image: laoQrQrImage.value,
            amountKip: Math.round(toNumber(laoQrAmountLak.value)),
            amountThb: laoQrPaymentThb.value,
            currencyCode: laoQrCurrencyCode.value || "KIP",
            status: laoQrStatus.value,
            message: laoQrMessage.value,
            invoiceId: laoQrInvoiceId.value,
            uuid: laoQrUuid.value,
            expiresAt: laoQrExpiresAt.value || null,
            remainingSeconds: laoQrCountdownRemainingSeconds.value,
            countdownText: laoQrCountdownText.value,
            qrMark: "lao_qr",
          }
        : null,
  };
}

function buildCustomerDisplayIdleState() {
  const posParts = [posStore.selectedPos?.code || posStore.posId, posStore.selectedPos?.name_1 || posStore.selectedPos?.name].filter(Boolean);
  return {
    mode: "idle",
    pos: posParts.join(" "),
    customer: "",
    cashier: customerDisplayCashier.value,
    docNo: "",
    ads: customerDisplayRightAds.value,
    summaryAds: customerDisplaySummaryAds.value,
    summarySecondaryAds: customerDisplaySummarySecondaryAds.value,
    summaryPanelLayout: customerDisplaySummaryLayout.value,
    displayCurrency: customerDisplayCurrency.value,
    displayLanguage: customerDisplayLanguage.value,
    items: [],
    totals: {},
    paidSummary: null,
    qr: null,
  };
}

function syncCustomerDisplayState() {
  if (!customerDisplayAvailable.value || !window.bizsuitCustomerDisplay?.update) return;
  if (customerDisplaySyncTimer) clearTimeout(customerDisplaySyncTimer);
  customerDisplaySyncTimer = setTimeout(() => {
    customerDisplaySyncTimer = null;
    window.bizsuitCustomerDisplay?.update?.(customerDisplayState.value).catch(() => {});
  }, 250);
}

function syncCustomerDisplayIdleState() {
  if (!customerDisplayAvailable.value || !window.bizsuitCustomerDisplay?.update) return;
  if (customerDisplaySyncTimer) {
    clearTimeout(customerDisplaySyncTimer);
    customerDisplaySyncTimer = null;
  }
  window.bizsuitCustomerDisplay.update(buildCustomerDisplayIdleState()).catch(() => {});
}

async function openCustomerDisplay({ silent = false } = {}) {
  if (!customerDisplayAvailable.value || customerDisplayOpening.value) return;
  customerDisplayOpening.value = true;
  try {
    const openResult = await window.bizsuitCustomerDisplay.open();
    if (!openResult?.alreadyOpen) {
      await window.bizsuitCustomerDisplay.update(customerDisplayState.value);
    }
    if (!silent) {
      toast.add({
        severity: "success",
        summary: tl("จอลูกค้า", "Customer display", "ຈໍລູກຄ້າ"),
        detail: tl("เปิดจอลูกค้าแล้ว", "Customer display opened", "ເປີດຈໍລູກຄ້າແລ້ວ"),
        life: 1600,
      });
    }
  } catch (error) {
    toast.add({
      severity: "warn",
      summary: tl("จอลูกค้า", "Customer display", "ຈໍລູກຄ້າ"),
      detail: error.message || tl("เปิดจอลูกค้าไม่สำเร็จ", "Unable to open customer display", "ເປີດຈໍລູກຄ້າບໍ່ສຳເລັດ"),
      life: 3000,
    });
  } finally {
    customerDisplayOpening.value = false;
  }
}

const documentExchangeRateDisabled = computed(() => documentLocked.value || !isDocumentForeignCurrencyValue());
const cashExchangeRateDisabled = computed(() => documentLocked.value || !cashCurrencyCode.value || isHomeCashCurrency.value);
const transferExchangeRateDisabled = computed(() => documentLocked.value || !transferCurrencyCode.value || transferCurrencyCode.value === "THB");
const creditExchangeRateDisabled = computed(() => documentLocked.value || !creditCurrencyCode.value || creditCurrencyCode.value === "THB");
const chequeExchangeRateDisabled = computed(() => documentLocked.value || !chequeCurrencyCode.value || chequeCurrencyCode.value === "THB");
const otherCurrencyExchangeRateDisabled = computed(() => documentLocked.value || !otherCurrencyCode.value || otherCurrencyCode.value === "THB");
const selectedWhtHeader = computed(() => whtHeaders.value.find((row) => row.id === selectedWhtHeaderId.value) || null);
const selectedWhtDetails = computed(() => selectedWhtHeader.value?.details || []);
const vatRowsWithTotals = computed(() =>
  vatRows.value.map((row, index) => {
    const vatDate = row.vat_date || taxDocDate.value || docDate.value;
    const vatDateObj = vatDate ? new Date(vatDate) : new Date(docDate.value);
    const year = Number.isFinite(vatDateObj.getTime()) ? vatDateObj.getFullYear() + 543 : new Date(docDate.value).getFullYear() + 543;
    const period = Number.isFinite(vatDateObj.getTime()) ? vatDateObj.getMonth() + 1 : new Date(docDate.value).getMonth() + 1;
    const rowBaseAmount = toNumber(row.base_caltax_amount);
    const rowVatAmount = toNumber(row.amount);
    const rowExceptAmount = toNumber(row.except_tax_amount);
    const shouldUseDocumentVat =
      index === 0 && toNumber(row.manual_add) === 0 && rowBaseAmount === 0 && rowVatAmount === 0 && rowExceptAmount === 0 && totals.value.beforeVat > 0 && totals.value.vatAmount > 0;
    const baseAmount = shouldUseDocumentVat ? totals.value.beforeVat : rowBaseAmount;
    const rate = toNumber(row.tax_rate, toNumber(vatRate.value, 7));
    const amount = shouldUseDocumentVat ? totals.value.vatAmount : vatAutoCalc.value ? rnd((baseAmount * rate) / 100) : rowVatAmount;
    return {
      ...row,
      line_number: index,
      vat_date: vatDate,
      vat_effective_period: row.vat_effective_period ?? period,
      vat_effective_year: row.vat_effective_year ?? year,
      base_caltax_amount: baseAmount,
      tax_rate: rate,
      amount,
      except_tax_amount: shouldUseDocumentVat ? totals.value.totalExceptVat : rowExceptAmount,
      vat_type: toNumber(row.vat_type),
      is_add: toNumber(row.is_add),
      branch_type: toNumber(row.branch_type),
    };
  }),
);
const vatTotalBase = computed(() => rnd(vatRowsWithTotals.value.reduce((sum, row) => sum + toNumber(row.base_caltax_amount), 0)));
const vatTotalAmount = computed(() => rnd(vatRowsWithTotals.value.reduce((sum, row) => sum + toNumber(row.amount), 0)));
const vatTotalExceptAmount = computed(() => rnd(vatRowsWithTotals.value.reduce((sum, row) => sum + toNumber(row.except_tax_amount), 0)));
const whtTotalAmount = computed(() =>
  rnd(whtHeaders.value.reduce((sum, header) => sum + (Array.isArray(header.details) ? header.details.reduce((detailSum, detail) => detailSum + toNumber(detail.amount), 0) : 0), 0)),
);
const whtTotalTax = computed(() =>
  rnd(whtHeaders.value.reduce((sum, header) => sum + (Array.isArray(header.details) ? header.details.reduce((detailSum, detail) => detailSum + toNumber(detail.tax_value), 0) : 0), 0)),
);
const selectedWhtAmount = computed(() => rnd(selectedWhtDetails.value.reduce((sum, row) => sum + toNumber(row.amount), 0)));
const selectedWhtTax = computed(() => rnd(selectedWhtDetails.value.reduce((sum, row) => sum + toNumber(row.tax_value), 0)));
const whtHeaderTaxDocNo = computed({
  get: () => selectedWhtHeader.value?.tax_doc_no || "",
  set: (value) => {
    if (!selectedWhtHeader.value) return;
    selectedWhtHeader.value.tax_doc_no = String(value || "").trim();
  },
});
const whtHeaderDueDate = computed({
  get: () => selectedWhtHeader.value?.due_date || docDate.value,
  set: (value) => {
    if (!selectedWhtHeader.value) return;
    selectedWhtHeader.value.due_date = value || docDate.value;
  },
});
const whtHeaderCustCode = computed({
  get: () => selectedWhtHeader.value?.cust_code || "",
  set: (value) => {
    if (!selectedWhtHeader.value) return;
    selectedWhtHeader.value.cust_code = String(value || "").trim();
  },
});
const whtHeaderCustName = computed({
  get: () => selectedWhtHeader.value?.cust_name || "",
  set: (value) => {
    if (!selectedWhtHeader.value) return;
    selectedWhtHeader.value.cust_name = String(value || "").trim();
  },
});
const whtHeaderCustAddress = computed({
  get: () => selectedWhtHeader.value?.cust_address || "",
  set: (value) => {
    if (!selectedWhtHeader.value) return;
    selectedWhtHeader.value.cust_address = String(value || "").trim();
  },
});
const whtHeaderCustTaxType = computed({
  get: () => toNumber(selectedWhtHeader.value?.cust_tax_type),
  set: (value) => {
    if (!selectedWhtHeader.value) return;
    selectedWhtHeader.value.cust_tax_type = toNumber(value);
  },
});
const whtHeaderTaxNumber = computed({
  get: () => selectedWhtHeader.value?.tax_number || "",
  set: (value) => {
    if (!selectedWhtHeader.value) return;
    selectedWhtHeader.value.tax_number = String(value || "").trim();
  },
});
const whtHeaderCardNumber = computed({
  get: () => selectedWhtHeader.value?.card_number || "",
  set: (value) => {
    if (!selectedWhtHeader.value) return;
    selectedWhtHeader.value.card_number = String(value || "").trim();
  },
});
const manualGlDebitTotal = computed(() => rnd(manualGlRows.value.reduce((sum, row) => sum + toNumber(row.debit), 0)));
const manualGlCreditTotal = computed(() => rnd(manualGlRows.value.reduce((sum, row) => sum + toNumber(row.credit), 0)));
const manualGlBalanced = computed(() => manualGlRows.value.length === 0 || manualGlDebitTotal.value === manualGlCreditTotal.value);
const glManualMode = computed(() => toNumber(glTransDirect.value, 1) === 1);

function resolveInventoryGlMode(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (!raw) return "unknown";
  if (raw.includes("perpetual") || raw === "1" || raw === "true" || raw === "t") return "perpetual";
  if (raw.includes("periodic") || raw === "0" || raw === "false" || raw === "f") return "periodic";
  return "unknown";
}

const systemInventoryGlMode = computed(() => resolveInventoryGlMode(paymentMasterOptions.value.inventory_gl_post));
const inventoryGlModeHint = computed(() => {
  if (inventoryGlPostMode.value === "perpetual") return "Perpetual";
  if (inventoryGlPostMode.value === "periodic") return "Periodic";
  if (systemInventoryGlMode.value === "perpetual") return "Perpetual";
  if (systemInventoryGlMode.value === "periodic") return "Periodic";
  return t("sell.notSpecified");
});
const glPeriodNumber = computed(() => {
  const date = new Date(docDate.value || "");
  if (!Number.isFinite(date.getTime())) return 0;
  return date.getMonth() + 1;
});
const glAccountYear = computed(() => {
  const date = new Date(docDate.value || "");
  if (!Number.isFinite(date.getTime())) return 0;
  return date.getFullYear() + 543;
});
const glBookCodeOptions = computed(() =>
  (passBooks.value || [])
    .map((row) => ({
      label: row.label || `${row.book_code || row.pass_book_code || row.code || ""}`.trim(),
      value: row.book_code || row.pass_book_code || row.code || "",
    }))
    .filter((row) => row.value),
);
const creditChargePreview = computed(() => {
  if (toNumber(paymentMasterOptions.value.input_credit_card_charge) === 1) return 0;
  return calcPaymentCharge(creditInputAmount.value, creditType.value?.charge_rate_word ?? creditType.value?.charge_rate);
});
const creditTotalPreview = computed(() => rnd(toNumber(creditInputAmount.value) + creditChargePreview.value));
const creditConvertedCharge = computed(() => rnd(creditChargePreview.value * creditRate.value));
const creditConvertedTotal = computed(() => rnd(creditTotalPreview.value * creditRate.value));

function paymentTypeAmount(type, includeCharge = false) {
  return rnd(
    paymentEntries.value
      .filter((entry) => entry.type === type)
      .reduce((sum, entry) => {
        if (includeCharge) return sum + paymentEntryAmount(entry);
        const details = entry.details || {};
        const docType = toNumber(details.doc_type);
        if (type === "credit") return sum + rnd(paymentEntryAmount(entry) - paymentEntryChargeAmount(entry));
        if ([1, 2, 4].includes(docType) && String(details.currency_code || "").trim() && String(details.currency_code || "").trim() !== "THB") {
          return sum + paymentEntryAmount(entry);
        }
        if (docType === 19) return sum + toNumber(details.sum_amount, entry.amount);
        return sum + toNumber(entry.amount);
      }, 0),
  );
}

function paymentMethodCurrencyCode(tab) {
  if (tab?.value === "cash") return "THB";
  if (isCashCurrencyPayType(tab?.value)) return cashCurrencyCodeFromPayType(tab.value);
  return "";
}

function paymentMethodTitle(tab) {
  if (tab?.value === "cash") return t("payment.cash");
  if (isCashCurrencyPayType(tab?.value)) return t("payment.cash");
  if (tab?.value === "laoqr") return "QR Code";
  return tab?.label || "";
}

function paymentMethodSubtitle(tab) {
  if (tab?.value === "cash") {
    return cashCurrencyTabs.value.map((c) => c.label).join(" / ");
  }
  const currencyCode = paymentMethodCurrencyCode(tab);
  if (currencyCode) {
    const currency = currencyOptionByCode(currencyCode, null);
    return currencyCode === "THB" ? t("sell.baht") : String(currency?.name_1 || currency?.name || tab?.helper || currencyCode).trim() || currencyCode;
  }
  const subtitles = {
    laoqr: tl("Lao QR", "Lao QR", "Lao QR"),
    transfer: tl("โอนเงิน", "Bank transfer", "ໂອນເງິນ"),
    credit_transfer: tl("บัตรเครดิต", "Credit card", "ບັດເຄຣດິດ"),
    credit: tl("บัตรเครดิต", "Credit card", "ບັດເຄຣດິດ"),
    cheque: tl("เช็ค", "Cheque", "ເຊັກ"),
    petty: tl("เงินสดย่อย", "Petty cash", "ເງິນສົດຍ່ອຍ"),
    deposit: tl("เงินล่วงหน้า", "Advance", "ເງິນລ່ວງໜ້າ"),
    deposit_money: tl("เงินมัดจำ", "Deposit", "ເງິນມັດຈຳ"),
    coupon: tl("คูปอง", "Coupon", "ຄູປອງ"),
    income: tl("รายได้อื่น", "Other income", "ລາຍຮັບອື່ນ"),
    expense: tl("ค่าใช้จ่ายอื่น", "Other expense", "ຄ່າໃຊ້ຈ່າຍອື່ນ"),
    currency: tl("สกุลเงินอื่น", "Other currency", "ສະກຸນເງິນອື່ນ"),
    wallet: "E-Wallet",
  };
  return subtitles[tab?.value] || "";
}

function paymentMethodAmount(tab) {
  if (tab?.value === "cash") return cashInputAmount.value;
  if (isCashCurrencyPayType(tab?.value)) {
    const draft = cashCurrencyDrafts.value?.[cashCurrencyCodeFromPayType(tab.value)];
    return toNumber(draft?.amount);
  }
  if (tab?.value === "credit") return paymentTypeAmount("credit", true);
  if (tab?.value === "laoqr") return 0;
  return paymentTypeAmount(tab?.value);
}

function depositPaymentLimit(doc = depositDoc.value) {
  if (!doc) return 0;
  const balanceAmount = toNumber(doc.balance_amount);
  return Math.max(0, rnd(balanceAmount));
}

const paymentBreakdownRows = computed(() =>
  [
    { key: "cash", label: t("payment.cash"), amount: cashPaid.value },
    { key: "transfer", label: t("sell.transfer"), amount: paymentTypeAmount("transfer") },
    {
      key: "credit_transfer",
      label: t("sell.creditCard"),
      amount: paymentTypeAmount("credit_transfer"),
    },
    // { key: "cheque", label: t("sell.cheque"), amount: paymentTypeAmount("cheque") },
    // {
    //   key: "credit",
    //   label: t("sell.creditCard"),
    //   amount: paymentTypeAmount("credit", true),
    // },
    { key: "petty", label: t("payment.pettyCash"), amount: paymentTypeAmount("petty") },
    { key: "deposit", label: t("sell.deposit"), amount: paymentTypeAmount("deposit") },
    { key: "deposit_money", label: tl("เงินมัดจำ", "Deposit", "ເງິນມັດຈຳ"), amount: paymentTypeAmount("deposit_money") },
    { key: "coupon", label: t("sell.coupon"), amount: paymentTypeAmount("coupon") },
    {
      key: "expense",
      label: t("sell.otherExpense"),
      amount: paymentTypeAmount("expense"),
    },
    {
      key: "currency",
      label: t("sell.otherCurrency"),
      amount: paymentTypeAmount("currency"),
    },
    { key: "wallet", label: "Wallet", amount: paymentTypeAmount("wallet") },
  ].filter((row) => row.amount !== 0),
);

const paymentDetailRows = computed(() => [
  { label: t("sell.summaryBaht"), amount: totals.value.totalAmount },
  {
    label: t("sell.otherIncome"),
    amount: totalIncomeOtherEntries.value,
    muted: totalIncomeOtherEntries.value === 0,
  },
  {
    label: `Charge ${t("sell.creditCard")}`,
    amount: totalCreditChargeEntries.value,
    muted: totalCreditChargeEntries.value === 0,
  },
  {
    label: t("sell.rounded"),
    amount: toNumber(roundedAmount.value) * -1,
    muted: toNumber(roundedAmount.value) === 0,
  },
  { label: t("payment.receivePayment"), amount: totalDue.value, strong: true },
  { label: t("sell.paid"), amount: totalPaid.value },
  {
    label: nonCashOverPayment.value > 0 ? t("sell.nonCashOver") : paymentChange.value > 0 ? t("sell.change") : t("sell.remaining"),
    amount: nonCashOverPayment.value > 0 ? nonCashOverPayment.value : paymentChange.value > 0 ? paymentChange.value : remainingPayment.value,
    attention: nonCashOverPayment.value > 0 || paymentChange.value > 0 || remainingPayment.value > 0,
  },
]);

const promotionStatus = computed(() => {
  if (!validRows.value.length) return "idle";
  if (promotionLoading.value || promotionDirty.value) return "calculating";
  if (promotionError.value) return "error";
  if (promotionLastCalculatedAt.value) return "success";
  return "idle";
});

const promotionStatusText = computed(
  () =>
    ({
      calculating: tl("กำลังคำนวณ", "Calculating", "ກຳລັງຄຳນວນ"),
      success: tl("คำนวณแล้ว", "Calculated", "ຄຳນວນແລ້ວ"),
      error: tl("คำนวณไม่สำเร็จ", "Calculation failed", "ຄຳນວນບໍ່ສຳເລັດ"),
      idle: tl("ยังไม่คำนวณ", "Not calculated", "ຍັງບໍ່ທັນຄຳນວນ"),
    })[promotionStatus.value],
);

const promotionStatusClass = computed(() => `status-${promotionStatus.value}`);

const posCampaignStatus = computed(() => {
  if (!validRows.value.length) return "idle";
  if (posCampaignLoading.value || posCampaignDirty.value) return "calculating";
  if (posCampaignError.value) return "error";
  if (posCampaignLastCalculatedAt.value) return "success";
  return "idle";
});

const posCampaignStatusText = computed(
  () =>
    ({
      calculating: tl("กำลังตรวจแคมเปญ", "Checking campaign", "ກຳລັງກວດແຄມເປນ"),
      success: tl("ตรวจแล้ว", "Checked", "ກວດແລ້ວ"),
      error: tl("ตรวจไม่สำเร็จ", "Check failed", "ກວດບໍ່ສຳເລັດ"),
      idle: tl("ยังไม่คำนวณ", "Not calculated", "ຍັງບໍ່ທັນຄຳນວນ"),
    })[posCampaignStatus.value],
);

const posCampaignStatusClass = computed(() => `status-${posCampaignStatus.value}`);

const posCampaignAuditRows = computed(() =>
  posCampaignRows.value.map((row, index) => ({
    key: `${row.campaign_code || index}-${index}`,
    campaign_code: row.campaign_code || "",
    campaign_name: row.campaign_name || "",
    display_wording: row.display_wording || row.promotion_text || "",
    qty: toNumber(row.qty),
    match_amount: toNumber(row.match_amount),
    sale_amount: toNumber(row.sale_amount),
  })),
);

const posCampaignTotalRights = computed(() => posCampaignAuditRows.value.reduce((sum, row) => sum + toNumber(row.qty), 0));

function relatedItemFromRow(row) {
  return {
    item_code: row.item_code || row._itemCode || "",
    item_name: row.item_name || row._itemName || row.name_1 || "",
    unit_code: row.unit_code || row._unitCode || "",
    qty: toNumber(row.qty ?? row._qty),
    amount: toNumber(row.amount ?? row._amount ?? row.sum_amount),
  };
}

function promotionRelatedItems(promotion) {
  const directRows = promotion?._relatedItems || promotion?.related_items || promotion?.relatedItems || [];
  if (Array.isArray(directRows) && directRows.length) return directRows.map(relatedItemFromRow);

  const itemCode = promotion?._itemCode || promotion?.item_code || "";
  if (itemCode) {
    return validRows.value.filter((row) => row.item_code === itemCode).map((row) => relatedItemFromRow({ ...row, amount: lineSumAmount(row) }));
  }
  return [];
}

const promotionAuditRows = computed(() =>
  promotionResults.value.map((promotion, index) => {
    const code = promotion._promotionCode || promotion.promotion_code || promotion.promotionCode || "";
    const name = promotion._promotionName || promotion.promotion_name || promotion.promotionName || code || "Promotion";
    const qty = toNumber(promotion._qty ?? promotion.qty);
    const count = toNumber(promotion._count ?? promotion.count);
    const amount = Math.abs(toNumber(promotion._amount ?? promotion.amount ?? promotion.sum_amount));
    return {
      key: `${code || index}-${index}`,
      code,
      name,
      qty,
      count,
      amount,
      relatedItems: promotionRelatedItems(promotion),
    };
  }),
);

function focusBarcodeInput() {
  void nextTick(() => {
    const el = barcodeRef.value?.$el || barcodeRef.value;
    el?.querySelector?.("input")?.focus?.() || el?.focus?.();
  });
}

function focusProductSearchInput() {
  void nextTick(() => {
    const el = productSearchRef.value?.$el || productSearchRef.value;
    el?.querySelector?.("input")?.focus?.() || el?.focus?.();
  });
}

function isTypingTarget(target) {
  const tag = String(target?.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable === true;
}

function activeLineForHotkey() {
  const list = displayRows.value || [];
  return list.find((l) => l.id === activeLineId.value) || list[list.length - 1] || null;
}

async function openSaleItemHistory(line = activeLineForHotkey()) {
  const itemCode = String(line?.item_code || "").trim();
  const currentCustCode = String(custCode.value || "").trim();
  if (!itemCode) {
    toast.add({
      severity: "warn",
      summary: tl("ประวัติการขาย", "Sales history", "ປະຫວັດການຂາຍ"),
      detail: tl("กรุณาเลือกรายการสินค้าก่อน", "Please select a product line first.", "ກະລຸນາເລືອກລາຍການສິນຄ້າກ່ອນ"),
      life: 2200,
    });
    return;
  }
  if (!currentCustCode) {
    toast.add({
      severity: "warn",
      summary: tl("ประวัติการขาย", "Sales history", "ປະຫວັດການຂາຍ"),
      detail: tl("กรุณาเลือกลูกค้าก่อน", "Please select a customer first.", "ກະລຸນາເລືອກລູກຄ້າກ່ອນ"),
      life: 2200,
    });
    return;
  }
  saleItemHistoryLine.value = line;
  saleItemHistoryDialogVisible.value = true;
  saleItemHistoryLoading.value = true;
  saleItemHistoryError.value = "";
  saleItemHistoryRows.value = [];
  try {
    saleItemHistoryRows.value = await getSaleItemHistory({
      cust_code: currentCustCode,
      item_code: itemCode,
      limit: 200,
    });
  } catch (error) {
    saleItemHistoryError.value = error?.data?.msg || error.message || tl("โหลดประวัติการขายไม่สำเร็จ", "Failed to load sales history.", "ໂຫຼດປະຫວັດການຂາຍບໍ່ສຳເລັດ");
  } finally {
    saleItemHistoryLoading.value = false;
  }
}

async function openSalePriceFormulaInfo(line = activeLineForHotkey()) {
  const itemCode = String(line?.item_code || "").trim();
  if (!itemCode) {
    toast.add({
      severity: "warn",
      summary: tl("ตารางราคา", "Price table", "ຕາຕະລາງລາຄາ"),
      detail: tl("กรุณาเลือกรายการสินค้าก่อน", "Please select a product line first.", "ກະລຸນາເລືອກລາຍການສິນຄ້າກ່ອນ"),
      life: 2200,
    });
    return;
  }
  salePriceFormulaLine.value = line;
  salePriceFormulaDialogVisible.value = true;
  salePriceFormulaLoading.value = true;
  salePriceFormulaError.value = "";
  salePriceFormulaData.value = { rows: [] };
  try {
    salePriceFormulaData.value = await getSalePriceFormulaInfo({
      cust_code: String(custCode.value || "").trim(),
      item_code: itemCode,
      currency_code: documentCurrencyCodeValue(),
    });
  } catch (error) {
    salePriceFormulaError.value = error?.data?.msg || error.message || tl("โหลดตารางราคาไม่สำเร็จ", "Failed to load price table.", "ໂຫຼດຕາຕະລາງລາຄາບໍ່ສຳເລັດ");
  } finally {
    salePriceFormulaLoading.value = false;
  }
}

function handleSaleHotkeys(event) {
  if (event.ctrlKey && !event.altKey && !event.metaKey && event.key === "1") {
    event.preventDefault();
    void openSaleItemHistory();
    return;
  }
  if (event.ctrlKey && !event.altKey && !event.metaKey && event.key === "3") {
    event.preventDefault();
    void openSalePriceFormulaInfo();
    return;
  }
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.key === "F3") {
    if (documentLocked.value || nameEditorVisible.value) return;
    const line = activeLineForHotkey();
    if (line) {
      event.preventDefault();
      openNameEditor(line); // guard option/locked อยู่ข้างใน
    }
    return;
  }
  if (!isTypingTarget(event.target) && /^[0-9]$/.test(event.key)) {
    const index = event.key === "0" ? 9 : Number(event.key) - 1;
    const tab = visiblePaymentTypeOptions.value[index];
    if (tab && !documentLocked.value) {
      event.preventDefault();
      activePayType.value = tab.value;
    }
  }
}

function promotionGuideKey(itemCode, unitCode) {
  return `${String(itemCode || "").trim()}|${String(unitCode || "").trim()}`;
}

function buildPromotionGuideItems() {
  return buildPromotionItems();
}

const promotionGuideSignature = computed(() =>
  JSON.stringify({
    pos_id: posStore.posId || "",
    member_code: promotionMemberCode.value,
    doc_date: docDate.value,
    promotion_fixed_unitcode: posStore.erpOption?.promotion_fixed_unitcode ?? posStore.erpOption?._promotion_fixed_unitcode ?? "",
    items: buildPromotionGuideItems(),
  }),
);

function linePromotionGuides(line) {
  return promotionGuideMap.value[promotionGuideKey(line?.item_code, line?.unit_code)]?.promotions || [];
}

function lineHasPromotionGuide(line) {
  return linePromotionGuides(line).length > 0;
}

const promotionGuideDialogPromotions = computed(() => (promotionGuideDialogLine.value ? linePromotionGuides(promotionGuideDialogLine.value) : []));

const priceSignature = computed(() =>
  [custCode.value || "", inquiryType.value, vatType.value, vatRate.value, ...rows.value.map((row) => [row.id, row.item_code, row.unit_code, toNumber(row.qty)].join(":"))].join("|"),
);

const promotionSignature = computed(() =>
  [
    custCode.value || "",
    inquiryType.value,
    vatType.value,
    vatRate.value,
    ...validRows.value.map((row) =>
      [row.id, row.item_code, row.unit_code, toNumber(row.qty), toNumber(row.price), String(row.discount || ""), lineSumAmount(row), toNumber(row.price_type ?? 1)].join(":"),
    ),
  ].join("|"),
);

watch(totalDue, (amount) => {
  if (hydratingEditDocument.value) return;
  if (paymentEntries.value.length) {
    if (paymentReviewTotal.value === null) {
      paymentReviewTotal.value = amount;
    } else if (rnd(amount) !== rnd(paymentReviewTotal.value)) {
      paymentReviewNeeded.value = true;
    }
    return;
  }
  paymentReviewNeeded.value = false;
  paymentReviewTotal.value = null;
  transferInputAmount.value = transferInputFromHome(remainingPayment.value);
  creditInputAmount.value = remainingPayment.value;
  chequeAmount.value = remainingPayment.value;
});

watch(remainingPayment, (remaining) => {
  if (hydratingEditDocument.value) return;
  if (paymentEntries.value.length) return;
  transferInputAmount.value = transferInputFromHome(remaining);
  creditInputAmount.value = remaining;
  chequeAmount.value = remaining;
});

watch(
  paymentEntries,
  (entries) => {
    if (!entries.length) {
      paymentReviewNeeded.value = false;
      paymentReviewTotal.value = null;
      if (!paymentDialogVisible.value && !cashInputAmount.value) {
        resetPaymentFormState();
      }
    }
  },
  { deep: true },
);

watch(isCreditSale, (creditSale) => {
  if (!creditSale) {
    activePayType.value = "cash";
    refreshPaymentReviewAfterEdit();
    return;
  }
  paymentEntries.value = [];
  resetPaymentFormState();
});

watch(activePayType, (type) => {
  if (type === "cash") {
    changeCashCurrency(defaultCashCurrencyCode.value);
    // focusCashTenderInput();
  } else if (isCashCurrencyPayType(type)) {
    changeCashCurrency(cashCurrencyCodeFromPayType(type));
    // focusCashTenderInput();
  }
  if (type === "deposit" && !depositOptions.value.length) void refreshDepositOptions();
  if (type === "deposit_money" && !depositMoneyOptions.value.length) void refreshDepositMoneyOptions();
  if (type === "currency" && !otherCurrency.value && otherCurrencyOptions.value.length) otherCurrency.value = otherCurrencyOptions.value[0];
  if (type === "laoqr") {
    void ensureLaoQrConfig();
    syncLaoQrAmountFromRate();
  }
  if (type !== "transfer" && type !== "credit_transfer" && selectedTransferStaticQr.value) clearTransferStaticQr();
});

watch([laoQrBaseDue, laoQrCurrency], () => {
  if (activePayType.value === "laoqr" && !laoQrUiLocked.value) syncLaoQrAmountFromRate();
});

watch(laoQrTransferPassBook, () => {
  if (laoQrUiLocked.value) return;
  syncLaoQrCurrencyFromPassBook();
});

watch(laoQrProvider, () => {
  if (laoQrApplyingRequest) return;
  if (laoQrUiLocked.value) return;
  resetLaoQrPaymentState();
  syncLaoQrCurrencyFromPassBook();
});

watch(transferPassBook, (book) => {
  applyPaymentCurrency(transferCurrency, transferExchangeRate, book?.currency_code || "THB");
});

watch(creditType, (type) => {
  applyPaymentCurrency(creditCurrency, creditExchangeRate, type?.currency_code || documentCurrency.value?.code || "THB");
});

watch(chequePassBook, (book) => {
  applyPaymentCurrency(chequeCurrency, chequeExchangeRate, book?.currency_code || documentCurrency.value?.code || "THB");
});

watch(transferCurrency, (currency) => {
  setExchangeRateValue(transferExchangeRate, transferExchangeRateText, paymentCurrencyRate(currency, paymentCurrencyCode(currency) === "THB" ? 1 : 0), 0);
  // เปลี่ยนสกุล → คำนวณ default "จำนวนรับชำระ" ใหม่เป็นหน่วยของสกุลนั้น (เหมือน KIP)
  if (!hydratingEditDocument.value) {
    transferInputAmount.value = transferInputFromHome(remainingPayment.value);
  }
});

watch(creditCurrency, (currency) => {
  setExchangeRateValue(creditExchangeRate, creditExchangeRateText, paymentCurrencyRate(currency, paymentCurrencyCode(currency) === "THB" ? 1 : 0), 0);
});

watch(chequeCurrency, (currency) => {
  setExchangeRateValue(chequeExchangeRate, chequeExchangeRateText, paymentCurrencyRate(currency, paymentCurrencyCode(currency) === "THB" ? 1 : 0), 0);
});

watch(otherCurrency, (currency) => {
  setExchangeRateValue(otherCurrencyExchangeRate, otherCurrencyExchangeRateText, paymentCurrencyRate(currency, paymentCurrencyCode(currency) === "THB" ? 1 : 0), 0);
});

watch(documentExchangeRate, () => syncExchangeRateText(documentExchangeRate, documentExchangeRateText), { immediate: true });
watch(cashExchangeRate, () => syncExchangeRateText(cashExchangeRate, cashExchangeRateText), { immediate: true });
watch(transferExchangeRate, () => syncExchangeRateText(transferExchangeRate, transferExchangeRateText), { immediate: true });
watch(creditExchangeRate, () => syncExchangeRateText(creditExchangeRate, creditExchangeRateText), { immediate: true });
watch(chequeExchangeRate, () => syncExchangeRateText(chequeExchangeRate, chequeExchangeRateText), { immediate: true });
watch(otherCurrencyExchangeRate, () => syncExchangeRateText(otherCurrencyExchangeRate, otherCurrencyExchangeRateText), { immediate: true });

watch(docDate, (value) => {
  if (hydratingEditDocument.value) return;
  transferDate.value = value;
  chequeDueDate.value = value;
  sendDate.value = value;
  deliveryDate.value = value;
  dueDate.value = addDaysISO(value, creditDay.value);
  taxDocDate.value = value;
  vatRows.value.forEach((row) => {
    if (!row.vat_date) row.vat_date = value;
    syncVatRowDerivedFields(row);
  });
});

watch([taxDocNo, taxDocDate], () => {
  if (hydratingEditDocument.value) return;
  if (!vatRows.value.length) {
    ensureVatDefaultRow();
    return;
  }
  const firstRow = vatRows.value[0];
  if (!String(firstRow.vat_number || "").trim() || firstRow.vat_number === nextDocNo.value) {
    firstRow.vat_number = taxDocNo.value || nextDocNo.value;
  }
  firstRow.vat_date = taxDocDate.value || docDate.value;
  syncVatRowDerivedFields(firstRow);
});

watch(creditDay, (days) => {
  if (hydratingEditDocument.value) return;
  dueDate.value = addDaysISO(docDate.value, days);
});

watch(custCode, () => {
  if (hydratingEditDocument.value) return;
  depositMoneyDoc.value = null;
  depositMoneyOptions.value = [];
  depositMoneyAmount.value = 0;
  if (workspaceTab.value === "deposit_money" || activePayType.value === "deposit_money") void refreshDepositMoneyOptions();
  void refreshCustomerCredit();
});

watch(locale, () => {
  if (custCode.value === defaultCustomerCode && (!custName.value || custName.value === previousDefaultCustomerName.value)) {
    custName.value = defaultCustomerName.value;
  }
  previousDefaultCustomerName.value = defaultCustomerName.value;
});

watch(
  () => posStore.selectedPos?.pos_id,
  () => {
    if (editMode.value || hydratingEditDocument.value) return;
    inquiryType.value = defaultSaleInquiryType();
    //vatType.value = defaultSaleVatType();
    branchCode.value = posStore.selectedPos?.branch_code || branchCode.value || "";
  },
  { immediate: true },
);

watch(documentCurrency, (currency) => {
  if (hydratingEditDocument.value) return;
  setExchangeRateValue(documentExchangeRate, documentExchangeRateText, toNumber(currency?.exchange_rate_present, 1));
  syncDocumentExchangeRateCalculations(documentExchangeRateValue());
});

watch(
  visiblePaymentTypeOptions,
  (tabs) => {
    if (!tabs.some((tab) => tab.value === activePayType.value)) activePayType.value = "cash";
  },
  { immediate: true },
);

watch(couponSelected, (coupon) => {
  if (!coupon) {
    couponAmount.value = 0;
    return;
  }
  const amount = toNumber(coupon.amount);
  const availableAmount = toNumber(coupon.available_amount ?? coupon.usable_amount, NaN);
  if (String(coupon.coupon_type) === "1") {
    couponAmount.value = Number.isFinite(availableAmount) ? availableAmount : rnd(totals.value.totalAmount - calcAfterDiscount(`${amount}%`, totals.value.totalAmount, 2));
  } else {
    couponAmount.value = Number.isFinite(availableAmount) ? availableAmount : toNumber(coupon.balance_amount, amount);
  }
  couponAmount.value = Math.min(toNumber(couponAmount.value), selectedCouponMaxAmount.value || 0);
});

watch(couponSearch, (value) => {
  if (couponSelected.value && String(value || "").trim() !== String(couponSelected.value.number || "").trim()) {
    couponSelected.value = null;
    couponLookupError.value = "";
  }
});

watch(
  () => totals.value.totalAmount,
  () => {
    if (!couponSelected.value || String(couponSelected.value.coupon_type) !== "1") return;
    couponSelected.value = null;
    couponAmount.value = 0;
    couponLookupError.value = tl("ยอดเอกสารเปลี่ยน กรุณาตรวจสอบคูปองอีกครั้ง", "Document amount changed. Please check the coupon again.", "ຍອດເອກະສານປ່ຽນ ກະລຸນາກວດສອບຄູປອງອີກຄັ້ງ");
  },
);

watch(depositDoc, (doc) => {
  depositAmount.value = doc ? selectedDepositApplyLimit.value : 0;
});

watch([depositDoc, remainingPayment], () => {
  if (!depositDoc.value) {
    depositAmount.value = 0;
    return;
  }
  const limit = selectedDepositApplyLimit.value;
  if (depositAmount.value <= 0 || depositAmount.value > selectedDepositMaxAmount.value) {
    depositAmount.value = limit;
  }
});

watch(depositMoneyDoc, (doc) => {
  depositMoneyAmount.value = doc ? selectedDepositMoneyApplyLimit.value : 0;
});

watch([depositMoneyDoc, remainingPayment], () => {
  if (!depositMoneyDoc.value) {
    depositMoneyAmount.value = 0;
    return;
  }
  const limit = selectedDepositMoneyApplyLimit.value;
  if (depositMoneyAmount.value <= 0 || depositMoneyAmount.value > selectedDepositMoneyMaxAmount.value) {
    depositMoneyAmount.value = limit;
  }
});

watch(priceSignature, () => {
  if (hydratingEditDocument.value) return;
  schedulePriceRefresh();
});

watch(promotionSignature, () => {
  if (hydratingEditDocument.value) return;
  schedulePromotionCalculation();
});

watch(promotionGuideSignature, () => {
  if (hydratingEditDocument.value) return;
  schedulePromotionGuideCheck();
});

watch(priceRefreshing, (isRefreshing) => {
  if (!isRefreshing && promotionDirty.value) schedulePromotionCalculation(50);
});

watch(workspaceTab, (tab) => {
  if (tab === "details" && !documentLocked.value) focusBarcodeInput();
  if (["vat", "wht", "shipment", "gl", "deposit_money"].includes(tab)) extraSubTab.value = tab;
  if (tab === "wht" && !documentLocked.value && !whtHeaders.value.length) addWhtHeader();
  if (tab === "vat" && !documentLocked.value) ensureVatDefaultRow();
  if (tab === "deposit_money" && !documentLocked.value) void refreshDepositMoneyOptions();
});

watch(extraSubTab, (tab) => {
  if (tab === "wht" && !documentLocked.value && !whtHeaders.value.length) addWhtHeader();
  if (tab === "vat" && !documentLocked.value) ensureVatDefaultRow();
});

watch(
  () => whtHeaders.value.map((row) => row.id),
  (ids) => {
    if (!ids.length) {
      selectedWhtHeaderId.value = "";
      return;
    }
    if (!selectedWhtHeaderId.value || !ids.includes(selectedWhtHeaderId.value)) {
      selectedWhtHeaderId.value = ids[0];
    }
  },
  { immediate: true },
);

const hasBlockedNoPriceLine = computed(() => isCompanyOptionEnabled("disable_sale_no_price", false) && validRows.value.some((row) => !isSalePolicyLineSkipped(row) && toNumber(row.price) <= 0));

// เช็กเฉพาะเรื่องการกรอกยอดชำระ — ใช้กับด่าน "บันทึก" เท่านั้น
// ห้ามนำไปใช้กับด่าน "เปิดหน้าชำระเงิน/สร้าง QR" เพราะตอนเปิดยังไม่ได้กรอกเงิน remainingPayment จึง > 0 เสมอ
const paymentValidationMessages = computed(() => {
  const messages = [];
  if (paymentReviewNeeded.value)
    messages.push(
      tl("ยอดเอกสารเปลี่ยนหลังมีรายการชำระเงิน กรุณาตรวจสอบการรับชำระ", "Document amount changed after payment. Please review payment", "ຍອດເອກະສານປ່ຽນຫຼັງມີລາຍການຊຳລະ ກະລຸນາກວດກາການຮັບຊຳລະ"),
    );
  if (isCashSale.value && remainingPayment.value > 0)
    messages.push(
      tl(
        `ยอดชำระยังไม่ครบ คงเหลือ ${formatCurrency(remainingPayment.value)}`,
        `Payment incomplete. Remaining ${formatCurrency(remainingPayment.value)}`,
        `ຊຳລະຍັງບໍ່ຄົບ ຄົງເຫຼືອ ${formatCurrency(remainingPayment.value)}`,
      ),
    );
  if (isCashSale.value && nonCashOverPayment.value > 0)
    messages.push(
      tl(
        `ยอดชำระที่ไม่ใช่เงินสดเกินยอดสุทธิ ${formatCurrency(nonCashOverPayment.value)}`,
        `Non-cash payment exceeds net amount ${formatCurrency(nonCashOverPayment.value)}`,
        `ຍອດຊຳລະທີ່ບໍ່ແມ່ນເງິນສົດເກີນຍອດສຸດທິ ${formatCurrency(nonCashOverPayment.value)}`,
      ),
    );
  if (isCashSale.value && !cashChangeAllowed.value) messages.push(tl("เงินทอนต้องมาจากยอดรับเงินสดเท่านั้น", "Change must come from cash received only", "ເງິນທອນຕ້ອງມາຈາກຍອດຮັບເງິນສົດເທົ່ານັ້ນ"));
  return messages;
});

// เช็กความพร้อมของ "เอกสาร" (รหัสเอกสาร/สินค้า/ราคา/โปรโมชั่น/VAT/WHT/GL ฯลฯ) ไม่รวมเรื่องการกรอกยอดชำระ
// ใช้เป็นด่านก่อนเปิดหน้ารับชำระ/สร้าง QR
const documentValidationMessages = computed(() => {
  const messages = [];
  if (!docFormatCode.value) messages.push(tl("กรุณาเลือกรหัสเอกสาร", "Please select document code", "ກະລຸນາເລືອກລະຫັດເອກະສານ"));
  if (!validRows.value.length) messages.push(tl("กรุณาเพิ่มรายการสินค้า", "Please add product items", "ກະລຸນາເພີ່ມລາຍການສິນຄ້າ"));
  if (priceRefreshing.value) messages.push(tl("กำลังดึงราคาสินค้า", "Loading product prices", "ກຳລັງດຶງລາຄາສິນຄ້າ"));
  if (rows.value.some((row) => row.price_error)) messages.push(tl("ดึงราคาสินค้าบางรายการไม่สำเร็จ", "Some product prices failed to load", "ດຶງລາຄາສິນຄ້າບາງລາຍການບໍ່ສຳເລັດ"));
  if (hasBlockedNoPriceLine.value) messages.push(tl("พบสินค้าที่ไม่มีราคาขาย", "Some products have no sale price", "ພົບສິນຄ້າທີ່ບໍ່ມີລາຄາຂາຍ"));
  if (promotionDirty.value || promotionLoading.value)
    messages.push(tl("ยังบันทึกไม่ได้ เพราะระบบกำลังคำนวณโปรโมชั่น", "Cannot save while promotions are calculating", "ຍັງບັນທຶກບໍ່ໄດ້ ເພາະກຳລັງຄຳນວນໂປຣໂມຊັນ"));
  if (promotionError.value) messages.push(tl("ยังบันทึกไม่ได้ เพราะยังคำนวณโปรโมชั่นไม่สำเร็จ", "Cannot save because promotion calculation failed", "ຍັງບັນທຶກບໍ່ໄດ້ ເພາະຄຳນວນໂປຣໂມຊັນບໍ່ສຳເລັດ"));
  if (posCampaignDirty.value || posCampaignLoading.value)
    messages.push(tl("ยังบันทึกไม่ได้ เพราะระบบกำลังตรวจแคมเปญท้ายใบเสร็จ", "Cannot save while receipt campaigns are checking", "ຍັງບັນທຶກບໍ່ໄດ້ ເພາະກຳລັງກວດແຄມເປນທ້າຍໃບຮັບ"));
  if (posCampaignError.value)
    messages.push(tl("ยังบันทึกไม่ได้ เพราะยังตรวจแคมเปญท้ายใบเสร็จไม่สำเร็จ", "Cannot save because receipt campaign check failed", "ຍັງບັນທຶກບໍ່ໄດ້ ເພາະກວດແຄມເປນທ້າຍໃບຮັບບໍ່ສຳເລັດ"));
  const disallowedWhCodes = Array.from(new Set(validRows.value.map((row) => String(row.wh_code || "").trim()).filter((code) => code && !isSaleWarehouseAllowed(code))));
  if (disallowedWhCodes.length) {
    messages.push(
      tl(
        `พบคลังที่ไม่ได้อยู่ในรายการคลังที่ขายได้: ${disallowedWhCodes.join(", ")}`,
        `Some warehouses are not allowed for sales on this device: ${disallowedWhCodes.join(", ")}`,
        `ພົບຄັງທີ່ບໍ່ຢູ່ໃນລາຍການຄັງທີ່ຂາຍໄດ້: ${disallowedWhCodes.join(", ")}`,
      ),
    );
  }
  if (!String(saleCode.value || "").trim()) messages.push(tl("กรุณาเลือกพนักงานขาย", "Please select salesperson", "ກະລຸນາເລືອກພະນັກງານຂາຍ"));
  if (totals.value.totalAmount < 0) messages.push(tl("ส่วนลดท้ายบิลมากกว่ายอดสินค้า", "Bill discount exceeds product amount", "ສ່ວນຫຼຸດທ້າຍບິນຫຼາຍກວ່າຍອດສິນຄ້າ"));
  vatRowsWithTotals.value.forEach((row, index) => {
    if ((toNumber(row.base_caltax_amount) > 0 || toNumber(row.amount) > 0) && !String(row.vat_number || "").trim()) {
      messages.push(tl(`VAT แถวที่ ${index + 1} ยังไม่ได้ระบุเลขที่ใบกำกับภาษี`, `VAT row ${index + 1} is missing tax invoice no.`, `VAT ແຖວ ${index + 1} ຍັງບໍ່ໄດ້ລະບຸເລກໃບກຳກັບພາສີ`));
    }
    if (toNumber(row.branch_type) === 1 && !String(row.branch_code || "").trim()) {
      messages.push(
        tl(`VAT แถวที่ ${index + 1} เลือกประเภทสาขา แต่ยังไม่ได้ระบุรหัสสาขา`, `VAT row ${index + 1} has branch type but no branch code`, `VAT ແຖວ ${index + 1} ເລືອກປະເພດສາຂາແຕ່ຍັງບໍ່ລະບຸລະຫັດສາຂາ`),
      );
    }
    const expected = rnd((toNumber(row.base_caltax_amount) * toNumber(row.tax_rate)) / 100);
    if (Math.abs(expected - toNumber(row.amount)) > 0.01) {
      messages.push(
        tl(`VAT แถวที่ ${index + 1} ยอดภาษีไม่สัมพันธ์กับฐานภาษีและอัตรา`, `VAT row ${index + 1} tax amount does not match base and rate`, `VAT ແຖວ ${index + 1} ຍອດພາສີບໍ່ສຳພັນກັບຖານພາສີແລະອັດຕາ`),
      );
    }
  });
  whtHeaders.value.forEach((header, index) => {
    const details = Array.isArray(header.details) ? header.details : [];
    const amount = rnd(details.reduce((sum, row) => sum + toNumber(row.amount), 0));
    if (amount > 0 && !String(header.tax_doc_no || "").trim()) {
      messages.push(
        tl(
          `ภาษีหัก ณ ที่จ่าย แถวที่ ${index + 1} ยังไม่ได้ระบุเลขที่เอกสารหัก ณ ที่จ่าย`,
          `WHT row ${index + 1} is missing withholding document no.`,
          `ພາສີຫັກ ณ ທີ່ຈ່າຍ ແຖວ ${index + 1} ຍັງບໍ່ໄດ້ລະບຸເລກເອກະສານ`,
        ),
      );
    }
  });
  if (glManualMode.value && !manualGlBalanced.value) messages.push(tl("ยอดเดบิต/เครดิต GL ต้องเท่ากัน", "GL debit and credit must balance", "ຍອດເດບິດ/ເຄຣດິດ GL ຕ້ອງເທົ່າກັນ"));
  return messages;
});

// ด่าน "บันทึก" ต้องผ่านทั้งความพร้อมเอกสารและความครบของยอดชำระ (พฤติกรรมเดิม)
const validationMessages = computed(() => [...documentValidationMessages.value, ...paymentValidationMessages.value]);

const itemTabWarningCount = computed(
  () =>
    [
      !validRows.value.length,
      priceRefreshing.value,
      rows.value.some((row) => row.price_error),
      promotionDirty.value || promotionLoading.value,
      !!promotionError.value,
      posCampaignDirty.value || posCampaignLoading.value,
      !!posCampaignError.value,
      hasBlockedNoPriceLine.value,
      totals.value.totalAmount < 0,
    ].filter(Boolean).length,
);

const documentTabWarningCount = computed(() => [!docFormatCode.value, !String(saleCode.value || "").trim()].filter(Boolean).length);

const paymentTabWarningCount = computed(() =>
  isCreditSale.value ? 0 : [paymentReviewNeeded.value, remainingPayment.value > 0, nonCashOverPayment.value > 0, !cashChangeAllowed.value].filter(Boolean).length,
);

const whtValidationCount = computed(
  () =>
    whtHeaders.value.filter((header) => {
      const details = Array.isArray(header.details) ? header.details : [];
      const amount = rnd(details.reduce((sum, row) => sum + toNumber(row.amount), 0));
      return amount > 0 && !String(header.tax_doc_no || "").trim();
    }).length,
);
const vatValidationCount = computed(
  () =>
    vatRowsWithTotals.value.filter((row) => {
      const missingVatNumber = (toNumber(row.base_caltax_amount) > 0 || toNumber(row.amount) > 0) && !String(row.vat_number || "").trim();
      const missingBranchCode = toNumber(row.branch_type) === 1 && !String(row.branch_code || "").trim();
      const expected = rnd((toNumber(row.base_caltax_amount) * toNumber(row.tax_rate)) / 100);
      const invalidAmount = Math.abs(expected - toNumber(row.amount)) > 0.01;
      return missingVatNumber || missingBranchCode || invalidAmount;
    }).length,
);
const extraTabWarningCount = computed(() => vatValidationCount.value + whtValidationCount.value + (glManualMode.value && !manualGlBalanced.value ? 1 : 0));

function workspaceTabBadge(tab) {
  if (tab.value === "details") return documentTabWarningCount.value ? String(documentTabWarningCount.value) : String(validRows.value.length);
  if (tab.value === "vat") return vatValidationCount.value ? String(vatValidationCount.value) : "";
  if (tab.value === "wht") return whtValidationCount.value ? String(whtValidationCount.value) : "";
  if (tab.value === "gl") return glManualMode.value && !manualGlBalanced.value ? "!" : "";
  return "";
}

function workspaceTabTone(tab) {
  if (tab.value === "details" && (documentTabWarningCount.value > 0 || itemTabWarningCount.value > 0)) return "warning";
  if (tab.value === "vat" && vatValidationCount.value > 0) return "warning";
  if (tab.value === "wht" && whtValidationCount.value > 0) return "warning";
  if (tab.value === "gl" && glManualMode.value && !manualGlBalanced.value) return "warning";
  return "info";
}

function firstValidationTab() {
  if (itemTabWarningCount.value > 0) return "details";
  if (documentTabWarningCount.value > 0) return "details";
  if (paymentTabWarningCount.value > 0) return workspaceTab.value;
  if (extraTabWarningCount.value > 0) {
    if (vatValidationCount.value > 0) return "vat";
    if (whtValidationCount.value > 0) return "wht";
    if (glManualMode.value && !manualGlBalanced.value) return "gl";
  }
  return workspaceTab.value;
}

function firstDocumentValidationTab() {
  if (itemTabWarningCount.value > 0) return "details";
  if (documentTabWarningCount.value > 0) return "details";
  if (extraTabWarningCount.value > 0) {
    if (vatValidationCount.value > 0) return "vat";
    if (whtValidationCount.value > 0) return "wht";
    if (glManualMode.value && !manualGlBalanced.value) return "gl";
  }
  return workspaceTab.value;
}

const documentStatusText = computed(() => {
  if (saving.value) return t("sell.saving");
  if (successDocNo.value) return `${t("sell.saved")} ${successDocNo.value}`;
  if (priceRefreshing.value) return t("sell.priceLoading");
  if (promotionDirty.value || promotionLoading.value) return t("sell.promotionCalculating");
  if (documentValidationMessages.value.length) return t("sell.needReview", { count: documentValidationMessages.value.length });
  return t("sell.readyToSave");
});

const documentStatusTone = computed(() => {
  if (successDocNo.value) return "success";
  if (saving.value || priceRefreshing.value || promotionDirty.value || promotionLoading.value) return "info";
  if (documentValidationMessages.value.length) return "warning";
  return "ready";
});

const paymentStatusText = computed(() => {
  if (isCreditSale.value) return t("sell.creditSale");
  if (paymentReviewNeeded.value) return t("payment.receivePayment");
  if (remainingPayment.value > 0) return `${t("sell.remaining")} ${formatCurrency(remainingPayment.value)}`;
  if (nonCashOverPayment.value > 0) return `${t("sell.nonCashOver")} ${formatCurrency(nonCashOverPayment.value)}`;
  if (paymentChange.value > 0) return `${t("sell.change")} ${formatCurrency(paymentChange.value)}`;
  if (paymentEntries.value.length) return t("sell.paidComplete");
  return t("sell.notPaid");
});

const editDocumentDirty = computed(() => {
  if (!editMode.value) return true;
  if (!editOriginalSignature.value) return false;
  return buildEditDirtySignature() !== editOriginalSignature.value;
});
const canSave = computed(() => !saving.value && !successDocNo.value && (!editMode.value || editDocumentDirty.value));
const canHoldBill = computed(() => !saving.value && !documentLocked.value && !successDocNo.value && !editMode.value && validRows.value.length > 0);
const canCheckoutSave = computed(
  () =>
    canSave.value &&
    isCashSale.value &&
    validRows.value.length > 0 &&
    remainingPayment.value <= 0 &&
    nonCashOverPayment.value <= 0 &&
    cashChangeAllowed.value &&
    !paymentReviewNeeded.value &&
    !changeRoundingAutoIncomeNeedsSync.value &&
    !transferAutoRoundingNeedsSync.value,
);
const saveButtonLabel = computed(() => {
  if (successDocNo.value) return t("sell.saved");
  if (editMode.value && !editDocumentDirty.value) return t("sell.noChange");
  return t("sell.saveSaleDoc");
});
const saveDialogIcon = computed(
  () =>
    ({
      success: "pi pi-check-circle",
      error: "pi pi-times-circle",
      warn: "pi pi-exclamation-triangle",
      info: "pi pi-info-circle",
    })[saveDialogType.value] || "pi pi-info-circle",
);
const salePolicyDialogIcon = computed(
  () =>
    ({
      error: "pi pi-times-circle",
      warn: "pi pi-exclamation-triangle",
      info: "pi pi-info-circle",
    })[salePolicyDialogType.value] || "pi pi-exclamation-triangle",
);

function openSaveDialog({ type = "info", title = "", message = "", details = [], primaryLabel = "", primarySeverity = "warning", primaryAction = null, showPaymentReviewAction = false } = {}) {
  saveDialogType.value = type;
  saveDialogTitle.value = title;
  saveDialogMessage.value = message;
  saveDialogDetails.value = Array.isArray(details) ? details.filter(Boolean) : [];
  saveDialogPrimaryLabel.value = primaryLabel;
  saveDialogPrimarySeverity.value = primarySeverity;
  saveDialogPrimaryAction.value = typeof primaryAction === "function" ? primaryAction : null;
  saveDialogShowPaymentReviewAction.value = !!showPaymentReviewAction;
  saveDialogVisible.value = true;
}

function openProductNotFoundDialog(barcode) {
  openSaveDialog({
    type: "warn",
    title: tl("ไม่พบสินค้าในระบบ", "Product not found", "ບໍ່ພົບສິນຄ້າໃນລະບົບ"),
    message: tl("ไม่พบสินค้าในระบบจากบาร์โค้ดที่สแกน", "No product was found for the scanned barcode.", "ບໍ່ພົບສິນຄ້າໃນລະບົບຈາກບາໂຄດທີ່ສະແກນ"),
    details: barcode ? [tl(`บาร์โค้ด: ${barcode}`, `Barcode: ${barcode}`, `ບາໂຄດ: ${barcode}`)] : [],
  });
}

function openSalePolicyDialog({ type = "warn", title = "", message = "", details = [], stockAdjustmentContext = null } = {}) {
  salePolicyDialogType.value = type;
  salePolicyDialogTitle.value = title || tl("ตรวจเงื่อนไขสินค้า", "Product policy", "ກວດເງື່ອນໄຂສິນຄ້າ");
  salePolicyDialogMessage.value = message || tl("พบเงื่อนไขสินค้าในรายการขาย", "A product policy condition was found", "ພົບເງື່ອນໄຂສິນຄ້າໃນລາຍການຂາຍ");
  salePolicyDialogDetails.value = Array.isArray(details) ? details.filter(Boolean) : [];
  salePolicyStockAdjustmentContext.value = stockAdjustmentContext;
  salePolicyDialogVisible.value = true;
}

function closeSalePolicyDialog() {
  salePolicyDialogVisible.value = false;
  if (!stockAdjustmentDialogVisible.value) salePolicyStockAdjustmentContext.value = null;
}

function makeSalePolicyError(details = [], fallback = "", dialogShown = false) {
  const cleanDetails = Array.isArray(details) ? details.filter(Boolean) : [];
  const error = new Error(cleanDetails.join(" / ") || fallback || tl("รายการสินค้าไม่ผ่านเงื่อนไขการขาย", "Product items do not pass sale policy", "ລາຍການສິນຄ້າບໍ່ຜ່ານເງື່ອນໄຂການຂາຍ"));
  error.salePolicy = true;
  error.salePolicyDetails = cleanDetails;
  error.salePolicyDialogShown = dialogShown;
  return error;
}

function handleSalePolicyError(error, { title = "", message = "" } = {}) {
  if (!error?.salePolicy) return false;
  if (!error.salePolicyDialogShown) {
    openSalePolicyDialog({
      type: "warn",
      title,
      message: message || error.message || tl("รายการสินค้าไม่ผ่านเงื่อนไขการขาย", "Product items do not pass sale policy", "ລາຍການສິນຄ້າບໍ່ຜ່ານເງື່ອນໄຂການຂາຍ"),
      details: error.salePolicyDetails?.length ? error.salePolicyDetails : [error.message],
    });
    error.salePolicyDialogShown = true;
  }
  return true;
}

async function runSaveDialogPrimaryAction() {
  const action = saveDialogPrimaryAction.value;
  saveDialogVisible.value = false;
  saveDialogPrimaryAction.value = null;
  saveDialogShowPaymentReviewAction.value = false;
  if (action) await action();
}

function heldBillSummaryText(entry = {}) {
  const summary = entry.summary || {};
  const customer = [summary.cust_code, summary.cust_name].filter(Boolean).join(" ").trim() || defaultCustomerName.value;
  const itemCount = toNumber(summary.item_count);
  return `${customer} · ${itemCount} ${t("sell.items")}`;
}

function heldBillEmployeeText(entry = {}) {
  const summary = entry.summary || {};
  const employee = [summary.sale_code, summary.sale_name].filter(Boolean).join(" ").trim();
  return employee ? tl(`พนักงานขาย: ${employee}`, `Salesperson: ${employee}`, `ພະນັກງານຂາຍ: ${employee}`) : "";
}

function formatHeldBillTimestamp(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("th-TH", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function refreshHeldBills() {
  heldBills.value = listHeldBills();
}

function openHeldBillDialog() {
  refreshHeldBills();
  heldBillDialogVisible.value = true;
}

function hasWorkingDraftData() {
  return (
    validRows.value.length > 0 ||
    paymentEntries.value.length > 0 ||
    !!String(remark.value || "").trim() ||
    !!String(discountWord.value || "").trim() ||
    (!!String(custCode.value || "").trim() && custCode.value !== defaultCustomerCode)
  );
}

function buildHeldBillDetail(payload = {}) {
  const body = payload.body || {};
  const linePriceState = Array.isArray(payload.line_price_state) ? payload.line_price_state : [];
  return {
    header: body,
    items: Array.isArray(body.items)
      ? body.items.map((item, index) => {
          const priceState = linePriceState[index] || {};
          return {
            ...item,
            price_manual: priceState.price_manual ?? item.price_manual,
            price_locked: priceState.price_locked ?? item.price_locked,
          };
        })
      : [],
    payment_detail: Array.isArray(body.payment_detail) ? body.payment_detail : [],
    vat_rows: Array.isArray(body.vat_rows) ? body.vat_rows : [],
    wht_headers: Array.isArray(body.wht_headers) ? body.wht_headers : [],
    shipment: body.shipment || {},
    gl_trans_direct: toNumber(body.gl_trans_direct),
    gl_header: body.gl_header || {},
    gl_detail: Array.isArray(body.gl_detail) ? body.gl_detail : [],
    promotion_detail: Array.isArray(body.promotion_detail) ? body.promotion_detail : [],
    pos_campaign_detail: Array.isArray(body.pos_campaign_detail) ? body.pos_campaign_detail : [],
    ref_billings: Array.isArray(body.ref_billings) ? body.ref_billings : [],
  };
}

async function applyHeldBillPayload(payload = {}) {
  const detail = buildHeldBillDetail(payload);
  hydratingEditDocument.value = true;
  resetPaymentFormState();
  await hydrateHeaderFromDetail(detail, "");
  await syncCustomerNameFromMaster(custCode.value);
  hydrateItemsFromDetail(detail);
  hydratePaymentsFromDetail(detail);
  hydrateVatWhtFromDetail(detail);
  hydratingShipment.value = true;
  hydrateShipmentFromDetail(detail);
  await syncShipmentLocationMasterSelection();
  applyTambonZipcode();
  hydratingShipment.value = false;
  hydrateGlFromDetail(detail);
  hydratePromotionFromDetail(detail);
  hydratePosCampaignFromDetail(detail);
  hydrateRefBillingsFromDetail(detail);
  restoreLaoQrPaymentRequests(payload.lao_qr_payment_requests);
  editMode.value = false;
  oldDocNo.value = "";
  successDocNo.value = "";
  loadedEditDocNo.value = "";
  editOriginalSignature.value = "";
  await refreshCustomerCredit();
  await nextTick();
  hydratingEditDocument.value = false;
}

function saveCurrentDraftAsHeldBill() {
  const snapshot = buildSaveSnapshot();
  return saveHeldBill(snapshot, {
    title: `${custCode.value || defaultCustomerCode} ${custName.value || defaultCustomerName.value}`.trim(),
  });
}

async function resumeHeldBill(entryId = "") {
  if (holdingBill.value) return;
  const selected = loadHeldBill(entryId);
  if (!selected?.payload) {
    toast.add({
      severity: "warn",
      summary: tl("บิลพัก", "Held bill", "ບິນພັກ"),
      detail: tl("ไม่พบบิลพักที่เลือก หรือข้อมูลไม่ตรงเวอร์ชัน", "Held bill not found or schema mismatch", "ບໍ່ພົບບິນພັກ ຫຼື schema ບໍ່ກົງ"),
      life: 2600,
    });
    refreshHeldBills();
    return;
  }

  holdingBill.value = true;
  try {
    const savedCurrent = validRows.value.length > 0 ? saveCurrentDraftAsHeldBill() : null;
    await applyHeldBillPayload(selected.payload);
    deleteHeldBill(entryId);
    refreshHeldBills();
    heldBillDialogVisible.value = false;
    // toast.add({
    //   severity: "success",
    //   summary: tl("บิลพัก", "Held bill", "ບິນພັກ"),
    //   detail: savedCurrent
    //     ? tl(
    //         "พักบิลปัจจุบันแล้ว (" + savedCurrent.id + ") และเรียกบิลพักที่เลือกมาใช้งาน",
    //         "Current bill held (" + savedCurrent.id + ") and selected held bill resumed",
    //         "ພັກບິນປັດຈຸບັນແລ້ວ (" + savedCurrent.id + ") ແລະເອີ້ນບິນພັກທີ່ເລືອກ",
    //       )
    //     : tl("เรียกบิลพักสำเร็จ และลบจากรายการพักแล้ว", "Held bill resumed and removed from hold list", "ເອີ້ນບິນພັກສຳເລັດ ແລະ ລຶບອອກຈາກລາຍການພັກແລ້ວ"),
    //   life: 2400,
    // });
  } catch (error) {
    openSaveDialog({
      type: "error",
      title: tl("เรียกบิลพักไม่สำเร็จ", "Failed to resume held bill", "ເອີ້ນບິນພັກບໍ່ສຳເລັດ"),
      message: error.message || tl("ไม่สามารถเรียกบิลพักได้", "Unable to resume held bill", "ບໍ່ສາມາດເອີ້ນບິນພັກໄດ້"),
    });
    refreshHeldBills();
  } finally {
    holdingBill.value = false;
  }
}
function removeHeldBill(entryId = "") {
  const selected = loadHeldBill(entryId);
  if (!selected) {
    refreshHeldBills();
    return;
  }
  const title = selected.title || selected.id;
  openSaveDialog({
    type: "warn",
    title: tl("ยืนยันลบบิลพัก", "Confirm delete held bill", "ຢືນຢັນລຶບບິນພັກ"),
    message: tl(`ต้องการลบบิลพัก ${title} ใช่หรือไม่`, `Delete held bill ${title}?`, `ຕ້ອງການລຶບບິນພັກ ${title} ຫຼືບໍ?`),
    primaryLabel: tl("ลบบิลพัก", "Delete held bill", "ລຶບບິນພັກ"),
    primarySeverity: "danger",
    primaryAction: () => {
      deleteHeldBill(entryId);
      refreshHeldBills();
      toast.add({
        severity: "success",
        summary: tl("บิลพัก", "Held bill", "ບິນພັກ"),
        detail: tl("ลบบิลพักแล้ว", "Held bill deleted", "ລຶບບິນພັກແລ້ວ"),
        life: 1600,
      });
    },
  });
}

function removeAllHeldBills() {
  if (!heldBills.value.length) return;
  openSaveDialog({
    type: "warn",
    title: tl("ยืนยันลบบิลพักทั้งหมด", "Confirm delete all held bills", "ຢືນຢັນລຶບບິນພັກທັງໝົດ"),
    message: tl("ต้องการลบบิลพักทั้งหมดในเครื่องนี้ใช่หรือไม่", "Delete all held bills on this device?", "ຕ້ອງການລຶບບິນພັກທັງໝົດໃນເຄື່ອງນີ້ຫຼືບໍ?"),
    primaryLabel: tl("ลบทั้งหมด", "Delete all", "ລຶບທັງໝົດ"),
    primarySeverity: "danger",
    primaryAction: () => {
      clearHeldBills();
      refreshHeldBills();
      toast.add({
        severity: "success",
        summary: tl("บิลพัก", "Held bill", "ບິນພັກ"),
        detail: tl("ลบบิลพักทั้งหมดแล้ว", "All held bills deleted", "ລຶບບິນພັກທັງໝົດແລ້ວ"),
        life: 1600,
      });
    },
  });
}

async function holdCurrentBill() {
  if (!canHoldBill.value || holdingBill.value) return;
  holdingBill.value = true;
  try {
    const saved = saveCurrentDraftAsHeldBill();
    toast.add({
      severity: "success",
      summary: tl("พักบิลแล้ว", "Held bill saved", "ພັກບິນແລ້ວ"),
      detail: saved.id,
      life: 1800,
    });
    await newDocument();
  } catch (error) {
    openSaveDialog({
      type: "error",
      title: tl("พักบิลไม่สำเร็จ", "Failed to hold bill", "ພັກບິນບໍ່ສຳເລັດ"),
      message: error.message || tl("ไม่สามารถบันทึกบิลพักได้", "Unable to save held bill", "ບໍ່ສາມາດບັນທຶກບິນພັກໄດ້"),
    });
  } finally {
    holdingBill.value = false;
  }
}

onMounted(async () => {
  window.addEventListener("keydown", handleSaleHotkeys);
  window.addEventListener(saleLayoutPreferenceEvent, onSaleLayoutPreferenceEvent);
  window.addEventListener("storage", onSaleLayoutPreferenceStorage);
  applySaleLayoutPreferences();
  loading.value = true;
  errorMsg.value = "";
  try {
    saleCode.value = authStore.employee?.user_code || "";
    const defaultEmployee = await defaultEmployeeNames();
    saleName.value = defaultEmployee.name_1;
    saleName2.value = defaultEmployee.name_2;
    cashierCode.value = authStore.employee?.user_code || "";
    docTime.value = localTimeHHMM();
    // โหลด master lists สำหรับ tab เพิ่มเติม
    const [branchData, docGroupData, sideData, departmentData, allocateData, projectData, jobData, saleGroupData] = await Promise.allSettled([
      getBranchList(),
      getDocGroupList(),
      getSideList(),
      getDepartmentList(),
      getAllocateList(),
      getProjectList(),
      getJobList(),
      getSaleGroupList(),
    ]);
    branchList.value = branchData.status === "fulfilled" ? branchData.value : [];
    docGroupList.value = docGroupData.status === "fulfilled" ? docGroupData.value : [];
    sideList.value = sideData.status === "fulfilled" ? sideData.value : [];
    departmentList.value = departmentData.status === "fulfilled" ? departmentData.value : [];
    allocateList.value = allocateData.status === "fulfilled" ? allocateData.value : [];
    projectList.value = projectData.status === "fulfilled" ? projectData.value : [];
    jobList.value = jobData.status === "fulfilled" ? jobData.value : [];
    saleGroupList.value = saleGroupData.status === "fulfilled" ? saleGroupData.value : [];
    branchCode.value = posStore.selectedPos?.branch_code || "";
    inquiryType.value = defaultSaleInquiryType();
    // vatType.value = defaultSaleVatType();
    const [formats, paymentMasters, shipmentTransportTypes] = await Promise.all([
      getSaleDocFormatList(),
      getPaymentMasterLists().catch(async () => ({
        pass_books: await getPassBookList().catch(() => []),
        credit_types: await getCreditTypeList().catch(() => []),
      })),
      getShipmentTransportTypeList().catch(() => []),
    ]);
    void loadCustomerDisplayMediaForSale();
    warehouseOptions.value = await getWarehouseList({
      branch_code: posStore.selectedPos?.branch_code || "",
    }).catch(() => []);
    const defaultWhCode = defaultSaleWarehouseCode();
    if (defaultWhCode) void ensureShelfOptions(defaultWhCode);
    docFormats.value = formats;
    passBooks.value = (paymentMasters.pass_books || []).map((row) => ({
      ...row,
      label: passBookDisplayLabel(row),
    }));
    creditTypes.value = (paymentMasters.credit_types || []).map((row) => ({
      ...row,
      label: row.name_1 || row.name || row.code,
    }));
    pettyCashList.value = (paymentMasters.petty_cash || []).map((row) => ({
      ...row,
      label: `${row.code || ""} ${row.name_1 || ""}`.trim(),
    }));
    incomeTypes.value = (paymentMasters.income_list || []).map((row) => ({
      ...row,
      label: `${row.code || ""} ${row.name_1 || ""}`.trim(),
    }));
    expenseTypes.value = (paymentMasters.expense_list || []).map((row) => ({
      ...row,
      label: `${row.code || ""} ${row.name_1 || ""}`.trim(),
    }));
    currencyTypes.value = (paymentMasters.currencies || []).map((row) => ({
      ...row,
      label: `${row.code || ""} ${row.name_1 || ""}`.trim(),
    }));
    walletTypes.value = (paymentMasters.wallets || []).map((row) => ({
      ...row,
      label: `${row.code || ""} ${row.name_1 || ""}`.trim(),
    }));
    transportTypes.value = (paymentMasters.transport_types || []).map((row) => ({
      ...row,
      label: `${row.code || ""} ${row.name_1 || ""}`.trim(),
    }));
    shipmentTransportTypeOptions.value = (shipmentTransportTypes || []).map((row) => ({
      ...row,
      label: `${row.code || ""} ${row.name_1 || ""}`.trim(),
    }));
    if (!transportType.value?.code && shipmentTransportTypeOptions.value.length) {
      const pickOption = shipmentTransportTypeOptions.value.find(
        (row) =>
          String(row.code || "")
            .trim()
            .toUpperCase() === "PICK",
      );
      updateShipmentTransportType(pickOption?.code || shipmentTransportTypeOptions.value[0].code);
    }
    shippingLabels.value = mapShippingLabelOptions(paymentMasters.shipping_labels || []);
    glAccounts.value = (paymentMasters.gl_accounts || []).map((row) => ({
      ...row,
      label: `${row.code || ""} ${row.name_1 || ""}`.trim(),
    }));
    const masterOptions = paymentMasters.options || {};
    paymentMasterOptions.value = {
      multi_currency: 0,
      input_credit_card_charge: 0,
      coupon_full_amount: 0,
      inventory_gl_post: "",
      home_currency: "",
      currency_exchange_decimal: 2,
      summary_currency_codes: normalizeSummaryCurrencyCodes(paymentMasters.summary_currency_codes || masterOptions.summary_currency_codes),
      ...masterOptions,
    };
    paymentMasterOptions.value.summary_currency_codes = normalizeSummaryCurrencyCodes(paymentMasters.summary_currency_codes || paymentMasterOptions.value.summary_currency_codes);
    inventoryGlPostMode.value = "system";

    docFormatCode.value = defaultSaleDocFormatCode();
    documentCurrency.value = defaultDocumentCurrency();
    setExchangeRateValue(documentExchangeRate, documentExchangeRateText, documentCurrency.value?.exchange_rate_present, 1);
    applyPaymentCurrency(transferCurrency, transferExchangeRate, documentCurrency.value?.code || "THB");
    applyPaymentCurrency(creditCurrency, creditExchangeRate, documentCurrency.value?.code || "THB");
    applyPaymentCurrency(chequeCurrency, chequeExchangeRate, documentCurrency.value?.code || "THB");
    if (String(route.query.doc_no || "").trim()) await loadShippingLabelOptions();
    else await autoFillShipmentFromCustomerMaster();
    await refreshCustomerCredit();
    await loadEditDocumentFromQuery(route.query.doc_no);
    if (!isViewOnly.value && posStore.deviceConfig?.customer_display_auto_open && customerDisplayAvailable.value) {
      const displayStatus = await window.bizsuitCustomerDisplay?.status?.().catch(() => null);
      if (displayStatus?.open) {
        syncCustomerDisplayState();
      } else {
        void openCustomerDisplay({ silent: true });
      }
    }
  } catch (error) {
    errorMsg.value = error.message || tl("โหลดข้อมูลหน้าขายไม่สำเร็จ", "Failed to load sale screen data", "ໂຫຼດຂໍ້ມູນໜ້າຂາຍບໍ່ສຳເລັດ");
  } finally {
    loading.value = false;
    focusBarcodeInput();
  }
});

onBeforeUnmount(() => {
  clearProductSearchTimer();
  cancelProductResultBalanceHydration({ resetLoading: true });
  window.removeEventListener("keydown", handleSaleHotkeys);
  window.removeEventListener(saleLayoutPreferenceEvent, onSaleLayoutPreferenceEvent);
  window.removeEventListener("storage", onSaleLayoutPreferenceStorage);
  clearLaoQrPoll();
  clearLaoQrCountdown();
  if (customerDisplaySyncTimer) {
    clearTimeout(customerDisplaySyncTimer);
    customerDisplaySyncTimer = null;
  }
  syncCustomerDisplayIdleState();
  if (shipmentProvinceSearchTimer) clearTimeout(shipmentProvinceSearchTimer);
  if (shipmentAmperSearchTimer) clearTimeout(shipmentAmperSearchTimer);
  if (shipmentTambonSearchTimer) clearTimeout(shipmentTambonSearchTimer);
  if (shippingLabelSearchTimer) clearTimeout(shippingLabelSearchTimer);
});

watch(
  customerDisplayState,
  () => {
    syncCustomerDisplayState();
  },
  { deep: true, immediate: true },
);

watch(
  () => route.query.doc_no,
  async (value) => {
    await loadEditDocumentFromQuery(value);
  },
);

function selectWalkIn() {
  const sameCustomer = String(custCode.value || "").trim() === defaultCustomerCode;
  custCode.value = defaultCustomerCode;
  memberCode.value = "";
  custName.value = defaultCustomerName.value;
  custSearch.value = "";
  custResults.value = [];
  customerDialogVisible.value = false;
  if (sameCustomer && !hydratingEditDocument.value) void autoFillShipmentFromCustomerMaster();
}

function openCustomerDialog() {
  if (documentLocked.value) return;
  custSearch.value = "";
  custResults.value = [];
  customerDialogFilter.value = "all";
  customerDialogVisible.value = true;
}

function customerHasMember(customer) {
  return String(customer?.member_code || customer?.dealer_code || "").trim().length > 0;
}

function searchCustomers(value) {
  clearTimeout(custTimer);
  const query = String(value || "").trim();
  if (!query) {
    custResults.value = [];
    return;
  }
  custTimer = setTimeout(async () => {
    custLoading.value = true;
    try {
      custResults.value = await getCustomerList(query);
    } finally {
      custLoading.value = false;
    }
  }, 250);
}

async function loadCustomers() {
  clearTimeout(custTimer);
  const query = String(custSearch.value || "").trim();
  if (!query) {
    custResults.value = [];
    return;
  }
  custLoading.value = true;
  try {
    custResults.value = await getCustomerList(query);
  } finally {
    custLoading.value = false;
  }
}

async function syncCustomerNameFromMaster(code = "") {
  const targetCode = String(code || "").trim();
  if (!targetCode) return;
  if (targetCode === defaultCustomerCode) {
    custName.value = defaultCustomerName.value;
    return;
  }
  try {
    const list = await getCustomerList(targetCode);
    const exact = list.find((row) => String(row.code || "").trim() === targetCode) || list[0];
    const name = String(exact?.name || exact?.name_1 || "").trim();
    if (name) custName.value = name;
  } catch {
    // keep current name if lookup fails
  }
}

function selectCustomer(customer) {
  const nextCode = String(customer.code || "").trim();
  const sameCustomer = String(custCode.value || "").trim() === nextCode;
  custCode.value = nextCode;
  memberCode.value = String(customer.member_code || customer.dealer_code || "").trim();
  custName.value = customer.name || customer.name_1 || "";
  custSearch.value = "";
  custResults.value = [];
  customerDialogVisible.value = false;
  if (sameCustomer && !hydratingEditDocument.value) void autoFillShipmentFromCustomerMaster();
}

// ดึง contactors จากลูกค้าที่เลือก
watch(custCode, async (newCode) => {
  const shouldAutoFillShipment = !hydratingEditDocument.value;
  if (!newCode) {
    contactorList.value = [];
    contactor.value = "";
    if (shouldAutoFillShipment) await autoFillShipmentFromCustomerMaster();
    else await loadShippingLabelOptions();
    return;
  }
  try {
    const [contactors, labels] = await Promise.all([getCustomerContactorList(newCode), loadShippingLabelOptions()]);
    contactorList.value = contactors;
    contactor.value = "";
    if (shouldAutoFillShipment) {
      const label = preferredShippingLabel(labels);
      if (label) applyShippingLabel(label);
      else clearShipmentMasterFields();
    }
  } catch (error) {
    contactorList.value = [];
    if (shouldAutoFillShipment) await autoFillShipmentFromCustomerMaster().catch(() => {});
    else await loadShippingLabelOptions().catch(() => {});
  }
});

async function refreshCustomerCredit() {
  const code = String(custCode.value || "").trim();
  customerCredit.value = null;
  customerCreditError.value = "";
  creditDay.value = 0;
  dueDate.value = docDate.value;
  if (!code) return;
  customerCreditLoading.value = true;
  try {
    const [credit, totalBalance] = await Promise.all([getCustomerCredit(code), getCustomerTotalBalance(code).catch(() => 0)]);
    customerCredit.value = { ...(credit || {}), total_balance: totalBalance };
    creditDay.value = toNumber(credit?.credit_day);
    dueDate.value = credit?.credit_date ? String(credit.credit_date).slice(0, 10) : addDaysISO(docDate.value, creditDay.value);
    vatSaleTaxNo.value = String(credit?.tax_id || credit?.card_id || "").trim();
    vatSaleBranchCode.value = String(credit?.branch_code || "").trim();
    ensureVatDefaultRow();
    applyVatCustomerDefaults();
  } catch (error) {
    customerCreditError.value = error.message || tl("โหลดข้อมูลเครดิตลูกค้าไม่สำเร็จ", "Failed to load customer credit", "ໂຫຼດຂໍ້ມູນເຄຣດິດລູກຄ້າບໍ່ສຳເລັດ");
    dueDate.value = addDaysISO(docDate.value, creditDay.value);
  } finally {
    customerCreditLoading.value = false;
  }
}

function resetShipment() {
  const transportCode = String(shipment.value.transport_code || transportType.value?.code || "").trim();
  shipment.value = {
    transport_name: "",
    transport_address: "",
    transport_telephone: "",
    transport_fax: "",
    transport_tambon: "",
    transport_amper: "",
    transport_province: "",
    transport_country: "",
    zipcode: "",
    transport_code: transportCode,
    destination: "",
    remark: "",
    remark_2: "",
    ship_code: "",
    logistic_area: "",
    latitude: 0,
    longitude: 0,
  };
  selectedShippingLabel.value = null;
  provinceOptions.value = [];
  amperOptions.value = [];
  tambonOptions.value = [];
  logisticAreaOptions.value = [];
}

function clearShipmentMasterFields() {
  resetShipment();
}

function applyShippingLabel(label) {
  selectedShippingLabel.value = label;
  if (!label) return;
  const transportCode = String(label.transport_type || shipment.value.transport_code || transportType.value?.code || "").trim();
  hydratingShipment.value = true;
  shipment.value = {
    ...shipment.value,
    transport_name: label.name_1 || "",
    transport_address: label.address || "",
    transport_telephone: label.telephone || "",
    transport_fax: label.fax || "",
    transport_tambon: label.tambon || "",
    transport_amper: label.amper || "",
    transport_province: label.province || "",
    transport_country: label.country || "",
    zipcode: label.zip_code || "",
    transport_code: transportCode,
    ship_code: label.ship_code || "",
    logistic_area: label.logistic_area || "",
    latitude: toNumber(label.latitude),
    longitude: toNumber(label.longitude),
    remark: label.remark_1 || shipment.value.remark,
    remark_2: label.remark_2 || shipment.value.remark_2,
  };
  if (transportCode) updateShipmentTransportType(transportCode);
  void nextTick(async () => {
    try {
      await syncShipmentLocationMasterSelection();
    } finally {
      hydratingShipment.value = false;
    }
  });
}

function mapShippingLabelOptions(rows = []) {
  return (rows || []).map((row) => ({
    ...row,
    label: `${row.ship_code || ""} ${row.name_1 || ""}`.trim() || row.address || row.telephone || "-",
  }));
}

async function loadShippingLabelOptions(search = "") {
  const selectedCustCode = String(custCode.value || "").trim();
  shippingLabelLoading.value = true;
  try {
    const rows = await getShippingLabelList({ cust_code: selectedCustCode, search });
    const labels = mapShippingLabelOptions(rows);
    shippingLabels.value = labels;
    return labels;
  } catch {
    shippingLabels.value = [];
    return [];
  } finally {
    shippingLabelLoading.value = false;
  }
}

function preferredShippingLabel(labels = shippingLabels.value) {
  const selectedCustCode = String(custCode.value || "").trim();
  return labels.find((row) => selectedCustCode && String(row.cust_code || "").trim() === selectedCustCode) || labels[0] || null;
}

async function autoFillShipmentFromCustomerMaster() {
  const labels = await loadShippingLabelOptions();
  const label = preferredShippingLabel(labels);
  if (label) {
    applyShippingLabel(label);
    return label;
  }
  selectedShippingLabel.value = null;
  clearShipmentMasterFields();
  return null;
}

function mapLocationMasterOptions(rows = []) {
  return (rows || [])
    .map((row) => ({
      ...row,
      label: `${row.code || ""} ${row.name_1 || ""}`.trim() || row.code || "",
      value: String(row.code || "").trim(),
    }))
    .filter((row) => row.value);
}

async function loadProvinceOptions(search = "") {
  shipmentMasterLoading.value.province = true;
  try {
    const rows = await getProvinceList(search);
    provinceOptions.value = mapLocationMasterOptions(rows);
  } catch {
    provinceOptions.value = [];
  } finally {
    shipmentMasterLoading.value.province = false;
  }
}

async function loadAmperOptions(provinceCode, search = "") {
  const province = String(provinceCode || "").trim();
  if (!province) {
    amperOptions.value = [];
    return;
  }
  shipmentMasterLoading.value.amper = true;
  try {
    const rows = await getAmperList({ province, search });
    amperOptions.value = mapLocationMasterOptions(rows);
  } catch {
    amperOptions.value = [];
  } finally {
    shipmentMasterLoading.value.amper = false;
  }
}

async function loadTambonOptions(provinceCode, amperCode, search = "") {
  const province = String(provinceCode || "").trim();
  const amper = String(amperCode || "").trim();
  if (!province || !amper) {
    tambonOptions.value = [];
    return;
  }
  shipmentMasterLoading.value.tambon = true;
  try {
    const rows = await getTambonList({ province, amper, search });
    tambonOptions.value = mapLocationMasterOptions(rows).map((row) => ({
      ...row,
      zip_code: String(row.zip_code || "").trim(),
    }));
  } catch {
    tambonOptions.value = [];
  } finally {
    shipmentMasterLoading.value.tambon = false;
  }
}

async function loadLogisticAreaOptions(search = "") {
  shipmentMasterLoading.value.logisticArea = true;
  try {
    const rows = await getLogisticAreaList(search);
    logisticAreaOptions.value = mapLocationMasterOptions(rows);
  } catch {
    logisticAreaOptions.value = [];
  } finally {
    shipmentMasterLoading.value.logisticArea = false;
  }
}

function extractSelectFilterText(event) {
  if (!event) return "";
  if (typeof event === "string") return event.trim();
  if (typeof event.value === "string") return event.value.trim();
  if (typeof event.filter === "string") return event.filter.trim();
  if (typeof event.query === "string") return event.query.trim();
  if (typeof event.originalEvent?.target?.value === "string") return event.originalEvent.target.value.trim();
  return "";
}

function onProvinceFilter(event) {
  const keyword = extractSelectFilterText(event);
  if (shipmentProvinceSearchTimer) clearTimeout(shipmentProvinceSearchTimer);
  shipmentProvinceSearchTimer = setTimeout(() => {
    loadProvinceOptions(keyword);
  }, 220);
}

function onAmperFilter(event) {
  const keyword = extractSelectFilterText(event);
  if (shipmentAmperSearchTimer) clearTimeout(shipmentAmperSearchTimer);
  shipmentAmperSearchTimer = setTimeout(() => {
    loadAmperOptions(shipment.value.transport_province, keyword);
  }, 220);
}

function onTambonFilter(event) {
  const keyword = extractSelectFilterText(event);
  if (shipmentTambonSearchTimer) clearTimeout(shipmentTambonSearchTimer);
  shipmentTambonSearchTimer = setTimeout(() => {
    loadTambonOptions(shipment.value.transport_province, shipment.value.transport_amper, keyword);
  }, 220);
}

function onLogisticAreaFilter(event) {
  const keyword = extractSelectFilterText(event);
  if (shipmentLogisticAreaSearchTimer) clearTimeout(shipmentLogisticAreaSearchTimer);
  shipmentLogisticAreaSearchTimer = setTimeout(() => {
    loadLogisticAreaOptions(keyword);
  }, 220);
}

function onShippingLabelFilter(event) {
  const keyword = extractSelectFilterText(event);
  if (shippingLabelSearchTimer) clearTimeout(shippingLabelSearchTimer);
  shippingLabelSearchTimer = setTimeout(() => {
    loadShippingLabelOptions(keyword);
  }, 220);
}

async function syncShipmentLocationMasterSelection() {
  const province = String(shipment.value.transport_province || "").trim();
  const amper = String(shipment.value.transport_amper || "").trim();
  const logisticArea = String(shipment.value.logistic_area || "").trim();
  await Promise.all([loadProvinceOptions(), loadLogisticAreaOptions(logisticArea)]);
  await loadAmperOptions(province);
  await loadTambonOptions(province, amper);
}

function applyTambonZipcode() {
  if (String(shipment.value.zipcode || "").trim()) return;
  const tambonCode = String(shipment.value.transport_tambon || "").trim();
  if (!tambonCode) return;
  const tambon = tambonOptions.value.find((row) => String(row.value || "") === tambonCode);
  const zipCode = String(tambon?.zip_code || "").trim();
  if (zipCode) shipment.value.zipcode = zipCode;
}

function vatEffectiveFromDate(value) {
  const date = value ? new Date(value) : new Date(docDate.value);
  if (!Number.isFinite(date.getTime())) {
    const fallback = new Date(docDate.value);
    return { period: fallback.getMonth() + 1, year: fallback.getFullYear() + 543 };
  }
  return { period: date.getMonth() + 1, year: date.getFullYear() + 543 };
}

function makeVatRow(seed = {}, prevRow = null) {
  const vatDate = seed.vat_date || prevRow?.vat_date || taxDocDate.value || docDate.value;
  const effective = vatEffectiveFromDate(vatDate);
  const baseAmount = toNumber(seed.base_caltax_amount, prevRow ? toNumber(prevRow.base_caltax_amount) : totals.value.beforeVat);
  const taxRate = toNumber(seed.tax_rate, prevRow ? toNumber(prevRow.tax_rate) : toNumber(vatRate.value, 7));
  const vatAmount = toNumber(seed.amount, rnd((baseAmount * taxRate) / 100));
  const customerTaxNo = String(customerCredit.value?.tax_id || customerCredit.value?.card_id || vatSaleTaxNo.value || "").trim();
  const customerBranchType = toNumber(customerCredit.value?.branch_type, 0);
  const customerBranchCode = String(customerCredit.value?.branch_code || vatSaleBranchCode.value || "").trim();
  return {
    id: seed.id || makeLineId(),
    vat_date: vatDate,
    vat_number: String(seed.vat_number || prevRow?.vat_number || taxDocNo.value || (editMode.value ? nextDocNo.value : "") || "").trim(),
    vat_effective_period: toNumber(seed.vat_effective_period, effective.period),
    vat_effective_year: toNumber(seed.vat_effective_year, effective.year),
    description: String(seed.description || prevRow?.description || vatSaleDescription.value || "").trim(),
    tax_group: String(seed.tax_group || prevRow?.tax_group || "").trim(),
    base_caltax_amount: baseAmount,
    tax_rate: taxRate,
    amount: vatAmount,
    except_tax_amount: toNumber(seed.except_tax_amount, prevRow ? toNumber(prevRow.except_tax_amount) : totals.value.totalExceptVat),
    vat_type: toNumber(seed.vat_type, prevRow ? toNumber(prevRow.vat_type) : 0),
    is_add: toNumber(seed.is_add, prevRow ? toNumber(prevRow.is_add) : 0),
    ar_name: String(seed.ar_name || prevRow?.ar_name || custName.value || "").trim(),
    tax_no: String(seed.tax_no || prevRow?.tax_no || customerTaxNo).trim(),
    branch_type: toNumber(seed.branch_type, prevRow ? toNumber(prevRow.branch_type) : customerBranchType),
    branch_code: String(seed.branch_code || prevRow?.branch_code || customerBranchCode).trim(),
    manual_add: toNumber(seed.manual_add),
  };
}

function syncVatRowDerivedFields(row) {
  const effective = vatEffectiveFromDate(row.vat_date || docDate.value);
  row.vat_effective_period = effective.period;
  row.vat_effective_year = effective.year;
  if (vatAutoCalc.value) {
    row.amount = rnd((toNumber(row.base_caltax_amount) * toNumber(row.tax_rate)) / 100);
  }
}

function applyVatCustomerDefaults() {
  if (!vatRows.value.length) return;
  const row = vatRows.value[0];
  if (toNumber(row.manual_add) !== 0) return;
  row.ar_name = String(custName.value || defaultCustomerName.value || "").trim();
  row.tax_no = String(customerCredit.value?.tax_id || customerCredit.value?.card_id || vatSaleTaxNo.value || "").trim();
  row.branch_type = toNumber(customerCredit.value?.branch_type, row.branch_type);
  row.branch_code = row.branch_type === 1 ? String(customerCredit.value?.branch_code || vatSaleBranchCode.value || "").trim() : "";
}

function ensureVatDefaultRow() {
  if (!vatCreateDefaultRow.value || vatRows.value.length || documentLocked.value) return;
  vatRows.value.push(makeVatRow({}));
}

function addVatRow() {
  if (documentLocked.value) return;
  const prevRow = vatRows.value.length ? vatRows.value[vatRows.value.length - 1] : null;
  const nextRow = makeVatRow({}, vatAutoInput.value ? prevRow : null);
  if (vatAutoInput.value && prevRow && vatAutoNumber.value && prevRow.vat_number) {
    nextRow.vat_number = autoRunningNumber(prevRow.vat_number);
  }
  vatRows.value.push(nextRow);
}

function removeVatRow(id) {
  if (documentLocked.value) return;
  vatRows.value = vatRows.value.filter((row) => row.id !== id);
}

function updateVatDate(row, value) {
  row.vat_date = value || docDate.value;
  syncVatRowDerivedFields(row);
}

function updateVatBase(row, value) {
  row.base_caltax_amount = toNumber(value);
  syncVatRowDerivedFields(row);
}

function updateVatRate(row, value) {
  row.tax_rate = toNumber(value);
  syncVatRowDerivedFields(row);
}

function updateVatArName(row, value) {
  row.ar_name = String(value || "").trim();
  row.manual_add = 1;
}

function updateVatTaxNo(row, value) {
  row.tax_no = String(value || "").trim();
  row.manual_add = 1;
}

function updateVatBranchType(row, value) {
  row.branch_type = toNumber(value);
  if (row.branch_type !== 1) {
    row.branch_code = "";
  }
  row.manual_add = 1;
}

function updateVatBranchCode(row, value) {
  row.branch_code = String(value || "").trim();
  row.manual_add = 1;
}

function autoRunningNumber(value) {
  const source = String(value || "");
  const match = source.match(/(\d+)(?!.*\d)/);
  if (!match) return source;
  const digits = match[1];
  const next = String(parseInt(digits, 10) + 1).padStart(digits.length, "0");
  return `${source.slice(0, match.index)}${next}${source.slice(match.index + digits.length)}`;
}

function makeWhtHeader(seed = {}) {
  return {
    id: seed.id || makeLineId(),
    tax_doc_no: String(seed.tax_doc_no || taxDocNo.value || (editMode.value ? nextDocNo.value : "") || "").trim(),
    due_date: seed.due_date || docDate.value,
    cust_code: String(seed.cust_code || custCode.value || "").trim(),
    cust_name: String(seed.cust_name || custName.value || "").trim(),
    cust_address: String(seed.cust_address || "").trim(),
    cust_tax_type: toNumber(seed.cust_tax_type),
    tax_number: String(seed.tax_number || vatSaleTaxNo.value || "").trim(),
    card_number: String(seed.card_number || vatSaleTaxNo.value || "").trim(),
    details: Array.isArray(seed.details)
      ? seed.details.map((detail) => ({
          id: detail.id || makeLineId(),
          line_number: toNumber(detail.line_number),
          income_type: String(detail.income_type || "").trim(),
          amount: toNumber(detail.amount),
          tax_rate: toNumber(detail.tax_rate),
          tax_value: toNumber(detail.tax_value),
        }))
      : [],
  };
}

function ensureSelectedWhtHeader() {
  if (selectedWhtHeader.value) return selectedWhtHeader.value;
  if (!whtHeaders.value.length) {
    const header = makeWhtHeader();
    whtHeaders.value.push(header);
    selectedWhtHeaderId.value = header.id;
    return header;
  }
  selectedWhtHeaderId.value = whtHeaders.value[0].id;
  return whtHeaders.value[0];
}

function addWhtHeader() {
  if (documentLocked.value) return;
  const header = makeWhtHeader({ tax_doc_no: "" });
  whtHeaders.value.push(header);
  selectedWhtHeaderId.value = header.id;
}

function removeWhtHeader(id) {
  if (documentLocked.value) return;
  const index = whtHeaders.value.findIndex((row) => row.id === id);
  if (index === -1) return;
  whtHeaders.value.splice(index, 1);
  if (!whtHeaders.value.length) {
    selectedWhtHeaderId.value = "";
    return;
  }
  if (selectedWhtHeaderId.value === id) {
    const fallback = whtHeaders.value[Math.max(0, index - 1)] || whtHeaders.value[0];
    selectedWhtHeaderId.value = fallback.id;
  }
}

function addWhtDetailRow() {
  const header = ensureSelectedWhtHeader();
  if (documentLocked.value || !header) return;
  const amount = toNumber(whtAmount.value);
  const rate = toNumber(whtRate.value);
  if (amount <= 0 || rate < 0) return;
  const detail = {
    id: makeLineId(),
    line_number: header.details.length,
    income_type: String(whtIncomeType.value || "").trim(),
    amount,
    tax_rate: rate,
    tax_value: rnd(amount * (rate / 100)),
  };
  header.details.push(detail);
  whtIncomeType.value = "";
  whtAmount.value = 0;
  whtRate.value = 0;
}

function removeWhtDetailRow(id) {
  if (documentLocked.value || !selectedWhtHeader.value) return;
  selectedWhtHeader.value.details = selectedWhtHeader.value.details.filter((row) => row.id !== id);
  selectedWhtHeader.value.details.forEach((row, index) => {
    row.line_number = index;
  });
}

function updateWhtDetailAmount(row, value) {
  row.amount = toNumber(value);
  row.tax_value = rnd(toNumber(row.amount) * (toNumber(row.tax_rate) / 100));
}

function updateWhtDetailRate(row, value) {
  row.tax_rate = toNumber(value);
  row.tax_value = rnd(toNumber(row.amount) * (toNumber(row.tax_rate) / 100));
}

function updateWhtDetailTaxValue(row, value) {
  row.tax_value = toNumber(value);
  if (toNumber(row.amount) > 0) {
    row.tax_rate = rnd((toNumber(row.tax_value) * 100) / toNumber(row.amount));
  }
}

function addManualGlRow() {
  if (documentLocked.value || !glManualMode.value || !manualGlAccount.value) return;
  const debit = toNumber(manualGlDebit.value);
  const credit = toNumber(manualGlCredit.value);
  if (debit <= 0 && credit <= 0) return;
  manualGlRows.value.push({
    id: makeLineId(),
    account_code: manualGlAccount.value.code || "",
    account_name: manualGlAccount.value.name_1 || "",
    debit,
    credit,
  });
  manualGlAccount.value = null;
  manualGlDebit.value = 0;
  manualGlCredit.value = 0;
}

function removeManualGlRow(id) {
  if (documentLocked.value || !glManualMode.value) return;
  manualGlRows.value = manualGlRows.value.filter((row) => row.id !== id);
}

function resolvePaymentEntryLabel(docType, row = {}) {
  const transNumber = String(row.trans_number || "").trim();
  if (docType === 1) {
    const passBook = passBooks.value.find((item) => (item.book_code || item.pass_book_code || item.code || "") === (row.pass_book_code || transNumber));
    console.log(passBook);
    return String(passBook?.book_name || passBook?.name || row.book_name || transNumber || t("sell.transfer")).trim();
  }
  if (docType === 2) return t("sell.cheque");
  if (docType === 3) {
    const credit = creditTypes.value.find((item) => (item.code || item.credit_card_type || "") === String(row.credit_card_type || "").trim());
    return credit?.label || t("sell.creditCard");
  }
  if (docType === 4) {
    const petty = pettyCashList.value.find((item) => (item.code || "") === transNumber);
    return petty?.label || transNumber || t("payment.pettyCash");
  }
  if (docType === 5) return transNumber || t("sell.deposit");
  if (docType === 6) return transNumber || tl("เงินมัดจำ", "Deposit", "ເງິນມັດຈຳ");
  if (docType === 9) return transNumber || t("sell.coupon");
  if (docType === 11) {
    const expense = expenseTypes.value.find((item) => (item.code || "") === transNumber);
    return expense?.label || transNumber || t("sell.otherExpense");
  }
  if (docType === 12) {
    const income = incomeTypes.value.find((item) => (item.code || "") === transNumber);
    return income?.label || transNumber || t("sell.otherIncome");
  }
  if (docType === 19) {
    const currency = currencyTypes.value.find((item) => (item.code || "") === String(row.currency_code || transNumber).trim());
    return currency?.label || t("sell.otherCurrency");
  }
  if (docType === 21) {
    const wallet = walletTypes.value.find((item) => (item.code || "") === String(row.credit_card_type || "").trim());
    return wallet?.label || "Wallet";
  }
  return transNumber || t("payment.receivePayment");
}

function mapPaymentDetailRowToEntry(row = {}) {
  const docType = toNumber(row.doc_type);
  const typeMap = {
    1: "transfer",
    2: "cheque",
    3: "credit",
    4: "petty",
    5: "deposit",
    6: "deposit_money",
    9: "coupon",
    11: "expense",
    12: "income",
    19: "currency",
    21: "wallet",
  };
  const remark = String(row.remark || "").trim();
  const type = docType === 1 && remark ? "credit_transfer" : typeMap[docType];
  if (!type) return null;

  const amount = docType === 19 ? toNumber(row.sum_amount, toNumber(row.amount)) : toNumber(row.amount, toNumber(row.sum_amount));

  return {
    id: makeLineId(),
    type,
    label: type === "credit_transfer" ? creditTransferCardLabel(remark) : resolvePaymentEntryLabel(docType, row),
    amount,
    details: {
      doc_type: docType,
      trans_number: String(row.trans_number || "").trim(),
      pass_book_code: String(row.pass_book_code || "").trim(),
      book_name: String(row.book_name || "").trim(),
      book_number: String(row.book_number || "").trim(),
      bank_code: String(row.bank_code || "").trim(),
      bank_branch: String(row.bank_branch || "").trim(),
      credit_card_type: String(row.credit_card_type || "").trim(),
      no_approved: String(row.no_approved || "").trim(),
      ref1: String(row.ref1 || "").trim(),
      ref2: String(row.ref2 || "").trim(),
      doc_ref: String(row.doc_ref || "").trim(),
      doc_date_ref: String(row.doc_date_ref || "").slice(0, 10),
      chq_due_date: String(row.chq_due_date || "").slice(0, 10),
      description: String(row.description || "").trim(),
      remark,
      currency_code: String(row.currency_code || "").trim(),
      exchange_rate: toNumber(row.exchange_rate, 1),
      amount: toNumber(row.amount),
      sum_amount: toNumber(row.sum_amount),
      charge: toNumber(row.charge),
      balance_amount: toNumber(row.balance_amount),
      sum_amount_2: toNumber(row.sum_amount_2),
      amount_2: toNumber(row.amount_2),
      charge_2: toNumber(row.charge_2),
      exchange_rate_old: toNumber(row.exchange_rate_old),
      lost_profit_exchange_amount: toNumber(row.lost_profit_exchange_amount),
      trans_number_type: toNumber(row.trans_number_type),
      ap_ar_type: toNumber(row.ap_ar_type),
      chq_on_hand: toNumber(row.chq_on_hand),
    },
  };
}

function hydratePaymentsFromDetail(detail = {}) {
  const rows = Array.isArray(detail.payment_detail) ? detail.payment_detail : [];
  const entries = rows.map((row) => mapPaymentDetailRowToEntry(row)).filter(Boolean);
  paymentEntries.value = entries;
  hydratePaymentFormStateFromEntries(entries);
  const cashAmount = toNumber(detail.header?.cash_amount);
  const payCashAmount = toNumber(detail.header?.pay_cash_amount);
  setCashAmountFromBaht(payCashAmount || cashAmount + toNumber(detail.header?.money_change) || cashAmount);
  paymentReviewNeeded.value = false;
  paymentReviewTotal.value = entries.length ? totalDue.value : null;
}

function resetPaymentFormState() {
  resetExchangeRateEditAuthorization();
  activePayType.value = "cash";
  setCashAmountFromBaht(0, defaultCashCurrencyCode.value);
  transferInputAmount.value = 0;
  transferCurrency.value = defaultDocumentCurrency();
  setExchangeRateValue(transferExchangeRate, transferExchangeRateText, paymentCurrencyRate(transferCurrency.value, paymentCurrencyCode(transferCurrency.value) === "THB" ? 1 : 0), 0);
  transferPassBook.value = null;
  transferDate.value = todayISO();
  transferChargePercent.value = 0;
  creditTransferCardRemark.value = "";
  creditTransferApprovalRemark.value = "";
  creditInputAmount.value = 0;
  creditCurrency.value = defaultDocumentCurrency();
  setExchangeRateValue(creditExchangeRate, creditExchangeRateText, paymentCurrencyRate(creditCurrency.value, paymentCurrencyCode(creditCurrency.value) === "THB" ? 1 : 0), 0);
  creditType.value = null;
  creditCardNumber.value = "";
  creditApprovalNo.value = "";
  chequePassBook.value = null;
  chequeNumber.value = "";
  chequeDueDate.value = todayISO();
  chequeAmount.value = 0;
  chequeCurrency.value = defaultDocumentCurrency();
  setExchangeRateValue(chequeExchangeRate, chequeExchangeRateText, paymentCurrencyRate(chequeCurrency.value, paymentCurrencyCode(chequeCurrency.value) === "THB" ? 1 : 0), 0);
  pettyCashAccount.value = null;
  pettyCashAmount.value = 0;
  depositDoc.value = null;
  depositAmount.value = 0;
  depositMoneyDoc.value = null;
  depositMoneyAmount.value = 0;
  couponSelected.value = null;
  couponSearch.value = "";
  couponLookupError.value = "";
  couponAmount.value = 0;
  incomeType.value = null;
  incomeAmount.value = 0;
  expenseType.value = null;
  expenseAmount.value = 0;
  otherCurrency.value = null;
  otherCurrencyAmount.value = 0;
  otherCurrencyCharge.value = 0;
  setExchangeRateValue(otherCurrencyExchangeRate, otherCurrencyExchangeRateText, 1);
  walletType.value = null;
  walletAmount.value = 0;
  walletNumber.value = "";
  walletApprovedNo.value = "";
  walletRef1.value = "";
  walletRef2.value = "";
  resetLaoQrPaymentState();
  syncLaoQrAmountFromRate();
  paymentReviewNeeded.value = false;
  paymentReviewTotal.value = null;
}

function pickPaymentMasterOption(options, value, keys = ["code", "book_code", "pass_book_code", "value"]) {
  const target = String(value || "").trim();
  if (!target) return null;
  return (options || []).find((item) => keys.some((key) => String(item?.[key] || "").trim() === target)) || null;
}

function hydratePaymentFormStateFromEntries(entries = []) {
  const firstByType = (type) => entries.find((entry) => entry.type === type) || null;
  creditTransferCardRemark.value = "";
  creditTransferApprovalRemark.value = "";
  const cashEntry = firstByType("cash");
  const transferEntry = firstByType("transfer") || firstByType("credit_transfer");
  const creditEntry = firstByType("credit");
  const chequeEntry = firstByType("cheque");
  const pettyEntry = firstByType("petty");
  const depositEntry = firstByType("deposit");
  const depositMoneyEntry = firstByType("deposit_money");
  const couponEntry = firstByType("coupon");
  const incomeEntry = firstByType("income");
  const expenseEntry = firstByType("expense");
  const currencyEntry = firstByType("currency");
  const walletEntry = firstByType("wallet");

  if (cashEntry) {
    const details = cashEntry.details || {};
    cashCurrencyCode.value = normalizeCashCurrencyCode(details.currency_code || "THB");
    cashExchangeRate.value = toNumber(details.exchange_rate, 1) || 1;
    cashCurrencyAmount.value = toNumber(details.currency_amount, cashEntry.amount);
    cashInputAmount.value = rnd(cashEntry.amount);
    cashTenderText.value = formatCashTenderText(isHomeCashCurrencyCode(cashCurrencyCode.value) ? cashInputAmount.value : cashCurrencyAmount.value);
  }

  if (transferEntry) {
    const details = transferEntry.details || {};
    if (transferEntry.type === "credit_transfer") {
      const remarkParts = parseCreditTransferRemark(details.remark);
      creditTransferCardRemark.value = remarkParts.card;
      creditTransferApprovalRemark.value = remarkParts.approval;
    }
    transferPassBook.value =
      pickPaymentMasterOption(passBooks.value, details.pass_book_code || details.trans_number, ["book_code", "pass_book_code", "code"]) ||
      (details.pass_book_code || details.trans_number
        ? {
            book_code: String(details.pass_book_code || details.trans_number || "").trim(),
            pass_book_code: String(details.pass_book_code || details.trans_number || "").trim(),
            code: String(details.pass_book_code || details.trans_number || "").trim(),
            label: String(transferEntry.label || details.pass_book_code || details.trans_number || t("sell.transfer")).trim(),
            book_name: String(details.book_name || "").trim(),
            book_number: String(details.book_number || "").trim(),
            bank_code: String(details.bank_code || "").trim(),
            bank_branch: String(details.bank_branch || "").trim(),
          }
        : null);
    transferDate.value = String(details.transfer_date || details.chq_due_date || details.doc_date_ref || todayISO()).slice(0, 10) || todayISO();
    transferInputAmount.value = rnd(transferEntry.amount);
    applyPaymentCurrency(transferCurrency, transferExchangeRate, details.currency_code || transferPassBook.value?.currency_code || "THB");
    setExchangeRateValue(transferExchangeRate, transferExchangeRateText, details.exchange_rate, transferExchangeRate.value);
  }

  if (creditEntry) {
    const details = creditEntry.details || {};
    creditType.value =
      pickPaymentMasterOption(creditTypes.value, details.credit_card_type, ["code", "credit_card_type"]) ||
      (details.credit_card_type
        ? {
            code: String(details.credit_card_type || "").trim(),
            credit_card_type: String(details.credit_card_type || "").trim(),
            label: String(creditEntry.label || details.credit_card_type || t("sell.creditCard")).trim(),
          }
        : null);
    creditCardNumber.value = String(details.card_number || details.trans_number || "").trim();
    creditApprovalNo.value = String(details.no_approved || "").trim();
    creditInputAmount.value = rnd(creditEntry.amount);
    applyPaymentCurrency(creditCurrency, creditExchangeRate, details.currency_code || creditType.value?.currency_code || "THB");
    setExchangeRateValue(creditExchangeRate, creditExchangeRateText, details.exchange_rate, creditExchangeRate.value);
  }

  if (chequeEntry) {
    const details = chequeEntry.details || {};
    chequePassBook.value =
      pickPaymentMasterOption(passBooks.value, details.pass_book_code || details.trans_number, ["book_code", "pass_book_code", "code"]) ||
      (details.pass_book_code || details.trans_number
        ? {
            book_code: String(details.pass_book_code || details.trans_number || "").trim(),
            pass_book_code: String(details.pass_book_code || details.trans_number || "").trim(),
            code: String(details.pass_book_code || details.trans_number || "").trim(),
            label: String(chequeEntry.label || details.pass_book_code || details.trans_number || t("sell.cheque")).trim(),
            bank_code: String(details.bank_code || "").trim(),
            bank_branch: String(details.bank_branch || "").trim(),
          }
        : null);
    chequeNumber.value = String(details.trans_number || "").trim();
    chequeDueDate.value = String(details.chq_due_date || details.transfer_date || details.doc_date_ref || todayISO()).slice(0, 10) || todayISO();
    chequeAmount.value = rnd(chequeEntry.amount);
    applyPaymentCurrency(chequeCurrency, chequeExchangeRate, details.currency_code || chequePassBook.value?.currency_code || "THB");
    setExchangeRateValue(chequeExchangeRate, chequeExchangeRateText, details.exchange_rate, chequeExchangeRate.value);
  }

  if (pettyEntry) {
    const details = pettyEntry.details || {};
    pettyCashAccount.value =
      pickPaymentMasterOption(pettyCashList.value, details.trans_number, ["code"]) ||
      (details.trans_number
        ? {
            code: String(details.trans_number || "").trim(),
            label: String(pettyEntry.label || details.description || details.trans_number || t("payment.pettyCash")).trim(),
            name_1: String(details.description || "").trim(),
            currency_code: String(details.currency_code || "").trim(),
          }
        : null);
    pettyCashAmount.value = rnd(pettyEntry.amount);
  }

  if (depositEntry) {
    const details = depositEntry.details || {};
    depositDoc.value = {
      doc_no: String(details.trans_number || "").trim(),
      doc_date: String(details.doc_date_ref || "").trim(),
      amount: toNumber(details.sum_amount, depositEntry.amount),
      total_amount: toNumber(details.sum_amount, depositEntry.amount),
      balance_amount: toNumber(details.balance_amount),
      currency_code: String(details.currency_code || "").trim(),
      exchange_rate: toNumber(details.exchange_rate, 1) || 1,
      currency_amount: toNumber(details.sum_amount_2, details.amount_2),
      label: String(depositEntry.label || details.trans_number || t("sell.deposit")).trim(),
    };
    depositAmount.value = rnd(depositEntry.amount);
  }

  if (depositMoneyEntry) {
    const details = depositMoneyEntry.details || {};
    depositMoneyDoc.value = {
      doc_no: String(details.trans_number || "").trim(),
      doc_date: String(details.doc_date_ref || "").trim(),
      amount: toNumber(details.sum_amount, depositMoneyEntry.amount),
      total_amount: toNumber(details.sum_amount, depositMoneyEntry.amount),
      balance_amount: toNumber(details.balance_amount),
      currency_code: String(details.currency_code || "").trim(),
      exchange_rate: toNumber(details.exchange_rate, 1) || 1,
      currency_amount: toNumber(details.sum_amount_2, details.amount_2),
      label: String(depositMoneyEntry.label || details.trans_number || tl("เงินมัดจำ", "Deposit", "ເງິນມັດຈຳ")).trim(),
    };
    depositMoneyAmount.value = rnd(depositMoneyEntry.amount);
  }

  if (couponEntry) {
    const details = couponEntry.details || {};
    couponSelected.value = {
      number: String(details.trans_number || "").trim(),
      amount: toNumber(details.master_amount, details.balance_amount, couponEntry.amount),
      available_amount: toNumber(details.balance_amount, couponEntry.amount),
      usable_amount: toNumber(details.balance_amount, couponEntry.amount),
      balance_amount: toNumber(details.balance_amount, couponEntry.amount),
      coupon_type: String(details.coupon_type || "").trim(),
      single_use: String(details.single_use || "").trim(),
      date_expire: String(details.date_expire || "").trim(),
      remark: String(details.remark || "").trim(),
      label: String(couponEntry.label || details.trans_number || t("sell.coupon")).trim(),
    };
    couponSearch.value = couponSelected.value.number || "";
    couponAmount.value = rnd(couponEntry.amount);
  }

  if (incomeEntry) {
    const details = incomeEntry.details || {};
    incomeType.value =
      pickPaymentMasterOption(incomeTypes.value, details.trans_number, ["code"]) ||
      (details.trans_number
        ? {
            code: String(details.trans_number || "").trim(),
            label: String(incomeEntry.label || details.description || details.trans_number || t("sell.otherIncome")).trim(),
            name_1: String(details.description || "").trim(),
          }
        : null);
    incomeAmount.value = rnd(incomeEntry.amount);
  }

  if (expenseEntry) {
    const details = expenseEntry.details || {};
    expenseType.value =
      pickPaymentMasterOption(expenseTypes.value, details.trans_number, ["code"]) ||
      (details.trans_number
        ? {
            code: String(details.trans_number || "").trim(),
            label: String(expenseEntry.label || details.description || details.trans_number || t("sell.otherExpense")).trim(),
            name_1: String(details.description || "").trim(),
          }
        : null);
    expenseAmount.value = rnd(expenseEntry.amount);
  }

  if (currencyEntry) {
    const details = currencyEntry.details || {};
    otherCurrency.value =
      pickPaymentMasterOption(currencyTypes.value, details.currency_code || details.trans_number, ["code"]) ||
      (details.currency_code || details.trans_number
        ? {
            code: String(details.currency_code || details.trans_number || "").trim(),
            label: String(currencyEntry.label || details.description || details.currency_code || details.trans_number || t("sell.otherCurrency")).trim(),
            name_1: String(details.description || "").trim(),
          }
        : null);
    otherCurrencyAmount.value = rnd(toNumber(details.amount, 0));
    otherCurrencyCharge.value = rnd(toNumber(details.charge, 0));
    setExchangeRateValue(otherCurrencyExchangeRate, otherCurrencyExchangeRateText, details.exchange_rate, paymentCurrencyRate(otherCurrency.value, 1));
  }

  if (walletEntry) {
    const details = walletEntry.details || {};
    walletType.value =
      pickPaymentMasterOption(walletTypes.value, details.credit_card_type, ["code", "credit_card_type"]) ||
      (details.credit_card_type
        ? {
            code: String(details.credit_card_type || "").trim(),
            credit_card_type: String(details.credit_card_type || "").trim(),
            label: String(walletEntry.label || details.description || details.credit_card_type || "Wallet").trim(),
            name_1: String(details.description || "").trim(),
          }
        : null);
    walletNumber.value = String(details.trans_number || "").trim();
    walletApprovedNo.value = String(details.no_approved || "").trim();
    walletRef1.value = String(details.ref1 || "").trim();
    walletRef2.value = String(details.ref2 || "").trim();
    walletAmount.value = rnd(walletEntry.amount);
  }

  activePayType.value = entries[0]?.type || "cash";
}

function hydrateShipmentFromDetail(detail = {}) {
  const data = detail.shipment || {};
  const transportCode = String(data.transport_code || "").trim();
  shipment.value = {
    ...shipment.value,
    transport_name: String(data.transport_name || "").trim(),
    transport_address: String(data.transport_address || "").trim(),
    transport_telephone: String(data.transport_telephone || "").trim(),
    transport_fax: String(data.transport_fax || "").trim(),
    transport_tambon: String(data.transport_tambon || "").trim(),
    transport_amper: String(data.transport_amper || "").trim(),
    transport_province: String(data.transport_province || "").trim(),
    transport_country: String(data.transport_country || "").trim(),
    zipcode: String(data.zipcode || "").trim(),
    transport_code: transportCode,
    destination: String(data.destination || "").trim(),
    remark: String(data.remark || "").trim(),
    remark_2: String(data.remark_2 || "").trim(),
    ship_code: String(data.ship_code || "").trim(),
    logistic_area: String(data.logistic_area || "").trim(),
    latitude: toNumber(data.latitude),
    longitude: toNumber(data.longitude),
  };
  if (transportCode) updateShipmentTransportType(transportCode);
  selectedShippingLabel.value = null;
}

function hydrateGlFromDetail(detail = {}) {
  const glRows = Array.isArray(detail.gl_detail) ? detail.gl_detail : [];
  const transDirect = toNumber(detail.gl_trans_direct, glRows.length > 0 ? 1 : 0) === 1 ? 1 : 0;
  glTransDirect.value = transDirect;
  const headerData = detail.header || {};
  const overrideMode = resolveInventoryGlMode(headerData.inventory_gl_post_override);
  inventoryGlPostMode.value = overrideMode === "unknown" ? "system" : overrideMode;
  manualGlRows.value = glRows.map((row) => ({
    id: makeLineId(),
    account_code: String(row.account_code || "").trim(),
    account_name: String(row.account_name || "").trim(),
    debit: toNumber(row.debit),
    credit: toNumber(row.credit),
  }));
  const glHeaderData = detail.gl_header || {};
  glRefDate.value = String(glHeaderData.ref_date || "").slice(0, 10);
  glRefNo.value = String(glHeaderData.ref_no || "").trim();
  glBookCode.value = String(glHeaderData.book_code || "").trim();
  glJournalType.value = toNumber(glHeaderData.journal_type);
  glDescription.value = String(glHeaderData.description || "").trim();
  glApArCode.value = String(glHeaderData.ap_ar_code || "").trim();
  glApArOriginateFrom.value = toNumber(glHeaderData.ap_ar_originate_from);
}

function detailDate(value, fallback = "") {
  const text = String(value || "").trim();
  if (!text) return fallback;
  return text.slice(0, 10);
}

function detailTime(value, fallback = localTimeHHMM()) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  return text.slice(0, 5);
}

function optionByCode(options, code, keys = ["code"]) {
  const target = String(code || "").trim();
  if (!target) return null;
  return (options || []).find((row) => keys.some((key) => String(row?.[key] || "").trim() === target)) || null;
}

async function hydrateHeaderFromDetail(detail = {}, targetDocNo = "") {
  const header = detail.header || {};
  editMode.value = true;
  oldDocNo.value = String(header.doc_no || targetDocNo || "").trim();
  docCanEdit.value =
    toNumber(header.used_status) !== 1 && toNumber(header.used_status_2) !== 1 && toNumber(header.doc_success) !== 1 && toNumber(header.last_status) !== 1 && toNumber(header.is_doc_copy) !== 1;
  successDocNo.value = "";
  nextDocNo.value = oldDocNo.value;
  docFormatCode.value = resolveDocFormatOptionCode(header.doc_format_code || docFormatCode.value);
  inquiryType.value = toNumber(header.inquiry_type, inquiryType.value);
  vatType.value = toNumber(header.vat_type, vatType.value);
  vatRate.value = toNumber(header.vat_rate, vatRate.value);
  docDate.value = detailDate(header.doc_date, todayISO());
  docTime.value = detailTime(header.doc_time);
  taxDocNo.value = String(header.tax_doc_no || oldDocNo.value || "").trim();
  taxDocDate.value = detailDate(header.tax_doc_date, docDate.value);
  custCode.value = String(header.cust_code || defaultCustomerCode).trim();
  memberCode.value = String(header.member_code || "").trim();
  custName.value = String(header.cust_name || defaultCustomerName.value).trim();
  saleCode.value = String(header.sale_code || header.emp_code || saleCode.value || "").trim();
  saleName.value = String(header.sale_name || header.emp_name || "").trim();
  saleName2.value = "";
  if (!saleName.value && saleCode.value === authStore.employee?.user_code) {
    const defaultEmployee = await defaultEmployeeNames();
    saleName.value = defaultEmployee.name_1;
    saleName2.value = defaultEmployee.name_2;
  }
  branchCode.value = String(header.branch_code || branchCode.value || "").trim();
  docGroup.value = String(header.doc_group || "").trim();
  sideCode.value = String(header.side_code || "").trim();
  departmentCode.value = String(header.department_code || "").trim();
  allocateCode.value = String(header.allocate_code || "").trim();
  projectCode.value = String(header.project_code || "").trim();
  jobCode.value = String(header.job_code || "").trim();
  contactor.value = String(header.contactor || "").trim();
  docRef.value = String(header.doc_ref || "").trim();
  docRefDate.value = detailDate(header.doc_ref_date, docDate.value);
  saleGroup.value = String(header.sale_group || "").trim();
  cashierCode.value = String(header.cashier_code || cashierCode.value || "").trim();
  userApprove.value = String(header.user_approve || "").trim();
  remark.value = String(header.remark || "").trim();
  remark2.value = String(header.remark_2 || "").trim();
  remark3.value = String(header.remark_3 || "").trim();
  remark4.value = String(header.remark_4 || "").trim();
  remark5.value = String(header.remark_5 || "").trim();
  discountWord.value = String(header.discount_word || "").trim();
  creditDay.value = toNumber(header.credit_day);
  dueDate.value = detailDate(header.due_date || header.credit_date, addDaysISO(docDate.value, creditDay.value));
  sendType.value = toNumber(header.send_type);
  sendDate.value = detailDate(header.send_date, docDate.value);
  deliveryDate.value = detailDate(header.delivery_date, docDate.value);
  transportType.value = optionByCode(shipmentTransportTypeOptions.value, header.transport_code) || optionByCode(transportTypes.value, header.transport_code);
  documentCurrency.value = currencyOptionByCode(header.currency_code || "THB");
  setExchangeRateValue(documentExchangeRate, documentExchangeRateText, header.exchange_rate, documentCurrency.value?.exchange_rate_present || 1);
  roundedAmount.value = toNumber(header.total_income_amount);
  vatSaleDescription.value = String(header.remark || "").trim();
  vatSaleTaxNo.value = "";
  vatSaleBranchCode.value = "";
}

function mapDetailItemToLine(row = {}) {
  const isForeign = isDocumentForeignCurrencyValue();
  const displayPrice = isForeign ? toNumber(row.price_2, row.price) : toNumber(row.price);
  const displayDiscountAmount = isForeign ? toNumber(row.discount_amount_2, row.discount_amount) : toNumber(row.discount_amount);
  const displaySum = isForeign ? toNumber(row.sum_amount_2, row.sum_amount) : toNumber(row.sum_amount);
  const standValue = toNumber(row.stand_value, 1) || 1;
  const divideValue = toNumber(row.divide_value, 1) || 1;
  const line = {
    id: makeLineId(),
    item_code: String(row.item_code || "").trim(),
    item_name: String(row.item_name || "").trim(),
    unit_code: String(row.unit_code || "").trim(),
    barcode: String(row.barcode || "").trim(),
    qty: toNumber(row.qty),
    price: displayPrice,
    discount: String(row.discount || "").trim() || (displayDiscountAmount ? String(displayDiscountAmount) : ""),
    price_type: toNumber(row.price_type) || 1,
    price_mode: toNumber(row.price_mode),
    price_info: String(row.price_info || row.price_mode || "").trim(),
    price_default: toNumber(row.price_default) || displayPrice,
    price_manual: row.price_manual === true || toNumber(row.price_manual) === 1,
    price_locked: row.price_locked === false || toNumber(row.price_locked) === 0 ? false : true,
    have_point: toNumber(row.have_point) === 1,
    drink_type: toNumber(row.drink_type),
    no_discount: toNumber(row.no_discount) === 1,
    price_loading: false,
    price_error: "",
    discount_amount: displayDiscountAmount,
    sum_amount: displaySum,
    tax_type: toNumber(row.tax_type),
    item_type: String(row.item_type ?? "0"),
    wh_code: String(row.wh_code || defaultSaleWarehouseCode() || "").trim(),
    shelf_code: String(row.shelf_code || posStore.selectedPos?.pos_ic_shelf || "").trim(),
    stand_value: standValue,
    divide_value: divideValue,
    ratio: toNumber(row.ratio, standValue / divideValue),
    balance_base: 0,
    _display_order: nextLineDisplayOrder(),
    remark: String(row.remark || "").trim(),
    sub_item: [],
    // ผูกกับเอกสารต้นทาง (ถ้าดึงจาก "ดึงเอกสารอ้างอิง" แล้ว save ไว้)
    ref_doc_no: String(row.ref_doc_no || "").trim(),
    ref_row: toNumber(row.ref_row, 0),
  };
  if (line.wh_code) void ensureShelfOptions(line.wh_code);
  return line;
}

function hydrateItemsFromDetail(detail = {}) {
  const itemRows = Array.isArray(detail.items) ? detail.items : [];
  lineDisplayOrderCounter = 0;
  rows.value = itemRows
    .filter((row) => String(row.item_code || "").trim())
    .filter((row) => !String(row.set_ref_line || "").trim() && !String(row.item_code_main || "").trim())
    .map((row) => mapDetailItemToLine(row));
}

function hydrateVatWhtFromDetail(detail = {}) {
  vatRows.value = (Array.isArray(detail.vat_rows) ? detail.vat_rows : []).map((row) => makeVatRow(row));
  if (!vatRows.value.length) ensureVatDefaultRow();
  whtHeaders.value = (Array.isArray(detail.wht_headers) ? detail.wht_headers : []).map((header) => makeWhtHeader(header));
  selectedWhtHeaderId.value = whtHeaders.value[0]?.id || "";
}

function hydratePromotionFromDetail(detail = {}) {
  const promoRows = Array.isArray(detail.promotion_detail) ? detail.promotion_detail : Array.isArray(detail.promotions) ? detail.promotions : [];
  promotionProductRows.value = promoRows.map((row, index) => ({
    ...row,
    line_number: toNumber(row.line_number, index),
    promotion_code: String(row.promotion_code || row.code || "").trim(),
    promotion_name: String(row.promotion_name || row.item_name || row.name_1 || "").trim(),
    qty: toNumber(row.qty),
    price: toNumber(row.price),
    sum_amount: toNumber(row.sum_amount ?? row.amount),
  }));
  promotionResults.value = promoRows.map((row, index) => ({
    ...row,
    promotion_code: String(row.promotion_code || row.code || "").trim(),
    promotion_name: String(row.promotion_name || row.item_name || row.name_1 || "").trim(),
    qty: toNumber(row.qty),
    amount: toNumber(row.sum_amount ?? row.amount),
    sum_amount: toNumber(row.sum_amount ?? row.amount),
    line_number: toNumber(row.line_number, index),
  }));
  const promotionDiscount = promoRows.reduce((sum, row) => sum + Math.abs(toNumber(row.sum_amount ?? row.amount)), 0);
  promotionDiscountRaw.value = promotionDiscount > 0 ? -rnd(promotionDiscount, itemAmountDecimal.value) : 0;
  promotionDirty.value = false;
  promotionError.value = "";
  promotionLastCalculatedAt.value = promoRows.length ? tl("จากเอกสารเดิม", "From original document", "ຈາກເອກະສານເດີມ") : "";
}

function hydrateRefBillingsFromDetail(detail = {}) {
  const refRows = Array.isArray(detail.ref_billings) ? detail.ref_billings : [];
  pulledRefDocs.value = refRows
    .filter((row) => String(row.doc_no || "").trim())
    .map((row) => ({
      doc_no: String(row.doc_no).trim(),
      doc_date: String(row.doc_date || "").slice(0, 10),
      ref_doc_no: String(row.ref_doc_no || "").trim(),
      ref_doc_date: String(row.ref_doc_date || "").slice(0, 10),
      bill_type: toNumber(row.bill_type, 0),
      remark: String(row.remark || "").trim(),
      item_count: 0, // ไม่ track item_count กลับมา (ไม่จำเป็นในการ display)
    }));
}

function hydratePosCampaignFromDetail(detail = {}) {
  const campaignRows = Array.isArray(detail.pos_campaign_detail) ? detail.pos_campaign_detail : Array.isArray(detail.pos_campaigns) ? detail.pos_campaigns : [];
  posCampaignRows.value = campaignRows.map((row, index) => ({
    ...row,
    line_number: toNumber(row.line_number, index),
    campaign_code: String(row.campaign_code || row.code || "").trim(),
    campaign_name: String(row.campaign_name || row.name_1 || "").trim(),
    display_wording: String(row.display_wording || row.promotion_text || "").trim(),
    promotion_text: String(row.promotion_text || row.display_wording || "").trim(),
    qty: toNumber(row.qty),
    match_amount: toNumber(row.match_amount),
    sale_amount: toNumber(row.sale_amount),
  }));
  posCampaignDirty.value = false;
  posCampaignError.value = "";
  posCampaignLastCalculatedAt.value = campaignRows.length ? tl("จากเอกสารเดิม", "From original document", "ຈາກເອກະສານເດີມ") : "";
}

async function loadEditDocumentFromQuery(value) {
  const targetDocNo = String(value || "").trim();
  if (!targetDocNo || loadedEditDocNo.value === targetDocNo) return;
  clearLaoQrPaymentRequests();
  errorMsg.value = "";
  editOriginalSignature.value = "";
  try {
    const detail = await getDocSaleHistoryDetail(targetDocNo);
    if (!detail) throw new Error(tl("ไม่พบข้อมูลเอกสารที่ต้องการแก้ไข", "Edit document data was not found", "ບໍ່ພົບຂໍ້ມູນເອກະສານທີ່ຕ້ອງການແກ້ໄຂ"));
    hydratingEditDocument.value = true;
    await hydrateHeaderFromDetail(detail, targetDocNo);
    hydrateItemsFromDetail(detail);
    hydrateVatWhtFromDetail(detail);
    hydratePromotionFromDetail(detail);
    hydratePosCampaignFromDetail(detail);
    hydrateRefBillingsFromDetail(detail);
    hydratePaymentsFromDetail(detail);
    hydratingShipment.value = true;
    hydrateShipmentFromDetail(detail);
    await syncShipmentLocationMasterSelection();
    applyTambonZipcode();
    hydratingShipment.value = false;
    hydrateGlFromDetail(detail);
    await refreshCustomerCredit();
    await nextTick();
    // ถ้าเอกสารแก้ไขไม่ได้ และไม่ได้อยู่ใน view-only mode → redirect ไป view-only
    if (!docCanEdit.value && !isViewOnly.value) {
      router.replace({ name: "Sell", query: { doc_no: targetDocNo, view: "1" } });
      return;
    }
    paymentReviewNeeded.value = false;
    paymentReviewTotal.value = paymentEntries.value.length ? totalDue.value : null;
    editOriginalSignature.value = buildEditDirtySignature();
    loadedEditDocNo.value = targetDocNo;
    // toast.add({
    //   severity: "info",
    //   summary: tl("โหลดเอกสารเพื่อแก้ไข", "Loaded document for edit", "ໂຫຼດເອກະສານເພື່ອແກ້ໄຂ"),
    //   detail: tl(`โหลดข้อมูล GL/การจัดส่ง จากเอกสาร ${targetDocNo}`, `Loaded GL/shipment data from document ${targetDocNo}`, `ໂຫຼດຂໍ້ມູນ GL/ການຈັດສົ່ງ ຈາກເອກະສານ ${targetDocNo}`),
    //   life: 2800,
    // });
  } catch (error) {
    errorMsg.value = error.message || tl("โหลดข้อมูลเอกสารไม่สำเร็จ", "Failed to load document data", "ໂຫຼດຂໍ້ມູນເອກະສານບໍ່ສຳເລັດ");
    loadedEditDocNo.value = "";
    hydratingShipment.value = false;
  } finally {
    hydratingEditDocument.value = false;
  }
}

watch(
  () => shipment.value.transport_province,
  async (value, prev) => {
    if (hydratingShipment.value) return;
    if (String(value || "").trim() === String(prev || "").trim()) return;
    shipment.value.transport_amper = "";
    shipment.value.transport_tambon = "";
    await loadAmperOptions(value);
    tambonOptions.value = [];
  },
);

watch(
  () => shipment.value.transport_amper,
  async (value, prev) => {
    if (hydratingShipment.value) return;
    if (String(value || "").trim() === String(prev || "").trim()) return;
    shipment.value.transport_tambon = "";
    await loadTambonOptions(shipment.value.transport_province, value);
  },
);

watch(
  () => shipment.value.transport_tambon,
  () => {
    applyTambonZipcode();
  },
);

async function resetEmployeeToDefault() {
  saleCode.value = authStore.employee?.user_code || "";
  const defaultEmployee = await defaultEmployeeNames();
  saleName.value = defaultEmployee.name_1;
  saleName2.value = defaultEmployee.name_2;
  saleSearch.value = "";
  saleResults.value = [];
  employeeDialogVisible.value = false;
}

function openEmployeeDialog() {
  if (documentLocked.value) return;
  saleSearch.value = "";
  saleResults.value = [];
  employeeDialogVisible.value = true;
}

async function searchEmployees(value) {
  clearTimeout(saleTimer);
  const query = String(value || "").trim();
  if (!query) {
    saleResults.value = [];
    return;
  }
  saleTimer = setTimeout(async () => {
    saleLoading.value = true;
    try {
      const { data } = await api.get("/getEmployeeList", { params: { search: query } });
      saleResults.value = data.data || [];
    } finally {
      saleLoading.value = false;
    }
  }, 250);
}

async function loadEmployees() {
  clearTimeout(saleTimer);
  const query = String(saleSearch.value || "").trim();
  if (!query) {
    saleResults.value = [];
    return;
  }
  saleLoading.value = true;
  try {
    const { data } = await api.get("/getEmployeeList", { params: { search: query } });
    saleResults.value = data.data || [];
  } finally {
    saleLoading.value = false;
  }
}

function selectEmployee(employee) {
  saleCode.value = employee.code || "";
  saleName.value = employeePrimaryName(employee);
  saleName2.value = employeeName2(employee);
  saleSearch.value = "";
  saleResults.value = [];
  employeeDialogVisible.value = false;
}

function parseBarcodeInput(value) {
  let text = String(value || "").trim();
  let qty = 1;
  const qtyMatch = text.match(/^(\d+(?:\.\d+)?)\s*\*\s*(.+)$/);
  if (qtyMatch) {
    qty = Number(qtyMatch[1]);
    text = qtyMatch[2].trim();
  }
  const shelfIndex = text.indexOf("#");
  if (shelfIndex >= 0) text = text.slice(0, shelfIndex).trim();
  return { barcode: text, qty: Number.isFinite(qty) && qty > 0 ? qty : 1 };
}

function unitRatio(unit) {
  return Math.max(1, Number(unit?.ratio) || Number(unit?.stand_value) / Number(unit?.divide_value || 1) || 1);
}

function isServiceItem(row) {
  return String(row?.item_type ?? "") === "1";
}

// สินค้าชุด (item_type=3) — ห้ามเช็คสต๊อกที่ frontend, ราคาดึงจาก /getProductSetDetail
// children เก็บใน line.sub_item แล้วส่งไป backend (backend จะ persist child rows ให้)
function isSetItem(row) {
  return String(row?.item_type ?? "") === "3";
}

// เลือก unit ที่ตรงกับ start_sale_unit จาก rows ของ getProductSetDetail
// (smlstaff-ubon ใช้ pattern เดียวกัน)
function pickSetUnitRow(rows, product) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const preferred = product?.unit_code || product?.start_sale_unit || product?.unit_standard || product?.unit_cost || "";
  return rows.find((r) => r.unit_code === preferred) || rows[0];
}

function unitBaseBalance(unit, ratio = unitRatio(unit)) {
  return Number(unit?.sum_balance_qty ?? Number(unit?.balance_qty ?? 0) * ratio);
}

function unitOptionKey(unit) {
  return [unit?.item_code || unit?.ic_code || "", unit?.unit_code || unit?.code || "", unit?.barcode || ""].join("|");
}

const unitEditSelectedUnit = computed(() => unitEditOptions.value.find((unit) => unitOptionKey(unit) === unitEditSelectedKey.value) || unitEditOptions.value[0] || null);

function isCompanyOptionEnabled(name, fallback = false) {
  const value = posStore.erpOption?.[name];
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "t", "yes", "y"].includes(String(value).toLowerCase());
}

function isTruthySaleValue(value) {
  return value === true || value === 1 || value === "1" || String(value || "").toLowerCase() === "true";
}

function isPremiumSaleSource(source = {}) {
  return [source?.is_permium, source?.is_premium, source?.is_free, source?.promotion_free, source?.premium].some(isTruthySaleValue);
}

async function refreshCompanyOptionsForStockControl() {
  await posStore.refreshErpOption().catch(() => {});
  return isCompanyOptionEnabled("ic_stock_control", false);
}

function isSalePolicyLineSkipped(line) {
  if (!String(line?.item_code || "").trim()) return true;
  if (isServiceItem(line) || isSetItem(line)) return true;
  return isPremiumSaleSource(line);
}

function salePolicyItemsFromLines(lines = []) {
  const pos = posStore.selectedPos || {};
  return lines
    .filter((line) => String(line?.item_code || "").trim() && toNumber(line?.qty) > 0)
    .map((line) => ({
      item_code: line.item_code,
      item_name: line.item_name,
      unit_code: line.unit_code,
      qty: toNumber(line.qty),
      price: lineHomePrice(line),
      price_2: isDocumentForeignCurrencyValue() ? toNumber(line.price) : lineHomePrice(line),
      sum_amount: lineHomeSumAmount(line),
      sum_amount_2: isDocumentForeignCurrencyValue() ? lineSumAmount(line) : lineHomeSumAmount(line),
      discount: line.discount || "",
      discount_amount: lineHomeDiscountAmount(line),
      discount_amount_2: isDocumentForeignCurrencyValue() ? lineDiscountAmount(line) : lineHomeDiscountAmount(line),
      tax_type: toNumber(line.tax_type),
      vat_type: vatType.value,
      vat_rate: toNumber(vatRate.value, 7),
      wh_code: line.wh_code || defaultSaleWarehouseCode([pos.pos_ic_wht]) || "",
      shelf_code: line.shelf_code || pos.pos_ic_shelf || "",
      stand_value: toNumber(line.stand_value, 1),
      divide_value: toNumber(line.divide_value, 1),
      ratio: unitRatio(line),
      item_type: line.item_type,
      barcode: line.barcode || "",
      is_permium: line.is_permium,
      is_premium: line.is_premium,
      is_free: line.is_free,
      promotion_free: line.promotion_free,
      premium: line.premium,
    }));
}

function salePolicyPayloadForLines(lines = []) {
  return {
    doc_date: docDate.value,
    vat_type: vatType.value,
    vat_rate: toNumber(vatRate.value, 7),
    currency_code: documentCurrency.value?.code || "",
    exchange_rate: documentExchangeRateValue(),
    items: salePolicyItemsFromLines(lines),
  };
}

function salePolicyIssueMessages(issues = []) {
  return (Array.isArray(issues) ? issues : []).map((issue) => issue?.message).filter(Boolean);
}

function salePolicyBlockingWarnings(warnings = []) {
  return (Array.isArray(warnings) ? warnings : []).filter((issue) => String(issue?.code || "").toUpperCase() === "SALE_ITEM_NO_PRICE");
}

function showSalePolicyWarnings(warnings = []) {
  const details = salePolicyIssueMessages(warnings);
  if (!details.length) return;
  openSalePolicyDialog({
    type: "warn",
    title: tl("ตรวจเงื่อนไขสินค้า", "Product policy", "ກວດເງື່ອນໄຂສິນຄ້າ"),
    message: tl("พบเงื่อนไขสินค้า กรุณาตรวจสอบก่อนทำรายการต่อ", "Product policy warning found. Please review before continuing.", "ພົບເງື່ອນໄຂສິນຄ້າ ກະລຸນາກວດສອບກ່ອນເຮັດລາຍການຕໍ່"),
    details,
  });
}

async function checkSalePoliciesForLines(lines = []) {
  const payload = salePolicyPayloadForLines(lines);
  if (!payload.items.length) return { errors: [], warnings: [] };
  const result = await checkSaleItemPolicies(payload);
  const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
  const blockingWarnings = salePolicyBlockingWarnings(warnings);
  const nonBlockingWarnings = warnings.filter((issue) => !blockingWarnings.includes(issue));
  const errors = salePolicyIssueMessages(result?.errors);
  const blockedDetails = [...errors, ...salePolicyIssueMessages(blockingWarnings)];
  if (blockedDetails.length) {
    openSalePolicyDialog({
      type: "warn",
      title: tl("ตรวจเงื่อนไขสินค้า", "Product policy", "ກວດເງື່ອນໄຂສິນຄ້າ"),
      message: tl("ไม่สามารถเพิ่มสินค้านี้เข้าตารางได้", "This product cannot be added to the table.", "ບໍ່ສາມາດເພີ່ມສິນຄ້ານີ້ເຂົ້າຕາຕະລາງໄດ້"),
      details: blockedDetails,
    });
    throw makeSalePolicyError(blockedDetails, "", true);
  }
  showSalePolicyWarnings(nonBlockingWarnings);
  return result;
}

async function validateSalePoliciesBeforeSave(body = {}, dialog = {}) {
  const result = await checkSaleItemPolicies(body);
  const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
  const blockingWarnings = salePolicyBlockingWarnings(warnings);
  const nonBlockingWarnings = warnings.filter((issue) => !blockingWarnings.includes(issue));
  showSalePolicyWarnings(nonBlockingWarnings);
  const blockedDetails = [...salePolicyIssueMessages(result?.errors), ...salePolicyIssueMessages(blockingWarnings)];
  if (!blockedDetails.length) return true;
  workspaceTab.value = "details";
  openSaveDialog({
    type: "warn",
    title: dialog.title || tl("ยังบันทึกไม่ได้", "Cannot save yet", "ຍັງບັນທຶກບໍ່ໄດ້"),
    message: dialog.message || tl("รายการสินค้าไม่ผ่านเงื่อนไขการขาย", "Product items do not pass sale policy", "ລາຍການສິນຄ້າບໍ່ຜ່ານເງື່ອນໄຂການຂາຍ"),
    details: blockedDetails,
  });
  return false;
}

function preferredUnit(product, units) {
  if (product.unit_code) {
    return units.find((unit) => unit.unit_code === product.unit_code) || product;
  }
  const preferred = product.start_sale_unit || product.unit_standard || product.unit_cost || "";
  return units.find((unit) => unit.unit_code === preferred) || units[0] || product;
}

async function resolveSelectedUnit(product, barcode = "") {
  const selectedBarcode = barcode || product.barcode || "";

  // สินค้าชุด: ต้องดึงหน่วย/ราคาจาก /getProductSetDetail เสมอ
  // (ห้ามใช้ /getProductDetail หรือ barcode unit เพราะราคาจะคำนวณผิด)
  if (isSetItem(product)) {
    const setRows = await getProductSetDetail(product.item_code, custCode.value, priceOpts());
    const setUnit = pickSetUnitRow(setRows, product);
    if (!setUnit) throw new Error(tl("ไม่พบรายละเอียดสินค้าชุด", "Product set detail was not found", "ບໍ່ພົບລາຍລະອຽດສິນຄ້າຊຸດ"));
    return {
      ...product,
      ...setUnit,
      barcode: selectedBarcode || setUnit.barcode || product.barcode || "",
      item_type: "3",
    };
  }

  const hasStockDetail = product.item_code && product.unit_code && (product.balance_qty !== undefined || product.sum_balance_qty !== undefined);
  if (hasStockDetail) {
    return { ...product, barcode: selectedBarcode || product.barcode || "" };
  }

  if (selectedBarcode) {
    const barcodeUnit = await getProductByBarcodeDetail(selectedBarcode).catch(() => null);
    if (barcodeUnit?.item_code) {
      return {
        ...product,
        ...barcodeUnit,
        barcode: selectedBarcode,
        unit_code: barcodeUnit.unit_code || product.unit_code,
      };
    }
  }

  const units = await getProductDetail(product.item_code, custCode.value, priceOpts());
  return preferredUnit(product, units);
}

async function makeLine(product, qty = 1, barcode = "") {
  const unit = await resolveSelectedUnit(product, barcode);
  if (!unit?.item_code) throw new Error(tl("ไม่พบหน่วยขายของสินค้า", "Product sale unit was not found", "ບໍ່ພົບໜ່ວຍຂາຍຂອງສິນຄ້າ"));
  const effectiveBarcode = barcode || unit.barcode || product.barcode || "";
  const itemType = String(unit.item_type ?? product.item_type ?? "0");
  const isSet = itemType === "3";
  const isPremium = isPremiumSaleSource(unit) || isPremiumSaleSource(product);
  const selectedWhCode = String(product?._selected_wh_code || "").trim();
  const selectedShelfCode = String(product?._selected_shelf_code || "").trim();

  // สินค้าชุด: ราคามาจาก getProductSetDetail แล้ว (อยู่ใน unit.price) — ไม่เรียก getProductPrice
  // และต้องโหลด sub_item (children) เก็บไว้ใน line เพื่อส่งไป backend ตอน save
  let priceResult = null;
  let subItems = [];
  if (isSet) {
    priceResult = {
      price: unit.price,
      defaultDiscount: unit.defaultDiscount || "",
      type: unit.type ?? unit.price_type ?? 1,
      mode: unit.mode ?? "",
    };
    subItems = await getProductSetItem(unit.item_code).catch(() => []);
  } else {
    priceResult = await getPosLinePrice(unit.item_code, unit.unit_code, qty, effectiveBarcode);
  }

  const ratio = unitRatio(unit);
  const line = {
    id: makeLineId(),
    item_code: unit.item_code,
    item_name: unit.item_name || product.item_name || product.name_1 || "",
    unit_code: unit.unit_code,
    barcode: effectiveBarcode,
    serial_number: String(product.serial_number || unit.serial_number || "").trim(),
    qty,
    price: toNumber(priceResult?.price ?? product.price ?? unit.price ?? 0),
    discount: priceResult?.defaultDiscount || "",
    price_type: toNumber(priceResult?.type ?? unit.type ?? product.type ?? priceResult?.price_type ?? unit.price_type ?? product.price_type ?? 1, 1),
    price_mode: toNumber(priceResult?.mode ?? unit.mode ?? product.mode ?? 0, 0),
    price_info: priceResult?.mode ?? unit.mode ?? "",
    price_default: toNumber(priceResult?.price ?? product.price_default ?? product.price ?? unit.price ?? 0),
    price_manual: false,
    price_locked: false,
    have_point: unit.have_point === true || unit.have_point === "1" || product.have_point === true || product.have_point === "1",
    drink_type: toNumber(unit.drink_type ?? product.drink_type ?? 0),
    no_discount: unit.no_discount === true || unit.no_discount === "1" || product.no_discount === true || product.no_discount === "1",
    price_loading: false,
    price_error: "",
    discount_amount: 0,
    sum_amount: 0,
    tax_type: toNumber(unit.tax_type ?? product.tax_type ?? 0),
    item_type: itemType,
    is_permium: isPremium ? 1 : toNumber(unit.is_permium ?? product.is_permium ?? 0),
    is_premium: isPremium ? 1 : toNumber(unit.is_premium ?? product.is_premium ?? 0),
    is_free: unit.is_free ?? product.is_free ?? 0,
    promotion_free: unit.promotion_free ?? product.promotion_free ?? 0,
    premium: unit.premium ?? product.premium ?? 0,
    wh_code: selectedWhCode || defaultSaleWarehouseCode([unit.wh_code, unit.start_sale_wh]) || "",
    shelf_code: selectedWhCode ? selectedShelfCode : posStore.selectedPos?.pos_ic_shelf || unit.shelf_code || unit.start_sale_shelf || "",
    stand_value: toNumber(unit.stand_value, 1),
    divide_value: toNumber(unit.divide_value, 1),
    ratio,
    balance_base: isSet ? 0 : unitBaseBalance(unit, ratio),
    _display_order: nextLineDisplayOrder(),
    remark: "",
    // children ของสินค้าชุด — backend จะ persist เป็น ic_trans_detail child rows
    sub_item: isSet ? subItems : [],
  };
  if (line.wh_code) void ensureShelfOptions(line.wh_code);
  return line;
}

// สร้าง line จาก row ของเอกสารอ้างอิง (port จาก C# _docRefProcess.cs:218-247)
// ใช้ qty/price/discount/wh/shelf จาก ref doc โดยตรง ไม่ดึงราคาใหม่
function makeLineFromRef(refItem) {
  const ratio = Math.max(1, toNumber(refItem.stand_value, 1) / Math.max(1, toNumber(refItem.divide_value, 1)));
  const line = {
    id: makeLineId(),
    item_code: refItem.item_code,
    item_name: refItem.item_name || "",
    unit_code: refItem.unit_code || "",
    barcode: refItem.barcode || "",
    qty: toNumber(refItem.qty),
    price: toNumber(refItem.price),
    discount: refItem.discount || "",
    price_type: 1,
    price_mode: 0,
    price_info: "",
    price_default: toNumber(refItem.price),
    price_manual: false,
    price_locked: true,
    have_point: false,
    drink_type: 0,
    no_discount: false,
    price_loading: false,
    price_error: "",
    discount_amount: 0,
    sum_amount: 0,
    tax_type: toNumber(refItem.tax_type, 0),
    item_type: String(refItem.item_type ?? "0"),
    wh_code: refItem.wh_code || defaultSaleWarehouseCode() || "",
    shelf_code: refItem.shelf_code || posStore.selectedPos?.pos_ic_shelf || "",
    stand_value: toNumber(refItem.stand_value, 1),
    divide_value: toNumber(refItem.divide_value, 1),
    ratio,
    balance_base: 0,
    _display_order: nextLineDisplayOrder(),
    remark: refItem.remark || "",
    sub_item: [],
    // ref linkage — backend ใช้ผูก ic_trans_detail.ref_doc_no / ref_row
    ref_doc_no: refItem.ref_doc_no || "",
    ref_row: toNumber(refItem.ref_row, 0),
  };
  if (line.wh_code) void ensureShelfOptions(line.wh_code);
  return line;
}

function openRefDocDialog() {
  if (isWalkInCustomer.value) return; // ปุ่ม disabled อยู่แล้ว — กัน defensive
  refDocDialogVisible.value = true;
}

function billTypeLabel(t) {
  const map = {
    1: tl("ใบเสนอราคา", "Quotation", "ໃບສະເໜີລາຄາ"),
    2: tl("ใบสั่งจอง", "Reservation", "ໃບສັ່ງຈອງ"),
    3: tl("ใบสั่งขาย", "Sales Order", "ໃບສັ່ງຂາຍ"),
    30: tl("ใบเสนอราคา", "Quotation", "ໃບສະເໜີລາຄາ"),
    34: tl("ใบสั่งจอง", "Reservation", "ໃບສັ່ງຈອງ"),
    36: tl("ใบสั่งขาย", "Sales Order", "ໃບສັ່ງຂາຍ"),
  };
  return map[Number(t)] || "";
}

function isReservationRefBillType(billType) {
  return [2, 34].includes(Number(billType));
}

function refDocWarehouseCandidates(line) {
  const seen = new Set();
  return [line?.wh_code, posStore.selectedPos?.pos_ic_wht, ...warehouseSelectOptions.value.map((wh) => wh.code), ...allowedSaleWarehouseCodes.value]
    .map((code) => String(code || "").trim())
    .filter((code) => {
      const key = code.toUpperCase();
      if (!key || seen.has(key) || !isSaleWarehouseAllowed(code)) return false;
      seen.add(key);
      return true;
    });
}

function refDocCandidateStockRows(refLines, line, whCode, shelfCode, whOnly = false) {
  const targetWhCode = String(whCode || "").trim();
  const targetShelfCode = String(shelfCode || "").trim();
  return buildStockValidationRowsFromLines([
    ...validRows.value,
    ...refLines.map((row) =>
      row === line
        ? {
            ...row,
            wh_code: targetWhCode,
            shelf_code: targetShelfCode,
            _stock_wh_only: whOnly,
          }
        : row,
    ),
  ]);
}

function refDocRequestedBaseForWarehouse(refLines, line, whCode, shelfCode, whOnly = false) {
  const itemCode = String(line?.item_code || "");
  const targetWhCode = String(whCode || "");
  const targetShelfCode = String(shelfCode || "");
  return refDocCandidateStockRows(refLines, line, targetWhCode, targetShelfCode, whOnly)
    .filter((row) => {
      if (String(row.item_code || "") !== itemCode || String(row.wh_code || "") !== targetWhCode) return false;
      if (whOnly) return true;
      return String(row.shelf_code || "") === targetShelfCode;
    })
    .reduce((sum, row) => sum + toNumber(row.qty) * unitRatio(row), 0);
}

async function findRefDocWarehouseWithStock(line, refLines, balanceCache) {
  const itemCode = String(line?.item_code || "").trim();
  if (!itemCode) return null;
  const getBalance = async (whCode, shelfCode = "") => {
    const key = [itemCode, whCode || "", shelfCode || ""].join("|");
    if (!balanceCache.has(key)) {
      balanceCache.set(
        key,
        getInventoryBalance(itemCode, whCode || "", shelfCode || "").catch(() => 0),
      );
    }
    return balanceCache.get(key);
  };
  for (const whCode of refDocWarehouseCandidates(line)) {
    await ensureShelfOptions(whCode);
    const shelves = shelfSelectOptions(whCode)
      .map((shelf) => String(shelf.code || shelf.shelf_code || "").trim())
      .filter(Boolean);
    const shelfCandidates = shelves.length ? shelves : [""];
    for (const shelfCode of shelfCandidates) {
      const requestedBase = refDocRequestedBaseForWarehouse(refLines, line, whCode, shelfCode, false);
      const availableBase = await getBalance(whCode, shelfCode);
      if (requestedBase <= availableBase) return { wh_code: whCode, shelf_code: shelfCode, wh_only: false };
    }
    const requestedBase = refDocRequestedBaseForWarehouse(refLines, line, whCode, "", true);
    const availableBase = await getBalance(whCode, "");
    if (requestedBase <= availableBase) return { wh_code: whCode, shelf_code: "", wh_only: true };
  }
  return null;
}

async function resolveRefDocWarehouses(refLines) {
  if (!(await refreshCompanyOptionsForStockControl())) return [];
  const notices = [];
  const balanceCache = new Map();
  const posWhCode = String(posStore.selectedPos?.pos_ic_wht || "")
    .trim()
    .toUpperCase();
  for (const line of refLines) {
    if (!String(line?.item_code || "").trim() || isServiceItem(line) || isSetItem(line)) continue;
    const currentWhCode = String(line.wh_code || defaultSaleWarehouseCode([posStore.selectedPos?.pos_ic_wht]) || "").trim();
    const currentShelfCode = String(line.shelf_code || posStore.selectedPos?.pos_ic_shelf || "").trim();
    const currentAllowed = !currentWhCode || isSaleWarehouseAllowed(currentWhCode);
    const currentRequestedBase = refDocRequestedBaseForWarehouse(refLines, line, currentWhCode, currentShelfCode, false);
    const currentAvailableBase = currentAllowed ? await getInventoryBalance(line.item_code, currentWhCode || "", currentShelfCode || "").catch(() => 0) : 0;
    if (currentAllowed && currentRequestedBase <= currentAvailableBase) continue;
    const fallback = await findRefDocWarehouseWithStock(line, refLines, balanceCache);
    if (!fallback) continue;
    const oldWhCode = String(line.wh_code || "").trim();
    line.wh_code = fallback.wh_code;
    line.shelf_code = fallback.shelf_code;
    line._stock_wh_only = fallback.wh_only;
    line.balance_base = null;
    if (
      String(fallback.wh_code || "")
        .trim()
        .toUpperCase() !== posWhCode
    ) {
      notices.push({
        item_code: String(line.item_code || "").trim(),
        item_name: String(line.item_name || line.item_code || "").trim(),
        old_wh_code: oldWhCode,
        wh_code: fallback.wh_code,
      });
    }
  }
  return notices;
}

function showRefDocWarehouseNotice(notices = []) {
  refDocWarehouseNotices.value = Array.isArray(notices) ? notices.filter((notice) => notice?.wh_code) : [];
  refDocWarehouseNoticeVisible.value = refDocWarehouseNotices.value.length > 0;
}

function collectRefDocWarehouseNotices(refLines, notices = []) {
  const posWhCode = String(posStore.selectedPos?.pos_ic_wht || "")
    .trim()
    .toUpperCase();
  if (!posWhCode) return notices;
  const noticeMap = new Map();
  for (const notice of Array.isArray(notices) ? notices : []) {
    if (!notice?.wh_code) continue;
    noticeMap.set(`${notice.item_code || ""}|${notice.wh_code || ""}`, notice);
  }
  for (const line of Array.isArray(refLines) ? refLines : []) {
    const whCode = String(line?.wh_code || "").trim();
    if (!whCode || whCode.toUpperCase() === posWhCode) continue;
    const key = `${line.item_code || ""}|${whCode}`;
    if (noticeMap.has(key)) continue;
    noticeMap.set(key, {
      item_code: String(line.item_code || "").trim(),
      item_name: String(line.item_name || line.item_code || "").trim(),
      old_wh_code: "",
      wh_code: whCode,
    });
  }
  return [...noticeMap.values()];
}

async function validateReservationRefDocStock(refLines) {
  if (!(await refreshCompanyOptionsForStockControl())) return true;
  const groups = new Map();
  const refKeys = new Set(
    buildStockValidationRowsFromLines(refLines)
      .filter((line) => !isServiceItem(line) && !isSetItem(line))
      .map((line) => `${line.item_code}|${line.wh_code || ""}|${line.shelf_code || ""}`),
  );
  const stockRows = buildStockValidationRowsFromLines([...validRows.value, ...refLines]);
  for (const line of stockRows) {
    if (isServiceItem(line) || isSetItem(line)) continue;
    const key = `${line.item_code}|${line.wh_code || ""}|${line.shelf_code || ""}`;
    const group = groups.get(key) || { line, requestedBase: 0 };
    group.requestedBase += toNumber(line.qty) * unitRatio(line);
    groups.set(key, group);
  }

  const details = [];
  const seen = new Set();
  for (const { line, requestedBase } of groups.values()) {
    const groupKey = `${line.item_code}|${line.wh_code || ""}|${line.shelf_code || ""}`;
    if (!refKeys.has(groupKey)) continue;
    const availableBase = await getInventoryBalance(line.item_code, line.wh_code || "", line.shelf_code || "").catch(() => 0);
    if (requestedBase <= availableBase) continue;
    const whCode = String(line.wh_code || "").trim() || "-";
    const itemCode = String(line.item_code || "").trim();
    const itemName = String(line.item_name || "").trim();
    const detailKey = `${itemCode}|${whCode}`;
    if (seen.has(detailKey)) continue;
    details.push(
      `${itemCode}${itemName ? ` ${itemName}` : ""} ${tl("ไม่มีสต๊อกที่คลัง", "has no stock at warehouse", "ບໍ່ມີສະຕັອກຢູ່ຄັງ")} ${whCode}`,
    );
    seen.add(detailKey);
  }

  if (!details.length) return true;
  openSalePolicyDialog({
    type: "warn",
    title: tl("ไม่สามารถทำรายการได้", "Cannot process this document", "ບໍ່ສາມາດເຮັດລາຍການໄດ້"),
    message: tl("กรุณาตรวจสอบ", "Please check.", "ກະລຸນາກວດສອບ"),
    details,
  });
  return false;
}

async function onRefDocConfirm({ docNo, docDate, billType, saleCode: refSaleCode = "", saleName: refSaleName = "", items }) {
  if (!items?.length) return;
  const refLines = items.map((it) => makeLineFromRef(it));
  let warehouseNotices = [];
  try {
    await checkSalePoliciesForLines(refLines);
    if (isReservationRefBillType(billType)) {
      if (!(await validateReservationRefDocStock(refLines))) return;
    } else {
      warehouseNotices = await resolveRefDocWarehouses(refLines);
    }
    await validateStockBeforeSave(buildStockValidationRowsFromLines([...validRows.value, ...refLines]));
    warehouseNotices = collectRefDocWarehouseNotices(refLines, warehouseNotices);
  } catch (error) {
    if (
      !handleSalePolicyError(error, {
        title: tl("ดึงรายการไม่ได้", "Cannot pull items", "ດຶງລາຍການບໍ່ໄດ້"),
      })
    ) {
      const detail = error.message || tl("รายการสินค้าไม่ผ่านเงื่อนไขการขาย", "Product items do not pass sale policy", "ລາຍການສິນຄ້າບໍ່ຜ່ານເງື່ອນໄຂການຂາຍ");
      openSalePolicyDialog({
        type: "warn",
        title: tl("ดึงรายการไม่ได้", "Cannot pull items", "ດຶງລາຍການບໍ່ໄດ້"),
        message: tl("ไม่สามารถดึงรายการเข้าตารางได้", "Cannot add these reference items to the table.", "ບໍ່ສາມາດດຶງລາຍການເຂົ້າຕາຕະລາງໄດ້"),
        details: [detail],
      });
    }
    return;
  }
  for (const line of refLines) {
    mergeOrPushLine(line);
  }
  const nextSaleCode = String(refSaleCode || "").trim();
  if (nextSaleCode) {
    saleCode.value = nextSaleCode;
    saleName.value = String(refSaleName || nextSaleCode).trim();
  }
  // append เป็น 1 แถวใน mini-table — รองรับดึงหลายใบ
  pulledRefDocs.value.push({
    doc_no: docNo,
    doc_date: String(docDate || "").slice(0, 10),
    ref_doc_no: "",
    ref_doc_date: "",
    bill_type: Number(billType) || 0,
    remark: "",
    sale_code: nextSaleCode,
    sale_name: String(refSaleName || "").trim(),
    item_count: items.length,
  });
  toast.add({
    severity: "success",
    summary: tl("ดึงรายการสำเร็จ", "Items pulled", "ດຶງລາຍການສຳເລັດ"),
    detail: tl(`${docNo} : ${items.length} รายการ`, `${docNo}: ${items.length} item(s)`, `${docNo}: ${items.length} ລາຍການ`),
    life: 2500,
  });
  showRefDocWarehouseNotice(warehouseNotices);
}

function removePulledRefDoc(docNo) {
  pulledRefDocs.value = pulledRefDocs.value.filter((r) => r.doc_no !== docNo);
  // unlink lines ที่ผูกกับเลขนี้ (เก็บ items ไว้ — user แก้/ลบเองได้)
  for (const line of rows.value) {
    if (line.ref_doc_no === docNo) {
      line.ref_doc_no = "";
      line.ref_row = 0;
    }
  }
}

function mergeOrPushLine(line) {
  if (line.serial_number) {
    const duplicateSerial = rows.value.some((row) => String(row.serial_number || "").trim() === line.serial_number);
    if (duplicateSerial) throw new Error(tl(`ยิงหมายเลขเครื่องไปแล้ว : ${line.serial_number}`, `Serial was already scanned: ${line.serial_number}`, `ສະແກນເລກເຄື່ອງນີ້ແລ້ວ: ${line.serial_number}`));
  }
  const existing = rows.value.find(
    (row) =>
      row.item_code === line.item_code &&
      String(row.item_name || "").trim() === String(line.item_name || "").trim() &&
      row.unit_code === line.unit_code &&
      String(row.barcode || "") === String(line.barcode || "") &&
      String(row.serial_number || "") === String(line.serial_number || "") &&
      String(row.wh_code || "") === String(line.wh_code || "") &&
      String(row.shelf_code || "") === String(line.shelf_code || ""),
  );
  if (existing) {
    const existingPriceLocked = isPriceRefreshLockedLine(existing);
    existing.qty = rnd(toNumber(existing.qty) + toNumber(line.qty));
    if (!existingPriceLocked) {
      existing.price = line.price;
      existing.discount = line.discount;
      existing.price_manual = isManualPriceLine(line);
      existing.price_locked = line.price_locked === true || toNumber(line.price_locked) === 1;
    }
    existing.price_type = line.price_type;
    existing.price_mode = line.price_mode;
    existing.price_info = line.price_info;
    existing.price_default = line.price_default;
    existing.have_point = line.have_point;
    existing.drink_type = line.drink_type;
    existing.no_discount = line.no_discount;
    existing.is_permium = line.is_permium;
    existing.is_premium = line.is_premium;
    existing.is_free = line.is_free;
    existing.promotion_free = line.promotion_free;
    existing.premium = line.premium;
    // สินค้าชุด: refresh sub_item ด้วย (เผื่อ child price/qty เปลี่ยนตาม customer)
    if (isSetItem(line) && Array.isArray(line.sub_item) && line.sub_item.length) {
      existing.sub_item = line.sub_item;
    }
    // ผูก ref linkage จาก line ใหม่ทับเสมอ (ดึงเอกสารใหม่ → ต้องผูกใหม่)
    if (line.ref_doc_no) {
      existing.ref_doc_no = line.ref_doc_no;
      existing.ref_row = line.ref_row;
    }
    touchLineDisplayOrder(existing);
    return;
  }
  if (!lineDisplayOrder(line)) touchLineDisplayOrder(line);
  rows.value.push(line);
}

function inputEventValue(event) {
  return event?.value ?? event?.target?.value ?? event;
}

function isManualPriceLine(line) {
  return line?.price_manual === true || toNumber(line?.price_manual) === 1;
}

function isPriceRefreshLockedLine(line) {
  return isManualPriceLine(line) || line?.price_locked === true || toNumber(line?.price_locked) === 1;
}

function showLineQtyValidationError(error) {
  if (
    handleSalePolicyError(error, {
      title: tl("แก้จำนวนไม่ได้", "Cannot change quantity", "ປ່ຽນຈຳນວນບໍ່ໄດ້"),
      message: tl("จำนวนสินค้าไม่ผ่านเงื่อนไขการขาย", "Product quantity does not pass sale policy", "ຈຳນວນສິນຄ້າບໍ່ຜ່ານເງື່ອນໄຂການຂາຍ"),
    })
  ) {
    return;
  }
  const detail = error.message || tl("สินค้าไม่พอขาย", "Insufficient stock", "ສິນຄ້າບໍ່ພໍຂາຍ");
  const stockAdjustmentContext = saleStockAdjustmentContextFromIssue(error.stockIssue);
  openSalePolicyDialog({
    type: "warn",
    title: tl("แก้จำนวนไม่ได้", "Cannot change quantity", "ປ່ຽນຈຳນວນບໍ່ໄດ້"),
    message: tl("จำนวนสินค้าไม่ผ่านเงื่อนไขการขาย", "Product quantity does not pass sale policy", "ຈຳນວນສິນຄ້າບໍ່ຜ່ານເງື່ອນໄຂການຂາຍ"),
    details: [detail],
    stockAdjustmentContext,
  });
}

async function validateLineQtyChange(line) {
  try {
    await validateStockBeforeSave(buildStockValidationRows());
    await checkSalePoliciesForLines([line]);
  } catch (error) {
    showLineQtyValidationError(error);
  }
}

async function setLineQty(line, value) {
  if (documentLocked.value) return;
  const qty = Number(
    String(inputEventValue(value) ?? "")
      .trim()
      .replace(",", "."),
  );
  if (!Number.isFinite(qty) || qty < 0) return;
  const currentQty = toNumber(line.qty);
  if (rnd(currentQty, 6) === rnd(qty, 6)) return;
  line.qty = qty;
  schedulePriceRefresh();
  await validateLineQtyChange(line);
}

async function setLinePrice(line, value) {
  if (documentLocked.value) return;
  const price = toNumber(inputEventValue(value));
  if (price < 0) return;
  const originalPrice = toNumber(line.price);
  const originalManualPrice = line.price_manual;
  const originalPriceLocked = line.price_locked;
  line.price = price;
  line.price_manual = true;
  line.price_locked = true;
  line.price_error = "";
  try {
    await checkSalePoliciesForLines([line]);
  } catch (error) {
    line.price = originalPrice;
    line.price_manual = originalManualPrice;
    line.price_locked = originalPriceLocked;
    throw error;
  }
}

function adjustLineQty(line, delta) {
  if (documentLocked.value) return;
  setLineQty(line, rnd(toNumber(line.qty) + delta));
}

function requestProtectedActionPermission({ actionLabel, action, verifier, deniedText, header, helpText, allowLocked = false }) {
  if ((!allowLocked && documentLocked.value) || typeof action !== "function") return;
  pricePermissionActionLabel.value = actionLabel || tl("ยืนยันสิทธิ์", "Authorize action", "ຢືນຢັນສິດ");
  pricePermissionAction.value = action;
  pricePermissionVerifier.value = verifier || verifyPriceEditPermission;
  pricePermissionDeniedText.value = deniedText || tl("ผู้ใช้นี้ไม่มีสิทธิ์ทำรายการนี้", "This user is not allowed to perform this action", "ຜູ້ໃຊ້ນີ້ບໍ່ມີສິດເຮັດລາຍການນີ້");
  pricePermissionHeader.value = header || tl("ยืนยันสิทธิ์", "Authorize action", "ຢືນຢັນສິດ");
  pricePermissionHelpText.value = helpText || tl("ต้องใช้ผู้ใช้ที่มีสิทธิ์", "Requires a user with permission", "ຕ້ອງໃຊ້ຜູ້ໃຊ້ທີ່ມີສິດ");
  pricePermissionUser.value = "";
  pricePermissionPassword.value = "";
  pricePermissionError.value = "";
  pricePermissionDialogVisible.value = true;
}

function requestPriceEditPermission(actionLabel, action) {
  requestProtectedActionPermission({
    actionLabel: actionLabel || tl("แก้ไขราคา/ส่วนลด", "Edit price/discount", "ແກ້ໄຂລາຄາ/ສ່ວນຫຼຸດ"),
    action,
    verifier: verifyPriceEditPermission,
    deniedText: tl("ผู้ใช้นี้ไม่มีสิทธิ์แก้ไขราคา/ส่วนลด", "This user cannot edit price or discount", "ຜູ້ໃຊ້ນີ້ບໍ່ມີສິດແກ້ໄຂລາຄາ/ສ່ວນຫຼຸດ"),
    header: tl("ยืนยันสิทธิ์แก้ไขราคา/ส่วนลด", "Authorize price/discount edit", "ຢືນຢັນສິດແກ້ໄຂລາຄາ/ສ່ວນຫຼຸດ"),
    helpText: tl("ต้องใช้ผู้ใช้ที่มีสิทธิ์แก้ไขราคา/ส่วนลด", "Requires a user with price/discount edit permission", "ຕ້ອງໃຊ້ຜູ້ໃຊ້ທີ່ມີສິດແກ້ໄຂລາຄາ/ສ່ວນຫຼຸດ"),
  });
}

function openSaleStockAdjustmentPermission() {
  const context = salePolicyStockAdjustmentContext.value;
  if (!context?.item_code || stockAdjustmentSaving.value) return;
  salePolicyDialogVisible.value = false;
  requestProtectedActionPermission({
    actionLabel: tl("ปรับปรุงสต๊อกจากหน้าขาย", "Adjust stock from sale", "ປັບປຸງສະຕ໊ອກຈາກໜ້າຂາຍ"),
    action: (result, credentials = {}) => {
      stockAdjustmentAuth.value = {
        user_code: result?.user_code || credentials.userCode || "",
        user_name: result?.user_name || "",
        password: credentials.password || "",
      };
      stockAdjustmentQtyText.value = String(context.requested_qty || "");
      stockAdjustmentError.value = "";
      stockAdjustmentResult.value = null;
      stockAdjustmentDialogVisible.value = true;
    },
    verifier: verifyPriceEditPermission,
    deniedText: tl("ผู้ใช้นี้ไม่มีสิทธิ์แก้ไขราคา/ส่วนลด", "This user cannot edit price or discount", "ຜູ້ໃຊ້ນີ້ບໍ່ມີສິດແກ້ໄຂລາຄາ/ສ່ວນຫຼຸດ"),
    header: tl("ยืนยันสิทธิ์ปรับปรุงสต๊อก", "Authorize stock adjustment", "ຢືນຢັນສິດປັບປຸງສະຕ໊ອກ"),
    helpText: tl("ใช้สิทธิ์เดียวกับแก้ไขราคา/ส่วนลด", "Uses the same permission as price/discount edit", "ໃຊ້ສິດດຽວກັບແກ້ໄຂລາຄາ/ສ່ວນຫຼຸດ"),
  });
}

function closeSaleStockAdjustmentDialog() {
  if (stockAdjustmentSaving.value) return;
  stockAdjustmentDialogVisible.value = false;
  stockAdjustmentAuth.value = null;
  stockAdjustmentQtyText.value = "";
  stockAdjustmentError.value = "";
  if (stockAdjustmentResult.value) {
    stockAdjustmentResult.value = null;
    salePolicyStockAdjustmentContext.value = null;
  }
}

function saleStockAdjustmentQtyValue() {
  const value = Number(String(stockAdjustmentQtyText.value || "").replace(/,/g, "."));
  return Number.isFinite(value) ? value : NaN;
}

function requestSaveSaleStockAdjustment() {
  const qty = saleStockAdjustmentQtyValue();
  if (!Number.isFinite(qty) || qty < 0) {
    stockAdjustmentError.value = tl("กรุณาระบุจำนวนสต๊อกจริง", "Please enter the actual stock quantity", "ກະລຸນາລະບຸຈຳນວນສະຕ໊ອກຈິງ");
    return;
  }
  confirm.require({
    header: tl("ยืนยันบันทึกปรับปรุงสต๊อก", "Confirm stock adjustment", "ຢືນຢັນບັນທຶກປັບປຸງສະຕ໊ອກ"),
    draggable: false,
    message: tl(
      `ต้องการปรับยอดสต๊อกจริงเป็น ${qty} ${salePolicyStockAdjustmentContext.value?.unit_code || ""} ใช่หรือไม่`,
      `Set actual stock to ${qty} ${salePolicyStockAdjustmentContext.value?.unit_code || ""}?`,
      `ຕ້ອງການປັບຍອດສະຕ໊ອກຈິງເປັນ ${qty} ${salePolicyStockAdjustmentContext.value?.unit_code || ""} ບໍ?`,
    ),
    icon: "pi pi-exclamation-triangle",
    rejectLabel: t("sell.cancel"),
    rejectClass: "p-button-secondary",
    acceptLabel: tl("บันทึก", "Save", "ບັນທຶກ"),
    acceptClass: "p-button-warning",
    accept: () => {
      void saveSaleStockAdjustment(qty);
    },
  });
}

async function saveSaleStockAdjustment(qty) {
  const context = salePolicyStockAdjustmentContext.value;
  const auth = stockAdjustmentAuth.value;
  if (!context?.item_code || !auth?.user_code || !auth?.password) return;
  stockAdjustmentSaving.value = true;
  stockAdjustmentError.value = "";
  try {
    const result = await adjustStockFromSale({
      item_code: context.item_code,
      item_name: context.item_name,
      unit_code: context.unit_code,
      barcode: context.barcode,
      wh_code: context.wh_code,
      shelf_code: context.shelf_code,
      branch_code: context.branch_code,
      pos_id: context.pos_id,
      pos_code: context.pos_code,
      qty,
      user_code: auth.user_code,
      password: auth.password,
    });
    stockAdjustmentAuth.value = null;
    stockAdjustmentResult.value = result || {};
    toast.add({
      severity: "success",
      summary: tl("ปรับปรุงสต๊อกสำเร็จ", "Stock adjusted", "ປັບປຸງສະຕ໊ອກສຳເລັດ"),
      detail: result?.adjust_doc_no || result?.doc_no || "",
      life: 3500,
    });
  } catch (error) {
    stockAdjustmentError.value = error?.data?.msg || error?.data?.ERROR || error.message || tl("บันทึกปรับปรุงสต๊อกไม่สำเร็จ", "Failed to adjust stock", "ບັນທຶກປັບປຸງສະຕ໊ອກບໍ່ສຳເລັດ");
  } finally {
    stockAdjustmentSaving.value = false;
  }
}

function requestViewOnlyEditDocument() {
  const docNo = String(oldDocNo.value || route.query.doc_no || "").trim();
  if (!docNo || !docCanEdit.value || !canEditSalesDocument.value) return;
  requestProtectedActionPermission({
    actionLabel: `${tl("แก้ไขเอกสาร", "Edit document", "ແກ້ໄຂເອກະສານ")} ${docNo}`,
    action: () => router.push({ name: "Sell", query: { doc_no: docNo } }),
    verifier: verifyPriceEditPermission,
    deniedText: tl("ผู้ใช้นี้ไม่มีสิทธิ์แก้ไขราคา/ส่วนลด", "This user cannot edit price or discount", "ຜູ້ໃຊ້ນີ້ບໍ່ມີສິດແກ້ໄຂລາຄາ/ສ່ວນຫຼຸດ"),
    header: tl("ยืนยันสิทธิ์แก้ไขเอกสาร", "Authorize document edit", "ຢືນຢັນສິດແກ້ໄຂເອກະສານ"),
    helpText: tl("ต้องใช้ผู้ใช้ที่มีสิทธิ์แก้ไขราคา/ส่วนลด", "Requires a user with price/discount edit permission", "ຕ້ອງໃຊ້ຜູ້ໃຊ້ທີ່ມີສິດແກ້ໄຂລາຄາ/ສ່ວນຫຼຸດ"),
    allowLocked: true,
  });
}

function requestPrintDocument() {
  if (!isViewOnly.value) {
    openPrintDialog();
    return;
  }
  const docNo = String(activePrintDocNo.value || oldDocNo.value || route.query.doc_no || "").trim();
  if (!docNo || !canPrintSalesDocument.value) return;
  requestProtectedActionPermission({
    actionLabel: `${tl("พิมพ์เอกสาร", "Print document", "ພິມເອກະສານ")} ${docNo}`,
    action: openPrintDialog,
    verifier: verifyPriceEditPermission,
    deniedText: tl("ผู้ใช้นี้ไม่มีสิทธิ์แก้ไขราคา/ส่วนลด", "This user cannot edit price or discount", "ຜູ້ໃຊ້ນີ້ບໍ່ມີສິດແກ້ໄຂລາຄາ/ສ່ວນຫຼຸດ"),
    header: tl("ยืนยันสิทธิ์พิมพ์เอกสาร", "Authorize document print", "ຢືນຢັນສິດພິມເອກະສານ"),
    helpText: tl("ต้องใช้ผู้ใช้ที่มีสิทธิ์แก้ไขราคา/ส่วนลด", "Requires a user with price/discount edit permission", "ຕ້ອງໃຊ້ຜູ້ໃຊ້ທີ່ມີສິດແກ້ໄຂລາຄາ/ສ່ວນຫຼຸດ"),
    allowLocked: true,
  });
}

function exchangeRateEditKey(key) {
  return String(key || "").trim();
}

function isExchangeRateEditAuthorized(key) {
  const target = exchangeRateEditKey(key);
  return !!target && exchangeRateEditAuthorized.value[target] === true;
}

function resetExchangeRateEditAuthorization() {
  exchangeRateEditAuthorized.value = {};
}

function requestExchangeRateEditPermission(key, target = null) {
  const permissionKey = exchangeRateEditKey(key);
  if (!permissionKey || documentLocked.value) return;
  if (isExchangeRateEditAuthorized(permissionKey)) {
    nextTick(() => {
      target?.focus?.();
      target?.select?.();
    });
    return;
  }
  if (pricePermissionDialogVisible.value) return;
  requestProtectedActionPermission({
    actionLabel: tl("แก้ไขอัตราแลกเปลี่ยน", "Edit exchange rate", "ແກ້ໄຂອັດຕາແລກປ່ຽນ"),
    action: () => {
      exchangeRateEditAuthorized.value = {
        ...exchangeRateEditAuthorized.value,
        [permissionKey]: true,
      };
      nextTick(() => {
        target?.focus?.();
        target?.select?.();
      });
    },
    verifier: verifyPriceEditPermission,
    deniedText: tl("ผู้ใช้นี้ไม่มีสิทธิ์แก้ไขอัตราแลกเปลี่ยน", "This user cannot edit exchange rates", "ຜູ້ໃຊ້ນີ້ບໍ່ມີສິດແກ້ໄຂອັດຕາແລກປ່ຽນ"),
    header: tl("ยืนยันสิทธิ์แก้ไขอัตราแลกเปลี่ยน", "Authorize exchange rate edit", "ຢືນຢັນສິດແກ້ໄຂອັດຕາແລກປ່ຽນ"),
    helpText: tl("ต้องใช้ผู้ใช้ที่มีสิทธิ์แก้ไขราคา/ส่วนลด", "Requires a user with price/discount edit permission", "ຕ້ອງໃຊ້ຜູ້ໃຊ້ທີ່ມີສິດແກ້ໄຂລາຄາ/ສ່ວນຫຼຸດ"),
  });
}

function guardExchangeRateEdit(key, disabled, event = null) {
  if (disabled || isExchangeRateEditAuthorized(key)) return;
  event?.preventDefault?.();
  const target = event?.target || null;
  target?.blur?.();
  requestExchangeRateEditPermission(key, target);
}

function commitProtectedExchangeRate(key, disabled, commit, event = null) {
  if (disabled) return;
  if (!isExchangeRateEditAuthorized(key)) {
    guardExchangeRateEdit(key, disabled, event);
    return;
  }
  if (typeof commit === "function") commit(event);
}

function closePricePermissionDialog() {
  if (pricePermissionLoading.value) return;
  pricePermissionDialogVisible.value = false;
  pricePermissionAction.value = null;
  pricePermissionVerifier.value = verifyPriceEditPermission;
  pricePermissionPassword.value = "";
  pricePermissionError.value = "";
}

async function submitPricePermission() {
  if (pricePermissionLoading.value) return;
  const userCode = String(pricePermissionUser.value || "").trim();
  const password = String(pricePermissionPassword.value || "");
  if (!userCode || !password) {
    pricePermissionError.value = tl("กรุณาระบุรหัสผู้ใช้และรหัสผ่าน", "Please enter user code and password", "ກະລຸນາລະບຸລະຫັດຜູ້ໃຊ້ແລະລະຫັດຜ່ານ");
    return;
  }
  pricePermissionLoading.value = true;
  pricePermissionError.value = "";
  try {
    const verifier = pricePermissionVerifier.value || verifyPriceEditPermission;
    const result = await verifier(userCode, password);
    if (!result?.allowed) {
      pricePermissionError.value = pricePermissionDeniedText.value || tl("ผู้ใช้นี้ไม่มีสิทธิ์ทำรายการนี้", "This user is not allowed to perform this action", "ຜູ້ໃຊ້ນີ້ບໍ່ມີສິດເຮັດລາຍການນີ້");
      return;
    }
    const action = pricePermissionAction.value;
    pricePermissionDialogVisible.value = false;
    pricePermissionAction.value = null;
    pricePermissionVerifier.value = verifyPriceEditPermission;
    pricePermissionPassword.value = "";
    if (typeof action === "function") action(result, { userCode, password });
  } catch (error) {
    pricePermissionError.value = error?.data?.msg || error.message || tl("รหัสผู้ใช้หรือรหัสผ่านไม่ถูกต้อง", "Invalid user code or password", "ລະຫັດຜູ້ໃຊ້ ຫຼື ລະຫັດຜ່ານບໍ່ຖືກຕ້ອງ");
  } finally {
    pricePermissionLoading.value = false;
  }
}

function openPriceEditor(line) {
  if (documentLocked.value || line.price_loading) return;
  requestPriceEditPermission(tl("แก้ไขราคา", "Edit price", "ແກ້ໄຂລາຄາ"), () => {
    priceEditLine.value = line;
    priceEditValue.value = toNumber(line.price);
    priceEditorVisible.value = true;
  });
}

async function confirmPriceEditor() {
  if (!priceEditLine.value) return;
  try {
    await setLinePrice(priceEditLine.value, priceEditValue.value);
    priceEditorVisible.value = false;
    priceEditLine.value = null;
  } catch (error) {
    if (
      !handleSalePolicyError(error, {
        title: tl("แก้ราคาไม่ได้", "Cannot change price", "ປ່ຽນລາຄາບໍ່ໄດ້"),
      })
    ) {
      toast.add({
        severity: "warn",
        summary: tl("แก้ราคาไม่ได้", "Cannot change price", "ປ່ຽນລາຄາບໍ່ໄດ້"),
        detail: error.message || tl("ราคาไม่ผ่านเงื่อนไขการขาย", "Price does not pass sale policy", "ລາຄາບໍ່ຜ່ານເງື່ອນໄຂການຂາຍ"),
        life: 3200,
      });
    }
  }
}

function openRemarkEditor(line) {
  if (documentLocked.value) return;
  remarkEditLine.value = line;
  remarkEditText.value = line.remark || "";
  remarkEditorVisible.value = true;
}

function confirmRemarkEditor() {
  if (!remarkEditLine.value) return;
  remarkEditLine.value.remark = remarkEditText.value.trim();
  remarkEditorVisible.value = false;
  remarkEditLine.value = null;
}

function canEditLineItemName(line) {
  if (!isCompanyOptionEnabled("lock_edit_product_name_in_detail", false)) return true;
  return String(line?.item_code || "").trim() === "."; // ล็อกแล้วแก้ได้เฉพาะบรรทัดข้อความอิสระ
}

function openNameEditor(line) {
  if (documentLocked.value || !canEditLineItemName(line)) return;
  nameEditLine.value = line;
  nameEditText.value = line.item_name || "";
  nameEditorVisible.value = true;
}

function confirmNameEditor() {
  if (!nameEditLine.value) return;
  const text = String(nameEditText.value || "").trim();
  if (text) nameEditLine.value.item_name = text; // ไม่ให้เป็นค่าว่าง
  nameEditorVisible.value = false;
  nameEditLine.value = null;
}

function openDiscountEditor(line) {
  if (documentLocked.value) return;
  requestPriceEditPermission(tl("แก้ไขส่วนลดรายการ", "Edit line discount", "ແກ້ໄຂສ່ວນຫຼຸດລາຍການ"), () => {
    discountEditLine.value = line;
    discountEditText.value = String(line.discount || "").trim();
    discountEditorVisible.value = true;
  });
}

function confirmDiscountEditor() {
  if (!discountEditLine.value) return;
  discountEditLine.value.discount = discountEditText.value.trim();
  discountEditorVisible.value = false;
  discountEditLine.value = null;
}

function openBillDiscountEditor() {
  if (documentLocked.value) return;
  requestPriceEditPermission(tl("แก้ไขส่วนลดท้ายบิล", "Edit bill discount", "ແກ້ໄຂສ່ວນຫຼຸດທ້າຍບິນ"), () => {
    billDiscountEditText.value = String(discountWord.value || "").trim();
    billDiscountEditorVisible.value = true;
  });
}

function confirmBillDiscountEditor() {
  discountWord.value = String(billDiscountEditText.value || "").trim();
  billDiscountEditorVisible.value = false;
}

async function loadLineUnitOptions(line) {
  const itemCode = String(line?.item_code || "").trim();
  if (!itemCode) return [];
  if (isSetItem(line)) return getProductSetDetail(itemCode, custCode.value, priceOpts());
  return getProductDetail(itemCode, custCode.value, priceOpts());
}

async function openUnitEditor(line) {
  if (documentLocked.value || line?.price_loading || unitEditLoading.value || unitEditSaving.value) return;
  unitEditLine.value = line;
  unitEditOptions.value = [];
  unitEditError.value = "";
  unitEditSelectedKey.value = "";
  unitEditorVisible.value = true;
  unitEditLoading.value = true;
  try {
    const units = await loadLineUnitOptions(line);
    unitEditOptions.value = Array.isArray(units) ? units.filter((unit) => String(unit?.unit_code || "").trim()) : [];
    const currentUnit = unitEditOptions.value.find((unit) => String(unit.unit_code || "") === String(line.unit_code || ""));
    unitEditSelectedKey.value = unitOptionKey(currentUnit || unitEditOptions.value[0] || line);
    if (!unitEditOptions.value.length) {
      unitEditError.value = tl("ไม่พบหน่วยนับของสินค้านี้", "No unit options were found for this product", "ບໍ່ພົບໜ່ວຍນັບຂອງສິນຄ້ານີ້");
    }
  } catch (error) {
    unitEditError.value = error.message || tl("โหลดหน่วยนับไม่สำเร็จ", "Failed to load product units", "ໂຫຼດໜ່ວຍນັບບໍ່ສຳເລັດ");
  } finally {
    unitEditLoading.value = false;
  }
}

function closeUnitEditor(force = false) {
  if (unitEditSaving.value && !force) return;
  unitEditorVisible.value = false;
  unitEditLine.value = null;
  unitEditOptions.value = [];
  unitEditSelectedKey.value = "";
  unitEditError.value = "";
}

function snapshotLineUnitState(line) {
  return {
    unit_code: line.unit_code,
    barcode: line.barcode,
    price: line.price,
    discount: line.discount,
    price_type: line.price_type,
    price_mode: line.price_mode,
    price_info: line.price_info,
    price_default: line.price_default,
    price_manual: line.price_manual,
    price_locked: line.price_locked,
    stand_value: line.stand_value,
    divide_value: line.divide_value,
    ratio: line.ratio,
    balance_base: line.balance_base,
    sub_item: Array.isArray(line.sub_item) ? [...line.sub_item] : line.sub_item,
    price_error: line.price_error,
  };
}

function restoreLineUnitState(line, state) {
  Object.assign(line, state);
}

async function confirmUnitEditor() {
  const line = unitEditLine.value;
  const unit = unitEditSelectedUnit.value;
  if (!line || !unit || unitEditSaving.value) return;
  const nextUnitCode = String(unit.unit_code || "").trim();
  if (!nextUnitCode) return;
  if (nextUnitCode === String(line.unit_code || "").trim() && String(unit.barcode || "") === String(line.barcode || "")) {
    closeUnitEditor();
    return;
  }

  const original = snapshotLineUnitState(line);
  unitEditSaving.value = true;
  line.price_loading = true;
  line.price_error = "";
  try {
    const ratio = unitRatio(unit);
    line.unit_code = nextUnitCode;
    line.barcode = String(unit.barcode || "").trim();
    line.stand_value = toNumber(unit.stand_value, 1);
    line.divide_value = toNumber(unit.divide_value, 1);
    line.ratio = ratio;
    line.balance_base = isSetItem(line) ? 0 : unitBaseBalance(unit, ratio);
    line.price_manual = false;
    line.price_locked = false;

    if (isSetItem(line)) {
      line.price = toNumber(unit.price ?? line.price);
      line.price_default = toNumber(unit.price ?? line.price_default ?? line.price);
      line.price_type = toNumber(unit.type ?? unit.price_type ?? line.price_type ?? 1, 1);
      line.price_mode = toNumber(unit.mode ?? line.price_mode ?? 0, 0);
      line.price_info = unit.mode ?? line.price_info ?? "";
      const subItems = await getProductSetItem(line.item_code).catch(() => null);
      if (Array.isArray(subItems) && subItems.length) line.sub_item = subItems;
    } else {
      const price = await getPosLinePrice(line.item_code, line.unit_code, line.qty, line.barcode || "");
      line.price = toNumber(price?.price ?? unit.price ?? line.price);
      line.discount = price?.defaultDiscount ?? "";
      line.price_type = toNumber(price?.type ?? price?.price_type ?? unit.type ?? unit.price_type ?? line.price_type ?? 1, 1);
      line.price_mode = toNumber(price?.mode ?? unit.mode ?? line.price_mode ?? 0, 0);
      line.price_info = price?.mode ?? unit.mode ?? "";
      line.price_default = toNumber(price?.price ?? unit.price ?? line.price_default ?? line.price);
    }

    await checkSalePoliciesForLines([line]);
    closeUnitEditor(true);
  } catch (error) {
    restoreLineUnitState(line, original);
    if (
      !handleSalePolicyError(error, {
        title: tl("เปลี่ยนหน่วยนับไม่ได้", "Cannot change unit", "ປ່ຽນໜ່ວຍນັບບໍ່ໄດ້"),
      })
    ) {
      unitEditError.value = error.message || tl("เปลี่ยนหน่วยนับไม่สำเร็จ", "Failed to change product unit", "ປ່ຽນໜ່ວຍນັບບໍ່ສຳເລັດ");
    }
  } finally {
    line.price_loading = false;
    unitEditSaving.value = false;
  }
}

function schedulePriceRefresh(delay = 350) {
  clearTimeout(priceRefreshTimer);
  if (!rows.value.length) return;
  priceRefreshTimer = setTimeout(() => {
    void refreshLinePrices();
  }, delay);
}

async function refreshLinePrices() {
  if (!rows.value.length) return;
  const runId = ++priceRefreshRunId;
  priceRefreshing.value = true;
  const refreshedLines = [];
  const originalLineState = new Map();
  const rememberOriginalLineState = (line) => {
    if (originalLineState.has(line.id)) return;
    originalLineState.set(line.id, {
      price: toNumber(line.price),
      discount: line.discount,
      price_type: line.price_type,
      price_mode: line.price_mode,
      price_info: line.price_info,
      price_default: line.price_default,
      price_manual: line.price_manual,
      price_locked: line.price_locked,
    });
  };
  const markRefreshedLine = (line) => {
    if (!refreshedLines.includes(line)) refreshedLines.push(line);
  };
  try {
    await Promise.all(
      rows.value.map(async (line) => {
        if (!line.item_code || !line.unit_code || toNumber(line.qty) <= 0) return;
        line.price_loading = true;
        line.price_error = "";
        try {
          // สินค้าชุด: ใช้ /getProductSetDetail (ราคา parent ตาม customer/sale_type/vat)
          // และ re-fetch sub_item เผื่อ children ถูกแก้ใน master
          if (isSetItem(line)) {
            const priceLocked = isPriceRefreshLockedLine(line);
            const setRows = await getProductSetDetail(line.item_code, custCode.value, priceOpts());
            if (runId !== priceRefreshRunId) return;
            const setUnit = setRows.find((r) => r.unit_code === line.unit_code) || setRows[0] || null;
            if (setUnit) {
              rememberOriginalLineState(line);
              if (!priceLocked) line.price = toNumber(setUnit.price ?? line.price);
              line.price_default = toNumber(setUnit.price ?? line.price_default ?? line.price);
              line.price_type = toNumber(setUnit.type ?? setUnit.price_type ?? line.price_type ?? 1, 1);
              line.price_mode = toNumber(setUnit.mode ?? line.price_mode ?? 0, 0);
              line.price_info = setUnit.mode ?? line.price_info ?? "";
              markRefreshedLine(line);
            }
            const subItems = await getProductSetItem(line.item_code).catch(() => null);
            if (runId !== priceRefreshRunId) return;
            if (Array.isArray(subItems) && subItems.length) line.sub_item = subItems;
            return;
          }

          const price = await getPosLinePrice(line.item_code, line.unit_code, line.qty, line.barcode || "");
          if (runId !== priceRefreshRunId) return;
          rememberOriginalLineState(line);
          const priceLocked = isPriceRefreshLockedLine(line);
          if (!priceLocked) {
            line.price = toNumber(price?.price ?? line.price);
            line.discount = price?.defaultDiscount ?? line.discount ?? "";
          }
          line.price_type = toNumber(price?.type ?? price?.price_type ?? line.price_type ?? 1, 1);
          line.price_mode = toNumber(price?.mode ?? line.price_mode ?? 0, 0);
          line.price_info = price?.mode ?? line.price_info ?? "";
          line.price_default = toNumber(price?.price ?? line.price_default ?? line.price);
          markRefreshedLine(line);
        } catch (error) {
          if (runId !== priceRefreshRunId) return;
          line.price_error = error.message || tl("ดึงราคาไม่สำเร็จ", "Failed to load price", "ດຶງລາຄາບໍ່ສຳເລັດ");
        } finally {
          if (runId === priceRefreshRunId) line.price_loading = false;
        }
      }),
    );
    if (runId === priceRefreshRunId && refreshedLines.length) {
      try {
        await checkSalePoliciesForLines(refreshedLines);
        if (runId !== priceRefreshRunId) return;
      } catch (error) {
        if (runId !== priceRefreshRunId) return;
        for (const line of refreshedLines) {
          const original = originalLineState.get(line.id);
          if (!original) continue;
          line.price = original.price;
          line.discount = original.discount;
          line.price_type = original.price_type;
          line.price_mode = original.price_mode;
          line.price_info = original.price_info;
          line.price_default = original.price_default;
          line.price_manual = original.price_manual;
          line.price_locked = original.price_locked;
          line.price_error = error.message || tl("ราคาไม่ผ่านเงื่อนไขการขาย", "Price does not pass sale policy", "ລາຄາບໍ່ຜ່ານເງື່ອນໄຂການຂາຍ");
        }
        if (
          !handleSalePolicyError(error, {
            title: tl("ดึงราคาไม่ได้", "Cannot refresh price", "ດຶງລາຄາບໍ່ໄດ້"),
          })
        ) {
          toast.add({
            severity: "warn",
            summary: tl("ดึงราคาไม่ได้", "Cannot refresh price", "ດຶງລາຄາບໍ່ໄດ້"),
            detail: error.message || tl("ราคาไม่ผ่านเงื่อนไขการขาย", "Price does not pass sale policy", "ລາຄາບໍ່ຜ່ານເງື່ອນໄຂການຂາຍ"),
            life: 3600,
          });
        }
      }
    }
  } finally {
    if (runId === priceRefreshRunId) priceRefreshing.value = false;
  }
}

function clearPromotionCalculation() {
  clearTimeout(promotionTimer);
  promotionRunId += 1;
  promotionLoading.value = false;
  promotionDirty.value = false;
  promotionError.value = "";
  promotionResults.value = [];
  promotionProductRows.value = [];
  promotionDiscountRaw.value = 0;
  promotionLastCalculatedAt.value = "";
  clearPosCampaignCalculation();
}

function clearPosCampaignCalculation() {
  posCampaignLoading.value = false;
  posCampaignDirty.value = false;
  posCampaignError.value = "";
  posCampaignRows.value = [];
  posCampaignLastCalculatedAt.value = "";
}

function promotionDiscountNumber(line) {
  return String(line.discount || line.discount_amount || "").trim() ? 1 : 0;
}

function buildPromotionItems() {
  return validRows.value.map((line) => ({
    item_code: line.item_code,
    item_name: line.item_name,
    unit_code: line.unit_code,
    barcode: line.barcode || "",
    qty: toNumber(line.qty),
    price: toNumber(line.price),
    amount: lineSumAmount(line),
    discount_word: line.discount || "",
    discount: lineDiscountAmount(line),
    tax_type: toNumber(line.tax_type),
    vat_type: vatType.value,
    vat_rate: toNumber(vatRate.value, 7),
    stand_value: toNumber(line.stand_value, 1),
    divide_value: toNumber(line.divide_value, 1),
    price_type: toNumber(line.price_type ?? 1, 1),
    price_mode: toNumber(line.price_mode ?? line.price_info ?? 0, 0),
    price_default: toNumber(line.price_default ?? line.price),
    price_info: line.price_info || "",
    discount_number: promotionDiscountNumber(line),
    drink_type: toNumber(line.drink_type),
    have_point: line.have_point === true,
    no_discount: line.no_discount === true,
  }));
}

function buildPromotionPayload() {
  return {
    pos_id: posStore.posId,
    cust_code: custCode.value || "AR00569",
    member_code: promotionMemberCode.value,
    pos_default_cust: "AR00569",
    doc_date: docDate.value,
    items: buildPromotionItems(),
  };
}

function buildPromotionPayloadForSave({ docDate: promotionDocDate = docDate.value, docTime: promotionDocTime = docTime.value || localTimeHHMM(), items = buildPromotionItems() } = {}) {
  return {
    pos_id: posStore.posId,
    cust_code: custCode.value || "AR00569",
    member_code: promotionMemberCode.value,
    pos_default_cust: "AR00569",
    doc_date: promotionDocDate,
    doc_time: promotionDocTime,
    items,
  };
}

function buildPosCampaignItems() {
  return validRows.value.map((line) => ({
    item_code: line.item_code,
    item_name: line.item_name,
    unit_code: line.unit_code,
    qty: toNumber(line.qty),
    price: lineHomePrice(line),
    amount: lineHomeSumAmount(line),
    sum_amount: lineHomeSumAmount(line),
    group_main: line.group_main || "",
    group_sub1: line.group_sub1 || line.group_sub || "",
    group_sub2: line.group_sub2 || "",
    item_brand: line.item_brand || line.brand || "",
    item_category: line.item_category || line.category || "",
  }));
}

function buildPosCampaignPayload({ docDate: campaignDocDate = docDate.value, docTime: campaignDocTime = localTimeHHMM(), items = buildPosCampaignItems() } = {}) {
  return {
    pos_id: posStore.posId,
    doc_date: campaignDocDate,
    doc_time: campaignDocTime,
    items,
  };
}

function normalizePosCampaignRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => ({
    line_number: index,
    campaign_code: String(row.campaign_code || row.code || "").trim(),
    campaign_name: String(row.campaign_name || row.name_1 || "").trim(),
    display_wording: String(row.display_wording || row.promotion_text || "").trim(),
    qty: toNumber(row.qty),
    match_amount: toNumber(row.match_amount),
    sale_amount: toNumber(row.sale_amount),
  }));
}

function buildSaleBenefitsSignature(saveDate, saveTime, promotionItems = buildPromotionItems(), campaignItems = buildPosCampaignItems()) {
  return stableSignatureString({
    promotion: buildPromotionPayloadForSave({ docDate: saveDate, docTime: saveTime, items: promotionItems }),
    campaign: buildPosCampaignPayload({ docDate: saveDate, docTime: saveTime, items: campaignItems }),
  });
}

function buildSaleBenefitsSnapshot({ saveDate, saveTime, promotionRows = promotionProductRows.value, campaignRows = posCampaignRows.value } = {}) {
  return {
    signature: buildSaleBenefitsSignature(saveDate, saveTime),
    promotion_detail: Array.isArray(promotionRows) ? promotionRows : [],
    pos_campaign_detail: normalizePosCampaignRows(campaignRows),
    promotion_discount_amount: promotionDiscountRaw.value,
    promotion_extra_discount_amount: promotionDiscountAmount.value,
  };
}

async function refreshPosCampaignBeforeSave(saveDate, saveTime, items) {
  posCampaignLoading.value = true;
  posCampaignError.value = "";
  try {
    const campaignResult = await processPosSlipCampaign(buildPosCampaignPayload({ docDate: saveDate, docTime: saveTime, items }));
    if (!campaignResult?.success)
      throw new Error(campaignResult?.msg || campaignResult?.message || tl("ตรวจแคมเปญท้ายใบเสร็จไม่สำเร็จ", "Receipt campaign check failed", "ກວດແຄມເປນທ້າຍໃບຮັບບໍ່ສຳເລັດ"));
    posCampaignRows.value = Array.isArray(campaignResult.data) ? campaignResult.data : [];
    posCampaignLastCalculatedAt.value = promotionCalculatedTime();
    posCampaignDirty.value = false;
    return posCampaignRows.value;
  } catch (error) {
    posCampaignRows.value = [];
    posCampaignLastCalculatedAt.value = "";
    posCampaignDirty.value = false;
    posCampaignError.value = error.message || tl("ตรวจแคมเปญท้ายใบเสร็จไม่สำเร็จ", "Receipt campaign check failed", "ກວດແຄມເປນທ້າຍໃບຮັບບໍ່ສຳເລັດ");
    throw error;
  } finally {
    posCampaignLoading.value = false;
  }
}

async function refreshPromotionBeforeSave(saveDate, saveTime = docTime.value || localTimeHHMM(), items = buildPromotionItems()) {
  promotionLoading.value = true;
  promotionError.value = "";
  try {
    const result = await processPromotion(buildPromotionPayloadForSave({ docDate: saveDate, docTime: saveTime, items }));
    if (!result?.success) throw new Error(result?.msg || result?.message || tl("คำนวณโปรโมชั่นไม่สำเร็จ", "Promotion calculation failed", "ຄຳນວນໂປຣໂມຊັນບໍ່ສຳເລັດ"));
    promotionResults.value = Array.isArray(result.data) ? result.data : [];
    promotionProductRows.value = Array.isArray(result.promotion_product_rows) ? result.promotion_product_rows : [];
    promotionDiscountRaw.value = toNumber(result.promotion_discount_amount);
    promotionLastCalculatedAt.value = promotionCalculatedTime();
    promotionDirty.value = false;
    return promotionProductRows.value;
  } catch (error) {
    promotionResults.value = [];
    promotionProductRows.value = [];
    promotionDiscountRaw.value = 0;
    promotionLastCalculatedAt.value = "";
    promotionDirty.value = false;
    promotionError.value = error.message || tl("คำนวณโปรโมชั่นไม่สำเร็จ", "Promotion calculation failed", "ຄຳນວນໂປຣໂມຊັນບໍ່ສຳເລັດ");
    throw error;
  } finally {
    promotionLoading.value = false;
  }
}

async function refreshSaleBenefitsBeforeSave(saveDate, saveTime) {
  clearTimeout(promotionTimer);
  promotionRunId += 1;
  if (!validRows.value.length) {
    clearPromotionCalculation();
    return buildSaleBenefitsSnapshot({ saveDate, saveTime, promotionRows: [], campaignRows: [] });
  }
  const promotionItems = buildPromotionItems();
  const campaignItems = buildPosCampaignItems();
  const signature = buildSaleBenefitsSignature(saveDate, saveTime, promotionItems, campaignItems);
  const promotionRows = await refreshPromotionBeforeSave(saveDate, saveTime, promotionItems);
  const campaignRows = await refreshPosCampaignBeforeSave(saveDate, saveTime, campaignItems);
  return {
    signature,
    promotion_detail: promotionRows,
    pos_campaign_detail: normalizePosCampaignRows(campaignRows),
    promotion_discount_amount: promotionDiscountRaw.value,
    promotion_extra_discount_amount: promotionDiscountAmount.value,
  };
}

function buildPromotionGuidePayload(items = buildPromotionGuideItems()) {
  return {
    pos_id: posStore.posId,
    cust_code: custCode.value || defaultCustomerCode,
    member_code: promotionMemberCode.value,
    pos_default_cust: defaultCustomerCode,
    doc_date: docDate.value,
    items,
  };
}

function clearPromotionGuide() {
  clearTimeout(promotionGuideTimer);
  promotionGuideRunId += 1;
  promotionGuideLoading.value = false;
  promotionGuideError.value = "";
  promotionGuideMap.value = {};
  promotionGuideDialogVisible.value = false;
  promotionGuideDialogLine.value = null;
}

function schedulePromotionGuideCheck(delay = 300) {
  clearTimeout(promotionGuideTimer);
  const items = buildPromotionGuideItems();
  if (!items.length) {
    clearPromotionGuide();
    return;
  }
  const runId = ++promotionGuideRunId;
  promotionGuideError.value = "";
  promotionGuideTimer = setTimeout(() => {
    void runPromotionGuideCheck(runId, items);
  }, delay);
}

async function runPromotionGuideCheck(runId = ++promotionGuideRunId, items = buildPromotionGuideItems()) {
  if (runId !== promotionGuideRunId || !items.length) return;
  promotionGuideLoading.value = true;
  promotionGuideError.value = "";
  try {
    const result = await getPromotionItemHints(buildPromotionGuidePayload(items));
    if (runId !== promotionGuideRunId) return;
    if (!result?.success) throw new Error(result?.message || result?.msg || tl("โหลดโปรโมชั่นที่เกี่ยวข้องไม่สำเร็จ", "Failed to load related promotions", "ໂຫຼດໂປຣໂມຊັນທີ່ກ່ຽວຂ້ອງບໍ່ສຳເລັດ"));
    const map = {};
    for (const row of Array.isArray(result.data) ? result.data : []) {
      map[promotionGuideKey(row.item_code, row.unit_code)] = row;
    }
    promotionGuideMap.value = map;
  } catch (error) {
    if (runId !== promotionGuideRunId) return;
    promotionGuideMap.value = {};
    promotionGuideError.value = error.message || tl("โหลดโปรโมชั่นที่เกี่ยวข้องไม่สำเร็จ", "Failed to load related promotions", "ໂຫຼດໂປຣໂມຊັນທີ່ກ່ຽວຂ້ອງບໍ່ສຳເລັດ");
  } finally {
    if (runId === promotionGuideRunId) promotionGuideLoading.value = false;
  }
}

function openPromotionGuideDialog(line) {
  promotionGuideDialogLine.value = line;
  promotionGuideDialogVisible.value = true;
}

function promotionCalculatedTime() {
  return new Date().toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function schedulePromotionCalculation(delay = 450) {
  clearTimeout(promotionTimer);
  if (!validRows.value.length) {
    clearPromotionCalculation();
    return;
  }
  const runId = ++promotionRunId;
  promotionDirty.value = true;
  posCampaignDirty.value = true;
  promotionError.value = "";
  posCampaignError.value = "";
  promotionTimer = setTimeout(() => {
    void runPromotionCalculation(runId);
  }, delay);
}

function recalculatePromotionNow() {
  clearTimeout(promotionTimer);
  if (!validRows.value.length) {
    clearPromotionCalculation();
    return;
  }
  const runId = ++promotionRunId;
  promotionDirty.value = true;
  posCampaignDirty.value = true;
  promotionError.value = "";
  posCampaignError.value = "";
  void runPromotionCalculation(runId);
}

async function runPromotionCalculation(runId = ++promotionRunId) {
  if (runId !== promotionRunId) return;
  if (!validRows.value.length) {
    clearPromotionCalculation();
    return;
  }
  if (priceRefreshing.value) {
    schedulePromotionCalculation(250);
    return;
  }

  promotionLoading.value = true;
  posCampaignLoading.value = true;
  promotionError.value = "";
  posCampaignError.value = "";
  try {
    const result = await processPromotion(buildPromotionPayload());
    if (runId !== promotionRunId) return;
    if (!result?.success) throw new Error(result?.msg || result?.message || tl("คำนวณโปรโมชั่นไม่สำเร็จ", "Promotion calculation failed", "ຄຳນວນໂປຣໂມຊັນບໍ່ສຳເລັດ"));
    promotionResults.value = Array.isArray(result.data) ? result.data : [];
    promotionProductRows.value = Array.isArray(result.promotion_product_rows) ? result.promotion_product_rows : [];
    promotionDiscountRaw.value = toNumber(result.promotion_discount_amount);
    promotionLastCalculatedAt.value = promotionCalculatedTime();
    promotionDirty.value = false;
  } catch (error) {
    if (runId !== promotionRunId) return;
    promotionResults.value = [];
    promotionProductRows.value = [];
    promotionDiscountRaw.value = 0;
    promotionLastCalculatedAt.value = "";
    promotionDirty.value = false;
    promotionError.value = error.message || tl("คำนวณโปรโมชั่นไม่สำเร็จ", "Promotion calculation failed", "ຄຳນວນໂປຣໂມຊັນບໍ່ສຳເລັດ");
    clearPosCampaignCalculation();
    return;
  } finally {
    if (runId === promotionRunId) promotionLoading.value = false;
  }

  try {
    const campaignResult = await processPosSlipCampaign(buildPosCampaignPayload());
    if (runId !== promotionRunId) return;
    if (!campaignResult?.success)
      throw new Error(campaignResult?.msg || campaignResult?.message || tl("ตรวจแคมเปญท้ายใบเสร็จไม่สำเร็จ", "Receipt campaign check failed", "ກວດແຄມເປນທ້າຍໃບຮັບບໍ່ສຳເລັດ"));
    posCampaignRows.value = Array.isArray(campaignResult.data) ? campaignResult.data : [];
    posCampaignLastCalculatedAt.value = promotionCalculatedTime();
    posCampaignDirty.value = false;
  } catch (error) {
    if (runId !== promotionRunId) return;
    posCampaignRows.value = [];
    posCampaignLastCalculatedAt.value = "";
    posCampaignDirty.value = false;
    posCampaignError.value = error.message || tl("ตรวจแคมเปญท้ายใบเสร็จไม่สำเร็จ", "Receipt campaign check failed", "ກວດແຄມເປນທ້າຍໃບຮັບບໍ່ສຳເລັດ");
  } finally {
    if (runId === promotionRunId) posCampaignLoading.value = false;
  }
}

async function addProduct(product, qty = 1, barcode = "") {
  const line = await makeLine(product, qty, barcode);
  assertSaleWarehouseAllowed(line.wh_code);
  await checkSalePoliciesForLines([line]);
  await validateStockBeforeAdd(line);
  mergeOrPushLine(line);
}

function clearProductSearchBalanceState() {
  clearProductResultStockHydrationTimers();
  expandedProductKeys.value = {};
  productResultBalanceLoadingByKey.value = {};
  productResultBalanceErrorByKey.value = {};
  productBalanceRowsByKey.value = {};
  productBalanceTotalByKey.value = {};
  productBalancePageByKey.value = {};
  productBalanceBranchesByKey.value = {};
  productBalanceActiveBranchByKey.value = {};
  productBalanceBranchLoadingByKey.value = {};
  productBalanceLoadingByKey.value = {};
  productBalanceErrorByKey.value = {};
}

function cancelProductResultBalanceHydration({ resetLoading = false } = {}) {
  productSearchRunId += 1;
  clearProductResultStockHydrationTimers();
  if (resetLoading) productResultBalanceLoadingByKey.value = {};
}

function clearProductResultStockHydrationTimers() {
  productResultStockHydrationTimers.forEach((entry) => {
    clearTimeout(entry.timer);
    entry.resolve();
  });
  productResultStockHydrationTimers.clear();
}

function productResultStockDelay(ms) {
  return new Promise((resolve) => {
    const entry = { timer: null, resolve };
    const timer = setTimeout(() => {
      productResultStockHydrationTimers.delete(entry);
      resolve();
    }, ms);
    entry.timer = timer;
    productResultStockHydrationTimers.add(entry);
  });
}

function productResultStockWarehouseCode() {
  return String(defaultSaleWarehouseCode() || "").trim();
}

function productResultStockCacheKey(itemCode, whCode = productResultStockWarehouseCode()) {
  return `${whCode}::${String(itemCode || "").trim()}`;
}

function getCachedProductResultStock(itemCode, whCode = productResultStockWarehouseCode()) {
  const key = productResultStockCacheKey(itemCode, whCode);
  const cached = productResultStockCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > productResultStockCacheTtlMs) {
    productResultStockCache.delete(key);
    return null;
  }
  return cached.sum_balance_qty;
}

function setCachedProductResultStock(itemCode, sumBalanceQty, whCode = productResultStockWarehouseCode()) {
  const key = productResultStockCacheKey(itemCode, whCode);
  productResultStockCache.set(key, {
    sum_balance_qty: toNumber(sumBalanceQty),
    cachedAt: Date.now(),
  });
  if (productResultStockCache.size <= 600) return;
  const oldestKey = productResultStockCache.keys().next().value;
  if (oldestKey) productResultStockCache.delete(oldestKey);
}

function mergeProductResultBalance(product, sumBalanceQty) {
  const ratio = unitRatio(product);
  const sumBalance = toNumber(sumBalanceQty);
  return {
    ...product,
    sum_balance_qty: sumBalance,
    balance_qty: Math.floor(sumBalance / ratio),
  };
}

function applyProductResultBalances(rows) {
  const balanceByItemCode = new Map(rows.map((row) => [String(row.item_code || ""), toNumber(row.sum_balance_qty)]));
  const updatedKeys = [];
  productResults.value = productResults.value.map((product) => {
    if (isSetItem(product)) return product;
    const sumBalanceQty = balanceByItemCode.get(String(product.item_code || ""));
    if (sumBalanceQty === undefined) return product;
    updatedKeys.push(productResultKey(product));
    return mergeProductResultBalance(product, sumBalanceQty);
  });
  if (updatedKeys.length) {
    productResultBalanceErrorByKey.value = {
      ...productResultBalanceErrorByKey.value,
      ...Object.fromEntries(updatedKeys.map((key) => [key, ""])),
    };
  }
}

function productResultRowsNeedingBalance(products) {
  return (Array.isArray(products) ? products : []).filter((product) => product?.item_code && !isSetItem(product) && product.sum_balance_qty == null && product.balance_qty == null);
}

function uniqueProductResultRowsByItemCode(products) {
  const byItemCode = new Map();
  for (const product of productResultRowsNeedingBalance(products)) {
    const itemCode = String(product.item_code || "").trim();
    if (itemCode && !byItemCode.has(itemCode)) byItemCode.set(itemCode, product);
  }
  return [...byItemCode.values()];
}

function applyCachedProductResultBalances(products) {
  const whCode = productResultStockWarehouseCode();
  const cachedRows = [];
  const missingRows = [];
  for (const product of uniqueProductResultRowsByItemCode(products)) {
    const cachedBalance = getCachedProductResultStock(product.item_code, whCode);
    if (cachedBalance == null) {
      missingRows.push(product);
    } else {
      cachedRows.push({ item_code: product.item_code, sum_balance_qty: cachedBalance });
    }
  }
  if (cachedRows.length) applyProductResultBalances(cachedRows);
  return missingRows;
}

async function loadProductResultBalanceBatch(products, runId) {
  const rows = uniqueProductResultRowsByItemCode(products);
  if (!rows.length) return;

  const itemCodes = rows.map((product) => String(product.item_code || "").trim()).filter(Boolean);
  const keys = productResultRowsNeedingBalance(productResults.value)
    .filter((product) => itemCodes.includes(String(product.item_code || "").trim()))
    .map((product) => productResultKey(product));
  const whCode = productResultStockWarehouseCode();
  productResultBalanceLoadingByKey.value = {
    ...productResultBalanceLoadingByKey.value,
    ...Object.fromEntries(keys.map((key) => [key, true])),
  };
  productResultBalanceErrorByKey.value = {
    ...productResultBalanceErrorByKey.value,
    ...Object.fromEntries(keys.map((key) => [key, ""])),
  };

  try {
    const balanceRows = await getInventoryBalanceBatch({
      item_codes: itemCodes,
      wh_code: whCode,
    });
    if (runId !== productSearchRunId) return;
    const balanceByItemCode = new Map((Array.isArray(balanceRows) ? balanceRows : []).map((row) => [String(row.item_code || "").trim(), toNumber(row.sum_balance_qty)]));
    const normalizedBalanceRows = itemCodes.map((itemCode) => ({
      item_code: itemCode,
      sum_balance_qty: balanceByItemCode.get(itemCode) ?? 0,
    }));
    normalizedBalanceRows.forEach((row) => setCachedProductResultStock(row.item_code, row.sum_balance_qty, whCode));
    applyProductResultBalances(normalizedBalanceRows);
  } catch (error) {
    if (runId !== productSearchRunId) return;
    const missingKeys = keys.filter((key) => {
      const row = productResults.value.find((product) => productResultKey(product) === key);
      return row && row.sum_balance_qty == null && row.balance_qty == null;
    });
    productResultBalanceErrorByKey.value = {
      ...productResultBalanceErrorByKey.value,
      ...Object.fromEntries(missingKeys.map((key) => [key, error.message || t("product.stockError")])),
    };
  } finally {
    if (runId === productSearchRunId) {
      productResultBalanceLoadingByKey.value = {
        ...productResultBalanceLoadingByKey.value,
        ...Object.fromEntries(keys.map((key) => [key, false])),
      };
    }
  }
}

async function hydrateProductResultBalances(products, runId) {
  const missingRows = applyCachedProductResultBalances(products);
  const priorityRows = missingRows.slice(0, productResultStockPriorityCount);
  const backgroundRows = missingRows.slice(productResultStockPriorityCount);

  await loadProductResultBalanceBatch(priorityRows, runId);
  for (let index = 0; index < backgroundRows.length; index += productResultStockBatchSize) {
    await productResultStockDelay(productResultStockBackgroundDelay);
    if (runId !== productSearchRunId) return;
    await loadProductResultBalanceBatch(backgroundRows.slice(index, index + productResultStockBatchSize), runId);
  }
}

async function ensureProductResultBalance(product) {
  const key = productResultKey(product);
  const current = productResults.value.find((row) => productResultKey(row) === key) || product;
  if (isSetItem(current) || current.sum_balance_qty != null || current.balance_qty != null) return current;

  const whCode = productResultStockWarehouseCode();
  const cachedBalance = getCachedProductResultStock(current.item_code, whCode);
  if (cachedBalance != null) {
    const hydrated = mergeProductResultBalance(current, cachedBalance);
    productResults.value = productResults.value.map((row) => (productResultKey(row) === key ? hydrated : row));
    productResultBalanceErrorByKey.value = {
      ...productResultBalanceErrorByKey.value,
      [key]: "",
    };
    return hydrated;
  }

  productResultBalanceLoadingByKey.value = {
    ...productResultBalanceLoadingByKey.value,
    [key]: true,
  };
  productResultBalanceErrorByKey.value = {
    ...productResultBalanceErrorByKey.value,
    [key]: "",
  };
  try {
    const rows = await getInventoryBalanceBatch({
      item_codes: [current.item_code],
      wh_code: whCode,
    });
    const sumBalanceQty = rows.find((row) => String(row.item_code || "") === String(current.item_code || ""))?.sum_balance_qty ?? 0;
    setCachedProductResultStock(current.item_code, sumBalanceQty, whCode);
    const hydrated = mergeProductResultBalance(current, sumBalanceQty);
    productResults.value = productResults.value.map((row) => (productResultKey(row) === key ? hydrated : row));
    productResultBalanceErrorByKey.value = {
      ...productResultBalanceErrorByKey.value,
      [key]: "",
    };
    return hydrated;
  } catch (error) {
    const latest = productResults.value.find((row) => productResultKey(row) === key);
    if (!latest || (latest.sum_balance_qty == null && latest.balance_qty == null)) {
      productResultBalanceErrorByKey.value = {
        ...productResultBalanceErrorByKey.value,
        [key]: error.message || t("product.stockError"),
      };
    }
    return current;
  } finally {
    productResultBalanceLoadingByKey.value = {
      ...productResultBalanceLoadingByKey.value,
      [key]: false,
    };
  }
}

async function searchProducts() {
  if (documentLocked.value) return;
  clearProductSearchTimer();
  const runId = ++productSearchRunId;
  const query = productSearch.value.trim();
  productDialogVisible.value = true;
  if (!query) {
    productResults.value = [];
    productLoading.value = false;
    errorMsg.value = "";
    clearProductSearchBalanceState();
    focusProductSearchInput();
    return;
  }
  productLoading.value = true;
  errorMsg.value = "";
  clearProductSearchBalanceState();
  try {
    const rows = await getProductBarcodeSearch({
      search: query,
      offset: 0,
      limit: 50,
    });
    if (runId !== productSearchRunId) return;
    productResults.value = rows;
    productDialogVisible.value = true;
    if (!productResults.value.length) errorMsg.value = t("product.notFound");
    void hydrateProductResultBalances(rows, runId);
  } catch (error) {
    if (runId === productSearchRunId) errorMsg.value = error.message || t("product.searchError");
  } finally {
    if (runId === productSearchRunId) {
      productLoading.value = false;
      focusProductSearchInput();
    }
  }
}

function openProductSearchDialog() {
  if (documentLocked.value) return;
  productDialogVisible.value = true;
  scheduleProductSearch();
  focusProductSearchInput();
}

function onProductSearchDialogVisibleChange(visible) {
  productDialogVisible.value = visible;
  if (visible) {
    scheduleProductSearch();
    focusProductSearchInput();
    return;
  }
  clearProductSearchTimer();
  productLoading.value = false;
  cancelProductResultBalanceHydration({ resetLoading: true });
}

function clearProductSearchTimer() {
  if (!productSearchTimer) return;
  clearTimeout(productSearchTimer);
  productSearchTimer = null;
}

function scheduleProductSearch() {
  clearProductSearchTimer();
  if (documentLocked.value || !productDialogVisible.value) return;
  if (!productSearch.value.trim()) {
    productSearchRunId += 1;
    productResults.value = [];
    productLoading.value = false;
    errorMsg.value = "";
    clearProductSearchBalanceState();
    return;
  }
  productSearchTimer = setTimeout(() => {
    productSearchTimer = null;
    void searchProducts();
  }, productSearchDebounceMs);
}

watch(productSearch, () => {
  scheduleProductSearch();
});

async function loadProductWarehouseBalances(product, { first = 0, rows = productBalanceDefaultRows, force = false } = {}) {
  const key = productResultKey(product);
  if (!product?.item_code) return;
  const activeBranchCode = productBalanceActiveBranchCode(product);
  const nextFirst = Math.max(toNumber(first), 0);
  const nextRows = Math.max(toNumber(rows, productBalanceDefaultRows), 1);
  const currentPage = productBalancePageByKey.value[key] || {};
  if (!force && productBalanceRowsByKey.value[key] && currentPage.branch_code === activeBranchCode && currentPage.first === nextFirst && currentPage.rows === nextRows) return;
  productBalanceLoadingByKey.value = { ...productBalanceLoadingByKey.value, [key]: true };
  productBalanceErrorByKey.value = { ...productBalanceErrorByKey.value, [key]: "" };
  productBalancePageByKey.value = {
    ...productBalancePageByKey.value,
    [key]: { branch_code: activeBranchCode, first: nextFirst, rows: nextRows },
  };
  try {
    const result = await getProductWarehouseBalances({
      item_code: product.item_code,
      unit_code: product.unit_code || "",
      ratio: unitRatio(product),
      selected_branch_code: posStore.selectedPos?.branch_code || "",
      branch_code: activeBranchCode,
      first: nextFirst,
      rows: nextRows,
    });
    const balanceRows = Array.isArray(result.rows) ? result.rows.filter((row) => balanceRowHasStock(row)) : [];
    productBalanceRowsByKey.value = {
      ...productBalanceRowsByKey.value,
      [key]: balanceRows,
    };
    productBalanceTotalByKey.value = {
      ...productBalanceTotalByKey.value,
      [key]: allowedSaleWarehouseCodeSet.value.size ? balanceRows.length : toNumber(result.totalRecords),
    };
  } catch (error) {
    productBalanceRowsByKey.value = { ...productBalanceRowsByKey.value, [key]: [] };
    productBalanceTotalByKey.value = { ...productBalanceTotalByKey.value, [key]: 0 };
    productBalanceErrorByKey.value = {
      ...productBalanceErrorByKey.value,
      [key]: error.message || t("product.stockError"),
    };
  } finally {
    productBalanceLoadingByKey.value = {
      ...productBalanceLoadingByKey.value,
      [key]: false,
    };
  }
}

function onProductBalancePage(product, event = {}) {
  void loadProductWarehouseBalances(product, {
    first: event.first,
    rows: event.rows,
    force: true,
  });
}

async function loadProductBalanceBranches(product) {
  const key = productResultKey(product);
  if (!product?.item_code) return;
  if (productBalanceBranchesByKey.value[key]) {
    await loadProductWarehouseBalances(product);
    return;
  }
  productBalanceBranchLoadingByKey.value = {
    ...productBalanceBranchLoadingByKey.value,
    [key]: true,
  };
  productBalanceErrorByKey.value = { ...productBalanceErrorByKey.value, [key]: "" };
  try {
    const branches = await getProductWarehouseBalanceBranches({
      selected_branch_code: posStore.selectedPos?.branch_code || "",
      item_code: product.item_code,
      ratio: unitRatio(product),
    });
    productBalanceBranchesByKey.value = {
      ...productBalanceBranchesByKey.value,
      [key]: Array.isArray(branches) ? branches : [],
    };
    const selectedBranchCode = String(posStore.selectedPos?.branch_code || "").trim();
    const activeBranch = branches.find((branch) => String(branch.branch_code || "").trim() === selectedBranchCode) || branches[0] || { branch_code: "" };
    productBalanceActiveBranchByKey.value = {
      ...productBalanceActiveBranchByKey.value,
      [key]: activeBranch.branch_code || "",
    };
    await loadProductWarehouseBalances(product, {
      first: 0,
      rows: productBalanceDefaultRows,
      force: true,
    });
  } catch (error) {
    productBalanceBranchesByKey.value = {
      ...productBalanceBranchesByKey.value,
      [key]: [],
    };
    productBalanceRowsByKey.value = { ...productBalanceRowsByKey.value, [key]: [] };
    productBalanceTotalByKey.value = { ...productBalanceTotalByKey.value, [key]: 0 };
    productBalanceErrorByKey.value = {
      ...productBalanceErrorByKey.value,
      [key]: error.message || t("product.stockError"),
    };
  } finally {
    productBalanceBranchLoadingByKey.value = {
      ...productBalanceBranchLoadingByKey.value,
      [key]: false,
    };
  }
}

function selectProductBalanceBranch(product, branchCode) {
  const key = productResultKey(product);
  productBalanceActiveBranchByKey.value = {
    ...productBalanceActiveBranchByKey.value,
    [key]: branchCode || "",
  };
  productBalanceRowsByKey.value = { ...productBalanceRowsByKey.value, [key]: [] };
  productBalanceTotalByKey.value = { ...productBalanceTotalByKey.value, [key]: 0 };
  void loadProductWarehouseBalances(product, {
    first: 0,
    rows: productBalanceDefaultRows,
    force: true,
  });
}

function toggleProductResult(product) {
  const key = productResultKey(product);
  const nextExpanded = !expandedProductKeys.value[key];
  expandedProductKeys.value = { ...expandedProductKeys.value, [key]: nextExpanded };
  if (nextExpanded) void loadProductBalanceBranches(product);
}

async function addProductFromSearch(product) {
  if (documentLocked.value) return;
  try {
    const productWithBalance = await ensureProductResultBalance(product);
    await addProduct(productWithBalance, 1, productWithBalance.barcode || product.barcode || "");
    productDialogVisible.value = false;
    productSearch.value = "";
  } catch (error) {
    if (!handleSalePolicyError(error)) errorMsg.value = error.message || t("product.addError");
  }
}

async function addProductFromWarehouseBalance(product, balanceRow) {
  if (documentLocked.value) return;
  const whCode = String(balanceRow?.wh_code || "").trim();
  if (!whCode) return;
  if (!isSaleWarehouseAllowed(whCode)) {
    errorMsg.value = saleWarehouseNotAllowedMessage(whCode);
    return;
  }
  if (!balanceRowHasStock(balanceRow)) {
    errorMsg.value = tl("คลังที่เลือกไม่มียอดคงเหลือ", "The selected warehouse has no remaining stock.", "ຄັງທີ່ເລືອກບໍ່ມີຍອດຄົງເຫຼືອ");
    return;
  }
  try {
    await ensureShelfOptions(whCode);
    const firstShelf = shelfSelectOptions(whCode)[0] || {};
    const shelfCode = String(balanceRow?.shelf_code || balanceRow?.location_code || firstShelf.code || firstShelf.shelf_code || "").trim();
    await addProduct(
      {
        ...product,
        wh_code: whCode,
        shelf_code: shelfCode,
        sum_balance_qty: toNumber(balanceRow?.balance_base),
        balance_qty: toNumber(balanceRow?.balance_qty),
        _selected_wh_code: whCode,
        _selected_shelf_code: shelfCode,
      },
      1,
      product.barcode || "",
    );
    productDialogVisible.value = false;
    productSearch.value = "";
  } catch (error) {
    if (!handleSalePolicyError(error)) errorMsg.value = error.message || t("product.addError");
  }
}

async function addProductBasketToSale(items = []) {
  if (documentLocked.value || !items.length) return;
  productLoading.value = true;
  errorMsg.value = "";
  try {
    let addedCount = 0;
    for (const item of items) {
      const product = item?.product || item;
      const qty = toNumber(item?.qty, 1);
      if (!product || qty <= 0) continue;
      await addProduct(product, qty, product.barcode || "");
      addedCount += 1;
    }
    if (addedCount) {
      toast.add({
        severity: "success",
        summary: t("product.basketAddSuccess"),
        detail: `${addedCount} ${t("sell.items")}`,
        life: 1800,
      });
    }
  } catch (error) {
    if (!handleSalePolicyError(error)) errorMsg.value = error.message || t("product.basketAddError");
  } finally {
    productLoading.value = false;
  }
}

function enqueueBarcodeInput(value) {
  const { barcode, qty } = parseBarcodeInput(value);
  if (!barcode) return false;
  barcodeQueue.value.push({ barcode, qty });
  return true;
}

async function processBarcodeQueue() {
  if (barcodeAdding.value) return;
  barcodeAdding.value = true;
  errorMsg.value = "";
  try {
    while (!documentLocked.value && barcodeQueue.value.length) {
      const { barcode, qty } = barcodeQueue.value.shift();
      try {
        const product = await getProductByBarcodeDetail(barcode, {
          wh_code: defaultSaleWarehouseCode([posStore.selectedPos?.pos_ic_wht]) || "",
          shelf_code: posStore.selectedPos?.pos_ic_shelf || "",
        });
        if (!product) {
          openProductNotFoundDialog(barcode);
          continue;
        }
        const resolvedBarcode = product.scan_source === "serial" ? product.barcode || product.item_code || barcode : barcode;
        await addProduct(product, qty, resolvedBarcode);
      } catch (error) {
        if (!handleSalePolicyError(error)) errorMsg.value = error.message || t("product.barcodeAddError");
      }
    }
  } finally {
    barcodeAdding.value = false;
    focusBarcodeInput();
  }
}

async function addBarcode() {
  if (documentLocked.value) return;
  if (!enqueueBarcodeInput(barcodeInput.value)) return;
  barcodeInput.value = "";
  await processBarcodeQueue();
}

function removeLine(lineOrIndex) {
  if (documentLocked.value) return;
  const index = typeof lineOrIndex === "number" ? lineOrIndex : rows.value.indexOf(lineOrIndex);
  if (index < 0) return;
  rows.value.splice(index, 1);
}

function refreshPaymentReviewAfterEdit() {
  paymentReviewNeeded.value = false;
  paymentReviewTotal.value = paymentEntries.value.length ? totalDue.value : null;
  transferInputAmount.value = transferInputFromHome(remainingPayment.value);
  creditInputAmount.value = remainingPayment.value;
  chequeAmount.value = remainingPayment.value;
}

function confirmPaymentReview() {
  refreshPaymentReviewAfterEdit();
  if (appliedChangeAutoIncomeAmount.value > 0) syncKipAutoRounding();
}

async function runSalePreflightBeforePayment({
  title = tl("ยังรับชำระไม่ได้", "Cannot receive payment yet", "ຍັງຮັບຊຳລະບໍ່ໄດ້"),
  message = tl("กรุณาตรวจสอบข้อมูลก่อนรับชำระ", "Please check document data before receiving payment", "ກະລຸນາກວດຂໍ້ມູນກ່ອນຮັບຊຳລະ"),
  policyMessage = tl("รายการสินค้าไม่ผ่านเงื่อนไขก่อนรับชำระ", "Product items do not pass sale policy before payment", "ລາຍການສິນຄ້າບໍ່ຜ່ານເງື່ອນໄຂກ່ອນຮັບຊຳລະ"),
} = {}) {
  if (salePreflightRunning.value) return false;
  salePreflightRunning.value = true;
  try {
    const saveTime = localTimeHHMM();
    await refreshSaleBenefitsBeforeSave(docDate.value, saveTime);
    await nextTick();
    if (documentValidationMessages.value.length) {
      workspaceTab.value = firstDocumentValidationTab();
      openSaveDialog({
        type: "warn",
        title,
        message,
        details: documentValidationMessages.value,
      });
      return false;
    }
    const snapshot = buildSaveSnapshot();
    if (
      !(await validateSalePoliciesBeforeSave(snapshot.body, {
        title,
        message: policyMessage,
      }))
    )
      return false;
    await validateStockBeforeSave(snapshot.stockRows);
    return true;
  } catch (error) {
    workspaceTab.value = "details";
    openSaveDialog({
      type: "warn",
      title,
      message: error?.message || message,
    });
    return false;
  } finally {
    salePreflightRunning.value = false;
  }
}

async function openPaymentDialog() {
  if (documentLocked.value || !isCashSale.value || salePreflightRunning.value) return;
  if (!(await runSalePreflightBeforePayment())) return;
  resetExchangeRateEditAuthorization();
  activePayType.value = "cash";
  changeCashCurrency(defaultCashCurrencyCode.value);
  if (isHomeCashCurrencyCode(defaultCashCurrencyCode.value)) cashTenderText.value = formatCashTenderText(cashInputAmount.value);
  lockCustomerDisplayPaymentDue();
  paymentDialogVisible.value = true;
  syncCustomerDisplayState();
  focusCashTenderInput();
}

function onPaymentDialogVisibleChange(visible) {
  if (!visible && laoQrCloseLocked.value) {
    toast.add({
      severity: "warn",
      summary: tl("กำลังรอ QR", "QR is active", "QR ຍັງກຳລັງເຮັດວຽກ"),
      detail: tl("กรุณากดยกเลิก QR ก่อนปิดหน้ารับชำระ", "Please cancel QR before closing payment", "ກະລຸນາຍົກເລີກ QR ກ່ອນປິດໜ້າຮັບຊຳລະ"),
      life: 2200,
    });
    return;
  }
  paymentDialogVisible.value = visible;
  if (!visible) {
    unlockCustomerDisplayPaymentDue();
    clearTransferStaticQr({ syncDisplay: false });
    syncCustomerDisplayState();
  }
}

function onLaoQrDialogVisibleChange(visible) {
  if (!visible && laoQrDialogCloseLocked.value) {
    toast.add({
      severity: "warn",
      summary: tl("กำลังรอ QR", "QR is active", "QR ຍັງກຳລັງເຮັດວຽກ"),
      detail: tl("กรุณากดยกเลิก QR ก่อนปิดหน้าต่าง QR", "Please cancel QR before closing QR dialog", "ກະລຸນາຍົກເລີກ QR ກ່ອນປິດໜ້າຕ່າງ QR"),
      life: 2200,
    });
    return;
  }
  laoQrDialogVisible.value = visible;
}

function openTransferStaticQr(option) {
  if (!option?.code) return;
  transferQrSelectedCode.value = option.code;
  transferQrDialogVisible.value = true;
  syncCustomerDisplayState();
}

function clearTransferStaticQr({ syncDisplay = true } = {}) {
  transferQrDialogVisible.value = false;
  transferQrSelectedCode.value = "";
  if (syncDisplay) syncCustomerDisplayState();
}

function onTransferStaticQrDialogVisibleChange(visible) {
  if (visible) {
    transferQrDialogVisible.value = true;
    syncCustomerDisplayState();
    return;
  }
  clearTransferStaticQr();
}

async function checkoutAndSave() {
  if (!canCheckoutSave.value) return;
  await saveDocument();
}

function addCashQuickAmount(amount) {
  if (documentLocked.value || isCreditSale.value) return;
  if (!activeCashExchangeRateValid.value) return;
  setCashTenderAmount(toNumber(cashCurrencyAmount.value) + toNumber(amount));
}

function clearCashTender() {
  if (documentLocked.value || isCreditSale.value) return;
  setCashTenderAmount(0);
  paymentEntries.value = paymentEntries.value.filter((entry) => !isChangeAutoIncomeEntry(entry));
}

function appendCashKeypad(key) {
  if (documentLocked.value || isCreditSale.value) return;
  if (!activeCashExchangeRateValid.value) return;
  let text = String(cashTenderText.value || "0");
  if (key === "backspace") {
    const nextText = text.length > 1 ? text.slice(0, -1) : "0";
    applyCashTenderText(nextText);
    return;
  }
  if (key === ".") {
    if (text.includes(".")) return;
    applyCashTenderText(`${text || "0"}.`);
    return;
  }
  if (!/^\d$/.test(key)) return;
  if (text === "0") text = "";
  applyCashTenderText(`${text}${key}`);
}

function addCashTender() {
  if (documentLocked.value || isCreditSale.value) return;
  commitCashTenderText();
  refreshPaymentReviewAfterEdit();
}

async function refreshCouponOptions() {
  couponOptions.value = await getCouponList({
    search: couponSearch.value,
    cust_code: custCode.value || defaultCustomerCode,
    doc_date: docDate.value,
    total_amount: totals.value.totalAmount,
    doc_no: oldDocNo.value,
  }).catch(() => []);
  couponOptions.value = couponOptions.value.map((row) => ({
    ...row,
    label: `${row.number || ""} ${row.remark || ""} ${formatCurrency(row.available_amount ?? row.balance_amount)}`.trim(),
  }));
}

async function checkCouponCode() {
  if (documentLocked.value || isCreditSale.value || couponLookupLoading.value) return;
  const code = String(couponSearch.value || "").trim();
  couponLookupError.value = "";
  couponSelected.value = null;
  couponOptions.value = [];
  if (!code) {
    couponLookupError.value = tl("กรุณากรอกหรือสแกนเลขคูปอง", "Please enter or scan coupon no.", "ກະລຸນາປ້ອນ ຫຼື ສະແກນເລກຄູປອງ");
    return;
  }
  couponLookupLoading.value = true;
  try {
    const rows = await getCouponList({
      search: code,
      cust_code: custCode.value || defaultCustomerCode,
      doc_date: docDate.value,
      total_amount: totals.value.totalAmount,
      doc_no: oldDocNo.value,
    });
    const list = (Array.isArray(rows) ? rows : []).map((row) => ({
      ...row,
      label: `${row.number || ""} ${row.remark || ""} ${formatCurrency(row.available_amount ?? row.balance_amount)}`.trim(),
    }));
    couponOptions.value = list;
    const coupon = list.find(
      (row) =>
        String(row.number || "")
          .trim()
          .toUpperCase() === code.toUpperCase(),
    );
    if (!coupon) {
      couponLookupError.value = tl("ไม่พบเลขคูปองนี้ หรือคูปองไม่พร้อมใช้งาน", "This coupon no. was not found or is not available", "ບໍ່ພົບເລກຄູປອງນີ້ ຫຼື ຄູປອງບໍ່ພ້ອມໃຊ້ງານ");
      return;
    }
    couponSelected.value = coupon;
    couponSearch.value = String(coupon.number || code).trim();
  } catch (error) {
    couponLookupError.value = error?.data?.msg || error.message || tl("ตรวจสอบคูปองไม่สำเร็จ", "Cannot verify coupon", "ກວດສອບຄູປອງບໍ່ສຳເລັດ");
  } finally {
    couponLookupLoading.value = false;
  }
}

async function refreshDepositOptions() {
  const currentCustCode = String(custCode.value || "").trim();
  if (!currentCustCode) {
    depositOptions.value = [];
    return;
  }
  depositOptions.value = await getSaleDepositBalanceList({
    search: depositSearch.value,
    cust_code: currentCustCode,
    doc_date: docDate.value,
  }).catch(() => []);
  depositOptions.value = depositOptions.value.map((row) => ({
    ...row,
    label: `${row.doc_no || ""} ${formatCurrency(row.balance_amount)}${row.currency_code ? ` ${row.currency_code}` : ""}`.trim(),
  }));
}

async function refreshDepositMoneyOptions() {
  const currentCustCode = String(custCode.value || "").trim();
  if (!currentCustCode) {
    depositMoneyOptions.value = [];
    return;
  }
  depositMoneyOptions.value = await getSaleDepositMoneyBalanceList({
    search: depositMoneySearch.value,
    cust_code: currentCustCode,
    doc_date: docDate.value,
  }).catch(() => []);
  depositMoneyOptions.value = depositMoneyOptions.value.map((row) => ({
    ...row,
    label: `${row.doc_no || ""} ${formatCurrency(row.balance_amount)}${row.currency_code ? ` ${row.currency_code}` : ""}`.trim(),
  }));
}

function addCash() {
  if (documentLocked.value || isCreditSale.value) return;
  if (!activeCashExchangeRateValid.value) return;

  const kip = kipSuggestedAmount.value;
  const tendered = cashTenderText.value ? toNumber(String(cashTenderText.value).replace(/,/g, "")) : 0;
  const amount = kip != null ? kip.kipRounded + tendered : activeCashDueAmount.value;
  if (amount <= 0) return;
  setCashTenderAmount(amount);
  refreshPaymentReviewAfterEdit();
}

function addFullCashPayment() {
  if (documentLocked.value || isCreditSale.value) return;
  const amount = cashPaymentDue.value > 0 ? cashPaymentDue.value : totalDue.value;
  if (amount <= 0) return;
  activePayType.value = "cash";
  setCashAmountFromBaht(amount);
  refreshPaymentReviewAfterEdit();
}

function creditTransferRemarkText() {
  const cardApproval = [creditTransferCardRemark.value, creditTransferApprovalRemark.value]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("-");
  const chargePercent = Math.max(0, toNumber(transferChargePercent.value));
  const chargeCurrencyCode = transferCurrencyCode.value || "THB";
  const chargeCurrencyAmount = transferChargeInCurrency.value;
  const chargeCurrencyText =
    chargeCurrencyAmount > 0 ? ` = ${isKipCashCurrencyCode(chargeCurrencyCode) ? formatQty(chargeCurrencyAmount) : formatCurrency(chargeCurrencyAmount)} ${chargeCurrencyCode}` : "";
  const chargeText = `charge ${formatQty(chargePercent)} %${chargeCurrencyText}`;
  return [cardApproval, chargeText].filter(Boolean).join(" ");
}

function addTransfer(entryType = "transfer") {
  if (documentLocked.value || isCreditSale.value) return;
  const isCreditCardTransfer = entryType === "credit_transfer";
  if (isCreditCardTransfer && !creditTransferRequiredReady.value) return;
  const amount = toNumber(transferInputAmount.value);
  const transferAmount = transferReceivedAmount.value;
  const chargeAmount = transferChargeAmount.value;
  if (amount <= 0 || transferAmount <= 0 || !transferPassBook.value) return;
  const accountName = passBookAccountName(transferPassBook.value);
  const accountNumber = passBookAccountNumber(transferPassBook.value);
  const currencyCode = transferCurrencyCode.value || String(transferPassBook.value.currency_code || "").trim();
  const kipTransfer = isKipCashCurrencyCode(currencyCode);
  const exchangeRate = currencyCode && currencyCode !== "THB" ? transferRate.value : 1;
  if (exchangeRate <= 0) return;
  const entryAmount = kipTransfer ? transferAmount : amount;
  const detailSumAmount = kipTransfer ? transferAmount : amount;
  const sumAmount2 = currencyCode && currencyCode !== "THB" ? (kipTransfer ? amount : transferAmount) : 0;
  const creditRemark = isCreditCardTransfer ? creditTransferRemarkText() : "";
  const transferId = makeLineId();
  const chargeId = chargeAmount > 0 ? makeLineId() : "";
  paymentEntries.value.push({
    id: transferId,
    type: entryType,
    label: isCreditCardTransfer
      ? creditTransferCardLabel(creditRemark || creditTransferCardRemark.value)
      : String(transferPassBook.value.book_name || transferPassBook.value.name || transferPassBook.value.book_code || t("sell.transfer")).trim(),
    amount: entryAmount,
    details: {
      doc_type: 1,
      trans_number: transferPassBook.value.book_code || transferPassBook.value.pass_book_code || transferPassBook.value.code || "",
      pass_book_code: transferPassBook.value.book_code || transferPassBook.value.pass_book_code || transferPassBook.value.code || "",
      book_name: accountName,
      book_number: accountNumber,
      bank_code: transferPassBook.value.bank_code || "",
      bank_branch: transferPassBook.value.bank_branch || "",
      currency_code: currencyCode,
      exchange_rate: exchangeRate,
      sum_amount: detailSumAmount,
      sum_amount_2: sumAmount2,
      transfer_date: transferDate.value,
      remark: creditRemark,
      ...(kipTransfer
        ? {
            exchange_rate_old: transferRate.value,
            _kip_transfer_base_amount: transferBaseReceivedAmount.value,
            _kip_transfer_charge_amount: transferChargeCurrencyAmount.value,
            _kip_transfer_rounding_diff: transferKipRoundingDiff.value,
          }
        : {}),
      ...(chargeId ? { _transfer_charge_entry_id: chargeId } : {}),
    },
  });
  if (chargeAmount > 0) {
    const incomeCode = "RD-012";
    const income = incomeTypes.value.find((item) => String(item.code || "").trim() === incomeCode);
    paymentEntries.value.push({
      id: chargeId,
      type: "income",
      label: income?.label || income?.name_1 || incomeCode,
      amount: chargeAmount,
      details: {
        doc_type: 12,
        trans_number: incomeCode,
        description: income?.name_1 || "",
        _transfer_charge_parent_id: transferId,
      },
    });
  }
  refreshPaymentReviewAfterEdit();
}

function addCreditTransfer() {
  addTransfer("credit_transfer");
}

function addCredit() {
  if (documentLocked.value || isCreditSale.value) return;
  const amount = toNumber(creditInputAmount.value);
  if (amount <= 0 || !creditCardNumber.value) return;
  const chargeRate = creditType.value?.charge_rate_word ?? creditType.value?.charge_rate;
  const charge = toNumber(paymentMasterOptions.value.input_credit_card_charge) === 1 ? 0 : calcPaymentCharge(amount, chargeRate);
  const currencyCode = creditCurrencyCode.value || String(creditType.value?.currency_code || "").trim();
  const exchangeRate = currencyCode && currencyCode !== "THB" ? creditRate.value : 1;
  if (exchangeRate <= 0) return;
  const sumAmount = rnd(amount + charge);
  const sumAmount2 = currencyCode && currencyCode !== "THB" ? rnd(sumAmount * exchangeRate) : sumAmount;
  const charge2 = currencyCode && currencyCode !== "THB" ? rnd(charge * exchangeRate) : charge;
  paymentEntries.value.push({
    id: makeLineId(),
    type: "credit",
    label: creditType.value?.label || t("sell.creditCard"),
    amount,
    details: {
      doc_type: 3,
      trans_number: creditCardNumber.value,
      credit_card_type: creditType.value?.code || creditType.value?.credit_card_type || "",
      card_number: creditCardNumber.value,
      no_approved: creditApprovalNo.value,
      charge,
      sum_amount: sumAmount,
      currency_code: currencyCode,
      exchange_rate: exchangeRate,
      sum_amount_2: sumAmount2,
      charge_2: charge2,
    },
  });
  refreshPaymentReviewAfterEdit();
  couponSelected.value = null;
  couponSearch.value = "";
  couponLookupError.value = "";
  couponAmount.value = 0;
}

function addCheque() {
  if (documentLocked.value || isCreditSale.value) return;
  const amount = toNumber(chequeAmount.value);
  if (amount <= 0 || !chequeNumber.value || !chequePassBook.value) return;
  const currencyCode = chequeCurrencyCode.value || String(chequePassBook.value?.currency_code || "").trim();
  const exchangeRate = currencyCode && currencyCode !== "THB" ? chequeRate.value : 1;
  if (exchangeRate <= 0) return;
  const passBookCode = chequePassBook.value.book_code || chequePassBook.value.pass_book_code || chequePassBook.value.code || "";
  const sumAmount2 = currencyCode && currencyCode !== "THB" ? rnd(amount * exchangeRate) : amount;
  paymentEntries.value.push({
    id: makeLineId(),
    type: "cheque",
    label: t("sell.cheque"),
    amount,
    details: {
      doc_type: 2,
      trans_number: chequeNumber.value,
      pass_book_code: passBookCode,
      bank_code: chequePassBook.value?.bank_code || "",
      bank_branch: chequePassBook.value?.bank_branch || "",
      chq_due_date: chequeDueDate.value,
      sum_amount: amount,
      currency_code: currencyCode,
      exchange_rate: exchangeRate,
      sum_amount_2: sumAmount2,
      chq_on_hand: 0,
    },
  });
  refreshPaymentReviewAfterEdit();
}

function addPettyCash() {
  if (documentLocked.value || isCreditSale.value) return;
  const amount = toNumber(pettyCashAmount.value);
  if (amount <= 0 || !pettyCashAccount.value) return;
  const currencyCode = String(pettyCashAccount.value.currency_code || "").trim();
  const exchangeRate = masterCurrencyRate(currencyCode, 1) || 1;
  const sumAmount2 = currencyCode && currencyCode !== "THB" ? rnd(amount * exchangeRate) : amount;
  paymentEntries.value.push({
    id: makeLineId(),
    type: "petty",
    label: pettyCashAccount.value.label || t("payment.pettyCash"),
    amount,
    details: {
      doc_type: 4,
      trans_number: pettyCashAccount.value.code || "",
      description: pettyCashAccount.value.name_1 || "",
      currency_code: currencyCode,
      exchange_rate: exchangeRate,
      sum_amount: amount,
      sum_amount_2: sumAmount2,
    },
  });
  refreshPaymentReviewAfterEdit();
}

function addDeposit() {
  if (documentLocked.value || isCreditSale.value) return;
  if (!depositDoc.value) return;
  const amount = toNumber(depositAmount.value);
  const balanceAmount = toNumber(depositDoc.value?.balance_amount);
  if (amount <= 0 || amount > balanceAmount) return;
  const exchangeRate = toNumber(depositDoc.value.exchange_rate, 1) || 1;
  paymentEntries.value.push({
    id: makeLineId(),
    type: "deposit",
    label: depositDoc.value.doc_no || t("sell.deposit"),
    amount,
    details: {
      doc_type: 5,
      trans_number: depositDoc.value.doc_no || "",
      doc_date_ref: depositDoc.value.doc_date || "",
      sum_amount: toNumber(depositDoc.value.amount),
      balance_amount: balanceAmount,
      currency_code: depositDoc.value.currency_code || "",
      exchange_rate: exchangeRate,
      amount,
      sum_amount_2: toNumber(depositDoc.value.currency_amount),
      amount_2: exchangeRate > 0 ? rnd(amount / exchangeRate) : amount,
      exchange_rate_old: exchangeRate,
      lost_profit_exchange_amount: 0,
    },
  });
  refreshPaymentReviewAfterEdit();
}

function addDepositMoney() {
  if (documentLocked.value || isCreditSale.value) return;
  if (!depositMoneyDoc.value) return;
  if (selectedDepositMoneyAlreadyAdded.value) {
    toast.add({
      severity: "warn",
      summary: tl("เงินมัดจำ", "Deposit", "ເງິນມັດຈຳ"),
      detail: tl(
        "เอกสารเงินมัดจำนี้ถูกเพิ่มแล้ว กรุณาลบรายการเดิมก่อนเพิ่มใหม่",
        "This deposit document was already added. Remove the existing line before adding it again.",
        "ເອກະສານເງິນມັດຈຳນີ້ຖືກເພີ່ມແລ້ວ ກະລຸນາລຶບລາຍການເກົ່າກ່ອນເພີ່ມໃໝ່",
      ),
      life: 2600,
    });
    return;
  }
  const amount = toNumber(depositMoneyAmount.value);
  const balanceAmount = toNumber(depositMoneyDoc.value?.balance_amount);
  if (amount <= 0 || amount > balanceAmount) return;
  const exchangeRate = toNumber(depositMoneyDoc.value.exchange_rate, 1) || 1;
  paymentEntries.value.push({
    id: makeLineId(),
    type: "deposit_money",
    label: depositMoneyDoc.value.doc_no || tl("เงินมัดจำ", "Deposit", "ເງິນມັດຈຳ"),
    amount,
    details: {
      doc_type: 6,
      trans_number: depositMoneyDoc.value.doc_no || "",
      doc_date_ref: depositMoneyDoc.value.doc_date || "",
      sum_amount: toNumber(depositMoneyDoc.value.amount),
      balance_amount: balanceAmount,
      currency_code: depositMoneyDoc.value.currency_code || "",
      exchange_rate: exchangeRate,
      amount,
      sum_amount_2: toNumber(depositMoneyDoc.value.currency_amount),
      amount_2: exchangeRate > 0 ? rnd(amount / exchangeRate) : amount,
      exchange_rate_old: exchangeRate,
      lost_profit_exchange_amount: 0,
    },
  });
  refreshPaymentReviewAfterEdit();
}

function upsertAutoCashPaymentForSignedNonCash() {
  const signedNonCash = rnd(paymentEntries.value.filter((entry) => entry.type !== "cash" && entry.type !== "income").reduce((sum, entry) => sum + paymentEntryAmount(entry), 0));
  const amount = Math.max(0, rnd(totalDue.value - signedNonCash));
  const autoIndex = paymentEntries.value.findIndex((entry) => entry.type === "cash" && entry.details?.auto_from_deposit);
  const hasManualCash = paymentEntries.value.some((entry) => entry.type === "cash" && !entry.details?.auto_from_deposit);
  if (amount <= 0) {
    if (autoIndex >= 0) paymentEntries.value.splice(autoIndex, 1);
    return;
  }
  const entry = {
    id: autoIndex >= 0 ? paymentEntries.value[autoIndex].id : makeLineId(),
    type: "cash",
    label: "à¹€à¸‡à¸´à¸™à¸ªà¸”",
    amount,
    details: {
      currency_code: "THB",
      currency_name: "à¸šà¸²à¸—",
      currency_amount: amount,
      exchange_rate: 1,
      auto_from_deposit: true,
    },
  };
  if (autoIndex >= 0) {
    paymentEntries.value.splice(autoIndex, 1, entry);
  } else if (!hasManualCash) {
    paymentEntries.value.push(entry);
  }
}

function addCoupon() {
  if (documentLocked.value || isCreditSale.value) return;
  const amount = toNumber(couponAmount.value);
  const availableAmount = toNumber(couponSelected.value?.available_amount ?? couponSelected.value?.usable_amount ?? couponSelected.value?.balance_amount);
  const remainingAmount = selectedCouponMaxAmount.value;
  if (amount <= 0 || !couponSelected.value || amount > availableAmount) return;
  if (amount > remainingAmount) return;
  paymentEntries.value.push({
    id: makeLineId(),
    type: "coupon",
    label: couponSelected.value.number || t("sell.coupon"),
    amount,
    details: {
      doc_type: 9,
      trans_number: couponSelected.value.number || "",
      balance_amount: selectedCouponAvailableAmount.value,
      coupon_type: couponSelected.value.coupon_type || "0",
      master_amount: toNumber(couponSelected.value.amount),
      single_use: couponSelected.value.single_use || "0",
      date_expire: couponSelected.value.date_expire || "",
      remark: couponSelected.value.remark || "",
    },
  });
  refreshPaymentReviewAfterEdit();
}

// ปรับรายการรายได้ปัดเศษเงินทอนให้เท่ากับส่วนเกินที่ทอนไม่ได้ — idempotent (กัน watcher วน)
function syncKipAutoRounding() {
  if (documentLocked.value || isCreditSale.value || hydratingEditDocument.value) return;
  const incomeCode = changeRoundingIncomeCode;
  const target = changeRoundingTargetIncomeAmount.value;
  const current = appliedChangeAutoIncomeAmount.value;
  if (rnd(target, changeRoundingPrecision) === rnd(current, changeRoundingPrecision)) return; // ไม่มีอะไรเปลี่ยน → ไม่ mutate (กันลูป)
  const filtered = paymentEntries.value.filter((entry) => !isChangeAutoIncomeEntry(entry));
  if (target > 0) {
    const existing = incomeTypes.value.find((item) => String(item.code || "").trim() === incomeCode);
    filtered.push({
      id: makeLineId(),
      type: "income",
      label: existing?.label || existing?.name_1 || incomeCode,
      amount: target,
      details: {
        doc_type: 12,
        trans_number: incomeCode,
        description: existing?.name_1 || "",
        _change_auto: true,
        _change_currency_code: changeRoundingCurrencyCode,
        _change_currency_raw_amount: rnd(changeRoundingRawChangeAmount.value, changeRoundingPrecision),
        _change_currency_rounded_amount: rnd(changeRoundingRoundedChangeAmount.value, changeRoundingPrecision),
        _change_currency_diff_amount: rnd(changeRoundingDiffCurrencyAmount.value, changeRoundingPrecision),
        _change_income_home_amount: target,
        _change_precision: changeRoundingPrecision,
        _change_rounding_step: changeRoundingStep,
        _change_rounding_mode: changeRoundingMode,
        _kip_auto: isKipCashCurrencyCode(changeRoundingCurrencyCode),
      },
    });
  }
  paymentEntries.value = filtered;
  refreshPaymentReviewAfterEdit();
}

// ปุ่ม "ปัดเศษอัตโนมัติ" (fallback) — ใช้ตัว sync เดียวกัน
function addKipAutoRounding() {
  syncKipAutoRounding();
}

function syncTransferAutoRounding() {
  if (documentLocked.value || isCreditSale.value || hydratingEditDocument.value) return;
  const incomeCode = changeRoundingIncomeCode;
  const target = transferRoundingTargetIncomeAmount.value;
  const current = appliedTransferAutoRoundingAmount.value;
  if (rnd(target, changeRoundingPrecision) === rnd(current, changeRoundingPrecision)) return;
  const filtered = paymentEntries.value.filter((entry) => !isTransferAutoRoundingEntry(entry));
  if (target > 0) {
    const existing = incomeTypes.value.find((item) => String(item.code || "").trim() === incomeCode);
    filtered.push({
      id: makeLineId(),
      type: "income",
      label: existing?.label || existing?.name_1 || incomeCode,
      amount: target,
      details: {
        doc_type: 12,
        trans_number: incomeCode,
        description: existing?.name_1 || "",
        _transfer_rounding_auto: true,
        _transfer_rounding_base_due: transferRoundingBaseDueBeforeAuto.value,
        _transfer_rounding_non_cash_paid: nonCashPaid.value,
        _transfer_rounding_diff_amount: target,
      },
    });
  }
  paymentEntries.value = filtered;
  refreshPaymentReviewAfterEdit();
}

function addIncome() {
  if (documentLocked.value || isCreditSale.value) return;
  const amount = toNumber(incomeAmount.value);
  if (amount <= 0 || !incomeType.value) return;
  paymentEntries.value.push({
    id: makeLineId(),
    type: "income",
    label: incomeType.value.label || t("sell.otherIncome"),
    amount,
    details: {
      doc_type: 12,
      trans_number: incomeType.value.code || "",
      description: incomeType.value.name_1 || "",
    },
  });
  refreshPaymentReviewAfterEdit();
}

function addExpense() {
  if (documentLocked.value || isCreditSale.value) return;
  const amount = toNumber(expenseAmount.value);
  if (amount <= 0 || !expenseType.value) return;
  paymentEntries.value.push({
    id: makeLineId(),
    type: "expense",
    label: expenseType.value.label || t("sell.otherExpense"),
    amount,
    details: {
      doc_type: 11,
      trans_number: expenseType.value.code || "",
      description: expenseType.value.name_1 || "",
    },
  });
  refreshPaymentReviewAfterEdit();
}

function addOtherCurrency() {
  if (documentLocked.value || isCreditSale.value) return;
  const amount = toNumber(otherCurrencyConvertedAmount.value);
  if (amount <= 0 || !otherCurrency.value || otherCurrencyRate.value <= 0) return;
  paymentEntries.value.push({
    id: makeLineId(),
    type: "currency",
    label: otherCurrency.value.label || t("sell.otherCurrency"),
    amount,
    details: {
      doc_type: 19,
      trans_number: otherCurrency.value.code || "",
      currency_code: otherCurrency.value.code || "",
      description: otherCurrency.value.name_1 || "",
      amount: toNumber(otherCurrencyAmount.value),
      exchange_rate: otherCurrencyRate.value,
      sum_amount: amount,
      charge: toNumber(otherCurrencyCharge.value),
    },
  });
  refreshPaymentReviewAfterEdit();
}

function addWallet() {
  if (documentLocked.value || isCreditSale.value) return;
  const amount = toNumber(walletAmount.value);
  if (amount <= 0 || !walletNumber.value) return;
  paymentEntries.value.push({
    id: makeLineId(),
    type: "wallet",
    label: walletType.value?.label || "Wallet",
    amount,
    details: {
      doc_type: 21,
      trans_number: walletNumber.value,
      credit_card_type: walletType.value?.code || "",
      description: walletType.value?.name_1 || "",
      no_approved: walletApprovedNo.value,
      ref1: walletRef1.value,
      ref2: walletRef2.value,
    },
  });
  refreshPaymentReviewAfterEdit();
}

function makeLaoQrRequestId() {
  return `LQR-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function laoQrRequestIdentity(request = {}) {
  return String(request.local_id || request.uuid || request.history_id || request.id || "").trim();
}

function normalizeLaoQrPaymentRequest(source = {}, fallback = {}) {
  const localId = String(source.local_id || source.localId || fallback.local_id || fallback.localId || source.uuid || fallback.uuid || makeLaoQrRequestId()).trim();
  const provider =
    String(source.provider || fallback.provider || "laoqr")
      .trim()
      .toLowerCase() || "laoqr";
  const uuid = String(source.uuid || fallback.uuid || "").trim();
  const invoiceid = String(source.invoiceid || source.invoiceId || fallback.invoiceid || fallback.invoiceId || "").trim();
  return {
    local_id: localId,
    history_id: toNumber(source.history_id ?? source.historyId ?? source.id ?? fallback.history_id ?? fallback.historyId, 0),
    provider,
    uuid,
    invoiceid,
    amount_lak: Math.round(toNumber(source.amount_lak ?? source.amountLak ?? source.amount ?? fallback.amount_lak ?? fallback.amountLak, 0)),
    amount_base: rnd(toNumber(source.amount_base ?? source.amountBase ?? fallback.amount_base ?? fallback.amountBase, 0)),
    currency_code: String(source.currency_code || source.currencyCode || fallback.currency_code || fallback.currencyCode || "").trim(),
    exchange_rate: toNumber(source.exchange_rate ?? source.exchangeRate ?? fallback.exchange_rate ?? fallback.exchangeRate, 0),
    rounding_amount: rnd(toNumber(source.rounding_amount ?? source.roundingAmount ?? fallback.rounding_amount ?? fallback.roundingAmount, 0)),
    pass_book_code: String(source.pass_book_code || source.passBookCode || fallback.pass_book_code || fallback.passBookCode || "").trim(),
    qrc: String(source.qrc || fallback.qrc || ""),
    qr_image: String(source.qr_image || source.qrImage || fallback.qr_image || fallback.qrImage || ""),
    status: String(source.status || fallback.status || "pending").trim() || "pending",
    message: String(source.message || source.status_message || fallback.message || fallback.status_message || "").trim(),
    created_at: String(source.created_at || source.createdAt || fallback.created_at || fallback.createdAt || new Date().toISOString()).trim(),
    expires_at: toNumber(source.expires_at ?? source.expiresAt ?? fallback.expires_at ?? fallback.expiresAt, 0),
    status_result: source.status_result || source.statusResult || fallback.status_result || fallback.statusResult || null,
    raw: source.raw || fallback.raw || null,
    rounding_applied: source.rounding_applied === true || source.roundingApplied === true || fallback.rounding_applied === true || fallback.roundingApplied === true,
    payment_entry_id: String(source.payment_entry_id || source.paymentEntryId || fallback.payment_entry_id || fallback.paymentEntryId || "").trim(),
    sale_doc_no: String(source.sale_doc_no || source.saleDocNo || fallback.sale_doc_no || fallback.saleDocNo || "").trim(),
    save_blocked_reason: String(source.save_blocked_reason || source.saveBlockedReason || fallback.save_blocked_reason || fallback.saveBlockedReason || "").trim(),
  };
}

function serializeLaoQrPaymentRequest(request = {}) {
  const normalized = normalizeLaoQrPaymentRequest(request);
  return {
    local_id: normalized.local_id,
    history_id: normalized.history_id,
    provider: normalized.provider,
    uuid: normalized.uuid,
    invoiceid: normalized.invoiceid,
    amount_lak: normalized.amount_lak,
    amount_base: normalized.amount_base,
    currency_code: normalized.currency_code,
    exchange_rate: normalized.exchange_rate,
    rounding_amount: normalized.rounding_amount,
    pass_book_code: normalized.pass_book_code,
    qrc: normalized.qrc,
    qr_image: normalized.qr_image,
    status: normalized.status,
    message: normalized.message,
    created_at: normalized.created_at,
    expires_at: normalized.expires_at,
    status_result: normalized.status_result,
    raw: normalized.raw,
    rounding_applied: normalized.rounding_applied,
    payment_entry_id: normalized.payment_entry_id,
    sale_doc_no: normalized.sale_doc_no,
    save_blocked_reason: normalized.save_blocked_reason,
  };
}

function serializeLaoQrPaymentRequests() {
  return laoQrPaymentRequests.value.map((request) => serializeLaoQrPaymentRequest(request));
}

function restoreLaoQrPaymentRequests(rows = []) {
  laoQrPaymentRequests.value = (Array.isArray(rows) ? rows : []).map((row) => normalizeLaoQrPaymentRequest(row)).filter((row) => row.uuid || row.history_id || row.qr_image);
  activeLaoQrRequestId.value = "";
  laoQrCheckingRequestId.value = "";
  resetLaoQrPaymentState();
}

function clearLaoQrPaymentRequests() {
  laoQrPaymentRequests.value = [];
  activeLaoQrRequestId.value = "";
  laoQrCheckingRequestId.value = "";
  resetLaoQrPaymentState();
}

function upsertLaoQrPaymentRequest(request = {}) {
  const normalized = normalizeLaoQrPaymentRequest(request);
  const identity = laoQrRequestIdentity(normalized);
  const index = laoQrPaymentRequests.value.findIndex((row) => {
    if (identity && laoQrRequestIdentity(row) === identity) return true;
    if (normalized.uuid && row.uuid === normalized.uuid) return true;
    return normalized.history_id > 0 && row.history_id === normalized.history_id;
  });
  if (index >= 0) {
    laoQrPaymentRequests.value[index] = normalizeLaoQrPaymentRequest({
      ...laoQrPaymentRequests.value[index],
      ...normalized,
      local_id: laoQrPaymentRequests.value[index].local_id || normalized.local_id,
    });
    return laoQrPaymentRequests.value[index];
  }
  laoQrPaymentRequests.value.push(normalized);
  return normalized;
}

function patchLaoQrPaymentRequest(target, patch = {}) {
  const identity = typeof target === "string" ? target : laoQrRequestIdentity(target);
  if (!identity) return null;
  const index = laoQrPaymentRequests.value.findIndex((row) => laoQrRequestIdentity(row) === identity || row.uuid === identity || String(row.history_id || "") === identity);
  if (index < 0) return null;
  const next = normalizeLaoQrPaymentRequest({ ...laoQrPaymentRequests.value[index], ...patch, local_id: laoQrPaymentRequests.value[index].local_id });
  laoQrPaymentRequests.value[index] = next;
  return next;
}

function laoQrRequestPassBookCode(request = {}) {
  return String(request.pass_book_code || "").trim();
}

function laoQrRequestPassBook(request = {}) {
  const code = laoQrRequestPassBookCode(request);
  if (!code) return null;
  return passBooks.value.find((row) => String(row.book_code || row.pass_book_code || row.code || "").trim() === code) || null;
}

function laoQrRequestCloseAmount(request = {}) {
  return rnd(toNumber(request.amount_base) + toNumber(request.rounding_amount));
}

function laoQrRequestStatusSeverity(status) {
  return laoQrHistoryStatusSeverity(status);
}

function canCheckLaoQrRequest(request = {}) {
  const status = String(request.status || "").trim();
  return !!(request.uuid || request.history_id) && !["saving", "saved"].includes(status) && !successDocNo.value;
}

function applyLaoQrRequestToState(request = {}, { openDialog = false } = {}) {
  const normalized = normalizeLaoQrPaymentRequest(request);
  laoQrApplyingRequest = true;
  laoQrProvider.value = normalized.provider || "laoqr";
  setLaoQrCurrencyByCode(normalized.currency_code);
  laoQrAmountLak.value = normalized.amount_lak;
  laoQrStatus.value = normalized.status || "pending";
  laoQrMessage.value = normalized.message || "";
  laoQrResponse.value = normalized.raw || null;
  laoQrStatusResponse.value = normalized.status_result || null;
  laoQrQrImage.value = normalized.qr_image || "";
  laoQrUuid.value = normalized.uuid || "";
  laoQrInvoiceId.value = normalized.invoiceid || "";
  laoQrExpiresAt.value = normalized.expires_at || 0;
  laoQrSavingPaid.value = ["saving"].includes(normalized.status);
  activeLaoQrRequestId.value = normalized.local_id;
  if (openDialog) laoQrDialogVisible.value = true;
  setTimeout(() => {
    laoQrApplyingRequest = false;
  }, 0);
  return normalized;
}

function showLaoQrRequest(request = {}) {
  const normalized = applyLaoQrRequestToState(request, { openDialog: true });
  if (["pending", "scanned"].includes(normalized.status) && !successDocNo.value) {
    const remainingMs = (normalized.expires_at || 0) - Date.now();
    const remainingSec = Math.ceil(remainingMs / 1000);
    if (remainingSec > 0) {
      clearLaoQrCountdown({ reset: false });
      laoQrCountdownNow.value = Date.now();
      laoQrCountdownTimer = setInterval(() => {
        laoQrCountdownNow.value = Date.now();
        if (laoQrCountdownRemainingSeconds.value <= 0) expireLaoQrPaymentState();
      }, 1000);
    } else {
      startLaoQrCountdown();
    }
    startLaoQrPolling();
  }
}

function syncActiveLaoQrRequestFromState(patch = {}) {
  if (!activeLaoQrRequestId.value) return null;
  return patchLaoQrPaymentRequest(activeLaoQrRequestId.value, {
    provider: laoQrProvider.value,
    uuid: laoQrUuid.value,
    invoiceid: laoQrInvoiceId.value,
    amount_lak: Math.round(toNumber(laoQrAmountLak.value)),
    amount_base: laoQrPaymentThb.value,
    currency_code: laoQrCurrencyCode.value,
    exchange_rate: toNumber(laoQrRate.value),
    rounding_amount: laoQrRoundingAmount.value,
    pass_book_code: laoQrTransferPassBookCode.value,
    qr_image: laoQrQrImage.value,
    status: laoQrStatus.value,
    message: laoQrMessage.value,
    expires_at: laoQrExpiresAt.value,
    status_result: laoQrStatusResponse.value,
    raw: laoQrResponse.value,
    ...patch,
  });
}
function clearLaoQrPoll() {
  if (laoQrPollTimer) clearInterval(laoQrPollTimer);
  laoQrPollTimer = null;
}

function formatLaoQrCountdown(seconds) {
  const safeSeconds = Math.max(0, Math.floor(toNumber(seconds)));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function clearLaoQrCountdown({ reset = true } = {}) {
  if (laoQrCountdownTimer) clearInterval(laoQrCountdownTimer);
  laoQrCountdownTimer = null;
  if (reset) laoQrExpiresAt.value = 0;
}

function startLaoQrCountdown(seconds = QR_PAYMENT_COUNTDOWN_SECONDS) {
  clearLaoQrCountdown();
  laoQrCountdownNow.value = Date.now();
  laoQrExpiresAt.value = laoQrCountdownNow.value + Math.max(1, Math.floor(toNumber(seconds, QR_PAYMENT_COUNTDOWN_SECONDS))) * 1000;
  laoQrCountdownTimer = setInterval(() => {
    laoQrCountdownNow.value = Date.now();
    if (laoQrCountdownRemainingSeconds.value <= 0) expireLaoQrPaymentState();
  }, 1000);
}

function expireLaoQrPaymentState() {
  if (["paid", "saving", "save_failed", "saved"].includes(laoQrStatus.value) || laoQrSavingPaid.value) {
    clearLaoQrCountdown();
    return;
  }
  syncActiveLaoQrRequestFromState({ status: laoQrStatus.value || "pending" });
  resetLaoQrPaymentState();
}

function resetLaoQrPaymentState({ clearActive = true, closeDialog = true } = {}) {
  clearLaoQrPoll();
  clearLaoQrCountdown();
  laoQrCreateRunId += 1;
  laoQrStatus.value = "idle";
  laoQrMessage.value = "";
  laoQrResponse.value = null;
  laoQrStatusResponse.value = null;
  laoQrQrImage.value = "";
  laoQrUuid.value = "";
  laoQrInvoiceId.value = "";
  laoQrSavingPaid.value = false;
  if (clearActive) activeLaoQrRequestId.value = "";
  if (closeDialog) laoQrDialogVisible.value = false;
}

function syncLaoQrAmountFromRate() {
  if (laoQrUiLocked.value) return;
  const multiplier = toNumber(String(laoQrCurrency.value?.name_2 || "").replace(/,/g, ""), 0);
  laoQrAmountLak.value = multiplier > 0 && laoQrBaseDue.value > 0 ? Math.max(1, Math.round(laoQrBaseDue.value * multiplier)) : 0;
}

function setLaoQrCurrencyByCode(code = "") {
  const currencyCode = String(code || "").trim();
  laoQrCurrency.value = currencyCode ? currencyOptionByCode(currencyCode, null) : null;
  syncLaoQrAmountFromRate();
}

function syncLaoQrCurrencyFromPassBook() {
  setLaoQrCurrencyByCode(laoQrTransferPassBook.value?.currency_code || "");
}

async function ensureLaoQrConfig() {
  if (laoQrConfig.value || laoQrConfigLoading.value) return laoQrConfig.value;
  laoQrConfigLoading.value = true;
  laoQrConfigError.value = "";
  try {
    const config = await getLaoQrConfig();
    laoQrConfig.value = config;
    syncLaoQrCurrencyFromPassBook();
    return config;
  } catch (error) {
    laoQrConfigError.value = error.message || tl("โหลด config LAO QR ไม่สำเร็จ", "Failed to load LAO QR config", "ໂຫຼດ config LAO QR ບໍ່ສຳເລັດ");
    return null;
  } finally {
    laoQrConfigLoading.value = false;
  }
}

function laoQrHistoryStatusLabel(status) {
  const value = String(status || "").trim();
  return laoQrHistoryStatusOptions.value.find((option) => option.value === value)?.label || value || "-";
}

function laoQrHistoryStatusSeverity(status) {
  const value = String(status || "").trim();
  if (["paid", "saved"].includes(value)) return "success";
  if (["create_failed", "check_failed"].includes(value)) return "danger";
  if (value === "scanned") return "warn";
  if (value === "pending") return "info";
  return "secondary";
}

function canCheckLaoQrHistory(row) {
  return !["paid", "saved"].includes(String(row?.status || "").trim());
}

function formatLaoQrHistoryDateTime(value) {
  const text = String(value || "").trim();
  if (!text) return "-";
  const [datePart, timePart = ""] = text.replace("T", " ").split(" ");
  const [year, month, day] = datePart.split("-");
  if (!year || !month || !day) return text;
  const time = timePart.slice(0, 5);
  return `${day}/${month}/${year}${time ? ` ${time}` : ""}`;
}

function laoQrHistoryPosText(row) {
  return [row?.pos_code || row?.pos_id, row?.machinecode].filter(Boolean).join(" / ") || "-";
}

function laoQrHistoryCreatorText(row) {
  return [row?.creator_code, row?.creator_name].filter(Boolean).join(" ") || "-";
}

function laoQrHistoryBankRefText(row) {
  return row?.fccref || row?.ticket || "-";
}

function resetLaoQrHistoryFiltersToToday() {
  const now = new Date();
  laoQrHistoryFromDate.value = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  laoQrHistoryToDate.value = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  laoQrHistoryStatus.value = "all";
  laoQrHistorySearch.value = "";
}

function laoQrHistorySearchParams() {
  return {
    from_date: toISO(laoQrHistoryFromDate.value),
    to_date: toISO(laoQrHistoryToDate.value),
    status: laoQrHistoryStatus.value,
    search: laoQrHistorySearch.value.trim(),
    pos_id: laoQrHistoryPosId.value,
    branch_code: posStore.selectedPos?.branch_code || "",
    limit: 300,
  };
}

async function loadLaoQrHistoryForCurrentPos() {
  if (!laoQrHistoryPosId.value) {
    laoQrHistoryRows.value = [];
    laoQrHistoryError.value = tl("ยังไม่ได้เลือกเครื่อง POS", "No POS terminal is selected", "ຍັງບໍ່ໄດ້ເລືອກ POS");
    return;
  }
  laoQrHistoryLoading.value = true;
  laoQrHistoryError.value = "";
  try {
    laoQrHistoryRows.value = await getLaoQrPaymentHistory(laoQrHistorySearchParams());
  } catch (error) {
    laoQrHistoryRows.value = [];
    laoQrHistoryError.value = error.message || tl("โหลดประวัติรับเงิน QRLao ไม่สำเร็จ", "Failed to load QRLao payment history", "ໂຫຼດປະຫວັດ QRLao ບໍ່ສຳເລັດ");
  } finally {
    laoQrHistoryLoading.value = false;
  }
}

async function openLaoQrHistoryDialog() {
  resetLaoQrHistoryFiltersToToday();
  laoQrHistoryDialogVisible.value = true;
  await loadLaoQrHistoryForCurrentPos();
}

async function checkLaoQrHistoryRow(row) {
  if (!row?.id || laoQrHistoryCheckingId.value || !canCheckLaoQrHistory(row)) return;
  laoQrHistoryCheckingId.value = row.id;
  try {
    const result = await checkLaoQrPaymentHistory(row.id);
    const updated = result.row;
    if (updated?.id) {
      laoQrHistoryRows.value = laoQrHistoryRows.value.map((item) => (item.id === updated.id ? updated : item));
    } else {
      await loadLaoQrHistoryForCurrentPos();
    }
    toast.add({
      severity: updated?.status === "paid" || result.status_result?.paid ? "success" : "info",
      summary: tl("ตรวจสอบแล้ว", "Checked", "ກວດສອບແລ້ວ"),
      detail: laoQrHistoryStatusLabel(updated?.status || result.status_result?.status_text),
      life: 2200,
    });
  } catch (error) {
    toast.add({
      severity: "error",
      summary: tl("ตรวจสอบไม่สำเร็จ", "Check failed", "ກວດສອບບໍ່ສຳເລັດ"),
      detail: error.message,
      life: 3500,
    });
    await loadLaoQrHistoryForCurrentPos();
  } finally {
    laoQrHistoryCheckingId.value = null;
  }
}

function statusDataFromLaoQrHistory(row = {}, statusResult = null) {
  return {
    ...(statusResult || {}),
    paid: statusResult?.paid === true || String(row.status || "").trim() === "paid",
    uuid: row.uuid || statusResult?.uuid || "",
    fccref: statusResult?.fccref || row.fccref || "",
    ticket: statusResult?.ticket || row.ticket || "",
    service: statusResult?.service || row.service || "",
    frombank: statusResult?.frombank || row.frombank || "",
    message: statusResult?.message || row.status_message || "",
  };
}

function laoQrStatusFromStatusResult(statusData = {}, fallback = "pending") {
  if (statusData?.paid) return "paid";
  const message = String(statusData?.message || "");
  if (/scan/i.test(message)) return "scanned";
  return fallback || "pending";
}

function laoQrRequestToastDetail(request = {}, statusData = null) {
  const status = statusData?.paid ? "paid" : String(request.status || "").trim();
  if (status === "paid") return tl("ชำระเงินสำเร็จ", "Payment completed", "ຊຳລະເງິນສຳເລັດ");
  if (status === "scanned") return tl("สแกน QR แล้ว รอการชำระเงิน", "QR scanned, waiting for payment", "ສະແກນ QR ແລ້ວ ລໍຖ້າການຊຳລະ");
  if (status === "pending") return tl("ยังไม่พบการชำระเงิน", "Payment has not been received yet", "ຍັງບໍ່ພົບການຊຳລະ");
  if (status === "check_failed") return tl("ตรวจสอบสถานะ QR ไม่สำเร็จ", "Failed to check QR status", "ກວດສະຖານະ QR ບໍ່ສຳເລັດ");
  if (status === "create_failed") return tl("สร้าง QR ไม่สำเร็จ", "Failed to create QR", "ສ້າງ QR ບໍ່ສຳເລັດ");
  if (status === "save_failed") return request.message || tl("รับเงินแล้ว แต่บันทึกเอกสารไม่สำเร็จ", "Payment received, but saving failed", "ຮັບເງິນແລ້ວ ແຕ່ບັນທຶກບໍ່ສຳເລັດ");
  return laoQrHistoryStatusLabel(status);
}

async function checkLaoQrRequest(request = {}) {
  const current = normalizeLaoQrPaymentRequest(request);
  if (!canCheckLaoQrRequest(current) || laoQrCheckingRequestId.value) return;
  const syncOpenDialogState = laoQrDialogVisible.value && activeLaoQrRequestId.value === current.local_id;
  laoQrCheckingRequestId.value = current.local_id;
  try {
    if (["paid", "save_failed"].includes(current.status) && current.status_result?.paid) {
      await finalizePaidLaoQr(current.status_result, current);
      return;
    }

    let next = current;
    let statusData = null;
    if (current.history_id > 0) {
      const result = await checkLaoQrPaymentHistory(current.history_id);
      const updated = result.row || {};
      statusData = statusDataFromLaoQrHistory(updated, result.status_result || null);
      next =
        patchLaoQrPaymentRequest(current.local_id, {
          ...updated,
          local_id: current.local_id,
          history_id: updated.id || current.history_id,
          qr_image: current.qr_image,
          qrc: current.qrc,
          raw: current.raw,
          status: updated.status || laoQrStatusFromStatusResult(statusData, current.status),
          message: updated.status_message || statusData?.message || current.message,
          status_result: statusData,
        }) || current;
    } else {
      const data = await checkLaoQrPaymentStatus({ uuid: current.uuid });
      statusData = data;
      const status = laoQrStatusFromStatusResult(data, current.status || "pending");
      next =
        patchLaoQrPaymentRequest(current.local_id, {
          status,
          message: data.message || (status === "pending" ? tl("รอชำระเงิน", "Waiting for payment", "ລໍຖ້າການຊຳລະ") : ""),
          status_result: data,
        }) || current;
    }

    if (syncOpenDialogState) applyLaoQrRequestToState(next, { openDialog: true });
    if (statusData?.paid || String(next.status || "") === "paid") {
      await finalizePaidLaoQr(statusData || { paid: true, uuid: next.uuid }, next);
      return;
    }
    toast.add({
      severity: "info",
      summary: tl("ตรวจสอบแล้ว", "Checked", "ກວດສອບແລ້ວ"),
      detail: laoQrRequestToastDetail(next, statusData),
      life: 2200,
    });
  } catch (error) {
    const failed = patchLaoQrPaymentRequest(current.local_id, {
      status: "check_failed",
      message: error.message || tl("ตรวจสอบสถานะ QR ไม่สำเร็จ", "Failed to check QR status", "ກວດສະຖານະ QR ບໍ່ສຳເລັດ"),
    });
    if (syncOpenDialogState && failed?.local_id === activeLaoQrRequestId.value) applyLaoQrRequestToState(failed, { openDialog: true });
    toast.add({
      severity: "error",
      summary: tl("ตรวจสอบไม่สำเร็จ", "Check failed", "ກວດສອບບໍ່ສຳເລັດ"),
      detail: error.message,
      life: 3500,
    });
  } finally {
    laoQrCheckingRequestId.value = "";
  }
}
function generateLaoQrReference() {
  const now = new Date();
  const year = String(now.getFullYear()).slice(2);
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  const second = String(now.getSeconds()).padStart(2, "0");
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return {
    uuid: `BZQR-${Date.now()}-${suffix}`,
    invoiceid: `Q${year}${month}${day}${hour}${minute}${second}`,
  };
}

function laoQrRef2Text(statusData = {}) {
  return [
    laoQrUuid.value ? `UUID=${laoQrUuid.value}` : "",
    `${laoQrCurrencyCode.value}=${Math.round(toNumber(laoQrAmountLak.value))}`,
    `RATE=${rnd(toNumber(laoQrRate.value), exchangeRateDecimal)}`,
    `DIFF=${laoQrRoundingAmount.value}`,
    `SERVICE=${laoQrProvider.value.toUpperCase()}`,
    statusData.frombank ? `BANK=${statusData.frombank}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

async function createLaoQr() {
  if (documentLocked.value || isCreditSale.value || salePreflightRunning.value) return;
  if (
    !(await runSalePreflightBeforePayment({
      title: tl("ยังสร้าง QR ไม่ได้", "Cannot create QR yet", "ຍັງສ້າງ QR ບໍ່ໄດ້"),
      message: tl("กรุณาตรวจสอบข้อมูลก่อนสร้าง QR รับชำระ", "Please check document data before creating payment QR", "ກະລຸນາກວດຂໍ້ມູນກ່ອນສ້າງ QR ຮັບຊຳລະ"),
      policyMessage: tl("รายการสินค้าไม่ผ่านเงื่อนไขก่อนสร้าง QR รับชำระ", "Product items do not pass sale policy before creating payment QR", "ລາຍການສິນຄ້າບໍ່ຜ່ານເງື່ອນໄຂກ່ອນສ້າງ QR ຮັບຊຳລະ"),
    }))
  )
    return;
  await ensureLaoQrConfig();
  if (!laoQrCanCreate.value) return;
  resetLaoQrPaymentState();
  const runId = laoQrCreateRunId;
  const ref = generateLaoQrReference();
  const draft = upsertLaoQrPaymentRequest({
    local_id: makeLaoQrRequestId(),
    provider: laoQrProvider.value,
    uuid: ref.uuid,
    invoiceid: ref.invoiceid,
    amount_lak: Math.round(toNumber(laoQrAmountLak.value)),
    amount_base: laoQrPaymentThb.value,
    currency_code: laoQrCurrencyCode.value,
    exchange_rate: toNumber(laoQrRate.value),
    rounding_amount: laoQrRoundingAmount.value,
    pass_book_code: laoQrTransferPassBookCode.value,
    status: "creating",
    message: tl("กำลังสร้าง QR", "Creating QR", "ກຳລັງສ້າງ QR"),
    created_at: new Date().toISOString(),
  });
  applyLaoQrRequestToState(draft, { openDialog: true });
  try {
    const selectedPos = posStore.selectedPos || {};
    const employee = authStore.employee || {};
    const data = await createLaoQrPayment({
      provider: draft.provider,
      amount_lak: draft.amount_lak,
      uuid: draft.uuid,
      invoiceid: draft.invoiceid,
      desc: "Santipab QR",
      expire: QR_PAYMENT_COUNTDOWN_SECONDS / 60,
      shopcode: laoQrConfig.value?.shopcode || "",
      terminalid: selectedPos.machinecode || selectedPos.pos_id || posStore.posId || "",
      pos_id: posStore.posId || selectedPos.pos_id || "",
      pos_code: selectedPos.code || selectedPos.pos_id || posStore.posId || "",
      pos_name: selectedPos.name_1 || selectedPos.name || "",
      machinecode: selectedPos.machinecode || "",
      branch_code: selectedPos.branch_code || branchCode.value || "",
      creator_code: employee.user_code || "",
      creator_name: employee.user_name || employee.name_1 || employee.name || "",
      currency_code: draft.currency_code,
      exchange_rate: draft.exchange_rate,
      amount_base: draft.amount_base,
      rounding_amount: draft.rounding_amount,
      pass_book_code: draft.pass_book_code,
    });
    if (runId !== laoQrCreateRunId) return;
    if (!data.qrc) throw new Error(data.message || tl("Onepay ไม่ส่งข้อมูล QR กลับมา", "Onepay did not return QR data", "Onepay ບໍ່ສົ່ງຂໍ້ມູນ QR ກັບມາ"));
    const updated = upsertLaoQrPaymentRequest({
      ...draft,
      history_id: data.history_id,
      qrc: data.qrc,
      qr_image: data.qr_image || "",
      status: "pending",
      message: data.message || tl("รอชำระเงิน", "Waiting for payment", "ລໍຖ້າການຊຳລະ"),
      raw: data,
    });
    applyLaoQrRequestToState(updated, { openDialog: true });
    startLaoQrCountdown();
    syncActiveLaoQrRequestFromState({ status: "pending", message: updated.message, expires_at: laoQrExpiresAt.value });
    startLaoQrPolling();
  } catch (error) {
    if (runId !== laoQrCreateRunId) return;
    clearLaoQrPoll();
    const failed = patchLaoQrPaymentRequest(draft.local_id, {
      status: "create_failed",
      message: error.message || tl("สร้าง QR ไม่สำเร็จ", "Failed to create QR", "ສ້າງ QR ບໍ່ສຳເລັດ"),
    });
    applyLaoQrRequestToState(failed || draft, { openDialog: true });
  }
}

function startLaoQrPolling() {
  clearLaoQrPoll();
  void checkLaoQrStatusOnce();
  laoQrPollTimer = setInterval(() => {
    void checkLaoQrStatusOnce();
  }, 3000);
}

async function checkLaoQrStatusOnce() {
  const request = activeLaoQrRequest.value;
  if (!request?.uuid || laoQrSavingPaid.value || successDocNo.value) return;
  const runId = laoQrCreateRunId;
  const activeId = request.local_id;
  try {
    const data = await checkLaoQrPaymentStatus({ uuid: request.uuid });
    if (runId !== laoQrCreateRunId || activeLaoQrRequestId.value !== activeId) return;
    laoQrStatusResponse.value = data;
    if (data.paid) {
      await finalizePaidLaoQr(data, request);
      return;
    }
    const message = data.message || tl("รอชำระเงิน", "Waiting for payment", "ລໍຖ້າການຊຳລະ");
    const scanned = /scan/i.test(message);
    laoQrStatus.value = scanned ? "scanned" : "pending";
    laoQrMessage.value = message;
    syncActiveLaoQrRequestFromState({ status: laoQrStatus.value, message, status_result: data });
  } catch (error) {
    if (runId !== laoQrCreateRunId || activeLaoQrRequestId.value !== activeId) return;
    laoQrMessage.value = error.message || tl("ตรวจสอบสถานะ QR ไม่สำเร็จ", "Failed to check QR status", "ກວດສະຖານະ QR ບໍ່ສຳເລັດ");
    syncActiveLaoQrRequestFromState({ message: laoQrMessage.value });
  }
}

async function finalizePaidLaoQr(statusData = {}, requestParam = null) {
  const request = normalizeLaoQrPaymentRequest(requestParam || activeLaoQrRequest.value || {});
  if (!request.uuid || laoQrSavingPaid.value) return;
  laoQrSavingPaid.value = true;
  clearLaoQrPoll();
  clearLaoQrCountdown();
  activeLaoQrRequestId.value = request.local_id;
  laoQrStatus.value = "paid";
  laoQrMessage.value = tl("ชำระเงินสำเร็จ กำลังบันทึกเอกสาร", "Payment received. Saving document", "ຊຳລະເງິນສຳເລັດ ກຳລັງບັນທຶກເອກະສານ");
  laoQrDialogVisible.value = false;
  let currentRequest =
    patchLaoQrPaymentRequest(request.local_id, {
      status: "paid",
      message: laoQrMessage.value,
      status_result: statusData,
      save_blocked_reason: "",
    }) || request;

  const amountThb = rnd(toNumber(currentRequest.amount_base));
  const qrAmount = Math.round(toNumber(currentRequest.amount_lak));
  const passBook = laoQrRequestPassBook(currentRequest);
  const passBookCode = laoQrRequestPassBookCode(currentRequest);
  const accountName = passBookAccountName(passBook);
  const accountNumber = passBookAccountNumber(passBook);
  const currencyCode = currentRequest.currency_code || laoQrCurrencyCode.value;
  const provider = String(currentRequest.provider || laoQrProvider.value || "laoqr").toUpperCase();
  const fccref = statusData.fccref || "";
  const existingIndex = paymentEntries.value.findIndex((entry) => entry.type === "transfer" && entry.details?.ref1 === currentRequest.invoiceid && entry.details?.ref2?.includes(currentRequest.uuid));
  if (existingIndex < 0) {
    const expectedCloseAmount = laoQrRequestCloseAmount(currentRequest);
    const currentCloseAmount = rnd(remainingPayment.value);
    if (Math.abs(rnd(expectedCloseAmount - currentCloseAmount)) > 0.01) {
      const message = tl(
        `QR นี้ชำระแล้ว แต่ยอด QR ${formatCurrency(expectedCloseAmount)} ไม่ตรงกับยอดคงเหลือปัจจุบัน ${formatCurrency(currentCloseAmount)} กรุณาตรวจสอบบิลหรือสร้าง QR ใหม่`,
        `This QR is paid, but QR amount ${formatCurrency(expectedCloseAmount)} does not match current remaining amount ${formatCurrency(currentCloseAmount)}. Please review the bill or create a new QR.`,
        `QR ນີ້ຊຳລະແລ້ວ ແຕ່ຍອດ QR ${formatCurrency(expectedCloseAmount)} ບໍ່ກົງກັບຍອດຄົງເຫຼືອ ${formatCurrency(currentCloseAmount)} ກະລຸນາກວດບິນ ຫຼື ສ້າງ QR ໃໝ່`,
      );
      currentRequest =
        patchLaoQrPaymentRequest(currentRequest.local_id, {
          status: "save_failed",
          message,
          status_result: statusData,
          save_blocked_reason: "amount_mismatch",
        }) || currentRequest;
      applyLaoQrRequestToState(currentRequest, { openDialog: false });
      openSaveDialog({
        type: "warn",
        title: tl("รับเงิน QR แล้วแต่ยอดไม่ตรง", "QR paid but amount mismatch", "QR ຈ່າຍແລ້ວແຕ່ຍອດບໍ່ກົງ"),
        message,
      });
      laoQrSavingPaid.value = false;
      return;
    }
  }

  if (!currentRequest.rounding_applied) {
    roundedAmount.value = rnd(toNumber(roundedAmount.value) + toNumber(currentRequest.rounding_amount));
    currentRequest = patchLaoQrPaymentRequest(currentRequest.local_id, { rounding_applied: true }) || currentRequest;
  }

  const laoQrTransferDetails = {
    doc_type: 1,
    trans_number: passBookCode,
    pass_book_code: passBookCode,
    book_name: accountName,
    book_number: accountNumber,
    bank_code: passBook?.bank_code || "",
    bank_branch: passBook?.bank_branch || "",
    description: `LAO QR ${provider}`,
    no_approved: fccref || statusData.ticket || "",
    ref1: currentRequest.invoiceid,
    ref2: currentRequest.uuid,
    remark: fccref,
    amount: qrAmount,
    sum_amount: qrAmount,
    currency_code: currencyCode,
    exchange_rate: toNumber(currentRequest.exchange_rate),
    sum_amount_2: amountThb,
    transfer_date: docDate.value,
  };
  let paymentEntryId = currentRequest.payment_entry_id;
  if (existingIndex >= 0) {
    paymentEntryId = paymentEntries.value[existingIndex].id;
    paymentEntries.value[existingIndex] = {
      ...paymentEntries.value[existingIndex],
      label: passBook?.label || passBookCode || `LAO QR ${provider}`,
      amount: amountThb,
      details: {
        ...(paymentEntries.value[existingIndex].details || {}),
        ...laoQrTransferDetails,
      },
    };
  } else {
    paymentEntryId = makeLineId();
    paymentEntries.value.push({
      id: paymentEntryId,
      type: "transfer",
      label: passBook?.label || passBookCode || `LAO QR ${provider}`,
      amount: amountThb,
      details: laoQrTransferDetails,
    });
  }
  currentRequest = patchLaoQrPaymentRequest(currentRequest.local_id, { payment_entry_id: paymentEntryId }) || currentRequest;
  await nextTick();
  refreshPaymentReviewAfterEdit();
  laoQrStatus.value = "saving";
  laoQrMessage.value = tl("ชำระเงินสำเร็จ กำลังบันทึกเอกสาร", "Payment received. Saving document", "ຊຳລະເງິນສຳເລັດ ກຳລັງບັນທຶກເອກະສານ");
  patchLaoQrPaymentRequest(currentRequest.local_id, { status: "saving", message: laoQrMessage.value });
  const ok = await saveDocument();
  if (ok) {
    laoQrStatus.value = "saved";
    laoQrMessage.value = tl("บันทึกเอกสารจากยอด QR สำเร็จ", "Document saved from QR payment", "ບັນທຶກເອກະສານຈາກ QR ສຳເລັດ");
    patchLaoQrPaymentRequest(currentRequest.local_id, { status: "saved", message: laoQrMessage.value, sale_doc_no: successDocNo.value });
  } else {
    laoQrStatus.value = "save_failed";
    laoQrMessage.value = tl("รับเงินแล้ว แต่บันทึกเอกสารไม่สำเร็จ กรุณากดบันทึกซ้ำ", "Payment received, but saving failed. Please retry save", "ຮັບເງິນແລ້ວ ແຕ່ບັນທຶກບໍ່ສຳເລັດ ກະລຸນາບັນທຶກຊ້ຳ");
    patchLaoQrPaymentRequest(currentRequest.local_id, { status: "save_failed", message: laoQrMessage.value, status_result: statusData });
  }
  laoQrSavingPaid.value = false;
}

async function retrySavePaidLaoQr() {
  const request = activeLaoQrRequest.value;
  if (!request || !["paid", "save_failed"].includes(request.status) || saving.value) return;
  await finalizePaidLaoQr(request.status_result || { paid: true, uuid: request.uuid }, request);
}

function confirmCancelLaoQr() {
  if (["paid", "saving", "save_failed", "saved"].includes(laoQrStatus.value)) return;
  syncActiveLaoQrRequestFromState({ status: "pending", message: laoQrMessage.value || tl("รอชำระเงิน", "Waiting for payment", "ລໍຖ້າການຊຳລະ") });
  resetLaoQrPaymentState();
}

function cancelLaoQr() {
  if (["paid", "saving", "save_failed", "saved"].includes(laoQrStatus.value)) return;
  confirm.require({
    header: tl("ยืนยันปิดหน้าต่าง QR", "Confirm closing QR", "ຢືນຢັນປິດໜ້າ QR"),
    message: tl(
      "ปิดหน้าต่าง QR นี้ใช่หรือไม่ รายการ QR จะยังคงรอชำระและสามารถเปิดหรือตรวจสอบภายหลังได้",
      "Close this QR window? The QR request will remain pending and can be opened or checked later.",
      "ປິດໜ້າ QR ນີ້ບໍ? ລາຍການ QR ຈະຍັງລໍຖ້າຊຳລະ ແລະ ເປີດ ຫຼື ກວດພາຍຫຼັງໄດ້",
    ),
    icon: "pi pi-exclamation-triangle",
    rejectLabel: tl("ยกเลิก", "Cancel", "ຍົກເລີກ"),
    acceptLabel: tl("ปิดหน้าต่าง", "Close window", "ປິດໜ້າ"),
    rejectClass: "p-button-secondary",
    acceptClass: "p-button-danger",
    accept: confirmCancelLaoQr,
  });
}

function removePayment(id) {
  if (documentLocked.value) return;
  paymentEntries.value = paymentEntries.value.filter((entry) => entry.id !== id && String(entry.details?._transfer_charge_parent_id || "") !== id);
  refreshPaymentReviewAfterEdit();
}

function saleLineShelfCode(line, fallback = "") {
  return line?._stock_wh_only ? "" : line?.shelf_code || fallback || "";
}

function buildStockValidationRowsFromLines(lines = []) {
  return (Array.isArray(lines) ? lines : [])
    .filter((line) => String(line?.item_code || "").trim() && toNumber(line?.qty) > 0)
    .map((line) => ({
      item_code: line.item_code,
      item_name: line.item_name,
      unit_code: line.unit_code,
      qty: toNumber(line.qty),
      stand_value: toNumber(line.stand_value, 1),
      divide_value: toNumber(line.divide_value, 1),
      ratio: unitRatio(line),
      item_type: line.item_type,
      wh_code: line.wh_code || defaultSaleWarehouseCode([posStore.selectedPos?.pos_ic_wht]) || "",
      shelf_code: saleLineShelfCode(line, posStore.selectedPos?.pos_ic_shelf),
    }));
}

function buildStockValidationRows() {
  return buildStockValidationRowsFromLines(validRows.value);
}

async function validateStockBeforeSave(stockRows = buildStockValidationRows()) {
  if (!(await refreshCompanyOptionsForStockControl())) return;
  const groups = new Map();
  for (const line of stockRows) {
    // service (item_type=1) และ สินค้าชุด (item_type=3) ไม่เช็คสต๊อกที่ frontend
    // — backend คำนวณ component stock ของ set ให้แล้วใน /getProductList
    if (isServiceItem(line) || isSetItem(line)) continue;
    const key = `${line.item_code}|${line.wh_code || ""}|${line.shelf_code || ""}`;
    const group = groups.get(key) || { line, requestedBase: 0 };
    group.requestedBase += toNumber(line.qty) * unitRatio(line);
    groups.set(key, group);
  }
  for (const { line, requestedBase } of groups.values()) {
    const ratio = unitRatio(line);
    const availableBase = await getInventoryBalance(line.item_code, line.wh_code || "", line.shelf_code || "");
    if (requestedBase > availableBase) {
      const availableQty = Math.max(0, rnd(availableBase / ratio, 6));
      const requestedQty = Math.max(0, rnd(requestedBase / ratio, 6));
      const error = new Error(
        tl(
          `${line.item_name} คงเหลือ ${availableQty} ${line.unit_code} แต่มีในรายการ ${requestedQty} ${line.unit_code} กรุณาตรวจสอบ`,
          `${line.item_name} remaining ${availableQty} ${line.unit_code} but ${requestedQty} ${line.unit_code} in order. Please check.`,
          `${line.item_name} ຄົງເຫຼືອ ${availableQty} ${line.unit_code} ແຕ່ມີໃນລາຍການ ${requestedQty} ${line.unit_code} ກະລຸນາກວດສອບ`,
        ),
      );
      error.stockIssue = {
        line,
        item_code: line.item_code,
        item_name: line.item_name,
        unit_code: line.unit_code,
        barcode: line.barcode || "",
        requested_qty: requestedQty,
        requested_base: requestedBase,
        available_qty: availableQty,
        available_base: availableBase,
        wh_code: line.wh_code || "",
        shelf_code: line.shelf_code || "",
        ratio,
      };
      throw error;
    }
  }
}

function saleStockAdjustmentPosText() {
  const pos = posStore.selectedPos || {};
  return String(pos.code || pos.pos_code || pos.pos_id || posStore.posId || "").trim();
}

function saleStockAdjustmentContextFromIssue(issue = {}) {
  const line = issue.line || {};
  const pos = posStore.selectedPos || {};
  const whCode = String(pos.pos_ic_wht || "").trim();
  const shelfCode = String(pos.pos_ic_shelf || "").trim();
  const availableQty = toNumber(issue.available_qty);
  if (!issue.item_code || !whCode) return null;
  const targetQty = Math.max(toNumber(issue.requested_qty), toNumber(line.qty));
  return {
    item_code: String(issue.item_code || line.item_code || "").trim(),
    item_name: String(issue.item_name || line.item_name || "").trim(),
    unit_code: String(issue.unit_code || line.unit_code || "").trim(),
    barcode: String(issue.barcode || line.barcode || "").trim(),
    requested_qty: rnd(targetQty, 6),
    available_qty: rnd(availableQty, 6),
    wh_code: whCode,
    shelf_code: shelfCode,
    branch_code: String(pos.branch_code || branchCode.value || "").trim(),
    pos_id: String(posStore.posId || pos.pos_id || "").trim(),
    pos_code: saleStockAdjustmentPosText(),
  };
}

async function validateStockBeforeAdd(line) {
  const stockRows = buildStockValidationRowsFromLines([...validRows.value, line]);
  try {
    await validateStockBeforeSave(stockRows);
  } catch (error) {
    const detail = error.message || tl("สินค้าไม่พอขาย", "Insufficient stock", "ສິນຄ້າບໍ່ພໍຂາຍ");
    const stockAdjustmentContext = saleStockAdjustmentContextFromIssue(error.stockIssue);
    openSalePolicyDialog({
      type: "warn",
      title: tl("ตรวจเงื่อนไขสินค้า", "Product policy", "ກວດເງື່ອນໄຂສິນຄ້າ"),
      message: tl("ไม่สามารถเพิ่มสินค้านี้เข้าตารางได้", "This product cannot be added to the table.", "ບໍ່ສາມາດເພີ່ມສິນຄ້ານີ້ເຂົ້າຕາຕະລາງໄດ້"),
      details: stockAdjustmentContext
        ? [
            detail,
            tl(
              `คลัง POS: ${stockAdjustmentContext.wh_code}${stockAdjustmentContext.shelf_code ? ` / ${stockAdjustmentContext.shelf_code}` : ""}`,
              `POS warehouse: ${stockAdjustmentContext.wh_code}${stockAdjustmentContext.shelf_code ? ` / ${stockAdjustmentContext.shelf_code}` : ""}`,
              `ຄັງ POS: ${stockAdjustmentContext.wh_code}${stockAdjustmentContext.shelf_code ? ` / ${stockAdjustmentContext.shelf_code}` : ""}`,
            ),
          ]
        : [detail],
      stockAdjustmentContext,
    });
    throw makeSalePolicyError([detail], "", true);
  }
}

function buildSaveSnapshot(saleBenefits = null) {
  return {
    stockRows: buildStockValidationRows(),
    body: buildSaveBody(),
    sale_benefits: saleBenefits || buildSaleBenefitsSnapshot({ saveDate: docDate.value, saveTime: docTime.value || localTimeHHMM() }),
    lao_qr_payment_requests: serializeLaoQrPaymentRequests(),
    line_price_state: validRows.value.map((line) => ({
      price_manual: isManualPriceLine(line),
      price_locked: isPriceRefreshLockedLine(line),
    })),
  };
}

function stableSignatureValue(value) {
  if (Array.isArray(value)) return value.map((item) => stableSignatureValue(item));
  if (!value || typeof value !== "object") return value;
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      const item = value[key];
      if (typeof item !== "function" && item !== undefined) result[key] = stableSignatureValue(item);
      return result;
    }, {});
}

function stableSignatureString(value) {
  return JSON.stringify(stableSignatureValue(value));
}

function optionCode(value, keys = ["code"]) {
  if (!value || typeof value !== "object") return "";
  for (const key of keys) {
    const code = String(value?.[key] || "").trim();
    if (code) return code;
  }
  return "";
}

function buildEditDirtySignature() {
  return stableSignatureString({
    header: {
      doc_no: nextDocNo.value,
      doc_date: docDate.value,
      doc_time: docTime.value,
      tax_doc_no: taxDocNo.value,
      tax_doc_date: taxDocDate.value,
      doc_format_code: docFormatCode.value,
      inquiry_type: toNumber(inquiryType.value),
      cust_code: custCode.value || defaultCustomerCode,
      emp_code: saleCode.value,
      branch_code: branchCode.value,
      doc_group: docGroup.value,
      side_code: sideCode.value,
      department_code: departmentCode.value,
      allocate_code: allocateCode.value,
      project_code: projectCode.value,
      job_code: jobCode.value,
      contactor: contactor.value,
      doc_ref: docRef.value,
      doc_ref_date: docRefDate.value,
      // เอกสารอ้างอิงที่ดึงมา (ใบเสนอราคา/ใบสั่งจอง/ใบสั่งขาย) — backend INSERT ลง ap_ar_trans_detail
      ref_billings: pulledRefDocs.value.map((r) => ({
        doc_no: r.doc_no,
        doc_date: r.doc_date,
        ref_doc_no: r.ref_doc_no || "",
        ref_doc_date: r.ref_doc_date || "",
        bill_type: r.bill_type,
        remark: r.remark || "",
      })),
      sale_group: saleGroup.value,
      cashier_code: cashierCode.value,
      user_approve: userApprove.value,
      remark: remark.value,
      remark_2: remark2.value,
      remark_3: remark3.value,
      remark_4: remark4.value,
      remark_5: remark5.value,
      discount_word: discountWord.value,
      credit_day: toNumber(creditDay.value),
      due_date: dueDate.value,
      send_type: toNumber(sendType.value),
      send_date: sendDate.value,
      delivery_date: deliveryDate.value,
      transport_code: optionCode(transportType.value),
      currency_code: optionCode(documentCurrency.value),
      exchange_rate: toNumber(documentExchangeRate.value, 1),
      rounded_amount: toNumber(roundedAmount.value),
      vat_type: toNumber(vatType.value),
      vat_rate: toNumber(vatRate.value),
    },
    items: validRows.value.map((line) => ({
      item_code: line.item_code,
      item_name: line.item_name,
      unit_code: line.unit_code,
      barcode: line.barcode || "",
      qty: toNumber(line.qty),
      price: toNumber(line.price),
      discount: line.discount || "",
      tax_type: toNumber(line.tax_type),
      wh_code: line.wh_code || defaultSaleWarehouseCode([posStore.selectedPos?.pos_ic_wht]) || "",
      shelf_code: saleLineShelfCode(line, posStore.selectedPos?.pos_ic_shelf),
      stand_value: toNumber(line.stand_value, 1),
      divide_value: toNumber(line.divide_value, 1),
      item_type: line.item_type,
      price_type: toNumber(line.price_type ?? 1, 1),
      price_mode: toNumber(line.price_mode ?? line.price_info ?? 0, 0),
      price_default: toNumber(line.price_default ?? line.price),
      price_info: line.price_info || "",
      drink_type: toNumber(line.drink_type),
      have_point: line.have_point === true,
      no_discount: line.no_discount === true,
      remark: line.remark || "",
      sub_item: isSetItem(line) ? line.sub_item || [] : [],
    })),
    payments: {
      cash_input_amount: toNumber(cashInputAmount.value),
      cash_currency_code: cashCurrencyCode.value,
      cash_currency_amount: toNumber(cashCurrencyAmount.value),
      cash_exchange_rate: toNumber(cashExchangeRate.value, 1),
      entries: paymentEntries.value.map((entry) => ({
        type: entry.type,
        amount: toNumber(entry.amount),
        label: entry.label || "",
        details: entry.details || {},
      })),
    },
    vat_rows: vatRows.value,
    wht_headers: whtHeaders.value,
    shipment: shipment.value,
    gl: {
      gl_trans_direct: toNumber(glTransDirect.value),
      inventory_gl_post_mode: inventoryGlPostMode.value,
      gl_ref_date: glRefDate.value,
      gl_ref_no: glRefNo.value,
      gl_book_code: glBookCode.value,
      gl_journal_type: toNumber(glJournalType.value),
      gl_description: glDescription.value,
      gl_ap_ar_code: glApArCode.value,
      gl_ap_ar_originate_from: toNumber(glApArOriginateFrom.value),
      rows: manualGlRows.value,
    },
  });
}

function buildSaveBody() {
  const pos = posStore.selectedPos || {};
  const activePayments = isCreditSale.value ? [] : paymentEntries.value;
  const rate = toNumber(documentExchangeRate.value, 1);
  const isForeignDocument = isDocumentForeignCurrencyValue();
  const transfers = activePayments.filter((entry) => entry.type === "transfer" || entry.type === "credit_transfer");
  const credits = activePayments.filter((entry) => entry.type === "credit");
  const cashAmountForDocument = isCreditSale.value || nonCashOverPayment.value > 0 ? 0 : cashPaid.value;
  const payCashAmountForDocument = cashPaid.value > 0 ? cashReceiveAmount.value : 0;
  const cashDetailForDocument =
    payCashAmountForDocument > 0
      ? Object.values(cashCurrencyDrafts.value || {})
          .filter((entry) => toNumber(entry?.currency_amount) > 0 && toNumber(entry?.amount) > 0)
          .map((entry) => ({
            currency_code: normalizeCashCurrencyCode(entry.currency_code),
            currency_amount: toNumber(entry.currency_amount),
            exchange_rate: toNumber(entry.exchange_rate, 1),
            amount: toNumber(entry.amount),
          }))
      : [];
  const paymentDetail = activePayments
    .filter((entry) => entry.type !== "cash")
    .map((entry) => {
      const details = entry.details || {};
      const docType = toNumber(details.doc_type);
      const amount = toNumber(details.amount ?? entry.amount);
      const charge = toNumber(details.charge);
      const sumAmount = toNumber(details.sum_amount ?? (docType === 3 ? amount + charge : amount));
      const currencyCode = String(details.currency_code || "").trim();
      const exchangeRate = toNumber(details.exchange_rate, 1) || 1;

      let sumAmount2 = toNumber(details.sum_amount_2);
      let amount2 = toNumber(details.amount_2);
      let charge2 = toNumber(details.charge_2);

      if (currencyCode && exchangeRate > 0) {
        if ([1, 2, 4].includes(docType)) {
          sumAmount2 = docType === 1 && isKipCashCurrencyCode(currencyCode) && sumAmount2 > 0 ? sumAmount2 : rnd(amount * exchangeRate);
        } else if (docType === 3) {
          sumAmount2 = rnd(sumAmount * exchangeRate);
          charge2 = rnd(charge * exchangeRate);
        } else if (docType === 19) {
          sumAmount2 = rnd(sumAmount);
          amount2 = amount2 || amount;
        }
      }

      return {
        type: entry.type,
        doc_type: docType,
        pay_amount: entry.amount,
        amount,
        sum_amount: sumAmount,
        charge,
        trans_number: details.trans_number || details.pass_book_code || details.card_number || "",
        pass_book_code: details.pass_book_code || "",
        book_name: details.book_name || "",
        book_number: details.book_number || "",
        bank_code: details.bank_code || "",
        bank_branch: details.bank_branch || "",
        credit_card_type: details.credit_card_type || "",
        no_approved: details.no_approved || "",
        ref1: details.ref1 || "",
        ref2: details.ref2 || "",
        doc_date_ref: details.doc_date_ref || "",
        chq_due_date: details.chq_due_date || details.transfer_date || "",
        balance_amount: toNumber(details.balance_amount),
        description: details.description || "",
        remark: details.remark || "",
        currency_code: currencyCode,
        exchange_rate: exchangeRate,
        sum_amount_2: sumAmount2,
        amount_2: amount2,
        charge_2: charge2,
        exchange_rate_old: toNumber(details.exchange_rate_old),
        lost_profit_exchange_amount: toNumber(details.lost_profit_exchange_amount),
        chq_on_hand: toNumber(details.chq_on_hand),
      };
    });
  const paymentTypeAmount = (type) => activePayments.filter((entry) => entry.type === type).reduce((sum, entry) => sum + toNumber(entry.amount), 0);
  return {
    pos_id: posStore.posId,
    mode: editMode.value ? "edit" : "create",
    old_doc_no: editMode.value ? oldDocNo.value : "",
    doc_no: editMode.value ? nextDocNo.value : "",
    doc_date: docDate.value,
    doc_time: docTime.value || localTimeHHMM(),
    tax_doc_no: taxDocNo.value || (editMode.value ? nextDocNo.value : ""),
    tax_doc_date: taxDocDate.value,
    creator_code: authStore.employee?.user_code || "",
    doc_format_code: docFormatCode.value,
    form_code: selectedDocFormat.value?.form_code || "",
    branch_code: branchCode.value || pos.branch_code || "",
    doc_group: docGroup.value,
    side_code: sideCode.value,
    department_code: departmentCode.value,
    allocate_code: allocateCode.value,
    project_code: projectCode.value,
    job_code: jobCode.value,
    contactor: contactor.value,
    doc_ref: docRef.value,
    doc_ref_date: docRefDate.value,
    // เอกสารอ้างอิงที่ดึงมา (ใบเสนอราคา/ใบสั่งจอง/ใบสั่งขาย) — backend INSERT ลง ap_ar_trans_detail
    ref_billings: pulledRefDocs.value.map((r) => ({
      doc_no: r.doc_no,
      doc_date: r.doc_date,
      ref_doc_no: r.ref_doc_no || "",
      ref_doc_date: r.ref_doc_date || "",
      bill_type: r.bill_type,
      remark: r.remark || "",
    })),
    sale_group: saleGroup.value,
    cashier_code: cashierCode.value,
    user_approve: userApprove.value,
    cust_code: custCode.value || "AR00569",
    cust_name: custName.value,
    member_code: selectedMemberCode.value,
    emp_code: saleCode.value,
    sale_code: saleCode.value,
    sale_name: saleName.value,
    shelf_code: pos.pos_ic_shelf || "",
    remark: remark.value,
    remark_2: remark2.value,
    remark_3: remark3.value,
    remark_4: remark4.value,
    remark_5: remark5.value,
    send_type: sendType.value,
    send_day: 0,
    send_date: sendDate.value,
    delivery_date: deliveryDate.value,
    credit_day: toNumber(creditDay.value),
    due_date: dueDate.value,
    credit_date: dueDate.value,
    transport_code: transportType.value?.code || "",
    currency_code: documentCurrency.value?.code || "",
    exchange_rate: rate,
    inquiry_type: inquiryType.value,
    vat_type: vatType.value,
    vat_rate: toNumber(vatRate.value, 7),
    discount_type: posStore.erpOption?.discout_type ?? 0,
    discount_word: discountWord.value,
    promotion_discount_amount: promotionDiscountRaw.value,
    promotion_extra_discount_amount: promotionDiscountAmount.value,
    total_value: totals.value.totalValue,
    total_discount: totals.value.totalDiscount,
    total_before_vat: totals.value.beforeVat,
    total_vat_value: totals.value.vatValue,
    total_after_vat: totals.value.afterVat,
    total_except_vat: totals.value.totalExceptVat,
    total_amount: totals.value.totalAmount,
    total_value_2: currencyTotals.value.totalValue,
    total_discount_2: currencyTotals.value.totalDiscount,
    total_amount_2: documentCurrencyAmount.value,
    discount_word_2: discountWord.value,
    total_net_amount: paymentNetAmount.value,
    cash_amount: cashAmountForDocument,
    pay_cash_amount: payCashAmountForDocument,
    money_change: paymentChange.value,
    cash_detail: cashDetailForDocument,
    rounded_amount: toNumber(roundedAmount.value),
    total_income_amount: toNumber(roundedAmount.value),
    tranfer_amount: transfers.reduce((sum, entry) => sum + paymentEntryAmount(entry), 0),
    chq_amount: paymentTypeAmount("cheque"),
    card_amount: credits.reduce((sum, entry) => sum + toNumber(entry.amount), 0),
    total_credit_charge: credits.reduce((sum, entry) => sum + toNumber(entry.details?.charge), 0),
    petty_cash_amount: paymentTypeAmount("petty"),
    deposit_amount: rnd(paymentTypeAmount("deposit")),
    advance_amount: rnd(paymentTypeAmount("deposit_money")),
    coupon_amount: paymentTypeAmount("coupon"),
    total_income_other: paymentTypeAmount("income"),
    total_expense_other: paymentTypeAmount("expense"),
    total_other_currency: paymentTypeAmount("currency"),
    total_other_currency_charge: activePayments.filter((entry) => entry.type === "currency").reduce((sum, entry) => sum + toNumber(entry.details?.charge), 0),
    tiger_pending: false,
    tiger_order_id: "",
    tiger_ref1: "",
    tiger_ref2: "",
    tiger_amount: 0,
    wallet_amount: paymentTypeAmount("wallet"),
    vat_sale: {
      vat_number: taxDocNo.value || (editMode.value ? nextDocNo.value : ""),
      tax_doc_no: taxDocNo.value || (editMode.value ? nextDocNo.value : ""),
      tax_doc_date: taxDocDate.value,
      description: vatSaleDescription.value,
      tax_no: vatSaleTaxNo.value,
      branch_code: vatSaleBranchCode.value,
    },
    vat_rows: vatRowsWithTotals.value.map((row, index) => ({
      line_number: index,
      vat_date: row.vat_date || taxDocDate.value || docDate.value,
      vat_number: String(row.vat_number || "").trim(),
      vat_effective_period: toNumber(row.vat_effective_period),
      vat_effective_year: toNumber(row.vat_effective_year),
      description: String(row.description || "").trim(),
      tax_group: String(row.tax_group || "").trim(),
      base_caltax_amount: toNumber(row.base_caltax_amount),
      tax_rate: toNumber(row.tax_rate),
      amount: toNumber(row.amount),
      except_tax_amount: toNumber(row.except_tax_amount),
      vat_type: toNumber(row.vat_type),
      is_add: toNumber(row.is_add),
      ar_name: String(row.ar_name || "").trim(),
      tax_no: String(row.tax_no || "").trim(),
      branch_type: toNumber(row.branch_type),
      branch_code: String(row.branch_code || "").trim(),
      manual_add: toNumber(row.manual_add),
    })),
    shipment: {
      ...shipment.value,
      transport_code: shipment.value.transport_code || transportType.value?.code || "",
    },
    wht_headers: whtHeaders.value.map((header, index) => {
      const details = Array.isArray(header.details) ? header.details : [];
      const amount = rnd(details.reduce((sum, row) => sum + toNumber(row.amount), 0));
      const taxValue = rnd(details.reduce((sum, row) => sum + toNumber(row.tax_value), 0));
      return {
        line_number: index,
        tax_doc_no: String(header.tax_doc_no || "").trim(),
        due_date: header.due_date || docDate.value,
        cust_code: String(header.cust_code || custCode.value || "").trim(),
        cust_name: String(header.cust_name || "").trim(),
        cust_address: String(header.cust_address || "").trim(),
        cust_tax_type: toNumber(header.cust_tax_type),
        tax_number: String(header.tax_number || "").trim(),
        card_number: String(header.card_number || "").trim(),
        amount,
        tax_value: taxValue,
        details: details.map((row, detailIndex) => ({
          line_number: detailIndex,
          income_type: String(row.income_type || "").trim(),
          amount: toNumber(row.amount),
          tax_rate: toNumber(row.tax_rate),
          tax_value: toNumber(row.tax_value),
          sum_amount: toNumber(row.amount),
          due_date: header.due_date || docDate.value,
        })),
      };
    }),
    gl_trans_direct: glManualMode.value ? 1 : 0,
    inventory_gl_post_override: !glManualMode.value && inventoryGlPostMode.value !== "system" ? inventoryGlPostMode.value : "",
    gl_header: glManualMode.value
      ? {
          ref_date: glRefDate.value || "",
          ref_no: glRefNo.value || "",
          book_code: glBookCode.value || "",
          journal_type: toNumber(glJournalType.value),
          description: glDescription.value || "",
          ap_ar_code: glApArCode.value || "",
          ap_ar_originate_from: toNumber(glApArOriginateFrom.value),
          period_number: toNumber(glPeriodNumber.value),
          account_year: toNumber(glAccountYear.value),
        }
      : null,
    gl_detail: manualGlRows.value.map((row, index) => ({
      line_number: index,
      account_code: row.account_code,
      account_name: row.account_name,
      debit: toNumber(row.debit),
      credit: toNumber(row.credit),
    })),
    promotion_detail: promotionProductRows.value,
    pos_campaign_detail: normalizePosCampaignRows(posCampaignRows.value),
    payment_detail: paymentDetail,
    items: validRows.value.map((line) => ({
      item_code: line.item_code,
      item_name: line.item_name,
      unit_code: line.unit_code,
      qty: toNumber(line.qty),
      price: lineHomePrice(line),
      price_2: isForeignDocument ? toNumber(line.price) : lineHomePrice(line),
      sum_amount: lineHomeSumAmount(line),
      sum_amount_2: isForeignDocument ? lineSumAmount(line) : lineHomeSumAmount(line),
      discount: line.discount || "",
      discount_amount: lineHomeDiscountAmount(line),
      discount_amount_2: isForeignDocument ? lineDiscountAmount(line) : lineHomeDiscountAmount(line),
      tax_type: toNumber(line.tax_type),
      vat_type: vatType.value,
      vat_rate: toNumber(vatRate.value, 7),
      wh_code: line.wh_code || defaultSaleWarehouseCode([pos.pos_ic_wht]) || "",
      shelf_code: saleLineShelfCode(line, pos.pos_ic_shelf),
      stand_value: toNumber(line.stand_value, 1),
      divide_value: toNumber(line.divide_value, 1),
      ratio: unitRatio(line),
      item_type: line.item_type,
      is_permium: line.is_permium,
      is_premium: line.is_premium,
      is_free: line.is_free,
      promotion_free: line.promotion_free,
      premium: line.premium,
      barcode: line.barcode || "",
      price_type: toNumber(line.price_type ?? 1, 1),
      price_mode: toNumber(line.price_mode ?? line.price_info ?? 0, 0),
      price_default: toNumber(line.price_default ?? line.price),
      price_info: line.price_info || "",
      discount_number: promotionDiscountNumber(line),
      drink_type: toNumber(line.drink_type),
      have_point: line.have_point === true,
      no_discount: line.no_discount === true,
      remark: line.remark || "",
      // ผูกกับเอกสารต้นทาง (ถ้าดึงมาจาก "ดึงเอกสารอ้างอิง") เพื่อให้ backend อัปเดต doc_success/used_status ของต้นทาง
      ref_doc_no: line.ref_doc_no || "",
      ref_row: toNumber(line.ref_row, 0),
      // สินค้าชุด: ส่ง children เพื่อให้ backend แตกเป็น ic_trans_detail child rows
      // (set_ref_line, item_code_main, set_ref_price, set_ref_qty, price_set_ratio
      //  คำนวณที่ backend ตามกฎใน MarketPlaceWebServiceExpress)
      sub_item: isSetItem(line) ? line.sub_item || [] : [],
    })),
  };
}

function buildCreditValidationDetails(result) {
  const details = Array.isArray(result?.details) ? result.details.filter(Boolean) : [];
  if (result?.request_ref_no) details.unshift(tl(`เลขที่คำขออนุมัติ ${result.request_ref_no}`, `Approval request no. ${result.request_ref_no}`, `ເລກຄຳຂໍອະນຸມັດ ${result.request_ref_no}`));
  return details;
}

function isBackendSaveValidationResult(result) {
  if (!result || result.success !== false) return false;
  return Boolean(result.code || result.msg || result.message || Array.isArray(result.details));
}

function openBackendSaveValidationDialog(result) {
  const code = String(result?.code || "").toUpperCase();
  const savingPaidQr = laoQrSavingPaid.value || laoQrStatus.value === "saving";
  const details = buildCreditValidationDetails(result);
  const isBusinessRule = ["SALE_ITEM_POLICY_BLOCKED", "SALE_TOTAL_MISMATCH"].includes(code) || details.length > 0;
  openSaveDialog({
    type: isBusinessRule ? "warn" : "error",
    title:
      result?.title || (savingPaidQr ? tl("รับเงินแล้ว แต่บันทึกไม่ได้", "Payment received, but save failed", "ຮັບເງິນແລ້ວ ແຕ່ບັນທຶກບໍ່ໄດ້") : tl("บันทึกไม่สำเร็จ", "Save failed", "ບັນທຶກບໍ່ສຳເລັດ")),
    message:
      result?.message ||
      result?.msg ||
      (savingPaidQr
        ? tl(
            "เอกสารไม่ผ่านเงื่อนไขจาก backend กรุณาตรวจสอบก่อนกดบันทึกซ้ำ",
            "The document did not pass backend validation. Please review before saving again.",
            "ເອກະສານບໍ່ຜ່ານການກວດຈາກ backend ກະລຸນາກວດກ່ອນບັນທຶກຊ້ຳ",
          )
        : tl("เอกสารไม่ผ่านเงื่อนไขจาก backend", "The document did not pass backend validation.", "ເອກະສານບໍ່ຜ່ານການກວດຈາກ backend")),
    details,
  });
}

function applyServerTotalsToBody(body, serverTotals = {}) {
  const totalAmount = toNumber(serverTotals.total_amount, toNumber(body.total_amount));
  const totalNetExtra = Math.max(0, toNumber(body.total_net_amount) - toNumber(body.total_amount));
  const totalNetAmount = toNumber(serverTotals.total_net_amount, totalAmount + totalNetExtra);
  const hasNonCashPayment =
    ["tranfer_amount", "chq_amount", "card_amount", "petty_cash_amount", "deposit_amount", "coupon_amount", "total_income_other", "total_expense_other", "total_other_currency", "wallet_amount"].some(
      (key) => toNumber(body[key]) !== 0,
    ) ||
    (Array.isArray(body.payment_detail) && body.payment_detail.length > 0);
  const shouldAdjustCash = ![0, 2].includes(toNumber(body.inquiry_type)) && !hasNonCashPayment && toNumber(body.cash_amount) > 0;
  const hasCashTendered = toNumber(body.pay_cash_amount) > 0;
  const adjustedCashAmount = shouldAdjustCash ? totalNetAmount : body.cash_amount;
  const adjustedCashDetail =
    shouldAdjustCash && !hasCashTendered && Array.isArray(body.cash_detail) && body.cash_detail.length === 1
      ? [
          {
            ...body.cash_detail[0],
            amount: totalNetAmount,
            currency_amount: String(body.cash_detail[0].currency_code || "THB").toUpperCase() === "THB" ? totalNetAmount : body.cash_detail[0].currency_amount,
          },
        ]
      : body.cash_detail;
  const adjustedMoneyChange = hasCashTendered ? Math.max(0, rnd(toNumber(body.pay_cash_amount) - toNumber(adjustedCashAmount))) : body.money_change;
  return {
    ...body,
    accept_server_totals: true,
    total_value: toNumber(serverTotals.total_value, body.total_value),
    total_discount: toNumber(serverTotals.total_discount, body.total_discount),
    total_before_vat: toNumber(serverTotals.total_before_vat, body.total_before_vat),
    total_vat_value: toNumber(serverTotals.total_vat_value, body.total_vat_value),
    total_after_vat: toNumber(serverTotals.total_after_vat, body.total_after_vat),
    total_except_vat: toNumber(serverTotals.total_except_vat, body.total_except_vat),
    total_amount: totalAmount,
    total_value_2: toNumber(serverTotals.total_value_2, body.total_value_2),
    total_discount_2: toNumber(serverTotals.total_discount_2, body.total_discount_2),
    total_amount_2: toNumber(serverTotals.total_amount_2, body.total_amount_2),
    total_net_amount: totalNetAmount,
    cash_amount: adjustedCashAmount,
    money_change: adjustedMoneyChange,
    cash_detail: adjustedCashDetail,
  };
}

function openServerTotalsDialog(snapshot, confirmations, creditApprove, result) {
  const serverTotals = result?.server_totals || {};
  const details = Array.isArray(result?.details) ? [...result.details] : [];
  details.push(
    tl(
      `ยอดสุทธิหน้าจอ ${formatCurrency(snapshot.body.total_amount)} / backend ${formatCurrency(serverTotals.total_amount)}`,
      `Screen net amount ${formatCurrency(snapshot.body.total_amount)} / backend ${formatCurrency(serverTotals.total_amount)}`,
      `ຍອດສຸດທິໜ້າຈໍ ${formatCurrency(snapshot.body.total_amount)} / backend ${formatCurrency(serverTotals.total_amount)}`,
    ),
  );
  openSaveDialog({
    type: "warn",
    title: result?.title || tl("ยอดขายถูกคำนวณใหม่", "Sale amount was recalculated", "ຍອດຂາຍຖືກຄຳນວນໃໝ່"),
    message:
      result?.message ||
      result?.msg ||
      tl(
        "ยอดที่หน้าจอส่งมาไม่ตรงกับยอดที่ backend คำนวณจาก company setting",
        "Screen amount does not match backend calculation from company setting",
        "ຍອດທີ່ໜ້າຈໍສົ່ງມາບໍ່ກົງກັບທີ່ backend ຄຳນວນຈາກ company setting",
      ),
    details,
    primaryLabel: tl("ใช้ยอด backend แล้วบันทึก", "Use backend amount and save", "ໃຊ້ຍອດ backend ແລ້ວບັນທຶກ"),
    primarySeverity: "warning",
    primaryAction: async () => {
      saving.value = true;
      try {
        await persistSaveSnapshot({ ...snapshot, body: applyServerTotalsToBody(snapshot.body, serverTotals) }, confirmations, creditApprove);
      } catch (error) {
        openSaveDialog({
          type: "error",
          title: tl("บันทึกไม่สำเร็จ", "Save failed", "ບັນທຶກບໍ່ສຳເລັດ"),
          message: error.message || tl("บันทึกไม่สำเร็จ", "Save failed", "ບັນທຶກບໍ່ສຳເລັດ"),
        });
      } finally {
        saving.value = false;
      }
    },
  });
}

function openCreditApproveDialog(snapshot, confirmations, result) {
  creditApproveSnapshot.value = snapshot;
  creditApproveConfirmations.value = [...confirmations];
  creditApproveUser.value = "";
  creditApprovePassword.value = "";
  creditApproveMessage.value = result?.message || result?.msg || tl("ต้องอนุมัติวงเงินเครดิตก่อนบันทึก", "Credit limit approval is required before saving", "ຕ້ອງອະນຸມັດວົງເງິນເຄຣດິດກ່ອນບັນທຶກ");
  creditApproveDetails.value = buildCreditValidationDetails(result);
  creditApproveDialogVisible.value = true;
}

async function submitCreditApprove() {
  const snapshot = creditApproveSnapshot.value;
  if (!snapshot) return;
  if (!creditApproveUser.value || !creditApprovePassword.value) {
    creditApproveMessage.value = tl("กรุณาระบุผู้อนุมัติและรหัสผ่าน", "Please enter approver and password", "ກະລຸນາລະບຸຜູ້ອະນຸມັດແລະລະຫັດຜ່ານ");
    return;
  }
  saving.value = true;
  try {
    const approve = {
      user_code: creditApproveUser.value,
      password: creditApprovePassword.value,
    };
    creditApproveDialogVisible.value = false;
    await persistSaveSnapshot(snapshot, creditApproveConfirmations.value, approve);
  } catch (error) {
    openSaveDialog({
      type: "error",
      title: tl("บันทึกไม่สำเร็จ", "Save failed", "ບັນທຶກບໍ່ສຳເລັດ"),
      message: error.message || tl("บันทึกไม่สำเร็จ", "Save failed", "ບັນທຶກບໍ່ສຳເລັດ"),
    });
  } finally {
    creditApprovePassword.value = "";
    saving.value = false;
  }
}

async function resolveSaleBenefitsForPersist(snapshot, saveDate, saveTime) {
  const reusable = snapshot?.sale_benefits;
  const currentSignature = buildSaleBenefitsSignature(saveDate, saveTime);
  if (reusable?.signature && reusable.signature === currentSignature) {
    return {
      promotion_detail: Array.isArray(reusable.promotion_detail) ? reusable.promotion_detail : [],
      pos_campaign_detail: normalizePosCampaignRows(reusable.pos_campaign_detail),
      promotion_discount_amount: toNumber(reusable.promotion_discount_amount),
      promotion_extra_discount_amount: toNumber(reusable.promotion_extra_discount_amount),
    };
  }

  const promotionRows = await refreshPromotionBeforeSave(saveDate, saveTime, buildPromotionItems());
  const campaignRows = await refreshPosCampaignBeforeSave(saveDate, saveTime, buildPosCampaignItems());
  const refreshed = {
    signature: currentSignature,
    promotion_detail: promotionRows,
    pos_campaign_detail: normalizePosCampaignRows(campaignRows),
    promotion_discount_amount: promotionDiscountRaw.value,
    promotion_extra_discount_amount: promotionDiscountAmount.value,
  };
  if (snapshot) snapshot.sale_benefits = refreshed;
  return refreshed;
}

async function persistSaveSnapshot(snapshot, confirmations = [], creditApprove = null) {
  const saveTime = snapshot.body?.doc_time || localTimeHHMM();
  const saveDate = snapshot.body?.doc_date || docDate.value;
  const saleBenefits = await resolveSaleBenefitsForPersist(snapshot, saveDate, saveTime);
  docTime.value = saveTime;
  const result = await saveTransAndPro({
    ...snapshot.body,
    doc_time: saveTime,
    promotion_discount_amount: saleBenefits.promotion_discount_amount,
    promotion_extra_discount_amount: saleBenefits.promotion_extra_discount_amount,
    promotion_detail: saleBenefits.promotion_detail,
    pos_campaign_detail: saleBenefits.pos_campaign_detail,
    credit_confirmations: confirmations,
    ...(creditApprove ? { credit_approve: creditApprove } : {}),
  });
  if (result?.success) {
    successDocNo.value = result.doc_no;
    syncCustomerDisplayState();
    void playThankYouAudioAfterSaleSave();
    void openCashDrawerAfterCashPayment(snapshot.body);
    void printReceiptAfterSave(result.doc_no, result.form_code);
    if (!paymentDialogVisible.value) {
      openSaveDialog({
        type: "success",
        title: tl("บันทึกเอกสารสำเร็จ", "Document saved successfully", "ບັນທຶກເອກະສານສຳເລັດ"),
        message: tl(`เลขที่เอกสาร ${result.doc_no}`, `Document no. ${result.doc_no}`, `ເລກທີເອກະສານ ${result.doc_no}`),
      });
    }
    return true;
  }

  if (result?.code === "SALE_TOTAL_MISMATCH") {
    openServerTotalsDialog(snapshot, confirmations, creditApprove, result);
    return false;
  }

  if (result?.require_approve_password) {
    openCreditApproveDialog(snapshot, confirmations, result);
    return false;
  }

  if (result?.require_confirm) {
    openSaveDialog({
      type: "warn",
      title: result.title || tl("ต้องยืนยันก่อนบันทึก", "Confirmation required before save", "ຕ້ອງຢືນຢັນກ່ອນບັນທຶກ"),
      message:
        result.message ||
        result.msg ||
        tl("ตรวจพบเงื่อนไขที่ต้องยืนยัน ต้องการดำเนินการต่อหรือไม่", "A condition requires confirmation. Do you want to continue?", "ພົບເງື່ອນໄຂທີ່ຕ້ອງຢືນຢັນ ຕ້ອງການດຳເນີນການຕໍ່ບໍ?"),
      details: buildCreditValidationDetails(result),
      primaryLabel: t("sell.continue"),
      primarySeverity: "warning",
      primaryAction: async () => {
        saving.value = true;
        try {
          await persistSaveSnapshot(snapshot, [...confirmations, result.require_confirm], creditApprove);
        } catch (error) {
          openSaveDialog({
            type: "error",
            title: tl("บันทึกไม่สำเร็จ", "Save failed", "ບັນທຶກບໍ່ສຳເລັດ"),
            message: error.message || tl("บันทึกไม่สำเร็จ", "Save failed", "ບັນທຶກບໍ່ສຳເລັດ"),
          });
        } finally {
          saving.value = false;
        }
      },
    });
    return false;
  }

  if (isBackendSaveValidationResult(result)) {
    openBackendSaveValidationDialog(result);
    return false;
  }

  openSaveDialog({
    type: result?.level === "info" ? "info" : "error",
    title: result?.title || tl("บันทึกไม่สำเร็จ", "Save failed", "ບັນທຶກບໍ່ສຳເລັດ"),
    message: result?.message || result?.msg || tl("บันทึกไม่สำเร็จ", "Save failed", "ບັນທຶກບໍ່ສຳເລັດ"),
    details: buildCreditValidationDetails(result),
  });
  return false;
}

function firstFormCode(formCodeText = "") {
  return String(formCodeText || "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean)[0] || "";
}

async function printReceiptAfterSave(docNo, savedFormCode = "") {
  const cfg = posStore.deviceConfig;
  if (!cfg.autoprint) return;

  const mode = cfg.printer_mode || "html";
  const printerName = cfg.printer_name || "";
  if (!printerName) return;

  let formCode = firstFormCode(savedFormCode);
  if (!formCode) {
    try {
      const result = await getSalePrintForms(docNo);
      formCode = preferredPrintFormCode(result?.forms || []);
    } catch (err) {
      console.warn("[printReceiptAfterSave] load forms failed", err);
      return;
    }
  }
  if (!formCode) return;

  // ESC/POS thermal: ต้องมี printer_name และ Electron bridge
  if (false && mode === "escpos" && printerName && window.bizsuitDevices?.printRawHex) {
    try {
      const hex = await fetchThermalReceiptHex(docNo);
      if (!hex) return;
      await window.bizsuitDevices.printRawHex(hex, {
        printerName,
        docName: `Receipt ${docNo}`,
      });
      toast.add({
        severity: "success",
        summary: tl("พิมพ์ใบเสร็จ", "Receipt printed", "ພິມໃບຮັບເງິນ"),
        detail: docNo,
        life: 2000,
      });
    } catch (err) {
      toast.add({
        severity: "warn",
        summary: tl("พิมพ์ใบเสร็จ", "Receipt printer", "ພິມໃບຮັບເງິນ"),
        detail: err.message,
        life: 3000,
      });
    }
    return;
  }

  // HTML print — dot matrix / ทั่วไป / fallback จาก escpos ที่ไม่มี printer_name
  // ถ้า mode === 'none' ไม่พิมพ์
  if (mode === "none") return;

  const userCode = authStore.employee?.user_code || "";
  const url = isPosSlipFormCode(formCode)
    ? getSalePosSlipPrintUrl(docNo, userCode, buildPaymentSuccessSlipDisplayParams())
    : getSalePrintUrl(docNo, [formCode], userCode);

  if (printerName && window.bizsuitDevices?.printUrl) {
    window.bizsuitDevices.printUrl(url, { printerName, silent: true });
  } else if (window.bizsuitDevices?.printUrl) {
    window.bizsuitDevices.printUrl(url, { silent: false });
  } else {
    window.open(url, "_blank");
  }
}

function configuredDocumentPrinter() {
  const cfg = posStore.deviceConfig || {};
  const mode = String(cfg.printer_mode || "html").toLowerCase();
  const printerName = String(cfg.printer_name || "").trim();
  if (mode === "none" || !printerName) return null;
  return { mode, printerName };
}

function availablePrintForms(forms = []) {
  return (Array.isArray(forms) ? forms : []).filter((form) => form.available);
}

function preferredPrintFormCode(forms = []) {
  const available = availablePrintForms(forms);
  return available.find((form) => form.is_default)?.formcode || available[0]?.formcode || "";
}

function isPosSlipFormCode(formCode) {
  return String(formCode || "").trim().toUpperCase() === "CR-0088";
}

async function printSaleDocumentForm(docNo, formCode, { silentWhenConfigured = false } = {}) {
  const code = String(formCode || "").trim();
  if (!docNo || !code) return false;
  const printUrl = isPosSlipFormCode(code)
    ? getSalePosSlipPrintUrl(docNo, authStore.employee?.user_code || "", buildPaymentSuccessSlipDisplayParams())
    : getSalePrintUrl(docNo, [code], authStore.employee?.user_code || "");
  const printer = configuredDocumentPrinter();
  if (window.bizsuitDevices?.printUrl) {
    try {
      const url = new URL(printUrl, window.location.href);
      url.searchParams.set("auto_print", "0");
      const printOptions = printer ? { printerName: printer.printerName, silent: true, docName: `${docNo}-${code}` } : { silent: silentWhenConfigured ? false : undefined };
      await window.bizsuitDevices.printUrl(url.toString(), printOptions);
      toast.add({
        severity: "success",
        summary: t("sell.print"),
        detail: tl("ส่งงานพิมพ์แล้ว", "Print job sent", "ສົ່ງວຽກພິມແລ້ວ"),
        life: 1800,
      });
      return true;
    } catch (error) {
      toast.add({
        severity: "warn",
        summary: t("sell.print"),
        detail: error.message || tl("พิมพ์ผ่านเครื่องลูกข่ายไม่สำเร็จ", "Client printer failed", "ພິມຜ່ານເຄື່ອງລູກຂ່າຍບໍ່ສຳເລັດ"),
        life: 3000,
      });
      return false;
    }
  }
  window.open(printUrl, "_blank", "noopener");
  return true;
}

async function openCashDrawerAfterCashPayment(body = {}) {
  if (!window.bizsuitDevices?.openCashDrawer) return;
  if (toNumber(body.cash_amount) <= 0 && toNumber(body.pay_cash_amount) <= 0) return;
  const cfg = posStore.deviceConfig;
  if (String(cfg.cash_drawer_mode || "printer").toLowerCase() === "printer" && !cfg.cash_drawer_printer_name && !cfg.printer_name) return;
  const drawerOptions = cfg.cash_drawer_mode
    ? {
        mode: cfg.cash_drawer_mode,
        printerName: cfg.cash_drawer_printer_name || cfg.printer_name || undefined,
        port: cfg.cash_drawer_port || undefined,
        baudRate: cfg.cash_drawer_baud_rate || undefined,
        drawerId: cfg.cash_drawer_drawer_id || undefined,
        openBytesHex: cfg.cash_drawer_open_bytes_hex || undefined,
      }
    : {};
  try {
    await window.bizsuitDevices.openCashDrawer(drawerOptions);
  } catch (error) {
    toast.add({
      severity: "warn",
      summary: tl("ลิ้นชักเงิน", "Cash drawer", "ລິ້ນຊັກເງິນ"),
      detail: error.message || tl("เปิดลิ้นชักเงินไม่สำเร็จ", "Failed to open cash drawer", "ເປີດລິ້ນຊັກເງິນບໍ່ສຳເລັດ"),
      life: 3000,
    });
  }
}

async function openCashDrawerManual() {
  if (cashDrawerOpening.value) return;
  if (!window.bizsuitDevices?.openCashDrawer) {
    toast.add({
      severity: "warn",
      summary: tl("ลิ้นชักเงิน", "Cash drawer", "ລິ້ນຊັກເງິນ"),
      detail: tl("เปิดลิ้นชักได้เฉพาะแอป Electron ที่ตั้งค่าอุปกรณ์แล้ว", "Cash drawer is available only in the configured Electron app", "ເປີດລິ້ນຊັກໄດ້ສະເພາະແອັບ Electron ທີ່ຕັ້ງຄ່າອຸປະກອນແລ້ວ"),
      life: 2600,
    });
    return;
  }
  requestProtectedActionPermission({
    actionLabel: tl("เปิดลิ้นชักเงิน", "Open cash drawer", "ເປີດລິ້ນຊັກເງິນ"),
    action: performOpenCashDrawerManual,
    verifier: verifyCashDrawerPermission,
    deniedText: tl("ผู้ใช้นี้ไม่มีสิทธิ์เปิดลิ้นชักเงิน", "This user cannot open the cash drawer", "ຜູ້ໃຊ້ນີ້ບໍ່ມີສິດເປີດລິ້ນຊັກເງິນ"),
    header: tl("ยืนยันสิทธิ์เปิดลิ้นชัก", "Authorize cash drawer", "ຢືນຢັນສິດເປີດລິ້ນຊັກ"),
    helpText: tl("ต้องใช้ผู้ใช้ที่มีสิทธิ์เปิดลิ้นชักเงิน", "Requires a user with cash drawer permission", "ຕ້ອງໃຊ້ຜູ້ໃຊ້ທີ່ມີສິດເປີດລິ້ນຊັກເງິນ"),
    allowLocked: true,
  });
}

async function performOpenCashDrawerManual() {
  if (cashDrawerOpening.value) return;
  cashDrawerOpening.value = true;
  const cfg = posStore.deviceConfig;
  if (String(cfg.cash_drawer_mode || "printer").toLowerCase() === "printer" && !cfg.cash_drawer_printer_name && !cfg.printer_name) {
    toast.add({
      severity: "warn",
      summary: tl("ลิ้นชักเงิน", "Cash drawer", "ລິ້ນຊັກເງິນ"),
      detail: tl("ยังไม่ได้ตั้งค่าเครื่องพิมพ์สำหรับเปิดลิ้นชัก", "No printer is configured for the cash drawer.", "ຍັງບໍ່ໄດ້ຕັ້ງຄ່າເຄື່ອງພິມສຳລັບເປີດລິ້ນຊັກ"),
      life: 2600,
    });
    cashDrawerOpening.value = false;
    return;
  }
  const drawerOptions = cfg.cash_drawer_mode
    ? {
        mode: cfg.cash_drawer_mode,
        printerName: cfg.cash_drawer_printer_name || cfg.printer_name || undefined,
        port: cfg.cash_drawer_port || undefined,
        baudRate: cfg.cash_drawer_baud_rate || undefined,
        drawerId: cfg.cash_drawer_drawer_id || undefined,
        openBytesHex: cfg.cash_drawer_open_bytes_hex || undefined,
      }
    : {};
  try {
    await window.bizsuitDevices.openCashDrawer(drawerOptions);
    toast.add({
      severity: "success",
      summary: tl("ลิ้นชักเงิน", "Cash drawer", "ລິ້ນຊັກເງິນ"),
      detail: tl("ส่งคำสั่งเปิดลิ้นชักแล้ว", "Cash drawer command sent", "ສົ່ງຄຳສັ່ງເປີດລິ້ນຊັກແລ້ວ"),
      life: 1800,
    });
  } catch (error) {
    toast.add({
      severity: "warn",
      summary: tl("ลิ้นชักเงิน", "Cash drawer", "ລິ້ນຊັກເງິນ"),
      detail: error.message || tl("เปิดลิ้นชักเงินไม่สำเร็จ", "Failed to open cash drawer", "ເປີດລິ້ນຊັກເງິນບໍ່ສຳເລັດ"),
      life: 3000,
    });
  } finally {
    cashDrawerOpening.value = false;
  }
}

async function saveDocument() {
  if (saving.value) return false;
  errorMsg.value = "";
  if (editMode.value && !editDocumentDirty.value) {
    return false;
  }
  saving.value = true;
  try {
    const saveTime = localTimeHHMM();
    const saleBenefits = await refreshSaleBenefitsBeforeSave(docDate.value, saveTime);
    docTime.value = saveTime;
    await nextTick();
    if (validationMessages.value.length) {
      workspaceTab.value = firstValidationTab();
      openSaveDialog({
        type: "warn",
        title: tl("ยังบันทึกไม่ได้", "Cannot save yet", "ຍັງບັນທຶກບໍ່ໄດ້"),
        message: tl("กรุณาตรวจสอบข้อมูลเอกสารก่อนบันทึก", "Please check document data before saving", "ກະລຸນາກວດຂໍ້ມູນເອກະສານກ່ອນບັນທຶກ"),
        details: validationMessages.value,
        showPaymentReviewAction: documentValidationMessages.value.length === 0 && paymentReviewNeeded.value && remainingPayment.value <= 0 && nonCashOverPayment.value <= 0 && cashChangeAllowed.value,
      });
      return false;
    }
    const snapshot = buildSaveSnapshot(saleBenefits);
    if (!(await validateSalePoliciesBeforeSave(snapshot.body))) return false;
    await validateStockBeforeSave(snapshot.stockRows);
    return await persistSaveSnapshot(snapshot);
  } catch (error) {
    openSaveDialog({
      type: "error",
      title: tl("บันทึกไม่สำเร็จ", "Save failed", "ບັນທຶກບໍ່ສຳເລັດ"),
      message: error.message || tl("บันทึกไม่สำเร็จ", "Save failed", "ບັນທຶກບໍ່ສຳເລັດ"),
    });
    return false;
  } finally {
    saving.value = false;
  }
}

async function newDocument() {
  clearLaoQrPaymentRequests();
  unlockCustomerDisplayPaymentDue();
  syncCustomerDisplayIdleState();
  saveDialogVisible.value = false;
  await router.replace({ name: "Sell", query: { _new: String(Date.now()) } });
}

async function openPrintDialog() {
  const docNo = activePrintDocNo.value;
  if (!docNo) return;
  printLoading.value = true;
  printError.value = "";
  printForms.value = [];
  selectedPrintForm.value = "";
  try {
    const result = await getSalePrintForms(docNo);
    const forms = result?.forms || [];
    printForms.value = forms;
    const available = availablePrintForms(forms);
    if (forms.length === 1 && available.length === 1) {
      await printSaleDocumentForm(docNo, available[0].formcode, { silentWhenConfigured: true });
      printDialogVisible.value = false;
      return;
    }
    selectedPrintForm.value = preferredPrintFormCode(forms);
    if (!forms.length) printError.value = tl("เอกสารนี้ยังไม่ได้กำหนด form_code สำหรับพิมพ์", "This document has no form_code configured for printing", "ເອກະສານນີ້ຍັງບໍ່ໄດ້ກຳນົດ form_code ສຳລັບພິມ");
    else if (!selectedPrintForm.value) printError.value = tl("ไม่พบฟอร์มที่พร้อมใช้งาน", "No available print forms found", "ບໍ່ພົບຟອມທີ່ພ້ອມໃຊ້ງານ");
    printDialogVisible.value = true;
  } catch (error) {
    printError.value = error.message || tl("โหลดฟอร์มพิมพ์ไม่สำเร็จ", "Failed to load print forms", "ໂຫຼດຟອມພິມບໍ່ສຳເລັດ");
    printDialogVisible.value = true;
  } finally {
    printLoading.value = false;
  }
}

async function confirmPrintForms() {
  const docNo = activePrintDocNo.value;
  if (!docNo || !selectedPrintForm.value) return;
  const printed = await printSaleDocumentForm(docNo, selectedPrintForm.value, { silentWhenConfigured: true });
  if (printed) printDialogVisible.value = false;
}

function backToSaleDetail() {
  router.push({ name: "SalesHistory" });
}
</script>

<template>
  <div class="sell-view biz-page" data-font-zone="screen" :class="`sale-density-${saleDensity}`" :style="saleLayoutStyle">
    <div class="biz-page-header" style="background-color: transparent !important">
      <section
        class="workspace-tabs-card"
        data-font-zone="main-tabs"
        style="background-color: transparent !important"
        :aria-label="tl('ส่วนงานเอกสารขาย', 'Sale document workspaces', 'ສ່ວນງານເອກະສານຂາຍ')"
      >
        <div class="workspace-tabs" role="tablist" :aria-label="tl('เลือกส่วนงานขาย', 'Select sale workspace', 'ເລືອກສ່ວນງານຂາຍ')">
          <button
            v-for="tab in workspaceTabs"
            :key="tab.value"
            type="button"
            role="tab"
            :aria-selected="workspaceTab === tab.value"
            :class="{ active: workspaceTab === tab.value }"
            @click="workspaceTab = tab.value"
          >
            <span>{{ tab.label }}</span>
          </button>
        </div>
      </section>
      <div class="workspace-actions" data-font-zone="main-menu">
        <button v-if="!isViewOnly" type="button" :disabled="saving" @click="openHeldBillDialog">
          <i class="pi pi-folder-open" />
          <span>{{ tl("เรียกบิลพัก", "Held bills", "ບິນພັກ") }}</span>
        </button>
        <button v-if="!isViewOnly" type="button" :disabled="!canHoldBill" @click="holdCurrentBill">
          <i :class="holdingBill ? 'pi pi-spin pi-spinner' : 'pi pi-pause'" />
          <span>{{ tl("พักบิล", "Hold bill", "ພັກບິນ") }}</span>
        </button>
        <button v-if="!isViewOnly" type="button" :disabled="saving" @click="newDocument">
          <i class="pi pi-plus" />
          <span>{{ t("sell.newDocument") }}</span>
        </button>

        <Button v-if="editMode" :label="tl('กลับ', 'Back', 'ກັບ')" icon="pi pi-arrow-left" severity="secondary" outlined :disabled="saving" @click="backToSaleDetail" />
        <Button
          v-if="editMode && (!isViewOnly || canPrintSalesDocument)"
          :label="t('sell.print')"
          icon="pi pi-print"
          severity="secondary"
          outlined
          :disabled="saving || !activePrintDocNo"
          @click="requestPrintDocument"
        />
        <Button
          v-if="!isViewOnly && customerDisplayAvailable"
          :label="tl('จอลูกค้า', 'Customer display', 'ຈໍລູກຄ້າ')"
          icon="pi pi-desktop"
          severity="secondary"
          outlined
          :loading="customerDisplayOpening"
          :disabled="saving || customerDisplayOpening"
          @click="openCustomerDisplay()"
        />
        <Button
          v-if="isViewOnly && editMode && canEditSalesDocument"
          :label="tl('แก้ไข', 'Edit', 'ແກ້ໄຂ')"
          icon="pi pi-pencil"
          severity="warning"
          outlined
          :disabled="!docCanEdit"
          @click="requestViewOnlyEditDocument"
        />
        <Button
          v-if="editMode && !isViewOnly && !isCashSale"
          :label="successDocNo ? `${t('sell.saved')} ${successDocNo}` : editMode && !editDocumentDirty ? t('sell.noChange') : `${t('sell.save')} ${formatCurrency(totals.totalAmount)}`"
          icon="pi pi-save"
          :loading="saving"
          :disabled="!canSave || !!successDocNo"
          @click="saveDocument"
        />
      </div>
    </div>

    <!-- <Message v-if="errorMsg" severity="warn" :closable="false">{{ errorMsg }}</Message> -->

    <div class="sell-grid">
      <main class="document-workspace">
        <section v-show="workspaceTab === 'documents'" class="biz-panel document-panel" style="padding: 0.7rem">
          <div class="grid formgrid">
            <div class="col-12 md:col-4">
              <label class="field">
                <span>{{ t("sell.docDate") }}</span>
                <IsoDatePicker v-model="docDate" disabled />
              </label>
            </div>
            <div class="col-12 md:col-4">
              <label class="field">
                <span>{{ t("sell.docTime") }}</span>
                <InputText v-model="docTime" type="time" disabled />
              </label>
            </div>

            <div class="col-12 md:col-6 lg:col-4">
              <label class="field">
                <span>{{ t("sell.contact") }}</span>
                <Select
                  v-model="contactor"
                  :options="
                    contactorList.map((r) => ({
                      label: `${r.code || ''} ${r.name || r.name_1 || ''}`.trim(),
                      value: r.code,
                    }))
                  "
                  option-label="label"
                  option-value="value"
                  :placeholder="t('sell.contact')"
                  :disabled="documentLocked"
                  filter
                  show-clear
                />
              </label>
            </div>

            <div class="col-12 md:col-6 lg:col-4">
              <label class="field">
                <span>{{ t("sell.vatRate") }}</span>
                <InputText v-model="vatRate" :disabled="documentLocked" :placeholder="t('sell.vatRate')" />
              </label>
            </div>
            <div class="col-12 md:col-6 lg:col-4">
              <label class="field">
                <span>{{ t("sell.taxDate") }}</span>
                <IsoDatePicker v-model="taxDocDate" :disabled="documentLocked" />
              </label>
            </div>
            <!-- <div class="col-12 md:col-6 lg:col-4">
              <label class="field">
                <span>{{ t("sell.taxNo") }}</span>
                <InputText v-model.trim="taxDocNo" :disabled="documentLocked" :placeholder="t('sell.taxNo')" />
              </label>
            </div> -->
            <div class="col-12 md:col-6 lg:col-4">
              <label class="field">
                <span>{{ t("sell.refNo") }}</span>
                <InputText v-model.trim="docRef" :disabled="documentLocked" :placeholder="tl('(ทางเลือก)', '(Optional)', '(ທາງເລືອກ)')" />
              </label>
            </div>
            <div class="col-12 md:col-6 lg:col-4">
              <label class="field">
                <span>{{ t("sell.refDate") }}</span>
                <IsoDatePicker v-model="docRefDate" :disabled="documentLocked" />
              </label>
            </div>
            <div class="col-12 md:col-6 lg:col-4">
              <label class="field">
                <span>{{ t("sell.saleType") }}</span>
                <Select v-model="inquiryType" :options="inquiryTypeOptions" option-label="label" option-value="value" :disabled="documentLocked" />
              </label>
            </div>
            <div class="col-12 md:col-6 lg:col-4">
              <label class="field">
                <span>{{ t("sell.taxType") }}</span>
                <Select v-model="vatType" :options="vatTypeOptions" option-label="label" option-value="value" :disabled="documentLocked" />
              </label>
            </div>
            <div class="col-12 md:col-6 lg:col-4">
              <label class="field">
                <span>{{ t("sell.saleGroup") }}</span>
                <Select
                  v-model="saleGroup"
                  :options="
                    saleGroupList.map((r) => ({
                      label: `${r.code || ''} ${r.name_1 || ''}`.trim(),
                      value: r.code,
                    }))
                  "
                  option-label="label"
                  option-value="value"
                  :placeholder="t('sell.saleGroup')"
                  :disabled="documentLocked"
                  filter
                  show-clear
                />
              </label>
            </div>
          </div>
        </section>

        <section v-show="['vat', 'wht', 'deposit_money', 'shipment', 'gl'].includes(workspaceTab)" class="biz-panel additional-panel">
          <!-- WHT Panel -->
          <div v-show="extraSubTab === 'wht'" class="extra-doc-grid extra-panel">
            <div class="extra-doc-block full-width">
              <h3>{{ t("sell.wht") }}</h3>
              <div class="wht-toolbar">
                <Button :label="tl('เพิ่มหัวเอกสาร', 'Add header', 'ເພີ່ມຫົວເອກະສານ')" icon="pi pi-plus" size="small" :disabled="documentLocked" @click="addWhtHeader" />
                <span class="wht-summary"
                  >{{ tl("รวมฐานภาษี", "Base total", "ລວມຖານພາສີ") }} {{ formatCurrency(whtTotalAmount) }} ·
                  {{ tl("รวมภาษีหัก", "WHT total", "ລວມພາສີຫັກ") }}
                  {{ formatCurrency(whtTotalTax) }}</span
                >
              </div>

              <div class="mini-table wht-header-table" v-if="whtHeaders.length">
                <div class="mini-row header wht-header-row">
                  <span>{{ tl("เลขที่ใบหักภาษี", "WHT document no.", "ເລກໃບຫັກພາສີ") }}</span>
                  <span>{{ tl("ลูกหนี้", "Debtor", "ລູກໜີ້") }}</span>
                  <span>{{ tl("ชื่อผู้ถูกหัก", "Withheld name", "ຊື່ຜູ້ຖືກຫັກ") }}</span>
                  <span>{{ tl("วันที่หัก ณ ที่จ่าย", "WHT date", "ວັນທີຫັກ") }}</span>
                  <span>{{ t("sell.amount") }}</span>
                  <span>{{ t("sell.wht") }}</span>
                  <span></span>
                </div>
                <button
                  v-for="header in whtHeaders"
                  :key="header.id"
                  type="button"
                  class="mini-row wht-header-row wht-header-button"
                  :class="{ active: selectedWhtHeaderId === header.id }"
                  @click="selectedWhtHeaderId = header.id"
                >
                  <span>{{ header.tax_doc_no || "-" }}</span>
                  <span>{{ header.cust_code || "-" }}</span>
                  <span>{{ header.cust_name || "-" }}</span>
                  <span>{{ header.due_date || "-" }}</span>
                  <span>{{ formatCurrency((header.details || []).reduce((sum, row) => sum + toNumber(row.amount), 0)) }}</span>
                  <span>{{ formatCurrency((header.details || []).reduce((sum, row) => sum + toNumber(row.tax_value), 0)) }}</span>
                  <span>
                    <Button icon="pi pi-trash" text rounded severity="danger" :disabled="documentLocked" @click.stop="removeWhtHeader(header.id)" />
                  </span>
                </button>
              </div>
              <div v-else class="advance-empty">
                <p>
                  {{ tl("ยังไม่มีหัวเอกสารภาษีหัก ณ ที่จ่าย", "No withholding tax header yet", "ຍັງບໍ່ມີຫົວເອກະສານພາສີຫັກ") }}
                </p>
              </div>

              <div class="wht-header-form" v-if="selectedWhtHeader">
                <label class="field">
                  <span>{{ tl("วันที่หัก ณ ที่จ่าย", "WHT date", "ວັນທີຫັກ") }}</span>
                  <IsoDatePicker v-model="whtHeaderDueDate" class="wht-native-date" :disabled="documentLocked" />
                </label>
                <label class="field">
                  <span>{{ tl("เลขที่เอกสารหัก", "WHT document no.", "ເລກເອກະສານຫັກ") }}</span>
                  <InputText v-model.trim="whtHeaderTaxDocNo" :disabled="documentLocked" />
                </label>
                <label class="field">
                  <span>{{ tl("ลูกหนี้", "Debtor", "ລູກໜີ້") }}</span>
                  <InputText v-model.trim="whtHeaderCustCode" :disabled="documentLocked" />
                </label>
                <label class="field">
                  <span>{{ tl("ชื่อผู้ถูกหัก", "Withheld name", "ຊື່ຜູ້ຖືກຫັກ") }}</span>
                  <InputText v-model.trim="whtHeaderCustName" :disabled="documentLocked" />
                </label>
                <label class="field wide-local">
                  <span>{{ tl("ที่อยู่", "Address", "ທີ່ຢູ່") }}</span>
                  <Textarea v-model.trim="whtHeaderCustAddress" rows="2" auto-resize :disabled="documentLocked" />
                </label>
                <label class="field">
                  <span>{{ tl("ประเภท", "Type", "ປະເພດ") }}</span>
                  <Select
                    v-model="whtHeaderCustTaxType"
                    :options="[
                      {
                        label: tl('บุคคลธรรมดา', 'Individual', 'ບຸກຄົນທຳມະດາ'),
                        value: 0,
                      },
                      { label: tl('นิติบุคคล', 'Company', 'ນິຕິບຸກຄົນ'), value: 1 },
                    ]"
                    option-label="label"
                    option-value="value"
                    :disabled="documentLocked"
                  />
                </label>
                <label class="field">
                  <span>{{ tl("เลขที่ผู้เสียภาษี", "Tax no.", "ເລກຜູ້ເສຍພາສີ") }}</span>
                  <InputText v-model.trim="whtHeaderTaxNumber" :disabled="documentLocked" />
                </label>
                <label class="field">
                  <span>{{ tl("เลขประจำตัวผู้เสียภาษี", "Tax ID", "ເລກປະຈຳຕົວຜູ້ເສຍພາສີ") }}</span>
                  <InputText v-model.trim="whtHeaderCardNumber" :disabled="documentLocked" />
                </label>
              </div>

              <div class="wht-detail-hints" v-if="selectedWhtHeader">
                <span>{{ tl("ประเภทเงินได้", "Income type", "ປະເພດລາຍໄດ້") }}</span>
                <span>{{ t("sell.amount") }}</span>
                <span>{{ tl("อัตรา%", "Rate %", "ອັດຕາ%") }}</span>
                <span></span>
              </div>
              <div class="extra-inline-form wht-detail-form" v-if="selectedWhtHeader">
                <InputText v-model.trim="whtIncomeType" :placeholder="tl('ประเภทเงินได้', 'Income type', 'ປະເພດລາຍໄດ້')" :disabled="documentLocked" />
                <InputNumber v-model="whtAmount" input-class="text-right" :placeholder="t('sell.amount')" :min="0" :min-fraction-digits="2" :max-fraction-digits="2" :disabled="documentLocked" />
                <InputNumber v-model="whtRate" input-class="text-right" :placeholder="tl('อัตรา %', 'Rate %', 'ອັດຕາ %')" :min="0" :max-fraction-digits="2" :disabled="documentLocked" />
                <Button icon="pi pi-plus" outlined :disabled="documentLocked || whtAmount <= 0" @click="addWhtDetailRow" />
              </div>

              <div v-if="selectedWhtHeader && selectedWhtDetails.length" class="mini-table">
                <div class="mini-row header wht-detail-row">
                  <span>{{ tl("ประเภทเงินได้", "Income type", "ປະເພດລາຍໄດ້") }}</span>
                  <span>{{ t("sell.amount") }}</span>
                  <span>{{ tl("อัตรา%", "Rate %", "ອັດຕາ%") }}</span>
                  <span>{{ t("sell.wht") }}</span>
                  <span></span>
                </div>
                <div v-for="row in selectedWhtDetails" :key="row.id" class="mini-row wht-detail-row">
                  <InputText v-model.trim="row.income_type" :disabled="documentLocked" />
                  <InputNumber
                    :model-value="row.amount"
                    input-class="text-right"
                    :min="0"
                    :min-fraction-digits="2"
                    :max-fraction-digits="2"
                    :disabled="documentLocked"
                    @update:model-value="updateWhtDetailAmount(row, $event)"
                  />
                  <InputNumber
                    :model-value="row.tax_rate"
                    input-class="text-right"
                    :min="0"
                    :max-fraction-digits="2"
                    :disabled="documentLocked"
                    @update:model-value="updateWhtDetailRate(row, $event)"
                  />
                  <InputNumber
                    :model-value="row.tax_value"
                    input-class="text-right"
                    :min="0"
                    :min-fraction-digits="2"
                    :max-fraction-digits="2"
                    :disabled="documentLocked"
                    @update:model-value="updateWhtDetailTaxValue(row, $event)"
                  />
                  <Button icon="pi pi-trash" text rounded severity="danger" :disabled="documentLocked" @click="removeWhtDetailRow(row.id)" />
                </div>
                <div class="mini-row total wht-detail-row">
                  <span>{{ tl("รวม", "Total", "ລວມ") }}</span>
                  <span>{{ formatCurrency(selectedWhtAmount) }}</span>
                  <span></span>
                  <strong>{{ formatCurrency(selectedWhtTax) }}</strong>
                  <span></span>
                </div>
              </div>
            </div>
          </div>

          <!-- VAT Panel -->
          <div v-show="extraSubTab === 'vat'" class="extra-doc-grid extra-panel">
            <div class="extra-doc-block full-width">
              <h3>{{ t("sell.vat") }}</h3>
              <div class="vat-toolbar">
                <label><input v-model="vatAutoInput" type="checkbox" :disabled="documentLocked" /> {{ tl("ช่วยป้อนค่าต่อเนื่อง", "Continue values automatically", "ຊ່ວຍປ້ອນຄ່າຕໍ່ເນື່ອງ") }}</label>
                <label
                  ><input v-model="vatAutoNumber" type="checkbox" :disabled="documentLocked" />
                  {{ tl("นับเลขที่ใบกำกับภาษีอัตโนมัติ", "Auto tax invoice number", "ນັບເລກໃບກຳກັບພາສີອັດຕະໂນມັດ") }}</label
                >
                <label
                  ><input v-model="vatCreateDefaultRow" type="checkbox" :disabled="documentLocked" />
                  {{ tl("สร้างแถวแรกจากเอกสารอัตโนมัติ", "Create first row from document", "ສ້າງແຖວທຳອິດຈາກເອກະສານອັດຕະໂນມັດ") }}</label
                >
                <label><input v-model="vatAutoCalc" type="checkbox" :disabled="documentLocked" /> {{ tl("คำนวณยอดภาษีอัตโนมัติ", "Auto calculate tax", "ຄຳນວນຍອດພາສີອັດຕະໂນມັດ") }}</label>
                <Button :label="tl('เพิ่มแถว VAT', 'Add VAT row', 'ເພີ່ມແຖວ VAT')" icon="pi pi-plus" size="small" :disabled="documentLocked" @click="addVatRow" />
              </div>

              <div class="mini-table vat-grid" v-if="vatRowsWithTotals.length">
                <div class="mini-row header vat-row">
                  <span>{{ tl("วันที่ใบกำกับ", "Invoice date", "ວັນທີໃບກຳກັບ") }}</span>
                  <span>{{ tl("เลขที่ใบกำกับ", "Invoice no.", "ເລກໃບກຳກັບ") }}</span>
                  <span>{{ tl("งวดภาษี", "Tax period", "ງວດພາສີ") }}</span>
                  <span>{{ tl("ปีภาษี", "Tax year", "ປີພາສີ") }}</span>
                  <span>{{ tl("รายละเอียด", "Description", "ລາຍລະອຽດ") }}</span>
                  <span>{{ tl("กลุ่มภาษี", "Tax group", "ກຸ່ມພາສີ") }}</span>
                  <span>{{ tl("ฐานภาษี", "Tax base", "ຖານພາສີ") }}</span>
                  <span>{{ tl("อัตรา%", "Rate %", "ອັດຕາ%") }}</span>
                  <span>{{ tl("ยอดภาษี", "Tax amount", "ຍອດພາສີ") }}</span>
                  <span>{{ tl("ยอดยกเว้น", "Exempt amount", "ຍອດຍົກເວັ້ນ") }}</span>
                  <span>{{ t("sell.taxType") }}</span>
                  <span>{{ tl("ชื่อผู้ซื้อ", "Buyer name", "ຊື່ຜູ້ຊື້") }}</span>
                  <span>{{ tl("เลขผู้เสียภาษี", "Tax no.", "ເລກຜູ້ເສຍພາສີ") }}</span>
                  <span>{{ t("sell.branch") }}</span>
                  <span></span>
                </div>
                <div
                  v-for="row in vatRowsWithTotals"
                  :key="row.id"
                  class="mini-row vat-row"
                  :class="{
                    warning: Math.abs((toNumber(row.base_caltax_amount) * toNumber(row.tax_rate)) / 100 - toNumber(row.amount)) > 0.01,
                  }"
                >
                  <IsoDatePicker class="vat-native-date" :model-value="row.vat_date" :disabled="documentLocked" @update:model-value="updateVatDate(row, $event)" />
                  <InputText v-model.trim="row.vat_number" :disabled="documentLocked" />
                  <InputNumber :model-value="row.vat_effective_period" :disabled="true" input-class="text-right" :min="1" :max="12" />
                  <InputNumber :model-value="row.vat_effective_year" :disabled="true" input-class="text-right" :min="2500" />
                  <InputText v-model.trim="row.description" :disabled="documentLocked" />
                  <InputText v-model.trim="row.tax_group" :disabled="documentLocked" />
                  <InputNumber
                    :model-value="row.base_caltax_amount"
                    input-class="text-right"
                    :min="0"
                    :min-fraction-digits="2"
                    :max-fraction-digits="2"
                    :disabled="documentLocked"
                    @update:model-value="updateVatBase(row, $event)"
                  />
                  <InputNumber :model-value="row.tax_rate" input-class="text-right" :min="0" :max-fraction-digits="2" :disabled="documentLocked" @update:model-value="updateVatRate(row, $event)" />
                  <InputNumber v-model="row.amount" input-class="text-right" :min="0" :min-fraction-digits="2" :max-fraction-digits="2" :disabled="documentLocked || vatAutoCalc" />
                  <InputNumber v-model="row.except_tax_amount" input-class="text-right" :min="0" :min-fraction-digits="2" :max-fraction-digits="2" :disabled="documentLocked" />
                  <Select v-model="row.vat_type" :options="vatSaleTypeOptions" option-label="label" option-value="value" :disabled="documentLocked" />
                  <InputText :model-value="row.ar_name" :disabled="documentLocked" @update:model-value="updateVatArName(row, $event)" />
                  <InputText :model-value="row.tax_no" :disabled="documentLocked" @update:model-value="updateVatTaxNo(row, $event)" />
                  <div class="vat-branch-wrap">
                    <Select
                      :model-value="row.branch_type"
                      :options="vatBranchTypeOptions"
                      option-label="label"
                      option-value="value"
                      :disabled="documentLocked"
                      @update:model-value="updateVatBranchType(row, $event)"
                    />
                    <InputText
                      :model-value="row.branch_code"
                      :disabled="documentLocked || toNumber(row.branch_type) !== 1"
                      :placeholder="tl('รหัสสาขา', 'Branch code', 'ລະຫັດສາຂາ')"
                      @update:model-value="updateVatBranchCode(row, $event)"
                    />
                  </div>
                  <Button icon="pi pi-trash" text rounded severity="danger" :disabled="documentLocked" @click="removeVatRow(row.id)" />
                </div>
                <div class="mini-row total vat-row-total">
                  <span>{{ tl("รวม", "Total", "ລວມ") }}</span>
                  <span></span>
                  <span></span>
                  <span></span>
                  <span></span>
                  <span></span>
                  <strong>{{ formatCurrency(vatTotalBase) }}</strong>
                  <span></span>
                  <strong>{{ formatCurrency(vatTotalAmount) }}</strong>
                  <strong>{{ formatCurrency(vatTotalExceptAmount) }}</strong>
                  <span></span>
                  <span></span>
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>

              <div v-else class="advance-empty">
                <p>
                  {{ tl("ยังไม่มีรายการภาษีมูลค่าเพิ่ม", "No VAT rows yet", "ຍັງບໍ່ມີລາຍການ VAT") }}
                </p>
              </div>
            </div>
          </div>

          <!-- ADVANCE Panel (read-only) -->
          <div v-show="extraSubTab === 'advance'" class="extra-doc-grid extra-panel">
            <div class="extra-doc-block full-width">
              <h3>
                {{ tl("เงินล่วงหน้า (อ่านอย่างเดียว)", "Advance (read only)", "ເງິນລ່ວງໜ້າ (ອ່ານເທົ່ານັ້ນ)") }}
              </h3>
              <div class="advance-readonly-note">
                <p>
                  <strong>{{ t("sell.remark") }}:</strong>
                  {{
                    tl(
                      'หากต้องการแก้ไขเงินล่วงหน้า โปรดเลือกวิธีการชำระเงินแบบ "เงินล่วงหน้า" ในแท็บรับชำระ',
                      "To edit advance payment, choose the Advance payment method in the payment tab",
                      "ຖ້າຕ້ອງການແກ້ໄຂເງິນລ່ວງໜ້າ ໃຫ້ເລືອກວິທີຊຳລະແບບເງິນລ່ວງໜ້າໃນແທັບຮັບຊຳລະ",
                    )
                  }}
                </p>
              </div>
              <div v-if="paymentEntries.length" class="mini-table">
                <div class="mini-row header">
                  <span>{{ tl("เลขที่เอกสาร", "Document no.", "ເລກທີເອກະສານ") }}</span>
                  <span>{{ tl("ยอดเอกสาร", "Document amount", "ຍອດເອກະສານ") }}</span>
                  <span>{{ t("sell.remaining") }}</span>
                  <span>{{ tl("ยอดตัด", "Deduct amount", "ຍອດຕັດ") }}</span>
                </div>
                <div v-for="(entry, idx) in paymentEntries.filter((p) => p.type === 'deposit')" :key="idx" class="mini-row">
                  <span>{{ entry.doc_no || "-" }}</span>
                  <span>{{ formatCurrency(entry.master_amount || 0) }}</span>
                  <span>{{ formatCurrency(entry.balance_amount || 0) }}</span>
                  <span
                    ><strong>{{ formatCurrency(entry.amount) }}</strong></span
                  >
                </div>
              </div>
              <div v-else class="advance-empty">
                <p>
                  {{ tl("ยังไม่มีการเลือกเงินล่วงหน้า", "No advance payment selected", "ຍັງບໍ່ໄດ້ເລືອກເງິນລ່ວງໜ້າ") }}
                </p>
              </div>
            </div>
          </div>

          <!-- DEPOSIT MONEY Panel -->
          <div v-show="extraSubTab === 'deposit_money'" class="extra-doc-grid extra-panel">
            <div class="extra-doc-block full-width">
              <h3>
                {{ tl("เงินมัดจำ", "Deposit", "ເງິນມັດຈຳ") }}
              </h3>
              <div class="pay-form pay-form-grid grid formgrid">
                <label class="field wide col-12 md:col-6">
                  <span>{{ tl("เลขที่เงินมัดจำ", "Deposit no.", "ເລກເງິນມັດຈຳ") }}</span>
                  <Select
                    v-model="depositMoneyDoc"
                    :options="depositMoneyOptions"
                    option-label="label"
                    :placeholder="tl('เลือกเอกสารเงินมัดจำ', 'Select deposit document', 'ເລືອກເອກະສານເງິນມັດຈຳ')"
                    :disabled="documentLocked"
                    filter
                    @show="refreshDepositMoneyOptions"
                  />
                </label>
                <label class="field col-12 md:col-3">
                  <span>{{ tl("ยอดตัด", "Deduct amount", "ຍອດຕັດ") }}</span>
                  <InputNumber
                    v-model="depositMoneyAmount"
                    input-class="text-right"
                    :min="selectedDepositMoneyMinAmount"
                    :max="selectedDepositMoneyMaxAmount"
                    :min-fraction-digits="2"
                    :max-fraction-digits="2"
                    :disabled="documentLocked || !depositMoneyDoc"
                  />
                </label>
                <div class="field col-12 md:col-3">
                  <span>&nbsp;</span>
                  <Button
                    :label="tl('เพิ่มเงินมัดจำ', 'Add deposit', 'ເພີ່ມເງິນມັດຈຳ')"
                    icon="pi pi-plus"
                    style="min-height: 3rem"
                    fluid
                    :disabled="documentLocked || !selectedDepositMoneyAmountValid"
                    @click="addDepositMoney"
                  />
                </div>
              </div>
              <div v-if="depositMoneyDoc" class="payment-master-note">
                <span>{{ depositMoneyDoc.doc_no }}</span>
                <span>{{ tl("ยอดเอกสาร", "Document amount", "ຍອດເອກະສານ") }} {{ formatCurrency(depositMoneyDoc.amount || depositMoneyDoc.total_amount || 0) }}</span>
                <span>{{ t("sell.remaining") }} {{ formatCurrency(depositMoneyDoc.balance_amount || 0) }}</span>
              </div>
              <div v-if="depositMoneyPaymentEntries.length" class="mini-table">
                <div class="mini-row header">
                  <span>{{ tl("เลขที่เอกสาร", "Document no.", "ເລກທີເອກະສານ") }}</span>
                  <span>{{ tl("ยอดเอกสาร", "Document amount", "ຍອດເອກະສານ") }}</span>
                  <span>{{ t("sell.remaining") }}</span>
                  <span>{{ tl("ยอดตัด", "Deduct amount", "ຍອດຕັດ") }}</span>
                  <span></span>
                </div>
                <div v-for="entry in depositMoneyPaymentEntries" :key="entry.id" class="mini-row">
                  <span>{{ entry.doc_no || entry.details?.trans_number || "-" }}</span>
                  <span>{{ formatCurrency(entry.master_amount || entry.details?.sum_amount || 0) }}</span>
                  <span>{{ formatCurrency(entry.balance_amount || entry.details?.balance_amount || 0) }}</span>
                  <span
                    ><strong>{{ formatCurrency(entry.amount) }}</strong></span
                  >
                  <Button
                    icon="pi pi-trash"
                    text
                    rounded
                    severity="danger"
                    :aria-label="tl('ลบรายการเงินมัดจำ', 'Remove deposit line', 'ລຶບລາຍການເງິນມັດຈຳ')"
                    :disabled="documentLocked"
                    @click="removePayment(entry.id)"
                  />
                </div>
              </div>
              <div v-else class="advance-empty">
                <p>
                  {{ tl("ยังไม่มีการเลือกเงินมัดจำ", "No deposit selected", "ຍັງບໍ່ໄດ້ເລືອກເງິນມັດຈຳ") }}
                </p>
              </div>
            </div>
          </div>

          <!-- GL Panel -->
          <div v-show="extraSubTab === 'gl'" class="extra-doc-grid extra-panel">
            <div class="extra-doc-block full-width">
              <h3>GL</h3>
              <div class="gl-mode-toolbar">
                <label>
                  {{ tl("โหมด GL", "GL mode", "ໂໝດ GL") }}
                  <Select
                    v-model="glTransDirect"
                    :options="[
                      {
                        label: tl('คีย์รายการเอง', 'Manual entry', 'ປ້ອນລາຍການເອງ'),
                        value: 1,
                      },
                      {
                        label: tl('ระบบลงบัญชีอัตโนมัติ', 'Automatic posting', 'ລະບົບລົງບັນຊີອັດຕະໂນມັດ'),
                        value: 0,
                      },
                    ]"
                    option-label="label"
                    option-value="value"
                    :disabled="documentLocked"
                  />
                </label>
                <label v-if="!glManualMode">
                  {{ tl("โหมดบัญชีสต๊อก", "Inventory GL mode", "ໂໝດບັນຊີສະຕ໊ອກ") }}
                  <Select v-model="inventoryGlPostMode" :options="inventoryGlPostModeOptions" option-label="label" option-value="value" :disabled="documentLocked" />
                </label>
                <span v-if="!glManualMode" class="gl-mode-note"
                  >{{
                    tl(
                      "โหมดอัตโนมัติ: ระบบจะสร้างรายการ GL ตอนบันทึกเอกสาร",
                      "Automatic mode: the system will create GL rows when saving the document",
                      "ໂໝດອັດຕະໂນມັດ: ລະບົບຈະສ້າງລາຍການ GL ຕອນບັນທຶກເອກະສານ",
                    )
                  }}
                  (Inventory GL: {{ inventoryGlModeHint }})</span
                >
              </div>
              <div v-if="glManualMode" class="extra-grid-2">
                <label class="field">
                  <span>{{ tl("วันที่อ้างอิง", "Reference date", "ວັນທີອ້າງອີງ") }}</span>
                  <IsoDatePicker v-model="glRefDate" :disabled="documentLocked || !glManualMode" />
                </label>
                <label class="field">
                  <span>{{ tl("เลขที่อ้างอิง", "Reference no.", "ເລກອ້າງອີງ") }}</span>
                  <InputText v-model="glRefNo" :disabled="documentLocked || !glManualMode" maxlength="50" :placeholder="tl('เลขที่อ้างอิง', 'Reference no.', 'ເລກອ້າງອີງ')" />
                </label>
                <label class="field">
                  <span>{{ t("sell.accountBook") }}</span>
                  <Select
                    v-model="glBookCode"
                    :options="glBookCodeOptions"
                    option-label="label"
                    option-value="value"
                    :placeholder="tl('เลือกสมุดบัญชี', 'Select account book', 'ເລືອກສົມຸດບັນຊີ')"
                    :disabled="documentLocked || !glManualMode"
                    filter
                    show-clear
                  />
                </label>
                <label class="field">
                  <span>{{ tl("ประเภทบัญชี", "Journal type", "ປະເພດບັນຊີ") }}</span>
                  <Select v-model="glJournalType" :options="glJournalTypeOptions" option-label="label" option-value="value" :disabled="documentLocked || !glManualMode" />
                </label>
                <label class="field wide-local">
                  <span>{{ tl("คำอธิบาย", "Description", "ຄຳອະທິບາຍ") }}</span>
                  <Textarea v-model="glDescription" rows="2" auto-resize :disabled="documentLocked || !glManualMode" />
                </label>
                <label class="field">
                  <span>{{ tl("บัญชี AP/AR", "AP/AR account", "ບັນຊີ AP/AR") }}</span>
                  <Select
                    v-model="glApArCode"
                    :options="glAccounts"
                    option-label="label"
                    option-value="code"
                    :placeholder="tl('เลือกบัญชี', 'Select account', 'ເລືອກບັນຊີ')"
                    :disabled="documentLocked || !glManualMode"
                    filter
                    show-clear
                  />
                </label>
                <label class="field">
                  <span>{{ tl("แหล่งที่มา AP/AR", "AP/AR source", "ແຫຼ່ງທີ່ມາ AP/AR") }}</span>
                  <Select v-model="glApArOriginateFrom" :options="glApArOriginateFromOptions" option-label="label" option-value="value" :disabled="documentLocked || !glManualMode" />
                </label>
                <label class="field">
                  <span>{{ tl("งวด", "Period", "ງວດ") }}</span>
                  <InputNumber :model-value="glPeriodNumber" :use-grouping="false" disabled />
                </label>
                <label class="field">
                  <span>{{ tl("ปีบัญชี", "Account year", "ປີບັນຊີ") }}</span>
                  <InputNumber :model-value="glAccountYear" :use-grouping="false" disabled />
                </label>
              </div>
              <div class="extra-inline-form gl-form">
                <Select v-model="manualGlAccount" :options="glAccounts" option-label="label" :placeholder="tl('บัญชี', 'Account', 'ບັນຊີ')" :disabled="documentLocked || !glManualMode" filter />
                <InputNumber
                  v-model="manualGlDebit"
                  input-class="text-right"
                  :placeholder="tl('เดบิต', 'Debit', 'ເດບິດ')"
                  :min="0"
                  :min-fraction-digits="2"
                  :max-fraction-digits="2"
                  :disabled="documentLocked || !glManualMode"
                />
                <InputNumber
                  v-model="manualGlCredit"
                  input-class="text-right"
                  :placeholder="tl('เครดิต', 'Credit', 'ເຄຣດິດ')"
                  :min="0"
                  :min-fraction-digits="2"
                  :max-fraction-digits="2"
                  :disabled="documentLocked || !glManualMode"
                />
                <Button icon="pi pi-plus" outlined :disabled="documentLocked || !glManualMode || !manualGlAccount || (manualGlDebit <= 0 && manualGlCredit <= 0)" @click="addManualGlRow" />
              </div>
              <div v-if="manualGlRows.length" class="mini-table">
                <div v-for="row in manualGlRows" :key="row.id" class="mini-row gl-row">
                  <span>{{ row.account_code }} {{ row.account_name }}</span>
                  <span>{{ formatCurrency(row.debit) }}</span>
                  <span>{{ formatCurrency(row.credit) }}</span>
                  <Button icon="pi pi-trash" text rounded severity="danger" :disabled="documentLocked || !glManualMode" @click="removeManualGlRow(row.id)" />
                </div>
                <div class="mini-row total gl-row" :class="{ warning: !manualGlBalanced }">
                  <span>{{ tl("รวม", "Total", "ລວມ") }}</span>
                  <strong>{{ formatCurrency(manualGlDebitTotal) }}</strong>
                  <strong>{{ formatCurrency(manualGlCreditTotal) }}</strong>
                  <span></span>
                </div>
              </div>
            </div>
          </div>

          <!-- SHIPMENT Panel -->
          <div v-show="extraSubTab === 'shipment'" class="extra-doc-grid extra-panel">
            <div class="extra-doc-block full-width">
              <h3>{{ t("sell.shipment") }}</h3>
              <div class="grid formgrid shipment-panel-grid">
                <div class="col-12 md:col-4">
                  <label class="field">
                    <span>{{ tl("ประเภทการจัดส่ง", "Delivery type", "ປະເພດການຈັດສົ່ງ") }}</span>
                    <SelectButton
                      :model-value="transportType?.code || shipment.transport_code || ''"
                      :options="shipmentTransportTypeOptions"
                      option-label="label"
                      option-value="code"
                      fluid
                      :allow-empty="false"
                      :disabled="documentLocked || !shipmentTransportTypeOptions.length"
                      @update:model-value="updateShipmentTransportType"
                    />
                  </label>
                </div>
                <div class="col-12 md:col-4">
                  <label class="field">
                    <span>{{ tl("ชื่อผู้รับ/ขนส่ง", "Receiver/Transport", "ຊື່ຜູ້ຮັບ/ຂົນສົ່ງ") }}</span>
                    <InputText v-model.trim="shipment.transport_name" :disabled="documentLocked" />
                  </label>
                </div>

                <div class="col-12 md:col-4">
                  <label class="field">
                    <span>{{ tl("โทรศัพท์", "Phone", "ໂທລະສັບ") }}</span>
                    <InputText v-model.trim="shipment.transport_telephone" :disabled="documentLocked" />
                  </label>
                </div>
                <div class="col-12 md:col-4">
                  <label class="field">
                    <span>{{ tl("แฟกซ์", "Fax", "ແຟັກ") }}</span>
                    <InputText v-model.trim="shipment.transport_fax" :disabled="documentLocked" />
                  </label>
                </div>
                <div class="col-12 md:col-12">
                  <label class="field">
                    <span>{{ tl("ที่อยู่", "Address", "ທີ່ຢູ່") }}</span>
                    <Textarea v-model.trim="shipment.transport_address" rows="2" auto-resize :disabled="documentLocked" />
                  </label>
                </div>
                <div class="col-12 md:col-4">
                  <label class="field">
                    <span>{{ tl("จังหวัด", "Province", "ແຂວງ") }}</span>
                    <Select
                      v-model="shipment.transport_province"
                      :options="provinceOptions"
                      option-label="label"
                      option-value="value"
                      :loading="shipmentMasterLoading.province"
                      :disabled="documentLocked"
                      :placeholder="tl('เลือกจังหวัด', 'Select province', 'ເລືອກແຂວງ')"
                      filter
                      show-clear
                      @show="loadProvinceOptions()"
                      @filter="onProvinceFilter"
                    />
                  </label>
                </div>
                <div class="col-12 md:col-4">
                  <label class="field">
                    <span>{{ tl("อำเภอ", "District", "ເມືອງ") }}</span>
                    <Select
                      v-model="shipment.transport_amper"
                      :options="amperOptions"
                      option-label="label"
                      option-value="value"
                      :loading="shipmentMasterLoading.amper"
                      :disabled="documentLocked || !shipment.transport_province"
                      :placeholder="tl('เลือกอำเภอ', 'Select district', 'ເລືອກເມືອງ')"
                      filter
                      show-clear
                      @show="loadAmperOptions(shipment.transport_province)"
                      @filter="onAmperFilter"
                    />
                  </label>
                </div>
                <div class="col-12 md:col-4">
                  <label class="field">
                    <span>{{ tl("ตำบล", "Subdistrict", "ບ້ານ/ຕາແສງ") }}</span>
                    <Select
                      v-model="shipment.transport_tambon"
                      :options="tambonOptions"
                      option-label="label"
                      option-value="value"
                      :loading="shipmentMasterLoading.tambon"
                      :disabled="documentLocked || !shipment.transport_province || !shipment.transport_amper"
                      :placeholder="tl('เลือกตำบล', 'Select subdistrict', 'ເລືອກບ້ານ/ຕາແສງ')"
                      filter
                      show-clear
                      @show="loadTambonOptions(shipment.transport_province, shipment.transport_amper)"
                      @filter="onTambonFilter"
                    />
                  </label>
                </div>
                <div class="col-12 md:col-4">
                  <label class="field">
                    <span>{{ tl("รหัสไปรษณีย์", "Postal code", "ລະຫັດໄປສະນີ") }}</span>
                    <InputText v-model.trim="shipment.zipcode" :disabled="documentLocked" />
                  </label>
                </div>
                <div class="col-12 md:col-4">
                  <label class="field">
                    <span>{{ tl("ประเทศ", "Country", "ປະເທດ") }}</span>
                    <InputText v-model.trim="shipment.transport_country" :disabled="documentLocked" />
                  </label>
                </div>
                <div class="col-12 md:col-4">
                  <label class="field">
                    <span>Ship Code</span>
                    <InputText v-model.trim="shipment.ship_code" :disabled="documentLocked" />
                  </label>
                </div>
                <div class="col-12 md:col-4">
                  <label class="field">
                    <span>{{ tl("เขตการขนส่ง", "Logistic area", "ເຂດຂົນສົ່ງ") }}</span>
                    <Select
                      v-model="shipment.logistic_area"
                      :options="logisticAreaOptions"
                      option-label="label"
                      option-value="value"
                      :loading="shipmentMasterLoading.logisticArea"
                      :disabled="documentLocked"
                      :placeholder="tl('เลือกเขตการขนส่ง', 'Select logistic area', 'ເລືອກເຂດຂົນສົ່ງ')"
                      filter
                      show-clear
                      @show="loadLogisticAreaOptions()"
                      @filter="onLogisticAreaFilter"
                    />
                  </label>
                </div>
                <div class="col-12 md:col-4">
                  <label class="field">
                    <span>{{ tl("ปลายทาง", "Destination", "ປາຍທາງ") }}</span>
                    <InputText v-model.trim="shipment.destination" :disabled="documentLocked" />
                  </label>
                </div>
                <div class="col-12 md:col-4">
                  <label class="field">
                    <span>Latitude</span>
                    <InputNumber v-model="shipment.latitude" input-class="text-right" :min-fraction-digits="0" :max-fraction-digits="8" :disabled="documentLocked" />
                  </label>
                </div>
                <div class="col-12 md:col-4">
                  <label class="field">
                    <span>Longitude</span>
                    <InputNumber v-model="shipment.longitude" input-class="text-right" :min-fraction-digits="0" :max-fraction-digits="8" :disabled="documentLocked" />
                  </label>
                </div>
                <div class="col-12">
                  <label class="field">
                    <span>{{ tl("หมายเหตุ", "Remark", "ໝາຍເຫດ") }}</span>
                    <Textarea v-model.trim="shipment.remark" rows="2" auto-resize :disabled="documentLocked" />
                  </label>
                </div>
                <div class="col-12">
                  <label class="field">
                    <span>{{ tl("หมายเหตุ 2", "Remark 2", "ໝາຍເຫດ 2") }}</span>
                    <Textarea v-model.trim="shipment.remark_2" rows="2" auto-resize :disabled="documentLocked" />
                  </label>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section v-show="workspaceTab === 'additional'" class="biz-panel additional-more-panel" style="padding: 0.7rem">
          <div class="panel-title">
            <i class="pi pi-plus-circle" />
            <strong>{{ t("sell.more") }}</strong>
          </div>
          <div class="additional-more-grid">
            <!-- สาขา: แสดงเมื่อมีมากกว่า 1 สาขา -->
            <label v-if="branchList.length > 1" class="field">
              <span>{{ t("sell.branch") }}</span>
              <Select
                v-model="branchCode"
                :options="
                  branchList.map((r) => ({
                    label: `${r.code} ${r.name_1}`.trim(),
                    value: r.code,
                  }))
                "
                option-label="label"
                option-value="value"
                filter
                show-clear
                :disabled="documentLocked"
                :placeholder="tl('-- เลือกสาขา --', '-- Select branch --', '-- ເລືອກສາຂາ --')"
              />
            </label>
            <!-- กลุ่มเอกสาร -->
            <label v-if="posStore.erpOption?.use_doc_group == 1" class="field">
              <span>{{ t("sell.docGroup") }}</span>
              <Select
                v-model="docGroup"
                :options="
                  docGroupList.map((r) => ({
                    label: `${r.code} ${r.name_1}`.trim(),
                    value: r.code,
                  }))
                "
                option-label="label"
                option-value="value"
                filter
                show-clear
                :disabled="documentLocked"
                :placeholder="tl('-- เลือกกลุ่มเอกสาร --', '-- Select document group --', '-- ເລືອກກຸ່ມເອກະສານ --')"
              />
            </label>
            <!-- แผนก -->
            <label v-if="posStore.erpOption?.use_department == 1" class="field">
              <span>{{ t("sell.department") }}</span>
              <Select
                v-model="departmentCode"
                :options="
                  departmentList.map((r) => ({
                    label: `${r.code} ${r.name_1}`.trim(),
                    value: r.code,
                  }))
                "
                option-label="label"
                option-value="value"
                filter
                show-clear
                :disabled="documentLocked"
                :placeholder="tl('-- เลือกแผนก --', '-- Select department --', '-- ເລືອກແຜນກ --')"
              />
            </label>
            <!-- ฝ่าย (side) -->
            <label v-if="posStore.erpOption?.use_unit == 1" class="field">
              <span>{{ t("sell.side") }}</span>
              <Select
                v-model="sideCode"
                :options="
                  sideList.map((r) => ({
                    label: `${r.code} ${r.name_1}`.trim(),
                    value: r.code,
                  }))
                "
                option-label="label"
                option-value="value"
                filter
                show-clear
                :disabled="documentLocked"
                :placeholder="tl('-- เลือกฝ่าย --', '-- Select side --', '-- ເລືອກຝ່າຍ --')"
              />
            </label>
            <!-- การจัดสรร -->
            <label v-if="posStore.erpOption?.use_allocate == 1" class="field">
              <span>{{ t("sell.allocate") }}</span>
              <Select
                v-model="allocateCode"
                :options="
                  allocateList.map((r) => ({
                    label: `${r.code} ${r.name_1}`.trim(),
                    value: r.code,
                  }))
                "
                option-label="label"
                option-value="value"
                filter
                show-clear
                :disabled="documentLocked"
                :placeholder="tl('-- เลือกการจัดสรร --', '-- Select allocation --', '-- ເລືອກການຈັດສັນ --')"
              />
            </label>
            <!-- โครงการ -->
            <label v-if="posStore.erpOption?.use_project == 1" class="field">
              <span>{{ t("sell.project") }}</span>
              <Select
                v-model="projectCode"
                :options="
                  projectList.map((r) => ({
                    label: `${r.code} ${r.name_1}`.trim(),
                    value: r.code,
                  }))
                "
                option-label="label"
                option-value="value"
                filter
                show-clear
                :disabled="documentLocked"
                :placeholder="tl('-- เลือกโครงการ --', '-- Select project --', '-- ເລືອກໂຄງການ --')"
              />
            </label>
            <!-- งาน -->
            <label v-if="posStore.erpOption?.use_job == 1" class="field">
              <span>{{ t("sell.job") }}</span>
              <Select
                v-model="jobCode"
                :options="
                  jobList.map((r) => ({
                    label: `${r.code} ${r.name_1}`.trim(),
                    value: r.code,
                  }))
                "
                option-label="label"
                option-value="value"
                filter
                show-clear
                :disabled="documentLocked"
                :placeholder="tl('-- เลือกงาน --', '-- Select job --', '-- ເລືອກງານ --')"
              />
            </label>
            <!-- Cashier (readonly) -->
            <label class="field">
              <span>Cashier</span>
              <InputText :value="cashierCode" disabled />
            </label>
            <!-- ผู้อนุมัติ (readonly display, editable code) -->
            <label class="field">
              <span>{{ t("sell.approver") }}</span>
              <InputText v-model.trim="userApprove" :disabled="documentLocked" :placeholder="tl('รหัสผู้อนุมัติ', 'Approver code', 'ລະຫັດຜູ້ອະນຸມັດ')" />
            </label>
          </div>
          <!-- หมายเหตุ 2-5 -->
          <div class="additional-remarks-grid">
            <label class="field">
              <span>{{ t("sell.remark") }} 2</span>
              <Textarea v-model="remark2" :disabled="documentLocked" rows="2" auto-resize />
            </label>
            <label class="field">
              <span>{{ t("sell.remark") }} 3</span>
              <Textarea v-model="remark3" :disabled="documentLocked" rows="2" auto-resize />
            </label>
            <label class="field">
              <span>{{ t("sell.remark") }} 4</span>
              <Textarea v-model="remark4" :disabled="documentLocked" rows="2" auto-resize />
            </label>
            <label class="field">
              <span>{{ t("sell.remark") }} 5</span>
              <Textarea v-model="remark5" :disabled="documentLocked" rows="2" auto-resize />
            </label>
          </div>
        </section>

        <div v-show="workspaceTab === 'details'" class="details-split-layout">
          <section class="biz-panel product-panel">
            <div class="grid formgrid" data-font-zone="doc-header">
              <div class="col-12 md:col-6 lg:col-3">
                <label class="field doc-format-field">
                  <span>{{ t("sell.docCode") }}</span>
                  <Select v-model="docFormatCode" :options="docFormatOptions" option-label="label" option-value="code" :placeholder="t('sell.documents')" :disabled="documentLocked" filter />
                </label>
              </div>
              <div class="col-12 md:col-6 lg:col-3">
                <label class="field">
                  <span>{{ t("sell.customer") }}</span>
                  <div class="entity-picker">
                    <InputText :model-value="customerDisplay" readonly :disabled="documentLocked" @click="openCustomerDialog" />
                    <Button icon="pi pi-search" outlined :disabled="documentLocked" :aria-label="t('sell.customerSearch')" @click="openCustomerDialog" />
                    <Button icon="pi pi-times" text severity="secondary" :disabled="documentLocked" :aria-label="t('sell.walkIn')" @click="selectWalkIn" />
                  </div>
                </label>
              </div>
              <div class="col-12 md:col-6 lg:col-3">
                <label class="field">
                  <span>{{ t("sell.salesperson") }}</span>
                  <div class="entity-picker">
                    <InputText :model-value="employeeDisplay || t('sell.defaultEmployee')" readonly :disabled="documentLocked" @click="openEmployeeDialog" />
                    <Button icon="pi pi-search" outlined :disabled="documentLocked" :aria-label="t('sell.employeeSearch')" @click="openEmployeeDialog" />
                    <Button icon="pi pi-times" text severity="secondary" :disabled="documentLocked" :aria-label="t('sell.defaultEmployee')" @click="resetEmployeeToDefault" />
                  </div>
                </label>
              </div>
              <div class="md:col-12 lg:col-3" style="padding-top: unset">
                <div v-if="!editMode || pulledRefDocs.length > 0" class="ref-doc-slot">
                  <label style="color: var(--sale-primary)">{{ tl("เอกสารอ้างอิง", "Reference doc", "ເອກະສານອ້າງອີງ") }}</label>
                  <Button
                    v-if="!editMode"
                    :label="pulledRefDocs.length ? tl('ดึงเพิ่ม', 'Add more', 'ດຶງເພີ່ມ') : tl('ดึงเอกสารอ้างอิง', 'Pull reference doc', 'ດຶງເອກະສານອ້າງອີງ')"
                    :icon="pulledRefDocs.length ? 'pi pi-plus' : 'pi pi-file-import'"
                    size="small"
                    outlined
                    class="ref-doc-action-button"
                    :disabled="documentLocked || isWalkInCustomer"
                    @click="openRefDocDialog"
                  />
                </div>
              </div>
            </div>
            <div v-if="pulledRefDocs.length > 0" class="ref-doc-table-wrap">
              <table class="ref-doc-table" :class="{ 'is-readonly': editMode }">
                <thead>
                  <tr>
                    <th>{{ tl("ประเภท", "Type", "ປະເພດ") }}</th>
                    <th>{{ tl("เลขที่", "Doc No", "ເລກທີ່") }}</th>
                    <th>{{ tl("วันที่", "Date", "ວັນທີ່") }}</th>
                    <th v-if="!editMode" aria-hidden="true"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in pulledRefDocs" :key="r.doc_no">
                    <td>
                      <span class="ref-type-pill" :data-type="r.bill_type">{{ billTypeLabel(r.bill_type) }}</span>
                    </td>
                    <td class="ref-doc-no">{{ r.doc_no }}</td>
                    <td class="ref-doc-date">{{ r.doc_date }}</td>
                    <td v-if="!editMode">
                      <Button
                        icon="pi pi-times"
                        size="small"
                        text
                        severity="secondary"
                        :disabled="documentLocked"
                        :aria-label="tl('ลบรายการ', 'Remove', 'ລົບລາຍການ')"
                        @click="removePulledRefDoc(r.doc_no)"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <Message v-if="isCreditSale" class="credit-check-message" :severity="customerCreditExceeded || customerCreditClosed ? 'warn' : 'info'" :closable="false">
              <span v-if="customerCreditLoading">{{ tl("กำลังตรวจสอบเครดิตลูกค้า...", "Checking customer credit...", "ກຳລັງກວດສອບເຄຣດິດລູກຄ້າ...") }}</span>
              <span v-else-if="customerCreditError">{{ customerCreditError }}</span>
              <span v-else>
                {{ tl("เครดิตลูกค้า", "Customer credit", "ເຄຣດິດລູກຄ້າ") }}
                {{ formatCurrency(customerCreditBalance) }} /
                {{ tl("วงเงิน", "Limit", "ວົງເງິນ") }}
                {{ customerCreditLimit ? formatCurrency(customerCreditLimit) : "-" }}
                <template v-if="customerCreditExceeded">
                  ·
                  {{ tl("ยอดหลังขายจะเกินวงเงิน", "Amount after sale will exceed limit", "ຍອດຫຼັງຂາຍຈະເກີນວົງເງິນ") }}
                  {{ formatCurrency(customerCreditAfterSale) }}</template
                >
                <template v-if="customerCreditClosed">
                  ·
                  {{ tl("ลูกค้าถูกปิดสถานะเครดิต", "Customer credit is closed", "ລູກຄ້າຖືກປິດສະຖານະເຄຣດິດ") }}</template
                >
              </span>
            </Message>
            <div class="product-tools" data-font-zone="toolbar">
              <div class="tool-input">
                <InputText
                  ref="barcodeRef"
                  v-model.trim="barcodeInput"
                  data-testid="sale-barcode-input"
                  :placeholder="t('sell.barcodePlaceholder')"
                  :disabled="documentLocked"
                  @keydown.enter.prevent="addBarcode"
                />
                <Button
                  icon="pi pi-barcode"
                  :loading="barcodeAdding"
                  :badge="barcodeQueueCount ? String(barcodeQueueCount) : undefined"
                  outlined
                  :disabled="documentLocked"
                  :aria-label="tl('เพิ่มด้วยบาร์โค้ด', 'Add by barcode', 'ເພີ່ມດ້ວຍບາໂຄດ')"
                  @click="addBarcode"
                />
              </div>
              <div class="product-action-buttons">
                <Button icon="pi pi-search" :label="t('product.searchButton')" :loading="productLoading" :disabled="documentLocked" @click="openProductSearchDialog" />
                <!-- <Button icon="pi pi-shopping-cart" :label="t('sell.cart')" severity="success" :disabled="documentLocked" @click="productBasketVisible = true" /> -->
              </div>
            </div>

            <div class="lines-table-wrap" data-font-zone="product-table">
              <table class="lines-table">
                <colgroup>
                  <col class="line-col-index" />
                  <col class="line-col-image" />
                  <col class="line-col-item" />
                  <col class="line-col-code" />
                  <col class="line-col-unit" />
                  <col class="line-col-location" />
                  <col class="line-col-qty" />
                  <col class="line-col-price" />
                  <col class="line-col-discount" />
                  <col class="line-col-total" />
                  <col class="line-col-action" />
                </colgroup>
                <thead data-font-zone="product-table-head">
                  <tr>
                    <th class="num">#</th>
                    <th style="text-align: center">{{ tl("รูป", "Image", "ຮູບ") }}</th>
                    <th>{{ t("product.name") }}</th>
                    <th>{{ t("product.code") }}</th>
                    <th style="text-align: center">{{ t("product.unit") }}</th>
                    <th style="text-align: center">
                      {{ tl("คลัง", "Warehouse", "ຄັງ") }}
                    </th>
                    <th class="" style="text-align: center">
                      {{ tl("จำนวน", "Qty", "ຈຳນວນ") }}
                    </th>
                    <th class="num">{{ t("sell.price") }}</th>
                    <th class="" style="text-align: center">
                      {{ tl("ส่วนลด", "Discount", "ສ່ວນຫຼຸດ") }}
                    </th>
                    <th class="num">{{ tl("รวม", "Total", "ລວມ") }}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody v-for="(line, index) in displayRows" :key="line.id" data-font-zone="product-table-body">
                  <tr
                    :class="{
                      'row-warning': line.price_error,
                      'row-set-parent': isSetItem(line),
                      'is-active': line.id === activeLineId,
                    }"
                    @focusin="activeLineId = line.id"
                    @click="activeLineId = line.id"
                  >
                    <td class="line-index num">{{ index + 1 }}</td>
                    <td class="line-image-cell">
                      <button
                        type="button"
                        class="line-image-button"
                        :class="{
                          'is-empty': !lineImageSrc(line) || lineImageError(line.id),
                        }"
                        :disabled="!lineImageSrc(line)"
                        @click="openLineImagePreview(line)"
                      >
                        <img
                          v-if="lineImageSrc(line) && !lineImageError(line.id)"
                          :src="lineImageSrc(line)"
                          :alt="line.item_name || line.item_code"
                          loading="lazy"
                          @load="onLineImageLoad(line.id)"
                          @error="onLineImageError(line.id)"
                        />
                        <i v-else class="pi pi-image" />
                      </button>
                    </td>
                    <td class="item-name">
                      <div class="line-name-row">
                        <strong
                          style="margin-right: 5px"
                          :class="['line-name-edit', { 'is-locked': documentLocked || !canEditLineItemName(line) }]"
                          role="button"
                          tabindex="0"
                          v-tooltip.top="tl('แก้ไขชื่อ/รายละเอียด (F3)', 'Edit name/detail (F3)', 'ແກ້ໄຂຊື່/ລາຍລະອຽດ (F3)')"
                          @click="openNameEditor(line)"
                          @keyup.enter="openNameEditor(line)"
                          >{{ line.item_name }}</strong
                        >
                        <span v-if="isSetItem(line)" class="line-set-badge"><i class="pi pi-box"></i> {{ tl("ชุด", "Set", "ຊຸດ") }}</span>
                        <Button
                          v-if="lineHasPromotionGuide(line)"
                          icon="pi pi-tag"
                          class="line-pro-button"
                          size="small"
                          severity="danger"
                          :disabled="promotionGuideLoading"
                          v-tooltip.top="tl('โปรแนะนำ', 'Promotion hints', 'ໂປຣໂມຊັນແນະນຳ')"
                          @click="openPromotionGuideDialog(line)"
                        />
                      </div>
                      <small v-if="line.remark" class="line-remark-preview">{{ line.remark }}</small>
                      <!-- <small v-if="line.price_loading">{{ t("sell.priceLoading") }}...</small> -->
                      <small v-else-if="line.price_error" class="line-error">{{ line.price_error }}</small>
                    </td>
                    <td>
                      <div class="line-code-stack">
                        <span class="line-barcode">{{ line.barcode || "-" }}</span>
                        <span class="line-item-code">{{ line.item_code }}</span>
                      </div>
                    </td>
                    <td class="unit-cell">
                      <button type="button" class="line-unit-button" :disabled="documentLocked || line.price_loading" @click="openUnitEditor(line)">
                        <span>{{ line.unit_code || "-" }}</span>
                      </button>
                    </td>
                    <td class="unit-cell warehouse-cell">
                      <button type="button" class="line-unit-button" :disabled="documentLocked" @click="openWhPicker(line)">
                        <span>{{ line.wh_code || "-" }}</span>
                      </button>
                    </td>
                    <td class="qty-cell" style="text-align: center">
                      <div class="line-qty-stepper">
                        <Button
                          icon="pi pi-minus"
                          text
                          rounded
                          severity="secondary"
                          :disabled="documentLocked || toNumber(line.qty) <= 0"
                          :aria-label="tl('ลดจำนวน', 'Decrease quantity', 'ຫຼຸດຈຳນວນ')"
                          @click="adjustLineQty(line, -1)"
                        />
                        <InputText
                          :model-value="line.qty"
                          class="line-qty-input text-right"
                          inputmode="decimal"
                          :disabled="documentLocked"
                          @blur="(event) => setLineQty(line, event)"
                          @keyup.enter.prevent="(event) => setLineQty(line, event)"
                        />
                        <Button
                          icon="pi pi-plus"
                          text
                          rounded
                          severity="secondary"
                          :disabled="documentLocked"
                          :aria-label="tl('เพิ่มจำนวน', 'Increase quantity', 'ເພີ່ມຈຳນວນ')"
                          @click="adjustLineQty(line, 1)"
                        />
                      </div>
                    </td>
                    <td class="price-cell">
                      <button type="button" class="line-price-button" :disabled="documentLocked || line.price_loading" @click="openPriceEditor(line)">
                        <span :class="{ 'manual-price-text': line.price_manual }">{{ formatCurrency(line.price) }}</span>
                        <i class="pi pi-pencil" />
                      </button>
                    </td>
                    <td v-if="false" style="text-align: center">
                      <InputText v-model.trim="line.discount" class="cell-input line-discount-input text-right" :placeholder="tl('0 หรือ %', '0 or %', '0 ຫຼື %')" :disabled="documentLocked" />
                    </td>
                    <td class="discount-cell" style="text-align: center">
                      <span v-if="line.discount" class="line-price-button">{{ line.discount }}</span>
                      <Button
                        icon="pi pi-pen-to-square"
                        text
                        rounded
                        :severity="'secondary'"
                        :aria-label="line.discount ? `${tl('ส่วนลด', 'Discount', 'ສ່ວນຫຼຸດ')} ${line.discount}` : tl('เพิ่มส่วนลด', 'Add discount', 'ເພີ່ມສ່ວນຫຼຸດ')"
                        :disabled="documentLocked"
                        @click="openDiscountEditor(line)"
                      />
                    </td>
                    <td class="num strong">{{ formatCurrency(lineSumAmount(line)) }}</td>
                    <td class="action-cell">
                      <Button
                        :icon="line.remark ? 'pi pi-comment' : 'pi pi-comment'"
                        text
                        rounded
                        :severity="line.remark ? 'info' : 'secondary'"
                        :aria-label="line.remark ? line.remark : tl('เพิ่มหมายเหตุ', 'Add remark', 'ເພີ່ມໝາຍເຫດ')"
                        :disabled="documentLocked"
                        @click="openRemarkEditor(line)"
                      />
                      <Button icon="pi pi-trash" text rounded severity="danger" :aria-label="tl('ลบรายการ', 'Delete line', 'ລຶບລາຍການ')" :disabled="documentLocked" @click="removeLine(line)" />
                    </td>
                  </tr>
                  <tr v-if="isSetItem(line) && Array.isArray(line.sub_item) && line.sub_item.length" class="row-set-children">
                    <td></td>
                    <td></td>
                    <td colspan="10">
                      <div class="set-children-wrap">
                        <div class="set-children-title">
                          <i class="pi pi-list"></i>
                          <span>{{ tl("รายการในชุด", "Set items", "ລາຍການໃນຊຸດ") }} ({{ line.sub_item.length }})</span>
                        </div>
                        <div class="set-children-grid">
                          <div v-for="child in line.sub_item" :key="`${line.id}-${child.item_code}`" class="set-child-row">
                            <span class="set-child-code">{{ child.item_code }}</span>
                            <span class="set-child-name">{{ child.item_name }}</span>
                            <span class="set-child-qty">{{ formatQty(toNumber(child.qty)) }} {{ child.unit_code }} × {{ formatQty(toNumber(line.qty)) }}</span>
                            <span class="set-child-total"
                              >=
                              {{ formatQty(toNumber(child.qty) * toNumber(line.qty)) }}
                              {{ child.unit_code }}</span
                            >
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                </tbody>
                <tbody v-if="!rows.length" data-font-zone="product-table-body">
                  <tr>
                    <td colspan="11" class="empty-lines">
                      {{ t("product.emptyLines") }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="doc-footer-block doc-footer-remark-block product-remark-block" data-font-zone="doc-footer">
              <div class="grid formgrid">
                <div class="col-12 md:col-6">
                  <div class="panel-title compact">
                    <i class="pi pi-comment" />
                    <strong>{{ t("sell.remark") }}</strong>
                  </div>
                  <label class="field">
                    <Textarea v-model="remark" rows="2" cols="10" auto-resize :disabled="documentLocked" />
                  </label>
                </div>

                <div class="col-12 md:col-6">
                  <div class="panel-title compact">
                    <i class="pi pi-truck" />
                    <strong>{{ t("sell.shipment") }}</strong>
                  </div>
                  <div class="grid formgrid doc-footer-inline-grid">
                    <div class="col-12">
                      <label class="field">
                        <SelectButton
                          class="transport-type-select"
                          :model-value="transportType?.code || ''"
                          :options="shipmentTransportTypeOptions"
                          option-label="label"
                          option-value="code"
                          fluid
                          :allow-empty="false"
                          :disabled="documentLocked || !shipmentTransportTypeOptions.length"
                          @update:model-value="updateShipmentTransportType"
                        />
                      </label>
                    </div>
                    <!-- <div v-if="showShipmentDates" class="col-12 md:col-12">
                    <label class="field">
                      <span>{{ t("sell.sendDate") }}</span>
                      <IsoDatePicker v-model="sendDate" :disabled="documentLocked" />
                    </label>
                  </div> -->
                  </div>
                </div>
              </div>
            </div>
          </section>
          <aside id="sell-doc-footer-slot" class="details-summary-slot" :aria-label="tl('ข้อมูลสรุปและการจัดส่ง', 'Summary and shipment', 'ຂໍ້ມູນສະຫຼຸບແລະການຈັດສົ່ງ')"></aside>
        </div>
      </main>
    </div>

    <Dialog
      :visible="paymentDialogVisible"
      modal
      :closable="!saving && !laoQrCloseLocked"
      :close-on-escape="false"
      :pt="{ header: { style: 'display:none' } }"
      :draggable="false"
      maximizable
      class="payment-checkout-dialog"
      :style="{
        width: '100vw',
        height: '100dvh',
        maxHeight: '100dvh',
        ...saleLayoutStyle,
      }"
      @update:visible="onPaymentDialogVisibleChange"
    >
      <!-- <template #header>
        <div class="payment-dialog-header">
          <div class="payment-dialog-title">
            <small>{{ t("sell.amountToPay") }}</small>
            <strong
              ><span style="color: #e87e2c">{{ formatCurrency(totalDue) }}</span> <em>{{ t("sell.baht") }}</em></strong
            >
          </div>
          <div class="payment-dialog-header-metrics">
            <span class="paid"
              ><small>{{ t("sell.paid") }}</small
              ><strong>{{ formatCurrency(totalPaid) }}</strong></span
            >
            <span class="due"
              ><small>{{ paymentChange > 0 ? t("sell.change") : t("sell.remaining") }}</small
              ><strong>{{ formatCurrency(paymentChange > 0 ? paymentChange : remainingPayment) }}</strong></span
            >
          </div>
        </div>
      </template> -->

      <div v-if="successDocNo" class="payment-success-step">
        <i class="pi pi-check-circle" />
        <span>{{ t("sell.savedSuccess") }}</span>
        <strong>{{ successDocNo }}</strong>
        <div class="payment-success-grid">
          <div>
            <span>{{ t("sell.netTotal") }}</span>
            <b>{{ formatCurrency(totalDue) }}</b>
            <small v-if="showPaymentSuccessDisplayCurrency">{{ formatCustomerDisplayPaymentAmount("netAmount") }}</small>
          </div>
          <div>
            <span>{{ t("sell.receiveAmount") }}</span>
            <b>{{ formatCurrency(totalPaid) }}</b>
            <small v-if="showPaymentSuccessDisplayCurrency">{{ formatCustomerDisplayPaymentAmount("paid") }}</small>
          </div>
          <div>
            <span>{{ t("sell.change") }}</span>
            <b>{{ formatCurrency(paymentChange) }}</b>
            <small v-if="showPaymentSuccessDisplayCurrency">{{ formatCustomerDisplayPaymentAmount("change") }}</small>
          </div>
        </div>
        <div class="payment-success-actions">
          <Button :label="t('sell.receiptPrint')" icon="pi pi-print" severity="secondary" outlined @click="openPrintDialog" />
          <Button :label="t('sell.newSale')" icon="pi pi-plus" severity="success" @click="newDocument" />
        </div>
      </div>

      <div v-else class="payment-dialog-layout" data-font-zone="payment-dialog">
        <section class="payment-dialog-methods" data-font-zone="payment-methods">
          <div class="payment-section-title">
            {{ tl("เลือกวิธีรับชำระ ", "Choose payment method ", "ເລືອກວິທີຮັບຊຳລະ ") }}
          </div>
          <button
            v-for="tab in visiblePaymentTypeOptions"
            :key="tab.value"
            type="button"
            :class="{
              active: tab.value === 'cash' ? activePayType === 'cash' || isCashCurrencyPayType(activePayType) : activePayType === tab.value,
            }"
            :disabled="documentLocked"
            @click="activePayType = tab.value"
          >
            <span class="method-icon"><i :class="tab.icon" /></span>
            <span class="method-copy">
              <strong>{{ paymentMethodTitle(tab) }}</strong>
              <small>{{ paymentMethodSubtitle(tab) }}</small>
            </span>
            <span class="method-amount">{{ formatCurrency(paymentMethodAmount(tab)) }}</span>
            <i v-if="activePayType === tab.value" class="pi pi-check-circle method-check" />
          </button>
        </section>

        <section class="payment-dialog-form" data-font-zone="payment-form">
          <div v-if="activePayType === 'cash' || isCashCurrencyPayType(activePayType)" class="pay-form pay-form-cash">
            <div v-if="cashCurrencyTabs.length > 1" class="cash-currency-tabs cash-currency-tabs-inline">
              <button
                v-for="tab in cashCurrencyTabs"
                :key="tab.code"
                type="button"
                :class="{
                  active: normalizeCashCurrencyCode(cashCurrencyCode) === tab.code,
                }"
                :disabled="documentLocked"
                @click="changeCashCurrency(tab.code)"
              >
                <strong>{{ tab.name }}</strong>
                <span>{{ tab.label }}</span>
              </button>
            </div>
            <h1 class="cash-pay-title" style="margin-top: 0px; margin-bottom: 10px; border-bottom: 1px solid #e5e7eb; padding-bottom: 10px">
              {{ t("sell.payAmount") }}
              <span :style="cashCurrencyIconInfo(selectedCashCurrency.code)"
                >{{ selectedCashCurrency?.name }} <span v-if="selectedCashCurrency?.name_2 != '1'" class="cash-currency-name2">({{ selectedCashCurrency?.name_2 }})</span></span
              >
            </h1>
            <div :class="['cash-currency-grid', { 'cash-currency-grid--3col': isKipActiveCurrency }]">
              <label class="field">
                <span>{{ isHomeCashCurrency ? t("sell.amountDue") : `${t("sell.amountDue")} (${selectedCashCurrency?.code})` }}</span>
                <InputNumber :model-value="activeCashDueAmount" input-class="text-right" :min-fraction-digits="2" :max-fraction-digits="2" disabled />
              </label>
              <label v-if="isKipActiveCurrency && kipSuggestedAmount" class="field kip-suggested-field">
                <span>{{ tl("ยอดชำระแนะนำ", "Suggested amount", "ຍອດຊຳລະແນະນຳ") }} ({{ selectedCashCurrency?.code }})</span>
                <InputNumber :model-value="kipSuggestedAmount.kipRounded" input-class="text-right" :min-fraction-digits="0" :max-fraction-digits="0" disabled />
              </label>
              <label class="field">
                <span>{{ isHomeCashCurrency ? t("sell.receiveAmount") : `${t("sell.receiveAmount")} ${selectedCashCurrency?.code}` }}</span>
                <InputText
                  ref="cashTenderInputRef"
                  :model-value="cashTenderText"
                  class="cash-tender-input text-right"
                  inputmode="decimal"
                  autocomplete="off"
                  :disabled="documentLocked || !activeCashExchangeRateValid"
                  @focus="$event.target.select()"
                  @input="applyCashTenderText($event.target.value)"
                  @keydown.enter.prevent="commitCashTenderText($event)"
                  @blur="commitCashTenderText($event)"
                />
              </label>
            </div>
            <div class="cash-converted-preview">
              <span>{{
                isHomeCashCurrency ? t("payment.cashComputed") : `${t("sell.bahtAmount")} (${formatQty(cashCurrencyAmount)} ${selectedCashCurrency?.code} x ${formatExchangeRate(cashExchangeRate)})`
              }}</span>
              <strong>{{ formatCurrency(isHomeCashCurrency ? cashPaymentDue : cashConvertedAmount) }}</strong>
            </div>
            <div v-if="!isHomeCashCurrency" :class="['cash-currency-grid', { 'cash-currency-grid--3col': isKipActiveCurrency }]">
              <label class="field">
                <span>{{ t("sell.exchangeRate") }}</span>
                <InputText
                  v-model="cashExchangeRateText"
                  class="text-right"
                  autocomplete="off"
                  :disabled="cashExchangeRateDisabled"
                  :readonly="!isExchangeRateEditAuthorized(cashExchangeRateEditKey)"
                  @focus="guardExchangeRateEdit(cashExchangeRateEditKey, cashExchangeRateDisabled, $event)"
                  @click="guardExchangeRateEdit(cashExchangeRateEditKey, cashExchangeRateDisabled, $event)"
                  @keydown.enter.prevent="commitProtectedExchangeRate(cashExchangeRateEditKey, cashExchangeRateDisabled, commitCashExchangeRate, $event)"
                  @blur="commitProtectedExchangeRate(cashExchangeRateEditKey, cashExchangeRateDisabled, commitCashExchangeRate, $event)"
                />
              </label>
              <label class="field">
                <span>{{ t("sell.bahtAmount") }}</span>
                <InputNumber :model-value="cashConvertedAmount" input-class="text-right" :min-fraction-digits="2" :max-fraction-digits="2" disabled />
              </label>
            </div>

            <Message v-if="!activeCashExchangeRateValid" severity="warn" :closable="false">
              {{
                tl(
                  "สกุลเงินนี้ยังไม่มีอัตราแลกเปลี่ยน จึงยังรับเงินสดไม่ได้",
                  "This currency has no exchange rate yet, so cash cannot be accepted.",
                  "ສະກຸນເງິນນີ້ຍັງບໍ່ມີອັດຕາແລກປ່ຽນ ຈຶ່ງຍັງຮັບເງິນສົດບໍ່ໄດ້",
                )
              }}
            </Message>
            <div class="cash-pos-panel">
              <div class="cash-quick-grid" :aria-label="tl('ปุ่มเงินสดด่วน', 'Quick cash buttons', 'ປຸ່ມເງິນສົດດ່ວນ')">
                <Button :label="t('sell.exact')" severity="success" :disabled="documentLocked || activeCashDueHomeAmount <= 0 || !activeCashExchangeRateValid" @click="addCash" />
                <Button
                  v-for="amount in activeCashQuickAmounts"
                  :key="amount"
                  :label="formatQty(amount)"
                  outlined
                  :disabled="documentLocked || !activeCashExchangeRateValid"
                  @click="addCashQuickAmount(amount)"
                />
                <Button :label="t('sell.clear')" severity="danger" :disabled="documentLocked" @click="clearCashTender" />
              </div>
              <div class="cash-keypad" :aria-label="tl('แป้นกดจำนวนเงินสด', 'Cash amount keypad', 'ແປ້ນກົດຈຳນວນເງິນສົດ')">
                <button v-for="key in cashKeypadKeys" :key="key" type="button" :disabled="documentLocked || !activeCashExchangeRateValid" @click="appendCashKeypad(key)">
                  <i v-if="key === 'backspace'" class="pi pi-delete-left" />
                  <span v-else>{{ key }}</span>
                </button>
              </div>
            </div>
          </div>

          <div v-else-if="activePayType === 'transfer' || activePayType === 'credit_transfer'" class="pay-form pay-form-transfer">
            <template v-if="activePayType === 'transfer'">
              <div class="transfer-static-qr-actions">
                <button
                  v-for="option in transferStaticQrOptions"
                  :key="option.code"
                  type="button"
                  :class="{ active: option.code === transferQrSelectedCode }"
                  :aria-label="`${tl('เปิด QR', 'Open QR', 'ເປີດ QR')} ${option.name}`"
                  @click="openTransferStaticQr(option)"
                >
                  <i class="pi pi-qrcode" />
                  <span>{{ option.name }}</span>
                </button>
              </div>
            </template>
            <label class="field transfer-account-book">
              <span>{{ t("sell.accountBook") }}</span>
              <Select v-model="transferPassBook" :options="passBooks" option-label="label" :placeholder="t('sell.accountBook')" :disabled="documentLocked" filter />
            </label>

            <div class="transfer-account-grid">
              <label class="field">
                <span>{{ tl("ชื่อบัญชี", "Account name", "ຊື່ບັນຊີ") }}</span>
                <InputText :model-value="transferAccountName || '-'" disabled />
              </label>
              <label class="field">
                <span>{{ tl("เลขบัญชี", "Account number", "ເລກບັນຊີ") }}</span>
                <InputText :model-value="transferAccountNumber || '-'" disabled />
              </label>
            </div>

            <div class="transfer-account-grid">
              <label class="field">
                <span>{{ t("sell.dateTransfer") }}</span>
                <IsoDatePicker v-model="transferDate" :disabled="documentLocked" />
              </label>
              <label class="field">
                <span>{{ t("sell.currency") }}</span>
                <Select v-model="transferCurrency" :options="currencyTypes" option-label="label" :placeholder="t('sell.currency')" disabled filter />
              </label>
            </div>

            <section class="transfer-input-panel">
              <div class="transfer-input-grid grid formgrid">
                <template v-if="activePayType === 'credit_transfer'">
                  <label class="field col-12 md:col-6">
                    <span
                      >{{ tl("หมายเลขบัตร", "Card number", "ເລກບັດ") }}
                      <i class="pi pi-info-circle transfer-info-icon" style="color: red !important" />
                    </span>
                    <InputText v-model.trim="creditTransferCardRemark" autocomplete="off" :disabled="documentLocked" />
                  </label>
                  <label class="field col-12 md:col-6">
                    <span
                      >{{ tl("เลขอนุมัติ", "Approval number", "ເລກອະນຸມັດ") }}
                      <i class="pi pi-info-circle transfer-info-icon" style="color: red !important" />
                    </span>
                    <InputText v-model.trim="creditTransferApprovalRemark" autocomplete="off" :disabled="documentLocked" />
                  </label>
                </template>

                <template v-if="activePayType === 'credit_transfer'">
                  <label class="field col-12 md:col-4">
                    <span>
                      {{ t("sell.exchangeRate") }}
                    </span>
                    <InputText
                      v-model="transferExchangeRateText"
                      class="text-right"
                      autocomplete="off"
                      :disabled="transferExchangeRateDisabled"
                      :readonly="!isExchangeRateEditAuthorized('transfer')"
                      @focus="guardExchangeRateEdit('transfer', transferExchangeRateDisabled, $event)"
                      @click="guardExchangeRateEdit('transfer', transferExchangeRateDisabled, $event)"
                      @keydown.enter.prevent="commitProtectedExchangeRate('transfer', transferExchangeRateDisabled, commitTransferExchangeRate, $event)"
                      @blur="commitProtectedExchangeRate('transfer', transferExchangeRateDisabled, commitTransferExchangeRate, $event)"
                    />
                  </label>
                  <label class="field col-12 md:col-4">
                    <span>
                      {{ tl("Charge (%)", "Charge (%)", "Charge (%)") }}
                      <i class="pi pi-info-circle transfer-info-icon" />
                    </span>
                    <InputNumber
                      v-model="transferChargePercent"
                      input-class="cash-tender-input text-right"
                      suffix=" %"
                      :min="0"
                      :min-fraction-digits="0"
                      :max-fraction-digits="2"
                      :disabled="documentLocked"
                    />
                  </label>

                  <label class="field col-12 md:col-4">
                    <span>
                      {{ tl("จำนวนรับชำระ", "Payment received", "ຈຳນວນຮັບຊຳລະ") }}
                      <template v-if="transferCurrencyCode">({{ transferCurrencyCode }})</template>
                      <i class="pi pi-info-circle transfer-info-icon" />
                    </span>
                    <InputNumber
                      v-model="transferInputDisplayAmount"
                      input-class="cash-tender-input text-right"
                      :min="0"
                      :min-fraction-digits="isKipTransferCurrency ? 0 : 2"
                      :max-fraction-digits="isKipTransferCurrency ? 0 : 2"
                      :disabled="documentLocked"
                    />
                  </label>
                </template>
                <template v-if="activePayType === 'transfer'">
                  <label class="field col-12 md:col-6">
                    <span>
                      {{ t("sell.exchangeRate") }}
                    </span>
                    <InputText
                      v-model="transferExchangeRateText"
                      class="text-right"
                      autocomplete="off"
                      :disabled="transferExchangeRateDisabled"
                      :readonly="!isExchangeRateEditAuthorized('transfer')"
                      @focus="guardExchangeRateEdit('transfer', transferExchangeRateDisabled, $event)"
                      @click="guardExchangeRateEdit('transfer', transferExchangeRateDisabled, $event)"
                      @keydown.enter.prevent="commitProtectedExchangeRate('transfer', transferExchangeRateDisabled, commitTransferExchangeRate, $event)"
                      @blur="commitProtectedExchangeRate('transfer', transferExchangeRateDisabled, commitTransferExchangeRate, $event)"
                    />
                  </label>
                  <label class="field col-12 md:col-6">
                    <span>
                      {{ tl("จำนวนรับชำระ", "Payment received", "ຈຳນວນຮັບຊຳລະ") }}
                      <template v-if="transferCurrencyCode">({{ transferCurrencyCode }})</template>
                      <i class="pi pi-info-circle transfer-info-icon" />
                    </span>
                    <InputNumber
                      v-model="transferInputDisplayAmount"
                      input-class="cash-tender-input text-right"
                      :min="0"
                      :min-fraction-digits="isKipTransferCurrency ? 0 : 2"
                      :max-fraction-digits="isKipTransferCurrency ? 0 : 2"
                      :disabled="documentLocked"
                    />
                  </label>
                </template>
              </div>
            </section>

            <section class="transfer-calc-panel">
              <h3>
                {{ tl("สรุปการคำนวณ", "Calculation summary", "ສະຫຼຸບການຄຳນວນ") }}
              </h3>
              <div class="transfer-calc-rows">
                <div v-if="isForeignTransferCurrency">
                  <span>
                    {{ tl("Charge สกุลเงิน", "Currency charge", "Charge ສະກຸນເງິນ") }}
                    ({{ transferCurrencyCode }})
                  </span>
                  <b>{{ isKipTransferCurrency ? formatQty(transferChargeInCurrency) : formatCurrency(transferChargeInCurrency) }}</b>
                </div>

                <div>
                  <span>
                    {{ tl("ยอดรับเงินโอน", "Transfer amount", "ຍອດໂອນ") }}
                    <template v-if="isForeignTransferCurrency">({{ transferCurrencyCode }})</template>
                  </span>
                  <b style="color: var(--sale-primary)">
                    {{
                      !isForeignTransferCurrency
                        ? formatCurrency(transferReceivedDisplayAmount)
                        : isKipTransferCurrency
                          ? formatQty(transferReceivedInCurrency)
                          : formatCurrency(transferReceivedInCurrency)
                    }}
                  </b>
                </div>
              </div>
            </section>
            <div v-if="isForeignTransferCurrency">
              <i class="pi pi-info-circle transfer-info-icon" />
              <span style="margin-left: 0.5rem">{{ tl("ยอด Charge (THB)", "Charge (THB)", "ຍອດ Charge (THB)") }}</span>
              <b style="margin-left: 0.5rem">{{ formatCurrency(transferChargeAmount) }}</b>
              <span style="margin-left: 0.5rem">{{ tl("ยอดรับเงินโอน (THB)", "Transfer amount (THB)", "ຍອດໂອນ (THB)") }}</span>
              <b style="margin-left: 0.5rem">{{ formatCurrency(transferReceivedThbAmount) }}</b>
            </div>
            <div class="transfer-add-row">
              <Button
                :label="activePayType === 'credit_transfer' ? t('sell.creditCard') : t('sell.addTransfer')"
                icon="pi pi-plus"
                size="large"
                :disabled="documentLocked || !transferPassBook || transferInputAmount <= 0 || transferRate <= 0 || (activePayType === 'credit_transfer' && !creditTransferRequiredReady)"
                @click="addTransfer(activePayType)"
              />
            </div>
          </div>

          <div v-else-if="activePayType === 'credit_transfer'" class="pay-form pay-form-transfer">
            <div class="transfer-static-qr-actions">
              <button
                v-for="option in transferStaticQrOptions"
                :key="option.code"
                type="button"
                class="transfer-qr-btn"
                :class="{ active: transferPassBook?.book_code === option.code }"
                :disabled="documentLocked"
                @click="selectTransferPassBook(option)"
              >
                {{ option.label }}
              </button>
            </div>
            <section class="transfer-form-section">
              <div class="transfer-form-grid">
                <label class="field">
                  <span>{{ t("sell.accountBook") }}</span>
                  <Select
                    v-model="transferPassBook"
                    :options="passBooks"
                    option-label="label"
                    :placeholder="t('sell.accountBook')"
                    :disabled="documentLocked"
                    filter
                    @change="onTransferPassBookChange"
                  />
                </label>
                <div v-if="transferPassBook" class="transfer-bank-info-grid">
                  <label class="field">
                    <span>{{ tl("ชื่อธนาคาร", "Bank name", "ຊື່ທະນາຄານ") }}</span>
                    <InputText :model-value="transferPassBook.bank_name || transferPassBook.bank_code || '-'" disabled />
                  </label>
                  <label class="field">
                    <span>{{ tl("สาขาธนาคาร", "Bank branch", "ສາຂາທະນາຄານ") }}</span>
                    <InputText :model-value="transferPassBook.branch_name || transferPassBook.bank_branch || '-'" disabled />
                  </label>
                  <label class="field">
                    <span>{{ t("sell.accountName") }}</span>
                    <InputText :model-value="passBookAccountName(transferPassBook)" disabled />
                  </label>
                  <label class="field">
                    <span>{{ t("sell.accountNo") }}</span>
                    <InputText :model-value="passBookAccountNumber(transferPassBook)" disabled />
                  </label>
                </div>
                <label class="field">
                  <span>{{ t("sell.transferDate") }}</span>
                  <DatePicker v-model="transferDateModel" date-format="dd/mm/yy" :disabled="documentLocked" />
                </label>
                <label class="field">
                  <span>{{ t("sell.currency") }}</span>
                  <Select v-model="transferCurrency" :options="currencyTypes" option-label="label" :placeholder="t('sell.currency')" :disabled="documentLocked" filter />
                </label>
                <label class="field">
                  <span
                    >{{ t("sell.amount") }}
                    <template v-if="isForeignTransferCurrency">({{ transferCurrencyCode }})</template>
                  </span>
                  <InputNumber
                    v-model="transferInputDisplayAmount"
                    input-class="cash-tender-input text-right"
                    :min="0"
                    :min-fraction-digits="isKipTransferCurrency ? 0 : 2"
                    :max-fraction-digits="isKipTransferCurrency ? 0 : 2"
                    :disabled="documentLocked"
                  />
                </label>
                <label class="field">
                  <span>{{ t("sell.exchangeRate") }}</span>
                  <InputText
                    v-model="transferExchangeRateText"
                    class="text-right"
                    autocomplete="off"
                    :disabled="transferExchangeRateDisabled"
                    :readonly="!isExchangeRateEditAuthorized('transfer')"
                    @focus="guardExchangeRateEdit('transfer', transferExchangeRateDisabled, $event)"
                    @click="guardExchangeRateEdit('transfer', transferExchangeRateDisabled, $event)"
                    @keydown.enter.prevent="commitProtectedExchangeRate('transfer', transferExchangeRateDisabled, commitTransferExchangeRate, $event)"
                    @blur="commitProtectedExchangeRate('transfer', transferExchangeRateDisabled, commitTransferExchangeRate, $event)"
                  />
                </label>
                <label class="field transfer-charge-field">
                  <span>
                    {{ tl("Charge (%)", "Charge (%)", "Charge (%)") }}
                    <i class="pi pi-info-circle transfer-info-icon" />
                  </span>
                  <InputNumber
                    v-model="transferChargePercent"
                    input-class="cash-tender-input text-right"
                    suffix=" %"
                    :min="0"
                    :min-fraction-digits="0"
                    :max-fraction-digits="2"
                    :disabled="documentLocked"
                  />
                </label>
              </div>
            </section>
            <section class="transfer-calc-panel">
              <h3>{{ tl("สรุปการคำนวณ", "Calculation summary", "ສະຫຼຸບການຄຳນວນ") }}</h3>
              <div class="transfer-calc-rows">
                <div v-if="isForeignTransferCurrency">
                  <span>
                    {{ tl("Charge สกุลเงิน", "Currency charge", "Charge ສະກຸນເງິນ") }}
                    ({{ transferCurrencyCode }})
                  </span>
                  <b>{{ isKipTransferCurrency ? formatQty(transferChargeInCurrency) : formatCurrency(transferChargeInCurrency) }}</b>
                </div>
                <div>
                  <span>
                    {{ tl("ยอดรับ", "Amount received", "ຍອດຮັບ") }}
                    <template v-if="isForeignTransferCurrency">({{ transferCurrencyCode }})</template>
                  </span>
                  <b style="color: var(--sale-primary)">
                    {{
                      !isForeignTransferCurrency
                        ? formatCurrency(transferReceivedDisplayAmount)
                        : isKipTransferCurrency
                          ? formatQty(transferReceivedInCurrency)
                          : formatCurrency(transferReceivedInCurrency)
                    }}
                  </b>
                </div>
              </div>
            </section>
            <div v-if="isForeignTransferCurrency">
              <i class="pi pi-info-circle transfer-info-icon" />
              <span style="margin-left: 0.5rem">{{ tl("ยอด Charge (THB)", "Charge (THB)", "ຍອດ Charge (THB)") }}</span>
              <b style="margin-left: 0.5rem">{{ formatCurrency(transferChargeAmount) }}</b>
              <span style="margin-left: 0.5rem">{{ tl("ยอดรับ (THB)", "Amount (THB)", "ຍອດ (THB)") }}</span>
              <b style="margin-left: 0.5rem">{{ formatCurrency(transferReceivedThbAmount) }}</b>
            </div>
            <div class="transfer-add-row">
              <Button
                :label="t('sell.creditCard')"
                icon="pi pi-plus"
                size="large"
                :disabled="documentLocked || !transferPassBook || transferInputAmount <= 0 || transferRate <= 0"
                @click="addCreditTransfer"
              />
            </div>
          </div>

          <div v-else-if="activePayType === 'credit'" class="pay-form pay-form-grid grid formgrid">
            <label class="field col-12 md:col-6">
              <span>{{ t("sell.cardType") }}</span>
              <Select v-model="creditType" :options="creditTypes" option-label="label" :placeholder="t('sell.cardType')" :disabled="documentLocked" filter />
            </label>
            <!-- <div class="payment-master-note col-12">
              <span>Charge {{ formatCurrency(creditChargePreview) }} {{ creditCurrencyCode || "THB" }}</span>
              <span
                >{{ tl("ยอดรวมบัตร", "Card total", "ຍອດລວມບັດ") }}
                {{ formatCurrency(creditTotalPreview) }}
                {{ creditCurrencyCode || "THB" }}</span
              >
              <span>{{ t("sell.bahtAmount") }} {{ formatCurrency(creditConvertedTotal) }}</span>
              <span v-if="creditType">{{ tl("อัตรา", "Rate", "ອັດຕາ") }} {{ creditType.charge_rate_word || creditType.charge_rate || "0" }}</span>
            </div> -->
            <div class="grid col-12">
              <label class="field col-12 md:col-4">
                <span>{{ t("sell.currency") }}</span>
                <Select v-model="creditCurrency" :options="currencyTypes" option-label="label" :placeholder="t('sell.currency')" :disabled="documentLocked" filter />
              </label>
              <label class="field col-12 md:col-4">
                <span>{{ t("sell.exchangeRate") }}</span>
                <InputText
                  v-model="creditExchangeRateText"
                  class="text-right"
                  autocomplete="off"
                  :disabled="creditExchangeRateDisabled"
                  :readonly="!isExchangeRateEditAuthorized('credit')"
                  @focus="guardExchangeRateEdit('credit', creditExchangeRateDisabled, $event)"
                  @click="guardExchangeRateEdit('credit', creditExchangeRateDisabled, $event)"
                  @keydown.enter.prevent="commitProtectedExchangeRate('credit', creditExchangeRateDisabled, commitCreditExchangeRate, $event)"
                  @blur="commitProtectedExchangeRate('credit', creditExchangeRateDisabled, commitCreditExchangeRate, $event)"
                />
              </label>
              <label class="field col-12 md:col-4">
                <span>Charge {{ t("sell.baht") }}</span>
                <InputNumber :model-value="creditConvertedCharge" input-class="text-right" :min-fraction-digits="2" :max-fraction-digits="2" disabled />
              </label>
            </div>
            <label class="field col-12 md:col-6">
              <span>{{ t("sell.cardRef") }}</span>
              <InputText v-model.trim="creditCardNumber" :disabled="documentLocked" />
            </label>
            <label class="field col-12 md:col-6">
              <span>{{ t("sell.approveNo") }}</span>
              <InputText v-model.trim="creditApprovalNo" :disabled="documentLocked" />
            </label>
            <label class="field col-12 md:col-12">
              <span>{{ t("sell.amount") }}</span>
              <InputNumber v-model="creditInputAmount" input-class="text-right" :min="0" :min-fraction-digits="2" :max-fraction-digits="2" :disabled="documentLocked" />
            </label>
            <Button
              class="col-12 md:col-6"
              :label="t('sell.addCard')"
              icon="pi pi-plus"
              style="min-height: 3rem"
              fluid
              size="large"
              :disabled="documentLocked || !creditCardNumber || creditInputAmount <= 0 || creditRate <= 0"
              @click="addCredit"
            />
          </div>

          <div v-else-if="activePayType === 'cheque'" class="pay-form pay-form-grid grid formgrid">
            <label class="field col-12 md:col-6">
              <span>{{ t("sell.accountBook") }}</span>
              <Select v-model="chequePassBook" :options="passBooks" option-label="label" :placeholder="t('sell.accountBook')" :disabled="documentLocked" filter />
            </label>
            <div v-if="chequePassBook" class="cheque-bank-info-grid grid col-12">
              <label class="field col-12 md:col-6">
                <span>{{ tl("ชื่อธนาคาร", "Bank name", "ຊື່ທະນາຄານ") }}</span>
                <InputText :model-value="chequePassBook.bank_name || chequePassBook.bank_code || '-'" disabled />
              </label>
              <label class="field col-12 md:col-6">
                <span>{{ tl("สาขาธนาคาร", "Bank branch", "ສາຂາທະນາຄານ") }}</span>
                <InputText :model-value="chequePassBook.branch_name || chequePassBook.bank_branch || '-'" disabled />
              </label>
            </div>
            <div class="grid col-12">
              <label class="field col-12 md:col-4">
                <span>{{ t("sell.currency") }}</span>
                <Select v-model="chequeCurrency" :options="currencyTypes" option-label="label" :placeholder="t('sell.currency')" :disabled="documentLocked" filter />
              </label>
              <label class="field col-12 md:col-4">
                <span>{{ t("sell.exchangeRate") }}</span>
                <InputText
                  v-model="chequeExchangeRateText"
                  class="text-right"
                  autocomplete="off"
                  :disabled="chequeExchangeRateDisabled"
                  :readonly="!isExchangeRateEditAuthorized('cheque')"
                  @focus="guardExchangeRateEdit('cheque', chequeExchangeRateDisabled, $event)"
                  @click="guardExchangeRateEdit('cheque', chequeExchangeRateDisabled, $event)"
                  @keydown.enter.prevent="commitProtectedExchangeRate('cheque', chequeExchangeRateDisabled, commitChequeExchangeRate, $event)"
                  @blur="commitProtectedExchangeRate('cheque', chequeExchangeRateDisabled, commitChequeExchangeRate, $event)"
                />
              </label>
              <label class="field col-12 md:col-4">
                <span>{{ t("sell.bahtAmount") }}</span>
                <InputNumber :model-value="chequeConvertedAmount" input-class="text-right" :min-fraction-digits="2" :max-fraction-digits="2" disabled />
              </label>
            </div>
            <label class="field col-12 md:col-6">
              <span>{{ t("sell.chequeNo") }}</span>
              <InputText v-model.trim="chequeNumber" :disabled="documentLocked" />
            </label>
            <label class="field col-12 md:col-6">
              <span>{{ t("sell.chequeDate") }}</span>
              <IsoDatePicker v-model="chequeDueDate" :disabled="documentLocked" />
            </label>
            <label class="field col-12 md:col-12">
              <span>{{ t("sell.amount") }}</span>
              <InputNumber v-model="chequeAmount" input-class="text-right" :min="0" :min-fraction-digits="2" :max-fraction-digits="2" :disabled="documentLocked" />
            </label>
            <Button
              class="col-12 md:col-12"
              :label="t('sell.addCheque')"
              icon="pi pi-plus"
              style="min-height: 3rem"
              fluid
              size="large"
              :disabled="documentLocked || !chequePassBook || !chequeNumber || chequeAmount <= 0 || chequeRate <= 0"
              @click="addCheque"
            />
          </div>

          <div v-else-if="activePayType === 'petty'" class="pay-form pay-form-grid grid formgrid">
            <label class="field col-12 md:col-6">
              <span>{{ tl("รหัสเงินสดย่อย", "Petty cash code", "ລະຫັດເງິນສົດຍ່ອຍ") }}</span>
              <Select
                v-model="pettyCashAccount"
                :options="pettyCashList"
                option-label="label"
                :placeholder="tl('เลือกเงินสดย่อย', 'Select petty cash', 'ເລືອກເງິນສົດຍ່ອຍ')"
                :disabled="documentLocked"
                filter
              />
            </label>

            <label class="field col-12 md:col-6">
              <span>{{ t("sell.amount") }}</span>
              <InputNumber v-model="pettyCashAmount" input-class="text-right" :min="0" :min-fraction-digits="2" :max-fraction-digits="2" :disabled="documentLocked" />
            </label>
            <div v-if="pettyCashAccount" class="payment-master-note col-12">
              <span>{{ pettyCashAccount.name_1 || pettyCashAccount.code }}</span>
              <span>{{ t("sell.currency") }} {{ pettyCashAccount.currency_code || "THB" }}</span>
              <span>{{ t("sell.remaining") }} {{ formatCurrency(pettyCashAccount.balance_money || 0) }}</span>
            </div>
            <Button
              class="col-12 md:col-12"
              :label="tl('เพิ่มเงินสดย่อย', 'Add petty cash', 'ເພີ່ມເງິນສົດຍ່ອຍ')"
              icon="pi pi-plus"
              style="min-height: 3rem"
              fluid
              size="large"
              :disabled="documentLocked || !pettyCashAccount || pettyCashAmount <= 0"
              @click="addPettyCash"
            />
          </div>

          <div v-else-if="activePayType === 'deposit'" class="pay-form pay-form-grid grid formgrid">
            <label class="field wide col-12">
              <span>{{ tl("เลขที่เงินล่วงหน้า", "Advance no.", "ເລກເງິນລ່ວງໜ້າ") }}</span>
              <Select
                v-model="depositDoc"
                :options="depositOptions"
                option-label="label"
                :placeholder="tl('เลือกเอกสารเงินล่วงหน้า', 'Select advance document', 'ເລືອກເອກະສານເງິນລ່ວງໜ້າ')"
                :disabled="documentLocked"
                filter
                @show="refreshDepositOptions"
              />
            </label>
            <div v-if="depositDoc" class="payment-master-note col-12">
              <span>{{ depositDoc.doc_no }}</span>
              <span>{{ tl("ยอดเอกสาร", "Document amount", "ຍອດເອກະສານ") }} {{ formatCurrency(depositDoc.amount || depositDoc.total_amount || 0) }}</span>
              <span>{{ t("sell.remaining") }} {{ formatCurrency(depositDoc.balance_amount || 0) }}</span>
            </div>
            <label class="field col-12 md:col-12">
              <span>{{ tl("ยอดตัด", "Deduct amount", "ຍອດຕັດ") }}</span>
              <InputNumber
                v-model="depositAmount"
                input-class="text-right"
                :min="selectedDepositMinAmount"
                :max="selectedDepositMaxAmount"
                :min-fraction-digits="2"
                :max-fraction-digits="2"
                :disabled="documentLocked || !depositDoc"
              />
            </label>
            <Button
              class="col-12 md:col-6"
              :label="tl('เพิ่มเงินล่วงหน้า', 'Add advance', 'ເພີ່ມເງິນລ່ວງໜ້າ')"
              icon="pi pi-plus"
              style="min-height: 3rem"
              fluid
              size="large"
              :disabled="documentLocked || !selectedDepositAmountValid"
              @click="addDeposit"
            />
          </div>

          <div v-else-if="activePayType === 'deposit_money'" class="pay-form pay-form-grid grid formgrid">
            <label class="field wide col-12">
              <span>{{ tl("เลขที่เงินมัดจำ", "Deposit no.", "ເລກເງິນມັດຈຳ") }}</span>
              <Select
                v-model="depositMoneyDoc"
                :options="depositMoneyOptions"
                option-label="label"
                :placeholder="tl('เลือกเอกสารเงินมัดจำ', 'Select deposit document', 'ເລືອກເອກະສານເງິນມັດຈຳ')"
                :disabled="documentLocked"
                filter
                @show="refreshDepositMoneyOptions"
              />
            </label>
            <div v-if="depositMoneyDoc" class="payment-master-note col-12">
              <span>{{ depositMoneyDoc.doc_no }}</span>
              <span>{{ tl("ยอดเอกสาร", "Document amount", "ຍອດເອກະສານ") }} {{ formatCurrency(depositMoneyDoc.amount || depositMoneyDoc.total_amount || 0) }}</span>
              <span>{{ t("sell.remaining") }} {{ formatCurrency(depositMoneyDoc.balance_amount || 0) }}</span>
            </div>
            <label class="field col-12 md:col-12">
              <span>{{ tl("ยอดตัด", "Deduct amount", "ຍອດຕັດ") }}</span>
              <InputNumber
                v-model="depositMoneyAmount"
                input-class="text-right"
                :min="selectedDepositMoneyMinAmount"
                :max="selectedDepositMoneyMaxAmount"
                :min-fraction-digits="2"
                :max-fraction-digits="2"
                :disabled="documentLocked || !depositMoneyDoc"
              />
            </label>
            <Button
              class="col-12 md:col-6"
              :label="tl('เพิ่มเงินมัดจำ', 'Add deposit', 'ເພີ່ມເງິນມັດຈຳ')"
              icon="pi pi-plus"
              style="min-height: 3rem"
              fluid
              size="large"
              :disabled="documentLocked || !selectedDepositMoneyAmountValid"
              @click="addDepositMoney"
            />
          </div>

          <div v-else-if="activePayType === 'coupon'" class="pay-form pay-form-grid grid formgrid">
            <label class="field wide col-12">
              <span>{{ tl("เลขที่คูปอง", "Coupon no.", "ເລກຄູປອງ") }}</span>
              <div class="coupon-lookup-row">
                <InputText
                  v-model.trim="couponSearch"
                  :placeholder="tl('กรอกหรือสแกนเลขคูปอง', 'Enter or scan coupon no.', 'ປ້ອນ ຫຼື ສະແກນເລກຄູປອງ')"
                  :disabled="documentLocked || couponLookupLoading"
                  autocomplete="off"
                  @keydown.enter.prevent="checkCouponCode"
                />
                <Button
                  :label="tl('ตรวจสอบ', 'Check', 'ກວດສອບ')"
                  icon="pi pi-search"
                  :loading="couponLookupLoading"
                  :disabled="documentLocked || !String(couponSearch || '').trim()"
                  @click="checkCouponCode"
                />
              </div>
            </label>
            <Message v-if="couponLookupError" class="col-12" severity="warn" :closable="false">{{ couponLookupError }}</Message>
            <div v-if="couponSelected" class="coupon-result-card col-12">
              <div>
                <span>{{ tl("เลขคูปอง", "Coupon no.", "ເລກຄູປອງ") }}</span>
                <strong>{{ couponSelected.number }}</strong>
              </div>
              <div>
                <span>{{ tl("ใช้ได้", "Available", "ໃຊ້ໄດ້") }}</span>
                <strong>{{ formatCurrency(selectedCouponMaxAmount) }}</strong>
              </div>
              <div>
                <span>{{ tl("ประเภท", "Type", "ປະເພດ") }}</span>
                <strong>{{ String(couponSelected.coupon_type) === "1" ? tl("เปอร์เซ็นต์", "Percent", "ເປີເຊັນ") : tl("จำนวนเงิน", "Amount", "ຈຳນວນເງິນ") }}</strong>
              </div>
              <div v-if="couponSelected.date_expire">
                <span>{{ tl("หมดอายุ", "Expires", "ໝົດອາຍຸ") }}</span>
                <strong>{{ couponSelected.date_expire }}</strong>
              </div>
              <div v-if="couponSelected.remark" class="wide">
                <span>{{ t("sell.remark") }}</span>
                <strong>{{ couponSelected.remark }}</strong>
              </div>
            </div>
            <label class="field col-12 md:col-12">
              <span>{{ t("sell.amount") }}</span>
              <InputNumber
                v-model="couponAmount"
                input-class="text-right"
                :min="0"
                :max="selectedCouponMaxAmount"
                :min-fraction-digits="2"
                :max-fraction-digits="2"
                :disabled="documentLocked || !couponSelected"
              />
            </label>
            <Button
              class="col-12 md:col-12"
              :label="tl('เพิ่มคูปอง', 'Add coupon', 'ເພີ່ມຄູປອງ')"
              icon="pi pi-plus"
              style="min-height: 3rem"
              fluid
              size="large"
              :disabled="documentLocked || !couponSelected || couponAmount <= 0 || selectedCouponMaxAmount <= 0 || couponAmount > selectedCouponMaxAmount"
              @click="addCoupon"
            />
          </div>

          <div v-else-if="activePayType === 'income'" class="pay-form pay-form-grid grid formgrid">
            <label class="field col-12 md:col-6">
              <span>{{ tl("รหัสรายได้", "Income code", "ລະຫັດລາຍຮັບ") }}</span>
              <Select v-model="incomeType" :options="incomeTypes" option-label="label" :placeholder="tl('เลือกรายได้', 'Select income', 'ເລືອກລາຍຮັບ')" :disabled="documentLocked" filter />
            </label>
            <label class="field col-12 md:col-6">
              <span>{{ t("sell.amount") }}</span>
              <InputNumber v-model="incomeAmount" input-class="text-right" :min="0" :min-fraction-digits="2" :max-fraction-digits="2" :disabled="documentLocked" />
            </label>
            <Button
              class="col-12 md:col-6"
              :label="tl('เพิ่มรายได้', 'Add income', 'ເພີ່ມລາຍຮັບ')"
              icon="pi pi-plus"
              style="min-height: 3rem"
              fluid
              size="large"
              :disabled="documentLocked || !incomeType || incomeAmount <= 0"
              @click="addIncome"
            />
          </div>

          <div v-else-if="activePayType === 'expense'" class="pay-form pay-form-grid grid formgrid">
            <label class="field col-12 md:col-6">
              <span>{{ tl("รหัสค่าใช้จ่าย", "Expense code", "ລະຫັດຄ່າໃຊ້ຈ່າຍ") }}</span>
              <Select v-model="expenseType" :options="expenseTypes" option-label="label" :placeholder="tl('เลือกค่าใช้จ่าย', 'Select expense', 'ເລືອກຄ່າໃຊ້ຈ່າຍ')" :disabled="documentLocked" filter />
            </label>
            <label class="field col-12 md:col-6">
              <span>{{ t("sell.amount") }}</span>
              <InputNumber v-model="expenseAmount" input-class="text-right" :min="0" :min-fraction-digits="2" :max-fraction-digits="2" :disabled="documentLocked" />
            </label>
            <Button
              class="col-12 md:col-6"
              :label="tl('เพิ่มค่าใช้จ่าย', 'Add expense', 'ເພີ່ມຄ່າໃຊ້ຈ່າຍ')"
              icon="pi pi-plus"
              style="min-height: 3rem"
              fluid
              size="large"
              :disabled="documentLocked || !expenseType || expenseAmount <= 0"
              @click="addExpense"
            />
          </div>

          <div v-else-if="activePayType === 'currency'" class="pay-form pay-form-grid grid formgrid">
            <label class="field col-12 md:col-6">
              <span>{{ t("sell.currency") }}</span>
              <Select
                v-model="otherCurrency"
                :options="otherCurrencyOptions"
                option-label="label"
                :placeholder="tl('เลือกสกุลเงิน', 'Select currency', 'ເລືອກສະກຸນເງິນ')"
                :disabled="documentLocked"
                filter
              />
            </label>
            <div v-if="otherCurrency" class="payment-master-note col-12">
              <span>{{ otherCurrency.code }} {{ otherCurrency.name_1 || "" }}</span>
            </div>
            <label class="field col-12 md:col-6">
              <span>{{ t("sell.exchangeRate") }}</span>
              <InputText
                v-model="otherCurrencyExchangeRateText"
                class="text-right"
                autocomplete="off"
                :disabled="otherCurrencyExchangeRateDisabled"
                :readonly="!isExchangeRateEditAuthorized('currency')"
                @focus="guardExchangeRateEdit('currency', otherCurrencyExchangeRateDisabled, $event)"
                @click="guardExchangeRateEdit('currency', otherCurrencyExchangeRateDisabled, $event)"
                @keydown.enter.prevent="commitProtectedExchangeRate('currency', otherCurrencyExchangeRateDisabled, commitOtherCurrencyExchangeRate, $event)"
                @blur="commitProtectedExchangeRate('currency', otherCurrencyExchangeRateDisabled, commitOtherCurrencyExchangeRate, $event)"
              />
            </label>
            <label class="field col-12 md:col-6">
              <span>{{ t("sell.amount") }}</span>
              <InputNumber v-model="otherCurrencyAmount" input-class="text-right" :min="0" :min-fraction-digits="2" :max-fraction-digits="2" :disabled="documentLocked" />
            </label>
            <label class="field col-12 md:col-6">
              <span>Charge</span>
              <InputNumber v-model="otherCurrencyCharge" input-class="text-right" :min="0" :min-fraction-digits="2" :max-fraction-digits="2" :disabled="documentLocked" />
            </label>
            <div class="cash-converted-preview col-12">
              <span>{{ t("sell.bahtAmount") }}</span>
              <strong>{{ formatCurrency(otherCurrencyConvertedAmount) }}</strong>
            </div>
            <Button
              class="col-12 md:col-6"
              :label="tl('เพิ่มสกุลเงินอื่นๆ', 'Add other currency', 'ເພີ່ມສະກຸນເງິນອື່ນ')"
              icon="pi pi-plus"
              size="small"
              :disabled="documentLocked || !otherCurrency || otherCurrencyRate <= 0"
              @click="addOtherCurrency"
            />
          </div>

          <div v-else-if="activePayType === 'laoqr'" class="pay-form pay-form-grid grid formgrid lao-qr-form">
            <div class="grid col-12">
              <div class="field col-12 md:col-12">
                <span>{{ tl("ช่องทาง", "Channel", "ຊ່ອງທາງ") }}</span>
                <div class="lao-qr-channel-row" :aria-label="tl('เลือกช่องทาง', 'Choose channel', 'ເລືອກຊ່ອງທາງ')">
                  <button
                    v-for="option in laoQrProviderOptions"
                    :key="option.value"
                    type="button"
                    class="lao-qr-channel-button"
                    :class="{ active: laoQrProvider === option.value }"
                    :disabled="laoQrUiLocked"
                    @click="laoQrProvider = option.value"
                  >
                    <span class="lao-qr-channel-icon">
                      <i :class="option.value === 'onepay' ? 'pi pi-wallet' : 'pi pi-qrcode'" />
                    </span>
                    <span class="lao-qr-channel-copy">
                      <strong>{{ option.label }}</strong>
                      <small>{{ option.value === "onepay" ? "Onepay" : "LAO QR" }}</small>
                    </span>
                    <i v-if="laoQrProvider === option.value" class="pi pi-check-circle lao-qr-channel-check" />
                  </button>
                </div>
              </div>
              <label class="field col-12 md:col-4">
                <span>{{ tl("ยอดคงเหลือ (บาท)", "Remaining amount (THB)", "ຍອດຄົງເຫຼືອ (THB)") }}</span>
                <InputNumber :model-value="laoQrBaseDue" input-class="text-right" :min-fraction-digits="2" :max-fraction-digits="2" disabled />
              </label>
              <label class="field col-12 md:col-4">
                <span>{{ tl("อัตราแลกเปลี่ยน", "Exchange rate", "ອັດຕາແລກປ່ຽນ") }}</span>
                <InputNumber :model-value="laoQrRate" input-class="text-right" :min-fraction-digits="2" :max-fraction-digits="exchangeRateDecimal" disabled />
              </label>
            </div>
            <div class="grid col-12">
              <label class="field col-12 md:col-4">
                <span>{{ tl("ยอด QR", "QR amount", "ຍອດ QR") }} ({{ laoQrCurrencyCode }})</span>
                <InputNumber :model-value="laoQrAmountLak" input-class="text-right" :min="1" :max-fraction-digits="0" disabled />
              </label>

              <label class="field col-12 md:col-4">
                <span>{{ tl("ยอดรับชำระ (บาท)", "Payment amount (THB)", "ຍອດຮັບຊຳລະ (THB)") }}</span>
                <InputNumber :model-value="laoQrPaymentThb" input-class="text-right" :min-fraction-digits="2" :max-fraction-digits="2" disabled />
              </label>

              <label class="field col-12 md:col-4">
                <span>{{ t("sell.rounded") }}</span>
                <InputNumber :model-value="laoQrRoundingAmount" input-class="text-right" :min-fraction-digits="2" :max-fraction-digits="2" disabled />
              </label>
            </div>
            <div class="grid col-12" style="padding-left: 15px; padding-right: 0px">
              <div class="cash-converted-preview col-12 my-1 py-2">
                <span>{{
                  tl(
                    "ระบบจะบันทึกเป็นเงินโอน และใส่ส่วนต่างในยอดปัดเศษเมื่อ QR ชำระสำเร็จ",
                    "Paid QR will be saved as bank transfer with the difference in rounding",
                    "QR ທີ່ຈ່າຍແລ້ວຈະບັນທຶກເປັນເງິນໂອນ ແລະໃສ່ສ່ວນຕ່າງໃນຍອດປັດເສດ",
                  )
                }}</span>
                <strong>{{ formatCurrency(laoQrPaymentThb) }}</strong>
              </div>

              <Message class="col-12 my-1 py-1" severity="info" :closable="false">
                {{
                  tl(
                    "เงื่อนไข: ใช้ LAO QR เป็นช่องทางชำระสุดท้าย ระบบจะสร้าง QR จากยอดคงเหลือหลังหักช่องทางชำระอื่น และเมื่อ QR ชำระสำเร็จจะบันทึกเอกสารทันที",
                    "Condition: Use LAO QR as the final payment method. The QR is created from the remaining amount after other payments, and the document is saved immediately after the QR is paid.",
                    "ເງື່ອນໄຂ: ໃຊ້ LAO QR ເປັນຊ່ອງທາງຊຳລະສຸດທ້າຍ. QR ຈະສ້າງຈາກຍອດຄົງເຫຼືອຫຼັງຫັກຊ່ອງທາງຊຳລະອື່ນ ແລະເມື່ອ QR ຊຳລະສຳເລັດລະບົບຈະບັນທຶກເອກະສານທັນທີ",
                  )
                }}
              </Message>

              <div class="payment-master-note col-12 my-1" v-if="laoQrInvoiceId">
                <span v-if="laoQrConfigLoading">{{ tl("กำลังโหลด config", "Loading config", "ກຳລັງໂຫຼດ config") }}</span>
                <!-- <span v-else-if="laoQrConfig?.merchant_name">{{ laoQrConfig.merchant_name }}</span> -->
                <!-- <span v-if="laoQrTransferPassBook">{{ laoQrTransferPassBook.label }}</span>
              <span v-if="laoQrConfig?.shopcode">SHOP {{ laoQrConfig.shopcode }}</span> -->
                <span v-if="laoQrInvoiceId">{{ laoQrInvoiceId }}</span>
                <span v-if="laoQrUuid">{{ laoQrUuid }}</span>
              </div>

              <Message v-if="laoQrConfigError" class="col-12" severity="error" :closable="false">{{ laoQrConfigError }}</Message>
              <Message v-else-if="laoQrConfig && !laoQrConfig.enabled" class="col-12" severity="warn" :closable="false">
                {{ tl("ยังไม่ได้ตั้งค่า env สำหรับ Onepay", "Onepay env is not configured", "ຍັງບໍ່ໄດ້ຕັ້ງຄ່າ env Onepay") }}:
                {{ (laoQrConfig.missing || []).join(", ") }}
              </Message>
              <Message v-else-if="laoQrConfig && !laoQrTransferPassBook" class="col-12" severity="warn" :closable="false">
                {{ tl("ไม่พบสมุดบัญชีรับโอนจาก env", "Transfer pass book from env was not found", "ບໍ່ພົບສົມຸດບັນຊີຮັບໂອນຈາກ env") }}:
                {{ laoQrTransferPassBookCode || "ONEPAY_QR_TRANSFER_PASS_BOOK_CODE" }}
              </Message>
              <Message v-else-if="laoQrConfig && !laoQrCurrencyInMaster" class="col-12" severity="warn" :closable="false">
                {{ tl("ไม่พบสกุลเงิน QR ใน master", "QR currency was not found in currency master", "ບໍ່ພົບສະກຸນເງິນ QR ໃນ master") }}:
                {{ laoQrCurrencyCode }}
              </Message>
              <Message v-else-if="paymentLineCount > 0 || roundedAmount !== 0" class="col-12 my-1 py-1" severity="info" :closable="false">
                {{
                  tl(
                    "LAO QR จะสร้างจากยอดคงเหลือหลังหักช่องทางชำระอื่นแล้ว",
                    "LAO QR will be created from the remaining amount after other payments.",
                    "LAO QR ຈະສ້າງຈາກຍອດຄົງເຫຼືອຫຼັງຫັກຊ່ອງທາງຊຳລະອື່ນແລ້ວ",
                  )
                }}
              </Message>

              <div v-if="laoQrPaymentRequestCount" class="lao-qr-request-list col-12 my-1 py-2">
                <div class="lao-qr-request-list-header">
                  <strong>{{ tl("QR ที่สร้างไว้", "Created QR requests", "QR ທີ່ສ້າງໄວ້") }}</strong>
                  <span>{{ laoQrPaymentRequestCount }} {{ tl("รายการ", "items", "ລາຍການ") }}</span>
                </div>
                <article v-for="(request, index) in laoQrPaymentRequests" :key="request.local_id" class="lao-qr-request-item" :class="{ active: request.local_id === activeLaoQrRequestId }">
                  <div class="lao-qr-request-main">
                    <div class="lao-qr-request-title">
                      <strong>{{ request.provider === "onepay" ? "Onepay" : "Lao QR" }} #{{ index + 1 }}</strong>
                      <Tag :value="laoQrHistoryStatusLabel(request.status)" :severity="laoQrRequestStatusSeverity(request.status)" />
                    </div>
                    <div class="lao-qr-request-amounts">
                      <span>{{ formatQty(Math.round(toNumber(request.amount_lak))) }} {{ request.currency_code || "LAK" }}</span>
                      <!-- <span>{{ formatCurrency(laoQrRequestCloseAmount(request)) }}</span> -->
                    </div>
                    <div class="lao-qr-request-meta">
                      <span v-if="request.invoiceid">{{ request.invoiceid }}</span>
                      <span v-if="request.uuid">{{ request.uuid }}</span>
                    </div>
                    <small v-if="request.save_blocked_reason === 'amount_mismatch'" class="lao-qr-request-warning">{{ request.message }}</small>
                  </div>
                  <div class="lao-qr-request-actions">
                    <Button
                      :label="tl('แสดง QR', 'Show QR', 'ສະແດງ QR')"
                      icon="pi pi-qrcode"
                      size="small"
                      severity="info"
                      outlined
                      :disabled="!request.qr_image"
                      @click="showLaoQrRequest(request)"
                    />
                    <Button
                      :label="tl('ตรวจสอบ', 'Check', 'ກວດສອບ')"
                      icon="pi pi-sync"
                      size="small"
                      :loading="laoQrCheckingRequestId === request.local_id"
                      :disabled="!canCheckLaoQrRequest(request) || (!!laoQrCheckingRequestId && laoQrCheckingRequestId !== request.local_id)"
                      @click="checkLaoQrRequest(request)"
                    />
                  </div>
                </article>
              </div>
              <div class="payment-quick-actions col-12 my-1 px-0">
                <Button
                  class="lao-qr-create-button"
                  :label="tl('สร้าง QR', 'Create QR', 'ສ້າງ QR')"
                  fluid
                  icon="pi pi-qrcode"
                  severity="success"
                  :loading="laoQrStatus === 'creating'"
                  :disabled="!laoQrCanCreate"
                  style="padding: 0 !important"
                  @click="createLaoQr"
                />

                <Button
                  v-if="laoQrQrImage || ['pending', 'scanned', 'paid', 'saving', 'save_failed'].includes(laoQrStatus)"
                  :label="tl('เปิดหน้าต่าง QR', 'Open QR dialog', 'ເປີດໜ້າຕ່າງ QR')"
                  icon="pi pi-external-link"
                  severity="info"
                  outlined
                  style="margin-top: 2rem"
                  @click="onLaoQrDialogVisibleChange(true)"
                />

                <Button
                  :label="tl('ประวัติQRทั้งหมด', 'All QR history', 'ປະຫວັດ QR ທັງໝົດ')"
                  icon="pi pi-list-check"
                  severity="danger"
                  style="margin-top: 2rem"
                  :disabled="!laoQrHistoryPosId"
                  @click="openLaoQrHistoryDialog"
                />
              </div>
            </div>
          </div>

          <div v-else-if="activePayType === 'wallet'" class="pay-form pay-form-grid grid formgrid">
            <label class="field col-12 md:col-6">
              <span>{{ tl("ประเภท Wallet", "Wallet type", "ປະເພດ Wallet") }}</span>
              <Select v-model="walletType" :options="walletTypes" option-label="label" :placeholder="tl('เลือก Wallet', 'Select Wallet', 'ເລືອກ Wallet')" :disabled="documentLocked" filter />
            </label>
            <div v-if="walletType" class="payment-master-note col-12">
              <span>{{ walletType.code }}</span>
              <span>{{ walletType.name_1 || walletType.label }}</span>
              <span v-if="walletType.account_code">{{ tl("บัญชี", "Account", "ບັນຊີ") }} {{ walletType.account_code }}</span>
            </div>
            <label class="field col-12 md:col-6">
              <span>{{ tl("เลขที่รายการ", "Transaction no.", "ເລກລາຍການ") }}</span>
              <InputText v-model.trim="walletNumber" :disabled="documentLocked" />
            </label>
            <label class="field col-12 md:col-6">
              <span>{{ tl("เลขที่อนุมัติ", "Approval no.", "ເລກອະນຸມັດ") }}</span>
              <InputText v-model.trim="walletApprovedNo" :disabled="documentLocked" />
            </label>
            <label class="field col-12 md:col-6">
              <span>Ref 1</span>
              <InputText v-model.trim="walletRef1" :disabled="documentLocked" />
            </label>
            <label class="field col-12 md:col-6">
              <span>Ref 2</span>
              <InputText v-model.trim="walletRef2" :disabled="documentLocked" />
            </label>
            <label class="field col-12 md:col-6">
              <span>{{ t("sell.amount") }}</span>
              <InputNumber v-model="walletAmount" input-class="text-right" :min="0" :min-fraction-digits="2" :max-fraction-digits="2" :disabled="documentLocked" />
            </label>
            <Button
              class="col-12 md:col-6"
              :label="tl('เพิ่ม Wallet', 'Add Wallet', 'ເພີ່ມ Wallet')"
              icon="pi pi-plus"
              size="small"
              :disabled="documentLocked || !walletNumber || walletAmount <= 0"
              @click="addWallet"
            />
          </div>

          <!-- <div class="payment-summary payment-inline-summary">
            <div>
              <span>{{ t("sell.paid") }}</span>
              <div class="paid-currency-summary">
                <strong>{{ formatCurrency(totalPaid) }}</strong>
                <div v-if="cashPaidCurrencyRows.length" class="paid-currency-list">
                  <div v-for="row in cashPaidCurrencyRows" :key="row.code" class="paid-currency-row">
                    <span>{{ row.label }} {{ formatQty(row.amount) }}</span>
                    <b>{{ formatCurrency(row.homeAmount) }}</b>
                  </div>
                </div>
              </div>
            </div>
            <div>
              <span>{{ nonCashOverPayment > 0 ? t("sell.nonCashOver") : paymentChange > 0 ? t("sell.change") : t("sell.remaining") }}</span
              ><strong>{{ formatCurrency(nonCashOverPayment > 0 ? nonCashOverPayment : paymentChange > 0 ? paymentChange : remainingPayment) }}</strong>
            </div>
          </div> -->

          <Message v-if="paymentReviewNeeded" severity="warn" :closable="false">
            {{
              tl(
                "ยอดเอกสารเปลี่ยนหลังมีรายการชำระเงิน กรุณาตรวจสอบยอดรับชำระก่อนบันทึก",
                "Document amount changed after payment. Please review payment before saving",
                "ຍອດເອກະສານປ່ຽນຫຼັງມີການຊຳລະ ກະລຸນາກວດຍອດຮັບຊຳລະກ່ອນບັນທຶກ",
              )
            }}
            <Button :label="tl('ยืนยันยอดชำระถูกต้อง', 'Confirm payment is correct', 'ຢືນຢັນຍອດຊຳລະຖືກຕ້ອງ')" size="small" text :disabled="documentLocked" @click="confirmPaymentReview" />
          </Message>
          <Message v-if="nonCashOverPayment > 0" severity="error" :closable="false">
            {{
              tl(
                "ยอดชำระที่ไม่ใช่เงินสดเกินยอดสุทธิ กรุณาปรับยอดให้ไม่เกินยอดที่ต้องชำระ",
                "Non-cash payment exceeds net amount. Please adjust it to not exceed amount due",
                "ຍອດຊຳລະທີ່ບໍ່ແມ່ນເງິນສົດເກີນຍອດສຸດທິ ກະລຸນາປັບຍອດບໍ່ໃຫ້ເກີນຍອດທີ່ຕ້ອງຊຳລະ",
              )
            }}
          </Message>
          <Message v-if="!cashChangeAllowed" severity="error" :closable="false">
            {{ tl("เงินทอนต้องมาจากยอดรับเงินสดเท่านั้น", "Change must come from cash received only", "ເງິນທອນຕ້ອງມາຈາກຍອດຮັບເງິນສົດເທົ່ານັ້ນ") }}
          </Message>
        </section>

        <aside class="payment-dialog-summary-panel" data-font-zone="payment-summary">
          <div class="payment-summary-total-card">
            <span class="payment-summary-total-label">{{ t("sell.amountToPay") }}</span>
            <strong v-if="summaryTotalKipDisplay"
              >{{ formatQty(summaryTotalKipDisplay.amount) }} <small>{{ summaryTotalKipDisplay.name }}</small></strong
            >
            <strong v-else>{{ formatCurrency(totalDue) }}</strong>
          </div>
          <div class="payment-summary-lines">
            <div class="rounded-amount-line">
              <span>{{ t("sell.rounded") }} ({{ t("sell.baht") }}) </span>
              <InputNumber v-model="roundedAmount" input-class="text-right" :min-fraction-digits="2" :max-fraction-digits="2" :disabled="documentLocked" />
            </div>
            <div>
              <span>{{ t("sell.payAmount") }} ({{ t("sell.baht") }})</span>
              <b>{{ formatCurrency(totalPaid) }}</b>
            </div>
            <div>
              <span>{{ t("sell.remaining") }} ({{ t("sell.baht") }})</span>
              <b class="payment-remaining">{{ formatCurrency(remainingPayment) }}</b>
            </div>
            <div class="change">
              <span>{{ t("sell.change") }} ({{ t("sell.baht") }})</span>
              <b>{{ formatCurrency(paymentChange) }}</b>
            </div>
            <div class="change change-kip">
              <span>{{ t("sell.change") }} ({{ paymentChangeRoundedCurrencyName }})</span>
              <span class="change-currency-values">
                <small v-if="paymentChangeCurrencyHasRounding" class="change-currency-before">({{ formatQty(paymentChangeRawCurrencyAmount) }})</small>
                <b>{{ formatQty(paymentChangeRoundedCurrencyAmount) }}</b>
              </span>
            </div>
          </div>

          <div class="payment-side-list-title">
            <span>{{ tl("รายการรับชำระ", "Payment entries", "ລາຍການຊຳລະ") }}</span>
            <b>{{ paymentLineCount }} {{ tl("รายการ", "entries", "ລາຍການ") }}</b>
          </div>
          <div class="payment-list payment-list-side">
            <template v-if="cashPaid > 0">
              <div v-for="row in cashPaidCurrencyRows" :key="row.code" class="payment-row">
                <span class="payment-row-icon" :style="cashCurrencyIconInfo(row.code)">
                  <i :class="cashCurrencyIconInfo(row.code).icon" />
                </span>
                <div>
                  <strong>{{ t("payment.cash") }} ({{ row.code }})</strong>
                  <span>{{ formatQty(row.amount) }} {{ row.label }}</span>
                </div>
                <b>{{ formatCurrency(row.homeAmount) }}</b>
                <Button
                  icon="pi pi-times"
                  text
                  rounded
                  severity="danger"
                  :aria-label="tl('ลบชำระเงิน', 'Remove payment', 'ລຶບການຊຳລະ')"
                  :disabled="documentLocked"
                  @click="removeCashPayment(row.code)"
                />
              </div>
              <div v-if="!cashPaidCurrencyRows.length" class="payment-row calculated-payment-row">
                <span class="payment-row-icon" style="background: #fff7ed; color: #e87e2c">
                  <i class="pi pi-money-bill" />
                </span>
                <div>
                  <strong>{{ t("payment.cash") }}</strong>
                  <span>{{ tl("รับเงินสดแล้วจากยอดที่ระบบคำนวณ", "Cash received from computed amount", "ຮັບເງິນສົດແລ້ວຈາກຍອດທີ່ລະບົບຄຳນວນ") }}</span>
                </div>
                <b>{{ formatCurrency(cashPaid) }}</b>
              </div>
            </template>
            <div v-if="!paymentLineCount" class="payment-empty">
              {{ tl("ยังไม่มีรายการชำระเงิน", "No payment entries yet", "ຍັງບໍ່ມີລາຍການຊຳລະ") }}
            </div>
            <div v-for="entry in paymentEntries" :key="entry.id" class="payment-row">
              <span
                class="payment-row-icon"
                :style="{
                  background: paymentEntryIconInfo(entry).bg,
                  color: paymentEntryIconInfo(entry).color,
                }"
              >
                <i :class="paymentEntryIconInfo(entry).icon" />
              </span>
              <div>
                <strong>{{ paymentEntryTitle(entry) }}</strong>
                <span v-if="entry.type === 'transfer' || entry.type === 'credit_transfer'">{{ paymentEntryCurrencyDescription(entry) }}</span>
                <span v-else>{{ paymentEntryDescription(entry) }}</span>
              </div>
              <b>{{ formatCurrency(paymentEntryAmount(entry)) }}</b>
              <Button icon="pi pi-times" text rounded severity="danger" :aria-label="tl('ลบชำระเงิน', 'Remove payment', 'ລຶບການຊຳລະ')" :disabled="documentLocked" @click="removePayment(entry.id)" />
            </div>
          </div>
          <div class="payment-action-buttons">
            <Button v-if="showChangeAutoRounding" :label="changeAutoRoundingLabel" icon="pi pi-sparkles" class="kip-auto-rounding-btn" :disabled="documentLocked" @click="addKipAutoRounding" />
            <Button
              v-if="showTransferAutoRounding"
              :label="transferAutoRoundingLabel"
              icon="pi pi-sparkles"
              class="kip-auto-rounding-btn"
              :disabled="documentLocked"
              @click="syncTransferAutoRounding"
            />
            <Button
              :label="t('payment.confirmPayment')"
              icon="pi pi-check"
              severity="success"
              size="large"
              :class="['payment-save-button', { 'is-ready': canCheckoutSave }]"
              :loading="saving"
              :disabled="!canCheckoutSave"
              @click="checkoutAndSave"
            />
            <Button class="payment-close-button" :label="t('sell.cancel')" icon="pi pi-times" severity="danger" :disabled="saving || laoQrCloseLocked" @click="onPaymentDialogVisibleChange(false)" />
          </div>
        </aside>
      </div>
      <template v-if="!successDocNo" #footer>
        <div class="payment-rate-strip">
          <!-- <div class="rate-strip-info info-icon">
            <i class="pi pi-info-circle" />
            <span>{{ tl("ยอดที่ต้องชำระ ตามอัตราแลกเปลี่ยน", "Latest exchange rates", "ອັດຕາແລກປ່ຽນຫຼ້າສຸດ") }}</span>
          </div> -->
          <div v-for="summaryRow in summaryNetAmountRows" :key="summaryRow.code" class="rate-chip" :style="cashCurrencyIconInfo(summaryRow.code)">
            <strong
              >{{ summaryRow.label }} <span v-if="summaryRow.name_2 != '1'" class="rate-chip-name2">({{ summaryRow.name_2 }})</span></strong
            >
            <span
              ><strong :style="cashCurrencyIconInfo(summaryRow.code)">{{ formatCurrency(summaryRow.amount) }}</strong></span
            >
          </div>
        </div>
      </template>
    </Dialog>

    <Dialog
      :visible="transferQrDialogVisible"
      modal
      :draggable="false"
      class="transfer-static-qr-dialog"
      :header="selectedTransferStaticQr?.name || 'QR Code'"
      :style="{ width: 'min(520px, 94vw)', ...saleLayoutStyle }"
      @update:visible="onTransferStaticQrDialogVisibleChange"
    >
      <div v-if="selectedTransferStaticQr" class="transfer-static-qr-dialog-body">
        <!-- <strong>{{ selectedTransferStaticQr.name }}</strong> -->
        <img :src="selectedTransferStaticQr.image" :alt="selectedTransferStaticQr.name" />
      </div>
    </Dialog>

    <Dialog
      :visible="laoQrDialogVisible"
      modal
      :closable="!laoQrDialogCloseLocked"
      :close-on-escape="!laoQrDialogCloseLocked"
      :draggable="false"
      :style="{ width: 'min(460px, 94vw)' }"
      @update:visible="onLaoQrDialogVisibleChange"
    >
      <div class="lao-qr-dialog-body">
        <div class="lao-qr-dialog-amount-card">
          <span> {{ laoQrProviderLabel }} ({{ laoQrCurrencyCode || "KIP" }})</span>
          <strong>{{ formatQty(Math.round(toNumber(laoQrAmountLak))) }}</strong>
          <!-- <small>{{ tl("เทียบเท่า", "Equivalent", "ເທົ່າກັບ") }} {{ formatCurrency(laoQrPaymentThb) }}</small> -->
        </div>

        <div v-if="laoQrQrImage" class="lao-qr-dialog-image-wrap" :class="{ 'lao-qr-dialog-image-wrap--bcel': isLaoQrFrameProvider }">
          <template v-if="isLaoQrFrameProvider">
            <div class="qr-lao-frame">
              <span class="qr-lao-frame-text qr-lao-frame-text--top">MYQR MYQR MYQR MYQR MYQR MYQR MYQR</span>
              <span class="qr-lao-frame-text qr-lao-frame-text--right">MYQR MYQR MYQR MYQR</span>
              <span class="qr-lao-frame-text qr-lao-frame-text--bottom">MYQR MYQR MYQR MYQR MYQR MYQR MYQR</span>
              <span class="qr-lao-frame-text qr-lao-frame-text--left">MYQR MYQR MYQR MYQR</span>
              <img class="lao-qr-dialog-image" :src="laoQrQrImage" alt="LAO QR" />
              <img class="lao-qr-dialog-mark" :src="laoQrDialogMarkImage" alt="" aria-hidden="true" />
            </div>
          </template>
          <template v-else>
            <img class="lao-qr-dialog-image" :src="laoQrQrImage" alt="LAO QR" />
            <img class="lao-qr-dialog-mark" :src="onePayMarkImage" alt="" aria-hidden="true" />
          </template>
        </div>
        <div v-if="laoQrCountdownVisible" class="lao-qr-countdown" role="timer" aria-live="polite">
          <strong>{{ laoQrCountdownText }}</strong>
        </div>
        <div v-if="laoQrQrImage && ['creating', 'pending', 'scanned'].includes(laoQrStatus)" class="lao-qr-waiting-note" role="status" aria-live="polite">
          <i class="pi pi-spinner pi-spin" aria-hidden="true" />
          <span>{{
            tl(
              "กำลังรอรับชำระ ระบบจะบันทึกอัตโนมัติหลังจากชำระแล้ว",
              "Waiting for payment. The system will save automatically after payment is completed",
              "ກຳລັງລໍຖ້າຮັບຊຳລະ ລະບົບຈະບັນທຶກອັດຕະໂນມັດຫຼັງຈາກຊຳລະສຳເລັດ",
            )
          }}</span>
        </div>
        <Message v-else-if="laoQrMessage" severity="info" :closable="false">{{ laoQrMessage }}</Message>
        <div class="lao-qr-dialog-meta">
          <span v-if="laoQrInvoiceId">{{ laoQrInvoiceId }}</span>
          <span v-if="laoQrUuid">{{ laoQrUuid }}</span>
        </div>
      </div>
      <template #footer>
        <div class="payment-quick-actions">
          <Button
            v-if="['pending', 'scanned'].includes(laoQrStatus)"
            :label="tl('ตรวจสอบตอนนี้', 'Check now', 'ກວດຕອນນີ້')"
            icon="pi pi-refresh"
            outlined
            :disabled="laoQrSavingPaid"
            @click="checkLaoQrStatusOnce"
          />
          <Button v-if="['pending', 'scanned', 'creating'].includes(laoQrStatus)" :label="t('sell.cancel')" icon="pi pi-times" severity="secondary" outlined @click="cancelLaoQr" />
          <Button v-if="laoQrStatus === 'save_failed'" :label="tl('บันทึกซ้ำ', 'Retry save', 'ບັນທຶກຊ້ຳ')" icon="pi pi-save" severity="danger" :loading="saving" @click="retrySavePaidLaoQr" />
          <!-- <Button :label="t('sell.close')" severity="secondary" outlined :disabled="laoQrDialogCloseLocked" @click="onLaoQrDialogVisibleChange(false)" /> -->
        </div>
      </template>
    </Dialog>

    <Dialog
      :visible="laoQrHistoryDialogVisible"
      modal
      :draggable="false"
      :header="tl('ประวัติQRทั้งหมด', 'All QR history', 'ປະຫວັດ QR ທັງໝົດ')"
      :style="{ width: '90vw', height: '90vh' }"
      class="lao-qr-history-dialog"
      @update:visible="laoQrHistoryDialogVisible = $event"
    >
      <div class="lao-qr-history-dialog-body">
        <div class="lao-qr-history-toolbar">
          <div class="lao-qr-history-pos">
            <span>{{ tl("เครื่อง POS", "POS terminal", "ເຄື່ອງ POS") }}</span>
            <strong>{{ laoQrHistoryPosLabel || "-" }}</strong>
          </div>
          <DatePicker v-model="laoQrHistoryFromDate" date-format="dd/mm/yy" :manual-input="false" show-icon class="lao-qr-history-date" />
          <DatePicker v-model="laoQrHistoryToDate" date-format="dd/mm/yy" :manual-input="false" show-icon class="lao-qr-history-date" />
          <Select v-model="laoQrHistoryStatus" :options="laoQrHistoryStatusOptions" option-label="label" option-value="value" class="lao-qr-history-status" />
          <InputText
            v-model.trim="laoQrHistorySearch"
            class="lao-qr-history-search"
            :placeholder="tl('ค้นหา UUID / Invoice / อ้างอิง / ยอดเงิน / เครื่อง', 'Search UUID / invoice / reference / amount / terminal', 'ຄົ້ນຫາ UUID / invoice / ອ້າງອີງ / ຍອດ / ເຄື່ອງ')"
            @keyup.enter="loadLaoQrHistoryForCurrentPos"
          />
          <Button :label="tl('ค้นหา', 'Search', 'ຄົ້ນຫາ')" icon="pi pi-search" :loading="laoQrHistoryLoading" @click="loadLaoQrHistoryForCurrentPos" />
          <Button
            :label="tl('วันนี้', 'Today', 'ມື້ນີ້')"
            icon="pi pi-calendar"
            severity="secondary"
            outlined
            @click="
              resetLaoQrHistoryFiltersToToday();
              loadLaoQrHistoryForCurrentPos();
            "
          />
        </div>

        <Message v-if="laoQrHistoryError" severity="error" :closable="false">{{ laoQrHistoryError }}</Message>

        <DataTable
          :value="laoQrHistoryRows"
          :loading="laoQrHistoryLoading"
          striped-rows
          paginator
          :rows="20"
          :rows-per-page-options="[20, 50, 100]"
          size="small"
          scrollable
          scroll-height="flex"
          table-style="min-width: 1360px"
          data-key="id"
          class="lao-qr-history-dialog-table"
        >
          <Column :header="tl('วันที่เวลา', 'Date/time', 'ວັນເວລາ')" style="min-width: 135px">
            <template #body="{ data }">{{ formatLaoQrHistoryDateTime(data.created_at) }}</template>
          </Column>
          <Column :header="tl('POS / เครื่อง', 'POS / terminal', 'POS / ເຄື່ອງ')" style="min-width: 140px">
            <template #body="{ data }">{{ laoQrHistoryPosText(data) }}</template>
          </Column>
          <Column :header="tl('ผู้สร้าง', 'Creator', 'ຜູ້ສ້າງ')" style="min-width: 150px">
            <template #body="{ data }">{{ laoQrHistoryCreatorText(data) }}</template>
          </Column>
          <Column field="invoiceid" header="Invoice" style="min-width: 120px" />
          <Column field="uuid" header="UUID" style="min-width: 210px" />
          <Column :header="tl('ยอด LAK', 'Amount LAK', 'ຍອດ LAK')" style="min-width: 120px">
            <template #body="{ data }">
              <span class="num-cell">{{ formatCurrency(data.amount_lak) }}</span>
            </template>
          </Column>
          <Column :header="tl('สถานะ', 'Status', 'ສະຖານະ')" style="min-width: 130px">
            <template #body="{ data }">
              <Tag :value="laoQrHistoryStatusLabel(data.status)" :severity="laoQrHistoryStatusSeverity(data.status)" />
            </template>
          </Column>
          <Column :header="tl('เช็คล่าสุด', 'Last checked', 'ກວດລ່າສຸດ')" style="min-width: 135px">
            <template #body="{ data }">{{ formatLaoQrHistoryDateTime(data.last_checked_at) }}</template>
          </Column>
          <Column :header="tl('อ้างอิงธนาคาร', 'Bank ref', 'ອ້າງອີງທະນາຄານ')" style="min-width: 150px">
            <template #body="{ data }">{{ laoQrHistoryBankRefText(data) }}</template>
          </Column>
          <Column :header="tl('เอกสารขาย', 'Sale doc', 'ເອກະສານຂາຍ')" style="min-width: 120px">
            <template #body="{ data }">{{ data.sale_doc_no || "-" }}</template>
          </Column>
          <Column :header="tl('จัดการ', 'Actions', 'ຈັດການ')" frozen align-frozen="right" style="min-width: 130px">
            <template #body="{ data }">
              <Button
                v-if="canCheckLaoQrHistory(data)"
                :label="tl('ตรวจสอบ', 'Check', 'ກວດສອບ')"
                icon="pi pi-sync"
                size="small"
                :loading="laoQrHistoryCheckingId === data.id"
                :disabled="!!laoQrHistoryCheckingId"
                @click="checkLaoQrHistoryRow(data)"
              />
              <span v-else class="paid-text">{{ tl("สำเร็จ", "Done", "ສຳເລັດ") }}</span>
            </template>
          </Column>
        </DataTable>
      </div>
      <template #footer>
        <Button :label="t('sell.close')" severity="secondary" outlined @click="laoQrHistoryDialogVisible = false" />
      </template>
    </Dialog>

    <Teleport v-if="workspaceTab === 'details'" defer to="#sell-doc-footer-slot">
      <section class="doc-footer-panel biz-panel" data-font-zone="summary-rail" :aria-label="tl('ข้อมูลสรุปและการจัดส่ง', 'Summary and shipment', 'ຂໍ້ມູນສະຫຼຸບແລະການຈັດສົ່ງ')">
        <div class="doc-footer-grid">
          <div class="doc-footer-right">
            <div class="doc-footer-block doc-footer-summary-block" data-font-zone="summary-totals">
              <div class="panel-title compact">
                <i class="pi pi-calculator" />
                <strong>{{ t("sell.summaryBaht") }}</strong>
              </div>
              <label class="field">
                <span>{{ t("sell.billDiscount") }}</span>
                <button type="button" class="bill-discount-button" data-testid="sale-bill-discount-footer" :disabled="documentLocked" @click="openBillDiscountEditor">
                  <span>{{ discountWord }}</span>
                  <i class="pi pi-pencil" />
                </button>
              </label>

              <!-- <template v-if="showDocumentCurrency">
              <div class="summary-list compact" style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid var(--p-surface-border)">
                <div class="summary-list-header" style="color: var(--p-text-color-secondary); font-size: 0.75rem; font-weight: 800; margin-bottom: 0.45rem">
                  {{ selectedDocumentCurrency?.code || t("sell.currency") }} ({{ t("sell.currency") }})
                </div>
                <div>
                  <span>{{ t("sell.productValue") }} </span><strong>{{ formatCurrency(currencyTotalValue) }}</strong>
                </div>
                <div v-if="currencyBillDiscountAmount > 0">
                  <span>{{ t("sell.billDiscount") }} ({{ t("sell.currency") }})</span><strong class="discount">-{{ formatCurrency(currencyBillDiscountAmount) }}</strong>
                </div>
                <div v-if="currencyPromotionDiscountAmount > 0">
                  <span>{{ t("sell.promotion") }} ({{ t("sell.currency") }})</span><strong class="discount">-{{ formatCurrency(currencyPromotionDiscountAmount) }}</strong>
                </div>
                <div>
                  <span>{{ t("sell.beforeVat") }} ({{ t("sell.currency") }})</span><strong>{{ formatCurrency(currencyBeforeVat) }}</strong>
                </div>
                <div>
                  <span>{{ t("sell.vat") }} ({{ t("sell.currency") }})</span><strong>{{ currencyVatValue > 0 ? formatCurrency(currencyVatValue) : "-" }}</strong>
                </div>
                <div class="net">
                  <span>{{ t("sell.netAmount") }} ({{ t("sell.currency") }})</span><strong>{{ formatCurrency(currencyTotalAmount) }}</strong>
                </div>
              </div>
            </template> -->

              <div class="summary-list compact">
                <div>
                  <span>{{ t("sell.productValue") }}</span
                  ><strong>{{ formatCurrency(totals.totalValue) }}</strong>
                </div>
                <div v-if="billDiscountAmount > 0">
                  <span>{{ t("sell.billDiscount") }}</span
                  ><strong class="discount">-{{ formatCurrency(billDiscountAmount) }}</strong>
                </div>
                <div v-if="promotionDiscountAmount > 0">
                  <span>{{ t("sell.promotion") }}</span
                  ><strong class="discount">-{{ formatCurrency(promotionDiscountAmount) }}</strong>
                </div>
                <!-- <div>
                <span>{{ t("sell.beforeVat") }}</span
                ><strong>{{ formatCurrency(totals.beforeVat) }}</strong>
              </div>
              <div>
                <span>{{ t("sell.vat") }}</span
                ><strong>{{ totals.vatValue > 0 ? formatCurrency(totals.vatValue) : "-" }}</strong>
              </div> -->
                <!-- <div class="net">
                 <span>{{ t("sell.netAmount") }} ({{ masterHomeCurrencyCode }})</span
                ><strong>{{ formatCurrency(totals.totalAmount) }}</strong>
              </div> -->
                <div v-for="summaryRow in summaryNetAmountRows" :key="summaryRow.code" class="net">
                  <strong
                    ><span
                      >{{ t("sell.netAmount") }} {{ summaryRow.label }} <span v-if="summaryRow.name_2 != '1'" class="net-name2">({{ summaryRow.name_2 }})</span></span
                    ></strong
                  >
                  <strong>{{ formatCurrency(summaryRow.amount) }}</strong>
                </div>
              </div>
              <div class="doc-footer-net-card">
                <span>{{ t("sell.netTotal") }}</span>
                <strong>{{ formatCurrency(totals.totalAmount) }}</strong>
              </div>

              <div v-if="(editMode || isViewOnly) && (cashPaid > 0 || paymentEntries.length)" class="payment-history-section">
                <div class="payment-history-title">
                  <i class="pi pi-wallet" />
                  <span>{{ tl("รายละเอียดการรับเงิน", "Payment Detail", "ລາຍລະອຽດການຮັບເງິນ") }}</span>
                </div>
                <div class="payment-history-list">
                  <!-- cash entries -->
                  <template v-if="cashPaid > 0">
                    <div v-for="row in cashPaidCurrencyRows" :key="row.code" class="payment-history-entry">
                      <span
                        class="ph-icon"
                        :style="{
                          background: cashCurrencyIconInfo(row.code).bg,
                          color: cashCurrencyIconInfo(row.code).color,
                        }"
                      >
                        <i :class="cashCurrencyIconInfo(row.code).icon" />
                      </span>
                      <div class="ph-text">
                        <strong>{{ t("payment.cash") }} ({{ row.code }})</strong>
                        <span
                          >{{ formatQty(row.amount) }} {{ row.label }}<template v-if="row.code !== 'THB'"> × {{ formatQty(row.rate) }}</template></span
                        >
                      </div>
                      <strong class="ph-amount">{{ formatCurrency(row.homeAmount) }}</strong>
                    </div>
                    <div v-if="!cashPaidCurrencyRows.length" class="payment-history-entry">
                      <span class="ph-icon" style="background: #fff7ed; color: #e87e2c"><i class="pi pi-money-bill" /></span>
                      <div class="ph-text">
                        <strong>{{ t("payment.cash") }}</strong>
                      </div>
                      <strong class="ph-amount">{{ formatCurrency(cashPaid) }}</strong>
                    </div>
                  </template>
                  <!-- non-cash entries -->
                  <div v-for="entry in paymentEntries" :key="entry.id" class="payment-history-entry">
                    <span
                      class="ph-icon"
                      :style="{
                        background: paymentEntryIconInfo(entry).bg,
                        color: paymentEntryIconInfo(entry).color,
                      }"
                    >
                      <i :class="paymentEntryIconInfo(entry).icon" />
                    </span>
                    <div class="ph-text">
                      <strong>{{ paymentEntryTitle(entry) }}</strong>
                      <span v-if="entry.type === 'transfer' || entry.type === 'credit_transfer'">{{ paymentEntryCurrencyDescription(entry) }}</span>
                      <span v-else-if="entry.type === 'credit'">
                        {{ entry.details?.credit_card_type || "" }}<template v-if="entry.details?.no_approved"> · {{ tl("อนุมัติ", "Appr", "ອນຸມັດ") }} {{ entry.details.no_approved }}</template
                        ><template v-if="entry.details?.charge > 0"> · {{ tl("ค่าธรรมเนียม", "Fee", "ຄ່າທຳນຽມ") }} {{ formatCurrency(paymentEntryChargeAmount(entry)) }}</template>
                      </span>
                      <span v-else-if="entry.type === 'cheque' && entry.details?.trans_number"
                        >{{ entry.details.trans_number }}<template v-if="entry.details?.chq_due_date"> · {{ tl("ครบกำหนด", "Due", "ຄົບກຳນົດ") }} {{ entry.details.chq_due_date }}</template></span
                      >
                      <span v-else>{{ paymentEntryDescription(entry) }}</span>
                    </div>
                    <strong class="ph-amount">{{ formatCurrency(paymentEntryAmount(entry)) }}</strong>
                  </div>
                  <!-- total row -->
                  <div class="payment-history-entry total-row">
                    <span class="ph-icon" style="background: transparent"><i class="pi pi-sigma" /></span>
                    <div class="ph-text">
                      <strong>{{ tl("รวมรับชำระ", "Total paid", "ລວມຮັບຊຳລະ") }}</strong>
                    </div>
                    <strong class="ph-amount">{{ formatCurrency(totalPaid) }}</strong>
                  </div>
                </div>
              </div>
            </div>
            <div class="doc-footer-block sale-benefit-compact-block">
              <div class="sale-benefit-compact-head">
                <div class="panel-title compact">
                  <i class="pi pi-tags" />
                  <strong>{{ tl("โปรโมชั่น/แคมเปญ", "Promotions/campaigns", "ໂປຣໂມຊັນ/ແຄມເປນ") }}</strong>
                </div>
                <Button :label="t('sell.showDetail')" icon="pi pi-list" outlined size="small" :disabled="!validRows.length" @click="saleBenefitDetailDialogVisible = true" />
              </div>
              <div class="sale-benefit-compact-list">
                <div>
                  <span v-if="promotionError" class="sale-benefit-error">{{ promotionError }}</span>
                  <span v-else-if="promotionAuditRows.length">{{ tl("เข้าโปรโมชั่น", "Matched promotions", "ເຂົ້າໂປຣໂມຊັນ") }} {{ promotionAuditRows.length }} {{ t("sell.items") }}</span>
                  <span v-else>{{ promotionStatusText }}</span>
                  <strong class="discount">{{ tl("ลดรวม", "Total discount", "ສ່ວນຫຼຸດລວມ") }} {{ formatCurrency(promotionDiscountAmount) }}</strong>
                </div>
                <div>
                  <span v-if="posCampaignError" class="sale-benefit-error">{{ posCampaignError }}</span>
                  <span v-else-if="posCampaignAuditRows.length">{{ tl("เข้าแคมเปญ", "Matched campaigns", "ເຂົ້າແຄມເປນ") }} {{ posCampaignAuditRows.length }} {{ t("sell.items") }}</span>
                  <span v-else>{{ posCampaignStatusText }}</span>
                  <strong class="promotion-qty"
                    >{{ tl("รวม", "Total", "ລວມ") }}
                    {{ formatQty(posCampaignTotalRights) }}
                    {{ tl("สิทธิ์", "rights", "ສິດ") }}</strong
                  >
                </div>
              </div>
            </div>
            <div class="summary-action-dock" data-font-zone="summary-actions">
              <div v-if="isViewOnly" class="doc-footer-actions">
                <Button
                  v-if="canEditSalesDocument"
                  class="status-save-btn doc-footer-main-action"
                  :label="tl('แก้ไขเอกสาร', 'Edit Document', 'ແກ້ໄຂເອກະສານ')"
                  icon="pi pi-pencil"
                  severity="warning"
                  :disabled="!docCanEdit"
                  @click="requestViewOnlyEditDocument"
                />
              </div>
              <div v-else-if="editMode && isCashSale && editDocumentDirty" class="doc-footer-actions">
                <Button
                  class="status-save-btn payment-open-btn doc-footer-main-action"
                  :label="priceRefreshing ? tl('กำลังโหลดราคา...', 'Loading prices...', 'ກຳລັງໂຫຼດລາຄາ...') : tl('รับชำระ / บันทึก', 'Pay / Save', 'ຮັບຊຳລະ / ບັນທຶກ')"
                  :icon="priceRefreshing ? 'pi pi-spin pi-spinner' : 'pi pi-lock'"
                  severity="success"
                  style="font-weight: 600; font-size: 2rem"
                  :disabled="documentLocked || !validRows.length || priceRefreshing || promotionLoading || promotionDirty"
                  @click="openPaymentDialog"
                />
              </div>
              <div v-else-if="editMode || !isCashSale" class="doc-footer-actions">
                <Button
                  class="status-save-btn doc-footer-main-action"
                  :label="saveButtonLabel"
                  icon="pi pi-save"
                  :loading="saving"
                  :disabled="!canSave || !!successDocNo || priceRefreshing || promotionLoading || promotionDirty"
                  @click="saveDocument"
                />
              </div>
              <div v-else class="doc-footer-actions">
                <Button
                  class="status-save-btn payment-open-btn doc-footer-main-action"
                  :label="priceRefreshing ? tl('กำลังโหลดราคา...', 'Loading prices...', 'ກຳລັງໂຫຼດລາຄາ...') : tl('รับชำระ / บันทึก', 'Pay / Save', 'ຮັບຊຳລະ / ບັນທຶກ')"
                  :icon="priceRefreshing ? 'pi pi-spin pi-spinner' : 'pi pi-lock'"
                  severity="success"
                  style="font-weight: 600; font-size: 2rem"
                  :disabled="documentLocked || !validRows.length || priceRefreshing || promotionLoading || promotionDirty"
                  @click="openPaymentDialog"
                />
              </div>
              <Button
                v-if="!isViewOnly"
                class="status-drawer-btn doc-footer-secondary-action"
                :label="tl('เปิดลิ้นชัก', 'Open drawer', 'ເປີດລິ້ນຊັກ')"
                icon="pi pi-inbox"
                severity="secondary"
                outlined
                :loading="cashDrawerOpening"
                :disabled="!cashDrawerAvailable || cashDrawerOpening"
                @click="openCashDrawerManual"
              />
            </div>
          </div>
        </div>
      </section>
    </Teleport>

    <Dialog
      :visible="creditApproveDialogVisible"
      :header="t('sell.approveCredit')"
      modal
      :draggable="false"
      :style="{ width: 'min(460px, 94vw)' }"
      @update:visible="creditApproveDialogVisible = $event"
    >
      <div class="credit-approve-dialog">
        <Message severity="warn" :closable="false">{{ creditApproveMessage }}</Message>
        <ul v-if="creditApproveDetails.length">
          <li v-for="detail in creditApproveDetails" :key="detail">{{ detail }}</li>
        </ul>
        <label>
          <span>{{ t("sell.approver") }}</span>
          <InputText v-model.trim="creditApproveUser" autocomplete="off" autofocus />
        </label>
        <label>
          <span>{{ tl("รหัสผ่าน", "Password", "ລະຫັດຜ່ານ") }}</span>
          <InputText v-model="creditApprovePassword" type="password" autocomplete="current-password" @keyup.enter="submitCreditApprove" />
        </label>
      </div>
      <template #footer>
        <Button :label="t('sell.cancel')" severity="secondary" text @click="creditApproveDialogVisible = false" />
        <Button :label="t('sell.approveAndSave')" icon="pi pi-check" severity="warning" :loading="saving" @click="submitCreditApprove" />
      </template>
    </Dialog>

    <Dialog
      :visible="salePolicyDialogVisible"
      :header="salePolicyDialogTitle"
      modal
      :draggable="false"
      :style="{ width: 'min(560px, 94vw)' }"
      :base-z-index="12000"
      dismissableMask="true"
      @update:visible="($event) => ($event ? (salePolicyDialogVisible = true) : closeSalePolicyDialog())"
    >
      <div class="sale-policy-dialog" :class="`is-${salePolicyDialogType}`">
        <div class="sale-policy-icon">
          <i :class="salePolicyDialogIcon" />
        </div>
        <div class="sale-policy-content">
          <p>{{ salePolicyDialogMessage }}</p>
          <ul v-if="salePolicyDialogDetails.length">
            <li v-for="detail in salePolicyDialogDetails" :key="detail">{{ detail }}</li>
          </ul>
        </div>
      </div>
      <template #footer>
        <Button v-if="salePolicyStockAdjustmentContext" :label="tl('ปรับปรุงสต๊อก', 'Adjust stock', 'ປັບປຸງສະຕ໊ອກ')" icon="pi pi-box" severity="warning" @click="openSaleStockAdjustmentPermission" />
        <Button :label="t('sell.close')" severity="secondary" text @click="closeSalePolicyDialog" />
      </template>
    </Dialog>

    <Dialog
      :visible="stockAdjustmentDialogVisible"
      :header="tl('ปรับปรุงสต๊อกจากหน้าขาย', 'Adjust stock from sale', 'ປັບປຸງສະຕ໊ອກຈາກໜ້າຂາຍ')"
      modal
      :draggable="false"
      :style="{ width: 'min(520px, 94vw)' }"
      :base-z-index="12100"
      @update:visible="($event) => ($event ? (stockAdjustmentDialogVisible = true) : closeSaleStockAdjustmentDialog())"
    >
      <div class="sale-stock-adjust-dialog">
        <Message v-if="stockAdjustmentError" severity="error" :closable="false">{{ stockAdjustmentError }}</Message>
        <Message v-if="stockAdjustmentResult" severity="success" :closable="false">
          {{
            tl(
              `บันทึกสำเร็จ เลขที่เอกสาร ${stockAdjustmentResult.adjust_doc_no || stockAdjustmentResult.doc_no || ""}`,
              `Saved successfully. Document ${stockAdjustmentResult.adjust_doc_no || stockAdjustmentResult.doc_no || ""}`,
              `ບັນທຶກສຳເລັດ ເລກທີເອກະສານ ${stockAdjustmentResult.adjust_doc_no || stockAdjustmentResult.doc_no || ""}`,
            )
          }}
        </Message>
        <div v-if="salePolicyStockAdjustmentContext && !stockAdjustmentResult" class="sale-stock-adjust-summary">
          <div>
            <span>{{ tl("สินค้า", "Product", "ສິນຄ້າ") }}</span>
            <strong>{{ salePolicyStockAdjustmentContext.item_code }}</strong>
            <small>{{ salePolicyStockAdjustmentContext.item_name }}</small>
          </div>
          <div>
            <span>{{ tl("คลัง / ที่เก็บ", "Warehouse / shelf", "ຄັງ / ບ່ອນເກັບ") }}</span>
            <strong>{{ salePolicyStockAdjustmentContext.wh_code || "-" }} / {{ salePolicyStockAdjustmentContext.shelf_code || "-" }}</strong>
            <!-- <small>{{ tl("ใช้คลังจาก POS ที่เลือกอยู่", "Uses the selected POS stock location", "ໃຊ້ຄັງຈາກ POS ທີ່ເລືອກ") }}</small> -->
          </div>
          <div>
            <span>{{ tl("คงเหลือ", "Remaining", "ຄົງເຫຼືອ") }}</span>
            <strong>{{ salePolicyStockAdjustmentContext.available_qty }} {{ salePolicyStockAdjustmentContext.unit_code }}</strong>
          </div>
          <div>
            <span>{{ tl("จำนวนที่ต้องการขาย", "Requested sale qty", "ຈຳນວນທີ່ຕ້ອງການຂາຍ") }}</span>
            <strong>{{ salePolicyStockAdjustmentContext.requested_qty }} {{ salePolicyStockAdjustmentContext.unit_code }}</strong>
          </div>
        </div>
        <label v-if="!stockAdjustmentResult" class="field">
          <span>{{ tl("จำนวนสต๊อกจริงหลังปรับปรุง", "Actual stock after adjustment", "ຈຳນວນສະຕ໊ອກຈິງຫຼັງປັບປຸງ") }}</span>
          <InputText v-model.trim="stockAdjustmentQtyText" inputmode="decimal" class="text-right" autofocus @keyup.enter="requestSaveSaleStockAdjustment" />
        </label>
      </div>
      <template #footer>
        <Button v-if="stockAdjustmentResult" :label="tl('ตกลง', 'OK', 'ຕົກລົງ')" icon="pi pi-check" @click="closeSaleStockAdjustmentDialog" />
        <template v-else>
          <Button :label="t('sell.cancel')" severity="secondary" outlined :disabled="stockAdjustmentSaving" @click="closeSaleStockAdjustmentDialog" />
          <Button :label="tl('บันทึก', 'Save', 'ບັນທຶກ')" icon="pi pi-save" severity="warning" :loading="stockAdjustmentSaving" @click="requestSaveSaleStockAdjustment" />
        </template>
      </template>
    </Dialog>

    <Dialog
      :visible="refDocWarehouseNoticeVisible"
      :header="tl('แจ้งเปลี่ยนคลังสินค้า', 'Warehouse changed', 'ແຈ້ງປ່ຽນຄັງສິນຄ້າ')"
      modal
      :draggable="false"
      :style="{ width: 'min(560px, 94vw)' }"
      :base-z-index="12000"
      @update:visible="refDocWarehouseNoticeVisible = $event"
    >
      <div class="sale-policy-dialog is-info">
        <div class="sale-policy-icon">
          <i class="pi pi-info-circle" />
        </div>
        <div class="sale-policy-content">
          <p>
            {{
              tl(
                "มีรายการที่เปลี่ยนคลังจากคลังของ POS เพราะสต๊อกไม่พอ",
                "Some items were moved from the POS warehouse because stock was insufficient.",
                "ມີບາງລາຍການທີ່ປ່ຽນຄັງຈາກຄັງ POS ເນື່ອງຈາກສະຕ໊ອກບໍ່ພໍ",
              )
            }}
          </p>
          <ul v-if="refDocWarehouseNotices.length">
            <li v-for="notice in refDocWarehouseNotices" :key="`${notice.item_code}-${notice.wh_code}`">
              {{
                tl(`สินค้า ${notice.item_name} เลือกคลัง ${notice.wh_code}`, `Item ${notice.item_name} selected warehouse ${notice.wh_code}`, `ສິນຄ້າ ${notice.item_name} ເລືອກຄັງ ${notice.wh_code}`)
              }}
            </li>
          </ul>
        </div>
      </div>
      <template #footer>
        <Button :label="tl('ตกลง', 'OK', 'ຕົກລົງ')" severity="primary" @click="refDocWarehouseNoticeVisible = false" />
      </template>
    </Dialog>

    <Dialog
      :visible="saleItemHistoryDialogVisible"
      :header="tl('ประวัติการขายสินค้า', 'Product sales history', 'ປະຫວັດການຂາຍສິນຄ້າ')"
      dismissableMask="true"
      modal
      :draggable="false"
      class="sale-item-history-dialog"
      :style="{ width: 'min(1180px, 96vw)', height: 'min(760px, 90vh)' }"
      @update:visible="saleItemHistoryDialogVisible = $event"
    >
      <div class="sale-item-history-body">
        <div class="sale-item-history-summary">
          <div>
            <span>{{ tl("สินค้า", "Product", "ສິນຄ້າ") }}</span>
            <strong>{{ saleItemHistoryLine?.item_code || "-" }}</strong>
            <small>{{ saleItemHistoryLine?.item_name || "" }}</small>
          </div>
          <div>
            <span>{{ tl("ลูกค้า", "Customer", "ລູກຄ້າ") }}</span>
            <strong>{{ custCode || "-" }}</strong>
            <small>{{ custName || "" }}</small>
          </div>
        </div>
        <Message v-if="saleItemHistoryError" severity="error" :closable="false">{{ saleItemHistoryError }}</Message>
        <DataTable v-else :value="saleItemHistoryRows" :loading="saleItemHistoryLoading" size="small" stripedRows showGridlines scrollable scrollHeight="520px" class="sale-item-history-table">
          <template #empty>
            <div class="empty-lines compact">
              {{ tl("ไม่พบประวัติการขายของลูกค้านี้กับสินค้านี้", "No sales history for this customer and product.", "ບໍ່ພົບປະຫວັດການຂາຍຂອງລູກຄ້ານີ້ກັບສິນຄ້ານີ້") }}
            </div>
          </template>
          <Column :header="tl('วันที่', 'Date', 'ວັນທີ')" style="min-width: 7rem">
            <template #body="{ data }">{{ formatSaleHistoryDate(data.doc_date) }}</template>
          </Column>
          <Column field="doc_time" :header="tl('เวลา', 'Time', 'ເວລາ')" style="min-width: 5rem" />
          <Column field="doc_no" :header="tl('เลขที่', 'Doc no.', 'ເລກທີ')" style="min-width: 10rem" />
          <Column :header="tl('คลัง/ที่เก็บ', 'Warehouse/shelf', 'ຄັງ/ບ່ອນເກັບ')" style="min-width: 8rem">
            <template #body="{ data }">{{ [data.wh_code, data.shelf_code].filter(Boolean).join(" / ") || "-" }}</template>
          </Column>
          <Column :header="tl('จำนวน', 'Qty', 'ຈຳນວນ')" bodyClass="text-right" style="min-width: 6rem">
            <template #body="{ data }">{{ formatQty(data.qty) }}</template>
          </Column>
          <Column :header="tl('หน่วย', 'Unit', 'ຫົວໜ່ວຍ')" style="min-width: 6rem">
            <template #body="{ data }">{{ data.unit_name || data.unit_code || "-" }}</template>
          </Column>
          <Column :header="tl('ราคา', 'Price', 'ລາຄາ')" bodyClass="text-right" style="min-width: 7rem">
            <template #body="{ data }">{{ formatCurrency(data.price) }}</template>
          </Column>
          <Column :header="tl('ส่วนลด', 'Discount', 'ສ່ວນຫຼຸດ')" style="min-width: 7rem">
            <template #body="{ data }">{{ data.discount || "-" }}</template>
          </Column>
          <Column :header="tl('ภาษี', 'VAT', 'ພາສີ')" style="min-width: 8rem">
            <template #body="{ data }">{{ saleHistoryVatLabel(data.vat_type) }}</template>
          </Column>
          <Column :header="tl('รวม', 'Total', 'ລວມ')" bodyClass="text-right" style="min-width: 8rem">
            <template #body="{ data }">
              <strong>{{ formatCurrency(data.sum_amount) }}</strong>
            </template>
          </Column>
        </DataTable>
      </div>
      <template #footer>
        <Button :label="tl('รีเฟรช', 'Refresh', 'ໂຫຼດໃໝ່')" icon="pi pi-refresh" severity="secondary" outlined :loading="saleItemHistoryLoading" @click="openSaleItemHistory(saleItemHistoryLine)" />
        <Button :label="t('sell.close')" severity="secondary" text @click="saleItemHistoryDialogVisible = false" />
      </template>
    </Dialog>

    <Dialog
      :visible="salePriceFormulaDialogVisible"
      :header="tl('ตารางราคาขาย', 'Sale price table', 'ຕາຕະລາງລາຄາຂາຍ')"
      modal
      dismissableMask="true"
      :draggable="false"
      class="sale-price-formula-dialog"
      :style="{ width: 'min(1180px, 96vw)', height: 'min(760px, 90vh)' }"
      @update:visible="salePriceFormulaDialogVisible = $event"
    >
      <div class="sale-price-formula-body">
        <div class="sale-item-history-summary">
          <div>
            <span>{{ tl("สินค้า", "Product", "ສິນຄ້າ") }}</span>
            <strong>{{ salePriceFormulaLine?.item_code || "-" }}</strong>
            <small>{{ salePriceFormulaLine?.item_name || "" }}</small>
          </div>
          <div>
            <span>{{ tl("ระดับราคาลูกค้า", "Customer price level", "ລະດັບລາຄາລູກຄ້າ") }}</span>
            <strong>Price {{ Number(salePriceFormulaData?.price_level || 0) }}</strong>
            <small>{{ custCode || "-" }} {{ custName || "" }}</small>
          </div>
        </div>
        <Message v-if="salePriceFormulaError" severity="error" :closable="false">{{ salePriceFormulaError }}</Message>
        <div v-else class="sale-price-formula-panels">
          <section class="sale-price-formula-panel">
            <div class="sale-price-formula-panel-head">
              <div>
                <strong>{{ tl("ตารางสูตร", "Formula table", "ຕາຕະລາງສູດ") }}</strong>
                <span>{{ tl("ค่าที่ตั้งไว้ใน price_0 ถึง price_9", "Configured values from price_0 to price_9.", "ຄ່າທີ່ຕັ້ງໄວ້ໃນ price_0 ຫາ price_9") }}</span>
              </div>
              <small>{{ tl("อ่านอย่างเดียว", "Read only", "ອ່ານເທົ່ານັ້ນ") }}</small>
            </div>
            <DataTable
              :value="salePriceFormulaData?.rows || []"
              :loading="salePriceFormulaLoading"
              size="small"
              stripedRows
              showGridlines
              scrollable
              scrollHeight="220px"
              tableStyle="min-width: 108rem"
              class="sale-price-formula-table"
            >
              <template #empty>
                <div class="empty-lines compact">
                  {{ tl("ไม่พบตารางราคาขายของสินค้านี้", "No sale price table found for this product.", "ບໍ່ພົບຕາຕະລາງລາຄາຂາຍຂອງສິນຄ້ານີ້") }}
                </div>
              </template>
              <Column field="unit_code" :header="tl('หน่วย', 'Unit', 'ຫົວໜ່ວຍ')" frozen style="min-width: 6rem" />
              <Column :header="tl('ประเภทขาย', 'Sale type', 'ປະເພດຂາຍ')" style="min-width: 7rem">
                <template #body="{ data }">{{ salePriceFormulaSaleTypeLabel(data.sale_type) }}</template>
              </Column>
              <Column :header="tl('ภาษี', 'Tax', 'ພາສີ')" style="min-width: 7rem">
                <template #body="{ data }">{{ salePriceFormulaTaxTypeLabel(data.tax_type) }}</template>
              </Column>
              <Column v-for="column in salePriceFormulaColumns" :key="`formula-${column.field}`" :header="column.label" style="min-width: 8rem">
                <template #body="{ data }">
                  <div class="sale-price-formula-cell is-formula" :class="{ 'is-customer-level': Number(column.field.replace('price_', '')) === Number(salePriceFormulaData?.price_level || 0) }">
                    <strong>{{ salePriceFormulaCell(data, column.field).formula }}</strong>
                  </div>
                </template>
              </Column>
            </DataTable>
          </section>

          <section class="sale-price-formula-panel">
            <div class="sale-price-formula-panel-head">
              <div>
                <strong>{{ tl("ตารางราคา", "Calculated price table", "ຕາຕະລາງລາຄາ") }}</strong>
                <span>{{ tl("ราคาที่ระบบคำนวณจากสูตรด้านบน", "Prices calculated from the formula table above.", "ລາຄາທີ່ລະບົບຄຳນວນຈາກສູດດ້ານເທິງ") }}</span>
              </div>
              <small>Price {{ Number(salePriceFormulaData?.price_level || 0) }}</small>
            </div>
            <DataTable
              :value="salePriceFormulaData?.rows || []"
              :loading="salePriceFormulaLoading"
              size="small"
              stripedRows
              showGridlines
              scrollable
              scrollHeight="240px"
              tableStyle="min-width: 108rem"
              class="sale-price-formula-table"
            >
              <template #empty>
                <div class="empty-lines compact">
                  {{ tl("ไม่พบตารางราคาขายของสินค้านี้", "No sale price table found for this product.", "ບໍ່ພົບຕາຕະລາງລາຄາຂາຍຂອງສິນຄ້ານີ້") }}
                </div>
              </template>
              <Column field="unit_code" :header="tl('หน่วย', 'Unit', 'ຫົວໜ່ວຍ')" frozen style="min-width: 6rem" />
              <Column :header="tl('ประเภทขาย', 'Sale type', 'ປະເພດຂາຍ')" style="min-width: 7rem">
                <template #body="{ data }">{{ salePriceFormulaSaleTypeLabel(data.sale_type) }}</template>
              </Column>
              <Column :header="tl('ภาษี', 'Tax', 'ພາສີ')" style="min-width: 7rem">
                <template #body="{ data }">{{ salePriceFormulaTaxTypeLabel(data.tax_type) }}</template>
              </Column>
              <Column v-for="column in salePriceFormulaColumns" :key="`price-${column.field}`" :header="column.label" style="min-width: 8rem">
                <template #body="{ data }">
                  <div class="sale-price-formula-cell" :class="{ 'is-customer-level': Number(column.field.replace('price_', '')) === Number(salePriceFormulaData?.price_level || 0) }">
                    <strong>{{ salePriceFormulaCell(data, column.field).calculated }}</strong>
                  </div>
                </template>
              </Column>
            </DataTable>
          </section>
        </div>
      </div>
      <template #footer>
        <Button
          :label="tl('รีเฟรช', 'Refresh', 'ໂຫຼດໃໝ່')"
          icon="pi pi-refresh"
          severity="secondary"
          outlined
          :loading="salePriceFormulaLoading"
          @click="openSalePriceFormulaInfo(salePriceFormulaLine)"
        />
        <Button :label="t('sell.close')" severity="secondary" text @click="salePriceFormulaDialogVisible = false" />
      </template>
    </Dialog>

    <Dialog :visible="saveDialogVisible" :header="saveDialogTitle" modal :draggable="false" :style="{ width: 'min(520px, 94vw)' }" @update:visible="saveDialogVisible = $event">
      <div class="save-feedback-dialog" :class="`is-${saveDialogType}`">
        <div class="save-feedback-icon">
          <i :class="saveDialogIcon" />
        </div>
        <div class="save-feedback-content">
          <p>{{ saveDialogMessage }}</p>
          <ul v-if="saveDialogDetails.length">
            <li v-for="detail in saveDialogDetails" :key="detail">{{ detail }}</li>
          </ul>
        </div>
      </div>
      <template #footer>
        <Button v-if="saveDialogPrimaryAction" :label="saveDialogPrimaryLabel || t('sell.continue')" icon="pi pi-check" :severity="saveDialogPrimarySeverity" @click="runSaveDialogPrimaryAction" />
        <Button
          v-if="saveDialogType === 'warn' && saveDialogShowPaymentReviewAction"
          :label="tl('ยืนยันยอดชำระถูกต้อง', 'Confirm payment is correct', 'ຢືນຢັນຍອດຊຳລະຖືກຕ້ອງ')"
          icon="pi pi-check"
          severity="warning"
          outlined
          @click="
            confirmPaymentReview();
            saveDialogVisible = false;
          "
        />
        <Button v-if="saveDialogType === 'success' && successDocNo" :label="t('sell.newDocument')" icon="pi pi-plus" severity="secondary" outlined @click="newDocument" />
        <Button
          v-if="saveDialogType === 'success' && successDocNo"
          :label="tl('พิมพ์ฟอร์ม', 'Print forms', 'ພິມຟອມ')"
          icon="pi pi-print"
          @click="
            saveDialogVisible = false;
            openPrintDialog();
          "
        />
        <Button :label="t('sell.close')" severity="secondary" text @click="saveDialogVisible = false" />
      </template>
    </Dialog>

    <Dialog
      :visible="promotionGuideDialogVisible"
      :header="tl('โปรโมชั่นที่เกี่ยวข้อง', 'Related promotions', 'ໂປຣໂມຊັນທີ່ກ່ຽວຂ້ອງ')"
      modal
      :draggable="false"
      :style="{ width: 'min(820px, 94vw)' }"
      :pt="{
        root: { 'data-font-zone': 'promotion-detail-dialog' },
        header: { 'data-font-zone': 'promotion-detail-dialog' },
        content: { 'data-font-zone': 'promotion-detail-dialog' },
        footer: { 'data-font-zone': 'promotion-detail-dialog' },
      }"
      @update:visible="promotionGuideDialogVisible = $event"
    >
      <Accordion v-if="promotionGuideDialogPromotions.length" class="promotion-guide-accordion" data-font-zone="promotion-detail-dialog">
        <AccordionPanel v-for="(promotion, index) in promotionGuideDialogPromotions" :key="promotion.promotion_code" :value="String(index)">
          <AccordionHeader>
            <div class="promotion-guide-accordion-title">
              <strong>{{ promotion.promotion_code }}</strong>
              <span>{{ promotion.promotion_name }}</span>
              <small :class="{ active: promotion.is_applied }">
                {{ promotion.is_applied ? tl("เข้าเงื่อนไขแล้ว", "Matched", "ເຂົ້າເງື່ອນໄຂແລ້ວ") : tl("ยังไม่เข้าเงื่อนไข", "Not matched", "ຍັງບໍ່ເຂົ້າເງື່ອນໄຂ") }}
              </small>
            </div>
          </AccordionHeader>
          <AccordionContent>
            <div class="promotion-guide-card">
              <section class="promotion-guide-section">
                <span class="promotion-guide-section-title" style="color: darkgreen">{{ tl("สินค้าเงื่อนไข", "Condition products", "ສິນຄ້າເງື່ອນໄຂ") }}</span>
                <div v-if="promotion.condition_items?.length" class="promotion-guide-items">
                  <div
                    v-for="item in promotion.condition_items"
                    :key="`${promotion.promotion_code}-condition-${item.item_code}-${item.unit_code}-${item.group_number}`"
                    class="promotion-guide-item"
                    :class="{ matched: item.is_in_cart }"
                  >
                    <strong>{{ item.item_code }}</strong>
                    <span>{{ item.item_name || "-" }}</span>
                    <small>
                      {{ item.unit_code || "-" }}
                      <template v-if="toNumber(item.required_qty) > 0"> · {{ tl("เงื่อนไข", "Required", "ເງື່ອນໄຂ") }} {{ formatQty(item.required_qty) }}</template>
                    </small>
                  </div>
                </div>
                <div v-else class="promotion-guide-empty">
                  {{ tl("ไม่มีรายการสินค้าเงื่อนไข", "No condition products", "ບໍ່ມີລາຍການສິນຄ້າເງື່ອນໄຂ") }}
                </div>
              </section>

              <section class="promotion-guide-section">
                <span class="promotion-guide-section-title" style="color: crimson">{{ tl("ผลโปรโมชั่น", "Promotion result", "ຜົນໂປຣໂມຊັນ") }}</span>
                <div v-if="promotion.action_effects?.length" class="promotion-guide-items">
                  <div v-for="effect in promotion.action_effects" :key="`${promotion.promotion_code}-effect-${effect.type}-${effect.command}`" class="promotion-guide-item reward">
                    <strong>{{ effect.type === "discount" ? tl("ส่วนลด", "Discount", "ສ່ວນຫຼຸດ") : tl("ยอดเพิ่ม", "Extra amount", "ຍອດເພີ່ມ") }}</strong>
                    <span>{{ effect.type === "discount" ? `${tl("ลด", "Discount", "ຫຼຸດ")} ${formatCurrency(Math.abs(toNumber(effect.amount)))}` : formatCurrency(effect.amount) }}</span>
                    <small v-if="toNumber(effect.qty) > 0">{{ tl("จำนวนครั้ง", "Times", "ຈຳນວນຄັ້ງ") }} {{ formatQty(effect.qty) }}</small>
                  </div>
                </div>
                <div v-if="promotion.action_items?.length" class="promotion-guide-items">
                  <div v-for="item in promotion.action_items" :key="`${promotion.promotion_code}-action-${item.item_code}-${item.unit_code}`" class="promotion-guide-item action">
                    <strong>{{ item.item_code }}</strong>
                    <span>{{ item.item_name || "-" }}</span>
                    <small>
                      {{ item.unit_code || "-" }}
                      <template v-if="toNumber(item.qty) > 0"> · {{ tl("จำนวน", "Qty", "ຈຳນວນ") }} {{ formatQty(item.qty) }}</template>
                    </small>
                  </div>
                </div>
                <div v-if="!promotion.action_effects?.length && !promotion.action_items?.length" class="promotion-guide-empty">
                  {{ tl("โปรโมชั่นนี้ไม่มีสินค้าแถมหรือส่วนลดที่แสดงได้", "This promotion has no displayable free items or discounts", "ໂປຣໂມຊັນນີ້ບໍ່ມີສິນຄ້າແຖມ ຫຼື ສ່ວນຫຼຸດທີ່ສະແດງໄດ້") }}
                </div>
              </section>
            </div>
          </AccordionContent>
        </AccordionPanel>
      </Accordion>
      <div v-else class="empty-lines" data-font-zone="promotion-detail-dialog">
        {{ tl("ไม่มีโปรโมชั่นที่ใช้งานได้สำหรับสินค้านี้", "No available promotions for this product", "ບໍ່ມີໂປຣໂມຊັນທີ່ໃຊ້ໄດ້ສຳລັບສິນຄ້ານີ້") }}
      </div>
      <template #footer>
        <div data-font-zone="promotion-detail-dialog">
          <Button :label="t('sell.close')" severity="secondary" text @click="promotionGuideDialogVisible = false" />
        </div>
      </template>
    </Dialog>

    <Dialog
      :visible="saleBenefitDetailDialogVisible"
      :header="tl('รายละเอียดโปรโมชั่นและแคมเปญ', 'Promotion and campaign details', 'ລາຍລະອຽດໂປຣໂມຊັນ ແລະ ແຄມເປນ')"
      modal
      :draggable="false"
      class="sale-benefit-detail-dialog"
      :style="{ width: 'min(1180px, 96vw)', height: 'min(760px, 90vh)' }"
      :pt="{
        root: { 'data-font-zone': 'promotion-detail-dialog' },
        header: { 'data-font-zone': 'promotion-detail-dialog' },
        content: { 'data-font-zone': 'promotion-detail-dialog' },
        footer: { 'data-font-zone': 'promotion-detail-dialog' },
      }"
      @update:visible="saleBenefitDetailDialogVisible = $event"
    >
      <div class="sale-benefit-detail-body" data-font-zone="promotion-detail-dialog">
        <div class="grid sale-benefit-detail-grid">
          <section class="col-12 lg:col-6">
            <div class="sale-benefit-detail-section promotion-status-panel" :class="promotionStatusClass">
              <div class="sale-benefit-detail-head">
                <div>
                  <span>{{ t("sell.promotionStatus") }}</span>
                  <strong>{{ promotionStatusText }}</strong>
                  <small v-if="promotionLastCalculatedAt">{{ t("sell.lastCalculated", { time: promotionLastCalculatedAt }) }}</small>
                </div>
                <strong class="discount">-{{ formatCurrency(promotionDiscountAmount) }}</strong>
              </div>

              <Message v-if="promotionError" severity="error" :closable="false">
                {{ tl("ยังบันทึกไม่ได้ เพราะยังคำนวณโปรโมชั่นไม่สำเร็จ", "Cannot save because promotion calculation failed", "ຍັງບັນທຶກບໍ່ໄດ້ ເພາະຄຳນວນໂປຣໂມຊັນບໍ່ສຳເລັດ") }}:
                {{ promotionError }}
              </Message>
              <div v-else-if="promotionStatus === 'success' && !promotionAuditRows.length" class="empty-lines compact">
                {{ t("sell.promotionNoMatch") }}
              </div>
              <div v-else-if="!promotionAuditRows.length" class="empty-lines compact">
                {{ tl("ยังไม่มีรายละเอียดโปรโมชั่น", "No promotion detail yet", "ຍັງບໍ່ມີລາຍລະອຽດໂປຣໂມຊັນ") }}
              </div>

              <div v-if="promotionAuditRows.length" class="promotion-audit-list sale-benefit-detail-list">
                <article v-for="promotion in promotionAuditRows" :key="promotion.key" class="promotion-audit-card">
                  <div class="promotion-audit-main">
                    <div>
                      <span class="promotion-code">{{ promotion.code || "-" }}</span>
                      <strong>{{ promotion.name }}</strong>
                    </div>
                    <strong class="discount">-{{ formatCurrency(promotion.amount) }}</strong>
                  </div>
                  <div class="promotion-audit-meta">
                    <span>{{ tl("จำนวนครั้ง", "Times", "ຈຳນວນຄັ້ງ") }} {{ formatQty(promotion.qty || promotion.count || 0) }}</span>
                    <span>{{ tl("ยอดลด", "Discount", "ຍອດຫຼຸດ") }} {{ formatCurrency(promotion.amount) }}</span>
                  </div>
                  <div class="promotion-related">
                    <span>{{ tl("สินค้าที่เกี่ยวข้อง", "Related products", "ສິນຄ້າທີ່ກ່ຽວຂ້ອງ") }}</span>
                    <div v-if="promotion.relatedItems.length" class="promotion-related-list">
                      <small v-for="item in promotion.relatedItems" :key="`${promotion.key}-${item.item_code}-${item.unit_code}`">
                        {{ item.item_code }} {{ item.item_name }} / {{ item.unit_code || "-" }} x {{ formatQty(item.qty) }}
                      </small>
                    </div>
                    <small v-else class="promotion-related-empty">{{
                      tl("ยังไม่มีรายละเอียดสินค้าจากผลลัพธ์โปรโมชั่น", "No product detail from promotion result yet", "ຍັງບໍ່ມີລາຍລະອຽດສິນຄ້າຈາກຜົນໂປຣໂມຊັນ")
                    }}</small>
                  </div>
                </article>
              </div>
            </div>
          </section>

          <section class="col-12 lg:col-6">
            <div class="sale-benefit-detail-section receipt-campaign-panel" :class="posCampaignStatusClass">
              <div class="sale-benefit-detail-head">
                <div>
                  <span>{{ t("sell.posCampaign") }}</span>
                  <strong>{{ posCampaignStatusText }}</strong>
                  <small v-if="posCampaignLastCalculatedAt">{{ t("sell.lastChecked", { time: posCampaignLastCalculatedAt }) }}</small>
                </div>
                <strong class="promotion-qty">{{ formatQty(posCampaignTotalRights) }} {{ tl("สิทธิ์", "rights", "ສິດ") }}</strong>
              </div>

              <Message v-if="posCampaignError" severity="error" :closable="false">
                {{ tl("ยังบันทึกไม่ได้ เพราะยังตรวจแคมเปญท้ายใบเสร็จไม่สำเร็จ", "Cannot save because receipt campaign check failed", "ຍັງບັນທຶກບໍ່ໄດ້ ເພາະກວດແຄມເປນທ້າຍໃບຮັບບໍ່ສຳເລັດ") }}:
                {{ posCampaignError }}
              </Message>
              <div v-else-if="posCampaignStatus === 'success' && !posCampaignAuditRows.length" class="empty-lines compact">
                {{ t("sell.campaignNoMatch") }}
              </div>
              <div v-else-if="!posCampaignAuditRows.length" class="empty-lines compact">
                {{ tl("ยังไม่มีรายละเอียดแคมเปญ", "No campaign detail yet", "ຍັງບໍ່ມີລາຍລະອຽດແຄມເປນ") }}
              </div>

              <div v-if="posCampaignAuditRows.length" class="promotion-audit-list sale-benefit-detail-list">
                <article v-for="campaign in posCampaignAuditRows" :key="campaign.key" class="promotion-audit-card">
                  <div class="promotion-audit-main">
                    <div>
                      <span class="promotion-code">{{ campaign.campaign_code || "-" }}</span>
                      <strong>{{ campaign.campaign_name || campaign.display_wording || t("sell.posCampaign") }}</strong>
                    </div>
                    <strong class="promotion-qty">{{ formatQty(campaign.qty) }} {{ tl("สิทธิ์", "rights", "ສິດ") }}</strong>
                  </div>
                  <div class="promotion-audit-meta">
                    <span>{{ tl("ยอดเข้าเงื่อนไข", "Matched amount", "ຍອດເຂົ້າເງື່ອນໄຂ") }} {{ formatCurrency(campaign.match_amount) }}</span>
                    <span>{{ tl("เกณฑ์ต่อสิทธิ์", "Amount per right", "ເກນຕໍ່ສິດ") }} {{ formatCurrency(campaign.sale_amount) }}</span>
                  </div>
                  <div class="promotion-related">
                    <small>{{ campaign.display_wording || "-" }}</small>
                  </div>
                </article>
              </div>
            </div>
          </section>
        </div>
      </div>
      <template #footer>
        <div data-font-zone="promotion-detail-dialog">
          <Button :label="t('sell.close')" severity="secondary" text @click="saleBenefitDetailDialogVisible = false" />
        </div>
      </template>
    </Dialog>

    <Dialog
      :visible="heldBillDialogVisible"
      :header="tl('บิลพัก', 'Held bills', 'ບິນພັກ')"
      modal
      :draggable="false"
      class="held-bill-dialog"
      :style="{ width: 'min(860px, 96vw)' }"
      :pt="{
        root: { 'data-font-zone': 'held-bill-dialog' },
        header: { 'data-font-zone': 'held-bill-dialog' },
        content: { 'data-font-zone': 'held-bill-dialog' },
        footer: { 'data-font-zone': 'held-bill-dialog' },
      }"
      @update:visible="heldBillDialogVisible = $event"
    >
      <div class="held-bill-dialog-body" data-font-zone="held-bill-dialog">
        <div class="held-bill-toolbar">
          <div>
            <strong>{{ heldBills.length }} {{ tl("บิล", "bills", "ບິນ") }}</strong>
            <span>{{ tl("รายการที่พักไว้ในเครื่องนี้", "Held on this device", "ລາຍການທີ່ພັກໄວ້ໃນເຄື່ອງນີ້") }}</span>
          </div>
          <div class="held-bill-toolbar-actions">
            <Button :label="tl('รีเฟรช', 'Refresh', 'ໂຫຼດໃໝ່')" icon="pi pi-refresh" severity="secondary" outlined @click="refreshHeldBills" />
            <Button :label="tl('ลบทั้งหมด', 'Delete all', 'ລຶບທັງໝົດ')" icon="pi pi-trash" severity="danger" outlined :disabled="!heldBills.length" @click="removeAllHeldBills" />
          </div>
        </div>
        <div v-if="!heldBills.length" class="empty-lines">
          {{ tl("ยังไม่มีบิลพักในเครื่องนี้", "No held bills on this device", "ຍັງບໍ່ມີບິນພັກໃນເຄື່ອງນີ້") }}
        </div>
        <div v-else class="held-bill-list">
          <article v-for="entry in heldBills" :key="entry.id" class="held-bill-item">
            <div class="held-bill-content">
              <div class="held-bill-title-row">
                <strong>{{ entry.id }}</strong>
                <b>{{ formatCurrency(entry.summary?.total_amount) }}</b>
              </div>
              <small>{{ heldBillSummaryText(entry) }}</small>
              <small v-if="heldBillEmployeeText(entry)" class="held-bill-employee">{{ heldBillEmployeeText(entry) }}</small>
              <small>{{ formatHeldBillTimestamp(entry.updated_at) }}</small>
            </div>
            <div class="held-bill-actions">
              <Button :label="tl('ทำต่อ', 'Resume', 'ເຮັດຕໍ່')" icon="pi pi-play" size="small" @click="resumeHeldBill(entry.id)" />
              <Button :label="tl('ลบ', 'Delete', 'ລຶບ')" icon="pi pi-trash" size="small" severity="danger" outlined @click="removeHeldBill(entry.id)" />
            </div>
          </article>
        </div>
      </div>
      <template #footer>
        <div data-font-zone="held-bill-dialog">
          <Button :label="t('sell.close')" severity="secondary" text @click="heldBillDialogVisible = false" />
        </div>
      </template>
    </Dialog>

    <Dialog
      :visible="customerDialogVisible"
      :header="t('sell.customerSearch')"
      modal
      :draggable="false"
      :style="{ width: 'min(1180px, 96vw)', height: 'min(760px, 92vh)' }"
      :pt="{
        root: { 'data-font-zone': 'customer-dialog' },
        header: { 'data-font-zone': 'customer-dialog' },
        content: { 'data-font-zone': 'customer-dialog' },
      }"
      @update:visible="customerDialogVisible = $event"
    >
      <div class="entity-dialog-body" data-font-zone="customer-dialog">
        <div class="dialog-search-row">
          <InputText
            v-model.trim="custSearch"
            data-testid="sale-customer-search"
            :placeholder="t('sell.customerPlaceholder')"
            autofocus
            :disabled="documentLocked"
            @update:model-value="searchCustomers"
            @keyup.enter="loadCustomers"
          />
          <Button :label="t('common.search')" icon="pi pi-search" :loading="custLoading" :disabled="documentLocked" @click="loadCustomers" />
          <Button :label="t('sell.walkIn')" icon="pi pi-refresh" severity="secondary" outlined :disabled="documentLocked" @click="selectWalkIn" />
        </div>
        <!-- <div v-if="custResults.length" class="customer-filter-row">
          <SelectButton v-model="customerDialogFilter" :options="customerDialogFilterOptions" option-label="label" option-value="value" :allow-empty="false" />
          <small>{{ filteredCustomerResults.length }} / {{ custResults.length }}</small>
        </div> -->
        <div v-if="custLoading" class="lookup-hint">{{ t("common.loadingSearch") }}</div>
        <div v-else-if="filteredCustomerResults.length" class="dialog-result-list">
          <button
            v-for="customer in filteredCustomerResults"
            :key="customer.row_key || `${customer.code || ''}|${customer.member_code || customer.dealer_code || ''}|${customer.mobile_phone || ''}`"
            type="button"
            :disabled="documentLocked"
            @click="selectCustomer(customer)"
          >
            <strong
              >{{ customer.code }}<template v-if="customer.member_code"> / {{ customer.member_code }}</template></strong
            >
            <span>{{ customer.name || customer.name_1 }}</span>
            <span class="customer-type-tag" :class="customerHasMember(customer) ? 'is-member' : 'is-non-member'">
              {{ customerHasMember(customer) ? tl("มีสมาชิก", "Member", "ມີສະມາຊິກ") : tl("ไม่มีสมาชิก", "No member", "ບໍ່ມີສະມາຊິກ") }}
            </span>
            <small v-if="customer.mobile_phone || customer.telephone">{{ customer.mobile_phone || customer.telephone }}</small>
          </button>
        </div>
        <div v-else class="empty-lines">
          {{ custSearch ? t("sell.customerNotFound") : t("sell.customerHint") }}
        </div>
      </div>
    </Dialog>

    <Dialog
      :visible="employeeDialogVisible"
      :header="t('sell.employeeSearch')"
      modal
      :draggable="false"
      style="display: flex; flex-direction: column; pointer-events: auto; width: min(1180px, 96vw); height: min(760px, 92vh)"
      :pt="{
        root: { 'data-font-zone': 'employee-dialog' },
        header: { 'data-font-zone': 'employee-dialog' },
        content: { 'data-font-zone': 'employee-dialog' },
      }"
      @update:visible="employeeDialogVisible = $event"
    >
      <div class="entity-dialog-body" data-font-zone="employee-dialog">
        <div class="dialog-search-row">
          <InputText
            v-model.trim="saleSearch"
            data-testid="sale-employee-search"
            :placeholder="t('sell.employeePlaceholder')"
            autofocus
            :disabled="documentLocked"
            @update:model-value="searchEmployees"
            @keyup.enter="loadEmployees"
          />
          <Button :label="t('common.search')" icon="pi pi-search" :loading="saleLoading" :disabled="documentLocked" @click="loadEmployees" />
          <Button :label="t('sell.defaultEmployee')" icon="pi pi-refresh" severity="secondary" outlined :disabled="documentLocked" @click="resetEmployeeToDefault" />
        </div>
        <div v-if="saleLoading" class="lookup-hint">{{ t("common.loadingSearch") }}</div>
        <div v-else-if="saleResults.length" class="dialog-result-list">
          <button v-for="employee in saleResults" :key="employee.code" type="button" :disabled="documentLocked" @click="selectEmployee(employee)">
            <strong>{{ employee.code }}</strong>
            <span>{{ employeeDisplayLabel(employee) }}</span>
          </button>
        </div>
        <div v-else class="empty-lines">
          {{ saleSearch ? t("sell.employeeNotFound") : t("sell.employeeHint") }}
        </div>
      </div>
    </Dialog>

    <Dialog :visible="priceEditorVisible" :header="t('sell.editPrice')" modal :draggable="false" :style="{ width: 'min(380px, 94vw)' }" @update:visible="priceEditorVisible = $event">
      <div class="line-edit-dialog">
        <div class="line-edit-title">
          <strong>{{ priceEditLine?.item_name || "-" }}</strong>
          <span>{{ priceEditLine?.item_code || "" }} / {{ priceEditLine?.unit_code || "" }}</span>
        </div>
        <label class="field">
          <span>{{ t("sell.price") }}</span>
          <InputNumber v-model="priceEditValue" input-class="text-right" :min="0" :min-fraction-digits="2" :max-fraction-digits="2" autofocus />
        </label>
      </div>
      <template #footer>
        <Button :label="t('sell.cancel')" severity="secondary" outlined @click="priceEditorVisible = false" />
        <Button :label="t('sell.save')" icon="pi pi-check" @click="confirmPriceEditor" />
      </template>
    </Dialog>

    <Dialog :visible="remarkEditorVisible" :header="t('sell.lineRemark')" modal :draggable="false" :style="{ width: 'min(520px, 94vw)' }" @update:visible="remarkEditorVisible = $event">
      <div class="line-edit-dialog">
        <div class="line-edit-title">
          <strong>{{ remarkEditLine?.item_name || "-" }}</strong>
          <span>{{ remarkEditLine?.item_code || "" }} / {{ remarkEditLine?.unit_code || "" }}</span>
        </div>
        <label class="field">
          <span>{{ t("sell.remark") }}</span>
          <Textarea v-model.trim="remarkEditText" rows="4" auto-resize autofocus />
        </label>
      </div>
      <template #footer>
        <Button :label="t('sell.clear')" severity="secondary" text @click="remarkEditText = ''" />
        <Button :label="t('sell.cancel')" severity="secondary" outlined @click="remarkEditorVisible = false" />
        <Button :label="t('sell.save')" icon="pi pi-check" @click="confirmRemarkEditor" />
      </template>
    </Dialog>

    <Dialog
      :visible="nameEditorVisible"
      :header="tl('แก้ไขชื่อสินค้า/รายละเอียด', 'Edit product name/detail', 'ແກ້ໄຂຊື່ສິນຄ້າ/ລາຍລະອຽດ')"
      modal
      :draggable="false"
      :style="{ width: 'min(520px, 94vw)' }"
      @update:visible="nameEditorVisible = $event"
    >
      <div class="line-edit-dialog">
        <div class="line-edit-title">
          <strong>{{ nameEditLine?.item_code || "-" }}</strong>
          <span>{{ nameEditLine?.unit_code || "" }}</span>
        </div>
        <label class="field">
          <span>{{ tl("ชื่อสินค้า / รายละเอียด", "Product name / detail", "ຊື່ສິນຄ້າ / ລາຍລະອຽດ") }}</span>
          <Textarea v-model="nameEditText" rows="3" auto-resize autofocus />
        </label>
      </div>
      <template #footer>
        <Button :label="t('sell.cancel')" severity="secondary" outlined @click="nameEditorVisible = false" />
        <Button :label="t('sell.save')" icon="pi pi-check" :disabled="!String(nameEditText).trim()" @click="confirmNameEditor" />
      </template>
    </Dialog>

    <Dialog
      :visible="discountEditorVisible"
      :header="tl('ส่วนลด', 'Discount', 'ສ່ວນຫຼຸດ')"
      modal
      :draggable="false"
      :style="{ width: 'min(420px, 94vw)' }"
      @update:visible="discountEditorVisible = $event"
    >
      <div class="line-edit-dialog">
        <div class="line-edit-title">
          <strong>{{ discountEditLine?.item_name || "-" }}</strong>
          <span>{{ discountEditLine?.item_code || "" }} / {{ discountEditLine?.unit_code || "" }}</span>
        </div>
        <label class="field">
          <span>{{ tl("ส่วนลด", "Discount", "ສ່ວນຫຼຸດ") }}</span>
          <InputText v-model.trim="discountEditText" inputmode="decimal" class="text-right" autofocus @keyup.enter="confirmDiscountEditor" />
        </label>
      </div>
      <template #footer>
        <Button :label="t('sell.clear')" severity="secondary" text @click="discountEditText = ''" />
        <Button :label="t('sell.cancel')" severity="secondary" outlined @click="discountEditorVisible = false" />
        <Button :label="t('sell.save')" icon="pi pi-check" @click="confirmDiscountEditor" />
      </template>
    </Dialog>

    <Dialog
      :visible="billDiscountEditorVisible"
      :header="tl('ส่วนลดท้ายบิล', 'Bill discount', 'ສ່ວນຫຼຸດທ້າຍບິນ')"
      modal
      :draggable="false"
      :style="{ width: 'min(420px, 94vw)' }"
      @update:visible="billDiscountEditorVisible = $event"
    >
      <div class="line-edit-dialog">
        <label class="field">
          <span>{{ t("sell.billDiscount") }}</span>
          <InputText v-model.trim="billDiscountEditText" inputmode="decimal" class="text-right" autofocus @keyup.enter="confirmBillDiscountEditor" />
        </label>
      </div>
      <template #footer>
        <Button :label="t('sell.clear')" severity="secondary" text @click="billDiscountEditText = ''" />
        <Button :label="t('sell.cancel')" severity="secondary" outlined @click="billDiscountEditorVisible = false" />
        <Button :label="t('sell.save')" icon="pi pi-check" @click="confirmBillDiscountEditor" />
      </template>
    </Dialog>

    <Dialog
      :visible="pricePermissionDialogVisible"
      :header="pricePermissionHeader || tl('ยืนยันสิทธิ์', 'Authorize action', 'ຢືນຢັນສິດ')"
      modal
      :draggable="false"
      class="price-permission-dialog"
      :style="{ width: 'min(460px, 94vw)' }"
      @update:visible="($event) => ($event ? (pricePermissionDialogVisible = true) : closePricePermissionDialog())"
    >
      <div class="permission-dialog-body">
        <div class="permission-dialog-intro">
          <i class="pi pi-lock" />
          <div>
            <strong>{{ pricePermissionActionLabel }}</strong>
            <span>{{ pricePermissionHelpText }}</span>
          </div>
        </div>
        <Message v-if="pricePermissionError" severity="warn" :closable="false">{{ pricePermissionError }}</Message>
        <label class="field">
          <span>{{ tl("รหัสผู้ใช้", "User code", "ລະຫັດຜູ້ໃຊ້") }}</span>
          <InputText v-model.trim="pricePermissionUser" autofocus autocomplete="off" @keyup.enter="submitPricePermission" />
        </label>
        <label class="field">
          <span>{{ tl("รหัสผ่าน", "Password", "ລະຫັດຜ່ານ") }}</span>
          <InputText v-model="pricePermissionPassword" type="text" autocomplete="off" class="input-mask-password" @keyup.enter="submitPricePermission" />
        </label>
      </div>
      <template #footer>
        <Button :label="t('sell.cancel')" severity="secondary" outlined :disabled="pricePermissionLoading" @click="closePricePermissionDialog" />
        <Button :label="tl('ยืนยัน', 'Authorize', 'ຢືນຢັນ')" icon="pi pi-check" :loading="pricePermissionLoading" @click="submitPricePermission" />
      </template>
    </Dialog>

    <Dialog
      :visible="unitEditorVisible"
      modal
      :draggable="false"
      class="line-unit-dialog"
      :style="{ width: 'min(780px, 94vw)' }"
      @update:visible="($event) => ($event ? (unitEditorVisible = true) : closeUnitEditor())"
    >
      <template #header>
        <div class="product-search-header">
          <div class="product-search-header-icon">
            <i class="pi pi-box" />
          </div>
          <div class="product-search-header-text">
            <strong>{{ tl("เลือกหน่วยนับ", "Select unit", "ເລືອກໜ່ວຍນັບ") }}</strong>
            <span>{{ tl("เลือกหน่วยขายของรายการสินค้า", "Choose the sale unit for this line item", "ເລືອກໜ່ວຍຂາຍຂອງລາຍການສິນຄ້າ") }}</span>
          </div>
        </div>
      </template>
      <div class="line-edit-dialog unit-edit-dialog">
        <div class="unit-product-summary">
          <span class="result-image">
            <img
              v-if="unitEditLine?.item_code"
              :src="getProductImageUrl(unitEditLine.item_code)"
              :alt="unitEditLine?.item_name || unitEditLine?.item_code"
              loading="lazy"
              @error="$event.target.style.display = 'none'"
            />
            <i class="pi pi-box" />
          </span>
          <div>
            <strong>{{ unitEditLine?.item_name || "-" }}</strong>
            <small>{{ unitEditLine?.item_code || "" }} / {{ unitEditLine?.barcode || "-" }}</small>
          </div>
          <span class="unit-current-badge">{{ unitEditLine?.unit_code || "-" }}</span>
        </div>
        <div v-if="unitEditLoading" class="unit-option-loading">
          <i class="pi pi-spin pi-spinner" />
          <span>{{ tl("กำลังโหลดหน่วยนับ", "Loading units", "ກຳລັງໂຫຼດໜ່ວຍນັບ") }}...</span>
        </div>
        <Message v-else-if="unitEditError" severity="warn" :closable="false">{{ unitEditError }}</Message>
        <div v-else class="unit-option-list">
          <button
            v-for="unit in unitEditOptions"
            :key="unitOptionKey(unit)"
            type="button"
            class="unit-option-row"
            :class="{ active: unitOptionKey(unit) === unitEditSelectedKey }"
            @click="unitEditSelectedKey = unitOptionKey(unit)"
          >
            <div class="unit-option-main">
              <strong>{{ unit.unit_code || "-" }}</strong>
              <span>{{ unit.barcode || "-" }}</span>
            </div>
            <div class="unit-option-meta">
              <span
                >{{ tl("คงเหลือ", "Remaining", "ຄົງເຫຼືອ") }}
                {{ formatQty(Number(unit.balance_qty ?? unitBaseBalance(unit) / unitRatio(unit))) }}
                {{ unit.unit_code || "" }}</span
              >
              <b>{{ formatCurrency(unit.price) }}</b>
            </div>
            <i :class="unitOptionKey(unit) === unitEditSelectedKey ? 'pi pi-check-circle' : 'pi pi-circle'" />
          </button>
        </div>
      </div>
      <template #footer>
        <Button :label="t('sell.cancel')" severity="secondary" outlined :disabled="unitEditSaving" @click="closeUnitEditor" />
        <Button :label="t('sell.save')" icon="pi pi-check" :loading="unitEditSaving" :disabled="unitEditLoading || !unitEditSelectedUnit" @click="confirmUnitEditor" />
      </template>
    </Dialog>

    <Dialog :visible="whPickerVisible" modal :draggable="false" class="line-unit-dialog" :style="{ width: 'min(780px, 94vw)' }" @update:visible="($event) => ($event ? null : closeWhPicker())">
      <template #header>
        <div class="product-search-header">
          <div class="product-search-header-icon">
            <i class="pi pi-warehouse" />
          </div>
          <div class="product-search-header-text">
            <strong>{{ tl("เลือกคลังสินค้า", "Select warehouse", "ເລືອກຄັງສິນຄ້າ") }}</strong>
            <span>{{ whPickerLine?.item_name || whPickerLine?.item_code || "" }}</span>
          </div>
        </div>
      </template>
      <div class="line-edit-dialog unit-edit-dialog">
        <InputText v-model="whPickerSearch" :placeholder="tl('ค้นหาคลัง...', 'Search warehouse...', 'ຄົ້ນຫາຄັງ...')" class="w-full mb-3" autofocus />
        <Message v-if="whPickerBalanceError" severity="warn" :closable="false" class="mb-3">
          {{ whPickerBalanceError }}
        </Message>
        <div class="unit-option-list">
          <button
            v-for="wh in whPickerFiltered"
            :key="wh.code"
            type="button"
            class="unit-option-row"
            :class="{
              active: wh.code === whPickerLine?.wh_code,
              insufficient: whPickerWarehouseInsufficient(wh.code) || !isSaleWarehouseAllowed(wh.code),
            }"
            :disabled="whPickerSaving || whPickerWarehouseInsufficient(wh.code) || !isSaleWarehouseAllowed(wh.code)"
            @click="pickWarehouse(wh.code)"
          >
            <div class="unit-option-main">
              <strong>{{ wh.code }}</strong>
              <span>{{ wh.name_1 || "" }}</span>
            </div>
            <div class="warehouse-balance-summary">
              <small>{{ tl("คงเหลือ", "Balance", "ຄົງເຫຼືອ") }}</small>
              <strong>{{ whPickerBalanceLabel(wh.code) }}</strong>
              <span v-if="!isSaleWarehouseAllowed(wh.code)">{{ tl("ขายไม่ได้", "Not allowed", "ຂາຍບໍ່ໄດ້") }}</span>
              <span v-if="whPickerWarehouseInsufficient(wh.code)">{{ tl("ไม่พอ", "Insufficient", "ບໍ່ພໍ") }}</span>
            </div>
            <i :class="wh.code === whPickerLine?.wh_code ? 'pi pi-check-circle' : 'pi pi-circle'" />
          </button>
          <div v-if="!whPickerFiltered.length" class="unit-option-loading">
            <span>{{ tl("ไม่พบคลังที่มียอดคงเหลือ", "No warehouse with remaining stock found", "ບໍ່ພົບຄັງທີ່ມີຍອດຄົງເຫຼືອ") }}</span>
          </div>
        </div>
      </div>
      <template #footer>
        <Button :label="t('sell.cancel')" severity="secondary" outlined :disabled="whPickerSaving" @click="closeWhPicker" />
      </template>
    </Dialog>

    <Dialog
      :visible="productDialogVisible"
      modal
      dismissableMask="true"
      :draggable="false"
      class="product-search-dialog"
      :pt="{
        root: { 'data-font-zone': 'product-search-dialog' },
        header: { style: 'display:none', 'data-font-zone': 'product-search-dialog' },
        content: { 'data-font-zone': 'product-search-dialog' },
        footer: { 'data-font-zone': 'product-search-dialog' },
      }"
      :style="{ width: 'min(1680px, 96vw)', height: 'min(1268px, 76vh)' }"
      @update:visible="onProductSearchDialogVisibleChange"
    >
      <!-- <template #header>
        <div class="product-search-header">
          <div class="product-search-header-icon">
            <i class="pi pi-search" />
          </div>
          <div class="product-search-header-text">
            <strong>{{ t("product.searchDialogTitle") }}</strong>
            <span>{{ tl("ค้นหาด้วยรหัสสินค้า, ชื่อสินค้า, บาร์โค้ด", "Search by item code, item name, barcode", "ຄົ້ນຫາດ້ວຍລະຫັດສິນຄ້າ, ຊື່ສິນຄ້າ, ບາໂຄດ") }}</span>
          </div>
        </div>
      </template> -->
      <div class="product-search-dialog-tools" data-font-zone="product-search-dialog">
        <div class="product-search-dialog-input">
          <i class="pi pi-search product-search-input-icon" />
          <InputText
            ref="productSearchRef"
            v-model.trim="productSearch"
            data-testid="sale-product-search"
            :placeholder="t('product.searchPlaceholder')"
            :disabled="documentLocked"
            autofocus
            @keyup.enter="searchProducts"
          />
          <Button class="product-search-submit" :label="t('common.search')" icon="pi pi-search" :loading="productLoading" :disabled="documentLocked" @click="searchProducts" />
        </div>
      </div>
      <div class="product-results" data-font-zone="product-search-dialog">
        <div v-if="productLoading" class="empty-lines">{{ t("product.searching") }}</div>
        <template v-else>
          <div v-for="product in productResults" :key="productResultKey(product)" class="product-result-card" :class="{ expanded: productExpanded(product) }">
            <div class="product-result-row" role="button" tabindex="0" :aria-expanded="productExpanded(product)" @click="toggleProductResult(product)" @keyup.enter="toggleProductResult(product)">
              <strong class="result-code">
                <i :class="productExpanded(product) ? 'pi pi-chevron-down' : 'pi pi-chevron-right'" />
                {{ product.item_code }}
              </strong>
              <span class="result-image">
                <img :src="getProductImageUrl(product.item_code)" :alt="product.item_name || product.item_code" loading="lazy" @error="$event.target.style.display = 'none'" />
                <i class="pi pi-box" />
              </span>
              <span class="result-name">
                {{ product.item_name }}
                <span v-if="isSetItem(product)" class="result-set-badge"><i class="pi pi-box"></i> {{ tl("ชุด", "Set", "ຊຸດ") }}</span>
              </span>
              <span class="result-unit">{{ product.unit_code || "-" }}</span>
              <span class="result-barcode">{{ product.barcode || "-" }}</span>
              <span class="result-balance">
                {{
                  isSetItem(product)
                    ? "-"
                    : productResultBalanceLoading(product)
                      ? "..."
                      : productResultBalanceError(product)
                        ? "-"
                        : product.balance_qty == null
                          ? "-"
                          : formatQty(product.balance_qty)
                }}
              </span>
              <Button class="result-add-button" :label="t('common.add')" icon="pi pi-plus" severity="success" size="small" :disabled="documentLocked" @click.stop="addProductFromSearch(product)" />
            </div>
            <div v-if="productExpanded(product)" class="product-balance-expanded">
              <div v-if="productBalanceBranchLoading(product)" class="empty-lines compact">
                {{ t("product.loadingStock") }}
              </div>
              <Message v-else-if="productBalanceError(product)" severity="error" :closable="false">{{ productBalanceError(product) }}</Message>
              <template v-else>
                <div v-if="productBalanceBranches(product).length" class="product-balance-branch-strip">
                  <button
                    v-for="branch in productBalanceBranches(product)"
                    :key="branch.branch_code || '__blank'"
                    type="button"
                    :class="{
                      active: productBalanceActiveBranchCode(product) === (branch.branch_code || ''),
                    }"
                    :disabled="productBalanceLoading(product)"
                    @click="selectProductBalanceBranch(product, branch.branch_code || '')"
                  >
                    <span>
                      <i class="pi pi-building product-branch-icon" />
                      {{ productBalanceBranchTitle(branch) }}
                    </span>
                    <small>{{ productBalanceBranchSummary(product, branch) }}</small>
                  </button>
                </div>
                <div v-if="productWarehouseBalances(product).length || productBalanceLoading(product)" class="product-balance-table-wrap">
                  <div class="product-balance-panel-title">
                    <i class="pi pi-home" />
                    <strong>{{ tl("สาขา :", "Warehouse:", "ສາຂາ:") }} {{ productBalanceBranchTitle(productBalanceActiveBranch(product)) }}</strong>
                    <!-- <span
                      v-if="
                        productBalanceIsSelectedBranch(
                          productBalanceActiveBranch(product)
                        )
                      "
                      >{{ tl("สาขา POS", "POS branch", "ສາຂາ POS") }}</span
                    > -->
                  </div>
                  <DataTable
                    :value="productWarehouseBalances(product)"
                    class="product-balance-datatable"
                    size="small"
                    showGridlines
                    rowHover
                    :loading="productBalanceLoading(product)"
                    @row-click="(event) => addProductFromWarehouseBalance(product, event.data)"
                  >
                    <Column field="wh_code" :header="tl('คลัง', 'Warehouse', 'ຄັງ')">
                      <template #body="{ data }">{{ data.wh_code || "-" }}</template>
                    </Column>
                    <Column field="wh_name" :header="tl('ชื่อคลัง', 'Warehouse name', 'ຊື່ຄັງ')">
                      <template #body="{ data }">{{ data.wh_name || "-" }}</template>
                    </Column>
                    <Column field="balance_qty" :header="t('product.balance')" body-class="text-right">
                      <template #body="{ data }"
                        ><strong v-if="data.balance_qty > 0" style="color: #22c55e">{{ formatQty(data.balance_qty) }}</strong>
                        <span v-else>{{ formatQty(data.balance_qty) }}</span>
                      </template>
                    </Column>
                  </DataTable>
                </div>
                <div v-else class="empty-lines compact">
                  {{ tl("ไม่พบคลังที่มียอดคงเหลือ", "No warehouse with remaining stock found", "ບໍ່ພົບຄັງທີ່ມີຍອດຄົງເຫຼືອ") }}
                </div>
              </template>
            </div>
          </div>
          <div v-if="!productResults.length" class="empty-lines">
            {{ productSearch ? t("product.notFound") : t("product.searchHint") }}
          </div>
        </template>
      </div>
      <template #footer>
        <div data-font-zone="product-search-dialog">
          <Button class="product-search-close-button" :label="t('common.closeWindow')" icon="pi pi-times" severity="warn" outlined @click="productDialogVisible = false" />
        </div>
      </template>
    </Dialog>

    <Dialog
      :visible="lineImageDialogVisible"
      :header="lineImageDialogTitle || t('sell.productImage')"
      modal
      :draggable="false"
      :style="{ width: 'min(760px, 95vw)' }"
      @update:visible="lineImageDialogVisible = $event"
    >
      <div class="line-image-preview-wrap">
        <img v-if="lineImageDialogSrc" :src="lineImageDialogSrc" :alt="lineImageDialogTitle || t('sell.productImage')" />
      </div>
      <template #footer>
        <Button :label="t('sell.close')" severity="secondary" @click="lineImageDialogVisible = false" />
      </template>
    </Dialog>

    <SalesProductBasketDialog :visible="productBasketVisible" :cust-code="custCode" :price-opts="priceOpts()" @update:visible="productBasketVisible = $event" @confirm="addProductBasketToSale" />

    <SaleRefDocDialog
      :visible="refDocDialogVisible"
      :cust-code="custCode"
      :cust-name="custName"
      :exclude-doc-nos="excludeRefDocNos"
      @update:visible="refDocDialogVisible = $event"
      @confirm="onRefDocConfirm"
    />

    <Dialog :visible="printDialogVisible" :header="t('sell.printFormSelect')" modal :draggable="false" :style="{ width: 'min(460px, 95vw)' }" @update:visible="printDialogVisible = $event">
      <div class="print-dialog-body">
        <div class="print-doc-no">{{ activePrintDocNo }}</div>
        <div v-if="printLoading" class="lookup-hint">
          {{ t("sell.loadingPrintForms") }}
        </div>
        <Message v-else-if="printError" severity="error" :closable="false">{{ printError }}</Message>
        <div v-else class="print-form-list">
          <label v-for="form in printForms" :key="form.formcode" class="print-form-row" :class="{ disabled: !form.available }">
            <input v-model="selectedPrintForm" type="radio" name="sale-print-form" :value="form.formcode" :disabled="!form.available" />
            <span>
              <strong>{{ form.formname }}</strong>
              <small
                >{{ form.formcode
                }}<template v-if="!form.available">
                  ·
                  {{ tl("ไม่พบใน formdesign", "Not found in formdesign", "ບໍ່ພົບໃນ formdesign") }}</template
                ></small
              >
            </span>
          </label>
        </div>
      </div>
      <template #footer>
        <Button :label="t('sell.close')" severity="secondary" outlined @click="printDialogVisible = false" />
        <Button :label="t('sell.print')" icon="pi pi-print" :disabled="!selectedPrintForm" @click="confirmPrintForms" />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.sell-view {
  --sale-summary-rail-width: clamp(370px, 30vw, 430px);
  --sale-font-scale: 1;
  --sale-density-scale: 1;
  --sale-font-base: calc(1rem * var(--sale-font-scale));
  --sale-font-small: calc(0.86rem * var(--sale-font-scale));
  --sale-font-control: calc(1.02rem * var(--sale-font-scale));
  --sale-font-strong: calc(1.18rem * var(--sale-font-scale));
  --sale-font-title: calc(1.32rem * var(--sale-font-scale));
  --sale-gap: calc(0.5rem * var(--sale-density-scale));
  --sale-panel-padding: calc(0.75rem * var(--sale-density-scale));
  --sale-control-height: calc(2.5rem * var(--sale-density-scale));
  --sale-line-cell-y: calc(0.45rem * var(--sale-density-scale));
  --sale-line-cell-x: calc(0.5rem * var(--sale-density-scale));
  --sale-page-bg: #fff7ed;
  --sale-card-bg: #ffffff;
  --sale-card-muted: #fffaf5;
  --sale-border: #fed7aa;
  --sale-border-strong: #fb923c;
  --sale-text: #1f2937;
  --sale-muted: #7c5740;
  --sale-primary: #f15a00;
  --sale-primary-2: #fb923c;
  --sale-primary-soft: #fff4e8;
  --sale-primary-border: #fdba74;
  --sale-accent: #2e7d32;
  --sale-accent-soft: #f0fdf4;
  --sale-success: #2e7d32;
  --sale-warning: #ea580c;
  --sale-warning-soft: #fff7ed;
  --sale-danger: #b42318;
  --sale-net: #2e7d32;
  --sale-gradient: linear-gradient(135deg, #ff8a00 0%, #ff3d00 100%);
  --sale-gradient-soft: linear-gradient(135deg, rgba(255, 138, 0, 0.16), rgba(255, 61, 0, 0.12));
  --sale-shadow: 0 10px 28px rgba(249, 115, 22, 0.12);
  --app-panel-bg: var(--sale-card-bg);
  --app-active-bg: var(--sale-primary-soft);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: var(--sale-gap);
  height: 100dvh;
  background: linear-gradient(180deg, #fff7ed 0%, #fffaf5 38%, #ffffff 100%);
  color: var(--sale-text);
  font-size: calc(17.5px * var(--sale-font-scale));
  line-height: 1.45;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
}

.sell-view :deep(.p-inputtext),
.sell-view :deep(.p-select-label),
.sell-view :deep(.p-button-label),
.sell-view :deep(.p-datatable-thead > tr > th),
.sell-view :deep(.p-datatable-tbody > tr > td),
.sell-view :deep(.p-message-text),
.sell-view :deep(.p-dialog-title),
.sell-view :deep(.p-accordionheader),
.sell-view :deep(.p-tabview-title) {
  font-size: var(--sale-font-control);
}

.sell-view[data-font-zone]:not([data-font-zone="screen"]),
.sell-view [data-font-zone]:not([data-font-zone="screen"]) {
  font-size: var(--biz-zone-font-size, inherit);
}

.sell-view[data-font-zone][data-font-zone-size],
.sell-view [data-font-zone][data-font-zone-size] {
  --sale-font-base: var(--biz-zone-font-size);
  --sale-font-small: calc(var(--biz-zone-font-size) * 0.86);
  --sale-font-control: calc(var(--biz-zone-font-size) * 1.02);
  --sale-font-strong: calc(var(--biz-zone-font-size) * 1.18);
  --sale-font-title: calc(var(--biz-zone-font-size) * 1.32);
}

.sell-view :where(.field > span, small, th, td, .summary-list span, .payment-row span, .payment-empty, .workspace-tab-summary, .result-meta, .result-code, .line-remark-preview) {
  font-size: var(--sale-font-base);
}

.sell-view :where(.panel-title strong, .biz-page-title, .payment-summary-total strong, .summary-list strong) {
  font-size: var(--sale-font-strong);
}

.biz-page-header,
.workspace-tabs-card,
.sell-view .biz-panel {
  background: var(--sale-card-bg);
  /* box-shadow: var(--sale-shadow); */
}

.sell-view .biz-page-header {
  border-color: var(--sale-border);
  background: rgba(255, 255, 255, 0.92);
}

.biz-page-title,
.panel-title strong {
  color: var(--sale-text);
}

.biz-page-subtitle,
.field > span,
.payment-detail-head span,
.payment-breakdown span,
.payment-empty,
.summary-list span,
.payment-summary span {
  color: var(--sale-muted);
}

.header-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

:global(.held-bill-dialog.p-dialog) {
  overflow: hidden;
  border: 1px solid #f4d2b6;
  border-radius: 16px;
  background: #fff8ef;
  box-shadow: 0 24px 70px rgba(88, 38, 10, 0.22);
}

:global(.held-bill-dialog.p-dialog .p-dialog-header) {
  padding: 1.15rem 1.35rem 0.85rem;
  border-bottom: 1px solid #f4d2b6;
  background: linear-gradient(180deg, #fffaf5 0%, #fff3e8 100%);
}

:global(.held-bill-dialog.p-dialog .p-dialog-title) {
  color: var(--sale-text);
  font-size: 1.55rem;
  font-weight: 950;
}

:global(.held-bill-dialog.p-dialog .p-dialog-content) {
  padding: 1rem 1.15rem;
  background: linear-gradient(180deg, #fffaf5 0%, #fff8ef 100%);
}

:global(.held-bill-dialog.p-dialog .p-dialog-footer) {
  padding: 0.85rem 1.15rem 1rem;
  border-top: 1px solid #f4d2b6;
  background: #fff8ef;
}

.held-bill-dialog-body {
  display: grid;
  gap: 0.9rem;
}

.held-bill-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
  border: 1px solid #f4d2b6;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.78);
  box-shadow: 0 10px 24px rgba(249, 115, 22, 0.08);
}

.held-bill-toolbar > div:first-child {
  display: grid;
  gap: 0.1rem;
}

.held-bill-toolbar strong {
  color: var(--sale-accent);
  font-size: 1.35rem;
  font-weight: 950;
}

.held-bill-toolbar span {
  color: var(--sale-muted);
  font-size: 0.95rem;
  font-weight: 850;
}

.held-bill-toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
}

.held-bill-list {
  display: grid;
  gap: 0.7rem;
  max-height: 55vh;
  overflow: auto;
  padding-right: 0.15rem;
}

.held-bill-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.9rem;
  border: 1px solid #f4d2b6;
  border-radius: 12px;
  background: #ffffff;
  padding: 0.8rem 0.9rem;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
}

.held-bill-icon {
  display: inline-grid;
  width: 3rem;
  height: 3rem;
  place-items: center;
  border-radius: 12px;
  background: #fff0df;
  color: var(--sale-accent);
  font-size: 1.3rem;
}

.held-bill-content {
  display: grid;
  min-width: 0;
  gap: 0.14rem;
}

.held-bill-title-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.8rem;
}

.held-bill-title-row b {
  color: #15803d;
  font-size: 1.2rem;
  font-weight: 950;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.held-bill-item strong,
.held-bill-item small {
  display: block;
}

.held-bill-item strong {
  overflow: hidden;
  color: var(--sale-text);
  font-size: 1.1rem;
  font-weight: 950;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.held-bill-item small {
  color: var(--sale-muted);
  font-size: 1rem;
  font-weight: 800;
}

.held-bill-item .held-bill-employee {
  color: #9a3412;
  font-weight: 900;
}

.held-bill-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.45rem;
}

.held-bill-actions :deep(.p-button:not(.p-button-danger)) {
  border-color: transparent;
  background: linear-gradient(135deg, #22c55e 0%, #15803d 100%);
  color: #ffffff;
  font-weight: 900;
  box-shadow: 0 10px 20px rgba(21, 128, 61, 0.18);
}

.header-actions :deep(.p-button:not(.p-button-secondary)) {
  border-color: transparent;
  background: var(--sale-gradient);
  color: #ffffff;
  box-shadow: 0 12px 24px rgba(249, 115, 22, 0.24);
}

.header-actions :deep(.p-button-secondary.p-button-outlined) {
  border-color: var(--sale-border);
  background: rgba(255, 255, 255, 0.78);
  color: #9a3412;
  box-shadow: 0 6px 14px rgba(249, 115, 22, 0.08);
}

.header-meta-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.45rem;
}

.header-meta-pills span {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 0.3rem;
  padding: 0.18rem 0.5rem;
  border: 1px solid var(--sale-border);
  border-radius: 999px;
  background: var(--sale-card-muted);
  color: #475467;
  font-size: 0.74rem;
  font-weight: 700;
}

.header-meta-pills span.warning {
  border-color: color-mix(in srgb, var(--p-orange-500) 38%, var(--p-surface-border));
  background: #fff7ed;
  color: var(--p-orange-700);
}

.cash-currency-name2 {
  opacity: 0;
  transition: opacity 0.15s ease;
}

.cash-pay-title {
  color: var(--sale-text);
  font-size: var(--sale-font-title);
  font-weight: 950;
  line-height: 1.25;
}

.cash-pay-title:hover .cash-currency-name2 {
  opacity: 1;
}

.workspace-tabs-card {
  display: flex;
  align-items: center;
  gap: 4rem;
  background: transparent;
  box-shadow: none;
}

.workspace-tabs {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 0.3rem;
  flex: 1 1 auto;
  min-width: 0;
}

.workspace-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  flex: 0 0 auto;
}

.workspace-actions button {
  flex: 0 0 auto;
}

.workspace-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.workspace-tabs button,
.workspace-actions button {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: center;
  gap: 0.14rem;
  border: 1px solid #fed7aa;
  border-radius: 10px;
  background: #ffffff;
  color: #1f2937;
  cursor: pointer;
  font-size: var(--sale-font-small);
  font-weight: 800;
  padding: calc(0.5rem * var(--sale-density-scale)) calc(0.5rem * var(--sale-density-scale));
  transition:
    border-color 0.14s,
    background 0.14s,
    color 0.14s,
    transform 0.14s;
}

.workspace-tabs button:hover,
.workspace-actions button:not(:disabled):hover {
  border-color: var(--sale-primary-border);
  background: var(--sale-primary-soft);
  color: var(--sale-primary);
}

.workspace-tabs button.active {
  border-color: transparent;
  background: var(--sale-gradient);
  color: #ffffff;
  transform: translateY(-1px);
  box-shadow: 0 10px 20px rgba(249, 115, 22, 0.22);
}

.workspace-tabs button span,
.workspace-actions button span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-tabs button small {
  flex: 0 0 auto;
  padding: 0.04rem 0.32rem;
  border: 1px solid currentColor;
  border-radius: 5px;
  font-size: 0.65rem;
  line-height: 1.25;
  opacity: 0.72;
}

.workspace-tabs button b {
  min-width: 1.45rem;
  max-width: 6.5rem;
  overflow: hidden;
  padding: 0.04rem 0.38rem;
  border-radius: 999px;
  background: var(--sale-gradient);
  color: #fff;
  font-size: 0.72rem;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-tabs button b.warning {
  background: #d97706;
}

.workspace-tabs button b.success {
  background: var(--sale-success);
}

.workspace-tabs button b.info {
  background: var(--sale-primary);
}

.workspace-tab-summary {
  display: grid;
  grid-template-columns: minmax(7rem, 0.8fr) minmax(0, 1.4fr) auto auto;
  gap: 0.5rem;
  align-items: center;
}

.workspace-tab-summary span,
.workspace-tab-summary strong {
  min-width: 0;
  overflow: hidden;
  padding: 0.48rem 0.6rem;
  border: 1px solid var(--p-surface-border);
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.72);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-tab-summary span {
  display: inline-flex;
  align-items: center;
  gap: 0.38rem;
  color: var(--p-text-color-secondary);
  font-size: 0.78rem;
  font-weight: 700;
}

.workspace-tab-summary strong {
  color: var(--p-primary-color);
  font-size: 1rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.pay-tab-index {
  display: inline-flex;
  min-width: 1.15rem;
  justify-content: center;
  border-radius: 4px;
  background: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
  color: var(--p-primary-color);
  font-size: 0.68rem;
  font-weight: 900;
  line-height: 1.35;
}

.sell-grid {
  display: grid;
  min-height: 0;
  overflow: hidden;
  width: 100%;
}

.document-workspace {
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  gap: 0.475rem;
  overflow: hidden;
}

.details-split-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--sale-summary-rail-width);
  gap: 0.2rem;
  align-items: stretch;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.details-split-layout .product-panel,
.details-summary-slot {
  min-width: 0;
  min-height: 0;
}

.details-split-layout .product-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: var(--sale-panel-padding);
}

.product-panel > .grid.formgrid,
.product-panel > .credit-check-message,
.product-panel > .product-tools,
.product-panel > .doc-footer-block {
  flex: 0 0 auto;
}

.details-summary-slot {
  display: grid;
  align-self: stretch;
  height: 100%;
  overflow: hidden;
}

.payment-card {
  grid-column: auto;
  align-self: start;
  position: relative;
  border: 1px solid transparent;
  max-height: calc(100vh - 1.5rem);
  overflow: auto;
  background:
    linear-gradient(#ffffff, #ffffff) padding-box,
    var(--sale-gradient) border-box;
  box-shadow: 0 18px 45px rgba(249, 115, 22, 0.18);
}

.payment-card::before {
  content: "";
  position: absolute;
  z-index: 0;
  inset: 0 0 auto;
  height: 11.25rem;
  background: linear-gradient(135deg, rgba(255, 138, 0, 0.96), rgba(255, 61, 0, 0.96));
}

.payment-card > * {
  position: relative;
  z-index: 1;
}

.payment-card .panel-title strong,
.payment-card .panel-title i {
  color: #ffffff;
}

.doc-footer-panel {
  margin-top: 0.45rem;
  /* padding: var(--sale-panel-padding); */
}

.details-summary-slot .doc-footer-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  margin-top: 0;
  min-height: 0;
  overflow: hidden;
}

/* rail สรุปเหลือแค่ summary แล้ว (promotion ย้ายไปฝั่งซ้าย) → คอลัมน์เดียวเสมอ */
.details-summary-slot .doc-footer-grid {
  grid-template-columns: 1fr;
}

@media (min-width: 1181px) {
  .details-summary-slot .doc-footer-panel {
    margin-top: 0;

    overflow: auto;
  }

  .details-summary-slot .doc-footer-grid {
    grid-template-columns: 1fr;
  }

  .details-summary-slot .doc-footer-right {
    order: 1;
  }

  .details-summary-slot .doc-footer-left {
    order: 2;
  }

  .details-summary-slot .doc-footer-summary-block {
    position: static;
  }
}

.doc-footer-grid {
  display: grid;
  grid-template-columns: minmax(0, 2.05fr) minmax(330px, 0.95fr);
  gap: 0.75rem;
  align-items: start;
  flex: 1 1 auto;
  min-height: 0;
}

.doc-footer-left {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}

.doc-footer-right {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
  min-height: 0;
  align-self: stretch;
  height: 100%;
}

.doc-footer-block {
  border: 1px solid var(--sale-border);
  border-radius: 10px;
  padding: 0.75rem;
  background: linear-gradient(180deg, #ffffff 0%, #fffaf5 100%);
}

.doc-footer-remark-block {
  background: linear-gradient(180deg, #fffaf5 0%, #ffffff 100%);
}

.doc-footer-remark-block :deep(textarea) {
  min-height: calc(3.25rem * var(--sale-density-scale));
  resize: vertical;
}

.product-remark-block {
  flex: 0 0 auto;
  min-height: 0;
  margin-top: var(--sale-gap);
  padding: calc(0.55rem * var(--sale-density-scale));
}

.product-remark-block :deep(.p-selectbutton) {
  width: 100%;
}

.product-remark-block :deep(.p-togglebutton) {
  min-height: calc(2.25rem * var(--sale-density-scale));
}

.product-footer-grid {
  margin-top: 0.75rem;
}

.product-footer-grid > [class*="col-"] {
  display: flex;
}

.product-footer-grid .doc-footer-block {
  width: 100%;
}

.doc-footer-summary-block {
  position: static;
  flex: 0 0 auto;
  border-color: #fdba74;
  background: #ffffff;
  box-shadow: 0 14px 28px rgba(249, 115, 22, 0.12);
}

.sale-benefit-compact-block {
  flex: 0 0 auto;
  display: grid;
  gap: 0.65rem;
  border-color: #fdba74;
  background: #ffffff;
}

.sale-benefit-compact-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.6rem;
  align-items: center;
}

.sale-benefit-compact-head .panel-title.compact {
  min-width: 0;
  margin-bottom: 0;
}

.sale-benefit-compact-head :deep(.p-button) {
  min-height: 2.35rem;
}

.sale-benefit-compact-list {
  display: grid;
  gap: 0.45rem;
}

.sale-benefit-compact-list > div {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: baseline;
  padding: 0.45rem 0;
  border-top: 1px dashed #fed7aa;
}

.sale-benefit-compact-list span,
.sale-benefit-compact-list strong {
  min-width: 0;
  overflow: hidden;
  font-size: var(--sale-font-base);
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sale-benefit-compact-list span {
  color: var(--sale-text);
  font-weight: 850;
}

.sale-benefit-compact-list strong {
  font-weight: 950;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.summary-action-dock {
  display: grid;
  gap: 0.6rem;
  margin-top: auto;
  padding-top: 0.75rem;
}

.panel-title.compact {
  margin-bottom: 0.45rem;
}

.summary-list.compact {
  margin-top: 0.85rem;
  gap: 0;
}

.summary-list.compact > div {
  padding: 0.45rem 0;
  border-bottom: 1px dashed #fed7aa;
}

.summary-list.compact > div:last-child {
  border-bottom: 0;
}

.doc-footer-net-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: baseline;
  margin-top: 0.85rem;
  padding: 0.8rem 0.9rem;
  border-radius: 8px;
  background: var(--sale-gradient);
  color: #ffffff;
  box-shadow: 0 16px 28px rgba(249, 115, 22, 0.24);
}

.doc-footer-net-card span {
  min-width: 0;
  font-weight: 900;
}

.doc-footer-net-card strong {
  font-size: 1.9rem;
  font-weight: 950;
  line-height: 1;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.payment-history-section {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--p-surface-border);
}

.payment-history-title {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--p-text-color-secondary);
  margin-bottom: 0.5rem;
}

.payment-history-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.payment-history-entry {
  display: grid;
  grid-template-columns: 28px 1fr auto;
  gap: 0.4rem;
  align-items: center;
  font-size: 0.82rem;
}

.payment-history-entry.total-row {
  margin-top: 0.35rem;
  padding-top: 0.35rem;
  border-top: 1px solid var(--p-surface-border);
}

.ph-icon {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.72rem;
  flex-shrink: 0;
}

.ph-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.ph-text strong {
  font-size: 0.82rem;
  line-height: 1.3;
}

.ph-text span {
  font-size: 0.73rem;
  color: var(--p-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ph-amount {
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  font-size: 0.85rem;
}

.doc-footer-actions {
  display: grid;
  gap: 0.6rem;
}

.doc-footer-actions :deep(.p-button) {
  min-height: 3.6rem;
  border-radius: 8px;
  font-size: 1.05rem;
  font-weight: 900;
}

.doc-footer-main-action.status-save-btn,
.doc-footer-actions .status-save-btn.payment-open-btn {
  min-height: 5.5rem;
  border-color: transparent !important;
  background: var(--sale-gradient) !important;
  color: #ffffff !important;
  box-shadow: 0 14px 28px rgba(249, 115, 22, 0.24) !important;
}

.doc-footer-secondary-action {
  width: 100%;
}

.doc-footer-inline-grid {
  width: 100%;
  gap: 0.55rem;
}

.send-type-select :deep(.p-togglebutton.p-togglebutton-checked),
.send-type-select :deep(.p-selectbutton .p-togglebutton.p-togglebutton-checked) {
  background: #e87e2c;
  border-color: #e87e2c;
  color: #ffffff;
}

.send-type-select :deep(.p-togglebutton.p-togglebutton-checked:hover),
.send-type-select :deep(.p-selectbutton .p-togglebutton.p-togglebutton-checked:hover) {
  background: #d97123;
  border-color: #d97123;
  color: #ffffff;
}

.sell-status-bar {
  position: sticky;
  z-index: 12;
  bottom: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
  align-items: center;
  margin-top: 0.35rem;
  padding: 0.45rem;
  border: 1px solid var(--sale-border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 -10px 28px rgba(249, 115, 22, 0.12);
  backdrop-filter: blur(10px);
}

.sell-status-bar.no-warning-state {
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
}

.status-shortcuts {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.status-shortcuts button,
.status-metric,
.status-state {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid var(--sale-border);
  border-radius: 8px;
  background: var(--sale-card-bg);
  color: var(--sale-text);
  cursor: pointer;
  font: inherit;
  padding: 0.4rem 0.55rem;
}

.status-shortcuts button:hover,
.status-metric:hover,
.status-state:hover {
  border-color: var(--sale-primary-border);
  color: var(--sale-primary);
}

.status-save-wrap {
  display: flex;
  min-width: 0;
  gap: 0.5rem;
}

.status-save-btn {
  flex: 1 1 auto;
  width: 100%;
  min-height: 3rem;
  border-color: transparent !important;
  background: var(--sale-gradient) !important;
  color: #ffffff !important;
  box-shadow: 0 12px 24px rgba(249, 115, 22, 0.24) !important;
}

.status-save-btn.payment-open-btn {
  background: linear-gradient(135deg, #43a047 0%, #15803d 100%) !important;
  box-shadow: 0 12px 24px rgba(21, 128, 61, 0.22) !important;
}

.status-drawer-btn {
  flex: 0 0 auto;
  min-height: 3rem;
  white-space: nowrap;
}

.status-metric {
  justify-content: space-between;
}

.status-metric span,
.status-total span {
  color: var(--p-text-color-secondary);
  font-size: 1.2rem;
  font-weight: 800;
}

.status-metric strong,
.status-total strong,
.status-state span {
  overflow: hidden;
  font-size: 1.2rem;
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-total {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.36rem 0.6rem;
  border: 1px solid var(--sale-primary-border);
  border-radius: 8px;
  background: linear-gradient(180deg, #fff7ed 0%, #fffdf8 100%);
}

.status-total span,
.status-total strong {
  line-height: 1.15;
}

.workspace-tabs button.active b {
  background: rgba(255, 255, 255, 0.24);
}

.status-total span {
  font-size: 1.6rem;
  min-width: 0;
  color: var(--sale-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-total strong {
  font-size: 2.3rem;
  color: var(--sale-net);
  font-variant-numeric: tabular-nums;
  margin-left: auto;
  text-align: right;
}

.status-state {
  justify-content: center;
  flex-wrap: wrap;
  row-gap: 0.08rem;
}

.status-state small {
  flex-basis: 100%;
  overflow: hidden;
  color: currentColor;
  font-size: 0.8rem;
  font-weight: 800;
  line-height: 1;
  opacity: 0.82;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-state.ready,
.status-state.success {
  border-color: #a7f3d0;
  background: #ecfdf5;
  color: #047857;
}

.status-state.warning {
  border-color: #fed7aa;
  background: var(--sale-warning-soft);
  color: var(--sale-warning);
}

.status-state.info {
  border-color: var(--sale-primary-border);
  background: var(--sale-primary-soft);
  color: var(--sale-primary);
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.panel-title i {
  color: var(--sale-accent);
}

.panel-title button {
  margin-left: auto;
}

.doc-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
}

.field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.35rem;
}

.field > span {
  color: var(--sale-primary);
  font-size: 1rem;
  font-weight: 800;
}

.field.wide {
  grid-column: span 4;
}

.entity-field {
  grid-column: span 2;
}

.entity-picker,
.dialog-search-row {
  display: flex;
  min-width: 0;
  gap: 0.5rem;
  align-items: stretch;
}

.entity-picker :deep(.p-inputtext) {
  cursor: pointer;
  height: var(--sale-control-height);
}

.entity-picker :deep(.p-button) {
  flex: 0 0 auto;
  height: var(--sale-control-height);
}

.doc-format-field :deep(.p-select) {
  min-height: var(--sale-control-height);
  height: var(--sale-control-height);
  align-items: center;
}

.doc-format-field :deep(.p-select-label) {
  display: flex;
  height: 100%;
  min-height: 0;
  align-items: center;
  padding-top: 0;
  padding-bottom: 0;
  font-size: var(--sale-font-control);
  font-weight: 500;
  line-height: 1.25;
}

.doc-format-field :deep(.p-select-dropdown) {
  width: var(--sale-control-height);
}

.entity-dialog-body {
  display: grid;
  gap: 0.75rem;
}

.dialog-search-row :deep(.p-inputtext) {
  min-width: 0;
  flex: 1 1 auto;
}

.customer-filter-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.customer-filter-row small {
  color: var(--p-text-color-secondary);
  font-size: 0.78rem;
  white-space: nowrap;
}

.field :deep(.p-inputtext),
.field :deep(.p-select),
.tool-input :deep(.p-inputtext) {
  border-color: var(--sale-border);
  background: linear-gradient(180deg, #ffffff 0%, #fffdf8 100%);
  color: var(--sale-text);
  width: 100%;
}

.field :deep(.p-inputtext:enabled:focus),
.field :deep(.p-select:not(.p-disabled).p-focus),
.tool-input :deep(.p-inputtext:enabled:focus) {
  border-color: var(--sale-primary-border);
  box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.14);
}

.credit-check-message {
  margin-top: 0.75rem;
}

.additional-panel h3 {
  margin: 0 0 0.65rem;
  color: var(--p-text-color);
  font-size: 1.5rem;
}

.extra-doc-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.extra-doc-block {
  min-width: 0;
  border: 1px solid var(--sale-border);
  border-radius: 8px;
  background: var(--sale-card-bg);
  padding: 0.75rem;
}

.extra-grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem;
}

.wide-local {
  grid-column: 1 / -1;
}

.extra-inline-form {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) 130px 90px auto;
  gap: 0.5rem;
  align-items: stretch;
}

.extra-inline-form.gl-form {
  grid-template-columns: minmax(180px, 1fr) 120px 120px auto;
}

.extra-inline-form :deep(.p-inputtext),
.extra-inline-form :deep(.p-inputnumber),
.extra-inline-form :deep(.p-select) {
  width: 100%;
}

.mini-table {
  display: grid;
  margin-top: 0.6rem;
  border-top: 1px solid var(--p-surface-border);
}

.mini-row {
  display: grid;
  grid-template-columns: minmax(80px, 1fr) 110px 70px 110px auto;
  gap: 0.5rem;
  align-items: center;
  border-bottom: 1px solid var(--p-surface-border);
  color: var(--p-text-color-secondary);
  font-size: 1rem;
  padding: 0.4rem 0;
}

.mini-row.gl-row {
  grid-template-columns: minmax(160px, 1fr) 120px 120px auto;
}

.gl-mode-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 0.6rem;
}

.gl-mode-toolbar label {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.gl-mode-note {
  color: var(--p-text-color-secondary);
  font-size: 0.82rem;
}

.mini-row.total {
  color: var(--p-text-color);
  font-weight: 700;
}

.mini-row.warning {
  color: var(--p-orange-600);
}

.lookup-hint {
  color: var(--p-text-color-secondary);
  font-size: 0.8rem;
  padding: 0.5rem 0;
}

/* Sub-tab navigation */
.extra-subtab-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.75rem;
  border-bottom: 2px solid var(--p-surface-border);
  background: var(--p-surface-ground);
  border-radius: 8px 8px 0 0;
  margin: -0.75rem -0.75rem 0.75rem;
}

.extra-subtab-btn {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1rem;
  border: 1px solid var(--p-surface-border);
  border-radius: 6px;
  background: var(--p-surface-0);
  color: var(--p-text-color-secondary);
  cursor: pointer;
  font-size: 0.85rem;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.extra-subtab-btn:hover {
  background: var(--p-surface-50);
  color: var(--p-text-color);
  border-color: var(--p-primary-color);
}

.extra-subtab-btn.active {
  background: var(--p-primary-color);
  color: var(--p-primary-color-text);
  border-color: var(--p-primary-color);
  font-weight: 600;
}

.extra-subtab-btn .badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 0.4rem;
  margin-left: auto;
  border-radius: 10px;
  background: var(--p-orange-500);
  color: white;
  font-size: 0.7rem;
  font-weight: 700;
}

/* Sub-panels */
.extra-panel {
  padding: 0;
  border: none;
  background: transparent;
}

.extra-doc-block.full-width {
  grid-column: 1 / -1;
}

.wht-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.wht-summary {
  color: var(--p-text-color-secondary);
  font-size: 0.85rem;
}

.wht-header-table {
  margin-bottom: 0.75rem;
}

.wht-header-row {
  grid-template-columns: minmax(120px, 1fr) 110px minmax(140px, 1fr) 120px 110px 120px auto;
}

.wht-header-button {
  border: 0;
  width: 100%;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.wht-header-button.active {
  background: color-mix(in srgb, var(--p-primary-color) 8%, transparent);
  color: var(--p-text-color);
}

.wht-header-form {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.65rem;
  margin-bottom: 0.75rem;
}

.wht-native-date {
  width: 100%;
  min-height: 2.2rem;
  border-radius: 6px;
  border: 1px solid var(--p-surface-border);
  padding: 0.45rem 0.55rem;
  background: var(--p-surface-0);
  color: var(--p-text-color);
}

.wht-detail-form {
  margin-bottom: 0.45rem;
}

.wht-detail-hints {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) 120px 90px auto;
  gap: 0.5rem;
  margin: 0.2rem 0 0.35rem;
}

.wht-detail-hints span {
  color: var(--p-text-color-secondary);
  font-size: 0.76rem;
  font-weight: 700;
}

.wht-detail-row {
  grid-template-columns: minmax(180px, 1fr) 120px 90px 120px auto;
}

.wht-detail-row :deep(.p-inputtext),
.wht-detail-row :deep(.p-inputnumber) {
  width: 100%;
}

.vat-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.vat-toolbar label {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--p-text-color-secondary);
  font-size: 1.1rem;
}

.vat-grid {
  overflow-x: auto;
}

.vat-row {
  grid-template-columns:
    130px 170px 80px 90px minmax(180px, 1fr) 110px 110px 90px 110px 110px 130px minmax(140px, 1fr)
    130px minmax(180px, 1fr) auto;
  min-width: 1850px;
}

.vat-row-total {
  grid-template-columns:
    130px 170px 80px 90px minmax(180px, 1fr) 110px 110px 90px 110px 110px 130px minmax(140px, 1fr)
    130px minmax(180px, 1fr) auto;
}

.vat-native-date {
  width: 100%;
  min-height: 2.2rem;
  border-radius: 6px;
  border: 1px solid var(--p-surface-border);
  padding: 0.4rem 0.5rem;
  background: var(--p-surface-0);
  color: var(--p-text-color);
}

.vat-row :deep(.p-inputtext),
.vat-row :deep(.p-inputnumber),
.vat-row :deep(.p-select) {
  width: 100%;
}

.vat-branch-wrap {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr);
  gap: 0.35rem;
  min-width: 0;
}

.advance-readonly-note {
  background: var(--p-surface-50);
  border: 1px solid var(--p-surface-border);
  border-radius: 6px;
  padding: 0.75rem;
  margin-bottom: 0.75rem;
  border-left: 4px solid var(--p-orange-500);
}

.advance-readonly-note p {
  margin: 0;
  color: var(--p-text-color);
  font-size: 0.85rem;
  line-height: 1.4;
}

.advance-empty {
  background: var(--p-surface-50);
  border: 1px dashed var(--p-surface-border);
  border-radius: 6px;
  padding: 2rem;
  text-align: center;
}

.advance-empty p {
  margin: 0;
  color: var(--p-text-color-secondary);
  font-size: 0.85rem;
}

.mini-row.header {
  font-weight: 700;
  color: var(--p-text-color);
  background: var(--p-surface-50);
  border-bottom: 2px solid var(--p-surface-border);
  padding: 0.5rem 0;
}

.dialog-result-list button {
  display: grid;
  width: 100%;
  gap: 0.15rem;
  border: 0;
  border-bottom: 1px solid var(--p-surface-border);
  background: transparent;
  color: var(--p-text-color);
  cursor: pointer;
  font: inherit;
  padding: 0.65rem 0.75rem;
  text-align: left;
}

.dialog-result-list button:hover {
  background: var(--p-surface-hover);
}

.dialog-result-list span,
.product-results span {
  overflow: hidden;
  color: var(--p-text-color-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.product-results span.result-name,
.product-results strong.result-code,
.product-results span.result-barcode {
  white-space: normal;
  overflow-wrap: break-word;
  word-break: break-word;
  text-overflow: unset;
}

.customer-type-tag {
  width: fit-content;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 700;
  border: 1px solid var(--p-surface-border);
}

.customer-type-tag.is-member {
  background: #ecfdf5;
  border-color: #86efac;
  color: #166534;
}

.customer-type-tag.is-non-member {
  background: #f8fafc;
  border-color: #cbd5e1;
  color: #475569;
}

.product-tools {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--sale-gap);
  align-items: stretch;
  margin-top: calc(0.45rem * var(--sale-density-scale));
}

.tool-input {
  display: flex;
  min-width: 0;
  gap: 0.5rem;
}

.product-action-buttons {
  display: flex;
  gap: 0.5rem;
}

.product-action-buttons :deep(.p-button) {
  box-shadow: 0 12px 24px rgba(249, 115, 22, 0.2);
  white-space: nowrap;
}

.product-action-buttons :deep(.p-button-success) {
  border-color: transparent;
  background: var(--sale-gradient);
  color: #ffffff;
}

.product-search-dialog :deep(.p-dialog-content),
:deep(.product-search-dialog.p-dialog .p-dialog-content) {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 1rem;
  min-height: 0;
  overflow: hidden !important;
  padding: 0 1.5rem 0.75rem;
}

:global(.product-search-dialog.p-dialog),
:global(.product-search-dialog.p-dialog .p-dialog-content) {
  font-size: 1.08rem;
}

:global(.product-search-dialog.p-dialog .p-dialog-content) {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 1rem;
  min-height: 0;
  overflow: hidden !important;
  padding: 0 1.5rem 0.75rem;
}

:global(.product-search-dialog.p-dialog) {
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.28);
}

:global(.product-search-dialog.p-dialog .p-dialog-footer) {
  padding: 0.7rem 1.5rem 1.5rem;
}

:deep(.product-search-dialog.p-dialog .p-dialog-header),
.product-search-dialog :deep(.p-dialog-header) {
  align-items: flex-start;
  padding: 1.5rem 1.5rem 1rem;
  font-size: 1.18rem;
}

:deep(.product-search-dialog.p-dialog .p-dialog-title),
.product-search-dialog :deep(.p-dialog-title) {
  font-size: 1.25rem;
  font-weight: 900;
}

:deep(.product-search-dialog.p-dialog),
.product-search-dialog :deep(.p-dialog) {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  max-height: 92vh;
  font-size: 1.08rem;
  overflow: hidden;
}

.product-search-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  min-width: 0;
}

.product-search-header-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 3.25rem;
  height: 3.25rem;
  border-radius: 8px;
  background: #ffedd5;
  color: #f97316;
  font-size: 1.45rem;
  box-shadow: inset 0 0 0 1px #fed7aa;
}

.product-search-header-text {
  display: grid;
  gap: 0.18rem;
  min-width: 0;
}

.product-search-header-text strong {
  color: var(--sale-text);
  font-size: 1.25rem;
  font-weight: 950;
}

.product-search-header-text span {
  color: var(--sale-muted);
  font-size: 0.96rem;
  font-weight: 700;
}

.product-search-dialog-tools {
  padding: 0;
  margin-top: 1rem;
}

.product-search-dialog-input {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: center;
  position: relative;
}

.product-search-input-icon {
  position: absolute;
  z-index: 1;
  left: 1rem;
  color: #f97316;
  font-size: 1.15rem;
  pointer-events: none;
}

.product-search-dialog-input :deep(.p-inputtext) {
  width: 100%;
  min-height: 3.25rem;
  padding-left: 3rem;
  border-color: #fb923c;
  border-radius: 8px;
  font-size: 1.16rem;
  box-shadow: 0 0 0 1px rgba(251, 146, 60, 0.08);
}

.product-search-dialog-input :deep(.p-button) {
  min-width: 8.75rem;
  min-height: 3.25rem;
  border-color: transparent;
  border-radius: 8px;
  background: linear-gradient(135deg, #ff8a00 0%, #ff4d00 100%);
  font-size: 1.08rem;
  font-weight: 900;
  box-shadow: 0 10px 20px rgba(249, 115, 22, 0.22);
}

.product-search-close-button {
  min-width: 9.5rem;
  border-radius: 8px;
  font-weight: 900;
}

.lines-title {
  justify-content: space-between;
}

.lines-title span {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.lines-table-wrap {
  flex: 1 1 0;
  min-height: 14rem;
  margin-top: calc(0.75rem * var(--sale-density-scale));
  overflow: auto;
  overscroll-behavior: contain;
}

.lines-table {
  width: 100%;
  min-width: 1260px;
  border-collapse: collapse;
  table-layout: fixed;
}

.line-col-index {
  width: 3rem;
}
.line-col-image {
  width: 4.5rem;
}
.line-col-item {
  width: 31%;
}
.line-col-code {
  width: 10rem;
}

.doc-footer-actions .status-save-btn.payment-open-btn {
  background: linear-gradient(135deg, #43a047 0%, #15803d 100%) !important;
  box-shadow: 0 14px 28px rgba(21, 128, 61, 0.24) !important;
  font-size: 2rem;
  font-weight: 950;
}

.doc-footer-actions :deep(.status-save-btn.payment-open-btn .p-button-label) {
  font-size: 2rem !important;
  font-weight: 950 !important;
  line-height: 1.1;
}

.doc-footer-actions :deep(.status-save-btn.payment-open-btn .p-button-icon) {
  font-size: 1.8rem !important;
}
.line-col-unit {
  width: 5.5rem;
}
.line-col-location {
  width: 7rem;
}
.line-col-qty {
  width: 9.5rem;
}
.line-col-price {
  width: 8rem;
}
.line-col-discount {
  width: 7rem;
}
.line-col-total {
  width: 7rem;
}
.line-col-action {
  width: 5.5rem;
}

.lines-table th,
.lines-table td {
  border-bottom: 1px solid var(--sale-border);
  padding: 0.2rem 0.2rem;
  text-align: left;
  vertical-align: middle;
}

.lines-table th {
  position: sticky;
  z-index: 5;
  top: 0;
  background: var(--sale-warning);
  color: #ffffff;
  font-size: var(--sale-font-base);
  font-weight: 800;
}

.lines-table .num,
.text-right {
  text-align: right;
}

.item-name {
  /* display: grid;
  min-width: 129px;
  gap: 0.15rem; */
}

.line-index {
  color: var(--sale-muted);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.line-image-cell {
  text-align: center;
}

.line-image-button {
  width: calc(2.6rem * var(--sale-density-scale));
  height: calc(2.6rem * var(--sale-density-scale));
  padding: 0;
  border: 1px solid var(--sale-border);
  border-radius: 0.6rem;
  background: #fffaf5;
  color: var(--sale-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  overflow: hidden;
}

.line-image-button:hover:not(:disabled) {
  border-color: var(--sale-primary-border);
  background: var(--sale-primary-soft);
}

.line-image-button:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.line-image-button img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.line-image-button.is-empty {
  background: #fff7ed;
}

.line-image-preview-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 320px;
  max-height: 70vh;
}

.line-image-preview-wrap img {
  max-width: 100%;
  max-height: 68vh;
  object-fit: contain;
  border-radius: 0.75rem;
  border: 1px solid var(--sale-border);
}

.line-name-row {
  display: flex;
  gap: 0.45rem;
  align-items: center;
  min-width: 0;
}

.line-name-row strong {
  font-weight: 650;
  white-space: normal;
  overflow-wrap: anywhere;
}

.line-name-edit {
  cursor: pointer;
  white-space: pre-line;
  border-radius: 4px;
  transition:
    color 0.12s,
    background 0.12s;
}

.line-name-edit:hover:not(.is-locked) {
  color: var(--sale-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.line-name-edit.is-locked {
  cursor: default;
}

.line-code-stack {
  display: grid;
  gap: 0.12rem;
  min-width: 0;
  line-height: 1.2;
}

.line-barcode {
  color: var(--sale-text);
  font-weight: 850;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.line-item-code {
  color: var(--sale-muted);
  font-size: 0.82rem;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.line-remark-preview {
  display: block;
  margin-top: 0.18rem;
  color: #667085;
  font-size: 0.72rem;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.line-pro-button {
  flex: 0 0 auto;
  min-width: 0;
  padding: 0.15rem 0.45rem;
  border-radius: 6px;
  font-size: 0.72rem;
  line-height: 1;
}

.item-name small {
  color: var(--sale-muted);
  font-size: 0.72rem;
}

.item-name .line-error {
  color: var(--p-red-500);
}

.row-warning {
  background: #fef2f2;
}

.is-active > td {
  background: var(--sale-primary-soft, #fff7ed);
}

/* สินค้าชุด (item_type=3): badge บนชื่อ + แถบไฮไลท์เบาๆ ของ parent + child rows */
.line-set-badge,
.result-set-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.08rem 0.4rem;
  border-radius: 4px;
  background: rgba(249, 115, 22, 0.14);
  color: #c2410c;
  font-size: 0.7rem;
  font-weight: 600;
  white-space: nowrap;
}

.line-set-badge i,
.result-set-badge i {
  font-size: 0.7rem;
}

.row-set-parent > td {
  border-bottom-color: transparent;
}

.row-set-children > td {
  background: #fffaf5;
  border-top: 0;
  padding-top: 0.25rem;
  padding-bottom: 0.5rem;
}

.set-children-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.35rem 0.5rem;
  border-left: 3px solid var(--sale-primary);
  border-radius: 0 6px 6px 0;
}

.set-children-title {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--p-text-color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.set-children-title i {
  font-size: 0.75rem;
}

.set-children-grid {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.set-child-row {
  display: grid;
  grid-template-columns: minmax(80px, 0.8fr) minmax(160px, 2fr) minmax(110px, 1fr) minmax(110px, 1fr);
  gap: 0.5rem;
  padding: 0.2rem 0.4rem;
  font-size: 0.78rem;
  background: rgba(255, 255, 255, 0.6);
  border-radius: 4px;
  align-items: center;
}

.set-child-code {
  font-weight: 600;
  color: var(--p-text-color-secondary);
}

.set-child-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.set-child-qty,
.set-child-total {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.set-child-total {
  font-weight: 600;
  color: var(--sale-primary);
}

.cell-input {
  width: 100%;
}

.qty-cell,
.price-cell,
.action-cell {
  white-space: nowrap;
}

.price-cell {
  text-align: right !important;
}

.line-qty-stepper {
  display: grid;
  grid-template-columns:
    calc(1.75rem * var(--sale-density-scale)) minmax(0, 1fr)
    calc(1.75rem * var(--sale-density-scale));
  width: 100%;
  max-width: 8.5rem;
  gap: 0.25rem;
  align-items: center;
}

.line-qty-stepper :deep(.p-button) {
  width: calc(1.75rem * var(--sale-density-scale));
  height: calc(1.75rem * var(--sale-density-scale));
}

.line-qty-stepper :deep(.p-inputnumber) {
  width: 100%;
  min-width: 0;
}

.line-qty-stepper :deep(.line-qty-input) {
  width: 100%;
  min-width: 0;
  padding-inline: 0.45rem;
  text-align: center;
}

.line-price-button {
  display: inline-flex;
  max-width: 7.25rem;
  align-items: center;
  justify-content: flex-end;
  gap: 0.35rem;
  border: 0;
  background: transparent;
  color: var(--p-text-color);
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  padding: 0.25rem 0;
  text-align: right;
}

.line-price-button:hover:not(:disabled) {
  color: var(--p-primary-color);
}

.line-price-button .manual-price-text {
  color: #dc2626;
}

.line-price-button:disabled {
  cursor: default;
  opacity: 0.65;
}

.line-price-button i {
  color: var(--p-text-color-secondary);
  font-size: 0.78rem;
}

.bill-discount-button {
  display: inline-flex;
  width: 100%;
  min-height: 2.45rem;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border: 1px solid var(--sale-border);
  border-radius: 8px;
  background: #ffffff;
  color: var(--sale-text);
  cursor: pointer;
  font: inherit;
  font-weight: 800;
  padding: 0.45rem 0.7rem;
  text-align: left;
}

.bill-discount-button:hover:not(:disabled) {
  border-color: var(--sale-primary-border);
  background: #fff7ed;
  color: var(--sale-primary);
}

.bill-discount-button:disabled {
  cursor: not-allowed;
  opacity: 0.72;
}

.bill-discount-button span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bill-discount-button i {
  color: var(--p-text-color-secondary);
  font-size: 0.85rem;
}

.unit-cell {
  text-align: center;
  white-space: nowrap;
}

.line-unit-button {
  width: 6rem;
}

.warehouse-cell {
  width: 12rem;
}

.line-unit-button {
  display: inline-flex;
  width: 100%;
  min-height: calc(2rem * var(--sale-density-scale));
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  border: 1px solid rgba(255, 106, 0, 0.28);
  border-radius: 8px;
  background: #fffaf5;
  color: var(--sale-primary);
  cursor: pointer;
  font-size: var(--sale-font-base);
  font-weight: 750;
  padding: calc(0.25rem * var(--sale-density-scale)) calc(0.45rem * var(--sale-density-scale));
}

.line-unit-button:hover:not(:disabled) {
  border-color: var(--sale-primary-border);
  background: var(--sale-primary-soft);
}

.line-unit-button:disabled {
  cursor: default;
  opacity: 0.65;
}

.line-unit-button span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.line-unit-button i {
  flex: 0 0 auto;
  font-size: 0.72rem;
}

.line-discount-input {
  max-width: 6rem;
}

.discount-cell {
  width: 3rem;
  text-align: center;
}

.action-cell {
  text-align: center;
}

.discount-cell {
  text-align: right;
  white-space: nowrap;
}

.line-discount-value {
  display: inline-block;
  max-width: 3.75rem;
  overflow: hidden;
  color: var(--sale-primary);
  font-size: 0.86rem;
  font-weight: 850;
  line-height: 1.15;
  vertical-align: middle;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.discount-cell :deep(.p-button.p-button-text) {
  display: inline-flex;
  width: auto;
  min-width: 0;
  height: auto;
  margin-left: 0.35rem;
  padding: 0.2rem 0;
  border: 0;
  background: transparent;

  vertical-align: middle;
}

.discount-cell :deep(.p-button.p-button-text:not(:disabled):hover) {
  background: transparent;
  color: #0284c7;
}

.discount-cell :deep(.p-button-icon) {
  font-size: 1rem;
  font-weight: 800;
}

.line-edit-dialog {
  display: grid;
  gap: 0.875rem;
}

.line-edit-title {
  display: grid;
  gap: 0.15rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
  background: var(--p-surface-ground);
}

.line-edit-title strong,
.line-edit-title span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.line-edit-title span {
  color: var(--p-text-color-secondary);
  font-size: 0.78rem;
}

.permission-dialog-body {
  display: grid;
  gap: 0.85rem;
}

.permission-dialog-intro {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.75rem;
  align-items: center;
  padding: 0.75rem;
  border: 1px solid #fed7aa;
  border-radius: 8px;
  background: linear-gradient(90deg, rgba(255, 247, 237, 0.9) 0%, #ffffff 70%);
}

.permission-dialog-intro > i {
  display: inline-grid;
  width: 2.65rem;
  height: 2.65rem;
  place-items: center;
  border-radius: 8px;
  background: #ffedd5;
  color: #f97316;
  font-size: 1.2rem;
}

.permission-dialog-intro div {
  display: grid;
  min-width: 0;
  gap: 0.12rem;
}

.permission-dialog-intro strong,
.permission-dialog-intro span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.permission-dialog-intro strong {
  color: var(--sale-text);
  font-weight: 950;
}

.permission-dialog-intro span {
  color: var(--sale-muted);
  font-size: 0.86rem;
  font-weight: 700;
}

.input-mask-password {
  -webkit-text-security: disc;
}

.unit-edit-dialog {
  gap: 0.75rem;
}

:global(.line-unit-dialog.p-dialog) {
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.28);
}

:global(.line-unit-dialog.p-dialog .p-dialog-header) {
  align-items: flex-start;
  padding: 1.5rem 1.5rem 1rem;
}

:global(.line-unit-dialog.p-dialog .p-dialog-content) {
  overflow: hidden !important;
  padding: 0 1.5rem 0.75rem;
  font-size: 1.08rem;
}

:global(.line-unit-dialog.p-dialog .p-dialog-footer) {
  padding: 0.7rem 1.5rem 1.5rem;
}

:global(.line-unit-dialog.p-dialog .p-dialog-footer .p-button:not(.p-button-secondary)) {
  min-height: 2.75rem;
  border-color: transparent;
  border-radius: 8px;
  background: linear-gradient(135deg, #ff8a00 0%, #ff4d00 100%);
  font-weight: 900;
  box-shadow: 0 10px 20px rgba(249, 115, 22, 0.22);
}

.unit-product-summary {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 0.9rem;
  align-items: center;
  padding: 0.8rem 0.9rem;
  border: 1px solid #fed7aa;
  border-radius: 8px;
  background: linear-gradient(90deg, rgba(255, 247, 237, 0.84) 0%, #ffffff 62%);
  box-shadow: 0 8px 24px rgba(124, 45, 18, 0.05);
}

.unit-product-summary > div {
  display: grid;
  min-width: 0;
  gap: 0.18rem;
}

.unit-product-summary strong,
.unit-product-summary small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.unit-product-summary strong {
  color: var(--sale-text);
  font-size: 1.05rem;
  font-weight: 900;
}

.unit-product-summary small {
  color: var(--sale-muted);
  font-size: 0.9rem;
  font-weight: 700;
}

.unit-current-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 4.25rem;
  padding: 0.35rem 0.6rem;
  border: 1px solid #fb923c;
  border-radius: 8px;
  background: #fff7ed;
  color: #ea580c;
  font-weight: 950;
}

.unit-option-loading {
  display: inline-flex;
  min-height: 7rem;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  color: var(--p-text-color-secondary);
  font-weight: 700;
}

.unit-option-list {
  display: grid;
  max-height: min(420px, 58vh);
  gap: 0.55rem;
  overflow: auto;
  padding: 0.1rem 0.15rem 0.1rem 0;
}

.unit-option-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 0.75rem;
  align-items: center;
  border: 1px solid #fed7aa;
  border-radius: 8px;
  background: #ffffff;
  color: var(--sale-text);
  cursor: pointer;
  font: inherit;
  padding: 0.82rem 0.9rem;
  text-align: left;
  box-shadow: 0 8px 24px rgba(124, 45, 18, 0.05);
}

.unit-option-row:hover:not(:disabled) {
  border-color: #fb923c;
  background: #fffaf5;
}

.unit-option-row.active {
  border-color: #fb923c;
  background: linear-gradient(90deg, #fff7ed 0%, #ffffff 74%);
  box-shadow: 0 14px 30px rgba(249, 115, 22, 0.12);
}

.unit-option-row:disabled {
  cursor: not-allowed;
  opacity: 0.72;
}

.unit-option-row.insufficient {
  border-color: #fecaca;
  background: #fef2f2;
}

.unit-option-main,
.unit-option-meta {
  display: grid;
  min-width: 0;
  gap: 0.2rem;
}

.unit-option-main strong {
  color: #ea580c;
  font-size: 1.08rem;
  font-weight: 950;
}

.unit-option-main span,
.unit-option-meta span {
  overflow: hidden;
  color: var(--p-text-color-secondary);
  font-size: 0.82rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.unit-option-meta {
  min-width: 8.5rem;
  text-align: right;
}

.unit-option-meta b {
  color: var(--sale-success);
  font-size: 1rem;
}

.warehouse-balance-summary {
  display: grid;
  min-width: 7.2rem;
  gap: 0.1rem;
  justify-items: end;
  text-align: right;
}

.warehouse-balance-summary small {
  color: var(--p-text-color-secondary);
  font-size: 0.74rem;
  font-weight: 700;
}

.warehouse-balance-summary strong {
  color: var(--sale-success);
  font-size: 0.98rem;
  font-weight: 950;
  white-space: nowrap;
}

.warehouse-balance-summary span {
  color: var(--p-red-600);
  font-size: 0.74rem;
  font-weight: 850;
}

.unit-option-row.insufficient .warehouse-balance-summary strong {
  color: var(--p-red-600);
}

.unit-option-row > i {
  color: var(--sale-primary);
  font-size: 1.05rem;
}

.promotion-guide-accordion {
  display: grid;
  gap: 0.5rem;
}

.promotion-guide-accordion :deep(.p-accordionpanel) {
  overflow: hidden;
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
  background: var(--app-panel-bg);
}

.promotion-guide-accordion-title {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  width: 100%;
  min-width: 0;
  gap: 0.75rem;
  align-items: center;
}

.promotion-guide-accordion-title strong {
  color: var(--p-primary-color);
  font-weight: 800;
  overflow-wrap: anywhere;
}

.promotion-guide-accordion-title span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.promotion-guide-accordion-title small {
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  background: var(--p-surface-ground);
  color: var(--p-text-color-secondary);
  font-size: 0.72rem;
  font-weight: 800;
  white-space: nowrap;
}

.promotion-guide-accordion-title small.active {
  background: #dcfce7;
  color: #047857;
}

.promotion-guide-card {
  display: grid;
  gap: 0.75rem;
  padding-top: 0.25rem;
}

.promotion-guide-section {
  display: grid;
  gap: 0.45rem;
}

.promotion-guide-section-title {
  color: var(--p-text-color-secondary);
  font-size: 0.75rem;
  font-weight: 800;
}

.promotion-guide-items {
  display: grid;
  gap: 0.4rem;
}

.promotion-guide-item {
  display: grid;
  grid-template-columns: minmax(6rem, auto) minmax(0, 1fr) auto;
  gap: 0.65rem;
  align-items: center;
  padding: 0.55rem 0.65rem;
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
  background: var(--p-surface-ground);
}

.promotion-guide-item.matched {
  border-color: color-mix(in srgb, var(--p-primary-color) 35%, var(--p-surface-border));
  background: color-mix(in srgb, var(--p-primary-color) 8%, var(--p-surface-ground));
}

.promotion-guide-item.action {
  border-color: color-mix(in srgb, var(--p-green-500) 35%, var(--p-surface-border));
}

.promotion-guide-item.reward {
  border-color: #fed7aa;
  background: #fff7ed;
}

.promotion-guide-item strong,
.promotion-guide-item span,
.promotion-guide-item small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.promotion-guide-item strong {
  color: var(--p-text-color);
  font-weight: 800;
}

.promotion-guide-item small,
.promotion-guide-empty {
  color: var(--p-text-color-secondary);
  font-size: 0.76rem;
}

.promotion-guide-empty {
  padding: 0.55rem 0.65rem;
  border: 1px dashed var(--p-surface-border);
  border-radius: 8px;
  background: var(--p-surface-ground);
}

.strong {
  font-weight: 800;
  /* color: var(--sale-primary); */
}

.empty-lines,
.payment-empty {
  color: var(--p-text-color-secondary);
  padding: 1rem;
  text-align: center;
}

.summary-list,
.payment-summary {
  display: grid;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.summary-list > div,
.payment-summary > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}

.summary-list .net {
  margin-top: 0.25rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--sale-border);
}

.summary-list .net strong {
  color: var(--sale-net);
  font-size: calc(1.35rem * var(--sale-font-scale));
}

.net .net-name2 {
  opacity: 0;
  transition: opacity 0.15s ease;
}

.net:hover .net-name2 {
  opacity: 1;
}

.promotion-panel {
  display: grid;
  gap: 0.625rem;
  padding: 0.75rem;
  border: 1px solid var(--sale-border);
  border-radius: 8px;
  background: #fffaf5;
}

.sale-benefit-panel {
  padding: 0.55rem;
}

.sale-benefit-grid {
  /* row-gap: 0.2rem; */
}

.sale-benefit-title-row {
  margin-right: -0.25rem;
  margin-left: -0.25rem;
  row-gap: 0.25rem;
}

.sale-benefit-title-row > div:first-child {
  display: grid;
  min-width: 0;
  gap: 0.125rem;
}

.sale-benefit-title-row span,
.sale-benefit-summary-section span,
.sale-benefit-summary-section small,
.sale-benefit-detail-head span,
.sale-benefit-detail-head small {
  color: var(--p-text-color-secondary);
  font-size: var(--sale-font-small);
}

.sale-benefit-title-row strong,
.sale-benefit-summary-section strong,
.sale-benefit-detail-head strong {
  font-size: var(--sale-font-base);
}

.sale-benefit-title-row > div:first-child > strong,
.sale-benefit-summary-section > div:first-child > strong,
.sale-benefit-detail-head strong {
  font-size: var(--sale-font-strong);
}

.sale-benefit-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  justify-content: flex-end;
  padding-top: 0;
  margin-bottom: -0.35rem;
}

.sale-benefit-actions :deep(.p-button) {
  font-size: var(--sale-font-control);
}

.sale-benefit-summary-section {
  display: grid;
  min-height: 100%;
  gap: 0.3rem;
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--sale-border);
  border-radius: 8px;
}

.sale-benefit-summary-section > div:first-child,
.sale-benefit-summary-meta {
  display: grid;
  min-width: 0;
  gap: 0.125rem;
}

.sale-benefit-summary-meta > span,
.sale-benefit-summary-meta > strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sale-benefit-summary-section > div:first-child {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
}

.sale-benefit-summary-section > div:first-child small {
  grid-column: 1 / -1;
}

.sale-benefit-error {
  color: var(--p-red-600) !important;
}

.sale-benefit-detail-dialog :deep(.p-dialog-content) {
  overflow: auto;
}

.sale-benefit-detail-body {
  min-height: 0;
}

.sale-benefit-detail-grid {
  row-gap: 0.75rem;
}

.sale-benefit-detail-section {
  display: grid;
  min-height: 100%;
  gap: 0.7rem;
  padding: 0.75rem;
  border: 1px solid var(--sale-border);
  border-radius: 8px;
}

.sale-benefit-detail-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: start;
}

.sale-benefit-detail-head > div {
  display: grid;
  min-width: 0;
  gap: 0.125rem;
}

.sale-benefit-detail-list {
  max-height: 52vh;
  overflow: auto;
  padding-right: 0.25rem;
}

.promotion-status-panel {
  border-color: #86efac;
  background: linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%);
}

.promotion-status-panel .promotion-panel-head span,
.promotion-status-panel .promotion-panel-head strong,
.sale-benefit-summary-section.promotion-status-panel > div:first-child span,
.sale-benefit-summary-section.promotion-status-panel > div:first-child strong,
.sale-benefit-detail-section.promotion-status-panel .sale-benefit-detail-head span,
.sale-benefit-detail-section.promotion-status-panel .sale-benefit-detail-head > div strong {
  color: #166534;
}

.receipt-campaign-panel {
  border-color: #facc15;
  background: linear-gradient(180deg, #fefce8 0%, #ffffff 100%);
}

.receipt-campaign-panel .promotion-panel-head span,
.receipt-campaign-panel .promotion-panel-head strong,
.sale-benefit-summary-section.receipt-campaign-panel > div:first-child span,
.sale-benefit-summary-section.receipt-campaign-panel > div:first-child strong,
.sale-benefit-detail-section.receipt-campaign-panel .sale-benefit-detail-head span,
.sale-benefit-detail-section.receipt-campaign-panel .sale-benefit-detail-head > div strong {
  color: #a16207;
}

.promotion-panel-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: start;
}

.promotion-panel-head > div {
  display: grid;
  gap: 0.125rem;
}

.promotion-panel-head span,
.promotion-panel-head small,
.promotion-related > span,
.promotion-related-empty,
.promotion-audit-meta {
  color: var(--p-text-color-secondary);
  font-size: 1rem;
}

.promotion-panel-head strong {
  font-size: 1.2rem;
}

.promotion-panel.status-success {
  border-color: color-mix(in srgb, var(--p-green-500) 35%, var(--p-surface-border));
}

.receipt-campaign-panel.status-success {
  border-color: #facc15;
}

.promotion-panel.status-error {
  border-color: color-mix(in srgb, var(--p-red-500) 45%, var(--p-surface-border));
}

.promotion-panel.status-calculating {
  border-color: color-mix(in srgb, var(--p-primary-color) 35%, var(--p-surface-border));
}

.promotion-status-panel.status-idle,
.promotion-status-panel.status-success,
.promotion-status-panel.status-calculating {
  border-color: #86efac;
}

.receipt-campaign-panel.status-idle,
.receipt-campaign-panel.status-success,
.receipt-campaign-panel.status-calculating {
  border-color: #facc15;
}

.promotion-collapse-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.5rem;
  align-items: center;

  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
  background: var(--app-panel-bg);
}

.promotion-status-panel .promotion-collapse-row,
.promotion-status-panel .promotion-audit-card {
  border-color: #bbf7d0;
  background: #f7fee7;
}

.receipt-campaign-panel .promotion-collapse-row,
.receipt-campaign-panel .promotion-audit-card {
  border-color: #fde68a;
  background: #fffbeb;
}

.promotion-collapse-row > div {
  display: grid;
  min-width: 0;
  gap: 0.15rem;
}

.promotion-collapse-row span {
  color: var(--p-text-color-secondary);
  font-size: 1rem;
  font-weight: 700;
}

.promotion-collapse-row strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.promotion-audit-list {
  display: grid;
  gap: 0.625rem;
}

.promotion-audit-card {
  display: grid;
  gap: 0.5rem;
  padding-top: 0.5rem;
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
  background: var(--app-panel-bg);
}

.promotion-audit-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: start;
}

.promotion-audit-main > div {
  display: grid;
  min-width: 0;
  gap: 0.125rem;
}

.promotion-qty {
  font-size: 1.05rem;
  color: #43a047;
}

.promotion-code {
  width: fit-content;

  border: 1px solid var(--p-surface-border);
  border-radius: 6px;
  color: var(--p-text-color-secondary);
  font-size: 1rem;
}

.promotion-audit-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.promotion-related {
  display: grid;
  gap: 0.25rem;
}

.promotion-related-list {
  display: grid;
  gap: 0.2rem;
}

.promotion-related-list small {
  color: var(--p-text-color);
}

.discount {
  color: var(--p-red-500);
}

.payment-hero {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.55rem;
  align-items: stretch;
  margin-bottom: 0.75rem;
}

.payment-hero > div {
  display: grid;
  gap: 0.2rem;
  min-width: 0;
  min-height: 70px;
  padding: 0.65rem;
  border: 1px solid rgba(255, 255, 255, 0.62);
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.96) 0%, rgba(255, 247, 237, 0.94) 100%);
  box-shadow: 0 10px 24px rgba(249, 115, 22, 0.14);
}

.payment-hero span {
  color: var(--sale-muted);
  font-size: 0.72rem;
  font-weight: 800;
  line-height: 1.25;
}

.payment-hero strong {
  overflow: hidden;
  color: var(--sale-text);
  font-size: 1rem;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.payment-hero .attention {
  border-color: #fed7aa;
  background: var(--sale-warning-soft);
}

.payment-hero .attention strong {
  color: var(--sale-warning);
}

.payment-hero .success {
  border-color: #a7f3d0;
  background: #ecfdf5;
}

.payment-hero .success strong {
  color: #047857;
}

.payment-hero :deep(.p-button) {
  grid-column: 1 / -1;
  min-height: 2.7rem;
  width: 100%;
  position: relative;
  z-index: 2;
  border-color: transparent;
  background: var(--sale-gradient);
  color: #ffffff;
  box-shadow: 0 10px 22px rgba(249, 115, 22, 0.24);
}

.payment-hero :deep(.p-button.p-disabled),
.payment-hero :deep(.p-button:disabled) {
  opacity: 1;
  border-color: rgba(255, 255, 255, 0.18);
  background: linear-gradient(135deg, rgba(255, 138, 0, 0.72) 0%, rgba(255, 61, 0, 0.72) 100%);
  color: rgba(255, 255, 255, 0.94);
}

.payment-hero :deep(.p-button.p-disabled .p-button-icon),
.payment-hero :deep(.p-button.p-disabled .p-button-label),
.payment-hero :deep(.p-button:disabled .p-button-icon),
.payment-hero :deep(.p-button:disabled .p-button-label) {
  color: rgba(255, 255, 255, 0.94);
}

.payment-detail-panel {
  display: grid;
  gap: 0.625rem;
  margin: 0.85rem 0 0.75rem;
  padding: 0.75rem;
  border: 1px solid var(--sale-border);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 10px 24px rgba(249, 115, 22, 0.08);
}

.payment-detail-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
}

.payment-detail-head span {
  color: var(--p-text-color-secondary);
  font-size: 0.76rem;
}

.payment-detail-grid {
  display: grid;
  gap: 0.35rem;
}

.payment-detail-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  color: var(--p-text-color-secondary);
  font-size: 0.82rem;
}

.payment-detail-row strong {
  color: var(--sale-text);
  font-variant-numeric: tabular-nums;
}

.payment-detail-row.strong {
  margin-top: 0.25rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--sale-border);
  color: var(--sale-text);
  font-weight: 800;
}

.payment-detail-row.strong strong {
  color: var(--sale-accent);
  font-size: 1.05rem;
}

.payment-detail-row.muted {
  opacity: 0.58;
}

.payment-detail-row.attention strong {
  color: var(--sale-warning);
}

.payment-breakdown {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.payment-breakdown span {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.18rem 0.45rem;
  border: 1px solid var(--sale-border);
  border-radius: 999px;
  background: #f8fbff;
  color: var(--sale-muted);
  font-size: 0.72rem;
}

.payment-breakdown b {
  color: var(--sale-text);
  font-weight: 800;
}

.pay-tabs {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.4rem;
  margin-bottom: 0.75rem;
}

.pay-tabs button {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  border: 1px solid var(--sale-border);
  border-radius: 8px;
  background: #ffffff;
  color: #344054;
  cursor: pointer;
  flex-direction: column;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 800;
  line-height: 1.12;
  min-height: 3.25rem;
  padding: 0.45rem 0.25rem;
  text-align: center;
  white-space: normal;
}

.pay-tabs button i {
  font-size: 1rem;
}

.pay-tabs button.active {
  border-color: #e87e2c;
  background: linear-gradient(135deg, #fff4e8 0%, #ffe1c2 100%);
  color: #e87e2c;
  font-weight: 800;
}

.pay-tabs button.active .pay-tab-index {
  background: #e87e2c;
  color: #fff;
}

.pay-tabs button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.pay-form {
  min-width: 0;
}

.pay-form-cash {
  display: grid;
  gap: 0.625rem;
}

.pay-form-grid {
  align-items: flex-start;
}

.payment-master-note {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: -0.2rem;
  padding: 0.3rem !important;
  border: 1px solid var(--sale-border);
  border-radius: 8px;
  background: #f7faff;
}

.payment-master-note span {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  padding: 0.18rem 0.45rem;
  border: 1px solid var(--sale-primary-border);
  border-radius: 999px;
  background: var(--sale-primary-soft);
  color: #1e3a8a;
  font-size: var(--sale-font-base);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cash-currency-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}

.cash-currency-grid--3col {
  grid-template-columns: 1fr 1fr 1fr;
  align-items: end;
}

.transfer-account-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: calc(0.75rem * var(--sale-density-scale));
  align-items: flex-start;
}

.cheque-bank-info-grid {
  align-items: flex-start;
}

.transfer-static-qr-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--sale-gap);
}

.transfer-static-qr-actions button {
  display: inline-flex;
  min-height: calc(4.2rem * var(--sale-density-scale));
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  border: 1px solid var(--sale-border);
  border-radius: 8px;
  background: #ffffff;
  color: var(--sale-primary);
  cursor: pointer;
  font: inherit;
  font-size: var(--sale-font-control);
  font-weight: 950;
  box-shadow: 0 8px 18px rgba(249, 115, 22, 0.06);
}

.transfer-static-qr-actions button:hover,
.transfer-static-qr-actions button.active {
  border-color: var(--sale-primary-border);
  background: var(--sale-primary-soft);
  color: var(--sale-primary);
}

.pay-form-transfer {
  display: grid;
  gap: calc(0.85rem * var(--sale-density-scale));
  min-width: 0;
}

.pay-form-transfer .field {
  margin: 0;
}

.transfer-account-book {
  display: grid;
  gap: 0.35rem;
  min-width: 0;
}

.transfer-account-book :deep(.p-select) {
  width: 100%;
  max-width: 100%;
}

.transfer-account-book :deep(.p-select-label) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transfer-input-panel,
.transfer-calc-panel {
  display: grid;
  gap: calc(0.75rem * var(--sale-density-scale));
  padding: calc(1rem * var(--sale-density-scale));
  border: 1px solid #fed7aa;
  border-radius: 8px;
  background: linear-gradient(180deg, #fffaf5 0%, rgba(255, 255, 255, 0.92) 100%);
}

.transfer-input-panel h3,
.transfer-calc-panel h3 {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  color: #7c5740;
  font-size: var(--sale-font-base);
  font-weight: 950;
}

.pay-form-transfer .field > span {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.pay-form-transfer .field small {
  display: block;
  margin-top: 0.3rem;
  color: #7c5740;
  font-size: var(--sale-font-small);
  font-weight: 700;
}

.transfer-info-icon {
  color: #64748b;
  font-size: 0.78em;
}

.transfer-calc-rows {
  display: grid;
  gap: calc(0.45rem * var(--sale-density-scale));
}

.transfer-calc-rows > div {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  gap: calc(1rem * var(--sale-density-scale));
  color: var(--sale-text);
}

.transfer-calc-rows span {
  min-width: 0;
  overflow: hidden;
  color: var(--sale-text);
  font-size: var(--sale-font-strong);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transfer-calc-rows b {
  color: var(--sale-text);
  font-size: var(--sale-font-strong);
  font-weight: 950;
  font-variant-numeric: tabular-nums;
}

.transfer-add-row :deep(.p-button) {
  width: 100%;
  min-height: calc(3.35rem * var(--sale-density-scale));
  border: 0;
  background: linear-gradient(135deg, #10b981 0%, #00b871 100%);
  color: #ffffff;
  font-weight: 900;
  box-shadow: 0 12px 24px rgba(16, 185, 129, 0.18);
}

.transfer-add-row :deep(.p-button:not(:disabled):hover) {
  background: linear-gradient(135deg, #059669 0%, #00a868 100%);
}

:global(.transfer-static-qr-dialog.p-dialog .p-dialog-title) {
  color: var(--sale-text);
  font-size: var(--sale-font-title);
  font-weight: 950;
}

.transfer-static-qr-dialog-body {
  display: grid;
  justify-items: center;
  gap: 0.85rem;
  padding: 0.5rem 0 0.25rem;
}

.transfer-static-qr-dialog-body strong {
  color: var(--sale-primary);
  font-size: var(--sale-font-title);
  font-weight: 950;
}

.transfer-static-qr-dialog-body img {
  width: min(360px, 100%);
  border: 1px solid var(--sale-border);
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.12);
}

.kip-suggested-field :deep(.p-inputnumber-input) {
  min-height: calc(3.1rem * var(--sale-density-scale));
  border-color: #16a34a !important;
  color: #15803d;
  font-size: var(--sale-font-title) !important;
  font-weight: 950;
  font-variant-numeric: tabular-nums;
}

.kip-rounding-diff-field :deep(.p-inputnumber-input) {
  color: #b45309;
  font-weight: 950;
}

.kip-auto-rounding-btn {
  width: 100%;
  margin-bottom: 1rem;
  min-height: calc(3.35rem * var(--sale-density-scale));
  background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 60%, #d97706 100%) !important;
  border: none !important;
  color: #1c1917 !important;
  font-weight: 800 !important;
  box-shadow:
    0 4px 16px rgba(245, 158, 11, 0.45),
    0 1px 4px rgba(180, 83, 9, 0.2) !important;
  transition:
    box-shadow 0.15s,
    transform 0.1s !important;
}

.kip-auto-rounding-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #fcd34d 0%, #fbbf24 60%, #f59e0b 100%) !important;
  box-shadow:
    0 6px 22px rgba(245, 158, 11, 0.55),
    0 2px 6px rgba(180, 83, 9, 0.25) !important;
  transform: translateY(-1px);
}

.kip-auto-rounding-btn:disabled {
  opacity: 0.5 !important;
  box-shadow: none !important;
}

.cash-converted-preview {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.55rem 0.7rem;
  border: 1px solid #a7f3d0;
  border-radius: 8px;
  background: #ecfdf5;
}

.cash-converted-preview span {
  color: #047857;
  font-size: var(--sale-font-base);
}

.cash-converted-preview strong {
  color: #065f46;
  font-size: var(--sale-font-strong);
}

.lao-qr-form {
  align-content: start;
}

.lao-qr-channel-row {
  display: flex;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.7rem;
}

.lao-qr-channel-button {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  min-height: 4.8rem;
  width: 20rem;
  align-items: center;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
  border: 1px solid #f4d2b6;
  border-radius: 12px;
  background: linear-gradient(180deg, #ffffff 0%, #fffaf5 100%);
  color: var(--sale-text);
  font-weight: 900;
  cursor: pointer;
  text-align: left;
  box-shadow: 0 10px 22px rgba(15, 23, 42, 0.06);
  transition:
    transform 0.16s ease,
    border-color 0.16s ease,
    background 0.16s ease,
    box-shadow 0.16s ease;
}

.lao-qr-channel-button:hover:not(:disabled) {
  border-color: #fb923c;
  background: #fff7ed;
  color: #ea580c;
  transform: translateY(-1px);
  box-shadow: 0 14px 26px rgba(249, 115, 22, 0.14);
}

.lao-qr-channel-button.active {
  border-color: #22c55e;
  background: linear-gradient(180deg, #dcfce7 0%, #f0fdf4 100%);
  color: #15803d;
  box-shadow: 0 14px 28px rgba(21, 128, 61, 0.18);
}

.lao-qr-channel-button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.lao-qr-channel-icon {
  display: inline-grid;
  width: 2.75rem;
  height: 2.75rem;
  place-items: center;
  border-radius: 10px;
  background: #ffedd5;
  color: #ea580c;
  font-size: 1.35rem;
}

.lao-qr-channel-button.active .lao-qr-channel-icon {
  background: #22c55e;
  color: #ffffff;
}

.lao-qr-channel-copy {
  display: grid;
  min-width: 0;
  gap: 0.12rem;
}

.lao-qr-channel-copy strong {
  overflow: hidden;
  font-size: 1.25rem;
  font-weight: 950;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lao-qr-channel-copy small {
  color: currentColor;
  font-size: 0.82rem;
  font-weight: 850;
  opacity: 0.72;
}

.lao-qr-channel-check {
  position: absolute;
  top: 0.55rem;
  right: 0.6rem;
  color: #16a34a;
  font-size: 1.1rem;
}

.lao-qr-request-list {
  display: grid;
  gap: 0.35rem;
  padding: 0.75rem;
  border: 1px solid var(--sale-border);
  border-radius: 8px;
  background: #f8fafc;
}

.lao-qr-request-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  color: var(--sale-text);
}

.lao-qr-request-list-header strong {
  font-weight: 950;
}

.lao-qr-request-list-header span {
  color: var(--sale-muted);
  font-size: 0.84rem;
  font-weight: 800;
}

.lao-qr-request-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: center;
  padding: 0.7rem;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #ffffff;
}

.lao-qr-request-item.active {
  border-color: #fdba74;
  background: #fff7ed;
}

.lao-qr-request-main {
  display: grid;
  min-width: 0;
  gap: 0.3rem;
}

.lao-qr-request-title,
.lao-qr-request-amounts,
.lao-qr-request-meta,
.lao-qr-request-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  align-items: center;
}

.lao-qr-request-title strong {
  font-weight: 950;
}

.lao-qr-request-amounts span {
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}

.lao-qr-request-meta {
  color: var(--sale-muted);
  font-size: 0.78rem;
  font-weight: 750;
  overflow-wrap: anywhere;
}

.lao-qr-request-warning {
  color: #b45309;
  font-weight: 800;
  line-height: 1.35;
}

.lao-qr-request-actions {
  justify-content: flex-end;
}

@media (max-width: 720px) {
  .lao-qr-request-item {
    grid-template-columns: 1fr;
  }

  .lao-qr-request-actions {
    justify-content: flex-start;
  }
}
.lao-qr-dialog-body {
  display: grid;
  gap: 0.3rem;
}

.lao-qr-dialog-amount-card {
  display: grid;
  gap: 0.2rem;
  padding: 0.85rem 1rem;
  border: 1px solid rgba(232, 126, 44, 0.32);
  border-radius: 12px;
  background: linear-gradient(135deg, #fff7ed 0%, #fff 100%);
  box-shadow: 0 10px 24px rgba(232, 126, 44, 0.12);
  text-align: center;
}

.lao-qr-dialog-amount-card span {
  color: #9a3412;
  font-size: 1.15rem;
  font-weight: 900;
}

.lao-qr-dialog-amount-card strong {
  color: #e84f0a;
  font-size: 2.1rem;
  font-weight: 950;
  line-height: 1.05;
}

.lao-qr-dialog-amount-card small {
  color: var(--sale-muted);
  font-weight: 700;
}

.lao-qr-countdown {
  display: grid;
  justify-self: center;
  min-width: min(240px, 100%);
  gap: 0.15rem;
  /* padding: 0.65rem 1.2rem;
  border: 1px solid rgba(148, 163, 184, 0.55);
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 10px 22px rgba(15, 23, 42, 0.08); */
  text-align: center;
}

.lao-qr-countdown span {
  color: #111827;
  font-size: 1rem;
  font-weight: 800;
}

.lao-qr-countdown strong {
  color: #e84f0a;
  font-size: 2.15rem;
  font-weight: 950;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.lao-qr-dialog-image-wrap {
  position: relative;
  display: grid;
  place-items: center;
  padding: 0.75rem;
  border: 1px solid var(--sale-border);
  border-radius: 10px;
  background: #f7faff;
}

.lao-qr-dialog-image-wrap--bcel {
  padding: 0;
  border: 0;
  background: transparent;
}

.lao-qr-dialog-image {
  width: min(320px, 100%);
  aspect-ratio: 1 / 1;
  border: 1px solid var(--sale-border);
  border-radius: 8px;
  background: #f3f6fb;
}

.qr-lao-frame {
  position: relative;
  width: min(245px, 72%);
  margin: 0 auto;
  box-sizing: border-box;
  border: 0.55rem solid #287dbb;
  border-radius: 10px;
  background: #ffffff;
}

.qr-lao-frame .lao-qr-dialog-image {
  display: block;
  width: 100%;
  border: 0;
  border-radius: 0;
  background: #ffffff;
}

.lao-qr-dialog-mark {
  position: absolute;
  width: clamp(3.2rem, 14%, 4.2rem);
  aspect-ratio: 3 / 3;
  background: #fff;
  pointer-events: none;
}

.qr-lao-frame .lao-qr-dialog-mark {
  top: 50%;
  left: 50%;
  width: clamp(2.45rem, 22%, 3.25rem);
  transform: translate(-50%, -50%);
}

.qr-lao-frame-text {
  position: absolute;
  overflow: hidden;
  color: #ffffff;
  font-size: 0.48rem;
  font-weight: 900;
  letter-spacing: 0.03em;
  line-height: 1;
  pointer-events: none;
  white-space: nowrap;
}

.qr-lao-frame-text--top {
  top: -0.5rem;
  left: 0.25rem;
  right: 0.25rem;
  text-align: center;
}

.qr-lao-frame-text--bottom {
  right: 0.25rem;
  bottom: -0.5rem;
  left: 0.25rem;
  text-align: center;
}

.qr-lao-frame-text--left,
.qr-lao-frame-text--right {
  top: 0.2rem;
  bottom: 0.2rem;
  writing-mode: vertical-rl;
}

.qr-lao-frame-text--left {
  left: -0.52rem;
  transform: rotate(180deg);
}

.qr-lao-frame-text--right {
  right: -0.52rem;
}

.lao-qr-dialog-meta {
  display: grid;
  gap: 0.3rem;
  font-size: 0.8rem;
  color: var(--sale-muted);
}

.lao-qr-waiting-note {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.6rem 0.7rem;
  margin: 0 auto;
  text-align: center;
  border: 1px solid var(--sale-primary-border);
  border-radius: 8px;
  background: #fff7ed;
  color: #9a3412;
  font-size: 0.84rem;
  line-height: 1.35;
}

.lao-qr-waiting-note i {
  margin-top: 0;
  color: var(--sale-primary);
}

.lao-qr-history-dialog :deep(.p-dialog-content) {
  display: flex;
  min-height: 0;
  flex-direction: column;
}

.lao-qr-history-dialog-body {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 0.75rem;
}

.lao-qr-history-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
  align-items: center;
  padding: 0.7rem;
  border: 1px solid var(--sale-border);
  border-radius: 8px;
  background: #f8fafc;
}

.lao-qr-history-pos {
  display: grid;
  min-width: 180px;
  max-width: 260px;
  gap: 0.1rem;
  padding-right: 0.45rem;
}

.lao-qr-history-pos span {
  color: var(--sale-muted);
  font-size: 0.78rem;
  font-weight: 800;
}

.lao-qr-history-pos strong {
  overflow: hidden;
  color: var(--sale-text);
  font-size: 0.95rem;
  font-weight: 950;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lao-qr-history-date {
  width: 10.75rem;
}

.lao-qr-history-status {
  width: 11.5rem;
}

.lao-qr-history-search {
  flex: 1 1 260px;
  min-width: 220px;
}

.lao-qr-history-dialog-table {
  min-height: 0;
  flex: 1 1 auto;
}

.lao-qr-history-dialog-table :deep(.p-datatable-table-container) {
  min-height: 0;
}

.lao-qr-history-dialog-table .num-cell {
  display: block;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.lao-qr-history-dialog-table .paid-text {
  color: var(--p-green-600);
  font-weight: 800;
}

.credit-sale-card {
  display: grid;
  gap: 0.75rem;
}

.payment-list {
  display: block;
  gap: 0.2rem;
  margin: 0.75rem 0;
}

.payment-list-side {
  height: 38vh;
  overflow: auto;
  margin: 0;
  padding-right: 0.15rem;
  font-size: 1.2rem;
}

.payment-side-list-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;

  padding-top: 0.9rem;
  border-top: 1px solid #fed7aa;
  color: var(--sale-text);
  font-weight: 900;
}

.payment-side-list-title b {
  color: var(--sale-muted);
  font-size: 1.1rem;
  font-weight: 800;
}

.payment-side-list-title span {
  color: var(--sale-muted);
  font-size: 1.1rem;
  font-weight: 800;
}

.payment-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  gap: 0.5rem;
  align-items: center;
  padding: 0.65rem;
  border: 1px solid #fed7aa;
  border-radius: 8px;
  background: #ffffff;
  margin-bottom: 0.3rem;
}

.payment-row-icon {
  display: inline-flex;
  width: 2.1rem;
  height: 2.1rem;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  font-size: 1rem;
  flex-shrink: 0;
}

.calculated-payment-row {
  grid-template-columns: auto minmax(0, 1fr) auto;
}

.payment-row div {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.payment-row span {
  color: var(--sale-muted);
  font-size: 1.2rem;
}

.payment-row b {
  color: var(--sale-accent);
}

.save-warnings {
  display: grid;
  gap: 0.35rem;
  margin: 0.75rem 0;
  color: var(--p-orange-600);
  font-size: 0.8rem;
}

.save-btn {
  width: 100%;
}

.credit-approve-dialog {
  display: grid;
  gap: 0.9rem;
}

.credit-approve-dialog ul {
  display: grid;
  gap: 0.35rem;
  margin: 0;
  padding-left: 1.1rem;
  color: var(--p-text-color-secondary);
  font-size: 0.9rem;
}

.credit-approve-dialog label {
  display: grid;
  gap: 0.35rem;
  font-weight: 700;
}

.sale-policy-dialog {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
  padding: 0.25rem 0 0.5rem;
}

.sale-policy-icon {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border-radius: 8px;
  font-size: 1.45rem;
}

.sale-policy-dialog.is-error .sale-policy-icon {
  background: #fee2e2;
  color: #dc2626;
}

.sale-policy-dialog.is-warn .sale-policy-icon {
  background: #fef3c7;
  color: #d97706;
}

.sale-policy-dialog.is-info .sale-policy-icon {
  background: #dcfce7;
  color: #047857;
}

.sale-policy-content {
  display: grid;
  min-width: 0;
  gap: 0.75rem;
}

.sale-policy-content p {
  margin: 0;
  color: var(--p-text-color);
  font-weight: 800;
  line-height: 1.45;
}

.sale-policy-content ul {
  display: grid;
  gap: 0.35rem;
  margin: 0;
  padding-left: 1.25rem;
  color: var(--p-text-muted-color);
  line-height: 1.45;
}

.sale-stock-adjust-dialog {
  display: grid;
  gap: 0.85rem;
}

.sale-stock-adjust-summary {
  gap: 0.65rem;
}

.sale-stock-adjust-summary > div {
  display: grid;
  min-width: 0;
  gap: 0.15rem;
  padding: 0.7rem;
  border: 1px solid var(--sale-border);
  border-radius: 8px;
  background: #f8fafc;
}

.sale-stock-adjust-summary span {
  color: var(--sale-muted);
  font-size: var(--sale-font-small);
  font-weight: 850;
}

.sale-stock-adjust-summary strong,
.sale-stock-adjust-summary small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sale-stock-adjust-summary strong {
  color: var(--sale-text);
  font-weight: 950;
}

.sale-stock-adjust-summary small {
  color: var(--sale-muted);
  font-weight: 750;
}

.sale-item-history-body {
  display: grid;
  gap: 0.9rem;
  min-height: 0;
}

.sale-item-history-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.sale-item-history-summary > div {
  display: grid;
  min-width: 0;
  gap: 0.18rem;
  padding: 0.75rem 0.85rem;
  border: 1px solid var(--sale-border);
  border-radius: 8px;
  background: #fffaf5;
}

.sale-item-history-summary span,
.sale-item-history-summary small {
  min-width: 0;
  overflow: hidden;
  color: var(--p-text-color-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sale-item-history-summary strong {
  min-width: 0;
  overflow: hidden;
  color: var(--sale-primary);
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sale-item-history-table :deep(.p-datatable-tbody > tr > td),
.sale-item-history-table :deep(.p-datatable-thead > tr > th) {
  white-space: nowrap;
}

.sale-price-formula-body {
  display: grid;
  gap: 0.9rem;
  min-height: 0;
}

.sale-price-formula-panels {
  display: grid;
  gap: 1rem;
  min-height: 0;
}

.sale-price-formula-panel {
  display: grid;
  min-width: 0;
  min-height: 0;
  overflow-x: auto;
  overflow-y: hidden;
  border: 1px solid var(--sale-border);
  border-radius: 8px;
  background: var(--app-panel-bg);
}

.sale-price-formula-panel-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: start;
  padding: 0.75rem 0.9rem;
  border-bottom: 1px solid var(--sale-border);
  background: #fffaf5;
}

.sale-price-formula-panel-head > div {
  display: grid;
  min-width: 0;
  gap: 0.12rem;
}

.sale-price-formula-panel-head strong,
.sale-price-formula-panel-head span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sale-price-formula-panel-head strong {
  color: var(--sale-primary);
  font-weight: 900;
}

.sale-price-formula-panel-head span {
  color: var(--p-text-color-secondary);
  font-size: 0.82rem;
}

.sale-price-formula-panel-head small {
  align-self: center;
  padding: 0.28rem 0.5rem;
  border: 1px solid rgba(34, 197, 94, 0.25);
  border-radius: 7px;
  background: #ecfdf5;
  color: var(--sale-success);
  font-size: 0.74rem;
  font-weight: 900;
  white-space: nowrap;
}

.sale-price-formula-table :deep(.p-datatable-tbody > tr > td),
.sale-price-formula-table :deep(.p-datatable-thead > tr > th) {
  white-space: nowrap;
}

.sale-price-formula-table :deep(.p-datatable-wrapper) {
  overflow-x: auto;
}

.sale-price-formula-cell {
  display: grid;
  min-width: 0;
  gap: 0.1rem;
  line-height: 1.15;
}

.sale-price-formula-cell strong,
.sale-price-formula-cell small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sale-price-formula-cell strong {
  color: var(--p-text-color);
  font-weight: 900;
}

.sale-price-formula-cell.is-formula strong {
  color: var(--p-text-color-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.84rem;
}

.sale-price-formula-cell small {
  color: var(--p-text-color-secondary);
  font-size: 0.72rem;
}

.sale-price-formula-cell.is-customer-level {
  padding: 0.25rem 0.4rem;
  border: 1px solid rgba(34, 197, 94, 0.35);
  border-radius: 7px;
  background: #ecfdf5;
}

.sale-price-formula-cell.is-customer-level strong {
  color: var(--sale-success);
}

.sale-price-formula-cell.is-formula.is-customer-level strong {
  color: var(--sale-success);
}

.save-feedback-dialog {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
  padding: 0.25rem 0 0.5rem;
}

.save-feedback-icon {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border-radius: 8px;
  font-size: 1.45rem;
}

.save-feedback-dialog.is-success .save-feedback-icon {
  background: #dcfce7;
  color: #047857;
}

.save-feedback-dialog.is-error .save-feedback-icon {
  background: #fee2e2;
  color: #dc2626;
}

.save-feedback-dialog.is-warn .save-feedback-icon {
  background: #fef3c7;
  color: #d97706;
}

.save-feedback-dialog.is-info .save-feedback-icon {
  background: #fff7ed;
  color: var(--sale-primary);
}

.save-feedback-content {
  display: grid;
  min-width: 0;
  gap: 0.75rem;
}

.save-feedback-content p {
  margin: 0;
  color: var(--p-text-color);
  font-weight: 700;
  line-height: 1.45;
}

.save-feedback-content ul {
  display: grid;
  gap: 0.45rem;
  margin: 0;
  padding-left: 1.1rem;
  color: var(--p-text-color-secondary);
  line-height: 1.45;
}

.product-results {
  display: flex;
  flex-direction: column;
  gap: 0.22rem;
  min-height: 0;
  height: 100%;
  overflow-y: auto;
  padding: 0.25rem 0.15rem 0.5rem 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.product-result-header,
.product-result-row {
  display: grid;
  grid-template-columns:
    minmax(110px, 0.7fr) 64px minmax(280px, 3.2fr) minmax(60px, 0.45fr)
    minmax(120px, 0.75fr) minmax(80px, 0.55fr) auto;
  gap: 1rem;
  align-items: center;
}

.product-result-header {
  position: sticky;
  z-index: 1;
  top: 0;
  padding: 0.55rem 0.75rem;
  border-bottom: 1px solid var(--p-surface-border);
  background-color: #fff;
  color: var(--p-text-color-secondary);
  font-size: 0.92rem;
  font-weight: 800;
}

.product-result-card {
  flex: 0 0 auto;
  overflow: hidden;
  border: 1px solid #fed7aa;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 8px 24px rgba(124, 45, 18, 0.05);
}

.product-result-card.expanded {
  border-color: #fb923c;
  background: linear-gradient(180deg, #fff7ed 0%, #ffffff 28%);
  box-shadow: 0 14px 30px rgba(249, 115, 22, 0.12);
}

.product-result-row {
  width: 100%;
  min-height: 5.25rem;
  border-bottom: 0;
  background: linear-gradient(90deg, rgba(255, 247, 237, 0.84) 0%, #ffffff 54%);
  color: var(--p-text-color);
  cursor: pointer;
  font: inherit;
  font-size: 1.08rem;
  padding: 0.75rem 0.9rem;
  text-align: left;
}

.product-result-card:nth-child(odd) .product-result-row {
  background: linear-gradient(90deg, rgba(255, 247, 237, 0.84) 0%, #ffffff 54%);
}

.product-result-row:hover {
  background: #fff7ed;
}

.result-code,
.result-image,
.result-unit,
.result-barcode,
.result-balance {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-code {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: #ea580c;
  font-weight: 950;
}

.result-code i {
  color: #f97316;
  font-size: 0.8rem;
}

.result-image {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 3.7rem;
  height: 3.7rem;
  border-radius: 8px;
  background: #fff7ed;
  color: #fb923c;
  box-shadow: inset 0 0 0 1px #ffedd5;
}

.result-image img {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  object-fit: cover;
}

.result-image i {
  position: absolute;
  font-size: 1.2rem;
}

.result-name {
  color: var(--sale-text);
  font-weight: 750;
  white-space: normal;
  overflow-wrap: break-word;
  word-break: break-word;
  align-self: center;
}

.result-unit {
  display: inline-flex;
  width: fit-content;
  max-width: 100%;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--p-text-color);
  font-weight: 850;
}

.result-barcode {
  font-variant-numeric: tabular-nums;
  color: var(--p-text-color-secondary);
}

.result-balance {
  color: var(--sale-text);
  font-weight: 950;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.result-add-button {
  justify-self: end;
  min-width: 5.25rem;
  border-radius: 8px;
  font-weight: 900;
}

.product-balance-expanded {
  display: grid;
  gap: 1rem;
  padding: 0.25rem 0.8rem 0.85rem;
  border-bottom: 0;
  background: transparent;
}

.product-balance-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.product-balance-title span {
  color: var(--sale-muted);
  font-size: 0.82rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.product-balance-branch-strip {
  display: flex;
  gap: 0.75rem;
  overflow-x: auto;
  padding: 0.1rem 0 0.25rem;
}

.product-balance-branch-strip button {
  display: inline-grid;
  grid-template-columns: auto minmax(0, 1fr);
  min-width: 12.5rem;
  gap: 0.08rem 0.7rem;
  align-items: center;
  padding: 0.78rem 1rem;
  border: 1px solid #ffedd5;
  border-radius: 8px;
  background: #ffffff;
  color: var(--sale-text);
  cursor: pointer;
  text-align: left;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.05);
}

.product-balance-branch-strip button.active {
  border-color: #fb923c;
  background: #fff7ed;
  color: #ea580c;
  box-shadow: 0 12px 26px rgba(249, 115, 22, 0.14);
}

.product-balance-branch-strip button:disabled {
  cursor: progress;
  opacity: 0.72;
}

.product-balance-branch-strip span {
  display: inline-flex;
  grid-column: 1 / -1;
  align-items: center;
  gap: 0.65rem;
  overflow: hidden;
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.product-branch-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.65rem;
  height: 1.65rem;
  border-radius: 8px;
  background: #ffedd5;
  color: #f97316;
}

.product-balance-branch-strip small {
  grid-column: 2;
  color: var(--sale-muted);
  font-size: 0.96rem;
  font-weight: 850;
}

.product-balance-table-wrap {
  overflow: hidden;
  border: 1px solid #fed7aa;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
}

.product-balance-panel-title {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.85rem 1rem 0.55rem;
  color: var(--sale-text);
}

.product-balance-panel-title > i {
  color: #f97316;
  font-size: 1rem;
}

.product-balance-panel-title strong {
  font-size: 1.05rem;
  font-weight: 950;
}

.product-balance-panel-title span {
  display: inline-flex;
  align-items: center;
  padding: 0.14rem 0.6rem;
  border: 1px solid #86efac;
  border-radius: 999px;
  background: #bbf7d0;
  color: #047857;
  font-size: 0.82rem;
  font-weight: 900;
}

.product-balance-datatable :deep(.p-datatable-table) {
  min-width: 520px;
}

.product-balance-datatable :deep(.p-datatable-thead > tr > th) {
  background: #ffffff;
  color: #374151;
  font-size: 0.95rem;
  font-weight: 900;
}

.product-balance-datatable :deep(.p-datatable-tbody > tr) {
  cursor: pointer;
}

.product-balance-datatable :deep(.p-datatable-tbody > tr:hover > td) {
  background: #fff7ed;
}

.product-balance-datatable :deep(.p-datatable-tbody > tr > td) {
  border-color: #f3f4f6;
  font-size: 1.06rem;
}

.product-balance-datatable :deep(.p-rowgroup-header td) {
  border-color: #bbf7d0;
  background: #f0fdf4;
}

.product-balance-branch {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
}

.product-balance-branch strong {
  color: #166534;
  font-weight: 950;
}

.product-balance-branch span {
  padding: 0.1rem 0.45rem;
  border: 1px solid #86efac;
  border-radius: 999px;
  background: #dcfce7;
  color: #166534;
  font-size: 0.72rem;
  font-weight: 900;
}

.product-balance-datatable :deep(.p-datatable-tbody > tr > td:last-child) {
  font-variant-numeric: tabular-nums;
}

.dialog-result-list {
  display: grid;
  max-height: min(12000px, 60vh);
  overflow-y: auto;
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
}

.print-dialog-body,
.print-form-list {
  display: grid;
  gap: 0.75rem;
}

.print-doc-no {
  font-size: 1.1rem;
  font-weight: 800;
}

.print-form-row {
  display: flex;
  gap: 0.625rem;
  align-items: flex-start;
  padding: 0.625rem;
  border: 1px solid var(--p-surface-border);
  border-radius: 8px;
}

.print-form-row.disabled {
  opacity: 0.55;
}

.print-form-row span {
  display: grid;
  gap: 0.15rem;
}

.print-form-row small {
  color: var(--p-text-color-secondary);
}

/* Professional sales screen theme overrides */
.sell-view .document-panel {
  border-top: 4px solid var(--sale-primary);
}

.sell-view .product-panel,
.sell-view .lines-panel {
  border-top: 4px solid var(--sale-primary);
}

.sell-view .additional-panel,
.sell-view .additional-more-panel {
  border-top: 4px solid var(--sale-primary-2);
}

.sell-view .doc-footer-panel {
  border-top: 4px solid var(--sale-primary);
}

.sell-view .summary-list .net strong,
.sell-view .workspace-tab-summary strong,
.sell-view .result-code,
.sell-view .result-balance {
  color: var(--sale-primary);
}

.sell-view .summary-list .discount,
.sell-view .discount,
.sell-view .item-name .line-error {
  color: var(--sale-danger);
}

.sell-view .pay-tabs button:not(.active):hover {
  border-color: var(--sale-primary-border);
  background: var(--sale-primary-soft);
  color: var(--sale-primary);
}

.sell-view .payment-summary strong,
.sell-view .payment-row b {
  color: var(--sale-primary);
}

.sell-view .payment-card .panel-title i {
  color: #ffffff;
}

.sell-view .product-panel .panel-title i,
.sell-view .lines-panel .panel-title i {
  color: var(--sale-primary);
}

.sell-view .document-panel .panel-title i {
  color: var(--sale-primary);
}

.sell-view .additional-panel .panel-title i,
.sell-view .additional-more-panel .panel-title i {
  color: var(--sale-primary);
}

.sell-view :deep(.p-button-success) {
  border-color: #2e7d32;
  background: linear-gradient(135deg, #43a047 0%, #2e7d32 100%);
  box-shadow: 0 10px 20px rgba(46, 125, 50, 0.18);
}

.sell-view :deep(.p-button:not(.p-button-outlined):not(.p-button-text):not(.p-button-secondary):not(.p-button-success):not(.p-button-danger)) {
  border-color: transparent;
  background: var(--sale-gradient);
  color: #ffffff;
  box-shadow: 0 10px 20px rgba(249, 115, 22, 0.18);
}

.sell-view .product-action-buttons :deep(.p-button) {
  border-color: transparent;
  background: var(--sale-gradient);
  color: #ffffff;
  box-shadow: 0 12px 24px rgba(249, 115, 22, 0.2);
}

.sell-view :deep(.p-button-outlined) {
  border-color: var(--sale-border-strong);
  color: #344054;
}

.sell-view :deep(.p-button-outlined:hover) {
  border-color: var(--sale-primary-border);
  background: var(--sale-primary-soft);
  color: var(--sale-primary);
}

.pos-total-card {
  gap: 1rem;
}

.pos-total-amount {
  padding: 1rem;
  border: 1px solid rgba(255, 255, 255, 0.52);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.94);
  color: var(--sale-text);
  font-size: 2rem;
  font-weight: 900;
  line-height: 1.1;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.pos-checkout-button {
  min-height: 3.25rem;
  width: 100%;
}

:global(.payment-checkout-dialog.p-dialog) {
  --sale-font-scale: 1;
  --sale-density-scale: 1;
  --sale-font-base: calc(1rem * var(--sale-font-scale));
  --sale-font-small: calc(0.86rem * var(--sale-font-scale));
  --sale-font-control: calc(1.02rem * var(--sale-font-scale));
  --sale-font-strong: calc(1.18rem * var(--sale-font-scale));
  --sale-font-title: calc(1.32rem * var(--sale-font-scale));
  --sale-gap: calc(0.5rem * var(--sale-density-scale));
  --sale-panel-padding: calc(0.75rem * var(--sale-density-scale));
  --sale-control-height: calc(2.5rem * var(--sale-density-scale));
  --sale-page-bg: #fff7ed;
  --sale-card-bg: #ffffff;
  --sale-card-muted: #fffaf5;
  --sale-border: #fed7aa;
  --sale-border-strong: #fb923c;
  --sale-text: #1f2937;
  --sale-muted: #7c5740;
  --sale-primary: #f15a00;
  --sale-primary-2: #fb923c;
  --sale-primary-soft: #fff4e8;
  --sale-primary-border: #fdba74;
  --sale-accent: #2e7d32;
  --sale-accent-soft: #f0fdf4;
  --sale-success: #2e7d32;
  --sale-warning: #ea580c;
  --sale-warning-soft: #fff7ed;
  --sale-danger: #b42318;
  --sale-net: #2e7d32;
  --sale-gradient: linear-gradient(135deg, #ff8a00 0%, #ff3d00 100%);
  --sale-gradient-soft: linear-gradient(135deg, rgba(255, 138, 0, 0.16), rgba(255, 61, 0, 0.12));
  --sale-shadow: 0 10px 28px rgba(249, 115, 22, 0.12);
  --app-panel-bg: var(--sale-card-bg);
  --app-active-bg: var(--sale-primary-soft);
  display: flex !important;
  flex-direction: column;
  width: 100vw !important;
  height: 100dvh !important;
  max-height: 100dvh !important;
  margin: 0 !important;
  border-radius: 0 !important;
  background: #fff8ef !important;
  color: var(--sale-text);
  font-size: var(--sale-font-base);
}

:global(.payment-checkout-dialog.p-dialog .p-dialog-header-actions) {
  display: none !important;
}

:global(.payment-checkout-dialog.p-dialog .p-dialog-footer) {
  flex: 0 0 auto;
  padding: calc(0.55rem * var(--sale-density-scale)) calc(1.35rem * var(--sale-density-scale));
  /* border-top: 1px solid #f8d9bd; */
  background: #fff8ef;
  display: block;
}

.payment-checkout-dialog :deep(.p-button) {
  font-size: var(--sale-font-control);
}

.payment-checkout-dialog :deep(.p-dialog-content) {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  padding: 0 calc(1.35rem * var(--sale-density-scale)) calc(1.15rem * var(--sale-density-scale));
  background: linear-gradient(180deg, #fffaf5 0%, #fff6ed 100%);
  overflow: hidden;
}

.payment-checkout-dialog :deep(.p-dialog-header) {
  flex: 0 0 auto;
  padding: calc(1.35rem * var(--sale-density-scale)) calc(1.55rem * var(--sale-density-scale)) calc(0.9rem * var(--sale-density-scale));
  border-bottom: 0;
  background: linear-gradient(180deg, #fffaf5 0%, #fff8ef 100%);
}

.payment-checkout-dialog :deep(.p-dialog) {
  max-height: 100vh;
  margin: 0;
  border-radius: 0;
  overflow: hidden;
}

.payment-dialog-header {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.payment-dialog-title {
  display: grid;
  gap: 0.15rem;
}

.payment-dialog-title > span {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  color: var(--sale-text);
  font-size: var(--sale-font-strong);
  font-weight: 900;
}

.payment-dialog-title > span i {
  color: var(--sale-accent);
}

.payment-dialog-title small {
  color: var(--sale-muted);
  font-size: var(--sale-font-small);
  font-weight: 850;
}

.payment-dialog-title > strong {
  color: var(--sale-accent);
  font-size: calc(2.1rem * var(--sale-font-scale));
  font-weight: 950;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.payment-dialog-title > strong em {
  color: var(--sale-muted);
  font-size: var(--sale-font-base);
  font-style: normal;
  font-weight: 850;
}

.payment-dialog-header-metrics,
.payment-quick-actions,
.payment-success-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.payment-dialog-header-metrics {
  justify-content: flex-end;
  align-items: center;
}

.payment-dialog-header-metrics span {
  display: grid;
  min-width: 9rem;
  gap: 0.2rem;
  padding: 0.8rem 1rem;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #f3f4f6;
  color: var(--sale-text);
  text-align: center;
}

.payment-dialog-header-metrics span.paid {
  border-color: #bbf7d0;
  background: #f0fdf4;
}

.payment-dialog-header-metrics span.due {
  border-color: #fed7aa;
  background: #fff7ed;
}

.payment-dialog-header-metrics small {
  color: var(--sale-text);
  font-size: var(--sale-font-base);
  font-weight: 900;
}

.payment-dialog-header-metrics strong {
  color: #16a34a;
  font-size: var(--sale-font-strong);
  font-weight: 950;
  font-variant-numeric: tabular-nums;
}

.payment-dialog-header-metrics span.due strong {
  color: var(--p-red-600);
}

.payment-dialog-layout {
  display: grid;
  grid-template-columns: minmax(13rem, 17vw) minmax(0, 1fr) minmax(20rem, 27vw);
  flex: 1 1 auto;
  gap: var(--sale-gap);
  min-height: 0;
  height: 100%;
  overflow: hidden;
  padding-top: var(--sale-gap);
}

.payment-dialog-methods {
  display: grid;
  align-content: start;
  gap: calc(0.2rem * var(--sale-density-scale));
  min-height: 0;
  overflow: auto;
  padding: calc(0.55rem * var(--sale-density-scale));
  border: 1px solid #f4d2b6;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 14px 34px rgba(249, 115, 22, 0.06);
}

.payment-section-title {
  color: var(--sale-text);
  font-size: var(--sale-font-base);
  font-weight: 950;
}

.payment-dialog-methods button {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  min-height: calc(3.5rem * var(--sale-density-scale));
  align-items: center;
  gap: var(--sale-gap);
  padding: calc(0.55rem * var(--sale-density-scale)) calc(0.65rem * var(--sale-density-scale));
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #ffffff;
  color: var(--sale-text);
  font-size: var(--sale-font-base);
  font-weight: 900;
  text-align: left;
  cursor: pointer;
}

.payment-dialog-methods .method-icon {
  display: inline-flex;
  width: calc(2.2rem * var(--sale-density-scale));
  height: calc(2.2rem * var(--sale-density-scale));
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: #fff;
  color: var(--sale-primary);
  font-size: var(--sale-font-strong);
}

.payment-dialog-methods .method-copy {
  display: grid;
  min-width: 0;
  gap: 0.1rem;
}

.payment-dialog-methods .method-copy strong,
.payment-dialog-methods .method-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.payment-dialog-methods .method-copy strong {
  color: var(--sale-text);
  font-size: var(--sale-font-strong);
  font-weight: 950;
}

.payment-dialog-methods .method-copy small {
  color: var(--sale-muted);
  font-size: var(--sale-font-small);
  font-weight: 800;
}

.payment-dialog-methods .method-amount {
  color: var(--sale-muted);
  font-size: var(--sale-font-small);
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}

.payment-dialog-methods .method-check {
  position: absolute;
  top: 0.35rem;
  right: 0.4rem;
  color: var(--sale-primary);
  font-size: var(--sale-font-base);
}

.payment-dialog-methods button.active {
  border-color: #ff5b0a;
  background: linear-gradient(135deg, #fff7ed 0%, #fff2e5 100%);
  color: #e87e2c;
  box-shadow: 0 12px 24px rgba(232, 126, 44, 0.14);
}

.payment-dialog-methods button.active .method-icon {
  /* background: var(--sale-gradient);
  color: #e87e2c; */
}

.payment-dialog-methods button.active .method-amount,
.payment-dialog-methods button.active .method-copy strong {
  color: var(--sale-primary);
}

.payment-dialog-form {
  display: grid;
  align-content: start;
  gap: var(--sale-gap);
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: var(--sale-panel-padding);
  border: 1px solid #f4d2b6;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.86);
  box-shadow: 0 14px 34px rgba(249, 115, 22, 0.06);
}

.payment-dialog-form .field > span {
  color: var(--sale-text);
  font-size: var(--sale-font-strong);
  font-weight: 900;
}

.payment-dialog-form :deep(.p-inputtext),
.payment-dialog-form :deep(.p-inputnumber-input),
.payment-dialog-form :deep(.p-select-label) {
  min-height: calc(2.7rem * var(--sale-density-scale));
  font-size: var(--sale-font-strong);
  font-weight: 900;
}

/* ปุ่ม icon ปฏิทิน (datepicker) ให้สูงเท่า input ในฟอร์มชำระเงิน */
.payment-dialog-form :deep(.p-datepicker-dropdown) {
  min-height: calc(2.7rem * var(--sale-density-scale));
  align-self: stretch;
}

.payment-dialog-form :deep(.p-inputnumber-input.text-right),
.payment-dialog-form .text-right {
  font-variant-numeric: tabular-nums;
}

.payment-dialog-form .payment-summary {
  gap: 0.75rem;
  margin-top: 0.35rem;
  padding-top: 0.85rem;
  border-top: 1px solid #e5e7eb;
}

.payment-dialog-form .payment-summary > div {
  font-size: var(--sale-font-base);
}

.payment-dialog-form .payment-summary strong {
  font-size: var(--sale-font-strong);
  font-weight: 950;
}

.payment-dialog-summary-panel {
  display: flex;
  flex-direction: column;
  gap: var(--sale-gap);
  margin: 0;
  min-height: 0;
  overflow: auto;
  padding: var(--sale-panel-padding);
  border: 1px solid #f4d2b6;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.86);
  box-shadow: 0 14px 34px rgba(249, 115, 22, 0.06);
  align-self: stretch;
  height: 100%;
  box-sizing: border-box;
}

.payment-action-buttons {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: auto;
}

.payment-summary-lines > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
}

.payment-summary-total-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.35rem;
  padding: 0.8rem 0.9rem;
  border-radius: 8px;
  background: var(--sale-gradient);
  color: #ffffff;
  box-shadow: 0 16px 28px rgba(249, 115, 22, 0.24);
}

.payment-summary-total-label {
  min-width: 0;
  color: #ffffff;
  font-size: var(--sale-font-base);
  font-weight: 900;
}

.payment-summary-lines span {
  color: var(--sale-text);
  font-size: var(--sale-font-base);
  font-weight: 900;
}

.payment-summary-total-card strong {
  color: #ffffff;
  font-size: calc(2rem * var(--sale-font-scale));
  font-weight: 950;
  line-height: 1;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.payment-summary-total-card small {
  font-size: calc(1.1rem * var(--sale-font-scale));
}

.payment-summary-lines {
  display: grid;
  gap: 0.85rem;
}

.payment-remaining {
  color: var(--p-red-600) !important;
}

.payment-summary-lines b {
  color: var(--sale-text);
  font-size: var(--sale-font-strong);
  font-weight: 950;
  font-variant-numeric: tabular-nums;
}

.payment-summary-lines .change-currency-values {
  display: inline-flex;
  align-items: baseline;
  justify-content: flex-end;
  flex: 1 1 auto;
  flex-wrap: wrap;
  gap: 0.15rem 0.9rem;
  margin-left: auto;
  min-width: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.payment-summary-lines .change-currency-before {
  color: var(--sale-muted);
  font-size: calc(var(--sale-font-base) * 0.9);
  font-weight: 850;
  white-space: nowrap;
}

.payment-summary-lines .change-currency-values b {
  white-space: nowrap;
}

.payment-summary-lines .rounded-amount-line :deep(.p-inputnumber-input) {
  width: 7rem;
  text-align: right;
  font-size: var(--sale-font-base);
  font-weight: 950;
  font-variant-numeric: tabular-nums;
  color: var(--sale-text);
  padding: 0.2rem 0.4rem;
}

.paid-currency-list {
  display: grid;
  gap: 0.25rem;
}

.paid-currency-summary {
  display: grid;
  gap: 0.35rem;
  text-align: right;
}

.paid-currency-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 1rem;
  align-items: center;
  color: var(--sale-muted);
  font-size: var(--sale-font-small);
  font-weight: 800;
}

.paid-currency-row span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.coupon-lookup-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.5rem;
}

.coupon-result-card {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.55rem;
  padding: 0.85rem;
  border: 1px solid #fed7aa;
  border-radius: 8px;
  background: #fff7ed;
}

.coupon-result-card > div {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
}

.coupon-result-card > div.wide {
  grid-column: 1 / -1;
}

.coupon-result-card span {
  color: #9a3412;
  font-size: var(--sale-font-small);
  font-weight: 850;
}

.coupon-result-card strong {
  min-width: 0;
  overflow: hidden;
  color: var(--sale-text);
  font-size: var(--sale-font-base);
  font-weight: 950;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.paid-currency-row b {
  color: var(--sale-text);
  font-variant-numeric: tabular-nums;
}

.payment-summary-lines .change b {
  color: #16a34a;
}

.payment-rate-strip {
  display: flex;
  align-items: center;
  gap: calc(1.25rem * var(--sale-density-scale));
  min-height: calc(2.75rem * var(--sale-density-scale));
  padding: calc(0.45rem * var(--sale-density-scale)) calc(0.75rem * var(--sale-density-scale));
  border: 1px solid #f4d2b6;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.72);
  color: var(--sale-muted);
  overflow-x: auto;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.74);
}

.rate-strip-info,
.rate-chip {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: calc(1rem * var(--sale-density-scale));
  font-size: var(--sale-font-base);
  font-weight: 850;
  white-space: nowrap;
}

.info-icon {
  gap: 0.4rem !important;
}

.rate-strip-info i {
  color: #3b82f6;
}

.rate-chip {
  padding: 0.35rem 0.65rem;
  border: 1px solid #f4d2b6;
  border-radius: 8px;
  background: #ffffff;
}

.rate-chip strong {
  /* color: var(--sale-primary); */
  font-size: var(--sale-font-strong);
  font-weight: 950;
}

.rate-chip-name2 {
  opacity: 0;
  transition: opacity 0.15s ease;
}

.rate-chip:hover .rate-chip-name2 {
  opacity: 1;
}

.cash-tender-input {
  width: 100%;
  min-height: calc(3.1rem * var(--sale-density-scale));
  border-color: #ff5b0a !important;
  color: var(--sale-primary) !important;
  font-size: var(--sale-font-title) !important;
  font-weight: 950 !important;
  font-variant-numeric: tabular-nums;
}

/* InputNumber ส่ง class ไปที่ input ชั้นใน (PrimeVue render) ที่ไม่มี scoped attr — ใช้ :deep ทะลุ scope */
.pay-form-transfer :deep(.cash-tender-input) {
  min-height: calc(3.1rem * var(--sale-density-scale));
  border-color: #ff5b0a !important;
  color: var(--sale-primary) !important;
  font-size: var(--sale-font-title) !important;
  font-weight: 950 !important;
  font-variant-numeric: tabular-nums;
}

.cash-pos-panel {
  display: grid;
  gap: 0.75rem;
}

.cash-currency-tabs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 0.5rem;
}

.cash-currency-tabs button {
  position: relative;
  display: grid;
  min-height: 3.55rem;
  align-content: center;
  gap: 0.12rem;
  padding: 0.55rem 0.65rem;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #ffffff;
  color: var(--sale-text);
  cursor: pointer;
  text-align: left;
  transition:
    transform 0.16s ease,
    border-color 0.16s ease,
    background 0.16s ease,
    box-shadow 0.16s ease;
}

.cash-currency-tabs button.active {
  border-color: #22c55e;
  background: linear-gradient(180deg, #ecfdf5 0%, #ffffff 100%);
  color: #15803d;
  box-shadow: 0 10px 20px rgba(21, 128, 61, 0.12);
}

.cash-currency-tabs button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.cash-currency-tabs strong {
  font-size: var(--sale-font-strong);
  font-weight: 950;
}

.cash-currency-tabs span {
  overflow: hidden;
  color: currentColor;
  font-size: var(--sale-font-base);
  font-weight: 800;
  opacity: 0.78;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cash-currency-tabs-inline {
  margin-bottom: 0.85rem;
  padding: 0.45rem;
  background: rgba(255, 255, 255, 0.68);
  grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr));
  gap: 0.55rem;
}

.cash-currency-tabs-inline button {
  min-height: 4.45rem;
  padding: 0.7rem 0.95rem;
  border: 1px solid #e7c6a9;
  border-radius: 10px;
  background: linear-gradient(180deg, #ffffff 0%, #fffaf5 100%);
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.06);
  text-align: center;
}

.cash-currency-tabs-inline button:hover:not(:disabled) {
  border-color: #fb923c;
  background: #fff7ed;
  color: #ea580c;
  transform: translateY(-1px);
}

.cash-currency-tabs-inline button.active {
  border-color: #22c55e;
  background: linear-gradient(180deg, #dcfce7 0%, #f0fdf4 100%);
  box-shadow: 0 12px 24px rgba(21, 128, 61, 0.18);
  color: #15803d;
}

.cash-currency-tabs-inline button.active::after {
  content: "✓";
  position: absolute;
  top: 0.45rem;
  right: 0.55rem;
  display: inline-grid;
  width: 1.35rem;
  height: 1.35rem;
  place-items: center;
  border-radius: 999px;
  background: #22c55e;
  color: #ffffff;
  font-size: var(--sale-font-small);
  font-weight: 950;
}

.cash-quick-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.5rem;
}

.cash-quick-grid button {
  font-size: var(--sale-font-title);
  font-weight: 900 !important;
}

.cash-quick-grid :deep(.p-button),
.cash-action-row :deep(.p-button) {
  min-height: calc(2.85rem * var(--sale-density-scale));
  justify-content: center;
  font-weight: 900;
}

.payment-quick-actions :deep(.lao-qr-create-button) {
  flex: 1 1 100%;
  width: 100%;
  justify-content: center;
  min-height: calc(3rem * var(--sale-density-scale));
  font-weight: 900;
  font-size: var(--sale-font-strong);
}

.cash-keypad {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
}

.cash-keypad button {
  display: inline-flex;
  min-height: calc(4rem * var(--sale-density-scale));
  align-items: center;
  justify-content: center;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #ffffff;
  color: var(--sale-text);
  font-size: var(--sale-font-title);
  font-weight: 950;
  cursor: pointer;
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.05);
}

.cash-keypad button:hover:not(:disabled) {
  border-color: var(--sale-primary-border);
  background: var(--sale-primary-soft);
  color: var(--sale-primary);
}

.cash-keypad button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.payment-save-button {
  min-height: calc(4.6rem * var(--sale-density-scale));
  width: 100%;
  border-color: transparent !important;
  background: linear-gradient(135deg, #22c55e 0%, #15803d 100%) !important;
  color: #ffffff !important;
  font-size: calc(1.55rem * var(--sale-font-scale));
  font-weight: 900;
}

.payment-save-button.is-ready {
  min-height: calc(3.5rem * var(--sale-density-scale));
  box-shadow: 0 16px 30px rgba(21, 128, 61, 0.3);
  transform: translateY(-1px);
}

.payment-close-button {
  font-size: var(--sale-font-strong);
  min-height: calc(2.85rem * var(--sale-density-scale));
  width: 100%;
  border-color: transparent !important;
  background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%) !important;
  color: #ffffff !important;
  font-weight: 950;
  box-shadow: 0 12px 22px rgba(185, 28, 28, 0.18);
}

.payment-success-step {
  display: grid;
  justify-items: center;
  gap: var(--sale-gap);
  padding: calc(2rem * var(--sale-density-scale)) calc(1rem * var(--sale-density-scale));
  text-align: center;
}

.payment-success-step > i {
  color: #10b981;
  font-size: calc(2.4rem * var(--sale-font-scale));
}

.payment-success-step > span {
  color: var(--sale-muted);
  font-weight: 800;
}

.payment-success-step > strong {
  color: var(--sale-text);
  font-size: var(--sale-font-title);
}

.payment-success-grid {
  display: grid;
  width: min(620px, 100%);
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.65rem;
}

.payment-success-grid > div {
  display: grid;
  gap: 0.25rem;
  padding: 0.75rem;
  border: 1px solid var(--sale-border);
  border-radius: 8px;
  background: #f7faff;
}

.payment-success-grid small {
  color: var(--sale-primary);
  font-weight: 800;
  line-height: 1.2;
}

@media (max-width: 1180px) {
  .sell-view {
    height: auto;
    min-height: 100dvh;
    overflow: auto;
  }

  .sell-grid,
  .document-workspace,
  .details-split-layout {
    min-height: 0;
    overflow: visible;
  }

  .details-split-layout {
    grid-template-columns: 1fr;
    height: auto;
  }

  .details-split-layout .product-panel {
    min-height: 0;
    overflow: visible;
  }

  .details-summary-slot {
    height: auto;
    overflow: visible;
  }

  .details-summary-slot .doc-footer-panel {
    height: auto;
    max-height: none;
    overflow: visible;
  }

  .lines-table-wrap {
    flex: 0 0 auto;
    height: min(56dvh, 36rem);
    min-height: 18rem;
  }

  .doc-footer-grid {
    grid-template-columns: 1fr;
  }

  .doc-footer-left {
    order: 2;
  }

  .doc-footer-right {
    order: 1;
  }

  .sell-status-bar {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .payment-card {
    grid-column: 1;
    max-height: none;
  }

  .payment-dialog-layout {
    grid-template-columns: 1fr;
    height: auto;
    overflow: visible;
  }

  .payment-checkout-dialog :deep(.p-dialog-content) {
    overflow: auto;
  }

  .payment-dialog-methods {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    overflow: visible;
    padding-right: 0;
  }

  .payment-dialog-form {
    border: 0;
    overflow: visible;
    padding-inline: 0;
  }

  .payment-dialog-summary-panel {
    margin-left: 0;
    overflow: visible;
  }

  .cash-quick-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 767px) {
  .header-actions,
  .workspace-tabs,
  .workspace-tab-summary,
  .payment-hero,
  .product-tools,
  .doc-grid,
  .extra-doc-grid,
  .extra-grid-2,
  .wht-header-form,
  .vat-toolbar,
  .extra-inline-form,
  .extra-inline-form.gl-form,
  .wht-detail-row,
  .wht-header-row,
  .cash-currency-grid,
  .transfer-account-grid,
  .doc-footer-inline-grid {
    grid-template-columns: 1fr;
  }

  .header-actions {
    width: 100%;
    flex-direction: column;
    align-items: stretch;
  }

  .workspace-tabs-card {
    padding: 0.65rem;
  }

  .workspace-tabs button {
    justify-content: flex-start;
  }

  .workspace-tab-summary strong {
    text-align: left;
  }

  .sell-status-bar {
    grid-template-columns: 1fr;
    border-radius: 8px;
  }

  .status-metric,
  .status-total,
  .status-state,
  .status-save-wrap,
  .status-save-btn {
    width: 100%;
    justify-content: center;
  }

  .status-save-wrap {
    flex-wrap: wrap;
  }

  .status-drawer-btn {
    flex: 1 1 9rem;
  }

  .field.wide,
  .entity-field,
  .wide-local {
    grid-column: auto;
  }

  .mini-row,
  .mini-row.gl-row {
    grid-template-columns: 1fr;
    align-items: start;
  }

  .entity-picker,
  .dialog-search-row {
    flex-direction: column;
  }

  .product-result-header {
    display: none;
  }

  .product-results {
    max-height: none;
  }

  .product-result-row {
    grid-template-columns: 1fr;
    gap: 0.25rem;
    align-items: start;
    min-height: 0;
  }

  .result-add-button {
    justify-self: stretch;
    margin-top: 0.35rem;
  }

  .product-balance-title {
    align-items: flex-start;
    flex-direction: column;
  }

  .result-code,
  .result-name,
  .result-unit,
  .result-barcode,
  .result-balance {
    white-space: normal;
  }

  .result-barcode,
  .result-balance {
    font-size: 0.82rem;
  }

  .result-balance {
    text-align: left;
  }
}

.additional-more-panel .additional-more-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem;
  margin-bottom: 0.75rem;
}

.additional-more-panel .additional-remarks-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem;
}

/* ── ดึงเอกสารอ้างอิง ───────────────────────────────────── */
.ref-doc-slot {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-width: 0;
}
.ref-doc-slot > label {
  font-weight: 700;
  color: var(--text-color, #1f2937);
}
.ref-doc-slot :deep(.p-button.p-button-sm.p-button-text) {
  font-size: 1rem;
}
.ref-doc-slot :deep(.ref-doc-action-button.p-button) {
  width: fit-content;
  min-height: var(--sale-control-height);
  padding: 0.55rem 0.95rem;
  font-size: 1rem;
  font-weight: 800;
  box-shadow: none;
}
.ref-doc-slot :deep(.ref-doc-action-button.p-button:focus-visible) {
  box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.14);
}
.ref-doc-slot :deep(.ref-doc-action-button.is-compact.p-button) {
  min-height: 2.35rem;
  padding: 0.45rem 0.8rem;
  font-size: 0.95rem;
  box-shadow: none;
}
.ref-doc-table-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 0.65rem;
}
.ref-doc-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 1.2rem;
  background: var(--surface-50, #fafafa);
  border: 1px solid var(--surface-border, #e5e7eb);
  border-radius: 6px;
  overflow: hidden;
}
.ref-doc-table thead th {
  text-align: left;
  font-weight: 600;
  color: var(--text-color-secondary, #64748b);
  padding: 4px 8px;
  background: var(--surface-100, #f1f5f9);
  font-size: 1.2rem;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.ref-doc-table tbody td {
  padding: 3px 8px;
  border-top: 1px solid var(--surface-border, #e5e7eb);
  vertical-align: middle;
}
.ref-doc-table .ref-doc-no {
  font-weight: 600;
  color: var(--sale-primary);
  font-variant-numeric: tabular-nums;
}
.ref-doc-table .ref-doc-date {
  color: var(--text-color-secondary, #64748b);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.ref-doc-table td:last-child {
  width: 28px;
  text-align: right;
}
.ref-type-pill {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 600;
  background: var(--surface-200, #e2e8f0);
  color: var(--text-color, #334155);
  white-space: nowrap;
}
.ref-type-pill[data-type="1"],
.ref-type-pill[data-type="30"],
.ref-type-pill[data-type="32"] {
  background: #ffedd5;
  color: #9a3412;
} /* ใบเสนอราคา */
.ref-type-pill[data-type="2"],
.ref-type-pill[data-type="34"],
.ref-type-pill[data-type="37"] {
  background: #fef3c7;
  color: #92400e;
} /* ใบสั่งจอง */
.ref-type-pill[data-type="3"],
.ref-type-pill[data-type="36"] {
  background: #dcfce7;
  color: #166534;
} /* ใบสั่งขาย */
.ref-doc-table.is-readonly {
  opacity: 0.85;
  background: var(--surface-100, #f1f5f9);
}
.ref-doc-table.is-readonly td:last-child {
  width: auto;
}

.transport-type-select :deep(.p-togglebutton.p-togglebutton-checked) {
  background: var(--sale-gradient);
  border-color: var(--sale-primary);
  color: #ffffff;
}
.transport-type-select :deep(.p-togglebutton.p-togglebutton-checked .p-togglebutton-content) {
  background: transparent;
  box-shadow: none;
}
.transport-type-select :deep(.p-togglebutton.p-togglebutton-checked .p-togglebutton-label),
.transport-type-select :deep(.p-togglebutton.p-togglebutton-checked .p-togglebutton-icon) {
  color: #ffffff;
}
</style>
