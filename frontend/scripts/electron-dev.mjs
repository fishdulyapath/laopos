import { spawn } from 'node:child_process'

const host = '127.0.0.1'
const port = process.env.ELECTRON_DEV_PORT || '5178'
const startUrl = `http://${host}:${port}/`

function run(command, args, options = {}) {
  return spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  })
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForVite(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // Vite is still starting.
    }
    await wait(250)
  }
  throw new Error(`Vite did not start at ${url}`)
}

const env = {
  ...process.env,
  VITE_ELECTRON: 'true',
  VITE_BASE_PATH: '/',
}

const vite = run('npm', ['run', 'dev', '--', '--host', host, '--port', port], { env })

const shutdown = () => {
  if (!vite.killed) vite.kill()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('exit', shutdown)

try {
  await waitForVite(startUrl)
  const electron = run('npx', ['electron', '.'], {
    env: {
      ...env,
      ELECTRON_START_URL: startUrl,
    },
  })
  electron.on('exit', (code) => {
    shutdown()
    process.exit(code ?? 0)
  })
} catch (error) {
  shutdown()
  console.error(error.message)
  process.exit(1)
}
