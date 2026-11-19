import { useEffect, useRef, useState, type RefObject } from 'react'

// The words selected in one message, and who wrote them.
type Picked = { text: string; who: string; x: number; top: number; bottom: number }

function picked(root: HTMLElement): Picked | null {
  const sel = getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null
  const text = sel.toString().trim()
  if (!text) return null
  const owner = (n: Node | null) => (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>('[data-who]') ?? null
  const from = owner(sel.anchorNode), to = owner(sel.focusNode)
  // Across two messages there is no one author to name.
  if (!from || from !== to || !root.contains(from)) return null
  const rect = sel.getRangeAt(0).getBoundingClientRect(), frame = root.getBoundingClientRect()
  if (!rect.width && !rect.height) return null
  return { text: text.slice(0, 4000), who: from.dataset.who!, x: Math.max(44, Math.min(frame.width - 44, rect.left + rect.width / 2 - frame.left)), top: rect.top - frame.top, bottom: rect.bottom - frame.top }
}

// A quote as it is sent: the author on the first line, then the words, each line marked.
export const quoteOf = (who: string, text: string) => `> ${who} said:\n${text.split('\n').map((l) => `> ${l}`.trimEnd()).join('\n')}\n\n`

// Select words in a message and a small Quote appears over them. It puts them in the message
// box with who said them, ready for a follow up. Q does the same from the keyboard.
export function Quote({ wrap }: { wrap: RefObject<HTMLDivElement | null> }) {
  const [sel, setSel] = useState<Picked | null>(null)
  const quote = () => {
    if (!sel) return false
    dispatchEvent(new CustomEvent('lb:quote', { detail: quoteOf(sel.who, sel.text) }))
    getSelection()?.removeAllRanges()
    setSel(null)
    return true
  }
  const quoteRef = useRef(quote)
  quoteRef.current = quote
  useEffect(() => {
    const read = () => setSel(wrap.current ? picked(wrap.current) : null)
    // While the mouse is still dragging, the button would sit under the pointer and move.
    let down = false
    const press = (e: MouseEvent) => { if (!(e.target as HTMLElement)?.closest?.('.quotebtn')) { down = true; setSel(null) } }
    const lift = () => { down = false; requestAnimationFrame(read) }
    const change = () => { if (!down) read() }
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key.toLowerCase() !== 'q' || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? '') || t?.isContentEditable) return
      if (quoteRef.current()) e.preventDefault()
    }
    document.addEventListener('selectionchange', change)
    addEventListener('mousedown', press)
    addEventListener('mouseup', lift)
    addEventListener('keydown', key)
    return () => {
      document.removeEventListener('selectionchange', change)
      removeEventListener('mousedown', press)
      removeEventListener('mouseup', lift)
      removeEventListener('keydown', key)
    }
  }, [])
  // The room moves under a selection while an agent writes, and not always by scrolling, so the
  // button is kept on the words for as long as it shows.
  const shown = !!sel
  useEffect(() => {
    if (!shown) return
    let raf = requestAnimationFrame(function track() {
      const p = wrap.current ? picked(wrap.current) : null
      setSel((now) => (!p || !now ? p : Math.abs(p.x - now.x) + Math.abs(p.top - now.top) + Math.abs(p.bottom - now.bottom) < 0.5 && p.text === now.text ? now : p))
      raf = requestAnimationFrame(track)
    })
    return () => cancelAnimationFrame(raf)
  }, [shown])
  if (!sel) return null
  // Above the words, or under them when they sit at the very top of the room.
  const below = sel.top < 44
  return (
    // mousedown is held back so pressing the button does not drop the selection it quotes.
    <button type="button" className={`quotebtn${below ? ' below' : ''}`} style={{ left: sel.x, top: below ? sel.bottom : sel.top }} onMouseDown={(e) => e.preventDefault()} onClick={quote}>
      Quote<kbd>Q</kbd>
    </button>
  )
}
