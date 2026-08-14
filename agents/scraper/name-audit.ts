// WHAT SHAPE IS A PROVISIONAL NAME, AND WHAT WOULD A RULE COST?
//
//   npm run names:audit              group every title-sourced name by shape
//   npm run names:audit -- --list    and print every one of them
//   npm run names:audit -- --diff    recompute every project's name and diff
//
// name_source reads 'title' for a project whose name was assembled from a
// record title. This file measures that set: which shapes it holds, whether the
// records contain a better name for each shape, and - with --diff - exactly
// which projects the current rules would rename and to what.
//
// It never writes. The rename is migrations/rename-provisional-projects.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../lib/supabase-admin';
import { MAX_RECORDS_PER_ADDRESS, marketKey, siteKeys, type ClusterRecord } from './cluster';
import {
  deriveProjectName,
  disambiguateNames,
  isProvisionalName,
  orderedForNaming,
  type NameSource,
} from './project-naming';
import { classifyNameShape, SHAPE_LABELS, type NameShape } from './name-shape';

const LIST = process.argv.includes('--list');
const DIFF = process.argv.includes('--diff');

interface ProjectRow {
  id: string;
  name: string;
  name_source: string | null;
  market: string | null;
  region_state: string | null;
  project_key: string;
  venue_type: string | null;
  record_count: number | null;
  significance: number | null;
  stage: string | null;
  manual_overrides: unknown;
}

type Rec = ClusterRecord & { id: string; project_id: string };

const ID_CHUNK = 100;

const RECORD_COLUMNS =
  'id,project_id,url,title,raw_content,market,country,region_state,location,applicant,' +
  'representative,presented_by,source,source_type,status,cluster_reason,published_date,' +
  'deadline,first_seen,milestone_date,venue_type,development_category,stream';

export async function fetchProjects(): Promise<ProjectRow[]> {
  const out: ProjectRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('projects')
      .select(
        'id,name,name_source,market,region_state,project_key,venue_type,record_count,' +
          'significance,stage,manual_overrides'
      )
      .range(from, from + 999);
    if (error) throw new Error(`projects query failed: ${error.message}`);
    const rows = (data ?? []) as unknown as ProjectRow[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export async function fetchRecordsByProject(ids: string[]): Promise<Map<string, Rec[]>> {
  const out = new Map<string, Rec[]>();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select(RECORD_COLUMNS)
      .in('project_id', ids.slice(i, i + ID_CHUNK))
      .neq('status', 'dismissed');
    if (error) throw new Error(`records query failed: ${error.message}`);
    for (const r of (data ?? []) as unknown as Rec[]) {
      if (!out.has(r.project_id)) out.set(r.project_id, []);
      out.get(r.project_id)!.push(r);
    }
  }
  return out;
}

/** Oldest first, exactly as deriveProjectName orders them. */
export function oldestFirst(records: Rec[]): Rec[] {
  return orderedForNaming(records);
}

/**
 * Every live record, clustered or not. Used ONLY for the office-address counts.
 *
 * THE COUNT HAS TO BE OVER THE SAME SET THE CLUSTERER COUNTS OVER. It counts
 * addresses across the whole run, unclustered records included; an audit
 * counting only records attached to a project sees a law firm's address on
 * three rows where the run saw five, so it stays under MAX_RECORDS_PER_ADDRESS
 * and the naming rule is handed a site the run would have dropped. Two of the
 * renames this file reported were exactly that and nothing else - a diff
 * against a rule that had not changed.
 */
export async function fetchAllLiveRecords(): Promise<Rec[]> {
  const out: Rec[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select(RECORD_COLUMNS)
      .neq('status', 'dismissed')
      .range(from, from + 999);
    if (error) throw new Error(`records query failed: ${error.message}`);
    const rows = (data ?? []) as unknown as Rec[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/** The addresses the clusterer would drop as offices, keyed market:addr. */
export function officeAddresses(all: Rec[]): Set<string> {
  const counts = new Map<string, number>();
  for (const r of all) {
    const market = marketKey(r);
    for (const s of siteKeys(r)) {
      if (!s.startsWith('addr:')) continue;
      const k = `${market}:${s}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const out = new Set<string>();
  for (const [k, n] of counts) if (n > MAX_RECORDS_PER_ADDRESS) out.add(k);
  return out;
}

/**
 * What the naming rules would produce for this project today.
 *
 * The target name is taken from the STORED name when the stored source says
 * 'target': targets.ts is keyed by market and term, and re-deriving it here
 * would be a second implementation of a rule this file exists to measure.
 */
export function recomputed(
  p: ProjectRow,
  records: Rec[],
  offices: Set<string>
): { name: string; source: NameSource } {
  return deriveProjectName({
    targetName: p.name_source === 'target' ? p.name : null,
    records,
    venueType: p.venue_type,
    siteKeysByRecord: records.map((r) => {
      const market = marketKey(r);
      return siteKeys(r).filter((s) => !offices.has(`${market}:${s}`));
    }),
  });
}

/** Printable case or bill numbers on a project's records, for disambiguation. */
const CASE_RE = /\b(?:[A-Z]{2,4}-\d{2}-\d{3,6}|\d{2}-\d{3,6}(?:-[A-Z]{2,5}\d?)?|R[SB]\d{4}-\d{3,4})\b/;

export function caseNumbersOf(records: Rec[]): string[] {
  const out: string[] = [];
  for (const r of records) {
    const m = CASE_RE.exec(String(r.title ?? ''));
    if (m) out.push(m[0]);
  }
  return out;
}

function marketOf(p: ProjectRow): string {
  return p.market ?? p.region_state ?? '(no market)';
}

async function main(): Promise<void> {
  const projects = await fetchProjects();
  const byProject = await fetchRecordsByProject(projects.map((p) => p.id));

  const provisional = projects.filter((p) => isProvisionalName(p.name_source));
  console.log(`projects: ${projects.length}`);
  const sources = new Map<string, number>();
  for (const p of projects) sources.set(String(p.name_source), (sources.get(String(p.name_source)) ?? 0) + 1);
  console.log(
    'stored name_source: ' +
      [...sources.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')
  );
  console.log(`provisional (name_source 'title' or null): ${provisional.length}`);
  console.log('');

  // ---- SHAPES -----------------------------------------------------------
  const shapes = new Map<NameShape, ProjectRow[]>();
  const shapeOf = new Map<string, NameShape>();
  for (const p of provisional) {
    const records = oldestFirst(byProject.get(p.id) ?? []);
    const first = records[0];
    const shape = classifyNameShape({
      name: p.name,
      sourceTitle: first?.title ?? null,
      recordSource: first?.source ?? null,
      stream: first?.stream ?? null,
      projectKey: p.project_key,
      hasProgramme: records.some((r) => /^[ \t]*Project:[ \t]*\S/im.test(`${r.raw_content ?? ''}`)),
    });
    shapeOf.set(p.id, shape);
    if (!shapes.has(shape)) shapes.set(shape, []);
    shapes.get(shape)!.push(p);
  }

  const ordered = [...shapes.entries()].sort((a, b) => b[1].length - a[1].length);
  console.log('BY SHAPE');
  for (const [shape, ps] of ordered) {
    console.log(`  ${String(ps.length).padStart(3)}  ${SHAPE_LABELS[shape]}`);
  }
  console.log('');
  console.log('BY MARKET');
  const byMarket = new Map<string, number>();
  for (const p of provisional) byMarket.set(marketOf(p), (byMarket.get(marketOf(p)) ?? 0) + 1);
  for (const [m, n] of [...byMarket.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    console.log(`  ${String(n).padStart(3)}  ${m}`);
  }
  console.log('');

  if (LIST) {
    for (const [shape, ps] of ordered) {
      console.log(`--- ${SHAPE_LABELS[shape]} (${ps.length}) ---`);
      for (const p of ps) {
        const records = oldestFirst(byProject.get(p.id) ?? []);
        console.log(`  [${marketOf(p)}] ${p.name}`);
        console.log(`      from: ${String(records[0]?.title ?? '(none)').replace(/\s+/g, ' ').slice(0, 170)}`);
      }
      console.log('');
    }
  }

  if (!DIFF) return;

  // ---- WHAT THE RULES WOULD DO ------------------------------------------
  //
  // Every project, not only the provisional ones: a rule that improves 40 names
  // and quietly moves 200 others is not an improvement, and the only way to know
  // is to recompute the whole register.
  const offices = officeAddresses(await fetchAllLiveRecords());
  const derived = projects.map((p) => {
    const records = oldestFirst(byProject.get(p.id) ?? []);
    return { p, records, next: records.length ? recomputed(p, records, offices) : null };
  });

  // THE SAME DISAMBIGUATION PASS THE CLUSTERER RUNS. Without it the audit
  // reports the loss of a suffix as a rename: the two Las Vegas 2050 Master Plan
  // amendments are stored as "... (25-0002)" and "... (25-0594)", and a bare
  // deriveProjectName returns the same string for both.
  const withNames = derived.filter((d) => d.next);
  const moves = disambiguateNames(
    withNames.map((d) => ({
      name: d.next!.name,
      market: d.p.market ?? d.p.region_state ?? null,
      project_key: d.p.project_key,
      caseNumbers: caseNumbersOf(d.records),
      date: null,
    }))
  );
  for (const m of moves) withNames[m.index].next!.name = m.to;

  const changed: { p: ProjectRow; to: string; source: NameSource; shape: NameShape | null }[] = [];
  const sourceMoves = new Map<string, number>();
  for (const { p, next } of derived) {
    if (!next) continue;
    if (next.source !== p.name_source) {
      const k = `${p.name_source} -> ${next.source}`;
      sourceMoves.set(k, (sourceMoves.get(k) ?? 0) + 1);
    }
    if (next.name.trim() !== p.name.trim()) {
      changed.push({ p, to: next.name, source: next.source, shape: shapeOf.get(p.id) ?? null });
    }
  }

  console.log(`RENAMES: ${changed.length} of ${projects.length} projects`);
  console.log('name_source moves:');
  for (const [k, n] of [...sourceMoves.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${k}`);
  }
  console.log('');
  const byMarketChanged = new Map<string, typeof changed>();
  for (const c of changed) {
    const m = marketOf(c.p);
    if (!byMarketChanged.has(m)) byMarketChanged.set(m, []);
    byMarketChanged.get(m)!.push(c);
  }
  for (const [m, cs] of [...byMarketChanged.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`### ${m} (${cs.length})`);
    for (const c of cs) {
      console.log(`  BEFORE  ${c.p.name}`);
      console.log(`  AFTER   ${c.to}   [${c.p.name_source} -> ${c.source}]`);
    }
    console.log('');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
