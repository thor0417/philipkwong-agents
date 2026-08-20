// READ-ONLY. HOW DEEP EVERY LIVE PROJECT WOULD READ AS A REFERRAL BRIEF.
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/depth-ranking.ts [--top=N] [--name=<substring>]
//
// Nothing is written. This ranks the corpus by what a READER meets on the page,
// which is not what the register stores and not what significance scores.
//
// IT CALLS THE REAL buildEntry, out of dashboard/lib, for the same reason
// assembled-measure calls the real assembleSentence: a copy of the print rules
// would drift, and the half that drifted would be the half measuring what
// clients read. Counting filing_facts rows off the table would overcount by
// every fact the entry excludes, dedupes, caps or refuses for failing the
// quotation check.
//
// So it is an agents -> dashboard crossing: command line only, run with tsx, and
// excluded from the root tsconfig BY NAME. See CLAUDE.md on the asymmetry.
//
// DEPTH IS NOT SIGNIFICANCE. Significance asks "should a client be told about
// this". Depth asks "if we wrote it up, is there anything on the page". A
// project can score high and read as three lines.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { LIVE_PIPELINE_STORAGE_KEY } from '../pipelines';
import { inCorpusScope } from '../../../lib/corpus-scope';
import { buildEntry } from '../../../dashboard/lib/report-entry';
import type { Project, TimelineRecord } from '../../../dashboard/lib/projects';

const arg = (k: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').split('=')[1] ?? '';
const TOP = Number(arg('top')) || 25;
const WANT = arg('name');

// The same columns report-build selects. A diagnostic reading a smaller set
// measures a thinner entry than the one that prints.
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
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

// ---- IS A PARTY A PERSON OR AN ENTITY ---------------------------------------
//
// NOT A CLASSIFIER, AND IT IS NOT ALLOWED TO BECOME ONE. The person/firm split
// is a known-unreliable shape rule: measured, it consolidated 4 identities and
// misread 31 company names as people. So this counts only what the RECORD
// settles - a party carrying a `firm` alongside its name is a named individual
// speaking for that firm, because that is the only way people.ts populates the
// field - and reports the rest as unsettled rather than guessing. An unsettled
// party is counted as neither a person nor an entity.
const ENTITY_MARK =
  /\b(llc|l\.l\.c|inc|incorporated|corp|corporation|company|co\.|ltd|limited|lp|l\.p|llp|plc|trust|holdings?|partners|partnership|group|associates|properties|developments?|capital|ventures?|enterprises|realty|management|authority|district|commission|department|board|city of|county of|university|college)\b/i;

interface PartySplit {
  individuals: number;
  entities: number;
  unsettled: number;
}

function splitParties(names: { name: string; firm: string | null }[]): PartySplit {
  let individuals = 0;
  let entities = 0;
  let unsettled = 0;
  for (const p of names) {
    if (p.firm) individuals++;
    else if (ENTITY_MARK.test(p.name)) entities++;
    else unsettled++;
  }
  return { individuals, entities, unsettled };
}

// ---- DOES A CAPTURED FILING SUPPORT THE STAGE -------------------------------
//
// The stage ladder is proven by filings and never by press. So the question a
// reader asks - "it says approved, who says so" - is answered by whether the
// project holds a filing at all, and separately by whether any filing states a
// decision. Both are printed; neither is inferred.
const DECISION_MARK =
  /\b(approv|denied|deny|adopt|certif|grant|conditions? of approval|recommend|ordinance|resolution)\b/i;

interface Row {
  id: string;
  name: string;
  market: string | null;
  stage: string | null;
  significance: number | null;
  factKinds: string[];
  statedFacts: number;
  pressFigures: number;
  conditions: number;
  conditionSets: number;
  conditionsHeld: number;
  parties: number;
  split: PartySplit;
  contacts: number;
  addresses: number;
  filings: number;
  press: number;
  schedule: string | null;
  summary: boolean;
  stageBackedByFiling: boolean;
  stageDecisionRecord: boolean;
  depth: number;
}

// THE DEPTH SCORE, AND ITS WEIGHTS ARE STATED HERE RATHER THAN TUNED.
//
// It is a reading order, not a truth. Every term is something a reader MEETS on
// the page: a stated fact, a condition, a named party, a way to reach them, a
// filing behind it. Conditions dominate on purpose - they are what a referral is
// for - and press-only depth is capped by giving a press figure a third of the
// weight of a stated one, because "four publications said 752 rooms" is not a
// staff report.
function depthOf(r: Omit<Row, 'depth'>): number {
  return (
    r.statedFacts * 3 +
    r.pressFigures * 1 +
    Math.min(r.conditions, 60) * 2 +
    r.split.individuals * 6 +
    r.split.entities * 2 +
    r.split.unsettled * 1 +
    r.contacts * 8 +
    r.addresses * 4 +
    r.filings * 2 +
    r.press * 0.5 +
    (r.schedule ? 5 : 0) +
    (r.summary ? 5 : 0)
  );
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

  const rows: Row[] = [];
  let noEntry = 0;
  for (const p of live) {
    const records = byProject.get(p.id) ?? [];
    // A cap far above any project's record count, because the referral brief
    // lifts the market-report cap for exactly this reason: a brief IS the
    // project. Ranking under the eight-record cap would measure the cap.
    const built = buildEntry(p, records, { partyRecords: records, cap: 500 });
    if (!built) {
      noEntry++;
      continue;
    }
    const e = built.entry;
    const parties = e.people ?? [];
    const split = splitParties(parties.map((x) => ({ name: x.name, firm: x.firm })));
    const conditions = e.conditions.reduce((n, s) => n + s.conditions.length, 0);
    const filings = e.records.filter((r) => r.provenance === 'RECORD').length;
    const press = e.records.length - filings;
    const factKinds = [...new Set([...e.stated, ...e.scale].map((f) => f.label))];
    const base = {
      id: p.id,
      name: p.name,
      market: p.market,
      stage: p.stage,
      significance: p.significance,
      factKinds,
      statedFacts: e.stated.length,
      pressFigures: e.scale.length,
      conditions,
      conditionSets: e.conditions.length,
      conditionsHeld: e.conditionsHeld,
      parties: parties.length,
      split,
      contacts: parties.filter((x) => !!x.contact).length,
      addresses: parties.filter((x) => !!x.address).length,
      filings,
      press,
      schedule: e.schedule ? `${e.schedule.label} ${e.schedule.display}` : null,
      summary: !!e.summary,
      stageBackedByFiling: records.some((r) => (r.stream ?? '') !== 'intelligence'),
      stageDecisionRecord: records.some(
        (r) =>
          (r.stream ?? '') !== 'intelligence' &&
          DECISION_MARK.test(`${r.title ?? ''} ${r.action_sought ?? ''}`)
      ),
    };
    rows.push({ ...base, depth: depthOf(base) });
  }

  rows.sort((a, b) => b.depth - a.depth);

  console.log('='.repeat(118));
  console.log(
    `DEPTH RANKING over ${live.length} live projects; ${rows.length} build an entry, ${noEntry} have no citable record at all`
  );
  console.log('='.repeat(118));
  console.log('  depth = stated*3 + pressFig*1 + min(conditions,60)*2 + individuals*6 + entities*2');
  console.log('        + unsettled*1 + contacts*8 + addresses*4 + filings*2 + press*0.5 + schedule*5 + summary*5');
  console.log('');
  const head =
    'rank  depth  name                                             market               stage            ' +
    'stat pfig cond sets  prty ind ent uns  ctc addr  fil prs   sig';
  console.log(head);
  console.log('-'.repeat(head.length));
  const line = (r: Row, i: number) =>
    [
      String(i + 1).padStart(4),
      String(Math.round(r.depth)).padStart(6),
      '  ' + (r.name ?? '').slice(0, 47).padEnd(47),
      (r.market ?? '-').slice(0, 19).padEnd(19),
      (r.stage ?? '-').slice(0, 16).padEnd(16),
      String(r.statedFacts).padStart(4),
      String(r.pressFigures).padStart(4),
      String(r.conditions).padStart(4),
      String(r.conditionSets).padStart(5),
      String(r.parties).padStart(5),
      String(r.split.individuals).padStart(4),
      String(r.split.entities).padStart(3),
      String(r.split.unsettled).padStart(4),
      String(r.contacts).padStart(5),
      String(r.addresses).padStart(4),
      String(r.filings).padStart(5),
      String(r.press).padStart(4),
      String(r.significance ?? '-').padStart(5),
    ].join(' ');
  rows.slice(0, TOP).forEach((r, i) => console.log(line(r, i)));

  console.log('');
  console.log('-'.repeat(118));
  console.log('THE FALL-OFF, so the gap between the benchmark and the fifth is readable rather than implied');
  console.log('-'.repeat(118));
  const at = (n: number) =>
    rows[n] ? `${String(Math.round(rows[n].depth)).padStart(5)}  ${rows[n].name.slice(0, 50)}` : '-';
  for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 14, 19, 24, 49]) {
    if (rows[n]) console.log(`  ${String(n + 1).padStart(4)}  ${at(n)}`);
  }
  const depths = rows.map((r) => r.depth);
  console.log(`  median ${Math.round(depths[Math.floor(depths.length / 2)] ?? 0)}`);
  console.log('');
  console.log(`  any condition at all:            ${rows.filter((r) => r.conditions > 0).length}`);
  console.log(`  any stated (filing) fact:        ${rows.filter((r) => r.statedFacts > 0).length}`);
  console.log(`  any press figure:                ${rows.filter((r) => r.pressFigures > 0).length}`);
  console.log(`  a contact detail on any party:   ${rows.filter((r) => r.contacts > 0).length}`);
  console.log(`  a stated address on any party:   ${rows.filter((r) => r.addresses > 0).length}`);
  console.log(`  a named individual (firm given): ${rows.filter((r) => r.split.individuals > 0).length}`);
  console.log(`  a quotable summary:              ${rows.filter((r) => r.summary).length}`);
  console.log(`  a forward or past schedule date: ${rows.filter((r) => !!r.schedule).length}`);
  console.log(`  NO filing behind the stage:      ${rows.filter((r) => !r.stageBackedByFiling).length}`);
  // Printed as a COUNT, not asserted as a corpus fact. If this reads 0 the
  // question is whether the vocabulary is wrong before it is whether the corpus
  // is empty: title and action_sought are agenda lines, and an agenda line says
  // what is being asked for rather than what was decided about it.
  console.log(
    `  a filing whose own title or action_sought states a decision: ` +
      `${rows.filter((r) => r.stageDecisionRecord).length}`
  );

  // ---- THE NAMED ONES, IN FULL ----------------------------------------------
  const named = WANT
    ? rows.filter((r) => r.name.toLowerCase().includes(WANT.toLowerCase()))
    : rows.filter((r) => /heart hotel|bally|ocvibe|oc vibe/i.test(r.name));
  console.log('');
  console.log('-'.repeat(118));
  console.log('NAMED PROJECTS, IN FULL');
  console.log('-'.repeat(118));
  for (const r of named) {
    const rank = rows.indexOf(r) + 1;
    console.log(`\n  ${r.name}  [rank ${rank} of ${rows.length}, depth ${Math.round(r.depth)}]`);
    console.log(`    market ${r.market ?? '-'}   stage ${r.stage ?? '-'}   significance ${r.significance ?? '-'}`);
    console.log(`    stated facts ${r.statedFacts}   press figures ${r.pressFigures}`);
    console.log(`    kinds: ${r.factKinds.join(', ') || 'none'}`);
    console.log(
      `    conditions ${r.conditions} across ${r.conditionSets} set(s), ${r.conditionsHeld} held back by the cap`
    );
    console.log(
      `    parties ${r.parties}: ${r.split.individuals} individual (firm stated), ${r.split.entities} entity, ${r.split.unsettled} unsettled`
    );
    console.log(`    contact detail on ${r.contacts}; a stated address on ${r.addresses}`);
    console.log(`    records ${r.filings} filing(s) / ${r.press} press`);
    console.log(`    schedule ${r.schedule ?? 'none captured'}   quotable summary ${r.summary ? 'yes' : 'no'}`);
    console.log(
      `    stage backed by a captured filing: ${r.stageBackedByFiling ? 'yes' : 'NO - press only'}` +
        `   filing stating a decision: ${r.stageDecisionRecord ? 'yes' : 'no'}`
    );
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
