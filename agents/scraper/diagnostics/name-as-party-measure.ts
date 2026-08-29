// READ-ONLY. HOW OFTEN DOES A PROJECT PRINT ITS OWN NAME AS A PARTY?
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/name-as-party-measure.ts
//
// Nothing is written. It calls the REAL buildParties, so what it counts is what
// a client document prints rather than what a column holds - the same reason
// party-gate-measure and depth-ranking cross into dashboard/lib. Excluded from
// the root tsconfig by name.
//
// THE QUESTION THIS ANSWERS IS "IS THERE A RULE HERE, OR A HAND-FIX".
//
// Bally's Bronx prints "Bally's Bronx - applicant" on a City Record notice: the
// matter's own name in the applicant column, printed as somebody to approach. It
// reads as a placeholder on the front page of a brief. But one project is not a
// rule, and a gate written for one row is a rule that will be wrong on the tenth.
// So this counts the shape across the whole live corpus before anything is
// proposed, and reports the column each instance arrives through - because a fix
// that belongs in nyc-city-record's capture is a different fix from one that
// belongs in the party layer.
//
// MATCHING IS DELIBERATELY LOOSE, IN THE DIRECTION THAT OVERCOUNTS. It compares
// on a normalised form - case, punctuation and corporate suffixes removed - and
// also reports the near-misses where one string contains the other. A rule would
// have to be tighter than this; a census should not be, because the cost of
// missing an instance is a wrong conclusion about whether a rule is needed at
// all.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { LIVE_PIPELINE_STORAGE_KEY } from '../pipelines';
import { inCorpusScope } from '../../../lib/corpus-scope';
import { buildParties } from '../../../dashboard/lib/people';
import type { Project, TimelineRecord } from '../../../dashboard/lib/projects';

const PROJECT_COLUMNS =
  'id,module,name,project_key,country,region_state,market,stage,development_category,' +
  'venue_type,status,watch,notes,manual_overrides,first_seen,last_activity,next_milestone,' +
  'record_count,primary_applicant,primary_representative,created_at,summary,summary_source,' +
  'summary_url,name_source,significance,significance_detail,significance_computed_at,' +
  'stage_press_reported';

const RECORD_COLUMNS =
  'id,title,url,source,source_type,published_date,deadline,first_seen,date_source,' +
  'cluster_reason,status,applicant,representative,presented_by,action_sought,' +
  'contact_name,contact_email,contact_phone,primary_document_url,project_id,market,stream,' +
  'applicant_type,press_facts,filing_facts';

async function pageAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

/** Case, punctuation and corporate suffixes off. Comparison only, never printed. */
function norm(s: string | null | undefined): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\b(llc|l\.l\.c|inc|incorporated|corp|corporation|company|co|ltd|limited|lp|l\.p|llp|plc)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Hit {
  project: string;
  market: string | null;
  party: string;
  roles: string[];
  kind: 'exact' | 'contains';
  /** Which stored column on which record produced this name. */
  columns: string[];
  /**
   * WHICH RULE NAMED THE PROJECT, AND IT IS THE WHOLE DISCRIMINATOR.
   *
   * A first pass counted 39 exact matches and would have concluded that a rule
   * was warranted. It is not: 'Nevada Palace' matches 'Nevada Palace, LLC' and
   * 'Costco Wholesale' matches 'Costco Wholesale Corporation' BECAUSE THE
   * PROJECT WAS NAMED AFTER ITS APPLICANT - name_source 'applicant' is the
   * second-ranked source in the naming model and is working exactly as designed.
   * Printing that applicant as a party is correct; it IS the applicant.
   *
   * The defect is the OTHER shape: a project named from a target, a source or a
   * title, whose applicant column happens to repeat the matter's name. Bally's
   * Bronx is that - named from a watched target, with the real applicant
   * (Ballys New York Operating Company, LLC) sitting on a different record.
   */
  nameSource: string | null;
  /** Does the project also carry a DIFFERENT applicant? The tell on Bally's. */
  otherApplicants: string[];
}

async function main(): Promise<void> {
  const projects = await pageAll<Project>('projects', PROJECT_COLUMNS);
  const live = projects
    .filter((p) => p.module === LIVE_PIPELINE_STORAGE_KEY)
    .filter((p) => p.status !== 'dismissed')
    .filter((p) => inCorpusScope(p.country))
    .filter((p) => p.stage !== 'dormant');

  const leads = await pageAll<TimelineRecord & { project_id: string | null }>('leads', RECORD_COLUMNS);
  const byProject = new Map<string, TimelineRecord[]>();
  for (const l of leads) {
    if (l.status === 'dismissed' || !l.project_id) continue;
    if (!byProject.has(l.project_id)) byProject.set(l.project_id, []);
    byProject.get(l.project_id)!.push(l);
  }

  const exact: Hit[] = [];
  const contains: Hit[] = [];

  for (const p of live) {
    const records = (byProject.get(p.id) ?? []).filter((r) => !!r.url);
    if (records.length === 0) continue;
    const pn = norm(p.name);
    if (!pn) continue;
    for (const party of buildParties(p, records)) {
      const qn = norm(party.name);
      if (!qn) continue;
      // WHICH COLUMN PRODUCED IT. Read back off the records rather than guessed,
      // because a fix for the applicant column is a different fix from one for
      // the presenter column and the difference decides where the work goes.
      const columns = new Set<string>();
      for (const r of records) {
        if (norm(r.applicant) === qn) columns.add(`applicant/${r.source ?? '?'}`);
        if (norm(r.representative) === qn) columns.add(`representative/${r.source ?? '?'}`);
        if (norm(r.presented_by) === qn) columns.add(`presented_by/${r.source ?? '?'}`);
        if (norm(r.contact_name) === qn) columns.add(`contact_name/${r.source ?? '?'}`);
      }
      const hit: Omit<Hit, 'kind'> = {
        project: p.name,
        market: p.market,
        party: party.name,
        roles: party.roles,
        columns: [...columns],
        nameSource: p.name_source,
        otherApplicants: [
          ...new Set(
            records
              .map((r) => String(r.applicant ?? '').trim())
              .filter((a) => a && norm(a) !== qn)
          ),
        ],
      };
      if (qn === pn) exact.push({ ...hit, kind: 'exact' });
      else if (pn.includes(qn) || qn.includes(pn)) contains.push({ ...hit, kind: 'contains' });
    }
  }

  const exactProjects = new Set(exact.map((h) => h.project));
  const containsProjects = new Set(contains.map((h) => h.project));

  console.log('='.repeat(100));
  console.log(`A PROJECT PRINTING ITS OWN NAME AS A PARTY   over ${live.length} live projects`);
  console.log('='.repeat(100));
  console.log(`  EXACT match after normalising:      ${exactProjects.size} project(s), ${exact.length} part(y/ies)`);
  console.log(`  one string CONTAINS the other:      ${containsProjects.size} project(s), ${contains.length} part(y/ies)`);
  console.log('');

  console.log('EXACT');
  if (exact.length === 0) console.log('  none');
  for (const h of exact) {
    console.log(
      `  ${h.project.slice(0, 40).padEnd(40)} ${String(h.market ?? '-').slice(0, 16).padEnd(16)} ` +
        `${h.party.slice(0, 34).padEnd(34)} ${h.roles.join(', ').padEnd(24)} ${h.columns.join(' ')}`
    );
  }

  console.log('');
  console.log('CONTAINS (reported, not counted as the same defect)');
  if (contains.length === 0) console.log('  none');
  for (const h of contains) {
    console.log(
      `  ${h.project.slice(0, 40).padEnd(40)} ${String(h.market ?? '-').slice(0, 16).padEnd(16)} ` +
        `${h.party.slice(0, 34).padEnd(34)} ${h.roles.join(', ').padEnd(24)} ${h.columns.join(' ')}`
    );
  }

  // ---- AND THE SPLIT THAT DECIDES IT ---------------------------------------
  const namedFromApplicant = exact.filter((h) => h.nameSource === 'applicant');
  const namedFromElsewhere = exact.filter((h) => h.nameSource !== 'applicant');

  console.log('');
  console.log('-'.repeat(100));
  console.log('SPLIT BY WHICH RULE NAMED THE PROJECT');
  console.log('-'.repeat(100));
  console.log(`  name_source = 'applicant'  ${namedFromApplicant.length}  EXPECTED, and correct: the`);
  console.log(`                                  project is named after its applicant, so the applicant`);
  console.log(`                                  matching the project name is the naming rule working.`);
  console.log(`  name_source = anything else ${namedFromElsewhere.length}  the shape worth looking at`);
  console.log('');
  for (const h of namedFromElsewhere) {
    console.log(`    ${h.project.slice(0, 38).padEnd(38)} name_source=${String(h.nameSource ?? 'null').padEnd(10)} ${String(h.market ?? '-').slice(0, 14).padEnd(14)} ${h.columns.join(' ')}`);
    console.log(`      party printed : ${h.party}`);
    console.log(`      other applicants on the project: ${h.otherApplicants.join(' | ') || '(none)'}`);
  }

  console.log('');
  console.log('-'.repeat(100));
  const n = new Set(namedFromElsewhere.map((h) => h.project)).size;
  console.log(
    n < 5
      ? `VERDICT: ${n} project(s) show the shape once the naming rule is accounted for. Below the ` +
        `five-project bar - a hand-fix, not a rule.`
      : `VERDICT: ${n} projects show the shape once the naming rule is accounted for. At or above the ` +
        `bar - a rule is warranted, and the column breakdown says where it goes.`
  );
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
