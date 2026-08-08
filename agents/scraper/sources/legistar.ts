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
export interface LegistarJurisdiction {
  client: string;
  jurisdictionLabel: string;
  reason: string;
  // Single-purpose district: capture every record, skip the keyword gate.
  bypassGate?: boolean;
}
const DEFAULT_JURISDICTIONS: LegistarJurisdiction[] = [
  { client: 'clark', jurisdictionLabel: 'Clark County, NV', reason: 'Strip-adjacent entitlement; Top Gun / The Strat county layer; Area15 territory.' },
  { client: 'miamidade', jurisdictionLabel: 'Miami-Dade County, FL', reason: 'Hospitality supply pipeline; proven producer.' },
  { client: 'nashville', jurisdictionLabel: 'Nashville, TN', reason: 'East Bank redevelopment, stadium district, hotel boom; proven producer.' },
  { client: 'phoenix', jurisdictionLabel: 'Phoenix, AZ', reason: 'Proven producer; hotel and entertainment growth.' },
  { client: 'sanantonio', jurisdictionLabel: 'San Antonio, TX', reason: 'Lowest priority; produced 8 real records and costs nothing once verified.' },
  { client: 'oakland', jurisdictionLabel: 'Oakland, CA', reason: 'Waterfront / ballpark / Coliseum-site redevelopment; verified live on Legistar.' },
  // DOWNSTATE NEW YORK, added off the back of the NYC test. New York City itself
  // is NOT here and cannot be: its Legistar Web API answers 403 for client 'nyc'
  // on every endpoint (see docs/COVERAGE-MAP.md). The downstate casino cycle is
  // live and its two largest projects sit OUTSIDE the city limits, which is the
  // same shape of error as the Las Vegas Strip not being in Las Vegas.
  { client: 'yonkersny', jurisdictionLabel: 'Yonkers, NY', reason: 'MGM Empire City / MGM Yonkers; a community benefits agreement with MGM Yonkers Inc is already in the record. 274 matters in 12 months, 28 leisure or entitlement. Verified live 2026-08-08.' },
  { client: 'westchestercountyny', jurisdictionLabel: 'Westchester County, NY', reason: 'County that contains Yonkers, and owns Rye Playland, a county-run amusement park. Low yield (3 of 560 matters) but a Legistar config row costs two lines. Verified live 2026-08-08.' },
];

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

async function fetchJson<T>(url: string, label: string): Promise<T[]> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      console.warn(`Legistar ${label}: HTTP ${res.status} (skipping).`);
      return [];
    }
    const data = await res.json();
    return Array.isArray(data) ? (data as T[]) : [];
  } catch (error) {
    console.warn(`Legistar ${label}: fetch failed (${String(error).slice(0, 70)}).`);
    return [];
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
  byUrl: Map<string, NormalizedLead>
): Promise<void> {
  const order = encodeURIComponent('MatterId desc');
  const mattersUrl = `${BASE}/${j.client}/Matters?$top=${TOP}&$orderby=${order}`;
  const rawMatters = await fetchJson<unknown>(mattersUrl, `${j.client} Matters`);
  // Validated at the boundary: a record that does not match the schema is
  // skipped and counted, never written half-understood, and never fatal.
  const matters = parseRecords(LegistarMatterSchema, rawMatters, {
    source: `legistar:${j.client}`,
    endpoint: 'Matters',
  }).records as LegistarMatter[];

  const eventOrder = encodeURIComponent('EventId desc');
  const eventsUrl = `${BASE}/${j.client}/Events?$top=${TOP}&$orderby=${eventOrder}`;
  const rawEvents = await fetchJson<unknown>(eventsUrl, `${j.client} Events`);
  const events = parseRecords(LegistarEventSchema, rawEvents, {
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
  };
  console.log(
    `Legistar ${j.jurisdictionLabel}: ${matters.length + events.length} fetched, ${matched} matched` +
      (j.bypassGate
        ? ' (gate bypassed)'
        : ` (dropped: ${droppedExcluded} excluded, ${droppedWeakNoAction} weak-no-action, ${droppedNoMatch} no-match)`) +
      '.'
  );
}

// The markets this adapter covers, for run scoping. Exported so government.ts
// can decide whether a scoped run needs Legistar at all without duplicating the
// jurisdiction list.
export function legistarMarkets(): string[] {
  return JURISDICTIONS.map((j) => j.jurisdictionLabel);
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
  // Each jurisdiction runs independently; one broken client cannot kill the run.
  await Promise.allSettled(inScope.map((j) => scrapeJurisdiction(j, byUrl)));
  const leads = [...byUrl.values()];
  console.log(
    `Legistar: ${leads.length} keyword-matched records across ${inScope.length} jurisdictions.`
  );
  return leads;
}
