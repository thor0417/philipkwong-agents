// DOES THE DOCUMENT MATCH THE SCOPE PRINTED ON ITS COVER?
//
// The composer printed venue, category and stream on the cover and offered no
// way to set them, and the generator resolved a scope whose stream axis it
// silently ignored. Both halves of that are the same defect: a document whose
// stated scope and actual contents are produced by different code.
//
// THE TEST IS AN EQUALITY, NOT A DECREASE. "The count went down" only proves
// something was removed. This asserts the composer's number equals the number
// of projects the database holds under exactly that constraint, which is the
// only way to show that what came out is what the cover claims - no out-of-
// scope project surviving, no in-scope project dropped.
//
// Read only. It narrows this report in the composer, which is state that dies
// with the page; it never writes a scope.

import { test, expect } from '@playwright/test';
import { streamLabel } from '../lib/streams';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const CLIENT_NAME = 'Simtec Attractions';
const PERIOD = 'm:2026-07';

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

test('the three axes the composer used to drop', async ({ page }) => {
  test.setTimeout(600_000);

  const env = {
    ...readEnvFile(resolve(process.cwd(), '..', '.env.local')),
    ...readEnvFile(resolve(process.cwd(), '.env.local')),
    ...process.env,
  } as Record<string, string>;
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // The client's stored scope, so the expected numbers are computed against
  // what the composer actually inherited rather than against an assumption.
  const { data: clients } = await admin.from('clients').select('id,name').eq('name', CLIENT_NAME);
  const clientId = clients?.[0]?.id as string;
  expect(clientId, `${CLIENT_NAME} is not on the clients table`).toBeTruthy();
  const { data: scopes } = await admin.from('client_scopes').select('*').eq('client_id', clientId);
  const scope = scopes![0];
  const markets: string[] = scope.markets ?? [];
  const stages: string[] = scope.stages ?? [];
  const venues: string[] = scope.venue_types ?? [];
  const categories: string[] = scope.development_categories ?? [];
  console.log(
    `\n  stored scope: markets=${markets.length} stages=${JSON.stringify(stages)} ` +
      `venues=${JSON.stringify(venues)} categories=${JSON.stringify(categories)}`
  );

  // Every project the stored scope covers, with the axes under test, read
  // straight from the database. `dormant` is dropped because the composer
  // excludes dormant projects by default.
  const { data: rows } = await admin
    .from('projects')
    .select('id,market,stage,development_category,venue_type')
    .eq('module', 'gli')
    .neq('status', 'dismissed')
    .limit(3000);
  const fold = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  // EVERY STORED AXIS, not the two this audit first knew about. Leaving venue
  // out produced an "expected" of 37 against a correct 4 and read as the filter
  // being broken - the audit lying about the code rather than the other way
  // round, which is the more dangerous direction.
  const inScope = (rows ?? []).filter(
    (r) =>
      (markets.length === 0 || markets.map(fold).includes(fold(r.market))) &&
      (stages.length === 0 || stages.map(fold).includes(fold(r.stage))) &&
      (venues.length === 0 || venues.map(fold).includes(fold(r.venue_type))) &&
      (categories.length === 0 || categories.map(fold).includes(fold(r.development_category))) &&
      fold(r.stage) !== 'dormant'
  );
  console.log(`  database says the stored scope covers ${inScope.length} projects`);

  // Which lanes each in-scope project holds a record in.
  const streamsByProject = new Map<string, Set<string>>();
  const ids = inScope.map((r) => r.id as string);
  for (let i = 0; i < ids.length; i += 150) {
    const { data: leads } = await admin
      .from('leads')
      .select('project_id,stream')
      .in('project_id', ids.slice(i, i + 150))
      .neq('status', 'dismissed');
    for (const l of leads ?? []) {
      if (!l.project_id || !l.stream) continue;
      if (!streamsByProject.has(l.project_id)) streamsByProject.set(l.project_id, new Set());
      streamsByProject.get(l.project_id)!.add(l.stream);
    }
  }

  await page.goto('/reports', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('report-client')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('report-client').selectOption({ label: CLIENT_NAME });
  await page.getByTestId('period-month').selectOption(PERIOD);

  async function settled(): Promise<{ projects: number; filters: string }> {
    await expect
      .poll(async () => await page.getByTestId('preview-projects-count').textContent(), { timeout: 60_000 })
      .not.toContain('--');
    const t = await page.getByTestId('preview-projects-count').textContent();
    const filters = (await page.locator('[data-scope-value="Filters"]').textContent()) ?? '';
    return { projects: Number((t ?? '').replace(/\D/g, '')), filters: filters.trim() };
  }

  const base = await settled();
  console.log(`  composer baseline: ${base.projects} projects | cover filters: ${base.filters}`);
  expect(base.projects, 'the stored scope matched nothing').toBe(inScope.length);

  const out: Record<string, unknown> = { baseline: base };

  // ---- ONE AXIS AT A TIME. Each chip is toggled on, measured, toggled off, so
  // the axes cannot mask one another.
  async function narrow(axis: 'category' | 'venue' | 'stream', value: string, expected: number) {
    const chip = page.locator(`[data-testid="report-${axis}-chips"] [data-report-option="${value}"]`);
    await expect(chip, `the composer offers no ${axis} chip for ${value}`).toHaveCount(1);
    await chip.click();
    const after = await settled();
    console.log(
      `  ${axis} = ${value.padEnd(22)} -> ${String(after.projects).padStart(3)} projects (database: ${expected}) | cover: ${after.filters}`
    );
    expect(after.projects, `narrowing by ${axis} did not reduce the report`).toBeLessThan(base.projects);
    expect(after.projects, `${axis}=${value} did not match the database exactly`).toBe(expected);
    // THE COVER HAS TO SAY SO. A document that quietly narrowed is the same
    // defect as one that quietly did not.
    //
    // The cover states the narrowing in the words the PRODUCT uses, which for a
    // stream is not the stored id: 'opportunity' is written and "Tenders and
    // RFPs" is printed (lib/streams). Asserting on the raw id would pin the
    // cover to the database's vocabulary and fail the moment a label is made
    // readable - which is exactly what happened. So the expected text is the
    // label where one exists, and the assertion is otherwise unchanged.
    const shown = axis === 'stream' ? streamLabel(value) : value;
    expect(after.filters.toLowerCase(), 'the cover does not state the narrowing').toContain(
      shown.toLowerCase()
    );
    out[`${axis}:${value}`] = { shown: after.projects, expected, filters: after.filters };
    await chip.click();
    await settled();
  }

  const CATEGORY = 'Hospitality/Tourism';
  await narrow(
    'category',
    CATEGORY,
    inScope.filter((r) => fold(r.development_category) === fold(CATEGORY)).length
  );

  // The venue chip must come from what the composer offers, which a stored
  // venue constraint narrows to that constraint. Picking the commonest venue
  // among the in-scope projects guarantees the narrowing is a real subset
  // rather than a no-op or an empty one.
  const venueCounts = new Map<string, number>();
  for (const r of inScope) {
    if (r.venue_type) venueCounts.set(r.venue_type as string, (venueCounts.get(r.venue_type as string) ?? 0) + 1);
  }
  const VENUE = [...venueCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  expect(VENUE, 'no in-scope project carries a venue type to narrow by').toBeTruthy();
  await narrow('venue', VENUE!, inScope.filter((r) => fold(r.venue_type) === fold(VENUE)).length);

  // Both lanes, because they answer different questions: 'intelligence' shows
  // the axis narrowing to a real subset, and 'opportunity' shows it landing on
  // an honest zero rather than falling back to everything. A filter that fails
  // open is the one this project keeps finding.
  for (const STREAM of ['intelligence', 'opportunity']) {
    await narrow(
      'stream',
      STREAM,
      inScope.filter((r) => streamsByProject.get(r.id as string)?.has(STREAM)).length
    );
  }

  mkdirSync('e2e/shots/walkthrough', { recursive: true });
  writeFileSync('e2e/shots/walkthrough/report-scope-audit.json', JSON.stringify(out, null, 2));
});
