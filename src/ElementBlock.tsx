import { memo, type ReactNode } from 'react';
import { elementRevisionMarks, type DocumentModel } from '@sudobility/writing_core';
import { EL_ATTR } from './dom-positions';
import { blockStyle, runStyle } from './geometry';
import { defaultSpellingPolicy, type SpellingPolicy } from './spelling';

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
  spellCheck?: boolean;
  spellingPolicy?: SpellingPolicy;
}

function ElementBlockImpl({ model, id, linesPerInch, placeholder, sceneNum, spellCheck = true, spellingPolicy = defaultSpellingPolicy }: ElementBlockProps) {
  const view = model.element(id as never);
  if (!view) return null;
  const rs = model.resolveStyle(view.id);
  const text = view.text;
  const empty = text.plain.length === 0;
  const omitted = view.omit !== null || view.sceneOmit !== null;
  // Revision bar (Edit view): the colour of the highest set marking this element, when revision display is on.
  const revState = model.revisionState();
  let revColor: string | null = null;
  let revSet: string | null = null;
  if (revState.display !== 'none') {
    let best = -1;
    for (const m of elementRevisionMarks(view)) {
      const at = revState.sets.findIndex((x) => x.id === m.setId);
      if (at > best) best = at;
    }
    if (best >= 0) {
      revSet = String(revState.sets[best]!.id);
      revColor = revState.sets[best]!.textColor;
    }
  }
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
      <span key={i} style={st} spellCheck={run.attrs.nospell === true ? false : undefined} lang={typeof run.attrs.lang === 'string' ? run.attrs.lang : undefined}>
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
      spellCheck={spellCheck && spellingPolicy.script(rs.role)}
      {...(sceneNum ? { 'data-scene-num': sceneNum } : {})}
      {...(omitted && rs.role === 'sceneHeading' ? { 'data-omitted-heading': '' } : {})}
      {...(view.dual ? { 'data-dual': view.dual.side } : {})}
      {...(placeholder && empty ? { 'data-placeholder': placeholder, 'data-empty': '' } : {})}
      {...(revSet ? { 'data-rev-set': revSet } : {})}
      style={revColor ? { ...blockStyle(rs, linesPerInch), ['--wui-rev-color' as string]: revColor } : blockStyle(rs, linesPerInch)}
    >
      {children}
    </div>
  );
}

export const ElementBlock = memo(ElementBlockImpl, (a, b) => {
  if (a.frozen && b.frozen && a.id === b.id) return true;
  return a.id === b.id && a.model === b.model && a.vkey === b.vkey && a.linesPerInch === b.linesPerInch && a.placeholder === b.placeholder && a.sceneNum === b.sceneNum && a.frozen === b.frozen && a.spellCheck === b.spellCheck && a.spellingPolicy === b.spellingPolicy;
});
