# @sudobility/writing_ui

> Local-packages phase: no npm publishing, no version bumps, no workflows. Resolve siblings by path.

React web editor components for Fadewright: `ScriptEditor` (speed view) and `ElementStylePicker`, over a `@sudobility/writing_core` document. **Generic**: never import `screenwriter_lib`, `screenwriter_client` or `screenwriter_api`.

## Tech Stack

- React 19 (peer), TypeScript strict, Vite (demo), Vitest + jsdom + Testing Library. Bun only; run tests with `bunx vitest run`, never `bun test`.

## Structure

- `src/host.ts` — `ScriptEditorHost`, the only outside dependency (see below).
- `src/ScriptEditor.tsx` — rendering, event wiring, caret restoration, local-cursor publishing.
- `src/input.ts` — `createInputController`: `beforeinput`/keydown/composition to `writing_core` commands.
- `src/dom-positions.ts` — DOM point <-> (element id, plain offset); plain offset <-> Y.Text index (embeds).
- `src/ElementBlock.tsx` — one memoised block per element, keyed `(id, textVersion.attrsVersion.templateEpoch)`.
- `src/geometry.ts` — template EMU to CSS inches, `ResolvedStyle` to inline style.
- `src/PageView.tsx`, `src/useLayout.ts`, `src/layout-engine.ts` — read-only page view: `layoutDocument` pages as 8.5x11 sheets, one absolutely positioned element per line (Courier Prime, engine x/y), click a line -> `onRequestEdit(elementId, offset)`. `useLayout(host)` debounces (150 ms trailing), skips unchanged versions, and loads the engine through a dynamic `import('./layout-engine')` (writing_core's font tables are ~10 MB; the app's Vite config marks `writing_core/src/{fonts,layout}` side-effect free so they stay out of the initial chunk). Generated lines (`(MORE)`, synthesized `NAME (CONT'D)` cues, scene CONTINUED; `line.kind !== 'text'`) render as `.wui-gl` (`data-kind`), never clickable; dual dialogue needs nothing special because each line already carries its column x (`data-dual-side`). Page number is a plain "N." on pages 2+ (engine runs no headers yet). `ScriptEditor` takes `initialCaret` to land the caret after a click from the page view. Editing in the page view is deferred (hidden-sink design).
- `src/Navigator.tsx`, `src/IndexCards.tsx`, `src/useScenes.ts`, `src/structure-ops.ts`, `src/styles/structure.css` — structure panels (spec 08 §12.2, thin): scene list / card grid from `host.model.scenes()`, click-to-jump (`onJumpTo` / `onOpenScene` with the heading element id), inline synopsis + heading edit, native HTML5 drag reorder (ONE `scene.move` per drop, never batched: `move`/`delete` read a stale `ctx.model` inside a batch), "Add card" (`element.insert` of a scene heading). `useScenes` republishes only when a row's shown data changes; rows are `memo`'d on primitives. `Navigator` highlights the scene of `activeElementId` (default: the editor's selection via `useEditorSelection`). **`scene.setSynopsis` is not in `writing_core` yet**: `structure-ops.ts` registers it (spec 08 §3.2 shape `{ scene, value }`, hand-validated params, no zod dep) unless the core already has it. Skipped: folders/acts, multi-select, colour edit, extra columns, CSV, printing, grid keyboard nav, `sceneText`.
- `src/RemoteCursors.tsx`, `src/ElementStylePicker.tsx`, `src/selection-store.ts` (shares selection with the picker via a per-host WeakMap).
- `demo/` — Vite demo plus `memory-host.ts`, an in-memory host (executor + session undo + subscription). Tests reuse it.
- `assets/fonts/` — Courier Prime (SIL OFL, `OFL.txt`); 12 pt advances exactly 0.1 in (10 cpi).

## Commands

- `bun run typecheck` — `tsc --noEmit` (src, demo, tests).
- `bun run test:unit` — `bunx vitest run` (jsdom smoke tests: render, typing, Enter, merge, marks, paste, Tab, undo, composition, remote cursor).
- `bun run demo` — Vite on http://localhost:5183 with a seeded screenplay.
- `bun run build` — typecheck plus a demo bundle in `dist-demo/`.

## The host interface

`ScriptEditorHost` mirrors `screenwriter_lib`'s `DocumentSession`: `model`, `execute(commands, {kind, groupKey})`, `undo()/redo()`, `subscribe(listener)` (a `null` batch = model rebuilt), `remoteCursors`, `setLocalCursor(cursor)`, optional `noteCaret(id)` and `on('presence', fn)`. The app passes the session, or a thin adapter. Cursor payload shape is `EditorCursor = {anchor, head}` of `PlainPos {elementId, offset}`.

## Decision: controlled contenteditable (speed view)

Each element is a real editable block. Every `beforeinput` is `preventDefault`ed and turned into a command; the DOM is then re-rendered from the read model. Why: native caret, selection, scrolling and mostly-free IME with the least code. The hidden-sink / custom-caret design (spec 08 sections 5.3, 11.2) is the right end state for paginated page view and is deferred; expect this file layer to be replaced or wrapped then. Use native listeners (`addEventListener('beforeinput')`); React's `onBeforeInput` is a different event.

## Caret restoration rule

React re-renders text nodes, which destroys the browser caret. Therefore: every input path calls `env.setCaret(anchor, head)` with the model-space caret; `ScriptEditor` stores it in `pendingSel` and a `useLayoutEffect` (no deps) writes the DOM selection after each commit. Model changes from elsewhere capture the current DOM selection in the `subscribe` callback before the render. Undo/redo have no caret from the model, so `history()` infers it from the text diff of the caret element. Never re-render an element mid-IME composition (`frozen` prop); on `compositionend` the element is remounted (nonce in the React key) and the composed text is applied via `text.replaceRange`. A new input path that forgets `setCaret` will make the caret jump.

## Positions

`WireDocPos.offset` is a Y.Text index (embeds count); the DOM and `PlainPos` use plain UTF-16 offsets. Convert with `plainToYIndex` / `yIndexToPlain` using `element.text.embeds[].at`.

## The Yjs rule

`writing_core`, the host and this package must load ONE Yjs. `tsconfig.json` `paths` map `yjs` twice (extensionless `dist/yjs` first so Bun/Vite load `yjs.mjs`, then the directory for types) to `../writing_core/node_modules/yjs`; `vitest.config.ts` and `demo/vite.config.ts` alias it and set `resolve.dedupe: ['yjs','lib0','react','react-dom']`. `tests/editor.test.tsx` proves it with `instanceof Y.Doc`. Keep the three files in sync.

## Gotchas

- `registerBuiltinCommands()` must have run (done in `src/input.ts`); the registry is a process-wide singleton.
- Uppercase styles use CSS `text-transform`; stored text keeps its case (engine caret-mapped casing is for later).
- Empty blocks and blocks ending in a soft return carry a `<br data-sentinel>`; position mapping ignores it.
- Hidden-in-script styles render dimmed with a left rule, non-printing ones hatched, omitted scenes struck through.

## Related projects

`writing_core` · `screenwriter_lib` · `screenwriter_app` · `writing_ui_rn` · `screenwriter_plans` (spec 08)
