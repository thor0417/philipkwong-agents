// African Development Bank (AfDB) procurement source — best-effort.
//
// FRAGILE / WAF-GATED. AfDB (www.afdb.org) sits behind a bot-mitigation WAF: its
// RSS index, Drupal JSON:API, and the Request-for-Expression-of-Interest listing
// all return HTTP 403 to non-browser clients (verified from this environment,
// even with a browser User-Agent), so there is no clean feed reachable here.
// Reliable extraction needs a headless browser (Playwright) or an allowlisted
// network, same class as MERX / Thailand e-GP.
//
// This adapter attempts the EOI listing with a browser-like request and, if it
// gets server-rendered HTML, parses the consulting notice rows; on a 403 / block
// / non-HTML response it logs and returns [] WITHOUT throwing, so it never
// crashes the run. Point AFDB_URL at a reachable listing to enable it.

import type { NormalizedLead } from './types';

const LISTING_URL =
  process.env.AFDB_URL ??
  'https://www.afdb.org/en/documents/project-related-procurement/procurement-notices/request-for-expression-of-interest';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export async function scrapeAfdb(): Promise<NormalizedLead[]> {
  let html: string;
  try {
    const res = await fetch(LISTING_URL, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      console.warn(
        `AfDB: listing returned HTTP ${res.status} (WAF-gated; needs a headless browser or an allowed network). Skipping (0 leads).`
      );
      return [];
    }
    html = await res.text();
  } catch (error) {
    console.warn(`AfDB: fetch failed (${String(error).slice(0, 80)}); skipping (0 leads).`);
    return [];
  }

  // Best-effort: EOI rows on the Drupal listing link to a document/notice page
  // under /en/documents/... . If the reachable markup is JS-rendered this matches
  // nothing and we degrade to 0.
  //
  // DATE: when the listing is reachable, each row carries a publication date in a
  // sibling `<span class="date-display-single" ... content="2026-07-16T00:00:00+00:00">`
  // block (the `content` attr is ISO). It is NOT inside the <a> matched below, so
  // capturing it into published_date requires reworking this row parser to iterate
  // per-row blocks -- deferred (the adapter is WAF-gated and yields ~0 here). No
  // submission deadline is exposed on the listing (it lives on each detail page).
  const byUrl = new Map<string, NormalizedLead>();
  const re = /<a[^>]+href="(\/en\/documents\/[^"]*(?:interest|procurement|notice)[^"]*)"[^>]*>\s*([^<]{12,200})</gi;
  for (const m of html.matchAll(re)) {
    const href = m[1].startsWith('http') ? m[1] : `https://www.afdb.org${m[1]}`;
    const title = m[2].replace(/\s+/g, ' ').trim();
    if (!title || byUrl.has(href)) continue;
    byUrl.set(href, {
      title,
      url: href,
      raw_content: [
        'AfDB Request for Expression of Interest: an advisory / consulting services procurement notice.',
        `Notice: ${title}`,
      ].join('\n'),
      company: null,
      location: null,
      deadline: null,
      value_estimate: null,
      source: 'afdb',
    });
  }

  const leads = [...byUrl.values()];
  if (leads.length === 0) {
    console.warn('AfDB: no parseable EOI rows in the response (WAF-gated or JS-rendered). Skipping (0 leads).');
  } else {
    console.log(`AfDB: ${leads.length} expression-of-interest notices`);
  }
  return leads;
}
