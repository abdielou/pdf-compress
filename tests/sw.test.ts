// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

/**
 * Loads public/sw.js with stubbed service-worker globals and captures
 * the registered event handlers so tests can dispatch synthetic events.
 */
const handlers = new Map<string, Function>()
const ORIGIN = 'https://example.test'

beforeAll(async () => {
  vi.stubGlobal('self', {
    addEventListener: (type: string, h: Function) => handlers.set(type, h),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
    location: { origin: ORIGIN },
  })
  vi.stubGlobal('caches', {
    match: vi.fn(),
    open: vi.fn(),
    keys: vi.fn().mockResolvedValue([]),
  })
  vi.stubGlobal('fetch', vi.fn())
  await import('../public/sw.js')
})

beforeEach(() => {
  vi.mocked(caches.match).mockReset()
  vi.mocked(caches.open).mockReset()
  vi.mocked(caches.open).mockResolvedValue({ put: vi.fn() } as unknown as Cache)
  vi.mocked(fetch).mockReset()
})

function dispatchFetch(request: { method: string; url: string }) {
  let captured: Promise<Response> | undefined
  const event = {
    request,
    respondWith: (p: Promise<Response>) => {
      captured = p
    },
  }
  handlers.get('fetch')!(event)
  return captured
}

describe('Fix 6: service worker offline fallback', () => {
  it('returns a real Response when cache misses and network fails', async () => {
    vi.mocked(caches.match).mockResolvedValue(undefined)
    vi.mocked(fetch).mockRejectedValue(new TypeError('network down'))

    const promise = dispatchFetch({ method: 'GET', url: `${ORIGIN}/app.js` })
    expect(promise).toBeDefined()

    const response = await promise!
    expect(response).toBeInstanceOf(Response)
    expect(response.status).toBe(503)
  })

  it('serves the cached response when available', async () => {
    const cached = new Response('cached-body')
    vi.mocked(caches.match).mockResolvedValue(cached)
    vi.mocked(fetch).mockRejectedValue(new TypeError('network down'))

    const response = await dispatchFetch({ method: 'GET', url: `${ORIGIN}/app.js` })!
    expect(response).toBe(cached)
  })

  it('passes network response through on cache miss', async () => {
    const fresh = new Response('fresh-body', { status: 200 })
    vi.mocked(caches.match).mockResolvedValue(undefined)
    vi.mocked(fetch).mockResolvedValue(fresh)

    const response = await dispatchFetch({ method: 'GET', url: `${ORIGIN}/app.js` })!
    expect(response).toBe(fresh)
  })

  it('ignores non-GET requests', () => {
    const promise = dispatchFetch({ method: 'POST', url: `${ORIGIN}/app.js` })
    expect(promise).toBeUndefined()
  })

  it('ignores cross-origin requests', () => {
    const promise = dispatchFetch({ method: 'GET', url: 'https://other.test/x.js' })
    expect(promise).toBeUndefined()
  })
})
