import { asciiOf, type AsciiId } from './themes'
import { cleanTune, type Tune } from './tune'

// What a person changed on top of a theme: its ASCII colour and single colours. Each theme keeps
// its own, so picking a theme shows it as designed, with only what was changed while it was on.
export type Tweak = { ascii?: AsciiId; tune?: Tune }
export type Tweaks = Record<string, Tweak>
type Store = Pick<Storage, 'getItem' | 'setItem'>

const read = (store: Store, key: string) => { try { return JSON.parse(store.getItem(key) ?? 'null') } catch { return null } }
const tuneCount = (t?: Tune) => (t ? Object.keys(t.dark).length + Object.keys(t.light).length : 0)

function clean(raw: unknown): Tweak {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: Tweak = {}
  const ascii = typeof r.ascii === 'string' ? asciiOf(r.ascii).id : 'theme'
  if (ascii !== 'theme') out.ascii = ascii
  const tune = cleanTune(r.tune)
  if (tuneCount(tune)) out.tune = tune
  return out
}

// Before tweaks were kept per theme there was one ASCII colour and one tune for everything. The
// first load hands those to the theme that is on, so nobody loses what they set.
export function loadTweaks(store: Store = localStorage): Tweaks {
  const saved = read(store, 'lb.tweaks')
  if (saved && typeof saved === 'object') {
    return Object.fromEntries(Object.entries(saved).map(([id, t]) => [id, clean(t)] as const).filter(([, t]) => Object.keys(t).length))
  }
  const old = clean({ ascii: read(store, 'lb.ascii'), tune: read(store, 'lb.tune') })
  const theme = read(store, 'lb.palette')
  const tweaks: Tweaks = Object.keys(old).length ? { [typeof theme === 'string' && theme ? theme : 'lunchbox']: old } : {}
  saveTweaks(tweaks, store)
  return tweaks
}

export function saveTweaks(t: Tweaks, store: Store = localStorage) {
  try { store.setItem('lb.tweaks', JSON.stringify(t)) } catch {}
}

// One theme's tweak replaced; a tweak with nothing left in it is dropped.
export function withTweak(all: Tweaks, theme: string, change: Tweak): Tweaks {
  const next = clean({ ...all[theme], ...change })
  const rest = Object.fromEntries(Object.entries(all).filter(([id]) => id !== theme))
  return Object.keys(next).length ? { ...rest, [theme]: next } : rest
}
