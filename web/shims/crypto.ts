// Node's crypto, the parts Lunchbox uses: hashes (synchronous, as Node's are) and random values.
import { Buffer } from 'buffer'
import { sha1 } from '@noble/hashes/legacy'
import { md5 } from '@noble/hashes/legacy'
import { sha256, sha512 } from '@noble/hashes/sha2'

const algos: Record<string, { create(): { update(b: Uint8Array): unknown; digest(): Uint8Array } }> = { sha1, sha256, sha512, md5 }

export function createHash(name: string) {
  const algo = algos[name.toLowerCase()]
  if (!algo) throw new Error(`Hash ${name} is not available in the browser`)
  const h = algo.create()
  const api = {
    update(data: string | Uint8Array, enc?: BufferEncoding) {
      h.update(typeof data === 'string' ? Buffer.from(data, enc ?? 'utf8') : data)
      return api
    },
    digest(enc?: BufferEncoding) {
      const out = Buffer.from(h.digest())
      return enc ? out.toString(enc) : out
    },
  }
  return api
}

export const randomUUID = () => crypto.randomUUID()
export function randomBytes(n: number) {
  const b = Buffer.alloc(n)
  crypto.getRandomValues(b)
  return b
}
export function randomInt(min: number, max?: number) {
  if (max === undefined) [min, max] = [0, min]
  const range = max - min
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return min + (buf[0] % range)
}
export const webcrypto = globalThis.crypto
export function createPublicKey() { throw new Error('Not available in the browser') }
export function verify() { return false }

export default { createHash, randomUUID, randomBytes, randomInt, webcrypto, createPublicKey, verify }
