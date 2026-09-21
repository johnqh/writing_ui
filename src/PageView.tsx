import type { DocLine, DocPage, GlyphRun } from '@sudobility/writing_core';
import { memo, useCallback } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { emuToIn } from './geometry';
import type { ScriptEditorHost } from './host';
import { useLayout, type UseLayoutResult } from './useLayout';
import './styles/editor.css';

export interface PageViewProps {
  host: ScriptEditorHost;
  className?: string;
  /** A line was clicked: the element it belongs to and the best-guess offset (UTF-16, plain text) in it. */
  onRequestEdit?(elementId: string, offset: number): void;
  /** An already-running layout (so the app can share one with its page counter). Omit and the view runs its own. */
  layout?: UseLayoutResult;
}

const FAMILY_CSS: Record<string, string> = {
  'courier-prime': '"Courier Prime", "Courier New", Courier, monospace',
  carlito: 'Carlito, Calibri, sans-serif',
  caladea: 'Caladea, Cambria, serif',
  gelasio: 'Gelasio, Georgia, serif',
};

function runCss(run: GlyphRun, lineX: number): CSSProperties {
  const [family = '', style = ''] = run.faceId.split(':');
  const deco: string[] = [];
  if (run.style.underline !== 'none') deco.push('underline');
  if (run.style.strike) deco.push('line-through');
  const css: CSSProperties = {
    position: 'absolute',
    left: `${emuToIn(run.x - lineX)}in`,
    fontFamily: FAMILY_CSS[family] ?? 'inherit',
    fontSize: `${(emuToIn(run.sizeEmu) * 72).toFixed(3)}pt`,
    fontWeight: /bold/.test(style) || run.synthBold ? 700 : 400,
    fontStyle: /italic/.test(style) || run.synthItalic ? 'italic' : 'normal',
  };
  if (deco.length) css.textDecoration = deco.join(' ');
  if (run.style.underline === 'dotted') css.textDecorationStyle = 'dotted';
  else if (run.style.underline === 'double') css.textDecorationStyle = 'double';
  if (run.style.color && run.style.color !== '#000000') css.color = run.style.color;
  if (run.style.background) css.backgroundColor = run.style.background;
  return css;
}

const Line = memo(function Line({ line }: { line: DocLine }) {
  const chars = line.runs.reduce((n, r) => n + r.text.length, 0);
  const last = line.runs[line.runs.length - 1];
  const extent = last ? last.x + last.width - line.x : 0;
  return (
    <div
      className="wui-pl"
      data-el-id={line.elementId}
      data-line={line.lineIndexInElement}
      data-start={line.sourceStart}
      data-end={line.sourceEnd}
      data-chars={chars}
      data-extent-in={emuToIn(extent)}
      data-box-in={emuToIn(Math.max(line.width, 914400 / 4))}
      style={{
        left: `${emuToIn(line.x)}in`,
        top: `${emuToIn(line.y)}in`,
        // A blank line still needs a click target.
        width: `${emuToIn(Math.max(line.width, 914400 / 4))}in`,
        height: `${emuToIn(line.pitch)}in`,
        lineHeight: `${emuToIn(line.pitch)}in`,
      }}
    >
      {line.runs.map((r, i) => (
        <span key={i} style={runCss(r, line.x)}>
          {r.text}
        </span>
      ))}
    </div>
  );
});

const Sheet = memo(function Sheet({
  page,
  width,
  height,
  numberRight,
  numberTop,
  lineHeight,
}: {
  page: DocPage;
  width: number;
  height: number;
  numberRight: number;
  numberTop: number;
  lineHeight: number;
}) {
  return (
    <section
      className="wui-sheet"
      data-page={page.number}
      style={{ width: `${emuToIn(width)}in`, height: `${emuToIn(height)}in` }}
    >
      {/* The engine does not run headers yet (spec 02 section 20): a plain "N." stands in from page 2. */}
      {page.number > 1 && (
        <div
          className="wui-pageno"
          data-testid="page-number"
          style={{ right: `${emuToIn(width - numberRight)}in`, top: `${emuToIn(numberTop)}in`, lineHeight: `${emuToIn(lineHeight)}in` }}
        >
          {page.number}.
        </div>
      )}
      {page.lines.map((l, i) => (
        <Line key={`${l.elementId}:${l.lineIndexInElement}:${i}`} line={l} />
      ))}
    </section>
  );
});

/** Read-only paginated view: the layout engine's pages drawn as white sheets, every line at the engine's x/y. */
export function PageView({ host, className, onRequestEdit, layout }: PageViewProps) {
  const own = useLayout(host, { enabled: !layout });
  const { layout: doc, status, error } = layout ?? own;

  const onClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('.wui-pl');
      if (!el || !onRequestEdit) return;
      const start = Number(el.dataset.start);
      const end = Number(el.dataset.end);
      const chars = Number(el.dataset.chars);
      const rect = el.getBoundingClientRect();
      // Screen pixels per character: the drawn extent of the line's text over its character count.
      const pxPerIn = rect.width / Number(el.dataset.boxIn);
      const perChar = chars > 0 ? (Number(el.dataset.extentIn) * pxPerIn) / chars : 0;
      const col = perChar > 0 ? Math.round((e.clientX - rect.left) / perChar) : 0;
      onRequestEdit(el.dataset.elId as string, start + Math.max(0, Math.min(end - start, col)));
    },
    [onRequestEdit],
  );

  const page = host.model.template().page;
  return (
    <div
      className={['wui-pageview', className].filter(Boolean).join(' ')}
      data-testid="page-view"
      data-status={status}
      data-page-count={doc?.pages.length ?? 0}
      onClick={onClick}
    >
      {!doc && status !== 'error' && <p className="wui-pageview-note">Laying out pages…</p>}
      {status === 'error' && <p className="wui-pageview-note">Could not lay out the document{error ? `: ${error.message}` : ''}</p>}
      {doc?.pages.map((p) => (
        <Sheet
          key={p.index}
          page={p}
          width={doc.pageSize.width}
          height={doc.pageSize.height}
          numberRight={doc.pageSize.width - page.margins.right}
          numberTop={page.headerOffset}
          lineHeight={914400 / page.linesPerInch}
        />
      ))}
    </div>
  );
}
