import { defineConfig } from 'vite'
import wasm from 'vite-plugin-wasm'

export default defineConfig({
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
