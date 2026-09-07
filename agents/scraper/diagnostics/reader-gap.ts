// READ-ONLY. WHAT WOULD A READER ACTUALLY MOVE, AFTER THE CLEANOUT?
//
//   node --env-file=.env.local --import tsx agents/scraper/diagnostics/reader-gap.ts
//
// Nothing is written. Brief U item 3 asks for the four ranked readers to be
// re-measured rather than carried forward, for two reasons it names: the
// document fixes moved the numerator, and the cleanout moved the denominator.
//
// ---------------------------------------------------------------------------
// THE GAP IS NOT "PROJECTS WITH NO FACT". IT IS "PROJECTS THAT ARE THE SUBJECT
// AND HAVE NO FACT".
// ---------------------------------------------------------------------------
//
// The ranking the four readers came from counted PROJECTS. Measured against
// projects that are the register's subject, Brief U item 4's re-measurement put
// the whole of it at eleven. That number is re-derived here against the corpus
// as it stands after 88 tombstones, so it can be compared rather than assumed.
//
// THE BUCKET COMES FROM THE COMMITTED JUDGEMENT, snapshots/holdings-judgement-
// live.json, which is produced by the real buildEntry. So "carries a fact" here
// means "an entry PRINTS a fact", not "a filing_facts row exists": the entry
// dedupes, caps and refuses, and counting stored rows would rank a reader on
// facts no client ever sees.

import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { selectAllPaged } from '../page-select';
import { documentShape } from '../../../lib/document-shape';

const JUDGEMENT = 'snapshots/holdings-judgement-live.json';

interface JudgedRow {
  id: string;
  name: string;
  market: string;
  bucket: string;
  statedFacts: number;
  conditions: number;
  records: number;
  parties: number;
  contacts: number;
  noEntry: boolean;
  stage: string;
}

type Lead = Record<string, unknown>;

async function main(): Promise<void> {
  const judged = JSON.parse(readFileSync(JUDGEMENT, 'utf8')) as { rows: JudgedRow[]; judge: string; rubric: string };
  const rows = judged.rows;

  const { rows: leads, complete } = await selectAllPaged<Lead>(
    'leads',
    'id,project_id,market,source,status,lifecycle,stream,primary_document_url,has_primary_document,filing_facts',
    (q) => q,
    'reader-gap'
  );
  if (!complete) throw new Error('lead read was partial; refusing to rank a reader on a slice.');

  const liveIds = new Set(rows.map((r) => r.id));
  const live = leads.filter(
    (l) => l.project_id && liveIds.has(String(l.project_id)) && String(l.status) !== 'dismissed'
  );

  console.log('='.repeat(112));
  console.log('THE READER GAP, RE-MEASURED AFTER THE CLEANOUT');
  console.log('='.repeat(112));
  console.log(`judgement ${JUDGEMENT}, judge ${judged.judge}, rubric ${judged.rubric}`);
  console.log(`live projects: ${rows.length}   records attached to one: ${live.length}`);
  console.log('NO CAP: leads paged to exhaustion.');
  console.log('');

  const markets = [...new Set(rows.map((r) => r.market))].sort();
  console.log('  market                live  vertical  vert. w/fact   REAL GAP   docs held   url is a file');
  let gapTotal = 0;
  const gapNames: { market: string; name: string; records: number; docs: number; stage: string }[] = [];

  for (const m of markets) {
    const inM = rows.filter((r) => r.market === m);
    const vert = inM.filter((r) => r.bucket === 'development-vertical');
    const withFact = vert.filter((r) => r.statedFacts > 0 || r.conditions > 0);
    const gap = vert.filter((r) => r.statedFacts === 0 && r.conditions === 0);
    gapTotal += gap.length;

    const mLeads = live.filter((l) => String(l.market ?? '') === m);
    const docs = mLeads.filter((l) => !!l.primary_document_url);
    // A FILE BY URL SHAPE, WHICH IS NOT THE SAME AS READABLE. lib/document-shape
    // answers "is this a fetched file or a page that lists files". It cannot see
    // whether the file has a text layer, and 13 of 37 non-Clark Legistar
    // documents measured outside Broward and Phoenix are image-only scans with
    // zero extractable characters - golden case
    // a-scanned-page-counted-as-a-document-we-hold. So this column is an upper
    // bound on what a reader could read, and the column name says so.
    const files = docs.filter((l) => documentShape(String(l.primary_document_url)) === 'file');

    if (inM.length === 0) continue;
    console.log(
      `  ${m.slice(0, 20).padEnd(21)} ${String(inM.length).padStart(5)} ${String(vert.length).padStart(9)} ` +
        `${String(withFact.length).padStart(13)} ${String(gap.length).padStart(10)} ${String(docs.length).padStart(11)} ` +
        `${String(files.length).padStart(16)}`
    );
    for (const g of gap) {
      const gl = live.filter((l) => String(l.project_id) === g.id);
      gapNames.push({
        market: m,
        name: g.name,
        records: gl.length,
        docs: gl.filter((l) => !!l.primary_document_url).length,
        stage: g.stage,
      });
    }
  }
  const allVert = rows.filter((r) => r.bucket === 'development-vertical');
  console.log(
    `  ${'TOTAL'.padEnd(21)} ${String(rows.length).padStart(5)} ${String(allVert.length).padStart(9)} ` +
      `${String(allVert.filter((r) => r.statedFacts > 0 || r.conditions > 0).length).padStart(13)} ${String(gapTotal).padStart(10)}`
  );

  console.log('');
  console.log('-'.repeat(112));
  console.log(`THE GAP, PROJECT BY PROJECT (${gapNames.length}). A reader can only move one of these.`);
  console.log('-'.repeat(112));
  console.log('  market              records  docs  stage             project');
  for (const g of gapNames.sort((a, b) => a.market.localeCompare(b.market) || b.records - a.records)) {
    console.log(
      `  ${g.market.slice(0, 18).padEnd(19)} ${String(g.records).padStart(7)} ${String(g.docs).padStart(5)}  ` +
        `${g.stage.slice(0, 16).padEnd(17)} ${g.name.slice(0, 50)}`
    );
  }

  // ---- AND THE ONE THING NONE OF THEM DOES ---------------------------------
  //
  // Brief U: "None of these emits a condition today; say so plainly if that
  // changes." Counted from the stored facts rather than asserted, per source.
  console.log('');
  console.log('-'.repeat(112));
  console.log('CONDITIONS, BY SOURCE. The claim is that only Clark emits one.');
  console.log('-'.repeat(112));
  const bySource = new Map<string, { records: number; conditions: number }>();
  for (const l of live) {
    const src = String(l.source ?? '(null)');
    if (!bySource.has(src)) bySource.set(src, { records: 0, conditions: 0 });
    const acc = bySource.get(src)!;
    acc.records++;
    const facts = l.filing_facts;
    if (Array.isArray(facts)) {
      acc.conditions += facts.filter((f) => (f as { kind?: string })?.kind === 'condition').length;
    }
  }
  console.log('  source                    records   condition facts');
  for (const [src, a] of [...bySource.entries()].sort((x, y) => y[1].conditions - x[1].conditions || y[1].records - x[1].records)) {
    console.log(`  ${src.slice(0, 24).padEnd(25)} ${String(a.records).padStart(8)} ${String(a.conditions).padStart(17)}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
