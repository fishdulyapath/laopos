import { Pool } from 'pg'

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:47319/service/v1'
const TEST_ITEM_CODE = process.env.TEST_ITEM_CODE || '10-00001'
const TEST_WH_CODE = process.env.TEST_WH_CODE || '001'
const results = []

function pass(name, extra = {}) { results.push({ status: 'PASS', name, ...extra }) }
function fail(name, error) { results.push({ status: 'FAIL', name, error: error?.message || String(error) }) }
function skip(name, reason) { results.push({ status: 'SKIP', name, reason }) }

async function api(pathname, { method = 'GET', body, allowStatus = [] } = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!response.ok && !allowStatus.includes(response.status)) {
    throw new Error(`${method} ${pathname} ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`)
  }
  return data
}

function zeroPricePayload() {
  return {
    doc_date: process.env.TEST_DOC_DATE || new Date().toISOString().slice(0, 10),
    vat_type: 0,
    vat_rate: 7,
    items: [{
      item_code: TEST_ITEM_CODE,
      item_name: 'ZERO PRICE TEST',
      unit_code: process.env.TEST_UNIT_CODE || 'PCS',
      qty: 1,
      price: 0,
      discount: '',
      tax_type: 0,
      wh_code: TEST_WH_CODE,
      shelf_code: '',
      stand_value: 1,
      divide_value: 1,
      ratio: 1,
      item_type: 0,
    }],
  }
}

function dbPool() {
  if (!process.env.DB_HOST || !process.env.DB_NAME) return null
  return new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,
    connectionTimeoutMillis: 10000,
  })
}

async function hasColumn(pool, columnName) {
  const result = await pool.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'erp_option'
       AND column_name = $1
     LIMIT 1`,
    [columnName],
  )
  return result.rows.length > 0
}

async function readWarningConfig(pool) {
  return (await pool.query('SELECT warning_price_1, warning_price_2 FROM erp_option LIMIT 1')).rows[0] || {
    warning_price_1: 0,
    warning_price_2: 0,
  }
}

async function restoreWarningConfig(pool, original) {
  await pool.query(
    'UPDATE erp_option SET warning_price_1 = $1, warning_price_2 = $2',
    [original.warning_price_1 || 0, original.warning_price_2 || 0],
  )
}

async function readLowCostConfig(pool) {
  return (await pool.query('SELECT warning_low_cost, lock_low_cost FROM erp_option LIMIT 1')).rows[0] || {
    warning_low_cost: 0,
    lock_low_cost: 0,
  }
}

async function restoreLowCostConfig(pool, original) {
  await pool.query(
    'UPDATE erp_option SET warning_low_cost = $1, lock_low_cost = $2',
    [original.warning_low_cost || 0, original.lock_low_cost || 0],
  )
}

async function findLowCostTestItem(pool) {
  const result = await pool.query(
    `SELECT code, name_1, COALESCE(average_cost, 0)::numeric AS unit_cost
     FROM ic_inventory
     WHERE COALESCE(average_cost, 0)::numeric > 0
     ORDER BY code
     LIMIT 1`,
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    item_code: row.code,
    item_name: row.name_1 || row.code,
    unit_cost: Number(row.unit_cost) || 0,
  }
}

function lowCostPayload(item, price) {
  return {
    doc_date: process.env.TEST_DOC_DATE || new Date().toISOString().slice(0, 10),
    vat_type: 0,
    vat_rate: 7,
    items: [{
      item_code: item.item_code,
      item_name: item.item_name,
      unit_code: process.env.TEST_UNIT_CODE || 'PCS',
      qty: 1,
      price,
      sum_amount: price,
      discount: '',
      discount_amount: 0,
      tax_type: 0,
      wh_code: TEST_WH_CODE,
      shelf_code: '',
      stand_value: 1,
      divide_value: 1,
      ratio: 1,
      item_type: 0,
    }],
  }
}

async function testCurrentConfigAllowsOrWarnsConsistently() {
  const result = await api('/checkSaleItemPolicies', { method: 'POST', body: zeroPricePayload() })
  const data = result?.data || {}
  if (!Array.isArray(data.errors) || !Array.isArray(data.warnings)) {
    throw new Error(`unexpected response: ${JSON.stringify(result)}`)
  }
  pass('checkSaleItemPolicies returns structured price-zero policy result', {
    errors: data.errors.length,
    warnings: data.warnings.length,
  })
}

async function testWarningPriceZeroWithDbToggle() {
  const pool = dbPool()
  if (!pool) {
    skip('price zero warning toggle', 'DB_HOST/DB_NAME not set')
    return
  }

  try {
    const warning1Exists = await hasColumn(pool, 'warning_price_1')
    const warning2Exists = await hasColumn(pool, 'warning_price_2')
    if (!warning1Exists || !warning2Exists) {
      skip('price zero warning toggle', 'erp_option missing warning_price_1 or warning_price_2')
      return
    }

    const original = await readWarningConfig(pool)
    try {
      await pool.query('UPDATE erp_option SET warning_price_1 = 1, warning_price_2 = 0')
      const result = await api('/checkSaleItemPolicies', { method: 'POST', body: zeroPricePayload() })
      const warnings = result?.data?.warnings || []
      const errors = result?.data?.errors || []
      const noPriceWarning = warnings.find((row) => row.code === 'SALE_ITEM_NO_PRICE')
      if (errors.length) throw new Error(`expected no errors, got ${JSON.stringify(errors)}`)
      if (!noPriceWarning) throw new Error(`SALE_ITEM_NO_PRICE warning missing: ${JSON.stringify(result?.data)}`)
      pass('price zero returns SALE_ITEM_NO_PRICE warning when warning_price_1=1', {
        message: noPriceWarning.message,
      })
    } finally {
      await restoreWarningConfig(pool, original)
    }
  } finally {
    await pool.end()
  }
}

async function testLowCostWarningAndLockWithDbToggle() {
  const pool = dbPool()
  if (!pool) {
    skip('low cost warning and lock toggle', 'DB_HOST/DB_NAME not set')
    return
  }

  try {
    const warningExists = await hasColumn(pool, 'warning_low_cost')
    const lockExists = await hasColumn(pool, 'lock_low_cost')
    if (!warningExists || !lockExists) {
      skip('low cost warning and lock toggle', 'erp_option missing warning_low_cost or lock_low_cost')
      return
    }

    const item = await findLowCostTestItem(pool)
    if (!item?.unit_cost) {
      skip('low cost warning and lock toggle', 'no ic_inventory item with average_cost > 0')
      return
    }

    const price = Math.max(0.01, Math.round((item.unit_cost / 2) * 100) / 100)
    const original = await readLowCostConfig(pool)
    try {
      await pool.query('UPDATE erp_option SET warning_low_cost = 1, lock_low_cost = 0')
      const warningResult = await api('/checkSaleItemPolicies', {
        method: 'POST',
        body: lowCostPayload(item, price),
      })
      const warnings = warningResult?.data?.warnings || []
      const errors = warningResult?.data?.errors || []
      const lowCostWarning = warnings.find((row) => row.code === 'SALE_ITEM_LOW_COST')
      if (errors.length) throw new Error(`expected no errors for warning mode, got ${JSON.stringify(errors)}`)
      if (!lowCostWarning) throw new Error(`SALE_ITEM_LOW_COST warning missing: ${JSON.stringify(warningResult?.data)}`)
      pass('low cost returns SALE_ITEM_LOW_COST warning when warning_low_cost=1', {
        message: lowCostWarning.message,
      })

      await pool.query('UPDATE erp_option SET warning_low_cost = 0, lock_low_cost = 1')
      const lockResult = await api('/checkSaleItemPolicies', {
        method: 'POST',
        body: lowCostPayload(item, price),
      })
      const lockErrors = lockResult?.data?.errors || []
      const lowCostError = lockErrors.find((row) => row.code === 'SALE_ITEM_LOW_COST')
      if (!lowCostError) throw new Error(`SALE_ITEM_LOW_COST error missing: ${JSON.stringify(lockResult?.data)}`)
      pass('low cost returns SALE_ITEM_LOW_COST error when lock_low_cost=1', {
        message: lowCostError.message,
      })
    } finally {
      await restoreLowCostConfig(pool, original)
    }
  } finally {
    await pool.end()
  }
}

async function main() {
  console.log(`BASE_URL=${BASE_URL}`)
  await testCurrentConfigAllowsOrWarnsConsistently().catch((error) => fail('checkSaleItemPolicies price zero current config', error))
  await testWarningPriceZeroWithDbToggle().catch((error) => fail('price zero warning toggle', error))
  await testLowCostWarningAndLockWithDbToggle().catch((error) => fail('low cost warning and lock toggle', error))

  console.log('\n=== SALE ITEM POLICY SUMMARY ===')
  for (const row of results) {
    const suffix = row.error ? ` - ${row.error}` : row.reason ? ` - ${row.reason}` : row.message ? ` - ${row.message}` : ''
    console.log(`${row.status} ${row.name}${suffix}`)
  }
  process.exitCode = results.some((row) => row.status === 'FAIL') ? 1 : 0
}

await main()
