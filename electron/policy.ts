import { homedir } from 'node:os'
import { isAbsolute, parse, relative, resolve, sep } from 'node:path'
import type { Access, Kind, Verdict } from '../shared/types'

const RANK: Kind[] = ['read', 'write', 'network', 'outside', 'danger', 'blocked']

// Never run, whatever the access level. These end machines, not projects.
const BLOCKED = [
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
  /\bmkfs(\.\w+)?\b/,
  /\bdd\b[^|;&]*\bof=\/dev\//,
  /\bformat\s+[a-z]:/i,
  /\b(rd|rmdir)\s+\/s\b[^|;&]*\s[a-z]:\\?\s*$/i,
  /\bremove-item\b[^|;&]*-recurse[^|;&]*\s[a-z]:\\?\s*$/i,
]

const DANGER: [RegExp, string][] = [
  [/\brm\s+(-[a-z-]*\s+)*-[a-z-]*[rf]/i, 'deletes files without the bin'],
  [/\bsudo\b/, 'asks for administrator rights'],
  [/\bgit\s+push\b[^;&|]*(--force|\s-f\b|--force-with-lease)/, 'rewrites history on a remote'],
  [/\bgit\s+reset\s+--hard\b/, 'throws away uncommitted work'],
  [/\bgit\s+clean\s+-[a-z]*f/, 'deletes untracked files'],
  [/\bgit\s+checkout\s+(--\s+)?\.(\s|$)/, 'throws away uncommitted work'],
  [/\b(chmod|chown)\s+-R\b/, 'changes permissions recursively'],
  [/\b(curl|wget)\b[^|;]*\|\s*(sudo\s+)?(ba|z|fi)?sh\b/, 'runs a script straight from the internet'],
  [/\b(killall|pkill|shutdown|reboot|launchctl)\b/, 'touches the system'],
  [/\bdefaults\s+write\b/, 'changes system settings'],
  [/\bosascript\b/, 'controls other apps'],
  [/\bsecurity\s+(find|dump|delete)/, 'reads the keychain'],
  [/\b(del|erase)\s+(\/[a-z]\s+)*\/[sq]\b|\b(rd|rmdir)\s+\/s\b|\bremove-item\b[^|;&]*-recurse/i, 'deletes files without the bin'],
  [/\b(taskkill|stop-process|reg\s+(add|delete)|set-executionpolicy)\b/i, 'touches the system'],
  [/\b(iwr|invoke-webrequest|irm|invoke-restmethod)\b[^|;]*\|\s*iex\b/i, 'runs a script straight from the internet'],
]

const NETWORK = /\b(curl|wget|ssh|scp|rsync|nc|ftp|git\s+(push|pull|fetch|clone)|npm\s+(i|install|ci|publish|add|update)|npx\s|pnpm\s+(i|install|add)|yarn(\s+add|\s+install|\s*$)|bun\s+(add|install)|pip3?\s+install|uv\s+(add|pip)|brew\s+(install|upgrade)|gh\s|vercel\b|docker\s+(pull|push)|invoke-webrequest|iwr\s|invoke-restmethod|winget\s+install|choco\s+install|scoop\s+install)/i

const READ = new Set(['ls', 'cat', 'pwd', 'head', 'tail', 'wc', 'grep', 'rg', 'which', 'echo', 'printf', 'du', 'df', 'file', 'stat', 'tree', 'date', 'whoami', 'uname', 'env', 'less', 'diff', 'cut', 'jq', 'true', 'type', 'basename', 'dirname', 'realpath', 'sw_vers', 'uptime', 'dir', 'where', 'findstr', 'ver', 'get-childitem', 'gci', 'get-content', 'gc', 'get-location'])
// Only the forms of branch and tag that list; with a name they create, move or delete.
const READ_GIT = /^git\s+(status|diff|log|show|branch(\s+(-a|-r|-vv?|--all|--remotes|--list|--show-current|--verbose))*\s*$|remote\s+-v|rev-parse|ls-files|blame|describe|tag\s*$)/
// Asking for a version only reads when the program is one known to answer it; ./anything -v can do anything.
const VERSION = /^(node|npm|npx|pnpm|yarn|bun|deno|python3?|pip3?|uv|ruby|go|cargo|rustc|java|git|gh|docker|make|tsc|gcc|clang|php|perl|swift|dotnet|brew|claude|codex|agy|gemini|grok|ollama)\s+(-v|--version|-V|version)\s*$/

// Words as a shell splits them, quotes removed, so "$HOME"/x is one word. A backslash is part of
// a path on Windows and an escape everywhere else.
export function words(s: string) {
  const word = sep === '\\' ? /(?:"[^"]*"|'[^']*'|[^\s"'])+/g : /(?:"[^"]*"|'[^']*'|\\.|[^\s"'\\])+/g
  return [...s.matchAll(word)].map((m) => m[0].replace(sep === '\\' ? /"([^"]*)"|'([^']*)'/g : /"([^"]*)"|'([^']*)'|\\(.)/g, (_m, a, b, c) => a ?? b ?? c ?? ''))
}

// The home folder as sh, cmd.exe and PowerShell spell it.
const HOME = /\$\{HOME\}|\$HOME(?!\w)|%USERPROFILE%|%HOMEDRIVE%%HOMEPATH%|\$\{?env:(USERPROFILE|HOME)\}?(?!\w)/gi
const expand = (t: string) => t.replace(/^~(?=[\\/]|$)/, () => homedir()).replace(HOME, () => homedir())
const base = (w: string) => w.split(/[\\/]/).pop()!.toLowerCase()

// The disk, the home folder, or a folder the home folder sits in.
function vital(word: string, cwd: string) {
  let path = expand(word)
  if (/^[a-z]:[\\/]*$/i.test(path)) return true
  const glob = path.search(/[*?[{]/)
  if (glob >= 0) {
    // ~/* and ~/.* empty the folder before the star; ~/build* does not.
    const cut = path.lastIndexOf('/', glob) + 1
    if (!/^[.*{},]*$/.test(path.slice(cut))) return false
    path = path.slice(0, cut) || '.'
  }
  const p = resolve(cwd, path)
  const rel = relative(p, homedir())
  return p === parse(p).root || (!rel.startsWith('..') && !isAbsolute(rel))
}

// rm -r or find -delete aimed at one of those, wherever it stands among the operands and however
// it is spelled: after --, behind a cd, as ${HOME}, in quotes or with long flags.
function wipes(command: string, cwd: string) {
  let at = cwd
  for (const s of segments(command)) {
    const w = words(s)
    if (w[0] === 'cd' || w[0] === 'pushd') { at = resolve(at, expand(w[1] ?? '~')); continue }
    const rm = w.findIndex((x) => base(x) === 'rm')
    if (rm >= 0) {
      const rest = w.slice(rm + 1)
      const end = rest.indexOf('--')
      const before = end < 0 ? rest : rest.slice(0, end)
      const targets = [...before.filter((x) => !x.startsWith('-')), ...(end < 0 ? [] : rest.slice(end + 1))]
      if (before.some((f) => f === '--recursive' || /^-[a-z]*r/i.test(f)) && targets.some((t) => vital(t, at))) return true
    }
    // cmd.exe's rd /s and del /s, and PowerShell's Remove-Item -Recurse under any of its names.
    const rd = w.findIndex((x) => /^(rd|rmdir|del|erase)$/.test(base(x)))
    if (rd >= 0) {
      const rest = w.slice(rd + 1)
      if (rest.some((f) => /^\/s$/i.test(f)) && rest.filter((f) => !/^\/[a-z]$/i.test(f)).some((t) => vital(t, at))) return true
    }
    const ri = w.findIndex((x) => /^(remove-item|ri)$/.test(base(x)))
    if (ri >= 0) {
      const rest = w.slice(ri + 1)
      if (rest.some((f) => /^-r/i.test(f)) && rest.filter((f) => !f.startsWith('-')).some((t) => vital(t, at))) return true
    }
    const find = w.findIndex((x) => base(x) === 'find')
    if (find >= 0) {
      const rest = w.slice(find + 1)
      while (/^-[HLP]$/.test(rest[0] ?? '')) rest.shift()
      const expr = rest.findIndex((x) => /^[-(!]/.test(x))
      const paths = expr < 0 ? rest : rest.slice(0, expr)
      const deletes = rest.some((x, i) => x === '-delete' || (/^-exec(dir)?$/.test(x) && base(rest[i + 1] ?? '') === 'rm'))
      if (deletes && (paths.length ? paths : ['.']).some((t) => vital(t, at))) return true
    }
  }
  return false
}

export function segments(command: string) {
  // A single & starts a second command as surely as && does, but the & in 2>&1 or &> only
  // points one output at another, so those go first. &> still writes a file, so it stays a >,
  // and so does >& before a name: `echo x >&cat` writes a file called cat.
  const plain = command.replace(/\d*[<>]&(\d+|-)(?=\s|$|[|;&)])/g, ' ').replace(/&>|>&/g, '> ')
  // Split where the shell would: a | or ; inside quotes is text, as in sed 's|a|b|' or grep "a|b".
  const out: string[] = []
  let cur = '', quote = ''
  for (let i = 0; i < plain.length; i++) {
    const c = plain[i]
    if (quote) { if (c === quote) quote = ''; else if (c === '\\' && quote === '"' && sep !== '\\') cur += plain[i++]; cur += plain[i] ?? ''; continue }
    if (c === '"' || c === "'") { quote = c; cur += c; continue }
    if (c === '\\' && sep !== '\\') { cur += c + (plain[++i] ?? ''); continue }
    if (';|&\r\n'.includes(c)) { out.push(cur); cur = ''; continue }
    cur += c
  }
  out.push(cur)
  // A quote that never closes (an apostrophe in a heredoc, say) would hide every line after it
  // inside one segment, so each line is judged on its own instead.
  if (quote) return plain.split(/[;|&\r\n]/).map((s) => s.trim()).filter(Boolean)
  return out.map((s) => s.trim()).filter(Boolean)
}

// A sed script that only prints, deletes or substitutes: an optional address, then one command
// from a short list. Anything else may be e (run a command), w or r (a file), which this does
// not try to tell apart.
const SED_ADDR = String.raw`(?:\d+|\$|\/(?:[^\/\\\n]|\\.)*\/)`
const SED_STEP = new RegExp(String.raw`^\s*(?:${SED_ADDR}(?:\s*,\s*(?:\+?\d+|\$|\/(?:[^\/\\\n]|\\.)*\/))?)?\s*!?\s*(?:[pdqDGHghNnPx=]|s([\/|#,:@])(?:(?!\1)[^\\\n]|\\.)*\1(?:(?!\1)[^\\\n]|\\.)*\1[gpiIm\d]*|y([\/|#,:@])(?:(?!\2)[^\\\n]|\\.)*\2(?:(?!\2)[^\\\n]|\\.)*\2)?\s*$`)

// What a sed call does: nothing but print, change the files it names, or something this cannot
// follow (a script file, or a script with commands outside the short list).
function sed(segment: string): 'read' | 'edit' | 'unknown' {
  const w = words(segment).slice(1)
  const scripts: string[] = []
  let inplace = false, named = false
  for (let i = 0; i < w.length; i++) {
    const a = w[i]
    if (/^(-f|--file)/.test(a) || /^-[a-zA-Z]*f/.test(a)) return 'unknown'
    if (/^--in-place/.test(a) || /^-[a-zA-Z]*i/.test(a)) { inplace = true; continue }
    if (a === '-e' || a === '--expression') { scripts.push(w[++i] ?? ''); named = true; continue }
    if (a.startsWith('--expression=')) { scripts.push(a.slice(13)); named = true; continue }
    if (a.startsWith('-')) continue
    if (!named && !scripts.length) scripts.push(a)
  }
  if (!scripts.every((s) => s.split(/[;\n]/).every((step) => SED_STEP.test(step)))) return 'unknown'
  return inplace ? 'edit' : 'read'
}

// Code written on the command line for an interpreter: node -e, python -c, perl -e and the like.
// It is a program of its own, which the words around it say nothing about.
const INLINE = /^(?:\S*[\\/])?(?:(?:node|nodejs|bun)(?:\.exe)?\s+(?:-\S+\s+)*(?:-[a-zA-Z]*[ep]\b|--eval|--print)|deno\s+(?:-\S+\s+)*eval\s|python[\d.]*(?:\.exe)?\s+(?:-\S+\s+)*-[a-zA-Z]*c\b|(?:ruby|php)(?:\.exe)?\s+(?:-\S+\s+)*-[a-zA-Z]*[er]\b|perl(?:\.exe)?\s+(?:-\S+\s+)*-[a-zA-Z]*[eE]\b|osascript\s+(?:-\S+\s+)*-e\b|(?:pwsh|powershell)(?:\.exe)?\s+(?:-\S+\s+)*(?:-c\b|-command\b|-e\b|-encodedcommand\b))/i
// A shell given its commands as one word: sh -c '...'. What is inside is judged as it would be
// on its own.
const SHELL_C = /^(?:\S*[\\/])?(?:ba|z|da|k|fi)?sh\s+(?:-[a-zA-Z]*\s+)*-[a-zA-Z]*c\b/

const inner = (segment: string) => { const w = words(segment); return w[w.findIndex((x, i) => i > 0 && /^-[a-zA-Z]*c$/.test(x)) + 1] ?? '' }

function isRead(segment: string) {
  if (/>/.test(segment)) return false
  // $(...) and backticks run their own command, and env with arguments launches one.
  if (/\$\(|`|<\(/.test(segment)) return false
  if (/^env\s+\S/i.test(segment)) return false
  if ((READ_GIT.test(segment) && !/--output|\s-o\s/.test(segment)) || VERSION.test(segment)) return true
  const [first, ...rest] = segment.split(/\s+/)
  const head = first.toLowerCase()
  if (head === 'find') return !rest.some((a) => /^-(delete|exec|execdir|ok|okdir|fprint0?|fprintf|fls)$/.test(a))
  if (head === 'sed') return sed(segment) === 'read'
  if (head === 'tree') return !rest.some((a) => /^(-o|--output)/.test(a))
  // --pre and --hostname-bin both name a program for rg to run.
  if (head === 'rg') return !rest.some((a) => /^--(pre|hostname-bin)/.test(a))
  return READ.has(head)
}

// Paths the command names that resolve outside the workspace. Reading them is fine; writing is not.
function outside(segment: string, cwd: string, root: string) {
  // Every word counts, the first one too: after >| or >& the path is a segment of its own. The
  // part after = is looked at as well, for of=/path and --output=/path.
  return words(segment.replace(/\d*>>?[|&]?|</g, ' '))
    .flatMap((t) => [t, ...t.split('=').slice(1)])
    .map(expand)
    .some((t) => {
      // A variable or ~user can point anywhere, so it counts as outside.
      if (/^[$~]/.test(t)) return true
      if (!isAbsolute(t) && !/^[a-z]:[\\/]/i.test(t) && !/(^|[\\/])\.\.([\\/]|$)/.test(t)) return false
      const rel = relative(root, resolve(cwd, t))
      return rel.startsWith('..') || isAbsolute(rel)
    })
}

export function classify(command: string, cwd: string, root: string, depth = 0): { kind: Kind; reason: string } {
  if (BLOCKED.some((r) => r.test(command)) || wipes(command, cwd)) return { kind: 'blocked', reason: 'would wipe a disk or your home folder' }
  const shells = depth < 3 ? segments(command).filter((s) => SHELL_C.test(s)).map((s) => classify(inner(s), cwd, root, depth + 1)) : []
  const wipe = shells.find((r) => r.kind === 'blocked')
  if (wipe) return wipe
  for (const [r, reason] of DANGER) if (r.test(command)) return { kind: 'danger', reason }
  let kind: Kind = 'read'
  let reason = 'only reads'
  const bump = (k: Kind, why: string) => { if (RANK.indexOf(k) > RANK.indexOf(kind)) { kind = k; reason = why } }
  const cwdOut = relative(root, cwd).startsWith('..')
  for (const s of segments(command)) {
    if (NETWORK.test(s)) bump('network', 'reaches the internet')
    else if (SHELL_C.test(s)) {
      const r = inner(s) && depth < 3 ? classify(inner(s), cwd, root, depth + 1) : { kind: 'outside' as Kind, reason: 'runs a script written on the command line' }
      bump(r.kind, r.reason)
    }
    else if (INLINE.test(s)) bump('outside', 'runs code written on the command line')
    else if (/^sed\s/i.test(s) && sed(s) === 'unknown') bump('outside', 'runs a sed script that can start commands or write files')
    else if (!isRead(s)) {
      if (cwdOut || outside(s, cwd, root)) bump('outside', 'writes outside the workspace')
      else bump('write', 'changes files in the workspace')
    }
  }
  return { kind, reason }
}

const AUTO: Record<Access, Kind[]> = {
  plan: ['read'],
  ask: ['read'],
  workspace: ['read', 'write'],
  // Full access means full: only the blocked list (wiping a disk or the home folder) is refused.
  full: ['read', 'write', 'network', 'outside', 'danger'],
}

export function decide(access: Access, command: string, cwd: string, root: string, remembered: Set<string>): Verdict {
  const { kind, reason } = classify(command, cwd, root)
  if (kind === 'blocked') return { kind, decision: 'deny', reason }
  if (access === 'plan' && kind !== 'read') return { kind, decision: 'deny', reason: `${reason}, and Plan only reads` }
  // "Always" covers the same simple command again, never a longer chain that starts like it.
  // Never for commands that leave the folder, or for interpreters, where the words after the
  // first two can be any program at all.
  const simple = segments(command).length === 1 && !/[`$<>]|\$\(/.test(command) && kind !== 'outside' && !/^\s*(node|python3?|ruby|perl|php|bash|sh|zsh|fish|pwsh|powershell|cmd|deno|bun|npx|npm\s+run|pnpm\s+(run|dlx|exec)|yarn\s+(run|dlx))\b/i.test(command)
  if (AUTO[access].includes(kind) || (kind !== 'danger' && simple && remembered.has(prefix(command)))) return { kind, decision: 'allow', reason }
  return { kind, decision: 'ask', reason }
}

// "Always" remembers the command's first two words, so `npm test` covers `npm test -- --watch` but not `npm publish`.
export const prefix = (command: string) => command.trim().split(/\s+/).slice(0, 2).join(' ')
