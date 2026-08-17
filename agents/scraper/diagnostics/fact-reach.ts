// READ-ONLY. HOW MANY LIVE PROJECTS CARRY A PRINTED FACT, BEFORE AND AFTER.
//
//   node --env-file=.env.local --import tsx agents/scraper/diagnostics/fact-reach.ts
//
// Nothing is written. BEFORE is the press figures alone, which is what an entry
// carried at the start of today. AFTER adds what the filings state. Both counts
// apply the SAME rules the entry applies - attribution for press, the quotable
// check for filings - so this is the number that prints, not the number stored.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { attributionTerms, factsForEntry, type PressFact } from '../press-facts';

interface Proj {
  id: string; name: string; status: string | null; market: string | null;
  region_state: string | null; primary_applicant: string | null;
}
interface Lead {
  id: string; project_id: string | null; status: string | null; url: string | null;
  source: string | null; stream: string | null;
  press_facts: PressFact[] | null;
  filing_facts: { kind: string; label: string; display: string; line: string; value: number | null }[] | null;
}

const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(0) + '%' : '-');

async function pageAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

// The entry excludes these: city staff, and conditions which get their own block.
const EXCLUDED = new Set(['case_planner', 'condition']);

async function main(): Promise<void> {
  const projects = await pageAll<Proj>('projects', 'id,name,status,market,region_state,primary_applicant');
  const live = projects.filter((p) => p.status !== 'archived' && p.status !== 'deleted');
  const liveById = new Map(live.map((p) => [p.id, p]));
  const leads = await pageAll<Lead>('leads', 'id,project_id,status,url,source,stream,press_facts,filing_facts');

  const pressBy = new Map<string, number>();
  const filingBy = new Map<string, number>();
  for (const l of leads) {
    if (l.status === 'dismissed' || !l.project_id || !liveById.has(l.project_id)) continue;
    const p = liveById.get(l.project_id)!;
    if ((l.press_facts ?? []).length) {
      const kept = factsForEntry(l.press_facts!, attributionTerms(p.name, p.primary_applicant));
      if (kept.length) pressBy.set(p.id, (pressBy.get(p.id) ?? 0) + kept.length);
    }
    const ff = (l.filing_facts ?? []).filter(
      (f) => f && !EXCLUDED.has(f.kind) && f.display && f.line && f.line.includes(f.display)
    );
    if (ff.length) filingBy.set(p.id, (filingBy.get(p.id) ?? 0) + ff.length);
  }

  const marketOf = (p: Proj) => p.market ?? p.region_state ?? '(no market)';
  const rows = new Map<string, { live: number; before: number; after: number; facts: number }>();
  for (const p of live) {
    const m = marketOf(p);
    rows.set(m, rows.get(m) ?? { live: 0, before: 0, after: 0, facts: 0 });
    const r = rows.get(m)!;
    r.live++;
    const press = pressBy.get(p.id) ?? 0;
    const filing = filingBy.get(p.id) ?? 0;
    if (press) r.before++;
    if (press || filing) r.after++;
    r.facts += press + filing;
  }

  const before = live.filter((p) => (pressBy.get(p.id) ?? 0) > 0).length;
  const after = live.filter((p) => (pressBy.get(p.id) ?? 0) + (filingBy.get(p.id) ?? 0) > 0).length;

  console.log('===== PROJECTS CARRYING AT LEAST ONE PRINTED FACT =====\n');
  console.log(`live projects              : ${live.length}`);
  console.log(`  BEFORE (press only)      : ${before}  (${pct(before, live.length)})`);
  console.log(`  AFTER  (press + filings) : ${after}  (${pct(after, live.length)})`);
  console.log(`  gained                   : ${after - before}`);

  console.log('\nmarket                          live   before   after   share   facts');
  for (const [m, s] of [...rows.entries()].sort((a, b) => b[1].after - a[1].after || b[1].live - a[1].live)) {
    console.log(
      `${m.slice(0, 30).padEnd(32)}${String(s.live).padStart(4)}${String(s.before).padStart(9)}${String(s.after).padStart(8)}${pct(s.after, s.live).padStart(8)}${String(s.facts).padStart(8)}`
    );
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
