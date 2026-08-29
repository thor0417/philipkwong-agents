// READ-ONLY. WHAT WE ACTUALLY HOLD, JUDGED PROJECT BY PROJECT. Brief Q item 1.
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/holdings-judgement.ts [--population=live|all|dormant] [--out=<path>]
//
// Nothing is written to Supabase. The judgement is cached to a committed
// fixture so a re-run is free and a label can be corrected by hand, which is
// the same discipline gate-labels uses and for the same reason: a number that
// costs money to reproduce is a number nobody re-checks.
//
// IT CALLS THE REAL buildEntry, out of dashboard/lib, for the same reason
// depth-ranking does: the sub-measures Brief Q asks for - a named party, a
// representative, a stated fact, a condition, a contact - are properties of
// what PRINTS, not of what is stored. Counting filing_facts rows off the table
// would overcount by every fact the entry excludes, dedupes, caps or refuses.
// So it is an agents -> dashboard crossing: command line only, run with tsx,
// excluded from the root tsconfig BY NAME.
//
// THE POPULATION IS A PREDICATE, PRINTED BESIDE EVERY COUNT. Three numbers are
// in circulation for "how many projects" and they are three different questions:
//
//   424  every row in the projects table
//   416  module='gli' AND status<>'dismissed' AND country in corpus scope
//        (this is the register's default query - see dashboard/lib/projects)
//   340  the above AND stage NOT IN ('dormant','archived')   <- LIVE, the default here
//
// The 76 that separate 416 from 340 are dormant or archived. They are judged too,
// under --population=dormant, so nothing is silently absent.

import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { inCorpusScope } from '../../../lib/corpus-scope';
import { buildEntry } from '../../../dashboard/lib/report-entry';
import type { Project, TimelineRecord } from '../../../dashboard/lib/projects';
import { LIVE_PIPELINE_STORAGE_KEY, isHospitalityModule } from '../pipelines';

const arg = (k: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').split('=')[1] ?? '';
const POPULATION = (arg('population') || 'live') as 'live' | 'all' | 'dormant';
const OUT = arg('out') || `snapshots/holdings-judgement-${POPULATION}.md`;
const LABEL_FILE = 'agents/scraper/fixtures/holdings-labels.jsonl';

// ---- THE BUCKETS ------------------------------------------------------------
//
// Verbatim from the 2026-08-22 judgement, so the numbers are comparable. They
// are mutually exclusive and assigned on the PRIMARY character of the filing.
export type Bucket = 'development-vertical' | 'development-other' | 'instrument' | 'housekeeping';

const BUCKET_LABEL: Record<Bucket, string> = {
  'development-vertical': 'a hospitality or entertainment DEVELOPMENT',
  'development-other': 'a development, but outside the vertical',
  instrument: 'an instrument rather than a project',
  housekeeping: 'municipal housekeeping that cleared the gate on a word',
};

// Bumped when the rubric or the judge model changes, because both change the
// labels. A cached label from a superseded version is ignored, never reused.
const RUBRIC_VERSION = 'q1-v1';
const MODEL = process.env.HOLDINGS_JUDGE_MODEL ?? 'claude-sonnet-5';

const RUBRIC = `You are judging a US local-government development project for a register kept by a regulatory-compliance and corporate-strategy consultant. Its subject is leisure and hospitality development: hotels, resorts, casinos and gaming, theme parks and attractions, arenas, stadiums, convention and exhibition centres, entertainment districts, cultural and performing-arts venues, marinas, golf, tourism districts, and the deals cities strike with private developers to build them.

You are given a project's name and the titles of every record clustered into it. Assign EXACTLY ONE bucket, on the PRIMARY character of the filing. The buckets are mutually exclusive.

"development-vertical"  A hospitality or entertainment DEVELOPMENT. Something is being built, expanded, redeveloped or entitled, and it is in the vertical above. A hotel, a casino, a stadium, a theme-park expansion, a convention centre, an entertainment district, a resort. The filing is about the SCHEME.

"development-other"     A development, but outside the vertical. Housing, industrial, office, warehouse, a school, a hospital, a fire station, pure infrastructure. Something is genuinely being built; it is simply not our subject.

"instrument"            An instrument rather than a project. The filing's subject is a legal or administrative act attached to an address or an existing operation, rather than a scheme: a liquor or gaming licence, a sign waiver, an extension of time, a bond hearing, a plan or code amendment, an easement, a plat, a contract amendment, a budget approval, an audit. It may well concern a hotel or a casino; what makes it an instrument is that no scheme is being decided.

"housekeeping"          Municipal housekeeping that cleared the gate on a word. Comprehensive-plan and land-use-plan amendment calendars, notices of public hearing to consider a future notice, procedural motions, minutes, proclamations, commissioner reports, grant applications, personnel items. It names no scheme and no site anyone is developing.

Judge on the records, not on the project name: a name is often a truncated agenda line. If the records show a scheme, it is a development even when the name reads procedurally. If the records show only procedure, it is housekeeping even when the name contains a leisure noun.

Return STRICT JSON only: {"bucket": "development-vertical"|"development-other"|"instrument"|"housekeeping", "reason": "<12 words or fewer>"}`;

interface Label {
  id: string;
  name: string;
  market: string | null;
  bucket: Bucket;
  reason: string;
  judge: string;
  rubric: string;
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const RETRIES = 2;
const CONCURRENCY = 6;

const PROJECT_COLUMNS =
  'id,module,name,project_key,country,region_state,market,stage,development_category,' +
  'venue_type,status,watch,notes,manual_overrides,first_seen,last_activity,next_milestone,' +
  'record_count,primary_applicant,primary_representative,created_at,summary,summary_source,' +
  'summary_url,name_source,significance,significance_detail,significance_computed_at';

const RECORD_COLUMNS =
  'id,title,url,source,source_type,published_date,deadline,first_seen,date_source,' +
  'cluster_reason,status,lifecycle,applicant,representative,presented_by,action_sought,' +
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

function readLabels(): Map<string, Label> {
  const m = new Map<string, Label>();
  if (!existsSync(LABEL_FILE)) return m;
  let stale = 0;
  for (const line of readFileSync(LABEL_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const l = JSON.parse(line) as Label;
      if (l.rubric !== RUBRIC_VERSION || l.judge !== MODEL) { stale++; continue; }
      m.set(l.id, l);
    } catch { /* a truncated line is a line to re-judge, not a crash */ }
  }
  if (stale) console.error(`labels: ignored ${stale} from a superseded rubric or judge (current ${RUBRIC_VERSION}/${MODEL})`);
  return m;
}

function parse(text: string): { bucket: Bucket; reason: string } | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = (fenced ? fenced[1] : text).trim();
  const a = body.indexOf('{');
  const b = body.lastIndexOf('}');
  if (a !== -1 && b > a) body = body.slice(a, b + 1);
  try {
    const p = JSON.parse(body) as { bucket?: unknown; reason?: unknown };
    if (!p.bucket || !(p.bucket as string in BUCKET_LABEL)) return null;
    return { bucket: p.bucket as Bucket, reason: typeof p.reason === 'string' ? p.reason.slice(0, 120) : '' };
  } catch {
    return null;
  }
}

async function judgeOne(p: any, records: any[]): Promise<Label | null> {
  const titles = records
    .slice(0, 14)
    .map((r) => `- [${r.source}] ${String(r.title ?? '').replace(/\s+/g, ' ').slice(0, 190)}`)
    .join('\n');
  const prompt =
    `${RUBRIC}\n\nProject name: ${p.name}\nMarket: ${p.market ?? '(none)'}\n` +
    `Stage: ${p.stage ?? '(none)'}\nVenue type: ${p.venue_type ?? '(none)'}\n` +
    `Records (${records.length} total, first ${Math.min(records.length, 14)} shown):\n${titles}`;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      });
      const raw = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n');
      const v = parse(raw);
      if (!v) {
        if (attempt < RETRIES) continue;
        console.error(`unparseable for ${p.name.slice(0, 50)}: ${raw.slice(0, 120)}`);
        return null;
      }
      return { id: p.id, name: p.name, market: p.market, bucket: v.bucket, reason: v.reason, judge: MODEL, rubric: RUBRIC_VERSION };
    } catch (e) {
      if (attempt < RETRIES) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
      console.error(`judge failed for ${p.name.slice(0, 50)}: ${(e as Error).message}`);
      return null;
    }
  }
}

// ---- depth, identical weights to depth-ranking ------------------------------
function depthOf(r: {
  statedFacts: number; pressFigures: number; conditions: number; parties: number;
  contacts: number; addresses: number; filings: number; press: number;
  schedule: boolean; summary: boolean;
}): number {
  return (
    r.statedFacts * 3 + r.pressFigures * 1 + Math.min(r.conditions, 60) * 2 +
    r.parties * 2 + r.contacts * 8 + r.addresses * 4 + r.filings * 2 + r.press * 0.5 +
    (r.schedule ? 5 : 0) + (r.summary ? 5 : 0)
  );
}

async function main(): Promise<void> {
  const all = await pageAll<any>('projects', PROJECT_COLUMNS);
  const leads = await pageAll<any>('leads', RECORD_COLUMNS);
  const byProject = new Map<string, any[]>();
  for (const l of leads) {
    if (!l.project_id) continue;
    if (l.status === 'dismissed' || l.lifecycle === 'retired') continue;
    if (!byProject.has(l.project_id)) byProject.set(l.project_id, []);
    byProject.get(l.project_id)!.push(l);
  }

  const REGISTER = (p: any) => isHospitalityModule(p.module) && p.status !== 'dismissed' && inCorpusScope(p.country);
  const DORMANT = (p: any) => ['dormant', 'archived'].includes(String(p.stage));
  const PREDICATE: Record<string, { text: string; f: (p: any) => boolean }> = {
    live: { text: `module='${LIVE_PIPELINE_STORAGE_KEY}' AND status<>'dismissed' AND country IN corpus scope AND stage NOT IN ('dormant','archived')`, f: (p) => REGISTER(p) && !DORMANT(p) },
    all: { text: `module='${LIVE_PIPELINE_STORAGE_KEY}' AND status<>'dismissed' AND country IN corpus scope  (the register's default query)`, f: REGISTER },
    dormant: { text: `module='${LIVE_PIPELINE_STORAGE_KEY}' AND status<>'dismissed' AND country IN corpus scope AND stage IN ('dormant','archived')`, f: (p) => REGISTER(p) && DORMANT(p) },
  };
  const pop = all.filter(PREDICATE[POPULATION].f);
  console.error(`population '${POPULATION}': ${pop.length} projects of ${all.length} rows`);
  console.error(`predicate: ${PREDICATE[POPULATION].text}`);

  // ---- judge ----------------------------------------------------------------
  const labels = readLabels();
  const todo = pop.filter((p) => !labels.has(p.id));
  console.error(`labels: ${pop.length - todo.length} cached, ${todo.length} to judge`);
  if (todo.length) {
    mkdirSync(dirname(LABEL_FILE), { recursive: true });
    let done = 0;
    for (let i = 0; i < todo.length; i += CONCURRENCY) {
      const batch = todo.slice(i, i + CONCURRENCY);
      const got = await Promise.all(batch.map((p) => judgeOne(p, byProject.get(p.id) ?? [])));
      for (const l of got) {
        if (!l) continue;
        labels.set(l.id, l);
        appendFileSync(LABEL_FILE, JSON.stringify(l) + '\n');
      }
      done += batch.length;
      if (done % 30 < CONCURRENCY) console.error(`  judged ${done}/${todo.length}`);
    }
  }

  // ---- measure ---------------------------------------------------------------
  interface Row {
    id: string; name: string; market: string; stage: string; bucket: Bucket; reason: string;
    party: string | null; namedPrivateParty: boolean; representative: boolean;
    statedFacts: number; conditions: number; contacts: number; parties: number;
    records: number; depth: number; provisional: boolean; primaryDoc: boolean;
  }
  const rows: Row[] = [];
  let noEntry = 0;
  for (const p of pop) {
    const label = labels.get(p.id);
    if (!label) continue;
    const records = byProject.get(p.id) ?? [];
    const built = buildEntry(p as Project, records as TimelineRecord[] as any, { partyRecords: records as any, cap: 500 });
    if (!built) { noEntry++; continue; }
    const e = built.entry;
    const people = e.people ?? [];
    // A NAMED PRIVATE PARTY. people.ts has already refused agency staff and the
    // case planner, so anything that reaches the entry's PEOPLE section is a
    // party a reader could act on. Counted from what prints, not from the column.
    const namedPrivateParty = people.length > 0;
    const conditions = e.conditions.reduce((n, s) => n + s.conditions.length, 0);
    const filings = e.records.filter((r) => r.provenance === 'RECORD').length;
    rows.push({
      id: p.id,
      name: p.name,
      market: String(p.market ?? '(no market)'),
      stage: String(p.stage ?? '(none)'),
      bucket: label.bucket,
      reason: label.reason,
      party: p.primary_applicant ?? people[0]?.name ?? null,
      namedPrivateParty,
      representative: !!p.primary_representative || records.some((r) => r.representative),
      statedFacts: e.stated.length,
      conditions,
      contacts: people.filter((x: any) => !!x.contact).length,
      parties: people.length,
      records: records.length,
      provisional: p.name_source === 'title' || !p.name_source,
      primaryDoc: records.some((r) => r.primary_document_url),
      depth: depthOf({
        statedFacts: e.stated.length, pressFigures: e.scale.length, conditions,
        parties: people.length, contacts: people.filter((x: any) => !!x.contact).length,
        addresses: people.filter((x: any) => !!x.address).length,
        filings, press: e.records.length - filings,
        schedule: !!e.schedule, summary: !!e.summary,
      }),
    });
  }

  // ---- write -----------------------------------------------------------------
  const L: string[] = [];
  const w = (s = '') => L.push(s);
  w(`# WHAT WE ACTUALLY HOLD. Brief Q item 1.`);
  w();
  w(`Judged ${rows.length} projects. Population **${POPULATION}**, and the predicate is stated`);
  w(`so it can be matched against the screen:`);
  w();
  w('```');
  w(PREDICATE[POPULATION].text);
  w('```');
  w();
  w(`Judge ${MODEL}, rubric ${RUBRIC_VERSION}, labels cached in ${LABEL_FILE}.`);
  if (noEntry) w(`${noEntry} projects build no entry at all and are excluded from the tables below.`);
  w();
  w(`## Buckets`);
  w();
  const bucketOrder: Bucket[] = ['development-vertical', 'development-other', 'instrument', 'housekeeping'];
  w('| bucket | count | share |');
  w('|---|---:|---:|');
  for (const b of bucketOrder) {
    const n = rows.filter((r) => r.bucket === b).length;
    w(`| ${BUCKET_LABEL[b]} | ${n} | ${((100 * n) / rows.length).toFixed(1)}% |`);
  }
  w();
  w(`## Per bucket, per market`);
  w();
  w(`Counts are of PROJECTS. "party", "rep", "fact", "cond" and "contact" are what the`);
  w(`real entry builder prints, not what the columns store.`);
  for (const b of bucketOrder) {
    const inB = rows.filter((r) => r.bucket === b);
    w();
    w(`### ${BUCKET_LABEL[b]} — ${inB.length}`);
    w();
    if (!inB.length) { w('None.'); continue; }
    w('| market | projects | named party | representative | stated fact | condition | contact |');
    w('|---|---:|---:|---:|---:|---:|---:|');
    const markets = [...new Set(inB.map((r) => r.market))].sort();
    for (const m of markets) {
      const s = inB.filter((r) => r.market === m);
      w(`| ${m} | ${s.length} | ${s.filter((r) => r.namedPrivateParty).length} | ${s.filter((r) => r.representative).length} | ${s.filter((r) => r.statedFacts > 0).length} | ${s.filter((r) => r.conditions > 0).length} | ${s.filter((r) => r.contacts > 0).length} |`);
    }
    const s = inB;
    w(`| **all** | **${s.length}** | **${s.filter((r) => r.namedPrivateParty).length}** | **${s.filter((r) => r.representative).length}** | **${s.filter((r) => r.statedFacts > 0).length}** | **${s.filter((r) => r.conditions > 0).length}** | **${s.filter((r) => r.contacts > 0).length}** |`);
  }

  w();
  w(`## The hospitality developments, ranked by depth`);
  w();
  w('Depth is what a reader MEETS on the page, not significance. Weights identical to');
  w('agents/scraper/diagnostics/depth-ranking:');
  w('`stated*3 + pressFig*1 + min(conditions,60)*2 + parties*2 + contacts*8 + addresses*4 + filings*2 + press*0.5 + schedule*5 + summary*5`');
  w();
  const vertical = rows.filter((r) => r.bucket === 'development-vertical').sort((a, b) => b.depth - a.depth);
  w('| # | depth | project | market | stage | party | recs | facts | conds |');
  w('|---:|---:|---|---|---|---|---:|---:|---:|');
  vertical.slice(0, 30).forEach((r, i) => {
    w(`| ${i + 1} | ${Math.round(r.depth)} | ${r.name.slice(0, 52)} | ${r.market} | ${r.stage} | ${(r.party ?? '-').slice(0, 30)} | ${r.records} | ${r.statedFacts} | ${r.conditions} |`);
  });
  w();
  const dq = vertical.map((r) => r.depth).sort((a, b) => a - b);
  w(`Depth across all ${vertical.length} hospitality developments: median ${Math.round(dq[Math.floor(dq.length / 2)] ?? 0)}, top ${Math.round(dq[dq.length - 1] ?? 0)}, bottom ${Math.round(dq[0] ?? 0)}.`);

  writeFileSync(OUT, L.join('\n') + '\n');
  console.error(`\nwrote ${OUT}`);

  // machine-readable sidecar, for the three answers and any follow-up
  const json = OUT.replace(/\.md$/, '.json');
  writeFileSync(json, JSON.stringify({ population: POPULATION, predicate: PREDICATE[POPULATION].text, judge: MODEL, rubric: RUBRIC_VERSION, rows }, null, 1));
  console.error(`wrote ${json}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
