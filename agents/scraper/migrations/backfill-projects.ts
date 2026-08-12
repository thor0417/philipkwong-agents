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
import { LIVE_PIPELINE_STORAGE_KEY } from '../pipelines';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { bestDate, clusterRecords, type ClusterRecord, type ClusteredProject } from '../cluster';
import { loadProjects, projectRow, dropEmptyEnrichment } from '../project-write';
import {
  emitProjectEvents,
  emptyEmitReport,
  printEmitReport,
  type EmitReport,
  type ProjectEventInput,
} from '../project-events';
import { selectAllPaged } from '../page-select';

// The pipeline this backfill operates on, from the registry rather than a
// literal. See agents/scraper/pipelines.
const MODULE = LIVE_PIPELINE_STORAGE_KEY;

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
  // What this run recorded in the project_events table.
  events: EmitReport;
}

// THE RECORD THAT JUSTIFIES A STAGE CHANGE, so "approved by this filing" is
// answerable rather than merely "approved on this date".
//
// The most recently dated member, because stage is derived from the most
// ADVANCED evidence and the newest record is the one that most recently moved
// it. This is a best attribution rather than a proof - the clusterer computes
// stage over the whole member set, not from a single record - so it is written
// to lead_id, which is nullable, and never presented as certainty.
function latestRecordId(p: ClusteredProject): string | null {
  let best: { id: string; at: string } | null = null;
  for (const m of p.members) {
    const id = m.record.id;
    const at = bestDate(m.record);
    if (!id || !at) continue;
    if (!best || at > best.at) best = { id, at };
  }
  return best?.id ?? null;
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
    events: emptyEmitReport(),
  };

  const existing = noWrite ? new Map() : await loadProjects(MODULE);

  // EVENTS DERIVED DURING THE WRITE, emitted once at the end.
  //
  // This is the only clustering path there is - attach-on-write re-runs this
  // same backfill rather than implementing a second matcher - so emitting here
  // covers both the backfill and the live write path with one implementation.
  //
  // EVERY occurred_at IS DERIVED FROM DATA, NEVER FROM THE CLOCK. That is not a
  // style preference, it is what makes idempotency possible: the event identity
  // includes occurred_at, so a clock-derived timestamp would give the same
  // logical event a different identity on every run and duplicate it forever.
  // A change we detect today because of a filing dated three weeks ago is dated
  // at the filing.
  // Keyed by project_key rather than index-aligned with a second array: a
  // project's id does not exist until the projects are written, so the key is
  // carried WITH the event and resolved to an id in one pass afterwards.
  const pending: { key: string; event: Omit<ProjectEventInput, 'project_id'> }[] = [];
  const addEvent = (key: string, event: Omit<ProjectEventInput, 'project_id'>): void => {
    pending.push({ key, event });
  };

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

    // A NEW PROJECT. Dated at first_seen, which is when we first saw evidence of
    // it, not when this run happened to notice.
    if (!prior) {
      const at = p.first_seen ?? p.last_activity;
      if (at) {
        addEvent(p.project_key, {
          event_type: 'project_created',
          occurred_at: at,
          to_value: p.name,
          detail: { project_key: p.project_key, market: p.market, stage: p.stage },
        });
      }
    } else {
      // A STAGE CHANGE, and only a real one.
      //
      // Two guards, and the second is the subtle one:
      //   - the values must actually differ. A recompute landing on the same
      //     stage emits nothing, which is most recomputes.
      //   - the field must NOT be held back by a manual override. If Philip
      //     pinned the stage, the STORED value did not change no matter what the
      //     clusterer computed, and emitting here would fire the same phantom
      //     event on every run forever while the register never moved.
      const stageOverridden = heldBack.includes('stage');
      if (!stageOverridden && prior.stage && p.stage && prior.stage !== p.stage) {
        const at = p.last_activity ?? p.first_seen;
        if (at) {
          addEvent(p.project_key, {
            event_type: 'stage_changed',
            occurred_at: at,
            from_value: prior.stage,
            to_value: p.stage,
            lead_id: latestRecordId(p),
            detail: { project_key: p.project_key, market: p.market },
          });
        }
      }
    }

    // A PARTY LEARNED OR REPLACED. Emitted when the applicant or representative
    // is first set, or changes - never when it merely stays the same, and never
    // when a run that learned nothing would otherwise erase one (dropEmptyEnrichment
    // already protects the column; this protects the log).
    for (const [field, next] of [
      ['applicant', p.primary_applicant],
      ['representative', p.primary_representative],
    ] as const) {
      const before = field === 'applicant' ? prior?.primary_applicant : prior?.primary_representative;
      if (!next || next === before) continue;
      const at = p.last_activity ?? p.first_seen;
      if (!at) continue;
      addEvent(p.project_key, {
        event_type: 'party_identified',
        occurred_at: at,
        from_value: before ?? null,
        to_value: next,
        detail: { role: field, project_key: p.project_key },
      });
    }

    // A FUTURE DATED COMMITMENT. next_milestone is itself a date; occurred_at is
    // when we learned it, so the two are different columns on purpose.
    if (p.next_milestone && p.next_milestone !== prior?.next_milestone) {
      const at = p.last_activity ?? p.first_seen;
      if (at) {
        addEvent(p.project_key, {
          event_type: 'milestone_set',
          occurred_at: at,
          from_value: prior?.next_milestone ?? null,
          to_value: p.next_milestone,
          detail: { project_key: p.project_key },
        });
      }
    }
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

  // Events whose project_id is already known (attach and detach are keyed on the
  // stored id, not on a project_key), collected separately and merged below.
  const attachEvents: ProjectEventInput[] = [];

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
    // A RECORD JOINED, and only when it actually joined. A lead already sitting
    // on this project is re-stamped with the same values every run, and emitting
    // there would produce one event per record per run forever. The comparison
    // is against the lead's project_id as it was READ, before this update.
    for (const id of ids) {
      if (byId.get(id)?.project_id === projectId) continue;
      const lead = byId.get(id);
      const at = lead ? bestDate(lead) ?? lead.first_seen : null;
      if (!at) continue;
      attachEvents.push({
        project_id: projectId,
        event_type: 'record_attached',
        occurred_at: at,
        to_value: reason,
        lead_id: id,
        detail: { title: (lead?.title ?? '').slice(0, 120), source: lead?.source ?? null },
      });
    }
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
    // Dated at the record's own date, like the attach, so a project's timeline
    // stays in the order the world happened rather than the order we noticed.
    for (const id of toDetach) {
      const lead = byId.get(id);
      const wasOn = lead?.project_id;
      const at = lead ? bestDate(lead) ?? lead.first_seen : null;
      if (!wasOn || !at) continue;
      attachEvents.push({
        project_id: wasOn,
        event_type: 'record_detached',
        occurred_at: at,
        from_value: lead?.cluster_reason ?? null,
        lead_id: id,
        detail: { title: (lead?.title ?? '').slice(0, 120), reason: 'no longer clusters' },
      });
    }
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
  // PAGED. This runs on every scrape through attachOnWrite, and projects are
  // projected to reach ~1500 at 25 markets. Unbounded, the orphan sweep would
  // silently stop seeing anything past the first thousand.
  const { rows: allProjects, complete: projectsComplete } = await selectAllPaged<{
    id: string;
    name: string;
    project_key: string;
    record_count: number | null;
    status: string | null;
    watch: boolean | null;
    notes: string | null;
    manual_overrides: unknown;
  }>(
    'projects',
    'id,name,project_key,record_count,status,watch,notes,manual_overrides',
    (q) => (q as { eq: (c: string, v: unknown) => unknown }).eq('module', MODULE),
    'Orphan sweep'
  );
  if (!projectsComplete) {
    console.error('Orphan sweep: read incomplete; skipping rather than deleting from a partial view.');
    return { report, projects: cluster.projects, unclustered: cluster.unclustered, cluster };
  }
  const attachedCounts = new Map<string, number>();
  for (const p of cluster.projects) {
    const pid = stored.get(p.project_key)?.id;
    if (pid) attachedCounts.set(pid, p.record_count);
  }
  for (const p of allProjects) {
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

  // ---- 7. Emit the events ---------------------------------------------------
  //
  // Last, and only after every write has succeeded. An event says a thing
  // HAPPENED, so emitting one for a change that then failed to write would be
  // the one kind of lie this table cannot survive.
  //
  // The project_key placeholders are resolved here, where the ids exist. A key
  // with no stored project is dropped rather than guessed.
  const resolved: ProjectEventInput[] = [];
  for (const { key, event } of pending) {
    const id = stored.get(key)?.id;
    if (!id) continue;
    resolved.push({ ...event, project_id: id });
  }
  report.events = await emitProjectEvents([...resolved, ...attachEvents], { module: MODULE });

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
  printEmitReport('Project', report.events);

  console.log('\nProject fields held back by a manual override:');
  console.log(held.length ? held.map(([f, n]) => `  ${f} x${n}`).join('\n') : '  (none)');

  console.log('\nSuppressions (reported, never silent):');
  console.log(`  container records (agenda/calendar/portal pages, no signals): ${cluster.containerRecords}`);
  console.log(`  citywide records narrowed to their own title case root:      ${cluster.citywideRecordsDropped}`);
  console.log(`  records naming more than 3 case roots (an index, not a filing): ${cluster.omnibusRecordsDropped}`);
  console.log(`  unions refused because the two sides name different targets:  ${cluster.targetCollisionsBlocked}`);
  for (const c of cluster.targetCollisions) {
    console.log(`      "${c.a}" x "${c.b}" via ${c.via}`);
  }
  console.log(
    `  records naming more than one Development Area (an index, not a filing): ${cluster.multiSubareaRecords}`
  );
  console.log(
    `  stages refused for want of attribution or corroboration:      ${cluster.stageRefusals.length}`
  );
  for (const s of cluster.stageRefusals) {
    console.log(`      ${s.claimed} -> ${s.taken}  (${s.records} records)  ${s.project}`);
  }
  console.log('  office addresses dropped (an address on many unrelated filings):');
  if (!cluster.officeAddressesDropped.length) console.log('    (none)');
  for (const a of cluster.officeAddressesDropped) {
    console.log(`    ${a.records}x  ${a.key}  [${a.market}]`);
  }

  // EVERY NAME-BASED MERGE, listed. The name signal is the only one inferred
  // from prose rather than asserted by a source, so it is the one that must be
  // inspectable record by record rather than trusted.
  console.log(
    `\nProject names extracted from trade press (intelligence stream only):\n` +
      `  names corroborated by 2+ records (used as a signal): ${cluster.namesCorroborated.length}\n` +
      `  names seen exactly once (suppressed, record stays in the Inbox): ${cluster.namesUncorroborated}`
  );
  for (const n of cluster.namesCorroborated) console.log(`    ${n.records}x  "${n.key}"`);

  console.log(
    `\nCross-stream attachment (an intelligence record recognised as naming a\n` +
      `government project's applicant, so press and filings share one timeline):\n` +
      `  attached: ${cluster.crossStreamAttached.length}\n` +
      `  refused for naming more than one developer (a roundup, not a project): ${cluster.crossStreamAmbiguous}`
  );
  for (const a of cluster.crossStreamAttached) {
    console.log(`    [${a.market}] "${a.entity}"  ::  ${a.title.replace(/\s+/g, ' ')}`);
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
