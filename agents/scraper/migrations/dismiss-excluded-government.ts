// One-off repair: dismiss stored government records that the gate now excludes.
//
// GOV_GATE_EXCLUSIONS gained the procedural and fiscal terms measured across the
// live government corpus (closed session, the standing "any items from the
// planning commission" slot, budget appropriations limits, ballot measures and
// municipal elections). The gate change stops any of them being captured again;
// this removes the ones already stored.
//
// A GATE CHANGE IS A CODE EVENT, NOT A TIME EVENT, which is why this is a
// one-off rather than something wired into the run like the lifecycle sweep. It
// re-gates every stored government record against the CURRENT exclusion list, so
// running it after any future addition to that list repairs the corpus for that
// addition too.
//
// NOTHING IS DELETED. Dismissal is a status; the row stays readable in Trash and
// can be restored. A row Philip has touched - any status other than 'new', any
// notes, any manual_overrides - is never dismissed here; it is reported instead.
//
// Dismissed rows are detached from their project and every project's cached
// record_count is recomputed, or the register would show a number that disagrees
// with the rows behind it.
//
// Dry by default. GOV_DISMISS_APPLY=1 to write.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { governmentGate } from '../../../lib/taxonomy';
import { selectAllPaged } from '../page-select';
import { recountProjects, printRecount } from '../project-recount';

type Row = Record<string, unknown>;

function isCurated(r: Row): boolean {
  if (r.notes !== null && r.notes !== undefined && r.notes !== '') return true;
  const mo = r.manual_overrides;
  if (mo && typeof mo === 'object' && Object.keys(mo as object).length > 0) return true;
  return String(r.status ?? 'new') !== 'new';
}

async function main(): Promise<void> {
  const apply = process.env.GOV_DISMISS_APPLY === '1';

  const { rows, complete } = await selectAllPaged<Row>(
    'leads',
    'id,title,source,status,notes,manual_overrides,project_id',
    (q: unknown) => (q as { eq: (a: string, b: string) => unknown }).eq('stream', 'government'),
    'gov-dismiss'
  );
  if (!complete) throw new Error('read was partial; refusing to sweep a slice of the corpus.');

  const live = rows.filter((r) => String(r.status) !== 'dismissed');
  console.log('===== DISMISS NEWLY EXCLUDED GOVERNMENT RECORDS =====');
  console.log(apply ? '(GOV_DISMISS_APPLY=1: writing)' : '(dry run: set GOV_DISMISS_APPLY=1 to write)');
  console.log(`\nBEFORE: ${rows.length} government rows, ${live.length} of them live.`);

  const excluded = live.filter((r) => governmentGate(String(r.title ?? '')).reason === 'excluded');
  const curated = excluded.filter(isCurated);
  const toDismiss = excluded.filter((r) => !isCurated(r));

  console.log(`\nEVERY ROW THE GATE NOW EXCLUDES (${excluded.length}):`);
  for (const r of excluded) {
    const hits = governmentGate(String(r.title ?? '')).exclusionHits;
    console.log(
      `  ${String(r.id).slice(0, 8)}  ${String(r.source).padEnd(14)} proj=${r.project_id ? String(r.project_id).slice(0, 8) : '-       '} ` +
        `${isCurated(r) ? 'CURATED - LEFT ALONE' : 'dismiss'}\n` +
        `      [${hits.join(', ')}]\n` +
        `      "${String(r.title ?? '').replace(/\s+/g, ' ').slice(0, 100)}"`
    );
  }
  if (curated.length) {
    console.log(`\n${curated.length} of those carry curation and are LEFT ALONE. Decide by hand.`);
  }

  console.log(`\nPLAN: dismiss ${toDismiss.length}, leave ${curated.length} curated, ${live.length - excluded.length} unaffected.`);

  let dismissed = 0;
  for (const r of toDismiss) {
    if (apply) {
      const { error } = await supabaseAdmin
        .from('leads')
        .update({
          status: 'dismissed',
          status_changed_at: new Date().toISOString(),
          project_id: null,
          cluster_reason: null,
        })
        .eq('id', r.id);
      if (error) {
        console.error(`  dismissal failed for ${r.id}: ${error.message}`);
        continue;
      }
    }
    dismissed++;
  }

  console.log(`\nAFTER: ${dismissed} dismissed (not deleted; visible in Trash), ${live.length - dismissed} government records live.`);
  printRecount(await recountProjects(apply));
  if (!apply) console.log('\nNothing was written. Re-run with GOV_DISMISS_APPLY=1 to apply this plan.');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
