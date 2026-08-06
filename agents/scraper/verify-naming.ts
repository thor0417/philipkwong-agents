// NAME MAINTENANCE ON WRITE, demonstrated rather than asserted.
//
//   node --env-file=.env.local --import tsx agents/scraper/verify-naming.ts
//
// THE CLAIM: when a project gains a record that would produce a better name - a
// target term where there was none, a named applicant where the project had only
// a title - the name improves. Unless Philip set it by hand, in which case
// nothing touches it, ever.
//
// WHY THIS IS ALREADY TRUE, and why it still needs a test. The name is not
// stored and patched; it is DERIVED from the project's current members on every
// run, by one function, through one priority order. The write path re-runs the
// same engine as the backfill (project-attach re-runs runBackfill rather than
// implementing a second matcher), so a project that gains a better-named record
// is re-derived with that record in it. Improvement is a consequence of the
// design rather than a feature bolted onto it.
//
// That is exactly why it needs a test. A property that holds by construction
// stops holding the moment someone caches the name "for performance", and the
// failure is silent: names simply stop improving and nobody notices for months.

import { pathToFileURL } from 'node:url';
import { clusterRecords, type ClusterRecord } from './cluster';
import { projectRow } from './project-write';

let pass = 0;
let fail = 0;

function check(label: string, got: unknown, expected: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}`);
  if (!ok) console.log(`       got=${JSON.stringify(got)} exp=${JSON.stringify(expected)}`);
}

// A minimal government record. Everything the clusterer needs and nothing else.
function rec(over: Partial<ClusterRecord> & { url: string }): ClusterRecord {
  return {
    market: 'Clark County',
    stream: 'government',
    source: 'legistar',
    status: 'new',
    venue_type: 'Resort',
    published_date: '2026-03-01',
    ...over,
  } as ClusterRecord;
}

function nameOf(records: ClusterRecord[]): { name: string; source: string } {
  const res = clusterRecords(records, { now: Date.parse('2026-08-03T00:00:00Z') });
  const p = res.projects[0];
  return { name: p?.name ?? '(no project)', source: p?.name_source ?? '(none)' };
}

function main(): void {
  console.log('===== NAME MAINTENANCE ON WRITE =====\n');

  // ---- 1. TITLE -> APPLICANT ------------------------------------------------
  // Two filings share a case root, so they are one project. Neither names an
  // applicant, so the project falls back to a cleaned title.
  const caseOnly = [
    rec({
      url: 'https://x/1',
      title: 'UC-26-0900-HOLDOVER USE PERMIT for a proposed hotel and casino on 12 acres',
    }),
    rec({
      url: 'https://x/2',
      title: 'UC-26-0900-USE PERMIT for a proposed hotel and casino on 12 acres, continued',
    }),
  ];
  const before1 = nameOf(caseOnly);
  console.log(`  before: [${before1.source}] ${before1.name}`);
  check('a project with no applicant is named from its title', before1.source, 'title');

  // The next run captures a third filing on the same case, and this one names
  // the applicant.
  const withApplicant = [
    ...caseOnly,
    rec({
      url: 'https://x/3',
      title: 'UC-26-0900-SUNSET BAY RESORTS, LLC: USE PERMIT first extension of time',
      applicant: 'SUNSET BAY RESORTS, LLC',
    }),
  ];
  const after1 = nameOf(withApplicant);
  console.log(`  after:  [${after1.source}] ${after1.name}`);
  check('gaining a named applicant improves the name', after1.source, 'applicant');
  check('and the name is the applicant plus the venue', after1.name, 'Sunset Bay Resorts resort');

  // ---- 2. APPLICANT -> TARGET ----------------------------------------------
  console.log('');
  const before2 = nameOf(withApplicant);
  const withTarget = [
    ...withApplicant,
    rec({
      url: 'https://x/4',
      title: 'UC-26-0900-KULIK RIVER CAPITAL, LLC: tentative map for the heart hotel site',
      applicant: 'KULIK RIVER CAPITAL, LLC',
    }),
  ];
  const after2 = nameOf(withTarget);
  console.log(`  before: [${before2.source}] ${before2.name}`);
  console.log(`  after:  [${after2.source}] ${after2.name}`);
  check('gaining a target term improves the name again', after2.source, 'target');
  check('and the target names the project', after2.name, 'Heart Hotel / Kulik River');

  // ---- 3. A MANUAL RENAME IS NEVER RECOMPUTED -------------------------------
  //
  // The improvement above is exactly what must NOT happen to a project Philip
  // has named himself. projectRow is the single gate every write goes through.
  console.log('');
  const res = clusterRecords(withTarget, { now: Date.parse('2026-08-03T00:00:00Z') });
  const clustered = res.projects[0];

  const renamed = {
    id: 'p1',
    project_key: clustered.project_key,
    name: "Philip's name for this",
    stage: clustered.stage,
    record_count: clustered.record_count,
    last_activity: clustered.last_activity,
    primary_applicant: null,
    primary_representative: null,
    next_milestone: null,
    manual_overrides: { name: true },
  };
  const held = projectRow(clustered, renamed);
  check('a hand-named project holds its name back', held.heldBack, ['name']);
  check('and the payload carries no name at all', 'name' in held.row, false);

  const notRenamed = { ...renamed, manual_overrides: null };
  const written = projectRow(clustered, notRenamed);
  check('a project with no override is renamed', written.row.name, clustered.name);

  // The four owned columns are never written by any clustering path.
  const owned = ['status', 'notes', 'watch', 'manual_overrides'].filter((c) => c in held.row);
  check('owned columns are never written', owned, []);

  // ---- 4. TWO PROJECTS CANNOT SHARE A NAME ----------------------------------
  //
  // Nashville's TIF resolutions, in miniature: one resolution per redevelopment
  // district, each opening with the same 77 characters, the district itself
  // past MAX_NAME. Three separate projects, three identical names.
  console.log('');
  const tif = (file: string, district: string): ClusterRecord =>
    rec({
      market: 'Nashville',
      url: `https://nashville.legistar.com/gateway.aspx?M=l&ID=${file}`,
      title: `A Resolution approving the activities and improvements eligible for tax increment financing in the ${district} Redevelopment Plan.`,
      raw_content: `Government record (Legistar Matter): Jurisdiction: Nashville, TN File: ${file} Type: Resolution`,
      venue_type: null,
      published_date: '2026-08-03',
    });
  const collide = clusterRecords(
    [tif('RS2026-2078', 'Arts Center'), tif('RS2026-2079', 'Bordeaux'), tif('RS2026-2083', 'Skyline')],
    { now: Date.parse('2026-08-03T00:00:00Z') }
  );
  for (const p of collide.projects) console.log(`  ${p.name}`);
  check('each resolution is its own project', collide.projects.length, 3);
  check('all three were renamed', collide.namesDisambiguated.length, 3);
  check('and no two names are equal', new Set(collide.projects.map((p) => p.name)).size, 3);
  check(
    'the suffix is the resolution number',
    [...collide.projects.map((p) => p.name)].sort()[0],
    'approving the activities and improvements eligible for tax (RS2026-2078)'
  );
  check('nothing is left colliding', collide.namesStillColliding, 0);

  // A NAME THAT IS ALREADY UNIQUE IS NOT TOUCHED. The suffix is a fix for a
  // collision, not a decoration applied to every row.
  const alone = clusterRecords([tif('RS2026-2078', 'Arts Center')], {
    now: Date.parse('2026-08-03T00:00:00Z'),
  });
  check('a unique name keeps its shape', alone.namesDisambiguated.length, 0);
  check(
    'and is the plain cleaned title',
    alone.projects[0].name,
    'approving the activities and improvements eligible for tax increment financing'
  );

  // AND A HAND-NAMED PROJECT IS STILL NEVER RENAMED. The disambiguation pass
  // runs inside the clusterer, upstream of the gate, so it cannot reach a
  // project Philip has named - projectRow strips the column either way.
  const collided = collide.projects[0];
  const heldToo = projectRow(collided, {
    id: 'p2',
    project_key: collided.project_key,
    name: 'Skyline TIF district',
    stage: collided.stage,
    record_count: collided.record_count,
    last_activity: collided.last_activity,
    primary_applicant: null,
    primary_representative: null,
    next_milestone: null,
    manual_overrides: { name: true },
  });
  check('a hand-named project is not disambiguated either', 'name' in heldToo.row, false);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
