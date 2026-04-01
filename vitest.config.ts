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
    environmentMatchGlobs: [
      ['tests/drop-zone.test.ts', 'jsdom'],
      ['tests/file-validation.test.ts', 'jsdom'],
      ['tests/target-config.test.ts', 'jsdom'],
      ['tests/progress.test.ts', 'jsdom'],
      ['tests/app.test.ts', 'jsdom'],
    ],
  },
})
