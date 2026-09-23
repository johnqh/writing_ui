/**
 * Regression test for a soak-tested anomaly: an Action element silently becoming `st_character`
 * with no Tab key sent. Root cause: `ElementStylePicker` is a bare native `<select>`; a focused,
 * CLOSED `<select>` responds to a plain printable-letter keydown with the browser's own built-in
 * "type-ahead" (jump to the first option starting with that letter, firing a real `change` event) —
 * so merely focusing the picker (a click, Tab, or a test/UI helper's `.focus()`) and then typing
 * anywhere lets a stray keystroke silently restyle the current element. The fix (`ElementStylePicker`'s
 * own `onKeyDown`) blocks every key except the ones a native select needs to operate as a dropdown,
 * redirecting focus back to the editor instead.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryHost, type MemoryHost } from '../demo/memory-host';
import { ElementStylePicker } from '../src/ElementStylePicker';
import { ScriptEditor } from '../src/ScriptEditor';
import { getSelectionStore } from '../src/selection-store';

let host: MemoryHost;

function mount() {
  host = createMemoryHost();
  const r = render(
    <>
      <ElementStylePicker host={host} />
      <ScriptEditor host={host} />
    </>,
  );
  const select = r.container.querySelector('[data-testid="style-picker"]') as HTMLSelectElement;
  const page = r.container.querySelector('.wui-page') as HTMLElement;
  // A selection is required for the picker to be enabled at all (ids.length > 0).
  const id = String(host.model.elements()[0]!.id);
  act(() => {
    getSelectionStore(host).set({ anchor: { elementId: id, offset: 0 }, head: { elementId: id, offset: 0 } });
  });
  return { select, page };
}

function keydown(el: HTMLElement, key: string, init: KeyboardEventInit = {}) {
  const ev = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true, ...init });
  act(() => void el.dispatchEvent(ev));
  return ev;
}

beforeEach(() => {
  document.getSelection()?.removeAllRanges();
});
afterEach(() => {
  cleanup();
  host?.dispose();
});

describe('ElementStylePicker: guarded against native <select> type-ahead', () => {
  it('a plain letter keydown while focused is blocked and focus returns to the editor', () => {
    const { select, page } = mount();
    expect(select.disabled).toBe(false);
    act(() => select.focus());
    expect(document.activeElement).toBe(select);
    const ev = keydown(select, 'c');
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(page);
  });

  it('digits and other printable keys are blocked the same way', () => {
    const { select, page } = mount();
    act(() => select.focus());
    const ev = keydown(select, '3');
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(page);
  });

  it('keys needed to operate the dropdown (Enter, arrows, space, Escape, Tab) are left alone', () => {
    const { select } = mount();
    for (const key of ['Enter', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Escape', 'Tab', ' ']) {
      act(() => select.focus());
      const ev = keydown(select, key);
      expect(ev.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(select);
    }
  });

  it('a modifier combo is left alone, not treated as a stray printable key', () => {
    const { select } = mount();
    act(() => select.focus());
    const ev = keydown(select, 'c', { metaKey: true });
    expect(ev.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(select);
  });

  it('a real style change (genuine onChange, not type-ahead) still applies and returns focus to the editor', () => {
    const { select, page } = mount();
    act(() => select.focus());
    act(() => {
      select.value = 'st_dialogue';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(String(host.model.elements()[0]!.style)).toBe('st_dialogue');
    expect(document.activeElement).toBe(page);
  });
});
