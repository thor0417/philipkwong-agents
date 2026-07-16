// GLI Tier 2 government-records lane (routing + write core).
//
// Government records (Legistar Matters/Events today; any gated portal via the
// manual entry path) are captured on legitimacy into the GLI government stream:
// module 'gli', stream 'government', lead_type 'record'. A government record is an
// early-stage, pre-tender signal by definition, so it is NEVER fit-scored and
// NEVER dropped for a terse title or a missing contact. The GLI classifier is
// used for venue_type / signal_type TAGGING ONLY (never as a keep/drop gate), and
// signal_type defaults to Origination when the classifier is unsure.
//
// The standalone entrypoint (npm run scrape:government) lives at the bottom of
// this file; the manual CLI (npm run lead:add) reuses buildGovernmentRow so a
// hand-pulled finding becomes a first-class row in the same pipeline.

import { pathToFileURL } from 'node:url';
import type { NormalizedLead } from './sources/types';
import { supabaseAdmin } from '../../lib/supabase-admin';
import { classifyGli } from './gli';
import { opportunityVenueHint } from './classify';
import { regionFor, regionOf } from './regions';
import { classifyVenueType, categoryForVenue } from '../../lib/taxonomy';
import { scrapeLegistar, lastLegistarStats } from './sources/legistar';
import { scrapeGovDocs } from './sources/govdocs';

const GOVERNMENT_MODULE = 'gli';

// A tagged government record: venue_type / signal_type always populated, plus any
// contact the classifier surfaced. signal_type defaults to Origination.
export interface GovernmentTag {
  venue_type: string;
  signal_type: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
}

const MAX_CONCURRENCY = 6;

// Tag records with venue_type / signal_type using the GLI classifier for TAGGING
// ONLY (never a keep/drop gate: records are captured regardless of the
// classifier's keep verdict). venue_type falls back to a keyword hint; signal_type
// defaults to Origination (a government record is early-stage by definition).
export async function tagGovernmentBatch(leads: NormalizedLead[]): Promise<GovernmentTag[]> {
  const out = new Array<GovernmentTag>(leads.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < leads.length) {
      const i = next++;
      const c = await classifyGli(leads[i]);
      out[i] = {
        venue_type: c.venue_type ?? opportunityVenueHint(leads[i]),
        signal_type: c.signal_type ?? 'Origination',
        contact_name: c.contact_name,
        contact_email: c.contact_email,
        contact_phone: c.contact_phone,
      };
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, leads.length) }, worker));
  return out;
}

// Shared write shape for a government record, used by the standalone lane and the
// manual CLI so the automated and manual halves of the framework write identical
// rows. Government records are primary sources by definition (source_tier
// 'primary'); score is null (captured on legitimacy, never fit-ranked).
export function buildGovernmentRow(
  lead: NormalizedLead,
  tag: GovernmentTag
): { region: string; row: Record<string, unknown> } {
  const region = regionFor(lead, regionOf(lead.source));
  const venue = classifyVenueType(`${lead.title ?? ''} ${lead.raw_content ?? ''} ${tag.venue_type}`);
  return {
    region,
    row: {
      source: lead.source,
      url: lead.url,
      title: lead.title,
      raw_content: lead.raw_content,
      score: null,
      score_reason: `GLI Tier 2 government record captured on legitimacy (pre-tender signal: ${tag.signal_type}, ${tag.venue_type}); not fit-scored.`,
      status: 'new',
      module: GOVERNMENT_MODULE,
      industry: GOVERNMENT_MODULE,
      stream: 'government',
      company: lead.company,
      location: lead.location,
      deadline: null,
      published_date: lead.published_date ?? null,
      value_estimate: null,
      lead_type: 'record',
      region,
      venue_type: venue,
      signal_type: tag.signal_type,
      development_category: categoryForVenue(venue),
      source_type: lead.source_type ?? null,
      primary_document_url: lead.primary_document_url ?? null,
      has_primary_document: lead.has_primary_document ?? false,
      source_tier: 'primary',
      contact_name: tag.contact_name,
      contact_email: tag.contact_email,
      contact_phone: tag.contact_phone,
    },
  };
}

const inc = (m: Record<string, number>, k: string): void => {
  m[k] = (m[k] ?? 0) + 1;
};

export interface GovernmentReport {
  input: number;
  deduped: number;
  written: number;
  writeFailed: number;
  perJurisdiction: Record<string, number>;
  perVenueType: Record<string, number>;
  perSignalType: Record<string, number>;
  perSourceType: Record<string, number>;
  primaryDocs: number;
  samples: Array<{
    title: string;
    jurisdiction: string;
    source_type: string;
    venue_type: string;
    signal_type: string;
    url: string;
  }>;
}

// Run the government lane over keyword-matched records: dedupe by URL, tag
// venue/signal, and write (module 'gli', stream 'government', lead_type 'record').
// GOVERNMENT_NO_WRITE=1 skips the writes. Records are never dropped. Per-tally
// counts are over the written set; the per-jurisdiction fetched/matched columns
// come from the adapter's stats in the report printer.
export async function runGovernmentLane(leads: NormalizedLead[]): Promise<GovernmentReport> {
  const byUrl = new Map<string, NormalizedLead>();
  for (const l of leads) if (l.url && !byUrl.has(l.url)) byUrl.set(l.url, l);
  const deduped = [...byUrl.values()];

  const report: GovernmentReport = {
    input: leads.length,
    deduped: deduped.length,
    written: 0,
    writeFailed: 0,
    perJurisdiction: {},
    perVenueType: {},
    perSignalType: {},
    perSourceType: {},
    primaryDocs: 0,
    samples: [],
  };

  const tags = deduped.length > 0 ? await tagGovernmentBatch(deduped) : [];
  const noWrite = process.env.GOVERNMENT_NO_WRITE === '1';

  for (let i = 0; i < deduped.length; i++) {
    const lead = deduped[i];
    const tag = tags[i];
    const { row } = buildGovernmentRow(lead, tag);
    inc(report.perJurisdiction, lead.location ?? '(unknown)');
    inc(report.perVenueType, tag.venue_type);
    inc(report.perSignalType, tag.signal_type);
    inc(report.perSourceType, lead.source_type ?? 'Council Agenda');
    if (lead.has_primary_document) report.primaryDocs++;
    if (report.samples.length < 10) {
      report.samples.push({
        title: lead.title,
        jurisdiction: lead.location ?? '(unknown)',
        source_type: lead.source_type ?? 'Council Agenda',
        venue_type: tag.venue_type,
        signal_type: tag.signal_type,
        url: lead.url,
      });
    }
    if (noWrite) continue;
    const { error } = await supabaseAdmin.from('leads').upsert(row, { onConflict: 'url' });
    if (error) {
      console.error(`Government write failed for ${lead.url}: ${error.message}`);
      report.writeFailed++;
      continue;
    }
    report.written++;
  }
  return report;
}

// ---- Standalone entrypoint (npm run scrape:government) -----------------------
// Fires ONLY the Legistar adapter and the government routing, so the Tier 2 lane
// validates cheaply without the full engine. GOVERNMENT_NO_WRITE=1 skips writes.

function printGovernmentReport(
  r: GovernmentReport,
  stats: Record<string, { fetched: number; matched: number }>
): void {
  const table = (m: Record<string, number>): string =>
    Object.keys(m).length
      ? Object.entries(m)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `    ${String(v).padStart(4)}  ${k}`)
          .join('\n')
      : '    (none)';

  console.log('\n===== GLI TIER 2 GOVERNMENT LANE (scrape:government) =====');
  console.log(
    `Records matched: ${r.input}  ->  deduped: ${r.deduped}  ->  written: ${r.written}` +
      (r.writeFailed ? `  (write failures: ${r.writeFailed})` : '') +
      (process.env.GOVERNMENT_NO_WRITE === '1' ? '  (GOVERNMENT_NO_WRITE: no writes)' : '')
  );
  console.log('Per jurisdiction (fetched / matched / written):');
  const jurisdictions = new Set<string>([...Object.keys(stats), ...Object.keys(r.perJurisdiction)]);
  for (const j of [...jurisdictions].sort()) {
    const s = stats[j] ?? { fetched: 0, matched: 0 };
    console.log(`    ${j}: ${s.fetched} fetched / ${s.matched} matched / ${r.perJurisdiction[j] ?? 0} written`);
  }
  console.log('Per source_type (document type):');
  console.log(table(r.perSourceType));
  console.log(`Records with a fetched primary document: ${r.primaryDocs}`);
  console.log('Per venue_type:');
  console.log(table(r.perVenueType));
  console.log('Per signal_type:');
  console.log(table(r.perSignalType));
  console.log('Sample (up to 10): title | jurisdiction | source_type | venue_type | signal_type | url');
  for (const s of r.samples) {
    console.log(
      `    - ${s.title.slice(0, 50)} | ${s.jurisdiction} | ${s.source_type} | ${s.venue_type} | ${s.signal_type} | ${s.url}`
    );
  }

  // Explicit Las Vegas validation: does the lane surface Area15-adjacent or
  // comparable-scale pre-tender signals? Reported honestly from the actual data.
  const lvLabel = 'Las Vegas, NV';
  const lv = stats[lvLabel] ?? { fetched: 0, matched: 0 };
  const lvWritten = r.perJurisdiction[lvLabel] ?? 0;
  console.log('\nLas Vegas validation:');
  console.log(
    `    ${lv.fetched} records fetched, ${lv.matched} keyword-matched, ${lvWritten} written.`
  );
  const lvSamples = r.samples.filter((s) => s.jurisdiction === lvLabel);
  if (lvSamples.length) {
    console.log('    Las Vegas signals surfaced (inspect for Area15-adjacent scale):');
    for (const s of lvSamples) console.log(`      - ${s.title.slice(0, 70)} [${s.signal_type}]`);
  } else {
    console.log('    No Las Vegas signals surfaced this run (check the client id / keywords).');
  }
  console.log('=========================================================\n');
}

async function main(): Promise<void> {
  console.log('GLI Tier 2 government lane starting (scrape:government)...');
  const [legistar, govdocs] = await Promise.all([scrapeLegistar(), scrapeGovDocs()]);
  const report = await runGovernmentLane([...legistar, ...govdocs]);
  printGovernmentReport(report, lastLegistarStats());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Government lane failed:', err);
    process.exitCode = 1;
  });
}
