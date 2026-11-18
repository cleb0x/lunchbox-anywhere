// Finding your Lunchbox. Every computer that runs Lunchbox for you (your PC at home, a Cloud
// Shell) has a key. Opening a link with a key once on a device saves it here. Each running
// Lunchbox posts its current address to ntfy.sh, encrypted with its key (server/main.ts), so this
// page can read it, and nobody without the key can. Your own computer comes first.
type Computer = { key: string; name?: string; kind?: string; added: number }
export type Found = { key: string; url: string; name: string; kind: string; at: number }

const RELAY = 'https://ntfy.sh'
const LIST = 'lb-computers'
const enc = new TextEncoder()
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
const sha = (s: string) => crypto.subtle.digest('SHA-256', enc.encode(s))

export function computers(): Computer[] {
  try { return JSON.parse(localStorage.getItem(LIST) ?? '[]') } catch { return [] }
}
export function remember(key: string, info: { name?: string; kind?: string } = {}) {
  if (!/^[0-9a-f]{32,128}$/i.test(key)) return
  const list = computers().filter((c) => c.key !== key)
  list.unshift({ key, ...info, added: Date.now() })
  try { localStorage.setItem(LIST, JSON.stringify(list.slice(0, 10))) } catch {}
}
export function forget(key: string) {
  try { localStorage.setItem(LIST, JSON.stringify(computers().filter((c) => c.key !== key))) } catch {}
}

async function open(key: string, sealed: string) {
  const raw = Uint8Array.from(atob(sealed), (c) => c.charCodeAt(0))
  const k = await crypto.subtle.importKey('raw', await sha(`${key}:seal`), 'AES-GCM', false, ['decrypt'])
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, k, raw.slice(12))
  return JSON.parse(new TextDecoder().decode(plain))
}

// The newest address one computer posted, if it says it is online.
async function latest(key: string): Promise<Found | null> {
  const topic = 'lunchbox-' + hex(await sha(`${key}:topic`)).slice(0, 32)
  const res = await fetch(`${RELAY}/${topic}/json?poll=1&since=24h`, { signal: AbortSignal.timeout(6000) })
  if (!res.ok) return null
  const lines = (await res.text()).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.event === 'message')
  for (const m of lines.reverse()) {
    try {
      const o = await open(key, m.message)
      if (!o.online || !o.url) return null
      return { key, url: o.url, name: o.name ?? '', kind: o.kind ?? 'computer', at: o.at ?? 0 }
    } catch {}
  }
  return null
}

const answers = async (f: Found) => {
  try { return (await fetch(`${f.url}health?key=${f.key}`, { signal: AbortSignal.timeout(5000) })).ok } catch { return false }
}

// Every saved computer that is running and answers, your own computers before Cloud Shells.
export async function find(): Promise<Found | null> {
  const list = computers()
  if (!list.length) return null
  const found = (await Promise.all(list.map((c) => latest(c.key).catch(() => null)))).filter((f): f is Found => !!f)
  found.sort((a, b) => Number(a.kind === 'cloudshell') - Number(b.kind === 'cloudshell') || b.at - a.at)
  for (const f of found) {
    if (await answers(f)) { remember(f.key, { name: f.name, kind: f.kind }); return f }
  }
  return null
}
