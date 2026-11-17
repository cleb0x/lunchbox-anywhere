import { _electron as electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Making a theme by hand and with an agent, start to finish. node test/theme-make.mjs (npm run build first)
const root = new URL('..', import.meta.url).pathname
const out = root + 'test/shots/make-'
mkdirSync(root + 'test/shots', { recursive: true })
const temp = (name) => mkdtempSync(join(tmpdir(), `lunchbox-${name}-`))
const bin = temp('bin')
chmodSync(root + 'test/fake-agent.mjs', 0o755)
for (const name of ['claude', 'codex']) symlinkSync(root + 'test/fake-agent.mjs', `${bin}/${name}`)
const app = await electron.launch({
  executablePath: createRequire(import.meta.url)('electron'),
  args: ['.', `--user-data-dir=${temp('profile')}`], cwd: root,
  env: { ...process.env, LB_FOLDER: 'shared', LB_PLAN_LIMITS: 'off', LB_WORKSPACE: temp('work'), LUNCHBOX_PATH: `${bin}:${process.execPath.replace(/\/[^/]+$/, '')}:/usr/bin:/bin`, LUNCHBOX_PATH_ONLY: '1', FAKE_SCRIPT: 'theme' },
  timeout: 30000,
})
const kill = setTimeout(() => { console.log('timed out'); app.close().finally(() => process.exit(1)) }, 110000)
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
const shot = async (name, wait = 700) => { await page.waitForTimeout(wait); await page.screenshot({ path: out + name + '.png' }) }
const colour = (label, value) => page.evaluate(([name, v]) => {
  const input = [...document.querySelectorAll('.themeedit .swatch')].find((s) => s.querySelector('b')?.textContent === name).querySelector('input')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, v)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}, [label, value])

await page.waitForSelector('.onboard')
for (let i = 0; i < 4; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(i ? 900 : 2600) }
await page.waitForSelector('.newroom')
await page.click('.sbitem >> text=Settings')
await page.waitForSelector('.themefoot')
await shot('01-settings', 600)
await page.click('.themefoot >> text=New theme')
await page.waitForSelector('.themeedit')
await shot('02-editor', 700)
// An accent nearly the colour of the sheet: the editor must say it moved it.
await colour('Accent', '#1a1c1e')
await page.fill('.themeedit .tfield input:not([type])', 'Night shift')
await shot('03-editor-fixed', 600)
console.log('fixed notes:', await page.$$eval('.tfixed li', (l) => l.map((x) => x.textContent)))
await page.click('.themeedit footer .btn:not(.quiet)')
await shot('04-saved', 900)
await page.click('.themecard >> text=Cobalt')
await shot('04b-cobalt', 1200)
await page.click('.seg button >> text=Day')
await shot('04c-cobalt-day', 1200)
await page.click('.seg button >> text=Night')
console.log('custom card:', await page.$$eval('.themeslot .themecard b', (b) => b.map((x) => x.textContent).slice(-1)))

// Fine tune on Lunchbox's own theme: the text alone, then the selected colour, then one reset.
await page.click('.themecard >> text=Lunchbox')
await page.waitForTimeout(800)
await page.click('.setting >> text=Customise')
await page.waitForSelector('.tunesheet')
const tune = (name, value) => page.evaluate(([n, v]) => {
  const input = [...document.querySelectorAll('.tunerow')].find((r) => r.querySelector('b')?.textContent === n).querySelector('input')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, v)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}, [name, value])
await tune('Text', '#ffc9d6')
await tune('Selected', '#ff7aa2')
await shot('07-tune', 900)
const painted = () => page.evaluate(() => { const s = document.documentElement.style; return { ink: s.getPropertyValue('--ink'), dim: s.getPropertyValue('--dim'), block: s.getPropertyValue('--block'), onBlock: s.getPropertyValue('--on-block'), palette: document.documentElement.dataset.palette ?? '' } })
console.log('tuned:', await painted())
await page.click('.tunerow.set >> nth=0 >> text=Reset')
await page.waitForTimeout(400)
console.log('after reset:', await painted())
await page.keyboard.press('Escape')
await shot('08-tuned-settings', 900)

await page.click('.themefoot >> text=Make one with an agent')
await page.waitForSelector('.themeoffer', { timeout: 30000 })
await shot('05-offer', 900)
await page.click('.themeoffer >> text=Use this theme')
await shot('06-used', 1200)
console.log('in use:', await page.evaluate(() => document.documentElement.dataset.palette))
await page.click('.themeoffer >> text=Fine tune it')
await page.waitForSelector('.themeedit', { timeout: 5000 })
console.log('editor opened on:', await page.$eval('.themeedit .tfield input:not([type])', (i) => i.value))
await shot('09-fine-tune-it', 900)
console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'no errors')
clearTimeout(kill)
await app.close()
