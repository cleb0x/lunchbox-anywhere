// The desktop app sends an anonymous daily count to a server. The browser version talks to no
// server of its own, so it sends nothing.
export function countBody(id: string, version: string, os: string, arch: string) { return { id, version, os, arch } }
export class Count {
  constructor(_store: unknown) {}
  start() {}
  async send() {}
}
