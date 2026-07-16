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

const BASE = 'https://webapi.legistar.com/v1';
const UA = 'philipkwong-agents/1.0 (+scraper)';
// Records pulled per endpoint per jurisdiction (most recent first). Bounds the run.
const TOP = Number(process.env.LEGISTAR_TOP ?? '200');

// ---- CONFIG: jurisdictions (SWAPPABLE) --------------------------------------
// One entry = one Legistar market. `client` is the Legistar API client id (the
// subdomain of <client>.legistar.com); `jurisdictionLabel` is the human location
// tag stored on every lead. Add a market by adding ONE line here.
//
// STARTER SET (proof-of-framework, to be revised after Panorama Monday). The
// client ids are best-effort and verified only by the run itself: a wrong id
// simply yields zero for that jurisdiction (logged), it does not break the lane.
// This is a US starter set; the framework is not US-specific -- swap in any
// Legistar market on earth (e.g. { client: 'toronto', jurisdictionLabel: 'Toronto, ON' }).
export interface LegistarJurisdiction {
  client: string;
  jurisdictionLabel: string;
}
const JURISDICTIONS: LegistarJurisdiction[] = [
  { client: 'lasvegas', jurisdictionLabel: 'Las Vegas, NV' },
  { client: 'clarkcountynv', jurisdictionLabel: 'Clark County, NV' },
  { client: 'orlando', jurisdictionLabel: 'Orlando, FL' },
  { client: 'orangecountyfl', jurisdictionLabel: 'Orange County, FL' },
  { client: 'miamidade', jurisdictionLabel: 'Miami-Dade County, FL' },
  { client: 'nashville', jurisdictionLabel: 'Nashville, TN' },
  { client: 'phoenix', jurisdictionLabel: 'Phoenix, AZ' },
  { client: 'sanantonio', jurisdictionLabel: 'San Antonio, TX' },
];

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

// Public InSite record links. Include the GUID when the API exposes it (the
// detail pages want it); the ID alone still makes a stable, unique dedup key.
function matterUrl(client: string, m: LegistarMatter): string {
  const guid = m.MatterGuid ? `&GUID=${encodeURIComponent(m.MatterGuid)}` : '';
  return `https://${client}.legistar.com/LegislationDetail.aspx?ID=${m.MatterId}${guid}`;
}
function eventUrl(client: string, e: LegistarEvent): string {
  const guid = e.EventGuid ? `&GUID=${encodeURIComponent(e.EventGuid)}` : '';
  return `https://${client}.legistar.com/MeetingDetail.aspx?ID=${e.EventId}${guid}`;
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
    const url = matterUrl(j.client, m);
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
    });
  }

  for (const e of events) {
    if (!e.EventId) continue;
    const text = `${e.EventBodyName ?? ''}\n${e.EventComment ?? ''}\n${e.EventLocation ?? ''}`;
    if (keywordMatches(text, KEYWORDS).length === 0) continue;
    matched++;
    const url = eventUrl(j.client, e);
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
