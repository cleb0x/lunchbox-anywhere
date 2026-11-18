// Node's path, POSIX flavour: the browser version runs as a Linux-like machine.
import path from 'path-browserify'

const cwd = () => (globalThis as { process?: { cwd(): string } }).process?.cwd() ?? '/'
// path-browserify's resolve reads process.cwd(), which is set up before anything here runs.
export const resolve = (...parts: string[]) => path.resolve(cwd(), ...parts)
export const { join, dirname, basename, extname, isAbsolute, normalize, parse, format, sep, delimiter } = path
export const relative = (from: string, to: string) => path.relative(resolve(from), resolve(to))
export const posix = { ...path, resolve, relative }
export const win32 = posix
export const toNamespacedPath = (p: string) => p

export default { ...path, resolve, relative, posix, win32, toNamespacedPath }
