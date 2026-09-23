import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const writingCoreDir = p("../writing_core");
const writingFormatsDir = p("../writing_formats");
// Only when the sibling repo is actually checked out (local dev, "local-packages phase"): otherwise
// fall through to the real, published `@sudobility/writing_core` npm dependency (package.json) and
// whatever yjs/lib0 it transitively installs — still exactly one copy of each, just resolved via
// node_modules instead of a `../writing_core` path CI (which checks out only this one repo) does
// not have.
const hasWritingCoreSibling = existsSync(writingCoreDir);
// Same idea for the `fountain-classify` subpath: alias straight to source when the sibling is checked
// out (so classifier changes there are picked up without a republish), else fall through to the real,
// published `@sudobility/writing_formats` dependency.
const hasWritingFormatsSibling = existsSync(writingFormatsDir);

export default defineConfig({
  // Vitest does not read tsconfig `paths`; mirror them here (keep in sync with tsconfig.json).
  // yjs/lib0 MUST point at writing_core's copy: one Yjs instance at runtime.
  resolve: {
    alias: [
      ...(hasWritingCoreSibling
        ? [
            { find: /^@sudobility\/writing_core$/, replacement: p("../writing_core/src/index.ts") },
            { find: /^yjs$/, replacement: p("../writing_core/node_modules/yjs/dist/yjs.mjs") },
            { find: /^lib0\/(.*)$/, replacement: p("../writing_core/node_modules/lib0/") + "$1" },
          ]
        : []),
      ...(hasWritingFormatsSibling
        ? [{ find: /^@sudobility\/writing_formats\/fountain-classify$/, replacement: p("../writing_formats/src/fountain/classify.ts") }]
        : []),
    ],
    dedupe: ["yjs", "lib0", "react", "react-dom"],
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "src/**/*.test.ts", "src/**/*.test.tsx"],
    testTimeout: 30000,
  },
});
