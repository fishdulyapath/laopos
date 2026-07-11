import api from './api'

export async function getLaoQrPaymentHistory(params = {}) {
  const { data } = await api.get('/lao-qr/history', { params })
  return data.data || []
}

export async function checkLaoQrPaymentHistory(id) {
  const { data } = await api.post(`/lao-qr/history/${id}/check`)
  return data.data || {}
}

export async function deleteLaoQrPaymentHistory(id) {
  const { data } = await api.delete(`/lao-qr/history/${id}`)
  return data.data || {}
}
