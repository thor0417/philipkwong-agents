// Supabase write logic. Upserts qualified leads (score >= threshold) by URL.

import { supabaseAdmin } from '../../lib/supabase-admin';
import type { ScoredLead } from './scorer';

const SCORE_THRESHOLD = 60;

export async function writeLeads(leads: ScoredLead[]): Promise<number> {
  const qualified = leads.filter((l) => l.score >= SCORE_THRESHOLD);
  let written = 0;

  for (const lead of qualified) {
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
