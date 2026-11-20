import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { flushSync } from 'react-dom'
import type { Hit, RoomSummary, Skill } from '../shared/types'
import { Loader, Sure } from './ui/bits'
import { Logo } from './ui/Logo'
import { IconAgents, IconBrowser, IconClock, IconFlows, IconImport, IconInbox, IconLibrary, IconPin, IconPlus, IconPool, IconSave, IconSearch, IconSettings } from './ui/icons'
import { Onboarding } from './views/Onboarding'
import { RoomView } from './views/Room'
import { NewRoom } from './views/NewRoom'
import { Agents } from './views/Agents'
import { Settings } from './views/Settings'
import { Flows } from './views/Flows'
import { Pool } from './views/Pool'
import { WaitingPage } from './views/Waiting'
import { ReportSheet } from './views/Report'
import { Notices } from './ui/Notices'
import { rove } from './ui/Access'
import { Guard } from './ui/Guard'
import { openReport, type ReportOpen } from './lib/report'
import { Savings } from './views/Savings'
import { FreeModels } from './views/Free'
import { Library } from './views/Library'
import { Browser, useBrowser } from './views/Browser'
import { Palette, type Command } from './views/Palette'
import { ImportSheet } from './views/Import'
import { THEMES, asciiOf, themeOf, tokens, type AsciiId, type Mode, type Theme, type ThemeId } from './lib/themes'
import { loadCustom, saveCustom, themeBrief } from './lib/custom'
import { codeColours, wellOf } from './lib/codecolors'
import { loadTune, saveTune, tuned, type Tune } from './lib/tune'
import { shift } from './lib/fit'
import { ACCESS, ago, boot, desk, mod, reload, unavailable, useApp, type Access } from './lib/desk'

export type View =
  | { name: 'room'; id: string; focus?: string }
  | { name: 'new'; skill?: Skill; pack?: string; text?: string; send?: boolean }
  | { name: 'agents' } | { name: 'free' } | { name: 'settings'; edit?: string } | { name: 'pool' } | { name: 'savings' } | { name: 'library' } | { name: 'browser' } | { name: 'waiting' }
  | { name: 'flows'; edit?: string; template?: string }
export type Look = 'lunchbox' | 'neyra'
const VIEWS: View['name'][] = ['room', 'new', 'agents', 'free', 'settings', 'pool', 'savings', 'library', 'browser', 'waiting', 'flows']

const saved = <T,>(key: string, fallback: T): T => {
  try { const v = localStorage.getItem('lb.' + key); return v ? JSON.parse(v) : fallback } catch { return fallback }
}
const keep = (key: string, v: unknown) => { try { localStorage.setItem('lb.' + key, JSON.stringify(v)) } catch {} }
const steps = (n: number) => `${n} step${n === 1 ? '' : 's'}`
const calm = () => !document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches

// Native view transitions for every change a person makes. Elements that share a
// view-transition-name morph into each other; everything else crossfades.
export function flow(change: () => void, animate = true) {
  if (!animate || calm()) return change()
  document.startViewTransition(() => flushSync(change))
}

let revealing: ViewTransition | null = null

// The new theme grows out of the point that was clicked, as one circle over the old one.
function reveal(change: () => void, at?: { x: number; y: number }) {
  if (calm()) return change()
  const x = at?.x ?? innerWidth - 120
  const y = at?.y ?? innerHeight - 60
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
  const root = document.documentElement
  root.classList.add('revealing')
  const t = document.startViewTransition(() => flushSync(change))
  revealing = t
  // A transition that is skipped, by a second click or a hidden window, rejects ready.
  t.ready.then(() => root.animate(
    { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
    { duration: 620, easing: 'cubic-bezier(.65,0,.25,1)', pseudoElement: '::view-transition-new(root)' },
  ), () => {})
  // Only the newest reveal takes the class off, or a quick second switch would crossfade.
  t.finished.catch(() => {}).finally(() => { if (revealing === t) root.classList.remove('revealing') })
}

// A toast that reports a failure keeps its Report this button and stays a little longer.
const failure = (t: string) => /\b(fail(ed|s)?|error|could ?n[o']t|cannot|can't|not found|denied|refused|unable|timed out|crash)/i.test(t)

export function App() {
  // 'theme' has always held dark or light, so it stays the mode; the theme is saved beside it.
  const [mode, setModeState] = useState<Mode>(saved<string>('theme', 'dark') === 'light' ? 'light' : 'dark')
  // Themes a person made, and the one being made right now, shown on the app before it is saved.
  const [custom, setCustom] = useState<Theme[]>(loadCustom)
  const [theme, setThemeState] = useState<ThemeId>(() => themeOf(saved('palette', 'lunchbox'), custom).id)
  const [ascii, setAscii] = useState<AsciiId>(() => asciiOf(saved('ascii', 'theme')).id)
  const [preview, setPreview] = useState<Theme | null>(null)
  // Single colours changed on top of the theme, per mode, from Fine tune in Settings.
  const [tune, setTuneState] = useState<Tune>(loadTune)
  const setTune = (t: Tune) => { setTuneState(t); saveTune(t) }
  const [look, setLookState] = useState<Look>(() => ((new URLSearchParams(location.search).get('look') ?? saved('look', 'lunchbox')) === 'neyra' ? 'neyra' : 'lunchbox'))
  const [ready, setReady] = useState<boolean>(() => saved<unknown>('ready', false) === true)
  const [arriving, setArriving] = useState(false)
  // Every launch starts at home, except right after an update, which reopens the page it left.
  const [view, setView] = useState<View>(() => {
    // A window opened on a room starts in it.
    const room = new URLSearchParams(location.search).get('room')
    if (room) return { name: 'room', id: room }
    const back = saved<View | null>('resume', null)
    try { localStorage.removeItem('lb.resume') } catch {}
    return back && typeof back === 'object' && VIEWS.includes(back.name) && (back.name !== 'room' || typeof back.id === 'string') ? back : { name: 'new' }
  })
  const [palette, setPalette] = useState(false)
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null)
  const [report, setReport] = useState<ReportOpen | null>(null)
  const [importing, setImporting] = useState(false)
  useEffect(() => {
    const leaving = () => keep('resume', view)
    addEventListener('lb:restarting', leaving)
    return () => removeEventListener('lb:restarting', leaving)
  })
  // Deep links from inside components, such as See all agents in the crew menu.
  useEffect(() => {
    const to = (e: Event) => go((e as CustomEvent<View>).detail)
    addEventListener('lb:go', to)
    return () => removeEventListener('lb:go', to)
  })
  useEffect(() => {
    const open = (e: Event) => setReport((e as CustomEvent<ReportOpen>).detail ?? {})
    addEventListener('lb:report', open)
    return () => removeEventListener('lb:report', open)
  }, [])
  const [access, setAccessState] = useState<Access>(() => { const a = saved<Access>('access', 'workspace'); return ACCESS.some((x) => x.id === a) ? a : 'workspace' })
  const [workspace, setWorkspaceState] = useState<string>(() => { const w = saved<unknown>('workspace', ''); return typeof w === 'string' ? w : '' })
  const loaded = useApp((s) => s.loaded)
  const all = useApp((s) => s.rooms)
  // Pinned rooms lead the list; archived ones leave it and wait under their own heading.
  const rooms = [...all.filter((r) => r.pinned && !r.archived), ...all.filter((r) => !r.pinned && !r.archived)]
  const archived = all.filter((r) => r.archived)
  const [showArchived, setShowArchived] = useState(false)
  const [ctx, setCtx] = useState<{ room: RoomSummary; x: number; y: number; from: HTMLElement } | null>(null)
  const menuFor = (room: RoomSummary) => (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    // The menu key and Shift F10 fire this too, with no pointer to open at.
    const r = e.currentTarget.getBoundingClientRect()
    const atPointer = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
    setCtx({ room, x: atPointer ? e.clientX : r.left + 16, y: atPointer ? e.clientY : r.bottom, from: e.currentTarget })
  }
  const needs = all.filter((r) => r.waiting).length
  const agents = useApp((s) => s.agents)
  const skills = useApp((s) => s.skills)
  const flows = useApp((s) => s.flows)
  const running = useApp((s) => s.running)
  const web = useBrowser()
  const env = useApp((s) => s.env)

  useEffect(() => { boot() }, [])
  // An empty workspace means each room makes its own folder. Older installs saved the shared root
  // as their folder by default; that now means the same thing.
  useEffect(() => { if (workspace && workspace === env.cwd) setWorkspaceState('') }, [env.cwd, workspace])
  // The theme's colours go on the root as custom properties, and the ASCII colour after them, on
  // its own or following the theme. data-glyphs says a ramp is in use, so the bands, the field,
  // the strips and the dot fields colour themselves; without it they are ink.
  const painted = useRef<string[]>([])
  useLayoutEffect(() => {
    const root = document.documentElement
    const t = preview ?? themeOf(theme, custom)
    const a = asciiOf(ascii)
    const set: Record<string, string> = tokens(t, mode)
    const own = a.id === 'theme' || a.id === 'ink' ? null : a[mode]!
    own?.forEach((c, i) => { set[`--glyph-${i + 1}`] = c })
    // The tune goes last, so a colour picked by hand wins over the theme's.
    if (!preview) Object.assign(set, tuned(tune, mode))
    // Code is written in the colours that ended up on the root, so a tune or an ASCII colour of
    // its own carries into it.
    Object.assign(set, codeColours({ accent: set['--accent'], block: set['--block'], glyphs: [1, 2, 3, 4].map((i) => set[`--glyph-${i}`]), well: /^#/.test(set['--well'] ?? '') ? set['--well'] : wellOf(t, mode), mode }))
    for (const k of painted.current) if (!(k in set)) root.style.removeProperty(k)
    for (const [k, v] of Object.entries(set)) root.style.setProperty(k, v)
    painted.current = Object.keys(set)
    root.dataset.theme = mode
    // A selected colour tuned onto Lunchbox's own theme needs the rules that draw it.
    if (t.id === 'lunchbox' && !set['--block']) delete root.dataset.palette
    else root.dataset.palette = t.id
    if (own || (a.id === 'theme' && t.id !== 'lunchbox')) root.dataset.glyphs = ''
    else delete root.dataset.glyphs
    root.dataset.ascii = a.id
    keep('theme', mode)
    if (!preview) keep('palette', t.id)
    keep('ascii', a.id)
    desk.call('theme', mode === 'dark')
  }, [theme, mode, ascii, custom, preview, tune])
  useLayoutEffect(() => { document.documentElement.dataset.look = look; keep('look', look) }, [look])
  // Every window shares one saved appearance, so a change made in one is put on in the others.
  useEffect(() => {
    const sync = (e: StorageEvent) => {
      const key = e.key?.startsWith('lb.') ? e.key.slice(3) : ''
      if (key === 'theme') setModeState(saved<string>('theme', 'dark') === 'light' ? 'light' : 'dark')
      if (key === 'palette' || key === 'themes') {
        const list = loadCustom()
        setCustom(list)
        setThemeState(themeOf(saved('palette', 'lunchbox'), list).id)
      }
      if (key === 'ascii') setAscii(asciiOf(saved('ascii', 'theme')).id)
      if (key === 'tune') setTuneState(loadTune())
      if (key === 'look') setLookState(saved<string>('look', 'lunchbox') === 'neyra' ? 'neyra' : 'lunchbox')
      if (key === 'ready') setReady(saved<unknown>('ready', false) === true)
    }
    addEventListener('storage', sync)
    return () => removeEventListener('storage', sync)
  }, [])
  useLayoutEffect(() => { document.documentElement.dataset.platform = /^Win/.test(navigator.platform) ? 'win32' : /Mac/.test(navigator.platform) ? 'darwin' : 'linux' }, [])
  const searchButton = useRef<HTMLButtonElement>(null)
  const listed = useRef(new Set<string>())
  const first = useRef(true)
  // Archived rooms still exist, so archiving the open room leaves it open; only a deleted room sends you home.
  useEffect(() => {
    if (!loaded) return
    const ids = new Set(all.map((r) => r.id))
    const gone = view.name === 'room' && !ids.has(view.id) && (first.current || listed.current.has(view.id))
    listed.current = ids
    first.current = false
    if (gone) setView({ name: 'new' })
  }, [loaded, all, view])

  const setTheme = (t: ThemeId, e?: MouseEvent) => { if (t !== theme) reveal(() => setThemeState(t), e && { x: e.clientX, y: e.clientY }) }
  // A theme saved from the editor or from an agent's offer in a room replaces one with its id, or
  // joins the list, and is put on at once.
  const keepTheme = useCallback((t: Theme) => {
    setCustom((list) => { const next = [...list.filter((x) => x.id !== t.id), t]; saveCustom(next); return next })
    setPreview(null)
    setThemeState(t.id)
  }, [])
  const dropTheme = (id: string) => {
    const next = custom.filter((x) => x.id !== id)
    setCustom(next)
    saveCustom(next)
    if (theme === id) setTheme('lunchbox')
  }
  useEffect(() => {
    const offer = (e: Event) => keepTheme((e as CustomEvent<Theme>).detail)
    const show = (e: Event) => setPreview((e as CustomEvent<Theme | null>).detail)
    addEventListener('lb:theme', offer)
    addEventListener('lb:theme-preview', show)
    return () => { removeEventListener('lb:theme', offer); removeEventListener('lb:theme-preview', show) }
  }, [keepTheme])
  const themeWithAgent = () => go({ name: 'new', text: themeBrief(themeOf(theme, custom)), send: true })
  const setMode = (m: Mode, e?: MouseEvent) => { if (m !== mode) reveal(() => setModeState(m), e && { x: e.clientX, y: e.clientY }) }
  const setLook = (l: Look) => flow(() => setLookState(l))
  const setAccess = (a: Access) => { setAccessState(a); keep('access', a) }
  const setWorkspace = (w: string) => { setWorkspaceState(w); keep('workspace', w) }
  const say = useCallback((text: string) => setToast({ text, id: Date.now() }), [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast && failure(toast.text) ? 7000 : 2800)
    return () => clearTimeout(t)
  }, [toast])

  // Page changes are plain state changes: the new page rises in with CSS and the sidebar highlight
  // simply sits on the current item. A view transition here snapshotted the whole window and cost
  // a frame each time.
  const go = (v: View) => { setPalette(false); setView(v) }
  const openPalette = (open: boolean) => setPalette(open)
  useEffect(() => desk.on('open-room', (id: string) => go({ name: 'room', id })), [])
  // The main process is told which room this window is on, and the window is named after it, so
  // the Window menu and a notification can find it.
  const here = view.name === 'room' ? view.id : null
  const title = here ? all.find((r) => r.id === here)?.name : ''
  useEffect(() => { desk.call('window:view', here) }, [here])
  useEffect(() => { document.title = title || 'Lunchbox' }, [title])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!ready || !(e.metaKey || e.ctrlKey)) return
      const k = e.key.toLowerCase()
      if (k === 'k') { e.preventDefault(); if (!palette) openPalette(true) }
      if (k === 'n' && e.shiftKey) { e.preventDefault(); desk.call('window:new') }
      else if (k === 'n') { e.preventDefault(); go({ name: 'new' }) }
      if (k === ',') { e.preventDefault(); go({ name: 'settings' }) }
      if (e.shiftKey && k === 'f') { e.preventDefault(); go({ name: 'flows' }) }
      if (e.shiftKey && k === 'p') { e.preventDefault(); go({ name: 'pool' }) }
      if (e.shiftKey && k === 's') { e.preventDefault(); go({ name: 'savings' }) }
      if (e.shiftKey && k === 'a') { e.preventDefault(); go({ name: 'agents' }) }
      if (e.shiftKey && k === 'l') { e.preventDefault(); go({ name: 'library' }) }
      if (e.shiftKey && k === 'b') { e.preventDefault(); go({ name: 'browser' }) }
      if (/^[1-9]$/.test(k) && rooms[Number(k) - 1]) { e.preventDefault(); go({ name: 'room', id: rooms[Number(k) - 1].id }) }
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  })

  const finish = (folder: string | null) => {
    if (folder) setWorkspace(folder)
    keep('ready', true)
    setReady(true)
    setArriving(true)
    setTimeout(() => setArriving(false), 1100)
  }

  if (!loaded) return <div className="booting"><Loader size={14} /></div>
  if (!ready) return <Onboarding onDone={finish} workspace={workspace} theme={theme} setTheme={setTheme} mode={mode} setMode={setMode} />

  const commands: Command[] = [
    { group: 'Actions', label: 'New room', hint: `${mod}N`, run: () => go({ name: 'new' }) },
    { group: 'Actions', label: 'New window', hint: `${mod}⇧N`, run: () => { desk.call('window:new') } },
    ...rooms.map((r) => ({ group: 'Rooms' as const, label: r.name, hint: r.waiting ? 'needs you' : r.busy ? 'working' : ago(r.updated), run: () => go({ name: 'room', id: r.id }) })),
    ...skills.map((s) => ({ group: 'Skills' as const, label: s.name, hint: steps(s.steps.length), run: () => go({ name: 'new', skill: s }) })),
    ...flows.map((f) => ({ group: 'Flows' as const, label: `Run ${f.name}`, hint: steps(f.steps.length), run: async () => { const room = await desk.call('flows:run', f.id); if (room) go({ name: 'room', id: room }) } })),
    { group: 'Go to', label: 'Flows', hint: `${mod}⇧F`, run: () => go({ name: 'flows' }) },
    { group: 'Go to', label: 'Pool', hint: `${mod}⇧P`, run: () => go({ name: 'pool' }) },
    { group: 'Go to', label: 'Savings', hint: `${mod}⇧S`, run: () => go({ name: 'savings' }) },
    { group: 'Go to', label: 'Library', hint: `${mod}⇧L`, run: () => go({ name: 'library' }) },
    { group: 'Go to', label: 'Browser', hint: `${mod}⇧B`, run: () => go({ name: 'browser' }) },
    { group: 'Actions', label: 'New flow', hint: 'Flows', run: () => go({ name: 'flows', edit: 'new' }) },
    { group: 'Actions', label: 'Import a chat', hint: 'From Claude Code, Codex, Gemini CLI or Grok', run: () => setImporting(true) },
    { group: 'Go to', label: 'Agents', hint: `${mod}⇧A`, run: () => go({ name: 'agents' }) },
    { group: 'Go to', label: 'Settings', hint: `${mod},`, run: () => go({ name: 'settings' }) },
    { group: 'Actions', label: mode === 'dark' ? 'Switch to day' : 'Switch to night', hint: 'Appearance', run: () => setMode(mode === 'dark' ? 'light' : 'dark') },
    ...[...THEMES, ...custom].filter((t) => t.id !== theme).map((t) => ({ group: 'Actions' as const, label: `Theme: ${t.name}`, hint: t.note, run: () => setTheme(t.id) })),
    { group: 'Actions', label: 'Make a theme with an agent', hint: 'Appearance', run: themeWithAgent },
    { group: 'Actions', label: look === 'neyra' ? 'Look: Lunchbox' : 'Look: Square', hint: 'Appearance', run: () => setLook(look === 'neyra' ? 'lunchbox' : 'neyra') },
    { group: 'Actions', label: 'Check for agents again', hint: 'Agents', run: async () => { await reload.agents(); say('Checked again') } },
    { group: 'Actions', label: 'Mode: Plan', hint: 'Read and plan only', run: () => setAccess('plan') },
    { group: 'Actions', label: 'Mode: Ask', hint: 'Changes wait for your OK', run: () => setAccess('ask') },
    { group: 'Actions', label: 'Mode: Auto', hint: 'Free inside the folder', run: () => setAccess('workspace') },
    { group: 'Actions', label: 'Mode: Full access', hint: 'Anything on this computer', run: () => setAccess('full') },
  ]
  const openHit = (h: Hit) => go({ name: 'room', id: h.room, focus: h.event })

  const on = (name: View['name'], id?: string) => view.name === name && (!id || (view.name === 'room' && view.id === id))
  const ready_ = agents.filter((a) => !unavailable(a)).length
  const sel = <i className="sbsel" />

  return (
    <div className={`app${arriving ? ' arriving' : ''}`}>
      <aside className="sidebar">
        <div className="sbtop" />
        <div className="sbbrand">
          <button className="sbhome" onClick={() => go({ name: 'new' })} title="Home"><Logo size={16} /><b>Lunchbox</b></button>
          <button className="sbbeta" onClick={() => openReport()} title="Lunchbox is in beta. Tell us what breaks and what you want.">Beta</button>
        </div>
        <button className={`sbitem${on('new') ? ' on' : ''}`} onClick={() => go({ name: 'new' })}>{on('new') && sel}<IconPlus />New room<kbd>{mod}N</kbd></button>
        <button ref={searchButton} className={`sbitem${palette ? ' on' : ''}`} onClick={() => openPalette(true)}><IconSearch />Search<kbd>{mod}K</kbd></button>
        <div className="sbgap" />
        <button className={`sbitem${on('flows') ? ' on' : ''}`} onClick={() => go({ name: 'flows' })}>{on('flows') && sel}<IconFlows />Flows{running.length ? <Loader size={10} /> : flows.length ? <small>{flows.filter((f) => f.on && f.every).length || ''}</small> : null}</button>
        <button className={`sbitem${on('pool') ? ' on' : ''}`} onClick={() => go({ name: 'pool' })}>{on('pool') && sel}<IconPool />Pool</button>
        <button className={`sbitem${on('savings') ? ' on' : ''}`} onClick={() => go({ name: 'savings' })}>{on('savings') && sel}<IconSave />Savings</button>
        <button className={`sbitem${on('library') ? ' on' : ''}`} onClick={() => go({ name: 'library' })}>{on('library') && sel}<IconLibrary />Library</button>
        <button className={`sbitem${on('browser') ? ' on' : ''}`} onClick={() => go({ name: 'browser' })}>{on('browser') && sel}<IconBrowser />Browser{web.tabs.some((t) => t.busy) && <i className="livedot" title="An agent is using the browser" />}</button>
        {needs > 0 && <button className={`sbitem needsyou${on('waiting') ? ' on' : ''}`} onClick={() => go({ name: 'waiting' })}>{on('waiting') && sel}<IconInbox />Needs you<small>{needs}</small></button>}
        <div className="sblabel">Rooms<button className="sbimport" onClick={() => setImporting(true)} title="Import a chat from Claude Code, Codex, Gemini CLI or Grok" aria-label="Import a chat"><IconImport /></button></div>
        <div className="sbrooms">
          {rooms.map((r) => (
            <button key={r.id} className={`sbroom${on('room', r.id) ? ' on' : ''}`} onClick={() => go({ name: 'room', id: r.id })} onContextMenu={menuFor(r)} title={r.name}>
              {on('room', r.id) && sel}
              {r.flow && <span className="sbflow" title="Started by a flow"><IconClock /></span>}
              {r.pinned && <span className="sbpin" title="Pinned"><IconPin /></span>}
              <span className="grow">{r.name}</span>
              {r.waiting ? <i className="waitdot" title="Needs you" /> : r.busy ? <Loader size={10} /> : <small>{ago(r.updated)}</small>}
            </button>
          ))}
          {!rooms.length && <div className="sbempty">Rooms you start show up here.</div>}
          {archived.length > 0 && <button className="sbarchived" onClick={() => setShowArchived(!showArchived)} aria-expanded={showArchived}>{showArchived ? 'Hide archived' : `Archived, ${archived.length}`}</button>}
          {showArchived && archived.map((r) => (
            <button key={r.id} className={`sbroom archived${on('room', r.id) ? ' on' : ''}`} onClick={() => go({ name: 'room', id: r.id })} onContextMenu={menuFor(r)} title={r.name}>
              {on('room', r.id) && sel}
              <span className="grow">{r.name}</span><small>{ago(r.updated)}</small>
            </button>
          ))}
        </div>
        <div className="sbfoot">
          <button className={`sbitem${on('agents') ? ' on' : ''}`} onClick={() => go({ name: 'agents' })}>{on('agents') && sel}<IconAgents />Agents<small>{ready_}</small></button>
          <button className={`sbitem${on('settings') ? ' on' : ''}`} onClick={() => go({ name: 'settings' })}>{on('settings') && sel}<IconSettings />Settings</button>
          {look === 'neyra' && <div className="sbversion">lunchbox {env.version}</div>}
        </div>
      </aside>

      <main className="sheet">
        <Guard key={view.name === 'room' ? `room:${view.id}` : view.name}>
        {/* Pages scroll, so only a strip along the top moves the window. A scroll area that is
            also a drag region swallows the wheel on macOS. */}
        {!['room', 'browser', 'new'].includes(view.name) && <div className="sheetdrag" aria-hidden="true" />}
        {view.name === 'room' && <RoomView key={view.id} id={view.id} focus={view.focus} access={access} setAccess={setAccess} open={(id) => go({ name: 'room', id })} say={say} />}
        {view.name === 'new' && <NewRoom key={view.skill?.id ?? view.pack ?? (view.send ? 'send' : 'new')} skill={view.skill} pack={view.pack} text={view.text} send={view.send} onCreated={(id) => go({ name: 'room', id })} go={go} say={say} access={access} setAccess={setAccess} workspace={workspace} setWorkspace={setWorkspace} />}
        {view.name === 'agents' && <Agents say={say} />}
        {view.name === 'free' && <FreeModels go={go} say={say} />}
        {view.name === 'flows' && <Flows key={view.edit ?? view.template ?? 'list'} edit={view.edit} template={view.template} go={go} say={say} workspace={workspace || env.cwd} />}
        {view.name === 'pool' && <Pool go={go} say={say} />}
        {view.name === 'waiting' && <WaitingPage go={go} access={access} />}
        {view.name === 'savings' && <Savings go={go} />}
        {view.name === 'library' && <Library go={go} say={say} />}
        {view.name === 'browser' && <Browser say={say} covered={palette} />}
        {view.name === 'settings' && <Settings edit={view.edit} theme={theme} setTheme={setTheme} mode={mode} setMode={setMode} custom={custom} tune={tune} setTune={setTune} keepTheme={keepTheme} dropTheme={dropTheme} themeWithAgent={themeWithAgent} ascii={ascii} setAscii={setAscii} look={look} setLook={setLook} say={say} restart={() => flow(() => { keep('ready', false); setReady(false) })} />}
        </Guard>
      </main>

      <Notices />
      {ctx && <RoomContext key={ctx.room.id + ctx.x + ctx.y} {...ctx} close={() => setCtx(null)} say={say} />}
      {importing && <ImportSheet close={() => setImporting(false)} open={(id) => go({ name: 'room', id })} say={say} />}
      {report && <ReportSheet open={report} close={() => setReport(null)} say={say} />}
      {palette && <Palette commands={commands} close={() => openPalette(false)} openHit={openHit} anchor={searchButton} />}
      {toast && (
        <div key={toast.id} className={`toast${failure(toast.text) ? ' long' : ''}`}>
          {toast.text}
          {failure(toast.text) && <button className="reportbtn" onClick={() => openReport({ context: toast.text })}>Report this</button>}
        </div>
      )}
    </div>
  )
}

// Right click on a room in the sidebar, for the few things people look for there. Delete asks twice,
// the same way the room's own menu does.
function RoomContext({ room, x, y, from, close, say }: { room: RoomSummary; x: number; y: number; from: HTMLElement; close: () => void; say: (t: string) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const done = (refocus: boolean) => { if (refocus) from.focus(); close() }
  useLayoutEffect(() => {
    const el = box.current!
    const r = el.getBoundingClientRect()
    el.style.left = `${x + shift(x, r.width, 8, innerWidth - 8)}px`
    el.style.top = `${y + shift(y, r.height, 8, innerHeight - 8)}px`
    el.querySelector('button')?.focus()
  }, [])
  useEffect(() => {
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) done(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(true) } }
    const leave = () => done(false)
    addEventListener('pointerdown', away)
    addEventListener('keydown', esc, true)
    addEventListener('blur', leave)
    return () => { removeEventListener('pointerdown', away); removeEventListener('keydown', esc, true); removeEventListener('blur', leave) }
  }, [])
  const archive = () => {
    desk.call('room:mark', room.id, { archived: !room.archived })
    say(room.archived ? 'Back in your rooms' : 'Archived. Find it under Archived in the sidebar.')
    done(true)
  }
  return (
    <div ref={box} className="menu ctx" role="menu" aria-label={room.name} style={{ left: x, top: y }}
      onKeyDown={(e) => rove(e, box.current)}
      onBlur={(e) => { if (e.relatedTarget && !box.current?.contains(e.relatedTarget as Node)) done(false) }}>
      <button className="item" onClick={() => { desk.call('window:new', room.id); done(false) }}>
        <span className="grow"><b>Open in new window</b><span>Beside this one, and the two stay in step</span></span>
      </button>
      <div className="sep" />
      <button className="item" onClick={archive}>
        <span className="grow"><b>{room.archived ? 'Unarchive' : 'Archive'}</b><span>{room.archived ? 'Bring it back to your rooms' : 'Out of the list, nothing deleted'}</span></span>
      </button>
      <div className="sep" />
      <Sure className="item danger" act={() => { desk.call('room:remove', room.id); done(false) }}>
        {(sure) => <span className="grow"><b>{sure ? 'Click again to delete' : 'Delete room'}</b><span>The folder and its files stay where they are</span></span>}
      </Sure>
    </div>
  )
}
