<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import Card from 'primevue/card'
import InputText from 'primevue/inputtext'
import Avatar from 'primevue/avatar'
import Password from 'primevue/password'
import Checkbox from 'primevue/checkbox'
import Button from 'primevue/button'
import Message from 'primevue/message'
import AppUpdateStatus from '@/components/common/AppUpdateStatus.vue'
import { APP_NAME, APP_SUBTITLE } from '@/config/app'
import santipabImg from '@/assets/santipab.png'

const router = useRouter()
const { t } = useI18n()
const authStore = useAuthStore()

const userCode = ref('')
const password = ref('')
const rememberMe = ref(false)
const loading = ref(false)
const errorMsg = ref('')

async function handleLogin() {
  if (!userCode.value.trim() || !password.value.trim()) {
    errorMsg.value = t('auth.required')
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    await authStore.login(userCode.value.trim(), password.value.trim(), rememberMe.value)
    router.push('/select-pos')
  } catch (err) {
    errorMsg.value = err.message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <Card class="login-card">
    <template #header>
      <div class="login-header">

        <Avatar :image="santipabImg" class="mr-2" size="xlarge" shape="circle" />
        <h2 class="login-title">ສັນຕິພາບ <span class="login-logo">POS</span></h2>
 
      </div>
    </template>

    <template #content>
      <form class="login-form" @submit.prevent="handleLogin">
        <Message v-if="errorMsg" severity="error" :closable="false">{{ errorMsg }}</Message>

        <div class="field">
          <label for="userCode">{{ t('auth.userCode') }}</label>
          <InputText
            id="userCode"
            v-model="userCode"
            data-testid="login-user-code"
            :placeholder="t('auth.userCodePlaceholder')"
            class="w-full"
            autocomplete="username"
            @input="errorMsg = ''"
          />
        </div>

        <div class="field">
          <label for="password">{{ t('auth.password') }}</label>
          <Password
            id="password"
            v-model="password"
            data-testid="login-password"
            input-id="login-password-input"
            input-class="login-password-input"
            :placeholder="t('auth.passwordPlaceholder')"
            class="w-full"
            :feedback="false"
            toggle-mask
            autocomplete="current-password"
            @input="errorMsg = ''"
          />
        </div>

        <div class="field-checkbox">
          <Checkbox v-model="rememberMe" input-id="remember" binary />
          <label for="remember">{{ t('auth.rememberMe') }}</label>
        </div>

        <Button
          type="submit"
          data-testid="login-submit"
          :label="t('auth.login')"
          class="w-full"
          :loading="loading"
        />
      </form>
    </template>

    <template #footer>
      <AppUpdateStatus compact align="center" />
    </template>
  </Card>
</template>

<style scoped>
.login-card {
  position: relative;
  overflow: hidden;
  width: 100%;
  max-width: 420px;
  border: 1px solid #fed7aa;
  border-radius: 12px;
  background: linear-gradient(180deg, #ffffff 0%, #fffaf5 100%);
  box-shadow: 0 24px 54px rgba(249, 115, 22, 0.16);
}

.login-card::before {
  content: "";
  display: block;
  height: 0.42rem;
  background: linear-gradient(135deg, #ff8a00 0%, #ff3d00 100%);
}

.login-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 2rem 1rem 0.5rem;
  gap: 0.25rem;
}

.login-header :deep(.p-avatar) {
  border: 3px solid #ffedd5;
  background: #ffffff;
  box-shadow: 0 10px 24px rgba(249, 115, 22, 0.18);
}

.login-logo {
  font-size: 2rem;
  color: #f15a00;
}

.login-title {
  margin: 0;
  font-size: 2rem;
  font-weight: 900;
  color: #1f2937;
}

.login-subtitle {
  margin: 0;
  font-size: 0.875rem;
  color: #7c5740;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.login-card :deep(.p-card-body) {
  padding-top: 0.75rem;
}

.login-card :deep(.p-card-footer) {
  padding-top: 0;
}

.login-card :deep(.p-message) {
  border-color: #fecaca;
  background: #fff1f2;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.field label {
  font-size: 0.875rem;
  font-weight: 800;
  color: #c2410c;
}

.field :deep(.p-inputtext),
.field :deep(.p-password),
.field :deep(.p-password-input) {
  width: 100%;
}

.field :deep(.p-inputtext) {
  border-color: #fed7aa;
  background: linear-gradient(180deg, #ffffff 0%, #fffdf8 100%);
  color: #1f2937;
}

.field :deep(.p-inputtext:enabled:focus) {
  border-color: #fb923c;
  box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.14);
}

.field-checkbox {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.field-checkbox label {
  font-size: 0.875rem;
  color: #7c5740;
  cursor: pointer;
}

.field-checkbox :deep(.p-checkbox-box) {
  border-color: #fdba74;
}

.field-checkbox :deep(.p-checkbox-checked .p-checkbox-box) {
  border-color: #2e7d32;
  background: #2e7d32;
}

.login-form :deep(.p-button) {
  min-height: 3rem;
  border-color: transparent;
  background: linear-gradient(135deg, #ff8a00 0%, #ff3d00 100%);
  color: #ffffff;
  font-weight: 900;
  box-shadow: 0 14px 28px rgba(249, 115, 22, 0.24);
}

.login-form :deep(.p-button:not(:disabled):hover) {
  background: linear-gradient(135deg, #fb923c 0%, #ea580c 100%);
  border-color: transparent;
}

.w-full {
  width: 100%;
}
</style>
