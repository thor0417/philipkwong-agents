// READ-ONLY. WHAT THE DOCUMENTS SAY.
//
//   node --import tsx agents/scraper/diagnostics/doc-read.ts <docdir> [section]
//     sections: vocab | position | signals | content | five | firms | all
//
// Reads the text doc-corpus put on disk. Touches no database, writes no column,
// and deliberately EXTRACTS NOTHING: every detector below reports a count and a
// verbatim example, because the brief asks what exists before anything decides
// what is safe to read.
//
// EVERY NUMBER IS "DOCUMENTS CONTAINING IT", not "hits", unless a column says
// otherwise. A staff report that prints the word "acres" nine times is one
// document that carries acreage, and counting the nine would make a single form
// letter look like coverage.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.argv[2];
const SECTION = process.argv[3] ?? 'all';
if (!DIR) { console.error('usage: doc-read.ts <docdir> [section]'); process.exit(1); }

interface Doc {
  file: string; jurisdiction: string; adapter: string; docName: string;
  url: string; leadId: string; leadTitle: string; pages: number; chars: number;
}

const manifest: Doc[] = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
const texts = new Map<string, string>();
for (const d of manifest) {
  try { texts.set(d.file, readFileSync(join(DIR, d.file), 'utf8')); } catch { /* skip */ }
}

// A document with no text layer is a scan. It is counted separately everywhere
// rather than dropped, because "the county publishes it and we cannot read it"
// is a different fact from "the county does not publish it".
const READABLE = manifest.filter((d) => (texts.get(d.file) ?? '').replace(/\s/g, '').length >= 400);
const SCANS = manifest.filter((d) => !READABLE.includes(d));

const jurisdictions = [...new Set(READABLE.map((d) => d.jurisdiction))].sort();

function textOf(d: Doc): string {
  return (texts.get(d.file) ?? '').replace(/[ \t ]+/g, ' ');
}

const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(0) + '%' : '-');
const oneLine = (s: string, n = 110) => s.replace(/\s+/g, ' ').trim().slice(0, n);

// ---------------------------------------------------------------------------
function header(): void {
  console.log('===== THE SAMPLE =====\n');
  console.log(`documents fetched   : ${manifest.length}`);
  console.log(`  readable text     : ${READABLE.length}`);
  console.log(`  scan, no text layer: ${SCANS.length}`);
  console.log('\njurisdiction                  docs  readable   scans   median pages   median chars');
  for (const j of jurisdictions.concat(SCANS.length ? ['(scans counted per row)'] : []).slice(0, 99)) {
    if (j.startsWith('(')) continue;
    const all = manifest.filter((d) => d.jurisdiction === j);
    const ok = READABLE.filter((d) => d.jurisdiction === j);
    const pages = ok.map((d) => d.pages).sort((a, b) => a - b);
    const chars = ok.map((d) => d.chars).sort((a, b) => a - b);
    console.log(
      `${j.slice(0, 28).padEnd(30)}${String(all.length).padStart(5)}${String(ok.length).padStart(10)}${String(all.length - ok.length).padStart(8)}` +
        `${String(pages.length ? pages[Math.floor(pages.length / 2)] : 0).padStart(15)}${String(chars.length ? chars[Math.floor(chars.length / 2)] : 0).padStart(15)}`
    );
  }
}

// ---------------------------------------------------------------------------
// PART 2.1 and 2.2: WHICH WORDS INTRODUCE A PARTY
//
// A label is any `WORD(S):` at the start of a line whose value looks like a name.
// The label list is the deliverable; the names are not.
const NAME_SHAPED =
  /(\b(LLC|L\.L\.C\.|Inc\.?|Incorporated|Corp\.?|Corporation|Company|Co\.|Ltd\.?|LP|L\.P\.|LLP|PLLC|Holdings|Partners|Partnership|Properties|Group|Ventures|Capital|Realty|Associates|Architects?|Engineers?|Engineering|Consultants?|Consulting|Design|Studio|Trust)\b)|(^[A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z'-]+)|(^[A-Z][A-Z',.&\- ]{6,}$)/;

// A value that is plainly not a party, however name-shaped the regex thinks.
const NOT_A_PARTY =
  /^(yes|no|n\/a|none|approved|denied|see |attached|various|tbd|pending|not applicable|same|hearing|public|city of|county of|state of|department of|office of)/i;

const LABEL_RE = /(?:^|\n)[ \t]*([A-Z][A-Za-z0-9 /&.'()-]{2,38}?)[ \t]*:[ \t]*([^\n]{2,140})/g;

// Hand-classified. NOT a guess: each is the word a document uses, and the
// question "is this person on the project or on the payroll" has a known answer
// for these. Anything not listed comes out as 'unclear' and is reported as such,
// which is the honest state for a label nobody has looked at.
const STAFF_LABELS = new Set([
  'staff contact', 'case planner', 'planner', 'project manager', 'prepared by',
  'presented by', 'submitted by', 'reviewed by', 'approved by', 'department',
  'contact person', 'staff', 'author', 'requested by', 'sponsor', 'sponsors',
  'council member', 'councilmember', 'commissioner', 'chair', 'chairman',
  'director', 'city manager', 'county manager', 'attorney for the city',
  'lead agency', 'agency', 'staff recommendation', 'recommendation',
]);
const PARTY_LABELS = new Set([
  'owner', 'property owner', 'owner of record', 'applicant', 'applicants',
  'co-applicant', 'petitioner', 'developer', 'subdivider', 'agent',
  'authorized agent', 'representative', 'applicant representative', 'contact',
  'architect', 'engineer', 'civil engineer', 'landscape architect', 'surveyor',
  'consultant', 'environmental consultant', 'traffic engineer', 'contractor',
  'operator', 'lessee', 'tenant', 'purchaser', 'buyer', 'seller', 'grantee',
  'applicant/owner', 'owner/applicant', 'attorney', 'attorney for applicant',
]);

function classifyLabel(l: string): 'party' | 'staff' | 'unclear' {
  const k = l.toLowerCase().replace(/\s+/g, ' ').trim();
  if (PARTY_LABELS.has(k)) return 'party';
  if (STAFF_LABELS.has(k)) return 'staff';
  return 'unclear';
}

function vocab(): void {
  console.log('\n\n===== PART 2: WHICH WORDS INTRODUCE A PARTY =====\n');
  console.log('Every `LABEL:` at the start of a line whose value is name-shaped. The');
  console.log('labels are the deliverable; the names are not extracted.\n');
  for (const j of jurisdictions) {
    const docs = READABLE.filter((d) => d.jurisdiction === j);
    const counts = new Map<string, { docs: Set<string>; hits: number; example: string }>();
    for (const d of docs) {
      const t = textOf(d);
      LABEL_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = LABEL_RE.exec(t)) !== null) {
        const label = m[1].trim();
        const value = m[2].trim();
        if (NOT_A_PARTY.test(value)) continue;
        if (!NAME_SHAPED.test(value)) continue;
        const key = label.toUpperCase();
        const e = counts.get(key) ?? { docs: new Set<string>(), hits: 0, example: `${label}: ${oneLine(value, 70)}` };
        e.docs.add(d.file);
        e.hits++;
        counts.set(key, e);
      }
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1].docs.size - a[1].docs.size);
    console.log(`--- ${j}  (${docs.length} readable documents) ---`);
    if (!ranked.length) { console.log('  no label introduces a name-shaped value in any document.\n'); continue; }
    console.log('  kind     docs  hits  label / example');
    for (const [label, e] of ranked.slice(0, 28)) {
      const kind = classifyLabel(label);
      console.log(`  ${kind.padEnd(8)}${String(e.docs.size).padStart(4)}${String(e.hits).padStart(6)}  ${e.example}`);
    }
    const unclear = ranked.filter(([l]) => classifyLabel(l) === 'unclear').length;
    console.log(`  ...${ranked.length} distinct labels, ${unclear} of them unclassified.\n`);
  }
}

// ---------------------------------------------------------------------------
// PART 2.3: WHERE IN THE DOCUMENT A NAME SITS, AND WHETHER A ROLE IS WRITTEN
const POSITIONS: [string, RegExp][] = [
  ['signature block', /(^|\n)[ \t]*(\/s\/|signature|signed|by:[ \t]*_+|_{6,}[ \t]*\n[ \t]*(name|print))/i],
  ['certification', /(i (hereby )?certify|certificate of|certified (copy|true)|under penalty of perjury|state of \w+[\s\S]{0,60}county of)/i],
  ['preparer statement', /(prepared (by|for)|report prepared|this (report|study) (was|has been) prepared|submitted (by|to))/i],
  ['title block', /(sheet (no|number|title)|drawn by|checked by|project (no|number)[ \t]*[:.]|scale[ \t]*[:.]?[ \t]*1["″]?\s*=)/i],
  ['cover page', /^[\s\S]{0,1500}?(prepared for|submitted to|applicant|owner|project name)/i],
  ['notary block', /(notary public|sworn (to )?(and subscribed|before me)|my commission expires)/i],
  ['seal or stamp', /(registered (professional|architect)|licen[cs]e (no|number)|\bR\.?A\.?\s*(no|#)|\bP\.?E\.?\s*(no|#)|expires?:? \d{1,2}\/\d{2,4})/i],
];

// Role words. A role WRITTEN IN WORDS is the difference between a party and a
// name in a corner of a page.
const ROLE_WORD =
  /\b(architect|architecture|engineer|engineering|landscape architect|surveyor|planner|planning consultant|environmental consultant|traffic (engineer|consultant)|consultant|contractor|developer|owner|applicant|agent|attorney|counsel|operator|lessee|preparer)\b/i;

function position(): void {
  console.log('\n\n===== PART 2.3: WHERE NAMES SIT, AND WHETHER THE ROLE IS WRITTEN =====\n');
  console.log('For each position, how many documents contain it, and in how many of');
  console.log('those a role word appears within 200 characters of it. The second');
  console.log('number is the only one that matters: a name whose role is only implied');
  console.log('by position is not extractable under the standing rule.\n');
  for (const j of jurisdictions) {
    const docs = READABLE.filter((d) => d.jurisdiction === j);
    console.log(`--- ${j}  (${docs.length} documents) ---`);
    console.log('  position              docs   with a role word nearby   example');
    for (const [name, re] of POSITIONS) {
      let has = 0;
      let withRole = 0;
      let example = '';
      for (const d of docs) {
        const t = textOf(d);
        const m = re.exec(t);
        if (!m) continue;
        has++;
        const at = m.index ?? 0;
        const window = t.slice(Math.max(0, at - 200), at + 200);
        if (ROLE_WORD.test(window)) {
          withRole++;
          if (!example) example = oneLine(window, 90);
        }
      }
      if (!has) continue;
      console.log(`  ${name.padEnd(20)}${String(has).padStart(5)}${`${withRole} (${pct(withRole, has)})`.padStart(24)}   ${example}`);
    }
    console.log('');
  }
}

// ---------------------------------------------------------------------------
// PART 2.4: SUFFIXED ENTITIES, EMAILS, PHONES
const SUFFIXED =
  /\b((?:[A-Z][\w&'.-]*[ ]){0,4}[A-Z][\w&'.-]*[ ](?:LLC|L\.L\.C\.|Inc\.?|Incorporated|Corp\.?|Corporation|Company|Ltd\.?|LP|L\.P\.|LLP|PLLC|Holdings|Partners|Partnership|Properties|Group|Ventures|Capital|Realty|Associates))\b/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE = /\(?\b\d{3}\)?[\s.-]?\d{3}[.-]\d{4}\b/g;

function signals(): void {
  console.log('\n\n===== PART 2.4: SUFFIXED ENTITIES, EMAILS, PHONES =====\n');
  console.log('Distinct values PER DOCUMENT. If a document names fifteen companies then');
  console.log('company names alone cannot identify a party, which is the thing to know.\n');
  console.log('jurisdiction                docs   entities med/max   w/email   w/phone   emails med');
  for (const j of jurisdictions) {
    const docs = READABLE.filter((d) => d.jurisdiction === j);
    const ents: number[] = [];
    const mails: number[] = [];
    let withEmail = 0;
    let withPhone = 0;
    for (const d of docs) {
      const t = textOf(d);
      ents.push(new Set((t.match(SUFFIXED) ?? []).map((s) => s.toLowerCase())).size);
      const e = new Set((t.match(EMAIL) ?? []).map((s) => s.toLowerCase()));
      mails.push(e.size);
      if (e.size) withEmail++;
      if ((t.match(PHONE) ?? []).length) withPhone++;
    }
    const s = [...ents].sort((a, b) => a - b);
    const m = [...mails].sort((a, b) => a - b);
    console.log(
      `${j.slice(0, 26).padEnd(28)}${String(docs.length).padStart(5)}` +
        `${String(s[Math.floor(s.length / 2)] ?? 0).padStart(10)}/${String(s[s.length - 1] ?? 0).padEnd(7)}` +
        `${`${withEmail} (${pct(withEmail, docs.length)})`.padStart(10)}${`${withPhone} (${pct(withPhone, docs.length)})`.padStart(10)}` +
        `${String(m[Math.floor(m.length / 2)] ?? 0).padStart(10)}`
    );
  }
}

// ---------------------------------------------------------------------------
// PART 3: EVERYTHING ELSE A DOCUMENT CARRIES
type Det = [string, RegExp];
const WHERE: Det[] = [
  ['street address', /\b\d{2,6}\s+(?:[NSEW]\.?\s+)?[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3}\s+(Street|St\.|Avenue|Ave\.|Road|Rd\.|Boulevard|Blvd\.|Drive|Dr\.|Lane|Way|Parkway|Pkwy|Highway|Hwy|Circle|Court|Ct\.)\b/],
  ['cross streets', /\b(north|south|east|west)(?:erly)? (of|side of) [A-Z][\w .'-]{2,30} and (north|south|east|west)(?:erly)? (of|side of) /i],
  ['APN or parcel number', /\b(A\.?P\.?N\.?|assessor'?s? parcel|parcel (no|number|id)|tax (map )?(parcel|lot)|folio)\b/i],
  ['APN, numeric form', /\b\d{3}-\d{2}-\d{3}(-\d{3})?\b/],
  ['lot and block', /\b(lot[s]?\s+\d+[A-Za-z]?,?\s+(and\s+\d+,?\s+)?block\s+\d+|block\s+\d+,?\s+lot[s]?\s+\d+)\b/i],
  ['current zoning', /\b(zoned|existing zoning|current zoning|zone district|from [A-Z]{1,4}-?\d? ?\(?[A-Za-z ]{0,24}\)? ?zone)\b/i],
  ['proposed zoning', /\b(proposed zoning|rezone|reclassif|zone change|to [A-Z]{1,4}-?\d? ?\(?[A-Za-z ]{0,24}\)? ?zone)\b/i],
  ['overlay district', /\b(overlay|AE-\d{2}|airport environs|historic district|special district|redevelopment area)\b/i],
];
const WHAT: Det[] = [
  ['room or key count', /\b[\d,]{2,7}[\s-]?(?:guest[\s-]?|hotel[\s-]?)?(?:rooms?|keys)\b/i],
  ['seat capacity', /\b[\d,]{2,9}[\s-]?(?:seats?|fixed seats|person capacity)\b|\bcapacity of [\d,]{2,9}\b/i],
  ['storeys', /\b\d{1,3}[\s-]?(?:stor(?:y|ey|ies|eys)|floors?|levels?)\b/i],
  ['height in feet', /\b\d{1,4}(?:\.\d+)?[\s-]?(?:feet|foot|ft\.?)\s*(?:in height|tall|high)?\b/i],
  ['square footage', /\b[\d,.]+\s*(?:million\s*)?(?:square[\s-]?f(?:ee|oo)t|sq\.?\s?ft\.?|s\.f\.)\b/i],
  ['residential units', /\b[\d,]{1,6}\s*(?:residential\s+|dwelling\s+|multi-?family\s+)?units?\b/i],
  ['parking spaces', /\b[\d,]{1,6}\s*(?:parking\s+)?(?:spaces|stalls)\b/i],
  ['acreage', /\b[\d,.]+[\s-]acres?\b/i],
  ['named component', /\b(concert hall|water park|waterpark|spa\b|convention (space|center|centre)|theat(?:re|er)|ballroom|arena|amphitheat|ride\b|roller coaster|casino floor|gaming floor|golf course|marina|nightclub|food hall)\b/i],
];
const WHEN: Det[] = [
  ['filing or application date', /\b(filed|application (date|received)|date (filed|received|submitted)|submitted on)\b/i],
  ['hearing date', /\b(hearing (date|on|will be held|scheduled)|public hearing[^\n]{0,60}\b(?:on|at)\b|date of hearing|set for hearing|will be heard)\b/i],
  ['hearing date, explicit', /\b(hearing|heard|meeting)[^\n]{0,40}\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/i],
  ['decision or action date', /\b(action (date|taken)|decision (date|of)|approved on|adopted on|denied on|effective date)\b/i],
  ['comment deadline', /\b(comment(s)? (period|due|deadline|must be received)|written comments|closes? on|no later than)\b/i],
  ['entitlement expiry', /\b(expire[sd]?|expiration|shall (be )?(void|lapse)|valid for (a period of )?\d+ (year|month)|time extension)\b/i],
  ['phasing', /\b(phase\s+(?:1|2|3|I{1,3}|one|two|three)\b|phased? (development|construction)|first phase)\b/i],
  ['construction start', /\b(construction (is expected to |will )?(begin|commence|start)|groundbreaking|notice to proceed)\b/i],
];
const MONEY: Det[] = [
  ['project cost', /\b(project cost|total cost|estimated cost|construction cost|capital investment|investment of)\b/i],
  ['purchase price', /\b(purchase price|sale price|sold for|acquisition (price|cost)|consideration of)\b/i],
  ['bond or TIF', /\b(bond(s)? (act|issue|proceeds|authorization)|tax increment|\bTIF\b|revenue bonds|general obligation)\b/i],
  ['impact or permit fees', /\b(impact fee|development fee|permit fee|park fee|in-?lieu fee|fee in lieu)\b/i],
  ['development agreement value', /\b(development agreement|economic (development )?(incentive|agreement)|community benefits agreement|\bDA\b No)\b/i],
  ['any dollar amount', /\$\s?[\d,]{3,}/],
];
const MUST: Det[] = [
  ['action sought', /\b(request(ing)? (approval|to)|application for|seeks? (approval|a )|purpose of this (item|report)|action requested)\b/i],
  ['staff recommendation', /\b(staff recommend|recommendation:|it is recommended|recommended (for )?(approval|denial))\b/i],
  ['the vote', /\b(motion (carried|passed|failed)|vote[sd]?:|ayes?:|nays?:|unanimous|\d+-\d+ vote|roll call)\b/i],
  ['conditions of approval', /\b(conditions of approval|subject to the following conditions|the following conditions|conditions:)\b/i],
  ['numbered conditions', /(^|\n)[ \t]*\d{1,2}\.[ \t]+[A-Z][^\n]{20,}(\n[ \t]*\d{1,2}\.[ \t]+[A-Z][^\n]{20,}){2,}/],
  ['mitigation measures', /\b(mitigation measure|MM[- ]?[A-Z]{2,4}-\d|mitigation monitoring)\b/i],
  ['monitoring and reporting', /\b(monitoring and reporting|reporting program|annual report|compliance report|shall (annually )?report)\b/i],
];
const DOCTYPE: Det[] = [
  ['environmental impact report', /\b(environmental impact (report|statement)|\bEIR\b|\bEIS\b|CEQA|negative declaration|\bMND\b)\b/i],
  ['development agreement', /\bdevelopment agreement\b/i],
  ['conditions of approval', /\bconditions of approval\b/i],
  ['traffic study', /\b(traffic (impact )?(study|analysis)|\bTIA\b|trip generation|level of service)\b/i],
  ['staff report', /\b(staff report|agenda (item|sheet)|department recommendation)\b/i],
  ['minutes', /\b(minutes of|the meeting was called to order|adjourn(ed|ment))\b/i],
  ['ordinance or resolution', /\b(be it (hereby )?(ordained|resolved)|ordinance no|resolution no)\b/i],
];

function runDets(title: string, dets: Det[]): void {
  console.log(`\n--- ${title} ---`);
  const head = 'signal'.padEnd(30) + jurisdictions.map((j) => j.split(',')[0].slice(0, 9).padStart(11)).join('');
  console.log(head);
  for (const [name, re] of dets) {
    let line = name.padEnd(30);
    for (const j of jurisdictions) {
      const docs = READABLE.filter((d) => d.jurisdiction === j);
      const hit = docs.filter((d) => re.test(textOf(d))).length;
      line += `${hit}/${docs.length}`.padStart(11);
    }
    console.log(line);
  }
  // One real example for each, from anywhere in the sample.
  console.log('\n  examples:');
  for (const [name, re] of dets) {
    let shown = false;
    for (const d of READABLE) {
      const t = textOf(d);
      const m = re.exec(t);
      if (!m) continue;
      const at = m.index ?? 0;
      console.log(`    ${name.padEnd(28)} ${d.jurisdiction.split(',')[0].padEnd(16)} "${oneLine(t.slice(Math.max(0, at - 40), at + 130), 130)}"`);
      shown = true;
      break;
    }
    if (!shown) console.log(`    ${name.padEnd(28)} not found in any document`);
  }
}

function content(): void {
  console.log('\n\n===== PART 3: EVERYTHING ELSE A DOCUMENT CARRIES =====\n');
  console.log('Documents containing the signal, out of readable documents, per jurisdiction.\n');
  runDets('WHERE', WHERE);
  runDets('WHAT', WHAT);
  runDets('WHEN', WHEN);
  runDets('HOW MUCH', MONEY);
  runDets('WHAT MUST HAPPEN', MUST);
  runDets('WHAT KIND OF DOCUMENT IT IS', DOCTYPE);
}

// ---------------------------------------------------------------------------
// PART 4: THE FIVE, IN DETAIL
function five(): void {
  console.log('\n\n===== PART 4: THE FIVE, IN DETAIL =====\n');

  // 1. APN --------------------------------------------------------------------
  console.log('--- 1. APN / parcel number ---\n');
  const APN_FORMS: [string, RegExp][] = [
    ['xxx-xx-xxx (Clark, Phoenix)', /\b\d{3}-\d{2}-\d{3}\b/g],
    ['xxx-xx-xxx-xxx (Clark long)', /\b\d{3}-\d{2}-\d{3}-\d{3}\b/g],
    ['xxx-xxx-xx (Anaheim/CA)', /\b\d{3}-\d{3}-\d{2}\b/g],
    ['labelled APN', /\bA\.?P\.?N\.?[ #:]*([\d\- .]{7,25})/gi],
    ['labelled parcel number', /\bparcel (?:no\.?|number|id)[ #:]*([\dA-Z\- .]{5,25})/gi],
    ["assessor's parcel", /assessor'?s? parcel (?:number|no\.?|map)?[ #:]*([\d\- .]{7,25})/gi],
  ];
  console.log('form'.padEnd(32) + jurisdictions.map((j) => j.split(',')[0].slice(0, 9).padStart(11)).join(''));
  for (const [name, re] of APN_FORMS) {
    let line = name.padEnd(32);
    for (const j of jurisdictions) {
      const docs = READABLE.filter((d) => d.jurisdiction === j);
      const hit = docs.filter((d) => { re.lastIndex = 0; return re.test(textOf(d)); }).length;
      line += `${hit}/${docs.length}`.padStart(11);
    }
    console.log(line);
  }
  for (const [name, re] of APN_FORMS) {
    for (const d of READABLE) {
      re.lastIndex = 0;
      const t = textOf(d);
      const m = re.exec(t);
      if (!m) continue;
      console.log(`\n  ${name} - ${d.jurisdiction}, ${d.docName.slice(0, 40)}`);
      console.log(`    "${oneLine(t.slice(Math.max(0, (m.index ?? 0) - 60), (m.index ?? 0) + 120), 150)}"`);
      break;
    }
  }

  // 2. Hearing dates ----------------------------------------------------------
  console.log('\n\n--- 2. Hearing dates, in the DOCUMENT rather than the metadata ---\n');
  const HEARING: [string, RegExp][] = [
    ['a labelled hearing date', /\b(hearing date|date of hearing|public hearing date)[ :]*([^\n]{4,50})/i],
    ['heard on <date>', /\b(will be heard|was heard|heard|hearing|meeting) (on|at) [^\n]{0,20}(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/i],
    ['a bare long date anywhere', /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/],
    ['TAB/CAC line (Clark form)', /\bTAB\/CAC\b[^\n]{0,80}/i],
    ['a numeric agenda date in the name', /\b\d{6}\b/],
  ];
  for (const [name, re] of HEARING) {
    let line = name.padEnd(32);
    for (const j of jurisdictions) {
      const docs = READABLE.filter((d) => d.jurisdiction === j);
      line += `${docs.filter((d) => re.test(textOf(d))).length}/${docs.length}`.padStart(11);
    }
    console.log(line);
  }
  for (const [name, re] of HEARING.slice(0, 4)) {
    for (const d of READABLE) {
      const t = textOf(d);
      const m = re.exec(t);
      if (!m) continue;
      console.log(`\n  ${name} - ${d.jurisdiction}`);
      console.log(`    "${oneLine(t.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + 140), 150)}"`);
      break;
    }
  }

  // 3. Conditions of approval -------------------------------------------------
  console.log('\n\n--- 3. Conditions of approval: are they discrete items or prose ---\n');
  const CONDITIONS_HEAD = /\b(conditions of approval|subject to the following conditions|the following conditions|conditions:)/i;
  const NUMBERED_ITEM = /(^|\n)[ \t]*(\d{1,2}|[a-z])[.)][ \t]+\S/gm;
  console.log('jurisdiction                 docs   with a conditions heading   numbered items med/max');
  for (const j of jurisdictions) {
    const docs = READABLE.filter((d) => d.jurisdiction === j);
    const withHead = docs.filter((d) => CONDITIONS_HEAD.test(textOf(d)));
    const counts = withHead.map((d) => {
      const t = textOf(d);
      const at = t.search(CONDITIONS_HEAD);
      const after = t.slice(at, at + 12000);
      NUMBERED_ITEM.lastIndex = 0;
      return (after.match(NUMBERED_ITEM) ?? []).length;
    }).sort((a, b) => a - b);
    console.log(
      `${j.slice(0, 26).padEnd(28)}${String(docs.length).padStart(5)}${`${withHead.length} (${pct(withHead.length, docs.length)})`.padStart(28)}` +
        `${String(counts[Math.floor(counts.length / 2)] ?? 0).padStart(12)}/${String(counts[counts.length - 1] ?? 0)}`
    );
  }
  for (const d of READABLE) {
    const t = textOf(d);
    const at = t.search(CONDITIONS_HEAD);
    if (at === -1) continue;
    console.log(`\n  verbatim, ${d.jurisdiction}, ${d.docName.slice(0, 46)}:`);
    for (const line of t.slice(at, at + 900).split('\n').slice(0, 12)) {
      if (line.trim()) console.log(`    | ${oneLine(line, 100)}`);
    }
    break;
  }

  // 4. The design team --------------------------------------------------------
  console.log('\n\n--- 4. The design team ---\n');
  const DESIGN: [string, RegExp][] = [
    ['architect', /\barchitect(?:ure|s)?\b/i],
    ['engineer', /\bengineer(?:ing|s)?\b/i],
    ['civil engineer', /\bcivil engineer/i],
    ['landscape architect', /\blandscape architect/i],
    ['surveyor', /\bsurveyor|land surveying\b/i],
    ['environmental consultant', /\benvironmental (consultant|planner|firm)/i],
    ['traffic consultant', /\btraffic (engineer|consultant)/i],
    ['general contractor', /\b(general contractor|design[- ]build)/i],
  ];
  console.log('role word'.padEnd(30) + jurisdictions.map((j) => j.split(',')[0].slice(0, 9).padStart(11)).join(''));
  for (const [name, re] of DESIGN) {
    let line = name.padEnd(30);
    for (const j of jurisdictions) {
      const docs = READABLE.filter((d) => d.jurisdiction === j);
      line += `${docs.filter((d) => re.test(textOf(d))).length}/${docs.length}`.padStart(11);
    }
    console.log(line);
  }

  // 5. Scale from filings -----------------------------------------------------
  console.log('\n\n--- 5. Scale figures in the filing itself ---\n');
  const SCALE: [string, RegExp][] = [
    ['rooms or keys', /\b[\d,]{2,7}[\s-]?(?:guest[\s-]?|hotel[\s-]?)?(?:rooms?|keys)\b/i],
    ['storeys', /\b\d{1,3}[\s-]?(?:stor(?:y|ey|ies|eys))\b/i],
    ['square footage', /\b[\d,.]+\s*(?:square[\s-]?f(?:ee|oo)t|sq\.?\s?ft\.?)\b/i],
    ['seats', /\b[\d,]{2,9}[\s-]?seats?\b/i],
    ['acreage', /\b[\d,.]+[\s-]acres?\b/i],
    ['height in feet', /\b\d{2,4}[\s-](?:feet|foot|ft\.?)\b/i],
    ['ANY of the above', /\b([\d,]{2,7}[\s-]?(?:guest[\s-]?|hotel[\s-]?)?(?:rooms?|keys)|\d{1,3}[\s-]?stor(?:y|ey|ies|eys)|[\d,.]+\s*(?:square[\s-]?f(?:ee|oo)t|sq\.?\s?ft\.?)|[\d,]{2,9}[\s-]?seats?|[\d,.]+[\s-]acres?)\b/i],
  ];
  console.log('figure'.padEnd(30) + jurisdictions.map((j) => j.split(',')[0].slice(0, 9).padStart(11)).join(''));
  for (const [name, re] of SCALE) {
    let line = name.padEnd(30);
    for (const j of jurisdictions) {
      const docs = READABLE.filter((d) => d.jurisdiction === j);
      line += `${docs.filter((d) => re.test(textOf(d))).length}/${docs.length}`.padStart(11);
    }
    console.log(line);
  }
}

// ---------------------------------------------------------------------------
// THE SECOND ADDITION: A FIRM WITH A ROLE ATTACHED
//
// press-facts extracts a company name and cannot say what that company is to the
// project, so it cannot print one. The question here is whether a filing does
// better: does the document put a ROLE WORD next to the firm, in words, close
// enough that the pairing is the document's statement rather than ours.
//
// PROXIMITY IS NOT A ROLE. A role word within 60 characters of a company name is
// a CANDIDATE, and this counts candidates so the size of the prize is known. What
// makes it safe is the labelled form - "ARCHITECT: Steelman Partners" - which is
// counted separately and is the only one that could ever be extracted.
function firms(): void {
  console.log('\n\n===== ADDITION 2: DOES A FILING NAME A FIRM WITH A ROLE =====\n');
  const ROLE_LABEL =
    /\b(ARCHITECT|ENGINEER|CIVIL ENGINEER|LANDSCAPE ARCHITECT|SURVEYOR|PLANNER|CONSULTANT|CONTRACTOR|DEVELOPER|OWNER|APPLICANT|AGENT|ATTORNEY|OPERATOR|PREPARED BY|SUBMITTED BY|REPRESENTATIVE|PETITIONER)\b[ \t]*:[ \t]*([^\n]{3,120})/gi;
  const ROLE_NEAR = /\b(architect|engineer|surveyor|planner|consultant|contractor|developer|operator|attorney)\b/i;

  console.log('jurisdiction                 docs   labelled role: firm   role word within 60 chars of a firm');
  for (const j of jurisdictions) {
    const docs = READABLE.filter((d) => d.jurisdiction === j);
    let labelled = 0;
    let near = 0;
    for (const d of docs) {
      const t = textOf(d);
      ROLE_LABEL.lastIndex = 0;
      let hasLabelled = false;
      let m: RegExpExecArray | null;
      while ((m = ROLE_LABEL.exec(t)) !== null) {
        if (NAME_SHAPED.test(m[2].trim()) && !NOT_A_PARTY.test(m[2].trim())) { hasLabelled = true; break; }
      }
      if (hasLabelled) labelled++;
      SUFFIXED.lastIndex = 0;
      let hasNear = false;
      let s: RegExpExecArray | null;
      while ((s = SUFFIXED.exec(t)) !== null) {
        const at = s.index;
        if (ROLE_NEAR.test(t.slice(Math.max(0, at - 60), at + 60))) { hasNear = true; break; }
      }
      if (hasNear) near++;
    }
    console.log(
      `${j.slice(0, 26).padEnd(28)}${String(docs.length).padStart(5)}${`${labelled} (${pct(labelled, docs.length)})`.padStart(22)}${`${near} (${pct(near, docs.length)})`.padStart(38)}`
    );
  }

  console.log('\n--- every labelled role-and-firm pairing found, deduplicated by label ---');
  const shown = new Set<string>();
  for (const d of READABLE) {
    const t = textOf(d);
    ROLE_LABEL.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ROLE_LABEL.exec(t)) !== null) {
      const label = m[1].toUpperCase();
      const value = m[2].trim();
      if (!NAME_SHAPED.test(value) || NOT_A_PARTY.test(value)) continue;
      const key = `${d.jurisdiction}|${label}`;
      if (shown.has(key)) continue;
      shown.add(key);
      console.log(`  ${d.jurisdiction.split(',')[0].padEnd(18)}${label.padEnd(16)} ${oneLine(value, 70)}`);
    }
  }

  console.log('\n--- a role word NEAR a firm, which is a candidate and not a statement ---');
  let n = 0;
  for (const d of READABLE) {
    if (n >= 12) break;
    const t = textOf(d);
    SUFFIXED.lastIndex = 0;
    let s: RegExpExecArray | null;
    while ((s = SUFFIXED.exec(t)) !== null && n < 12) {
      const at = s.index;
      const win = t.slice(Math.max(0, at - 60), at + 60);
      if (!ROLE_NEAR.test(win)) continue;
      console.log(`  ${d.jurisdiction.split(',')[0].padEnd(18)}"${oneLine(win, 110)}"`);
      n++;
      break;
    }
  }
}

header();
if (SECTION === 'all' || SECTION === 'vocab') vocab();
if (SECTION === 'all' || SECTION === 'position') position();
if (SECTION === 'all' || SECTION === 'signals') signals();
if (SECTION === 'all' || SECTION === 'content') content();
if (SECTION === 'all' || SECTION === 'five') five();
if (SECTION === 'all' || SECTION === 'firms') firms();
