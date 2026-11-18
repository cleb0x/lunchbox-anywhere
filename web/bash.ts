// The shell commands run in. The desktop app starts the person's own shell; in the browser there is
// no such thing, so commands run in just-bash, a bash written in TypeScript, over the same files
// as everything else (web/vfs.ts). It has the usual tools: ls, cat, grep, sed, awk, find, jq, diff,
// tar, sqlite3 and more, and curl reaches the internet where a site allows it.
import { Bash, defineCommand, type IFileSystem } from 'just-bash/browser'
import { Buffer } from 'buffer'
import * as vfs from './vfs'
import { HOME } from './shims/os'

const dec = new TextDecoder()

type Stat = { isFile: boolean; isDirectory: boolean; isSymbolicLink: boolean; mode: number; size: number; mtime: Date }
const statOf = (n: vfs.Node): Stat => ({
  isFile: n.kind === 'file', isDirectory: n.kind === 'dir', isSymbolicLink: n.kind === 'link',
  mode: n.mode, size: n.kind === 'file' ? n.data.length : n.kind === 'link' ? n.target.length : 4096, mtime: new Date(n.mtime),
})
const toBytes = (c: string | Uint8Array, enc?: string) => (typeof c === 'string' ? (enc && enc !== 'utf8' && enc !== 'utf-8' ? Buffer.from(c, enc as BufferEncoding) : new TextEncoder().encode(c)) : c)
const encOf = (o: unknown) => (typeof o === 'string' ? o : (o as { encoding?: string } | undefined)?.encoding)

// just-bash's view of the browser file system.
export const shellFs: IFileSystem = {
  async readFile(p, o) {
    const data = vfs.read(p)
    const e = encOf(o)
    return e && e !== 'utf8' && e !== 'utf-8' ? Buffer.from(data).toString(e as BufferEncoding) : dec.decode(data)
  },
  async readFileBuffer(p) { return new Uint8Array(vfs.read(p)) },
  async readFileBytes(p) { return Buffer.from(vfs.read(p)).toString('latin1') as never },
  async writeFile(p, c, o) { vfs.write(p, toBytes(c, encOf(o))) },
  async appendFile(p, c, o) { vfs.write(p, toBytes(c, encOf(o)), true) },
  async exists(p) { return vfs.exists(p) },
  async stat(p) { return statOf(vfs.must(p, 'stat')) },
  async lstat(p) { return statOf(vfs.must(p, 'lstat', false)) },
  async mkdir(p, o) { vfs.mkdir(p, !!o?.recursive) },
  async readdir(p) { return vfs.list(p) },
  async readdirWithFileTypes(p) {
    const base = vfs.norm(p)
    return vfs.list(p).map((name) => {
      const n = vfs.get(`${base === '/' ? '' : base}/${name}`, false)
      return { name, isFile: n?.kind === 'file', isDirectory: n?.kind === 'dir', isSymbolicLink: n?.kind === 'link' }
    })
  },
  async rm(p, o) { vfs.remove(p, !!o?.recursive, !!o?.force) },
  async cp(a, b, o) {
    const copy = (x: string, y: string) => {
      const n = vfs.must(x, 'cp')
      if (n.kind === 'dir') {
        if (!o?.recursive) throw new vfs.FsError('EISDIR', 'cp', x)
        vfs.mkdir(y, true)
        for (const k of vfs.list(x)) copy(`${x}/${k}`, `${y}/${k}`)
      } else vfs.write(y, new Uint8Array(vfs.read(x)))
    }
    copy(a, b)
  },
  async mv(a, b) { vfs.rename(a, b) },
  resolvePath(base, p) { return vfs.norm(p, base) },
  getAllPaths() { return vfs.allPaths() },
  async chmod(p, mode) { vfs.chmod(p, mode) },
  async symlink(target, p) { vfs.symlink(target, p) },
  async link(a, b) { vfs.write(b, new Uint8Array(vfs.read(a))) },
  async readlink(p) {
    const n = vfs.must(p, 'readlink', false)
    if (n.kind !== 'link') throw new vfs.FsError('EINVAL', 'readlink', p)
    return n.target
  },
  async realpath(p) { const r = vfs.real(p); vfs.must(r, 'realpath'); return r },
  async utimes(p, _a, m) { vfs.utimes(p, m.getTime()) },
}

// Commands people and agents expect that a browser cannot run get a clear answer, not a mystery.
const NOT_HERE = ['node', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'deno', 'git', 'pip', 'pip3', 'make', 'cargo', 'go', 'docker', 'brew', 'apt', 'apt-get', 'sudo', 'open', 'xdg-open', 'code']
const unavailable = NOT_HERE.map((name) =>
  defineCommand(name, async () => ({
    stdout: '',
    stderr: `${name}: not available in the browser version of Lunchbox. Files, text tools (ls, cat, grep, sed, awk, find, jq, diff, tar, sqlite3) and curl work here.\n`,
    exitCode: 127,
  })),
)

let shell: Bash | null = null
export function bash() {
  return (shell ??= new Bash({
    fs: shellFs,
    cwd: HOME,
    env: { HOME, USER: 'you', LOGNAME: 'you', SHELL: '/bin/bash', PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'en_US.UTF-8', TERM: 'dumb', TMPDIR: '/tmp' },
    network: { dangerouslyAllowFullInternetAccess: true },
    customCommands: unavailable,
    executionLimits: { maxCommandCount: 1_000_000, maxLoopIterations: 1_000_000 },
  } as ConstructorParameters<typeof Bash>[0]))
}

export type Ran = { stdout: string; stderr: string; exitCode: number }

export async function exec(script: string, o: { cwd?: string; env?: Record<string, string>; stdin?: string; signal?: AbortSignal } = {}): Promise<Ran> {
  const cwd = o.cwd && vfs.get(o.cwd)?.kind === 'dir' ? vfs.real(o.cwd) : HOME
  try {
    const r = await bash().exec(script, { cwd, env: o.env, stdin: o.stdin, signal: o.signal, rawScript: true })
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }
  } catch (e) {
    return { stdout: '', stderr: `${(e as Error).message}\n`, exitCode: o.signal?.aborted ? 143 : 1 }
  }
}
