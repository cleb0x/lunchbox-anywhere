// Starting Lunchbox in the person's own Cloud Shell from the website. A website cannot run
// anything in Cloud Shell; it opens it, and Lunchbox starts there by itself (the launcher sets
// that up the first time) and prints the link that connects this site to it.
const REPO = 'https://github.com/cleb0x/lunchbox-anywhere'
const SEEN = 'lb-cloudshell-used'
const HIDE = 'lb-cloudshell-hide'

const store = { get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch {} } }

export const markUsed = () => store.set(SEEN, '1')

// The first time: clone the project with the guide open. After that: just the terminal, where
// Lunchbox starts by itself.
export const startLink = () => store.get(SEEN)
  ? 'https://shell.cloud.google.com/?show=ide%2Cterminal'
  : `https://shell.cloud.google.com/cloudshell/editor?cloudshell_git_repo=${encodeURIComponent(REPO)}&cloudshell_git_branch=main&cloudshell_tutorial=cloudshell.md`

const css = 'position:fixed;z-index:9999;display:flex;gap:10px;align-items:center;padding:8px 8px 8px 14px;border-radius:10px;background:#1b1a18;color:#f2f0ea;font:12px "IBM Plex Mono",ui-monospace,monospace;box-shadow:0 8px 30px rgba(0,0,0,.35)'
const button = (text: string, primary: boolean) => {
  const b = document.createElement(primary ? 'a' : 'button') as HTMLAnchorElement
  b.textContent = text
  b.style.cssText = `font:inherit;padding:5px 12px;border-radius:7px;border:0;cursor:pointer;text-decoration:none;background:${primary ? '#f2f0ea' : 'transparent'};color:${primary ? '#0d0d0c' : '#a8a59d'}`
  return b
}

// A small offer on the site running on its own: the same Lunchbox with Claude Code and a Claude
// subscription, in Cloud Shell. Dismissed for good with "Not now".
// known: this device has a Lunchbox it connects to, which is not running right now.
export function offer(known = false) {
  if (store.get(HIDE) && !known) return
  const bar = document.createElement('div')
  bar.style.cssText = `${css};right:16px;bottom:16px`
  const text = document.createElement('span')
  text.textContent = known ? 'Your Lunchbox is not running. Start it on your computer, or here:' : 'Use Claude Code with your Claude subscription'
  const go = button('Start in Cloud Shell', true)
  go.href = startLink()
  go.target = '_blank'
  go.rel = 'noopener'
  go.title = 'Opens your free Google Cloud Shell. Lunchbox starts there and prints a link that connects this site to it.'
  const no = button('Not now', false)
  no.onclick = () => { if (!known) store.set(HIDE, '1'); bar.remove() }
  bar.append(text, go, no)
  document.body.appendChild(bar)
}
