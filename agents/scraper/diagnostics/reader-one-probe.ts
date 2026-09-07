// READ-ONLY. WOULD READER 1 MOVE THE THREE PROJECTS THAT ARE LEFT?
//
//   node --env-file=.env.local --import tsx agents/scraper/diagnostics/reader-one-probe.ts
//
// Brief U item 3, reader 1: the Legistar attachment PDF reader. Nothing is
// written and no reader is built. The document is fetched and every EXISTING
// field set is run over it, guarded exactly as the write path guards them, so
// the answer is what a reader would actually produce rather than an estimate.
//
// ---------------------------------------------------------------------------
// WHY THREE DOCUMENTS AND NOT EIGHTY-SIX
// ---------------------------------------------------------------------------
//
// BRIEF-U-ITEM-4-READERS.md already fetched every non-Clark Legistar document in
// the corpus and ran all three field sets over them: Broward 86 documents / 183
// facts / 4 projects moved, Nashville 21 / 6 / 3, Oakland 14 / 12 / 2, Phoenix
// 22 / 0 / 0, Westchester 2 / 0 / 0. That measurement stands and is not repeated.
//
// What changed is the DENOMINATOR. The cleanout tombstoned 88 projects, 72 of
// them Broward, and the reader gap measured after it is 15 projects, of which
// exactly THREE are in a Legistar jurisdiction with no lane and hold a document
// that is a real file rather than a portal page. Those three are the whole of
// what reader 1 could still move, so those three are what is probed.
//
// A DOCUMENT THAT IS A LISTING PAGE IS NOT A DOCUMENT. Anaheim's gap projects
// carry Granicus AgendaViewer urls, which lib/document-shape calls a listing and
// has_primary_document already says false about. They are excluded here for that
// reason rather than counted and then found wanting.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { fetchPdfPages } from '../sources/pdf-agenda';
import { verifyFilingFacts, type FilingFact } from '../readers/core';
import { readFilingFacts, isClarkAgendaSheet } from '../readers/clark-agenda-sheet';
import { isClarkOrdinanceTitle, readOrdinanceTitleFacts } from '../readers/clark-ordinance-title';
import { readNycFacts, isNycRecord } from '../readers/nyc-records';
import { readOaklandFacts, isOaklandDocument, isCodeAmendment } from '../readers/oakland-ordinance';
import { documentShape } from '../../../lib/document-shape';

// The three, by project name. Named rather than derived so the probe is
// reproducible and so a reader of this file can see exactly what was tested.
const PROJECTS = [
  'Nashville Riverfront Amphitheater',
  '1222 Demonbreun Street',
  'Museum Of Jazz & Art',
  // The fourth in the gap for these jurisdictions, carried for contrast: it has
  // no document at all, so no reader can reach it and that is the finding.
  'KKR-Backed Stadium District Development Venture Launches In Nashville',
];

interface Row {
  project: string;
  market: string;
  title: string;
  url: string;
  chars: number;
  pages: number;
  clarkSheet: boolean;
  clarkTitle: boolean;
  nyc: boolean;
  oakland: boolean;
  facts: FilingFact[];
  refusedBy: string | null;
}

function runAll(text: string, title: string): { facts: FilingFact[]; by: string; refusedBy: string | null } {
  // Every reader's own recogniser, then its read, then the same guard the write
  // path runs. A read that fails the guard produces NOTHING, which is the
  // all-or-nothing contract readers/core states.
  const attempts: { name: string; recognises: boolean; read: () => FilingFact[] }[] = [
    { name: 'clark-agenda-sheet', recognises: isClarkAgendaSheet(text), read: () => readFilingFacts(text) },
    {
      name: 'clark-ordinance-title',
      recognises: !!isClarkOrdinanceTitle(title),
      read: () => readOrdinanceTitleFacts(title),
    },
    { name: 'nyc-records', recognises: !!isNycRecord(text), read: () => readNycFacts(text) },
    {
      name: 'oakland-ordinance',
      recognises: isOaklandDocument(text) && !isCodeAmendment(text),
      read: () => readOaklandFacts(text),
    },
  ];
  for (const a of attempts) {
    if (!a.recognises) continue;
    let facts: FilingFact[] = [];
    try {
      facts = a.read();
    } catch (e) {
      return { facts: [], by: a.name, refusedBy: `read threw: ${(e as Error).message.slice(0, 80)}` };
    }
    try {
      verifyFilingFacts(facts, text);
    } catch (e) {
      return { facts: [], by: a.name, refusedBy: `guard: ${(e as Error).message.slice(0, 120)}` };
    }
    if (facts.length) return { facts, by: a.name, refusedBy: null };
  }
  return { facts: [], by: 'none', refusedBy: null };
}

async function main(): Promise<void> {
  console.log('='.repeat(104));
  console.log('READER 1, THE LEGISTAR ATTACHMENT PDF READER: WHAT IS LEFT TO MOVE');
  console.log('='.repeat(104));

  const { data: projects, error } = await supabaseAdmin
    .from('projects')
    .select('id,name,market,status')
    .in('name', PROJECTS);
  if (error) throw new Error(error.message);

  const rows: Row[] = [];
  for (const p of (projects ?? []) as Record<string, unknown>[]) {
    if (String(p.status) === 'dismissed') continue;
    const { data: leads } = await supabaseAdmin
      .from('leads')
      .select('id,title,source,primary_document_url,has_primary_document,status,filing_facts')
      .eq('project_id', String(p.id));
    for (const l of (leads ?? []) as Record<string, unknown>[]) {
      if (String(l.status) === 'dismissed') continue;
      const url = l.primary_document_url ? String(l.primary_document_url) : '';
      const title = String(l.title ?? '');
      if (!url || documentShape(url) !== 'file') {
        console.log(`\n--- ${p.name} (${p.market}) ---`);
        console.log(`    ${url ? `${documentShape(url)} url, not a file: ${url.slice(0, 80)}` : 'NO DOCUMENT AT ALL'}`);
        console.log(`    No reader can reach this. It is a capture gap, not a parser gap.`);
        continue;
      }
      let text = '';
      let pages = 0;
      try {
        const doc = await fetchPdfPages(url);
        if (!doc || doc.length === 0) throw new Error('fetchPdfPages returned nothing');
        text = doc.join('\n');
        pages = doc.length;
      } catch (e) {
        console.log(`\n--- ${p.name} (${p.market}) ---`);
        console.log(`    FETCH FAILED: ${(e as Error).message.slice(0, 100)}`);
        continue;
      }
      const { facts, by, refusedBy } = runAll(text, title);
      rows.push({
        project: String(p.name),
        market: String(p.market),
        title,
        url,
        chars: text.length,
        pages,
        clarkSheet: isClarkAgendaSheet(text),
        clarkTitle: !!isClarkOrdinanceTitle(title),
        nyc: !!isNycRecord(text),
        oakland: isOaklandDocument(text) && !isCodeAmendment(text),
        facts,
        refusedBy,
      });
      console.log(`\n--- ${p.name} (${p.market}) ---`);
      console.log(`    ${pages} pages, ${text.length} characters of extractable text`);
      console.log(
        `    recognised by: clark-sheet=${isClarkAgendaSheet(text)} clark-title=${!!isClarkOrdinanceTitle(title)} ` +
          `nyc=${!!isNycRecord(text)} oakland=${isOaklandDocument(text) && !isCodeAmendment(text)}`
      );
      if (refusedBy) console.log(`    REFUSED: ${refusedBy}`);
      console.log(`    reader that fired: ${by}, ${facts.length} fact(s)`);
      for (const f of facts.slice(0, 12)) {
        console.log(`      [${f.kind}] ${f.display.replace(/\s+/g, ' ').slice(0, 70)}`);
      }
    }
  }

  console.log('');
  console.log('='.repeat(104));
  console.log('SUMMARY');
  console.log('='.repeat(104));
  console.log(`  documents fetched      : ${rows.length}`);
  console.log(`  with extractable text  : ${rows.filter((r) => r.chars > 200).length}`);
  console.log(`  image-only scans       : ${rows.filter((r) => r.chars <= 200).length}`);
  console.log(`  recognised by a reader : ${rows.filter((r) => r.clarkSheet || r.clarkTitle || r.nyc || r.oakland).length}`);
  console.log(`  facts extracted        : ${rows.reduce((n, r) => n + r.facts.length, 0)}`);
  console.log(
    `  CONDITIONS extracted   : ${rows.reduce((n, r) => n + r.facts.filter((f) => f.kind === 'condition').length, 0)}`
  );
  console.log(`  projects moved off zero: ${new Set(rows.filter((r) => r.facts.length > 0).map((r) => r.project)).size}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
