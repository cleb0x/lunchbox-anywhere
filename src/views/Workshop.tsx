import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { WorkshopState } from '../../shared/types'
import { Loader, Mark, Sure } from '../ui/bits'
import { IconFolder, IconPlay, IconShare } from '../ui/icons'
import { agentOf, ago, desk, isDesktop, mod, reason, unavailable, useApp } from '../lib/desk'
import type { View } from '../App'

// A release reads as its version; anything else, such as a commit in tests, by its short id.
const label = (ref?: string) => (!ref ? '' : /^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 7) : ref.replace(/^v/, ''))

const IDEAS = [
  'A button that copies the whole room as Markdown',
  'A shortcut that opens the room\'s folder in my editor',
  'A page that lists my open GitHub pull requests',
  'A sound when an agent finishes',
]

// Where the person asks for what Lunchbox is missing. An agent builds it into their own copy of
// the source, they open that version in place of the standard one, and they can send it to us.
export function Workshop({ go, say }: { go: (v: View) => void; say: (t: string) => void }) {
  const [state, setState] = useState<WorkshopState | null>(null)
  const rooms = useApp((s) => s.rooms)
  const agents = useApp((s) => s.agents)
  const settings = useApp((s) => s.settings)
  const version = useApp((s) => s.env.version)

  useEffect(() => {
    let on = true
    desk.call('workshop').then((s: WorkshopState) => on && setState(s), () => {})
    const off = desk.on('workshop', (s) => on && setState(s as WorkshopState))
    return () => { on = false; off() }
  }, [])

  const act = async (channel: string, done?: string) => {
    try {
      const s = (await desk.call(channel)) as WorkshopState | undefined
      if (s && typeof s === 'object' && 'ready' in s) setState(s)
      if (done && !s?.busy?.error) say(done)
      return s
    } catch (e) {
      say(reason(e))
    }
  }

  const ready = agents.filter((a) => !unavailable(a)).map((a) => a.id)
  const crew = (() => {
    const preferred = settings.defaultCrew.filter((id) => ready.includes(id))
    return preferred.length ? preferred : ready.slice(0, 2)
  })()

  const start = async (text: string) => {
    if (!state || !text.trim()) return
    if (!crew.length) return say('Connect an agent first, on the Agents page')
    try {
      const meta = await desk.call('room:create', { crew, workspace: state.dir, pack: 'workshop', about: text })
      await desk.call('room:send', meta.id, text, 'workspace', false, [])
      go({ name: 'room', id: meta.id })
    } catch (e) {
      say(reason(e))
    }
  }

  const ideas = rooms.filter((r) => r.pack === 'workshop' && !r.archived)
  const behind = !!state?.ready && !!state.base && state.base !== state.current
  const busy = state?.busy && !state.busy.error

  return (
    <div className="page">
      <div className="pagebody wide">
        <header className="pagehead ws-head rise">
          <h1>Workshop</h1>
          <p>Ask an agent for anything Lunchbox does not do yet. It builds it into your own copy of Lunchbox, which runs only on this computer, and you can send it to us as a suggestion.</p>
        </header>

        {!isDesktop && <div className="hint rise">The Workshop works in the desktop app.</div>}

        {state?.mine && (
          <section className="ws-mine rise" style={{ '--i': 1 } as CSSProperties}>
            <span className="ws-dot" aria-hidden />
            <div className="grow"><b>You are using your version</b><span>Built from your Workshop on Lunchbox {label(state.base)}. Updates install in the standard Lunchbox.</span></div>
            <button className="btn small quiet" onClick={() => act('workshop:back')}>Back to standard Lunchbox</button>
          </section>
        )}

        {state?.failed && (
          <section className="ws-note rise">
            <div className="grow">{state.failed}</div>
            <button className="btn small quiet" onClick={() => act('workshop:dismiss')}>Dismiss</button>
          </section>
        )}

        {state && (busy || state.busy?.error) && <Progress state={state} retry={() => act(state.ready ? 'workshop:open' : 'workshop:setup')} clear={() => act('workshop:dismiss')} agent={state.conflict ? () => start(`Bring my Workshop changes from Lunchbox ${state.base} onto ${state.current}. Git could not move them on its own, because the same code changed in the release. Rebase the commits on the branch mine onto the tag ${state.current} by hand, keep what each change was for, and make the typecheck, the tests and the build pass.`) : undefined} />}

        {state && !state.ready && !busy && <Setup state={state} version={version} setup={() => act('workshop:setup', 'The Workshop is ready')} />}

        {state?.ready && (
          <>
            <Ask disabled={!!busy} onStart={start} crew={crew} />

            {behind && (
              <section className="group rise" style={{ '--i': 2 } as CSSProperties}>
                <div className="settings">
                  <div className="setting">
                    <div className="grow"><b>Lunchbox was updated</b><span>Your changes are on {label(state.base)} and this is {label(state.current)}. Bring them along to keep using your version.</span></div>
                    <button className="btn small" disabled={!!busy} onClick={() => act('workshop:update', 'Your changes are on the new version')}>Bring them along</button>
                  </div>
                </div>
              </section>
            )}

            <section className="group rise" style={{ '--i': 3 } as CSSProperties}>
              <h2>Your changes<span className="quiet">{state.changes.length ? `${state.changes.length} file${state.changes.length === 1 ? '' : 's'} differ from Lunchbox ${label(state.base)}` : 'nothing yet'}</span>
                <span className="ws-tools">
                  <button className="ghostbtn" onClick={() => desk.call('workshop:folder')}><IconFolder /><span>Show folder</span></button>
                  {state.changes.length > 0 && (
                    <Sure act={() => act('workshop:reset', 'Back to Lunchbox as it shipped')} className="ghostbtn ws-undo" label="Undo every change in your copy">
                      {(sure) => <span>{sure ? 'Undo everything?' : 'Undo all changes'}</span>}
                    </Sure>
                  )}
                </span>
              </h2>
              {state.changes.length > 0 ? <Changes state={state} /> : <div className="ws-empty">What your agents change shows up here, file by file.</div>}
              <div className="settings">
                <div className="setting">
                  <div className="grow"><b>{state.mine ? 'You are using your version' : 'Use your version'}</b><span>{state.mine ? 'Restart to pick up what changed since it was built.' : 'Builds your copy and opens it in place of the standard Lunchbox. One click brings the standard one back.'}</span></div>
                  <button className="btn small" disabled={!!busy || behind || (!state.mine && !state.changes.length)} onClick={() => act('workshop:open')} title={behind ? 'Bring your changes to this version first' : undefined}>
                    <IconPlay />{state.mine ? 'Restart with the latest changes' : 'Open your version'}
                  </button>
                </div>
                <div className="setting ws-sendrow">
                  <div className="grow"><b>Send it to us</b><span>Your change and what you asked for go to the Lunchbox maintainers, who may build it in for everyone.</span></div>
                  <Suggest disabled={!!busy || !state.changes.length} say={say} />
                </div>
              </div>
              {state.use && !state.mine && <div className="hint">Your version opens when Lunchbox starts. <button className="linkish" onClick={() => act('workshop:stop-using')}>Open the standard one instead</button></div>}
            </section>

            {ideas.length > 0 && (
              <section className="group rise" style={{ '--i': 4 } as CSSProperties}>
                <h2>Ideas<span className="quiet">each one is a room with its agents</span></h2>
                <div className="settings">
                  {ideas.map((r) => (
                    <button key={r.id} className="setting ws-idea" onClick={() => go({ name: 'room', id: r.id })}>
                      <span className="grow"><b>{r.name}</b></span>
                      {r.waiting ? <i className="waitdot" title="Needs you" /> : r.busy ? <Loader size={10} /> : <small>{ago(r.updated)}</small>}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {!state && isDesktop && <div className="ws-empty rise"><Loader size={12} /> Looking at your Workshop</div>}
      </div>
    </div>
  )
}

// In a Workshop room's header: the two things to do once the agents are done.
export function WorkshopBar({ busy, say }: { busy: boolean; say: (t: string) => void }) {
  const [sending, setSending] = useState(false)
  const [opening, setOpening] = useState(false)
  const mine = useApp((s) => !!s.env.workshop)
  const openIt = async () => {
    setOpening(true)
    try {
      const s = (await desk.call('workshop:open')) as WorkshopState
      if (s?.busy?.error) say(s.busy.error)
    } catch (e) { say(reason(e)) } finally { setOpening(false) }
  }
  const send = async () => {
    setSending(true)
    try {
      const r = await desk.call('workshop:suggest', '', '')
      say(r?.ok ? 'Sent to the Lunchbox maintainers. Thank you' : r?.queued ? 'Saved, it goes out when you are back online' : 'It could not be sent')
    } catch (e) { say(reason(e)) } finally { setSending(false) }
  }
  const wait = busy ? 'Waits until the agents are done' : undefined
  return (
    <span className="ws-bar">
      <span className="tag ws-tag">Workshop</span>
      <button className="ghostbtn" disabled={busy || opening} onClick={openIt} title={wait ?? 'Build this copy and open it in place of the standard Lunchbox'}>{opening ? <Loader size={10} /> : <IconPlay />}<span>{mine ? 'Restart with changes' : 'Open your version'}</span></button>
      <button className="ghostbtn" disabled={busy || sending} onClick={send} title={wait ?? 'Send the change to the Lunchbox maintainers'}>{sending ? <Loader size={10} /> : <IconShare />}<span>Send as a suggestion</span></button>
    </span>
  )
}

function Setup({ state, version, setup }: { state: WorkshopState; version: string; setup: () => void }) {
  const missing = !state.needs.git || !state.needs.npm
  return (
    <section className="group rise" style={{ '--i': 1 } as CSSProperties}>
      <ol className="ws-steps">
        <li><code>01</code><div><b>A copy of Lunchbox</b><span>The source of Lunchbox {version} goes into a folder of its own, with what it needs to build. About 500 MB, once.</span></div></li>
        <li><code>02</code><div><b>Your agents build it</b><span>Say what you want. They change your copy in a room, knowing how Lunchbox is made and how it should look.</span></div></li>
        <li><code>03</code><div><b>Use it, or send it</b><span>Open your version in place of this one, and switch back in one click. Send it to us if everyone should have it.</span></div></li>
      </ol>
      <div className="settings">
        <Need name="Git" version={state.needs.git} url="https://git-scm.com/downloads" />
        <Need name="Node.js" version={state.needs.node && state.needs.npm ? state.needs.node : ''} url="https://nodejs.org" />
      </div>
      <div className="ws-actions">
        <button className="btn" disabled={missing} onClick={setup}>Set up the Workshop</button>
        {missing && <span className="hint">Install what is missing, then come back. Lunchbox looks again when you open this page.</span>}
      </div>
    </section>
  )
}

function Need({ name, version, url }: { name: string; version: string; url: string }) {
  return (
    <div className="setting">
      <div className="grow"><b>{name}</b><span>{version ? `Found, ${version}` : 'Not found on this computer'}</span></div>
      {version ? <span className="ws-ok">Ready</span> : <a className="btn small quiet" href={url} target="_blank" rel="noreferrer">Get {name}</a>}
    </div>
  )
}

function Progress({ state, retry, clear, agent }: { state: WorkshopState; retry: () => void; clear: () => void; agent?: () => void }) {
  const b = state.busy!
  const [, tick] = useState(0)
  useEffect(() => { if (b.error) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t) }, [b.error])
  const secs = Math.max(0, Math.round((Date.now() - b.at) / 1000))
  return (
    <section className={`ws-progress rise${b.error ? ' failed' : ''}`} aria-live="polite">
      <div className="ws-progresshead">
        {b.error ? <span className="ws-bad" aria-hidden /> : <Loader size={12} />}
        <b className="grow">{b.error ? 'That did not finish' : b.step}</b>
        {!b.error && <code>{secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`}</code>}
      </div>
      {b.error && <p>{b.error}</p>}
      {b.log.length > 0 && <pre className="ws-log">{b.log.slice(-6).join('\n')}</pre>}
      {b.error && (
        <div className="ws-actions">
          {agent ? <button className="btn small" onClick={agent}>Let an agent bring them over</button> : <button className="btn small" onClick={retry}>Try again</button>}
          <button className="btn small quiet" onClick={clear}>Close</button>
        </div>
      )}
    </section>
  )
}

function Ask({ disabled, onStart, crew }: { disabled: boolean; onStart: (text: string) => void; crew: string[] }) {
  const agents = useApp((s) => s.agents)
  const names = crew.map((id) => agentOf(id, agents).short)
  const [text, setText] = useState('')
  const field = useRef<HTMLTextAreaElement>(null)
  const go = () => { if (text.trim() && !disabled) { onStart(text.trim()); setText('') } }
  return (
    <section className="ws-ask rise" style={{ '--i': 1 } as CSSProperties}>
      <div className="ws-field">
        <textarea ref={field} rows={2} value={text} disabled={disabled} placeholder="What should Lunchbox do that it does not do yet?"
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go() } }} />
        <div className="ws-fieldfoot">
          {crew.length > 0
            ? <span className="ws-by"><span className="stack">{crew.map((id) => <span key={id}><Mark seed={agentOf(id, agents).mark} size={12} /></span>)}</span>{names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} build it` : `${names[0]} builds it`}, in a room of its own</span>
            : <span className="ws-by">Connect an agent on the Agents page to build it</span>}
          <button className="btn small" disabled={!text.trim() || disabled} onClick={go}>Build it<kbd>↵</kbd></button>
        </div>
      </div>
      <div className="ws-chips">
        <small>For example</small>
        {IDEAS.map((i) => <button key={i} className="ws-chip" onClick={() => { setText(i); field.current?.focus() }}>{i}</button>)}
      </div>
    </section>
  )
}

function Changes({ state }: { state: WorkshopState }) {
  const [all, setAll] = useState(false)
  const list = all ? state.changes : state.changes.slice(0, 8)
  return (
    <div className="ws-files">
      {list.map((c) => (
        <div key={c.file} className={`ws-file${c.fresh ? ' added' : ''}`}>
          <i className="ws-letter" title={c.fresh ? 'New file' : 'Changed'}>{c.fresh ? 'A' : 'M'}</i>
          <code className="grow">{c.file}</code>
          {c.fresh ? <span className="ws-new">new</span> : <span className="ws-count"><i>+{c.added}</i><em>−{c.removed}</em></span>}
        </div>
      ))}
      {state.changes.length > 8 && <button className="linkish" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${state.changes.length}`}</button>}
    </div>
  )
}

// One click sends it, with what was asked of the agents as the note. A note of their own is optional.
function Suggest({ disabled, say }: { disabled: boolean; say: (t: string) => void }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [contact, setContact] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const send = async () => {
    setSending(true)
    try {
      const r = await desk.call('workshop:suggest', note, contact)
      say(r?.ok ? 'Sent to the Lunchbox maintainers. Thank you' : r?.queued ? 'Saved, it goes out when you are back online' : 'It could not be sent')
      if (r?.ok || r?.queued) { setOpen(false); setNote(''); setSent(true) }
    } catch (e) {
      say(reason(e))
    } finally {
      setSending(false)
    }
  }
  if (!open) {
    return (
      <span className="ws-send">
        <button className="linkish ws-note-link" disabled={disabled} onClick={() => setOpen(true)}>Add a note</button>
        <button className="btn small quiet" disabled={disabled || sending} onClick={send} title="Sends your change and what you asked for to the Lunchbox maintainers">
          {sending ? <Loader size={10} /> : <IconShare />}{sent ? 'Sent, send again' : 'Send as a suggestion'}
        </button>
      </span>
    )
  }
  return (
    <div className="ws-suggest">
      <textarea autoFocus rows={3} value={note} placeholder="What it does and why you wanted it" onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); if (e.key === 'Escape') setOpen(false) }} />
      <input value={contact} placeholder="Email or X handle, if you want a reply" onChange={(e) => setContact(e.target.value)} />
      <div className="ws-actions">
        <span className="hint grow">Your note and the change go to the Lunchbox maintainers. Paths are written as ~ and keys are removed.</span>
        <button className="btn small quiet" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn small" disabled={sending} onClick={send}>{sending ? <Loader size={10} /> : null}Send<kbd>{mod}↵</kbd></button>
      </div>
    </div>
  )
}
