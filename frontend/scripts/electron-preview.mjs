import { spawn } from 'node:child_process'

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      ...options,
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`))
    })
  })
}

const apiBaseUrl = process.env.LAOPOS_API_BASE_URL
  || process.env.BIZSUIT_API_BASE_URL
  || process.env.VITE_API_BASE_URL
  || 'http://127.0.0.1:47309/service/v1'

const env = {
  ...process.env,
  VITE_ELECTRON: 'true',
  VITE_BASE_PATH: './',
  VITE_API_BASE_URL: apiBaseUrl,
  BIZSUIT_API_BASE_URL: apiBaseUrl,
  LAOPOS_API_BASE_URL: apiBaseUrl,
}

try {
  await run('npx', ['vite', 'build'], { env })
  await run('npx', ['electron', '.'], { env })
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
