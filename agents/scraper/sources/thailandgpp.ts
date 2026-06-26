// Thailand Government Procurement (e-GP, gprocurement.go.th) source.
//
// FRAGILE / best-effort. The Thai e-GP public announcement endpoints are either
// session-gated or JS-rendered (.NET/portal), and the only openly reachable
// surface is the gdcatalog.go.th dataset catalog (metadata about datasets, not
// live tender notices). There is no clean rows/JSON/RSS feed of live
// opportunities, so reliable extraction needs a headless browser (Playwright),
// same situation as MERX. This adapter attempts a configurable announcement
// listing, parses what it can, and on failure logs and returns [] WITHOUT
// throwing, so it never crashes the orchestrator run.

import type { NormalizedLead } from './types';

// Override with a reachable listing URL if one becomes available.
const LISTING_URL =
  process.env.THAI_GPP_URL ??
  'https://process3.gprocurement.go.th/EPROCRpdfWeb/jsp/control.rpdf';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

export async function scrapeThailandGpp(): Promise<NormalizedLead[]> {
  let html: string;
  try {
    const res = await fetch(LISTING_URL, { headers: { 'User-Agent': UA } });
    if (!res.ok) {
      console.warn(
        `Thailand GPP: listing returned HTTP ${res.status}; e-GP needs a headless browser. Skipping (0 leads).`
      );
      return [];
    }
    html = await res.text();
  } catch (error) {
    console.warn(`Thailand GPP: fetch failed (${String(error).slice(0, 80)}); skipping (0 leads).`);
    return [];
  }

  // Best-effort: announcement rows link to a project detail page carrying a
  // projectId. If the reachable page is JS-rendered this matches nothing.
  const leads: NormalizedLead[] = [];
  const re = /href="([^"]*projectId=([^"&]+)[^"]*)"[^>]*>\s*([^<]{8,200})</gi;
  for (const m of html.matchAll(re)) {
    const href = m[1].startsWith('http') ? m[1] : `https://process3.gprocurement.go.th${m[1]}`;
    const title = m[3].trim();
    if (!title) continue;
    leads.push({
      title,
      url: href,
      raw_content: `Thai e-GP announcement: ${title}`,
      company: null,
      location: 'Thailand',
      deadline: null,
      value_estimate: null,
      source: 'thailandgpp',
    });
  }

  if (leads.length === 0) {
    console.warn(
      'Thailand GPP: no parseable announcement rows in static HTML (likely JS-rendered). Skipping (0 leads).'
    );
  } else {
    console.log(`Thailand GPP: ${leads.length} announcements parsed`);
  }
  return leads;
}
