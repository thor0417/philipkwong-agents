// HOW MANY ROWS THE VALUE RENAME TOUCHES, PER TABLE, UNCAPPED.
//
// PIPELINE-IDENTITY-REPORT.md put it at 4,256 rows across leads, projects and
// project_events. This counts them again on the day the migration is printed,
// because a migration scoped on a stale count is a migration that reads back
// wrong. It also reads client_scopes.pipeline_id, which is the live mismatch:
// the scopes say 'hospitality' and the corpus says 'gli', in two tables that are
// joined to build a client document.
//
//     npm run diag:pipeline-values

import { supabaseAdmin } from '../../../lib/supabase-admin';
import {
  HOSPITALITY_ID,
  LEGACY_HOSPITALITY_KEY,
  LIVE_PIPELINE_STORAGE_KEY,
  hospitalityModuleValues,
  moduleQueryPredicate,
  TOLERATE_LEGACY_HOSPITALITY_KEY,
} from '../../../lib/pipeline-id';

async function countWhere(table: string, col: string, value: string | null): Promise<number> {
  const q = supabaseAdmin.from(table).select('*', { count: 'exact', head: true });
  const { count, error } = await (value === null ? q.is(col, null) : q.eq(col, value));
  if (error) throw new Error(`${table}.${col}: ${error.message}`);
  return count ?? 0;
}

async function total(table: string): Promise<number> {
  const { count, error } = await supabaseAdmin.from(table).select('*', { count: 'exact', head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

// Distinct values, paged rather than sampled: a distinct list from the first
// 1,000 rows is a fact about 1,000 rows.
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

async function main() {
  console.log('\nTHE VALUE RENAME, COUNTED. No cap: exact counts server-side, distincts paged.\n');
  let sum = 0;
  for (const t of MODULE_TABLES) {
    const legacy = await countWhere(t, 'module', LEGACY_HOSPITALITY_KEY);
    const already = await countWhere(t, 'module', HOSPITALITY_ID);
    const all = await total(t);
    sum += legacy;
    console.log(
      `  ${t.padEnd(15)} module='${LEGACY_HOSPITALITY_KEY}' ${String(legacy).padStart(6)}   module='${HOSPITALITY_ID}' ${String(already).padStart(6)}   table ${String(all).padStart(6)}`
    );
  }
  console.log(`\n  ROWS THE UPDATE TOUCHES: ${sum}\n`);

  for (const t of MODULE_TABLES) {
    const d = await distinct(t, 'module');
    const parts = [...d.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`);
    console.log(`  ${t}.module distinct: ${parts.join('   ')}`);
  }

  const scopes = await distinct('client_scopes', 'pipeline_id');
  console.log(
    `\n  client_scopes.pipeline_id distinct: ${[...scopes.entries()].map(([k, n]) => `${k} ${n}`).join('   ')}`
  );

  const { data: pipes } = await supabaseAdmin.from('pipelines').select('id,name,active').order('sort_order');
  console.log('\n  pipelines registry:');
  for (const p of (pipes ?? []) as { id: string; name: string; active: boolean }[]) {
    console.log(`    ${p.id.padEnd(14)} ${p.active ? 'active ' : 'retired'} ${p.name}`);
  }

  // THE MISMATCH, STATED AS A JOIN RATHER THAN AS TWO COLUMNS. This is the
  // hazard the golden case guards: a scope resolved against one identity over a
  // corpus stored under another returns zero and reads as a quiet week.
  const scopeIds = [...scopes.keys()].filter((k) => k !== '(null)');
  console.log('\n  WOULD A SCOPE FIND ITS CORPUS TODAY?');
  for (const id of scopeIds) {
    const hits = await countWhere('projects', 'module', id);
    console.log(
      `    scope pipeline_id='${id}' -> projects.module='${id}' matches ${hits}` +
        (hits === 0 ? '   <- ZERO, and the corpus is not empty' : '')
    );
  }

  // ---- AND WHETHER THE TOLERANCE ACTUALLY CLOSES THE GAP -------------------
  //
  // The point of step 2. The counts above say where the data IS; this says what
  // a reader SEES, which is the only question a client document asks. It must
  // hold whether or not migration 048 has run, and in either order relative to
  // the constant flip - that is what makes the two steps independent.
  console.log('\n  THE TOLERANCE, READ BACK AGAINST THE LIVE CORPUS');
  console.log(`    writers emit module = '${LIVE_PIPELINE_STORAGE_KEY}'`);
  console.log(`    readers accept       ${TOLERATE_LEGACY_HOSPITALITY_KEY ? hospitalityModuleValues().map((v) => `'${v}'`).join(' and ') : `'${LIVE_PIPELINE_STORAGE_KEY}' only`}`);
  console.log(`    predicate            ${moduleQueryPredicate(HOSPITALITY_ID)}`);
  let allSeen = true;
  for (const t of MODULE_TABLES) {
    const { count, error } = await supabaseAdmin
      .from(t)
      .select('*', { count: 'exact', head: true })
      .in('module', hospitalityModuleValues());
    if (error) throw new Error(`${t}: ${error.message}`);
    const legacy = await countWhere(t, 'module', LEGACY_HOSPITALITY_KEY);
    const renamed = await countWhere(t, 'module', HOSPITALITY_ID);
    const ok = (count ?? 0) === legacy + renamed && (count ?? 0) > 0;
    if (!ok) allSeen = false;
    console.log(
      `    ${t.padEnd(15)} a tolerant read sees ${String(count ?? 0).padStart(6)}` +
        `   (${legacy} legacy + ${renamed} renamed)   ${ok ? 'OK' : 'MISMATCH'}`
    );
  }

  // THE LIVE MISMATCH, ANSWERED. A scope resolves to a pipeline id; the corpus
  // is stored under a module value. Before this work those were two names and
  // the join returned zero over a register of 424 projects.
  console.log('\n  AND THE SCOPE-TO-CORPUS JOIN, THE HAZARD THIS WAS ABOUT');
  for (const id of scopeIds) {
    const strict = await countWhere('projects', 'module', id);
    const { count: tolerant } = await supabaseAdmin
      .from('projects')
      .select('*', { count: 'exact', head: true })
      .in('module', hospitalityModuleValues());
    console.log(
      `    scope pipeline_id='${id}'   strict .eq -> ${strict}` +
        `   tolerant .in -> ${tolerant ?? 0}` +
        (strict === 0 && (tolerant ?? 0) > 0
          ? '   <- the strict read is the empty register that reads as a quiet week'
          : '')
    );
  }
  console.log(`\n  ${allSeen ? 'PASS' : 'FAIL'}: every hospitality row is reachable through the tolerant predicate.`);
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
