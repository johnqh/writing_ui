import { resolveStyle } from '@sudobility/writing_core';
import { useMemo, type KeyboardEvent } from 'react';
import { wuiDebug } from './debug';
import type { ScriptEditorHost } from './host';
import { getSelectionStore, useEditorSelection } from './selection-store';

/**
 * Keys a focused, CLOSED native `<select>` needs to operate as a dropdown: open/confirm/cancel it
 * (`Enter`/` `/`Escape`), move within its own option list (`Arrow*`/`Home`/`End`/`PageUp`/`PageDown`),
 * or leave it (`Tab`). Anything else — in particular a plain printable letter — triggers the browser's
 * built-in "type-ahead" (jump to the first option starting with that letter, firing a real `change`
 * event) even while closed. That is exactly how a stray keystroke meant for the editor silently
 * restyles the current element the moment this picker merely has focus (soak-tested anomaly: an
 * Action element becomes `st_character` with no Tab and no deliberate style pick) — so anything not on
 * this list is redirected back to the editor below instead of being left for the browser to interpret.
 */
const SELECT_OPERATION_KEYS = new Set([
  'Enter', ' ', 'Escape', 'Tab',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown',
]);

export interface ElementStylePickerProps {
  host: ScriptEditorHost;
  className?: string;
  /** Re-render trigger from the parent is not needed: the picker reads the model on every selection change. */
  disabled?: boolean;
}

/** A style's column (§16): 1 or 2 in AV / BBC templates, where the style is what puts an element in a column; 0 otherwise. */
function columnOf(template: ReturnType<ScriptEditorHost['model']['template']>, styleId: string): 0 | 1 | 2 {
  try {
    return resolveStyle(template, styleId as never).column;
  } catch {
    return 0;
  }
}

/** Lists the template's styles, shows the current element's style and applies a choice to the selected element(s). */
export function ElementStylePicker({ host, className, disabled }: ElementStylePickerProps) {
  const selection = useEditorSelection(host);
  const model = host.model;
  const styles = model.template().styles.filter((s) => s.role !== 'root' as never && s.id !== model.template().defaults.root);
  const ids = useMemo(() => {
    if (!selection) return [];
    const a = model.indexOf(selection.anchor.elementId as never);
    const b = model.indexOf(selection.head.elementId as never);
    if (a < 0 || b < 0) return [];
    return model.elements({ from: Math.min(a, b), to: Math.max(a, b) + 1 }).map((e) => e.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, model, model.elementCount()]);

  const current = new Set(ids.map((id) => model.element(id)?.style));
  const value = current.size === 1 ? String([...current][0]) : current.size > 1 ? '__mixed' : '';

  const apply = (styleId: string) => {
    wuiDebug('picker-change', { styleId, ids: ids.map(String) });
    if (!styleId || styleId === '__mixed' || ids.length === 0) return;
    host.execute([{ id: 'element.setStyle', params: { elements: ids, style: styleId } }], { kind: 'local-command' });
    getSelectionStore(host).focusEditor?.();
  };

  // Any key that is not needed to operate the dropdown itself (see SELECT_OPERATION_KEYS's own doc
  // comment): block the browser's native type-ahead and send focus back to the editor instead of
  // letting this keystroke silently change the current element's style.
  const onKeyDown = (e: KeyboardEvent<HTMLSelectElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey || SELECT_OPERATION_KEYS.has(e.key)) return;
    e.preventDefault();
    e.currentTarget.blur();
    getSelectionStore(host).focusEditor?.();
  };

  return (
    <select
      className={['wui-style-picker', className].filter(Boolean).join(' ')}
      aria-label="Element style"
      value={value}
      disabled={disabled || ids.length === 0}
      onChange={(e) => apply(e.target.value)}
      onKeyDown={onKeyDown}
      // Keep the editor's selection: do not let the picker steal it on mouse down.
      data-testid="style-picker"
    >
      {value === '' && <option value="">—</option>}
      {value === '__mixed' && <option value="__mixed">Mixed</option>}
      {styles.map((s) => (
        <option key={s.id} value={s.id} data-column={columnOf(model.template(), s.id) || undefined}>
          {s.name}
          {columnOf(model.template(), s.id) ? ` · column ${columnOf(model.template(), s.id)}` : ''}
          {s.shortcut !== null ? ` (⌘${s.shortcut})` : ''}
        </option>
      ))}
    </select>
  );
}
