// THE DOCUMENT MODEL, AND THE PROVENANCE RULE.
//
// WHY THE DOCUMENTS ARE TRUSTED. A client reading one of these has to be able to
// tell three things apart at a glance:
//
//   [RECORD]      this is in a filing we captured, and here is the link
//   [PRESS]       this was reported somewhere, and here is who reported it
//   [ASSESSMENT]  this is Philip's read. It is not in any document.
//
// Blur those and the whole product is worthless: an assessment presented as a
// finding is a claim the client cannot check, and one wrong one destroys the
// credibility of the twenty that were right.
//
// ENFORCED IN CODE, NOT BY PROMPT OR BY CONVENTION.
//
// Three mechanisms, each closing a different hole:
//
//   1. THE TYPE. Every Line carries `provenance`. There is no default and the
//      field is not optional, so a section that emits a line without deciding
//      what kind of line it is does not compile.
//
//   2. THE CONSTRUCTOR. Commentary is the dangerous case - it is free text
//      Philip types, and it is the one thing that is never in a record. It can
//      only be built through commentaryLines(), which stamps ASSESSMENT itself.
//      A caller cannot pass a provenance to it, so commentary cannot be
//      mislabelled even deliberately.
//
//   3. THE GATE. assertProvenance() walks the whole document immediately before
//      rendering and throws on any line whose provenance is not one of the
//      three, and on any RECORD or PRESS line with no source. The renderer is
//      never reached with an unlabelled line, and generation fails loudly rather
//      than emitting a document that looks fine and is not.
//
// The third exists because the first two can be defeated by a cast, and this
// codebase does cast at the PostgREST boundary. The gate does not care how a
// line was constructed.

import type { ProjectParty } from './people';

export const PROVENANCE = ['RECORD', 'PRESS', 'ASSESSMENT'] as const;
export type Provenance = (typeof PROVENANCE)[number];

// ---- PRESS OR RECORD ---------------------------------------------------------
//
// The distinction is in the data, not in a guess. A record from the government
// or opportunity streams is a filing: an agenda item, a tender notice, a
// resolution. A record from the intelligence stream is trade press - it is how
// that lane works, and its source is a publication rather than a clerk.
//
// THAT PARAGRAPH WAS ALWAYS THE INTENT, AND THE CODE DID NOT IMPLEMENT IT. The
// rule was a list of source NAMES, so the question it actually answered was
// "has someone remembered to add this adapter?" rather than "is this a filing?"
// New York arrived with three government adapters and 325 filings from
// zap.planning.nyc.gov, a002-ceqraccess.nyc.gov and a856-cityrecord.nyc.gov
// rendered as [PRESS] in client documents - every one of them a primary
// government record, described to a client as something a journalist wrote.
//
// A WHITELIST FAILS IN THE WRONG DIRECTION. Measured over the corpus before
// this change: 328 of 778 government-stream records rendered as [PRESS], and 0
// of 410 intelligence-stream records rendered as [RECORD]. The rule was
// conservative in the direction that costs nothing and permissive in the
// direction that costs credibility, and it got worse every time an adapter was
// added, silently, in a document nobody re-reads.
//
// SO THE STREAM DECIDES. The stream is set at write time by the lane that
// captured the row (agents/scraper/government writes 'government'), so it is a
// statement about what the record IS, not about what anyone remembered.
//
// The asymmetry argument in the original comment still holds and is preserved:
// calling a filing "press" understates it, while calling a headline a "record"
// tells the client a document exists that they can go and read when it does
// not. That is why 'intelligence' returns false EXPLICITLY rather than falling
// through, and why an unknown stream still has to earn RECORD through the
// legacy list below rather than defaulting to it.
//
// IT LIVES HERE, beside the gate, because it is the rule that decides which
// label a captured row gets - the same subject as the rest of this file. It sat
// in report-sections until the entry builder needed it too, which would have
// meant those two modules importing each other.
type Stream = string | null | undefined;

// LEGACY ONLY. 487 rows in the corpus predate the stream column and carry null.
// This list exists for them and must not grow: a new adapter sets a stream, and
// a source added here instead would reintroduce exactly the failure above.
const LEGACY_RECORD_SOURCES = new Set([
  'legistar', 'agenda-portal', 'clark-tab', 'cftod-pdf', 'ceqanet', 'canadabuys',
  'tedeu', 'uktenders', 'iadb', 'worldbank', 'adb', 'afdb', 'undp', 'nepa_jm',
  'cayman_cpa', 'sfwmd',
  // Tender portals that were missing, found by auditing the corpus rather than
  // by noticing a bad document: 41 null-stream rows from these four render as
  // [PRESS] under the old list, and a tender notice is a filing by any reading.
  'tenderned', 'austender', 'ungm', 'gebiz',
]);

// Job boards are deliberately absent from that list and stay PRESS. An employer
// advertising a role is evidence a project exists; it is not a filing, and a
// client clicking through must not be told it was one.

export function isFiling(
  source: string | null | undefined,
  sourceType?: string | null,
  stream?: Stream
): boolean {
  // The stream is the answer whenever the row has one.
  if (stream === 'government' || stream === 'opportunity') return true;
  if (stream === 'intelligence') return false;
  // No stream: a legacy row. It has to earn RECORD.
  if (source && LEGACY_RECORD_SOURCES.has(source)) return true;
  if (sourceType && /agenda|filing|tender|permit|ordinance|resolution/i.test(sourceType)) return true;
  return false;
}

export interface Line {
  provenance: Provenance;
  text: string;
  // Where a RECORD or PRESS line came from. Required for those two by
  // assertProvenance: a record the client cannot open is not a record, it is a
  // claim.
  source?: string;
  sourceLabel?: string;
  // Optional trailing metadata, printed dimmed: a date, a market, a stage.
  meta?: string;
}

// ---- THE PROJECT ENTRY -------------------------------------------------------
//
// A LIST OF NAMES IS NOT A REPORT. The by-market section printed one line per
// project - the name, the stage, and a link - and never said what any of them
// was. 111 of the 171 live projects carry a derived, citable sentence describing
// themselves and none of it reached the page. A client paying for market
// intelligence received a list of strangers.
//
// An ENTRY is the unit the July standard actually uses: a project named, then
// described, then evidenced by its own dated filings. It is a structure rather
// than a formatted string because every part of it has a different provenance,
// and flattening it to text is what let a filing and an opinion end up wearing
// the same tag.
//
// WHY AN ENTRY CANNOT CARRY AN ASSESSMENT.
//
// The first generation printed [ASSESSMENT] on by-market lines, so a county
// zoning filing read as Philip's personal opinion. The brief asks for that to be
// impossible rather than fixed, so the Entry type has NO field an assessment can
// occupy: its records are RECORD or PRESS by type, and its one composed sentence
// is an `Assembled`, which is a branded string the caller cannot construct. The
// only producer is assembleSentence() below, and it takes RECORDS, not text -
// so there is no signature anywhere in the codebase through which a judgement,
// a model's paraphrase or a fixture's invention can enter an entry.
//
// Commentary still exists and is still Philip's; it lives on the Section, set
// apart, exactly where it did before.

export interface EntryPlayer {
  name: string;
  // 'applicant', 'representative', 'sponsor', 'presented by', 'awardee'. Named,
  // never bare: "Players: LIVCO" tells a reader a name and nothing about what
  // that party is to the matter, which is the thing they need in order to know
  // who to call.
  role: string;
}

export interface EntryRecord {
  // The date the record itself carries. A record whose date we never captured
  // prints without one rather than borrowing today's.
  date: string | null;
  // The case or file reference the record names, where it names one.
  reference: string | null;
  // What the filing seeks, in the plain language the source already used.
  text: string;
  // Acreage, unit counts, floor area, money - only where the record carries
  // them, and only when they are not already in the text above.
  figures: string[];
  // Set when the captured record is not in English and no English capture of
  // the same item exists to print instead. Anaheim publishes bilingual agendas;
  // a Spanish line in an English report is unreadable, and an unlabelled one is
  // worse than a labelled one.
  language: string | null;
  players: EntryPlayer[];
  // "Elias George, EPG Law Group. No phone or email in the record." The negative
  // half is not decoration: 24 of the 33 records carrying a named individual
  // carry no way to reach them, and a contact line that goes quiet about that
  // reads as though a phone number exists somewhere.
  contact: string | null;
  // A record inside an entry is a filing or it is press. There is no third
  // option, which is the point.
  provenance: 'RECORD' | 'PRESS';
  url: string;
  sourceLabel: string;
}

// A branded string. Structurally a string, but no literal is assignable to it,
// so the only value of this type in the program is one assembleSentence() made.
declare const ASSEMBLED: unique symbol;
export type Assembled = string & { readonly [ASSEMBLED]: true };

// Every assembled sentence opens by attributing itself to the record set, and
// the gate enforces it. A sentence that begins this way cannot be read as a
// market judgement, and one that does not begin this way never reaches a page.
const ASSEMBLED_OPENER = 'Records show';

export interface Entry {
  id: string;
  // The name of the thing, not a case number and not a bare address.
  name: string;
  // Market and stage, printed small beside the name.
  meta: string;
  // THE SUBHEADING THIS ENTRY SITS UNDER. Geography, inside a category section:
  // the renderer prints it whenever it changes and never twice in a row, so a
  // category holding one market prints one subheading and a category holding
  // seven prints seven. Null in a document that does not group.
  //
  // A FIELD ON THE ENTRY RATHER THAN A NESTED GROUP TYPE, because the
  // provenance gate walks section.entries and every check it makes is per
  // entry. Nesting would have meant teaching the gate about a second level of
  // structure to gain nothing it needs.
  group?: string | null;
  // SENTENCE ONE: quoted from a filing, with the filing's link. Null when the
  // project has no derived summary - 60 of 171 do not, and inventing one for
  // them is the failure this whole layer exists to prevent.
  summary: { text: string; url: string } | null;
  // SENTENCE TWO: assembled from the record set below it.
  assembled: Assembled | null;
  // WHO IS INVOLVED, ONCE, BEFORE THE FILINGS. Parties used to be printed inside
  // every record line, so a six-filing project named its applicant six times and
  // the reader had to notice a repetition to learn who was behind it. See
  // lib/people for what a role is allowed to be.
  people: ProjectParty[];
  // Set instead of `people` when the records name nobody. An empty heading and a
  // stated absence are different claims.
  noPeopleNote: string | null;
  records: EntryRecord[];
}

/**
 * THE ONLY WAY TO BUILD THE ASSEMBLED SENTENCE.
 *
 * Takes records and returns prose. It cannot be handed a sentence, so nothing a
 * person or a model wrote can become one, and every clause it emits is chosen by
 * a term that appears in the records passed in.
 *
 * Deliberately narrow. It recognises procedural shapes a filing set actually
 * has - a matter held in abeyance, a bill across readings, a set of filings
 * spanning dates - and when it recognises none it says how many records there
 * are and when, which is the most it can say without characterising them.
 */
export function assembleSentence(records: EntryRecord[]): Assembled | null {
  if (records.length === 0) return null;

  const dated = records.map((r) => r.date).filter((d): d is string => !!d).sort();
  const first = dated[0];
  const last = dated[dated.length - 1];
  const span = first && last && first !== last ? ` between ${first} and ${last}` : '';

  // FILINGS AND PRESS ARE COUNTED SEPARATELY, because they are not the same
  // evidence. A first draft of this sentence read "Records show 8 filings" over
  // a set that was three newspaper stories and five agenda items, which
  // overstates the record by exactly the margin that matters.
  const filings = records.filter((r) => r.provenance === 'RECORD').length;
  const press = records.length - filings;
  const counted =
    filings && press
      ? `${filings} filing${filings === 1 ? '' : 's'} and ${press} press report${press === 1 ? '' : 's'}`
      : filings
        ? `${filings} filing${filings === 1 ? '' : 's'}`
        : `${press} press report${press === 1 ? '' : 's'}`;

  if (records.length === 1) {
    const d = records[0].date;
    return `${ASSEMBLED_OPENER} ${counted}${d ? `, dated ${d}` : ''}.` as Assembled;
  }

  const haystack = records.map((r) => `${r.text} ${r.reference ?? ''}`.toLowerCase());
  const hits = (term: string) => haystack.filter((h) => h.includes(term)).length;

  // A CHARACTERISATION NEEDS A MAJORITY, NOT A PAIR.
  //
  // Both lookups below used to fire on two matches out of any number. Measured
  // against the corpus that produced: "Records show the conditional use permit
  // amended more than once" over an OCVibe set whose eight records were a
  // development-agreement compliance review, an Olympic games agreement, an EIR
  // certification and a parking deck - two of which happened to contain the
  // words. The sentence was mechanically derived and still wrong, because a
  // term appearing twice does not make it what the set is about.
  //
  // So a phrase is only used when it describes MOST of the records. Below that
  // threshold the sentence says how many records there are and when, which is
  // less interesting and always true.
  const majority = Math.ceil(records.length / 2);

  // The instrument the records are about. Longest phrase first so "site
  // development plan review" wins over "development agreement", and the most
  // frequent among those that clear the threshold wins over list order.
  const INSTRUMENTS = [
    'site development plan review', 'first amended and restated development agreement',
    'environmental impact report', 'general plan amendment', 'conditional use permit',
    'zoning text amendment', 'development application', 'development agreement',
    'cooperative agreement', 'special use permit', 'tentative map', 'use permit',
    'zoning map amendment', 'environmental review', 'public hearing', 'ground lease',
    'redevelopment plan', 'variance', 'rezoning', 'ordinance', 'resolution',
  ];
  const instrument =
    INSTRUMENTS.map((i) => ({ i, n: hits(i) }))
      .filter((x) => x.n >= majority)
      .sort((a, b) => b.n - a.n || b.i.length - a.i.length)[0]?.i ?? null;

  // The procedural state, likewise taken from the records and likewise needing
  // to describe most of them.
  const STATES: [string, string][] = [
    ['abeyance', 'held repeatedly in abeyance'],
    ['renotification', 'renotified more than once'],
    ['continued', 'continued across multiple sittings'],
    ['reading', 'advancing across multiple readings'],
    ['public hearing', 'taken to public hearing more than once'],
    ['certification', 'moving through environmental certification'],
    ['award', 'moving through contract award'],
    ['amendment', 'amended more than once'],
  ];
  const state = STATES.map(([term, phrase]) => ({ phrase, n: hits(term) }))
    .filter((x) => x.n >= majority)
    .sort((a, b) => b.n - a.n)[0]?.phrase ?? null;

  if (state && instrument) {
    return `${ASSEMBLED_OPENER} the ${instrument} ${state}.` as Assembled;
  }
  if (state) {
    return `${ASSEMBLED_OPENER} the matter ${state}.` as Assembled;
  }
  if (instrument) {
    return `${ASSEMBLED_OPENER} ${counted} on the ${instrument}${span}.` as Assembled;
  }
  return `${ASSEMBLED_OPENER} ${counted}${span}.` as Assembled;
}

export interface Section {
  id: string;
  title: string;
  // What the section is, printed under the heading in the document itself so a
  // reader knows what they are looking at.
  lede?: string;
  lines: Line[];
  // A section that describes projects rather than listing lines carries entries
  // instead. Both are rendered; a section normally uses one or the other.
  entries?: Entry[];
  // Philip's commentary on this section. Always ASSESSMENT; see below.
  commentary: Line[];
  // Set when a section had nothing to say. Rendered as an explicit statement
  // rather than omitted: a missing section and an empty one mean different
  // things, and silently dropping one is how a report implies coverage it does
  // not have.
  emptyNote?: string;
}

export interface DocumentScopeStatement {
  // Printed on the cover, always. A report scoped to Nevada says so.
  geography: string;
  period: string;
  pipeline: string;
  filters: string[];
  // True when the period has not closed, so the document is not reproducible.
  periodOpen: boolean;
}

export interface ReportDocument {
  title: string;
  brandName: string;
  addressee: string;
  clientName: string | null;
  generatedAt: string;
  scope: DocumentScopeStatement;
  sections: Section[];
  projectCount: number;
  recordCount: number;
}

/**
 * The ONLY way to build commentary.
 *
 * Takes text and returns ASSESSMENT lines. There is deliberately no provenance
 * parameter: a caller cannot mark Philip's own writing as a record, and does not
 * have to remember to mark it as an assessment either.
 */
export function commentaryLines(text: string | null | undefined): Line[] {
  const t = String(text ?? '').trim();
  if (!t) return [];
  return t
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ provenance: 'ASSESSMENT' as const, text: p }));
}

/**
 * A captured filing. RECORD requires a link, because the point of the label is
 * that the client can go and read it.
 */
export function recordLine(text: string, source: string, sourceLabel?: string, meta?: string): Line {
  return { provenance: 'RECORD', text, source, sourceLabel, meta };
}

/** Something reported elsewhere. Same requirement: name who reported it. */
export function pressLine(text: string, source: string, sourceLabel?: string, meta?: string): Line {
  return { provenance: 'PRESS', text, source, sourceLabel, meta };
}

export class ProvenanceError extends Error {}

/** A document that contradicts itself on its own cover. */
export class BasisError extends Error {}

/**
 * REFUSE A DOCUMENT WHOSE BASIS CONTRADICTS ITSELF.
 *
 * The report that started this rewrite went out with a cover reading
 *
 *   BASIS  229 projects, 0 records
 *
 * over sections that each read "no filing in this period". Both halves were
 * produced correctly: 229 projects matched the scope, and 0 records matched a
 * period that had collapsed to a single day. The document was internally
 * consistent with its own inputs and was nonsense as a document, which is a
 * class of failure no amount of care inside the sections can catch, because
 * every section was individually right.
 *
 * So the check is on the WHOLE document, immediately before rendering, beside
 * the provenance gate and for the same reason: generation should fail loudly
 * rather than produce something that looks finished.
 *
 * Projects with no records is the only combination refused. The reverse is
 * impossible (a record in scope belongs to a project in scope), and a document
 * with neither is a legitimately empty scope, which the sections state honestly
 * in their empty notes.
 */
export function assertBasis(doc: ReportDocument): void {
  if (doc.projectCount > 0 && doc.recordCount === 0) {
    throw new BasisError(
      `This document covers ${doc.projectCount} project${doc.projectCount === 1 ? '' : 's'} ` +
        `and 0 records for ${doc.scope.period}. Every section would read "no filing in this period" ` +
        `under a cover claiming ${doc.projectCount} project${doc.projectCount === 1 ? '' : 's'}. ` +
        `Widen the period, or narrow the scope to match it.`
    );
  }
}

/**
 * THE GATE. Throws unless every line in the document is properly labelled and
 * sourced.
 *
 * Called by the generation route before rendering, so a defect stops the
 * document rather than shipping inside it. The error names the section and the
 * text, because "provenance error" with no location is not actionable.
 */
export function assertProvenance(doc: ReportDocument): void {
  const valid = new Set<string>(PROVENANCE);
  for (const section of doc.sections) {
    const all = [...section.lines, ...section.commentary];
    for (const line of all) {
      if (!valid.has(line.provenance as string)) {
        throw new ProvenanceError(
          `Unlabelled line in section "${section.id}": ${JSON.stringify(line.text).slice(0, 120)}`
        );
      }
      if ((line.provenance === 'RECORD' || line.provenance === 'PRESS') && !line.source) {
        throw new ProvenanceError(
          `${line.provenance} line with no source in section "${section.id}": ` +
            JSON.stringify(line.text).slice(0, 120)
        );
      }
    }
    // Commentary that is not an assessment is the specific defect the brief
    // names: a generator that can emit an assessment without labelling it.
    for (const line of section.commentary) {
      if (line.provenance !== 'ASSESSMENT') {
        throw new ProvenanceError(
          `Commentary in section "${section.id}" is labelled ${line.provenance}, not ASSESSMENT.`
        );
      }
    }
    // THE ENTRIES, HELD TO THE SAME RULE AND TO TWO MORE.
    //
    // The type already stops an assessment reaching an entry. These are the
    // runtime half, for the same reason the line gate exists: this codebase
    // casts at the PostgREST boundary and a cast defeats a brand.
    for (const entry of section.entries ?? []) {
      if (entry.records.length === 0) {
        // An entry with no filing under it is a project name and an implication.
        // That is the by-market line this rewrite exists to delete, and it must
        // not come back as an empty entry.
        throw new ProvenanceError(
          `Entry "${entry.name}" in section "${section.id}" has no records. ` +
            `A project with nothing to cite is excluded from the section, not printed empty.`
        );
      }
      if (entry.assembled !== null && !entry.assembled.startsWith(ASSEMBLED_OPENER)) {
        throw new ProvenanceError(
          `Assembled sentence in entry "${entry.name}" (section "${section.id}") does not ` +
            `attribute itself to the record set: ${JSON.stringify(entry.assembled).slice(0, 120)}`
        );
      }
      if (entry.summary && !entry.summary.url) {
        throw new ProvenanceError(
          `Entry "${entry.name}" in section "${section.id}" prints a summary with no filing to cite.`
        );
      }
      // A NAMED PARTY IS A CLAIM ABOUT A PERSON, so it is held to the record
      // rule: labelled, and pointing at the filing that names them.
      for (const party of entry.people) {
        if (party.provenance !== 'RECORD' && party.provenance !== 'PRESS') {
          throw new ProvenanceError(
            `Party "${party.name}" in entry "${entry.name}" is labelled ${String(party.provenance)}.`
          );
        }
        if (!party.sourceUrl) {
          throw new ProvenanceError(
            `Party "${party.name}" in entry "${entry.name}" names a person with no record to cite.`
          );
        }
        if (party.roles.length === 0) {
          throw new ProvenanceError(
            `Party "${party.name}" in entry "${entry.name}" is named with no role.`
          );
        }
      }
      for (const r of entry.records) {
        if (r.provenance !== 'RECORD' && r.provenance !== 'PRESS') {
          throw new ProvenanceError(
            `Entry record in "${entry.name}" (section "${section.id}") is labelled ` +
              `${String(r.provenance)}; an entry record is a filing or it is press.`
          );
        }
        if (!r.url) {
          throw new ProvenanceError(
            `Entry record in "${entry.name}" (section "${section.id}") has no link: ` +
              JSON.stringify(r.text).slice(0, 120)
          );
        }
      }
    }
  }
}

/**
 * Counts by provenance, for the preview and the coverage note.
 *
 * ENTRY RECORDS COUNT. The tally is what the composer shows and what the
 * harness asserts on, so a section that moved its content from lines into
 * entries must not read as though the document emptied out. The summary
 * sentence counts as a RECORD because it is a quotation carrying its own link;
 * the assembled sentence counts as nothing, because it is a caption of the
 * records beneath it rather than a further claim.
 */
export function provenanceTally(doc: ReportDocument): Record<Provenance, number> {
  const out: Record<Provenance, number> = { RECORD: 0, PRESS: 0, ASSESSMENT: 0 };
  for (const s of doc.sections) {
    for (const l of [...s.lines, ...s.commentary]) out[l.provenance]++;
    for (const e of s.entries ?? []) {
      if (e.summary) out.RECORD++;
      for (const party of e.people) out[party.provenance]++;
      for (const r of e.records) out[r.provenance]++;
    }
  }
  return out;
}

// A page holds roughly this many lines at the document's type size, measured
// against the existing renderer's A4 layout. Used for the composer's page
// estimate, which is deliberately called an estimate.
const LINES_PER_PAGE = 34;

export function estimatePages(doc: ReportDocument): number {
  let lines = 6; // the cover
  for (const s of doc.sections) {
    lines += 3 + s.lines.length * 2 + s.commentary.length * 2 + (s.emptyNote ? 1 : 0);
    // An entry is a heading, a description paragraph, and its records - each of
    // which wraps, and each of which may carry a contact line under it.
    for (const e of s.entries ?? []) {
      lines += 3 + (e.summary ? 2 : 0) + e.people.length * 3 + (e.noPeopleNote ? 1 : 0);
      for (const r of e.records) lines += 3 + (r.contact ? 1 : 0);
    }
  }
  return Math.max(1, Math.ceil(lines / LINES_PER_PAGE));
}

/** "1 project, 4 records" - the basis line, pluralised. */
export function basisLine(projects: number, records: number): string {
  return `${projects} project${projects === 1 ? '' : 's'}, ${records} record${records === 1 ? '' : 's'}`;
}
