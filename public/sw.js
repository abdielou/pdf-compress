const CACHE_NAME = 'pdf-resize-v2'

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  )
})

const OFFLINE_RESPONSE = () => new Response('Offline', {
  status: 503,
  statusText: 'Service Unavailable',
  headers: { 'Content-Type': 'text/plain' },
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Only cache same-origin GET requests
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) {
    return
  }

  // Navigations are network-first so a new deploy is picked up on the next
  // reload; cache is the offline fallback only
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
        }
        return response
      }).catch(() =>
        caches.match(request).then((cached) => cached || OFFLINE_RESPONSE())
      )
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request).then((response) => {
        // Cache valid responses
        if (response.ok) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
        }
        return response
      }).catch(() => {
        // Network failed: serve cache, or a real offline response
        // (respondWith must never resolve to undefined)
        return cached || OFFLINE_RESPONSE()
      })

      // Return cached immediately, update in background (stale-while-revalidate)
      return cached || fetchPromise
    })
  )
})
