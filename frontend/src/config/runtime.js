import { APP_STORAGE_PREFIX } from '@/config/app'

const API_BASE_URL_KEY = `${APP_STORAGE_PREFIX}_api_base_url`

export function normalizeApiBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

export function defaultApiBaseUrl() {
  return normalizeApiBaseUrl(globalThis.window?.bizsuitDesktop?.apiBaseUrl || import.meta.env.VITE_API_BASE_URL || '')
}

export function loadSavedApiBaseUrl() {
  try {
    return normalizeApiBaseUrl(globalThis.localStorage?.getItem(API_BASE_URL_KEY))
  } catch {
    return ''
  }
}

export function saveApiBaseUrl(value) {
  const apiBaseUrl = normalizeApiBaseUrl(value)
  try {
    if (apiBaseUrl) {
      globalThis.localStorage?.setItem(API_BASE_URL_KEY, apiBaseUrl)
    } else {
      globalThis.localStorage?.removeItem(API_BASE_URL_KEY)
    }
  } catch {
    // localStorage may be unavailable in constrained WebViews.
  }
  return apiBaseUrl
}

export function runtimeApiBaseUrl() {
  return loadSavedApiBaseUrl() || defaultApiBaseUrl()
}
