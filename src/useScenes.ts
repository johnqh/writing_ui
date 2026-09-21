import { useEffect, useRef, useState } from 'react';
import { assignNumbers, formatNumberLabel, resolveStyle, type DocumentModel, type SceneView } from '@sudobility/writing_core';
import type { ScriptEditorHost } from './host';
import { sceneSignature } from './structure-ops';

/**
 * Scenes with their DISPLAYED number: the stored (locked) label, or the provisional/auto one from the numbering pass
 * (`3A` for a scene inserted after a locked 3). Only while scene numbering is enabled; otherwise as the model has them.
 */
function withNumbers(model: DocumentModel, scenes: readonly SceneView[]): readonly SceneView[] {
  try {
    const t = model.template();
    const styleId = t.sceneNumbering.styleId;
    if (!t.styles.some((st) => st.id === styleId) || !resolveStyle(t, styleId).numbering?.enabled) return scenes;
    const labels = assignNumbers(model).labels;
    return scenes.map((s) => {
      const a = labels.get(s.id);
      if (!a) return s;
      return { ...s, number: a.label.custom === '' ? '' : formatNumberLabel(a.label) };
    });
  } catch {
    return scenes;
  }
}

const sigOf = (scenes: readonly SceneView[]) => scenes.map(sceneSignature).join('\n');

/**
 * The host's scenes, kept live. `model.scenes()` yields fresh frozen objects after every element edit, so the hook
 * only publishes a new array when what a row shows (id, heading, number, synopsis, omitted, colour) changed.
 */
export function useScenes(host: ScriptEditorHost): readonly SceneView[] {
  const [scenes, setScenes] = useState<readonly SceneView[]>(() => withNumbers(host.model, host.model.scenes()));
  const sig = useRef(sigOf(scenes));
  useEffect(() => {
    const refresh = () => {
      const next = withNumbers(host.model, host.model.scenes());
      const s = sigOf(next);
      if (s === sig.current) return;
      sig.current = s;
      setScenes(next);
    };
    refresh();
    return host.subscribe((batch) => {
      if (batch && !batch.changes.some((c) => c.kind === 'elements' || c.kind === 'folders' || c.kind === 'entities' || c.kind === 'production' || c.kind === 'template')) return;
      refresh();
    });
  }, [host]);
  return scenes;
}
