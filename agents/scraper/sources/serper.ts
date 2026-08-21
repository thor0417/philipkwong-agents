// Serper search source (GLI Tier 3 intelligence lane).
//
// THREE PASSES: CURATED TRADE PRESS, WATCH TERMS, AND MARKETS.
//
// The market pass is the newest and the one the lane was missing entirely: 22
// sector queries named no place at all, so only 12% of 490 records touched any
// market the government lane covers, and two of the twelve had never been
// mentioned once. See MARKET PASS below.
//
// CURATED TRADE PRESS, PLUS AN EXPLICIT WATCH-TERM PASS. The sector queries run
// curated-domain-only (below); the named targets in targets.ts run unrestricted
// and are exempt from the curated check (see WATCH-TERM PASS). This replaces the
// whole-web, multi-region Serper
// pass. The GLI queries now run only against a curated domain list using batched
// `site:` operators (one query per term per batch of domains, joined with OR),
// and every query is date-restricted to a recency window (Serper tbs date range).
// The result is a small, current market-intelligence feed from the trade press
// and giga-project authorities, not whole-web news noise (Facebook / YouTube /
// TV news / stale articles are structurally excluded because they are not in the
// curated list). This lane is intelligence, not leads.
//
// Budget: searches = terms x batches, where batches = ceil(domains / batchSize).
// batchSize is grown at plan time until the product is under MAX_SEARCHES_PER_RUN.
// The count is logged and enforced.
//
// Adapter does NO relevance filtering (per the source contract): it normalizes
// the organic results (capturing each result's date into published_date where
// Serper exposes it) and hands them back with source 'gli_serper'. The GLI lane
// (gli.ts) applies the recency gate, inclusion gate, venue/signal tagging, and
// project dedup.
//
// Graceful degrade: if the key is missing, or any query returns a non-200, it
// logs and continues (never throws), returning whatever it gathered.

import type { NormalizedLead } from './types';
import { TARGETS, bypassHits } from '../targets';
import { clientWatchTerms } from '../client-watch-terms';
import { JUNK_DOMAINS } from '../junk-domains';
import { SerperOrganicSchema, parseRecords } from './schemas';
import { subDays, format } from 'date-fns';
import { COVERED_MARKETS as DECLARED_MARKETS } from '../../../lib/coverage';

const API_KEY = process.env.SERPER_API_KEY;

const ENDPOINT = 'https://google.serper.dev/search';

// Hard ceiling on searches issued per run. The batch size is grown until the
// planned search count sits under this; it also backstops the run loop.
export const MAX_SEARCHES_PER_RUN = 160;

// Recency window (days). Every query is date-restricted to this window via Serper
// tbs, and every result is gated on its published date downstream (gli.ts).
// Exported so the lane's date gate uses the same window. Tunable.
export const RECENCY_WINDOW_DAYS = Number(process.env.RECENCY_WINDOW_DAYS ?? '90');

// Target domains per batched site: query. Grown at plan time (planBatchSize) to
// keep the total search count under the ceiling; never shrunk below this.
const DOMAINS_PER_QUERY = Number(process.env.SERPER_DOMAINS_PER_QUERY ?? '8');

// Curated trade-press / authority domains for the intelligence lane. EDITABLE.
// Groups: leisure/attractions trade, hospitality trade, gaming trade, Middle East
// business / construction / tourism press, Gulf giga-project authorities,
// Asia-Pacific travel trade, and hotel-investment data houses.
const CURATED_DOMAINS = [
  // Leisure / attractions trade press
  'blooloop.com',
  'attractionsmanagement.com',
  'parkworld-online.com',
  'inparkmagazine.com',
  'iaapa.org',
  'themeparx.com',
  'amusementtoday.com',
  // Hospitality trade press
  'hospitalitynet.org',
  'hotelnewsresource.com',
  'hotelmanagement.net',
  'tophotelnews.com',
  // Gaming trade press
  'ggbmagazine.com',
  'asgam.com',
  'casinobeats.com',
  // Middle East business / construction / tourism press
  'arabianbusiness.com',
  'zawya.com',
  'meed.com',
  'constructionweekonline.com',
  'hoteliermiddleeast.com',
  'gulfbusiness.com',
  'meconstructionnews.com',
  // Gulf giga-project / tourism authorities
  'neom.com',
  'qiddiya.com',
  'diriyah.sa',
  'redseaglobal.com',
  'visitsaudi.com',
  'dctabudhabi.ae',
  'visitqatar.com',
  // Asia-Pacific travel trade
  'ttrweekly.com',
  'traveldailynews.asia',
  'ttgasia.com',
  // Hotel-investment data houses
  'hvs.com',
  'str.com',
  'skift.com',
  'hospitalityinvestor.com',
  // Development / urban / real-estate intelligence. These carry the primary-signal
  // stories that source-chain to government documents (the class of source that,
  // like blooloop for the CFTOD plan, surfaces a plan/filing behind an article).
  // blooloop stays first in the list (top primary-signal source, retained).
  'bisnow.com',
  'urbanland.uli.org',
  'therealdeal.com',
  'commercialobserver.com',
  'planetizen.com',
  'smartcitiesdive.com',
  'theurbandeveloper.com',
  'constructiondive.com',
];

// ---- WATCH-TERM PASS (the curated-allowlist escape hatch) -------------------
// The curated list is what makes this lane intelligence rather than news, and it
// is also what made it blind: a named target announced anywhere other than the
// ~50 curated domains could not be returned by any query the lane issued. The
// Top Gun relocation is the proof case - it ran in four outlets on 2026-07-21
// (casino.org, reviewjournal.com, deadline.com, 8newsnow.com), none of them
// curated, and probing all 22 sector terms against those four domains returned
// 147 results and zero Top Gun, so curating them would not have helped either.
//
// So the bypass terms in targets.ts (the projects and parties we are explicitly
// watching) are issued as their OWN queries with no site: restriction, and their
// results are exempt from the curated-domain check. Nothing else changes: the
// sector queries stay curated-only, and watch results still face every
// downstream gate (junk domains, recency, the LLM inclusion rule).
//
// The terms are quoted and OR-grouped so the whole watch list costs a handful of
// searches rather than one per term.
const WATCH_GROUP_SIZE = Number(process.env.SERPER_WATCH_GROUP ?? '5');
// Set SERPER_WATCH=0 to run the curated pass alone.
const WATCH_ENABLED = process.env.SERPER_WATCH !== '0';

// TWO SOURCES, ONE LIST. The targets are ours: the projects and parties this
// desk watches by standing decision. The client terms are theirs, primed from
// client_scopes at the start of a run (see client-watch-terms.ts). A run that
// never primes gets exactly the first list, which is what every run did before
// clients existed.
//
// Deduplicated case-insensitively across BOTH, so a client naming a project we
// already watch costs no extra searches rather than issuing the same query
// twice under a different capitalisation.
export function watchTerms(): string[] {
  const seen = new Map<string, string>();
  for (const t of [...TARGETS.flatMap((t) => t.bypass), ...clientWatchTerms()]) {
    const k = t.trim().toLowerCase();
    if (k && !seen.has(k)) seen.set(k, t.trim());
  }
  return [...seen.values()];
}

// Junk hosts are excluded IN THE QUERY on this pass. Google returns ten organic
// slots; on an unrestricted watch query the social and reference sites take most
// of them ("top gun" is a film before it is a Las Vegas parcel), pushing the real
// coverage off the page. These results would be dropped downstream anyway, so
// not asking for them costs nothing and buys back the slots. Measured: without
// this, 6 of the first 10 results for the Top Gun watch group were Facebook,
// YouTube, Letterboxd, and a film-anniversary site.
const WATCH_EXCLUSIONS = JUNK_DOMAINS.map((d) => `-site:${d}`).join(' ');

// The watch list as OR-grouped, phrase-quoted queries.
export function watchQueries(): string[] {
  const terms = watchTerms();
  const out: string[] = [];
  for (let i = 0; i < terms.length; i += Math.max(1, WATCH_GROUP_SIZE)) {
    const group = terms.slice(i, i + Math.max(1, WATCH_GROUP_SIZE)).map((t) => `"${t}"`).join(' OR ');
    out.push(`${group} ${WATCH_EXCLUSIONS}`);
  }
  return out;
}

// ---- MARKET PASS -----------------------------------------------------------
//
// THE LANE KNEW EVERY SECTOR NOUN AND NOT ONE PLACE. Its 22 sector queries are
// "theme park development", "casino development", "tourism master plan" and so
// on, with no city, state or country in any of them, so geography arrived only
// as a side effect of which curated outlet Google happened to rank. Measured
// over 490 records: 59 of them (12%) mention any of the twelve markets the
// government lane covers, and Oakland and Yonkers/Westchester have never been
// mentioned once.
//
// So each covered market gets ONE unrestricted query pairing the place with the
// leisure and development nouns. Unrestricted, like the watch pass and for the
// same reason: local development news is not published on Gulf construction
// trade sites, and gating it on the curated list is what made the lane blind in
// the first place.
//
// Twelve searches. The whole fix costs about two cents a run.
const MARKET_NOUNS = [
  'casino',
  '"theme park"',
  'resort',
  'arena',
  'stadium',
  '"entertainment district"',
  '"mixed-use development"',
  'waterpark',
  'museum',
  '"visitor attraction"',
];

// THE MARKETS THE GOVERNMENT LANE COVERS, DERIVED RATHER THAN TYPED.
//
// THIS WAS A SECOND HAND-MAINTAINED LIST AND IT HAD ALREADY DRIFTED. It named
// twelve markets while lib/coverage named thirteen, and two of its entries -
// 'Orlando Florida' and 'Miami Florida' - are not markets this system has ever
// covered. So the press lane spent part of its search budget every run looking
// for stories in two places no adapter is pointed at, and stopped looking the
// day a market was added to the real table without being added here.
//
// Two lists that must agree and are maintained separately do not agree; they
// agree until someone forgets. lib/coverage.COVERED_MARKETS is the declaration,
// this is a projection of it, and adding a market there now adds its search here
// with no second edit.
//
// THE PRESS DOES NOT USE OUR JURISDICTION LABELS, which is the one real thing
// the old list carried and the reason this is not a bare map(). "Central Florida
// Tourism Oversight District" is what the district calls itself and nothing a
// journalist writes; "Clark County" alone collides with Clark County in six
// other states. So a market may declare the string the press would use, and the
// override is EXPLICIT and per market rather than a transformation rule - a
// clever rule would silently mis-render the next market added.
//
// A market with no override searches under its own name plus its state, which is
// what the press calls most places.
const PRESS_NAME: Record<string, string> = {
  // The district's legal name appears in filings and nowhere in a newspaper.
  // Orlando is the city the press names for this geography, and it is the one
  // entry the old list got right for a reason rather than by accident.
  'Central Florida Tourism Oversight District': 'Orlando Florida',
  // A resort destination the press names without its state.
  'Las Vegas': 'Las Vegas',
  'New York City': 'New York City',
  // Lake Buena Vista is inside the Orlando press geography above. Searching it
  // separately returns the same stories under a name only Disney uses.
  'Lake Buena Vista': 'Orlando Florida',
};

function pressName(m: { market: string; regionState: string }): string {
  return PRESS_NAME[m.market] ?? `${m.market} ${m.regionState}`;
}

// Deduplicated, because two markets can legitimately share one press geography:
// CFTOD and Lake Buena Vista are both Orlando to a journalist, and searching the
// same phrase twice spends the budget twice for one set of results.
export const COVERED_MARKETS: string[] = [
  ...new Set(DECLARED_MARKETS.map(pressName)),
];

const MARKET_ENABLED = process.env.SERPER_MARKET_PASS !== '0';

export function marketQueries(): string[] {
  if (!MARKET_ENABLED) return [];
  const nouns = MARKET_NOUNS.join(' OR ');
  return COVERED_MARKETS.map((m) => `"${m}" (${nouns}) ${WATCH_EXCLUSIONS}`);
}

export interface WatchStats {
  searches: number;
  results: number;
  // Results kept that are NOT on a curated domain: exactly what the old lane
  // could never return.
  offCurated: number;
  hostsOffCurated: Record<string, number>;
}
let lastWatch: WatchStats = { searches: 0, results: 0, offCurated: 0, hostsOffCurated: {} };

export interface MarketStats {
  searches: number;
  results: number;
}
let lastMarket: MarketStats = { searches: 0, results: 0 };
export function lastMarketStats(): MarketStats {
  return lastMarket;
}
export function lastWatchStats(): WatchStats {
  return lastWatch;
}

// Number of Serper searches issued by the most recent scrapeSerper call, for the
// run report. Reset at the start of each call.
let lastSearchCount = 0;
export function lastSerperSearchCount(): number {
  return lastSearchCount;
}

interface SerperOrganic {
  title?: string;
  link?: string;
  snippet?: string;
  // Serper exposes a human-readable date on some organic results ("3 days ago",
  // "Dec 12, 2025", ...). Absent on many; those leads are treated as undated.
  date?: string;
}

interface SerperResponse {
  organic?: SerperOrganic[];
  message?: string;
}

// The smallest batch size (>= DOMAINS_PER_QUERY) that keeps terms x batches under
// the ceiling. Grows the batch (fewer, wider queries) if the term list is large.
function planBatchSize(termCount: number, domainCount: number): number {
  let size = Math.max(1, DOMAINS_PER_QUERY);
  let batches = Math.ceil(domainCount / size);
  while (termCount * batches >= MAX_SEARCHES_PER_RUN && size < domainCount) {
    size++;
    batches = Math.ceil(domainCount / size);
  }
  return size;
}

// Split the curated domains into batches of `size`.
function batchDomains(size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < CURATED_DOMAINS.length; i += size) {
    out.push(CURATED_DOMAINS.slice(i, i + size));
  }
  return out;
}

// Serper tbs custom date range for the recency window: cd_min = now - window,
// cd_max = now (US M/D/YYYY, as Google expects). Coarse pre-filter; the exact
// day-level gate is applied on published_date downstream.
function tbsRecency(days: number): string {
  const now = new Date();
  const from = subDays(now, days);
  // Google reads this range in the SEARCHER's locale, so local-time formatting
  // is correct here and date-fns format is used as-is. M/d/yyyy, unpadded, is
  // what Google's tbs parameter expects.
  const fmt = (d: Date): string => format(d, 'M/d/yyyy');
  return `cdr:1,cd_min:${fmt(from)},cd_max:${fmt(now)}`;
}

// Parse a Serper date string into an ISO timestamp, or null when absent /
// unparseable. Handles both relative ("3 days ago") and absolute ("Dec 12, 2025")
// forms.
const REL_MS: Record<string, number> = {
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
};
function parseSerperDate(raw?: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const rel = s.match(/^(\d+)\s+(hour|day|week|month|year)s?\s+ago$/i);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const ms = REL_MS[rel[2].toLowerCase()];
    if (ms) return new Date(Date.now() - n * ms).toISOString();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// True when a result URL is on a curated domain (or a subdomain of one). Enforced
// after fetch so a stray non-site: result Google may return on an OR-site query
// never enters the intelligence set (guarantees the curated-only invariant; this
// is a source-scope constraint, not relevance filtering).
function isCuratedUrl(link: string): boolean {
  let host: string;
  try {
    host = new URL(link).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return false;
  }
  return CURATED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

// The snippet is the raw_content per the source contract; the display domain is
// appended as a short provenance line so the GLI classifier can weigh the source.
function buildContent(item: SerperOrganic): string {
  const parts = [item.snippet ?? ''];
  if (item.link) {
    try {
      parts.push(`Source: ${new URL(item.link).hostname}`);
    } catch {
      /* non-URL link: skip provenance line */
    }
  }
  return parts.filter(Boolean).join('\n');
}

// One Serper call (date-restricted). Returns organic results, or [] on any
// failure (logged).
async function runQuery(q: string, tbs: string): Promise<SerperOrganic[]> {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'X-API-KEY': API_KEY as string, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, tbs }),
    });
    if (!res.ok) {
      let detail = '';
      try {
        const errBody = (await res.json()) as SerperResponse;
        detail = errBody.message ? ` - ${errBody.message}` : '';
      } catch {
        /* ignore body parse errors */
      }
      console.error(`Serper "${q.slice(0, 60)}" failed: HTTP ${res.status}${detail}`);
      return [];
    }
    const data = (await res.json()) as SerperResponse;
    // A result with no title or no link is not a lead; validated here so a
    // change in Serper's response shape is counted rather than silently empty.
    return parseRecords(SerperOrganicSchema, data.organic ?? [], {
      source: 'serper',
      endpoint: 'search',
      quiet: true,
    }).records as SerperOrganic[];
  } catch (error) {
    console.error(`Serper "${q.slice(0, 60)}" error:`, error);
    return [];
  }
}

export async function scrapeSerper(queries: string[]): Promise<NormalizedLead[]> {
  lastSearchCount = 0;
  if (!API_KEY) {
    console.warn('Serper: SERPER_API_KEY not set, skipping source.');
    return [];
  }
  // The watch-term pass stands on its own: it is driven by targets.ts, not by
  // the profile's sector terms, so an empty sector list still runs the watch.
  if (queries.length === 0 && !WATCH_ENABLED) {
    console.warn('Serper: no queries configured and the watch pass is off, skipping source.');
    return [];
  }
  if (queries.length === 0) {
    console.warn('Serper: no sector queries configured; running the watch-term pass only.');
  }

  const batchSize = planBatchSize(queries.length, CURATED_DOMAINS.length);
  const batches = batchDomains(batchSize);
  const tbs = tbsRecency(RECENCY_WINDOW_DAYS);

  // Plan: every term against every curated-domain batch (site:a OR site:b ...).
  // The term and the batch are carried alongside the issued string, because a
  // site:-batched query puts ten domains in competition inside one search and a
  // term's yield is not separable from the batch it ran in.
  const plan: { q: string; term: string; scope: string }[] = [];
  for (const term of queries) {
    batches.forEach((batch, i) => {
      const sites = batch.map((d) => `site:${d}`).join(' OR ');
      plan.push({
        q: `${term} (${sites})`,
        term,
        scope: `sector:batch ${i + 1}/${batches.length}`,
      });
    });
  }

  const byUrl = new Map<string, NormalizedLead>();
  let searches = 0;

  // WATCH-TERM PASS FIRST. It is the cheapest and the highest-signal pass, and
  // running it before the curated plan means it is never the pass that gets cut
  // when the search ceiling bites.
  lastWatch = { searches: 0, results: 0, offCurated: 0, hostsOffCurated: {} };
  if (WATCH_ENABLED) {
    for (const wq of watchQueries()) {
      if (searches >= MAX_SEARCHES_PER_RUN) break;
      searches++;
      lastWatch.searches++;
      const items = await runQuery(wq, tbs);
      for (const item of items) {
        if (!item.title || !item.link) continue;
        if (byUrl.has(item.link)) continue;
        // A watch result must actually contain a watch term (Google will return
        // near matches on an OR query); the term is recorded as provenance.
        const hits = bypassHits(`${item.title}\n${item.snippet ?? ''}\n${item.link}`);
        if (hits.length === 0) continue;
        const terms = [...new Set(hits.map((h) => h.term))];
        lastWatch.results++;
        if (!isCuratedUrl(item.link)) {
          lastWatch.offCurated++;
          const host = (() => {
            try {
              return new URL(item.link as string).hostname.replace(/^www\./, '');
            } catch {
              return '(unparseable)';
            }
          })();
          lastWatch.hostsOffCurated[host] = (lastWatch.hostsOffCurated[host] ?? 0) + 1;
        }
        byUrl.set(item.link, {
          title: item.title,
          url: item.link,
          // The matched watch terms are provenance: this lead is here because a
          // named target was hit, not because the domain is curated.
          raw_content: `${buildContent(item)}\nWatch-term match: ${terms.join(', ')}`,
          company: null,
          location: null,
          deadline: null,
          published_date: parseSerperDate(item.date),
          value_estimate: null,
          source: 'gli_serper',
          query_term: wq,
          query_scope: `watch:group ${lastWatch.searches}/${watchQueries().length}`,
        });
      }
    }
    console.log(
      `Serper watch-term pass: ${lastWatch.searches} searches over ${watchTerms().length} watch terms -> ` +
        `${lastWatch.results} results, ${lastWatch.offCurated} of them off the curated list ` +
        `(${JSON.stringify(lastWatch.hostsOffCurated)}).`
    );
  }

  // MARKET PASS, second. After the watch terms because a named target is a
  // stronger signal than a place, and before the curated sector plan because
  // the sector plan is the pass that gets cut when the ceiling bites.
  lastMarket = { searches: 0, results: 0 };
  for (const mq of marketQueries()) {
    if (searches >= MAX_SEARCHES_PER_RUN) break;
    searches++;
    lastMarket.searches++;
    const items = await runQuery(mq, tbs);
    for (const item of items) {
      if (!item.title || !item.link) continue;
      if (byUrl.has(item.link)) continue;
      lastMarket.results++;
      byUrl.set(item.link, {
        title: item.title,
        url: item.link,
        raw_content: buildContent(item),
        company: null,
        location: null,
        deadline: null,
        published_date: parseSerperDate(item.date),
        value_estimate: null,
        source: 'gli_serper',
        query_term: mq,
        query_scope: `market:${COVERED_MARKETS[lastMarket.searches - 1]}`,
      });
    }
  }
  if (lastMarket.searches > 0) {
    console.log(
      `Serper market pass: ${lastMarket.searches} unrestricted searches over ${COVERED_MARKETS.length} ` +
        `covered markets -> ${lastMarket.results} results.`
    );
  }

  for (const q of plan) {
    if (searches >= MAX_SEARCHES_PER_RUN) {
      console.warn(
        `Serper: reached the hard ceiling of ${MAX_SEARCHES_PER_RUN} searches; ` +
          `stopping (planned ${plan.length}).`
      );
      break;
    }
    searches++;
    const items = await runQuery(q.q, tbs);
    for (const item of items) {
      if (!item.title || !item.link) continue;
      if (!isCuratedUrl(item.link)) continue;
      if (byUrl.has(item.link)) continue;
      byUrl.set(item.link, {
        title: item.title,
        url: item.link,
        raw_content: buildContent(item),
        company: null,
        location: null,
        deadline: null,
        published_date: parseSerperDate(item.date),
        value_estimate: null,
        source: 'gli_serper',
        query_term: q.term,
        query_scope: q.scope,
      });
    }
  }

  lastSearchCount = searches;
  const leads = [...byUrl.values()];
  console.log(
    `Serper (curated intelligence): ${searches} searches ` +
      `(${lastWatch.searches} watch-term + ${searches - lastWatch.searches} curated: ` +
      `${queries.length} terms x ${batches.length} domain batches of ${batchSize}, ` +
      `${CURATED_DOMAINS.length} curated domains, last ${RECENCY_WINDOW_DAYS}d); ` +
      `${leads.length} unique results.`
  );
  return leads;
}
