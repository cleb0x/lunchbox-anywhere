import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// The web build of Lunchbox. The React window in src/ is used exactly as it is; the Electron main
// process in electron/ runs in the page too, with Node's modules swapped for the browser versions
// in web/shims and a few desktop-only files swapped for the browser versions in web/.
const root = __dirname
const web = (p: string) => resolve(root, 'web', p)

const NODE: Record<string, string> = {
  fs: web('shims/fs.ts'),
  'fs/promises': web('shims/fs-promises.ts'),
  path: web('shims/path.ts'),
  os: web('shims/os.ts'),
  crypto: web('shims/crypto.ts'),
  child_process: web('shims/child_process.ts'),
  readline: web('shims/readline.ts'),
  url: web('shims/url.ts'),
  module: web('shims/module.ts'),
  http: web('shims/http.ts'),
  net: web('shims/empty.ts'),
  stream: web('shims/stream.ts'),
  'stream/promises': web('shims/stream.ts'),
  electron: web('shims/electron.ts'),
  'electron-updater': web('shims/empty.ts'),
}

// Files in electron/ that only make sense on a desktop, each with its browser stand-in.
const SWAP: Record<string, string> = {
  'electron/snap.ts': web('snap.ts'),
  'electron/browser.ts': web('browser.ts'),
  'electron/updates.ts': web('updates.ts'),
  'electron/report.ts': web('report.ts'),
  'electron/count.ts': web('count.ts'),
}

const swap: Plugin = {
  name: 'lunchbox-web',
  enforce: 'pre',
  async resolveId(source, importer, options) {
    const bare = source.replace(/^node:/, '')
    if (NODE[bare] && importer && !importer.includes('/node_modules/')) return NODE[bare]
    if (bare === 'electron' || bare === 'electron-updater') return NODE[bare]
    if (!importer || !source.startsWith('.')) return null
    const r = await this.resolve(source, importer, { ...options, skipSelf: true })
    if (!r) return null
    for (const [from, to] of Object.entries(SWAP)) if (r.id === resolve(root, from) && importer !== to) return to
    return r
  },
}

// three.js for the 3D viewer (expert_view), copied next to the app as the desktop build does.
const vendor: Plugin = {
  name: 'lunchbox-vendor',
  buildStart() {
    const files: Record<string, string> = {
      'three.module.js': 'node_modules/three/build/three.module.js',
      LICENSE: 'node_modules/three/LICENSE',
      'jsm/loaders/GLTFLoader.js': 'node_modules/three/examples/jsm/loaders/GLTFLoader.js',
      'jsm/utils/BufferGeometryUtils.js': 'node_modules/three/examples/jsm/utils/BufferGeometryUtils.js',
    }
    for (const [to, from] of Object.entries(files)) {
      const out = web(`public/vendor/three/${to}`)
      mkdirSync(dirname(out), { recursive: true })
      copyFileSync(resolve(root, from), out)
    }
  },
}

export default defineConfig({
  plugins: [vendor, swap, react()],
  root: web('.'),
  base: './',
  publicDir: web('public'),
  // The desktop code reads process.env, which here is the stand-in from web/shims/process.ts.
  define: { __dirname: '"/app"', 'process.env': 'globalThis.process.env' },
  resolve: { alias: { buffer: resolve(root, 'node_modules/buffer/index.js') } },
  server: { port: 4420, fs: { allow: [root] } },
  build: { outDir: resolve(root, 'out/web'), emptyOutDir: true, target: 'es2023', chunkSizeWarningLimit: 4000 },
  optimizeDeps: { exclude: ['just-bash'] },
})
