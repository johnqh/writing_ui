import type { DocumentModel, StyleDef, StyleRole } from '@sudobility/writing_core';
import { styleForRole } from './paste-classify';
import type { PlainPos } from './host';

/**
 * Copy and paste that keep each element's type. The browser's own copy puts only text on the clipboard, so a
 * paste had to guess every line's type from how it reads (`paste-classify.ts`) and guessed wrong often enough to
 * be a nuisance: a cue in lower case, a short line of dialogue in capitals. Copying from the editor now also puts
 * the elements themselves on the clipboard (type and text); pasting reads them back and guesses nothing.
 *
 * Two carriers, because not every browser hands a custom clipboard type back on paste: a custom MIME type, and
 * the same JSON in a `data-` attribute of the `text/html` flavour. Text from anywhere else has neither and is
 * classified as before.
 */
export const WUI_MIME = 'application/x-wui-elements+json';
const HTML_ATTR = 'data-wui-elements';

export interface ClipElement {
  /** The style id in the source document's template. */
  style: string;
  role?: StyleRole;
  text: string;
}

export interface ClipPayload {
  v: 1;
  elements: ClipElement[];
}

const SPEECH: ReadonlySet<string> = new Set(['character', 'parenthetical', 'dialogue']);

/** The selected elements, the first and the last cut to the selection. Text is as stored, not as shown. */
export function collectSelection(model: DocumentModel, from: PlainPos, to: PlainPos): ClipElement[] {
  const a = model.indexOf(from.elementId as never);
  const b = model.indexOf(to.elementId as never);
  if (a < 0 || b < a) return [];
  const views = model.elements({ from: a, to: b + 1 });
  const styles = model.template().styles;
  return views.map((v, i) => {
    const plain = v.text.plain;
    const start = i === 0 ? from.offset : 0;
    const end = i === views.length - 1 ? to.offset : plain.length;
    const role = styles.find((s) => s.id === v.style)?.role;
    return { style: String(v.style), ...(role ? { role } : {}), text: plain.slice(start, end) };
  });
}

/**
 * Plain text for other programs, in Fountain's shape: elements separated by a blank line, the parts of one speech
 * (cue, parenthetical, dialogue) on consecutive lines. Elements shown in capitals are written in capitals.
 */
export function toPlainText(elements: readonly ClipElement[], allCaps: (style: string) => boolean, language?: string): string {
  let out = '';
  elements.forEach((e, i) => {
    const prev = elements[i - 1];
    if (prev) out += prev.role && e.role && SPEECH.has(prev.role) && SPEECH.has(e.role) && e.role !== 'character' ? '\n' : '\n\n';
    out += allCaps(e.style) ? e.text.toLocaleUpperCase(language) : e.text;
  });
  return out;
}

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function toHtml(payload: ClipPayload, plain: string): string {
  const body = plain
    .split('\n')
    .map((l) => `<p>${escapeHtml(l) || '<br>'}</p>`)
    .join('');
  return `<div ${HTML_ATTR}="${escapeHtml(JSON.stringify(payload))}">${body}</div>`;
}

function parse(json: string | null | undefined): ClipPayload | null {
  if (!json) return null;
  try {
    const p = JSON.parse(json) as Partial<ClipPayload>;
    if (p?.v !== 1 || !Array.isArray(p.elements)) return null;
    const elements = p.elements.filter((e): e is ClipElement => !!e && typeof e.style === 'string' && typeof e.text === 'string');
    return elements.length > 0 ? { v: 1, elements } : null;
  } catch {
    return null;
  }
}

/** The elements a paste carries, or null when the text did not come from the editor. */
export function readPayload(data: Pick<DataTransfer, 'getData'> | null | undefined): ClipPayload | null {
  if (!data) return null;
  const direct = parse(data.getData(WUI_MIME));
  if (direct) return direct;
  const html = data.getData('text/html');
  if (!html || !html.includes(HTML_ATTR)) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return parse(doc.querySelector(`[${HTML_ATTR}]`)?.getAttribute(HTML_ATTR));
}

/** The style a pasted element gets here: its own when this template has it, else this template's style for its role. */
export function styleFor(styles: readonly StyleDef[], el: ClipElement): StyleDef {
  return styles.find((s) => s.id === el.style) ?? styleForRole(styles, el.role ?? 'action');
}
