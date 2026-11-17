import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { surfaces, THEMES, type Mode, type Theme, type ThemeId } from '../lib/themes'

// A small window in a theme's own colours in the mode that is on: the sidebar with a selected row
// in its block colour, the sheet with a strip of its ASCII ramp, and the message box with the send
// button in its accent.
export function ThemeMini({ t, mode }: { t: Theme; mode: Mode }) {
  const s = surfaces(t, mode)
  const tone = t[mode]
  const lunchbox = t.id === 'lunchbox'
  const vars = {
    '--tf': lunchbox ? (mode === 'dark' ? '#080807' : '#efeee9') : s.ground,
    '--ts': lunchbox ? (mode === 'dark' ? '#0e0e0d' : '#fbfaf7') : s.sheet,
    '--tw': lunchbox ? (mode === 'dark' ? '#161614' : '#f3f2ee') : s.well,
    '--ti': lunchbox ? (mode === 'dark' ? '#f2f0ea' : '#0e0e0d') : s.ink,
    '--tb': tone.block, '--ta': tone.accent,
  } as CSSProperties
  return (
    <span className="tmini" style={vars} aria-hidden="true">
      <span className="tside"><i /><i className="sel" /><i /><i /></span>
      <span className="tsheet">
        <span className="tglyph">{[0, 1, 2, 3, 2, 1, 2, 3, 3, 2, 1, 0].map((g, i) => <span key={i} style={{ background: tone.glyphs[g] }} />)}</span>
        <span className="tbox"><span className="tsend" /></span>
      </span>
    </span>
  )
}

// Every theme as a card, the ones a person made after the built in ones, with room for the cards
// that make new ones. The same cards on the first run and in Settings.
export function ThemeCards({ value, mode, pick, custom = [], tools, extra }: {
  value: ThemeId; mode: Mode; pick: (t: ThemeId, e: MouseEvent) => void; custom?: Theme[]
  tools?: (t: Theme) => ReactNode; extra?: ReactNode
}) {
  return (
    <div className="themes" role="radiogroup" aria-label="Theme">
      {[...THEMES, ...custom].map((t) => (
        <div key={t.id} className="themeslot">
          <button role="radio" aria-checked={value === t.id} className={`themecard${value === t.id ? ' on' : ''}`} onClick={(e) => pick(t.id, e)} title={t.note}>
            <ThemeMini t={t} mode={mode} />
            <b>{t.name}</b>
            <small>{t.note}</small>
          </button>
          {t.custom && tools?.(t)}
        </div>
      ))}
      {extra}
    </div>
  )
}
