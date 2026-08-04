// DOCUMENTATION CAPTURES. 1920x1080, light, real data.
//
// These accompany WALKTHROUGH.md. Every id is resolved at run time from the
// live database rather than hardcoded, so a data change cannot turn a
// documentation shot into a "page not found" that reads like a broken route.

import { test, expect } from '@playwright/test';
import path from 'node:path';

const OUT = (name: string) => path.join('e2e', 'shots', 'walkthrough', `${name}.png`);

async function settle(page: import('@playwright/test').Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle').catch(() => {});
}

// Hydration, not markup: the theme control sets aria-pressed only in an effect.
async function hydrated(page: import('@playwright/test').Page) {
  await expect(page.locator('button[aria-pressed="true"]').first()).toBeVisible({
    timeout: 60_000,
  });
}

test('walkthrough captures', async ({ page }) => {
  // ---- 1. Today
  await page.goto('/today', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible({
    timeout: 120_000,
  });
  await settle(page);
  await page.screenshot({ path: OUT('1-today'), fullPage: true, animations: 'disabled' });

  // ---- 2. Register, with the detail pane open on a real project.
  await page.goto('/register', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-row-id]').first()).toBeVisible({ timeout: 120_000 });
  await hydrated(page);

  // Pick a project that actually has parties and records, so the pane shows
  // what the pane is for rather than four empty blocks.
  const ids = await page
    .locator('[data-row-id]')
    .evaluateAll((els) => els.slice(0, 10).map((e) => e.getAttribute('data-row-id')));
  let chosen = ids[0];
  for (const id of ids) {
    await page.goto(`/register?selected=${id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('aside[aria-label="Project detail"]')).toBeVisible({
      timeout: 60_000,
    });
    const parties = await page.locator('aside dl dd').count();
    const rows = await page.locator('aside ol li').count();
    if (parties > 0 && rows > 1) {
      chosen = id;
      break;
    }
  }
  await page.goto(`/register?selected=${chosen}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('aside[aria-label="Project detail"]')).toBeVisible({ timeout: 60_000 });
  await settle(page);
  await page.screenshot({ path: OUT('2-register'), animations: 'disabled' });

  // ---- 3. Project page, the same project.
  await page.goto(`/project/${chosen}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1')).toBeVisible({ timeout: 60_000 });
  await settle(page);
  await page.screenshot({ path: OUT('3-project'), fullPage: true, animations: 'disabled' });

  // ---- 4. Company page, reached the way a person reaches it.
  const companyHref = await page.locator('a[href^="/company/"]').first().getAttribute('href');
  expect(companyHref, 'the chosen project had no party to follow').toBeTruthy();
  await page.goto(companyHref as string, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1')).toBeVisible({ timeout: 60_000 });
  await settle(page);
  await page.screenshot({ path: OUT('4-company'), fullPage: true, animations: 'disabled' });

  // ---- 5. Command palette, open, mid-search.
  await page.goto('/register', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-row-id]').first()).toBeVisible({ timeout: 60_000 });
  await hydrated(page);
  await page.keyboard.press('ControlOrMeta+k');
  const input = page.getByPlaceholder('Jump to a project, a screen, or a pipeline');
  await expect(input).toBeVisible({ timeout: 20_000 });
  await input.fill('resort');
  await expect(page.locator('[cmdk-item]').first()).toBeVisible({ timeout: 20_000 });
  await settle(page);
  await page.screenshot({ path: OUT('5-command-palette'), animations: 'disabled' });
  await page.keyboard.press('Escape');

  // ---- 6. Design system.
  await page.goto('/design', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Design system' })).toBeVisible({
    timeout: 60_000,
  });
  await settle(page);
  await page.screenshot({ path: OUT('6-design-system'), fullPage: true, animations: 'disabled' });
});
