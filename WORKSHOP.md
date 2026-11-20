# Working in the Workshop

This folder is one person's own copy of Lunchbox's source. They opened the Workshop in Lunchbox and asked for something the app does not have yet. You build it here, and it runs only on their computer. When it works, they press **Open your version** on the Workshop page and Lunchbox restarts as this build, with the same rooms, settings and keys.

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

Then tell the person, in two or three sentences, what you added and where to find it, and to press **Open your version** on the Workshop page. If they want everyone to have it, the **Send as a suggestion** button there sends it to the Lunchbox maintainers.
