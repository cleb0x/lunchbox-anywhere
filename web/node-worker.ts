// A small Node.js for the browser version's shell: runs a script in a worker with CommonJS and ES
// modules, the core modules scripts and tests use most (fs, path, assert, util, events, os,
// node:test, timers) and the project's files. Files it writes go back to Lunchbox when it ends.
// It is not all of Node: no network servers, no child processes, no native modules.
import { init, parse } from 'es-module-lexer'
import path from 'path-browserify'
import { EventEmitter } from 'events'

type Job = { files: [string, Uint8Array][]; cwd: string; env: Record<string, string>; argv: string[]; script?: string; code?: string; print?: boolean; tests?: string[] }

const enc = new TextEncoder()
const dec = new TextDecoder()
const files = new Map<string, Uint8Array>()
const dirs = new Set<string>(['/'])
const written = new Set<string>()
const removed = new Set<string>()
let cwd = '/'

const post = (m: unknown) => (self as unknown as Worker).postMessage(m)
const out = (s: string) => post({ t: 'out', s })
const err = (s: string) => post({ t: 'err', s })

class Exit extends Error { constructor(public code: number) { super('exit') } }

// --- Files -------------------------------------------------------------------------------------

const abs = (p: string) => path.resolve(cwd, String(p))
const addDirs = (p: string) => { for (let d = path.dirname(p); !dirs.has(d); d = path.dirname(d)) dirs.add(d) }
const fsErr = (code: string, op: string, p: string) => Object.assign(new Error(`${code}: ${({ ENOENT: 'no such file or directory', EISDIR: 'illegal operation on a directory', ENOTDIR: 'not a directory', EEXIST: 'file already exists', ENOTEMPTY: 'directory not empty' } as Record<string, string>)[code] ?? code}, ${op} '${p}'`), { code, syscall: op, path: p })
const encOf = (o: unknown) => (typeof o === 'string' ? o : (o as { encoding?: string } | undefined)?.encoding)
const children = (d: string) => {
  const pre = d === '/' ? '/' : d + '/'
  const names = new Set<string>()
  for (const k of [...files.keys(), ...dirs]) if (k.startsWith(pre) && k !== d) names.add(k.slice(pre.length).split('/')[0])
  return [...names].sort()
}
const toBytes = (data: unknown) => (typeof data === 'string' ? enc.encode(data) : data instanceof Uint8Array ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)) : enc.encode(String(data)))
const decode = (b: Uint8Array, e?: string) => (e === 'base64' ? btoa(String.fromCharCode(...b)) : e === 'hex' ? [...b].map((x) => x.toString(16).padStart(2, '0')).join('') : dec.decode(b))

class Stats {
  constructor(private file: boolean, public size: number) {}
  isFile() { return this.file }
  isDirectory() { return !this.file }
  isSymbolicLink() { return false }
  mtime = new Date()
  mtimeMs = Date.now()
  mode = 0o644
}

const fs = {
  existsSync: (p: string) => files.has(abs(p)) || dirs.has(abs(p)),
  readFileSync(p: string, o?: unknown) {
    const a = abs(p)
    if (dirs.has(a)) throw fsErr('EISDIR', 'read', a)
    const b = files.get(a)
    if (!b) throw fsErr('ENOENT', 'open', a)
    const e = encOf(o)
    return e ? decode(b, e) : new Uint8Array(b)
  },
  writeFileSync(p: string, data: unknown) { const a = abs(p); if (!dirs.has(path.dirname(a))) throw fsErr('ENOENT', 'open', a); files.set(a, toBytes(data)); written.add(a); removed.delete(a) },
  appendFileSync(p: string, data: unknown) { const a = abs(p); const old = files.get(a) ?? new Uint8Array(0); const add = toBytes(data); const n = new Uint8Array(old.length + add.length); n.set(old); n.set(add, old.length); fs.writeFileSync(a, n) },
  mkdirSync(p: string, o?: { recursive?: boolean }) {
    const a = abs(p)
    if (dirs.has(a)) { if (o?.recursive) return; throw fsErr('EEXIST', 'mkdir', a) }
    if (!dirs.has(path.dirname(a)) && !o?.recursive) throw fsErr('ENOENT', 'mkdir', a)
    addDirs(a + '/x'); dirs.add(a)
  },
  readdirSync(p: string, o?: { withFileTypes?: boolean }) {
    const a = abs(p)
    if (!dirs.has(a)) throw fsErr(files.has(a) ? 'ENOTDIR' : 'ENOENT', 'scandir', a)
    const names = children(a)
    return o?.withFileTypes ? names.map((name) => { const f = files.has(path.join(a, name)); return { name, isFile: () => f, isDirectory: () => !f, isSymbolicLink: () => false } }) : names
  },
  statSync(p: string, o?: { throwIfNoEntry?: boolean }) {
    const a = abs(p)
    if (files.has(a)) return new Stats(true, files.get(a)!.length)
    if (dirs.has(a)) return new Stats(false, 4096)
    if (o?.throwIfNoEntry === false) return undefined
    throw fsErr('ENOENT', 'stat', a)
  },
  rmSync(p: string, o?: { recursive?: boolean; force?: boolean }) {
    const a = abs(p)
    if (files.delete(a)) { removed.add(a); written.delete(a); return }
    if (dirs.has(a)) {
      if (children(a).length && !o?.recursive) throw fsErr('ENOTEMPTY', 'rm', a)
      for (const k of [...files.keys()]) if (k.startsWith(a + '/')) { files.delete(k); removed.add(k); written.delete(k) }
      for (const d of [...dirs]) if (d === a || d.startsWith(a + '/')) dirs.delete(d)
      removed.add(a)
      return
    }
    if (!o?.force) throw fsErr('ENOENT', 'rm', a)
  },
  renameSync(a: string, b: string) { const x = abs(a); const data = files.get(x); if (!data) throw fsErr('ENOENT', 'rename', x); fs.writeFileSync(b, data); fs.rmSync(x) },
  copyFileSync(a: string, b: string) { fs.writeFileSync(b, fs.readFileSync(a) as Uint8Array) },
  realpathSync: (p: string) => { const a = abs(p); if (!fs.existsSync(a)) throw fsErr('ENOENT', 'realpath', a); return a },
  accessSync: (p: string) => { if (!fs.existsSync(p)) throw fsErr('ENOENT', 'access', abs(p)) },
  mkdtempSync: (pre: string) => { const d = `${pre}${Math.random().toString(36).slice(2, 8)}`; fs.mkdirSync(d, { recursive: true }); return abs(d) },
  constants: { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 },
} as Record<string, any>
fs.unlinkSync = fs.rmSync
fs.rmdirSync = fs.rmSync
fs.lstatSync = fs.statSync
fs.realpathSync.native = fs.realpathSync
const promisified = (fn: (...a: any[]) => unknown) => async (...a: any[]) => fn(...a)
const fsPromises: Record<string, unknown> = {}
for (const [k, v] of Object.entries(fs)) if (k.endsWith('Sync')) {
  const name = k.slice(0, -4)
  fsPromises[name] = promisified(v)
  fs[name] = (...a: any[]) => { const done = typeof a[a.length - 1] === 'function' ? a.pop() : null; try { const r = v(...a); done && setTimeout(() => done(null, r)) } catch (e) { done && setTimeout(() => done(e)) } }
}
fs.promises = fsPromises

// --- util, assert --------------------------------------------------------------------------------

function inspect(v: unknown, depth = 2, seen = new Set<unknown>()): string {
  if (typeof v === 'string') return depth === 2 ? v : `'${v}'`
  if (typeof v === 'function') return `[Function: ${v.name || '(anonymous)'}]`
  if (typeof v === 'bigint') return `${v}n`
  if (typeof v === 'symbol') return v.toString()
  if (v === null || typeof v !== 'object') return String(v)
  if (seen.has(v)) return '[Circular]'
  if (v instanceof Error) return v.stack ?? `${v.name}: ${v.message}`
  if (v instanceof Date) return v.toISOString()
  if (v instanceof RegExp) return String(v)
  if (depth < 0) return Array.isArray(v) ? '[Array]' : '[Object]'
  seen.add(v)
  const inner = (x: unknown) => inspect(x, depth - 1 < 2 ? depth - 1 : 1, seen)
  if (Array.isArray(v)) return `[ ${v.map(inner).join(', ')} ]`.replace('[  ]', '[]')
  if (v instanceof Map) return `Map(${v.size}) { ${[...v].map(([k, x]) => `${inner(k)} => ${inner(x)}`).join(', ')} }`
  if (v instanceof Set) return `Set(${v.size}) { ${[...v].map(inner).join(', ')} }`
  const entries = Object.entries(v as object).map(([k, x]) => `${/^[a-zA-Z_$][\w$]*$/.test(k) ? k : `'${k}'`}: ${inner(x)}`)
  const name = (v as object).constructor?.name
  return `${name && name !== 'Object' ? name + ' ' : ''}{ ${entries.join(', ')} }`.replace('{  }', '{}')
}
const show = (v: unknown) => inspect(v, 1)
function format(...a: unknown[]): string {
  if (typeof a[0] !== 'string') return a.map((x) => inspect(x)).join(' ')
  let i = 1
  const s = (a[0] as string).replace(/%[sdifjoO%]/g, (m) => {
    if (m === '%%') return '%'
    if (i >= a.length) return m
    const x = a[i++]
    return m === '%s' ? String(x) : m === '%d' || m === '%i' ? String(parseInt(String(x), 10)) : m === '%f' ? String(parseFloat(String(x))) : m === '%j' ? JSON.stringify(x) : inspect(x, 1)
  })
  return [s, ...a.slice(i).map((x) => inspect(x))].join(' ')
}

function deepEqual(a: any, b: any, strict: boolean, seen = new Map()): boolean {
  if (strict ? Object.is(a, b) : a == b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false
  if (strict && Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false
  if (seen.get(a) === b) return true
  seen.set(a, b)
  if (a instanceof Date) return b instanceof Date && a.getTime() === b.getTime()
  if (a instanceof RegExp) return String(a) === String(b)
  if (a instanceof Map) return b instanceof Map && a.size === b.size && [...a].every(([k, v]) => b.has(k) && deepEqual(v, b.get(k), strict, seen))
  if (a instanceof Set) return b instanceof Set && a.size === b.size && [...a].every((v) => b.has(v))
  const ka = Object.keys(a), kb = Object.keys(b)
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k], strict, seen))
}

class AssertionError extends Error {
  code = 'ERR_ASSERTION'
  actual: unknown; expected: unknown; operator: string
  constructor(o: { message?: string; actual?: unknown; expected?: unknown; operator?: string }) {
    super(o.message ?? `Expected values to be ${o.operator}:\n\n${show(o.actual)}\n\nshould equal\n\n${show(o.expected)}`)
    this.name = 'AssertionError'
    this.actual = o.actual; this.expected = o.expected; this.operator = o.operator ?? ''
  }
}
const fail = (actual: unknown, expected: unknown, message: unknown, operator: string, def?: string) => {
  if (message instanceof Error) throw message
  throw new AssertionError({ message: (message as string | undefined) ?? def, actual, expected, operator })
}
const matches = (e: unknown, expected: unknown) => {
  if (!expected) return true
  if (typeof expected === 'function') return (expected as { prototype?: unknown }).prototype !== undefined && e instanceof (expected as new () => unknown) ? true : expected === Error || (expected as { prototype?: unknown }).prototype ? e instanceof (expected as new () => unknown) : (expected as (e: unknown) => boolean)(e) === true
  if (expected instanceof RegExp) return expected.test(String((e as Error)?.message ?? e))
  if (typeof expected === 'object') return Object.entries(expected as object).every(([k, v]) => v instanceof RegExp ? v.test(String((e as any)?.[k])) : deepEqual((e as any)?.[k], v, true))
  return true
}
function makeAssert(strict: boolean) {
  const assert: any = (v: unknown, m?: unknown) => { if (!v) fail(v, true, m, '==', 'The expression evaluated to a falsy value') }
  Object.assign(assert, {
    ok: assert,
    equal: (a: unknown, b: unknown, m?: unknown) => { if (strict ? !Object.is(a, b) : a != b) fail(a, b, m, strict ? 'strictEqual' : '==') },
    notEqual: (a: unknown, b: unknown, m?: unknown) => { if (strict ? Object.is(a, b) : a == b) fail(a, b, m, strict ? 'notStrictEqual' : '!=', `Expected "actual" to be strictly unequal to: ${show(b)}`) },
    strictEqual: (a: unknown, b: unknown, m?: unknown) => { if (!Object.is(a, b)) fail(a, b, m, 'strictEqual') },
    notStrictEqual: (a: unknown, b: unknown, m?: unknown) => { if (Object.is(a, b)) fail(a, b, m, 'notStrictEqual', `Expected "actual" to be strictly unequal to: ${show(b)}`) },
    deepEqual: (a: unknown, b: unknown, m?: unknown) => { if (!deepEqual(a, b, strict)) fail(a, b, m, strict ? 'deepStrictEqual' : 'deepEqual') },
    deepStrictEqual: (a: unknown, b: unknown, m?: unknown) => { if (!deepEqual(a, b, true)) fail(a, b, m, 'deepStrictEqual') },
    notDeepEqual: (a: unknown, b: unknown, m?: unknown) => { if (deepEqual(a, b, strict)) fail(a, b, m, 'notDeepEqual', 'Expected "actual" not to be deep-equal to "expected"') },
    notDeepStrictEqual: (a: unknown, b: unknown, m?: unknown) => { if (deepEqual(a, b, true)) fail(a, b, m, 'notDeepStrictEqual', 'Expected "actual" not to be strictly deep-equal to "expected"') },
    throws: (fn: () => unknown, expected?: unknown, m?: unknown) => {
      try { fn() } catch (e) { if (!matches(e, expected)) throw e; return }
      fail(undefined, expected, typeof expected === 'string' ? expected : m, 'throws', 'Missing expected exception.')
    },
    doesNotThrow: (fn: () => unknown, m?: unknown) => { try { fn() } catch (e) { fail(e, undefined, m, 'doesNotThrow', `Got unwanted exception.\nActual message: "${(e as Error)?.message}"`) } },
    rejects: async (p: Promise<unknown> | (() => Promise<unknown>), expected?: unknown, m?: unknown) => {
      try { await (typeof p === 'function' ? p() : p) } catch (e) { if (!matches(e, expected)) throw e; return }
      fail(undefined, expected, typeof expected === 'string' ? expected : m, 'rejects', 'Missing expected rejection.')
    },
    doesNotReject: async (p: Promise<unknown> | (() => Promise<unknown>), m?: unknown) => { try { await (typeof p === 'function' ? p() : p) } catch (e) { fail(e, undefined, m, 'doesNotReject', 'Got unwanted rejection.') } },
    match: (s: string, re: RegExp, m?: unknown) => { if (!re.test(s)) fail(s, re, m, 'match', `The input did not match the regular expression ${re}. Input:\n\n${show(s)}`) },
    doesNotMatch: (s: string, re: RegExp, m?: unknown) => { if (re.test(s)) fail(s, re, m, 'doesNotMatch', `The input was expected to not match the regular expression ${re}`) },
    fail: (m?: unknown) => fail(undefined, undefined, m ?? 'Failed', 'fail'),
    ifError: (v: unknown) => { if (v !== null && v !== undefined) throw v },
    AssertionError,
  })
  assert.strict = strict ? assert : makeAssert(true)
  return assert
}
const assert = makeAssert(false)

const util = {
  format, inspect: (v: unknown, o?: { depth?: number }) => inspect(v, o?.depth ?? 2),
  promisify: (fn: (...a: any[]) => void) => (...a: unknown[]) => new Promise((ok, no) => fn(...a, (e: unknown, r: unknown) => (e ? no(e) : ok(r)))),
  isDeepStrictEqual: (a: unknown, b: unknown) => deepEqual(a, b, true),
  types: { isPromise: (v: unknown) => v instanceof Promise, isDate: (v: unknown) => v instanceof Date, isRegExp: (v: unknown) => v instanceof RegExp },
  inherits: (c: { prototype: object }, p: { prototype: object }) => { Object.setPrototypeOf(c.prototype, p.prototype) },
  deprecate: <T,>(fn: T) => fn,
  TextEncoder, TextDecoder,
}

// --- console, process, timers ------------------------------------------------------------------

const counts = new Map<string, number>()
const times = new Map<string, number>()
let indent = ''
const consoleObj = {
  log: (...a: unknown[]) => out(indent + format(...a) + '\n'),
  info: (...a: unknown[]) => out(indent + format(...a) + '\n'),
  debug: (...a: unknown[]) => out(indent + format(...a) + '\n'),
  error: (...a: unknown[]) => err(indent + format(...a) + '\n'),
  warn: (...a: unknown[]) => err(indent + format(...a) + '\n'),
  trace: (...a: unknown[]) => err(indent + 'Trace: ' + format(...a) + '\n'),
  dir: (v: unknown) => out(indent + inspect(v, 2) + '\n'),
  table: (v: unknown) => out(indent + JSON.stringify(v, null, 2) + '\n'),
  assert: (v: unknown, ...a: unknown[]) => { if (!v) err('Assertion failed' + (a.length ? ': ' + format(...a) : '') + '\n') },
  count: (l = 'default') => { counts.set(l, (counts.get(l) ?? 0) + 1); out(`${l}: ${counts.get(l)}\n`) },
  time: (l = 'default') => { times.set(l, performance.now()) },
  timeEnd: (l = 'default') => { out(`${l}: ${(performance.now() - (times.get(l) ?? 0)).toFixed(3)}ms\n`); times.delete(l) },
  timeLog: (l = 'default') => { out(`${l}: ${(performance.now() - (times.get(l) ?? 0)).toFixed(3)}ms\n`) },
  group: (...a: unknown[]) => { if (a.length) consoleObj.log(...a); indent += '  ' },
  groupEnd: () => { indent = indent.slice(2) },
}

let active = 0
const timers = new Map<number, 'once' | 'repeat'>()
const realSet = setTimeout, realClear = clearTimeout, realInt = setInterval, realClearInt = clearInterval
const wrapTimer = (id: number) => Object.assign(Object(id), { unref() { if (timers.has(id)) { timers.delete(id); active-- } return this }, ref() { return this }, hasRef: () => timers.has(id), [Symbol.toPrimitive]: () => id })
const g = globalThis as any
g.setTimeout = (fn: (...a: unknown[]) => void, ms?: number, ...a: unknown[]) => {
  const id = realSet(() => { if (timers.delete(id)) active--; fn(...a) }, ms) as unknown as number
  timers.set(id, 'once'); active++
  return wrapTimer(id)
}
g.setInterval = (fn: (...a: unknown[]) => void, ms?: number, ...a: unknown[]) => {
  const id = realInt(() => fn(...a), ms) as unknown as number
  timers.set(id, 'repeat'); active++
  return wrapTimer(id)
}
g.clearTimeout = g.clearInterval = (t: unknown) => { const id = Number(t); if (timers.delete(id)) active--; realClear(id); realClearInt(id) }
g.setImmediate = (fn: (...a: unknown[]) => void, ...a: unknown[]) => g.setTimeout(fn, 0, ...a)
g.clearImmediate = g.clearTimeout

const proc = Object.assign(new EventEmitter(), {
  argv: ['/usr/local/bin/node'], env: {} as Record<string, string>, platform: 'linux', arch: 'x64', pid: 42, version: 'v22.0.0', versions: { node: '22.0.0' },
  exitCode: undefined as number | undefined,
  cwd: () => cwd, chdir: (d: string) => { cwd = abs(d) },
  exit: (code?: number) => { throw new Exit(code ?? proc.exitCode ?? 0) },
  nextTick: (fn: (...a: unknown[]) => void, ...a: unknown[]) => queueMicrotask(() => fn(...a)),
  hrtime: Object.assign((p?: [number, number]) => { const t = performance.now() * 1e6; const s = Math.floor(t / 1e9), n = Math.floor(t % 1e9); return p ? [s - p[0], n - p[1]] : [s, n] }, { bigint: () => BigInt(Math.floor(performance.now() * 1e6)) }),
  memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0 }),
  uptime: () => performance.now() / 1000,
  stdout: { write: (s: unknown) => { out(String(s)); return true }, isTTY: false, columns: 100 },
  stderr: { write: (s: unknown) => { err(String(s)); return true }, isTTY: false },
  stdin: Object.assign(new EventEmitter(), { isTTY: false, setEncoding() {}, resume() {} }),
})
g.process = proc
g.global = globalThis
g.console = consoleObj

// --- node:test ------------------------------------------------------------------------------------

type T = { name: string; fn?: (t: unknown, done?: (e?: unknown) => void) => unknown; kids: T[]; skip?: boolean; todo?: boolean; only?: boolean; suite: boolean; before: (() => unknown)[]; after: (() => unknown)[]; beforeEach: (() => unknown)[]; afterEach: (() => unknown)[] }
const rootSuite: T = { name: '', kids: [], suite: true, before: [], after: [], beforeEach: [], afterEach: [] }
let current = rootSuite
const tally = { tests: 0, pass: 0, fail: 0, skipped: 0, todo: 0, suites: 0 }
let testing = false
const failures: string[] = []

function addTest(suite: boolean, name: unknown, a?: unknown, b?: unknown) {
  const fn = (typeof name === 'function' ? name : typeof a === 'function' ? a : b) as T['fn']
  const opts = (typeof a === 'object' && a ? a : {}) as { skip?: boolean; todo?: boolean; only?: boolean }
  const t: T = { name: typeof name === 'string' ? name : fn?.name || '<anonymous>', fn, kids: [], suite, skip: !!opts.skip, todo: !!opts.todo, only: !!opts.only, before: [], after: [], beforeEach: [], afterEach: [] }
  current.kids.push(t)
  if (suite && fn) { const prev = current; current = t; try { fn(undefined) } finally { current = prev } }
  if (!testing) { testing = true; queueMicrotask(() => { void runTests() }) }
  return Promise.resolve()
}
const ctxFor = (t: T) => ({ name: t.name, diagnostic: (s: string) => out(`# ${s}\n`), skip: () => { t.skip = true }, todo: () => { t.todo = true }, test: (n: unknown, a?: unknown, b?: unknown) => { const prev = current; current = t; addTest(false, n, a, b); current = prev; return run(t.kids[t.kids.length - 1], '    ', [t]) }, mock: mock, assert })

async function run(t: T, pad: string, parents: T[]): Promise<void> {
  const each = parents.flatMap((p) => p.beforeEach), eachAfter = parents.flatMap((p) => p.afterEach).reverse()
  if (t.suite) {
    tally.suites++
    out(`${pad}▶ ${t.name}\n`)
    for (const h of t.before) await h()
    const t0 = performance.now(), failed = tally.fail
    for (const k of t.kids) await run(k, pad + '  ', [...parents, t])
    for (const h of t.after) await h()
    out(`${pad}${tally.fail > failed ? '✖' : '✔'} ${t.name} (${(performance.now() - t0).toFixed(3)}ms)\n`)
    return
  }
  tally.tests++
  if (t.skip || t.todo) { if (t.skip) tally.skipped++; else tally.todo++; out(`${pad}﹣ ${t.name} # ${t.skip ? 'SKIP' : 'TODO'}\n`); return }
  const t0 = performance.now()
  try {
    for (const h of each) await h()
    const fn = t.fn!
    if (fn.length >= 2) await new Promise<void>((ok, no) => fn.call(null, ctxFor(t), (e?: unknown) => (e ? no(e) : ok())))
    else await fn(ctxFor(t))
    for (const h of eachAfter) await h()
    tally.pass++
    out(`${pad}✔ ${t.name} (${(performance.now() - t0).toFixed(3)}ms)\n`)
  } catch (e) {
    tally.fail++
    out(`${pad}✖ ${t.name} (${(performance.now() - t0).toFixed(3)}ms)\n`)
    const text = e instanceof Error ? clean(`${e.stack ?? e.message}`) : inspect(e)
    out(text.split('\n').map((l) => `${pad}  ${l}`).join('\n') + '\n')
    failures.push(`${t.name}: ${(e as Error)?.message ?? e}`)
    proc.exitCode = 1
  }
}

let testsDone: Promise<void> = Promise.resolve()
async function runTests() {
  // Tests declared in the same tick run together, after the file has loaded.
  await new Promise((r) => realSet(r, 0))
  testsDone = (async () => {
    const list = rootSuite.kids.splice(0)
    const only = list.some((t) => t.only)
    for (const t of only ? list.filter((x) => x.only) : list) await run(t, '', [rootSuite])
    testing = false
  })()
  await testsDone
}

const hook = (k: 'before' | 'after' | 'beforeEach' | 'afterEach') => (fn: () => unknown) => { current[k].push(fn) }
const mock = {
  fn: (impl: (...a: unknown[]) => unknown = () => undefined) => {
    const calls: { arguments: unknown[]; result?: unknown }[] = []
    const f = (...a: unknown[]) => { const result = impl(...a); calls.push({ arguments: a, result }); return result }
    return Object.assign(f, { mock: { calls, callCount: () => calls.length, resetCalls: () => { calls.length = 0 } } })
  },
  method: (o: Record<string, any>, k: string, impl?: (...a: unknown[]) => unknown) => { const orig = o[k]; o[k] = mock.fn(impl ?? orig.bind(o)); o[k].mock.restore = () => { o[k] = orig }; return o[k] },
  restoreAll: () => {},
}
const testApi: any = (n: unknown, a?: unknown, b?: unknown) => addTest(false, n, a, b)
Object.assign(testApi, {
  test: testApi, it: testApi, describe: (n: unknown, a?: unknown, b?: unknown) => addTest(true, n, a, b), suite: (n: unknown, a?: unknown, b?: unknown) => addTest(true, n, a, b),
  before: hook('before'), after: hook('after'), beforeEach: hook('beforeEach'), afterEach: hook('afterEach'), mock,
})
testApi.skip = (n: unknown, f?: unknown) => addTest(false, n, { skip: true }, f)
testApi.todo = (n: unknown, f?: unknown) => addTest(false, n, { todo: true }, f)
testApi.only = (n: unknown, f?: unknown) => addTest(false, n, { only: true }, f)
testApi.describe.skip = (n: unknown, f?: unknown) => addTest(true, n, { skip: true }, f)
testApi.it.skip = testApi.skip
testApi.default = testApi

// --- Modules ------------------------------------------------------------------------------------

const os = { EOL: '\n', platform: () => 'linux', type: () => 'Linux', arch: () => 'x64', homedir: () => '/home/you', tmpdir: () => '/tmp', hostname: () => 'browser', cpus: () => [{ model: 'browser' }], totalmem: () => 8 * 2 ** 30, freemem: () => 4 * 2 ** 30, release: () => '6.0.0', userInfo: () => ({ username: 'you', homedir: '/home/you' }) }
const url = { pathToFileURL: (p: string) => new URL(`file://${abs(p)}`), fileURLToPath: (u: string | URL) => decodeURIComponent(new URL(String(u)).pathname), URL, URLSearchParams }
const unavailable = (name: string) => new Proxy({}, { get: (_t, k) => (k === '__esModule' || k === 'then' ? undefined : () => { throw new Error(`${name} is not available in the browser version of Lunchbox`) }) })

const BUILTINS: Record<string, unknown> = {
  fs, 'fs/promises': fsPromises, path, 'path/posix': path, assert, 'assert/strict': assert.strict, util, events: Object.assign(EventEmitter, { EventEmitter, once: (e: EventEmitter, n: string) => new Promise((r) => e.once(n, (...a: unknown[]) => r(a))) }),
  os, url, process: proc, console: consoleObj, test: testApi, timers: { setTimeout: g.setTimeout, setInterval: g.setInterval, clearTimeout: g.clearTimeout, clearInterval: g.clearInterval, setImmediate: g.setImmediate },
  'timers/promises': { setTimeout: (ms: number, v?: unknown) => new Promise((r) => g.setTimeout(() => r(v), ms)), setImmediate: (v?: unknown) => new Promise((r) => g.setTimeout(() => r(v), 0)) },
  crypto: { randomUUID: () => crypto.randomUUID(), randomInt: (a: number, b?: number) => (b === undefined ? Math.floor(Math.random() * a) : a + Math.floor(Math.random() * (b - a))), getRandomValues: (x: Uint8Array<ArrayBuffer>) => crypto.getRandomValues(x), webcrypto: crypto },
  child_process: unavailable('child_process'), http: unavailable('http'), https: unavailable('https'), net: unavailable('net'), worker_threads: unavailable('worker_threads'),
  readline: { createInterface: () => Object.assign(new EventEmitter(), { question: (_q: string, cb: (a: string) => void) => cb(''), close() {} }) },
}
const builtin = (s: string) => {
  const n = s.replace(/^node:/, '')
  return Object.prototype.hasOwnProperty.call(BUILTINS, n) ? BUILTINS[n] : undefined
}

const EXT = ['', '.js', '.mjs', '.cjs', '.json', '/index.js', '/index.mjs', '/index.cjs', '/index.json']
function resolveFile(p: string) {
  for (const e of EXT) if (files.has(p + e)) return p + e
  if (dirs.has(p) && files.has(path.join(p, 'package.json'))) {
    const pkg = JSON.parse(dec.decode(files.get(path.join(p, 'package.json'))!))
    const main = typeof pkg.exports === 'string' ? pkg.exports : pkg.exports?.['.']?.require ?? pkg.exports?.['.']?.import ?? pkg.exports?.['.']?.default ?? (typeof pkg.exports?.['.'] === 'string' ? pkg.exports['.'] : null) ?? pkg.module ?? pkg.main ?? 'index.js'
    return resolveFile(path.join(p, typeof main === 'string' ? main : 'index.js'))
  }
  return null
}
function resolve(spec: string, from: string): string {
  if (spec.startsWith('file://')) spec = url.fileURLToPath(spec)
  if (spec.startsWith('/') || spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..') {
    const r = resolveFile(path.resolve(from, spec))
    if (!r) throw Object.assign(new Error(`Cannot find module '${spec}' from '${from}'`), { code: 'MODULE_NOT_FOUND' })
    return r
  }
  const [scopeOrName, maybe] = spec.split('/')
  const name = scopeOrName.startsWith('@') ? `${scopeOrName}/${maybe}` : scopeOrName
  const sub = spec.slice(name.length)
  for (let d = from; ; d = path.dirname(d)) {
    const base = path.join(d, 'node_modules', name)
    if (dirs.has(base)) { const r = resolveFile(base + sub); if (r) return r }
    if (d === '/') break
  }
  throw Object.assign(new Error(`Cannot find package '${name}'. Packages cannot be installed in the browser version of Lunchbox (there is no npm), so use plain JavaScript and the built-in modules.`), { code: 'MODULE_NOT_FOUND' })
}

function typeOf(file: string, src: string): 'esm' | 'cjs' | 'json' {
  if (file.endsWith('.json')) return 'json'
  if (file.endsWith('.mjs')) return 'esm'
  if (file.endsWith('.cjs')) return 'cjs'
  for (let d = path.dirname(file); ; d = path.dirname(d)) {
    const pj = files.get(path.join(d, 'package.json'))
    if (pj) { try { const t = JSON.parse(dec.decode(pj)).type; if (t === 'module') return 'esm'; if (t === 'commonjs') return 'cjs' } catch {} break }
    if (d === '/') break
  }
  // No type given: a file with import or export statements is a module, as newer Node decides.
  try { const [imports, exports] = parse(src); if (exports.length || imports.some((i) => i.d === -1)) return 'esm' } catch {}
  return 'cjs'
}

type Mod = { exports: any; loaded: boolean; id: string; filename: string; children: Mod[]; paths: string[] }
const cache = new Map<string, Mod>()
function makeRequire(from: string): any {
  const req = (spec: string) => {
    const b = builtin(spec)
    if (b !== undefined) return b
    const file = resolve(spec, from)
    if (cache.has(file)) return cache.get(file)!.exports
    const src = dec.decode(files.get(file)!)
    const kind = typeOf(file, src)
    if (kind === 'json') { const m = { exports: JSON.parse(src) } as Mod; cache.set(file, m); return m.exports }
    if (kind === 'esm') throw Object.assign(new Error(`require() of ES module ${file} is not supported here. Use import instead.`), { code: 'ERR_REQUIRE_ESM' })
    const m: Mod = { exports: {}, loaded: false, id: file, filename: file, children: [], paths: [] }
    cache.set(file, m)
    const body = src.replace(/^#!.*/, '')
    // eslint-disable-next-line no-new-func
    const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', `${body}\n//# sourceURL=file://${file}`)
    fn.call(m.exports, m.exports, makeRequire(path.dirname(file)), m, file, path.dirname(file))
    m.loaded = true
    return m.exports
  }
  req.resolve = (spec: string) => (builtin(spec) !== undefined ? spec : resolve(spec, from))
  req.cache = cache
  req.main = undefined
  return req
}

const blobs = new Map<string, string>()
const blobOf = (code: string) => URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
const names = (o: unknown) => (o && (typeof o === 'object' || typeof o === 'function') ? Object.keys(o as object).filter((k) => /^[a-zA-Z_$][\w$]*$/.test(k) && k !== 'default') : [])
g.__lb = { builtin, require: (file: string) => makeRequire(path.dirname(file))(file), meta: (file: string) => ({ url: `file://${file}`, filename: file, dirname: path.dirname(file), resolve: (s: string) => `file://${resolve(s, path.dirname(file))}` }) }

function builtinUrl(spec: string) {
  const key = `builtin:${spec}`
  if (!blobs.has(key)) {
    const o = builtin(spec)
    blobs.set(key, blobOf(`const m = globalThis.__lb.builtin(${JSON.stringify(spec)});\nexport default m;\n${names(o).map((k) => `export const ${k} = m[${JSON.stringify(k)}];`).join('\n')}`))
  }
  return blobs.get(key)!
}

const loading = new Set<string>()
function moduleUrl(file: string): string {
  if (blobs.has(file)) return blobs.get(file)!
  const src = dec.decode(files.get(file)!)
  const kind = typeOf(file, src)
  if (kind !== 'esm') {
    // CommonJS from an import: its exports as the default, and the names it assigns.
    const found = new Set<string>()
    if (kind === 'cjs') {
      for (const m of src.matchAll(/(?:module\.)?exports\.([a-zA-Z_$][\w$]*)\s*=/g)) found.add(m[1])
      const obj = src.match(/module\.exports\s*=\s*\{([^}]*)\}/)
      if (obj) for (const part of obj[1].split(',')) { const k = part.split(':')[0].trim(); if (/^[a-zA-Z_$][\w$]*$/.test(k)) found.add(k) }
    } else names(JSON.parse(src)).forEach((k) => found.add(k))
    found.delete('default')
    const u = blobOf(`const m = globalThis.__lb.require(${JSON.stringify(file)});\nexport default m;\n${[...found].map((k) => `export const ${k} = m[${JSON.stringify(k)}];`).join('\n')}`)
    blobs.set(file, u)
    return u
  }
  if (loading.has(file)) throw new Error(`${file} is imported in a circle, which the browser version cannot run. Break the cycle or use require.`)
  loading.add(file)
  const [imports] = parse(src.replace(/^#!.*/, (m) => ' '.repeat(m.length)), file)
  let code = ''
  let last = 0
  for (const im of imports) {
    if (im.d === -2) { code += src.slice(last, im.s) + `globalThis.__lb.meta(${JSON.stringify(file)})`; last = im.e; continue }
    if (im.n === undefined) continue
    const spec = im.n
    const target = builtin(spec) !== undefined ? builtinUrl(spec.replace(/^node:/, '')) : moduleUrl(resolve(spec, path.dirname(file)))
    // Static imports give the specifier's bounds without quotes; dynamic ones include them.
    if (im.d === -1) { code += src.slice(last, im.s) + target; last = im.e }
    else { code += src.slice(last, im.s) + JSON.stringify(target); last = im.e }
  }
  code += src.slice(last)
  code = code.replace(/^#!.*/, '') + `\n//# sourceURL=file://${file}`
  loading.delete(file)
  const u = blobOf(code)
  blobs.set(file, u)
  return u
}

async function main(file: string) {
  const src = dec.decode(files.get(file)!)
  if (typeOf(file, src) === 'esm') await import(/* @vite-ignore */ moduleUrl(file))
  else makeRequire(path.dirname(file))(file)
}

// Done when nothing is waiting: no timers, no tests left to run.
async function idle() {
  const t0 = Date.now()
  for (;;) {
    await new Promise((r) => realSet(r, 5))
    await testsDone
    if (active <= 0 && !testing) return
    if (Date.now() - t0 > 10 * 60 * 1000) return
  }
}

let finished = false
function finish(code: number) {
  if (finished) return
  finished = true
  if (tally.tests || tally.suites) {
    out(`ℹ tests ${tally.tests}\nℹ suites ${tally.suites}\nℹ pass ${tally.pass}\nℹ fail ${tally.fail}\nℹ cancelled 0\nℹ skipped ${tally.skipped}\nℹ todo ${tally.todo}\n`)
    if (tally.fail && code === 0) code = 1
  }
  post({ t: 'exit', code, writes: [...written].filter((p) => files.has(p)).map((p) => [p, files.get(p)]), removes: [...removed] })
}

// Stack lines from this worker's own code mean nothing to the person reading the error.
const clean = (s: string) => s.split('\n').filter((l) => !/node-worker[\w-]*\.(js|ts)/.test(l)).join('\n')

const report = (e: unknown) => {
  if (e instanceof Exit) return e.code
  err(`${e instanceof Error ? clean(e.stack ?? `${e.name}: ${e.message}`) : `Uncaught ${inspect(e)}`}\n\nNode.js v22.0.0 (Lunchbox in the browser)\n`)
  return 1
}

self.addEventListener('error', (e) => { e.preventDefault(); finish(report(e.error ?? e.message)) })
self.addEventListener('unhandledrejection', (e) => { e.preventDefault(); finish(report(e.reason)) })

self.onmessage = async (e: MessageEvent<Job>) => {
  const job = e.data
  await init
  for (const [p, data] of job.files) { files.set(p, data); addDirs(p) }
  cwd = job.cwd
  proc.env = { ...job.env }
  try {
    if (job.code !== undefined) {
      proc.argv = ['/usr/local/bin/node', ...job.argv]
      const req = makeRequire(cwd)
      const fn = new Function('require', 'module', 'exports', '__filename', '__dirname', job.print ? `return (${job.code})` : job.code)
      const r = fn(req, { exports: {} }, {}, '[eval]', cwd)
      if (job.print) consoleObj.log(r)
    } else if (job.tests) {
      for (const f of job.tests) {
        proc.argv = ['/usr/local/bin/node', f]
        try { await main(f) } catch (x) { proc.exitCode = report(x) || proc.exitCode }
        await idle()
      }
    } else {
      const file = resolve(job.script!.startsWith('/') ? job.script! : `./${job.script}`, cwd)
      proc.argv = ['/usr/local/bin/node', file, ...job.argv]
      await main(file)
    }
    await idle()
    proc.emit('beforeExit', proc.exitCode ?? 0)
    proc.emit('exit', proc.exitCode ?? 0)
    finish(proc.exitCode ?? 0)
  } catch (x) {
    finish(report(x))
  }
}
