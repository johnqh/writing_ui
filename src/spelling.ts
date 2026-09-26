import type { EntityKind, StyleRole } from '@sudobility/writing_core';

/** Platform-independent eligibility. Native text controls can use the same policy without a DOM API. */
export interface SpellingPolicy {
  script(role: StyleRole): boolean;
  entityName(kind: EntityKind): boolean;
}

/** Descriptive text is checked; personal names and production identifiers are not. */
export const defaultSpellingPolicy: SpellingPolicy = {
  script: (role) => !(['character', 'castList', 'page', 'panel'] as readonly string[]).includes(role),
  entityName: (kind) => kind !== 'character' && kind !== 'scriptDay',
};
