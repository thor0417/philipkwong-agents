// READ-ONLY. BRIEF Q ITEM 3: do the reachable CPC reports carry obligation
// clauses, what do they look like, and what does one document cost to read?
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/resolution-clause-measure.ts [--show=N]
//
// Nothing is written and no reader is built by this file. It exists because the
// conditions reader for legal resolutions was refused once already, on the
// argument that a CPC report is a legal resolution and the Clark extractor is an
// administrative checklist. That argument is still correct. What changed is the
// question: Brief Q item 1 measured that conditions are the ONLY term standing
// between eight New York hospitality developments and a sendable brief, and that
// all fifteen referral-ready projects are Clark County because Clark is the only
// jurisdiction with a conditions reader.
//
// So this measures the DOCUMENTS rather than re-arguing the category, and it
// prints real clauses rather than counts, because "159 occurrences of shall"
// says nothing about whether any of them is an obligation a client would act on.

import { isCpcReport } from '../readers/cpc-report';

const SHOW = Number((process.argv.find((a) => a.startsWith('--show=')) ?? '').split('=')[1]) || 4;
const UA = 'philipkwong-agents/1.0 (+development intelligence)';
const CPC = (n: string) => `https://www.nyc.gov/assets/planning/download/pdf/about/cpc/${n}.pdf`;

// The 13 that return a PDF, measured by nyc-cpc-reach and re-confirmed by
// cpc-gain. Hardcoded here so this file is a measurement of known documents
// rather than a second implementation of the reach probe.
const REACHABLE = [
  ['240092', 'Metropolitan Park / Willets Point'],
  ['240094', 'Metropolitan Park / Willets Point'],
  ['240095', 'Metropolitan Park / Willets Point'],
  ['240058', 'Metropolitan Park / Willets Point'],
  ['240353', 'Port Authority Bus Terminal Replacement'],
  ['240354', 'Port Authority Bus Terminal Replacement'],
  ['240336', 'Port Authority Bus Terminal Replacement'],
  ['250326', 'Monitor Point'],
  ['250224', 'Long Island City Neighborhood Rezoning'],
  ['250108', 'The Coney (Coney Island casino)'],
  ['230070', '1400 Story Avenue (York Studios)'],
  ['250046', 'Queens Future map change and amendment'],
  ['250047', 'Queens Future map change and amendment'],
] as const;

// ---- WHAT AN OBLIGATION CLAUSE LOOKS LIKE IN A LEGAL RESOLUTION -------------
//
// Not a heading, a bullet or a department name - a CPC report has none of those,
// which is exactly why the Clark extractor returns nothing on one. A resolution
// states obligations in sentences, and the sentence is the unit.
//
// Three shapes, ordered by how load-bearing they are. Every one of them is a
// SENTENCE-LEVEL pattern, so what is captured is a whole clause a reader can
// act on rather than a fragment around a keyword.
const CLAUSE_SHAPES: { key: string; note: string; re: RegExp }[] = [
  {
    key: 'resolved-that',
    note: 'the operative clause of the resolution itself',
    re: /\bRESOLVED[,\s]+that\b[^.]{0,600}\./gi,
  },
  {
    key: 'subject-to',
    note: 'the approval conditioned on something',
    re: /\b(?:approved|adopted|granted|modified)\s+subject\s+to\b[^.]{0,600}\./gi,
  },
  {
    key: 'shall-obligation',
    note: 'a duty placed on a named party',
    re: /\b(?:[A-Z][\w'&.,-]*(?:\s+[A-Z][\w'&.,-]*){0,6}|The\s+applicant|the\s+applicant|Applicant)\s+shall\b[^.]{0,500}\./g,
  },
];

interface Doc {
  num: string;
  project: string;
  bytes: number;
  pages: number;
  chars: number;
  fetchMs: number;
  parseMs: number;
  extractMs: number;
  isCpc: boolean;
  clauses: Record<string, string[]>;
  total: number;
}

async function one(num: string, project: string): Promise<Doc | null> {
  const t0 = Date.now();
  const res = await fetch(CPC(num), { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  const fetchMs = Date.now() - t0;

  const t1 = Date.now();
  const pdf = (await import('pdf-parse/lib/pdf-parse.js')).default;
  const parsed = await pdf(buf);
  const text = String(parsed.text ?? '');
  const parseMs = Date.now() - t1;

  const t2 = Date.now();
  const flat = text.replace(/\s+/g, ' ');
  const clauses: Record<string, string[]> = {};
  let total = 0;
  for (const s of CLAUSE_SHAPES) {
    s.re.lastIndex = 0;
    const hits = [...flat.matchAll(s.re)].map((m) => m[0].trim());
    // Every captured clause must be a verbatim substring of the flattened text,
    // which it is by construction here - asserted anyway, because the reader
    // built from this measurement will have to satisfy verifyFilingFacts and a
    // shape that cannot pass the check here will not pass it there either.
    for (const h of hits) if (!flat.includes(h)) throw new Error(`not verbatim: ${h.slice(0, 60)}`);
    clauses[s.key] = hits;
    total += hits.length;
  }
  const extractMs = Date.now() - t2;

  return {
    num, project, bytes: buf.length, pages: parsed.numpages, chars: text.length,
    fetchMs, parseMs, extractMs, isCpc: isCpcReport(text), clauses, total,
  };
}

async function main(): Promise<void> {
  const docs: Doc[] = [];
  for (const [num, project] of REACHABLE) {
    const d = await one(num, project);
    if (d) docs.push(d);
    await new Promise((r) => setTimeout(r, 400));
  }

  console.log('='.repeat(104));
  console.log('OBLIGATION CLAUSES IN THE 13 REACHABLE CPC REPORTS');
  console.log('='.repeat(104));
  console.log('num      pages    chars   RESOLVED-that  subject-to  X-shall   total   fetch   parse  extract');
  for (const d of docs) {
    console.log(
      d.num.padEnd(9) + String(d.pages).padStart(5) + String(d.chars).padStart(9) +
      String(d.clauses['resolved-that'].length).padStart(15) +
      String(d.clauses['subject-to'].length).padStart(12) +
      String(d.clauses['shall-obligation'].length).padStart(9) +
      String(d.total).padStart(8) +
      (d.fetchMs + 'ms').padStart(8) + (d.parseMs + 'ms').padStart(8) + (d.extractMs + 'ms').padStart(9)
    );
  }

  const withAny = docs.filter((d) => d.total > 0);
  const projects = new Set(withAny.map((d) => d.project));
  console.log('');
  console.log(`documents read                          : ${docs.length}`);
  console.log(`carrying at least one obligation clause : ${withAny.length}`);
  console.log(`distinct PROJECTS they belong to        : ${projects.size}  (${[...projects].join('; ')})`);
  console.log(`total clauses across all documents      : ${docs.reduce((s, d) => s + d.total, 0)}`);

  // ---- COST, MEASURED --------------------------------------------------------
  const sum = (f: (d: Doc) => number) => docs.reduce((s, d) => s + f(d), 0);
  const med = (f: (d: Doc) => number) => {
    const v = docs.map(f).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };
  console.log('');
  console.log('COST PER DOCUMENT, measured on this run rather than estimated:');
  console.log(`  bytes      median ${(med((d) => d.bytes) / 1e6).toFixed(2)}MB   total ${(sum((d) => d.bytes) / 1e6).toFixed(1)}MB`);
  console.log(`  pages      median ${med((d) => d.pages)}          total ${sum((d) => d.pages)}`);
  console.log(`  fetch      median ${med((d) => d.fetchMs)}ms      total ${(sum((d) => d.fetchMs) / 1000).toFixed(1)}s`);
  console.log(`  pdf parse  median ${med((d) => d.parseMs)}ms      total ${(sum((d) => d.parseMs) / 1000).toFixed(1)}s`);
  console.log(`  extract    median ${med((d) => d.extractMs)}ms      total ${sum((d) => d.extractMs)}ms`);
  console.log(`  NO MODEL CALL. The clause shapes are regular expressions over the text layer,`);
  console.log(`  so the marginal cost of a document is the fetch and the PDF parse and nothing else.`);

  // ---- WHAT THEY ACTUALLY LOOK LIKE -----------------------------------------
  console.log('');
  console.log('='.repeat(104));
  console.log(`WHAT THE CLAUSES SAY. ${SHOW} per shape, verbatim, so the shape can be judged rather than counted.`);
  console.log('='.repeat(104));
  for (const s of CLAUSE_SHAPES) {
    const all = docs.flatMap((d) => d.clauses[s.key].map((c) => ({ num: d.num, c })));
    console.log(`\n--- ${s.key}: ${s.note}   (${all.length} across ${docs.filter((d) => d.clauses[s.key].length).length} documents)`);
    for (const { num, c } of all.slice(0, SHOW)) {
      console.log(`  [${num}] ${c.replace(/\s+/g, ' ').slice(0, 400)}`);
    }
  }

  // The refusal's own test, answered with the corpus rather than with intuition.
  console.log('');
  console.log('='.repeat(104));
  console.log('DOES THE SHAPE REACH ANYTHING OUTSIDE NEW YORK?');
  console.log('='.repeat(104));
  console.log('Not answerable from these 13 documents, which are all New York. It is answered');
  console.log('against the corpus by resolution-clause-reach, and stated in the report.');
}

main().catch((e) => { console.error(e); process.exit(1); });
