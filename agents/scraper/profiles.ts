// Industry profile config for the scraper engine.
//
// Each profile pairs relevance keywords with the sources to pull from, a scoring
// floor, and a module tag. The orchestrator runs only profiles whose `active`
// flag is true, fetches their `sources`, and tags every surviving lead with the
// profile `module` and `name` (industry).
//
// Prefilter threshold is per-profile via `minKeywordMatches` (default 3 when
// absent). All profiles run at 1: the keyword lists below mix domain phrases
// with common single-word terms so a single hit lets a lead through to Haiku,
// which is the real relevance gate. This keeps genuine tenders (whose wording
// rarely contains three narrow phrases) from being filtered out for free.

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

// Source groupings. Tender portals + job boards (broadest reach), tender portals
// only, and job boards only.
const TENDER_AND_JOB = [
  'canadabuys',
  'adzuna',
  'jooble',
  'reed',
  'careerjet',
  'arbeitnow',
  'samgov',
  'tedeu',
  'austender',
  'uktenders',
  'thailandgpp',
  'gebiz',
  'ungm',
];
const TENDER_SOURCES = [
  'canadabuys',
  'samgov',
  'tedeu',
  'austender',
  'uktenders',
  'thailandgpp',
  'gebiz',
  'ungm',
];
const JOB_SOURCES = ['adzuna', 'jooble', 'reed', 'careerjet', 'arbeitnow'];

export const PROFILES: IndustryProfile[] = [
  {
    name: 'healthcare_pharma',
    keywords: [
      'GMP',
      'Health Canada',
      'NAPRA',
      'FDA',
      'regulatory submission',
      'regulatory',
      'pharmaceutical',
      'pharma',
      'medical device',
      'ISO 13485',
      'quality assurance',
      'clinical',
      'natural health products',
      'nutraceutical',
      'biotech',
      'validation',
      'compliance',
    ],
    excludeKeywords: [],
    sources: TENDER_AND_JOB,
    minScore: 60,
    module: 'healthcare_pharma',
    active: true,
    minKeywordMatches: 1,
  },
  {
    name: 'cannabis',
    keywords: [
      'cannabis compliance',
      'licensed producer',
      'ACMPR',
      'Health Canada cannabis',
      'quality management cannabis',
      'cannabis',
      'cultivation',
      'dispensary',
    ],
    excludeKeywords: [],
    sources: ['canadabuys', 'adzuna', 'jooble', 'careerjet', 'arbeitnow', 'ungm'],
    minScore: 60,
    module: 'cannabis',
    active: true,
    minKeywordMatches: 1,
  },
  {
    name: 'technology_ai',
    keywords: [
      'AI implementation',
      'AI',
      'artificial intelligence',
      'automation',
      'digital transformation',
      'digital',
      'technology strategy',
      'AI governance',
      'machine learning',
      'process automation',
      'software',
      'analytics',
    ],
    excludeKeywords: [],
    sources: TENDER_AND_JOB,
    minScore: 60,
    module: 'technology_ai',
    active: true,
    minKeywordMatches: 1,
  },
  {
    name: 'construction_infrastructure',
    keywords: [
      'project management',
      'quality control',
      'ISO 9001',
      'standards compliance',
      'standards',
      'feasibility study',
      'feasibility',
      'infrastructure',
      'engineering',
    ],
    excludeKeywords: [],
    sources: TENDER_SOURCES,
    minScore: 60,
    module: 'construction_infrastructure',
    active: true,
    minKeywordMatches: 1,
  },
  {
    name: 'financial_services',
    keywords: [
      'regulatory compliance',
      'compliance',
      'risk management',
      'risk',
      'audit',
      'governance',
      'AML',
      'fintech compliance',
      'fintech',
      'KYC',
      'financial',
    ],
    excludeKeywords: [],
    sources: TENDER_AND_JOB,
    minScore: 60,
    module: 'financial_services',
    active: true,
    minKeywordMatches: 1,
  },
  {
    name: 'food_beverage_hospitality',
    keywords: [
      'feasibility study',
      'feasibility',
      'F&B',
      'food safety',
      'food',
      'HACCP',
      'hospitality',
      'amusement',
      'leisure',
      'restaurant concept',
      'restaurant',
      'catering',
      'tourism',
      'market study',
    ],
    excludeKeywords: [],
    sources: TENDER_AND_JOB,
    minScore: 60,
    module: 'food_beverage_hospitality',
    active: true,
    minKeywordMatches: 1,
  },
  {
    name: 'web_digital',
    keywords: [
      'website',
      'web design',
      'web development',
      'web',
      'digital presence',
      'digital',
      'SEO',
      'redesign',
      'no website',
      'ecommerce',
      'marketing',
      'branding',
    ],
    excludeKeywords: [],
    sources: JOB_SOURCES,
    minScore: 60,
    module: 'web_digital',
    active: true,
    minKeywordMatches: 1,
  },
  {
    name: 'general_consulting',
    keywords: [
      'strategy',
      'strategic',
      'market entry',
      'business development',
      'advisory',
      'consulting',
      'consultant',
      'fractional',
      'interim',
      'transformation',
      'feasibility',
    ],
    excludeKeywords: [],
    sources: TENDER_AND_JOB,
    minScore: 60,
    module: 'general_consulting',
    active: true,
    minKeywordMatches: 1,
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
      'diesel',
      'gasoline',
      'petroleum',
      'kerosene',
      'jet fuel',
      'marine fuel',
      'natural gas',
      'fuel oil',
      'fuel supply',
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
    sources: TENDER_SOURCES,
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
