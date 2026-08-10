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
export const PROJECT_OWNED_BY_USER = ['status', 'notes', 'watch', 'manual_overrides'] as const;

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
] as const;

export interface ExistingProject {
  id: string;
  project_key: string;
  manual_overrides: Record<string, unknown> | null;
  name: string;
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
        'id,project_key,manual_overrides,name,stage,record_count,last_activity,' +
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
    country: c.country,
    region_state: c.region_state,
    market: c.market,
    stage: c.stage,
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
  };

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
  // first_seen is set once, on insert, and never moved backwards or forwards by
  // a later run: it records when WE first saw the project.
  if (!existing && c.first_seen) row.first_seen = c.first_seen;

  for (const c2 of PROJECT_OWNED_BY_USER) delete row[c2];

  const heldBack: string[] = [];
  const overridden = overriddenFields(existing?.manual_overrides);
  for (const f of overridden) {
    if (f in row) {
      delete row[f];
      heldBack.push(f);
    }
  }
  // Reported even though the pair was already removed above, so the run's
  // held-back tally still counts a protected summary. A silent hold looks
  // identical to a field the clusterer never tried to write.
  if (overridden.has('summary') && !heldBack.includes('summary')) heldBack.push('summary');
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
