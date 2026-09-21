import { memo, useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import type { ScriptEditorHost } from './host';
import { appendScene, moveScene, setHeadingText, setSynopsis, type SceneDrop } from './structure-ops';
import { useScenes } from './useScenes';
import './styles/structure.css';

export interface IndexCardsProps {
  host: ScriptEditorHost;
  /** Cards per row, 1..9 (default 4). The toolbar's selector changes it locally. */
  cardsAcross?: number;
  /** Double-click a card. */
  onOpenScene?(elementId: string): void;
  className?: string;
}

const clampAcross = (n: number | undefined) => Math.min(9, Math.max(1, Math.round(n ?? 4)));

interface CardProps {
  id: string;
  label: string;
  heading: string;
  synopsis: string;
  omitted: boolean;
  color: string | null;
  autoEdit: boolean;
  dropMark: 'before' | 'after' | null;
  dragging: boolean;
  onOpen(id: string): void;
  onHeading(id: string, value: string): void;
  onSynopsis(id: string, value: string): void;
  onAutoEditDone(id: string): void;
  onDragStart(id: string, e: DragEvent): void;
  onDragOver(id: string, e: DragEvent): void;
  onDrop(id: string, e: DragEvent): void;
  onDragEnd(): void;
}

const Card = memo(function Card(p: CardProps) {
  const [field, setField] = useState<'heading' | 'synopsis' | null>(p.autoEdit ? 'heading' : null);
  const [draft, setDraft] = useState(p.autoEdit ? p.heading : '');
  const begin = (f: 'heading' | 'synopsis') => {
    setDraft(f === 'heading' ? p.heading : p.synopsis);
    setField(f);
  };
  const commit = () => {
    const f = field;
    setField(null);
    if (p.autoEdit) p.onAutoEditDone(p.id);
    if (f === 'heading' && draft !== p.heading) p.onHeading(p.id, draft);
    if (f === 'synopsis' && draft !== p.synopsis) p.onSynopsis(p.id, draft);
  };
  const keys = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      setField(null);
      if (p.autoEdit) p.onAutoEditDone(p.id);
    }
  };
  const scrollIn = useCallback((el: HTMLElement | null) => {
    if (el && p.autoEdit) el.scrollIntoView?.({ block: 'nearest' });
  }, [p.autoEdit]);
  const cls = ['wui-card', p.omitted && 'wui-omitted', p.dragging && 'wui-dragging', p.dropMark && `wui-drop-${p.dropMark}`].filter(Boolean).join(' ');
  return (
    <li
      ref={scrollIn}
      className={cls}
      data-scene-id={p.id}
      draggable={field === null}
      onDoubleClick={() => p.onOpen(p.id)}
      onDragStart={(e) => p.onDragStart(p.id, e)}
      onDragOver={(e) => p.onDragOver(p.id, e)}
      onDrop={(e) => p.onDrop(p.id, e)}
      onDragEnd={p.onDragEnd}
      style={p.color ? { borderTopColor: p.color } : undefined}
    >
      <div className="wui-card-top">
        <span className="wui-card-num" data-testid="card-number">{p.label}</span>
        {p.omitted && <span className="wui-nav-omitted">OMITTED</span>}
      </div>
      {field === 'heading' ? (
        <input
          className="wui-card-input"
          aria-label="Scene heading"
          data-testid="card-heading-input"
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={keys}
          onDoubleClick={(e) => e.stopPropagation()}
        />
      ) : (
        <div className="wui-card-heading" data-testid="card-heading" title="Click to edit the heading" onClick={() => begin('heading')}>
          {p.heading || '(untitled scene)'}
        </div>
      )}
      {field === 'synopsis' ? (
        <textarea
          className="wui-card-input wui-card-synopsis-input"
          aria-label="Synopsis"
          data-testid="card-synopsis-input"
          autoFocus
          rows={4}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={keys}
          onDoubleClick={(e) => e.stopPropagation()}
        />
      ) : (
        <div className={`wui-card-synopsis${p.synopsis ? '' : ' wui-empty'}`} data-testid="card-synopsis" title="Click to edit the synopsis" onClick={() => begin('synopsis')}>
          {p.synopsis || 'Add synopsis'}
        </div>
      )}
    </li>
  );
});

/** A grid of scene cards: number, heading, synopsis; inline edit, drag to reorder, "Add card" appends a scene. */
export function IndexCards({ host, cardsAcross = 4, onOpenScene, className }: IndexCardsProps) {
  const scenes = useScenes(host);
  const [across, setAcross] = useState(() => clampAcross(cardsAcross));
  useEffect(() => setAcross(clampAcross(cardsAcross)), [cardsAcross]);
  const [autoEditId, setAutoEditId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; at: 'before' | 'after' } | null>(null);
  const hostRef = useRef(host);
  hostRef.current = host;
  const scenesRef = useRef(scenes);
  scenesRef.current = scenes;
  const openRef = useRef(onOpenScene);
  openRef.current = onOpenScene;
  const dragRef = useRef<string | null>(null);

  const onOpen = useCallback((id: string) => openRef.current?.(id), []);
  const onHeading = useCallback((id: string, v: string) => void setHeadingText(hostRef.current, id, v), []);
  const onSynopsis = useCallback((id: string, v: string) => void setSynopsis(hostRef.current, id, v), []);
  const onAutoEditDone = useCallback((id: string) => setAutoEditId((cur) => (cur === id ? null : cur)), []);
  const onDragStart = useCallback((id: string, e: DragEvent) => {
    dragRef.current = id;
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  }, []);
  const halfOf = (e: DragEvent): 'before' | 'after' => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientX < r.left + r.width / 2 ? 'before' : 'after';
  };
  const onDragOver = useCallback((id: string, e: DragEvent) => {
    if (!dragRef.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const at = halfOf(e);
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
      const at = halfOf(e);
      clear();
      if (!moving) return;
      const list = scenesRef.current;
      const i = list.findIndex((s) => s.id === id);
      const target: SceneDrop = at === 'before' ? { before: id } : i + 1 < list.length ? { before: list[i + 1]!.id } : { after: id };
      if ('before' in target && target.before === moving) return;
      moveScene(hostRef.current, moving, target);
    },
    [clear],
  );

  const add = () => {
    const id = appendScene(hostRef.current);
    if (id) setAutoEditId(id);
  };

  return (
    <section className={['wui-cards', className].filter(Boolean).join(' ')} aria-label="Index cards" data-testid="index-cards">
      <div className="wui-cards-bar">
        <label>
          Cards across{' '}
          <select aria-label="Cards across" data-testid="cards-across" value={across} onChange={(e) => setAcross(clampAcross(Number(e.target.value)))}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <span className="wui-cards-count">{scenes.length} {scenes.length === 1 ? 'card' : 'cards'}</span>
        <button type="button" data-testid="add-card" onClick={add}>Add card</button>
      </div>
      <ul
        className="wui-cards-grid"
        style={{ gridTemplateColumns: `repeat(${across}, minmax(0, 1fr))` }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null); }}
      >
        {scenes.map((s) => (
          <Card
            key={s.id}
            id={s.id}
            label={s.number ?? (s.index >= 0 ? String(s.index + 1) : '')}
            heading={s.headingText}
            synopsis={s.synopsis.plain}
            omitted={s.omitted}
            color={s.color}
            autoEdit={autoEditId === s.id}
            dropMark={drop && drop.id === s.id && dragId !== s.id ? drop.at : null}
            dragging={dragId === s.id}
            onOpen={onOpen}
            onHeading={onHeading}
            onSynopsis={onSynopsis}
            onAutoEditDone={onAutoEditDone}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDragEnd={clear}
          />
        ))}
      </ul>
    </section>
  );
}
