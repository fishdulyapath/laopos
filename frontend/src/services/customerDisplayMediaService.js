import api from './api'

export async function getCustomerDisplayMedia({ enabled = '', zone = '' } = {}) {
  const params = {}
  if (enabled !== '' && enabled !== undefined && enabled !== null) params.enabled = enabled ? '1' : '0'
  if (zone !== '' && zone !== undefined && zone !== null) params.zone = zone
  const { data } = await api.get('/customer-display-media', { params })
  return data.data || []
}

export async function uploadCustomerDisplayMedia({ fileName, mimeType, dataUrl, title = '', duration = 10, soundEnabled = false, displayZone = 'right', createdBy = '' }) {
  const { data } = await api.post('/customer-display-media/upload', {
    file_name: fileName,
    mime_type: mimeType,
    data_url: dataUrl,
    title,
    duration_seconds: duration,
    sound_enabled: soundEnabled,
    display_zone: displayZone,
    created_by: createdBy,
  })
  return data.data
}

export async function updateCustomerDisplayMedia(id, payload) {
  const { data } = await api.put(`/customer-display-media/${id}`, payload)
  return data.data
}

export async function deleteCustomerDisplayMedia(id) {
  const { data } = await api.delete(`/customer-display-media/${id}`)
  return data
}

export async function reorderCustomerDisplayMedia(orders) {
  const { data } = await api.post('/customer-display-media/reorder', { orders })
  return data.data || []
}
