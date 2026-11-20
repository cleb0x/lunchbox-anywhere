import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { AgentInfo } from '../../shared/types'
import { Mark } from './bits'
import { IconBack, IconChevron } from './icons'
import { desk, reload, unavailable, useApp } from '../lib/desk'

// Model ids as people say them: claude-fable-5-2 is Fable 5.2, gpt-6-sol is GPT-6 Sol.
export function modelName(id: string) {
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)
  // A date on the end, claude-sonnet-4-20250514, is a snapshot and not part of the version.
  const claude = id.match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?=-|$)/)
  if (claude) {
    // What follows the version, as in claude-opus-4-6-thinking, tells two entries in one list apart.
    const rest = id.slice(claude[0].length).split('-').filter((w) => w && !/^\d{6,}$/.test(w))
    return [`${cap(claude[1])} ${claude[2]}${claude[3] ? '.' + claude[3] : ''}`, ...rest.map(cap)].join(' ')
  }
  if (/^(fable|opus|sonnet|haiku)$/.test(id)) return `${cap(id)}, newest`
  const gpt = id.match(/^gpt-([\d.]+)(?:-(.+))?$/)
  if (gpt) return `GPT-${gpt[1]}${gpt[2] ? ' ' + gpt[2].split('-').map(cap).join(' ') : ''}`
  const oss = id.match(/^gpt-oss-(.+)$/)
  if (oss) return `GPT-OSS ${oss[1].split('-').map((w) => (/^\d+[a-z]$/.test(w) ? w.toUpperCase() : cap(w))).join(' ')}`
  if (/^auto-gemini-/.test(id)) return `Gemini ${id.slice(12)}, auto`
  if (/^(gemini|grok|gemma)-/.test(id)) return id.split('-').map((w, i) => (i === 0 || /^[a-z]/.test(w) ? cap(w) : w)).join(' ')
  return id
}

const lists = new Map<string, Promise<string[]>>()
function listOf(a: AgentInfo) {
  if (!lists.has(a.id)) {
    // A lookup that failed or came back empty is tried again the next time the list opens.
    const forget = () => { lists.delete(a.id); return [] as string[] }
    lists.set(a.id, desk.call('agents:models', a.id).then((r: unknown) => (Array.isArray(r) && r.length ? (r as string[]) : forget()), forget))
  }
  return lists.get(a.id)!
}

// The crew menu: who is in the room, and beside each one the model it uses. The model opens that
// agent's list in place; picking one slides back. The same setting as on the Agents page.
// The first in the crew is the main agent; Make main moves another one to the front.
// With a single usable agent there is nobody to choose, so the menu opens on its models and a pick
// closes it: two clicks instead of three. The agent sits greyed in the corner and still opens the list.
export function CrewMenu({ listed, crew, toggle, promote, footer, close }: { listed: AgentInfo[]; crew: string[]; toggle: (id: string) => void; promote: (id: string) => void; footer: ReactNode; close: () => void }) {
  const models = useApp((s) => s.settings.models)
  const [at, setAt] = useState<AgentInfo | null>(null)
  const [came, setCame] = useState(false)
  const [all, setAll] = useState(false)
  const open = (a: AgentInfo) => { setCame(true); setAt(a) }
  const back = () => setAt(null)
  const usable = listed.filter((a) => !unavailable(a))
  const only = !all && usable.length === 1 && crew.includes(usable[0].id) ? usable[0] : null
  return (
    <Fit>
      {only ? (
        <div key="only"><Choices a={only} value={models[only.id] ?? ''} back={close} alone={() => { setCame(true); setAll(true) }} /></div>
      ) : at ? (
        <div key={at.id} className="slide in"><Choices a={at} value={models[at.id] ?? ''} back={back} /></div>
      ) : (
        <div key="crew" className={`slide${came ? ' returning' : ''}`}>
          {listed.map((a) => {
            const on = crew.includes(a.id)
            const why = unavailable(a)
            return (
              <div key={a.id} className={`crewrow${on ? ' checked' : ''}${why ? ' off' : ''}`}>
                <button className={`item${on ? ' checked' : ''}`} role="menuitemcheckbox" aria-checked={on} onClick={() => toggle(a.id)}>
                  <Mark seed={a.mark} size={14} />
                  <span className="grow"><b className="crewname"><span>{a.name}</span>{on && crew.length > 1 && (crew[0] === a.id
                    ? <em className="maintag">Main</em>
                    : !why && <em className="maintag make" role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); promote(a.id) }} onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); promote(a.id) } }}>Make main</em>)}</b><span>{why ?? a.good}</span></span>
                  <i className="check" />
                </button>
                {on && !why && (
                  <button className="modelchip" onClick={() => open(a)} title={`Model for ${a.short}`}>
                    {models[a.id] ? modelName(models[a.id]) : 'Default model'}<IconChevron />
                  </button>
                )}
              </div>
            )
          })}
          {footer}
        </div>
      )}
    </Fit>
  )
}

// Animates its height to whatever it holds, so the menu grows and shrinks instead of jumping.
export function Fit({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null)
  const [h, setH] = useState<number | undefined>(undefined)
  useLayoutEffect(() => {
    const el = inner.current!
    const ro = new ResizeObserver(() => setH(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return <div className="fit" style={{ height: h }}><div ref={inner}>{children}</div></div>
}

function Choices({ a, value, back, alone }: { a: AgentInfo; value: string; back: () => void; alone?: () => void }) {
  const models = useApp((s) => s.settings.models)
  const [list, setList] = useState<string[] | null>(null)
  const [find, setFind] = useState('')
  const [other, setOther] = useState(false)
  useEffect(() => { let on = true; listOf(a).then((l) => on && setList(l)); return () => { on = false } }, [a])
  const pick = (m: string) => { reload.settings({ models: { ...models, [a.id]: m } }); back() }
  const shown = (list ?? []).filter((m) => !find || m.toLowerCase().includes(find.toLowerCase()) || modelName(m).toLowerCase().includes(find.toLowerCase()))
  const fallback = a.via === 'cli' ? 'as set up in the tool' : a.model ? `now ${modelName(a.model)}` : 'picked for you'
  const row = (m: string) => (
    <button key={m} role="menuitemradio" aria-checked={value === m} className={`item modelrow${value === m ? ' on' : ''}`} onClick={() => pick(m)}>
      <span className="grow">{modelName(m)}</span>{modelName(m) !== m && <code>{m}</code>}
    </button>
  )
  return (
    <div className="modelset">
      {alone ? (
        <div className="modelhead alone">
          <b>Model</b>
          <button className="soleagent" onClick={alone} title={`${a.name} is the only agent set up. Open the agent list`}><Mark seed={a.mark} size={12} />{a.short}</button>
        </div>
      ) : (
        <button className="modelhead" onClick={back}><IconBack /><Mark seed={a.mark} size={12} /><b>{a.short}</b><span>model</span></button>
      )}
      {(list?.length ?? 0) > 12 && <input className="modelfind" placeholder={`Find among ${list!.length}`} value={find} onChange={(e) => setFind(e.target.value)} autoFocus />}
      <div className="modellist">
        <button role="menuitemradio" aria-checked={!value} className={`item modelrow${!value ? ' on' : ''}`} onClick={() => pick('')}>
          <span className="grow">Default</span><span className="modelnow">{fallback}</span>
        </button>
        {list === null && <div className="menunote">Looking up models</div>}
        {shown.slice(0, 80).map(row)}
        {value && list && !list.includes(value) && row(value)}
      </div>
      {other ? (
        <input className="modelfind" autoFocus placeholder="Model id, then Enter" onKeyDown={(e) => { const v = e.currentTarget.value.trim(); if (e.key === 'Enter' && v) pick(v) }} />
      ) : (
        <button className="item modelrow quiet" onClick={() => setOther(true)}><span className="grow">Another model by name</span></button>
      )}
      <Effort a={a} model={value} />
    </div>
  )
}

const LEVEL_NAMES: Record<string, string> = { minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' }

// How hard the agent thinks, for the model picked above. Only the levels that model takes are
// offered; a model with no such setting shows nothing.
export function Effort({ a, model, plain }: { a: AgentInfo; model: string; plain?: boolean }) {
  const efforts = useApp((s) => s.settings.effort)
  const [levels, setLevels] = useState<string[]>([])
  useEffect(() => {
    let on = true
    desk.call('agents:efforts', a.id, model).then((r: unknown) => on && setLevels(Array.isArray(r) ? (r as string[]) : []), () => on && setLevels([]))
    return () => { on = false }
  }, [a.id, model])
  if (!levels.length) return null
  // A level saved for another model that this one lacks is not sent, so it reads as Default.
  const now = levels.includes(efforts?.[a.id] ?? '') ? efforts![a.id] : ''
  const set = (v: string) => reload.settings({ effort: { ...efforts, [a.id]: v } })
  const seg = (
    <div className={`seg${plain ? '' : ' small'}`} role="radiogroup" aria-label={`Effort for ${a.short}`}>
      {['', ...levels].map((v) => (
        <button key={v || 'default'} role="radio" aria-checked={now === v} className={now === v ? 'on' : ''} onClick={() => set(v)} title={v ? undefined : `As set up in ${a.name}`}>{v ? LEVEL_NAMES[v] ?? v : 'Default'}</button>
      ))}
    </div>
  )
  return plain ? seg : <div className="modeleffort"><b>Effort</b>{seg}</div>
}
