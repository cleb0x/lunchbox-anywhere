// Signs a release, so every copy of the app will install it. Run on Noah's computer after the
// release workflow has published the installers:
//
//   node scripts/sign-release.mjs 0.1.7
//
// It downloads each file of the release from noah-thing/lunchbox-releases, hashes it, checks the
// hash against the one the build wrote into latest*.yml, signs the list with the private key in
// ~/lunchbox/keys and uploads it to the release as latest-signed.json. The app (electron/signed.ts)
// installs nothing from a release without that file, and nothing whose hash is not on it.
//
//   node scripts/sign-release.mjs 0.1.7 --dir ~/mirror/download/v0.1.7 --out ~/mirror/latest/download
//
// signs the files of a local copy instead and uploads nothing, for a LUNCHBOX_UPDATE_BASE test.
// The key is read where it lies and never written anywhere.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createReadStream, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = 'noah-thing/lunchbox-releases'
const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); return i < 0 ? '' : args.splice(i, 2)[1] }
const tilde = (p) => (p.startsWith('~') ? join(homedir(), p.slice(1)) : resolve(p))
const dir = flag('--dir')
const out = flag('--out')
const version = (args[0] ?? '').replace(/^v/, '')
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) throw new Error('Give the version to sign, for example: node scripts/sign-release.mjs 0.1.7')

const key = createPrivateKey(readFileSync(join(homedir(), 'lunchbox/keys/notices-ed25519.pem')))
// The key has to be the one the app trusts, or every copy would refuse the release.
const here = dirname(fileURLToPath(import.meta.url))
const trusted = readFileSync(join(here, '../electron/signed.ts'), 'utf8').match(/BEGIN PUBLIC KEY-----\\n([A-Za-z0-9+/=]+)\\n/)?.[1]
const mine = createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64')
if (trusted !== mine) throw new Error('The key in ~/lunchbox/keys is not the one in electron/signed.ts. Nothing was signed.')

// Installers and archives are signed. The feeds and block maps only describe them.
const shipped = (name) => /^[\w.+-]+$/.test(name) && !/\.(yml|yaml|json|blockmap|txt)$/.test(name)
const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8', maxBuffer: 32e6 })

async function hashed(name, stream) {
  const hash = createHash('sha512')
  let size = 0
  for await (const chunk of stream) { hash.update(chunk); size += chunk.length }
  return { name, sha512: hash.digest('base64'), size }
}

let files = []
let feeds = ''
if (dir) {
  const from = tilde(dir)
  for (const name of readdirSync(from).filter(shipped).sort()) if (statSync(join(from, name)).isFile()) files.push(await hashed(name, createReadStream(join(from, name))))
  for (const name of readdirSync(from).filter((n) => /^latest.*\.yml$/.test(n))) feeds += readFileSync(join(from, name), 'utf8')
} else {
  const release = JSON.parse(gh('release', 'view', `v${version}`, '--repo', REPO, '--json', 'assets,isDraft,tagName'))
  if (release.isDraft) throw new Error(`v${version} is still a draft. Publish it first.`)
  for (const a of release.assets.filter((a) => shipped(a.name)).sort((x, y) => x.name.localeCompare(y.name))) {
    process.stdout.write(`${a.name} `)
    const res = await fetch(`https://github.com/${REPO}/releases/download/v${version}/${a.name}`)
    if (!res.ok || !res.body) throw new Error(`could not download ${a.name} (${res.status})`)
    const f = await hashed(a.name, res.body)
    if (f.size !== a.size) throw new Error(`${a.name} is ${f.size} bytes but the release says ${a.size}`)
    files.push(f)
    console.log(`${(f.size / 1e6).toFixed(1)} MB`)
  }
  for (const a of release.assets.filter((a) => /^latest.*\.yml$/.test(a.name))) feeds += await (await fetch(`https://github.com/${REPO}/releases/download/v${version}/${a.name}`)).text()
}
if (!files.length) throw new Error('The release has no files to sign.')

// What the build wrote down right after making each file. A file that no longer matches was
// changed after it was built, and that is exactly what must never be signed.
let listed = 0
for (const block of feeds.split(/^\s*-\s+url:/m).slice(1)) {
  const name = block.match(/^\s*['"]?([^'"\s]+)/)?.[1]
  const sum = block.match(/^\s*sha512:\s*['"]?([^'"\s]+)/m)?.[1]
  const f = files.find((x) => x.name === name)
  if (!name || !sum) continue
  if (!f) throw new Error(`The feed lists ${name}, which is not in the release.`)
  if (f.sha512 !== sum) throw new Error(`${name} does not match the hash its build recorded. Nothing was signed.`)
  listed++
}
if (!listed) throw new Error('No latest*.yml to check the files against. Nothing was signed.')

const issued = Date.now()
const body = Buffer.from(JSON.stringify({ lunchbox: 'update', version, issued, files }))
const sig = sign(null, body, key).toString('base64')
if (!verify(null, body, createPublicKey(key), Buffer.from(sig, 'base64'))) throw new Error('The signature did not verify.')
const json = JSON.stringify({ version, issued, files, sig }, null, 2) + '\n'

if (dir) {
  const to = join(tilde(out || dir), 'latest-signed.json')
  writeFileSync(to, json)
  console.log(`Signed ${files.length} files of ${version} into ${to}. Nothing was uploaded.`)
} else {
  const tmp = mkdtempSync(join(tmpdir(), 'lunchbox-sign-'))
  try {
    writeFileSync(join(tmp, 'latest-signed.json'), json)
    gh('release', 'upload', `v${version}`, join(tmp, 'latest-signed.json'), '--repo', REPO, '--clobber')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  // Read back the way the app will read it.
  const live = await (await fetch(`https://github.com/${REPO}/releases/download/v${version}/latest-signed.json`)).json()
  if (live.sig !== sig) throw new Error('The uploaded list is not the one just signed. Look at the release before anyone updates.')
  console.log(`Signed ${files.length} files, ${listed} checked against the build's own hashes. Copies that check signatures will now install ${version}.`)
}
