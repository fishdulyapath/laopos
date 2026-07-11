import { createI18n } from 'vue-i18n'
import th from './locales/th.json'
import lo from './locales/lo.json'
import en from './locales/en.json'

export const localeStorageKey = 'bizsuit.locale'
export const defaultLocale = 'lo'

export const languageOptions = [
  { labelKey: 'language.lao', label: 'Lao', nativeLabel: '\u0EA5\u0EB2\u0EA7', value: 'lo', flagClass: 'flag-lo' },
  { labelKey: 'language.thai', label: 'Thai', nativeLabel: '\u0E44\u0E17\u0E22', value: 'th', flagClass: 'flag-th' },
  { labelKey: 'language.english', label: 'English', nativeLabel: 'English', value: 'en', flagClass: 'flag-gb' },
]

export const supportedLocales = languageOptions.map((item) => item.value)

function normalizeLocale(locale) {
  return supportedLocales.includes(locale) ? locale : defaultLocale
}

function readInitialLocale() {
  if (typeof window === 'undefined') return defaultLocale
  return normalizeLocale(window.localStorage.getItem(localeStorageKey) || defaultLocale)
}

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: readInitialLocale(),
  fallbackLocale: 'th',
  messages: { th, lo, en },
})

export function setLocale(locale) {
  const nextLocale = normalizeLocale(locale)
  i18n.global.locale.value = nextLocale
  if (typeof window !== 'undefined') window.localStorage.setItem(localeStorageKey, nextLocale)
  if (typeof document !== 'undefined') {
    document.documentElement.lang = nextLocale
    document.documentElement.dataset.appLocale = nextLocale
  }
  return nextLocale
}

setLocale(i18n.global.locale.value)
