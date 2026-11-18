// `node` and `npm` for the browser shell. node runs a script in a worker (web/node-worker.ts) with
// the project's files; npm runs the scripts in package.json, since packages cannot be installed.
import { defineCommand } from 'just-bash/browser'
import * as vfs from './vfs'

const SKIP = new Set(['.git', '.lunchbox', '.cache', '.next', 'dist', 'build', 'out', 'coverage'])
const MAX_FILES = 6000
const MAX_BYTES = 60 << 20

// The project a script belongs to: the nearest folder above with a package.json, else the folder.
function projectOf(cwd: string) {
  for (let d = cwd; ; d = d.slice(0, d.lastIndexOf('/')) || '/') {
    if (vfs.get(`${d === '/' ? '' : d}/package.json`)?.kind === 'file') return d
    if (d === '/' || d === '/home/you' || d.split('/').length <= 3) return cwd
  }
}

function snapshot(root: string, also: string[]) {
  const out: [string, Uint8Array][] = []
  let bytes = 0
  const walk = (dir: string) => {
    let names: string[]
    try { names = vfs.list(dir) } catch { return }
    for (const n of names) {
      if (out.length >= MAX_FILES || bytes >= MAX_BYTES) return
      const p = `${dir === '/' ? '' : dir}/${n}`
      const node = vfs.get(p)
      if (node?.kind === 'dir') { if (!SKIP.has(n)) walk(p) }
      else if (node?.kind === 'file') { out.push([p, new Uint8Array(node.data)]); bytes += node.data.length }
    }
  }
  walk(root)
  for (const f of also) { const n = vfs.get(f); if (n?.kind === 'file' && !out.some(([p]) => p === f)) out.push([f, new Uint8Array(n.data)]) }
  return out
}

const TESTS = /(^|\/)(test|tests|__tests__)\/.*\.(c|m)?js$|[.-_]test\.(c|m)?js$|[.-_]spec\.(c|m)?js$|(^|\/)test\.(c|m)?js$/

type Ran = { stdout: string; stderr: string; exitCode: number }

function runWorker(job: { cwd: string; env: Record<string, string>; argv: string[]; script?: string; code?: string; print?: boolean; tests?: string[] }, root: string): Promise<Ran> {
  return new Promise((done) => {
    const w = new Worker(new URL('./node-worker.ts', import.meta.url), { type: 'module' })
    let stdout = '', stderr = ''
    const cap = (s: string, add: string) => (s.length > 4_000_000 ? s : s + add)
    const stop = setTimeout(() => { w.terminate(); done({ stdout, stderr: stderr + '\nStopped after 10 minutes.\n', exitCode: 124 }) }, 10 * 60 * 1000)
    w.onmessage = (e) => {
      const m = e.data
      if (m.t === 'out') stdout = cap(stdout, m.s)
      else if (m.t === 'err') stderr = cap(stderr, m.s)
      else if (m.t === 'exit') {
        clearTimeout(stop)
        w.terminate()
        for (const p of m.removes as string[]) { try { vfs.remove(p, true, true) } catch {} }
        for (const [p, data] of m.writes as [string, Uint8Array][]) {
          try { vfs.mkdir(p.slice(0, p.lastIndexOf('/')) || '/', true); vfs.write(p, data) } catch {}
        }
        done({ stdout, stderr, exitCode: m.code })
      }
    }
    w.onerror = (e) => { clearTimeout(stop); w.terminate(); done({ stdout, stderr: `${stderr}${e.message}\n`, exitCode: 1 }) }
    w.postMessage({ ...job, files: snapshot(root, job.script?.startsWith('/') ? [job.script] : []) })
  })
}

const envOf = (ctx: { env: Map<string, string> }) => Object.fromEntries(ctx.env)

export const nodeCommand = defineCommand('node', async (args, ctx) => {
  const a = [...args]
  if (a[0] === '-v' || a[0] === '--version') return { stdout: 'v22.0.0\n', stderr: '', exitCode: 0 }
  // Flags that change nothing here are let through.
  while (a[0] && /^--(experimental|no-warnings|enable-source-maps|trace|inspect|max-old-space|stack-trace)/.test(a[0])) a.shift()
  const root = projectOf(ctx.cwd)
  const env = envOf(ctx)
  if (a[0] === '-e' || a[0] === '--eval' || a[0] === '-p' || a[0] === '--print') {
    return runWorker({ cwd: ctx.cwd, env, argv: a.slice(2), code: a[1] ?? '', print: a[0] === '-p' || a[0] === '--print' }, root)
  }
  if (a[0] === '--test') {
    let tests = a.slice(1).filter((x) => !x.startsWith('-')).map((x) => vfs.norm(x, ctx.cwd))
    if (!tests.length) tests = snapshot(ctx.cwd, []).map(([p]) => p).filter((p) => !p.includes('/node_modules/') && TESTS.test(p.slice(ctx.cwd.length)))
    if (!tests.length) return { stdout: '', stderr: 'Could not find any test files\n', exitCode: 1 }
    return runWorker({ cwd: ctx.cwd, env, argv: [], tests }, root)
  }
  if (!a[0]) return { stdout: '', stderr: 'node: an interactive prompt is not available here. Run a file with node file.js or code with node -e "..."\n', exitCode: 9 }
  const script = a[0].startsWith('/') ? a[0] : vfs.norm(a[0], ctx.cwd)
  return runWorker({ cwd: ctx.cwd, env, argv: a.slice(1), script }, root)
})

export const npmCommand = defineCommand('npm', async (args, ctx) => {
  const [cmd, ...rest] = args
  if (cmd === '-v' || cmd === '--version') return { stdout: '10.0.0\n', stderr: '', exitCode: 0 }
  const runScript = cmd === 'test' || cmd === 't' || cmd === 'start' || cmd === 'run' || cmd === 'run-script'
  if (!runScript) return { stdout: '', stderr: `npm ${cmd ?? ''}: only npm test, npm start and npm run work in the browser version of Lunchbox. Packages cannot be installed here.\n`, exitCode: 1 }
  const name = cmd === 'run' || cmd === 'run-script' ? rest.shift() : cmd === 't' ? 'test' : cmd
  const root = projectOf(ctx.cwd)
  const pj = vfs.get(`${root}/package.json`)
  if (pj?.kind !== 'file') return { stdout: '', stderr: `npm error Missing package.json in ${ctx.cwd}\n`, exitCode: 1 }
  let scripts: Record<string, string> = {}
  try { scripts = JSON.parse(new TextDecoder().decode(pj.data)).scripts ?? {} } catch { return { stdout: '', stderr: 'npm error package.json is not valid JSON\n', exitCode: 1 } }
  if (!name) return { stdout: Object.entries(scripts).map(([k, v]) => `  ${k}\n    ${v}`).join('\n') + '\n', stderr: '', exitCode: 0 }
  const script = scripts[name] ?? (name === 'start' ? 'node server.js' : undefined)
  if (!script) return { stdout: '', stderr: `npm error Missing script: "${name}"\n`, exitCode: 1 }
  const extra = rest[0] === '--' ? rest.slice(1) : rest
  const line = `${script}${extra.length ? ' ' + extra.map((x) => `'${x.replace(/'/g, `'\\''`)}'`).join(' ') : ''}`
  const head = `\n> ${name}\n> ${line}\n\n`
  if (!ctx.exec) return { stdout: '', stderr: 'npm: cannot run scripts here\n', exitCode: 1 }
  const r = await ctx.exec(line, { cwd: root })
  return { stdout: head + r.stdout, stderr: r.stderr, exitCode: r.exitCode }
})
