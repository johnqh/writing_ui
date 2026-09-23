import { act, cleanup, render } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryHost, type MemoryHost } from '../demo/memory-host';
import { readDomSelection, writeDomSelection } from '../src/dom-positions';
import { ScriptEditor } from '../src/ScriptEditor';

let host: MemoryHost;
let page: HTMLElement;

const ids = () => host.model.elements().map((e) => String(e.id));
const plain = (i: number) => host.model.elementAt(i).text.plain;
const styleOf = (i: number) => String(host.model.elementAt(i).style);
const caret = () => {
  const s = readDomSelection(page);
  return s ? { anchor: s.anchor, head: s.head } : null;
};

function mount(h = createMemoryHost(), props: { readOnly?: boolean } = {}) {
  host = h;
  const r = render(<ScriptEditor host={host} {...props} />);
  page = r.container.querySelector('.wui-page') as HTMLElement;
  return r;
}

function select(a: [number, number], b: [number, number] = a) {
  const all = ids();
  act(() => {
    writeDomSelection(page, { elementId: all[a[0]]!, offset: a[1] }, { elementId: all[b[0]]!, offset: b[1] });
  });
}

function input(inputType: string, data: string | null = null) {
  const ev = new InputEvent('beforeinput', { inputType, data, cancelable: true, bubbles: true });
  act(() => void page.dispatchEvent(ev));
  return ev;
}

function key(k: string, init: KeyboardEventInit = {}) {
  const ev = new KeyboardEvent('keydown', { key: k, cancelable: true, bubbles: true, ...init });
  act(() => void page.dispatchEvent(ev));
  return ev;
}

const at = (i: number, offset: number) => ({ elementId: ids()[i]!, offset });

beforeEach(() => {
  document.getSelection()?.removeAllRanges();
});
afterEach(() => {
  cleanup();
  host?.dispose();
});

describe('yjs', () => {
  it('a writing_core document is an instance of the Yjs this package imports', () => {
    const h = createMemoryHost();
    expect(h.doc instanceof Y.Doc).toBe(true);
    h.dispose();
  });
});

describe('rendering', () => {
  it('renders one block per element with style classes and template geometry', () => {
    mount();
    const blocks = page.querySelectorAll('[data-el-id]');
    expect(blocks.length).toBe(4);
    expect(blocks[0]!.className).toContain('wui-role-sceneHeading');
    expect(blocks[2]!.className).toContain('wui-role-character');
    expect((blocks[0] as HTMLElement).style.textTransform).toBe('uppercase');
    // Character: 2.0in left indent, 0.25in right (914 400 EMU per inch).
    expect((blocks[2] as HTMLElement).style.marginLeft).toBe('2in');
    expect((blocks[2] as HTMLElement).style.marginRight).toBe('0.25in');
    // Text column: 8.5in page minus 1.5in and 1in margins.
    expect(page.style.width).toBe('6in');
    expect(blocks[0]!.textContent).toBe('int. writers room - night');
  });

  it('shows a placeholder for an empty document and read-only disables input', () => {
    const h = createMemoryHost({ seed: [] });
    mount(h, { readOnly: true });
    expect(page.querySelector('[data-empty-document]')).not.toBeNull();
    expect(page.getAttribute('contenteditable')).toBe('false');
    expect(host.model.elementCount()).toBe(0);
    input('insertText', 'x');
    expect(host.model.elementCount()).toBe(0);
  });

  it('typing into an empty document creates the first element', () => {
    mount(createMemoryHost({ seed: [] }));
    act(() => void (page.querySelector('.wui-el') as HTMLElement).focus());
    act(() => void document.getSelection()!.setBaseAndExtent(page, 0, page, 0));
    input('insertText', 'H');
    expect(host.model.elementCount()).toBe(1);
    expect(plain(0)).toBe('H');
    expect(caret()!.head).toEqual(at(0, 1));
  });
});

describe('input', () => {
  it('typing a character updates the model and keeps the caret after it', () => {
    mount();
    select([1, 5]);
    const ev = input('insertText', 'X');
    expect(ev.defaultPrevented).toBe(true);
    expect(plain(1).slice(0, 12)).toBe('A sinXgle la');
    expect(caret()!.head).toEqual(at(1, 6));
    input('insertText', 'Y');
    expect(plain(1).slice(0, 8)).toBe('A sinXYg');
    expect(caret()!.head).toEqual(at(1, 7));
  });

  it('typing replaces a selection within one element', () => {
    mount();
    select([2, 0], [2, 3]);
    input('insertText', 'Z');
    expect(plain(2)).toBe('Za');
    expect(caret()!.head).toEqual(at(2, 1));
  });

  it('Enter at the end of a scene heading creates the template next style; the caret moves to it', () => {
    mount();
    select([0, plain(0).length]);
    input('insertParagraph');
    expect(host.model.elementCount()).toBe(5);
    expect(styleOf(1)).toBe('st_action');
    expect(plain(1)).toBe('');
    expect(caret()!.head).toEqual(at(1, 0));
    // Character then dialogue, following the flow rules.
    select([3, plain(3).length]);
    input('insertParagraph');
    expect(styleOf(4)).toBe('st_dialogue');
    expect(caret()!.head).toEqual(at(4, 0));
  });

  it('Enter mid-element splits it and puts the caret at the start of the tail', () => {
    mount();
    select([3, 6]);
    input('insertParagraph');
    expect(host.model.elementCount()).toBe(5);
    expect(plain(3)).toBe('Twelve');
    expect(plain(4)).toBe(' drafts. Not one of them knows how it ends.');
    expect(caret()!.head).toEqual(at(4, 0));
  });

  it('Backspace at an element start merges into the previous element with the caret at the join', () => {
    mount();
    const prevLen = plain(2).length;
    select([3, 0]);
    input('deleteContentBackward');
    expect(host.model.elementCount()).toBe(3);
    expect(plain(2)).toBe('Maya' + 'Twelve drafts. Not one of them knows how it ends.');
    expect(caret()!.head).toEqual(at(2, prevLen));
  });

  it('Backspace inside text deletes one character and moves the caret back', () => {
    mount();
    select([3, 6]);
    input('deleteContentBackward');
    expect(plain(3).slice(0, 8)).toBe('Twelv dr');
    expect(caret()!.head).toEqual(at(3, 5));
  });

  it('a cross-element selection is deleted by typing over it', () => {
    mount();
    select([2, 2], [3, 6]);
    input('insertText', '!');
    // Character and Dialogue differ in style, so the engine trims both ends but does not join them.
    expect(host.model.elementCount()).toBe(4);
    expect(plain(2)).toBe('Ma!');
    expect(plain(3)).toBe(' drafts. Not one of them knows how it ends.');
    expect(caret()!.head).toEqual(at(2, 3));
  });

  it('Cmd+B toggles bold on a selection and keeps the selection', () => {
    mount();
    select([3, 0], [3, 6]);
    key('b', { metaKey: true });
    const runs = host.model.elementAt(3).text.runs;
    expect(runs[0]!.text).toBe('Twelve');
    expect(runs[0]!.attrs).toMatchObject({ b: true });
    expect(page.querySelector('[data-el-id]:nth-child(4) span')!.getAttribute('style')).toContain('font-weight: 700');
    expect(caret()).toEqual({ anchor: at(3, 0), head: at(3, 6) });
    input('formatBold');
    expect(host.model.elementAt(3).text.runs[0]!.attrs).not.toHaveProperty('b');
  });

  it('paste inserts plain text and splits on newlines', () => {
    mount();
    select([1, plain(1).length]);
    const ev = new InputEvent('beforeinput', { inputType: 'insertFromPaste', data: 'ONE\nTWO', cancelable: true, bubbles: true });
    act(() => void page.dispatchEvent(ev));
    expect(plain(1).endsWith('ONE')).toBe(true);
    expect(plain(2)).toBe('TWO');
    expect(caret()!.head).toEqual(at(2, 3));
    // Two consecutive all-caps lines with nothing else around them are ambiguous (could be two headings,
    // could be a character cue with no dialogue yet), so the classifier's lookahead declines to call the
    // first one a character cue and both stay Action — this overrides the split's own template-flow guess
    // (Action -Enter-> Character), which is what the old, pre-classification version of this test observed.
    expect(styleOf(1)).toBe('st_action');
    expect(styleOf(2)).toBe('st_action');
  });

  describe('paste classification', () => {
    // Representative excerpts in the "flat paste" shape (no blank lines between elements) that prompted
    // this feature — plain text pasted from somewhere that doesn't preserve Fountain's blank-line
    // convention. See src/paste-classify.ts for the two-mode design and its accepted limitation.
    // Replaces the whole element at `elementIndex` with a (possibly multi-line) paste: the first pasted
    // line lands in that element itself, and each following line becomes a new element right after it.
    const pasteReplacing = (elementIndex: number, text: string) => {
      select([elementIndex, 0], [elementIndex, plain(elementIndex).length]);
      const ev = new InputEvent('beforeinput', { inputType: 'insertFromPaste', data: text, cancelable: true, bubbles: true });
      act(() => void page.dispatchEvent(ev));
    };

    it('classifies a scene heading, overriding the element it replaces (Action)', () => {
      mount();
      pasteReplacing(1, 'INT. KITCHEN - DAY');
      expect(plain(1)).toBe('INT. KITCHEN - DAY');
      expect(styleOf(1)).toBe('st_scene_heading');
    });

    it('classifies a character cue followed by dialogue', () => {
      mount();
      pasteReplacing(1, 'MAYA\nWe need more coffee.');
      expect(plain(1)).toBe('MAYA');
      expect(styleOf(1)).toBe('st_character');
      expect(plain(2)).toBe('We need more coffee.');
      expect(styleOf(2)).toBe('st_dialogue');
    });

    it('classifies a character cue, a parenthetical, then dialogue', () => {
      mount();
      pasteReplacing(1, 'LEE\n(with excitement)\nWe found it!');
      expect(plain(1)).toBe('LEE');
      expect(styleOf(1)).toBe('st_character');
      expect(plain(2)).toBe('(with excitement)');
      expect(styleOf(2)).toBe('st_parenthetical');
      expect(plain(3)).toBe('We found it!');
      expect(styleOf(3)).toBe('st_dialogue');
    });

    it('classifies an all-caps line ending in a period as action, not a character cue', () => {
      mount();
      // "NOON." reads like a time-stamp aside, not a name — real character names don't end in a bare period.
      pasteReplacing(1, 'NOON.\nThe clock on the wall has stopped.');
      expect(plain(1)).toBe('NOON.');
      expect(styleOf(1)).toBe('st_action');
      expect(plain(2)).toBe('The clock on the wall has stopped.');
      expect(styleOf(2)).toBe('st_action');
    });

    it('accepted limitation: dialogue running into action with no blank line reads as more dialogue', () => {
      mount();
      pasteReplacing(1, 'MOURNER #3\nHe was a good man.\nThe pallbearers carry the coffin toward the hearse.');
      expect(plain(1)).toBe('MOURNER #3');
      expect(styleOf(1)).toBe('st_character');
      expect(plain(2)).toBe('He was a good man.');
      expect(styleOf(2)).toBe('st_dialogue');
      // This line is actually action, but nothing distinguishes it from more dialogue without a blank
      // line or a new cue — an honest, documented limitation, not a bug. Tab/Cmd+2 fixes it up by hand.
      expect(plain(3)).toBe('The pallbearers carry the coffin toward the hearse.');
      expect(styleOf(3)).toBe('st_dialogue');
    });
  });

  it('Tab on an empty element cycles its style; Cmd+1 applies the style with that shortcut', () => {
    mount();
    select([0, plain(0).length]);
    input('insertParagraph'); // empty action
    expect(styleOf(1)).toBe('st_action');
    key('Tab'); // action tab-empty -> character
    expect(styleOf(1)).toBe('st_character');
    expect(caret()!.head).toEqual(at(1, 0));
    key('1', { metaKey: true });
    expect(styleOf(1)).toBe('st_scene_heading');
  });

  it('undo reverts typing and puts the caret back; redo reapplies it', () => {
    mount();
    select([3, 6]);
    input('insertText', 'Q');
    expect(plain(3).slice(0, 8)).toBe('TwelveQ ');
    expect(caret()!.head).toEqual(at(3, 7));
    key('z', { metaKey: true });
    expect(plain(3).slice(0, 8)).toBe('Twelve d');
    expect(caret()!.head).toEqual(at(3, 6));
    key('z', { metaKey: true, shiftKey: true });
    expect(plain(3).slice(0, 8)).toBe('TwelveQ ');
    expect(caret()!.head).toEqual(at(3, 7));
  });

  it('undo of Enter removes the new element and returns the caret to the split point', () => {
    mount();
    select([3, 6]);
    input('insertParagraph');
    expect(host.model.elementCount()).toBe(5);
    input('historyUndo');
    expect(host.model.elementCount()).toBe(4);
    expect(plain(3).slice(0, 12)).toBe('Twelve draft');
    expect(caret()!.head).toEqual(at(3, 6));
  });
});

describe('composition', () => {
  it('applies the composed text on compositionend and leaves the DOM alone until then', () => {
    mount();
    select([3, 6]);
    act(() => void page.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
    // The browser mutates the composing element's text natively.
    const block = page.querySelectorAll('[data-el-id]')[3]!;
    const textNode = block.firstChild!.firstChild as Text;
    act(() => {
      textNode.data = 'Twelve' + '漢字' + textNode.data.slice(6);
    });
    // beforeinput during composition is not cancelled.
    const ev = new InputEvent('beforeinput', { inputType: 'insertCompositionText', data: '漢字', cancelable: true, bubbles: true, isComposing: true });
    act(() => void page.dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(false);
    expect(plain(3).slice(0, 8)).toBe('Twelve d');
    act(() => void page.dispatchEvent(new CompositionEvent('compositionend', { data: '漢字', bubbles: true })));
    expect(plain(3).slice(0, 10)).toBe('Twelve漢字 d');
    expect(caret()!.head).toEqual(at(3, 8));
    expect(page.querySelectorAll('[data-el-id]')[3]!.textContent!.slice(0, 10)).toBe('Twelve漢字 d');
  });
});

describe('remote cursors and local cursor', () => {
  it('renders a labelled overlay caret for a remote cursor', () => {
    mount();
    act(() => {
      host.setRemoteCursors([{ clientId: 7, user: { id: 'u', name: 'Sam', color: '#e11d48' }, cursor: { anchor: at(3, 4), head: at(3, 4) } }]);
    });
    const el = document.querySelector('[data-remote-cursor="7"]');
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe('Sam');
  });

  it('publishes the local selection through setLocalCursor', async () => {
    mount();
    select([3, 2], [3, 5]);
    act(() => void document.dispatchEvent(new Event('selectionchange')));
    await new Promise((r) => setTimeout(r, 150));
    expect(host.lastCursor).toEqual({ anchor: at(3, 2), head: at(3, 5) });
  });
});

describe('scene number gutter', () => {
  it('marks scene headings with their number when scene numbering is on', () => {
    const r = mount();
    expect(r.container.querySelector('[data-scene-num]')).toBeNull();
    act(() => void host.execute([{ id: 'template.setSceneNumbering', params: { mode: 'both' } }]));
    expect(r.container.querySelector('[data-scene-num]')?.getAttribute('data-scene-num')).toBe('1');
  });
});

describe('revisions', () => {
  it('a revised element carries a coloured bar (data-rev-set) while revision display is on', () => {
    mount();
    const run = (id: string, params: unknown) => act(() => void host.execute([{ id, params }]));
    run('revision.setCurrent', {});
    run('revision.mode', { on: true });
    run('text.insert', { at: { elementId: ids()[0]!, offset: 0 }, text: 'Z' });
    const block = page.querySelector<HTMLElement>(`[data-el-id="${ids()[0]}"]`)!;
    expect(block.dataset.revSet).toBeTruthy();
    expect(block.style.getPropertyValue('--wui-rev-color')).toBe('#0000FF');
    run('revision.setDisplay', { display: 'none' });
    expect(page.querySelector<HTMLElement>(`[data-el-id="${ids()[0]}"]`)!.dataset.revSet).toBeUndefined();
  });
});
