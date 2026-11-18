// There is no local server in a browser tab. Lunchbox's tool server for command line agents
// (electron/hands.ts) fails to start, which it already handles: agents run without it.
export function createServer(): never { throw new Error('A browser tab cannot listen for connections') }
export default { createServer }
