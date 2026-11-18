// A Node-like `process` for the desktop code: a Linux machine, one user, the browser shell.
import { Buffer } from 'buffer'
import { EventEmitter } from 'events'
import { children } from './child_process'
import { HOME } from './os'

let dir = HOME
const proc = Object.assign(new EventEmitter(), {
  platform: 'linux',
  arch: 'x64',
  pid: 1,
  versions: { node: '22.0.0', electron: '0', chrome: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? '' },
  version: 'v22.0.0',
  env: { HOME, USER: 'you', SHELL: '/bin/bash', PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'en_US.UTF-8', LUNCHBOX_WEB: '1' } as Record<string, string | undefined>,
  argv: ['lunchbox'],
  execPath: '/app/lunchbox',
  resourcesPath: '/app',
  windowsStore: false,
  cwd: () => dir,
  chdir: (d: string) => { dir = d },
  nextTick: (fn: (...a: unknown[]) => void, ...a: unknown[]) => queueMicrotask(() => fn(...a)),
  hrtime: Object.assign((prev?: [number, number]) => {
    const t = performance.now() * 1e6
    const s = Math.floor(t / 1e9), n = Math.floor(t % 1e9)
    return prev ? [s - prev[0], n - prev[1]] : [s, n]
  }, { bigint: () => BigInt(Math.floor(performance.now() * 1e6)) }),
  uptime: () => performance.now() / 1000,
  memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0 }),
  kill(pid: number, _sig?: string) {
    const c = children.get(Math.abs(pid))
    if (!c) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' })
    c.kill()
    return true
  },
  exit() {},
  stdout: { write: (s: string) => { console.log(s); return true }, isTTY: false },
  stderr: { write: (s: string) => { console.warn(s); return true }, isTTY: false },
})

const g = globalThis as Record<string, unknown>
g.process = proc
g.Buffer ??= Buffer
g.global ??= globalThis
// Node timers have unref(); the browser's are numbers. Wrapped so `setTimeout(...).unref?.()` works.
export default proc
