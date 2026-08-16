// GLI lane (Grant Leisure International).
//
// Finds leisure, attraction, hospitality, gaming, and cultural venue
// opportunities. Runs entirely on its own path: Serper results in, an LLM
// inclusion gate + venue/signal tagging, project-level dedup, then a direct
// write with module 'gli'. It never touches the fuel or consulting lanes and is
// never fit-scored by the Haiku consulting scorer.
//
// Inclusion rule (the gate): keep only leads about a NEW or PLANNED visitor
// attraction, leisure destination, resort, hotel, casino, or cultural /
// entertainment venue at a planning, feasibility, development, engineering, or
// operator-selection stage. Operational business news, ticket-price stories,
// existing-venue operations, and generic non-leisure tenders are dropped.
//
// Every kept lead carries a venue_type and a signal_type. General News leads are
// kept but tagged so the dashboard can deprioritize them; non-leisure noise is
// dropped. Contacts are captured when the snippet exposes them, never required.

import Anthropic from '@anthropic-ai/sdk';
import { pathToFileURL } from 'node:url';
import {
  LIVE_PIPELINE_STORAGE_KEY,
  HOSPITALITY_ID,
  assertKnownPipeline,
  laneInPipelineScope,
} from './pipelines';
import { parseRunScope, describeScope, scopeIncludesSource } from './run-scope';
import { supabaseAdmin } from '../../lib/supabase-admin';

import type { NormalizedLead } from './sources/types';
import {
  scrapeSerper,
  lastSerperSearchCount,
  RECENCY_WINDOW_DAYS,
  MAX_SEARCHES_PER_RUN,
} from './sources/serper';
import { primeClientWatchTerms } from './client-watch-terms';
import { gliQueries } from './profiles';
import { normalizeCompany } from './cross-reference';
import { keywordMatches } from './prefilter';
import { opportunityVenueHint, opportunitySignalHint } from './classify';
import { classifyVenueType, categoryForVenue } from '../../lib/taxonomy';
import { configuredPrimaryDocument } from './sources/govdocs';
import { deriveLeadDates, objectFields, shouldDelete } from './lead-date';
import { geographyFields } from '../../lib/geography';
import { CORPUS_COUNTRIES, inCorpusScope } from '../../lib/corpus-scope';
import { hostOf, isJunkDomain } from './junk-domains';
import { guardedUpsert, emptyWriteReport, printWriteReport } from './write-guard';
import { selectAllPaged } from './page-select';
import { resetParseReports, printParseReports, allParseReports } from './sources/schemas';
import { RunTimer } from './logger';
import { recordSourceRun, reportRunHealth, resetSourceRuns } from './health';
import { attachOnWrite, printAttachReport } from './project-attach';
import { subDays } from 'date-fns';

// Does a column exist on `leads`? Probed once and cached, so a migration that
// is Philip's to run cannot break the lane in the meantime. Asking PostgREST
// for the column is cheaper and more truthful than reading a schema table: if
// the select succeeds the column is writable.
const columnProbe = new Map<string, boolean>();
async function columnExists(column: string): Promise<boolean> {
  const cached = columnProbe.get(column);
  if (cached !== undefined) return cached;
  const { error } = await supabaseAdmin.from('leads').select(column).limit(1);
  const ok = !error;
  columnProbe.set(column, ok);
  return ok;
}

const MODEL = 'claude-haiku-4-5-20251001';
// The pipeline this lane writes to, resolved from the registry rather than
// typed as a literal. See agents/scraper/pipelines.
const GLI_MODULE = LIVE_PIPELINE_STORAGE_KEY;

// ---- Source-chaining (Pass 4): trade press -> primary document ----------------
// A curated-press article is the breadcrumb; the primary government document it
// references is the value (the CFTOD 2045 plan, found via a Blooloop article, is
// the proof case). When an article references a primary source, follow it and
// resolve the primary document URL. Never fabricated: if no candidate resolves,
// the fields stay null.
const CHAIN_UA = 'Mozilla/5.0 (compatible; philipkwong-agents/1.0 +scraper)';

// Article text mentions a government plan / filing / primary document.
const PRIMARY_SOURCE_TERMS = [
  'comprehensive plan', 'comp plan', 'master plan', 'oversight district',
  'planning commission', 'zoning board', 'staff report', 'ordinance', 'resolution',
  'city council', 'county commission', 'development agreement', 'entitlement',
  'rezoning', 'land use', 'special district', 'planning filing', 'council approved',
  'adopted a plan', 'adopted the plan',
];
function referencesPrimarySource(text: string | null): boolean {
  if (!text) return false;
  return keywordMatches(text, PRIMARY_SOURCE_TERMS).length > 0;
}

// A candidate link points at a government / official-district host, or looks like
// a primary planning document (comp plan, staff report, ordinance, agenda, pdf).
const GOV_HOST_RE = /(^|\.)(gov|mil)$|(^|\.)us$|oversightdistrict\.org$/i;
const DOC_HINT_RE = /comprehensive[-_ ]?plan|comp[-_ ]?plan|master[-_ ]?plan|staff[-_ ]?report|ordinance|resolution|agenda|planning|zoning|\.pdf(\?|$)/i;

function isFileContentType(ct: string, url: string): boolean {
  return /pdf|officedocument|msword|octet-stream/i.test(ct) || /\.(pdf|docx?)(\?|$)/i.test(url);
}

// Fetch the article, parse its links, and resolve the best primary-document
// candidate (gov host and/or document hint, PDFs preferred). Confirms the
// candidate with a fetch to set hasFile. Returns null when nothing resolves.
async function resolvePrimaryDocument(
  articleUrl: string | null
): Promise<{ url: string; hasFile: boolean } | null> {
  if (!articleUrl) return null;
  let html = '';
  let articleHost = '';
  try {
    articleHost = new URL(articleUrl).hostname.replace(/^www\./, '');
    const res = await fetch(articleUrl, {
      headers: { 'User-Agent': CHAIN_UA, Accept: 'text/html,*/*' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    if (!(res.headers.get('content-type') ?? '').includes('html')) return null;
    html = await res.text();
  } catch {
    return null;
  }

  const candidates: { abs: string; score: number }[] = [];
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    let abs: string;
    let host: string;
    try {
      abs = new URL(m[1], articleUrl).toString();
      host = new URL(abs).hostname.replace(/^www\./, '');
    } catch {
      continue;
    }
    if (host === articleHost) continue; // skip on-site links (nav, related posts)
    const isGov = GOV_HOST_RE.test(host);
    const hint = DOC_HINT_RE.test(abs);
    const isPdf = /\.pdf(\?|$)/i.test(abs);
    if (!isGov && !hint) continue;
    candidates.push({ abs, score: (isGov ? 3 : 0) + (isPdf ? 2 : 0) + (hint ? 1 : 0) });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0].abs;

  let hasFile = false;
  try {
    const r2 = await fetch(best, {
      headers: { 'User-Agent': CHAIN_UA, Accept: '*/*' },
      signal: AbortSignal.timeout(15000),
    });
    hasFile = r2.ok && isFileContentType(r2.headers.get('content-type') ?? '', best);
  } catch {
    /* reference kept even if the confirmation fetch fails */
  }
  return { url: best, hasFile };
}

// ---- High-risk location exclusion (GLI gate) -------------------------------
// After a lead's location is determined by the classifier, it is DROPPED if the
// location falls in an excluded jurisdiction (counted separately from noise).
// This is a sanctions / travel-advisory screen, not a relevance judgement; keep
// it current as the landscape changes. Matching is whole-word, case-insensitive,
// accent-folded against the classifier's location string. A lead with no
// determined location is never dropped here (fail-open: relevance already
// passed).
//
// Excluded wholesale (country level). Ukraine is included in full: treat the
// entire country as excluded while the war continues (the Crimea / Donetsk /
// Luhansk oblasts are the sharpest cases but the whole country is off-limits).
const HIGH_RISK_COUNTRIES = [
  'cuba',
  'iran',
  'north korea',
  'russia',
  'belarus',
  'venezuela',
  'myanmar',
  'burma', // former name of Myanmar, still common in listings
  'sudan',
  'south sudan',
  'nicaragua',
  'afghanistan',
  'yemen',
  'syria',
  'somalia',
  'libya',
  'haiti',
  'ukraine', // whole country excluded during the war (incl. Crimea/Donetsk/Luhansk)
];

// Excluded by sub-region (drop the region, KEEP the rest of the country).
//   - Ukraine oblasts, listed explicitly for documentation (Ukraine is already
//     excluded wholesale above).
//   - Mexico high-risk states ONLY. Mexico is in scope as a market: safe tourism
//     zones (Quintana Roo, Baja California Sur, Yucatan, Jalisco, Nayarit,
//     Mexico City, Queretaro) are KEPT. A Mexican location is dropped only when
//     it names one of the excluded states below; when in doubt, it is kept.
const HIGH_RISK_REGIONS = [
  // Ukraine oblasts (Ukraine already excluded wholesale; kept here for clarity).
  'crimea',
  'donetsk',
  'luhansk',
  // Mexico high-risk states.
  'sinaloa',
  'michoacan',
  'tamaulipas',
  'guerrero',
  'colima',
  'zacatecas',
];

const HIGH_RISK_LOCATIONS = [...HIGH_RISK_COUNTRIES, ...HIGH_RISK_REGIONS];

// Fold combining diacritics so unaccented terms match accented location strings
// (e.g. "Michoacan" matches "Michoacán").
function deaccent(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// True when the determined location falls in an excluded jurisdiction. Null /
// empty locations are never high-risk (fail-open).
function isHighRiskLocation(location: string | null): boolean {
  if (!location) return false;
  return keywordMatches(deaccent(location), HIGH_RISK_LOCATIONS).length > 0;
}

// Best-effort country/region label for the run's global-spread tally: the last
// comma-separated segment of the location, else the whole string, else Unknown.
function countryOf(location: string | null): string {
  if (!location) return 'Unknown';
  const parts = location.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : 'Unknown';
}

// ---- Junk domain hard-exclusion (GLI gate) ---------------------------------
// Leads from these domains are dropped before scoring, and already-stored rows
// on them are swept (purgeStoredJunk). The list lives in ../junk-domains so the
// Serper watch pass can exclude the same domains at QUERY time.

// ---- source_tier classification --------------------------------------------
// Primary sources: government, planning authorities, tourism boards, RFP portals.
// These carry the highest signal for origination and feasibility intelligence.
const PRIMARY_DOMAINS = [
  '.gov',
  '.gov.au',
  '.gov.uk',
  '.gc.ca',
  'unwto.org',
  'worldbank.org',
  'ifc.org',
  'ebrd.com',
  'adb.org',
  // Tourism and development authorities -- add as encountered
  'visitmecca.sa.gov.sa',
  'neom.com',
  'rda.gov.sa',
];

// Trade press: leisure, attractions, hospitality industry publications.
const TRADE_DOMAINS = [
  'blooloop.com',
  'attractionsmanagement.com',
  'meed.com',
  'hospitalitynet.org',
  'ggbmagazine.com',
  'parkworld-online.com',
  'iaapa.org',
  'teaconnect.org',
  'themeparkinsider.com',
  'traveldailynews.com',
  'hotelnewsresource.com',
  'travelweekly.com',
  // Add trade press as encountered
];

// Domain source tier: 'primary' (gov / authority / dev bank), 'trade' (industry
// press), or 'news' (everything else that cleared the junk filter).
export function sourceTier(url: string | null): string {
  const host = hostOf(url);
  if (!host) return 'news';
  if (host.includes('.gov') || PRIMARY_DOMAINS.some((d) => host.endsWith(d))) {
    return 'primary';
  }
  if (TRADE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) {
    return 'trade';
  }
  return 'news';
}

export const VENUE_TYPES = [
  'Theme Park',
  'Amusement Park',
  'Waterpark',
  'Family Entertainment Center',
  'Zoo',
  'Aquarium',
  'Museum',
  'Science Center',
  'Heritage/Cultural Site',
  'Hotel',
  'Resort',
  'Integrated Resort',
  'Casino/Gaming',
  'Expo/Exposition',
  'Leisure Destination/Mixed',
] as const;

export const SIGNAL_TYPES = [
  'Origination',
  'Feasibility RFP',
  'Engineering/Technical',
  'Operator/Management',
  'Investment/Funding',
  'General News',
] as const;

type VenueType = (typeof VENUE_TYPES)[number];
type SignalType = (typeof SIGNAL_TYPES)[number];

const PROMPT_HEAD = `You are the lead qualification agent for Grant Leisure International (GLI), which develops and advises on leisure, attraction, hospitality, gaming, and cultural venues worldwide.

Judge the item below and return STRICT JSON only (no preamble, no markdown).

INCLUSION RULE (the gate). Set "keep" to true ONLY when the item is about a NEW or PLANNED visitor attraction, leisure destination, resort, hotel, casino, or cultural / entertainment venue at a planning, feasibility, development, engineering, or operator-selection stage. Set "keep" to false for: operational business news, ticket-price or promotion stories, existing-venue day-to-day operations, earnings/attendance recaps, and any generic non-leisure tender (roads, utilities, generic engineering, IT, defence, etc.). Generic engineering (roads, utilities, plant) that is NOT for a leisure/attraction/hospitality/gaming/cultural venue fails the rule: keep=false.

When keep is true, tag TWO fields.

venue_type (choose exactly one):
Theme Park, Amusement Park, Waterpark, Family Entertainment Center, Zoo, Aquarium, Museum, Science Center, Heritage/Cultural Site, Hotel, Resort, Integrated Resort, Casino/Gaming, Expo/Exposition, Leisure Destination/Mixed

signal_type (choose exactly one):
- Origination: early announcement, no tender yet
- Feasibility RFP: any feasibility study or feasibility report, master-plan solicitation, RFP / request for proposal, tender for consultancy, procurement notice, or expression of interest (EOI) for a leisure / attraction / hospitality / gaming / cultural venue. Trigger this whenever the item centres on a feasibility study/report, master-plan solicitation, RFP, consultancy tender, procurement notice, or EOI in a leisure/attraction context, even when it also reads like an announcement or a consultant's project page.
- Engineering/Technical: engineering, design, or technical delivery FOR a leisure/attraction/hospitality/gaming/cultural venue (never generic roads/utilities)
- Operator/Management: seeking an operator or management partner
- Investment/Funding: capital moving into a leisure/attraction project
- General News: relevant to the sector but not yet an actionable project signal

PRIORITY: When feasibility study/report, master plan solicitation, RFP, request for proposal, tender for consultancy, procurement notice, or expression of interest language appears together with a leisure / attraction / hospitality / gaming / cultural venue, choose Feasibility RFP over Origination or General News. A page describing a feasibility study or master plan for such a venue is Feasibility RFP, not General News.

RELEVANCE: Actionable project signals (Origination, Feasibility RFP, Engineering/Technical, Operator/Management, Investment/Funding) are the priority. General News is still kept (keep=true) but tagged General News. Pure non-leisure noise is keep=false.

Also extract, when present in the text (else null):
- project_name: the specific project/venue name (for dedup across articles). Prefer the venue/development name over the publisher.
- location: city / region / country of the project
- contact_name, contact_email, contact_phone: any named contact for the project

Respond in this exact JSON shape:
{
  "keep": true,
  "venue_type": "Resort",
  "signal_type": "Feasibility RFP",
  "project_name": "string or null",
  "location": "string or null",
  "contact_name": "string or null",
  "contact_email": "string or null",
  "contact_phone": "string or null",
  "reason": "one short sentence"
}

Item:
`;

export interface GliClassification {
  keep: boolean;
  venue_type: VenueType | null;
  signal_type: SignalType | null;
  project_name: string | null;
  location: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  reason: string;
}

function coerceEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (typeof value !== 'string') return null;
  const hit = allowed.find((a) => a.toLowerCase() === value.trim().toLowerCase());
  return hit ?? null;
}

function cleanStr(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (!t || t.toLowerCase() === 'null' || t.toLowerCase() === 'none' || t === 'n/a') return null;
  return t;
}

function parseClassification(text: string): GliClassification | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = (fenced ? fenced[1] : text).trim();
  const first = body.indexOf('{');
  const last = body.lastIndexOf('}');
  if (first !== -1 && last > first) body = body.slice(first, last + 1);
  try {
    const p = JSON.parse(body);
    const keep = p.keep === true;
    return {
      keep,
      venue_type: keep ? coerceEnum(p.venue_type, VENUE_TYPES) : null,
      signal_type: keep ? coerceEnum(p.signal_type, SIGNAL_TYPES) : null,
      project_name: cleanStr(p.project_name),
      location: cleanStr(p.location),
      contact_name: cleanStr(p.contact_name),
      contact_email: cleanStr(p.contact_email),
      contact_phone: cleanStr(p.contact_phone),
      reason: cleanStr(p.reason) ?? '',
    };
  } catch {
    return null;
  }
}

const client = new Anthropic();
const MAX_CONCURRENCY = 6;
const MAX_RETRIES = 3;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function classifyGli(lead: NormalizedLead): Promise<GliClassification> {
  let response;
  for (let attempt = 0; ; attempt++) {
    try {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content: PROMPT_HEAD + `Title: ${lead.title}\nURL: ${lead.url}\n\n${lead.raw_content}`,
          },
        ],
      });
      break;
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 429 && attempt < MAX_RETRIES) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw err;
    }
  }

  const block = response.content[0];
  const text = block && block.type === 'text' ? block.text : '';
  const parsed = parseClassification(text);
  if (!parsed) {
    console.error(
      `GLI classify parse failed for "${lead.title.slice(0, 50)}". Raw: ${JSON.stringify(text.slice(0, 160))}`
    );
    // Fail closed: an unparseable judgement is dropped, never written blind.
    return {
      keep: false,
      venue_type: null,
      signal_type: null,
      project_name: null,
      location: null,
      contact_name: null,
      contact_email: null,
      contact_phone: null,
      reason: 'Parse error',
    };
  }
  // A kept lead with no usable venue_type is a malformed judgement: fail closed.
  if (parsed.keep && !parsed.venue_type) parsed.keep = false;
  return parsed;
}

// Classify a batch through a fixed-size worker pool. Results preserve order.
async function classifyBatch(leads: NormalizedLead[]): Promise<GliClassification[]> {
  const results = new Array<GliClassification>(leads.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < leads.length) {
      const i = next++;
      results[i] = await classifyGli(leads[i]);
    }
  }
  const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, leads.length) }, worker);
  await Promise.all(workers);
  return results;
}

// ---- GLI Tier 1 opportunity tagging -----------------------------------------
// A tagged opportunity: venue_type / signal_type plus any contact the classifier
// surfaced. venue_type / signal_type are always populated (LLM value or keyword
// fallback), so an opportunity lead is never left untagged.
export interface OpportunityTag {
  venue_type: string;
  // Null when no signal was earned (LLM returned none and no hint term matched);
  // such a lead is NOT written to the opportunity stream. A signal is earned.
  signal_type: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
}

// Tag Tier 1 opportunity leads with venue_type / signal_type using the GLI
// classifier for TAGGING ONLY, never as a keep/drop gate: these leads already
// cleared the leisure-advisory legitimacy gate (isLeisureOpportunity), so they
// are captured regardless of the classifier's keep verdict. When the classifier
// returns no venue/signal (e.g. it judged keep=false for a terse tender title), a
// keyword fallback fills them so every lead is tagged and written.
export async function tagOpportunities(leads: NormalizedLead[]): Promise<OpportunityTag[]> {
  const classifications = await classifyBatch(leads);
  return leads.map((lead, i) => {
    const c = classifications[i];
    return {
      venue_type: c.venue_type ?? opportunityVenueHint(lead),
      signal_type: c.signal_type ?? opportunitySignalHint(lead),
      contact_name: c.contact_name,
      contact_email: c.contact_email,
      contact_phone: c.contact_phone,
    };
  });
}

// Normalized project key for dedup: project name + location. Two articles about
// the same project collapse to one lead. Falls back to the (already
// URL-deduped) title when no project name was extracted, so distinct untitled
// items are not over-merged.
function projectKey(c: GliClassification, lead: NormalizedLead): string {
  const name = normalizeCompany(c.project_name ?? lead.title);
  const loc = normalizeCompany(c.location ?? '');
  return `${name}|${loc}`;
}

export interface GliReport {
  // Total Serper searches issued this run (set by the caller from the adapter).
  searches: number;
  fetched: number;
  urlDeduped: number;
  // Dropped before scoring because the source domain is hard-excluded junk.
  droppedJunk: number;
  // Recency gate (Tier 3 intelligence): dropped because published_date is older
  // than the window; kept-but-undated (no parseable date, kept and counted).
  droppedStale: number;
  undatedKept: number;
  // Already-stored junk rows swept from Supabase this run (self-healing).
  purgedJunk: number;
  kept: number;
  droppedNoise: number;
  // Dropped at the gate for a high-risk / sanctioned location (separate from
  // noise drops).
  droppedHighRisk: number;
  // Dropped because the project's own geography resolved outside the countries
  // this system covers. See lib/corpus-scope. Counted separately from the
  // high-risk screen because it is a coverage decision, not a safety one.
  droppedOutOfCountry: number;
  projectDuplicates: number;
  written: number;
  writeFailed: number;
  // Tombstone / override telemetry.
  skippedDismissed: number;
  protectedByOverride: number;
  // URLs this run actually wrote, for the project attach pass.
  writtenUrls: string[];
  // Source-chaining (Pass 4): kept leads that referenced a primary source, those
  // for which a primary_document_url resolved, and those where a real file was
  // fetched (has_primary_document).
  chainReferenced: number;
  chainResolved: number;
  chainWithFile: number;
  chainSamples: Array<{ article: string; primaryUrl: string; hasFile: boolean }>;
  perVenueType: Record<string, number>;
  perSignalType: Record<string, number>;
  // Kept leads by source_tier (primary / trade / news).
  perTier: Record<string, number>;
  // Kept leads by country/region label, for the global-spread view.
  perCountry: Record<string, number>;
  samples: Array<{
    title: string;
    published_date: string;
    domain: string;
    venue_type: string;
    signal_type: string;
    location: string;
    contact: boolean;
  }>;
}

const inc = (m: Record<string, number>, k: string): void => {
  m[k] = (m[k] ?? 0) + 1;
};

// Self-healing sweep: already-stored GLI leads whose source domain is now
// hard-excluded junk are DISMISSED, not deleted. The write-time filter gates new
// leads, but rows written before the filter existed (or before a domain was
// added to JUNK_DOMAINS) would otherwise linger.
//
// This used to delete. It stopped deleting because it once removed two stored
// rows as a silent side effect of adding domains to the junk list, with no list
// of what went and no way to get them back. Nothing in this system hard-deletes
// a row any more: dismissal is a status, the row stays in the table, Trash shows
// it, and Restore brings it back. Every affected row is logged by URL before it
// is touched.
//
// A row Philip has already judged is left alone entirely: dismissing an already
// dismissed row is a no-op, and any other status he set is his decision, not a
// domain rule's.
async function purgeStoredJunk(): Promise<number> {
  // PAGED. This selected every GLI row unbounded, and PostgREST caps at 1000.
  // With 808 GLI rows it was three government runs from silently sweeping only
  // the first thousand and reporting success.
  const { rows: data, pages, complete } = await selectAllPaged<{
    id: string;
    url: string | null;
    status: string | null;
  }>('leads', 'id, url, status', (q) => (q as any).eq('module', GLI_MODULE), 'GLI junk sweep');
  if (!complete) {
    console.error('GLI junk sweep: read incomplete; skipping to avoid a partial sweep.');
    return 0;
  }
  console.log(`GLI junk sweep: read ${data.length} GLI rows across ${pages} page(s).`);
  const junk = data.filter(
    (r) => isJunkDomain(hostOf(r.url)) && r.status !== 'dismissed'
  );
  if (junk.length === 0) return 0;
  console.log(`GLI junk sweep: dismissing ${junk.length} stored rows on hard-excluded domains:`);
  for (const r of junk) console.log(`    ${r.id}  ${r.url}`);
  const { error: upErr } = await supabaseAdmin
    .from('leads')
    .update({ status: 'dismissed', status_changed_at: new Date().toISOString() })
    .in(
      'id',
      junk.map((r) => r.id)
    );
  if (upErr) {
    console.error(`GLI junk sweep: dismissal failed: ${upErr.message}`);
    return 0;
  }
  console.log(`GLI: dismissed ${junk.length} stored junk-domain leads (not deleted; visible in Trash).`);
  return junk.length;
}

// Run the GLI lane over already-fetched Serper leads: gate, tag, dedup by
// project, and write (module 'gli'). Set GLI_NO_WRITE=1 to produce the report
// without persisting (useful before the 006 migration is applied).
export async function runGliLane(rawLeads: NormalizedLead[]): Promise<GliReport> {
  const fetched = rawLeads.length;

  // URL dedup (the adapter already dedups within itself; this guards merges).
  const byUrl = new Map<string, NormalizedLead>();
  for (const l of rawLeads) if (l.url && !byUrl.has(l.url)) byUrl.set(l.url, l);
  const urlDeduped = [...byUrl.values()];

  // Hard-exclude junk domains before any scoring/classification (saves LLM
  // cost and keeps low-quality sources out of Supabase entirely).
  const leads: NormalizedLead[] = [];
  let droppedJunk = 0;
  for (const l of urlDeduped) {
    if (isJunkDomain(hostOf(l.url))) {
      droppedJunk++;
      continue;
    }
    leads.push(l);
  }
  console.log(`GLI: dropped ${droppedJunk} leads as low-quality source.`);

  // Recency gate (Tier 3 intelligence): drop leads whose published_date is older
  // than the window; keep undated leads but count them separately so good sources
  // that omit dates are not silently dropped. Runs before classification to save
  // LLM cost on stale items.
  // Absolute-instant arithmetic, so local vs UTC does not arise: date-fns
  // subDays on a millisecond instant is exactly the hand-rolled subtraction.
  const cutoff = subDays(new Date(), RECENCY_WINDOW_DAYS).getTime();
  let droppedStale = 0;
  let undatedKept = 0;
  const fresh: NormalizedLead[] = [];
  for (const l of leads) {
    const t = l.published_date ? new Date(l.published_date).getTime() : NaN;
    if (Number.isNaN(t)) {
      undatedKept++;
      fresh.push(l);
      continue;
    }
    if (t < cutoff) {
      droppedStale++;
      continue;
    }
    fresh.push(l);
  }
  console.log(
    `GLI: recency gate (${RECENCY_WINDOW_DAYS}d) dropped ${droppedStale} stale, kept ${undatedKept} undated.`
  );

  const classifications = await classifyBatch(fresh);

  // Apply the inclusion gate, then dedup kept leads by project key.
  const perVenueType: Record<string, number> = {};
  const perSignalType: Record<string, number> = {};
  const perTier: Record<string, number> = {};
  const perCountry: Record<string, number> = {};
  const seenProjects = new Set<string>();
  const kept: Array<{ lead: NormalizedLead; c: GliClassification }> = [];
  let droppedNoise = 0;
  let droppedHighRisk = 0;
  let droppedOutOfCountry = 0;
  let projectDuplicates = 0;

  for (let i = 0; i < fresh.length; i++) {
    const lead = fresh[i];
    const c = classifications[i];
    if (!c.keep) {
      droppedNoise++;
      continue;
    }
    // High-risk location screen: drop after relevance passes and the location is
    // determined, counted separately from noise.
    if (isHighRiskLocation(c.location)) {
      droppedHighRisk++;
      continue;
    }
    // THE COUNTRY SCREEN. The lane searches the open web, so it returns whatever
    // is out there: 216 of 451 live press records had resolved to somewhere we
    // have no adapter pointed at, which is a headline with no filing behind it.
    //
    // Resolved through the SAME call the write path uses a few lines below, so
    // what is admitted and what is stored cannot disagree about where a project
    // is. Null passes: see inCorpusScope - an unresolved country is not a
    // foreign one, and "Fort Wayne" resolves to null.
    const scopeGeo = geographyFields(c.location ?? lead.location, lead.country);
    if (!inCorpusScope(scopeGeo.country)) {
      droppedOutOfCountry++;
      continue;
    }
    const key = projectKey(c, lead);
    if (seenProjects.has(key)) {
      projectDuplicates++;
      continue;
    }
    seenProjects.add(key);
    kept.push({ lead, c });
  }

  const report: GliReport = {
    searches: 0,
    fetched,
    urlDeduped: urlDeduped.length,
    droppedJunk,
    droppedStale,
    undatedKept,
    purgedJunk: 0,
    kept: kept.length,
    droppedNoise,
    droppedHighRisk,
    droppedOutOfCountry,
    projectDuplicates,
    written: 0,
    writeFailed: 0,
    skippedDismissed: 0,
    protectedByOverride: 0,
    writtenUrls: [],
    chainReferenced: 0,
    chainResolved: 0,
    chainWithFile: 0,
    chainSamples: [],
    perVenueType,
    perSignalType,
    perTier,
    perCountry,
    samples: [],
  };

  // Source-chaining: for kept leads whose article references a primary government
  // document, follow the reference and resolve the primary_document_url (never
  // fabricated). Runs on the kept subset only, before the write loop.
  for (const { lead } of kept) {
    const text = `${lead.title}\n${lead.raw_content}`;
    if (!referencesPrimarySource(text)) continue;
    report.chainReferenced++;
    // 1. Follow the article's own links to a primary document. 2. Fall back to a
    // configured primary document the article references (verified URL, not guessed).
    const resolved = (await resolvePrimaryDocument(lead.url)) ?? configuredPrimaryDocument(text);
    if (!resolved) continue;
    lead.primary_document_url = resolved.url;
    lead.has_primary_document = resolved.hasFile;
    report.chainResolved++;
    if (resolved.hasFile) report.chainWithFile++;
    if (report.chainSamples.length < 10) {
      report.chainSamples.push({ article: lead.url, primaryUrl: resolved.url, hasFile: resolved.hasFile });
    }
  }

  const noWrite = process.env.GLI_NO_WRITE === '1';
  const pendingWrites: Record<string, unknown>[] = [];

  let rejectedPreCutoff = 0;
  for (const { lead, c } of kept) {
    // Capture gate: intelligence leads are project events (no deadline), so they
    // are never rejected here. shouldDelete stays as the single gate for symmetry.
    if (shouldDelete(lead)) {
      rejectedPreCutoff++;
      continue;
    }
    const tier = sourceTier(lead.url);
    // Canonical venue is deterministic (lib/taxonomy); the LLM venue is a hint.
    const venue = classifyVenueType(`${lead.title ?? ''} ${lead.raw_content ?? ''}`, c.venue_type);
    inc(perVenueType, venue ?? 'Unclassified');
    inc(perSignalType, c.signal_type ?? 'Unclassified');
    inc(perTier, tier);
    inc(perCountry, countryOf(c.location));
    if (report.samples.length < 10) {
      report.samples.push({
        title: lead.title,
        published_date: lead.published_date ?? '',
        domain: hostOf(lead.url),
        venue_type: venue ?? '',
        signal_type: c.signal_type ?? '',
        location: c.location ?? '',
        contact: !!(c.contact_name || c.contact_email || c.contact_phone),
      });
    }

    if (noWrite) continue;

    // Best-available date + provenance for the intelligence stream (source
    // published_date, else parsed from text, else first_seen).
    const dates = deriveLeadDates(lead, 'intelligence');
    // Intelligence coverage has no submission deadline -> always a project_event.
    const om = objectFields(dates, lead.title, lead.raw_content);

    // Geography resolved once, at write time, into indexed columns. The GLI
    // classifier's location is the best string available for an article.
    const geo = geographyFields(c.location ?? lead.location, lead.country);

    pendingWrites.push(
      {
        ...geo,
        source: lead.source,
        url: lead.url,
        title: lead.title,
        raw_content: lead.raw_content,
        score: null,
        score_reason: `GLI lane: ${c.signal_type} (${venue}). ${c.reason}`,
        // status is Philip's; lifecycle is the scraper's. Intelligence coverage
        // is a project event and is always active.
        lifecycle: 'active',
        module: GLI_MODULE,
        industry: GLI_MODULE,
        stream: 'intelligence',
        company: c.project_name,
        location: c.location,
        deadline: dates.deadline,
        published_date: dates.published_date,
        date_source: dates.date_source,
        object_type: om.object_type,
        milestone_date: om.milestone_date,
        value_estimate: null,
        lead_type: 'gli',
        venue_type: venue,
        signal_type: c.signal_type,
        development_category: categoryForVenue(venue),
        source_tier: tier,
        primary_document_url: lead.primary_document_url ?? null,
        has_primary_document: lead.has_primary_document ?? false,
        contact_name: c.contact_name,
        contact_email: c.contact_email,
        contact_phone: c.contact_phone,
        // Which search produced this record. See migration 031.
        query_term: lead.query_term ?? null,
        query_scope: lead.query_scope ?? null,
      }
    );
  }
  if (pendingWrites.length > 0) {
    // MIGRATION 031 IS PHILIP'S TO RUN, so the lane must work either side of it.
    // Probed once, and the strip is reported rather than silent: a run that
    // quietly dropped the provenance would look exactly like a run that stored
    // it, which is the failure this whole column exists to end.
    if (!(await columnExists('query_term'))) {
      console.warn(
        'GLI: leads.query_term does not exist (migration 031 not run); ' +
          'writing without search provenance. Per-query yield stays unmeasurable until it is run.'
      );
      for (const row of pendingWrites) {
        delete row.query_term;
        delete row.query_scope;
      }
    }
    const wr = await guardedUpsert(pendingWrites, emptyWriteReport());
    report.written = wr.written;
    report.writeFailed = wr.failed;
    report.skippedDismissed = wr.skippedDismissed;
    report.protectedByOverride = wr.rowsWithProtectedFields;
    report.writtenUrls = wr.writtenUrls;
    printWriteReport('GLI writes', wr);
  }
  if (rejectedPreCutoff > 0) {
    console.log(`GLI: rejected ${rejectedPreCutoff} intelligence leads (dead pre-2026 opportunities only).`);
  }

  // Sweep any junk rows already stored from earlier runs (defense-in-depth so
  // the filter's intent, no junk in Supabase, actually holds). Skipped in the
  // no-write report mode.
  if (!noWrite) report.purgedJunk = await purgeStoredJunk();

  return report;
}

export function printGliReport(r: GliReport): void {
  const table = (m: Record<string, number>): string =>
    Object.keys(m).length
      ? Object.entries(m)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `    ${String(v).padStart(4)}  ${k}`)
          .join('\n')
      : '    (none)';

  // Inline "Label: N | Label: N" summary in a fixed order, present keys only.
  const inline = (order: readonly string[], m: Record<string, number>): string =>
    order.filter((k) => (m[k] ?? 0) > 0).map((k) => `${k}: ${m[k]}`).join(' | ') || '(none)';

  console.log('\n========== GLI LANE REPORT ==========');
  console.log(`Serper searches this run:     ${r.searches}  (ceiling ${MAX_SEARCHES_PER_RUN})`);
  console.log(`Fetched from Serper:          ${r.fetched}`);
  console.log(`After URL dedup:              ${r.urlDeduped}`);
  console.log(`Dropped as junk (low-quality):${r.droppedJunk}`);
  console.log(`Dropped as stale (>${RECENCY_WINDOW_DAYS}d):      ${r.droppedStale}`);
  console.log(`Kept but undated:             ${r.undatedKept}`);
  console.log(`Purged stored junk rows:      ${r.purgedJunk}`);
  console.log(`Kept after inclusion rule:    ${r.kept}`);
  console.log(`Dropped as noise:             ${r.droppedNoise}`);
  console.log(`Dropped as high-risk location:${r.droppedHighRisk}`);
  console.log(`Dropped outside ${CORPUS_COUNTRIES.join(', ')}:${r.droppedOutOfCountry}`);
  console.log(`Dropped as project duplicate: ${r.projectDuplicates}`);
  console.log(`Written to Supabase:          ${r.written}${r.writeFailed ? `  (write failures: ${r.writeFailed})` : ''}`);
  console.log(
    `Source-chaining: ${r.chainReferenced} referenced a primary source, ${r.chainResolved} resolved a primary_document_url, ${r.chainWithFile} fetched a real file.`
  );
  for (const s of r.chainSamples.slice(0, 5)) {
    console.log(`    - ${s.article}  ->  ${s.primaryUrl}${s.hasFile ? '  [file]' : ''}`);
  }
  console.log('Kept by source_tier:');
  console.log(table(r.perTier));
  console.log('Kept by venue_type:');
  console.log(table(r.perVenueType));
  console.log('Kept by signal_type:');
  console.log(table(r.perSignalType));
  console.log('Kept by country/region (global spread):');
  console.log(table(r.perCountry));
  console.log('Sample GLI leads (up to 10): title | published_date | domain | venue_type | signal_type | location');
  for (const s of r.samples) {
    console.log(
      `    - ${s.title.slice(0, 45)} | ${s.published_date || 'undated'} | ${s.domain || '(none)'} | ${s.venue_type} | ${s.signal_type} | ${s.location || '(none)'}`
    );
  }
  console.log('=====================================');

  // Run-summary breakdown (junk drops, tier split, signal/venue inline).
  console.log('\nGLI run complete.');
  console.log(`  Total fetched:     ${r.fetched}`);
  console.log(`  Dropped (junk):    ${r.droppedJunk}`);
  console.log(`  Kept:              ${r.kept}`);
  console.log(`    primary:         ${r.perTier['primary'] ?? 0}`);
  console.log(`    trade:           ${r.perTier['trade'] ?? 0}`);
  console.log(`    news:            ${r.perTier['news'] ?? 0}`);
  console.log(`  Per signal_type:   ${inline(SIGNAL_TYPES, r.perSignalType)}`);
  console.log(`  Per venue_type:    ${inline(VENUE_TYPES, r.perVenueType)}\n`);
}

// Standalone entrypoint: fetch the GLI queries via Serper and run the lane.
// Kept separate from the full orchestrator so a GLI run does not fan out to
// every other source. Guarded so importing this module never triggers a run.
async function main(): Promise<void> {
  const run = new RunTimer('intelligence');
  resetParseReports();
  // The intelligence lane has ONE source (Serper) and no per-market fetch: its
  // queries are watch terms, not jurisdictions. So --source is meaningful here
  // and --market is not, and saying so is better than silently ignoring a
  // market filter and returning a full run's worth of records.
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
  if (!scopeIncludesSource(scope, 'serper')) {
    console.log('Intelligence lane skipped: source scope excludes serper.');
    return;
  }
  if (scope.markets) {
    console.log(
      '  note: --market does not narrow this lane (its queries are watch terms, not jurisdictions).'
    );
  }
  const queries = gliQueries();
  if (queries.length === 0) {
    console.error('GLI lane: no queries configured (gli profile inactive or missing).');
    return;
  }
  // A CLIENT'S WATCH TERMS ARE CAPTURE INSTRUCTIONS, so they are loaded BEFORE
  // the queries are issued. Primed rather than fetched inside the query builder:
  // see client-watch-terms.ts. A failure here is reported and the run continues
  // on the target terms alone - a Supabase hiccup must not stop a scrape.
  const priming = await primeClientWatchTerms();
  if (priming.error) {
    console.error(`  client watch terms unavailable (${priming.error}); running on target terms alone.`);
  } else {
    console.log(
      `  client watch terms: ${priming.terms.length} from ${priming.scopes} scope(s)` +
        (priming.terms.length ? ` -> ${priming.terms.join(', ')}` : '')
    );
  }
  const raw = await scrapeSerper(queries);
  // The intelligence lane had NO zero-write alarm either. Serper returning
  // nothing - a bad key, a quota, a changed response shape - looked exactly like
  // a quiet week.
  recordSourceRun({ lane: 'intelligence', unit: 'adapter:serper', fetched: raw.length, kept: raw.length });
  const report = await runGliLane(raw);
  report.searches = lastSerperSearchCount();
  printGliReport(report);
  if (process.env.GLI_NO_WRITE !== '1') {
    await reportRunHealth('intelligence', { fetched: report.fetched, written: report.written });
    // ATTACH, AS government.ts AND opportunity.ts ALREADY DO. This lane was the
    // only one of the three whose standalone entrypoint wrote records and left
    // every one of them orphaned, silently: a run reported "167 written" while
    // none of them reached a project, and nothing downstream noticed.
    printAttachReport('GLI', await attachOnWrite(report.writtenUrls));
  } else {
    resetSourceRuns();
  }
  printParseReports('Boundary schemas');

  const schemas = allParseReports();
  run.finish({
    fetched: report.fetched,
    matched: report.kept,
    written: report.written,
    skipped: report.droppedJunk + report.droppedStale + report.droppedNoise + report.skippedDismissed,
    failed: report.writeFailed,
    detail: {
      searches: report.searches,
      droppedJunk: report.droppedJunk,
      droppedStale: report.droppedStale,
      droppedNoise: report.droppedNoise,
      droppedHighRisk: report.droppedHighRisk,
      droppedOutOfCountry: report.droppedOutOfCountry,
      projectDuplicates: report.projectDuplicates,
      tombstoneSkips: report.skippedDismissed,
      overridesProtected: report.protectedByOverride,
      schemaParsed: schemas.reduce((a, r) => a + r.parsed, 0),
      schemaRejected: schemas.reduce((a, r) => a + r.rejected, 0),
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('GLI lane failed:', err);
    process.exitCode = 1;
  });
}
