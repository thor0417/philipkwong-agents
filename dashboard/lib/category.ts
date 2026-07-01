// Category navigation model for the dashboard.
//
// Leads carry classification tags written by agents/scraper/classify.ts
// (category / subcategory / product_type / is_cargo). This module turns those
// tags into a navigable tree: a top-level category, plus cascading sub-filters
// for Fuel (notice type + product type) and Consulting (work type). Pure data +
// predicates; the CategoryNav component renders it and the pipeline page applies
// applyCategoryFilter to the lead list.

import type { Lead } from './types';

export type CategoryKey = 'all' | 'fuel' | 'consulting' | 'feasibility' | 'tenders' | 'hiring' | 'jobs';

export interface Option {
  key: string;
  label: string;
}

export const CATEGORY_OPTIONS: { key: CategoryKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'fuel', label: 'Fuel' },
  { key: 'consulting', label: 'Consulting' },
  { key: 'feasibility', label: 'Feasibility' },
  { key: 'tenders', label: 'Government Tenders' },
  { key: 'hiring', label: 'Hiring' },
  { key: 'jobs', label: 'Jobs' },
];

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
  cargo: boolean; // fuel cargo experiment view
}

export const EMPTY_CATEGORY_FILTER: CategoryFilter = {
  category: 'all',
  fuelNotice: 'all',
  fuelProduct: 'all',
  consultingSub: 'all',
  feasibilitySector: 'all',
  cargo: false,
};

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

// Apply the full cascading filter to a lead list.
//  - Fuel: notice + product filters; Award/dead hidden unless explicitly picked;
//    cargo view narrows to is_cargo; sorted by soonest deadline.
//  - Consulting: work-type filter.
export function applyCategoryFilter(leads: Lead[], f: CategoryFilter): Lead[] {
  let out = leads.filter((l) => matchesCategory(l, f.category));

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
    // Feasibility RFPs are captured on legitimacy (score null), so surface them
    // by soonest deadline like the fuel lane.
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
