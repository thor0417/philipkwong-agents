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
import { supabaseAdmin } from '../../lib/supabase-admin';
import type { NormalizedLead } from './sources/types';
import { scrapeSerper, lastSerperSearchCount, RECENCY_WINDOW_DAYS } from './sources/serper';
import { gliQueries } from './profiles';
import { normalizeCompany } from './cross-reference';
import { keywordMatches } from './prefilter';
import { opportunityVenueHint, opportunitySignalHint } from './classify';
import { developmentCategory } from './development-category';

const MODEL = 'claude-haiku-4-5-20251001';
const GLI_MODULE = 'gli';

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
// Hard-excluded domains. Leads from these domains are dropped before scoring.
// Edit this list to add/remove junk sources.
const JUNK_DOMAINS = [
  'facebook.com',
  'youtube.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'tiktok.com',
  'reddit.com',
  // TV news and local news affiliates
  'abcnews.go.com',
  'nbcnews.com',
  'cbsnews.com',
  'foxnews.com',
  'cnn.com',
  'msnbc.com',
  'usatoday.com',
  // Add local TV affiliates as encountered
];

// Bare hostname of a url (leading www. stripped, lowercased), or '' when the url
// is missing or unparseable. Protocol-less and protocol-relative links (e.g.
// "facebook.com/x" or "//facebook.com/x") are retried with an https:// prefix so
// no url form escapes the junk filter.
function hostOf(url: string | null): string {
  if (!url) return '';
  const parse = (u: string): string | null => {
    try {
      return new URL(u).hostname;
    } catch {
      return null;
    }
  };
  const host = parse(url) ?? parse(`https://${url.replace(/^\/\//, '')}`);
  return host ? host.replace(/^www\./, '').toLowerCase() : '';
}

// True when the host is (or is a subdomain of) a hard-excluded junk domain.
function isJunkDomain(host: string): boolean {
  if (!host) return false;
  return JUNK_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

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
  signal_type: string;
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
  projectDuplicates: number;
  written: number;
  writeFailed: number;
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

// Self-healing cleanup: delete any already-stored GLI leads whose source domain
// is now hard-excluded junk. The write-time filter gates new leads, but rows
// written before the filter existed (or before a domain was added to
// JUNK_DOMAINS) would otherwise linger in Supabase forever. Returns the count
// deleted.
async function purgeStoredJunk(): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('leads')
    .select('id, url')
    .eq('module', GLI_MODULE);
  if (error || !data) {
    if (error) console.error(`GLI junk purge: query failed: ${error.message}`);
    return 0;
  }
  const junkIds = data
    .filter((r) => isJunkDomain(hostOf(r.url as string | null)))
    .map((r) => r.id);
  if (junkIds.length === 0) return 0;
  const { error: delErr } = await supabaseAdmin.from('leads').delete().in('id', junkIds);
  if (delErr) {
    console.error(`GLI junk purge: delete failed: ${delErr.message}`);
    return 0;
  }
  console.log(`GLI: purged ${junkIds.length} stored junk-domain leads.`);
  return junkIds.length;
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
  const cutoff = Date.now() - RECENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
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
    projectDuplicates,
    written: 0,
    writeFailed: 0,
    perVenueType,
    perSignalType,
    perTier,
    perCountry,
    samples: [],
  };

  const noWrite = process.env.GLI_NO_WRITE === '1';

  for (const { lead, c } of kept) {
    const tier = sourceTier(lead.url);
    inc(perVenueType, c.venue_type ?? 'Unclassified');
    inc(perSignalType, c.signal_type ?? 'Unclassified');
    inc(perTier, tier);
    inc(perCountry, countryOf(c.location));
    if (report.samples.length < 10) {
      report.samples.push({
        title: lead.title,
        published_date: lead.published_date ?? '',
        domain: hostOf(lead.url),
        venue_type: c.venue_type ?? '',
        signal_type: c.signal_type ?? '',
        location: c.location ?? '',
        contact: !!(c.contact_name || c.contact_email || c.contact_phone),
      });
    }

    if (noWrite) continue;

    const { error } = await supabaseAdmin.from('leads').upsert(
      {
        source: lead.source,
        url: lead.url,
        title: lead.title,
        raw_content: lead.raw_content,
        score: null,
        score_reason: `GLI lane: ${c.signal_type} (${c.venue_type}). ${c.reason}`,
        status: 'new',
        module: GLI_MODULE,
        industry: GLI_MODULE,
        stream: 'intelligence',
        company: c.project_name,
        location: c.location,
        deadline: null,
        published_date: lead.published_date ?? null,
        value_estimate: null,
        lead_type: 'gli',
        venue_type: c.venue_type,
        signal_type: c.signal_type,
        development_category: developmentCategory(lead.title, lead.raw_content, c.venue_type),
        source_tier: tier,
        contact_name: c.contact_name,
        contact_email: c.contact_email,
        contact_phone: c.contact_phone,
      },
      { onConflict: 'url' }
    );
    if (error) {
      console.error(`GLI write failed for ${lead.url}: ${error.message}`);
      report.writeFailed++;
      continue;
    }
    report.written++;
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
  console.log(`Serper searches this run:     ${r.searches}  (ceiling 120)`);
  console.log(`Fetched from Serper:          ${r.fetched}`);
  console.log(`After URL dedup:              ${r.urlDeduped}`);
  console.log(`Dropped as junk (low-quality):${r.droppedJunk}`);
  console.log(`Dropped as stale (>${RECENCY_WINDOW_DAYS}d):      ${r.droppedStale}`);
  console.log(`Kept but undated:             ${r.undatedKept}`);
  console.log(`Purged stored junk rows:      ${r.purgedJunk}`);
  console.log(`Kept after inclusion rule:    ${r.kept}`);
  console.log(`Dropped as noise:             ${r.droppedNoise}`);
  console.log(`Dropped as high-risk location:${r.droppedHighRisk}`);
  console.log(`Dropped as project duplicate: ${r.projectDuplicates}`);
  console.log(`Written to Supabase:          ${r.written}${r.writeFailed ? `  (write failures: ${r.writeFailed})` : ''}`);
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
  console.log('GLI lane starting...');
  const queries = gliQueries();
  if (queries.length === 0) {
    console.error('GLI lane: no queries configured (gli profile inactive or missing).');
    return;
  }
  const raw = await scrapeSerper(queries);
  const report = await runGliLane(raw);
  report.searches = lastSerperSearchCount();
  printGliReport(report);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('GLI lane failed:', err);
    process.exitCode = 1;
  });
}
