import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  // Vitest does not read tsconfig `paths`; mirror them here (keep in sync with tsconfig.json).
  // yjs/lib0 MUST point at writing_core's copy: one Yjs instance at runtime.
  resolve: {
    alias: [
      { find: /^@sudobility\/writing_core$/, replacement: p("../writing_core/src/index.ts") },
      { find: /^yjs$/, replacement: p("../writing_core/node_modules/yjs/dist/yjs.mjs") },
      { find: /^lib0\/(.*)$/, replacement: p("../writing_core/node_modules/lib0/") + "$1" },
    ],
    dedupe: ["yjs", "lib0", "react", "react-dom"],
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "src/**/*.test.ts", "src/**/*.test.tsx"],
    testTimeout: 30000,
  },
});
