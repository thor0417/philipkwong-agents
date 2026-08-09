// NEW YORK CITY, LAYER THREE: CEQR, the city environmental review record.
//
// This is what CEQAnet is for California. Every discretionary action in New
// York City that is not a Type II exemption gets a CEQR number and an
// environmental review, and large entertainment, hotel and mixed-use projects
// appear here - often with a fuller description of what is actually proposed
// than the entitlement filing carries.
//
// Datasets, both refreshed 2026-08-07 (probed 2026-08-09):
//   gezn-7mgk  CEQR Projects     15,362 rows  ceqr, name, description, borough,
//                                             lead_agency, url
//   8fj8-3sgg  CEQR Milestones   dates, keyed by ceqr
//
// ---------------------------------------------------------------------------
// TWO DATASETS, BECAUSE THE PROJECTS TABLE CARRIES NO DATE
// ---------------------------------------------------------------------------
//
// gezn-7mgk has six columns and not one of them is a date. A record with no
// date cannot be aged, cannot be given a milestone, and would land in the
// corpus dated only by first_seen - which would make every CEQR project look
// like it arrived today. The dates live in 8fj8-3sgg, one row per milestone
// per project ("Negative Declaration", "Lead Agency Letter", "Draft Scope").
//
// So this adapter reads both and joins them on the CEQR number in memory. The
// milestone dataset is fetched ONCE for the whole run rather than per project,
// because the alternative is 15,362 requests to build a lookup that is a single
// paged download.
//
// A project's date is its LATEST milestone, and its future milestones are
// carried into the record text so the object model can read them: a CEQR
// project with a scheduled hearing is live whatever its filing date says.
//
// ---------------------------------------------------------------------------
// THE URL IS THE SOURCE'S OWN, NOT ONE THIS ADAPTER CONSTRUCTS
// ---------------------------------------------------------------------------
//
// Unlike CEQAnet - where the SCH number is the identity and the URL is rebuilt
// from it because the host has already moved once - the CEQR dataset PUBLISHES
// a per-project URL (a002-ceqraccess.nyc.gov/ceqr/ProjectInformation/
// ProjectDetail/{internalId}-{ceqr}). That URL carries an internal numeric id
// this adapter has no other way to learn, so it cannot be reconstructed and is
// taken as given, validated as a URL at the boundary, and fetch-verified.
//
// The CEQR NUMBER remains the record's identity for clustering and for the
// cross-reference to ULURP, so a URL change would not fragment the register the
// way the CEQAnet rehost did.
//
// ---------------------------------------------------------------------------
// 'UPSTATE' IS NOT NEW YORK CITY
// ---------------------------------------------------------------------------
//
// The borough column carries 523 rows marked 'Upstate' - CEQR reviews for city
// water-supply and watershed property outside the five boroughs, in the Catskill
// and Delaware systems. They are city agency actions but they are not in this
// market, so they are excluded rather than folded into New York City.

import type { NormalizedLead } from './types';
import { gateDecide } from '../gate-decide';
import { bypassHits } from '../targets';
import {
  NycCeqrProjectSchema,
  NycCeqrMilestoneSchema,
  parseRecords,
  type NycCeqrProjectParsed,
} from './schemas';
import { sodaFetchAll, sodaScalar } from './socrata';

export const NYC_CEQR_DATASET = 'gezn-7mgk';
export const NYC_CEQR_MILESTONE_DATASET = '8fj8-3sgg';
export const NYC_CEQR_MARKET = 'New York City';

// A CEQR number as the city prints it: two-digit year, agency code, sequence,
// borough letter ("24DCP043R", "16DCP043R"). Normalised so the ULURP
// cross-reference and the clustering rule key on one spelling.
const CEQR_SHAPE = /^[0-9]{2}[A-Z]{2,6}[0-9]{3,4}[A-Z]?$/;

// THE STORED LINK IS NOT THE ONE THE DATASET PUBLISHES, and that is a
// correction rather than a preference.
//
// gezn-7mgk carries a `url` column pointing at
// a002-ceqraccess.nyc.gov/ceqr/ProjectInformation/ProjectDetail/{internalId}-{ceqr}.
// EVERY ONE OF THOSE IS DEAD. CEQR Access answers them with HTTP 200 and a body
// whose only heading is "Page Not Found" - measured across all 114 stored CEQR
// URLs, 114 of 114, byte-identical to the response for a deliberately invalid
// id. The application's deeper routes appear to have been retired; its landing
// page still serves and contains no project links at all.
//
// A soft 404 is worse than a hard one: a status-code check passes it. That is
// exactly how these were previously reported as "325 of 325 resolve".
//
// SO THE LINK GOES TO THE PUBLISHER OF RECORD. NYC Open Data renders the same
// dataset with a filter in the URL, so the client opens a page that resolves
// and shows that CEQR project rather than a page that errors. It is an index
// view rather than the agency's own project page, and the record text says so.
//
// The agency URL is NOT discarded - it is written into the record so the
// original reference survives, marked dead, in case CEQR Access returns.
const CEQR_DATASET_VIEW = 'https://data.cityofnewyork.us/City-Government/CEQR-Projects/gezn-7mgk';

export function ceqrProjectUrl(ceqr: string): string | null {
  const n = normalizeCeqr(ceqr);
  if (!n) return null;
  const soql = encodeURIComponent(`SELECT * WHERE ceqr='${n}'`);
  return `${CEQR_DATASET_VIEW}/explore/query/${soql}/page/filter`;
}

export function normalizeCeqr(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).replace(/\s+/g, '').toUpperCase();
  return CEQR_SHAPE.test(s) ? s : null;
}

// Boroughs fold to New York City (lib/geography MARKET_ALIASES). 'Upstate' is
// deliberately absent: a row outside the five boroughs is not in this market.
const BOROUGH_LOCATION: Record<string, string> = {
  manhattan: 'Manhattan',
  brooklyn: 'Brooklyn',
  queens: 'Queens',
  bronx: 'Bronx',
  'staten island': 'Staten Island',
  citywide: 'New York City',
};

const EXCLUDED_BOROUGHS = new Set(['upstate']);

// HOW FAR BACK TO REACH, and why CEQR needs the window applied in memory rather
// than in the query. The projects dataset has no date column at all, so the
// window cannot be a $where: the date only exists after the milestone join, and
// so the filter has to happen after it. The whole projects table is fetched
// either way; what the window controls is what gets WRITTEN.
//
// The default matches the other two New York adapters. CEQR runs back to the
// late 1990s and an unwindowed run writes the Museum of Modern Art's 2000
// expansion alongside this year's filings - technically true, and noise in a
// register of live development.
//
// A project with NO milestone at all is excluded while a window is active,
// because an undated record cannot be shown to fall inside it. Those are
// counted and reported rather than silently dropped.
const DEFAULT_SINCE = '2023-01-01';

function sinceSetting(): string | null {
  const raw = (process.env.NYC_CEQR_SINCE ?? DEFAULT_SINCE).trim();
  if (raw.toLowerCase() === 'all') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : DEFAULT_SINCE;
}

export interface CeqrMilestones {
  latest: string | null;
  futureMax: string | null;
  names: string[];
}

export interface NycCeqrStats {
  fetched: number;
  schemaRejected: number;
  outOfMarket: number;
  // Gate-admitted but outside the date window, and gate-admitted but carrying no
  // milestone at all while a window is active. Counted so a windowed run never
  // reads as an exhaustive one.
  outOfWindow: number;
  undatedSkipped: number;
  // Rows whose CEQR number will not normalise, so no link can be built.
  unlinkable: number;
  gateAdmitted: number;
  gateRejected: number;
  bypassHits: number;
  written: number;
  pages: number;
  complete: boolean;
  error: string | null;
  // Milestone join telemetry.
  milestoneRows: number;
  milestoneProjects: number;
  withMilestone: number;
  withoutMilestone: number;
  newestMilestone: string | null;
  // ULURP cross-reference: CEQR numbers that also appear on a ZAP row.
  crossReferenced: number;
  crossRefCandidates: number;
  rejectReasons: Record<string, number>;
  admittedSamples: string[];
  rejectedSamples: string[];
}

export const nycCeqrStats: NycCeqrStats = {
  fetched: 0,
  schemaRejected: 0,
  outOfMarket: 0,
  outOfWindow: 0,
  undatedSkipped: 0,
  unlinkable: 0,
  gateAdmitted: 0,
  gateRejected: 0,
  bypassHits: 0,
  written: 0,
  pages: 0,
  complete: true,
  error: null,
  milestoneRows: 0,
  milestoneProjects: 0,
  withMilestone: 0,
  withoutMilestone: 0,
  newestMilestone: null,
  crossReferenced: 0,
  crossRefCandidates: 0,
  rejectReasons: {},
  admittedSamples: [],
  rejectedSamples: [],
};

function resetStats(): void {
  Object.assign(nycCeqrStats, {
    fetched: 0,
    schemaRejected: 0,
    outOfMarket: 0,
    outOfWindow: 0,
    undatedSkipped: 0,
    unlinkable: 0,
    gateAdmitted: 0,
    gateRejected: 0,
    bypassHits: 0,
    written: 0,
    pages: 0,
    complete: true,
    error: null,
    milestoneRows: 0,
    milestoneProjects: 0,
    withMilestone: 0,
    withoutMilestone: 0,
    newestMilestone: null,
    crossReferenced: 0,
    crossRefCandidates: 0,
    rejectReasons: {},
    admittedSamples: [],
    rejectedSamples: [],
  });
}

// The milestone lookup, built once per run. Keyed by normalised CEQR number.
async function loadMilestones(): Promise<Map<string, CeqrMilestones>> {
  const byCeqr = new Map<string, CeqrMilestones>();
  const result = await sodaFetchAll({
    dataset: NYC_CEQR_MILESTONE_DATASET,
    order: 'ceqr',
  });
  if (!result.complete) {
    console.warn(`NYC CEQR: PARTIAL milestone harvest (${result.error}); dates will be incomplete.`);
  }
  const { records } = parseRecords(NycCeqrMilestoneSchema, result.rows, {
    source: 'nyc-ceqr',
    endpoint: `resource/${NYC_CEQR_MILESTONE_DATASET}`,
  });
  nycCeqrStats.milestoneRows = records.length;

  const todayIso = new Date().toISOString().slice(0, 10);
  for (const m of records) {
    const key = normalizeCeqr(m.ceqr);
    if (!key) continue;
    const day = m.milestone_date.slice(0, 10);
    if (Number.isNaN(Date.parse(day))) continue;
    const cur = byCeqr.get(key) ?? { latest: null, futureMax: null, names: [] };
    if (!cur.latest || day > cur.latest) cur.latest = day;
    if (day > todayIso && (!cur.futureMax || day > cur.futureMax)) cur.futureMax = day;
    if (m.milestone_name && cur.names.length < 8) cur.names.push(`${m.milestone_name} ${day}`);
    byCeqr.set(key, cur);
  }
  nycCeqrStats.milestoneProjects = byCeqr.size;
  return byCeqr;
}

// The ULURP cross-reference set: every CEQR number that appears on a ZAP row.
// Fetched as a projection of the ZAP dataset rather than the whole thing,
// because only one column is needed.
//
// WHY THIS IS A SET AND NOT A JOIN THAT CREATES RECORDS. A CEQR document
// belongs to the SAME project as its ULURP application - that is the whole
// point of the CEQR number appearing in both. Recording the link in the record
// text lets the clusterer put them in one project (agents/scraper/cluster
// CASE_RULES); creating a second project here would be the parallel-project bug
// this cross-reference exists to prevent.
async function loadZapCeqrNumbers(): Promise<Set<string>> {
  const out = new Set<string>();
  const result = await sodaFetchAll({
    dataset: 'hgx4-8ukb',
    select: ['ceqr_number'],
    where: 'ceqr_number is not null',
    order: 'ceqr_number',
  });
  if (!result.complete) {
    console.warn(`NYC CEQR: PARTIAL ZAP cross-reference fetch (${result.error}).`);
  }
  for (const row of result.rows) {
    const n = normalizeCeqr((row as Record<string, unknown>).ceqr_number as string);
    if (n) out.add(n);
  }
  return out;
}

function gateTextOf(r: NycCeqrProjectParsed): string {
  return [r.project_name, r.project_description, r.lead_agency].filter(Boolean).join(' ');
}

export async function scrapeNycCeqr(): Promise<NormalizedLead[]> {
  resetStats();
  const since = sinceSetting();

  const newest = await sodaScalar(NYC_CEQR_MILESTONE_DATASET, 'max(milestone_date)');
  if (newest && !Number.isNaN(Date.parse(newest))) {
    nycCeqrStats.newestMilestone = newest.slice(0, 10);
  }

  const [milestones, zapCeqr] = await Promise.all([loadMilestones(), loadZapCeqrNumbers()]);
  nycCeqrStats.crossRefCandidates = zapCeqr.size;

  const result = await sodaFetchAll({
    dataset: NYC_CEQR_DATASET,
    order: 'ceqr',
  });
  nycCeqrStats.pages = result.pages;
  nycCeqrStats.complete = result.complete;
  nycCeqrStats.error = result.error;
  if (!result.complete) {
    console.warn(`NYC CEQR: PARTIAL harvest after ${result.pages} pages (${result.error}).`);
  }

  const { records } = parseRecords(NycCeqrProjectSchema, result.rows, {
    source: 'nyc-ceqr',
    endpoint: `resource/${NYC_CEQR_DATASET}`,
  });
  nycCeqrStats.fetched = result.rows.length;
  nycCeqrStats.schemaRejected = result.rows.length - records.length;

  const leads: NormalizedLead[] = [];
  const seen = new Set<string>();

  for (const r of records) {
    const boroughKey = String(r.borough ?? '').trim().toLowerCase();
    if (EXCLUDED_BOROUGHS.has(boroughKey)) {
      nycCeqrStats.outOfMarket++;
      continue;
    }
    const ceqr = normalizeCeqr(r.ceqr);

    // THE DATE WINDOW IS APPLIED BEFORE THE GATE, not after.
    //
    // It used to run after, which was harmless for capture (the same records
    // were written either way) and wrong for MEASUREMENT. gateDecide records
    // every candidate it judges into the audit corpus, and that corpus is the
    // denominator gate precision and recall are measured on. Gating all 15,362
    // CEQR projects and then discarding two thirds of them put a twenty-year
    // archive into the corpus as if the system considered it, and CEQR alone
    // would have outweighed every other government source combined - making the
    // pooled gate numbers a measurement of CEQR rather than of the gate.
    //
    // A record the run will discard is not a candidate. So the window decides
    // first, and only what this lane would actually consider reaches the gate.
    const ms = ceqr ? milestones.get(ceqr) : undefined;
    if (since) {
      if (!ms?.latest) {
        nycCeqrStats.undatedSkipped++;
        continue;
      }
      if (ms.latest < since && !ms.futureMax) {
        nycCeqrStats.outOfWindow++;
        continue;
      }
    }

    // The link a client opens. Built from the CEQR number by the one
    // constructor above; the agency's own URL is dead (see ceqrProjectUrl).
    const url = ceqrProjectUrl(r.ceqr);
    if (!url) {
      // No usable CEQR number means no addressable page, so the row is counted
      // and skipped rather than written under a link that errors.
      nycCeqrStats.unlinkable++;
      continue;
    }
    const gateText = gateTextOf(r);
    const title = (r.project_name ?? r.ceqr).slice(0, 200);

    const decision = gateDecide({
      source: 'nyc-ceqr',
      market: NYC_CEQR_MARKET,
      key: url,
      title,
      gate_text: gateText,
      bypass_mode: 'all',
    });

    if (!decision.admitted) {
      nycCeqrStats.gateRejected++;
      nycCeqrStats.rejectReasons[decision.reason] = (nycCeqrStats.rejectReasons[decision.reason] ?? 0) + 1;
      if (nycCeqrStats.rejectedSamples.length < 10) {
        nycCeqrStats.rejectedSamples.push(`${title} :: ${(r.project_description ?? '').slice(0, 120)}`);
      }
      continue;
    }
    nycCeqrStats.gateAdmitted++;
    if (nycCeqrStats.admittedSamples.length < 10) {
      nycCeqrStats.admittedSamples.push(`${title} :: ${(r.project_description ?? '').slice(0, 120)}`);
    }
    if (decision.bypass) nycCeqrStats.bypassHits++;
    if (seen.has(url)) continue;
    seen.add(url);

    if (ms?.latest) nycCeqrStats.withMilestone++;
    else nycCeqrStats.withoutMilestone++;

    const crossRef = Boolean(ceqr && zapCeqr.has(ceqr));
    if (crossRef) nycCeqrStats.crossReferenced++;

    const hits = [...new Set(bypassHits(gateText).map((h) => h.term))];
    const location = BOROUGH_LOCATION[boroughKey] ?? 'New York City';

    leads.push({
      title,
      url,
      raw_content: [
        `NYC environmental review (CEQR): ${r.project_name ?? r.ceqr}`,
        `CEQR number: ${ceqr ?? r.ceqr}`,
        r.lead_agency ? `Lead agency: ${r.lead_agency}` : '',
        `Borough: ${r.borough ?? '(unknown)'}`,
        r.project_description ? `Project description: ${r.project_description}` : '',
        ms?.latest ? `Latest environmental milestone: ${ms.latest}` : 'Environmental milestones: (none published)',
        // A future milestone is written as a bare ISO date so the object model
        // reads it: a CEQR project with a scheduled milestone is live whatever
        // its filing date says.
        ms?.futureMax ? `Next scheduled milestone: ${ms.futureMax}` : '',
        ms?.names.length ? `Milestones: ${ms.names.join('; ')}` : '',
        // THE CROSS-REFERENCE, stated in the record itself so the clusterer can
        // join this document to the ULURP application it belongs to rather than
        // opening a parallel project for the same development.
        crossRef
          ? `Cross-referenced to a ZAP / ULURP application on CEQR number ${ceqr}`
          : 'No matching ZAP / ULURP application found for this CEQR number',
        `Gate: ${decision.bypass ? 'bypass' : decision.reason}`,
        hits.length ? `Target-term hits: ${hits.join(', ')}` : '',
        `Project page (NYC Open Data, filtered to this CEQR number): ${url}`,
        `Agency page (CEQR Access, currently dead - serves Page Not Found): ${r.url}`,
      ]
        .filter(Boolean)
        .join('\n'),
      company: r.lead_agency ?? null,
      location,
      deadline: null,
      published_date: ms?.latest ? new Date(`${ms.latest}T00:00:00Z`).toISOString() : null,
      value_estimate: null,
      source: 'nyc-ceqr',
      source_type: 'Environmental Review',
      applicant: null,
      action_sought: null,
      primary_document_url: url,
      has_primary_document: false,
    });
  }

  nycCeqrStats.written = leads.length;
  console.log(
    `NYC CEQR: ${nycCeqrStats.fetched} projects fetched over ${nycCeqrStats.pages} pages` +
      ` -> ${nycCeqrStats.schemaRejected} schema-rejected, ${nycCeqrStats.outOfMarket} out of market (Upstate)` +
      ` -> ${nycCeqrStats.gateAdmitted} gate-admitted / ${nycCeqrStats.gateRejected} gate-rejected -> ${leads.length} leads` +
      ` | ${nycCeqrStats.withMilestone} dated from ${nycCeqrStats.milestoneRows} milestone rows` +
      (since
        ? ` | window since ${since} dropped ${nycCeqrStats.outOfWindow} old + ${nycCeqrStats.undatedSkipped} undated`
        : ' | no date window (full history)') +
      ` | ${nycCeqrStats.crossReferenced} cross-referenced to ULURP`
  );
  return leads;
}
