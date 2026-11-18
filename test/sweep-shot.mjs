import { _electron as electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A reply with every kind of block, a long message that folds, the model menu with one agent, and
// the smallest window, by night and by day. node test/sweep-shot.mjs (npm run build first)
const root = new URL('..', import.meta.url).pathname
const out = root + 'test/shots/sweep-'
mkdirSync(root + 'test/shots', { recursive: true })
const temp = (name) => mkdtempSync(join(tmpdir(), `lunchbox-${name}-`))
const bin = temp('bin')
chmodSync(root + 'test/fake-agent.mjs', 0o755)
symlinkSync(root + 'test/fake-agent.mjs', `${bin}/claude`)
const app = await electron.launch({
  executablePath: createRequire(import.meta.url)('electron'),
  args: ['.', `--user-data-dir=${temp('profile')}`], cwd: root,
  env: { ...process.env, LB_FOLDER: 'shared', LB_PLAN_LIMITS: 'off', LB_WORKSPACE: temp('work'), LUNCHBOX_PATH: `${bin}:${process.execPath.replace(/\/[^/]+$/, '')}:/usr/bin:/bin`, LUNCHBOX_PATH_ONLY: '1', FAKE_SCRIPT: 'rich' },
  timeout: 30000,
})
const kill = setTimeout(() => { console.log('timed out'); app.close().finally(() => process.exit(1)) }, 110000)
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
const size = (w, h) => app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), [w, h])
await size(1440, 900)
const shot = async (name, wait = 700) => { await page.waitForTimeout(wait); await page.screenshot({ path: out + name + '.png' }) }

try {
  await page.waitForSelector('.onboard')
  for (let i = 0; i < 4; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(i ? 900 : 2600) }
  await page.waitForSelector('.newroom')
  // One agent: the crew menu opens straight on its models, and Escape closes it.
  await page.click('.composer .menuwrap .pill >> nth=0')
  await page.waitForSelector('.modelset')
  await shot('01-one-agent-models', 500)
  await page.keyboard.press('Escape')
  if (await page.$('.modelset')) errors.push('Escape left the model menu open')

  const long = ['Compare the three agents for me.', '', ...Array.from({ length: 24 }, (_, i) => `Line ${i + 1} of a long brief that should fold away behind one button.`)].join('\n')
  await page.fill('.composer textarea', long)
  await page.keyboard.press('Enter')
  await page.waitForSelector('.room .rich table', { timeout: 30000 })
  await shot('02-rich-night', 1500)
  const junk = await page.$eval('.transcript', (el) => /\x1b|<\|im_end\|>|\[32m/.test(el.textContent ?? ''))
  if (junk) errors.push('terminal codes or template tokens reached the transcript')
  const wide = await page.$eval('.transcript', (el) => el.scrollWidth - el.clientWidth)
  if (wide > 1) errors.push(`the transcript scrolls sideways by ${wide}px`)
  if (!(await page.$('.folded'))) errors.push('the long message did not fold')
  await page.hover('.codewrap >> nth=0')
  await shot('03-code-copy', 300)
  await page.click('.unfoldbtn')
  await shot('04-unfolded', 500)
  await page.click('.unfoldbtn')

  // The draft of a room is still there after going away and coming back.
  await page.fill('.composer textarea', 'half a thought')
  await page.click('.sbitem >> text=Pool')
  await page.click('.sbroom >> nth=0')
  await page.waitForSelector('.composer textarea')
  const kept = await page.$eval('.composer textarea', (t) => t.value)
  if (kept !== 'half a thought') errors.push(`draft lost: "${kept}"`)
  await page.fill('.composer textarea', '')

  await size(960, 640)
  await shot('05-small-room', 900)
  for (const name of ['Pool', 'Savings', 'Library', 'Flows', 'Agents', 'Settings']) {
    await page.click(`.sbitem >> text=${name}`)
    await shot(`06-small-${name.toLowerCase()}`, 800)
    const over = await page.evaluate(() => { const p = document.querySelector('.sheet .page') ?? document.querySelector('.sheet'); return p ? p.scrollWidth - p.clientWidth : 0 })
    if (over > 1) errors.push(`${name} scrolls sideways by ${over}px at the smallest window`)
  }
  await size(1440, 900)
  await page.click('.sbitem >> text=Settings')
  await page.click('.seg button:has-text("Day")')
  await page.click('.sbroom >> nth=0')
  await shot('07-rich-day', 1400)
  await page.click('.composer .menuwrap .pill >> nth=0')
  await shot('08-menu-day', 500)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Meta+k')
  await shot('09-palette-day', 700)
  await page.keyboard.press('Escape')
} catch (e) { errors.push(String(e)) }
console.log('errors', errors.length ? errors.join('\n') : 'none')
if (errors.length) process.exitCode = 1
clearTimeout(kill)
await app.close()
