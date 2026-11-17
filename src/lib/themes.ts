// Themes and their two modes. Lunchbox is the app as it began, ink on black or paper, drawn by
// styles.css alone. Every other theme is built the same way, so they belong together:
// - the neutrals (frame, sheet, composer, ink and every line) are one hue at low strength, set in
//   OKLCH at the same lightness steps in every theme, so contrast and rhythm never change;
// - a few colours from the theme's own palette each do one job: the block a selected row sits in,
//   the accent of everything that acts (send, ticks, progress, selection), and the ASCII ramp;
// - day and night are tuned separately, not inverted: a colour that is a soft block at night is
//   often the deep one by day.

export type ThemeId = 'lunchbox' | 'lagoon' | 'cobalt' | 'meadow' | 'dusk' | 'glacier' | 'koi'
export type Mode = 'dark' | 'light'
type Ramp = [string, string, string, string]
type Tone = { block: string; onBlock: string; accent: string; onAccent: string; glyphs: Ramp; warn?: string; bad?: string }
export type Theme = { id: ThemeId; name: string; note: string; hue: number; chroma: number; dark: Tone; light: Tone }

export const THEMES: Theme[] = [
  { id: 'lunchbox', name: 'Lunchbox', note: 'Ink on black or paper', hue: 90, chroma: 0.004,
    dark: { block: '#1c1c1a', onBlock: '#f2f0ea', accent: '#f2f0ea', onAccent: '#080807', glyphs: ['#3a3936', '#77756f', '#b9b6ae', '#f2f0ea'] },
    light: { block: '#e4e3de', onBlock: '#0e0e0d', accent: '#0e0e0d', onAccent: '#fbfaf7', glyphs: ['#cfcdc6', '#9b9890', '#55534e', '#0e0e0d'] } },
  // After AgentIndex: petrol, teal, sea green, mint and a pale lime that labels things.
  { id: 'lagoon', name: 'Lagoon', note: 'Petrol, teal, pale lime', hue: 205, chroma: 0.024,
    dark: { block: '#dff3b8', onBlock: '#0b2228', accent: '#2bbfcc', onAccent: '#03191d', glyphs: ['#1d5664', '#13a6b6', '#65d3b0', '#e6f8b8'] },
    light: { block: '#0f3a44', onBlock: '#e6f8c8', accent: '#0e8c9c', onAccent: '#ffffff', glyphs: ['#9fd3c6', '#3fb3a2', '#13849a', '#0f3a44'] } },
  // After Infinite Ascent: cobalt on navy, sky and ice, and one yellow that acts. Waiting is orange.
  { id: 'cobalt', name: 'Cobalt', note: 'Cobalt, ice, one yellow', hue: 264, chroma: 0.034,
    dark: { block: '#2b5cf2', onBlock: '#ffffff', accent: '#ffd84a', onAccent: '#0a1f6b', glyphs: ['#2a4fb8', '#2f7bf0', '#74ccf8', '#e3f2fc'], warn: '#ff9f43', bad: '#ff7a6b' },
    light: { block: '#0b45d6', onBlock: '#ffffff', accent: '#ffcf2e', onAccent: '#0a1f6b', glyphs: ['#a9cdf0', '#5cb2ec', '#1c74d5', '#0b2a86'], warn: '#c26a00', bad: '#d1342a' } },
  // After Zeroflow: mint and sage, blush, butter and moss.
  { id: 'meadow', name: 'Meadow', note: 'Mint, blush and butter', hue: 152, chroma: 0.02,
    dark: { block: '#f6e3a6', onBlock: '#2b3424', accent: '#f4a29a', onAccent: '#3b1712', glyphs: ['#4b6a55', '#93b09d', '#e9a596', '#fbe9bc'] },
    light: { block: '#fbe3a0', onBlock: '#2c3527', accent: '#ec8f86', onAccent: '#3b1712', glyphs: ['#c7d9cc', '#93b09d', '#d98b7e', '#3f4634'] } },
  // Lagoon's warm opposite: aubergine and lilac, rose, coral and peach.
  { id: 'dusk', name: 'Dusk', note: 'Aubergine, coral, peach', hue: 330, chroma: 0.03,
    dark: { block: '#ffc2a6', onBlock: '#2a0c1f', accent: '#ff7262', onAccent: '#2a0805', glyphs: ['#4a2a72', '#b4507a', '#ff8a65', '#ffd9bd'], bad: '#ff4f6a' },
    light: { block: '#4a1a4f', onBlock: '#ffd9c4', accent: '#ea5a49', onAccent: '#ffffff', glyphs: ['#e3b8cf', '#c86a8e', '#e0714c', '#4a1a4f'], bad: '#b8122e' } },
  // Cobalt's cold sibling, with no yellow: ice, sky and navy.
  { id: 'glacier', name: 'Glacier', note: 'Ice, sky and navy', hue: 232, chroma: 0.026,
    dark: { block: '#cfe6fb', onBlock: '#0b2a5a', accent: '#5cc0f4', onAccent: '#04203a', glyphs: ['#24507e', '#3f9ae0', '#9fd6f7', '#f2fbff'] },
    light: { block: '#0b2a86', onBlock: '#ffffff', accent: '#1f6fe0', onAccent: '#ffffff', glyphs: ['#bcd8f2', '#5cb2ec', '#1c74d5', '#0b2a86'] } },
  // From the koi pond: stone and ink, vermilion and gold. Failure is a deeper red, never the button.
  { id: 'koi', name: 'Koi', note: 'Stone, vermilion, gold', hue: 70, chroma: 0.012,
    dark: { block: '#ece6d8', onBlock: '#1b1a17', accent: '#f0583f', onAccent: '#ffffff', glyphs: ['#5a564e', '#a8a296', '#f0583f', '#f2b632'], bad: '#c22a1c' },
    light: { block: '#1d1c1a', onBlock: '#f7f5f0', accent: '#e4503a', onAccent: '#ffffff', glyphs: ['#cbc6bb', '#8f8a80', '#e4503a', '#c48a08'], bad: '#9e1b12' } },
]

export const themeOf = (id: string): Theme => THEMES.find((t) => t.id === id) ?? THEMES[0]

// The neutrals of a theme in a mode, at the same lightness steps for every theme.
export function surfaces(t: Theme, mode: Mode) {
  const c = t.chroma, h = t.hue
  return mode === 'dark'
    ? { ground: `oklch(14.5% ${c} ${h})`, sheet: `oklch(18% ${c} ${h})`, well: `oklch(22% ${c} ${h})`, ink: `oklch(96% ${c * 0.6} ${h})` }
    : { ground: `oklch(93% ${c * 1.3} ${h})`, sheet: `oklch(98.6% ${c * 0.35} ${h})`, well: `oklch(96% ${c * 0.6} ${h})`, ink: `oklch(25% ${c * 2.4} ${h})` }
}

// Every custom property a theme sets on the root. Lunchbox sets none: styles.css is its source.
export function tokens(t: Theme, mode: Mode): Record<string, string> {
  if (t.id === 'lunchbox') return {}
  const s = surfaces(t, mode)
  const tone = t[mode]
  const mix = (n: number) => `color-mix(in oklab, var(--ink) ${n}%, transparent)`
  return {
    '--ground': s.ground, '--sheet': s.sheet, '--well': s.well, '--ink': s.ink,
    '--dim': mix(64), '--faint': mix(40), '--line': mix(9), '--line2': mix(16), '--cell': mix(13), '--hover': mix(5),
    '--block': tone.block, '--on-block': tone.onBlock, '--accent': tone.accent, '--on-accent': tone.onAccent,
    ...(tone.warn ? { '--warn': tone.warn } : {}), ...(tone.bad ? { '--bad': tone.bad } : {}),
    ...Object.fromEntries(tone.glyphs.map((g, i) => [`--glyph-${i + 1}`, g])),
  }
}

// The ASCII on its own: the welcome band, the room's field, the strips an agent draws while it
// works and the dot fields. Theme follows the theme; Ink is plain; the rest are ramps from faint
// to loud, one set for dark grounds and one for light, so each reads on both.
export type AsciiId = 'theme' | 'ink' | 'lagoon' | 'cobalt' | 'dusk' | 'meadow' | 'koi' | 'ember' | 'aurora' | 'riso' | 'phosphor' | 'amber' | 'sakura' | 'brass'
export type Ascii = { id: AsciiId; name: string; dark?: Ramp; light?: Ramp }

export const ASCII: Ascii[] = [
  { id: 'theme', name: 'Theme' },
  { id: 'ink', name: 'Ink' },
  { id: 'lagoon', name: 'Lagoon', dark: ['#1d5664', '#13a6b6', '#65d3b0', '#e6f8b8'], light: ['#9fd3c6', '#3fb3a2', '#13849a', '#0f3a44'] },
  { id: 'cobalt', name: 'Cobalt', dark: ['#2a4fb8', '#2f7bf0', '#74ccf8', '#e3f2fc'], light: ['#a9cdf0', '#5cb2ec', '#1c74d5', '#0b2a86'] },
  { id: 'dusk', name: 'Dusk', dark: ['#4a2a72', '#b4507a', '#ff8a65', '#ffd9bd'], light: ['#e3b8cf', '#c86a8e', '#e0714c', '#4a1a4f'] },
  { id: 'meadow', name: 'Meadow', dark: ['#4b6a55', '#93b09d', '#e9a596', '#fbe9bc'], light: ['#c7d9cc', '#93b09d', '#d98b7e', '#3f4634'] },
  { id: 'koi', name: 'Koi', dark: ['#5a564e', '#a8a296', '#f0583f', '#f2b632'], light: ['#cbc6bb', '#8f8a80', '#e4503a', '#c48a08'] },
  { id: 'ember', name: 'Ember', dark: ['#6e1c12', '#c2410c', '#fb923c', '#fde3b8'], light: ['#f3c3a6', '#ea7a3c', '#c2410c', '#5c1a0c'] },
  { id: 'aurora', name: 'Aurora', dark: ['#40288c', '#7c5cff', '#38d9c4', '#d9fff3'], light: ['#cfc2ff', '#8b70ff', '#14a89a', '#2a1a78'] },
  { id: 'riso', name: 'Riso', dark: ['#00788c', '#00a3b4', '#ff48b0', '#ffd1ea'], light: ['#a6e0e6', '#00a3b4', '#ff48b0', '#7a0a4c'] },
  { id: 'phosphor', name: 'Phosphor', dark: ['#145a28', '#1f9e4a', '#4dff88', '#d4ffe0'], light: ['#b6e6c4', '#2fb35c', '#16803a', '#0b3d1c'] },
  { id: 'amber', name: 'Amber CRT', dark: ['#6e3c00', '#b86e00', '#ffb000', '#ffe7a8'], light: ['#f0d3a0', '#d08c10', '#a35f00', '#4a2a00'] },
  { id: 'sakura', name: 'Sakura', dark: ['#78394f', '#d98aa5', '#f6c1d2', '#fff4f7'], light: ['#f3cdd9', '#e59ab4', '#c25b80', '#5e1f36'] },
  { id: 'brass', name: 'Brass', dark: ['#5a461e', '#9c7a35', '#d9b25f', '#f6e7bf'], light: ['#e6d4ac', '#b8913f', '#8a6420', '#3d2a08'] },
]

export const asciiOf = (id: string): Ascii => ASCII.find((a) => a.id === id) ?? ASCII[0]
