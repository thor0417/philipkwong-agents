// THE PROJECT PAGE, captured on a real project.
//
// The id is resolved at run time by opening the Register and taking the first
// row, rather than hardcoded. A hardcoded id rots the moment the data changes
// and then fails as "page not found", which reads like a broken route rather
// than a stale fixture.

import { test, expect } from '@playwright/test';
import path from 'node:path';

test('project page', async ({ page }, testInfo) => {
  const mode = testInfo.project.name;

  await page.goto('/projects', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-row-id]').first()).toBeVisible({ timeout: 120_000 });
  const id = await page.locator('[data-row-id]').first().getAttribute('data-row-id');
  expect(id, 'no project to open').toBeTruthy();

  await page.goto(`/project/${id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1')).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle').catch(() => {});

  // The two columns the brief specifies must both have rendered.
  await expect(page.getByRole('heading', { name: /^Timeline/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Related projects' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Event history/ })).toBeVisible();

  await page.screenshot({
    path: path.join('e2e', 'shots', mode, `06-project.png`),
    fullPage: true,
    animations: 'disabled',
  });
});
