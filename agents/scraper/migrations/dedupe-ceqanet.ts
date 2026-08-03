// One-off repair: fold the CEQAnet host rehost out of the stored corpus.
//
// CEQAnet moved from ceqanet.opr.ca.gov to ceqanet.lci.ca.gov. url is the upsert
// key, so the same filing was written once per host and every CEQA record in the
// corpus exists twice. sources/ceqanet.ts now canonicalises the host so no new
// pair can appear; this repairs the pairs already stored.
//
// WHICH ROW SURVIVES. Richness is measured and reported, but on this corpus the
// pairs are IDENTICAL in richness, so richness cannot decide it. The canonical-
// host row survives, for a reason that is not aesthetic: the adapter now writes
// the canonical URL, and dismissing that row would tombstone the live URL, so
// the filing would vanish from its project on the next run and never come back.
// The surviving row inherits anything the other row had that it lacked, plus the
// EARLIER first_seen, because first_seen records when we genuinely first saw the
// filing and the duplicate is the older capture.
//
// NOTHING IS DELETED. The loser is DISMISSED, which is the tombstone the scraper
// already honours, so it is never rewritten and never re-clustered - and it is
// still there, visible in Trash, if this turns out to be wrong.
//
// CEQA_DEDUPE_DRY=1 lists every pair and the plan without writing.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { CEQANET_HOSTS, CEQANET_CANONICAL_HOST, canonicalCeqanetUrl } from '../sources/ceqanet';

// Fields that carry information, for the richness comparison.
const RICH_FIELDS = [
  'title', 'raw_content', 'company', 'location', 'published_date', 'deadline',
  'venue_type', 'signal_type', 'development_category', 'source_type', 'region',
  'country', 'region_state', 'market', 'applicant', 'representative',
  'presented_by', 'action_sought', 'primary_document_url', 'contact_name',
  'contact_email', 'contact_phone', 'date_source', 'object_type',
  'milestone_date', 'score_reason',
] as const;

// Philip's columns. Never copied between rows, never written here.
const OWNED_BY_USER = new Set(['status', 'notes', 'manual_overrides', 'status_changed_at']);

type Row = Record<string, unknown>;

function richness(r: Row): number {
  return RICH_FIELDS.filter((f) => r[f] !== null && r[f] !== undefined && r[f] !== '').length;
}

function schOf(url: string): string {
  return url.split('/Project/')[1] ?? url;
}

async function main(): Promise<void> {
  const dry = process.env.CEQA_DEDUPE_DRY === '1';
  const hostFilter = CEQANET_HOSTS.map((h) => `url.ilike.%${h}%`).join(',');
  const { data, error } = await supabaseAdmin.from('leads').select('*').or(hostFilter);
  if (error) throw new Error(`load failed: ${error.message}`);
  const rows = (data ?? []) as Row[];

  const bySch = new Map<string, Row[]>();
  for (const r of rows) {
    const sch = schOf(String(r.url));
    if (!bySch.has(sch)) bySch.set(sch, []);
    bySch.get(sch)!.push(r);
  }

  console.log('===== CEQAnet DEDUPE =====');
  if (dry) console.log('(CEQA_DEDUPE_DRY=1: nothing will be written)');
  console.log(`\nBEFORE: ${rows.length} CEQAnet rows across ${bySch.size} distinct SCH numbers.`);
  const byHost: Record<string, number> = {};
  for (const r of rows) {
    const h = new URL(String(r.url)).hostname;
    byHost[h] = (byHost[h] ?? 0) + 1;
  }
  for (const [h, n] of Object.entries(byHost)) console.log(`   ${String(n).padStart(3)}  ${h}`);

  console.log('\nEVERY DUPLICATE PAIR, and what will happen to it:');
  let dismissed = 0;
  let merged = 0;
  let fieldsCopied = 0;
  let alreadySettled = 0;

  for (const [sch, group] of [...bySch].sort()) {
    if (group.length < 2) {
      console.log(`\n  SCH ${sch}: 1 row, nothing to do.`);
      continue;
    }
    const canonical = group.filter((r) => new URL(String(r.url)).hostname === CEQANET_CANONICAL_HOST);
    const legacy = group.filter((r) => new URL(String(r.url)).hostname !== CEQANET_CANONICAL_HOST);

    console.log(`\n  SCH ${sch} - "${String(group[0].title).slice(0, 60)}"`);
    for (const r of group) {
      console.log(
        `      ${new URL(String(r.url)).hostname.padEnd(20)} richness=${String(richness(r)).padStart(2)} ` +
          `status=${r.status} project=${r.project_id ? 'attached' : 'none'} first_seen=${String(r.first_seen ?? '').slice(0, 10)}`
      );
    }

    if (canonical.length === 0) {
      // No canonical row: rewrite the survivor's URL onto the canonical host
      // rather than dismissing the only copy we have.
      const keep = [...group].sort((a, b) => richness(b) - richness(a))[0];
      const newUrl = canonicalCeqanetUrl(String(keep.url));
      console.log(`      -> no canonical row; rewriting ${keep.url} to ${newUrl}`);
      if (!dry) {
        const { error: e } = await supabaseAdmin.from('leads').update({ url: newUrl }).eq('id', keep.id);
        if (e) console.error(`         rewrite failed: ${e.message}`);
      }
      for (const l of group.filter((r) => r !== keep)) {
        if (!dry) await supabaseAdmin.from('leads').update({ status: 'dismissed', project_id: null, cluster_reason: null }).eq('id', l.id);
        dismissed++;
      }
      continue;
    }

    const keep = [...canonical].sort((a, b) => richness(b) - richness(a))[0];
    const rk = richness(keep);

    for (const loser of [...canonical.filter((r) => r !== keep), ...legacy]) {
      // ALREADY SETTLED. A loser that is dismissed AND detached is in its final
      // state, so re-running must not touch it. Without this the repair is not
      // idempotent: a second run rewrites status_changed_at, which is a curation
      // column, and a status this repair did not set is not this repair's to
      // re-stamp. On the live corpus all three duplicates were already dismissed
      // by the orphan sweep before this script was ever run, so this guard is
      // the difference between a no-op and three silent curation writes.
      if (loser.status === 'dismissed' && !loser.project_id) {
        console.log(
          `      -> ${new URL(String(loser.url)).hostname} already dismissed and detached; leaving it alone`
        );
        alreadySettled++;
        continue;
      }
      const rl = richness(loser);
      const verdict =
        rl > rk
          ? `loser is RICHER (${rl} vs ${rk}); its extra fields are merged onto the survivor`
          : rl === rk
            ? `equal richness (${rl}); canonical host decides`
            : `survivor is richer (${rk} vs ${rl})`;
      console.log(`      -> keep ${new URL(String(keep.url)).hostname}, dismiss ${new URL(String(loser.url)).hostname}: ${verdict}`);

      // Merge anything the survivor lacks, and the earlier first_seen.
      const patch: Row = {};
      for (const f of RICH_FIELDS) {
        if (OWNED_BY_USER.has(f)) continue;
        const kv = keep[f];
        const lv = loser[f];
        if ((kv === null || kv === undefined || kv === '') && lv !== null && lv !== undefined && lv !== '') {
          patch[f] = lv;
        }
      }
      const ks = String(keep.first_seen ?? '');
      const ls = String(loser.first_seen ?? '');
      if (ls && (!ks || ls < ks)) patch.first_seen = loser.first_seen;

      if (Object.keys(patch).length > 0) {
        console.log(`         merging onto survivor: ${Object.keys(patch).join(', ')}`);
        fieldsCopied += Object.keys(patch).length;
        merged++;
        if (!dry) {
          const { error: e } = await supabaseAdmin.from('leads').update(patch).eq('id', keep.id);
          if (e) console.error(`         merge failed: ${e.message}`);
        }
      }

      // Dismiss, never delete. Detached from any project at the same time, so
      // the register stops counting it immediately.
      if (!dry) {
        const { error: e } = await supabaseAdmin
          .from('leads')
          .update({
            status: 'dismissed',
            status_changed_at: new Date().toISOString(),
            project_id: null,
            cluster_reason: null,
          })
          .eq('id', loser.id);
        if (e) console.error(`         dismiss failed: ${e.message}`);
      }
      dismissed++;
    }
  }

  console.log(
    `\nPlanned: ${dismissed} duplicate rows dismissed, ${merged} survivors patched ` +
      `(${fieldsCopied} fields copied), ${alreadySettled} already settled and left alone.`
  );

  if (!dry) {
    const { data: after } = await supabaseAdmin.from('leads').select('url,status').or(hostFilter);
    const live = (after ?? []).filter((r) => r.status !== 'dismissed');
    const hosts: Record<string, number> = {};
    for (const r of live) {
      const h = new URL(String(r.url)).hostname;
      hosts[h] = (hosts[h] ?? 0) + 1;
    }
    console.log(`\nAFTER: ${after?.length} CEQAnet rows stored, ${live.length} live (${(after?.length ?? 0) - live.length} dismissed).`);
    for (const [h, n] of Object.entries(hosts)) console.log(`   ${String(n).padStart(3)}  ${h}  (live)`);
  }
  console.log('==========================\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('CEQAnet dedupe failed:', err);
    process.exitCode = 1;
  });
}
