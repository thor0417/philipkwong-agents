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
  cargo: false,
  includeArchived: false,
};

// A lead is not actionable when its deadline has passed (expired) or it is
// already awarded/cancelled/withdrawn (dead: status set by the scraper, or the
// fuel award_or_dead notice type). Hidden from every category's default view.
function isExpiredLead(l: Lead): boolean {
  return !!l.deadline && new Date(l.deadline).getTime() < Date.now();
}
function isDeadLead(l: Lead): boolean {
  return l.status === 'dead' || l.subcategory === 'award_or_dead';
}
export function isArchivedLead(l: Lead): boolean {
  return isExpiredLead(l) || isDeadLead(l);
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
  const showArchived = f.includeArchived || (f.category === 'fuel' && f.fuelNotice === 'award_or_dead');
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
