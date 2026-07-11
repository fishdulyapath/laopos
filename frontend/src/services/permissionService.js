import api from './api'

export async function getPermissionList() {
  const { data } = await api.get('/getPermissionList')
  return data.data || []
}

export async function getEmployeePermissions(user_code) {
  const { data } = await api.get('/getEmployeePermissions', { params: { user_code } })
  return data.data || []
}

export async function setEmployeePermissions(user_code, permissions) {
  const { data } = await api.post('/setEmployeePermissions', { user_code, permissions })
  return data
}
