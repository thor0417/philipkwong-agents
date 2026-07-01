// Category / subcategory / product_type tagging, applied at write time so the
// dashboard can organize leads by category and subcategory.
//
// Routing is deliberate, not just keyword-counting:
//   - Fuel means SUPPLY of the commodity. A lead is fuel only when it names a
//     fuel commodity AND carries supply intent AND is not a service/equipment
//     job. "Fuel meter repair" or "stern crane" is hard-excluded from fuel.
//   - Consulting means a contract/RFP for advisory work, not an employment ad;
//     job vacancies are excluded.
//   - A lead that is neither routes to category 'excluded' (shown under All /
//     Government Tenders on the dashboard, never Fuel or Consulting).
//
// Pure keyword + source heuristics, no network and no scoring: best-guess only
// (the dashboard lets the user override). Does not change fuel capture or the
// consulting scorer; the orchestrator just stamps these tags onto each row it
// writes, and the backfill re-runs them over existing rows.

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
  subcategory: string | null;
  product_type: string | null;
  is_cargo: boolean;
  volume_estimate: string | null;
  sector: string | null;
}

// A lead that is neither genuine fuel supply nor consulting advisory (service
// tender, equipment job, or employment ad). Kept off the Fuel/Consulting views.
function excluded(): Classification {
  return {
    category: 'excluded',
    subcategory: null,
    product_type: null,
    is_cargo: false,
    volume_estimate: null,
    sector: null,
  };
}

function haystack(lead: NormalizedLead): string {
  return `${lead.title}\n${lead.raw_content}`;
}

// ---- Fuel product_type: strongest (most specific) match wins. ----
// Ordered most-specific-first so a multi-fuel notice is tagged by its most
// distinctive product rather than by a generic road fuel. Every named product is
// checked before the 'other' fallthrough, so a lead naming a product (ethanol,
// diesel, ...) lands in that bucket and only genuinely unspecified fuel is 'other'.
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

// ---- Fuel routing: service/equipment exclusion + supply intent. ----
// Maintenance/repair/equipment work on fuel infrastructure is NOT fuel supply.
// Any match here hard-excludes the lead from fuel, regardless of other keywords.
const FUEL_SERVICE_EXCLUDE = [
  'fuel meter',
  'fuel head',
  'fuel system',
  'fuel tank cleaning',
  'tank cleaning',
  'repair',
  'maintenance',
  'servicing',
  'replacement',
  'install',
  'installation',
  'upgrade',
  'refit',
  'drydock',
  'crane',
  'pump repair',
  'calibration',
  'inspection',
  'overhaul',
  'spare parts',
];

// Supply intent: the lead is about buying/delivering the commodity. English
// procurement phrasing plus common procurement verbs on non-English (TED/EU)
// notices, so genuine EU fuel-supply tenders are not dropped for language alone.
const SUPPLY_INTENT = [
  'supply of',
  'supply and delivery',
  'provision of',
  'purchase of',
  'procurement of',
  'delivery of',
  'supply',
  'supplies',
  'provision',
  'procurement',
  'purchase',
  'purchasing',
  'tender for supply',
  'levering', // nl
  'fourniture', // fr
  'suministro', // es
  'lieferung', // de
  'approvisionnement', // fr
];

// Generic fuel commodity present (a fuel supply lead need not name a specific
// product: "supply of fuel" is fuel with product_type 'other').
function hasFuelCommodity(text: string): boolean {
  return (
    fuelProductType(text) !== 'other' ||
    keywordMatches(text, ['fuel', 'petroleum', 'kerosene', 'naphtha']).length > 0
  );
}

// A lead is genuine fuel supply only when a fuel commodity and supply intent are
// both present and it is not a service/equipment job.
function isFuelSupply(text: string): boolean {
  if (keywordMatches(text, FUEL_SERVICE_EXCLUDE).length > 0) return false;
  return hasFuelCommodity(text) && keywordMatches(text, SUPPLY_INTENT).length > 0;
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

// is_cargo fires only for genuine cargo-scale fuel: a stated volume at or above
// the threshold, OR cargo language on a lead that resolved to a real fuel
// product_type. A lead with product_type 'other' never flags on language alone.
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

// ---- Consulting subcategory: work type by keyword, first match wins. ----
// Feasibility is checked FIRST so a feasibility study is not swallowed by a
// broader compliance or strategy keyword also present in the notice.
const CONSULTING_SUBCATS: { sub: string; keywords: string[] }[] = [
  {
    sub: 'feasibility',
    keywords: [
      'feasibility study',
      'feasibility',
      'prefeasibility',
      'pre-feasibility',
      'techno-economic',
      'viability',
      'business case',
      'bankable feasibility',
      'options appraisal',
      'scoping study',
      'needs assessment',
      'situational analysis',
      'market study',
      'market assessment',
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

// ---- Job-posting exclusion (consulting). ----
// An employment ad is not a consulting engagement. Any match here excludes the
// lead from consulting.
const JOB_TERMS = [
  'applying for a role',
  'employment position',
  'full-time',
  'full time',
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

// Fuel-module leads: fuel supply -> category 'fuel' with notice-type subcategory,
// product_type, cargo flag, and NOC sector; otherwise excluded.
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

// Non-fuel leads: advisory contract -> category 'consulting' with work-type
// subcategory; employment ads are excluded.
export function classifyConsulting(lead: NormalizedLead): Classification {
  const text = haystack(lead);
  if (isJobPosting(text)) return excluded();
  return {
    category: 'consulting',
    subcategory: consultingSubcategory(text),
    product_type: null,
    is_cargo: false,
    volume_estimate: null,
    sector: null,
  };
}
