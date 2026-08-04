// THE COMMAND PALETTE, EXERCISED.
//
// A screenshot of a closed palette proves nothing, so this opens it with the
// keyboard, types a real project name, and follows the result through to the
// destination. It fails if any link in that chain breaks: the shortcut, the
// server-side search, the result rendering, or the navigation.
//
// The project searched for is real data from this database. A test that types
// "test" and asserts "no results" would pass forever while the search was
// broken.

import { test, expect } from '@playwright/test';
import path from 'node:path';

const PROJECT = 'OCVibe'; // Anaheim, the largest project by record count

test('command palette', async ({ page }, testInfo) => {
  const mode = testInfo.project.name;
  const shot = (name: string) =>
    page.screenshot({
      path: path.join('e2e', 'shots', mode, `03-palette-${name}.png`),
      animations: 'disabled',
    });

  await page.goto('/register', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('header').first()).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);

  // WAIT FOR HYDRATION, not just for markup. The shell is server-rendered, so
  // the header is visible well before React has attached the window keydown
  // listener that Command-K depends on; pressing the key in that gap does
  // nothing and looks exactly like a broken shortcut. The theme control sets
  // aria-pressed only in an effect, which makes it an honest hydration signal.
  await expect(page.locator('button[aria-pressed="true"]').first()).toBeVisible({
    timeout: 30_000,
  });

  // Command-K from the page body, not from a focused field: the shortcut has to
  // work wherever the operator's hands happen to be.
  await page.keyboard.press('ControlOrMeta+k');

  const input = page.getByPlaceholder('Jump to a project, a screen, or a pipeline');
  await expect(input).toBeVisible({ timeout: 10_000 });

  // Empty state: screens and pipelines are listed before anything is typed, so
  // the palette is navigation from the first keystroke.
  await expect(page.getByText('Go to', { exact: true })).toBeVisible();
  await shot('open');

  // A real project, matched server-side.
  await input.fill(PROJECT);
  const hit = page.locator('[cmdk-item]').filter({ hasText: PROJECT }).first();
  await expect(hit, `palette found no project matching "${PROJECT}"`).toBeVisible({
    timeout: 20_000,
  });
  await shot('project-search');

  // Follow it through. Arrowing and pressing Enter, not clicking, because the
  // whole point of the palette is that it never needs the mouse.
  await page.keyboard.press('Enter');

  await expect
    .poll(() => new URL(page.url()).pathname + new URL(page.url()).search, {
      message: 'selecting a project did not navigate anywhere',
      timeout: 20_000,
    })
    .toMatch(/^\/projects\?open=/);

  // And the destination actually opened that project rather than just changing
  // the URL.
  await expect(page.getByText(PROJECT).first()).toBeVisible({ timeout: 30_000 });
  await shot('project-open');
});
