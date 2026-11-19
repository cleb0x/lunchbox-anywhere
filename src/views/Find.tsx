import { useEffect, useRef, useState, type RefObject } from 'react'
import { still } from '../ui/bits'
import { IconClose, IconDown } from '../ui/icons'
import { mod } from '../lib/desk'

// What is left out of a search: controls, timings and the line that says what an agent is doing.
const SKIP = 'button,.msgtools,.workpair,.when,time,[aria-hidden=true],.find,.quotebtn'
// Text is searched a block at a time, so a match can run across bold, code and links.
const BLOCK = 'p,li,pre,h4,td,th,figcaption,.asked,.cmd,.out,.who,.handhead'

// Every place the words occur in what the room shows, in reading order.
export function matches(root: HTMLElement, query: string): Range[] {
  const q = query.toLowerCase()
  if (!q) return []
  const groups = new Map<Element, Text[]>()
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const el = n.parentElement
    if (!el || !n.nodeValue || el.closest(SKIP)) continue
    const block = el.closest(BLOCK) ?? el
    const list = groups.get(block)
    if (list) list.push(n as Text)
    else groups.set(block, [n as Text])
  }
  const out: Range[] = []
  for (const nodes of groups.values()) {
    const raw = nodes.map((n) => n.data).join('')
    const text = raw.toLowerCase()
    // A letter whose lower case is longer would move every place after it.
    if (text.length !== raw.length) continue
    for (let at = text.indexOf(q); at >= 0; at = text.indexOf(q, at + q.length)) {
      const r = document.createRange()
      let seen = 0
      for (const n of nodes) {
        const end = seen + n.length
        if (at >= seen && at < end) r.setStart(n, at - seen)
        if (at + q.length > seen && at + q.length <= end) { r.setEnd(n, at + q.length - seen); break }
        seen = end
      }
      if (!r.collapsed) out.push(r)
    }
  }
  return out
}

const paint = (all: Range[], now?: Range) => {
  if (!('highlights' in CSS)) return
  if (all.length) CSS.highlights.set('lb-find', new Highlight(...all))
  else CSS.highlights.delete('lb-find')
  if (now) CSS.highlights.set('lb-find-at', new Highlight(now))
  else CSS.highlights.delete('lb-find-at')
}

// Find in the room: every match is marked, the one you are on more strongly, and the count says
// where you are among them. It keeps up while a reply is still being written.
// moving: called before the view is taken to a match, so the room stops following new text.
export function Find({ box, close, moving }: { box: RefObject<HTMLDivElement | null>; close: () => void; moving: () => void }) {
  const [q, setQ] = useState(() => {
    // Opened with words selected in the room, it looks for those.
    const sel = getSelection()
    const picked = sel && !sel.isCollapsed && box.current?.contains(sel.anchorNode) ? sel.toString().trim() : ''
    return picked && picked.length <= 80 && !picked.includes('\n') ? picked : ''
  })
  const [n, setN] = useState(0)
  const [at, setAt] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const found = useRef<Range[]>([])
  const where = useRef(0)
  where.current = at

  // Where the search set out from, as a distance down the room: the top of what was in view
  // when it opened, then the last match stepped to. Typing more of a word looks from the same
  // place, so the view does not creep with every letter.
  const origin = useRef<number | null>(null)
  const down = (r: Range, el: HTMLElement) => {
    // Words folded away are laid out under their message, over whatever comes next. They count
    // as being where the fold ends.
    const fold = r.startContainer.parentElement?.closest('.folded:not(.open)')
    const top = r.getBoundingClientRect().top
    return (fold ? Math.min(top, fold.getBoundingClientRect().bottom) : top) - el.getBoundingClientRect().top + el.scrollTop
  }

  const show = (i: number, move: false | 'jump' | 'glide') => {
    const list = found.current
    const r = list[i]
    paint(list, r)
    const el = box.current
    if (!r || !el || !move) return
    // A match in the part of a long message that is folded away opens the message.
    const fold = r.startContainer.parentElement?.closest('.folded:not(.open)')
    if (fold && r.getBoundingClientRect().bottom > fold.getBoundingClientRect().top + fold.clientHeight * 0.6) (fold.nextElementSibling as HTMLElement | null)?.click()
    requestAnimationFrame(() => {
      const rect = r.getBoundingClientRect(), frame = el.getBoundingClientRect()
      if (rect.top > frame.top + 56 && rect.bottom < frame.bottom - 64) return
      moving()
      el.scrollTo({ top: el.scrollTop + rect.top - frame.top - el.clientHeight / 2, behavior: move === 'jump' || still() ? 'auto' : 'smooth' })
    })
  }

  const scan = (fresh: boolean) => {
    const el = box.current
    if (!el) return
    const list = matches(el, q.trim())
    found.current = list
    let i = Math.min(where.current, Math.max(0, list.length - 1))
    if (fresh) {
      origin.current ??= el.scrollTop
      const from = origin.current
      // The first match at or below where the search set out from, else the last one above it.
      const first = list.findIndex((r) => down(r, el) + r.getBoundingClientRect().height >= from)
      i = first >= 0 ? first : Math.max(0, list.length - 1)
    }
    setN(list.length)
    setAt(i)
    show(i, fresh && 'jump')
  }
  const scanRef = useRef(scan)
  scanRef.current = scan

  useEffect(() => { scanRef.current(true) }, [q])
  // Text that arrives while the bar is open is searched too, without moving the view.
  useEffect(() => {
    const el = box.current
    if (!el) return
    let timer: ReturnType<typeof setTimeout> | undefined
    // Not put off again by each new word, or a reply being written would never be searched.
    const mo = new MutationObserver(() => { timer ??= setTimeout(() => { timer = undefined; scanRef.current(false) }, 160) })
    mo.observe(el, { childList: true, subtree: true, characterData: true })
    return () => { mo.disconnect(); clearTimeout(timer); paint([]) }
  }, [])

  const step = (by: number) => {
    const total = found.current.length
    if (!total) return
    const i = (where.current + by + total) % total
    setAt(i)
    if (box.current) origin.current = down(found.current[i], box.current)
    show(i, 'glide')
  }
  const stepRef = useRef(step)
  stepRef.current = step
  useEffect(() => {
    input.current?.select()
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'g') { e.preventDefault(); stepRef.current(e.shiftKey ? -1 : 1) }
    }
    const again = () => { input.current?.focus(); input.current?.select() }
    addEventListener('keydown', key)
    addEventListener('lb:find', again)
    return () => { removeEventListener('keydown', key); removeEventListener('lb:find', again) }
  }, [])

  return (
    <div className="find" role="search">
      <input ref={input} value={q} autoFocus spellCheck={false} placeholder="Find in this room" aria-label="Find in this room"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
          else if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); step(e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey) ? -1 : 1) }
        }} />
      <span className="count" aria-live="polite">{q.trim() ? (n ? `${at + 1} of ${n}` : 'No matches') : ''}</span>
      <button type="button" className="iconbtn up" disabled={!n} onClick={() => step(-1)} aria-label="Previous match" title="Previous (Shift Enter)"><IconDown /></button>
      <button type="button" className="iconbtn" disabled={!n} onClick={() => step(1)} aria-label="Next match" title="Next (Enter)"><IconDown /></button>
      <button type="button" className="iconbtn" onClick={close} aria-label="Close find" title={`Close (Esc). ${mod}F opens it again.`}><IconClose /></button>
    </div>
  )
}
