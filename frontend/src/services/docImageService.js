import api from './api'
import { docImageUrl } from '@/utils/imageUrls'

export function getDocImageUrl(guid_code) {
  return docImageUrl(guid_code)
}

export async function getDocImagesList(doc_no) {
  const { data } = await api.get('/getDocImagesList', { params: { doc_no } })
  return data.data || []
}

export async function saveDocImage(doc_no, image_file) {
  const { data } = await api.post('/saveDocImage', { doc_no, image_file })
  return data
}

export async function deleteDocImage(guid_code) {
  const { data } = await api.get('/deleteDocImage', { params: { guid_code } })
  return data
}
