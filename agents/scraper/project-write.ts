// Writing projects to Supabase, with the curation layer intact.
//
// Shared by the backfill (migrations/backfill-projects.ts) and the write path
// (attach-on-write), so the two can never drift in what they protect.
//
// THE RULE, same as write-guard.ts enforces for leads: the clusterer must
// respect Philip's decisions permanently, or every correction he makes is undone
// by the next run.
//
//   OWNED COLUMNS. status, notes, watch and manual_overrides belong to Philip.
//   No clustering path writes them, on any row, ever. They are stripped from
//   every payload before it reaches the database, so a new caller cannot
//   reintroduce the bug by forgetting.
//
//   OVERRIDES. A field named in a project's manual_overrides is never
//   recomputed. A renamed project keeps its name; a hand-set stage keeps its
//   stage. This is what makes the register safe to curate.

import { supabaseAdmin } from '../../lib/supabase-admin';
import { LIVE_PIPELINE_STORAGE_KEY } from './pipelines';
import { overriddenFields } from './write-guard';
import type { ClusteredProject } from './cluster';

// Columns only Philip writes on a project. Stripped from every payload.
// manual_identifiers JOINS THIS LIST RATHER THAN manual_overrides, and the
// distinction is the whole reason it is a separate column. manual_overrides is a
// set of FIELD NAMES protecting values the clusterer also derives; a hand-supplied
// SCH or APN is a value the clusterer cannot derive at all, so there is nothing to
// protect it FROM except a careless payload. Being on this list is what makes a
// careless payload impossible. See migration 043.
export const PROJECT_OWNED_BY_USER = [
  'status', 'notes', 'watch', 'manual_overrides', 'manual_identifiers',
] as const;

// Columns a manual override can protect. These are the ones the register lets
// Philip set by hand.
export const PROJECT_OVERRIDABLE = [
  'name',
  'stage',
  'development_category',
  'venue_type',
  'market',
  'country',
  'region_state',
  // A hand-written summary is Philip's sentence about the project. Overriding it
  // holds back BOTH columns, because summary_source would otherwise be
  // recomputed to 'derived' while summary stayed 'manual' - see summaryPair.
  'summary',
  // A PINNED SCORE OUTRANKS THE MODEL PERMANENTLY. Philip's judgement about
  // what matters is the thing the model is trying to approximate, so where he
  // has stated it the model does not get a second opinion.
  'significance',
] as const;

export interface ExistingProject {
  id: string;
  project_key: string;
  manual_overrides: Record<string, unknown> | null;
  name: string;
  // CARRIED SO IT CAN BE WRITTEN BACK, not merely so it can be read. See the
  // hold loop below: a held field is now re-sent with its stored value, and a
  // value we do not have is a value we cannot re-send.
  name_source: string | null;
  stage: string | null;
  record_count: number | null;
  last_activity: string | null;
  // THE PRIOR VALUES CHANGE DETECTION COMPARES AGAINST. Added for project events
  // (migration 020): an event can only be emitted on a REAL change, and a real
  // change can only be recognised against what is currently stored. Without
  // these three the emitter would have to either re-read the table or emit on
  // every recompute, and the second is how an event log becomes noise.
  primary_applicant: string | null;
  primary_representative: string | null;
  next_milestone: string | null;
}

// Every stored project for a module, keyed by project_key.
export async function loadProjects(
  module = LIVE_PIPELINE_STORAGE_KEY
): Promise<Map<string, ExistingProject>> {
  const out = new Map<string, ExistingProject>();
  let from = 0;
  const PAGE = 500;
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from('projects')
      .select(
        'id,project_key,manual_overrides,name,name_source,stage,record_count,last_activity,' +
          'primary_applicant,primary_representative,next_milestone'
      )
      .eq('module', module)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`loadProjects: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const p of data as unknown as ExistingProject[]) out.set(p.project_key, p);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

// The database row for a clustered project, with the owned columns stripped and
// any manually overridden field held back.
export function projectRow(
  c: ClusteredProject,
  existing: ExistingProject | undefined,
  module = LIVE_PIPELINE_STORAGE_KEY
): { row: Record<string, unknown>; heldBack: string[] } {
  const row: Record<string, unknown> = {
    module,
    project_key: c.project_key,
    name: c.name,
    // Which rule produced the name. Computed on every run since naming was
    // written and dropped here every time, so all 319 projects reported null
    // and the register could not tell "OCVibe" from a cleaned agenda line.
    // Migration 032.
    name_source: c.name_source,
    country: c.country,
    region_state: c.region_state,
    market: c.market,
    stage: c.stage,
    // WHAT THE PRESS SAYS, WHERE IT RUNS AHEAD OF THE FILINGS. Migration 040.
    // Written unconditionally, null included, because null is the answer for
    // almost every project and a column that is only ever written when it has a
    // value cannot go back to having none. It follows `stage` and is NOT in
    // PROJECT_OVERRIDABLE: a hand-set stage is Philip's judgement about what our
    // filings support, and this is a statement about what somebody else said.
    stage_press_reported: c.stage_press_reported,
    development_category: c.development_category,
    venue_type: c.venue_type,
    last_activity: c.last_activity,
    next_milestone: c.next_milestone,
    record_count: c.record_count,
    primary_applicant: c.primary_applicant,
    primary_representative: c.primary_representative,
    summary: c.summary,
    summary_source: c.summary_source,
    summary_url: c.summary_url,
    significance: c.significance,
    significance_detail: c.significance_detail,
    significance_computed_at: new Date().toISOString(),
  };

  // The pin holds all three columns together: a held-back score beside a fresh
  // computed_at would claim the pinned number was recomputed just now.
  if (overriddenFields(existing?.manual_overrides).has('significance')) {
    delete row.significance;
    delete row.significance_detail;
    delete row.significance_computed_at;
  }

  // THE TWO SUMMARY COLUMNS MOVE TOGETHER OR NOT AT ALL. The table enforces
  // (summary is null) = (summary_source is null), so writing one without the
  // other is a constraint violation, and holding back only 'summary' on an
  // override would do exactly that. Both are dropped whenever either would be.
  const summaryHeld =
    overriddenFields(existing?.manual_overrides).has('summary') ||
    // A derivation that found nothing this run has LEARNED nothing - it has not
    // discovered that the stored sentence was wrong. Same rule as the enrichment
    // fields below: a generated summary must survive a clustering run that could
    // only derive null, or every backfill would be undone by the next scrape.
    row.summary === null;
  if (summaryHeld) {
    delete row.summary;
    delete row.summary_source;
    delete row.summary_url;
  }
  // THE TWO NAME COLUMNS MOVE TOGETHER TOO, and for the reason above rather
  // than for the constraint: name_source answers WHICH RULE PRODUCED THIS NAME,
  // so re-asserting it over a name the rules did not produce is a false answer.
  // 'name' was already held by manual_overrides below; name_source was not, so a
  // hand-renamed project reported the rule it had REPLACED on every run after.
  // RDXNWP became Spring Valley Ice Rink and the column went on saying
  // 'applicant', of a name no applicant field contains.
  //
  // Held here rather than added to PROJECT_OVERRIDABLE because Philip overrides
  // 'name'; name_source is this system's account of that name and follows it.
  if (overriddenFields(existing?.manual_overrides).has('name')) {
    // Re-sent rather than removed, for the reason in the hold loop below. It is
    // nullable, so removing it would not fail the write - but the two columns
    // are one fact and they move together or the account of the name drifts
    // from the name.
    if (existing && existing.name_source !== undefined) row.name_source = existing.name_source;
    else delete row.name_source;
  }

  // first_seen is set once, on insert, and never moved backwards or forwards by
  // a later run: it records when WE first saw the project.
  if (!existing && c.first_seen) row.first_seen = c.first_seen;

  for (const c2 of PROJECT_OWNED_BY_USER) delete row[c2];

  // A HELD FIELD IS RE-SENT WITH ITS STORED VALUE. IT IS NOT REMOVED.
  //
  // Removing it is what this did, and it made a hand-named project UNWRITABLE.
  // The write is `upsert(row, { onConflict: 'module,project_key' })`, and
  // Postgres validates the proposed INSERT row BEFORE it resolves the conflict:
  // projects.name is NOT NULL with no default, so a payload with no name failed
  // the constraint and the whole row was rejected. Not the name field - the ROW.
  // stage, record_count, last_activity and significance all failed with it.
  //
  //   project write failed (case:clark-county:uc-26-0302):
  //     null value in column "name" violates not-null constraint
  //
  // Spring Valley Ice Rink kept its hand-name through that run, and NOT because
  // the override worked: because the write failed entirely. The mechanism has
  // been broken for as long as it has existed and had nothing to exercise it -
  // no project carried a name override until 2026-08-19.
  //
  // Re-sending the stored value is identical on the UPDATE path, where it writes
  // what is already there, and valid on the INSERT path, where the column is
  // populated. Only `name` is NOT NULL among the overridable fields, but the
  // rule is written for all of them rather than special-cased for one: a column
  // that gains a NOT NULL later must not quietly reintroduce this.
  //
  // Where we hold no stored value the field is still removed - there is nothing
  // to re-send, and every such column is nullable.
  const heldBack: string[] = [];
  const overridden = overriddenFields(existing?.manual_overrides);
  const stored = existing as unknown as Record<string, unknown> | undefined;
  for (const f of overridden) {
    if (!(f in row)) continue;
    if (stored && stored[f] !== undefined) row[f] = stored[f];
    else delete row[f];
    heldBack.push(f);
  }
  // Reported even though the pair was already removed above, so the run's
  // held-back tally still counts a protected summary. A silent hold looks
  // identical to a field the clusterer never tried to write.
  if (overridden.has('summary') && !heldBack.includes('summary')) heldBack.push('summary');
  // Same reason as the summary line above: name_source was removed before the
  // override loop ran, so without this a held name_source is a silent hold, and
  // a silent hold reads exactly like a column the clusterer never tried to write.
  if (overridden.has('name') && !heldBack.includes('name_source')) heldBack.push('name_source');
  return { row, heldBack };
}

// A null enrichment value means this run learned nothing, not that the earlier
// run was wrong. Same principle as ENRICHMENT_FIELDS in write-guard: an
// applicant or representative we did not find must not erase one we did.
const PROJECT_ENRICHMENT = ['primary_applicant', 'primary_representative', 'next_milestone'] as const;

export function dropEmptyEnrichment(row: Record<string, unknown>): number {
  let dropped = 0;
  for (const f of PROJECT_ENRICHMENT) {
    if (f in row && (row[f] === null || row[f] === undefined)) {
      delete row[f];
      dropped++;
    }
  }
  return dropped;
}
