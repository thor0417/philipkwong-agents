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

// ---- CONFIG: jurisdictions (SWAPPABLE) --------------------------------------
// One entry = one Legistar market. `client` is the Legistar API client id (the
// subdomain of <client>.legistar.com); `jurisdictionLabel` is the human location
// tag stored on every lead. Add a market by adding ONE line here.
//
// TARGETED SET. Deliberately pointed at the jurisdictions where leisure /
// development work happens, and pruned to clients VERIFIED live on the public
// Legistar API (webapi.legistar.com returns HTTP 200). The framework is not
// US-specific -- swap in any Legistar market by one line (e.g. { client:
// 'toronto', jurisdictionLabel: 'Toronto, ON' }). Removed as unavailable on the
// public API (all HTTP 500): 'lasvegas', 'clarkcountynv' (the correct Clark County
// code is 'clark'), 'orlando', 'orangecountyfl'. Las Vegas city, Orlando city, and
// Orange County FL are NOT on public Legistar; their comprehensive plans and the
// CFTOD special district are captured via sources/govdocs.ts instead.
export interface LegistarJurisdiction {
  client: string;
  jurisdictionLabel: string;
}
const DEFAULT_JURISDICTIONS: LegistarJurisdiction[] = [
  // Priority targets (leisure/development), verified live:
  { client: 'clark', jurisdictionLabel: 'Clark County, NV' }, // Las Vegas metro / Area15 territory
  { client: 'miamidade', jurisdictionLabel: 'Miami-Dade County, FL' },
  // Additional verified US development markets (trim if too broad):
  { client: 'nashville', jurisdictionLabel: 'Nashville, TN' },
  { client: 'phoenix', jurisdictionLabel: 'Phoenix, AZ' },
  { client: 'sanantonio', jurisdictionLabel: 'San Antonio, TX' },
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
      return { client, jurisdictionLabel };
    })
    .filter((j) => j.client);
  return out.length ? out : null;
}

const JURISDICTIONS: LegistarJurisdiction[] = parseJurisdictions(process.env.LEGISTAR_CLIENTS) ?? DEFAULT_JURISDICTIONS;

// ---- CONFIG: signal keywords (SWAPPABLE) ------------------------------------
// A record matches the lane when any of these appears in its title or text.
// Whole-word, case-insensitive. Edit freely to retarget what counts as a signal.
const KEYWORDS = [
  // Leisure / attractions / hospitality / gaming / culture.
  'entertainment district',
  'tourism improvement district',
  'theme park',
  'water park',
  'waterpark',
  'amusement',
  'resort',
  'hotel development',
  'casino',
  'gaming',
  'integrated resort',
  'arena',
  'stadium',
  'convention center',
  'museum',
  'aquarium',
  'zoo',
  'attraction',
  'tourism development',
  'visitor',
  'cultural center',
  'entertainment complex',
  // Full development spectrum (smart city / urban / mixed-use / infrastructure)
  // plus the planning / entitlement process terms that mark early pre-tender
  // activity. Non-leisure records are captured and categorized, never filtered out.
  'smart city',
  'master-planned community',
  'master planned community',
  'mixed-use',
  'mixed use',
  'urban regeneration',
  'urban renewal',
  'transit-oriented development',
  'transit oriented development',
  'downtown redevelopment',
  'waterfront',
  'redevelopment',
  'transit hub',
  'feasibility study',
  'master plan',
  'masterplan',
  'comprehensive plan',
  'land use',
  'rezoning',
  'development agreement',
  'entitlement',
];

// Per-jurisdiction fetched/matched counts from the most recent scrape, for the
// validation report. Reset at the start of each scrapeLegistar call.
let lastStats: Record<string, { fetched: number; matched: number }> = {};
export function lastLegistarStats(): Record<string, { fetched: number; matched: number }> {
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
  const matters = await fetchJson<LegistarMatter>(
    `${BASE}/${j.client}/Matters?$top=${TOP}&$orderby=${order}`,
    `${j.client} Matters`
  );
  const eventOrder = encodeURIComponent('EventId desc');
  const events = await fetchJson<LegistarEvent>(
    `${BASE}/${j.client}/Events?$top=${TOP}&$orderby=${eventOrder}`,
    `${j.client} Events`
  );

  let matched = 0;

  for (const m of matters) {
    if (!m.MatterId) continue;
    const title = m.MatterTitle || m.MatterName || m.MatterFile || '';
    if (!title) continue;
    const text = `${title}\n${m.MatterName ?? ''}\n${m.MatterFile ?? ''}\n${m.MatterTypeName ?? ''}`;
    if (keywordMatches(text, KEYWORDS).length === 0) continue;
    matched++;
    const url = await publicMatterUrl(j.client, m.MatterId);
    if (byUrl.has(url)) continue;
    byUrl.set(url, {
      title,
      url,
      raw_content: matterContent(m, j.jurisdictionLabel),
      company: m.MatterBodyName ?? null,
      location: j.jurisdictionLabel,
      deadline: null,
      // Freshest of intro / agenda date so recent activity on an old matter reads
      // as fresh for the government freshness gate.
      published_date: latestIso(m.MatterIntroDate, m.MatterAgendaDate),
      value_estimate: null,
      source: 'legistar',
      source_type: legistarSourceType(`${m.MatterTypeName ?? ''} ${title} ${m.MatterBodyName ?? ''}`),
    });
  }

  for (const e of events) {
    if (!e.EventId) continue;
    const text = `${e.EventBodyName ?? ''}\n${e.EventComment ?? ''}\n${e.EventLocation ?? ''}`;
    if (keywordMatches(text, KEYWORDS).length === 0) continue;
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

  lastStats[j.jurisdictionLabel] = { fetched: matters.length + events.length, matched };
  console.log(
    `Legistar ${j.jurisdictionLabel}: ${matters.length + events.length} records fetched, ${matched} keyword-matched.`
  );
}

export async function scrapeLegistar(): Promise<NormalizedLead[]> {
  lastStats = {};
  const byUrl = new Map<string, NormalizedLead>();
  // Each jurisdiction runs independently; one broken client cannot kill the run.
  await Promise.allSettled(JURISDICTIONS.map((j) => scrapeJurisdiction(j, byUrl)));
  const leads = [...byUrl.values()];
  console.log(
    `Legistar: ${leads.length} keyword-matched records across ${JURISDICTIONS.length} jurisdictions.`
  );
  return leads;
}
