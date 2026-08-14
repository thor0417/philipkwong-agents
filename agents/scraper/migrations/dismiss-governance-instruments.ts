// One-off repair: dismiss stored records that are governance instruments.
//
//   npm run dismiss:governance                      dry run
//   GOV_DISMISS_APPLY=1 npm run dismiss:governance  write
//
// A meeting, a budget ordinance and a tax levy are never projects, in any
// market. The gate now refuses them (lib/taxonomy, governanceExclusion); this
// removes the ones already stored.
//
// A GATE CHANGE IS A CODE EVENT, NOT A TIME EVENT, which is why this is a
// one-off rather than something wired into the run. Re-running it after any
// future change to the class repairs the corpus for that change too.
//
// NOTHING IS DELETED. Dismissal is a status; the row stays readable in Trash and
// can be restored. A row Philip has touched - any status other than 'new', any
// notes, any manual_overrides - is never dismissed here; it is reported instead.
//
// Dismissed rows are detached from their project and every project's cached
// record_count is recomputed, or the register would show a number that disagrees
// with the rows behind it. A project left holding zero live records becomes
// HOLLOW, which the report already excludes and already counts on its cover -
// so nothing disappears silently as a consequence of this.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { governanceExclusion, governmentGate } from '../../../lib/taxonomy';
import { selectAllPaged } from '../page-select';
import { recountProjects, printRecount } from '../project-recount';

type Row = Record<string, unknown>;

function isCurated(r: Row): boolean {
  if (r.notes !== null && r.notes !== undefined && r.notes !== '') return true;
  const mo = r.manual_overrides;
  if (mo && typeof mo === 'object' && Object.keys(mo as object).length > 0) return true;
  return String(r.status ?? 'new') !== 'new';
}

/**
 * The text the class judges.
 *
 * THE TITLE PLUS THE BODY, unlike dismiss-excluded-government, which judges the
 * title alone. The budget and levy limbs need the body: Yonkers names its
 * accounts and Oakland names its measures below the subject line, and it is
 * exactly there that the borrowed leisure noun sits. The meeting limb is
 * subject-scoped inside governanceLimb, so widening the text cannot make it
 * fire on a body mention.
 */
function judgedText(r: Row): string {
  return `${String(r.title ?? '')}\n${String(r.raw_content ?? '')}`;
}

async function main(): Promise<void> {
  const apply = process.env.GOV_DISMISS_APPLY === '1';

  const { rows, complete } = await selectAllPaged<Row>(
    'leads',
    'id,title,raw_content,source,market,status,notes,manual_overrides,project_id',
    (q: unknown) => (q as { eq: (a: string, b: string) => unknown }).eq('stream', 'government'),
    'gov-instrument-dismiss'
  );
  if (!complete) throw new Error('read was partial; refusing to sweep a slice of the corpus.');

  const live = rows.filter((r) => String(r.status) !== 'dismissed');
  console.log('===== DISMISS GOVERNANCE INSTRUMENTS =====');
  console.log(apply ? '(GOV_DISMISS_APPLY=1: writing)' : '(dry run: set GOV_DISMISS_APPLY=1 to write)');
  console.log(`\nBEFORE: ${rows.length} government rows, ${live.length} of them live.`);

  const hits = live
    .map((r) => {
      const text = judgedText(r);
      const strong = governmentGate(text, String(r.market ?? '')).strongHits;
      return { r, limb: governanceExclusion(text, strong) };
    })
    .filter((x): x is { r: Row; limb: NonNullable<typeof x.limb> } => !!x.limb);

  const curated = hits.filter((x) => isCurated(x.r));
  const toDismiss = hits.filter((x) => !isCurated(x.r));

  const byMarket = new Map<string, number>();
  const byLimb = new Map<string, number>();
  for (const x of hits) {
    const m = String(x.r.market ?? '(no market)');
    byMarket.set(m, (byMarket.get(m) ?? 0) + 1);
    byLimb.set(x.limb, (byLimb.get(x.limb) ?? 0) + 1);
  }
  console.log(`\nEVERY ROW THE CLASS NOW REFUSES (${hits.length}):`);
  for (const x of hits) {
    console.log(
      `  ${String(x.r.id).slice(0, 8)}  ${String(x.r.source).padEnd(16)} ${x.limb.padEnd(18)} ` +
        `proj=${x.r.project_id ? String(x.r.project_id).slice(0, 8) : '-       '} ` +
        `${isCurated(x.r) ? 'CURATED - LEFT ALONE' : 'dismiss'}\n` +
        `      "${String(x.r.title ?? '').replace(/\s+/g, ' ').slice(0, 110)}"`
    );
  }
  console.log('\nBY MARKET:');
  for (const [m, n] of [...byMarket.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${m}`);
  }
  console.log('BY LIMB:');
  for (const [l, n] of [...byLimb.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${l}`);
  }
  if (curated.length) {
    console.log(`\n${curated.length} of those carry curation and are LEFT ALONE. Decide by hand.`);
  }
  console.log(`\nPLAN: dismiss ${toDismiss.length}, leave ${curated.length} curated, ${live.length - hits.length} unaffected.`);

  let dismissed = 0;
  for (const x of toDismiss) {
    if (apply) {
      const { error } = await supabaseAdmin
        .from('leads')
        .update({
          status: 'dismissed',
          status_changed_at: new Date().toISOString(),
          project_id: null,
          cluster_reason: null,
        })
        .eq('id', x.r.id);
      if (error) {
        console.error(`  dismissal failed for ${x.r.id}: ${error.message}`);
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
