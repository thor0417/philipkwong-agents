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
// Terms that mean the notice ITSELF is dead: award/intent notice TYPES and
// terminal STATUS words. Deliberately NOT the bare 'award' / 'awarded' /
// 'contract award' — those appear in the award-procedure boilerplate of LIVE
// tenders (e.g. World Bank RFPs describe how the contract "will be awarded"),
// so matching them hides live, actionable work. The notice-type/status terms
// below only appear when the opportunity is genuinely closed.
const DEAD_TERMS = [
  'award notice',
  'contract award notice',
  'advance contract award notice',
  'notice of intent',
  'cancelled',
  'canceled',
  'withdrawn',
  'superseded',
];
const FRAMEWORK_TERMS = ['framework agreement'];

function fuelSubcategory(source: string, text: string): string {
  if (isDeadNotice(text)) return 'award_or_dead';
  if (keywordMatches(text, FRAMEWORK_TERMS).length > 0) return 'framework';
  if (keywordMatches(text, RFP_TERMS).length > 0) return 'rfp';
  return GOV_SOURCES.has(source) ? 'gov_tender' : 'private_tender';
}

// Sources whose feed is awarded contracts only, not live opportunities: every
// lead from them is already dead. AusTender's OCDS feed exposes published
// (awarded) contract notices only (see sources/austender.ts).
const AWARDED_ONLY_SOURCES = new Set(['austender']);

// True when a lead is already awarded, cancelled, withdrawn, superseded, or an
// award/intent notice - by its source (awarded-only feeds) or its text.
// Cross-cutting: keeps dead notices out of the actionable set on every category.
export function isDeadNotice(lead: NormalizedLead | string): boolean {
  if (typeof lead !== 'string' && AWARDED_ONLY_SOURCES.has(lead.source)) return true;
  const text = typeof lead === 'string' ? lead : haystack(lead);
  return keywordMatches(text, DEAD_TERMS).length > 0;
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

// ---- Feasibility capture lane. An independent category checked across ALL
// leads (any profile, any source) before consulting scoring: a feasibility
// study RFP/tender is pulled out and written on legitimacy, never fit-scored. ----
//
// The trigger is deliberately narrow: only genuine feasibility/viability
// language qualifies. Adjacent advisory work — needs assessment, technical
// assistance, scoping study, options appraisal, evaluation, engineering design,
// procurement-document prep, situational analysis — is NOT feasibility and must
// route to consulting instead (it clears no term here, so it falls through to
// the consulting path). Broad tourism/leisure phrasing was removed too: a
// tourism development or master-plan tender is not a feasibility study. (IADB/CDB
// tourism notices are still captured on legitimacy via the separate sector gate
// in the orchestrator, independent of these terms.)
// Matching is whole-word (\bterm\b), so each "... study / assessment" phrase is
// listed in both singular and plural — "Feasibility Studies" is extremely common
// in RFP titles and would otherwise be missed. The bare "prefeasibility" /
// "pre-feasibility" forms already cover their study/studies variants.
const FEASIBILITY_TERMS = [
  'feasibility study',
  'feasibility studies',
  'feasibility assessment',
  'feasibility assessments',
  'prefeasibility',
  'pre-feasibility',
  'techno-economic study',
  'techno-economic studies',
  'viability study',
  'viability studies',
  'viability assessment',
  'viability assessments',
  'bankable feasibility',
  'market feasibility',
  'commercial feasibility',
  'economic feasibility',
];

// Best-guess sector, tagged as the feasibility subcategory. First match wins.
const FEASIBILITY_SECTORS: { sector: string; keywords: string[] }[] = [
  // Commercial leisure / culture sectors first: these terms are specific, and a
  // casino / hotel / theme park / museum project should tag distinctly rather
  // than falling into energy/water/infrastructure. Sector routing only runs on
  // leads already detected as feasibility, so breadth here is low-risk.
  { sector: 'gaming', keywords: ['casino', 'gaming', 'gambling', 'integrated resort'] },
  {
    sector: 'hospitality',
    keywords: ['hotel', 'resort', 'hospitality', 'lodging', 'accommodation', 'spa resort', 'golf resort', 'convention center', 'convention centre', 'conference center', 'conference centre', 'conference facility', 'mixed-use'],
  },
  {
    sector: 'entertainment',
    keywords: ['entertainment', 'theme park', 'amusement', 'waterpark', 'water park', 'cinema', 'arena', 'stadium', 'sports facility', 'family entertainment'],
  },
  {
    sector: 'cultural',
    keywords: ['museum', 'heritage', 'cultural', 'gallery', 'zoo', 'aquarium', 'science centre', 'science center', 'exhibition', 'arts', 'library'],
  },
  { sector: 'tourism', keywords: ['tourism', 'tourist', 'visitor economy', 'visitor attraction', 'visitor centre', 'visitor center', 'destination', 'ecotourism'] },
  { sector: 'leisure', keywords: ['leisure', 'recreation', 'marina', 'golf', 'spa', 'attraction', 'waterfront'] },
  { sector: 'energy', keywords: ['energy', 'power', 'electricity', 'solar', 'wind', 'hydro', 'grid', 'renewable', 'oil', 'gas', 'fuel', 'petroleum'] },
  { sector: 'water', keywords: ['water', 'sanitation', 'wastewater', 'sewage', 'drainage', 'irrigation'] },
  { sector: 'transport', keywords: ['transport', 'transit', 'highway', 'railway', 'rail', 'metro', 'road', 'bridge', 'port', 'airport', 'logistics', 'mobility'] },
  { sector: 'health', keywords: ['health', 'hospital', 'medical', 'clinic', 'pharmaceutical', 'disease'] },
  { sector: 'agriculture', keywords: ['agriculture', 'agri', 'farming', 'crop', 'livestock', 'food security'] },
  { sector: 'infrastructure', keywords: ['infrastructure', 'construction', 'building', 'housing', 'urban'] },
];

function feasibilitySector(text: string): string {
  for (const s of FEASIBILITY_SECTORS) {
    if (keywordMatches(text, s.keywords).length > 0) return s.sector;
  }
  return 'other';
}

// True when the lead is a feasibility study RFP/tender (feasibility language and
// not an employment ad for a feasibility role).
export function isFeasibilityLead(lead: NormalizedLead): boolean {
  const text = haystack(lead);
  return keywordMatches(text, FEASIBILITY_TERMS).length > 0 && !isJobPosting(text);
}

// Feasibility leads: category 'feasibility', best-guess sector as the subcategory.
export function classifyFeasibility(lead: NormalizedLead): Classification {
  return {
    category: 'feasibility',
    subcategory: feasibilitySector(haystack(lead)),
    product_type: null,
    is_cargo: false,
    volume_estimate: null,
    sector: null,
  };
}

// ---- TED specific-consultancy CPV capture lane. A TED notice classified by the
// EU under one of these SPECIFIC consultancy CPV codes is captured directly on
// CPV legitimacy: the EU already classified the work as this exact consultancy,
// so it needs no keyword prefilter and no Haiku fit scoring. Broad parent codes
// (79000000 business services, 79400000/79410000/79411000 general management
// consultancy) are deliberately excluded — they are too generic to be a fit
// signal on their own and stay on the keyword + Haiku path. ----
const SPECIFIC_CONSULTANCY_CPV = new Set([
  '79415000', // Operations management consultancy (Philip's operational architecture)
  '79418000', // Procurement consultancy services
  '79419000', // Evaluation consultancy services
  '71241000', // Feasibility study, advisory service, analysis
]);

// CPV codes are stamped into raw_content by the TED adapter as a "CPV: a, b, c"
// line (see sources/tedeu.ts). Pull that line and return the codes.
function cpvCodes(lead: NormalizedLead): string[] {
  const m = /^CPV:\s*(.*)$/m.exec(lead.raw_content);
  if (!m) return [];
  return m[1].split(',').map((c) => c.trim()).filter(Boolean);
}

// The specific-consultancy CPV codes present on a TED notice, in the canonical
// order above. Empty for non-TED sources and for notices carrying only broad
// parent codes (those stay on the keyword + Haiku path).
export function specificConsultancyCpvCodes(lead: NormalizedLead): string[] {
  if (lead.source !== 'tedeu') return [];
  return cpvCodes(lead).filter((c) => SPECIFIC_CONSULTANCY_CPV.has(c));
}

// ---- Signals-lane sector gate (Part B, LATAM/Caribbean). Bilingual (Spanish +
// English). This gate REPLACES the keyword prefilter for signal sources: a
// filing that names tourism/leisure/hospitality or agro-tourism work passes and
// is captured; anything else (a highway, a mine, generic infrastructure) is
// dropped. The EU-CPV lesson applied to registries: the sector IS the signal. ----
// Terms are stored UNACCENTED and matched against an accent-stripped haystack,
// so Spanish content ("turístico", "acuático") matches without listing every
// accented variant.
const TOURISM_TERMS = [
  'hotel', 'resort', 'turistico', 'turismo', 'tourism', 'tourist',
  'marina', 'campo de golf', 'golf course', 'golf', 'parque acuatico',
  'water park', 'waterpark', 'desarrollo turistico',
  'condominio', 'condominium', 'hospedaje', 'lodging', 'theme park', 'attraction',
  'casino', 'integrated resort', 'boutique hotel', 'eco resort', 'ecolodge', 'spa',
  // Cruise tourism (Caribbean HOAs are cruise-heavy: cruise lines, private
  // islands, and cruise-port developments are core leisure origination).
  'cruise', 'cruises', 'cruise line', 'cruise port', 'cruise terminal',
  // Tourism accommodation forms (regulator filings name the product, e.g. an
  // EIA for "Overwater Villas", not the word "resort").
  'villa', 'villas', 'overwater', 'beach resort', 'beach club',
];
// Agro-tourism (distilleries, wineries, estates). A match tags subcategory
// 'agro_tourism'.
const AGRO_TOURISM_TERMS = [
  'distillery', 'distilleria', 'destileria',
  'rum', 'ron', 'tequila', 'mezcal', 'agave', 'hacienda', 'plantation',
  'ingenio', 'winery', 'brewery', 'agroturismo', 'agro-tourism', 'agrotourism',
];

// Strip combining diacritics so unaccented terms match accented Spanish text.
function deaccent(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function isAgroTourism(text: string): boolean {
  return keywordMatches(deaccent(text), AGRO_TOURISM_TERMS).length > 0;
}

// True when a signal filing is in the tourism / leisure / hospitality / agro
// sector. Used as the signals-lane gate.
export function passesSectorGate(lead: NormalizedLead): boolean {
  const text = deaccent(haystack(lead));
  return keywordMatches(text, TOURISM_TERMS).length > 0 || isAgroTourism(text);
}

// Signals-lane subcategory: 'agro_tourism' when an agro term matched, else the
// best-guess leisure/tourism sector (reusing the feasibility sector map, which
// leads with the commercial-leisure sectors). Falls back to 'tourism'.
export function signalSector(lead: NormalizedLead): string {
  const text = haystack(lead);
  if (isAgroTourism(text)) return 'agro_tourism';
  const sector = feasibilitySector(deaccent(text));
  return sector === 'other' ? 'tourism' : sector;
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
