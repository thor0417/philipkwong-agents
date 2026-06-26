// UK Find a Tender Service (FTS) source.
// Keyless OCDS API: https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages
// Pulls open tender-stage notices over a recent window; relevance is left to the
// orchestrator prefilter. Public notice pages are /Notice/<release id>.

import type { NormalizedLead } from './types';
import { toIso } from './types';

const API = 'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages';

const WINDOW_DAYS = Number(process.env.UKTENDERS_WINDOW_DAYS ?? '21');
const LIMIT = Number(process.env.UKTENDERS_LIMIT ?? '100');
const MAX_PAGES = Number(process.env.UKTENDERS_PAGES ?? '5');

interface FtsValue {
  amount?: number;
  currency?: string;
}

interface FtsRelease {
  id?: string;
  ocid?: string;
  buyer?: { name?: string };
  tender?: {
    title?: string;
    description?: string;
    status?: string;
    classification?: { description?: string };
    mainProcurementCategory?: string;
    value?: FtsValue;
    tenderPeriod?: { endDate?: string };
  };
}

interface FtsPackage {
  releases?: FtsRelease[];
  links?: { next?: string };
}

// FTS expects naive ISO (no trailing Z / milliseconds).
function naiveIso(d: Date): string {
  return d.toISOString().slice(0, 19);
}

function valueText(v: FtsValue | undefined): string | null {
  if (!v?.amount) return null;
  return `${v.amount} ${v.currency ?? ''}`.trim();
}

export async function scrapeUkTenders(): Promise<NormalizedLead[]> {
  const now = new Date();
  const from = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  let url =
    `${API}?updatedFrom=${naiveIso(from)}&updatedTo=${naiveIso(now)}` +
    `&stages=tender&limit=${LIMIT}`;

  const byUrl = new Map<string, NormalizedLead>();
  let page = 0;

  while (url && page < MAX_PAGES) {
    page++;
    let data: FtsPackage;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'philipkwong-agents/1.0 (+scraper)', Accept: 'application/json' },
      });
      if (!res.ok) {
        console.error(`UK FTS page ${page} failed: HTTP ${res.status}`);
        break;
      }
      data = (await res.json()) as FtsPackage;
    } catch (error) {
      console.error(`UK FTS page ${page} error:`, error);
      break;
    }

    for (const r of data.releases ?? []) {
      const title = r.tender?.title;
      if (!r.id || !title) continue;
      const leadUrl = `https://www.find-tender.service.gov.uk/Notice/${r.id}`;
      if (byUrl.has(leadUrl)) continue;
      byUrl.set(leadUrl, {
        title,
        url: leadUrl,
        raw_content: [
          `Tender: ${title}`,
          `Buyer: ${r.buyer?.name ?? 'unknown'}`,
          `Category: ${r.tender?.classification?.description ?? r.tender?.mainProcurementCategory ?? ''}`,
          `Closes: ${r.tender?.tenderPeriod?.endDate ?? ''}`,
          '',
          r.tender?.description ?? '',
        ].join('\n'),
        company: r.buyer?.name ?? null,
        location: null,
        deadline: toIso(r.tender?.tenderPeriod?.endDate),
        value_estimate: valueText(r.tender?.value),
        source: 'uktenders',
      });
    }

    const next = data.links?.next;
    if (next && page >= MAX_PAGES) {
      console.warn(`UK FTS: hit page cap (${MAX_PAGES}); more notices remain.`);
    }
    url = next ?? '';
  }

  const leads = [...byUrl.values()];
  console.log(`UK FTS: ${leads.length} tender notices over ${WINDOW_DAYS}d (${page} page(s))`);
  return leads;
}
