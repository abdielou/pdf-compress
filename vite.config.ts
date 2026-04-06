import { defineConfig } from 'vite'
import wasm from 'vite-plugin-wasm'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/pdf-compress/',
  plugins: [
    wasm(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,wasm,data}'],
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
      },
      manifest: {
        name: 'Safe PDF Resize',
        short_name: 'PDF Resize',
        description: 'Compress PDF files directly in your browser. No uploads, no servers — files never leave your device.',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/pdf-compress/',
        scope: '/pdf-compress/',
        icons: [
          {
            src: 'icon-192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'icon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'icon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
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
