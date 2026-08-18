// HOW BIG IS THE REST OF THE SHAPE. A PROBE, NOT A RULE.
//
// The applicant_type gate reaches exactly one column on one source: ZAP's
// `applicant`. Every other party column, and every other market, carries
// government bodies with NO stated type, so the gate cannot see them.
//
// THIS DOES NOT GATE ANYTHING AND MUST NOT BE PROMOTED INTO ONE. It matches on
// name shape, which is the defect this repo carries a golden case for. It exists
// to size the residue so the gap is a number rather than an impression.

import { supabaseAdmin } from '../../../lib/supabase-admin';

// Deliberately crude and deliberately visible. Sizing only.
const AGENCY_HINT = /\b(department|dept\.?|authority|commission|agency|bureau|board of|county of|city of|borough president|deputy mayor|redevelopment agency|housing authority|port authority|district)\b/i;

interface Row {
  id: string; project_id: string | null; market: string | null; source: string | null;
  status: string | null; lifecycle: string | null; applicant: string | null;
  applicant_type: string | null; representative: string | null;
  presented_by: string | null; contact_name: string | null;
}

async function main(): Promise<void> {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id,project_id,market,source,status,lifecycle,applicant,applicant_type,representative,presented_by,contact_name')
      .not('project_id', 'is', null)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...(data as unknown as Row[]));
    if (data.length < 1000) break;
  }
  const live = rows.filter((r) => r.status !== 'dismissed' && r.lifecycle !== 'retired');
  console.log(`live records attached to a project: ${live.length}`);

  const COLS: (keyof Row)[] = ['applicant', 'representative', 'presented_by', 'contact_name'];
  const hitProjects = new Map<string, Set<string>>();
  const byCol = new Map<string, number>();
  const byMarket = new Map<string, Set<string>>();
  let gatedAlready = 0;

  for (const r of live) {
    for (const c of COLS) {
      const v = (r[c] as string | null) ?? '';
      if (!v.trim() || !AGENCY_HINT.test(v)) continue;
      if (c === 'applicant' && (r.applicant_type ?? '').toLowerCase() === 'other public agency') { gatedAlready++; continue; }
      byCol.set(c, (byCol.get(c) ?? 0) + 1);
      const m = r.market ?? '(none)';
      if (!byMarket.has(m)) byMarket.set(m, new Set());
      byMarket.get(m)!.add(r.project_id!);
      if (!hitProjects.has(r.project_id!)) hitProjects.set(r.project_id!, new Set());
      hitProjects.get(r.project_id!)!.add(`${c}: ${v.trim().slice(0, 70)}`);
    }
  }

  console.log(`\nalready gated by applicant_type (not counted below): ${gatedAlready}`);
  console.log('\nRESIDUE the gate cannot see, by column:');
  for (const [c, n] of [...byCol.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}  ${c}`);
  console.log(`\nprojects touched: ${hitProjects.size}`);
  console.log('\nby market (projects):');
  for (const [m, s] of [...byMarket.entries()].sort((a, b) => b[1].size - a[1].size)) {
    console.log(`   ${String(s.size).padStart(4)}  ${m}`);
  }
  console.log('\nHOW MANY SOURCES PUBLISH A TYPE AT ALL:');
  const srcWithType = new Map<string, number>();
  const srcAll = new Map<string, number>();
  for (const r of live) {
    const s = r.source ?? '(none)';
    srcAll.set(s, (srcAll.get(s) ?? 0) + 1);
    if (r.applicant_type) srcWithType.set(s, (srcWithType.get(s) ?? 0) + 1);
  }
  for (const [s, n] of [...srcAll.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`   ${s.padEnd(22)} records ${String(n).padStart(4)}   with a stated type ${srcWithType.get(s) ?? 0}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
