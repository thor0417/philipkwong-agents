// WHAT THE FETCH CAP COSTS US, PER JURISDICTION.
//
//   npm run diag:fetch-cap
//
// THE DEFECT. sources/legistar fetches
//
//     Matters?$top=200&$orderby=MatterId desc
//
// with NO date filter and NO cursor. Every run re-reads the same newest 200 by
// insertion id. A jurisdiction filing more than 200 matters between runs loses
// the overflow permanently, and nothing anywhere says so: lastStats reports
// `fetched` as the number of rows the request RETURNED, which is 200 whenever
// the cap binds, so a truncated read and a complete one print identically.
//
// It was found on Yonkers, where the corpus held zero records against a live
// feed. The gate was not the cause: of 274 matters the gate admits exactly one,
// the MGM Yonkers community benefits agreement, and that matter is #265 by date.
// It sits outside the window and the lane has never seen it.
//
// THE THREE NUMBERS, and the third is the one that matters:
//
//   IN WINDOW    matters introduced in the last twelve months
//   REACHED      of those, how many are inside the top-200-by-MatterId the lane
//                actually asks for
//   LOST         of the UNREACHED remainder, how many the gate WOULD ADMIT
//
// LOST is what we have been losing. A jurisdiction can be badly truncated and
// lose nothing, if everything past the cap is garbage collection ordinances; and
// it can be barely truncated and lose the only matter that mattered. Reporting
// truncation alone would not tell those apart, which is why this runs the real
// gateDecide over the remainder rather than counting rows.
//
// AND THEN IT ASKS THE CORPUS, which the first version did not, and the first
// version was WRONG BY A LOT because of it.
//
// The lane runs repeatedly. "Not in today's top 200" is not "never fetched": a
// matter that has since aged past the cap may well have been inside it on the
// day a run happened, and be sitting in the database right now. Measured on the
// first pass, the raw remainder said Clark County was losing 53 admissible
// matters - and the samples included DR-26-0313 Mirage Propco and ET-26-400054
// GD Carden, both of which are cited BY NAME in the Clark County market report.
// They were captured months ago and have simply drifted past the window since.
//
// So LOST is split. UNHELD is the number that means anything: admitted by the
// gate, outside the fetch window, and not in the leads table under any run. It
// is what the cap has actually cost, rather than what it would cost a system
// that had only ever run once.

import { writeFileSync, mkdirSync } from 'node:fs';
import { gateDecide, bypassModeFor } from '../gate-decide';
import { DEFAULT_JURISDICTIONS } from '../sources/legistar-jurisdictions';
import { supabaseAdmin } from '../../../lib/supabase-admin';

const BASE = 'https://webapi.legistar.com/v1';
const UA = 'Mozilla/5.0 (compatible; philipkwong-agents/1.0 +scraper)';
const OUT_DIR = 'snapshots';

// EXACTLY what sources/legistar uses. Read from the same env var so this cannot
// measure a cap the lane does not have.
const TOP = Number(process.env.LEGISTAR_TOP ?? '200');

interface Matter {
  MatterId?: number;
  MatterTitle?: string;
  MatterName?: string;
  MatterFile?: string;
  MatterTypeName?: string;
  MatterIntroDate?: string;
}

// ONE RETRY, because a diagnostic that reports UNREADABLE on a transient timeout
// is a diagnostic that reports a different answer every run. The paging walk
// makes an order of magnitude more requests than the first version did, so a
// single dropped connection was taking whole jurisdictions out of the table.
async function fetchJson(url: string, timeoutMs = 120_000): Promise<Matter[] | null> {
  const first = await fetchOnce(url, timeoutMs);
  if (first !== null) return first;
  return fetchOnce(url, timeoutMs);
}

async function fetchOnce(url: string, timeoutMs: number): Promise<Matter[] | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctrl.signal });
    if (!res.ok) return null;
    const body = await res.text();
    try {
      const parsed = JSON.parse(body);
      return Array.isArray(parsed) ? (parsed as Matter[]) : [];
    } catch {
      return null;
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

function gateText(m: Matter): string {
  const title = m.MatterTitle || m.MatterName || m.MatterFile || '';
  return `${title}\n${m.MatterName ?? ''}\n${m.MatterFile ?? ''}\n${m.MatterTypeName ?? ''}`;
}

interface Result {
  client: string;
  label: string;
  inWindow: number | null;
  reached: number;
  unreached: number;
  lost: number;
  /** Of `lost`, the ones the corpus does not hold under any past run. */
  unheld: number;
  lostSamples: string[];
  unheldSamples: string[];
  capBinds: boolean;
}

/** Every Legistar MatterId the corpus already holds, from the stored URL. */
async function heldMatterIds(): Promise<Set<string>> {
  const out = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('url')
      .eq('source', 'legistar')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`held-id read failed: ${error.message}`);
    const rows = (data ?? []) as { url: string | null }[];
    for (const r of rows) {
      // Both shapes the lane stores: the gateway URL and the search fallback.
      const m = String(r.url ?? '').match(/(?:ID=|matter-)(\d+)/);
      if (m) out.add(m[1]);
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

async function measure(client: string, label: string, bypass: boolean, held: Set<string>): Promise<Result | null> {
  // 1. THE LANE'S OWN REQUEST, character for character.
  const reachedRows = await fetchJson(`${BASE}/${client}/Matters?$top=${TOP}&$orderby=${encodeURIComponent('MatterId desc')}`);
  if (!reachedRows) return null;
  const reachedIds = new Set(reachedRows.map((m) => m.MatterId).filter((x): x is number => typeof x === 'number'));

  // 2. EVERYTHING IN THE WINDOW, PAGED TO EXHAUSTION.
  //
  // The first version asked for $top=1000 and three jurisdictions came back with
  // exactly 1000, so every number derived from them was a LOWER BOUND reported
  // as a count - the same shape as the defect being measured, in the instrument
  // measuring it. It pages on the MatterId cursor now, which is also what the
  // fixed lane does, so IN WINDOW is the real backfill cost per jurisdiction.
  const since = monthsAgo(12);
  const windowRows: Matter[] = [];
  let cursor = 0;
  let windowComplete = false;
  for (let page = 0; page < 200; page++) {
    const filter = encodeURIComponent(`MatterIntroDate gt datetime'${since}' and MatterId gt ${cursor}`);
    const batch = await fetchJson(`${BASE}/${client}/Matters?$filter=${filter}&$top=200&$orderby=${encodeURIComponent('MatterId')}`);
    if (!batch) return null;
    if (batch.length === 0) { windowComplete = true; break; }
    windowRows.push(...batch);
    const maxId = batch.reduce((n, m) => (typeof m.MatterId === 'number' && m.MatterId > n ? m.MatterId : n), cursor);
    if (maxId <= cursor) break;
    cursor = maxId;
    if (batch.length < 200) { windowComplete = true; break; }
  }
  if (!windowComplete) console.log(`  (${client}: window walk did not exhaust; IN WINDOW is a lower bound)`);

  // 3. THE REMAINDER, AND WHAT THE GATE WOULD DO WITH IT.
  const unreached = windowRows.filter((m) => typeof m.MatterId === 'number' && !reachedIds.has(m.MatterId));
  const lostSamples: string[] = [];
  const unheldSamples: string[] = [];
  let lost = 0;
  let unheld = 0;
  for (const m of unreached) {
    const title = m.MatterTitle || m.MatterName || m.MatterFile || '';
    if (!title) continue;
    const d = gateDecide({
      source: 'legistar',
      market: label,
      key: String(m.MatterId ?? title),
      title,
      gate_text: gateText(m),
      bypass_mode: bypassModeFor('legistar'),
      single_purpose: bypass,
    });
    if (!d.admitted) continue;
    lost++;
    const line = `${String(m.MatterIntroDate).slice(0, 10)}  ${title.slice(0, 92)}`;
    if (lostSamples.length < 8) lostSamples.push(line);
    if (!held.has(String(m.MatterId))) {
      unheld++;
      if (unheldSamples.length < 8) unheldSamples.push(line);
    }
  }

  return {
    client,
    label,
    inWindow: windowRows.length,
    reached: windowRows.length - unreached.length,
    unreached: unreached.length,
    lost,
    unheld,
    lostSamples,
    unheldSamples,
    // The cap binds when the request came back full: there was more to give.
    capBinds: reachedRows.length >= TOP,
  };
}

async function main(): Promise<void> {
  console.log('===== WHAT THE FETCH CAP COSTS =====');
  console.log(`LEGISTAR_TOP = ${TOP}, ordered MatterId desc, no date filter, no cursor`);
  console.log(`window: matters introduced since ${monthsAgo(12)}\n`);
  const held = await heldMatterIds();
  console.log(`corpus holds ${held.size} distinct Legistar MatterIds
`);
  console.log(
    'JURISDICTION'.padEnd(24),
    'IN WINDOW'.padStart(10),
    'REACHED'.padStart(8),
    'UNREACHED'.padStart(10),
    'ADMIT'.padStart(6),
    'UNHELD'.padStart(7),
    '  CAP'
  );

  const results: Result[] = [];
  for (const j of DEFAULT_JURISDICTIONS) {
    const r = await measure(j.client, j.jurisdictionLabel, !!j.bypassGate, held);
    if (!r) {
      console.log(j.client.padEnd(24), 'UNREADABLE - not proof of anything, re-run before acting on it');
      continue;
    }
    results.push(r);
    console.log(
      r.client.padEnd(24),
      String(r.inWindow).padStart(10),
      String(r.reached).padStart(8),
      String(r.unreached).padStart(10),
      String(r.lost).padStart(6),
      String(r.unheld).padStart(7),
      r.capBinds ? '  BINDS' : '  ok'
    );
  }

  const totalLost = results.reduce((n, r) => n + r.lost, 0);
  const totalUnheld = results.reduce((n, r) => n + r.unheld, 0);
  const binding = results.filter((r) => r.capBinds).length;

  console.log('\nWHAT IS BEING LOST, by jurisdiction');
  for (const r of results) {
    if (r.lost === 0) {
      console.log(`\n  ${r.label}: nothing. ${r.unreached} matters unreached and the gate would refuse every one.`);
      continue;
    }
    console.log(`\n  ${r.label}: ${r.lost} admissible matters never fetched`);
    for (const s of r.lostSamples) console.log(`    ${s}`);
  }

  console.log(
    `\nTOTAL: ${binding} of ${results.length} jurisdictions are truncated, and ${totalLost} ` +
      `${totalLost === 1 ? 'matter the gate would admit is' : 'matters the gate would admit are'} ` +
      'outside the fetch window.'
  );
  console.log(
    'A LARGER CAP IS NOT THE FIX. Any fixed top-N still binds silently the moment a jurisdiction ' +
      'files more than N between runs; it just moves the day it starts lying.'
  );

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const path = `${OUT_DIR}/fetch-cap-${stamp}.json`;
  writeFileSync(
    path,
    JSON.stringify(
      {
        about: 'What the Legistar fetch cap costs, per jurisdiction, measured against the real gate.',
        cap: TOP,
        laneRequest: `Matters?$top=${TOP}&$orderby=MatterId desc`,
        windowPredicate: `MatterIntroDate > ${monthsAgo(12)}, top 1000`,
        lostMeans: 'in the twelve-month window, NOT inside the top-N the lane fetches, and admitted by gateDecide',
        results,
        totalLost,
        totalUnheld,
      },
      null,
      2
    )
  );
  console.log(`\nwritten: ${path}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
