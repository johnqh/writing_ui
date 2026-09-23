import { existsSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const writingCoreDir = p('../../writing_core');
// Only when the sibling repo is actually checked out (local dev, "local-packages phase"): otherwise
// fall through to the real, published `@sudobility/writing_core` npm dependency and whatever
// yjs/lib0 it transitively installs — CI (which checks out only this one repo, and still runs this
// config via `bun run build`) does not have `../../writing_core` at all.
const hasWritingCoreSibling = existsSync(writingCoreDir);

// Mirrors tsconfig `paths` (keep in sync). yjs/lib0 MUST point at writing_core's copy: one Yjs instance.
export default defineConfig({
  root: p('.'),
  plugins: [react()],
  resolve: {
    alias: hasWritingCoreSibling
      ? [
          { find: /^@sudobility\/writing_core$/, replacement: p('../../writing_core/src/index.ts') },
          { find: /^yjs$/, replacement: p('../../writing_core/node_modules/yjs/dist/yjs.mjs') },
          { find: /^lib0\/(.*)$/, replacement: p('../../writing_core/node_modules/lib0/') + '$1' },
        ]
      : [],
    dedupe: ['yjs', 'lib0', 'react', 'react-dom'],
  },
  server: { fs: { allow: hasWritingCoreSibling ? [p('..'), writingCoreDir] : [p('..')] }, port: 5183 },
  build: { outDir: p('../dist-demo'), emptyOutDir: true },
});
