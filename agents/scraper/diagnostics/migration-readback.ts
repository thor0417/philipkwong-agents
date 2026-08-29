// READ BACK 046, 047, 048 AND 049 AFTER THEY HAVE BEEN RUN.
//
//     npm run diag:readback
//
// Standing rule 11: a thing is done when it has been read back, not when it has
// been described - and "the migration ran" is a description. Each block below
// asks the database the question the migration claims to have answered, and
// prints the answer rather than a verdict derived from an exit code.
//
// NO CAPS. Counts are exact server-side counts or paged reads. A migration
// verified against PostgREST's silent 1,000-row default is verified against the
// first thousand rows.

import { supabaseAdmin } from '../../../lib/supabase-admin';

const OPERATOR = 'Philip Kwong';

async function count(table: string, build?: (q: any) => any): Promise<number> {
  let q: any = supabaseAdmin.from(table).select('*', { count: 'exact', head: true });
  if (build) q = build(q);
  const { count: n, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return n ?? 0;
}

async function distinct(table: string, col: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let f = 0; ; f += 1000) {
    const { data, error } = await supabaseAdmin.from(table).select(col).range(f, f + 999);
    if (error) throw new Error(`${table}.${col}: ${error.message}`);
    const rows = (data ?? []) as unknown as Record<string, string | null>[];
    for (const r of rows) {
      const k = r[col] ?? '(null)';
      out.set(k, (out.get(k) ?? 0) + 1);
    }
    if (rows.length < 1000) break;
  }
  return out;
}

function head(n: string, t: string): void {
  console.log(`\n${'='.repeat(78)}\n${n}  ${t}\n${'='.repeat(78)}`);
}

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  console.log(`        ${detail}`);
}

// ---- 046 -------------------------------------------------------------------

async function m046(): Promise<void> {
  head('046', 'clients.brand_name is gone');

  // The only honest test of "the column is gone" is to ask for it and be
  // refused. A select that succeeds proves it is still there.
  const probe = await supabaseAdmin.from('clients').select('brand_name').limit(1);
  check(
    'clients.brand_name no longer exists',
    !!probe.error,
    probe.error
      ? `select brand_name from clients -> ${probe.error.message}`
      : `THE COLUMN IS STILL THERE. select returned ${JSON.stringify(probe.data)}`
  );

  const pipe = await supabaseAdmin.from('pipelines').select('brand_name,brand_logo').limit(1);
  console.log(
    `  note  pipelines.brand_name / brand_logo: ${
      pipe.error ? `dropped (${pipe.error.message.slice(0, 60)})` : 'still present - statement 2 was skipped, which is allowed'
    }`
  );

  // deliveries.brand_name MUST survive. It is the record of what was printed.
  const del = await supabaseAdmin.from('deliveries').select('brand_name').limit(1);
  check(
    'deliveries.brand_name SURVIVES, because it is the evidence',
    !del.error,
    del.error ? `IT IS GONE: ${del.error.message}` : 'the column still answers, as 046 statement 3 requires'
  );

  const { data: clients, error } = await supabaseAdmin
    .from('clients')
    .select('name,status,addressee,cadence,next_delivery')
    .order('name');
  if (error) throw new Error(`clients: ${error.message}`);
  console.log('\n  the clients, with no brand column to show:');
  for (const c of (clients ?? []) as Record<string, string>[]) {
    console.log(`    ${String(c.name).padEnd(22)} ${String(c.status).padEnd(8)} addressee=${c.addressee ?? '(null)'}  ${c.cadence ?? '-'} next ${c.next_delivery ?? '-'}`);
  }
}

// ---- 047 -------------------------------------------------------------------

async function m047(): Promise<void> {
  head('047', 'the corrections are recorded, and the originals still say what was sent');

  const probe = await supabaseAdmin.from('deliveries').select('corrected_at').limit(1);
  check(
    'the four correction columns exist',
    !probe.error,
    probe.error ? `047 has NOT been applied: ${probe.error.message}` : 'corrected_at answers'
  );
  if (probe.error) return;

  const misbranded = await count('deliveries', (q) => q.neq('brand_name', OPERATOR));
  const corrected = await count('deliveries', (q) => q.not('corrected_at', 'is', null));
  const stillSaysJkr = await count('deliveries', (q) =>
    q.eq('brand_name', 'JKR & Associates')
  );

  check(
    'every misbranded row is marked corrected',
    corrected === misbranded && misbranded > 0,
    `${misbranded} rows carry a brand that is not the operator's; ${corrected} carry corrected_at`
  );
  check(
    'THE ORIGINAL STILL SAYS WHAT WAS PRINTED. brand_name was never rewritten',
    stillSaysJkr === 22,
    `${stillSaysJkr} rows still read brand_name = 'JKR & Associates'. Rewriting them would have ` +
      `erased the only evidence the 22 happened, which is the defect one layer down`
  );

  const { data: sample } = await supabaseAdmin
    .from('deliveries')
    .select('id,document_type,brand_name,corrected_from_brand,corrected_at,correction_note,generated_at')
    .not('corrected_at', 'is', null)
    .order('generated_at')
    .limit(3);
  console.log('\n  three of the corrected rows, in full:');
  for (const d of (sample ?? []) as Record<string, string>[]) {
    console.log(`\n    id                   ${d.id}`);
    console.log(`    generated            ${String(d.generated_at).slice(0, 10)}   ${d.document_type}`);
    console.log(`    brand_name           ${d.brand_name}     <- UNCHANGED, this is what was sent`);
    console.log(`    corrected_from_brand ${d.corrected_from_brand}`);
    console.log(`    corrected_at         ${String(d.corrected_at).slice(0, 19)}`);
    console.log(`    correction_note      ${String(d.correction_note ?? '').slice(0, 150)}`);
  }

  const byBrand = await distinct('deliveries', 'brand_name');
  console.log('\n  deliveries.brand_name, whole table:');
  for (const [k, n] of [...byBrand].sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(22)} ${n}`);
}

// ---- 048 -------------------------------------------------------------------

async function m048(): Promise<void> {
  head('048', "zero rows carry module = 'gli'");

  const tables = ['leads', 'projects', 'project_events'] as const;
  let legacy = 0;
  let renamed = 0;
  for (const t of tables) {
    const g = await count(t, (q) => q.eq('module', 'gli'));
    const h = await count(t, (q) => q.eq('module', 'hospitality'));
    const all = await count(t);
    legacy += g;
    renamed += h;
    console.log(`  ${t.padEnd(15)} 'gli' ${String(g).padStart(5)}   'hospitality' ${String(h).padStart(5)}   table ${String(all).padStart(5)}`);
  }
  check(
    "no row anywhere carries module = 'gli'",
    legacy === 0,
    `${legacy} rows still carry it; ${renamed} carry 'hospitality' (expected 1902 + 424 + 1930 = 4256)`
  );
  // A FLOOR, NOT AN EQUALITY. The corpus is live: the Playwright suite writes
  // project_events and deliveries while it runs, and every row written since the
  // constant flipped carries 'hospitality' rather than 'gli'. So 4,256 is what
  // the migration moved and anything above it is new work, not a miscount.
  // Asserting an exact 4,256 fails on a healthy system the moment anything runs,
  // and a check that fails on the normal state of the world gets ignored.
  check(
    'the 4,256 arrived rather than vanishing, and nothing was lost',
    renamed >= 4256,
    `${renamed} rows carry 'hospitality' against a floor of 4,256 (1902 + 424 + 1930); ` +
      `${renamed - 4256} were written after the flip, by writers that now emit the new value`
  );

  for (const t of tables) {
    const d = await distinct(t, 'module');
    console.log(`  ${t}.module: ${[...d].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join('   ')}`);
  }
}

// ---- 049 -------------------------------------------------------------------

async function m049(): Promise<void> {
  head('049', 'leads.industry, and the Serper lane label left alone');

  const d = await distinct('leads', 'industry');
  console.log('  leads.industry, whole table, paged:');
  for (const [k, n] of [...d].sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(30)} ${n}`);

  check(
    "no row carries industry = 'gli'",
    (d.get('gli') ?? 0) === 0,
    `${d.get('gli') ?? 0} rows still carry it`
  );
  check(
    "1,902 carry industry = 'hospitality'",
    (d.get('hospitality') ?? 0) === 1902,
    `${d.get('hospitality') ?? 0} carry it`
  );

  // THE CONSULTING-ERA LABELS MUST NOT HAVE MOVED. This is the half a blanket
  // rename would have broken, and it includes the Serper lane's own label.
  const expected: Record<string, number> = {
    fuel_tenders: 281,
    feasibility: 119,
    general_consulting: 29,
    healthcare_pharma: 26,
    '(null)': 23,
    financial_services: 16,
    technology_ai: 8,
    signals: 2,
    ethanol_gulf: 1,
    food_beverage_hospitality: 1,
  };
  let moved: string[] = [];
  for (const [k, want] of Object.entries(expected)) {
    const got = d.get(k) ?? 0;
    if (got !== want) moved.push(`${k}: expected ${want}, found ${got}`);
  }
  check(
    'every OTHER industry label is untouched, the Serper lane label included',
    moved.length === 0,
    moved.length === 0
      ? 'fuel_tenders 281, feasibility 119, general_consulting 29, healthcare_pharma 26, null 23, ' +
        'financial_services 16, technology_ai 8, signals 2, ethanol_gulf 1, food_beverage_hospitality 1 - all unchanged'
      : moved.join('; ')
  );

  // The two parked rows: their industry should now agree with their module.
  const compliance = await count('leads', (q) => q.eq('module', 'compliance'));
  const complianceInd = await count('leads', (q) => q.eq('module', 'compliance').eq('industry', 'compliance'));
  const complianceGli = await count('leads', (q) => q.eq('module', 'compliance').eq('industry', 'gli'));
  console.log(
    `\n  the two rows park-compliance-and-dismiss left behind: module 'compliance' = ${compliance}, ` +
      `of which industry 'compliance' = ${complianceInd} and industry 'gli' = ${complianceGli}`
  );

  // The invariant the gate enforces in code, checked in the data.
  const split = await count('leads', (q) =>
    q.eq('module', 'hospitality').neq('industry', 'hospitality')
  );
  check(
    'no live-pipeline row carries an industry that is not its module',
    split === 0,
    `${split} rows have module 'hospitality' and some other industry. This is the invariant ` +
      `verify:pipelines now enforces on the writers`
  );
}

// ---- ITEM 4 ----------------------------------------------------------------

async function item4(): Promise<void> {
  head('ITEM 4', 'client_scopes.pipeline_id and the corpus read the same value');

  const scopes = await distinct('client_scopes', 'pipeline_id');
  console.log(`  client_scopes.pipeline_id: ${[...scopes].map(([k, n]) => `${k} ${n}`).join('   ')}`);

  for (const id of [...scopes.keys()].filter((k) => k !== '(null)')) {
    const strict = await count('projects', (q) => q.eq('module', id).neq('status', 'dismissed'));
    check(
      `a scope on '${id}' finds its corpus with a plain equality join`,
      strict > 0,
      `select count(*) from projects where module = '${id}' and status <> 'dismissed'  ->  ${strict}. ` +
        `Before 048 this returned 0 over a register of 424, which is the mismatch item 4 was about`
    );
  }
}

async function main(): Promise<void> {
  await m046();
  await m047();
  await m048();
  await m049();
  await item4();
  console.log(`\n${'='.repeat(78)}`);
  console.log(failures === 0 ? 'ALL READ-BACKS PASS.' : `${failures} READ-BACK(S) FAILED. See FAIL above.`);
  console.log(`${'='.repeat(78)}\n`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
