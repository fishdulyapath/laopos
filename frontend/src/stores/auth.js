import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { loginEmp } from '@/services/authService'
import { saveSession, loadSession, isSessionValid, clearSession } from '@/utils/session'
import { can, canAll } from '@/utils/permissions'

export const useAuthStore = defineStore('auth', () => {
  const employee = ref(null)
  const loginTime = ref(null)
  const rememberMe = ref(false)
  const isAuthenticated = ref(false)

  const sessionValid = computed(() =>
    isSessionValid({ employee: employee.value, loginTime: loginTime.value, rememberMe: rememberMe.value })
  )

  const permissions = computed(() => employee.value?.permissions)

  function restoreSession() {
    const session = loadSession()
    if (session && isSessionValid(session)) {
      employee.value = session.employee
      loginTime.value = session.loginTime
      rememberMe.value = session.rememberMe
      isAuthenticated.value = true
    } else if (session) {
      clearSession()
    }
  }

  async function login(user_code, password, remember) {
    const emp = await loginEmp(user_code, password)
    employee.value = emp
    loginTime.value = Date.now()
    rememberMe.value = remember
    isAuthenticated.value = true
    saveSession(emp, loginTime.value, remember)
  }

  function logout() {
    employee.value = null
    loginTime.value = null
    rememberMe.value = false
    isAuthenticated.value = false
    clearSession()
  }

  function checkAndExpire() {
    if (isAuthenticated.value && !sessionValid.value) {
      logout()
      return false
    }
    return isAuthenticated.value
  }

  function hasPermission(key) {
    if (String(employee.value?.user_code || '').trim().toUpperCase() === 'SUPERADMIN') return true
    return can(permissions.value, key)
  }

  function hasAllPermissions(keys) {
    if (String(employee.value?.user_code || '').trim().toUpperCase() === 'SUPERADMIN') return true
    return canAll(permissions.value, keys)
  }

  function hasAnyPermission(keys) {
    if (String(employee.value?.user_code || '').trim().toUpperCase() === 'SUPERADMIN') return true
    return (Array.isArray(keys) ? keys : [keys]).some((key) => can(permissions.value, key))
  }

  return { employee, loginTime, rememberMe, isAuthenticated, sessionValid, permissions, restoreSession, login, logout, checkAndExpire, hasPermission, hasAllPermissions, hasAnyPermission }
})
