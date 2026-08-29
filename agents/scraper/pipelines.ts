// THE PIPELINE REGISTRY. One line of business per row (migration 021).
//
// WHAT WAS WRONG. `module` was a bare string and 'gli' was doing three jobs at
// once: naming the hospitality pipeline, sitting as the default in half a dozen
// function signatures, and standing alongside retired rows that nothing
// distinguished except convention. Scoping a query to a line of business was a
// string literal repeated across ~20 files, so "which pipeline is this?" could
// only be answered by grep, and retiring one meant editing code.
//
// ---- THE STORAGE KEY, which is the part that needs explaining ---------------
//
// The pipeline's ID is 'hospitality'. The value stored in leads.module and
// projects.module is 'gli'. Those are different strings, and both are correct:
// 'gli' is what ~1,400 existing rows carry, and rewriting them is a DATA
// migration that must be separate from, and reversible independently of, the
// schema and the code.
//
// So a pipeline carries both. Code scopes by `storageKey` and MEANS the
// pipeline; nothing anywhere types 'gli' as a literal any more. When migration
// 024 adds the foreign-keyed pipeline_id column and backfills it, storageKey
// becomes equal to id and this shim collapses to nothing - one line changes
// here instead of twenty across the tree.
//
// ---- THE MAPPING IS BIGGER THAN IT LOOKED -----------------------------------
//
// The brief assumed three modules. The corpus has TEN distinct values, measured:
//
//   gli 890, fuel 282, feasibility 100, general_consulting 29,
//   healthcare_pharma 26, null 23, financial_services 16, technology_ai 8,
//   signals 2, food_beverage_hospitality 1
//
// Six of those are consulting-era verticals from before the hospitality
// pipeline existed, and 23 rows carry no module at all (adzuna job postings and
// intake-agent emails that predate the column). A foreign key added naively
// would have failed on 204 rows. MODULE_TO_PIPELINE is that mapping, written
// down and applied by migration 024 rather than discovered by a constraint
// violation.

import { supabaseAdmin } from '../../lib/supabase-admin';
// THE IDENTITY ITSELF LIVES AT THE ROOT, IMPORT-FREE, so the dashboard reads the
// same copy across the package split. It used to be declared here AND again as a
// bare literal in dashboard/lib/pipelines.ts, which meant the two packages could
// disagree about the name of the thing a client's register is scoped to - and
// only the dashboard deploys to Vercel, so the disagreeing half would have been
// the one a client sees.
import {
  HOSPITALITY_ID,
  LIVE_PIPELINE_STORAGE_KEY,
  storageKeyFor,
} from '../../lib/pipeline-id';

export interface Pipeline {
  id: string;
  name: string;
  short_name: string;
  // NO brand_name, NO brand_logo. Both columns are DROPPED by migration 046.
  // They held a CLIENT's name and a CLIENT's logo on the row for the pipeline
  // that serves several of them, and dashboard/lib/brand.ts built every records
  // export's delivery line out of the first one. The publisher is the operator,
  // from lib/operator.ts, and it is not a per-pipeline setting.
  active: boolean;
  retired_reason: string | null;
  sort_order: number;
  // The value this pipeline's rows carry in the `module` column TODAY. Equal to
  // `id` for every pipeline except hospitality, whose rows say 'gli'.
  storageKey: string;
}

// The live pipeline. Named once, at lib/pipeline-id.ts, and re-exported here so
// the ~41 files that import it from this module keep working.
export {
  HOSPITALITY_ID,
  LIVE_PIPELINE_STORAGE_KEY,
  storageKeyFor,
};

// Historic module values -> pipeline id. Every distinct value in the corpus is
// listed, because a mapping with a hole in it is how a migration discovers a
// row it cannot place halfway through.
//
// The six consulting verticals collapse into `consulting`, which is exactly what
// that pipeline is called: they were the pre-hospitality practice areas, not
// separate businesses. The null rows go there too - they are adzuna job
// postings and intake-agent emails from before the column existed, and they
// belong to the consulting era by date and by content.
export const MODULE_TO_PIPELINE: Record<string, string> = {
  gli: HOSPITALITY_ID,
  fuel: 'fuel',
  signals: 'signals',
  feasibility: 'consulting',
  general_consulting: 'consulting',
  healthcare_pharma: 'consulting',
  financial_services: 'consulting',
  technology_ai: 'consulting',
  food_beverage_hospitality: 'consulting',
};

// Rows with no module at all.
export const NULL_MODULE_PIPELINE = 'consulting';

export function pipelineIdForModule(module: string | null | undefined): string {
  if (!module) return NULL_MODULE_PIPELINE;
  return MODULE_TO_PIPELINE[module] ?? NULL_MODULE_PIPELINE;
}


// ---- Loading ----------------------------------------------------------------

let cache: Map<string, Pipeline> | null = null;

// FALLBACK, and why it exists rather than throwing. Every scraper entry point
// scopes by pipeline, so a registry read failure would take the whole system
// down for a table that changes about once a year. The fallback is the live
// pipeline only, which fails CLOSED: a run continues against hospitality and
// cannot silently start writing to a retired pipeline.
const FALLBACK: Pipeline = {
  id: HOSPITALITY_ID,
  name: 'Hospitality and Entertainment',
  short_name: 'Hospitality',
  active: true,
  retired_reason: null,
  sort_order: 1,
  storageKey: LIVE_PIPELINE_STORAGE_KEY,
};

export async function loadPipelines(force = false): Promise<Map<string, Pipeline>> {
  if (cache && !force) return cache;
  const { data, error } = await supabaseAdmin
    .from('pipelines')
    .select('id,name,short_name,active,retired_reason,sort_order')
    .order('sort_order');
  if (error) {
    console.warn(`Pipelines: registry unreadable (${error.message.slice(0, 70)}); using the live pipeline only.`);
    cache = new Map([[FALLBACK.id, FALLBACK]]);
    return cache;
  }
  const out = new Map<string, Pipeline>();
  for (const row of (data ?? []) as Omit<Pipeline, 'storageKey'>[]) {
    out.set(row.id, { ...row, storageKey: storageKeyFor(row.id) });
  }
  if (out.size === 0) {
    console.warn('Pipelines: registry is empty; using the live pipeline only.');
    out.set(FALLBACK.id, FALLBACK);
  }
  cache = out;
  return out;
}

export async function getPipeline(id: string): Promise<Pipeline> {
  const all = await loadPipelines();
  return all.get(id) ?? FALLBACK;
}

export async function activePipelines(): Promise<Pipeline[]> {
  const all = await loadPipelines();
  return [...all.values()].filter((p) => p.active).sort((a, b) => a.sort_order - b.sort_order);
}

// THE SYNCHRONOUS ANSWER, re-exported above. Most call sites are deep inside a
// synchronous write path and cannot await a registry read, so the live
// pipeline's storage key is available without I/O. It is a constant because
// there is exactly one active pipeline; the moment there are two, every caller
// of this has to be given a pipeline explicitly, and that is the isolation
// test's first casualty.

// ---- Run scoping by pipeline ------------------------------------------------
//
// THE TYPO IS THE DANGEROUS CASE. `--pipeline=hospitaliy` must not quietly run
// everything: a scope filter that silently fails open is worse than no filter,
// because the operator believes the run was narrow and it was not. So an
// unregistered id is a hard error listing what IS registered, and it is checked
// against the registry rather than against a hardcoded list - which is the whole
// point of having a registry.
export async function assertKnownPipeline(scope: { pipeline: string | null }): Promise<void> {
  if (!scope.pipeline) return;
  const all = await loadPipelines();
  const p = all.get(scope.pipeline);
  if (!p) {
    throw new Error(
      `Unknown pipeline "${scope.pipeline}". Registered: ${[...all.keys()].sort().join(', ')}.`
    );
  }
  if (!p.active) {
    console.warn(
      `  NOTE: pipeline "${p.id}" is RETIRED (${p.retired_reason ?? 'no reason recorded'}). ` +
        'No lane writes to it, so this run will produce nothing.'
    );
  }
}

// Should a lane serving `servesPipeline` run under this scope? Skipping is
// reported by the caller, never silent.
export function laneInPipelineScope(
  scope: { pipeline: string | null },
  servesPipeline: string = HOSPITALITY_ID
): boolean {
  if (!scope.pipeline) return true;
  return scope.pipeline === servesPipeline;
}

export function printPipelines(all: Map<string, Pipeline>): void {
  console.log(`\nPipelines (${all.size} registered):`);
  for (const p of [...all.values()].sort((a, b) => a.sort_order - b.sort_order)) {
    const state = p.active ? 'ACTIVE  ' : 'retired ';
    const why = p.retired_reason ? `  (${p.retired_reason})` : '';
    const key = p.storageKey === p.id ? '' : `  [rows carry module '${p.storageKey}']`;
    console.log(`  ${state} ${p.id.padEnd(12)} ${p.name}${key}${why}`);
  }
}
