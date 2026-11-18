# Lunchbox in the browser

> The [README](README.md) has the short version, including using Lunchbox on your own computer at
> home from the website. This page is the detail on the browser version.

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

## With your Claude subscription: Lunchbox in Cloud Shell

A browser tab cannot run Claude Code, and Anthropic does not allow other apps to sign in with a
Claude subscription. Claude Code itself can run in **Google Cloud Shell**, a free Linux computer
in the browser that comes with every Google account (about 50 hours a week, no card). There
Lunchbox runs as on the desktop: Claude Code with your own subscription, plus Codex, Gemini CLI
and the rest if you add them, `git`, `npm` and real commands.

[![Open in Cloud Shell](https://gstatic.com/cloudssh/images/open-btn.svg)](https://shell.cloud.google.com/cloudshell/editor?cloudshell_git_repo=https%3A%2F%2Fgithub.com%2Fcleb0x%2Flunchbox-anywhere&cloudshell_git_branch=main&cloudshell_tutorial=cloudshell.md)

1. Click the button and choose **Trust** when Cloud Shell asks.
2. Run `./lunchbox` in the terminal. The first time it installs Claude Code and asks you to sign
   in to Claude.
3. Ctrl+click the link it prints. It opens this website, connected to your Cloud Shell.

Each person runs their own copy in their own Cloud Shell, signed in with their own Claude account.
`./lunchbox` opens a free Cloudflare quick tunnel (no account) so this website can reach it, and
makes a secret key that only the printed link carries, after the `#`, which browsers never send to
GitHub. Without the key nothing gets in, so there is no sign in to set up for Lunchbox itself. After the first time, Lunchbox starts by itself whenever Cloud Shell opens (the website's **Start
in Cloud Shell** button opens it), and stops by itself after 20 minutes with no page open, so it
does not use up the free hours.

The Lunchbox browser view is not in this mode yet; everything else is. `./lunchbox` runs on any
Linux or Mac computer too. `server/` holds the code: the desktop engine on Node
(`server/main.ts`) and the window's bridge over a WebSocket (`server/ui/entry.ts`).
