// LANE A: WHAT 70 CEQR PROJECTS ACTUALLY HOLD.
//
//   node --env-file=.env.local --import tsx agents/scraper/diagnostics/ceqr-inventory.ts
//   node ... ceqr-inventory.ts --limit 70          how many projects to walk
//   node ... ceqr-inventory.ts --read lead_agency_letter   fetch and read that kind
//
// MEASURE BEFORE WRITING A READER. The pass this belongs to is "build it, store
// the inventory, and measure what 70 projects yield before writing any reader",
// and the order is the whole point: a reader written against three examples
// encodes the three examples. The inventory is cheap because the document's kind
// is in its URL - see nyc-ceqr-documents - so the census costs no downloads at
// all and only the sampling does.
//
// IT WRITES TO A FILE, NOT TO THE DATABASE. Storing this properly needs a table
// and a table needs DDL, and DDL is Philip's to run. The migration is PRINTED at
// the end of the run, blocking, per standing rule 5; the JSONL beside it is what
// makes today's measurement possible without it, and is written to
// agents/scraper/fixtures/ceqr-inventory.jsonl so the numbers below can be
// re-derived without hitting the city's server again.

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import {
  fetchCeqrInventory,
  rehydrate,
  type CeqrProjectDocuments,
} from '../sources/nyc-ceqr-documents';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? (process.argv[i + 1] ?? null) : null;
};
const LIMIT = Number(arg('limit') ?? 70);
const READ_KIND = arg('read');
const OUT = 'agents/scraper/fixtures/ceqr-inventory.jsonl';
const MIGRATION = 'agents/scraper/migrations/036_ceqr_documents.sql';

const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(0)}%` : '-');

/**
 * The CEQR numbers to walk, newest first.
 *
 * FROM THE CORPUS, NOT FROM THE DATASET. The question is what OUR projects hold,
 * so the sample is the CEQR numbers already clustered into projects we carry. A
 * sample drawn from the 15,362-row dataset would measure New York City's
 * environmental review programme, which is a different and less useful number.
 */
async function ceqrNumbersInCorpus(limit: number): Promise<{ ceqr: string; title: string }[]> {
  const { data, error } = await supabaseAdmin
    .from('leads')
    .select('title,url,published_date')
    .eq('source', 'nyc-ceqr')
    .neq('status', 'dismissed')
    .order('published_date', { ascending: false, nullsFirst: false })
    .limit(limit * 3);
  if (error) throw new Error(error.message);
  const out: { ceqr: string; title: string }[] = [];
  const seen = new Set<string>();
  for (const r of (data ?? []) as { title: string; url: string }[]) {
    // The CEQR number is the record's identity and it is in the URL whichever
    // form the URL takes - the Socrata query or the CEQR Access detail page.
    const m = /\b(\d{2}[A-Z]{2,4}\d{3,4}[A-Z])\b/.exec(decodeURIComponent(r.url ?? ''));
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ ceqr: m[1], title: r.title });
    if (out.length >= limit) break;
  }
  return out;
}

/** A file we can read as text today, against one we would need to unpack first. */
const READABLE_NOW = new Set(['pdf', 'htm', 'html', 'txt']);

function census(all: CeqrProjectDocuments[]): void {
  const docs = all.flatMap((p) => p.documents);
  const reached = all.filter((p) => !p.failure);
  const withDocs = reached.filter((p) => p.documents.length > 0);

  console.log('='.repeat(78));
  console.log('WHAT THE INVENTORY REACHED');
  console.log('='.repeat(78));
  console.log(`  projects asked for          : ${all.length}`);
  console.log(`  detail pages reached        : ${reached.length}  (${pct(reached.length, all.length)})`);
  console.log(`  projects carrying documents : ${withDocs.length}  (${pct(withDocs.length, all.length)})`);
  console.log(`  documents found             : ${docs.length}`);
  if (withDocs.length) {
    const counts = withDocs.map((p) => p.documents.length).sort((a, b) => a - b);
    console.log(
      `  documents per project       : median ${counts[Math.floor(counts.length / 2)]}, ` +
        `max ${counts[counts.length - 1]}, min ${counts[0]}`
    );
  }
  // NOTHING IS SILENTLY ABSENT, in a diagnostic as much as in a document. A
  // project we could not reach is named with the reason rather than dropped out
  // of the denominator.
  const failed = all.filter((p) => p.failure);
  if (failed.length) {
    console.log(`\n  ${failed.length} project${failed.length === 1 ? '' : 's'} not reached:`);
    for (const f of failed) console.log(`      ${f.ceqr.padEnd(12)} ${f.failure}`);
  }

  console.log('\n' + '='.repeat(78));
  console.log('BY FILE TYPE');
  console.log('='.repeat(78));
  const byKind = new Map<string, { n: number; projects: Set<string>; exts: Map<string, number> }>();
  for (const d of docs) {
    let e = byKind.get(d.kind);
    if (!e) { e = { n: 0, projects: new Set(), exts: new Map() }; byKind.set(d.kind, e); }
    e.n++;
    e.projects.add(d.ceqr);
    e.exts.set(d.extension, (e.exts.get(d.extension) ?? 0) + 1);
  }
  console.log('  kind                        docs   projects   share of projects   extensions');
  for (const [kind, e] of [...byKind.entries()].sort((a, b) => b[1].n - a[1].n)) {
    const exts = [...e.exts.entries()].sort((a, b) => b[1] - a[1]).map(([x, n]) => `${x || '(none)'}:${n}`).join(' ');
    console.log(
      `  ${kind.padEnd(26)} ${String(e.n).padStart(4)}   ${String(e.projects.size).padStart(8)}   ` +
        `${pct(e.projects.size, all.length).padStart(17)}   ${exts}`
    );
  }

  // THE COST OF READING EACH KIND, stated before anybody writes a reader. A zip
  // is not a harder PDF, it is a different pipeline.
  const needUnzip = docs.filter((d) => d.extension === 'zip');
  console.log('\n  documents readable as they are : ' +
    `${docs.filter((d) => READABLE_NOW.has(d.extension)).length} of ${docs.length}`);
  console.log(`  documents needing an unzip step: ${needUnzip.length}  ` +
    `(${[...new Set(needUnzip.map((d) => d.kind))].join(', ') || 'none'})`);

  const undated = docs.filter((d) => !d.dateFromName);
  console.log(`  documents with no date in the filename: ${undated.length} of ${docs.length}`);
}

/**
 * FETCH AND READ A SAMPLE OF ONE KIND.
 *
 * Not a reader. This prints the text of a handful of documents of one kind so a
 * person can see what is in them before a pattern is written against them. The
 * two questions it is here to answer about the lead agency letter - what is in
 * one, and does it name a party - are questions you answer by reading three of
 * them, not by grepping 70.
 */
async function readSample(all: CeqrProjectDocuments[], kind: string, n = 4): Promise<void> {
  const picks = all.flatMap((p) => p.documents).filter((d) => d.kind === kind).slice(0, n);
  console.log('\n' + '='.repeat(78));
  console.log(`READING ${picks.length} ${kind.toUpperCase()} DOCUMENTS`);
  console.log('='.repeat(78));
  // Imported here rather than at the top: the census path does no downloading
  // and must not pay for a PDF parser it never calls.
  // @ts-ignore - declared in ../sources/pdf-parse.d.ts
  const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
  for (const d of picks) {
    console.log(`\n--- ${d.label}  [${d.extension}]  ${d.dateFromName ?? 'no date in the name'}`);
    console.log(`    ${d.url}`);
    try {
      const res = await fetch(d.url, { headers: { 'user-agent': 'philipkwong-agents/1.0' } });
      const type = res.headers.get('content-type') ?? '';
      const buf = Buffer.from(await res.arrayBuffer());
      console.log(`    HTTP ${res.status}  ${type}  ${buf.length} bytes`);
      if (!res.ok || !/pdf/i.test(type)) {
        console.log('    not a PDF response; skipped rather than guessed at');
        continue;
      }
      const { text, numpages } = await pdfParse(buf);
      console.log(`    ${numpages} page${numpages === 1 ? '' : 's'}, ${text.length} characters`);
      console.log('    ----- text -----');
      console.log(text.slice(0, 3000).split('\n').map((l: string) => `    | ${l}`).join('\n'));
    } catch (e) {
      console.log(`    FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/**
 * THE MIGRATION, PRINTED FOR PHILIP TO RUN. Standing rule 5: never DDL from
 * code.
 *
 * IT IS READ OFF DISK, NOT WRITTEN OUT HERE. This function used to hold the SQL
 * in a template literal and print it, and a run that printed it was reported as
 * "the migration is printed and blocking" when no migration file existed. A
 * console.log is not an artefact. Reading the file means the run FAILS when the
 * migration is missing, instead of manufacturing the appearance of one.
 */
function printMigration(): void {
  console.log('');
  console.log('='.repeat(78));
  console.log(`MIGRATION ${MIGRATION}, FOR PHILIP TO RUN IN THE SUPABASE SQL EDITOR. BLOCKING.`);
  console.log('='.repeat(78));
  if (!existsSync(MIGRATION)) {
    console.log(`  MISSING: ${MIGRATION} is not on disk. There is nothing runnable here.`);
    process.exitCode = 1;
    return;
  }
  console.log(readFileSync(MIGRATION, 'utf8'));
  console.log('Until this is run, the inventory lives in ' + OUT + ' and nothing writes to the database.');
}

async function main(): Promise<void> {
  const cached = existsSync(OUT) && process.argv.includes('--cached');
  let all: CeqrProjectDocuments[];
  if (cached) {
    all = readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    console.log(`Read ${all.length} projects from ${OUT} (--cached; nothing was fetched).\n`);
    // One implementation, in the source module, called by every reader of this
    // cache. See rehydrate: everything except the signed query string and the
    // decoded path is recomputed, because a cached derivation has now been wrong
    // twice and survived both fixes.
    rehydrate(all);
  } else {
    const targets = await ceqrNumbersInCorpus(LIMIT);
    console.log(`Walking ${targets.length} CEQR projects from the corpus, newest first.\n`);
    all = await fetchCeqrInventory(
      targets.map((t) => t.ceqr),
      (done, total, r) => {
        const what = r.failure ? `FAILED: ${r.failure}` : `${r.documents.length} documents`;
        console.log(`  [${String(done).padStart(3)}/${total}] ${r.ceqr.padEnd(12)} ${what}`);
      }
    );
    mkdirSync('agents/scraper/fixtures', { recursive: true });
    writeFileSync(OUT, all.map((r) => JSON.stringify(r)).join('\n') + '\n');
    console.log(`\nInventory written to ${OUT}\n`);
  }

  census(all);
  if (READ_KIND) await readSample(all, READ_KIND);
  printMigration();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
