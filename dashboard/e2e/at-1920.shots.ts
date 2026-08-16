// THE FIVE WORKING SCREENS, AT THE SIZE THEY ARE ACTUALLY USED AT.
//
// screens.shots captures at 1440x900, which is the demo machine, and that is
// the right baseline for the design system: it is the width the shell was drawn
// against. It is not the width the density questions are asked at. A filter
// block that consumes a third of the viewport looks tolerable at 900px tall and
// is the whole problem at 1080, which is how five rows of chips passed every
// check while being unusable.
//
// So this is a second, deliberately separate pass: the same screens, 1920x1080,
// light and dark, with no assertions of its own. rail.shots does the measuring
// and the asserting; this exists so a person can look.
//
// A CLIENT VIEW IS ONE OF THE FIVE, and its id is read off the rail rather than
// hardcoded - the clients are two rows in a table and a capture that names one
// by uuid is a capture that silently stops photographing a client view the day
// somebody renames them.

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const VIEWPORT = { width: 1920, height: 1080 };

test('the working screens at 1920x1080', async ({ page }, testInfo) => {
  const mode = testInfo.project.name; // 'light' | 'dark'
  test.setTimeout(300_000);
  await page.setViewportSize(VIEWPORT);
  const out = path.join('e2e', 'shots', mode);
  mkdirSync(out, { recursive: true });

  const shot = async (name: string) => {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(out, `11-${name}-1920.png`), animations: 'disabled' });
  };

  // ---- Projects, as it opens.
  await page.goto('/projects', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-row-id]').first()).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(2000);
  await shot('projects');

  // ---- A client view, opened the way the operator now opens one: from the
  // rail, where the clients sit beside the saved views.
  const client = page.locator('[data-client-view]').last();
  await expect(client, 'the rail offers no client view to open').toBeVisible({ timeout: 30_000 });
  await client.click();
  await expect(page.getByTestId('client-scope-bar')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  await shot('client-view');

  for (const [name, url, ready] of [
    ['inbox', '/inbox', '[data-testid="inbox-total"]'],
    ['players', '/players', '[data-testid="players-stats"]'],
    ['health', '/health', '[data-market]'],
  ] as const) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await expect(page.locator(ready).first()).toBeVisible({ timeout: 120_000 });
    await page.waitForTimeout(2000);
    await shot(name);
  }
});
