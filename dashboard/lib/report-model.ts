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

// ---- WHO TO NAME AS THE SOURCE OF A LINE -------------------------------------
//
// A DOCUMENT THAT PROMISES A PUBLISHER MUST PRINT ONE. Every generated report
// carries the sentence "The press reports listed here are beyond that record and
// are attributed to their publisher", and beneath it every press line was
// attributed to "gli_serper" - the name of our own search lane. A client reading
// the July brief sees "Las Vegas Review-Journal"; a client reading the generated
// one saw an internal identifier three times on every project.
//
// FOUND IN THREE PLACES AT ONCE, which is why it is fixed here rather than at any
// of them: the entry's record lines, the entry's press-sourced parties, and the
// scale block. All three wrote `source ?? host(url)` - the source name FIRST -
// and for an intelligence row the source name is always the lane.
//
// THE RULE IS PROVENANCE, NOT PREFERENCE. For a filing the source name IS the
// record system a reader would ask for - "legistar", "clark-tab", "ceqanet" - and
// its host is an anonymous government CDN. For press the publisher is the host
// and the source name is our plumbing. So the answer differs by provenance, which
// is the same distinction isFiling above already draws.
// THE SOURCE NAME IS NOT A CITATION, AND THIS IS THE CORRECTION TO THE PARAGRAPH
// ABOVE.
//
// The rule above says that for a filing the source name is what a reader would
// ask for. That was right about press and wrong about filings, and the Heart
// Hotel brief is the demonstration: eighteen consecutive lines each attributed
// to "legistar", under a legend promising "the link to the filing itself".
// "Legistar" is Granicus's agenda product. It is the software the county happens
// to publish through - our plumbing at one remove, the same category of fact as
// "gli_serper" - and it names neither the body that issued the document, nor the
// document, nor when. A reader cannot cite it and cannot tell two of the
// eighteen apart.
//
// WHAT A CITATION HAS TO CARRY. Enough for the recipient of a forwarded brief to
// (a) tell one line from the next, (b) weigh it - a staff report and a newspaper
// are different evidence, and so are minutes from May and minutes from July -
// and (c) go and find it. That is the issuing body, what the document is, its
// date, and the link. Every one of those is already on the record and none of
// them reached the page.
//
// BUILT ONLY FROM STORED VALUES, never composed. Where a record carries no
// market or no type, the citation is shorter rather than invented, and if it
// carries neither this falls back to exactly the old behaviour.
export interface CitationDetail {
  sourceType?: string | null;
  /** The issuing body, as the record stores it. */
  market?: string | null;
  /** ISO date of the record; rendered as a date, never as a timestamp. */
  date?: string | null;
}

/** "21 July 2026" from an ISO date, or '' when there is not one. */
function citationDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(String(iso).slice(0, 10));
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;
}

export function citationLabel(
  source: string | null | undefined,
  url: string | null | undefined,
  filing: boolean,
  detail?: CitationDetail
): string {
  let publisher = '';
  try {
    publisher = url ? new URL(url).hostname.replace(/^www\./, '') : '';
  } catch {
    publisher = '';
  }
  // PRESS IS UNCHANGED. The publisher is the host and that is a real citation.
  if (!filing) return publisher || source || 'press';
  const what = [detail?.market, detail?.sourceType].filter(Boolean).join(' ').trim();
  const when = citationDate(detail?.date);
  if (what && when) return `${what}, ${when}`;
  if (what) return what;
  return source || publisher || 'source';
}

// ---- THE SAME RULE, AS A LABEL ON A ROW --------------------------------------
//
// THE THREE STREAM TABS ON /records ARE GONE AND THIS IS WHAT REPLACED THEM.
//
// Opportunities, Intelligence and Government were three destinations telling the
// operator which LANE captured a row, which is a fact about our plumbing rather
// than about the subject. Provenance is worth knowing - it is the difference
// between a filing a client can open and a story somebody wrote - but it is a
// property of a record, so it belongs on the record, not in the navigation.
//
// THE DOCUMENT'S RULE, NOT A SECOND ONE. isFiling above is what decides RECORD
// against PRESS in a client document; this reads it and then splits RECORD in
// two, because a tender notice with a deadline you can still bid into is a
// different object from a council resolution. The report keeps its two labels -
// its Provenance type is unchanged and this is not part of it - so a document
// and a screen can disagree about the WORD while agreeing about the fact.
export type RecordProvenance = 'RECORD' | 'PRESS' | 'TENDER';

export function recordProvenance(
  source: string | null | undefined,
  sourceType?: string | null,
  stream?: Stream
): RecordProvenance {
  if (!isFiling(source, sourceType, stream)) return 'PRESS';
  return stream === 'opportunity' ? 'TENDER' : 'RECORD';
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

// ---- SCALE, WHERE A READER LOOKS FOR IT --------------------------------------
//
// A room count sat on a record line six filings down, or nowhere at all, and the
// first question anyone asks about a development is how big it is. So the figures
// are lifted to the top of the entry, once, deduplicated.
//
// PRESS BY TYPE, NOT BY CONVENTION. `provenance` is the literal 'PRESS' and
// nothing else is assignable to it, because the whole point of this block is that
// it is the press half of the entry: an article's number is not a filing's
// number, and the reader has to be able to see which one they are weighing. The
// figures the FILINGS carry stay on their own record lines, labelled [RECORD],
// and no press value is ever written into one - figuresOf() in report-entry reads
// title and action_sought and has no access to an article body.
//
// EVERY FIGURE CARRIES ITS OWN LINK, and the sentence it was printed in. The
// sentence is not decoration: it is what the gate below checks the figure against,
// so a display string that is not a quotation from the text beside it cannot be
// rendered.
export interface EntryFigure {
  /** rooms, floors, sqft, seats, money, acres. */
  kind: string;
  /** How the label reads to a client: 'rooms', 'storeys', 'floor area', 'value'. */
  label: string;
  /** Verbatim, exactly as the publication printed it. Never reformatted. */
  display: string;
  /** The sentence the publication printed it in. */
  sentence: string;
  url: string;
  sourceLabel: string;
  // PRESS for a figure a publication printed, RECORD for one a filing states.
  //
  // ONE SHAPE FOR BOTH, TWO BLOCKS ON THE PAGE. A room count is a room count
  // whoever said it, so the type is shared and the guard below is the same. What
  // is NOT shared is where it prints: the entry keeps a RECORD block and a PRESS
  // block apart, because "the county's staff report states 752 rooms" and "four
  // publications reported 752 rooms" are different weights of evidence and the
  // whole document is organised around a reader being able to tell.
  provenance: 'PRESS' | 'RECORD';
  // THE MATTER THAT STATES IT, as the filing names the case. Set only for a
  // stated figure and used only to disambiguate: where one project has three
  // concurrent applications and two of them state a project type, the two lines
  // read as a contradiction until each says which instrument it came from. See
  // statedOf. Null where the record carries no case reference, in which case the
  // line is left unattributed rather than given a composed one.
  matter?: string | null;
}

// ---- DOES THE QUOTATION SAY ANYTHING THE LINE ABOVE IT DID NOT? --------------
//
// A stated figure prints as "label: value", and under it the line the document
// printed, as evidence. The line earns its row only when it says MORE than the
// label and the value already do, and the test for that was string equality
// after flattening punctuation. It let this through:
//
//   Zone: CR (Commercial Resort). "in a CR (Commercial Resort) Zone"
//
// The quotation is the label and the value with "in a" in front of it, and the
// flattened strings are not equal, so it printed. A reader gets the same six
// words twice and learns that our evidence for the zone is the zone.
//
// THE TEST IS WHETHER ANY CONTENT WORD SURVIVES. Take the words of the line,
// remove the words of the value and the words of the label once each, and see
// whether what remains is anything but connectives. "in a CR (Commercial Resort)
// Zone" leaves "in a" and does not print; "the applicant proposes 752 rooms in a
// 29-storey tower" leaves "applicant proposes storey tower" and does.
//
// ONE IMPLEMENTATION, TWO RENDERERS. This existed twice, once in report-text and
// once inside the referral section builder, which is two definitions of what
// counts as evidence and eventually two answers. Both now call this.
const EVIDENCE_CONNECTIVES = new Set([
  'a', 'an', 'the', 'in', 'on', 'at', 'of', 'to', 'for', 'from', 'within', 'is',
  'are', 'was', 'were', 'and', 'or', 'with', 'by', 'per', 'shall', 'be', 'this',
  'that', 'it', 'as', 'no',
]);

export function evidenceAdds(label: string, display: string, line: string): boolean {
  const words = (x: string): string[] => x.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const rest = words(line);
  // Once each, not globally: a line that genuinely repeats a word keeps the
  // second one, which is the difference between "Zone: CR" quoting itself and a
  // sentence that happens to contain the value twice.
  for (const w of [...words(display), ...words(label)]) {
    const i = rest.indexOf(w);
    if (i > -1) rest.splice(i, 1);
  }
  return rest.some((w) => !EVIDENCE_CONNECTIVES.has(w));
}

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

/**
 * THE CONDITIONS ATTACHED TO ONE MATTER, with the document they were read from.
 *
 * `matter` is the case the conditions belong to as the filing names it -
 * "UC-26-0219" - and never a name we composed. `url` is the document itself, so
 * a reader who wants the full wording of condition 22 can open the staff report
 * rather than take ours.
 *
 * Every condition is a QUOTATION. The text is the line stored by the reader and
 * verified against the document at write time; nothing here is summarised,
 * shortened or rephrased, because a paraphrased condition is a claim about what
 * a county requires and this system does not make those.
 */
export interface EntryConditionSet {
  matter: string;
  url: string;
  sourceLabel: string;
  date: string | null;
  conditions: string[];
  /** Held back by the per-set cap, counted so the block can say so. */
  held: number;
}

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
  // HOW BIG THE THING IS, before the reader has to read anything. Press-sourced
  // by type; see EntryFigure. Empty for the great majority of projects, and empty
  // is the honest state rather than a gap to fill: 12 of 267 live projects carry
  // a press figure that survives attribution.
  scale: EntryFigure[];
  // Figures the per-entry cap held back, so the block can say so rather than
  // present a truncated list as the whole of what we hold.
  scaleHeld: number;
  // WHAT THE FILINGS THEMSELVES STATE, read out of the documents the records
  // already point at. Same shape as `scale` and a different provenance, printed
  // in its own block ABOVE the press one: where a county staff report and a
  // newspaper both give a room count, the reader should meet the staff report
  // first.
  //
  // Each carries the document link and the LINE it was read from, and the gate
  // holds it to the same test as a press figure - a value that does not appear
  // in the line stored beside it does not print.
  stated: EntryFigure[];
  statedHeld: number;
  /**
   * WHERE PUBLICATIONS DISAGREE WITH EACH OTHER, SAID OUT LOUD. Null when they
   * do not, which is almost every project.
   *
   * OCVibe prints $5 billion, $4B, $1 billion, 100 acres and 20 acres, each
   * correctly quoted and attributed, and nothing on the page tells a reader they
   * describe different things or different moments. A reader takes the largest
   * and treats the rest as noise, or takes the first and is wrong.
   *
   * THE STAGE GOT A RECONCILIATION SENTENCE THIS WEEK AND FIGURES DID NOT. This
   * is that sentence for figures: it names the kinds that carry more than one
   * value and counts them, and it CHARACTERISES NOTHING - it does not say which
   * is right, does not average them, and does not guess whether they are a
   * revision or two different scopes. The quotations below it are what a reader
   * uses to decide, which is why each already carries its publisher.
   */
  scaleDisagreement: string | null;
  // WHEN THIS MATTER WAS NEXT DUE TO BE HEARD, and which side of today that is.
  //
  // THE ACTIONABILITY THE BRIEF IS SOLD ON, and it was already captured and
  // never printed. held_to and next_hearing sit in filing_facts on 17 live
  // projects. Neither reached a page: held_to's date is a substring of the
  // board-action sentence it came from, so the print-once rule dropped it as a
  // duplicate. Correct for a fact block, wrong for a reader, because the
  // board-action sentence says what happened on a past date and buries the
  // forward one inside it.
  //
  // AND IT IS NOT A "NEXT STEPS" LINE, because 16 of those 17 dates have
  // ALREADY PASSED. A heading promising what happens next over a date four
  // weeks behind us is worse than printing nothing: it reads as a commitment
  // and points backwards. So the line states the date and which side of today
  // it falls on, and both readings are worth having - a date ahead is a diary
  // entry, and a date behind with nothing captured since is a trail going cold
  // at a known point, which is a reason to pick up the phone.
  schedule: {
    /** ISO, for the comparison. */
    date: string;
    /** Verbatim, as the filing printed it. */
    display: string;
    /** The document's own word for it: 'held to', 'next hearing'. */
    label: string;
    ahead: boolean;
    url: string;
    sourceLabel: string;
  } | null;
  // WHAT THE APPROVAL IS CONDITIONAL ON.
  //
  // Read out of the same staff reports as `stated` and stored under the same
  // column, and then excluded from the figure list by name because a condition
  // is not a figure: it is a sentence, there are dozens of them, and one per
  // figure line would have filled the block. The comment doing the excluding
  // said "the conditions get their own block" and no block existed, so 36
  // conditions on Heart Hotel reached no page at all. This is that block.
  //
  // AN ENTITLEMENT'S CONDITIONS ARE THE PRODUCT, NOT A FOOTNOTE. "Approved" and
  // "approved subject to a Performance Agreement, a decommissioning bond, an FAA
  // determination and no east-facing balconies" are different facts, and the
  // second one is what a person receiving a referral needs.
  //
  // GROUPED BY THE MATTER THAT CARRIES THEM, because a project under three
  // simultaneous applications has three separate condition sets and merging them
  // into one list asserts that a use permit condition binds a tentative map.
  conditions: EntryConditionSet[];
  // Conditions the cap held back, across all sets, so the block can say so.
  conditionsHeld: number;
  // WHO IS INVOLVED, ONCE, BEFORE THE FILINGS. Parties used to be printed inside
  // every record line, so a six-filing project named its applicant six times and
  // the reader had to notice a repetition to learn who was behind it. See
  // lib/people for what a role is allowed to be.
  people: ProjectParty[];
  // Set instead of `people` when the records name nobody. An empty heading and a
  // stated absence are different claims.
  noPeopleNote: string | null;
  /**
   * WHAT THE PARTY BLOCK HELD BACK, PRINTED WHETHER OR NOT IT PRINTED ANYBODY.
   *
   * noPeopleNote only speaks when the block is EMPTY, which covers 16 of the 48
   * projects the presenter gate touches and leaves 32 where a party still prints
   * and a name was still withheld. Standing rule 3 is about the withholding, not
   * about whether anything survived it: a reader must be able to see that we
   * hold a name and chose not to list it as a party to approach.
   *
   * Null when nothing was held back, which is the common case.
   */
  peopleWithheldNote: string | null;
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

  // ---- AN INSTRUMENT AND A STATE MAY NOT NAME THE SAME THING ---------------
  //
  // "public hearing" is in BOTH lists - it is a thing a matter is about and a
  // thing that happens to a matter - so the two lookups can fire on one term and
  // the template joins them into a tautology:
  //
  //     Records show the public hearing taken to public hearing more than once.
  //
  // Measured over the corpus: 6 live projects produce exactly that sentence,
  // among them Bally's Bronx and the Metropolitan Museum of Art. Every one is
  // mechanically derived, unlabelled, and printed as a statement of fact about
  // the record set - which is the whole basis on which these sentences carry no
  // provenance tag.
  //
  // The test is CONTENT WORDS, not string equality: the instrument adds nothing
  // when every word of it is already inside the state phrase. "the development
  // application amended more than once" survives; "the public hearing taken to
  // public hearing more than once" does not, and falls back to the state alone,
  // which is the half that says what happened.
  const instrumentAddsNothing =
    !!instrument &&
    !!state &&
    instrument.split(/\s+/).every((w) => w.length < 4 || state.includes(w));

  if (state && instrument && !instrumentAddsNothing) {
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

// A HEADING INSIDE A SECTION, with its own lines.
//
// The July referral brief puts "Record provenance (our captured filings)" and
// the press-reported programme under one "The Project" heading, and a reader
// uses that split to tell what we can show from what somebody published. A
// section with one flat line list cannot express it, and splitting them into
// two top-level sections would lose the fact that they describe one project.
//
// Subsections carry LINES ONLY. They are a heading over evidence, not a second
// place an entry can live, which keeps the provenance gate's job unchanged: it
// walks lines and it walks entries, and a subsection is lines.
export interface Subsection {
  title: string;
  lines: Line[];
  // Stated rather than omitted, exactly as a section's emptyNote is.
  emptyNote?: string;
}

/**
 * FIGURES THAT CAME OUT OF THE SAME SENTENCE, GATHERED INTO ONE ROW.
 *
 * Heart Hotel's press block printed this, three times, one after another:
 *
 *   [PRESS] rooms: 752 rooms.   "Kulik River Capital purchased the nearly
 *           12-acre property and proposed building 29-story hotel tower with 752
 *           rooms, a six-story parking garage, a casino floor, restaurants,
 *           entertainment, convention space and pool."   news3lv.com
 *   [PRESS] storeys: 29-story.  "Kulik River Capital purchased the nearly ...
 *   [PRESS] site: 12-acre.      "Kulik River Capital purchased the nearly ...
 *
 * One sentence, three figures read out of it, and the reader meets the same
 * forty words three times and has to compare them to notice they are identical.
 * The evidence is one quotation and it is presented as three.
 *
 * THE PROVENANCE RULE IS UNTOUCHED, and this is why the grouping key is the URL
 * AND the sentence rather than the URL alone. Every figure still prints its own
 * label and value, still sits under the sentence it was quoted from, and still
 * carries the link to the article. The gate's requirement - that a value appear
 * in the sentence stored beside it - is a property of each figure and is checked
 * before this runs. Figures from the same article but DIFFERENT sentences stay
 * apart, because there the second quotation is carrying information.
 */
export interface FigureGroup {
  provenance: 'PRESS' | 'RECORD';
  items: { label: string; display: string }[];
  sentence: string;
  url: string;
  sourceLabel: string;
}

export function groupFigures(figures: EntryFigure[]): FigureGroup[] {
  const order: string[] = [];
  const by = new Map<string, FigureGroup>();
  for (const f of figures) {
    // NUL-joined so a url ending in the sentence's first characters cannot
    // collide with a different pair.
    const key = `${f.url} ${f.sentence}`;
    if (!by.has(key)) {
      order.push(key);
      by.set(key, {
        provenance: f.provenance,
        items: [],
        sentence: f.sentence,
        url: f.url,
        sourceLabel: f.sourceLabel,
      });
    }
    by.get(key)!.items.push({ label: f.label, display: f.display });
  }
  return order.map((k) => by.get(k)!);
}

/** The one article or filing a whole figure block came from, where there is one. */
export function sharedFigureSource(
  figures: EntryFigure[]
): { url: string; sourceLabel: string } | null {
  if (figures.length < 2) return null;
  const first = figures[0];
  for (const f of figures) {
    if (f.url !== first.url || f.sourceLabel !== first.sourceLabel) return null;
  }
  return { url: first.url, sourceLabel: first.sourceLabel };
}

/**
 * WHICH LINES IN A BLOCK MAY DROP THEIR CITATION: the ones whose citation is the
 * same as the line immediately above. Returns one flag per line, in order.
 *
 * THE SAME IDIOM THE GEOGRAPHY SUBHEADINGS USE - printed when it CHANGES, never
 * twice in a row - and it is strictly better here than the all-or-nothing test
 * sharedSource makes. Measured on Heart Hotel's sixteen stated fields: fifteen
 * come from the July minutes and one, the tentative map's project type, comes
 * from a different attachment. sharedSource sees two documents and keeps all
 * sixteen citations; this keeps three - the first, the one that changes, and the
 * one that changes back - which is exactly the information a reader needs and
 * none of the repetition.
 *
 * THE CLAIM IS UNCHANGED. Every Line still carries its own source and the
 * provenance gate still checks each one; this decides only whether the renderer
 * prints it again. A block of 51 conditions from one staff report prints one
 * citation, and a block whose source alternates prints it at every change.
 */
export function suppressRepeatedSources(lines: Line[]): boolean[] {
  let previous: string | null = null;
  return lines.map((l) => {
    const key = l.source ? `${l.source} ${l.sourceLabel ?? ''}` : null;
    const repeats = key !== null && key === previous;
    previous = key;
    return repeats;
  });
}

// ---- TWO MORE DERIVED SENTENCES, FOR THE REFERRAL BRIEF ----------------------
//
// Both open with their own fixed phrase, checked by the gate for the same
// reason assembleSentence's opener is checked: a sentence that attributes
// itself to the record set cannot be misread as a market judgement.

const RECONCILE_OPENER = 'Our filing record';
const ABSENCE_OPENER = 'What the record does not say';
const CAPTURE_OPENER = 'Of the';
const STAGE_OPENER = 'The stage above';

export const DERIVED_OPENERS = [
  ASSEMBLED_OPENER,
  RECONCILE_OPENER,
  ABSENCE_OPENER,
  CAPTURE_OPENER,
  STAGE_OPENER,
];

/**
 * WHERE THE FILINGS AND THE PRESS DISAGREE ABOUT WHAT HAPPENED.
 *
 * Null unless projects.stage_press_reported holds a stage, which it does only
 * when the press runs AHEAD of what a captured filing supports. That is 1 live
 * project of 155 today, and the one it is: Heart Hotel / Kulik River reads
 * `filed`, and fifteen of the sixteen press reports under it say Clark County
 * approved the application.
 *
 * A BRIEF THAT PRINTS BOTH AND RECONCILES NEITHER IS THE WORST OF THE THREE
 * OPTIONS. The reader meets a heading saying `filed`, then a page of headlines
 * saying `approved`, and has to decide for themselves which of us is wrong. The
 * answer is neither: the press is reporting a hearing outcome and we have not
 * captured the document recording it, and that is a fact about our capture which
 * the reader is entitled to.
 *
 * DERIVED, NOT ASSESSED, and that is why it opens with a fixed phrase the
 * provenance gate checks. Every clause is read off two stored columns and the
 * record set already printed beside it. It characterises nothing: it does not
 * say the press is right, does not say the matter was approved, and does not
 * guess why the filing is missing.
 *
 * IT NEVER RE-DERIVES THE LADDER. stage_press_reported is computed by
 * provenStage in lib/taxonomy while clustering and stored on the project. This
 * package keeps a 249-line hand mirror of that 1400-line file, and re-deriving
 * the answer here would mean copying the stage vocabulary into it - a copy that
 * goes stale, on the half that decides what a client is told.
 */
export function stageReconcileSentence(
  stage: string | null,
  pressReported: string | null
): Assembled | null {
  const filed = (stage ?? '').trim();
  const press = (pressReported ?? '').trim();
  if (!press || !filed || press === filed) return null;
  return (`${STAGE_OPENER} is what our captured filings support: ${filed}. The press reports listed ` +
    `below describe this matter as ${press}. No filing we hold states that, so the stage says ` +
    `${filed} and the difference is our capture rather than a contradiction between the two.`) as Assembled;
}

/**
 * THE COVER SAYS 23 AND THE PAGE SHOWS 21. ACCOUNT FOR THE OTHER TWO.
 *
 * The basis line counts the records in scope; the brief prints the records that
 * survived deduping. A reader who counts - and the reader of a referral brief
 * is exactly the reader who counts - finds two missing and no explanation, in a
 * document whose whole argument is that its evidence can be checked.
 *
 * Null when the two numbers agree, which is the common case and needs no
 * sentence.
 */
export function captureSentence(captured: number, shown: number, merged: number): Assembled | null {
  if (captured <= shown) return null;
  const gap = captured - shown;
  const other = `the other ${gap === 1 ? 'one' : gap}`;
  const tail =
    merged >= gap
      ? `${other} ${gap === 1 ? 'is' : 'are'} the same filing captured more than once - a bilingual ` +
        `minute, or a document captured page by page - and ${gap === 1 ? 'is' : 'are'} shown once`
      : merged > 0
        ? `${merged} of ${other} ${merged === 1 ? 'is' : 'are'} the same filing captured more than ` +
          `once and ${merged === 1 ? 'is' : 'are'} shown once`
        : `${other} ${gap === 1 ? 'is' : 'are'} not printed`;
  return `${CAPTURE_OPENER} ${captured} records captured for this project, ${shown} are printed above; ${tail}.` as Assembled;
}

/**
 * RECORD AGAINST PRESS, RECONCILED, WHERE BOTH EXIST.
 *
 * The July brief does this in a paragraph and it is what makes the rest
 * credible: the reader is told which half of the document they could go and
 * verify and which half they could not. Null when the project has only one kind
 * of evidence, because there is then nothing to reconcile and a sentence saying
 * so would be padding.
 *
 * It states the SHAPE of the two sets and refuses to characterise their
 * agreement. "The press describes the same project" is a judgement; "these are
 * the filings, those are the reports, and the filings are what we can show" is
 * a fact about our own evidence.
 */
export function reconcileSentence(records: EntryRecord[]): Assembled | null {
  const filings = records.filter((r) => r.provenance === 'RECORD');
  const press = records.filter((r) => r.provenance === 'PRESS');
  if (filings.length === 0 || press.length === 0) return null;
  const span = (rs: EntryRecord[]) => {
    const dated = rs.map((r) => r.date).filter((d): d is string => !!d).sort();
    if (dated.length === 0) return '';
    const [a, b] = [dated[0], dated[dated.length - 1]];
    return a === b ? ` dated ${a}` : ` dated between ${a} and ${b}`;
  };
  return (`${RECONCILE_OPENER} for this project is ${filings.length} captured ` +
    `filing${filings.length === 1 ? '' : 's'}${span(filings)}. The ${press.length} press ` +
    `report${press.length === 1 ? '' : 's'}${span(press)} listed here ${press.length === 1 ? 'is' : 'are'} ` +
    `beyond that record and ${press.length === 1 ? 'is' : 'are'} attributed to ${press.length === 1 ? 'its' : 'their'} ` +
    `publisher. Where the two differ, the filings are what we can show.`) as Assembled;
}

/**
 * THE HONEST NEGATIVE, AT DOCUMENT LEVEL.
 *
 * "No representative named, no action posted, no phone or email in the record.
 * That is what makes the rest credible." Each clause is a check against the
 * data the brief is built from, and a clause is only emitted when the absence
 * is real - a document that lists absences it does not have is as misleading as
 * one that hides them.
 *
 * Null when the records leave nothing to declare, which is a good outcome and
 * not a reason to print a sentence about it.
 */
export function absenceSentence(records: EntryRecord[], people: ProjectParty[]): Assembled | null {
  const clauses: string[] = [];
  if (!people.some((p) => p.roles.some((r) => /represent/i.test(r)))) {
    clauses.push('no filing names a representative');
  }
  if (!people.some((p) => p.contact?.email || p.contact?.phone)) {
    clauses.push('no party carries a phone number or an email address');
  }
  if (!records.some((r) => r.contact)) clauses.push('no filing names a contact');
  const undated = records.filter((r) => !r.date).length;
  if (undated) {
    clauses.push(
      `${undated} of the ${records.length} captured item${records.length === 1 ? '' : 's'} carries no date`
    );
  }
  if (clauses.length === 0) return null;
  const last = clauses.pop()!;
  const list = clauses.length ? `${clauses.join(', ')} and ${last}` : last;
  return `${ABSENCE_OPENER}: ${list}.` as Assembled;
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
  // Headed groups of lines, rendered after `lines`. See Subsection.
  subsections?: Subsection[];
  // SENTENCES DERIVED MECHANICALLY FROM THE RECORD SET, printed unlabelled.
  //
  // The same idea as an entry's `assembled` and the same branded type, so the
  // only values that can appear here are ones a producer in this file built out
  // of records. A referral brief needs two of them that an entry has no place
  // for: the reconciliation of our filings against the press, and the statement
  // of what the records do not say. Both are facts about the set rather than
  // claims about the world, which is why they are neither RECORD nor
  // ASSESSMENT - and why they cannot be typed by hand.
  derived?: Assembled[];
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
  //
  // A PLACE. It held a PROJECT NAME on every referral brief, because the composer
  // passes the project's name as the geography label when one is selected, so the
  // cover read "GEOGRAPHY Heart Hotel / Kulik River" three lines above a sentence
  // saying the matter is in Clark County. Two answers to "where", one of them not
  // a place. See `matter`, which is where the name belongs.
  geography: string;
  /**
   * THE ONE MATTER A REFERRAL BRIEF IS ABOUT. Null on a market report.
   *
   * Split out rather than overloaded onto geography, because the two are read in
   * different places and a reader needs both: the running footer wants to say
   * WHICH BRIEF this page belongs to, and the scope block wants to say where the
   * thing is. Before this they were the same string and only one of them could
   * be right.
   */
  matter: string | null;
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
    // SUBSECTION LINES ARE SECTION LINES. They are rendered in the same
    // document under a smaller heading, so an unlabelled line inside one is the
    // same defect and has to fail the same way. Folded in here rather than
    // checked separately, so a future kind of grouping cannot be added without
    // the gate seeing it.
    const all = [
      ...section.lines,
      ...(section.subsections ?? []).flatMap((sub) => sub.lines),
      ...section.commentary,
    ];
    // A DERIVED SENTENCE MUST ATTRIBUTE ITSELF. Same rule the entry's assembled
    // sentence is held to, in the same place, because a section-level derived
    // sentence is printed unlabelled and would otherwise be the one line in the
    // document with no provenance and no opener saying where it came from.
    for (const d of section.derived ?? []) {
      if (!DERIVED_OPENERS.some((o) => d.startsWith(o))) {
        throw new ProvenanceError(
          `Derived sentence in section "${section.id}" does not attribute itself to the record ` +
            `set: ${JSON.stringify(d).slice(0, 120)}`
        );
      }
    }
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
      // A FIGURE IS A SPECIFIC CLAIM ABOUT A REAL BUILDING, and it is the claim
      // in a client document most likely to be checked by a reader who knows the
      // real number. So it is held to the strictest test in this gate: it must be
      // press, it must carry the link, and IT MUST BE A QUOTATION FROM THE
      // SENTENCE PRINTED BESIDE IT.
      //
      // That last check is the document-boundary half of press-facts'
      // verifyNoInvention, which runs at write time against the article body. The
      // body is not available here and the sentence is, so this asserts the
      // narrower thing that is still checkable: the number we print appears in
      // the text we cite for it. A reformatted display - "752 rooms" rendered
      // from a body that said "752-room" - fails here rather than shipping.
      //
      // TWO BLOCKS, ONE TEST. `stated` carries what a filing says and `scale`
      // what a publication reported. Each is checked for the provenance its own
      // block is for, so a press figure cannot appear among the filings and a
      // filing's figure cannot appear among the press.
      for (const [block, want] of [[entry.stated, 'RECORD'], [entry.scale, 'PRESS']] as const) {
      for (const f of block) {
        if (f.provenance !== want) {
          throw new ProvenanceError(
            `Figure "${f.display}" in entry "${entry.name}" is labelled ${String(f.provenance)} ` +
              `inside the ${want} block. A figure read out of a filing is a record; one lifted ` +
              `out of an article is press; neither may sit in the other's block.`
          );
        }
        if (!f.url) {
          throw new ProvenanceError(
            `Figure "${f.display}" in entry "${entry.name}" has no article to cite.`
          );
        }
        if (!f.sentence.includes(f.display)) {
          throw new ProvenanceError(
            `Figure "${f.display}" in entry "${entry.name}" does not appear in the ${want === 'RECORD' ? 'line' : 'sentence'} cited ` +
              `for it: ${JSON.stringify(f.sentence).slice(0, 160)}`
          );
        }
      }
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
    const lines = [
      ...s.lines,
      ...(s.subsections ?? []).flatMap((sub) => sub.lines),
      ...s.commentary,
    ];
    for (const l of lines) out[l.provenance]++;
    for (const e of s.entries ?? []) {
      if (e.summary) out.RECORD++;
      // A figure is a claim carrying its own link, so it counts the way a line
      // does. Counting it as nothing would let a document whose press content
      // moved into the scale block read as though it had lost that content.
      for (const f of e.stated) out[f.provenance]++;
      for (const f of e.scale) out[f.provenance]++;
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
    lines += (s.derived ?? []).length * 3;
    for (const sub of s.subsections ?? []) {
      lines += 2 + sub.lines.length * 2 + (sub.emptyNote ? 1 : 0);
    }
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
