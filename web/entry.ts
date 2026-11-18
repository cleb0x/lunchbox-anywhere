// Starts the browser version: the Node stand-ins first, then the file system, then the engine,
// and only then the window from src/, which finds window.lb as it would in the desktop app.
import './shims/process'
import * as vfs from './vfs'

// Node timers can be unref'd so they do not keep the process alive; a browser has nothing to keep
// alive, so the call is accepted and does nothing.
const proto = Number.prototype as unknown as Record<string, unknown>
proto.unref ??= function (this: number) { return this }
proto.ref ??= function (this: number) { return this }
proto.hasRef ??= () => false

// Anthropic answers a page directly only when it says it knows the key is in the page. The key is
// the person's own and stays in their browser, which is the point.
const nativeFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (/^https:\/\/api\.anthropic\.com\//.test(url)) {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    headers.set('anthropic-dangerous-direct-browser-access', 'true')
    return nativeFetch(input, { ...init, headers })
  }
  return nativeFetch(input, init)
}

async function boot() {
  // For tests and for looking into the file system from the developer tools.
  ;(window as unknown as { __lunchbox: unknown }).__lunchbox = { vfs }
  await vfs.boot()
  await vfs.restoreMounts().catch((e) => console.warn('Linked folders could not be restored', e))
  const { serveFiles } = await import('./browser')
  serveFiles()
  const { startApp } = await import('./main')
  const { ready } = await startApp()
  ready.catch((e) => console.error(e))
  await import('../src/main')
  document.getElementById('lb-boot')?.remove()
  const { lockedFolders } = await import('./locked')
  lockedFolders()
}

boot().catch((e) => {
  console.error(e)
  const el = document.getElementById('lb-boot')
  if (el) el.textContent = `Lunchbox could not start: ${(e as Error).message}`
})
