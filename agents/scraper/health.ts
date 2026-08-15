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
import { alarmDeadSource, alarmDegradedRecovery, alarmEmptyLane } from './alarm';
import { ageInDays, degradedEntry, suppressesAlert } from './degraded-sources';
import { DEAD_FEEDS } from '../../lib/dead-feeds';

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
// A VERIFICATION RUN MUST NOT BECOME TOMORROW'S BASELINE.
//
// verify-alarms drives reportRunHealth with invented counts to prove the alarm
// still fires. Those counts were being inserted into source_health, so a fake
// "legistar fetched 0" row joined the history that judges the real legistar -
// and the harness reported "usually 3.7" on its second run, a baseline it had
// written itself. A test that changes the thing it measures is not a test.
//
// Set by the harness, never by a lane. It suppresses the WRITE only: the run is
// still judged against real history and still alarms, which is the whole point.
const NO_HEALTH_WRITE = process.env.HEALTH_NO_WRITE === '1';

export async function persistSourceRuns(rs: SourceRun[]): Promise<boolean> {
  if (rs.length === 0) return true;
  if (NO_HEALTH_WRITE) return true;
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

  // AN EMPTY SELECTION IS NOT A DEATH, and telling them apart is the whole
  // point of this branch.
  //
  // A scoped run names markets or sources, and the lane filters its adapters
  // down to the ones that cover them. Scope a run at a market no adapter
  // covers - which is every market on the day it is being onboarded - and the
  // lane correctly runs nothing at all. That used to print
  //
  //     Run health: 0 of 0 sources produced records.
  //       LANE ALERT: "government" fetched 0 and wrote 0 (total death)
  //
  // and raise the zero-write alarm at fatal. The lane was working exactly as
  // designed.
  //
  // The distinction is exact and needs no new plumbing. Only adapters that RAN
  // record a source run, so an empty `rs` means no adapter was selected, while
  // total death means adapters ran and every one of them fetched nothing. The
  // first has nothing to judge, no baseline to write and nobody to wake; the
  // second is the emergency this file exists for.
  //
  // Found on the New York City onboarding run. run-scope.ts already insists a
  // partial run must never be mistaken for a full one; this is the same rule
  // applied one layer down, where the alarm lives.
  if (rs.length === 0) {
    console.log(
      `\nRun health: no sources were in scope for "${lane}", so there is nothing to judge. ` +
        `This is an empty selection, not a dead lane.`
    );
    return [];
  }

  const baselines = await loadBaselines(lane);
  const findings = judge(rs, baselines);
  printHealth(findings);
  printFrozenFeeds(lane);

  // THE KNOWN-DEGRADED REGISTER decides who gets paged, never who gets shown.
  // A registered unit producing exactly the failure its entry expects is the
  // documented condition: it appears in the run report and on the Health surface
  // above, and no alarm is raised for it. Anything else - a different failure,
  // or a recovery - is a change, and a change alerts.
  for (const f of findings) {
    if (f.verdict === 'ok') {
      // A registered unit that has RECOVERED is news: the register is now wrong.
      const known = suppressesAlert(f.unit, f.verdict);
      if (known) {
        console.log(
          `  DEGRADED-SOURCE RECOVERY: "${f.unit}" kept ${f.kept} and is registered as degraded ` +
            `since ${known.entry.recorded}. Remove its entry in agents/scraper/degraded-sources.`
        );
        alarmDegradedRecovery({
          unit: f.unit,
          lane: f.lane,
          fetched: f.fetched,
          kept: f.kept,
          recordedOn: known.entry.recorded,
        });
      }
      continue;
    }
    const known = suppressesAlert(f.unit, f.verdict);
    if (known?.asExpected) continue;
    alarmDeadSource({
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
  alarmEmptyLane(lane, laneTotals.fetched, laneTotals.written, rs.length);
  if (laneTotals.written === 0) {
    console.log(
      `  LANE ALERT: "${lane}" fetched ${laneTotals.fetched} and wrote 0` +
        (laneTotals.fetched === 0 ? ' (total death)' : '')
    );
  }

  await persistSourceRuns(rs);
  return findings;
}

/**
 * THE MARKETS THIS LANE IS NO LONGER READING, printed on every run of that lane.
 *
 * These do NOT appear above, and that is the entire reason this exists. A frozen
 * feed passes every check in this file: Legistar fetches Miami-Dade's matters
 * and keeps them, so the verdict is 'ok' and the lane reports itself healthy
 * while returning the same 2018 snapshot it returned last week. Health asks "did
 * this source produce?"; the question a frozen feed fails is "is what it
 * produces still moving?", which needs run history that source_health does not
 * have and a comparison against the SOURCE that verify-staleness does make.
 *
 * So the run report states the declaration rather than deriving it. It is not an
 * alarm - the condition is known and written down - but a lane that prints
 * "8 of 8 sources produced records" and says nothing about two markets it cannot
 * see is a report that reads as full coverage.
 */
export function printFrozenFeeds(lane: string, now: Date = new Date()): void {
  const feeds = DEAD_FEEDS.filter((f) => f.lane === lane);
  if (feeds.length === 0) return;
  console.log('\n  MARKETS WE ARE NO LONGER READING (declared in lib/dead-feeds):');
  for (const f of feeds) {
    const behind = Math.floor(
      (now.getTime() - Date.parse(f.frozenSince)) / (30.44 * 24 * 3600 * 1000)
    );
    const years = Math.floor(behind / 12);
    console.log(
      `    ${f.market} (${f.client})  nothing published since ${f.frozenSince}` +
        (Number.isFinite(behind) ? `, ${years}y ${behind % 12}m behind` : '')
    );
    console.log(`        live data:  ${f.liveDataAt ?? 'not established'}`);
    console.log(`        removed when: ${f.revivesWhen.replace(/\s+/g, ' ')}`);
  }
  console.log(
    '    These markets are held out of client documents and marked on the register. ' +
      'Run `npm run verify:staleness` to re-measure.'
  );
}

export function printHealth(findings: HealthFinding[]): void {
  const bad = findings.filter((f) => f.verdict !== 'ok');
  console.log(
    `\nRun health: ${findings.length - bad.length} of ${findings.length} sources produced records.`
  );
  if (bad.length === 0) return;

  // A KNOWN-DEGRADED SOURCE IS REPORTED, NOT HIDDEN. It is split into its own
  // section so the list above it is only the things that need reading today.
  // Silencing an alarm and hiding the condition are different acts, and only the
  // first one is wanted here.
  const known = bad.filter((f) => suppressesAlert(f.unit, f.verdict)?.asExpected);
  const news = bad.filter((f) => !suppressesAlert(f.unit, f.verdict)?.asExpected);

  if (news.length > 0) {
    console.log('  SOURCES THAT PRODUCED NOTHING:');
    for (const f of news.sort((a, b) => a.verdict.localeCompare(b.verdict))) {
      const base = f.baseline === null ? 'no history' : `usually ${f.baseline.toFixed(1)}`;
      const label =
        f.verdict === 'no-fetch'
          ? 'TOTAL DEATH  fetched nothing'
          : f.verdict === 'zero-kept'
            ? 'ZERO KEPT    fetched but kept none'
            : 'zero        (no baseline yet)';
      const entry = degradedEntry(f.unit);
      // A registered unit failing in a way its entry did NOT predict.
      const note = entry ? '  <- registered as degraded, but this is a DIFFERENT failure' : '';
      console.log(`    ${label}  ${f.unit}  [fetched ${f.fetched}, kept ${f.kept}, ${base}]${note}`);
    }
  }

  if (known.length > 0) {
    console.log('  KNOWN DEGRADED (reported, not alerted):');
    for (const f of known) {
      const entry = degradedEntry(f.unit) as NonNullable<ReturnType<typeof degradedEntry>>;
      const age = ageInDays(entry);
      console.log(
        `    ${f.unit}  [fetched ${f.fetched}, kept ${f.kept}]  recorded ${entry.recorded}` +
          (age === null ? '' : ` (${age}d ago)`)
      );
      console.log(`        why:    ${entry.reason.replace(/\s+/g, ' ').slice(0, 160)}`);
      console.log(`        alerts again when: ${entry.alertsAgainWhen.replace(/\s+/g, ' ')}`);
    }
  }
}
