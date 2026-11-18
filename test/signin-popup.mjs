import { _electron as electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// "Continue with Google" on Pinterest has to open Google's sign in popup with its opener intact.
// Google refuses a browser that hides being Electron, so the user agent must stay Electron's own.
// Needs the network. node test/signin-popup.mjs
const root = new URL('..', import.meta.url).pathname
const temp = (name) => mkdtempSync(join(tmpdir(), `lunchbox-${name}-`))
const app = await electron.launch({
  executablePath: createRequire(import.meta.url)('electron'),
  args: ['.', `--user-data-dir=${temp('profile')}`], cwd: root,
  env: { ...process.env, LB_FOLDER: 'shared', LB_PLAN_LIMITS: 'off', LB_WORKSPACE: temp('work') },
  timeout: 30000,
})
const kill = setTimeout(() => { console.log('timed out'); app.close().finally(() => process.exit(1)) }, 100000)
const page = await app.firstWindow()
await page.waitForSelector('.onboard')
for (let i = 0; i < 4; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(i ? 900 : 2600) }
await page.click('.sbitem >> text=Browser')
await page.waitForTimeout(800)
await page.evaluate(() => window.lb.call('browser:open', 'https://www.pinterest.com/login/'))
await page.waitForTimeout(9000)
const result = await app.evaluate(async ({ webContents, BrowserWindow }) => {
  const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('pinterest.com/login'))
  if (!wc) return { error: 'no pinterest page' }
  const fedcm = await wc.executeJavaScript('typeof IdentityCredential')
  const ua = await wc.executeJavaScript('navigator.userAgent')
  const box = await wc.executeJavaScript(`(() => { const b = [...document.querySelectorAll('button')].find((e) => /Continue with Google/.test(e.innerText)); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  if (!box) return { error: 'no Google button', fedcm }
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 })
  await new Promise((r) => setTimeout(r, 8000))
  const popup = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('accounts.google.com'))
  if (!popup) return { fedcm, popup: null, page: wc.getURL() }
  const shot = (await popup.webContents.capturePage()).toPNG().toString('base64')
  return { fedcm, ua, popupUa: await popup.webContents.executeJavaScript('navigator.userAgent'), popup: popup.webContents.getURL().slice(0, 90), opener: await popup.webContents.executeJavaScript('!!window.opener'), text: (await popup.webContents.executeJavaScript('document.body.innerText.slice(0, 120)')).replace(/\n+/g, ' | '), page: wc.getURL(), shot }
})
if (result.shot) { writeFileSync(root + 'test/shots/signin-popup.png', Buffer.from(result.shot, 'base64')); delete result.shot }
console.log(result)
clearTimeout(kill)
await app.close()
process.exit(result.popup && !result.popup.includes('/rejected') && result.opener && result.fedcm === 'undefined' && /Electron/.test(result.ua) && /Electron/.test(result.popupUa) ? 0 : 1)
