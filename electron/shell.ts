import type { ChildProcess } from 'node:child_process'
import type { Access, Verdict } from '../shared/types'
import { decide, prefix } from './policy'
import { env, launch, shellFor, stop } from './system'

export type Answer = 'once' | 'always' | 'deny'
export type Ran = { code: number | null; ms: number; how: string; verdict: Verdict; out: string }
type Hooks = { verdict(v: Verdict): void; start(): void; out(text: string): void }

const running = new Map<string, ChildProcess>()
const waiting = new Map<string, (a: Answer) => void>()

export function answer(id: string, a: Answer) {
  waiting.get(id)?.(a)
  waiting.delete(id)
}

// A question for the person that is not a command: an edit in Ask mode. It is answered the same
// way, by the id of the block that shows it.
export const ask = (id: string) => new Promise<Answer>((done) => waiting.set(id, done))

export function kill(id: string) {
  const child = running.get(id)
  if (child) stop(child)
  answer(id, 'deny')
}

const TAIL = 12000

// git diff, show and log as reads: the repository's own diff tool and text converters stay off.
export const plainGit = (command: string) => command.replace(/\b(git(?:\s+-[cC]\s+\S+)*\s+(?:diff|show|log))\b/g, '$1 --no-ext-diff --no-textconv')

export async function execute(req: { id: string; command: string; cwd: string; root: string; access: Access; memory: Set<string> }, hooks: Hooks): Promise<Ran> {
  const verdict = decide(req.access, req.command, req.cwd, req.root, req.memory)
  hooks.verdict(verdict)
  if (verdict.decision === 'deny') return { code: null, ms: 0, how: 'blocked', verdict, out: '' }
  let how = 'auto'
  if (verdict.decision === 'ask') {
    const a = await ask(req.id)
    if (a === 'deny') return { code: null, ms: 0, how: 'declined', verdict, out: '' }
    if (a === 'always') req.memory.add(prefix(req.command))
    how = a === 'always' ? 'allowed always' : 'allowed once'
  }
  const t0 = Date.now()
  // A command let through as a read must not start a program the repository's own git config
  // names: its file watcher, its diff tool or a text converter. An empty diff.external would make
  // git try to run a program called "", so diffs are told by flag instead.
  const read = verdict.kind === 'read' && /\bgit\b/.test(req.command)
  const quiet: Record<string, string> = read ? { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: 'false' } : {}
  const { file, args, raw } = shellFor(read ? plainGit(req.command) : req.command)
  const child = launch(file, args, { windowsVerbatimArguments: raw, cwd: req.cwd, env: await env({ CI: '1', ...quiet }), stdio: ['ignore', 'pipe', 'pipe'] })
  running.set(req.id, child)
  hooks.start()
  let out = ''
  const take = (b: Buffer) => {
    const text = b.toString()
    out = (out + text).slice(-TAIL)
    hooks.out(text)
  }
  child.stdout?.on('data', take)
  child.stderr?.on('data', take)
  const cap = setTimeout(() => stop(child), 15 * 60 * 1000)
  const code = await new Promise<number | null>((done) => {
    child.on('close', done)
    child.on('error', (e) => { take(Buffer.from(String(e))); done(-1) })
  })
  clearTimeout(cap)
  running.delete(req.id)
  return { code, ms: Date.now() - t0, how, verdict, out }
}
