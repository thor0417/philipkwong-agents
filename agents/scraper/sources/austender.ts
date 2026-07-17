// AusTender source (Australian government procurement).
// Keyless OCDS API: https://api.tenders.gov.au/ocds/findByDates/contractPublished/{from}/{to}
//
// AusTender's OCDS feed exposes contract notices (awarded contracts) only; its
// ATM (open-opportunity) atom feed is WAF-blocked to non-browser clients, and
// the OCDS API rejects atm dateTypes. Awarded contract notices are still a
// useful buyer signal: they identify agencies that procure relevant services.

import type { NormalizedLead } from './types';
import { toIso } from './types';

const WINDOW_DAYS = Number(process.env.AUSTENDER_WINDOW_DAYS ?? '30');
// Page cap (100 releases/page). Bounds the run; logs if more pages remain.
const MAX_PAGES = Number(process.env.AUSTENDER_PAGES ?? '5');

interface OcdsValue {
  amount?: string;
  currency?: string;
}

interface OcdsParty {
  name?: string;
  roles?: string[];
  address?: {
    locality?: string;
    region?: string;
    countryName?: string;
  };
}

interface OcdsContract {
  id?: string;
  awardID?: string;
  title?: string;
  description?: string;
  value?: OcdsValue;
  procurementMethodDetails?: string;
}

interface OcdsRelease {
  ocid?: string;
  // Release publication date (ISO 8601 Z, e.g. "2026-07-17T06:55:29Z").
  date?: string;
  parties?: OcdsParty[];
  tender?: { procurementMethodDetails?: string };
  contracts?: OcdsContract[];
}

interface OcdsResponse {
  releases?: OcdsRelease[];
  links?: { next?: string };
}

function isoZ(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function procuringEntity(parties: OcdsParty[] | undefined): OcdsParty | undefined {
  return (parties ?? []).find((p) => (p.roles ?? []).includes('procuringEntity'));
}

function partyLocation(p: OcdsParty | undefined): string | null {
  const a = p?.address;
  if (!a) return null;
  const parts = [a.locality, a.region, a.countryName].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function valueText(v: OcdsValue | undefined): string | null {
  if (!v?.amount) return null;
  return `${v.amount} ${v.currency ?? ''}`.trim();
}

// CN page URL: https://www.tenders.gov.au/Cn/Show/<guid>, where the guid is the
// part of awardID after the "CN<number>-" prefix.
function cnUrl(awardID: string | undefined): string | null {
  if (!awardID) return null;
  const dash = awardID.indexOf('-');
  if (dash === -1) return null;
  return `https://www.tenders.gov.au/Cn/Show/${awardID.slice(dash + 1)}`;
}

export async function scrapeAusTender(): Promise<NormalizedLead[]> {
  const now = new Date();
  const from = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  let url =
    `https://api.tenders.gov.au/ocds/findByDates/contractPublished/` +
    `${isoZ(from)}/${isoZ(now)}`;

  const byUrl = new Map<string, NormalizedLead>();
  let page = 0;

  while (url && page < MAX_PAGES) {
    page++;
    let data: OcdsResponse;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'philipkwong-agents/1.0 (+scraper)', Accept: 'application/json' },
      });
      if (!res.ok) {
        console.error(`AusTender page ${page} failed: HTTP ${res.status}`);
        break;
      }
      data = (await res.json()) as OcdsResponse;
    } catch (error) {
      console.error(`AusTender page ${page} error:`, error);
      break;
    }

    for (const r of data.releases ?? []) {
      const buyer = procuringEntity(r.parties);
      for (const c of r.contracts ?? []) {
        const leadUrl = cnUrl(c.awardID);
        const title = c.description || c.title;
        if (!leadUrl || !title) continue;
        if (byUrl.has(leadUrl)) continue;
        byUrl.set(leadUrl, {
          title,
          url: leadUrl,
          raw_content: [
            `Contract notice: ${title}`,
            `Buyer: ${buyer?.name ?? 'unknown'}`,
            `Value: ${valueText(c.value) ?? 'not stated'}`,
            `Method: ${r.tender?.procurementMethodDetails ?? ''}`,
            `Reference: ${c.id ?? ''}`,
          ].join('\n'),
          company: buyer?.name ?? null,
          location: partyLocation(buyer),
          // Awarded contract: no live bid deadline. The release date is the notice
          // publication date (this OCDS feed carries no tenderPeriod).
          deadline: null,
          published_date: toIso(r.date),
          value_estimate: valueText(c.value),
          source: 'austender',
        });
      }
    }

    const next = data.links?.next;
    if (next && page >= MAX_PAGES) {
      console.warn(`AusTender: hit page cap (${MAX_PAGES}); more contract notices remain.`);
    }
    url = next ?? '';
  }

  const leads = [...byUrl.values()];
  console.log(`AusTender: ${leads.length} contract notices over ${WINDOW_DAYS}d (${page} page(s))`);
  return leads;
}
