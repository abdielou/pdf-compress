// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setupServiceWorker } from '../src/pwa'

describe('Service worker setup', () => {
  let register: ReturnType<typeof vi.fn>
  let unregister: ReturnType<typeof vi.fn>
  let cacheDelete: ReturnType<typeof vi.fn>

  beforeEach(() => {
    register = vi.fn().mockResolvedValue(undefined)
    unregister = vi.fn().mockResolvedValue(true)
    cacheDelete = vi.fn().mockResolvedValue(true)
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register,
        getRegistrations: vi.fn().mockResolvedValue([{ unregister }]),
      },
      configurable: true,
    })
    vi.stubGlobal('caches', {
      keys: vi.fn().mockResolvedValue(['pdf-resize-v1']),
      delete: cacheDelete,
    })
  })

  it('production: registers the service worker under the app base', () => {
    setupServiceWorker(true)
    expect(register).toHaveBeenCalledWith(`${import.meta.env.BASE_URL}sw.js`)
  })

  it('dev: does not register, and removes stale registrations and caches', async () => {
    setupServiceWorker(false)
    await new Promise((r) => setTimeout(r, 0))

    expect(register).not.toHaveBeenCalled()
    expect(unregister).toHaveBeenCalled()
    expect(cacheDelete).toHaveBeenCalledWith('pdf-resize-v1')
  })
})
