// TOMBSTONE THE PRESS RECORDS OUTSIDE THE COUNTRIES THIS SYSTEM COVERS.
//
// The lane refuses these at capture from now on (see the country screen in
// gli.ts). This is the rows already stored.
//
// DISMISSED, NEVER DELETED. Standing rule 6, and here it is also the point: if
// a market outside the United States opens later, what we already held must be
// readable rather than re-scraped. `status = 'dismissed'` is the tombstone the
// whole system already uses, so these rows keep their url, their title, their
// resolved geography and their project link, and they stop counting anywhere a
// live record counts.
//
// THE PRESS LANE ONLY. The opportunity lane holds 69 more non-US records - World
// Bank and IADB tenders - and they are NOT touched here, because that was not
// what was asked and because they are a different kind of thing: a tender is a
// primary document with a deadline, not a headline. Measured and reported; the
// decision is Philip's.
//
//   npm run dismiss:out-of-country          report only, writes nothing
//   npm run dismiss:out-of-country -- --write   apply
//
// Report-only by default, for the same reason every migration in this directory
// is: a pass that writes before anybody has read the list is a pass that cannot
// be argued with.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { CORPUS_COUNTRIES, corpusScopeSentence, inCorpusScope } from '../../../lib/corpus-scope';
import { LIVE_PIPELINE_STORAGE_KEY } from '../pipelines';

const WRITE = process.argv.includes('--write');
const REASON = 'outside the countries this system covers';

// HELD BACK: RECORDS WHOSE OWN TEXT SAYS THE UNITED STATES AND WHOSE RESOLVED
// COUNTRY DISAGREES.
//
// The constraint is the project's geography, not our reading of it. Four of the
// 216 are real US coverage that resolveGeography got wrong, and every one is the
// defect logged as GLI-ROADMAP 1H:
//
//   "Austin" -> AU + STIN matches the ISO-2 code pattern -> Australia. Three
//   records: two on the UMusic Hotel in Austin, Texas and one on an Ayn Rand
//   museum there.
//   "United States, Canada" -> the Canada segment wins the scan -> Canada. One
//   record, a JLL trampoline-park report covering both.
//
// Listed by id rather than by a rule, deliberately. A second heuristic here
// would be a second geography resolver disagreeing with the first, which is the
// shape of the defect it is working around. These come out when 1H lands and
// the rows are re-resolved.
//
// Found by scanning every doomed record's own title and location for a US state
// or city name; four hits out of 216, and no others.
const HELD_BACK: Record<string, string> = {
  '67db8733-48f2-47b9-bab5-3ebb194135ee': 'location "United States, Canada" resolved to Canada',
  'be9a694b-12a6-4246-8e72-03e5818e2882': 'Austin, Texas resolved to Australia (1H)',
  'e53c6594-3833-42b3-ad8b-efc15a8d6a4d': 'Austin resolved to Australia (1H)',
  '38b3140e-4a9c-4665-868e-12cfebc2b0ce': 'Austin resolved to Australia (1H)',
};

interface Row {
  id: string;
  project_id: string | null;
  title: string | null;
  url: string | null;
  country: string | null;
  location: string | null;
}

async function main(): Promise<void> {
  console.log('===== PRESS RECORDS OUTSIDE THE CORPUS COUNTRIES =====');
  console.log(corpusScopeSentence());
  console.log(WRITE ? 'MODE: WRITE\n' : 'MODE: report only, nothing is written\n');

  const PAGE = 1000;
  let from = 0;
  const all: Row[] = [];
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id,project_id,title,url,country,location')
      .eq('module', LIVE_PIPELINE_STORAGE_KEY)
      .eq('stream', 'intelligence')
      .neq('status', 'dismissed')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`read failed: ${error.message}`);
    const b = (data ?? []) as Row[];
    all.push(...b);
    if (b.length < PAGE) break;
    from += PAGE;
  }

  // The same predicate the lane uses. Null country passes: an unresolved
  // country is not a foreign one.
  const outOfScope = all.filter((r) => !inCorpusScope(r.country));
  const held = outOfScope.filter((r) => HELD_BACK[r.id]);
  const doomed = outOfScope.filter((r) => !HELD_BACK[r.id]);

  if (held.length) {
    console.log(`HELD BACK: ${held.length} record(s) whose own text says the United States.`);
    console.log('The constraint is the project geography, not our reading of it.');
    for (const r of held) {
      console.log(`  ${String(r.country).padEnd(12)} ${HELD_BACK[r.id]}`);
      console.log(`     ${String(r.title).slice(0, 84)}`);
    }
    console.log('These come out when GLI-ROADMAP 1H lands and the rows are re-resolved.\n');
  }
  const byCountry = new Map<string, number>();
  for (const r of doomed) byCountry.set(String(r.country), (byCountry.get(String(r.country)) ?? 0) + 1);

  console.log(`live press records          : ${all.length}`);
  console.log(`  outside ${CORPUS_COUNTRIES.join(', ')}   : ${doomed.length}`);
  console.log(`  unresolved country (KEPT) : ${all.filter((r) => !r.country).length}`);
  console.log(`  in scope (KEPT)           : ${all.length - doomed.length - all.filter((r) => !r.country).length}\n`);

  console.log('COUNTRY                   RECORDS');
  for (const [c, n] of [...byCountry.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.padEnd(24)} ${n}`);
  }

  // Which projects lose every live record, so nothing is emptied by surprise.
  const projectIds = [...new Set(all.map((r) => r.project_id).filter(Boolean) as string[])];
  const doomedIds = new Set(doomed.map((r) => r.id));
  const survivors = new Set(
    all.filter((r) => !doomedIds.has(r.id)).map((r) => r.project_id).filter(Boolean) as string[]
  );
  const orphaned: string[] = [];
  for (let i = 0; i < projectIds.length; i += 150) {
    const slice = projectIds.slice(i, i + 150).filter((id) => !survivors.has(id));
    if (!slice.length) continue;
    // A project may also hold government or opportunity records, which this
    // pass does not touch. Only the ones left with nothing at all are orphaned.
    const { data: others } = await supabaseAdmin
      .from('leads').select('project_id').in('project_id', slice)
      .neq('stream', 'intelligence').neq('status', 'dismissed');
    const heldElsewhere = new Set((others ?? []).map((o) => o.project_id as string));
    for (const id of slice) if (!heldElsewhere.has(id)) orphaned.push(id);
  }

  const { data: op } = await supabaseAdmin
    .from('projects').select('id,name,country,significance').in('id', orphaned.slice(0, 200));
  console.log(`\nprojects left with no live record of any kind: ${orphaned.length}`);
  for (const p of (op ?? []).sort((a, b) => Number(b.significance ?? 0) - Number(a.significance ?? 0))) {
    console.log(`  [${String(Math.round(Number(p.significance ?? 0))).padStart(2)}] ${String(p.country ?? '-').padEnd(20)} ${String(p.name).slice(0, 56)}`);
  }
  const usOrphans = (op ?? []).filter((p) => p.country === 'United States');
  console.log(
    usOrphans.length
      ? `\n  *** ${usOrphans.length} of them is filed as UNITED STATES. STOP and read it before writing. ***`
      : '\n  none of them is filed as United States.'
  );

  if (!WRITE) {
    console.log('\nNothing written. Re-run with --write to apply.');
    return;
  }

  let done = 0;
  for (let i = 0; i < doomed.length; i += 200) {
    const ids = doomed.slice(i, i + 200).map((r) => r.id);
    const { error } = await supabaseAdmin
      .from('leads')
      .update({ status: 'dismissed', score_reason: REASON })
      .in('id', ids);
    if (error) throw new Error(`write failed: ${error.message}`);
    done += ids.length;
  }
  console.log(`\nTombstoned ${done} press records. Nothing deleted; every row keeps its url,`);
  console.log('title, resolved geography and project link, and can be read back if a');
  console.log('market outside the United States opens later.');

  // ---- AND REPAIR THE CACHED COUNT. ---------------------------------------
  //
  // projects.record_count is denormalised, and dismissing a record invalidates
  // it. The first run of this pass left eight projects with a count of two or
  // three over zero live rows, and verify-curation caught it at the push gate -
  // which is the gate doing its job and this pass not doing its own.
  //
  // Repaired here rather than in a follow-up script, because a migration that
  // leaves the database failing its own verification is a migration that is not
  // finished.
  const touched = [...new Set(doomed.map((r) => r.project_id).filter(Boolean) as string[])];
  let repaired = 0;
  for (const id of touched) {
    const { count, error } = await supabaseAdmin
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', id)
      .neq('status', 'dismissed');
    if (error) throw new Error(`recount failed: ${error.message}`);
    const { error: up } = await supabaseAdmin
      .from('projects')
      .update({ record_count: count ?? 0 })
      .eq('id', id);
    if (up) throw new Error(`recount write failed: ${up.message}`);
    repaired++;
  }
  console.log(`Recounted ${repaired} project${repaired === 1 ? '' : 's'} whose cached record_count this pass invalidated.`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
