// READ-ONLY. WHAT THE NEW YORK READER YIELDS, PER FIELD, AND WHAT AN ENTRY GAINS.
//
//   node --env-file=.env.local --import tsx agents/scraper/diagnostics/nyc-measure.ts
//   ... --show <kind>       every value read for one field, for hand-checking
//   ... --project <text>    the before-and-after for one project
//
// Nothing is written. Same two numbers as Clark: found, and verified by the
// no-invention guard. Then the same entry comparison, because a per-field rate
// is not an answer to "what does a project entry gain".

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { verifyFilingFacts, filingFactsForEntry, filingFactLabel, type FilingFact, type FilingFactKind } from '../readers/core';
import { readNycFacts, isNycRecord } from '../readers/nyc-records';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
};
const SHOW = arg('show') as FilingFactKind | null;
const PROJECT = arg('project');

interface Lead {
  id: string; title: string | null; url: string | null; source: string | null;
  status: string | null; raw_content: string | null; project_id: string | null;
  applicant: string | null; action_sought: string | null; published_date: string | null;
}
interface Proj {
  id: string; name: string; status: string | null; market: string | null; stage: string | null;
  primary_applicant: string | null; summary: string | null; summary_source: string | null;
}

const ADAPTERS = ['nyc-zap', 'nyc-ceqr', 'nyc-city-record'];
const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(0) + '%' : '-');
const one = (s: string, n = 92) => s.replace(/\s+/g, ' ').trim().slice(0, n);

async function pageAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

const ORDER: FilingFactKind[] = [
  'nyc_status', 'nyc_milestone', 'nyc_milestone_date', 'nyc_filed', 'nyc_certified',
  'nyc_approved', 'nyc_completed', 'nyc_milestones', 'nyc_environmental_milestone',
  'next_hearing', 'nyc_notice_type', 'nyc_published',
  'nyc_review_type', 'nyc_ulurp', 'nyc_ceqr_number', 'nyc_ceqr_type', 'nyc_actions', 'nyc_agency',
  'nyc_borough', 'nyc_community_district', 'nyc_council_district', 'site_address', 'nyc_block_lot',
  'nyc_co_applicants', 'nyc_affordable', 'nyc_financing',
  'floor_area', 'units', 'rooms', 'seats', 'stories', 'parking', 'site_acreage',
];

async function main(): Promise<void> {
  const leads = (await pageAll<Lead>(
    'leads',
    'id,title,url,source,status,raw_content,project_id,applicant,action_sought,published_date'
  )).filter((l) => ADAPTERS.includes(l.source ?? '') && l.status !== 'dismissed');
  const projects = await pageAll<Proj>('projects', 'id,name,status,market,stage,primary_applicant,summary,summary_source');
  const live = new Map(
    projects.filter((p) => p.status !== 'archived' && p.status !== 'deleted').map((p) => [p.id, p])
  );

  console.log('===== THE SAMPLE =====\n');
  for (const a of ADAPTERS) {
    const n = leads.filter((l) => l.source === a).length;
    const recognised = leads.filter((l) => l.source === a && isNycRecord(l.raw_content ?? '')).length;
    console.log(`${a.padEnd(18)}${String(n).padStart(4)} records, ${recognised} recognised by the reader`);
  }

  // ---- per field ------------------------------------------------------------
  interface Row { found: number; verified: number; examples: FilingFact[] }
  const rows = new Map<FilingFactKind, Row>();
  const bump = (k: FilingFactKind): Row => {
    rows.set(k, rows.get(k) ?? { found: 0, verified: 0, examples: [] });
    return rows.get(k)!;
  };
  let refused = 0;
  const perAdapter = new Map<string, Map<FilingFactKind, number>>();

  for (const l of leads) {
    const text = l.raw_content ?? '';
    const facts = readNycFacts(text);
    if (!facts.length) continue;
    const seen = new Set(facts.map((f) => f.kind));
    for (const k of seen) bump(k).found++;
    for (const f of facts) {
      const r = bump(f.kind);
      if (r.examples.length < 8) r.examples.push(f);
    }
    perAdapter.set(l.source!, perAdapter.get(l.source!) ?? new Map());
    for (const k of seen) {
      const m = perAdapter.get(l.source!)!;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    try {
      verifyFilingFacts(facts, text);
      for (const k of seen) bump(k).verified++;
    } catch (e) {
      refused++;
      console.error(`  REFUSED ${(l.title ?? '').slice(0, 44)}: ${String(e).slice(0, 160)}`);
    }
  }

  console.log(`\n\n===== PER FIELD, OVER ${leads.length} NEW YORK RECORDS =====\n`);
  console.log(`records refused by the guard : ${refused}\n`);
  console.log('field                        found  share  verif   zap  ceqr   cityrec   example');
  for (const k of ORDER) {
    const r = rows.get(k);
    if (!r) continue;
    const z = perAdapter.get('nyc-zap')?.get(k) ?? 0;
    const c = perAdapter.get('nyc-ceqr')?.get(k) ?? 0;
    const cr = perAdapter.get('nyc-city-record')?.get(k) ?? 0;
    const ex = r.examples[0];
    console.log(
      `${k.padEnd(29)}${String(r.found).padStart(4)}${pct(r.found, leads.length).padStart(7)}${String(r.verified).padStart(7)}` +
        `${String(z).padStart(6)}${String(c).padStart(6)}${String(cr).padStart(10)}   ${ex ? one(`${ex.label}: ${ex.display}`, 62) : ''}`
    );
  }

  if (SHOW) {
    console.log(`\n\n===== EVERY VALUE READ FOR "${SHOW}" =====\n`);
    let n = 0;
    for (const l of leads) {
      for (const f of readNycFacts(l.raw_content ?? '').filter((x) => x.kind === SHOW)) {
        n++;
        console.log(`${String(n).padStart(3)}. [${l.source}] ${(l.title ?? '').slice(0, 42).padEnd(44)}${one(f.display, 90)}`);
      }
    }
    console.log(`\n${n} values.`);
  }

  // ---- what a project entry gains -------------------------------------------
  const byProject = new Map<string, FilingFact[]>();
  for (const l of leads) {
    if (!l.project_id || !live.has(l.project_id)) continue;
    const text = l.raw_content ?? '';
    let facts: FilingFact[] = [];
    try { facts = verifyFilingFacts(readNycFacts(text), text); } catch { continue; }
    if (!facts.length) continue;
    byProject.set(l.project_id, [...(byProject.get(l.project_id) ?? []), ...facts]);
  }
  const nycProjects = [...live.values()].filter((p) => (p.market ?? '') === 'New York City');

  console.log('\n\n===== WHAT A PROJECT ENTRY GAINS =====\n');
  console.log(`live New York City projects            : ${nycProjects.length}`);
  const gaining = nycProjects.filter((p) => (byProject.get(p.id) ?? []).length);
  console.log(`  gain at least one verified fact      : ${gaining.length}  (${pct(gaining.length, nycProjects.length)})`);
  const perField = new Map<FilingFactKind, number>();
  for (const p of gaining) {
    for (const k of new Set(filingFactsForEntry(byProject.get(p.id)!).map((f) => f.kind))) {
      perField.set(k, (perField.get(k) ?? 0) + 1);
    }
  }
  console.log('\nfield                        projects gaining it');
  for (const k of ORDER) {
    const n = perField.get(k) ?? 0;
    if (!n) continue;
    console.log(`${k.padEnd(29)}${String(n).padStart(4)}  of ${nycProjects.length}`);
  }

  const targets = PROJECT
    ? nycProjects.filter((p) => p.name.toLowerCase().includes(PROJECT.toLowerCase()))
    : gaining.sort((a, b) => (byProject.get(b.id)!.length - byProject.get(a.id)!.length)).slice(0, 2);

  for (const p of targets) {
    const facts = byProject.get(p.id) ?? [];
    const recs = leads.filter((l) => l.project_id === p.id);
    console.log(`\n\n${'='.repeat(78)}\n${p.name}   [${p.market} | ${p.stage}]\n${'='.repeat(78)}`);
    console.log('\n--- WHAT THE ENTRY CONTAINS NOW ---\n');
    console.log(`  summary   : ${p.summary_source === 'derived' && p.summary ? one(p.summary, 150) : '(none printable)'}`);
    console.log(`  applicant : ${p.primary_applicant ?? '(none)'}`);
    console.log(`  records   : ${recs.length}`);
    for (const r of recs.slice(0, 5)) {
      console.log(`    [RECORD] ${r.published_date?.slice(0, 10) ?? 'no date'}  ${one(r.action_sought ?? r.title ?? '', 88)}`);
    }
    console.log('\n--- WHAT IT WOULD CONTAIN, from text already captured ---\n');
    const entry = filingFactsForEntry(facts);
    for (const k of ORDER) {
      for (const f of entry.filter((x) => x.kind === k)) {
        console.log(`    [RECORD] ${filingFactLabel(f.kind).slice(0, 30).padEnd(32)}${one(f.display, 96)}`);
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
