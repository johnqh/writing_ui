import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

// Mirrors tsconfig `paths` (keep in sync). yjs/lib0 MUST point at writing_core's copy: one Yjs instance.
export default defineConfig({
  root: p('.'),
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@sudobility\/writing_core$/, replacement: p('../../writing_core/src/index.ts') },
      { find: /^yjs$/, replacement: p('../../writing_core/node_modules/yjs/dist/yjs.mjs') },
      { find: /^lib0\/(.*)$/, replacement: p('../../writing_core/node_modules/lib0/') + '$1' },
    ],
    dedupe: ['yjs', 'lib0', 'react', 'react-dom'],
  },
  server: { fs: { allow: [p('..'), p('../../writing_core')] }, port: 5183 },
  build: { outDir: p('../dist-demo'), emptyOutDir: true },
});
