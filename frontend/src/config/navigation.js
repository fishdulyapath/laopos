import { PERMISSIONS } from '@/utils/permissions'

export const APP_NAV_ITEMS = [
  { labelKey: 'nav.dashboard', label: 'แดชบอร์ด', icon: 'pi pi-home', to: '/dashboard' },
  { labelKey: 'nav.sell', label: 'ขายสินค้า', icon: 'pi pi-shopping-cart', to: '/sell', permission: PERMISSIONS.sellView },
  { labelKey: 'nav.salesHistory', label: 'ประวัติการขาย', icon: 'pi pi-history', to: '/sales-history', base: '/sales-history', permission: PERMISSIONS.salesCashView },
  { labelKey: 'nav.laoQrHistory', label: 'ประวัติรับเงิน QRLao', icon: 'pi pi-qrcode', to: '/lao-qr-history', base: '/lao-qr-history', permission: PERMISSIONS.laoQrHistoryView },
  // { label: 'คลังสินค้า', icon: 'pi pi-box', to: '/inventory', permission: PERMISSIONS.inventoryView },
  // { label: 'สินค้าขายหมด', icon: 'pi pi-exclamation-circle', to: '/sold-out', permission: PERMISSIONS.soldOutView },
  // { label: 'ซื้อ/ตั้งหนี้', icon: 'pi pi-file-import', to: '/purchase/pu', base: '/purchase/pu', permission: PERMISSIONS.purchasePuView },
  // { label: 'จัดการสินค้า', icon: 'pi pi-tag', to: '/products', base: '/products', permission: PERMISSIONS.productView },
  { labelKey: 'nav.permissions', label: 'กำหนดสิทธิ์', icon: 'pi pi-lock', to: '/permissions', permission: PERMISSIONS.permissionManage },
  { labelKey: 'nav.settings', label: 'ตั้งค่าอุปกรณ์', icon: 'pi pi-cog', to: '/settings' },
  { label: 'แต่ง Slip POS', icon: 'pi pi-receipt', to: '/pos-slip-template', base: '/pos-slip-template' },
]
