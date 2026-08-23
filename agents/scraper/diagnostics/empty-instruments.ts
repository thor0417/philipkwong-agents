// READ-ONLY. BRIEF R ITEM 3: the instruments that name nobody and state nothing.
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/empty-instruments.ts
//
// Brief Q item 1 judged 340 live projects and found 22 in the 'instrument'
// bucket carrying no party, no stated fact and no condition. An instrument that
// names a party is still evidence - somebody filed something somewhere. These
// name nobody.
//
// THE BRIEF SAYS NOT TO ASSUME THEY SHARE A CAUSE WITH BROWARD, so this reports
// what admitted EACH of them by re-running the real governmentGate over each
// record's own text, rather than grouping them by market and inferring.

import { readFileSync, existsSync } from 'node:fs';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { governmentGate } from '../../../lib/taxonomy';

const HOLDINGS = 'snapshots/holdings-judgement-live.json';

interface HoldingRow {
  id: string; name: string; market: string; stage: string; bucket: string; reason: string;
  namedPrivateParty: boolean; statedFacts: number; conditions: number; records: number;
}

async function main(): Promise<void> {
  if (!existsSync(HOLDINGS)) {
    console.error(`No holdings judgement on disk at ${HOLDINGS}. Run holdings-judgement first.`);
    process.exit(1);
  }
  const rows = (JSON.parse(readFileSync(HOLDINGS, 'utf8')).rows as HoldingRow[]) ?? [];
  const empty = rows.filter(
    (r) => r.bucket === 'instrument' && !r.namedPrivateParty && r.statedFacts === 0 && r.conditions === 0
  );
  console.log('='.repeat(100));
  console.log(`INSTRUMENTS THAT NAME NOBODY AND STATE NOTHING: ${empty.length}`);
  console.log('='.repeat(100));

  const { data } = await supabaseAdmin
    .from('leads')
    .select('project_id,title,raw_content,source,market,status,lifecycle')
    .in('project_id', empty.map((r) => r.id));
  const leads = ((data ?? []) as any[]).filter((l) => l.status !== 'dismissed' && l.lifecycle !== 'retired');
  const byProject = new Map<string, any[]>();
  for (const l of leads) {
    if (!byProject.has(l.project_id)) byProject.set(l.project_id, []);
    byProject.get(l.project_id)!.push(l);
  }

  // What admitted each, from the gate itself rather than from the market.
  const causeCount = new Map<string, number>();
  const byMarket = new Map<string, HoldingRow[]>();
  for (const r of empty) {
    if (!byMarket.has(r.market)) byMarket.set(r.market, []);
    byMarket.get(r.market)!.push(r);
  }

  for (const [market, rs] of [...byMarket].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n### ${market} — ${rs.length}`);
    for (const r of rs) {
      const recs = byProject.get(r.id) ?? [];
      const first = recs[0];
      const text = `${first?.title ?? ''} ${first?.raw_content ?? ''}`;
      const v: any = governmentGate(text, market);
      const cause = v.matched
        ? `${v.reason}: strong=[${v.strongHits.join('|')}] weak=[${v.weakHits.join('|')}] action=[${v.actionHits.join('|')}] deal=[${v.dealHits.join('|')}]`
        : `NOT MATCHED by the vocabulary (${v.reason}) - admitted by bypass, known-entity or single-purpose`;
      const key = v.matched
        ? `${v.reason} on strong=[${v.strongHits.join('|')}] weak=[${v.weakHits.join('|')}]`
        : `not matched by vocabulary (${v.reason})`;
      causeCount.set(key, (causeCount.get(key) ?? 0) + 1);
      console.log(`  ${r.name.slice(0, 62)}`);
      console.log(`      source=${first?.source ?? '-'}  records=${r.records}  stage=${r.stage}`);
      console.log(`      judged: ${r.reason}`);
      console.log(`      gate  : ${cause}`);
    }
  }

  console.log('\n' + '='.repeat(100));
  console.log('WHAT ADMITTED THEM, GROUPED BY THE GATE ITSELF');
  console.log('='.repeat(100));
  for (const [k, n] of [...causeCount].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${k}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
