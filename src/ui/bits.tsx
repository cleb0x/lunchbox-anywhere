import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { glyph } from './glyphs'

export const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches

// Each agent's mark is drawn by hand on a 7 by 7 dot grid, and says what the agent is for:
// Claude's burst, Codex's prompt, Grok's X, Gemini's four-point star, the local model's closed ring.
const MARKS: Record<string, string[]> = {
  claude: ['...#...', '.#.#.#.', '..###..', '###.###', '..###..', '.#.#.#.', '...#...'],
  codex: ['.......', '.#.....', '..#....', '...#...', '..#....', '.#.###.', '.......'],
  grok: ['#.....#', '.#...#.', '..#.#..', '...#...', '..#.#..', '.#...#.', '#.....#'],
  gemini: ['...#...', '...#...', '..###..', '#######', '..###..', '...#...', '...#...'],
  local: ['..###..', '.#...#.', '#.....#', '#..#..#', '#.....#', '.#...#.', '..###..'],
  lunchbox: ['#######', '#######', '#.....#', '#..#..#', '#.....#', '#.....#', '#######'],
}

// Any other tool gets its initial from the same dot font as the wordmark.
function cells(seed: string) {
  const drawn = MARKS[seed]
  if (drawn) return drawn.flatMap((row, y) => [...row].flatMap((ch, x) => (ch === '#' ? [[x, y]] : [])))
  return glyph(seed[0] ?? '?').flatMap((bits, y) => Array.from({ length: 5 }, (_, x) => ((bits >> (4 - x)) & 1 ? [[x + 1, y]] : [])).flat())
}

import { BRANDS } from './brands'
const ALIAS: Record<string, string> = { local: 'ollama' }

export function Mark({ seed, size = 16, blink = 0, active = false }: { seed: string; size?: number; blink?: number; active?: boolean }) {
  const brand = BRANDS[ALIAS[seed] ?? seed]
  const on = useMemo(() => cells(seed), [seed])
  if (brand) return (
    <svg key={blink} className={`mark brand${blink ? ' blink' : ''}${active ? ' active' : ''}`} width={size} height={size} viewBox="0 0 24 24" fillRule="evenodd" aria-hidden="true">
      {brand.map((d, i) => <path key={i} d={d} />)}
    </svg>
  )
  const grid = size >= 20
  return (
    <svg key={blink} className={`mark${blink ? ' blink' : ''}${active ? ' active' : ''}`} width={size} height={size} viewBox="0 0 7 7" aria-hidden="true">
      {grid && Array.from({ length: 49 }, (_, i) => <circle key={'g' + i} className="off" cx={(i % 7) + 0.5} cy={Math.floor(i / 7) + 0.5} r=".3" />)}
      {on.map(([x, y], i) => (
        <circle key={i} className="on" cx={x + 0.5} cy={y + 0.5} r=".42" style={{ '--d': `${(Math.abs(x - 3) + Math.abs(y - 3)) * 70}ms` } as CSSProperties} />
      ))}
    </svg>
  )
}

export function Loader({ size = 14 }: { size?: number }) {
  return (
    <svg className="loader" width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="Working">
      {Array.from({ length: 25 }, (_, i) => {
        const x = i % 5, y = Math.floor(i / 5)
        return <rect key={i} x={x * 5} y={y * 5} width="4" height="4" rx=".7" style={{ animationDelay: `${(Math.abs(x - 2) + Math.abs(y - 2)) * 90}ms` }} />
      })}
    </svg>
  )
}

// Each cell is a share of what is left, so the picture is the number.
export function Meter({ value, cells = 20, tone }: { value: number; cells?: number; tone?: 'warn' | 'bad' }) {
  const lit = Math.round(value * cells)
  return (
    <span className={`meter${tone ? ' ' + tone : ''}`} role="img" aria-label={`${Math.round(value * 100)} percent left`}>
      {Array.from({ length: cells }, (_, i) => <i key={i} className={i < lit ? 'on' : ''} style={{ '--i': i } as CSSProperties} />)}
    </span>
  )
}

// A small preview of a file on disk: the image itself when it is one, its extension otherwise.
export function Thumb({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const image = /\.(png|jpe?g|gif|webp)$/i.test(path)
  useEffect(() => {
    setSrc(null)
    if (!image || !window.lb) return
    let alive = true
    // A file that cannot be read keeps the extension tile.
    window.lb.call('file:image', path).then((url: string | null) => { if (alive && url) setSrc(url) }, () => {})
    return () => { alive = false }
  }, [path, image])
  return src ? <img className="thumb" src={src} alt="" /> : <i className="thumb">{path.split('.').pop()?.slice(0, 4) || 'file'}</i>
}

// A destructive button that asks twice. Moving the pointer away, tabbing away or Esc disarms it,
// so a stray second click later never deletes anything.
export function Sure({ act, className, label, children }: { act: () => unknown; className: string; label?: string; children: (sure: boolean) => ReactNode }) {
  const [sure, setSure] = useState(false)
  const off = () => setSure(false)
  return (
    <button className={`${className}${sure ? ' sure' : ''}`} aria-label={sure ? undefined : label} title={label}
      onClick={() => { if (!sure) return setSure(true); off(); const r = act(); if (r instanceof Promise) r.catch(() => {}) }} onMouseLeave={off} onBlur={off}
      onKeyDown={(e) => { if (e.key === 'Escape' && sure) { e.preventDefault(); e.stopPropagation(); off() } }}>
      {children(sure)}
    </button>
  )
}
