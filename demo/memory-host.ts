import {
  createDocument,
  createSessionOrigins,
  createSessionUndo,
  cryptoIdSource,
  executeBatch,
  getBuiltinTemplate,
  openDocument,
  registerBuiltinCommands,
  type Actor,
  type BatchResult,
  type CommandInvocation,
  type DocumentModel,
  type ModelChangeBatch,
} from '@sudobility/writing_core';
import type { HostExecuteOptions, RemoteCursorInfo, ScriptEditorHost } from '../src/host';

export interface SeedElement {
  style: string;
  text: string;
}

export interface MemoryHost extends ScriptEditorHost {
  readonly doc: import('yjs').Doc;
  /** Test/demo helper: pretend a collaborator published a cursor. */
  setRemoteCursors(cursors: RemoteCursorInfo[]): void;
  lastCursor: unknown;
  dispose(): void;
}

export const DEFAULT_SEED: SeedElement[] = [
  { style: 'st_scene_heading', text: 'int. writers room - night' },
  { style: 'st_action', text: 'A single lamp burns over a battered laptop. MAYA (30s) stares at the blinking cursor.' },
  { style: 'st_character', text: 'Maya' },
  { style: 'st_dialogue', text: 'Twelve drafts. Not one of them knows how it ends.' },
];

/**
 * A local, network-free `ScriptEditorHost`: a `writing_core` document with a command executor, a per-session
 * undo manager and a change subscription. This is what `screenwriter_lib`'s document session provides, minus
 * sync. Seeding runs under an untracked origin so undo never removes the seed.
 */
export function createMemoryHost(options: { templateKey?: string; seed?: SeedElement[]; clock?: () => number } = {}): MemoryHost {
  registerBuiltinCommands();
  const ids = cryptoIdSource;
  const clock = options.clock ?? (() => Date.now());
  const actor: Actor = { userId: 'local', displayName: 'You', color: '#2563eb', kind: 'human' };
  const template = getBuiltinTemplate(options.templateKey ?? 'screenplay-standard');
  if (!template) throw new Error('unknown template');
  const doc = createDocument({ template, uid: actor.userId, ids, clock });
  const model: DocumentModel = openDocument(doc, { ids, clock, locale: 'en' });
  const origins = createSessionOrigins(actor);
  const undo = createSessionUndo(doc, origins, { clock });
  const capabilities = new Set(['write', 'comment'] as const);
  const listeners = new Set<(b: ModelChangeBatch | null) => void>();
  const presence = new Set<(c: ReadonlyMap<number, RemoteCursorInfo>) => void>();
  let remote: ReadonlyMap<number, RemoteCursorInfo> = new Map();
  const unsubModel = model.subscribe((batch) => listeners.forEach((l) => l(batch)));

  const run = (commands: readonly CommandInvocation[], origin = origins.make('local-command')): BatchResult =>
    executeBatch({ doc, model, commands, actor, origin, capabilities, ids, clock, readOnly: false });

  // Seed: replace the template's starter elements with our own, under the untracked 'system' origin.
  const seed = options.seed ?? DEFAULT_SEED;
  const sysOrigin = origins.make('system');
  for (const v of [...model.elements()]) run([{ id: 'text.deleteBackward', params: { at: { elementId: v.id, offset: 0 }, unit: 'element' } }], sysOrigin);
  for (const s of seed) run([{ id: 'element.insert', params: { style: s.style, text: s.text } }], sysOrigin);

  const host: MemoryHost = {
    doc,
    lastCursor: null,
    get model() {
      return model;
    },
    execute(commands, opts: HostExecuteOptions = {}) {
      return run(commands, origins.make(opts.kind ?? 'local-command', opts.groupKey ? { groupKey: opts.groupKey } : {}));
    },
    undo: () => undo.undo(),
    redo: () => undo.redo(),
    noteCaret: (id) => undo.noteCaret(id),
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    get remoteCursors() {
      return remote;
    },
    setLocalCursor(cursor) {
      host.lastCursor = cursor;
    },
    on(_event, fn) {
      presence.add(fn);
      return () => void presence.delete(fn);
    },
    setRemoteCursors(cursors) {
      remote = new Map(cursors.map((c) => [c.clientId, c]));
      presence.forEach((p) => p(remote));
    },
    dispose() {
      unsubModel();
      undo.destroy();
      model.dispose();
      doc.destroy();
    },
  };
  return host;
}
