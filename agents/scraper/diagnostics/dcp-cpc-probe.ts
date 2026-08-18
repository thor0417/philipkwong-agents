// IS THE CPC REPORT REACHABLE FROM DCP DIRECTLY, KEYED ON A ULURP NUMBER?
//
//   node --env-file=.env.local --import tsx agents/scraper/diagnostics/dcp-cpc-probe.ts
//
// READ-ONLY. Nothing is written and no reader is built. This answers three
// questions and stops:
//
//   1. is there a URL shape that reaches a CPC report by ULURP number
//   2. are the Borough President and Community Board recommendation forms
//      appended the same way they are in the CEQR Access copy
//   3. what happened to the 17 CEQR projects whose Details link never resolved
//
// WHY THIS MATTERS MORE THAN THE CEQR LANE. Measured yesterday: exactly ONE
// unfiled root document across 63 CEQR projects, and it is the only source in
// that lane of a named private individual. A ceiling of 1 in 63 is not a reader
// problem, it is a source problem - CPC reports are ULURP documents and CEQR
// Access is not their home. If DCP publishes them by number, the party layer has
// a source with a denominator in the hundreds rather than one.
//
// THE TWO IDENTIFIERS ARE NOT THE SAME NUMBER, which is the whole difficulty.
// Our ZAP records carry a ZAP PROJECT ID - "2023Q0251", "2024K0444" - and the
// CPC report Bally's filed under is "250085.pdf", which is a ULURP APPLICATION
// number (250085MMX without its suffix). One project has many applications, so
// the mapping is one to many and has to come from the source rather than be
// guessed.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { readFileSync, existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { rehydrate, type CeqrProjectDocuments } from '../sources/nyc-ceqr-documents';

const UA = 'philipkwong-agents/1.0 (+development intelligence)';

interface Probe { label: string; url: string }

/** HEAD-ish fetch that reports what actually came back, body included. */
async function probe(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30_000) });
    const type = res.headers.get('content-type') ?? '';
    const len = Number(res.headers.get('content-length') ?? 0);
    if (!res.ok) return `HTTP ${res.status}`;
    // A SOFT FAILURE IS THE HOUSE STYLE ON NYC HOSTS. CEQR Access serves its 404
    // and its 500 as HTTP 200, so a status check is not an answer anywhere in
    // this lane. The first bytes decide.
    const buf = Buffer.from(await res.arrayBuffer());
    const magic = buf.subarray(0, 5).toString('latin1');
    if (magic === '%PDF-') return `PDF ${(buf.length / 1e6).toFixed(2)}MB`;
    if (/json/i.test(type)) return `JSON ${buf.length}b`;
    if (/Page Not Found|Error Code 404/i.test(buf.subarray(0, 4000).toString('utf8'))) return 'soft 404 (HTTP 200)';
    return `${type.split(';')[0] || 'unknown'} ${buf.length || len}b`;
  } catch (e) {
    return e instanceof Error && /timed?\s*out|abort/i.test(e.name + e.message) ? 'timed out' : String(e).slice(0, 60);
  }
}

async function main(): Promise<void> {
  // ---- 1. THE URL SHAPES, TESTED ON A KNOWN-GOOD NUMBER --------------------
  //
  // 250085 is Bally's, and we have already read its CPC report out of CEQR
  // Access - 41 pages, recommendation forms on 23 and 37-39. So a shape that
  // returns a PDF here is a shape that works, and one that does not is ruled out
  // without guessing.
  console.log('='.repeat(78));
  console.log('1. URL SHAPES, AGAINST BALLY\'S KNOWN ULURP NUMBER 250085');
  console.log('='.repeat(78));
  const shapes: Probe[] = [
    { label: 'DCP cpc pdf, bare number', url: 'https://www.nyc.gov/assets/planning/download/pdf/about/cpc/250085.pdf' },
    { label: 'DCP cpc pdf, with suffix', url: 'https://www.nyc.gov/assets/planning/download/pdf/about/cpc/250085MMX.pdf' },
    { label: 'DCP cpc reports index', url: 'https://www.nyc.gov/site/planning/about/cpc-reports.page' },
    { label: 'ZAP project page', url: 'https://zap.planning.nyc.gov/projects/2024X0289' },
    { label: 'ZAP api project', url: 'https://zap-api.planning.nyc.gov/api/v1/projects/2024X0289' },
    { label: 'ZAP api search by ulurp', url: 'https://zap-api.planning.nyc.gov/api/v1/projects?ulurp_number=250085MMX' },
    { label: 'DCP applicant portal', url: 'https://a030-cpc.nyc.gov/html/cpc/index.aspx' },
  ];
  for (const s of shapes) {
    console.log(`  ${(await probe(s.url)).padEnd(22)} ${s.label}`);
    console.log(`  ${' '.repeat(22)} ${s.url}`);
    await sleep(400);
  }

  // ---- 2. DO WE EVEN HOLD ULURP NUMBERS? -----------------------------------
  //
  // The mapping question decides whether any of the above is usable at scale. A
  // shape that works and a number we do not have is not a source.
  console.log('\n' + '='.repeat(78));
  console.log('2. WHAT IDENTIFIERS THE CORPUS ACTUALLY HOLDS FOR NEW YORK');
  console.log('='.repeat(78));
  const { data: zap } = await supabaseAdmin
    .from('leads')
    .select('title,url,raw_content,action_sought')
    .eq('source', 'nyc-zap')
    .neq('status', 'dismissed');
  const rows = zap ?? [];
  const ZAP_ID = /\bP?\d{4}[A-Z]\d{4}\b/;
  const ULURP = /\b(\d{6})([A-Z]{2,4})\b/g;
  let withZapId = 0;
  const ulurpNumbers = new Set<string>();
  for (const r of rows) {
    const blob = `${r.title ?? ''} ${r.url ?? ''} ${r.raw_content ?? ''} ${r.action_sought ?? ''}`;
    if (ZAP_ID.test(blob)) withZapId++;
    for (const m of blob.matchAll(ULURP)) ulurpNumbers.add(m[1]);
  }
  console.log(`  nyc-zap records                 : ${rows.length}`);
  console.log(`  carrying a ZAP project id       : ${withZapId}`);
  console.log(`  distinct ULURP-shaped numbers   : ${ulurpNumbers.size}`);
  console.log(`  -> ${ulurpNumbers.size === 0 ? 'WE DO NOT HOLD ULURP NUMBERS. A CPC source keyed on them needs a mapping pass first.' : 'sample: ' + [...ulurpNumbers].slice(0, 10).join(', ')}`);

  // ---- 3. THE 17 CEQR PROJECTS THAT NEVER RESOLVED -------------------------
  //
  // Reported as "the search returned no Details link". That is a statement about
  // our request, not about the city: the same soft-failure host that serves a
  // 404 as a 200. Re-probed one at a time so the reason is per project rather
  // than one number.
  console.log('\n' + '='.repeat(78));
  console.log('3. THE 17 CEQR PROJECTS WITH NO DETAILS LINK');
  console.log('='.repeat(78));
  const IN = 'agents/scraper/fixtures/ceqr-inventory.jsonl';
  if (!existsSync(IN)) { console.log('  no inventory on disk'); return; }
  const projects: CeqrProjectDocuments[] = rehydrate(
    readFileSync(IN, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  );
  const missing = projects.filter((p) => p.failure);
  console.log(`  ${missing.length} projects, re-probed against the Socrata dataset they came from:`);
  for (const m of missing) {
    const soda = `https://data.cityofnewyork.us/resource/gezn-7mgk.json?ceqr=${m.ceqr}`;
    try {
      const rows2 = (await (await fetch(soda, { headers: { 'user-agent': UA } })).json()) as Record<string, unknown>[];
      const row = rows2[0];
      console.log(
        `      ${m.ceqr.padEnd(12)} dataset: ${row ? 'present' : 'ABSENT from gezn-7mgk'}` +
          (row ? `  lead=${String(row.lead_agency ?? '-').slice(0, 28)}  url=${row.url ? 'published' : 'NONE'}` : '')
      );
    } catch (e) {
      console.log(`      ${m.ceqr.padEnd(12)} dataset probe failed: ${String(e).slice(0, 50)}`);
    }
    await sleep(250);
  }
  console.log('\n  A project absent from the dataset was never ours to reach.');
  console.log('  A project present with no published url is a dataset gap, not a scrape failure.');
}

main().catch((e) => { console.error(e); process.exit(1); });
