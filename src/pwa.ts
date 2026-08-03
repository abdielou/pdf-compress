/**
 * Service worker lifecycle.
 *
 * Production: register the offline-caching worker.
 * Dev: never register, and actively remove stale registrations and caches.
 * A worker registered during development caches Vite dev modules, which
 * can serve mixed old/new module graphs (seen as a duplicated UI).
 */
export function setupServiceWorker(isProd: boolean = import.meta.env.PROD): void {
  if (!('serviceWorker' in navigator)) return

  if (isProd) {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
    return
  }

  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) void registration.unregister()
  })
  if (typeof caches !== 'undefined') {
    void caches.keys().then((keys) => {
      for (const key of keys) void caches.delete(key)
    })
  }
}
