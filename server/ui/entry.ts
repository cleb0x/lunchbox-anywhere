// The window's bridge in server mode: window.lb over a WebSocket to the engine (server/main.ts),
// with the few things only a page can do (choose files, save downloads, notifications, the
// clipboard) done here. Then the desktop window from src/ starts, unchanged.
type Pending = { ok: (v: unknown) => void; no: (e: Error) => void }

const url = new URL('./ws', location.href)
url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'

let ws: WebSocket
let next = 1
const pending = new Map<number, Pending>()
const listeners = new Map<string, Set<(v: unknown) => void>>()
const queue: string[] = []
const uploads = new Set<Promise<unknown>>()
let uploadsDir = ''

const setStatus = (text: string | null) => {
  let el = document.getElementById('lb-status')
  if (!text) { el?.remove(); return }
  if (!el) {
    el = document.createElement('div')
    el.id = 'lb-status'
    el.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:9999;padding:7px 14px;border-radius:9px;background:#1b1a18;color:#f2f0ea;font:12px "IBM Plex Mono",ui-monospace,monospace;box-shadow:0 8px 30px rgba(0,0,0,.35)'
    document.body.appendChild(el)
  }
  el.textContent = text
}

function connect(): Promise<void> {
  return new Promise((ready) => {
    ws = new WebSocket(url)
    ws.onopen = () => { setStatus(null); for (const m of queue.splice(0)) ws.send(m); ready() }
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data))
      if (m.ev) { local(m.ev, m.value); listeners.get(m.ev)?.forEach((f) => f(m.value)); return }
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      if (m.error) p.no(new Error(m.error))
      else p.ok(m.value)
    }
    // The engine keeps running when the page loses its connection; the page finds it again.
    ws.onclose = () => {
      setStatus('Reconnecting to Lunchbox…')
      setTimeout(() => { void connect() }, 1500)
    }
  })
}

const raw = (ch: string, args: unknown[]) => new Promise<any>((ok, no) => {
  const id = next++
  pending.set(id, { ok, no })
  const m = JSON.stringify({ id, ch, args })
  if (ws?.readyState === WebSocket.OPEN) ws.send(m)
  else queue.push(m)
})

// --- Files ---------------------------------------------------------------------------------------

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
function local(ev: string, v: any) {
  if (ev === 'lb:download' || ev === 'lb:open') {
    const blob = new Blob([b64(v.data)], { type: v.type })
    const href = URL.createObjectURL(blob)
    if (ev === 'lb:open') window.open(href, '_blank', 'noopener')
    else { const a = document.createElement('a'); a.href = href; a.download = v.name; document.body.appendChild(a); a.click(); a.remove() }
    setTimeout(() => URL.revokeObjectURL(href), 120_000)
  }
  if (ev === 'lb:notify' && document.visibilityState !== 'visible' && typeof Notification !== 'undefined') {
    const show = () => { const n = new Notification(v.title, { body: v.body, icon: './icon.png' }); n.onclick = () => { window.focus(); listeners.get('open-room')?.forEach((f) => f(v.room)); n.close() } }
    if (Notification.permission === 'granted') show()
    else if (Notification.permission === 'default') void Notification.requestPermission().then((p) => p === 'granted' && show())
  }
}

const clean = (name: string) => name.normalize('NFKD').replace(/[^\w.-]+/g, '-').slice(-80) || 'file'
function upload(f: File) {
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  const job = fetch(`./upload?name=${encodeURIComponent(f.name)}&id=${id}`, { method: 'POST', body: f }).finally(() => uploads.delete(job))
  uploads.add(job)
  return `${uploadsDir}/${id}/${clean(f.name)}`
}

function choose(o: { multiple?: boolean; accept?: string } = {}) {
  return new Promise<File[]>((done) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = !!o.multiple
    if (o.accept) input.accept = o.accept
    input.style.display = 'none'
    input.onchange = () => { done(Array.from(input.files ?? [])); input.remove() }
    input.oncancel = () => { done([]); input.remove() }
    document.body.appendChild(input)
    input.click()
  })
}

// A folder on the cloud computer, chosen from a small list the way a folder dialog would.
function pickFolder(): Promise<string | null> {
  return new Promise((done) => {
    const scrim = document.createElement('div')
    scrim.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.45);display:grid;place-items:center;font:13px "IBM Plex Mono",ui-monospace,monospace'
    const box = document.createElement('div')
    box.setAttribute('role', 'dialog')
    box.style.cssText = 'width:min(520px,92vw);max-height:70vh;display:flex;flex-direction:column;background:#151514;color:#f2f0ea;border:1px solid #2a2926;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.5)'
    scrim.appendChild(box)
    document.body.appendChild(scrim)
    const finish = (v: string | null) => { scrim.remove(); done(v) }
    const btn = (text: string, primary = false) => { const b = document.createElement('button'); b.textContent = text; b.style.cssText = `font:inherit;padding:6px 12px;border-radius:7px;cursor:pointer;border:${primary ? '0' : '1px solid #2a2926'};background:${primary ? '#f2f0ea' : 'transparent'};color:${primary ? '#0d0d0c' : 'inherit'}`; return b }
    const show = async (path?: string) => {
      const r = await raw('folders', [path]) as { path: string; parent: string; dirs: string[] }
      box.replaceChildren()
      const head = document.createElement('div')
      head.style.cssText = 'padding:14px 16px;border-bottom:1px solid #2a2926;word-break:break-all'
      head.textContent = r.path
      const list = document.createElement('div')
      list.style.cssText = 'overflow:auto;flex:1;padding:6px'
      const row = (label: string, to: string) => { const b = document.createElement('button'); b.textContent = label; b.style.cssText = 'display:block;width:100%;text-align:left;font:inherit;color:inherit;background:none;border:0;padding:7px 10px;border-radius:6px;cursor:pointer'; b.onmouseenter = () => (b.style.background = '#22211e'); b.onmouseleave = () => (b.style.background = 'none'); b.onclick = () => show(to); list.appendChild(b) }
      if (r.parent !== r.path) row('../', r.parent)
      for (const d of r.dirs) row(`${d}/`, `${r.path}/${d}`)
      const foot = document.createElement('div')
      foot.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;padding:12px 16px;border-top:1px solid #2a2926'
      const make = btn('New folder'), cancel = btn('Cancel'), ok = btn('Choose', true)
      make.onclick = async () => { const n = prompt('Folder name'); if (n) show(await raw('mkdir', [`${r.path}/${n.replace(/\//g, '-')}`])) }
      cancel.onclick = () => finish(null)
      ok.onclick = () => finish(r.path)
      foot.append(make, cancel, ok)
      box.append(head, list, foot)
    }
    scrim.onclick = (e) => { if (e.target === scrim) finish(null) }
    void show()
  })
}

const KEYS: Record<string, RegExp> = { openrouter: /^sk-or-[\w-]{20,200}$/, gemini: /^AIza[\w-]{30,60}$/, groq: /^gsk_\w{20,200}$/, nvidia: /^nvapi-[\w-]{20,200}$/ }

// Channels the page answers itself; everything else goes to the engine.
const HERE: Record<string, (...a: any[]) => unknown> = {
  attach: async () => (await choose({ multiple: true })).map(upload),
  pick: () => pickFolder(),
  'packs:import': async () => { const [f] = await choose({ accept: '.json,application/json' }); if (!f) return null; const p = upload(f); await Promise.all([...uploads]); return raw('packs:import:file', [p]) },
  'skills:import': async () => { const [f] = await choose({ accept: '.json,application/json' }); if (!f) return null; const p = upload(f); await Promise.all([...uploads]); return raw('skills:import:file', [p]) },
  'clipboard:key': async (provider: string) => { const t = (await navigator.clipboard.readText().catch(() => '')).trim(); return KEYS[provider]?.test(t) ? t : '' },
  'image:copy': async (data: string) => { const blob = await (await fetch(data)).blob(); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); return true },
}

window.lb = {
  call: async (ch: string, ...args: unknown[]) => {
    if (HERE[ch]) return HERE[ch](...args)
    // A message waits for the files attached to it.
    if (uploads.size) await Promise.all([...uploads])
    return raw(ch, args)
  },
  on: (ch: string, fn: (v: unknown) => void) => {
    let set = listeners.get(ch)
    if (!set) listeners.set(ch, (set = new Set()))
    set.add(fn)
    return () => { set!.delete(fn) }
  },
  pathOf: (f: File) => (uploadsDir ? upload(f) : ''),
}

async function boot() {
  await connect()
  const env = await raw('env', []) as { uploads?: string }
  uploadsDir = env.uploads ?? ''
  await import('../../src/main')
  document.getElementById('lb-boot')?.remove()
}

boot().catch((e) => {
  const el = document.getElementById('lb-boot')
  if (el) el.textContent = `Lunchbox could not start: ${(e as Error).message}`
})
export {}
