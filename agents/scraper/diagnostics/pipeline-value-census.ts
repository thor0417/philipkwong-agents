// WHAT THE CORPUS SAYS THE PIPELINE IS CALLED. UNCAPPED.
//
//     npm run diag:pipeline-values
//
// WHY IT STILL EXISTS AFTER THE RENAME. It was written to count what migration
// 048 would touch: 4,256 rows across leads, projects and project_events, and the
// live mismatch behind them - client_scopes.pipeline_id reading 'hospitality'
// while the corpus read 'gli', in two tables that are joined to build a client
// document. 048 and 049 have run and that count is now zero.
//
// It is kept because the question it asks is permanent and the answer is not:
// "does every table agree on what this pipeline is called, and would a client
// scope find its corpus". A rename is not a thing that happens once - the moment
// a second vertical is real, quarantined 024 comes back and this is the census
// that costs it.
//
// NO CAP. Exact server-side counts, distincts paged. PostgREST's silent
// 1,000-row default would make every distinct list below a fact about the first
// thousand rows. Standing rule 13.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { HOSPITALITY_ID, LIVE_PIPELINE_STORAGE_KEY } from '../../../lib/pipeline-id';

// The value the corpus used to carry. Named here rather than imported, because
// lib/pipeline-id.ts no longer knows about it and should not: the rename is
// done, and this is the one place that still needs to ask about the old value.
const RETIRED_KEY = 'gli';

async function countWhere(table: string, col: string, value: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq(col, value);
  if (error) throw new Error(`${table}.${col}: ${error.message}`);
  return count ?? 0;
}

async function total(table: string): Promise<number> {
  const { count, error } = await supabaseAdmin.from(table).select('*', { count: 'exact', head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

async function distinct(table: string, col: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await supabaseAdmin.from(table).select(col).range(from, from + size - 1);
    if (error) throw new Error(`${table}.${col}: ${error.message}`);
    const rows = (data ?? []) as unknown as Record<string, string | null>[];
    for (const r of rows) {
      const k = r[col] ?? '(null)';
      out.set(k, (out.get(k) ?? 0) + 1);
    }
    if (rows.length < size) break;
  }
  return out;
}

const MODULE_TABLES = ['leads', 'projects', 'project_events'] as const;

async function main(): Promise<void> {
  let ok = true;

  console.log('\nWHAT EACH TABLE CALLS THE LIVE PIPELINE');
  console.log(`  code writes and reads module = '${LIVE_PIPELINE_STORAGE_KEY}'\n`);
  for (const t of MODULE_TABLES) {
    const live = await countWhere(t, 'module', LIVE_PIPELINE_STORAGE_KEY);
    const retired = await countWhere(t, 'module', RETIRED_KEY);
    const all = await total(t);
    if (retired !== 0 || live === 0) ok = false;
    console.log(
      `  ${t.padEnd(15)} '${LIVE_PIPELINE_STORAGE_KEY}' ${String(live).padStart(6)}   ` +
        `retired '${RETIRED_KEY}' ${String(retired).padStart(4)}   table ${String(all).padStart(6)}` +
        (retired === 0 ? '   ok' : '   <- STILL PRESENT')
    );
  }

  console.log('');
  for (const t of MODULE_TABLES) {
    const d = await distinct(t, 'module');
    const parts = [...d.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`);
    console.log(`  ${t}.module: ${parts.join('   ')}`);
  }

  // leads.industry is the fourth column, and it had its own writer disagreement:
  // three lanes derived it from the shared key and the orchestrator wrote a
  // profile-name literal. They agreed only while the literal and the key were
  // the same string. Counted here beside module, because that is the comparison
  // that would have shown it.
  const ind = await distinct('leads', 'industry');
  console.log(
    `\n  leads.industry: ${[...ind.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join('   ')}`
  );
  const indRetired = ind.get(RETIRED_KEY) ?? 0;
  if (indRetired !== 0) ok = false;
  console.log(`  industry still carrying '${RETIRED_KEY}': ${indRetired}${indRetired === 0 ? '   ok' : '   <- STILL PRESENT'}`);

  const { data: pipes } = await supabaseAdmin.from('pipelines').select('id,name,active').order('sort_order');
  console.log('\n  pipelines registry:');
  for (const p of (pipes ?? []) as { id: string; name: string; active: boolean }[]) {
    console.log(`    ${p.id.padEnd(14)} ${p.active ? 'active ' : 'retired'} ${p.name}`);
  }

  // ---- THE JOIN THIS WAS ALWAYS ABOUT --------------------------------------
  //
  // A scope resolves to a pipeline id and the corpus is stored under a module
  // value. When those were two names this returned zero over a register of 424,
  // and zero does not look like a bug, it looks like a quiet week.
  const scopes = await distinct('client_scopes', 'pipeline_id');
  console.log(
    `\n  client_scopes.pipeline_id: ${[...scopes.entries()].map(([k, n]) => `${k} ${n}`).join('   ')}`
  );
  console.log('\n  DOES A SCOPE FIND ITS CORPUS?');
  for (const id of [...scopes.keys()].filter((k) => k !== '(null)')) {
    const hits = await countWhere('projects', 'module', id);
    if (hits === 0) ok = false;
    console.log(
      `    scope pipeline_id='${id}'  ->  projects WHERE module = '${id}'  matches ${hits}` +
        (hits === 0 ? '   <- ZERO, and the corpus is not empty' : '')
    );
  }

  console.log(
    `\n  ${ok ? 'PASS' : 'FAIL'}: every table names the pipeline '${HOSPITALITY_ID}', ` +
      `nothing carries the retired value, and a scope finds its corpus.\n`
  );
  if (!ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
