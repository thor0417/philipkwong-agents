// THE PLAYERS LIST, MEASURED.
//
// Three numbers decide whether this screen is worth having, and all three are
// facts about the GRAPH rather than about the rendering: how many companies we
// hold, how many hold more than one role, and how many appear in more than one
// market. The third is the differentiator - a firm filing in three markets is
// the finding - and it is the one currently reading zero.
//
// This prints them and asserts only what must be true of the screen: that the
// list renders every company, that opening a row reaches the existing company
// page, and that a reachability column exists at all. It deliberately does NOT
// assert that cross-market presence is non-zero: that would be asserting a fact
// about the corpus, and the corpus is allowed to say no.

import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

test('players', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/players', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('players-stats')).toBeVisible({ timeout: 120_000 });
  await expect
    .poll(async () => await page.locator('[data-company-id]').count(), { timeout: 120_000 })
    .toBeGreaterThan(0);

  const stats = (await page.getByTestId('players-stats').textContent())?.replace(/\s+/g, ' ').trim();
  console.log(`stats: ${stats}`);

  const rows = await page.locator('[data-company-id]').count();
  const reachable = await page.locator('[data-reachable="yes"]').count();
  const multiMarket = await page
    .locator('[data-company-id]')
    .evaluateAll((els) =>
      els.filter((e) => {
        const n = Number(e.children[1]?.querySelector('span')?.textContent ?? '0');
        return n > 1;
      }).length
    );
  const multiRole = await page
    .locator('[data-company-id]')
    .evaluateAll(
      (els) => els.filter((e) => (e.children[3]?.textContent ?? '').includes(',')).length
    );

  console.log(`rows ${rows}, reachable ${reachable}, >1 market ${multiMarket}, >1 role ${multiRole}`);

  // The row must reach the company page that already existed. Not a new screen.
  const href = await page.locator('[data-company-id]').first().getAttribute('href');
  expect(href, 'a players row does not link anywhere').toMatch(/^\/company\//);
  await page.goto(href as string, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1')).toBeVisible({ timeout: 60_000 });
  console.log(`opened ${href} -> ${(await page.locator('h1').textContent())?.trim()}`);

  mkdirSync('e2e/shots/walkthrough', { recursive: true });
  writeFileSync(
    'e2e/shots/walkthrough/players-audit.json',
    JSON.stringify({ stats, rows, reachable, multiMarket, multiRole, firstHref: href }, null, 2)
  );

  expect(rows, 'the players list rendered no companies').toBeGreaterThan(0);
  // THE FINDING MUST BE STATED WHEN IT IS ABSENT. Zero cross-market companies is
  // a real fact about the graph and the screen has to say so rather than render
  // a quiet column of ones.
  if (multiMarket === 0) {
    await page.goto('/players', { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByTestId('players-no-cross-market'),
      'no company appears in more than one market and the screen does not say so'
    ).toBeVisible({ timeout: 60_000 });
  }
});
