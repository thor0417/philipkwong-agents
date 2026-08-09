// STREAM NAMES, FOR PEOPLE.
//
// The stream identifier is a stored column value on every lead and a filter in
// client_scopes.streams. Renaming it in the database would mean rewriting
// ~1,700 rows, every stored scope, the run-scope CLI, the URL parameter on
// /records, and the pipeline registry, for a word nobody outside this file
// needs to see. So the IDENTIFIER IS UNCHANGED and only the label moves.
//
// 'opportunity' was the vaguest of the three. Every row in it is a tender
// notice or a request for proposals - CanadaBuys, TED, UK Contracts Finder,
// the development banks - so it now says that. "Opportunity" also collides
// with the object-model sense of the word (lead-date.ts: an Opportunity is a
// deadline-bound thing that dies on its deadline), and having one word mean
// two things in the same product is its own reason to fix it.
export const STREAM_LABELS: Record<string, string> = {
  opportunity: 'Tenders and RFPs',
  intelligence: 'Intelligence',
  government: 'Government records',
};

/** The human name for a stream id. Unknown ids render as themselves. */
export function streamLabel(id: string | null | undefined): string {
  if (!id) return 'All streams';
  return STREAM_LABELS[id] ?? id;
}
