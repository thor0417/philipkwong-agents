// Singapore GeBIZ source (gebiz.gov.sg business opportunity listing).
//
// FRAGILE / best-effort. GeBIZ is a JSF app: pagination and detail pages happen
// via postback (no GET detail URL), so only the first page of most-recent
// opportunities is reachable statically. That page DOES carry, per card, the
// title+reference, agency, date, and procurement category, which is enough for a
// lead. The per-notice URL is synthesized from the reference (anchored on the
// listing page) since GeBIZ exposes no stable GET detail link. On any parse
// failure this logs and returns [] without throwing.

import type { NormalizedLead } from './types';

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

export async function scrapeGeBiz(): Promise<NormalizedLead[]> {
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
    const date = vals[1] || '';
    const category = vals[2] || '';

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
      deadline: null,
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
