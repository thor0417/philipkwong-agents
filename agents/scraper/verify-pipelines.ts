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
  LIVE_PIPELINE_STORAGE_KEY,
} from './pipelines';
import { PROFILES } from './profiles';

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

  // ---- ONE IDENTITY, ONE WRITER. THE industry COLUMN. ---------------------
  //
  // leads.industry has TWO writers for the live pipeline and they agreed only by
  // coincidence. gli.ts, government.ts and opportunity.ts each write
  // `industry: <lane>_MODULE`, derived from the shared key. The orchestrator
  // writes `industry: profile.name`, and profiles.ts named the hospitality
  // profile with the literal 'gli'. Both produced 'gli', so nothing showed -
  // until the constant flipped and the two would have started disagreeing down a
  // column nobody was watching.
  //
  // Exactly the shape of the dashboard hardcoding 'gli' while the agent side
  // derived it, one column over. So it gets a check rather than a fix and a
  // hope: for the live pipeline, industry and module are the same value, and a
  // profile that writes a different one fails the gate.
  const liveProfiles = PROFILES.filter((p) => p.module === LIVE_PIPELINE_STORAGE_KEY);
  console.log(`\nINDUSTRY AND MODULE ARE ONE IDENTITY for the live pipeline.`);
  if (liveProfiles.length === 0) {
    console.log('  no profile writes to the live pipeline, so nothing to check.');
  }
  for (const p of liveProfiles) {
    const ok = p.name === p.module;
    console.log(
      `  profile module='${p.module}' writes industry='${p.name}'  ${ok ? 'ok' : 'MISMATCH'}`
    );
    if (!ok) {
      console.log(
        `  FAIL: the orchestrator writes leads.industry from profile.name, and every lane\n` +
          `  writer derives it from the shared key. This profile would write '${p.name}' while\n` +
          `  gli.ts, government.ts and opportunity.ts write '${p.module}', splitting one\n` +
          `  identity across two values in a column nothing reconciles. Derive the name.`
      );
      process.exitCode = 1;
    }
  }

  // THE RENAME IS DONE. The block that used to live here counted rows still
  // carrying the legacy value and printed STEP 5 IS BLOCKED with the number, so
  // the readiness was a measurement rather than a thing to remember. It reported
  // 4,256 right up until migration 048 ran, and it is deleted with the tolerance
  // it was guarding. What replaces it is stronger and permanent: the check above
  // fails the gate if a writer ever names an identity instead of deriving it.

  console.log('=============================\n');
  if (unmapped > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Pipeline verification failed:', err);
    process.exitCode = 1;
  });
}
