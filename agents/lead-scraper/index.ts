// Lead scraper entry point (CanadaBuys tenders + Adzuna postings).
// Run with: npm run scrape:leads

import { supabaseAdmin } from '../../lib/supabase-admin';
import { scrapeAll } from './scraper';
import { scoreLead } from './scorer';
import { writeLeads } from './writer';

const AGENT_NAME = 'lead-scraper';

async function run(): Promise<void> {
  console.log('Lead scraper starting...');

  await supabaseAdmin
    .from('agents')
    .update({ status: 'running', last_run: new Date().toISOString() })
    .eq('name', AGENT_NAME);

  try {
    const raw = await scrapeAll();
    console.log(`Fetched ${raw.length} candidate leads`);

    const scored = await Promise.all(raw.map(scoreLead));
    const written = await writeLeads(scored);
    console.log(`Wrote ${written} qualified leads`);

    await supabaseAdmin
      .from('agents')
      .update({ status: 'idle', leads_found: written, error: null })
      .eq('name', AGENT_NAME);
  } catch (error) {
    console.error('Scraper failed:', error);
    await supabaseAdmin
      .from('agents')
      .update({ status: 'error', error: String(error) })
      .eq('name', AGENT_NAME);
    process.exitCode = 1;
  }
}

run();
