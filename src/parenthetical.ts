import type { CommandInvocation, DocumentModel } from '@sudobility/writing_core';
import type { PlainPos } from './host';

/** What an empty parenthetical holds: the pair of parentheses, the caret between them. */
export const EMPTY_PARENS = '()';

export interface StyleChange {
  /** One batch: one undo step. */
  commands: CommandInvocation[];
  /** Where the caret belongs afterwards in an element whose text was changed; absent when no text changed. */
  carets: Map<string, PlainPos>;
}

/**
 * Setting the type of elements, with what a parenthetical needs: an EMPTY element that becomes a parenthetical gets
 * its pair of parentheses with the caret between them, and a parenthetical that holds nothing but that pair loses it
 * when it becomes something else. Text the writer typed is never touched: only the empty pair comes and goes.
 * Every way of choosing a type goes through here (Tab, Cmd/Ctrl+number, the type menu), so they all behave alike.
 */
export function styleChange(model: DocumentModel, ids: readonly string[], styleId: string): StyleChange {
  const role = model.template().styles.find((s) => s.id === styleId)?.role;
  const commands: CommandInvocation[] = [{ id: 'element.setStyle', params: { elements: [...ids], style: styleId } }];
  const carets = new Map<string, PlainPos>();
  for (const id of ids) {
    const view = model.element(id as never);
    if (!view) continue;
    const text = view.text.plain;
    if (role === 'parenthetical' && text === '') {
      commands.push({ id: 'text.insert', params: { at: { elementId: id, offset: 0 }, text: EMPTY_PARENS } });
      carets.set(id, { elementId: id, offset: 1 });
    } else if (role !== 'parenthetical' && view.role === 'parenthetical' && text === EMPTY_PARENS) {
      commands.push({ id: 'text.deleteRange', params: { range: { anchor: { elementId: id, offset: 0 }, head: { elementId: id, offset: EMPTY_PARENS.length } } } });
      carets.set(id, { elementId: id, offset: 0 });
    }
  }
  return { commands, carets };
}

/** The caret is just before the closing parenthesis of a parenthetical: for Enter, that is the end of the line. */
export function beforeClosingParen(model: DocumentModel, pos: PlainPos): boolean {
  const view = model.element(pos.elementId as never);
  if (!view || view.role !== 'parenthetical') return false;
  const text = view.text.plain;
  return text.endsWith(')') && pos.offset === text.length - 1;
}
