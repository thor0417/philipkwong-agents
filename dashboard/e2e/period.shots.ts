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
  // The register's period control is one statement now - "Captured, July 2026,
  // by week" - with the rolling windows, the calendar periods, the named month,
  // the custom range, the axis and the bucketing inside the panel it opens. The
  // statement is what is asserted, because the statement is what the operator
  // reads; the bounds are checked where the panel is open, below.
  await expect(page.getByTestId('period-toggle')).toHaveText(/Captured, July 2026, by week/, {
    timeout: 120_000,
  });
  await expect(page.locator('[data-row-id]').first()).toBeVisible({ timeout: 120_000 });
  await page.evaluate(() => document.fonts.ready);
  // The bucket heading is the whole point of the capture: if it is absent the
  // screenshot would show a flat list and prove nothing.
  await expect(page.getByText(/^Week of 2026-07/).first()).toBeVisible({ timeout: 30_000 });
  await shot('period-register-week');

  // The panel itself, open, so the control that was five rows is photographed
  // as the one it became.
  await page.getByTestId('period-toggle').click();
  await expect(page.getByTestId('period-bounds')).toBeVisible({ timeout: 30_000 });
  await shot('period-register-panel');
  await page.keyboard.press('Escape');

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
