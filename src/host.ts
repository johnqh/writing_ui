import type { BatchResult, CommandInvocation, DocumentModel, ModelChangeBatch } from '@sudobility/writing_core';

export type Unsubscribe = () => void;

/** A position as the editor sees it: element id plus a UTF-16 offset into the element's plain text (embeds excluded). */
export interface PlainPos {
  elementId: string;
  offset: number;
}

/** What `setLocalCursor` publishes and `remoteCursors[].cursor` is expected to carry (plain offsets). */
export interface EditorCursor {
  anchor: PlainPos;
  head: PlainPos;
}

export interface RemoteCursorInfo {
  readonly clientId: number;
  readonly user: { id: string; name: string; color: string } | null;
  /** Whatever the peer passed to `setLocalCursor`; the editor reads it as an `EditorCursor` and ignores anything else. */
  readonly cursor: unknown;
}

export interface HostExecuteOptions {
  /** `local-typing` for keystrokes, `local-command` (default) for everything else. Both are undoable. */
  kind?: 'local-typing' | 'local-command';
  /** Consecutive commands with the same key merge into one undo step. */
  groupKey?: string;
}

/**
 * The only thing `ScriptEditor` knows about the outside world. Deliberately shaped like
 * `screenwriter_lib`'s `DocumentSession` so the app's adapter is `session` itself (or a thin
 * pass-through); this package never imports the lib.
 */
export interface ScriptEditorHost {
  /** The current read model. Re-read after a `subscribe(null)` notification (the model was rebuilt). */
  readonly model: DocumentModel;
  execute(commands: readonly CommandInvocation[], options?: HostExecuteOptions): BatchResult;
  /** Undo/redo this user's own edits only. Return false when there was nothing to do. */
  undo(): boolean;
  redo(): boolean;
  /** Model change notifications; `null` means the whole model was rebuilt. */
  subscribe(listener: (batch: ModelChangeBatch | null) => void): Unsubscribe;
  readonly remoteCursors: ReadonlyMap<number, RemoteCursorInfo>;
  setLocalCursor(cursor: unknown): void;
  /** Optional: tell the undo manager the caret moved to another element (starts a new undo step). */
  noteCaret?(elementId: string | null): void;
  /** Optional: presence updates. Without it, remote cursors refresh on model changes only. */
  on?(event: 'presence', fn: (cursors: ReadonlyMap<number, RemoteCursorInfo>) => void): Unsubscribe;
}
