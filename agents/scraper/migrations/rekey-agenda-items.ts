// One-off repair: move stored agenda-item rows onto the stable item identity.
//
// leads.url is the upsert key. Agenda items used to key it on the PARSE ORDINAL
// (`#item-4`), which is a property of the splitter and not of the item, so any
// change in how a document split renamed the item and the next run wrote it
// again instead of updating it. sources/agenda-portal.ts now derives the
// fragment from the item's own case identifiers, or a hash of its subject when
// it prints none. This moves the rows already stored onto that key.
//
// WHAT THIS TOUCHES. Every lead from a source that builds its URL through
// leadsFromAgendaText: clark-tab and agenda-portal (Anaheim, Las Vegas). The
// CFTOD packet lane keys on the printed item number rather than the ordinal and
// is not rewritten here.
//
// NOTHING IS DELETED. Where two rows collapse onto one identity the richer row
// survives and inherits anything the other had that it lacked, plus the earlier
// first_seen. The other is DISMISSED, which is the tombstone the scraper already
// honours, and its URL is moved aside so it cannot block the survivor from
// taking the canonical key. It remains readable in Trash.
//
// THE CURATION LAYER IS NEVER OVERWRITTEN. A row Philip has touched - a status
// other than 'new', any notes, any manual_overrides - is preferred as the
// survivor and is never dismissed by this script. A group holding more than one
// curated row is reported and skipped, because which of them is right is a
// judgement this script has no standing to make.
//
// Dry by default. REKEY_APPLY=1 to write.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { stableItemKey } from '../sources/agenda-portal';
import { selectAllPaged } from '../page-select';

const SOURCES = ['clark-tab', 'agenda-portal'];

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

function isCurated(r: Row): boolean {
  if (r.notes !== null && r.notes !== undefined && r.notes !== '') return true;
  const mo = r.manual_overrides;
  if (mo && typeof mo === 'object' && Object.keys(mo as object).length > 0) return true;
  const status = String(r.status ?? 'new');
  return status !== 'new';
}

function docOf(url: string): string {
  return url.split('#')[0];
}

// The marker this script writes onto a row it has superseded. It has to be
// recognisable, because moving the URL aside does not change the DOCUMENT part
// of it: without this check a second pass regroups the superseded row with its
// own survivor and, since 'dismissed' reads as curation, hands it the key back
// and dismisses the good row instead. Caught on the re-run, before it wrote.
const SUPERSEDED = '~superseded-';

function shortDoc(url: string): string {
  return `...${decodeURIComponent(docOf(url)).slice(-52)}`;
}

async function main(): Promise<void> {
  const apply = process.env.REKEY_APPLY === '1';

  const { rows, complete } = await selectAllPaged<Row>(
    'leads',
    '*',
    (q: unknown) => (q as { in: (c: string, v: string[]) => unknown }).in('source', SOURCES),
    'rekey-agenda-items'
  );
  if (!complete) throw new Error('read was partial; refusing to rewrite identities on an incomplete corpus.');

  const superseded = rows.filter((r) => String(r.url ?? '').includes(SUPERSEDED));
  const items = rows.filter((r) => String(r.url ?? '').includes('#item-') && !String(r.url ?? '').includes(SUPERSEDED));

  console.log('===== AGENDA ITEM RE-KEY =====');
  console.log(apply ? '(REKEY_APPLY=1: writing)' : '(dry run: nothing will be written; set REKEY_APPLY=1 to write)');
  console.log(`\nBEFORE: ${rows.length} rows from ${SOURCES.join(' + ')}, ${items.length} of them item-keyed.`);
  if (superseded.length) console.log(`   (${superseded.length} rows already superseded by an earlier pass, excluded.)`);
  const bySource: Record<string, number> = {};
  for (const r of items) bySource[String(r.source)] = (bySource[String(r.source)] ?? 0) + 1;
  for (const [s, n] of Object.entries(bySource)) console.log(`   ${String(n).padStart(3)}  ${s}`);

  // Group on the identity the scraper will next write.
  const byKey = new Map<string, Row[]>();
  for (const r of items) {
    const newUrl = `${docOf(String(r.url))}#item-${stableItemKey(String(r.title ?? ''))}`;
    if (!byKey.has(newUrl)) byKey.set(newUrl, []);
    byKey.get(newUrl)!.push({ ...r, __newUrl: newUrl });
  }

  const collisions = [...byKey.entries()].filter(([, g]) => g.length > 1);
  const rewritesOnly = [...byKey.entries()].filter(([k, g]) => g.length === 1 && String(g[0].url) !== k);
  const alreadyRight = items.length - collisions.reduce((a, [, g]) => a + g.length, 0) - rewritesOnly.length;

  console.log(
    `\nPLAN: ${byKey.size} distinct item identities. ` +
      `${collisions.length} of them are held by more than one row (${collisions.reduce((a, [, g]) => a + g.length - 1, 0)} redundant rows). ` +
      `${rewritesOnly.length} rows need only a URL rewrite. ${alreadyRight} are already on the right key.`
  );

  console.log('\nEVERY COLLIDING GROUP, and what will happen to it:');
  let dismissed = 0;
  let rewritten = 0;
  let skipped = 0;
  let fieldsCopied = 0;

  for (const [newUrl, group] of collisions) {
    console.log(`\n  IDENTITY ${newUrl.split('#')[1]}`);
    console.log(`    doc  ${shortDoc(newUrl)}`);
    console.log(`    "${String(group[0].title ?? '').slice(0, 90)}"`);
    for (const r of group) {
      console.log(
        `      ${r.id}  was=${String(r.url).split('#')[1]?.padEnd(12)} richness=${String(richness(r)).padStart(2)} ` +
          `status=${String(r.status).padEnd(9)} curated=${isCurated(r) ? 'YES' : 'no '} ` +
          `project=${r.project_id ? String(r.project_id).slice(0, 8) : 'none'} first_seen=${String(r.first_seen ?? '').slice(0, 10)}`
      );
    }

    const curated = group.filter(isCurated);
    if (curated.length > 1) {
      console.log(`      -> SKIPPED: ${curated.length} rows in this group carry curation. Resolve by hand.`);
      skipped++;
      continue;
    }

    const keep = curated[0] ?? [...group].sort((a, b) => richness(b) - richness(a) || String(a.first_seen ?? '').localeCompare(String(b.first_seen ?? '')))[0];
    const losers = group.filter((r) => r !== keep);
    console.log(
      `      -> keep ${String(keep.id).slice(0, 8)} (${curated[0] ? 'curated' : `richest, ${richness(keep)}`}), ` +
        `dismiss ${losers.map((l) => String(l.id).slice(0, 8)).join(', ')}`
    );

    // Merge onto the survivor anything it lacks, and the earlier first_seen.
    const patch: Row = {};
    for (const loser of losers) {
      for (const f of RICH_FIELDS) {
        if (OWNED_BY_USER.has(f)) continue;
        const kv = keep[f];
        const lv = loser[f];
        if ((kv === null || kv === undefined || kv === '') && lv !== null && lv !== undefined && lv !== '' && patch[f] === undefined) {
          patch[f] = lv;
        }
      }
      const ks = String(patch.first_seen ?? keep.first_seen ?? '');
      const ls = String(loser.first_seen ?? '');
      if (ls && (!ks || ls < ks)) patch.first_seen = loser.first_seen;
    }
    if (Object.keys(patch).length > 0) {
      console.log(`         merging onto survivor: ${Object.keys(patch).join(', ')}`);
      fieldsCopied += Object.keys(patch).length;
    }

    // Losers move out of the way FIRST, or the survivor cannot take the key.
    for (const loser of losers) {
      const aside = `${String(loser.url)}~superseded-${String(loser.id).slice(0, 8)}`;
      if (apply) {
        const { error } = await supabaseAdmin
          .from('leads')
          .update({ url: aside, status: 'dismissed', project_id: null, cluster_reason: null })
          .eq('id', loser.id);
        if (error) {
          console.error(`         dismiss failed for ${loser.id}: ${error.message}`);
          continue;
        }
      }
      dismissed++;
    }
    if (apply) {
      const { error } = await supabaseAdmin.from('leads').update({ ...patch, url: newUrl }).eq('id', keep.id);
      if (error) console.error(`         survivor rewrite failed: ${error.message}`);
    }
    if (String(keep.url) !== newUrl) rewritten++;
  }

  console.log(`\nPLAIN REWRITES (one row per identity, URL only):`);
  if (rewritesOnly.length === 0) console.log('  none.');
  for (const [newUrl, [r]] of rewritesOnly) {
    console.log(`  ${r.id}  ${String(r.url).split('#')[1]} -> ${newUrl.split('#')[1]}   ${shortDoc(newUrl)}`);
    if (apply) {
      const { error } = await supabaseAdmin.from('leads').update({ url: newUrl }).eq('id', r.id);
      if (error) console.error(`     rewrite failed: ${error.message}`);
      else rewritten++;
    } else {
      rewritten++;
    }
  }

  console.log(
    `\nAFTER: ${rewritten} rows re-keyed, ${dismissed} dismissed, ${skipped} groups skipped for hand review, ` +
      `${fieldsCopied} fields merged onto survivors.`
  );
  console.log(`Distinct item identities: ${byKey.size} (was ${new Set(items.map((r) => String(r.url))).size} distinct URLs).`);

  await recountProjects(apply);

  if (!apply) console.log('\nNothing was written. Re-run with REKEY_APPLY=1 to apply this plan.');
}

// projects.record_count is a CACHED number. Only a full clustering run rewrites
// it, so it goes stale the moment a row is dismissed or detached by anything
// else - this script, the CEQAnet dedupe, or Philip dismissing a record in the
// dashboard. It was already wrong on the Heart Hotel project before this commit,
// by one, because a Legistar row for the same Clark County case (UC-26-0219) had
// been dismissed as a cross-source duplicate and nothing recomputed the count.
//
// Dismissing rows here would have added four more. Rather than leave a number on
// the register that quietly disagrees with the rows behind it, the count is
// recomputed for every project from the live rows.
async function recountProjects(apply: boolean): Promise<void> {
  const { rows: attached, complete } = await selectAllPaged<{ project_id: string | null; status: string | null }>(
    'leads',
    'project_id,status',
    (q: unknown) => (q as { not: (a: string, b: string, c: null) => unknown }).not('project_id', 'is', null),
    'recount'
  );
  if (!complete) {
    console.log('\nRECOUNT SKIPPED: the read was partial, so a recomputed count could only be wrong.');
    return;
  }
  const live = new Map<string, number>();
  for (const l of attached) {
    if (String(l.status) === 'dismissed') continue;
    live.set(l.project_id!, (live.get(l.project_id!) ?? 0) + 1);
  }

  const { data, error } = await supabaseAdmin.from('projects').select('id,name,record_count');
  if (error) {
    console.log(`\nRECOUNT SKIPPED: ${error.message}`);
    return;
  }
  const projects = (data ?? []) as { id: string; name: string; record_count: number | null }[];
  const drift = projects.filter((p) => (p.record_count ?? 0) !== (live.get(p.id) ?? 0));

  console.log(`\nPROJECT RECORD COUNTS: ${drift.length} of ${projects.length} projects disagree with their live rows.`);
  for (const p of drift) {
    const n = live.get(p.id) ?? 0;
    console.log(`  ${p.id.slice(0, 8)}  ${String(p.record_count ?? 0).padStart(3)} -> ${String(n).padStart(3)}   "${p.name.slice(0, 58)}"`);
    if (apply) {
      const { error: e } = await supabaseAdmin.from('projects').update({ record_count: n }).eq('id', p.id);
      if (e) console.error(`     recount failed: ${e.message}`);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
