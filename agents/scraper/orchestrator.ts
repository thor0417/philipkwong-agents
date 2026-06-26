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
import { bestProfileFor, passesPrefilter } from './prefilter';
import { isBrokerNoise } from './broker-filter';
import { scoreLeads, type ScorerInput } from './scorer';

import { scrapeCanadaBuys } from './sources/canadabuys';
import { scrapeAdzuna } from './sources/adzuna';
import { scrapeJooble } from './sources/jooble';
import { scrapeReed } from './sources/reed';
import { scrapeCareerjet } from './sources/careerjet';
import { scrapeArbeitnow } from './sources/arbeitnow';
import { scrapeSamGov } from './sources/samgov';
import { scrapeTedEu } from './sources/tedeu';
import { scrapeAusTender } from './sources/austender';
import { scrapeUkTenders } from './sources/uktenders';
import { scrapeThailandGpp } from './sources/thailandgpp';
import { scrapeGeBiz } from './sources/gebiz';
import { scrapeUngm } from './sources/ungm';
import { scrapeGooglePlaces } from './sources/googleplaces';

const FUEL_MODULE = 'fuel';
const AGENT_NAME = 'lead-scraper';

// CPV codes for TED EU are profile-driven: fuel profile contributes its own
// codes, consulting profiles contribute the consulting set. The adapter is
// fetched once with the union; profile matching then sorts the notices.
function tedCpvCodes(profiles: IndustryProfile[]): string[] {
  const codes = new Set<string>();
  for (const p of profiles) {
    if (!p.sources.includes('tedeu')) continue;
    if (p.module === FUEL_MODULE) (p.tscodes?.cpv ?? []).forEach((c) => codes.add(c));
    else CONSULTING_CPV_CODES.forEach((c) => codes.add(c));
  }
  return [...codes];
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
    case 'samgov':
      return scrapeSamGov();
    case 'tedeu':
      return scrapeTedEu(tedCpvCodes(profiles));
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

interface PreparedLead {
  lead: NormalizedLead;
  profile: IndustryProfile;
  fuel: boolean;
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
  fuelFound: number;
  fuelBrokerExcluded: number;
  fuelReachedHaiku: number;
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
  const deduped = [...dedupedMap.values()];

  // 3. Per-lead: profile match -> fuel tag -> broker-filter -> prefilter.
  const fuelProfile = profiles.find((p) => p.module === FUEL_MODULE);
  const prepared: PreparedLead[] = [];
  let prefilterFiltered = 0;
  let brokerExcluded = 0;
  let fuelFound = 0;
  let fuelBrokerExcluded = 0;
  let fuelReachedHaiku = 0;

  for (const lead of deduped) {
    const text = haystack(lead);
    const candidates = profiles.filter((p) => p.sources.includes(lead.source));
    if (candidates.length === 0) continue;

    // Fuel tag: lead matched the fuel profile keywords (and fuel is a candidate).
    const fuelCandidate =
      fuelProfile && candidates.includes(fuelProfile) ? fuelProfile : undefined;
    const isFuel = !!fuelCandidate && passesPrefilter(text, fuelCandidate).passed;
    if (isFuel) fuelFound++;

    // Broker-filter runs on fuel-tagged leads before prefilter/Haiku.
    if (isFuel) {
      const broker = isBrokerNoise(text);
      if (broker.isNoise) {
        brokerExcluded++;
        fuelBrokerExcluded++;
        continue; // hard exclude, score 0, never scored or written
      }
    }

    // Prefilter gate: assign to the best matching profile clearing its threshold.
    const best = bestProfileFor(text, candidates);
    if (!best) {
      prefilterFiltered++;
      continue;
    }

    if (isFuel) fuelReachedHaiku++;
    prepared.push({ lead, profile: best.profile, fuel: isFuel });
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
    console.log(`DRY_RUN: ${prepared.length} leads would be scored by Haiku (skipped).`);
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
      fuelFound,
      fuelBrokerExcluded,
      fuelReachedHaiku,
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

  // 5. Write leads scoring >= the matched profile's minScore.
  const writtenPerSource: Record<string, number> = {};
  const writtenPerModule: Record<string, number> = {};
  const writtenPerIndustry: Record<string, number> = {};
  let written = 0;

  for (let i = 0; i < prepared.length; i++) {
    const { lead, profile } = prepared[i];
    const { score, score_reason } = scores[i];
    if (score < profile.minScore) continue;

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
  }

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
    fuelFound,
    fuelBrokerExcluded,
    fuelReachedHaiku,
  };
}

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
  console.log(`Reached Haiku scoring: ${r.scored}`);
  console.log(`Written to Supabase (>= minScore): ${r.written}`);
  console.log('Written per source:');
  console.log(table(r.writtenPerSource));
  console.log('Written per module:');
  console.log(table(r.writtenPerModule));
  console.log('Written per industry:');
  console.log(table(r.writtenPerIndustry));
  console.log('--- Fuel module ---');
  console.log(`  Fuel tenders found:          ${r.fuelFound}`);
  console.log(`  Excluded by broker-filter:   ${r.fuelBrokerExcluded}`);
  console.log(`  Reached Haiku scoring:       ${r.fuelReachedHaiku}`);
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
