import { _electron as electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'

// Several windows on one app, two rooms working at the same time, and chats brought in from
// Claude Code and Codex, all against stand-in agents and made-up session files.
// node test/windows.mjs
const root = new URL('..', import.meta.url).pathname
const out = root + 'test/shots/windows-'
mkdirSync(root + 'test/shots', { recursive: true })
const temp = (name) => mkdtempSync(join(tmpdir(), `lunchbox-${name}-`))
const bin = temp('bin')
chmodSync(root + 'test/fake-agent.mjs', 0o755)
for (const name of ['claude', 'codex']) symlinkSync(root + 'test/fake-agent.mjs', `${bin}/${name}`)
const log = join(temp('log'), 'calls.jsonl')

// A home folder holding nothing but the fixtures, so no real chat is ever read. The sessions say
// they were held in a folder that exists, or the agents could not pick them up there.
const home = temp('home')
const project = join(temp('work'), 'recipe-site')
mkdirSync(project, { recursive: true })
const fixture = (name) => readFileSync(root + `test/fixtures/import/${name}`, 'utf8').replaceAll('/Users/sam/recipe-site', project)
const claudeDir = join(home, '.claude/projects', project.replace(/[^a-zA-Z0-9]/g, '-'))
mkdirSync(claudeDir, { recursive: true })
writeFileSync(join(claudeDir, '0f3c9a52-7d1e-4b8a-9c11-5e2f6a7b8c9d.jsonl'), fixture('claude-session.jsonl'))
const codexDir = join(home, '.codex/sessions/2026/11/02')
mkdirSync(codexDir, { recursive: true })
writeFileSync(join(codexDir, 'rollout-2026-11-02T09-14-03-6b1d2c3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e.jsonl'), fixture('codex-rollout.jsonl'))
if (existsSync(root + 'test/fixtures/import/grok')) cpSync(root + 'test/fixtures/import/grok', join(home, '.grok/sessions'), { recursive: true })

// A page for the browser to show, served from this computer.
const site = createServer((_q, res) => res.end('<!doctype html><title>Recipe site</title><body style="font:16px system-ui;padding:40px"><h1>Recipe site</h1><p>Sourdough, rye and focaccia.</p>')).listen(0, '127.0.0.1')
const profile = temp('profile')
const launch = () => electron.launch({
  executablePath: createRequire(import.meta.url)('electron'),
  args: ['.', `--user-data-dir=${profile}`], cwd: root,
  env: { ...process.env, LB_FOLDER: 'shared', LB_PLAN_LIMITS: 'off', LB_WORKSPACE: temp('work'), LB_IMPORT_HOME: home, FAKE_LOG: log, LUNCHBOX_PATH: `${bin}:${process.execPath.replace(/\/[^/]+$/, '')}:/usr/bin:/bin`, LUNCHBOX_PATH_ONLY: '1', FAKE_DELAY: '260' },
  timeout: 30000,
})
let app = await launch()
const kill = setTimeout(() => { console.log('timed out'); app.close().finally(() => process.exit(1)) }, 170000)
const errors = []
const watch = (page) => { page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) }) }
const failed = []
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`); if (!ok) failed.push(name) }
// A room is between turns for a moment while one agent hands over to the next, so quiet means
// nothing running, nothing waiting to be sent and an answer under the newest message.
const quiet = async (page, id) => {
  for (let i = 0; i < 300; i++) {
    const d = await page.evaluate((room) => window.lb.call('room', room), id)
    const last = d.events.findLast((e) => e.kind === 'you' || e.kind === 'say')
    if (!d.live.turns.length && !d.live.runs.length && !d.live.queued?.length && last?.kind === 'say') return
    await page.waitForTimeout(200)
  }
  throw new Error('the room never went quiet')
}
const windows = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().includes('renderer/index.html')).length)

const one = await app.firstWindow()
watch(one)
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 60, y: 60, width: 1200, height: 800 }))
await one.waitForSelector('.onboard')
for (let i = 0; i < 4; i++) { await one.keyboard.press('Enter'); await one.waitForTimeout(i ? 900 : 2600) }
await one.waitForSelector('.newroom')

// Two rooms, both sent to before either has answered.
const start = async (page, text) => {
  await page.click('.composer textarea')
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
  await page.waitForSelector('.room')
}
await start(one, 'Write a short note on agent limits')
const [two] = await Promise.all([app.waitForEvent('window'), one.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+N' : 'Control+Shift+N')])
watch(two)
await two.waitForSelector('.newroom')
check('the shortcut opens one new window', (await windows()) === 2, `${await windows()} windows`)
await start(two, 'List three risks of weekly limits')
let both = 0
for (let i = 0; i < 40 && both < 2; i++) {
  both = (await one.evaluate(() => window.lb.call('rooms'))).filter((r) => r.busy).length
  if (both < 2) await one.waitForTimeout(100)
}
check('two rooms have agents working at the same moment', both === 2, `${both} busy`)
await one.screenshot({ path: out + '1-first-working.png' })
await two.screenshot({ path: out + '2-second-working.png' })
const rooms = await one.evaluate(() => window.lb.call('rooms'))
const first = rooms.find((r) => r.name.startsWith('Write a short note'))
await Promise.all(rooms.map((r) => quiet(one, r.id)))

// The same room in two windows: what is sent in one shows in both, once.
await two.evaluate((id) => window.lb.call('window:new', id), first.id)
const three = await app.waitForEvent('window')
watch(three)
await three.waitForSelector('.room')
check('a window opened on a room starts in that room', (await three.title()) === first.name, await three.title())
await one.click('.composer textarea')
await one.keyboard.type('And one more line about daily limits')
await one.keyboard.press('Enter')
await three.waitForFunction(() => [...document.querySelectorAll('.mine')].some((m) => m.textContent.includes('daily limits')), null, { timeout: 15000 })
await quiet(one, first.id)
const said = (await one.evaluate((id) => window.lb.call('room', id), first.id)).events.filter((e) => e.kind === 'you' && e.text.includes('daily limits')).length
check('a message sent with the room open in two windows is sent once', said === 1, `${said} copies`)
// The same text from two windows in the same moment is one message.
await Promise.all([one, three].map((p) => p.evaluate((id) => window.lb.call('room:send', id, 'Twice at once', 'workspace', false), first.id)))
await one.waitForTimeout(600)
const twice = (await one.evaluate((id) => window.lb.call('room', id), first.id)).events.filter((e) => e.kind === 'you' && e.text === 'Twice at once').length
check('the same message from two windows at once is one message', twice === 1, `${twice} copies`)
await quiet(one, first.id)
await three.waitForTimeout(500)
await three.screenshot({ path: out + '3-same-room.png' })

// Appearance and settings changed in one window reach the others.
await two.evaluate(() => { window.heard = null; window.lb.on('settings', (s) => { window.heard = s.notify }) })
await one.evaluate(() => window.lb.call('settings:set', { notify: false }))
await two.waitForTimeout(300)
check('a setting saved in one window reaches the others', (await two.evaluate(() => window.heard)) === false)
// A real change, made through the app: the mode switch in the palette.
await one.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
await one.waitForSelector('.palette input')
await one.keyboard.type('Switch to day')
await one.keyboard.press('Enter')
const day = await two.waitForFunction(() => document.documentElement.dataset.theme === 'light', null, { timeout: 5000 }).then(() => true, () => false)
check('a theme change in one window is put on in the others', day)
await two.waitForTimeout(900)
await two.screenshot({ path: out + '4-day-everywhere.png' })
await one.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
await one.waitForSelector('.palette input')
await one.keyboard.type('Switch to night')
await one.keyboard.press('Enter')
await two.waitForFunction(() => document.documentElement.dataset.theme === 'dark', null, { timeout: 5000 }).catch(() => {})

// Only the app's own windows may call in.
const refused = await app.evaluate(async ({ BrowserWindow, app: a }) => {
  const w = new BrowserWindow({ show: false, webPreferences: { preload: a.getAppPath() + '/out/preload.cjs', contextIsolation: true, sandbox: true } })
  await w.loadURL('data:text/html,<p>stranger</p>')
  const r = await w.webContents.executeJavaScript(`window.lb.call('env').then(() => 'allowed', (e) => String(e))`)
  w.destroy()
  return r
})
check('a window the app did not open is refused', /Not allowed/.test(refused), refused)

// The browser's pages follow the window that opened the Browser page last.
const hosts = async () => (await one.evaluate(() => window.lb.call('browser'))).host
const idOf = (page) => page.evaluate(() => window.lb.call('env').then((e) => e.window))
await two.evaluate(() => dispatchEvent(new CustomEvent('lb:go', { detail: { name: 'browser' } })))
await two.waitForSelector('.browser')
await two.evaluate((url) => window.lb.call('browser:open', url), `localhost:${site.address().port}`)
await two.waitForFunction(() => window.lb.call('browser').then((b) => b.shown), null, { timeout: 8000 }).catch(() => {})
await two.waitForTimeout(400)
check('the browser shows in the window that opened it', (await hosts()) === (await idOf(two)))
await three.evaluate(() => dispatchEvent(new CustomEvent('lb:go', { detail: { name: 'browser' } })))
await three.waitForSelector('.browser')
await three.waitForTimeout(900)
check('and moves to the next window that opens it', (await hosts()) === (await idOf(three)))
await two.waitForSelector('.bhole .linkbtn', { timeout: 5000 }).catch(() => {})
await two.screenshot({ path: out + '5-browser-elsewhere.png' })
await three.screenshot({ path: out + '6-browser-here.png' })

// Import: a quiet entry in the palette, the sessions found on this computer, and a room made from one.
const importFrom = async (page, pick) => {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
  await page.waitForSelector('.palette input')
  await page.keyboard.type('Import a chat')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.importsheet .imrow')
  if (pick === 'claude') { await page.waitForTimeout(700); await page.screenshot({ path: out + '7-import-list.png' }) }
  await page.click(`.importsheet .imrow[data-agent="${pick}"]`)
  await page.waitForSelector('.room')
  await page.waitForTimeout(700)
}
await importFrom(one, 'claude')
await one.evaluate(() => document.querySelector('.note, .evnote')?.scrollIntoView({ block: 'start' }))
await one.waitForTimeout(300)
await one.screenshot({ path: out + '8-imported-claude.png' })
const claudeRoom = (await one.evaluate(() => window.lb.call('rooms')))[0]
const brought = await one.evaluate((id) => window.lb.call('room', id), claudeRoom.id)
check('the Claude chat came in as a room in its own folder', brought.meta.workspace === project && brought.events.some((e) => e.kind === 'you') && brought.events.some((e) => e.kind === 'say' && e.who === 'claude'), brought.meta.workspace)
check('with no raw records in it', !JSON.stringify(brought.events).includes('tool_use_id') && !JSON.stringify(brought.events).includes('system-reminder'))
await one.click('.composer textarea')
await one.keyboard.type('Carry on where we stopped')
await one.keyboard.press('Enter')
await quiet(one, claudeRoom.id)
const calls = () => readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const resumed = calls().find((c) => c.args.includes('0f3c9a52-7d1e-4b8a-9c11-5e2f6a7b8c9d'))
check('continuing picks up the very session it came from', resumed?.name === 'claude' && resumed.args.includes('--resume'), resumed?.args.join(' ').slice(0, 120))
check('in the folder it was held in', (await one.evaluate((id) => window.lb.call('room', id), claudeRoom.id)).meta.workspace === project)
check('and does not send the old conversation again', !!resumed && !resumed.input.includes('wrong baking time') && !resumed.input.includes('rye loaf') && resumed.input.includes('Carry on where we stopped'))
await one.screenshot({ path: out + '9-continued.png' })

await importFrom(two, 'codex')
await two.screenshot({ path: out + '10-imported-codex.png' })
await two.click('.composer textarea')
await two.keyboard.type('What is left to do?')
await two.keyboard.press('Enter')
await quiet(two, (await two.evaluate(() => window.lb.call('rooms')))[0].id)
const codexCall = calls().find((c) => c.args.includes('6b1d2c3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e'))
check('Codex resumes its own thread', codexCall?.name === 'codex' && codexCall.args.includes('resume'), codexCall?.args.join(' ').slice(0, 120))

// The menu bar has the same command, and it still works with several windows open.
const before = await windows()
const [fromMenu] = await Promise.all([app.waitForEvent('window'), app.evaluate(({ Menu }) => {
  const item = Menu.getApplicationMenu().items.find((i) => i.label === 'File').submenu.items.find((i) => i.label === 'New Window')
  item.click()
})])
await fromMenu.waitForSelector('.newroom')
const labels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map((i) => i.label || i.role))
check('File, New Window in the menu bar opens a window', (await windows()) === before + 1, labels.join(', '))

// Closing every window keeps the app alive on a Mac, and the Dock brings one back where it was.
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 140, y: 120, width: 1100, height: 760 }))
await one.waitForTimeout(700)
if (process.platform === 'darwin') {
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.close() })
  await new Promise((r) => setTimeout(r, 600))
  check('closing the last window leaves the app running', (await windows()) === 0)
  const [back] = await Promise.all([app.waitForEvent('window'), app.evaluate(({ app: a }) => { a.emit('activate') })])
  await back.waitForSelector('.newroom, .room')
  check('the Dock opens a window again', (await windows()) === 1)
  const again = await Promise.all([app.waitForEvent('window'), app.evaluate(({ app: a }) => { a.emit('second-instance', {}, [], '') })])
  await again[0].waitForSelector('.newroom')
  check('a second launch opens a window in the app that is running', (await windows()) === 2)
}
const saved = JSON.parse(readFileSync(join(profile, 'window.json'), 'utf8'))
check('the window place is saved', Number.isFinite(saved.x) && saved.width >= 960, JSON.stringify(saved))
await app.close()
app = await launch()
const reopened = await app.firstWindow()
await reopened.waitForSelector('.newroom')
const b = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())
check('and the next launch opens there', b.x === saved.x && b.y === saved.y && b.width === saved.width && b.height === saved.height, JSON.stringify(b))

site.close()
console.log('page errors:', errors.length ? errors.join('\n') : 'none')
clearTimeout(kill)
await app.close()
process.exit(failed.length ? 1 : 0)
