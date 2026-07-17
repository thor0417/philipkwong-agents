// Best-available-date derivation for GLI leads (Brief 1).
//
// The sources publish a real date for only a minority of opportunity leads, so a
// lead's filterable date is the BEST of three things, in order:
//   1. a real date the source exposed (deadline / published_date, set by the
//      adapters)                                              -> date_source 'source'
//   2. a date parsed from the lead's own title / raw_content  -> date_source 'parsed'
//   3. the honest floor of when WE first saw it (first_seen)  -> date_source 'first_seen'
//
// deriveLeadDates centralizes that choice for every GLI write path (opportunity,
// government, intelligence) and records the provenance in date_source, so the
// dashboard can filter on the best available date and visibly badge the leads
// whose date is genuinely unknown. first_seen itself is the DB default (now()),
// set once on insert; it is never overwritten here.
//
// (The Part C text-parse pass slots in as step 2; until then a lead with no
// source date falls straight through to first_seen.)

import type { NormalizedLead } from './sources/types';

// A parsed date is evidence of AGE, not a submission deadline, so it always lands
// in published_date regardless of stream. Only a real source deadline is ever a
// deadline. The stream is kept in the signature for call-site clarity and future
// per-stream tuning.
export type LeadStream = 'opportunity' | 'government' | 'intelligence';

export type DateSource = 'source' | 'parsed' | 'first_seen';

export interface DerivedDates {
  deadline: string | null;
  published_date: string | null;
  date_source: DateSource;
}

// An ISO string that actually parses, else null (drops empty / malformed dates).
function usable(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

export function deriveLeadDates(lead: NormalizedLead, _stream: LeadStream): DerivedDates {
  const deadline = usable(lead.deadline);
  const published = usable(lead.published_date);

  // 1. A real date the source exposed always wins.
  if (deadline || published) {
    return { deadline, published_date: published, date_source: 'source' };
  }

  // 2/3. No source date. (Part C derives one from the lead text here.) With
  // nothing usable, first_seen (DB default) is the best available date, and the
  // dashboard badges these as DATE UNKNOWN.
  return { deadline: null, published_date: null, date_source: 'first_seen' };
}
