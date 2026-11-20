import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { hexOfCss, PARTS, warnings, type Part, type Tune } from '../lib/tune'
import type { Mode } from '../lib/themes'
import { useModal } from '../lib/modal'

// Fine tuning one colour at a time on top of the theme that is on. Changes apply at once and are
// kept; each has its own reset. The colours shown are read back from the window after App has
// painted, so they are what is on screen, theme and tune together.
export function TuneSheet({ tune, setTune, mode, setMode, close, theme, name }: {
  tune: Tune; setTune: (t: Tune) => void; mode: Mode; setMode: (m: Mode) => void; close: () => void; theme: string; name: string
}) {
  const [seen, setSeen] = useState<Record<string, string>>({})
  useModal()
  useEffect(() => {
    const css = getComputedStyle(document.documentElement)
    const sheet = hexOfCss(css.getPropertyValue('--sheet').trim())
    setSeen(Object.fromEntries(PARTS.map((p) => [p.key, hexOfCss(css.getPropertyValue(p.key).trim(), sheet)])))
  }, [tune, mode, theme])
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close() } }
    addEventListener('keydown', esc)
    return () => removeEventListener('keydown', esc)
  }, [close])

  const own = tune[mode]
  const value = (k: Part) => own[k] ?? seen[k] ?? '#000000'
  const set = (k: Part, v: string) => setTune({ ...tune, [mode]: { ...own, [k]: v } })
  const reset = (k: Part) => { const next = { ...own }; delete next[k]; setTune({ ...tune, [mode]: next }) }
  const changed = Object.keys(own).length
  const warn = seen['--ink'] ? warnings(value('--ink'), value('--sheet'), value('--well')) : []

  return createPortal(
    <div className="scrim center" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="sheetcard tunesheet" role="dialog" aria-label="Fine tune colours">
        <header>
          <h2>Fine tune</h2>
          <p>Change any colour of {name} on its own. Night and day keep their own, and so does each theme.</p>
        </header>
        <div className="tmode">
          <span>Colours for</span>
          <div className="seg">{(['dark', 'light'] as const).map((m) => <button key={m} className={m === mode ? 'on' : ''} onClick={() => setMode(m)}>{m === 'dark' ? 'Night' : 'Day'}</button>)}</div>
        </div>
        <div className="tunelist">
          {PARTS.map((p) => (
            <div key={p.key} className={`tunerow${own[p.key] ? ' set' : ''}`}>
              <label className="tunepick">
                <input type="color" value={value(p.key)} onChange={(e) => set(p.key, e.target.value)} />
                <i style={{ background: value(p.key) }} />
                <span><b>{p.name}</b><small>{p.hint}</small></span>
              </label>
              {own[p.key] ? <button className="btn small quiet" onClick={() => reset(p.key)}>Reset</button> : <span className="tunefrom">Theme</span>}
            </div>
          ))}
        </div>
        {warn.length > 0 && <ul className="tfixed">{warn.map((w) => <li key={w}>{w}</li>)}</ul>}
        <footer>
          <button className="btn quiet" disabled={!changed} onClick={() => setTune({ ...tune, [mode]: {} })}>Reset all</button>
          <span className="spacer" />
          <button className="btn" onClick={close}>Done</button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
