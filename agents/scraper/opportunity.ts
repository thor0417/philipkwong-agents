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
import {
  LIVE_PIPELINE_STORAGE_KEY,
  HOSPITALITY_ID,
  assertKnownPipeline,
  laneInPipelineScope,
} from './pipelines';
import {
  parseRunScope,
  describeScope,
  scopeIncludesSource,
  FULL_SCOPE,
  type RunScope,
} from './run-scope';
import type { NormalizedLead } from './sources/types';
import { LEISURE_CPV_CODES } from './profiles';
import { isLeisureOpportunity, isDeadNotice } from './classify';
import { tagOpportunities, sourceTier, type OpportunityTag } from './gli';
import { regionFor, regionOf } from './regions';
import { classifyVenueType, categoryForVenue } from '../../lib/taxonomy';
import { geographyFields } from '../../lib/geography';
import { guardedUpsertOne, emptyWriteReport } from './write-guard';
import { attachOnWrite, printAttachReport } from './project-attach';
import { recordSourceRun, reportRunHealth, resetSourceRuns } from './health';
import { deriveLeadDates, objectFields, shouldDelete } from './lead-date';

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

// Resolved from the pipeline registry, not a literal. See agents/scraper/pipelines.
const OPPORTUNITY_MODULE = LIVE_PIPELINE_STORAGE_KEY;

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
  // Best-available date + provenance (source deadline/published, else parsed from
  // text, else first_seen). Filtering keys off these; date_source drives the badge.
  const dates = deriveLeadDates(lead, 'opportunity');
  // object_type (deadline rule) + future milestone, derived from the same dates.
  const om = objectFields(dates, lead.title, lead.raw_content);
  // Canonical venue is deterministic (lib/taxonomy), so it never drifts or
  // collapses; the LLM's venue is folded in as a hint. Category derives from it.
  const venue = classifyVenueType(`${lead.title ?? ''} ${lead.raw_content ?? ''}`, tag.venue_type);
  // Geography resolved once, at write time, into indexed columns.
  const geo = geographyFields(lead.location, lead.country);
  return {
    region,
    row: {
      ...geo,
      source: lead.source,
      url: lead.url,
      title: lead.title,
      raw_content: lead.raw_content,
      score: null,
      score_reason: `GLI Tier 1 opportunity captured on legitimacy (leisure/tourism advisory solicitation): ${tag.signal_type} (${tag.venue_type}). Not fit-scored.`,
      // Freshness keyed to the record's own deadline, not to scrape time, and
      // written to lifecycle (the scraper's axis). status belongs to Philip and
      // is never written here. Closed solicitations are kept as market
      // intelligence and fall into the Archive view.
      lifecycle: closed ? 'expired' : 'active',
      module: OPPORTUNITY_MODULE,
      industry: OPPORTUNITY_MODULE,
      stream: 'opportunity',
      company: lead.company,
      location: lead.location,
      deadline: dates.deadline,
      published_date: dates.published_date,
      date_source: dates.date_source,
      object_type: om.object_type,
      milestone_date: om.milestone_date,
      value_estimate: lead.value_estimate,
      lead_type: 'tender',
      region,
      venue_type: venue,
      signal_type: tag.signal_type,
      development_category: categoryForVenue(venue),
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
  // URLs this run actually wrote, for the project attach pass.
  writtenUrls: string[];
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
// ONE DECLARATION PER SOURCE, replacing a positional array of promises that had
// to stay index-aligned with OPPORTUNITY_SOURCES to report the right name. Run
// scoping needs the name and the thunk together anyway, and two lists that must
// agree by position are a latent mislabelling bug.
//
// These are global tender portals with no single market, so MARKET scoping does
// not apply to them - only --source does. Said plainly here rather than
// pretending a market filter would work.
const OPPORTUNITY_ADAPTERS: { source: string; run: () => Promise<NormalizedLead[]> }[] = [
  { source: 'tedeu', run: () => scrapeTedEu([], [], [...LEISURE_CPV_CODES]) },
  { source: 'canadabuys', run: () => scrapeCanadaBuys() },
  { source: 'uktenders', run: () => scrapeUkTenders() },
  { source: 'austender', run: () => scrapeAusTender() },
  { source: 'ungm', run: () => scrapeUngm() },
  { source: 'gebiz', run: () => scrapeGeBiz() },
  { source: 'worldbank', run: () => scrapeWorldBank() },
  { source: 'iadb', run: () => scrapeIadb() },
  { source: 'adb', run: () => scrapeAdb() },
  { source: 'cdb', run: () => scrapeCdb() },
  { source: 'afdb', run: () => scrapeAfdb() },
  { source: 'undp', run: () => scrapeUndp() },
];

export async function fetchOpportunitySources(
  scope: RunScope = FULL_SCOPE
): Promise<NormalizedLead[]> {
  const selected = OPPORTUNITY_ADAPTERS.filter((a) => scopeIncludesSource(scope, a.source));
  if (selected.length < OPPORTUNITY_ADAPTERS.length) {
    console.log(
      `Opportunity: scoped to ${selected.length} of ${OPPORTUNITY_ADAPTERS.length} sources ` +
        `(${selected.map((a) => a.source).join(', ') || 'none'}).`
    );
  }
  const settled = await Promise.allSettled(selected.map((a) => a.run()));
  const all: NormalizedLead[] = [];
  settled.forEach((r, i) => {
    const unit = `adapter:${selected[i].source}`;
    if (r.status === 'fulfilled') {
      all.push(...r.value);
      // A source that resolved with zero rows is recorded too. That is the whole
      // point: a silent empty result is indistinguishable from success unless it
      // is written down.
      recordSourceRun({ lane: 'opportunity', unit, fetched: r.value.length, kept: r.value.length });
    } else {
      console.error(`Opportunity source "${OPPORTUNITY_SOURCES[i]}" failed:`, r.reason);
      recordSourceRun({ lane: 'opportunity', unit, fetched: 0, kept: 0 });
    }
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
    writtenUrls: [],
    perSource: {},
    perVenueType: {},
    perSignalType: {},
    perRegion: {},
    samples: [],
  };

  const tags = candidates.length > 0 ? await tagOpportunities(candidates) : [];
  const noWrite = process.env.OPPORTUNITY_NO_WRITE === '1';

  let rejectedPreCutoff = 0;
  let unearnedSignal = 0;
  for (let i = 0; i < candidates.length; i++) {
    const lead = candidates[i];
    const tag = tags[i];
    // Capture gate: reject only a dead old opportunity (pre-2026 deadline, no
    // future milestone). Project events and anything with a future milestone pass.
    if (shouldDelete(lead)) {
      rejectedPreCutoff++;
      continue;
    }
    // Earned-signal gate: no LLM signal and no hint term -> no signal type was
    // earned, so the lead is NOT written to the opportunity stream (a signal is
    // earned, never assumed). This is what kept German job ads out of the stream.
    if (!tag.signal_type) {
      unearnedSignal++;
      continue;
    }
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
    const wr = emptyWriteReport();
    const ok = await guardedUpsertOne(row, wr);
    if (!ok) {
      report.writeFailed++;
      continue;
    }
    report.written++;
    report.writtenUrls.push(...wr.writtenUrls);
  }
  if (rejectedPreCutoff > 0) {
    console.log(`Opportunity: rejected ${rejectedPreCutoff} dead pre-2026 opportunities (no future milestone).`);
  }
  if (unearnedSignal > 0) {
    console.log(`Opportunity: dropped ${unearnedSignal} leads with no earned signal type (not written).`);
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
  const scope = parseRunScope();
  console.log(`SCOPE: ${describeScope(scope)}`);
  // Validated against the registry: a typo'd pipeline is a hard error, never a
  // silent full run.
  await assertKnownPipeline(scope);
  if (!laneInPipelineScope(scope)) {
    console.log(
      `Lane skipped: scope selects pipeline "${scope.pipeline}", this lane serves ${HOSPITALITY_ID}.`
    );
    return;
  }
  const all = await fetchOpportunitySources(scope);
  const report = await runOpportunityLane(all);
  printOpportunityReport(report);
  // The opportunity lane had NO zero-write alarm at all before this. It could
  // have gone dead indefinitely without a word.
  if (process.env.OPPORTUNITY_NO_WRITE !== '1') {
    await reportRunHealth('opportunity', { fetched: report.fetched, written: report.written });
  } else {
    resetSourceRuns();
  }
  printAttachReport('Opportunity', await attachOnWrite(report.writtenUrls));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Opportunity lane failed:', err);
    process.exitCode = 1;
  });
}
