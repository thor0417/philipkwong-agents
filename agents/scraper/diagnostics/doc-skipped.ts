// READ-ONLY. IS THE MISSING MATERIAL IN THE DOCUMENTS WE READ, OR THE ONES WE SKIP?
//
//   node --import tsx agents/scraper/diagnostics/doc-skipped.ts <docdir>
//
// THE QUESTION THIS SETTLES. legistar-attachments does two things that bound what
// can ever be found: it DROPS any attachment whose filename reads as a drawing
// (DRAWING_NAME), and it STOPS at the first document carrying a contact block. If
// the addresses, parcel numbers, room counts and design teams are in the
// documents it already opens, then a better reader is a small change. If they are
// in the ones it never opens, then the ceiling is the selection rule and no
// amount of better parsing moves it.
//
// The two rules are reproduced here VERBATIM from the extractor rather than
// re-expressed, because a paraphrase would measure a rule nobody runs.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.argv[2];
if (!DIR) { console.error('usage: doc-skipped.ts <docdir>'); process.exit(1); }

interface Doc {
  file: string; jurisdiction: string; adapter: string; docName: string;
  url: string; pages: number; chars: number;
}

// Copied from sources/legistar-attachments.ts.
const DRAWING_NAME = /(color[_ ]?merged|\bmaps?\b|exhibit|elevation|drawing|site\s*plan|landscape|render|photo|survey|plat\b|aerial)/i;
const DOC_PRIORITY: RegExp[] = [
  /staff\s*report/i, /agenda\s*sheet/i, /^\d+[\s_-]/, /application/i,
  /justification/i, /\breport\b/i, /letter/i, /memo/i,
];

const manifest: Doc[] = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
const texts = new Map<string, string>();
for (const d of manifest) {
  try { texts.set(d.file, readFileSync(join(DIR, d.file), 'utf8').replace(/[ \t ]+/g, ' ')); } catch { /* skip */ }
}
const readable = manifest.filter((d) => (texts.get(d.file) ?? '').replace(/\s/g, '').length >= 400);
const legistar = readable.filter((d) => d.adapter === 'legistar');

const skipped = legistar.filter((d) => DRAWING_NAME.test(d.docName));
const kept = legistar.filter((d) => !DRAWING_NAME.test(d.docName));

const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(0) + '%' : '-');

const SIGNALS: [string, RegExp][] = [
  ['APN, numeric', /\b\d{3}-\d{2}-\d{3}\b/],
  ['street address', /\b\d{2,6}\s+(?:[NSEW]\.?\s+)?[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3}\s+(Street|St\.|Avenue|Ave\.|Road|Rd\.|Boulevard|Blvd\.|Drive|Dr\.|Lane|Way|Parkway|Pkwy|Highway|Hwy)\b/],
  ['acreage', /\b[\d,.]+[\s-]acres?\b/i],
  ['square footage', /\b[\d,.]+\s*(?:square[\s-]?f(?:ee|oo)t|sq\.?\s?ft\.?)\b/i],
  ['storeys', /\b\d{1,3}[\s-]?stor(?:y|ey|ies|eys)\b/i],
  ['rooms or keys', /\b[\d,]{2,7}[\s-]?(?:guest[\s-]?|hotel[\s-]?)?(?:rooms?|keys)\b/i],
  ['parking spaces', /\b[\d,]{1,6}\s*(?:parking\s+)?(?:spaces|stalls)\b/i],
  ['conditions heading', /\b(conditions of approval|CONDITIONS:|subject to the following conditions)/i],
  ['TAB/CAC hearing line', /\bTAB\/CAC\b/i],
  ['an APPLICANT label', /(^|\n)[ \t]*APPLICANT[ \t]*:/i],
  ['architect, the word', /\barchitect(?:ure|s)?\b/i],
  ['engineer, the word', /\bengineer(?:ing|s)?\b/i],
  ['a professional suffix', /\b(AIA|ASLA|P\.?E\.?|R\.?A\.?|LEED|PLS)\b/],
  ['a legal-suffix entity', /\b[A-Z][\w&'.-]*\s+(?:LLC|Inc\.?|Corp\.?|Ltd\.?|LP|LLP|PLLC|Partners|Associates|Group)\b/],
  ['an email address', /[\w.+-]+@[\w-]+\.[\w.-]+/],
];

console.log('===== CLARK-STYLE ATTACHMENTS: READ VERSUS SKIPPED =====\n');
console.log('The extractor drops an attachment whose FILENAME reads as a drawing.');
console.log('These are those documents, fetched anyway, and read.\n');
console.log(`legistar attachments with readable text : ${legistar.length}`);
console.log(`  the extractor would open              : ${kept.length}`);
console.log(`  the extractor drops unread            : ${skipped.length}`);
const kc = kept.map((d) => d.chars).sort((a, b) => a - b);
const sc = skipped.map((d) => d.chars).sort((a, b) => a - b);
console.log(`  median chars, opened                  : ${kc[Math.floor(kc.length / 2)] ?? 0}`);
console.log(`  median chars, dropped                 : ${sc[Math.floor(sc.length / 2)] ?? 0}`);

console.log('\nsignal                        opened            dropped           delta');
for (const [name, re] of SIGNALS) {
  const k = kept.filter((d) => re.test(texts.get(d.file)!)).length;
  const s = skipped.filter((d) => re.test(texts.get(d.file)!)).length;
  const dk = kept.length ? k / kept.length : 0;
  const ds = skipped.length ? s / skipped.length : 0;
  const delta = ds - dk;
  console.log(
    `${name.padEnd(30)}${`${k}/${kept.length} (${pct(k, kept.length)})`.padEnd(18)}${`${s}/${skipped.length} (${pct(s, skipped.length)})`.padEnd(18)}` +
      `${(delta >= 0 ? '+' : '') + (delta * 100).toFixed(0)}pt`
  );
}

// ---- AND THE SECOND RULE: STOPPING AT THE FIRST HIT ------------------------
console.log('\n\n===== THE SECOND RULE: IT STOPS AT THE FIRST CONTACT BLOCK =====\n');
console.log('Of the documents the extractor WOULD open, how many would it actually');
console.log('reach. Ranked as the extractor ranks them, per matter, it opens up to');
console.log('three and stops at the first carrying a labelled party.\n');
const rank = (name: string): number => {
  const i = DOC_PRIORITY.findIndex((re) => re.test(name));
  return i === -1 ? DOC_PRIORITY.length : i;
};
const byMatter = new Map<string, Doc[]>();
for (const d of kept) {
  // The matter is the attachment URL's parent record; the manifest carries the
  // lead id under leadId in the same order it was fetched.
  const k = (d as any).leadId ?? d.url;
  byMatter.set(k, [...(byMatter.get(k) ?? []), d]);
}
let reachedFirst = 0;
let neverOpened = 0;
const APPLICANT_LABEL = /(^|\n)[ \t]*(APPLICANT|OWNER|PETITIONER|CONTACT)[ \t]*:/i;
for (const [, docs] of byMatter) {
  const ordered = [...docs].sort((a, b) => rank(a.docName) - rank(b.docName));
  let stopped = false;
  ordered.forEach((d, i) => {
    if (stopped || i >= 3) { neverOpened++; return; }
    reachedFirst++;
    if (APPLICANT_LABEL.test(texts.get(d.file)!)) stopped = true;
  });
}
console.log(`matters in this sample                 : ${byMatter.size}`);
console.log(`documents the extractor would open     : ${reachedFirst}`);
console.log(`documents it holds but never opens     : ${neverOpened}`);
