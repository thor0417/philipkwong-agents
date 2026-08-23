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
import {
  LIVE_PIPELINE_STORAGE_KEY,
  HOSPITALITY_ID,
  assertKnownPipeline,
  laneInPipelineScope,
} from './pipelines';
import Anthropic from '@anthropic-ai/sdk';
import type { NormalizedLead } from './sources/types';
import { classifyGli } from './gli';
import { opportunityVenueHint, signalPhrase, NO_VENUE_ESTABLISHED } from './classify';
import { regionFor, regionOf } from './regions';
import { classifyVenueType, categoryForVenue } from '../../lib/taxonomy';
import { geographyFields } from '../../lib/geography';
import { guardedUpsert, emptyWriteReport, printWriteReport, type WriteReport } from './write-guard';
import { attachOnWrite, printAttachReport } from './project-attach';
import { deriveLeadDates, objectFields, shouldDelete } from './lead-date';
import {
  scrapeLegistar,
  lastLegistarStats,
  legistarMarkets,
  type LegistarJurisdictionStats,
} from './sources/legistar';
import { lastAttachmentStats } from './sources/legistar-attachments';
import { recheckCpcReports } from './migrations/capture-cpc-reports';
import { resetParseReports, printParseReports, allParseReports } from './sources/schemas';
import { RunTimer } from './logger';
import { alarmError } from './alarm';
import { recordSourceRun, reportRunHealth, resetSourceRuns } from './health';
import { scrapeGovDocs, govDocMarkets } from './sources/govdocs';
import {
  parseRunScope,
  describeScope,
  scopeIncludesSource,
  scopeIncludesAnyMarket,
} from './run-scope';
import { scrapeCftodPdfItems } from './sources/pdf-agenda';
import { scrapeAnaheimAgendas } from './sources/agenda-portal';
import { scrapeLasVegasAgendas } from './sources/lasvegas';
import { scrapeClarkTabAgendas } from './sources/clark-tab';
import { scrapeCeqanet } from './sources/ceqanet';
import { scrapeNycZap, zapStats, NYC_ZAP_MARKET } from './sources/nyc-zap';
import {
  scrapeNycCityRecord,
  cityRecordStats,
  NYC_CITY_RECORD_MARKET,
  LAND_USE_SECTIONS,
} from './sources/nyc-city-record';
import { scrapeNycCeqr, nycCeqrStats, NYC_CEQR_MARKET } from './sources/nyc-ceqr';
import { loadKnownEntities } from './known-entities';

// Resolved from the pipeline registry, not a literal. See agents/scraper/pipelines.
const GOVERNMENT_MODULE = LIVE_PIPELINE_STORAGE_KEY;

// ---- Player extraction (Pass 4). Local-government records name the people and
// entities: who presented, the applicant/developer, the consultant, and the
// specific approval sought. Extracted lightly from the record text; left null
// when absent, NEVER fabricated. ----
const playerClient = new Anthropic();
const PLAYER_MODEL = 'claude-haiku-4-5-20251001';
const PLAYER_RETRIES = 2;
const playerSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface GovernmentPlayers {
  presented_by: string | null;
  applicant: string | null;
  representative: string | null;
  action_sought: string | null;
}

const NO_PLAYERS: GovernmentPlayers = {
  presented_by: null,
  applicant: null,
  representative: null,
  action_sought: null,
};

const PLAYER_PROMPT = `You extract the named people, entities, and the action from a US local-government record (a council agenda item, planning or zoning minute, staff report, comprehensive plan, or special-district document). Return STRICT JSON only (no preamble, no markdown).

Extract each field ONLY when it is explicitly present in the text. If a field is not clearly stated, return null. Never guess, infer, or fabricate a name.
- presented_by: the person or department that presented or introduced the item
- applicant: the applicant, developer, or property owner seeking the approval
- representative: the consultant, attorney, agent, or firm representing the applicant
- action_sought: the specific approval or action sought (e.g. rezoning, comprehensive plan amendment, site plan approval, special use permit, development agreement)

Respond in exactly this shape:
{"presented_by": null, "applicant": null, "representative": null, "action_sought": null}

Record:
`;

function cleanPlayer(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (!t || ['null', 'none', 'n/a', 'unknown', 'not stated'].includes(t.toLowerCase())) return null;
  return t;
}

function parsePlayers(text: string): GovernmentPlayers {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = (fenced ? fenced[1] : text).trim();
  const first = body.indexOf('{');
  const last = body.lastIndexOf('}');
  if (first !== -1 && last > first) body = body.slice(first, last + 1);
  try {
    const p = JSON.parse(body);
    return {
      presented_by: cleanPlayer(p.presented_by),
      applicant: cleanPlayer(p.applicant),
      representative: cleanPlayer(p.representative),
      action_sought: cleanPlayer(p.action_sought),
    };
  } catch {
    return { ...NO_PLAYERS };
  }
}

async function extractPlayers(lead: NormalizedLead): Promise<GovernmentPlayers> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await playerClient.messages.create({
        model: PLAYER_MODEL,
        max_tokens: 200,
        messages: [
          { role: 'user', content: `${PLAYER_PROMPT}Title: ${lead.title}\n\n${lead.raw_content}` },
        ],
      });
      const block = res.content[0];
      return parsePlayers(block && block.type === 'text' ? block.text : '');
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 429 && attempt < PLAYER_RETRIES) {
        await playerSleep(1000 * 2 ** attempt);
        continue;
      }
      console.error(`Player extraction failed for "${lead.title.slice(0, 50)}": ${String(err).slice(0, 80)}`);
      return { ...NO_PLAYERS };
    }
  }
}

// Document-sourced people (read out of the matter's own attachments by
// sources/legistar-attachments) OUTRANK the model's reading of the record text:
// the staff report states them, the title only implies them. The model fills the
// fields the documents left null, never the reverse.
export function mergePlayers(lead: NormalizedLead, llm: GovernmentPlayers): GovernmentPlayers {
  return {
    presented_by: lead.presented_by ?? llm.presented_by,
    applicant: lead.applicant ?? llm.applicant,
    representative: lead.representative ?? llm.representative,
    action_sought: lead.action_sought ?? llm.action_sought,
  };
}

async function extractPlayersBatch(leads: NormalizedLead[]): Promise<GovernmentPlayers[]> {
  const out = new Array<GovernmentPlayers>(leads.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < leads.length) {
      const i = next++;
      out[i] = await extractPlayers(leads[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, leads.length) }, worker));
  return out;
}

// A tagged government record: venue_type / signal_type always populated, plus any
// contact the classifier surfaced. signal_type defaults to Origination.
export interface GovernmentTag {
  // Null when neither the classifier nor the keyword hint established one. It
  // used to be non-null only because opportunityVenueHint defaulted; see the
  // note there and signalPhrase below.
  venue_type: string | null;
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
  tag: GovernmentTag,
  players: GovernmentPlayers = NO_PLAYERS
): { region: string; row: Record<string, unknown> } {
  const region = regionFor(lead, regionOf(lead.source));
  const venue = classifyVenueType(`${lead.title ?? ''} ${lead.raw_content ?? ''}`, tag.venue_type);
  // Government records carry a document date (published_date), never a bid
  // deadline; parsed dates and the first_seen floor route through the same helper.
  const dates = deriveLeadDates(lead, 'government');
  // A government record has no submission deadline -> always a project_event.
  const om = objectFields(dates, lead.title, lead.raw_content);
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
      score_reason:
        'GLI Tier 2 government record captured on legitimacy (pre-tender signal: ' +
        `${signalPhrase(tag.signal_type, tag.venue_type)}); not fit-scored.`,
      // status is Philip's column and is never written by a scrape path; the
      // database default covers a new row. lifecycle is the scraper's axis: a
      // government record is a project event, so it is always active.
      lifecycle: 'active',
      module: GOVERNMENT_MODULE,
      industry: GOVERNMENT_MODULE,
      stream: 'government',
      company: lead.company,
      location: lead.location,
      deadline: dates.deadline,
      published_date: dates.published_date,
      date_source: dates.date_source,
      object_type: om.object_type,
      milestone_date: om.milestone_date,
      value_estimate: null,
      lead_type: 'record',
      region,
      venue_type: venue,
      signal_type: tag.signal_type,
      development_category: categoryForVenue(venue),
      source_type: lead.source_type ?? null,
      primary_document_url: lead.primary_document_url ?? null,
      has_primary_document: lead.has_primary_document ?? false,
      presented_by: players.presented_by,
      applicant: players.applicant,
      // FROM THE ADAPTER ONLY, NEVER FROM THE MODEL. players is the merge of
      // what the source published with what the LLM read out of the text, and
      // the LLM must not reach this column: a model deciding that an applicant
      // is a public agency is an inference, and the document layer gates a
      // PRINT on this value. lead.applicant_type is what the source stated or
      // null, which means it did not say.
      applicant_type: lead.applicant_type ?? null,
      representative: players.representative,
      action_sought: players.action_sought,
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
  // GATE-ADMITTED per jurisdiction: rows that passed the gate and were sent to
  // the writer. This is NOT how many rows landed, and reading it as though it
  // were is what let a run report 409 written for August when it inserted 65.
  perJurisdiction: Record<string, number>;
  // What actually happened at the database, split. Filled after the write from
  // the write report's inserted URLs, so they cannot drift from it.
  insertedPerJurisdiction: Record<string, number>;
  updatedPerJurisdiction: Record<string, number>;
  insertedPerSource: Record<string, number>;
  updatedPerSource: Record<string, number>;
  perVenueType: Record<string, number>;
  perSignalType: Record<string, number>;
  perSourceType: Record<string, number>;
  primaryDocs: number;
  // Records with at least one player field extracted.
  playersFound: number;
  // Records whose people came from the matter's own documents (attachment depth),
  // as opposed to the model's reading of the record text.
  documentContacts: number;
  // Tombstone / override telemetry for the run.
  write?: WriteReport;
  samples: Array<{
    title: string;
    jurisdiction: string;
    source_type: string;
    // Null when nothing established one; the run report counts those in a
    // named bucket rather than hiding them behind a default. See
    // opportunityVenueHint in classify.
    venue_type: string | null;
    signal_type: string;
    presented_by: string | null;
    applicant: string | null;
    action_sought: string | null;
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
    insertedPerJurisdiction: {},
    updatedPerJurisdiction: {},
    insertedPerSource: {},
    updatedPerSource: {},
    perVenueType: {},
    perSignalType: {},
    perSourceType: {},
    primaryDocs: 0,
    playersFound: 0,
    documentContacts: 0,
    samples: [],
  };

  // Per-source counts, so a source that dies inside a healthy lane is named.
  // Built from the lead arrays rather than from each adapter's own stats object,
  // so every source is covered including ones that expose no stats.
  const fetchedBySource = new Map<string, number>();
  for (const l of leads) fetchedBySource.set(l.source, (fetchedBySource.get(l.source) ?? 0) + 1);
  const keptBySource = new Map<string, number>();

  const pending: Record<string, unknown>[] = [];
  // url -> where the row came from, so the write report's inserted URLs can be
  // attributed. Built here rather than looked up later because `lead` is in
  // scope here and nothing downstream carries the jurisdiction.
  const originByUrl = new Map<string, { jurisdiction: string; source: string }>();
  const tags = deduped.length > 0 ? await tagGovernmentBatch(deduped) : [];
  const players = deduped.length > 0 ? await extractPlayersBatch(deduped) : [];
  const noWrite = process.env.GOVERNMENT_NO_WRITE === '1';

  let rejectedPreCutoff = 0;
  for (let i = 0; i < deduped.length; i++) {
    const lead = deduped[i];
    const tag = tags[i];
    const p = mergePlayers(lead, players[i]);
    if (lead.presented_by || lead.applicant || lead.representative) report.documentContacts++;
    // Capture gate: government records are project events (no deadline), so they
    // are never rejected here. shouldDelete stays as the single gate for symmetry.
    if (shouldDelete(lead)) {
      rejectedPreCutoff++;
      continue;
    }
    const { row } = buildGovernmentRow(lead, tag, p);
    inc(report.perJurisdiction, lead.location ?? '(unknown)');
    inc(report.perVenueType, tag.venue_type ?? NO_VENUE_ESTABLISHED);
    inc(report.perSignalType, tag.signal_type);
    inc(report.perSourceType, lead.source_type ?? 'Council Agenda');
    if (lead.has_primary_document) report.primaryDocs++;
    if (p.presented_by || p.applicant || p.representative || p.action_sought) report.playersFound++;
    if (report.samples.length < 10) {
      report.samples.push({
        title: lead.title,
        jurisdiction: lead.location ?? '(unknown)',
        source_type: lead.source_type ?? 'Council Agenda',
        venue_type: tag.venue_type,
        signal_type: tag.signal_type,
        presented_by: p.presented_by,
        applicant: p.applicant,
        action_sought: p.action_sought,
        url: lead.url,
      });
    }
    keptBySource.set(lead.source, (keptBySource.get(lead.source) ?? 0) + 1);
    if (noWrite) continue;
    // Every write goes through the tombstone / override guard.
    pending.push(row);
    originByUrl.set(String(row.url ?? ''), {
      jurisdiction: lead.location ?? '(unknown)',
      source: lead.source ?? '(unknown)',
    });
  }

  // Source-level: catches "fetched records, kept none" (the shape changed and
  // the filter now rejects everything).
  for (const [unit, fetched] of fetchedBySource) {
    recordSourceRun({ lane: 'government', unit: `source:${unit}`, fetched, kept: keptBySource.get(unit) ?? 0 });
  }
  if (rejectedPreCutoff > 0) {
    console.log(`Government: rejected ${rejectedPreCutoff} records (dead pre-2026 opportunities only).`);
  }
  if (pending.length > 0) {
    const wr = await guardedUpsert(pending, emptyWriteReport());
    report.written = wr.written;
    report.writeFailed = wr.failed;
    report.write = wr;
    // ATTRIBUTED FROM THE WRITE REPORT, not from the loop above. The loop counts
    // what was sent; only the writer knows what was new, because only it saw the
    // corpus before the run touched it.
    const insertedSet = new Set(wr.insertedUrls);
    for (const u of wr.writtenUrls) {
      const o = originByUrl.get(u);
      if (!o) continue;
      if (insertedSet.has(u)) {
        inc(report.insertedPerJurisdiction, o.jurisdiction);
        inc(report.insertedPerSource, o.source);
      } else {
        inc(report.updatedPerJurisdiction, o.jurisdiction);
        inc(report.updatedPerSource, o.source);
      }
    }
    printWriteReport('Government writes', wr);
  }
  return report;
}

// ---- Standalone entrypoint (npm run scrape:government) -----------------------
// Fires ONLY the Legistar adapter and the government routing, so the Tier 2 lane
// validates cheaply without the full engine. GOVERNMENT_NO_WRITE=1 skips writes.

function printGovernmentReport(
  r: GovernmentReport,
  stats: Record<string, LegistarJurisdictionStats>
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
  // INSERTED AND UPDATED, SEPARATELY, PER SOURCE. A lane that fetched thousands
  // and inserted nothing looks identical to a healthy one on a `written` total.
  console.log('Writes per source (inserted / updated):');
  {
    const sources = new Set<string>([
      ...Object.keys(r.insertedPerSource),
      ...Object.keys(r.updatedPerSource),
    ]);
    if (sources.size === 0) console.log('    (nothing written)');
    for (const src of [...sources].sort()) {
      const ins = r.insertedPerSource[src] ?? 0;
      const upd = r.updatedPerSource[src] ?? 0;
      console.log(`    ${src.padEnd(20)} ${String(ins).padStart(5)} inserted / ${String(upd).padStart(5)} updated`);
    }
  }
  console.log('Gate telemetry per jurisdiction (fetched / matched / gate-admitted | inserted / updated | dropped: excluded / weak-no-action / no-match):');
  const jurisdictions = new Set<string>([...Object.keys(stats), ...Object.keys(r.perJurisdiction)]);
  for (const j of [...jurisdictions].sort()) {
    const s = stats[j];
    const admitted = r.perJurisdiction[j] ?? 0;
    const ins = r.insertedPerJurisdiction[j] ?? 0;
    const upd = r.updatedPerJurisdiction[j] ?? 0;
    const landed = `${ins} inserted / ${upd} updated`;
    if (!s) {
      // A document-source jurisdiction (govdoc): no Legistar gate telemetry.
      console.log(`    ${j}: ${admitted} gate-admitted | ${landed} (document source, gate bypassed)`);
      continue;
    }
    const drops = s.bypassed
      ? 'gate bypassed'
      : `dropped ${s.droppedExcluded} excluded / ${s.droppedWeakNoAction} weak-no-action / ${s.droppedNoMatch} no-match`;
    console.log(
      `    ${j}: ${s.fetched} fetched / ${s.matched} matched / ${admitted} gate-admitted | ${landed} | ${drops}`
    );
  }
  console.log('Per source_type (document type):');
  console.log(table(r.perSourceType));
  console.log(`Records with a fetched primary document: ${r.primaryDocs}`);
  console.log(`Records with a player extracted: ${r.playersFound} of ${r.written || r.deduped}`);
  console.log(`Records whose people came from the matter's own documents: ${r.documentContacts}`);
  console.log('Attachment depth per jurisdiction (matters processed / attachments listed / fetched / contact blocks):');
  const att = lastAttachmentStats();
  if (Object.keys(att).length === 0) {
    console.log('    (none: no Legistar matter passed the gate, or LEGISTAR_ATTACHMENTS=0)');
  }
  for (const [j, s] of Object.entries(att).sort()) {
    console.log(
      `    ${j}: ${s.mattersProcessed} matters / ${s.attachmentsListed} listed / ${s.attachmentsFetched} fetched / ${s.contactsExtracted} contact blocks`
    );
  }
  console.log('Per venue_type:');
  console.log(table(r.perVenueType));
  console.log('Per signal_type:');
  console.log(table(r.perSignalType));
  console.log('Sample (up to 10): title | jurisdiction | source_type | signal | players (presented_by / applicant / action_sought)');
  for (const s of r.samples) {
    const players = [s.presented_by, s.applicant, s.action_sought].map((x) => x ?? '-').join(' / ');
    console.log(
      `    - ${s.title.slice(0, 46)} | ${s.jurisdiction} | ${s.source_type} | ${s.signal_type} | ${players}`
    );
  }

  // NEW YORK CITY source telemetry. Printed separately from the per-jurisdiction
  // table because all three NYC adapters write the SAME market ('New York City'),
  // so that table cannot show which of the three layers produced what - the same
  // masking that made Anaheim hide Las Vegas before adapter-level health existed.
  //
  // FRESHNESS IS PRINTED, NOT REMEMBERED. ZAP is stale (docs/COVERAGE-MAP.md), and
  // a run report that shows only counts would let a reader assume otherwise.
  if (zapStats.fetched > 0 || zapStats.error) {
    console.log('\nNew York City sources (fetched / schema-rejected / gate-admitted / written):');
    const staleNote =
      zapStats.stalenessDays === null
        ? ''
        : `  [newest content ${zapStats.newestContentDate}, ${zapStats.stalenessDays}d stale]`;
    console.log(
      `    nyc-zap:         ${zapStats.fetched} / ${zapStats.schemaRejected} / ${zapStats.gateAdmitted} / ${zapStats.written}${staleNote}`
    );
    console.log(
      `        gate rejected ${zapStats.gateRejected} (` +
        Object.entries(zapStats.rejectReasons)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${k} ${v}`)
          .join(', ') +
        `); ${zapStats.withCeqr} rows carry a CEQR number for cross-reference`
    );
    if (!zapStats.complete) {
      console.log(`        PARTIAL HARVEST: ${zapStats.error}`);
    }
  }
  if (cityRecordStats.fetched > 0 || cityRecordStats.error) {
    const c = cityRecordStats;
    console.log(
      `    nyc-city-record: ${c.fetched} / ${c.schemaRejected} / ${c.gateAdmitted} / ${c.written}` +
        `  [newest notice ${c.newestNoticeDate}]`
    );
    console.log(`        sections queried: ${LAND_USE_SECTIONS.join(', ')}`);
    console.log(
      `        gate rejected ${c.gateRejected} (` +
        Object.entries(c.rejectReasons)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${k} ${v}`)
          .join(', ') +
        ')'
    );
    // THE CALENDAR NUMBER, printed every run. This is the figure that decides
    // whether a forward calendar screen is buildable, so it is reported rather
    // than recomputed by hand when the question next comes up.
    console.log(
      `        hearing dates: ${c.withEventDate} of ${c.fetched} notices carry one; ` +
        `${c.futureHearings} are still in the future (` +
        (Object.entries(c.futureHearingsBySection)
          .map(([k, v]) => `${k}: ${v}`)
          .join('; ') || 'none') +
        ')'
    );
    if (!c.complete) console.log(`        PARTIAL HARVEST: ${c.error}`);
  }
  if (nycCeqrStats.fetched > 0 || nycCeqrStats.error) {
    const q = nycCeqrStats;
    console.log(
      `    nyc-ceqr:        ${q.fetched} / ${q.schemaRejected} / ${q.gateAdmitted} / ${q.written}` +
        `  [newest milestone ${q.newestMilestone}]`
    );
    console.log(
      `        ${q.outOfMarket} out of market (Upstate); date window dropped ${q.outOfWindow} old + ${q.undatedSkipped} undated`
    );
    console.log(
      `        milestone join: ${q.milestoneRows} rows over ${q.milestoneProjects} projects; ${q.withMilestone} admitted projects dated`
    );
    // THE CROSS-REFERENCE COUNT. A CEQR document belongs to the same project as
    // its ULURP application, so this is the number that says whether layer three
    // is joining layer one or running beside it.
    console.log(
      `        ULURP cross-reference: ${q.crossReferenced} of ${q.written} written CEQR projects matched a ZAP application` +
        ` (ZAP supplied ${q.crossRefCandidates} distinct CEQR numbers)`
    );
    if (!q.complete) console.log(`        PARTIAL HARVEST: ${q.error}`);
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
  const run = new RunTimer('government');
  resetParseReports();
  // KNOWN-ENTITY BYPASS: the index is built from the project register BEFORE the
  // adapters run, because the gate decision is synchronous and consults it in
  // memory. This is the feedback loop stated plainly - capturing a project makes
  // the next run better at capturing that project's other filings - and it is why
  // the loading happens here, once, rather than per record.
  const entities = await loadKnownEntities();
  console.log(
    `Known entities: ${entities.entities} parties trusted across ${entities.anchors} anchor projects ` +
      `(of ${entities.projects} projects; ${entities.nonAnchorProjects.length} lack independent leisure evidence).`
  );
  // THE ADAPTER TABLE, and why it is a table now.
  //
  // These used to be eight positional calls in a Promise.all with a second,
  // separate array naming them for the health surface. Two lists that had to
  // stay in the same order to stay correct. Declaring the adapter once - its
  // source name, the markets it covers, and how to run it - means run scoping,
  // health reporting and the run report all read the SAME declaration, and a
  // ninth adapter is one entry rather than three edits in three places.
  //
  // `markets` is what the adapter covers, used to decide whether a scoped run
  // needs it at all. A single-market adapter is skipped wholesale when its
  // market is out of scope. A MULTI-MARKET adapter (legistar, govdocs) is
  // handed the scope and filters internally, because skipping it wholesale
  // would drop the five jurisdictions that were asked for along with the one
  // that was not.
  const scope = parseRunScope();
  console.log(`\nSCOPE: ${describeScope(scope)}`);
  // THE PIPELINE AXIS. Validated against the registry, so a typo'd id is a hard
  // error rather than a silent full run, and a lane that does not serve the
  // requested pipeline says so and stops.
  await assertKnownPipeline(scope);
  if (!laneInPipelineScope(scope)) {
    console.log(
      `Lane skipped: scope selects pipeline "${scope.pipeline}", this lane serves ${HOSPITALITY_ID}.`
    );
    return;
  }

  const ADAPTERS: {
    source: string;
    markets: readonly string[];
    multiMarket?: boolean;
    run: () => Promise<NormalizedLead[]>;
  }[] = [
    {
      source: 'legistar',
      markets: legistarMarkets(),
      multiMarket: true,
      run: () => scrapeLegistar(scope),
    },
    {
      source: 'govdocs',
      markets: govDocMarkets(),
      multiMarket: true,
      run: () => scrapeGovDocs(scope),
    },
    {
      source: 'cftod-pdf',
      markets: ['Central Florida Tourism Oversight District'],
      run: () => scrapeCftodPdfItems(),
    },
    { source: 'anaheim-agendas', markets: ['Anaheim, CA'], run: () => scrapeAnaheimAgendas() },
    { source: 'lasvegas-agendas', markets: ['Las Vegas, NV'], run: () => scrapeLasVegasAgendas() },
    { source: 'clark-tab', markets: ['Clark County, NV'], run: () => scrapeClarkTabAgendas() },
    {
      source: 'ceqanet',
      markets: ['Anaheim, CA', 'Orange County, CA', 'California'],
      run: () => scrapeCeqanet(),
    },
    // SFWMD REMOVED 2026-08-21. Measured over the adapter's whole life: 25
    // records, 6 surviving, and TWO published in the last twelve months - both
    // Bonita Springs, both dismissed. The newest surviving capture is
    // 2024-02-02. Every one of the 6 projects it produced is SFWMD-only, so
    // nothing else loses a record. See RETIRED_MARKETS in lib/coverage and
    // RETIRED_SOURCES in opportunity.
    //
    // THE ADAPTER HAD TO GO WITH THE RECORDS, and that is the lesson rather
    // than an aside. South Florida's records were marked lifecycle='retired'
    // earlier the same day and the next run brought them straight back: the
    // scrape path writes lifecycle on every upsert, so a retirement is only as
    // durable as the adapter's silence. Miami-Dade and San Antonio held because
    // they left DEFAULT_JURISDICTIONS at the same time.
    // NEW YORK CITY. Three layers, one market: the boroughs fold into
    // 'New York City' (lib/geography MARKET_ALIASES), so all three adapters
    // declare the city rather than a borough list.
    { source: 'nyc-zap', markets: [NYC_ZAP_MARKET], run: () => scrapeNycZap() },
    {
      source: 'nyc-city-record',
      markets: [NYC_CITY_RECORD_MARKET],
      run: () => scrapeNycCityRecord(),
    },
    { source: 'nyc-ceqr', markets: [NYC_CEQR_MARKET], run: () => scrapeNycCeqr() },
  ];

  const selected = ADAPTERS.filter(
    (a) => scopeIncludesSource(scope, a.source) && scopeIncludesAnyMarket(scope, a.markets)
  );
  const skipped = ADAPTERS.filter((a) => !selected.includes(a));
  if (skipped.length > 0) {
    console.log(
      `  adapters in scope: ${selected.map((a) => a.source).join(', ') || '(none)'}\n` +
        `  adapters skipped:  ${skipped.map((a) => a.source).join(', ')}`
    );
  }

  const results = await Promise.all(selected.map((a) => a.run()));

  // ADAPTER-LEVEL HEALTH, recorded before the lane runs.
  //
  // This is the level that catches total death, and it cannot be derived from
  // the lead rows: Anaheim and Las Vegas both write source 'agenda-portal', so
  // Las Vegas returning zero is completely masked at source level by Anaheim
  // returning thirteen. Only the caller knows which array came from which
  // adapter, so only the caller can name it.
  //
  // ONLY THE ADAPTERS THAT RAN ARE RECORDED. A skipped adapter has no counts,
  // and recording it as zero would be a lie that fires the dead-source alarm on
  // every scoped run.
  for (let i = 0; i < selected.length; i++) {
    recordSourceRun({
      lane: 'government',
      unit: `adapter:${selected[i].source}`,
      fetched: results[i].length,
      kept: results[i].length,
    });
  }

  const report = await runGovernmentLane(results.flat());
  printGovernmentReport(report, lastLegistarStats());
  printParseReports('Boundary schemas');

  // Every new record joins its project, or creates one, or lands in the Inbox.
  // Without this the register goes stale the moment the next run happens.
  printAttachReport('Government', await attachOnWrite(report.write?.writtenUrls ?? []));

  // NEW YORK'S DECISIONS, RE-CHECKED ON EVERY RUN.
  //
  // A CPC report appears once the Commission votes, and 15 of the 28 ULURP
  // numbers the corpus holds have no report yet. Those are matters awaiting a
  // vote rather than misses, and re-checking them is what turns "we are waiting"
  // into "it was decided on Tuesday". About six seconds for the whole New York
  // set - a CPC report costs a median 497ms against 1,883ms for a Clark staff
  // report - so it runs every time rather than on a schedule nobody remembers.
  //
  // AFTER the records are written and attached, because it reads the ULURP
  // numbers those records carry.
  if (process.env.GOVERNMENT_NO_WRITE !== '1') await recheckCpcReports();

  // Per-source health, then the lane total. GOVERNMENT_NO_WRITE runs are
  // excluded: writing nothing is the point of them, so alerting would be noise.
  if (process.env.GOVERNMENT_NO_WRITE !== '1') {
    await reportRunHealth('government', { fetched: report.input, written: report.written });
  } else {
    resetSourceRuns();
  }

  const schemas = allParseReports();
  run.finish({
    fetched: report.input,
    matched: report.deduped,
    written: report.written,
    skipped: report.write?.skippedDismissed ?? 0,
    failed: report.writeFailed,
    detail: {
      documentContacts: report.documentContacts,
      playersFound: report.playersFound,
      primaryDocs: report.primaryDocs,
      overridesProtected: report.write?.rowsWithProtectedFields ?? 0,
      schemaParsed: schemas.reduce((a, r) => a + r.parsed, 0),
      schemaRejected: schemas.reduce((a, r) => a + r.rejected, 0),
      perJurisdiction: report.perJurisdiction,
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // NOTHING TO FLUSH. The logger writes synchronously to stdout, so the
  // .finally(flushSentry) that used to sit here - and the three-second wait it
  // could impose on every run - is gone with the SDK it existed for.
  main().catch((err) => {
    console.error('Government lane failed:', err);
    alarmError(err, { lane: 'government' });
    process.exitCode = 1;
  });
}
