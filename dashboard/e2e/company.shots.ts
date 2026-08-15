// THE COMPANY PAGE, captured on a real company reached the way a person
// reaches it: from a project's People list. That also proves the party link
// works, which is the whole reason companies were captured.
//
// The merge control is OPENED and its candidate list is exercised, but no merge
// is executed. A merge is a real, multi-row write against the live database and
// a screenshot run must not perform one every time it executes.

import { test, expect } from '@playwright/test';
import path from 'node:path';

test('company page', async ({ page }, testInfo) => {
  const mode = testInfo.project.name;

  // Find a project that actually has a party, rather than assuming the first
  // one does. Projects without an identified applicant are common.
  await page.goto('/projects', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-row-id]').first()).toBeVisible({ timeout: 120_000 });
  const ids = await page.locator('[data-row-id]').evaluateAll((els) =>
    els.slice(0, 8).map((e) => e.getAttribute('data-row-id'))
  );

  let companyHref: string | null = null;
  for (const id of ids) {
    await page.goto(`/project/${id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1')).toBeVisible({ timeout: 60_000 });
    const link = page.locator('a[href^="/company/"]').first();
    if ((await link.count()) > 0) {
      companyHref = await link.getAttribute('href');
      break;
    }
  }
  expect(companyHref, 'no project in the first page had an identified party').toBeTruthy();

  await page.goto(companyHref as string, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1')).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle').catch(() => {});

  await expect(page.getByRole('heading', { name: /^Projects/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Related companies' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Duplicates' })).toBeVisible();

  await page.screenshot({
    path: path.join('e2e', 'shots', mode, `07-company.png`),
    fullPage: true,
    animations: 'disabled',
  });

  // The merge control opens and searches. Nothing is merged.
  await page.getByRole('button', { name: /Merge another company/ }).click();
  const search = page.getByLabel('Find a company to merge');
  await expect(search).toBeVisible();
  await search.fill('lp');
  // Either candidates appear or the honest "no company matches" line does.
  await expect
    .poll(async () =>
      (await page.locator('ul li').filter({ hasText: /./ }).count()) > 0 ? 'listed' : 'empty'
    )
    .toBe('listed');
  await page.screenshot({
    path: path.join('e2e', 'shots', mode, `07-company-merge.png`),
    animations: 'disabled',
  });
});
