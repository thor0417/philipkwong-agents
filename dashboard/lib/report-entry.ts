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

import { cleanRecordText } from '../../agents/scraper/project-summary';
// Read across the package split for the same reason project-summary is, and it
// is import-free for the same reason: the rules that decide whether a figure is
// about THIS project must be one implementation. A mirrored copy in the dashboard
// would drift, and the half that drifted would be the half printing numbers to
// clients. See next.config.js.
import {
  attributionTerms, factLabel, isAttributed, type PressFact,
} from '../../agents/scraper/press-facts';
import type { Project, TimelineRecord } from './projects';
import {
  applicantIsPublicAgency,
  buildParties,
  distinctRecordParties,
  noPartiesNote,
  presenterIsGovernmentMover,
  withheldMovers,
  withPartyHistory,
  type PartyHistory,
  type ProjectParty,
} from './people';
import {
  assembleSentence,
  citationLabel,
  isFiling,
  type Entry,
  type EntryConditionSet,
  type EntryFigure,
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

/**
 * THE DATE A CITATION ENDS WITH, for disambiguating two facts of one kind.
 *
 * citationLabel builds "New York City Planning Application, 15 October 2023" and
 * "Clark County Planning/Zoning Minutes, 21 July 2026". The date is what
 * separates two documents about the same matter, and it is short enough to sit
 * in a label where the whole citation is not.
 *
 * Null when the citation carries no date, which is the honest answer: a label
 * with no key is ambiguous, and a label with a key that does not identify
 * anything is worse.
 */
function documentDateOf(sourceLabel: string | null | undefined): string | null {
  const m = /,\s*(\d{1,2}\s+[A-Z][a-z]+\s+\d{4})\s*$/.exec(String(sourceLabel ?? '').trim());
  return m ? m[1] : null;
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

// The item number, the case prefix and the block capitals are all stripped by
// the scraper's cleanRecordText, which is imported rather than reimplemented -
// see next.config.js for why that import is allowed to cross the package split.
// The case reference is pulled out separately BEFORE cleaning, because the
// report prints it as a reference rather than discarding it.

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

// A ULURP action-code list and nothing else: two-to-four capitals, separated by
// semicolons or commas, repeated. Anchored at both ends, so a real sentence that
// happens to contain codes is untouched - only a value that is NOTHING but codes
// is refused. See actionText.
const ACTION_CODE_LIST = /^\s*[A-Z]{2,4}(?:\s*[;,/]\s*[A-Z]{2,4})+[\s.;]*$/;

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

// ---- THE NAMES DESHOUTING FLATTENS ------------------------------------------
//
// Deshouting is right for a clerk's block capitals and wrong for a brand that is
// genuinely capitalised. "OCVIBE" came out as "Ocvibe" and "CFTOD" as "Cftod",
// in the entry for a project the register calls OCVibe and CFTOD.
//
// The register's own name for the thing settles it. A token that the source
// shouted, and that the project name also contains, is restored to the casing
// the project name uses.
//
// ONLY WHERE THE NAME DISAGREES WITH TITLE CASE. "Heart Hotel" contains "hotel",
// and a source that writes "RESORT HOTEL" must not come back as "resort Hotel" -
// so a token whose project-name form is just its capitalised form is left to the
// deshouter. OCVibe and CFTOD are restored because neither is Title Case, which
// is exactly what makes them names rather than words.
function brandCasing(projectName: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const token of projectName.split(/[^A-Za-z0-9']+/)) {
    if (token.length < 3) continue;
    const titled = token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    if (token !== titled) out.set(token.toLowerCase(), token);
  }
  return out;
}

function restoreBrands(text: string, source: string, brands: Map<string, string>): string {
  if (brands.size === 0) return text;
  return text.replace(/\b[A-Za-z][A-Za-z0-9']{2,}\b/g, (word) => {
    // A POSSESSIVE IS STILL THE BRAND. The token pattern takes the apostrophe
    // with it, so "OCVIBE's" arrived here as one word, missed the lookup keyed
    // on "ocvibe", and stayed deshouted: a headline reading "Ocvibe's $5B
    // Vision" under a line whose own prefix says "OCVibe:".
    const possessive = /['’]s$/.exec(word);
    const bare = possessive ? word.slice(0, -2) : word;
    const canonical = brands.get(bare.toLowerCase());
    if (!canonical || bare === canonical) return word;
    if (possessive) {
      const shouted = new RegExp(`\\b${bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      const hit = shouted.exec(source);
      return hit && hit[0] === hit[0].toUpperCase() ? `${canonical}${possessive[0]}` : word;
    }
    // Only where the SOURCE shouted it. A source that already wrote "OCVibe"
    // needs no help, and a lower-case word in the source was never a brand.
    const shouted = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const m = shouted.exec(source);
    return m && m[0] === m[0].toUpperCase() ? canonical : word;
  });
}

function actionText(
  r: ScopedRecord,
  reference: string | null,
  brands: Map<string, string>
): string {
  // action_sought is what the scraper derived as the thing being sought, and it
  // is already plain language. The title is a fallback for the 11% of records
  // without one - press headlines, mostly, where the headline IS the statement.
  const rawTitle = tidy(r.title);
  // ---- AN ACTION-CODE LIST IS NOT A SENTENCE -------------------------------
  //
  // ZAP stores the ULURP actions sought as their codes, and for 18 records in
  // the corpus - every one of them nyc-zap - that is the WHOLE of action_sought:
  //
  //     "ZC; ZC; ZC; LD; LD; LD"    "ZM; ZR; ZS; ZS; LD; ZC; ZA; ZA; ZA; LD"
  //
  // A record line reading that tells a client nothing at all, and it wins here
  // only because action_sought beats the title 81% of the time. For these 18 the
  // preference is backwards: every one of them ALREADY carries a real title -
  // "70 Hudson Yards (ERY, DIB & Office Chair Certs)", "Willets Point Phase II",
  // "Westshore Rezoning LSGD".
  //
  // SO THE TITLE IS USED, AND NOTHING IS EXPANDED. DCP publishes what the codes
  // mean and this deliberately does not reach for it: an expansion invented here
  // would be a claim about what a city agency was asked to do. If the mapping is
  // ever wanted it comes from the published source, as its own pass, with the
  // codes above measured against it.
  const codeListOnly = ACTION_CODE_LIST.test(tidy(r.action_sought));
  const fromTitle = !tidy(r.action_sought) || codeListOnly;
  const raw = (codeListOnly ? '' : tidy(r.action_sought)) || rawTitle;

  // THE SCRAPER'S CLEANING, NOT A SECOND ONE. This used to be a local item
  // prefix regex plus an all-or-nothing deshout, and both were too weak: the
  // deshout only fired when the WHOLE line was capitals, so
  // "ORDINANCE No. 6609: (ADOPTION) AN ORDINANCE OF THE CITY OF ANAHEIM" kept
  // its shouting because the first two words were mixed case, and the item
  // prefix missed "16. DEVELOPMENT APPLICATION NO. 2026-00022 (DEV2026-00022)"
  // because the case number sat between the number and the text.
  let text = cleanRecordText(raw);
  if (fromTitle && rawTitle.length >= TITLE_STORAGE_WIDTH && !/[.!?]$/.test(text)) {
    text = `${text.replace(/[,;\s]+$/, '')}...`;
  }
  // The reference is printed as a reference. cleanRecordText removes it from
  // the front of the sentence; this handles the shapes it leaves, where the
  // reference is followed by the applicant before the colon.
  if (reference) {
    const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`^${escaped}[^:]{0,80}:\\s*|^${escaped}[-:\\s]*`, 'i'), '');
  }
  text = trimToClause(tidy(text), ACTION_CAP);
  // Sources start mid-sentence, because the phrase was lifted out of a longer
  // one: "levying Special Taxes within Community Facilities District No. 06-2".
  // As the first words after a date, that reads as a typo.
  text = text.charAt(0).toUpperCase() + text.slice(1);
  text = restoreBrands(text, raw, brands);
  return wholeHead(text);
}

// ---- A CUT SENTENCE PRINTS ITS HEAD, AND SAYS IT WAS CUT ---------------------
//
// A TRAILING ELLIPSIS IS THE SOURCE SPEAKING, NOT NOISE, and that half was right:
// press headlines arrive already cut, and stripping the dots turned a visibly
// truncated headline into one that appeared to stop mid-thought for no reason.
// What was missing is that the dots are not the only way a source cuts, and that
// the words left dangling in front of them are not worth printing.
//
// Three shapes reached a client brief, none of which a trailing-ellipsis test
// could see:
//
//   "Eli Applebaum Acquires 12-Acre Development Site On"   no ellipsis at all
//   "Heart-shaped resort approved by Clark County Zoning ... - KTNV"
//                                                          ellipsis MID-string
//   "...approve Cooperative Agreement No. 12-0876 ... with Caltrans for de"
//
// MEASURED OVER THE WHOLE CORPUS rather than over the examples: 30 of 381
// records on live projects carry a title that is not whole - 12 by a trailing
// ellipsis, which is the only test there was, 1 by an ellipsis mid-string, 5
// ending on a separator and 12 ending on a function word. See
// diagnostics/title-wholeness-measure, and note that the second population is
// not press at all: they are agenda lines cut by our own storage width.
//
// THE TESTS READ NO NAMES AND NO MEANING. An ellipsis anywhere is the search
// engine's own truncation marker; a trailing separator is a cut through
// punctuation; a trailing function word is a cut through a sentence. The word
// list is closed and written out below, and no English headline ends on one of
// them.
const TRAILING_SEPARATOR = /\s*[,\-–—|:;]+\.?\s*$/;
const TRAILING_FUNCTION_WORD =
  /\s+(on|in|at|for|to|of|with|by|from|as|and|or|the|a|an|its|his|her|their|that|which|into|over|after|before|near|amid|about)\.?\s*$/i;

function wholeHead(raw: string): string {
  let text = raw;
  let cut = false;
  // Everything after the first ellipsis is a suffix the source added to a
  // fragment - a publisher tag, most often - and belongs to no sentence. The
  // pattern requires a non-ellipsis character in front, so a snippet that OPENS
  // mid-sentence ("...sells to developer who ...") is cut at its second ellipsis
  // and not at its first.
  const m = /[^.…]\s*(\.\.\.|…)/.exec(text);
  if (m) {
    text = text.slice(0, m.index + 1);
    cut = true;
  }
  for (const re of [TRAILING_SEPARATOR, TRAILING_FUNCTION_WORD]) {
    const trimmed = text.replace(re, '');
    if (trimmed !== text && trimmed.trim().length > 0) {
      text = trimmed;
      cut = true;
    }
  }
  text = text.replace(/[.\s]+$/, '');
  // The ellipsis is kept where the source cut and dropped where it did not, so a
  // reader can tell a whole headline from a head of one.
  return cut && text ? `${text}...` : text;
}

/**
 * ONE RECORD, AS A SENTENCE, FOR THE SECTIONS THAT PRINT LINES.
 *
 * THE ENTRIES WERE CLEANED AND THE LINES WERE NOT. Headline finds, Upcoming
 * hearings, the watch list and both appendices all printed `r.title` raw, so a
 * document whose category sections read
 *
 *   Mirage Propco casino - Design review for a proposed theater expansion in
 *   conjunction with a previously approved resort hotel
 *
 * carried, three pages earlier, under Headline finds:
 *
 *   DR-26-0313-MIRAGE PROPCO, LLC:\nDESIGN REVIEW for a proposed theater
 *   expansion ... TS/hw/cv  (For possible action)
 *
 * complete with the clerk's initials, the routing code, the embedded newline
 * and the block capitals. Two renderings of one record in one document, and the
 * uglier one is the section a reader reaches first.
 *
 * THE PROJECT NAME IS PASSED WHERE THE CALLER HAS ONE, for the same reason the
 * entries pass it: deshouting is right for a clerk's block capitals and wrong
 * for a brand that is genuinely capitalised, and the register's own name for the
 * thing is what settles which is which. Without it, "OCVIBE's $5B Vision" came
 * back as "Ocvibe's" on a line whose own prefix reads "OCVibe:".
 */
export function recordSentence(r: ScopedRecord, projectName?: string | null): string {
  const reference = referenceOf(r);
  const text = actionText(r, reference, brandCasing(String(projectName ?? '')));
  return reference ? `${reference}: ${text}` : text;
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

// ---- SCALE, LIFTED TO THE TOP OF THE ENTRY -----------------------------------
//
// figuresOf() above is the RECORD half and is unchanged: it reads the record's
// own title and action_sought, prints on the record's own line, and cannot see an
// article. What follows is the PRESS half, and it is a property of the PROJECT
// rather than of a filing - the same argument the people block is built on. A
// reader looking for how big the thing is should find it once, at the top, not by
// reading six filings for a number that is in none of them.
//
// THE THREE RULES THIS BLOCK IS BUILT ON.
//
// 1. PRESS RECORDS ONLY. isFiling decides, the same call the record lines use, so
//    a figure can never be sourced from a filing and printed as press or the
//    reverse.
// 2. ATTRIBUTED ONLY. Reading 11 articles about Heart Hotel produced 73 figures
//    of which 66 describe other Las Vegas developments; every one was correctly
//    read out of real text, which is what makes it dangerous. A figure reaches
//    the entry only when its own sentence names the project or a party to it.
// 3. A FIRM IS NOT A FIGURE. press-facts also extracts corporate names, and they
//    are deliberately dropped here. A name printed under a project entry is a
//    claim that the company is a party to it, and press-facts cannot say what
//    party - it says so itself, and standing rule 1 forbids guessing. The people
//    block is where a party goes, with the role a record gives it. So the press
//    firms stay stored and unprinted, which is a stated gap rather than a silent
//    one.
const FIGURE_KINDS = ['rooms', 'floors', 'seats', 'sqft', 'acres', 'money'] as const;

// READ IN THE ORDER A PERSON ASKS THE QUESTIONS. How many rooms, how tall, how
// many seats, how much floor, how much land, how much money. Not the order the
// extractor happens to run its patterns in.
const FIGURE_ORDER = new Map(FIGURE_KINDS.map((k, i) => [k as string, i]));

// AN ENTRY IS A DESCRIPTION, NOT AN INVENTORY. Ten is above everything the corpus
// holds today - the richest project carries eight - so it does not bite now, and
// when it does the remainder is COUNTED in the block rather than dropped
// (standing rule 3).
export const ENTRY_FIGURE_CAP = 10;

// THE EVIDENCE, NOT A LABEL FOR IT.
//
// "value: $70 million" is a claim about what the money WAS, and press-facts
// cannot make it: the $70 million on Heart Hotel is the price of the parcel, not
// the cost of the resort, and a label calling it the value states something no
// article says. Standing rule 1 covers exactly this.
//
// So the sentence the publication printed goes on the page beneath the figure,
// and it is what carries the meaning. The label is only there to let a reader
// scan the block.
//
// TRIMMED AROUND THE FIGURE, NEVER AWAY FROM IT. Bodies extracted from a page
// carry navigation furniture, so a "sentence" can run 400 characters with the
// number in the middle. The window is centred on the display string, which keeps
// the printed figure inside its own printed evidence - and the provenance gate
// asserts that, so a window that cut the number out would fail generation rather
// than print a quotation that does not contain the thing it is quoted for.
const EVIDENCE_CAP = 240;

function evidenceWindow(sentence: string, display: string): string {
  const s = tidy(sentence);
  if (s.length <= EVIDENCE_CAP) return s;
  const at = s.indexOf(display);
  if (at === -1) return s.slice(0, EVIDENCE_CAP);
  // Room on both sides, then pulled back to word boundaries so the quotation
  // does not begin or end mid-word.
  const room = Math.floor((EVIDENCE_CAP - display.length) / 2);
  let start = Math.max(0, at - room);
  let end = Math.min(s.length, at + display.length + room);
  if (start > 0) {
    const space = s.indexOf(' ', start);
    if (space > -1 && space < at) start = space + 1;
  }
  if (end < s.length) {
    const space = s.lastIndexOf(' ', end);
    if (space > at + display.length) end = space;
  }
  return `${start > 0 ? '...' : ''}${s.slice(start, end)}${end < s.length ? '...' : ''}`;
}

function scaleOf(
  records: ScopedRecord[],
  project: Project
): { figures: EntryFigure[]; held: number } {
  const terms = attributionTerms(project.name, project.primary_applicant);
  const out: EntryFigure[] = [];
  const seen = new Set<string>();
  // CITED TO THE FIRST PUBLICATION THAT REPORTED IT. Fifteen outlets carried the
  // Heart Hotel approval and the deduper keeps whichever it met first, which
  // without this is whatever order the query returned - so "29-story" was cited
  // to a news3lv TOPIC INDEX rather than to the article that broke it, and
  // "$70 million" to a July approval write-up rather than to the April sale
  // report that stated the price. Oldest first, undated last, because a record
  // with no date cannot be shown to be the first anything.
  const ordered = [...records].sort((a, b) => {
    const da = recordDate(a);
    const db = recordDate(b);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da.localeCompare(db);
  });
  for (const r of ordered) {
    if (isFiling(r.source, r.source_type, r.stream)) continue;
    if (!r.url) continue;
    for (const f of (r.press_facts ?? []) as PressFact[]) {
      if (!FIGURE_ORDER.has(f.kind)) continue;
      if (!isAttributed(f, terms)) continue;
      // A FIGURE WE CANNOT QUOTE IS A FIGURE WE DO NOT PRINT. The sentence is the
      // evidence; a stored row whose sentence does not contain its own display is
      // an extraction defect, and it existed - press-facts capped the sentence
      // from the front and cut the number off the end of it. That is fixed at the
      // source and re-captured, and this stays as the reader-facing half of the
      // guard: one bad row in the table must not be able to take out every
      // document, and it must not be able to print an unevidenced number either.
      if (!f.sentence.includes(f.display)) continue;
      // ONE FIGURE, NOT TWO RENDERINGS OF IT. Three outlets print the same room
      // count as "752 rooms", "752-room" and "752 keys"; the normalised value is
      // what makes them one fact. Where a kind normalises to nothing the display
      // string is the key, which is the conservative direction: it splits rather
      // than merges.
      const key = `${f.kind}:${f.value ?? f.display.toLowerCase()}`;
      if (seen.has(key)) continue;
      // ONE FACT, NOT SEVERAL READINGS OF IT - the same prefix rule the press
      // block uses, and needed here for the same reason. Heart Hotel holds five
      // agenda sheets and the board action wraps differently in each, so the
      // entry printed "COUNTY COMMISSION ACTION: June 17, 2026 - HELD - To
      // 07/22/26 - per the" and "COUNTY COMMISSION ACTION: June 17, 2026 -" as
      // two facts. Where one display is a prefix of another the longer one is
      // the same fact read more completely.
      const superseded = out.findIndex(
        (o) => o.kind === f.kind && f.display.startsWith(o.display)
      );
      if (superseded > -1) { out.splice(superseded, 1); }
      else if (out.some((o) => o.kind === f.kind && o.display.startsWith(f.display))) continue;
      seen.add(key);
      out.push({
        kind: f.kind,
        label: factLabel(f.kind as PressFact['kind']),
        display: f.display,
        sentence: evidenceWindow(f.sentence, f.display),
        url: r.url,
        sourceLabel: citationLabel(r.source, r.url, false),
        provenance: 'PRESS',
      });
    }
  }
  out.sort((a, b) => (FIGURE_ORDER.get(a.kind) ?? 99) - (FIGURE_ORDER.get(b.kind) ?? 99));
  return {
    figures: out.slice(0, ENTRY_FIGURE_CAP),
    held: Math.max(0, out.length - ENTRY_FIGURE_CAP),
  };
}

// ---- WHAT THE FILINGS THEMSELVES STATE ---------------------------------------
//
// The RECORD half of the same idea. scaleOf above lifts what publications
// reported; this lifts what the county, the city or the agency stated in its own
// document, read by agents/scraper/readers and stored on the record by
// `npm run capture:filings` (migration 035).
//
// NOTHING IS RE-READ HERE. The fact was verified at write time against the
// document it came from - display present in the text AND in the line stored
// beside it - and this reads the stored column. The gate re-checks the second
// half at the document boundary for the same reason it does for press: a
// reformatted display must fail rather than ship.
//
// NO PARTIES, EVER. The readers do not produce a party and this does not look
// for one. `case_planner` is the closest thing and it is CITY STAFF: it is
// excluded below by name, because a case officer printed among a project's facts
// is one rendering away from being read as a party to it.
const FILING_FACT_EXCLUDED = new Set([
  // City staff, not a party. See readers/anaheim-agenda.
  'case_planner',
  // Already printed as its own thing: the entry's records carry the action, and
  // the conditions get their own block rather than a figure line each.
  'condition',
]);

// ---- WHAT THE APPROVAL IS CONDITIONAL ON -------------------------------------
//
// The conditions were read, verified and stored, and then dropped on the floor
// by FILING_FACT_EXCLUDED above, whose comment promised a block that nobody
// wrote. Heart Hotel holds 36 distinct conditions across three simultaneous
// applications and not one of them appeared in any document this system
// generates.
//
// EVERY CONDITION IS A QUOTATION, AND THE STORED `line` IS THE QUOTATION.
// `display` is what the reader keyed on and it is sometimes cut at the reader's
// own width - "the order of vacation must be recorded in the Office of the
// County Recorder or the application will e" - while `line` is the whole
// sentence the document printed. So this prints the line and never the display,
// which is the opposite of what a figure does and is right for the same reason:
// a figure is a value with a sentence around it, a condition IS the sentence.
//
// GROUPED BY THE DOCUMENT THEY WERE READ FROM. Heart Hotel is three concurrent
// matters, VS-26-0218, TM-26-500056 and UC-26-0219, each with its own staff
// report and its own conditions. Flattened into one list they would read as one
// set of requirements on one approval, which is a claim about what the county
// bound and is false: the FAA determination binds the use permit, not the
// vacation of the easement.
//
// Generous rather than tight, because a referral brief prints all of them and
// this is a runaway guard rather than an editorial cut. Stated when it binds.
const CONDITIONS_PER_MATTER_CAP = 60;

function conditionsOf(records: ScopedRecord[]): { sets: EntryConditionSet[]; held: number } {
  // Keyed on the DOCUMENT, not the record. Heart Hotel's three matters were
  // captured five times between them - the same staff report reached us through
  // two Legistar routes - so keying on the record would print the same condition
  // set twice under two identical headings.
  const byDoc = new Map<string, EntryConditionSet & { seen: Set<string> }>();
  for (const r of records) {
    if (!isFiling(r.source, r.source_type, r.stream)) continue;
    const facts = (r.filing_facts ?? []) as { kind: string; display: string; line: string }[];
    const conditions = facts.filter((f) => f?.kind === 'condition' && f.line);
    if (conditions.length === 0) continue;
    const doc = r.primary_document_url ?? r.url;
    if (!doc) continue;
    let set = byDoc.get(doc);
    if (!set) {
      set = {
        // THE MATTER AS THE FILING NAMES IT, or nothing. A composed heading over
        // a county's conditions would be us captioning a legal instrument.
        matter: referenceOf(r) ?? 'this matter',
        url: doc,
        sourceLabel: citationLabel(r.source, doc, true, { sourceType: r.source_type, market: r.market, date: recordDate(r) }),
        date: recordDate(r),
        conditions: [],
        held: 0,
        seen: new Set<string>(),
      };
      byDoc.set(doc, set);
    }
    for (const f of conditions) {
      const text = String(f.line).trim();
      const key = text.toLowerCase().replace(/\s+/g, ' ');
      if (set.seen.has(key)) continue;
      set.seen.add(key);
      if (set.conditions.length >= CONDITIONS_PER_MATTER_CAP) { set.held++; continue; }
      set.conditions.push(text);
    }
  }
  const sets = [...byDoc.values()].map(({ seen: _seen, ...s }) => s);
  return { sets, held: sets.reduce((n, s) => n + s.held, 0) };
}

// A project may hold many filings and each states the site again. Ten is above
// anything the corpus produces per project today; the remainder is counted.
export const ENTRY_STATED_CAP = 24;

// AND AT MOST THIS MANY OF ANY ONE KIND, which matters more than the total.
// Metropolitan Park holds 8 filings and 46 stated facts; ordered by importance
// and capped only on the total, the entry printed FOUR hearing dates and two
// project statuses and then ran out of room before the 250-room hotel, the
// 25,000-seat stadium and the 2,098,000 gsf. Breadth is what a reader wants from
// an entry - one of each thing the filings state - and depth is what the record
// lines underneath are for.
const PER_KIND_CAP = 2;

// THE ORDER A CLIENT READS IN, not the order a clerk files in.
//
// The first cut of this list was the reader's own grouping - everything
// procedural, then the site, then the size - and against Metropolitan Park's 46
// facts it filled the whole block with hearing dates, milestones, ULURP numbers
// and CEQR numbers and ran out before the 250-room hotel and the 25,000-seat
// stadium. A client entry answers "what is it, where, how big, and what
// happened" and the paperwork identifiers are the last of those, not the first.
const STATED_ORDER = new Map(
  [
    // WHAT HAPPENED, in one or two lines.
    'nyc_status', 'nyc_approved', 'staff_recommendation', 'commission_action',
    'board_action', 'the_vote', 'held_to', 'next_hearing', 'tab_cac', 'protests',
    // WHERE.
    'site_address', 'cross_streets', 'apn', 'nyc_block_lot', 'town', 'nyc_borough',
    'land_use_plan', 'zone', 'existing_land_use',
    // HOW BIG, AND HOW MUCH. The half a client acts on.
    'site_acreage', 'project_type', 'rooms', 'seats', 'units', 'stories',
    'height_feet', 'floor_area', 'parking', 'lots', 'unit_size', 'density',
    'open_space', 'purchase_price', 'money_other', 'nyc_financing', 'nyc_affordable',
    'agreement', 'counterparty', 'nyc_co_applicants',
    // THE PAPERWORK, last. Real, citable, and not what the entry is for.
    'nyc_milestone', 'nyc_milestone_date', 'nyc_filed', 'nyc_certified',
    'nyc_completed', 'nyc_milestones', 'nyc_environmental_milestone',
    'nyc_notice_type', 'nyc_published', 'application_no', 'resolution',
    'effective_date', 'nyc_review_type', 'nyc_ulurp', 'nyc_ceqr_number',
    'nyc_ceqr_type', 'nyc_actions', 'nyc_agency', 'nyc_community_district',
    'nyc_council_district', 'environmental', 'ceqa_class', 'sustainability',
  ].map((k, i) => [k, i])
);

// ---- WHEN THIS MATTER WAS NEXT DUE TO BE HEARD ------------------------------
//
// Read off the filings, never composed. See Entry.schedule for why it is a
// stated date rather than a "next steps" heading: 16 of the 17 live projects
// that state one state a date that has already passed.
//
// TWO SHAPES AND NO GUESSING. Clark County prints held_to as 07/22/26 and NYC
// prints next_hearing as 2026-02-26 or as "August 5, 2026 at 9:00 a.m.". A
// display that matches none of the three is not printed: a date we cannot read
// is not a date we may state.
const SCHEDULE_KINDS = new Set(['held_to', 'next_hearing']);
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function parseStatedDate(display: string): string | null {
  const d = display.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(d);
  if (m) return `20${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = /^([A-Z][a-z]+)\s+(\d{1,2}),?\s+(\d{4})/.exec(d);
  if (m) {
    const i = MONTHS.indexOf(m[1]);
    if (i >= 0) return `${m[3]}-${String(i + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return null;
}

function scheduleOf(records: ScopedRecord[], today: string): Entry['schedule'] {
  let best: Entry['schedule'] = null;
  for (const r of records) {
    if (!r.url) continue;
    if (!isFiling(r.source, r.source_type, r.stream)) continue;
    for (const f of (r.filing_facts ?? []) as { kind: string; label: string; display: string }[]) {
      if (!SCHEDULE_KINDS.has(f.kind)) continue;
      const date = parseStatedDate(f.display);
      if (!date) continue;
      // THE LATEST STATED DATE WINS. A matter held twice states both, and the
      // one a reader needs is the one furthest along.
      if (best && best.date >= date) continue;
      best = {
        date,
        display: f.display.trim(),
        label: f.label || (f.kind === 'held_to' ? 'held to' : 'next hearing'),
        ahead: date >= today,
        url: r.primary_document_url ?? r.url,
        sourceLabel: citationLabel(r.source, r.primary_document_url ?? r.url, true, {
          sourceType: r.source_type,
          market: r.market,
          date: recordDate(r),
        }),
      };
    }
  }
  return best;
}

function statedOf(records: ScopedRecord[]): { figures: EntryFigure[]; held: number } {
  const out: EntryFigure[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    if (!r.url) continue;
    // A filing's facts, and only a filing's. A press record has no filing_facts
    // and could not have any, but the check is written rather than assumed.
    if (!isFiling(r.source, r.source_type, r.stream)) continue;
    const facts = (r.filing_facts ?? []) as {
      kind: string; label: string; display: string; line: string; value: number | null;
    }[];
    for (const f of facts) {
      if (!f?.kind || !f.display || !f.line) continue;
      if (FILING_FACT_EXCLUDED.has(f.kind)) continue;
      // The same reader-side rule as the entry dedupe: one fact, not several
      // readings of it, and a value beats a string where both exist.
      const key = `${f.kind}:${f.value ?? f.display.toLowerCase()}`;
      if (seen.has(key)) continue;
      // ONE FACT, NOT SEVERAL READINGS OF IT - the same prefix rule the press
      // block uses, and needed here for the same reason. Heart Hotel holds five
      // agenda sheets and the board action wraps differently in each, so the
      // entry printed "COUNTY COMMISSION ACTION: June 17, 2026 - HELD - To
      // 07/22/26 - per the" and "COUNTY COMMISSION ACTION: June 17, 2026 -" as
      // two facts. Where one display is a prefix of another the longer one is
      // the same fact read more completely.
      const superseded = out.findIndex(
        (o) => o.kind === f.kind && f.display.startsWith(o.display)
      );
      if (superseded > -1) { out.splice(superseded, 1); }
      else if (out.some((o) => o.kind === f.kind && o.display.startsWith(f.display))) continue;
      // An unquotable fact is not printable. The writer's guard should have
      // caught it; this is the reader-facing half, so one bad stored row cannot
      // take out a document.
      if (!f.line.includes(f.display)) continue;
      seen.add(key);
      out.push({
        kind: f.kind,
        label: f.label,
        display: f.display,
        // The LINE the document printed it on, which plays the part the press
        // sentence plays: it is the evidence, and the gate checks the display
        // against it.
        sentence: f.line,
        // THE DOCUMENT, not the record page. A reader checking "752 rooms"
        // needs the staff report, not the Legistar index that links to it.
        url: r.primary_document_url ?? r.url,
        sourceLabel: citationLabel(r.source, r.primary_document_url ?? r.url, true, { sourceType: r.source_type, market: r.market, date: recordDate(r) }),
        provenance: 'RECORD',
        // The case this filing is, so a kind stated by two concurrent
        // applications can say which is which. See the attribution pass below.
        matter: referenceOf(r),
      });
    }
  }
  // READ IN THE ORDER A PERSON ASKS THE QUESTIONS, not the order the records
  // happened to be captured in: what was decided and when, then where it is,
  // then how big it is.
  out.sort((a, b) => (STATED_ORDER.get(a.kind) ?? 99) - (STATED_ORDER.get(b.kind) ?? 99));

  // ---- ONE FACT PRINTED ONCE, ACROSS KINDS AS WELL AS WITHIN ONE -------------
  //
  // The prefix rule above dedupes within a kind, and the readers extract the
  // same fact under two kinds whenever a document states it in a sentence and
  // again as a field. Heart Hotel printed
  //
  //   COUNTY COMMISSION ACTION: June 17, 2026 - HELD - To 07/22/26 - per the applicant.
  //   HELD: 07/22/26. "HELD - To 07/22/26"
  //
  // one line apart. Two labels, two kinds, one decision, and a reader counting
  // hold dates finds two.
  //
  // THE CONTAINED ONE GOES, NOT THE SHORTER ONE. The test is whether this fact's
  // whole display appears inside another fact's display: "07/22/26" is inside
  // the board action's sentence, so the board action is the same fact read more
  // completely and the field is a second copy of part of it.
  //
  // GUARDED THREE WAYS, because a containment test over short strings is exactly
  // how a real fact gets deleted. It only fires on displays of 6 characters or
  // more, so "1" lot is never swallowed by "11.95" acres; only within one
  // document, so a number stated by the use permit cannot delete the same number
  // stated by the tentative map; and only when the container is strictly longer,
  // so two identical displays do not delete each other.
  const survives = out.filter(
    (f) =>
      f.display.length < 6 ||
      !out.some(
        (o) =>
          o !== f &&
          o.url === f.url &&
          o.display.length > f.display.length &&
          o.display.includes(f.display)
      )
  );

  // ---- A KIND STATED TWICE IS ATTRIBUTED, NOT LEFT TO LOOK CONTRADICTORY -----
  //
  // Heart Hotel is three concurrent applications on one site, and two of them
  // state a project type: the tentative map creates a "Commercial subdivision"
  // and the use permit approves a "Resort Hotel & Recreational Facility". Both
  // are true, of different instruments. Printed as two bare "Project Type" lines
  // one after the other they read as the county contradicting itself, and a
  // reader has no way to tell which is which - the two links differ and nothing
  // on the page says so.
  //
  // So where one kind carries more than one distinct value, each line's LABEL
  // names the matter it came from. Where a kind carries one value the label is
  // untouched, which is every kind on almost every project.
  const distinctByKind = new Map<string, Set<string>>();
  for (const f of survives) {
    if (!distinctByKind.has(f.kind)) distinctByKind.set(f.kind, new Set());
    distinctByKind.get(f.kind)!.add(f.display);
  }
  // ---- AND WHERE THERE IS NO CASE NUMBER, THE DOCUMENT IT CAME FROM --------
  //
  // `matter` is referenceOf(), a Clark County case reference - "UC-26-0219".
  // A New York record carries none, so this guard was silently false for the
  // whole market and the labels repeated. Metropolitan Park printed "Current
  // milestone" twice with different values, "Application filed" twice with
  // different dates, "Latest environmental milestone" twice and "acres" twice
  // for two different things: FOUR self-contradictions on one page, in a
  // document whose entire argument is that its facts can be checked.
  //
  // MEASURED over 155 live projects: 18 print a repeated label, 40 labels in
  // all, and 14 of the 18 are New York City. It is not a New York bug - it is
  // the disambiguator having exactly one key and New York not carrying it.
  //
  // The fallback is the DATE OF THE DOCUMENT the fact came from, taken off the
  // citation the fact already carries. Nothing is invented: sourceLabel is built
  // by citationLabel from the record's own source and date, and a reader
  // following the link lands on the document the suffix names. Where even that
  // is absent the label is left alone rather than given a made-up key - an
  // ambiguous label is bad and a wrong one is worse.
  //
  // AND THE KEY IS THE FIRST ONE THAT ACTUALLY SEPARATES THEM. A fixed order -
  // case number, then date - is not enough on its own: Monitor Point holds TWO
  // ZAP applications filed on the same day, so both lines took "(14 December
  // 2025)" and went on contradicting each other with a qualifier attached, which
  // is worse than no qualifier because it looks resolved.
  //
  // So each candidate is tested against the kind it is qualifying, and the first
  // that gives every line a different key wins. Where none does, the label is
  // left alone - an ambiguous label is bad, and one carrying a key that does not
  // distinguish is a false resolution.
  const KEYS: ((f: EntryFigure) => string | null)[] = [
    (f) => f.matter ?? null,
    (f) => documentDateOf(f.sourceLabel),
    // The document itself. A ZAP application's id is the last path segment of
    // its url, which is what a reader following the link arrives at.
    (f) => {
      const seg = String(f.url ?? '').split(/[/?#]/).filter(Boolean).pop();
      return seg && seg.length <= 24 ? seg : null;
    },
  ];
  const byKind = new Map<string, EntryFigure[]>();
  for (const f of survives) {
    if (!byKind.has(f.kind)) byKind.set(f.kind, []);
    byKind.get(f.kind)!.push(f);
  }
  const chosenKey = new Map<string, ((f: EntryFigure) => string | null) | null>();
  for (const [kind, fs] of byKind) {
    if ((distinctByKind.get(kind)?.size ?? 0) <= 1) {
      chosenKey.set(kind, null);
      continue;
    }
    const found = KEYS.find((k) => {
      const keys = fs.map(k);
      return keys.every((v) => !!v) && new Set(keys).size === fs.length;
    });
    chosenKey.set(kind, found ?? null);
  }
  const attributed = survives.map((f) => {
    const k = chosenKey.get(f.kind);
    const key = k ? k(f) : null;
    return key ? { ...f, label: `${f.label} (${key})` } : f;
  });

  // THE PER-KIND CAP DEMOTES, IT DOES NOT DELETE. It used to discard the third
  // and later value of a kind outright, and OCVibe then printed ELEVEN facts and
  // said "2 further stated figures held back to keep this list readable" with
  // thirteen places still free under ENTRY_STATED_CAP. Two things were wrong
  // with that: the facts were thrown away with room to spare, and the reason
  // given was not the reason - they went to breadth, not to length.
  //
  // Breadth still wins the top of the block, which is the Metropolitan Park fix
  // and the point of the rule: one of each thing the filings state comes first,
  // so the 250-room hotel is not pushed out by a fourth hearing date. What has
  // changed is what happens to the overflow. It goes AFTER the breadth pass, in
  // its own order, and it is printed if the block has room. Only the total cap
  // holds anything back now, so the sentence that says so is true.
  const perKind = new Map<string, number>();
  const spread: EntryFigure[] = [];
  const overflow: EntryFigure[] = [];
  for (const f of attributed) {
    const n = (perKind.get(f.kind) ?? 0) + 1;
    perKind.set(f.kind, n);
    (n > PER_KIND_CAP ? overflow : spread).push(f);
  }
  const ordered = [...spread, ...overflow];
  return {
    figures: ordered.slice(0, ENTRY_STATED_CAP),
    held: Math.max(0, ordered.length - ENTRY_STATED_CAP),
  };
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
  // ---- THE SAME GATES THE PEOPLE BLOCK USES, BECAUSE THIS IS A PAGE TOO ------
  //
  // AN ENTRY HAS TWO PARTY PATHS AND ONLY ONE OF THEM WAS EVER GATED. buildParties
  // in lib/people builds the people block; playersOf and contactOf here build the
  // "Players:" and "Contact:" clauses on the record lines. Every rule about which
  // names may be printed - the public-agency applicant, the government mover, the
  // press-sourced contact - was written into the first and none into the second,
  // so a name refused four inches up the page printed here unchanged.
  //
  // The gates are IMPORTED rather than re-implemented. A second copy is a copy
  // that drifts, and the half that drifts is the half a client reads.
  push(applicantIsPublicAgency(r) ? null : r.applicant, 'applicant');
  push(r.representative, 'representative');
  push(presenterIsGovernmentMover(r) ? null : r.presented_by, 'presented by');
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
  // A FILING'S CONTACT BLOCK STATES A CONTACT. AN ARTICLE STATES NOTHING OF THE
  // KIND. Heart Hotel printed "Contact: Eli Applebaum. No phone or email in the
  // record." under six press headlines. No record names him as a contact and no
  // record names him at all: every one of the six is a news story, and
  // contact_name there was written by the intelligence lane reading prose.
  //
  // lib/people already refuses this - it gives a press-sourced name the role
  // "named in press coverage" instead of "contact named in the record" - and the
  // fix landed there and not here. The person is not lost by this: the people
  // block four rows up prints them with that role, the article, and the link,
  // which is the whole of what we know. Repeating it on the record line added
  // nothing except the word that was wrong.
  if (!isFiling(r.source, r.source_type, r.stream)) return null;
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

// ---- WHICH LANGUAGE THE RECORD IS IN -----------------------------------------
//
// Anaheim publishes its council agendas in English and in Spanish, and both are
// captured, so a project can hold two records of one item that differ in every
// character. The deduper folds them together and then has to choose which one
// to print - and choosing "whichever says more" printed the Spanish one, because
// the Spanish minute of the Disneyland development-agreement review is the
// longer of the pair. A client document in the wrong language is not a small
// defect; it reads as though nobody looked at the output.
//
// So: prefer English where both exist, and where only the Spanish record exists,
// SAY SO rather than printing it unmarked. The alternative to saying so is a
// line the reader cannot parse and cannot account for.
//
// Detected by function words, not by an accent test: the accents survive
// inconsistently through PDF extraction, while "que", "sobre" and "del" do not
// appear in English filings. "los" and "las" are deliberately absent from the
// list because Los Angeles and Las Vegas are in this corpus on every page.
const SPANISH_MARKERS = new RegExp(
  '\\b(que|del|para|sobre|por|una|sus|este|esta|mediante|conforme|propiedad|' +
    'condiciones|propietario|presentada|cumplido|determinar|aprobar|ordenanza|' +
    'resoluci[oó]n|t[eé]rminos|acuerdo|ciudad|desarrollo|reuni[oó]n|sesi[oó]n)\\b',
  'gi'
);
const SPANISH_MARKER_THRESHOLD = 3;

// AND THE COUNTER-TEST, BECAUSE SPANISH FOUND IS NOT ENGLISH ABSENT.
//
// The marker test above answers "is there Spanish in this text". The note it
// drove says something else: that we hold no English capture of the item. Those
// came apart on a bilingual capture. Measured: THREE records on live projects
// carry Spanish markers and ALL THREE are bilingual - one Anaheim PDF holds the
// English minute and its Spanish twin in one document, so the record opens
// "Adoption of resolutions dedicating municipal property for public streets" in
// plain English and the entry printed that sentence with "[Spanish-language
// record; no English capture of this item]" hung underneath it.
//
// Same shape as the six defects standing rule 8 was written for: a label read as
// the thing it names. So the note now requires BOTH halves - Spanish present and
// English absent - and where the capture carries both languages the entry prints
// the English and says nothing, because nothing has been withheld and no English
// capture is missing. See the golden case
// a-bilingual-capture-is-not-a-spanish-only-record.
const ENGLISH_MARKERS = new RegExp(
  '\\b(the|and|that|for|with|shall|has|have|been|which|from|other|owner|terms|' +
    'conditions|review|period|adoption|authorization|determination|approve|' +
    'resolution|ordinance|agreement|hearing|application)\\b',
  'gi'
);
const ENGLISH_MARKER_THRESHOLD = 3;

function isSpanish(r: ScopedRecord): boolean {
  const text = tidy(`${r.action_sought ?? ''} ${r.title ?? ''}`);
  const es = new Set((text.match(SPANISH_MARKERS) ?? []).map((m) => m.toLowerCase()));
  if (es.size < SPANISH_MARKER_THRESHOLD) return false;
  const en = new Set((text.match(ENGLISH_MARKERS) ?? []).map((m) => m.toLowerCase()));
  return en.size < ENGLISH_MARKER_THRESHOLD;
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
  spanish: boolean;
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
      spanish: isSpanish(r),
    };
    const dup = kept.find((k) => isDuplicate(k, candidate));
    if (dup) {
      merged++;
      // WHICH OF THE TWO TO KEEP. Language decides first: between a bilingual
      // pair, the English record is the one that goes in an English document,
      // whatever their relative lengths. Only when both are the same language
      // does the longer one win, which is the rule that keeps the full item
      // over a page fragment.
      const preferByLanguage = dup.spanish !== candidate.spanish;
      const takeCandidate = preferByLanguage
        ? dup.spanish && !candidate.spanish
        : candidate.words.size > dup.words.size;
      if (takeCandidate) {
        dup.r = r;
        dup.words = candidate.words;
        dup.text = candidate.text;
        dup.reference = candidate.reference ?? dup.reference;
        dup.spanish = candidate.spanish;
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

// ---- A DESCRIPTION THAT OPENS WITH THE APPLICANT'S OWN NAME ------------------
//
// Clark County files its agenda lines as "KULIK RIVER CAPITAL, LLC: TENTATIVE
// MAP consisting of ...", and the derived summary is a quotation from that line,
// so the description a client reads opens
//
//     Kulik river capital, LLC: Tentative map consisting of 1 commercial lot...
//
// The name is already printed twice on the same entry - as the applicant in THE
// PEOPLE, and often in the project's own name - so this is the third time, in
// the one sentence that is supposed to say what the thing IS. Measured: 17 of 92
// derived summaries open with a "label: " prefix, 9 of them a company name.
//
// ONLY WHERE IT IS PROVABLY CIRCULAR, which is what makes this safe to do to a
// quotation. The prefix is dropped ONLY when it normalises to a party this entry
// already names, or to the project's own name. A prefix that is neither is
// content - a cross-street, a case caption, a department - and is left alone.
// Nothing is added, nothing is rephrased, and where the test does not hold the
// sentence is untouched.
//
// The stored summary is NOT modified. This is a print-time rule: the register,
// the detail pane and the project page still show what the filing said, and the
// column remains a faithful quotation.
function dropCircularPrefix(text: string, project: Project, people: ProjectParty[]): string {
  const m = /^([^:]{3,70}):\s+(\S.*)$/s.exec(text);
  if (!m) return text;
  const prefix = m[1];
  const rest = m[2];
  // The rest has to still be a sentence. A prefix followed by three words is a
  // caption, not a description with a name in front of it.
  if (rest.length < 25) return text;
  const norm = (x: string) =>
    x.toLowerCase().replace(/[.,&]/g, ' ')
      .replace(/(inc|llc|l l c|lp|llp|corp|co|company|ltd|dpc|pc|the)/g, ' ')
      .replace(/\s+/g, ' ').trim();
  const key = norm(prefix);
  if (!key) return text;
  const known = [norm(project.name), ...people.map((p) => norm(p.name))].filter(Boolean);
  const circular = known.some((k) => k === key || (k.length > 5 && key.includes(k)) || (key.length > 5 && k.includes(key)));
  if (!circular) return text;
  // Raise the first letter, because the sentence used to start mid-line.
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/**
 * THE WITHHELD-MOVER SENTENCE, for an entry that DID print parties.
 *
 * Null when nothing was held back. See Entry.peopleWithheldNote for why this is
 * separate from noPartiesNote: that one only speaks when the block is empty, and
 * on 32 of the 48 projects the presenter gate touches a party still prints while
 * a name is still being withheld.
 *
 * It states the count and the reason and names the bodies, because a reader who
 * knows the Department of City Planning is on the filing must be able to see
 * that we hold it and placed it deliberately, rather than wonder whether we
 * missed it.
 */
function moverNote(records: ScopedRecord[], printed: { name: string }[]): string | null {
  const { count, names } = withheldMovers(records, printed);
  // A mover who is ALSO printed under another role is not withheld, and where
  // every one of them is, there is nothing to say. Anaheim: the whole note went
  // away once Lisandro Orozco and Stacy Tran were recognised as standing in the
  // block already, under contact_name.
  if (count === 0 || names.length === 0) return null;
  const who = names.slice(0, 3).join('; ');
  const more = names.length > 3 ? `, and ${names.length - 3} other${names.length - 3 === 1 ? '' : 's'}` : '';
  return (
    `${count === 1 ? 'One further record' : `${count} further records`} name${count === 1 ? 's' : ''} ` +
    `the body that brought this matter forward${who ? ` (${who}${more})` : ''}. That is who moved it ` +
    `in government rather than who is behind it, so it is not listed above as a party to approach.`
  );
}

/**
 * A SENTENCE NAMING THE FIGURES PUBLICATIONS DISAGREE ABOUT. Null when none.
 *
 * Counted per KIND, on the printed display, because that is what a reader sees
 * repeated: "rooms" twice with two numbers is the contradiction, and the same
 * number quoted by two publications is not. See Entry.scaleDisagreement.
 */
function disagreementNote(scale: EntryFigure[]): string | null {
  const byKind = new Map<string, Set<string>>();
  for (const f of scale) {
    if (!byKind.has(f.label)) byKind.set(f.label, new Set());
    byKind.get(f.label)!.add(f.display);
  }
  const split = [...byKind.entries()].filter(([, v]) => v.size > 1);
  if (split.length === 0) return null;
  const parts = split.map(([label, v]) => `${label} (${v.size} figures)`);
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return (
    `Publications do not agree on ${list}. Each figure above is quoted from the article that ` +
    `printed it and carries its publisher, and we have no filing stating any of them - so this ` +
    `is a disagreement between sources rather than a correction of one by another, and which is ` +
    `current is not something our record can settle.`
  );
}

export function buildEntry(
  project: Project,
  records: ScopedRecord[],
  opts: {
    cap?: number;
    history?: Map<string, PartyHistory>;
    // EVERY record the project holds, whenever filed. The PEOPLE section is
    // built from these rather than from the period-scoped set: parties are what
    // is true of the project, record lines are what happened in the window.
    // Falls back to the scoped records when absent, so a caller that has not
    // been updated degrades to the old behaviour rather than to no parties.
    partyRecords?: ScopedRecord[];
  } = {}
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

  const brands = brandCasing(project.name);
  // Built from the records the entry PRINTS, so the people section and the
  // filings under it cannot describe different sets.
  // NOT `shown`. See the note on opts.partyRecords: a project whose only
  // in-period filings are press was reported as having no party at all.
  const forParties = opts.partyRecords?.length ? opts.partyRecords : shown;
  const people = opts.history
    ? withPartyHistory(buildParties(project, forParties), opts.history)
    : buildParties(project, forParties);
  // FROM THE PROJECT'S WHOLE RECORD SET, not from the eight the entry prints and
  // not from the period. Scale is what the thing IS; a room count does not stop
  // being true because the article that carried it fell outside the window or
  // below the per-entry cap. Same set the people block uses, and for the same
  // reason. Each figure carries its own article link, so nothing here cites a
  // document the reader cannot open.
  const scale = scaleOf(forParties, project);
  // The RECORD half, from the same whole-project set and for the same reason:
  // a parcel number does not stop being this project's because the filing that
  // stated it fell outside the window.
  const stated = statedOf(forParties);
  // From the same whole-project set, for the same reason: a condition attached
  // to an approval does not stop binding because the filing that carried it fell
  // outside the period.
  const conditions = conditionsOf(forParties);
  const entryRecords: EntryRecord[] = shown.map((r) => {
    const reference = referenceOf(r);
    const text = actionText(r, reference, brands);
    const isRecord = isFiling(r.source, r.source_type, r.stream);
    return {
      date: recordDate(r),
      reference,
      text,
      figures: figuresOf(r, text),
      // Only ever set on a record that survived deduping WITHOUT an English
      // twin: where the pair existed, the English one is what is printed and
      // there is nothing to declare.
      language: isSpanish(r) ? 'Spanish-language record; no English capture of this item' : null,
      // ONLY THE PARTIES THIS RECORD DOES NOT SHARE WITH THE PROJECT. The people
      // section above names everyone once; repeating the same applicant on every
      // line is precisely what it replaces. What survives here is the case the
      // July standard prints, where a filing names a party the project's primary
      // pair does not.
      players: distinctRecordParties(r, project).map((p) => ({ name: p.name, role: p.role })),
      contact: contactOf(r),
      provenance: isRecord ? 'RECORD' : 'PRESS',
      url: r.url,
      sourceLabel: citationLabel(r.source, r.url, isRecord, { sourceType: r.source_type, market: r.market, date: recordDate(r) }),
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
          ? { text: dropCircularPrefix(tidy(project.summary), project, people), url: project.summary_url }
          : null,
      assembled: assembleSentence(entryRecords),
      stated: stated.figures,
      statedHeld: stated.held,
      // TODAY, passed in rather than read here, so the same record set produces
      // the same document twice. See buildEntry's callers.
      schedule: scheduleOf(shown, new Date().toISOString().slice(0, 10)),
      conditions: conditions.sets,
      conditionsHeld: conditions.held,
      scale: scale.figures,
      scaleHeld: scale.held,
      people,
      scaleDisagreement: disagreementNote(scale.figures),
      noPeopleNote: people.length === 0 ? noPartiesNote(forParties) : null,
      // See Entry.peopleWithheldNote. Only where a party DID print: when none
      // did, noPartiesNote above already names the withholding and its count,
      // and two sentences saying it would be the duplicated-withholding blemish
      // in a new place.
      peopleWithheldNote: people.length > 0 ? moverNote(forParties, people) : null,
      records: entryRecords,
    },
    held: ordered.length - shown.length,
    merged,
  };
}
