// DOCUMENTATION CAPTURES. 1920x1080, light, real data.
//
// These accompany WALKTHROUGH.md. Every id is resolved at run time from the
// live database rather than hardcoded, so a data change cannot turn a
// documentation shot into a "page not found" that reads like a broken route.

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { walkthroughOut } from './artefacts';

const OUT = (name: string) => walkthroughOut(`${name}.png`);

async function settle(page: import('@playwright/test').Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle').catch(() => {});
}

/**
 * Make the page tall enough to photograph whole.
 *
 * The shell deliberately owns the viewport: `height: 100dvh; overflow: hidden`,
 * with each pane scrolling inside it. That is right for the product (the top bar
 * and column headers never drift) but it means Playwright's fullPage flag has
 * nothing to extend into: the document is exactly 1080px tall no matter how much
 * content sits inside the scrolling pane, so `fullPage: true` silently returns a
 * fold-cropped shot that looks like a complete one.
 *
 * For documentation captures only, this releases the height so the document
 * grows to its content and fullPage means what it says. It is injected CSS, not
 * a change to the app.
 */
async function unlockHeight(page: import('@playwright/test').Page) {
  await page.addStyleTag({
    content: `
      html, body { height: auto !important; overflow: visible !important; }
      /* The shell and its scrolling regions, by the properties that pin them,
         so this does not depend on hashed CSS-module class names. */
      body > div, body > div > div { height: auto !important; overflow: visible !important; }
      main, aside, nav { overflow: visible !important; max-height: none !important; }
    `,
  });
  // Let the layout settle at its new height before the shutter opens.
  await page.waitForTimeout(300);
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
  await unlockHeight(page);
  await page.screenshot({ path: OUT('1-today'), fullPage: true, animations: 'disabled' });

  // ---- 2. Register, with the detail pane open on a real project.
  await page.goto('/projects', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-row-id]').first()).toBeVisible({ timeout: 120_000 });
  await hydrated(page);

  // Pick a project that actually has parties and records, so the pane shows
  // what the pane is for rather than four empty blocks.
  const ids = await page
    .locator('[data-row-id]')
    .evaluateAll((els) => els.slice(0, 10).map((e) => e.getAttribute('data-row-id')));
  // SELECTED ON THE THING THAT IS LATER ASSERTED, which it was not.
  //
  // The loop used to accept any project whose DETAIL PANE showed parties, and
  // step 4 then required a COMPANY LINK on the project page. Those are two
  // different facts: a party is a name on a filing, and a company link exists
  // only where the companies layer has attached that party to a company row. It
  // held by luck until the register's top ten shifted, and then the run failed
  // three steps after the choice that caused it, with a timeout rather than a
  // reason.
  //
  // Now the project page itself is the test: a candidate is chosen only if it
  // has a party to follow, which is exactly what step 4 needs.
  let chosen = ids[0];
  let chosenCompany: string | null = null;
  for (const id of ids) {
    await page.goto(`/project/${id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1')).toBeVisible({ timeout: 60_000 });
    const href = await page
      .locator('a[href^="/company/"]')
      .first()
      .getAttribute('href')
      .catch(() => null);
    if (!href) continue;
    await page.goto(`/projects?selected=${id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('aside[aria-label="Project detail"]')).toBeVisible({
      timeout: 60_000,
    });
    const rows = await page.locator('aside ol li').count();
    if (rows > 1) {
      chosen = id;
      chosenCompany = href;
      break;
    }
  }
  expect(
    chosenCompany,
    'none of the top ten register rows has a company to follow, so the walkthrough cannot photograph one'
  ).toBeTruthy();
  console.log(`walkthrough project: ${chosen} -> ${chosenCompany}`);
  await page.goto(`/projects?selected=${chosen}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('aside[aria-label="Project detail"]')).toBeVisible({ timeout: 60_000 });
  await settle(page);
  await page.screenshot({ path: OUT('2-register'), animations: 'disabled' });

  // ---- 3. Project page, the same project.
  await page.goto(`/project/${chosen}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1')).toBeVisible({ timeout: 60_000 });
  await settle(page);
  await unlockHeight(page);
  await page.screenshot({ path: OUT('3-project'), fullPage: true, animations: 'disabled' });

  // ---- 4. Company page, reached the way a person reaches it.
  // The link found during selection, so this step cannot disagree with it.
  await page.goto(chosenCompany as string, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1')).toBeVisible({ timeout: 60_000 });
  await settle(page);
  await unlockHeight(page);
  await page.screenshot({ path: OUT('4-company'), fullPage: true, animations: 'disabled' });

  // ---- 5. Command palette, open, mid-search.
  await page.goto('/projects', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-row-id]').first()).toBeVisible({ timeout: 60_000 });
  await hydrated(page);
  await page.keyboard.press('ControlOrMeta+k');
  const input = page.getByPlaceholder('Jump to a project, find a record, or go to a screen');
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
  await unlockHeight(page);
  await page.screenshot({ path: OUT('6-design-system'), fullPage: true, animations: 'disabled' });
});
