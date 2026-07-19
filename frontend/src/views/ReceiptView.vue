<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { getReceiptDetail } from '@/services/sellService'

const route = useRoute()
const receipt = ref(null)
const loading = ref(true)
const error = ref('')

function formatDate(val) {
  if (!val) return ''
  const text = String(val).trim().slice(0, 10)
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (match) return `${match[3]}/${match[2]}/${match[1]}`
  const d = new Date(val)
  if (isNaN(d)) return val
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  return `${day}/${month}/${d.getFullYear()}`
}

function formatCurrency(val) {
  if (val == null) return '0.00'
  return Number(val).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const vatLabel = computed(() => {
  if (!receipt.value) return ''
  const vt = Number(receipt.value.vat_type)
  if (vt === 0) return `ภาษี ${receipt.value.vat_rate}% (แยกนอก)`
  if (vt === 1) return `ภาษี ${receipt.value.vat_rate}% (รวมใน)`
  return null
})

const inquiryLabel = computed(() => {
  if (!receipt.value) return ''
  const t = Number(receipt.value.inquiry_type)
  if (t === 0 || t === 2) return 'เชื่อ'
  return 'สด'
})

const isCopy = computed(() => route.query.copy === '1')

onMounted(async () => {
  const doc_no = route.query.doc_no
  if (!doc_no) { error.value = 'ไม่พบเลขที่เอกสาร'; loading.value = false; return }
  try {
    receipt.value = await getReceiptDetail(doc_no)
    if (!receipt.value) { error.value = 'ไม่พบข้อมูลเอกสาร'; return }
    // auto-print after data loads
    setTimeout(() => window.print(), 300)
  } catch (ex) {
    error.value = ex.message || 'โหลดข้อมูลไม่สำเร็จ'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="receipt-page">
    <div v-if="loading" class="state-msg">กำลังโหลด...</div>
    <div v-else-if="error" class="state-msg error">{{ error }}</div>

    <div v-else-if="receipt" class="receipt">
      <!-- Company header -->
      <div class="company-header">
        <div class="company-name">{{ receipt.company.name }}</div>
        <div class="company-sub">{{ receipt.company.address }}</div>
        <div v-if="receipt.company.tel" class="company-sub">โทร. {{ receipt.company.tel }}</div>
      </div>

      <div class="receipt-title">ใบเสร็จรับเงิน<span v-if="isCopy"> (สำเนา)</span></div>

      <!-- Doc info -->
      <div class="doc-info">
        <div class="doc-row">
          <span class="doc-key">เลขที่</span>
          <span class="doc-val">{{ receipt.doc_no }}</span>
        </div>
        <div class="doc-row">
          <span class="doc-key">วันที่</span>
          <span class="doc-val">{{ formatDate(receipt.doc_date) }} {{ receipt.doc_time }}</span>
        </div>
        <div class="doc-row">
          <span class="doc-key">ลูกค้า</span>
          <span class="doc-val">{{ receipt.cust_name || 'ลูกค้าทั่วไป' }}</span>
        </div>
        <div v-if="receipt.sale_name" class="doc-row">
          <span class="doc-key">พนักงาน</span>
          <span class="doc-val">{{ receipt.sale_name }}</span>
        </div>
        <div class="doc-row">
          <span class="doc-key">ประเภท</span>
          <span class="doc-val">{{ inquiryLabel }}</span>
        </div>
      </div>

      <div class="divider-line" />

      <!-- Items table -->
      <table class="items-table">
        <thead>
          <tr>
            <th class="col-name">รายการ</th>
            <th class="col-qty">จำนวน</th>
            <th class="col-price">ราคา/หน่วย</th>
            <th class="col-total">รวม</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in receipt.items" :key="item.item_code + item.unit_code">
            <td class="col-name">
              <div class="item-name">{{ item.item_name }}</div>
              <div class="item-unit">{{ item.unit_code }}</div>
              <div v-if="item.discount" class="item-discount-sub">
                ลด {{ item.discount }} (-{{ formatCurrency(item.discount_amount) }})
              </div>
            </td>
            <td class="col-qty">{{ item.qty }}</td>
            <td class="col-price">{{ formatCurrency(item.price) }}</td>
            <td class="col-total">{{ formatCurrency(item.sum_amount) }}</td>
          </tr>
        </tbody>
      </table>

      <div class="divider-line" />

      <!-- Totals -->
      <div class="totals">
        <div v-if="Number(receipt.total_discount) > 0" class="total-row">
          <span>ส่วนลด<span v-if="receipt.discount_word"> ({{ receipt.discount_word }})</span></span>
          <span class="val-discount">-{{ formatCurrency(receipt.total_discount) }}</span>
        </div>
        <template v-if="vatLabel">
          <div class="total-row">
            <span>ยอดก่อนภาษี</span>
            <span>{{ formatCurrency(receipt.total_before_vat) }}</span>
          </div>
          <div class="total-row">
            <span>{{ vatLabel }}</span>
            <span>{{ formatCurrency(receipt.total_vat_value) }}</span>
          </div>
        </template>
        <div class="total-row total-net">
          <span>ยอดสุทธิ</span>
          <span>{{ formatCurrency(receipt.total_net_amount || receipt.total_amount) }}</span>
        </div>
      </div>

      <!-- Payment -->
      <div class="divider-line" />
      <div class="payment-section">
        <div class="payment-title">การชำระเงิน</div>
        <div v-if="Number(receipt.cash_amount) > 0" class="payment-row">
          <span>เงินสด</span>
          <span>{{ formatCurrency(receipt.cash_amount) }}</span>
        </div>
        <div v-if="Number(receipt.tranfer_amount) > 0" class="payment-row">
          <span>เงินโอน</span>
          <span>{{ formatCurrency(receipt.tranfer_amount) }}</span>
        </div>
        <div v-if="Number(receipt.card_amount) > 0" class="payment-row">
          <span>บัตรเครดิต</span>
          <span>{{ formatCurrency(receipt.card_amount) }}</span>
        </div>
        <div v-if="Number(receipt.total_credit_charge) > 0" class="payment-row">
          <span>ค่าธรรมเนียม</span>
          <span>{{ formatCurrency(receipt.total_credit_charge) }}</span>
        </div>
        <div v-if="Number(receipt.total_income_amount) > 0" class="payment-row">
          <span>ปัดเศษ</span>
          <span>{{ formatCurrency(receipt.total_income_amount) }}</span>
        </div>
        <div v-if="Number(receipt.money_change) > 0" class="payment-row">
          <span>เงินทอน</span>
          <span>{{ formatCurrency(receipt.money_change) }}</span>
        </div>
      </div>

      <div v-if="receipt.remark" class="remark-section">
        <span class="remark-label">หมายเหตุ: </span>{{ receipt.remark }}
      </div>

      <div class="receipt-footer">ขอบคุณที่ใช้บริการ</div>
    </div>
  </div>
</template>

<style>
/* Global reset for print page */
* { box-sizing: border-box; }
body { margin: 0; padding: 0; background: #fff; }
</style>

<style scoped>
.receipt-page {
  min-height: 100vh;
  background: #fff;
  display: flex;
  justify-content: center;
  padding: 1.5rem 1rem;
}

.state-msg {
  font-family: sans-serif;
  font-size: 1rem;
  color: #555;
  margin-top: 3rem;
}

.state-msg.error { color: #dc2626; }

.receipt {
  width: 100%;
  max-width: 360px;
  font-family: 'Courier New', Courier, monospace;
  font-size: 12px;
  color: #000;
}

.company-header {
  text-align: center;
  margin-bottom: 0.5rem;
}

.company-name {
  font-size: 14px;
  font-weight: bold;
}

.company-sub {
  font-size: 11px;
  color: #444;
}

.receipt-title {
  text-align: center;
  font-size: 13px;
  font-weight: bold;
  margin: 0.5rem 0;
  border-top: 1px dashed #000;
  border-bottom: 1px dashed #000;
  padding: 0.25rem 0;
}

.doc-info {
  margin: 0.5rem 0;
}

.doc-row {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  line-height: 1.6;
}

.doc-key {
  color: #555;
  flex-shrink: 0;
  width: 4.5rem;
}

.doc-val {
  text-align: right;
  flex: 1;
}

.divider-line {
  border-top: 1px dashed #000;
  margin: 0.5rem 0;
}

/* Items table */
.items-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

.items-table th {
  text-align: left;
  border-bottom: 1px solid #000;
  padding: 2px 2px;
  font-size: 10px;
}

.items-table td {
  padding: 3px 2px;
  vertical-align: top;
}

.col-name { width: 45%; }
.col-qty { text-align: center; width: 12%; }
.col-price { text-align: right; width: 22%; }
.col-total { text-align: right; width: 21%; }

.item-name { line-height: 1.3; white-space: pre-line; }
.item-unit { font-size: 10px; color: #555; }

/* Totals */
.totals {
  margin: 0.25rem 0;
}

.total-row {
  display: flex;
  justify-content: space-between;
  line-height: 1.8;
}

.val-discount { color: #c00; }
.item-discount-sub { font-size: 0.72rem; color: #0369a1; margin-top: 0.15rem; }

.total-net {
  font-weight: bold;
  font-size: 13px;
  border-top: 1px solid #000;
  padding-top: 0.25rem;
  margin-top: 0.1rem;
}

/* Payment */
.payment-section { margin: 0.25rem 0; }

.payment-title {
  font-size: 10px;
  color: #555;
  margin-bottom: 0.1rem;
}

.payment-row {
  display: flex;
  justify-content: space-between;
  line-height: 1.7;
  font-size: 11px;
}

/* Remark */
.remark-section {
  font-size: 11px;
  color: #444;
  margin-top: 0.5rem;
}

.remark-label { font-weight: bold; }

/* Footer */
.receipt-footer {
  text-align: center;
  font-size: 11px;
  margin-top: 1rem;
  padding-top: 0.5rem;
  border-top: 1px dashed #000;
  color: #555;
}

/* Print styles */
@media print {
  .receipt-page {
    padding: 0;
  }
  .receipt {
    max-width: 100%;
  }
}

@page {
  margin: 10px;
  size: auto;
}
</style>
