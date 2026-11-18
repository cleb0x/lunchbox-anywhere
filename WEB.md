# Lunchbox in the browser

The same app as the desktop version, running entirely in a browser tab. You can use it on a
Chromebook, or any computer with Chrome or Edge. Nothing runs on a server: the site is static
files, and your rooms, settings and keys stay in your browser.

## Use it

Open the site and go through the same first steps as the desktop app. Then:

1. **Add an agent.** Go to **Agents** and paste an API key for Claude (Anthropic), OpenAI, xAI,
   Google Gemini or OpenRouter. You can also add any OpenAI-compatible provider under
   **Add a connector**: Groq, DeepSeek, Mistral, Kimi, Together, Cerebras, Fireworks and others
   all accept requests straight from a browser.
2. **Pick a folder (optional).** When you create a room, **Choose folder** links a real folder on
   your computer. The browser asks once for permission to edit it, and agents' changes are written
   straight to your files. Without a folder, a room gets its own folder kept inside the browser.
3. **Install it like an app (optional).** In Chrome, use **Install Lunchbox** in the address bar
   (or ⋮ → Cast, save and share → Install page as app) to get its own window and shelf icon.

## What works

Rooms, crews, shared memory, handoffs, proof checks, side by side, rewind, changes, forks,
exports, skills, packs, flows, Pool, Savings, the Lunchbox browser and the Telegram remote work as
on the desktop. Flows and the Telegram remote need Lunchbox open in a tab.

- **Commands** (`!ls`, and the commands agents run) run in a built-in bash with the usual tools:
  `ls`, `cat`, `grep`, `sed`, `awk`, `find`, `jq`, `diff`, `tar`, `sqlite3`, `curl` and more.
- **`node`** runs plain JavaScript (CommonJS and ES modules) with `fs`, `path`, `assert`, `util`,
  `events` and `node:test`, so agents can run tests and Lunchbox can check their claims.
  `npm test`, `npm start` and `npm run <script>` run the scripts in `package.json`.
- **The Lunchbox browser** shows pages from the room's folder, and agents can open, read, click,
  type in, screenshot and audit them (`expert_look`, `expert_audit`, `expert_view` in Studio).
- **API agents get every room tool.** On the desktop only command line agents could ask a
  crewmate or drive the browser; here the API agents can.

## What is different

A web page cannot start programs on your computer, so a few things cannot work:

- **Command line agents** (Claude Code, Codex, Gemini CLI, Grok Build, OpenCode) and their
  subscription logins. Use the same companies' API keys instead.
- **Local models** (Ollama, LM Studio, llama.cpp). A Chromebook without Linux cannot run them.
  On a computer that can, the server must allow this site (for example
  `OLLAMA_ORIGINS=https://your-site`) and Chrome may still ask before a website reaches it.
- **`npm install`, `npx`, `git`, `python`** and other installed tools. `node` has no packages
  beyond what is already in the folder.
- **Dev servers on localhost.** Open the HTML file in the room's folder instead.
- **Websites in the Lunchbox browser.** Most sites refuse to be shown inside another page, and
  none can be read by agents. Pages from the room's folder always work.
- **Keys** are kept in the browser's storage, encoded but not locked by a system keychain.
- **Flows** run while Lunchbox is open in a tab.
- **Updates** arrive whenever the site is deployed; there is nothing to install.

## Run it yourself

```bash
npm ci
npm run web:dev       # http://localhost:4420
npm run web:build     # static site in out/web
npm run web:preview   # serves out/web at http://localhost:4421
```

`out/web` can be hosted anywhere that serves static files over HTTPS, at the root of a domain or
in a subfolder. `.github/workflows/web.yml` publishes it with GitHub Pages: in the repository's
settings, set **Pages → Build and deployment → Source** to **GitHub Actions**.

## How it is built

The React window in `src/` is used as it is. The Electron main process in `electron/` runs in the
page too, with Node's modules replaced by browser versions in `web/shims/`, and the parts that
need a desktop replaced by the files in `web/`:

| File | Does |
| --- | --- |
| `web/vfs.ts` | The file system: kept in memory, saved to IndexedDB, linked folders written back to disk |
| `web/bash.ts` | The shell, [just-bash](https://github.com/vercel-labs/just-bash), over those files |
| `web/node.ts`, `web/node-worker.ts` | `node` and `npm` in a worker |
| `web/snap.ts` | Checkpoints, rewind and diffs without git |
| `web/browser.ts`, `web/public/sw.js` | The Lunchbox browser as frames; a service worker serves the room's files to them |
| `web/main.ts` | Every channel of `electron/main.ts`, offered to the window as `window.lb` |
| `vite.web.config.ts` | Swaps the modules above in when building |

The desktop app is unchanged. The only edits under `electron/` let API agents use the room's tools,
and they switch on only in the browser build (`LUNCHBOX_WEB`).
