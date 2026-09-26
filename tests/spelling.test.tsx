import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { openDocument } from '@sudobility/writing_core';
import { createMemoryHost, type MemoryHost } from '../demo/memory-host';
import { ScriptEditor } from '../src/ScriptEditor';
import { plainToDomPoint, readDomSelection, writeDomSelection } from '../src/dom-positions';

let host: MemoryHost;
let page: HTMLElement;
const original = 'A mispelled word.';
const corrected = 'A misspelled word.';
const id = () => String(host.model.elementAt(0).id);
const text = () => host.model.elementAt(0).text.plain;
const block = () => page.querySelector<HTMLElement>('[data-el-id]')!;
function mount(readOnly = false) {
  host = createMemoryHost({ seed: [{ style: 'st_action', text: original }] });
  const view = render(<ScriptEditor host={host} readOnly={readOnly} />);
  page = view.container.querySelector('.wui-page')!;
  act(() => { writeDomSelection(page, { elementId: id(), offset: 0 }); });
  return view;
}
function replacement(cancelable = true, data: string | null = 'misspelled') {
  const from = plainToDomPoint(page, { elementId: id(), offset: 2 })!;
  const to = plainToDomPoint(page, { elementId: id(), offset: 11 })!;
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  const e = new InputEvent('beforeinput', { inputType: 'insertReplacementText', data, bubbles: true, cancelable });
  Object.defineProperty(e, 'getTargetRanges', { value: () => [range] });
  act(() => { page.dispatchEvent(e); });
  return e;
}
function nativeEdit(inputType = 'insertReplacementText', next = corrected) {
  act(() => {
    block().textContent = next;
    writeDomSelection(page, { elementId: id(), offset: 12 });
    page.dispatchEvent(new InputEvent('input', { inputType, bubbles: true }));
  });
}
afterEach(() => { cleanup(); host?.dispose(); });

describe('native spelling', () => {
  it('uses the correction range rather than the caret, preserves marks, and syncs undo/redo', () => {
    mount();
    act(() => {
      host.execute([{ id: 'mark.toggle', params: {
        range: { anchor: { elementId: id(), offset: 2 }, head: { elementId: id(), offset: 11 } }, mark: 'b',
      } }]);
    });
    const replica = new Y.Doc();
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(host.doc));
    const remote = openDocument(replica, host.model.deps);
    const forward = (update: Uint8Array) => Y.applyUpdate(replica, update);
    host.doc.on('update', forward);
    try {
      expect(replacement().defaultPrevented).toBe(true);
      expect(text()).toBe(corrected);
      expect(remote.elementAt(0).text.plain).toBe(corrected);
      expect(host.model.elementAt(0).text.runs.find(r => r.text.includes('misspelled'))?.attrs.b).toBe(true);
      expect(readDomSelection(page)?.head.offset).toBe(12);
      act(() => { host.undo(); });
      expect(text()).toBe(original);
      expect(remote.elementAt(0).text.plain).toBe(original);
      act(() => { host.redo(); });
      expect(text()).toBe(corrected);
    } finally {
      host.doc.off('update', forward);
      remote.dispose();
      replica.destroy();
    }
  });

  it('reconciles a non-cancelable correction once, after the DOM edit', () => {
    mount();
    replacement(false);
    expect(text()).toBe(original);
    nativeEdit();
    expect(text()).toBe(corrected);
    expect(block().textContent).toBe(corrected);
    act(() => { host.undo(); });
    expect(text()).toBe(original);
  });

  it.each(['insertReplacementText', 'insertText'])('reconciles an input-only %s correction', inputType => {
    mount();
    nativeEdit(inputType);
    expect(text()).toBe(corrected);
    // React owns the rebuilt DOM, so ordinary typing still works after the native mutation.
    act(() => { page.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: '!', cancelable: true, bubbles: true })); });
    expect(text()).toBe('A misspelled! word.');
  });

  it('does not guess a replacement at a collapsed caret when target/data are missing', () => {
    mount();
    const e = new InputEvent('beforeinput', { inputType: 'insertReplacementText', data: 'misspelled', cancelable: true, bubbles: true });
    act(() => { page.dispatchEvent(e); });
    expect(e.defaultPrevented).toBe(false);
    expect(text()).toBe(original);
    nativeEdit();
    expect(text()).toBe(corrected);
  });

  it('uses selected text as a fallback when target ranges are unavailable', () => {
    mount();
    act(() => {
      writeDomSelection(page, { elementId: id(), offset: 2 }, { elementId: id(), offset: 11 });
      page.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertReplacementText', data: 'misspelled', cancelable: true, bubbles: true }));
    });
    expect(text()).toBe(corrected);
  });

  it('reverts native mutations in a read-only editor', () => {
    mount(true);
    expect(replacement().defaultPrevented).toBe(true);
    nativeEdit();
    expect(text()).toBe(original);
    expect(block().textContent).toBe(original);
  });

  it('restores unexpected block structure and keeps input listeners attached', () => {
    const view = mount();
    act(() => {
      page.append(document.createElement('div'));
      page.dispatchEvent(new InputEvent('input', { inputType: 'insertReplacementText', bubbles: true }));
    });
    page = view.container.querySelector('.wui-page')!;
    expect(page.children.length).toBe(1);
    act(() => {
      writeDomSelection(page, { elementId: id(), offset: 0 });
      page.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: '!', cancelable: true, bubbles: true }));
    });
    expect(text()).toBe('!' + original);
  });

  it('leaves IME text to the composition handler', () => {
    mount();
    act(() => { page.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); });
    nativeEdit();
    expect(text()).toBe(original);
  });

  it('updates spelling eligibility on role changes and honors language/nospell marks', () => {
    const view = mount();
    expect(block().getAttribute('spellcheck')).toBe('true');
    expect(page.getAttribute('lang')).toBe(host.model.meta().language);
    act(() => { host.execute([{ id: 'element.setStyle', params: { elements: [id()], style: 'st_character' } }]); });
    expect(block().getAttribute('spellcheck')).toBe('false');
    act(() => {
      host.execute([{ id: 'element.setStyle', params: { elements: [id()], style: 'st_dialogue' } }]);
      const range = { anchor: { elementId: id(), offset: 2 }, head: { elementId: id(), offset: 11 } };
      host.execute([{ id: 'mark.set', params: { range, mark: 'nospell', value: true } }]);
      host.execute([{ id: 'mark.set', params: { range, mark: 'lang', value: 'fr' } }]);
    });
    expect(block().getAttribute('spellcheck')).toBe('true');
    const ignored = block().querySelector('[spellcheck="false"]')!;
    expect(ignored.textContent).toBe('mispelled');
    expect(ignored.getAttribute('lang')).toBe('fr');
    view.rerender(<ScriptEditor host={host} spellCheck={false} />);
    expect(block().getAttribute('spellcheck')).toBe('false');
  });
});
