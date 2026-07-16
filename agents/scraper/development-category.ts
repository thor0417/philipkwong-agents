// Development-category classification for GLI leads (scraper side).
//
// GLI is NOT leisure-only. Development opportunity spans the full spectrum: smart
// cities, mixed-use megaprojects, transit-oriented development, waterfront and
// downtown redevelopment, convention and sports districts, master-planned
// communities, infrastructure, plus leisure and attractions. Nothing is discarded
// for being non-leisure; every GLI lead is CATEGORIZED and written with a
// development_category. First matching rule wins; Other is the never-drop
// fallback. This mirrors the dashboard classifier (dashboard/lib/gli-category.ts);
// keep the two keyword sets in sync.

export const DEVELOPMENT_CATEGORIES = [
  'Leisure/Attractions',
  'Smart City/Urban',
  'Mixed-Use/Real Estate',
  'Infrastructure',
  'Hospitality/Tourism',
  'Other/Uncategorized',
] as const;

export type DevelopmentCategory = (typeof DEVELOPMENT_CATEGORIES)[number];

// Ordered rules (first match wins). Leisure venue terms are the most specific, so
// they lead; the broad hospitality terms come last before Other so they do not
// swallow a smart-city or infrastructure record that also mentions a hotel.
const RULES: { category: DevelopmentCategory; keywords: string[] }[] = [
  {
    category: 'Leisure/Attractions',
    keywords: [
      'theme park', 'water park', 'waterpark', 'amusement', 'zoo', 'aquarium',
      'museum', 'casino', 'gaming', 'integrated resort', 'resort', 'family entertainment',
      'fec', 'science center', 'science centre', 'heritage', 'attraction', 'ski resort',
    ],
  },
  {
    category: 'Smart City/Urban',
    keywords: [
      'smart city', 'master-planned community', 'master planned community',
      'master-planned', 'urban regeneration', 'urban renewal', 'transit-oriented',
      'transit oriented', 'giga-project', 'gigaproject', 'new city',
    ],
  },
  {
    category: 'Infrastructure',
    keywords: [
      'convention center', 'convention centre', 'arena', 'stadium', 'transit hub',
      'airport city', 'exhibition center', 'exhibition centre', 'congress center',
      'congress centre', 'sports district',
    ],
  },
  {
    category: 'Mixed-Use/Real Estate',
    keywords: [
      'mixed-use', 'mixed use', 'downtown redevelopment', 'waterfront redevelopment',
      'waterfront development', 'waterfront', 'redevelopment', 'entertainment district',
      'real estate', 'rezoning', 'land use', 'development agreement', 'entitlement',
    ],
  },
  {
    category: 'Hospitality/Tourism',
    keywords: [
      'hotel', 'conference', 'tourism', 'tourist', 'destination', 'hospitality', 'lodging',
    ],
  },
];

// Whole-word, case-insensitive match so short tokens (fec, arena) do not match
// inside unrelated words.
function hasWord(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

// The development category for a GLI lead, from its title, content, and (tagged)
// venue_type. Never null: unmatched leads are Other/Uncategorized, never dropped.
export function developmentCategory(
  title: string | null,
  rawContent: string | null,
  venueType: string | null
): DevelopmentCategory {
  const text = `${title ?? ''}\n${rawContent ?? ''}\n${venueType ?? ''}`;
  for (const rule of RULES) {
    if (rule.keywords.some((k) => hasWord(text, k))) return rule.category;
  }
  return 'Other/Uncategorized';
}
