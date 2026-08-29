// THE PIPELINE REGISTRY, AND THE MODULE MAPPING, PROVED AGAINST LIVE DATA.
//
//   node --env-file=.env.local --import tsx agents/scraper/verify-pipelines.ts
//
// Reports what migration 024 WILL do before it is run, which is the only useful
// time to look at it: the mapping is the part that can be wrong, and a mapping
// with a hole in it is discovered halfway through a migration by a constraint
// violation rather than here.

import { pathToFileURL } from 'node:url';
import { selectAllPaged } from './page-select';
import {
  loadPipelines,
  printPipelines,
  pipelineIdForModule,
  MODULE_TO_PIPELINE,
  NULL_MODULE_PIPELINE,
  LEGACY_HOSPITALITY_KEY,
  LIVE_PIPELINE_STORAGE_KEY,
  TOLERATE_LEGACY_HOSPITALITY_KEY,
  hospitalityModuleValues,
} from './pipelines';
import { supabaseAdmin } from '../../lib/supabase-admin';

const TABLES = ['leads', 'projects', 'project_events'] as const;

async function main(): Promise<void> {
  console.log('===== PIPELINE REGISTRY =====');
  const registry = await loadPipelines(true);
  printPipelines(registry);

  let unmapped = 0;
  for (const table of TABLES) {
    const { rows, complete } = await selectAllPaged<{ module: string | null }>(
      table,
      'module',
      (q: unknown) => (q as { order: (c: string) => unknown }).order('id'),
      table
    );
    if (!complete) {
      console.error(`  ${table}: read incomplete; counts below are partial.`);
    }
    const before = new Map<string, number>();
    const after = new Map<string, number>();
    for (const r of rows) {
      const m = r.module ?? '(null)';
      before.set(m, (before.get(m) ?? 0) + 1);
      const p = pipelineIdForModule(r.module);
      after.set(p, (after.get(p) ?? 0) + 1);
      // A pipeline the registry does not contain would break the foreign key.
      if (!registry.has(p)) unmapped++;
    }
    console.log(`\n--- ${table}: ${rows.length} rows`);
    console.log('  BEFORE, by module:');
    for (const [m, n] of [...before].sort((a, b) => b[1] - a[1])) {
      const target = pipelineIdForModule(m === '(null)' ? null : m);
      const known = m === '(null)' || m in MODULE_TO_PIPELINE;
      console.log(
        `    ${String(n).padStart(5)}  ${m.padEnd(26)} -> ${target}${known ? '' : '   (NOT IN THE MAPPING)'}`
      );
    }
    console.log('  AFTER, by pipeline:');
    for (const [p, n] of [...after].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(5)}  ${p}${registry.has(p) ? '' : '   (NOT IN THE REGISTRY)'}`);
    }
  }

  console.log(
    `\nRows whose target pipeline is missing from the registry: ${unmapped}` +
      (unmapped === 0 ? '  (the foreign key in 024 will hold)' : '  <- 024 WOULD FAIL')
  );
  console.log(`Null modules map to: ${NULL_MODULE_PIPELINE}`);

  // ---- IS THE RENAME'S TOLERANCE STILL LOAD-BEARING? ----------------------
  //
  // STEP 5 IS THE ONE STEP OF THE RENAME THAT CAN EMPTY THE REGISTER. Removing
  // the tolerance scopes every reader to LIVE_PIPELINE_STORAGE_KEY alone, so
  // doing it while rows still carry the legacy value points the whole product at
  // a value no row holds - and an empty register does not look like a broken
  // deploy, it looks like a quiet week. That is the golden case
  // a-scope-and-its-corpus-under-two-names-returns-zero, and this is what makes
  // the readiness a MEASURED condition rather than a thing to remember.
  //
  // It does not fail the gate either way. Before migration 048 the tolerance is
  // doing its job; after it, the tolerance is merely redundant. Neither is a
  // regression, and a check that failed on the normal state of the world for a
  // week is a check that gets ignored.
  if (TOLERATE_LEGACY_HOSPITALITY_KEY) {
    let legacy = 0;
    for (const table of TABLES) {
      const { count, error } = await supabaseAdmin
        .from(table)
        .select('*', { count: 'exact', head: true })
        .eq('module', LEGACY_HOSPITALITY_KEY);
      if (error) throw new Error(`${table}: ${error.message}`);
      legacy += count ?? 0;
    }
    console.log('\nRENAME TOLERANCE: ON');
    console.log(`  writers emit module = '${LIVE_PIPELINE_STORAGE_KEY}'`);
    console.log(`  readers accept        ${hospitalityModuleValues().map((v) => `'${v}'`).join(' and ')}`);
    console.log(
      `  rows still carrying '${LEGACY_HOSPITALITY_KEY}': ${legacy}  ` +
        '(leads + projects + project_events, exact server-side counts, no cap)'
    );
    if (legacy > 0) {
      console.log('  STEP 5 IS BLOCKED. Migration 048 has not run, or has not finished.');
      console.log(
        `  Removing the tolerance now would scope every reader to '${LIVE_PIPELINE_STORAGE_KEY}' ` +
          `and hide ${legacy} rows.`
      );
    } else {
      console.log('  *** STEP 5 IS READY. No row carries the legacy value any more, so the');
      console.log('      tolerance in lib/pipeline-id.ts is redundant and can be deleted: remove');
      console.log('      TOLERATE_LEGACY_HOSPITALITY_KEY and the functions under it, and switch');
      console.log('      the .in() call sites back to .eq(). Gate after.');
    }
  } else {
    console.log('\nRENAME TOLERANCE: OFF. Step 5 is done.');
  }

  console.log('=============================\n');
  if (unmapped > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Pipeline verification failed:', err);
    process.exitCode = 1;
  });
}
