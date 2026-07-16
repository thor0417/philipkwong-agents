// Standalone GLI Tier 1 opportunity lane (npm run scrape:opportunity).
//
// Fetches ONLY the opportunity-lane sources (leisure/tourism advisory
// procurement portals + development banks), routes them through the shared
// opportunity gate (isLeisureOpportunity) and tagging (tagOpportunities), and
// writes module 'gli', stream 'opportunity', lead_type 'tender'. It fires none
// of the fuel, consulting, signals, or GLI-news paths and runs no full Haiku
// scoring: only matched leisure opportunities are LLM-tagged. This is the cheap,
// fast validation path for Tier 1. The full orchestrator (scrape:all) runs the
// same lane in production via the shared buildOpportunityRow row shape below, so
// a validation run writes exactly what production writes.
//
// Set OPPORTUNITY_NO_WRITE=1 to fetch + gate + tag and print the report without
// writing to Supabase (a zero-cost-to-Supabase dry validation).

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../lib/supabase-admin';
import type { NormalizedLead } from './sources/types';
import { LEISURE_CPV_CODES } from './profiles';
import { isLeisureOpportunity, isDeadNotice } from './classify';
import { tagOpportunities, sourceTier, type OpportunityTag } from './gli';
import { regionFor, regionOf } from './regions';
import { developmentCategory } from './development-category';

import { scrapeTedEu } from './sources/tedeu';
import { scrapeCanadaBuys } from './sources/canadabuys';
import { scrapeUkTenders } from './sources/uktenders';
import { scrapeAusTender } from './sources/austender';
import { scrapeUngm } from './sources/ungm';
import { scrapeGeBiz } from './sources/gebiz';
import { scrapeWorldBank } from './sources/worldbank';
import { scrapeIadb } from './sources/iadb';
import { scrapeAdb } from './sources/adb';
import { scrapeCdb } from './sources/cdb';
import { scrapeAfdb } from './sources/afdb';
import { scrapeUndp } from './sources/undp';

const OPPORTUNITY_MODULE = 'gli';

// Opportunity-lane sources: leisure/tourism advisory procurement portals plus the
// development banks. TED runs its leisure CPV group only (its own budget). Job
// boards, fuel-only portals, the GLI-news Serper lane, and the signal sources are
// intentionally excluded. Order matches the fetch array below.
export const OPPORTUNITY_SOURCES = [
  'tedeu', 'canadabuys', 'uktenders', 'austender', 'ungm', 'gebiz',
  'worldbank', 'iadb', 'adb', 'cdb', 'afdb', 'undp',
];

// Shared write shape for a Tier 1 opportunity lead, used by BOTH this standalone
// entrypoint and the full orchestrator (5d-bis) so the two never drift. Returns
// the row plus the resolved region (the caller needs region for its own tallies
// and LATAM accounting).
export function buildOpportunityRow(
  lead: NormalizedLead,
  tag: OpportunityTag
): { region: string; row: Record<string, unknown> } {
  const region = regionFor(lead, regionOf(lead.source));
  const tier = sourceTier(lead.url);
  const closed = opportunityClosed(lead);
  return {
    region,
    row: {
      source: lead.source,
      url: lead.url,
      title: lead.title,
      raw_content: lead.raw_content,
      score: null,
      score_reason: `GLI Tier 1 opportunity captured on legitimacy (leisure/tourism advisory solicitation): ${tag.signal_type} (${tag.venue_type}). Not fit-scored.`,
      // Freshness flag keyed to the record's own deadline (open vs closed), not to
      // scrape time. Closed leads are kept as market intelligence; the dashboard
      // hides them from the default biddable view (with a show-closed toggle).
      status: closed ? 'closed' : 'open',
      module: OPPORTUNITY_MODULE,
      industry: OPPORTUNITY_MODULE,
      stream: 'opportunity',
      company: lead.company,
      location: lead.location,
      deadline: lead.deadline,
      published_date: lead.published_date ?? null,
      value_estimate: lead.value_estimate,
      lead_type: 'tender',
      region,
      venue_type: tag.venue_type,
      signal_type: tag.signal_type,
      development_category: developmentCategory(lead.title, lead.raw_content, tag.venue_type),
      source_tier: tier,
      contact_name: tag.contact_name,
      contact_email: tag.contact_email,
      contact_phone: tag.contact_phone,
    },
  };
}

// An opportunity is CLOSED when its submission deadline has passed, or the notice
// is already awarded/cancelled/withdrawn. A missing/unparseable deadline is a live
// (open/undated) solicitation, not closed. Evaluated against the current time so
// a lead written open becomes closed once its deadline passes.
export function opportunityClosed(lead: NormalizedLead): boolean {
  if (isDeadNotice(lead)) return true;
  if (!lead.deadline) return false;
  const t = new Date(lead.deadline).getTime();
  return !Number.isNaN(t) && t < Date.now();
}

export interface OpportunityReport {
  fetched: number;
  deduped: number;
  matched: number;
  // Freshness: open (future/undated live) vs closed (deadline passed). Closed
  // leads are captured and flagged, never dropped.
  open: number;
  closed: number;
  written: number;
  writeFailed: number;
  // Populated deadlines over the captured (matched, live) set: the health metric.
  withDeadline: number;
  perSource: Record<string, number>;
  perVenueType: Record<string, number>;
  perSignalType: Record<string, number>;
  perRegion: Record<string, number>;
  samples: Array<{
    title: string;
    source: string;
    venue_type: string;
    signal_type: string;
    region: string;
    deadline: string;
  }>;
}

const inc = (m: Record<string, number>, k: string): void => {
  m[k] = (m[k] ?? 0) + 1;
};

// Fetch only the opportunity-lane sources, tolerating individual failures.
export async function fetchOpportunitySources(): Promise<NormalizedLead[]> {
  const settled = await Promise.allSettled([
    scrapeTedEu([], [], [...LEISURE_CPV_CODES]),
    scrapeCanadaBuys(),
    scrapeUkTenders(),
    scrapeAusTender(),
    scrapeUngm(),
    scrapeGeBiz(),
    scrapeWorldBank(),
    scrapeIadb(),
    scrapeAdb(),
    scrapeCdb(),
    scrapeAfdb(),
    scrapeUndp(),
  ]);
  const all: NormalizedLead[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') all.push(...r.value);
    else console.error(`Opportunity source "${OPPORTUNITY_SOURCES[i]}" failed:`, r.reason);
  });
  return all;
}

// Run the opportunity lane over fetched leads: dedupe by URL, gate on
// isLeisureOpportunity, drop expired, tag venue/signal, and write (module 'gli',
// stream 'opportunity'). OPPORTUNITY_NO_WRITE=1 skips the writes. The per-source /
// per-venue / per-signal / per-region tallies and the deadline health count are
// over the captured (matched, live) set; `written` is the subset persisted.
export async function runOpportunityLane(all: NormalizedLead[]): Promise<OpportunityReport> {
  const byUrl = new Map<string, NormalizedLead>();
  for (const l of all) if (l.url && !byUrl.has(l.url)) byUrl.set(l.url, l);
  const deduped = [...byUrl.values()];

  // Closed opportunities are NOT dropped: they are captured and flagged (status
  // 'closed') so the dashboard can show them as market intelligence behind a
  // toggle while the default biddable view stays open-only.
  const candidates = deduped.filter(isLeisureOpportunity);

  const report: OpportunityReport = {
    fetched: all.length,
    deduped: deduped.length,
    matched: candidates.length,
    open: 0,
    closed: 0,
    written: 0,
    writeFailed: 0,
    withDeadline: 0,
    perSource: {},
    perVenueType: {},
    perSignalType: {},
    perRegion: {},
    samples: [],
  };

  const tags = candidates.length > 0 ? await tagOpportunities(candidates) : [];
  const noWrite = process.env.OPPORTUNITY_NO_WRITE === '1';

  for (let i = 0; i < candidates.length; i++) {
    const lead = candidates[i];
    const tag = tags[i];
    const { region, row } = buildOpportunityRow(lead, tag);
    if (opportunityClosed(lead)) report.closed++;
    else report.open++;
    inc(report.perSource, lead.source);
    inc(report.perVenueType, tag.venue_type);
    inc(report.perSignalType, tag.signal_type);
    inc(report.perRegion, region);
    if (lead.deadline) report.withDeadline++;
    if (report.samples.length < 10) {
      report.samples.push({
        title: lead.title,
        source: lead.source,
        venue_type: tag.venue_type,
        signal_type: tag.signal_type,
        region,
        deadline: lead.deadline ?? '',
      });
    }
    if (noWrite) continue;
    const { error } = await supabaseAdmin.from('leads').upsert(row, { onConflict: 'url' });
    if (error) {
      console.error(`Opportunity write failed for ${lead.url}: ${error.message}`);
      report.writeFailed++;
      continue;
    }
    report.written++;
  }
  return report;
}

function printOpportunityReport(r: OpportunityReport): void {
  const table = (m: Record<string, number>): string =>
    Object.keys(m).length
      ? Object.entries(m)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `    ${String(v).padStart(4)}  ${k}`)
          .join('\n')
      : '    (none)';

  console.log('\n===== GLI TIER 1 OPPORTUNITY LANE (scrape:opportunity) =====');
  console.log(`Fetched (opportunity sources): ${r.fetched}`);
  console.log(`After URL dedup:               ${r.deduped}`);
  console.log(`Matched (development advisory): ${r.matched}`);
  console.log(`Open (future/undated, biddable): ${r.open}   Closed (deadline passed, flagged): ${r.closed}`);
  console.log(
    `Written (module gli, stream opportunity): ${r.written}` +
      (r.writeFailed ? `  (write failures: ${r.writeFailed})` : '') +
      (process.env.OPPORTUNITY_NO_WRITE === '1' ? '  (OPPORTUNITY_NO_WRITE: no writes)' : '')
  );
  console.log(`With a populated deadline:     ${r.withDeadline} of ${r.matched}  (health metric)`);
  console.log('Per source:');
  console.log(table(r.perSource));
  console.log('Per venue_type:');
  console.log(table(r.perVenueType));
  console.log('Per signal_type:');
  console.log(table(r.perSignalType));
  console.log('Per region:');
  console.log(table(r.perRegion));
  console.log('Sample (up to 10): title | source | venue_type | signal_type | region | deadline');
  for (const s of r.samples) {
    console.log(
      `    - ${s.title.slice(0, 50)} | ${s.source} | ${s.venue_type} | ${s.signal_type} | ${s.region} | ${s.deadline || '(none)'}`
    );
  }
  console.log('===========================================================\n');
}

async function main(): Promise<void> {
  console.log('GLI Tier 1 opportunity lane starting (scrape:opportunity)...');
  const all = await fetchOpportunitySources();
  const report = await runOpportunityLane(all);
  printOpportunityReport(report);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Opportunity lane failed:', err);
    process.exitCode = 1;
  });
}
