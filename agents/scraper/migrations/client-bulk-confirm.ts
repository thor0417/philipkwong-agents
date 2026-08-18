// CONFIRM A CLIENT'S PROPOSED PROJECTS, PER MARKET, ATTRIBUTABLY.
//
//   DRY_RUN=1 node --env-file=.env.local --import tsx \
//     agents/scraper/migrations/client-bulk-confirm.ts \
//     --client "JKR & Associates" --markets "Clark County,New York City"
//
// WHY A BULK CONFIRM EXISTS AT ALL. The membership gate is right: a scope
// PROPOSES and only a confirmed project may be printed. But JKR's scope
// constrains no axis, so it proposed the whole register and nothing was ever
// confirmed - which is why its document covered 0 projects and why six tests sat
// red waiting on a human. Confirming 165 rows by hand before a Wednesday report
// is not a decision anyone makes carefully; it is one they make at speed, which
// is worse than a recorded bulk action.
//
// SO IT IS SCOPED, ATTRIBUTED AND REVERSIBLE:
//
//   PER MARKET      only the markets named on the command line. Every other
//                   market stays 'proposed'. A blanket confirm would be the
//                   gate deleted.
//   set_by          'bulk-confirm', never a person's name. A row confirmed in
//                   bulk must never be mistaken for one Philip read.
//   REVERSIBLE      each row individually. C and X on the register overwrite
//                   this the same as any other proposal, and the row keeps its
//                   own set_at.
//   NEVER DOWNGRADES A DECISION. A row already 'included' or 'excluded' is left
//                   exactly as it is: this only moves 'proposed' forward.
//
// It writes to client_projects and to nothing else. No project, no lead and no
// document is touched.

import { supabaseAdmin } from '../../../lib/supabase-admin';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? (process.argv[i + 1] ?? null) : null;
};

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === '1';
  const clientName = arg('client');
  const marketsArg = arg('markets');
  if (!clientName || !marketsArg) {
    console.error('usage: --client "<name>" --markets "Market A,Market B"');
    process.exitCode = 1;
    return;
  }
  const markets = marketsArg.split(',').map((m) => m.trim()).filter(Boolean);

  const { data: clients, error: cErr } = await supabaseAdmin
    .from('clients')
    .select('id,name')
    .eq('name', clientName);
  if (cErr) throw new Error(`clients: ${cErr.message}`);
  const client = clients?.[0];
  if (!client) {
    console.error(`no client named ${JSON.stringify(clientName)}`);
    process.exitCode = 1;
    return;
  }

  const { data: rows, error: mErr } = await supabaseAdmin
    .from('client_projects')
    .select('id,project_id,status,set_by')
    .eq('client_id', client.id);
  if (mErr) throw new Error(`client_projects: ${mErr.message}`);
  const membership = rows ?? [];

  const { data: projects, error: pErr } = await supabaseAdmin
    .from('projects')
    .select('id,name,market,status,stage');
  if (pErr) throw new Error(`projects: ${pErr.message}`);
  const byId = new Map((projects ?? []).map((p) => [p.id as string, p]));

  const inMarket = membership.filter((m) => {
    const p = byId.get(m.project_id as string);
    return p && markets.includes(String(p.market));
  });
  const toConfirm = inMarket.filter((m) => m.status === 'proposed');
  const alreadyDecided = inMarket.filter((m) => m.status !== 'proposed');

  console.log('='.repeat(80));
  console.log(`BULK CONFIRM  ${client.name}${dryRun ? '   (DRY RUN, nothing written)' : ''}`);
  console.log('='.repeat(80));
  console.log(`  markets            : ${markets.join(', ')}`);
  console.log(`  membership rows    : ${membership.length}`);
  console.log(`  in those markets   : ${inMarket.length}`);
  console.log(`  already decided    : ${alreadyDecided.length}  (left exactly as they are)`);
  console.log(`  to confirm         : ${toConfirm.length}`);
  const stillProposed = membership.filter((m) => m.status === 'proposed').length - toConfirm.length;
  console.log(`  STAYING 'proposed' in every other market: ${stillProposed}`);

  const byMarket = new Map<string, number>();
  for (const m of toConfirm) {
    const k = String(byId.get(m.project_id as string)?.market ?? '(none)');
    byMarket.set(k, (byMarket.get(k) ?? 0) + 1);
  }
  console.log('\n  per market:');
  for (const [k, n] of [...byMarket.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(n).padStart(4)}  ${k}`);
  }

  if (dryRun) {
    console.log('\nDRY RUN. Nothing written.');
    return;
  }
  if (toConfirm.length === 0) {
    console.log('\nNothing to confirm.');
    return;
  }

  let failed = 0;
  const CHUNK = 100;
  const ids = toConfirm.map((m) => m.id as string);
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { error } = await supabaseAdmin
      .from('client_projects')
      .update({ status: 'included', set_by: 'bulk-confirm', set_at: new Date().toISOString() })
      .in('id', slice);
    if (error) {
      console.error(`  update failed for ${slice.length} rows: ${error.message}`);
      failed += slice.length;
    }
  }
  console.log(`\nconfirmed ${ids.length - failed} rows, ${failed} failed.`);
  console.log("set_by = 'bulk-confirm'. Every row is individually reversible from the register:");
  console.log('C and X overwrite it exactly as they would any other proposal.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
