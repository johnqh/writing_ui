import { memo, type ReactNode } from 'react';
import type { DocumentModel } from '@sudobility/writing_core';
import { EL_ATTR } from './dom-positions';
import { blockStyle, runStyle } from './geometry';

export interface ElementBlockProps {
  model: DocumentModel;
  id: string;
  /** `(textVersion, attrsVersion, template epoch)`: the block re-renders only when this changes. */
  vkey: string;
  linesPerInch: number;
  /** IME composition in progress: React must leave the DOM alone. */
  frozen: boolean;
  placeholder?: string;
  /** Auto scene number shown in the left gutter when scene numbering is on (heading elements only). */
  sceneNum?: string | null;
}

function ElementBlockImpl({ model, id, linesPerInch, placeholder, sceneNum }: ElementBlockProps) {
  const view = model.element(id as never);
  if (!view) return null;
  const rs = model.resolveStyle(view.id);
  const text = view.text;
  const empty = text.plain.length === 0;
  const omitted = view.omit !== null || view.sceneOmit !== null;
  const cls = [
    'wui-el',
    `wui-role-${rs.role}`,
    `wui-style-${String(view.style).replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    rs.hiddenInScript ? 'wui-hidden' : '',
    !rs.printable ? 'wui-nonprinting' : '',
    omitted ? 'wui-omitted' : '',
  ].filter(Boolean).join(' ');

  const children: ReactNode[] = text.runs.map((run, i) => {
    const st = runStyle(run.attrs as Record<string, unknown>);
    return (
      <span key={i} style={st}>
        {run.text}
      </span>
    );
  });
  // An empty block (and one ending in a soft return) needs a <br> or the browser gives it no line box for the caret.
  if (empty || text.plain.endsWith('\n')) children.push(<br key="sentinel" data-sentinel="" />);

  return (
    <div
      className={cls}
      {...{ [EL_ATTR]: id }}
      data-style={view.style}
      data-role={rs.role}
      {...(sceneNum ? { 'data-scene-num': sceneNum } : {})}
      {...(view.dual ? { 'data-dual': view.dual.side } : {})}
      {...(placeholder && empty ? { 'data-placeholder': placeholder, 'data-empty': '' } : {})}
      style={blockStyle(rs, linesPerInch)}
    >
      {children}
    </div>
  );
}

export const ElementBlock = memo(ElementBlockImpl, (a, b) => {
  if (a.frozen && b.frozen && a.id === b.id) return true;
  return a.id === b.id && a.model === b.model && a.vkey === b.vkey && a.linesPerInch === b.linesPerInch && a.placeholder === b.placeholder && a.sceneNum === b.sceneNum && a.frozen === b.frozen;
});
