// READ-ONLY. BRIEF T ITEMS 1 AND 2. WHAT A CLARK COUNTY PROJECT CARRIES THAT
// THE OTHERS DO NOT, AND WHICH MARKET CLEARS WHICH CRITERION.
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/market-standard.ts [--name=<substring>]
//
// Nothing is written.
//
// THE STANDARD IS READ OFF CLARK COUNTY RATHER THAN INVENTED. Brief T item 1
// names four things and this measures whether the corpus actually produces
// them, project by project, out of the REAL buildEntry - so what is counted is
// what a client document prints, not what a column stores. That is the same
// agents -> dashboard crossing as depth-ranking and holdings-judgement: command
// line only, excluded from the root tsconfig BY NAME, because a copy of the
// print rules would drift and the half that drifted would be the half measuring
// what clients read.
//
// NO CAP ANYWHERE IN THE READ. Projects and leads are both paged to exhaustion
// rather than taking PostgREST's silent default of 1000, and the per-project
// entry is built with cap 500, which is the referral brief's cap rather than the
// market report's eight. Standing rule 13: a measurement that caps its input
// states the cap beside the number, and where the figure decides something the
// cap comes off instead.
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { HOSPITALITY_ID, LIVE_PIPELINE_STORAGE_KEY } from '../pipelines';
import { inCorpusScope } from '../../../lib/corpus-scope';
import { buildEntry } from '../../../dashboard/lib/report-entry';
import type { Project, TimelineRecord } from '../../../dashboard/lib/projects';

const arg = (k: string) => (process.argv.find((a) => a.startsWith('--' + k + '=')) ?? '').split('=')[1] ?? '';
const WANT = arg('name');

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

// ---- THE FOUR CRITERIA, AS FACT KINDS ---------------------------------------
//
// Brief T item 1 names them in a person's words. These are the kinds the readers
// actually emit, so the definition is testable rather than a reading.
//
// A DECISION IS THE ONE THAT IS NOT A FIELD OF ITS OWN. conditions, people and
// stated are each a block on the entry; a decision arrives as a stated fact of a
// particular kind, carrying the body in its label and the date in what it
// printed. Clark prints
// "COUNTY COMMISSION ACTION: June 17, 2026 - HELD - To 07/22/26".
const DECISION_KINDS = new Set(['commission_action', 'board_action', 'the_vote', 'nyc_approved']);

// Acreage, zone, storeys, rooms and parking as Brief T names them, plus the rest
// of the what-and-where set the same readers produce. Kept apart from the
// decision kinds so a project whose only stated fact IS the decision does not
// count as carrying facts about the scheme.
const SCHEME_FACT_KINDS = new Set([
  'site_acreage', 'zone', 'stories', 'rooms', 'parking', 'units', 'floor_area',
  'height_feet', 'seats', 'lots', 'density', 'open_space', 'unit_size',
  'project_type', 'existing_land_use', 'land_use_plan',
  'site_address', 'cross_streets', 'apn', 'town', 'nyc_block_lot', 'nyc_borough',
]);

// The five Brief T names by hand, reported separately so the headline count
// cannot be carried by an address alone.
const NAMED_FIVE = ['site_acreage', 'zone', 'stories', 'rooms', 'parking'];

interface Row {
  id: string;
  name: string;
  market: string;
  stage: string;
  party: boolean;
  partyWithFirm: boolean;
  facts: boolean;
  namedFive: string[];
  conditions: number;
  decision: string | null;
  decisionDate: boolean;
  sources: { party: string[]; facts: string[]; conditions: string[]; decision: string[] };
}

const yn = (v: boolean) => (v ? 'yes' : '-');

async function main(): Promise<void> {
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

  console.log('===== BRIEF T ITEM 1. THE STANDARD, READ OFF WHAT CLARK COUNTY DOES =====');
  console.log('projects read ' + projects.length + ' (paged to exhaustion, no cap)');
  console.log('live population ' + live.length +
    ': ' + `module = '${LIVE_PIPELINE_STORAGE_KEY}'` + ', status<>dismissed, country in corpus scope, stage not in (dormant, archived)');
  console.log('leads read ' + leads.length +
    ' (paged to exhaustion, no cap); entries built at cap 500, the referral brief cap');
  console.log('');

  const rows: Row[] = [];
  let noEntry = 0;

  for (const p of live) {
    const records = byProject.get(p.id) ?? [];
    const built = buildEntry(p, records, { partyRecords: records, cap: 500 });
    if (!built) {
      noEntry++;
      continue;
    }
    const e = built.entry;
    const people = e.people ?? [];
    const stated = e.stated ?? [];

    const decisionFact = stated.find((f) => DECISION_KINDS.has(f.kind)) ?? null;
    const schemeFacts = stated.filter((f) => SCHEME_FACT_KINDS.has(f.kind));
    const conditions = e.conditions.reduce((n, s) => n + s.conditions.length, 0);

    const srcOf = (xs: { sourceLabel?: string }[]) =>
      [...new Set(xs.map((x) => x.sourceLabel ?? '').filter(Boolean))];

    rows.push({
      id: p.id,
      name: p.name ?? '(unnamed)',
      market: p.market ?? '(no market)',
      stage: p.stage ?? '(no stage)',
      party: people.length > 0,
      partyWithFirm: people.some((x) => !!x.firm),
      facts: schemeFacts.length > 0,
      namedFive: NAMED_FIVE.filter((k) => stated.some((f) => f.kind === k)),
      conditions,
      decision: decisionFact ? decisionFact.label + ': ' + decisionFact.display : null,
      // "with the body and the date". The body is the label the document used;
      // the date has to be IN what it printed, so this looks for one rather than
      // assuming the kind carries it.
      decisionDate:
        !!decisionFact &&
        /\d{1,2}\/\d{1,2}\/\d{2,4}|\b(19|20)\d{2}\b/.test(decisionFact.display + ' ' + decisionFact.sentence),
      sources: {
        party: [...new Set(people.map((x) => x.sourceLabel ?? '').filter(Boolean))],
        facts: srcOf(schemeFacts),
        conditions: srcOf(e.conditions),
        decision: decisionFact ? srcOf([decisionFact]) : [],
      },
    });
  }

  // ---- THE TWO PROJECTS BRIEF T NAMES, FIELD BY FIELD ------------------------
  const named = rows.filter((r) => /heart hotel|kulik|tropicana land/i.test(r.name));
  for (const r of named.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log('--- ' + r.name + '  [' + r.market + ', ' + r.stage + '] ---');
    console.log('  party            ' + yn(r.party) + '   firm on a party: ' + yn(r.partyWithFirm));
    console.log('                   from ' + (r.sources.party.join(' | ') || '(nothing)'));
    console.log('  stated facts     ' + yn(r.facts) + '   of the five named: ' +
      (r.namedFive.join(', ') || '(none)'));
    console.log('                   from ' + (r.sources.facts.join(' | ') || '(nothing)'));
    console.log('  conditions       ' + r.conditions);
    console.log('                   from ' + (r.sources.conditions.join(' | ') || '(nothing)'));
    console.log('  decision         ' + (r.decision ?? '(none)') + '   date present: ' + yn(r.decisionDate));
    console.log('                   from ' + (r.sources.decision.join(' | ') || '(nothing)'));
    console.log('');
  }

  if (WANT) {
    for (const r of rows.filter((x) => x.name.toLowerCase().includes(WANT.toLowerCase()))) {
      console.log(r.name + ' [' + r.market + '] party=' + yn(r.party) + ' facts=' + yn(r.facts) +
        ' conds=' + r.conditions + ' decision=' + (r.decision ?? '-'));
    }
    return;
  }

  // ---- ITEM 2. EVERY MARKET AGAINST IT ---------------------------------------
  console.log('===== BRIEF T ITEM 2. EVERY MARKET AGAINST THE FOUR =====');
  console.log('Counts are LIVE PROJECTS carrying the criterion in what a document would print.');
  console.log('');
  const markets = [...new Set(rows.map((r) => r.market))].sort();
  const pad = Math.max(24, ...markets.map((m) => m.length + 1));
  console.log(
    'market'.padEnd(pad) + 'projects'.padStart(9) + 'party'.padStart(8) + '+firm'.padStart(8) +
    'facts'.padStart(8) + 'conds'.padStart(8) + 'decision'.padStart(10) + '+date'.padStart(8) + '  ALL FOUR'
  );
  console.log('-'.repeat(pad + 65));
  const tot = { n: 0, party: 0, firm: 0, facts: 0, conds: 0, dec: 0, date: 0, all: 0 };
  for (const m of markets) {
    const rs = rows.filter((r) => r.market === m);
    const c = {
      n: rs.length,
      party: rs.filter((r) => r.party).length,
      firm: rs.filter((r) => r.partyWithFirm).length,
      facts: rs.filter((r) => r.facts).length,
      conds: rs.filter((r) => r.conditions > 0).length,
      dec: rs.filter((r) => !!r.decision).length,
      date: rs.filter((r) => r.decisionDate).length,
      all: rs.filter((r) => r.party && r.facts && r.conditions > 0 && !!r.decision).length,
    };
    for (const k of Object.keys(tot) as (keyof typeof tot)[]) tot[k] += c[k];
    console.log(
      m.padEnd(pad) + String(c.n).padStart(9) + String(c.party).padStart(8) + String(c.firm).padStart(8) +
      String(c.facts).padStart(8) + String(c.conds).padStart(8) + String(c.dec).padStart(10) +
      String(c.date).padStart(8) + String(c.all).padStart(10)
    );
  }
  console.log('-'.repeat(pad + 65));
  console.log(
    'ALL'.padEnd(pad) + String(tot.n).padStart(9) + String(tot.party).padStart(8) + String(tot.firm).padStart(8) +
    String(tot.facts).padStart(8) + String(tot.conds).padStart(8) + String(tot.dec).padStart(10) +
    String(tot.date).padStart(8) + String(tot.all).padStart(10)
  );
  console.log('');
  console.log('projects with no entry at all: ' + noEntry);

  // ---- WHERE EACH CRITERION COMES FROM WHEN IT IS THERE -----------------------
  console.log('');
  console.log('===== WHERE IT COMES FROM, PER MARKET, WHEN IT IS THERE =====');
  for (const m of markets) {
    const rs = rows.filter((r) => r.market === m);
    const src = (pick: (r: Row) => string[]) => {
      const seen = new Map<string, number>();
      for (const r of rs) for (const s of pick(r)) seen.set(s, (seen.get(s) ?? 0) + 1);
      return [...seen]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([s, n]) => s + ' x' + n)
        .join(', ');
    };
    const conds = src((r) => r.sources.conditions);
    const dec = src((r) => r.sources.decision);
    if (!conds && !dec) continue;
    console.log(m);
    if (conds) console.log('  conditions from  ' + conds);
    if (dec) console.log('  decision from    ' + dec);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
