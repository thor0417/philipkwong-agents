// One-off repair: give the projects that share a name their own name.
//
// THE SYMPTOM. Six Nashville projects were called "approving the activities and
// improvements eligible for tax increment financing", listed one after another
// in the register, reading as one matter repeated rather than six separate
// redevelopment districts. Two Las Vegas projects had the same problem with a
// different opening phrase.
//
// THE CAUSE was not clustering: each of the six IS its own project, correctly
// keyed on its own resolution number. It was naming. Metro Council writes one
// resolution per redevelopment district and every one of them opens with the
// same 77 characters, so the only distinguishing words - the district - sit past
// MAX_NAME and were cut.
//
// THE FIX LIVES IN THE CLUSTERER (project-naming.disambiguateNames), which is
// what keeps the names distinct on every future run. This script exists only to
// move the rows already stored onto those names today, instead of waiting for
// the next scrape. It runs the same engine rather than a second implementation,
// so the two cannot disagree about what a project should be called.
//
// WHAT IT TOUCHES: the name column, on projects whose derived name collides with
// another project in the same market. Nothing else, on no other row.
//
// WHAT IT WILL NOT TOUCH: a project Philip has named by hand. The check is the
// same one projectRow makes - a 'name' entry in manual_overrides - and a project
// carrying it is reported and skipped. Status, notes, watch and manual_overrides
// are never written here at all.
//
// Dry by default. NAMES_APPLY=1 to write.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { LIVE_PIPELINE_STORAGE_KEY } from '../pipelines';
import { clusterRecords, type ClusterRecord } from '../cluster';
import { overriddenFields } from '../write-guard';
import { selectAllPaged } from '../page-select';

const MODULE = LIVE_PIPELINE_STORAGE_KEY;

const LEAD_COLUMNS =
  'id,url,title,raw_content,source,source_type,stream,status,lifecycle,object_type,' +
  'location,country,region_state,market,applicant,representative,presented_by,action_sought,' +
  'venue_type,development_category,published_date,deadline,milestone_date,first_seen,' +
  'date_source,project_id,cluster_reason';

interface StoredProject {
  id: string;
  project_key: string;
  name: string;
  market: string | null;
  manual_overrides: Record<string, unknown> | null;
}

export interface RenameReport {
  collisionsFound: number;
  renamed: { market: string | null; from: string; to: string; suffix: string }[];
  skippedManual: { market: string | null; name: string }[];
  notStored: number;
  alreadyCorrect: number;
  unresolved: number;
  failures: number;
}

export async function run(apply: boolean): Promise<RenameReport> {
  // A PARTIAL READ IS NOT A CORPUS. A collision is a property of the whole
  // project set: clustering half the leads would invent projects that do not
  // exist and miss collisions that do, and then rename rows on that basis. If
  // either read is incomplete this script does nothing at all.
  const leadPage = await selectAllPaged<ClusterRecord>(
    'leads',
    LEAD_COLUMNS,
    (q) => (q as { eq: (a: string, b: string) => { order: (c: string) => unknown } }).eq('module', MODULE).order('id'),
    'disambiguate: leads'
  );
  const projectPage = await selectAllPaged<StoredProject>(
    'projects',
    'id,project_key,name,market,manual_overrides',
    (q) => (q as { eq: (a: string, b: string) => unknown }).eq('module', MODULE),
    'disambiguate: projects'
  );
  if (!leadPage.complete || !projectPage.complete) {
    throw new Error('disambiguate: a paged read was incomplete; refusing to rename on a partial corpus.');
  }

  const cluster = clusterRecords(leadPage.rows);

  const stored = new Map<string, StoredProject>();
  for (const p of projectPage.rows) stored.set(p.project_key, p);

  const report: RenameReport = {
    collisionsFound: cluster.namesDisambiguated.length,
    renamed: [],
    skippedManual: [],
    notStored: 0,
    alreadyCorrect: 0,
    unresolved: cluster.namesStillColliding,
    failures: 0,
  };

  // Keyed on project_key, never on the report's index: the clusterer re-sorts
  // its projects by record count after the naming pass, so the index in the
  // report is a handle into an array that no longer exists in that order.
  for (const d of cluster.namesDisambiguated) {
    const row = stored.get(d.project_key);
    if (!row) {
      // A project the clusterer computes but the table does not hold yet. It
      // will be written with the right name the first time it is stored.
      report.notStored++;
      continue;
    }
    if (overriddenFields(row.manual_overrides).has('name')) {
      report.skippedManual.push({ market: row.market, name: row.name });
      continue;
    }
    if (row.name === d.to) {
      report.alreadyCorrect++;
      continue;
    }
    report.renamed.push({ market: row.market, from: row.name, to: d.to, suffix: d.suffix });
    if (!apply) continue;
    const { error } = await supabaseAdmin.from('projects').update({ name: d.to }).eq('id', row.id);
    if (error) {
      console.error(`  update failed for ${row.id}: ${error.message}`);
      report.failures++;
    }
  }

  return report;
}

function print(report: RenameReport, apply: boolean): void {
  console.log('===== PROJECT NAME DISAMBIGUATION =====\n');
  console.log(`colliding names found:      ${report.collisionsFound}`);
  console.log(`renamed:                    ${report.renamed.length}`);
  console.log(`skipped (named by hand):    ${report.skippedManual.length}`);
  console.log(`already correct:            ${report.alreadyCorrect}`);
  console.log(`not stored yet:             ${report.notStored}`);
  console.log(`collisions left unresolved: ${report.unresolved}`);
  if (report.failures) console.log(`WRITE FAILURES:             ${report.failures}`);

  const byMarket = new Map<string, number>();
  for (const r of report.renamed) {
    const m = r.market ?? '(no market)';
    byMarket.set(m, (byMarket.get(m) ?? 0) + 1);
  }
  console.log('\n-- by market --');
  for (const [m, n] of [...byMarket].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${m}`);
  }

  console.log('\n-- before / after --');
  for (const r of report.renamed) {
    console.log(`\n  ${r.market}`);
    console.log(`  before: ${r.from}`);
    console.log(`  after:  ${r.to}`);
  }

  console.log('\n-- named by hand, left alone --');
  if (report.skippedManual.length === 0) console.log('  none.');
  for (const s of report.skippedManual) console.log(`  ${s.market} | ${s.name}`);

  if (!apply) console.log('\nNothing was written. Re-run with NAMES_APPLY=1 to apply this plan.');
}

async function main(): Promise<void> {
  const apply = process.env.NAMES_APPLY === '1';
  print(await run(apply), apply);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
