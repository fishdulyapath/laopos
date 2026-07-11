import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)))

const suites = [
  { name: 'demo-sale', script: 'scripts/demo-sale-regression.mjs' },
  { name: 'set-product', script: 'scripts/set-product-regression.mjs' },
  { name: 'phase1-payment', script: 'scripts/phase1-payment-regression.mjs' },
  { name: 'sale-credit', script: 'scripts/sale-credit-regression.mjs' },
  { name: 'sell-detail', script: 'scripts/sell-detail-regression.mjs' },
  { name: 'sale-total-mismatch', script: 'scripts/sale-total-mismatch-regression.mjs' },
]

function runSuite(suite) {
  return (async () => {
    const startedAt = Date.now()
    console.log(`\n=== RUN ${suite.name} ===`)
    process.exitCode = 0
    try {
      const fileUrl = pathToFileURL(path.join(ROOT, suite.script))
      await import(`${fileUrl.href}?run=${Date.now()}`)
      return {
        name: suite.name,
        code: process.exitCode || 0,
        signal: null,
        durationMs: Date.now() - startedAt,
      }
    } catch (error) {
      console.error(`Failed to run ${suite.name}: ${error.message}`)
      return {
        name: suite.name,
        code: 1,
        signal: null,
        durationMs: Date.now() - startedAt,
      }
    } finally {
      process.exitCode = 0
    }
  })()
}

function seconds(ms) {
  return Math.round((ms / 1000) * 10) / 10
}

async function main() {
  console.log(`BASE_URL=${process.env.BASE_URL || 'http://127.0.0.1:47309/service/v1'}`)
  const startedAt = Date.now()
  const results = []

  for (const suite of suites) {
    results.push(await runSuite(suite))
  }

  const failed = results.filter((row) => row.code !== 0)
  console.log('\n=== SUMMARY ===')
  for (const row of results) {
    const status = row.code === 0 ? 'PASS' : 'FAIL'
    console.log(`${status}  ${row.name}  ${seconds(row.durationMs)}s`)
  }
  console.log(`TOTAL ${results.length} suite(s), FAILED ${failed.length}, TIME ${seconds(Date.now() - startedAt)}s`)

  process.exitCode = failed.length ? 1 : 0
}

await main()
