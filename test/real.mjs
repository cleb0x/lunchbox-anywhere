import { _electron as electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Real agents and real usage, run by hand before a release: a handoff through the room, an agent
// told off for starting another agent's CLI, Auto asking before the internet, and imported chats
// that remember. node test/real.mjs <folder holding claude-chat, codex-chat and work>  (build first)
const root = new URL('..', import.meta.url).pathname
const base = process.argv[2]
const out = root + 'test/shots/real-'
mkdirSync(root + 'test/shots', { recursive: true })
const app = await electron.launch({
  executablePath: createRequire(import.meta.url)('electron'),
  args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'lunchbox-real-'))}`], cwd: root,
  env: { ...process.env, LB_FOLDER: 'shared', LB_WORKSPACE: join(base, 'work') },
  timeout: 30000,
})
const kill = setTimeout(() => { console.log('timed out'); app.close().finally(() => process.exit(1)) }, 1500000)
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 60, y: 60, width: 1200, height: 860 }))
const failed = []
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`); if (!ok) failed.push(name) }
const room = (id) => page.evaluate((r) => window.lb.call('room', r), id)
const newest = async () => (await page.evaluate(() => window.lb.call('rooms')))[0].id
// Quiet: nothing running and an answer under the newest message. Questions are answered with
// the given answer as they come, and remembered so the caller can see they were asked.
const quiet = async (id, answer = 'once') => {
  const asked = []
  for (let i = 0; i < 1200; i++) {
    const d = await room(id)
    for (const r of d.live.runs.filter((x) => x.state === 'asking')) {
      if (!asked.some((a) => a.id === r.id)) asked.push({ id: r.id, command: r.command, kind: r.verdict?.kind })
      await page.evaluate(([rid, a]) => window.lb.call('run:answer', rid, a), [r.id, answer])
    }
    const last = d.events.findLast((e) => e.kind === 'you' || e.kind === 'say')
    if (!d.live.turns.length && !d.live.runs.length && !d.live.queued?.length && last?.kind === 'say') return { d, asked }
    await page.waitForTimeout(500)
  }
  throw new Error('the room never went quiet')
}
const send = async (text) => { await page.click('.composer textarea'); await page.keyboard.type(text); await page.keyboard.press('Enter') }
const since = (d, n) => d.events.slice(n)
const show = (es) => es.map((e) => e.kind === 'say' ? `say ${e.who}: ${(e.text ?? '').slice(0, 160)}${e.error ? ` [${e.error}]` : ''}` : e.kind === 'hands' ? `hands ${e.from} -> ${e.to}${e.via ? ` (${e.via})` : ''}: ${String(e.ask ?? '').slice(0, 80)} => ${String(e.answer ?? '').slice(0, 120)}` : e.kind === 'run' ? `run ${e.who}: ${String(e.command ?? '').slice(0, 100)}` : e.kind).join('\n  ')

await page.waitForSelector('.onboard')
for (let i = 0; i < 4; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(i ? 900 : 2600) }
await page.waitForSelector('.newroom')
await page.evaluate(() => window.lb.call('settings:set', { models: { claude: 'haiku' } }))
const agents = await page.evaluate(() => window.lb.call('agents'))
console.log('agents ready:', agents.filter((a) => a.found && a.ready).map((a) => a.id).join(', '))

// 1. A handoff the room can see.
await send('Claude, ask Grok through the room what the capital of France is, in one word. Then tell me Grok\'s answer in one short sentence.')
await page.waitForSelector('.room')
const id = await newest()
let r = await quiet(id)
console.log('  ' + show(r.d.events))
check('Claude asked Grok through the room', r.d.events.some((e) => e.kind === 'hands' && e.to === 'grok' && e.via !== 'cli'))
await page.screenshot({ path: out + '1-handoff.png' })

// 2. Starting Grok from its own shell is turned down.
let n = r.d.events.length
await send('Claude, run exactly this in your shell: grok -p "say hi". Then tell me in one sentence what happened.')
await page.waitForTimeout(1500)
r = await quiet(id)
console.log('  ' + show(since(r.d, n)))
check('the CLI call did not run grok outside the room', !since(r.d, n).some((e) => e.kind === 'hands' && e.via === 'cli'))
await page.screenshot({ path: out + '2-cli.png' })

// 3. Auto asks before a command that reaches the internet.
n = r.d.events.length
await send('Claude, run exactly this in your shell: curl -sI https://example.com. Then tell me the HTTP status code it printed, in one sentence.')
await page.waitForTimeout(1500)
r = await quiet(id)
console.log('  ' + show(since(r.d, n)), '\n  asked:', JSON.stringify(r.asked))
check('Auto asked before curl reached the internet', r.asked.some((a) => /curl/.test(a.command)))
check('and the command ran after the yes', /\b200\b/.test(since(r.d, n).filter((e) => e.kind === 'say').map((e) => e.text).join(' ')))

// 4 and 5. Imported chats remember what was said in them.
const importFrom = async (agent, folder) => {
  await page.keyboard.press('Meta+K')
  await page.waitForSelector('.palette input')
  await page.keyboard.type('Import a chat')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.importsheet .imrow')
  await page.waitForTimeout(800)
  const ok = await page.evaluate(([a, f]) => {
    const row = [...document.querySelectorAll(`.importsheet .imrow[data-agent="${a}"]`)].find((el) => el.textContent?.includes(f))
    row?.click()
    return !!row
  }, [agent, folder])
  check(`the ${agent} chat is listed`, ok)
  if (!ok) { await page.screenshot({ path: out + `import-${agent}.png` }); await page.keyboard.press('Escape'); return null }
  await page.waitForSelector('.room')
  await page.waitForTimeout(900)
  return newest()
}
for (const [agent, word] of [['claude', 'pelican'], ['codex', 'walrus']]) {
  const rid = await importFrom(agent, `${agent}-chat`)
  if (!rid) continue
  const before = (await room(rid)).events.length
  await send('What code word did I ask you to remember? Answer with the word only.')
  await page.waitForTimeout(1500)
  const done = await quiet(rid)
  const said = since(done.d, before).filter((e) => e.kind === 'say').map((e) => e.text ?? '').join(' ')
  console.log('  ' + show(since(done.d, before)))
  check(`the imported ${agent} chat remembers`, said.toLowerCase().includes(word), said.slice(0, 80))
  await page.screenshot({ path: out + `import-${agent}.png` })
}

console.log(failed.length ? `FAILED: ${failed.join('; ')}` : 'all checks passed', errors.length ? `\nerrors:\n${errors.join('\n')}` : '\nno page errors')
clearTimeout(kill)
await app.close()
