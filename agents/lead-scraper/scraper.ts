// Orchestrates the lead sources into a single RawLead[] for scoring.
//   - CanadaBuys: federal tender/RFP notices (direct consulting leads, keyless)
//   - Adzuna:     Canadian employer job postings (secondary signal, free API key)

import { scrapeCanadaBuys } from './canadabuys';
import { scrapeAdzuna } from './adzuna';

export interface RawLead {
  title: string;
  url: string;
  content: string;
  source: string;
  // Source-captured dates (ISO), when the adapter exposes them. Optional so the
  // shape stays backward-compatible; the writer records provenance in date_source.
  deadline?: string | null;
  published_date?: string | null;
}

export async function scrapeAll(): Promise<RawLead[]> {
  const results = await Promise.allSettled([scrapeCanadaBuys(), scrapeAdzuna()]);

  const leads: RawLead[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      leads.push(...r.value);
    } else {
      console.error('Source failed:', r.reason);
    }
  }
  return leads;
}
