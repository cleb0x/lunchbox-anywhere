// The Electron calls the engine makes, for server mode, where it runs on plain Node.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'

const home = homedir()
const DATA = process.env.LUNCHBOX_DATA || join(home, '.config', 'Lunchbox')
let version = '0.0.0'
try { version = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')).version } catch {}

const paths: Record<string, string> = {
  home, userData: DATA, appData: join(home, '.config'), documents: join(home, 'Documents'), downloads: join(home, 'Downloads'), temp: '/tmp', desktop: join(home, 'Desktop'),
}

export const app = {
  isPackaged: true,
  getVersion: () => version,
  getName: () => 'Lunchbox',
  setName: () => {},
  getLocale: () => 'en-US',
  getPath: (name: string) => paths[name] ?? home,
  on: () => app,
  once: () => app,
  whenReady: () => Promise.resolve(),
  quit: () => process.exit(0),
}
export const net = { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init) }
// No keychain on a server: keys are only encoded, as on a Linux desktop without one.
export const safeStorage = { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() }
export const shell = { openExternal: () => {}, showItemInFolder: () => {}, openPath: async () => '' }
export default { app, net, safeStorage, shell }
