// Supabase write logic. Upserts qualified leads (score >= threshold) by URL.

import { supabaseAdmin } from '../../lib/supabase-admin';
import { deriveLeadDates } from '../scraper/lead-date';
import type { ScoredLead } from './scorer';

const SCORE_THRESHOLD = 60;

export async function writeLeads(leads: ScoredLead[]): Promise<number> {
  const qualified = leads.filter((l) => l.score >= SCORE_THRESHOLD);
  let written = 0;

  for (const lead of qualified) {
    // Best-available date + provenance from the adapter's captured source dates.
    const dates = deriveLeadDates({
      title: lead.title,
      raw_content: lead.content,
      url: lead.url,
      company: null,
      location: null,
      deadline: lead.deadline ?? null,
      published_date: lead.published_date ?? null,
      value_estimate: null,
      source: lead.source,
    });
    const { error } = await supabaseAdmin.from('leads').upsert(
      {
        source: lead.source,
        url: lead.url,
        title: lead.title,
        raw_content: lead.content,
        score: lead.score,
        score_reason: lead.score_reason,
        jurisdiction: lead.jurisdiction,
        budget: lead.budget,
        deadline: dates.deadline,
        published_date: dates.published_date,
        date_source: dates.date_source,
        status: 'new',
      },
      { onConflict: 'url' }
    );

    if (error) {
      console.error(`Write failed for ${lead.url}:`, error.message);
    } else {
      written++;
    }
  }

  return written;
}
