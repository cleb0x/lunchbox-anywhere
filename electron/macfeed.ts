import { accessSync, constants } from 'node:fs'
import { dirname } from 'node:path'
import type { SignedFile } from './signed'

// The parts of the Mac updater that need no Electron, so the tests can load them.

// The zip built for this Mac's chip, from the release's signed file list. An Intel build would run
// on Apple silicon only through Rosetta, so the chip has to match.
export function pick(files: SignedFile[], arch = process.arch): SignedFile | undefined {
  const chip = arch === 'arm64' ? 'arm64' : 'x64'
  return files.find((f) => f.name.endsWith('.zip') && f.name.includes(`-mac-${chip}.`))
}

// The swap needs to replace the bundle where it lies. An app run from the disk image, or moved
// somewhere read-only by Gatekeeper, cannot update itself; the person gets the download instead.
export function canReplace(bundle: string) {
  if (!bundle.endsWith('.app') || /\/AppTranslocation\/|^\/Volumes\//.test(bundle)) return false
  try {
    accessSync(dirname(bundle), constants.W_OK)
    accessSync(bundle, constants.W_OK)
    return true
  } catch {
    return false
  }
}
