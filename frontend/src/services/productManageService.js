import api from './api'
import { productImageGuidUrl, productImageUrl } from '@/utils/imageUrls'

export function getProductImageUrl(code) {
  return productImageUrl(code)
}

export function getProductImageGuidUrl(guidCode) {
  return productImageGuidUrl(guidCode)
}

async function loadList(endpoint, search = '') {
  const { data } = await api.get(endpoint, { params: { search } })
  return data
}

export const getProductGroupList     = (s = '') => loadList('/getProductGroupList', s)
export const getProductGroupSubList  = (s = '') => loadList('/getProductGroupSubList', s)
export const getProductGroupSub2List = (s = '') => loadList('/getProductGroupSub2List', s)
export const getProductBrandList     = (s = '') => loadList('/getProductBrandList', s)
export const getProductCategoryList  = (s = '') => loadList('/getProductCategoryList', s)
export const getProductDesignList    = (s = '') => loadList('/getProductDesignList', s)
export const getProductModelList     = (s = '') => loadList('/getProductModelList', s)
export const getUnitManageList       = (s = '') => loadList('/getUnitManageList', s)

export async function getProductManageList(params) {
  const { data } = await api.get('/getProductManageList', { params })
  return { data: data.data || [], totalCount: data.totalCount || 0 }
}

export async function getProductItemDetail(code) {
  const { data } = await api.get('/getProductItemDetail', { params: { code } })
  return data
}

export async function updateProductItemMain(body) {
  const { data } = await api.post('/updateProductItemMain', body)
  return data
}

export async function createProductItemMain(body) {
  const { data } = await api.post('/createProductItemMain', body)
  return data
}

export async function getProductItemBarcodes(ic_code) {
  const { data } = await api.get('/getProductItemBarcodes', { params: { ic_code } })
  return data
}

export async function generateProductItemBarcode(ic_code) {
  const { data } = await api.get('/generateProductItemBarcode', { params: { ic_code } })
  return data
}

export async function checkBarcodeInUse(ic_code, barcode) {
  const { data } = await api.get('/checkBarcodeInUse', { params: { ic_code, barcode } })
  return data
}

export async function createProductItemBarcode(body) {
  const { data } = await api.post('/createProductItemBarcode', body)
  return data
}

export async function updateProductItemBarcode(body) {
  const { data } = await api.post('/updateProductItemBarcode', body)
  return data
}

export async function deleteProductItemBarcode(body) {
  const { data } = await api.post('/deleteProductItemBarcode', body)
  return data
}

export async function getProductItemUnitUse(ic_code) {
  const { data } = await api.get('/getProductItemUnitUse', { params: { ic_code } })
  return data
}

export async function checkUnitUseInUse(ic_code, unit_code) {
  const { data } = await api.get('/checkUnitUseInUse', { params: { ic_code, unit_code } })
  return data
}

export async function createProductItemUnitUse(body) {
  const { data } = await api.post('/createProductItemUnitUse', body)
  return data
}

export async function updateProductItemUnitUse(body) {
  const { data } = await api.post('/updateProductItemUnitUse', body)
  return data
}

export async function deleteProductItemUnitUse(body) {
  const { data } = await api.post('/deleteProductItemUnitUse', body)
  return data
}

export async function getProductImages(item_code) {
  const { data } = await api.get('/getProductImages', { params: { item_code } })
  return data
}

export async function saveProductImage(item_code, image_file) {
  const { data } = await api.post('/saveProductImage', { item_code, image_file })
  return data
}

export async function deleteProductImage(guid_code) {
  const { data } = await api.post('/deleteProductImage', { guid_code })
  return data
}

export async function reorderProductImages(item_code, orders) {
  const { data } = await api.post('/reorderProductImages', { item_code, orders })
  return data
}

export async function getProductPriceFormulas(ic_code) {
  const { data } = await api.get('/getProductPriceFormulas', { params: { ic_code } })
  return data
}

export async function saveProductPriceFormula(body) {
  const { data } = await api.post('/saveProductPriceFormula', body)
  return data
}

export async function deleteProductPriceFormula(body) {
  const { data } = await api.post('/deleteProductPriceFormula', body)
  return data
}
