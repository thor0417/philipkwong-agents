// TWO DECISIONS TAKEN ONE PROJECT AT A TIME, after the records were read.
//
//   npm run park:compliance          show what would change
//   APPLY=1 npm run park:compliance  write
//
// A DECISION LIST, NOT A RULE. Every other dismissal migration re-gates and asks
// the current question, deliberately, so it can be re-run after the rules move.
// This one cannot: these three projects were held back BECAUSE no rule covers
// them, and each was decided by reading its records. Naming them is the honest
// form. Re-running is a no-op once applied.
//
// ---- 1. DISMISSED --------------------------------------------------------
//
// Saia Family Trust & Saia Gabriel G JR & Celia C TRS (3 records, sig 35.4).
// One matter, ET-26-400061: "WAIVERS OF DEVELOPMENT STANDARDS THIRD EXTENSION
// OF TIME ... DESIGN REVIEW for a parking lot expansion in conjunction with an
// existing retail, office, and warehouse complex on 14.0 acres in an IL
// (Industrial Light) Zone." A parking lot at an industrial complex.
//
// It looked real because Lucy Stewart of LAS Consulting is the contact. She is
// the filing agent, and a representative identifies who presented a matter,
// never which matter it is - the rule approved for the entity index, applying
// here too.
//
// 01 Beach Channel Drive (1 record, sig 2.8). Not about Beach Channel Drive: a
// Board of Standards and Appeals calendar notice for a two-day hearing covering
// many unrelated cases, at 22 Reade Street, which is the BSA's own building and
// already one of the office addresses the clusterer suppresses.
//
// ---- 2. PARKED, NOT BINNED ------------------------------------------------
//
// SKY HI, LLC (2 records, sig 32.3). UC-25-0762, a cannabis dispensary use
// permit in conjunction with a previously approved consumption lounge, approved
// unanimously 2025-12-16. It is not hospitality and does not belong in this
// register. It IS regulatory compliance, which is a pipeline Philip may run.
//
// So it moves rather than dies. pipelines.ts already models this: a pipeline
// row carries a storageKey, every read is scoped by leads.module, and
// storageKeyFor returns the id itself for anything that is not hospitality. A
// row inserted inactive means nothing runs against it yet.
//
// This is a DATA insert into an existing table, not DDL.
//
// Nothing is deleted in either half. Dismissal is a status; parking is a module.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../../lib/supabase-admin';

const APPLY = process.env.APPLY === '1';

const DISMISS_PROJECTS = [
  'Saia Family Trust & Saia Gabriel G JR & Celia C TRS',
  '01 Beach Channel Drive',
];

const PARK_PROJECTS = ['SKY HI'];

const COMPLIANCE_PIPELINE = {
  id: 'compliance',
  name: 'Regulatory Compliance',
  short_name: 'Compliance',
  brand_name: null,
  brand_logo: null,
  // INACTIVE ON PURPOSE. Nothing scrapes it, nothing reports on it, and no run
  // can start writing to it by accident. It exists so compliance records have
  // somewhere to go that is not the bin.
  active: false,
  retired_reason: null,
  sort_order: 2,
};

const t = (s: unknown): string => String(s ?? '').trim();

async function projectsNamed(names: string[]): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id,name')
    .eq('module', 'gli')
    .neq('status', 'dismissed')
    .in('name', names);
  if (error) throw new Error(`project read failed: ${error.message}`);
  return (data ?? []) as { id: string; name: string }[];
}

async function main(): Promise<void> {
  console.log(APPLY ? 'PARK AND DISMISS: APPLYING\n' : 'PARK AND DISMISS: DRY RUN (APPLY=1 to write)\n');

  const toDismiss = await projectsNamed(DISMISS_PROJECTS);
  const toPark = await projectsNamed(PARK_PROJECTS);
  for (const want of [...DISMISS_PROJECTS, ...PARK_PROJECTS]) {
    if (![...toDismiss, ...toPark].some((p) => p.name === want)) {
      console.log(`  NOT FOUND (already handled?): ${want}`);
    }
  }

  const idsOf = async (projectIds: string[]): Promise<{ id: string; title: string }[]> => {
    if (projectIds.length === 0) return [];
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id,title')
      .in('project_id', projectIds)
      .neq('status', 'dismissed');
    if (error) throw new Error(`lead read failed: ${error.message}`);
    return (data ?? []) as { id: string; title: string }[];
  };

  const dismissLeads = await idsOf(toDismiss.map((p) => p.id));
  const parkLeads = await idsOf(toPark.map((p) => p.id));

  console.log(`  DISMISS  ${toDismiss.length} projects, ${dismissLeads.length} records`);
  for (const p of toDismiss) console.log(`     ${p.name}`);
  console.log(`  PARK     ${toPark.length} projects, ${parkLeads.length} records -> module '${COMPLIANCE_PIPELINE.id}'`);
  for (const l of parkLeads) console.log(`     ${t(l.title).replace(/\s+/g, ' ').slice(0, 84)}`);

  if (!APPLY) {
    console.log('\nNothing was written. APPLY=1 to write.');
    return;
  }

  // The pipeline row first: a lead must never point at a module with no
  // pipeline behind it, even for the moment between two writes.
  const { error: pErr } = await supabaseAdmin
    .from('pipelines')
    .upsert(COMPLIANCE_PIPELINE, { onConflict: 'id' });
  if (pErr) throw new Error(`pipeline insert failed: ${pErr.message}`);
  console.log(`\n  pipeline '${COMPLIANCE_PIPELINE.id}' present (${COMPLIANCE_PIPELINE.name}, inactive)`);

  if (dismissLeads.length) {
    const { error } = await supabaseAdmin
      .from('leads')
      .update({ status: 'dismissed' })
      .in('id', dismissLeads.map((l) => l.id));
    if (error) throw new Error(`dismiss failed: ${error.message}`);
    console.log(`  dismissed ${dismissLeads.length} records`);
  }

  if (parkLeads.length) {
    // project_id is cleared with the move: a project row belongs to the
    // pipeline it was clustered in, and the compliance pipeline will cluster
    // its own when it runs.
    const { error } = await supabaseAdmin
      .from('leads')
      .update({ module: COMPLIANCE_PIPELINE.id, project_id: null, cluster_reason: null })
      .in('id', parkLeads.map((l) => l.id));
    if (error) throw new Error(`park failed: ${error.message}`);
    console.log(`  moved ${parkLeads.length} records to module '${COMPLIANCE_PIPELINE.id}'`);
  }

  console.log('\nRun the clusterer to clear the empty project shells.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
