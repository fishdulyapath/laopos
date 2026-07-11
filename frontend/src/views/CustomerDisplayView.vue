<script setup>
import { computed, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import laoQrMarkImage from "@/assets/laoqr.svg";
import onePayMarkImage from "@/assets/onepay.png";
import bankIconImage from "@/assets/bankicon.png";
import welcomeImage from "@/assets/welcome.png";
import thankyouImage from "@/assets/thankyou.png";
import api from "@/services/api";
import { productImageUrl } from "@/utils/imageUrls";
import { DEFAULT_CUSTOMER_DISPLAY_CURRENCY_CODE } from "@/utils/posDeviceSettings";

const mockLaoQrImage =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'%3E%3Crect width='256' height='256' rx='24' fill='white'/%3E%3Crect x='20' y='20' width='216' height='216' rx='16' fill='white' stroke='%23111827' stroke-width='8'/%3E%3Cg fill='%23111827'%3E%3Crect x='36' y='36' width='52' height='52'/%3E%3Crect x='48' y='48' width='28' height='28' fill='white'/%3E%3Crect x='168' y='36' width='52' height='52'/%3E%3Crect x='180' y='48' width='28' height='28' fill='white'/%3E%3Crect x='36' y='168' width='52' height='52'/%3E%3Crect x='48' y='180' width='28' height='28' fill='white'/%3E%3Crect x='108' y='36' width='12' height='12'/%3E%3Crect x='132' y='36' width='12' height='12'/%3E%3Crect x='108' y='60' width='12' height='12'/%3E%3Crect x='132' y='60' width='12' height='12'/%3E%3Crect x='96' y='96' width='12' height='12'/%3E%3Crect x='120' y='96' width='12' height='12'/%3E%3Crect x='144' y='96' width='12' height='12'/%3E%3Crect x='168' y='96' width='12' height='12'/%3E%3Crect x='192' y='96' width='12' height='12'/%3E%3Crect x='84' y='120' width='12' height='12'/%3E%3Crect x='108' y='120' width='12' height='12'/%3E%3Crect x='132' y='120' width='12' height='12'/%3E%3Crect x='156' y='120' width='12' height='12'/%3E%3Crect x='180' y='120' width='12' height='12'/%3E%3Crect x='96' y='144' width='12' height='12'/%3E%3Crect x='120' y='144' width='12' height='12'/%3E%3Crect x='144' y='144' width='12' height='12'/%3E%3Crect x='168' y='144' width='12' height='12'/%3E%3Crect x='84' y='168' width='12' height='12'/%3E%3Crect x='108' y='168' width='12' height='12'/%3E%3Crect x='132' y='168' width='12' height='12'/%3E%3Crect x='156' y='168' width='12' height='12'/%3E%3Crect x='180' y='168' width='12' height='12'/%3E%3Crect x='96' y='192' width='12' height='12'/%3E%3Crect x='144' y='192' width='12' height='12'/%3E%3Crect x='168' y='192' width='12' height='12'/%3E%3Crect x='192' y='192' width='12' height='12'/%3E%3C/g%3E%3C/svg%3E";

const defaultState = {
  mode: "idle",
  items: [],
  totals: {},
  customer: "",
  cashier: "",
  pos: "",
  ads: [],
  summaryAds: [],
  summarySecondaryAds: [],
  summaryPanelLayout: "split",
  displayCurrency: { code: DEFAULT_CUSTOMER_DISPLAY_CURRENCY_CODE, label: "ກີບ", rate: 1, decimals: 0 },
  displayLanguage: "th",
  paymentDisplay: null,
  qr: null,
  updatedAt: null,
};

const customerDisplayMessages = {
  th: {
    customerDisplay: "จอลูกค้า",
    walkInCustomer: "ลูกค้าทั่วไป",
    thankYou: "ขอบคุณที่ใช้บริการ",
    document: "เอกสาร",
    cashier: "พนักงาน",
    productList: "รายการสินค้า",
    itemCount: "รายการ",
    productTotal: "ยอดสินค้า",
    item: "รายการ",
    qty: "จำนวน",
    unitPrice: "ราคา/หน่วย",
    total: "รวม",
    readyForItems: "พร้อมรับรายการสินค้า",
    itemAndPaymentHere: "รายการสินค้าและยอดชำระจะแสดงที่นี่",
    qrAmount: "ยอด QR",
    amountDue: "ยอดที่ต้องชำระ",
    equivalent: "เทียบเท่า",
    discount: "ส่วนลด",
    paid: "รับแล้ว",
    remaining: "คงเหลือ",
    change: "เงินทอน",
    thankYouTitle: "ขอบคุณที่ใช้บริการ",
    paymentCompleted: "รับชำระเงินเรียบร้อยแล้ว",
    satisfactionTitle: "ประเมินความพึงพอใจ",
    satisfactionGreat: "ดีมาก",
    satisfactionOkay: "พอใช้",
    satisfactionImprove: "ควรปรับปรุง",
    satisfactionThanks: "ความคิดเห็นของท่านมีคุณค่าและจะถูกนำไปใช้ในการพัฒนาการบริการให้ดียิ่งขึ้น",
    satisfactionSaving: "กำลังบันทึกความคิดเห็น",
    saleAmount: "ยอดสินค้า",
    scanQrToPay: "กรุณาสแกน QR เพื่อชำระเงิน",
    scanQrToPayTitle: "QR Payment",
    scanQrDescription: "กรุณาสแกน QR Code โดยใช้แอปพลิเคชัน Mobile Banking",
    scanQrOrBarcodeHere: "สแกน QR หรือ Barcode ที่นี่",
    adVideoTitle: "โฆษณา / วิดีโอ",
    promoFreshMenu: "เมนูใหม่ สดชื่นทุกแก้ว",
    promoSubtitle: "โปรโมชันสินค้า เมนูใหม่ หรือโฆษณาร้านค้า",
    welcome: "Welcome",
    greeting: "สวัสดี",
    adArea: "โปรโมชั่นและสื่อโฆษณาจะแสดงในพื้นที่นี้",
    exitFullscreen: "ออกจากเต็มจอเพื่อย้ายหน้าต่าง",
    enterFullscreen: "กลับไปเต็มจอ",
    fullscreen: "เต็มจอ",
    baht: "บาท",
    paymentTimeLeft: "กรุณาชำระภายใน",
  },
  lo: {
    customerDisplay: "ຈໍລູກຄ້າ",
    walkInCustomer: "ລູກຄ້າທົ່ວໄປ",
    thankYou: "ຂອບໃຈທີ່ໃຊ້ບໍລິການ",
    document: "ເອກະສານ",
    cashier: "ພະນັກງານ",
    productList: "ລາຍການສິນຄ້າ",
    itemCount: "ລາຍການ",
    productTotal: "ຍອດສິນຄ້າ",
    item: "ລາຍການ",
    qty: "ຈຳນວນ",
    unitPrice: "ລາຄາ/ໜ່ວຍ",
    total: "ລວມ",
    readyForItems: "ພ້ອມຮັບລາຍການສິນຄ້າ",
    itemAndPaymentHere: "ລາຍການສິນຄ້າ ແລະ ຍອດຊຳລະຈະສະແດງທີ່ນີ້",
    qrAmount: "ຍອດ QR",
    amountDue: "ຍອດທີ່ຕ້ອງຊຳລະ",
    equivalent: "ທຽບເທົ່າ",
    discount: "ສ່ວນຫຼຸດ",
    paid: "ຮັບແລ້ວ",
    remaining: "ຄົງເຫຼືອ",
    change: "ເງິນທອນ",
    thankYouTitle: "ຂອບໃຈທີ່ໃຊ້ບໍລິການ",
    paymentCompleted: "ຮັບຊຳລະເງິນສຳເລັດແລ້ວ",
    satisfactionTitle: "ປະເມີນຄວາມພຶງພໍໃຈ",
    satisfactionGreat: "ດີຫຼາຍ",
    satisfactionOkay: "ພໍໃຊ້",
    satisfactionImprove: "ຄວນປັບປຸງ",
    satisfactionThanks: "ຄຳຄິດເຫັນຂອງທ່ານມີຄຸນຄ່າ ແລະຈະນຳໄປໃຊ້ໃນການພັດທະນາບໍລິການໃຫ້ດີຂຶ້ນ",
    satisfactionSaving: "ກຳລັງບັນທຶກຄຳຄິດເຫັນ",
    saleAmount: "ຍອດສິນຄ້າ",
    scanQrToPay: "ກະລຸນາສະແກນ QR ເພື່ອຊຳລະເງິນ",
    scanQrToPayTitle: "QR Payment",
    scanQrDescription: "ກະລຸນາສະແກນ QR Code ໂດຍໃຊ້ແອັບພິເຄຊັນ Mobile Banking",
    scanQrOrBarcodeHere: "ສະແກນ QR ຫຼື Barcode ທີ່ນີ້",
    adVideoTitle: "ໂຄສະນາ / ວິດີໂອ",
    promoFreshMenu: "ເມນູໃໝ່ ສົດຊື່ນທຸກແກ້ວ",
    promoSubtitle: "ໂປຣໂມຊັນສິນຄ້າ ເມນູໃໝ່ ຫຼື ໂຄສະນາຮ້ານ",
    welcome: "Welcome",
    greeting: "ສະບາຍດີ",
    adArea: "ໂປຣໂມຊັນ ແລະ ສື່ໂຄສະນາຈະສະແດງໃນພື້ນທີ່ນີ້",
    exitFullscreen: "ອອກຈາກເຕັມຈໍເພື່ອຍ້າຍໜ້າຕ່າງ",
    enterFullscreen: "ກັບໄປເຕັມຈໍ",
    fullscreen: "ເຕັມຈໍ",
    baht: "ບາດ",
    paymentTimeLeft: "ກະລຸນາຊຳລະພາຍໃນ",
  },
  en: {
    customerDisplay: "Customer Display",
    walkInCustomer: "Walk-in customer",
    thankYou: "Thank you for shopping with us",
    document: "Document",
    cashier: "Cashier",
    productList: "Items",
    itemCount: "items",
    productTotal: "Product total",
    item: "Item",
    qty: "Qty",
    unitPrice: "Unit price",
    total: "Total",
    readyForItems: "Ready for items",
    itemAndPaymentHere: "Items and payment totals will appear here",
    qrAmount: "QR amount",
    amountDue: "Amount due",
    equivalent: "Equivalent",
    discount: "Discount",
    paid: "Paid",
    remaining: "Remaining",
    change: "Change",
    thankYouTitle: "Thank you",
    paymentCompleted: "Payment completed",
    satisfactionTitle: "Rate your experience",
    satisfactionGreat: "Great",
    satisfactionOkay: "Okay",
    satisfactionImprove: "Needs improvement",
    satisfactionThanks: "Your feedback is valuable and will help us improve our service.",
    satisfactionSaving: "Saving feedback",
    saleAmount: "Sale amount",
    scanQrToPay: "Please scan the QR code to pay",
    scanQrToPayTitle: "QR Payment",
    scanQrDescription: "Please scan QR Code with your mobile by using Mobile Banking Application",
    scanQrOrBarcodeHere: "Scan QR or Barcode here",
    adVideoTitle: "Advertisement / Video",
    promoFreshMenu: "Fresh new menu",
    promoSubtitle: "Show product promotions, new menus, or store ads",
    welcome: "Welcome",
    greeting: "Welcome",
    adArea: "Promotions and ads will appear here",
    exitFullscreen: "Exit fullscreen to move this window",
    enterFullscreen: "Enter fullscreen",
    fullscreen: "Fullscreen",
    baht: "THB",
    paymentTimeLeft: "Payment Time Left",
  },
};

const state = ref({ ...defaultState });
const qrCountdownNow = ref(Date.now());
const connected = ref(false);
const activeAdIndex = ref(0);
const summaryAdIndex = ref(0);
const fullscreenActive = ref(true);
const itemListRef = ref(null);
const adVideoRef = ref(null);
const adPlaybackCheckpoint = ref({ url: "", time: 0, updatedAt: 0 });
const pendingVideoResume = ref({ url: "", time: 0 });
let unsubscribeState = null;
let unsubscribeStatus = null;
let adTimer = null;
let summaryAdTimer = null;
let qrCountdownTimer = null;

const items = computed(() => (Array.isArray(state.value.items) ? state.value.items : []));
const ads = computed(() => (Array.isArray(state.value.ads) ? state.value.ads.filter((item) => item?.url) : []));
const activeAd = computed(() => (ads.value.length ? ads.value[activeAdIndex.value % ads.value.length] : null));
const summaryPanelLayout = computed(() => (state.value.summaryPanelLayout === "single" ? "single" : "split"));
const summaryAdCandidates = computed(() => (Array.isArray(state.value.summaryAds) ? state.value.summaryAds.filter((item) => item?.url) : []));
const summarySecondaryAdCandidates = computed(() => (Array.isArray(state.value.summarySecondaryAds) ? state.value.summarySecondaryAds.filter((item) => item?.url) : []));
const summaryRotationLength = computed(() =>
  summaryPanelLayout.value === "single" ? summaryAdCandidates.value.length : Math.max(summaryAdCandidates.value.length, summarySecondaryAdCandidates.value.length),
);
function summaryAdAt(list, fallback = null) {
  if (!list.length) return fallback;
  return list[summaryAdIndex.value % list.length];
}
const summaryAds = computed(() => {
  if (summaryPanelLayout.value === "single") return [summaryAdAt(summaryAdCandidates.value)];
  return [summaryAdAt(summaryAdCandidates.value), summaryAdAt(summarySecondaryAdCandidates.value)];
});
const totals = computed(() => state.value.totals || {});
const displayCurrency = computed(() => {
  const source = state.value.displayCurrency || defaultState.displayCurrency;
  const rate = Number(String(source.name_2 ?? source.rate ?? 1).replace(/,/g, ""));
  const code =
    String(source.code || DEFAULT_CUSTOMER_DISPLAY_CURRENCY_CODE)
      .trim()
      .toUpperCase() || DEFAULT_CUSTOMER_DISPLAY_CURRENCY_CODE;
  return {
    code,
    label: String(source.label || source.name || code).trim() || code,
    name_2: String(source.name_2 ?? source.rate ?? rate ?? 1).trim() || "1",
    rate: Number.isFinite(rate) && rate > 0 ? rate : 1,
    decimals: Number.isFinite(Number(source.decimals)) ? Number(source.decimals) : code === "THB" ? 2 : 0,
  };
});

function normalizeCurrencyCode(code) {
  const value = String(code || "")
    .trim()
    .toUpperCase();
  return ["BTH", "THB", "TH"].includes(value) ? "THB" : value;
}

function isLaoCurrencyCode(code) {
  return ["LAK", "KIP", "KIPP", "KIP2", "LAO"].includes(normalizeCurrencyCode(code));
}

function roundDisplayPaymentDue(value) {
  const currency = displayCurrency.value;
  const amount = Math.max(0, Number(value || 0));
  if (!isLaoCurrencyCode(currency.code)) return amount;
  const step = 500;
  return Math.ceil(amount / step) * step;
}
const displayLanguage = computed(() => {
  const lang = String(state.value.displayLanguage || "th")
    .trim()
    .toLowerCase();
  return customerDisplayMessages[lang] ? lang : "th";
});
const displayLocale = computed(() => ({ th: "th-TH", lo: "lo-LA", en: "en-US" })[displayLanguage.value] || "th-TH");
const qr = computed(() => state.value.qr || null);
const qrIsTransferStatic = computed(() => String(qr.value?.kind || "") === "transfer_static");
const qrImageSrc = computed(() => {
  const image = String(qr.value?.image || "").trim();
  if (!image) return "";
  if (/^(data:image\/|blob:|https?:\/\/|file:\/\/)/i.test(image)) return image;
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(image) && image.length > 80) return `data:image/png;base64,${image}`;
  return image;
});
const hasQr = computed(() => !!qrImageSrc.value);

const showLaoQrMark = computed(() => hasQr.value && !qrIsTransferStatic.value && (qr.value?.qrMark === "lao_qr" || String(qr.value?.provider || "").toLowerCase() === "laoqr"));
const showOnePayMark = computed(() => hasQr.value && !qrIsTransferStatic.value && String(qr.value?.provider || "").toLowerCase() === "onepay");
const showLaoQrFrame = computed(() => showLaoQrMark.value || showOnePayMark.value);
const qrFrameMarkImage = computed(() => (showOnePayMark.value ? onePayMarkImage : laoQrMarkImage));
const showQrBankIcons = computed(() => {
  const provider = String(qr.value?.provider || "")
    .trim()
    .toLowerCase();
  // return hasQr.value && !qrIsTransferStatic.value && (qr.value?.qrMark === "lao_qr" || provider === "laoqr" || provider === "onepay");
  return hasQr.value;
});
const qrExpiresAtMs = computed(() => {
  const raw = qr.value?.expiresAt;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
});
const qrCountdownRemainingSeconds = computed(() => {
  if (qrExpiresAtMs.value > 0) return Math.max(0, Math.ceil((qrExpiresAtMs.value - qrCountdownNow.value) / 1000));
  return Math.max(0, Math.floor(Number(qr.value?.remainingSeconds || 0)));
});
const hasQrCountdown = computed(() => hasQr.value && !qrIsTransferStatic.value && (qrExpiresAtMs.value > 0 || Number(qr.value?.remainingSeconds || 0) > 0));
const qrCountdownText = computed(() => formatQrCountdown(qrCountdownRemainingSeconds.value));
const paidSummary = computed(() => state.value.paidSummary || null);
const paymentDisplay = computed(() => paidSummary.value?.paymentDisplay || state.value.paymentDisplay || null);
const showThankYouDialog = computed(() => state.value.mode === "thankyou");
const satisfactionDocNo = computed(() => String(paidSummary.value?.docNo || state.value.docNo || "").trim());
const satisfactionSaving = ref(false);
const satisfactionSubmitted = ref(false);
const satisfactionError = ref("");
const selectedSatisfaction = ref(null);
const satisfactionAnswerTypes = [1, 2, 3];
const satisfactionOptions = computed(() => [
  { value: 3, label: cdText("satisfactionGreat"), tone: "great" },
  { value: 2, label: cdText("satisfactionOkay"), tone: "okay" },
  { value: 1, label: cdText("satisfactionImprove"), tone: "improve" },
]);
const showIdle = computed(() => !items.value.length && !hasQr.value);
const displayControlsAvailable = computed(() => typeof window !== "undefined" && !!window.bizsuitDesktop?.isCustomerDisplayWindow && !!window.bizsuitCustomerDisplay?.setFullscreen);
const primaryAmountLabel = computed(() => (hasQr.value ? (qrIsTransferStatic.value ? "QR Code" : cdText("qrAmount")) : cdText("amountDue")));
const primaryAmountValue = computed(() =>
  hasQr.value ? (qrIsTransferStatic.value ? qr.value?.title || qr.value?.currencyCode || "" : money(qr.value?.amountKip)) : paymentDisplayAmountValue("netAmount", totals.value.netAmount),
);
const primaryAmountUnit = computed(() => (hasQr.value ? (qrIsTransferStatic.value ? qr.value?.currencyCode || "" : qr.value?.currencyCode || "KIP") : displayCurrency.value.code));
const primaryAmountNote = computed(() => {
  return "";
});
const qrProviderLabel = computed(() => {
  if (qr.value?.providerLabel) return qr.value.providerLabel;
  const provider = String(qr.value?.provider || "")
    .trim()
    .toLowerCase();
  if (provider === "onepay") return "Onepay";
  return "Lao QR";
});
const activeAdIsVideo = computed(() => isAdVideo(activeAd.value));
const activeAdSoundEnabled = computed(() => isAdSoundEnabled(activeAd.value));
const itemScrollKey = computed(() => items.value.map((item) => `${item?.id || ""}:${item?.qty || 0}:${item?.amount || 0}:${item?.discount || ""}:${item?.remark || ""}`).join("|"));
const latestItem = computed(() => items.value[0] || null);
const latestItemImageSrc = computed(() => itemImageSrc(latestItem.value));

function adIdentity(ad) {
  if (!ad) return "";
  return String(ad.id || ad.url || "").trim();
}

function isAdVideo(ad) {
  return String(ad?.type || "").toLowerCase() === "video" || /\.(mp4|webm|ogg|mov)(?:\?|#|$)/i.test(String(ad?.url || ""));
}

function isAdSoundEnabled(ad) {
  return isAdVideo(ad) && (ad?.sound_enabled === true || ad?.soundEnabled === true);
}

function formatQrCountdown(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function money(value) {
  const amount = Number(value || 0);
  return amount.toLocaleString(displayLocale.value, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function displayMoney(value) {
  const currency = displayCurrency.value;
  const amount = Number(value || 0) * currency.rate;
  return amount.toLocaleString(displayLocale.value, {
    minimumFractionDigits: currency.decimals,
    maximumFractionDigits: currency.decimals,
  });
}

function displayCurrencyMoney(value) {
  const currency = displayCurrency.value;
  const amount = Number(value || 0);
  return amount.toLocaleString(displayLocale.value, {
    minimumFractionDigits: currency.decimals,
    maximumFractionDigits: currency.decimals,
  });
}

function amountText(value) {
  return `${displayMoney(value)} ${displayCurrency.value.code}`;
}

function paymentDisplayAmount(key, fallbackValue) {
  const value = paymentDisplay.value?.[key];
  return value === undefined || value === null ? Number(fallbackValue || 0) * displayCurrency.value.rate : Number(value || 0);
}

function paymentDisplayAmountValue(key, fallbackValue) {
  const value = paymentDisplay.value?.[key];
  return value === undefined || value === null ? displayMoney(fallbackValue) : displayCurrencyMoney(value);
}

function paymentDisplayAmountCustomerView(key, fallbackValue) {
  const value = paymentDisplay.value?.[key];
  if (value === undefined || value === null) return displayCurrencyMoney(roundDisplayPaymentDue(Number(fallbackValue || 0) * displayCurrency.value.rate));
  return displayCurrencyMoney(roundDisplayPaymentDue(value));
}


function paymentDisplayAmountText(key, fallbackValue) {
  const value = paymentDisplay.value?.[key];
  return value === undefined || value === null ? amountText(fallbackValue) : `${displayCurrencyMoney(value)} ${paymentDisplay.value?.currencyCode || displayCurrency.value.code}`;
}

function qty(value) {
  const amount = Number(value || 0);
  return amount.toLocaleString(displayLocale.value, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function cdText(key) {
  return customerDisplayMessages[displayLanguage.value]?.[key] || customerDisplayMessages.th[key] || key;
}

function itemImageSrc(item) {
  const directUrl = [item?.image, item?.imageUrl, item?.image_url, item?.picture_url, item?.thumb_url].find((value) => String(value || "").trim());
  if (directUrl) return String(directUrl).trim();
  const itemCode = String(item?.itemCode || item?.item_code || "").trim();
  return itemCode ? productImageUrl(itemCode) : "";
}

function onItemImageLoad(event) {
  if (event?.target?.style) event.target.style.visibility = "";
}

function onItemImageError(event) {
  if (event?.target?.style) event.target.style.visibility = "hidden";
}

function onLatestItemImageLoad(event) {
  const parent = event?.target?.parentElement;
  if (parent?.style) parent.style.display = "";
}

function onLatestItemImageError(event) {
  const parent = event?.target?.parentElement;
  if (parent?.style) parent.style.display = "none";
}

function resetSatisfactionFeedback() {
  satisfactionSaving.value = false;
  satisfactionSubmitted.value = false;
  satisfactionError.value = "";
  selectedSatisfaction.value = null;
}

async function submitSatisfaction(answerType) {
  const normalized = Number(answerType);
  if (!Number.isInteger(normalized) || !satisfactionAnswerTypes.includes(normalized) || satisfactionSaving.value || satisfactionSubmitted.value) return;
  const docNo = satisfactionDocNo.value;
  if (!docNo) {
    satisfactionError.value = "Document number is missing";
    return;
  }
  satisfactionSaving.value = true;
  satisfactionError.value = "";
  selectedSatisfaction.value = normalized;
  try {
    await api.post("/sale-feedback", {
      doc_no: docNo,
      answer_type: normalized,
    });
    satisfactionSubmitted.value = true;
  } catch (error) {
    satisfactionError.value = error.message || "Unable to save feedback";
    selectedSatisfaction.value = null;
  } finally {
    satisfactionSaving.value = false;
  }
}

function qrWaitingText() {
  if (displayLanguage.value === "en") return "Waiting for payment. The system will save automatically after payment is completed";
  if (displayLanguage.value === "lo") return "ກຳລັງລໍຖ້າຮັບຊຳລະ ລະບົບຈະບັນທຶກອັດຕະໂນມັດຫຼັງຈາກຊຳລະສຳເລັດ";
  return "กำลังรอรับชำระ ระบบจะบันทึกอัตโนมัติหลังจากชำระแล้ว";
}

function normalizeAdUrl(value = "") {
  return String(value || "").trim();
}

function safeVideoTime(value = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function clampAdIndex(index, length = ads.value.length) {
  if (!length) return 0;
  const normalized = Number.isFinite(index) ? Math.trunc(index) : 0;
  return Math.min(Math.max(normalized, 0), length - 1);
}

function clearPendingVideoResume() {
  pendingVideoResume.value = { url: "", time: 0 };
}

function rememberAdPlaybackCheckpoint() {
  const url = normalizeAdUrl(activeAd.value?.url);
  if (!url || !activeAdIsVideo.value) return;
  adPlaybackCheckpoint.value = {
    url,
    time: safeVideoTime(adVideoRef.value?.currentTime),
    updatedAt: Date.now(),
  };
}

function queuePendingVideoResume(url = "") {
  const normalized = normalizeAdUrl(url || activeAd.value?.url);
  if (!normalized) {
    clearPendingVideoResume();
    return;
  }
  const checkpoint = adPlaybackCheckpoint.value;
  if (checkpoint.url !== normalized || safeVideoTime(checkpoint.time) <= 0) {
    clearPendingVideoResume();
    return;
  }
  pendingVideoResume.value = {
    url: normalized,
    time: checkpoint.time,
  };
}

function applyPendingVideoResume() {
  const video = adVideoRef.value;
  const activeUrl = normalizeAdUrl(activeAd.value?.url);
  const pending = pendingVideoResume.value;
  if (!video || !activeUrl || pending.url !== activeUrl) return;

  const resumeAt = safeVideoTime(pending.time);
  if (!resumeAt) {
    clearPendingVideoResume();
    return;
  }

  const duration = Number(video.duration);
  const maxSeek = Number.isFinite(duration) && duration > 0 ? Math.max(duration - 0.25, 0) : resumeAt;
  const nextTime = Math.min(resumeAt, maxSeek);

  if (nextTime > 0.05 && Math.abs((video.currentTime || 0) - nextTime) > 0.2) {
    try {
      video.currentTime = nextTime;
    } catch {
      // Ignore seek failures on streams that do not expose seekable ranges.
    }
  }

  clearPendingVideoResume();
}

function onAdVideoTimeUpdate(event) {
  const url = normalizeAdUrl(activeAd.value?.url);
  if (!url) return;
  const source = event?.target || adVideoRef.value;
  adPlaybackCheckpoint.value = {
    url,
    time: safeVideoTime(source?.currentTime),
    updatedAt: Date.now(),
  };
}

function onAdVideoLoadedMetadata() {
  applyPendingVideoResume();
}

function applyState(nextState) {
  const prevAdUrls = ads.value.map((a) => normalizeAdUrl(a?.url)).join("|");
  const prevIndex = activeAdIndex.value;
  const prevActiveUrl = normalizeAdUrl(activeAd.value?.url);
  rememberAdPlaybackCheckpoint();
  state.value = { ...defaultState, ...(nextState || {}) };
  const nextAds = ads.value;
  const nextAdUrls = nextAds.map((a) => normalizeAdUrl(a?.url)).join("|");
  const urlsChanged = prevAdUrls !== nextAdUrls;
  const indexOutOfBound = prevIndex >= nextAds.length;

  let nextIndex = prevIndex;
  let resumedByUrl = false;

  if (!nextAds.length) {
    nextIndex = 0;
    clearPendingVideoResume();
  } else if (urlsChanged) {
    const resumeUrl = normalizeAdUrl(adPlaybackCheckpoint.value.url || prevActiveUrl);
    const matchIndex = resumeUrl ? nextAds.findIndex((ad) => normalizeAdUrl(ad?.url) === resumeUrl) : -1;
    resumedByUrl = matchIndex >= 0;
    nextIndex = resumedByUrl ? matchIndex : 0;
  } else if (indexOutOfBound) {
    nextIndex = nextAds.length - 1;
  }

  activeAdIndex.value = clampAdIndex(nextIndex, nextAds.length);
  if (summaryAdIndex.value >= Math.max(summaryAdCandidates.value.length, 1)) {
    summaryAdIndex.value = 0;
  }

  const resumedUrl = normalizeAdUrl(nextAds[activeAdIndex.value]?.url);
  if (resumedUrl && resumedUrl === normalizeAdUrl(adPlaybackCheckpoint.value.url)) {
    queuePendingVideoResume(resumedUrl);
  } else {
    clearPendingVideoResume();
  }

  connected.value = true;
}

function applyStatus(status = {}) {
  if (typeof status.fullscreen === "boolean") fullscreenActive.value = status.fullscreen;
  if (typeof status.open === "boolean") connected.value = status.open || connected.value;
}

function clearAdTimer() {
  if (adTimer) {
    clearTimeout(adTimer);
    adTimer = null;
  }
}

function clearSummaryAdTimer() {
  if (summaryAdTimer) {
    clearTimeout(summaryAdTimer);
    summaryAdTimer = null;
  }
}

function advanceAd() {
  if (ads.value.length > 1) activeAdIndex.value = (activeAdIndex.value + 1) % ads.value.length;
}

function advanceSummaryAds() {
  if (summaryRotationLength.value > 1) summaryAdIndex.value = (summaryAdIndex.value + 1) % summaryRotationLength.value;
}

function scheduleImageAdAdvance() {
  clearAdTimer();
  if (ads.value.length <= 1 || activeAdIsVideo.value) return;
  adTimer = setTimeout(() => {
    adTimer = null;
    advanceAd();
  }, 12000);
}

function scheduleSummaryAdAdvance() {
  clearSummaryAdTimer();
  if (summaryRotationLength.value <= 1) return;
  summaryAdTimer = setTimeout(() => {
    summaryAdTimer = null;
    advanceSummaryAds();
    scheduleSummaryAdAdvance();
  }, 12000);
}

async function syncDisplayWindowStatus() {
  if (!displayControlsAvailable.value || !window.bizsuitCustomerDisplay?.status) return;
  try {
    applyStatus(await window.bizsuitCustomerDisplay.status());
  } catch {
    fullscreenActive.value = true;
  }
}

async function toggleDisplayFullscreen() {
  if (!displayControlsAvailable.value) return;
  try {
    const status = await window.bizsuitCustomerDisplay.setFullscreen(!fullscreenActive.value);
    applyStatus(status);
  } catch {
    await syncDisplayWindowStatus();
  }
}

onMounted(async () => {
  qrCountdownTimer = setInterval(() => {
    qrCountdownNow.value = Date.now();
  }, 1000);
  if (window.bizsuitCustomerDisplay?.getState) {
    applyState(await window.bizsuitCustomerDisplay.getState());
    unsubscribeState = window.bizsuitCustomerDisplay.onState?.(applyState);
    unsubscribeStatus = window.bizsuitCustomerDisplay.onStatus?.(applyStatus);
    await syncDisplayWindowStatus();
  } else {
    // Mock state สำหรับ preview/ปรับแต่งจอ
    applyState({
      mode: "selling",
      customer: "ສັນຕິພາບ DEMO",
      cashier: "PUI",
      docNo: "CON-CR2605290001",
      items: [
        {
          id: 1,
          item_code: "P001",
          name: "ເຂົ້າຈີ່ (ໝາກນາວ) asfasfasfjasilfjaslkfjalksjflaksjhfkuahfkashjf asilfjaslifjlaishf lasihfailshfilashf liashf liashfliashfliashfliashflasf asfsafsakfjsalkfjlaisjflsajflasjlfsaijasfafasfafasfasf/nasfafasfasfa\nasfasfasfaf\nafsasfasfasfasfasfaf\nasfafafafasfsfafafasf",
          remark: "testtest",
          qty: 2,
          unit: "ອັນ",
          unit_code: "ອັນ",
          price: 15000,
          amount: 30000,
          discount: "",
        },
        { id: 2, item_code: "P002", name: "ນ້ຳດື່ມ 600ml", qty: 3, unit: "ຂວດ", unit_code: "ຂວດ", price: 5000, amount: 15000, discount: "" },
        { id: 3, item_code: "P003", name: "ກາເຟ Lao", qty: 1, unit: "ແກ້ວ", unit_code: "ແກ້ວ", price: 20000, amount: 20000, discount: "" },
      ],
      totals: {
        netAmount: 65000,
        totalDiscount: 0,
        totalValue: 65000,
      },
      displayCurrency: { code: "LAK", label: "ກີບ", rate: 1, decimals: 0 },
      displayLanguage: "lo",
      qr: {
        amountKip: 65000,
        amountThb: 115,
        currencyCode: "KIP",
        provider: "laoqr",
        providerLabel: "Lao QR",
        qrMark: "lao_qr",
        image: mockLaoQrImage,
        expiresAt: Date.now() + 5 * 60 * 1000,
        remainingSeconds: 5 * 60,
        message: "ກະລຸນາສະແກນ QR ເພື່ອຊຳລະເງິນ",
      },
    });
    connected.value = true;
  }
});

onBeforeUnmount(() => {
  if (typeof unsubscribeState === "function") unsubscribeState();
  if (typeof unsubscribeStatus === "function") unsubscribeStatus();
  clearAdTimer();
  clearSummaryAdTimer();
  if (qrCountdownTimer) clearInterval(qrCountdownTimer);
});

watch(
  () => [activeAd.value?.url, activeAdIsVideo.value, ads.value.length],
  () => scheduleImageAdAdvance(),
  { immediate: true },
);

watch(
  () => [activeAd.value?.url, summaryPanelLayout.value, summaryAdCandidates.value.map((ad) => adIdentity(ad)).join("|"), summarySecondaryAdCandidates.value.map((ad) => adIdentity(ad)).join("|")],
  () => {
    if (summaryAdIndex.value >= Math.max(summaryRotationLength.value, 1)) summaryAdIndex.value = 0;
    scheduleSummaryAdAdvance();
  },
  { immediate: true },
);

watch(
  () => [satisfactionDocNo.value, showThankYouDialog.value],
  () => resetSatisfactionFeedback(),
);

watch(itemScrollKey, async () => {
  await nextTick();
  if (itemListRef.value) itemListRef.value.scrollTop = 0;
});

watch(activeAdIndex, async () => {
  await nextTick();
  applyPendingVideoResume();
  adVideoRef.value?.play().catch(() => {});
});
</script>

<template>
  <main class="customer-display" data-font-zone="screen" :data-display-language="displayLanguage">
    <section class="display-top" data-font-zone="customer-display-header">
      <div class="brand-area">
        <img src="/santipab.png" alt="logo" class="brand-mark" />
        <div>
          <strong>ສັນຕິພາບ</strong>
        </div>
      </div>
      <div class="customer-area">
        <strong
          ><span>{{ cdText("greeting") }}</span> {{ state.customer || cdText("walkInCustomer") }}</strong
        >
      </div>
      <div class="display-meta">
        <span v-if="state.cashier" class="cashier-pill">{{ state.cashier }} <i class="pi pi-user" /></span>
        <!-- <span :class="['display-status', { online: connected }]"><b />{{ connected ? 'ONLINE' : 'WAITING' }}</span> -->
        <button
          v-if="displayControlsAvailable"
          class="display-control-icon"
          type="button"
          :title="fullscreenActive ? cdText('exitFullscreen') : cdText('enterFullscreen')"
          :aria-label="fullscreenActive ? cdText('exitFullscreen') : cdText('fullscreen')"
          @click="toggleDisplayFullscreen"
        >
          <i :class="fullscreenActive ? 'pi pi-window-minimize' : 'pi pi-window-maximize'" />
        </button>
      </div>
    </section>

    <section class="display-grid">
      <section class="display-left">
        <section class="items-panel" :style="{ '--welcome-image': `url(${welcomeImage})`, '--welcome-opacity': items.length ? 0.3 : 1 }">
          <div class="item-table-head" data-font-zone="customer-display-table-head">
            <span class="item-head-title" aria-hidden="true">{{ cdText("item") }}</span>
            <span></span>
            <span>{{ cdText("qty") }}</span>
            <span>{{ cdText("unitPrice") }}</span>
            <span>{{ cdText("total") }}</span>
          </div>

          <div v-if="items.length" ref="itemListRef" class="item-list" data-font-zone="customer-display-table-body">
            <article v-for="(item, index) in items" :key="item.id" class="item-row" :class="{ latest: index === 0 }">
              <div class="item-index" aria-hidden="true">
                <span class="item-seq">{{ items.length - index }}</span>
                <div class="item-image">
                  <img
                    v-if="itemImageSrc(item)"
                    :key="itemImageSrc(item)"
                    :src="itemImageSrc(item)"
                    :alt="item.name || 'Item image'"
                    @load="onItemImageLoad"
                    @error="onItemImageError"
                  />
                </div>
              </div>
              <div class="item-name">
                <p>{{ item.name }}</p>
                <em v-if="item.remark">{{ item.remark }}</em>
              </div>
              <div class="item-qty">{{ qty(item.qty) }} {{ item.unit }}</div>
              <div class="item-price">{{ displayMoney(item.price) }}</div>
              <div class="item-total">
                <strong>{{ displayMoney(item.amount) }}</strong>
                <small v-if="item.discount">{{ cdText("discount") }} {{ item.discount }}</small>
              </div>
            </article>
          </div>
        </section>

        <section class="summary-panel" :class="{ single: summaryPanelLayout === 'single' }">
          <section v-for="(ad, index) in summaryAds" :key="`${ad?.id || 'summary-ad'}-${index}`" class="summary-ad-slot">
            <div v-if="ad" class="ad-media">
              <video v-if="isAdVideo(ad)" :key="ad.url" :src="ad.url" autoplay loop :muted="!isAdSoundEnabled(ad)" playsinline />
              <img v-else :src="ad.url" :alt="ad.title || 'Customer display advertisement'" />
            </div>
            <div v-else class="ad-gradient"></div>
          </section>
        </section>
      </section>

      <aside class="payment-ad-rail">
        <section class="qr-panel" data-font-zone="customer-display-qr">
          <div class="summary-card rail-summary-card" data-font-zone="customer-display-summary-total">
            <span>{{ cdText("amountDue") }}</span>
            <strong>{{ paymentDisplayAmountCustomerView("netAmount", totals.netAmount) }} <span> <small >{{ displayCurrency.label }}</small></span></strong>
           
          </div>
          <div v-if="!hasQr && latestItemImageSrc" :key="latestItemImageSrc" class="latest-item-image-card">
            <img :src="latestItemImageSrc" :alt="latestItem?.name || 'Latest item image'" @load="onLatestItemImageLoad" @error="onLatestItemImageError" />
          </div>
          <!-- <h2 v-if="hasQr">{{ cdText("scanQrToPayTitle") }}</h2> -->
          <!-- <h2 v-if="hasQr">{{ qrProviderLabel }}</h2> -->
          <div v-if="hasQrCountdown" class="qr-countdown-card" role="timer" aria-live="polite">
            <span>{{ cdText("paymentTimeLeft") }}</span>
            <strong>{{ qrCountdownText }}</strong>
          </div>
          <div v-if="hasQr" class="qr-image-card" :class="{ placeholder: !hasQr, 'qr-image-card--lao': showLaoQrFrame }">
            <template v-if="showLaoQrFrame">
              <div class="qr-lao-frame">
                <span class="qr-lao-frame-text qr-lao-frame-text--top">MYQR MYQR MYQR MYQR MYQR MYQR MYQR</span>
                <span class="qr-lao-frame-text qr-lao-frame-text--right">MYQR MYQR MYQR MYQR</span>
                <span class="qr-lao-frame-text qr-lao-frame-text--bottom">MYQR MYQR MYQR MYQR MYQR MYQR MYQR</span>
                <span class="qr-lao-frame-text qr-lao-frame-text--left">MYQR MYQR MYQR MYQR</span>
                <img class="qr-image" :src="qrImageSrc" :alt="qr.title || qrProviderLabel || 'QR Payment'" />
                <img class="qr-center-mark" :src="qrFrameMarkImage" alt="" aria-hidden="true" />
               
              </div>
            </template>
            <template v-else>
              <img class="qr-image" :src="qrImageSrc" :alt="qr.title || qrProviderLabel || 'QR Payment'" />
              <img v-if="showOnePayMark" class="qr-center-mark" :src="onePayMarkImage" alt="" aria-hidden="true" />
              
            </template>
          </div>
          <div v-if="hasQr && qr.amountKip > 0" class="qr-amount-info">
            <p class="qr-amount-value">{{ money(qr.amountKip) }} {{ qr.currencyCode || "KIP" }}</p>
          </div>
          <div v-if="showQrBankIcons" class="qr-bank-icons">
            <small>{{ cdText("scanQrDescription") }}  </small>
            <img :src="bankIconImage" alt="Mobile banking applications" />
          </div>
        </section>

        <section class="ad-panel" :class="{ idle: showIdle }" data-font-zone="customer-display-ad">
          <div v-if="activeAd" class="ad-media">
            <video
              v-if="activeAdIsVideo"
              ref="adVideoRef"
              :key="activeAd.url"
              :src="activeAd.url"
              autoplay
              :loop="ads.length <= 1"
              :muted="!activeAdSoundEnabled"
              playsinline
              @timeupdate="onAdVideoTimeUpdate"
              @loadedmetadata="onAdVideoLoadedMetadata"
              @ended="advanceAd"
            />
            <img v-else :src="activeAd.url" :alt="activeAd.title || 'Customer display advertisement'" />
          </div>
          <div v-else class="ad-gradient"></div>
        </section>
      </aside>
    </section>

    <section v-if="showThankYouDialog" class="thankyou-overlay" aria-live="polite">
      <div class="thankyou-dialog" data-font-zone="customer-display-thankyou">
        <img class="thankyou-side-image left" :src="welcomeImage" alt="" aria-hidden="true" />
        <img class="thankyou-side-image right" :src="thankyouImage" alt="" aria-hidden="true" />
        <div class="thankyou-icon">
          <i class="pi pi-check" />
        </div>
        <div class="thankyou-heading">
          <strong>{{ cdText("thankYouTitle") }}</strong>
          <span>{{ cdText("paymentCompleted") }}</span>
          <!-- <small v-if="paidSummary?.docNo">{{ cdText("document") }} {{ paidSummary.docNo }}</small> -->
        </div>
        <div class="thankyou-lines">
          <div>
            <span>{{ cdText("saleAmount") }}</span>
            <b>{{ paymentDisplayAmountText("netAmount", paidSummary?.netAmount ?? paidSummary?.totalValue ?? totals.netAmount) }}</b>
          </div>
          <div>
            <span>{{ cdText("paid") }}</span>
            <b class="paid">{{ paymentDisplayAmountText("paid", paidSummary?.paid ?? totals.paid) }}</b>
          </div>
          <div>
            <span>{{ cdText("change") }}</span>
            <b class="change">{{ paymentDisplayAmountText("change", paidSummary?.change ?? totals.change) }}</b>
          </div>
        </div>
        <div class="satisfaction-panel">
          <strong>{{ cdText("satisfactionTitle") }}</strong>
          <div v-if="!satisfactionSubmitted" class="satisfaction-actions" role="group" :aria-label="cdText('satisfactionTitle')">
            <button
              v-for="option in satisfactionOptions"
              :key="option.value"
              type="button"
              class="satisfaction-button"
              :class="[option.tone, { selected: selectedSatisfaction === option.value }]"
              :disabled="satisfactionSaving || !satisfactionDocNo"
              @click="submitSatisfaction(option.value)"
            >
              <span class="satisfaction-face" aria-hidden="true"></span>
              <b>{{ option.label }}</b>
            </button>
          </div>
          <p v-if="satisfactionSaving" class="satisfaction-status">{{ cdText("satisfactionSaving") }}</p>
          <p v-else-if="satisfactionSubmitted" class="satisfaction-thanks">{{ cdText("satisfactionThanks") }}</p>
          <p v-else-if="satisfactionError" class="satisfaction-error">{{ satisfactionError }}</p>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.customer-display {
  --cd-orange: #ff6500;
  --cd-orange-strong: #ea580c;
  --cd-orange-dark: #c2410c;
  --cd-orange-soft: #fff7ed;
  --cd-orange-veil: #fffaf5;
  --cd-border: rgba(249, 115, 22, 0.42);
  --cd-green: #16a34a;
  --cd-green-dark: #15803d;
  --cd-ink: #182235;
  --cd-muted: #64748b;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100vh;
  overflow: hidden;
  background: radial-gradient(circle at 28% 18%, rgba(255, 122, 0, 0.07), transparent 28rem), linear-gradient(180deg, #fffaf5 0%, #ffffff 42%, #fffdfb 100%);
  color: var(--cd-ink);
  font-family: var(--biz-font-family);
  position: relative;
}

.customer-display[data-display-language="th"] {
  --biz-font-family: var(--biz-font-family-th);
}

.customer-display[data-display-language="lo"] {
  --biz-font-family: var(--biz-font-family-lo);
  font-family: var(--biz-font-family-lo);
}

.customer-display[data-display-language="en"] {
  --biz-font-family: var(--biz-font-family-en);
  font-family: var(--biz-font-family-en);
}

.display-control-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  border: 1px solid rgba(255, 255, 255, 0.55);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  cursor: pointer;
  font-size: calc(var(--biz-zone-font-size, 1rem) * 1);
  transition:
    background-color 0.16s ease,
    border-color 0.16s ease;
}

.display-control-icon:hover {
  border-color: rgba(255, 255, 255, 0.78);
  background: rgba(255, 255, 255, 0.28);
}

.display-control-icon:focus-visible {
  outline: 3px solid rgba(255, 255, 255, 0.72);
  outline-offset: 2px;
}

.display-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.25rem;
  min-height: 5.25rem;
  padding: 0.75rem 1.35rem;
  background: linear-gradient(180deg, #ff5a00 0%, #ff7a00 48%, #ff8a00 100%);
  color: #fff;
  box-shadow: 0 12px 28px rgba(234, 88, 12, 0.18);
}

.brand-area,
.customer-area,
.display-meta {
  display: flex;
  align-items: center;
  gap: 0.9rem;
}

.brand-area > div,
.customer-area {
  display: grid;
  gap: 0.1rem;
}

.brand-mark {
  width: 3.2rem;
  height: 3.2rem;
  object-fit: contain;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.96);
  padding: 0.18rem;
  box-shadow: 0 8px 18px rgba(124, 45, 18, 0.12);
}

.brand-area strong {
  font-size: clamp(calc(var(--biz-zone-font-size, 1rem) * 1.4), 2.2vw, calc(var(--biz-zone-font-size, 1rem) * 2));
  font-weight: 950;
  line-height: 1;
}

.brand-area small,
.customer-area small {
  color: rgba(255, 255, 255, 0.84);
  font-size: calc(var(--biz-zone-font-size, 1rem) * 0.9);
  font-weight: 850;
}

.customer-area {
  min-width: 0;
  flex: 1;
  justify-items: center;
  text-align: center;
}

.customer-area strong {
  overflow: hidden;
  max-width: 100%;
  font-size: clamp(calc(var(--biz-zone-font-size, 1rem) * 1.35), 2.2vw, calc(var(--biz-zone-font-size, 1rem) * 2));
  font-weight: 950;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.customer-area strong span {
  font-weight: 850;
  opacity: 0.92;
}

.display-meta span {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.65rem 1rem;
  border: 1px solid rgba(255, 255, 255, 0.32);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  font-size: calc(var(--biz-zone-font-size, 1rem) * 0.95);
  font-weight: 950;
  white-space: nowrap;
}

.display-status.online {
  border-color: #86efac;
  background: #ffffff;
  color: var(--cd-green-dark);
}

.display-status b {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 999px;
  background: #94a3b8;
}

.display-status.online b {
  background: var(--cd-green);
}

.display-grid {
  display: grid;
  grid-template-columns: 1fr 25.5vw;
  gap: 0rem;
  min-height: 0;
  padding: 0.1rem;
}

.display-left {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 0rem;
  min-width: 0;
  min-height: 0;
}

.items-panel {
  position: relative;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
  border: 1px solid rgba(226, 232, 240, 0.88);
  border-radius: 0px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.08);
}

.items-panel::after {
  content: "";
  position: absolute;
  inset: 4.25rem 0 0;
  background-image: var(--welcome-image);
  background-position: center;
  background-repeat: no-repeat;
  background-size: min(24rem, 42vw, 58vh);
  opacity: var(--welcome-opacity, 1);
  pointer-events: none;
  z-index: 0;
}

.items-panel > * {
  position: relative;
  z-index: 1;
}

.items-panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #fed7aa;
  background: var(--cd-orange-soft);
}

.items-panel header div {
  display: grid;
  gap: 0.15rem;
}

.items-panel header span,
.items-panel header small {
  color: var(--cd-orange-dark);
  font-weight: 850;
}

.items-panel header strong {
  font-size: calc(var(--biz-zone-font-size, 1rem) * 1.55);
  font-weight: 950;
}

.item-image {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 3.65rem;
  height: 3.65rem;
  border-radius: 8px;
  background: transparent;
  overflow: hidden;
}

.item-image img {
  width: 100%;
  height: 100%;
  border-radius: inherit;
  object-fit: cover;
}

.item-table-head,
.item-row {
  display: grid;
  grid-template-columns: 5.75rem minmax(0, 1fr) 5.4rem 8rem 10rem;
  gap: 1rem;
  align-items: center;
}

.item-index {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.item-seq {
  min-width: 1.4rem;
  text-align: center;
  font-weight: 800;
  /* color: var(--cd-orange); */
  font-variant-numeric: tabular-nums;
}

.item-table-head {
  min-height: 4.25rem;
  padding: 0.8rem 1.35rem;
  background: linear-gradient(180deg, rgba(255, 250, 245, 0.96), rgba(255, 255, 255, 0.95));
  border-bottom: 1px solid #f1f5f9;
  color: #0f172a;
  font-size: calc(var(--biz-zone-font-size, 1rem) * 1.08);
  font-weight: 950;
}

.item-head-title {
  display: inline-flex;
  align-items: center;
  gap: 0.65rem;
}

.item-head-title i {
  color: var(--cd-orange);
  font-size: calc(var(--biz-zone-font-size, 1rem) * 1.4);
}

.item-table-head span:nth-child(n + 3) {
  text-align: right;
}

.item-list {
  display: grid;
  align-content: start;
  min-height: 0;
  overflow: auto;
}

.item-row {
  min-height: 3rem;
  padding: 0rem 1.35rem;
  border-bottom: 1px solid #ffedd5;
}

.item-row.latest .item-name strong {
  color: #0f172a;
}

.item-name p{
  padding: 0;
  margin:0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.item-name {
  display: grid;
  min-width: 0;
  gap: 0.12rem;
  font-weight:700;
}

.item-name strong {
  overflow: hidden;
  font-size: calc(var(--biz-zone-font-size, 1rem) * 1.22);
  font-weight: 500;
}

.item-name span {
  color: var(--cd-muted);
  font-size: calc(var(--biz-zone-font-size, 1rem) * 0.9);
  font-weight: 800;
}

.item-name em {
  overflow: hidden;
  color: #94a3b8;
  font-size: calc(var(--biz-zone-font-size, 1rem) * 0.8);
  font-style: normal;
  font-weight: 750;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-qty,
.item-price,
.item-total {
  text-align: right;
  font-size: calc(var(--biz-zone-font-size, 1rem) * 1.14);
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}

.item-total {
  display: grid;
  justify-items: end;
  gap: 0.1rem;
}

.item-total strong {
  color: var(--cd-green-dark);
  font-size: calc(var(--biz-zone-font-size, 1rem) * 1.28);
  font-weight: 950;
}

.item-total small {
  color: var(--cd-orange);
  font-size: calc(var(--biz-zone-font-size, 1rem) * 0.78);
  font-weight: 900;
}

.summary-panel {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0rem;
  width: 100%;
  aspect-ratio: 16 / 3;
  align-items: stretch;
  min-height: 9.5rem;
  max-height: 100%;
  overflow: hidden;
  /* border-radius: 10px; */
}

.summary-panel.single {
  grid-template-columns: minmax(0, 1fr);
  aspect-ratio: 24 / 5;
}

.summary-ad-slot {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-radius: 0px;
}

.summary-ad-slot .ad-media img,
.summary-ad-slot .ad-media video {
  object-fit: contain;
  background: #050505;
}

.summary-card {
  display: grid;
  gap: 0.0rem;
  align-content: center;
  padding: 0.8rem 0.8rem;
  background: #ffffff;
  color: var(--cd-ink);
}

.rail-summary-card {
  width: 100%;
  padding: 0 0 0.1rem;
  border-bottom: 1px solid #ffedd5;
  background: transparent;
}

.summary-card span  {
  color: #111827;
  font-size: calc(var(--biz-zone-font-size, 1rem) * 1.2);
  font-weight: 950;
  text-align: left;
}
.summary-card small {
  color: #111827;
  font-size: calc(var(--biz-zone-font-size, 1rem) * 0.8);
  font-weight: 950;
  text-align: right;
}

.summary-card strong {
  display: block;
  max-width: 100%;
  overflow: hidden;
  color: var(--cd-orange);
  font-size: clamp(calc(var(--biz-zone-font-size, 1rem) * 2.2), 3.2vw, calc(var(--biz-zone-font-size, 1rem) * 3.3));
  font-weight: 950;
  line-height: 0.92;
  text-align: right;
  text-overflow: clip;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.payment-ad-rail {
  display: grid;
  grid-template-rows: minmax(0, 0.8fr) minmax(0, 0.312fr);
  gap: 0rem;
  min-width: 0;
  min-height: 0;
}

.qr-panel {
  display: grid;
  justify-items: center;
  align-content: start;
  gap: 0rem;
  min-height: 0;
  height: 100%;
  padding: 0.2rem 0.4rem 0.2rem;
  border: 1px solid #ffedd5;
  border-radius: 0px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 22px 48px rgba(15, 23, 42, 0.1);
  text-align: center;
}

.qr-panel h2 {
  margin: 0;
  color: #111827;
  font-size: calc(var(--biz-zone-font-size, 1rem) * 2.2);
  font-weight: 950;
  line-height: 1.1;
}

.latest-item-image-card {
  display: grid;
  width: min(100%, 18rem);
  max-height: min(42dvh, 24rem);
  aspect-ratio: 1;
  place-items: center;
  align-self: center;
  overflow: hidden;
  border-radius: 8px;
  background: transparent;
}

.latest-item-image-card img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.qr-countdown-card {
  margin-top:3px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: min(calc(var(--biz-zone-font-size, 1rem) * 12.6), 82%);
  gap: 0.6rem;
  /* padding: calc(var(--biz-zone-font-size, 1rem) * 0.45) calc(var(--biz-zone-font-size, 1rem) * 0.65);
  border: 1px solid #ff5a00;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 10px 22px rgba(15, 23, 42, 0.08); */
}

.qr-countdown-card span {
  color: #111827;
  font-size: calc(var(--biz-zone-font-size, 1rem) * 1);
  font-weight: 850;
  line-height: 1.05;
}

.qr-countdown-card strong {
  color: #e84f0a;
  font-size: calc(var(--biz-zone-font-size, 1rem) * 1);
  font-weight: 950;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.qr-image-card {
  position: relative;
  display: grid;
  width: min(17rem, 85%);
  aspect-ratio: 1;
  place-items: center;
  margin-top: calc(var(--biz-zone-font-size, 1rem) * 0.5);
  padding: 0.3rem;
  background: #fff;
  /* border-radius: 12px; */
  box-shadow: 0 20px 36px rgba(15, 23, 42, 0.1);
}

.qr-image-card::before,
.qr-image-card::after {
  content: "";
  position: absolute;
  inset: -0.45rem;
  border: 3px solid var(--cd-orange);
  border-radius: 10px;
  pointer-events: none;
}

.qr-image-card::after {
  inset: -0.2rem;
  border-width: 1px;
  opacity: 0.18;
  animation: qrPulse 1.8s ease-in-out infinite;
}

.qr-image-card--lao {
  width: min(15rem, 70%);
  height: auto;
  aspect-ratio: auto;
  padding: 0;
  background: transparent;
  box-shadow: none;
}

.qr-image-card--lao::before,
.qr-image-card--lao::after {
  content: none;
}

.qr-lao-frame {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  /* padding: calc(var(--biz-zone-font-size, 1rem) * 0.8) calc(var(--biz-zone-font-size, 1rem) * 0.65) calc(var(--biz-zone-font-size, 1rem) * 1.18); */
  border: 7px solid #287dbb;
  border-radius: 10px;
  background: #ffffff;
}

.qr-lao-frame .qr-image {
  display: block;
  width: 100%;
  height: auto;
  border: 0;
  border-radius: 0;
  background: #ffffff;
}

.qr-lao-frame .qr-center-mark {
  top: 50%;
  left: 50%;
  width: 1rem;
  transform: translate(-50%, -50%);
}

.qr-lao-frame-text {
  position: absolute;
  overflow: hidden;
  color: #ffffff;
  font-size: calc(var(--biz-zone-font-size, 1rem) * 0.24);
  font-weight: 900;
  letter-spacing: 0.03em;
  line-height: 1;
  pointer-events: none;
  white-space: nowrap;
}

.qr-lao-frame-text--top {
  top: calc(var(--biz-zone-font-size, 1rem) * -0.31);
  right: 0.2rem;
  left: 0.2rem;
  text-align: center;
}

.qr-lao-frame-text--bottom {
  right: 0.2rem;
  bottom: calc(var(--biz-zone-font-size, 1rem) * -0.31);
  left: 0.2rem;
  text-align: center;
}

.qr-lao-frame-text--left,
.qr-lao-frame-text--right {
  top: 0.15rem;
  bottom: 0.15rem;
  writing-mode: vertical-rl;
}

.qr-lao-frame-text--left {
  left: calc(var(--biz-zone-font-size, 1rem) * -0.32);
  transform: rotate(180deg);
}

.qr-lao-frame-text--right {
  right: calc(var(--biz-zone-font-size, 1rem) * -0.32);
}

.qr-lao-lapnet {
  position: absolute;
  right: 0.15rem;
  bottom: 0.06rem;
  left: 0.15rem;
  color: #287dbb;
  font-size: calc(var(--biz-zone-font-size, 1rem) * 0.45);
  font-weight: 950;
  line-height: 1.1;
  text-align: center;
}

.qr-image-card.placeholder i {
  color: #111827;
  font-size: calc(var(--biz-zone-font-size, 1rem) * 10);
}

.qr-panel p {
  margin: 0rem 0 0;
  color: #334155;
  font-size: calc(var(--biz-zone-font-size, 1rem) * 1.1);
  font-weight: 850;
}

.qr-amount-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.1rem;
  margin-top: 0rem;
}

.qr-provider-name {
  margin: 0;
  color: #475569;
  font-size: calc(var(--biz-zone-font-size, 1rem) * 1.1);
  font-weight: 700;
}

.qr-amount-value {
  margin: 0;
  color: #0f766e;
  font-size: calc(var(--biz-zone-font-size, 1rem) * 1.5) !important;
  font-weight: 900;
  letter-spacing: 0.01em;
}

.qr-bank-icons {
  display: grid;
  justify-items: center;
  gap: 0.2rem;
  /* width: min(calc(var(--biz-zone-font-size, 1rem) * 17), 96%); */
  margin-top: 0rem;
}

.qr-bank-icons p {
  max-width: 100%;
  margin: 0;
  color: #0f3d70;
  font-size: calc(var(--biz-zone-font-size, 1rem) * 1.3);
  font-weight: 850;
  line-height: 1.12;
}

.qr-bank-icons small{
  font-size: calc(var(--biz-zone-font-size, 1rem) * 0.8);
}

.qr-bank-icons img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.qr-scanner-box {
  display: grid;
  width: 100%;
  min-height: 4.8rem;
  place-items: center;
  gap: 0.3rem;
  margin-top: auto;
  border: 2px dashed #fdba74;
  border-radius: 16px;
  background: #fffaf5;
  color: var(--cd-orange);
  animation: scannerGlow 2.4s ease-in-out infinite;
}

.qr-scanner-box i {
  font-size: calc(var(--biz-zone-font-size, 1rem) * 2);
}

.qr-scanner-box span {
  color: #7c2d12;
  font-size: calc(var(--biz-zone-font-size, 1rem) * 1.05);
  font-weight: 950;
}

.qr-image {
  width: 100%;
  height: 100%;
  aspect-ratio: 1;
  object-fit: contain;
}

.qr-center-mark {
  position: absolute;
  width: min(calc(var(--biz-zone-font-size, 1rem) * 3.6), 20%);
  aspect-ratio: 3 / 3;
  /* border-radius: 0.6rem; */
  /* box-shadow: 0 2px 10px rgba(15, 23, 42, 0.16); */
  pointer-events: none;
}

.ad-panel {
  gap: 0.2rem;
  min-height: 0;
  overflow: hidden;
  /* padding: 0.4rem;
  border: 1px solid var(--cd-border);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 22px 48px rgba(15, 23, 42, 0.1); */
}

.ad-title {
  color: #111827;
  font-size: calc(var(--biz-zone-font-size, 1rem) * 1.05);
  font-weight: 950;
}

.ad-media,
.ad-gradient {
  position: relative;
  display: grid;
  place-items: center;
  height: 100%;
  overflow: hidden;
  border-radius: 0px;
  /* border: 1px solid #ffedd5; */
  background: #fff;
}

.ad-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ad-media video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: #fff;
}

.ad-gradient {
  background: #fff;
  color: #fff;
}

.ad-copy {
  display: grid;
  justify-self: start;
  gap: 0.25rem;
  padding: 1.2rem;
  text-align: left;
}

.ad-copy span {
  font-size: calc(var(--biz-zone-font-size, 1rem) * 0.95);
  font-weight: 850;
  opacity: 0.9;
}

.ad-copy strong {
  max-width: 12rem;
  font-size: clamp(calc(var(--biz-zone-font-size, 1rem) * 1.75), 2.6vw, calc(var(--biz-zone-font-size, 1rem) * 2.65));
  font-weight: 950;
  line-height: 1.05;
}

.ad-copy small {
  max-width: 16rem;
  font-size: calc(var(--biz-zone-font-size, 1rem) * 0.95);
  font-weight: 800;
  opacity: 0.92;
}

.ad-play-overlay {
  position: absolute;
  left: 1rem;
  bottom: 0.9rem;
  display: grid;
  width: 2.2rem;
  height: 2.2rem;
  place-items: center;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  color: var(--cd-orange);
  box-shadow: 0 10px 22px rgba(0, 0, 0, 0.22);
}

@keyframes qrPulse {
  0%,
  100% {
    opacity: 0.12;
    transform: scale(1);
  }
  50% {
    opacity: 0.34;
    transform: scale(1.025);
  }
}

@keyframes scannerGlow {
  0%,
  100% {
    box-shadow: 0 0 0 rgba(255, 107, 0, 0);
  }
  50% {
    box-shadow: 0 0 0 5px rgba(255, 107, 0, 0.08);
  }
}

.thankyou-overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  padding: 2rem;
  background: rgba(15, 23, 42, 0.26);
  backdrop-filter: blur(5px);
}

.thankyou-dialog {
  position: relative;
  display: grid;
  width: min(34rem, 92vw);
  gap: 1rem;
  padding: 1.35rem;
  border: 1px solid rgba(34, 197, 94, 0.35);
  border-radius: 24px;
  background: linear-gradient(180deg, rgba(240, 253, 244, 0.98), rgba(255, 255, 255, 0.98)), #fff;
  box-shadow: 0 28px 80px rgba(15, 23, 42, 0.32);
  text-align: center;
}

.thankyou-side-image {
  position: absolute;
  top: 50%;
  width: clamp(3.2rem, 7vw, 4.5rem);
  height: auto;
  transform: translateY(-50%);
  pointer-events: none;
}

.thankyou-side-image.left {
  top: 50%;
  left: -22.2rem;
  width: 25rem;
}

.thankyou-side-image.right {
  top: 53%;
  right: -15.2rem;
  width: 16rem;
}

.thankyou-icon {
  display: grid;
  width: 4.4rem;
  height: 4.4rem;
  place-items: center;
  justify-self: center;
  border-radius: 999px;
  background: linear-gradient(135deg, #22c55e, #16a34a);
  color: #fff;
  font-size: 2rem;
  box-shadow: 0 14px 30px rgba(22, 163, 74, 0.28);
}

.thankyou-heading {
  display: grid;
  gap: 0.25rem;
}

.thankyou-heading strong {
  color: #166534;
  font-size: clamp(2.1rem, 5vw, 3.3rem);
  font-weight: 950;
  line-height: 1.05;
}

.thankyou-heading span {
  color: #1f2937;
  font-size: 1.25rem;
  font-weight: 900;
}

.thankyou-heading small {
  color: var(--cd-muted);
  font-size: 0.95rem;
  font-weight: 850;
}

.thankyou-lines {
  display: grid;
  gap: 0.7rem;
  padding: 0.9rem;
  border: 1px solid #bbf7d0;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.8);
}

.thankyou-lines div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}

.thankyou-lines span {
  color: #334155;
  font-size: 1.05rem;
  font-weight: 900;
}

.thankyou-lines b {
  color: #0f172a;
  font-size: 1.45rem;
  font-weight: 950;
  font-variant-numeric: tabular-nums;
}

.thankyou-lines .paid {
  color: var(--cd-green-dark);
}

.thankyou-lines .change {
  color: var(--cd-orange);
}

.satisfaction-panel {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 0.75rem;
  padding: 0.9rem;
  border: 1px solid #dbeafe;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.86);
}

.satisfaction-panel > strong {
  color: #0f172a;
  font-size: calc(var(--biz-zone-font-size, 1rem) * 1.25);
  font-weight: 950;
}

.satisfaction-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.8rem;
}

.satisfaction-button {
  display: grid;
  justify-items: center;
  gap: 0.35rem;
  min-width: 0;
  padding: 0.55rem 0.45rem 0.65rem;
  border: 2px solid currentColor;
  border-radius: 16px;
  background: #fff;
  color: #64748b;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}

.satisfaction-button:not(:disabled):hover,
.satisfaction-button.selected {
  transform: translateY(-2px);
  box-shadow: 0 14px 26px rgba(15, 23, 42, 0.14);
}

.satisfaction-button:disabled {
  cursor: default;
  opacity: 0.72;
}

.satisfaction-button.great {
  color: #4dbd39;
}

.satisfaction-button.okay {
  color: #f6bd2d;
}

.satisfaction-button.improve {
  color: #e13b3f;
}

.satisfaction-button b {
  color: #0f172a;
  font-size: calc(var(--biz-zone-font-size, 1rem) * 0.95);
  font-weight: 950;
  line-height: 1.1;
}

.satisfaction-face {
  position: relative;
  display: block;
  width: calc(var(--biz-zone-font-size, 1rem) * 4.2);
  aspect-ratio: 1;
  border: 0.25rem solid currentColor;
  border-radius: 999px;
}

.satisfaction-face::before {
  content: "";
  position: absolute;
  top: 29%;
  left: 28%;
  width: 0.36rem;
  aspect-ratio: 1;
  border-radius: 999px;
  background: currentColor;
  box-shadow: calc(var(--biz-zone-font-size, 1rem) * 1.48) 0 0 currentColor;
}

.satisfaction-face::after {
  content: "";
  position: absolute;
  left: 50%;
  width: 42%;
  height: 22%;
  transform: translateX(-50%);
}

.satisfaction-button.great .satisfaction-face::after {
  bottom: 23%;
  border-bottom: 0.24rem solid currentColor;
  border-radius: 0 0 999px 999px;
}

.satisfaction-button.okay .satisfaction-face::after {
  top: 61%;
  height: 0;
  border-top: 0.24rem solid currentColor;
  border-radius: 999px;
}

.satisfaction-button.improve .satisfaction-face::after {
  top: 61%;
  border-top: 0.24rem solid currentColor;
  border-radius: 999px 999px 0 0;
}

.satisfaction-status,
.satisfaction-thanks,
.satisfaction-error {
  margin: 0;
  font-size: calc(var(--biz-zone-font-size, 1rem) * 1);
  font-weight: 900;
  line-height: 1.3;
}

.satisfaction-status {
  color: #0369a1;
}

.satisfaction-thanks {
  color: #166534;
}

.satisfaction-error {
  color: #b91c1c;
}

.idle-benefits {
  display: grid;
  width: min(64rem, 100%);
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  margin-top: auto;
  padding: 1.6rem 0 1.45rem;
  border-top: 1px solid #e5e7eb;
  border-bottom: 1px solid #e5e7eb;
}

.idle-benefits > div {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  grid-template-rows: auto auto;
  column-gap: 0.9rem;
  align-items: center;
  justify-content: center;
  min-width: 0;
  padding: 0 1.4rem;
  text-align: left;
}

.idle-benefits > div + div {
  border-left: 1px solid #e5e7eb;
}

.idle-benefits i {
  grid-row: 1 / 3;
  color: var(--cd-orange);
  font-size: 2.15rem;
}

.idle-benefits b {
  color: #17233a;
  font-size: 1.1rem;
  font-weight: 950;
}

.idle-benefits small {
  overflow: hidden;
  color: #64748b;
  font-size: 0.95rem;
  font-weight: 820;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.idle-thanks {
  display: grid;
  justify-items: center;
  gap: 0.2rem;
  padding-top: 1.1rem;
}

.idle-thanks i,
.idle-thanks b {
  color: var(--cd-orange);
}

.idle-thanks i {
  font-size: 1.4rem;
}

.idle-thanks b {
  font-size: 1.2rem;
  font-weight: 950;
}

.idle-thanks small {
  color: #64748b;
  font-size: 0.95rem;
  font-weight: 820;
}

@media (max-width: 1100px) {
  .display-grid {
    grid-template-columns: minmax(0, 1fr) minmax(21rem, 34vw);
    gap: 0.5rem;
    padding: 0.5rem;
  }

  .item-row {
    grid-template-columns: auto minmax(0, 1fr) 4.5rem 6.5rem 7.5rem;
    gap: 0.5rem;
    padding: 0.75rem 0.9rem;
  }

  .item-table-head {
    grid-template-columns: minmax(0, 1fr) 4.5rem 6.5rem 7.5rem;
    gap: 0.5rem;
    padding: 0.75rem 0.9rem;
    font-size: 0.95rem;
  }

  .item-name strong {
    font-size: 1.02rem;
  }

  .item-qty,
  .item-price,
  .item-total {
    font-size: 0.98rem;
  }

  .item-total strong {
    font-size: 1.05rem;
  }

  .summary-card {
    padding: 0 0 0.6rem;
  }

  .summary-card strong {
    font-size: clamp(2.3rem, 4.2vw, 3.4rem);
  }

  .qr-image-card {
    width: min(calc(var(--biz-zone-font-size, 1rem) * 12), 65%);
  }

  .ad-panel,
  .ad-media,
  .ad-gradient {
    border-radius: 0px;
  }
}

@media (max-width: 767px) {
  .customer-display {
    grid-template-rows: auto minmax(0, 1fr);
  }

  .display-grid {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1fr) auto;
    overflow: auto;
    padding: 0.5rem;
  }

  .display-left {
    grid-template-rows: minmax(24rem, 1fr) auto;
  }

  .summary-panel {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: repeat(2, minmax(9rem, 1fr));
  }

  .display-meta span:first-child {
    display: none;
  }

  .customer-area {
    justify-items: start;
    text-align: left;
  }

  .customer-area strong {
    font-size: 1.05rem;
  }

  .item-row,
  .item-table-head {
    grid-template-columns: auto minmax(0, 1fr) 4.5rem 6rem 7rem;
  }

  .qr-panel {
    min-height: 8rem;
  }

  .payment-ad-rail {
    grid-template-rows: minmax(18rem, 1fr) minmax(12rem, 1fr);
  }

  .thankyou-side-image.left {
    left: 0.5rem;
  }

  .thankyou-side-image.right {
    right: 0.5rem;
  }
}
</style>
