// Two-object-model purge (Phase 1), superseding the flat pre-2026 purge.
//
// DELETES only DEAD OLD OPPORTUNITIES: a lead with a real source submission
// deadline whose deadline is before 2026-01-01 AND that has no future milestone
// (shouldDelete). PROJECT EVENTS ARE NEVER DELETED -- they archive/go dormant by
// verdict, and anything with a future milestone is always kept. This is a strict
// narrowing of the old flat purge (which deleted any pre-2026-dated lead).
//
// Safety: backs up the to-be-deleted set to JSON before deleting. DRY_RUN=1
// reports without deleting. No migration needed (reads existing columns).
//   DRY_RUN=1 node --env-file=.env.local --import tsx agents/scraper/migrations/purge-project-model.ts

import { writeFileSync } from 'node:fs';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { classifyLead, deriveLeadDates } from '../lead-date';
import type { NormalizedLead } from '../sources/types';

const MS_DAY = 86400000;
function isFuture(iso: string | null, now: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t > now;
}

interface Row {
  id: string;
  stream: string | null;
  title: string | null;
  raw_content: string | null;
  deadline: string | null;
  published_date: string | null;
  url: string | null;
}

const BACKUP_PATH = (process.env.PURGE_BACKUP_DIR ?? '.') + '/gli-project-model-deleted-backup.json';

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === '1';
  const { data, error } = await supabaseAdmin
    .from('leads')
    .select('id, stream, title, raw_content, deadline, published_date, url')
    .eq('module', 'gli');
  if (error) {
    console.error('Fetch failed:', error.message);
    process.exit(1);
  }
  const rows = (data ?? []) as Row[];

  const now = Date.now();
  const objectCount: Record<string, number> = { opportunity: 0, project_event: 0 };
  const verdictCount: Record<string, number> = {};
  // Live project events, sub-classified by WHY they are live.
  let liveViaMilestone = 0;
  let liveViaRecent = 0;
  let liveViaUndated = 0;
  // Per stream: genuine live count (opportunities live + project events live).
  const livePerStream: Record<string, number> = {};
  const toDelete: Array<{ id: string; stream: string | null; title: string | null; deadline: string | null; milestone: string | null; url: string | null }> = [];

  for (const r of rows) {
    const lead: NormalizedLead = {
      title: r.title ?? '', raw_content: r.raw_content ?? '', url: r.url ?? '', company: null,
      location: null, deadline: r.deadline, published_date: r.published_date, value_estimate: null, source: '',
    };
    const m = classifyLead(lead, now);
    objectCount[m.object_type]++;
    verdictCount[`${m.object_type}:${m.verdict}`] = (verdictCount[`${m.object_type}:${m.verdict}`] ?? 0) + 1;
    const streamKey = r.stream ?? 'null';
    if (m.verdict === 'live') livePerStream[streamKey] = (livePerStream[streamKey] ?? 0) + 1;
    if (m.object_type === 'project_event' && m.verdict === 'live') {
      const best = deriveLeadDates(lead).published_date;
      if (isFuture(m.milestone_date, now)) liveViaMilestone++;
      else if (best && new Date(best).getTime() >= now - 365 * MS_DAY) liveViaRecent++;
      else liveViaUndated++;
    }
    if (m.object_type === 'opportunity' && m.verdict === 'delete') {
      toDelete.push({ id: r.id, stream: r.stream, title: r.title, deadline: r.deadline, milestone: m.milestone_date, url: r.url });
    }
  }

  const liveOpp = verdictCount['opportunity:live'] ?? 0;
  const archOpp = verdictCount['opportunity:archive'] ?? 0;
  const liveProj = verdictCount['project_event:live'] ?? 0;
  const dormant = verdictCount['project_event:dormant'] ?? 0;
  const archived = verdictCount['project_event:archived'] ?? 0;

  console.log('\n===== GLI TWO-OBJECT PURGE =====' + (dryRun ? '  (DRY_RUN: no deletes)' : ''));
  console.log(`Total GLI leads:            ${rows.length}`);
  console.log(`  opportunities:            ${objectCount.opportunity}  (live ${liveOpp} | archive ${archOpp} | delete ${toDelete.length})`);
  console.log(`  project events:           ${objectCount.project_event}  (live ${liveProj} | dormant ${dormant} | archived ${archived})`);
  console.log('\n-- Honest report (Phase 1 item 4) --');
  console.log(`Opportunities DELETED (pre-2026, no future milestone): ${toDelete.length}`);
  console.log(`Project events kept-live via RECENT date (<=12mo):     ${liveViaRecent}`);
  console.log(`Project events kept-live via FUTURE milestone:         ${liveViaMilestone}`);
  console.log(`Project events kept-live but UNDATED (badge review):   ${liveViaUndated}`);
  console.log(`Dormant (12-24mo, held separately):                    ${dormant}`);
  console.log(`Archived (opp closed + project >24mo):                 ${archOpp + archived}`);
  console.log(`\nGenuine live total: ${liveOpp + liveProj}  (opportunities ${liveOpp} + projects ${liveProj})`);
  console.log('Genuine live per stream:');
  for (const s of Object.keys(livePerStream).sort()) console.log(`    ${s.padEnd(13)} ${livePerStream[s]}`);
  for (const d of toDelete.slice(0, 20)) {
    console.log(`  DEL [${(d.deadline ?? '').slice(0, 10)}] ${(d.title ?? '').slice(0, 66)}`);
  }

  if (toDelete.length === 0) {
    console.log('\nNothing to delete (no dead pre-2026 opportunities).');
    console.log('=================================\n');
    return;
  }
  try {
    writeFileSync(BACKUP_PATH, JSON.stringify(toDelete, null, 2));
    console.log(`\nBackup of ${toDelete.length} to-be-deleted rows -> ${BACKUP_PATH}`);
  } catch (e) {
    console.error(`Backup write failed (${String(e).slice(0, 80)}).`);
    if (!dryRun) {
      console.error('Refusing to delete without a backup. Aborting.');
      process.exit(1);
    }
  }
  if (dryRun) {
    console.log('DRY_RUN: no rows deleted.');
    console.log('=================================\n');
    return;
  }
  const ids = toDelete.map((d) => d.id);
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const { error: delErr } = await supabaseAdmin.from('leads').delete().in('id', batch);
    if (delErr) {
      console.error(`Delete batch ${i / 100} failed: ${delErr.message}`);
      continue;
    }
    deleted += batch.length;
  }
  console.log(`\nDeleted ${deleted} dead pre-2026 opportunities.`);
  console.log('=================================\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
