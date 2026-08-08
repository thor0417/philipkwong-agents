// RECLASSIFY venue_type AND development_category ACROSS THE GLI CORPUS.
//
// Run after the taxonomy change that renamed 'Leisure Destination' to
// 'Entertainment Destination', narrowed its keyword rule to compound phrases,
// and made classifyVenueType return NULL rather than a fallback.
//
// WHY A BACKFILL IS REQUIRED AND NOT OPTIONAL. venue_type and
// development_category are stored columns that client scopes filter on. Change
// the classifier without rewriting the rows and the register keeps answering
// with the old vocabulary: a scope naming 'Entertainment Destination' matches
// nothing while 73 projects still say 'Leisure Destination', and a category
// scope splits across two spellings of the same thing.
//
// TWO PASSES, IN ORDER, BECAUSE A PROJECT IS DERIVED FROM ITS RECORDS.
//   1. Every gli lead is re-classified from its own text, exactly as the lane
//      would classify it today.
//   2. Every gli project takes the MODE of its records' venue types, which is
//      the same rule the clusterer applies (cluster.ts modeOf). Projects whose
//      records are all unclassified become null themselves.
//
// NOTHING IS DELETED and no record changes project. Only the two classification
// columns move.
//
// Idempotent: re-running it re-derives the same values. DRY by default;
// APPLY=1 to write.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { categoryForVenue, classifyVenueType } from '../../../lib/taxonomy';

const APPLY = process.env.APPLY === '1';

interface LeadRow {
  id: string;
  title: string | null;
  raw_content: string | null;
  venue_type: string | null;
  development_category: string | null;
  project_id: string | null;
}

async function page<T>(table: string, columns: string, filter: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(supabaseAdmin.from(table).select(columns)).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// The clusterer's rule, restated: the commonest non-null value, ties broken by
// first appearance. Unclassified records do not vote, so one classified record
// among five unknowns still names the project; a project with no classified
// record at all is null.
function modeOf(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
  return best;
}

function tally(values: (string | null)[]): [string, number][] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v ?? '(null)', (m.get(v ?? '(null)') ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function printTable(label: string, before: [string, number][], after: [string, number][]): void {
  const keys = [...new Set([...before.map((x) => x[0]), ...after.map((x) => x[0])])];
  const b = new Map(before);
  const a = new Map(after);
  console.log(`\n${label}`);
  console.log(`  ${'value'.padEnd(32)} ${'before'.padStart(7)} ${'after'.padStart(7)}   delta`);
  for (const k of keys.sort((x, y) => (a.get(y) ?? 0) - (a.get(x) ?? 0) || x.localeCompare(y))) {
    const bv = b.get(k) ?? 0;
    const av = a.get(k) ?? 0;
    const d = av - bv;
    console.log(`  ${k.padEnd(32)} ${String(bv).padStart(7)} ${String(av).padStart(7)}   ${d > 0 ? '+' : ''}${d}`);
  }
}

async function main(): Promise<void> {
  console.log(APPLY ? 'RECLASSIFY: APPLYING\n' : 'RECLASSIFY: DRY RUN (APPLY=1 to write)\n');

  const leads = await page<LeadRow>(
    'leads',
    'id,title,raw_content,venue_type,development_category,project_id',
    (q) => q.eq('module', 'gli')
  );
  console.log(`gli leads: ${leads.length}`);

  const leadBeforeVenue = tally(leads.map((l) => l.venue_type));
  const leadBeforeCat = tally(leads.map((l) => l.development_category));

  const next = new Map<string, { venue: string | null; cat: string | null }>();
  for (const l of leads) {
    // EXACTLY WHAT THE LANE DOES: title + content + the existing venue hint.
    // The hint carries real signal - Haiku's read on the intelligence lane, the
    // source tag on the government lane - and dropping it here would make the
    // backfill classify differently from the code that will classify tomorrow's
    // records, which is a worse defect than the one being fixed.
    //
    // Feeding the hint back is safe precisely because 'leisure destination' was
    // removed from the Entertainment Destination rule. The retired value cannot
    // re-elect itself: a lead whose hint reads 'Leisure Destination' now matches
    // no rule through the hint and is classified on its own text alone.
    const venue = classifyVenueType(`${l.title ?? ''} ${l.raw_content ?? ''} ${l.venue_type ?? ''}`);
    next.set(l.id, { venue, cat: categoryForVenue(venue) });
  }

  const leadAfterVenue = tally(leads.map((l) => next.get(l.id)!.venue));
  const leadAfterCat = tally(leads.map((l) => next.get(l.id)!.cat));
  printTable('LEADS, venue_type', leadBeforeVenue, leadAfterVenue);
  printTable('LEADS, development_category', leadBeforeCat, leadAfterCat);

  const changedLeads = leads.filter(
    (l) => l.venue_type !== next.get(l.id)!.venue || l.development_category !== next.get(l.id)!.cat
  );
  console.log(`\nleads whose classification changes: ${changedLeads.length} of ${leads.length}`);

  const projects = await page<{ id: string; venue_type: string | null; development_category: string | null }>(
    'projects',
    'id,venue_type,development_category',
    (q) => q.eq('module', 'gli')
  );
  const byProject = new Map<string, (string | null)[]>();
  for (const l of leads) {
    if (!l.project_id) continue;
    const arr = byProject.get(l.project_id) ?? [];
    arr.push(next.get(l.id)!.venue);
    byProject.set(l.project_id, arr);
  }
  const projNext = new Map<string, { venue: string | null; cat: string | null }>();
  for (const p of projects) {
    const venue = modeOf(byProject.get(p.id) ?? []);
    projNext.set(p.id, { venue, cat: categoryForVenue(venue) });
  }
  printTable('PROJECTS, venue_type', tally(projects.map((p) => p.venue_type)), tally(projects.map((p) => projNext.get(p.id)!.venue)));
  printTable('PROJECTS, development_category', tally(projects.map((p) => p.development_category)), tally(projects.map((p) => projNext.get(p.id)!.cat)));

  const changedProjects = projects.filter(
    (p) => p.venue_type !== projNext.get(p.id)!.venue || p.development_category !== projNext.get(p.id)!.cat
  );
  console.log(`\nprojects whose classification changes: ${changedProjects.length} of ${projects.length}`);
  console.log(`projects that become unclassified (null venue): ${projects.filter((p) => projNext.get(p.id)!.venue === null).length}`);

  if (!APPLY) return;

  let n = 0;
  for (const l of changedLeads) {
    const v = next.get(l.id)!;
    const { error } = await supabaseAdmin
      .from('leads')
      .update({ venue_type: v.venue, development_category: v.cat })
      .eq('id', l.id);
    if (error) { console.error(`lead ${l.id}: ${error.message}`); continue; }
    n++;
  }
  console.log(`\nupdated ${n} lead(s)`);

  let m = 0;
  for (const p of changedProjects) {
    const v = projNext.get(p.id)!;
    const { error } = await supabaseAdmin
      .from('projects')
      .update({ venue_type: v.venue, development_category: v.cat })
      .eq('id', p.id);
    if (error) { console.error(`project ${p.id}: ${error.message}`); continue; }
    m++;
  }
  console.log(`updated ${m} project(s)`);
}

main();
