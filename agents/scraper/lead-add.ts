// Manual lead entry CLI (npm run lead:add), GLI Tier 2 government lane, Part B.
//
// The manual half of the government framework: a hand-pulled finding from a gated
// portal (SEMARNAT, CONFOTUR, or any portal a human reviews) becomes a
// first-class row in the SAME pipeline as the automated lanes, not a side
// spreadsheet. Prompts for the record fields and writes a lead with module 'gli',
// stream 'government', source 'manual' through the shared buildGovernmentRow, so
// manual and automated records are structurally identical on the dashboard.

import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { supabaseAdmin } from '../../lib/supabase-admin';
import { buildGovernmentRow, type GovernmentTag } from './government';
import { VENUE_TYPES, SIGNAL_TYPES } from './gli';
import type { NormalizedLead } from './sources/types';

async function main(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  const ask = async (q: string, def = ''): Promise<string> => {
    const a = (await rl.question(def ? `${q} [${def}]: ` : `${q}: `)).trim();
    return a || def;
  };

  console.log('Add a manual government-record lead (module gli, stream government, source manual).\n');

  const title = await ask('Title');
  if (!title) {
    console.error('Title is required. Aborting.');
    rl.close();
    process.exitCode = 1;
    return;
  }
  const url = await ask('URL (the unique record link)');
  if (!url) {
    console.error('URL is required (it is the unique key for this record). Aborting.');
    rl.close();
    process.exitCode = 1;
    return;
  }
  const location = await ask('Location / jurisdiction');
  console.log(`  Venue types: ${VENUE_TYPES.join(', ')}`);
  const venue_type = await ask('Venue type', 'Leisure Destination/Mixed');
  console.log(`  Signal types: ${SIGNAL_TYPES.join(', ')}`);
  const signal_type = await ask('Signal type', 'Origination');
  const notes = await ask('Notes');
  rl.close();

  const lead: NormalizedLead = {
    title,
    url,
    raw_content: notes || title,
    company: null,
    location: location || null,
    deadline: null,
    published_date: null,
    value_estimate: null,
    source: 'manual',
  };
  const tag: GovernmentTag = {
    venue_type,
    signal_type,
    contact_name: null,
    contact_email: null,
    contact_phone: null,
  };
  const { row } = buildGovernmentRow(lead, tag);

  const { error } = await supabaseAdmin.from('leads').upsert(row, { onConflict: 'url' });
  if (error) {
    console.error(`Write failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `\nSaved manual lead: "${title}" (${location || 'no location'}) as ${signal_type} / ${venue_type}.`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('lead:add failed:', err);
    process.exitCode = 1;
  });
}
