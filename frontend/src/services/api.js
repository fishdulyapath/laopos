import axios from 'axios'
import { runtimeApiBaseUrl } from '@/config/runtime'

const api = axios.create({
  baseURL: runtimeApiBaseUrl(),
  timeout: 60000,
  headers: {
    'ngrok-skip-browser-warning': '1',
  },
})

api.interceptors.request.use((config) => {
  config.baseURL = runtimeApiBaseUrl()
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.code === 'ECONNABORTED') {
      return Promise.reject(new Error('เชื่อมต่อช้าเกินไป กรุณาลองใหม่อีกครั้ง'))
    }
    const msg = error.response?.data?.msg || error.response?.data?.ERROR || error.message || 'เกิดข้อผิดพลาด'
    const wrapped = new Error(msg)
    wrapped.status = error.response?.status
    wrapped.data = error.response?.data
    wrapped.response = error.response
    return Promise.reject(wrapped)
  }
)

export default api
