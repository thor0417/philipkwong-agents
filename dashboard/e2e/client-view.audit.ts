// A CLIENT IS A SAVED VIEW YOU OPEN, AND EVERY ROW IN IT SAYS WHY IT IS THERE.
//
// Opening a client opens Projects narrowed to that client's stored scope - the
// same table, the same columns, the same sort, the same keyboard. This measures
// what each client's scope actually proposes and requires the reason to be on
// every row, because a client list showing forty projects and nothing about why
// each one is in it is a list you either trust entirely or not at all, and one
// wrong project in a client document is worse than four missing ones.

import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { walkthroughDir, walkthroughOut } from './artefacts';

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

const env = {
  ...readEnvFile(resolve(process.cwd(), '..', '.env.local')),
  ...readEnvFile(resolve(process.cwd(), '.env.local')),
  ...process.env,
} as Record<string, string>;

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

test('every client view states why each project is in it', async ({ page }) => {
  test.setTimeout(600_000);
  const { data: clients, error } = await admin.from('clients').select('id,name').order('name');
  if (error) throw new Error(error.message);
  expect((clients ?? []).length, 'no clients to open').toBeGreaterThan(0);

  const report: {
    client: string;
    proposed: number;
    withReason: number;
    withoutReason: number;
    unconstrained: boolean;
    bar: string;
    sample: string[];
  }[] = [];

  for (const c of clients ?? []) {
    await page.goto(`/projects?client=${c.id}&country=any`, { waitUntil: 'domcontentloaded' });
    const bar = page.getByTestId('client-scope-bar');
    await expect(bar, `${c.name} opened no client bar`).toBeVisible({ timeout: 120_000 });
    const pager = page.getByTestId('pager-total');
    await expect
      .poll(async () => await pager.getAttribute('data-total'), { timeout: 120_000 })
      .not.toBeNull();
    const proposed = Number(await pager.getAttribute('data-total'));
    const barText = (await bar.innerText()).replace(/\s+/g, ' ').trim();

    const reasons = await page
      .locator('[data-row-reason]')
      .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
    const rows = await page.locator('[data-row-id]').count();
    const unconstrained = /constrains no axis|stores no scope/.test(barText);
    const real = reasons.filter(
      (r) => r && !/constrains no axis|no stored scope|matched no constrained axis/.test(r)
    );

    console.log(`\n${c.name}`);
    console.log(`  ${barText}`);
    console.log(`  proposed ${proposed}, page shows ${rows} rows, ${real.length} carry a reason`);
    for (const r of reasons.slice(0, 5)) console.log(`    - ${r}`);

    report.push({
      client: c.name,
      proposed,
      withReason: real.length,
      withoutReason: rows - real.length,
      unconstrained,
      bar: barText,
      sample: reasons.slice(0, 5),
    });

    // EVERY ROW CARRIES A REASON, whatever that reason is. A blank second line
    // in a client view is the state this part exists to end.
    expect(
      reasons.length,
      `${c.name}: ${rows} rows and ${reasons.length} reasons - a row in a client view with no reason on it`
    ).toBe(rows);
    if (!unconstrained) {
      expect(
        real.length,
        `${c.name} is scoped and not one of its ${rows} rows names an axis it matched`
      ).toBeGreaterThan(0);
    }
  }

  mkdirSync(walkthroughDir(), { recursive: true });
  writeFileSync(walkthroughOut('client-view-audit.json'), JSON.stringify(report, null, 2));
});
