import { useEffect, useRef, useState } from 'react';
import type { SceneView } from '@sudobility/writing_core';
import type { ScriptEditorHost } from './host';
import { sceneSignature } from './structure-ops';

const sigOf = (scenes: readonly SceneView[]) => scenes.map(sceneSignature).join('\n');

/**
 * The host's scenes, kept live. `model.scenes()` yields fresh frozen objects after every element edit, so the hook
 * only publishes a new array when what a row shows (id, heading, number, synopsis, omitted, colour) changed.
 */
export function useScenes(host: ScriptEditorHost): readonly SceneView[] {
  const [scenes, setScenes] = useState<readonly SceneView[]>(() => host.model.scenes());
  const sig = useRef(sigOf(scenes));
  useEffect(() => {
    const refresh = () => {
      const next = host.model.scenes();
      const s = sigOf(next);
      if (s === sig.current) return;
      sig.current = s;
      setScenes(next);
    };
    refresh();
    return host.subscribe((batch) => {
      if (batch && !batch.changes.some((c) => c.kind === 'elements' || c.kind === 'folders' || c.kind === 'entities')) return;
      refresh();
    });
  }, [host]);
  return scenes;
}
