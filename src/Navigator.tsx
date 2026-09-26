import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import type { SceneView } from '@sudobility/writing_core';
import type { ScriptEditorHost } from './host';
import { useEditorSelection } from './selection-store';
import { moveScene, setSceneOmitted, setSynopsis, type SceneDrop } from './structure-ops';
import { useScenes } from './useScenes';
import './styles/structure.css';

export interface NavigatorProps {
  host: ScriptEditorHost;
  /** Called with the scene heading's element id when a row is clicked. */
  onJumpTo?(elementId: string): void;
  /** The element the caret is in; its scene is highlighted. Defaults to the mounted editor's selection. */
  activeElementId?: string | null;
  className?: string;
}

interface RowProps {
  id: string;
  label: string;
  heading: string;
  synopsis: string;
  omitted: boolean;
  color: string | null;
  active: boolean;
  dropMark: 'before' | 'after' | null;
  dragging: boolean;
  onJump(id: string): void;
  onSynopsis(id: string, value: string): void;
  onDragStart(id: string, e: DragEvent): void;
  onDragOver(id: string, e: DragEvent): void;
  onDrop(id: string, e: DragEvent): void;
  onDragEnd(): void;
  onMenu(id: string, omitted: boolean, x: number, y: number): void;
}

const Row = memo(function Row(p: RowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const start = (e: { stopPropagation(): void }) => {
    e.stopPropagation();
    setDraft(p.synopsis);
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    if (draft !== p.synopsis) p.onSynopsis(p.id, draft);
  };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') setEditing(false);
  };
  const cls = ['wui-nav-row', p.active && 'wui-active', p.omitted && 'wui-omitted', p.dragging && 'wui-dragging', p.dropMark && `wui-drop-${p.dropMark}`]
    .filter(Boolean)
    .join(' ');
  return (
    <li
      className={cls}
      data-scene-id={p.id}
      data-active={p.active ? 'true' : undefined}
      draggable={!editing}
      onClick={() => p.onJump(p.id)}
      onDragStart={(e) => p.onDragStart(p.id, e)}
      onDragOver={(e) => p.onDragOver(p.id, e)}
      onDrop={(e) => p.onDrop(p.id, e)}
      onDragEnd={p.onDragEnd}
      onContextMenu={(e) => {
        e.preventDefault();
        p.onMenu(p.id, p.omitted, e.clientX, e.clientY);
      }}
      style={p.color ? { borderLeftColor: p.color } : undefined}
    >
      <div className="wui-nav-head">
        <span className="wui-nav-num" data-testid="nav-number">{p.label}</span>
        <span className="wui-nav-heading" data-testid="nav-heading">{p.heading || '(untitled scene)'}</span>
        {p.omitted && <span className="wui-nav-omitted">OMITTED</span>}
        <button
          type="button"
          className="wui-nav-omit-btn"
          data-testid="nav-omit-btn"
          title={p.omitted ? 'Restore scene' : 'Omit scene'}
          onClick={(e) => {
            e.stopPropagation();
            p.onMenu(p.id, p.omitted, e.clientX, e.clientY);
          }}
        >
          &#8943;
        </button>
      </div>
      {editing ? (
        <input
          spellCheck
          autoCorrect="off"
          className="wui-nav-synopsis-input"
          aria-label="Synopsis"
          data-testid="nav-synopsis-input"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={keys}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <div className={`wui-nav-synopsis${p.synopsis ? '' : ' wui-empty'}`} data-testid="nav-synopsis" title="Click to edit the synopsis" onClick={start}>
          {p.synopsis || 'Add synopsis'}
        </div>
      )}
    </li>
  );
});

/** Scrollable scene list: number, heading, synopsis; click to jump, drag to reorder, click a synopsis to edit it. */
export function Navigator({ host, onJumpTo, activeElementId, className }: NavigatorProps) {
  const scenes = useScenes(host);
  const selection = useEditorSelection(host);
  const activeEl = activeElementId !== undefined ? activeElementId : (selection?.head.elementId ?? null);
  // `scenes` changes only when a row's shown data changes, so this runs once per real change; the lookup itself is one map hit.
  const activeId = useMemo(() => (activeEl ? (host.model.sceneOf(activeEl as never)?.id ?? null) : null), [host, activeEl, scenes]);

  const navRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!activeId) return;
    const row = Array.from(navRef.current?.querySelectorAll<HTMLElement>('[data-scene-id]') ?? []).find((r) => r.dataset.sceneId === activeId);
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; at: 'before' | 'after' } | null>(null);
  const hostRef = useRef(host);
  hostRef.current = host;
  const scenesRef = useRef(scenes);
  scenesRef.current = scenes;
  const jumpRef = useRef(onJumpTo);
  jumpRef.current = onJumpTo;
  const dragRef = useRef<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; omitted: boolean; x: number; y: number } | null>(null);
  const onMenu = useCallback((id: string, omitted: boolean, x: number, y: number) => setMenu({ id, omitted, x, y }), []);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('click', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', esc);
    };
  }, [menu]);

  const onJump = useCallback((id: string) => jumpRef.current?.(id), []);
  const onSynopsis = useCallback((id: string, v: string) => void setSynopsis(hostRef.current, id, v), []);
  const onDragStart = useCallback((id: string, e: DragEvent) => {
    dragRef.current = id;
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  }, []);
  const onDragOver = useCallback((id: string, e: DragEvent) => {
    if (!dragRef.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const at = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
    setDrop((d) => (d && d.id === id && d.at === at ? d : { id, at }));
  }, []);
  const clear = useCallback(() => {
    dragRef.current = null;
    setDragId(null);
    setDrop(null);
  }, []);
  const onDrop = useCallback(
    (id: string, e: DragEvent) => {
      e.preventDefault();
      const moving = dragRef.current;
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const at = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
      clear();
      if (!moving) return;
      const list = scenesRef.current;
      const i = list.findIndex((s) => s.id === id);
      // "after row i" is "before row i+1" (or the end of the script), so the drop indicator and the command agree.
      const target: SceneDrop | null = at === 'before' ? { before: id } : i + 1 < list.length ? { before: list[i + 1]!.id } : { after: id };
      if ('before' in target && target.before === moving) return;
      moveScene(hostRef.current, moving, target);
    },
    [clear],
  );

  return (
    <nav ref={navRef} className={['wui-navigator', className].filter(Boolean).join(' ')} aria-label="Scene navigator" data-testid="navigator">
      {scenes.length === 0 ? (
        <p className="wui-nav-empty">No scenes yet.</p>
      ) : (
        <ul className="wui-nav-list" onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null); }}>
          {scenes.map((s: SceneView) => (
            <Row
              key={s.id}
              id={s.id}
              label={s.number ?? (s.index >= 0 ? String(s.index + 1) : '')}
              heading={s.headingText}
              synopsis={s.synopsis.plain}
              omitted={s.omitted}
              color={s.color}
              active={s.id === activeId}
              dropMark={drop && drop.id === s.id && dragId !== s.id ? drop.at : null}
              dragging={dragId === s.id}
              onJump={onJump}
              onSynopsis={onSynopsis}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onMenu={onMenu}
              onDragEnd={clear}
            />
          ))}
        </ul>
      )}
      {menu && (
        <div className="wui-nav-menu" role="menu" data-testid="nav-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            role="menuitem"
            data-testid="nav-omit"
            onClick={() => {
              setSceneOmitted(hostRef.current, menu.id, !menu.omitted);
              setMenu(null);
            }}
          >
            {menu.omitted ? 'Restore scene' : 'Omit scene'}
          </button>
        </div>
      )}
    </nav>
  );
}
