// Industry profile config for the scraper engine.
//
// Each profile pairs relevance keywords with the sources to pull from, a scoring
// floor, and a module tag. The orchestrator runs only profiles whose `active`
// flag is true, fetches their `sources`, and tags every surviving lead with the
// profile `module` and `name` (industry).
//
// Prefilter threshold is per-profile via `minKeywordMatches` (default 3 when
// absent). The keyword lists mix domain phrases with common single-word terms.
//
// Profiles whose genuine leads turn on one strong domain term (fuel, cannabis,
// healthcare_pharma, financial_services, technology_ai) run at 1: a single hit
// lets a lead through to Haiku, the real relevance gate. Real writers in these
// profiles frequently match only one keyword (e.g. a regulatory advisory tender
// matching just "regulatory"), so raising them would drop real leads.
//
// The broad, generic catch-all profiles (general_consulting,
// construction_infrastructure, food_beverage_hospitality, web_digital) run at 2:
// their single-word terms (strategy, consulting, infrastructure, food, web,
// digital, marketing) light up on generic job-board noise, so they require two
// hits before paying for a Haiku call. Genuine leads in these areas almost
// always carry two or more of the terms.

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
  // Code systems by family, routed by source: CPV is European (TED / TenderNed
  // only), UNSPSC is for Singapore (GeBIZ) and UNGM, HS is customs (phase 2,
  // unused), NAICS is US (SAM.gov / Texas ESBD; descriptive for now). Never send
  // CPV to GeBIZ or any non-European source.
  tscodes?: { cpv?: string[]; unspsc?: string[]; hs?: string[]; naics?: string[] };
  // ISO region codes this profile targets (e.g. ['NL', 'SG']).
  regions?: string[];
  // Search terms for query-driven sources (Google CSE / GLI lane). Each term is
  // run as its own search. Ignored by keyword/CPV sources.
  queries?: string[];
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
  'jsearch',
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
const JOB_SOURCES = ['adzuna', 'jooble', 'reed', 'careerjet', 'arbeitnow', 'jsearch'];

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
    // Generic catch-all: require two hits to cut job-board noise (no real
    // writers; "infrastructure"/"engineering"/"standards" alone are too broad).
    minKeywordMatches: 2,
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
    // Generic catch-all: require two hits ("food"/"tourism"/"restaurant" alone
    // match unrelated postings).
    minKeywordMatches: 2,
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
    // Generic catch-all: require two hits ("web"/"digital"/"marketing" alone
    // are pervasive on job boards).
    minKeywordMatches: 2,
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
      // Feasibility + advisory vocabulary. Development banks and UN agencies
      // post this work heavily; without it their RFPs never clear the prefilter.
      'feasibility',
      'feasibility study',
      'prefeasibility',
      'pre-feasibility',
      'techno-economic study',
      'viability study',
      'viability assessment',
      'business case',
      'bankable feasibility',
      'market assessment',
      'market study',
      'technical assistance',
      'terms of reference',
      'expression of interest',
      'request for proposal',
      'advisory services',
      'due diligence',
      'options appraisal',
      'scoping study',
      'needs assessment',
      'situational analysis',
    ],
    excludeKeywords: [],
    // Development bank + UN consulting portals added alongside the shared
    // tender/job sources: they carry the heaviest feasibility/advisory RFP flow.
    sources: [...TENDER_AND_JOB, 'worldbank', 'adb', 'afdb', 'undp', 'iadb', 'cdb'],
    minScore: 60,
    module: 'general_consulting',
    active: true,
    // Broadest catch-all and the single largest noise source: require two hits
    // ("strategy"/"consulting"/"advisory"/"transformation" alone match almost
    // any white-collar posting). No real writers depend on it.
    minKeywordMatches: 2,
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
      // Cargo-scale demand (bulk import / vessel lots): the experiment bucket.
      // Fuel-specific cargo terms only. The broad terms (cargo, vessel, MT) were
      // dropped because they captured non-fuel logistics tenders (cargo
      // trailers, ship refits, vessel charters).
      'metric tonnes',
      'CIF',
      'FOB',
      'bulk supply',
      'import of diesel',
      'import of jet',
      'gasoil cargo',
      'bulk fuel import',
      'tender for supply and delivery',
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
    // TenderNed (NL) added alongside the shared tender sources for Rotterdam.
    sources: [...TENDER_SOURCES, 'tenderned'],
    // Lower than the consulting floor: Haiku scores fuel-supply procurement
    // modestly (Philip advises buyers, he is not the supplier), so 40 captures
    // genuine fuel tenders for the cross-reference pass while broker noise is
    // already removed upstream by the broker-filter.
    minScore: 40,
    module: 'fuel',
    active: true,
    minKeywordMatches: 1,
    regions: ['NL', 'SG'],
    tscodes: {
      // CPV: Rotterdam (TED / TenderNed) only.
      cpv: ['09100000', '09130000', '09131000', '09132000', '09134000', '09134100', '09134200'],
      // UNSPSC: Singapore (GeBIZ) and UNGM.
      unspsc: ['15100000', '15101500', '15101505', '15101506', '15101508', '15101509'],
      // HS: customs, phase 2 only. Not used yet.
      hs: ['2709', '2710', '271012', '271019', '2711'],
    },
  },
  {
    // Contained ethanol pilot: fuel ethanol demand only (E85, E10, denatured
    // fuel ethanol, bioethanol blends). Runs on the shared fuel capture path
    // (broker-filter -> excludeKeywords -> expired -> write; no Haiku fit
    // scoring). Aimed at the US Gulf and export buyers across every fuel-capable
    // tender source.
    name: 'ethanol_gulf',
    keywords: [
      'ethanol',
      'denatured ethanol',
      'fuel ethanol',
      'bioethanol',
      'E85',
      'E10',
      'ethanol blend',
      'ASTM D4806',
      'flex fuel',
      'biofuel blend',
    ],
    // Full broker list (as fuel_tenders) PLUS the non-fuel ethanol uses. Ethanol
    // has large sanitizer/beverage/industrial/pharma demand; without these the
    // profile drowns in non-fuel hits. Enforced on the fuel capture path (after
    // the broker filter, before the expired check).
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
      'hand sanitizer',
      'beverage grade',
      'industrial solvent',
      'pharmaceutical',
      'disinfectant',
    ],
    // Every fuel-capable tender source in the system (STEP 3 pilot target set).
    sources: [...TENDER_SOURCES, 'tenderned', 'texasesbd'],
    // Fuel-module: written via the capture path with a fixed score, so minScore
    // is never consulted for this profile. Kept at the fuel floor for parity.
    minScore: 40,
    module: 'fuel',
    active: true,
    minKeywordMatches: 1,
    regions: ['US-TX', 'US-LA', 'US-MS', 'US-AL', 'US-GULF'],
    tscodes: {
      // CPV: routed to the code-gated EU portals (TED EU / TenderNed), which
      // skip the profile without codes. The petroleum-family fuel codes proven
      // in fuel_tenders. The generic ethyl-alcohol chemical code (24322220) was
      // dropped: it only pulled a non-fuel wastewater false positive.
      cpv: [
        '09100000',
        '09130000',
        '09131000',
        '09132000',
        '09134000',
        '09134100',
        '09134200',
      ],
      // HS: fuel/denatured ethanol customs headings (phase 2, descriptive).
      hs: ['220710', '220720'],
      // UNSPSC: ethanol / fuel additive (Singapore GeBIZ, UNGM).
      unspsc: ['15101514', '12164400'],
      // NAICS: ethyl alcohol manufacturing / petroleum wholesale (US sources).
      naics: ['325193', '424710'],
    },
  },
  {
    // GLI lane (Grant Leisure International): leisure, attraction, hospitality,
    // gaming, and cultural venue opportunities. Query-driven: it runs each
    // `queries` term through Serper (whole-web Google search) and routes every
    // result through
    // the dedicated GLI lane (inclusion gate + venue_type/signal_type tagging +
    // project dedup in gli.ts), never the prefilter / Haiku / consulting paths.
    // Isolated from the fuel and consulting lanes. keywords/minScore/
    // minKeywordMatches are unused by the GLI lane (it has its own LLM gate) but
    // are set to sensible values for the shared interface.
    name: 'gli',
    keywords: [
      'theme park',
      'waterpark',
      'amusement park',
      'family entertainment',
      'zoo',
      'aquarium',
      'museum',
      'science center',
      'heritage attraction',
      'integrated resort',
      'resort',
      'hotel development',
      'casino',
      'tourism master plan',
      'leisure destination',
      'visitor attraction',
      'attraction operator',
      'entertainment district',
    ],
    excludeKeywords: [],
    sources: ['serper'],
    minScore: 0,
    module: 'gli',
    active: true,
    minKeywordMatches: 1,
    queries: [
      'theme park development',
      'waterpark feasibility',
      'amusement park project',
      'family entertainment center',
      'zoo development',
      'aquarium project',
      'museum development',
      'science center project',
      'heritage attraction',
      'integrated resort development',
      'resort feasibility',
      'hotel development feasibility',
      'casino development',
      'tourism master plan',
      'leisure destination development',
      'visitor attraction feasibility',
      'attraction operator selection',
      'entertainment district development',
      // Feasibility / RFP / procurement-targeted terms: surface formal
      // solicitations (studies, consultancy tenders, procurement, EOIs) that the
      // broad development terms miss. Default-pass only (not CORE_TERMS), so the
      // run stays under the Serper 120-search ceiling.
      'leisure attraction feasibility study RFP',
      'theme park feasibility consultancy tender',
      'waterpark development feasibility',
      'resort feasibility study procurement',
    ],
  },
];

// The GLI profile's search terms, for the Google CSE source. Empty if the GLI
// profile is inactive or missing.
export function gliQueries(): string[] {
  return PROFILES.find((p) => p.module === 'gli' && p.active)?.queries ?? [];
}

// Consulting CPV codes for code-aware tender sources (TED EU) when running
// under non-fuel profiles. Management consulting, business/strategy advisory,
// regulatory, quality, and feasibility services.
export const CONSULTING_CPV_CODES = [
  '79000000', // Business services
  '79400000', // Business and management consultancy and related services
  '79410000', // Business and management consultancy services
  '79411000', // General management consultancy services
  '79415000', // Operations management consultancy (Philip's operational architecture; priority)
  '79418000', // Procurement consultancy services
  '79419000', // Evaluation consultancy services
  '71241000', // Feasibility study and advisory (shared with the leisure group; routes here when not feasibility-tagged)
  '71600000', // Technical testing, analysis and consultancy services
  '73000000', // Research and development services and related consultancy
  '85100000', // Health services
];

// Leisure / tourism / recreation / cultural + feasibility CPV codes for TED,
// sent as an INDEPENDENT TED group (its own result budget) so this low-volume
// work is not crowded out by high-volume business-consultancy notices. Confirmed
// on-target against the TED API; 98000000 (miscellaneous community services) and
// 71300000 (~21k engineering notices) were checked and excluded as off-target.
export const LEISURE_CPV_CODES = [
  '71241000', // Feasibility study, advisory service, analysis (priority)
  '92000000', // Recreational, cultural and sporting services (priority)
  '92100000', // Motion picture and video services
  '92600000', // Sporting services
  '79951000', // Seminar / exhibition / congress organisation services
  '71400000', // Urban planning and architectural services (tourism/master plans)
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
