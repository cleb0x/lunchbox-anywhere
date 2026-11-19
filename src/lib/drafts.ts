// What was typed in each room and not sent yet, and the last messages sent there for the up
// arrow. Both outlive a restart. They are kept small, and go when their room is deleted.
const KEEP = 50
const MAX_DRAFT = 20000
const MAX_SENT = 4000
const NEW = 'new'

export type Draft = { text: string; files: string[] }

const drafts = new Map<string, Draft>()
const sent = new Map<string, string[]>()

const read = <T>(key: string, ok: (v: unknown) => v is T): T | null => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    return ok(v) ? v : null
  } catch { return null }
}
// A full or blocked store only costs the restart; the session still has it in memory.
const write = (key: string, v: unknown) => {
  try { if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(v)) } catch {}
}
const isDraft = (v: unknown): v is Draft => !!v && typeof (v as Draft).text === 'string' && Array.isArray((v as Draft).files) && (v as Draft).files.every((f) => typeof f === 'string')
const isList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

export function draftOf(room: string): Draft | undefined {
  if (!drafts.has(room)) {
    const saved = read(`lb.draft.${room}`, isDraft)
    if (saved) drafts.set(room, { text: saved.text.slice(0, MAX_DRAFT), files: saved.files.slice(0, 12) })
  }
  return drafts.get(room)
}

export function saveDraft(room: string, d: Draft | null) {
  if (d && (d.text || d.files.length)) drafts.set(room, d)
  else drafts.delete(room)
  // A paste too long to keep is still there until the app closes.
  write(`lb.draft.${room}`, d && (d.text || d.files.length) && d.text.length <= MAX_DRAFT ? d : null)
}

// Newest first. The box with no room yet, on New room, has a history of its own.
export function sentIn(room = NEW): string[] {
  let list = sent.get(room)
  if (!list) sent.set(room, (list = (read(`lb.sent.${room}`, isList) ?? []).slice(0, KEEP)))
  return list
}

export function remember(room = NEW, text: string) {
  const list = sentIn(room)
  if (!text || list[0] === text) return
  list.unshift(text)
  list.length = Math.min(list.length, KEEP)
  write(`lb.sent.${room}`, list.filter((t) => t.length <= MAX_SENT))
}

export function forget(room: string) {
  drafts.delete(room)
  sent.delete(room)
  write(`lb.draft.${room}`, null)
  write(`lb.sent.${room}`, null)
}

// Drops what belongs to rooms that no longer exist, however they were deleted.
export function prune(rooms: string[]) {
  const known = new Set([...rooms, NEW])
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const m = localStorage.key(i)?.match(/^lb\.(?:draft|sent)\.(.+)$/)
      if (m && !known.has(m[1])) forget(m[1])
    }
  } catch {}
}
