// WHAT THE LIVE PIPELINE IS CALLED. One copy, read by both packages.
//
// THE DEFECT THIS FILE EXISTS FOR. agents/scraper/pipelines.ts derived the
// storage key from the pipeline id through storageKeyFor(), so nothing on the
// agent side typed 'gli' as a literal. dashboard/lib/pipelines.ts:32 then
// declared its own:
//
//     export const LIVE_PIPELINE_STORAGE_KEY = 'gli';   // a literal, not derived
//
// Two packages, two declarations, no shared line of code - and only one of them
// deploys to Vercel. So the two halves could disagree about what the pipeline is
// called, and the half that disagreed would be the half that decides what a
// client sees: a register scoped to a key no row carries returns nothing, and
// nothing looks exactly like a quiet week.
//
// IMPORT-FREE ON PURPOSE, and at the root, so the dashboard may read it across
// the package split - the same rule and the same reason as lib/dead-feeds,
// lib/corpus-scope and lib/market-standard. It must stay import-free: a file the
// dashboard reaches for at the repo root resolves its dependencies out of a root
// node_modules that Vercel never creates.
//
// ---- THE ID AND THE STORED VALUE ------------------------------------------
//
// The pipeline's id is 'hospitality'. The value its rows carry in `module` is
// 'gli', because that is what the corpus was written with. Both are correct at
// once, which is why there are two constants here rather than one string used
// two ways.

/** The pipeline's identity. Stable. This is the name it is called by. */
export const HOSPITALITY_ID = 'hospitality';

/**
 * What hospitality rows carry in `module` today, before the data migration.
 * Named rather than typed, so the tolerance window and the flip are one edit
 * each and not a grep.
 */
export const LEGACY_HOSPITALITY_KEY = 'gli';

/**
 * The `module` value WRITTEN for the live pipeline.
 *
 * FLIPPED 2026-08-29, step 4 of the rename. It was LEGACY_HOSPITALITY_KEY. From
 * here on every writer emits the pipeline's own id and nothing writes 'gli'
 * again.
 *
 * SAFE IN EITHER ORDER RELATIVE TO THE DATA MIGRATION, and that is the entire
 * purpose of the tolerance window below: every reader accepts both values, so a
 * corpus that is half renamed reads correctly from either package with either
 * half deployed. That is what makes this step independent of migration 048
 * rather than blocked behind it. Step 5 - deleting the tolerance - is NOT
 * independent, and must not land until 048 has run.
 */
export const LIVE_PIPELINE_STORAGE_KEY: string = HOSPITALITY_ID;

/**
 * Which `module` value identifies this pipeline's rows.
 *
 * Now the identity function for every pipeline, which is what the original
 * shim's comment said would happen the moment the storage key equalled the id.
 * It is kept rather than deleted because ~41 files call it and its NAME is the
 * documentation: a caller that says storageKeyFor(id) is saying "the value the
 * rows carry", which stays a distinct question from "the pipeline's id" even
 * when the two answers agree.
 */
export function storageKeyFor(pipelineId: string): string {
  return pipelineId === HOSPITALITY_ID ? LIVE_PIPELINE_STORAGE_KEY : pipelineId;
}

// ---- THE TOLERANCE WINDOW -------------------------------------------------
//
// STEP 2 OF THE RENAME, AND THE REASON THE ORDER IS THE SAFETY ARGUMENT. Only
// the dashboard deploys to Vercel. Rename the data first and the register is
// empty until the next deploy lands - and an empty register does not look like
// a broken deploy, it looks like a quiet week.
//
// So for one release every READER accepts both values and every WRITER writes
// exactly one. After this the data may move at any moment without breaking
// either package, in either order, with either half deployed. Then the constant
// flips (step 4) and this block is deleted (step 5).
//
// TOLERANCE IS FOR READS ONLY. A writer that could emit either value is how a
// corpus ends up half-renamed with nothing to say which half is which.

/**
 * True for the length of the rename. Deleting this constant and the three
 * functions below IS step 5; nothing else has to change, because no caller
 * names either value.
 */
export const TOLERATE_LEGACY_HOSPITALITY_KEY = true;

/**
 * Every `module` value that means the live pipeline right now. One entry once
 * the tolerance is removed.
 */
export function hospitalityModuleValues(): string[] {
  return TOLERATE_LEGACY_HOSPITALITY_KEY
    ? [LEGACY_HOSPITALITY_KEY, HOSPITALITY_ID]
    : [LIVE_PIPELINE_STORAGE_KEY];
}

/** Does this stored `module` value belong to the live pipeline? */
export function isHospitalityModule(module: string | null | undefined): boolean {
  return !!module && hospitalityModuleValues().includes(module);
}

/**
 * The values to query for, given the module a caller asked for. Hospitality
 * expands to both; every other pipeline is itself, since only hospitality was
 * ever stored under a name that is not its id.
 *
 * Use with `.in('module', ...)`. An `.eq` here is the defect: it picks one of
 * the two and silently misses every row carrying the other.
 */
export function moduleQueryValues(module: string | null | undefined): string[] {
  if (!module) return hospitalityModuleValues();
  return isHospitalityModule(module) ? hospitalityModuleValues() : [module];
}

/** What a diagnostic should PRINT as the predicate it actually ran. */
export function moduleQueryPredicate(module?: string | null): string {
  const vs = moduleQueryValues(module);
  return vs.length === 1
    ? `module = '${vs[0]}'`
    : `module IN (${vs.map((v) => `'${v}'`).join(', ')})`;
}

/**
 * The PostgREST value list for excluding the live pipeline:
 * `.not('module', 'in', notHospitalityFilter())`.
 *
 * The inverse needs the tolerance as much as the positive does. A `.neq` on one
 * value leaves the other admitted, so during the window the legacy-pipeline
 * screen would start showing hospitality rows the moment the data moved - which
 * is not an empty register, it is a WRONG one, and nothing would report it.
 */
export function notHospitalityFilter(): string {
  return `(${hospitalityModuleValues().join(',')})`;
}
