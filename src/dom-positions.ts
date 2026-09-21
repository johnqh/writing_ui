import type { PlainPos } from './host';

/** Attribute carrying the element id on each rendered block. */
export const EL_ATTR = 'data-el-id';

export interface DomSelection {
  anchor: PlainPos;
  head: PlainPos;
}

/**
 * Y.Text indices count embeds; `plain` offsets do not. `embedAts` are the embeds' Y.Text indices in order
 * (`TextJSON.embeds[].at`). A plain offset that lands on an embed maps to the index just after it.
 */
export function plainToYIndex(embedAts: readonly number[], plain: number): number {
  let y = plain;
  for (const at of embedAts) {
    if (at <= y) y++;
    else break;
  }
  return y;
}

export function yIndexToPlain(embedAts: readonly number[], y: number): number {
  let n = 0;
  for (const at of embedAts) {
    if (at < y) n++;
    else break;
  }
  return y - n;
}

export function blocksOf(root: HTMLElement): HTMLElement[] {
  return Array.from(root.children).filter((c): c is HTMLElement => c instanceof HTMLElement && c.hasAttribute(EL_ATTR));
}

export function findBlock(root: HTMLElement, elementId: string): HTMLElement | null {
  for (const child of Array.from(root.children)) {
    if (child instanceof HTMLElement && child.getAttribute(EL_ATTR) === elementId) return child;
  }
  return null;
}

function blockText(block: HTMLElement): string {
  return block.textContent ?? '';
}

/** Maps a DOM point to (element id, plain offset), or null when it is outside any element block. */
export function domPointToPlain(root: HTMLElement, node: Node, offset: number): PlainPos | null {
  if (node === root) {
    const blocks = blocksOf(root);
    if (blocks.length === 0) return null;
    const child = blocks[Math.min(offset, blocks.length)];
    if (child && offset < blocks.length) return { elementId: child.getAttribute(EL_ATTR)!, offset: 0 };
    const last = blocks[blocks.length - 1]!;
    return { elementId: last.getAttribute(EL_ATTR)!, offset: blockText(last).length };
  }
  if (!root.contains(node)) return null;
  let block: Node = node;
  while (block.parentNode && block.parentNode !== root) block = block.parentNode;
  if (!(block instanceof HTMLElement) || !block.hasAttribute(EL_ATTR)) return null;
  const doc = root.ownerDocument;
  const range = doc.createRange();
  range.setStart(block, 0);
  range.setEnd(node, offset);
  return { elementId: block.getAttribute(EL_ATTR)!, offset: range.toString().length };
}

/** Maps (element id, plain offset) to a DOM point inside that element's block. */
export function plainToDomPoint(root: HTMLElement, pos: PlainPos): { node: Node; offset: number } | null {
  const block = findBlock(root, pos.elementId);
  if (!block) return null;
  const walker = root.ownerDocument.createTreeWalker(block, 4 /* NodeFilter.SHOW_TEXT */);
  let acc = 0;
  let last: Text | null = null;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const len = n.data.length;
    if (pos.offset <= acc + len) return { node: n, offset: Math.max(0, pos.offset - acc) };
    acc += len;
    last = n;
  }
  if (last) return { node: last, offset: last.data.length };
  return { node: block, offset: 0 };
}

export function readDomSelection(root: HTMLElement): DomSelection | null {
  const sel = root.ownerDocument.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !sel.focusNode) return null;
  if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null;
  const anchor = domPointToPlain(root, sel.anchorNode, sel.anchorOffset);
  const head = domPointToPlain(root, sel.focusNode, sel.focusOffset);
  return anchor && head ? { anchor, head } : null;
}

export function writeDomSelection(root: HTMLElement, anchor: PlainPos, head: PlainPos = anchor): boolean {
  const a = plainToDomPoint(root, anchor);
  const h = plainToDomPoint(root, head);
  const sel = root.ownerDocument.getSelection();
  if (!a || !h || !sel) return false;
  if (typeof sel.setBaseAndExtent === 'function') {
    sel.setBaseAndExtent(a.node, a.offset, h.node, h.offset);
  } else {
    const range = root.ownerDocument.createRange();
    range.setStart(a.node, a.offset);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    if (h.node !== a.node || h.offset !== a.offset) sel.extend(h.node, h.offset);
  }
  return true;
}
