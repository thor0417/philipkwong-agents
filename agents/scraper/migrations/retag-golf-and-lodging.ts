// One-off re-tag for the two venue rules added in this pass.
//
//   npm run retag:golf                  dry run
//   RETAG_APPLY=1 npm run retag:golf    write
//
// Golf/Resort Course is a new value in VENUE_TYPES, and 'lodge' and 'cabin'
// joined the Hotel rule. Both change what the classifier returns; this brings
// the stored corpus into line.
//
// DELIBERATELY NARROW, AND retag-taxonomy IS NOT THE TOOL. That script rewrites
// venue_type on every row to whatever the classifier says today, which on this
// corpus would move 131 records - only 10 of them because of these two rules.
// The other 121 are pre-existing drift between stored values and the classifier
// (rows tagged before borrowed-context neutralisation, or from an LLM hint),
// and correcting them is a decision of its own that must not ride along inside
// a rule change. So this touches ONLY the rows the two new rules move.
//
// IT UPDATES THE CATEGORY TOO. development_category is derived from venue_type
// through VENUE_TO_CATEGORY, so a row whose venue changes and whose category
// does not is a row that contradicts the taxonomy.
//
// AND IT ROLLS THE PROJECTS UP. A project's venue is the MODE over its records'
// venues (cluster.ts), so updating records without re-deriving the projects
// would leave the register showing the old answer. Re-derived here with the
// same mode rule rather than a second one.
//
// Nothing is deleted and no row Philip has touched is changed.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { categoryForVenue, classifyVenueType } from '../../../lib/taxonomy';
import { selectAllPaged } from '../page-select';

type Row = Record<string, unknown>;

/** The venues these two rules can produce. Nothing else is touched. */
const TOUCHED = new Set(['Golf/Resort Course', 'Hotel']);

function modeOf(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

async function main(): Promise<void> {
  const apply = process.env.RETAG_APPLY === '1';
  console.log('===== RE-TAG: GOLF AND LODGING =====');
  console.log(apply ? '(RETAG_APPLY=1: writing)' : '(dry run: set RETAG_APPLY=1 to write)');

  const { rows, complete } = await selectAllPaged<Row>(
    'leads',
    'id,title,raw_content,venue_type,development_category,market,project_id,status,notes,manual_overrides',
    (q: unknown) => (q as { neq: (a: string, b: string) => unknown }).neq('status', 'dismissed'),
    'retag-golf'
  );
  if (!complete) throw new Error('read was partial; refusing to retag a slice of the corpus.');

  const changes = rows
    .map((r) => {
      const venue = classifyVenueType(`${String(r.title ?? '')}\n${String(r.raw_content ?? '')}`);
      return { r, venue, category: categoryForVenue(venue) };
    })
    // ONLY where the NEW value is one of the two rules' outputs AND it differs.
    // A record moving away from Hotel or Golf for some unrelated reason is the
    // pre-existing drift this migration refuses to touch.
    .filter((c) => c.venue && TOUCHED.has(c.venue) && c.venue !== (c.r.venue_type ?? null));

  console.log(`\n${rows.length} live records; ${changes.length} to re-tag.\n`);
  for (const c of changes) {
    console.log(
      `  ${String(c.r.id).slice(0, 8)}  [${c.r.market ?? '-'}]  ` +
        `${String(c.r.venue_type ?? 'null')} -> ${c.venue}  (${c.category})`
    );
    console.log(`      "${String(c.r.title ?? '').replace(/\s+/g, ' ').slice(0, 110)}"`);
  }

  let written = 0;
  for (const c of changes) {
    if (apply) {
      const { error } = await supabaseAdmin
        .from('leads')
        .update({ venue_type: c.venue, development_category: c.category })
        .eq('id', c.r.id);
      if (error) {
        console.error(`  update failed for ${c.r.id}: ${error.message}`);
        continue;
      }
    }
    written++;
  }

  // ---- ROLL THE PROJECTS UP ----------------------------------------------
  const projectIds = [...new Set(changes.map((c) => c.r.project_id).filter(Boolean))] as string[];
  console.log(`\n${projectIds.length} project(s) hold a re-tagged record.`);
  if (projectIds.length) {
    const { rows: allLive } = await selectAllPaged<Row>(
      'leads',
      'id,project_id,venue_type',
      (q: unknown) => (q as { neq: (a: string, b: string) => unknown }).neq('status', 'dismissed'),
      'retag-golf-rollup'
    );
    const byProject = new Map<string, (string | null)[]>();
    for (const r of allLive) {
      const pid = r.project_id as string | null;
      if (!pid) continue;
      // The value we are ABOUT to write, for the rows in this change set.
      const change = changes.find((c) => c.r.id === r.id);
      const venue = change ? change.venue : ((r.venue_type as string | null) ?? null);
      if (!byProject.has(pid)) byProject.set(pid, []);
      byProject.get(pid)!.push(venue);
    }
    for (const pid of projectIds) {
      const venue = modeOf(byProject.get(pid) ?? []);
      const category = categoryForVenue(venue);
      const { data } = await supabaseAdmin
        .from('projects')
        .select('id,name,venue_type,development_category')
        .eq('id', pid)
        .single();
      const p = data as { name?: string; venue_type?: string | null; development_category?: string | null } | null;
      const same = (p?.venue_type ?? null) === venue && (p?.development_category ?? null) === category;
      console.log(
        `  ${same ? 'unchanged' : 'RE-DERIVED'}  ${p?.venue_type ?? 'null'} -> ${venue ?? 'null'} ` +
          `(${category ?? 'null'})  ${p?.name ?? pid}`
      );
      if (!same && apply) {
        const { error } = await supabaseAdmin
          .from('projects')
          .update({ venue_type: venue, development_category: category })
          .eq('id', pid);
        if (error) console.error(`  project update failed for ${pid}: ${error.message}`);
      }
    }
  }

  console.log(`\n${written} record(s) ${apply ? 'written' : 'would be written'}.`);
  if (!apply) console.log('Nothing was written. Re-run with RETAG_APPLY=1.');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
