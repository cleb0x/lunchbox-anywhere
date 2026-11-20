# Working in the Workshop

This folder is one person's own copy of Lunchbox's source. They opened the Workshop in Lunchbox and asked for something the app does not have yet. You build it here, and it runs only on their computer. When it works, they press **Try it**, in the room's header or on the Workshop page, and Lunchbox restarts as this build, with the same rooms, settings and keys.

Read this file, then `docs/architecture.md`, then the files around the place you will change. Build what they asked for so that nobody could tell it was added later.

## Ground rules

- **Their data is shared with the standard app.** This build and the standard Lunchbox read the same profile. Never change how rooms, settings, keys or the ledger are stored (`electron/store.ts`, the types they use in `shared/types.ts`). You may add new optional settings fields; never rename or remove existing ones, and never change what an existing field means.
- **Leave these alone:** updates (`electron/updates.ts`, `macupdate.ts`, `macfeed.ts`), reports (`electron/report.ts`), key sealing (`cipher` in `electron/main.ts`), the Workshop itself (`electron/workshop.ts`, `src/views/Workshop.tsx`), the access policy (`electron/policy.ts`) and anything under `.github/` or `build/`. A change there can lock the person out of updates or their own keys.
- **Keep it small.** Change what the request needs and nothing more. No refactors and no renames of code you were not asked to touch, and no new dependencies unless there is truly no other way. Every extra line is something that has to move to the next release with them.
- **Ask when the request is unclear,** in one short question with a suggested answer, before building the wrong thing.

## How the app is put together

- **Main process** (`electron/`): `main.ts` opens windows and answers calls from the renderer in `wire()`. A call is `h('area:action', (args) => result)`. Something the main process pushes to every window is `emit('channel', value)`, and the channel must also be listed in `EVENTS` in `electron/preload.ts`.
- **Renderer** (`src/`): React. `desk.call('area:action', ...args)` calls the main process. App state lives in `src/lib/desk.ts` and is read with `useApp((s) => s.thing)`.
- **Pages**: each page is a view in `src/views/`. To add one, add its name to the `View` type and `VIEWS` in `src/App.tsx`, render it where the other views are rendered, add a sidebar button next to the others, and add a palette command in the `commands` list. Copy the structure of a page like `src/views/Pool.tsx`: `page`, `pagebody`, `pagehead` with an `h1` and one line, then `section className="group"` blocks with `settings` and `setting` rows.
- **Agents** are defined in `electron/agents/index.ts` (`CATALOG`), with one parser per output format in `electron/agents/parse.ts`.
- **Room behaviour** lives in `electron/room/engine.ts`; what agents are told is built in `electron/room/context.ts`.

## Recipes for common requests

Almost anything can be built here, because this is the whole app. These are the places the usual requests go. Read the neighbours of each before adding to it, and copy how they are written.

- **A model provider with an API key** (a new company, a self-hosted server, a gateway): add it to `PROVIDERS` in `electron/agents/http.ts` with its base address and wire style (`openai`, `anthropic`, `google` or `ollama`; most providers speak the OpenAI style). Then add an agent to `CATALOG` in `electron/agents/index.ts` with `via: 'api'` and `key` naming the provider, and a row in `PROVIDER` in `src/views/Agents.tsx` so the person can paste the key. Keys are sealed by the main process; never store one anywhere else. For one-off setups the person can also add a connector on the Agents page without code.
- **A new command line agent**: an entry in `CATALOG` with `via: 'cli'`, its `bin`, and a `spawn` that maps the room's access modes to the tool's own flags. If it prints JSON lines, add a parser in `electron/agents/parse.ts` next to the others and a unit test fed with real lines from the tool; if it prints plain text, use `textOut()`. List its models in `modelsFor` and its effort levels in `effortsFor` if it has them.
- **A page**: see "Pages" above. Give it a sidebar button and a palette command, and keep it to one job.
- **A setting**: add an optional field to `Settings` in `shared/types.ts`, read it where it matters, and add a `setting` row in `src/views/Settings.tsx` in the section it belongs to. Save it with `reload.settings({ ... })`.
- **Something agents can do in every room** (a tool): `electron/room/kit.ts` builds the tools one agent can use during its turn. An outside service is usually better as an MCP server in the catalog (`shared/catalog.ts`), which Lunchbox installs and hands to every agent.
- **A flow template, a pack or a playbook**: `shared/flow.ts` (`TEMPLATES`), `electron/packs.ts` (`BUILTIN`) and `shared/skills.ts`.
- **A theme**: `src/lib/themes.ts` is the only source of colours; a theme is a hue, a chroma and an ASCII ramp, and the guards in `src/lib/custom.ts` keep text readable.
- **A keyboard shortcut**: the `key` handler in `src/App.tsx`, plus the hint on the palette command.
- **Something in the room itself** (a button on a message, a new kind of block): `src/views/Room.tsx` draws the transcript and `electron/room/engine.ts` produces the events. Add a new event kind to the `Event` type rather than changing an existing one, since old rooms are read by the same code.
- **An integration with another app** (GitHub, Slack, a calendar): prefer its official CLI or MCP server over writing a client; when there is neither, call its API from the main process, never from the renderer, and keep its token with the other keys.

## How it must look

Lunchbox has one design language, and a new part must use it.

- **Colour** comes only from the CSS variables set by the theme (`--ink`, `--dim`, `--faint`, `--ground`, `--sheet`, `--well`, `--line`, `--line2`, `--accent`, `--warn` for "waiting for you", `--bad` for failure, and the rest in `src/styles.css` and `src/lib/themes.ts`). Never write a colour by hand: it would break every other theme and light mode.
- **Type**: Helvetica Neue for words, the mono font (`var(--mono)`) for machine facts such as paths, commands, sizes and times. 13 px for the interface, 22 px page titles. Weights 400 and 500 only.
- **Space and shape**: multiples of 4 px; radius 6 on controls, 12 on surfaces; one hairline, `var(--line)`.
- **Parts to reuse**: buttons `btn`, `btn small`, `btn quiet`; segmented choice `seg`; `Toggle` from `src/views/Flows.tsx`; icons from `src/ui/icons.tsx` (16 px, 1.25 stroke, add new ones in the same style); `Loader` and `Sure` (a confirm) from `src/ui/bits.tsx`; toasts through the `say` function pages receive.
- **Motion**: things that appear rise 6 px and fade in over 300 to 400 ms with `var(--out)`, which is `cubic-bezier(.23,1,.32,1)` (the `rise` class does this). Keyboard actions are instant. No bounce, blur or scrambled text, and `prefers-reduced-motion` turns motion off.
- **Words**: plain, short and specific, in the voice of the rest of the app. Say what a thing does, not how good it is. No exclamation marks.
- **Every state**: think about empty, loading, error and very long content, in dark and light, at a narrow window.

## Before you say it works

1. `npm run typecheck` passes.
2. `npm test` passes, and new logic has a test next to the others in `test/unit.ts`.
3. `npm run build` passes.
4. You looked at it: run `npm run build`, then a screenshot script such as `node test/pages.mjs` (it writes to `test/shots/`), and check the result in dark and light.

Then tell the person, in two or three sentences, what you added and where to find it, and to press **Try it** in the room's header. If they want everyone to have it, **Send to Lunchbox** sends it to the maintainers.
