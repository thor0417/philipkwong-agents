// STRIP THE RETIRED VENUE PHRASE FROM PROJECT NAMES.
//
// The naming layer appends a venue phrase to an applicant stem, and the phrase
// for the old 'Leisure Destination' bucket was "leisure development". Forty-four
// projects are named "<applicant> leisure development", and after
// reclassify-venues forty-three of them have NO venue type at all: the name
// asserts a classification that no longer exists, in the retired vocabulary, on
// a line that prints in a client's report.
//
// The name is rebuilt the way the namer would build it today: the applicant stem
// plus the phrase for the project's CURRENT venue, or the stem alone when the
// venue is null. venuePhrase is imported rather than reimplemented so this
// cannot drift from the namer.
//
// A stem that would be left empty keeps its existing name. A name is an
// identifier people have been reading; replacing it with nothing is worse than
// leaving a stale adjective on it, and the case does not arise in this corpus.
//
// Idempotent. DRY by default; APPLY=1 to write.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { venuePhrase } from '../project-naming';

const APPLY = process.env.APPLY === '1';

// Every venue phrase the namer has ever appended, so a stem is recovered
// whatever the project used to be classified as.
const RETIRED_PHRASES = [' leisure development'];

async function main(): Promise<void> {
  console.log(APPLY ? 'RENAME: APPLYING\n' : 'RENAME: DRY RUN (APPLY=1 to write)\n');

  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id,name,venue_type,status')
    .eq('module', 'gli')
    .limit(3000);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as { id: string; name: string; venue_type: string | null; status: string | null }[];
  const stale = rows.filter((p) => RETIRED_PHRASES.some((s) => p.name.toLowerCase().endsWith(s)));
  console.log(`projects carrying a retired venue phrase: ${stale.length}\n`);

  let changed = 0;
  for (const p of stale) {
    let stem = p.name;
    for (const s of RETIRED_PHRASES) {
      if (stem.toLowerCase().endsWith(s)) stem = stem.slice(0, stem.length - s.length).trim();
    }
    if (!stem) {
      console.log(`  SKIP (empty stem) ${p.name}`);
      continue;
    }
    const phrase = venuePhrase(p.venue_type);
    const next = phrase ? `${stem} ${phrase}` : stem;
    if (next === p.name) continue;
    console.log(`  ${p.name.slice(0, 70)}`);
    console.log(`    -> ${next.slice(0, 70)}   [venue: ${p.venue_type ?? 'null'}]`);
    if (APPLY) {
      const { error: uErr } = await supabaseAdmin.from('projects').update({ name: next }).eq('id', p.id);
      if (uErr) { console.error(`    FAILED: ${uErr.message}`); continue; }
    }
    changed++;
  }
  console.log(`\n${APPLY ? 'renamed' : 'would rename'} ${changed} project(s)`);
}

main();
