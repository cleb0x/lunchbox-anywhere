// Builds server mode into server/dist: the engine as one Node file (main.cjs) and the window as a
// static site (ui/). The Electron calls are answered by server/electron.ts, and the desktop browser
// view is swapped for server/browser.ts.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { build as esbuild } from 'esbuild'
import { build as vite } from 'vite'
import react from '@vitejs/plugin-react'

const root = resolve(import.meta.dirname, '..')
const out = resolve(root, 'server/dist')
rmSync(out, { recursive: true, force: true })

const swaps = {
  name: 'lunchbox-server',
  setup(b) {
    b.onResolve({ filter: /^electron$/ }, () => ({ path: resolve(root, 'server/electron.ts') }))
    b.onResolve({ filter: /\/browser$/ }, (a) => (resolve(a.resolveDir, a.path) === resolve(root, 'electron/browser') ? { path: resolve(root, 'server/browser.ts') } : undefined))
  },
}

await esbuild({
  entryPoints: [resolve(root, 'server/main.ts')],
  outfile: resolve(out, 'main.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  // The terminal page uses node-pty when it is installed; ws's speedups are optional.
  external: ['node-pty', 'bufferutil', 'utf-8-validate', 'electron-updater'],
  plugins: [swaps],
  logLevel: 'warning',
})

await vite({
  configFile: false,
  root: resolve(root, 'server/ui'),
  base: './',
  publicDir: resolve(root, 'web/public'),
  plugins: [react()],
  logLevel: 'warn',
  build: {
    outDir: resolve(out, 'ui'),
    emptyOutDir: true,
    target: 'es2023',
    chunkSizeWarningLimit: 4000,
    rollupOptions: { input: { index: resolve(root, 'server/ui/index.html'), terminal: resolve(root, 'server/ui/terminal.html') } },
  },
})
rmSync(resolve(out, 'ui/sw.js'), { force: true })
rmSync(resolve(out, 'ui/vendor'), { recursive: true, force: true })
writeFileSync(resolve(out, 'package.json'), JSON.stringify({ name: 'lunchbox-server', private: true, version: JSON.parse((await import('node:fs')).readFileSync(resolve(root, 'package.json'), 'utf8')).version }, null, 2))
console.log('Built server/dist')
