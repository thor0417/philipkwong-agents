// Industry profile config for the scraper engine.
//
// Each profile pairs a set of relevance keywords with the sources to pull from,
// a scoring floor, and a module tag. The orchestrator runs only profiles whose
// `active` flag is true, fetches their `sources`, and tags every surviving lead
// with the profile `module` and `name` (industry).
//
// Prefilter threshold is per-profile via `minKeywordMatches` (default 3 when
// absent). The fuel profile drops to 1 because fuel tenders are terse and also
// gated by the broker-noise filter and by HS/CPV procurement codes.

export interface IndustryProfile {
  // Stored on each lead as `industry`.
  name: string;
  keywords: string[];
  // Hard-exclude terms. Any match disqualifies the lead before scoring.
  excludeKeywords: string[];
  // Source ids (see sources/) this profile pulls from.
  sources: string[];
  // Haiku score floor for writing the lead to Supabase.
  minScore: number;
  // Stored on each lead as `module`.
  module: string;
  active: boolean;
  // Prefilter keyword-match threshold. Defaults to 3 when omitted.
  minKeywordMatches?: number;
  // Fuel only: HS commodity codes for code-driven tender matching.
  hsCodes?: string[];
  // CPV procurement codes passed to code-aware tender sources (e.g. TED EU).
  cpvCodes?: string[];
}

export const PROFILES: IndustryProfile[] = [
  {
    name: 'healthcare_pharma',
    keywords: [
      'GMP',
      'Health Canada',
      'NAPRA',
      'FDA',
      'regulatory submission',
      'pharmaceutical',
      'medical device',
      'ISO 13485',
      'quality assurance',
      'clinical',
      'natural health products',
      'nutraceutical',
    ],
    excludeKeywords: [],
    sources: ['canadabuys', 'adzuna', 'jooble', 'reed', 'careerjet', 'arbeitnow', 'samgov', 'tedeu', 'austender', 'uktenders'],
    minScore: 60,
    module: 'healthcare_pharma',
    active: true,
  },
  {
    name: 'cannabis',
    keywords: [
      'cannabis compliance',
      'licensed producer',
      'ACMPR',
      'Health Canada cannabis',
      'quality management cannabis',
    ],
    excludeKeywords: [],
    sources: ['canadabuys', 'adzuna', 'jooble', 'careerjet', 'arbeitnow'],
    minScore: 60,
    module: 'cannabis',
    active: true,
  },
  {
    name: 'technology_ai',
    keywords: [
      'AI implementation',
      'automation',
      'digital transformation',
      'technology strategy',
      'AI governance',
      'machine learning',
      'process automation',
    ],
    excludeKeywords: [],
    sources: ['canadabuys', 'adzuna', 'jooble', 'reed', 'careerjet', 'arbeitnow', 'samgov', 'tedeu', 'austender', 'uktenders'],
    minScore: 60,
    module: 'technology_ai',
    active: true,
  },
  {
    name: 'construction_infrastructure',
    keywords: [
      'project management',
      'quality control',
      'ISO 9001',
      'standards compliance',
      'feasibility study',
      'infrastructure',
    ],
    excludeKeywords: [],
    sources: ['canadabuys', 'samgov', 'tedeu', 'austender', 'uktenders'],
    minScore: 60,
    module: 'construction_infrastructure',
    active: true,
  },
  {
    name: 'financial_services',
    keywords: [
      'regulatory compliance',
      'risk management',
      'audit',
      'governance',
      'AML',
      'fintech compliance',
      'KYC',
    ],
    excludeKeywords: [],
    sources: ['canadabuys', 'adzuna', 'jooble', 'reed', 'careerjet', 'arbeitnow', 'samgov', 'tedeu', 'austender', 'uktenders'],
    minScore: 60,
    module: 'financial_services',
    active: true,
  },
  {
    name: 'food_beverage_hospitality',
    keywords: [
      'feasibility study',
      'F&B',
      'food safety',
      'HACCP',
      'hospitality',
      'amusement',
      'leisure',
      'restaurant concept',
      'market study',
    ],
    excludeKeywords: [],
    sources: ['canadabuys', 'adzuna', 'jooble', 'reed', 'careerjet', 'arbeitnow', 'samgov', 'tedeu', 'austender', 'uktenders'],
    minScore: 60,
    module: 'food_beverage_hospitality',
    active: true,
  },
  {
    name: 'web_digital',
    keywords: [
      'website',
      'web design',
      'digital presence',
      'SEO',
      'redesign',
      'no website',
      'web development',
    ],
    excludeKeywords: [],
    sources: ['adzuna', 'jooble', 'reed', 'careerjet', 'arbeitnow'],
    minScore: 60,
    module: 'web_digital',
    active: true,
  },
  {
    name: 'general_consulting',
    keywords: [
      'strategy',
      'market entry',
      'business development',
      'advisory',
      'fractional',
      'interim',
      'transformation',
    ],
    excludeKeywords: [],
    sources: ['canadabuys', 'adzuna', 'jooble', 'reed', 'careerjet', 'arbeitnow', 'samgov', 'tedeu', 'austender', 'uktenders'],
    minScore: 60,
    module: 'general_consulting',
    active: true,
  },
  {
    name: 'fuel_tenders',
    keywords: [
      'diesel supply',
      'bunker fuel',
      'fuel tender',
      'gasoline procurement',
      'aviation fuel',
      'petroleum supply',
      'fuel management',
      'bulk fuel',
    ],
    excludeKeywords: [
      'ICPO',
      'LOI',
      'BCL',
      'SBLC',
      'FCO',
      'soft corporate offer',
      'ready willing and able',
      'mandate',
      'tank-to-tank',
      'TTT',
      'TTO',
      'dip and pay',
      'Rotterdam allocation',
      'performance bond',
    ],
    sources: ['canadabuys', 'samgov', 'tedeu', 'austender', 'uktenders'],
    minScore: 60,
    module: 'fuel_tenders',
    active: true,
    minKeywordMatches: 1,
    hsCodes: ['2709', '2710', '271012', '271019'],
    cpvCodes: ['09100000', '09130000', '09132000', '09134000'],
  },
];

// Consulting CPV codes for code-aware tender sources (TED EU) when running
// under non-fuel profiles. Management consulting, business/strategy advisory,
// regulatory, quality, and feasibility services.
export const CONSULTING_CPV_CODES = [
  '79000000', // Business services
  '79400000', // Business and management consultancy and related services
  '79410000', // Business and management consultancy services
  '79411000', // General management consultancy services
  '71600000', // Technical testing, analysis and consultancy services
  '73000000', // Research and development services and related consultancy
  '85100000', // Health services
];

export function activeProfiles(): IndustryProfile[] {
  return PROFILES.filter((p) => p.active);
}

// Union of source ids referenced by all active profiles.
export function activeSources(): string[] {
  const set = new Set<string>();
  for (const p of activeProfiles()) {
    for (const s of p.sources) set.add(s);
  }
  return [...set];
}
