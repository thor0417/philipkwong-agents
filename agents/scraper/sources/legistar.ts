// Legistar (Granicus) government-records source (GLI Tier 2 government lane).
//
// Legistar hosts council agendas and legislative records for hundreds of
// jurisdictions and exposes a public, keyless web API:
//   https://webapi.legistar.com/v1/{client}/Matters
//   https://webapi.legistar.com/v1/{client}/Events
// ONE adapter serves EVERY Legistar jurisdiction. That is the whole replication
// principle: build the platform adapter once, aim it by config. To point the lane
// at a new market, add a one-line entry to JURISDICTIONS; to change what counts
// as a signal, edit KEYWORDS. Nothing else changes.
//
// The adapter fetches recent Matters and Events per jurisdiction, keyword-filters
// titles and text against the config set, and returns normalized leads. Each
// jurisdiction is fetched independently and degrades gracefully: a broken or
// gated client logs and contributes zero, never killing the run.

import type { NormalizedLead } from './types';
import { toIso } from './types';
import { keywordMatches } from '../prefilter';
import type { SourceType } from '../../../lib/taxonomy';
import { bypassModeFor, gateDecide } from '../gate-decide';
import { FULL_SCOPE, scopeIncludesMarket, type RunScope } from '../run-scope';
import { matterContacts, contactProvenance, resetAttachmentStats } from './legistar-attachments';
import { LegistarMatterSchema, LegistarEventSchema, parseRecords } from './schemas';

// Canonical government document type (lib/taxonomy SOURCE_TYPES) for a Legistar
// record, from its matter/body type + title. Ordered most-specific first;
// defaults to Council Agenda (the base Legistar capture). Additive: it enriches
// the existing council-agenda capture, it never drops anything.
const SOURCE_TYPE_RULES: { type: SourceType; keywords: string[] }[] = [
  { type: 'Plan Amendment', keywords: ['comprehensive plan amendment', 'plan amendment', 'small scale amendment', 'large scale amendment', 'future land use amendment', 'cpa'] },
  { type: 'Comprehensive Plan', keywords: ['comprehensive plan', 'comp plan', 'future land use', 'comprehensive land use'] },
  { type: 'Staff Report', keywords: ['staff report', 'staff recommendation'] },
  { type: 'Budget Document', keywords: ['budget', 'appropriation', 'capital improvement plan', 'cip'] },
  { type: 'Planning/Zoning Minutes', keywords: ['planning commission', 'planning and zoning', 'zoning board', 'zoning commission', 'plan commission', 'zoning', 'rezoning', 'variance', 'special use permit', 'site plan'] },
];

function legistarSourceType(text: string): SourceType {
  for (const rule of SOURCE_TYPE_RULES) {
    if (keywordMatches(text, rule.keywords).length > 0) return rule.type;
  }
  return 'Council Agenda';
}

const BASE = 'https://webapi.legistar.com/v1';
const UA = 'philipkwong-agents/1.0 (+scraper)';
// Records pulled per endpoint per jurisdiction (most recent first). Bounds the run.
const TOP = Number(process.env.LEGISTAR_TOP ?? '200');
// Matters whose attachments are fetched at once (multi-megabyte PDFs, one host).
const ATTACHMENT_CONCURRENCY = 4;

// ---- CONFIG: jurisdictions (SWAPPABLE), AS A DOCUMENTED DECISION -------------
// One entry = one Legistar market. `client` is the Legistar API client id (the
// subdomain of <client>.legistar.com); `jurisdictionLabel` is the human location
// tag stored on every lead; `reason` records WHY the market is here. Add a market
// by adding ONE line here.
//
// SELECTION CRITERIA (every entry must meet all three):
//   1. Active leisure / attractions / hospitality / entertainment-district capital
//      in motion.
//   2. A market where GLI or its partners can plausibly work.
//   3. Machine-readable records (verified HTTP 200 on webapi.legistar.com/v1/{code}).
//
// `bypassGate` (optional): a single-purpose district where the jurisdiction ITSELF
// is the signal (a stadium authority, a tourism-improvement district). Such a
// market skips the keyword gate entirely - every record is captured. No Legistar
// market here is single-purpose, so none set it; the field exists so a future
// district can. CFTOD (a single-purpose district) is captured via the document
// sources in sources/govdocs.ts, where the same bypass principle is applied.
//
// VERIFIED against webapi.legistar.com/v1/{code}/Bodies on this brief:
//   Live (HTTP 200): clark, miamidade, phoenix, nashville, sanantonio, oakland.
//   NOT on public Legistar (HTTP 500 on every code variant tried):
//     - City of Las Vegas ('lasvegas','vegas','cityoflasvegas','lvnv','clvnv') ->
//       captured via its agenda portal as a DOCUMENT SOURCE (sources/govdocs.ts).
//       (Clark County still covers the Strip/Top Gun county entitlement layer.)
//     - Anaheim ('anaheim','cityofanaheim') -> DOCUMENT SOURCE (OCVibe / Disneyland
//       Forward planning + council records).
//     - Orange County FL ('orangecountyfl','ocfl','orange') and Orlando
//       ('orlando','orlandofl','cityoforlando') -> not on Legistar; the Disney/
//       Universal orbit is covered by CFTOD + FL comprehensive-plan document sources.
//
// RE-PROBED 2026-08-14 for the Florida and Miami gap. Orange County (7 code
// variants), Orlando (5), Osceola (5) and Miami Beach (5) all answer HTTP 500 on
// every variant. Orlando runs NovusAgenda, Miami Beach runs Granicus, and
// Orange County and Osceola have no platform this repo can read. See
// docs/COVERAGE-MAP.md.
//
// AND ONE TRAP, WHICH IS WHY THIS NOTE IS LONGER THAN IT LOOKS. City of Miami
// answers HTTP 200 on client 'miamifl', so it looks like a two-line config row.
// It is a TEST INSTANCE: six matters total, two of them titled "Test item" and
// "Test March 26, 2026 Resolution Item", four events, nothing matching a leisure
// or entitlement word. The city publishes through miamifl.granicus.com instead,
// where the same view carries 313 agendas.
//
// A 200 FROM /Bodies IS NOT EVIDENCE OF A USABLE JURISDICTION. Check the matter
// count and read the titles before adding a row. miamidade is the same warning
// from the other end: it answers 200 and holds 107 matters, all introduced
// between 2016 and 2018.
export { DEFAULT_JURISDICTIONS, type LegistarJurisdiction } from './legistar-jurisdictions';
import { DEFAULT_JURISDICTIONS, type LegistarJurisdiction } from './legistar-jurisdictions';

// Config override: LEGISTAR_CLIENTS="lasvegas:Las Vegas NV,orlando:Orlando FL"
// swaps the jurisdiction list without a code change (one-line aim at any market).
function parseJurisdictions(env: string | undefined): LegistarJurisdiction[] | null {
  if (!env) return null;
  const out = env
    .split(',')
    .map((pair) => {
      const i = pair.indexOf(':');
      const client = (i === -1 ? pair : pair.slice(0, i)).trim();
      const jurisdictionLabel = (i === -1 ? client : pair.slice(i + 1)).trim();
      return { client, jurisdictionLabel, reason: 'Configured via LEGISTAR_CLIENTS env override.' };
    })
    .filter((j) => j.client);
  return out.length ? out : null;
}

const JURISDICTIONS: LegistarJurisdiction[] = parseJurisdictions(process.env.LEGISTAR_CLIENTS) ?? DEFAULT_JURISDICTIONS;

// ---- MATCH GATE ------------------------------------------------------------
// The flat KEYWORDS list was replaced by the two-tier gate in lib/taxonomy.ts
// (governmentGate: STRONG matches alone, WEAK needs a corroborating ACTION,
// EXCLUSIONS override). The gate lists live in the taxonomy as the single source
// of truth; this lane only applies them (and honors the jurisdiction bypassGate).

// Per-jurisdiction gate telemetry from the most recent scrape, for the validation
// report. Reset at the start of each scrapeLegistar call.
export interface LegistarJurisdictionStats {
  fetched: number;
  matched: number;
  droppedExcluded: number;
  droppedWeakNoAction: number;
  droppedNoMatch: number;
  bypassed: boolean;
  // ---- WHAT THIS READ ACTUALLY COVERED --------------------------------------
  //
  // A LANE THAT READS A SLICE AND DOES NOT SAY SO is the pre-push gate exiting 0
  // over a suite it skipped, one layer down. `fetched` was the only number here
  // and it is the number of rows the REQUEST RETURNED, which was 200 whenever
  // the cap bound - so a truncated read and a complete one printed identically.
  //
  // Measured 2026-08-21, before the fix: all six jurisdictions were truncated,
  // and 53 matters the gate would admit had never been fetched by any run.
  // Clark County alone accounted for 31 of them, against a corpus holding 119
  // Legistar matters in total.
  /** The lower bound this run asked from, ISO day. */
  since: string;
  /** Pages walked by the cursor. */
  pages: number;
  /** False when the page budget ran out before the feed did. */
  complete: boolean;
  /** Why the bound is what it is: 'backfill' on a cold jurisdiction, else 'incremental'. */
  boundReason: 'backfill' | 'incremental';
}
let lastStats: Record<string, LegistarJurisdictionStats> = {};
export function lastLegistarStats(): Record<string, LegistarJurisdictionStats> {
  return lastStats;
}

interface LegistarMatter {
  MatterId?: number;
  MatterGuid?: string;
  MatterFile?: string;
  MatterName?: string;
  MatterTitle?: string;
  MatterTypeName?: string;
  MatterStatusName?: string;
  MatterBodyName?: string;
  MatterIntroDate?: string;
  MatterAgendaDate?: string;
}

interface LegistarEvent {
  EventId?: number;
  EventGuid?: string;
  EventBodyName?: string;
  EventDate?: string;
  EventLocation?: string;
  EventComment?: string;
}

// ---- Public citizen URLs (InSite gateway) -----------------------------------
// The InSite viewer keys LegislationDetail/MeetingDetail on InSite's OWN internal
// ids, which DIFFER from the Web API's MatterId/EventId. A detail URL built from
// the API ids therefore renders "Invalid parameters!" (verified against the live
// portal). gateway.aspx takes the API id, resolves it server-side, and
// 302-redirects to the correct public detail page -- so it is the stable citizen
// link. We CONFIRM each gateway resolves (302 -> detail page) before storing it,
// and fall back to the jurisdiction's public search (matters) or calendar (events)
// page for a record that is not published to the public portal, so we never store
// a URL that errors. Matters use M=l; Events use M=e.
function matterGateway(client: string, id: number): string {
  return `https://${client}.legistar.com/gateway.aspx?M=l&ID=${id}`;
}
function eventGateway(client: string, id: number): string {
  return `https://${client}.legistar.com/gateway.aspx?M=e&ID=${id}`;
}
// Honest per-record fallbacks: a real public page for the jurisdiction, made
// unique per record with a fragment (ignored by the server, so the page still
// loads) so distinct records never collapse on the url dedup / upsert key.
function legislationSearchUrl(client: string, id: number): string {
  return `https://${client}.legistar.com/Legislation.aspx#matter-${id}`;
}
function calendarUrl(client: string, id: number): string {
  return `https://${client}.legistar.com/Calendar.aspx#event-${id}`;
}

// True when the gateway 302-redirects to the expected public detail page (a valid,
// published record). An unavailable/unpublished record returns HTTP 200 with a
// "currently unavailable" / "Invalid parameters!" body and no redirect. Any error
// (timeout, network) is treated as unresolved so the caller uses the fallback.
async function gatewayResolves(gatewayUrl: string, detailMarker: string): Promise<boolean> {
  try {
    const res = await fetch(gatewayUrl, {
      headers: { 'User-Agent': UA },
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    if (res.status >= 300 && res.status < 400) {
      return (res.headers.get('location') ?? '').includes(detailMarker);
    }
    return false;
  } catch {
    return false;
  }
}

// The verified public URL for a Matter: the gateway when it resolves to a real
// LegislationDetail page, else the jurisdiction's legislation search page.
export async function publicMatterUrl(client: string, id: number): Promise<string> {
  const gw = matterGateway(client, id);
  return (await gatewayResolves(gw, 'LegislationDetail.aspx')) ? gw : legislationSearchUrl(client, id);
}
// The verified public URL for an Event: the gateway when it resolves to a real
// MeetingDetail page, else the jurisdiction's public calendar page.
export async function publicEventUrl(client: string, id: number): Promise<string> {
  const gw = eventGateway(client, id);
  return (await gatewayResolves(gw, 'MeetingDetail.aspx')) ? gw : calendarUrl(client, id);
}

// The freshest document date across the supplied fields, as ISO. Used so an
// amendment or a recent agenda action counts as fresh activity even when the
// matter was introduced long ago (the government freshness gate keys on this).
function latestIso(...values: (string | undefined)[]): string | null {
  const times = values
    .map((v) => (v ? new Date(v).getTime() : NaN))
    .filter((t) => !Number.isNaN(t));
  if (times.length === 0) return null;
  return new Date(Math.max(...times)).toISOString();
}

// ---- THE DATE WINDOW, PAGED TO EXHAUSTION ----------------------------------
//
// THE DEFECT THIS REPLACES. This lane asked for
//
//     Matters?$top=200&$orderby=MatterId desc
//
// with no date filter and no cursor, so every run re-read the same newest 200 by
// insertion id. Anything that aged past #200 between runs was never seen again,
// and nothing said so.
//
// MEASURED 2026-08-21, per jurisdiction, matters introduced in the last twelve
// months against what the top-200 reaches, with the real gate run over the
// remainder and cross-referenced against the corpus:
//
//   clark                1000+ in window   200 reached   53 admissible unseen   31 never captured
//   phoenix              1000+             200            15                     8
//   nashville            1000+             200            14                     7
//   oakland               926              200             7                     6
//   yonkersny             274              200             1                     1
//   westchestercountyny   543              200             0                     0
//
// 53 admissible matters in no run we have ever made, against a corpus holding
// 119 Legistar matters in total. Yonkers' single one is the MGM Yonkers
// community benefits agreement, which is why that market reads as empty.
//
// A LARGER $top IS NOT THE FIX. Any fixed top-N binds silently the moment a
// jurisdiction files more than N between runs; it only moves the day it starts
// lying. The bound has to be a DATE, so the question becomes "everything since
// X" rather than "the most recent N, whatever that covers".
//
// KEY-SET PAGING, NOT $skip. Legistar's OData returns an empty body for $skip on
// this endpoint - probed twice on nashville, 0 bytes both times - so offset
// paging is not available. It does support comparison in $filter, so the cursor
// is the last MatterId seen:
//
//     $filter=MatterIntroDate gt datetime'<since>' and MatterId gt <last>
//     $orderby=MatterId & $top=<page>
//
// MatterId is a stable insertion sequence, so ascending order over it is a total
// order with no ties, which is what makes the cursor safe. Same shape as the
// City Record adapter's exhaustive harvest, which is the proof this repo already
// pages correctly somewhere.
//
// IT REPORTS COMPLETENESS RATHER THAN ASSUMING IT. The loop stops when a page
// comes back short - that is the feed ending - or when the page budget runs out,
// which sets complete=false and is stated in the run report. A partial harvest
// that announced itself would have made this defect visible years ago.
const MATTER_PAGE = Number(process.env.LEGISTAR_PAGE ?? '200');
// A backstop against a runaway cursor, not a coverage limit: at 200 a page this
// is 40,000 matters from one jurisdiction, far beyond any real docket. If it
// ever binds, complete=false says so.
const MAX_MATTER_PAGES = Number(process.env.LEGISTAR_MAX_PAGES ?? '200');

interface Harvest<T> {
  rows: T[];
  pages: number;
  complete: boolean;
  // WHY IT STOPPED, because 'complete: false' had two causes and reported one.
  // A page that TIMED OUT returned [] from fetchJson, the loop read zero rows as
  // "the feed ran out", and the read was reported COMPLETE. So a 30-second
  // network failure was indistinguishable from a finished jurisdiction, and the
  // 2026-08-23 backfill reported six jurisdictions complete at exactly 200
  // matters each. Same shape as a gate exiting 0 over a suite it never ran.
  stopped: 'feed-exhausted' | 'page-budget' | 'fetch-failed' | 'cursor-stalled';
}

// ---- WHERE THE BOUND COMES FROM -------------------------------------------
//
// SINCE THE LAST SUCCESSFUL RUN, NOT A FIXED WINDOW, so nothing can age out
// between runs the way it did under the cap. A rolling "last 90 days" would
// reintroduce the same defect on a different axis: a jurisdiction quiet for a
// quarter, then busy, loses whatever it filed while nobody looked.
//
// THE BOUND IS DERIVED FROM THE CORPUS RATHER THAN STORED. The newest matter we
// already hold for this jurisdiction IS the record of the last successful run,
// and it needs no new column, no migration, and cannot drift out of step with
// what was actually written. A run that failed halfway leaves the bound where it
// was, so the next run re-reads the gap rather than skipping it.
//
// MINUS AN OVERLAP, because a matter can be introduced with a date earlier than
// the day it appears in the feed, and a bound set exactly at our newest would
// step over it. Thirty days is far wider than any observed lag and costs one
// page of re-reads, which the writer deduplicates by URL anyway.
//
// AND FLOORED AT THE BACKFILL BOUND. A jurisdiction we hold nothing for - Yonkers
// today - has no last run to be incremental from, so it gets the full twelve
// months. That is the cold-start case and it is the expensive one; see the run
// report, which states which of the two each jurisdiction used.
const BACKFILL_MONTHS = Number(process.env.LEGISTAR_BACKFILL_MONTHS ?? '12');
const OVERLAP_DAYS = Number(process.env.LEGISTAR_OVERLAP_DAYS ?? '30');
// Set for a cold start or a recovery run. See matterBound for why the
// incremental derivation cannot discover that it needs to do this itself.
// argv AS WELL AS env, because an `FOO=1 node ...` prefix in an npm script is a
// POSIX shell construct and npm on Windows runs scripts through cmd, where it is
// a syntax error rather than an environment variable. The flag has to survive
// the platform the product is developed on.
const FORCE_BACKFILL =
  process.env.LEGISTAR_BACKFILL === '1' || process.argv.includes('--backfill');

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function backfillBound(now: Date): string {
  const d = new Date(now);
  d.setMonth(d.getMonth() - BACKFILL_MONTHS);
  return isoDay(d);
}

/**
 * The lower bound for one jurisdiction, and why.
 *
 * `newestHeld` is the newest published_date the corpus holds for this client,
 * or null when we hold nothing. Passed in rather than read here so this file
 * stays a source adapter with no database of its own.
 */
export function matterBound(
  newestHeld: string | null,
  now: Date = new Date(),
  forceBackfill: boolean = FORCE_BACKFILL
): { since: string; reason: 'backfill' | 'incremental' } {
  const floor = backfillBound(now);
  // THE FIRST RUN CANNOT BACKFILL BY DERIVATION, AND THAT IS NOT A DETAIL.
  //
  // Caught in the first real run after this change: Yonkers went "incremental
  // since 2026-01-03" because it holds exactly ONE stray record dated 2026-02-02
  // - dismissed, from some earlier pass - and one record is enough to set a
  // recent bound. The MGM Yonkers matter is dated 2025-09-05, before that bound,
  // so the run that was supposed to recover it skipped straight over it.
  //
  // The derivation is right for steady state and cannot be right for a cold
  // start, because "the newest thing we hold" is not "the oldest thing we are
  // missing". So the backfill is an EXPLICIT MODE rather than something the
  // heuristic is expected to notice: LEGISTAR_BACKFILL=1 takes every
  // jurisdiction to the full window regardless of what it holds.
  if (forceBackfill) return { since: floor, reason: 'backfill' };
  if (!newestHeld) return { since: floor, reason: 'backfill' };
  const d = new Date(newestHeld);
  if (Number.isNaN(d.getTime())) return { since: floor, reason: 'backfill' };
  d.setDate(d.getDate() - OVERLAP_DAYS);
  const since = isoDay(d);
  // Never reach further back than the backfill bound, and never further forward
  // than it either: a jurisdiction whose newest held matter is ancient must not
  // be asked for everything since 2018.
  return since < floor ? { since: floor, reason: 'backfill' } : { since, reason: 'incremental' };
}

async function fetchMattersSince(client: string, sinceIso: string): Promise<Harvest<LegistarMatter>> {
  const rows: LegistarMatter[] = [];
  let lastId = 0;
  let pages = 0;
  for (; pages < MAX_MATTER_PAGES; ) {
    const filter = encodeURIComponent(
      `MatterIntroDate gt datetime'${sinceIso}' and MatterId gt ${lastId}`
    );
    const url =
      `${BASE}/${client}/Matters?$filter=${filter}` +
      `&$top=${MATTER_PAGE}&$orderby=${encodeURIComponent('MatterId')}`;
    const raw = await fetchJson<unknown>(url, `${client} Matters page ${pages + 1}`);
    pages++;
    // A FAILED REQUEST IS NOT AN EMPTY FEED, and this is the whole point of the
    // change. fetchJson returns null when it could not read the page at all, and
    // the read stops as INCOMPLETE rather than reporting the rows it happened to
    // get as the whole window.
    if (raw === null) return { rows, pages, complete: false, stopped: 'fetch-failed' };
    const parsed = parseRecords(LegistarMatterSchema, raw, {
      source: `legistar:${client}`,
      endpoint: 'Matters',
    }).records as LegistarMatter[];
    if (parsed.length === 0) return { rows, pages, complete: true, stopped: 'feed-exhausted' };
    rows.push(...parsed);
    const maxId = parsed.reduce((n, m) => (typeof m.MatterId === 'number' && m.MatterId > n ? m.MatterId : n), lastId);
    // A page that did not advance the cursor would loop forever. It cannot
    // happen while MatterId is ordered and unique, which is exactly why this
    // guards rather than trusts.
    if (maxId <= lastId) return { rows, pages, complete: false, stopped: 'cursor-stalled' };
    lastId = maxId;
    // A SHORT PAGE IS THE END OF THE FEED. Anything else is another page.
    if (parsed.length < MATTER_PAGE) return { rows, pages, complete: true, stopped: 'feed-exhausted' };
  }
  return { rows, pages, complete: false, stopped: 'page-budget' };
}

// NULL MEANS THE REQUEST FAILED. An empty array means the feed had nothing.
// Collapsing the two is what let a timeout read as a finished jurisdiction.
async function fetchJson<T>(url: string, label: string): Promise<T[] | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      console.warn(`Legistar ${label}: HTTP ${res.status} (skipping).`);
      return null;
    }
    const data = await res.json();
    return Array.isArray(data) ? (data as T[]) : [];
  } catch (error) {
    console.warn(`Legistar ${label}: fetch failed (${String(error).slice(0, 70)}).`);
    return null;
  }
}

function matterContent(m: LegistarMatter, jurisdiction: string): string {
  return [
    `Government record (Legistar Matter): ${m.MatterTitle || m.MatterName || ''}`,
    `Jurisdiction: ${jurisdiction}`,
    `File: ${m.MatterFile ?? ''}`,
    `Type: ${m.MatterTypeName ?? ''}`,
    `Status: ${m.MatterStatusName ?? ''}`,
    `Body: ${m.MatterBodyName ?? ''}`,
    `Introduced: ${m.MatterIntroDate ?? ''}`,
  ].join('\n');
}

function eventContent(e: LegistarEvent, jurisdiction: string): string {
  return [
    `Government record (Legistar Event): ${e.EventBodyName || ''}`,
    `Jurisdiction: ${jurisdiction}`,
    `Date: ${e.EventDate ?? ''}`,
    `Location: ${e.EventLocation ?? ''}`,
    `Comment: ${e.EventComment ?? ''}`,
  ].join('\n');
}

// Fetch, keyword-filter, and normalize one jurisdiction's recent Matters and
// Events. Records the fetched/matched counts for the report. Never throws.
async function scrapeJurisdiction(
  j: LegistarJurisdiction,
  byUrl: Map<string, NormalizedLead>,
  newestHeld: string | null
): Promise<void> {
  // THE DATE WINDOW, PAGED TO EXHAUSTION. See fetchMattersSince and matterBound
  // for what this replaces and what it was costing. Validation still happens at
  // the boundary inside the harvest: a record that does not match the schema is
  // skipped and counted, never written half-understood, and never fatal.
  const { since, reason } = matterBound(newestHeld);
  const harvest = await fetchMattersSince(j.client, since);
  const matters = harvest.rows;

  const eventOrder = encodeURIComponent('EventId desc');
  const eventsUrl = `${BASE}/${j.client}/Events?$top=${TOP}&$orderby=${eventOrder}`;
  const rawEvents = await fetchJson<unknown>(eventsUrl, `${j.client} Events`);
  // The events read is a single page and has no cursor, so a failure here costs
  // the events and nothing else. It is still SAID rather than folded into "zero
  // events", which reads as a jurisdiction that held no meetings.
  if (rawEvents === null) {
    console.warn(`Legistar ${j.jurisdictionLabel}: EVENTS READ FAILED - 0 events below is a failure, not a fact.`);
  }
  const events = parseRecords(LegistarEventSchema, rawEvents ?? [], {
    source: `legistar:${j.client}`,
    endpoint: 'Events',
  }).records as LegistarEvent[];

  let matched = 0;
  let droppedExcluded = 0;
  let droppedWeakNoAction = 0;
  let droppedNoMatch = 0;

  // Apply the two-tier gate, or bypass it entirely for a single-purpose district
  // (where the jurisdiction itself is the signal). Returns true to KEEP; otherwise
  // tallies the drop reason for gate telemetry.
  //
  // Routed through gateDecide (agents/scraper/gate-decide) so this lane and the
  // measurement harness apply one rule, and so every candidate - including the
  // rejected ones this used to drop where nothing could see them - is recorded
  // during a gate audit.
  //
  // The mode is resolved from SOURCE_BYPASS_MODE, which now puts Legistar on
  // 'all': this lane consults the target list like every other government
  // source. It was the sole holdout, and the largest source, so a named target
  // arriving here with no venue noun in its title was being dropped.
  const passesGate = (key: string, title: string, text: string): boolean => {
    const d = gateDecide({
      source: 'legistar',
      market: j.jurisdictionLabel,
      key,
      title,
      gate_text: text,
      bypass_mode: bypassModeFor('legistar'),
      single_purpose: !!j.bypassGate,
    });
    if (d.admitted) return true;
    if (d.reason === 'excluded') droppedExcluded++;
    else if (d.reason === 'weak-without-action') droppedWeakNoAction++;
    else droppedNoMatch++;
    return false;
  };

  // Matters that cleared the gate, held until their attachment depth is fetched.
  const gated: { m: LegistarMatter; title: string; url: string }[] = [];
  for (const m of matters) {
    if (!m.MatterId) continue;
    const title = m.MatterTitle || m.MatterName || m.MatterFile || '';
    if (!title) continue;
    const text = `${title}\n${m.MatterName ?? ''}\n${m.MatterFile ?? ''}\n${m.MatterTypeName ?? ''}`;
    // Keyed on the matter id, not the public URL: a rejected matter never has a
    // URL resolved (publicMatterUrl is a fetch, and it happens after the gate).
    if (!passesGate(`matter:${j.client}:${m.MatterId}`, title, text)) continue;
    matched++;
    const url = await publicMatterUrl(j.client, m.MatterId);
    if (byUrl.has(url) || gated.some((g) => g.url === url)) continue;
    gated.push({ m, title, url });
  }

  // ATTACHMENT DEPTH. Every gated matter's own documents are read for the
  // owner / applicant / representative block (sources/legistar-attachments).
  // Bounded concurrency: these are multi-megabyte PDFs on the county's server.
  const contacts = new Array<Awaited<ReturnType<typeof matterContacts>>>(gated.length).fill(null);
  let nextDoc = 0;
  async function docWorker(): Promise<void> {
    while (nextDoc < gated.length) {
      const i = nextDoc++;
      contacts[i] = await matterContacts(j.client, gated[i].m.MatterId as number, j.jurisdictionLabel);
    }
  }
  await Promise.all(Array.from({ length: Math.min(ATTACHMENT_CONCURRENCY, gated.length) }, docWorker));

  for (let i = 0; i < gated.length; i++) {
    const { m, title, url } = gated[i];
    const c = contacts[i];
    byUrl.set(url, {
      title,
      url,
      raw_content: matterContent(m, j.jurisdictionLabel) + (c ? contactProvenance(c) : ''),
      company: m.MatterBodyName ?? null,
      location: j.jurisdictionLabel,
      deadline: null,
      // Freshest of intro / agenda date so recent activity on an old matter reads
      // as fresh for the government freshness gate.
      published_date: latestIso(m.MatterIntroDate, m.MatterAgendaDate),
      value_estimate: null,
      source: 'legistar',
      source_type: legistarSourceType(`${m.MatterTypeName ?? ''} ${title} ${m.MatterBodyName ?? ''}`),
      // Document-sourced people. Null when the documents do not state them; the
      // government lane fills any gap from the record text, never the reverse.
      presented_by: c?.presented_by ?? null,
      applicant: c?.applicant ?? null,
      representative: c?.representative ?? null,
      // The staff report actually read is this record's primary document.
      primary_document_url: c?.documentUrl ?? null,
      has_primary_document: !!c,
    });
  }

  for (const e of events) {
    if (!e.EventId) continue;
    // Gate an event on its BODY NAME only. The event comment/location routinely
    // carry a meeting VENUE name (a council that meets at a convention center, a
    // board that meets at a performing-arts hall), which would false-match STRONG
    // terms; the body name is the event's own identity. The comment/location are
    // still kept in raw_content for context and player extraction.
    if (!passesGate(`event:${j.client}:${e.EventId}`, e.EventBodyName ?? '', e.EventBodyName ?? '')) continue;
    matched++;
    const url = await publicEventUrl(j.client, e.EventId);
    if (byUrl.has(url)) continue;
    byUrl.set(url, {
      title: `${e.EventBodyName || 'Meeting'} (${j.jurisdictionLabel})`,
      url,
      raw_content: eventContent(e, j.jurisdictionLabel),
      company: e.EventBodyName ?? null,
      location: j.jurisdictionLabel,
      deadline: null,
      published_date: toIso(e.EventDate),
      value_estimate: null,
      source: 'legistar',
      source_type: legistarSourceType(`${e.EventBodyName ?? ''} ${e.EventComment ?? ''}`),
    });
  }

  lastStats[j.jurisdictionLabel] = {
    fetched: matters.length + events.length,
    matched,
    droppedExcluded,
    droppedWeakNoAction,
    droppedNoMatch,
    bypassed: !!j.bypassGate,
    since,
    pages: harvest.pages,
    complete: harvest.complete,
    boundReason: reason,
  };
  // WHAT IT REACHED AGAINST WHAT EXISTS, on the same line as the counts, because
  // a lane that reads a slice and does not say so is a green gate over a skipped
  // suite one layer down. `complete` is the harvest running out of feed rather
  // than out of budget.
  console.log(
    `Legistar ${j.jurisdictionLabel}: ${matters.length} matters since ${since} (${reason}) ` +
      `over ${harvest.pages} page${harvest.pages === 1 ? '' : 's'}` +
      (harvest.complete
        ? ''
        : harvest.stopped === 'fetch-failed'
          ? ' *** TRUNCATED: A PAGE REQUEST FAILED, so this window is short by an unknown amount ***'
          : harvest.stopped === 'cursor-stalled'
            ? ' *** TRUNCATED: the id cursor stalled ***'
            : ' PARTIAL - page budget exhausted before the feed was') +
      `, ${events.length} events, ${matched} matched` +
      (j.bypassGate
        ? ' (gate bypassed)'
        : ` (dropped: ${droppedExcluded} excluded, ${droppedWeakNoAction} weak-no-action, ${droppedNoMatch} no-match)`) +
      '.'
  );
  if (!harvest.complete) {
    console.warn(
      `Legistar ${j.jurisdictionLabel}: PARTIAL HARVEST. The page budget ran out before the feed ` +
        `did, so this run covered less than "everything since ${since}". Raise LEGISTAR_MAX_PAGES ` +
        'or narrow the bound; do not read the counts above as coverage.'
    );
  }
}

// The markets this adapter covers, for run scoping. Exported so government.ts
// can decide whether a scoped run needs Legistar at all without duplicating the
// jurisdiction list.
export function legistarMarkets(): string[] {
  return JURISDICTIONS.map((j) => j.jurisdictionLabel);
}

/**
 * The newest matter date the corpus already holds, per Legistar client.
 *
 * THE STORED URL CARRIES THE JURISDICTION, which is what makes this derivable
 * with no new column: the lane writes
 * `https://<client>.legistar.com/gateway.aspx?M=l&ID=<matter>` (or the
 * Legislation.aspx fallback), so the host names the client.
 *
 * FAILS TO BACKFILL, NEVER TO SKIP. Any error returns an empty map, every
 * jurisdiction reads as cold, and the run does the full twelve months. That is
 * expensive and correct; the opposite default would silently narrow a run on a
 * database hiccup, which is the class of failure this whole change is about.
 */
async function newestHeldByClient(clients: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const { supabaseAdmin } = await import('../../../lib/supabase-admin');
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabaseAdmin
        .from('leads')
        .select('url,published_date')
        .eq('source', 'legistar')
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as { url: string | null; published_date: string | null }[];
      for (const r of rows) {
        const host = String(r.url ?? '').match(/^https?:\/\/([^.]+)\.legistar\.com/);
        if (!host) continue;
        const client = host[1];
        if (!clients.includes(client)) continue;
        const d = r.published_date ? String(r.published_date).slice(0, 10) : null;
        if (!d) continue;
        const prev = out.get(client);
        if (!prev || d > prev) out.set(client, d);
      }
      if (rows.length < PAGE) break;
    }
  } catch (e) {
    console.warn(
      `Legistar: could not read the incremental bound (${(e as Error).message}). Every ` +
        'jurisdiction will backfill, which is the safe direction and the slow one.'
    );
    return new Map();
  }
  return out;
}

// SCOPED INTERNALLY, not skipped wholesale. Legistar covers six jurisdictions,
// so a run asking for Clark County still needs this adapter - it just needs one
// sixth of it. Skipping the adapter would drop five markets that were never
// excluded; skipping the other five jurisdictions is the correct narrowing.
export async function scrapeLegistar(scope: RunScope = FULL_SCOPE): Promise<NormalizedLead[]> {
  lastStats = {};
  resetAttachmentStats();
  const byUrl = new Map<string, NormalizedLead>();
  const inScope = JURISDICTIONS.filter((j) => scopeIncludesMarket(scope, j.jurisdictionLabel));
  if (inScope.length < JURISDICTIONS.length) {
    const skipped = JURISDICTIONS.filter((j) => !inScope.includes(j)).map((j) => j.jurisdictionLabel);
    console.log(
      `Legistar: scoped to ${inScope.length} of ${JURISDICTIONS.length} jurisdictions ` +
        `(${inScope.map((j) => j.jurisdictionLabel).join(', ') || 'none'}); ` +
        `skipped ${skipped.join(', ')}.`
    );
  }
  // THE BOUND PER JURISDICTION, READ ONCE. The newest matter we already hold IS
  // the record of the last successful run; see matterBound. Read here rather
  // than inside the adapter so one database round trip serves every
  // jurisdiction, and so a failure to read it degrades to a backfill - the safe
  // direction - instead of skipping the run.
  const newestHeld = await newestHeldByClient(inScope.map((j) => j.client));

  // Each jurisdiction runs independently; one broken client cannot kill the run.
  await Promise.allSettled(
    inScope.map((j) => scrapeJurisdiction(j, byUrl, newestHeld.get(j.client) ?? null))
  );
  const leads = [...byUrl.values()];
  console.log(
    `Legistar: ${leads.length} keyword-matched records across ${inScope.length} jurisdictions.`
  );
  return leads;
}
