// RUN HEALTH: what each source produced this run, and whether that is normal.
//
// THE META-BUG THIS EXISTS TO FIX. The zero-write alarm was called in exactly
// one place and its guard read:
//
//     if (written > 0 || trailingAverage <= 0) return;
//
// with `report.deduped` passed as the trailing average. So a lane that died
// completely produced deduped = 0, the guard returned early, and nothing fired.
// The alarm could only ever speak when a lane matched records and failed to
// write them, which is the one failure mode nobody had. That is why Las Vegas
// went dead in silence and why CFTOD parsed 874 pages across two board packets
// and kept nothing without a word.
//
// TWO LEVELS, BECAUSE A LANE IS TOO COARSE. The government lane wrote 129
// records on the run where CFTOD kept zero from 874 pages. A lane-level check
// would have called that healthy. So health is recorded per UNIT, where a unit
// is usually a source and may be finer: the CFTOD extractor registers one unit
// per board packet, because the packet is the thing that silently stopped
// working.
//
// THE BASELINE IS HISTORY, NOT THIS RUN. A source is only judged against what it
// produced on previous runs, read from the source_health table (migration 019).
// Until that migration is applied there is no history, and the module degrades
// to the two rules that need none: a unit that fetched something and kept
// nothing is suspicious, and a unit that fetched nothing at all is worse.

import { supabaseAdmin } from '../../lib/supabase-admin';
import { captureDeadSource, captureEmptyLane } from './sentry';

export interface SourceRun {
  // The thing being judged: a source name ('legistar'), or something finer
  // ('cftod-pdf: 2-27-2026 BOS Agenda Packet').
  unit: string;
  lane: string;
  // What the source pulled in before its own filtering. Zero means the source
  // itself produced nothing, which is a different failure from filtering
  // everything out.
  fetched: number;
  // What survived to be written.
  kept: number;
}

// Collected during a run, drained when the run reports.
const runs: SourceRun[] = [];

export function recordSourceRun(run: SourceRun): void {
  runs.push(run);
}

export function takeSourceRuns(): SourceRun[] {
  const out = [...runs];
  runs.length = 0;
  return out;
}

export function resetSourceRuns(): void {
  runs.length = 0;
}

// Convenience: derive one SourceRun per `source` from a lead array, for lanes
// whose adapters do not report their own counts. `fetched` is what the adapter
// returned; `kept` is what the lane wrote.
export function runsFromLeads(
  lane: string,
  fetchedBySource: Map<string, number>,
  keptBySource: Map<string, number>
): SourceRun[] {
  const units = new Set([...fetchedBySource.keys(), ...keptBySource.keys()]);
  return [...units].map((unit) => ({
    lane,
    unit,
    fetched: fetchedBySource.get(unit) ?? 0,
    kept: keptBySource.get(unit) ?? 0,
  }));
}

export type HealthVerdict =
  // Produced records. Nothing to say.
  | 'ok'
  // Fetched nothing at all. Total death: the source is unreachable, blocked, or
  // returning an empty document. Loudest.
  | 'no-fetch'
  // Fetched records and kept none, against a history of keeping some. The
  // Granicus and CFTOD failure.
  | 'zero-kept'
  // Fetched and kept nothing, with no history to compare against. Reported at a
  // lower level: it may simply be a new source, or a genuinely quiet week.
  | 'zero-no-baseline';

export interface HealthFinding {
  unit: string;
  lane: string;
  fetched: number;
  kept: number;
  baseline: number | null;
  verdict: HealthVerdict;
}

// How many previous runs form the baseline.
const BASELINE_RUNS = 5;

// The mean `kept` across recent runs, per unit. An empty map means the
// source_health table is absent or has no history yet.
export async function loadBaselines(lane?: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  let q = supabaseAdmin
    .from('source_health')
    .select('unit,kept,run_at')
    .order('run_at', { ascending: false })
    .limit(BASELINE_RUNS * 200);
  if (lane) q = q.eq('lane', lane);
  const { data, error } = await q;
  if (error) {
    // Missing table is expected until migration 019 is applied; say so once and
    // continue without history rather than failing the run.
    console.warn(`Health: no baseline history available (${error.message.slice(0, 80)}).`);
    return out;
  }
  const byUnit = new Map<string, number[]>();
  for (const row of (data ?? []) as { unit: string; kept: number }[]) {
    const list = byUnit.get(row.unit) ?? [];
    if (list.length < BASELINE_RUNS) list.push(row.kept);
    byUnit.set(row.unit, list);
  }
  for (const [unit, list] of byUnit) {
    if (list.length === 0) continue;
    out.set(unit, list.reduce((a, b) => a + b, 0) / list.length);
  }
  return out;
}

// Persist this run's counts so future runs have a baseline. Best-effort: a
// missing table must never fail a scrape.
export async function persistSourceRuns(rs: SourceRun[]): Promise<boolean> {
  if (rs.length === 0) return true;
  const { error } = await supabaseAdmin.from('source_health').insert(
    rs.map((r) => ({ unit: r.unit, lane: r.lane, fetched: r.fetched, kept: r.kept }))
  );
  if (error) {
    console.warn(`Health: could not record run counts (${error.message.slice(0, 80)}).`);
    return false;
  }
  return true;
}

// Judge each unit. Pure, so it is testable without a database.
export function judge(rs: SourceRun[], baselines: Map<string, number>): HealthFinding[] {
  return rs.map((r) => {
    const baseline = baselines.has(r.unit) ? (baselines.get(r.unit) as number) : null;
    let verdict: HealthVerdict;
    if (r.kept > 0) verdict = 'ok';
    else if (r.fetched === 0) verdict = 'no-fetch';
    else if (baseline !== null && baseline > 0) verdict = 'zero-kept';
    else verdict = 'zero-no-baseline';
    return { unit: r.unit, lane: r.lane, fetched: r.fetched, kept: r.kept, baseline, verdict };
  });
}

// THE ONE CALL A LANE MAKES. Drains what the run recorded, judges it against
// history, prints it, alerts on everything that produced nothing, and stores
// this run's counts as tomorrow's baseline.
//
// Every lane ends with this. That is the point: the previous alarm existed at a
// single call site, so two of the three lanes could not have alerted even if the
// guard had been right.
export async function reportRunHealth(
  lane: string,
  laneTotals: { fetched: number; written: number }
): Promise<HealthFinding[]> {
  const rs = takeSourceRuns().filter((r) => r.lane === lane);
  const baselines = await loadBaselines(lane);
  const findings = judge(rs, baselines);
  printHealth(findings);

  for (const f of findings) {
    if (f.verdict === 'ok') continue;
    captureDeadSource({
      unit: f.unit,
      lane: f.lane,
      fetched: f.fetched,
      kept: f.kept,
      baseline: f.baseline,
      verdict: f.verdict,
    });
  }

  // Lane-level check as well: a lane can write nothing even when no individual
  // source looks dead, and vice versa.
  captureEmptyLane(lane, laneTotals.fetched, laneTotals.written);
  if (laneTotals.written === 0) {
    console.log(
      `  LANE ALERT: "${lane}" fetched ${laneTotals.fetched} and wrote 0` +
        (laneTotals.fetched === 0 ? ' (total death)' : '')
    );
  }

  await persistSourceRuns(rs);
  return findings;
}

export function printHealth(findings: HealthFinding[]): void {
  const bad = findings.filter((f) => f.verdict !== 'ok');
  console.log(
    `\nRun health: ${findings.length - bad.length} of ${findings.length} sources produced records.`
  );
  if (bad.length === 0) return;
  console.log('  SOURCES THAT PRODUCED NOTHING:');
  for (const f of bad.sort((a, b) => a.verdict.localeCompare(b.verdict))) {
    const base = f.baseline === null ? 'no history' : `usually ${f.baseline.toFixed(1)}`;
    const label =
      f.verdict === 'no-fetch'
        ? 'TOTAL DEATH  fetched nothing'
        : f.verdict === 'zero-kept'
          ? 'ZERO KEPT    fetched but kept none'
          : 'zero        (no baseline yet)';
    console.log(`    ${label}  ${f.unit}  [fetched ${f.fetched}, kept ${f.kept}, ${base}]`);
  }
}
