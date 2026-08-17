// READ-ONLY. WHAT A CLARK COUNTY PROJECT ENTRY WOULD CONTAIN, AGAINST WHAT IT
// CONTAINS NOW.
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/entry-before-after.ts <docdir> [project substring]
//
// Nothing is written and nothing is printed to a client. This is the comparison
// that decides whether the reader is worth extending past Clark County, so it
// has to show the two entries side by side rather than a count of fields.
//
// BEFORE is built from the stored columns the report already reads. AFTER adds
// only what filing-facts verifies out of the documents those same records
// already point at. No new fetch, no new document, no party.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import {
  readFilingFacts, verifyFilingFacts, isClarkAgendaSheet, filingFactLabel,
  filingFactsForEntry, type FilingFact,
} from '../filing-facts';

const DIR = process.argv[2];
const WANT = process.argv[3] ?? '';
if (!DIR) { console.error('usage: entry-before-after.ts <docdir> [project substring]'); process.exit(1); }

interface Doc { file: string; jurisdiction: string; adapter: string; docName: string; url: string; leadId: string; pages: number; chars: number }
interface Lead {
  id: string; title: string | null; url: string | null; action_sought: string | null;
  applicant: string | null; representative: string | null; presented_by: string | null;
  contact_name: string | null; contact_email: string | null; contact_phone: string | null;
  published_date: string | null; project_id: string | null; status: string | null;
  primary_document_url: string | null; source: string | null; location: string | null;
}
interface Proj { id: string; name: string; status: string | null; market: string | null; stage: string | null; primary_applicant: string | null; primary_representative: string | null; summary: string | null; summary_source: string | null }

const PAGE_MARK = /\n*-{4}PAGE-{4}\n*/g;
const manifest: Doc[] = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
const textByUrl = new Map<string, string>();
for (const d of manifest) {
  if (textByUrl.has(d.url)) continue;
  try { textByUrl.set(d.url, readFileSync(join(DIR, d.file), 'utf8').replace(PAGE_MARK, '\n')); } catch { /* skip */ }
}
// Also key by lead, because a record's primary_document_url is the document the
// contact lane actually opened and is what a production read would re-open.
const docsByLead = new Map<string, Doc[]>();
for (const d of manifest) docsByLead.set(d.leadId, [...(docsByLead.get(d.leadId) ?? []), d]);

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

const ORDER = [
  'staff_recommendation', 'next_hearing', 'commission_action', 'board_action', 'held_to', 'tab_cac', 'protests',
  'apn', 'site_address', 'cross_streets', 'town', 'land_use_plan', 'zone',
  'site_acreage', 'project_type', 'existing_land_use', 'rooms', 'units', 'lots', 'density',
  'stories', 'height_feet', 'floor_area', 'unit_size', 'open_space', 'parking', 'sustainability',
  'condition',
];

async function main(): Promise<void> {
  const projects = await pageAll<Proj>('projects', 'id,name,status,market,stage,primary_applicant,primary_representative,summary,summary_source');
  const leads = await pageAll<Lead>(
    'leads',
    'id,title,url,action_sought,applicant,representative,presented_by,contact_name,contact_email,contact_phone,published_date,project_id,status,primary_document_url,source,location'
  );

  const live = projects.filter((p) => p.status !== 'archived' && p.status !== 'deleted' && (p.market ?? '').includes('Clark'));
  const targets = WANT
    ? live.filter((p) => p.name.toLowerCase().includes(WANT.toLowerCase()))
    : live;

  // ---- corpus-level first, so one entry is not mistaken for the market -------
  let projWithFacts = 0;
  const gained = new Map<string, number>();
  for (const p of live) {
    const recs = leads.filter((l) => l.project_id === p.id && l.status !== 'dismissed');
    const facts: FilingFact[] = [];
    for (const r of recs) {
      for (const d of docsByLead.get(r.id) ?? []) {
        const t = textByUrl.get(d.url);
        if (!t || !isClarkAgendaSheet(t)) continue;
        try { facts.push(...verifyFilingFacts(readFilingFacts(t), t)); } catch { /* refused */ }
      }
    }
    if (!facts.length) continue;
    projWithFacts++;
    for (const k of new Set(filingFactsForEntry(facts).map((f) => f.kind))) gained.set(k, (gained.get(k) ?? 0) + 1);
  }
  console.log('===== ACROSS CLARK COUNTY =====\n');
  console.log(`live Clark County projects            : ${live.length}`);
  console.log(`  gain at least one verified fact     : ${projWithFacts}  (${((projWithFacts / live.length) * 100).toFixed(0)}%)`);
  console.log('\nfield                     projects gaining it');
  for (const k of ORDER) {
    const n = gained.get(k) ?? 0;
    if (!n) continue;
    console.log(`${k.padEnd(26)}${String(n).padStart(5)}  of ${live.length}`);
  }

  // ---- the entries -----------------------------------------------------------
  for (const p of targets) {
    const recs = leads
      .filter((l) => l.project_id === p.id && l.status !== 'dismissed')
      .sort((a, b) => (a.published_date ?? '').localeCompare(b.published_date ?? ''));
    const facts: FilingFact[] = [];
    let sheets = 0;
    for (const r of recs) {
      for (const d of docsByLead.get(r.id) ?? []) {
        const t = textByUrl.get(d.url);
        if (!t || !isClarkAgendaSheet(t)) continue;
        sheets++;
        try { facts.push(...verifyFilingFacts(readFilingFacts(t), t)); } catch { /* refused */ }
      }
    }
    if (!facts.length && WANT === '') continue;

    console.log(`\n\n${'='.repeat(78)}`);
    console.log(`${p.name}   [${p.market} | ${p.stage}]`);
    console.log('='.repeat(78));

    console.log('\n--- WHAT THE ENTRY CONTAINS NOW ---\n');
    console.log(`  summary   : ${p.summary_source === 'derived' && p.summary ? p.summary.slice(0, 150) : '(none printable)'}`);
    console.log(`  applicant : ${p.primary_applicant ?? '(none)'}`);
    console.log(`  rep       : ${p.primary_representative ?? '(none)'}`);
    console.log(`  records   : ${recs.length}`);
    for (const r of recs.slice(0, 8)) {
      const text = (r.action_sought ?? r.title ?? '').replace(/\s+/g, ' ').slice(0, 96);
      console.log(`    [RECORD] ${r.published_date?.slice(0, 10) ?? 'no date'}  ${text}`);
    }

    console.log(`\n--- WHAT IT WOULD CONTAIN, from ${sheets} agenda sheet(s) already fetched ---\n`);
    const byKind = new Map<string, FilingFact[]>();
    for (const f of filingFactsForEntry(facts)) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f]);
    const seen = new Set<string>();
    for (const k of ORDER) {
      const list = byKind.get(k);
      if (!list) continue;
      if (k === 'condition') continue;
      for (const f of list) {
        const key = `${k}:${f.display}`;
        if (seen.has(key)) continue;
        seen.add(key);
        console.log(`    [RECORD] ${filingFactLabel(f.kind).padEnd(22)}${f.display.replace(/\s+/g, ' ').slice(0, 108)}`);
      }
    }
    const conds = byKind.get('condition') ?? [];
    if (conds.length) {
      const uniq = [...new Map(conds.map((c) => [c.display, c])).values()];
      console.log(`\n    [RECORD] conditions of approval: ${uniq.length}, by reviewing department`);
      const groups = new Map<string, FilingFact[]>();
      for (const c of uniq) groups.set(c.group ?? '(none)', [...(groups.get(c.group ?? '(none)') ?? []), c]);
      for (const [g, list] of groups) {
        console.log(`      ${g}  (${list.length})`);
        for (const c of list.slice(0, 3)) console.log(`        - ${c.display.replace(/\s+/g, ' ').slice(0, 104)}`);
        if (list.length > 3) console.log(`        ... ${list.length - 3} more`);
      }
    }
    if (!facts.length) console.log('    (no agenda sheet among this project\'s documents)');
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
