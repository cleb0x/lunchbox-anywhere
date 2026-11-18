// The Lunchbox browser in a browser tab. The desktop app draws real browser views over its window;
// here each page is a frame laid over the same hole in the window, so it looks and behaves the
// same: the person has a page, every agent gets its own page per room, and the agent tools work
// on them.
//
// Pages from the room's folder are served to the frames by a service worker (web/public/sw.js)
// from the browser's file system, so they are on Lunchbox's own address and agents can read,
// click, type, run checks and take screenshots in them. Other websites open too when they allow
// being shown inside another page, but a browser keeps their contents from other pages, so agents
// can look at them only through what the person sees.
import { existsSync, lstatSync, mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { toPng } from 'html-to-image'
import axeSource from 'axe-core/axe.min.js?raw'
import type { Tool } from '../electron/hands'
import { evict, MAX_AGENT_TABS, YOU } from '../shared/tabs'
import { AXE_RUN, MEASURE, report, type Axe, type Measured } from '../electron/audit'
import { describeModel, imagePage, modelPage, type View } from '../electron/viewer'
import * as vfs from './vfs'

export type TabState = { id: string; who: string; room?: string; url: string; title: string; loading: boolean; back: boolean; forward: boolean; device: Device; action?: string; busy: boolean }
export type BrowserState = { tabs: TabState[]; active: string | null; shown: boolean }
export type Device = 'desktop' | 'tablet' | 'phone'
type Rect = { x: number; y: number; width: number; height: number }

const READ_LIMIT = 24000

// Where the service worker serves the browser file system: <app>/__fs/<path>.
export const FS_PREFIX = new URL('./__fs', location.href).pathname
export const fsUrl = (abs: string) => `${FS_PREFIX}${abs.split('/').map(encodeURIComponent).join('/')}`
const fsPath = (href: string) => {
  try {
    const u = new URL(href, location.href)
    if (u.origin !== location.origin || !u.pathname.startsWith(FS_PREFIX + '/')) return null
    return decodeURIComponent(u.pathname.slice(FS_PREFIX.length))
  } catch { return null }
}

const OUTLINE = `(() => {
  const out = []; let n = 0; let size = 0
  document.querySelectorAll('[data-lb-ref]').forEach((e) => e.removeAttribute('data-lb-ref'))
  const usable = (e) => e.matches('a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[contenteditable=true],[onclick]')
  const visible = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
  const label = (e) => (e.getAttribute('aria-label') || e.innerText || e.value || e.placeholder || e.title || e.alt || e.name || '').replace(/\\s+/g, ' ').trim().slice(0, 120)
  const push = (line) => { if (size < ${READ_LIMIT}) { out.push(line); size += line.length } }
  const walk = (node, depth) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { const t = c.textContent.replace(/\\s+/g, ' ').trim(); if (t && t.length > 1) push(t); continue }
      if (c.nodeType !== 1 || ['SCRIPT','STYLE','NOSCRIPT','SVG','TEMPLATE'].includes(c.tagName)) continue
      if (!visible(c)) continue
      if (usable(c)) {
        const ref = ++n; c.setAttribute('data-lb-ref', ref)
        const kind = c.tagName === 'A' ? 'link' : c.tagName === 'INPUT' ? (c.type || 'text') + ' field' : c.tagName === 'TEXTAREA' ? 'text area' : c.tagName === 'SELECT' ? 'select' : 'button'
        push('[' + ref + '] ' + kind + ': ' + (label(c) || '(no label)') + (c.tagName === 'A' ? ' -> ' + c.getAttribute('href') : '') + (c.value && c.tagName !== 'BUTTON' ? ' = "' + String(c.value).slice(0, 80) + '"' : ''))
        if (c.tagName === 'A' || c.tagName === 'BUTTON') continue
      }
      if (/^H[1-6]$/.test(c.tagName)) { push('#'.repeat(+c.tagName[1]) + ' ' + label(c)); continue }
      walk(c, depth + 1)
    }
  }
  walk(document.body || document.documentElement, 0)
  return { title: document.title, url: location.href, text: out.join('\\n'), refs: n, truncated: size >= ${READ_LIMIT} }
})()`

const within = <T,>(job: Promise<T>, ms: number, what: string) =>
  Promise.race([job, new Promise<never>((_, no) => setTimeout(() => no(new Error(`${what} took longer than ${ms / 1000} seconds`)), ms))])
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Tab = {
  id: string; who: string; room?: string; frame: HTMLIFrameElement; device: Device; action?: string; busy: boolean; working: boolean; used: number
  queue: Promise<unknown>; history: string[]; at: number; url: string; title: string; loading: boolean; errors: string[]
}

// What a frame shows, as the address bar should say it: a file in the folder by its path.
const shown = (href: string) => {
  const p = fsPath(href)
  return p ? `file://${p}` : href === 'about:blank' ? '' : href
}

const pngData = (dataUrl: string) => Uint8Array.from(atob(dataUrl.split(',')[1] ?? ''), (c) => c.charCodeAt(0))

export class Browser {
  private tabs = new Map<string, Tab>()
  private active: string | null = null
  private bounds: Rect = { x: 0, y: 0, width: 0, height: 0 }
  private placed = false
  private layer: HTMLDivElement

  constructor(_win: () => unknown, private emit: (channel: string, payload: unknown) => void) {
    this.layer = document.createElement('div')
    this.layer.className = 'lb-web-browser'
    this.layer.style.cssText = 'position:fixed;z-index:50;display:none;overflow:hidden;background:var(--bg, #fff);border-radius:inherit'
    document.body.appendChild(this.layer)
  }

  private create(id: string, who: string, room?: string) {
    const frame = document.createElement('iframe')
    frame.setAttribute('allow', 'clipboard-write; fullscreen')
    frame.setAttribute('referrerpolicy', 'no-referrer')
    frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff;display:none'
    const tab: Tab = { id, who, room, frame, device: 'desktop', busy: false, working: false, used: Date.now(), queue: Promise.resolve(), history: [], at: -1, url: '', title: '', loading: false, errors: [] }
    frame.addEventListener('load', () => this.landed(tab))
    this.layer.appendChild(frame)
    this.tabs.set(id, tab)
    this.layout()
    return tab
  }

  // A page finished loading: what it is now, and the agent hooks it needs.
  private landed(t: Tab) {
    t.loading = false
    const w = this.win(t)
    if (w) {
      const href = w.location.href
      if (href !== 'about:blank') {
        if (t.history[t.at] !== href) { t.history = t.history.slice(0, t.at + 1); t.history.push(href); t.at++ }
        t.url = href
      }
      t.title = w.document.title
      // Errors on the page are kept for the agent, as the desktop app reads them from the console.
      const keep = (s: unknown) => { t.errors.push(String(s).slice(0, 200)); if (t.errors.length > 50) t.errors.shift() }
      w.addEventListener('error', (e) => keep((e as ErrorEvent).message))
      const orig = w.console.error.bind(w.console)
      w.console.error = (...a: unknown[]) => { keep(a.map(String).join(' ')); orig(...a) }
      // Links that leave for another site open in a new browser tab: the person can see them there.
      w.document.addEventListener('click', (e) => {
        const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
        if (a && a.target === '_blank') { e.preventDefault(); void this.load(t, a.href) }
      }, true)
      new MutationObserver(() => { if (t.title !== w.document.title) { t.title = w.document.title; this.changed() } }).observe(w.document.querySelector('title') ?? w.document.head ?? w.document.documentElement, { childList: true, subtree: true, characterData: true })
    }
    this.changed()
  }

  // The frame's window when its page is Lunchbox's own, which is when agents can work in it.
  private win(t: Tab): (Window & typeof globalThis) | null {
    try {
      const w = t.frame.contentWindow as (Window & typeof globalThis) | null
      if (!w) return null
      void w.location.href
      return w
    } catch { return null }
  }

  private mine() { return this.tabs.get(YOU) ?? this.create(YOU, YOU) }

  private current() {
    const t = this.active ? this.tabs.get(this.active) : undefined
    if (t) return t
    this.active = YOU
    return this.mine()
  }

  private agent(room: string, who: string) {
    const id = `${room}:${who}`
    const have = this.tabs.get(id)
    if (have) return have
    const out = evict([...this.tabs.values()])
    if (out === null) throw new Error(`${MAX_AGENT_TABS} browser pages are open and all of them are busy. Try again when one has finished.`)
    if (out) this.close(out)
    const tab = this.create(id, who, room)
    const front = this.active ? this.tabs.get(this.active) : undefined
    if (!front || (front.who === YOU && !front.busy && !front.url)) this.active = id
    this.layout()
    return tab
  }

  state(): BrowserState {
    const tabs = [...this.tabs.values()].map((t) => ({
      id: t.id, who: t.who, room: t.room, url: shown(t.url), title: t.url ? t.title : '', loading: t.loading,
      back: t.at > 0, forward: t.at < t.history.length - 1, device: t.device, action: t.action, busy: t.busy,
    }))
    return { tabs, active: this.active, shown: this.placed }
  }

  private changed() { this.emit('browser', this.state()) }

  place(bounds: Rect | null) {
    this.placed = !!bounds
    if (bounds) this.bounds = bounds
    this.layout()
    this.changed()
  }

  private layout() {
    const b = this.bounds
    const show = this.placed && b.width > 0
    // Out of sight the pages keep a desktop size off screen, so an agent reading one gets the page
    // as it would look, as the desktop app does for its hidden views.
    Object.assign(this.layer.style, show
      ? { left: `${b.x}px`, top: `${b.y}px`, width: `${b.width}px`, height: `${b.height}px`, visibility: 'visible', display: 'block' }
      : { left: '-20000px', top: '0px', width: '1280px', height: '800px', visibility: 'hidden', display: 'block' })
    for (const t of this.tabs.values()) {
      const front = show && t.id === this.active
      t.frame.style.display = 'block'
      t.frame.style.visibility = front ? 'visible' : 'hidden'
      t.frame.style.zIndex = front ? '1' : '0'
    }
  }

  select(id: string) {
    if (id !== YOU && !this.tabs.has(id)) return
    if (id === YOU) this.mine()
    this.active = id
    this.layout()
    this.changed()
  }

  close(id: string) {
    const t = this.tabs.get(id)
    if (!t) return
    this.tabs.delete(id)
    t.frame.remove()
    if (this.active === id) this.active = this.tabs.has(YOU) ? YOU : [...this.tabs.keys()].pop() ?? null
    this.layout()
    this.changed()
  }

  closeRoom(room: string) {
    for (const t of [...this.tabs.values()]) if (t.room === room) this.close(t.id)
  }

  // The start page lists dev servers running on the computer. A browser tab cannot look for them,
  // so it lists the pages in linked folders and in Lunchbox's own folder instead.
  async local() { return [] as { port: number; title: string }[] }

  setDevice(d: Device) {
    const t = this.current()
    t.device = d
    this.layout()
    this.changed()
  }

  open(url: string) { return this.load(this.current(), url) }

  // An address, a search, or a file: a path to an HTML page or picture in the browser file system.
  private target(u: string, workspace?: string): string | null {
    const s = u.trim()
    if (!s) return null
    if (/^file:\/\//i.test(s)) return fsUrl(decodeURIComponent(s.replace(/^file:\/\//i, '')))
    if (fsPath(s)) return s
    const asFile = s.startsWith('/') ? s : workspace ? resolve(workspace, s) : ''
    if (asFile && vfs.exists(asFile) && (s.startsWith('/') || s.startsWith('.') || /\.\w+$/.test(s) || vfs.get(asFile)?.kind === 'dir')) return fsUrl(asFile)
    if (/^(localhost|127\.\d+\.\d+\.\d+)(:\d+)?(\/|$)/i.test(s)) return `http://${s}`
    if (/^https?:\/\//i.test(s)) return s
    if (/^[a-z][\w+.-]*:/i.test(s) && !/^[\w.-]+:\d+/.test(s)) return null
    return /\s/.test(s) || !s.includes('.') ? `https://duckduckgo.com/?q=${encodeURIComponent(s)}` : `https://${s}`
  }

  private async load(tab: Tab, url: string, workspace?: string) {
    const target = this.target(url, workspace)
    if (!target) return shown(tab.url)
    if (/^http:\/\/(localhost|127\.)/i.test(target)) throw new Error('The browser version cannot reach servers on this computer. Open an HTML file in the room\'s folder instead, for example index.html.')
    tab.used = Date.now()
    tab.loading = true
    tab.errors = []
    tab.url = target
    tab.title = ''
    if (!fsPath(target)) { tab.history = tab.history.slice(0, tab.at + 1); tab.history.push(target); tab.at++ }
    this.changed()
    const done = new Promise<void>((r) => tab.frame.addEventListener('load', () => r(), { once: true }))
    tab.frame.src = target
    await within(done, 20000, 'Loading the page').catch(() => {})
    tab.loading = false
    this.changed()
    return shown(tab.url)
  }

  nav(kind: 'back' | 'forward' | 'reload' | 'stop') {
    const t = this.active ? this.tabs.get(this.active) : undefined
    if (!t) return
    if (kind === 'stop') { t.frame.src = 'about:blank'; t.loading = false; this.changed(); return }
    if (kind === 'reload') { const w = this.win(t); if (w) w.location.reload(); else t.frame.src = t.url; t.loading = true; this.changed(); return }
    const to = t.at + (kind === 'back' ? -1 : 1)
    if (to < 0 || to >= t.history.length) return
    t.at = to
    t.url = t.history[to]
    t.loading = true
    t.frame.src = t.url
    this.changed()
  }

  // The page's own developer tools are the browser's: Ctrl+Shift+I opens them on any frame.
  devtools() { throw new Error('Press Ctrl+Shift+I (or Cmd+Option+I on a Mac) to open the browser\'s developer tools.') }

  async screenshot(file: string) { return this.capture(this.current(), file) }

  // A picture of a page drawn by the page itself, which only Lunchbox's own pages allow.
  private async capture(t: Tab, file: string, size?: { width: number; height: number }) {
    const w = this.win(t)
    if (!w || !t.url) throw new Error('Screenshots work on pages from the room\'s folder. Websites keep their contents from other pages.')
    const doc = w.document.documentElement
    const width = size?.width ?? t.frame.clientWidth ?? 1280
    const height = size?.height ?? t.frame.clientHeight ?? 800
    const data = await within(toPng(doc, {
      width, height, canvasWidth: width, canvasHeight: height, pixelRatio: 1, cacheBust: false,
      backgroundColor: w.getComputedStyle(w.document.body ?? doc).backgroundColor || '#ffffff',
      style: { transform: `translateY(-${w.scrollY}px)` },
    }), 20000, 'Capturing the page')
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, pngData(data))
    return file
  }

  private drive<T>(room: string, who: string, action: string, job: (tab: Tab) => Promise<T>): Promise<T> {
    const tab = this.agent(room, who)
    const next = tab.queue.then(async () => {
      const now = this.agent(room, who)
      now.busy = now.working = true
      now.action = action
      now.used = Date.now()
      this.changed()
      try { return await job(now) } finally {
        now.working = false
        now.action = undefined
        now.used = Date.now()
        this.changed()
        setTimeout(() => { if (!now.action) { now.busy = false; this.changed() } }, 2500)
      }
    })
    tab.queue = next.catch(() => {})
    return next
  }

  private async settle(t: Tab) {
    const t0 = Date.now()
    while (t.loading && Date.now() - t0 < 15000) await sleep(120)
    const w = this.win(t)
    if (w?.document.fonts) await Promise.race([w.document.fonts.ready, sleep(2000)]).catch(() => {})
    await sleep(250)
  }

  private run<T>(t: Tab, code: string): T {
    const w = this.win(t)
    if (!w) throw new Error('This website does not let other pages read it, so agents cannot work in it here. The person can still see it. Pages from the room\'s folder can be read, clicked and checked.')
    return (w as unknown as { eval(c: string): T }).eval(code)
  }

  private async read(t: Tab) {
    await this.settle(t)
    type Outline = { title: string; url: string; text: string; refs: number; truncated: boolean }
    const o = this.run<Outline>(t, OUTLINE)
    return `${o.title}\n${shown(o.url)}\n\n${o.text}${o.truncated ? '\n\n(The page goes on; scroll or search with browser_find.)' : ''}`
  }

  private async click(t: Tab, ref: number) {
    const el = this.run<HTMLElement | null>(t, `document.querySelector('[data-lb-ref="${ref}"]')`)
    if (!el) throw new Error(`There is no [${ref}] on the page now. Read the page again to get fresh numbers.`)
    el.scrollIntoView({ block: 'center', inline: 'center' })
    const r = el.getBoundingClientRect()
    this.run(t, `(() => {
      const d = document.createElement('div')
      d.style.cssText = 'position:fixed;left:${r.left + r.width / 2 - 14}px;top:${r.top + r.height / 2 - 14}px;width:28px;height:28px;border-radius:50%;border:2px solid #f2f0ea;box-shadow:0 0 0 2px #0d0d0c;pointer-events:none;z-index:2147483647;transition:transform .5s cubic-bezier(.23,1,.32,1),opacity .5s'
      document.documentElement.appendChild(d)
      requestAnimationFrame(() => { d.style.transform = 'scale(1.8)'; d.style.opacity = '0' })
      setTimeout(() => d.remove(), 600)
    })()`)
    await sleep(160)
    const w = this.win(t)!
    const opts = { bubbles: true, cancelable: true, view: w, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 }
    el.dispatchEvent(new w.PointerEvent('pointerdown', opts))
    el.dispatchEvent(new w.MouseEvent('mousedown', opts))
    el.focus?.()
    el.dispatchEvent(new w.PointerEvent('pointerup', opts))
    el.dispatchEvent(new w.MouseEvent('mouseup', opts))
    el.click()
  }

  // The tools every agent in a room gets, as on the desktop.
  tools(who: string, workspace: string, room: string): Tool[] {
    const drive = <T,>(action: string, job: (tab: Tab) => Promise<T>) => this.drive(room, who, action, job)
    const inside = (p: string) => {
      const root = resolve(workspace)
      const abs = resolve(root, p)
      let at = dirname(abs)
      while (!existsSync(at) && dirname(at) !== at) at = dirname(at)
      const real = realpathSync(at), realRoot = realpathSync(root)
      const linked = existsSync(abs) && lstatSync(abs).isSymbolicLink()
      if (!abs.startsWith(root + sep) || linked || (real !== realRoot && !real.startsWith(realRoot + sep))) throw new Error('Screenshots are saved inside the room\'s folder')
      return abs
    }
    return [
      {
        name: 'browser_open',
        description: 'Open a page in your own page of the Lunchbox browser, which the person can watch. Give a path to an HTML file in the folder (such as index.html) to check a site you are building, or a URL. Returns the page as text with a number before every link, button and field.',
        input: { url: { type: 'string', description: 'A path to an HTML file in the folder, a URL, or words to search for' } },
        run: (a) => drive(`Opening ${String(a.url).slice(0, 60)}`, async (tab) => { await this.load(tab, String(a.url), workspace); return this.read(tab) }),
      },
      {
        name: 'browser_read',
        description: 'Read the page that is open now, as text with numbered links, buttons and fields.',
        input: {},
        run: () => drive('Reading the page', (tab) => this.read(tab)),
      },
      {
        name: 'browser_click',
        description: 'Click a link, button or field by the number browser_read gave it. Returns the page afterwards.',
        input: { ref: { type: 'number', description: 'The number in square brackets' } },
        run: (a) => drive(`Clicking [${a.ref}]`, async (tab) => { await this.click(tab, Number(a.ref)); await sleep(400); return this.read(tab) }),
      },
      {
        name: 'browser_type',
        description: 'Type into a field by its number. Set submit to press Enter afterwards.',
        input: { ref: { type: 'number', description: 'The field\'s number' }, text: { type: 'string', description: 'What to type' }, submit: { type: 'boolean', description: 'Press Enter after typing' } },
        required: ['ref', 'text'],
        run: (a) => drive(`Typing into [${a.ref}]`, async (tab) => {
          await this.click(tab, Number(a.ref))
          this.run(tab, `(() => {
            const e = document.querySelector('[data-lb-ref="${Number(a.ref)}"]'); const text = ${JSON.stringify(String(a.text))}
            if (!e) return
            if (e.isContentEditable) { e.textContent = text; e.dispatchEvent(new InputEvent('input', { bubbles: true })); return }
            if (!('value' in e)) return
            const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value')?.set
            if (set) set.call(e, text); else e.value = text
            e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }))
            ${a.submit ? `
            const k = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }
            const go = e.dispatchEvent(new KeyboardEvent('keydown', k))
            e.dispatchEvent(new KeyboardEvent('keypress', k)); e.dispatchEvent(new KeyboardEvent('keyup', k))
            if (go && e.form) { if (e.form.requestSubmit) e.form.requestSubmit(); else e.form.submit() }` : ''}
          })()`)
          await sleep(500)
          return this.read(tab)
        }),
      },
      {
        name: 'browser_find',
        description: 'Find text on the open page and scroll to it. Returns the lines around each match.',
        input: { text: { type: 'string', description: 'Words to look for' } },
        run: (a) => drive(`Looking for “${String(a.text).slice(0, 40)}”`, async (tab) => {
          const page = await this.read(tab)
          try { (this.win(tab) as unknown as { find?(s: string): boolean })?.find?.(String(a.text)) } catch {}
          const needle = String(a.text).toLowerCase()
          const lines = page.split('\n')
          const hits = lines.flatMap((l, i) => (l.toLowerCase().includes(needle) ? [lines.slice(Math.max(0, i - 1), i + 2).join('\n')] : []))
          return hits.length ? hits.slice(0, 12).join('\n---\n') : 'Not on this page.'
        }),
      },
      {
        name: 'browser_screenshot',
        description: 'Save a screenshot of the open page as a PNG inside the folder, to check a layout or show the person. Works on pages from the folder. Returns the path.',
        input: { file: { type: 'string', description: 'Path inside the folder, for example shots/home.png' } },
        required: [],
        run: (a) => drive('Taking a screenshot', async (tab) => {
          const file = inside(typeof a.file === 'string' && a.file ? a.file : `screenshots/${new Date().toISOString().replace(/[:.]/g, '-')}.png`)
          await this.settle(tab)
          await this.capture(tab, file)
          return `Saved ${relative(workspace, file)}`
        }),
      },
      {
        name: 'expert_look',
        description: 'Look at your work the way people will see it: opens an HTML file in the folder in a hidden page, and saves screenshots at desktop (1440px) and phone (390px) width. Set full for the whole page top to bottom. Returns the image paths; open the images to judge the result.',
        input: {
          target: { type: 'string', description: 'A path to an HTML file inside the folder' },
          full: { type: 'boolean', description: 'Capture the whole page top to bottom instead of the first screen' },
          name: { type: 'string', description: 'A short name for the image files, such as home or pricing' },
        },
        required: ['target'],
        run: (a) => this.look(workspace, String(a.target ?? ''), a.full === true, typeof a.name === 'string' ? a.name : ''),
      },
      {
        name: 'expert_audit',
        description: 'Measure a page instead of judging it by eye, at desktop and phone width: sideways scrolling, overlapping or cut off text, small text and tap targets, long lines, broken or unsized images, the fonts, sizes and colours actually in use, spacing off a 4px grid, console errors, and accessibility through axe-core (WCAG 2.2 AA, including contrast). Returns a numbered list of problems with the elements they are on.',
        input: { target: { type: 'string', description: 'A path to an HTML file inside the folder' } },
        required: ['target'],
        run: (a) => this.audit(workspace, String(a.target ?? '')),
      },
      {
        name: 'expert_view',
        description: 'Look at an image or a 3D model the way it will be used. An image or logo (SVG, PNG, JPG, WebP) is shown at 16, 32, 64, 128 and 512px on white and near black. A 3D model (GLB or glTF) is lit and framed from the front, three quarters and the top, with triangles, meshes, materials, file size and dimensions. Returns the image path; open it to judge the result.',
        input: {
          target: { type: 'string', description: 'Path to the image or model inside the folder' },
          name: { type: 'string', description: 'A short name for the saved image' },
        },
        required: ['target'],
        run: (a) => this.inspect(workspace, String(a.target ?? ''), typeof a.name === 'string' ? a.name : ''),
      },
      {
        name: 'browser_console',
        description: 'Run a JavaScript expression in the open page and return the result as JSON, for checking state or errors.',
        input: { expression: { type: 'string', description: 'For example document.querySelectorAll("img:not([alt])").length' } },
        run: (a) => drive('Running a check in the page', async (tab) => {
          const r = await this.run<Promise<string>>(tab, `(async () => { try { const v = await (${String(a.expression)}); return JSON.stringify(v, null, 2) } catch (e) { return 'Error: ' + e.message } })()`)
          return String(r ?? 'undefined').slice(0, 8000)
        }),
      },
    ]
  }

  // Expert's hidden pages: a frame off screen at the size asked for, one at a time.
  private looking: Promise<unknown> = Promise.resolve()
  private queueLook<T>(job: () => Promise<T>) {
    const next = this.looking.then(job)
    this.looking = next.catch(() => {})
    return next
  }

  private inside(workspace: string, target: string) {
    const root = realpathSync(resolve(workspace))
    let file: string
    try { file = realpathSync(resolve(root, target.replace(/^file:\/\//, ''))) } catch { throw new Error(`There is no ${target} in the room's folder`) }
    if (!file.startsWith(root + sep)) throw new Error('Local files to look at must be inside the room\'s folder')
    return file
  }

  private async hidden(url: string, label: string, width: number, height: number) {
    const frame = document.createElement('iframe')
    frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;height:${height}px;border:0;background:#fff;visibility:hidden`
    document.body.appendChild(frame)
    const t: Tab = { id: 'look', who: 'look', frame, device: 'desktop', busy: false, working: false, used: 0, queue: Promise.resolve(), history: [], at: -1, url, title: '', loading: true, errors: [] }
    try {
      await within(new Promise<void>((r) => { frame.addEventListener('load', () => r(), { once: true }); frame.src = url }), 20000, 'Loading')
      t.loading = false
      const w = this.win(t)
      if (!w) throw new Error('only pages from the room\'s folder can be looked at here')
      w.addEventListener('error', (e) => t.errors.push(String((e as ErrorEvent).message).slice(0, 200)))
      await this.settle(t)
    } catch (e) {
      frame.remove()
      throw new Error(`Could not open ${label}: ${e instanceof Error ? e.message : e}`)
    }
    const resize = (w: number, h: number) => { frame.style.width = `${w}px`; frame.style.height = `${h}px` }
    return { t, frame, resize, destroy: () => frame.remove() }
  }

  look(workspace: string, target: string, full: boolean, name: string) {
    return this.queueLook(async () => {
      const file = this.inside(workspace, target)
      const root = realpathSync(resolve(workspace))
      const stem = (name || 'look').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'look'
      const saved: string[] = []
      const page = await this.hidden(fsUrl(file), target, 1440, 900)
      try {
        for (const [label, width, height] of [['desktop', 1440, 900], ['phone', 390, 844]] as const) {
          page.resize(width, height)
          await sleep(400)
          const w = this.win(page.t)!
          const tall = full ? Math.max(w.document.documentElement.scrollHeight, w.document.body?.scrollHeight ?? 0) || height : height
          const pieces = full ? Math.min(8, Math.ceil(tall / height)) : 1
          mkdirSync(join(root, 'looks'), { recursive: true })
          for (let i = 0; i < pieces; i++) {
            w.scrollTo({ top: i * height, behavior: 'instant' as ScrollBehavior })
            await sleep(i ? 350 : 700)
            const out = join(root, 'looks', `${stem}-${label}${full ? `-${i + 1}` : ''}.png`)
            await this.capture(page.t, out, { width, height })
            saved.push(relative(root, out))
          }
        }
      } finally {
        page.destroy()
      }
      return `Saved ${saved.length > 2 ? `${saved.length} images, top to bottom: ` : ''}${saved.join(saved.length > 2 ? ', ' : ' and ')}.${full ? ' The last image of each width ends at the bottom of the page, so it can repeat part of the one before it.' : ''} Open them now and judge them as the person will see them. First the opening screen as a composition: is the one move in it, and is the whole frame used on purpose? Then hierarchy, spacing, alignment, contrast, overflow and anything cut off or overlapping at phone width.`
    })
  }

  audit(workspace: string, target: string) {
    return this.queueLook(async () => {
      const file = this.inside(workspace, target)
      const page = await this.hidden(fsUrl(file), target, 1440, 900)
      try {
        const views: Measured[] = []
        let found: Axe[] | null = null
        for (const [width, height] of [[1440, 900], [390, 844]] as const) {
          page.resize(width, height)
          await sleep(600)
          views.push(await within(Promise.resolve(this.run<Measured | Promise<Measured>>(page.t, MEASURE)), 15000, 'Measuring the page'))
          if (!found) found = await within(Promise.resolve(this.run<Promise<Axe[]>>(page.t, `${axeSource};\n${AXE_RUN}`)), 20000, 'The accessibility check').catch(() => null)
        }
        return report(target, views, found, page.t.errors)
      } finally {
        page.destroy()
      }
    })
  }

  inspect(workspace: string, target: string, name: string) {
    return this.queueLook(async () => {
      const file = this.inside(workspace, target)
      const model = /\.(glb|gltf)$/i.test(file)
      if (!model && !/\.(svg|png|jpe?g|webp|gif|avif)$/i.test(file)) throw new Error('expert_view takes an image (SVG, PNG, JPG, WebP, GIF, AVIF) or a 3D model (GLB or glTF). For pages use expert_look.')
      const bytes = statSync(file).size
      if (model && bytes > 80 * 1048576) return `${target} is ${(bytes / 1048576).toFixed(0)} MB, too large to open here. For the web, aim well under 10 MB.`
      // The viewer page points at files with file: addresses; here they are served from __fs.
      const html = (model ? modelPage(file) : imagePage(file)).replace(/file:\/\/(\/[^"'\s)]*)/g, (_m, p: string) => fsUrl(decodeURI(p)))
      const pagePath = `/tmp/lunchbox-view-${crypto.randomUUID()}.html`
      writeFileSync(pagePath, html)
      const root = realpathSync(resolve(workspace))
      const stem = (name || target.split(/[\\/]/).pop()!.replace(/\.\w+$/, '')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'view'
      const [w, h] = model ? [1440, 480] : [1080, 1240]
      let page: Awaited<ReturnType<typeof this.hidden>> | null = null
      try {
        page = await this.hidden(fsUrl(pagePath), target, w, h)
        let v: View | null = null
        for (const t0 = Date.now(); !v && Date.now() - t0 < 25000;) {
          v = (this.win(page.t) as unknown as { __view?: View })?.__view ?? null
          if (!v) await sleep(250)
        }
        if (!v) throw new Error(`${target} did not finish loading within 25 seconds`)
        if (!v.ok) throw new Error(`Could not open ${target}: ${v.error}`)
        await sleep(200)
        const out = join(root, 'looks', `${stem}-${model ? 'views' : 'sizes'}.png`)
        await this.capture(page.t, out, { width: w, height: h })
        const at = relative(root, out)
        return model
          ? `Saved ${at}: front, three quarters and top, lit with a key, a fill and a rim light. ${describeModel(v, bytes)} Open the image and check the silhouette, proportions, shading seams and whether it sits on the ground.`
          : `Saved ${at}: the image at 16, 32, 64, 128 and 512px, on white and on near black. It is ${v.width} × ${v.height}. Open it and check it still reads at 16px, holds up on both backgrounds and has no stray edges.`
      } finally {
        page?.destroy()
        try { vfs.remove(pagePath, false, true) } catch {}
      }
    })
  }

  destroy() {
    for (const id of [...this.tabs.keys()]) this.close(id)
  }
}

export const shotsDir = (workspace: string) => join(workspace, 'screenshots')

// The service worker asks for files by path; this answers from the browser file system.
const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8',
  glb: 'model/gltf-binary', gltf: 'model/gltf+json', wasm: 'application/wasm', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', pdf: 'application/pdf', xml: 'application/xml',
}

export function serveFiles() {
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.addEventListener('message', (e) => {
    const m = e.data as { kind?: string; id?: string; path?: string }
    if (m?.kind !== 'lb-fs' || !m.id || typeof m.path !== 'string') return
    let path = m.path
    // The 3D viewer's three.js lives with the app, under __dirname (/app) in the desktop build.
    if (path.startsWith('/app/vendor/')) {
      fetch(new URL(`.${path.slice(4)}`, location.href)).then((r) => r.arrayBuffer()).then(
        (body) => (e.source as ServiceWorker)?.postMessage({ id: m.id, status: 200, type: TYPES.js, body }, [body]),
        () => (e.source as ServiceWorker)?.postMessage({ id: m.id, status: 404, type: 'text/plain', body: 'Not found' }),
      )
      return
    }
    let n = vfs.get(path)
    if (n?.kind === 'dir') { path = `${path.replace(/\/$/, '')}/index.html`; n = vfs.get(path) }
    const reply = n?.kind === 'file'
      ? { id: m.id, status: 200, type: TYPES[path.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream', body: new Uint8Array(n.data).buffer }
      : { id: m.id, status: 404, type: 'text/html; charset=utf-8', body: `<!doctype html><title>Not found</title><p style="font:14px system-ui;padding:24px">There is no ${path.replace(/[<&]/g, '')} in Lunchbox's files.</p>` }
    ;(e.source as ServiceWorker)?.postMessage(reply, reply.body instanceof ArrayBuffer ? [reply.body] : [])
  })
  navigator.serviceWorker.startMessages()
  navigator.serviceWorker.register(new URL('./sw.js', location.href), { scope: './' }).catch((e) => console.warn('Pages from the folder cannot be shown: the service worker did not start', e))
}

