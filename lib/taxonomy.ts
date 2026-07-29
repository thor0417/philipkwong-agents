// CANONICAL GLI TAXONOMY. The single source of truth for venue_type,
// development_category, and (reserved for Pass 4) source_type. Every consumer
// imports from here: scraper tagging, the re-tag backfill, and (mirrored) the
// dashboard. Do NOT redefine, rename, merge, or invent values elsewhere. These
// lists are law; no future pass edits them without an explicit instruction.
//
// A GLI lead has exactly ONE venue_type and ONE development_category, and the
// category is DERIVED from the venue via VENUE_TO_CATEGORY, so the two can never
// drift apart. Distinct venue types are never collapsed into a catch-all;
// "Leisure Destination" and "Other" are used only when genuinely correct.
//
// NOTE ON THE TWO-PACKAGE REPO: the dashboard is a separate Next.js project and
// cannot import this root module, so dashboard/lib/taxonomy.ts mirrors it exactly.
// Keep the two in sync; this file is the authority.

export const VENUE_TYPES = [
  // Leisure and Attractions
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
  // Fallback (genuine broad leisure destination / nothing else fits)
  'Leisure Destination',
  'Other',
] as const;

export type VenueType = (typeof VENUE_TYPES)[number];

export const DEVELOPMENT_CATEGORIES = [
  'Leisure/Attractions',
  'Smart City/Urban',
  'Mixed-Use/Real Estate',
  'Infrastructure',
  'Hospitality/Tourism',
  'Other',
] as const;

export type DevelopmentCategory = (typeof DEVELOPMENT_CATEGORIES)[number];

// Each venue_type maps to exactly one development_category.
export const VENUE_TO_CATEGORY: Record<VenueType, DevelopmentCategory> = {
  'Theme Park': 'Leisure/Attractions',
  'Amusement Park': 'Leisure/Attractions',
  Waterpark: 'Leisure/Attractions',
  'Family Entertainment Center': 'Leisure/Attractions',
  Zoo: 'Leisure/Attractions',
  Aquarium: 'Leisure/Attractions',
  Museum: 'Leisure/Attractions',
  'Science Center': 'Leisure/Attractions',
  'Heritage/Cultural Site': 'Leisure/Attractions',
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
  'Leisure Destination': 'Leisure/Attractions',
  Other: 'Other',
};

export function categoryForVenue(venue: string | null | undefined): DevelopmentCategory {
  return (venue && VENUE_TO_CATEGORY[venue as VenueType]) || 'Other';
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
  { venue: 'Waterpark', keywords: ['waterpark', 'water park'] },
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
  { venue: 'Hotel', keywords: ['hotel', 'lodging', 'hospitality'] },
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
  { venue: 'Leisure Destination', keywords: ['leisure', 'tourism', 'tourist', 'destination', 'visitor attraction', 'attraction', 'marina', 'golf', 'spa', 'recreation'] },
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

function hasWord(text: string, keyword: string): boolean {
  if (wholeWord(text, keyword)) return true;
  const foldedKeyword = foldPunctuation(keyword);
  if (!foldedKeyword) return false;
  return wholeWord(foldPunctuation(text), foldedKeyword);
}

// The canonical venue_type for a lead, from its title + content (+ any existing
// venue hint). Never collapses a distinct venue: a keyword for a specific venue
// wins over the broad Leisure Destination fallback. Returns 'Other' only when
// nothing matches.
export function classifyVenueType(text: string): VenueType {
  for (const rule of VENUE_RULES) {
    if (rule.keywords.some((k) => hasWord(text, k))) return rule.venue;
  }
  return 'Other';
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
] as const;

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

// GOVERNANCE NOISE. These override any match, so every term here must name an
// item's SUBJECT and must not appear as agenda boilerplate inside a real item.
// The second group came out of a 30-record precision sample: labour
// negotiations, legal-counsel conferences, and council recognition items were
// passing on STRONG terms printed elsewhere on the page, never in the item's own
// subject.
//
// 'closed session', 'closed meeting', 'public comment period', 'ceremonial' and
// 'minutes of the meeting' were tried here and REMOVED. Because exclusions
// override, and because the agenda lanes gate on an item excerpt that carries
// the meeting's standing boilerplate, those five killed real records: a
// development-application withdrawal notice, an Anaheim resort-district
// resolution, and two assessment-district hearings all died on boilerplate that
// had nothing to do with their subject. Precision bought there costs recall
// somewhere worse.
export const GOV_GATE_EXCLUSIONS = [
  'adult entertainment', 'proclamation', 'appointment', 'reappointment',
  'employment agreement', 'personnel', 'retirement', 'condolence', 'commendation',
  'labor negotiator', 'labour negotiator', 'conference with legal counsel',
  'conference with labor', 'council member recognition',
] as const;

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
const RESIDENTIAL_SCALE = /\b\d{1,4}[-\s]?(?:unit|units|dwelling units|apartments|condominium units|residential units)\b|\bmultifamily\b|\bmulti-family\b/i;
const MIXED_USE_ONLY = new Set<string>(['mixed use', 'mixed-use']);

function isResidentialMixedUse(text: string, strongHits: string[], weakHits: string[]): boolean {
  if (strongHits.length > 0) return false;
  if (weakHits.length === 0) return false;
  if (!weakHits.every((w) => MIXED_USE_ONLY.has(w))) return false;
  return RESIDENTIAL_SCALE.test(text);
}

export type GateReason =
  | 'strong'
  | 'weak+action'
  | 'excluded'
  | 'weak-without-action'
  | 'residential-mixed-use'
  | 'no-match';
export interface GateVerdict {
  matched: boolean;
  reason: GateReason;
  strongHits: string[];
  weakHits: string[];
  actionHits: string[];
  exclusionHits: string[];
}

// Two-tier gate verdict for a government record's combined text. Exclusions win
// over any match; a STRONG term matches alone; a WEAK term needs a corroborating
// ACTION term. The hit lists feed gate telemetry (Part F) and audit sampling.
export function governmentGate(text: string): GateVerdict {
  const strongHits = GOV_GATE_STRONG.filter((t) => hasWord(text, t));
  const weakHits = GOV_GATE_WEAK.filter((t) => hasWord(text, t));
  const actionHits = GOV_GATE_ACTION.filter((t) => hasWord(text, t));
  const exclusionHits = GOV_GATE_EXCLUSIONS.filter((t) => hasWord(text, t));

  if (exclusionHits.length > 0) {
    return { matched: false, reason: 'excluded', strongHits, weakHits, actionHits, exclusionHits };
  }
  if (strongHits.length > 0) {
    return { matched: true, reason: 'strong', strongHits, weakHits, actionHits, exclusionHits };
  }
  if (isResidentialMixedUse(text, [...strongHits], [...weakHits])) {
    return { matched: false, reason: 'residential-mixed-use', strongHits, weakHits, actionHits, exclusionHits };
  }
  if (weakHits.length > 0 && actionHits.length > 0) {
    return { matched: true, reason: 'weak+action', strongHits, weakHits, actionHits, exclusionHits };
  }
  if (weakHits.length > 0) {
    return { matched: false, reason: 'weak-without-action', strongHits, weakHits, actionHits, exclusionHits };
  }
  return { matched: false, reason: 'no-match', strongHits, weakHits, actionHits, exclusionHits };
}
