// THE CLEANOUT. Brief U item 2.
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/migrations/tombstone-holdings.ts            dry run
//   TOMBSTONE_APPLY=1 node --env-file=.env.local --import tsx \
//     agents/scraper/migrations/tombstone-holdings.ts            writes
//
// NOTHING IS DELETED. Standing rule 6. A tombstoned project keeps every row it
// has: `status` becomes 'dismissed', `notes` records WHY and WHEN and by which
// judgement, and the records stay attached to it. It reads back in Trash and can
// be restored by setting status back. The register's own query is
// `status <> 'dismissed'`, so this is exactly the removal the screen means.
//
// ---------------------------------------------------------------------------
// IT DECIDES NOTHING ITSELF. It applies a judgement already on disk.
// ---------------------------------------------------------------------------
//
// The buckets come from snapshots/holdings-judgement-live.json, produced by
// diagnostics/holdings-judgement.ts against the cached labels in
// fixtures/holdings-labels.jsonl (judge claude-sonnet-5, rubric q1-v1). Those
// labels are committed, so a label can be corrected by hand and this re-run,
// which is the point of caching them: a removal nobody can audit is a deletion
// with extra steps.
//
// ---- WHAT IT TAKES, AND WHAT IT DELIBERATELY DOES NOT ----------------------
//
// TAKEN:
//   housekeeping   the bucket whose definition is "cleared the gate on a word".
//                  96 projects, and across all 96 the entry builder prints 11
//                  named parties, 5 stated facts and ZERO conditions.
//   no records     a project row with nothing attached to it at all. Five exist
//                  and all five are "Disney / CFTOD (<market>)" shells.
//   duplicates     two live projects with the same name in the same market and
//                  different keys. The one with fewer records goes; the other
//                  keeps everything.
//
// NOT TAKEN, and each for a stated reason:
//   instrument         148 projects, 34 of them carrying conditions of approval
//                      and 121 a named party. A gaming licence extension on the
//                      Mirage is an instrument and it is also the subject. The
//                      bucket separates a filing about a SCHEME from a filing
//                      about an ACT, which is not the same question as whether
//                      it is worth holding.
//   development-other  61 projects, 50 with a stated fact and 9 with conditions.
//                      They are real developments outside the vertical, and
//                      removing them is a SCOPE decision rather than a junk one:
//                      it strips 37 of Clark County's 122 live projects, the
//                      best-covered market in the corpus. Reported, not taken.
//
// ---- AND THREE HOLDBACKS, WHICH IS WHERE THE RISK ACTUALLY IS --------------
//
// The judge is a model. A wrong label here removes a real project from a real
// register, so three classes are refused even when the bucket says take them,
// and every refusal is printed with its reason:
//
//   CURATED      Philip has touched it: notes, a manual override, a watch flag,
//                or any status other than 'new'. Same rule as
//                dismiss-excluded-government, and for the same reason.
//   SHOWN        a client_projects row with status 'included'. A project a
//                client has already been shown may not vanish out from under a
//                document that cited it.
//   DISPUTED     the taxonomy disagrees with the judge: the project carries a
//                venue_type, which is the classifier saying it IS a hospitality
//                or entertainment venue, while the judge called it housekeeping.
//                Two classifiers disagreeing is a finding, not a mandate.

import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { selectAllPaged } from '../page-select';

const JUDGEMENT = 'snapshots/holdings-judgement-live.json';

interface JudgedRow {
  id: string;
  name: string;
  market: string;
  bucket: string;
  reason: string;
  records: number;
  noEntry: boolean;
}

type ProjectRow = Record<string, unknown>;

function isCurated(p: ProjectRow): boolean {
  if (p.notes !== null && p.notes !== undefined && String(p.notes).trim() !== '') return true;
  const mo = p.manual_overrides;
  if (mo && typeof mo === 'object' && Object.keys(mo as object).length > 0) return true;
  if (p.watch === true) return true;
  return String(p.status ?? 'new') !== 'new';
}

const REASONS: Record<string, string> = {
  housekeeping:
    'municipal housekeeping: the filing names no scheme and no site, and cleared the government gate on a word',
  'no-records': 'a project row with no records attached to it at all',
  duplicate: 'a duplicate of another live project with the same name in the same market',
};

async function main(): Promise<void> {
  const apply = process.env.TOMBSTONE_APPLY === '1';
  const today = new Date().toISOString().slice(0, 10);

  const judged = JSON.parse(readFileSync(JUDGEMENT, 'utf8')) as { rows: JudgedRow[]; judge: string; rubric: string };
  const byId = new Map(judged.rows.map((r) => [r.id, r]));

  const { rows: projects, complete } = await selectAllPaged<ProjectRow>(
    'projects',
    'id,name,project_key,market,module,status,stage,notes,manual_overrides,watch,record_count,venue_type,development_category,significance,name_source',
    (q) => q,
    'tombstone-holdings'
  );
  if (!complete) throw new Error('read was partial; refusing to sweep a slice of the corpus.');

  const live = projects.filter((p) => String(p.status) !== 'dismissed');

  // Every project a client has actually been shown.
  const { rows: membership } = await selectAllPaged<Record<string, unknown>>(
    'client_projects',
    'project_id,status',
    (q) => q,
    'tombstone-membership'
  );
  const shown = new Set(
    membership.filter((m) => String(m.status) === 'included').map((m) => String(m.project_id))
  );

  // ---- the candidate set ---------------------------------------------------
  const candidates = new Map<string, { p: ProjectRow; why: string }>();

  for (const p of live) {
    const j = byId.get(String(p.id));
    if (j && j.bucket === 'housekeeping') candidates.set(String(p.id), { p, why: 'housekeeping' });
  }
  // NOT FROM THE CACHED COUNTER. `projects.record_count` is written by the
  // clusterer and recomputed by project-recount, so it is a cache, and a cache
  // that says zero on a project that has rows would tombstone something real.
  // The rows themselves are counted instead: every undismissed lead, paged to
  // exhaustion, grouped by project_id.
  const { rows: leadRows, complete: leadsComplete } = await selectAllPaged<Record<string, unknown>>(
    'leads',
    'id,project_id,status',
    (q) => q,
    'tombstone-leads'
  );
  if (!leadsComplete) throw new Error('lead read was partial; refusing to judge emptiness on a slice.');
  const attached = new Map<string, number>();
  for (const l of leadRows) {
    if (!l.project_id || String(l.status) === 'dismissed') continue;
    const k = String(l.project_id);
    attached.set(k, (attached.get(k) ?? 0) + 1);
  }
  let counterDisagreed = 0;
  for (const p of live) {
    const real = attached.get(String(p.id)) ?? 0;
    if (real !== Number(p.record_count ?? 0)) counterDisagreed++;
    if (real === 0 && !candidates.has(String(p.id))) {
      candidates.set(String(p.id), { p, why: 'no-records' });
    }
  }
  // Duplicates: same name, same market, different key. The row with FEWER
  // records goes, so nothing that carries evidence is the one removed.
  const byNameMarket = new Map<string, ProjectRow[]>();
  for (const p of live) {
    const k = `${String(p.name).trim().toLowerCase()}||${String(p.market ?? '').toLowerCase()}`;
    if (!byNameMarket.has(k)) byNameMarket.set(k, []);
    byNameMarket.get(k)!.push(p);
  }
  const dupPairs: string[] = [];
  for (const [k, group] of byNameMarket) {
    if (group.length < 2) continue;
    const sorted = [...group].sort(
      (a, b) => Number(b.record_count ?? 0) - Number(a.record_count ?? 0) || String(a.id).localeCompare(String(b.id))
    );
    dupPairs.push(
      `${sorted[0].name} (${sorted[0].market}) : keep ${sorted[0].project_key} (${sorted[0].record_count} records), ` +
        `drop ${sorted.slice(1).map((x) => `${x.project_key} (${x.record_count} records)`).join(', ')}`
    );
    for (const loser of sorted.slice(1)) {
      if (!candidates.has(String(loser.id))) candidates.set(String(loser.id), { p: loser, why: 'duplicate' });
    }
    void k;
  }

  // ---- the holdbacks -------------------------------------------------------
  const held: { p: ProjectRow; why: string; hold: string }[] = [];
  const take: { p: ProjectRow; why: string }[] = [];
  for (const c of candidates.values()) {
    const hold = isCurated(c.p)
      ? 'CURATED'
      : shown.has(String(c.p.id))
        ? 'SHOWN'
        : c.p.venue_type && c.why === 'housekeeping'
          ? 'DISPUTED'
          : null;
    if (hold) held.push({ ...c, hold });
    else take.push(c);
  }

  // ---- report --------------------------------------------------------------
  console.log('='.repeat(96));
  console.log('THE CLEANOUT. Brief U item 2.');
  console.log('='.repeat(96));
  console.log(apply ? '(TOMBSTONE_APPLY=1: WRITING)' : '(dry run: set TOMBSTONE_APPLY=1 to write)');
  console.log(`judgement ${JUDGEMENT}, judge ${judged.judge}, rubric ${judged.rubric}`);
  console.log(`projects table: ${projects.length} rows, ${live.length} live, read paged to exhaustion (no cap)`);
  console.log(`leads table   : ${leadRows.length} rows, read paged to exhaustion (no cap)`);
  console.log(
    `record_count vs the rows themselves: ${counterDisagreed} of ${live.length} live projects disagree. ` +
      `Emptiness is judged on the ROWS, never on the cached counter.`
  );
  console.log('');

  const bucketOf = (p: ProjectRow) => byId.get(String(p.id))?.bucket ?? '(unjudged)';
  console.log('CANDIDATES BY REASON');
  for (const why of ['housekeeping', 'no-records', 'duplicate']) {
    const n = [...candidates.values()].filter((c) => c.why === why).length;
    const t = take.filter((c) => c.why === why).length;
    console.log(`  ${why.padEnd(14)} ${String(n).padStart(4)} candidates, ${String(t).padStart(4)} taken, ${n - t} held back`);
  }
  console.log('');

  console.log('PER MARKET, WHAT THIS COSTS');
  console.log('  market              live   taken   remaining   of the taken: vertical/other/instrument/housekeeping');
  const markets = [...new Set(live.map((p) => String(p.market ?? '(none)')))].sort();
  for (const m of markets) {
    const inM = live.filter((p) => String(p.market ?? '(none)') === m);
    const tk = take.filter((c) => String(c.p.market ?? '(none)') === m);
    if (tk.length === 0) {
      console.log(`  ${m.slice(0, 18).padEnd(19)} ${String(inM.length).padStart(5)} ${String(0).padStart(7)} ${String(inM.length).padStart(11)}`);
      continue;
    }
    const b = (k: string) => tk.filter((c) => bucketOf(c.p) === k).length;
    console.log(
      `  ${m.slice(0, 18).padEnd(19)} ${String(inM.length).padStart(5)} ${String(tk.length).padStart(7)} ` +
        `${String(inM.length - tk.length).padStart(11)}   ${b('development-vertical')}/${b('development-other')}/${b('instrument')}/${b('housekeeping')}`
    );
  }
  console.log(
    `  ${'TOTAL'.padEnd(19)} ${String(live.length).padStart(5)} ${String(take.length).padStart(7)} ${String(live.length - take.length).padStart(11)}`
  );
  console.log('');

  if (dupPairs.length) {
    console.log('DUPLICATE NAME+MARKET PAIRS');
    for (const d of dupPairs) console.log(`  ${d}`);
    console.log('');
  }

  if (held.length) {
    console.log(`HELD BACK (${held.length}). Each is a candidate the rules above refuse to take.`);
    for (const h of held) {
      console.log(
        `  ${h.hold.padEnd(9)} ${String(h.p.market ?? '(none)').slice(0, 16).padEnd(17)} ` +
          `${String(h.p.name).slice(0, 52).padEnd(53)} [${h.why}${h.p.venue_type ? `, venue_type=${h.p.venue_type}` : ''}]`
      );
    }
    console.log('');
  }

  console.log(`NOT TAKEN BY DESIGN, reported so the decision is visible:`);
  const notTaken = live.filter((p) => !candidates.has(String(p.id)));
  for (const b of ['development-vertical', 'development-other', 'instrument']) {
    const n = notTaken.filter((p) => bucketOf(p) === b).length;
    console.log(`  ${b.padEnd(22)} ${String(n).padStart(4)} kept`);
  }
  console.log(`  ${'(unjudged)'.padEnd(22)} ${String(notTaken.filter((p) => bucketOf(p) === '(unjudged)').length).padStart(4)} kept`);
  console.log('');

  console.log(`PLAN: tombstone ${take.length} of ${live.length} live projects, leaving ${live.length - take.length}.`);
  console.log('');

  // ---- write ---------------------------------------------------------------
  let done = 0;
  for (const c of take) {
    const note =
      `[tombstoned ${today}] ${REASONS[c.why]}. ` +
      `Judgement: ${judged.judge} / ${judged.rubric}` +
      (byId.get(String(c.p.id))?.reason ? ` - "${byId.get(String(c.p.id))!.reason}"` : '') +
      `. Nothing is deleted: the records stay attached and the row restores by setting status back to 'new'.`;
    if (apply) {
      const { error } = await supabaseAdmin
        .from('projects')
        .update({ status: 'dismissed', notes: note })
        .eq('id', String(c.p.id));
      if (error) {
        console.error(`  FAILED ${String(c.p.id).slice(0, 8)} ${c.p.name}: ${error.message}`);
        continue;
      }
    }
    done++;
  }
  console.log(apply ? `TOMBSTONED ${done}.` : `WOULD TOMBSTONE ${done}. Nothing was written.`);

  // ---- READ IT BACK. Standing rule 11. -------------------------------------
  if (apply) {
    const { rows: after } = await selectAllPaged<ProjectRow>(
      'projects',
      'id,status,module,market',
      (q) => q,
      'tombstone-readback'
    );
    const liveAfter = after.filter((p) => String(p.status) !== 'dismissed');
    console.log('');
    console.log('READ BACK FROM THE TABLE, not from the loop above:');
    console.log(`  rows            ${after.length}`);
    console.log(`  live before     ${live.length}`);
    console.log(`  live after      ${liveAfter.length}`);
    console.log(`  difference      ${live.length - liveAfter.length}  (expected ${done})`);
    if (live.length - liveAfter.length !== done) {
      throw new Error('the table does not agree with what this run thinks it wrote');
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
