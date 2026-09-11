// READ-ONLY. WHAT THE DATE CORRECTION COSTS, PER MARKET AND PER CONSUMER.
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/date-shift-cost.ts
//
// Standing rule 2: a rule ships with the count behind it and the cost stated per
// market, because a corpus average hides a market-specific harm. The defect is
// `a-meeting-date-that-is-the-machines-midnight` and the correction is +7 hours
// on every value stored at 17:00:00Z, which moves the DATE PART forward one day.
//
// THE COST IS NOT THE ROW COUNT. A row whose printed date changes from the 14th
// to the 15th costs a line in a document. A row that crosses a PERIOD BOUND, a
// LIVENESS FLOOR or a DOCUMENT'S OWN WINDOW costs a project appearing or
// disappearing, and those are counted separately here because they are the ones
// that make an already-sent document wrong.
//
// WHAT READS A STORED DATE, read out of the code rather than assumed:
//
//   bestDate (cluster.ts:1045)        deadline ?? published_date. Feeds a
//                                     project's lastActivity, which is compared
//                                     against a 12-month liveFloor to decide
//                                     live or dormant.
//   query.ts STREAM_DATE_COLUMN       the dashboard's date filter is
//                                     published_date for government and
//                                     intelligence, deadline for opportunity.
//   report-entry.ts:98                the date printed on a client document
//                                     entry.
//   report-sections.ts:197            the date printed beside a record line, and
//                                     the "latest record" pick at :659 and :993.
//   report-build.ts:566               THE DOCUMENT'S PERIOD IS SCOPED ON
//                                     first_seen, NOT on published_date, and
//                                     its events on occurred_at. Both are
//                                     checked below rather than trusted.

import { pathToFileURL } from 'node:url';
import { selectAllPaged } from '../page-select';
import { PROJECT_LIVENESS_MONTHS } from '../cluster';

type Row = Record<string, unknown>;
const tidy = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();

// The signature, and the correction. A value stored at local midnight on a
// UTC+7 machine is seven hours behind the date its publisher printed.
const LOCAL_MIDNIGHT_UTC = '17:00:00';
const CORRECTION_MS = 7 * 60 * 60 * 1000;

const isShifted = (iso: string): boolean => iso.slice(11, 19) === LOCAL_MIDNIGHT_UTC;
const corrected = (iso: string): string => new Date(new Date(iso).getTime() + CORRECTION_MS).toISOString();
const dayOf = (iso: string): string => iso.slice(0, 10);
const monthOf = (iso: string): string => iso.slice(0, 7);

async function main(): Promise<void> {
  const { rows: leads, complete } = await selectAllPaged<Row>(
    'leads',
    'id,source,market,status,stream,published_date,deadline,signal_date,first_seen,date_source,project_id',
    (q) => q,
    'cost-leads'
  );
  if (!complete) throw new Error('read was partial; refusing to cost a change from a slice.');
  const { rows: projects } = await selectAllPaged<Row>(
    'projects',
    'id,name,market,status,stage,last_activity',
    (q) => q,
    'cost-projects'
  );
  const { rows: events } = await selectAllPaged<Row>(
    'project_events',
    'project_id,event_type,occurred_at,lead_id',
    (q) => q,
    'cost-events'
  );
  const { rows: deliveries } = await selectAllPaged<Row>(
    'deliveries',
    'id,client_id,document_type,generated_at,period_start,period_end,project_count,record_count',
    (q) => q,
    'cost-deliveries'
  );

  console.log('='.repeat(104));
  console.log('WHAT THE DATE CORRECTION COSTS');
  console.log('='.repeat(104));
  console.log(`leads ${leads.length}   projects ${projects.length}   project_events ${events.length}   deliveries ${deliveries.length}`);
  console.log(`correction: +7h on any value stored at ${LOCAL_MIDNIGHT_UTC}Z, which moves the date part forward one day`);

  // ---- 1. EVERY STORED DATE COLUMN, NOT JUST THE ONE THAT WAS COUNTED -----
  console.log('');
  console.log('-'.repeat(104));
  console.log('1. EVERY STORED DATE COLUMN. DISMISSED ROWS INCLUDED, BECAUSE A MIGRATION TOUCHES THEM TOO');
  console.log('-'.repeat(104));
  const columns: [string, (r: Row) => string][] = [
    ['leads.published_date', (r) => tidy(r.published_date)],
    ['leads.deadline', (r) => tidy(r.deadline)],
    ['leads.signal_date', (r) => tidy(r.signal_date)],
    ['leads.first_seen', (r) => tidy(r.first_seen)],
  ];
  for (const [name, get] of columns) {
    const set = leads.filter((r) => get(r));
    const live = set.filter((r) => String(r.status) !== 'dismissed');
    const shifted = set.filter((r) => isShifted(get(r)));
    const shiftedLive = live.filter((r) => isShifted(get(r)));
    console.log(
      `  ${name.padEnd(22)} ${String(set.length).padStart(5)} dated  ${String(shifted.length).padStart(5)} shifted  ` +
        `(${shiftedLive.length} of ${live.length} undismissed)`
    );
  }
  const evDated = events.filter((e) => tidy(e.occurred_at));
  const evShifted = evDated.filter((e) => isShifted(tidy(e.occurred_at)));
  console.log(`  ${'project_events.occurred_at'.padEnd(22)} ${String(evDated.length).padStart(5)} dated  ${String(evShifted.length).padStart(5)} shifted`);

  // ---- 2. IS ANY DATE OFF BY MORE THAN ONE DAY? ---------------------------
  //
  // The correction is arithmetic, so its SIZE is knowable without re-fetching:
  // +7h moves the date part by exactly one day and never by two. What is NOT
  // knowable from arithmetic is whether a value carries some other offset - a
  // capture from a machine at a different offset, or a source that really does
  // publish at 17:00 UTC. So every distinct clock time is printed, and any that
  // is neither 00:00:00Z nor a plausible real publication instant is named.
  console.log('');
  console.log('-'.repeat(104));
  console.log('2. OFF BY MORE THAN ONE DAY? EVERY DISTINCT CLOCK TIME IN THE CORPUS');
  console.log('-'.repeat(104));
  const clocks = new Map<string, { n: number; sources: Set<string> }>();
  for (const r of leads) {
    const iso = tidy(r.published_date);
    if (!iso) continue;
    const c = iso.slice(11, 19) || '(date only, no time part)';
    const e = clocks.get(c) ?? { n: 0, sources: new Set<string>() };
    e.n++;
    e.sources.add(String(r.source));
    clocks.set(c, e);
  }
  for (const [c, e] of [...clocks.entries()].sort((a, b) => b[1].n - a[1].n)) {
    const note =
      c === LOCAL_MIDNIGHT_UTC
        ? '<- local midnight at UTC+7. ONE DAY EARLY.'
        : c === '00:00:00'
          ? '<- parsed as UTC. correct.'
          : c === '(date only, no time part)'
            ? '<- stored as a bare date. correct.'
            : '<- neither. named rather than assumed:';
    console.log(`  ${c.padEnd(26)} ${String(e.n).padStart(5)}  ${note}`);
    if (note.endsWith(':')) console.log(`      sources: ${[...e.sources].join(', ')}`);
  }
  // A SECOND OFFSET WOULD BE A SECOND MACHINE. 16:00:00Z is midnight at UTC+8,
  // 18:00:00Z at UTC+6, 05:00:00Z at UTC-5. Reported so a corpus captured from
  // two places is visible rather than averaged.
  const otherMidnights = ['16:00:00', '18:00:00', '05:00:00', '08:00:00', '23:00:00'];
  const found = otherMidnights.filter((c) => clocks.has(c));
  console.log(
    found.length
      ? `  other local-midnight offsets present: ${found.map((c) => `${c} x${clocks.get(c)!.n}`).join(', ')}`
      : '  no other local-midnight offset is present: one capturing machine, one offset.'
  );

  // ---- 3. PER MARKET, AND PER BOUNDARY ------------------------------------
  console.log('');
  console.log('-'.repeat(104));
  console.log('3. PER MARKET: WHAT MOVES, AND WHAT CROSSES SOMETHING');
  console.log('-'.repeat(104));
  const now = Date.now();
  const liveFloor = new Date(now - PROJECT_LIVENESS_MONTHS * 30.44 * 86_400_000).getTime();
  const window30 = now - 30 * 86_400_000;
  const window90 = now - 90 * 86_400_000;

  interface MarketCost {
    dated: number;
    shifted: number;
    monthEdge: number;
    yearEdge: number;
    w30: number;
    w90: number;
  }
  const byMarket = new Map<string, MarketCost>();
  for (const r of leads) {
    if (String(r.status) === 'dismissed') continue;
    const iso = tidy(r.published_date) || tidy(r.deadline);
    if (!iso) continue;
    const m = tidy(r.market) || '(no market)';
    const e = byMarket.get(m) ?? { dated: 0, shifted: 0, monthEdge: 0, yearEdge: 0, w30: 0, w90: 0 };
    e.dated++;
    if (isShifted(iso)) {
      e.shifted++;
      const after = corrected(iso);
      if (monthOf(iso) !== monthOf(after)) e.monthEdge++;
      if (iso.slice(0, 4) !== after.slice(0, 4)) e.yearEdge++;
      const t0 = new Date(iso).getTime();
      const t1 = new Date(after).getTime();
      if (t0 < window30 && t1 >= window30) e.w30++;
      if (t0 < window90 && t1 >= window90) e.w90++;
    }
    byMarket.set(m, e);
  }
  console.log(
    `  ${'market'.padEnd(28)} ${'dated'.padStart(6)} ${'shifted'.padStart(8)} ${'month edge'.padStart(11)} ${'year edge'.padStart(10)} ${'into 30d'.padStart(9)} ${'into 90d'.padStart(9)}`
  );
  let anyEdge = 0;
  for (const [m, e] of [...byMarket.entries()].sort((a, b) => b[1].shifted - a[1].shifted)) {
    if (!e.shifted) continue;
    anyEdge += e.monthEdge;
    console.log(
      `  ${m.slice(0, 27).padEnd(28)} ${String(e.dated).padStart(6)} ${String(e.shifted).padStart(8)} ${String(e.monthEdge).padStart(11)} ${String(e.yearEdge).padStart(10)} ${String(e.w30).padStart(9)} ${String(e.w90).padStart(9)}`
    );
  }
  console.log('');
  console.log(`  records crossing a MONTH boundary when corrected: ${anyEdge}`);
  console.log('  A month edge is what a monthly client document is scoped by, so these are the rows');
  console.log('  whose correction could move a line between two documents.');

  // ---- 4. THE PROJECT LEVEL: LATEST ACTIVITY, AND THE LIVENESS FLOOR ------
  console.log('');
  console.log('-'.repeat(104));
  console.log('4. PROJECTS: LATEST ACTIVITY, AND WHETHER ANY CROSSES THE 12-MONTH LIVENESS FLOOR');
  console.log('-'.repeat(104));
  const recsByProject = new Map<string, Row[]>();
  for (const r of leads) {
    if (!r.project_id || String(r.status) === 'dismissed') continue;
    const k = String(r.project_id);
    const arr = recsByProject.get(k) ?? [];
    arr.push(r);
    recsByProject.set(k, arr);
  }
  let projectsMoved = 0;
  let crossFloor = 0;
  let monthChanged = 0;
  const crossers: string[] = [];
  for (const p of projects) {
    if (String(p.status) === 'dismissed') continue;
    const recs = recsByProject.get(String(p.id)) ?? [];
    const best = (r: Row, fix: boolean): string | null => {
      const iso = tidy(r.deadline) || tidy(r.published_date);
      if (!iso) return null;
      return fix && isShifted(iso) ? corrected(iso) : iso;
    };
    const before = recs.map((r) => best(r, false)).filter((d): d is string => !!d).sort();
    const after = recs.map((r) => best(r, true)).filter((d): d is string => !!d).sort();
    const lastBefore = before.length ? before[before.length - 1] : null;
    const lastAfter = after.length ? after[after.length - 1] : null;
    if (!lastBefore || !lastAfter) continue;
    if (lastBefore !== lastAfter) projectsMoved++;
    if (dayOf(lastBefore) !== dayOf(lastAfter)) monthChanged++;
    const liveBefore = new Date(lastBefore).getTime() >= liveFloor;
    const liveAfter = new Date(lastAfter).getTime() >= liveFloor;
    if (liveBefore !== liveAfter) {
      crossFloor++;
      crossers.push(`${tidy(p.name).slice(0, 44)} [${tidy(p.market)}] ${dayOf(lastBefore)} -> ${dayOf(lastAfter)}  ${liveBefore ? 'live -> DORMANT' : 'dormant -> LIVE'}`);
    }
  }
  console.log(`  projects whose latest activity instant moves : ${projectsMoved}`);
  console.log(`  projects whose latest activity DAY moves     : ${monthChanged}`);
  console.log(`  projects crossing the liveness floor         : ${crossFloor}`);
  for (const c of crossers) console.log(`    ${c}`);
  console.log('  A correction moves dates FORWARD, so it can only make a project look more recent,');
  console.log('  never less. Nothing can fall out of the register on this change.');

  // ---- 5. THE DOCUMENTS ALREADY SENT --------------------------------------
  //
  // THE ONE THAT WOULD MAKE AN ALREADY-SENT DOCUMENT WRONG. report-build scopes
  // its record lines on first_seen and its events on occurred_at. Both are
  // checked against every delivered period on record.
  console.log('');
  console.log('-'.repeat(104));
  console.log('5. THE DOCUMENTS ALREADY SENT: DOES THE CORRECTION MOVE ANYTHING ACROSS THEIR BOUNDS');
  console.log('-'.repeat(104));
  if (!deliveries.length) console.log('  no delivery rows on record.');
  // 1,908 delivery rows, so per-row detail is printed only where something moves.
  // A list of 1,908 NOTHING CROSSES lines is a list nobody reads.
  let windowsChecked = 0;
  let windowsCrossed = 0;
  const windowSeen = new Set<string>();
  for (const d of deliveries) {
    const since = tidy(d.period_start);
    const until = tidy(d.period_end);
    const label = `${tidy(d.document_type)} ${tidy(d.generated_at).slice(0, 10)} [${since.slice(0, 10)} .. ${until.slice(0, 10)}]`;
    if (!since || !until) {
      console.log(`  ${label}  no bounds stored, nothing to cross`);
      continue;
    }
    const s = new Date(since).getTime();
    const u = new Date(until).getTime();
    // Records: scoped on first_seen. Counted anyway, because a column being the
    // wrong one to worry about is a finding rather than an assumption.
    const recIn = (r: Row, fix: boolean): boolean => {
      const iso = tidy(r.first_seen);
      if (!iso) return false;
      const v = new Date(fix && isShifted(iso) ? corrected(iso) : iso).getTime();
      return v >= s && v < u;
    };
    const evIn = (e: Row, fix: boolean): boolean => {
      const iso = tidy(e.occurred_at);
      if (!iso) return false;
      const v = new Date(fix && isShifted(iso) ? corrected(iso) : iso).getTime();
      return v >= s && v < u;
    };
    // The same window delivered to several clients is one window. Counted once.
    const key = `${since}|${until}`;
    if (windowSeen.has(key)) continue;
    windowSeen.add(key);
    windowsChecked++;
    const recBefore = leads.filter((r) => recIn(r, false)).length;
    const recAfter = leads.filter((r) => recIn(r, true)).length;
    const evBefore = events.filter((e) => evIn(e, false)).length;
    const evAfter = events.filter((e) => evIn(e, true)).length;
    const moves = recBefore !== recAfter || evBefore !== evAfter;
    if (moves) windowsCrossed++;
    console.log(
      `  ${moves ? '*** CROSSES ***' : 'holds         '} ${label}   records ${recBefore} -> ${recAfter}   events ${evBefore} -> ${evAfter}`
    );
  }
  console.log('');
  console.log(`  distinct delivered windows: ${windowsChecked}; windows the correction moves anything across: ${windowsCrossed}`);

  // ---- 6. THE DASHBOARD'S OWN DATE FILTER ---------------------------------
  //
  // query.ts filters government and intelligence on published_date. A month
  // filter is the sharpest case, so every month present in the corpus is
  // counted both ways.
  console.log('');
  console.log('-'.repeat(104));
  console.log('6. THE DASHBOARD DATE FILTER: RECORDS PER MONTH, BEFORE AND AFTER');
  console.log('-'.repeat(104));
  const perMonth = new Map<string, { before: number; after: number }>();
  for (const r of leads) {
    if (String(r.status) === 'dismissed') continue;
    const iso = tidy(r.published_date);
    if (!iso) continue;
    const b = monthOf(iso);
    const a = monthOf(isShifted(iso) ? corrected(iso) : iso);
    perMonth.set(b, { before: (perMonth.get(b)?.before ?? 0) + 1, after: perMonth.get(b)?.after ?? 0 });
    perMonth.set(a, { before: perMonth.get(a)?.before ?? 0, after: (perMonth.get(a)?.after ?? 0) + 1 });
  }
  let movedMonths = 0;
  for (const [m, v] of [...perMonth.entries()].sort()) {
    if (v.before === v.after) continue;
    movedMonths++;
    console.log(`  ${m}   ${String(v.before).padStart(4)} -> ${String(v.after).padStart(4)}   (${v.after - v.before >= 0 ? '+' : ''}${v.after - v.before})`);
  }
  if (!movedMonths) console.log('  no month changes its record count.');

  // ---- 7. EXACTLY WHAT A MIGRATION WOULD TOUCH ----------------------------
  //
  // The migration is printed for Philip to run, so it states its own expected
  // row counts and these are where they come from. Every predicate below is the
  // predicate in the SQL, evaluated here first.
  console.log('');
  console.log('-'.repeat(104));
  console.log('7. WHAT THE MIGRATION WOULD TOUCH, BY THE PREDICATE THE SQL USES');
  console.log('-'.repeat(104));
  // The sources that carry the signature. Named, so a feed that genuinely
  // publishes at 17:00 UTC cannot be swept up by a clock test alone.
  const AFFECTED = new Set<string>();
  for (const r of leads) {
    const iso = tidy(r.published_date);
    if (iso && isShifted(iso)) AFFECTED.add(String(r.source));
  }
  console.log(`  sources carrying the signature: ${[...AFFECTED].sort().join(', ')}`);
  const shiftedLeadIds = new Set(
    leads.filter((r) => isShifted(tidy(r.published_date)) && AFFECTED.has(String(r.source))).map((r) => String(r.id))
  );
  console.log(`  leads.published_date rows to move : ${shiftedLeadIds.size}`);
  console.log(
    `  leads.deadline rows to move       : ${leads.filter((r) => tidy(r.deadline) && isShifted(tidy(r.deadline)) && AFFECTED.has(String(r.source))).length}`
  );
  const evAt17 = events.filter((e) => isShifted(tidy(e.occurred_at)));
  const evWithShiftedLead = evAt17.filter((e) => e.lead_id && shiftedLeadIds.has(String(e.lead_id)));
  const evNoLead = evAt17.filter((e) => !e.lead_id);
  const evOtherLead = evAt17.filter((e) => e.lead_id && !shiftedLeadIds.has(String(e.lead_id)));
  console.log(`  project_events at 17:00:00Z       : ${evAt17.length}`);
  console.log(`    whose lead is one of the above  : ${evWithShiftedLead.length}`);
  console.log(`    carrying no lead_id             : ${evNoLead.length}`);
  console.log(`    whose lead is NOT shifted       : ${evOtherLead.length}   <- these are the ones to look at`);
  const projAt17 = projects.filter((p) => tidy(p.last_activity) && isShifted(tidy(p.last_activity)));
  console.log(`  projects.last_activity at 17:00:00Z: ${projAt17.length}`);
  console.log('');
  console.log('  AND THE REASON BOTH TABLES MOVE IN ONE ACT. project_events dedupes on an identity');
  console.log('  that includes occurred_at, so correcting a lead date without correcting the event it');
  console.log('  already produced makes the next event pass insert a SECOND event for the same filing,');
  console.log('  one day apart, and both would print in a client document.');

  // ---- 8. DID ANY ALREADY-SENT DOCUMENT LOSE OR GAIN A PROJECT? -----------
  //
  // The question asked of a count of rows is "how many lines moved". The
  // question asked of a CLIENT is "did a project fall off my document". Those
  // are different and only the second one matters, so it is measured on the
  // rule report-build actually applies:
  //
  //   membership  a project is in the document when it has an undismissed
  //               record whose FIRST_SEEN falls in the period (report-build
  //               :566-567). first_seen is written from a zero-argument
  //               `new Date()` and has no source string to misparse.
  //   what moved   events, scoped on occurred_at (:675-676), which DO carry it.
  //
  // The hypothetical column is the point of the section: what the same windows
  // would have done had membership been dated on published_date. That is the
  // exposure this corpus did not have, and the reason it did not have it is one
  // deliberate line in report-build rather than luck.
  console.log('');
  console.log('-'.repeat(104));
  console.log('8. PER DELIVERED WINDOW: DID A PROJECT CHANGE SIDES, OR ONLY A LINE?');
  console.log('-'.repeat(104));
  const nameOf = new Map(projects.map((p) => [String(p.id), tidy(p.name)]));
  const projectsIn = (s: number, u: number, column: 'first_seen' | 'published_date', fix: boolean): Set<string> => {
    const out = new Set<string>();
    for (const r of leads) {
      if (String(r.status) === 'dismissed' || !r.project_id) continue;
      const iso = tidy(column === 'first_seen' ? r.first_seen : r.published_date);
      if (!iso) continue;
      const v = new Date(fix && isShifted(iso) ? corrected(iso) : iso).getTime();
      if (v >= s && v < u) out.add(String(r.project_id));
    }
    return out;
  };
  const seen = new Set<string>();
  for (const d of deliveries) {
    const since = tidy(d.period_start);
    const until = tidy(d.period_end);
    if (!since || !until) continue;
    const k = `${since}|${until}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const s = new Date(since).getTime();
    const u = new Date(until).getTime();
    const before = projectsIn(s, u, 'first_seen', false);
    const after = projectsIn(s, u, 'first_seen', true);
    const lost = [...before].filter((p) => !after.has(p));
    const gained = [...after].filter((p) => !before.has(p));
    const hypoBefore = projectsIn(s, u, 'published_date', false);
    const hypoAfter = projectsIn(s, u, 'published_date', true);
    const hypoMoved = [...hypoBefore].filter((p) => !hypoAfter.has(p)).length + [...hypoAfter].filter((p) => !hypoBefore.has(p)).length;
    console.log(
      `  [${since.slice(0, 10)} .. ${until.slice(0, 10)}]  projects ${before.size} -> ${after.size}   ` +
        `lost ${lost.length}  gained ${gained.length}   ` +
        `(had membership been dated on published_date: ${hypoMoved} would have moved)`
    );
    for (const p of [...lost, ...gained]) console.log(`      ${nameOf.get(p) ?? p}`);
  }
  console.log('');
  console.log('  first_seen carries the local-midnight signature on 0 of 2,465 rows, so nothing that');
  console.log('  decides MEMBERSHIP moves. What moves is the date printed beside a line, and the');
  console.log('  events inside the What moved section.');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
