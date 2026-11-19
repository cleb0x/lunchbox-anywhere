// The few Electron calls that run in the browser build. Everything that needs a desktop window
// lives in web/main.ts instead.
import { HOME } from './os'
import { version } from '../../package.json'

// The version comes from package.json, so it follows each Lunchbox release.
export const VERSION: string = version
export const DATA = `${HOME}/.config/Lunchbox`

const paths: Record<string, string> = {
  home: HOME, userData: DATA, documents: `${HOME}/Documents`, downloads: `${HOME}/Downloads`, temp: '/tmp', desktop: `${HOME}/Desktop`, appData: `${HOME}/.config`,
}

export const app = {
  isPackaged: true,
  getVersion: () => VERSION,
  getName: () => 'Lunchbox',
  setName: () => {},
  getLocale: () => navigator.language,
  getPath: (name: string) => paths[name] ?? HOME,
  on: () => app,
  once: () => app,
  whenReady: () => Promise.resolve(),
  quit: () => {},
}

export const net = { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init) }
export const safeStorage = { isEncryptionAvailable: () => false }
export const shell = { openExternal: (url: string) => { window.open(url, '_blank', 'noopener') } }
export default { app, net, safeStorage, shell }
