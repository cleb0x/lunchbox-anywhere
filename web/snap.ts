// Checkpoints for the browser version. The desktop app keeps them in a git repository of its own;
// there is no git in a browser, so each checkpoint here is a list of the folder's files and the
// hash of each one's contents, with every version of a file stored once under its hash. What the
// rest of the app sees is the same: take, changed, diff and restore behave as in electron/snap.ts.
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, parse, resolve } from 'node:path'
import { structuredPatch } from 'diff'

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.venv', 'venv', '__pycache__', '.next', '.nuxt', 'target', '.gradle', 'dist', 'build', 'out', 'coverage', '.cache', '.turbo',
  '.parcel-cache', '.svelte-kit', '.angular', '.expo', '.output', '.vercel', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', '.terraform', 'DerivedData', 'Pods',
])
const SAFE_FILES = 20000
const MAX_FILE = 25 << 20
const PATCH_CAP = 120_000

export type FileChange = {
  path: string; from?: string; status: 'added' | 'modified' | 'deleted' | 'renamed'
  added: number; removed: number; binary: boolean; patch: string; cut: boolean
}

type Tree = Record<string, string>
type Commit = { label: string; at: number; files: Tree }

const sha = (b: Uint8Array | string) => createHash('sha1').update(b as Uint8Array).digest('hex') as string
const binary = (b: Uint8Array) => b.subarray(0, 8000).includes(0)

export class Snapshots {
  private locks = new Map<string, Promise<unknown>>()

  constructor(private dir: string) {}

  async available() { return true }

  static fits(workspace: string) {
    const ws = resolve(workspace)
    return ws !== resolve(homedir()) && ws !== parse(ws).root && existsSync(ws)
  }

  private repo(workspace: string) { return join(this.dir, sha(resolve(workspace)).slice(0, 16)) }
  private blob(workspace: string, hash: string) { return join(this.repo(workspace), 'objects', hash.slice(0, 2), hash.slice(2)) }

  // The folder as it is now: each file's path and the hash of its contents. Contents not stored
  // yet are stored. Null when the folder has too many files to keep.
  private scan(workspace: string): Tree | null {
    const root = resolve(workspace)
    const files: Tree = {}
    let count = 0
    const walk = (dir: string, rel: string) => {
      for (const name of readdirSync(dir)) {
        if (name === '.DS_Store' || name.endsWith('.log')) continue
        const abs = join(dir, name)
        const r = rel ? `${rel}/${name}` : name
        let st
        try { st = lstatSync(abs) } catch { continue }
        if (st.isDirectory()) {
          if (SKIP_DIRS.has(name) || r === '.lunchbox/attachments') continue
          walk(abs, r)
        } else if (st.isFile()) {
          if (++count > SAFE_FILES) throw new Error('too many')
          if (st.size > MAX_FILE) continue
          const data = readFileSync(abs) as Uint8Array
          const h = sha(data)
          const at = this.blob(workspace, h)
          if (!existsSync(at)) { mkdirSync(join(at, '..'), { recursive: true }); writeFileSync(at, data) }
          files[r] = h
        }
      }
    }
    try { walk(root, '') } catch { return null }
    return files
  }

  private commit(workspace: string, ref: string): Commit | null {
    try { return JSON.parse(readFileSync(join(this.repo(workspace), 'commits', `${ref}.json`), 'utf8')) } catch { return null }
  }

  private serial<T>(workspace: string, job: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(workspace) ?? Promise.resolve()
    const next = prev.then(job, job)
    this.locks.set(workspace, next.catch(() => {}))
    return next
  }

  take(workspace: string, label: string): Promise<{ ref: string } | null> {
    return this.serial(workspace, async () => {
      if (!Snapshots.fits(workspace)) return null
      const files = this.scan(workspace)
      if (!files) return null
      const c: Commit = { label: label.slice(0, 200), at: Date.now(), files }
      const body = JSON.stringify(c)
      const ref = sha(body + c.at)
      const dir = join(this.repo(workspace), 'commits')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, `${ref}.json`), body)
      return { ref }
    })
  }

  changed(workspace: string, ref: string): Promise<string[]> {
    return this.serial(workspace, async () => {
      const c = this.commit(workspace, ref)
      const now = this.scan(workspace)
      if (!c || !now) return []
      const paths = new Set([...Object.keys(c.files), ...Object.keys(now)])
      return [...paths].filter((p) => c.files[p] !== now[p]).sort()
    })
  }

  private text(workspace: string, hash: string | undefined): Uint8Array {
    if (!hash) return new Uint8Array(0)
    try { return readFileSync(this.blob(workspace, hash)) as Uint8Array } catch { return new Uint8Array(0) }
  }

  diff(workspace: string, from: string, to?: string): Promise<FileChange[]> {
    return this.serial(workspace, async () => {
      const a = this.commit(workspace, from)?.files
      const b = to ? this.commit(workspace, to)?.files : this.scan(workspace)
      if (!a || !b) return []
      const dec = new TextDecoder()
      const paths = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((p) => a[p] !== b[p]).sort()
      // A file that left one path and arrived whole at another is a rename, as git reports it.
      const gone = paths.filter((p) => a[p] && !b[p])
      const renamed = new Map<string, string>()
      for (const p of paths) {
        if (a[p] || !b[p]) continue
        const old = gone.find((g) => a[g] === b[p] && ![...renamed.values()].includes(g))
        if (old) renamed.set(p, old)
      }
      const out: FileChange[] = []
      for (const p of paths) {
        if ([...renamed.values()].includes(p)) continue
        const fromPath = renamed.get(p)
        const before = this.text(workspace, a[fromPath ?? p])
        const after = this.text(workspace, b[p])
        const status: FileChange['status'] = fromPath ? 'renamed' : !a[p] ? 'added' : !b[p] ? 'deleted' : 'modified'
        if (binary(before) || binary(after)) {
          out.push({ path: p, from: fromPath, status, added: 0, removed: 0, binary: true, patch: '', cut: false })
          continue
        }
        const s = structuredPatch(fromPath ?? p, p, dec.decode(before), dec.decode(after), '', '', { context: 3 })
        let added = 0, removed = 0
        const lines: string[] = [`--- ${a[fromPath ?? p] ? `a/${fromPath ?? p}` : '/dev/null'}`, `+++ ${b[p] ? `b/${p}` : '/dev/null'}`]
        for (const h of s.hunks) {
          lines.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`)
          for (const l of h.lines) {
            if (l.startsWith('+')) added++
            else if (l.startsWith('-')) removed++
            lines.push(l)
          }
        }
        const text = lines.join('\n') + '\n'
        out.push({ path: p, from: fromPath, status, added, removed, binary: false, patch: text.length > PATCH_CAP ? text.slice(0, PATCH_CAP) : text, cut: text.length > PATCH_CAP })
      }
      return out
    })
  }

  async restore(workspace: string, ref: string) {
    const undo = await this.take(workspace, 'Before rewind')
    if (!undo) throw new Error('Could not record the folder before rewinding, so nothing was changed.')
    return this.serial(workspace, async () => {
      const target = this.commit(workspace, ref)?.files
      const now = this.commit(workspace, undo.ref)?.files
      if (!target || !now) throw new Error('That checkpoint is gone')
      const root = resolve(workspace)
      const added = Object.keys(now).filter((p) => !target[p])
      for (const p of added) rmSync(join(root, p), { force: true })
      for (const [p, h] of Object.entries(target)) {
        if (now[p] === h) continue
        const abs = join(root, p)
        mkdirSync(join(abs, '..'), { recursive: true })
        writeFileSync(abs, this.text(workspace, h))
      }
      return { undo: undo.ref, removed: added.length }
    })
  }
}
