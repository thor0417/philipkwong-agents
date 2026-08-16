// PRESS FACT EXTRACTION. Scale, read out of an article body, never inferred.
//
// THE ONE RULE THIS FILE EXISTS TO ENFORCE: a number that is not in the text
// does not appear. Every fact carries `display`, which is the substring the
// article actually printed, and `sentence`, which is the sentence it was printed
// in. `verifyNoInvention` asserts that every `display` is still findable in the
// source text, and it is called by the writer before anything is stored, so an
// extractor bug becomes a refusal rather than a figure in a client document.
//
// That matters more here than anywhere else in the system. A wrong market
// narrows a document; a wrong room count is a specific false claim about a real
// building, made to a reader who may know the real number.
//
// CONSERVATIVE BY CONSTRUCTION. Each pattern requires an explicit unit next to
// the digits: "752 rooms", "29-storey", "5,000-seat", "$5 billion". A bare number
// is never a fact. Where an article says nothing in this shape, nothing is
// extracted, which is the honest negative and not a failure.

export type FactKind = 'rooms' | 'floors' | 'sqft' | 'seats' | 'money' | 'acres' | 'firm';

export interface PressFact {
  kind: FactKind;
  /** Verbatim, exactly as the article printed it. Always a substring of the body. */
  display: string;
  /** Normalised for comparison and sorting. Null where normalisation is not meaningful. */
  value: number | null;
  /** The sentence it came from, so a reader can check it without opening the page. */
  sentence: string;
}

// ---- sentences --------------------------------------------------------------
// Split on terminal punctuation followed by a capital. Deliberately simple: the
// sentence is context for a human reader, so an imperfect split costs clarity
// and never correctness.
export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z"'$])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function sentenceFor(text: string, index: number): string {
  // Walk out from the match to the nearest sentence boundaries rather than
  // re-splitting the whole document for every match.
  const start = Math.max(0, text.lastIndexOf('. ', index) + 1, text.lastIndexOf('\n', index) + 1);
  let end = text.indexOf('. ', index);
  if (end === -1) end = text.length;
  return text.slice(start, Math.min(end + 1, text.length)).trim().slice(0, 400);
}

// ---- numbers ----------------------------------------------------------------
function num(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

const SCALE: Record<string, number> = {
  b: 1e9, bn: 1e9, billion: 1e9,
  m: 1e6, mm: 1e6, million: 1e6,
  k: 1e3, thousand: 1e3,
  t: 1e12, trillion: 1e12,
};

// ---- the patterns -----------------------------------------------------------
// Each requires its unit adjacent to the digits. The capture group used for the
// normalised value is noted where it is not group 1.
// Verbs and function words that occur in Title Case headlines and never inside a
// registered company name. Used only to reject a candidate firm.
const HEADLINE_WORD =
  /\b(Is|Are|Was|Were|Be|Been|Being|Has|Have|Had|Will|Would|Could|Should|Can|May|Might|Seeks?|Says?|Said|Plans?|Adds?|Buys?|Sells?|Wins?|Gets?|Opens?|Marks?|Takes?|Makes?|Brings?|Breaks?|Files?|Eyes|Sets|Faces|Backs|Names?|Reveals?|Unveils?|Launches|Announces?|Approves?|Rejects?|Delays?|Halts?|Turning|Coming|Dampening|Reshapes?|Includes?|Features?|More|Most|Than|That|This|These|Those|Not|But|How|Why|What|When|Where|Who|Its|Their|Our|Your|After|Before|Amid|Into|Over|Under|Against|Toward|Towards|Behind|During|Between|Through|Without|Within|Across|Among)\b/;

interface Pattern {
  kind: FactKind;
  re: RegExp;
  /** Reject a match that is real text but not a fact about this project. */
  reject?: (m: RegExpExecArray) => boolean;
  value?: (m: RegExpExecArray) => number | null;
}

const PATTERNS: Pattern[] = [
  {
    kind: 'rooms',
    // "752 rooms", "752-room", "752 guest rooms", "752 keys". Plural or hyphenated
    // only: "a room" is not a count.
    re: /\b([\d,]{1,7})[\s-]?(?:guest[\s-]?)?(?:rooms?|keys)\b/gi,
    // A single room is a room, not a scale figure, and "1 room" is nearly always
    // a fragment of something else.
    reject: (m) => (num(m[1]) ?? 0) < 2,
    value: (m) => num(m[1]),
  },
  {
    kind: 'floors',
    // "29 storeys", "29-storey", "29 stories", "29 floors". Requires digits, so
    // "ground floor" and "top floor" cannot match.
    re: /\b([\d,]{1,4})[\s-]?(?:storey|story|stories|storeys|floors?|levels?)\b/gi,
    reject: (m) => {
      const n = num(m[1]) ?? 0;
      // Above this it is not a building height; it is a page or a case number
      // that happened to sit next to the word.
      return n < 2 || n > 250;
    },
    value: (m) => num(m[1]),
  },
  {
    kind: 'sqft',
    re: /\b([\d,.]+)\s*(million|thousand)?\s*(?:square[\s-]?f(?:ee|oo)t|square[\s-]?foot|sq\.?\s?ft\.?)\b/gi,
    value: (m) => {
      const base = num(m[1]);
      if (base === null) return null;
      return base * (m[2] ? SCALE[m[2].toLowerCase()] ?? 1 : 1);
    },
  },
  {
    kind: 'seats',
    // "5,000-seat", "5,000 seats", "capacity of 18,000".
    re: /\b(?:capacity\s+of\s+)?([\d,]{2,9})[\s-]?(?:seats?|capacity)\b/gi,
    reject: (m) => (num(m[1]) ?? 0) < 10,
    value: (m) => num(m[1]),
  },
  {
    kind: 'money',
    // "$5 billion", "$70M", "$1.7 billion", "US$30 billion".
    // The separator before the scale word must allow a hyphen: publications write
    // "US$8-billion" as often as "US$8 billion", and without this the match ends
    // at "US$8", which is not a wrong number so much as a meaningless one.
    re: /(?:US)?\$\s?([\d,.]+)[\s-]*(billion|million|trillion|thousand|bn|mm|[BMKT])?\b/g,
    // A BARE SMALL AMOUNT IS NOT A SCALE FIGURE. "$200" and "US$8" were both
    // extracted from Heart Hotel's coverage; neither is a development cost, and
    // a reader seeing "$8" against a Las Vegas resort learns nothing except that
    // we are not reading carefully. An amount with no scale word has to reach a
    // million on its own digits to count.
    reject: (m) => {
      if (m[2]) return false;
      const base = num(m[1]);
      return base === null || base < 1_000_000;
    },
    value: (m) => {
      const base = num(m[1]);
      if (base === null) return null;
      const s = m[2] ? SCALE[m[2].toLowerCase()] : undefined;
      return s ? base * s : base;
    },
  },
  {
    kind: 'acres',
    re: /\b([\d,.]+)[\s-]acres?\b/gi,
    value: (m) => num(m[1]),
  },
  {
    kind: 'firm',
    // A capitalised name ending in a legal or corporate suffix. This is the ONLY
    // party shape trusted from press: "developer Eli Applebaum" reads as a name
    // to a regex and to nobody else, and guessing a person's role off a headline
    // is exactly the fabrication rule 11 forbids.
    re: /\b((?:[A-Z][\w&'.-]*\s+){0,4}[A-Z][\w&'.-]*\s+(?:LLC|L\.L\.C\.|Inc\.?|Incorporated|Corp\.?|Corporation|Company|Holdings|Partners|Properties|Development(?:s)?|Group|Ventures|Capital|Realty|Associates))\b/g,
    reject: (m) => {
      const s = m[1];
      // Too short to be a name, or a sentence opener that swept up a suffix word.
      if (s.length < 8) return true;
      // Publishers, wires and platforms are not parties to the project.
      if (/\b(Associated Press|Reuters|Bloomberg|Business Journal|Real Deal|Google|Facebook|Meta Platforms|Yahoo|MSN)\b/i.test(s)) return true;
      // A HEADLINE IS NOT A COMPANY. Measured on the first real run: "OCVibe
      // Seeks More Corporate Partners" and "Zoning Is Dampening Development"
      // were both extracted as firms, because press headlines are Title Case and
      // several corporate suffixes ("Partners", "Development", "Group") are also
      // ordinary English nouns that end a sentence.
      //
      // The tell is a verb or a function word, which never appears inside a
      // company name and almost always appears in a headline. Rejecting on it
      // costs nothing real: a firm whose registered name contains "Seeks" does
      // not exist.
      return HEADLINE_WORD.test(s);
    },
    value: () => null,
  },
];

// ---- extraction -------------------------------------------------------------
export function extractPressFacts(text: string, limitPerKind = 6): PressFact[] {
  const out: PressFact[] = [];
  const seen = new Set<string>();
  for (const p of PATTERNS) {
    let hits = 0;
    p.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.re.exec(text)) !== null && hits < limitPerKind) {
      if (p.reject?.(m)) continue;
      const display = m[0].trim();
      const key = `${p.kind}:${display.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits++;
      out.push({
        kind: p.kind,
        display,
        value: p.value ? p.value(m) : null,
        sentence: sentenceFor(text, m.index),
      });
    }
  }
  return out;
}

// ---- the guard --------------------------------------------------------------
// Called before anything is written. A fact whose display is no longer findable
// in the source text is an extractor defect, and the correct response to it is
// to store nothing rather than to store something plausible.
export function verifyNoInvention(facts: PressFact[], text: string): PressFact[] {
  const bad = facts.filter((f) => !text.includes(f.display));
  if (bad.length) {
    throw new Error(
      `press-facts invented ${bad.length} value(s) not present in the source text: ` +
        bad.map((f) => `${f.kind}="${f.display}"`).join(', ')
    );
  }
  return facts;
}

// ---- attribution: is this figure about THIS project? ------------------------
//
// THE DEFECT THIS EXISTS TO PREVENT, measured on the first real run. Reading 11
// articles about Heart Hotel produced 73 facts, among them "US$20 billion",
// "US$36 billion", "34-story", "1.7 million square feet" and "3,000-seat". Every
// one of those is a real figure correctly read out of the text. Not one is about
// Heart Hotel. They come from Las Vegas market round-ups that mention the project
// in one paragraph and four other developments in the rest.
//
// So an article about a project is NOT a document about only that project, and
// extraction alone cannot be trusted to fill a project entry. A figure earns its
// place in the entry only when the sentence carrying it also names the project or
// a party to it. Everything else stays on the record it came from, where the
// headline gives a reader the context to judge it.
//
// This is deliberately strict. A missed room count is a thin document; a wrong
// one is a false statement about a real building.

// A SINGLE TOKEN ONLY ATTRIBUTES IF IT IDENTIFIES. Measured: attributing on the
// single tokens of "Heart Hotel / Kulik River" let "US$20 billion" and "US$36
// billion" into Heart Hotel's entry, because the sentences carrying them used
// "capital" and "the heart of the Strip" in the ordinary English sense. Same
// shape for OCVibe, where "anaheim" attributed every sentence about the city.
//
// So: geography, venue nouns, corporate furniture and ordinary nouns are struck
// out as single tokens. They still attribute as part of a MULTI-WORD phrase,
// which is where their identifying power actually lives - "Kulik River" and
// "Metropolitan Park" identify, "river" and "park" do not.
const NAME_STOPWORDS = new Set([
  // structure and instruments
  'the', 'and', 'for', 'project', 'development', 'developments', 'redevelopment',
  'plan', 'plans', 'phase', 'site', 'improvements', 'expansion', 'campus',
  // venue nouns
  'center', 'centre', 'resort', 'resorts', 'hotel', 'hotels', 'casino', 'arena',
  'stadium', 'district', 'park', 'tower', 'towers', 'venue', 'theatre', 'theater',
  'museum', 'convention', 'entertainment', 'gaming', 'retail', 'residences',
  // corporate furniture
  'company', 'group', 'llc', 'inc', 'corp', 'corporation', 'holdings', 'partners',
  'properties', 'ventures', 'associates', 'realty', 'capital', 'estate', 'real',
  'management', 'international', 'global', 'national', 'american',
  // ordinary geography and ordinary nouns that read as names
  'north', 'south', 'east', 'west', 'new', 'city', 'county', 'downtown', 'metro',
  'metropolitan', 'station', 'square', 'place', 'village', 'harbor', 'harbour',
  'beach', 'valley', 'ranch', 'springs', 'creek', 'lake', 'island', 'river',
  'heart', 'point', 'economic', 'anaheim', 'vegas', 'orlando', 'nashville',
  'phoenix', 'oakland', 'yonkers', 'westchester', 'miami', 'antonio', 'angeles',
  'york', 'clark', 'disney', 'disneyland',
]);

/** Distinctive tokens a sentence must carry to be about this project. */
export function attributionTerms(projectName: string, ...parties: (string | null | undefined)[]): string[] {
  const terms = new Set<string>();
  // Multi-word fragments of the name are stronger than single tokens: "Kulik
  // River" identifies, "River" does not.
  for (const part of projectName.split(/\s*[/|]\s*/)) {
    const cleaned = part.trim();
    if (cleaned.length >= 5) terms.add(cleaned.toLowerCase());
  }
  for (const token of projectName.split(/[^A-Za-z0-9']+/)) {
    const t = token.toLowerCase();
    if (t.length >= 5 && !NAME_STOPWORDS.has(t)) terms.add(t);
  }
  for (const p of parties) {
    if (!p) continue;
    // Trailing punctuation on a stored applicant ("Kulik River Capital,") would
    // otherwise become part of the phrase and never match.
    const cleaned = p
      .replace(/\b(LLC|L\.L\.C\.|Inc\.?|Corp\.?|Corporation|Company|Ltd\.?|LP|LLP)\b/gi, '')
      .replace(/[\s,;:.]+$/, '')
      .trim();
    if (cleaned.length >= 5) terms.add(cleaned.toLowerCase());
    for (const token of cleaned.split(/[^A-Za-z0-9']+/)) {
      const t = token.toLowerCase();
      if (t.length >= 5 && !NAME_STOPWORDS.has(t)) terms.add(t);
    }
  }
  return [...terms];
}

export function isAttributed(fact: PressFact, terms: string[]): boolean {
  const s = fact.sentence.toLowerCase();
  return terms.some((t) => s.includes(t));
}

/**
 * The facts that may appear in a project entry: attributed, and deduplicated on
 * the normalised value so "752 rooms" and "752-room" are one fact rather than two.
 */
export function factsForEntry(facts: PressFact[], terms: string[]): PressFact[] {
  const kept: PressFact[] = [];
  const seen = new Set<string>();
  for (const f of facts) {
    if (!isAttributed(f, terms)) continue;
    const key = `${f.kind}:${f.value ?? f.display.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(f);
  }
  return kept;
}

// ---- presentation -----------------------------------------------------------
export function factLabel(kind: FactKind): string {
  return {
    rooms: 'rooms', floors: 'storeys', sqft: 'floor area', seats: 'seats',
    money: 'value', acres: 'site', firm: 'named firm',
  }[kind];
}

// One line per fact, provenance attached. [PRESS] because that is what it is:
// a figure a publication printed, not a figure a filing states.
export function factLine(f: PressFact, url: string): string {
  return `[PRESS] ${factLabel(f.kind)}: ${f.display}  (${url})`;
}
