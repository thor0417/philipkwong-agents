// Singapore GeBIZ source (gebiz.gov.sg business opportunity listing).
//
// CODE SYSTEM: Singapore uses UNSPSC + English keywords. NEVER send CPV codes
// here (CPV is European, Rotterdam-only). This adapter accepts codes.unspsc and
// keywords; it never accepts CPV.
//
// FRAGILE / best-effort. GeBIZ is a JSF app: pagination and detail pages happen
// via postback (no GET detail URL), so only the first page of most-recent
// opportunities is reachable statically, and that page is not UNSPSC-queryable
// over GET. So UNSPSC is the declared/retained code system (used by UNGM and the
// GeBIZ advanced-search path) while relevance over the scraped listing is
// applied via English keywords: when `keywords` are passed the cards are
// filtered to keyword matches, otherwise the full first page is returned for the
// orchestrator's per-profile prefilter. On any parse failure: log + [].

import type { NormalizedLead } from './types';
import { toIso } from './types';

export interface GeBizOptions {
  // UNSPSC codes for Singapore (declared/retained; the open listing is not
  // code-queryable over GET). Never CPV.
  unspsc?: string[];
  // English keywords; when present, parsed cards are filtered to matches.
  keywords?: string[];
}

const LISTING_URL =
  process.env.GEBIZ_URL ?? 'https://www.gebiz.gov.sg/ptn/opportunity/BOListing.xhtml?origin=menu';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const decode = (s: string): string => s.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim();

// GeBIZ references trail the title, e.g. "Tender Lite - DEFNGPP7126100480".
function reference(title: string): string | null {
  const m = title.match(/([A-Z]{2,}[A-Z0-9]{5,})\s*$/);
  return m ? m[1] : null;
}

export async function scrapeGeBiz(opts: GeBizOptions = {}): Promise<NormalizedLead[]> {
  if (opts.unspsc?.length) {
    console.log(`GeBIZ: code system UNSPSC (${opts.unspsc.length} codes); CPV is never used here.`);
  }
  const kw = (opts.keywords ?? []).map((k) => k.toLowerCase()).filter(Boolean);

  let html: string;
  try {
    const res = await fetch(LISTING_URL, { headers: { 'User-Agent': UA } });
    if (!res.ok) {
      console.warn(`GeBIZ: listing returned HTTP ${res.status}; skipping (0 leads).`);
      return [];
    }
    html = await res.text();
  } catch (error) {
    console.warn(`GeBIZ: fetch failed (${String(error).slice(0, 80)}); skipping (0 leads).`);
    return [];
  }

  const titleRe = /formSectionHeader6_TEXT">([^<]+)</g;
  const matches = [...html.matchAll(titleRe)];

  const byUrl = new Map<string, NormalizedLead>();
  for (let i = 0; i < matches.length; i++) {
    const title = decode(matches[i][1]);
    if (!title) continue;
    const start = matches[i].index ?? 0;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? start + 4000) : start + 4000;
    const block = html.slice(start, end);

    const vals = [...block.matchAll(/VALUE-DIV[^>]*>([^<]{1,160})</g)].map((m) => decode(m[1]));
    const agency = vals[0] || null;
    const date = vals[1] || ''; // "Published" value, e.g. "17 Jul 2026 03:05 PM"
    const category = vals[2] || '';

    // Closing date lives in a separate DATE-GREEN element (not a VALUE-DIV), with
    // an embedded <br /> and no space before AM/PM; normalize before parsing.
    const closeM = block.match(/outputText_DATE-GREEN"[^>]*>([\s\S]{1,40}?)<\/div>/);
    const closeRaw = closeM
      ? decode(closeM[1])
          .replace(/<br\s*\/?>/gi, ' ')
          .replace(/(\d)(AM|PM)/i, '$1 $2')
          .replace(/\s+/g, ' ')
          .trim()
      : null;

    // English-keyword relevance filter (when configured).
    if (kw.length) {
      const hay = `${title} ${category} ${agency ?? ''}`.toLowerCase();
      if (!kw.some((k) => hay.includes(k))) continue;
    }

    const ref = reference(title);
    const url = `${LISTING_URL}#${encodeURIComponent(ref ?? title)}`;
    if (byUrl.has(url)) continue;

    byUrl.set(url, {
      title,
      url,
      raw_content: [
        `Opportunity: ${title}`,
        `Agency: ${agency ?? 'unknown'}`,
        `Procurement category: ${category}`,
        `Date: ${date}`,
        `Reference: ${ref ?? ''}`,
      ].join('\n'),
      company: agency,
      location: 'Singapore',
      deadline: toIso(closeRaw),
      published_date: toIso(date),
      value_estimate: null,
      source: 'gebiz',
    });
  }

  const leads = [...byUrl.values()];
  if (leads.length === 0) {
    console.warn('GeBIZ: no opportunity cards parsed (page likely changed or JS-gated). 0 leads.');
  } else {
    console.log(`GeBIZ: ${leads.length} opportunities parsed (first page only)`);
  }
  return leads;
}
