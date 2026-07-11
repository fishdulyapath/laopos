import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

const STORAGE_KEY = 'bizsuit.fontZones.v1'
const LEGACY_STORAGE_KEY = 'bizsuit.screenFontSize.v1'
const DEFAULT_FONT_SIZE = '16px'
const FONT_SIZE_PATTERN = /^(\d+(?:\.\d+)?)(px|rem|em)$/
const SCREEN_ZONE_KEY = 'screen'

const fontZoneSizes = ref(readStoredFontSizes())
const activeZoneKey = ref(SCREEN_ZONE_KEY)
const hoveredZoneKey = ref(SCREEN_ZONE_KEY)

function readStoredFontSizes() {
  if (typeof window === 'undefined') return {}

  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const normalized = normalizeStoredFontZones(parsed)
      if (Object.keys(normalized).length) return normalized
    }
  } catch {}

  try {
    const parsed = JSON.parse(window.localStorage.getItem(LEGACY_STORAGE_KEY) || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    return Object.entries(parsed).reduce((acc, [key, value]) => {
      if (typeof key === 'string' && isValidFontSize(value)) {
        acc[key] = { [SCREEN_ZONE_KEY]: normalizeFontSize(value) }
      }
      return acc
    }, {})
  } catch {
    return {}
  }
}

function normalizeStoredFontZones(value) {
  return Object.entries(value).reduce((acc, [screenKey, zones]) => {
    if (typeof screenKey !== 'string') return acc

    if (isValidFontSize(zones)) {
      acc[screenKey] = { [SCREEN_ZONE_KEY]: normalizeFontSize(zones) }
      return acc
    }

    if (!zones || typeof zones !== 'object' || Array.isArray(zones)) return acc
    const normalizedZones = Object.entries(zones).reduce((zoneAcc, [zoneKey, fontSize]) => {
      if (typeof zoneKey === 'string' && isValidFontSize(fontSize)) {
        zoneAcc[zoneKey] = normalizeFontSize(fontSize)
      }
      return zoneAcc
    }, {})
    if (Object.keys(normalizedZones).length) acc[screenKey] = normalizedZones
    return acc
  }, {})
}

function persistFontSizes(value) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
}

function getScreenKey(route) {
  return route.meta?.fontSizeKey || route.name || route.path || 'default'
}

function normalizeZoneKey(value) {
  const zoneKey = String(value || '').trim()
  return zoneKey || SCREEN_ZONE_KEY
}

export function isValidFontSize(value) {
  if (typeof value !== 'string') return false

  const match = value.trim().match(FONT_SIZE_PATTERN)
  if (!match) return false

  const amount = Number(match[1])
  return Number.isFinite(amount) && amount > 0
}

export function normalizeFontSize(value) {
  const trimmed = String(value || '').trim().toLowerCase()
  return isValidFontSize(trimmed) ? trimmed : ''
}

function applyRootFontSize(value) {
  if (typeof document === 'undefined') return

  const fontSize = normalizeFontSize(value)
  const root = document.documentElement

  if (fontSize) {
    root.style.fontSize = fontSize
    root.style.setProperty('--biz-screen-font-size', fontSize)
    root.dataset.screenFontSize = fontSize
    return
  }

  root.style.removeProperty('font-size')
  root.style.setProperty('--biz-screen-font-size', DEFAULT_FONT_SIZE)
  delete root.dataset.screenFontSize
}

function clearZoneElementFontSize(element, { keepFontSize = false } = {}) {
  if (!keepFontSize) element.style.removeProperty('font-size')
  element.style.removeProperty('--biz-zone-font-size')
  delete element.dataset.fontZoneSize
}

function applyZoneElementFontSize(element, fontSize, { setFontSize = true } = {}) {
  if (setFontSize) element.style.fontSize = fontSize
  else element.style.removeProperty('font-size')
  element.style.setProperty('--biz-zone-font-size', fontSize)
  element.dataset.fontZoneSize = fontSize
}

function applyFontSizesForScreen(screenKey) {
  if (typeof document === 'undefined') return

  const zones = fontZoneSizes.value[String(screenKey)] || {}
  applyRootFontSize(zones[SCREEN_ZONE_KEY] || '')

  document.querySelectorAll('[data-font-zone]').forEach((element) => {
    const zoneKey = normalizeZoneKey(element.dataset.fontZone)
    const fontSize = normalizeFontSize(zones[zoneKey])
    const isScreenZone = zoneKey === SCREEN_ZONE_KEY
    if (fontSize) applyZoneElementFontSize(element, fontSize, { setFontSize: !isScreenZone })
    else clearZoneElementFontSize(element)
  })
}

export function useScreenFontSize() {
  const route = useRoute()
  const screenKey = computed(() => String(getScreenKey(route)))
  const screenZoneSizes = computed(() => fontZoneSizes.value[screenKey.value] || {})
  const currentFontSize = computed(() => screenZoneSizes.value[SCREEN_ZONE_KEY] || '')
  const currentZoneFontSize = computed(() => screenZoneSizes.value[activeZoneKey.value] || '')
  const effectiveFontSize = computed(
    () =>
      currentZoneFontSize.value ||
      currentFontSize.value ||
      DEFAULT_FONT_SIZE
  )
  const hasCurrentZoneFontSize = computed(() => Boolean(currentZoneFontSize.value))

  function setActiveZone(zoneKey) {
    activeZoneKey.value = normalizeZoneKey(zoneKey)
  }

  function setHoveredZone(zoneKey) {
    hoveredZoneKey.value = normalizeZoneKey(zoneKey)
  }

  function setFontSize(value, zoneKey = activeZoneKey.value) {
    const fontSize = normalizeFontSize(value)
    if (!fontSize) return false

    const normalizedZoneKey = normalizeZoneKey(zoneKey)
    const currentScreenZones = fontZoneSizes.value[screenKey.value] || {}
    if (currentScreenZones[normalizedZoneKey] === fontSize) {
      applyFontSizesForScreen(screenKey.value)
      return true
    }

    fontZoneSizes.value = {
      ...fontZoneSizes.value,
      [screenKey.value]: {
        ...currentScreenZones,
        [normalizedZoneKey]: fontSize,
      },
    }
    persistFontSizes(fontZoneSizes.value)
    applyFontSizesForScreen(screenKey.value)
    return true
  }

  function resetCurrentZone(zoneKey = activeZoneKey.value) {
    const normalizedZoneKey = normalizeZoneKey(zoneKey)
    const currentScreenZones = { ...(fontZoneSizes.value[screenKey.value] || {}) }
    delete currentScreenZones[normalizedZoneKey]

    const next = { ...fontZoneSizes.value }
    if (Object.keys(currentScreenZones).length) next[screenKey.value] = currentScreenZones
    else delete next[screenKey.value]

    fontZoneSizes.value = next
    persistFontSizes(next)
    applyFontSizesForScreen(screenKey.value)
  }

  function resetCurrentScreen() {
    const next = { ...fontZoneSizes.value }
    delete next[screenKey.value]
    fontZoneSizes.value = next
    persistFontSizes(next)
    applyFontSizesForScreen(screenKey.value)
  }

  watch(screenZoneSizes, () => applyFontSizesForScreen(screenKey.value), { immediate: true, deep: true })
  watch(screenKey, (value) => applyFontSizesForScreen(value), { immediate: true })

  return {
    activeZoneKey,
    applyCurrentScreenFontSizes: () => applyFontSizesForScreen(screenKey.value),
    currentFontSize,
    currentZoneFontSize,
    defaultFontSize: DEFAULT_FONT_SIZE,
    effectiveFontSize,
    fontZoneSizes,
    hasCurrentZoneFontSize,
    hoveredZoneKey,
    isValidFontSize,
    resetCurrentZone,
    resetCurrentScreen,
    screenKey,
    screenZoneKey: SCREEN_ZONE_KEY,
    screenZoneSizes,
    setActiveZone,
    setFontSize,
    setHoveredZone,
  }
}
