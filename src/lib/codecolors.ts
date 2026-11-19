import { contrast, hexOf, lift, oklch } from './custom'
import { surfaces, type Mode, type Theme } from './themes'

// The colours code is written in, taken from the theme that is on: keywords from what acts
// (the accent, or the selected block where the accent is too pale for the ground), strings and
// numbers from the ASCII ramp. Each is drawn a little towards grey so a block of code stays as
// calm as the text around it, and moved in lightness until it reads on the code block.
const HEX = /^#[0-9a-f]{6}$/i
const TEXT = 4.5

const hexFrom = (css: string) => {
  const m = css.match(/^oklch\(([\d.]+)% ([\d.e-]+) ([\d.]+)\)$/)
  return m ? hexOf(Number(m[1]) / 100, Number(m[2]), Number(m[3])) : css
}

// The code block's ground for a theme and mode, as a colour the contrast can be worked out from.
export function wellOf(t: Theme, mode: Mode) {
  if (t.id === 'lunchbox') return mode === 'dark' ? '#161614' : '#f3f2ee'
  return t[mode].box ?? hexFrom(surfaces(t, mode).well)
}

const far = (a: string, b: string) => {
  const x = oklch(a), y = oklch(b)
  const turn = Math.abs(x.h - y.h)
  // A theme in one hue tells its roles apart by lightness. Two greys are the same colour whatever
  // their hue says.
  if (Math.abs(x.l - y.l) > 0.13) return true
  return x.c > 0.035 && y.c > 0.035 ? Math.min(turn, 360 - turn) > 28 : Math.abs(x.c - y.c) > 0.05
}

const calm = (color: string, well: string, mode: Mode) => {
  const { l, c, h } = oklch(color)
  return lift(hexOf(l, Math.min(c * 0.86, 0.15), h), well, TEXT, mode)
}

// accent, block and glyphs are whatever is on the root right now, a tune and a separate ASCII
// colour included. Nothing to take a colour from leaves the role to the stylesheet, which is ink.
export function codeColours(o: { accent?: string; block?: string; glyphs?: string[]; well: string; mode: Mode }): Record<string, string> {
  const out: Record<string, string> = {}
  const ok = (c?: string): c is string => !!c && HEX.test(c)
  // A colour that would have to change beyond recognition to be read is not the theme's any more.
  const fits = (c: string) => contrast(c, o.well) >= 2 && oklch(c).c > 0.035
  // Roles are compared as they will be drawn, since reaching the contrast can bring two together.
  const taken: string[] = []
  const pick = (name: string, from: (string | undefined)[], good: (c: string) => boolean) => {
    const c = from.filter(ok).filter(good).map((c) => calm(c, o.well, o.mode)).find((c) => taken.every((t) => far(c, t)))
    if (c) { out[name] = c; taken.push(c) }
  }
  const ramp = o.glyphs ?? []
  pick('--code-key', [o.accent, o.block], fits)
  pick('--code-str', [ramp[2], ramp[1], ramp[3]], fits)
  pick('--code-num', [ramp[3], ramp[2], ramp[1]], (c) => contrast(c, o.well) >= 2)
  return out
}
