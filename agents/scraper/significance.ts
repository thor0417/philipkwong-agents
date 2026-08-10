// HOW IMPORTANT IS THIS PROJECT? A score from 0 to 100, and a breakdown that
// says where every point came from.
//
// THE DEFECT THIS EXISTS TO FIX. The register sorts by last activity, so a
// dormant 2024 filing on a street address outranks a multi-billion casino bid
// that filed last month. Recency is a tiebreaker wearing a ranking's clothes.
//
// NINE SIGNALS, ALL COMPUTED FROM STORED FIELDS. No model call, no new capture.
// A ranking that needs an LLM pass cannot be recomputed on every write, and one
// that needs new capture cannot be backfilled over what is already here.
//
// EVERY SCORE IS EXPLAINABLE. score() returns the contribution of each signal
// alongside the total, and that breakdown is stored in significance_detail. A
// ranking nobody can interrogate is a ranking nobody can trust or improve, and
// this project has twice shipped numbers that could not be checked.
//
// NO SIGNAL MAY DOMINATE. The weights below sum to exactly 100 and the largest
// is 18. That is deliberate: a large dollar figure inside a procedural notice
// must not outrank a real project. Worked through - a procedural record quoting
// $1bn scores at most money 10 + source 8 + stage 6 = 24, while an approved
// casino with an applicant, five filings and a watched target scores 67.

import { isGenericEntity, isConcessionAward } from './cluster';
import { strongBypassHits } from './targets';

// ---- THE WEIGHTS, AND WHY EACH IS THE SIZE IT IS ----------------------------
//
// Justified against the measured corpus (345 projects, 2026-08-10), because a
// weight is only meaningful next to how often its signal actually fires.
export const WEIGHTS = {
  // Stage is the single clearest statement of whether a thing is real, and it
  // is present on every project. Largest weight for that reason. Measured:
  // filed 124, dormant 118, approved 56, stalled 31, hearing scheduled 14.
  stage: 18,
  // A tracked target is significant by definition - Philip chose it. Second
  // largest, and deliberately below stage so a dormant target does not outrank
  // a project under construction.
  target: 15,
  // Fires on 8% of projects. Log-scaled, so $1bn is worth twice $1m rather than
  // a thousand times. Capped at 10 precisely so a figure quoted inside a
  // procedural record cannot carry it.
  money: 10,
  // Fires on 226 of 345. A private applicant means someone with their own money
  // is asking; a municipal one means the city is talking to itself.
  party: 10,
  // Record depth. Eight filings over two years is a live matter; one notice is
  // a rumour. Split from span below because they answer different questions.
  depth: 12,
  // Venue tier. Corrected in Brief H, so this scores against current values:
  // Mixed-Use Development 101, null 85, Museum 26, Hotel 25, Casino/Gaming 22.
  venue: 12,
  // Fires on 8% of the corpus - only 38 projects carry a representative. Rare
  // and hard to fake: someone is paying professionals.
  representation: 8,
  // An entitlement filing outranks a legal notice, which outranks a press
  // mention. Small, because nearly every government project has a decent source
  // and the signal therefore separates little.
  source: 8,
  // How long the project has been filing. Two years of activity is a different
  // thing from two filings in a week.
  span: 3,
  // THE TIEBREAKER, AND ONLY THAT. 4 points, because making recency a driver is
  // the exact defect this file replaces.
  recency: 4,
} as const;

// ---- PENALTIES --------------------------------------------------------------
//
// Subtracted rather than weighted, because they answer a different question.
// The nine signals ask "how much evidence of significance is there"; these ask
// "is this the kind of thing the register is for at all". A penalty can only
// ever push a score down, so it cannot manufacture a ranking.
export const PENALTIES = {
  // A TRANSACTION IS NOT A DEVELOPMENT.
  //
  // "Intent to award as a concession a License Agreement to Busters Marine
  // Bronx Marina for the operation of an outdoor cafe" scores well on the
  // signals that matter elsewhere: a named private party (10/10), a scheduled
  // hearing (10/18), a real entitlement source. Every one of those readings is
  // correct, and the project is still a cafe licence.
  //
  // The rule keys on what the record IS, and it is the same rule the clusterer
  // already uses to stop a concession operator's name welding unrelated sites
  // into one project. Reused rather than restated so the two cannot drift.
  transaction: -12,
} as const;

export type SignalName = keyof typeof WEIGHTS;

export const MAX_SCORE = Object.values(WEIGHTS).reduce((a, b) => a + b, 0); // 100

export interface SignificanceRecord {
  title?: string | null;
  raw_content?: string | null;
  source?: string | null;
  source_type?: string | null;
  stream?: string | null;
  published_date?: string | null;
}

export interface SignificanceInput {
  stage?: string | null;
  venue_type?: string | null;
  primary_applicant?: string | null;
  primary_representative?: string | null;
  record_count?: number | null;
  last_activity?: string | null;
  records: SignificanceRecord[];
}

export interface SignificanceResult {
  score: number;
  detail: Record<string, { points: number; of: number; why: string }>;
}

// ---- 1. MONEY ---------------------------------------------------------------
//
// Built from a string, like every other pattern in this codebase, because a
// heredoc edit once turned \b into a backspace byte and the rule silently never
// matched. Matches "$1.2 billion", "$450,000", "$3M".
const MONEY_RE = new RegExp('\\$\\s?([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*(billion|bn|million|mm?|k)?\\b', 'gi');

/** The largest dollar figure stated anywhere in the project's records. */
export function largestFigure(text: string): number {
  let best = 0;
  MONEY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MONEY_RE.exec(text))) {
    const n = Number(String(m[1]).replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    const unit = (m[2] ?? '').toLowerCase();
    const scaled =
      unit.startsWith('b') ? n * 1e9 : unit.startsWith('m') ? n * 1e6 : unit === 'k' ? n * 1e3 : n;
    if (scaled > best) best = scaled;
  }
  return best;
}

// LOG SCALE, NOT LINEAR. A $2bn project is not two thousand times more
// significant than a $1m one, and on a linear scale it would take every point
// and leave the rest of the model decorative.
function moneyPoints(v: number): { points: number; why: string } {
  if (v < 100_000) return { points: 0, why: 'no dollar figure above $100k in any record' };
  // log10(1e5)=5 -> 0 points; log10(1e9)=9 -> full marks.
  const t = Math.min(1, Math.max(0, (Math.log10(v) - 5) / 4));
  const points = Math.round(t * WEIGHTS.money * 10) / 10;
  return { points, why: `largest figure ${fmtMoney(v)}` };
}

function fmtMoney(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}bn`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}m`;
  return `$${Math.round(v / 1000)}k`;
}

// ---- 4. STAGE ---------------------------------------------------------------
//
// Dormant scores ZERO rather than a small positive. 118 of 345 projects are
// dormant and they are the single biggest source of noise at the top of an
// activity-sorted register; giving them a floor would carry them back up.
const STAGE_POINTS: Record<string, number> = {
  'under construction': 18,
  permitted: 16,
  approved: 14,
  'hearing scheduled': 10,
  filed: 6,
  stalled: 2,
  dormant: 0,
};

// ---- 6. VENUE ---------------------------------------------------------------
//
// Three tiers. The top tier is what Philip's clients build and operate. The
// bottom is real but generic: 101 of 345 projects are Mixed-Use Development,
// so scoring it highly would flatten the ranking rather than sharpen it.
const VENUE_TOP = new Set([
  'Integrated Resort', 'Casino/Gaming', 'Theme Park', 'Amusement Park', 'Waterpark',
  'Arena/Stadium', 'Entertainment Destination', 'Entertainment District', 'Resort',
]);
const VENUE_MID = new Set([
  'Hotel', 'Museum', 'Convention/Expo', 'Aquarium', 'Science Center', 'Zoo',
  'Family Entertainment Center', 'Heritage/Cultural Site', 'Master-Planned Community',
]);

// ---- 8. SOURCE AUTHORITY ----------------------------------------------------
//
// An entitlement filing is the applicant asking a government for permission.
// A legal notice is a clerk publishing a calendar. A press mention is someone
// writing about it.
const SOURCE_ENTITLEMENT = new Set([
  'nyc-zap', 'nyc-ceqr', 'agenda-portal', 'legistar', 'clark-tab', 'ceqanet',
  'cftod-pdf', 'sfwmd', 'govdoc',
]);
const SOURCE_NOTICE = new Set(['nyc-city-record']);

const DAY = 86_400_000;

export function score(input: SignificanceInput, now = new Date('2026-08-10T00:00:00Z')): SignificanceResult {
  const recs = input.records ?? [];
  const text = recs.map((r) => `${r.title ?? ''} ${r.raw_content ?? ''}`).join('\n');
  const detail: SignificanceResult['detail'] = {};
  const put = (name: SignalName, points: number, why: string): void => {
    detail[name] = { points: Math.round(points * 10) / 10, of: WEIGHTS[name], why };
  };

  // 1. Money.
  const money = moneyPoints(largestFigure(text));
  put('money', money.points, money.why);

  // 2. Named private party.
  const applicant = (input.primary_applicant ?? '').trim();
  const isPrivate = applicant.length > 0 && !isGenericEntity(applicant.toLowerCase());
  put(
    'party',
    isPrivate ? WEIGHTS.party : 0,
    isPrivate ? `private applicant: ${applicant.slice(0, 48)}` : applicant ? 'applicant is a public body' : 'no applicant named'
  );

  // 3. Professional representation.
  const rep = (input.primary_representative ?? '').trim();
  put('representation', rep ? WEIGHTS.representation : 0, rep ? `represented by ${rep.slice(0, 40)}` : 'no representative');

  // 4. Stage.
  const stage = input.stage ?? '';
  put('stage', STAGE_POINTS[stage] ?? 0, stage ? `stage: ${stage}` : 'no stage');

  // 5. Record depth. Log-shaped: the step from one filing to three matters far
  // more than the step from ten to twelve.
  //
  // ONE RECORD SCORES ZERO, not a fraction. A single filing is a rumour - it is
  // the thing depth exists to distinguish sustained activity FROM. Scoring it
  // 3.2 of 12 (which log10(n+1) did) carried one-off concession licences and
  // liquor notices into the middle of the register, which is the exact
  // illegibility this model replaces.
  const n = Math.max(0, input.record_count ?? recs.length);
  const depth = n <= 1 ? 0 : Math.min(1, Math.log10(n) / Math.log10(12)) * WEIGHTS.depth;
  put('depth', depth, `${n} live record${n === 1 ? '' : 's'}`);

  // 5b. Span.
  const dates = recs.map((r) => r.published_date).filter(Boolean).map((d) => Date.parse(String(d))).filter((t) => !Number.isNaN(t));
  let spanPts = 0;
  let spanWhy = 'fewer than two dated records';
  if (dates.length >= 2) {
    const days = (Math.max(...dates) - Math.min(...dates)) / DAY;
    spanPts = Math.min(1, days / 730) * WEIGHTS.span;
    spanWhy = `${Math.round(days)} days between first and last filing`;
  }
  put('span', spanPts, spanWhy);

  // 6. Venue. A NULL VENUE IS A PENALTY, NOT A ZERO.
  //
  // Null is the honest answer when nothing classifies (85 of 345 projects), and
  // it is also what a street-end stabilisation, a liquor licence and an outdoor
  // cafe concession all look like. In a leisure register, a project nothing can
  // identify as any kind of venue is evidence against significance rather than
  // the absence of evidence, so it subtracts. It cannot sink a real project on
  // its own: half the venue weight against a possible 88 points elsewhere.
  const v = input.venue_type ?? '';
  const venuePts = VENUE_TOP.has(v)
    ? WEIGHTS.venue
    : VENUE_MID.has(v)
      ? WEIGHTS.venue * 0.65
      : v
        ? WEIGHTS.venue * 0.3
        : -WEIGHTS.venue * 0.5;
  put('venue', venuePts, v ? `venue: ${v}` : 'no venue type, which in a leisure register counts against');

  // 7. Watch target. strongBypassHits rather than bypassHits: the weak terms
  // are district and street names, which name a place and not a project.
  const hits = strongBypassHits(text);
  put(
    'target',
    hits.length ? WEIGHTS.target : 0,
    hits.length ? `watched target: ${[...new Set(hits.map((h) => h.target))].slice(0, 3).join(', ')}` : 'no watched target'
  );

  // 8. Source authority. The BEST source across the project's records.
  let best = 0;
  let bestWhy = 'no source';
  for (const r of recs) {
    const s = r.source ?? '';
    const pts = SOURCE_ENTITLEMENT.has(s) ? WEIGHTS.source : SOURCE_NOTICE.has(s) ? WEIGHTS.source * 0.6 : WEIGHTS.source * 0.3;
    if (pts > best) {
      best = pts;
      bestWhy = SOURCE_ENTITLEMENT.has(s) ? `entitlement filing (${s})` : SOURCE_NOTICE.has(s) ? `legal notice (${s})` : `press or other (${s})`;
    }
  }
  put('source', recs.length ? best : 0, recs.length ? bestWhy : 'no records');

  // 9. Recency, lightly.
  const last = input.last_activity ? Date.parse(input.last_activity) : NaN;
  let recPts = 0;
  let recWhy = 'no activity date';
  if (!Number.isNaN(last)) {
    const days = (now.getTime() - last) / DAY;
    recPts = days <= 90 ? WEIGHTS.recency : days <= 365 ? WEIGHTS.recency * 0.7 : days <= 730 ? WEIGHTS.recency * 0.4 : 0;
    recWhy = `last activity ${Math.max(0, Math.round(days))} days ago`;
  }
  put('recency', recPts, recWhy);

  // PENALTY: the project's records are transactions rather than developments.
  // Applied when EVERY record is a concession award, not merely one: a real
  // development that happens to include a concession among ten filings is still
  // a development.
  const concessions = recs.filter((r) => isConcessionAward({ url: '', raw_content: r.raw_content ?? null }));
  const allTransactions = recs.length > 0 && concessions.length === recs.length;
  detail.transaction = {
    points: allTransactions ? PENALTIES.transaction : 0,
    of: PENALTIES.transaction,
    why: allTransactions
      ? `every record is a concession award, which is a transaction rather than a development`
      : 'not a pure concession award',
  };

  const total = Object.values(detail).reduce((a, d) => a + d.points, 0);
  return { score: Math.round(Math.min(MAX_SCORE, Math.max(0, total)) * 10) / 10, detail };
}

/** One line explaining a score, best signals first. Used by the CLI and the UI. */
export function explain(detail: SignificanceResult['detail']): string {
  return Object.entries(detail)
    .filter(([, d]) => d.points > 0)
    .sort((a, b) => b[1].points - a[1].points)
    .map(([k, d]) => `${k} ${d.points}/${d.of}`)
    .join('  ');
}
