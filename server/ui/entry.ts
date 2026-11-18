// Server mode's page: the bridge to the engine on the same address, then the desktop window.
import { startBridge } from './bridge'

// The key comes in the link ./lunchbox prints, after the #, which never leaves the browser.
const key = new URLSearchParams(location.hash.slice(1)).get('key') ?? sessionStorage.getItem('lb-key') ?? ''
if (key) { sessionStorage.setItem('lb-key', key); history.replaceState(null, '', location.pathname + location.search) }

startBridge({ key })
  .then(() => import('../../src/main'))
  .then(() => document.getElementById('lb-boot')?.remove())
  .catch((e) => {
    const el = document.getElementById('lb-boot')
    if (el) el.textContent = `Lunchbox could not start: ${(e as Error).message}`
  })
