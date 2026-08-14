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
import { cleanProjectTitle } from './project-naming';

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
  // THESE THREE ASSERTIONS WERE STALE AND THE SUITE HAS BEEN RED SINCE.
  //
  // They were written against the behaviour BEFORE instrumentSubject: all six
  // Nashville tax-increment resolutions cleaned to the same 77 characters of
  // opening clause, and the disambiguation pass appended each one's resolution
  // number to tell them apart. instrumentSubject then made the collision
  // impossible - each resolution is now named after the redevelopment plan it
  // funds - so the pass has nothing to disambiguate and correctly reports zero.
  //
  // The suite kept asserting the old strings, which is a test claiming a fix
  // did not happen. What matters is unchanged and is asserted below: three
  // resolutions, three distinct names, nothing left colliding.
  check('the disambiguation pass has nothing to do', collide.namesDisambiguated.length, 0);
  check('and no two names are equal', new Set(collide.projects.map((p) => p.name)).size, 3);
  check(
    'because each is named after its own redevelopment plan',
    [...collide.projects.map((p) => p.name)].sort(),
    ['Arts Center Redevelopment Plan', 'Bordeaux Redevelopment Plan', 'Skyline Redevelopment Plan']
  );
  check('nothing is left colliding', collide.namesStillColliding, 0);

  // A NAME THAT IS ALREADY UNIQUE IS NOT TOUCHED. The suffix is a fix for a
  // collision, not a decoration applied to every row.
  const alone = clusterRecords([tif('RS2026-2078', 'Arts Center')], {
    now: Date.parse('2026-08-03T00:00:00Z'),
  });
  check('a unique name keeps its shape', alone.namesDisambiguated.length, 0);
  check('and is the instrument subject', alone.projects[0].name, 'Arts Center Redevelopment Plan');

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

  // ---- WHERE A NAME COMES FROM, after the provisional-name pass ------------
  //
  // Each block below is one of the rules that took the provisional count from
  // 118 to 39. They are asserted on the ENGINE rather than on the helper
  // functions, because the question is not whether the helper works: it is
  // whether the helper is reached, in the right order, ahead of the applicant
  // and site rules that used to win.
  console.log('\n===== WHERE A NAME COMES FROM =====\n');

  // A SOURCE THAT PUBLISHES A PROJECT-NAME COLUMN OUTRANKS THE APPLICANT FIELD.
  // nyc-zap and nyc-ceqr read r.project_name; sfwmd reads a.PROJECT_NAME. An
  // applicant is who filed, and this is what the thing is called.
  const zap = nameOf([
    rec({
      market: 'New York City',
      source: 'nyc-zap',
      url: 'https://zap-api.planning.nyc.gov/projects/2024M0123',
      title: 'Museum of Chinese in America',
      applicant: 'Fulcrum Properties, LLC',
      raw_content: 'ULURP application for the Museum of Chinese in America.',
      venue_type: 'Museum',
    }),
  ]);
  console.log(`  ${zap.source}: ${zap.name}`);
  check('a ZAP project name beats the applicant', zap, {
    name: 'Museum of Chinese in America',
    source: 'source',
  });

  // AND THE PERMIT NUMBER THE ADAPTER APPENDED COMES OFF.
  const permit = nameOf([
    rec({
      market: 'Lake Buena Vista',
      source: 'sfwmd',
      url: 'https://sfwmd.gov/permit/231002-40619',
      title: "Disney's Fort Wilderness Cabin Improvements (231002-40619_48-109793-P)",
      applicant: 'Scott Justice',
      raw_content: 'Environmental resource permit application.',
      venue_type: null,
    }),
  ]);
  console.log(`  ${permit.source}: ${permit.name}`);
  check('the appended permit number is not part of the name', permit, {
    name: "Disney's Fort Wilderness Cabin Improvements",
    source: 'source',
  });

  // A TENDER IS NAMED AFTER THE PROGRAMME IT FUNDS, NOT AFTER THE ROLE IT HIRES.
  // "Senior Credit Officer" was a project name in the register.
  const tender = nameOf([
    rec({
      market: null,
      country: 'Lebanon',
      source: 'worldbank',
      stream: 'opportunity',
      url: 'https://projects.worldbank.org/notice/OP00345678',
      title: 'Senior Credit Officer',
      applicant: null,
      venue_type: null,
      raw_content:
        'Notice: Senior Credit Officer\nType: Request for Expression of Interest\n' +
        'Project: Lebanon Green Agrifood Transformation for Economic Recovery (GATE) [P180334]\n' +
        'Country: Lebanon\n',
    }),
  ]);
  console.log(`  ${tender.source}: ${tender.name}`);
  check('a tender is named after its programme', tender, {
    name: 'Lebanon Green Agrifood Transformation for Economic Recovery (GATE)',
    source: 'programme',
  });

  // AN INSTRUMENT LABEL AND A COUNCIL DISTRICT ARE NOT PART OF A NAME.
  //
  // Through the engine, because the interesting part is the ORDER: the record
  // does carry an applicant, and it is the applicant field that clusters these
  // two Phoenix records into one project. cleanApplicant refuses "Fire N Ice
  // Arena" - it carries no organisation marker - so the title rule is reached,
  // which is exactly the production shape.
  const liquor = nameOf([
    rec({
      market: 'Phoenix',
      source: 'legistar',
      url: 'https://phoenix.legistar.com/gateway.aspx?M=l&ID=99001',
      title: 'Liquor License - Fire N Ice Arena - District 2',
      applicant: 'Fire N Ice Arena',
      venue_type: 'Arena/Stadium',
      raw_content: 'Government record (Legistar Matter): Jurisdiction: Phoenix, AZ Type: Liquor License',
    }),
  ]);
  console.log(`  ${liquor.source}: ${liquor.name}`);
  check('the instrument and the district come off', liquor.name, 'Fire N Ice Arena');

  // A CLERK'S FIELD BLOCK IS CUT AT ITS FIRST FIELD. The Subject line is the
  // matter's name; From: is who filed it.
  //
  // Asserted on cleanProjectTitle rather than through the engine: this is a
  // cleaning rule with no ordering in it, and the Oakland matter clusters on a
  // case number whose rule is not what is under test here.
  const block = cleanProjectTitle(
    'Subject: \t2026 Miscellaneous Planning Code Amendments\n' +
      'From: \t\tPlanning And Building Department\n' +
      'Recommendation: Adopt An Ordinance As Recommended By The Planning Commission'
  );
  console.log(`  cleaned: ${block}`);
  check('a field block is cut at its first field', block, '2026 Miscellaneous Planning Code Amendments');

  // A CLERK'S FILING CODE IN FRONT OF A NAME COMES OFF; AN INITIALISM DOES NOT.
  console.log(`  cleaned: ${cleanProjectTitle('CBA-RP02A-3248-Ice Casino Improvements II')}`);
  check(
    'a bond-act account code is not a name',
    cleanProjectTitle('CBA-RP02A-3248-Ice Casino Improvements II'),
    'Ice Casino Improvements II'
  );
  check(
    'but a digitless initialism is left alone',
    cleanProjectTitle('RKO Keith Theater Redevelopment- 135-35 Northern Boulevard'),
    'RKO Keith Theater Redevelopment- 135-35 Northern Boulevard'
  );

  // A NAME THAT ALREADY SAYS WHAT IT IS DOES NOT SAY IT TWICE. This one is not
  // about the provisional set at all: it fixed four applicant-named projects
  // that read "Plaza Hotel & Casino casino" and "Gold Coast Railroad Museum
  // museum".
  const twice = nameOf([
    rec({
      market: 'Las Vegas',
      url: 'https://lasvegas.primegov.com/Portal/Meeting?meetingTemplateId=99003#item-1',
      title: 'Special use permit for a casino at the Plaza Hotel & Casino',
      applicant: 'Plaza Hotel & Casino, LLC',
      venue_type: 'Casino/Gaming',
      raw_content: 'A special use permit request for gaming at the Plaza Hotel & Casino.',
    }),
  ]);
  console.log(`  ${twice.source}: ${twice.name}`);
  check('the venue word is not repeated', twice.name, 'Plaza Hotel & Casino');

  // AND A NAME MUST NOT DEPEND ON QUERY ORDER. Two records, one date, two
  // titles: the same name whichever way round they arrive.
  const sameDay = (): ClusterRecord[] => [
    rec({
      url: 'https://clark.legistar.com/gateway.aspx?M=l&ID=99010',
      title: 'DR-26-0236-REFRIGERATION SUPPLIES DISTRIBUTOR: DESIGN REVIEW for a proposed office building',
      applicant: 'REFRIGERATION SUPPLIES DISTRIBUTOR',
      venue_type: null,
      published_date: '2026-06-16',
      raw_content: 'Government record: Clark County design review.',
    }),
    rec({
      url: 'https://clark.legistar.com/gateway.aspx?M=l&ID=99011',
      title: 'VS-26-0237-REFRIGERATION SUPPLIES DISTRIBUTOR: VACATE AND ABANDON a portion of a right-of-way',
      applicant: 'REFRIGERATION SUPPLIES DISTRIBUTOR',
      venue_type: null,
      published_date: '2026-06-16',
      raw_content: 'Government record: Clark County vacation.',
    }),
  ];
  const forward = nameOf(sameDay());
  const backward = nameOf(sameDay().reverse());
  console.log(`  forward:  ${forward.name}`);
  console.log(`  reversed: ${backward.name}`);
  check('record order does not change the name', forward.name, backward.name);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
