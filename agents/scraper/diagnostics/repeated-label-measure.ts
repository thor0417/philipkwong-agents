// READ-ONLY. HOW MANY LIVE PROJECTS PRINT THE SAME LABEL TWICE WITH DIFFERENT
// VALUES?
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/repeated-label-measure.ts
//
// Nothing is written. Metropolitan Park prints "Current milestone" twice with
// different values, "Application filed" twice with different dates, "Latest
// environmental milestone" twice and "acres" twice for two different things -
// four self-contradictions on one page. Heart Hotel does not, because
// report-entry appends the matter to the label where a kind carries more than
// one value: "Project Type (UC-26-0219)" against "Project Type (TM-26-500056)".
//
// THE DISAMBIGUATOR NEEDS A MATTER AND NEW YORK HAS NONE. The suffix fires on
// `distinctByKind.get(kind).size > 1 && f.matter`, and `matter` is referenceOf()
// - a Clark County case number. A New York record carries no case reference, so
// the guard is silently false and the labels repeat.
//
// It calls the REAL buildEntry, so what it counts is what prints.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { LIVE_PIPELINE_STORAGE_KEY } from '../pipelines';
import { inCorpusScope } from '../../../lib/corpus-scope';
import { buildEntry } from '../../../dashboard/lib/report-entry';
import type { Project, TimelineRecord } from '../../../dashboard/lib/projects';

const PROJECT_COLUMNS =
  'id,module,name,project_key,country,region_state,market,stage,development_category,' +
  'venue_type,status,watch,notes,manual_overrides,first_seen,last_activity,next_milestone,' +
  'record_count,primary_applicant,primary_representative,created_at,summary,summary_source,' +
  'summary_url,name_source,significance,significance_detail,significance_computed_at,' +
  'stage_press_reported';

const RECORD_COLUMNS =
  'id,title,url,source,source_type,published_date,deadline,first_seen,date_source,' +
  'cluster_reason,status,applicant,representative,presented_by,action_sought,' +
  'contact_name,contact_email,contact_phone,primary_document_url,project_id,market,stream,' +
  'applicant_type,press_facts,filing_facts';

async function pageAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabaseAdmin.from(table).select(columns).range(from, from + 499);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...(data as T[]));
    if (data.length < 500) break;
  }
  return out;
}

async function main(): Promise<void> {
  const projects = await pageAll<Project>('projects', PROJECT_COLUMNS);
  const live = projects
    .filter((p) => p.module === LIVE_PIPELINE_STORAGE_KEY)
    .filter((p) => p.status !== 'dismissed')
    .filter((p) => inCorpusScope(p.country))
    .filter((p) => p.stage !== 'dormant');

  const leads = await pageAll<TimelineRecord & { project_id: string | null }>('leads', RECORD_COLUMNS);
  const byProject = new Map<string, TimelineRecord[]>();
  for (const l of leads) {
    if (l.status === 'dismissed' || !l.project_id) continue;
    if (!byProject.has(l.project_id)) byProject.set(l.project_id, []);
    byProject.get(l.project_id)!.push(l);
  }

  interface Hit { project: string; market: string | null; label: string; values: string[]; block: string }
  const hits: Hit[] = [];

  for (const p of live) {
    const records = (byProject.get(p.id) ?? []).filter((r) => !!r.url);
    if (records.length === 0) continue;
    const built = buildEntry(p, records, { partyRecords: records, cap: 500 });
    if (!built) continue;
    for (const [block, figures] of [['stated', built.entry.stated], ['press', built.entry.scale]] as const) {
      const byLabel = new Map<string, Set<string>>();
      for (const f of figures) {
        if (!byLabel.has(f.label)) byLabel.set(f.label, new Set());
        byLabel.get(f.label)!.add(f.display);
      }
      for (const [label, values] of byLabel) {
        if (values.size < 2) continue;
        hits.push({ project: p.name, market: p.market, label, values: [...values], block });
      }
    }
  }

  const affected = new Set(hits.map((h) => h.project));
  console.log('='.repeat(100));
  console.log(`A LABEL PRINTED TWICE WITH DIFFERENT VALUES   over ${live.length} live projects`);
  console.log('='.repeat(100));
  console.log(`  live projects affected: ${affected.size}`);
  console.log(`  repeated labels:        ${hits.length}`);
  console.log('');
  const byMarket = new Map<string, Set<string>>();
  for (const h of hits) {
    const m = String(h.market ?? '(none)');
    if (!byMarket.has(m)) byMarket.set(m, new Set());
    byMarket.get(m)!.add(h.project);
  }
  console.log('  affected projects by market:');
  for (const [m, s] of [...byMarket.entries()].sort((a, b) => b[1].size - a[1].size)) {
    console.log(`    ${String(s.size).padStart(3)}  ${m}`);
  }
  console.log('');
  console.log('-'.repeat(100));
  for (const h of hits) {
    console.log(`  ${h.project.slice(0, 34).padEnd(35)} ${h.block.padEnd(7)} ${h.label.slice(0, 30).padEnd(31)}`);
    for (const v of h.values) console.log(`        ${v.slice(0, 84)}`);
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
