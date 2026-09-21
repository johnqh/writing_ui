import { EMU_PER_INCH, type DocumentModel, type ElementId, type ResolvedStyle } from '@sudobility/writing_core';
import type { CSSProperties } from 'react';

/** EMU (914 400 per inch) to CSS inches. */
export const emuToIn = (emu: number): number => emu / EMU_PER_INCH;

const MONO_FAMILIES = new Set(['courier-screenplay', 'courier-new', 'mono']);

export function cssFontFamily(family: string): string {
  if (MONO_FAMILIES.has(family)) return '"Courier Prime", "Courier New", Courier, monospace';
  if (family === 'times' || family === 'serif' || family === 'cambria' || family === 'georgia') return `${family === 'times' ? '"Times New Roman"' : family === 'georgia' ? 'Georgia' : 'Cambria'}, "Times New Roman", serif`;
  if (family === 'arial' || family === 'sans') return 'Arial, Helvetica, sans-serif';
  if (family === 'calibri') return 'Calibri, Carlito, sans-serif';
  return 'inherit';
}

export interface PageGeometry {
  /** Text column width in inches (page width minus left and right margins). */
  textWidthIn: number;
  linesPerInch: number;
}

export function pageGeometry(model: DocumentModel): PageGeometry {
  const { page } = model.template();
  return {
    textWidthIn: emuToIn(page.width - page.margins.left - page.margins.right),
    linesPerInch: page.linesPerInch,
  };
}

/** Speed-view CSS for one resolved style: template geometry in real inches, Courier at 12 pt = 10 characters per inch. */
export function blockStyle(rs: ResolvedStyle, linesPerInch: number): CSSProperties {
  const lineIn = 1 / linesPerInch;
  const decorations: string[] = [];
  if (rs.font.underline) decorations.push('underline');
  if (rs.font.strike) decorations.push('line-through');
  return {
    marginLeft: `${emuToIn(rs.indentLeft)}in`,
    marginRight: `${emuToIn(rs.indentRight)}in`,
    marginTop: `${rs.spaceBefore * lineIn}in`,
    textIndent: `${emuToIn(rs.indentFirstLine)}in`,
    textAlign: rs.align,
    lineHeight: `${rs.lineSpacing * lineIn}in`,
    fontFamily: cssFontFamily(rs.font.family),
    fontSize: `${rs.font.size}pt`,
    fontWeight: rs.font.bold ? 700 : 400,
    fontStyle: rs.font.italic ? 'italic' : 'normal',
    textDecoration: decorations.length ? decorations.join(' ') : undefined,
    textTransform: rs.allCaps ? 'uppercase' : undefined,
    fontVariantCaps: rs.font.smallCaps ? 'small-caps' : undefined,
    color: rs.font.color,
    direction: rs.direction === 'auto' ? undefined : rs.direction,
  };
}

export function styleFor(model: DocumentModel, id: string): ResolvedStyle {
  return model.resolveStyle(id as ElementId);
}

/** Inline style for one text run's marks (`b`, `i`, `u`, `s`, `sc`, `va`, `fc`, `hl`). */
export function runStyle(attrs: Record<string, unknown>): CSSProperties | undefined {
  const s: CSSProperties = {};
  let any = false;
  if (attrs.b === true) (s.fontWeight = 700), (any = true);
  if (attrs.i === true) (s.fontStyle = 'italic'), (any = true);
  const deco: string[] = [];
  if (attrs.u) deco.push('underline');
  if (attrs.s === true) deco.push('line-through');
  if (deco.length) (s.textDecoration = deco.join(' ')), (any = true);
  if (attrs.sc === true) (s.fontVariantCaps = 'small-caps'), (any = true);
  if (attrs.va === 'super') (s.verticalAlign = 'super'), (s.fontSize = '0.75em'), (any = true);
  if (attrs.va === 'sub') (s.verticalAlign = 'sub'), (s.fontSize = '0.75em'), (any = true);
  if (typeof attrs.fc === 'string') (s.color = attrs.fc), (any = true);
  if (typeof attrs.hl === 'string') (s.backgroundColor = attrs.hl), (any = true);
  return any ? s : undefined;
}
