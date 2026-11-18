import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatSource, FoundChat, RoomMeta } from '../../shared/types'
import { Loader, Mark } from '../ui/bits'
import { IconClose, IconSearch } from '../ui/icons'
import { useModal } from '../lib/modal'
import { ago, desk, machine, reason, tail } from '../lib/desk'

const NAMES: Record<ChatSource, string> = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI', grok: 'Grok' }
const size = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`)

// Chats held in Claude Code, Codex, Gemini CLI and Grok on this computer, newest first. Picking
// one makes a room of it in the folder it was held in, and the conversation carries on there.
export function ImportSheet({ close, open, say }: { close: () => void; open: (room: string) => void; say: (t: string) => void }) {
  useModal()
  const [list, setList] = useState<FoundChat[] | null>(null)
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<ChatSource | null>(null)
  const [at, setAt] = useState(0)
  const [taking, setTaking] = useState('')
  const rows = useRef<HTMLDivElement>(null)

  useEffect(() => {
    desk.call('import:list').then((l: FoundChat[]) => setList(l ?? []), (e) => { say(reason(e)); setList([]) })
  }, [])

  const agents = useMemo(() => [...new Set((list ?? []).map((c) => c.agent))], [list])
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return (list ?? []).filter((c) => (!only || c.agent === only) && words.every((w) => `${c.title ?? ''} ${c.first} ${c.folder} ${NAMES[c.agent]}`.toLowerCase().includes(w)))
  }, [list, q, only])
  const sel = shown.length ? Math.min(at, shown.length - 1) : 0
  useEffect(() => setAt(0), [q, only])
  useEffect(() => { rows.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' }) }, [sel])

  const take = async (c: FoundChat) => {
    if (taking) return
    setTaking(c.file)
    try {
      const room: RoomMeta = await desk.call('import:take', c.agent, c.file)
      close()
      open(room.id)
    } catch (e) {
      say(reason(e))
      setTaking('')
    }
  }

  return (
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="sheetcard importsheet" role="dialog" aria-label="Import a chat"
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); close() }
          if (e.key === 'ArrowDown') { e.preventDefault(); setAt(Math.min(sel + 1, shown.length - 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setAt(Math.max(sel - 1, 0)) }
          if (e.key === 'Enter' && shown[sel] && (e.target as HTMLElement).tagName !== 'BUTTON') take(shown[sel])
        }}>
        <header className="fbhead">
          <div className="grow">
            <h2>Import a chat</h2>
            <p>Chats from the agents on {machine()}. Pick one and it opens as a room in its folder, ready to carry on.</p>
          </div>
          <button className="iconbtn" onClick={close} aria-label="Close"><IconClose /></button>
        </header>

        <div className="imbar">
          <label className="imfind"><IconSearch /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find by what was said or the folder" spellCheck={false} /></label>
          {agents.length > 1 && (
            <span className="seg small">
              <button className={only ? '' : 'on'} onClick={() => setOnly(null)}>All</button>
              {agents.map((a) => <button key={a} className={only === a ? 'on' : ''} onClick={() => setOnly(a)}>{NAMES[a]}</button>)}
            </span>
          )}
        </div>

        <div className="imlist" ref={rows}>
          {list === null && <div className="imnone"><Loader size={12} /><span>Looking through your chats</span></div>}
          {list?.length === 0 && <div className="imnone"><b>No chats found</b><span>Lunchbox looks where Claude Code, Codex, Gemini CLI and Grok keep theirs on {machine()}.</span></div>}
          {!!list?.length && !shown.length && <div className="imnone"><span>Nothing matches “{q.trim()}”</span></div>}
          {shown.map((c, i) => (
            <button key={c.file} className={`imrow${i === sel ? ' on' : ''}`} data-agent={c.agent} disabled={!!taking && taking !== c.file} onMouseMove={() => i !== sel && setAt(i)} onClick={() => take(c)}>
              <Mark seed={c.agent} size={16} />
              <span className="grow">
                <b>{c.title || c.first}</b>
                {c.title && <span className="imfirst">{c.first}</span>}
                <small>
                  <span title={c.folder}>{c.folder ? tail(c.folder, 40) : 'No folder'}</span>
                  {!c.there && <em title="The room gets a new folder, and the agents read the conversation from the room">folder gone</em>}
                  <span>{ago(c.at)}</span>
                  <span>{size(c.size)}</span>
                </small>
              </span>
              {taking === c.file && <Loader size={10} />}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
