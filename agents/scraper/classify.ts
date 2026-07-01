// Category / subcategory / product_type tagging, applied at write time so the
// dashboard can organize leads.
//
// Routing is deliberate, not keyword-counting:
//   - Fuel means SUPPLY of the commodity. A lead is fuel only when it is NOT an
//     equipment / construction / maintenance / fire-safety job, AND it names a
//     fuel commodity, AND it carries supply-of-commodity intent. A fire-pump
//     replacement, stern crane, refueling-center construction, or submarine
//     spares tender is not fuel.
//   - Consulting means an advisory contract / RFP / EOI, never an employment ad.
//   - Employment postings route to their own category 'jobs' (never consulting).
//   - Anything else routes to 'excluded' (shown under All / Government Tenders,
//     never Fuel or Consulting).
//
// Pure keyword + source heuristics, no network and no scoring. Does not change
// fuel capture or the consulting scorer; the orchestrator stamps these tags on
// write and the backfill re-runs them over existing rows.

import type { NormalizedLead } from './sources/types';
import { keywordMatches } from './prefilter';

// Government / institutional tender portals (baseline fuel subcategory). Private
// and corporate sources fall through to 'private_tender'.
const GOV_SOURCES = new Set([
  'tedeu',
  'tenderned',
  'canadabuys',
  'austender',
  'uktenders',
  'gebiz',
  'ungm',
  'samgov',
  'texasesbd',
  'thailandgpp',
  'worldbank',
  'adb',
  'afdb',
  'undp',
]);

export interface Classification {
  category: string;
  subcategory: string | null;
  product_type: string | null;
  is_cargo: boolean;
  volume_estimate: string | null;
  sector: string | null;
}

// Neither fuel supply, advisory work, nor an employment ad (equipment,
// construction, maintenance). Kept off the Fuel / Consulting views.
function excluded(): Classification {
  return { category: 'excluded', subcategory: null, product_type: null, is_cargo: false, volume_estimate: null, sector: null };
}

// Employment postings get their own category so they never appear under
// consulting.
function jobs(): Classification {
  return { category: 'jobs', subcategory: null, product_type: null, is_cargo: false, volume_estimate: null, sector: null };
}

function haystack(lead: NormalizedLead): string {
  return `${lead.title}\n${lead.raw_content}`;
}

// ---- Fuel product_type: strongest (most specific) match wins. ----
// Ordered most-specific-first; every named product is checked before the 'other'
// fallthrough, so a lead naming a product lands in that bucket.
const FUEL_PRODUCTS: { type: string; keywords: string[] }[] = [
  { type: 'jet_a1', keywords: ['jet a-1', 'jet a1', 'aviation turbine fuel', 'avtur', 'jet fuel'] },
  { type: 'crude', keywords: ['crude oil', 'crude', 'brent', 'WTI', 'bonny light'] },
  { type: 'lng', keywords: ['LNG', 'liquefied natural gas'] },
  { type: 'lpg', keywords: ['LPG', 'liquefied petroleum gas', 'propane', 'butane'] },
  { type: 'ethanol', keywords: ['ethanol', 'bioethanol', 'E85', 'E10', 'denatured'] },
  { type: 'fuel_oil', keywords: ['fuel oil', 'HFO', 'heavy fuel oil', 'bunker', 'marine fuel', 'IFO', 'MGO'] },
  {
    type: 'diesel',
    keywords: ['diesel', 'EN590', 'EN 590', 'ULSD', 'ultra low sulphur', 'gasoil', 'gas oil', 'automotive gas oil', 'AGO', 'HVO', 'HVO100'],
  },
  { type: 'gasoline', keywords: ['gasoline', 'petrol', 'mogas', 'unleaded'] },
];

function fuelProductType(text: string): string {
  for (const p of FUEL_PRODUCTS) {
    if (keywordMatches(text, p.keywords).length > 0) return p.type;
  }
  return 'other';
}

// ---- Hard exclusions: equipment / construction / maintenance / fire-safety and
// non-fuel additives. Any match => not fuel, regardless of other keywords. ----
const FUEL_EXCLUDE = [
  'fire pump',
  'fire system',
  'fire suppression',
  'sprinkler',
  'fire safety',
  'pump replacement',
  'distribution station',
  'refueling center',
  'refueling centre',
  'refueling station',
  'refuelling station',
  'pipeline construction',
  'spares',
  'spare parts',
  'superchargers',
  'engine components',
  'crane',
  'mask',
  'belt',
  'trucks',
  'vehicle',
  'drydock',
  'refit',
  'repair',
  'maintenance',
  'servicing',
  'replacement',
  'installation',
  'install',
  'upgrade',
  'construction',
  'overhaul',
  'calibration',
  'inspection',
  'exhaust fluid',
  'DEF',
  'AdBlue',
  'fuel meter',
  'fuel head',
  'fuel system',
  'tank cleaning',
];

// Fuel commodity terms. Multilingual because EU notices name the fuel in
// Dutch / French / Spanish / German.
const FUEL_COMMODITY = [
  'diesel', 'EN590', 'EN 590', 'ULSD', 'gasoil', 'gas oil', 'HVO', 'HVO100',
  'jet a-1', 'jet a1', 'jet fuel', 'aviation turbine fuel', 'avtur', 'kerosene',
  'gasoline', 'petrol', 'mogas', 'unleaded',
  'crude', 'crude oil', 'brent',
  'fuel oil', 'HFO', 'heavy fuel oil', 'bunker', 'marine fuel', 'MGO', 'IFO',
  'LNG', 'liquefied natural gas', 'LPG', 'liquefied petroleum gas', 'propane', 'butane',
  'ethanol', 'bioethanol', 'E85', 'E10',
  'fuel', 'petroleum', 'naphtha',
  'brandstof', 'brandstoffen', 'combustible', 'carburant', 'kraftstoff',
];

// Supply-of-commodity intent (buying/delivering the fuel), incl. common
// non-English procurement verbs.
const SUPPLY_INTENT = [
  'supply of', 'supply and delivery', 'provision of', 'purchase of', 'procurement of',
  'delivery of', 'bulk fuel', 'fuel supply contract', 'fuel supply',
  'supply', 'supplies', 'provision', 'procurement', 'purchase', 'purchasing', 'tender for supply',
  'levering', 'leveren', 'fourniture', 'livraison', 'suministro', 'lieferung', 'approvisionnement',
];

// A lead is genuine fuel supply only when it clears the hard exclusions AND names
// a fuel commodity AND carries supply intent.
function isFuelSupply(text: string): boolean {
  if (keywordMatches(text, FUEL_EXCLUDE).length > 0) return false;
  return keywordMatches(text, FUEL_COMMODITY).length > 0 && keywordMatches(text, SUPPLY_INTENT).length > 0;
}

// ---- Fuel subcategory: source baseline, refined by clear notice-type text. ----
const RFP_TERMS = ['RFP', 'RFQ', 'request for proposal', 'request for quotation', 'invitation to tender'];
const DEAD_TERMS = [
  'award',
  'awarded',
  'contract award',
  'contract award notice',
  'advance contract award notice',
  'award notice',
  'notice of intent',
  'cancelled',
  'canceled',
  'withdrawn',
];
const FRAMEWORK_TERMS = ['framework agreement'];

function fuelSubcategory(source: string, text: string): string {
  if (keywordMatches(text, DEAD_TERMS).length > 0) return 'award_or_dead';
  if (keywordMatches(text, FRAMEWORK_TERMS).length > 0) return 'framework';
  if (keywordMatches(text, RFP_TERMS).length > 0) return 'rfp';
  return GOV_SOURCES.has(source) ? 'gov_tender' : 'private_tender';
}

// ---- Cargo-scale flag, stated volume, and NOC/state buyer sector. ----
const CARGO_TERMS = ['MT', 'metric tonnes', 'cargo', 'CIF', 'FOB', 'vessel', 'bulk supply', 'bulk fuel import'];
const VOLUME_MT_MIN = 5000;
const VOLUME_RE =
  /(?<![A-Za-z0-9])(\d{1,3}(?:[,\s]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(metric tonnes|metric tons|tonnes|tons|mt)\b/gi;

const NOC_BUYERS = ['IOCL', 'BPCL', 'HPCL', 'PSO', 'Pertamina', 'CPC', 'BPC', 'EGPC', 'NNPC'];

function statedVolumes(text: string): { text: string; mt: number }[] {
  const out: { text: string; mt: number }[] = [];
  for (const m of text.matchAll(VOLUME_RE)) {
    const mt = parseFloat(m[1].replace(/[,\s]/g, ''));
    if (!Number.isNaN(mt)) out.push({ text: m[0].trim().replace(/\s+/g, ' '), mt });
  }
  return out;
}

function fuelCargo(
  text: string,
  productType: string
): { is_cargo: boolean; volume_estimate: string | null } {
  const vols = statedVolumes(text);
  const largest = vols.reduce((a, b) => (b.mt > a.mt ? b : a), { text: '', mt: 0 });
  const bigVolume = largest.mt >= VOLUME_MT_MIN;
  const hasCargoTerms = keywordMatches(text, CARGO_TERMS).length > 0;
  const realProduct = productType !== 'other';
  return {
    is_cargo: bigVolume || (hasCargoTerms && realProduct),
    volume_estimate: largest.mt > 0 ? largest.text : null,
  };
}

function fuelSector(company: string | null): string | null {
  if (!company) return null;
  return keywordMatches(company, NOC_BUYERS).length > 0 ? 'noc' : null;
}

// ---- Consulting subcategory: work type by keyword. Feasibility first so a
// feasibility study is not swallowed by a broader compliance/strategy keyword. ----
const CONSULTING_SUBCATS: { sub: string; keywords: string[] }[] = [
  {
    sub: 'feasibility',
    keywords: [
      'feasibility study', 'feasibility', 'prefeasibility', 'pre-feasibility', 'techno-economic',
      'viability', 'business case', 'bankable feasibility', 'options appraisal', 'scoping study',
      'needs assessment', 'situational analysis', 'market study', 'market assessment',
    ],
  },
  { sub: 'compliance', keywords: ['compliance', 'regulatory', 'QMS', 'ISO', 'GMP', 'audit', 'accreditation'] },
  {
    sub: 'document_writing',
    keywords: ['SOP', 'standard operating procedure', 'technical writing', 'policy document', 'documentation', 'procedure writing'],
  },
  { sub: 'strategy', keywords: ['strategy', 'strategic', 'advisory', 'market entry', 'transformation', 'business development'] },
];

function consultingSubcategory(text: string): string {
  for (const c of CONSULTING_SUBCATS) {
    if (keywordMatches(text, c.keywords).length > 0) return c.sub;
  }
  return 'other';
}

// ---- Employment-posting detection (routes to category 'jobs'). ----
const JOB_TERMS = [
  'applying for a role',
  'job vacancy',
  'employment position',
  'full-time',
  'full time',
  'part-time',
  'part time',
  'permanent position',
  'we are hiring',
  'join our team',
  'job description',
  'cover letter',
  'years of experience',
  'salary',
];

function isJobPosting(text: string): boolean {
  return keywordMatches(text, JOB_TERMS).length > 0;
}

// Fuel-module leads: real fuel supply -> category 'fuel'; otherwise excluded.
export function classifyFuel(lead: NormalizedLead): Classification {
  const text = haystack(lead);
  if (!isFuelSupply(text)) return excluded();
  const product_type = fuelProductType(text);
  const cargo = fuelCargo(text, product_type);
  return {
    category: 'fuel',
    subcategory: fuelSubcategory(lead.source, text),
    product_type,
    is_cargo: cargo.is_cargo,
    volume_estimate: cargo.volume_estimate,
    sector: fuelSector(lead.company),
  };
}

// Non-fuel leads: employment ads -> 'jobs'; otherwise an advisory contract ->
// category 'consulting' with a work-type subcategory.
export function classifyConsulting(lead: NormalizedLead): Classification {
  const text = haystack(lead);
  if (isJobPosting(text)) return jobs();
  return {
    category: 'consulting',
    subcategory: consultingSubcategory(text),
    product_type: null,
    is_cargo: false,
    volume_estimate: null,
    sector: null,
  };
}
