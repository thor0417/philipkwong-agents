// READ-ONLY. READER 2, LAS VEGAS PRIMEGOV: WHAT IS ALREADY HERE, AND WHAT IS NOT.
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/reader-two-probe.ts
//
// Nothing is written and nothing is fetched from PrimeGov, which is the point:
// lasvegas.primegov.com answers 403 to this machine and a probe from here would
// measure the connection rather than the source. What CAN be measured from here
// is what the corpus already holds, and that turns out to be the more useful
// half.
//
// ---------------------------------------------------------------------------
// THE ADAPTER ALREADY STORES THE AGENDA TEXT. THE READER QUESTION IS SEPARATE
// FROM THE EGRESS QUESTION.
// ---------------------------------------------------------------------------
//
// sources/lasvegas.ts fetches each meeting's HTML agenda, splits it into items
// through the shared agenda-portal helpers, and stores each item's full text in
// `raw_content`. `primary_document_url` is set to the MEETING page, which
// lib/document-shape correctly calls a listing rather than a file, so every
// count of "Las Vegas documents held" is zero and always has been.
//
// That means two different things were being called "reader 2":
//
//   THE READ    running a field set over text the corpus already holds. Needs
//               no network at all, and is measured here.
//   THE CAPTURE reaching PrimeGov for the staff report behind an item. Needs the
//               hosted runner, and cannot be measured from here at all.
//
// The Clark re-run of 2026-09-07 is the precedent: the reader existed, the text
// existed, and nobody had run one over the other. So the first question asked
// here is whether Las Vegas is in that position too.

import { pathToFileURL } from 'node:url';
import { selectAllPaged } from '../page-select';
import { verifyFilingFacts, type FilingFact } from '../readers/core';
import { readFilingFacts, isClarkAgendaSheet } from '../readers/clark-agenda-sheet';
import { isClarkOrdinanceTitle, readOrdinanceTitleFacts } from '../readers/clark-ordinance-title';
import { readNycFacts, isNycRecord } from '../readers/nyc-records';
import { readOaklandFacts, isOaklandDocument, isCodeAmendment } from '../readers/oakland-ordinance';
import { readAnaheimFacts, isAnaheimAgenda, isSpanishAgenda } from '../readers/anaheim-agenda';
import { documentShape } from '../../../lib/document-shape';

type Row = Record<string, unknown>;
const tidy = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();

// Every reader in the tree, run against Las Vegas agenda text, with its own
// recogniser first and the same all-or-nothing guard the write path applies.
function runAll(text: string, title: string): { facts: FilingFact[]; by: string; refused: string | null } {
  const attempts: { name: string; ok: boolean; read: () => FilingFact[] }[] = [
    { name: 'clark-agenda-sheet', ok: isClarkAgendaSheet(text), read: () => readFilingFacts(text) },
    { name: 'clark-ordinance-title', ok: !!isClarkOrdinanceTitle(title), read: () => readOrdinanceTitleFacts(title) },
    { name: 'nyc-records', ok: !!isNycRecord(text), read: () => readNycFacts(text) },
    {
      name: 'oakland-ordinance',
      ok: isOaklandDocument(text) && !isCodeAmendment(text),
      read: () => readOaklandFacts(text),
    },
    // ANAHEIM IS THE INTERESTING ONE. Las Vegas and Anaheim are captured by the
    // SAME agenda-portal helpers into the same item shape, so if any existing
    // reader transfers it is this one. That is a hypothesis and it is tested
    // here rather than assumed, which is what the clark-ordinance-title claim
    // ("the most transferable idea in the reader set") failed at.
    {
      name: 'anaheim-agenda',
      ok: isAnaheimAgenda(text) && !isSpanishAgenda(text),
      read: () => readAnaheimFacts(text),
    },
  ];
  for (const a of attempts) {
    if (!a.ok) continue;
    let facts: FilingFact[] = [];
    try {
      facts = a.read();
      verifyFilingFacts(facts, text);
    } catch (e) {
      return { facts: [], by: a.name, refused: String((e as Error).message).slice(0, 100) };
    }
    if (facts.length) return { facts, by: a.name, refused: null };
  }
  return { facts: [], by: 'none', refused: null };
}

// The vocabulary a Clark agenda sheet is recognised by, counted on Las Vegas
// text so the DISTANCE between the two forms is a number rather than a verdict.
const CLARK_MARKERS: [string, RegExp][] = [
  ['APP. NUMBER/OWNER heading', /APP\.?\s*NUMBER\s*\/\s*OWNER/i],
  ['PRELIMINARY STAFF CONDITIONS', /PRELIMINARY STAFF CONDITIONS/i],
  ['CONDITIONS OF APPROVAL', /CONDITIONS OF APPROVAL/i],
  ['STAFF RECOMMENDATION', /STAFF RECOMMENDATION/i],
  ['a case number like UC-26-0219', /\b[A-Z]{2,3}-\d{2}-\d{3,4}\b/],
  ['acreage phrase', /\b[\d.,]+\s*acres?\b/i],
  ['a zone in parentheses', /\([A-Z]{1,3}\)\s*Zone/i],
  ['TAB/CAC', /\b(TAB|CAC)\b/],
];

// What a Las Vegas item actually looks like, sized without reading a name.
const LV_MARKERS: [string, RegExp][] = [
  ['SUP / special use permit', /special use permit|\bSUP\b/i],
  ['ZON / rezoning', /\bZON-\d|rezon/i],
  ['SDR / site development review', /\bSDR-\d|site development review/i],
  ['VAR / variance', /\bVAR-\d|variance/i],
  ['GPA / general plan amendment', /\bGPA-\d|general plan amendment/i],
  ['ABEYANCE', /abeyance/i],
  ['a case number like 24-0495-SUP1', /\b\d{2}-\d{4}-[A-Z]{2,4}\d?\b/],
  ['APPLICANT:', /APPLICANT\s*:/i],
  ['staff recommends', /staff recommend/i],
  ['conditions', /\bconditions?\b/i],
];

async function main(): Promise<void> {
  const { rows, complete } = await selectAllPaged<Row>(
    'leads',
    'id,title,url,source,location,market,status,raw_content,primary_document_url,has_primary_document,' +
      'filing_facts,project_id,applicant,representative,presented_by,contact_name,action_sought',
    (q) => q,
    'reader-two'
  );
  if (!complete) throw new Error('read was partial; refusing to rank a reader on a slice.');

  const { rows: projectRows } = await selectAllPaged<Row>('projects', 'id,name,market,status,stage', (q) => q, 'r2-projects');
  const projectById = new Map(projectRows.map((p) => [String(p.id), p]));
  const liveProject = (r: Row): boolean => {
    const p = r.project_id ? projectById.get(String(r.project_id)) : null;
    return !!p && String(p.status) !== 'dismissed';
  };

  const lv = rows.filter((r) => tidy(r.market) === 'Las Vegas' && String(r.status) !== 'dismissed');

  console.log('='.repeat(108));
  console.log('READER 2. LAS VEGAS PRIMEGOV.');
  console.log('='.repeat(108));
  console.log('POPULATION: leads.market=Las Vegas, status<>dismissed. Paged to exhaustion, no cap.');
  console.log('NOTHING IS FETCHED FROM PRIMEGOV: it answers 403 here, and a probe from this machine');
  console.log('would measure the connection rather than the source.');
  console.log('');
  console.log(`  Las Vegas records                       : ${lv.length}`);
  console.log(`  on a project the register still holds   : ${lv.filter(liveProject).length}`);
  console.log(`  carrying a primary_document_url         : ${lv.filter((r) => !!r.primary_document_url).length}`);
  console.log(
    `  of those, url is a FILE                 : ${lv.filter((r) => r.primary_document_url && documentShape(String(r.primary_document_url)) === 'file').length}`
  );
  console.log(`  carrying raw_content                    : ${lv.filter((r) => tidy(r.raw_content).length > 0).length}`);
  console.log(`  carrying a filing fact today            : ${lv.filter((r) => Array.isArray(r.filing_facts) && r.filing_facts.length > 0).length}`);
  console.log('');

  const withText = lv.filter((r) => tidy(r.raw_content).length > 0);
  const lengths = withText.map((r) => String(r.raw_content).length).sort((a, b) => a - b);
  if (lengths.length) {
    console.log('  raw_content length, characters:');
    console.log(
      `    min ${lengths[0]}   p25 ${lengths[Math.floor(lengths.length * 0.25)]}   median ${lengths[Math.floor(lengths.length / 2)]}   ` +
        `p75 ${lengths[Math.floor(lengths.length * 0.75)]}   max ${lengths[lengths.length - 1]}`
    );
  }
  console.log('');
  console.log(`  per source: ${[...new Set(lv.map((r) => String(r.source)))].join(', ')}`);
  console.log(`  per document host: ${[...new Set(lv.map((r) => {
    try { return r.primary_document_url ? new URL(String(r.primary_document_url)).hostname : '(none)'; } catch { return '(bad url)'; }
  }))].join(', ')}`);

  // ---- 1. WOULD ANY EXISTING READER FIRE ON THE TEXT WE ALREADY HOLD? -----
  console.log('');
  console.log('-'.repeat(108));
  console.log('1. EVERY EXISTING READER, RUN OVER THE TEXT THE CORPUS ALREADY HOLDS');
  console.log('-'.repeat(108));
  let reached = 0;
  let factTotal = 0;
  let conditionTotal = 0;
  const byReader = new Map<string, number>();
  const movers = new Set<string>();
  for (const r of withText) {
    const text = String(r.raw_content);
    const { facts, by, refused } = runAll(text, tidy(r.title));
    byReader.set(by, (byReader.get(by) ?? 0) + 1);
    if (refused) continue;
    if (facts.length) {
      reached++;
      factTotal += facts.length;
      conditionTotal += facts.filter((f) => f.kind === 'condition').length;
      if (r.project_id && liveProject(r)) movers.add(String(r.project_id));
    }
  }
  console.log(`  records with text read : ${withText.length}`);
  console.log(`  records reached        : ${reached}`);
  console.log(`  facts extracted        : ${factTotal}`);
  console.log(`  CONDITIONS extracted   : ${conditionTotal}`);
  console.log(`  live projects touched  : ${movers.size}`);
  console.log('  which recogniser fired:');
  for (const [k, v] of [...byReader.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(34)} ${String(v).padStart(4)}`);
  }

  // ---- 2. HOW FAR IS LAS VEGAS FROM THE ONE FORM THAT WORKS? --------------
  console.log('');
  console.log('-'.repeat(108));
  console.log('2. THE DISTANCE FROM CLARK, WHICH IS THE ONLY FORM THAT YIELDS A CONDITION');
  console.log('-'.repeat(108));
  const corpus = withText.map((r) => String(r.raw_content));
  console.log('  Clark agenda-sheet markers, counted over Las Vegas item text:');
  for (const [name, re] of CLARK_MARKERS) {
    const n = corpus.filter((t) => re.test(t)).length;
    console.log(`    ${name.padEnd(34)} ${String(n).padStart(4)} of ${corpus.length}`);
  }
  console.log('');
  console.log('  What Las Vegas items DO carry:');
  for (const [name, re] of LV_MARKERS) {
    const n = corpus.filter((t) => re.test(t)).length;
    console.log(`    ${name.padEnd(34)} ${String(n).padStart(4)} of ${corpus.length}`);
  }

  // ---- 3. THE PROJECTS A READER WOULD HAVE TO MOVE ------------------------
  console.log('');
  console.log('-'.repeat(108));
  console.log('3. THE LAS VEGAS PROJECTS IN THE GAP, AND WHAT EACH ACTUALLY HOLDS');
  console.log('-'.repeat(108));
  const lvProjects = projectRows.filter(
    (p) => tidy(p.market) === 'Las Vegas' && String(p.status) !== 'dismissed'
  );
  for (const p of lvProjects) {
    const recs = lv.filter((r) => String(r.project_id) === String(p.id));
    const facts = recs.reduce((n, r) => n + (Array.isArray(r.filing_facts) ? r.filing_facts.length : 0), 0);
    if (facts > 0) continue;
    const docs = recs.filter((r) => !!r.primary_document_url);
    const files = docs.filter((r) => documentShape(String(r.primary_document_url)) === 'file');
    const chars = recs.reduce((n, r) => n + tidy(r.raw_content).length, 0);
    console.log(
      `  ${tidy(p.name).slice(0, 44).padEnd(45)} ${String(recs.length).padStart(3)} recs  ` +
        `${String(docs.length).padStart(2)} doc urls  ${String(files.length).padStart(2)} files  ` +
        `${String(chars).padStart(7)} chars of text`
    );
  }

  // ---- 4. WHAT A LAS VEGAS FIELD SET WOULD YIELD, MEASURED BEFORE BUILDING -
  //
  // NOT A READER. Per-field hit rates and the false positives each pattern would
  // produce, which is the pass every existing reader in this tree was written
  // after and the pass clark-ordinance-title never got outside Clark. Nothing
  // here is wired to anything and nothing is stored.
  //
  // The patterns are taken from the text above rather than invented: a Las Vegas
  // agenda line is one paragraph carrying a case number, an applicant/owner
  // pair, a request, a size, an address, an APN, a ward and a staff
  // recommendation. That is a different form from Clark's tabulated sheet and
  // from Anaheim's, which is why no existing recogniser fires.
  console.log('');
  console.log('-'.repeat(108));
  console.log('4. WHAT A LAS VEGAS FIELD SET WOULD YIELD. MEASURED, NOT BUILT.');
  console.log('-'.repeat(108));
  const CANDIDATE: { kind: string; re: RegExp }[] = [
    { kind: 'application_no', re: /\b(\d{2}-\d{4}-[A-Z]{2,4}\d?)\b/ },
    { kind: 'applicant', re: /APPLICANT(?:\s*\/\s*OWNER)?\s*:\s*([^-\n]{3,80}?)(?:\s+-\s+|$)/i },
    { kind: 'owner', re: /\bOWNER\s*:\s*([^-\n]{3,80}?)(?:\s+-\s+|$)/i },
    { kind: 'floor_area', re: /\b([\d,]{3,12})\s*SQUARE[- ]FOOT\b/i },
    { kind: 'open_space', re: /\b([\d,]{3,12})\s*SQUARE FEET OF OUTDOOR SEATING\b/i },
    { kind: 'site_acreage', re: /\b([\d.,]+)\s*acres?\b/i },
    { kind: 'apn', re: /\bAPNs?\s+([\d-]{9,})/i },
    { kind: 'site_address', re: /\bat\s+(\d{2,6}\s+[NSEW]?\.?\s*[A-Za-z][A-Za-z .]{3,40}(?:Boulevard|Parkway|Street|Drive|Avenue|Road|Way|Lane))/i },
    { kind: 'staff_recommendation', re: /Staff recommends\s+([A-Z]{4,12})/ },
    { kind: 'zone_change', re: /FROM:\s*([A-Z0-9-]{2,12})[^\n]{0,40}TO:\s*([A-Z0-9-]{2,12})/i },
    { kind: 'ward', re: /\bWard\s+(\d{1,2})\b/i },
    { kind: 'held_to', re: /\b(ABEYANCE)\b/i },
  ];
  console.log('  kind                     records   rate   example value');
  for (const c of CANDIDATE) {
    const hits = withText
      .map((r) => ({ r, m: String(r.raw_content).match(c.re) }))
      .filter((x) => !!x.m);
    const eg = hits[0]?.m ? tidy(hits[0].m[1] ?? hits[0].m[0]).slice(0, 46) : '-';
    console.log(
      `  ${c.kind.padEnd(24)} ${String(hits.length).padStart(7)} ${((100 * hits.length) / withText.length).toFixed(0).padStart(5)}%   ${eg}`
    );
  }
  const anyHit = withText.filter((r) => CANDIDATE.some((c) => c.re.test(String(r.raw_content))));
  const projectsMoved = new Set(
    anyHit.filter((r) => r.project_id && liveProject(r)).map((r) => String(r.project_id))
  );
  console.log('');
  console.log(`  records a Las Vegas field set would reach : ${anyHit.length} of ${withText.length}`);
  console.log(`  live projects it would move off zero     : ${projectsMoved.size}`);
  console.log('  and of those, the ones in the vertical are named in section 3 above.');
  console.log('');
  console.log('  NOTE ON CONDITIONS: not one candidate above is a condition of approval, and');
  console.log('  none could be. A Las Vegas agenda line states the request and the staff');
  console.log('  recommendation; the obligations attached to an approval are not on it.');

  // ---- 5. A SAMPLE, SO A PERSON CAN SEE WHAT THE TEXT IS ------------------
  console.log('');
  console.log('-'.repeat(108));
  console.log('5. THREE ITEMS IN FULL, BECAUSE A COUNT OF CHARACTERS IS NOT EVIDENCE ABOUT A FORM');
  console.log('-'.repeat(108));
  for (const r of withText.slice(0, 3)) {
    console.log(`\n  --- ${tidy(r.title).slice(0, 90)}`);
    console.log(`      ${String(r.raw_content).length} chars, document url ${tidy(r.primary_document_url).slice(0, 66)}`);
    console.log('      ' + String(r.raw_content).replace(/\s+/g, ' ').slice(0, 700));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
