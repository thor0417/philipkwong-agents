// DOES A STORED SCOPE STILL MATCH THE DATABASE?
//
// The failure this exists to catch is a scope that looks right and returns
// nothing. It has one cause and two shapes:
//
//   CASE AND WHITESPACE. A market is stored text compared against a column.
//   "clark county" and " Clark County " are the same intention as far as a
//   person is concerned, and were not as far as the query was concerned.
//
//   TWO MATCHING RULES FOR ONE SCOPE. A scope naming several markets was
//   post-filtered case-insensitively; a scope naming exactly one was pushed to
//   the server as an exact `eq`. So NARROWING a working scope from two markets
//   to one could take it from forty projects to zero, which is the worst
//   possible direction for a mistake to run - the narrower report is the one
//   somebody is about to send.
//
// THIS AUDIT WRITES, WHICH IS WHY IT RESTORES. It edits one client's scope
// through the same updateScope path the UI uses, measures what the screens then
// show, and puts the original scope back in a finally. A scope left mangled by
// a failed audit would be a bug shipped by the thing that checks for bugs.

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const CLIENT_NAME = 'Simtec Attractions';

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

test('a stored scope matches the database however it is spelled', async ({ page }) => {
  test.setTimeout(600_000);

  const env = {
    ...readEnvFile(resolve(process.cwd(), '..', '.env.local')),
    ...readEnvFile(resolve(process.cwd(), '.env.local')),
    ...process.env,
  } as Record<string, string>;
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: clients } = await admin.from('clients').select('id,name').eq('name', CLIENT_NAME);
  const clientId = clients?.[0]?.id as string | undefined;
  expect(clientId, `${CLIENT_NAME} is not on the clients table`).toBeTruthy();

  const { data: scopes } = await admin.from('client_scopes').select('*').eq('client_id', clientId!);
  const scope = scopes?.[0];
  expect(scope, 'that client has no scope to audit').toBeTruthy();
  const originalMarkets: string[] = scope!.markets ?? [];
  console.log(`\n  original markets: ${JSON.stringify(originalMarkets)}`);

  // The composer's project count for the client, read from the screen.
  async function composerProjects(): Promise<number> {
    await page.goto('/reports', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('report-client')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('report-client').selectOption({ label: CLIENT_NAME });
    await page.getByTestId('period-month').selectOption('m:2026-07');
    await expect
      .poll(async () => await page.getByTestId('preview-projects-count').textContent(), { timeout: 60_000 })
      .not.toContain('--');
    const t = await page.getByTestId('preview-projects-count').textContent();
    return Number((t ?? '').replace(/\D/g, ''));
  }

  const results: Record<string, number> = {};
  try {
    for (const [label, markets] of [
      ['two markets, as spelled in the register', ['Anaheim', 'Clark County']],
      ['two markets, wrong case and a stray space', ['anaheim', ' Clark County ']],
      ['one market, as spelled', ['Clark County']],
      // THE REGRESSION. Exactly this returned 0 before the resolver matched
      // tolerantly, while the two-market version above returned dozens.
      ['one market, wrong case', ['clark county']],
    ] as const) {
      const { error } = await admin.from('client_scopes').update({ markets }).eq('id', scope!.id);
      expect(error, `could not set the scope: ${error?.message}`).toBeNull();
      const n = await composerProjects();
      results[label] = n;
      console.log(`  ${label.padEnd(44)} ${JSON.stringify(markets).padEnd(34)} -> ${n} projects`);
      expect(n, `a scope of ${JSON.stringify(markets)} matched nothing`).toBeGreaterThan(0);
    }
  } finally {
    const { error } = await admin
      .from('client_scopes')
      .update({ markets: originalMarkets })
      .eq('id', scope!.id);
    console.log(`  restored markets: ${JSON.stringify(originalMarkets)}${error ? ` (FAILED: ${error.message})` : ''}`);
    expect(error, 'the original scope was not restored').toBeNull();
  }

  // Spelling must not change the answer. If it does, one of the two paths is
  // still matching differently from the other.
  expect(
    results['two markets, wrong case and a stray space'],
    'spelling changed what two markets matched'
  ).toBe(results['two markets, as spelled in the register']);
  expect(results['one market, wrong case'], 'spelling changed what one market matched').toBe(
    results['one market, as spelled']
  );

  mkdirSync('e2e/shots/walkthrough', { recursive: true });
  writeFileSync('e2e/shots/walkthrough/scope-match-audit.json', JSON.stringify(results, null, 2));
});
