import { act, cleanup, fireEvent, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHost, type MemoryHost, type SeedElement } from '../demo/memory-host';
import { PageView } from '../src/PageView';
import { useLayout } from '../src/useLayout';

vi.mock('../src/layout-engine', async (orig) => {
  const m = await orig<typeof import('../src/layout-engine')>();
  return { ...m, layoutDocument: vi.fn(m.layoutDocument) };
});
import { layoutDocument } from '../src/layout-engine';
const layoutSpy = vi.mocked(layoutDocument);

let host: MemoryHost;
afterEach(() => {
  cleanup();
  host?.dispose();
  layoutSpy.mockClear();
});

function longScript(scenes: number): SeedElement[] {
  const out: SeedElement[] = [];
  for (let i = 0; i < scenes; i++) {
    out.push({ style: 'st_scene_heading', text: `int. room ${i} - day` });
    out.push({ style: 'st_action', text: 'The rain keeps falling on the empty street while the neon sign flickers, and somebody far away starts to sing an old song nobody remembers.' });
    out.push({ style: 'st_character', text: 'Maya' });
    out.push({ style: 'st_dialogue', text: 'Twelve drafts. Not one of them knows how it ends, and I am running out of coffee and patience.' });
  }
  return out;
}

describe('PageView', () => {
  it('draws the engine pages as sheets, one absolutely positioned element per line, page number from page 2', async () => {
    host = createMemoryHost({ seed: longScript(12) });
    const r = render(<PageView host={host} />);
    await waitFor(() => expect(r.container.querySelectorAll('.wui-sheet').length).toBeGreaterThan(1));
    const sheets = [...r.container.querySelectorAll<HTMLElement>('.wui-sheet')];
    expect(sheets[0]!.style.width).toBe('8.5in');
    expect(sheets[0]!.style.height).toBe('11in');
    expect(sheets[0]!.querySelector('[data-deco="header"]')).toBeNull();
    expect(sheets[1]!.querySelector('[data-deco="header"]')!.textContent).toBe('2.');
    expect(sheets[0]!.querySelectorAll('.wui-pl').length).toBeLessThanOrEqual(54);
    const line = sheets[0]!.querySelector<HTMLElement>('.wui-pl')!;
    expect(line.style.left).toBe('1.5in'); // scene heading at the 1.5 in left margin
    expect(line.textContent).toBe('INT. ROOM 0 - DAY');
  });

  it('draws the title page as an unnumbered first sheet, footer text from page 2 and scene numbers in the margins', async () => {
    host = createMemoryHost({ seed: longScript(12) });
    const run = (id: string, params: unknown) => act(() => void host.execute([{ id, params }]));
    run('title.setField', { field: 'title', text: 'The Night Train' });
    run('title.setField', { field: 'author', text: 'Jane Writer' });
    run('template.setHeaderFooter', { which: 'footer', patch: { enabled: true, center: '{title} - {page}' } });
    run('template.setSceneNumbering', { mode: 'both' });
    const r = render(<PageView host={host} />);
    await waitFor(() => expect(r.container.querySelector('[data-testid="title-page"]')).not.toBeNull());
    const sheets = [...r.container.querySelectorAll<HTMLElement>('.wui-sheet')];
    expect(sheets[0]!.dataset.page).toBe('title');
    expect(sheets[0]!.textContent).toContain('THE NIGHT TRAIN');
    expect(sheets[0]!.textContent).toContain('Jane Writer');
    expect(sheets[0]!.querySelector('[data-deco="header"]')).toBeNull();
    expect(sheets[1]!.dataset.page).toBe('1');
    expect(sheets[1]!.querySelector('[data-deco="header"]')).toBeNull();
    expect(sheets[2]!.querySelector('[data-deco="header"]')!.textContent).toBe('2.');
    expect(sheets[2]!.querySelector('[data-deco="footer"]')!.textContent).toBe('The Night Train - 2');
    const nums = [...sheets[1]!.querySelectorAll<HTMLElement>('[data-deco="sceneNumber"]')];
    expect(nums.slice(0, 2).map((n) => `${n.dataset.slot}:${n.textContent}`)).toEqual(['left:1', 'right:1']);
    expect(r.container.querySelector<HTMLElement>('[data-testid="page-view"]')!.dataset.pageCount).toBe(String(sheets.length - 1));
  });

  it('clicking a line asks to edit that element at an offset inside the line', async () => {
    host = createMemoryHost({ seed: longScript(2) });
    const onRequestEdit = vi.fn();
    const r = render(<PageView host={host} onRequestEdit={onRequestEdit} />);
    await waitFor(() => expect(r.container.querySelector('.wui-pl')).not.toBeNull());
    const el = r.container.querySelectorAll<HTMLElement>('.wui-pl')[1]!; // first action line
    fireEvent.click(el, { clientX: 0 });
    expect(onRequestEdit).toHaveBeenCalledTimes(1);
    const [id, offset] = onRequestEdit.mock.calls[0]!;
    expect(id).toBe(el.dataset.elId);
    expect(offset).toBeGreaterThanOrEqual(Number(el.dataset.start));
    expect(offset).toBeLessThanOrEqual(Number(el.dataset.end));
  });
});

describe('useLayout', () => {
  it('debounces bursts of edits into one recompute and skips notifications that change nothing', async () => {
    host = createMemoryHost();
    const { result } = renderHook(() => useLayout(host, { debounceMs: 60 }));
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const first = result.current.pages;
    expect(result.current.pageCount).toBe(1);
    expect(layoutSpy).toHaveBeenCalledTimes(1);

    const id = host.model.elementAt(1).id;
    for (let i = 0; i < 3; i++) {
      act(() => void host.execute([{ id: 'text.insert', params: { at: { elementId: id, offset: 0 }, text: 'x' } }]));
    }
    expect(result.current.status).toBe('stale');
    expect(layoutSpy).toHaveBeenCalledTimes(1); // nothing yet: trailing debounce
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(layoutSpy).toHaveBeenCalledTimes(2); // three edits, one layout
    expect(result.current.pages).not.toBe(first);
    expect(result.current.pages[0]!.lines.some((l) => l.runs.some((r) => r.text.startsWith('xxxA single')))).toBe(true);

    // A notification that moved no element version does not re-run the layout.
    const settled = result.current.pages;
    const listeners: Array<(b: unknown) => void> = [];
    const quiet = { ...host, model: host.model, subscribe: (l: (b: unknown) => void) => (listeners.push(l), () => {}) } as unknown as MemoryHost;
    const quietHook = renderHook(() => useLayout(quiet, { debounceMs: 20 }));
    await waitFor(() => expect(quietHook.result.current.status).toBe('ready'));
    const calls = layoutSpy.mock.calls.length;
    act(() => listeners.forEach((l) => l({ changes: [{ kind: 'notes', ids: [] }], origin: null, local: true })));
    await waitFor(() => expect(quietHook.result.current.status).toBe('ready'));
    await new Promise((r) => setTimeout(r, 60));
    expect(layoutSpy.mock.calls.length).toBe(calls);
    expect(result.current.pages).toBe(settled);
  });
});

// One short sentence per dialogue line, so the sentence rule lets a speech break after any line.
const SPEECH = Array.from({ length: 7 }, () => 'Hold the door and listen to me.').join(' ');
const beats = (n: number): SeedElement[] => Array.from({ length: n }, (_, i) => ({ style: 'st_action', text: `Beat ${i}.` }));

describe('PageView continueds and dual dialogue', () => {
  it('draws (MORE) under a split speech and the synthesized cue atop the next page, neither clickable', async () => {
    host = createMemoryHost({
      seed: [{ style: 'st_scene_heading', text: 'int. station - night' }, ...beats(23), { style: 'st_character', text: 'Maya' }, { style: 'st_dialogue', text: SPEECH }],
    });
    const onRequestEdit = vi.fn();
    const r = render(<PageView host={host} onRequestEdit={onRequestEdit} />);
    await waitFor(() => expect(r.container.querySelectorAll('.wui-sheet').length).toBe(2));
    const [p1, p2] = [...r.container.querySelectorAll<HTMLElement>('.wui-sheet')];
    const more = p1!.querySelector<HTMLElement>('[data-kind="more"]')!;
    expect(more.textContent).toBe('(MORE)');
    const cue = p2!.querySelector<HTMLElement>('[data-kind="contdCue"]')!;
    expect(cue.textContent).toBe("MAYA (CONT'D)");
    expect(cue.style.top).toBe('1in'); // first line of the page
    fireEvent.click(more);
    fireEvent.click(cue);
    expect(onRequestEdit).not.toHaveBeenCalled();
    expect(p1!.querySelectorAll('.wui-pl').length + p2!.querySelectorAll('.wui-pl').length).toBe(1 + 23 + 1 + 7);
  });

  it('draws scene CONTINUED lines once the template flags are on', async () => {
    host = createMemoryHost({ seed: [{ style: 'st_scene_heading', text: 'int. station - night' }, ...beats(40)] });
    act(() => void host.execute([{ id: 'template.setContinueds', params: { sceneTop: true, sceneBottom: true } }]));
    const r = render(<PageView host={host} />);
    await waitFor(() => expect(r.container.querySelectorAll('.wui-sheet').length).toBeGreaterThan(1));
    const [p1, p2] = [...r.container.querySelectorAll<HTMLElement>('.wui-sheet')];
    expect(p1!.querySelector('[data-kind="continuedBottom"]')!.textContent).toBe('(CONTINUED)');
    expect(p2!.querySelector('[data-kind="continuedTop"]')!.textContent).toBe('CONTINUED:');
  });

  it('draws a dual pair side by side: cues on the same line at different x', async () => {
    host = createMemoryHost({
      seed: [
        { style: 'st_scene_heading', text: 'int. station - night' },
        { style: 'st_character', text: 'Maya' }, { style: 'st_dialogue', text: 'Hold the door.' },
        { style: 'st_character', text: 'Jonah' }, { style: 'st_dialogue', text: 'Not a chance.' },
      ],
    });
    const second = host.model.elements()[3]!.id;
    act(() => void host.execute([{ id: 'dual.make', params: { element: second } }]));
    const r = render(<PageView host={host} />);
    await waitFor(() => expect(r.container.querySelector('[data-dual-side="right"]')).not.toBeNull());
    const left = r.container.querySelector<HTMLElement>('.wui-pl[data-dual-side="left"]')!;
    const right = r.container.querySelector<HTMLElement>('.wui-pl[data-dual-side="right"]')!;
    expect(left.textContent).toBe('MAYA');
    expect(right.textContent).toBe('JONAH');
    expect(right.style.top).toBe(left.style.top);
    expect(parseFloat(right.style.left)).toBeGreaterThan(parseFloat(left.style.left) + 1);
  });

  it('draws revision asterisks in the margin, the coloured header label and a page band; the Edit view shows a bar', async () => {
    host = createMemoryHost({ seed: longScript(12) });
    const run = (id: string, params: unknown) => act(() => void host.execute([{ id, params }]));
    run('revision.setCurrent', { date: Date.UTC(2026, 8, 21) });
    run('revision.mode', { on: true });
    const target = host.model.elements()[5]!.id;
    run('text.insert', { at: { elementId: target, offset: 0 }, text: 'X' });
    const r = render(<PageView host={host} />);
    await waitFor(() => expect(r.container.querySelectorAll('[data-testid="rev-mark"]').length).toBe(1));
    const mark = r.container.querySelector<HTMLElement>('[data-testid="rev-mark"]')!;
    expect(mark.textContent).toBe('*');
    expect(mark.closest<HTMLElement>('.wui-pl')!.dataset.elId).toBe(String(target));
    const sheet = mark.closest<HTMLElement>('.wui-sheet')!;
    expect(sheet.querySelector('[data-deco="revision"]')!.textContent).toBe('Blue Revised 9/21/26');
    expect(sheet.querySelector('[data-testid="rev-band"]')).not.toBeNull();
    const others = [...r.container.querySelectorAll<HTMLElement>('.wui-sheet')].filter((x) => x !== sheet);
    expect(others.every((x) => !x.querySelector('[data-deco="revision"]') && !x.querySelector('[data-testid="rev-mark"]'))).toBe(true);
  });
});

describe('PageView column rows and panels', () => {
  it('draws AV video beside audio: same top, the audio column to the right, each at the engine x', async () => {
    host = createMemoryHost({
      templateKey: 'av-two-column',
      seed: [
        { style: 'st_scene_heading', text: 'int. studio - day' },
        { style: 'st_action', text: 'Wide shot of the floor.' },
        { style: 'st_character', text: 'Host' }, { style: 'st_dialogue', text: 'Welcome to the show.' },
        { style: 'st_action', text: 'Cut to the guest.' }, { style: 'st_character', text: 'Guest' },
      ],
    });
    const r = render(<PageView host={host} />);
    await waitFor(() => expect(r.container.querySelector('.wui-pl[data-column="2"]')).not.toBeNull());
    const video = r.container.querySelector<HTMLElement>('.wui-pl[data-column="1"]')!;
    const audio = r.container.querySelector<HTMLElement>('.wui-pl[data-column="2"]')!;
    expect(video.textContent).toBe('Wide shot of the floor.');
    expect(audio.textContent).toBe('HOST');
    expect(audio.style.top).toBe(video.style.top);
    expect(parseFloat(audio.style.left)).toBeGreaterThan(parseFloat(video.style.left) + 2);
    // The action after the dialogue drops below the first row and pairs with the next cue.
    const video2 = [...r.container.querySelectorAll<HTMLElement>('.wui-pl[data-column="1"]')][1]!;
    expect(parseFloat(video2.style.top)).toBeGreaterThan(parseFloat(video.style.top) + 0.5);
  });

  it('draws graphic-novel page and panel headings with their generated numbers', async () => {
    host = createMemoryHost({
      templateKey: 'graphic-novel',
      seed: [
        { style: 'st_page', text: '' }, { style: 'st_panel', text: '' }, { style: 'st_action', text: 'A rainy street.' },
        { style: 'st_panel', text: 'Close.' }, { style: 'st_page', text: '' }, { style: 'st_panel', text: '' },
      ],
    });
    const r = render(<PageView host={host} />);
    await waitFor(() => expect(r.container.querySelectorAll('.wui-sheet').length).toBe(2));
    const texts = [...r.container.querySelectorAll<HTMLElement>('.wui-pl')].map((e) => e.textContent);
    expect(texts).toEqual(['PAGE ONE (TWO PANELS)', 'Panel 1.', 'A rainy street.', 'Panel 2. Close.', 'PAGE TWO (ONE PANELS)', 'Panel 1.']);
  });
});
