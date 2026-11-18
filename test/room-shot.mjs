import { _electron as electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Code coloured by the theme, find in a room, quoting a selection, a draft that outlives a
// restart, and an agent started from another's command line shown in the room.
// node test/room-shot.mjs   (npm run build first)
const root = new URL('..', import.meta.url).pathname
const out = root + 'test/shots/room-'
mkdirSync(root + 'test/shots', { recursive: true })
const made = []
const temp = (name) => { const dir = mkdtempSync(join(tmpdir(), `lunchbox-${name}-`)); made.push(dir); return dir }
const bin = temp('bin')
const profile = temp('profile')
chmodSync(root + 'test/fake-agent.mjs', 0o755)
for (const name of ['claude', 'grok']) symlinkSync(root + 'test/fake-agent.mjs', `${bin}/${name}`)
const launch = () => electron.launch({
  executablePath: createRequire(import.meta.url)('electron'),
  args: ['.', `--user-data-dir=${profile}`], cwd: root,
  env: { ...process.env, LB_FOLDER: 'shared', LB_PLAN_LIMITS: 'off', LB_WORKSPACE: temp('work'), LUNCHBOX_PATH: `${bin}:${process.execPath.replace(/\/[^/]+$/, '')}:/usr/bin:/bin`, LUNCHBOX_PATH_ONLY: '1', FAKE_SCRIPT: 'code' },
  timeout: 30000,
})
let app = await launch()
const kill = setTimeout(() => { console.log('timed out'); app.close().finally(() => process.exit(1)) }, 280000)
let page = await app.firstWindow()
const errors = []
const watch = (p) => { p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) }) }
watch(page)
const size = (w, h) => app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), [w, h])
await size(1280, 900)
const shot = async (name, wait = 500, sel = '.convo') => { await page.waitForTimeout(wait); await page.locator(sel).first().screenshot({ path: out + name + '.png' }) }
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const look = async (theme, mode) => {
  await page.evaluate(([t, m]) => { localStorage.setItem('lb.palette', JSON.stringify(t)); localStorage.setItem('lb.theme', JSON.stringify(m)) }, [theme, mode])
  await page.reload()
  await page.waitForSelector('.sbroom')
  await page.click('.sbroom >> nth=0')
  await page.waitForSelector('.codeblock .k')
  const on = await page.evaluate(() => `${document.documentElement.dataset.palette ?? 'lunchbox'} ${document.documentElement.dataset.theme}`)
  if (on !== `${theme} ${mode}`) errors.push(`asked for ${theme} ${mode}, got ${on}`)
}

try {
  await page.waitForSelector('.onboard')
  for (let i = 0; i < 4; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(i ? 900 : 2600) }
  await page.waitForSelector('.newroom')
  const long = ['Fix the date parser.', '', ...Array.from({ length: 22 }, (_, i) => `Line ${i + 1} of the brief.`), 'The needle is down here, in the folded part.'].join('\n')
  await page.fill('.composer textarea', long)
  await page.keyboard.press('Enter')
  await page.waitForSelector('.room .codeblock .k', { timeout: 30000 })
  await page.waitForTimeout(1500)

  // Copy gives the code as it was written, colours or not.
  const copied = await page.evaluate(async () => {
    const wrap = document.querySelector('.codewrap')
    wrap.querySelector('.codecopy').click()
    await new Promise((r) => setTimeout(r, 200))
    return { clip: await navigator.clipboard.readText().catch(() => null), text: wrap.querySelector('pre').textContent }
  })
  if (copied.clip !== null && copied.clip !== copied.text) errors.push('the copied code differs from the code shown')
  if (!copied.text.includes("locale = 'en-GB'")) errors.push('the code text changed')
  const roles = await page.$$eval('.codeblock span', (list) => [...new Set(list.map((s) => s.className))].sort().join(''))
  if (roles !== 'ckns') errors.push(`expected four roles in code, got "${roles}"`)
  // Contrast of each role against the code block, in every look that is shot.
  const contrast = () => page.evaluate(() => {
    const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    const rgb = (css, under) => { cv.canvas.width = cv.canvas.height = 1; cv.fillStyle = under ?? '#000'; cv.fillRect(0, 0, 1, 1); cv.fillStyle = css; cv.fillRect(0, 0, 1, 1); return [...cv.getImageData(0, 0, 1, 1).data].slice(0, 3) }
    const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
    const pre = document.querySelector('.codeblock')
    const sheet = rgb(getComputedStyle(document.querySelector('.sheet') ?? document.body).backgroundColor)
    const bg = rgb(getComputedStyle(pre).backgroundColor, `rgb(${sheet})`)
    const hex = `rgb(${bg})`
    const of = (el) => { const c = rgb(getComputedStyle(el).color, hex); const a = lum(c), b = lum(bg); return +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2) }
    return { text: of(pre), k: of(pre.querySelector('.k')), s: of(pre.querySelector('.s')), n: of(pre.querySelector('.n')), c: of(pre.querySelector('.c')) }
  })
  const check = async (label) => {
    const c = await contrast()
    console.log(label.padEnd(16), JSON.stringify(c))
    for (const k of ['text', 'k', 's', 'n']) if (c[k] < 4.5) errors.push(`${label}: ${k} is ${c[k]} on the code block`)
    if (c.c < 3) errors.push(`${label}: comments are ${c.c} on the code block`)
  }
  await check('lunchbox night')
  await shot('01-code-lunchbox-night')

  // One copy button on every block, a prompt as much as code. A prompt reads as text: it wraps,
  // it is not coloured, and what is copied is exactly what was written.
  const copyShots = async (tag) => {
    for (const [name, sel] of [['code', '.codewrap:not(.prose) >> nth=0'], ['prompt', '.codewrap.prose']]) {
      const wrap = page.locator(sel).first()
      await wrap.scrollIntoViewIfNeeded()
      await wrap.hover()
      await page.waitForTimeout(600)
      await page.screenshot({ path: `${out}08-copy-${name}-${tag}.png`, clip: await wrap.boundingBox() })
      await page.waitForTimeout(1600)
      await wrap.locator('.codecopy').click()
      await page.waitForTimeout(110)
      await page.screenshot({ path: `${out}08-copy-${name}-${tag}-mid.png`, clip: await wrap.boundingBox() })
      await page.waitForTimeout(300)
      if ((await wrap.locator('.codecopy .word').textContent()) !== 'Copied') errors.push(`${name}: the button did not say Copied`)
      await page.screenshot({ path: `${out}08-copy-${name}-${tag}-copied.png`, clip: await wrap.boundingBox() })
      const same = await wrap.evaluate(async (el) => (await navigator.clipboard.readText().catch(() => null)) === el.querySelector('pre').textContent)
      if (!same) errors.push(`${name}: the clipboard does not hold the block as written`)
      await page.waitForTimeout(1500)
      if ((await wrap.locator('.codecopy .word').textContent()) !== 'Copy') errors.push(`${name}: the button did not settle back`)
    }
  }
  const prose = await page.$eval('.codewrap.prose', (el) => ({ spans: el.querySelectorAll('pre span').length, wide: el.querySelector('pre').scrollWidth - el.querySelector('pre').clientWidth, lines: Math.round(el.querySelector('pre').clientHeight / 21), label: el.dataset.lang ?? '' }))
  if (prose.spans || prose.wide > 1 || prose.lines < 4 || prose.label) errors.push(`the prompt block is not clean wrapped text: ${JSON.stringify(prose)}`)
  if ((await page.$$('.codewrap .codecopy')).length !== (await page.$$('.codewrap')).length) errors.push('a block has no copy button')
  // The keyboard reaches the button, and it shows when it has the focus.
  await page.focus('.codewrap.prose .codecopy')
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  if (!(await page.evaluate(() => document.activeElement?.matches('.codewrap.prose .codecopy')))) errors.push('Tab does not reach the copy button')
  await page.waitForTimeout(300)
  if ((await page.$eval('.codewrap.prose .codecopy', (b) => getComputedStyle(b).opacity)) !== '1') errors.push('the copy button stays hidden with the keyboard on it')
  await page.evaluate(() => document.activeElement?.blur())
  await copyShots('night')

  // Find: every match marked, the count, next and previous, and a match inside a folded message.
  await page.keyboard.press(`${mod}+f`)
  await page.waitForSelector('.find input')
  await page.keyboard.type('parser')
  await page.waitForTimeout(400)
  if (await page.$('.folded.open')) errors.push('a match in the part of a folded message that shows opened it')
  const count = () => page.$eval('.find .count', (el) => el.textContent)
  const inView = () => page.evaluate(() => { const r = [...CSS.highlights.get('lb-find-at')][0].getBoundingClientRect(), f = document.querySelector('.transcript').getBoundingClientRect(); return r.top > f.top && r.bottom < f.bottom })
  if (!(await inView())) errors.push('typing in find did not bring a match into view')
  const total = Number((await count()).split(' of ')[1])
  if (!(total >= 6)) errors.push(`find counted "${await count()}"`)
  const marks = await page.evaluate(() => [CSS.highlights.get('lb-find')?.size ?? 0, CSS.highlights.get('lb-find-at')?.size ?? 0])
  if (marks[0] !== total || marks[1] !== 1) errors.push(`find marked ${marks} of ${total}`)
  const before = await count()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(500)
  const after = await count()
  const moved = (Number(after.split(' of ')[0]) - Number(before.split(' of ')[0]) + total) % total
  if (moved !== 2) errors.push(`find moved from "${before}" to "${after}"`)
  await shot('02-find-night', 500)
  await page.fill('.find input', 'needle')
  await page.waitForTimeout(600)
  if ((await count()) !== '1 of 1') errors.push(`the folded match counted "${await count()}"`)
  if (await page.$('.folded:not(.open)')) errors.push('a match in the folded part did not open the message')
  if (!(await page.$('.folded.open'))) errors.push('a match in a folded message did not open it')
  await shot('03-find-folded', 600)
  await page.fill('.find input', 'zzzz')
  await page.waitForTimeout(300)
  if ((await count()) !== 'No matches') errors.push(`nothing to find said "${await count()}"`)
  await page.keyboard.press('Escape')
  if (await page.$('.find')) errors.push('Escape left find open')
  if (await page.evaluate(() => CSS.highlights.size)) errors.push('closing find left marks behind')
  await page.click('.unfoldbtn')

  // Quote: select words in the reply, press the button, send, and the room draws a quote.
  const select = (sel, a, b) => page.evaluate(([sel, a, b]) => {
    const p = [...document.querySelectorAll(sel)].find((el) => el.textContent.includes(a))
    const node = [...p.childNodes].find((n) => n.nodeType === 3 && n.data.includes(a))
    const r = document.createRange()
    r.setStart(node, node.data.indexOf(a))
    r.setEnd(node, node.data.indexOf(b) + b.length)
    const s = getSelection()
    s.removeAllRanges()
    s.addRange(r)
    p.scrollIntoView({ block: 'center' })
    dispatchEvent(new MouseEvent('mouseup'))
  }, [sel, a, b])
  await select('.turn .rich p', 'The parser now takes', 'from the form.')
  await page.waitForSelector('.quotebtn')
  await page.waitForTimeout(600)
  const off = await page.evaluate(() => { const b = document.querySelector('.quotebtn').getBoundingClientRect(), s = getSelection().getRangeAt(0).getBoundingClientRect(); return Math.round(s.top - b.bottom) })
  if (off < 0 || off > 12) errors.push(`the Quote button sits ${off}px from the selection`)
  await shot('04-quote-button', 100)
  await page.click('.quotebtn')
  const box = await page.$eval('.composer textarea', (t) => t.value)
  if (box !== '> Claude said:\n> The parser now takes the locale from the form.\n\n') errors.push(`quote put "${box}" in the message box`)
  if (!(await page.evaluate(() => document.activeElement?.tagName === 'TEXTAREA'))) errors.push('quoting did not put the caret in the message box')
  await page.keyboard.type('What if the form sends none?')
  await shot('05-quote-composer', 300)
  await page.keyboard.press('Enter')
  await page.waitForSelector('.mine blockquote cite', { timeout: 20000 })
  await page.waitForFunction(() => document.querySelectorAll('.turn').length >= 2 && !document.querySelector('.turn.live'), null, { timeout: 20000 })
  const mine = await page.$eval('.mine:last-of-type .bubble, .mine >> nth=-1', (el) => el.textContent).catch(() => page.$$eval('.mine .bubble', (l) => l[l.length - 1].textContent))
  if (/>/.test(mine)) errors.push(`a raw > shows in the sent quote: "${mine}"`)
  await page.waitForTimeout(1500)
  const gap = await page.$eval('.transcript', (el) => el.scrollHeight - el.clientHeight - el.scrollTop)
  if (gap > 80) errors.push(`sending from far up left the view ${Math.round(gap)}px above the new message`)
  await shot('06-quote-sent', 900)
  // The keyboard does the same, and words across two messages are not offered as one quote.
  await select('.turn .rich p', 'Yes. The parser', 'en-GB')
  await page.waitForSelector('.quotebtn')
  await page.evaluate(() => document.activeElement?.blur())
  await page.keyboard.press('q')
  const typed = await page.$eval('.composer textarea', (t) => t.value)
  if (!typed.startsWith('> Claude said:\n> Yes. The parser falls back to en-GB')) errors.push(`Q put "${typed}" in the message box`)

  // The draft is left in the box, and the app is closed and opened again.
  await page.fill('.composer textarea', 'a draft that should survive')
  await page.waitForTimeout(300)
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  watch(page)
  await size(1280, 900)
  await page.waitForSelector('.sbroom')
  await page.click('.sbroom >> nth=0')
  await page.waitForSelector('.composer textarea')
  const kept = await page.$eval('.composer textarea', (t) => t.value)
  if (kept !== 'a draft that should survive') errors.push(`the draft after a restart was "${kept}"`)
  await page.fill('.composer textarea', '')
  await page.focus('.composer textarea')
  await page.keyboard.press('ArrowUp')
  const recalled = await page.$eval('.composer textarea', (t) => t.value)
  if (!recalled.endsWith('What if the form sends none?')) errors.push(`the up arrow after a restart gave "${recalled}"`)
  await page.fill('.composer textarea', '')

  // An agent with no hook starts another by its full path: the room shows it, marked.
  await page.fill('.composer textarea', `@grok Get a second opinion.\nShell: ${bin}/claude -p --output-format text "review this plan"`)
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => [...document.querySelectorAll('.hands .tag')].some((t) => t.textContent === 'outside the room'), null, { timeout: 30000 })
  await page.waitForFunction(() => !document.querySelector('.turn.live'), null, { timeout: 20000 })
  await shot('07-outside-night', 1200)
  // And Claude Code, asked to do the same, is turned down before the command runs.
  await page.fill('.composer textarea', 'Check this with Grok.\nShell: grok -p "what do people say"')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelectorAll('.mine').length >= 4 && !document.querySelector('.turn.live'), null, { timeout: 30000 })
  await page.waitForTimeout(800)
  if ((await page.$$('.hands')).length !== 1) errors.push('a command the hook turned down still showed as a handoff')

  for (const [theme, mode] of [['lunchbox', 'light'], ['lagoon', 'dark'], ['cobalt', 'dark'], ['cobalt', 'light'], ['koi', 'dark'], ['dusk', 'dark'], ['meadow', 'light'], ['glacier', 'light'], ['lagoon', 'light'], ['glacier', 'dark'], ['meadow', 'dark'], ['dusk', 'light'], ['koi', 'light']]) {
    await look(theme, mode)
    await page.$eval('.transcript', (el) => { el.scrollTop = 0 })
    await check(`${theme} ${mode === 'dark' ? 'night' : 'day'}`)
    await shot(`10-code-${theme}-${mode === 'dark' ? 'night' : 'day'}`, 500)
  }
  await look('cobalt', 'light')
  await copyShots('day')
  await page.$eval('.transcript', (el) => { el.scrollTop = el.scrollHeight })
  await page.keyboard.press(`${mod}+f`)
  await page.keyboard.type('parser')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
  const seen = await page.evaluate(() => { const r = [...CSS.highlights.get('lb-find-at')][0].getBoundingClientRect(), f = document.querySelector('.transcript').getBoundingClientRect(); return r.top > f.top && r.bottom < f.bottom })
  if (!seen) errors.push('the match find stepped to is not in view')
  await shot('11-find-cobalt-day', 300)
  await page.keyboard.press('Escape')
  await page.$eval('.transcript', (el) => { el.scrollTop = el.scrollHeight })
  await shot('12-quote-outside-cobalt-day', 700)
} catch (e) { errors.push(String(e)) }
console.log('errors', errors.length ? errors.join('\n') : 'none')
if (errors.length) process.exitCode = 1
clearTimeout(kill)
await app.close()
// The folders this run made, for whoever cleans up after it.
console.log('made', made.join(' '))
