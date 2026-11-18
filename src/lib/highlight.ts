// Code coloured by what it is, in four roles at most: keywords, strings, numbers and constants,
// and comments. One small scanner per family of languages; it never changes the text, so what is
// copied is what was written, and an unknown language is left as it is.
export type Role = 'k' | 's' | 'n' | 'c'
export type Tok = [text: string, role?: Role]

type Lang = {
  kw: Set<string>
  consts?: Set<string>
  line?: string[]
  block?: [string, string][]
  // Quote characters that open a string. multi: those that may run across lines.
  quotes: string
  multi?: string
  // SQL writes its keywords in either case.
  fold?: boolean
  // A string followed by a colon is a key (JSON). vars: $name is a value of its own (shell).
  keys?: boolean
  vars?: boolean
  // 'a is a lifetime in Rust, not the start of a string.
  chars?: boolean
}

const set = (s: string) => new Set(s.split(' '))
const C_CONSTS = set('true false null undefined NaN Infinity nil None True False')

const JS: Lang = {
  kw: set('const let var function return if else for while do switch case break continue new class extends super import from export default async await try catch finally throw typeof instanceof in of void delete yield static get set this type interface enum implements namespace declare readonly public private protected abstract as satisfies keyof infer is'),
  consts: C_CONSTS, line: ['//'], block: [['/*', '*/']], quotes: '"\'`', multi: '`',
}
const PY: Lang = {
  kw: set('def class return if elif else for while in not and or is import from as with try except finally raise pass break continue lambda yield global nonlocal assert del async await match case self'),
  consts: C_CONSTS, line: ['#'], quotes: '"\'',
}
const SH: Lang = {
  kw: set('if then else elif fi for in do done while until case esac function return export local readonly set unset source alias exit break continue'),
  consts: set('true false'), line: ['#'], quotes: '"\'', multi: '"\'', vars: true,
}
const GO: Lang = {
  kw: set('package import func return if else for range switch case default break continue go defer chan select struct interface map type var const fallthrough goto'),
  consts: set('true false nil iota'), line: ['//'], block: [['/*', '*/']], quotes: '"\'`', multi: '`',
}
const RUST: Lang = {
  kw: set('fn let mut const static struct enum impl trait pub use mod crate self Self super where for in loop while if else match return break continue as ref move async await dyn unsafe type extern macro_rules'),
  consts: set('true false None Some Ok Err'), line: ['//'], block: [['/*', '*/']], quotes: '"', multi: '"', chars: true,
}
const SWIFT: Lang = {
  kw: set('func let var class struct enum protocol extension import return if else guard for in while repeat switch case default break continue defer do try catch throw throws async await actor init deinit self Self super static private fileprivate internal public open final override mutating lazy weak unowned where as is some any typealias associatedtype'),
  consts: set('true false nil'), line: ['//'], block: [['/*', '*/']], quotes: '"',
}
const SQL: Lang = {
  kw: set('select from where and or not in is null as join left right inner outer full cross on group by order having limit offset insert into values update set delete create table alter drop index view primary key foreign references unique default constraint distinct union all exists between like case when then else end with returning begin commit rollback asc desc if'),
  consts: set('true false null'), line: ['--'], block: [['/*', '*/']], quotes: '\'"', fold: true,
}
const CLIKE: Lang = {
  kw: set('int long short char float double bool boolean void unsigned signed const static final struct class enum union interface extends implements public private protected abstract virtual override return if else for while do switch case default break continue new delete try catch finally throw throws import package namespace using typedef template auto var val fun when object this super sizeof include define ifdef ifndef endif function echo foreach as use string'),
  consts: C_CONSTS, line: ['//'], block: [['/*', '*/']], quotes: '"\'',
}
const JSON_: Lang = { kw: new Set(), consts: set('true false null'), line: ['//'], block: [['/*', '*/']], quotes: '"', keys: true }

const LANGS: Record<string, Lang | 'yaml' | 'css' | 'html' | 'diff'> = {}
const name = (names: string, l: Lang | 'yaml' | 'css' | 'html' | 'diff') => { for (const n of names.split(' ')) LANGS[n] = l }
name('ts tsx typescript js jsx javascript mjs cjs mts cts', JS)
name('json jsonc json5 jsonl', JSON_)
name('py python python3', PY)
name('sh bash zsh shell fish', SH)
name('go golang', GO)
name('rs rust', RUST)
name('swift', SWIFT)
name('sql postgres postgresql mysql sqlite', SQL)
name('c h cpp c++ cc hpp java kotlin kt cs csharp php dart', CLIKE)
name('yaml yml toml ini', 'yaml')
name('css scss less', 'css')
name('html xml svg vue htm', 'html')
name('diff patch', 'diff')

// Past this, colouring every frame of a streaming reply would cost more than it gives.
const MAX = 40000

export const knows = (lang: string) => Object.hasOwn(LANGS, lang.toLowerCase())

export function highlight(code: string, lang = ''): Tok[] {
  const l = Object.hasOwn(LANGS, lang.toLowerCase()) ? LANGS[lang.toLowerCase()] : undefined
  if (!l || code.length > MAX) return [[code]]
  const out: Tok[] = []
  const push = (text: string, role?: Role) => {
    if (!text) return
    const last = out[out.length - 1]
    if (last && last[1] === role) last[0] += text
    else out.push(role ? [text, role] : [text])
  }
  if (l === 'diff') diff(code, push)
  else if (l === 'html') html(code, push)
  else if (l === 'css') css(code, push)
  else if (l === 'yaml') yaml(code, push)
  else scan(code, l, push)
  return out
}

type Push = (text: string, role?: Role) => void

const NUM = /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)[a-zA-Z%]*/
const WORD = /^[A-Za-z_$][\w$]*/

// A string from its opening quote: to the matching quote, or to the end of the line when that
// kind of string cannot run on. Text still being written ends where it ends.
function str(code: string, i: number, multi: boolean) {
  const q = code[i]
  const triple = (q === '"' || q === "'") && code.startsWith(q.repeat(3), i)
  const close = triple ? q.repeat(3) : q
  let j = i + close.length
  for (; j < code.length; j++) {
    if (code[j] === '\\') { j++; continue }
    if (code.startsWith(close, j)) return j + close.length
    if (code[j] === '\n' && !multi && !triple) return j
  }
  return code.length
}

function scan(code: string, l: Lang, push: Push) {
  let i = 0
  let plain = ''
  const flush = () => { push(plain); plain = '' }
  while (i < code.length) {
    const c = code[i]
    const block = l.block?.find(([open]) => code.startsWith(open, i))
    if (block) {
      const end = code.indexOf(block[1], i + block[0].length)
      const to = end < 0 ? code.length : end + block[1].length
      flush(); push(code.slice(i, to), 'c'); i = to
      continue
    }
    // A # only starts a comment at the start of a word: $#, ${x#y} and a URL's #top are code.
    const line = l.line?.find((p) => code.startsWith(p, i) && (p !== '#' || i === 0 || /\s/.test(code[i - 1])))
    if (line) {
      const end = code.indexOf('\n', i)
      const to = end < 0 ? code.length : end
      flush(); push(code.slice(i, to), 'c'); i = to
      continue
    }
    if (l.quotes.includes(c) && !(l.chars && c === "'")) {
      const to = str(code, i, !!l.multi?.includes(c))
      flush()
      push(code.slice(i, to), l.keys && /^\s*:/.test(code.slice(to, to + 8)) ? 'k' : 's')
      i = to
      continue
    }
    if (l.vars && c === '$') {
      const m = code.slice(i).match(/^\$(?:\{[^}\n]*\}|[A-Za-z_]\w*|[0-9@#?*!$-])/)
      if (m) { flush(); push(m[0], 'n'); i += m[0].length; continue }
    }
    const boundary = i === 0 || !/[\w$]/.test(code[i - 1])
    if (boundary && /\d/.test(c)) {
      const m = code.slice(i, i + 64).match(NUM)!
      flush(); push(m[0], 'n'); i += m[0].length
      continue
    }
    if (boundary && /[A-Za-z_$]/.test(c)) {
      const w = code.slice(i, i + 80).match(WORD)![0]
      const key = l.fold ? w.toLowerCase() : w
      // A name after a dot is a property, whatever it is called.
      const prop = code[i - 1] === '.'
      if (!prop && l.kw.has(key)) { flush(); push(w, 'k') }
      else if (!prop && l.consts?.has(key)) { flush(); push(w, 'n') }
      else plain += w
      i += w.length
      continue
    }
    plain += c
    i++
  }
  flush()
}

// Added lines stand out, removed ones step back, and the lines that say where are keywords.
function diff(code: string, push: Push) {
  const lines = code.split('\n')
  lines.forEach((line, n) => {
    const role: Role | undefined = /^(@@|diff |index |--- |\+\+\+ )/.test(line) ? 'k' : line.startsWith('+') ? 's' : line.startsWith('-') ? 'c' : undefined
    push(line + (n < lines.length - 1 ? '\n' : ''), role)
  })
}

function html(code: string, push: Push) {
  let i = 0
  while (i < code.length) {
    if (code.startsWith('<!--', i)) {
      const end = code.indexOf('-->', i)
      const to = end < 0 ? code.length : end + 3
      push(code.slice(i, to), 'c'); i = to
      continue
    }
    const tag = code.slice(i, i + 80).match(/^<\/?([A-Za-z][\w:.-]*)/)
    if (!tag) {
      const next = code.indexOf('<', i + 1)
      const to = next < 0 ? code.length : next
      push(code.slice(i, to)); i = to
      continue
    }
    push(tag[0].slice(0, tag[0].length - tag[1].length))
    push(tag[1], 'k')
    i += tag[0].length
    // Inside the tag: attribute values are strings, the rest is plain.
    while (i < code.length && code[i] !== '>') {
      if (code[i] === '"' || code[i] === "'") { const to = str(code, i, true); push(code.slice(i, to), 's'); i = to }
      else { push(code[i]); i++ }
    }
  }
}

function css(code: string, push: Push) {
  let i = 0
  let depth = 0
  let plain = ''
  const flush = () => { push(plain); plain = '' }
  while (i < code.length) {
    const c = code[i]
    if (code.startsWith('/*', i)) {
      const end = code.indexOf('*/', i + 2)
      const to = end < 0 ? code.length : end + 2
      flush(); push(code.slice(i, to), 'c'); i = to
      continue
    }
    if (c === '"' || c === "'") { const to = str(code, i, false); flush(); push(code.slice(i, to), 's'); i = to; continue }
    if (c === '{') depth++
    if (c === '}') depth = Math.max(0, depth - 1)
    const rest = code.slice(i, i + 80)
    const at = rest.match(/^@[\w-]+/)
    if (at) { flush(); push(at[0], 'k'); i += at[0].length; continue }
    const boundary = i === 0 || !/[\w-]/.test(code[i - 1])
    // Inside a rule, the name before the colon is the property. Outside, a colon starts a pseudo class.
    const prop = depth > 0 && boundary ? rest.match(/^(--)?[a-zA-Z][\w-]*(?=\s*:)/) : null
    if (prop) { flush(); push(prop[0], 'k'); i += prop[0].length; continue }
    const num = boundary ? rest.match(/^(?:#[\da-fA-F]{3,8}\b|-?\d*\.?\d+[a-z%]*)/) : null
    if (num && (depth > 0 || !num[0].startsWith('#'))) { flush(); push(num[0], 'n'); i += num[0].length; continue }
    plain += c
    i++
  }
  flush()
}

// Keys, then values line by line: YAML, TOML and INI share enough for the same reading.
function yaml(code: string, push: Push) {
  const lines = code.split('\n')
  lines.forEach((line, n) => {
    const nl = n < lines.length - 1 ? '\n' : ''
    const section = line.match(/^\s*\[[^\]]*\]\]?\s*$/)
    if (section) return push(line + nl, 'k')
    const key = line.match(/^(\s*(?:- )*)((?:"[^"]*"|'[^']*'|[\w.$/-]+))(\s*[:=])(?=\s|$)/)
    let rest = line
    if (key) { push(key[1]); push(key[2], 'k'); push(key[3]); rest = line.slice(key[0].length) }
    value(rest, push)
    push(nl)
  })
}

function value(text: string, push: Push) {
  let i = 0
  let plain = ''
  const flush = () => { push(plain); plain = '' }
  while (i < text.length) {
    const c = text[i]
    if (c === '#' && (i === 0 || /\s/.test(text[i - 1]))) { flush(); push(text.slice(i), 'c'); return }
    if (c === '"' || c === "'") { const to = str(text, i, false); flush(); push(text.slice(i, to), 's'); i = to; continue }
    const boundary = i === 0 || /[\s,[{:=]/.test(text[i - 1])
    const m = boundary ? text.slice(i).match(/^(?:-?\d[\d_.]*(?:[eE][+-]?\d+)?|true|false|null|yes|no|on|off|~)(?=[\s,\]}]|$)/) : null
    if (m) { flush(); push(m[0], 'n'); i += m[0].length; continue }
    plain += c
    i++
  }
  flush()
}
