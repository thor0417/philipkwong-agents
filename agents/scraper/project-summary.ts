// WHAT THE PROJECT IS, IN ONE LINE.
//
// The name answers "which one" - it is derived from the best identifier
// available, which is often an address or an applicant. The summary answers
// "what is it". A register that cannot answer the second is a list of
// addresses: "Busters Marine Bronx Marina" does not say its records concern an
// outdoor cafe concession in a Brooklyn park, and "2510 Coney Island Avenue
// Rezoning" does not say it is an eleven-storey mixed-use building.
//
// DERIVED BEATS GENERATED, AND IT IS NOT CLOSE. Government filings already
// contain the sentence: ZAP publishes a project_brief written to describe what
// is sought, CEQR publishes a project_description, and an FCRC notice states
// its subject after "relative to:". Quoting the filing is cheaper, faster,
// reproducible, and cannot hallucinate. A model is the fallback for records
// whose own words are a case number and a date, not the default.
//
// NULL IS AN ANSWER. A project whose only record is a meeting agenda has
// nothing honest to say about what it is, and inventing a line for it would put
// a sentence nobody can support onto a client-facing page. The derivation
// returns null and the register shows the name alone.
//
// EVERY REGEX HERE IS BUILT FROM A STRING. That is not a style preference: an
// earlier version of this file was edited through a shell heredoc, which turned
// the two-character escape \b into a literal 0x08 backspace byte inside two
// patterns. Both compiled, both typechecked, and both silently never matched -
// the capitalisation rule looked correct and did nothing for an hour. Escapes
// written as "\\b" in a string survive that class of edit.

export type SummarySource = 'derived' | 'generated' | 'manual';

export interface SummaryResult {
  summary: string;
  source: SummarySource;
  // THE FILING THIS WAS QUOTED FROM. A derived summary is somebody else's
  // sentence, and a client document may only carry it as a RECORD line - which
  // the report layer refuses to render without a source. Null is impossible for
  // a derived result and expected for the other two.
  sourceUrl: string | null;
  // Which derivation field fired. Reported by the backfill so a bad rule can be
  // found by its name rather than by re-reading every summary it produced.
  field: string | null;
}

export interface SummaryRecord {
  url?: string | null;
  title: string | null;
  raw_content: string | null;
  source: string | null;
  published_date: string | null;
  action_sought?: string | null;
}

// The labelled blocks the adapters write, best first. Each is a sentence the
// SOURCE wrote about its own subject, which is the whole reason to prefer them.
const DERIVATION_FIELDS: { label: string; re: RegExp }[] = [
  // ZAP. Written by DCP to describe the application.
  { label: 'zap-brief', re: new RegExp('^Project brief: (.+)$', 'm') },
  // CEQR. Written by the lead agency to describe the proposed action.
  { label: 'ceqr-description', re: new RegExp('^Project description: (.+)$', 'm') },
  // City Record. The notice states its own subject after this clause.
  { label: 'city-record-subject', re: new RegExp('relative to:\\s*(.+?)(?:\\s{2,}|$)', 'm') },

  // ---- Outside New York -----------------------------------------------------
  //
  // The first version of this file read three fields, all of them NYC, and
  // derived 134 of 345 projects: 83% of New York and 0% of everywhere else.
  // "39% derive without a model call" was really "New York derives". Every one
  // of the 211 others would have gone to the model, at a call each, to
  // reconstruct a sentence the filing already contains.
  //
  // Anaheim's planners write the request out under its own heading, which is
  // the single best derivation field in the corpus outside ZAP.
  { label: 'agenda-request', re: new RegExp('^\\s*Request:\\s*(.+?)$', 'm') },
  // Legistar publishes the ordinance or resolution's subject as its title. It
  // is a full sentence written by the clerk: "An ordinance approving Amendment
  // No. 6 to the Arts Center Redevelopment Plan".
  { label: 'legistar-subject', re: new RegExp('^Government record \\(Legistar [^)]*\\): (.+)$', 'm') },
  // The agenda item itself, for the portal sources. Lower than the two above
  // because an item line carries procedural scaffolding ("For possible action
  // to...") that LEAD_IN has to strip before anything useful is left.
  { label: 'agenda-item', re: new RegExp('--- item text ---\\s*\\n([\\s\\S]+?)(?:\\n\\s*\\n|$)') },
];

// Boilerplate that appears at the START of a source sentence and says nothing.
// Stripped rather than rejected, because what follows is usually the substance.
//
// Anchored on a word boundary. An earlier version ended at `the applicant,?`
// without one, so "The Applicants" was stripped to its own trailing "s" and
// produced summaries beginning "S, Fulcrum Properties, LLC; ...". A lead-in
// stripper that leaves debris is worse than no stripper.
const LEAD_IN = new RegExp(
  '^(?:this is a private application (?:by|requesting)' +
    '|a private application by' +
    '|an application by' +
    '|the applicants?\\b,?' +
    '|the proposed actions?\\b (?:include|involve|would)' +
    '|the proposed action is' +
    '|notice is hereby given that' +
    // Agenda scaffolding. "31. For possible action to approve a One-Day Opening
    // for a Non-Restricted Gaming license" is a sentence about the council's
    // procedure wrapped around a sentence about the project. The item NUMBER
    // goes too: it identifies a line on a page, not a project, and it changes
    // between the agenda and the minutes for the same matter.
    '|\\d{1,3}\\.\\s*' +
    '|for possible action(?: to)?' +
    '|determinar sobre la base de la evidencia presentada por' +
    '|item no\\.?\\s*\\d+\\s*' +
    '|public hearing and ordinance adoption\\s*[-–]\\s*' +
    '|an? (?:ordinance|resolution) (?=approv|authoriz|amend|accept|declar))\\s*',
  'i'
);

// A DERIVED LINE MUST SAY WHAT IS BEING SOUGHT.
//
// Without this, the ZAP brief for 730 Avenue derived to "Fulcrum Properties,
// LLC; The Briarwood Organization, LLC; and Moses Sole Realty, LLC, in
// cooperation with Godian Fellowship Inc. and Thomas White, Jr." - a correct
// quotation of the filing's first sentence, and useless. The register already
// has an applicant column; a summary that only names the applicant answers
// "which one" a second time and never answers "what is it".
//
// Applied to the EMITTED line, not the source clause, because a sentence whose
// action verb sits beyond the length budget gets truncated into an applicant
// list regardless of what the untruncated text said.
const ACTION_TERMS = new RegExp(
  '\\b(seek|seeks|seeking|request|requests|requesting|propose|proposes|proposed|' +
    'application|apply|applies|amendment|amend|rezon\\w*|permit|variance|' +
    'certification|certify|concession|licen[cs]e|authoriz\\w*|special permit|' +
    'redevelop\\w*|develop\\w*|construct\\w*|renovat\\w*|demap\\w*|disposition|' +
    'acquire|acquisition|lease|award|approv\\w*|designat\\w*|map\\w*|study|' +
    'facilitate|replace\\w*|rehabilitat\\w*|expansion|expand)\\b',
  'i'
);

// A sentence that is only an instrument name tells the reader nothing they did
// not already get from the stage column.
const CONTENTLESS = new RegExp(
  '^(?:see attached|no description|n/?a|tbd|none|pending|withdrawn|approved|filed)\\.?$',
  'i'
);

// Block capitals are a property of a notice's typography, not of the fact.
// FCRC writes its subject as "INTENT TO AWARD as a concession ...", and a
// register full of shouting is unreadable.
//
// MATCHED AS A RUN, NOT AS A WORD. Matching single words meant "USE PERMIT"
// came out as "USE Permit", because USE is three letters and the pattern
// required four; and "BALLY'S" came out as "bally'S", because the apostrophe
// ended the match and left the trailing S as its own word. A run is two or more
// consecutive all-capital tokens, at least one of them four letters or longer -
// which is what typographic shouting actually looks like, and which leaves a
// lone "MGM" or "LLC" alone because a real acronym does not travel in a pack.
const SHOUTED = new RegExp("\\b[A-Z][A-Z0-9'’-]*(?:\\s+[A-Z][A-Z0-9'’-]*)+\\b", 'g');
const HAS_LONG_WORD = new RegExp('[A-Z]{4,}');

// A shouted word standing on its own: "APPLICANT: Panther Acquisitions, LLC -
// OWNER: Margel". No run to belong to, so the run pattern leaves it, and the
// register ends up shouting one word per clause. Five letters is the threshold
// because it clears every acronym the corpus actually uses - LLC, MGM, RFP, IP,
// ERP, HPD, MIH - while catching APPLICANT, ABEYANCE and OWNER.
const SHOUTED_WORD = new RegExp("\\b[A-Z]{5,}(?:['’][A-Z]+)?\\b", 'g');

// Case numbers, which identify a filing and describe nothing. Clark County
// writes "UC-26-0128-Marina Estates, LLC:", Las Vegas writes "R-40-2025 - ",
// Phoenix wraps withdrawals in "***...***".
const CASE_PREFIX = new RegExp(
  '^(?:\\*{2,}[^*]*\\*{2,}\\s*' +
    '|abeyance\\s*[-–]\\s*' +
    // The parenthetical is NESTED in Clark County's review filings:
    // "AR-26-400068 (ET-25-400074(UC-23-0659))-Buona Vita, LLC:" carries a
    // review number wrapping an extension number wrapping the original use
    // permit. [^)]* stops at the first ')' and left the whole prefix standing
    // on the one filing shaped that way. Matching balanced-ish nesting one
    // level deep covers it without reaching for a parser.
    '|[A-Z]{1,4}-\\d{2,4}-[\\dA-Z]+(?:\\s*\\((?:[^()]|\\([^()]*\\))*\\))?\\s*[-–:]\\s*' +
    '|\\d{2}-\\d{3,4}-[A-Z]+\\d*\\s*[-–]\\s*)+',
  'i'
);

// Control characters. Socrata emits a raw 0x1a where the publisher had a smart
// quote, and it renders as a black box in a client document.
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001f]', 'g');

const ABBREVIATIONS = new RegExp('\\b(No|Nos|St|Ave|Blvd|Rd|Inc|Ltd|Co|Corp|Sq|Ft|approx)\\.', 'gi');

const clean = (s: string): string => s.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();

// Company suffixes caught inside a shouted run come out as "Llc", which reads
// as a typo rather than as a company. Restored after deshouting rather than
// excluded from it, because they sit mid-run and splitting the run around them
// would leave the shouting either side.
const SUFFIXES = new RegExp('\\b(Llc|Llp|Inc|Ltd|Lp|Plc|Ny|Nv|Nyc|Mta|Hpd|Dcp|Edc|Dot|Dpr)\\b', 'g');

const deshout = (s: string): string =>
  s
    .replace(SHOUTED, (m) => (HAS_LONG_WORD.test(m) ? m.charAt(0) + m.slice(1).toLowerCase() : m))
    .replace(SHOUTED_WORD, (m) => m.charAt(0) + m.slice(1).toLowerCase())
    .replace(SUFFIXES, (m) => m.toUpperCase());

// STRIP UNTIL STABLE, ALTERNATING BOTH PATTERNS.
//
// The prefixes nest and they nest in either order: Clark County writes
// "31. UC-26-0128-Marina Estates, LLC:" (item number, then case number) and Las
// Vegas writes "ABEYANCE - 25-0536-GPA1 -" (status word, then case number). One
// pass of each in a fixed order strips whichever happens to be outermost and
// leaves the other, which is why the first attempt at this left "Uc-26-0128-"
// sitting at the front of a client-facing line.
function stripScaffolding(text: string): string {
  let out = clean(text);
  for (let i = 0; i < 4; i++) {
    const before = out;
    out = clean(clean(out.replace(CASE_PREFIX, '')).replace(LEAD_IN, ''));
    if (out === before) break;
  }
  return out;
}

/** First sentence, or a hard-trimmed clause when the text has no full stop. */
function firstSentence(text: string, max = 200): string {
  const guarded = clean(text).replace(ABBREVIATIONS, '$1<DOT>');
  const m = new RegExp('^(.{40,}?[.!?])(?:\\s|$)').exec(guarded);
  let out = (m ? m[1] : guarded).replace(/<DOT>/g, '.');
  if (out.length > max) {
    // Cut at the last clause boundary inside the budget rather than mid-word.
    const cut = out.slice(0, max);
    const at = Math.max(cut.lastIndexOf(', '), cut.lastIndexOf('; '), cut.lastIndexOf(' and '));
    out = `${(at > 80 ? cut.slice(0, at) : cut).replace(/[\s,;]+$/, '')}...`;
  }
  return out;
}

/**
 * A summary quoted from the records themselves, or null when none of them
 * contains a usable sentence.
 *
 * Records are considered NEWEST FIRST: a project's most recent filing describes
 * what it is now, and an eight-year-old brief describes what it was proposed as.
 */
export function deriveSummary(records: SummaryRecord[]): SummaryResult | null {
  const ordered = [...records].sort((a, b) =>
    String(b.published_date ?? '').localeCompare(String(a.published_date ?? ''))
  );
  for (const r of ordered) {
    const body = r.raw_content ?? '';
    for (const f of DERIVATION_FIELDS) {
      const m = f.re.exec(body);
      if (!m) continue;
      const raw = clean(m[1]);
      if (!raw || CONTENTLESS.test(raw)) continue;
      // Twice, because agenda scaffolding nests: "31. For possible action to
      // approve" is an item number wrapped around a procedural clause, and one
      // pass leaves the other behind.
      const stripped = stripScaffolding(raw);
      // A fragment shorter than this is a label, not a description.
      if (stripped.length < 25) continue;
      const sentence = firstSentence(deshout(stripped));
      // No action, no summary. Fall through to the next field or the next
      // record rather than emitting a list of names.
      if (!ACTION_TERMS.test(sentence)) continue;
      // Capitalise, because the source clause often begins mid-sentence.
      return {
        summary: sentence.charAt(0).toUpperCase() + sentence.slice(1),
        source: 'derived',
        sourceUrl: r.url ?? null,
        field: f.label,
      };
    }
  }
  return null;
}

/**
 * THE SAME CLEANING, FOR ANYTHING THAT PRINTS A RECORD'S OWN WORDS.
 *
 * The report layer prints record text directly, and before this existed it did
 * its own trimming and produced lines like
 *
 *   16. DEVELOPMENT APPLICATION NO. 2026-00022 (DEV2026-00022) GENERAL PLAN
 *   AMENDMENT TO THE LAND USE ELEMENT ADJUSTMENT NO. 17
 *
 * in a client document: an agenda item number that identifies a line on a page,
 * a case number that describes nothing, and a clerk's block capitals. All three
 * were already solved here, for the register, and solved better - CASE_PREFIX
 * handles Clark County's nested parentheticals, deshout leaves a real acronym
 * alone, and stripScaffolding alternates the two patterns until they stop
 * matching because the prefixes nest in either order.
 *
 * EXPORTED RATHER THAN COPIED. Two implementations of this would drift, and the
 * one in the client document is the one nobody re-reads. This file has no
 * imports precisely so that it can be consumed from either package.
 *
 * Note what it does NOT do: it does not cut to a sentence and it does not
 * capitalise. A summary is one sentence by definition; a record line is
 * whatever the filing sought, and truncating it is the report layer's decision
 * to make against its own width.
 */
export function cleanRecordText(text: string | null | undefined): string {
  return deshout(stripScaffolding(String(text ?? '')));
}

/**
 * The prompt for the fallback pass. Exported so the wording lives beside the
 * derivation it backs up rather than inside a script, and so it can be read
 * without running anything.
 *
 * Every constraint exists because the alternative appeared in testing: models
 * reach for "significant", "major" and "landmark" unprompted, and a register
 * line that calls a project major has made an assessment nobody authorised.
 */
export const SUMMARY_PROMPT = `You write one factual line describing what a development project IS, from the government records attached to it.

Say what is being sought and for what. Examples of the register you want:
  "Rezoning for a 400-room hotel and conference facility"
  "Public hearing on an outdoor cafe concession"
  "Plan amendment to reclassify 29 acres from commercial resort to residential"

Rules:
- One line, under 160 characters, no trailing full stop.
- Factual only. No assessment, no significance, no adjectives of quality
  (no "major", "significant", "landmark", "ambitious", "key").
- Only what the records state. Never infer a size, a value, a brand or an
  operator that is not written down.
- If the records do not say what the project is - if they are only a meeting
  agenda, a procedural notice or a case number - reply with exactly: UNKNOWN

Records:
`;

// The adjectives the prompt forbids. A model that used one did not follow the
// instruction, and the line is an assessment whatever else it says.
const ASSESSMENT_WORDS = new RegExp(
  '\\b(major|significant|landmark|ambitious|iconic|prestigious|key|exciting|transformative)\\b',
  'i'
);

/** Reject a generated line that broke the rules, rather than storing it. */
export function validateGenerated(text: string): string | null {
  const t = clean(text).replace(/^["']|["']$/g, '').replace(/\.$/, '');
  if (!t || /^unknown$/i.test(t)) return null;
  if (t.length < 20 || t.length > 200) return null;
  if (ASSESSMENT_WORDS.test(t)) return null;
  return t.charAt(0).toUpperCase() + t.slice(1);
}
