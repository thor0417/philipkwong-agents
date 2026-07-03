// Category navigation model for the dashboard.
//
// Leads carry classification tags written by agents/scraper/classify.ts
// (category / subcategory / product_type / is_cargo). This module turns those
// tags into a navigable tree: a top-level category, plus cascading sub-filters
// for Fuel (notice type + product type) and Consulting (work type). Pure data +
// predicates; the CategoryNav component renders it and the pipeline page applies
// applyCategoryFilter to the lead list.

import type { Lead } from './types';

export type CategoryKey =
  | 'all'
  | 'fuel'
  | 'consulting'
  | 'feasibility'
  | 'signals'
  | 'tenders'
  | 'hiring'
  | 'jobs';

export interface Option {
  key: string;
  label: string;
}

export const CATEGORY_OPTIONS: { key: CategoryKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'fuel', label: 'Fuel' },
  { key: 'consulting', label: 'Consulting' },
  { key: 'feasibility', label: 'Feasibility' },
  { key: 'signals', label: 'Signals' },
  { key: 'tenders', label: 'Government Tenders' },
  { key: 'hiring', label: 'Hiring' },
  { key: 'jobs', label: 'Jobs' },
];

// Signals lane sub-filters (Part B). Signal type, sector (feasibility sectors
// plus agro_tourism), and jurisdiction (Mexican priority states + the Caribbean
// countries in scope).
export const SIGNAL_TYPE_OPTIONS: Option[] = [
  { key: 'all', label: 'All types' },
  { key: 'land_acquisition', label: 'Land acquisition' },
  { key: 'incentive_approval', label: 'Incentive approval' },
  { key: 'development_application', label: 'Development application' },
];

export const SIGNAL_SECTOR_OPTIONS: Option[] = [
  { key: 'all', label: 'All sectors' },
  { key: 'tourism', label: 'Tourism' },
  { key: 'hospitality', label: 'Hospitality' },
  { key: 'gaming', label: 'Gaming' },
  { key: 'entertainment', label: 'Entertainment' },
  { key: 'cultural', label: 'Cultural' },
  { key: 'leisure', label: 'Leisure' },
  { key: 'agro_tourism', label: 'Agro-tourism' },
];

// Jurisdiction options: the in-scope Caribbean countries, plus the priority
// Mexican states. Matched via signalJurisdictions() below.
export const SIGNAL_JURISDICTION_OPTIONS: Option[] = [
  { key: 'all', label: 'All jurisdictions' },
  { key: 'MX', label: 'Mexico' },
  { key: 'Quintana Roo', label: 'MX · Quintana Roo' },
  { key: 'Baja California Sur', label: 'MX · Baja California Sur' },
  { key: 'Nayarit', label: 'MX · Nayarit' },
  { key: 'Jalisco', label: 'MX · Jalisco' },
  { key: 'Oaxaca', label: 'MX · Oaxaca' },
  { key: 'Yucatan', label: 'MX · Yucatan' },
  { key: 'DO', label: 'Dominican Republic' },
  { key: 'BS', label: 'Bahamas' },
  { key: 'JM', label: 'Jamaica' },
  { key: 'KY', label: 'Cayman Islands' },
];

// Signal source -> ISO country, so jurisdiction filtering keys off the source
// (the leads table stores region 'LATAM_CARIB' and a free-text location, not a
// country column).
const SIGNAL_SOURCE_COUNTRY: Record<string, string> = {
  fonatur: 'MX',
  semarnat: 'MX',
  confotur: 'DO',
  bahamas_hoa: 'BS',
  nepa_jm: 'JM',
  cayman_cpa: 'KY',
};

// A lead matches a jurisdiction key when the key is its source-country, or when
// the key is a Mexican state named in its location (Mexican leads carry the
// state in location).
function matchesSignalJurisdiction(lead: Lead, key: string): boolean {
  if (key === 'all') return true;
  const country = SIGNAL_SOURCE_COUNTRY[lead.source ?? ''] ?? null;
  if (key.length === 2) return country === key; // ISO country code
  // Otherwise a Mexican state name: match against the location.
  return country === 'MX' && (lead.location ?? '').toLowerCase().includes(key.toLowerCase());
}

// Fuel notice type (leads.subcategory). 'all' hides Award/dead by default but it
// stays reachable as an explicit choice below.
export const FUEL_NOTICE_OPTIONS: Option[] = [
  { key: 'all', label: 'All types' },
  { key: 'gov_tender', label: 'Gov tender' },
  { key: 'private_tender', label: 'Private tender' },
  { key: 'rfp', label: 'RFP' },
  { key: 'framework', label: 'Framework' },
  { key: 'award_or_dead', label: 'Award/dead' },
];

// Fuel product type (leads.product_type).
export const FUEL_PRODUCT_OPTIONS: Option[] = [
  { key: 'all', label: 'All products' },
  { key: 'jet_a1', label: 'Jet A-1' },
  { key: 'diesel', label: 'Diesel/EN590/ULSD' },
  { key: 'crude', label: 'Crude' },
  { key: 'gasoline', label: 'Gasoline' },
  { key: 'fuel_oil', label: 'Fuel oil/bunker' },
  { key: 'lng', label: 'LNG' },
  { key: 'lpg', label: 'LPG' },
  { key: 'ethanol', label: 'Ethanol' },
  { key: 'other', label: 'Other' },
];

// Consulting work type (leads.subcategory). Feasibility is no longer here: it
// is its own top-level category with a sector sub-filter.
export const CONSULTING_SUB_OPTIONS: Option[] = [
  { key: 'all', label: 'All work' },
  { key: 'compliance', label: 'Compliance' },
  { key: 'document_writing', label: 'Document writing' },
  { key: 'strategy', label: 'Strategy' },
  { key: 'other', label: 'Other' },
];

// Feasibility sector (leads.subcategory) for the feasibility category. Mirrors
// the scraper's sector tags (agents/scraper/classify.ts): the leisure/culture
// family first, then the hard-infrastructure sectors.
export const FEASIBILITY_SECTOR_OPTIONS: Option[] = [
  { key: 'all', label: 'All sectors' },
  { key: 'tourism', label: 'Tourism' },
  { key: 'hospitality', label: 'Hospitality' },
  { key: 'gaming', label: 'Gaming' },
  { key: 'entertainment', label: 'Entertainment' },
  { key: 'cultural', label: 'Cultural' },
  { key: 'leisure', label: 'Leisure' },
  { key: 'energy', label: 'Energy' },
  { key: 'water', label: 'Water' },
  { key: 'transport', label: 'Transport' },
  { key: 'health', label: 'Health' },
  { key: 'agriculture', label: 'Agriculture' },
  { key: 'infrastructure', label: 'Infrastructure' },
  { key: 'other', label: 'Other' },
];

// Government Tenders sub-filters. The tenders category is a cross-cutting view
// (lead_type 'tender' spans fuel / consulting / feasibility / excluded), so its
// industry + notice-type are derived from the stored text/tags at read time
// (tenderIndustry / tenderNotice below) rather than owned by one scraper profile.
export const TENDER_INDUSTRY_OPTIONS: Option[] = [
  { key: 'all', label: 'All industries' },
  { key: 'healthcare', label: 'Healthcare' },
  { key: 'construction', label: 'Construction' },
  { key: 'it', label: 'IT' },
  { key: 'defense', label: 'Defense' },
  { key: 'professional_services', label: 'Professional Services' },
  { key: 'environmental', label: 'Environmental' },
  { key: 'energy', label: 'Energy' },
  { key: 'other', label: 'Other' },
];

// Notice type, mirroring the Fuel notice sub-filter. 'all' hides Award/dead by
// default; it stays reachable as an explicit choice (which also reveals archived).
export const TENDER_NOTICE_OPTIONS: Option[] = [
  { key: 'all', label: 'All types' },
  { key: 'solicitation', label: 'Solicitation' },
  { key: 'rfp', label: 'RFP' },
  { key: 'framework', label: 'Framework' },
  { key: 'award_or_dead', label: 'Award/dead' },
];

// The cascading filter state the nav owns.
export interface CategoryFilter {
  category: CategoryKey;
  fuelNotice: string; // 'all' | subcategory
  fuelProduct: string; // 'all' | product_type
  consultingSub: string; // 'all' | subcategory
  feasibilitySector: string; // 'all' | sector subcategory
  feasibilityLatam: boolean; // feasibility: restrict to LATAM_CARIB region
  signalType: string; // 'all' | signal_type
  signalSector: string; // 'all' | sector subcategory
  signalJurisdiction: string; // 'all' | country code / MX state
  tenderIndustry: string; // 'all' | tender industry key
  tenderNotice: string; // 'all' | tender notice type
  cargo: boolean; // fuel cargo experiment view
  includeArchived: boolean; // show expired + awarded/dead (off by default)
}

export const EMPTY_CATEGORY_FILTER: CategoryFilter = {
  category: 'all',
  fuelNotice: 'all',
  fuelProduct: 'all',
  consultingSub: 'all',
  feasibilitySector: 'all',
  feasibilityLatam: false,
  signalType: 'all',
  signalSector: 'all',
  signalJurisdiction: 'all',
  tenderIndustry: 'all',
  tenderNotice: 'all',
  cargo: false,
  includeArchived: false,
};

// A lead is not actionable when its deadline has passed (expired) or it is
// already awarded/cancelled/withdrawn/superseded/advance-award/notice-of-intent
// (dead). This is driven by the lifecycle status the scraper + retag-dead-expired
// pass assign ('dead' / 'expired'), so the exclusion holds even when a deadline
// is missing or unparseable; the deadline check and the fuel award_or_dead notice
// type are kept as belt-and-suspenders. Hidden from every category's default view.
function isExpiredLead(l: Lead): boolean {
  return l.status === 'expired' || (!!l.deadline && new Date(l.deadline).getTime() < Date.now());
}
function isDeadLead(l: Lead): boolean {
  return l.status === 'dead' || l.subcategory === 'award_or_dead';
}
export function isArchivedLead(l: Lead): boolean {
  return isExpiredLead(l) || isDeadLead(l);
}

// ---- Government Tenders derived sub-tags (industry + notice type). Keyword
// heuristics over the stored title + content, first match wins. This mirrors the
// Fuel sub-filter UX but classifies at read time, since the tenders view spans
// every scraper profile. ----
function tenderText(l: Lead): string {
  return `${l.title ?? ''}\n${l.raw_content ?? ''}`;
}
function hasWord(text: string, keywords: string[]): boolean {
  return keywords.some((k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
}

const TENDER_INDUSTRY_KEYWORDS: { key: string; keywords: string[] }[] = [
  { key: 'healthcare', keywords: ['health', 'healthcare', 'hospital', 'medical', 'clinic', 'clinical', 'pharmaceutical', 'pharma', 'nursing', 'patient', 'medicine', 'dental', 'diagnostic', 'laboratory', 'ambulance', 'vaccine', 'disease', 'surgical'] },
  { key: 'defense', keywords: ['defence', 'defense', 'military', 'army', 'navy', 'naval', 'air force', 'weapon', 'ammunition', 'tactical', 'armour', 'armor', 'combat', 'warfare', 'soldier', 'coast guard'] },
  { key: 'energy', keywords: ['energy', 'power', 'electricity', 'solar', 'wind', 'fuel', 'fuels', 'oil', 'gas', 'petroleum', 'diesel', 'kerosene', 'aviation kerosene', 'jet fuel', 'jet a1', 'jet a-1', 'ethanol', 'biofuel', 'renewable', 'grid', 'lng', 'lpg', 'biomass', 'hydro', 'photovoltaic', 'nuclear', 'turbine', 'coal'] },
  { key: 'environmental', keywords: ['environment', 'environmental', 'waste', 'recycling', 'wastewater', 'water treatment', 'sanitation', 'sewage', 'pollution', 'climate', 'sustainability', 'remediation', 'ecological', 'emissions', 'drainage', 'water supply'] },
  { key: 'it', keywords: ['software', 'IT', 'ICT', 'information technology', 'cloud', 'cybersecurity', 'cyber', 'network', 'data centre', 'data center', 'application development', 'digital', 'ERP', 'SaaS', 'hardware', 'computer', 'AI', 'artificial intelligence', 'website', 'web', 'telecommunications', 'telecom', 'GIS', 'system integration', 'database'] },
  { key: 'construction', keywords: ['construction', 'building', 'roadworks', 'roofing', 'refurbishment', 'renovation', 'civil works', 'demolition', 'HVAC', 'plumbing', 'paving', 'bridge', 'masonry', 'infrastructure', 'roadway', 'road', 'highway', 'landfill', 'concrete', 'earthworks', 'housing'] },
  { key: 'professional_services', keywords: ['consulting', 'consultancy', 'advisory', 'advice', 'audit', 'legal', 'accounting', 'feasibility', 'strategy', 'evaluation', 'training', 'recruitment', 'human resources', 'financial services', 'insurance', 'actuarial', 'valuation', 'research', 'study', 'assessment', 'management', 'design', 'regulatory', 'policy', 'compliance', 'quality assurance', 'quality management', 'procurement'] },
];

// Industry bucket for a tender. Fuel-tagged leads are energy by construction
// (the scraper's fuel classification already handles multilingual fuel names the
// keyword list cannot all cover); otherwise the first matching keyword group wins.
export function tenderIndustry(l: Lead): string {
  if (l.category === 'fuel' || l.module === 'fuel') return 'energy';
  const text = tenderText(l);
  for (const g of TENDER_INDUSTRY_KEYWORDS) if (hasWord(text, g.keywords)) return g.key;
  return 'other';
}

const TENDER_RFP_TERMS = ['RFP', 'RFQ', 'request for proposal', 'request for quotation', 'request for quotations', 'invitation to tender', 'EOI', 'expression of interest', 'request for expression'];
const TENDER_FRAMEWORK_TERMS = ['framework agreement', 'framework'];

// Notice type for a tender. Awarded / cancelled / withdrawn / expired leads (the
// archived set) are award_or_dead; otherwise framework, then RFP, else an open
// solicitation. Ordering mirrors the fuel notice classifier.
export function tenderNotice(l: Lead): string {
  if (isArchivedLead(l)) return 'award_or_dead';
  const text = tenderText(l);
  if (hasWord(text, TENDER_FRAMEWORK_TERMS)) return 'framework';
  if (hasWord(text, TENDER_RFP_TERMS)) return 'rfp';
  return 'solicitation';
}

// Top-level category membership. Fuel/Consulting read the classification column
// (falling back to module for leads written before tagging existed); Government
// Tenders and Hiring read lead_type, matching the prior module filter.
export function matchesCategory(lead: Lead, key: CategoryKey): boolean {
  switch (key) {
    case 'all':
      return true;
    case 'fuel':
      return lead.category === 'fuel' || (lead.category == null && lead.module === 'fuel');
    case 'consulting':
      return (
        lead.category === 'consulting' ||
        (lead.category == null && lead.module != null && lead.module !== 'fuel')
      );
    case 'feasibility':
      return lead.category === 'feasibility';
    case 'signals':
      return lead.category === 'signals';
    case 'jobs':
      return lead.category === 'jobs';
    case 'tenders':
      return lead.lead_type === 'tender';
    case 'hiring':
      return lead.lead_type === 'registry';
    default:
      return true;
  }
}

// Soonest deadline first; leads with no deadline sort last (stable).
function byDeadline(a: Lead, b: Lead): number {
  const ta = a.deadline ? new Date(a.deadline).getTime() : Infinity;
  const tb = b.deadline ? new Date(b.deadline).getTime() : Infinity;
  if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
  return (Number.isNaN(ta) ? Infinity : ta) - (Number.isNaN(tb) ? Infinity : tb);
}

// Most recent signal first; leads with no signal_date sort last.
function bySignalDateDesc(a: Lead, b: Lead): number {
  const ta = a.signal_date ? new Date(a.signal_date).getTime() : -Infinity;
  const tb = b.signal_date ? new Date(b.signal_date).getTime() : -Infinity;
  return tb - ta;
}

// Display jurisdiction for a signal: source country, with the Mexican state
// appended when the location carries it (FONATUR/SEMARNAT set the state).
export function signalJurisdiction(lead: Lead): string {
  const country = SIGNAL_SOURCE_COUNTRY[lead.source ?? ''] ?? null;
  if (country === 'MX' && lead.location && lead.location.toLowerCase() !== 'mexico') {
    return `MX · ${lead.location}`;
  }
  if (country) return country;
  return lead.location ?? '—';
}

// Apply the full cascading filter to a lead list.
//  - Fuel: notice + product filters; Award/dead hidden unless explicitly picked;
//    cargo view narrows to is_cargo; sorted by soonest deadline.
//  - Consulting: work-type filter.
export function applyCategoryFilter(leads: Lead[], f: CategoryFilter): Lead[] {
  let out = leads.filter((l) => matchesCategory(l, f.category));

  // Expired and awarded/dead leads are hidden from every category's default
  // view. They stay reachable when the user opts in (includeArchived) or picks
  // the fuel Award/dead notice type explicitly.
  const showArchived =
    f.includeArchived ||
    (f.category === 'fuel' && f.fuelNotice === 'award_or_dead') ||
    (f.category === 'tenders' && f.tenderNotice === 'award_or_dead');
  if (!showArchived) {
    out = out.filter((l) => !isArchivedLead(l));
  }

  if (f.category === 'fuel') {
    if (f.cargo) out = out.filter((l) => l.is_cargo === true);
    if (f.fuelNotice === 'all') {
      out = out.filter((l) => l.subcategory !== 'award_or_dead');
    } else {
      out = out.filter((l) => l.subcategory === f.fuelNotice);
    }
    if (f.fuelProduct !== 'all') {
      out = out.filter((l) => (l.product_type ?? 'other') === f.fuelProduct);
    }
    out = [...out].sort(byDeadline);
  } else if (f.category === 'consulting') {
    if (f.consultingSub !== 'all') {
      out = out.filter((l) => (l.subcategory ?? 'other') === f.consultingSub);
    }
  } else if (f.category === 'feasibility') {
    if (f.feasibilitySector !== 'all') {
      out = out.filter((l) => (l.subcategory ?? 'other') === f.feasibilitySector);
    }
    // LATAM/Caribbean origination filter: restrict to the region group.
    if (f.feasibilityLatam) {
      out = out.filter((l) => l.region === 'LATAM_CARIB');
    }
    // Feasibility RFPs are captured on legitimacy (score null), so surface them
    // by soonest deadline like the fuel lane.
    out = [...out].sort(byDeadline);
  } else if (f.category === 'signals') {
    if (f.signalType !== 'all') {
      out = out.filter((l) => (l.signal_type ?? '') === f.signalType);
    }
    if (f.signalSector !== 'all') {
      out = out.filter((l) => (l.subcategory ?? 'other') === f.signalSector);
    }
    if (f.signalJurisdiction !== 'all') {
      out = out.filter((l) => matchesSignalJurisdiction(l, f.signalJurisdiction));
    }
    // Signals never expire, and the backfill window already caps how far back the
    // scraper writes them, so the category shows every stored signal, most recent
    // first. (An earlier last-30-days default hid signals older than a month,
    // which is every signal on hand — dropped so the category actually renders.)
    out = [...out].sort(bySignalDateDesc);
  } else if (f.category === 'tenders') {
    if (f.tenderIndustry !== 'all') {
      out = out.filter((l) => tenderIndustry(l) === f.tenderIndustry);
    }
    // Notice type mirrors Fuel: 'all' hides Award/dead (already dropped by the
    // archived filter above); an explicit type filters to it (award_or_dead also
    // flips showArchived on, so those leads become reachable).
    if (f.tenderNotice === 'all') {
      out = out.filter((l) => tenderNotice(l) !== 'award_or_dead');
    } else {
      out = out.filter((l) => tenderNotice(l) === f.tenderNotice);
    }
    out = [...out].sort(byDeadline);
  }

  return out;
}

// Label lookups for display (detail panel, cargo view).
function label(options: Option[], key: string | null | undefined): string {
  if (!key) return '—';
  return options.find((o) => o.key === key)?.label ?? key;
}
export const productLabel = (pt: string | null | undefined): string =>
  label(FUEL_PRODUCT_OPTIONS, pt ?? 'other');
export const noticeLabel = (sub: string | null | undefined): string =>
  label(FUEL_NOTICE_OPTIONS, sub);
export const consultingLabel = (sub: string | null | undefined): string =>
  label(CONSULTING_SUB_OPTIONS, sub);
export const feasibilitySectorLabel = (sub: string | null | undefined): string =>
  label(FEASIBILITY_SECTOR_OPTIONS, sub);
export const signalTypeLabel = (t: string | null | undefined): string =>
  label(SIGNAL_TYPE_OPTIONS, t);
