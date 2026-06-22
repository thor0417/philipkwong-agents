// Upwork scraper entry point.
// Run with: npm run scrape:upwork

import { supabaseAdmin } from '../../lib/supabase-admin';
import { scrapeUpwork, UPWORK_FEEDS } from './scraper';
import { scoreLead } from './scorer';
import { writeLeads } from './writer';

async function run(): Promise<void> {
  console.log('Upwork scraper starting...');

  await supabaseAdmin
    .from('agents')
    .update({ status: 'running', last_run: new Date().toISOString() })
    .eq('name', 'upwork-scraper');

  try {
    const raw = await scrapeUpwork(UPWORK_FEEDS);
    console.log(`Fetched ${raw.length} postings`);

    const scored = await Promise.all(raw.map(scoreLead));
    const written = await writeLeads(scored);
    console.log(`Wrote ${written} qualified leads`);

    await supabaseAdmin
      .from('agents')
      .update({ status: 'idle', leads_found: written, error: null })
      .eq('name', 'upwork-scraper');
  } catch (error) {
    console.error('Scraper failed:', error);
    await supabaseAdmin
      .from('agents')
      .update({ status: 'error', error: String(error) })
      .eq('name', 'upwork-scraper');
    process.exitCode = 1;
  }
}

run();
