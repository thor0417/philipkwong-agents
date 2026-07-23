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

function hasWord(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
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
export const GOV_GATE_WEAK = [
  'hotel', 'motel', 'spa', 'golf', 'waterfront', 'redevelopment', 'hospitality',
  'tourism', 'gaming', 'entertainment', 'recreation',
  'master plan', 'masterplan', 'mixed use', 'mixed-use',
] as const;

export const GOV_GATE_ACTION = [
  'use permit', 'special use permit', 'conditional use', 'zone change', 'rezoning',
  'zoning application', 'plan amendment', 'plat', 'tentative map', 'site plan',
  'design review', 'variance', 'waiver of development standards',
  'development agreement', 'disposition and development agreement', 'ground lease',
  'entitlement', 'land use', 'tax increment', 'TIF', 'feasibility',
  'request for proposals', 'liquor license',
] as const;

export const GOV_GATE_EXCLUSIONS = [
  'adult entertainment', 'proclamation', 'appointment', 'reappointment',
  'employment agreement', 'personnel', 'retirement', 'condolence', 'commendation',
] as const;

export type GateReason = 'strong' | 'weak+action' | 'excluded' | 'weak-without-action' | 'no-match';
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
  if (weakHits.length > 0 && actionHits.length > 0) {
    return { matched: true, reason: 'weak+action', strongHits, weakHits, actionHits, exclusionHits };
  }
  if (weakHits.length > 0) {
    return { matched: false, reason: 'weak-without-action', strongHits, weakHits, actionHits, exclusionHits };
  }
  return { matched: false, reason: 'no-match', strongHits, weakHits, actionHits, exclusionHits };
}
