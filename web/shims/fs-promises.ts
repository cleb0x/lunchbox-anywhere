// Node's fs/promises: the synchronous calls in fs.ts, answered as promises.
import * as fs from './fs'

const p = <A extends unknown[], R>(fn: (...a: A) => R) => async (...a: A): Promise<R> => fn(...a)

export const stat = p(fs.statSync)
export const lstat = p(fs.lstatSync)
export const readFile = p(fs.readFileSync)
export const writeFile = p(fs.writeFileSync)
export const appendFile = p(fs.appendFileSync)
export const mkdir = p(fs.mkdirSync)
export const readdir = p(fs.readdirSync)
export const rm = p(fs.rmSync)
export const rename = p(fs.renameSync)
export const copyFile = p(fs.copyFileSync)
export const realpath = p(fs.realpathSync)
export const access = p(fs.accessSync)
export const unlink = p(fs.unlinkSync)

export default { stat, lstat, readFile, writeFile, appendFile, mkdir, readdir, rm, rename, copyFile, realpath, access, unlink }
