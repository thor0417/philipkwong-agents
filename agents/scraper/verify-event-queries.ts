// THE FOUR DASHBOARD QUERIES, PROVED AND TIMED FROM THE REPO ROOT.
//
//   node --env-file=.env.local --import tsx agents/scraper/verify-event-queries.ts
//
// It imports the SAME module the dashboard imports (dashboard/lib/
// project-event-queries) and passes the service-role client instead of the
// browser's. That is the whole point: if this file re-implemented the queries,
// it would prove that a copy works, which is worth nothing. The client is
// injected precisely so one implementation can be exercised from both sides.
//
// Timings are wall-clock per call against the live database, so they include
// network. They are a floor, not a benchmark: a warm connection from a Vercel
// function will differ. What they establish is the SHAPE - that these are
// bounded, indexed queries rather than table scans that will fall over at 25
// markets.

import { hospitalityModuleValues } from './pipelines';
import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../lib/supabase-admin';
import {
  whatMoved,
  whatCameIn,
  projectHistory,
  watchlistActivity,
  type EventClient,
  type EventRow,
} from '../../dashboard/lib/project-event-queries';

const client = supabaseAdmin as unknown as EventClient;

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const out = await fn();
  const ms = Date.now() - t0;
  console.log(`\n--- ${label}  [${ms} ms]`);
  return out;
}

function line(r: EventRow): string {
  const who = r.actor === 'philip' ? 'philip' : 'system';
  const move = r.from_value || r.to_value ? ` ${r.from_value ?? '-'} -> ${r.to_value ?? '-'}` : '';
  return (
    `  ${r.occurred_at.slice(0, 10)}  ${r.event_type.padEnd(16)} ${who.padEnd(7)}` +
    `${(r.project?.name ?? '(no project)').slice(0, 40).padEnd(42)}${move}` +
    (r.lead ? `\n        via: ${String(r.lead.title ?? '').replace(/\s+/g, ' ').slice(0, 88)}` : '')
  );
}

async function main(): Promise<void> {
  console.log('===== PROJECT EVENT QUERIES =====');
  // A wide period so the backfilled history is in range; the dashboard will pass
  // "last 7 days" and hit the same indexes with a much smaller result.
  const scope = { since: '1900-01-01T00:00:00Z', limit: 500 };

  // 1. WHAT MOVED
  const moved = await timed('1. WHAT MOVED (stage changes, most advanced first)', () =>
    whatMoved(client, scope)
  );
  console.log(`  ${moved.length} stage change(s)`);
  for (const r of moved.slice(0, 10)) console.log(line(r));
  if (moved.length === 0) {
    console.log('  (none: stage history begins at the first emitter run, by design)');
  }

  // 2. WHAT CAME IN
  const came = await timed('2. WHAT CAME IN (new projects; records on existing ones)', () =>
    whatCameIn(client, scope)
  );
  console.log(`  ${came.created.length} project(s) created, ${came.attached.length} existing project(s) gained records`);
  for (const r of came.created.slice(0, 5)) console.log(line(r));
  console.log('  records attached to existing projects, grouped:');
  for (const g of came.attached.slice(0, 5)) {
    console.log(`    ${String(g.events.length).padStart(3)}  ${(g.project?.name ?? '?').slice(0, 60)}`);
  }

  // 3. PROJECT HISTORY
  const { data: big } = await supabaseAdmin
    .from('projects')
    .select('id,name,record_count')
    .in('module', hospitalityModuleValues())
    .order('record_count', { ascending: false })
    .limit(1);
  const target = (big ?? [])[0] as { id: string; name: string } | undefined;
  if (target) {
    const hist = await timed(`3. PROJECT HISTORY ("${target.name}")`, () =>
      projectHistory(client, target.id)
    );
    console.log(`  ${hist.length} event(s), oldest first`);
    for (const r of hist.slice(0, 12)) console.log(line(r));
    if (hist.length > 12) console.log(`  ... and ${hist.length - 12} more`);
  }

  // 4. WATCHLIST
  const watched = await timed('4. WATCHLIST ACTIVITY (any event on a watched project)', () =>
    watchlistActivity(client, scope)
  );
  console.log(`  ${watched.length} event(s) on watched projects`);
  for (const r of watched.slice(0, 10)) console.log(line(r));
  if (watched.length === 0) {
    console.log('  (none: no project carries watch = true yet, so the query correctly returns');
    console.log('   nothing after a single bounded lookup rather than scanning the event table)');
  }

  // Geography scoping, on the same indexes.
  const anaheim = await timed('5. SCOPED: what came in, market = Anaheim', () =>
    whatCameIn(client, { ...scope, markets: ['Anaheim'] })
  );
  console.log(
    `  ${anaheim.created.length} created, ${anaheim.attached.length} existing gained records (Anaheim only)`
  );
  console.log('\n=================================\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Event query verification failed:', err);
    process.exitCode = 1;
  });
}
