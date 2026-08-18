// EVERY LABEL THESE DOCUMENTS USE, BEFORE ANY PATTERN IS WRITTEN AGAINST THEM.
//
//   node --env-file=.env.local --import tsx agents/scraper/diagnostics/ceqr-labels.ts
//   node ... ceqr-labels.ts --kind draft_scope --sample 20
//
// THIS IS THE PRECONDITION, NOT A NICE-TO-HAVE.
//
// CEQR form pages flatten. Side-by-side fields join with NO separator at all, so
// the extracted text reads
//
//   Christopher JewettApplicant's Administrator: Carol Rosenthal
//
// A value in that text has exactly one possible terminator: THE NEXT LABEL.
// There is no punctuation, no whitespace and no line break to stop at, so a
// pattern that stops anywhere else takes the next field's label into the value,
// and a pattern built from a label list with a hole in it silently swallows the
// field whose label is missing. That is not hypothetical here - it is the shape
// of the golden case a-field-list-with-a-hole-deletes-a-field, and it is the
// same shape as the CEQR lead agency hole fixed yesterday.
//
// So the label set is ENUMERATED FROM REAL DOCUMENTS FIRST, exhaustively, and
// printed with counts. A label seen once is still a terminator. A label nobody
// enumerated is a deleted field.
//
// WHAT IT DOES NOT DO: extract a party. Not one name is read out of these
// documents by this file. It reports what labels exist and how often, and the
// party layer is written afterwards, against the enumeration, by a person who
// has seen it.

import { readFileSync, existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { rehydrate, type CeqrProjectDocuments, type CeqrDocument } from '../sources/nyc-ceqr-documents';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? (process.argv[i + 1] ?? null) : null;
};
// UNFILED FIRST, AND THAT ORDERING IS THE FINDING.
//
// A document filed at the project ROOT has no directory to type it by, so
// kindFromPath calls it 'unfiled' - and those are the City Planning Commission
// reports. A CPC report is a ULURP document sitting in CEQR Access, and it is
// the ONLY kind that carries the named individuals: "Applicant:" and
// "Applicant's Administrator:" are on the Borough President and Community Board
// recommendation forms appended to the back of it.
//
// The enumeration found no party label in any draft scope or EAS because there
// is none in them. Three kinds, three different yields:
//
//   unfiled (CPC reports)   the named individuals
//   draft_scope covers      "Prepared By", the consultant
//   lead_agency_letter      identity and geography, never a party
const KINDS = (arg('kind') ?? 'unfiled,draft_scope,lead_agency_letter').split(',');
const SAMPLE = Number(arg('sample') ?? 12);
const IN = 'agents/scraper/fixtures/ceqr-inventory.jsonl';
const MAX_PDF_BYTES = Number(arg('maxbytes') ?? 40_000_000);

// ---- HOW FAR INTO A DOCUMENT THE LABELS ARE, PER KIND -----------------------
//
// A FRONT-PAGE CAP IS RIGHT FOR A FORM AND WRONG FOR A REPORT, and the whole
// point of measuring per kind is that one number cannot be both.
//
// Measured on Bally's 250085.pdf, 41 pages: the Borough President Recommendation
// is on page 23 and the Community/Borough Board Recommendations are on pages 37,
// 38 and 39. A six-page cap misses every one of them, and misses them SILENTLY -
// the pass reports "0 of N documents carry Applicant:" and reads as a finding
// about the corpus rather than about the cap.
//
// So an unfiled document is read WHOLE. It is the only kind where the value is
// at the back, it is 1.4MB rather than 15MB, and there is one of them.
const PAGE_CAP_BY_KIND: Record<string, number> = {
  // 0 means every page. The forms are appended after the report body.
  unfiled: 0,
  // A cover sheet. "Prepared By" is on page 1.
  draft_scope: 6,
  // Two pages, and both of them are letterhead.
  lead_agency_letter: 0,
  eas: 12,
};
const PAGE_CAP_DEFAULT = Number(arg('pages') ?? 6);
const pageCapFor = (kind: string): number =>
  arg('pages') !== null ? PAGE_CAP_DEFAULT : (PAGE_CAP_BY_KIND[kind] ?? PAGE_CAP_DEFAULT);

// ---- THE THREE LABELS THAT MAY EVER PRODUCE A PARTY -------------------------
//
// OFFICIALS NEVER BECOME PARTIES. A lead agency letter is signed by a
// commissioner and addressed to the director of the Mayor's Office of
// Environmental Coordination; a CPC report carries the chair and the
// commissioners who voted. Garodnick, Russo and Lenard are public officials
// doing their jobs and none of them is behind the development.
//
// So the party layer keys on these three labels and reads NOTHING from a
// signature block, a letterhead, an addressee line or a title block. This list
// is here rather than in a reader because the reader does not exist yet and this
// is the file that measures whether the labels are even present.
//
// THE APOSTROPHE IS U+2019, NOT ASCII. The document prints
//
//   Applicant: Christopher JewettApplicant’s Administrator: Carol Rosenthal
//
// with a RIGHT SINGLE QUOTATION MARK. Matched with an ASCII apostrophe, two of
// these three labels never fire, and the failure is silent and total: the value
// they terminate runs on into the next field. That is the field-list-with-a-hole
// shape one character wide, and it was in this file's first draft. So text and
// labels are both normalised before comparison, and the normaliser is the only
// place the two forms are allowed to meet.
const PARTY_LABELS = ['Applicant:', "Applicant's Administrator:", "Applicant's Primary Contact:"];

/** Curly quotes to straight, so a label list cannot miss on punctuation. */
function normaliseQuotes(s: string): string {
  return s.replace(/[‘’ʼʹ]/g, "'").replace(/[“”]/g, '"');
}

// ---- WHAT COUNTS AS A LABEL -------------------------------------------------
//
// A capitalised phrase ending in a colon, at most six words, not preceded by a
// lower-case letter mid-sentence. Deliberately GENEROUS: this is an enumeration
// and a false positive costs a line of output, while a false negative is a field
// that a future pattern deletes. Every candidate is printed with its count so a
// person can draw the line, rather than the line being drawn here by a regex
// nobody will revisit.
const LABEL = /(?:^|[^a-z])((?:[A-Z][A-Za-z’'()\/.-]*(?:\s+(?:of|the|and|for|to|a|an)\s+|\s+)?){1,6}?):/g;

interface Doc { doc: CeqrDocument; text: string; pages: number }

async function fetchText(d: CeqrDocument, pageCap: number): Promise<Doc | { doc: CeqrDocument; failure: string }> {
  try {
    const res = await fetch(d.url, { headers: { 'user-agent': 'philipkwong-agents/1.0' } });
    const type = res.headers.get('content-type') ?? '';
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok) return { doc: d, failure: `HTTP ${res.status}` };
    // A ZIP IS NOT A HARDER PDF. It is a different pipeline and this pass does
    // not have one, so it is reported as skipped with its size rather than
    // silently dropped: the count of what an unzip step would add is the whole
    // argument for building one.
    if (/zip/i.test(type) || d.extension === 'zip') {
      return { doc: d, failure: `archive, ${(buf.length / 1e6).toFixed(1)}MB, needs an unzip step` };
    }
    if (!/pdf/i.test(type)) return { doc: d, failure: `not a PDF: ${type}` };
    // A SIZE CEILING, STATED WHEN IT BINDS. A draft scope of work reaches
    // hundreds of pages and pdf-parse is not fast on them. The label set lives
    // on the cover and in the first form pages, so an enumeration pass does not
    // need the whole document, and a pass that silently takes twenty minutes is
    // a pass nobody runs twice.
    if (buf.length > MAX_PDF_BYTES) {
      return { doc: d, failure: `${(buf.length / 1e6).toFixed(1)}MB, above the ${MAX_PDF_BYTES / 1e6}MB ceiling for this pass` };
    }
    // @ts-ignore - declared in ../sources/pdf-parse.d.ts
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
    // ONLY THE FIRST PAGES, AND THE LIMIT IS STATED IN THE OUTPUT.
    //
    // The label set is a property of the COVER AND THE FORM PAGES: "Prepared By",
    // "Applicant", "Lead Agency", "CEQR Number", "Block/Lot". The body of a draft
    // scope of work is 50 to 300 pages of chapter prose with no fields in it at
    // all, and parsing it costs minutes per document - the first run of this pass
    // was still on document five after fifteen minutes.
    //
    // This is a real limit on the enumeration and it is why the page count is
    // printed beside every document: if a label only ever appears on page 40, it
    // is not in this list, and the run says how far it looked.
    const { text, numpages } = await pdfParse(buf, { max: pageCap });
    return { doc: d, text, pages: numpages };
  } catch (e) {
    return { doc: d, failure: e instanceof Error ? e.message : String(e) };
  }
}

function labelsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of normaliseQuotes(text).matchAll(LABEL)) {
    const raw = m[1].replace(/\s+/g, ' ').trim();
    if (!raw || raw.length < 3 || raw.length > 60) continue;
    // A sentence that happens to end in a colon is not a label. A label is a
    // field name: it does not contain a full stop and it is not a whole clause.
    if (/[.]/.test(raw) && !/^(No|Mr|Ms|Dr|St)\b/.test(raw)) continue;
    out.push(`${raw}:`);
  }
  return out;
}

async function main(): Promise<void> {
  if (!existsSync(IN)) {
    throw new Error(`No inventory at ${IN}. Run agents/scraper/diagnostics/ceqr-inventory.ts first.`);
  }
  // REHYDRATED, NOT TRUSTED. The cache has held a wrong extension and a wrong
  // handler path, and both looked like the source failing rather than like our
  // own stale derivation. See rehydrate.
  const projects: CeqrProjectDocuments[] = rehydrate(
    readFileSync(IN, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  );

  for (const kind of KINDS) {
    const picks = projects.flatMap((p) => p.documents).filter((d) => d.kind === kind).slice(0, SAMPLE);
    const cap = pageCapFor(kind);
    console.log('\n' + '='.repeat(78));
    console.log(`${kind.toUpperCase()}: enumerating labels across ${picks.length} documents` +
      `, reading ${cap === 0 ? 'every page' : `the first ${cap} pages`}`);
    console.log('='.repeat(78));

    const labelCounts = new Map<string, number>();
    const docsWithLabel = new Map<string, Set<string>>();
    const read: Doc[] = [];
    const skipped: { doc: CeqrDocument; failure: string }[] = [];
    for (const [i, d] of picks.entries()) {
      // PROGRESS PER DOCUMENT, because these are not small files. A draft scope
      // of work runs to hundreds of pages and the first run of this pass sat
      // silent for fifteen minutes, which is indistinguishable from a hang.
      process.stdout.write(`  [${i + 1}/${picks.length}] ${d.label} ... `);
      const r = await fetchText(d, cap);
      if ('failure' in r) {
        console.log(r.failure);
        skipped.push(r);
        continue;
      }
      console.log(`read ${cap === 0 ? r.pages : Math.min(r.pages, cap)} of ${r.pages} pages, ${r.text.length} chars`);
      read.push(r);
      for (const l of new Set(labelsIn(r.text))) {
        labelCounts.set(l, (labelCounts.get(l) ?? 0) + 1);
        if (!docsWithLabel.has(l)) docsWithLabel.set(l, new Set());
        docsWithLabel.get(l)!.add(d.ceqr);
      }
      await sleep(250);
    }

    console.log(`  read ${read.length}, skipped ${skipped.length}`);
    for (const s of skipped) console.log(`      SKIPPED ${s.doc.label}: ${s.failure}`);
    if (!read.length) continue;

    // ---- THE THREE PARTY LABELS, FIRST AND SEPARATELY ---------------------
    //
    // Whether the document that is most common is the document that carries the
    // parties is the question this pass exists to answer, and it must not be
    // buried in a frequency table.
    console.log('\n  THE THREE LABELS THAT MAY PRODUCE A PARTY');
    for (const p of PARTY_LABELS) {
      const hits = read.filter((r) => normaliseQuotes(r.text).includes(p));
      // HOW FAR IN, because that is what sets the page cap. A label at 56% of
      // the way through a 41-page report is invisible to a front-pages read, and
      // the run has to say so rather than report a zero.
      const where = hits.length
        ? (() => {
            const t = normaliseQuotes(hits[0].text);
            const at = t.indexOf(p);
            return `  e.g. ${hits[0].doc.ceqr} at ${Math.round((at / t.length) * 100)}% of the text`;
          })()
        : '';
      console.log(
        `    ${p.padEnd(30)} ${String(hits.length).padStart(3)} of ${read.length} documents${where}`
      );
    }

    console.log('\n  EVERY LABEL SEEN, MOST COMMON FIRST');
    console.log('  (a label seen once is still a terminator; a label missing here is a deleted field)');
    const sorted = [...labelCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    for (const [label, n] of sorted) {
      console.log(`    ${String(n).padStart(3)}/${read.length}  ${label}`);
    }
    console.log(`  ${sorted.length} distinct labels`);

    // ---- THE FLATTENING, SHOWN RATHER THAN ASSERTED ------------------------
    //
    // A label immediately preceded by a lower-case letter is a field that has
    // been glued to the end of the previous value. Printed with its context,
    // because this is the evidence that the next label is the only terminator.
    console.log('\n  FLATTENED JOINS (a label glued to the end of the previous value)');
    let shown = 0;
    for (const r of read) {
      for (const m of normaliseQuotes(r.text).matchAll(/([a-z0-9]{2,})((?:[A-Z][A-Za-z']*\s*){1,4}:)/g)) {
        if (shown >= 12) break;
        const at = m.index ?? 0;
        const t = normaliseQuotes(r.text);
        console.log(`    ${r.doc.ceqr}  ...${t.slice(Math.max(0, at - 45), at + 70).replace(/\s+/g, ' ')}...`);
        shown++;
      }
      if (shown >= 12) break;
    }
    if (shown === 0) console.log('    none seen in this sample');
  }

  console.log('\n' + '='.repeat(78));
  console.log('NO PATTERN IS WRITTEN IN THIS FILE, AND NONE SHOULD BE WRITTEN UNTIL THE');
  console.log('LIST ABOVE HAS BEEN READ. A value here is terminated only by the next');
  console.log('label, so the extractor is the label set and nothing else.');
  console.log('='.repeat(78));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
