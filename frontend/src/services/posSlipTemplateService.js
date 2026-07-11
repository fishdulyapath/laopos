import api from './api'

export async function getPosSlipTemplate(formCode = 'CR-0088') {
  const { data } = await api.get(`/pos-slip-template/${encodeURIComponent(formCode)}`)
  return data.data
}

export async function getPosSlipTemplatePreview(formCode = 'CR-0088', docNo = '') {
  const params = { form_code: formCode }
  if (docNo) params.doc_no = docNo
  const { data } = await api.get('/sale-print/slip-template-preview', { params })
  return data.data
}

export async function savePosSlipTemplate(formCode = 'CR-0088', layout, updatedBy = '') {
  const { data } = await api.post(`/pos-slip-template/${encodeURIComponent(formCode)}`, {
    layout,
    updated_by: updatedBy,
  })
  return data.data
}

export async function uploadPosSlipImage({ formCode = 'CR-0088', fileName, mimeType, dataUrl }) {
  const { data } = await api.post(`/pos-slip-template/${encodeURIComponent(formCode)}/upload`, {
    file_name: fileName,
    mime_type: mimeType,
    data_url: dataUrl,
  })
  return data.data
}
