import { useSyncExternalStore } from 'react';
import type { PlainPos, ScriptEditorHost } from './host';

export interface EditorSelection {
  anchor: PlainPos;
  head: PlainPos;
}

/** Shares the editor's current selection with siblings (ElementStylePicker) without a React context. */
export class SelectionStore {
  private value: EditorSelection | null = null;
  private listeners = new Set<() => void>();
  /** Registered by the mounted ScriptEditor so a toolbar can hand focus back after acting. */
  focusEditor: (() => void) | null = null;

  get = (): EditorSelection | null => this.value;

  set(next: EditorSelection | null): void {
    const prev = this.value;
    if (prev === next) return;
    if (prev && next && prev.anchor.elementId === next.anchor.elementId && prev.anchor.offset === next.anchor.offset && prev.head.elementId === next.head.elementId && prev.head.offset === next.head.offset) return;
    this.value = next;
    this.listeners.forEach((l) => l());
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };
}

const stores = new WeakMap<object, SelectionStore>();

export function getSelectionStore(host: ScriptEditorHost): SelectionStore {
  let s = stores.get(host);
  if (!s) stores.set(host, (s = new SelectionStore()));
  return s;
}

/** The last selection inside the `ScriptEditor` mounted on `host` (survives the editor losing focus). */
export function useEditorSelection(host: ScriptEditorHost): EditorSelection | null {
  const store = getSelectionStore(host);
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
