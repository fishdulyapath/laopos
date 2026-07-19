import { spawn } from 'node:child_process'

const env = {
  ...process.env,
  VITE_ELECTRON: 'true',
  VITE_BASE_PATH: './',
  VITE_API_BASE_URL: process.env.LAOPOS_API_BASE_URL || process.env.VITE_API_BASE_URL || 'http://45.122.49.250:8092/service/v1',
}

const child = spawn('npx', ['vite', 'build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env,
})

child.on('exit', (code) => {
  process.exit(code ?? 0)
})
