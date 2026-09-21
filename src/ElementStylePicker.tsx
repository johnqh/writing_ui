import { useMemo } from 'react';
import { wuiDebug } from './debug';
import type { ScriptEditorHost } from './host';
import { getSelectionStore, useEditorSelection } from './selection-store';

export interface ElementStylePickerProps {
  host: ScriptEditorHost;
  className?: string;
  /** Re-render trigger from the parent is not needed: the picker reads the model on every selection change. */
  disabled?: boolean;
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

  return (
    <select
      className={['wui-style-picker', className].filter(Boolean).join(' ')}
      aria-label="Element style"
      value={value}
      disabled={disabled || ids.length === 0}
      onChange={(e) => apply(e.target.value)}
      // Keep the editor's selection: do not let the picker steal it on mouse down.
      data-testid="style-picker"
    >
      {value === '' && <option value="">—</option>}
      {value === '__mixed' && <option value="__mixed">Mixed</option>}
      {styles.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
          {s.shortcut !== null ? ` (⌘${s.shortcut})` : ''}
        </option>
      ))}
    </select>
  );
}
