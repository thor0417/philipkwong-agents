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
 * The `module` value written and read for the live pipeline.
 *
 * IT IS THE PIPELINE'S OWN ID NOW. It was the literal 'gli' for as long as the
 * corpus was, and the whole five-step rename existed to make those two the same
 * string. Migration 048 moved the 4,256 rows on 2026-08-29 and 049 followed for
 * leads.industry; nothing writes or reads 'gli' anywhere any more.
 *
 * The value is kept as its own constant rather than collapsed into
 * HOSPITALITY_ID, because "the pipeline's identity" and "the value its rows
 * carry" stay two different questions even when the answers agree. That they
 * disagreed is what cost this rename; that they can disagree again is why the
 * distinction is still named.
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

// ---- THE TOLERANCE WINDOW IS CLOSED --------------------------------------
//
// STEP 5, 2026-08-29. Between step 2 and here, every reader accepted BOTH 'gli'
// and 'hospitality' through hospitalityModuleValues(), isHospitalityModule(),
// moduleQueryValues() and notHospitalityFilter(), so the data could move at any
// moment without breaking either package. Migration 048 moved it: 4,256 rows
// across leads, projects and project_events, read back at zero remaining and
// 4,261 carrying the new value, the extra five written after the flip by writers
// that now emit it. 049 followed for leads.industry.
//
// The four functions and LEGACY_HOSPITALITY_KEY are DELETED rather than left
// returning one value, and every call site is a plain equality again. A helper
// that still says "values", plural, is an invitation to add a second one.
//
// WHAT THE WINDOW ACTUALLY CAUGHT, and it is the reason to write this down.
// Step 2's sweep replaced the literal call sites and MISSED five read paths that
// take the key as a PARAMETER and compare it strictly further down:
// use-period.ts:88, companies.ts:304 and :326, coverage-query.ts:162 and :169,
// project-event-queries.ts:94 and :206, and query.ts:113. So "every reader
// accepts both values" was not true, and with the constant flipped and the data
// not yet moved, three Playwright tests went red on an empty register and an
// empty players screen. The gate found what the grep did not. Those paths are
// correct again now for the same reason everything else is: there is one value.

