const CACHE_NAME = 'pdf-resize-v1'

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

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Only cache same-origin GET requests
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) {
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
        // Network failed, cached will be returned below if available
        return cached
      })

      // Return cached immediately, update in background (stale-while-revalidate)
      return cached || fetchPromise
    })
  )
})
