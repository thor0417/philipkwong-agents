// NAME THE THING, NOT THE ACTION.
//
//   npm run rename:instruments          dry run
//   APPLY=1 npm run rename:instruments  write
//
// Eighteen projects are named after the opening clause of an ordinance:
//
//   "approving the activities and improvements eligible for tax (RS2026-2081)"
//   "possible action to approve the ratification of the Commission for the Las Vegas"
//   "accepting a grant from the Centennial Park Conservancy to the Metropolitan"
//
// Each names what a council was asked to DO and never names what it was asked
// to do it to. The stage column already carries the action. What the register
// is missing is the subject, which in every one of these cases is written in
// the same title, capitalised, a few words further along.
//
// THE TRIGGER IS DELIBERATELY NARROW. A project is only considered if its
// CURRENT stored name reads as a sentence fragment. That state can only arise
// from a stripped leading verb, so a target-named project ("OCVibe",
// "Disneyland Resort") and an applicant- or site-named one can never match it.
// The alternative - recomputing every name from scratch - was measured first
// and would have moved 47 projects, nearly all of them onto WORSE names,
// because this harness cannot see the target list the clusterer names from.
//
// A HAND-NAMED PROJECT IS NEVER TOUCHED, checked the same way project-write
// checks it: a 'name' entry in manual_overrides. Philip's names outrank every
// rule in this file.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { instrumentSubject } from '../project-naming';
import { overriddenFields } from '../write-guard';

const APPLY = process.env.APPLY === '1';

// The shape of a name that began mid-sentence. Mirrors FRAGMENT_START in
// project-naming; kept here as its own literal because this file's job is to
// find rows in the CURRENT table, not to re-derive what the rule would do.
const FRAGMENT = new RegExp(
  '^(?:[a-z]|(?:Approving|Authorizing|Providing|Accepting|Amending|Adopting|' +
    'Establishing|Creating|Declaring|To\\s+(?:authorize|approve|amend|accept))\\b)'
);

interface Row {
  id: string;
  name: string;
  market: string | null;
  manual_overrides: Record<string, unknown> | null;
}

async function main(): Promise<void> {
  console.log(APPLY ? 'RENAME: APPLYING' : 'RENAME: DRY RUN (APPLY=1 to write)');

  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('projects')
      .select('id,name,market,manual_overrides')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...(data as unknown as Row[]));
    if (data.length < 1000) break;
  }

  const fragments = rows.filter((r) => FRAGMENT.test(r.name));
  console.log(`projects: ${rows.length}   named after an action: ${fragments.length}\n`);

  let renamed = 0;
  let unnameable = 0;
  let protectedRows = 0;

  for (const p of fragments) {
    if (overriddenFields(p.manual_overrides).has('name')) {
      protectedRows++;
      console.log(`  HAND-NAMED, left alone: ${p.name.slice(0, 60)}`);
      continue;
    }

    // The earliest record states the matter; later ones only reference it.
    const { data: recs, error } = await supabaseAdmin
      .from('leads')
      .select('title,published_date')
      .eq('project_id', p.id)
      .neq('status', 'dismissed')
      .order('published_date', { ascending: true })
      .limit(10);
    if (error) throw new Error(error.message);

    let subject: string | null = null;
    for (const r of (recs ?? []) as { title: string | null }[]) {
      subject = instrumentSubject(r.title ?? '');
      if (subject) break;
    }

    if (!subject) {
      // A general obligation bond issue or a zoning code amendment names no
      // thing. The fragment stays, because inventing a name for it would be
      // worse than showing the words the council actually used.
      unnameable++;
      console.log(`  no named subject: [${p.market ?? ''}] ${p.name.slice(0, 62)}`);
      continue;
    }
    if (subject === p.name) continue;

    console.log(`  [${p.market ?? ''}] ${p.name.slice(0, 62)}`);
    console.log(`        -> ${subject}`);
    renamed++;
    if (APPLY) {
      const { error: uerr } = await supabaseAdmin
        .from('projects')
        .update({ name: subject })
        .eq('id', p.id);
      if (uerr) throw new Error(`rename failed for ${p.id}: ${uerr.message}`);
    }
  }

  console.log(
    `\n${APPLY ? 'renamed' : 'would rename'}: ${renamed}   left as-is (no named subject): ${unnameable}   hand-named, protected: ${protectedRows}`
  );
  if (!APPLY) console.log('Nothing was written. APPLY=1 to write.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
