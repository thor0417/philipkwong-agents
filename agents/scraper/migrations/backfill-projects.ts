// Backfill: cluster the stored corpus into projects (clustering brief, Part D).
//
// Reads every module 'gli' lead, runs the clustering engine over the whole
// corpus at once, writes the projects, and stamps each lead with its project_id
// and the cluster_reason that attached it.
//
// IDEMPOTENT. Projects upsert on (module, project_key), so re-running lands on
// the same rows rather than duplicating them.
//
// WHAT IT WILL NOT DO:
//   - attach a dismissed lead to a project (the engine never sees them), and it
//     DETACHES any dismissed lead that was attached before it was dismissed;
//   - overwrite a manual attachment (cluster_reason 'manual' is Philip's, and
//     the backfill leaves those leads exactly where he put them);
//   - overwrite a manually overridden project field, or write status, notes,
//     watch, or manual_overrides at all.
//
// PROJECTS_NO_WRITE=1 runs the whole thing and prints the report without
// writing, which is how the acceptance test is inspected before committing to a
// change.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { clusterRecords, type ClusterRecord, type ClusteredProject } from '../cluster';
import { loadProjects, projectRow, dropEmptyEnrichment } from '../project-write';

const MODULE = 'gli';

const LEAD_COLUMNS =
  'id,url,title,raw_content,source,source_type,stream,status,lifecycle,object_type,' +
  'location,country,region_state,market,applicant,representative,presented_by,action_sought,' +
  'venue_type,development_category,published_date,deadline,milestone_date,first_seen,' +
  'date_source,project_id,cluster_reason';

interface LeadRow extends ClusterRecord {
  id: string;
  project_id: string | null;
  cluster_reason: string | null;
}

async function loadLeads(): Promise<LeadRow[]> {
  const all: LeadRow[] = [];
  let from = 0;
  const PAGE = 500;
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select(LEAD_COLUMNS)
      .eq('module', MODULE)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`loadLeads: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as LeadRow[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

export interface BackfillReport {
  leadsRead: number;
  dismissedSkipped: number;
  projectsCreated: number;
  projectsUpdated: number;
  projectFieldsHeldBack: Record<string, number>;
  leadsAttached: number;
  leadsUnclustered: number;
  leadsDetached: number;
  dismissedDetached: number;
  manualAttachmentsPreserved: number;
  reasonCounts: Record<string, number>;
  writeFailures: number;
  // Empty project rows left behind by a project_key change.
  orphansRemoved: number;
  // Orphans that carried curation and were kept, with record_count corrected.
  orphansKept: string[];
}

// Update a set of lead ids in chunks, so the query string cannot overflow.
async function updateLeads(ids: string[], patch: Record<string, unknown>): Promise<number> {
  let failed = 0;
  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { error } = await supabaseAdmin.from('leads').update(patch).in('id', slice);
    if (error) {
      console.error(`  lead update failed for ${slice.length} rows: ${error.message}`);
      failed += slice.length;
    }
  }
  return failed;
}

export async function runBackfill(): Promise<{
  report: BackfillReport;
  projects: ClusteredProject[];
  unclustered: ClusterRecord[];
  cluster: ReturnType<typeof clusterRecords>;
}> {
  const noWrite = process.env.PROJECTS_NO_WRITE === '1';
  const leads = await loadLeads();
  const byId = new Map(leads.map((l) => [l.id, l]));

  const cluster = clusterRecords(leads);

  const report: BackfillReport = {
    leadsRead: leads.length,
    dismissedSkipped: cluster.skippedDismissed,
    projectsCreated: 0,
    projectsUpdated: 0,
    projectFieldsHeldBack: {},
    leadsAttached: 0,
    leadsUnclustered: cluster.unclustered.length,
    leadsDetached: 0,
    dismissedDetached: 0,
    manualAttachmentsPreserved: 0,
    reasonCounts: cluster.reasonCounts,
    writeFailures: 0,
    orphansRemoved: 0,
    orphansKept: [],
  };

  const existing = noWrite ? new Map() : await loadProjects(MODULE);

  // ---- 1. Write the projects ------------------------------------------------
  for (const p of cluster.projects) {
    const prior = existing.get(p.project_key);
    const { row, heldBack } = projectRow(p, prior, MODULE);
    dropEmptyEnrichment(row);
    for (const f of heldBack) {
      report.projectFieldsHeldBack[f] = (report.projectFieldsHeldBack[f] ?? 0) + 1;
    }
    if (prior) report.projectsUpdated++;
    else report.projectsCreated++;
    if (noWrite) continue;
    const { error } = await supabaseAdmin
      .from('projects')
      .upsert(row, { onConflict: 'module,project_key' });
    if (error) {
      console.error(`  project write failed (${p.project_key}): ${error.message}`);
      report.writeFailures++;
    }
  }

  if (noWrite) return { report, projects: cluster.projects, unclustered: cluster.unclustered, cluster };

  // ---- 2. Resolve project ids ----------------------------------------------
  const stored = await loadProjects(MODULE);

  // ---- 3. Stamp the leads ---------------------------------------------------
  // Grouped by (project, reason) so this is a handful of statements rather than
  // one per record.
  const groups = new Map<string, string[]>();
  const shouldBeAttached = new Set<string>();

  for (const p of cluster.projects) {
    const id = stored.get(p.project_key)?.id;
    if (!id) {
      console.error(`  no stored project for key ${p.project_key}; leads left unattached`);
      continue;
    }
    for (const m of p.members) {
      const leadId = m.record.id;
      if (!leadId) continue;
      shouldBeAttached.add(leadId);
      // Philip's decisions are never recomputed. 'manual' is a hand attachment;
      // 'detached' is a hand DETACHMENT, and it has to be honoured here or the
      // next run silently re-attaches the record by the very rule he overruled.
      const priorReason = byId.get(leadId)?.cluster_reason;
      if (priorReason === 'manual' || priorReason === 'detached') {
        report.manualAttachmentsPreserved++;
        continue;
      }
      const key = `${id}|${m.reason}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(leadId);
    }
  }

  for (const [key, ids] of groups) {
    const [projectId, reason] = key.split('|');
    report.writeFailures += await updateLeads(ids, { project_id: projectId, cluster_reason: reason });
    report.leadsAttached += ids.length;
  }

  // ---- 4. Detach what no longer clusters ------------------------------------
  // A record that stopped clustering returns to the Inbox. It is never deleted
  // and never hidden. Manual attachments are left alone.
  const toDetach = leads
    .filter(
      (l) =>
        l.project_id &&
        !shouldBeAttached.has(l.id) &&
        l.cluster_reason !== 'manual' &&
        l.cluster_reason !== 'detached'
    )
    .map((l) => l.id);
  if (toDetach.length > 0) {
    report.writeFailures += await updateLeads(toDetach, { project_id: null, cluster_reason: null });
    report.leadsDetached = toDetach.length;
  }

  // ---- 5. Curation: a dismissed lead is in no project ------------------------
  // project_id is a scraper-owned column, so detaching a dismissed row enforces
  // the curation guarantee without touching status, notes, or overrides.
  const dismissedAttached = leads.filter((l) => l.status === 'dismissed' && l.project_id).map((l) => l.id);
  if (dismissedAttached.length > 0) {
    report.writeFailures += await updateLeads(dismissedAttached, { project_id: null, cluster_reason: null });
    report.dismissedDetached = dismissedAttached.length;
  }

  // ---- 6. Sweep orphaned project rows ---------------------------------------
  // A project_key is derived from its members' strongest shared signal, so when
  // a cluster GAINS a record whose key sorts earlier, the key changes: the leads
  // move to the new row and the old one is left behind, empty, still reporting
  // the record count it had. Measured, not theorised - one government lane run
  // produced four of them, including a "305 CCD" shell still claiming 3 records
  // after its cluster moved to the AR-26-400041 key.
  //
  // An empty project shell is not a record, so removing it does not violate
  // "nothing is hard deleted" - but it may carry Philip's curation, and that is
  // never discarded. An orphan with notes, a status, a watch flag, or a manual
  // override is KEPT, its record_count corrected to zero, and reported so he can
  // decide. Only untouched shells are removed.
  const { data: allProjects } = await supabaseAdmin
    .from('projects')
    .select('id,name,project_key,record_count,status,watch,notes,manual_overrides')
    .eq('module', MODULE);
  const attachedCounts = new Map<string, number>();
  for (const p of cluster.projects) {
    const pid = stored.get(p.project_key)?.id;
    if (pid) attachedCounts.set(pid, p.record_count);
  }
  for (const p of (allProjects ?? []) as {
    id: string;
    name: string;
    project_key: string;
    record_count: number | null;
    status: string | null;
    watch: boolean | null;
    notes: string | null;
    manual_overrides: unknown;
  }[]) {
    if ((attachedCounts.get(p.id) ?? 0) > 0) continue;
    const curated =
      Boolean(p.notes) ||
      Boolean(p.watch) ||
      Boolean(p.manual_overrides) ||
      (p.status !== null && p.status !== 'new');
    if (curated) {
      await supabaseAdmin.from('projects').update({ record_count: 0 }).eq('id', p.id);
      report.orphansKept.push(p.name);
    } else {
      await supabaseAdmin.from('projects').delete().eq('id', p.id);
      report.orphansRemoved++;
    }
  }

  return { report, projects: cluster.projects, unclustered: cluster.unclustered, cluster };
}

// ---- Reporting --------------------------------------------------------------

// The ten clusters assembled by hand for the July report. They are known
// correct, so they are the pass condition: each must come back as ONE project.
const ACCEPTANCE: { label: string; match: (p: ClusteredProject) => boolean }[] = [
  { label: 'OCVibe', match: (p) => p.name === 'OCVibe' },
  { label: 'Heart Hotel / Kulik River', match: (p) => p.name === 'Heart Hotel / Kulik River' },
  { label: 'Platinum Triangle / PT Metro', match: (p) => p.name === 'Platinum Triangle / PT Metro' },
  { label: 'Disneyland Resort', match: (p) => p.name === 'Disneyland Resort' },
  { label: 'CFTOD / Walt Disney World', match: (p) => p.name === 'CFTOD / Walt Disney World' },
  {
    label: 'Anaheim GardenWalk / Pointe Anaheim',
    match: (p) => p.members.some((m) => /gardenwalk/i.test(`${m.record.title ?? ''}`)),
  },
  {
    label: 'Anaheim Hills Festival / OTR',
    match: (p) => p.members.some((m) => /OTR, an Ohio/i.test(m.record.applicant ?? '')),
  },
  {
    label: 'Weston Urban (San Antonio)',
    match: (p) => p.members.some((m) => /weston urban/i.test(m.record.applicant ?? '')),
  },
  {
    label: 'Las Vegas Museum of Art / Symphony Park',
    match: (p) =>
      p.members.some((m) => /las vegas museum of art/i.test(`${m.record.title ?? ''} ${m.record.raw_content ?? ''}`)),
  },
  {
    label: 'Monument Hills (Howard Hughes)',
    match: (p) => p.members.some((m) => /monument hills/i.test(`${m.record.title ?? ''} ${m.record.raw_content ?? ''}`)),
  },
];

export function printBackfillReport(
  report: BackfillReport,
  cluster: ReturnType<typeof clusterRecords>
): boolean {
  const projects = cluster.projects;
  console.log('\n===== PROJECT CLUSTERING BACKFILL =====');
  if (process.env.PROJECTS_NO_WRITE === '1') console.log('(PROJECTS_NO_WRITE=1: nothing was written)');
  console.log(`Leads read (module gli):        ${report.leadsRead}`);
  console.log(`Dismissed, never clustered:     ${report.dismissedSkipped}`);
  console.log(`Detached by hand, never re-clustered: ${cluster.skippedDetached}`);
  console.log(`Projects created:               ${report.projectsCreated}`);
  console.log(`Projects updated:               ${report.projectsUpdated}`);
  console.log(`Leads attached:                 ${report.leadsAttached}`);
  console.log(`Leads unclustered (Inbox):      ${report.leadsUnclustered}`);
  console.log(`Leads detached (back to Inbox): ${report.leadsDetached}`);
  console.log(`Dismissed leads detached:       ${report.dismissedDetached}`);
  console.log(`Manual attachments preserved:   ${report.manualAttachmentsPreserved}`);
  console.log(`Orphaned empty project rows removed: ${report.orphansRemoved}`);
  if (report.orphansKept.length) {
    console.log(`Orphans KEPT because they carry curation (record_count zeroed, decide by hand):`);
    for (const n of report.orphansKept) console.log(`    ${n.slice(0, 80)}`);
  }
  if (report.writeFailures) console.log(`WRITE FAILURES:                 ${report.writeFailures}`);

  console.log('\ncluster_reason distribution:');
  for (const [k, v] of Object.entries(report.reasonCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(4)}  ${k}`);
  }

  const held = Object.entries(report.projectFieldsHeldBack);
  console.log('\nProject fields held back by a manual override:');
  console.log(held.length ? held.map(([f, n]) => `  ${f} x${n}`).join('\n') : '  (none)');

  console.log('\nSuppressions (reported, never silent):');
  console.log(`  container records (agenda/calendar/portal pages, no signals): ${cluster.containerRecords}`);
  console.log(`  citywide records whose case signals were suppressed:          ${cluster.citywideRecordsDropped}`);
  console.log(`  records naming more than 3 case roots (an index, not a filing): ${cluster.omnibusRecordsDropped}`);
  console.log('  office addresses dropped (an address on many unrelated filings):');
  if (!cluster.officeAddressesDropped.length) console.log('    (none)');
  for (const a of cluster.officeAddressesDropped) {
    console.log(`    ${a.records}x  ${a.key}  [${a.market}]`);
  }

  console.log('\nCase-family patterns found, per jurisdiction (case roots matched):');
  for (const [k, v] of Object.entries(cluster.casePatternsFound).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(4)}  ${k}`);
  }

  console.log('\nFuzzy entity merges (fastest-levenshtein 1.0.16, threshold 0.90):');
  if (!cluster.fuzzyMerges.length) {
    console.log('  (none: legal-suffix normalization already collapses every variant in this corpus)');
  }
  for (const f of cluster.fuzzyMerges) {
    console.log(`  ${f.similarity}  "${f.a}" ~ "${f.b}"  [market ${f.market}]`);
  }

  console.log('\n----- ACCEPTANCE TEST (the July report clusters) -----');
  let allPass = true;
  for (const a of ACCEPTANCE) {
    const hits = projects.filter(a.match);
    if (hits.length === 0) {
      console.log(`  FAIL   ${a.label}: no project`);
      allPass = false;
    } else if (hits.length > 1) {
      console.log(
        `  SPLIT  ${a.label}: ${hits.length} projects -> ${hits.map((h) => `${h.name} (${h.record_count})`).join(' | ')}`
      );
      allPass = false;
    } else {
      const p = hits[0];
      console.log(
        `  PASS   ${a.label}: "${p.name}" | ${p.record_count} records | stage ${p.stage} | ${p.market ?? 'no market'}`
      );
    }
  }
  console.log(allPass ? '  ALL TEN PASS' : '  ACCEPTANCE TEST FAILED');

  console.log('\n----- TEN LARGEST PROJECTS -----');
  for (const p of [...projects].sort((a, b) => b.record_count - a.record_count).slice(0, 10)) {
    console.log(
      `  ${String(p.record_count).padStart(3)}  ${p.stage.padEnd(18)} ${(p.market ?? '-').padEnd(38)} ${p.name.slice(0, 60)}`
    );
  }

  console.log('\n----- TEN MOST RECENTLY ACTIVE -----');
  for (const p of [...projects]
    .sort((a, b) => (b.last_activity ?? '').localeCompare(a.last_activity ?? ''))
    .slice(0, 10)) {
    console.log(
      `  ${(p.last_activity ?? '-').slice(0, 10)}  ${String(p.record_count).padStart(3)}  ${p.stage.padEnd(18)} ${p.name.slice(0, 58)}`
    );
  }

  console.log('\n----- STAGE DISTRIBUTION -----');
  const stages: Record<string, number> = {};
  for (const p of projects) stages[p.stage] = (stages[p.stage] ?? 0) + 1;
  for (const [k, v] of Object.entries(stages).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(4)}  ${k}`);
  }
  console.log('\n----- PROJECT LIVENESS (12-month window) -----');
  const live = projects.filter((p) => p.live).length;
  console.log(`  Live:    ${live}`);
  console.log(`  Dormant: ${projects.length - live}`);
  console.log('  Why:');
  for (const [k, v] of Object.entries(cluster.livenessReasons).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(v).padStart(4)}  ${k}`);
  }
  const withMilestone = projects.filter((p) => p.next_milestone).length;
  console.log(`  Projects carrying a future milestone (next_milestone set): ${withMilestone}`);
  console.log('=======================================\n');
  return allPass;
}

async function main(): Promise<void> {
  const { report, cluster } = await runBackfill();
  const pass = printBackfillReport(report, cluster);
  if (!pass) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Project backfill failed:', err);
    process.exitCode = 1;
  });
}
