// Node's os, describing the browser as a small Linux machine with one user.
export const HOME = '/home/you'

export const homedir = () => HOME
export const tmpdir = () => '/tmp'
export const platform = () => 'linux'
export const type = () => 'Linux'
export const arch = () => 'x64'
export const release = () => `browser ${navigator.userAgent.match(/Chrome\/[\d.]+|Firefox\/[\d.]+|Version\/[\d.]+ Safari/)?.[0] ?? ''}`.trim()
export const hostname = () => 'browser'
export const EOL = '\n'
// Chrome tells pages roughly how much memory the device has, capped at 8 GB.
export const totalmem = () => ((navigator as { deviceMemory?: number }).deviceMemory ?? 8) * 2 ** 30
export const freemem = () => totalmem() / 2
export const cpus = () => Array.from({ length: navigator.hardwareConcurrency || 4 }, () => ({ model: 'browser', speed: 0 }))
export const userInfo = () => ({ username: 'you', homedir: HOME, shell: '/bin/bash', uid: 1000, gid: 1000 })

export default { homedir, tmpdir, platform, type, arch, release, hostname, EOL, totalmem, freemem, cpus, userInfo }
