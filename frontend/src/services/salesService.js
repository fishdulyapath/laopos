import api from './api'
import { runtimeApiBaseUrl } from '@/config/runtime'

export async function getDashboardTopProducts(date = '') {
  const { data } = await api.get('/getDashboardTopProducts', { params: date ? { date } : {} })
  return data.data || []
}

export async function getDashboardTopCustomers() {
  const { data } = await api.get('/getDashboardTopCustomers')
  return data.data || []
}

export async function getDashboardTopSalesmen() {
  const { data } = await api.get('/getDashboardTopSalesmen')
  return data.data || []
}

export async function getDashboardSoldOut(date = '') {
  const { data } = await api.get('/getDashboardSoldOut', { params: date ? { date } : {} })
  return data.data || []
}

export async function getDocSaleHistory({ doc_no = '', search = '', from_date = '', to_date = '', sale_kind = '', branch_code = '', pos_id = '' } = {}) {
  const { data } = await api.get('/getDocSaleHistory', {
    params: { doc_no, search, from_date, to_date, sale_kind, branch_code, pos_id },
  })
  return data.data || []
}

export async function getDocSaleHistoryDetail(doc_no) {
  const { data } = await api.get('/getDocSaleHistoryDetail', { params: { doc_no } })
  return data.data || null
}

export async function getSaleItemHistory({ cust_code = '', item_code = '', limit = 200 } = {}) {
  const { data } = await api.get('/getSaleItemHistory', {
    params: { cust_code, item_code, limit },
  })
  return data.data || []
}

export async function getSalePriceFormulaInfo({ cust_code = '', item_code = '', currency_code = '' } = {}) {
  const { data } = await api.get('/getSalePriceFormulaInfo', {
    params: { cust_code, item_code, currency_code },
  })
  return data.data || { rows: [] }
}

export async function getSalePrintForms(doc_no) {
  const { data } = await api.get('/getSalePrintForms', { params: { doc_no } })
  return data.data || null
}

export function getSalePrintUrl(doc_no, formcodes = [], user_code = '') {
  const baseUrl = runtimeApiBaseUrl()
  const params = new URLSearchParams({
    doc_no,
    formcodes: formcodes.join(','),
    auto_print: '1',
    log_print: '1',
  })
  if (user_code) params.set('user_code', user_code)
  return `${baseUrl}/sale-print/render?${params.toString()}`
}

export function getSalePosSlipPrintUrl(doc_no, user_code = '', options = {}) {
  const baseUrl = runtimeApiBaseUrl()
  const hasDisplayCurrency = Boolean(options.display_net_lak_text || options.display_paid_lak_text || options.display_change_lak_text)
  const params = new URLSearchParams({
    doc_no,
    auto_print: '1',
    log_print: '1',
    multi_currency: hasDisplayCurrency ? '1' : '0',
  })
  if (user_code) params.set('user_code', user_code)
  if (options.copy) params.set('copy', '1')
  if (options.display_net_lak_text) params.set('display_net_lak_text', options.display_net_lak_text)
  if (options.display_paid_lak_text) params.set('display_paid_lak_text', options.display_paid_lak_text)
  if (options.display_change_lak_text) params.set('display_change_lak_text', options.display_change_lak_text)
  return `${baseUrl}/sale-print/pos-slip?${params.toString()}`
}

export async function fetchThermalReceiptHex(doc_no) {
  const { data } = await api.get('/sale-print/thermal', { params: { doc_no } })
  return data.hex || ''
}
