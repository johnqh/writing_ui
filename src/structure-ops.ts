import * as Y from 'yjs';
import {
  defineCommand, getCommand, idSchema, registerBuiltinCommands, registerCommand,
  type CommandSpec, type DocumentModel, type ElementId, type SceneView,
} from '@sudobility/writing_core';
import type { ScriptEditorHost } from './host';
import { plainToYIndex } from './dom-positions';

/**
 * `scene.setSynopsis` is in the spec 08 §3.2 catalogue but not yet implemented by `writing_core`, so this package
 * registers it (same id and `{ scene, value }` params as the catalogue). If the core ever ships its own, `getCommand`
 * finds it first and this one is skipped. Params are validated by hand: this package has no zod dependency.
 */
const SYNOPSIS_ID = 'scene.setSynopsis';
const elId = idSchema('el');

type SynopsisParams = { scene: string; value: string };

const synopsisParams = {
  safeParse(v: unknown) {
    const o = v as Partial<SynopsisParams> | null;
    if (!o || typeof o !== 'object' || typeof o.value !== 'string' || !elId.safeParse(o.scene).success) {
      return { success: false as const, error: { issues: [{ message: 'expected { scene: ElementId, value: string }' }] } };
    }
    return { success: true as const, data: { scene: o.scene as string, value: o.value } };
  },
};

function newSceneMap(): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set('synopsis', new Y.Text());
  m.set('color', null);
  m.set('title', '');
  m.set('locationId', null);
  m.set('storyDay', '');
  m.set('arcBeats', new Y.Map<unknown>());
  m.set('storylineIds', new Y.Map<unknown>());
  m.set('omit', null);
  m.set('versions', new Y.Array<unknown>());
  m.set('estimatedSeconds', null);
  return m;
}

export function ensureStructureCommands(): void {
  registerBuiltinCommands(); // the core now ships scene.setSynopsis itself; register it first so this fallback is skipped
  if (getCommand(SYNOPSIS_ID)) return;
  const spec = defineCommand<SynopsisParams>(
    SYNOPSIS_ID,
    synopsisParams as unknown as CommandSpec<SynopsisParams>['params'],
    (ctx, p) => {
      // Refuse before the first write. Everything after reads/writes the Y.Doc directly (ctx.model is stale mid-transaction).
      if (!ctx.model.scene(p.scene as ElementId)) return { ok: false, reason: 'notFound' };
      const record = ctx.doc.getMap<unknown>('elements').get(p.scene);
      if (!(record instanceof Y.Map)) return { ok: false, reason: 'notFound' };
      let scene = record.get('scene');
      if (!(scene instanceof Y.Map)) scene = record.set('scene', newSceneMap());
      let text = (scene as Y.Map<unknown>).get('synopsis');
      if (!(text instanceof Y.Text)) text = (scene as Y.Map<unknown>).set('synopsis', new Y.Text());
      const t = text as Y.Text;
      if (t.toString() === p.value) return { ok: true };
      if (t.length > 0) t.delete(0, t.length);
      if (p.value) t.insert(0, p.value);
      return { ok: true };
    },
    { scope: 'structure' },
  );
  registerCommand(spec as unknown as CommandSpec<unknown>);
}
ensureStructureCommands();

/** Where a dragged scene lands: before a scene, or after the last scene. */
export type SceneDrop = { before: string } | { after: string };

export function setSynopsis(host: ScriptEditorHost, sceneId: string, value: string): boolean {
  ensureStructureCommands();
  const cur = host.model.scene(sceneId as ElementId);
  if (!cur || cur.synopsis.plain === value) return false;
  return host.execute([{ id: SYNOPSIS_ID, params: { scene: sceneId, value } }], { kind: 'local-command' }).ok;
}

/** Replace the scene heading element's whole text through `text.replaceRange`. */
export function setHeadingText(host: ScriptEditorHost, sceneId: string, value: string): boolean {
  const el = host.model.element(sceneId as ElementId);
  if (!el || el.text.plain === value) return false;
  const end = plainToYIndex(el.text.embeds.map((e) => e.at), el.text.plain.length);
  return host.execute(
    [{ id: 'text.replaceRange', params: { range: { anchor: { elementId: sceneId, offset: 0 }, head: { elementId: sceneId, offset: end } }, text: value } }],
    { kind: 'local-command' },
  ).ok;
}

/** One `scene.move` per drop (never batched: commands other than element.insert read a stale model inside a batch). */
export function moveScene(host: ScriptEditorHost, sceneId: string, drop: SceneDrop): boolean {
  const to = 'before' in drop ? { before: drop.before } : { after: drop.after };
  if (('before' in drop ? drop.before : drop.after) === sceneId) return false;
  return host.execute([{ id: 'scene.move', params: { scenes: [sceneId], to } }], { kind: 'local-command' }).ok;
}

function sceneHeadingStyle(model: DocumentModel): string {
  const first = model.scenes()[0];
  if (first) return String(model.element(first.id)!.style);
  return model.template().styles.find((s) => s.role === 'sceneHeading')?.id ?? 'st_scene_heading';
}

/** Append a new scene heading at the end of the script; returns its element id. */
export function appendScene(host: ScriptEditorHost, text = 'INT. NEW SCENE - DAY'): string | null {
  const r = host.execute([{ id: 'element.insert', params: { style: sceneHeadingStyle(host.model), text } }], { kind: 'local-command' });
  return r.ok ? (r.effects.inserted[0] ?? null) : null;
}

/** Row-memo key: everything a row shows, as primitives, so a keystroke elsewhere re-renders nothing. */
export function sceneSignature(s: SceneView): string {
  return `${s.id}|${s.headingText}|${s.number ?? ''}|${s.index}|${s.synopsis.plain}|${s.omitted ? 1 : 0}|${s.color ?? ''}`;
}

/** Omit or restore a whole scene (`scene.setOmitted`); returns false when the command refused. */
export function setSceneOmitted(host: ScriptEditorHost, sceneId: string, omitted: boolean): boolean {
  return host.execute([{ id: 'scene.setOmitted', params: { scene: sceneId, omitted } }], { kind: 'local-command' }).ok;
}
