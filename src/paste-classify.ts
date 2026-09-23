import { classifyBlock, HEADING_RE, isAllCapsLine, type BlockKind } from '@sudobility/writing_formats/fountain-classify';
import type { StyleDef, StyleRole } from '@sudobility/writing_core';

/**
 * Nearest-role fallbacks for templates that lack a role. A small, deliberate duplication of
 * `writing_formats/src/shared/build.ts`'s `ROLE_FALLBACK`: that one lives on `DocBuilder`, which only
 * exists at import time (building a brand-new document); paste classifies lines against the *live*
 * document's own template, so it needs its own tiny copy of the same table. Keep the two in sync.
 */
const ROLE_FALLBACK: Partial<Record<StyleRole, StyleRole[]>> = {
  shot: ['action'], lyrics: ['dialogue', 'action'], transition: ['action'], parenthetical: ['dialogue', 'action'],
  dialogue: ['action'], character: ['action'], sceneHeading: ['action'], synopsis: ['note', 'action'], note: ['synopsis', 'action'],
  actStart: ['sceneHeading', 'action'], actEnd: ['action'], sequence: ['action'], outline: ['sequence', 'action'],
  castList: ['action'], notation: ['action'], soundCue: ['action'], action: ['normal'], normal: [],
};

/** First style of `styles` with this role, falling back along `ROLE_FALLBACK`, else the template's first style. */
export function styleForRole(styles: readonly StyleDef[], role: StyleRole): StyleDef {
  const tryRole = (r: StyleRole): StyleDef | undefined => styles.find((s) => s.role === r);
  return tryRole(role) ?? (ROLE_FALLBACK[role] ?? []).map(tryRole).find((s): s is StyleDef => !!s) ?? styles[0]!;
}

const isEmptyLine = (line: string): boolean => line.length === 0;
const isParenthetical = (line: string): boolean => /^\(.*\)$/.test(line.trim());

/** `BlockKind` (Fountain block classification) to the screenplay role paste assigns each of its lines. */
function rolesForBlock(kind: BlockKind, texts: readonly string[]): StyleRole[] {
  switch (kind) {
    case 'character':
    case 'forcedCharacter':
      // Mirrors `writing_formats/src/fountain/import.ts`'s `flushBlock` character-block sub-grouping: the
      // first line is the cue, and each following line is a parenthetical or a dialogue line.
      return texts.map((t, i) => (i === 0 ? 'character' : isParenthetical(t) ? 'parenthetical' : 'dialogue'));
    case 'heading':
    case 'forcedHeading':
      return texts.map(() => 'sceneHeading');
    case 'transition':
    case 'forcedTransition':
      return texts.map(() => 'transition');
    case 'synopsis':
      return texts.map(() => 'synopsis');
    case 'lyrics':
      return texts.map(() => 'lyrics');
    case 'section':
      return texts.map(() => 'outline');
    case 'forcedAction':
    case 'action':
    case 'centered':
    case 'pagebreak':
    default:
      return texts.map(() => 'action');
  }
}

/** Real Fountain shape: blocks of lines separated by one or more blank lines, each classified by `classifyBlock`. */
function classifyBlockMode(rawLines: readonly string[]): StyleRole[] {
  const roles: StyleRole[] = [];
  let block: string[] = [];
  const flush = () => {
    if (block.length === 0) return;
    roles.push(...rolesForBlock(classifyBlock(block), block));
    block = [];
  };
  for (const raw of rawLines) {
    if (isEmptyLine(raw)) flush();
    else block.push(raw.replace(/\s+$/, ''));
  }
  flush();
  return roles;
}

/**
 * "Flat paste" shape: no blank lines at all between elements (common when text is copied from somewhere
 * that doesn't preserve Fountain's blank-line convention — this is the shape of the sample that prompted
 * this feature). A per-line heuristic with one line of lookahead, since there are no blocks to classify.
 *
 * Known, accepted limitation: without a blank line or a new all-caps cue, there is no reliable syntactic
 * signal that dialogue has ended and action has resumed (e.g. a character's last line of dialogue
 * immediately followed by an action line reads, to this heuristic, like more dialogue). This is the exact
 * ambiguity Fountain's own blank-line convention exists to avoid; it is not fixable without understanding
 * the prose. The manual style tools (Tab / Cmd+number, see `tests/stylepicker.test.tsx`) are the fix-up path.
 */
function classifyFlatMode(lines: readonly string[]): StyleRole[] {
  const roles: StyleRole[] = [];
  let prev: StyleRole | null = null;
  const continuesDialogue = (r: StyleRole | null) => r === 'character' || r === 'dialogue' || r === 'parenthetical';
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    const next = lines[i + 1]?.trim();
    let role: StyleRole;
    if (HEADING_RE.test(t)) role = 'sceneHeading';
    else if (isParenthetical(t) && continuesDialogue(prev)) role = 'parenthetical';
    else if (isAllCapsLine(t) && /TO:\s*$/.test(t)) role = 'transition';
    // A character cue: all-caps, doesn't end in a period (real names don't — excludes false positives like
    // a lone all-caps time stamp, e.g. "NOON."), and the next line reads like dialogue, not another cue.
    else if (isAllCapsLine(t) && !t.endsWith('.') && !!next && (!isAllCapsLine(next) || isParenthetical(next))) role = 'character';
    else role = continuesDialogue(prev) ? 'dialogue' : 'action';
    roles.push(role);
    prev = role;
  }
  return roles;
}

/** True when some blank line in `rawLines` has non-blank content both before and after it. */
function hasInternalBlankLine(rawLines: readonly string[]): boolean {
  let seenContent = false;
  for (let i = 0; i < rawLines.length; i++) {
    if (!isEmptyLine(rawLines[i]!)) { seenContent = true; continue; }
    if (seenContent && rawLines.slice(i + 1).some((l) => !isEmptyLine(l))) return true;
  }
  return false;
}

/**
 * Classifies pasted plain text into one screenplay role per non-empty line, in order — the same lines
 * `paste()` already splits into elements (`text.split(/\r\n|\r|\n/).filter((l) => l.length > 0)`), so the
 * two arrays line up 1:1 by construction. See `classifyBlockMode`/`classifyFlatMode` for the two shapes.
 */
export function classifyPastedText(text: string): StyleRole[] {
  const rawLines = text.split(/\r\n|\r|\n/);
  return hasInternalBlankLine(rawLines) ? classifyBlockMode(rawLines) : classifyFlatMode(rawLines.filter((l) => !isEmptyLine(l)));
}
