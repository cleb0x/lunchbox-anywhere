// Serves files from Lunchbox's browser file system at <app>/__fs/<path>, so pages agents build
// can be shown in the Lunchbox browser. The files live in the open Lunchbox tab, which is asked
// for each one.
const waiting = new Map()

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('message', (e) => {
  const m = e.data
  if (!m || !m.id || !waiting.has(m.id)) return
  waiting.get(m.id)(m)
  waiting.delete(m.id)
})

const scope = new URL(self.registration.scope).pathname
const prefix = scope + '__fs/'

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (url.origin !== location.origin || !url.pathname.startsWith(prefix)) return
  const path = '/' + url.pathname.slice(prefix.length).split('/').map(decodeURIComponent).join('/')
  e.respondWith((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // The app's own page holds the files; pages shown inside it are under __fs and do not.
    const owner = all.find((c) => !new URL(c.url).pathname.startsWith(prefix))
    if (!owner) return new Response('Open Lunchbox to see this page.', { status: 503, headers: { 'content-type': 'text/plain' } })
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36)
    const r = await new Promise((done) => {
      waiting.set(id, done)
      owner.postMessage({ kind: 'lb-fs', id, path })
      setTimeout(() => { if (waiting.delete(id)) done({ status: 504, type: 'text/plain', body: 'Lunchbox did not answer in time' }) }, 15000)
    })
    return new Response(r.body, { status: r.status, headers: { 'content-type': r.type || 'application/octet-stream', 'cache-control': 'no-store' } })
  })())
})
