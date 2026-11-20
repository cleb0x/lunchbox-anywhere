import { _electron as electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Watches one room scenario the way a person would: a contact sheet of the window over time, the
// order of the rows each time it changes, and every frame where something moved in one step.
// node test/watch.mjs <scenario> [out dir]     scenarios: handoff consult arena progress prose stop queue reopen
const root = new URL('..', import.meta.url).pathname
const name = process.argv[2] ?? 'handoff'
const dir = process.argv[3] ?? root + 'test/shots'
mkdirSync(dir, { recursive: true })

const wait = (page, ms) => page.waitForTimeout(ms)
const send = async (page, text) => { await page.click('.composer textarea'); await page.keyboard.type(text); await page.keyboard.press('Enter') }
const quiet = (page, ms = 60000) => page.waitForFunction(() => !document.querySelector('.ev.live, .workpair, .mine.queued') && document.querySelectorAll('.transcript .column > :not(.mine, .tail)').length > 0, null, { timeout: ms })

const scenarios = {
  // A plan, a question to a crewmate on its own line, the answer, the wrap-up and the proof.
  handoff: { bins: ['claude', 'grok'], env: { FAKE_DELAY: '90' }, run: async (page) => { await send(page, 'What do people say about agent limits?'); await wait(page, 3000); await quiet(page); await wait(page, 1500) } },
  // Help asked for through the room's tool in the middle of a turn, with a limit switch on the way.
  consult: { bins: ['claude', 'codex', 'grok'], env: { FAKE_DELAY: '120' }, run: async (page) => { await send(page, 'Consult: check the island renders'); await wait(page, 3000); await quiet(page); await wait(page, 1500) } },
  arena: { bins: ['claude', 'grok'], env: { FAKE_DELAY: '140' }, run: async (page) => {
    await page.click('.composer button:has-text("Side by side")')
    await send(page, 'Name the top complaint about agent limits')
    await wait(page, 3000); await quiet(page); await wait(page, 800)
    await page.click('.arenacol .keep'); await wait(page, 1200)
  } },
  progress: { bins: ['claude'], env: { FAKE_DELAY: '0', FAKE_SCRIPT: 'progress' }, run: async (page) => { await send(page, 'Build the pricing page and test it'); await wait(page, 5000); await quiet(page); await wait(page, 2500) } },
  // A long answer read from further up while it is still being written, then back down.
  prose: { bins: ['claude'], size: [1000, 560], env: { FAKE_DELAY: '0', FAKE_SCRIPT: 'prose' }, run: async (page) => {
    await send(page, 'Write up the launch plan')
    await wait(page, 4000)
    await page.mouse.move(600, 260); await page.mouse.wheel(0, -400)
    await wait(page, 2500)
    await page.locator('.tolatest').click({ timeout: 3000 }).catch(() => console.log('no way back down was offered'))
    await quiet(page); await wait(page, 1500)
  } },
  // The README story played through, then the room left and opened again: nothing may land a
  // second time, and long answers between agents come back folded.
  reopen: { bins: ['claude', 'codex', 'grok'], env: { FAKE_DELAY: '4', FAKE_SCRIPT: 'showcase' }, run: async (page) => {
    await send(page, 'Find out what people on X want from hackathons, write the announcement, design the banner and put up the event page.')
    await wait(page, 5000); await quiet(page, 120000); await wait(page, 1500)
    await page.click('.sbitem >> text=New room'); await wait(page, 800)
    await page.click('.sbroom'); await wait(page, 2500)
  } },
  stop: { bins: ['claude'], env: { FAKE_DELAY: '0', FAKE_SCRIPT: 'progress' }, run: async (page) => { await send(page, 'Build the pricing page and test it'); await wait(page, 7000); await page.click('.composer .stop, .composer button[aria-label="Stop"]'); await wait(page, 3000) } },
  queue: { bins: ['claude', 'grok'], env: { FAKE_DELAY: '120' }, run: async (page) => {
    await send(page, 'What do people say about agent limits?')
    await wait(page, 1800)
    await send(page, 'Then add a line about weekly limits')
    await wait(page, 3000); await quiet(page, 90000); await wait(page, 1500)
  } },
}
const sc = scenarios[name]
if (!sc) throw new Error(`no scenario ${name}`)

const temp = (n) => mkdtempSync(join(tmpdir(), `lunchbox-${n}-`))
const bin = temp('bin')
chmodSync(root + 'test/fake-agent.mjs', 0o755)
for (const n of sc.bins) symlinkSync(root + 'test/fake-agent.mjs', `${bin}/${n}`)
const app = await electron.launch({
  executablePath: createRequire(import.meta.url)('electron'),
  args: ['.', `--user-data-dir=${temp('profile')}`], cwd: root,
  env: { ...process.env, LB_FOLDER: 'shared', LB_PLAN_LIMITS: 'off', LB_WORKSPACE: temp('work'), LUNCHBOX_PATH: `${bin}:${process.execPath.replace(/\/[^/]+$/, '')}:/usr/bin:/bin`, LUNCHBOX_PATH_ONLY: '1', ...sc.env },
  timeout: 30000,
})
const kill = setTimeout(() => { console.log('timed out'); app.close().finally(() => process.exit(1)) }, 240000)
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), sc.size ?? [1200, 800])
await page.waitForSelector('.onboard')
for (let i = 0; i < 30 && !(await page.locator('.newroom').count()); i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(700) }
await page.waitForSelector('.newroom')

const frames = temp('frames')
const cdp = await page.context().newCDPSession(page)
let n = 0
const t0 = Date.now()
let lastShot = 0
cdp.on('Page.screencastFrame', async (f) => {
  // Five frames a second is enough to read the order of things.
  if (Date.now() - lastShot >= 200) { lastShot = Date.now(); writeFileSync(join(frames, `${String(n++).padStart(4, '0')}.jpg`), Buffer.from(f.data, 'base64')) }
  await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
})
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: 1200, maxHeight: 800, everyNthFrame: 1 })

await page.evaluate(() => {
  const t0 = performance.now()
  const w = (window.__watch = { jumps: [], steps: [], order: [], lands: [] })
  const at = () => Math.round(performance.now() - t0)
  const brief = (el) => `${el.className.replace(/\bev\b/, '').replace(/\s+/g, ' ').trim()}: ${el.innerText.replace(/\s+/g, ' ').slice(0, 64)}`
  // An entrance that starts on a row which has been in the room for a while is a replay.
  // A row drawn again under the same id, or one element landing twice, is a replayed entrance.
  const landed = new WeakSet()
  const ids = new Map()
  addEventListener('animationstart', (e) => {
    if (!/^(land|rise|handrule)$/.test(e.animationName) || !e.target.closest?.('.column')) return
    const id = e.target.matches('.column > *') && (e.target.dataset.id || e.target.querySelector('[data-id]')?.dataset.id)
    if (landed.has(e.target) || (id && ids.has(id) && ids.get(id) !== e.target)) w.lands.push({ t: at(), name: e.animationName, on: brief(e.target) })
    landed.add(e.target)
    if (id) ids.set(id, e.target)
  }, true)
  let top = null
  let sig = ''
  let seen = new Map()
  // Read from a resize observer made after the room's own, on a probe that changes size every
  // frame: by then the room has put back any row that was pushed, so this is what gets painted.
  let probe = null
  const look = () => {
    const box = document.querySelector('.transcript')
    const col = box?.querySelector('.column')
    if (col) {
      if (top !== null && box.scrollTop < top - 0.5) w.jumps.push({ t: at(), from: top, to: box.scrollTop })
      top = box.scrollTop
      const rows = [...col.children].filter((el) => !el.classList.contains('tail'))
      const now = new Map()
      for (const el of rows.slice(-10)) {
        // Where the row is in the conversation, so following the newest line does not count.
        const y = el.getBoundingClientRect().top + top
        now.set(el, y)
        const was = seen.get(el)
        if (was !== undefined && Math.abs(y - was) > 32) w.steps.push({ t: at(), by: Math.round(y - was), row: brief(el) })
      }
      seen = now
      const s = rows.map(brief).join('\n')
      if (s !== sig) { sig = s; w.order.push({ t: at(), rows: rows.map(brief) }) }
    } else top = null
  }
  const frame = () => {
    if (!probe && document.querySelector('.transcript .column')) {
      probe = document.body.appendChild(document.createElement('i'))
      probe.style.cssText = 'position:fixed;left:-9px;top:0;width:1px;height:1px;pointer-events:none'
      new ResizeObserver(look).observe(probe)
    }
    if (probe) probe.style.height = probe.style.height === '1px' ? '2px' : '1px'
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
})

try { await sc.run(page) } catch (e) { console.error(String(e)); process.exitCode = 1 }
const seen = await page.evaluate(() => window.__watch)
await cdp.send('Page.stopScreencast')
await page.screenshot({ path: join(dir, `watch-${name}-end.png`), scale: 'css' })
clearTimeout(kill)
await app.close()

// The frames as one sheet, read left to right, top to bottom.
const cols = 5
const pick = Math.max(1, Math.ceil(n / 40))
spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '5', '-i', join(frames, '%04d.jpg'), '-vf', `select='not(mod(n\\,${pick}))',scale=600:-1,tile=${cols}x${Math.ceil(Math.ceil(n / pick) / cols)}:padding=4`, '-frames:v', '1', '-q:v', '4', join(dir, `watch-${name}.jpg`)], { stdio: 'inherit' })
if (!process.env.KEEP_FRAMES) rmSync(frames, { recursive: true, force: true })
else console.log('frames in', frames)

writeFileSync(join(dir, `watch-${name}.json`), JSON.stringify(seen, null, 1))
let before = []
for (const o of seen.order) {
  // Only what changed since the last look, so a long turn reads as a short list.
  const fresh = o.rows.filter((r, i) => before[i]?.split(':')[0] !== r.split(':')[0] || before.length !== o.rows.length)
  if (fresh.length) console.log(`${String(o.t).padStart(6)}ms  ${o.rows.length} rows  ${o.rows.map((r) => r.split(':')[0] || 'you').join(' | ')}`)
  before = o.rows
}
console.log(`${Date.now() - t0}ms watched, ${n} frames, every ${pick}${pick > 1 ? 'th' : 'st'} on the sheet`)
console.log('jumps', JSON.stringify(seen.jumps))
console.log('moved in one step', JSON.stringify(seen.steps))
console.log('entrances replayed', JSON.stringify(seen.lands))
console.log('errors', errors)
