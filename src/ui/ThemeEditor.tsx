import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { asRaw, build, type Draft } from '../lib/custom'
import type { Mode, Theme } from '../lib/themes'
import { useModal } from '../lib/modal'

// Making or changing a theme. Every change shows on the whole app at once, through the preview
// event App listens to; Cancel puts the app back as it was. The text on blocks and buttons, and any
// colour too faint to read, is settled by build() in lib/custom, and the sheet says what it changed.
export function ThemeEditor({ start, id, mode, setMode, close, save }: {
  start: Draft; id?: string; mode: Mode; setMode: (m: Mode) => void; close: () => void; save: (t: Theme) => void
}) {
  const [draft, setDraft] = useState(start)
  useModal()
  const built = useMemo(() => build(asRaw(draft), id ?? 'custom-draft'), [draft, id])
  useEffect(() => {
    if (built) dispatchEvent(new CustomEvent('lb:theme-preview', { detail: built.theme }))
  }, [built])
  useEffect(() => () => { dispatchEvent(new CustomEvent('lb:theme-preview', { detail: null })) }, [])
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close() } }
    addEventListener('keydown', esc)
    return () => removeEventListener('keydown', esc)
  }, [close])

  const tone = draft[mode]
  const setTone = (patch: Partial<Draft['dark']>) => setDraft({ ...draft, [mode]: { ...tone, ...patch } })
  const done = () => { if (built) save(id ? { ...built.theme, id } : build(asRaw(draft))!.theme) }

  return createPortal(
    <div className="scrim center" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="sheetcard themeedit" role="dialog" aria-label={id ? 'Edit theme' : 'New theme'}>
        <header>
          <h2>{id ? 'Edit theme' : 'New theme'}</h2>
          <p>Every change shows on the app as you make it.</p>
        </header>
        <label className="tfield"><span>Name</span><input value={draft.name} maxLength={28} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
        <div className="tgrid">
          <Swatch label="Base" hint="Tints every surface" value={draft.base} set={(base) => setDraft({ ...draft, base })} />
          <label className="tfield"><span>Tint <em>{draft.tint < 0.008 ? 'Neutral' : draft.tint < 0.025 ? 'Soft' : 'Strong'}</em></span>
            <input type="range" min={0} max={0.045} step={0.001} value={draft.tint} onChange={(e) => setDraft({ ...draft, tint: +e.target.value })} />
          </label>
        </div>
        <div className="tmode">
          <span>Colours for</span>
          <div className="seg">{(['dark', 'light'] as const).map((m) => <button key={m} className={m === mode ? 'on' : ''} onClick={() => setMode(m)}>{m === 'dark' ? 'Night' : 'Day'}</button>)}</div>
        </div>
        <div className="tgrid">
          <Swatch label="Selected" hint="Rows and chips you picked" value={tone.block} set={(block) => setTone({ block })} />
          <Swatch label="Accent" hint="Send, ticks and progress" value={tone.accent} set={(accent) => setTone({ accent })} />
        </div>
        <div className="tfield">
          <span>ASCII, quiet to loud</span>
          <div className="tascii">{[0, 1, 2, 3].map((i) => (
            <Swatch key={i} value={tone.ascii[i] ?? tone.ascii[tone.ascii.length - 1]} set={(c) => { const ascii = [...tone.ascii]; ascii[i] = c; setTone({ ascii }) }} />
          ))}</div>
        </div>
        {built && built.fixed.length > 0 && <ul className="tfixed">{built.fixed.map((f) => <li key={f}>{f}</li>)}</ul>}
        <footer>
          <button className="btn quiet" onClick={close}>Cancel</button>
          <button className="btn" disabled={!built} onClick={done}>{id ? 'Save changes' : 'Save theme'}</button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

function Swatch({ label, hint, value, set }: { label?: string; hint?: string; value: string; set: (c: string) => void }) {
  return (
    <label className={`swatch${label ? '' : ' bare'}`} title={label ? undefined : value}>
      <input type="color" value={value} onChange={(e) => set(e.target.value)} />
      <i style={{ background: value }} />
      {label && <span><b>{label}</b><small>{hint}</small></span>}
    </label>
  )
}
