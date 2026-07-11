import api from './api'

export async function adjustStock(payload) {
  const { data } = await api.post('/adjustStock', payload)
  return data
}

export async function adjustStockFromSale(payload) {
  const { data } = await api.post('/adjustStockFromSale', payload)
  return data.data || data
}

export async function getWarehouseList(params = {}) {
  const { data } = await api.get('/getWarehouseList', { params })
  return data.data || []
}

export async function getShelfList(wh_code) {
  const { data } = await api.get('/getShelfList', { params: { wh_code } })
  return data.data || []
}

export async function getInventoryBalance(item_code, wh_code, shelf_code) {
  const { data } = await api.get('/getInventoryBalance', { params: { item_code, wh_code, shelf_code } })
  return Number(data.data?.sum_balance_qty ?? 0)
}

export async function getInventoryBalanceBatch({ item_codes = [], wh_code = '' } = {}) {
  const { data } = await api.post('/getInventoryBalanceBatch', { item_codes, wh_code })
  return data.data || []
}

export async function getProductWarehouseBalances({ item_code = '', unit_code = '', ratio = 1, selected_branch_code = '', branch_code = '', first = 0, rows = 50 } = {}) {
  const { data } = await api.post('/getProductWarehouseBalances', { item_code, unit_code, ratio, selected_branch_code, branch_code, first, rows })
  return data.data || { rows: [], totalRecords: 0 }
}

export async function getProductWarehouseBalanceBranches({ selected_branch_code = '', item_code = '', ratio = 1 } = {}) {
  const { data } = await api.post('/getProductWarehouseBalanceBranches', { selected_branch_code, item_code, ratio })
  return data.data || []
}
