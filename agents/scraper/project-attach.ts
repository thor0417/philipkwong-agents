// ATTACH ON WRITE. New captures join their project automatically.
//
// Without this, clustering rots the moment the next run happens: the backfill
// clusters what is stored today, the next scrape writes fifty records that
// belong to it, and the register silently goes stale while looking healthy.
//
// ONE CLUSTERING IMPLEMENTATION, NOT TWO. The obvious design is an incremental
// matcher that compares each new record against stored projects. It is also the
// wrong one: it is a SECOND implementation of the rules, and the moment it
// disagrees with the backfill by one guardrail, the register and the acceptance
// test stop describing the same world. So the write path re-runs the SAME
// engine over the corpus and reconciles. The clusterer is deterministic and the
// backfill is idempotent, so this converges rather than churning.
//
// It also has to be corpus-wide rather than market-wide, because a target-term
// project is deliberately not market-scoped: 'ocvibe' names the same
// development in an Anaheim agenda item and in a trade-press story filed under
// Orange County, and a market slice would split it.
//
// COST. Today: 794 leads, one pass, a few seconds. The reconcile is linear in
// records except the fuzzy entity pass, which is quadratic in DISTINCT
// applicant names within a market. At the 20,000-record scale this system is
// being built for that pass wants an index (blocking on the first token, which
// is already the fuzzy guard) rather than the full cross-product. Stated here
// so the ceiling is known rather than discovered.

import { supabaseAdmin } from '../../lib/supabase-admin';
import { runBackfill } from './migrations/backfill-projects';
import { hospitalityModuleValues } from './pipelines';

export interface AttachReport {
  // Records this run wrote that were considered.
  recordsConsidered: number;
  // Of those, how many ended up on a project that already existed.
  attachedToExisting: number;
  // Of those, how many caused a project to be created.
  attachedToNew: number;
  // Of those, how many carried no signal and stayed in the Inbox.
  leftUnclustered: number;
  // Corpus-wide effects of the reconcile.
  projectsCreated: number;
  projectsUpdated: number;
  projectsTotal: number;
  manualAttachmentsPreserved: number;
  projectFieldsHeldBack: Record<string, number>;
  writeFailures: number;
  skipped: string | null;
}

function emptyReport(skipped: string | null = null): AttachReport {
  return {
    recordsConsidered: 0,
    attachedToExisting: 0,
    attachedToNew: 0,
    leftUnclustered: 0,
    projectsCreated: 0,
    projectsUpdated: 0,
    projectsTotal: 0,
    manualAttachmentsPreserved: 0,
    projectFieldsHeldBack: {},
    writeFailures: 0,
    skipped,
  };
}

// The project ids that existed BEFORE the reconcile, so "attached to an existing
// project" and "caused a new project" can be told apart honestly.
async function existingProjectIds(): Promise<Set<string>> {
  const out = new Set<string>();
  let from = 0;
  const PAGE = 1000;
  for (;;) {
    const { data, error } = await supabaseAdmin.from('projects').select('id').range(from, from + PAGE - 1);
    if (error) throw new Error(`existingProjectIds: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const p of data as { id: string }[]) out.add(p.id);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

// Where a set of URLs ended up after the reconcile.
async function outcomeFor(urls: string[]): Promise<{ id: string; url: string; project_id: string | null }[]> {
  const out: { id: string; url: string; project_id: string | null }[] = [];
  const CHUNK = 100;
  for (let i = 0; i < urls.length; i += CHUNK) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id,url,project_id')
      .in('url', urls.slice(i, i + CHUNK));
    if (error) throw new Error(`outcomeFor: ${error.message}`);
    out.push(...((data ?? []) as { id: string; url: string; project_id: string | null }[]));
  }
  return out;
}

// Reconcile projects after a lane has written, and report where THIS run's
// records landed.
//
// PROJECTS_NO_ATTACH=1 skips it entirely, for a lane run that should not touch
// the register.
export async function attachOnWrite(writtenUrls: string[]): Promise<AttachReport> {
  if (process.env.PROJECTS_NO_ATTACH === '1') return emptyReport('PROJECTS_NO_ATTACH=1');
  if (process.env.PROJECTS_NO_WRITE === '1') return emptyReport('PROJECTS_NO_WRITE=1');
  const urls = [...new Set(writtenUrls.filter(Boolean))];
  if (urls.length === 0) return emptyReport('no records written');

  const before = await existingProjectIds();
  const { report } = await runBackfill();
  const after = await outcomeFor(urls);

  const out = emptyReport();
  out.recordsConsidered = urls.length;
  for (const r of after) {
    if (!r.project_id) out.leftUnclustered++;
    else if (before.has(r.project_id)) out.attachedToExisting++;
    else out.attachedToNew++;
  }
  out.projectsCreated = report.projectsCreated;
  out.projectsUpdated = report.projectsUpdated;
  // The register's true size, read back rather than inferred. created + updated
  // counts the clusters this reconcile produced, which is NOT the table total
  // once a hand-detached record leaves a cluster behind.
  const { count } = await supabaseAdmin.from('projects').select('id', { count: 'exact', head: true });
  out.projectsTotal = count ?? report.projectsCreated + report.projectsUpdated;
  out.manualAttachmentsPreserved = report.manualAttachmentsPreserved;
  out.projectFieldsHeldBack = report.projectFieldsHeldBack;
  out.writeFailures = report.writeFailures;
  return out;
}

// ---- THE INBOX SWEEP -------------------------------------------------------
//
// attachOnWrite only ever REPORTS on the URLs its own run wrote. The reconcile
// underneath it is corpus-wide, so in principle nothing is left behind - but
// only if some lane calls it. A lane that writes and never calls it (the GLI
// standalone entrypoint did exactly this until today) leaves records with a
// null project_id that NO subsequent run will mention, because no later run
// wrote their URLs.
//
// So this sweeps by state rather than by provenance: every record with a null
// project_id, whichever run wrote it, however long ago. It reports the residue
// too, because a record that carries no signal at all is a legitimate Inbox
// resident and must not be confused with an orphan.
export interface SweepReport {
  unattachedBefore: number;
  unattachedAfter: number;
  attached: number;
  projectsCreated: number;
  projectsUpdated: number;
  skipped: string | null;
}

async function countUnattached(): Promise<number> {
  const { count } = await supabaseAdmin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .in('module', hospitalityModuleValues())
    .neq('status', 'dismissed')
    .is('project_id', null);
  return count ?? 0;
}

export async function sweepInbox(): Promise<SweepReport> {
  const empty: SweepReport = {
    unattachedBefore: 0,
    unattachedAfter: 0,
    attached: 0,
    projectsCreated: 0,
    projectsUpdated: 0,
    skipped: null,
  };
  if (process.env.PROJECTS_NO_ATTACH === '1') return { ...empty, skipped: 'PROJECTS_NO_ATTACH=1' };
  if (process.env.PROJECTS_NO_WRITE === '1') return { ...empty, skipped: 'PROJECTS_NO_WRITE=1' };
  const before = await countUnattached();
  const { report } = await runBackfill();
  const after = await countUnattached();
  return {
    unattachedBefore: before,
    unattachedAfter: after,
    attached: before - after,
    projectsCreated: report.projectsCreated,
    projectsUpdated: report.projectsUpdated,
    skipped: null,
  };
}

export function printSweepReport(r: SweepReport): void {
  if (r.skipped) {
    console.log(`Inbox sweep: skipped (${r.skipped}).`);
    return;
  }
  console.log(
    `Inbox sweep: ${r.unattachedBefore} records had no project | ` +
      `${r.attached} attached | ${r.unattachedAfter} remain (no signal to cluster on)`
  );
  console.log(`  projects: ${r.projectsCreated} created, ${r.projectsUpdated} updated`);
}

export function printAttachReport(label: string, r: AttachReport): void {
  if (r.skipped) {
    console.log(`${label} project attachment: skipped (${r.skipped}).`);
    return;
  }
  console.log(
    `${label} project attachment: ${r.recordsConsidered} records written | ` +
      `${r.attachedToExisting} joined an existing project | ` +
      `${r.attachedToNew} created a new project | ` +
      `${r.leftUnclustered} left unclustered (Inbox)`
  );
  console.log(
    `  register now: ${r.projectsTotal} projects in total ` +
      `(${r.projectsCreated} created this run, ${r.projectsUpdated} updated)` +
      (r.manualAttachmentsPreserved ? ` | ${r.manualAttachmentsPreserved} manual attachments preserved` : '') +
      (r.writeFailures ? ` | ${r.writeFailures} write failures` : '')
  );
  const held = Object.entries(r.projectFieldsHeldBack);
  if (held.length) {
    console.log(`  project fields held back by a manual override: ${held.map(([f, n]) => `${f} x${n}`).join(', ')}`);
  }
}
