// The site runs Lunchbox one of two ways:
// - connected to your own Lunchbox, running on your computer at home or in your Cloud Shell, with
//   Claude Code and your subscription and your files there (server/), or
// - on its own in this tab (web/local.ts), with API keys.
// Links that ./lunchbox prints carry the computer's key after the #, which browsers never send to
// GitHub. A device that has opened one finds that computer by itself afterwards (web/finder.ts).
import { find, remember } from './finder'

const hash = new URLSearchParams(location.hash.slice(1))
if (hash.has('connect') || hash.has('pair') || hash.has('local')) history.replaceState(null, '', location.pathname + location.search)
if (hash.has('connect')) {
  const key = hash.get('key') ?? ''
  remember(key)
  sessionStorage.setItem('lb-connect', JSON.stringify({ base: hash.get('connect'), key }))
}
if (hash.has('pair')) remember(hash.get('pair') ?? '')
if (hash.has('local')) { sessionStorage.removeItem('lb-connect'); sessionStorage.setItem('lb-local', '1') }

const boot = document.getElementById('lb-boot')
const fail = (e: unknown) => {
  console.error(e)
  if (boot) boot.textContent = `Lunchbox could not start: ${(e as Error).message}`
}

function toast(text: string) {
  const t = document.createElement('div')
  t.textContent = text
  t.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9999;padding:7px 14px;border-radius:9px;background:#1b1a18;color:#f2f0ea;font:12px "IBM Plex Mono",ui-monospace,monospace;box-shadow:0 8px 30px rgba(0,0,0,.35);transition:opacity .4s'
  document.body.appendChild(t)
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 500) }, 4000)
}

async function connectTo(base: string, key: string, name?: string, kind?: string) {
  if (boot) boot.textContent = 'Connecting to your Lunchbox…'
  const { startBridge } = await import('../server/ui/bridge')
  // A found computer that stops answering may have moved to a new address: look again.
  await startBridge({ base, key, lost: () => { sessionStorage.removeItem('lb-connect'); location.reload() } })
  await import('../src/main')
  boot?.remove()
  const { markUsed } = await import('./cloudshell')
  if (kind === 'cloudshell') markUsed()
  if (name) toast(kind === 'cloudshell' ? 'Connected to your Lunchbox in Cloud Shell' : `Connected to your Lunchbox on ${name}`)
}

async function local(running = false) {
  const { boot: start } = await import('./local')
  await start()
  const { offer } = await import('./cloudshell')
  offer(running)
}

async function main() {
  const saved = sessionStorage.getItem('lb-connect')
  if (saved) {
    const { base, key } = JSON.parse(saved) as { base: string; key: string }
    return connectTo(base, key)
  }
  if (!sessionStorage.getItem('lb-local')) {
    if (boot) boot.textContent = 'Looking for your Lunchbox…'
    const f = await find().catch(() => null)
    if (f) return connectTo(f.url, f.key, f.name, f.kind)
    const { computers } = await import('./finder')
    return local(computers().length > 0)
  }
  return local()
}

main().catch(fail)
