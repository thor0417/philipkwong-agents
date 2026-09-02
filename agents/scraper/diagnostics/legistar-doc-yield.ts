// READ-ONLY. WHAT THE DOCUMENTS WE ALREADY HOLD WOULD YIELD, PER JURISDICTION.
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/legistar-doc-yield.ts [--include-clark] [--label pre]
//
// Nothing is written to the corpus. One JSON file and one markdown table are
// written to snapshots/ so the result exists on disk (standing rule 11).
//
// WHY THIS RUNS BEFORE A READER IS WRITTEN. Every reader in this tree was
// written after a measurement pass and every one of them documents the false
// positives that pass caught: Anaheim's "street address" hits 100% of its
// agendas and the address is the council chamber; Oakland's document never
// states a room count. A reader written from a guess about what a publisher
// might print is how city hall's address ends up under every project.
//
// THE HYPOTHESIS ON FILE, from BROWARD-DOCUMENTS-DIAGNOSIS.md, is that the
// OAKLAND reader's field set already fits Broward: both publish prose
// ordinances, agreements and resolutions rather than a form. The Oakland
// RECOGNISER cannot fire outside Oakland - it tests for CITY OF OAKLAND - but
// the FIELDS are generic prose patterns. So this probe runs every existing
// field set against every held document and reports which, if any, reaches
// anything. It is a measurement, not a build.
//
// CAPS. None on the corpus read: leads and projects are both paged to
// exhaustion. Clark County is EXCLUDED FROM THE FETCH by default and the flag
// --include-clark adds it, because Clark's documents are already read and its
// yield is on file at 73%; re-fetching 200 PDFs to reproduce a known number is
// cost with no answer at the end of it. Every table below states which
// population it covers.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { fetchPdfPages } from '../sources/pdf-agenda';
import { verifyFilingFacts, type FilingFact } from '../readers/core';
import { readFilingFacts } from '../readers/clark-agenda-sheet';
import { readOrdinanceTitleFacts } from '../readers/clark-ordinance-title';
// THE FIELD SET WITHOUT ITS RECOGNISER. readOaklandFacts gates on CITY OF
// OAKLAND, so calling it here would return [] for every non-Oakland document and
// the probe would report 'no existing field set fits' having never run one.
import { readProseOrdinanceFields, isCodeAmendment } from '../readers/oakland-ordinance';

const OUT_DIR = 'snapshots';
const CONCURRENCY = Number(process.env.YIELD_CONCURRENCY ?? '4');
const INCLUDE_CLARK = process.argv.includes('--include-clark');

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? (process.argv[i + 1] ?? null) : null;
};

interface Lead {
  id: string;
  title: string | null;
  url: string | null;
  source: string | null;
  status: string | null;
  location: string | null;
  market: string | null;
  project_id: string | null;
  primary_document_url: string | null;
  has_primary_document: boolean | null;
  filing_facts: unknown[] | null;
}

interface Proj {
  id: string;
  name: string;
  status: string | null;
  market: string | null;
  region_state: string | null;
}

// BRIEF Q's CACHED JUDGEMENT, so "projects moved off zero" can be read as
// "projects worth moving". A count of projects is not a count of subjects:
// Broward holds 84 live projects and ZERO of them are hospitality developments,
// so a reader that moves forty Broward projects off zero has moved forty things
// this register should not be holding. Read from the fixture rather than
// re-judged, because the labels cost money and are cached for exactly this.
const LABELS = 'agents/scraper/fixtures/holdings-labels.jsonl';
function loadBuckets(): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(LABELS)) return out;
  // Split on either line ending: the fixture is written on Windows and read on
  // whatever the runner is.
  for (const line of readFileSync(LABELS, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const j = JSON.parse(line) as { id: string; bucket: string };
    out.set(j.id, j.bucket);
  }
  return out;
}

async function pageAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...(data as unknown as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

// Which reader produced a fact. Every set is run over every document, because
// the question this probe answers is exactly "does any existing field set fit a
// jurisdiction it was not written for".
type ReaderName = 'oakland-fields' | 'clark-agenda-sheet' | 'title-only';

interface DocResult {
  lead: Lead;
  jurisdiction: string;
  ok: boolean;
  chars: number;
  pages: number;
  codeAmendment: boolean;
  byReader: Record<ReaderName, FilingFact[]>;
}

interface JurRow {
  jurisdiction: string;
  held: number;
  fetched: number;
  unreadable: number;
  medianChars: number;
  oaklandDocs: number;
  clarkDocs: number;
  titleDocs: number;
  anyDocs: number;
  oaklandFacts: number;
  clarkFacts: number;
  titleFacts: number;
  projectsWithDocs: number;
  projectsOffZeroNow: number;
  projectsWouldMove: number;
  kinds: Record<string, number>;
}

const median = (ns: number[]): number => {
  if (!ns.length) return 0;
  const s = [...ns].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

async function main(): Promise<void> {
  const label = arg('label') ?? 'yield';
  const buckets = loadBuckets();

  const projects = await pageAll<Proj>('projects', 'id,name,status,market,region_state');
  const live = projects.filter((p) => p.status !== 'archived' && p.status !== 'deleted');
  const liveById = new Map(live.map((p) => [p.id, p]));

  const leads = await pageAll<Lead>(
    'leads',
    'id,title,url,source,status,location,market,project_id,primary_document_url,has_primary_document,filing_facts'
  );

  const jurisdictionOf = (l: Lead): string =>
    (l.location ?? l.market ?? '(no market)').split(',')[0].trim();

  // Which projects already carry a stored fact. A project that is already off
  // zero cannot be moved off zero, and counting it again would inflate the gain
  // this probe exists to measure.
  const alreadyOffZero = new Set<string>();
  for (const l of leads) {
    if (l.status === 'dismissed' || !l.project_id) continue;
    if ((l.filing_facts ?? []).length > 0) alreadyOffZero.add(l.project_id);
  }

  const held = leads.filter(
    (l) =>
      l.status !== 'dismissed' &&
      l.source === 'legistar' &&
      l.has_primary_document === true &&
      !!l.primary_document_url
  );

  const targets = held.filter(
    (l) => INCLUDE_CLARK || !jurisdictionOf(l).toLowerCase().startsWith('clark')
  );

  console.log('===== WHAT THE HELD LEGISTAR DOCUMENTS WOULD YIELD =====\n');
  console.log(`legistar records holding a document : ${held.length} (no cap, paged)`);
  console.log(`fetched by this probe              : ${targets.length}`);
  console.log(
    INCLUDE_CLARK
      ? 'Clark County INCLUDED (--include-clark).'
      : 'Clark County EXCLUDED from the fetch: already read, yield on file at 73%.'
  );
  console.log(`concurrency ${CONCURRENCY}\n`);

  const results: DocResult[] = [];
  let next = 0;
  let done = 0;

  async function worker(): Promise<void> {
    while (next < targets.length) {
      const l = targets[next++];
      const pages = await fetchPdfPages(l.primary_document_url!);
      const text = pages?.join('\n') ?? '';
      const ok = !!pages && text.replace(/\s/g, '').length >= 400;
      const r: DocResult = {
        lead: l,
        jurisdiction: jurisdictionOf(l),
        ok,
        chars: text.length,
        pages: pages?.length ?? 0,
        codeAmendment: ok ? isCodeAmendment(text) : false,
        byReader: { 'oakland-fields': [], 'clark-agenda-sheet': [], 'title-only': [] },
      };
      if (ok) {
        // EVERY fact goes through the same guard the write path applies, so the
        // number here is the number that could be stored, not the number the
        // regexes matched.
        r.byReader['oakland-fields'] = verifyFilingFacts(readProseOrdinanceFields(text), text);
        r.byReader['clark-agenda-sheet'] = verifyFilingFacts(readFilingFacts(text), text);
      }
      // The title reader needs no document at all, which is the whole point of
      // it. Run on every target whether or not the PDF came back.
      const title = l.title ?? '';
      r.byReader['title-only'] = verifyFilingFacts(readOrdinanceTitleFacts(title), title);
      results.push(r);
      done++;
      if (done % 20 === 0) console.log(`  ${done}/${targets.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

  // ---- PER JURISDICTION -----------------------------------------------------
  const rows = new Map<string, JurRow>();
  const touch = (j: string): JurRow => {
    let r = rows.get(j);
    if (!r) {
      r = {
        jurisdiction: j, held: 0, fetched: 0, unreadable: 0, medianChars: 0,
        oaklandDocs: 0, clarkDocs: 0, titleDocs: 0, anyDocs: 0,
        oaklandFacts: 0, clarkFacts: 0, titleFacts: 0,
        projectsWithDocs: 0, projectsOffZeroNow: 0, projectsWouldMove: 0, kinds: {},
      };
      rows.set(j, r);
    }
    return r;
  };

  const charsBy = new Map<string, number[]>();
  const movers: { jurisdiction: string; project: string; bucket: string; facts: string[] }[] = [];
  const projWithDocs = new Map<string, Set<string>>();
  const projOffZeroNow = new Map<string, Set<string>>();
  const projWouldMove = new Map<string, Set<string>>();

  for (const r of results) {
    const row = touch(r.jurisdiction);
    row.held++;
    if (r.ok) {
      row.fetched++;
      charsBy.set(r.jurisdiction, [...(charsBy.get(r.jurisdiction) ?? []), r.chars]);
    } else {
      row.unreadable++;
    }
    const o = r.byReader['oakland-fields'].length;
    const c = r.byReader['clark-agenda-sheet'].length;
    const t = r.byReader['title-only'].length;
    if (o) row.oaklandDocs++;
    if (c) row.clarkDocs++;
    if (t) row.titleDocs++;
    if (o || c || t) row.anyDocs++;
    row.oaklandFacts += o;
    row.clarkFacts += c;
    row.titleFacts += t;
    for (const f of [...r.byReader['oakland-fields'], ...r.byReader['clark-agenda-sheet'], ...r.byReader['title-only']]) {
      row.kinds[f.kind] = (row.kinds[f.kind] ?? 0) + 1;
    }
    const proj = r.lead.project_id ? liveById.get(r.lead.project_id) : undefined;
    if (proj) {
      const add = (m: Map<string, Set<string>>) => {
        const s = m.get(r.jurisdiction) ?? new Set<string>();
        s.add(proj.id);
        m.set(r.jurisdiction, s);
      };
      add(projWithDocs);
      if (alreadyOffZero.has(proj.id)) add(projOffZeroNow);
      else if (o || c || t) {
        add(projWouldMove);
        if (!movers.some((m) => m.project === proj.name)) {
          movers.push({
            jurisdiction: r.jurisdiction,
            project: proj.name,
            bucket: buckets.get(proj.id) ?? 'UNLABELLED',
            facts: [...r.byReader['oakland-fields'], ...r.byReader['clark-agenda-sheet'], ...r.byReader['title-only']]
              .map((f) => `${f.kind}=${f.display}`),
          });
        }
      }
    }
  }
  for (const [j, cs] of charsBy) touch(j).medianChars = median(cs);
  for (const [j, s] of projWithDocs) touch(j).projectsWithDocs = s.size;
  for (const [j, s] of projOffZeroNow) touch(j).projectsOffZeroNow = s.size;
  for (const [j, s] of projWouldMove) touch(j).projectsWouldMove = s.size;

  const sorted = [...rows.values()].sort((a, b) => b.held - a.held);

  const out: string[] = [];
  out.push('');
  out.push('===== PER JURISDICTION: DOES ANY EXISTING FIELD SET FIT =====');
  out.push('');
  out.push('jurisdiction              docs  read  unrd   medchars   oakDoc oakFct  clkDoc clkFct  titDoc titFct   anyDoc  wouldMove');
  for (const r of sorted) {
    out.push(
      r.jurisdiction.slice(0, 24).padEnd(25) +
        String(r.held).padStart(5) + String(r.fetched).padStart(6) + String(r.unreadable).padStart(6) +
        String(r.medianChars).padStart(11) +
        String(r.oaklandDocs).padStart(9) + String(r.oaklandFacts).padStart(7) +
        String(r.clarkDocs).padStart(8) + String(r.clarkFacts).padStart(7) +
        String(r.titleDocs).padStart(8) + String(r.titleFacts).padStart(7) +
        String(r.anyDocs).padStart(9) + String(r.projectsWouldMove).padStart(11)
    );
  }
  out.push('');
  out.push('docs      = legistar records holding a primary document (the probe fetched every one)');
  out.push('read      = the PDF came back with more than 400 non-space characters');
  out.push('oakDoc    = documents the OAKLAND field set reached, oakFct its total guarded facts');
  out.push('clkDoc    = documents the CLARK AGENDA SHEET field set reached');
  out.push('titDoc    = records whose TITLE alone yielded a fact, no document needed');
  out.push('wouldMove = live projects not already carrying a stored fact that would gain one');

  out.push('');
  out.push('===== WHICH PROJECTS WOULD MOVE, AND WHETHER THEY ARE THE SUBJECT =====');
  out.push('');
  out.push('Bucket is the cached Brief Q judgement. A project moved off zero in a');
  out.push('bucket this register should not hold is cost, not gain.');
  const byBucket = new Map<string, number>();
  for (const m of movers) byBucket.set(m.bucket, (byBucket.get(m.bucket) ?? 0) + 1);
  out.push('');
  for (const [b, n] of [...byBucket.entries()].sort((a, b2) => b2[1] - a[1])) {
    out.push(`  ${b.padEnd(26)}${String(n).padStart(4)}`);
  }
  out.push('');
  for (const m of movers.sort((a, b2) => a.bucket.localeCompare(b2.bucket))) {
    out.push(`  [${m.bucket}] ${m.jurisdiction} :: ${m.project.slice(0, 60)}`);
    for (const f of m.facts.slice(0, 4)) out.push(`        ${f.slice(0, 100)}`);
  }

  out.push('');
  out.push('===== WHICH FACT KINDS, PER JURISDICTION =====');
  for (const r of sorted) {
    const ks = Object.entries(r.kinds).sort((a, b) => b[1] - a[1]);
    out.push('');
    out.push(`${r.jurisdiction} (${r.fetched} readable of ${r.held})`);
    if (!ks.length) {
      out.push('  nothing. No existing field set reached this jurisdiction.');
      continue;
    }
    for (const [k, n] of ks) out.push(`  ${k.padEnd(24)}${String(n).padStart(5)}  ${((n / Math.max(r.fetched, 1)) * 100).toFixed(0)}% of readable`);
  }

  // A handful of verbatim lines per jurisdiction, so a false positive is
  // visible here rather than in a client document.
  out.push('');
  out.push('===== SAMPLE LINES, VERBATIM, SO A FALSE POSITIVE IS VISIBLE =====');
  for (const r of sorted) {
    const samples = results
      .filter((x) => x.jurisdiction === r.jurisdiction)
      .flatMap((x) => [...x.byReader['oakland-fields'], ...x.byReader['clark-agenda-sheet']])
      .slice(0, 8);
    if (!samples.length) continue;
    out.push('');
    out.push(`${r.jurisdiction}`);
    for (const f of samples) out.push(`  [${f.kind}] ${f.display}  <-  ${f.line.slice(0, 110)}`);
  }

  console.log(out.join('\n'));

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(OUT_DIR, `legistar-doc-yield-${stamp}-${label}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        label,
        at: new Date().toISOString(),
        cap:
          'no cap on the corpus read; Clark County ' +
          (INCLUDE_CLARK ? 'included' : 'excluded from the fetch, already read'),
        legistarRecordsHoldingADocument: held.length,
        fetched: targets.length,
        jurisdictions: sorted,
        movers,
      },
      null,
      2
    ) + '\n'
  );
  const back = JSON.parse(readFileSync(file, 'utf8')) as { jurisdictions: unknown[] };
  console.log(`\nWROTE ${file} (${back.jurisdictions.length} jurisdictions read back)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
