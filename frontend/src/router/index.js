import { createRouter, createWebHashHistory, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { usePosStore } from '@/stores/pos'
import { PERMISSIONS } from '@/utils/permissions'

const routes = [
  { path: '/', redirect: '/dashboard' },
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/LoginView.vue'),
    meta: { requiresAuth: false, layout: 'AuthLayout' },
  },
  {
    path: '/select-pos',
    name: 'SelectPos',
    component: () => import('@/views/SelectPosView.vue'),
    meta: { requiresAuth: true, layout: 'AuthLayout' },
  },
  {
    path: '/dashboard',
    name: 'Dashboard',
    component: () => import('@/views/DashboardView.vue'),
    meta: { requiresAuth: true, requiresPos: true, layout: 'AppLayout' },
  },
  {
    path: '/sales-history',
    name: 'SalesHistory',
    component: () => import('@/views/SalesHistoryView.vue'),
    meta: { requiresAuth: true, requiresPos: true, permission: PERMISSIONS.salesCashView, layout: 'AppLayout' },
  },
  {
    path: '/lao-qr-history',
    name: 'LaoQrHistory',
    component: () => import('@/views/LaoQrHistoryView.vue'),
    meta: { requiresAuth: true, requiresPos: true, permission: PERMISSIONS.laoQrHistoryView, layout: 'AppLayout' },
  },
  {
    path: '/sales-history/:docNo',
    name: 'SalesHistoryDetail',
    redirect: (to) => ({ name: 'Sell', query: { doc_no: to.params.docNo } }),
    meta: { requiresAuth: true, requiresPos: true, permission: PERMISSIONS.salesCashView, layout: 'AppLayout' },
  },
  { path: '/sales-history/cash', redirect: { name: 'SalesHistory', query: { sale_kind: 'cash' } } },
  { path: '/sales-history/credit', redirect: { name: 'SalesHistory', query: { sale_kind: 'credit' } } },
  { path: '/sales-history/cash/:docNo', redirect: (to) => ({ name: 'Sell', query: { doc_no: to.params.docNo } }) },
  { path: '/sales-history/credit/:docNo', redirect: (to) => ({ name: 'Sell', query: { doc_no: to.params.docNo } }) },
  {
    path: '/sell',
    name: 'Sell',
    component: () => import('@/views/SellView.vue'),
    meta: { requiresAuth: true, requiresPos: true, permission: PERMISSIONS.sellView, layout: 'AppLayout' },
  },
  {
    path: '/inventory',
    name: 'Inventory',
    component: () => import('@/views/InventoryView.vue'),
    meta: { requiresAuth: true, requiresPos: true, permission: PERMISSIONS.inventoryView, layout: 'AppLayout' },
  },
  {
    path: '/sold-out',
    name: 'SoldOut',
    component: () => import('@/views/SoldOutView.vue'),
    meta: { requiresAuth: true, requiresPos: true, permission: PERMISSIONS.soldOutView, layout: 'AppLayout' },
  },
  {
    path: '/purchase/pu',
    name: 'PurchasePU',
    component: () => import('@/views/PurchasePUView.vue'),
    meta: { requiresAuth: true, requiresPos: false, permission: PERMISSIONS.purchasePuView, layout: 'AppLayout' },
  },
  {
    path: '/purchase/pu/create',
    name: 'PurchasePUCreate',
    component: () => import('@/views/PurchasePUView.vue'),
    meta: { requiresAuth: true, requiresPos: false, permissions: [PERMISSIONS.purchasePuView, PERMISSIONS.purchasePuCreate], layout: 'AppLayout' },
  },
  {
    path: '/purchase/pu/:docNo/edit',
    name: 'PurchasePUEdit',
    component: () => import('@/views/PurchasePUView.vue'),
    meta: { requiresAuth: true, requiresPos: false, permissions: [PERMISSIONS.purchasePuView, PERMISSIONS.purchasePuEdit], layout: 'AppLayout' },
  },
  {
    path: '/receipt',
    name: 'Receipt',
    component: () => import('@/views/ReceiptView.vue'),
    meta: { requiresAuth: false, layout: 'BlankLayout' },
  },
  {
    path: '/customer-display',
    name: 'CustomerDisplay',
    component: () => import('@/views/CustomerDisplayView.vue'),
    meta: { requiresAuth: false, layout: 'BlankLayout' },
  },
  {
    path: '/products',
    name: 'ProductManage',
    component: () => import('@/views/ProductManageView.vue'),
    meta: { requiresAuth: true, requiresPos: false, permission: PERMISSIONS.productView, layout: 'AppLayout' },
  },
  {
    path: '/permissions',
    name: 'PermissionManage',
    component: () => import('@/views/PermissionManageView.vue'),
    meta: { requiresAuth: true, requiresPos: false, permission: PERMISSIONS.permissionManage, layout: 'AppLayout' },
  },
  {
    path: '/products/:code/edit',
    name: 'ProductManageEdit',
    component: () => import('@/views/ProductManageEditView.vue'),
    meta: { requiresAuth: true, requiresPos: false, permission: PERMISSIONS.productView, layout: 'AppLayout' },
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('@/views/SettingsView.vue'),
    meta: { requiresAuth: true, requiresPos: false, layout: 'AppLayout' },
  },
  {
    path: '/pos-slip-template',
    name: 'PosSlipTemplate',
    component: () => import('@/views/PosSlipTemplateView.vue'),
    meta: { requiresAuth: true, requiresPos: false, layout: 'AppLayout' },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { requiresAuth: true, layout: 'AppLayout' },
  },
]

const router = createRouter({
  history: import.meta.env.VITE_ELECTRON === 'true' ? createWebHashHistory() : createWebHistory(import.meta.env.BASE_URL),
  routes,
})

function firstAllowedRoute(authStore) {
  return firstAllowedRouteForPos(authStore, true)
}

function routeRequiresPos(name) {
  return routes.find((route) => route.name === name)?.meta?.requiresPos === true
}

function firstAllowedRouteForPos(authStore, hasPos) {
  const candidates = [
    { name: 'Dashboard' },
    { name: 'Sell', permission: PERMISSIONS.sellView },
    { name: 'Inventory', permission: PERMISSIONS.inventoryView },
    { name: 'SalesHistory', permission: PERMISSIONS.salesCashView },
    { name: 'LaoQrHistory', permission: PERMISSIONS.laoQrHistoryView },
    { name: 'SoldOut', permission: PERMISSIONS.soldOutView },
    { name: 'PurchasePU', permission: PERMISSIONS.purchasePuView },
    { name: 'ProductManage', permission: PERMISSIONS.productView },
    { name: 'PermissionManage', permission: PERMISSIONS.permissionManage },
  ]
  return candidates.find((item) =>
    (item.permissionsAny ? authStore.hasAnyPermission(item.permissionsAny) : authStore.hasPermission(item.permission)) && (hasPos || !routeRequiresPos(item.name))
  ) || (hasPos ? { name: 'Dashboard' } : { name: 'SelectPos' })
}

router.beforeEach(async (to) => {
  const authStore = useAuthStore()
  const posStore = usePosStore()

  const isValid = authStore.checkAndExpire()

  if (to.meta.requiresAuth && !isValid) {
    return { name: 'Login' }
  }

  if (to.meta.requiresPos) {
    if (!posStore.hasPos) return { name: 'SelectPos' }
    const validPos = await posStore.ensureSelectedPosValid()
    if (!validPos) return { name: 'SelectPos' }
  }

  if (to.meta.permission && !authStore.hasPermission(to.meta.permission)) {
    return firstAllowedRouteForPos(authStore, posStore.hasPos)
  }

  if (to.meta.permissions && !authStore.hasAllPermissions(to.meta.permissions)) {
    return firstAllowedRouteForPos(authStore, posStore.hasPos)
  }

  if (to.meta.permissionsAny && !authStore.hasAnyPermission(to.meta.permissionsAny)) {
    return firstAllowedRouteForPos(authStore, posStore.hasPos)
  }

  if (to.name === 'Login' && isValid) {
    return firstAllowedRouteForPos(authStore, posStore.hasPos)
  }
})

export default router
