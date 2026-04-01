import { defineConfig } from 'vitest/config'
import wasm from 'vite-plugin-wasm'

export default defineConfig({
  plugins: [wasm()],
  test: {
    testTimeout: 60000,
    pool: 'forks',
    forks: {
      singleFork: true,
    },
    // jsdom environment applied per-file via @vitest-environment jsdom comment
  },
})
