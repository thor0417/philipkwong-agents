// A NAME COMES FROM THE RECORD, OR THE PROJECT KEEPS A PROVISIONAL ONE.
//
//   npm run rename:provisional            dry run
//   APPLY=1 npm run rename:provisional    write
//
// Applies the naming rules in agents/scraper/project-naming to the stored
// register, so the corpus reflects the rules without waiting for a full
// clustering run. Every candidate is derived by calling deriveProjectName - the
// same function the clusterer calls - rather than by a second implementation of
// the rules, which is the mistake that made the last naming migration diverge
// from the engine it was correcting.
//
// WHAT IT WRITES: projects.name and projects.name_source. Nothing else, ever.
//
// THREE THINGS IT REFUSES TO DO.
//
//   A HAND-NAMED PROJECT IS NEVER TOUCHED. Checked the way project-write checks
//   it, through overriddenFields, so Philip's names outrank every rule here.
//
//   A SITE-NAMED PROJECT IS NOT RE-ADDRESSED. When a project is named from an
//   address and would be named from a DIFFERENT address, that is the unstable
//   tie documented in project-naming: a New York calendar notice contributes
//   four strangers' addresses and every candidate has a count of one. The rules
//   have no basis to prefer either, so the stored answer stands. The venue-word
//   corrections ARE applied, because those only ever REMOVE a suffix, which is
//   the test below: the new name must be a prefix of the old one.
//
//   A NAME IS NEVER SHORTENED TO NOTHING. A candidate under 8 characters is
//   refused outright.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import {
  caseNumbersOf,
  fetchAllLiveRecords,
  fetchProjects,
  fetchRecordsByProject,
  officeAddresses,
  oldestFirst,
  recomputed,
} from '../name-audit';
import { disambiguateNames } from '../project-naming';
import { overriddenFields } from '../write-guard';

const APPLY = process.env.APPLY === '1';

const MIN_NAME = 8;

/**
 * True when a site-named project's new name only drops a suffix from the old
 * one. See the header: an address SWAP is refused, a venue-word removal is not.
 */
export function isSuffixTrim(from: string, to: string): boolean {
  return from.trim().startsWith(to.trim());
}

async function main(): Promise<void> {
  const projects = await fetchProjects();
  const byProject = await fetchRecordsByProject(projects.map((p) => p.id));
  const offices = officeAddresses(await fetchAllLiveRecords());

  // DERIVE FIRST, THEN DISAMBIGUATE, THEN DECIDE - the clusterer's own order.
  //
  // Without the disambiguation pass this harness proposes ONE name for the two
  // Las Vegas 2050 Master Plan amendments, which is how they came to be stored
  // as "... (25-0002)" and "... (25-0594)" in the first place. A migration that
  // writes the collision back is a migration that undoes a fix.
  const derived = projects.map((p) => {
    const records = oldestFirst(byProject.get(p.id) ?? []);
    return { p, records, next: records.length ? recomputed(p, records, offices) : null };
  });
  const withNames = derived.filter((d) => d.next);
  for (const m of disambiguateNames(
    withNames.map((d) => ({
      name: d.next!.name,
      market: d.p.market ?? d.p.region_state ?? null,
      project_key: d.p.project_key,
      caseNumbers: caseNumbersOf(d.records),
      date: null,
    }))
  )) {
    withNames[m.index].next!.name = m.to;
  }

  const planned: { id: string; from: string; to: string; source: string; market: string }[] = [];
  const refused: { name: string; reason: string }[] = [];

  for (const { p, records, next } of derived) {
    if (!next || records.length === 0) continue;
    if (overriddenFields(p.manual_overrides).has('name')) {
      refused.push({ name: p.name, reason: 'hand-named' });
      continue;
    }
    if (next.name.trim() === p.name.trim() && next.source === p.name_source) continue;
    if (next.name.trim().length < MIN_NAME) {
      refused.push({ name: p.name, reason: `candidate too short: "${next.name}"` });
      continue;
    }
    if (
      next.name.trim() !== p.name.trim() &&
      p.name_source === 'site' &&
      next.source === 'site' &&
      !isSuffixTrim(p.name, next.name)
    ) {
      refused.push({ name: p.name, reason: `unstable address tie, would become "${next.name}"` });
      continue;
    }
    planned.push({
      id: p.id,
      from: p.name,
      to: next.name,
      source: next.source,
      market: p.market ?? p.region_state ?? '(no market)',
    });
  }

  const renames = planned.filter((c) => c.from.trim() !== c.to.trim());
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'}: ${planned.length} rows to write, ${renames.length} of them renames`);
  const byMarket = new Map<string, typeof planned>();
  for (const c of renames) {
    if (!byMarket.has(c.market)) byMarket.set(c.market, []);
    byMarket.get(c.market)!.push(c);
  }
  for (const [m, cs] of [...byMarket.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n### ${m} (${cs.length})`);
    for (const c of cs) {
      console.log(`  BEFORE  ${c.from}`);
      console.log(`  AFTER   ${c.to}   [${c.source}]`);
    }
  }
  if (refused.length) {
    console.log(`\nREFUSED (${refused.length}), left exactly as they are:`);
    for (const r of refused) console.log(`  ${r.reason}: ${r.name}`);
  }

  if (!APPLY) {
    console.log('\nDry run. Re-run with APPLY=1 to write.');
    return;
  }

  let written = 0;
  for (const c of planned) {
    const { error } = await supabaseAdmin
      .from('projects')
      .update({ name: c.to, name_source: c.source })
      .eq('id', c.id);
    if (error) throw new Error(`update failed for ${c.id}: ${error.message}`);
    written++;
  }
  console.log(`\nwrote ${written} rows`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
