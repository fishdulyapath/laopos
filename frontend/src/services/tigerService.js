import axios from 'axios'
import { runtimeApiBaseUrl } from '@/config/runtime'

function envFlag(value) {
  return ['true', '1', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

export const TIGER_MOCK = envFlag(import.meta.env.VITE_TIGER_MOCK)
export const TIGER_PENDING_MOCK = TIGER_MOCK || envFlag(import.meta.env.VITE_TIGER_PENDING_MOCK)
const ORDER_STATUSES = new Set(['new', 'processing', 'success', 'cancel', 'cancelled', 'failed'])

const tiger = axios.create({
  baseURL: `${runtimeApiBaseUrl()}/tiger`,
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': '1',
  },
})

tiger.interceptors.request.use((config) => {
  config.baseURL = `${runtimeApiBaseUrl()}/tiger`
  return config
})

// ตรวจว่าระบบ Tiger เปิดใช้งานหรือไม่ (ดูจาก erp_option)
// ถ้า mock mode → enabled เสมอ
export async function getTigerConfig() {
  if (TIGER_MOCK) return { enabled: true }
  try {
    const res = await tiger.get('/config')
    return res.data?.data ?? { enabled: false }
  } catch {
    return { enabled: false }
  }
}

// ─── Mock state ─────────────────────────────────────────────────────────────
// จำลองพฤติกรรม Tiger: new → processing (หลัง 2s) → success (หลัง 5s)
// ถ้า cancel ระหว่างทาง → status=cancel
const mockOrders = new Map()

function mockNow() { return Date.now() }

function mockComputeStatus(o) {
  if (o.cancelled) return 'cancel'
  const elapsed = mockNow() - o.startedAt
  if (elapsed < 2000) return 'new'
  if (elapsed < 5000) return 'processing'
  return 'success'
}

function firstObject(value) {
  if (Array.isArray(value)) return firstObject(value[0])
  return value && typeof value === 'object' ? value : null
}

function uniqueObjects(items) {
  const seen = new Set()
  return items
    .map(firstObject)
    .filter(Boolean)
    .filter((item) => {
      if (seen.has(item)) return false
      seen.add(item)
      return true
    })
}

function normalizeTigerOrderResponse(raw) {
  const candidates = uniqueObjects([
    raw?.data?.order,
    raw?.data?.orders,
    raw?.data,
    raw?.order,
    raw?.orders,
    raw,
  ])
  const payload = candidates.find((item) => item.id != null || item.status != null) || {}
  const status = candidates
    .map((item) => String(item.status || '').toLowerCase())
    .find((value) => ORDER_STATUSES.has(value)) || ''
  const id = candidates
    .flatMap((item) => [item.id, item.orderId, item.orderID, item.order_id])
    .map((value) => String(value ?? '').trim())
    .find((value) => /^[1-9]\d*$/.test(value))
  return { ...payload, id: id || payload.id, status: status || String(payload.status || '').toLowerCase() }
}

export async function createTigerOrder({ orderId, custName, posId, amount, ref1, ref2 }) {
  if (TIGER_MOCK) {
    const id = `MOCK-${Date.now()}`
    mockOrders.set(id, { startedAt: mockNow(), cancelled: false, amount })
    return { id, status: 'new', amount, mock: true }
  }
  const res = await tiger.post('/orders', {
    order_id: orderId,
    customer_name: custName || 'ลูกค้าทั่วไป',
    title: `${posId} - ${custName || 'ลูกค้าทั่วไป'}`,
    amount,
    total: amount,
    status: 'new',
    ref1,
    ref2,
    pos_created_date: new Date().toISOString(),
  })
  const data = normalizeTigerOrderResponse(res.data)
  if (!data.id || !/^[1-9]\d*$/.test(String(data.id))) {
    throw new Error('Tiger ไม่ส่ง Transaction ID สำหรับตรวจสถานะ')
  }
  return data
}

export async function inquireTigerOrder(id) {
  if (TIGER_MOCK) {
    const o = mockOrders.get(String(id))
    if (!o) return { id, status: 'failed' }
    return { id, status: mockComputeStatus(o), amount: o.amount, mock: true }
  }
  const res = await tiger.get(`/orders/${id}`)
  return normalizeTigerOrderResponse(res.data)
}

export async function cancelTigerOrder(id) {
  if (TIGER_MOCK) {
    const o = mockOrders.get(String(id))
    if (o) o.cancelled = true
    return { id, status: 'cancel', mock: true }
  }
  const res = await tiger.put(`/orders/${id}`, { status: 'cancel' })
  return normalizeTigerOrderResponse(res.data)
}

export async function getTigerPendingPayments() {
  const res = await tiger.get('/pending')
  return res.data.data || []
}

export async function checkNextTigerPendingPayment() {
  const res = await tiger.post('/pending/check-next')
  return res.data
}

export async function mockTigerPendingPaid({ doc_no, tiger_order_id } = {}) {
  if (!TIGER_PENDING_MOCK) throw new Error('Tiger mock is disabled')
  const res = await tiger.post('/pending/mock-paid', { doc_no, tiger_order_id })
  return res.data
}
