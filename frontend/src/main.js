import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import Aura from '@primeuix/themes/aura'
import ToastService from 'primevue/toastservice'
import DialogService from 'primevue/dialogservice'
import ConfirmationService from 'primevue/confirmationservice'
import Tooltip from 'primevue/tooltip'
import 'primeicons/primeicons.css'
import 'primeflex/primeflex.css'

import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/auth'
import { usePosStore } from './stores/pos'
import { i18n } from './i18n'
import './assets/main.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)

const authStore = useAuthStore()
const posStore = usePosStore()
authStore.restoreSession()
posStore.restorePos()

app.use(router)
app.use(i18n)
app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      prefix: 'p',
      darkModeSelector: '.dark',
      cssLayer: false,
    },
  },
})
app.use(ToastService)
app.use(DialogService)
app.use(ConfirmationService)
app.directive('tooltip', Tooltip)

app.mount('#app')
