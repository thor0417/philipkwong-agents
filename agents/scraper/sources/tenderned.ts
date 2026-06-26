// TenderNed source (Netherlands national tender portal, Rotterdam region).
// Keyless PAPI: https://www.tenderned.nl/papi/tenderned-rs-tns/v2/publicaties
//
// CPV filtering is profile-driven (the caller passes codes.cpv). TenderNed
// requires CPV codes in the check-digit form "NNNNNNNN-D" via repeated
// `cpvCodes` params. The CPV check digit is not trivially computable, and only
// the fuel CPV set is ever routed here, so a small lookup maps the 8-digit codes
// to their suffixed form; anything unmapped is skipped with a warning.
//
// NL also publishes to TED, so overlap is expected; the orchestrator dedupes
// TenderNed against TED by normalized title + buyer. On failure: log + [].

import type { NormalizedLead } from './types';

// 8-digit CPV -> standard check digit (fuel set).
const CPV_CHECK: Record<string, string> = {
  '09100000': '0',
  '09130000': '9',
  '09131000': '6',
  '09132000': '3',
  '09134000': '7',
  '09134100': '8',
  '09134200': '9',
};

const PAGE_SIZE = Number(process.env.TENDERNED_SIZE ?? '50');
const MAX_PAGES = Number(process.env.TENDERNED_PAGES ?? '3');
const UA = 'philipkwong-agents/1.0 (+scraper)';

interface TnPublication {
  publicatieId?: string;
  publicatieDatum?: string;
  aanbestedingNaam?: string;
  opdrachtgeverNaam?: string;
  opdrachtBeschrijving?: string;
  typePublicatie?: { omschrijving?: string };
  typeOpdracht?: { omschrijving?: string };
  link?: { href?: string };
}

interface TnResponse {
  content?: TnPublication[];
  totalElements?: number;
}

function suffixed(cpvCodes: string[]): string[] {
  const out: string[] = [];
  for (const raw of cpvCodes) {
    // Already suffixed? keep. Otherwise map by 8-digit base.
    if (/^\d{8}-\d$/.test(raw)) {
      out.push(raw);
      continue;
    }
    const check = CPV_CHECK[raw];
    if (check) out.push(`${raw}-${check}`);
    else console.warn(`TenderNed: no CPV check digit for ${raw}, skipping that code.`);
  }
  return out;
}

export async function scrapeTenderNed(cpvCodes: string[]): Promise<NormalizedLead[]> {
  const codes = suffixed(cpvCodes);
  if (codes.length === 0) {
    console.warn('TenderNed: no usable CPV codes, skipping source.');
    return [];
  }
  const cpvParam = codes.map((c) => `cpvCodes=${encodeURIComponent(c)}`).join('&');

  const byUrl = new Map<string, NormalizedLead>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const url =
      `https://www.tenderned.nl/papi/tenderned-rs-tns/v2/publicaties?${cpvParam}` +
      `&page=${page}&size=${PAGE_SIZE}`;
    let data: TnResponse;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (!res.ok) {
        console.warn(`TenderNed: page ${page} returned HTTP ${res.status}; stopping.`);
        break;
      }
      data = (await res.json()) as TnResponse;
    } catch (error) {
      console.warn(`TenderNed: page ${page} fetch failed (${String(error).slice(0, 80)}).`);
      break;
    }

    const rows = data.content ?? [];
    if (rows.length === 0) break;
    for (const r of rows) {
      const title = r.aanbestedingNaam;
      const href = r.link?.href ?? (r.publicatieId
        ? `https://www.tenderned.nl/aankondigingen/overzicht/${r.publicatieId}`
        : undefined);
      if (!title || !href) continue;
      if (byUrl.has(href)) continue;
      byUrl.set(href, {
        title,
        url: href,
        raw_content: [
          `Tender: ${title}`,
          `Buyer: ${r.opdrachtgeverNaam ?? 'unknown'}`,
          `Type: ${r.typePublicatie?.omschrijving ?? ''} / ${r.typeOpdracht?.omschrijving ?? ''}`,
          `Published: ${r.publicatieDatum ?? ''}`,
          '',
          r.opdrachtBeschrijving ?? '',
        ].join('\n'),
        company: r.opdrachtgeverNaam ?? null,
        location: 'Netherlands',
        deadline: null,
        value_estimate: null,
        source: 'tenderned',
      });
    }
  }

  const leads = [...byUrl.values()];
  console.log(`TenderNed: ${leads.length} fuel-CPV publications across up to ${MAX_PAGES} pages`);
  return leads;
}
