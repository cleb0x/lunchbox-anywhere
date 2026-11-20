// Server mode: Lunchbox's engine on plain Node, with the window in a browser. The engine is the
// desktop app's own (electron/), so command line agents such as Claude Code run as themselves
// with their own logins. The browser talks to it over one WebSocket with the same channels the
// desktop window uses (window.lb), and gets a terminal page for signing in to those agents.
//
// Made for a cloud shell such as Google Cloud Shell, whose web preview lets only its owner in.
// Anywhere else, set LUNCHBOX_PASSWORD so the page asks for it.
import { createCipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { appendFileSync, copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { homedir, hostname } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import { app } from 'electron'
import type { Access, ChatSource, Connector, Flow, Report, Settings, Skill } from '../shared/types'
import { Count } from '../electron/count'
import { agyKeyMode, agySettings, effortsFor, installed, modelsFor, testConnector, useConnectors } from '../electron/agents'
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
import { finishStops, resetPath } from '../electron/system'
import { catchErrors, diagnostics, logError, send } from '../electron/report'
import { Snapshots } from '../electron/snap'
import { Browser, type Device } from '../electron/browser'
import { Toolbox } from '../electron/tools'
import { Store, type Cipher } from '../electron/store'
import { cancelPull, pull, start } from '../electron/local'
import { Limits } from '../electron/limits'
import { allowed, claudeDir, found, read, resumes, room as roomFrom } from '../electron/import'

const PORT = Number(process.env.PORT || process.env.LUNCHBOX_PORT || 8080)
const HOST = process.env.LUNCHBOX_HOST || '0.0.0.0'
const PASSWORD = process.env.LUNCHBOX_PASSWORD || ''
// With a key, the engine can be reached from another address (the GitHub Pages site through a
// tunnel) by whoever has the link with the key in it, and by nobody else.
const KEY = process.env.LUNCHBOX_KEY || ''
// Where this Lunchbox can be reached from the website, and what it is called there.
const PUBLIC_URL = (process.env.LUNCHBOX_PUBLIC_URL || '').replace(/\/?$/, '/')
const KIND = process.env.WEB_HOST || process.env.CLOUD_SHELL ? 'cloudshell' : 'computer'
const NAME = process.env.LUNCHBOX_NAME || (KIND === 'cloudshell' ? 'Cloud Shell' : hostname())
const UI = resolve(__dirname, 'ui')
const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' }

// --- The window's side: every open page gets the engine's events ---------------------------

const clients = new Set<WebSocket>()
const sendTo = (ws: WebSocket, m: unknown) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)) }
const emit = (channel: string, value: unknown) => { for (const ws of clients) sendTo(ws, { ev: channel, value }) }
// Things only the page can do (save a file, open a picture, show a notification) go to the page
// that asked, or to every page when nobody in particular did.
let asking: WebSocket | null = null
const pages = new WeakMap<WebSocket, number>()
let pageCount = 0
const pageId = (ws: WebSocket) => { if (!pages.has(ws)) pages.set(ws, ++pageCount); return pages.get(ws)! }
// Two tabs on one room each have a message box. The same text for the same room, from two tabs in
// the same moment, is one message.
let lately: { room: string; text: string; from: WebSocket | null; at: number } | null = null
function twice(room: string, text: string) {
  const same = !!lately && lately.room === room && lately.text === text && lately.from !== asking && Date.now() - lately.at < 1500
  if (!same) lately = { room, text, from: asking, at: Date.now() }
  return same
}
const toPage = (ev: string, value: unknown) => { if (asking && clients.has(asking)) sendTo(asking, { ev, value }); else emit(ev, value) }

// Keys the desktop app sealed with the system keychain (v1) can only be opened by the desktop app;
// those are skipped here and can be entered again. Command line agents need no keys.
const cipher: Cipher = {
  seal: (t) => 'v0:' + Buffer.from(t).toString('base64'),
  open: (s) => { if (!s.startsWith('v0:')) throw new Error('Sealed by the desktop app'); return Buffer.from(s.slice(3), 'base64').toString() },
}

let store: Store
let engine: Engine
let limits: Limits
let flows: Flows
let count: Count
let remote: Remote
let browser: Browser
let toolbox: Toolbox
const packs = () => loadPacks(store.packFiles())
const name = (id: string) => engine.agents.find((a) => a.id === id)?.short ?? id
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'room'
const MIME: Record<string, string> = { md: 'text/markdown', html: 'text/html', json: 'application/json', png: 'image/png' }

// Saving is a download in the browser that asked; the file is also kept in ~/Downloads.
async function saveAs(_title: string, file: string, ext: string, contents: string | Buffer) {
  const dir = app.getPath('downloads')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, file)
  writeFileSync(path, contents)
  toPage('lb:download', { name: file, type: MIME[ext] ?? 'application/octet-stream', data: Buffer.from(contents).toString('base64') })
  return path
}

function openInPage(path: string) {
  const ext = extname(path).toLowerCase()
  const type = IMAGE_TYPES[ext] ?? (ext === '.html' || ext === '.htm' ? 'text/html' : ext === '.pdf' ? 'application/pdf' : /\.(md|txt|json|js|ts|tsx|jsx|css|py|sh|yml|yaml|toml|csv|log)$/.test(ext) ? 'text/plain; charset=utf-8' : '')
  if (statSync(path).size > 25e6) return
  toPage(type ? 'lb:open' : 'lb:download', { name: basename(path), type: type || 'application/octet-stream', data: readFileSync(path).toString('base64') })
}

function defaults() {
  const ready = engine.agents.filter((a) => !engine.why(a.id)).map((a) => a.id)
  const preferred = store.settings.defaultCrew.filter((id) => ready.includes(id))
  return { crew: preferred.length ? preferred : ready.slice(0, 3), workspace: workspace() }
}
const workspace = () => process.env.LB_WORKSPACE || join(app.getPath('documents'), 'Lunchbox')
const chatHome = () => process.env.LB_IMPORT_HOME || homedir()

function roomFolder(about: string) {
  const s = about.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s-]/g, '').trim().split(/\s+/).filter(Boolean).slice(0, 5).join('-').slice(0, 48) || 'room'
  let dir = join(workspace(), s)
  for (let n = 2; existsSync(dir); n++) dir = join(workspace(), `${s}-${n}`)
  return dir
}

function useEndpoints() {
  const typed = store.settings.endpoints ?? {}
  for (const id of ['ollama', 'lmstudio', 'llamacpp']) setBase(id, typed[id] || (id === 'ollama' ? process.env.OLLAMA_HOST : '') || '')
}

function notify(title: string, body: string, room: string) {
  const fromPhone = store.events(room).findLast((e) => e.kind === 'you')
  if (fromPhone?.kind === 'you' && fromPhone.from === 'phone') remote?.forward(room, body)
  if (!store.settings.notify) return
  emit('lb:notify', { title, body, room })
}

const handlers = new Map<string, (...args: any[]) => unknown>()

function wire() {
  const h = (channel: string, fn: (...args: any[]) => unknown) => handlers.set(channel, fn)

  h('env', () => ({ home: homedir(), platform: process.platform, version: app.getVersion(), cwd: workspace(), data: store.dir, anywhere: 'server', uploads: join(app.getPath('userData'), 'uploads'), window: asking ? pageId(asking) : 0 }))
  // Each browser tab is a window. New ones are opened by the page itself (server/ui/bridge.ts).
  h('window:view', () => {})
  // Chats from the agents' own apps on this computer. A session a room already continues is left off.
  h('import:list', () => {
    const taken = new Set(store.list().flatMap((m) => Object.values(m.sessions)))
    return found(chatHome(), 150, (id) => taken.has(id))
  })
  h('import:take', async (agent: ChatSource, file: string) => {
    if (!['claude', 'codex', 'gemini', 'grok'].includes(agent) || typeof file !== 'string' || !allowed(file, agent, chatHome())) throw new Error('That chat is no longer there')
    const chat = await read(agent, file, chatHome())
    if (!chat.turns.some((t) => t.you)) throw new Error('That chat has no messages to bring in')
    const there = !!chat.folder && existsSync(chat.folder) && statSync(chat.folder).isDirectory()
    const ready = !engine.why(agent)
    const findable = agent !== 'claude' || basename(dirname(file)) === claudeDir(chat.folder)
    const resumed = there && ready && resumes(agent) && !!chat.id && findable
    const made = roomFrom(chat, { resumed, folderGone: !there, ready })
    const crew = ready ? [agent] : defaults().crew.length ? defaults().crew : [agent]
    const folder = there ? chat.folder : roomFolder(made.name)
    mkdirSync(folder, { recursive: true })
    return engine.adopt({ name: made.name, crew, workspace: folder, events: made.events, about: made.about, session: resumed ? { who: agent, id: chat.id } : undefined })
  })
  h('agents', () => engine.agents)
  h('agents:refresh', () => { resetPath(); return engine.refresh() })
  h('limits', () => limits.get())
  h('limits:refresh', () => limits.poll().then(() => limits.get()))
  h('local:start', async (id: string) => { const r = await start(id); await engine.refresh(); return r })
  h('local:pull', (model: string) => { pull(model, (p) => { emit('local:pull', p); if (p.finished) engine.refresh() }) })
  h('local:cancel', (model: string) => cancelPull(model))
  h('agents:models', (id: string) => modelsFor(id, store.keys()).catch((e: Error) => ({ error: e.message })))
  h('agents:agy-mode', () => ({ keyMode: agyKeyMode(), hasKey: !!store.keys().google }))
  // Only on the person's click: their agy settings get the gemini provider, the rest is kept,
  // and the file as it was is saved beside it.
  h('agents:agy-key', async () => {
    if (!store.keys().google) throw new Error('Save a Gemini API key first')
    const file = agySettings()
    let current: Record<string, unknown> = {}
    if (existsSync(file)) {
      const text = readFileSync(file, 'utf8')
      writeFileSync(file + '.before-lunchbox', text, { mode: 0o600 })
      try { current = JSON.parse(text) } catch { throw new Error(`${file} is not valid JSON, so Lunchbox left it alone`) }
    } else mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ ...current, modelProvider: 'gemini' }, null, 2), { mode: 0o600 })
    await engine.refresh()
    return { keyMode: agyKeyMode(), hasKey: true }
  })
  h('agents:efforts', (id: string, model?: string) => effortsFor(id, typeof model === 'string' && model ? model : undefined).catch(() => []))
  h('rooms', () => engine.summaries())
  h('room', (id: string) => ({ meta: store.room(id), events: store.events(id), live: engine.live(id) }))
  h('room:create', (opts: { crew: string[]; workspace: string; pack?: string; name?: string; about?: string; studio?: boolean; repo?: string; group?: string }) => {
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
  h('room:send', (id: string, text: string, access: Access, arena: boolean, files?: string[]) => { if (!twice(id, text)) engine.send(id, text, access, { arena, files: files?.length ? into(id, files) : files }) })
  h('room:project', (id: string, on: boolean) => engine.setProject(id, on))
  h('room:rewind', (id: string, target: { event?: string; ref?: string }) => engine.rewind(id, target))
  h('room:changed', (id: string, event: string) => engine.changedSince(id, event))
  h('room:changes', (id: string, event: string) => engine.changesFor(id, event))
  h('room:show', (id: string, rel: string) => {
    const ws = store.room(id)?.workspace
    if (!ws) return 'missing'
    const abs = resolve(ws, rel)
    if (!abs.startsWith(resolve(ws) + sep) || !existsSync(abs)) return 'missing'
    if (!statSync(abs).isDirectory()) openInPage(abs)
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
    return m ? saveAs('Save image', file, 'png', Buffer.from(m[1], 'base64')) : null
  })
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
  h('browser:shot', () => browser.screenshot(''))
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
  h('image:save', (data: string, name: string) => saveAs('Save the image', `${String(name || 'lunchbox').replace(/[^\w.-]+/g, '-')}.png`, 'png', png(data)))
  h('room:studio', (id: string, on: boolean) => engine.setStudio(id, on))
  h('room:repo', (id: string, repo: string | null) => engine.setRepo(id, repo))
  h('room:group', (id: string, group: string | null) => engine.setGroup(id, group))
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
    if (patch.models || patch.disabled || patch.connectors || patch.endpoints) await engine.refresh()
    if (patch.budgets) emit('ledger', engine.ledger())
    emit('settings', store.settings)
    return store.settings
  })
  h('spent:clear', (id: string) => { delete store.spent[id]; store.saveState(); emit('ledger', engine.ledger()) })
  h('keys', () => Object.fromEntries(Object.entries(store.keys()).filter(([k]) => !k.startsWith('tool:')).map(([k, v]) => [k, v.length >= 20 ? `${v.slice(0, 4)}…${v.slice(-4)}` : '••••••••'])))
  h('keys:set', async (provider: string, key: string) => { store.setKey(provider, key.trim()); return engine.refresh() })
  h('keys:secure', () => false)
  // Server mode is updated with git pull; nothing to download in the page.
  h('update', () => ({ state: 'none' }))
  h('update:check', () => ({ state: 'none' }))
  h('update:install', () => {})
  h('update:download', () => {})
  h('notices', () => [])
  h('notice:dismiss', () => {})
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
  h('packs:import:file', (path: string) => { const pack = importPack(path, join(store.dir, 'packs')); emit('packs', packs()); return pack })
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
  h('skills:import:file', (path: string) => {
    const s = JSON.parse(readFileSync(path, 'utf8')) as Partial<Skill>
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
  // The page asks for a folder by path; this lists what is there, so it can offer a choice.
  h('folders', (path?: string) => {
    const dir = resolve(path || workspace())
    try {
      return { path: dir, parent: resolve(dir, '..'), dirs: readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name).sort() }
    } catch { return { path: dir, parent: resolve(dir, '..'), dirs: [], missing: true } }
  })
  h('mkdir', (path: string) => { mkdirSync(resolve(path), { recursive: true }); return resolve(path) })
  h('reveal', (path: string) => {
    if (typeof path !== 'string' || !existsSync(path)) return 'missing'
    if (!statSync(path).isDirectory()) openInPage(path)
    return ''
  })
  h('file:image', (path: string) => {
    const type = IMAGE_TYPES[extname(path).toLowerCase()]
    if (!type || !existsSync(path) || statSync(path).size > 12e6) return null
    return `data:${type};base64,${readFileSync(path).toString('base64')}`
  })
  h('theme', () => {})
}

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

// --- Signing in ------------------------------------------------------------------------------

const secret = (() => {
  const file = join(app.getPath('userData'), 'server-secret')
  try { return readFileSync(file, 'utf8') } catch {}
  mkdirSync(app.getPath('userData'), { recursive: true })
  const s = randomBytes(32).toString('hex')
  writeFileSync(file, s, { mode: 0o600 })
  return s
})()
const token = createHmac('sha256', secret).update(`ok:${createHash('sha256').update(PASSWORD).digest('hex')}`).digest('hex')
const cookie = (req: IncomingMessage) => Object.fromEntries((req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')).filter((p) => p.length === 2)) as Record<string, string>
const keyed = (req: IncomingMessage) => {
  const k = new URL(req.url ?? '/', 'http://x').searchParams.get('key') ?? ''
  return !!KEY && k.length === KEY.length && timingSafeEqual(Buffer.from(k), Buffer.from(KEY))
}
// The page itself is the same for everyone; what it reaches, the engine and uploads, is not.
const signedIn = (req: IncomingMessage, open = false) => {
  if (keyed(req)) return true
  if (KEY && !open && !PASSWORD) return false
  if (!PASSWORD) return true
  const t = cookie(req).lb_session ?? ''
  return t.length === token.length && timingSafeEqual(Buffer.from(t), Buffer.from(token))
}
let failures = 0
const LOGIN = (wrong: boolean) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lunchbox</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#080807;color:#f2f0ea;font:14px ui-monospace,monospace}form{display:grid;gap:12px;width:min(320px,90vw)}input,button{font:inherit;padding:10px 12px;border-radius:8px;border:1px solid #2a2926;background:#121110;color:inherit}button{background:#f2f0ea;color:#0d0d0c;border:0;cursor:pointer}p{margin:0;color:#c26a5a}</style>
<form method="post" action="login"><b>Lunchbox</b><input type="password" name="password" placeholder="Password" autofocus>${wrong ? '<p>That is not the password.</p>' : ''}<button>Open</button></form>`

// --- HTTP ------------------------------------------------------------------------------------

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.jpg': 'image/jpeg', '.json': 'application/json', '.webmanifest': 'application/manifest+json' }

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x')
  let path = decodeURIComponent(url.pathname)
  if (path === '/' || !extname(path)) path = path.startsWith('/terminal') ? '/terminal.html' : '/index.html'
  const file = resolve(UI, '.' + path)
  if (!file.startsWith(UI + sep) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404).end('Not found'); return }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' })
  createReadStream(file).pipe(res)
}

async function body(req: IncomingMessage, max = 210e6) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) { size += c.length; if (size > max) throw new Error('Too large'); chunks.push(c as Buffer) }
  return Buffer.concat(chunks)
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname.endsWith('/login') && req.method === 'POST') {
      const pw = new URLSearchParams((await body(req, 4096)).toString()).get('password') ?? ''
      const ok = PASSWORD && pw.length === PASSWORD.length && timingSafeEqual(Buffer.from(pw), Buffer.from(PASSWORD))
      if (!ok) { failures++; await new Promise((r) => setTimeout(r, Math.min(10000, 500 * failures))); res.writeHead(401, { 'content-type': 'text/html' }).end(LOGIN(true)); return }
      failures = 0
      res.writeHead(303, { location: './', 'set-cookie': `lb_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}` }).end()
      return
    }
    // The GitHub Pages site sends files from its own address.
    const origin = req.headers.origin
    if (origin && KEY) res.setHeader('access-control-allow-origin', origin)
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600' }).end()
      return
    }
    // The website checks a computer is there, and which it is, before connecting.
    if (url.pathname.endsWith('/health')) {
      if (!keyed(req)) { res.writeHead(403).end(); return }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ ok: true, name: NAME, kind: KIND, version: app.getVersion() }))
      return
    }
    const isUpload = url.pathname.endsWith('/upload')
    if (!signedIn(req, !isUpload)) {
      if (isUpload) { res.writeHead(403).end('Not allowed'); return }
      res.writeHead(200, { 'content-type': 'text/html' }).end(LOGIN(false)); return
    }
    // Files the page sends: attachments, imports. They land in ~/.lunchbox-uploads.
    if (url.pathname.endsWith('/upload') && req.method === 'POST') {
      const name = (url.searchParams.get('name') ?? 'file').normalize('NFKD').replace(/[^\w.-]+/g, '-').slice(-80) || 'file'
      // The page may choose the folder name, so it knows the path before the upload finishes.
      const id = /^[\w-]{6,40}$/.test(url.searchParams.get('id') ?? '') ? url.searchParams.get('id')! : randomUUID().slice(0, 8)
      const dir = join(app.getPath('userData'), 'uploads', id)
      mkdirSync(dir, { recursive: true })
      const path = join(dir, name)
      writeFileSync(path, await body(req))
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ path }))
      return
    }
    serveStatic(req, res)
  } catch (e) {
    res.writeHead(500).end(String((e as Error).message))
  }
})

// --- Sockets: the engine, and the terminal ------------------------------------------------------

const wss = new WebSocketServer({ noServer: true, maxPayload: 64e6 })
server.on('upgrade', (req, socket, head) => {
  if (!signedIn(req)) { socket.destroy(); return }
  const path = new URL(req.url ?? '/', 'http://x').pathname
  wss.handleUpgrade(req, socket, head, (ws) => (path.endsWith('/pty') ? terminal(ws, req) : window(ws)))
})

function window(ws: WebSocket) {
  clients.add(ws)
  ws.on('close', () => clients.delete(ws))
  ws.on('message', async (raw) => {
    let m: { id: number; ch: string; args: unknown[] }
    try { m = JSON.parse(String(raw)) } catch { return }
    const fn = handlers.get(m.ch)
    if (!fn) return sendTo(ws, { id: m.id, error: `No handler for ${m.ch}` })
    try {
      asking = ws
      const value = await fn(...(m.args ?? []))
      sendTo(ws, { id: m.id, value: value === undefined ? null : value })
    } catch (e) {
      sendTo(ws, { id: m.id, error: e instanceof Error ? e.message : String(e) })
    } finally {
      asking = null
    }
  })
}

// A shell in the browser, for signing in to Claude Code and the other agents.
function terminal(ws: WebSocket, req: IncomingMessage) {
  let pty: { write(s: string): void; resize(c: number, r: number): void; kill(): void; onData(f: (s: string) => void): void; onExit(f: () => void): void }
  try {
    const { spawn } = require('node-pty') as { spawn: (file: string, args: string[], o: object) => typeof pty }
    const size = new URL(req.url ?? '/', 'http://x').searchParams
    pty = spawn(process.env.SHELL || '/bin/bash', ['-l'], { name: 'xterm-256color', cols: Number(size.get('cols')) || 100, rows: Number(size.get('rows')) || 30, cwd: homedir(), env: process.env })
  } catch (e) {
    ws.send(`The terminal could not start: ${(e as Error).message}\r\n`)
    ws.close()
    return
  }
  pty.onData((s) => { if (ws.readyState === ws.OPEN) ws.send(s) })
  pty.onExit(() => ws.close())
  ws.on('message', (raw) => {
    const s = String(raw)
    if (s.startsWith('\u0000resize:')) { const [c, r] = s.slice(8).split('x').map(Number); if (c && r) pty.resize(c, r); return }
    pty.write(s)
  })
  ws.on('close', () => { try { pty.kill() } catch {} })
}

// --- Start -----------------------------------------------------------------------------------

catchErrors()

async function main() {
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
  remote = new Remote(store, engine, { emit, defaults })
  wire()
  useConnectors(store.settings.connectors)
  useEndpoints()
  engine.sweep()
  await engine.refresh()
  limits.start()
  flows.start()
  remote.start()
  toolbox.startAll()
  server.listen(PORT, HOST, () => {
    void beFound()
    console.log(`Lunchbox is running on port ${PORT}.`)
    const shell = process.env.WEB_HOST || process.env.CLOUD_SHELL
    if (process.env.LUNCHBOX_QUIET) return
    console.log(shell ? 'Open the link above, or Web Preview on this port. Only your Google account can open it.'
      : HOST === '127.0.0.1' || HOST === 'localhost' ? `Open http://localhost:${PORT}`
      : `Open http://<this computer>:${PORT}${PASSWORD ? '' : '. No password is set, so anyone who can reach this port can use it: set LUNCHBOX_PASSWORD.'}`)
  })
}

// --- Being found ------------------------------------------------------------------------------
// The tunnel's address changes every start. So the website can find this computer without a new
// link each time, the address is posted to ntfy.sh, a free public message service, on a topic
// named after the key and encrypted with it. Only browsers that have the key can read it.
const RELAY = process.env.LUNCHBOX_RELAY || 'https://ntfy.sh'
const topic = () => 'lunchbox-' + createHash('sha256').update(`${KEY}:topic`).digest('hex').slice(0, 32)
function sealed(o: unknown) {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', createHash('sha256').update(`${KEY}:seal`).digest(), iv)
  const body = Buffer.concat([c.update(JSON.stringify(o)), c.final(), c.getAuthTag()])
  return Buffer.concat([iv, body]).toString('base64')
}
async function announce(online: boolean) {
  if (!KEY || !PUBLIC_URL || process.env.LUNCHBOX_NO_RELAY) return
  try {
    await fetch(`${RELAY}/${topic()}`, { method: 'POST', body: sealed({ v: 1, url: online ? PUBLIC_URL : '', name: NAME, kind: KIND, at: Date.now(), online }), signal: AbortSignal.timeout(8000) })
  } catch {}
}
// Said once the tunnel answers, and again now and then so it never looks stale.
async function beFound() {
  if (!KEY || !PUBLIC_URL) return
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${PUBLIC_URL}health?key=${KEY}`, { signal: AbortSignal.timeout(4000) })).ok) break } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  await announce(true)
  setInterval(() => { void announce(true) }, 30 * 60e3).unref()
}

// With LUNCHBOX_IDLE_MINUTES set, Lunchbox stops itself when no page has been open for that long
// and no agent or flow is working, so a cloud shell can go to sleep and stop using its hours.
const IDLE = Number(process.env.LUNCHBOX_IDLE_MINUTES || 0) * 60e3
let lastSeen = Date.now()
if (IDLE > 0) {
  setInterval(() => {
    const busy = engine?.summaries().some((r) => r.busy) || (flows?.states().length ?? 0) > 0
    if (clients.size || busy) { lastSeen = Date.now(); return }
    if (Date.now() - lastSeen > IDLE) {
      console.log(`\nLunchbox stopped after ${IDLE / 60e3} minutes without use, to save your Cloud Shell hours. Start it again any time.`)
      quit()
    }
  }, 30e3).unref()
}

let quitting = false
const quit = () => { if (quitting) return; quitting = true; void announce(false).finally(() => stop()); setTimeout(stop, 3000) }
const stop = () => { engine?.stopAll(); limits?.stop(); flows?.stop(); remote?.stop(); toolbox?.stopAll(); store?.flush(); finishStops(); process.exit(0) }
process.on('SIGINT', quit)
process.on('SIGTERM', quit)

main().catch((e) => { console.error(e); process.exit(1) })
