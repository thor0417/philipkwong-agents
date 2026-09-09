// READ-ONLY. TWO CLOSED QUESTIONS, MEASURED RATHER THAN ASSUMED.
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/attachment-text-and-conditions.ts [--fetch]
//
// Nothing is written. Without --fetch it counts what is stored; with --fetch it
// pulls every attachment and measures the text layer, which is the only way to
// answer either question.
//
// ---------------------------------------------------------------------------
// QUESTION 1. DO LEGISTAR ATTACHMENTS CARRY CONDITIONS ANYWHERE?
// ---------------------------------------------------------------------------
//
// This was an assumption for two weeks: that a generic Legistar attachment
// reader would eventually reach conditions of approval the way Clark's does.
// Clark carries 1,257 condition facts and every other source carries zero, and
// the reason matters. Clark's come from `clark-agenda-sheet`, a reader written
// against ONE county's administrative form, which happens to be delivered as a
// Legistar attachment. They do not come from the attachment lane, and a lane
// that fetched every attachment in every jurisdiction would not find them.
//
// So every non-Clark attachment is fetched and run through all three existing
// field sets, and the condition count is reported per jurisdiction WITH THE
// TEXT, because a count of 23 that turns out to be sentence fragments is a
// different answer from a count of 23 obligations.
//
// ---------------------------------------------------------------------------
// QUESTION 2. HOW MANY ATTACHMENTS HAVE NO TEXT LAYER AT ALL?
// ---------------------------------------------------------------------------
//
// Golden case a-scanned-page-counted-as-a-document-we-hold recorded 13 of 37 on
// a smaller sample. The corpus has moved twice since - the document repair, then
// the cleanout - so the number is re-taken here over the whole set rather than
// carried forward. A scanned page is not a reader problem: OCR is its own build
// and no field set can touch it.
//
// THE THRESHOLD IS STATED. A PDF with a text layer yields thousands of
// characters; a scan yields a handful of stray glyphs from a stamp or a header.
// 200 characters is the line, and every document near it is printed so the line
// can be checked rather than trusted.

import { pathToFileURL } from 'node:url';
import { selectAllPaged } from '../page-select';
import { fetchPdfPages } from '../sources/pdf-agenda';
import { verifyFilingFacts, type FilingFact } from '../readers/core';
import { readFilingFacts, isClarkAgendaSheet } from '../readers/clark-agenda-sheet';
import { isClarkOrdinanceTitle, readOrdinanceTitleFacts } from '../readers/clark-ordinance-title';
import { readNycFacts, isNycRecord } from '../readers/nyc-records';
import { readOaklandFacts, isOaklandDocument, isCodeAmendment } from '../readers/oakland-ordinance';
import { documentShape } from '../../../lib/document-shape';

const TEXT_FLOOR = 200;

type Row = Record<string, unknown>;
const tidy = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();

interface Measured {
  /** Is this attachment on a project the register still holds? */
  onLiveProject: boolean;
  jurisdiction: string;
  title: string;
  url: string;
  pages: number;
  chars: number;
  facts: FilingFact[];
  conditions: FilingFact[];
  readBy: string;
}

function runAll(text: string, title: string): { facts: FilingFact[]; by: string } {
  const attempts: { name: string; ok: boolean; read: () => FilingFact[] }[] = [
    { name: 'clark-agenda-sheet', ok: isClarkAgendaSheet(text), read: () => readFilingFacts(text) },
    { name: 'clark-ordinance-title', ok: !!isClarkOrdinanceTitle(title), read: () => readOrdinanceTitleFacts(title) },
    { name: 'nyc-records', ok: !!isNycRecord(text), read: () => readNycFacts(text) },
    {
      name: 'oakland-ordinance',
      ok: isOaklandDocument(text) && !isCodeAmendment(text),
      read: () => readOaklandFacts(text),
    },
  ];
  for (const a of attempts) {
    if (!a.ok) continue;
    let facts: FilingFact[] = [];
    try {
      facts = a.read();
      verifyFilingFacts(facts, text);
    } catch {
      return { facts: [], by: `${a.name} (refused by the guard)` };
    }
    if (facts.length) return { facts, by: a.name };
  }
  return { facts: [], by: 'none' };
}

async function main(): Promise<void> {
  const doFetch = process.argv.includes('--fetch');

  const { rows, complete } = await selectAllPaged<Row>(
    'leads',
    'id,title,source,location,market,status,lifecycle,primary_document_url,has_primary_document,filing_facts,project_id',
    (q) => q,
    'attachments'
  );
  if (!complete) throw new Error('read was partial; refusing to answer either question on a slice.');

  const legistar = rows.filter(
    (r) =>
      String(r.source) === 'legistar' &&
      String(r.status) !== 'dismissed' &&
      !!r.primary_document_url &&
      documentShape(String(r.primary_document_url)) === 'file'
  );
  const nonClark = legistar.filter((r) => !tidy(r.location).includes('Clark'));
  const clark = legistar.filter((r) => tidy(r.location).includes('Clark'));

  console.log('='.repeat(104));
  console.log('LEGISTAR ATTACHMENTS: THE TEXT LAYER, AND WHERE CONDITIONS ACTUALLY COME FROM');
  console.log('='.repeat(104));
  console.log('POPULATION: leads.source=legistar, status<>dismissed, primary_document_url is a FILE');
  console.log('by lib/document-shape. Paged to exhaustion, no cap.');
  console.log('');
  // TWO POPULATIONS, AND THE DIFFERENCE IS THE CLEANOUT. A record attached to a
  // TOMBSTONED project is still an undismissed record - nothing was deleted - so
  // a count of attachments and a count of attachments that can still reach a
  // client document are different numbers. Both are printed, because ranking a
  // reader on the first would rank it on documents belonging to projects the
  // register no longer holds.
  const { rows: projectRows } = await selectAllPaged<Row>(
    'projects',
    'id,status',
    (q) => q,
    'attachment-projects'
  );
  const liveProjects = new Set(
    projectRows.filter((p) => String(p.status) !== 'dismissed').map((p) => String(p.id))
  );
  const onLive = (r: Row): boolean => !!r.project_id && liveProjects.has(String(r.project_id));

  console.log(`  attachments, all jurisdictions : ${legistar.length}`);
  console.log(`  Clark County                   : ${clark.length}`);
  console.log(`  every other jurisdiction       : ${nonClark.length}`);
  console.log('');
  console.log(`  of those non-Clark attachments, ON A PROJECT THE REGISTER STILL HOLDS:`);
  console.log(`    ${nonClark.filter(onLive).length} of ${nonClark.length}`);
  console.log('    per jurisdiction:');
  for (const j of [...new Set(nonClark.map((r) => tidy(r.location) || '(no location)'))].sort()) {
    const all = nonClark.filter((r) => (tidy(r.location) || '(no location)') === j);
    console.log(`      ${j.slice(0, 26).padEnd(27)} ${String(all.filter(onLive).length).padStart(4)} of ${String(all.length).padStart(4)}`);
  }
  console.log('');

  // ---- STORED CONDITIONS, BEFORE ANYTHING IS FETCHED ----------------------
  console.log('-'.repeat(104));
  console.log('CONDITIONS AS STORED, per jurisdiction. This is what the corpus holds today.');
  console.log('-'.repeat(104));
  const byJur = new Map<string, { docs: number; facts: number; conditions: number }>();
  for (const r of legistar) {
    const j = tidy(r.location) || '(no location)';
    if (!byJur.has(j)) byJur.set(j, { docs: 0, facts: 0, conditions: 0 });
    const a = byJur.get(j)!;
    a.docs++;
    const f = r.filing_facts;
    if (Array.isArray(f)) {
      a.facts += f.length;
      a.conditions += f.filter((x) => (x as { kind?: string })?.kind === 'condition').length;
    }
  }
  console.log('  jurisdiction                    attachments    facts   conditions');
  for (const [j, a] of [...byJur.entries()].sort((x, y) => y[1].conditions - x[1].conditions || y[1].docs - x[1].docs)) {
    console.log(`  ${j.slice(0, 30).padEnd(31)} ${String(a.docs).padStart(11)} ${String(a.facts).padStart(8)} ${String(a.conditions).padStart(12)}`);
  }

  if (!doFetch) {
    console.log('');
    console.log('Re-run with --fetch to measure the text layer and run the readers.');
    return;
  }

  // ---- FETCH EVERY NON-CLARK ATTACHMENT -----------------------------------
  //
  // CLARK IS EXCLUDED FROM THE FETCH and that is deliberate: it is already read,
  // its yield is on file, and re-fetching 300 documents to confirm a number this
  // repo already has is cost with no answer attached. The question is about the
  // OTHER jurisdictions.
  console.log('');
  console.log('-'.repeat(104));
  console.log(`FETCHING ${nonClark.length} NON-CLARK ATTACHMENTS. Clark excluded: already read, yield on file.`);
  console.log('-'.repeat(104));

  const measured: Measured[] = [];
  const failed: { url: string; why: string }[] = [];
  let done = 0;
  for (const r of nonClark) {
    const url = String(r.primary_document_url);
    const title = tidy(r.title);
    const jur = tidy(r.location) || '(no location)';
    try {
      const pages = await fetchPdfPages(url);
      if (!pages) throw new Error('fetchPdfPages returned nothing');
      const text = pages.join('\n');
      const { facts, by } = runAll(text, title);
      measured.push({
        onLiveProject: onLive(r),
        jurisdiction: jur,
        title,
        url,
        pages: pages.length,
        chars: text.length,
        facts,
        conditions: facts.filter((f) => f.kind === 'condition'),
        readBy: by,
      });
    } catch (e) {
      failed.push({ url, why: String((e as Error).message).slice(0, 70) });
    }
    if (++done % 20 === 0) console.error(`  ...${done}/${nonClark.length}`);
  }

  console.log('');
  console.log('-'.repeat(104));
  console.log(`THE TEXT LAYER. A document under ${TEXT_FLOOR} characters has no drawable text worth reading.`);
  console.log('-'.repeat(104));
  console.log('  jurisdiction                    fetched   with text   NO TEXT   median chars   fetch failed');
  const jurs = [...new Set(measured.map((m) => m.jurisdiction))].sort();
  for (const j of jurs) {
    const ms = measured.filter((m) => m.jurisdiction === j);
    const withText = ms.filter((m) => m.chars >= TEXT_FLOOR);
    const noText = ms.filter((m) => m.chars < TEXT_FLOOR);
    const med = [...ms.map((m) => m.chars)].sort((a, b) => a - b)[Math.floor(ms.length / 2)] ?? 0;
    const f = failed.length;
    console.log(
      `  ${j.slice(0, 30).padEnd(31)} ${String(ms.length).padStart(7)} ${String(withText.length).padStart(11)} ` +
        `${String(noText.length).padStart(9)} ${String(med).padStart(14)} ${String(f).padStart(14)}`
    );
  }
  const live = measured.filter((m) => m.onLiveProject);
  console.log(
    `  ${'of which on a live project'.padEnd(31)} ${String(live.length).padStart(7)} ` +
      `${String(live.filter((m) => m.chars >= TEXT_FLOOR).length).padStart(11)} ` +
      `${String(live.filter((m) => m.chars < TEXT_FLOOR).length).padStart(9)}`
  );
  const allNoText = measured.filter((m) => m.chars < TEXT_FLOOR);
  console.log(
    `  ${'TOTAL'.padEnd(31)} ${String(measured.length).padStart(7)} ` +
      `${String(measured.filter((m) => m.chars >= TEXT_FLOOR).length).padStart(11)} ` +
      `${String(allNoText.length).padStart(9)}`
  );
  if (failed.length) {
    console.log('');
    console.log(`  ${failed.length} FETCH FAILED:`);
    for (const f of failed.slice(0, 10)) console.log(`    ${f.why}  ${f.url.slice(0, 70)}`);
  }

  console.log('');
  console.log('  EVERY DOCUMENT WITHIN 10x OF THE THRESHOLD, so the line can be checked:');
  for (const m of measured.filter((x) => x.chars < TEXT_FLOOR * 10).sort((a, b) => a.chars - b.chars)) {
    console.log(`    ${String(m.chars).padStart(6)} chars / ${String(m.pages).padStart(3)} pages  ${m.jurisdiction.slice(0, 20).padEnd(21)} ${m.title.slice(0, 44)}`);
  }

  console.log('');
  console.log('-'.repeat(104));
  console.log('CONDITIONS THE EXISTING READERS WOULD EXTRACT FROM A NON-CLARK ATTACHMENT');
  console.log('-'.repeat(104));
  const withConditions = measured.filter((m) => m.conditions.length > 0);
  console.log(`  documents yielding a condition : ${withConditions.length} of ${measured.length}`);
  console.log(`  condition facts in total       : ${measured.reduce((n, m) => n + m.conditions.length, 0)}`);
  console.log('');
  if (withConditions.length === 0) {
    console.log('  NONE. Not one non-Clark Legistar attachment yields a condition through any');
    console.log('  existing reader. Clark\'s 1,257 come from clark-agenda-sheet, a reader written');
    console.log('  against one county\'s administrative form, and not from the attachment lane.');
  } else {
    console.log('  EVERY ONE, IN FULL, so a count can be judged rather than trusted:');
    for (const m of withConditions) {
      console.log(`\n    ${m.jurisdiction} - ${m.title.slice(0, 60)}  [${m.readBy}]`);
      for (const c of m.conditions.slice(0, 8)) {
        console.log(`      "${c.display.replace(/\s+/g, ' ').slice(0, 88)}"`);
      }
      if (m.conditions.length > 8) console.log(`      (+${m.conditions.length - 8} more)`);
    }
  }

  console.log('');
  console.log('-'.repeat(104));
  console.log('AND WHAT THE READERS DID REACH, per jurisdiction');
  console.log('-'.repeat(104));
  console.log('  jurisdiction                    reached   facts   readers that fired');
  for (const j of jurs) {
    const ms = measured.filter((m) => m.jurisdiction === j);
    const hit = ms.filter((m) => m.facts.length > 0);
    const readers = [...new Set(hit.map((m) => m.readBy))].join(', ') || '-';
    console.log(
      `  ${j.slice(0, 30).padEnd(31)} ${String(hit.length).padStart(7)} ` +
        `${String(ms.reduce((n, m) => n + m.facts.length, 0)).padStart(7)}   ${readers}`
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
