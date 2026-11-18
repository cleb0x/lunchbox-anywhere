import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto'
import { createReadStream } from 'node:fs'

// What the app trusts, with no Electron in it so the tests can load it. The private half of this
// key never leaves Noah's computer. It signs the message feed (scripts/notice.mjs) and, for every
// release, a short list of the files that release is made of (scripts/sign-release.mjs). Whoever
// controls the hosting can put files there but cannot sign them, so the app installs nothing
// from them.
export const KEY = createPublicKey('-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAcUzrUWrqBdLZc++0Sq82fE9P9ZTLy2ESPGV722bVjU0=\n-----END PUBLIC KEY-----\n')

// 1.10.0 is newer than 1.9.2; a pre-release tag counts as older than the plain version.
export function newer(a: string, b: string) {
  const [x, xt] = a.replace(/^v/, '').split('-')
  const [y, yt] = b.replace(/^v/, '').split('-')
  const p = x.split('.').map(Number)
  const q = y.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((p[i] ?? 0) !== (q[i] ?? 0)) return (p[i] ?? 0) > (q[i] ?? 0)
  return !xt && !!yt
}

export type SignedFile = { name: string; sha512: string; size: number }
export type Release = { version: string; issued: number; files: SignedFile[] }
export type Checked = { release: Release } | { refused: string }

const VERSION = /^\d+\.\d+\.\d+(-[\w.]+)?$/

// The bytes the signature covers. The first field is there so a signed message feed can never be
// passed off as a signed release, or the other way round.
export const signedBytes = (r: Release) => Buffer.from(JSON.stringify({ lunchbox: 'update', version: r.version, issued: r.issued, files: r.files }))

// latest-signed.json from a release. It is trusted only when the signature is Noah's, and never
// when it names a version older than the one running: an old release, signed in its day, could
// otherwise be served again to take the app back to a build with a known hole.
export function signedRelease(body: unknown, running: string, key: KeyObject = KEY, now = Date.now()): Checked {
  const m = body as { version?: unknown; issued?: unknown; files?: unknown; sig?: unknown } | null
  if (!m || typeof m !== 'object' || typeof m.version !== 'string' || !VERSION.test(m.version) || typeof m.issued !== 'number' || typeof m.sig !== 'string' || !Array.isArray(m.files)) return { refused: 'the release has no signed file list' }
  const files = m.files as SignedFile[]
  if (!files.length || files.some((f) => !f || typeof f.name !== 'string' || !/^[\w.+-]+$/.test(f.name) || typeof f.sha512 !== 'string' || typeof f.size !== 'number')) return { refused: 'the signed file list is not in a shape Lunchbox knows' }
  const release: Release = { version: m.version, issued: m.issued, files }
  let ok = false
  try { ok = verify(null, signedBytes(release), key, Buffer.from(m.sig, 'base64')) } catch {}
  if (!ok) return { refused: 'the release is not signed by Lunchbox' }
  if (m.issued > now + 3600e3) return { refused: 'the release is dated in the future' }
  if (newer(running, m.version)) return { refused: `the signed release is ${m.version}, older than this copy` }
  return { release }
}

export const fileNamed = (r: Release, name: string) => r.files.find((f) => f.name === name)

export function sha512(file: string) {
  return new Promise<string>((done, fail) => {
    const hash = createHash('sha512')
    createReadStream(file).on('data', (b) => hash.update(b)).on('error', fail).on('end', () => done(hash.digest('base64')))
  })
}

// A downloaded installer is the release's own only when its hash is on the signed list.
export async function onList(r: Release, file: string) {
  const sum = await sha512(file).catch(() => '')
  return !!sum && r.files.some((f) => f.sha512 === sum)
}
