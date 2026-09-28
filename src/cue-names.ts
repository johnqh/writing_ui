import { stripExtension, type DocumentModel } from '@sudobility/writing_core';

/**
 * The character names a cue can be completed to: the Catalog's characters (names and aliases are the writer's own
 * spelling) and every cue already in the script (the Catalog is only harvested now and then, the script is always
 * current). One entry per name whatever its case; the Catalog's spelling wins for display.
 */
export function knownCueNames(model: DocumentModel, exceptElementId?: string): string[] {
  const byKey = new Map<string, string>();
  const language = model.meta().language;
  const key = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleUpperCase(language);
  for (const e of model.entities({ kind: 'character' })) {
    const name = e.name.trim();
    if (name && !byKey.has(key(name))) byKey.set(key(name), name);
  }
  for (const el of model.elements()) {
    if (el.role !== 'character' || String(el.id) === exceptElementId) continue;
    const name = stripExtension(el.text.plain.trim()).name.trim();
    if (name && !byKey.has(key(name))) byKey.set(key(name), key(name));
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, language, { sensitivity: 'base' }));
}

export interface CueMatches {
  names: string[];
  /** The typed text already is one of the known names: nothing is preselected, Enter just goes on. */
  exact: boolean;
}

/** Names that start with what was typed, then names with a later word that does ("wil" finds "Xavier Wilsh"). */
export function matchCueNames(names: readonly string[], typed: string, language?: string): CueMatches {
  const t = typed.trim().replace(/\s+/g, ' ').toLocaleUpperCase(language);
  if (!t) return { names: [], exact: false };
  const up = (n: string) => n.toLocaleUpperCase(language);
  const exact = names.some((n) => up(n) === t);
  const starts = names.filter((n) => up(n).startsWith(t) && up(n) !== t);
  const words = names.filter((n) => !up(n).startsWith(t) && up(n).split(/[\s.-]+/).some((w) => w.startsWith(t)));
  return { names: [...starts, ...words].slice(0, 8), exact };
}
