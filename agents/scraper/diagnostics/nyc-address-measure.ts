// READ-ONLY. WHOSE ADDRESS IS THE ADDRESS ON A CITY RECORD NOTICE?
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/nyc-address-measure.ts
//
// Nothing is written and nothing is proposed. sources/nyc-city-record builds
// `Address:` from the dataset's own building_name / street_address_1 / city /
// zip_code, and a client brief printed it on a Throggs Neck casino as
// "120 Broadway, New York, 10271" - the Department of City Planning's central
// office, and the building whose Lower Concourse holds the City Planning
// Commission hearing room.
//
// THE QUESTION IS WHAT THOSE COLUMNS MEAN, not whether one value looks wrong. A
// public hearing notice's address block is WHERE THE HEARING IS and WHERE THE
// PLANS ARE ON FILE. Neither is the premises. If that is what the column holds,
// then every notice carries it and the defect is corpus-wide rather than one
// bad row - the same shape as a label read as the thing it names.
//
// IT NAMES NO VENUES AND BLOCKS NOTHING. A venue blocklist would be a name rule
// wearing a rule's clothes. This counts the distinct values and prints them, so
// the shape of the column is visible rather than asserted, and separately asks
// whether the notice body states a premises we could take instead.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { isHospitalityModule } from '../pipelines';
import { inCorpusScope } from '../../../lib/corpus-scope';

interface Lead {
  id: string;
  title: string | null;
  url: string | null;
  source: string | null;
  stream: string | null;
  status: string | null;
  project_id: string | null;
  raw_content: string | null;
  filing_facts: { kind: string; label: string; display: string; line: string }[] | null;
}

async function pageAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabaseAdmin.from(table).select(columns).range(from, from + 499);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...(data as T[]));
    if (data.length < 500) break;
  }
  return out;
}

/** The `Address: …` line the adapter writes, read back off the stored text. */
function addressLine(raw: string | null | undefined): string | null {
  const m = /^Address:\s*(.+)$/m.exec(String(raw ?? ''));
  return m ? m[1].trim() : null;
}

/** The `Notice: …` body, which is where a premises would be stated if anywhere. */
function noticeBody(raw: string | null | undefined): string {
  const m = /^Notice:\s*([\s\S]*?)(?:\n[A-Z][A-Za-z /]{2,30}:|\s*$)/m.exec(String(raw ?? ''));
  return m ? m[1].trim() : '';
}

// A premises phrase a notice uses when it states the SITE rather than the venue.
// Reported as a count of records where such a phrase exists at all - not parsed,
// not proposed as an extractor.
const PREMISES_PHRASE = /\b(premises (?:known as|located at)|property located at|site located at|located at)\b/i;

async function main(): Promise<void> {
  const projects = await pageAll<{ id: string; name: string; market: string | null; module: string | null; status: string | null; country: string | null; stage: string | null }>(
    'projects',
    'id,name,market,module,status,country,stage'
  );
  const live = new Map(
    projects
      .filter((p) => isHospitalityModule(p.module) && p.status !== 'dismissed' && inCorpusScope(p.country) && p.stage !== 'dormant')
      .map((p) => [p.id, p])
  );

  const leads = await pageAll<Lead>(
    'leads',
    'id,title,url,source,stream,status,project_id,raw_content,filing_facts'
  );

  const cityRecord = leads.filter((l) => l.status !== 'dismissed' && l.source === 'nyc-city-record');
  const cityRecordLive = cityRecord.filter((l) => l.project_id && live.has(l.project_id));

  console.log('='.repeat(100));
  console.log('THE ADDRESS ON A CITY RECORD NOTICE');
  console.log('='.repeat(100));
  console.log(`  nyc-city-record records, not dismissed:        ${cityRecord.length}`);
  console.log(`  of those attached to a LIVE project:           ${cityRecordLive.length}`);

  const withAddress = cityRecordLive.filter((l) => addressLine(l.raw_content));
  console.log(`  carrying an Address: line:                     ${withAddress.length}`);
  const printed = cityRecordLive.filter((l) =>
    (l.filing_facts ?? []).some((f) => /address/i.test(f.label))
  );
  console.log(`  whose filing_facts carry an Address fact:      ${printed.length}`);
  console.log('');

  // ---- EVERY DISTINCT ADDRESS, IN FULL --------------------------------------
  const byAddr = new Map<string, { n: number; projects: Set<string> }>();
  for (const l of withAddress) {
    const a = addressLine(l.raw_content)!;
    if (!byAddr.has(a)) byAddr.set(a, { n: 0, projects: new Set() });
    const e = byAddr.get(a)!;
    e.n++;
    e.projects.add(live.get(l.project_id!)!.name);
  }
  console.log('-'.repeat(100));
  console.log(`EVERY DISTINCT Address VALUE ON A LIVE PROJECT (${byAddr.size} of them)`);
  console.log('-'.repeat(100));
  console.log('    n  projects  address');
  for (const [a, e] of [...byAddr.entries()].sort((x, y) => y[1].n - x[1].n)) {
    console.log(`  ${String(e.n).padStart(3)}  ${String(e.projects.size).padStart(8)}  ${a.slice(0, 62)}`);
    if (e.projects.size <= 4) {
      for (const p of e.projects) console.log(`                    on: ${p.slice(0, 60)}`);
    }
  }

  // ---- DOES THE ADDRESS SIT IN THE PROJECT'S OWN MARKET? --------------------
  //
  // Not a venue list. A borough or city named in the address that the project's
  // own market contradicts is the reader-visible symptom, counted rather than
  // classified.
  console.log('');
  console.log('-'.repeat(100));
  console.log('WHETHER THE NOTICE BODY STATES A PREMISES WE COULD TAKE INSTEAD');
  console.log('-'.repeat(100));
  const withBody = withAddress.filter((l) => noticeBody(l.raw_content).length > 0);
  const withPremises = withAddress.filter((l) => PREMISES_PHRASE.test(noticeBody(l.raw_content)));
  console.log(`  records carrying a Notice: body at all:        ${withBody.length} of ${withAddress.length}`);
  console.log(`  whose body contains a premises phrase:         ${withPremises.length}`);
  console.log('');
  console.log('  SAMPLES, so the shape of the body is visible rather than assumed:');
  for (const l of withPremises.slice(0, 6)) {
    console.log(`\n    project : ${live.get(l.project_id!)!.name.slice(0, 56)}`);
    console.log(`    Address : ${addressLine(l.raw_content)}`);
    console.log(`    Notice  : ${noticeBody(l.raw_content).replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  if (withPremises.length === 0) {
    console.log('\n    NONE. The body states no premises phrase on any record, so there is nothing');
    console.log('    to take instead and the honest answer is no address rather than the wrong one.');
    for (const l of withBody.slice(0, 4)) {
      console.log(`\n    project : ${live.get(l.project_id!)!.name.slice(0, 56)}`);
      console.log(`    Notice  : ${noticeBody(l.raw_content).replace(/\s+/g, ' ').slice(0, 200)}`);
    }
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
