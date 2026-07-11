import api from './api'

export async function loginEmp(user_code, password) {
  const { data } = await api.post('/loginemp', { user_code, password })
  if (!data.success || !data.data || data.data.length === 0) {
    throw new Error('รหัสผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
  }
  return data.data[0]
}
