import { useMemo, useState } from 'react'
import { build } from '../lib/custom'
import { ThemeMini } from './ThemeCards'

// A theme an agent designed, sent as a code block marked lunchbox-theme. While the block is still
// arriving, or if it is not a theme, it shows as the code it is. Using it saves the theme with the
// others and switches to it; Fine tune it does the same and opens it in the theme editor.
export function ThemeOffer({ code }: { code: string }) {
  const built = useMemo(() => { try { return build(JSON.parse(code)) } catch { return null } }, [code])
  const [used, setUsed] = useState(false)
  const [open, setOpen] = useState(false)
  if (!built) return <pre className="codeblock" data-lang="lunchbox-theme">{code}</pre>
  const { theme, fixed } = built
  const mode = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
  const use = () => { dispatchEvent(new CustomEvent('lb:theme', { detail: theme })); setUsed(true) }
  const tune = () => { use(); dispatchEvent(new CustomEvent('lb:go', { detail: { name: 'settings', edit: theme.id } })) }
  return (
    <div className="themeoffer">
      <div className="toview">
        <ThemeMini t={theme} mode={mode} />
        <ThemeMini t={theme} mode={mode === 'dark' ? 'light' : 'dark'} />
      </div>
      <div className="tobody">
        <b>{theme.name}</b>
        <span>{theme.note}</span>
        {fixed.length > 0 && <small>{fixed.length === 1 ? fixed[0] : `Lunchbox adjusted ${fixed.length} colours so everything reads.`}</small>}
        <div className="row">
          {used ? <span className="toused">In use. Change it any time in Settings.</span> : <button className="btn small" onClick={use}>Use this theme</button>}
          <button className="btn small quiet" onClick={tune}>Fine tune it</button>
          <button className="btn small quiet" onClick={() => setOpen(!open)}>{open ? 'Hide the code' : 'Show the code'}</button>
        </div>
      </div>
      {open && <pre className="codeblock">{code}</pre>}
    </div>
  )
}
