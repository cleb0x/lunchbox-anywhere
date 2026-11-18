export const pathToFileURL = (p: string) => new URL(`file://${encodeURI(p)}`)
export const fileURLToPath = (u: string | URL) => decodeURI(new URL(String(u)).pathname)
const U = globalThis.URL
export { U as URL }
export default { pathToFileURL, fileURLToPath, URL: U }
