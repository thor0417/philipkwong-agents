// READ-ONLY. WHAT THE CLARK READER ACTUALLY YIELDS, PER FIELD.
//
//   node --import tsx agents/scraper/diagnostics/filing-measure.ts <docdir>
//   ... --show <kind>    print every value read for one field, for hand-checking
//
// Nothing is written. Nothing prints to a client document. This exists because
// "measure per field what it yields before it prints anything" is the
// instruction, and a reader that has not been measured per field is a reader
// nobody can rank against anything else.
//
// TWO NUMBERS PER FIELD, and the second is the one that matters:
//   found        documents the field was read from
//   verified     of those, how many survive verifyFilingFacts - the display is
//                in the document AND in the line printed beside it
// A field with a high found and a low verified is a field that reads something
// and cannot prove it, which is worse than a field that reads nothing.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  readFilingFacts, verifyFilingFacts, isClarkAgendaSheet,
  type FilingFact, type FilingFactKind,
} from '../filing-facts';

const DIR = process.argv[2];
const SHOW = (() => {
  const i = process.argv.indexOf('--show');
  return i > -1 ? (process.argv[i + 1] as FilingFactKind) : null;
})();
if (!DIR) { console.error('usage: filing-measure.ts <docdir> [--show <kind>]'); process.exit(1); }

interface Doc {
  file: string; jurisdiction: string; adapter: string; docName: string;
  url: string; leadId: string; leadTitle: string; pages: number; chars: number;
}

const manifest: Doc[] = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
const texts = new Map<string, string>();
// The page separator is doc-corpus' own, not the county's: production joins
// pages with a plain newline. Stripping it here keeps the harness from measuring
// its own scaffolding.
const PAGE_MARK = /\n*-{4}PAGE-{4}\n*/g;
for (const d of manifest) {
  try {
    texts.set(d.file, readFileSync(join(DIR, d.file), 'utf8').replace(PAGE_MARK, '\n'));
  } catch { /* skip */ }
}

// DEDUPLICATED BY URL. The manifest holds the same attachment twice wherever two
// lead rows point at one Legistar matter, and counting a document twice would
// inflate every share below by whatever the duplication rate happens to be.
const seenUrl = new Set<string>();
const readable = manifest
  .filter((d) => (texts.get(d.file) ?? '').replace(/\s/g, '').length >= 400)
  .filter((d) => (seenUrl.has(d.url) ? false : (seenUrl.add(d.url), true)));
const clark = readable.filter((d) => d.jurisdiction.includes('Clark'));
const sheets = clark.filter((d) => isClarkAgendaSheet(texts.get(d.file)!));
const notSheets = clark.filter((d) => !isClarkAgendaSheet(texts.get(d.file)!));

const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(0) + '%' : '-');

console.log('===== THE SAMPLE =====\n');
console.log(`readable documents, all jurisdictions : ${readable.length}`);
console.log(`  Clark County                        : ${clark.length}`);
console.log(`  and are an AGENDA SHEET             : ${sheets.length}  (${pct(sheets.length, clark.length)})`);
console.log(`  Clark, but some other form          : ${notSheets.length}`);
console.log('\nThe reader is written against the agenda sheet and claims nothing about');
console.log('the rest. What those others are, so the gap is named rather than hidden:');
const others = new Map<string, number>();
for (const d of notSheets) {
  const t = texts.get(d.file)!;
  const kind = /minutes/i.test(t) ? 'town board minutes'
    : /justification|letter/i.test(d.docName) || /Dear /i.test(t) ? 'letter or justification'
    : /grant/i.test(t) ? 'grant paperwork'
    : /REDEVELOPMENT AGENCY/i.test(t) ? 'redevelopment agency item'
    : 'other';
  others.set(kind, (others.get(kind) ?? 0) + 1);
}
for (const [k, n] of [...others.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}  ${k}`);
}

// ---- per field --------------------------------------------------------------
interface Row { found: number; verified: number; refused: number; examples: FilingFact[] }
const rows = new Map<FilingFactKind, Row>();
const bump = (k: FilingFactKind): Row => {
  rows.set(k, rows.get(k) ?? { found: 0, verified: 0, refused: 0, examples: [] });
  return rows.get(k)!;
};

let docsRefused = 0;
let conditionsTotal = 0;
const conditionCounts: number[] = [];
const groups = new Map<string, number>();

for (const d of sheets) {
  const text = texts.get(d.file)!;
  const facts = readFilingFacts(text);
  const seen = new Set<FilingFactKind>();
  for (const f of facts) {
    if (seen.has(f.kind)) continue;
    seen.add(f.kind);
    const r = bump(f.kind);
    r.found++;
    if (r.examples.length < 6) r.examples.push(f);
  }
  // Verification is per document: either the whole read survives or the
  // document contributes nothing, which is the same contract the writer has.
  try {
    verifyFilingFacts(facts, text);
    for (const k of seen) bump(k).verified++;
  } catch (e) {
    docsRefused++;
    for (const k of seen) bump(k).refused++;
    console.error(`  REFUSED ${d.docName.slice(0, 40)}: ${String(e).slice(0, 150)}`);
  }
  const conds = facts.filter((f) => f.kind === 'condition');
  if (conds.length) {
    conditionsTotal += conds.length;
    conditionCounts.push(conds.length);
    for (const c of conds) groups.set(c.group ?? '(no department)', (groups.get(c.group ?? '(no department)') ?? 0) + 1);
  }
}

const ORDER: FilingFactKind[] = [
  'staff_recommendation', 'next_hearing', 'commission_action', 'board_action', 'held_to', 'tab_cac', 'protests',
  'condition',
  'apn', 'site_address', 'cross_streets', 'town', 'land_use_plan', 'zone',
  'site_acreage', 'project_type', 'existing_land_use', 'rooms', 'units', 'lots', 'density',
  'stories', 'height_feet', 'floor_area', 'unit_size', 'open_space', 'parking', 'sustainability',
];

console.log(`\n\n===== PER FIELD, OVER ${sheets.length} CLARK AGENDA SHEETS =====\n`);
console.log(`documents refused by the guard : ${docsRefused}`);
console.log('\nfield                    found   share   verified   example');
for (const k of ORDER) {
  const r = rows.get(k);
  if (!r) { console.log(`${k.padEnd(24)}${String(0).padStart(5)}${'0%'.padStart(8)}${String(0).padStart(11)}   -`); continue; }
  const ex = r.examples[0];
  console.log(
    `${k.padEnd(24)}${String(r.found).padStart(5)}${pct(r.found, sheets.length).padStart(8)}${String(r.verified).padStart(11)}   ` +
      `${(ex ? `${ex.label}: ${ex.display}` : '').replace(/\s+/g, ' ').slice(0, 72)}`
  );
}

console.log('\n\n===== CONDITIONS, IN DETAIL =====\n');
const cc = [...conditionCounts].sort((a, b) => a - b);
console.log(`documents carrying conditions : ${conditionCounts.length} of ${sheets.length}  (${pct(conditionCounts.length, sheets.length)})`);
console.log(`conditions read               : ${conditionsTotal}`);
console.log(`per document  min/median/max  : ${cc[0] ?? 0} / ${cc[Math.floor(cc.length / 2)] ?? 0} / ${cc[cc.length - 1] ?? 0}`);
console.log('\nby reviewing department (which is the part a flat list would have lost):');
for (const [g, n] of [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
  console.log(`  ${String(n).padStart(4)}  ${g}`);
}

if (SHOW) {
  console.log(`\n\n===== EVERY VALUE READ FOR "${SHOW}", FOR HAND-CHECKING =====\n`);
  let n = 0;
  for (const d of sheets) {
    const facts = readFilingFacts(texts.get(d.file)!).filter((f) => f.kind === SHOW);
    for (const f of facts) {
      n++;
      console.log(`${String(n).padStart(3)}. ${d.docName.slice(0, 34).padEnd(36)}${f.group ? `[${f.group}] ` : ''}${f.label}: ${f.display.slice(0, 150)}`);
    }
  }
  console.log(`\n${n} values.`);
}
