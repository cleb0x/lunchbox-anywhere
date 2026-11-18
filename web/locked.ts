// Folders linked on an earlier visit. Chrome may want the person to allow access again, which can
// only be asked from a click, so a small bar offers it until they do.
import * as vfs from './vfs'

export function lockedFolders() {
  const locked = vfs.mountList().filter((m) => m.state === 'locked')
  if (!locked.length) return
  const bar = document.createElement('div')
  bar.setAttribute('role', 'status')
  bar.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9999;display:flex;gap:10px;align-items:center;padding:8px 8px 8px 14px;border-radius:10px;background:#1b1a18;color:#f2f0ea;font:12px "IBM Plex Mono",ui-monospace,monospace;box-shadow:0 8px 30px rgba(0,0,0,.35)'
  const text = document.createElement('span')
  text.textContent = locked.length === 1 ? `Allow Lunchbox to use the folder ${locked[0].name} again` : `Allow Lunchbox to use ${locked.length} linked folders again`
  const allow = document.createElement('button')
  allow.textContent = 'Allow'
  allow.style.cssText = 'font:inherit;padding:5px 12px;border-radius:7px;border:0;background:#f2f0ea;color:#0d0d0c;cursor:pointer'
  const later = document.createElement('button')
  later.textContent = 'Later'
  later.style.cssText = 'font:inherit;padding:5px 10px;border-radius:7px;border:0;background:transparent;color:#a8a59d;cursor:pointer'
  allow.onclick = async () => { await vfs.reconnect(); bar.remove(); window.lb?.call('agents:refresh').catch(() => {}) }
  later.onclick = () => bar.remove()
  bar.append(text, allow, later)
  document.body.appendChild(bar)
}
