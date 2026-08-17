// READ-ONLY. HOW A JURISDICTION THAT WRITES PROSE PHRASES ITS FACTS.
//
//   node --import tsx agents/scraper/diagnostics/prose-vocab.ts <docdir> <jurisdiction>
//   ... --show "<phrasing>"   every match, for hand-checking
//
// Nothing is written. Clark has a form and doc-read's label pass reads it.
// Oakland writes ordinances, Anaheim writes meeting agendas, Westchester writes
// bond acts: no bullets, no labels, and a label pass over them returns "Table
// 17.17.03" and "SUBJECT". The vocabulary of a prose jurisdiction is its
// PHRASINGS, and this counts them so a reader is written against what the city
// writes rather than against what a regex author expects.
//
// EVERY PHRASING IS REPORTED WITH ITS COUNT AND A VERBATIM EXAMPLE, including
// the ones that find nothing. A phrasing at 0 is the useful half of the result:
// it is how "Oakland never states a room count" gets established rather than
// assumed.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.argv[2];
const WANT = process.argv[3];
const SHOW = (() => {
  const i = process.argv.indexOf('--show');
  return i > -1 ? process.argv[i + 1] : null;
})();
if (!DIR || !WANT) {
  console.error('usage: prose-vocab.ts <docdir> <jurisdiction> [--show "<phrasing>"]');
  process.exit(1);
}

interface Doc {
  file: string; jurisdiction: string; adapter: string; docName: string;
  url: string; leadId: string; pages: number; chars: number;
}

const PAGE_MARK = /\n*-{4}PAGE-{4}\n*/g;
const manifest: Doc[] = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
const texts = new Map<string, string>();
for (const d of manifest) {
  try { texts.set(d.file, readFileSync(join(DIR, d.file), 'utf8').replace(PAGE_MARK, '\n')); } catch { /* skip */ }
}
const seen = new Set<string>();
const docs = manifest
  .filter((d) => (texts.get(d.file) ?? '').replace(/\s/g, '').length >= 400)
  .filter((d) => (seen.has(d.url) ? false : (seen.add(d.url), true)))
  .filter((d) => d.jurisdiction.toLowerCase().includes(WANT.toLowerCase()));

const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(0) + '%' : '-');
const one = (s: string, n = 150) => s.replace(/\s+/g, ' ').trim().slice(0, n);

// The phrasings. Grouped the way the brief groups them, and deliberately
// including several forms of each: which form a city uses is the finding.
const PHRASINGS: [string, string, RegExp][] = [
  // WHERE
  ['where', 'street address', /\b\d{2,6}\s+(?:[NSEW]\.?\s+)?[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3}\s+(?:Street|St\.|Avenue|Ave\.|Road|Rd\.|Boulevard|Blvd\.|Drive|Dr\.|Way|Parkway|Place|Court)\b/],
  ['where', '"located at <address>"', /\blocated at\s+\d{2,6}\s+[A-Z]/i],
  ['where', '"Assessor Parcel Number"', /\bassessor'?s?\s+parcel\s+(?:number|no\.?)\s*[\d-]{5,20}/i],
  ['where', '"APN" abbreviated', /\bAPN\s*[:#]?\s*[\d-]{5,20}/i],
  ['where', 'parcel number, bare digits', /\b\d{2,3}-\d{3,4}-\d{1,3}(?:-\d{1,3})?\b/],
  ['where', '"Block N, Lot N"', /\bBlock\s+\d{1,5},?\s+Lots?\s+[\d,\s]{1,20}/i],
  ['where', 'a zoning district code', /\b(?:C-\d{1,2}|R-\d{1,2}|M-\d{1,2}|D-[A-Z]{2,3}|S-\d{1,2}|CBD|HBX)\b/],
  ['where', '"zoning district" in words', /\bzoning district\b/i],
  ['where', '"General Plan" designation', /\bgeneral plan\b/i],
  // WHAT
  ['what', '"N square feet" / "N sf"', /\b[\d,]{3,12}\s*(?:gross\s+)?(?:square\s+feet|sq\.?\s?ft\.?|s\.f\.)\b/i],
  ['what', '"N-story" / "N stories"', /\b\d{1,3}[- ]?stor(?:y|ies|ey|eys)\b/i],
  ['what', '"N feet" in height', /\b\d{2,4}[- ]?(?:feet|foot|ft\.?)\s*(?:tall|high|in height)?\b/i],
  ['what', '"N residential units" / "N units"', /\b[\d,]{1,7}\s+(?:residential\s+|dwelling\s+|housing\s+)?units\b/i],
  ['what', '"N affordable units"', /\b[\d,]{1,7}\s+affordable\s+(?:units|homes)\b/i],
  ['what', '"N hotel rooms" / "N-room"', /\b[\d,]{2,7}[- ](?:hotel\s+)?rooms?\b/i],
  ['what', '"N seats" / "N-seat"', /\b[\d,]{2,9}[- ]seats?\b/i],
  ['what', '"N parking spaces"', /\b[\d,]{1,7}\s+parking\s+(?:spaces|stalls)\b/i],
  ['what', '"N acres"', /\b[\d.,]{1,8}[\s-]acres?\b/i],
  ['what', 'a named component', /\b(hotel|arena|stadium|casino|ballpark|theat(?:re|er)|museum|convention|waterfront|amphitheat|water park|spa\b)\b/i],
  // WHEN
  ['when', 'a long-form date', /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/],
  ['when', '"public hearing" + a date', /\bpublic hearing\b[^\n]{0,80}(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}/i],
  ['when', '"adopted on" / "effective date"', /\b(?:adopted on|effective date|date of adoption|shall take effect)\b/i],
  ['when', '"comments? (must be )?received by"', /\bcomments?\s+(?:must\s+be\s+)?(?:received|submitted|due)\b/i],
  ['when', '"expire" / "expiration"', /\bexpir(?:e|es|ed|ation)\b/i],
  ['when', '"Phase 1" / "phased"', /\bphase\s+(?:1|2|3|I{1,3}|one|two)\b/i],
  // HOW MUCH
  ['money', 'any dollar amount', /\$\s?[\d,]{4,}/],
  ['money', '"purchase price" / "sale price"', /\b(?:purchase price|sale price|sales price|sold for|acquisition price)\b/i],
  ['money', '"the City would receive $"', /\b(?:City|County|District)\s+(?:would|will|shall)\s+receive\s+\$/i],
  ['money', '"development agreement"', /\bdevelopment agreement\b/i],
  ['money', '"community benefits"', /\bcommunity benefits?\b/i],
  ['money', '"impact fee" / "in-lieu fee"', /\b(?:impact fee|in-?lieu fee|fee in lieu|affordable housing fee)\b/i],
  ['money', '"bond" amount', /\bbonds?\b[^\n]{0,60}\$\s?[\d,]{4,}|\$\s?[\d,]{4,}[^\n]{0,40}\bbonds?\b/i],
  ['money', '"appropriat" (a budget action)', /\bappropriat(?:e|es|ed|ion)\b/i],
  // WHAT MUST HAPPEN
  ['action', '"RESOLVED" / "ORDAINED"', /\bbe it (?:further )?(?:resolved|ordained)\b/i],
  ['action', '"authorize the City Administrator"', /\bauthoriz(?:e|ing)\s+the\s+[A-Z][A-Za-z ]{3,40}\b/],
  ['action', '"conditions of approval"', /\bconditions? of approval\b/i],
  ['action', 'a numbered condition list', /(?:^|\n)\s*\d{1,2}\.\s+[A-Z][^\n]{25,}(?:\n\s*\d{1,2}\.\s+[A-Z][^\n]{25,}){2,}/],
  ['action', '"staff recommends"', /\bstaff\s+recommends?\b/i],
  ['action', '"mitigation measure"', /\bmitigation measures?\b/i],
  ['action', 'a vote or roll call', /\b(?:AYES?|NOES|ABSTAIN|ABSENT)\s*[:-]|\bunanimous(?:ly)?\b|\broll call\b/i],
  // DOCUMENT TYPE
  ['doctype', '"Environmental Impact Report"', /\benvironmental impact report\b|\bEIR\b/i],
  ['doctype', '"CEQA"', /\bCEQA\b/i],
  ['doctype', '"Negative Declaration" / "MND"', /\bnegative declaration\b|\bMND\b/i],
  ['doctype', '"traffic study" / "TIA"', /\btraffic (?:impact )?(?:study|analysis)\b|\bTIA\b/i],
  ['doctype', '"staff report"', /\bstaff report\b/i],
  ['doctype', '"minutes"', /\bminutes\b/i],
  // PARTIES, and this is the one that must never be guessed
  ['party', 'a labelled role + name', /\b(?:APPLICANT|OWNER|PETITIONER|DEVELOPER|AGENT|ARCHITECT|ENGINEER|CONTRACTOR|REPRESENTATIVE)\s*:\s*[A-Z]/],
  ['party', 'a legal-suffix entity', /\b[A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*){0,4}\s+(?:LLC|L\.L\.C\.|Inc\.?|Corp\.?|Corporation|Company|LP|LLP|Partners|Associates|Group)\b/],
  ['party', '"by and between X and Y"', /\bby and between\b[^\n]{5,120}\band\b/i],
  ['party', '"the developer" as a role word', /\bthe developer\b/i],
  ['party', 'an email address', /[\w.+-]+@[\w-]+\.[\w.-]+/],
];

console.log(`===== ${WANT.toUpperCase()}: ${docs.length} READABLE DOCUMENTS =====\n`);
const chars = docs.map((d) => d.chars).sort((a, b) => a - b);
const pages = docs.map((d) => d.pages).sort((a, b) => a - b);
console.log(`median pages ${pages[Math.floor(pages.length / 2)] ?? 0}, median chars ${chars[Math.floor(chars.length / 2)] ?? 0}`);
console.log('\ndocuments in the sample:');
for (const d of docs.slice(0, 14)) console.log(`  ${String(d.pages).padStart(3)}p ${String(d.chars).padStart(7)}c  ${d.docName.slice(0, 60)}`);
if (docs.length > 14) console.log(`  ... and ${docs.length - 14} more`);

let group = '';
console.log('\n\nphrasing                                    docs   share   example');
for (const [g, name, re] of PHRASINGS) {
  if (g !== group) { console.log(`\n-- ${g.toUpperCase()} --`); group = g; }
  const hits = docs.filter((d) => re.test(texts.get(d.file)!));
  let ex = '';
  for (const d of hits) {
    const t = texts.get(d.file)!;
    const m = re.exec(t);
    if (m) { ex = one(t.slice(Math.max(0, (m.index ?? 0) - 30), (m.index ?? 0) + 110), 104); break; }
  }
  console.log(`${name.slice(0, 42).padEnd(44)}${String(hits.length).padStart(4)}${pct(hits.length, docs.length).padStart(8)}   ${ex}`);
}

if (SHOW) {
  const hit = PHRASINGS.find(([, n]) => n.toLowerCase().includes(SHOW.toLowerCase()));
  if (!hit) { console.log(`\nno phrasing matching "${SHOW}"`); } else {
    console.log(`\n\n===== EVERY MATCH FOR "${hit[1]}" =====\n`);
    let n = 0;
    for (const d of docs) {
      const t = texts.get(d.file)!;
      const re = new RegExp(hit[2].source, hit[2].flags.includes('g') ? hit[2].flags : `${hit[2].flags}g`);
      let m: RegExpExecArray | null;
      let perDoc = 0;
      while ((m = re.exec(t)) !== null && perDoc < 4) {
        n++; perDoc++;
        console.log(`${String(n).padStart(3)}. ${d.docName.slice(0, 30).padEnd(32)}"${one(t.slice(Math.max(0, m.index - 40), m.index + 130), 170)}"`);
      }
    }
    console.log(`\n${n} matches.`);
  }
}
