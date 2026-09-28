import { useEffect, useLayoutEffect, useState } from 'react';
import type { DocumentModel } from '@sudobility/writing_core';
import { caretRect } from './RemoteCursors';
import { useEditorSelection } from './selection-store';
import type { ScriptEditorHost } from './host';

/** How long the type stays on screen after it was changed on a line that has text. */
const FLASH_MS = 1600;

interface Placed {
  left: number;
  top: number;
  name: string;
}

/**
 * The type of the line the caret is on (Scene Heading, Character, Dialogue, ...) in a small bubble at the caret.
 * Shown where the writer cannot tell the type from the text: on an EMPTY line (a new line after Enter, a new
 * document), and for a moment after the type was changed from the keyboard (`flash`, bumped by Tab and
 * Cmd/Ctrl+number). It never takes input or focus, and is not part of the document.
 */
export function TypeHint(props: {
  host: ScriptEditorHost;
  model: DocumentModel;
  container: HTMLElement | null;
  page: HTMLElement | null;
  /** The element whose type was just changed, and a counter so the same element can flash again. */
  flash: { elementId: string; n: number } | null;
  /** Bumped on scroll/resize/render so the position recomputes. */
  tick: number;
  readOnly: boolean;
}) {
  const { host, model, container, page, flash, tick, readOnly } = props;
  const selection = useEditorSelection(host);
  const [flashing, setFlashing] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [placed, setPlaced] = useState<Placed | null>(null);

  useEffect(() => {
    if (!flash) return;
    setFlashing(flash.elementId);
    const t = setTimeout(() => setFlashing(null), FLASH_MS);
    return () => clearTimeout(t);
  }, [flash]);

  useEffect(() => {
    if (!page) return;
    const on = () => setFocused(true);
    const off = () => setFocused(false);
    setFocused(page.ownerDocument.activeElement === page);
    page.addEventListener('focus', on);
    page.addEventListener('blur', off);
    return () => {
      page.removeEventListener('focus', on);
      page.removeEventListener('blur', off);
    };
  }, [page]);

  useLayoutEffect(() => {
    const none = () => setPlaced((p) => (p === null ? p : null));
    if (!container || !page || readOnly || !focused || !selection) return none();
    const { anchor, head } = selection;
    if (anchor.elementId !== head.elementId || anchor.offset !== head.offset) return none();
    const view = model.element(head.elementId as never);
    if (!view) return none();
    if (view.text.plain.length > 0 && flashing !== head.elementId) return none();
    const name = model.template().styles.find((s) => s.id === view.style)?.name;
    const rect = caretRect(page, head);
    if (!name || !rect) return none();
    const c = container.getBoundingClientRect();
    const next = { name, left: Math.round(rect.left - c.left + container.scrollLeft), top: Math.round(rect.top - c.top + container.scrollTop + (rect.height || 16)) };
    setPlaced((p) => (p && p.name === next.name && p.left === next.left && p.top === next.top ? p : next));
  }, [container, page, model, selection, flashing, focused, readOnly, tick, flash]);

  if (!placed) return null;
  return (
    <div className="wui-overlay" aria-hidden="true">
      <div className="wui-type-hint" data-testid="type-hint" data-type={placed.name} style={{ left: placed.left, top: placed.top }}>
        <span className="wui-type-hint-name">{placed.name}</span>
        <span className="wui-type-hint-key">Tab to change</span>
      </div>
    </div>
  );
}
