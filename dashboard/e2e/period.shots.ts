// PERIOD SELECTION AND TIME BUCKETING, SEEN.
//
// Three captures: the Register on a named month bucketed by week, the same
// month on the moved axis, and Today on a closed period. Done means seen.

import { test, expect } from '@playwright/test';
import path from 'node:path';

test('period selection', async ({ page }, testInfo) => {
  const mode = testInfo.project.name;
  const shot = (name: string) =>
    page.screenshot({
      path: path.join('e2e', 'shots', mode, `08-${name}.png`),
      animations: 'disabled',
    });

  // 1. July 2026, arrived, bucketed by week.
  await page.goto('/projects?view=all&country=any&period=m:2026-07&axis=arrived&bucket=week', {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByTestId('period-bounds')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('[data-row-id]').first()).toBeVisible({ timeout: 120_000 });
  await page.evaluate(() => document.fonts.ready);
  // The bucket heading is the whole point of the capture: if it is absent the
  // screenshot would show a flat list and prove nothing.
  await expect(page.getByText(/^Week of 2026-07/).first()).toBeVisible({ timeout: 30_000 });
  await shot('period-register-week');

  // 2. The same month on the moved axis, bucketed by month.
  await page.goto('/projects?view=all&country=any&period=m:2026-07&axis=moved&bucket=month', {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.locator('[data-row-id]').first()).toBeVisible({ timeout: 120_000 });
  await page.evaluate(() => document.fonts.ready);
  await shot('period-register-moved');

  // 3. Today on a closed period.
  await page.goto('/today?period=m:2026-07', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('period-bounds')).toBeVisible({ timeout: 120_000 });
  await page.evaluate(() => document.fonts.ready);
  await shot('period-today-month');
});
