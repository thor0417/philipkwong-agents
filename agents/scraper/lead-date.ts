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

import type { NormalizedLead } from './sources/types';
import { parseDateFromText } from './date-parse';

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

export function deriveLeadDates(lead: NormalizedLead, _stream: LeadStream = 'opportunity'): DerivedDates {
  const deadline = usable(lead.deadline);
  const published = usable(lead.published_date);

  // 1. A real date the source exposed always wins.
  if (deadline || published) {
    return { deadline, published_date: published, date_source: 'source' };
  }

  // 2. No source date: derive one from the lead's own text (this is what catches
  // the 2011-RFP class -- an undated feed row whose title says "2011"). A parsed
  // date is an age signal, so it always lands in published_date.
  const parsed = parseDateFromText(`${lead.title ?? ''}\n${lead.raw_content ?? ''}`);
  if (parsed) {
    return { deadline: null, published_date: parsed, date_source: 'parsed' };
  }

  // 3. Nothing usable: first_seen (DB default) is the best available date, and the
  // dashboard badges these as DATE UNKNOWN.
  return { deadline: null, published_date: null, date_source: 'first_seen' };
}

// ---- Hard GLI date cutoff (current-year only) --------------------------------
// GLI keeps only current-year leads: anything whose best-available date is before
// this instant is deleted (not archived) and rejected at capture. Genuinely
// undated leads are NEVER assumed old -- they are held for review.
export const GLI_CUTOFF_MS = Date.UTC(2026, 0, 1); // 2026-01-01T00:00:00Z

export type GliDateVerdict = 'current' | 'pre-cutoff' | 'unknown';

// Classify a GLI lead against the cutoff using the SAME best-available-date logic
// as the write path (source date wins; else a date parsed from title/body; else
// unknown). For opportunities the bid deadline leads, else the publication/parsed
// date. Returns the verdict plus the ISO date it was judged on (null when unknown).
export function classifyGliByCutoff(
  lead: NormalizedLead,
  stream: LeadStream = 'opportunity'
): { verdict: GliDateVerdict; date: string | null } {
  const dates = deriveLeadDates(lead, stream);
  if (dates.date_source === 'first_seen') return { verdict: 'unknown', date: null };
  const pick =
    stream === 'opportunity'
      ? dates.deadline ?? dates.published_date
      : dates.published_date ?? dates.deadline;
  if (!pick) return { verdict: 'unknown', date: null };
  const t = new Date(pick).getTime();
  if (Number.isNaN(t)) return { verdict: 'unknown', date: null };
  return { verdict: t < GLI_CUTOFF_MS ? 'pre-cutoff' : 'current', date: pick };
}

// Convenience for the capture gate: true only when the lead is DEFINITIVELY dated
// before the cutoff. Undated leads return false (kept + flagged, never assumed old).
export function isBeforeGliCutoff(lead: NormalizedLead, stream: LeadStream = 'opportunity'): boolean {
  return classifyGliByCutoff(lead, stream).verdict === 'pre-cutoff';
}
