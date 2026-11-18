// readline.createInterface over a stream: one 'line' event per line of what it emits.
import { EventEmitter } from 'events'

export function createInterface(o: { input: EventEmitter }) {
  const rl = new EventEmitter() as EventEmitter & { close(): void; [Symbol.asyncIterator](): AsyncIterator<string> }
  let rest = ''
  const lines: string[] = []
  let wake: (() => void) | null = null
  let closed = false
  o.input.on('data', (b: unknown) => {
    rest += String(b)
    const parts = rest.split(/\r?\n/)
    rest = parts.pop() ?? ''
    for (const l of parts) { rl.emit('line', l); lines.push(l) }
    wake?.()
  })
  o.input.on('end', () => {
    if (rest) { rl.emit('line', rest); lines.push(rest) }
    rest = ''
    closed = true
    rl.emit('close')
    wake?.()
  })
  rl.close = () => { closed = true; rl.emit('close'); wake?.() }
  rl[Symbol.asyncIterator] = () => ({
    async next() {
      while (!lines.length && !closed) await new Promise<void>((r) => (wake = r))
      return lines.length ? { value: lines.shift()!, done: false } : { value: undefined as never, done: true }
    },
  })
  return rl
}
export default { createInterface }
