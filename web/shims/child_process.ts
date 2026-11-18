// Node's child_process, run in the browser shell (web/bash.ts). A shell started with -c gets its
// script; any other program is run as a command of that name, so `git --version` answers the way
// a missing program does on a real computer, and the desktop code finds out what is installed the
// way it always does.
import { EventEmitter } from 'events'
import { Buffer } from 'buffer'
import { exec } from '../bash'

const SHELLS = /(^|\/)(sh|bash|zsh|dash|fish)$/
const quote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`)

function script(file: string, args: string[]) {
  if (SHELLS.test(file)) {
    const i = args.findIndex((a) => /^-\w*c\w*$/.test(a))
    if (i >= 0) return args[i + 1] ?? ''
  }
  return [file.split('/').pop()!, ...args].map(quote).join(' ')
}

let nextPid = 1000
export const children = new Map<number, Child>()

class Pipe extends EventEmitter {
  setEncoding() { return this }
  pipe() { return this }
  resume() { return this }
  pause() { return this }
  destroy() { return this }
}

class Input extends EventEmitter {
  chunks: string[] = []
  ended = false
  write(c: string | Uint8Array) { this.chunks.push(typeof c === 'string' ? c : Buffer.from(c).toString()); return true }
  end(c?: string | Uint8Array) { if (c) this.write(c); this.ended = true; this.emit('finish') }
  destroy() { return this }
}

export class Child extends EventEmitter {
  pid = nextPid++
  exitCode: number | null = null
  signalCode: string | null = null
  killed = false
  stdout = new Pipe()
  stderr = new Pipe()
  stdin = new Input()
  private ctl = new AbortController()

  constructor(file: string, args: string[], opts: { cwd?: string; env?: Record<string, string | undefined> } = {}) {
    super()
    children.set(this.pid, this)
    const env = Object.fromEntries(Object.entries(opts.env ?? {}).filter((e): e is [string, string] => typeof e[1] === 'string'))
    const run = async () => {
      // Input written straight after starting is passed in whole.
      await new Promise((r) => setTimeout(r, 0))
      const r = await exec(script(file, args), { cwd: opts.cwd, env, stdin: this.stdin.chunks.join('') || undefined, signal: this.ctl.signal })
      if (r.stdout) this.stdout.emit('data', Buffer.from(r.stdout))
      if (r.stderr) this.stderr.emit('data', Buffer.from(r.stderr))
      this.stdout.emit('end')
      this.stderr.emit('end')
      children.delete(this.pid)
      this.exitCode = this.killed ? null : r.exitCode
      if (this.killed) this.signalCode = 'SIGTERM'
      this.emit('exit', this.exitCode, this.signalCode)
      this.emit('close', this.exitCode, this.signalCode)
    }
    queueMicrotask(() => { this.emit('spawn'); void run() })
  }

  kill(_sig?: string) {
    if (this.exitCode !== null) return false
    this.killed = true
    this.ctl.abort()
    return true
  }
  unref() { return this }
  ref() { return this }
}

type Opts = { cwd?: string; env?: Record<string, string | undefined>; timeout?: number }

export function spawn(file: string, args: string[] | Opts = [], opts: Opts = {}) {
  if (!Array.isArray(args)) { opts = args; args = [] }
  return new Child(file, args, opts)
}

type Done = (err: (Error & { code?: number | string }) | null, stdout: string, stderr: string) => void

export function execFile(file: string, args: string[] | Opts | Done = [], opts?: Opts | Done, done?: Done) {
  if (typeof args === 'function') { done = args; args = []; opts = {} }
  if (!Array.isArray(args)) { done = opts as Done; opts = args; args = [] }
  if (typeof opts === 'function') { done = opts; opts = {} }
  const child = new Child(file, args, opts ?? {})
  let out = '', err = ''
  child.stdout.on('data', (b: Buffer) => { out += b.toString() })
  child.stderr.on('data', (b: Buffer) => { err += b.toString() })
  const t = opts?.timeout ? setTimeout(() => child.kill(), opts.timeout) : null
  child.on('close', (code: number | null) => {
    if (t) clearTimeout(t)
    const e = code === 0 ? null : Object.assign(new Error(err.trim() || `Command failed: ${file}`), { code: code ?? 'SIGTERM' })
    done?.(e, out, err)
  })
  return child
}

export function exec_(command: string, opts?: Opts | Done, done?: Done) {
  if (typeof opts === 'function') { done = opts; opts = {} }
  return execFile('/bin/sh', ['-c', command], opts ?? {}, done)
}
export { exec_ as exec }

export function execSync(): never { throw new Error('Synchronous commands are not available in the browser') }
export const spawnSync = execSync
export const execFileSync = execSync

export type ChildProcess = Child
export type SpawnOptions = Opts

export default { spawn, execFile, exec: exec_, execSync, spawnSync, execFileSync }
