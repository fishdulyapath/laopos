import { spawnSync } from 'node:child_process'

const port = process.env.BIZSUIT_STACK_PORT || '8091'
const compose = process.env.DOCKER_COMPOSE || 'docker compose'
const project = process.env.COMPOSE_PROJECT_NAME || `bizsuit-stack-smoke-${Date.now()}`
const composeFile = process.env.FULLSTACK_COMPOSE_FILE || 'docker-compose.fullstack.yml'
const baseUrl = `http://127.0.0.1:${port}`
const apiBaseUrl = `${baseUrl}/service/v1`
const checks = []
let stackStarted = false

function requireEnv(names) {
  const missing = names.filter((name) => !String(process.env[name] || '').trim())
  if (missing.length) {
    throw new Error(`missing required env: ${missing.join(', ')}. Copy .env.fullstack.example outside git and export values before running smoke:fullstack.`)
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    env: { ...process.env, COMPOSE_PROJECT_NAME: project, BIZSUIT_STACK_PORT: port, ...(options.env || {}) },
  })
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    throw new Error(`${command} ${args.join(' ')} failed${output ? `\n${output}` : ''}`)
  }
  return result
}

async function read(url, { method = 'GET', headers, body, expect, attempts = 60 } = {}) {
  let last = ''
  let status = 0
  let responseHeaders = null
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, { method, headers, body })
      status = res.status
      responseHeaders = res.headers
      last = await res.text()
      if (res.ok && (!expect || last.includes(expect))) return { status, text: last, headers: responseHeaders }
    } catch (error) {
      last = error.message
    }
    await new Promise((resolve) => setTimeout(resolve, 750))
  }
  throw new Error(`smoke check failed for ${url} (${status || 'no status'}): ${last.slice(0, 240)}`)
}

async function readJson(url, options = {}) {
  const res = await read(url, options)
  try {
    return JSON.parse(res.text)
  } catch {
    throw new Error(`expected JSON from ${url}: ${res.text.slice(0, 240)}`)
  }
}

function pushCheck(name, extra = {}) {
  checks.push({ name, ...extra })
}

function resolveUrl(path) {
  return new URL(path, `${baseUrl}/`).toString()
}

function assetPaths(html, extension) {
  const pattern = new RegExp(`(?:src|href)="([^"]+\\.${extension}(?:\\?[^"]*)?)"`, 'g')
  return [...html.matchAll(pattern)].map((match) => match[1]).filter(Boolean)
}

function assertCachedAsset(name, response) {
  const cacheControl = response.headers?.get('cache-control') || ''
  if (!/max-age=\d+/.test(cacheControl)) {
    throw new Error(`${name} missing static cache header: ${cacheControl || '(none)'}`)
  }
  pushCheck(`${name} static cache`, { cache_control: cacheControl })
}

function assertNoStore(name, response) {
  const cacheControl = response.headers?.get('cache-control') || ''
  if (!cacheControl.includes('no-store')) {
    throw new Error(`${name} missing no-store cache header: ${cacheControl || '(none)'}`)
  }
  pushCheck(`${name} no-store cache`, { cache_control: cacheControl })
}

async function checkOptionalProductImage(products) {
  for (const product of products || []) {
    const itemCode = product.item_code || product.code || ''
    if (!itemCode) continue
    const list = await readJson(`${apiBaseUrl}/getProductImages?item_code=${encodeURIComponent(itemCode)}`).catch(() => null)
    const image = Array.isArray(list?.data) ? list.data[0] : null
    if (!image?.guid_code) continue
    const response = await read(`${apiBaseUrl}/imagesguid?guid_code=${encodeURIComponent(image.guid_code)}`, {
      headers: { 'ngrok-skip-browser-warning': '1' },
      attempts: 10,
    })
    const contentType = response.headers?.get('content-type') || ''
    if (!contentType.startsWith('image/')) throw new Error(`product image returned unexpected content-type: ${contentType}`)
    pushCheck('product image through proxy', { item_code: itemCode, content_type: contentType })
    return
  }
  pushCheck('product image through proxy', { skipped: true, reason: 'no product image found in demo data' })
}

async function checkOptionalSalePrintPreview() {
  const history = await readJson(`${apiBaseUrl}/getDocSaleHistory`).catch(() => null)
  const doc = Array.isArray(history?.data) ? history.data.find((row) => row.doc_no) : null
  if (!doc?.doc_no) {
    pushCheck('sale print preview through proxy', { skipped: true, reason: 'no sale document found' })
    return
  }
  const forms = await readJson(`${apiBaseUrl}/getSalePrintForms?doc_no=${encodeURIComponent(doc.doc_no)}`).catch(() => null)
  const rows = Array.isArray(forms?.data?.forms) ? forms.data.forms : []
  const selected = rows.filter((row) => row.available && (row.default_print || row.formcode)).map((row) => row.formcode).filter(Boolean)
  if (!selected.length) {
    pushCheck('sale print preview through proxy', { skipped: true, reason: 'no sale print form found', doc_no: doc.doc_no })
    return
  }
  await read(`${apiBaseUrl}/sale-print/render?doc_no=${encodeURIComponent(doc.doc_no)}&formcodes=${encodeURIComponent(selected.join(','))}&auto_print=0&log_print=0`, {
    expect: '<!doctype html',
    attempts: 10,
  })
  pushCheck('sale print preview through proxy', { doc_no: doc.doc_no, forms: selected })
}

function runOptionalSaleCreateSmoke() {
  if (process.env.SMOKE_CREATE_SALE !== '1') {
    pushCheck('sale create smoke through proxy', { skipped: true, reason: 'SMOKE_CREATE_SALE=1 not set' })
    return
  }
  run(process.execPath, ['scripts/sale-total-mismatch-regression.mjs'], {
    env: { BASE_URL: apiBaseUrl },
  })
  pushCheck('sale create smoke through proxy', { script: 'scripts/sale-total-mismatch-regression.mjs' })
}

const [dockerCommand, ...composeArgs] = compose.split(/\s+/).filter(Boolean)

requireEnv(['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'DB_IMAGES_NAME'])

try {
  run(dockerCommand, [...composeArgs, '-f', composeFile, 'up', '--build', '-d'])
  stackStarted = true

  await read(`${baseUrl}/healthz`, { expect: 'ok' })
  pushCheck('proxy health', { url: `${baseUrl}/healthz` })

  await read(`${baseUrl}/api-health`, { expect: '"ok"' })
  pushCheck('backend health through proxy', { url: `${baseUrl}/api-health` })

  const appShell = await read(`${baseUrl}/bizsuit/`, { expect: '<div id="app">' })
  pushCheck('BizSuit app shell', { url: `${baseUrl}/bizsuit/` })
  assertNoStore('BizSuit app shell', appShell)

  const jsAssets = assetPaths(appShell.text, 'js')
  const cssAssets = assetPaths(appShell.text, 'css')
  const jsAsset = jsAssets[0] || ''
  const cssAsset = cssAssets[0] || ''
  if (!jsAsset || !cssAsset) throw new Error('BizSuit app shell did not include JS/CSS assets')
  const jsResponse = await read(resolveUrl(jsAsset), { attempts: 10 })
  assertCachedAsset('JS asset', jsResponse)
  const cssResponse = await read(resolveUrl(cssAsset), { attempts: 10 })
  assertCachedAsset('CSS asset', cssResponse)
  let apiBaseAsset = ''
  for (const asset of jsAssets) {
    const response = await read(resolveUrl(asset), { attempts: 10 })
    if (response.text.includes('/service/v1')) {
      apiBaseAsset = asset
      break
    }
  }
  if (!apiBaseAsset) throw new Error('compiled frontend assets do not contain /service/v1 API base')
  pushCheck('frontend API base compiled', { api_base: '/service/v1', asset: apiBaseAsset })

  const posList = await readJson(`${apiBaseUrl}/getPOSList`)
  if (!posList?.success || !Array.isArray(posList.data)) throw new Error('getPOSList did not return success data')
  pushCheck('service proxy getPOSList', { count: posList.data.length })

  const erpOption = await readJson(`${apiBaseUrl}/getErpOption`)
  if (!erpOption?.success || !erpOption.data) throw new Error('getErpOption did not return success data')
  pushCheck('service proxy getErpOption', {
    vat_type: erpOption.data.vat_type,
    item_amount_decimal: erpOption.data.item_amount_decimal,
  })

  const formats = await readJson(`${apiBaseUrl}/getSaleDocFormatList`)
  if (!formats?.success || !Array.isArray(formats.data)) throw new Error('getSaleDocFormatList did not return success data')
  pushCheck('service proxy sale doc formats', { count: formats.data.length })

  const productList = await readJson(`${apiBaseUrl}/getProductList?limit=20`).catch(() => ({ data: [] }))
  await checkOptionalProductImage(productList.data)
  await checkOptionalSalePrintPreview()
  runOptionalSaleCreateSmoke()

  const user = String(process.env.SMOKE_EMPLOYEE_USER || '').trim()
  const password = String(process.env.SMOKE_EMPLOYEE_PASSWORD || '').trim()
  if (user && password) {
    const login = await readJson(`${apiBaseUrl}/loginemp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'ngrok-skip-browser-warning': '1' },
      body: JSON.stringify({ user_code: user, password }),
    })
    if (!login?.success || !Array.isArray(login.data) || login.data.length < 1) {
      throw new Error('employee login smoke failed')
    }
    pushCheck('employee login POST', { user_code: login.data[0].user_code })
  } else {
    pushCheck('employee login POST', { skipped: true, reason: 'SMOKE_EMPLOYEE_USER/SMOKE_EMPLOYEE_PASSWORD not set' })
  }

  console.log(JSON.stringify({
    status: 'PASS',
    project,
    baseUrl,
    checks,
  }, null, 2))
} finally {
  if (stackStarted && process.env.KEEP_DOCKER_SMOKE !== '1') {
    run(dockerCommand, [...composeArgs, '-f', composeFile, 'down', '--remove-orphans'])
  }
}
