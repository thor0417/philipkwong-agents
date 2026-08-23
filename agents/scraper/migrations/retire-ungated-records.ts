// RETIRE THE RECORDS A VOCABULARY CHANGE NO LONGER ADMITS.
//
//   npm run retire:ungated             report only, writes nothing
//   npm run retire:ungated -- --apply  write lifecycle = 'retired'
//
// NOTHING IS DELETED AND NOTHING IS DISMISSED, which is the same tombstone
// retire-market-records uses and for the same reasons. `lifecycle = 'retired'`
// leaves the row in place, stops the corpus snapshot counting it as live, and
// stops cluster.ts clustering it. `status` is Philip's column and is never
// written by a scrape path: a dismissed row says "this should not have been
// captured", and these WERE captured correctly under the vocabulary as it stood.
// What changed is the vocabulary.
//
// WHY A SCRIPT AND NOT A MIGRATION FILE. This is a data write, not DDL. Standing
// rule 5 is about schema changes, which are printed for Philip to run; a
// tombstone over rows is the shape retire-market-records already established.
//
// THE SET IS COMPUTED, NEVER LISTED. A hardcoded list of ids would be a snapshot
// of one afternoon's measurement, and would silently do the wrong thing if the
// vocabulary moved again. So the rule is stated as a predicate and the rows are
// found by running the REAL gate:
//
//   a live government record, from a source that CONSULTS the vocabulary, which
//   the gate no longer admits, and which carries the removed term.
//
// THE SOURCE FILTER IS LOAD-BEARING. govdoc and sfwmd take no gate decision at
// all - govdocs.ts declares bypass:true and imports neither gateDecide nor
// governmentGate - so a vocabulary change cannot have removed them and they must
// not be tombstoned by it. The CFTOD 2045 Comprehensive Plan is exactly that row.
//
// AND THE TERM TEST IS LOAD-BEARING TOO. Without it this would sweep every record
// the gate does not admit today, including every record admitted by a target
// bypass, a known entity or a single-purpose jurisdiction - which never matched
// the vocabulary and are not this change's business. Measured while writing this:
// that mistake would have taken 5 further Broward records and 8 projects across
// four other markets.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { governmentGate, hasWord } from '../../../lib/taxonomy';

// The sources that ask the vocabulary a question. Anything else is admitted by
// its jurisdiction or by a bypass and is untouched here.
const GATED_SOURCES = new Set([
  'legistar', 'clark-tab', 'agenda-portal', 'ceqanet',
  'nyc-zap', 'nyc-ceqr', 'nyc-city-record', 'cftod-pdf',
]);

// The term this pass removed. Named here so the reason line can quote it and so
// a future removal edits one string.
const REMOVED_TERM = 'comprehensive plan';

const REASON =
  `Gate vocabulary changed 2026-08-23: '${REMOVED_TERM}' removed from GOV_GATE_STRONG. ` +
  `It named a planning DOCUMENT rather than a venue, and admitted this record on its own. ` +
  `Captured correctly under the vocabulary as it stood; kept, not deleted. ` +
  `See lib/taxonomy GOV_GATE_STRONG and numbers.md section 9.`;

const APPLY = process.argv.includes('--apply');

interface Row {
  id: string;
  project_id: string | null;
  title: string | null;
  raw_content: string | null;
  market: string | null;
  source: string | null;
  status: string | null;
  lifecycle: string | null;
}

async function pageAll(): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id,project_id,title,raw_content,market,source,status,lifecycle')
      .range(from, from + 999);
    if (error) throw new Error(`leads read failed: ${error.message}`);
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

async function main(): Promise<void> {
  console.log(APPLY ? '=== RETIRING UNGATED RECORDS ===' : '=== REPORT ONLY (pass --apply to write) ===');
  console.log(`removed term: '${REMOVED_TERM}'\n`);

  const all = await pageAll();
  console.log(`leads read: ${all.length}   [paged to exhaustion, NO CAP]`);

  const live = all.filter((l) => l.status !== 'dismissed' && l.lifecycle !== 'retired');
  const gated = live.filter((l) => GATED_SOURCES.has(String(l.source)));
  console.log(`live records: ${live.length}, of which from a gate-consulting source: ${gated.length}`);

  const todo = gated.filter((l) => {
    const text = `${l.title ?? ''} ${l.raw_content ?? ''}`;
    if (governmentGate(text, l.market).matched) return false;
    // It has to have carried the removed term, or this change did not remove it.
    return hasWord(text, REMOVED_TERM);
  });

  const byMarket = new Map<string, Row[]>();
  for (const r of todo) {
    const k = String(r.market ?? '(no market)');
    if (!byMarket.has(k)) byMarket.set(k, []);
    byMarket.get(k)!.push(r);
  }
  console.log(`\nrecords the vocabulary no longer admits AND which carried the term: ${todo.length}`);
  for (const [m, rs] of [...byMarket].sort((a, b) => b[1].length - a[1].length)) {
    const attached = rs.filter((r) => r.project_id).length;
    console.log(`  ${m.padEnd(40)} ${String(rs.length).padStart(4)}   (${attached} attached to a project)`);
  }

  // Which projects lose everything. Reported before the write, because a project
  // losing every record is the visible consequence and a count of rows is not.
  const liveByProject = new Map<string, { total: number; going: number }>();
  for (const r of gated) {
    if (!r.project_id) continue;
    const c = liveByProject.get(r.project_id) ?? { total: 0, going: 0 };
    c.total++;
    liveByProject.set(r.project_id, c);
  }
  for (const r of todo) {
    if (!r.project_id) continue;
    const c = liveByProject.get(r.project_id);
    if (c) c.going++;
  }
  const emptied = [...liveByProject].filter(([, c]) => c.total > 0 && c.total === c.going).map(([id]) => id);
  const partial = [...liveByProject].filter(([, c]) => c.going > 0 && c.going < c.total).map(([id]) => id);
  console.log(`\nprojects losing EVERY gated record : ${emptied.length}`);
  console.log(`projects losing SOME but not all   : ${partial.length}`);

  if (!APPLY) {
    console.log('\nWOULD RETIRE: ' + todo.length + ' records. Pass --apply to write.');
    return;
  }

  const CHUNK = 100;
  let written = 0;
  for (let i = 0; i < todo.length; i += CHUNK) {
    const ids = todo.slice(i, i + CHUNK).map((r) => r.id);
    const { error } = await supabaseAdmin
      .from('leads')
      .update({ lifecycle: 'retired', score_reason: REASON })
      .in('id', ids);
    if (error) throw new Error(`write failed: ${error.message}`);
    written += ids.length;
  }
  console.log(`\nwritten: ${written}`);

  // READ IT BACK OFF THE DATABASE. A migration that reports its own success from
  // the value it just sent is a migration that cannot fail visibly.
  const { count, error } = await supabaseAdmin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('lifecycle', 'retired')
    .ilike('score_reason', `%${REMOVED_TERM}%`);
  if (error) throw new Error(`read-back failed: ${error.message}`);
  console.log(`read back: ${count} rows now carry lifecycle='retired' with this reason`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
