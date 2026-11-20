import { _electron as electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

// Slash commands in the box: Lunchbox's own run at once, an agent's command is sent as what it
// stands for, and the menu finds both. node test/commands-shot.mjs
const root = new URL('..', import.meta.url).pathname
const out = root + 'test/shots/commands-'
mkdirSync(root + 'test/shots', { recursive: true })
const temp = (name) => mkdtempSync(join(tmpdir(), `lunchbox-${name}-`))
const bin = temp('bin')
const work = temp('work')
const home = temp('home')
const put = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) }
put(join(home, '.claude', 'commands', 'review.md'), '---\ndescription: Review the diff for bugs\n---\nReview $ARGUMENTS for bugs, worst first.\n')
put(join(home, '.claude', 'skills', 'loop', 'SKILL.md'), '---\nname: loop\ndescription: Run a prompt on an interval\n---\nRepeat the task.\n')
put(join(home, '.gemini', 'commands', 'git', 'commit.toml'), 'description = "Write a commit message"\nprompt = """Write a commit message for {{args}}."""\n')
chmodSync(root + 'test/fake-agent.mjs', 0o755)
for (const name of ['claude', 'codex']) symlinkSync(root + 'test/fake-agent.mjs', `${bin}/${name}`)
const failures = []
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }

const app = await electron.launch({
  executablePath: createRequire(import.meta.url)('electron'),
  args: ['.', `--user-data-dir=${temp('profile')}`], cwd: root,
  env: { ...process.env, LB_FOLDER: 'shared', LB_PLAN_LIMITS: 'off', LB_WORKSPACE: work, LB_COMMANDS_HOME: home, LB_REPORT_ENDPOINT: 'http://127.0.0.1:9/report', LUNCHBOX_PATH: `${bin}:${process.execPath.replace(/\/[^/]+$/, '')}:/usr/bin:/bin`, LUNCHBOX_PATH_ONLY: '1', FAKE_DELAY: '20' },
  timeout: 30000,
})
const kill = setTimeout(() => { console.log('timed out'); app.close().finally(() => process.exit(1)) }, 110000)
const page = await app.firstWindow()
page.on('pageerror', (e) => failures.push(`page error: ${e}`))
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
await page.waitForSelector('.onboard')
for (let i = 0; i < 4; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(i ? 900 : 2600) }
await page.waitForSelector('.newroom')

const box = '.composer textarea'
const menu = async () => page.$$eval('.suggest [role="option"]', (els) => els.map((e) => e.textContent ?? ''))
await page.click(box)
await page.keyboard.type('/')
await page.waitForSelector('.suggest')
let rows = await menu()
check(rows.some((r) => r.includes('/plan')) && rows.some((r) => r.includes('/review')), `the menu lists Lunchbox's and the agents' commands (${rows.length} rows)`)
await page.screenshot({ path: out + '01-menu.png' })

await page.keyboard.type('git:')
rows = await menu()
check(rows.length === 1 && rows[0].includes('/git:commit'), 'a namespaced command stays findable after the colon')
await page.fill(box, '')

await page.keyboard.type('/pla')
await page.keyboard.press('Enter')
await page.waitForTimeout(300)
check(await page.isVisible('[aria-label="Mode: Plan"]'), '/plan switches the mode at once')
check((await page.inputValue(box)) === '', 'and leaves the box empty')

await page.keyboard.type('/auto')
await page.keyboard.press('Enter')
await page.waitForTimeout(300)
check(await page.isVisible('[aria-label="Mode: Auto"]'), '/auto typed in full switches back')

await page.keyboard.type('/review')
await page.keyboard.press('Enter')
check((await page.inputValue(box)) === '/review ', 'Enter on a command puts it in the box, ready for arguments')
await page.keyboard.type('src/app.ts')
await page.keyboard.press('Enter')
await page.keyboard.press('Enter')
await page.waitForSelector('.room .mine .bubble', { timeout: 20000 })
await page.waitForTimeout(800)
const sent = await page.$$eval('.room .mine .bubble', (els) => els.map((e) => e.textContent ?? ''))
check(sent.length === 1, `one message was sent, however fast Enter was pressed (${sent.length})`)
check(/\/review src\/app\.ts/.test(sent[0] ?? '') && /Review src\/app\.ts for bugs, worst first\./.test(sent[0] ?? ''), 'the command arrives as what it stands for, filled in')
await page.screenshot({ path: out + '02-sent.png' })

await page.click(box)
await page.keyboard.type('/nothing-like-this hello')
await page.keyboard.press('Enter')
await page.waitForTimeout(1200)
const last = await page.$$eval('.room .mine .bubble', (els) => els.at(-1)?.textContent ?? '')
check(last.includes('/nothing-like-this hello'), 'an unknown command goes as typed')

clearTimeout(kill)
await app.close()
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed')
process.exit(failures.length ? 1 : 0)
