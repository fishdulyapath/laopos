<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { usePosStore } from '@/stores/pos'
import { useAuthStore } from '@/stores/auth'
import Card from 'primevue/card'
import InputText from 'primevue/inputtext'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import Button from 'primevue/button'
import ProgressSpinner from 'primevue/progressspinner'
import Message from 'primevue/message'

const router = useRouter()
const route = useRoute()
const { t, locale } = useI18n()
const posStore = usePosStore()
const authStore = useAuthStore()

const loading = ref(false)
const errorMsg = ref('')
const selecting = ref(false)
const searchText = ref('')

const isChanging = computed(() => route.query.change === 'true')
const configuredPosId = computed(() => String(posStore.deviceConfig?.configured_pos_id || '').trim())
const configuredPos = computed(() => posStore.posList.find((pos) => String(pos.pos_id || '').trim() === configuredPosId.value) || null)
const showingConfiguredOnly = computed(() => Boolean(configuredPos.value))
const listSource = computed(() => (showingConfiguredOnly.value ? [configuredPos.value] : posStore.posList))

const filteredList = computed(() => {
  const q = searchText.value.trim().toLowerCase()
  if (!q) return listSource.value
  return listSource.value.filter(
    (p) =>
      p.pos_id?.toLowerCase().includes(q) ||
      p.machinecode?.toLowerCase().includes(q) ||
      p.branch_code?.toLowerCase().includes(q) ||
      p.branch_name?.toLowerCase().includes(q) ||
      p.pos_ic_wht?.toLowerCase().includes(q) ||
      p.wh_name?.toLowerCase().includes(q) ||
      p.pos_ic_shelf?.toLowerCase().includes(q) ||
      p.shelf_name?.toLowerCase().includes(q)
  )
})

function tl(th, en, lo = en) {
  const lang = String(locale.value || 'th').toLowerCase()
  if (lang.startsWith('en')) return en
  if (lang.startsWith('lo')) return lo
  return th
}

onMounted(async () => {
  loading.value = true
  try {
    await posStore.loadPosList()
    if (configuredPos.value && !isChanging.value) {
      await selectPos(configuredPos.value)
    }
  } catch (err) {
    errorMsg.value = err.message
  } finally {
    loading.value = false
  }
})

async function selectPos(pos) {
  selecting.value = true
  try {
    const shouldReplaceMissingConfiguredPos = Boolean(configuredPosId.value && !configuredPos.value)
    posStore.selectPos(pos)
    if (shouldReplaceMissingConfiguredPos) {
      posStore.saveDeviceConfig({
        ...posStore.deviceConfig,
        configured_pos_id: String(pos.pos_id || '').trim(),
      })
    }
    await posStore.refreshErpOption()
    router.push('/dashboard')
  } catch (err) {
    errorMsg.value = err.message
    selecting.value = false
  }
}

function logout() {
  authStore.logout()
  posStore.clearPos()
  router.push('/login')
}
</script>

<template>
  <Card class="pos-card">
    <template #header>
      <div class="pos-header">
        <Button
          class="pos-logout-button"
          :label="t('common.logout')"
          icon="pi pi-sign-out"
          severity="secondary"
          text
          size="small"
          @click="logout"
        />
        <i class="pi pi-desktop pos-icon" />
        <h2 class="pos-title">{{ isChanging ? t('pos.changeTitle') : t('pos.selectTitle') }}</h2>
        <p class="pos-subtitle">{{ t('pos.greeting', { name: authStore.employee?.user_name || '' }) }}</p>
      </div>
    </template>

    <template #content>
      <Message v-if="errorMsg" severity="error" :closable="false" class="mb-3">{{ errorMsg }}</Message>

      <div v-if="loading" class="loading-center">
        <ProgressSpinner style="width: 50px; height: 50px" />
      </div>

      <template v-else>
        <Message v-if="showingConfiguredOnly" severity="info" :closable="false" class="mb-3">
          {{ tl('เครื่องนี้ถูกล็อคกับ POS ที่ตั้งค่าไว้ หากต้องการเปลี่ยนให้แก้ที่หน้าตั้งค่า', 'This device is locked to its configured POS. Change it in Settings.', 'ເຄື່ອງນີ້ຖືກລັອກກັບ POS ທີ່ຕັ້ງຄ່າໄວ້') }}
        </Message>
        <Message v-else-if="configuredPosId && !configuredPos" severity="warn" :closable="false" class="mb-3">
          {{ tl('ไม่พบเครื่อง POS ที่ตั้งค่าไว้ในรายการล่าสุด เลือก POS ใหม่แล้วระบบจะบันทึกให้เครื่องนี้', 'The configured POS machine is not in the latest POS list. Select a new POS to save it for this device.', 'ບໍ່ພົບ POS ທີ່ຕັ້ງຄ່າໄວ້ ເລືອກ POS ໃໝ່ເພື່ອບັນທຶກໃຫ້ເຄື່ອງນີ້') }}
        </Message>

        <IconField class="search-box">
          <InputIcon class="pi pi-search" />
          <InputText
            v-model="searchText"
            :placeholder="t('pos.searchPlaceholder')"
            class="w-full"
          />
        </IconField>

        <div class="pos-list-wrap">
          <div v-if="filteredList.length === 0" class="empty-msg">
            <i class="pi pi-inbox empty-icon" />
            <span>{{ t('pos.empty') }}</span>
          </div>

          <div
            v-for="pos in filteredList"
            :key="pos.pos_id"
            class="pos-item"
            :data-testid="`pos-item-${pos.pos_id}`"
            :class="{ 'pos-item--active': posStore.selectedPos?.pos_id === pos.pos_id }"
            @click="!selecting && selectPos(pos)"
          >
            <div class="pos-item-main">
              <span class="pos-item-id">
                <template v-if="pos.machinecode">{{ pos.machinecode }} : </template>{{ pos.pos_id }}
              </span>
              <div class="pos-item-tags">
                <span v-if="pos.branch_code" class="pos-tag">
                  <i class="pi pi-map-marker" />
                  {{ pos.branch_name || pos.branch_code }}
                </span>
                <span v-if="pos.pos_ic_wht" class="pos-tag">
                  <i class="pi pi-warehouse" />
                  {{ pos.wh_name || pos.pos_ic_wht }}
                </span>
                <span v-if="pos.pos_ic_shelf" class="pos-tag">
                  <i class="pi pi-th-large" />
                  {{ pos.shelf_name || pos.pos_ic_shelf }}
                </span>
              </div>
            </div>
            <Button
              :data-testid="`pos-select-${pos.pos_id}`"
              :label="posStore.selectedPos?.pos_id === pos.pos_id ? t('common.active') : t('common.select')"
              :icon="posStore.selectedPos?.pos_id === pos.pos_id ? 'pi pi-check' : ''"
              :severity="posStore.selectedPos?.pos_id === pos.pos_id ? 'success' : 'primary'"
              size="small"
              :loading="selecting"
              @click.stop="selectPos(pos)"
            />
          </div>
        </div>
      </template>
    </template>
  </Card>
</template>

<style scoped>
.pos-card {
  position: relative;
  overflow: hidden;
  width: 100%;
  max-width: 480px;
  border: 1px solid #fed7aa;
  border-radius: 12px;
  background: linear-gradient(180deg, #ffffff 0%, #fffaf5 100%);
  box-shadow: 0 24px 54px rgba(249, 115, 22, 0.16);
}

.pos-card::before {
  content: "";
  display: block;
  height: 0.42rem;
  background: linear-gradient(135deg, #ff8a00 0%, #ff3d00 100%);
}

.pos-card :deep(.p-card-body) {
  padding-top: 0.75rem;
}

.pos-header {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 2rem 1rem 0.5rem;
  gap: 0.25rem;
}

.pos-logout-button {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
  color: #7c5740;
}

.pos-logout-button:hover {
  color: #c2410c;
  background: #fff7ed;
}

.pos-icon {
  font-size: 2.5rem;
  color: #f15a00;
  filter: drop-shadow(0 10px 18px rgba(249, 115, 22, 0.2));
}

.pos-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 900;
  color: #1f2937;
}

.pos-subtitle {
  margin: 0;
  font-size: 0.875rem;
  color: #7c5740;
}

.loading-center {
  display: flex;
  justify-content: center;
  padding: 2rem;
}

.mb-3 {
  margin-bottom: 1rem;
}

.search-box {
  width: 100%;
  margin-bottom: 0.75rem;
}

.search-box :deep(input) {
  width: 100%;
  border-color: #fed7aa;
  background: linear-gradient(180deg, #ffffff 0%, #fffdf8 100%);
  color: #1f2937;
}

.search-box :deep(input:enabled:focus) {
  border-color: #fb923c;
  box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.14);
}

.search-box :deep(.p-inputicon) {
  color: #c2410c;
}

.pos-list-wrap {
  max-height: 360px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-right: 2px;
}

.pos-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border: 1px solid #fed7aa;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.9);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s, transform 0.15s;
  gap: 0.75rem;
}

.pos-item:hover {
  background: #ffffff;
  border-color: #fb923c;
  box-shadow: 0 10px 24px rgba(249, 115, 22, 0.12);
  transform: translateY(-1px);
}

.pos-item--active {
  border-color: #22c55e;
  background: linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%);
}

.pos-item-main {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  min-width: 0;
}

.pos-item-id {
  font-weight: 900;
  font-size: 0.95rem;
  color: #1f2937;
}

.pos-item-tags {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.pos-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  color: #7c5740;
}

.pos-tag i {
  color: #c2410c;
}

.empty-msg {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2rem;
  color: #7c5740;
}

.empty-icon {
  font-size: 2rem;
  color: #f15a00;
}

.pos-item :deep(.p-button) {
  border-color: transparent;
  background: linear-gradient(135deg, #ff8a00 0%, #ff3d00 100%);
  color: #ffffff;
  font-weight: 900;
  box-shadow: 0 10px 20px rgba(249, 115, 22, 0.2);
}

.pos-item--active :deep(.p-button) {
  background: linear-gradient(135deg, #43a047 0%, #15803d 100%);
  box-shadow: 0 10px 20px rgba(21, 128, 61, 0.18);
}
</style>
