import { defineConfig } from 'vite'
import wasm from 'vite-plugin-wasm'
import { execSync } from 'node:child_process'

let appVersion = 'dev'
try {
  appVersion = execSync('git rev-parse --short HEAD').toString().trim()
} catch {
  // No git available (e.g. tarball build): keep 'dev'
}

export default defineConfig({
  base: '/pdf-compress/',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [wasm()],
  worker: {
    plugins: () => [wasm()],
  },
  optimizeDeps: {
    exclude: ['@jspawn/ghostscript-wasm'],
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
})
