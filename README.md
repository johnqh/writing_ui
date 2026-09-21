# @sudobility/writing_ui

React editor components for Fadewright screenplays: a `ScriptEditor` that renders a `@sudobility/writing_core` document as template-styled lines (speed view, not paginated) and edits it through core commands, plus an `ElementStylePicker`.

Status: local packages only, not published. Depends on `../writing_core` by path.

## Usage

```tsx
import { ScriptEditor, ElementStylePicker, type ScriptEditorHost } from '@sudobility/writing_ui';

function Editor({ host }: { host: ScriptEditorHost }) {
  return (
    <>
      <ElementStylePicker host={host} />
      <ScriptEditor host={host} />
    </>
  );
}
```

`ScriptEditorHost` (src/host.ts) matches a `screenwriter_lib` document session: `model`, `execute`, `undo`/`redo`, `subscribe`, `remoteCursors`, `setLocalCursor`.

## API

- `ScriptEditor` props: `host`, `readOnly?`, `className?`, `placeholder?`.
- `ElementStylePicker` props: `host`, `className?`, `disabled?`.
- `useEditorSelection(host)` — the editor's current selection.

## Development

- `bun install`
- `bun run demo` — local demo (no server) at http://localhost:5183
- `bun run typecheck`, `bun run test:unit`

Courier Prime is bundled under the SIL Open Font License (`assets/fonts/OFL.txt`).

## License

BUSL-1.1
