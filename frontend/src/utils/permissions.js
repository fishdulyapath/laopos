export const PERMISSIONS = {
  permissionManage: 'permission.manage',
  dashboardSoldOutReport: 'dashboard.sold_out_report',
  dashboardTodaySales: 'dashboard.today_sales',
  dashboardMonthlySummary: 'dashboard.monthly_summary',
  sellView: 'sell.view',
  inventoryView: 'inventory.view',
  inventoryAdjustStock: 'inventory.adjust_stock',
  salesCashView: 'sales.cash.view',
  salesCashDetail: 'sales.cash.detail',
  salesCashPrint: 'sales.cash.print',
  salesCashEdit: 'sales.cash.edit',
  salesCreditView: 'sales.credit.view',
  laoQrHistoryView: 'lao_qr.history.view',
  soldOutView: 'sold_out.view',
  purchasePuView: 'purchase.pu.view',
  purchasePuCreate: 'purchase.pu.create',
  purchasePuEdit: 'purchase.pu.edit',
  purchasePuPrint: 'purchase.pu.print',
  productView: 'product.view',
  productImages: 'product.images',
  productImagesEdit: 'product.images.edit',
  productMain: 'product.main',
  productMainEdit: 'product.main.edit',
  productPriceFormula: 'product.price_formula',
  productPriceFormulaEdit: 'product.price_formula.edit',
  productUnits: 'product.units',
  productUnitsEdit: 'product.units.edit',
  productBarcodes: 'product.barcodes',
  productBarcodesEdit: 'product.barcodes.edit',
}

export const ALL_PERMISSION_KEYS = Object.values(PERMISSIONS)

const PERMISSION_ALIASES = {
  'sales.cash.view': ['sales.credit.view'],
}

export function can(permissions, key) {
  if (!key) return true
  if (!Array.isArray(permissions)) return false
  return permissions.includes(key) || (PERMISSION_ALIASES[key] || []).some((alias) => permissions.includes(alias))
}

export function canAll(permissions, keys) {
  if (!keys) return true
  const required = Array.isArray(keys) ? keys : [keys]
  if (required.length === 0) return true
  if (!Array.isArray(permissions)) return false
  return required.every((key) => permissions.includes(key))
}
