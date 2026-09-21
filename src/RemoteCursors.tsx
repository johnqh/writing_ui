import { useLayoutEffect, useState } from 'react';
import type { DocumentModel } from '@sudobility/writing_core';
import { findBlock, plainToDomPoint } from './dom-positions';
import type { EditorCursor, PlainPos, RemoteCursorInfo } from './host';

interface Placed {
  clientId: number;
  name: string;
  color: string;
  left: number;
  top: number;
  height: number;
}

function parseCursor(raw: unknown): EditorCursor | null {
  const c = raw as Partial<EditorCursor> | null;
  const ok = (p: unknown): p is PlainPos => !!p && typeof (p as PlainPos).elementId === 'string' && Number.isFinite((p as PlainPos).offset);
  if (!c || !ok(c.head)) return null;
  return { anchor: ok(c.anchor) ? c.anchor : c.head, head: c.head };
}

function caretRect(page: HTMLElement, pos: PlainPos): DOMRect | null {
  const block = findBlock(page, pos.elementId);
  if (!block) return null;
  const point = plainToDomPoint(page, pos);
  if (point) {
    const range = page.ownerDocument.createRange();
    range.setStart(point.node, point.offset);
    range.collapse(true);
    const rect = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null;
    if (rect && (rect.height > 0 || rect.width > 0)) return rect;
    const first = typeof range.getClientRects === 'function' ? range.getClientRects()[0] : undefined;
    if (first && first.height > 0) return first;
  }
  return block.getBoundingClientRect();
}

/** Coloured carets with name labels, positioned with `Range.getBoundingClientRect` relative to the scroll container. */
export function RemoteCursors(props: {
  container: HTMLElement | null;
  page: HTMLElement | null;
  model: DocumentModel;
  cursors: ReadonlyMap<number, RemoteCursorInfo>;
  /** Bumped on scroll/resize/render so positions recompute. */
  tick: number;
}) {
  const { container, page, model, cursors, tick } = props;
  const [placed, setPlaced] = useState<Placed[]>([]);

  useLayoutEffect(() => {
    if (!container || !page) return setPlaced([]);
    const cRect = container.getBoundingClientRect();
    const out: Placed[] = [];
    for (const info of cursors.values()) {
      const cur = parseCursor(info.cursor);
      if (!cur || !model.element(cur.head.elementId as never)) continue;
      const rect = caretRect(page, cur.head);
      if (!rect) continue;
      out.push({
        clientId: info.clientId,
        name: info.user?.name ?? 'Guest',
        color: info.user?.color ?? '#d946ef',
        left: rect.left - cRect.left + container.scrollLeft,
        top: rect.top - cRect.top + container.scrollTop,
        height: rect.height || 16,
      });
    }
    setPlaced((prev) => (JSON.stringify(prev) === JSON.stringify(out) ? prev : out));
  }, [container, page, model, cursors, tick]);

  return (
    <div className="wui-overlay" aria-hidden="true">
      {placed.map((p) => (
        <div key={p.clientId} className="wui-remote-caret" data-remote-cursor={p.clientId} style={{ left: p.left, top: p.top, height: p.height, background: p.color }}>
          <span className="wui-remote-label" style={{ background: p.color }}>
            {p.name}
          </span>
        </div>
      ))}
    </div>
  );
}
