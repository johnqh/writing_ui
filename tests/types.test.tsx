import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryHost, type MemoryHost } from '../demo/memory-host';
import { WUI_MIME, readPayload, toPlainText } from '../src/clipboard';
import { readDomSelection, writeDomSelection } from '../src/dom-positions';
import { ScriptEditor } from '../src/ScriptEditor';
import { cycleStyles, nextStyle } from '../src/style-cycle';
import { knownCueNames, matchCueNames } from '../src/cue-names';
import { ElementStylePicker } from '../src/ElementStylePicker';
import { fireEvent } from '@testing-library/react';

let host: MemoryHost;
let page: HTMLElement;
let root: HTMLElement;

const SCENE = [
  { style: 'st_scene_heading', text: 'int. lab - day' },
  { style: 'st_action', text: 'Dust floats in the light.' },
  { style: 'st_character', text: 'voss' },
  { style: 'st_parenthetical', text: '(quietly)' },
  { style: 'st_dialogue', text: 'IT SHOULD NOT BE RUNNING' },
  { style: 'st_action', text: 'She waits.' },
];

const ids = () => host.model.elements().map((e) => String(e.id));
const rows = () => host.model.elements().map((e) => [String(e.style), e.text.plain]);
const styleOf = (i: number) => String(host.model.elementAt(i).style);
const hint = () => root.querySelector('[data-testid="type-hint"]') as HTMLElement | null;

function mount(seed = SCENE) {
  host = createMemoryHost({ seed });
  const r = render(<ScriptEditor host={host} />);
  root = r.container;
  page = r.container.querySelector('.wui-page') as HTMLElement;
  act(() => void page.focus());
}
function select(a: [number, number], b: [number, number] = a) {
  const all = ids();
  act(() => {
    writeDomSelection(page, { elementId: all[a[0]]!, offset: a[1] }, { elementId: all[b[0]]!, offset: b[1] });
    document.dispatchEvent(new Event('selectionchange'));
  });
}
function key(k: string, init: KeyboardEventInit = {}) {
  const ev = new KeyboardEvent('keydown', { key: k, cancelable: true, bubbles: true, ...init });
  act(() => void page.dispatchEvent(ev));
  return ev;
}
function input(inputType: string, data: string | null = null) {
  act(() => void page.dispatchEvent(new InputEvent('beforeinput', { inputType, data, cancelable: true, bubbles: true })));
}

/** A clipboard that holds what `copy` put on it, like the real one. */
class Clip {
  private data = new Map<string, string>();
  setData(type: string, value: string) {
    this.data.set(type, value);
  }
  getData(type: string) {
    return this.data.get(type) ?? '';
  }
  only(...types: string[]) {
    const c = new Clip();
    for (const t of types) if (this.data.has(t)) c.setData(t, this.getData(t));
    return c;
  }
}
function clipboard(type: 'copy' | 'cut' | 'paste', clip: Clip) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', { value: clip });
  act(() => void page.dispatchEvent(ev));
  return ev;
}

beforeEach(() => document.getSelection()?.removeAllRanges());
afterEach(() => {
  cleanup();
  host?.dispose();
});

describe('Tab cycles through the types', () => {
  it('the cycle is the numbered styles, in the order of their numbers', () => {
    mount();
    const t = host.model.template();
    expect(cycleStyles(t).map((s) => s.id)).toEqual(['st_scene_heading', 'st_action', 'st_character', 'st_parenthetical', 'st_dialogue', 'st_transition', 'st_shot']);
    expect(nextStyle(t, 'st_shot', 'forward')?.id).toBe('st_scene_heading');
    expect(nextStyle(t, 'st_scene_heading', 'back')?.id).toBe('st_shot');
    expect(nextStyle(t, 'st_not_in_the_cycle', 'forward')?.id).toBe('st_scene_heading');
  });

  it('on a line with text, with the caret anywhere in it: the type changes, the text and the caret stay', () => {
    mount();
    select([1, 4]);
    const seen: string[] = [];
    for (let i = 0; i < 7; i++) {
      expect(key('Tab').defaultPrevented).toBe(true);
      seen.push(styleOf(1));
    }
    expect(seen).toEqual(['st_character', 'st_parenthetical', 'st_dialogue', 'st_transition', 'st_shot', 'st_scene_heading', 'st_action']);
    expect(host.model.elementAt(1).text.plain).toBe('Dust floats in the light.');
    expect(host.model.elementCount()).toBe(SCENE.length); // Tab never adds a line
    expect(readDomSelection(page)!.head).toEqual({ elementId: ids()[1], offset: 4 });
  });

  it('Shift+Tab goes back; on a new empty line Tab works the same', () => {
    mount();
    select([4, 3]);
    key('Tab', { shiftKey: true });
    expect(styleOf(4)).toBe('st_parenthetical');
    select([1, SCENE[1]!.text.length]);
    input('insertParagraph');
    const before = styleOf(2);
    key('Tab');
    expect(styleOf(2)).toBe(nextStyle(host.model.template(), before, 'forward')!.id);
    expect(host.model.elementAt(2).text.plain).toBe('');
  });

  it('a selection over several lines changes them all, and one undo takes it back', () => {
    mount();
    select([1, 2], [2, 1]);
    key('Tab');
    expect([styleOf(1), styleOf(2)]).toEqual(['st_parenthetical', 'st_parenthetical']);
    act(() => void host.undo());
    expect([styleOf(1), styleOf(2)]).toEqual(['st_action', 'st_character']);
  });
});

describe('the type at the caret', () => {
  it('is shown on a new, empty line and follows Tab', () => {
    mount();
    select([1, 3]);
    expect(hint()).toBeNull(); // a line with text says what it is by how it looks
    select([1, SCENE[1]!.text.length]);
    input('insertParagraph');
    act(() => void document.dispatchEvent(new Event('selectionchange')));
    const name = (id: string) => host.model.template().styles.find((s) => s.id === id)!.name;
    expect(hint()?.dataset.type).toBe(name(styleOf(2)));
    expect(hint()!.textContent).toContain('Tab to change');
    key('Tab');
    expect(hint()?.dataset.type).toBe(name(styleOf(2)));
    input('insertText', 'x');
    act(() => void document.dispatchEvent(new Event('selectionchange')));
    // typed into: the hint stays only for the moment after the change (it was changed by Tab just now)
    expect(hint()?.dataset.type).toBe(name(styleOf(2)));
  });

  it('is shown for a moment after Tab on a line with text; never in a read-only editor or without focus', () => {
    mount();
    select([1, 3]);
    key('Tab');
    expect(hint()?.dataset.type).toBe('Character');
    act(() => void page.blur());
    expect(hint()).toBeNull();
  });

  it('is not part of the document text', () => {
    mount();
    select([1, SCENE[1]!.text.length]);
    input('insertParagraph');
    act(() => void document.dispatchEvent(new Event('selectionchange')));
    expect(hint()).not.toBeNull();
    expect(page.contains(hint())).toBe(false);
  });
});

describe('copy and paste keep the type', () => {
  it('copy puts the elements on the clipboard with their types, and readable text for other programs', () => {
    mount();
    select([2, 0], [4, SCENE[4]!.text.length]);
    const clip = new Clip();
    expect(clipboard('copy', clip).defaultPrevented).toBe(true);
    expect(JSON.parse(clip.getData(WUI_MIME)).elements).toEqual([
      { style: 'st_character', role: 'character', text: 'voss' },
      { style: 'st_parenthetical', role: 'parenthetical', text: '(quietly)' },
      { style: 'st_dialogue', role: 'dialogue', text: 'IT SHOULD NOT BE RUNNING' },
    ]);
    // as shown: the cue in capitals, one speech on consecutive lines
    expect(clip.getData('text/plain')).toBe('VOSS\n(quietly)\nIT SHOULD NOT BE RUNNING');
    expect(rows()).toEqual(SCENE.map((s) => [s.style, s.text])); // copying changes nothing
  });

  it('a speech pasted on a new line arrives as cue, parenthetical and dialogue, whatever the text looks like', () => {
    mount();
    select([2, 0], [4, SCENE[4]!.text.length]);
    const clip = new Clip();
    clipboard('copy', clip);
    // a lower-case cue and a dialogue line in capitals: what guessing from the text gets wrong
    select([5, SCENE[5]!.text.length]);
    input('insertParagraph');
    clipboard('paste', clip);
    expect(rows().slice(5)).toEqual([
      ['st_action', 'She waits.'],
      ['st_character', 'voss'],
      ['st_parenthetical', '(quietly)'],
      ['st_dialogue', 'IT SHOULD NOT BE RUNNING'],
    ]);
    expect(readDomSelection(page)!.head).toEqual({ elementId: ids()[8], offset: 'IT SHOULD NOT BE RUNNING'.length });
  });

  it('pasted in the middle of a line: the line is split around the pasted elements and both halves keep its type', () => {
    mount();
    select([2, 0], [4, SCENE[4]!.text.length]);
    const clip = new Clip();
    clipboard('copy', clip);
    select([1, 5]);
    clipboard('paste', clip);
    expect(rows().slice(0, 7)).toEqual([
      ['st_scene_heading', 'int. lab - day'],
      ['st_action', 'Dust '],
      ['st_character', 'voss'],
      ['st_parenthetical', '(quietly)'],
      ['st_dialogue', 'IT SHOULD NOT BE RUNNING'],
      ['st_action', 'floats in the light.'],
      ['st_character', 'voss'],
    ]);
  });

  it('pasted at the end of a line: no empty line is left behind', () => {
    mount();
    select([2, 0], [3, SCENE[3]!.text.length]);
    const clip = new Clip();
    clipboard('copy', clip);
    select([5, SCENE[5]!.text.length]);
    clipboard('paste', clip);
    expect(rows().slice(5)).toEqual([
      ['st_action', 'She waits.'],
      ['st_character', 'voss'],
      ['st_parenthetical', '(quietly)'],
    ]);
  });

  it('a few words copied inside one line are text: they take the type of where they land', () => {
    mount();
    select([2, 0], [2, 4]); // "voss", from the cue
    const clip = new Clip();
    clipboard('copy', clip);
    select([4, 0]);
    clipboard('paste', clip);
    expect(rows()[4]).toEqual(['st_dialogue', 'vossIT SHOULD NOT BE RUNNING']);
    expect(host.model.elementCount()).toBe(SCENE.length);
  });

  it('the elements survive a clipboard that keeps only the html flavour', () => {
    mount();
    select([2, 0], [4, SCENE[4]!.text.length]);
    const clip = new Clip();
    clipboard('copy', clip);
    const htmlOnly = clip.only('text/html', 'text/plain');
    expect(readPayload(htmlOnly)?.elements.map((e) => e.role)).toEqual(['character', 'parenthetical', 'dialogue']);
    select([5, SCENE[5]!.text.length]);
    clipboard('paste', htmlOnly);
    expect(rows().slice(6).map((r) => r[0])).toEqual(['st_character', 'st_parenthetical', 'st_dialogue']);
  });

  it('cut takes the selection out and paste puts it back with its types; one undo per step', () => {
    mount();
    select([2, 0], [4, SCENE[4]!.text.length]);
    const clip = new Clip();
    clipboard('cut', clip);
    expect(rows().map((r) => r[1])).not.toContain('(quietly)');
    expect(JSON.parse(clip.getData(WUI_MIME)).elements).toHaveLength(3);
    clipboard('paste', clip);
    expect(rows().map((r) => r[0])).toEqual(expect.arrayContaining(['st_character', 'st_parenthetical', 'st_dialogue']));
    expect(rows().map((r) => r[1])).toContain('(quietly)');
  });

  it('text from somewhere else is classified as before; pasting a word into a line does not change its type', () => {
    mount();
    const foreign = new Clip();
    foreign.setData('text/plain', 'NOW');
    select([4, 3]);
    clipboard('paste', foreign);
    expect(rows()[4]).toEqual(['st_dialogue', 'IT NOWSHOULD NOT BE RUNNING']);
    const speech = new Clip();
    speech.setData('text/plain', 'MAYA\nWe need more coffee.');
    select([5, SCENE[5]!.text.length]);
    input('insertParagraph');
    clipboard('paste', speech);
    expect(rows().slice(6)).toEqual([
      ['st_character', 'MAYA'],
      ['st_dialogue', 'We need more coffee.'],
    ]);
  });

  it('plain text for other programs separates elements with a blank line, except inside a speech', () => {
    const els = [
      { style: 'h', role: 'sceneHeading' as const, text: 'int. lab - day' },
      { style: 'a', role: 'action' as const, text: 'Dust.' },
      { style: 'c', role: 'character' as const, text: 'voss' },
      { style: 'd', role: 'dialogue' as const, text: 'Hello.' },
      { style: 'c', role: 'character' as const, text: 'tom' },
      { style: 'd', role: 'dialogue' as const, text: 'Hi.' },
    ];
    expect(toPlainText(els, (s) => s === 'h' || s === 'c')).toBe('INT. LAB - DAY\n\nDust.\n\nVOSS\nHello.\n\nTOM\nHi.');
  });
});

describe('character names while typing a cue', () => {
  const CAST = [
    { style: 'st_scene_heading', text: 'INT. OFFICE - DAY' },
    { style: 'st_character', text: 'Adam' },
    { style: 'st_dialogue', text: 'Who took this?' },
    { style: 'st_character', text: 'ANKER (V.O.)' },
    { style: 'st_dialogue', text: 'Not me.' },
    { style: 'st_character', text: 'charlotte' },
    { style: 'st_dialogue', text: 'Nor me.' },
    { style: 'st_action', text: 'Silence.' },
  ];
  const list = () => root.querySelector('[data-testid="cue-complete"]') as HTMLElement | null;
  const options = () => [...root.querySelectorAll('[data-testid="cue-option"]')].map((o) => o.textContent);
  const active = () => root.querySelector('.wui-cue-option-active')?.textContent ?? null;
  const type = (text: string) => {
    for (const ch of text) {
      input('insertText', ch);
      act(() => void document.dispatchEvent(new Event('selectionchange')));
    }
  };
  /** A new, empty Character line after the last element. */
  const newCue = () => {
    select([CAST.length - 1, CAST[CAST.length - 1]!.text.length]);
    input('insertParagraph');
    const at = host.model.elementCount() - 1;
    act(() => void host.execute([{ id: 'element.setStyle', params: { elements: [ids()[at]!], style: 'st_character' } }], { kind: 'local-command' }));
    select([at, 0]);
    return at;
  };

  it('knows the characters of the script, once each, without their extensions', () => {
    mount(CAST);
    expect(knownCueNames(host.model)).toEqual(['ADAM', 'ANKER', 'CHARLOTTE']);
    expect(matchCueNames(['Adam', 'Anker', 'Xavier Wilsh'], 'a')).toEqual({ names: ['Adam', 'Anker'], exact: false });
    expect(matchCueNames(['Adam', 'Anker', 'Xavier Wilsh'], 'wil').names).toEqual(['Xavier Wilsh']);
    expect(matchCueNames(['Adam', 'Adamson'], 'ADAM')).toEqual({ names: ['Adamson'], exact: true });
    expect(matchCueNames(['Adam'], '  ').names).toEqual([]);
  });

  it('typing A on a Character line lists Adam and Anker; Enter takes the highlighted one and goes on to the dialogue', () => {
    mount(CAST);
    const at = newCue();
    expect(list()).toBeNull();
    type('a');
    expect(options()).toEqual(['ADAM', 'ANKER']);
    expect(active()).toBe('ADAM');
    expect(hint()).toBeNull(); // the list takes the place of the type hint
    key('ArrowDown');
    expect(active()).toBe('ANKER');
    expect(key('Enter').defaultPrevented).toBe(true);
    expect(host.model.elementAt(at).text.plain).toBe('ANKER');
    expect(styleOf(at + 1)).toBe('st_dialogue');
    expect(readDomSelection(page)!.head).toEqual({ elementId: ids()[at + 1], offset: 0 });
    expect(list()).toBeNull();
  });

  it('the list narrows as more is typed, wraps around with the arrows, and closes with Escape', () => {
    mount(CAST);
    const at = newCue();
    type('a');
    key('ArrowUp');
    expect(active()).toBe('ANKER');
    key('ArrowDown');
    expect(active()).toBe('ADAM');
    type('n');
    expect(options()).toEqual(['ANKER']);
    key('Escape');
    expect(list()).toBeNull();
    expect(host.model.elementAt(at).text.plain).toBe('an'); // Escape closes the list, it does not touch the text
    type('k');
    expect(options()).toEqual(['ANKER']); // typing on opens it again
  });

  it('a click takes a name and leaves the caret at its end', () => {
    mount(CAST);
    const at = newCue();
    type('c');
    const option = root.querySelector('[data-testid="cue-option"]') as HTMLElement;
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    act(() => void option.dispatchEvent(down));
    expect(down.defaultPrevented).toBe(true); // the editor keeps its focus
    expect(host.model.elementAt(at).text.plain).toBe('CHARLOTTE');
    expect(readDomSelection(page)!.head).toEqual({ elementId: ids()[at], offset: 9 });
    expect(host.model.elementCount()).toBe(CAST.length + 1);
  });

  it('a name typed in full is not overridden: nothing is highlighted and Enter goes on', () => {
    mount([...CAST, { style: 'st_character', text: 'ADAMSON' }, { style: 'st_dialogue', text: 'Hm.' }, { style: 'st_action', text: 'End.' }].filter((r) => r.text !== 'Silence.'));
    select([CAST.length + 1, 4]);
    input('insertParagraph');
    const at = host.model.elementCount() - 1;
    act(() => void host.execute([{ id: 'element.setStyle', params: { elements: [ids()[at]!], style: 'st_character' } }], { kind: 'local-command' }));
    select([at, 0]);
    type('adam');
    expect(options()).toEqual(['ADAMSON']);
    expect(active()).toBeNull();
    expect(key('Enter').defaultPrevented).toBe(false);
  });

  it('only on a Character line, only at the end of what is typed; a new name shows no list', () => {
    mount(CAST);
    select([7, 1]);
    expect(list()).toBeNull();
    select([1, 1]); // inside "Adam"
    expect(list()).toBeNull();
    const at = newCue();
    type('z');
    expect(list()).toBeNull();
    expect(host.model.elementAt(at).text.plain).toBe('z');
  });
});

describe("(CONT'D)", () => {
  const contd = () => [...page.querySelectorAll('[data-el-id]')].map((b) => (b as HTMLElement).dataset.contd ?? null);

  it('is shown after a cue when the same character speaks again after an interruption, and is not stored', () => {
    mount([
      { style: 'st_scene_heading', text: 'INT. OFFICE - DAY' },
      { style: 'st_character', text: 'ADAM' },
      { style: 'st_dialogue', text: 'Who took this?' },
      { style: 'st_action', text: 'He turns the photograph over.' },
      { style: 'st_character', text: 'adam' },
      { style: 'st_dialogue', text: 'It is dated last week.' },
      { style: 'st_character', text: 'CHARLOTTE' },
      { style: 'st_dialogue', text: 'I know.' },
      { style: 'st_action', text: 'A pause.' },
      { style: 'st_character', text: 'ADAM (V.O.)' },
      { style: 'st_dialogue', text: 'She knew.' },
      { style: 'st_scene_heading', text: 'EXT. STREET - NIGHT' },
      { style: 'st_character', text: 'ADAM' },
      { style: 'st_dialogue', text: 'Taxi!' },
    ]);
    const marks = contd();
    expect(marks[4]).toBe(" (CONT'D)"); // the same character, whatever the case it was typed in
    expect(marks[1]).toBeNull();
    expect(marks[6]).toBeNull();
    expect(marks[9]).toBeNull(); // Charlotte spoke in between
    expect(marks[12]).toBeNull(); // a new scene starts over
    expect(host.model.elementAt(4).text.plain).toBe('adam');
  });

  it('is shown on a second speech straight away too, not only after action', () => {
    mount([
      { style: 'st_scene_heading', text: 'INT. OFFICE - DAY' },
      { style: 'st_character', text: 'ADAM' },
      { style: 'st_dialogue', text: 'Who took this?' },
      { style: 'st_character', text: 'ADAM' },
      { style: 'st_dialogue', text: 'And when?' },
      { style: 'st_character', text: 'CHARLOTTE' },
      { style: 'st_dialogue', text: 'Last week.' },
      { style: 'st_character', text: 'ADAM' },
      { style: 'st_dialogue', text: 'Impossible.' },
    ]);
    const marks = contd();
    expect(marks[1]).toBeNull();
    expect(marks[3]).toBe(" (CONT'D)");
    expect(marks[5]).toBeNull();
    expect(marks[7]).toBeNull(); // Charlotte spoke in between
  });

  it('comes and goes as the script changes', () => {
    mount([
      { style: 'st_scene_heading', text: 'INT. OFFICE - DAY' },
      { style: 'st_character', text: 'ADAM' },
      { style: 'st_dialogue', text: 'Who took this?' },
      { style: 'st_action', text: 'He waits.' },
      { style: 'st_character', text: 'ADA' },
      { style: 'st_dialogue', text: 'Well?' },
    ]);
    expect(contd()[4]).toBeNull();
    select([4, 3]);
    input('insertText', 'M');
    expect(contd()[4]).toBe(" (CONT'D)");
    input('deleteContentBackward');
    expect(contd()[4]).toBeNull();
  });
});

describe('a parenthetical and its parentheses', () => {
  const BASE = [
    { style: 'st_scene_heading', text: 'INT. OFFICE - DAY' },
    { style: 'st_character', text: 'ADAM' },
    { style: 'st_dialogue', text: 'Who took this?' },
  ];
  const text = (i: number) => host.model.elementAt(i).text.plain;
  const caretAt = () => readDomSelection(page)!.head;
  /** A new, empty line after the cue. */
  const newLineAfterCue = () => {
    select([1, 4]);
    input('insertParagraph');
    return 2;
  };
  const tabTo = (i: number, style: string) => {
    for (let n = 0; n < 8 && styleOf(i) !== style; n++) key('Tab');
    expect(styleOf(i)).toBe(style);
  };

  it('an empty line that becomes a parenthetical gets "()" with the caret between them; typing goes inside', () => {
    mount(BASE);
    const at = newLineAfterCue();
    act(() => void host.execute([{ id: 'element.setStyle', params: { elements: [ids()[at]!], style: 'st_character' } }], { kind: 'local-command' }));
    select([at, 0]);
    key('Tab'); // Character -> Parenthetical
    expect(styleOf(at)).toBe('st_parenthetical');
    expect(text(at)).toBe('()');
    expect(caretAt()).toEqual({ elementId: ids()[at], offset: 1 });
    for (const ch of 'quietly') input('insertText', ch);
    expect(text(at)).toBe('(quietly)');
    expect(caretAt()).toEqual({ elementId: ids()[at], offset: 8 });
  });

  it('choosing another type takes the empty "()" away again; one undo per change', () => {
    mount(BASE);
    const at = newLineAfterCue();
    tabTo(at, 'st_parenthetical');
    expect(text(at)).toBe('()');
    key('Tab'); // on to Dialogue
    expect(styleOf(at)).toBe('st_dialogue');
    expect(text(at)).toBe('');
    expect(caretAt()).toEqual({ elementId: ids()[at], offset: 0 });
    key('Tab', { shiftKey: true }); // and back
    expect([styleOf(at), text(at)]).toEqual(['st_parenthetical', '()']);
    act(() => void host.undo());
    expect([styleOf(at), text(at)]).toEqual(['st_dialogue', '']);
  });

  it('Tab all the way round an empty line leaves it empty', () => {
    mount(BASE);
    const at = newLineAfterCue();
    const start = styleOf(at);
    for (let i = 0; i < 7; i++) key('Tab');
    expect([styleOf(at), text(at)]).toEqual([start, '']);
  });

  it('text the writer typed is never touched: not wrapped on the way in, not stripped on the way out', () => {
    mount([...BASE, { style: 'st_parenthetical', text: '(beat)' }, { style: 'st_dialogue', text: 'Well?' }]);
    select([2, 3]);
    key('Tab', { shiftKey: true }); // Dialogue -> Parenthetical, with text
    expect([styleOf(2), text(2)]).toEqual(['st_parenthetical', 'Who took this?']);
    expect(caretAt()).toEqual({ elementId: ids()[2], offset: 3 });
    select([3, 2]);
    key('Tab'); // Parenthetical -> Dialogue
    expect([styleOf(3), text(3)]).toEqual(['st_dialogue', '(beat)']);
  });

  it('Cmd/Ctrl+number and the type menu do the same', () => {
    mount(BASE);
    const at = newLineAfterCue();
    select([at, 0]);
    key('4', { metaKey: true });
    expect([styleOf(at), text(at)]).toEqual(['st_parenthetical', '()']);
    expect(caretAt()).toEqual({ elementId: ids()[at], offset: 1 });
    key('5', { metaKey: true });
    expect([styleOf(at), text(at)]).toEqual(['st_dialogue', '']);

    cleanup();
    host.dispose();
    host = createMemoryHost({ seed: BASE });
    const r = render(
      <>
        <ElementStylePicker host={host} />
        <ScriptEditor host={host} />
      </>,
    );
    root = r.container;
    page = r.container.querySelector('.wui-page') as HTMLElement;
    act(() => void page.focus());
    const line = newLineAfterCue();
    select([line, 0]);
    const menu = r.container.querySelector('select') as HTMLSelectElement;
    act(() => void fireEvent.change(menu, { target: { value: 'st_parenthetical' } }));
    expect([styleOf(line), text(line)]).toEqual(['st_parenthetical', '()']);
    expect(caretAt()).toEqual({ elementId: ids()[line], offset: 1 });
    expect(document.activeElement).toBe(page); // typing goes on in the script
    act(() => void fireEvent.change(menu, { target: { value: 'st_action' } }));
    expect([styleOf(line), text(line)]).toEqual(['st_action', '']);
  });

  it('Enter inside the parentheses finishes the parenthetical and goes on to the dialogue', () => {
    mount(BASE);
    const at = newLineAfterCue();
    tabTo(at, 'st_parenthetical');
    for (const ch of 'quietly') input('insertText', ch);
    expect(caretAt().offset).toBe(8); // before the closing parenthesis
    input('insertParagraph');
    expect(text(at)).toBe('(quietly)');
    expect([styleOf(at + 1), text(at + 1)]).toEqual(['st_dialogue', '']);
    expect(caretAt()).toEqual({ elementId: ids()[at + 1], offset: 0 });
  });
});
