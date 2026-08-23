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

// `now` is threaded through so a caller that pins a clock (classifyLead, the
// object-model checks) gets the same answer from the age parser as from the
// milestone parser. Without it the two disagreed about what "future" meant.
// A PUBLICATION DATE IN THE FAR FUTURE IS A PLACEHOLDER, NOT A DATE.
//
// Phoenix files three liquor and wagering permits with published_date
// 2026-12-31, which is the clerk's end-of-year filler rather than anything that
// happened. It cost a whole harvest: the Legistar incremental cursor is taken
// from the newest stored date, so Phoenix's cursor sat at 2026-12-01 and the
// 2026-08-23 harvest fetched "0 matters since 2026-12-01" and said so in one
// line nobody was reading. A placeholder does not merely misreport freshness; it
// stops the source being read at all.
//
// THIRTY DAYS, CHOSEN FROM THE DISTRIBUTION RATHER THAN PICKED. Measured over
// all 864 live records carrying a published_date, 11 are in the future:
//
//   Phoenix       +131d x3   the placeholders        +3d x3
//   Nashville      +9d       a real hearing date
//   Clark County   +2d x4    real hearing dates
//
// A cutoff anywhere from +14d to +120d demotes exactly those three and nothing
// else, so the answer is not sensitive to the constant - which is the strongest
// argument available for any threshold. 30 sits in the middle of that range, is
// comfortably clear of the largest legitimate near-future date observed (+9d),
// and is a month, which is a defensible unit for "a hearing a source published
// early".
//
// IT DEMOTES RATHER THAN DELETES. The date falls through to the parsed-then-
// first_seen ladder below, so the record keeps a date and its date_source says
// which kind it is. Refusing the record, or nulling the column outright, would
// throw away a filing because its clerk typed a round number.
export const FUTURE_DATE_LIMIT_DAYS = 30;

export function notAPlaceholder(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return t - now > FUTURE_DATE_LIMIT_DAYS * 86_400_000 ? null : iso;
}

export function deriveLeadDates(
  lead: NormalizedLead,
  _stream: LeadStream = 'opportunity',
  now: number = Date.now()
): DerivedDates {
  const deadline = usable(lead.deadline);
  const published = notAPlaceholder(usable(lead.published_date), now);

  // 1. A real date the source exposed always wins.
  if (deadline || published) {
    return { deadline, published_date: published, date_source: 'source' };
  }

  // 2. No source date: derive one from the lead's own text (this is what catches
  // the 2011-RFP class -- an undated feed row whose title says "2011"). A parsed
  // date is an age signal, so it always lands in published_date.
  const parsed = parseDateFromText(`${lead.title ?? ''}\n${lead.raw_content ?? ''}`, now);
  if (parsed) {
    return { deadline: null, published_date: parsed, date_source: 'parsed' };
  }

  // 3. Nothing usable: first_seen (DB default) is the best available date, and the
  // dashboard badges these as DATE UNKNOWN.
  return { deadline: null, published_date: null, date_source: 'first_seen' };
}

// ---- Two-object liveness model (Opportunity vs Project event) ----------------
// A deadline-bound solicitation is an OPPORTUNITY (binary: open or closed); it
// dies on its deadline. Everything else is a PROJECT EVENT that attaches to a
// long-lived project and lives by heartbeat (recent activity or a future
// milestone). The classifier is the presence of a real SOURCE submission
// deadline -- text-parsed dates never make a lead an opportunity.
//
// Only pre-2026 opportunities with no future milestone are ever DELETED. Project
// events are NEVER deleted (archived/dormant instead), and anything with a future
// milestone is never purged.
import { parseMaxFutureDate } from './date-parse';

export const GLI_CUTOFF_MS = Date.UTC(2026, 0, 1); // 2026-01-01 (opportunity purge boundary)

export type ObjectType = 'opportunity' | 'project_event';
export type OpportunityVerdict = 'live' | 'archive' | 'delete';
export type ProjectEventVerdict = 'live' | 'dormant' | 'archived';

// ms of an ISO date, or NaN.
function ms(iso: string | null): number {
  if (!iso) return NaN;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? NaN : t;
}
// Start of the UTC calendar day of a timestamp.
function startOfUtcDay(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
// `now` minus n calendar months (UTC), for the 12/24-month project windows.
//
// The day is CLAMPED to the last day of the target month. Without the clamp,
// Date.UTC overflows: 2028-02-29 minus 12 months produced 2027-03-01 rather
// than 2027-02-28, so on a leap day the 12-month window silently moved a day
// and a project on the boundary changed verdict. Measured, not theorised.
//
// date-fns subMonths does clamp correctly, and is deliberately NOT used here:
// it operates in LOCAL time, and every window in this file is UTC on purpose.
// Swapping it in would introduce exactly the class of timezone bug this audit
// went looking for. date-fns is used below where the semantics are unambiguous.
function monthsBefore(now: number, n: number): number {
  const d = new Date(now);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() - n;
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(d.getUTCDate(), lastDayOfTarget));
}
// True when the ISO date is strictly after today's UTC day.
function isFutureDate(iso: string | null, now: number): boolean {
  const t = ms(iso);
  return !Number.isNaN(t) && startOfUtcDay(t) > startOfUtcDay(now);
}

// OPPORTUNITY lifecycle. deadline is the real source submission deadline.
//   live    -> deadline today or later.
//   delete  -> deadline before 2026 AND no future milestone (a dead old tender).
//   archive -> any other passed deadline (recently closed feeds the pipeline; a
//              2026+ closed tender, or one protected by a future milestone).
export function opportunityVerdict(
  deadline: string | null,
  milestoneDate: string | null,
  now: number = Date.now()
): OpportunityVerdict {
  const dl = ms(deadline);
  if (Number.isNaN(dl)) return 'archive'; // defensive; an opportunity always has one
  if (dl >= startOfUtcDay(now)) return 'live';
  if (dl < GLI_CUTOFF_MS && !isFutureDate(milestoneDate, now)) return 'delete';
  return 'archive';
}

// PROJECT EVENT lifecycle. bestDate is the last-activity proxy (source or
// text-parsed date); origination date is NEVER a liveness filter. A future
// milestone always wins. Never deleted.
//   live     -> future milestone, OR last activity within 12 months, OR undated.
//   dormant  -> silent 12-24 months, no future milestone.
//   archived -> silent beyond 24 months, no future milestone.
export function projectEventVerdict(
  bestDate: string | null,
  milestoneDate: string | null,
  now: number = Date.now()
): ProjectEventVerdict {
  if (isFutureDate(milestoneDate, now)) return 'live';
  const t = ms(bestDate);
  if (Number.isNaN(t)) return 'live'; // undated: never assume old (badge DATE UNKNOWN)
  if (t >= monthsBefore(now, 12)) return 'live';
  if (t >= monthsBefore(now, 24)) return 'dormant';
  return 'archived';
}

export interface LeadModel {
  object_type: ObjectType;
  milestone_date: string | null;
  verdict: OpportunityVerdict | ProjectEventVerdict;
}

// The full object-model classification of a lead: object_type (by the deadline
// rule), its future milestone_date, and its lifecycle verdict.
export function classifyLead(lead: NormalizedLead, now: number = Date.now()): LeadModel {
  const dates = deriveLeadDates(lead, 'opportunity', now);
  const milestone_date = parseMaxFutureDate(`${lead.title ?? ''}\n${lead.raw_content ?? ''}`, now);
  const object_type: ObjectType = dates.deadline ? 'opportunity' : 'project_event';
  const verdict =
    object_type === 'opportunity'
      ? opportunityVerdict(dates.deadline, milestone_date, now)
      : projectEventVerdict(dates.published_date, milestone_date, now);
  return { object_type, milestone_date, verdict };
}

// The two columns written on every GLI row. Derived from the same source dates as
// the row, so the gate and the row never disagree.
export function objectFields(
  dates: DerivedDates,
  title: string | null,
  rawContent: string | null,
  now: number = Date.now()
): { object_type: ObjectType; milestone_date: string | null } {
  return {
    object_type: dates.deadline ? 'opportunity' : 'project_event',
    milestone_date: parseMaxFutureDate(`${title ?? ''}\n${rawContent ?? ''}`, now),
  };
}

// Capture gate + purge predicate: true ONLY for a dead old opportunity (pre-2026
// deadline, no future milestone). Project events are never deleted; undated leads
// are never assumed old.
export function shouldDelete(lead: NormalizedLead, now: number = Date.now()): boolean {
  const m = classifyLead(lead, now);
  return m.object_type === 'opportunity' && m.verdict === 'delete';
}
