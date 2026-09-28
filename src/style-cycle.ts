import type { StyleDef, TemplateJSON } from '@sudobility/writing_core';

type Template = Pick<TemplateJSON, 'styles' | 'defaults'>;

/**
 * The element types Tab walks through, in order: the template's styles that have a number shortcut (the main
 * types of the format: Scene Heading, Action, Character, Parenthetical, Dialogue, Transition, Shot in a screenplay),
 * ordered by that number, so Tab and Cmd/Ctrl+number agree. A template without shortcuts cycles through all of its
 * styles in template order.
 */
export function cycleStyles(template: Template): StyleDef[] {
  const usable = template.styles.filter((s) => s.id !== template.defaults.root);
  const numbered = usable.filter((s) => typeof s.shortcut === 'number').sort((a, b) => (a.shortcut as number) - (b.shortcut as number));
  return numbered.length >= 2 ? numbered : usable;
}

/** The type after (or before) `current` in the cycle, wrapping around. A style outside the cycle enters it at its start (or end). */
export function nextStyle(template: Template, current: string, direction: 'forward' | 'back'): StyleDef | null {
  const cycle = cycleStyles(template);
  if (cycle.length === 0) return null;
  const at = cycle.findIndex((s) => s.id === current);
  if (at < 0) return direction === 'forward' ? cycle[0]! : cycle[cycle.length - 1]!;
  if (cycle.length === 1) return null;
  return cycle[(at + (direction === 'forward' ? 1 : cycle.length - 1)) % cycle.length]!;
}
