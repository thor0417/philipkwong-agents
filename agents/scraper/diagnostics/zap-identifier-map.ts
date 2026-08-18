// THE IDENTIFIER MAPPING, FROM THE SOURCE RATHER THAN FROM PROSE.
//
//   node --env-file=.env.local --import tsx agents/scraper/diagnostics/zap-identifier-map.ts
//
// READ-ONLY. Nothing is written and no reader is built.
//
// WHY THIS CAPS EVERYTHING ELSE. The CPC report is the only document type that
// carries a named private individual, and it is keyed on a ULURP APPLICATION
// number. Our records carry a ZAP PROJECT id. Yesterday's 52% - 17 of 33 numbers
// returning a PDF - was measured against a set of 33 numbers RECOVERED BY REGEX
// FROM RECORD TEXT, which is not a mapping and has no denominator. The ceiling
// is our identifier recovery, not DCP's coverage, and a regex over prose finds
// whatever happens to have been written down.
//
// So: what does NYC Open Data actually publish, and what does the yield become
// when the numbers come from a field instead of from a sentence?
//
// THE DISCOVERY API IS ASKED RATHER THAN THE DATASET IDS GUESSED. Socrata
// publishes a catalog endpoint; a guessed four-by-four that 404s is
// indistinguishable from a dataset that does not exist, and this lane has
// already spent a day on hosts that serve their errors as HTTP 200.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { setTimeout as sleep } from 'node:timers/promises';

const UA = 'philipkwong-agents/1.0';
const CATALOG = 'https://api.us.socrata.com/api/catalog/v1';
const DOMAIN = 'data.cityofnewyork.us';

interface CatalogItem { resource: { id: string; name: string; description: string; columns_field_name?: string[] } }

async function catalogSearch(q: string): Promise<CatalogItem[]> {
  const url = `${CATALOG}?domains=${DOMAIN}&q=${encodeURIComponent(q)}&limit=40`;
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  const j = (await res.json()) as { results: CatalogItem[] };
  return j.results ?? [];
}

/** The column names a dataset actually has, straight from its own metadata. */
async function columnsOf(id: string): Promise<string[]> {
  try {
    const res = await fetch(`https://${DOMAIN}/api/views/${id}.json`, {
      headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return [];
    const j = (await res.json()) as { columns?: { fieldName: string }[] };
    return (j.columns ?? []).map((c) => c.fieldName);
  } catch { return []; }
}

const ULURP_FIELD = /ulurp|application_?number|appl.*num|project_?id|projectid/i;

async function main(): Promise<void> {
  // ---- 1. WHAT IS PUBLISHED -------------------------------------------------
  console.log('='.repeat(78));
  console.log('1. WHAT NYC OPEN DATA PUBLISHES FOR ZAP / ULURP');
  console.log('='.repeat(78));
  const seen = new Map<string, CatalogItem>();
  for (const q of ['zoning application portal', 'ZAP', 'ULURP', 'city planning applications']) {
    for (const r of await catalogSearch(q)) seen.set(r.resource.id, r);
    await sleep(400);
  }
  const interesting = [...seen.values()].filter((r) =>
    /zap|ulurp|zoning application|land use application|city planning/i.test(
      `${r.resource.name} ${r.resource.description ?? ''}`
    )
  );
  console.log(`  ${seen.size} datasets matched, ${interesting.length} look relevant\n`);
  const withUlurp: { id: string; name: string; cols: string[] }[] = [];
  for (const r of interesting) {
    const cols = await columnsOf(r.resource.id);
    const hits = cols.filter((c) => ULURP_FIELD.test(c));
    console.log(`  ${r.resource.id}  ${r.resource.name.slice(0, 58)}`);
    if (hits.length) {
      console.log(`      identifier fields: ${hits.join(', ')}`);
      withUlurp.push({ id: r.resource.id, name: r.resource.name, cols });
    } else if (cols.length) {
      console.log(`      columns: ${cols.slice(0, 10).join(', ')}${cols.length > 10 ? ' ...' : ''}`);
    } else {
      console.log('      (no column metadata; may not be a tabular dataset)');
    }
    await sleep(300);
  }

  // ---- 2. THE MAPPING ITSELF, PULLED ---------------------------------------
  //
  // A dataset that CONTAINS a ULURP field is not yet a mapping. What is needed is
  // project id -> {ulurp numbers}, so the CPC URL shape can be built for every
  // project we hold rather than for the ones whose prose happened to mention a
  // number.
  console.log('\n' + '='.repeat(78));
  console.log('2. PROJECT ID -> ULURP APPLICATION NUMBERS');
  console.log('='.repeat(78));
  const { data: zapRows } = await supabaseAdmin
    .from('leads')
    .select('title,url,raw_content,project_id')
    .eq('source', 'nyc-zap')
    .neq('status', 'dismissed');
  const ZAP_ID = /\b(P?\d{4}[A-Z]\d{4})\b/;
  const ours = new Map<string, string>();
  for (const r of zapRows ?? []) {
    const m = ZAP_ID.exec(`${r.url ?? ''} ${r.raw_content ?? ''}`);
    if (m) ours.set(m[1], String(r.title));
  }
  console.log(`  ZAP project ids we hold: ${ours.size}`);

  const mapping = new Map<string, Set<string>>();
  let queried = 0;
  for (const cand of withUlurp) {
    // Which column is the project key, and which is the ULURP number.
    const projectCol = cand.cols.find((c) => /^project_?id$/i.test(c)) ?? cand.cols.find((c) => /project.*id/i.test(c));
    const ulurpCol = cand.cols.find((c) => /ulurp/i.test(c)) ?? cand.cols.find((c) => /application_?number/i.test(c));
    if (!projectCol || !ulurpCol) continue;
    console.log(`\n  trying ${cand.id} (${cand.name.slice(0, 44)}) on ${projectCol} / ${ulurpCol}`);
    for (const id of [...ours.keys()]) {
      const url = `https://${DOMAIN}/resource/${cand.id}.json?${projectCol}=${encodeURIComponent(id)}`;
      try {
        const rows = (await (await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20_000) })).json()) as Record<string, string>[];
        queried++;
        for (const row of rows ?? []) {
          const raw = String(row[ulurpCol] ?? '').trim();
          if (!raw) continue;
          // The bare six digits are the file name; the suffix is the action type.
          for (const m of raw.matchAll(/\b(\d{6})[A-Z]{0,4}\b/g)) {
            if (!mapping.has(id)) mapping.set(id, new Set());
            mapping.get(id)!.add(m[1]);
          }
        }
      } catch { /* reported in the totals below */ }
      await sleep(150);
    }
    if (mapping.size) break;
  }

  const numbers = new Set([...mapping.values()].flatMap((s) => [...s]));
  console.log(`\n  projects queried            : ${queried}`);
  console.log(`  projects with a ULURP number: ${mapping.size} of ${ours.size}`);
  console.log(`  DISTINCT ULURP NUMBERS      : ${numbers.size}   (regex over prose found 33)`);

  // ---- 3. WHAT THE YIELD BECOMES -------------------------------------------
  console.log('\n' + '='.repeat(78));
  console.log('3. HOW MANY OF THOSE REACH A CPC REPORT');
  console.log('='.repeat(78));
  if (numbers.size === 0) {
    console.log('  No mapping was recovered from the source, so the 33-number regex set stands');
    console.log('  as the ceiling. That is the finding: the identifier is not published in a');
    console.log('  form this pass could reach, and the next step is DCP rather than Open Data.');
    return;
  }
  let pdf = 0;
  const reached = new Set<string>();
  for (const [projectId, nums] of mapping) {
    for (const n of nums) {
      const url = `https://www.nyc.gov/assets/planning/download/pdf/about/cpc/${n}.pdf`;
      try {
        const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(25_000) });
        const buf = Buffer.from(await res.arrayBuffer());
        if (res.ok && buf.subarray(0, 5).toString('latin1') === '%PDF-') {
          pdf++;
          reached.add(projectId);
        }
      } catch { /* counted as not reached */ }
      await sleep(250);
    }
  }
  console.log(`  CPC reports reachable : ${pdf} of ${numbers.size} numbers`);
  console.log(`  PROJECTS reached      : ${reached.size} of ${ours.size} ZAP projects we hold`);
  console.log(`\n  Against 1 project from CEQR Access, and 10 from the regex set.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
