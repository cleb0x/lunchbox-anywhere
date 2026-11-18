import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentInfo } from '../../shared/types'
import { segments, words } from '../policy'

// An agent that starts another agent from its own shell gets an answer nobody else sees: the
// person reads "I checked with Grok" and nothing from Grok. This finds those commands, so the
// room can turn them down and point at the way that shows.

// The command name at the end of a path, without what Windows adds to it.
const name = (w: string) => w.split(/[\\/]/).pop()!.toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '')

// Programs that are not agents even when a connector is launched through one.
const GENERIC = new Set(['node', 'nodejs', 'deno', 'bun', 'python', 'python3', 'ruby', 'sh', 'bash', 'zsh', 'npx', 'npm', 'uv', 'uvx', 'env', 'java', 'docker'])
// The packages the four tools install from, by the last part of their name.
const PACKAGES: Record<string, string> = { 'claude-code': 'claude', codex: 'codex', 'gemini-cli': 'gemini', 'grok-cli': 'grok', grok: 'grok', claude: 'claude', gemini: 'gemini' }

// Subcommands that manage the tool itself and never run a prompt.
export const QUIET = ['mcp', 'mcp-server', 'login', 'logout', 'auth', 'models', 'model', 'update', 'upgrade', 'doctor', 'config', 'completion', 'completions', 'install', 'uninstall', 'plugin', 'plugins', 'agents', 'extensions', 'setup-token', 'help', 'version', 'features']
const quiet = new Set(QUIET)
const ABOUT = /^(-v|-V|--version|-h|--help)$/

const WRAPPERS = new Set(['env', 'command', 'exec', 'nohup', 'time', 'timeout', 'gtimeout', 'sudo', 'doas', 'nice', 'stdbuf', 'caffeinate', 'builtin'])
const SHELLS = /^(ba|z|da|k|fi)?sh$/
const RUNNERS = new Set(['npx', 'bunx', 'uvx', 'pipx'])

// Command names that start an agent on this computer, by agent.
export function binsOf(agents: AgentInfo[]) {
  const bins = new Map<string, string>()
  for (const a of agents) {
    if (a.via !== 'cli' || !a.bin) continue
    const n = name(a.bin.trim().split(/\s+/)[0])
    if (n && !GENERIC.has(n)) bins.set(n, a.id)
  }
  return bins
}

// Managing the tool or asking what it is: `codex mcp list`, `claude --version`.
function manages(args: string[]) {
  if (args.some((a) => ABOUT.test(a))) return true
  const first = args.find((a) => !a.startsWith('-'))
  return first !== undefined && quiet.has(first.toLowerCase())
}

export type Reach = { id: string; ask: string }

// The agent a command would start with a prompt, and the prompt when it is there to read.
export function reach(command: string, bins: Map<string, string>, depth = 0): Reach | null {
  if (depth > 3) return null
  // A heredoc's lines are text, like a commit message that starts with "Claude Code now ...".
  command = command.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\s|$|\))/g, ' ')
  // What runs inside $( ) or backticks is a command of its own.
  for (const m of command.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)) {
    const r = reach(m[1] ?? m[2], bins, depth + 1)
    if (r) return r
  }
  for (const s of segments(command.replace(/[(){}]/g, ' '))) {
    let w = words(s)
    for (;;) {
      const head = w[0]
      if (head === undefined) break
      if (/^[A-Za-z_]\w*=/.test(head)) { w = w.slice(1); continue }
      const n = name(head)
      if (WRAPPERS.has(n)) {
        // command -v claude only asks where claude is.
        if ((n === 'command' || n === 'builtin') && w.slice(1).some((x) => /^-[a-zA-Z]*[vVp]/.test(x))) { w = []; break }
        w = w.slice(1)
        while (w[0] && (w[0].startsWith('-') || (/timeout$/.test(n) && /^\d/.test(w[0])) || (n === 'env' && /^\w+=/.test(w[0])))) w = w.slice(1)
        continue
      }
      // xargs runs the first word after its own flags; a word later on is an argument to it.
      if (n === 'xargs') {
        let i = 1
        // Braces are blanked before this, so the {} after -I may be gone and the agent comes next.
        while (w[i]?.startsWith('-')) i += /^-[IinPLsdEa]$|^--(replace|max-args|max-procs|max-lines|delimiter|arg-file)$/.test(w[i]) && w[i + 1] !== undefined && !bins.has(name(w[i + 1])) ? 2 : 1
        w = w.slice(i)
        continue
      }
      break
    }
    if (!w.length) continue
    const n = name(w[0])
    if (SHELLS.test(n)) {
      const at = w.findIndex((x, i) => i > 0 && /^-[a-zA-Z]*c$/.test(x))
      const r = at > 0 && w[at + 1] ? reach(w[at + 1], bins, depth + 1) : null
      if (r) return r
      continue
    }
    if (n === 'eval') { const r = reach(w.slice(1).join(' '), bins, depth + 1); if (r) return r; continue }
    let id: string | undefined
    let args: string[]
    const via = RUNNERS.has(n) ? 1 : /^(npm|pnpm|yarn|bun)$/.test(n) && /^(exec|dlx|x)$/.test(w[1] ?? '') ? 2 : 0
    if (via) {
      let rest = w.slice(via)
      while (rest[0]?.startsWith('-')) rest = rest.slice(/^(-p|--package|-c|--call)$/.test(rest[0]) ? 2 : 1)
      const pkg = (rest[0] ?? '').replace(/(?!^)@[^/]*$/, '').split('/').pop()!.toLowerCase()
      id = bins.get(pkg) ?? (PACKAGES[pkg] && [...bins.values()].includes(PACKAGES[pkg]) ? PACKAGES[pkg] : undefined)
      args = rest.slice(1)
    } else {
      id = bins.get(n)
      args = w.slice(1)
    }
    if (!id || manages(args)) continue
    return { id, ask: args.find((a) => /\s/.test(a.trim()))?.trim() ?? '' }
  }
  return null
}

// Every refusal opens with this, so a command that was turned down can be told from one that ran.
export const REFUSED = 'Lunchbox did not run this.'

// What the agent is told instead: the way to reach that agent that shows in the room.
// tools: the room tools this agent holds. nested: it is answering a question or doing one job.
export function instead(me: AgentInfo, target: AgentInfo, o: { inCrew: boolean; tools: string[]; nested: boolean }) {
  const tool = (t: string) => (me.id === 'claude' ? `the tool mcp__lunchbox__${t}` : `the lunchbox tool ${t}`)
  const hidden = 'Nothing an agent does from a command line shows in the room, and it runs outside the room\'s access mode.'
  const own = 'If the person asked for this exact command, they can run it themselves by starting a message with an exclamation mark.'
  let how: string
  if (target.id === me.id) how = `That would start a second ${me.short}. Do the work in this turn${me.id === 'claude' ? ', or hand part of it to a subagent' : ''}.`
  else if (!o.inCrew) how = `${target.short} is not in this room. If it would help, say so to the person: they can add it from the crew menu or name it in a message.`
  else if (o.nested) how = `You were brought in to answer by yourself, so finish without ${target.short}. If it is needed, say so in your answer.`
  else if (o.tools.includes('ask_crewmate')) how = `${target.short} is in this room. Ask it with ${tool('ask_crewmate')} (agent "${target.id}"), or give it a piece of work with ${tool('bring_in')}. Its answer comes back to you and the person sees it.`
  else how = `${target.short} is in this room. To ask it, put a line on its own in your reply: "@${target.id}: what you need". Its answer comes back to you before you finish, and the person sees it.`
  return `${REFUSED} ${how} ${hidden} ${own}`
}

const envName = (bin: string) => `LUNCHBOX_NO_${bin.replace(/[^A-Za-z0-9]/g, '_')}`

// A stand-in for each agent's command, put first on the PATH of the agents a room starts. It
// lets through what manages the tool and turns a prompt down with the reason the room set for it.
// A login shell that rebuilds its PATH finds the real command first, so this is a second line
// behind the hook and the instructions, not the only one.
const SHIM = `#!/bin/sh
# Written by Lunchbox. Agents in a room reach each other through the room.
me=\${0##*/}
dir=\${0%/*}
pass() {
  old=$IFS
  IFS=:
  for d in $PATH; do
    IFS=$old
    [ "$d" = "$dir" ] && continue
    [ -x "$d/$me" ] && [ ! -d "$d/$me" ] && exec "$d/$me" "$@"
  done
  echo "$me: command not found" >&2
  exit 127
}
for a in "$@"; do
  case $a in -v|-V|--version|-h|--help) pass "$@" ;; esac
done
for a in "$@"; do
  case $a in
    -*) continue ;;
    ${QUIET.join('|')}) pass "$@" ;;
    *) break ;;
  esac
done
eval "why=\\$LUNCHBOX_NO_$(printf %s "$me" | tr -c 'A-Za-z0-9' _)"
[ -n "$why" ] || pass "$@"
echo "$why" >&2
exit 126
`

// Writes the stand-ins into dir and returns it, or nothing where they cannot work (Windows runs
// commands through cmd.exe, which does not read a shell script).
export function shims(dir: string, bins: Iterable<string>) {
  if (process.platform === 'win32') return ''
  try {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    for (const b of bins) {
      if (!/^[\w.@+-]+$/.test(b)) continue
      const file = join(dir, b)
      writeFileSync(file, SHIM, { mode: 0o755 })
      chmodSync(file, 0o755)
    }
    return dir
  } catch { return '' }
}

// The reasons the stand-ins print, one per command, for the environment of one turn.
export function refusals(me: AgentInfo, agents: AgentInfo[], crew: string[], tools: string[], nested: boolean) {
  const out: Record<string, string> = {}
  const byId = new Map(agents.map((a) => [a.id, a]))
  for (const [bin, id] of binsOf(agents)) out[envName(bin)] = instead(me, byId.get(id)!, { inCrew: crew.includes(id), tools, nested })
  return out
}
