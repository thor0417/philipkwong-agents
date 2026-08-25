// READ-ONLY. DO CONDITIONS OF APPROVAL EXIST OUTSIDE CLARK COUNTY AT ALL?
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/conditions-probe.ts [--limit=N]
//
// Nothing is written to the database. Fetched PDFs are cached under
// snapshots/conditions-probe/ so a re-run costs no network.
//
// WHY THIS RUNS BEFORE ANYTHING IS BUILT. Every candidate in the Brief T item 3
// ranking moves facts and decisions, and none of them reaches the standard,
// because the standard includes conditions and readers/clark-agenda-sheet is the
// only reader in this repository that emits one. If conditions are not PUBLISHED
// outside Clark's staff report then the standard is not reachable elsewhere and
// it is a Clark-only criterion, which is a different definition. Better to know
// than to build toward something unreachable.
//
// ONLY THREE MARKETS OUTSIDE CLARK HOLD ACTUAL FILES. Las Vegas, Anaheim and New
// York store listing pages in primary_document_url - 299 of 579 values are a
// portal or viewer page and not one of those is a file, which is the open case
// a-listing-page-stored-as-the-document. So the probe is Nashville's Legistar
// attachments, Oakland's, CFTOD's own PDFs, and Clark's unread agenda sheets.
//
// AND IT CARRIES CONTROLS. A probe that finds nothing everywhere is
// indistinguishable from a probe that does not work, so Clark documents whose
// conditions ALREADY reached the corpus are fetched and read by the same code.
// If the controls come back empty the probe is broken and the negatives mean
// nothing.
import { supabaseAdmin } from '../../../lib/supabase-admin';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const CACHE = path.join('snapshots', 'conditions-probe');
const UA = 'philipkwong-agents/1.0 (+scraper)';
const arg = (k: string) => (process.argv.find((a) => a.startsWith('--' + k + '=')) ?? '').split('=')[1] ?? '';
const LIMIT = Number(arg('limit')) || 0;

// ---- WHAT A CONDITION LOOKS LIKE, BROADER THAN CLARK'S FORM -----------------
//
// Clark's own reader keys on a heading plus BULLETS under a department, because
// measured over 87 Clark documents the median count of NUMBERED items under a
// conditions heading is zero. A probe looking only for that shape would find
// Clark and miss a jurisdiction that numbers them, which is precisely the
// question. So this looks for the heading in every form seen in the wild, and
// then counts BOTH delimiters underneath it.
const HEADINGS: [string, RegExp][] = [
  ['PRELIMINARY STAFF CONDITIONS', /PRELIMINARY STAFF CONDITIONS/i],
  ['CONDITIONS OF APPROVAL', /CONDITIONS OF APPROVAL/i],
  ['CONDITIONS:', /^\s*CONDITIONS\s*:/im],
  ['subject to the following conditions', /subject to the following conditions?/i],
  ['conditioned upon', /conditioned upon/i],
  ['subject to the conditions', /subject to the conditions/i],
  ['CONDITIONS OF THE PERMIT', /CONDITIONS OF (THE )?(PERMIT|APPROVAL|USE)/i],
  ['standard conditions', /standard conditions/i],
];

const BULLET = /^[ \t]*[•·▪●-][ \t]*(.{12,})$/;
const NUMBERED = /^[ \t]*(\d{1,3}[.)]|\([a-z0-9]{1,3}\)|[A-Z][.)])[ \t]+(.{12,})$/;

interface Probe {
  market: string;
  role: 'probe' | 'CONTROL';
  url: string;
  ok: boolean;
  note: string;
  pages: number;
  chars: number;
  heading: string | null;
  numbered: number;
  bulleted: number;
  samples: string[];
}

async function fetchPdf(url: string): Promise<Buffer | null> {
  mkdirSync(CACHE, { recursive: true });
  const key = createHash('sha1').update(url).digest('hex') + '.pdf';
  const at = path.join(CACHE, key);
  if (existsSync(at)) return readFileSync(at);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(45_000) });
    // READ THE BODY, NOT THE STATUS CODE. A portal answering 200 with an HTML
    // error page is the shape this repo has been caught by before.
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') return null;
    writeFileSync(at, buf);
    return buf;
  } catch {
    return null;
  }
}

function readConditions(text: string): Pick<Probe, 'heading' | 'numbered' | 'bulleted' | 'samples'> {
  let heading: string | null = null;
  let at = -1;
  for (const [name, re] of HEADINGS) {
    const m = text.search(re);
    if (m > -1 && (at === -1 || m < at)) {
      at = m;
      heading = name;
    }
  }
  if (at === -1) return { heading: null, numbered: 0, bulleted: 0, samples: [] };

  // A generous window: the conditions block of a staff report runs long, and
  // this counts rather than extracts, so overshooting costs a false positive on
  // a numbered list that is something else - which the samples make visible.
  const body = text.slice(at, at + 20_000);
  const lines = body.split(/\r?\n/);
  let numbered = 0;
  let bulleted = 0;
  const samples: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const n = NUMBERED.exec(raw);
    const b = BULLET.exec(raw);
    if (n) {
      numbered++;
      if (samples.length < 3) samples.push('NUMBERED  ' + line.slice(0, 150));
    } else if (b) {
      bulleted++;
      if (samples.length < 3) samples.push('BULLET    ' + line.slice(0, 150));
    }
  }
  return { heading, numbered, bulleted, samples };
}

async function pageAll(table: string, columns: string): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(table + ': ' + error.message);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const isFile = (u: string) => /\.(pdf|docx?|rtf|txt)(\?|$)/i.test(u);

async function main(): Promise<void> {
  const leads = await pageAll(
    'leads',
    'id,title,market,status,source,source_type,primary_document_url,filing_facts'
  );
  const live = leads.filter(
    (l) => l.status !== 'dismissed' && !!l.primary_document_url && isFile(l.primary_document_url)
  );
  const hasFacts = (l: any) => Array.isArray(l.filing_facts) && l.filing_facts.length > 0;
  const hasConds = (l: any) =>
    Array.isArray(l.filing_facts) && l.filing_facts.some((f: any) => f?.kind === 'condition');

  const pick = (
    label: string,
    role: 'probe' | 'CONTROL',
    filter: (l: any) => boolean
  ): { market: string; role: 'probe' | 'CONTROL'; url: string }[] => {
    const urls = new Set<string>();
    for (const l of live.filter(filter)) urls.add(l.primary_document_url);
    return [...urls].map((url) => ({ market: label, role, url }));
  };

  let targets = [
    ...pick('Nashville', 'probe', (l) => l.market === 'Nashville' && !hasFacts(l)),
    // OAKLAND IN FULL, not only the unread ones. The question here is whether the
    // JURISDICTION publishes a condition, so filtering to documents that produced
    // no fact would answer a narrower question and read as the wider one.
    ...pick('Oakland', 'probe', (l) => l.market === 'Oakland'),
    ...pick('CFTOD', 'probe', (l) => l.source === 'cftod-pdf' && !hasFacts(l)),
    ...pick('Clark unread agenda', 'probe', (l) => l.source === 'clark-tab' && !hasFacts(l)),
    ...pick('Clark legistar attach', 'probe', (l) => l.source === 'legistar' && l.market === 'Clark County' && !hasFacts(l)),
    // THE CONTROLS. Clark documents whose conditions already reached the corpus.
    ...pick('Clark CONTROL', 'CONTROL', (l) => hasConds(l)).slice(0, 3),
  ];
  if (LIMIT) targets = targets.slice(0, LIMIT);

  console.log('===== DO CONDITIONS EXIST OUTSIDE CLARK? =====');
  console.log('records read ' + leads.length + ' (paged to exhaustion, no cap)');
  console.log('distinct documents to fetch: ' + targets.length + ' (no cap on the set; every distinct file in each group)');
  console.log('');

  const results: Probe[] = [];
  for (const t of targets) {
    const buf = await fetchPdf(t.url);
    if (!buf) {
      results.push({ ...t, ok: false, note: 'not fetched, or not a PDF body', pages: 0, chars: 0, heading: null, numbered: 0, bulleted: 0, samples: [] });
      continue;
    }
    try {
      const parsed = await pdfParse(buf);
      const text = parsed.text ?? '';
      const found = readConditions(text);
      results.push({ ...t, ok: true, note: '', pages: parsed.numpages ?? 0, chars: text.length, ...found });
    } catch (e) {
      results.push({ ...t, ok: false, note: 'parse failed: ' + (e as Error).message.slice(0, 60), pages: 0, chars: 0, heading: null, numbered: 0, bulleted: 0, samples: [] });
    }
  }

  const groups = [...new Set(results.map((r) => r.market))];
  for (const g of groups) {
    const rs = results.filter((r) => r.market === g);
    const fetched = rs.filter((r) => r.ok);
    const withHeading = fetched.filter((r) => r.heading);
    const withItems = fetched.filter((r) => r.numbered + r.bulleted > 0);
    console.log('===== ' + g + ' =====');
    console.log(
      '  documents ' + rs.length + ', fetched and parsed ' + fetched.length +
      ', a conditions heading ' + withHeading.length + ', items under it ' + withItems.length
    );
    if (fetched.length === 0) {
      for (const r of rs.slice(0, 3)) console.log('    ' + r.note + '  ' + r.url.slice(0, 110));
    }
    for (const r of withItems.slice(0, 3)) {
      console.log('    ' + r.heading + '  numbered ' + r.numbered + ', bulleted ' + r.bulleted +
        '  (' + r.pages + 'pp, ' + r.chars + ' chars)');
      for (const s of r.samples) console.log('      ' + s);
    }
    const emptyButFetched = fetched.filter((r) => !r.heading);
    if (emptyButFetched.length > 0) {
      console.log('    no conditions heading in ' + emptyButFetched.length + ' of ' + fetched.length +
        '; median chars ' + Math.round(emptyButFetched.reduce((n, r) => n + r.chars, 0) / emptyButFetched.length));
    }
    console.log('');
  }

  const controls = results.filter((r) => r.role === 'CONTROL');
  const controlsWorking = controls.filter((r) => r.ok && r.numbered + r.bulleted > 0).length;
  console.log('===== IS THE PROBE ITSELF WORKING? =====');
  console.log('  controls: ' + controlsWorking + ' of ' + controls.length + ' Clark documents with known conditions came back with items');
  if (controls.length > 0 && controlsWorking === 0) {
    console.log('  THE PROBE IS BROKEN. Every negative above means nothing.');
    process.exit(1);
  }
  console.log('  so a negative above is a fact about the document, not about this code.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
