import api from './api'

export async function getBasketList() {
  const { data } = await api.get('/getBasketList')
  return data.data || []
}

export async function setBasketInfo(payload) {
  const { data } = await api.post('/setBasketInfo', payload)
  return data
}

export async function getSaleDocFormatList() {
  const { data } = await api.get('/getSaleDocFormatList')
  return data.data || []
}

export async function clearBasket(basket_id) {
  const { data } = await api.post('/clearBasket', { basket_id })
  return data
}

export async function getItemReservedQty(item_code) {
  const { data } = await api.get('/getItemReservedQty', { params: { item_code } })
  return Number(data.data?.reserved_base_units ?? 0)
}
