import { registerBuiltinCommands, type BatchResult, type CommandInvocation, type DocumentModel, type ElementView, type WireDocPos } from '@sudobility/writing_core';
import { EL_ATTR, findBlock, plainToYIndex, readDomSelection, type DomSelection } from './dom-positions';
import { wuiDebug } from './debug';
import type { PlainPos, ScriptEditorHost } from './host';

registerBuiltinCommands();

export interface InputEnv {
  host: () => ScriptEditorHost;
  root: () => HTMLElement | null;
  readOnly: () => boolean;
  /** Where the caret goes once React has re-rendered from the model. `null` clears it. */
  setCaret: (anchor: PlainPos | null, head?: PlainPos) => void;
  /** Force React to discard and rebuild one element's DOM (used after IME composition). */
  remount: (elementId: string) => void;
  /** The element whose DOM the browser owns right now (IME composition); React must not touch it. */
  setComposing: (elementId: string | null) => void;
}

type Order = { from: PlainPos; to: PlainPos; collapsed: boolean };

let gestureCounter = 0;
const newGroup = () => `g${++gestureCounter}`;

const embedAts = (view: ElementView | undefined): number[] => (view ? view.text.embeds.map((e) => e.at) : []);
const plainLen = (view: ElementView | undefined): number => view?.text.plain.length ?? 0;

/**
 * Turns DOM events on the controlled contenteditable into `writing_core` commands. The DOM is never
 * allowed to change on its own (every `beforeinput` is cancelled), except during IME composition.
 * After each command the caret is handed to `env.setCaret`, which restores it after the re-render.
 */
export function createInputController(env: InputEnv) {
  const model = (): DocumentModel => env.host().model;
  let composing: { from: PlainPos; to: PlainPos; oldText: string } | null = null;

  const toWire = (p: PlainPos): WireDocPos => ({ elementId: p.elementId as never, offset: plainToYIndex(embedAts(model().element(p.elementId as never)), p.offset) });
  const range = (from: PlainPos, to: PlainPos) => ({ anchor: toWire(from), head: toWire(to) });

  function order(sel: DomSelection): Order {
    const m = model();
    const ia = m.indexOf(sel.anchor.elementId as never);
    const ib = m.indexOf(sel.head.elementId as never);
    const anchorFirst = ia < ib || (ia === ib && sel.anchor.offset <= sel.head.offset);
    const [from, to] = anchorFirst ? [sel.anchor, sel.head] : [sel.head, sel.anchor];
    return { from, to, collapsed: from.elementId === to.elementId && from.offset === to.offset };
  }

  function exec(cmds: CommandInvocation[], kind: 'local-typing' | 'local-command', groupKey?: string): BatchResult {
    wuiDebug('exec', { cmds: cmds.map((c) => c.id), kind });
    return env.host().execute(cmds, { kind, ...(groupKey ? { groupKey } : {}) });
  }

  /** Current selection, creating the first element when the document is empty. */
  function selection(): DomSelection | null {
    const root = env.root();
    if (!root) return null;
    if (model().elementCount() === 0) {
      const t = model().template();
      const res = exec([{ id: 'element.insert', params: { style: t.defaults.firstElement } }], 'local-command');
      const id = res.ok ? res.effects.inserted[0] : undefined;
      if (!id) return null;
      const p = { elementId: id, offset: 0 };
      return { anchor: p, head: p };
    }
    return readDomSelection(root);
  }

  /** Where the caret lands after `text.deleteRange`/`replaceRange` over `from..to`. */
  function survivor(from: PlainPos, to: PlainPos): PlainPos | null {
    const m = model();
    if (m.element(from.elementId as never)) return { elementId: from.elementId, offset: from.offset };
    if (m.element(to.elementId as never)) return { elementId: to.elementId, offset: 0 };
    return null;
  }

  function deleteSelection(o: Order, group: string): PlainPos | null | undefined {
    const res = exec([{ id: 'text.deleteRange', params: { range: range(o.from, o.to) } }], 'local-command', group);
    if (!res.ok) return undefined;
    return survivor(o.from, o.to);
  }

  function insertText(text: string, kind: 'local-typing' | 'local-command' = 'local-typing'): void {
    if (!text) return;
    const sel = selection();
    if (!sel) return;
    const o = order(sel);
    let res: BatchResult;
    if (o.collapsed) res = exec([{ id: 'text.insert', params: { at: toWire(o.from), text } }], kind);
    else res = exec([{ id: 'text.replaceRange', params: { range: range(o.from, o.to), text } }], 'local-command');
    if (!res.ok) return;
    const base = o.collapsed || model().element(o.from.elementId as never) ? o.from : { elementId: o.to.elementId, offset: 0 };
    env.setCaret({ elementId: base.elementId, offset: base.offset + text.length });
  }

  function enter(): void {
    const sel = selection();
    if (!sel) return;
    const o = order(sel);
    const group = newGroup();
    let at = o.from;
    if (!o.collapsed) {
      const s = deleteSelection(o, group);
      if (s === undefined) return;
      if (s === null) return env.setCaret(null);
      at = s;
    }
    const res = exec([{ id: 'element.split', params: { at: toWire(at) } }], 'local-command', group);
    if (!res.ok) return void (o.collapsed || env.setCaret(at));
    const r = res.results[0];
    const head = r && r.ok ? r.selection?.head : undefined;
    if (head) env.setCaret({ elementId: head.elementId, offset: 0 });
    else env.setCaret(at);
  }

  function deleteBackward(unit: 'char' | 'grapheme' | 'word'): void {
    const sel = selection();
    if (!sel) return;
    const o = order(sel);
    const group = newGroup();
    if (!o.collapsed) {
      const s = deleteSelection(o, group);
      if (s !== undefined) env.setCaret(s);
      return;
    }
    const m = model();
    const view = m.element(o.from.elementId as never);
    const prev = m.previous(o.from.elementId as never);
    const oldLen = plainLen(view);
    const prevLen = plainLen(prev);
    const res = exec([{ id: 'text.deleteBackward', params: { at: toWire(o.from), unit } }], 'local-typing');
    if (!res.ok) return;
    if (res.effects.removed.includes(o.from.elementId)) {
      if (prev) env.setCaret({ elementId: prev.id, offset: prevLen });
      return;
    }
    if (o.from.offset === 0) return env.setCaret(o.from);
    const newLen = plainLen(model().element(o.from.elementId as never));
    env.setCaret({ elementId: o.from.elementId, offset: Math.max(0, o.from.offset - (oldLen - newLen)) });
  }

  function deleteForward(unit: 'char' | 'grapheme' | 'word'): void {
    const sel = selection();
    if (!sel) return;
    const o = order(sel);
    if (!o.collapsed) {
      const s = deleteSelection(o, newGroup());
      if (s !== undefined) env.setCaret(s);
      return;
    }
    const res = exec([{ id: 'text.deleteForward', params: { at: toWire(o.from), unit } }], 'local-typing');
    if (res.ok) env.setCaret(o.from);
  }

  /** Cmd+Backspace / Cmd+Delete: delete to the start/end of the element. */
  function deleteToEdge(dir: 'backward' | 'forward'): void {
    const sel = selection();
    if (!sel) return;
    const o = order(sel);
    if (!o.collapsed) return void deleteSelectionAndCaret(o);
    const len = plainLen(model().element(o.from.elementId as never));
    const edge = dir === 'backward' ? { elementId: o.from.elementId, offset: 0 } : { elementId: o.from.elementId, offset: len };
    const [a, b] = dir === 'backward' ? [edge, o.from] : [o.from, edge];
    if (a.offset === b.offset) return dir === 'backward' ? deleteBackward('char') : deleteForward('char');
    const res = exec([{ id: 'text.deleteRange', params: { range: range(a, b) } }], 'local-command');
    if (res.ok) env.setCaret(a);
  }

  function deleteSelectionAndCaret(o: Order): void {
    const s = deleteSelection(o, newGroup());
    if (s !== undefined) env.setCaret(s);
  }

  function paste(text: string): void {
    const lines = text.split(/\r\n|\r|\n/).filter((l) => l.length > 0);
    if (lines.length === 0) return;
    const sel = selection();
    if (!sel) return;
    const o = order(sel);
    const group = newGroup();
    let at = o.from;
    if (!o.collapsed) {
      const s = deleteSelection(o, group);
      if (s === undefined) return;
      if (s === null) return;
      at = s;
    }
    for (const [i, line] of lines.entries()) {
      const r = exec([{ id: 'text.insert', params: { at: toWire(at), text: line } }], 'local-command', group);
      if (!r.ok) break;
      at = { elementId: at.elementId, offset: at.offset + line.length };
      if (i < lines.length - 1) {
        const s = exec([{ id: 'element.split', params: { at: toWire(at) } }], 'local-command', group);
        if (!s.ok) break;
        const first = s.results[0];
        const head = first && first.ok ? first.selection?.head : undefined;
        if (head) at = { elementId: head.elementId, offset: 0 };
      }
    }
    env.setCaret(at);
  }

  function toggleMark(mark: 'b' | 'i' | 'u'): void {
    const sel = readSelectionOnly();
    if (!sel) return;
    const o = order(sel);
    if (o.collapsed) return; // no pending-mark state yet
    const res = exec([{ id: 'mark.toggle', params: { range: range(o.from, o.to), mark } }], 'local-command');
    if (res.ok) env.setCaret(sel.anchor, sel.head);
  }

  const readSelectionOnly = (): DomSelection | null => {
    const root = env.root();
    return root ? readDomSelection(root) : null;
  };

  /** Undo/redo, then put the caret where the edit happened (the model does not report a caret). */
  function history(kind: 'undo' | 'redo'): void {
    const root = env.root();
    const before = root ? readDomSelection(root) : null;
    const m0 = model();
    const view = before ? m0.element(before.head.elementId as never) : undefined;
    const oldText = view?.text.plain ?? '';
    const prev = before ? m0.previous(before.head.elementId as never) : undefined;
    const prevLen = plainLen(prev);
    const ok = kind === 'undo' ? env.host().undo() : env.host().redo();
    if (!ok || !before) return;
    const m = model();
    const now = m.element(before.head.elementId as never);
    if (!now) {
      if (prev && m.element(prev.id)) env.setCaret({ elementId: prev.id, offset: Math.min(prevLen, plainLen(m.element(prev.id))) });
      else env.setCaret(null);
      return;
    }
    const n = now.text.plain;
    let p = 0;
    while (p < oldText.length && p < n.length && oldText[p] === n[p]) p++;
    let s = 0;
    while (s < oldText.length - p && s < n.length - p && oldText[oldText.length - 1 - s] === n[n.length - 1 - s]) s++;
    const c = before.head.offset;
    let next: number;
    // Before the changed region: unchanged. Inside or at its edges: the end of the changed region (after the
    // re-inserted text on undo of a delete or redo of typing). After it: shifted by the length change.
    if (c < p) next = c;
    else if (c <= oldText.length - s) next = n.length - s;
    else next = c + (n.length - oldText.length);
    env.setCaret({ elementId: now.id, offset: Math.max(0, Math.min(next, n.length)) });
  }

  function tab(direction: 'tabForward' | 'tabBack'): void {
    const sel = readSelectionOnly();
    if (!sel) return;
    const o = order(sel);
    const view = model().element(o.to.elementId as never);
    if (!view) return;
    const res = exec([{ id: 'element.cycleStyle', params: { element: view.id, direction, caretAtEnd: o.to.offset >= plainLen(view) } }], 'local-command');
    if (!res.ok) return;
    const created = res.effects.inserted[0];
    env.setCaret(created ? { elementId: created, offset: 0 } : sel.anchor, created ? undefined : sel.head);
  }

  function styleShortcut(digit: number): boolean {
    const sel = readSelectionOnly();
    if (!sel) return false;
    const m = model();
    const style = m.template().styles.find((s) => s.shortcut === digit);
    if (!style) return false;
    const o = order(sel);
    const from = m.indexOf(o.from.elementId as never);
    const to = m.indexOf(o.to.elementId as never);
    const ids = m.elements({ from, to: to + 1 }).map((e) => e.id);
    if (ids.length === 0) return true;
    const res = exec([{ id: 'element.setStyle', params: { elements: ids, style: style.id } }], 'local-command');
    if (res.ok) env.setCaret(sel.anchor, sel.head);
    return true;
  }

  // ─── DOM event entry points ───────────────────────────────────────────────

  function onBeforeInput(e: InputEvent): void {
    wuiDebug('beforeinput', { inputType: e.inputType, data: e.data ?? null });
    if (composing || e.isComposing) return; // the browser owns the composing element
    e.preventDefault();
    if (env.readOnly()) return;
    switch (e.inputType) {
      case 'insertText':
      case 'insertReplacementText': {
        const data = e.data ?? e.dataTransfer?.getData('text/plain') ?? '';
        if (data) insertText(data);
        return;
      }
      case 'insertParagraph':
        return enter();
      case 'insertLineBreak':
        return insertSoftReturn();
      case 'deleteContentBackward':
        return deleteBackward('char');
      case 'deleteContentForward':
        return deleteForward('char');
      case 'deleteWordBackward':
        return deleteBackward('word');
      case 'deleteWordForward':
        return deleteForward('word');
      case 'deleteSoftLineBackward':
      case 'deleteHardLineBackward':
        return deleteToEdge('backward');
      case 'deleteSoftLineForward':
      case 'deleteHardLineForward':
        return deleteToEdge('forward');
      case 'deleteByCut':
      case 'deleteContent': {
        const sel = readSelectionOnly();
        if (!sel) return;
        const o = order(sel);
        if (!o.collapsed) deleteSelectionAndCaret(o);
        return;
      }
      case 'insertFromPaste':
      case 'insertFromPasteAsQuotation':
        return paste(e.dataTransfer?.getData('text/plain') ?? e.data ?? '');
      case 'historyUndo':
        return history('undo');
      case 'historyRedo':
        return history('redo');
      case 'formatBold':
        return toggleMark('b');
      case 'formatItalic':
        return toggleMark('i');
      case 'formatUnderline':
        return toggleMark('u');
      default:
        return; // drag/drop, spelling, other formats: not supported, and the DOM stays untouched
    }
  }

  function insertSoftReturn(): void {
    const sel = selection();
    if (!sel) return;
    const o = order(sel);
    if (!o.collapsed) return;
    const res = exec([{ id: 'text.insertSoftReturn', params: { at: toWire(o.from) } }], 'local-typing');
    if (res.ok) env.setCaret({ elementId: o.from.elementId, offset: o.from.offset + 1 });
  }

  function onKeyDown(e: KeyboardEvent): void {
    wuiDebug('keydown', { key: e.key, meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey });
    if (e.isComposing || e.keyCode === 229 || composing) return;
    if (env.readOnly()) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key;
    if (key === 'Tab' && !mod && !e.altKey) {
      e.preventDefault();
      return tab(e.shiftKey ? 'tabBack' : 'tabForward');
    }
    if (!mod || e.altKey) return;
    const lower = key.length === 1 ? key.toLowerCase() : key;
    if (lower === 'b' || lower === 'i' || lower === 'u') {
      e.preventDefault();
      return toggleMark(lower);
    }
    if (lower === 'z') {
      e.preventDefault();
      return history(e.shiftKey ? 'redo' : 'undo');
    }
    if (lower === 'y' && !e.metaKey) {
      e.preventDefault();
      return history('redo');
    }
    if (/^[0-9]$/.test(key) && !e.shiftKey) {
      if (styleShortcut(Number(key))) e.preventDefault();
    }
  }

  function onCompositionStart(): void {
    const root = env.root();
    const sel = root ? readDomSelection(root) : null;
    if (!sel) return;
    const o = order(sel);
    const view = model().element(o.from.elementId as never);
    composing = { from: o.from, to: o.to, oldText: view?.text.plain ?? '' };
    env.setComposing(o.from.elementId);
  }

  function onCompositionEnd(e: CompositionEvent): void {
    const c = composing;
    composing = null;
    env.setComposing(null);
    if (!c) return;
    const root = env.root();
    const id = c.from.elementId;
    let composed = e.data ?? '';
    if (root && c.from.elementId === c.to.elementId) {
      const block = findBlock(root, id);
      const dom = block?.textContent ?? '';
      const prefix = c.oldText.slice(0, c.from.offset);
      const suffix = c.oldText.slice(c.to.offset);
      if (dom.startsWith(prefix) && dom.endsWith(suffix) && dom.length >= prefix.length + suffix.length) composed = dom.slice(prefix.length, dom.length - suffix.length);
    }
    env.remount(id); // drop whatever the browser did to the DOM; re-render from the model
    if (env.readOnly()) return;
    const collapsed = c.from.elementId === c.to.elementId && c.from.offset === c.to.offset;
    let res: BatchResult | null = null;
    if (composed) res = exec([{ id: 'text.replaceRange', params: { range: range(c.from, c.to), text: composed } }], 'local-typing');
    else if (!collapsed) res = exec([{ id: 'text.deleteRange', params: { range: range(c.from, c.to) } }], 'local-command');
    if (res && !res.ok) return env.setCaret(c.from);
    env.setCaret({ elementId: id, offset: c.from.offset + composed.length });
  }

  return { onBeforeInput, onKeyDown, onCompositionStart, onCompositionEnd, EL_ATTR };
}

export type InputController = ReturnType<typeof createInputController>;
