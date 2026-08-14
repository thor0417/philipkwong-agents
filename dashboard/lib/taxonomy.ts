// CANONICAL GLI TAXONOMY (dashboard mirror of the root lib/taxonomy.ts). The
// single source of truth for venue_type, development_category, and (reserved for
// Pass 4) source_type. Every dashboard consumer imports from here: filters, chip
// counts, archive view, and export. Do NOT redefine, rename, merge, or invent
// values elsewhere. These lists are law; no future pass edits them without an
// explicit instruction.
//
// A GLI lead has exactly ONE venue_type and ONE development_category, and the
// category is DERIVED from the venue via VENUE_TO_CATEGORY, so the two can never
// drift apart. "Entertainment Destination" is a named type, never a bucket; an
// correct, never as catch-alls.
//
// This mirrors the root lib/taxonomy.ts (the dashboard is a separate package and
// cannot import it). Keep the two in exact sync; the root file is the authority.

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
  // Fallback
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

export function categoryForVenue(venue: string | null | undefined): DevelopmentCategory {
  return (venue && VENUE_TO_CATEGORY[venue as VenueType]) || 'Other';
}

// ---- Reserved for Pass 4 (import and extend; do NOT define parallels). ----
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

// Player fields are DATA fields, not categories: null when absent, never fabricated.
export const PLAYER_FIELDS = ['presented_by', 'applicant', 'representative', 'action_sought'] as const;
export const PRIMARY_DOCUMENT_FIELDS = ['primary_document_url', 'has_primary_document'] as const;

// ---- PROJECT STAGE (mirrors lib/taxonomy.ts in the agent runtime) ------------
// Stage is a PROJECT attribute derived from its most advanced record, and it is
// manually overridable. The derivation itself lives in the agent runtime; the
// dashboard needs only the vocabulary and the display order.
//
// The first six are the advancement LADDER, in order. 'stalled' and 'dormant'
// are states a project falls into rather than rungs it climbs, so they sort last
// and read as conditions in the register.
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

export const STAGE_LADDER = PROJECT_STAGES.slice(0, 6) as readonly ProjectStage[];

export function isLadderStage(stage: string | null | undefined): boolean {
  return Boolean(stage && (STAGE_LADDER as readonly string[]).includes(stage));
}
