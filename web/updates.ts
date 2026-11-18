// The browser version is updated by deploying it: every visit loads the newest one. Nothing to
// download, and no notices from a server.
import type { UpdateState } from '../shared/types'

export class Updates {
  state: UpdateState = { state: 'none' }
  constructor(_store: unknown, _emit: (channel: string, value: unknown) => void) {}
  start() {}
  check() { return Promise.resolve(this.state) }
  download() {}
  install() { location.reload() }
  setAuto(_on: boolean) {}
  shown() { return [] }
  dismiss(_id: string) {}
}
