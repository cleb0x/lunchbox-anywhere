<p align="center">
  <img src=".github/assets/icon.png" width="96" height="96" alt="Lunchbox">
</p>

<h1 align="center">Lunchbox Anywhere</h1>

<p align="center">
  Lunchbox as a website, so it works on a Chromebook too.<br>
  <a href="https://cleb0x.github.io/lunchbox-anywhere/"><b>cleb0x.github.io/lunchbox-anywhere</b></a>
</p>

<br>

I use [Lunchbox](https://github.com/noah-thing/lunchbox) on my PC at home: Claude Code, Codex and
the other agents working together in one room. At school I only have a Chromebook, and it can't
install desktop apps or turn on Linux, so I couldn't use it there. So I made Lunchbox into a
website.

The website is the real Lunchbox: the same screens, rooms, crews, shared memory, handoffs, proof
checks, rewind and flows. It can use the Lunchbox on my PC at home, with my Claude Code login and my
files there, from any browser.

Lunchbox is made by Noah ([@fsconfig](https://x.com/fsconfig)). This is a fork, made with his
permission. His original README is in [docs/original-README.md](docs/original-README.md).

## Three ways to use it

The website picks for you: your computer at home if it is running, otherwise your Cloud Shell, and
otherwise it runs on its own in the browser.

| | What runs the agents | Claude | Files |
| --- | --- | --- | --- |
| **1. Your computer at home** (best) | Your PC, with Lunchbox and Claude Code as they already are | Your subscription, the login already on the PC | Your PC's files and your Lunchbox rooms from the desktop app |
| **2. Google Cloud Shell** (when the PC is off) | A free Linux computer from Google, about 50 hours a week | Your subscription, signed in once there | Cloud Shell's 5 GB home folder |
| **3. Just the website** | The browser tab itself | An API key (Gemini has a free one) | Kept in the browser, or a folder you link on the Chromebook |

### 1. Your computer at home

On the PC, quit the Lunchbox desktop app first. Then run this once:

**Windows** (PowerShell):

```powershell
irm https://raw.githubusercontent.com/cleb0x/lunchbox-anywhere/main/lunchbox.ps1 | iex
```

**Mac or Linux** (Terminal):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/cleb0x/lunchbox-anywhere/main/lunchbox)
```

It uses the Claude Code that is already signed in on the PC (and installs it if it isn't there),
starts Lunchbox and prints a link. **Open that link once on your Chromebook** (send it to yourself).
From then on, just go to the website on the Chromebook and it finds your PC by itself.

To have it start whenever you log in to the PC, so it is always there when you are at school:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/cleb0x/lunchbox-anywhere/main/lunchbox.ps1))) -AtLogin
```

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/cleb0x/lunchbox-anywhere/main/lunchbox) --at-login
```

`-NotAtLogin` / `--not-at-login` undo it. The PC has to be on and awake.

### 2. Google Cloud Shell

[![Open in Cloud Shell](https://gstatic.com/cloudssh/images/open-btn.svg)](https://shell.cloud.google.com/cloudshell/editor?cloudshell_git_repo=https%3A%2F%2Fgithub.com%2Fcleb0x%2Flunchbox-anywhere&cloudshell_git_branch=main&cloudshell_tutorial=cloudshell.md)

Click it, choose **Trust**, and run `./lunchbox`. The first time it installs Claude Code and asks
you to sign in to Claude. It prints a link; Ctrl+click it. After that, the website's **Start in
Cloud Shell** button opens Cloud Shell, and Lunchbox starts there by itself.

### 3. Just the website

Open [the website](https://cleb0x.github.io/lunchbox-anywhere/), go to **Agents** and paste an API
key: Claude, OpenAI, xAI, Gemini (free at aistudio.google.com/apikey) or OpenRouter. **Choose
folder** links a real folder on the Chromebook.

## What I changed

The screens in `src/` are Noah's and are not changed at all. Everything else is in new folders:

**`web/`: Lunchbox running inside a browser tab.** The desktop app's engine (`electron/`) runs in
the page, with the parts of Node.js it uses swapped for browser versions:

- `vfs.ts`: a file system kept in the browser's storage, which can also link a real folder
- `bash.ts`: a bash shell written in JavaScript ([just-bash](https://github.com/vercel-labs/just-bash))
  for commands, with `grep`, `sed`, `jq` and the rest
- `node.ts`: a small built-in `node` and `npm test`, so agents can run JavaScript tests and proof
  checks still work
- `snap.ts`: rewind and changes without git
- `browser.ts` + `public/sw.js`: the Lunchbox browser panel, showing pages from the room's folder
- `main.ts`: everything the desktop app's main process answered, now answered in the page

**`server/`: Lunchbox on a computer, used from the website.** The desktop app's engine runs on
Node.js without Electron (`main.ts`), so the real Claude Code and the other agents run with their
own logins and the computer's files. The website talks to it over a WebSocket (`ui/bridge.ts`).

**`lunchbox` and `lunchbox.ps1`: the launchers.** They fetch the ready-made build, install Claude
Code if needed, open the tunnel, make the key, start Lunchbox and print the link.

**In `electron/`** there are only three small edits: in the browser, where every agent talks over an
API, API agents also get the room's tools (asking a crewmate, the browser). They only switch on in
the browser build, so the desktop app works exactly as before.

**`.github/workflows/`**: `web.yml` publishes the website to GitHub Pages and `server.yml` publishes
the ready-made build the launchers download, on every push to `main`.

## Problems and workarounds

| Problem | Workaround |
| --- | --- |
| A Chromebook can't install desktop apps or turn on Linux | Lunchbox as a website |
| A browser tab can't run programs like Claude Code | Claude Code runs on your PC or in Cloud Shell; the website connects to it |
| Anthropic doesn't let other apps sign in with a Claude subscription | Lunchbox never touches your Claude login. The real Claude Code runs on your own computer, signed in by you, and Lunchbox just gives it the task, as the desktop app does |
| A website can't reach a computer at home | A free [Cloudflare quick tunnel](https://try.cloudflare.com) (no account) gives the computer an address for as long as Lunchbox runs |
| Anyone could use that address | Each computer has a secret key. Only links with the key get in |
| The tunnel's address changes every start | The computer posts its new address to [ntfy.sh](https://ntfy.sh), encrypted with the key. A device that has opened a link once reads it and finds the computer by itself |
| A website can't start Cloud Shell | The **Start in Cloud Shell** button opens it, and Lunchbox starts there when the terminal opens |
| Cloud Shell's free hours run out | Lunchbox stops by itself after 20 minutes with no page open, so Cloud Shell can sleep |
| API keys the desktop app saved are locked with the PC's keychain | Enter them again on the website; Claude Code and the other command line agents don't need them |
| The desktop app and the website use the same rooms on the PC | Only one can run at a time; the launcher says so |
| Some providers (NVIDIA) block requests from websites | Use them through OpenRouter, or from your PC |

## What doesn't work yet

- The **Browser** panel when connected to a computer or Cloud Shell (it works in "just the website").
- In "just the website": `npm install`, `git` and `python`, local models (Ollama), and dev servers on
  localhost. Agents open the HTML file instead.
- Flows only run while the computer (or the tab, on its own) is running.

## Safety

- **Keep your links to yourself.** A link with your key can use your Lunchbox, and through it your
  computer's files. To make a new key, delete `~/.config/Lunchbox/server-key` (on Windows
  `%USERPROFILE%\.config\Lunchbox\server-key`) and start the launcher again; old links stop working.
- The key is after the `#` in the link, which browsers never send to GitHub.
- What is posted to ntfy.sh is encrypted with the key; it only says where to find the computer.
- In "just the website", keys and rooms stay in your browser. Nothing goes to a server of mine.

## For developers

```bash
npm ci
npm run web:dev        # the website on http://localhost:4420
npm run web:build      # the website in out/web
npm run server:build   # server mode in server/dist
npm run server:start   # start it (PORT, LUNCHBOX_KEY, LUNCHBOX_PASSWORD)
```

[WEB.md](WEB.md) has more detail on the browser version.

## License

Lunchbox is © Noah, all rights reserved, and is used here with his permission. The agent marks come
from [Lobe Icons](https://github.com/lobehub/lobe-icons) and the icons from
[Phosphor](https://phosphoricons.com), both under the MIT license (see [licenses/](licenses)).
