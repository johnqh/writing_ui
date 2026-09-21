import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { readDomSelection, writeDomSelection } from './dom-positions';
import { ElementBlock } from './ElementBlock';
import { pageGeometry } from './geometry';
import type { EditorCursor, PlainPos, RemoteCursorInfo, ScriptEditorHost } from './host';
import { createInputController } from './input';
import { RemoteCursors } from './RemoteCursors';
import { getSelectionStore } from './selection-store';
import './styles/editor.css';

export interface ScriptEditorProps {
  host: ScriptEditorHost;
  readOnly?: boolean;
  className?: string;
  /** Shown in an empty document. */
  placeholder?: string;
  /** Put the caret here (and focus the editor, scrolled into view) when this prop is set/changes: used when switching in from the page view. */
  initialCaret?: PlainPos | null;
}

const CURSOR_THROTTLE_MS = 100;

/**
 * Speed-view script editor: every element is a real editable block, `beforeinput` is cancelled and turned
 * into a `writing_core` command, and the DOM is re-rendered from the read model. The caret is restored after
 * every render from `pendingSel` (see CLAUDE.md, "caret restoration rule").
 */
export function ScriptEditor({ host, readOnly = false, className, placeholder = 'Start writing…', initialCaret = null }: ScriptEditorProps) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [geoTick, bumpGeo] = useReducer((n: number) => n + 1, 0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [nodes, setNodes] = useState<{ container: HTMLElement | null; page: HTMLElement | null }>({ container: null, page: null });

  const pendingSel = useRef<{ anchor: PlainPos; head: PlainPos } | null | undefined>(undefined);
  const epoch = useRef(0);
  const nonces = useRef(new Map<string, number>());
  const composingId = useRef<string | null>(null);
  const hostRef = useRef(host);
  hostRef.current = host;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const [cursors, setCursors] = useState<ReadonlyMap<number, RemoteCursorInfo>>(host.remoteCursors);

  const controller = useMemo(
    () =>
      createInputController({
        host: () => hostRef.current,
        root: () => pageRef.current,
        readOnly: () => readOnlyRef.current,
        setCaret: (anchor, head) => {
          pendingSel.current = anchor ? { anchor, head: head ?? anchor } : null;
          bump();
        },
        remount: (id) => {
          nonces.current.set(id, (nonces.current.get(id) ?? 0) + 1);
          bump();
        },
        setComposing: (id) => {
          composingId.current = id;
        },
      }),
    [],
  );

  // Model changes: re-render, and keep the DOM selection across it (a local edit overrides this via setCaret).
  useEffect(() => {
    setCursors(host.remoteCursors);
    const unsub = host.subscribe((batch) => {
      if (!batch || batch.changes.some((c) => c.kind === 'template')) epoch.current++;
      const page = pageRef.current;
      if (pendingSel.current === undefined && page && page.ownerDocument.activeElement === page) {
        const sel = readDomSelection(page);
        if (sel) pendingSel.current = sel;
      }
      setCursors(hostRef.current.remoteCursors);
      bump();
    });
    const unsubPresence = host.on?.('presence', (c) => setCursors(new Map(c)));
    return () => {
      unsub();
      unsubPresence?.();
    };
  }, [host]);

  // Caret survival: after React commits, put the DOM selection back where the model says it is.
  useLayoutEffect(() => {
    const page = pageRef.current;
    const want = pendingSel.current;
    pendingSel.current = undefined;
    if (!page || !want) return;
    writeDomSelection(page, want.anchor, want.head);
    getSelectionStore(hostRef.current).set(want);
  });

  // A caret requested from outside (page view click): focus, select, and bring the element into view.
  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!initialCaret || !page) return;
    page.focus({ preventScroll: true });
    writeDomSelection(page, initialCaret, initialCaret);
    getSelectionStore(hostRef.current).set({ anchor: initialCaret, head: initialCaret });
    const block = Array.from(page.querySelectorAll<HTMLElement>('[data-el-id]')).find((el) => el.dataset.elId === initialCaret.elementId);
    block?.scrollIntoView?.({ block: 'center' });
  }, [initialCaret]);

  // Native listeners: React's onBeforeInput is not the DOM `beforeinput` event.
  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const onBI = (e: Event) => controller.onBeforeInput(e as InputEvent);
    const onKD = (e: Event) => controller.onKeyDown(e as KeyboardEvent);
    const onCS = () => controller.onCompositionStart();
    const onCE = (e: Event) => controller.onCompositionEnd(e as CompositionEvent);
    page.addEventListener('beforeinput', onBI);
    page.addEventListener('keydown', onKD);
    page.addEventListener('compositionstart', onCS);
    page.addEventListener('compositionend', onCE);
    return () => {
      page.removeEventListener('beforeinput', onBI);
      page.removeEventListener('keydown', onKD);
      page.removeEventListener('compositionstart', onCS);
      page.removeEventListener('compositionend', onCE);
    };
  }, [controller]);

  // Publish the local selection (throttled) and tell the undo manager when the caret changes element.
  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const doc = page.ownerDocument;
    const store = getSelectionStore(hostRef.current);
    store.focusEditor = () => page.focus();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last: EditorCursor | null = null;
    let lastTime = 0;
    const flush = () => {
      timer = null;
      lastTime = Date.now();
      hostRef.current.setLocalCursor(last);
    };
    const onSel = () => {
      const sel = readDomSelection(page);
      if (!sel) return;
      store.set(sel);
      hostRef.current.noteCaret?.(sel.head.elementId);
      last = sel;
      const wait = CURSOR_THROTTLE_MS - (Date.now() - lastTime);
      if (wait <= 0) flush();
      else if (!timer) timer = setTimeout(flush, wait);
    };
    doc.addEventListener('selectionchange', onSel);
    return () => {
      doc.removeEventListener('selectionchange', onSel);
      if (timer) clearTimeout(timer);
      if (store.focusEditor) store.focusEditor = null;
    };
  }, [host]);

  // Layout changes move remote carets.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onGeo = () => bumpGeo();
    container.addEventListener('scroll', onGeo, { passive: true });
    window.addEventListener('resize', onGeo);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(onGeo) : null;
    if (ro && pageRef.current) ro.observe(pageRef.current);
    return () => {
      container.removeEventListener('scroll', onGeo);
      window.removeEventListener('resize', onGeo);
      ro?.disconnect();
    };
  }, []);

  const setContainer = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
    setNodes((n) => (n.container === el ? n : { ...n, container: el }));
  }, []);
  const setPage = useCallback((el: HTMLDivElement | null) => {
    pageRef.current = el;
    setNodes((n) => (n.page === el ? n : { ...n, page: el }));
  }, []);

  const model = host.model;
  const geo = pageGeometry(model);
  const elements = model.elements();
  const only = elements.length === 1;

  return (
    <div ref={setContainer} className={['wui-editor', className].filter(Boolean).join(' ')} data-testid="script-editor">
      <div
        ref={setPage}
        className="wui-page"
        role="textbox"
        aria-multiline="true"
        aria-readonly={readOnly}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        spellCheck={false}
        style={{ width: `${geo.textWidthIn}in` }}
      >
        {elements.length === 0 ? (
          <div className="wui-el wui-role-action" data-placeholder={placeholder} data-empty="" data-empty-document="">
            <br data-sentinel="" />
          </div>
        ) : (
          elements.map((v) => {
            const id = String(v.id);
            const nonce = nonces.current.get(id) ?? 0;
            return (
              <ElementBlock
                key={`${id}:${nonce}`}
                model={model}
                id={id}
                vkey={`${model.textVersion(v.id)}.${model.attrsVersion(v.id)}.${epoch.current}`}
                linesPerInch={geo.linesPerInch}
                frozen={composingId.current === id}
                {...(only ? { placeholder } : {})}
              />
            );
          })
        )}
      </div>
      <RemoteCursors container={nodes.container} page={nodes.page} model={model} cursors={cursors} tick={geoTick} />
    </div>
  );
}
