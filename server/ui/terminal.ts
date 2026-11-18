import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

const term = new Terminal({ fontFamily: "'IBM Plex Mono', ui-monospace, monospace", fontSize: 13, cursorBlink: true, theme: { background: '#0d0d0c', foreground: '#f2f0ea' } })
const fit = new FitAddon()
term.loadAddon(fit)
term.open(document.getElementById('term')!)
fit.fit()

const url = new URL(`./pty?cols=${term.cols}&rows=${term.rows}`, location.href)
url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
const ws = new WebSocket(url)
ws.onmessage = (e) => term.write(String(e.data))
ws.onclose = () => term.write('\r\n\x1b[2m[The terminal closed. Reload the page for a new one.]\x1b[0m\r\n')
term.onData((d) => ws.readyState === ws.OPEN && ws.send(d))
const resize = () => { fit.fit(); if (ws.readyState === ws.OPEN) ws.send(`\u0000resize:${term.cols}x${term.rows}`) }
addEventListener('resize', resize)
ws.onopen = resize
term.focus()
