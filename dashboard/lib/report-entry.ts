// BUILDING AN ENTRY FROM A PROJECT AND ITS FILINGS.
//
// Every value here is lifted from a stored column. Nothing is authored, nothing
// is inferred about the world, and nothing calls a model. The point of the entry
// is that a client can check any part of it against the link printed beside it,
// which is only true if every part came from the record that link points at.
//
// MEASURED AGAINST THE CORPUS BEFORE IT WAS WRITTEN. 356 live records across 171
// non-dormant projects:
//
//   action_sought   81.2% of all records, 89% of filings   -> the sentence
//   title           100%                                    -> the fallback
//   applicant       60.1%                                   -> a named player
//   presented_by    25.6%                                   -> a named player
//   representative   9.0% on records                        -> hence the project
//                                                              level fallback
//   contact_name     9.3%, of which only 2.5% carry a phone or an email
//   published_date  97.2%
//
// Those rates are why this file is shaped the way it is: the sentence comes from
// action_sought and falls back to the title; the representative is read from the
// project when the record does not name one; and the contact line states the
// negative, because for 24 of the 33 records with a named individual the
// negative is the whole truth of it.

import type { Project, TimelineRecord } from './projects';
import {
  assembleSentence,
  isFiling,
  type Entry,
  type EntryPlayer,
  type EntryRecord,
} from './report-model';

type ScopedRecord = TimelineRecord & { project_id?: string | null; market?: string | null };

function host(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function tidy(s: string | null | undefined): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

// THE DATE THE RECORD CARRIES, not the date we happened to see it. A record with
// no captured date prints without one; borrowing first_seen would date a 2023
// filing to the day our scraper found it.
function recordDate(r: ScopedRecord): string | null {
  const d = r.published_date ?? null;
  return d ? d.slice(0, 10) : null;
}

// ---- WHAT THE RECORD SEEKS ---------------------------------------------------

// Agenda titles arrive as a numbered blob: "5. UC-26-0219-KULIK RIVER CAPITAL,
// LLC: USE PERMITS for the following: 1) expand the gaming enterprise district".
// The item number is a position on someone's agenda and means nothing in a
// report, so it goes; the case reference is pulled out and printed as a
// reference instead of being left mid-sentence.
const ITEM_PREFIX = /^(item\s+no\.?\s*)?\d+\.\s*/i;

// A case, bill, ordinance or application reference as the sources write them.
//
// THE SUFFIX IS NOT OPEN-ENDED. It was, and Clark County writes its agenda items
// as "TM-26-500056-KULIK RIVER CAPITAL, LLC:", so the reference swallowed the
// applicant and printed "TM-26-500056-KULIK" as though that were the file
// number. A real suffix is a short code with a digit in it - SDR1, GPA1, SUP1 -
// so that is all the pattern accepts.
const REFERENCE =
  /\b((?:UC|TM|VS|WS|DR|ZC|GPA|SDR|SUP|ADJ|VAC|PA|NZC|WC|ET|MOD)-\d{2}-\d{3,6}(?:-[A-Z]{2,4}\d)?|(?:BILL|ORDINANCE|RESOLUTION)\s+NO\.?\s*[\d-]+|DEVELOPMENT APPLICATION NO\.?\s*[\d-]+|CASE\s+\d{2}-\d{3,4}(?:-[A-Z]{2,4}\d)?|R-\d{1,3}-\d{4})\b/i;

function referenceOf(r: ScopedRecord): string | null {
  const m = REFERENCE.exec(tidy(r.title)) ?? REFERENCE.exec(tidy(r.action_sought));
  if (!m) return null;
  // Printed the way the source writes it, with the filler words normalised.
  return tidy(m[1]).replace(/\s+NO\.?\s*/i, ' No. ');
}

// The longest complete sentence-ish span that fits. action_sought runs to 551
// characters at the extreme (median 110, p90 242), and a record line that runs
// half a page stops being a line a person reads. Cut at a clause boundary so the
// text never ends mid-word, and mark it when it is cut.
const ACTION_CAP = 320;

function trimToClause(text: string, cap: number): string {
  if (text.length <= cap) return text;
  const head = text.slice(0, cap);
  const cut = Math.max(head.lastIndexOf('; '), head.lastIndexOf(', '), head.lastIndexOf('. '));
  return `${(cut > cap * 0.5 ? head.slice(0, cut) : head).replace(/[;,.\s]+$/, '')}...`;
}

// Agenda titles are stored at a fixed width and the long ones arrive already
// cut: "...amending Chapters 18.06 (Multiple-Family Residential Zones), 1". A
// line ending like that reads as a transcription error rather than as the source
// running on, so a title at the storage width is marked as continuing.
const TITLE_STORAGE_WIDTH = 190;

function actionText(r: ScopedRecord, reference: string | null): string {
  // action_sought is what the scraper derived as the thing being sought, and it
  // is already plain language. The title is a fallback for the 11% of records
  // without one - press headlines, mostly, where the headline IS the statement.
  const rawTitle = tidy(r.title);
  const fromTitle = !tidy(r.action_sought);
  let text = tidy(r.action_sought) || rawTitle.replace(ITEM_PREFIX, '');
  if (fromTitle && rawTitle.length >= TITLE_STORAGE_WIDTH && !/[.!?]$/.test(text)) {
    text = `${text.replace(/[,;\s]+$/, '')}...`;
  }
  // The reference is printed as a reference; leaving it embedded reads as
  // "UC-26-0219-KULIK RIVER CAPITAL, LLC: USE PERMITS to..." mid-sentence. What
  // follows it on a Clark County item is the applicant, which is printed under
  // Players, so that goes with it.
  if (reference) {
    const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`^${escaped}[^:]{0,80}:\\s*|^${escaped}[-:\\s]*`, 'i'), '');
  }
  text = trimToClause(tidy(text), ACTION_CAP);
  // Sources shout. A client document does not.
  if (text === text.toUpperCase() && /[A-Z]{4}/.test(text)) {
    text = text.charAt(0) + text.slice(1).toLowerCase();
  }
  // And sources start mid-sentence, because the phrase was lifted out of a
  // longer one: "levying Special Taxes within Community Facilities District No.
  // 06-2". As the first words after a date, that reads as a typo.
  text = text.charAt(0).toUpperCase() + text.slice(1);
  // A TRAILING ELLIPSIS IS THE SOURCE SPEAKING, NOT NOISE. Press headlines
  // arrive already cut - "...sells to developer who ..." - and stripping the
  // dots turned a visibly truncated headline into a sentence that appeared to
  // stop mid-thought for no reason. One period is punctuation and goes; three
  // are a statement that there was more, and stay.
  return /\.\.\.$/.test(text) ? text : text.replace(/[.\s]+$/, '');
}

// ---- FIGURES -----------------------------------------------------------------
//
// "figures where the record carries them". Most of the time they are already
// inside the action text and repeating them would be noise, so only figures the
// printed sentence does NOT contain are appended.
const FIGURE_PATTERNS = [
  /\b\d[\d,]*(?:\.\d+)?\s*acres?\b/gi,
  /\b\d[\d,]*\s*(?:residential\s+)?units?\b/gi,
  /\b\d[\d,]*\s*rooms?\b/gi,
  /\b\d[\d,]*\s*square\s*(?:feet|foot)\b/gi,
  // The trailing [\d] stops the match ending on the comma in "$10,030,000," and
  // printing the punctuation as though it were part of the figure.
  /\$\s?\d[\d,]*\d(?:\.\d+)?(?:\s?(?:million|billion))?|\$\s?\d/gi,
  /\b\d{1,3}[- ]stor(?:y|ey)\b/gi,
];

function figuresOf(r: ScopedRecord, printed: string): string[] {
  const source = `${tidy(r.title)} ${tidy(r.action_sought)}`;
  const low = printed.toLowerCase();
  const out: string[] = [];
  for (const p of FIGURE_PATTERNS) {
    for (const m of source.match(p) ?? []) {
      const f = tidy(m);
      if (!low.includes(f.toLowerCase()) && !out.some((x) => x.toLowerCase() === f.toLowerCase())) {
        out.push(f);
      }
    }
  }
  return out.slice(0, 4);
}

// ---- PLAYERS -----------------------------------------------------------------

// Sources store a representative as a name plus a firm plus a street address:
// "NANCY AMUNDSEN, BROWN, BROWN, & PREMSRIRUT, 520 S. 4TH STREET, LAS VEGAS, NV
// 89101". The address is not a player, it is a mailing detail, and printing it
// in a report of parties makes the line unreadable. Everything from the first
// street-address-looking component onward is dropped.
const ADDRESS_START = /,\s*(?=\d+\s+[NSEW]?\.?\s*\w|(?:suite|ste\.?|floor|fl\.?|p\.?o\.?\s*box)\b)/i;

function properCase(name: string): string {
  // Sources write parties in capitals. Left alone, every entry shouts a company
  // name at the reader. Acronyms and initialisms are left as they are.
  return name
    .split(' ')
    .map((w) =>
      w.length <= 3 && w === w.toUpperCase() && /^[A-Z.&]+$/.test(w)
        ? w
        : /^[A-Z][a-z]/.test(w)
          ? w
          : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    )
    .join(' ');
}

function cleanParty(raw: string | null | undefined): string | null {
  let s = tidy(raw);
  if (!s) return null;
  s = s.split(ADDRESS_START)[0];
  s = s.replace(/[,;\s]+$/, '');
  if (!s || s.length < 2) return null;
  return s === s.toUpperCase() ? properCase(s) : s;
}

function playersOf(r: ScopedRecord, project: Project, isRecord: boolean): EntryPlayer[] {
  const out: EntryPlayer[] = [];
  const push = (raw: string | null | undefined, role: string) => {
    const name = cleanParty(raw);
    if (name && !out.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      out.push({ name, role });
    }
  };
  push(r.applicant, 'applicant');
  push(r.representative, 'representative');
  push(r.presented_by, 'presented by');
  // THE PROJECT-LEVEL FALLBACK, AND THE ONE PLACE IT MUST NOT REACH.
  //
  // Only 9% of records name a representative, while the project carries one
  // derived from its own filings, so a filing that names none still has a party
  // worth printing - labelled as coming from the project's filings rather than
  // from this one, because the reader is entitled to know which document to
  // open.
  //
  // IT IS WITHHELD FROM PRESS RECORDS. Applied to everything, it printed
  // "Players: Nancy Amundsen, Brown, Brown, & Premsrirut (representative on the
  // project's filings)" underneath a Review-Journal headline about a land sale.
  // The land-use representative is a party to the entitlement, not to the
  // newspaper story, and attaching her to it invents a relationship no document
  // asserts. A press record shows the parties the press named, or none.
  if (isRecord && !r.representative && project.primary_representative) {
    push(project.primary_representative, "representative on the project's filings");
  }
  return out;
}

// ---- CONTACT -----------------------------------------------------------------

function contactOf(r: ScopedRecord): string | null {
  const name = cleanParty(r.contact_name);
  if (!name) return null;
  const ways = [tidy(r.contact_email), tidy(r.contact_phone)].filter(Boolean);
  return ways.length
    ? `Contact: ${name}. ${ways.join(', ')}.`
    : // THE HONEST NEGATIVE. Stated, not omitted. Silence here reads as "we did
      // not bother to print it"; the sentence says the record does not have it.
      `Contact: ${name}. No phone or email in the record.`;
}

// ---- THE ENTRY ---------------------------------------------------------------

// ---- ONE FILING, CAPTURED MORE THAN ONCE -------------------------------------
//
// Records that share a date and say substantially the same thing are one filing
// seen twice. Three shapes of this are in the corpus and all three were visible
// in the first entries this builder produced:
//
//   - Anaheim minutes the same council item in English and in Spanish, so
//     Disneyland Resort printed its 2026-06-22 development-agreement review
//     twice, once in each language.
//   - The CFTOD comprehensive plan is captured page by page, so that entry
//     opened with six near-identical lines differing only in "(p.36)".
//   - The same agenda item appears on two portals under different URLs.
//
// AN EXACT-STRING KEY DOES NOT CATCH ANY OF THEM, which is what the first
// version used. Translations and page splits differ in every field except
// meaning, so the test is a token overlap on the same date: two records with
// most of their content words in common, filed the same day, are the same
// matter. Distinct items heard together stay distinct - Clark County's
// use permit, vacation and tentative map were all heard on 2026-05-26 and
// share almost no vocabulary.
const OVERLAP = 0.6;

// AND AT LEAST THIS MANY WORDS IN COMMON, which the first version did not
// require and which cost it two real filings when this was measured:
//
//   Clark County 2026-07-21: "HOLDOVER TENTATIVE MAP" scored 0.84 against
//   "HOLDOVER USE PERMITS to expand the gaming enterprise district..." - two
//   different files, TM-26-500056 and UC-26-0219, folded into one because the
//   shorter text has three words in it and one of them matched.
//
//   Happy Miner 2026-07-06: a use permit and a plan amendment, same reasoning.
//
// A ratio against the smaller set is the right test for a page fragment against
// the document it came from, and the wrong test when the smaller set is three
// words long. The floor is what separates those two cases.
const MIN_SHARED = 4;

// Words that carry no signal about WHICH matter this is; left in, they push two
// unrelated procedural items over the threshold.
const STOP = new Set([
  'the', 'and', 'for', 'with', 'a', 'an', 'of', 'to', 'in', 'on', 'no', 'nos',
  'approve', 'approval', 'authorize', 'determine', 'consider', 'adopt', 'city',
  'district', 'agreement', 'project', 'review', 'period', 'terms', 'conditions',
]);

function contentWords(r: ScopedRecord): Set<string> {
  return new Set(
    tidy(`${r.action_sought ?? ''} ${r.title ?? ''}`)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
  );
}

function sharedCount(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared;
}

function normalisedText(r: ScopedRecord): string {
  return tidy(r.action_sought ?? r.title).toLowerCase().replace(/[^a-z0-9]/g, '');
}

interface Kept {
  r: ScopedRecord;
  date: string;
  words: Set<string>;
  text: string;
  filing: boolean;
  reference: string | null;
}

// TWO WAYS TO BE THE SAME RECORD, AND PRESS ONLY GETS THE STRICT ONE.
//
// Word overlap is right for a filing captured twice - a bilingual minute, a plan
// captured page by page, an item on two portals - because the two captures say
// the same thing in different words.
//
// It is WRONG FOR PRESS. "Sphere Abu Dhabi set to launch on Yas Island by 2029"
// and "Sphere Abu Dhabi set to supercharge Yas Island hotel..." score 0.75 and
// are two outlets covering one announcement. They are two press reports, the
// entry says so, and folding them together would drop a source the client might
// want to read. So a press record is only a duplicate of another when the text
// is identical - the same wire copy captured twice.
function isDuplicate(a: Kept, b: Omit<Kept, 'r'>): boolean {
  if (a.date !== b.date) return false;
  // TWO CASE NUMBERS ARE TWO MATTERS, whatever the words say. This is the
  // government's own identity for a filing and it outranks every similarity
  // test below it.
  //
  // It has to, because the similarity test is at its weakest exactly where
  // these cases arise: a use permit and a tentative map on the same parcel,
  // heard the same morning, share the applicant, the address, the acreage, the
  // zone and the overlay - almost every content word - and differ only in the
  // instrument. Measured over the corpus, that cost two projects a filing:
  // Southern Highlands Golf Club lost TM-26-500090 to UC-26-0350, and G D
  // Carden lost UC-25-0072 to ET-26-400054.
  if (a.reference && b.reference && a.reference.toUpperCase() !== b.reference.toUpperCase()) {
    return false;
  }
  if (a.text && a.text === b.text) return true;
  if (!a.filing || !b.filing) return false;
  const shared = sharedCount(a.words, b.words);
  if (shared < MIN_SHARED) return false;
  // Against the SMALLER set, so a short duplicate of a long record still reads
  // as a duplicate: "(p.36)" fragments are shorter than the item they repeat.
  const denom = Math.min(a.words.size, b.words.size);
  return denom > 0 && shared / denom >= OVERLAP;
}

interface Deduped {
  records: ScopedRecord[];
  /** How many were folded away, so the section can say so rather than lose them. */
  merged: number;
}

function dedupe(records: ScopedRecord[]): Deduped {
  const kept: Kept[] = [];
  let merged = 0;
  for (const r of records) {
    const candidate = {
      date: recordDate(r) ?? '',
      words: contentWords(r),
      text: normalisedText(r),
      filing: isFiling(r.source, r.source_type, r.stream),
      reference: referenceOf(r),
    };
    const dup = kept.find((k) => isDuplicate(k, candidate));
    if (dup) {
      merged++;
      // Keep whichever of the two says more; the English minute is longer than
      // the Spanish one, and the full item is longer than a page fragment.
      if (candidate.words.size > dup.words.size) {
        dup.r = r;
        dup.words = candidate.words;
        dup.text = candidate.text;
        dup.reference = candidate.reference ?? dup.reference;
      }
      continue;
    }
    kept.push({ r, ...candidate });
  }
  return { records: kept.map((k) => k.r), merged };
}

// How many filings one entry prints. An entry is a description of a project, not
// its archive; the appendix is where the whole set lives. The remainder is
// counted in the entry itself rather than dropped silently.
export const ENTRY_RECORD_CAP = 8;

export interface BuiltEntry {
  entry: Entry;
  /** Records held back by the per-entry cap, so the section can say so. */
  held: number;
  /** Records folded into another as the same filing captured twice. */
  merged: number;
}

/**
 * An entry, or null when the project has nothing to cite in this period.
 *
 * NULL IS THE POINT. The by-market section used to print a project with no
 * filing in the period as an [ASSESSMENT] line - "Symphony Park Hotel (approved),
 * no filing in this period" - which labelled our own register as Philip's
 * opinion and told the client nothing. A project with nothing to cite is left
 * out of the section and counted in its note.
 */
export function buildEntry(
  project: Project,
  records: ScopedRecord[],
  opts: { cap?: number } = {}
): BuiltEntry | null {
  const cap = opts.cap ?? ENTRY_RECORD_CAP;
  const { records: usable, merged } = dedupe(records.filter((r) => !!r.url));
  if (usable.length === 0) return null;

  // OLDEST FIRST, AND THE CAP KEEPS THE NEWEST. An entry reads as the history of
  // a matter, and a history runs forwards - but when there are more filings than
  // the entry prints, the ones worth printing are the recent ones. So the set is
  // cut from the end and then read forwards. Taking the first N in date order
  // would have shown a client the oldest eight filings on their most active
  // project and called it the state of play.
  const ordered = [...usable].sort((a, b) => (recordDate(a) ?? '').localeCompare(recordDate(b) ?? ''));
  const shown = ordered.slice(Math.max(0, ordered.length - cap));

  const entryRecords: EntryRecord[] = shown.map((r) => {
    const reference = referenceOf(r);
    const text = actionText(r, reference);
    const isRecord = isFiling(r.source, r.source_type, r.stream);
    return {
      date: recordDate(r),
      reference,
      text,
      figures: figuresOf(r, text),
      players: playersOf(r, project, isRecord),
      contact: contactOf(r),
      provenance: isRecord ? 'RECORD' : 'PRESS',
      url: r.url,
      sourceLabel: r.source ?? (host(r.url) || 'source'),
    };
  });

  return {
    entry: {
      id: project.id,
      // The stored name, with its first letter raised. Some projects are named
      // from the instrument that created them and inherit its lower case -
      // "issuance of general obligation (limited tax) transportation improvement
      // bonds" - which reads as a broken heading. Only the case is touched:
      // renaming a project is the clusterer's job and doing it here would give
      // the register and the report two different names for one thing.
      name: project.name.charAt(0).toUpperCase() + project.name.slice(1),
      meta: [project.market ?? project.region_state, project.stage].filter(Boolean).join(' | '),
      // ONLY A DERIVED SUMMARY, AND ONLY WITH ITS LINK. A generated summary is a
      // model's reading of several filings and no filing contains the sentence,
      // so it has nothing to cite and does not go in a client document. It is
      // not replaced with anything: the assembled sentence below stands alone,
      // and an entry that says less is better than one that says more than it
      // can show.
      summary:
        project.summary_source === 'derived' && project.summary && project.summary_url
          ? { text: tidy(project.summary), url: project.summary_url }
          : null,
      assembled: assembleSentence(entryRecords),
      records: entryRecords,
    },
    held: ordered.length - shown.length,
    merged,
  };
}
