// NEW YORK CITY, LAYER ONE: ULURP / ZAP entitlement filings.
//
// The Zoning Application Portal is where every land use application in New York
// City is tracked, from filing through certification, City Planning Commission
// review, Council action and completion. It is the entitlement layer for the
// largest development market in the country, and it carries the applicant by
// name, which is what makes it reach the companies layer and the known-entity
// bypass.
//
// THE PORTAL IS NOT THE SOURCE. zap.planning.nyc.gov is a JavaScript
// application with no reachable public API from this runtime, so it cannot be
// parsed. The same data is published as a Socrata dataset (hgx4-8ukb), which is
// what this adapter reads. The portal URL is still built and stored, because a
// client clicking a RECORD line needs a page that opens; it is verified to
// resolve (HTTP 200) rather than assumed.
//
// ---------------------------------------------------------------------------
// THIS SOURCE IS STALE, AND THAT IS RECORDED HERE RATHER THAN DISCOVERED LATER.
// ---------------------------------------------------------------------------
//
// Measured 2026-08-09:
//   dataset rowsUpdatedAt   2026-05-26   (75 days before the probe)
//   newest content date     2026-04-24   (107 days)
//   rows filed in last 90d  0
//
// docs/ADDING-A-MARKET.md step 2 sets the rule: a source whose newest record is
// more than 45 days old cannot feed a monthly report. ZAP fails it. It is
// ingested anyway, deliberately, as a HISTORICAL ENTITLEMENT BACKBONE - it is
// the only source of applicant names, borough, and the ulurp_numbers ->
// ceqr_number link that the CEQR adapter cross-references against - and
// docs/COVERAGE-MAP.md records New York City entitlement as STALE rather than
// covered. The incremental cursor below is wired and dormant: if DCP resumes
// publishing, this adapter picks up the new rows with no code change.
//
// DCP's own metadata still declares "Update Frequency: Monthly, Automation:
// Yes", names no successor dataset, and its companion ZAP-BBL dataset froze the
// same day, three minutes apart. That is the signature of a stalled automated
// job, not a supersession. No replacement feed exists on the portal: both
// "ULURP Recommendations" datasets are abandoned (88 and 91 rows, last touched
// 2017 and 2021).
//
// ---------------------------------------------------------------------------
// WHICH COLUMN DRIVES INCREMENTALITY, AND WHY
// ---------------------------------------------------------------------------
//
// Column population over all 32,931 rows, measured rather than assumed:
//
//   certified_referred       32,017   97%
//   completed_date           29,882   91%
//   current_milestone_date    2,069    6%
//   app_filed_date            1,409    4%
//   approval_date               929    3%
//   current_envmilestone_date   483    1%
//   noticed_date                456    1%
//
// Two different columns are needed because two different questions are being
// asked, and conflating them is what produced the earlier misreading of this
// source:
//
//   THE CURSOR is `current_milestone_date`. It is the only column that ADVANCES
//   as a project moves through review - it is rewritten at every milestone - so
//   it is the only correct answer to "what changed since last time". Its 6%
//   population is not a defect: it is populated precisely for the projects that
//   are still moving (263 Active + 71 On-Hold + recently closed), which is
//   exactly the set an incremental run wants.
//
//   THE RECORD DATE is `certified_referred`, falling back through the others.
//   At 97% it is the only column that can date the corpus. A record's date must
//   describe the record, not the cursor.
//
// `app_filed_date` is neither. It is set once at filing and populated on 4% of
// rows, so a `$where` on it captures almost nothing - which is what the brief
// this work came from assumed it did, having measured it as 8 rows.

import type { NormalizedLead } from './types';
import { gateDecide, admissionLabel } from '../gate-decide';
import { bypassHits } from '../targets';
import { NycZapRowSchema, parseRecords, type NycZapRowParsed } from './schemas';
import { sodaFetchAll, sodaScalar, soqlTimestamp } from './socrata';

export const NYC_ZAP_DATASET = 'hgx4-8ukb';
export const NYC_ZAP_MARKET = 'New York City';

// THE ONE PLACE A ZAP PROJECT URL IS BUILT. Verified live: project 2026M0366
// returns HTTP 200. The page is JavaScript-rendered so it will not parse, but
// it resolves, which is what a stored URL has to do.
export function zapProjectUrl(projectId: string): string | null {
  const id = String(projectId ?? '').trim().toUpperCase();
  // A ZAP project id is a year, a borough letter and a sequence ("2026M0366"),
  // or the legacy "P" form ("P1985K0925"). Anything else cannot address a page.
  if (!/^P?\d{4}[MXKQR]\d{3,5}$/.test(id)) return null;
  return `https://zap.planning.nyc.gov/projects/${id}`;
}

// Boroughs resolve through the existing alias table to United States / New York
// / New York City. NO BOROUGH-LEVEL MARKETS ARE CREATED: that decision is
// recorded in lib/geography.ts MARKET_ALIASES and stands. The borough is kept
// in the record text so it is still readable and searchable, and so a future
// per-borough split has the data to drive it.
const BOROUGH_LOCATION: Record<string, string> = {
  manhattan: 'Manhattan',
  brooklyn: 'Brooklyn',
  queens: 'Queens',
  bronx: 'Bronx',
  'staten island': 'Staten Island',
  // 'Citywide' names no borough; it is the city itself.
  citywide: 'New York City',
};

function locationFor(borough: string | null | undefined): string {
  const b = String(borough ?? '').trim().toLowerCase();
  return BOROUGH_LOCATION[b] ?? 'New York City';
}

// The record's own date, in the order the columns are actually populated. The
// first non-empty wins; every one of these is a REAL date the source published,
// so date_source stays 'source'.
const DATE_COLUMNS: (keyof NycZapRowParsed)[] = [
  'certified_referred',
  'app_filed_date',
  'current_milestone_date',
  'noticed_date',
  'approval_date',
  'completed_date',
];

function recordDate(r: NycZapRowParsed): { iso: string | null; column: string | null } {
  for (const col of DATE_COLUMNS) {
    const v = r[col];
    if (typeof v === 'string' && v && !Number.isNaN(Date.parse(v))) {
      return { iso: new Date(v).toISOString(), column: col };
    }
  }
  return { iso: null, column: null };
}

// How far back to reach. ZAP runs to the late 1970s and the overwhelming
// majority of it is closed decades ago, so the default window is the recent
// entitlement record rather than the whole archive. NYC_ZAP_SINCE overrides it;
// NYC_ZAP_SINCE=all reaches the full 32,931 rows.
const DEFAULT_SINCE = '2023-01-01';

function sinceSetting(): string | null {
  const raw = (process.env.NYC_ZAP_SINCE ?? DEFAULT_SINCE).trim();
  if (raw.toLowerCase() === 'all') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : DEFAULT_SINCE;
}

// The window clause. Any of the three dates that actually carry recent activity
// puts a row in scope, and a project that is STILL LIVE is always in scope
// whatever its dates say - an Active project with no recent milestone is the
// one most worth capturing, not the one to drop.
function whereClause(since: string | null): string | undefined {
  if (!since) return undefined;
  const t = soqlTimestamp(since);
  return (
    `(current_milestone_date > ${t} OR app_filed_date > ${t} OR certified_referred > ${t}` +
    ` OR project_status in ('Active','On-Hold'))`
  );
}

export interface ZapStats {
  fetched: number;
  schemaRejected: number;
  gateAdmitted: number;
  gateRejected: number;
  bypassHits: number;
  unparsableId: number;
  written: number;
  pages: number;
  complete: boolean;
  error: string | null;
  // Freshness, probed at run time and printed in the run report, so staleness is
  // stated by the run rather than remembered from a comment.
  newestContentDate: string | null;
  stalenessDays: number | null;
  // Gate telemetry for the vocabulary question: the exact briefs admitted and
  // rejected, so the decision to change the gate is made on evidence.
  admittedSamples: string[];
  rejectedSamples: string[];
  rejectReasons: Record<string, number>;
  withCeqr: number;
}

export const zapStats: ZapStats = {
  fetched: 0,
  schemaRejected: 0,
  gateAdmitted: 0,
  gateRejected: 0,
  bypassHits: 0,
  unparsableId: 0,
  written: 0,
  pages: 0,
  complete: true,
  error: null,
  newestContentDate: null,
  stalenessDays: null,
  admittedSamples: [],
  rejectedSamples: [],
  rejectReasons: {},
  withCeqr: 0,
};

function resetStats(): void {
  Object.assign(zapStats, {
    fetched: 0,
    schemaRejected: 0,
    gateAdmitted: 0,
    gateRejected: 0,
    bypassHits: 0,
    unparsableId: 0,
    written: 0,
    pages: 0,
    complete: true,
    error: null,
    newestContentDate: null,
    stalenessDays: null,
    admittedSamples: [],
    rejectedSamples: [],
    rejectReasons: {},
    withCeqr: 0,
  });
}

// The text the gate judges: the project's own subject. The brief is included
// because ZAP's project_name is frequently just an address ("301 E 71st
// Street"), and the brief is where the actual proposal is described.
function gateTextOf(r: NycZapRowParsed): string {
  return [r.project_name, r.project_brief, r.actions, r.current_milestone]
    .filter(Boolean)
    .join(' ');
}

export async function scrapeNycZap(): Promise<NormalizedLead[]> {
  resetStats();
  const since = sinceSetting();

  // Freshness is probed every run and reported, so this source cannot go on
  // being treated as live by a reader who did not check.
  const newest = await sodaScalar(NYC_ZAP_DATASET, 'max(current_milestone_date)');
  if (newest && !Number.isNaN(Date.parse(newest))) {
    zapStats.newestContentDate = newest.slice(0, 10);
    zapStats.stalenessDays = Math.floor((Date.now() - Date.parse(newest)) / 86400000);
  }

  const result = await sodaFetchAll({
    dataset: NYC_ZAP_DATASET,
    where: whereClause(since),
    // Paging without a stable order silently duplicates and skips rows.
    order: 'project_id',
  });
  zapStats.pages = result.pages;
  zapStats.complete = result.complete;
  zapStats.error = result.error;
  if (!result.complete) {
    console.warn(`NYC ZAP: PARTIAL harvest after ${result.pages} pages (${result.error}).`);
  }

  const { records } = parseRecords(NycZapRowSchema, result.rows, {
    source: 'nyc-zap',
    endpoint: `resource/${NYC_ZAP_DATASET}`,
  });
  zapStats.fetched = result.rows.length;
  zapStats.schemaRejected = result.rows.length - records.length;

  const leads: NormalizedLead[] = [];
  const seen = new Set<string>();

  for (const r of records) {
    const url = zapProjectUrl(r.project_id);
    if (!url) {
      // No addressable page means no RECORD line a client can follow, so the
      // row is counted and skipped rather than written under a guessed URL.
      zapStats.unparsableId++;
      continue;
    }
    const gateText = gateTextOf(r);
    const title = (r.project_name ?? r.project_id).slice(0, 200);

    const decision = gateDecide({
      source: 'nyc-zap',
      market: NYC_ZAP_MARKET,
      key: url,
      title,
      gate_text: gateText,
      bypass_mode: 'all',
    });

    if (!decision.admitted) {
      zapStats.gateRejected++;
      zapStats.rejectReasons[decision.reason] = (zapStats.rejectReasons[decision.reason] ?? 0) + 1;
      if (zapStats.rejectedSamples.length < 10) {
        zapStats.rejectedSamples.push(`${title} :: ${(r.project_brief ?? '').slice(0, 140)}`);
      }
      continue;
    }
    zapStats.gateAdmitted++;
    if (zapStats.admittedSamples.length < 10) {
      zapStats.admittedSamples.push(`${title} :: ${(r.project_brief ?? '').slice(0, 140)}`);
    }
    if (decision.bypass) zapStats.bypassHits++;
    if (seen.has(url)) continue;
    seen.add(url);
    if (r.ceqr_number) zapStats.withCeqr++;

    const { iso, column } = recordDate(r);
    const hits = [...new Set(bypassHits(gateText).map((h) => h.term))];
    const location = locationFor(r.borough);

    leads.push({
      title,
      url,
      raw_content: [
        `NYC land use application (ZAP / ULURP): ${r.project_name ?? r.project_id}`,
        `ZAP project id: ${r.project_id}`,
        r.project_brief ? `Project brief: ${r.project_brief}` : '',
        r.ulurp_numbers ? `ULURP numbers: ${r.ulurp_numbers}` : '',
        r.ceqr_number ? `CEQR number: ${r.ceqr_number}` : '',
        r.ceqr_type ? `CEQR type: ${r.ceqr_type}` : '',
        r.ceqr_leadagency ? `CEQR lead agency: ${r.ceqr_leadagency}` : '',
        r.actions ? `Actions: ${r.actions}` : '',
        r.ulurp_non ? `Review type: ${r.ulurp_non}` : '',
        r.primary_applicant ? `Primary applicant: ${r.primary_applicant}` : '',
        r.applicant_type ? `Applicant type: ${r.applicant_type}` : '',
        `Borough: ${r.borough ?? '(unknown)'}`,
        r.community_district ? `Community district: ${r.community_district}` : '',
        r.cc_district ? `Council district: ${r.cc_district}` : '',
        r.current_milestone ? `Current milestone: ${r.current_milestone}` : '',
        r.current_milestone_date ? `Current milestone date: ${r.current_milestone_date.slice(0, 10)}` : '',
        r.app_filed_date ? `Application filed: ${r.app_filed_date.slice(0, 10)}` : '',
        r.certified_referred ? `Certified / referred: ${r.certified_referred.slice(0, 10)}` : '',
        r.approval_date ? `Approved: ${r.approval_date.slice(0, 10)}` : '',
        r.completed_date ? `Completed: ${r.completed_date.slice(0, 10)}` : '',
        r.project_status ? `Project status: ${r.project_status}` : '',
        r.public_status ? `Public status: ${r.public_status}` : '',
        column ? `Record date taken from: ${column}` : 'Record date: (none published)',
        `Gate: ${admissionLabel(decision)}`,
        hits.length ? `Target-term hits: ${hits.join(', ')}` : '',
        `Project page: ${url}`,
      ]
        .filter(Boolean)
        .join('\n'),
      // The applicant is the developer, so it is the company. This is what
      // carries ZAP into the companies layer and the known-entity bypass.
      company: r.primary_applicant ?? null,
      location,
      deadline: null,
      published_date: iso,
      value_estimate: null,
      source: 'nyc-zap',
      source_type: 'Planning Application',
      // Set directly from the source column, so the Haiku player extraction
      // never has to guess at a name the dataset already states. mergePlayers
      // treats a source-supplied applicant as outranking the model's reading.
      applicant: r.primary_applicant ?? null,
      action_sought: r.actions ?? null,
      primary_document_url: url,
      has_primary_document: false,
    });
  }

  zapStats.written = leads.length;
  const stale =
    zapStats.stalenessDays === null
      ? ''
      : ` | newest content ${zapStats.newestContentDate} (${zapStats.stalenessDays}d stale)`;
  console.log(
    `NYC ZAP: ${zapStats.fetched} rows fetched over ${zapStats.pages} pages` +
      ` -> ${zapStats.schemaRejected} schema-rejected -> ${zapStats.gateAdmitted} gate-admitted` +
      ` / ${zapStats.gateRejected} gate-rejected -> ${leads.length} leads` +
      ` (${zapStats.bypassHits} target bypass, ${zapStats.withCeqr} carry a CEQR number)${stale}`
  );
  return leads;
}
