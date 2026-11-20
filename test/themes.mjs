import { _electron as electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Every theme on the first run, at home, in a room and in Settings, with the time each switch
// takes and any error the window logs. node test/themes.mjs [theme ...]   (npm run build first)
// REACH=quiet or REACH=rich shoots that setting of Theme colour into theme-<reach>-*.
const root = new URL('..', import.meta.url).pathname
const reach = process.env.REACH
const out = root + 'test/shots/theme-' + (reach ? reach + '-' : '')
mkdirSync(root + 'test/shots', { recursive: true })
const temp = (name) => mkdtempSync(join(tmpdir(), `lunchbox-${name}-`))
const bin = temp('bin')
const work = temp('work')
writeFileSync(join(work, 'notes.md'), '# Agent limits\n\nEvery plan has a cap.\n')
chmodSync(root + 'test/fake-agent.mjs', 0o755)
for (const name of ['claude', 'codex', 'grok']) symlinkSync(root + 'test/fake-agent.mjs', `${bin}/${name}`)
const only = process.argv.slice(2)

const app = await electron.launch({
  executablePath: createRequire(import.meta.url)('electron'),
  args: ['.', `--user-data-dir=${temp('profile')}`], cwd: root,
  env: { ...process.env, LB_FOLDER: 'shared', LB_PLAN_LIMITS: 'off', LB_WORKSPACE: work, LUNCHBOX_PATH: `${bin}:${process.execPath.replace(/\/[^/]+$/, '')}:/usr/bin:/bin`, LUNCHBOX_PATH_ONLY: '1', FAKE_DELAY: '20' },
  timeout: 30000,
})
const kill = setTimeout(() => { console.log('timed out'); app.close().finally(() => process.exit(1)) }, 420000)
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
const shot = async (name, wait = 700) => { await page.waitForTimeout(wait); await page.screenshot({ path: out + name + '.png' }) }

await page.waitForSelector('.onboard')
for (let i = 0; i < 4; i++) {
  if (await page.$('.obpage .themes')) await shot('00-onboard', 500)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(i ? 900 : 2600)
}
await page.waitForSelector('.newroom')
await page.click('.composer textarea')
await page.keyboard.type('Write a short note on agent limits')
await page.keyboard.press('Enter')
await page.waitForSelector('.room')
await page.waitForSelector('.decide', { timeout: 30000 }).catch(() => {})
await page.waitForTimeout(800)
const room = await page.$eval('.sbroom', (el) => el.textContent)

const themes = await page.evaluate(() => [...document.querySelectorAll('.themecard')].length) || 7
const ids = ['lunchbox', 'lagoon', 'cobalt', 'meadow', 'dusk', 'glacier', 'koi'].filter((t) => !only.length || only.includes(t))
const pick = (selector, name) => page.evaluate(([sel, n]) => {
  const el = [...document.querySelectorAll(sel)].find((c) => c.textContent?.trim().toLowerCase().startsWith(n))
  el?.click()
  return !!el
}, [selector, name])
for (const mode of ['night', 'day']) {
  await page.click('.sbitem >> text=Settings')
  await page.waitForSelector('.themecard')
  if (reach) await pick('[aria-label="Theme colour"] button', reach)
  await pick('.seg button', mode)
  await shot(`cards-${mode}`, 900)
  for (const id of ids) {
    await page.click('.sbitem >> text=Settings')
    await page.waitForSelector('.themecard')
    await pick('.themecard', id)
    // The switch runs inside a view transition, so the root changes a moment after the click.
    await page.waitForTimeout(600)
    const { palette, theme } = await page.evaluate(() => ({ palette: document.documentElement.dataset.palette ?? '', theme: document.documentElement.dataset.theme }))
    console.log(`${id} ${mode}: mode ${theme}, palette ${palette || '(lunchbox)'}`)
    await page.evaluate(() => document.querySelector('.page')?.scrollTo(0, 99999))
    await shot(`${id}-${mode}-settings`, 500)
    await page.click('.sbitem >> text=New room')
    await shot(`${id}-${mode}-home`, 1300)
    await page.click('[aria-label^="Mode:"]')
    await shot(`${id}-${mode}-modes`, 400)
    await page.click('.menu .item:has-text("Full access")')
    await page.click('.composer textarea')
    await shot(`${id}-${mode}-full`, 400)
    await page.click('[aria-label^="Mode:"]')
    await page.click('.menu .item:has-text("Auto")')
    await page.click(`.sbroom >> text=${room.trim().slice(0, 20)}`)
    await shot(`${id}-${mode}-room`, 1000)
  }
}
console.log(themes, 'cards;', errors.length ? `errors:\n${errors.join('\n')}` : 'no errors')
clearTimeout(kill)
await app.close()
