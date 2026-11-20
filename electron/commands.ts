import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, relative } from 'node:path'
import type { AgentCommand } from '../shared/types'

// The slash commands people have set up in their agents: Claude Code's commands and skills,
// Codex's prompts and Gemini CLI's commands, from their home folder and from the room's folder.
// A room wraps every message in its own context, so a bare /name would never reach a CLI as a
// command. Lunchbox turns each one into the instructions it stands for, which any agent can follow.

const MAX = 12000
const home = () => process.env.LB_COMMANDS_HOME || homedir()

function read(file: string) {
  try { return statSync(file).size < 256_000 ? readFileSync(file, 'utf8') : '' } catch { return '' }
}

// Markdown files with a front matter block: name and description come from there when present.
function front(text: string) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  const meta: Record<string, string> = {}
  if (m) for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/)
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim()
  }
  return { meta, body: m ? text.slice(m[0].length) : text }
}

function files(dir: string, ext: string, depth = 2): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  const walk = (d: string, left: number) => {
    let entries: import('node:fs').Dirent[] = []
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const p = join(d, e.name)
      if (e.isDirectory() && left > 0) walk(p, left - 1)
      else if (e.isFile() && e.name.endsWith(ext)) out.push(p)
    }
  }
  walk(dir, depth)
  return out
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9:_-]+/g, '-').replace(/^-|-$/g, '')

function claudeCommands(dir: string, where: string): AgentCommand[] {
  return files(dir, '.md').map((f) => {
    const { meta, body } = front(read(f))
    // A command in a subfolder is called by its file name; the folder only groups it.
    return { name: slug(basename(f, '.md')), agent: 'claude', from: `Claude Code command, ${where}`, description: meta.description || firstLine(body), body: body.slice(0, MAX), kind: 'prompt' as const }
  }).filter((c) => c.name && c.body.trim())
}

function claudeSkills(dir: string, where: string): AgentCommand[] {
  if (!existsSync(dir)) return []
  let names: string[] = []
  try { names = readdirSync(dir).filter((n) => !n.startsWith('.')) } catch { return [] }
  return names.flatMap((n) => {
    const text = read(join(dir, n, 'SKILL.md'))
    if (!text) return []
    const { meta, body } = front(text)
    if (meta['user-invocable'] === 'false') return []
    return [{ name: slug(meta.name || n), agent: 'claude', from: `Claude Code skill, ${where}`, description: meta.description || firstLine(body), body: body.slice(0, MAX), kind: 'skill' as const }]
  })
}

function codexPrompts(dir: string): AgentCommand[] {
  return files(dir, '.md', 0).map((f) => {
    const { meta, body } = front(read(f))
    return { name: slug(basename(f, '.md')), agent: 'codex', from: 'Codex prompt', description: meta.description || firstLine(body), body: body.slice(0, MAX), kind: 'prompt' as const }
  }).filter((c) => c.name && c.body.trim())
}

// Gemini CLI keeps commands as TOML with a prompt and a description; a folder becomes a namespace.
function geminiCommands(dir: string, where: string): AgentCommand[] {
  return files(dir, '.toml', 3).flatMap((f) => {
    const text = read(f)
    const prompt = text.match(/^prompt\s*=\s*(?:"""([\s\S]*?)"""|'''([\s\S]*?)'''|"((?:[^"\\]|\\.)*)")/m)
    if (!prompt) return []
    const description = text.match(/^description\s*=\s*"((?:[^"\\]|\\.)*)"/m)?.[1] ?? ''
    const body = (prompt[1] ?? prompt[2] ?? JSON.parse(`"${prompt[3]}"`)).slice(0, MAX)
    const name = relative(dir, f).replace(/\.toml$/, '').split(/[\\/]/).join(':')
    return [{ name: slug(name), agent: 'gemini', from: `Gemini CLI command, ${where}`, description: description || firstLine(body), body, kind: 'prompt' as const }]
  })
}

const firstLine = (s: string) => s.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean)?.slice(0, 140) ?? ''

// Read again at most every few seconds per folder: the box asks on every room it opens.
const cache = new Map<string, { at: number; list: AgentCommand[] }>()
export function commands(folder?: string): AgentCommand[] {
  const k = `${home()}|${folder ?? ''}`
  const hit = cache.get(k)
  if (hit && Date.now() - hit.at < 5000) return hit.list
  const list = scan(folder)
  cache.set(k, { at: Date.now(), list })
  if (cache.size > 50) cache.delete(cache.keys().next().value!)
  return list
}

function scan(folder?: string): AgentCommand[] {
  const h = home()
  const all = [
    ...(folder ? claudeCommands(join(folder, '.claude', 'commands'), 'this folder') : []),
    ...(folder ? claudeSkills(join(folder, '.claude', 'skills'), 'this folder') : []),
    ...(folder ? geminiCommands(join(folder, '.gemini', 'commands'), 'this folder') : []),
    ...claudeCommands(join(h, '.claude', 'commands'), 'yours'),
    ...claudeSkills(join(h, '.claude', 'skills'), 'yours'),
    ...codexPrompts(join(process.env.CODEX_HOME || join(h, '.codex'), 'prompts')),
    ...geminiCommands(join(h, '.gemini', 'commands'), 'yours'),
  ]
  // The folder's own command wins over one of the same name and agent from the home folder.
  const seen = new Set<string>()
  return all.filter((c) => { const k = `${c.agent}:${c.name}`; if (seen.has(k)) return false; seen.add(k); return true })
}

// What a command turns into when it is sent. Arguments fill $ARGUMENTS, $1 to $9 and {{args}}, the
// placeholders the three tools use; a command with none gets them after it. A Claude Code skill
// sent to Claude Code is named, since Claude Code has it already; anyone else gets its text.
export function expand(c: AgentCommand, args: string, to: string) {
  const parts = args.trim() ? args.trim().split(/\s+/) : []
  const filled = c.body
    .replace(/\$ARGUMENTS|\{\{args\}\}/g, args.trim())
    .replace(/\$([1-9])/g, (_m, n: string) => parts[Number(n) - 1] ?? '')
  const used = filled !== c.body
  const head = `/${c.name}${args.trim() ? ` ${args.trim()}` : ''}`
  if (c.kind === 'skill') {
    if (to === 'claude') return `${head}\n\nUse your ${c.name} skill for this.${args.trim() ? ` ${args.trim()}` : ''}`
    return `${head}\n\nFollow the ${c.name} skill below for this.${args.trim() ? `\n\nTask: ${args.trim()}` : ''}\n\n${filled.trim()}`
  }
  return `${head}\n\n${filled.trim()}${!used && args.trim() ? `\n\n${args.trim()}` : ''}`
}
