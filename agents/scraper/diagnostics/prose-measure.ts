// READ-ONLY. WHAT THE OAKLAND AND ANAHEIM READERS YIELD, PER FIELD, AND WHAT AN
// ENTRY GAINS.
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/prose-measure.ts <docdir> [--project <text>]
//
// Nothing is written. Same two numbers as Clark and New York - found, and
// verified by the no-invention guard - then the same entry comparison.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { verifyFilingFacts, filingFactsForEntry, filingFactLabel, type FilingFact, type FilingFactKind } from '../readers/core';
import { readOaklandFacts, isOaklandDocument } from '../readers/oakland-ordinance';
import { readAnaheimFacts, isAnaheimAgenda, isSpanishAgenda } from '../readers/anaheim-agenda';
import { isCodeAmendment } from '../readers/oakland-ordinance';

const DIR = process.argv[2];
const PROJECT = (() => { const i = process.argv.indexOf('--project'); return i > -1 ? process.argv[i + 1] : null; })();
if (!DIR) { console.error('usage: prose-measure.ts <docdir> [--project <text>]'); process.exit(1); }

interface Doc { file: string; jurisdiction: string; adapter: string; docName: string; url: string; leadId: string; pages: number; chars: number }
interface Lead { id: string; title: string | null; action_sought: string | null; project_id: string | null; status: string | null; published_date: string | null }
interface Proj { id: string; name: string; status: string | null; market: string | null; stage: string | null; primary_applicant: string | null; summary: string | null; summary_source: string | null }

const PAGE_MARK = /\n*-{4}PAGE-{4}\n*/g;
const manifest: Doc[] = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
const texts = new Map<string, string>();
for (const d of manifest) {
  try { texts.set(d.file, readFileSync(join(DIR, d.file), 'utf8').replace(PAGE_MARK, '\n')); } catch { /* skip */ }
}
const seenUrl = new Set<string>();
const readable = manifest
  .filter((d) => (texts.get(d.file) ?? '').replace(/\s/g, '').length >= 400)
  .filter((d) => (seenUrl.has(d.url) ? false : (seenUrl.add(d.url), true)));

const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(0) + '%' : '-');
const one = (s: string, n = 78) => s.replace(/\s+/g, ' ').trim().slice(0, n);

const LANES = [
  {
    name: 'Oakland',
    match: (d: Doc) => d.jurisdiction.includes('Oakland'),
    // MEASURED PER DOCUMENT: the reader is handed the text and nothing else,
    // because an Oakland ordinance is about one matter.
    read: (t: string) => readOaklandFacts(t),
    is: isOaklandDocument,
  },
  {
    name: 'Anaheim',
    match: (d: Doc) => d.jurisdiction.includes('Anaheim'),
    // MEASURED WITH allItems, because the per-field rate is a property of the
    // FORM. What reaches a project entry is selected by application number, and
    // that is measured separately in the entry pass below.
    read: (t: string) => readAnaheimFacts(t, { allItems: true }),
    is: isAnaheimAgenda,
  },
];

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

async function main(): Promise<void> {
  const leads = await pageAll<Lead>('leads', 'id,title,action_sought,project_id,status,published_date');
  const projects = await pageAll<Proj>('projects', 'id,name,status,market,stage,primary_applicant,summary,summary_source');
  const live = new Map(projects.filter((p) => p.status !== 'archived' && p.status !== 'deleted').map((p) => [p.id, p]));
  const leadById = new Map(leads.map((l) => [l.id, l]));

  for (const lane of LANES) {
    const docs = readable.filter(lane.match);
    const recognised = docs.filter((d) => lane.is(texts.get(d.file)!));
    const spanish = lane.name === 'Anaheim' ? docs.filter((d) => isSpanishAgenda(texts.get(d.file)!)) : [];
    console.log(`\n\n${'='.repeat(76)}\n${lane.name.toUpperCase()}\n${'='.repeat(76)}\n`);
    console.log(`readable documents          : ${docs.length}`);
    console.log(`  the reader recognises     : ${recognised.length}`);
    if (spanish.length) console.log(`  Spanish, skipped by design: ${spanish.length}`);

    const rows = new Map<FilingFactKind, { found: number; verified: number; ex: FilingFact | null }>();
    let refused = 0;
    const target = recognised.filter((d) => !(lane.name === 'Anaheim' && isSpanishAgenda(texts.get(d.file)!)));
    for (const d of target) {
      const t = texts.get(d.file)!;
      const facts = lane.read(t);
      const seen = new Set(facts.map((f) => f.kind));
      for (const f of facts) {
        const r = rows.get(f.kind) ?? { found: 0, verified: 0, ex: null };
        if (!r.ex) r.ex = f;
        rows.set(f.kind, r);
      }
      for (const k of seen) rows.get(k)!.found++;
      try {
        verifyFilingFacts(facts, t);
        for (const k of seen) rows.get(k)!.verified++;
      } catch (e) {
        refused++;
        console.error(`  REFUSED ${d.docName.slice(0, 36)}: ${String(e).slice(0, 140)}`);
      }
    }
    if (lane.name === 'Oakland') {
      const amendments = recognised.filter((d) => isCodeAmendment(texts.get(d.file)!));
      if (amendments.length) console.log(`  code amendments, refused   : ${amendments.length}`);
    }
    console.log(`  documents the reader reads: ${target.length}`);
    console.log(`  refused by the guard      : ${refused}\n`);
    console.log('field                    found  share  verif   example');
    for (const [k, r] of [...rows.entries()].sort((a, b) => b[1].found - a[1].found)) {
      console.log(
        `${k.padEnd(24)}${String(r.found).padStart(5)}${pct(r.found, target.length).padStart(7)}${String(r.verified).padStart(7)}   ` +
          `${r.ex ? one(`${r.ex.label}: ${r.ex.display}`, 74) : ''}`
      );
    }

    // ---- what a project entry gains ----------------------------------------
    const byProject = new Map<string, FilingFact[]>();
    for (const d of target) {
      const l = leadById.get(d.leadId);
      if (!l?.project_id || !live.has(l.project_id) || l.status === 'dismissed') continue;
      const t = texts.get(d.file)!;
      let facts: FilingFact[] = [];
      try {
        // THE ENTRY PASS IS NOT THE FIELD PASS. Anaheim selects the item the
        // record is actually about; anything else would put one project's
        // acreage under another's name.
        const read = lane.name === 'Anaheim'
          ? readAnaheimFacts(t, { application: `${l.title ?? ''} ${l.action_sought ?? ''}` })
          : lane.read(t);
        facts = verifyFilingFacts(read, t);
      } catch { continue; }
      if (!facts.length) continue;
      byProject.set(l.project_id, [...(byProject.get(l.project_id) ?? []), ...facts]);
    }
    const market = lane.name === 'Oakland' ? 'Oakland' : 'Anaheim';
    const inMarket = [...live.values()].filter((p) => (p.market ?? '') === market);
    const gaining = inMarket.filter((p) => (byProject.get(p.id) ?? []).length);
    console.log(`\nlive ${market} projects : ${inMarket.length}`);
    console.log(`  gain a verified fact  : ${gaining.length}  (${pct(gaining.length, inMarket.length)})`);

    const show = PROJECT
      ? inMarket.filter((p) => p.name.toLowerCase().includes(PROJECT.toLowerCase()))
      : gaining.sort((a, b) => byProject.get(b.id)!.length - byProject.get(a.id)!.length).slice(0, 1);
    for (const p of show) {
      const facts = byProject.get(p.id) ?? [];
      if (!facts.length) continue;
      console.log(`\n--- ${p.name} [${p.stage}] ---`);
      console.log(`  NOW  summary: ${p.summary_source === 'derived' && p.summary ? one(p.summary, 100) : '(none printable)'}`);
      console.log(`  NOW  applicant: ${p.primary_applicant ?? '(none)'}`);
      console.log('  WOULD ALSO CONTAIN:');
      for (const f of filingFactsForEntry(facts)) {
        console.log(`    [RECORD] ${filingFactLabel(f.kind).slice(0, 28).padEnd(30)}${one(f.display, 92)}`);
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
