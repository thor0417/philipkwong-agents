// One-off: retag the legacy pre-stream-tagging GLI rows (module 'gli', stream
// null) to their correct stream, and dedupe against already-streamed rows.
//
// These rows all predate the stream column: they are the old GLI news lane
// (source 'gli_serper', lead_type 'gli', no deadline), which today writes stream
// 'intelligence' (project events / trade coverage). So every such row retags to
// 'intelligence'. Rows carrying a real source deadline would be opportunities, but
// none do.
//
// DEDUPE (deletion authorized for THIS migration only, and ONLY here): a legacy row
// that is an EXACT duplicate of an already-streamed row is deleted rather than
// retagged. "Exact duplicate" = same canonical URL (protocol/host/path, query and
// fragment stripped) OR same (normalized title + source + published date). Every
// deletion is listed before it happens. Idempotent: re-running is a no-op once no
// null-stream gli rows remain.
//   node --env-file=.env.local --import tsx agents/scraper/migrations/retag-null-stream.ts
// DRY_RUN=1 reports without writing.

import { supabaseAdmin } from '../../../lib/supabase-admin';

interface Row {
  id: string;
  url: string | null;
  title: string | null;
  source: string | null;
  published_date: string | null;
  deadline: string | null;
}

const canon = (u: string | null): string =>
  String(u ?? '').split('#')[0].split('?')[0].replace(/\/+$/, '').toLowerCase();
const titleKey = (t: string | null, s: string | null, d: string | null): string =>
  `${String(t ?? '').replace(/\s+/g, ' ').trim().toLowerCase()}|${s ?? ''}|${(d ?? '').slice(0, 10)}`;

async function main(): Promise<void> {
  const dry = process.env.DRY_RUN === '1';

  // Already-streamed rows are the retag/dedup targets.
  const { data: streamed, error: e1 } = await supabaseAdmin
    .from('leads')
    .select('url,title,source,published_date')
    .not('stream', 'is', null);
  if (e1) {
    console.error('Fetch streamed failed:', e1.message);
    process.exit(1);
  }
  const streamedUrls = new Set<string>();
  const streamedKeys = new Set<string>();
  for (const r of (streamed ?? []) as Row[]) {
    if (r.url) streamedUrls.add(canon(r.url));
    streamedKeys.add(titleKey(r.title, r.source, r.published_date));
  }

  // Legacy null-stream GLI rows.
  const { data: legacy, error: e2 } = await supabaseAdmin
    .from('leads')
    .select('id,url,title,source,published_date,deadline')
    .eq('module', 'gli')
    .is('stream', null);
  if (e2) {
    console.error('Fetch legacy failed:', e2.message);
    process.exit(1);
  }
  const rows = (legacy ?? []) as Row[];

  const dups: Row[] = [];
  const retag: Row[] = [];
  const unresolved: Row[] = [];
  for (const r of rows) {
    const isDup = (r.url && streamedUrls.has(canon(r.url))) || streamedKeys.has(titleKey(r.title, r.source, r.published_date));
    if (isDup) {
      dups.push(r);
    } else if (r.source === 'gli_serper' && !r.deadline) {
      retag.push(r);
    } else {
      unresolved.push(r);
    }
  }

  console.log(`\n===== LEGACY NULL-STREAM RETAG =====${dry ? '  (DRY_RUN)' : ''}`);
  console.log(`null-stream gli rows: ${rows.length}`);
  console.log(`\nDeletions (exact duplicates of an already-streamed row), listed before deletion: ${dups.length}`);
  for (const d of dups) console.log(`  DELETE id=${d.id} | ${String(d.title ?? '').replace(/\s+/g, ' ').slice(0, 60)} | ${canon(d.url)}`);
  console.log(`\nRetag -> intelligence: ${retag.length}`);
  console.log(`Unresolvable: ${unresolved.length}`);
  for (const u of unresolved) console.log(`  UNRESOLVED id=${u.id} src=${u.source} deadline=${u.deadline} | ${String(u.title ?? '').slice(0, 55)}`);

  if (dry) {
    console.log('=== DRY_RUN: no writes ===\n');
    return;
  }

  if (dups.length > 0) {
    const { error } = await supabaseAdmin.from('leads').delete().in('id', dups.map((d) => d.id));
    if (error) {
      console.error('Delete failed:', error.message);
      process.exit(1);
    }
  }
  let retagged = 0;
  for (const r of retag) {
    const { error } = await supabaseAdmin.from('leads').update({ stream: 'intelligence' }).eq('id', r.id);
    if (error) console.error(`Retag failed for ${r.id}: ${error.message}`);
    else retagged++;
  }

  console.log(`\nRetagged to intelligence: ${retagged}`);
  console.log(`Deleted as duplicates:    ${dups.length}`);
  console.log('====================================\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
