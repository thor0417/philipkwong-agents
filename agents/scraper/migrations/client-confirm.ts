// CONFIRM OR EXCLUDE A CLIENT'S PROJECTS FROM THE COMMAND LINE.
//
//   npm run client:confirm -- --client Simtec                 list, writes nothing
//   npm run client:confirm -- --client Simtec --include 1,4,7,9,12 --write
//   npm run client:confirm -- --client Simtec --exclude 2,3 --write
//
// WHY THIS EXISTS. The register's C and X keys are the intended path and they are
// wired correctly - measured 2026-08-17: the schema accepts the upsert, the RLS
// policy admits an authenticated write, and the exact statement the browser makes
// succeeds with the anon key signed in as the operator. Something between the
// keystroke and that statement is not connecting, and it could not be observed
// without a browser.
//
// A DECISION THE OPERATOR CANNOT RECORD IS A PRODUCT THAT DOES NOT SHIP: the
// membership gate holds six tests, the whole client-document path and the push
// behind it. This is the way round while the keyboard path is diagnosed, not a
// replacement for it.
//
// IT NEVER CHOOSES. The numbers come from the operator. Running it with no
// --include and no --exclude prints the numbered list and writes nothing, which
// is the only safe default for a decision about what a paying client is covered
// for.

import { supabaseAdmin } from '../../../lib/supabase-admin';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] ?? null : null;
};
const WRITE = process.argv.includes('--write');
const CLIENT = arg('client');
const INCLUDE = arg('include');
const EXCLUDE = arg('exclude');
const RESET = arg('reset');

interface Row { id: string; project_id: string; status: string; set_by: string | null }
interface Proj { id: string; name: string; market: string | null; stage: string | null; status: string | null }

function numbers(spec: string | null): number[] {
  if (!spec) return [];
  return spec
    .split(/[,\s]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

async function main(): Promise<void> {
  if (!CLIENT) {
    console.error('usage: client:confirm -- --client <name substring> [--include 1,2,3] [--exclude 4,5] [--write]');
    process.exit(1);
  }
  const { data: clients, error: cErr } = await supabaseAdmin.from('clients').select('id,name');
  if (cErr) throw new Error(cErr.message);
  const matches = (clients ?? []).filter((c: any) => c.name.toLowerCase().includes(CLIENT.toLowerCase()));
  if (matches.length !== 1) {
    console.error(`"${CLIENT}" matches ${matches.length} clients: ${(clients ?? []).map((c: any) => c.name).join(', ')}`);
    process.exit(1);
  }
  const client = matches[0] as { id: string; name: string };

  const { data: rows, error: rErr } = await supabaseAdmin
    .from('client_projects')
    .select('id,project_id,status,set_by')
    .eq('client_id', client.id);
  if (rErr) throw new Error(rErr.message);
  const memberships = (rows ?? []) as Row[];

  const { data: projects, error: pErr } = await supabaseAdmin
    .from('projects')
    .select('id,name,market,stage,status')
    .in('id', memberships.map((m) => m.project_id));
  if (pErr) throw new Error(pErr.message);
  const byId = new Map((projects ?? []).map((p: any) => [p.id, p as Proj]));

  // A STABLE ORDER, so a number printed in one run means the same project in the
  // next. Sorted by name, not by whatever the query returned.
  const ordered = memberships
    .map((m) => ({ m, p: byId.get(m.project_id) }))
    .filter((x): x is { m: Row; p: Proj } => !!x.p)
    .sort((a, b) => a.p.name.localeCompare(b.p.name));

  console.log(`===== ${client.name} =====\n`);
  console.log(`${ordered.length} projects proposed by scope resolution.\n`);
  console.log('  #  status     market                 project');
  ordered.forEach((x, i) => {
    console.log(
      `${String(i + 1).padStart(3)}  ${x.m.status.padEnd(10)} ${(x.p.market ?? '-').slice(0, 21).padEnd(23)}${x.p.name.slice(0, 56)}`
    );
  });

  const inc = numbers(INCLUDE);
  const exc = numbers(EXCLUDE);
  const rst = numbers(RESET);
  if (!inc.length && !exc.length && !rst.length) {
    console.log('\nNothing selected, so nothing is written. Re-run with --include 1,4,7 --write');
    console.log('to confirm those numbers, or --exclude to hold them out.');
    return;
  }

  const plan: { row: Row; project: Proj; status: string }[] = [];
  const add = (ns: number[], status: string): void => {
    for (const n of ns) {
      const x = ordered[n - 1];
      if (!x) { console.error(`  no project numbered ${n}`); continue; }
      plan.push({ row: x.m, project: x.p, status });
    }
  };
  add(inc, 'included');
  add(exc, 'excluded');
  add(rst, 'proposed');

  console.log('\n--- what this would write ---\n');
  for (const p of plan) {
    console.log(`  ${p.row.status.padEnd(10)} -> ${p.status.padEnd(10)} ${p.project.name.slice(0, 60)}`);
  }

  if (!WRITE) {
    console.log('\nNothing was written. Re-run with --write to apply.');
    return;
  }
  for (const p of plan) {
    const { error } = await supabaseAdmin
      .from('client_projects')
      .update({ status: p.status, set_by: 'operator (cli)', set_at: new Date().toISOString() })
      .eq('id', p.row.id);
    if (error) throw new Error(`${p.project.name}: ${error.message}`);
  }
  const { data: after } = await supabaseAdmin.from('client_projects').select('status').eq('client_id', client.id);
  const by: Record<string, number> = {};
  for (const r of (after ?? []) as { status: string }[]) by[r.status] = (by[r.status] ?? 0) + 1;
  console.log(`\nApplied. ${client.name} now reads ${JSON.stringify(by)}.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
