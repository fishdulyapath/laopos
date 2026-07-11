<script setup>
import { ref, computed, onMounted } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Skeleton from "primevue/skeleton";
import Dialog from "primevue/dialog";
import { useCartStore } from "@/stores/cart";
import { usePosStore } from "@/stores/pos";
import { getProductPrice } from "@/services/sellService";
import { formatCurrency } from "@/utils/formatters";
import { calcAfterDiscount, calcDiscountAmount } from "@/utils/discount";
import { productImageUrl } from "@/utils/imageUrls";

const props = defineProps({
  basket: { type: Object, required: true },
  confirmedInfo: { type: Object, required: true },
});
const emit = defineEmits(["back", "confirm"]);

const cartStore = useCartStore();
const posStore = usePosStore();

function imageUrl(item_code) {
  return productImageUrl(item_code);
}
function onImgError(e) {
  e.target.style.display = "none";
  e.target.nextElementSibling?.style.setProperty("display", "flex");
}
const discountWord = ref("");
const loading = ref(false);
const showTaxDetail = ref(false);
const showErrorDialog = ref(false);
const showZeroPriceDialog = ref(false);
const retrying = ref(false);

const freshPrices = ref({});

const rows = computed(() =>
  cartStore.items.map((i) => ({
    ...i,
    fresh: freshPrices.value[i.guid_code],
  })),
);

function itemNet(r) {
  const fresh = r.fresh;
  if (!fresh || !fresh.success) return 0;
  return calcDiscountAmount(Number(fresh.price ?? 0), Number(r.qty), fresh.default_discount).sum_amount;
}

// tax_type ของสินค้า: 1 = ยกเว้นภาษี, อื่น ๆ = มี VAT
const totalValueVat = computed(() =>
  rows.value.reduce((sum, r) => {
    if (Number(r.tax_type) === 1) return sum;
    return sum + itemNet(r);
  }, 0),
);

const totalValueNoVat = computed(() =>
  rows.value.reduce((sum, r) => {
    if (Number(r.tax_type) !== 1) return sum;
    return sum + itemNet(r);
  }, 0),
);

const subtotal = computed(() => totalValueVat.value + totalValueNoVat.value);

// ─── Calculation (ported from C# _icTransProcess via Flutter) ───────────────

function rnd(value, point) {
  const f = Math.pow(10, point);
  return Math.round(value * f) / f;
}

function vatCalc(totalValueVat, totalValueNoVat, discWord, vatRate, vatType, discountType = 0, discountVatType = 0, amountPoint = 2) {
  const p = amountPoint;
  const totalValue = totalValueVat + totalValueNoVat;
  const afterDiscount = calcAfterDiscount(discWord, totalValue, p);
  const totalDiscount = rnd(totalValue - afterDiscount, p);

  let beforeVat = 0,
    vatValue = 0,
    afterVat = 0,
    totalAmount = 0;
  let totalExceptVat = totalValueNoVat;
  let discountNoVatAmount = 0;

  switch (vatType) {
    case 0: {
      // แยกนอก
      if (discountType === 1) {
        if (discountVatType === 1) {
          const dvp = totalValue > 0 ? rnd(totalDiscount * (totalValueVat / totalValue), p) : 0;
          discountNoVatAmount = totalDiscount - dvp;
          beforeVat = totalValueVat - dvp;
          vatValue = rnd(beforeVat * (vatRate / 100), p);
        } else {
          if (totalValueVat < totalDiscount) {
            beforeVat = 0;
            discountNoVatAmount = totalDiscount - totalValueVat;
          } else {
            beforeVat = totalValueVat - totalDiscount;
          }
          vatValue = totalValueVat < totalDiscount ? 0 : rnd(beforeVat * (vatRate / 100), p);
        }
        afterVat = beforeVat + vatValue;
        totalExceptVat = totalExceptVat - discountNoVatAmount;
        totalAmount = totalExceptVat + afterVat;
      } else {
        beforeVat = totalValueVat;
        vatValue = rnd(beforeVat * (vatRate / 100), p);
        afterVat = beforeVat + vatValue;
        totalAmount = beforeVat + totalExceptVat + vatValue - totalDiscount;
      }
      break;
    }
    case 1: {
      // รวมใน
      totalAmount = totalValue - totalDiscount;
      if (discountType === 1) {
        if (discountVatType === 1) {
          const dvp = totalValue > 0 ? rnd(totalDiscount * (totalValueVat / totalValue), p) : 0;
          discountNoVatAmount = totalDiscount - dvp;
          const base = totalValueVat - dvp;
          beforeVat = rnd((base * 100) / (100 + vatRate), p);
          vatValue = rnd(base - beforeVat, p);
        } else {
          if (totalValueVat < totalDiscount) {
            beforeVat = 0;
            vatValue = 0;
            discountNoVatAmount = totalDiscount - totalValueVat;
          } else {
            const base = totalValueVat - totalDiscount;
            beforeVat = rnd((base * 100) / (100 + vatRate), p);
            vatValue = rnd(base - beforeVat, p);
          }
        }
        afterVat = beforeVat + vatValue;
        totalExceptVat = totalExceptVat - discountNoVatAmount;
      } else {
        beforeVat = rnd((totalValueVat * 100) / (100 + vatRate), p);
        vatValue = rnd(totalValueVat - beforeVat, p);
        afterVat = beforeVat + vatValue;
      }
      break;
    }
    default: {
      // ไม่กระทบ / ศูนย์
      vatValue = 0;
      if (discountVatType === 1 && totalValue > 0) {
        const dvp = rnd(totalDiscount * (totalValueVat / totalValue), p);
        discountNoVatAmount = totalDiscount - dvp;
      }
      totalExceptVat = totalExceptVat - discountNoVatAmount;
      totalAmount = totalValue - totalDiscount;
      break;
    }
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

const fetchErrorItems = computed(() => rows.value.filter((r) => r.fresh && !r.fresh.loading && !r.fresh.success));

const zeroPriceItems = computed(() =>
  rows.value.filter((r) => {
    if (!r.fresh || r.fresh.loading || !r.fresh.success) return false;
    return Number(r.fresh.price) === 0;
  }),
);

const canConfirm = computed(() => !loading.value && !retrying.value && fetchErrorItems.value.length === 0);

const erpVatRate = computed(() => Number(posStore.erpOption?.vat_rate ?? 7.0));
const erpDiscountType = computed(() => Number(posStore.erpOption?.discout_type ?? 0));

const calcResult = computed(() => {
  const vatType = props.confirmedInfo.vat_type ?? 1;
  return vatCalc(totalValueVat.value, totalValueNoVat.value, discountWord.value, erpVatRate.value, vatType, erpDiscountType.value);
});

const vatLabel = computed(() => {
  const vt = props.confirmedInfo.vat_type ?? 1;
  if (vt === 0) return `ภาษีมูลค่าเพิ่ม ${erpVatRate.value}% (แยกนอก)`;
  if (vt === 1) return `ภาษีมูลค่าเพิ่ม ${erpVatRate.value}% (รวมใน)`;
  return null;
});

// ─── Fetch fresh prices ──────────────────────────────────────────────────────

async function fetchPricesFor(items) {
  const custCode = props.basket.cust_code || "";
  const priceOpts = {
    sale_type: props.confirmedInfo.inquiry_type ?? props.basket.inquiry_type ,
    vat_type: props.confirmedInfo.vat_type ?? props.basket.vat_type,
    vat_rate: props.confirmedInfo.vat_rate ?? props.basket.vat_rate,
  };
  await Promise.all(
    items.map(async (item) => {
      freshPrices.value[item.guid_code] = { price: null, loading: true, success: false };
      try {
        const result = await getProductPrice(item.item_code, item.unit_code, custCode, String(item.qty), priceOpts);
        freshPrices.value[item.guid_code] = {
          price: Number(result?.price ?? 0),
          list_price: Number(result?.price1 ?? result?.price ?? 0),
          default_discount: result?.defaultDiscount ?? "",
          loading: false,
          success: true,
        };
      } catch {
        freshPrices.value[item.guid_code] = { price: 0, list_price: 0, default_discount: "", loading: false, success: false };
      }
    }),
  );
}

onMounted(async () => {
  loading.value = true;
  await fetchPricesFor(cartStore.items);
  loading.value = false;
  if (fetchErrorItems.value.length > 0) showErrorDialog.value = true;
});

async function retryFailed() {
  const failedGuids = new Set(fetchErrorItems.value.map((r) => r.guid_code));
  const itemsToRetry = cartStore.items.filter((i) => failedGuids.has(i.guid_code));
  retrying.value = true;
  showErrorDialog.value = false;
  await fetchPricesFor(itemsToRetry);
  retrying.value = false;
  if (fetchErrorItems.value.length > 0) showErrorDialog.value = true;
}

function priceChanged(item) {
  const fp = freshPrices.value[item.guid_code];
  if (!fp || fp.loading) return false;
  return Number(fp.price) !== Number(item.price);
}

function emitConfirm() {
  emit("confirm", {
    ...props.confirmedInfo,
    discount_word: discountWord.value,
    total_value: calcResult.value.totalValue,
    total_discount: calcResult.value.totalDiscount,
    total_before_vat: calcResult.value.beforeVat,
    vat_value: calcResult.value.vatValue,
    total_after_vat: calcResult.value.afterVat,
    total_except_vat: calcResult.value.totalExceptVat,
    total_amount: calcResult.value.totalAmount,
    fresh_prices: freshPrices.value,
  });
}

function confirm() {
  if (zeroPriceItems.value.length > 0) {
    showZeroPriceDialog.value = true;
    return;
  }
  emitConfirm();
}

function confirmZeroPrice() {
  showZeroPriceDialog.value = false;
  emitConfirm();
}
</script>

<template>
  <div class="price-check-view">
    <!-- Error dialog -->
    <Dialog :visible="showErrorDialog" modal header="ดึงราคาไม่สำเร็จ" :style="{ width: '22rem' }" @update:visible="showErrorDialog = $event">
      <div class="error-dialog-body">
        <i class="pi pi-exclamation-circle error-dialog-icon" />
        <p class="error-dialog-msg">ไม่สามารถดึงราคาสินค้าบางรายการได้ กรุณาลองใหม่อีกครั้ง</p>
        <ul class="error-dialog-list">
          <li v-for="item in fetchErrorItems" :key="item.guid_code">{{ item.item_name }} ({{ item.unit_code }})</li>
        </ul>
      </div>
      <template #footer>
        <Button label="ดึงใหม่" icon="pi pi-refresh" class="w-full" @click="retryFailed" />
      </template>
    </Dialog>

    <Dialog
      :visible="showZeroPriceDialog"
      modal
      header="ยืนยันสินค้าราคา 0"
      :style="{ width: '24rem' }"
      @update:visible="showZeroPriceDialog = $event"
    >
      <div class="error-dialog-body">
        <i class="pi pi-exclamation-triangle zero-price-dialog-icon" />
        <p class="error-dialog-msg">มีสินค้าราคา 0 บาท ต้องยืนยันก่อนดำเนินการต่อ</p>
        <ul class="error-dialog-list">
          <li v-for="item in zeroPriceItems" :key="item.guid_code">{{ item.item_name }} ({{ item.unit_code }})</li>
        </ul>
      </div>
      <template #footer>
        <div class="dialog-footer-actions">
          <Button label="ยกเลิก" severity="secondary" outlined @click="showZeroPriceDialog = false" />
          <Button label="ยืนยันราคา 0" icon="pi pi-check" severity="warning" @click="confirmZeroPrice" />
        </div>
      </template>
    </Dialog>

    <div class="price-check-header">
      <Button icon="pi pi-arrow-left" text rounded size="small" @click="emit('back')" aria-label="กลับ" />
      <span class="header-title">ตรวจสอบราคา & ส่วนลด</span>
    </div>

    <div class="price-check-body">
      <table class="price-table">
        <thead>
          <tr>
            <th class="col-name">สินค้า</th>
            <th class="col-qty">จำนวน</th>
            <th class="col-price">ราคา</th>
            <th class="col-discount">ส่วนลด</th>
            <th class="col-sum">รวม</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.guid_code"
            :class="{
              'row-changed': priceChanged(row),
              'row-error': row.fresh && !row.fresh.loading && !row.fresh.success,
            }"
          >
            <td class="col-name">
              <div class="name-cell">
                <div class="item-img-wrap">
                  <img :src="imageUrl(row.item_code)" :alt="row.item_name" class="item-img" @error="onImgError" />
                  <div class="item-img-placeholder"><i class="pi pi-box" /></div>
                </div>
                <div class="name-info">
                  <div class="name-text">{{ row.item_name }}</div>
                  <div class="unit-text">{{ row.unit_code }}</div>
                </div>
              </div>
            </td>
            <td class="col-qty">{{ row.qty }}</td>
            <td class="col-price">
              <Skeleton v-if="row.fresh?.loading" width="4rem" height="1rem" />
              <span v-else-if="row.fresh && !row.fresh.success" class="fetch-error-label">ดึงราคาไม่ได้</span>
              <template v-else>
                <span :class="priceChanged(row) ? 'new-price-changed' : 'price-normal'">
                  {{ formatCurrency(row.fresh?.price ?? 0) }}
                </span>
              </template>
            </td>
            <td class="col-discount">
              <span v-if="row.fresh?.default_discount" class="discount-tag">{{ row.fresh.default_discount }}</span>
              <span v-else class="discount-empty">-</span>
            </td>
            <td class="col-sum">
              <Skeleton v-if="row.fresh?.loading" width="4rem" height="1rem" />
              <span v-else-if="row.fresh && row.fresh.success">{{ formatCurrency(itemNet(row)) }}</span>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Mobile card list -->
      <div class="price-cards">
        <div
          v-for="row in rows"
          :key="row.guid_code"
          class="price-card"
          :class="{
            'card-changed': priceChanged(row),
            'card-error': row.fresh && !row.fresh.loading && !row.fresh.success,
          }"
        >
          <div class="card-img-wrap">
            <img :src="imageUrl(row.item_code)" :alt="row.item_name" class="item-img" @error="onImgError" />
            <div class="item-img-placeholder"><i class="pi pi-box" /></div>
          </div>
          <div class="card-info">
            <div class="card-info-top">
              <div class="card-name">{{ row.item_name }}</div>
              <div class="card-sum">
                <Skeleton v-if="row.fresh?.loading" width="4rem" height="1rem" />
                <span v-else-if="row.fresh && row.fresh.success" class="card-sum-value">
                  {{ formatCurrency(itemNet(row)) }}
                </span>
                <span v-else-if="row.fresh && !row.fresh.success" class="fetch-error-label">ดึงไม่ได้</span>
              </div>
            </div>
            <div class="card-meta-line">{{ row.item_code }} · {{ row.unit_code }}</div>
            <div class="card-info-bottom">
              <div class="card-price-line">
                <Skeleton v-if="row.fresh?.loading" width="5rem" height="0.85rem" />
                <template v-else-if="row.fresh && row.fresh.success">
                  <span :class="priceChanged(row) ? 'new-price-changed' : ''">
                    {{ formatCurrency(row.fresh?.price ?? 0) }}
                  </span>
                  <span class="card-qty"> × {{ row.qty }}</span>
                  <span v-if="row.fresh?.default_discount" class="discount-tag">ลด {{ row.fresh.default_discount }}</span>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="price-check-footer">
      <!-- ส่วนลด + ยอดรวม -->
      <div class="summary-block">
        <!-- ส่วนลด input -->
        <div class="discount-row-input">
          <span class="sum-label">ส่วนลดท้ายบิล</span>
          <InputText v-model="discountWord" class="discount-input" size="small" />
        </div>

        <div class="divider" />

        <div class="sum-row">
          <span class="sum-label">ยอดรวมสินค้า</span>
          <span class="sum-value">{{ formatCurrency(calcResult.totalValue) }}</span>
        </div>
        <div v-if="calcResult.totalDiscount > 0" class="sum-row">
          <span class="sum-label">ส่วนลด</span>
          <span class="sum-value sum-discount">-{{ formatCurrency(calcResult.totalDiscount) }}</span>
        </div>
        <template v-if="vatLabel">
          <div class="sum-row">
            <span class="sum-label">ยอดก่อนภาษี</span>
            <span class="sum-value">{{ formatCurrency(calcResult.beforeVat) }}</span>
          </div>
          <div class="sum-row">
            <span class="sum-label">{{ vatLabel }}</span>
            <span class="sum-value">{{ formatCurrency(calcResult.vatValue) }}</span>
          </div>
        </template>

        <div class="divider" />

        <div class="sum-row net-row">
          <span class="net-label">ยอดสุทธิ</span>
          <span class="net-value">{{ formatCurrency(calcResult.totalAmount) }}</span>
        </div>

        <!-- Toggle รายละเอียดภาษี -->
        <button class="tax-toggle" @click="showTaxDetail = !showTaxDetail">
          <i class="pi pi-receipt" />
          {{ showTaxDetail ? "ซ่อนรายละเอียดภาษี" : "รายละเอียดภาษี" }}
          <i :class="showTaxDetail ? 'pi pi-chevron-up' : 'pi pi-chevron-down'" />
        </button>

        <!-- รายละเอียดภาษี -->
        <div v-if="showTaxDetail" class="tax-detail">
          <div class="tax-grid">
            <div class="tax-cell">
              <span class="tax-key">ประเภทภาษี</span>
              <span class="tax-val">{{ ["แยกนอก", "รวมใน", "ไม่กระทบ", "ศูนย์"][confirmedInfo.vat_type] ?? "-" }}</span>
            </div>
            <div class="tax-cell">
              <span class="tax-key">อัตราภาษี</span>
              <span class="tax-val">{{ erpVatRate }}%</span>
            </div>
            <div class="tax-cell">
              <span class="tax-key">มูลค่าสินค้ารวม</span>
              <span class="tax-val">{{ formatCurrency(calcResult.totalValue) }}</span>
            </div>
            <div class="tax-cell">
              <span class="tax-key">ส่วนลดรวม</span>
              <span class="tax-val" :class="{ 'val-discount': calcResult.totalDiscount > 0 }">
                {{ calcResult.totalDiscount > 0 ? formatCurrency(calcResult.totalDiscount) : "-" }}
              </span>
            </div>
            <div class="tax-cell">
              <span class="tax-key">ยอดก่อนภาษี</span>
              <span class="tax-val">{{ formatCurrency(calcResult.beforeVat) }}</span>
            </div>
            <div class="tax-cell">
              <span class="tax-key">ภาษีมูลค่าเพิ่ม</span>
              <span class="tax-val">{{ calcResult.vatValue > 0 ? formatCurrency(calcResult.vatValue) : "-" }}</span>
            </div>
            <div v-if="calcResult.totalExceptVat > 0" class="tax-cell">
              <span class="tax-key">มูลค่ายกเว้นภาษี</span>
              <span class="tax-val">{{ formatCurrency(calcResult.totalExceptVat) }}</span>
            </div>
            <div class="tax-cell">
              <span class="tax-key">ยอดสุทธิ</span>
              <span class="tax-val tax-net">{{ formatCurrency(calcResult.totalAmount) }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="footer-confirm">
        <div v-if="zeroPriceItems.length > 0" class="zero-price-warning">
          <i class="pi pi-exclamation-triangle warning-icon" />
          <div>
            <div class="warning-title">มีสินค้าราคา 0 ต้องยืนยันก่อนบันทึก</div>
            <div class="warning-items">
              <span v-for="item in zeroPriceItems" :key="item.guid_code" class="warning-item"> {{ item.item_name }} ({{ item.unit_code }}) </span>
            </div>
          </div>
        </div>
        <Button :label="`ยืนยัน ${formatCurrency(calcResult.totalAmount)}`" icon="pi pi-check" icon-pos="right" :disabled="!canConfirm" class="w-full" size="large" @click="confirm" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.price-check-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
}

.price-check-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--p-surface-border);
  flex-shrink: 0;
}

.header-title {
  font-size: 1.05rem;
  font-weight: 600;
}

.price-check-body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 0.75rem 1rem;
}

/* ─── Price table ─── */
.price-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.price-table th {
  text-align: left;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--p-text-color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.4rem 0.5rem;
  border-bottom: 1px solid var(--p-surface-border);
}

.price-table td {
  padding: 0.5rem;
  border-bottom: 1px solid var(--p-surface-border);
  vertical-align: middle;
}

.price-table tr.row-changed td {
  background: #fff7ed;
}

.col-name {
  min-width: 0;
}
.col-qty {
  text-align: center !important;
  width: 3.5rem;
}
.col-price {
  text-align: center !important;
  width: 6.5rem;
  white-space: nowrap;
}
.col-discount {
  text-align: center !important;
  width: 4.5rem;
}
.col-sum {
  text-align: center !important;
  width: 6rem;
  white-space: nowrap;
  font-weight: 600;
}
.list-price-strike {
  display: inline-block;
  margin-right: 0.3rem;
  color: #94a3b8;
  text-decoration: line-through;
  font-size: 0.78rem;
}
.discount-empty {
  color: #cbd5e1;
}

.name-cell {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.item-img-wrap {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  background: var(--p-surface-ground);
  flex-shrink: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.item-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 2px;
}

.item-img-placeholder {
  display: none;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 1rem;
  color: var(--p-surface-400);
}

.name-info {
  flex: 1;
  min-width: 0;
}

.name-text {
  font-weight: 500;
  line-height: 1.3;
}

.unit-text {
  font-size: 0.72rem;
  color: var(--p-text-color-secondary);
  margin-top: 2px;
}

.old-price {
  display: block;
  font-size: 0.7rem;
  color: var(--p-text-color-secondary);
  text-decoration: line-through;
}

.new-price-changed {
  color: #ea580c;
  font-weight: 700;
}
.price-normal {
  color: var(--p-text-color);
}

.price-table tr.row-error td {
  background: #fef2f2;
}
.fetch-error-label {
  font-size: 0.75rem;
  color: #dc2626;
  font-style: italic;
}

/* ─── Mobile card layout ─── */
.price-cards {
  display: none;
  flex-direction: column;
  gap: 0.5rem;
}

.price-card {
  background: var(--p-surface-card, #ffffff);
  border: 1px solid var(--p-surface-border);
  border-radius: 10px;
  padding: 0.625rem 0.75rem;
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
}

.price-card.card-changed {
  background: #fff7ed;
  border-color: #fed7aa;
}
.price-card.card-error {
  background: #fef2f2;
  border-color: #fecaca;
}

.card-img-wrap {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  background: var(--p-surface-ground);
  flex-shrink: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.card-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.card-info-top {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}

.card-name {
  flex: 1;
  font-weight: 600;
  font-size: 0.9rem;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  min-width: 0;
}

.card-sum {
  flex-shrink: 0;
  text-align: right;
  min-width: 4.5rem;
}

.card-sum-value {
  font-size: 1rem;
  font-weight: 700;
  color: var(--p-primary-color);
  white-space: nowrap;
}

.card-meta-line {
  font-size: 0.72rem;
  color: var(--p-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-info-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 2px;
}

.card-price-line {
  font-size: 0.82rem;
  color: var(--p-text-color);
  white-space: nowrap;
}

.card-qty {
  color: var(--p-text-color-secondary);
}

@media (max-width: 640px) {
  .price-table {
    display: none;
  }
  .price-cards {
    display: flex;
  }
  .price-check-body {
    padding: 0.5rem 0.625rem;
  }
}

/* ─── Summary block ─── */
.summary-block {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0.625rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.discount-row-input {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.discount-input {
  width: 11rem;
}

.w-full {
  width: 100%;
}

.divider {
  height: 1px;
  background: var(--p-surface-border);
  margin: 0.125rem 0;
}

.sum-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.sum-label {
  font-size: 0.875rem;
  color: var(--p-text-color-secondary);
}

.sum-value {
  font-size: 0.9rem;
  font-weight: 500;
}

.sum-discount {
  color: #dc2626;
}

.net-row {
  padding-top: 0.25rem;
}

.net-label {
  font-size: 0.95rem;
  font-weight: 600;
}

.net-value {
  font-size: 1.35rem;
  font-weight: 700;
  color: var(--p-primary-color);
}

/* ─── Tax toggle ─── */
.tax-toggle {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  border: none;
  background: none;
  padding: 0.25rem 0;
  font-size: 0.78rem;
  color: var(--p-text-color-secondary);
  cursor: pointer;
  font-family: inherit;
  align-self: flex-start;
}

.tax-toggle:hover {
  color: var(--p-primary-color);
}
.tax-toggle .pi {
  font-size: 0.72rem;
}

/* ─── Tax detail grid ─── */
.tax-detail {
  background: var(--p-surface-ground);
  border-radius: 8px;
  padding: 0.75rem;
}

.tax-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem 1rem;
}

.tax-cell {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.tax-key {
  font-size: 0.72rem;
  color: var(--p-text-color-secondary);
}

.tax-val {
  font-size: 0.82rem;
  font-weight: 500;
}

.val-discount {
  color: #dc2626;
}
.tax-net {
  color: var(--p-primary-color);
  font-weight: 700;
}

.discount-tag {
  background: #fef3c7;
  color: #b45309;
  margin-left: 5px;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  font-weight: 600;
  font-size: 0.78rem;
}
.sum-round-up {
  color: #16a34a;
}
.sum-round-down {
  color: #dc2626;
}

/* ─── Footer ─── */
.price-check-footer {
  border-top: 2px solid var(--p-surface-border);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  max-height: 55vh;
  overflow: hidden;
  background: var(--p-surface-0, #ffffff);
  position: sticky;
  bottom: 0;
  z-index: 5;
}

.footer-confirm {
  flex-shrink: 0;
  padding: 0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom));
  border-top: 1px solid var(--p-surface-border);
}

.zero-price-warning {
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 0.625rem 0.75rem;
}

.warning-icon {
  color: #dc2626;
  font-size: 1rem;
  flex-shrink: 0;
  margin-top: 0.1rem;
}

.warning-title {
  font-size: 0.83rem;
  font-weight: 600;
  color: #dc2626;
}

.warning-items {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  margin-top: 0.2rem;
}

.warning-item {
  font-size: 0.78rem;
  color: #b91c1c;
}

/* ─── Error dialog ─── */
.error-dialog-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0;
  text-align: center;
}

.error-dialog-icon {
  font-size: 2.5rem;
  color: #dc2626;
}

.zero-price-dialog-icon {
  font-size: 2.5rem;
  color: #f59e0b;
}

.error-dialog-msg {
  font-size: 0.9rem;
  color: var(--p-text-color);
  margin: 0;
}

.error-dialog-list {
  list-style: none;
  margin: 0;
  padding: 0;
  width: 100%;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.error-dialog-list li {
  font-size: 0.82rem;
  color: #b91c1c;
  background: #fef2f2;
  border-radius: 6px;
  padding: 0.3rem 0.6rem;
}

.dialog-footer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  width: 100%;
}
</style>
