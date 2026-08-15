// COVERAGE AND SOURCE HEALTH, MEASURED FROM THE CORPUS.
//
// lib/coverage declares WHICH markets we point an adapter at and what the five
// states mean. This computes the numbers those states are decided on, and it is
// the only place that does, so the geography rail and the Health screen cannot
// disagree about whether Nashville is thin.
//
// EVERY NUMBER HERE IS A FACT ABOUT WHAT WE HOLD, and one of them is a fact
// about the SOURCE, and the difference is the single most important thing on
// this screen:
//
//   newestDocumentDays  the age of the newest thing the source PUBLISHED that
//                       we hold. Answers "is this jurisdiction still moving".
//   newestCaptureDays   the age of the newest thing we FETCHED. Answers "are we
//                       still reading it".
//
// A source can be fresh on one and ancient on the other, and each combination
// means something different. SFWMD is captured every run and its newest permit
// is from 2024: we are reading it and it is not moving, or it is moving
// somewhere we do not read. Only a probe of the source itself can tell those
// apart, which is what verify-staleness is for; this says which markets need
// one.

import { supabase } from './supabase';
import {
  COVERAGE_ORDER as COVERAGE_RANK,
  COVERED_MARKETS,
  coverageFor,
  coveredMarket,
  isCoveredMarket,
  type Coverage,
  type CoveredMarket,
} from '../../lib/coverage';
import { DEAD_FEEDS } from '../../lib/dead-feeds';
import { DEGRADED_SOURCES } from '../../lib/degraded-sources';

const PAGE = 1000;
const DAY = 86_400_000;

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.round((Date.now() - t) / DAY);
}

async function pageAll<T>(
  run: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  label: string
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1);
    if (error) throw new Error(`${label} read failed: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

interface CorpusRecord {
  project_id: string | null;
  market: string | null;
  source: string | null;
  status: string | null;
  first_seen: string | null;
  published_date: string | null;
  deadline: string | null;
  applicant: string | null;
  representative: string | null;
  presented_by: string | null;
  contact_name: string | null;
}

const CORPUS_COLUMNS =
  'project_id,market,source,status,first_seen,published_date,deadline,applicant,representative,presented_by,contact_name';

/** The date the record's SOURCE put on it. Never first_seen: see the header. */
function documentDate(r: CorpusRecord): string | null {
  return r.published_date ?? r.deadline ?? null;
}

function namesAParty(r: CorpusRecord): boolean {
  return !!(r.applicant || r.representative || r.presented_by || r.contact_name);
}

export interface MarketCoverage extends CoveredMarket {
  liveProjects: number;
  projectsNamingAParty: number;
  records: number;
  newestDocument: string | null;
  newestDocumentDays: number | null;
  newestCapture: string | null;
  newestCaptureDays: number | null;
  /** The sources that actually produced a record here, as opposed to the ones aimed at it. */
  producingSources: string[];
  coverage: Coverage;
}

export interface PressGeography {
  market: string;
  liveProjects: number;
  records: number;
}

export interface SourceHealth {
  source: string;
  records: number;
  newestDocument: string | null;
  newestDocumentDays: number | null;
  newestCapture: string | null;
  newestCaptureDays: number | null;
  /** Records written by the most recent run this source appears in, from source_health. */
  recordsThisRun: number | null;
  lastRunAt: string | null;
  /** Declared in the known-degraded register, with the reason. */
  degraded: { reason: string; recorded: string; alertsAgainWhen: string } | null;
  /** Which covered markets this source feeds. */
  markets: string[];
}

export interface CoverageReport {
  markets: MarketCoverage[];
  press: PressGeography[];
  pressRecords: number;
  pressProjects: number;
  sources: SourceHealth[];
  /** True when source_health has run history to read; false while it holds one row. */
  hasRunHistory: boolean;
  /** Every project counted, so a caller can state what the split covers. */
  liveProjects: number;
}

/**
 * Everything the geography rail and the Health screen need, in one read.
 *
 * ONE QUERY FOR BOTH SURFACES, deliberately. They are two views of one question
 * and a second implementation is a second chance to disagree - which is exactly
 * what happened between the rail's market count and the market filter.
 */
export async function fetchCoverage(module: string): Promise<CoverageReport> {
  const records = await pageAll<CorpusRecord>(
    (a, b) =>
      supabase
        .from('leads')
        .select(CORPUS_COLUMNS)
        .eq('module', module)
        .neq('status', 'dismissed')
        .range(a, b),
    'leads'
  );

  const projects = await pageAll<{ id: string; status: string | null }>(
    (a, b) => supabase.from('projects').select('id,status').eq('module', module).range(a, b),
    'projects'
  );
  const live = new Set(projects.filter((p) => p.status !== 'dismissed').map((p) => p.id));

  // source_health is the run log. It holds one row today, so nothing can be said
  // about "records this run" for any lane but the one that has written - and
  // that absence is REPORTED rather than filled with a zero, because a zero here
  // reads as "this source produced nothing", which is a different and much
  // louder claim.
  const runs = await pageAll<{ unit: string; lane: string; kept: number; run_at: string }>(
    (a, b) => supabase.from('source_health').select('unit,lane,kept,run_at').range(a, b),
    'source_health'
  );
  const latestRun = new Map<string, { kept: number; run_at: string }>();
  for (const r of runs) {
    // The unit is 'adapter:x' or 'source:x'; the source column on a lead is the
    // bare name. Match on the tail so the two vocabularies meet.
    const key = r.unit.includes(':') ? r.unit.slice(r.unit.indexOf(':') + 1) : r.unit;
    const prev = latestRun.get(key);
    if (!prev || r.run_at > prev.run_at) latestRun.set(key, { kept: r.kept, run_at: r.run_at });
  }

  type Agg = {
    records: number;
    projects: Set<string>;
    named: Set<string>;
    newestDoc: string | null;
    newestCap: string | null;
    sources: Set<string>;
  };
  const blank = (): Agg => ({
    records: 0,
    projects: new Set(),
    named: new Set(),
    newestDoc: null,
    newestCap: null,
    sources: new Set(),
  });

  const byMarket = new Map<string, Agg>();
  const bySource = new Map<string, Agg>();
  const sourceMarkets = new Map<string, Set<string>>();

  for (const r of records) {
    const doc = documentDate(r);
    const attached = r.project_id && live.has(r.project_id) ? r.project_id : null;

    if (r.market) {
      const e = byMarket.get(r.market) ?? blank();
      e.records++;
      if (r.source) e.sources.add(r.source);
      if (doc && (!e.newestDoc || doc > e.newestDoc)) e.newestDoc = doc;
      if (r.first_seen && (!e.newestCap || r.first_seen > e.newestCap)) e.newestCap = r.first_seen;
      if (attached) {
        e.projects.add(attached);
        if (namesAParty(r)) e.named.add(attached);
      }
      byMarket.set(r.market, e);
    }

    if (r.source) {
      const e = bySource.get(r.source) ?? blank();
      e.records++;
      if (doc && (!e.newestDoc || doc > e.newestDoc)) e.newestDoc = doc;
      if (r.first_seen && (!e.newestCap || r.first_seen > e.newestCap)) e.newestCap = r.first_seen;
      if (attached) e.projects.add(attached);
      bySource.set(r.source, e);
      if (r.market && isCoveredMarket(r.market)) {
        const m = sourceMarkets.get(r.source) ?? new Set<string>();
        m.add(coveredMarket(r.market)!.market);
        sourceMarkets.set(r.source, m);
      }
    }
  }

  const deadMarkets = new Set(DEAD_FEEDS.map((d) => d.market.toLowerCase()));
  // A MARKET IS DEGRADED WHEN ITS ADAPTER IS REGISTERED, and only then.
  //
  // The register keys on health UNITS, and the units are not all the same kind
  // of thing. 'adapter:lasvegas-agendas' names a LANE that is failing. The other
  // entry, 'cftod-pdf:CFTOD Notice of', names a single DOCUMENT that correctly
  // yields nothing - its own comment says so in as many words: "This is not a
  // degraded source; it is a document with nothing in it to keep."
  //
  // Matching on the source name alone read that as a broken adapter and marked
  // the Central Florida Tourism Oversight District degraded, which is both wrong
  // and the wrong KIND of wrong: it is 204 days stale, and the state that
  // matters was being hidden by one that does not apply. So only units in the
  // `adapter:` namespace count, which is the namespace that means a lane.
  const degradedAdapters = DEGRADED_SOURCES.filter((d) => d.unit.startsWith('adapter:')).map((d) =>
    d.unit.slice('adapter:'.length).toLowerCase()
  );
  const isDegraded = (m: CoveredMarket): boolean =>
    degradedAdapters.some(
      (u) =>
        u.includes(m.market.toLowerCase().replace(/\s+/g, '')) ||
        m.sources.some((s) => u.includes(s.toLowerCase()))
    );

  const markets: MarketCoverage[] = COVERED_MARKETS.map((m) => {
    const e = byMarket.get(m.market) ?? blank();
    const newestDocumentDays = daysSince(e.newestDoc);
    return {
      ...m,
      liveProjects: e.projects.size,
      projectsNamingAParty: e.named.size,
      records: e.records,
      newestDocument: e.newestDoc,
      newestDocumentDays,
      newestCapture: e.newestCap,
      newestCaptureDays: daysSince(e.newestCap),
      producingSources: [...e.sources].sort(),
      coverage: coverageFor({
        liveProjects: e.projects.size,
        projectsNamingAParty: e.named.size,
        records: e.records,
        newestDocumentDays,
        deadFeed: deadMarkets.has(m.market.toLowerCase()),
        degraded: isDegraded(m),
      }),
    };
  });

  const press: PressGeography[] = [...byMarket.entries()]
    .filter(([market]) => !isCoveredMarket(market))
    .map(([market, e]) => ({ market, liveProjects: e.projects.size, records: e.records }))
    .sort((a, b) => b.liveProjects - a.liveProjects || b.records - a.records || a.market.localeCompare(b.market));

  const sources: SourceHealth[] = [...bySource.entries()]
    .map(([source, e]) => {
      const run = latestRun.get(source) ?? null;
      const d = DEGRADED_SOURCES.find((x) => x.unit.toLowerCase().includes(source.toLowerCase()));
      return {
        source,
        records: e.records,
        newestDocument: e.newestDoc,
        newestDocumentDays: daysSince(e.newestDoc),
        newestCapture: e.newestCap,
        newestCaptureDays: daysSince(e.newestCap),
        recordsThisRun: run ? run.kept : null,
        lastRunAt: run ? run.run_at : null,
        degraded: d
          ? { reason: d.reason, recorded: d.recorded, alertsAgainWhen: d.alertsAgainWhen }
          : null,
        markets: [...(sourceMarkets.get(source) ?? [])].sort(),
      };
    })
    .sort(
      (a, b) =>
        (b.newestDocumentDays ?? -1) - (a.newestDocumentDays ?? -1) || a.source.localeCompare(b.source)
    );

  return {
    markets: markets.sort(
      (a, b) =>
        COVERAGE_RANK[a.coverage.state] - COVERAGE_RANK[b.coverage.state] ||
        b.liveProjects - a.liveProjects ||
        a.market.localeCompare(b.market)
    ),
    press,
    pressRecords: press.reduce((n, p) => n + p.records, 0),
    pressProjects: new Set(
      [...byMarket.entries()]
        .filter(([m]) => !isCoveredMarket(m))
        .flatMap(([, e]) => [...e.projects])
    ).size,
    sources,
    // One row is a table that exists, not a history. Until real lane runs
    // accumulate, "records this run" is unknowable for every lane but one, and
    // the screen says so rather than printing zeroes.
    hasRunHistory: runs.length > 1,
    liveProjects: live.size,
  };
}
