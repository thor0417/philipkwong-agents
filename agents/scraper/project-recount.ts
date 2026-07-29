// projects.record_count is a CACHED number. Only a full clustering run rewrites
// it, so it goes stale the moment a row is dismissed or detached by anything
// else - a dedupe, a gate change, or Philip dismissing a record in the
// dashboard. It was found wrong on the Heart Hotel project by one, because a
// Legistar row for the same Clark County case had been dismissed as a
// cross-source duplicate and nothing recomputed the count.
//
// Any repair that dismisses or detaches rows must call this afterwards, or it
// leaves a number on the register that quietly disagrees with the rows behind
// it. Shared so the repairs cannot drift apart in how they count.

import { supabaseAdmin } from '../../lib/supabase-admin';
import { selectAllPaged } from './page-select';

export interface RecountResult {
  projects: number;
  corrected: { id: string; name: string; from: number; to: number }[];
  skipped: boolean;
}

// A dismissed row is not part of its project's count. Nothing else is excluded:
// an archived or expired row is still a record of the project.
export async function recountProjects(apply: boolean): Promise<RecountResult> {
  const { rows: attached, complete } = await selectAllPaged<{ project_id: string | null; status: string | null }>(
    'leads',
    'project_id,status',
    (q: unknown) => (q as { not: (a: string, b: string, c: null) => unknown }).not('project_id', 'is', null),
    'recount'
  );
  if (!complete) return { projects: 0, corrected: [], skipped: true };

  const live = new Map<string, number>();
  for (const l of attached) {
    if (String(l.status) === 'dismissed') continue;
    live.set(l.project_id!, (live.get(l.project_id!) ?? 0) + 1);
  }

  const { data, error } = await supabaseAdmin.from('projects').select('id,name,record_count');
  if (error) return { projects: 0, corrected: [], skipped: true };
  const projects = (data ?? []) as { id: string; name: string; record_count: number | null }[];

  const corrected: RecountResult['corrected'] = [];
  for (const p of projects) {
    const n = live.get(p.id) ?? 0;
    if ((p.record_count ?? 0) === n) continue;
    corrected.push({ id: p.id, name: p.name, from: p.record_count ?? 0, to: n });
    if (apply) {
      const { error: e } = await supabaseAdmin.from('projects').update({ record_count: n }).eq('id', p.id);
      if (e) console.error(`   recount failed for ${p.id}: ${e.message}`);
    }
  }
  return { projects: projects.length, corrected, skipped: false };
}

export function printRecount(r: RecountResult): void {
  if (r.skipped) {
    console.log('\nPROJECT RECORD COUNTS: skipped (partial read).');
    return;
  }
  console.log(`\nPROJECT RECORD COUNTS: ${r.corrected.length} of ${r.projects} projects disagree with their live rows.`);
  for (const c of r.corrected) {
    console.log(`  ${c.id.slice(0, 8)}  ${String(c.from).padStart(3)} -> ${String(c.to).padStart(3)}   "${c.name.slice(0, 58)}"`);
  }
}
