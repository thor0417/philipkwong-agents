// HOW MANY NEW YORK PROJECTS GAIN A NAMED PRIVATE PARTY AND A PROGRAM FACT.
//
//   node --env-file=.env.local --import tsx agents/scraper/diagnostics/ceqr-parties.ts
//   node ... ceqr-parties.ts --tiers unfiled,draft_scope     which kinds to fetch
//   node ... ceqr-parties.ts --sample det_significance,eas   fetch 3 of each and stop
//
// MEASURED ACROSS ALL 63 PROJECTS, NOT ON BALLY'S. Bally's is the check at the
// end and never the target: what we do for one has to work for all, and a reader
// tuned on the one document that is easy to read is a reader that works once.
//
// ---------------------------------------------------------------------------
// FETCH SELECTIVELY, IN TIERS, BECAUSE THE DOWNLOAD IS THE SCHEDULE
// ---------------------------------------------------------------------------
//
// 217 seconds to fetch against 0.2 to parse. An exhaustive pass does not fit in
// a day, so each tier has to earn its place:
//
//   1. unfiled root documents   the CPC reports, the only source of the named
//                               INDIVIDUALS. There is exactly one in 63
//                               projects, which is itself the finding.
//   2. draft_scope covers       the applicant ENTITY and the consultant. 32
//                               documents, all PDF.
//   3. sampled, then judged     det_significance (43) and eas (43) are
//                               unmeasured. Three of each are read and reported
//                               BEFORE the other 80 are fetched.
//   -  never                    lead_agency_letter, proved to name only
//                               officials; and every .zip, 34 of them, because
//                               an archive step is not today.
//
// ---------------------------------------------------------------------------
// TWO DOCUMENT SHAPES, AND THE READER HANDLES BOTH
// ---------------------------------------------------------------------------
//
// FLATTENED FORM, keyed on a colon. Side-by-side fields join with no separator,
// so a value ends only where the next label begins:
//
//   Applicant: Christopher JewettApplicant's Administrator: Carol Rosenthal
//
// LINE-ORIENTED COVER, keyed on position. The label is alone on its line and
// carries no colon at all:
//
//   Applicant
//   Bally's New York Operating Company, LLC
//
// A detector for one is blind to the other, and the blindness is silent: it
// reports zero, which reads as a fact about the corpus. So both run, and every
// hit records which shape produced it.
//
// ---------------------------------------------------------------------------
// OFFICIALS NEVER BECOME PARTIES
// ---------------------------------------------------------------------------
//
// Hillary Semel is MOEC's Director and receives every CEQR submission in the
// city. She is on every document and belongs to none of them: reading her as a
// party would put one city official on ninety projects and would be the
// government-mover defect at scale. The same holds for the commissioner who
// signs, the borough president who recommends and the board members who vote.
//
// This is enforced twice over, and the belt is the important half:
//
//   BY KEY   only the three applicant labels may produce a party. A signature
//            block, a letterhead, an addressee line and a title block are never
//            read, because no key points at them.
//   BY NAME  the officials below are refused even if a future label change
//            reaches them, and the refusal is COUNTED so a silent block shows up
//            as a number rather than as an absence.

import { readFileSync, existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  fetchDocumentBytes,
  rehydrate,
  type CeqrDocument,
  type CeqrProjectDocuments,
} from '../sources/nyc-ceqr-documents';

const arg = (n: string): string | null => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? (process.argv[i + 1] ?? null) : null;
};
const IN = 'agents/scraper/fixtures/ceqr-inventory.jsonl';
const TIERS = (arg('tiers') ?? 'unfiled,draft_scope').split(',').filter(Boolean);
const SAMPLE_KINDS = (arg('sample') ?? '').split(',').filter(Boolean);
const SAMPLE_N = Number(arg('samplen') ?? 3);
const TIMEOUT_MS = Number(arg('timeout') ?? 300_000);

// ---- THE THREE KEYS, AND NOTHING ELSE ---------------------------------------
const PARTY_KEYS = ['Applicant', "Applicant's Administrator", "Applicant's Primary Contact"];
// The consultant is not a party to the project; it is who prepared the document,
// and it is worth capturing under its own name rather than folded in with the
// applicant.
const CONSULTANT_KEYS = ['Prepared By', 'Prepared by'];

// Named refusals. Public officials, by role, who appear on documents across the
// whole corpus. See the header: this is the belt, the keys are the braces.
const OFFICIALS = [
  'Hillary Semel', 'Hilary Semel',   // MOEC Director, on every CEQR submission
  'Kevin D. Kim', 'Kevin Kim',       // SBS Commissioner
  'Daniel Garodnick',                // DCP Director / CPC Chair
  'Vanessa Gibson', 'Vanessa L. Gibson', // Bronx Borough President
  'Joseph Russo',                    // Community Board
  'S. Lenard', 'Lenard',             // Community Board
];
const isOfficial = (name: string): boolean =>
  OFFICIALS.some((o) => name.toLowerCase().includes(o.toLowerCase()));

const normaliseQuotes = (s: string): string => s.replace(/[‘’ʼʹ]/g, "'").replace(/[“”]/g, '"');

/**
 * A value from the FLATTENED shape: everything between this label's colon and
 * the next label, whichever label that is.
 *
 * The terminator set is every key we know plus the neighbouring form fields that
 * sit beside them, because in flattened text a value has no other boundary. A
 * label missing from this list is a field whose value swallows the next one.
 */
const FLAT_TERMINATORS = [
  ...PARTY_KEYS, ...CONSULTANT_KEYS,
  'Project Name', 'Application #', 'Borough', 'CEQR Number', 'Validated Community Districts',
  'Docket Description', 'Public Hearing Location', 'Date of Public Hearing', 'Date of Vote',
  'In Favor', 'Against', 'Abstaining', 'RECOMMENDATION', 'CONSIDERATION', 'Certification Date',
  'Vote Location', 'Date', 'Lead Agency',
];

function flatValues(text: string, key: string): string[] {
  const t = normaliseQuotes(text);
  const out: string[] = [];
  // Escaped, because the keys contain an apostrophe and a #.
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // ---- NOT EVERY LABEL ENDS IN A COLON, AND ONE OF THEM IS THE NEXT FIELD ---
  //
  // This required a colon after the terminator. "Application #" has none, so it
  // terminated nothing and the value ran straight into it. Measured output:
  //
  //     Applicant's Administrator: Carol Rosenthal Application # 250085MMX
  //
  // The enumeration pass had ALREADY reported that "Application # carries no
  // colon at all, so a colon-keyed detector has a hole in it before anyone
  // writes one" - and then this was written with that hole. The finding was
  // made and not applied, which is rule 8 in miniature.
  //
  // So a terminator may match with or without a trailing colon, and the
  // colonless alternative is restricted BY NAME to the labels that genuinely
  // have none. Left open to all of them, a bare "Date" would cut any value
  // containing the word.
  const COLONLESS = new Set(['Application #']);
  const withColon = FLAT_TERMINATORS.filter((l) => !COLONLESS.has(l)).map(esc).join('|');
  const colonless = [...COLONLESS].map(esc).join('|');
  const re = new RegExp(
    `${esc(key)}:\\s*([\\s\\S]{1,200}?)(?=(?:${withColon})\\s*:|(?:${colonless})|$)`,
    'g'
  );
  for (const m of t.matchAll(re)) {
    const v = m[1].replace(/\s+/g, ' ').trim().replace(/[;,]$/, '');
    if (v) out.push(v);
  }
  return out;
}

/**
 * A value from the LINE-ORIENTED shape: the lines following a label that is
 * alone on its own line, up to the next blank line or the next such label.
 */
function lineValues(text: string, key: string): string[] {
  const lines = normaliseQuotes(text).split('\n');
  const out: string[] = [];
  const isLabelLine = (l: string) => /^[ \t]*[A-Z][A-Za-z'&/-]*(?:[ \t]+[A-Za-z'&/-]+){0,4}[ \t]*$/.test(l);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== key) continue;
    const value: string[] = [];
    for (let j = i + 1; j < lines.length && value.length < 6; j++) {
      const l = lines[j];
      if (!l.trim()) { if (value.length) break; continue; }
      if (value.length && isLabelLine(l) && l.trim() !== key) break;
      value.push(l.trim());
    }
    const v = value.join(', ').replace(/\s+/g, ' ').trim();
    if (v) out.push(v);
  }
  return out;
}

/** rooms, floors, square feet, acres, units: a program fact the filing states. */
const PROGRAM = [
  ['rooms', /\b([\d,]{2,7})\s+(?:hotel\s+)?(?:guest\s*)?rooms?\b/i],
  ['units', /\b([\d,]{2,7})\s+(?:residential\s+|dwelling\s+)?units?\b/i],
  ['floor area', /\b([\d,]{4,12})\s*(?:gross\s+)?(?:square\s+feet|sf|gsf)\b/i],
  ['site area', /\b([\d.,]{1,8})[- ]acres?\b/i],
  ['storeys', /\b([\d]{1,3})[- ]stor(?:y|ey|ies)\b/i],
  ['seats', /\b([\d,]{3,7})\s+seats?\b/i],
] as const;

function programFacts(text: string): { kind: string; display: string; sentence: string }[] {
  const out: { kind: string; display: string; sentence: string }[] = [];
  const seen = new Set<string>();
  for (const [kind, re] of PROGRAM) {
    const m = re.exec(text);
    if (!m) continue;
    if (seen.has(kind)) continue;
    seen.add(kind);
    const at = m.index ?? 0;
    out.push({
      kind,
      display: m[1],
      // The sentence it was read from, so the figure can be checked against the
      // words around it rather than taken. Same contract as filing_facts.
      sentence: text.slice(Math.max(0, at - 90), at + 110).replace(/\s+/g, ' ').trim(),
    });
  }
  return out;
}

interface Found {
  ceqr: string;
  kind: string;
  label: string;
  parties: { key: string; name: string; shape: 'flat' | 'line' }[];
  consultants: string[];
  officialsRefused: string[];
  program: { kind: string; display: string; sentence: string }[];
}

async function readDocument(d: CeqrDocument): Promise<Found | { d: CeqrDocument; failure: string }> {
  const got = await fetchDocumentBytes(d, { timeoutMs: TIMEOUT_MS });
  if (!got.bytes) return { d, failure: `${got.how} (${got.seconds.toFixed(0)}s)` };
  let text = '';
  try {
    // @ts-ignore - declared in ../sources/pdf-parse.d.ts
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
    text = (await pdfParse(got.bytes)).text;
  } catch (e) {
    return { d, failure: `parse failed: ${String(e).slice(0, 90)}` };
  }
  const parties: Found['parties'] = [];
  const officialsRefused: string[] = [];
  for (const key of PARTY_KEYS) {
    for (const [shape, values] of [['flat', flatValues(text, key)], ['line', lineValues(text, key)]] as const) {
      for (const name of values) {
        if (isOfficial(name)) { officialsRefused.push(`${key}=${name}`); continue; }
        // ONE PERSON, ONCE. A CPC report appends a Borough President form and
        // three Community/Borough Board forms, and every one names the same
        // primary contact. Deduped on the NAME across keys rather than on
        // key+name, so Carol Rosenthal is not printed four times under two
        // labels. The first key that produced her is the one recorded.
        if (!parties.some((p) => p.name === name)) parties.push({ key, name, shape });
      }
    }
  }
  const consultants: string[] = [];
  for (const key of CONSULTANT_KEYS) {
    for (const v of [...flatValues(text, key), ...lineValues(text, key)]) {
      if (!isOfficial(v) && !consultants.includes(v)) consultants.push(v);
    }
  }
  return {
    ceqr: d.ceqr, kind: d.kind, label: d.label,
    parties, consultants, officialsRefused, program: programFacts(text),
  };
}

async function main(): Promise<void> {
  if (!existsSync(IN)) throw new Error(`no inventory at ${IN}; run ceqr-inventory first`);
  const projects: CeqrProjectDocuments[] = rehydrate(
    readFileSync(IN, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  );
  const all = projects.flatMap((p) => p.documents);

  // The work list, in tier order, PDFs only.
  const work: CeqrDocument[] = [];
  for (const kind of TIERS) work.push(...all.filter((d) => d.kind === kind && d.extension !== 'zip'));
  for (const kind of SAMPLE_KINDS) {
    work.push(...all.filter((d) => d.kind === kind && d.extension !== 'zip').slice(0, SAMPLE_N));
  }
  const zipsSkipped = all.filter(
    (d) => d.extension === 'zip' && [...TIERS, ...SAMPLE_KINDS].includes(d.kind)
  ).length;

  console.log('='.repeat(78));
  console.log(`READING ${work.length} DOCUMENTS  (tiers: ${TIERS.join(', ')}` +
    `${SAMPLE_KINDS.length ? `; sampled: ${SAMPLE_KINDS.join(', ')} x${SAMPLE_N}` : ''})`);
  console.log(`  ${zipsSkipped} archives in these kinds are NOT fetched; an unzip step does not exist.`);
  console.log(`  the corpus is ${projects.length} projects, ${all.length} documents.`);
  console.log('='.repeat(78));

  const found: Found[] = [];
  const failed: { d: CeqrDocument; failure: string }[] = [];
  for (const [i, d] of work.entries()) {
    process.stdout.write(`  [${String(i + 1).padStart(3)}/${work.length}] ${d.ceqr} ${d.kind} ... `);
    const r = await readDocument(d);
    if ('failure' in r) { console.log(r.failure); failed.push(r); continue; }
    console.log(
      `${r.parties.length} part${r.parties.length === 1 ? 'y' : 'ies'}, ` +
      `${r.consultants.length} consultant, ${r.program.length} program, ` +
      `${r.officialsRefused.length} official${r.officialsRefused.length === 1 ? '' : 's'} refused`
    );
    found.push(r);
    await sleep(200);
  }

  // ---- THE NUMBER THE BRIEF ASKED FOR --------------------------------------
  const partyProjects = new Set(found.filter((f) => f.parties.length).map((f) => f.ceqr));
  const programProjects = new Set(found.filter((f) => f.program.length).map((f) => f.ceqr));
  const both = [...partyProjects].filter((c) => programProjects.has(c));
  console.log('\n' + '='.repeat(78));
  console.log('ACROSS ALL 63 PROJECTS');
  console.log('='.repeat(78));
  console.log(`  gain a named private party : ${partyProjects.size} of ${projects.length}`);
  console.log(`  gain a program fact        : ${programProjects.size} of ${projects.length}`);
  console.log(`  gain BOTH                  : ${both.length} of ${projects.length}`);
  console.log(`  documents read             : ${found.length}, failed ${failed.length}`);

  const refused = found.flatMap((f) => f.officialsRefused);
  console.log(`\n  officials refused by name  : ${refused.length}`);
  for (const r of [...new Set(refused)].slice(0, 12)) console.log(`      ${r}`);

  console.log('\n  PARTIES, BY PROJECT');
  for (const f of found.filter((x) => x.parties.length || x.consultants.length)) {
    console.log(`    ${f.ceqr}  [${f.kind}]`);
    for (const p of f.parties) console.log(`        ${p.shape.padEnd(4)} ${p.key}: ${p.name.slice(0, 90)}`);
    for (const c of f.consultants) console.log(`        cons Prepared By: ${c.slice(0, 90)}`);
    for (const g of f.program) console.log(`        prog ${g.kind}: ${g.display}`);
  }

  if (failed.length) {
    console.log('\n  NOT READ, with the reason. A named negative, never a silent skip.');
    const byReason = new Map<string, number>();
    for (const f of failed) {
      const key = f.failure.replace(/\d+/g, 'N');
      byReason.set(key, (byReason.get(key) ?? 0) + 1);
    }
    for (const [reason, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`      ${String(n).padStart(3)}  ${reason}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
