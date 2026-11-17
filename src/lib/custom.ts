import type { Mode, Theme } from './themes'

// Themes a person makes, by hand or with an agent. A custom theme has the same shape as the ones
// Lunchbox ships, so it gets the same system: neutrals from one hue at the fixed OKLCH steps, and
// a few colours with one job each. What a person or an agent picks is checked before it is used:
// text on blocks and buttons is worked out here, an accent too faint on the sheet is moved in
// lightness until it reads, a selected row is kept visible, and the ASCII ramp runs quiet to loud.

export type Draft = {
  name: string
  note: string
  base: string
  tint: number
  dark: Colours
  light: Colours
}
// The colours of one mode. The last six are optional: left out, the base and tint decide them.
type Colours = { block: string; accent: string; ascii: string[]; text?: string; sheet?: string; frame?: string; box?: string; warn?: string; bad?: string }

// Colour in OKLab and OKLCH (Björn Ottosson's matrices), enough to reason about lightness and
// contrast without leaving the hue a person chose.
type RGB = [number, number, number]
const HEX = /^#[0-9a-f]{6}$/i
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
const rgbOf = (hex: string): RGB => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => toLinear(v / 255)) as RGB }

export function oklch(hex: string) {
  const [r, g, b] = rgbOf(hex)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 }
}

function linearOf(l: number, c: number, h: number): RGB {
  const a = c * Math.cos((h * Math.PI) / 180), b = c * Math.sin((h * Math.PI) / 180)
  const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S, -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S, -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S]
}

// The nearest colour the screen can show: chroma comes down until it fits, the hue never moves.
export function hexOf(l: number, c: number, h: number) {
  let rgb = linearOf(l, c, h)
  for (let k = c; k > 0.0005 && rgb.some((v) => v < -0.0005 || v > 1.0005); k *= 0.9) rgb = linearOf(l, k, h)
  return '#' + rgb.map((v) => Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, v))))) * 255).toString(16).padStart(2, '0')).join('')
}

const luminance = (hex: string) => { const [r, g, b] = rgbOf(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
export const contrast = (a: string, b: string) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }

// The sheet and frame of a theme as hex, at the same steps as surfaces() in themes.ts.
export function grounds(hue: number, tint: number, mode: Mode) {
  return mode === 'dark'
    ? { sheet: hexOf(0.18, tint, hue), ground: hexOf(0.145, tint, hue) }
    : { sheet: hexOf(0.986, tint * 0.35, hue), ground: hexOf(0.93, tint * 1.3, hue) }
}

// Text that sits on a colour: a deep or a pale shade of the colour's own hue, whichever reads better.
export function on(bg: string) {
  const { c, h } = oklch(bg)
  const deep = hexOf(0.22, Math.min(c, 0.06), h), pale = hexOf(0.985, Math.min(c, 0.02), h)
  return contrast(deep, bg) >= contrast(pale, bg) ? deep : pale
}

// Moves a colour in lightness, away from the background, until it reaches the contrast it needs.
function lift(color: string, bg: string, min: number, mode: Mode) {
  let { l } = oklch(color)
  const { c, h } = oklch(color)
  let out = color
  for (let i = 0; i < 30 && contrast(out, bg) < min; i++) {
    l = mode === 'dark' ? Math.min(0.98, l + 0.025) : Math.max(0.12, l - 0.025)
    out = hexOf(l, c, h)
  }
  return out
}

const hex = (v: unknown, fallback: string) => (typeof v === 'string' && HEX.test(v.trim()) ? v.trim().toLowerCase() : fallback)
const text = (v: unknown, fallback: string, max: number) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : fallback)

// A draft as a person or an agent wrote it, made safe to use, with a note of everything changed.
export function build(raw: unknown, id?: string): { theme: Theme; fixed: string[] } | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, any>
  const base = hex(r.base, '')
  if (!base) return null
  const { h } = oklch(base)
  const tint = Math.min(0.045, Math.max(0, typeof r.tint === 'number' && isFinite(r.tint) ? r.tint : 0.02))
  const fixed: string[] = []
  const tone = (mode: Mode) => {
    const src = (mode === 'dark' ? r.night ?? r.dark : r.day ?? r.light) ?? {}
    const g = grounds(h, tint, mode)
    const fallback = (l: number, c: number) => hexOf(l, c, h)
    const word = mode === 'dark' ? 'night' : 'day'
    // Surfaces a theme sets itself replace the neutrals, and the text is held to what reads on them.
    const own = { sheet: hex(src.sheet, ''), frame: hex(src.frame ?? src.ground, ''), box: hex(src.box ?? src.well, ''), text: hex(src.text ?? src.ink, '') }
    if (own.sheet) g.sheet = own.sheet
    if (own.frame) g.ground = own.frame
    let ink = own.text || (own.sheet || own.box ? (mode === 'dark' ? fallback(0.96, tint * 0.6) : fallback(0.25, tint * 2.4)) : '')
    if (ink) {
      for (const bg of [g.sheet, own.box].filter(Boolean)) ink = lift(ink, bg, 4.5, mode)
      if (contrast(ink, g.sheet) < 4.5) ink = on(g.sheet)
      if (own.text && ink !== own.text) fixed.push(`The ${word} text was hard to read, so it is a shade ${mode === 'dark' ? 'lighter' : 'darker'}.`)
    }
    let block = hex(src.block, mode === 'dark' ? fallback(0.88, 0.07) : fallback(0.3, 0.08))
    let accent = hex(src.accent, mode === 'dark' ? fallback(0.75, 0.13) : fallback(0.55, 0.15))
    const block2 = lift(block, g.ground, 1.6, mode)
    if (block2 !== block) { fixed.push(`The ${word} block was too close to the frame, so it is a shade further from it.`); block = block2 }
    const accent2 = lift(accent, g.sheet, 2.6, mode)
    if (accent2 !== accent) { fixed.push(`The ${word} accent was faint on the sheet, so it is a shade ${mode === 'dark' ? 'lighter' : 'darker'}.`); accent = accent2 }
    const given = Array.isArray(src.ascii) ? src.ascii.map((c: unknown) => hex(c, '')).filter(Boolean) : []
    const ramp = given.length >= 2 ? given : [fallback(mode === 'dark' ? 0.4 : 0.85, 0.05), fallback(0.62, 0.1), accent, mode === 'dark' ? fallback(0.95, 0.04) : fallback(0.25, 0.08)]
    while (ramp.length < 4) ramp.splice(ramp.length - 1, 0, ramp[ramp.length - 1])
    const sorted = ramp.slice(0, 4).sort((a: string, b: string) => contrast(a, g.sheet) - contrast(b, g.sheet))
    if (sorted.join() !== ramp.slice(0, 4).join()) fixed.push(`The ${word} ASCII colours are put in order, quiet to loud.`)
    sorted[3] = lift(sorted[3], g.sheet, 4.5, mode)
    const extra = { warn: hex(src.warn ?? src.waiting, ''), bad: hex(src.bad ?? src.failure, ''), text: ink, sheet: own.sheet, frame: own.frame, box: own.box }
    return { block, onBlock: on(block), accent, onAccent: on(accent), glyphs: sorted as [string, string, string, string], ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v)) }
  }
  const name = text(r.name, 'My theme', 28)
  const theme: Theme = {
    id: id ?? `custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'theme'}-${Math.random().toString(36).slice(2, 6)}`,
    name, note: text(r.note, 'Made by you', 32), hue: Math.round(h), chroma: Number(tint.toFixed(3)),
    dark: tone('dark'), light: tone('light'), custom: true,
  }
  return { theme, fixed }
}

// The other way: any theme as a draft to edit, or to start a new one from under a new name. Its
// base is its hue at a middle lightness.
export function draftOf(t: Theme, name?: string): Draft {
  return {
    name: name ?? t.name, note: name ? 'Made by you' : t.note, base: hexOf(0.62, 0.12, t.hue), tint: t.chroma,
    dark: colours(t.dark),
    light: colours(t.light),
  }
}

function colours(tone: Theme['dark']): Colours {
  const { block, accent, glyphs, text, sheet, frame, box, warn, bad } = tone
  return { block, accent, ascii: [...glyphs], ...Object.fromEntries(Object.entries({ text, sheet, frame, box, warn, bad }).filter(([, v]) => v)) }
}

// A draft in the format a person or an agent writes, with the names the brief uses.
const named = ({ warn, bad, ...rest }: Colours) => ({ ...rest, ...(warn ? { waiting: warn } : {}), ...(bad ? { failure: bad } : {}) })
export const asRaw = (d: Draft) => ({ name: d.name, note: d.note, base: d.base, tint: d.tint, night: named(d.dark), day: named(d.light) })

// Saved custom themes, checked again on the way in so an old or edited entry can never break the app.
export function loadCustom(): Theme[] {
  try {
    const list = JSON.parse(localStorage.getItem('lb.themes') ?? '[]')
    if (!Array.isArray(list)) return []
    return list.map((t) => (t?.id && t?.dark && t?.light ? build({ name: t.name, note: t.note, base: hexOf(0.62, 0.12, t.hue), tint: t.chroma, night: { ...t.dark, ascii: t.dark.glyphs }, day: { ...t.light, ascii: t.light.glyphs } }, t.id)?.theme : null)).filter((t): t is Theme => !!t)
  } catch { return [] }
}
export function saveCustom(list: Theme[]) {
  try { localStorage.setItem('lb.themes', JSON.stringify(list)) } catch {}
}

// The message that starts a room for designing a theme with an agent: what to ask, how to use
// references, the format with every part it may set, the design rules, and the theme in use now.
export function themeBrief(current: Theme) {
  const now = JSON.stringify(asRaw(draftOf(current)), null, 2).replace(/\[\s+([^\]]*?)\s+\]/g, (_, list: string) => `[${list.split(/,\s+/).join(', ')}]`)
  return `Make a Lunchbox theme with me.

Start by asking me two or three short questions: the mood I am after, what the theme should come from, and whether I mostly work at night or by day. References help most. I can send screenshots, photos, a website, a brand, a painting or a place, and you take the palette from them; if you can open images or search the web, look at what I name rather than guessing. Then design the theme and send it as one code block marked lunchbox-theme. Lunchbox shows that block as a preview with buttons to use it at once or to open it in the theme editor. When I ask for changes, send the whole block again.

The format, with every part you may set:
\`\`\`
{
  "name": "Two words at most",
  "note": "Four or five words",
  "base": "#hex",
  "tint": 0.02,
  "night": {
    "block": "#hex", "accent": "#hex", "ascii": ["#hex", "#hex", "#hex", "#hex"],
    "text": "#hex", "sheet": "#hex", "frame": "#hex", "box": "#hex", "waiting": "#hex", "failure": "#hex"
  },
  "day": { the same parts as night }
}
\`\`\`

What each part does. base is the hue every surface is tinted with: the frame, the sheet, the message box, the text and the lines. tint is how strongly, from 0 (neutral grey) to 0.04 (clearly coloured); most good themes sit between 0.012 and 0.03. block is the colour a selected row or chip is tinted with. accent is the colour of what acts: the send button, ticks and progress. ascii is the four colours of the ASCII art in the app, from quiet to loud. text, sheet (where the work sits), frame (behind the sidebar) and box (the message box and cards) are optional: leave them out and Lunchbox makes them from base and tint, which keeps every surface in one family; set them only when the idea needs it, a warm paper sheet for example. waiting (amber by default, a room needs me) and failure (vermilion by default, errors) are optional too; change them only if the accent would clash with them. Night sits on a sheet close to black and day on one close to white unless you set the sheet. Lunchbox picks the text on blocks and buttons itself, and moves any colour that would be hard to read, then tells me what it moved.

Design it the way a senior designer at a good studio would. Start from one idea (a place, a material, a period, a printed object, or my references) and take a palette of three to five colours from it that clearly belong together, with at most one loud colour. The block and the accent have different jobs, so make them different colours, not two shades of one. Tune night and day separately rather than inverting one into the other. Stay away from defaults: no purple and blue, no neon on black, nothing that would suit any app. Before the block, say in one line what idea the theme comes from.

The theme I use now is ${current.name}, in the same format, for when I want to start from it or change it:
\`\`\`
${now}
\`\`\``
}
