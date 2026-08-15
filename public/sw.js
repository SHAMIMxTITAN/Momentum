// Hand-rolled instead of Workbox: assets are content-hashed, so the rules are trivial.
// /assets/* filenames change on every build -> cache-first is always safe.
// Everything else (index.html, manifest, icons) -> network-first so a deploy lands immediately.
const CACHE = 'buy-next-v1'

// The page registers us after it has already fetched its own assets, so nothing would be
// cached until the second visit. Read index.html and pull the hashed asset URLs out of it —
// no build-time manifest needed, since the filenames are right there in the markup.
self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      const res = await fetch('./index.html', { cache: 'reload' })
      const html = await res.clone().text()
      await cache.put('./index.html', res)
      await cache.addAll([...html.matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)].map((m) => m[1]))
    })().catch(() => {}),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const { request } = e
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== location.origin) return // never touch api.github.com

  if (url.pathname.includes('/assets/')) {
    e.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((res) => {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(request, copy))
            return res
          }),
      ),
    )
    return
  }

  e.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(request, copy))
        return res
      })
      .catch(() => caches.match(request).then((hit) => hit ?? caches.match('./index.html'))),
  )
})
