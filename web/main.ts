// The browser version's main process. electron/main.ts starts the engine and answers the window
// over IPC; here the engine runs in the page and the window calls it directly through window.lb,
// the same bridge electron/preload.ts gives the desktop window. The handlers below are those of
// electron/main.ts, channel for channel, with the desktop's dialogs, clipboard, notifications and
// "show in folder" done the way a browser does them.
import { randomUUID } from 'node:crypto'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { app } from 'electron'
import type { Access, Connector, Flow, Report, Settings, Skill } from '../shared/types'
import { Count } from '../electron/count'
import { effortsFor, installed, modelsFor, testConnector, useConnectors } from '../electron/agents'
import { commands, expand } from '../electron/commands'
import { setBase } from '../electron/agents/http'
import { markdown, replay } from '../electron/export'
import { Flows } from '../electron/flows'
import { fetchPack, importPack, loadPacks, packJson, removePack } from '../electron/packs'
import { Hands } from '../electron/hands'
import { Remote } from '../electron/remote'
import { Engine } from '../electron/room/engine'
import { GITHUB_TOKEN, listRepos } from '../shared/github'
import { answer, kill, type Answer } from '../electron/shell'
import { resetPath } from '../electron/system'
import { Updates } from '../electron/updates'
import { catchErrors, diagnostics, flush, logError, send } from '../electron/report'
import { Snapshots } from '../electron/snap'
import { Browser, type Device } from '../electron/browser'
import { Toolbox } from '../electron/tools'
import { Store, type Cipher } from '../electron/store'
import { cancelPull, pull, start } from '../electron/local'
import { Limits } from '../electron/limits'
import * as vfs from './vfs'

const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' }

const listeners = new Map<string, Set<(value: unknown) => void>>()
const emit = (channel: string, value: unknown) => listeners.get(channel)?.forEach((fn) => { try { fn(value) } catch (e) { console.error(e) } })

// A browser has no keychain a page can use without asking for a password each time, so keys are
// only encoded, as on a Linux desktop without one. Settings says so.
const cipher: Cipher = {
  seal: (t) => 'v0:' + Buffer.from(t).toString('base64'),
  open: (s) => Buffer.from(s.slice(3), 'base64').toString(),
}

let store: Store
let engine: Engine
let limits: Limits
let flows: Flows
let count: Count
let remote: Remote
let browser: Browser
let toolbox: Toolbox
let updates: Updates | undefined
const packs = () => loadPacks(store.packFiles())
const name = (id: string) => engine.agents.find((a) => a.id === id)?.short ?? id
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'room'

const MIME: Record<string, string> = { md: 'text/markdown', html: 'text/html', json: 'application/json', png: 'image/png', txt: 'text/plain' }

// Saving a file is a download; the browser asks where, or puts it in Downloads.
function download(file: string, contents: string | Uint8Array, type?: string) {
  const blob = new Blob([contents as BlobPart], { type: type ?? MIME[extname(file).slice(1)] ?? 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = basename(file)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

async function saveAs(_title: string, file: string, ext: string, contents: string | Uint8Array) {
  download(file, contents, MIME[ext])
  return `Downloads/${file}`
}

// Files the person chooses are copied in, since a page cannot reach them where they are.
const INBOX = () => join(app.getPath('downloads'))
const pending = new Set<Promise<unknown>>()
function takeIn(f: File, dir = INBOX()) {
  mkdirSync(dir, { recursive: true })
  const clean = f.name.normalize('NFKD').replace(/[^\w.-]+/g, '-').slice(-80) || 'file'
  let path = join(dir, clean)
  for (let n = 2; existsSync(path); n++) path = join(dir, `${basename(clean, extname(clean))}-${n}${extname(clean)}`)
  // The name is taken now so the caller has it at once; the contents follow a moment later.
  writeFileSync(path, '')
  const job = f.arrayBuffer().then((b) => writeFileSync(path, new Uint8Array(b))).finally(() => pending.delete(job))
  pending.add(job)
  return path
}
const settled = () => Promise.all([...pending])

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

function defaults() {
  const ready = engine.agents.filter((a) => !engine.why(a.id)).map((a) => a.id)
  const preferred = store.settings.defaultCrew.filter((id) => ready.includes(id))
  return { crew: preferred.length ? preferred : ready.slice(0, 3), workspace: workspace() }
}
const workspace = () => join(app.getPath('documents'), 'Lunchbox')

function roomFolder(about: string) {
  const s = about.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s-]/g, '').trim().split(/\s+/).filter(Boolean).slice(0, 5).join('-').slice(0, 48) || 'room'
  let dir = join(workspace(), s)
  for (let n = 2; existsSync(dir); n++) dir = join(workspace(), `${s}-${n}`)
  return dir
}

function useEndpoints() {
  const typed = store.settings.endpoints ?? {}
  for (const id of ['ollama', 'lmstudio', 'llamacpp']) setBase(id, typed[id] || '')
}

const focused = () => document.visibilityState === 'visible' && document.hasFocus()

function notify(title: string, body: string, room: string) {
  const fromPhone = store.events(room).findLast((e) => e.kind === 'you')
  if (!focused() || (fromPhone?.kind === 'you' && fromPhone.from === 'phone')) remote?.forward(room, body)
  if (!store.settings.notify || focused() || typeof Notification === 'undefined') return
  const show = () => {
    const n = new Notification(title, { body, silent: body === 'Done', icon: './icon.png' })
    n.onclick = () => { window.focus(); emit('open-room', room); n.close() }
  }
  if (Notification.permission === 'granted') show()
  else if (Notification.permission === 'default') Notification.requestPermission().then((p) => { if (p === 'granted') show() })
}

// Opens what a path points at: a picture or a page in a new tab, anything else as a download.
function openFile(path: string) {
  const data = readFileSync(path) as Uint8Array
  const ext = extname(path).toLowerCase()
  const type = IMAGE_TYPES[ext] ?? (ext === '.html' || ext === '.htm' ? 'text/html' : ext === '.pdf' ? 'application/pdf' : /\.(md|txt|json|js|ts|tsx|jsx|css|py|sh|yml|yaml|toml|csv|log)$/.test(ext) ? 'text/plain; charset=utf-8' : '')
  if (!type) return download(path, data)
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }))
  window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 120_000)
}

const handlers = new Map<string, (...args: any[]) => unknown>()

function wire() {
  const h = (channel: string, fn: (...args: any[]) => unknown) => handlers.set(channel, fn)

  h('env', () => ({ home: app.getPath('home'), platform: 'linux', version: app.getVersion(), cwd: workspace(), data: store.dir, window: 1, anywhere: 'web' }))
  // On its own, the site keeps everything in this tab's storage, and a second tab would write over
  // it. So a new window opens the room here instead; connected to a computer, tabs are windows.
  h('window:new', (room?: string) => { if (typeof room === 'string' && store.room(room)) emit('open-room', room) })
  h('window:view', () => {})
  // Chats from the agents' own apps live on a computer; a browser tab has none to bring in.
  h('import:list', () => [])
  h('import:take', () => { throw new Error('Importing chats works when the website is connected to your computer or Cloud Shell.') })
  h('agents', () => engine.agents)
  h('agents:refresh', () => { resetPath(); return engine.refresh() })
  h('limits', () => limits.get())
  h('limits:refresh', () => limits.poll().then(() => limits.get()))
  h('local:start', async (id: string) => {
    const r = await start(id)
    await engine.refresh()
    return r
  })
  h('local:pull', (model: string) => {
    pull(model, (p) => {
      emit('local:pull', p)
      if (p.finished) engine.refresh()
    })
  })
  h('local:cancel', (model: string) => cancelPull(model))
  h('agents:models', (id: string) => modelsFor(id, store.keys()).catch((e: Error) => ({ error: e.message })))
  h('agents:efforts', (id: string, model?: string) => effortsFor(id, typeof model === 'string' && model ? model : undefined).catch(() => []))
  h('rooms', () => engine.summaries())
  h('room', (id: string) => ({ meta: store.room(id), events: store.events(id), live: engine.live(id) }))
  h('room:create', (opts: { crew: string[]; workspace: string; pack?: string; name?: string; about?: string; studio?: boolean; repo?: string }) => {
    const folder = opts.workspace || roomFolder(opts.about ?? opts.name ?? '')
    mkdirSync(folder, { recursive: true })
    return engine.create({ ...opts, workspace: folder })
  })
  h('room:rename', (id: string, name: string) => engine.rename(id, name))
  h('room:mark', (id: string, patch: { pinned?: boolean; archived?: boolean }) => { if (patch.archived) browser.closeRoom(id); return engine.mark(id, patch) })
  h('inbox', () => engine.inbox())
  h('room:remove', (id: string) => { browser.closeRoom(id); return engine.remove(id) })
  h('room:fork', (id: string, at: string) => engine.fork(id, at))
  h('room:crew', (id: string, crew: string[]) => engine.setCrew(id, crew))
  h('room:workspace', (id: string, path: string) => engine.setWorkspace(id, path))
  h('room:send', async (id: string, text: string, access: Access, arena: boolean, files?: string[]) => {
    await settled()
    engine.send(id, text, access, { arena, files: files?.length ? into(id, files) : files })
  })
  h('room:project', (id: string, on: boolean) => engine.setProject(id, on))
  h('room:rewind', (id: string, target: { event?: string; ref?: string }) => engine.rewind(id, target))
  h('room:changed', (id: string, event: string) => engine.changedSince(id, event))
  h('room:changes', (id: string, event: string) => engine.changesFor(id, event))
  h('room:show', (id: string, rel: string) => {
    const ws = store.room(id)?.workspace
    if (!ws) return 'missing'
    const abs = resolve(ws, rel)
    if (!abs.startsWith(resolve(ws) + '/') || !existsSync(abs)) return 'missing'
    if (!statSync(abs).isDirectory()) openFile(abs)
    return 'ok'
  })
  h('room:export', async (id: string, kind: 'md' | 'html') => {
    const meta = store.room(id)
    if (!meta) return null
    const events = store.events(id)
    return kind === 'md'
      ? saveAs('Export as Markdown', `${slug(meta.name)}.md`, 'md', markdown(meta, events, name))
      : saveAs('Share as a replay', `${slug(meta.name)}.html`, 'html', replay(meta, events, name))
  })
  h('save:png', (dataUrl: string, file: string) => {
    const m = dataUrl.match(/^data:image\/png;base64,(.+)$/)
    if (!m) return null
    return saveAs('Save image', file, 'png', Buffer.from(m[1], 'base64'))
  })
  h('attach', async () => (await choose({ multiple: true })).map((f) => takeIn(f)))
  h('attach:data', (dataUrl: string, ext = 'png', folder?: string) => {
    const m = dataUrl.match(/^data:[\w/+.-]+;base64,(.+)$/)
    if (!m || m[1].length > 30e6) return null
    const dir = folder && existsSync(folder) ? join(folder, '.lunchbox', 'attachments') : join(store.dir, 'attachments')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}.${ext.replace(/\W/g, '') || 'png'}`)
    writeFileSync(file, Buffer.from(m[1], 'base64'))
    return file
  })
  h('flows', () => ({ flows: flows.list(), running: flows.states() }))
  h('flows:put', (f: Partial<Flow> & Pick<Flow, 'name' | 'steps' | 'crew' | 'workspace' | 'access'>) => flows.put(f))
  h('flows:remove', (id: string) => flows.remove(id))
  h('flows:toggle', (id: string, on: boolean) => flows.toggle(id, on))
  h('flows:run', (id: string) => flows.run(id).room)
  h('browser', () => browser.state())
  h('browser:place', (b: { x: number; y: number; width: number; height: number } | null) => browser.place(b))
  h('browser:open', (url: string) => browser.open(String(url)))
  h('browser:select', (id: string) => browser.select(String(id)))
  h('browser:close', (id: string) => browser.close(String(id)))
  h('browser:nav', (kind: 'back' | 'forward' | 'reload' | 'stop') => browser.nav(kind))
  h('browser:device', (d: Device) => browser.setDevice(d))
  h('browser:devtools', () => browser.devtools())
  h('browser:local', () => browser.local())
  h('browser:shot', async () => {
    const file = join(app.getPath('downloads'), `lunchbox-${new Date().toISOString().replace(/[:.]/g, '-')}.png`)
    await browser.screenshot(file)
    download(file, readFileSync(file) as Uint8Array, 'image/png')
    return file
  })
  h('tools', () => toolbox.list())
  h('tools:set', (id: string, patch: { on?: boolean; input?: string; secrets?: Record<string, string> }) => toolbox.configure(id, patch))
  h('tools:secrets', (id: string) => Object.fromEntries(Object.keys(store.keys()).filter((k) => k.startsWith(`tool:${id}:`)).map((k) => [k.split(':')[2], true])))
  h('remote', () => remote.status())
  h('remote:set', async (patch: { on?: boolean; access?: Access; token?: string }) => {
    if (patch.token !== undefined) store.setKey('telegram', patch.token.trim())
    const cur = store.settings.remote ?? { on: false }
    store.saveSettings({ remote: { ...cur, ...(patch.on !== undefined ? { on: patch.on } : {}), ...(patch.access ? { access: patch.access } : {}) } })
    await remote.start()
    return remote.status()
  })
  h('remote:unpair', () => { remote.unpair(); return remote.status() })
  h('room:stop', (id: string) => engine.stop(id))
  const png = (data: string) => {
    if (typeof data !== 'string' || !data.startsWith('data:image/png;base64,')) throw new Error('Not a PNG')
    return Buffer.from(data.slice('data:image/png;base64,'.length), 'base64')
  }
  const KEYS: Record<string, RegExp> = { openrouter: /^sk-or-[\w-]{20,200}$/, gemini: /^AIza[\w-]{30,60}$/, groq: /^gsk_\w{20,200}$/, nvidia: /^nvapi-[\w-]{20,200}$/ }
  h('clipboard:key', async (provider: string) => {
    const shape = KEYS[provider]
    if (!shape) return ''
    const t = (await navigator.clipboard.readText().catch(() => '')).trim()
    return shape.test(t) ? t : ''
  })
  h('image:copy', async (data: string) => { await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([png(data) as BlobPart], { type: 'image/png' }) })]); return true })
  h('image:save', (data: string, name: string) => saveAs('Save the image', `${String(name || 'lunchbox').replace(/[^\w.-]+/g, '-')}.png`, 'png', png(data)))
  h('room:studio', (id: string, on: boolean) => engine.setStudio(id, on))
  h('room:repo', (id: string, repo: string | null) => engine.setRepo(id, repo))
  h('github:repos', () => listRepos(store.keys()[GITHUB_TOKEN]))
  h('room:takeback', (id: string, queued: string) => engine.takeBack(id, queued))
  h('room:decide', (id: string, ref: string, index: number, access: Access) => { engine.decide(id, ref, index, access) })
  h('room:pick', (id: string, arena: string, who: string) => engine.pick(id, arena, who))
  h('room:pin', (id: string, event: string) => engine.pin(id, event))
  h('room:block', (id: string, block: string, text: string | null) => (text === null ? engine.dropBlock(id, block) : engine.editBlock(id, block, text)))
  h('room:skill', (id: string) => engine.skill(id))
  h('run:answer', (id: string, a: Answer) => answer(id, a))
  h('run:kill', (id: string) => kill(id))
  h('ledger', () => engine.ledger())
  h('settings', () => store.settings)
  h('settings:set', async (patch: Partial<Settings>) => {
    store.saveSettings(patch)
    if (patch.count === true) void count?.send()
    if (patch.connectors) useConnectors(store.settings.connectors)
    if (patch.endpoints) useEndpoints()
    if (patch.autoUpdate !== undefined) updates?.setAuto(patch.autoUpdate)
    if (patch.models || patch.disabled || patch.connectors || patch.endpoints) await engine.refresh()
    if (patch.budgets) emit('ledger', engine.ledger())
    emit('settings', store.settings)
    return store.settings
  })
  h('spent:clear', (id: string) => { delete store.spent[id]; store.saveState(); emit('ledger', engine.ledger()) })
  h('keys', () => Object.fromEntries(Object.entries(store.keys()).filter(([k]) => !k.startsWith('tool:')).map(([k, v]) => [k, v.length >= 20 ? `${v.slice(0, 4)}…${v.slice(-4)}` : '••••••••'])))
  h('keys:set', async (provider: string, key: string) => {
    store.setKey(provider, key.trim())
    return engine.refresh()
  })
  h('keys:secure', () => false)
  h('update', () => updates?.state)
  h('update:check', () => updates?.check())
  h('update:install', () => updates?.install())
  h('update:download', () => updates?.download())
  h('notices', () => updates?.shown() ?? [])
  h('notice:dismiss', (id: string) => updates?.dismiss(String(id)))
  h('report:diagnostics', () => diagnostics(engine.agents))
  h('report:send', (r: Report) => send(r, store.dir, Object.values(store.keys())))
  h('error:log', (message: string) => logError('window', String(message).slice(0, 4000)))
  h('connector:test', (c: Connector, key: string, headers?: string) => testConnector(c, key ?? '', typeof headers === 'string' ? headers : ''))
  h('connector:installed', (bins: string[]) => { resetPath(); return installed(Array.isArray(bins) ? bins : []) })
  h('packs', () => packs().filter((p) => !p.hidden))
  // Slash commands from the agents' own folders on this computer, and the room's folder.
  h('commands', (folder?: string) => commands(typeof folder === 'string' ? folder : undefined).map(({ body: _body, ...c }) => c))
  h('commands:expand', (folder: string | undefined, agent: string, name: string, args: string, to: string) => {
    const c = commands(typeof folder === 'string' ? folder : undefined).find((x) => x.agent === agent && x.name === name)
    return c ? expand(c, String(args ?? ''), String(to ?? '')) : null
  })
  h('packs:import', async () => {
    const [f] = await choose({ accept: '.json,application/json' })
    if (!f) return null
    const path = takeIn(f, '/tmp/imports')
    await settled()
    const pack = importPack(path, join(store.dir, 'packs'))
    emit('packs', packs())
    return pack
  })
  h('packs:link', async (url: string) => { const pack = await fetchPack(url, join(store.dir, 'packs')); emit('packs', packs()); return pack })
  h('packs:remove', (id: string) => { const r = removePack(id, join(store.dir, 'packs')); emit('packs', packs()); return r })
  h('packs:export', (id: string) => {
    const p = packs().find((x) => x.id === id)
    return p ? saveAs('Share a pack', `${p.id}.json`, 'json', packJson(p)) : null
  })
  h('skills:export', (id: string) => {
    const s = store.skills.find((x) => x.id === id)
    return s ? saveAs('Share a skill', `${slug(s.name)}.skill.json`, 'json', JSON.stringify({ kind: 'lunchbox-skill', ...s, from: undefined }, null, 2)) : null
  })
  h('skills:import', async () => {
    const [f] = await choose({ accept: '.json,application/json' })
    if (!f) return null
    const s = JSON.parse(await f.text()) as Partial<Skill>
    if (typeof s.name !== 'string' || typeof s.brief !== 'string' || !Array.isArray(s.steps)) throw new Error('That file is not a Lunchbox skill')
    const skill: Skill = { id: randomUUID().slice(0, 12), name: s.name.slice(0, 80), brief: s.brief, steps: s.steps.filter((x) => typeof x === 'string').slice(0, 20), crew: Array.isArray(s.crew) ? s.crew : [], pack: s.pack, from: '', created: Date.now() }
    store.skills = [skill, ...store.skills]
    store.saveSkills()
    emit('skills', store.skills)
    return skill
  })
  h('skills', () => store.skills)
  h('skills:remove', (id: string) => {
    store.skills = store.skills.filter((s) => s.id !== id)
    store.saveSkills()
    emit('skills', store.skills)
    return store.skills
  })
  h('search', (q: string) => engine.search(q))
  // Choosing a folder links a real folder on this computer: the browser asks the person which one
  // and whether Lunchbox may change it. Browsers without the folder picker get a folder of their own.
  h('pick', async () => {
    const picker = (window as { showDirectoryPicker?: (o?: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker
    if (!picker) {
      const name = prompt('This browser cannot open folders on the computer. Name a folder to keep in the browser instead:', 'project')
      if (!name) return null
      const dir = join(workspace(), name.replace(/[^\w .-]+/g, '-').trim() || 'project')
      mkdirSync(dir, { recursive: true })
      return dir
    }
    try {
      const handle = await picker({ id: 'lunchbox', mode: 'readwrite' })
      return await vfs.linkFolder(handle)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null
      throw e
    }
  })
  h('reveal', (path: string) => {
    if (typeof path !== 'string' || !existsSync(path)) return 'missing'
    if (statSync(path).isDirectory()) return ''
    openFile(path)
    return ''
  })
  h('file:image', (path: string) => {
    const type = IMAGE_TYPES[extname(path).toLowerCase()]
    if (!type || !existsSync(path) || statSync(path).size > 12e6) return null
    return `data:${type};base64,${(readFileSync(path) as Buffer).toString('base64')}`
  })
  h('theme', () => {})
}

catchErrors()

function into(room: string, files: string[]) {
  const ws = store.room(room)?.workspace
  if (!ws) return files
  const dir = join(ws, '.lunchbox', 'attachments')
  return files.map((f) => {
    try {
      if (!existsSync(f) || statSync(f).isDirectory() || statSync(f).size > 200e6) return f
      if (!relative(ws, f).startsWith('..') && !isAbsolute(relative(ws, f))) return f
      mkdirSync(dir, { recursive: true })
      const exclude = join(ws, '.git', 'info', 'exclude')
      if (existsSync(join(ws, '.git', 'info')) && !(existsSync(exclude) && readFileSync(exclude, 'utf8').includes('.lunchbox/'))) appendFileSync(exclude, '\n.lunchbox/\n')
      const ext = extname(f).replace(/[^.\w]/g, '').slice(0, 10)
      const name = `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${basename(f, extname(f)).normalize('NFKD').replace(/[^\w.-]+/g, '-').slice(0, 40)}-${randomUUID().slice(0, 4)}${ext}`
      const to = join(dir, name)
      copyFileSync(f, to)
      return to
    } catch {
      return f
    }
  })
}

export async function startApp() {
  try { mkdirSync(workspace(), { recursive: true }) } catch {}
  store = new Store(join(app.getPath('userData'), 'data'), cipher)
  const hands = new Hands()
  await hands.start().catch(() => {})
  browser = new Browser(() => null, emit)
  toolbox = new Toolbox(store, emit)
  const tools = (who: string, folder: string, access: Access, room: string) => [
    ...(store.settings.browser !== false && (access === 'workspace' || access === 'full') ? browser.tools(who, folder, room) : []),
    ...(access === 'plan' ? [] : toolbox.tools()),
  ]
  limits = new Limits(store, (l) => { emit('limits', l); emit('ledger', engine.ledger()) }, () => engine.agents.filter((a) => a.found && a.via === 'cli').map((a) => a.id))
  engine = new Engine(store, { emit, notify, packs, tools, turned: (who, u) => limits.turned(who, u), flow: (f) => flows?.put(f) }, hands, new Snapshots(join(app.getPath('userData'), 'checkpoints')))
  flows = new Flows(store, engine, { emit, notify })
  count = new Count(store)
  count.start()
  remote = new Remote(store, engine, { emit, defaults })
  wire()
  useConnectors(store.settings.connectors)
  useEndpoints()
  updates = new Updates(store, emit)
  updates.start()
  flush(store.dir).catch(() => {})
  engine.sweep()
  // Agents are found in the background, as on the desktop, so the window is not held up by them.
  const ready = engine.refresh()
  limits.start()
  flows.start()
  remote.start()
  toolbox.startAll()
  addEventListener('pagehide', () => { engine?.stopAll(); store?.flush() })
  // A linked folder can change outside the browser; coming back to the tab reads it again.
  addEventListener('focus', () => { void vfs.rescan() })

  window.lb = {
    call: async (channel: string, ...args: unknown[]) => {
      const fn = handlers.get(channel)
      if (!fn) throw new Error(`No handler for ${channel}`)
      return fn(...args)
    },
    on: (channel: string, fn: (value: unknown) => void) => {
      let set = listeners.get(channel)
      if (!set) listeners.set(channel, (set = new Set()))
      set.add(fn)
      return () => { set!.delete(fn) }
    },
    pathOf: (file: File) => takeIn(file),
  }
  return { ready }
}
