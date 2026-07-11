import { APP_STORAGE_PREFIX } from '@/config/app'

const DEVICES_KEY = `${APP_STORAGE_PREFIX}_pos_devices`
const CURRENT_DEVICE_KEY = `${APP_STORAGE_PREFIX}_pos_device_current`
export const DEFAULT_CUSTOMER_DISPLAY_CURRENCY_CODE = 'KIP'

export const DEFAULT_DEVICE_CONFIG = {
  configured_pos_id: '',
  printer_mode: 'html',        // 'escpos' | 'html' | 'none'
  printer_name: '',            // Windows printer name (all modes)
  autoprint: false,
  default_sale_doc_format_code: '',
  allowed_sale_wh_codes: '',
  cash_drawer_mode: 'printer', // 'printer' | 'serial' | 'usbcr' | 'friusb'
  cash_drawer_printer_name: '',
  cash_drawer_port: '',
  cash_drawer_baud_rate: 9600,
  cash_drawer_drawer_id: 1,
  cash_drawer_open_bytes_hex: '1B700019FA',
  customer_display_auto_open: true,
  customer_display_currency_code: DEFAULT_CUSTOMER_DISPLAY_CURRENCY_CODE,
  customer_display_ads: '',
  customer_display_summary_layout: 'split',
}

export function normalizeAllowedSaleWarehouseCodes(value) {
  return Array.from(new Set(
    String(value || '')
      .split(',')
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean)
  ))
}

export function loadPosDeviceConfig(posId) {
  try {
    const current = JSON.parse(localStorage.getItem(CURRENT_DEVICE_KEY) || 'null')
    if (current && typeof current === 'object') {
      return { ...DEFAULT_DEVICE_CONFIG, ...current, configured_pos_id: String(current.configured_pos_id || posId || '').trim() }
    }

    const all = JSON.parse(localStorage.getItem(DEVICES_KEY) || '{}')
    const migrated = { ...DEFAULT_DEVICE_CONFIG, ...(all[posId] || {}) }
    if (posId && all[posId]) {
      migrated.configured_pos_id = migrated.configured_pos_id || posId
      localStorage.setItem(CURRENT_DEVICE_KEY, JSON.stringify(migrated))
    }
    return migrated
  } catch {
    return { ...DEFAULT_DEVICE_CONFIG }
  }
}

export function savePosDeviceConfig(posId, config) {
  try {
    const next = {
      ...DEFAULT_DEVICE_CONFIG,
      ...config,
      configured_pos_id: String(config?.configured_pos_id || posId || '').trim(),
      allowed_sale_wh_codes: normalizeAllowedSaleWarehouseCodes(config?.allowed_sale_wh_codes).join(','),
    }
    localStorage.setItem(CURRENT_DEVICE_KEY, JSON.stringify(next))
    const all = JSON.parse(localStorage.getItem(DEVICES_KEY) || '{}')
    if (posId) all[posId] = next
    localStorage.setItem(DEVICES_KEY, JSON.stringify(all))
  } catch (e) {
    console.error('[savePosDeviceConfig]', e)
  }
}
