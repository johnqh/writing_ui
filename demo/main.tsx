import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ElementStylePicker, IndexCards, Navigator, ScriptEditor, type PlainPos } from '../src';
import { createMemoryHost, type SeedElement } from './memory-host';
import './demo.css';

const PLACES = ['writers room - night', 'rooftop - dawn', 'diner - day', 'car - moving - night', 'stairwell - day', 'kitchen - evening', 'server room - night', 'beach - sunset'];
const DEMO_SEED: SeedElement[] = PLACES.flatMap((p, i) => [
  { style: 'st_scene_heading', text: `${i % 2 ? 'ext.' : 'int.'} ${p}` },
  { style: 'st_action', text: `Scene ${i + 1}: something happens here, and somebody notices.` },
  { style: 'st_character', text: i % 2 ? 'Jonas' : 'Maya' },
  { style: 'st_dialogue', text: 'Twelve drafts. Not one of them knows how it ends.' },
]);

function App() {
  const host = useMemo(() => createMemoryHost({ seed: DEMO_SEED }), []);
  const [tab, setTab] = useState<'edit' | 'cards'>('edit');
  const [caret, setCaret] = useState<PlainPos | null>(null);
  const jump = (elementId: string) => {
    setCaret({ elementId, offset: 0 });
    setTab('edit');
  };
  const [readOnly, setReadOnly] = useState(false);
  const [remote, setRemote] = useState(false);
  const [, force] = useState(0);

  useEffect(() => host.subscribe(() => force((n) => n + 1)), [host]);
  useEffect(() => {
    (window as unknown as { __host: unknown }).__host = host;
  }, [host]);
  useEffect(() => {
    if (!remote) return host.setRemoteCursors([]);
    const second = host.model.elementAt(Math.min(1, host.model.elementCount() - 1));
    host.setRemoteCursors([
      { clientId: 2, user: { id: 'u2', name: 'Sam', color: '#e11d48' }, cursor: { anchor: { elementId: second.id, offset: 9 }, head: { elementId: second.id, offset: 9 } } },
    ]);
  }, [remote, host]);

  return (
    <div className="demo">
      <header className="demo-bar">
        <strong>Fadewright editor demo</strong>
        <ElementStylePicker host={host} />
        <button onClick={() => host.undo()}>Undo</button>
        <button onClick={() => host.redo()}>Redo</button>
        <label>
          <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} /> Read only
        </label>
        <label>
          <input type="checkbox" checked={remote} onChange={(e) => setRemote(e.target.checked)} /> Remote cursor
        </label>
        <span role="tablist">
          <button role="tab" aria-selected={tab === 'edit'} onClick={() => setTab('edit')}>Edit</button>
          <button role="tab" aria-selected={tab === 'cards'} onClick={() => setTab('cards')}>Cards</button>
        </span>
        <span className="demo-count">{host.model.elementCount()} elements</span>
      </header>
      <div className="demo-body">
        <aside className="demo-side">
          <Navigator host={host} onJumpTo={jump} />
        </aside>
        <main className="demo-main">
          {tab === 'edit' ? <ScriptEditor host={host} readOnly={readOnly} initialCaret={caret} /> : <IndexCards host={host} onOpenScene={jump} />}
        </main>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
