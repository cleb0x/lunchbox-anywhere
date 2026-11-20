import { _electron as electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// How things leave: a sheet and a menu closed with the pointer fade out through a copy that
// cannot be used, the same close from the keyboard is instant, and an agent's settings fold shut.
// Frames of each exit go to test/shots/leave-*.   node test/leave.mjs   (npm run build first)
const root = new URL('..', import.meta.url).pathname
const out = root + 'test/shots/leave-'
mkdirSync(root + 'test/shots', { recursive: true })
const temp = (name) => mkdtempSync(join(tmpdir(), `lunchbox-${name}-`))
const bin = temp('bin')
chmodSync(root + 'test/fake-agent.mjs', 0o755)
for (const name of ['claude', 'codex', 'grok']) symlinkSync(root + 'test/fake-agent.mjs', `${bin}/${name}`)

const app = await electron.launch({
  executablePath: createRequire(import.meta.url)('electron'),
  args: ['.', `--user-data-dir=${temp('profile')}`], cwd: root,
  env: { ...process.env, LB_FOLDER: 'shared', LB_PLAN_LIMITS: 'off', LB_WORKSPACE: temp('work'), LUNCHBOX_PATH: `${bin}:${process.execPath.replace(/\/[^/]+$/, '')}:/usr/bin:/bin`, LUNCHBOX_PATH_ONLY: '1' },
  timeout: 30000,
})
const kill = setTimeout(() => { console.log('timed out'); app.close().finally(() => process.exit(1)) }, 90000)
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800))
const failed = []
const check = (what, ok) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) failed.push(what) }
const count = (sel) => page.locator(sel).count()
const frames = async (name, n = 4, gap = 45) => { for (let i = 0; i < n; i++) { await page.screenshot({ path: `${out}${name}-${i}.png` }); await page.waitForTimeout(gap) } }

await page.waitForSelector('.onboard')
for (let i = 0; i < 4; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(i ? 900 : 2600) }
await page.waitForSelector('.newroom')

await page.click('.sbitem >> text=Library')
await page.click('.cards .card >> nth=0')
await page.waitForSelector('.scrim.center [role=dialog]')
await page.waitForTimeout(400)
await page.click('.sheetcard button:has-text("Cancel")')
check('a sheet closed with the pointer leaves a copy behind', await count('.scrim.center.gone') === 1)
check('the copy cannot be used', await page.$eval('.scrim.center.gone', (el) => el.inert && getComputedStyle(el).pointerEvents === 'none'))
await frames('sheet')
await page.waitForTimeout(260)
check('the copy is gone when the exit ends', await count('.scrim.center') === 0)

await page.click('.cards .card >> nth=0')
await page.waitForSelector('.scrim.center [role=dialog]')
await page.waitForTimeout(300)
await page.keyboard.press('Escape')
check('Escape closes a sheet at once', await count('.scrim.center') === 0)

await page.click('.sbitem >> text=New room')
await page.click('[aria-label^="Mode:"]')
await page.waitForSelector('.menu')
await page.waitForTimeout(250)
await page.mouse.click(640, 700)
check('a menu closed with the pointer leaves a copy behind', await count('.menu.gone') === 1)
await frames('menu', 3, 40)
await page.waitForTimeout(220)
check('and it is gone after', await count('.menu') === 0)

await page.click('.sbitem >> text=Agents')
await page.click('.agenthead >> nth=0')
await page.waitForTimeout(500)
const openH = await page.$eval('.agent >> nth=0', (el) => el.getBoundingClientRect().height)
await page.click('.agenthead >> nth=0')
await page.waitForTimeout(70)
const midH = await page.$eval('.agent >> nth=0', (el) => el.getBoundingClientRect().height)
await frames('fold', 3, 50)
await page.waitForTimeout(300)
const shutH = await page.$eval('.agent >> nth=0', (el) => el.getBoundingClientRect().height)
check(`an agent's settings fold shut by height (${Math.round(openH)} > ${Math.round(midH)} > ${Math.round(shutH)})`, openH > midH && midH > shutH)

console.log('errors', errors.length ? errors.join('\n') : 'none')
clearTimeout(kill)
await app.close()
process.exit(failed.length || errors.length ? 1 : 0)
