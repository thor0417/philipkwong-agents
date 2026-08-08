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
