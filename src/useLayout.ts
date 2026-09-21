import type { DocLayout, DocPage, DocumentModel } from '@sudobility/writing_core';
import { useEffect, useState } from 'react';
import type { ScriptEditorHost } from './host';

/** `loading`: engine not loaded yet; `ready`: `pages` match the model; `stale`: an edit is waiting on the debounce. */
export type LayoutStatus = 'loading' | 'ready' | 'stale' | 'error';

export interface UseLayoutResult {
  layout: DocLayout | null;
  pages: readonly DocPage[];
  pageCount: number;
  status: LayoutStatus;
  error: Error | null;
}

export interface UseLayoutOptions {
  /** Trailing debounce after a model change. Default 150 ms. */
  debounceMs?: number;
  /** When false the hook is inert (no engine load, no subscription). Default true. */
  enabled?: boolean;
}

type Engine = typeof import('./layout-engine');
let enginePromise: Promise<Engine> | null = null;
/** Loads the layout engine once per page load. */
export function loadLayoutEngine(): Promise<Engine> {
  return (enginePromise ??= import('./layout-engine').catch((e) => {
    enginePromise = null;
    throw e;
  }));
}

const NON_ELEMENT_LAYOUT_KINDS = new Set(['template', 'titlePage', 'settings', 'production', 'revisions', 'trackChanges']);

function signature(model: DocumentModel, epoch: number): string {
  const parts: string[] = [String(epoch)];
  for (const v of model.elements()) parts.push(`${v.id}:${model.textVersion(v.id)}.${model.attrsVersion(v.id)}`);
  return parts.join('|');
}

const EMPTY: readonly DocPage[] = [];
const INITIAL: UseLayoutResult = { layout: null, pages: EMPTY, pageCount: 0, status: 'loading', error: null };

/**
 * Lays the host's document out into pages with the `writing_core` engine (main thread). Recomputes on model
 * changes, debounced (trailing), and skips the work when the model's per-element versions have not moved.
 */
export function useLayout(host: ScriptEditorHost | null, options: UseLayoutOptions = {}): UseLayoutResult {
  const { debounceMs = 150, enabled = true } = options;
  const [state, setState] = useState<UseLayoutResult>(INITIAL);

  useEffect(() => {
    if (!host || !enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let engine: Engine | null = null;
    let lastSig: string | null = null;
    let lastModel: DocumentModel | null = null;
    let epoch = 0;

    const compute = () => {
      timer = null;
      if (disposed || !engine) return;
      const model = host.model;
      const sig = signature(model, epoch);
      if (sig === lastSig && model === lastModel) {
        setState((s) => (s.status === 'ready' ? s : { ...s, status: 'ready' }));
        return;
      }
      try {
        const layout = engine.layoutDocument(model);
        lastSig = sig;
        lastModel = model;
        setState({ layout, pages: layout.pages, pageCount: layout.pages.length, status: 'ready', error: null });
      } catch (e) {
        setState((s) => ({ ...s, status: 'error', error: e instanceof Error ? e : new Error(String(e)) }));
      }
    };

    const unsub = host.subscribe((batch) => {
      if (!batch || batch.changes.some((c) => NON_ELEMENT_LAYOUT_KINDS.has(c.kind))) epoch++;
      if (!engine) return; // the first compute after the engine loads reads the latest model
      setState((s) => (s.status === 'ready' ? { ...s, status: 'stale' } : s));
      if (timer) clearTimeout(timer);
      timer = setTimeout(compute, debounceMs);
    });

    loadLayoutEngine().then(
      (e) => {
        if (disposed) return;
        engine = e;
        compute();
      },
      (e) => {
        if (!disposed) setState((s) => ({ ...s, status: 'error', error: e instanceof Error ? e : new Error(String(e)) }));
      },
    );

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [host, enabled, debounceMs]);

  return state;
}
