// RECONCILE A GENERATED REPORT AGAINST THE REGISTER, LIKE FOR LIKE.
//
// The register's Arrived axis and the report's period scope are two different
// code paths asking the same question: which projects did something in this
// window. The register asks it through fetchArrivedProjectIds; the report asks
// it inside buildReport, by period-filtering the records and treating a project
// with none as silent. Two paths, one question, so they must agree - and the
// first_seen defect is exactly the kind that makes one of them quietly wrong.
//
// Both numbers are read from the screen rather than computed here.

import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { walkthroughDir, walkthroughOut } from './artefacts';

test('the JKR August report reconciles with the register Arrived count', async ({ page }) => {
  const out: Record<string, unknown> = {};

  // ---- the register, Arrived, August, no geography narrowing ---------------
  await page.goto('/projects?view=all&country=any&axis=arrived&period=m:2026-08', {
    waitUntil: 'domcontentloaded',
  });
  const pager = page.getByTestId('pager-total');
  await expect(pager).toBeVisible({ timeout: 120_000 });
  await expect.poll(async () => await pager.getAttribute('data-total'), { timeout: 120_000 }).not.toBeNull();
  const registerArrived = Number(await pager.getAttribute('data-total'));
  const resolution = (await page.getByTestId('axis-resolution').textContent())?.trim();
  console.log(`register  arrived m:2026-08 = ${registerArrived} projects   (${resolution})`);
  out.register = { arrived: registerArrived, resolution };

  // ---- the same window, as a JKR report -------------------------------------
  await page.goto('/reports', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('report-client')).toBeVisible({ timeout: 120_000 });
  await page.getByTestId('report-client').selectOption({ label: 'JKR & Associates' });
  await page.getByTestId('period-month').selectOption('m:2026-08');
  await expect(page.getByTestId('report-preview')).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => await page.getByTestId('preview-projects-count').textContent(), { timeout: 60_000 })
    .not.toContain('--');

  const scope = Number(((await page.getByTestId('preview-projects-count').textContent()) ?? '').replace(/\D/g, ''));
  const records = Number(((await page.getByTestId('preview-records-count').textContent()) ?? '').replace(/\D/g, ''));
  const cover = (await page.locator('[data-scope-row="Basis"] [data-scope-value="Basis"]').textContent())?.trim();
  // Read from the whole preview and matched out, because the scoping statement
  // is a provenance-tagged line rather than a paragraph of its own.
  const previewText = (await page.getByTestId('report-preview').textContent()) ?? '';
  const scoping = /This report covers[\s\S]*?not covered here\./.exec(previewText)?.[0] ?? '';
  expect(scoping, 'the cover scoping statement is missing from the preview').not.toBe('');
  console.log(`report    in scope = ${scope} projects, ${records} records   basis: ${cover}`);
  console.log(`\nCOVER:\n${scoping}\n`);
  out.report = { scope, records, cover, scoping };

  // The cover states the partition; pull the three numbers out of it.
  const described = Number(/(\d+)\s+(?:is|are)\s+described in full/.exec(scoping)?.[1] ?? '0');
  const counted = Number(/(\d+)\s+further projects? (?:is|are) counted but not described/.exec(scoping)?.[1] ?? '0');
  const silent = Number(/(\d+)\s+projects? filed nothing in this period/.exec(scoping)?.[1] ?? '0');
  const active = described + counted;
  console.log(`report    described ${described} + counted ${counted} = ${active} active;  silent ${silent}`);
  out.partition = { described, counted, silent, active };

  // The partition must account for the scope exactly.
  const unplaced = Number(/(\d+)\s+carry no market or region/.exec(scoping)?.[1] ?? '0');
  expect(described + counted + silent + unplaced, 'the cover does not account for its own scope').toBe(scope);

  // AND THE ACTIVE COUNT MUST NOT EXCEED THE REGISTER'S. The report drops
  // dormant and hollow projects that the register still lists, so it is a
  // subset - but a report claiming MORE active projects than the register found
  // records for would mean one of the two period filters is not being applied.
  expect(
    active,
    'the report found more active projects in August than the register did, so one of the two period paths is wrong'
  ).toBeLessThanOrEqual(registerArrived);
  console.log(`\nreconciles: report active ${active} <= register arrived ${registerArrived}`);

  mkdirSync(walkthroughDir(), { recursive: true });
  writeFileSync(walkthroughOut('jkr-august-audit.json'), JSON.stringify(out, null, 2));
});
