// Scraper engine orchestrator.
//
// Pipeline (per the spec + fuel addendum), in strict order:
//   fetch active sources once  ->  normalize  ->  dedupe by URL
//   ->  profile match  ->  fuel tag  ->  broker-filter (if fuel-tagged)
//   ->  prefilter (per-profile minKeywordMatches)  ->  Haiku scoring
//   ->  set module + industry  ->  write to Supabase (score >= profile.minScore)
//
// One source failing only drops that source (Promise.allSettled); the run never
// crashes. Run it: npm run scrape:all

import { supabaseAdmin } from '../../lib/supabase-admin';
import type { NormalizedLead } from './sources/types';
import {
  activeProfiles,
  activeSources,
  CONSULTING_CPV_CODES,
  type IndustryProfile,
} from './profiles';
import { bestProfileFor, passesPrefilter, keywordMatches } from './prefilter';
import { isBrokerNoise } from './broker-filter';
import { classifyFuel, classifyConsulting, isFeasibilityLead, classifyFeasibility } from './classify';
import { scoreLeads, type ScorerInput } from './scorer';
import { crossReference, normalizeCompany } from './cross-reference';
// PARKED (Track B registry): import re-enabled when the registry pass returns.
// import type { RegistryLead } from './sources/types';

import { scrapeCanadaBuys } from './sources/canadabuys';
import { scrapeAdzuna } from './sources/adzuna';
import { scrapeJooble } from './sources/jooble';
import { scrapeReed } from './sources/reed';
import { scrapeCareerjet } from './sources/careerjet';
import { scrapeArbeitnow } from './sources/arbeitnow';
import { scrapeJSearch } from './sources/jsearch';
import { scrapeSamGov } from './sources/samgov';
import { scrapeTedEu } from './sources/tedeu';
import { scrapeAusTender } from './sources/austender';
import { scrapeUkTenders } from './sources/uktenders';
import { scrapeThailandGpp } from './sources/thailandgpp';
import { scrapeGeBiz } from './sources/gebiz';
import { scrapeUngm } from './sources/ungm';
import { scrapeGooglePlaces } from './sources/googleplaces';
import { scrapeTenderNed } from './sources/tenderned';
import { scrapeTexasEsbd } from './sources/texasesbd';
import { scrapeWorldBank } from './sources/worldbank';
import { scrapeAdb } from './sources/adb';
import { scrapeAfdb } from './sources/afdb';
import { scrapeUndp } from './sources/undp';
// PARKED (Track B registry): re-enable these imports with the registry pass.
// import { scrapeMpaRegistry } from './sources/mpa';
// import { scrapeRotterdamRegistry } from './sources/portofrotterdam';

const FUEL_MODULE = 'fuel';
const AGENT_NAME = 'lead-scraper';
// Fuel leads are captured on legitimacy (broker-filtered, CPV/UNSPSC-routed),
// not on consulting fit. They are written with a fixed high score so the
// supplier sees them prioritized; they are never Haiku-scored.
const FUEL_CAPTURE_SCORE = 100;
// PARKED (Track B registry): fixed baseline score for licensed registry leads.
// const REGISTRY_BASELINE = 70;

// Region tag per source for tender leads.
const SOURCE_REGION: Record<string, string> = {
  tenderned: 'NL',
  tedeu: 'EU',
  gebiz: 'SG',
  ungm: 'GLOBAL',
  worldbank: 'GLOBAL',
  adb: 'GLOBAL',
  afdb: 'GLOBAL',
  undp: 'GLOBAL',
  canadabuys: 'CA',
  adzuna: 'CA',
  jooble: 'CA',
  reed: 'UK',
  careerjet: 'CA',
  arbeitnow: 'EU',
  jsearch: 'CA',
  samgov: 'US',
  texasesbd: 'US',
  austender: 'AU',
  uktenders: 'UK',
  thailandgpp: 'TH',
  googleplaces: 'GLOBAL',
};
const regionOf = (source: string): string => SOURCE_REGION[source] ?? 'GLOBAL';

// Fuel CPV codes only (for TenderNed, which is fuel/Rotterdam-specific).
function fuelCpvCodes(profiles: IndustryProfile[]): string[] {
  const fuel = profiles.find((p) => p.module === FUEL_MODULE);
  return fuel?.tscodes?.cpv ?? [];
}

// CPV codes for TED EU are profile-driven and split by group so each gets its
// own result budget in the adapter. Fuel: the fuel profile's own CPV codes
// (only if it pulls from TED). Consulting: the shared consulting set (only if
// some non-fuel profile pulls from TED).
function tedFuelCpvCodes(profiles: IndustryProfile[]): string[] {
  const fuel = profiles.find((p) => p.module === FUEL_MODULE && p.sources.includes('tedeu'));
  return fuel?.tscodes?.cpv ?? [];
}
function tedConsultingCpvCodes(profiles: IndustryProfile[]): string[] {
  const anyConsulting = profiles.some(
    (p) => p.module !== FUEL_MODULE && p.sources.includes('tedeu')
  );
  return anyConsulting ? [...CONSULTING_CPV_CODES] : [];
}

function fetchSource(id: string, profiles: IndustryProfile[]): Promise<NormalizedLead[]> {
  switch (id) {
    case 'canadabuys':
      return scrapeCanadaBuys();
    case 'adzuna':
      return scrapeAdzuna();
    case 'jooble':
      return scrapeJooble();
    case 'reed':
      return scrapeReed();
    case 'careerjet':
      return scrapeCareerjet();
    case 'arbeitnow':
      return scrapeArbeitnow();
    case 'jsearch':
      return scrapeJSearch();
    case 'samgov':
      return scrapeSamGov();
    case 'tedeu':
      return scrapeTedEu(tedFuelCpvCodes(profiles), tedConsultingCpvCodes(profiles));
    case 'austender':
      return scrapeAusTender();
    case 'uktenders':
      return scrapeUkTenders();
    case 'thailandgpp':
      return scrapeThailandGpp();
    case 'gebiz':
      return scrapeGeBiz();
    case 'ungm':
      return scrapeUngm();
    case 'tenderned':
      return scrapeTenderNed(fuelCpvCodes(profiles));
    case 'texasesbd':
      return scrapeTexasEsbd();
    case 'worldbank':
      return scrapeWorldBank();
    case 'adb':
      return scrapeAdb();
    case 'afdb':
      return scrapeAfdb();
    case 'undp':
      return scrapeUndp();
    case 'googleplaces':
      return scrapeGooglePlaces();
    default:
      console.warn(`Orchestrator: unknown source "${id}", skipping.`);
      return Promise.resolve([]);
  }
}

function haystack(lead: NormalizedLead): string {
  return [lead.title, lead.raw_content, lead.company ?? '', lead.location ?? ''].join('\n');
}

// A lead is expired only when it states a deadline already in the past. A
// missing/unparseable deadline is NOT expired (we keep it; many buy-side notices
// publish no deadline).
function isExpired(deadline: string | null, now: number): boolean {
  if (!deadline) return false;
  const t = new Date(deadline).getTime();
  if (Number.isNaN(t)) return false;
  return t < now;
}

interface PreparedLead {
  lead: NormalizedLead;
  profile: IndustryProfile;
}

export interface ScrapeReport {
  fetchedPerSource: Record<string, number>;
  totalFetched: number;
  deduped: number;
  prefilterFiltered: number;
  brokerExcluded: number;
  scored: number;
  written: number;
  writtenPerSource: Record<string, number>;
  writtenPerModule: Record<string, number>;
  writtenPerIndustry: Record<string, number>;
  writtenPerRegion: Record<string, number>;
  writtenPerLeadType: Record<string, number>;
  fuelFound: number;
  fuelBrokerExcluded: number;
  fuelExcluded: number;
  fuelExpired: number;
  fuelWritten: number;
  fuelWrittenPerSource: Record<string, number>;
  fuelWrittenPerRegion: Record<string, number>;
  // Feasibility capture lane (independent category, no fit scoring).
  feasibilityFound: number;
  feasibilityExpired: number;
  feasibilityWritten: number;
  feasibilityPerSource: Record<string, number>;
  feasibilityPerSector: Record<string, number>;
  // Track B registry pass.
  registryWritten: number;
  registryPerSource: Record<string, number>;
  registryPerRegion: Record<string, number>;
  // Cross-reference post-pass.
  matchedCounterparty: number;
}

const inc = (m: Record<string, number>, k: string): void => {
  m[k] = (m[k] ?? 0) + 1;
};

export async function orchestrate(): Promise<ScrapeReport> {
  const profiles = activeProfiles();
  const sources = activeSources();
  console.log(`Active profiles: ${profiles.map((p) => p.name).join(', ')}`);
  console.log(`Active sources: ${sources.join(', ')}`);

  // 1. Fetch every active source once, tolerating individual failures.
  const settled = await Promise.allSettled(sources.map((s) => fetchSource(s, profiles)));
  const fetchedPerSource: Record<string, number> = {};
  const all: NormalizedLead[] = [];
  sources.forEach((s, i) => {
    const r = settled[i];
    if (r.status === 'fulfilled') {
      fetchedPerSource[s] = r.value.length;
      all.push(...r.value);
    } else {
      fetchedPerSource[s] = 0;
      console.error(`Source "${s}" failed:`, r.reason);
    }
  });

  // 2. Dedupe by URL (first occurrence wins).
  const dedupedMap = new Map<string, NormalizedLead>();
  for (const l of all) {
    if (l.url && !dedupedMap.has(l.url)) dedupedMap.set(l.url, l);
  }
  let deduped = [...dedupedMap.values()];

  // 2b. NL publishes to both TED and TenderNed. Drop TenderNed rows whose
  // normalized title + buyer already appears in a TED row.
  const xKey = (l: NormalizedLead): string =>
    `${normalizeCompany(l.title)}|${normalizeCompany(l.company ?? '')}`;
  const tedKeys = new Set(deduped.filter((l) => l.source === 'tedeu').map(xKey));
  const beforeXdedupe = deduped.length;
  deduped = deduped.filter((l) => !(l.source === 'tenderned' && tedKeys.has(xKey(l))));
  const tenderNedDropped = beforeXdedupe - deduped.length;
  if (tenderNedDropped > 0) {
    console.log(`TenderNed: ${tenderNedDropped} rows dropped as duplicates of TED.`);
  }

  // 3. Per-lead routing.
  //  - Fuel-tagged leads take the CAPTURE path: broker-filter, then
  //    expired-deadline filter, then write everything that passes. No Haiku,
  //    no consulting fit, no minimum value. Any real, current buy-side fuel
  //    buyer is brought in; the supplier decides what is worth pursuing.
  //  - Everything else takes the non-fuel path: prefilter -> Haiku scorer,
  //    written only at/above the matched profile's minScore (unchanged).
  const fuelProfile = profiles.find((p) => p.module === FUEL_MODULE);
  const prepared: PreparedLead[] = [];
  const fuelPrepared: NormalizedLead[] = [];
  const feasibilityPrepared: NormalizedLead[] = [];
  let prefilterFiltered = 0;
  let brokerExcluded = 0;
  let fuelFound = 0;
  let fuelBrokerExcluded = 0;
  let fuelExcluded = 0;
  let fuelExpired = 0;
  let feasibilityFound = 0;
  let feasibilityExpired = 0;
  const now = Date.now();

  for (const lead of deduped) {
    const text = haystack(lead);

    // Feasibility capture lane: runs FIRST, across every lead from any source,
    // before fuel or consulting routing. A feasibility study RFP/tender is
    // captured on legitimacy (not expired) and written with no Haiku fit
    // scoring, exactly like the fuel path. Feasibility work appears everywhere
    // (gov tenders, dev-bank RFPs, energy/infrastructure), so it must not be
    // gated by consulting keywords, consulting sources, or the minScore filter.
    if (isFeasibilityLead(lead)) {
      feasibilityFound++;
      if (isExpired(lead.deadline, now)) {
        feasibilityExpired++;
        continue;
      }
      feasibilityPrepared.push(lead);
      continue;
    }

    const candidates = profiles.filter((p) => p.sources.includes(lead.source));
    if (candidates.length === 0) continue;

    // Fuel tag: lead matched the fuel profile keywords (and fuel is a candidate).
    const fuelCandidate =
      fuelProfile && candidates.includes(fuelProfile) ? fuelProfile : undefined;
    const isFuel = !!fuelCandidate && passesPrefilter(text, fuelCandidate).passed;

    if (isFuel) {
      fuelFound++;
      // Broker noise: hard exclude (the only legitimacy gate besides the codes).
      if (isBrokerNoise(text).isNoise) {
        brokerExcluded++;
        fuelBrokerExcluded++;
        continue;
      }
      // Non-fuel uses of the same commodity (e.g. ethanol as hand sanitizer,
      // beverage grade, pharmaceutical, industrial solvent) are hard-excluded via
      // the matched fuel profile's excludeKeywords. Fuel-path only: mirrors the
      // broker filter above and never touches the non-fuel Haiku path. For
      // fuel_tenders these mirror broker terms already dropped, so it is a no-op
      // there; for ethanol_gulf it removes the non-fuel-ethanol noise.
      if (keywordMatches(text, fuelCandidate!.excludeKeywords).length > 0) {
        fuelExcluded++;
        continue;
      }
      // Drop only clearly expired notices; keep those with no deadline stated.
      if (isExpired(lead.deadline, now)) {
        fuelExpired++;
        continue;
      }
      fuelPrepared.push(lead); // captured; never goes to the Haiku scorer
      continue;
    }

    // Non-fuel prefilter gate: assign to the best matching profile clearing its
    // threshold, then score with Haiku.
    const best = bestProfileFor(text, candidates);
    if (!best) {
      prefilterFiltered++;
      continue;
    }
    prepared.push({ lead, profile: best.profile });
  }

  // 4. Score survivors with Haiku.
  const inputs: ScorerInput[] = prepared.map((p) => ({
    title: p.lead.title,
    raw_content: p.lead.raw_content,
    source: p.lead.source,
    industry: p.profile.name,
  }));
  // DRY_RUN=1 measures volume without spending: skip Haiku scoring and writes.
  if (process.env.DRY_RUN === '1') {
    console.log(
      `DRY_RUN: ${prepared.length} non-fuel leads would be Haiku-scored; ` +
        `${fuelPrepared.length} fuel leads and ${feasibilityPrepared.length} feasibility ` +
        `leads would be written directly (no Haiku).`
    );
    return {
      fetchedPerSource,
      totalFetched: all.length,
      deduped: deduped.length,
      prefilterFiltered,
      brokerExcluded,
      scored: prepared.length,
      written: 0,
      writtenPerSource: {},
      writtenPerModule: {},
      writtenPerIndustry: {},
      writtenPerRegion: {},
      writtenPerLeadType: {},
      fuelFound,
      fuelBrokerExcluded,
      fuelExcluded,
      fuelExpired,
      fuelWritten: 0,
      fuelWrittenPerSource: {},
      fuelWrittenPerRegion: {},
      feasibilityFound,
      feasibilityExpired,
      feasibilityWritten: 0,
      feasibilityPerSource: {},
      feasibilityPerSector: {},
      registryWritten: 0,
      registryPerSource: {},
      registryPerRegion: {},
      matchedCounterparty: 0,
    };
  }

  const scores = await scoreLeads(inputs);

  // DEBUG_SCORES=1 prints every scored lead (pre-threshold, high to low).
  if (process.env.DEBUG_SCORES === '1') {
    console.log('--- scored leads (pre-threshold) ---');
    const rows = prepared
      .map((p, i) => ({ p, s: scores[i] }))
      .sort((a, b) => b.s.score - a.s.score);
    for (const { p, s } of rows) {
      console.log(
        `[${String(s.score).padStart(3)}] ${p.profile.module}/${p.lead.source} | ` +
          `${p.lead.title.slice(0, 60)} :: ${s.score_reason}`
      );
    }
    console.log('--- end scored leads ---');
  }

  // TED_DEBUG=1 prints the Haiku score for every TED lead, plus where TED rows
  // are lost (dedupe vs prefilter vs scoring below floor). Diagnostic only: it
  // does not change the write threshold.
  if (process.env.TED_DEBUG === '1') {
    const tedFetched = fetchedPerSource['tedeu'] ?? 0;
    const tedDeduped = deduped.filter((l) => l.source === 'tedeu').length;
    const tedRows = prepared
      .map((p, i) => ({ p, s: scores[i] }))
      .filter((r) => r.p.lead.source === 'tedeu')
      .sort((a, b) => b.s.score - a.s.score);

    console.log('\n--- TED score debug pass ---');
    console.log(`TED fetched (raw):  ${tedFetched}`);
    console.log(`TED after dedupe:   ${tedDeduped}  (dropped at dedupe: ${tedFetched - tedDeduped})`);
    console.log(
      `TED reached Haiku:  ${tedRows.length}  (dropped at prefilter/no-profile: ${tedDeduped - tedRows.length})`
    );

    const buckets = { hi: 0, mid: 0, low: 0, under: 0 };
    let wouldWrite = 0;
    for (const { p, s } of tedRows) {
      const floor = p.profile.minScore;
      const pass = s.score >= floor;
      if (pass) wouldWrite++;
      if (s.score >= 80) buckets.hi++;
      else if (s.score >= 60) buckets.mid++;
      else if (s.score >= 40) buckets.low++;
      else buckets.under++;
      console.log(
        `  [${String(s.score).padStart(3)}] ${p.profile.module}/${p.profile.name} floor=${floor} ` +
          `${pass ? 'PASS' : 'fail'} :: ${p.lead.title.slice(0, 70)} :: ${s.score_reason}`
      );
    }
    console.log(
      `Distribution: >=80:${buckets.hi}  60-79:${buckets.mid}  40-59:${buckets.low}  <40:${buckets.under}`
    );
    console.log(
      `Would write (score >= matched profile floor): ${wouldWrite} of ${tedRows.length} scored`
    );
    console.log('--- end TED score debug pass ---\n');
  }

  // 5. Write tender leads scoring >= the matched profile's minScore.
  const writtenPerSource: Record<string, number> = {};
  const writtenPerModule: Record<string, number> = {};
  const writtenPerIndustry: Record<string, number> = {};
  const writtenPerRegion: Record<string, number> = {};
  const writtenPerLeadType: Record<string, number> = {};
  let written = 0;

  for (let i = 0; i < prepared.length; i++) {
    const { lead, profile } = prepared[i];
    const { score, score_reason } = scores[i];
    if (score < profile.minScore) continue;
    const region = regionOf(lead.source);
    const tags = classifyConsulting(lead);

    const { error } = await supabaseAdmin.from('leads').upsert(
      {
        source: lead.source,
        url: lead.url,
        title: lead.title,
        raw_content: lead.raw_content,
        score,
        score_reason,
        status: 'new',
        module: profile.module,
        industry: profile.name,
        company: lead.company,
        location: lead.location,
        deadline: lead.deadline,
        value_estimate: lead.value_estimate,
        lead_type: 'tender',
        region,
        category: tags.category,
        subcategory: tags.subcategory,
        product_type: tags.product_type,
        is_cargo: tags.is_cargo,
        volume_estimate: tags.volume_estimate,
        sector: tags.sector,
      },
      { onConflict: 'url' }
    );
    if (error) {
      console.error(`Write failed for ${lead.url}: ${error.message}`);
      continue;
    }
    written++;
    inc(writtenPerSource, lead.source);
    inc(writtenPerModule, profile.module);
    inc(writtenPerIndustry, profile.name);
    inc(writtenPerRegion, region);
    inc(writtenPerLeadType, 'tender');
  }

  // 5b. Fuel capture write path: broker-filtered, non-expired buy-side fuel
  // tenders written directly with a fixed capture score (no Haiku fit scoring).
  const fuelWrittenPerSource: Record<string, number> = {};
  const fuelWrittenPerRegion: Record<string, number> = {};
  let fuelWritten = 0;
  const fuelIndustry = fuelProfile?.name ?? 'fuel_tenders';
  for (const lead of fuelPrepared) {
    const region = regionOf(lead.source);
    const tags = classifyFuel(lead);
    const { error } = await supabaseAdmin.from('leads').upsert(
      {
        source: lead.source,
        url: lead.url,
        title: lead.title,
        raw_content: lead.raw_content,
        score: FUEL_CAPTURE_SCORE,
        score_reason:
          'Buy-side fuel tender captured on legitimacy (broker-filtered, CPV/UNSPSC-routed); not fit-scored.',
        status: 'new',
        module: FUEL_MODULE,
        industry: fuelIndustry,
        company: lead.company,
        location: lead.location,
        deadline: lead.deadline,
        value_estimate: lead.value_estimate,
        lead_type: 'tender',
        region,
        category: tags.category,
        subcategory: tags.subcategory,
        product_type: tags.product_type,
        is_cargo: tags.is_cargo,
        volume_estimate: tags.volume_estimate,
        sector: tags.sector,
      },
      { onConflict: 'url' }
    );
    if (error) {
      console.error(`Fuel write failed for ${lead.url}: ${error.message}`);
      continue;
    }
    fuelWritten++;
    written++;
    inc(fuelWrittenPerSource, lead.source);
    inc(fuelWrittenPerRegion, region);
    inc(writtenPerSource, lead.source);
    inc(writtenPerModule, FUEL_MODULE);
    inc(writtenPerIndustry, fuelIndustry);
    inc(writtenPerRegion, region);
    inc(writtenPerLeadType, 'tender');
  }

  // 5c. Feasibility capture write path: non-expired feasibility study RFPs/
  // tenders written directly, no Haiku fit scoring and no minScore. Score is
  // left null (captured on legitimacy, not fit-ranked); the subcategory carries
  // the best-guess sector.
  const feasibilityPerSource: Record<string, number> = {};
  const feasibilityPerSector: Record<string, number> = {};
  let feasibilityWritten = 0;
  for (const lead of feasibilityPrepared) {
    const region = regionOf(lead.source);
    const tags = classifyFeasibility(lead);
    const { error } = await supabaseAdmin.from('leads').upsert(
      {
        source: lead.source,
        url: lead.url,
        title: lead.title,
        raw_content: lead.raw_content,
        score: null,
        score_reason: 'Feasibility study captured on legitimacy (feasibility lane); not fit-scored.',
        status: 'new',
        module: 'feasibility',
        industry: 'feasibility',
        company: lead.company,
        location: lead.location,
        deadline: lead.deadline,
        value_estimate: lead.value_estimate,
        lead_type: 'tender',
        region,
        category: tags.category,
        subcategory: tags.subcategory,
        product_type: tags.product_type,
        is_cargo: tags.is_cargo,
        volume_estimate: tags.volume_estimate,
        sector: tags.sector,
      },
      { onConflict: 'url' }
    );
    if (error) {
      console.error(`Feasibility write failed for ${lead.url}: ${error.message}`);
      continue;
    }
    feasibilityWritten++;
    written++;
    inc(feasibilityPerSource, lead.source);
    inc(feasibilityPerSector, tags.subcategory ?? 'other');
    inc(writtenPerSource, lead.source);
    inc(writtenPerModule, 'feasibility');
    inc(writtenPerIndustry, 'feasibility');
    inc(writtenPerRegion, region);
    inc(writtenPerLeadType, 'tender');
  }

  // 6. Track B registry pass: PARKED. The MPA/Rotterdam registry write path is
  // disabled; it no longer writes registry leads on a run. Re-enable by
  // restoring runRegistryPass() and its imports below.
  // const registry = await runRegistryPass();
  // for (const region of Object.keys(registry.perRegion)) {
  //   writtenPerRegion[region] = (writtenPerRegion[region] ?? 0) + registry.perRegion[region];
  // }
  // if (registry.written > 0) writtenPerLeadType['registry'] = registry.written;

  // 7. Cross-reference post-pass: match registries against tenders.
  const xref = await crossReference();

  return {
    fetchedPerSource,
    totalFetched: all.length,
    deduped: deduped.length,
    prefilterFiltered,
    brokerExcluded,
    scored: prepared.length,
    written,
    writtenPerSource,
    writtenPerModule,
    writtenPerIndustry,
    writtenPerRegion,
    writtenPerLeadType,
    fuelFound,
    fuelBrokerExcluded,
    fuelExcluded,
    fuelExpired,
    fuelWritten,
    fuelWrittenPerSource,
    fuelWrittenPerRegion,
    feasibilityFound,
    feasibilityExpired,
    feasibilityWritten,
    feasibilityPerSource,
    feasibilityPerSector,
    // Track B registry pass parked: always zero until re-enabled.
    registryWritten: 0,
    registryPerSource: {},
    registryPerRegion: {},
    matchedCounterparty: xref.matched,
  };
}

/* PARKED (Track B registry): the MPA/Rotterdam registry write path is disabled.
   Re-enable by uncommenting this block plus the imports and REGISTRY_BASELINE
   above, and the call site in orchestrate().
interface RegistryPassResult {
  written: number;
  perSource: Record<string, number>;
  perRegion: Record<string, number>;
}

// Fetch and write Track B registry leads. Licensed entities are legitimate by
// definition: no broker-filter, no Haiku, written with a fixed baseline score.
async function runRegistryPass(): Promise<RegistryPassResult> {
  const settled = await Promise.allSettled([scrapeMpaRegistry(), scrapeRotterdamRegistry()]);
  const all: RegistryLead[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') all.push(...r.value);
    else console.error('Registry source failed:', r.reason);
  }

  // Dedupe by URL (unique per company).
  const byUrl = new Map<string, RegistryLead>();
  for (const l of all) {
    if (l.url && !byUrl.has(l.url)) byUrl.set(l.url, l);
  }

  const perSource: Record<string, number> = {};
  const perRegion: Record<string, number> = {};
  let written = 0;
  for (const l of byUrl.values()) {
    const { error } = await supabaseAdmin.from('leads').upsert(
      {
        source: l.source,
        url: l.url,
        title: l.company,
        raw_content: l.raw_content,
        score: REGISTRY_BASELINE,
        score_reason: 'Licensed fuel entity (Track B registry); not Haiku-scored.',
        status: 'new',
        module: FUEL_MODULE,
        industry: 'fuel_supply',
        company: l.company,
        location: l.port,
        lead_type: 'registry',
        license_type: l.license_type,
        port: l.port,
        region: l.region,
      },
      { onConflict: 'url' }
    );
    if (error) {
      console.error(`Registry write failed for ${l.url}: ${error.message}`);
      continue;
    }
    written++;
    inc(perSource, l.source);
    inc(perRegion, l.region);
  }
  console.log(`Registry pass: wrote ${written} registry leads.`);
  return { written, perSource, perRegion };
}
*/

function printReport(r: ScrapeReport): void {
  const table = (m: Record<string, number>): string =>
    Object.keys(m).length
      ? Object.entries(m)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `    ${String(v).padStart(4)}  ${k}`)
          .join('\n')
      : '    (none)';

  console.log('\n========== SCRAPE REPORT ==========');
  console.log('Fetched per source:');
  console.log(table(r.fetchedPerSource));
  console.log(`Total fetched: ${r.totalFetched}  ->  deduped: ${r.deduped}`);
  console.log(`Prefilter filtered (zero API cost): ${r.prefilterFiltered}`);
  console.log(`Broker-noise excluded: ${r.brokerExcluded}`);
  console.log(`Reached Haiku scoring (non-fuel): ${r.scored}`);
  console.log(`Written to Supabase (tenders, incl. fuel capture): ${r.written}`);
  console.log('Written per source:');
  console.log(table(r.writtenPerSource));
  console.log('Written per module:');
  console.log(table(r.writtenPerModule));
  console.log('Written per industry:');
  console.log(table(r.writtenPerIndustry));
  console.log('Written per region:');
  console.log(table(r.writtenPerRegion));
  console.log('Written per lead_type:');
  console.log(table(r.writtenPerLeadType));
  console.log('--- Feasibility lane (independent capture, no fit scoring) ---');
  console.log(`  Feasibility studies found:   ${r.feasibilityFound}`);
  console.log(`  Dropped (expired deadline):  ${r.feasibilityExpired}`);
  console.log(`  Written (all legit):         ${r.feasibilityWritten}`);
  console.log('  Feasibility per source:');
  console.log(table(r.feasibilityPerSource));
  console.log('  Feasibility per sector:');
  console.log(table(r.feasibilityPerSector));
  console.log('--- Track B registry ---');
  console.log(`  Registry leads written: ${r.registryWritten}`);
  console.log('  Registry per source:');
  console.log(table(r.registryPerSource));
  console.log('  Registry per region:');
  console.log(table(r.registryPerRegion));
  console.log(`Matched counterparty (registry <-> tender): ${r.matchedCounterparty}`);
  console.log('--- Fuel module (legitimacy capture, no fit scoring) ---');
  console.log(`  Fuel tenders found:          ${r.fuelFound}`);
  console.log(`  Excluded by broker-filter:   ${r.fuelBrokerExcluded}`);
  console.log(`  Excluded (non-fuel use):     ${r.fuelExcluded}`);
  console.log(`  Dropped (expired deadline):  ${r.fuelExpired}`);
  console.log(`  Written (all legit buy-side): ${r.fuelWritten}`);
  console.log('  Fuel written per source:');
  console.log(table(r.fuelWrittenPerSource));
  console.log('  Fuel written per region:');
  console.log(table(r.fuelWrittenPerRegion));
  if (r.fuelFound === 0) {
    console.log('  ** FAILURE: zero fuel tenders found. This is a reportable failure, not a pass. **');
  }
  console.log('===================================\n');
}

async function main(): Promise<void> {
  console.log('Scraper engine starting...');
  await supabaseAdmin
    .from('agents')
    .update({ status: 'running', last_run: new Date().toISOString() })
    .eq('name', AGENT_NAME);

  try {
    const report = await orchestrate();
    printReport(report);
    await supabaseAdmin
      .from('agents')
      .update({ status: 'idle', leads_found: report.written, error: null })
      .eq('name', AGENT_NAME);
  } catch (error) {
    console.error('Orchestrator failed:', error);
    await supabaseAdmin
      .from('agents')
      .update({ status: 'error', error: String(error) })
      .eq('name', AGENT_NAME);
    process.exitCode = 1;
  }
}

main();
