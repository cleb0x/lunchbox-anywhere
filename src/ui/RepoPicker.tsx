import { useEffect, useState } from 'react'
import { isRepo, type Repo } from '../../shared/github'
import { Menu } from './Access'
import { Loader } from './bits'
import { Fit } from './ModelPicker'
import { IconBack, IconClose, IconPlus, IconRepo } from './icons'
import { desk, reload, useApp } from '../lib/desk'

type Listing = { repos?: Repo[]; error?: string }

// The person's repositories are read once per window and kept; a failed read is tried again next time.
let listing: Promise<Listing> | null = null
function repos(fresh = false) {
  if (fresh || !listing) {
    listing = desk.call('github:repos').then((r: Listing | undefined) => r ?? { error: 'GitHub could not be reached.' }).catch(() => ({ error: 'GitHub could not be reached.' }))
    listing.then((r) => { if (r.error) listing = null })
  }
  return listing
}

// GitHub connects once, as a tool in the Library; the card opens there with the token field ready.
const connect = () => dispatchEvent(new CustomEvent('lb:go', { detail: { name: 'library', tool: 'github' } }))
const short = (r: string) => r.split('/')[1] ?? r

// The repository the room works on, beside the crew. Added repositories stay listed for every room;
// + opens the person's own list from GitHub, in place, like an agent's models.
export function RepoPicker({ value, onChange }: { value?: string; onChange: (repo: string | null) => void }) {
  const on = useApp((s) => !!s.settings.tools?.github?.on)
  return (
    <Menu label={value ? `Repository: ${value}` : 'Choose a repository'} className={`repo${value ? ' chosen' : ''}`}
      button={<><IconRepo />{value ? <span className="repoName" title={value}>{short(value)}</span> : <span className="pilltext">Repo</span>}</>}>
      {(close) => <RepoMenu value={value} connected={on} pick={(r) => { onChange(r); close() }} />}
    </Menu>
  )
}

function RepoMenu({ value, connected, pick }: { value?: string; connected: boolean; pick: (repo: string | null) => void }) {
  const saved = useApp((s) => s.settings.repos) ?? []
  const [adding, setAdding] = useState(false)
  const [came, setCame] = useState(false)
  const keep = (r: string) => reload.settings({ repos: [r, ...saved.filter((x) => x !== r)].slice(0, 12) })
  const drop = (r: string) => { reload.settings({ repos: saved.filter((x) => x !== r) }); if (value === r) pick(null) }

  if (!connected) {
    return (
      <div className="repoconnect">
        <span className="repoglyph"><IconRepo /></span>
        <b>Work on a GitHub repository</b>
        <span>Connect GitHub once with a token. Then pick any of your repositories here, and the room reads and changes it.</span>
        <button className="btn small" onClick={connect}>Connect GitHub</button>
      </div>
    )
  }
  const list = value && !saved.includes(value) ? [value, ...saved] : saved
  return (
    <Fit>
      {adding ? (
        <div key="add" className="slide in"><AddRepo saved={saved} back={() => setAdding(false)} add={(r) => { keep(r); pick(r) }} /></div>
      ) : (
        <div key="list" className={`slide${came ? ' returning' : ''}`}>
          <button role="menuitemradio" aria-checked={!value} className={`item modelrow${!value ? ' on' : ''}`} onClick={() => pick(null)}>
            <span className="grow">No repository</span><span className="modelnow">this room's folder</span>
          </button>
          {list.map((r) => (
            <div key={r} className="reporow">
              <button role="menuitemradio" aria-checked={value === r} className={`item modelrow${value === r ? ' on' : ''}`} onClick={() => pick(r)} title={r}>
                <span className="grow repoline"><span className="repoowner">{r.split('/')[0]}/</span>{short(r)}</span>
              </button>
              <button className="repodrop" onClick={() => drop(r)} aria-label={`Remove ${r} from the list`} title="Remove from the list"><IconClose /></button>
            </div>
          ))}
          {!list.length && <div className="menunote">No repositories added yet.</div>}
          <div className="sep" />
          <button className="item modelrow repoadd" onClick={() => { setCame(true); setAdding(true) }}>
            <IconPlus /><span className="grow">Add a repository</span>
          </button>
        </div>
      )}
    </Fit>
  )
}

function AddRepo({ saved, back, add }: { saved: string[]; back: () => void; add: (r: string) => void }) {
  const [got, setGot] = useState<Listing | null>(null)
  const [find, setFind] = useState('')
  const load = (fresh = false) => { setGot(null); return repos(fresh).then(setGot) }
  useEffect(() => { let live = true; repos().then((r) => live && setGot(r)); return () => { live = false } }, [])
  const q = find.trim().toLowerCase()
  const all = got?.repos ?? []
  const shown = all.filter((r) => !q || r.name.toLowerCase().includes(q) || r.about.toLowerCase().includes(q))
  // owner/name typed in full adds a repository that is not in the list, such as someone else's.
  const typed = isRepo(find.trim()) && !all.some((r) => r.name.toLowerCase() === q) ? find.trim() : null
  return (
    <div className="modelset">
      <button className="modelhead" onClick={back}><IconBack /><b>Add a repository</b><span>from your GitHub</span></button>
      <input className="modelfind" autoFocus placeholder={all.length ? `Find among ${all.length}, or type owner/name` : 'Type owner/name'} value={find}
        onChange={(e) => setFind(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { const r = typed ?? shown[0]?.name; if (r) add(r) } }} />
      <div className="modellist">
        {typed && <button className="item modelrow" onClick={() => add(typed)}><IconPlus /><span className="grow">Add {typed}</span></button>}
        {!got && <div className="menunote repowait"><Loader size={10} />Reading your repositories</div>}
        {(got?.error === 'connect' || got?.error === 'token') && (
          <div className="menunote">{got.error === 'token' ? 'GitHub did not accept the saved token.' : 'GitHub is switched on, but no token is saved yet.'} <button className="linkish" onClick={connect}>Add the token</button></div>
        )}
        {got?.error && got.error !== 'connect' && got.error !== 'token' && (
          <div className="menunote">{got.error} <button className="linkish" onClick={() => load(true)}>Try again</button></div>
        )}
        {got?.repos && !shown.length && !typed && <div className="menunote">{all.length ? 'Nothing matches. Type owner/name to add it anyway.' : 'No repositories on this account yet.'}</div>}
        {shown.slice(0, 100).map((r) => {
          const have = saved.includes(r.name)
          return (
            <button key={r.name} className={`item modelrow${have ? ' have' : ''}`} onClick={() => add(r.name)} title={r.about || r.name}>
              <span className="grow repoline"><span className="repoowner">{r.name.split('/')[0]}/</span>{short(r.name)}</span>
              {have ? <code>added</code> : r.private && <code>private</code>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
