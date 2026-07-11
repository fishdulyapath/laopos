import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getPOSList, getErpOption } from '@/services/posService'
import { savePos, loadPos, saveErpOption, loadErpOption, clearPosSession } from '@/utils/session'
import { loadPosDeviceConfig, savePosDeviceConfig, DEFAULT_DEVICE_CONFIG } from '@/utils/posDeviceSettings'

export const usePosStore = defineStore('pos', () => {
  const selectedPos = ref(null)
  const erpOption = ref(null)
  const posList = ref([])
  const deviceConfig = ref({ ...DEFAULT_DEVICE_CONFIG })

  const hasPos = computed(() => selectedPos.value !== null)
  const posId = computed(() => selectedPos.value?.pos_id ?? '')

  function restorePos() {
    const pos = loadPos()
    if (pos) {
      selectedPos.value = pos
    }
    deviceConfig.value = loadPosDeviceConfig(pos?.pos_id)
    const erp = loadErpOption()
    if (erp) erpOption.value = erp
  }

  async function loadPosList() {
    posList.value = await getPOSList()
  }

  async function ensureSelectedPosValid() {
    if (!selectedPos.value?.pos_id) return false
    if (!posList.value.length) await loadPosList()
    const configuredPosId = String(deviceConfig.value?.configured_pos_id || '').trim()
    if (configuredPosId && String(selectedPos.value.pos_id || '').trim() !== configuredPosId) {
      const configuredPos = posList.value.find((pos) => String(pos.pos_id || '').trim() === configuredPosId)
      if (!configuredPos) {
        clearPos()
        return false
      }
      selectedPos.value = configuredPos
      savePos(configuredPos)
      if (!erpOption.value) await refreshErpOption()
      return true
    }
    const freshPos = posList.value.find((pos) => pos.pos_id === selectedPos.value.pos_id)
    if (!freshPos) {
      clearPos()
      return false
    }
    selectedPos.value = freshPos
    savePos(freshPos)
    if (!erpOption.value) await refreshErpOption()
    return true
  }

  function selectPos(posData) {
    selectedPos.value = posData
    savePos(posData)
    deviceConfig.value = loadPosDeviceConfig(posData.pos_id)
  }

  function saveDeviceConfig(config) {
    const posId = String(config?.configured_pos_id || selectedPos.value?.pos_id || '').trim()
    savePosDeviceConfig(posId, config)
    deviceConfig.value = { ...DEFAULT_DEVICE_CONFIG, ...config, configured_pos_id: posId }
  }

  async function refreshErpOption() {
    const erp = await getErpOption()
    erpOption.value = erp
    saveErpOption(erp)
  }

  function clearPos() {
    selectedPos.value = null
    erpOption.value = null
    posList.value = []
    deviceConfig.value = loadPosDeviceConfig()
    clearPosSession()
  }

  return { selectedPos, erpOption, posList, hasPos, posId, deviceConfig, restorePos, loadPosList, ensureSelectedPosValid, selectPos, saveDeviceConfig, refreshErpOption, clearPos }
})
