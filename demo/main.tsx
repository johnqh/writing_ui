import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ElementStylePicker, ScriptEditor } from '../src';
import { createMemoryHost } from './memory-host';
import './demo.css';

function App() {
  const host = useMemo(() => createMemoryHost(), []);
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
        <span className="demo-count">{host.model.elementCount()} elements</span>
      </header>
      <main className="demo-main">
        <ScriptEditor host={host} readOnly={readOnly} />
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
