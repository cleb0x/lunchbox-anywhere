// The Lunchbox browser draws real pages into the desktop window. Server mode has no window to
// draw into yet, so the browser view is empty and agents get no browser tools; everything else
// in a room works.
import type { Tool } from '../electron/hands'

export type TabState = { id: string; who: string; room?: string; url: string; title: string; loading: boolean; back: boolean; forward: boolean; device: Device; action?: string; busy: boolean }
export type BrowserState = { tabs: TabState[]; active: string | null; shown: boolean }
export type Device = 'desktop' | 'tablet' | 'phone'

const NOT_YET = 'The Lunchbox browser is not available in server mode yet. Open pages in a new browser tab instead.'

export class Browser {
  constructor(_win: () => unknown, _emit: (channel: string, payload: unknown) => void) {}
  state(): BrowserState { return { tabs: [], active: null, shown: false } }
  place(_b: unknown) {}
  select(_id: string) {}
  close(_id: string) {}
  closeRoom(_room: string) {}
  async local() { return [] as { port: number; title: string }[] }
  setDevice(_d: Device) {}
  async open(_url: string): Promise<string> { throw new Error(NOT_YET) }
  nav(_k: string) {}
  devtools() {}
  async screenshot(_file: string): Promise<string> { throw new Error(NOT_YET) }
  tools(_who: string, _workspace: string, _room: string): Tool[] { return [] }
  destroy() {}
}
export const shotsDir = (workspace: string) => `${workspace}/screenshots`
