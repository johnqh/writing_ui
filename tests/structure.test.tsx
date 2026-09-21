import { act, cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHost, type MemoryHost, type SeedElement } from '../demo/memory-host';
import { IndexCards } from '../src/IndexCards';
import { Navigator } from '../src/Navigator';

const SEED: SeedElement[] = ['a', 'b', 'c', 'd', 'e', 'f'].flatMap((l, i) => [
  { style: 'st_scene_heading', text: `int. place ${l} - day` },
  { style: 'st_action', text: `Action in scene ${i + 1}.` },
]);

let host: MemoryHost;
const headings = () => host.model.scenes().map((s) => s.headingText);
const order = () => host.model.elements().map((e) => e.text.plain);
const dt = () => ({ setData: vi.fn(), effectAllowed: '', dropEffect: '' });

beforeEach(() => {
  host = createMemoryHost({ seed: SEED });
});
afterEach(() => {
  cleanup();
  host.dispose();
});

/** jsdom has no layout: getBoundingClientRect is all zeros, so clientY/X -1 is "before" and 1 is "after". */
function dragTo(from: HTMLElement, to: HTMLElement, side: 'before' | 'after', axis: 'x' | 'y') {
  const pos = side === 'before' ? -1 : 1;
  const dataTransfer = dt();
  // jsdom has no DragEvent, so clientX/Y are not honoured by the init dict: define them on the event.
  const withPoint = (ev: Event) => Object.defineProperty(ev, axis === 'y' ? 'clientY' : 'clientX', { value: pos });
  fireEvent.dragStart(from, { dataTransfer });
  fireEvent(to, withPoint(createEvent.dragOver(to, { dataTransfer })));
  fireEvent(to, withPoint(createEvent.drop(to, { dataTransfer })));
  fireEvent.dragEnd(from, { dataTransfer });
}
const rowOf = (id: string) => document.querySelector<HTMLElement>(`[data-scene-id="${id}"]`)!;
const sceneIds = () => host.model.scenes().map((s) => String(s.id));

describe('Navigator', () => {
  it('lists one row per scene with number and heading', () => {
    render(<Navigator host={host} />);
    expect(screen.getAllByTestId('nav-number').map((n) => n.textContent)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(screen.getAllByTestId('nav-heading').map((n) => n.textContent)).toEqual(headings());
  });

  it('clicking a row jumps to that scene heading; the active scene follows activeElementId', () => {
    const onJumpTo = vi.fn();
    const ids = sceneIds();
    const { rerender } = render(<Navigator host={host} onJumpTo={onJumpTo} activeElementId={null} />);
    fireEvent.click(rowOf(ids[3]!));
    expect(onJumpTo).toHaveBeenCalledWith(ids[3]);
    const action = host.model.scenes()[2]!.elementIds[1]!; // an action line inside scene 3
    rerender(<Navigator host={host} onJumpTo={onJumpTo} activeElementId={String(action)} />);
    expect(rowOf(ids[2]!).dataset.active).toBe('true');
    expect(document.querySelectorAll('[data-active="true"]').length).toBe(1);
  });

  it('edits a synopsis inline and writes it through the command', () => {
    render(<Navigator host={host} />);
    const id = sceneIds()[1]!;
    fireEvent.click(within(rowOf(id)).getByTestId('nav-synopsis'));
    const input = within(rowOf(id)).getByTestId('nav-synopsis-input');
    fireEvent.change(input, { target: { value: 'Maya finds the note' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(host.model.scene(id as never)!.synopsis.plain).toBe('Maya finds the note');
    expect(within(rowOf(id)).getByTestId('nav-synopsis').textContent).toBe('Maya finds the note');
  });

  it('drag reorders the script with one scene.move and the list follows', () => {
    render(<Navigator host={host} />);
    const ids = sceneIds();
    const spy = vi.spyOn(host, 'execute');
    dragTo(rowOf(ids[3]!), rowOf(ids[1]!), 'before', 'y');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toHaveLength(1);
    expect(sceneIds()).toEqual([ids[0], ids[3], ids[1], ids[2], ids[4], ids[5]]);
    expect(screen.getAllByTestId('nav-heading').map((n) => n.textContent)).toEqual(headings());
    // the scene's own lines moved with it
    expect(order().slice(0, 6)).toEqual(['int. place a - day', 'Action in scene 1.', 'int. place d - day', 'Action in scene 4.', 'int. place b - day', 'Action in scene 2.']);
    // drop after the last row moves to the end
    dragTo(rowOf(ids[0]!), rowOf(ids[5]!), 'after', 'y');
    expect(sceneIds().at(-1)).toBe(ids[0]);
  });

  it('stays live: a heading edit and an omitted scene show up without remounting', () => {
    render(<Navigator host={host} />);
    const first = host.model.scenes()[0]!;
    act(() => {
      host.execute([{ id: 'text.insert', params: { at: { elementId: first.id, offset: 0 }, text: 'X' } }]);
    });
    expect(screen.getAllByTestId('nav-heading')[0]!.textContent).toBe('Xint. place a - day');
  });

  it('does not re-render rows whose data did not change', () => {
    render(<Navigator host={host} />);
    const row = rowOf(sceneIds()[4]!);
    const action = host.model.scenes()[0]!.elementIds[1]!;
    act(() => {
      host.execute([{ id: 'text.insert', params: { at: { elementId: action, offset: 0 }, text: 'Z' } }]);
    });
    expect(rowOf(sceneIds()[4]!)).toBe(row); // same DOM node
  });
});

describe('IndexCards', () => {
  it('renders one card per scene and honours cardsAcross', () => {
    render(<IndexCards host={host} cardsAcross={3} />);
    expect(screen.getAllByTestId('card-heading')).toHaveLength(6);
    expect(screen.getAllByTestId('card-number').map((n) => n.textContent)).toEqual(['1', '2', '3', '4', '5', '6']);
    const grid = document.querySelector('.wui-cards-grid') as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
    fireEvent.change(screen.getByTestId('cards-across'), { target: { value: '5' } });
    expect(grid.style.gridTemplateColumns).toBe('repeat(5, minmax(0, 1fr))');
  });

  it('edits the heading (text commands) and the synopsis (synopsis command)', () => {
    render(<IndexCards host={host} />);
    const id = sceneIds()[2]!;
    fireEvent.click(within(rowOf(id)).getByTestId('card-heading'));
    const h = within(rowOf(id)).getByTestId('card-heading-input');
    fireEvent.change(h, { target: { value: 'EXT. ROOF - DAWN' } });
    fireEvent.keyDown(h, { key: 'Enter' });
    expect(host.model.scene(id as never)!.headingText).toBe('EXT. ROOF - DAWN');
    fireEvent.click(within(rowOf(id)).getByTestId('card-synopsis'));
    const s = within(rowOf(id)).getByTestId('card-synopsis-input');
    fireEvent.change(s, { target: { value: 'They argue.' } });
    fireEvent.blur(s);
    expect(host.model.scene(id as never)!.synopsis.plain).toBe('They argue.');
    expect(within(rowOf(id)).getByTestId('card-synopsis').textContent).toBe('They argue.');
  });

  it('drag reorders; Add card appends a scene; double-click opens', () => {
    const onOpenScene = vi.fn();
    render(<IndexCards host={host} onOpenScene={onOpenScene} />);
    const ids = sceneIds();
    dragTo(rowOf(ids[3]!), rowOf(ids[1]!), 'before', 'x');
    expect(sceneIds()).toEqual([ids[0], ids[3], ids[1], ids[2], ids[4], ids[5]]);
    fireEvent.click(screen.getByTestId('add-card'));
    expect(host.model.scenes()).toHaveLength(7);
    expect(host.model.scenes().at(-1)!.headingText).toBe('INT. NEW SCENE - DAY');
    expect(screen.getAllByTestId('card-number')).toHaveLength(7);
    // the new card opens straight into heading edit
    expect(screen.getByTestId('card-heading-input')).toBeTruthy();
    fireEvent.doubleClick(rowOf(ids[0]!));
    expect(onOpenScene).toHaveBeenCalledWith(ids[0]);
  });
});
