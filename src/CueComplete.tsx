import { useEffect, useLayoutEffect, useMemo, useState, type MutableRefObject } from 'react';
import type { DocumentModel } from '@sudobility/writing_core';
import { knownCueNames, matchCueNames } from './cue-names';
import { caretRect } from './RemoteCursors';
import { useEditorSelection } from './selection-store';
import type { ScriptEditorHost } from './host';

/** What the input controller needs of an open list, to give it the keys that operate it. */
export interface CueCompletion {
  move(delta: 1 | -1): void;
  /** The highlighted name, or null when none is. */
  current(): string | null;
  close(): void;
}

/**
 * Character names as you type a cue: on a Character line, a list of the known characters that match what has been
 * typed appears under the line. Arrow keys move, Enter takes the highlighted name and goes on to the next line,
 * Escape closes the list, a click takes a name. The first match is highlighted, except when what was typed already
 * is a known name (then Enter simply goes on). The list is an overlay: it is not part of the document.
 */
export function CueComplete(props: {
  host: ScriptEditorHost;
  model: DocumentModel;
  container: HTMLElement | null;
  page: HTMLElement | null;
  readOnly: boolean;
  tick: number;
  /** Set while the list is open, so keys reach it; null otherwise. */
  handle: MutableRefObject<CueCompletion | null>;
  onAccept(name: string): void;
  onOpenChange?(open: boolean): void;
}) {
  const { host, model, container, page, readOnly, tick, handle, onAccept, onOpenChange } = props;
  const selection = useEditorSelection(host);
  const [index, setIndex] = useState(0);
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);

  const head = selection && selection.anchor.elementId === selection.head.elementId && selection.anchor.offset === selection.head.offset ? selection.head : null;
  const view = head ? model.element(head.elementId as never) : undefined;
  const isCue = !!view && view.role === 'character' && !readOnly;
  const text = isCue ? view!.text.plain : '';
  // Only while typing the name: the caret is at the end of what has been typed.
  const typed = isCue && head!.offset === text.length ? text : '';
  const stamp = `${head?.elementId ?? ''}:${typed}`;
  const version = view ? model.textVersion(view.id) : 0;
  const count = model.elementCount();

  const matches = useMemo(
    () => (typed.trim() ? matchCueNames(knownCueNames(model, head?.elementId), typed, model.meta().language) : { names: [], exact: false }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, typed, head?.elementId, version, count],
  );
  const focused = !!page && page.ownerDocument.activeElement === page;
  const open = matches.names.length > 0 && closedFor !== stamp && focused;

  useEffect(() => setIndex(matches.exact ? -1 : 0), [stamp, matches.exact]);
  useEffect(() => onOpenChange?.(open), [open, onOpenChange]);

  handle.current = open
    ? {
        move: (d) => setIndex((i) => (i + d + matches.names.length + (i < 0 && d < 0 ? 1 : 0)) % matches.names.length),
        current: () => matches.names[index] ?? null,
        close: () => setClosedFor(stamp),
      }
    : null;
  useEffect(() => () => void (handle.current = null), [handle]);

  useLayoutEffect(() => {
    if (!open || !container || !page || !head) return setPlace(null);
    const rect = caretRect(page, { elementId: head.elementId, offset: 0 });
    if (!rect) return setPlace(null);
    const c = container.getBoundingClientRect();
    const next = { left: Math.round(rect.left - c.left + container.scrollLeft), top: Math.round(rect.top - c.top + container.scrollTop + (rect.height || 16)) };
    setPlace((p) => (p && p.left === next.left && p.top === next.top ? p : next));
  }, [open, container, page, head, tick, stamp]);

  if (!open || !place) return null;
  return (
    <div className="wui-overlay">
      <ul className="wui-cue-complete" role="listbox" aria-label="Characters" data-testid="cue-complete" style={{ left: place.left, top: place.top }}>
        {matches.names.map((name, i) => (
          <li
            key={name}
            role="option"
            aria-selected={i === index}
            data-testid="cue-option"
            className={i === index ? 'wui-cue-option wui-cue-option-active' : 'wui-cue-option'}
            // mousedown, not click: the editor must keep its focus and its caret
            onMouseDown={(e) => {
              e.preventDefault();
              onAccept(name);
            }}
            // mousemove, not mouseenter: a list that opens under a resting pointer must not change the highlight
            onMouseMove={() => setIndex((cur) => (cur === i ? cur : i))}
          >
            {name}
          </li>
        ))}
      </ul>
    </div>
  );
}
