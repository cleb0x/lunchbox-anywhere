// Node's fs, on top of the browser file system in web/vfs.ts.
import { Buffer } from 'buffer'
import * as vfs from '../vfs'

type Enc = BufferEncoding | null | undefined
type Opts = Enc | { encoding?: Enc; flag?: string; mode?: number }
const encOf = (o: Opts): Enc => (typeof o === 'string' ? o : o?.encoding)
const bytes = (data: unknown, o?: Opts): Uint8Array => {
  if (typeof data === 'string') return Buffer.from(data, (encOf(o as Opts) ?? 'utf8') as BufferEncoding)
  if (data instanceof Uint8Array) return data
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return Buffer.from(String(data))
}

export const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1, O_RDONLY: 0 }

export class Stats {
  constructor(private n: vfs.Node, private id = 0) {}
  get size() { return this.n.kind === 'file' ? this.n.data.length : this.n.kind === 'link' ? this.n.target.length : 4096 }
  get mode() { return (this.n.kind === 'dir' ? 0o040000 : this.n.kind === 'link' ? 0o120000 : 0o100000) | this.n.mode }
  get mtimeMs() { return this.n.mtime }
  get mtime() { return new Date(this.n.mtime) }
  get ctime() { return new Date(this.n.mtime) }
  get atime() { return new Date(this.n.mtime) }
  get birthtime() { return new Date(this.n.mtime) }
  get ctimeMs() { return this.n.mtime }
  get atimeMs() { return this.n.mtime }
  get birthtimeMs() { return this.n.mtime }
  get ino() { return this.id }
  dev = 1
  nlink = 1
  uid = 1000
  gid = 1000
  isFile() { return this.n.kind === 'file' }
  isDirectory() { return this.n.kind === 'dir' }
  isSymbolicLink() { return this.n.kind === 'link' }
  isFIFO() { return false }
  isSocket() { return false }
  isBlockDevice() { return false }
  isCharacterDevice() { return false }
}

export class Dirent {
  constructor(public name: string, private n: vfs.Node | undefined, public parentPath = '') {}
  get path() { return this.parentPath }
  isFile() { return this.n?.kind === 'file' }
  isDirectory() { return this.n?.kind === 'dir' }
  isSymbolicLink() { return this.n?.kind === 'link' }
  isFIFO() { return false }
  isSocket() { return false }
  isBlockDevice() { return false }
  isCharacterDevice() { return false }
}

export function existsSync(p: unknown) {
  if (typeof p !== 'string' || !p) return false
  return vfs.exists(p)
}

export function readFileSync(p: string, o?: Opts): any {
  const data = vfs.read(String(p))
  const e = encOf(o)
  const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  return e ? b.toString(e) : Buffer.from(b)
}

export function writeFileSync(p: string, data: unknown, o?: Opts) {
  const flag = typeof o === 'object' && o ? o.flag : undefined
  vfs.write(String(p), bytes(data, o), flag === 'a')
}

export function appendFileSync(p: string, data: unknown, o?: Opts) { vfs.write(String(p), bytes(data, o), true) }

export function mkdirSync(p: string, o?: { recursive?: boolean; mode?: number } | number) {
  return vfs.mkdir(String(p), typeof o === 'object' && !!o?.recursive)
}

export function readdirSync(p: string, o?: { withFileTypes?: boolean; encoding?: string; recursive?: boolean } | string): any {
  const names = vfs.list(String(p))
  if (typeof o === 'object' && o?.withFileTypes) {
    const base = vfs.norm(String(p))
    return names.map((n) => new Dirent(n, vfs.get(`${base === '/' ? '' : base}/${n}`, false), String(p)))
  }
  return names
}

let inode = 1
const inodes = new Map<string, number>()
const ino = (p: string) => { const r = (() => { try { return vfs.real(p) } catch { return p } })(); if (!inodes.has(r)) inodes.set(r, inode++); return inodes.get(r)! }

export function statSync(p: string, o?: { throwIfNoEntry?: boolean }): any {
  const n = vfs.get(String(p))
  if (!n) { if (o?.throwIfNoEntry === false) return undefined; throw new vfs.FsError('ENOENT', 'stat', String(p)) }
  return new Stats(n, ino(String(p)))
}

export function lstatSync(p: string, o?: { throwIfNoEntry?: boolean }): any {
  const n = vfs.get(String(p), false)
  if (!n) { if (o?.throwIfNoEntry === false) return undefined; throw new vfs.FsError('ENOENT', 'lstat', String(p)) }
  return new Stats(n, ino(String(p)))
}

export function realpathSync(p: string) {
  const r = vfs.real(String(p))
  if (!vfs.get(r)) throw new vfs.FsError('ENOENT', 'realpath', String(p))
  return r
}
realpathSync.native = realpathSync

export function accessSync(p: string, _mode?: number) { vfs.must(String(p), 'access') }

export function rmSync(p: string, o?: { recursive?: boolean; force?: boolean }) { vfs.remove(String(p), !!o?.recursive, !!o?.force) }
export function rmdirSync(p: string, o?: { recursive?: boolean }) { vfs.remove(String(p), !!o?.recursive) }
export function unlinkSync(p: string) {
  if (vfs.get(String(p), false)?.kind === 'dir') throw new vfs.FsError('EISDIR', 'unlink', String(p))
  vfs.remove(String(p))
}
export function renameSync(a: string, b: string) { vfs.rename(String(a), String(b)) }
export function copyFileSync(a: string, b: string) { vfs.write(String(b), new Uint8Array(vfs.read(String(a)))) }
export function cpSync(a: string, b: string, o?: { recursive?: boolean }) {
  const n = vfs.must(String(a), 'cp')
  if (n.kind !== 'dir') return copyFileSync(a, b)
  if (!o?.recursive) throw new vfs.FsError('EISDIR', 'cp', String(a))
  mkdirSync(b, { recursive: true })
  for (const k of vfs.list(a)) cpSync(`${a}/${k}`, `${b}/${k}`, o)
}
export function symlinkSync(target: string, p: string) { vfs.symlink(String(target), String(p)) }
export function readlinkSync(p: string) {
  const n = vfs.must(String(p), 'readlink', false)
  if (n.kind !== 'link') throw new vfs.FsError('EINVAL', 'readlink', String(p))
  return n.target
}
export function chmodSync(p: string, mode: number) { vfs.chmod(String(p), mode) }
export function utimesSync(p: string, _a: unknown, m: Date | number) { vfs.utimes(String(p), m instanceof Date ? m.getTime() : Number(m) * 1000) }
export function mkdtempSync(prefix: string) {
  const p = `${prefix}${Math.random().toString(36).slice(2, 8)}`
  vfs.mkdir(p, true)
  return p
}

// Only what the usage tally reads: a byte range of a file, as one chunk.
export function createReadStream(p: string, o?: { start?: number; end?: number }) {
  const data = vfs.read(String(p))
  const chunk = Buffer.from(data.subarray(o?.start ?? 0, (o?.end ?? data.length - 1) + 1))
  return { async *[Symbol.asyncIterator]() { yield chunk } }
}

export function createWriteStream(p: string) {
  vfs.write(String(p), new Uint8Array(0))
  return { write(c: Uint8Array | string) { vfs.write(String(p), bytes(c), true); return true }, end() {}, on() {}, once() {} }
}

export function watch() { return { close() {}, on() {} } }

const cb = <A extends unknown[], R>(fn: (...a: A) => R) => (...args: [...A, (e: unknown, r?: R) => void]) => {
  const done = args.pop() as (e: unknown, r?: R) => void
  try { const r = fn(...(args as unknown as A)); queueMicrotask(() => done(null, r)) } catch (e) { queueMicrotask(() => done(e)) }
}
export const readFile = cb(readFileSync)
export const writeFile = cb(writeFileSync)
export const stat = cb(statSync)
export const readdir = cb(readdirSync)

import * as promises from './fs-promises'
export { promises }

export default {
  constants, Stats, Dirent, existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync, statSync, lstatSync, realpathSync, accessSync,
  rmSync, rmdirSync, unlinkSync, renameSync, copyFileSync, cpSync, symlinkSync, readlinkSync, chmodSync, utimesSync, mkdtempSync, createReadStream, createWriteStream,
  watch, readFile, writeFile, stat, readdir, promises,
}
