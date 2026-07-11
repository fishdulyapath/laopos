import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

const appPackage = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendTarget = env.VITE_DEV_PROXY_TARGET || 'http://localhost:47300'
  const base = env.VITE_BASE_PATH || '/'

  return {
    base,
    plugins: [vue()],
    define: {
      __APP_VERSION__: JSON.stringify(appPackage.version),
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      proxy: {
        '/service': {
          target: backendTarget,
          changeOrigin: true,
        },
        '/bizsuitservice': {
          target: backendTarget,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/bizsuitservice/, ''),
        },
      },
    },
  }
})
