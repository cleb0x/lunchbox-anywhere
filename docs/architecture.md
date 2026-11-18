# Architecture

Lunchbox is an Electron app. The main process runs the agents and holds the rules about what they may do. The renderer, in React, draws what the main process sends it.

## Layout

```
electron/
  main.ts           windows, IPC, keychain
  import.ts         chats read from Claude Code, Codex, Gemini CLI and Grok, made into rooms
  signed.ts         the key the app trusts, and the check every update has to pass
  store.ts          rooms as JSONL logs that only grow, settings, the usage ledger
  system.ts         PATH, shells and processes on each platform
  policy.ts         what each access mode lets a command do
  shell.ts          `!` commands and proof checks
  limits.ts         plan windows read from each provider
  tally.ts          token and cost totals from each tool's own logs
  local.ts          Ollama, LM Studio and llama.cpp: find, start, download
  agents/           one parser per stream format, CLI and HTTP runners
  room/engine.ts    turns, the main agent, bringing others in, limits, memory, proof, side by side
  room/kit.ts       the tools one agent can use to reach another during its turn
  room/context.ts   what each agent is sent (the conversation or a briefing), ordered for prompt caching
  room/trim.ts      long command output cut to its start, its end and the lines that look like problems
  room/proof.ts     claims checked against the command history
shared/             types, prices, routing and plan parsing used by both sides
src/                the React renderer
test/               unit tests, recorded CLI output and the fake agent
```

## A turn

1. You send a message. It goes to the room's main agent, the first in the crew, unless you name someone with `@`.
2. `room/context.ts` builds the prompt with the stable part first (instructions, then the conversation) and the new part last, so providers can reuse the start from cache. A crewmate that joins gets a briefing in place of the conversation.
3. The agent runs as its own CLI, or over HTTP for API keys and local models. A parser turns its stream into text, commands, file edits and usage.
4. The main agent can ask a crewmate a question or bring one in for a task, through its tools or a line like `@grok: question`. Lunchbox sends the crewmate a briefing with the brief, shared memory, changed files and its task. The answer goes into shared memory and the main agent carries on.
   An agent that starts another agent from its own shell gets an answer nobody else sees, so `room/reach.ts` finds those commands. Claude Code is turned down by the hook before the command runs, in every mode, and told which tool to use. Every agent gets stand-ins for the agents' commands first on its PATH, which do the same where its shell keeps that PATH. One that gets through anyway is shown in the room with what it printed, marked as outside the room.
5. The engine checks claims such as "the tests pass" against commands that exited 0 after the last edit.
6. The engine writes usage to the ledger, which Pool and Savings read.

## Saving

Three things lower what a turn costs. Each one is counted on its own turn in the ledger, apart from what the agent's own prompt caching saved.

- **Shortened command output.** `hands.ts` answers a Claude Code hook before each command. A command that only logs and ends by itself, such as a test run, a build or an install, runs with its output going to a file, and `room/trim.ts` keeps the start, the end and the lines that look like problems. The agent gets that and the path of the file. Commands that print content, such as `cat`, `git diff` or a search, are never touched. Neither is a dev server or a watcher, or any command in Plan or Ask.
- **Cache lifetime.** Claude Code on a subscription stores its cache for an hour, which costs twice the input price to write. A session nobody is waiting on, a flow or a crewmate called for one job, stores for five minutes at 1.25 times instead. The lifetime is chosen when a session starts and kept, because a request asking for one lifetime does not find entries written for the other. For a session a person talks to, the engine reads it once more just before its cache runs out, in a copy of the session that is thrown away, so the next message finds it cached. The reads for one pause never add up to more than a fifth of what a cold start would cost.
- **Not sent twice.** A resumed session gets only the memory that changed, and a crewmate gets a briefing instead of the conversation.

`npm run bench` runs the same tasks in plain Claude Code and in a room and prints what each cost. It uses real agents and real usage.

## Windows

One process runs per profile, because two would write the same rooms over each other. That one process opens as many windows as wanted (New Window in the File menu, or a room's Open in new window), and each room has its own queue in the engine, so rooms work at the same time. Everything the main process sends goes to every window, which is what keeps two windows on one room in step. Only the app's own windows may call the main process; pages in the agent browser and the sign in windows it opens are refused. The browser's pages are drawn in one window at a time, the last one to open the Browser page.

## Imported chats

`import.ts` lists the sessions each agent keeps on the computer and turns one into a room: the person's messages, the agent's answers and a count of the commands and edits, never the raw records. The room is made in the folder the chat was held in. Claude Code, Codex and Grok are handed their own session back, so they remember all of it and are not sent it again. Gemini CLI cannot take a session back, and neither can any agent when the folder is gone, so those read the conversation from the room, the newest part first, with a short summary in shared memory.

## Updates

Installers are built by `release.yml` and published to `noah-thing/lunchbox-releases`. That repository is only where the files lie. What the app trusts is `latest-signed.json` on the release: the version and the SHA-512 of every installer, signed with an Ed25519 key that exists only on Noah's computer (`scripts/sign-release.mjs`). The public half is in `electron/signed.ts`.

Every check starts by fetching that file. A release without it, with a signature that does not verify, or with a version older than the one running is left alone, and the reason goes to the log. On a Mac the zip is hashed against the signed list before it is unpacked. On Windows and Linux electron-updater does the download, and the file it fetched is hashed against the signed list before the app will install it, now or on quit. Copies up to 0.1.6 were built before this and install whatever the repository offers.

## Data

Each room is one `.jsonl` file of events in the app's user data folder. Settings, the ledger and plan readings sit next to them as JSON. Lunchbox sends data to the agents you use, to the company behind each login when it reads plan limits, and to a private repository when you send a bug report.
