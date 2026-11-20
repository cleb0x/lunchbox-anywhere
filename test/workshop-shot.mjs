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
    env: { ...process.env, LB_FOLDER: 'shared', LB_PLAN_LIMITS: 'off', LB_WORKSPACE: temp('work'), LUNCHBOX_PATH: PATH, LUNCHBOX_PATH_ONLY: '1', FAKE_DELAY: '20', LB_WORKSHOP_REPO: root, LB_WORKSHOP_REF: head, ...extra },
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
  check(await page.isEnabled('button:has-text("Set up the Workshop")'), 'setup is offered when git and npm are found')
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
  await page.waitForSelector('.ws-file')
  const files = await page.$$eval('.ws-file code', (els) => els.map((e) => e.textContent))
  check(files.includes('README.md') && files.includes('src/views/Hello.tsx'), `changes list shows edited and new files (${files.join(', ')})`)
  await shot(page, '02-ready')
  await page.click('.ws-chip >> nth=0')
  await shot(page, '03-idea', 300)
  await page.fill('.ws-field textarea', '')
  await page.click('button:has-text("Send as a suggestion")')
  await page.fill('.ws-suggest textarea', 'A greeting on the home page')
  await shot(page, '04-suggest', 500)
  await page.click('.ws-suggest button:has-text("Cancel")')

  // Open your version: build, hand over, and this app quits once the new one shows a window.
  const closed = new Promise((done) => app.process().once('exit', done))
  await page.click('button:has-text("Open your version")')
  await page.waitForSelector('.ws-progress', { timeout: 10000 }).catch(() => {})
  await shot(page, '05-building', 1500)
  const ended = await Promise.race([closed.then(() => true), new Promise((r) => setTimeout(() => r(false), 180000))])
  check(ended, 'the standard app steps aside after the hand over')
  const saved = JSON.parse(readFileSync(join(profile, 'workshop.json'), 'utf8'))
  check(saved.use === true && saved.start?.ok === true, `the person's build opened a window and said so (${JSON.stringify(saved.start)})`)
  check(existsSync(join(ws, 'out', 'main.cjs')), 'the copy was built')
  try { execFileSync('pkill', ['-f', ws]) } catch {}
}

// 3. The person's build itself shows that it is theirs and offers the way back.
{
  writeFileSync(join(profile, 'workshop.json'), JSON.stringify({ base: head, use: false }))
  const { app, page } = await open(profile, { LB_WORKSHOP_DIR: ws, LUNCHBOX_WORKSHOP: '1', LUNCHBOX_STANDARD: '/nonexistent' }, electronBin, ws)
  await page.waitForSelector('.ws-mine')
  check(await page.isVisible('button:has-text("Back to standard Lunchbox")'), 'the own build offers the way back')
  await shot(page, '06-mine')
  await app.close()
}

console.log(failures.length ? `\n${failures.length} failed` : '\nall passed')
process.exit(failures.length ? 1 : 0)
