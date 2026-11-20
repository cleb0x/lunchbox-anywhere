import { _electron as electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The Workshop end to end: the setup page, a copy with changes, a suggestion, and the hand over to
// the person's own build, which must take the profile and report that its window opened.
// Copies this repository's committed HEAD, so commit before running. node test/workshop-shot.mjs
const root = new URL('..', import.meta.url).pathname
const out = root + 'test/shots/workshop-'
mkdirSync(root + 'test/shots', { recursive: true })
const temp = (name) => mkdtempSync(join(tmpdir(), `lunchbox-${name}-`))
const bin = temp('bin')
chmodSync(root + 'test/fake-agent.mjs', 0o755)
for (const name of ['claude', 'codex']) symlinkSync(root + 'test/fake-agent.mjs', `${bin}/${name}`)
const tools = execFileSync('/bin/sh', ['-lc', 'dirname "$(command -v git)"; dirname "$(command -v npm)"']).toString().trim().split('\n')
const PATH = [bin, ...tools, '/usr/bin', '/bin'].join(':')
const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD']).toString().trim()
const electronBin = createRequire(import.meta.url)('electron')
const failures = []
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }

async function open(profile, extra = {}, exe = electronBin, dir = '.') {
  const app = await electron.launch({
    executablePath: exe, args: [dir, `--user-data-dir=${profile}`], cwd: root,
    env: { ...process.env, LB_FOLDER: 'shared', LB_PLAN_LIMITS: 'off', LB_WORKSPACE: temp('work'), LUNCHBOX_PATH: PATH, LUNCHBOX_PATH_ONLY: '1', FAKE_DELAY: '20', LB_WORKSHOP_REPO: root, LB_WORKSHOP_REF: head, LB_REPORT_ENDPOINT: 'http://127.0.0.1:9/report', ...extra },
    timeout: 30000,
  })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => failures.push(`page error: ${e}`))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  await page.waitForSelector('.onboard, .newroom, .page, .room')
  if (await page.$('.onboard')) {
    for (let i = 0; i < 4; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(i ? 900 : 2600) }
    await page.waitForSelector('.newroom')
  }
  await page.click('.sbitem:has-text("Workshop")')
  await page.waitForSelector('.pagehead h1:has-text("Workshop")')
  return { app, page }
}
const shot = async (page, name, wait = 700) => { await page.waitForTimeout(wait); await page.screenshot({ path: out + name + '.png' }) }

// 1. Nothing set up yet.
{
  const { app, page } = await open(temp('profile'), { LB_WORKSHOP_DIR: join(temp('ws'), 'copy') })
  await page.waitForSelector('.ws-steps')
  check(await page.isVisible('.ws-field textarea'), 'the first thing on the page is where to say what you want')
  await shot(page, '01-setup')
  await app.close()
}

// 2. A copy with changes: made here the way setup makes it, with this repo's packages linked in.
const profile = temp('profile')
const ws = join(temp('ws'), 'copy')
execFileSync('git', ['clone', '-q', root, ws])
execFileSync('git', ['-C', ws, 'checkout', '-q', '-b', 'mine', head])
symlinkSync(join(root, 'node_modules'), join(ws, 'node_modules'))
writeFileSync(join(profile, 'workshop.json'), JSON.stringify({ base: head }))
writeFileSync(join(ws, 'src', 'views', 'Hello.tsx'), 'export const Hello = () => <p>Hello</p>\n')
writeFileSync(join(ws, 'README.md'), readFileSync(join(ws, 'README.md'), 'utf8') + '\nA line from the Workshop.\n')
{
  const { app, page } = await open(profile, { LB_WORKSHOP_DIR: ws })
  await page.waitForSelector('.ws-built')
  check(await page.isVisible('.ws-built button:has-text("Try it")') && !(await page.isVisible('.ws-file')), 'a built change offers Try it, with the files behind Details')
  await page.click('.ws-built button:has-text("Details")')
  await page.waitForSelector('.ws-file')
  const files = await page.$$eval('.ws-file code', (els) => els.map((e) => e.textContent))
  check(files.includes('README.md') && files.includes('src/views/Hello.tsx'), `changes list shows edited and new files (${files.join(', ')})`)
  await shot(page, '02-ready')
  await page.click('.ws-chip >> nth=0')
  await shot(page, '03-idea', 300)
  await page.fill('.ws-field textarea', '')
  await page.click('button:has-text("Add a note")')
  await page.fill('.ws-suggest textarea', 'A greeting on the home page')
  await shot(page, '04-suggest', 500)
  await page.click('.ws-suggest button:has-text("Cancel")')
  // One click sends; the report service here answers nothing, so it waits in the outbox.
  await page.click('button:has-text("Send it to Lunchbox")')
  await page.waitForTimeout(2500)
  const outbox = join(profile, 'data', 'outbox.jsonl')
  const queued = existsSync(outbox) ? readFileSync(outbox, 'utf8') : ''
  check(/Workshop suggestion/.test(queued) && /Hello\.tsx/.test(queued) && /"patch":"diff --git/.test(queued), 'one click sends the note and the whole change')

  // An idea starts its own room straight away when the copy is ready, with Try it in its header.
  await page.fill('.ws-field textarea', 'A sound when an agent finishes')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.room .ws-bar', { timeout: 15000 })
  check(await page.isVisible('.ws-bar button:has-text("Try it")'), 'an idea opens its room, with Try it in the header')
  await shot(page, '04b-room', 1200)
  await page.waitForFunction(() => !document.querySelector('.room .composer .stop, .room [aria-label="Stop"]'), null, { timeout: 30000 }).catch(() => {})
  await page.click('.sbitem:has-text("Workshop")')
  await page.waitForSelector('.ws-built')
  check(await page.isVisible('.ws-idea:has-text("A sound when an agent finishes")'), 'the idea is listed on the Workshop page')

  // Try it: build, hand over, and this app quits once the new one shows a window.
  const closed = new Promise((done) => app.process().once('exit', done))
  await page.waitForFunction(() => !document.querySelector('.ws-idea .loader'), null, { timeout: 60000 }).catch(() => {})
  await page.click('.ws-built button:has-text("Try it")')
  await page.waitForSelector('.ws-progress', { timeout: 10000 }).catch(() => {})
  await shot(page, '05-building', 300).catch(() => {})
  const ended = await Promise.race([closed.then(() => true), new Promise((r) => setTimeout(() => r(false), 180000))])
  check(ended, 'the standard app steps aside after the hand over')
  const saved = JSON.parse(readFileSync(join(profile, 'workshop.json'), 'utf8'))
  check(saved.use === true && saved.start?.ok === true, `the person's build opened a window and said so (${JSON.stringify(saved.start)})`)
  check(existsSync(join(ws, 'out', 'main.cjs')), 'the copy was built')
  // The own build holds the profile until it has quit, so the next step waits for it to go.
  try { execFileSync('pkill', ['-f', ws]) } catch {}
  for (let i = 0; i < 40; i++) {
    try { execFileSync('pgrep', ['-f', ws]) } catch { break }
    await new Promise((r) => setTimeout(r, 250))
  }
}

// 3. The person's build itself shows that it is theirs and offers the way back.
{
  writeFileSync(join(profile, 'workshop.json'), JSON.stringify({ base: head, use: false }))
  const { app, page } = await open(profile, { LB_WORKSHOP_DIR: ws, LUNCHBOX_WORKSHOP: '1', LUNCHBOX_STANDARD: '/nonexistent' }, electronBin, ws)
  await page.waitForSelector('.ws-mine')
  check(await page.isVisible('button:has-text("Switch back")'), 'the own build offers the way back')
  await shot(page, '06-mine')
  await app.close()
}

console.log(failures.length ? `\n${failures.length} failed` : '\nall passed')
process.exit(failures.length ? 1 : 0)
