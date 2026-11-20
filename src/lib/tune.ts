import { contrast, on } from './custom'
import type { Mode } from './themes'

// Fine tuning: one colour changed on top of whatever theme is on, and nothing else. Each mode keeps
// its own, since a text colour that reads at night rarely reads by day. What follows from a change
// is worked out here, so a single pick cannot break the rest: the secondary text and the lines are
// drawn from the text colour, and the text on a selected row or a button from that colour.

export type Part = '--ink' | '--ground' | '--sheet' | '--well' | '--block' | '--accent' | '--warn' | '--bad'
export type Tune = Record<Mode, Partial<Record<Part, string>>>

export const PARTS: { key: Part; name: string; hint: string }[] = [
  { key: '--ink', name: 'Text', hint: 'Messages, titles and labels. Secondary text and lines follow it' },
  { key: '--sheet', name: 'Sheet', hint: 'Where the work sits' },
  { key: '--ground', name: 'Frame', hint: 'Behind the sidebar and around the sheet' },
  { key: '--well', name: 'Message box', hint: 'The box you write in, and cards' },
  { key: '--block', name: 'Selected', hint: 'The row, chip or option you picked' },
  { key: '--accent', name: 'Accent', hint: 'Send, ticks and progress' },
  { key: '--warn', name: 'Waiting', hint: 'When a room needs you' },
  { key: '--bad', name: 'Failure', hint: 'Errors and Full access' },
]

const HEX = /^#[0-9a-f]{6}$/i
export const NO_TUNE: Tune = { dark: {}, light: {} }

// Whatever was stored, as a tune: only the colours that can be tuned, and only as hex.
export function cleanTune(raw: unknown): Tune {
  const part = (m: unknown) => Object.fromEntries(Object.entries(m && typeof m === 'object' ? m : {}).filter(([k, v]) => PARTS.some((p) => p.key === k) && typeof v === 'string' && HEX.test(v)))
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return { dark: part(r.dark), light: part(r.light) }
}
export function loadTune(): Tune {
  try { return cleanTune(JSON.parse(localStorage.getItem('lb.tune') ?? 'null')) } catch { return NO_TUNE }
}

// The custom properties a tune sets, with everything that follows from them.
export function tuned(t: Tune, mode: Mode): Record<string, string> {
  const own = t[mode]
  const set: Record<string, string> = { ...own }
  if (own['--ink']) {
    const mix = (n: number) => `color-mix(in oklab, var(--ink) ${n}%, transparent)`
    Object.assign(set, { '--dim': mix(64), '--faint': mix(40), '--line': mix(9), '--line2': mix(16), '--cell': mix(13), '--hover': mix(5) })
  }
  if (own['--block']) set['--on-block'] = on(own['--block'])
  if (own['--accent']) set['--on-accent'] = on(own['--accent'])
  return set
}

// What the panel warns about: text that is hard to read on the sheet or in the message box.
export function warnings(text: string, sheet: string, well: string) {
  const out: string[] = []
  if (contrast(text, sheet) < 4.5) out.push('Text is hard to read on the sheet.')
  else if (contrast(text, well) < 4.5) out.push('Text is hard to read in the message box.')
  return out
}

// Any CSS colour as hex, the way the screen shows it, for the colour pickers.
const probe = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d', { willReadFrequently: true }) : null
export function hexOfCss(css: string, under = '#000000') {
  if (!probe || !css) return under
  probe.canvas.width = probe.canvas.height = 1
  probe.fillStyle = under
  probe.fillRect(0, 0, 1, 1)
  probe.fillStyle = css
  probe.fillRect(0, 0, 1, 1)
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
}
