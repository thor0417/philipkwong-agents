// COMPATIBILITY SHIM. The model moved to readers/core and the Clark reader to
// readers/clark-agenda-sheet when the second form arrived, because a file called
// "filing facts" that also contained one county's regexes would have collected
// every county's regexes.
//
// Kept as a re-export so the golden set, the migration and the diagnostics keep
// one import path while the readers multiply behind it.

export {
  verifyFilingFacts,
  filingFactsForEntry,
  filingFactLabel,
  norm,
  tidyLine,
  num,
} from './readers/core';
export type { FilingFact, FilingFactKind } from './readers/core';

export { readFilingFacts, isClarkAgendaSheet } from './readers/clark-agenda-sheet';
