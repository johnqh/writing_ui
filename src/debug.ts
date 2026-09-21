/**
 * Opt-in causality log. Inert unless the page sets `window.__wuiDebug = []` before the editor runs
 * (a Playwright soak test does this); then every command the editor issues, and the DOM events that led to it,
 * are pushed onto that array. No cost and no behaviour change otherwise.
 */
export function wuiDebug(kind: string, data: Record<string, unknown> = {}): void {
  const sink = (globalThis as { __wuiDebug?: unknown }).__wuiDebug;
  if (!Array.isArray(sink)) return;
  const stack = (new Error().stack ?? '').split('\n').slice(2, 6).map((l) => l.trim().replace(/\(.*[\\/]/, '('));
  sink.push({ t: Date.now(), kind, ...data, stack });
}
