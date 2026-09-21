/**
 * The layout engine behind a dynamic `import()`. `writing_core`'s `layoutDocument` drags in ~10 MB of
 * generated font metrics; nothing but the page view needs it, so `useLayout` loads this module lazily and the
 * app's initial bundle stays small. Import this file only through `import('./layout-engine')`.
 */
export { layoutDocument } from '@sudobility/writing_core';
export type { DocLayout, DocPage, DocLine } from '@sudobility/writing_core';
