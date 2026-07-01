// Category / subcategory / product_type tagging, applied at write time so the
// dashboard can organize leads by category and subcategory.
//
// Pure keyword + source heuristics, no network and no scoring: this is best-guess
// only (the dashboard lets the user override). It does NOT change fuel capture or
// the consulting scorer; the orchestrator just stamps these tags onto each row it
// writes.
//
//   category      'fuel' | 'consulting'  (from the lead's module)
//   subcategory   fuel: notice type (gov_tender/private_tender/rfp/award_or_dead/
//                 framework);  consulting: work type (compliance/feasibility/
//                 document_writing/strategy/other)
//   product_type  fuel only: the fuel product (jet_a1/diesel/crude/gasoline/
//                 fuel_oil/lng/lpg/ethanol/other);  null for consulting.

import type { NormalizedLead } from './sources/types';
import { keywordMatches } from './prefilter';

// Government / institutional tender portals (baseline fuel subcategory). Private
// and corporate sources (Ariba, aggregators) fall through to 'private_tender'.
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
]);

export interface Classification {
  category: string;
  subcategory: string;
  product_type: string | null;
  // Cargo experiment bucket (fuel only). is_cargo: bulk/vessel-scale demand.
  // volume_estimate: the stated volume where the notice names one. sector: 'noc'
  // when the buyer is a national oil company / state fuel buyer, else null.
  is_cargo: boolean;
  volume_estimate: string | null;
  sector: string | null;
}

function haystack(lead: NormalizedLead): string {
  return `${lead.title}\n${lead.raw_content}`;
}

// ---- Fuel product_type: strongest (most specific) match wins. ----
// Ordered most-specific-first so a multi-fuel notice is tagged by its most
// distinctive product rather than by a generic road fuel.
const FUEL_PRODUCTS: { type: string; keywords: string[] }[] = [
  { type: 'jet_a1', keywords: ['jet a-1', 'jet a1', 'aviation turbine fuel', 'avtur', 'jet fuel'] },
  { type: 'crude', keywords: ['crude oil', 'crude', 'brent', 'WTI', 'bonny light'] },
  { type: 'lng', keywords: ['LNG', 'liquefied natural gas'] },
  { type: 'lpg', keywords: ['LPG', 'liquefied petroleum gas', 'propane', 'butane'] },
  { type: 'ethanol', keywords: ['ethanol', 'bioethanol', 'E85', 'E10', 'denatured'] },
  {
    type: 'fuel_oil',
    keywords: ['fuel oil', 'HFO', 'heavy fuel oil', 'bunker', 'marine fuel', 'IFO', 'MGO'],
  },
  {
    type: 'diesel',
    keywords: ['diesel', 'EN590', 'ULSD', 'ultra low sulphur', 'gasoil', 'gas oil', 'automotive gas oil', 'AGO'],
  },
  { type: 'gasoline', keywords: ['gasoline', 'petrol', 'mogas', 'unleaded'] },
];

function fuelProductType(text: string): string {
  for (const p of FUEL_PRODUCTS) {
    if (keywordMatches(text, p.keywords).length > 0) return p.type;
  }
  return 'other';
}

// ---- Fuel subcategory: source baseline, refined by clear notice-type text. ----
const RFP_TERMS = ['RFP', 'RFQ', 'request for proposal', 'request for quotation', 'invitation to tender'];
const DEAD_TERMS = ['award', 'awarded', 'contract award', 'cancelled', 'canceled', 'withdrawn'];
const FRAMEWORK_TERMS = ['framework agreement'];

function fuelSubcategory(source: string, text: string): string {
  // Pass 2 (notice text) refines the pass-1 source baseline where the type is
  // clear. Precedence: terminal status (awarded/dead) first, then structure
  // (framework), then live solicitation (rfp).
  if (keywordMatches(text, DEAD_TERMS).length > 0) return 'award_or_dead';
  if (keywordMatches(text, FRAMEWORK_TERMS).length > 0) return 'framework';
  if (keywordMatches(text, RFP_TERMS).length > 0) return 'rfp';
  // Pass 1 baseline by source.
  return GOV_SOURCES.has(source) ? 'gov_tender' : 'private_tender';
}

// ---- Consulting subcategory: work type by keyword, first match wins. ----
const CONSULTING_SUBCATS: { sub: string; keywords: string[] }[] = [
  { sub: 'compliance', keywords: ['compliance', 'regulatory', 'QMS', 'ISO', 'GMP', 'audit', 'accreditation'] },
  { sub: 'feasibility', keywords: ['feasibility study', 'feasibility', 'market study', 'viability', 'business case'] },
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

// ---- Cargo-scale flag, stated volume, and NOC/state buyer sector. ----
// Cargo-scale if the notice carries bulk/vessel trade language OR a stated
// volume at or above this many metric tonnes.
const CARGO_TERMS = ['MT', 'metric tonnes', 'cargo', 'CIF', 'FOB', 'vessel', 'bulk supply', 'bulk fuel import'];
const VOLUME_MT_MIN = 5000;
// A stated tonnage: a number (thousands grouped by comma or single space, or a
// plain run of digits) followed by a MT unit. The leading lookbehind stops it
// starting mid-token (e.g. the "590" in "EN590").
const VOLUME_RE =
  /(?<![A-Za-z0-9])(\d{1,3}(?:[,\s]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(metric tonnes|metric tons|tonnes|tons|mt)\b/gi;

// National oil companies / state fuel buyers, matched on the buyer name.
const NOC_BUYERS = ['IOCL', 'BPCL', 'HPCL', 'PSO', 'Pertamina', 'CPC', 'BPC', 'EGPC', 'NNPC'];

// Stated volumes normalized to metric tonnes, with their original text.
function statedVolumes(text: string): { text: string; mt: number }[] {
  const out: { text: string; mt: number }[] = [];
  for (const m of text.matchAll(VOLUME_RE)) {
    const mt = parseFloat(m[1].replace(/[,\s]/g, ''));
    if (!Number.isNaN(mt)) out.push({ text: m[0].trim().replace(/\s+/g, ' '), mt });
  }
  return out;
}

function fuelCargo(text: string): { is_cargo: boolean; volume_estimate: string | null } {
  const vols = statedVolumes(text);
  const largest = vols.reduce((a, b) => (b.mt > a.mt ? b : a), { text: '', mt: 0 });
  const hasCargoTerms = keywordMatches(text, CARGO_TERMS).length > 0;
  const bigVolume = largest.mt >= VOLUME_MT_MIN;
  return {
    is_cargo: hasCargoTerms || bigVolume,
    volume_estimate: largest.mt > 0 ? largest.text : null,
  };
}

function fuelSector(company: string | null): string | null {
  if (!company) return null;
  return keywordMatches(company, NOC_BUYERS).length > 0 ? 'noc' : null;
}

// Fuel-module leads: category 'fuel', notice-type subcategory + product_type,
// plus the cargo flag, stated volume, and NOC/state buyer sector.
export function classifyFuel(lead: NormalizedLead): Classification {
  const text = haystack(lead);
  const cargo = fuelCargo(text);
  return {
    category: 'fuel',
    subcategory: fuelSubcategory(lead.source, text),
    product_type: fuelProductType(text),
    is_cargo: cargo.is_cargo,
    volume_estimate: cargo.volume_estimate,
    sector: fuelSector(lead.company),
  };
}

// Non-fuel leads: category 'consulting', work-type subcategory, no product_type
// and never cargo (the cargo bucket is fuel-only).
export function classifyConsulting(lead: NormalizedLead): Classification {
  const text = haystack(lead);
  return {
    category: 'consulting',
    subcategory: consultingSubcategory(text),
    product_type: null,
    is_cargo: false,
    volume_estimate: null,
    sector: null,
  };
}
