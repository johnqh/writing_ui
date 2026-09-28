import { registerBuiltinCommands, type BatchResult, type CommandInvocation, type DocumentModel, type ElementView, type WireDocPos } from '@sudobility/writing_core';
import { EL_ATTR, blocksOf, domPointToPlain, findBlock, plainToYIndex, readDomSelection, type DomSelection } from './dom-positions';
import { wuiDebug } from './debug';
import { classifyPastedText, styleForRole } from './paste-classify';
import { WUI_MIME, collectSelection, readPayload, styleFor, toHtml, toPlainText, type ClipElement, type ClipPayload } from './clipboard';
import { nextStyle } from './style-cycle';
import { EMPTY_PARENS, beforeClosingParen, styleChange } from './parenthetical';
import type { CueCompletion } from './CueComplete';
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
  /** Restore the controlled DOM if a browser edit changed the block structure. */
  resetDom: () => void;
  /** The element whose DOM the browser owns right now (IME composition); React must not touch it. */
  setComposing: (elementId: string | null) => void;
  /** An element's type was changed from the keyboard (Tab, Cmd/Ctrl+number): the editor shows the type at the caret. */
  typeChanged?: (elementId: string) => void;
  /** The open list of character names, if one is open: it gets the keys that operate it. */
  completion?: () => CueCompletion | null;
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
    // Inside "(quietly|)": Enter finishes the parenthetical, it does not cut its closing parenthesis off.
    if (beforeClosingParen(model(), at)) at = { elementId: at.elementId, offset: at.offset + 1 };
    const res = exec([{ id: 'element.split', params: { at: toWire(at) } }], 'local-command', group);
    if (!res.ok) return void (o.collapsed || env.setCaret(at));
    const r = res.results[0];
    const head = r && r.ok ? r.selection?.head : undefined;
    if (!head) return env.setCaret(at);
    // A new line that the template made a parenthetical starts with its pair of parentheses too.
    const made = model().element(head.elementId as never);
    if (made && made.role === 'parenthetical' && made.text.plain === '') {
      const ins = exec([{ id: 'text.insert', params: { at: toWire({ elementId: head.elementId, offset: 0 }), text: EMPTY_PARENS } }], 'local-command', group);
      if (ins.ok) return env.setCaret({ elementId: head.elementId, offset: 1 });
    }
    env.setCaret({ elementId: head.elementId, offset: 0 });
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

  function paste(text: string, typed?: readonly ClipElement[]): void {
    const lines = text.split(/\r\n|\r|\n/).filter((l) => l.length > 0);
    if (lines.length === 0) return;
    // Text copied from the editor inside one element is just text: it takes the type of where it lands.
    const roles = typed ? [] : classifyPastedText(text);
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
    // Pasting into a line that already has text adds to that line: it keeps its type.
    const intoText = plainLen(model().element(at.elementId as never)) > 0;
    const createdIds: string[] = [];
    for (const [i, line] of lines.entries()) {
      const r = exec([{ id: 'text.insert', params: { at: toWire(at), text: line } }], 'local-command', group);
      if (!r.ok) break;
      createdIds.push(at.elementId);
      at = { elementId: at.elementId, offset: at.offset + line.length };
      if (i < lines.length - 1) {
        const s = exec([{ id: 'element.split', params: { at: toWire(at) } }], 'local-command', group);
        if (!s.ok) break;
        const first = s.results[0];
        const head = first && first.ok ? first.selection?.head : undefined;
        if (head) at = { elementId: head.elementId, offset: 0 };
      }
    }
    // Tag each pasted line with a screenplay role (scene heading, character, dialogue, action, ...; see
    // paste-classify.ts) and assign the current template's matching style, overriding whatever style the
    // split's own template-flow logic (`enterAction`) picked for it.
    const styles = model().template().styles;
    for (const [i, id] of createdIds.entries()) {
      const role = roles[i];
      if (!role || (i === 0 && intoText)) continue;
      const style = styleForRole(styles, role);
      exec([{ id: 'element.setStyle', params: { elements: [id], style: style.id } }], 'local-command', group);
    }
    env.setCaret(at);
  }

  /**
   * Paste elements copied from the editor, each with its own type. One element (a word, a phrase, a line) is text:
   * it goes in at the caret and takes the type of where it lands. Several are elements: they are never joined to
   * the text around the caret, which is split off into elements of its own and keeps its type.
   */
  function pasteElements(payload: ClipPayload): void {
    const els = payload.elements.filter((e, i, all) => e.text.length > 0 || (i > 0 && i < all.length - 1));
    if (els.length === 0) return;
    if (els.length === 1) return paste(els[0]!.text.replace(/\r\n|\r|\n/g, ' '), [els[0]!]);
    const sel = selection();
    if (!sel) return;
    const o = order(sel);
    const group = newGroup();
    let at = o.from;
    if (!o.collapsed) {
      const s = deleteSelection(o, group);
      if (s === undefined || s === null) return;
      at = s;
    }
    const split = (p: PlainPos): PlainPos | null => {
      const r = exec([{ id: 'element.split', params: { at: toWire(p) } }], 'local-command', group);
      const first = r.ok ? r.results[0] : undefined;
      const head = first && first.ok ? first.selection?.head : undefined;
      return head ? { elementId: head.elementId, offset: 0 } : null;
    };
    const setStyle = (id: string, style: string) => exec([{ id: 'element.setStyle', params: { elements: [id], style } }], 'local-command', group);

    const origin = model().element(at.elementId as never);
    if (!origin) return;
    const originStyle = String(origin.style);
    const textAfter = at.offset < plainLen(origin);
    if (at.offset > 0) {
      const next = split(at); // the text before the caret stays where it is, in its own element
      if (!next) return;
      setStyle(at.elementId, originStyle);
      at = next;
    }
    const styles = model().template().styles;
    let end = at;
    for (const [i, el] of els.entries()) {
      const text = el.text.replace(/\r\n|\r|\n/g, ' ');
      if (text && !exec([{ id: 'text.insert', params: { at: toWire(at), text } }], 'local-command', group).ok) break;
      const id = at.elementId;
      end = { elementId: id, offset: text.length };
      const last = i === els.length - 1;
      if (!last || textAfter) {
        const next = split(end);
        if (!next) break;
        at = next;
      }
      // After the split: the split's own flow may have restyled the element it left behind.
      setStyle(id, String(styleFor(styles, el).id));
    }
    if (textAfter) setStyle(at.elementId, originStyle); // what stood after the caret keeps its type
    env.setCaret(end);
  }

  /** What the selection holds, put on the clipboard as text for other programs and as typed elements for the editor. */
  function writeClipboard(e: ClipboardEvent): Order | null {
    const sel = readSelectionOnly();
    const data = e.clipboardData;
    if (!sel || !data) return null;
    const o = order(sel);
    if (o.collapsed) return null;
    const m = model();
    const elements: ClipElement[] = collectSelection(m, o.from, o.to);
    if (elements.length === 0) return null;
    const caps = new Map<string, boolean>();
    const ids = m.elements({ from: m.indexOf(o.from.elementId as never), to: m.indexOf(o.to.elementId as never) + 1 });
    for (const v of ids) if (!caps.has(String(v.style))) caps.set(String(v.style), m.resolveStyle(v.id).allCaps);
    const payload: ClipPayload = { v: 1, elements };
    const plain = toPlainText(elements, (style) => caps.get(style) === true, m.meta().language);
    e.preventDefault();
    data.setData('text/plain', plain);
    data.setData('text/html', toHtml(payload, plain));
    try {
      data.setData(WUI_MIME, JSON.stringify(payload));
    } catch {
      // a browser that refuses custom types: the html flavour carries the elements
    }
    return o;
  }

  function onCopy(e: ClipboardEvent): void {
    if (composing) return;
    writeClipboard(e);
  }

  function onCut(e: ClipboardEvent): void {
    if (composing) return;
    if (env.readOnly()) return void writeClipboard(e);
    const o = writeClipboard(e);
    if (o) deleteSelectionAndCaret(o);
  }

  /** The `paste` event, not `beforeinput`: only here does the clipboard hand back every flavour that was copied. */
  function onPaste(e: ClipboardEvent): void {
    if (composing) return;
    e.preventDefault();
    if (env.readOnly()) return;
    const payload = readPayload(e.clipboardData);
    if (payload) return pasteElements(payload);
    paste(e.clipboardData?.getData('text/plain') ?? '');
  }

  /**
   * Take a name from the list of characters: what was typed of the cue becomes the name, in capitals (a cue is shown
   * in capitals, and stored the way it is shown). `advance` goes on to the next line, as Enter does after a cue.
   */
  function completeCue(name: string, advance: boolean): void {
    const sel = readSelectionOnly();
    if (!sel) return;
    const m = model();
    const view = m.element(sel.head.elementId as never);
    if (!view) return;
    const id = sel.head.elementId;
    const text = name.toLocaleUpperCase(m.meta().language);
    const group = newGroup();
    const res = exec([{ id: 'text.replaceRange', params: { range: range({ elementId: id, offset: 0 }, { elementId: id, offset: plainLen(view) }), text } }], 'local-command', group);
    if (!res.ok) return;
    const end = { elementId: id, offset: text.length };
    if (!advance) return env.setCaret(end);
    const split = exec([{ id: 'element.split', params: { at: toWire(end) } }], 'local-command', group);
    const first = split.ok ? split.results[0] : undefined;
    const head = first && first.ok ? first.selection?.head : undefined;
    env.setCaret(head ? { elementId: head.elementId, offset: 0 } : end);
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

  /**
   * Tab / Shift+Tab: the element at the caret (every element of a selection) becomes the next / previous type in the
   * cycle (`style-cycle.ts`), whatever it holds and wherever the caret is in it. The text and the caret stay.
   */
  function tab(direction: 'forward' | 'back'): void {
    const sel = readSelectionOnly();
    if (!sel) return;
    const m = model();
    const o = order(sel);
    const head = m.element(sel.head.elementId as never);
    if (!head) return;
    const style = nextStyle(m.template(), String(head.style), direction);
    if (!style) return;
    const ids = m.elements({ from: m.indexOf(o.from.elementId as never), to: m.indexOf(o.to.elementId as never) + 1 }).map((e) => e.id);
    if (ids.length === 0) return;
    if (!setStyle(ids.map(String), String(style.id), sel)) return;
    env.typeChanged?.(sel.head.elementId);
  }

  /** Set the type of elements (see `parenthetical.ts` for what comes with it) and put the caret back, or where the change put it. */
  function setStyle(ids: string[], styleId: string, sel: DomSelection): boolean {
    const change = styleChange(model(), ids, styleId);
    if (!exec(change.commands, 'local-command', newGroup()).ok) return false;
    const moved = change.carets.get(sel.head.elementId);
    if (moved) env.setCaret(moved);
    else env.setCaret(sel.anchor, sel.head);
    return true;
  }

  /** The type menu: the same as choosing the type from the keyboard. Returns false when there is no selection to apply it to. */
  function applyStyle(styleId: string, selectionOverride?: DomSelection | null): boolean {
    const sel = selectionOverride ?? readSelectionOnly();
    if (!sel) return false;
    const m = model();
    const o = order(sel);
    const ids = m.elements({ from: m.indexOf(o.from.elementId as never), to: m.indexOf(o.to.elementId as never) + 1 }).map((e) => String(e.id));
    if (ids.length === 0 || !setStyle(ids, styleId, sel)) return false;
    env.typeChanged?.(sel.head.elementId);
    return true;
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
    if (setStyle(ids.map(String), String(style.id), sel)) env.typeChanged?.(sel.head.elementId);
    return true;
  }

  // ─── DOM event entry points ───────────────────────────────────────────────

  function onBeforeInput(e: InputEvent): void {
    wuiDebug('beforeinput', { inputType: e.inputType, data: e.data ?? null });
    if (composing || e.isComposing) return; // the browser owns the composing element
    if (env.readOnly()) { e.preventDefault(); return; }
    // Non-cancelable native edits must be reconciled once, after the browser changes the DOM.
    if (!e.cancelable) return;
    if (e.inputType === 'insertReplacementText') {
      const root = env.root();
      if (!root) return;
      const targets = e.getTargetRanges?.() ?? [];
      const target = targets[0];
      const anchor = target ? domPointToPlain(root, target.startContainer, target.startOffset) : null;
      const head = target ? domPointToPlain(root, target.endContainer, target.endOffset) : null;
      const sel = target ? (anchor && head ? { anchor, head } : null) : readDomSelection(root);
      const data = e.data ?? e.dataTransfer?.getData('text/plain');
      // Some browsers omit the target/data, or leave the caret outside the corrected word.
      // Let them finish and read the actual edit in onInput; never insert a guess at the caret.
      if (targets.length > 1 || !sel || data == null) return;
      const o = order(sel);
      if (o.collapsed || o.from.elementId !== o.to.elementId) return;
      e.preventDefault();
      const res = exec([{ id: 'text.replaceRange', params: { range: range(o.from, o.to), text: data } }], 'local-command');
      if (res.ok) env.setCaret({ elementId: o.from.elementId, offset: o.from.offset + data.length });
      return;
    }
    e.preventDefault();
    switch (e.inputType) {
      case 'insertText': {
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
        return; // drag/drop and other formats: not supported, and the DOM stays untouched
    }
  }

  /**
   * Native spelling can bypass beforeinput or make it non-cancelable. Reconcile only an in-block
   * text edit, through the usual command/undo/sync path, then rebuild the browser-mutated block.
   * IME owns its DOM until compositionend. Unknown structural edits are reverted, never guessed.
   */
  function onInput(e: InputEvent): void {
    if (composing || e.isComposing) return;
    const root = env.root();
    if (!root) return;
    const blocks = blocksOf(root);
    const elements = model().elements();
    if (blocks.length !== elements.length || root.childNodes.length !== blocks.length ||
        blocks.some((b, i) => b.getAttribute(EL_ATTR) !== String(elements[i]!.id))) {
      env.resetDom();
      return;
    }
    const changed = blocks.flatMap((block, i) => {
      const view = elements[i]!;
      const text = block.textContent ?? '';
      return text === view.text.plain ? [] : [{ view, text }];
    });
    if (!changed.length) return;
    const sel = readDomSelection(root);
    // Discard browser-created text nodes even if the command below is refused.
    for (const { view } of changed) env.remount(String(view.id));
    if (env.readOnly() || changed.length !== 1 ||
        (e.inputType !== 'insertReplacementText' && e.inputType !== 'insertText')) return;
    const { view, text } = changed[0]!;
    const before = view.text.plain;
    let start = 0;
    while (start < before.length && start < text.length && before[start] === text[start]) start++;
    // A diff must not split a UTF-16 surrogate pair.
    if (start > 0 && /[\uDC00-\uDFFF]/.test(before[start] ?? text[start] ?? '')) start--;
    let suffix = 0;
    while (suffix < before.length - start && suffix < text.length - start &&
           before[before.length - suffix - 1] === text[text.length - suffix - 1]) suffix++;
    if (suffix > 0 && /[\uDC00-\uDFFF]/.test(before[before.length - suffix]!)) suffix--;
    const from = { elementId: String(view.id), offset: start };
    const to = { elementId: String(view.id), offset: before.length - suffix };
    const replacement = text.slice(start, text.length - suffix);
    const res = exec([{ id: 'text.replaceRange', params: { range: range(from, to), text: replacement } }], 'local-command');
    if (!res.ok) { env.setCaret(from); return; }
    if (sel) env.setCaret(sel.anchor, sel.head);
    else env.setCaret({ elementId: from.elementId, offset: start + replacement.length });
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
    const list = !mod && !e.altKey && !e.shiftKey ? env.completion?.() : null;
    if (list) {
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        e.preventDefault();
        return list.move(key === 'ArrowDown' ? 1 : -1);
      }
      if (key === 'Escape') {
        e.preventDefault();
        return list.close();
      }
      const name = key === 'Enter' ? list.current() : null;
      if (name) {
        e.preventDefault();
        return completeCue(name, true);
      }
    }
    if (key === 'Tab' && !mod && !e.altKey) {
      e.preventDefault();
      return tab(e.shiftKey ? 'back' : 'forward');
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

  return { onBeforeInput, onInput, onKeyDown, onCompositionStart, onCompositionEnd, onCopy, onCut, onPaste, completeCue, applyStyle, EL_ATTR };
}

export type InputController = ReturnType<typeof createInputController>;
