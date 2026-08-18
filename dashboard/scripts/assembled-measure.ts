// BRIEF P PART 8: EVERY ASSEMBLED SENTENCE TEMPLATE, WITH A REAL EXAMPLE.
//
//   node --env-file=.env.local --env-file=dashboard/.env.local \n//     --import tsx dashboard/scripts/assembled-measure.ts
//
// IT LIVES IN dashboard/scripts BECAUSE IT IMPORTS THE REAL assembleSentence.
// The split is not cosmetic: the root tsconfig covers agents/ and lib/ only, and
// a diagnostic under agents/ that reaches into dashboard/lib drags the whole
// dashboard into the root typecheck. Calling the real function rather than a
// copy of its logic is the whole point of this file - a copy would drift, and
// the half that drifted would be the half measuring what clients read - so the
// file moves to the side of the split that may legitimately import it.
//
// READ-ONLY. The brief asks for the whole set to be readable at once, because
// these sentences are mechanically derived and printed UNLABELLED - they carry
// no provenance tag, on the grounds that they are facts about the record set
// rather than claims about the world. That is only true if every one of them
// reads as a sentence, and two do not:
//
//   "Records show the public hearing taken to public hearing more than once."
//   "Kulik river capital, LLC:" leading a description
//
// So every template is exercised against the real corpus and printed with the
// project that produced it. A template with no example is a branch nothing
// reaches; a template with an ugly example is a sentence a client will read.

import { supabaseAdmin } from '../../lib/supabase-admin';
import { assembleSentence, type EntryRecord } from '../lib/report-model';

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

interface Lead {
  id: string; title: string | null; action_sought: string | null; source: string | null;
  published_date: string | null; project_id: string | null; status: string | null;
  stream: string | null; source_type: string | null;
}
interface Project {
  id: string; name: string; status: string | null; stage: string | null;
  summary: string | null; summary_source: string | null; summary_url: string | null;
}

/** Which branch of assembleSentence produced this, read off the shape. */
function templateOf(s: string): string {
  if (/^Records show the .+ (held repeatedly|renotified|continued across|advancing across|taken to|moving through|amended more)/.test(s))
    return '2. the {instrument} {state}';
  if (/^Records show the matter /.test(s)) return '3. the matter {state}';
  if (/ on the /.test(s)) return '4. {counted} on the {instrument}{span}';
  if (/, dated /.test(s)) return '1. {counted}, dated {date}   (single record)';
  return '5. {counted}{span}';
}

/** The tautology: the instrument and the state naming the same thing. */
function isTautology(s: string): boolean {
  const m = /^Records show the (.+?) (held repeatedly in abeyance|renotified more than once|continued across multiple sittings|advancing across multiple readings|taken to public hearing more than once|moving through environmental certification|moving through contract award|amended more than once)\.$/.exec(s);
  if (!m) return false;
  const instrument = m[1].toLowerCase();
  const state = m[2].toLowerCase();
  // Every content word of the instrument already inside the state phrase.
  return instrument.split(/\s+/).every((w) => w.length < 4 || state.includes(w));
}

async function main(): Promise<void> {
  const projects = await pageAll<Project>('projects', 'id,name,status,stage,summary,summary_source,summary_url');
  const live = projects.filter((p) => p.status !== 'archived' && p.status !== 'deleted' && p.stage !== 'dormant');
  const leads = (await pageAll<Lead>(
    'leads', 'id,title,action_sought,source,published_date,project_id,status,stream,source_type'
  )).filter((l) => l.status !== 'dismissed');

  const byProject = new Map<string, Lead[]>();
  for (const l of leads) {
    if (!l.project_id) continue;
    if (!byProject.has(l.project_id)) byProject.set(l.project_id, []);
    byProject.get(l.project_id)!.push(l);
  }

  // A minimal EntryRecord: assembleSentence reads date, text, reference and
  // provenance and nothing else, so this exercises the real function rather than
  // a copy of its logic.
  const asRecord = (l: Lead): EntryRecord => ({
    date: l.published_date ? l.published_date.slice(0, 10) : null,
    reference: null,
    text: `${l.title ?? ''} ${l.action_sought ?? ''}`.replace(/\s+/g, ' ').trim(),
    figures: [],
    players: [],
    contact: null,
    language: null,
    provenance: l.stream === 'intelligence' ? 'PRESS' : 'RECORD',
    url: '',
    sourceLabel: '',
  } as unknown as EntryRecord);

  const byTemplate = new Map<string, { n: number; examples: { project: string; sentence: string }[] }>();
  const tautologies: { project: string; sentence: string }[] = [];
  let none = 0;

  for (const p of live) {
    const rs = (byProject.get(p.id) ?? []).map(asRecord);
    const s = assembleSentence(rs);
    if (!s) { none++; continue; }
    const t = templateOf(s);
    if (!byTemplate.has(t)) byTemplate.set(t, { n: 0, examples: [] });
    const e = byTemplate.get(t)!;
    e.n++;
    if (e.examples.length < 3) e.examples.push({ project: p.name, sentence: s });
    if (isTautology(s)) tautologies.push({ project: p.name, sentence: s });
  }

  console.log('='.repeat(78));
  console.log(`EVERY ASSEMBLED SENTENCE TEMPLATE, over ${live.length} live projects`);
  console.log('='.repeat(78));
  console.log(`  projects producing no sentence at all: ${none}  (no records)\n`);
  for (const [t, e] of [...byTemplate.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${String(e.n).padStart(4)}  ${t}`);
    for (const x of e.examples) {
      console.log(`          ${x.project.slice(0, 40).padEnd(40)} "${x.sentence}"`);
    }
    console.log('');
  }

  console.log('='.repeat(78));
  console.log(`TAUTOLOGIES: the instrument and the state naming the same thing`);
  console.log('='.repeat(78));
  console.log(`  ${tautologies.length} projects\n`);
  for (const t of tautologies.slice(0, 15)) {
    console.log(`    ${t.project.slice(0, 40).padEnd(40)} "${t.sentence}"`);
  }

  // ---- AND THE OTHER SENTENCE THE BRIEF NAMED ------------------------------
  //
  // "Kulik river capital, LLC:" is not an assembled sentence at all - it is the
  // stored DERIVED summary, quoted from a filing, and the filing leads with the
  // applicant's name and a colon. Counted here because it is printed in the same
  // position and a reader cannot tell which layer produced it.
  console.log('\n' + '='.repeat(78));
  console.log('DERIVED SUMMARIES THAT OPEN WITH AN APPLICANT PREFIX');
  console.log('='.repeat(78));
  const derived = live.filter((p) => p.summary_source === 'derived' && p.summary);
  const PREFIX = /^\s*([A-Z][^:]{2,60}(?:LLC|L\.L\.C\.|Inc|Corp|Company|Ltd|LP|Trust|Authority|Department|City|County)[^:]{0,20}):\s*/i;
  const prefixed = derived.filter((p) => PREFIX.test(String(p.summary)));
  const anyColon = derived.filter((p) => /^[^.]{3,70}:\s/.test(String(p.summary)));
  console.log(`  derived summaries on live projects   : ${derived.length}`);
  console.log(`  opening with a company-name prefix   : ${prefixed.length}`);
  console.log(`  opening with ANY leading "label: "   : ${anyColon.length}`);
  for (const p of anyColon.slice(0, 10)) {
    console.log(`      ${p.name.slice(0, 34).padEnd(34)} "${String(p.summary).replace(/\s+/g, ' ').slice(0, 105)}"`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
