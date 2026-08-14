// CANONICAL GLI TAXONOMY. The single source of truth for venue_type,
// development_category, and (reserved for Pass 4) source_type. Every consumer
// imports from here: scraper tagging, the re-tag backfill, and (mirrored) the
// dashboard. Do NOT redefine, rename, merge, or invent values elsewhere. These
// lists are law; no future pass edits them without an explicit instruction.
//
// A GLI lead has exactly ONE venue_type and ONE development_category, and the
// category is DERIVED from the venue via VENUE_TO_CATEGORY, so the two can never
// drift apart. Distinct venue types are never collapsed into a catch-all;
// "Entertainment Destination" is a named destination type, never a bucket: a record
// that matches no rule classifies as NULL. See classifyVenueType.
//
// NOTE ON THE TWO-PACKAGE REPO: the dashboard is a separate Next.js project and
// cannot import this root module, so dashboard/lib/taxonomy.ts mirrors it exactly.
// Keep the two in sync; this file is the authority.

export const VENUE_TYPES = [
  // Entertainment and Attractions
  'Theme Park',
  'Amusement Park',
  'Waterpark',
  'Family Entertainment Center',
  'Zoo',
  'Aquarium',
  'Museum',
  'Science Center',
  'Heritage/Cultural Site',
  // Hospitality and Gaming
  'Hotel',
  'Resort',
  'Integrated Resort',
  'Casino/Gaming',
  'Convention/Expo',
  // Urban and Development
  'Smart City',
  'Master-Planned Community',
  'Mixed-Use Development',
  'Urban Regeneration',
  'Downtown Redevelopment',
  'Waterfront Development',
  'Entertainment District',
  // Infrastructure
  'Arena/Stadium',
  'Transit Hub',
  'Airport City',
  'Transit-Oriented Development',
  // A named destination type, not a fallback. Nothing else fits -> null.
  'Entertainment Destination',
  'Other',
] as const;

export type VenueType = (typeof VENUE_TYPES)[number];

export const DEVELOPMENT_CATEGORIES = [
  'Entertainment/Attractions',
  'Smart City/Urban',
  'Mixed-Use/Real Estate',
  'Infrastructure',
  'Hospitality/Tourism',
  'Other',
] as const;

export type DevelopmentCategory = (typeof DEVELOPMENT_CATEGORIES)[number];

// ---- WHICH RULE NAMED A PROJECT, AND WHICH NAMES MAY BE SHOWN TO A CLIENT ----
//
// A closed vocabulary read by the clusterer that writes it, the register that
// marks it and the report that filters on it, so it lives here with the other
// closed vocabularies rather than in any one of them.
//
// ONLY 'title' IS PROVISIONAL. Every other rule reads a name something asserted
// AS a name - a target term, a source's project-name column, a funding
// programme, an applicant field, an address. 'title' assembles one out of a
// sentence written to instruct a council, and no amount of cleaning makes that
// the project's name.
export const NAME_SOURCES = ['target', 'source', 'programme', 'applicant', 'site', 'title'] as const;
export type NameSource = (typeof NAME_SOURCES)[number];

/**
 * True when the name was assembled from an agenda line rather than read.
 *
 * THE ONE DEFINITION. The register marks these and shows them; a client
 * document excludes them and counts them. Both behaviours are downstream of
 * this predicate, so they cannot come apart.
 *
 * Null counts as provisional: a row predating migration 032 has no recorded
 * rule, and "we do not know how this was named" is not a claim to print.
 */
export function isProvisionalName(source: string | null | undefined): boolean {
  return source === 'title' || source == null;
}

// ---- WHICH CATEGORIES A PIPELINE'S DOCUMENTS ARE SECTIONED BY ----------------
//
// THE REPORT'S SECTION LIST IS THIS LIST, READ AT BUILD TIME. It is not typed
// out in report-sections and it is not derived from whatever categories happen
// to be present in the data: a section list built from the data cannot tell
// "this category is empty this month" from "this category does not exist", and
// the first is worth saying while the second is noise.
//
// KEYED ON pipeline_id BECAUSE A CATEGORY IS A PROPERTY OF A LINE OF BUSINESS.
// The hospitality pipeline is sectioned by development category, which is the
// locked list above. A fuel or consulting pipeline would be sectioned by
// something else, and when one arrives it adds a row here rather than a branch
// in the report.
//
// The fallback is deliberate and stated: an unregistered pipeline gets the
// development categories, because that is what every project row in this
// database carries today. It is a fallback to the truth, not to a guess.
const PIPELINE_CATEGORIES: Record<string, readonly DevelopmentCategory[]> = {
  hospitality: DEVELOPMENT_CATEGORIES,
};

export function categoriesForPipeline(
  pipelineId: string | null | undefined
): readonly DevelopmentCategory[] {
  return PIPELINE_CATEGORIES[String(pipelineId ?? '')] ?? DEVELOPMENT_CATEGORIES;
}

// Each venue_type maps to exactly one development_category.
export const VENUE_TO_CATEGORY: Record<VenueType, DevelopmentCategory> = {
  'Theme Park': 'Entertainment/Attractions',
  'Amusement Park': 'Entertainment/Attractions',
  Waterpark: 'Entertainment/Attractions',
  'Family Entertainment Center': 'Entertainment/Attractions',
  Zoo: 'Entertainment/Attractions',
  Aquarium: 'Entertainment/Attractions',
  Museum: 'Entertainment/Attractions',
  'Science Center': 'Entertainment/Attractions',
  'Heritage/Cultural Site': 'Entertainment/Attractions',
  Hotel: 'Hospitality/Tourism',
  Resort: 'Hospitality/Tourism',
  'Integrated Resort': 'Hospitality/Tourism',
  'Casino/Gaming': 'Hospitality/Tourism',
  'Convention/Expo': 'Hospitality/Tourism',
  'Smart City': 'Smart City/Urban',
  'Master-Planned Community': 'Smart City/Urban',
  'Mixed-Use Development': 'Mixed-Use/Real Estate',
  'Urban Regeneration': 'Smart City/Urban',
  'Downtown Redevelopment': 'Mixed-Use/Real Estate',
  'Waterfront Development': 'Mixed-Use/Real Estate',
  'Entertainment District': 'Mixed-Use/Real Estate',
  'Arena/Stadium': 'Infrastructure',
  'Transit Hub': 'Infrastructure',
  'Airport City': 'Infrastructure',
  'Transit-Oriented Development': 'Infrastructure',
  'Entertainment Destination': 'Entertainment/Attractions',
  Other: 'Other',
};

// The category follows the venue, so an unclassified venue is an unclassified
// category. Returning 'Other' for a null venue would reintroduce the bucket one
// column across: the venue would honestly say "unknown" while the category
// asserted a classification nobody made.
export function categoryForVenue(venue: string | null | undefined): DevelopmentCategory | null {
  if (!venue) return null;
  return VENUE_TO_CATEGORY[venue as VenueType] ?? null;
}

// ---- Reserved for Pass 4 (import and extend these; do NOT define parallels). ----
// Government-stream source document type.
export const SOURCE_TYPES = [
  'Council Agenda',
  'Planning/Zoning Minutes',
  'Staff Report',
  'Comprehensive Plan',
  'Plan Amendment',
  'Special District Document',
  'Budget Document',
  'Other',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

// Player fields are DATA fields, not categories: kept null when absent, never
// fabricated. Names reserved so Pass 4 uses these exact columns.
export const PLAYER_FIELDS = ['presented_by', 'applicant', 'representative', 'action_sought'] as const;

// Primary-document fields, reserved for Pass 4.
export const PRIMARY_DOCUMENT_FIELDS = ['primary_document_url', 'has_primary_document'] as const;

// ---- PROJECT STAGE (Brief: project clustering, Part B) ----------------------
// STAGE IS A PROJECT ATTRIBUTE, NOT A RECORD ATTRIBUTE. A record is evidence; the
// project's stage is derived from the MOST ADVANCED evidence across all of its
// records, and is MANUALLY OVERRIDABLE. Once Philip sets a stage by hand it is
// recorded in the project's manual_overrides and never recomputed.
//
// Rule 1 (most advanced, not most recent). An approval followed by a routine
// administrative filing is still approved. Deriving stage from the newest record
// would walk a project backwards every time a clerk files a compliance note.
export const PROJECT_STAGES = [
  'filed',
  'hearing scheduled',
  'approved',
  'permitted',
  'under construction',
  'operating',
  'stalled',
  'dormant',
] as const;

export type ProjectStage = (typeof PROJECT_STAGES)[number];

// The ADVANCEMENT LADDER: the six document-derived stages, least to most
// advanced. 'stalled' and 'dormant' are deliberately NOT on it (Rule 3): they are
// states a project falls into, not rungs it climbs, so they are applied over the
// ladder result rather than competing with it.
export const STAGE_LADDER = [
  'filed',
  'hearing scheduled',
  'approved',
  'permitted',
  'under construction',
  'operating',
] as const;

export type LadderStage = (typeof STAGE_LADDER)[number];

export function stageRank(stage: LadderStage): number {
  return STAGE_LADDER.indexOf(stage);
}

// Rule 2a: SOURCE TYPE -> stage. This is the WEAK default, used only when no
// action vocabulary matched, because a document type says what kind of paper a
// record is, not how far the project got. The one exception is a comprehensive
// plan, which is an adopted instrument by the time it is published.
export const SOURCE_TYPE_STAGE: Record<SourceType, LadderStage> = {
  'Council Agenda': 'filed',
  'Planning/Zoning Minutes': 'filed',
  'Staff Report': 'filed',
  'Comprehensive Plan': 'approved',
  'Plan Amendment': 'filed',
  'Special District Document': 'filed',
  'Budget Document': 'filed',
  Other: 'filed',
};

// Rule 2b: ACTION VOCABULARY -> stage. Ordered MOST ADVANCED FIRST, first match
// wins, so a record that says both "approved" and "construction permit" reads as
// permitted. Every term is whole-word matched (hasWord), so 'plat' does not fire
// inside 'platinum' and 'ave' does not fire inside 'avenue'.
//
// TERMS ARE DELIBERATELY COMPOUND WHERE THE BARE WORD IS AMBIGUOUS. 'operating'
// alone is not an operating venue: this corpus is full of "Lease and Operating
// Agreement", "Real Property Operating Agreement", and a company literally named
// "Flamingo LV Operating Co., LLC". Only phrases that can mean nothing else are
// listed. The same reasoning keeps a bare 'permit' out of the permitted tier: a
// use permit APPLICATION is a filing, and 'permit' alone would promote every
// entitlement request in Clark County to permitted.
export const STAGE_ACTION_TERMS: { stage: LadderStage; keywords: string[] }[] = [
  {
    stage: 'operating',
    keywords: [
      'grand opening', 'now open', 'opened to the public', 'ribbon cutting',
      'commenced operations', 'began operations', 'officially opened',
      'certificate of occupancy',
    ],
  },
  {
    stage: 'under construction',
    keywords: [
      'under construction', 'construction commenced', 'commenced construction',
      'notice to proceed', 'groundbreaking', 'broke ground', 'topping out',
      'construction engineering inspection', 'change order', 'substantial completion',
      'construction management at risk', 'guaranteed maximum price',
    ],
  },
  {
    stage: 'permitted',
    keywords: [
      'building permit', 'construction permit', 'grading permit', 'permit issued',
      'permit has been issued', 'status issued', 'notice of exemption',
    ],
  },
  {
    // Rule 2: "an approval, ordinance adoption, or good-faith compliance finding
    // is approved". The good-faith compliance finding is the annual development
    // agreement review that Anaheim runs on OCVibe and the Disneyland Resort: it
    // is an affirmative finding on an approved entitlement, not a new filing.
    stage: 'approved',
    keywords: [
      'approved', 'approval', 'adopted', 'ordinance adopted', 'resolution adopted',
      'recommended approval', 'recommended for approval', 'certified',
      'certification of final', 'good faith', 'good-faith', 'complied in good faith',
      'notice of determination', 'authorize execution', 'authorizing execution',
      'award recommended', 'granted', 'entered into',
    ],
  },
  {
    // Rule 2: "a scheduled public hearing is hearing scheduled".
    stage: 'hearing scheduled',
    keywords: [
      'public hearing', 'hearing scheduled', 'set for hearing', 'notice of hearing',
      'set a public hearing', 'first reading', 'second reading', 'third reading',
      'introduction of an ordinance', 'renotification',
    ],
  },
  {
    // Rule 2: "an application or use permit request is filed".
    stage: 'filed',
    keywords: [
      'application', 'use permit', 'special use permit', 'conditional use',
      'zone change', 'rezoning', 'zoning application', 'plan amendment',
      'tentative map', 'site plan', 'site development plan review', 'design review',
      'variance', 'waiver of development standards', 'waivers of development standards',
      'request', 'proposed', 'submitted', 'notice of preparation', 'initial study',
    ],
  },
];

// Rule 3: STALL MARKERS. An explicit abeyance, withdrawal, expiry, denial, or
// non-compliance finding in the record. These are read off the project's MOST
// RECENT record only: a stall is a statement about where the project is NOW, so
// an abeyance in 2024 that was resolved in 2026 must not still read as stalled.
export const STAGE_STALL_TERMS = [
  'abeyance', 'held in abeyance', 'withdrawn', 'withdrawal', 'expired', 'expiry',
  'lapsed', 'denied', 'denial', 'terminated', 'rescinded', 'not in compliance',
  'non-compliance', 'noncompliance', 'continued indefinitely', 'tabled indefinitely',
  'staff recommending denial', 'abandoned',
] as const;

export function hasStallMarker(text: string): boolean {
  return STAGE_STALL_TERMS.some((t) => hasWord(text, t));
}

// The ladder stage a single record supports: action vocabulary first, and only
// then the source type's weak default. Returns 'filed' when nothing matches,
// because a captured government record is at minimum a filing.
export function recordStage(text: string, sourceType: string | null | undefined): LadderStage {
  for (const rule of STAGE_ACTION_TERMS) {
    if (rule.keywords.some((k) => hasWord(text, k))) return rule.stage;
  }
  if (!sourceType) return 'filed';
  return (SOURCE_TYPE_STAGE as Record<string, LadderStage>)[sourceType] ?? 'filed';
}

export function mostAdvancedStage(stages: LadderStage[]): LadderStage {
  if (stages.length === 0) return 'filed';
  return stages.reduce((best, s) => (stageRank(s) > stageRank(best) ? s : best), 'filed' as LadderStage);
}

// Above this rung, a stage has to be earned twice over. See ADVANCED_NEEDS_PROOF.
export const HIGHEST_UNPROVEN_STAGE: LadderStage = 'approved';

// WHAT A RECORD HAS TO BE, for its advanced stage to count.
export interface StageEvidence {
  stage: LadderStage;
  // Did this record join the project on its SITE or its CASE FAMILY, rather
  // than on a shared target term? A target says two records are about the same
  // watched thing; a site or a case number says they are about the same
  // MATTER, which is the question a stage answers.
  attributed: boolean;
}

// A STAGE ABOVE 'approved' MUST BE ATTRIBUTED OR CORROBORATED.
//
// Manhattan West Phase 4 raised the whole Hudson Yards project to 'under
// construction' on the phrase 'substantial completion', and Manhattan West is
// Brookfield's building, four blocks from the Western Rail Yard. Two records of
// twenty-two carried the stage; neither was the project. OCVibe is the same
// shape and worse: one record in twenty, on our highest-scoring project.
//
// The two ways a record earns it:
//
//   ATTRIBUTED   it joined on the project's own site or case family, so it is
//                about this matter and not merely near it;
//   CORROBORATED two records say the same thing, so one borrowed record cannot
//                move the project on its own.
//
// A single-record project is exempt: with no neighbours there is nothing to
// borrow from, and the record IS the project.
//
// Anything refused falls back to the most advanced stage that does pass, which
// is never lower than what the unproven records would have supported anyway.
export function provenStage(evidence: StageEvidence[]): {
  stage: LadderStage;
  refused: LadderStage | null;
} {
  const all = mostAdvancedStage(evidence.map((e) => e.stage));
  if (evidence.length <= 1) return { stage: all, refused: null };
  const bar = stageRank(HIGHEST_UNPROVEN_STAGE);
  const counts = new Map<LadderStage, number>();
  for (const e of evidence) counts.set(e.stage, (counts.get(e.stage) ?? 0) + 1);
  const proven = evidence.filter(
    (e) => stageRank(e.stage) <= bar || e.attributed || (counts.get(e.stage) ?? 0) >= 2
  );
  const stage = mostAdvancedStage(proven.map((e) => e.stage));
  return { stage, refused: stageRank(stage) < stageRank(all) ? all : null };
}

export interface StageInput {
  // The ladder stage of every record attached to the project.
  recordStages: LadderStage[];
  // Does the project's MOST RECENT record carry an explicit stall marker?
  latestRecordStalled: boolean;
  // Project liveness (Part F): a heartbeat inside the window or a future
  // milestone. Computed from dates, never from documents.
  live: boolean;
}

// The project's derived stage. PRECEDENCE: stalled, then dormant, then the
// ladder.
//
// stalled outranks dormant because an explicit withdrawal is a stronger fact
// than inferred silence: a project we KNOW was abandoned should not be filed
// under "we have not heard anything lately". A project that is both is reported
// as stalled, which is the more useful of the two truths.
export function deriveProjectStage(input: StageInput): ProjectStage {
  if (input.latestRecordStalled) return 'stalled';
  if (!input.live) return 'dormant';
  return mostAdvancedStage(input.recordStages);
}

// A manually set stage is law: it is recorded in the project's manual_overrides
// and never recomputed (Rule 4). This is the single place that decision is read,
// so no write path can forget it.
export function stageIsOverridden(overrides: unknown): boolean {
  if (!overrides || typeof overrides !== 'object') return false;
  if (Array.isArray(overrides)) {
    return overrides.some((e) => (e as { field?: unknown })?.field === 'stage');
  }
  return Object.prototype.hasOwnProperty.call(overrides, 'stage');
}

// ---- Deterministic venue classifier (no LLM, so it cannot drift). Ordered rules,
// first match wins: the most specific venues lead, fallbacks last. Matched against
// the lead's title + content (and any existing venue hint). ----
const VENUE_RULES: { venue: VenueType; keywords: string[] }[] = [
  // A NAMED PARK OUTRANKS A GENERIC NOUN, and it has to be ordered first.
  //
  // Waterpark used to be the very first rule, so any text containing "water
  // park" won regardless of what else it said. Walt Disney World's records
  // mention both a theme park and a water park - it has several of each - and
  // the mode of its records made the whole CFTOD project a 'Waterpark'. The
  // largest theme park resort on earth, filed under waterpark.
  //
  // A proper noun is more specific evidence than a common noun that happens to
  // appear in the same document, so the named parks are matched before either
  // generic rule. The generic 'theme park' phrase stays BELOW Waterpark, which
  // preserves the original precedence for everything unnamed: a genuine water
  // park whose brief also says "theme park" is still a Waterpark.
  {
    venue: 'Theme Park',
    keywords: [
      'disneyland', 'walt disney world', 'magic kingdom', 'epcot',
      'hollywood studios', 'universal studios', 'universal orlando',
      'islands of adventure', 'epic universe', 'six flags', 'cedar point',
      'busch gardens', 'seaworld', 'sea world', 'legoland',
    ],
  },
  { venue: 'Waterpark', keywords: ['waterpark', 'water park'] },
  // NAMED THEME PARKS ARE THEME PARKS, and the classifier could not see it.
  //
  // The rule matched only the literal phrase "theme park", so Disneyland Resort
  // classified as 'Resort' - the word "resort" is in its name and the phrase
  // "theme park" is not. Simtec Attractions scope names Theme Park, Amusement
  // Park and Waterpark and does NOT name Resort, so the most relevant cluster
  // in Anaheim was invisible to the one client whose whole business is theme
  // parks. Disney / CFTOD (Walt Disney World) survived only because "Walt
  // Disney World" happens to contain no competing keyword.
  //
  // These are proper nouns naming specific theme parks, which is the same
  // reasoning that makes 'ocvibe' a target term rather than a vocabulary tier:
  // there is nothing ambiguous about them.
  //
  // BARE 'disney' IS DELIBERATELY ABSENT. It would sweep in Disney's Fort
  // Wilderness Cabin Improvements (lodging), the Disney I-4 Interchange
  // (roadway) and Goaa Mitigation At Disney Wilderness Preserve (conservation),
  // none of which are theme parks. 'animal kingdom' is absent for the same
  // reason: its only occurrence in this corpus is the Animal Kingdom LODGE.
  { venue: 'Theme Park', keywords: ['theme park'] },
  { venue: 'Amusement Park', keywords: ['amusement park', 'amusement'] },
  { venue: 'Family Entertainment Center', keywords: ['family entertainment', 'family entertainment center', 'fec'] },
  { venue: 'Aquarium', keywords: ['aquarium'] },
  { venue: 'Zoo', keywords: ['zoo'] },
  { venue: 'Science Center', keywords: ['science center', 'science centre'] },
  { venue: 'Museum', keywords: ['museum'] },
  { venue: 'Heritage/Cultural Site', keywords: ['heritage', 'cultural site', 'cultural center', 'cultural centre', 'cultural'] },
  { venue: 'Integrated Resort', keywords: ['integrated resort'] },
  { venue: 'Casino/Gaming', keywords: ['casino', 'gaming', 'gambling'] },
  // Entertainment District is a high-priority specific type: it must win over the
  // broader urban/redevelopment and convention terms below (a "Downtown
  // Entertainment District" is an Entertainment District, not Downtown
  // Redevelopment), so it is ordered before Convention/Expo and the urban block.
  { venue: 'Entertainment District', keywords: ['entertainment district', 'entertainment complex'] },
  { venue: 'Resort', keywords: ['resort'] },
  // 'motel' was simply missing. Two SFWMD permits ("Motel 6, Disney World",
  // "Disney West Motel") sat unclassified because the rule knew 'hotel' and
  // 'lodging' but not the third word for the same thing. This is a gap, not a
  // new venue type: they are Hotels.
  { venue: 'Hotel', keywords: ['hotel', 'motel', 'lodging', 'hospitality'] },
  { venue: 'Convention/Expo', keywords: ['convention center', 'convention centre', 'convention', 'exhibition center', 'exhibition centre', 'expo', 'exposition', 'congress center', 'congress centre'] },
  { venue: 'Smart City', keywords: ['smart city'] },
  { venue: 'Master-Planned Community', keywords: ['master-planned community', 'master planned community', 'master-planned', 'masterplanned'] },
  { venue: 'Transit-Oriented Development', keywords: ['transit-oriented', 'transit oriented'] },
  { venue: 'Transit Hub', keywords: ['transit hub'] },
  { venue: 'Airport City', keywords: ['airport city'] },
  { venue: 'Arena/Stadium', keywords: ['arena', 'stadium'] },
  { venue: 'Urban Regeneration', keywords: ['urban regeneration', 'urban renewal'] },
  { venue: 'Downtown Redevelopment', keywords: ['downtown redevelopment', 'downtown'] },
  { venue: 'Waterfront Development', keywords: ['waterfront'] },
  { venue: 'Mixed-Use Development', keywords: ['mixed-use', 'mixed use'] },
  // ENTERTAINMENT DESTINATION IS NOT A FALLBACK, and this rule is what stopped
  // it being one.
  //
  // It used to carry ['leisure', 'tourism', 'tourist', 'destination',
  // 'visitor attraction', 'attraction', 'marina', 'golf', 'spa', 'recreation'],
  // sitting last, so any document mentioning any of those words anywhere in its
  // full text landed here. Measured on the stored corpus that was 73 of 184
  // projects - FORTY PER CENT of the register - and an audit of twenty of them
  // found one that genuinely belonged. The rest were rezonings, single-family
  // subdivisions, a vehicle wash, a lake restoration and a cooling tower
  // contract, each renamed "<applicant> leisure development" by the naming
  // layer, which made the misclassification invisible.
  //
  // 'marina' is the case that proves the point: it classified MARINA ESTATES,
  // LLC - an office/warehouse retail use permit - as a leisure destination, on
  // the strength of the applicant's COMPANY NAME.
  //
  // What remains are compound phrases that name a destination and cannot be a
  // company name or a passing mention. A record that matches none of the rules
  // above now classifies as NULL, which is the honest answer, rather than being
  // swept in here.
  { venue: 'Entertainment Destination', keywords: ['visitor attraction', 'tourist attraction', 'visitor destination', 'entertainment destination'] },
];

// Whole-word match, tried twice: once on the text as written, and once with
// intra-word punctuation folded out of BOTH sides. The second pass exists
// because government documents hyphenate at will - SFWMD files "Disney's
// Magnolia Golf Course Holes 14-17 Re-Development", which a plain
// \bredevelopment\b test cannot see - so a real redevelopment permit was
// invisible to the gate.
//
// It is deliberately ADDITIVE rather than a replacement. Folding alone loses
// matches, because removing hyphens also glues tokens together: Clark County
// writes "UC-26-0128-MARINA ESTATES", which folds to "UC260128MARINA" and takes
// the word boundary in front of 'marina' with it. Measured on the stored corpus,
// fold-only lost 4 records and rescued none. Trying the raw text first means the
// fold can only ever add a match, never remove one.
const INTRA_WORD_PUNCT = /[-‐-―_'‘’./]/g;

function foldPunctuation(s: string): string {
  return s.replace(INTRA_WORD_PUNCT, '');
}

function wholeWord(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

// Exported so the vocabulary tester (agents/scraper/gate-term-test) can measure a
// candidate term against the corpus with EXACTLY the matcher the gate uses. A
// tester with its own matching rule would measure a term the gate never applies.
export function hasWord(text: string, keyword: string): boolean {
  if (wholeWord(text, keyword)) return true;
  const foldedKeyword = foldPunctuation(keyword);
  if (!foldedKeyword) return false;
  return wholeWord(foldPunctuation(text), foldedKeyword);
}

// The canonical venue_type for a lead, from its title + content (+ any existing
// venue hint). Never collapses a distinct venue: a keyword for a specific venue
// wins over the broader ones below it.
//
// NULL IS AN ANSWER. It used to return 'Other' when nothing matched, and before
// that the Entertainment Destination rule was broad enough that almost nothing
// reached the fallback at all. Both are the same mistake in different clothes: a
// value that means "we could not tell" is being written into a column a client
// scope filters on, so a scope naming a venue type silently collects everything
// the classifier failed on.
//
// Null says we could not tell, which is true, and a scope filtering on venue
// type will not match it. That is the correct behaviour: an unclassified record
// belongs in nobody's report until somebody classifies it.
// THE HINT IS AN ARGUMENT, NOT PART OF THE TEXT.
//
// Every caller used to do this:
//
//     classifyVenueType(`${title} ${raw_content} ${venueHint}`)
//
// which concatenates a previous classification into the text being keyword
// matched. That is a feedback loop, and it had two consequences, both bad.
//
// IT LET THE MODEL PICK THE ANSWER. The government and opportunity lanes pass
// the Haiku classifier's guess as the hint. Appending it means the model only
// has to SAY the word "Resort" for the keyword rule to find "resort" in its own
// input and agree. "2510 Coney Island Avenue Rezoning" is stored as a Resort;
// its brief describes an 11-storey mixed-use building and the word resort
// appears nowhere in it. On its own text the rule returns Mixed-Use
// Development, which is right.
//
// IT MADE WRONG VALUES PERMANENT. The reclassify migration fed the STORED value
// back in as the hint, so a bad classification re-elected itself on every run.
// That is why a full reclassification pass over 1,705 records changed only 18
// of them: the migration written to correct the column could not, because the
// column was an input to its own correction.
//
// So the hint is now a separate argument, consulted ONLY when the text says
// nothing, and validated against the vocabulary so a hallucinated venue type
// cannot enter the column. A hint can fill a blank; it can never overrule the
// record's own words.
// A VENUE NOUN INSIDE A PLAN'S NAME IS THE PLAN'S NAME.
//
// Nashville's Metro Council finances redevelopment districts one plan at a
// time, and the plans are named after the neighbourhood or landmark they cover:
// the "Arts Center Redevelopment Plan", the "Rutledge Hill Redevelopment Plan".
// A resolution approving tax increment financing in the Arts Center
// Redevelopment Plan classified as Heritage/Cultural Site, and then as a Museum
// on a second record, because the words "Arts Center" are in it.
//
// It is the same failure BORROWED_CONTEXT already handles for the gate, where
// "in a CR (Commercial Resort) Zone" made a church a resort: a proper name that
// happens to contain a venue noun is not a statement that a venue exists.
//
// Measured before shipping: 3 records in the corpus classify a venue from a
// phrase inside a "<Name> Redevelopment Plan", all three from the same Nashville
// project, and one further record classifies Downtown Redevelopment correctly
// from its own subject and is untouched.
const PLAN_NAME = new RegExp(
  "\\b[A-Z][\\w'&.-]*(?:\\s+[A-Z][\\w'&.-]*)*\\s+Redevelopment Plan\\b",
  'g'
);

/** The text a venue rule reads, with plan names blanked. */
// A ZONING DISTRICT IS NOT A VENUE TYPE EITHER.
//
// BORROWED_CONTEXT has neutralised "CR (Commercial Resort) Zone" FOR THE GATE
// since it was written, and the gate has been right about these records all
// along: Buona Vita's daycare filing is correctly a no-match. But the VENUE
// CLASSIFIER never saw that list, so the same boilerplate that could not admit
// a record could still classify it, and a use permit for a daycare and a school
// with a trash-enclosure waiver was stored as venue_type Resort - which is then
// what names the project "Buona Vita resort".
//
// Two readers of one corpus disagreeing about the same words is the defect.
// They now read the same neutralised text.
export function venueReadableText(text: string): string {
  let out = text.replace(PLAN_NAME, ' ');
  for (const re of BORROWED_CONTEXT) out = out.replace(re, ' ');
  return out;
}

// WHAT THE CLASSIFIER SAID BEFORE THE BOILERPLATE WAS NEUTRALISED.
//
// Used for exactly one question, by the reclassify migration: did this
// record's STORED venue type depend on a phrase we now blank? The migration
// passes the stored value as a hint so a record whose text names no venue
// keeps what it has, which is right in general and wrong for these: the
// stored value IS the bug, so the hint reinstates it.
//
// Not for classifying anything. Nothing may call this to decide what a record
// is; it only describes what we used to think.
export function venueTypeBeforeNeutralising(raw: string): VenueType | null {
  const text = raw.replace(PLAN_NAME, ' ');
  for (const rule of VENUE_RULES) {
    if (rule.keywords.some((k) => hasWord(text, k))) return rule.venue;
  }
  return null;
}

// True when the stored value is supported ONLY by neutralised boilerplate.
export function venueDependsOnBorrowedContext(raw: string, stored: string | null): boolean {
  if (!stored) return false;
  return venueTypeBeforeNeutralising(raw) === stored && classifyVenueType(raw) !== stored;
}

export function classifyVenueType(raw: string, hint?: string | null): VenueType | null {
  const text = venueReadableText(raw);
  for (const rule of VENUE_RULES) {
    if (rule.keywords.some((k) => hasWord(text, k))) return rule.venue;
  }
  if (hint) {
    const h = String(hint).trim();
    const exact = VENUE_TYPES.find((v) => v.toLowerCase() === h.toLowerCase());
    if (exact && exact !== 'Other') return exact;
  }
  return null;
}

// ---- GLI GOVERNMENT GATE (two-tier, single source of truth) -----------------
// THE TWO-TIER PRINCIPLE. Do NOT flatten these back into one flat keyword list:
// the flat list both missed real leads (it carried only compound terms like
// "hotel development", so bare "hotel" plats and liquor licenses fell through) and
// admitted noise. The redesign:
//   STRONG  - names a leisure venue or project type UNAMBIGUOUSLY -> matches ALONE.
//   WEAK    - a real leisure signal but ambiguous in isolation (a "hotel" tax note,
//             a "gaming" ordinance) -> matches ONLY with a corroborating ACTION term.
//   ACTION  - entitlement / deal vocabulary that proves a live project or filing.
//   EXCLUSIONS - known governance noise; drop even when a term matched.
// Match = any STRONG, OR (any WEAK AND any ACTION). EXCLUSIONS override everything.
// All matching is whole-word (hasWord) and case-insensitive.
export const GOV_GATE_STRONG = [
  'theme park', 'amusement park', 'amusement', 'water park', 'waterpark',
  'family entertainment center', 'entertainment center', 'entertainment district',
  'entertainment complex', 'entertainment facility', 'entertainment venue',
  'recreational facility', 'recreation center', 'integrated resort', 'resort',
  'casino', 'arena', 'stadium', 'ballpark', 'amphitheater', 'amphitheatre',
  'convention center', 'exposition', 'fairgrounds', 'museum', 'aquarium', 'zoo',
  'cultural center', 'performing arts', 'visitor center', 'attraction',
  'tourism improvement district', 'tourism development', 'marina', 'pier',
  'master-planned community', 'master planned community', 'comprehensive plan',
  'downtown redevelopment', 'urban regeneration',
  'transit-oriented development', 'transit oriented development',
  'entertainment district overlay',
  // PART 4, the only venue noun of fourteen candidates that earned its place.
  // 1 hit over the corpus, 100% relevant, +0.2 precision: the Historic Market
  // Square capital-improvements funding agreement, a calibration probe that was
  // being rejected. See the tested-and-dropped list below.
  'market square',
] as const;

// PART 4, TESTED AND DROPPED. Recorded so the same fourteen candidates are not
// re-proposed from intuition, and so a future run can re-test them in one command
// (GATE_TERMS="..." npm run gate:terms) against a corpus that may have moved.
//
// FIRED ON NOTHING in 2818 candidates - eleven of the fourteen:
//   playhouse, civic center, event center, banquet hall, nightclub,
//   brewery taproom, winery, sports complex, recreation complex, fairground,
//   exhibition hall
// These are unambiguous leisure nouns and would very likely be harmless, but the
// brief's rule is that a term firing on nothing is dead weight, and absence is
// the only evidence available. Worth revisiting WITH evidence rather than adding
// on faith: the moment one of these appears in a corpus, it earns its place.
//
// FIRED, BUT BELOW THE GATE'S OWN PRECISION:
//   theatre  1 hit, 0% relevant. Its only hit is "Valley Youth Theatre 26-1448
//            Payment Ordinance" - a payment ordinance, not a project. This is the
//            term the audit specifically cited as missing; it is missing because
//            it has nothing to catch here.
//   theater  3 hits, 33% relevant. Admits a Planning Commission agenda header and
//            an Alameda Theater OPERATIONS funding extension alongside one real
//            record (a $7.4m TIF-funded Alameda Theater redevelopment).
//   tirz     27 hits, 5% relevant, -7.4 precision. Tested because the Alameda
//            record above is TIRZ-funded and 'reinvestment zone' misses the
//            abbreviation. It fires on "TIF_Houston St. TIRZ Board Meeting_8-27-21",
//            which is boilerplate carried in the raw content of every San Antonio
//            TIF record. A textbook borrowed-context term.
//   chapter 380  1 hit, 0% relevant.
// CONSEQUENCE, stated rather than hidden: the Alameda Theater redevelopment stays
// missed. No term tested catches it without costing more precision than it buys.

// TIER REFINEMENT (proven by the Part B 30-record precision test): 'master plan',
// 'masterplan', 'mixed use', 'mixed-use' were demoted from STRONG to WEAK. They are
// ambiguous alone -- "Storm Drainage Master Plan", "amend the Zoning Ordinance
// re mixed-use standards" are infrastructure/code housekeeping, not leisure
// projects. As WEAK they still catch real work (a mixed-use plan amendment, a
// downtown master plan RFP) because those carry a corroborating ACTION term, while
// the housekeeping items drop. This IS the two-tier principle, not a flattening.
// Accommodation vocabulary ('lodge', 'cabin') sits here for the same reason
// 'hotel' and 'motel' do: it names lodging without proving a project on its own.
// Added with the permitting ACTION terms, because a resort's own construction is
// often filed under the accommodation type rather than the resort name -
// "Disney's Fort Wilderness Cabin Improvements" and the Animal Kingdom Lodge
// parcel are the cases. Measured over the whole government stream, the two terms
// reach exactly those two records and nothing else.
export const GOV_GATE_WEAK = [
  'hotel', 'motel', 'lodge', 'cabin', 'spa', 'golf', 'waterfront', 'redevelopment',
  'hospitality', 'tourism', 'gaming', 'entertainment', 'recreation',
  'master plan', 'masterplan', 'mixed use', 'mixed-use',
] as const;

export const GOV_GATE_ACTION = [
  'use permit', 'special use permit', 'conditional use', 'zone change', 'rezoning',
  'zoning application', 'plan amendment', 'plat', 'tentative map', 'site plan',
  'design review', 'variance', 'waiver of development standards',
  'development agreement', 'disposition and development agreement', 'ground lease',
  'entitlement', 'land use', 'tax increment', 'TIF', 'feasibility',
  'request for proposals', 'liquor license',
  // PERMITTING VOCABULARY. Entitlement records (a use permit, a plan amendment)
  // are only one half of how a project appears in government records; the other
  // half is the permit a water-management or environmental agency issues, and
  // that half carries none of the entitlement vocabulary above. Eight SFWMD
  // records covering real Disney construction (Magnolia golf course
  // redevelopment, Fort Wilderness cabin improvements) failed the gate for
  // exactly this reason: 'golf' and 'redevelopment' are WEAK, and a permit
  // record has no zone change to corroborate them. These terms are the missing
  // corroboration. 'redevelopment' stays WEAK: the ambiguity that demoted it is
  // unchanged, and the fix belongs on the ACTION side.
  'environmental resource permit', 'permit application', 'permit modification',
  'water use permit', 'construction permit', 'dredge and fill', 'mitigation bank',
] as const;

// ---- DEAL TIER (Part 2: the largest miss class) ------------------------------
//
// A development agreement is a project signal whether or not a venue noun appears
// in its title. The two-tier gate could not express that: every deal term lived
// in ACTION, ACTION never fires alone, and so the whole class of city-transacts-
// with-developer records fell through. Three of the projects in the July report
// already delivered to a client were rejected on exactly this.
//
// A DEAL term matches ALONE, like STRONG, because these instruments only exist to
// transact development. What they lack is a venue noun, not legitimacy.
//
// THE DESIGN THAT WAS MEASURED AND REJECTED. The first design required a
// corroborating NAMED PRIVATE PARTY (an LLC/Inc/LP suffix) before a deal term
// could fire, on the theory that "development agreement" is too generic alone.
// Measured per term over the corpus, that requirement was worse on BOTH axES: for
// 'development agreement' it cut hits from 16 to 10 and its own precision from
// 56.3% to 50.0%, because the records it removed included real deals that name no
// counterparty yet. The clearest case is the July-report record itself -
// "Authorization to Issue Disposition and Redevelopment Solicitation" is a city
// inviting proposals, so there IS no named party, and a party requirement would
// have kept the exact record this tier exists to admit. Requirement dropped.
//
// EVERY TERM BELOW WAS MEASURED INDIVIDUALLY (npm run gate:terms) and is listed
// with its hit count over the rejected corpus and its own precision:
//   development agreement                        16 hits, 56.3% - the volume term
//   reinvestment zone                             7 hits,  100% - discovered, see below
//   economic incentive agreement                  3 hits,  100%
//   disposition and redevelopment solicitation    2 hits,  100% - the July-report miss
//   disposition and development agreement         1 hit,   100%
//   exclusive negotiation agreement               1 hit,   100%
//
// 'reinvestment zone' was NOT in the briefed candidate list. It came out of the
// baseline's own missed-record sample: "Tax Increment Reinvestment Zone 31 --
// Midtown" was being rejected while carrying the ACTION term 'tax increment',
// which is the same structural failure. It is the best term in the set.
//
// SIX CANDIDATES WERE TESTED AND DROPPED, each for a measured reason:
//   cooperative agreement       8 hits, 0% relevant, -3.0 precision. Fires on
//                               inter-city service contracts, pest control, and
//                               fleet telematics. The one real cooperative
//                               agreement in the corpus (Disney / Katella Avenue
//                               widening) already passes on 'resort'.
//   ground lease                5 hits, no headline records. This corpus's ground
//                               leases are Phoenix Sky Harbor cargo tenants (UPS,
//                               Custom Pipe & Fabrication).
//                               CONFIRMED STILL OUT. 'ground lease' is in ACTION
//                               and in ACTION ONLY, so it needs a corroborating
//                               WEAK term and can never fire alone. That is the
//                               correct placement and it is working: the UPS Sky
//                               Harbor calibration probe must reject and does,
//                               on 'no-match', having matched this term with no
//                               venue noun beside it. Unlike 'development
//                               agreement' and 'disposition and development
//                               agreement', which sit in ACTION and DEAL
//                               deliberately, this term is in one tier only.
//   funding agreement           4 hits, 25% relevant. Fires on opioid-settlement
//                               service agreements and $50k arts-programming
//                               grants. The one real hit (Historic Market Square
//                               capital improvements) is better caught by a venue
//                               noun - see Part 4.
//   participation agreement     1 hit, 0% relevant.
//   tax increment financing agreement  0 hits. Dead weight: the instrument is
//                               phrased 'reinvestment zone' in this corpus.
//   redevelopment agreement     0 hits, for the same reason.
// 'master economic incentive agreement' was dropped as REDUNDANT, not as bad: it
// matches the same 3 records as 'economic incentive agreement', which is broader.
export const GOV_GATE_DEAL = [
  'development agreement',
  'disposition and development agreement',
  'disposition and redevelopment solicitation',
  'economic incentive agreement',
  'exclusive negotiation agreement',
  'reinvestment zone',
] as const;

// DETACHED RESIDENTIAL: the guard on the deal tier.
//
// "A development agreement for a single-family subdivision is not a hospitality
// project." The residential mixed-use refinement below does not cover this - it
// requires mixed-use to be the only weak signal, and a bare development agreement
// carries no weak signal at all.
//
// SCOPED TO THE DEAL TIER, never a global veto, for the same reason
// isResidentialMixedUse is scoped: a resort parcel's filing routinely mentions
// lots and single-family zoning ("ZC-26-0265-NEVADA PALACE, LLC: ZONE CHANGE to
// reclassify 29.46 acres from a CR (Commercial Resort) Zone"), and those records
// pass on their STRONG term and must keep doing so. This only decides whether a
// record with NOTHING but a deal term is admitted on it.
//
// Verified: it removes the Toll South LV single-family development agreement (a
// calibration probe that must stay rejected) and touches no other deal-tier hit.
const DETACHED_RESIDENTIAL =
  /\bsingle[-\s]?family\b|\bdetached (?:residential|dwelling|single-family)\b|\bresidential subdivision\b/i;

export function isDetachedResidential(text: string): boolean {
  return DETACHED_RESIDENTIAL.test(text);
}

// GOVERNANCE NOISE. These override any match, so every term here must name an
// item's SUBJECT and must not appear as agenda boilerplate inside a real item.
// The second group came out of a 30-record precision sample: labour
// negotiations, legal-counsel conferences, and council recognition items were
// passing on STRONG terms printed elsewhere on the page, never in the item's own
// subject.
//
// FIVE TERMS WERE TRIED HERE AND REMOVED; TWO OF THEM HAVE SINCE COME BACK.
// This note used to say all five were still out, which the list below has
// contradicted since 'closed session' and 'closed meeting' were re-added. The
// code was right and the comment was stale, so read this one carefully.
//
// Originally removed: 'closed session', 'closed meeting', 'public comment
// period', 'ceremonial', 'minutes of the meeting'. Because exclusions override,
// and because the agenda lanes AT THAT TIME gated on an item excerpt that
// carried the meeting's standing boilerplate, those five killed real records: a
// development-application withdrawal notice, an Anaheim resort-district
// resolution, and two assessment-district hearings all died on boilerplate that
// had nothing to do with their subject. Precision bought there cost recall
// somewhere worse.
//
// WHAT CHANGED: the agenda lanes now gate on an item's OWN SUBJECT rather than
// on an excerpt of the surrounding page (gate_text is the item subject, while
// the wider text is passed separately as bypass_text - see the GateCandidate
// contract in agents/scraper/gate-decide). Once an item is scoped to its own
// subject, the meeting's boilerplate can no longer reach it, and the reason
// those two terms were dangerous is gone: an item whose SUBJECT is "closed
// session" really is the meeting talking about itself.
//
// So 'closed session' and 'closed meeting' are live again, and safely. The
// other three remain removed and should stay removed: 'public comment period',
// 'ceremonial' and 'minutes of the meeting' can each appear as a sub-heading
// inside a real item's own subject line, which scoping does not fix.
// An exclusion is a HARD VETO: it beats a strong term. That is why this list is
// short and why it grows slowly. A term earns a place here only if it can never
// be anything but the whole subject of a non-project item.
//
// The additions below are the procedural and fiscal classes measured across the
// 332 live government records. Each is listed with the rows it removes in the
// commit that added it; there are six, not the larger number the audit
// estimated, and the gap is deliberate - see below.
// ---- OUT OF THE VERTICAL, CONDITIONALLY ------------------------------------
//
// A daycare, a school, a church, a medical office, self-storage, a car wash, a
// warehouse, a petrol station, a mast, a trash enclosure: NONE of these is ever
// hospitality or entertainment, in any market, in any jurisdiction.
//
// WHY THIS IS NOT IN GOV_GATE_EXCLUSIONS. Those fire before everything and beat
// a STRONG term, and that is exactly wrong here, because these words appear
// inside real leisure filings all the time. Measured over the live corpus, a
// blunt version of this list would have destroyed:
//
//   CFTOD 2045 Comprehensive Plan - theme park provisions      ['daycare']
//   Public Hearing concerning Bally's Hotel and Casino at
//     Ferry Point Park                                         ['school']
//   Kingsbridge Armory Redevelopment Public Hearing            ['school']
//   UC-26-0128 MARINA ESTATES, LLC: USE PERMIT for retail      ['warehouse']
//   City of Orlando Growth Management Plan                     ['traffic signal']
//
// 54 records match one of these terms and 28 of them are saved by a leisure
// noun, so more than half of a blunt rule's kills would have been wrong.
//
// SO IT IS CONDITIONAL, and the condition is the rule Philip set: an exclusion
// is conclusive only when nothing hospitality-shaped is in the record. It is
// checked AFTER strong, which is what makes that true, and BEFORE weak+action,
// so a daycare with 'mixed use' and 'use permit' can no longer be admitted on
// borrowed entitlement vocabulary.
export const GOV_GATE_OUT_OF_VERTICAL = [
  // Childcare and education.
  'day care', 'daycare', 'child care', 'childcare', 'preschool', 'nursery school',
  'elementary school', 'middle school', 'high school', 'charter school', 'school district',
  // Worship.
  'place of worship', 'religious assembly', 'synagogue', 'mosque',
  // Medical.
  'medical office', 'dental office', 'urgent care', 'dialysis', 'nursing home',
  'assisted living',
  // Storage, vehicles, fuel.
  'self-storage', 'self storage', 'mini-storage', 'mini storage',
  'car wash', 'carwash', 'auto repair', 'automotive repair', 'body shop',
  'car dealership', 'gas station', 'service station',
  // Industrial.
  'distribution center', 'industrial park', 'manufacturing facility',
  // Routine municipal works.
  'trash enclosure', 'refuse enclosure', 'sewer main', 'water main', 'street light',
  // Telecoms.
  'wireless communication facility', 'cell tower', 'telecommunications tower', 'monopole',
] as const;
//
// NOT HERE, DELIBERATELY:
//   'church'    6 records match and 5 carry a leisure noun. The one that does
//               not is a mixed-use rezoning, already caught elsewhere.
//   'warehouse' 24 records match and 16 carry a leisure noun, the worst ratio
//               in the set. Back-of-house is part of a resort.
//   'academy'   matches BLESS-ED DAY ACADEMY and also any 'Academy of Music'.
//   'street name change'
//               DROPPED. It fired on two records, both SC-26-0136 FLAMINGO LV
//               OPERATING CO., a live casino operator. Excluding a filing on a
//               real hospitality property because of the INSTRUMENT sets a
//               precedent that costs real coverage later. If those two records
//               should not be a project, the transaction penalty and the
//               re-gate decide that, not an exclusion.
//   'hospital'  a hospital is out of the vertical, but 'hospitality' is not,
//               and hasWord on a stem is not worth the risk here.

export const GOV_GATE_EXCLUSIONS = [
  'adult entertainment', 'proclamation', 'appointment', 'reappointment',
  'employment agreement', 'personnel', 'retirement', 'condolence', 'commendation',
  'labor negotiator', 'labour negotiator', 'conference with legal counsel',
  'conference with labor', 'council member recognition',
  // Procedure. A closed session and the standing "any other items" slot are the
  // meeting talking about itself; neither can describe a project.
  'closed session', 'closed meeting', 'items from the planning commission',
  // Municipal finance and elections. The appropriations limit is the Gann limit;
  // a ballot measure is election administration. Both were already barred from
  // CLAIMING a project by the clusterer's fiscal-and-ballot guard, so excluding
  // them at capture makes the two layers agree instead of disagree.
  'budget appropriations', 'appropriations limits', 'ballot measure',
  'general municipal election',
] as const;

// NOT ADDED, ON PURPOSE. Three larger classes look like noise and are not, and a
// hard veto on any of them would suppress real signal:
//
//   ABEYANCE / RENOTIFICATION (17 rows). A continuance is a genuine project
//   event - it is the record that a hearing slipped, which is exactly the kind
//   of pace signal the register exists to show. Several are Strip-corridor
//   cases (24-0495-SUP1, a special use permit).
//
//   MULTIFAMILY / HOUSING (12 rows). Two carry STRONG leisure terms and would be
//   destroyed: the Coliseum Complex sale agreement, and UC-26-0373 HILTON
//   RESORTS CORPORATION, a use permit for a MONORAIL. The pure-housing class is
//   already handled precisely by isResidentialMixedUse below, which requires no
//   strong term AND mixed-use as the only weak signal. A blunt 'multifamily'
//   veto would also take both Southern Highlands Golf Club records.
//
//   ZONING CODE AMENDMENTS (7 rows). A change to a development standards manual
//   is often the enabling step for a resort, not a distraction from one.

// ---- RESIDENTIAL MIXED-USE REFINEMENT ---------------------------------------
// A housing project is not a leisure project because its ground floor has shops.
//
// 'mixed use' is WEAK, and paired with an entitlement ACTION it admitted a long
// run of Las Vegas site development plan reviews for apartment buildings: "A
// PROPOSED SEVEN-STORY, 71-UNIT MIXED-USE DEVELOPMENT WITH 1,800 SQUARE FEET OF
// COMMERCIAL SPACE". Those were 7 of the 13 remaining false positives after the
// agenda items were scoped to their own subjects, which is why this is a
// measured refinement rather than a guess.
//
// It fires ONLY when all three hold, and each condition is load-bearing:
//   1. the text states a residential unit count or says multifamily
//   2. there is NO STRONG term (a resort, arena or museum is never dropped)
//   3. MIXED-USE IS THE ONLY WEAK SIGNAL
// Condition 3 was added after testing: without it the rule also killed a golf
// and recreation disposition and development agreement that happened to include
// housing. Verified against the corpus: it excludes 12 rows and touches none of
// the known-good records (OCVibe, Disneyland Resort, Heart Hotel, Hilton,
// Tropicana Land, Mirage Propco, GD Carden, Fire N Ice, Children's Museum).
// 'DU' / 'DUs' added: ZAP and CEQR write dwelling units that way on every New
// York filing ("53 DUs, 100% affordable senior housing", "765 dus"), so the
// rule could not see the unit count it was written to detect. Without it,
// affordable and seniors housing rezonings read as mixed-use developments and
// passed on weak+action.
const RESIDENTIAL_SCALE =
  /\b\d{1,4}[-\s]?(?:units?|dwelling units?|dus?|apartments|condominium units|residential units)\b|\bmultifamily\b|\bmulti-family\b/i;
const MIXED_USE_ONLY = new Set<string>(['mixed use', 'mixed-use']);

// ONE MARKET IS CALIBRATED SEPARATELY, AND ONLY BECAUSE THE DATA FORCED IT.
//
// Condition 1 (a stated unit count) exists so the rule cannot drop a mixed-use
// filing that is genuinely commercial. In New York it costs almost nothing to
// remove, and everywhere else it is load-bearing. Measured over 484 labelled
// government records, dropping mixed-use-alone admissions REGARDLESS of unit
// count:
//
//   New York City   precision 30 -> 40   recall 97 -> 92    36 noise cut, 2 relevant lost
//   Anaheim         precision 48 -> 47   recall 75 -> 65     3 noise cut, 4 relevant lost
//   Clark County    precision 33 -> 37   recall 68 -> 68     5 noise cut, 0 relevant lost
//   Las Vegas       precision 29 -> 31   recall 92 -> 92     2 noise cut, 0 relevant lost
//
// Anaheim pays for New York's gain and receives nothing: its precision FALLS
// while it loses ten points of recall and four real records. Shipping this
// globally would have been a net improvement on the corpus total (precision
// 42.8 -> 48.4, recall 79.3 -> 76.1) and a straight loss for the market Philip
// works in most. A corpus-wide average is the wrong unit of account when the
// markets are not interchangeable.
//
// WHY THE MARKETS GENUINELY DIFFER. New York's ULURP pipeline is mostly
// residential rezonings, and DCP writes "mixed use" on nearly all of them, so
// the term carries no information there. Anaheim writes "mixed use" inside
// Platinum Triangle and resort-district specific plans, where it describes real
// leisure development.
//
// THIS IS THE ONLY MARKET-SPECIFIC RULE IN THE GATE, and it should stay that
// way unless another market produces numbers this lopsided. A gate with a
// special case per market is not a gate, it is a lookup table, and it stops
// generalising to the market added next.
const UNSCALED_MIXED_USE_MARKETS = new Set(['New York City']);

function isResidentialMixedUse(
  text: string,
  strongHits: string[],
  weakHits: string[],
  market?: string | null
): boolean {
  if (strongHits.length > 0) return false;
  if (weakHits.length === 0) return false;
  if (!weakHits.every((w) => MIXED_USE_ONLY.has(w))) return false;
  if (market && UNSCALED_MIXED_USE_MARKETS.has(market)) return true;
  return RESIDENTIAL_SCALE.test(text);
}

// A CIVIC OR INSTITUTIONAL USE, named as the SUBJECT of the record.
//
// Exported because two different layers need it and they must agree: the gate,
// and the sources that legitimately bypass the gate. SFWMD is the case - its
// ArcGIS query selects on applicant and project NAME ("%REEDY CREEK%"), which
// is a place, so it returns everything sited in the district including Reedy
// Creek Elementary School. A permit record carries no entitlement vocabulary,
// which is exactly why that adapter bypasses the gate, so the gate cannot be
// the thing that catches it.
//
// PHRASES, NOT BARE WORDS, and that is the whole design. 'school' alone matches
// "School Street"; 'church' alone matches St. Paul Community Baptist Church,
// which is the APPLICANT for Baobab Village, a 765-unit mixed-use development.
// The institution has to be the use, not the neighbour and not the sponsor.
//
// Deliberately NOT included: senior and affordable housing. Those are
// residential, and isResidentialMixedUse already handles them on the evidence
// of a unit count rather than on a keyword.
const CIVIC_INSTITUTIONAL = [
  new RegExp('\\b(?:elementary|middle|high|primary|charter|public|nursery|grammar)\\s+school\\b', 'i'),
  new RegExp('\\bschool\\s+(?:district|campus|board)\\b', 'i'),
  new RegExp('\\b(?:day\\s?care|child\\s?care)\\s+(?:centre|center|facility)\\b', 'i'),
  new RegExp('\\b(?:hospital|medical center|medical centre|health clinic|dialysis|nursing home|skilled nursing)\\b', 'i'),
  new RegExp('\\b(?:place|house)\\s+of\\s+worship\\b', 'i'),
  new RegExp('\\b(?:in conjunction with|for)\\s+(?:an?\\s+)?(?:existing\\s+)?(?:church|synagogue|mosque|temple)\\b', 'i'),
  new RegExp('\\b(?:homeless|emergency)\\s+shelter\\b', 'i'),
  new RegExp('\\b(?:correctional facility|detention cent(?:er|re)|county jail)\\b', 'i'),
];

// AN INSTITUTION LISTED AS A COMPONENT IS NOT THE USE. "a mixed-use project
// including residential, retail, community centre, cultural space, and public
// school facilities" is a rezoning that contains a school, not a school. The
// filing signals this itself with a joining word, so the guard reads the words
// immediately before the match rather than guessing from the whole sentence.
const COMPONENT_LEAD = /\b(?:including|includes|plus|with|and|alongside|together with)\s+(?:\w+\s+){0,3}$/i;

/**
 * True when the text names a civic or institutional use as its SUBJECT.
 *
 * False when the institution is merely a component of a larger development or
 * the applicant behind one - those are the two ways a legitimate project
 * mentions an institution, and both were live in the corpus (240 Nassau Street
 * contains school facilities; Baobab Village's applicant is a church).
 */
export function isCivicInstitutional(text: string): boolean {
  for (const re of CIVIC_INSTITUTIONAL) {
    const m = re.exec(text);
    if (!m) continue;
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    if (COMPONENT_LEAD.test(before)) continue;
    return true;
  }
  return false;
}


// ---- A GOVERNANCE INSTRUMENT IS NEVER A PROJECT -----------------------------
//
// A MEETING, A BUDGET ORDINANCE AND A TAX LEVY ARE NOT DEVELOPMENTS, in any
// market, ever. They are the government describing its own procedure, and no
// amount of leisure vocabulary inside one changes what it is.
//
// WHY THIS IS NOT IN GOV_GATE_OUT_OF_VERTICAL, which was the obvious place.
// That list is CONDITIONAL - conclusive only when nothing hospitality-shaped is
// in the record - and measured against the frozen corpus it saved 23 of the 25
// records this class was written to remove, including all three the brief named:
//
//   Yonkers special ordinance   admitted on STRONG 'museum', from
//                               "...FOR THE PURPOSE OF: 1) SNOW AND ICE CONTROL
//                               STREET MAINTENANCE MATERIAL, AND 2) MUSEUM
//                               SPECIAL PROJECTS"
//   Oakland tax levy            admitted on STRONG 'zoo', from
//                               "The 2022 Oakland Zoo Animal Care, Education And
//                               Improvement Ordinance (Measure Y)"
//
// Neither is a leisure filing. Both are a leisure noun inside an enumeration -
// a budget account, a ballot-measure name - which is the same borrowed-context
// failure as "CR (Commercial Resort) Zone", one layer up.
//
// AND A HARD VETO IS WRONG TOO. Measured: a veto that beats STRONG removes 25
// records and takes a real one with it - Westchester's "CBA-RP02A-3248-Ice
// Casino Improvements II", a capital budget amendment for the Playland Ice
// Casino, which is a genuine leisure capital project and is labelled relevant.
//
// SO THE DISCRIMINATOR IS POSITION, and it is the principle the gate already
// uses when it judges an item's own subject rather than the page around it: A
// GOVERNANCE INSTRUMENT NAMES ITS MATTER IN ITS OPENING. A leisure noun in the
// first GOVERNANCE_NAMING_WINDOW characters is what the instrument is ABOUT; one
// further down is an account line, a measure title or an attachment list.
//
//   "CBA-RP02A-3248-Ice Casino Improvements II"   'casino' at char 19  -> kept
//   Yonkers, 'museum' past char 200                                    -> excluded
//   Oakland, 'zoo' past char 300                                       -> excluded
//
// MEASURED BEFORE APPLYING, against the frozen corpus of 7,419 candidates:
// removes 24 of 329 admitted records, precision 54.8% -> 58.4%, and loses
// exactly ONE labelled-relevant record - "Queens Borough Board Meeting on Monday
// May 6, 2024", a meeting agenda carrying Willets Point business terms in its
// body. Its project keeps 11 other filings. That is the whole cost, and it is
// named here rather than discovered later.
//
// Live corpus: 29 records, 21 of them already unclustered. Two projects are
// emptied and both were provisional-named - the Yonkers ordinance and the
// Oakland levy, which is the brief's point exactly.
export const GOVERNANCE_NAMING_WINDOW = 120;

// THE MEETING LIMB IS SUBJECT-SCOPED, and that is load-bearing. San Antonio
// staples "TIF_MIDTOWN TIRZ Board Meeting_8.31.21" into the body of every TIF
// matter, so a term matched anywhere would kill the Encore Multifamily
// calibration probe. A meeting item announces itself on its first line.
const GOVERNANCE_MEETING: RegExp[] = [
  /^\s*(?:[\d.]+\s*)?(?:notice of (?:a )?)?[A-Za-z' ()\/-]{0,50}\b(?:board|commission|council|committee|authority|agency|district)\s+meeting\b/i,
  /^\s*(?:[\d.]+\s*)?(?:special|regular|annual|joint|adjourned)\s+meeting\b/i,
];

// The other two limbs are specific enough to match anywhere. "Amending the
// budget", "transferring funds to and from" and "levying tax" cannot be
// anything but the instrument speaking.
const GOVERNANCE_BUDGET =
  /\b(?:amending|amendment to|amend)\s+the\s+budget\b|\bbudget\s+(?:amendment|transfer|adjustment|modification)\b|\bsupplemental\s+appropriation\b|\btransferring\s+funds\s+to\s+and\s+from\b|\bappropriation\s+ordinance\b/i;

const GOVERNANCE_TAX_LEVY =
  /\blevying\s+(?:the\s+|a\s+|of\s+)?tax(?:es)?\b|\bfixing\s+(?:the\s+)?rate\s+of\s+tax\b|\bcost[-\s]of[-\s]living\s+tax\s+adjustment\b|\btax\s+levy\b|\blevy\s+of\s+taxes\b|\bsetting\s+the\s+tax\s+rate\b/i;

export type GovernanceLimb = 'meeting' | 'budget-ordinance' | 'tax-levy';

/** Which limb the text is, ignoring position. Exported for the audit harness. */
export function governanceLimb(text: string): GovernanceLimb | null {
  const subject = String(text ?? '').split(/\r?\n/)[0] ?? '';
  if (GOVERNANCE_MEETING.some((re) => re.test(subject))) return 'meeting';
  if (GOVERNANCE_BUDGET.test(text)) return 'budget-ordinance';
  if (GOVERNANCE_TAX_LEVY.test(text)) return 'tax-levy';
  return null;
}

/**
 * The limb to exclude on, or null to let the record through.
 *
 * Null when a STRONG term appears in the naming window, because then the
 * instrument is ABOUT that venue: a capital budget amendment for an ice casino
 * is a filing on an ice casino.
 */
export function governanceExclusion(text: string, strongHits: readonly string[]): GovernanceLimb | null {
  const limb = governanceLimb(text);
  if (!limb) return null;
  const head = String(text ?? '').slice(0, GOVERNANCE_NAMING_WINDOW).toLowerCase();
  if (strongHits.some((t) => head.includes(t.toLowerCase()))) return null;
  return limb;
}

export type GateReason =
  | 'strong'
  | 'governance-instrument'
  | 'weak+action'
  | 'deal'
  | 'excluded'
  | 'out-of-vertical'
  | 'weak-without-action'
  | 'deal-detached-residential'
  | 'residential-mixed-use'
  | 'no-match';
export interface GateVerdict {
  matched: boolean;
  reason: GateReason;
  strongHits: string[];
  weakHits: string[];
  actionHits: string[];
  dealHits: string[];
  exclusionHits: string[];
  outOfVerticalHits: string[];
  // Which governance limb fired, when one did. Null otherwise.
  governanceLimb: GovernanceLimb | null;
}

// Two-tier gate verdict for a government record's combined text. Exclusions win
// over any match; a STRONG term matches alone; a WEAK term needs a corroborating
// ACTION term. The hit lists feed gate telemetry (Part F) and audit sampling.
// TWO KINDS OF BORROWED CONTEXT THAT MADE A LEISURE NOUN MEAN NOTHING.
//
// A STRONG term matches alone, so a single misfire admits a record outright.
// Both of these were found by auditing what admitted civic and institutional
// uses, and neither is about institutions - they are general defects that
// happened to surface there.
//
// 1. A ZONING DISTRICT IS NOT A VENUE. Clark County writes "in a CR (Commercial
//    Resort) Zone" on filings for anything sited in that category, so the word
//    "resort" appears on records with no resort in them. It admitted
//    "UC-25-0839-WESTERN PRELACY ARMENIAN APOSTOLIC CHURCH OF LV: USE PERMIT
//    for an office in conjunction with an existing building" as a STRONG resort
//    match. Same failure the 'tirz' term was rejected for: a phrase that is
//    boilerplate carried by every filing in a district.
//
// 2. AN ACCESSORY AMENITY IS NOT THE PROJECT. "approximately 1,800 sf of
//    accessory recreational facility space" inside an affordable seniors
//    building matched STRONG 'recreational facility'. The word "accessory" is
//    the filing itself saying this is subordinate to the main use.
//
// Neutralised BEFORE matching rather than subtracted after, because a record
// may legitimately contain the term twice - once as district boilerplate and
// once as the actual subject - and only removing the boilerplate occurrence
// preserves the real one.
const BORROWED_CONTEXT: RegExp[] = [
  // Zoning district names carrying a leisure noun.
  new RegExp('\\b(?:commercial resort|resort commercial|resort residential)\\b', 'gi'),
  // A strong noun explicitly qualified as accessory or ancillary.
  new RegExp('\\b(?:accessory|ancillary)\\s+(?:\\w+\\s+){0,2}?(?:recreational facility|recreation center|recreation centre|entertainment center|entertainment centre|museum|marina|pier)\\b', 'gi'),
];

/** The text the gate judges, with borrowed-context phrases blanked. */
export function gateReadableText(text: string): string {
  let out = text;
  for (const re of BORROWED_CONTEXT) out = out.replace(re, ' ');
  return out;
}

/**
 * @param market Jurisdiction label, when the caller knows it. Consulted by
 *   exactly one rule (see UNSCALED_MIXED_USE_MARKETS); every other decision in
 *   this function is a pure function of the text, and omitting it only makes
 *   the gate more permissive, never wrong in a new way.
 */
export function governmentGate(raw: string, market?: string | null): GateVerdict {
  const text = gateReadableText(raw);
  const strongHits = GOV_GATE_STRONG.filter((t) => hasWord(text, t));
  const weakHits = GOV_GATE_WEAK.filter((t) => hasWord(text, t));
  const actionHits = GOV_GATE_ACTION.filter((t) => hasWord(text, t));
  const dealHits = GOV_GATE_DEAL.filter((t) => hasWord(text, t));
  const exclusionHits = GOV_GATE_EXCLUSIONS.filter((t) => hasWord(text, t));
  const outOfVerticalHits = GOV_GATE_OUT_OF_VERTICAL.filter((t) => hasWord(text, t));
  // Judged on the RAW text, not the neutralised one: the naming window is about
  // where a word sits in the item as written, and blanking a phrase would move
  // every later character.
  const govLimb = governanceExclusion(raw, strongHits);
  const hits = {
    strongHits,
    weakHits,
    actionHits,
    dealHits,
    exclusionHits,
    outOfVerticalHits,
    governanceLimb: govLimb,
  };

  if (exclusionHits.length > 0) {
    return { matched: false, reason: 'excluded', ...hits };
  }
  // ABOVE STRONG, DELIBERATELY, AND ONLY BECAUSE OF THE NAMING WINDOW. See
  // governanceExclusion: a strong term inside the window has already returned
  // null, so this can only fire when the leisure noun is somewhere the
  // instrument merely lists it.
  if (govLimb) {
    return { matched: false, reason: 'governance-instrument', ...hits };
  }
  if (strongHits.length > 0) {
    return { matched: true, reason: 'strong', ...hits };
  }
  // Out of the vertical, and no leisure noun anywhere to argue otherwise.
  if (outOfVerticalHits.length > 0) {
    return { matched: false, reason: 'out-of-vertical', ...hits };
  }
  if (isResidentialMixedUse(text, [...strongHits], [...weakHits], market)) {
    return { matched: false, reason: 'residential-mixed-use', ...hits };
  }
  if (weakHits.length > 0 && actionHits.length > 0) {
    return { matched: true, reason: 'weak+action', ...hits };
  }
  // THE DEAL TIER, placed here deliberately. It sits BELOW exclusions and below
  // the residential-mixed-use refinement, so it can never resurrect a record
  // those two rejected, and ABOVE weak-without-action, so a deal term rescues a
  // record that has a weak signal but no entitlement vocabulary to corroborate
  // it - which is precisely the Weston Urban case ('redevelopment' weak, no
  // action term, a master economic incentive agreement as its whole subject).
  if (dealHits.length > 0) {
    if (isDetachedResidential(text)) {
      return { matched: false, reason: 'deal-detached-residential', ...hits };
    }
    return { matched: true, reason: 'deal', ...hits };
  }
  if (weakHits.length > 0) {
    return { matched: false, reason: 'weak-without-action', ...hits };
  }
  return { matched: false, reason: 'no-match', ...hits };
}

// ---- PROJECT EVENT VOCABULARY -----------------------------------------------
//
// The register's memory of change (migration 020, agents/scraper/project-events).
// Fixed here, alongside the other closed vocabularies, for the same reason those
// are: a set of strings that a writer and three readers must agree on is a
// vocabulary, and a vocabulary invented at each call site drifts within a month.
//
// Two rules govern what belongs here:
//
//   AN EVENT IS SOMETHING THAT HAPPENED TO A PROJECT, not something that is true
//   of it. "stage_changed" is an event; "stage" is a column. If the answer can
//   be read off the projects table, it is not an event.
//
//   AN EVENT IS APPEND-ONLY AND THEREFORE PERMANENT. Adding a type is cheap;
//   changing what one MEANS is not, because rows already written under the old
//   meaning cannot be revised. Prefer a new type to redefining an old one.
export const PROJECT_EVENT_TYPES = [
  // The project appeared in the register.
  'project_created',
  // Its stage moved. from_value and to_value carry the ladder positions, and
  // this is the only event the What Moved query reads.
  'stage_changed',
  // A record joined or left. lead_id carries which one, so "approved by this
  // filing" is answerable rather than merely "approved on this date".
  'record_attached',
  'record_detached',
  // An applicant or representative was learned, or replaced. Feeds the company
  // register once migration 022 is applied.
  'party_identified',
  // A future dated commitment appeared (a hearing, a deadline).
  'milestone_set',
  // Curation, all actor 'philip'.
  'watch_added',
  'watch_removed',
  'renamed',
  'status_changed',
  'note_added',
  // Structural corrections, reserved: emitted by hand-run repairs rather than by
  // the clusterer, which never merges or splits a project as a discrete act - it
  // recomputes the whole partition.
  'merged',
  'split',
] as const;

export type ProjectEventType = (typeof PROJECT_EVENT_TYPES)[number];

export function isProjectEventType(s: string): s is ProjectEventType {
  return (PROJECT_EVENT_TYPES as readonly string[]).includes(s);
}

// WHO DID IT. 'system' is any automated path - the clusterer, the backfill, an
// adapter. 'philip' is a hand decision made in the dashboard.
//
// This distinction cannot be reconstructed later, which is why it is a required
// column rather than something inferred from the event type. A year from now,
// "approved" because the clusterer read a staff report and "approved" because
// Philip decided it look identical without it, and only one of those is
// evidence. Several types can legitimately carry either actor: a stage change is
// usually the clusterer and sometimes a manual override.
export const EVENT_ACTORS = ['system', 'philip'] as const;
export type EventActor = (typeof EVENT_ACTORS)[number];

// ---- COMPANY ROLE VOCABULARY ------------------------------------------------
//
// For migration 022 (companies / company_projects). Role lives on the LINK, not
// on the company: the same firm is the applicant on one project and the
// representative on another, so a type on the company row would force one answer
// for both.
export const COMPANY_ROLES = [
  'owner',
  'applicant',
  'representative',
  'architect',
  'presenter',
  'agent',
] as const;

export type CompanyRole = (typeof COMPANY_ROLES)[number];
