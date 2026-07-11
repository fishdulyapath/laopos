import { runtimeApiBaseUrl } from '@/config/runtime'

const IMAGE_CACHE_KEY = Date.now().toString(36);

function appendQuery(url, params) {
  const search = new URLSearchParams(params);
  return `${url}${url.includes('?') ? '&' : '?'}${search.toString()}`;
}

export function productImageUrl(itemCode, apiBase = runtimeApiBaseUrl()) {
  return appendQuery(`${apiBase}/images`, {
    item_code: itemCode || '',
    'ngrok-skip-browser-warning': '1',
    _: IMAGE_CACHE_KEY,
  });
}

export function productImageGuidUrl(guidCode, apiBase = runtimeApiBaseUrl()) {
  return appendQuery(`${apiBase}/imagesguid`, {
    guid_code: guidCode || '',
    'ngrok-skip-browser-warning': '1',
    _: IMAGE_CACHE_KEY,
  });
}

export function docImageUrl(guidCode, apiBase = runtimeApiBaseUrl()) {
  return appendQuery(`${apiBase}/getDocImage/${encodeURIComponent(guidCode || '')}`, {
    'ngrok-skip-browser-warning': '1',
    _: IMAGE_CACHE_KEY,
  });
}
