import api from './api'

export async function getPOSList() {
  const { data } = await api.get('/getPOSList')
  return data.data || []
}

export async function getErpOption() {
  const { data } = await api.get('/getErpOption')
  return data.data || {}
}
