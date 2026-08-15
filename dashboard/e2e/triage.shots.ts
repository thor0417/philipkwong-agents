// KEYBOARD TRIAGE, EXERCISED.
//
// The brief's claim is that the Register can be worked without the mouse. This
// proves it by doing exactly that: arrow down the list, watch the selection
// follow, toggle the watchlist, and close the pane. It fails if any one of
// those keys stops being wired.
//
// Deliberately does NOT press E. Dismiss is a real write against the live
// database, and a screenshot run should not quietly bin one of Philip's
// projects every time it executes. Watch is reversible and is toggled back.

import { test, expect } from '@playwright/test';
import path from 'node:path';

test('keyboard triage', async ({ page }, testInfo) => {
  const mode = testInfo.project.name;
  const shot = (name: string) =>
    page.screenshot({
      path: path.join('e2e', 'shots', mode, `05-triage-${name}.png`),
      animations: 'disabled',
    });

  await page.goto('/projects', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('header').first()).toBeVisible({ timeout: 120_000 });
  // Hydration, not markup: the keydown listener is attached in an effect.
  await expect(page.locator('button[aria-pressed="true"]').first()).toBeVisible({
    timeout: 60_000,
  });
  await page.evaluate(() => document.fonts.ready);

  const rows = page.locator('[data-row-id]');
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  const rowCount = await rows.count();
  expect(rowCount, 'the Register rendered no rows to triage').toBeGreaterThan(1);

  // J selects the first row and opens the detail pane beside the list.
  await page.keyboard.press('j');
  await expect(page.locator('aside[aria-label="Project detail"]')).toBeVisible({
    timeout: 30_000,
  });
  const first = await page.locator('[data-row-id]').first().getAttribute('data-row-id');
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toBe(first);
  await shot('selected');

  // J again moves down; K comes back. The URL is the source of truth, so this
  // also proves the selection is shareable rather than component state.
  await page.keyboard.press('j');
  const second = await page.locator('[data-row-id]').nth(1).getAttribute('data-row-id');
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toBe(second);

  await page.keyboard.press('k');
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toBe(first);

  // W toggles the watchlist, and the pane reflects it. Toggled straight back so
  // the run leaves no trace in the database.
  const watchBtn = page.locator('aside[aria-label="Project detail"] button', {
    hasText: /^(Watch|Watching)$/,
  });
  const before = (await watchBtn.textContent())?.trim();
  await page.keyboard.press('w');
  await expect
    .poll(async () => (await watchBtn.textContent())?.trim(), { timeout: 30_000 })
    .not.toBe(before);
  await shot('watched');
  await page.keyboard.press('w');
  await expect
    .poll(async () => (await watchBtn.textContent())?.trim(), { timeout: 30_000 })
    .toBe(before);

  // Escape closes the pane and clears the selection from the URL.
  await page.keyboard.press('Escape');
  await expect(page.locator('aside[aria-label="Project detail"]')).toBeHidden({
    timeout: 20_000,
  });
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toBeNull();
  await shot('closed');
});
