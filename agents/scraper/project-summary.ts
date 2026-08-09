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
}

export interface SummaryRecord {
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
    '|notice is hereby given that)\\s*',
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
const SHOUTED = new RegExp('\\b[A-Z]{4,}(?:\\s+[A-Z]{2,})*\\b', 'g');

// Control characters. Socrata emits a raw 0x1a where the publisher had a smart
// quote, and it renders as a black box in a client document.
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001f]', 'g');

const ABBREVIATIONS = new RegExp('\\b(No|Nos|St|Ave|Blvd|Rd|Inc|Ltd|Co|Corp|Sq|Ft|approx)\\.', 'gi');

const clean = (s: string): string => s.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();

const deshout = (s: string): string =>
  s.replace(SHOUTED, (m) => m.charAt(0) + m.slice(1).toLowerCase());

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
      const stripped = clean(raw.replace(LEAD_IN, ''));
      // A fragment shorter than this is a label, not a description.
      if (stripped.length < 25) continue;
      const sentence = firstSentence(deshout(stripped));
      // Capitalise, because the source clause often begins mid-sentence.
      return { summary: sentence.charAt(0).toUpperCase() + sentence.slice(1), source: 'derived' };
    }
  }
  return null;
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
