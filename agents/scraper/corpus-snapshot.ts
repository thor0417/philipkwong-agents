// CORPUS SNAPSHOT. THE STATE OF THE REGISTER, AS A FILE.
//
//   npm run corpus:snapshot                    writes snapshots/corpus-<stamp>.json
//   npm run corpus:snapshot -- --label pre-run names it, for a before/after pair
//   npm run corpus:snapshot -- --stdout        also prints the JSON, for a pipe
//
// IT WRITES THE FILE ITSELF. That is the whole change from the first version,
// which printed JSON to stdout and relied on the caller remembering
// `> before.json`. A generator that PRINTS is not a generator that produced
// anything: the numbers this repo has been quoting - 146 live projects, 617 live
// records, fact reach 61 - existed only in console scrollback and in a throwaway
// script that was deleted afterwards. Standing rule 11: a thing is done when it
// exists on disk and has been read back.
//
// EVERY NUMBER CARRIES ITS PREDICATE. Three different "live" counts have been in
// evidence in one week - 267, 176, 146 - and every disagreement between them was
// a predicate nobody had written down. So each figure here is stored next to the
// exact filter that produces it, in the file, not in a comment.
//
// docs/ADDING-A-MARKET.md step 7 asks for per-market, per-source and per-stream
// counts before and after a scoped run, because the claim worth making is not
// "the run was scoped" but "every other market's count is identical". Those
// tallies are kept, and the pipe form still works: JSON goes to stdout only
// under --stdout, and every human line goes to stderr, so a redirect is never
// contaminated by a progress message.
//
// Counting happens client-side over a paged scan rather than through a grouped
// query, because PostgREST has no GROUP BY and the alternative is a database
// view this repo would then have to migrate.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { supabaseAdmin } from '../../lib/supabase-admin';
import { LIVE_PIPELINE_STORAGE_KEY } from './pipelines';
import { inCorpusScope, corpusScopeSentence } from '../../lib/corpus-scope';
import { attributionTerms, factsForEntry, type PressFact } from './press-facts';

const OUT_DIR = 'snapshots';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? (process.argv[i + 1] ?? null) : null;
};

// A figure and the filter that produces it, together. See the header: this pair
// is the point of the file.
interface Measured {
  count: number;
  predicate: string;
}
const measured = (count: number, predicate: string): Measured => ({ count, predicate });

interface LeadRow {
  id: string;
  project_id: string | null;
  status: string | null;
  lifecycle: string | null;
  source: string | null;
  stream: string | null;
  module: string | null;
  market: string | null;
  object_type: string | null;
  country: string | null;
  cluster_reason: string | null;
  press_facts: PressFact[] | null;
  filing_facts: { kind: string; display: string; line: string }[] | null;
}

interface ProjectRow {
  id: string;
  name: string;
  module: string | null;
  status: string | null;
  stage: string | null;
  market: string | null;
  country: string | null;
  primary_applicant: string | null;
}

// ---- THE POPULATION LADDER --------------------------------------------------
//
// THREE PROJECT COUNTS WERE QUOTED IN TWO DAYS: 218, 214 AND 146. Each was
// arithmetically correct for its own filter and none of them said what that
// filter was, so they read as a corpus that changed size overnight. Two of the
// three were also WRONG for what they claimed, and the reconciliation is what
// showed it:
//
//   218  module='gli' AND status<>'dismissed'
//        Correct, and it counts 80 dormant projects. It is the REGISTER, not
//        the live set.
//
//   214  ... AND country='United States'
//        WRONG. It drops the 4 projects whose country did not resolve, and
//        lib/corpus-scope is explicit that an unresolved country is not a
//        foreign one. One of the four is the Disney/CFTOD matter, which is in
//        Florida. Scope is inCorpusScope(country), never equality.
//
//   146  status NOT IN ('archived','deleted') AND stage<>'dormant'
//        WRONG, and quietly. Neither 'archived' nor 'deleted' is a value this
//        table holds - the statuses are 'new' and 'dismissed' - so that clause
//        removed nothing at all, and the one status that matters was not
//        filtered. 146 is 226 minus the 80 dormant and it COUNTS ALL 8
//        TOMBSTONED FOREIGN PROJECTS as live: Oman, Abu Dhabi, Egypt, Australia
//        twice, Malaysia, Dubai and Saudi Arabia. A headline figure for a
//        United States only system was carrying Jeddah.
//
// So each population is stored with its exact predicate, the delta to the one
// above it, and - where a project is in one and not another - the predicate
// that excluded it BY NAME. A figure that cannot say what it counted is the
// thing this file exists to stop, and a comment was not enough.
interface Population {
  name: string;
  predicate: string;
  count: number;
  /** Stated relative to the population above. One line, in words. */
  delta: string;
}

async function pageAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  let attempts = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) {
      // Supabase's edge intermittently returns "JWT issued at future" on the
      // sb_secret key path. Retry rather than abandoning the snapshot.
      if (/issued at future|JWT/i.test(error.message) && attempts < 5) {
        attempts++;
        await new Promise((r) => setTimeout(r, 800 * attempts));
        from -= PAGE;
        continue;
      }
      throw new Error(`${table}: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    out.push(...(data as unknown as T[]));
    if (data.length < PAGE) break;
  }
  return out;
}

function tally<T>(rows: T[], key: (r: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = key(r);
    out[k] = (out[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

// The entry's own rule for what counts as a printed fact, applied here so the
// snapshot measures what a DOCUMENT would carry rather than what is stored.
// case_planner is city staff and conditions get their own block; neither is a
// figure an entry prints.
const NOT_A_FIGURE = new Set(['case_planner', 'condition']);

async function main(): Promise<void> {
  const label = arg('label');
  const alsoStdout = process.argv.includes('--stdout');
  const note = (s: string): void => console.error(s);

  note('reading leads...');
  const leads = await pageAll<LeadRow>(
    'leads',
    'id,project_id,status,lifecycle,source,stream,module,market,object_type,country,' +
      'cluster_reason,press_facts,filing_facts'
  );
  note('reading projects...');
  const projects = await pageAll<ProjectRow>(
    'projects',
    'id,name,module,status,stage,market,country,primary_applicant'
  );

  // ---- THE THREE POPULATIONS, EACH WITH ITS FILTER -------------------------
  const liveLeads = leads.filter((l) => l.status !== 'dismissed' && l.lifecycle !== 'retired');

  // THE LIVE SET, CORRECTED. See the Population note above for what the three
  // quoted figures each counted and where two of them were wrong. Live means:
  // in the pipeline the register is for, not tombstoned, not dormant, and inside
  // the countries this system covers.
  const inPipeline = projects.filter((p) => p.module === LIVE_PIPELINE_STORAGE_KEY);
  const notDismissed = inPipeline.filter((p) => p.status !== 'dismissed');
  const inScope = notDismissed.filter((p) => inCorpusScope(p.country));
  const liveProjects = inScope.filter((p) => p.stage !== 'dormant');

  // The two historical predicates, recomputed here rather than remembered, so
  // the file states what each of them counts TODAY instead of what it counted
  // on the day somebody quoted it.
  const asQuoted218 = notDismissed.length;
  const asQuoted214 = notDismissed.filter((p) => p.country === 'United States').length;
  const asQuoted146 = projects.filter(
    (p) => p.status !== 'archived' && p.status !== 'deleted' && p.stage !== 'dormant'
  );
  // The projects the old 'live' predicate counted and this one does not, and why.
  const liveIds = new Set(liveProjects.map((p) => p.id));
  const countedButNotLive = asQuoted146
    .filter((p) => !liveIds.has(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      country: p.country,
      stage: p.stage,
      status: p.status,
      excludedBy:
        p.module !== LIVE_PIPELINE_STORAGE_KEY
          ? `module <> '${LIVE_PIPELINE_STORAGE_KEY}'`
          : p.status === 'dismissed'
            ? "status = 'dismissed' (tombstoned, and the old predicate named 'archived' and 'deleted', which this table never holds)"
            : !inCorpusScope(p.country)
              ? `country outside the corpus scope (${corpusScopeSentence()})`
              : "stage = 'dormant'",
    }));
  // And the reverse: live here, not counted by the old predicate. Dormancy is
  // the only way that happens, and it is stated rather than left to arithmetic.
  const quoted146Ids = new Set(asQuoted146.map((p) => p.id));
  const liveButNotCounted = liveProjects.filter((p) => !quoted146Ids.has(p.id)).length;

  const populations: Population[] = [
    {
      name: 'all',
      predicate: 'projects, no filter',
      count: projects.length,
      delta: 'every row in the table, tombstones and dormancy included.',
    },
    {
      name: 'inPipeline',
      predicate: `projects WHERE module = '${LIVE_PIPELINE_STORAGE_KEY}'`,
      count: inPipeline.length,
      delta: `${projects.length - inPipeline.length} row(s) belong to another pipeline and are not part of this register.`,
    },
    {
      name: 'register',
      predicate: `... AND status <> 'dismissed'`,
      count: notDismissed.length,
      delta:
        `${inPipeline.length - notDismissed.length} tombstoned project(s) removed. NOTHING IS DELETED, so they ` +
        `are still in the table and still readable; they are not part of the register.`,
    },
    {
      name: 'inScope',
      predicate: `... AND inCorpusScope(country)  (${corpusScopeSentence()})`,
      count: inScope.length,
      delta:
        `${notDismissed.length - inScope.length} project(s) resolve outside the covered countries. An ` +
        `UNRESOLVED country is not a foreign one and stays in: country = 'United States' would instead ` +
        `have dropped ${notDismissed.filter((p) => p.country !== 'United States').length}, including matters that are in the United States.`,
    },
    {
      name: 'live',
      predicate: `... AND stage <> 'dormant'`,
      count: liveProjects.length,
      delta:
        `${inScope.length - liveProjects.length} dormant project(s) removed: no filing for long enough that we no ` +
        `longer treat them as live. They remain on the register and are counted under 'register' above.`,
    },
  ];
  const projectById = new Map(projects.map((p) => [p.id, p]));

  // ---- FACT REACH, AGAINST THE LIVE SET -----------------------------------
  //
  // 119 of 267 was measured on status alone and counted 57 dormant projects
  // whose facts can never print. A client document draws on the live set, so
  // that is the denominator, and the file says so.
  const factsByProject = new Map<string, number>();
  for (const l of liveLeads) {
    if (!l.project_id) continue;
    const p = projectById.get(l.project_id);
    if (!p) continue;
    let n = 0;
    try {
      n += factsForEntry(
        (l.press_facts ?? []) as PressFact[],
        attributionTerms(p.name ?? '', p.primary_applicant ?? null)
      ).length;
    } catch {
      // A malformed stored fact must not take out the snapshot. Counted as zero
      // and visible as a lower reach rather than as a crash.
    }
    for (const f of l.filing_facts ?? []) {
      if (NOT_A_FIGURE.has(f.kind)) continue;
      if (!f.display || !f.line) continue;
      // The same quotability check the entry applies: a value that is not in the
      // line stored beside it does not print.
      if (!String(f.line).includes(String(f.display))) continue;
      n++;
    }
    if (n > 0) factsByProject.set(l.project_id, (factsByProject.get(l.project_id) ?? 0) + n);
  }
  const reached = liveProjects.filter((p) => (factsByProject.get(p.id) ?? 0) > 0);

  const snapshot = {
    takenAt: new Date().toISOString(),
    label: label ?? null,
    // WHAT THIS FILE IS FOR, in the file, so it is legible without the runbook.
    about:
      'The state of the register as one artefact. Every figure carries the predicate that ' +
      'produces it, because three different "live" counts have disagreed in one week and each ' +
      'disagreement was an unwritten filter.',
    projects: {
      all: measured(projects.length, 'projects, no filter'),
      live: measured(
        liveProjects.length,
        `projects WHERE module = '${LIVE_PIPELINE_STORAGE_KEY}' AND status <> 'dismissed' ` +
          `AND inCorpusScope(country) AND stage <> 'dormant'`
      ),
      dormant: measured(
        inScope.filter((p) => p.stage === 'dormant').length,
        `projects WHERE module = '${LIVE_PIPELINE_STORAGE_KEY}' AND status <> 'dismissed' ` +
          `AND inCorpusScope(country) AND stage = 'dormant'`
      ),
      // ---- WHY THE FIGURES DISAGREED ----------------------------------------
      //
      // Read this block before quoting any number above it. Each population is
      // a strict narrowing of the one before, its predicate is exact, and the
      // delta says what the step removed and why. See the Population note near
      // the top of this file for the three counts that made it necessary.
      populations,
      reconciliation: {
        about:
          'The counts quoted on 2026-08-18 and 2026-08-19, recomputed against the same data, so a ' +
          'reader can see which predicate produced each and which of them was wrong.',
        asQuoted: {
          register218: measured(
            asQuoted218,
            `projects WHERE module = '${LIVE_PIPELINE_STORAGE_KEY}' AND status <> 'dismissed'  ` +
              '-- CORRECT, and it is the register rather than the live set: it counts dormant projects.'
          ),
          unitedStates214: measured(
            asQuoted214,
            "... AND country = 'United States'  " +
              '-- WRONG. Equality drops every project whose country did not resolve, and an unresolved ' +
              'country is not a foreign one. Use inCorpusScope.'
          ),
          oldLive146: measured(
            asQuoted146.length,
            "projects WHERE status NOT IN ('archived','deleted') AND stage <> 'dormant'  " +
              "-- WRONG, and silently. This table holds no 'archived' or 'deleted' status, so that " +
              'clause removed nothing, and the status that does exist was not filtered. It counted ' +
              'every tombstoned out-of-scope project as live.'
          ),
        },
        // NAMED, NOT COUNTED. "Nothing is silently absent" applies to a
        // disagreement between two of our own figures as much as to a client
        // document: a reader who wants to know which project moved between two
        // counts can read its name here rather than re-deriving it.
        countedAsLiveButIsNot: {
          count: countedButNotLive.length,
          predicate: "in the old 'live' predicate and not in the corrected one",
          projects: countedButNotLive,
        },
        liveButMissedByTheOldPredicate: measured(
          liveButNotCounted,
          "live under the corrected predicate and absent from the old one (dormancy is the only route)"
        ),
      },
    },
    records: {
      all: measured(leads.length, 'leads, no filter'),
      live: measured(
        liveLeads.length,
        "leads WHERE status <> 'dismissed' AND lifecycle <> 'retired'"
      ),
      dismissed: measured(leads.filter((l) => l.status === 'dismissed').length, "leads WHERE status = 'dismissed'"),
      retiredSource: measured(
        leads.filter((l) => l.lifecycle === 'retired').length,
        "leads WHERE lifecycle = 'retired'  (kept, never deleted; see opportunity/RETIRED_SOURCES)"
      ),
      liveAttached: measured(
        liveLeads.filter((l) => l.project_id).length,
        'live AND project_id IS NOT NULL'
      ),
      // ---- UNATTACHED, SPLIT BY WHETHER THE CLUSTERER EVER SAW IT ---------
      //
      // ONE NUMBER HERE WAS A CONFLATION AND THE FILE CAUGHT IT. The first
      // version reported a single liveUnattached with the predicate "every one
      // carries an unclustered: reason", and reading the generated file back
      // showed 13 with none. Zero of the 13 were module 'gli'.
      //
      // The clusterer reads module = LIVE_PIPELINE_STORAGE_KEY and nothing else,
      // so a record in another module is not an orphan - it was never a
      // candidate. Counting the two together is the same mistake that made 657
      // look like the orphan count when the answer was 149.
      liveUnattachedInScope: measured(
        liveLeads.filter((l) => !l.project_id && l.module === LIVE_PIPELINE_STORAGE_KEY).length,
        `live AND project_id IS NULL AND module = '${LIVE_PIPELINE_STORAGE_KEY}'  ` +
          '(the clusterer considered these; every one carries an unclustered: reason)'
      ),
      liveUnattachedOtherModule: measured(
        liveLeads.filter((l) => !l.project_id && l.module !== LIVE_PIPELINE_STORAGE_KEY).length,
        `live AND project_id IS NULL AND module <> '${LIVE_PIPELINE_STORAGE_KEY}'  ` +
          '(outside the clusterer entirely: never considered, so correctly no reason)'
      ),
    },
    factReach: {
      projects: measured(reached.length, 'live projects carrying at least one printable fact'),
      denominator: liveProjects.length,
      percent: liveProjects.length ? Math.round((reached.length / liveProjects.length) * 100) : 0,
      predicate:
        'a live record on the project carries a press_fact surviving factsForEntry attribution, ' +
        'OR a filing_fact whose kind is not case_planner/condition and whose display appears in ' +
        'its stored line',
    },
    // Why each unattached record is unattached. Written by the clusterer; a
    // record considered and rejected leaves a reason rather than nothing.
    // Scoped to what the clusterer actually judged, for the same reason the two
    // counts above are split.
    unclustered: tally(
      liveLeads.filter((l) => !l.project_id && l.module === LIVE_PIPELINE_STORAGE_KEY),
      (l) => l.cluster_reason ?? '(no reason recorded)'
    ),
    // The runbook's before/after axes. Live only: a retired source's tally is
    // not a market's coverage.
    byMarket: tally(liveLeads, (l) => l.market ?? '(null)'),
    bySource: tally(liveLeads, (l) => l.source ?? '(null)'),
    byStream: tally(liveLeads, (l) => l.stream ?? '(null)'),
    byModule: tally(liveLeads, (l) => l.module ?? '(null)'),
    byObjectType: tally(liveLeads, (l) => l.object_type ?? '(null)'),
    // Named, not counted. A list of ids is a diff anyone can take; a count is
    // not. This is what made the geography and source writes separately
    // attributable rather than one combined delta.
    liveProjectIds: liveProjects
      .map((p) => ({
        id: p.id,
        name: p.name,
        market: p.market,
        country: p.country,
        records: liveLeads.filter((l) => l.project_id === p.id).length,
        facts: factsByProject.get(p.id) ?? 0,
      }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))),
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = snapshot.takenAt.replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(OUT_DIR, `corpus-${stamp}${label ? `-${label}` : ''}.json`);
  writeFileSync(file, JSON.stringify(snapshot, null, 2));

  note('');
  note(`  projects   all ${snapshot.projects.all.count}   live ${snapshot.projects.live.count}   dormant ${snapshot.projects.dormant.count}`);
  note(`  records    all ${snapshot.records.all.count}   live ${snapshot.records.live.count}   dismissed ${snapshot.records.dismissed.count}   retired ${snapshot.records.retiredSource.count}`);
  note(`  fact reach ${snapshot.factReach.projects.count} of ${snapshot.factReach.denominator}  (${snapshot.factReach.percent}%)`);
  note('');
  note(`written: ${file}`);

  // JSON to stdout only when asked, so a redirect is never contaminated by the
  // lines above.
  if (alsoStdout) console.log(JSON.stringify(snapshot, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
