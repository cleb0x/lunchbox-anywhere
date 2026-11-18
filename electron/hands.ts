import { randomBytes } from 'node:crypto'
import { chmodSync, lstatSync, mkdirSync, rmSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, join } from 'node:path'
import { logs, trim } from './room/trim'

export type Tool = {
  name: string
  description: string
  input: Record<string, unknown>
  required?: string[]
  // A complete JSON schema, for tools passed through from another MCP server.
  schema?: Record<string, unknown>
  run(args: Record<string, unknown>): Promise<string>
}

type Rpc = { jsonrpc: '2.0'; id?: string | number | null; method?: string; params?: any }

// What a turn lets Lunchbox do to the agent's own tool calls, through the agent's hooks.
// shorten: commands that only log run with their output sent here first, and what is kept goes
// back to the agent; dir is where the whole output stays, cut is told how much never reached it.
// refuse: every tool call is turned down, for a turn that must not change anything.
export type Watch =
  | { kind: 'shorten'; dir: string; cut(chars: number): void }
  | { kind: 'refuse' }

// Asked before a command the agent is about to run by itself. It answers with nothing when the
// command may run, or with the reason it may not, which the agent is told.
export type Guard = (command: string, cwd?: string) => Promise<string | null>

// A question put to the person has to be answered before the agent's own hook gives up, because
// a hook that times out lets the command through.
export const HOOK_TIMEOUT = 1800
const GUARD_WAIT = (HOOK_TIMEOUT - 120) * 1000

// The folder command output is kept in, and the one above it, belong to this account and nobody
// else can list or write them. On Linux the temp folder is shared, so a folder someone else made
// there first, or a link put in its place, is never used.
export function privateDir(dir: string) {
  try {
    for (const d of [dirname(dir), dir]) {
      mkdirSync(d, { recursive: true, mode: 0o700 })
      const s = lstatSync(d)
      if (!s.isDirectory() || s.isSymbolicLink()) return false
      if (process.platform === 'win32') continue
      if (s.uid !== process.getuid?.()) return false
      if (s.mode & 0o077) chmodSync(d, 0o700)
    }
    return true
  } catch { return false }
}

const MAX_RPC = 1_000_000
const MAX_OUTPUT = 16_000_000

// The command an agent asked for, run with everything it prints going to a file. The room
// shortens the file and prints what is kept; without curl or the room, the file is printed whole.
// The braces keep `cd` and variables in the agent's shell, and the exit code is the command's own.
export function wrap(command: string, file: string, url: string) {
  return `if ( : > '${file}' ) 2>/dev/null; then { ${command}\n} > '${file}' 2>&1; lb_status=$?; curl -sf --max-time 30 --data-binary @'${file}' '${url}' 2>/dev/null || cat '${file}'; (exit $lb_status); else ${command}\nfi`
}

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']

// One MCP server for every agent the room starts. Each turn gets its own URL, and the URL is the
// credential: it names the tools that turn may use and stops working when the turn ends.
export class Hands {
  private server: Server | null = null
  private grants = new Map<string, { tools: Tool[]; watch?: Watch; drop: string; inbox?: () => string | null; guard?: Guard }>()
  // Where a shortened command sends its output. That address ends up on a command line, which
  // other programs on the computer can read, so it has a token of its own that opens nothing else.
  private drops = new Map<string, Watch>()
  private port = 0
  private outputs = 0

  async start() {
    if (this.server) return
    this.server = createServer((req, res) => { this.handle(req, res).catch(() => this.send(res, 500, { error: 'internal' })) })
    this.server.requestTimeout = 0
    this.server.headersTimeout = 0
    const server = this.server
    try {
      await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok) })
    } catch (e) {
      this.server = null
      throw e
    }
    this.port = (server.address() as AddressInfo).port
  }

  stop() {
    this.server?.close()
    this.server = null
    this.port = 0
  }

  // inbox hands over a message the person sent mid-turn, once, after the agent's next step.
  grant(tools: Tool[], watch?: Watch, inbox?: () => string | null, guard?: Guard) {
    // Without a server the agents run without the room's tools rather than call a dead address.
    if (!this.port) return { url: '', hook: '', revoke: () => {} }
    const token = randomBytes(18).toString('base64url')
    const drop = randomBytes(18).toString('base64url')
    this.grants.set(token, { tools, watch, drop, inbox, guard })
    if (watch) this.drops.set(drop, watch)
    const base = `http://127.0.0.1:${this.port}`
    return { url: tools.length ? `${base}/mcp/${token}` : '', hook: watch || inbox || guard ? `${base}/hook/${token}` : '', revoke: () => { this.grants.delete(token); this.drops.delete(drop) } }
  }

  private send(res: ServerResponse, status: number, body?: unknown) {
    if (res.headersSent) return
    if (body === undefined) {
      res.writeHead(status).end()
      return
    }
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    // The token is the last part of the URL, or a bearer header for a CLI that takes it that way.
    const [, route, named, rest] = req.url?.match(/^\/(mcp|hook|output)\/([\w-]+)(?:\/([\w-]+))?/) ?? []
    const token = named ?? req.headers.authorization?.match(/^Bearer\s+([\w-]+)$/i)?.[1]
    const granted = token && route !== 'output' ? this.grants.get(token) : undefined
    const drop = token && route === 'output' ? this.drops.get(token) : undefined
    if (!granted && !drop) return this.send(res, 404, { error: 'This turn has ended' })
    if (req.method === 'DELETE') return this.send(res, 200)
    if (req.method !== 'POST') return this.send(res, 405)

    const max = route === 'output' ? MAX_OUTPUT : MAX_RPC
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > max) return this.send(res, 413)
      chunks.push(chunk)
    }
    const raw = Buffer.concat(chunks).toString('utf8')
    if (drop) return this.output(res, raw, drop, rest ?? '')
    if (route === 'hook') return this.send(res, 200, await this.hook(raw, granted!))
    const tools = granted!.tools
    let body: Rpc | Rpc[]
    try { body = JSON.parse(raw) } catch { return this.send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) }

    const batch = Array.isArray(body) ? body : [body]
    const replies = (await Promise.all(batch.map((m) => this.reply(m, tools)))).filter((r) => r !== null)
    if (!replies.length) return this.send(res, 202)
    this.send(res, 200, Array.isArray(body) ? replies : replies[0])
  }

  // Called by the agent before each of its tool calls.
  private async hook(raw: string, { watch, drop, inbox, guard }: { watch?: Watch; drop: string; inbox?: () => string | null; guard?: Guard }) {
    let o: { hook_event_name?: string; tool_name?: string; tool_input?: Record<string, unknown>; cwd?: string }
    try { o = JSON.parse(raw) } catch { return {} }
    if (o.hook_event_name === 'PostToolUse') {
      const sent = inbox?.()
      return sent ? { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: sent } } : {}
    }
    if (watch?.kind === 'refuse') return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'No tools in this turn. Reply in words only.' } }
    const command = o.tool_input?.command
    // The room's mode decides about the command before anything else is done with it. No answer
    // in time counts as a no.
    if (guard && o.tool_name === 'Bash' && typeof command === 'string') {
      let timer: NodeJS.Timeout | undefined
      const late = new Promise<string>((done) => { timer = setTimeout(() => done('Nobody answered in time, so Lunchbox did not run this.'), GUARD_WAIT) })
      const no = await Promise.race([guard(command, typeof o.cwd === 'string' ? o.cwd : undefined).catch(() => 'Lunchbox could not check this command, so it did not run.'), late])
      clearTimeout(timer)
      if (no) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: no } }
    }
    if (watch?.kind !== 'shorten' || o.tool_name !== 'Bash' || typeof command !== 'string' || o.tool_input?.run_in_background || !logs(command)) return {}
    // Forward slashes work in every shell the agents use, Git Bash on Windows included.
    const dir = watch.dir.replace(/\\/g, '/')
    if (/['\n]/.test(dir)) return {}
    if (!privateDir(watch.dir)) return {}
    const id = `${Date.now().toString(36)}-${++this.outputs}`
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { ...o.tool_input, command: wrap(command, `${dir}/${id}.txt`, `http://127.0.0.1:${this.port}/output/${drop}/${id}`) } } }
  }

  // What a command printed, sent back shortened. A short output is passed on as it was and its
  // file removed; a long one keeps its file, which the shortened text points to.
  private output(res: ServerResponse, raw: string, watch: Watch, id: string) {
    if (watch.kind !== 'shorten' || !id) return this.send(res, 404)
    const file = join(watch.dir, `${id}.txt`)
    const r = trim(raw, file)
    if (r.text.length >= raw.length - 200) {
      try { rmSync(file, { force: true }) } catch {}
    } else watch.cut(r.cut)
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(r.text.endsWith('\n') || !r.text ? r.text : r.text + '\n')
  }

  private async reply(m: Rpc, tools: Tool[]) {
    if (m.id === undefined || m.id === null) return null
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id: m.id, result })
    const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: m.id, error: { code, message } })
    switch (m.method) {
      case 'initialize': {
        const asked = m.params?.protocolVersion
        return ok({
          protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'lunchbox', version: '1' },
          instructions: 'Tools from the Lunchbox room you are working in: your crewmates, their abilities, the room\'s shared memory, the Lunchbox browser the person can watch, and any tools they connected.',
        })
      }
      case 'ping':
        return ok({})
      case 'tools/list':
        return ok({
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.schema ?? { type: 'object', properties: t.input, required: t.required ?? Object.keys(t.input) },
          })),
        })
      case 'tools/call': {
        const tool = tools.find((t) => t.name === m.params?.name)
        if (!tool) return fail(-32602, `Unknown tool ${m.params?.name}`)
        try {
          const text = await tool.run(m.params?.arguments ?? {})
          return ok({ content: [{ type: 'text', text }] })
        } catch (e) {
          return ok({ content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true })
        }
      }
      default:
        return fail(-32601, `Method not found: ${m.method}`)
    }
  }
}
