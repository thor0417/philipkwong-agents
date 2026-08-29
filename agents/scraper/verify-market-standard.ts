// IS EVERY MARKET AT STANDARD, AND DOES THE DECLARATION STILL DESCRIBE THE
// CORPUS?
//
//   npm run verify:market-standard
//
// Brief T item 4. Nothing defined what "covered" meant, so a market got added
// when its records arrived rather than when it reached a standard, and nobody
// noticed for three weeks that fifteen referral-ready projects were all one
// county. This is the thing that would have noticed.
//
// A MARKET BELOW STANDARD DOES NOT FAIL THIS CHECK. It is reported with what it
// is missing, because most markets are below standard today and a check that is
// red by design is a check nobody reads. What fails it is the DECLARATION in
// lib/market-standard drifting away from the corpus, reconciled BOTH WAYS the
// way verify-coverage-table reconciles the covered-markets table:
//
//   declared and not met   a market on MARKETS_AT_STANDARD that no longer
//                          clears all four. A reader stopped working, a source
//                          went quiet, or a gate change took the evidence out.
//   met and not declared   a market clearing all four that nobody declared.
//                          Good news, and still a drift: the coverage note a
//                          client document prints is driven off the declaration,
//                          so an undeclared market is one whose documents say
//                          they cannot go deeper while they can.
//
// IT CALLS THE REAL buildEntry, out of dashboard/lib, for the same reason
// depth-ranking and holdings-judgement do: the four criteria are properties of
// what an entry PRINTS. Counting filing_facts rows would count facts the entry
// dedupes, caps, or refuses for failing the quotation check, and the number
// would then describe something no client ever sees. That is an agents ->
// dashboard crossing: command line only, excluded from the root tsconfig BY
// NAME. See CLAUDE.md on the asymmetry.
//
// NO CAP ANYWHERE. Projects and leads are paged to exhaustion rather than taking
// PostgREST's silent default of 1000, and entries are built at the referral
// brief's cap of 500 rather than the market report's eight. Standing rule 13:
// where a capped figure decides a pass or a fail, the cap comes off.
import { supabaseAdmin } from '../../lib/supabase-admin';
import { HOSPITALITY_ID, LIVE_PIPELINE_STORAGE_KEY } from './pipelines';
import { inCorpusScope } from '../../lib/corpus-scope';
import {
  DECISION_FACT_KINDS,
  SCHEME_FACT_KINDS,
  MARKETS_AT_STANDARD,
  STANDARD_CRITERIA,
  criteriaFor,
  conditionsApply,
  meetsStandard,
  type ProjectStandard,
  type StandardCriterion,
} from '../../lib/market-standard';
import { buildEntry } from '../../dashboard/lib/report-entry';
import type { Project, TimelineRecord } from '../../dashboard/lib/projects';

const PROJECT_COLUMNS =
  'id,module,name,project_key,country,region_state,market,stage,development_category,' +
  'venue_type,status,watch,notes,manual_overrides,first_seen,last_activity,next_milestone,' +
  'record_count,primary_applicant,primary_representative,created_at,summary,summary_source,' +
  'summary_url,name_source,significance,significance_detail,significance_computed_at';

const RECORD_COLUMNS =
  'id,title,url,source,source_type,published_date,deadline,first_seen,date_source,' +
  'cluster_reason,status,applicant,representative,presented_by,action_sought,' +
  'contact_name,contact_email,contact_phone,primary_document_url,project_id,market,stream,' +
  'applicant_type,press_facts,filing_facts';

async function pageAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(table + ': ' + error.message);
    if (!data?.length) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

interface MarketRow {
  market: string;
  projects: number;
  party: number;
  facts: number;
  conditions: number;
  decision: number;
  all: number;
}

async function main(): Promise<void> {
  console.log('===== IS EVERY MARKET AT STANDARD? =====');
  console.log('');

  const projects = await pageAll<Project>('projects', PROJECT_COLUMNS);
  const live = projects
    .filter((p) => p.module === LIVE_PIPELINE_STORAGE_KEY)
    .filter((p) => p.status !== 'dismissed')
    .filter((p) => inCorpusScope(p.country))
    .filter((p) => p.stage !== 'dormant' && p.stage !== 'archived');

  const leads = await pageAll<TimelineRecord & { project_id: string | null }>('leads', RECORD_COLUMNS);
  const byProject = new Map<string, TimelineRecord[]>();
  for (const l of leads) {
    if (l.status === 'dismissed' || !l.project_id) continue;
    if (!byProject.has(l.project_id)) byProject.set(l.project_id, []);
    byProject.get(l.project_id)!.push(l);
  }

  console.log(
    'read ' + projects.length + ' projects and ' + leads.length +
    ' records, both paged to exhaustion, no cap. Entries built at cap 500.'
  );
  // THE PREDICATE PRINTED IS THE PREDICATE RUN. It said module=gli while the
  // query had become tolerant of both names, which is the same label-read-as-
  // the-thing-it-names shape the rename exists to close.
  console.log('live population ' + live.length + ': ' + `module = '${LIVE_PIPELINE_STORAGE_KEY}'` + ', status<>dismissed, in corpus scope, stage not dormant or archived');
  console.log('');

  const rows = new Map<string, MarketRow>();
  const row = (m: string): MarketRow => {
    if (!rows.has(m)) {
      rows.set(m, { market: m, projects: 0, party: 0, facts: 0, conditions: 0, decision: 0, all: 0 });
    }
    return rows.get(m)!;
  };

  let noEntry = 0;
  for (const p of live) {
    const records = byProject.get(p.id) ?? [];
    const built = buildEntry(p, records, { partyRecords: records, cap: 500 });
    const m = p.market ?? '(no market)';
    const r = row(m);
    r.projects++;
    if (!built) {
      noEntry++;
      continue;
    }
    const e = built.entry;
    const stated = e.stated ?? [];
    const carries: ProjectStandard = {
      party: (e.people ?? []).length > 0,
      facts: stated.some((f) => SCHEME_FACT_KINDS.has(f.kind)),
      conditions: e.conditions.some((s) => s.conditions.length > 0),
      decision: stated.some((f) => DECISION_FACT_KINDS.has(f.kind)),
    };
    for (const c of STANDARD_CRITERIA) if (carries[c]) r[c]++;
    if (meetsStandard(m, carries)) r.all++;
  }

  const ordered = [...rows.values()].sort((a, b) => b.projects - a.projects);
  const pad = Math.max(26, ...ordered.map((r) => r.market.length + 1));
  console.log(
    'market'.padEnd(pad) + 'live'.padStart(6) + 'party'.padStart(7) + 'facts'.padStart(7) +
    'conds'.padStart(7) + 'decis'.padStart(7) + 'ALL 4'.padStart(7) + '   verdict'
  );
  console.log('-'.repeat(pad + 50));
  for (const r of ordered) {
    const declared = MARKETS_AT_STANDARD.includes(r.market);
    const met = r.all > 0;
    // ASKED OF THIS MARKET, not asked of every market. Conditions are put to a
    // market only where the market publishes them per project - probed, not
    // assumed - so a market that does not is not failing on them and must not
    // read as though it were.
    const asked = criteriaFor(r.market);
    const missing: StandardCriterion[] = asked.filter((c) => r[c] === 0);
    const suffix = conditionsApply(r.market) ? '' : ' [no conditions published here]';
    const verdict = met
      ? (declared ? 'AT STANDARD' : 'AT STANDARD, NOT DECLARED') + suffix
      : declared
        ? 'DECLARED AND NOT MET'
        : 'below: missing ' + (missing.join(', ') || 'nothing on any one project') + suffix;
    console.log(
      r.market.slice(0, pad - 1).padEnd(pad) + String(r.projects).padStart(6) + String(r.party).padStart(7) +
      String(r.facts).padStart(7) + String(r.conditions).padStart(7) + String(r.decision).padStart(7) +
      String(r.all).padStart(7) + '   ' + verdict
    );
  }
  console.log('');
  console.log('live projects that build no entry at all: ' + noEntry);

  // ---- THE RECONCILIATION, BOTH WAYS -----------------------------------------
  const met = new Set(ordered.filter((r) => r.all > 0).map((r) => r.market));
  const declaredNotMet = MARKETS_AT_STANDARD.filter((m) => !met.has(m));
  const metNotDeclared = [...met].filter((m) => !MARKETS_AT_STANDARD.includes(m));

  console.log('');
  let failed = false;

  if (declaredNotMet.length > 0) {
    failed = true;
    console.log('FAIL: declared at standard in lib/market-standard and no longer meeting it:');
    for (const m of declaredNotMet) {
      const r = rows.get(m);
      if (!r) {
        console.log('  ' + m + ' - holds no live project at all');
        continue;
      }
      const missing = criteriaFor(m).filter((c) => r[c] === 0);
      console.log(
        '  ' + m + ' - ' + r.projects + ' live projects, none clearing all four. ' +
        (missing.length ? 'No project carries: ' + missing.join(', ') + '.' : 'Every criterion is carried by some project, none by one project at once.')
      );
    }
    console.log('  A reader stopped working, a source went quiet, or a gate change took the evidence out.');
  }

  if (metNotDeclared.length > 0) {
    failed = true;
    console.log('FAIL: meeting the standard and not declared in lib/market-standard:');
    for (const m of metNotDeclared) {
      console.log('  ' + m + ' - ' + rows.get(m)!.all + ' live projects clear all four.');
    }
    console.log('  Add it to MARKETS_AT_STANDARD. Until then its client documents state a limit it no longer has.');
  }

  if (failed) {
    console.log('');
    console.log('The declaration is lib/market-standard.MARKETS_AT_STANDARD.');
    process.exit(1);
  }

  const below = ordered.filter((r) => r.all === 0).length;
  console.log(
    'PASS: ' + MARKETS_AT_STANDARD.length + ' market(s) declared at standard and meeting it, ' +
    below + ' below it and each reported with what it is missing, and nothing meets it undeclared.'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
