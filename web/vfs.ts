// The file system the browser version of Lunchbox lives in. Everything the desktop app keeps on
// disk (rooms, settings, room folders, checkpoints) is kept here, in memory, and saved to the
// browser's own storage (IndexedDB) a moment after it changes, so it is still there next visit.
//
// A real folder on the computer can be linked in with the browser's folder picker. Its files are
// read in when it is linked and every change made here is written back to the real folder.
//
// The desktop code expects Node's synchronous fs calls, so every read and write here is
// synchronous; only saving to storage and to linked folders happens afterwards.

export type Node =
  | { kind: 'file'; data: Uint8Array; mode: number; mtime: number }
  | { kind: 'dir'; mode: number; mtime: number }
  | { kind: 'link'; target: string; mode: number; mtime: number }

const nodes = new Map<string, Node>()
const kids = new Map<string, Set<string>>()
const enc = new TextEncoder()

export class FsError extends Error {
  code: string
  errno: number
  syscall: string
  path: string
  constructor(code: string, syscall: string, path: string) {
    const text: Record<string, string> = {
      ENOENT: 'no such file or directory', EEXIST: 'file already exists', ENOTDIR: 'not a directory', EISDIR: 'illegal operation on a directory',
      ENOTEMPTY: 'directory not empty', EINVAL: 'invalid argument', ELOOP: 'too many symbolic links', EACCES: 'permission denied', EPERM: 'operation not permitted',
    }
    super(`${code}: ${text[code] ?? 'error'}, ${syscall} '${path}'`)
    this.code = code
    this.errno = -1
    this.syscall = syscall
    this.path = path
  }
}

export function norm(p: string, cwd = '/'): string {
  const s = String(p ?? '')
  const parts = (s.startsWith('/') ? s : `${cwd}/${s}`).split('/')
  const out: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return '/' + out.join('/')
}

const parentOf = (p: string) => (p === '/' ? '/' : p.slice(0, p.lastIndexOf('/')) || '/')
const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1)

// --- Persistence -----------------------------------------------------------------------------

const DB = 'lunchbox-web'
let db: IDBDatabase | null = null
const dirty = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null

function open(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => {
      r.result.createObjectStore('files')
      r.result.createObjectStore('mounts')
    }
    r.onsuccess = () => ok(r.result)
    r.onerror = () => fail(r.error)
  })
}

const done = (t: IDBTransaction) => new Promise<void>((ok, fail) => { t.oncomplete = () => ok(); t.onerror = () => fail(t.error); t.onabort = () => fail(t.error) })

function touch(p: string) {
  if (mountOf(p)) return
  dirty.add(p)
  if (!timer) timer = setTimeout(flush, 250)
}

export async function flush() {
  if (timer) clearTimeout(timer)
  timer = null
  if (!db || !dirty.size) return
  const list = [...dirty]
  dirty.clear()
  const t = db.transaction('files', 'readwrite')
  const s = t.objectStore('files')
  for (const p of list) {
    const n = nodes.get(p)
    if (n) s.put(n, p)
    else s.delete(p)
  }
  await done(t).catch((e) => { console.error('Could not save to browser storage', e); list.forEach((p) => dirty.add(p)) })
}

export async function boot() {
  db = await open()
  const t = db.transaction('files', 'readonly')
  const s = t.objectStore('files')
  await new Promise<void>((ok, fail) => {
    const r = s.openCursor()
    r.onsuccess = () => {
      const c = r.result
      if (!c) return ok()
      nodes.set(String(c.key), c.value as Node)
      c.continue()
    }
    r.onerror = () => fail(r.error)
  })
  if (!nodes.has('/')) nodes.set('/', { kind: 'dir', mode: 0o755, mtime: Date.now() })
  for (const p of nodes.keys()) {
    if (p === '/') continue
    const parent = parentOf(p)
    // A file whose folder was lost is given its folder back rather than dropped.
    if (!nodes.has(parent)) mkdir(parent, true)
    link(parent, nameOf(p))
  }
  addEventListener('pagehide', () => { void flush() })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flush() })
  try { await navigator.storage?.persist?.() } catch {}
}

function link(dir: string, name: string) {
  let set = kids.get(dir)
  if (!set) kids.set(dir, (set = new Set()))
  set.add(name)
}

// --- Lookup ----------------------------------------------------------------------------------

// The path with every link on the way followed. With last false the final part is left as it is,
// for lstat, readlink and unlink.
export function real(p: string, last = true, depth = 0): string {
  if (depth > 40) throw new FsError('ELOOP', 'stat', p)
  const abs = norm(p)
  if (abs === '/') return '/'
  const parts = abs.slice(1).split('/')
  let at = '/'
  for (let i = 0; i < parts.length; i++) {
    const next = at === '/' ? `/${parts[i]}` : `${at}/${parts[i]}`
    const n = nodes.get(next)
    if (n?.kind === 'link' && (last || i < parts.length - 1)) {
      const target = norm(n.target, at)
      at = real(target, true, depth + 1)
    } else {
      if (n && n.kind === 'file' && i < parts.length - 1) throw new FsError('ENOTDIR', 'stat', p)
      at = next
    }
  }
  return at
}

export function get(p: string, follow = true): Node | undefined {
  try { return nodes.get(real(p, follow)) } catch { return undefined }
}

export function must(p: string, syscall: string, follow = true): Node {
  const n = get(p, follow)
  if (!n) throw new FsError('ENOENT', syscall, p)
  return n
}

export const exists = (p: string) => !!get(p)

// --- Changes ---------------------------------------------------------------------------------

function put(abs: string, n: Node) {
  const parent = parentOf(abs)
  const pn = nodes.get(parent)
  if (!pn) throw new FsError('ENOENT', 'open', abs)
  if (pn.kind !== 'dir') throw new FsError('ENOTDIR', 'open', abs)
  nodes.set(abs, n)
  link(parent, nameOf(abs))
  touch(abs)
}

export function mkdir(p: string, recursive = false): string | undefined {
  const abs = real(p, false)
  const n = nodes.get(abs)
  if (n) {
    if (recursive && n.kind === 'dir') return undefined
    throw new FsError('EEXIST', 'mkdir', p)
  }
  let first: string | undefined
  if (!nodes.has(parentOf(abs))) {
    if (!recursive) throw new FsError('ENOENT', 'mkdir', p)
    first = mkdir(parentOf(abs), true)
  } else if (nodes.get(parentOf(abs))!.kind !== 'dir') throw new FsError('ENOTDIR', 'mkdir', p)
  put(abs, { kind: 'dir', mode: 0o755, mtime: Date.now() })
  mounted(abs, { op: 'mkdir' })
  return first ?? abs
}

export function write(p: string, data: Uint8Array | string, append = false, mode = 0o644) {
  const abs = real(p)
  // Always a copy of its own: Node's Buffers often share one larger buffer, which would otherwise be
  // saved whole, and could change under the file.
  const bytes = typeof data === 'string' ? enc.encode(data) : new Uint8Array(data)
  const old = nodes.get(abs)
  if (old?.kind === 'dir') throw new FsError('EISDIR', 'open', p)
  let body = bytes
  if (append && old?.kind === 'file') {
    body = new Uint8Array(old.data.length + bytes.length)
    body.set(old.data)
    body.set(bytes, old.data.length)
  }
  put(abs, { kind: 'file', data: body, mode: old?.mode ?? mode, mtime: Date.now() })
  mounted(abs, { op: 'write' })
}

export function read(p: string): Uint8Array {
  const n = must(p, 'open')
  if (n.kind === 'dir') throw new FsError('EISDIR', 'read', p)
  if (n.kind !== 'file') throw new FsError('ENOENT', 'open', p)
  return n.data
}

export function list(p: string): string[] {
  const abs = real(p)
  const n = nodes.get(abs)
  if (!n) throw new FsError('ENOENT', 'scandir', p)
  if (n.kind !== 'dir') throw new FsError('ENOTDIR', 'scandir', p)
  return [...(kids.get(abs) ?? [])].filter((k) => nodes.has(abs === '/' ? `/${k}` : `${abs}/${k}`)).sort()
}

export function remove(p: string, recursive = false, force = false) {
  let abs: string
  try { abs = real(p, false) } catch (e) { if (force) return; throw e }
  const n = nodes.get(abs)
  if (!n) { if (force) return; throw new FsError('ENOENT', 'rm', p) }
  if (abs === '/') throw new FsError('EPERM', 'rm', p)
  if (n.kind === 'dir') {
    const inside = list(abs)
    if (inside.length && !recursive) throw new FsError('ENOTEMPTY', 'rmdir', p)
    for (const k of inside) dropTree(`${abs === '/' ? '' : abs}/${k}`)
  }
  nodes.delete(abs)
  kids.get(parentOf(abs))?.delete(nameOf(abs))
  kids.delete(abs)
  touch(abs)
  mounted(abs, { op: 'remove' })
}

function dropTree(abs: string) {
  const n = nodes.get(abs)
  if (n?.kind === 'dir') for (const k of [...(kids.get(abs) ?? [])]) dropTree(`${abs}/${k}`)
  nodes.delete(abs)
  kids.delete(abs)
  touch(abs)
}

export function rename(from: string, to: string) {
  const a = real(from, false)
  const b = real(to, false)
  if (a === b) return
  const n = nodes.get(a)
  if (!n) throw new FsError('ENOENT', 'rename', from)
  if (b.startsWith(a + '/')) throw new FsError('EINVAL', 'rename', from)
  const target = nodes.get(b)
  if (target?.kind === 'dir' && n.kind !== 'dir') throw new FsError('EISDIR', 'rename', to)
  if (target?.kind === 'dir' && list(b).length) throw new FsError('ENOTEMPTY', 'rename', to)
  if (target) remove(b, true)
  const moves: [string, Node][] = []
  const walk = (p: string, q: string) => {
    const x = nodes.get(p)!
    moves.push([q, x])
    if (x.kind === 'dir') for (const k of kids.get(p) ?? []) if (nodes.has(`${p}/${k}`)) walk(`${p}/${k}`, `${q}/${k}`)
  }
  walk(a, b)
  remove(a, true)
  for (const [q, x] of moves) {
    put(q, x)
    mounted(q, { op: x.kind === 'dir' ? 'mkdir' : 'write' })
  }
}

export function symlink(target: string, p: string) {
  const abs = real(p, false)
  if (nodes.has(abs)) throw new FsError('EEXIST', 'symlink', p)
  put(abs, { kind: 'link', target, mode: 0o777, mtime: Date.now() })
}

export function chmod(p: string, mode: number) {
  const abs = real(p)
  const n = nodes.get(abs)
  if (!n) throw new FsError('ENOENT', 'chmod', p)
  nodes.set(abs, { ...n, mode })
  touch(abs)
}

export function utimes(p: string, mtime: number) {
  const abs = real(p)
  const n = nodes.get(abs)
  if (!n) throw new FsError('ENOENT', 'utimes', p)
  nodes.set(abs, { ...n, mtime })
  touch(abs)
}

export function allPaths() { return [...nodes.keys()] }

// --- Linked folders --------------------------------------------------------------------------

type Mount = { path: string; handle: FileSystemDirectoryHandle; chain: Promise<unknown>; name: string; state: 'ready' | 'locked' }
const mounts = new Map<string, Mount>()

export const MOUNTS = '/mnt'
// What is not read in from a linked folder: it can be made again and is often huge.
const HEAVY = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', '.next', '.cache', '.turbo', 'target', '.gradle', 'Pods', 'DerivedData'])
const MAX_FILE = 20 << 20

export function mountOf(abs: string): Mount | undefined {
  for (const m of mounts.values()) if (abs === m.path || abs.startsWith(m.path + '/')) return m
  return undefined
}
export const mountList = () => [...mounts.values()].map((m) => ({ path: m.path, name: m.name, state: m.state }))

async function handleFor(m: Mount, rel: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
  let h = m.handle
  for (const part of rel) h = await h.getDirectoryHandle(part, { create })
  return h
}

// Every change inside a linked folder is written back to the real folder, one at a time, in order.
function mounted(abs: string, change: { op: 'write' | 'mkdir' | 'remove' }) {
  const m = mountOf(abs)
  if (!m || m.state !== 'ready' || abs === m.path) return
  const rel = abs.slice(m.path.length + 1).split('/')
  if (rel.some((r) => HEAVY.has(r))) return
  m.chain = m.chain.then(async () => {
    try {
      if (change.op === 'mkdir') { await handleFor(m, rel, true); return }
      const dir = await handleFor(m, rel.slice(0, -1), change.op !== 'remove')
      if (change.op === 'remove') { await dir.removeEntry(rel[rel.length - 1], { recursive: true }).catch(() => {}); return }
      const n = nodes.get(abs)
      if (n?.kind !== 'file') return
      const fh = await dir.getFileHandle(rel[rel.length - 1], { create: true })
      const w = await fh.createWritable()
      await w.write(n.data as Uint8Array<ArrayBuffer>)
      await w.close()
    } catch (e) {
      console.warn(`Could not write ${abs} to the linked folder`, e)
    }
  })
}

async function readIn(m: Mount, h: FileSystemDirectoryHandle, at: string, budget: { files: number }) {
  for await (const [name, entry] of (h as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
    const p = `${at}/${name}`
    if (entry.kind === 'directory') {
      nodes.set(p, { kind: 'dir', mode: 0o755, mtime: Date.now() })
      link(at, name)
      if (!HEAVY.has(name) && budget.files < 30000) await readIn(m, entry as FileSystemDirectoryHandle, p, budget)
    } else {
      const file = await (entry as FileSystemFileHandle).getFile()
      budget.files++
      const data = file.size > MAX_FILE ? new Uint8Array(0) : new Uint8Array(await file.arrayBuffer())
      nodes.set(p, { kind: 'file', data, mode: 0o644, mtime: file.lastModified })
      link(at, name)
    }
  }
}

const safeName = (s: string) => s.replace(/[^\w.@+ -]/g, '-').trim() || 'folder'

async function saveMount(m: Mount) {
  if (!db) return
  const t = db.transaction('mounts', 'readwrite')
  t.objectStore('mounts').put({ path: m.path, name: m.name, handle: m.handle }, m.path)
  await done(t)
}

// Links a real folder in at /mnt/<name> and reads its files in.
export async function linkFolder(handle: FileSystemDirectoryHandle): Promise<string> {
  for (const m of mounts.values()) if (await m.handle.isSameEntry(handle).catch(() => false)) { await load(m); return m.path }
  if (!exists(MOUNTS)) mkdir(MOUNTS, true)
  let path = `${MOUNTS}/${safeName(handle.name)}`
  for (let n = 2; nodes.has(path) || mounts.has(path); n++) path = `${MOUNTS}/${safeName(handle.name)}-${n}`
  const m: Mount = { path, handle, name: handle.name, chain: Promise.resolve(), state: 'locked' }
  mounts.set(path, m)
  await saveMount(m)
  await load(m)
  return path
}

async function load(m: Mount) {
  // What was in memory for this folder is replaced by what is on disk now.
  if (nodes.has(m.path)) dropTree(m.path)
  nodes.set(m.path, { kind: 'dir', mode: 0o755, mtime: Date.now() })
  link(parentOf(m.path), nameOf(m.path))
  await readIn(m, m.handle, m.path, { files: 0 })
  m.state = 'ready'
}

type Perm = { queryPermission(o: { mode: string }): Promise<string>; requestPermission(o: { mode: string }): Promise<string> }

// Linked folders from an earlier visit. The browser may want the person to allow access again,
// which needs a click, so those come back as locked until reconnect() is called from one.
export async function restoreMounts() {
  if (!db) return
  const t = db.transaction('mounts', 'readonly')
  const all = await new Promise<{ path: string; name: string; handle: FileSystemDirectoryHandle }[]>((ok, fail) => {
    const r = t.objectStore('mounts').getAll()
    r.onsuccess = () => ok(r.result)
    r.onerror = () => fail(r.error)
  })
  if (!exists(MOUNTS)) mkdir(MOUNTS, true)
  for (const x of all) {
    const m: Mount = { path: x.path, handle: x.handle, name: x.name, chain: Promise.resolve(), state: 'locked' }
    mounts.set(x.path, m)
    if (!nodes.has(m.path)) { nodes.set(m.path, { kind: 'dir', mode: 0o755, mtime: Date.now() }); link(MOUNTS, nameOf(m.path)) }
    const state = await (x.handle as unknown as Perm).queryPermission({ mode: 'readwrite' }).catch(() => 'denied')
    if (state === 'granted') await load(m).catch((e) => console.warn('Could not read the linked folder', e))
  }
}

export async function reconnect(path?: string) {
  for (const m of mounts.values()) {
    if (m.state === 'ready' || (path && m.path !== path)) continue
    const state = await (m.handle as unknown as Perm).requestPermission({ mode: 'readwrite' }).catch(() => 'denied')
    if (state === 'granted') await load(m)
  }
}

export async function unlinkFolder(path: string) {
  const m = mounts.get(path)
  if (!m) return
  mounts.delete(path)
  if (db) { const t = db.transaction('mounts', 'readwrite'); t.objectStore('mounts').delete(path); await done(t) }
  dropTree(path)
  kids.get(parentOf(path))?.delete(nameOf(path))
}

// Reads a linked folder again, for changes made outside the browser while the tab was open.
export async function rescan() {
  for (const m of mounts.values()) if (m.state === 'ready') { await m.chain; await load(m).catch(() => {}) }
}
