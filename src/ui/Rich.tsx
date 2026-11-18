import { Fragment, memo, useEffect, useState, type ReactNode } from 'react'
import { ThemeOffer } from './ThemeOffer'
import { foldChecklists, same, sincePlan, type Step } from '../../shared/plan'
import { steady } from '../../shared/stream'
import { PlanCard } from './Plan'
import { highlight } from '../lib/highlight'

// Code, bold, emphasis, web links, links to files on disk (shown as the file name) and bare URLs.
// Emphasis needs a word on both sides of its stars, so 2 * 3 * 4 and *.ts stay as they are.
const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|(?<![\w*\\])\*(?=\S)[^*\n]+?(?<=\S)\*(?![\w*])|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|\[[^\]\n]+\]\((?!https?:)[^)\n]+\)|https?:\/\/[^\s)<>]+[^\s).,;:!?<>'"])/g

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (i % 2 === 0) return part
    if (part.startsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>
    if (part.startsWith('**')) return <b key={i}>{part.slice(2, -2)}</b>
    if (part.startsWith('*')) return <em key={i}>{part.slice(1, -1)}</em>
    const link = part.match(/^\[([^\]]+)\]\((.+)\)$/)
    if (link && !/^https?:/.test(link[2])) return <code key={i} title={link[2]}>{link[1]}</code>
    const href = link ? link[2] : part
    return <a key={i} href={href} target="_blank" rel="noreferrer">{link ? link[1] : part.replace(/^https?:\/\//, '')}</a>
  })
}

type Block =
  | { t: 'p'; text: string }
  | { t: 'h'; text: string }
  | { t: 'code'; lang: string; text: string }
  | { t: 'quote'; paras: string[] }
  | { t: 'table'; head: string[]; rows: string[][] }
  | { t: 'rule' }
  | { t: 'list'; ordered: boolean; items: { text: string; check?: boolean }[] }

// live: the last line is still being typed.
export function blocks(src: string, prior: Pick<Step, 'text' | 'done'>[] = [], live = false): Block[] {
  const out: Block[] = []
  const lines = src.replace(/\r/g, '').split('\n')
  let para: string[] = []
  const flush = () => { if (para.length) out.push({ t: 'p', text: para.join('\n') }); para = [] }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = line.match(/^(\s*)```(\S*)/)
    if (fence) {
      flush()
      const body: string[] = []
      // A fence inside a list is indented with it; the code is not.
      const dent = new RegExp(`^\\s{0,${fence[1].length}}`)
      while (++i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i].replace(dent, ''))
      out.push({ t: 'code', lang: fence[2], text: body.join('\n') })
      continue
    }
    // A quote: consecutive lines starting with ">". A bare ">" separates its paragraphs.
    if (/^\s*>/.test(line)) {
      flush()
      const paras: string[] = []
      let cur: string[] = []
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) {
        const body = lines[i].replace(/^\s*>\s?/, '')
        if (body.trim()) cur.push(body)
        else if (cur.length) { paras.push(cur.join('\n')); cur = [] }
      }
      i--
      if (cur.length) paras.push(cur.join('\n'))
      if (paras.length) out.push({ t: 'quote', paras })
      continue
    }
    if (!line.trim()) { flush(); continue }
    // A table: a row of cells with a row of dashes under it. Without the dashes it is just text.
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1] ?? '')) {
      flush()
      const rows: string[][] = []
      for (i += 2; i < lines.length && /^\s*\|/.test(lines[i]); i++) rows.push(cells(lines[i]))
      i--
      out.push({ t: 'table', head: cells(line), rows })
      continue
    }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { flush(); out.push({ t: 'rule' }); continue }
    const head = line.match(/^#{1,6}\s+(.+)/)
    if (head) { flush(); out.push({ t: 'h', text: head[1] }); continue }
    const item = line.match(/^\s*(?:([-*•])|(\d+)[.)])\s+(?:\[( |x|X)\]\s+)?(.*)$/)
    if (item) {
      flush()
      const ordered = !!item[2]
      const last = out[out.length - 1]
      const entry = { text: item[4], check: item[3] === undefined ? undefined : item[3] !== ' ' }
      const ticks = entry.check && last?.t === 'list' ? last.items.find((it) => it.check !== undefined && same(it.text, entry.text)) : undefined
      if (ticks) ticks.check = true
      // A tick being typed for a step already on the list is not a new step. It waits until
      // enough of it is there to say which step it ticks.
      else if (live && i === lines.length - 1 && entry.check && last?.t === 'list' && last.items.some((it) => it.check !== undefined)) continue
      else if (last?.t === 'list' && last.ordered === ordered) last.items.push(entry)
      else out.push({ t: 'list', ordered, items: [entry] })
      continue
    }
    para.push(line)
  }
  flush()
  const items = (b: Block) => (b.t === 'list' ? b.items : undefined)
  return sincePlan(foldChecklists(out, items), items, prior)
}

// The cells of one table row. A pipe inside inline code or after a backslash is part of the cell.
const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|(?=(?:[^`]*`[^`]*`)*[^`]*$)/).map((c) => c.trim().replace(/\\\|/g, '|'))

// A code block with a way to copy it. The button says so for a moment once it has.
function Code({ text, lang, children }: { text: string; lang?: string; children?: ReactNode }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1400)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <div className="codewrap" data-lang={lang || undefined}>
      <pre className="codeblock" dir="ltr">{highlight(text, lang).map(([t, role], i) => (role ? <span key={i} className={role}>{t}</span> : t))}{children}</pre>
      {text.trim() && <button type="button" className="codecopy" onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true), () => {})}>{copied ? 'Copied' : 'Copy'}</button>}
    </div>
  )
}

// One line of text with code, bold and links, for places that show a single line (the plan).
export function Inline({ text }: { text: string }) {
  return <>{inline(text)}</>
}

// prior: the room's plan before this message, so a repeated checklist shows only what changed.
// plan: the room's plan. A checklist that is that plan lives in the panel, so the chat draws it as
// it arrives and lets it go; a different list, a summary at the end say, stays where it is.
// caret: the text is still being written. flowing: this row showed the turn while it ran, so a
// plan it drew is still on its way to the panel after the turn has ended.
export const Rich = memo(function Rich({ text, caret = false, flowing = caret, prior, plan }: { text: string; caret?: boolean; flowing?: boolean; prior?: Pick<Step, 'text' | 'done'>[]; plan?: Pick<Step, 'text'>[] }) {
  const list = blocks(caret ? steady(text) : text, prior, caret)
  return (
    <div className="rich">
      {list.map((b, i) => {
        const end = caret && i === list.length - 1 ? <span className="caret" /> : null
        switch (b.t) {
          case 'p': return <p key={i} dir="auto">{b.text.split('\n').map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l)}</Fragment>)}{end}</p>
          case 'h': return <h4 key={i} dir="auto">{inline(b.text)}{end}</h4>
          case 'code': return b.lang === 'lunchbox-theme' ? <ThemeOffer key={i} code={b.text} /> : <Code key={i} text={b.text} lang={b.lang}>{end}</Code>
          case 'quote': {
            // A quote taken from the room names who said it on its first line.
            const said = b.paras[0].match(/^([^\n]{1,40}) said:\n/)
            const paras = said ? [b.paras[0].slice(said[0].length), ...b.paras.slice(1)] : b.paras
            return (
              <blockquote key={i}>
                {said && <cite>{said[1]}</cite>}
                {paras.map((t, j) => <p key={j} dir="auto">{t.split('\n').map((l, k) => <Fragment key={k}>{k > 0 && <br />}{inline(l)}</Fragment>)}{j === paras.length - 1 && end}</p>)}
              </blockquote>
            )
          }
          case 'rule': return <hr key={i} />
          case 'table': return (
            <div key={i} className="tablewrap">
              <table>
                <thead><tr>{b.head.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead>
                <tbody>{b.rows.map((r, j) => <tr key={j}>{b.head.map((_, k) => <td key={k} dir="auto">{inline(r[k] ?? '')}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )
          case 'list': {
            // A live list that starts with an open step is a plan from its first line, so it never
            // changes shape when the second arrives.
            if (b.items.every((it) => it.check !== undefined) && (b.items.length > 1 || (caret && i === list.length - 1 && !b.items[0].check))) {
              const isPlan = !!plan?.length && b.items.every((it) => plan.some((s) => same(s.text, it.text)))
              if (isPlan && !flowing) return null
              return <PlanCard key={i} items={b.items} live={flowing} writing={caret} plan={isPlan} render={inline} />
            }
            const Tag = b.ordered ? 'ol' : 'ul'
            return (
              <Tag key={i}>
                {b.items.map((it, j) => (
                  <li key={j} dir="auto" className={it.check === undefined ? '' : it.check ? 'todo done' : 'todo'}>
                    {it.check !== undefined && <i />}<span>{inline(it.text)}</span>
                  </li>
                ))}
                {end}
              </Tag>
            )
          }
        }
      })}
      {/* The first line is there before its first word, so the row does not grow when it comes. */}
      {caret && !list.length && <p><span className="caret" /></p>}
    </div>
  )
})
