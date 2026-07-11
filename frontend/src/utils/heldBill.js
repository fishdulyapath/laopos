import { APP_STORAGE_PREFIX } from '@/config/app'

const STORAGE_KEY = `${APP_STORAGE_PREFIX}_sell_held_bills_v1`
const SCHEMA_VERSION = 1
const MAX_HELD_BILLS = 30

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

function safeReadEntries(storage) {
  if (!storage) return []
  try {
    const raw = storage.getItem(STORAGE_KEY)
    const parsed = safeJsonParse(raw, [])
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function safeWriteEntries(storage, entries) {
  if (!storage) return false
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(Array.isArray(entries) ? entries : []))
    return true
  } catch {
    return false
  }
}

function safeRemoveEntries(storage) {
  if (!storage) return
  try {
    storage.removeItem(STORAGE_KEY)
  } catch {}
}

function heldBillTime(entry = {}) {
  return Date.parse(entry.updated_at || entry.created_at || '') || 0
}

function normalizeHeldBills(entries) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => Number(entry?.schema_version) === SCHEMA_VERSION)
    .filter((entry) => String(entry?.id || '').trim())
}

function mergeHeldBills(...groups) {
  const byId = new Map()
  for (const entries of groups) {
    for (const entry of normalizeHeldBills(entries)) {
      const id = String(entry.id).trim()
      const current = byId.get(id)
      if (!current || heldBillTime(entry) >= heldBillTime(current)) byId.set(id, entry)
    }
  }
  return [...byId.values()]
    .sort((a, b) => heldBillTime(b) - heldBillTime(a))
    .slice(0, MAX_HELD_BILLS)
}

function readHeldBills() {
  if (typeof window === 'undefined') return []
  const localEntries = safeReadEntries(window.localStorage)
  const legacySessionEntries = safeReadEntries(window.sessionStorage)
  if (!legacySessionEntries.length) return normalizeHeldBills(localEntries)

  const merged = mergeHeldBills(localEntries, legacySessionEntries)
  if (safeWriteEntries(window.localStorage, merged)) {
    safeRemoveEntries(window.sessionStorage)
  }
  return merged
}

function writeHeldBills(entries) {
  if (typeof window === 'undefined') return
  const next = normalizeHeldBills(entries).slice(0, MAX_HELD_BILLS)
  if (safeWriteEntries(window.localStorage, next)) {
    safeRemoveEntries(window.sessionStorage)
  }
}

function makeHeldBillId() {
  return `HB-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
}

function summarizePayload(payload = {}) {
  const body = payload?.body || {}
  const items = Array.isArray(body.items) ? body.items : []
  return {
    doc_date: String(body.doc_date || '').trim(),
    cust_code: String(body.cust_code || '').trim(),
    cust_name: String(body.cust_name || '').trim(),
    sale_code: String(body.sale_code || body.emp_code || '').trim(),
    sale_name: String(body.sale_name || body.emp_name || '').trim(),
    item_count: items.length,
    total_amount: Number(body.total_amount) || 0,
  }
}

export function listHeldBills() {
  return readHeldBills().map((entry) => ({
    ...entry,
    summary: summarizePayload(entry.payload),
    has_payload: !!entry?.payload,
  }))
}

export function loadHeldBill(id) {
  const target = String(id || '').trim()
  if (!target) return null
  const entry = readHeldBills().find((row) => String(row?.id || '').trim() === target)
  if (!entry) return null
  if (Number(entry.schema_version) !== SCHEMA_VERSION) return null
  return entry
}

export function saveHeldBill(payload, meta = {}) {
  const now = new Date().toISOString()
  const title = String(meta.title || '').trim()
  const next = {
    id: makeHeldBillId(),
    schema_version: SCHEMA_VERSION,
    created_at: now,
    updated_at: now,
    title,
    payload,
  }
  const current = readHeldBills().filter((entry) => Number(entry?.schema_version) === SCHEMA_VERSION)
  writeHeldBills([next, ...current].slice(0, MAX_HELD_BILLS))
  return next
}

export function deleteHeldBill(id) {
  const target = String(id || '').trim()
  if (!target) return
  const next = readHeldBills().filter((entry) => String(entry?.id || '').trim() !== target)
  writeHeldBills(next)
}

export function clearHeldBills() {
  writeHeldBills([])
}
