// WHICH PROJECTS CHANGE WHEN A PUBLIC-AGENCY APPLICANT STOPS BEING A NAMED PARTY.
//
// A count cannot be checked against the filings, so this names them. Per project:
// the live records, every party column they carry, and what the PEOPLE section
// holds before and after the gate. Read-only.

import { supabaseAdmin } from '../../../lib/supabase-admin';

interface Row {
  id: string; project_id: string | null; market: string | null; status: string | null;
  lifecycle: string | null; source: string | null; applicant: string | null;
  applicant_type: string | null; representative: string | null;
  presented_by: string | null; contact_name: string | null; url: string | null;
}

const gated = (t: string | null): boolean => (t ?? '').trim().toLowerCase() === 'other public agency';

async function main(): Promise<void> {
  const { data: projects, error: pErr } = await supabaseAdmin
    .from('projects').select('id,name,market,status,stage,record_count');
  if (pErr) throw new Error(pErr.message);
  const byId = new Map((projects ?? []).map((p) => [p.id as string, p as Record<string, unknown>]));

  const rows: Row[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id,project_id,market,status,lifecycle,source,applicant,applicant_type,representative,presented_by,contact_name,url')
      .not('applicant_type', 'is', null)
      .range(from, from + 499);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...(data as unknown as Row[]));
    if (data.length < 500) break;
  }

  // The document reads live records only: dismissed and retired never print.
  const live = rows.filter((r) => r.status !== 'dismissed' && r.lifecycle !== 'retired');
  console.log(`records carrying a stated applicant_type : ${rows.length}`);
  console.log(`of those live                            : ${live.length}`);
  const dist = new Map<string, number>();
  for (const r of live) dist.set(r.applicant_type ?? '?', (dist.get(r.applicant_type ?? '?') ?? 0) + 1);
  for (const [t, n] of [...dist.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(3)}  ${t}`);

  const gatedLive = live.filter((r) => gated(r.applicant_type));
  console.log(`\nlive records whose applicant is gated    : ${gatedLive.length}`);
  console.log(`  attached to a project                 : ${gatedLive.filter((r) => r.project_id).length}`);
  console.log(`  unattached (print nowhere today)      : ${gatedLive.filter((r) => !r.project_id).length}`);

  const projectIds = [...new Set(gatedLive.map((r) => r.project_id).filter((v): v is string => !!v))];
  console.log(`\nPROJECTS AFFECTED: ${projectIds.length}\n${'='.repeat(84)}`);

  // Every live record on an affected project, not only the ZAP ones: whether the
  // project loses its ONLY party depends on what the other records carry.
  const all: Row[] = [];
  for (let i = 0; i < projectIds.length; i += 50) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id,project_id,market,status,lifecycle,source,applicant,applicant_type,representative,presented_by,contact_name,url')
      .in('project_id', projectIds.slice(i, i + 50));
    if (error) throw new Error(error.message);
    all.push(...((data ?? []) as unknown as Row[]));
  }
  const allLive = all.filter((r) => r.status !== 'dismissed' && r.lifecycle !== 'retired');

  for (const pid of projectIds) {
    const p = byId.get(pid);
    const recs = allLive.filter((r) => r.project_id === pid);
    const before = new Set<string>();
    const after = new Set<string>();
    for (const r of recs) {
      for (const v of [r.applicant, r.representative, r.presented_by, r.contact_name]) {
        if (v && v.trim()) before.add(v.trim());
      }
      const keep = gated(r.applicant_type) ? [r.representative, r.presented_by, r.contact_name] : [r.applicant, r.representative, r.presented_by, r.contact_name];
      for (const v of keep) if (v && v.trim()) after.add(v.trim());
    }
    console.log(`\n${String(p?.name ?? '(unnamed)')}`);
    console.log(`  id ${pid}   market=${String(p?.market)}   stage=${String(p?.stage)}   status=${String(p?.status)}`);
    console.log(`  live records ${recs.length}`);
    console.log(`  parties BEFORE (${before.size}): ${[...before].join(' | ') || '(none)'}`);
    console.log(`  parties AFTER  (${after.size}): ${[...after].join(' | ') || '(none)'}`);
    if (after.size === 0) console.log('  >>> LOSES EVERY NAMED PARTY: the entry falls to the honest negative.');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
