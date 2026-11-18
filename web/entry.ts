// The site runs Lunchbox one of two ways:
// - on its own, in this tab (web/local.ts), with API keys, or
// - connected to Lunchbox running in the person's Cloud Shell, with Claude Code and their
//   subscription. ./lunchbox prints a link to this site with the address and a key after the #.
//   The part after # never leaves the browser, so the key is not sent to GitHub.
const hash = new URLSearchParams(location.hash.slice(1))
if (hash.has('connect')) {
  sessionStorage.setItem('lb-connect', JSON.stringify({ base: hash.get('connect'), key: hash.get('key') ?? '' }))
  history.replaceState(null, '', location.pathname + location.search)
}
if (hash.has('local')) sessionStorage.removeItem('lb-connect')

const fail = (e: unknown) => {
  console.error(e)
  const el = document.getElementById('lb-boot')
  if (el) el.textContent = `Lunchbox could not start: ${(e as Error).message}`
}

const saved = sessionStorage.getItem('lb-connect')
if (saved) {
  const { base, key } = JSON.parse(saved) as { base: string; key: string }
  const boot = document.getElementById('lb-boot')
  if (boot) boot.textContent = 'Connecting to your Lunchbox in Cloud Shell…'
  import('../server/ui/bridge')
    .then(({ startBridge }) => startBridge({ base, key }))
    .then(() => import('../src/main'))
    .then(() => document.getElementById('lb-boot')?.remove())
    .catch(fail)
} else {
  import('./local').then(({ boot }) => boot()).catch(fail)
}
