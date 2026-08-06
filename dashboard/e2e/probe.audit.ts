// What do the routes that failed the selector check actually put on screen?
//
// A missing h1 is a broken TEST until proven otherwise. This prints the heading
// elements, the visible text, and any error banner for each, so "screen broken"
// and "selector wrong" can be told apart.

import { test } from '@playwright/test';

const ROUTES = ['/records', '/pipeline', '/gli', '/today', '/projects'];

test('what the routes actually render', async ({ page }) => {
  test.setTimeout(600_000);

  for (const url of ROUTES) {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 300)));
    page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text().slice(0, 300)}`));

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForTimeout(6000);

    const headings = await page
      .locator('h1, h2, [class*="title"]')
      .evaluateAll((els) => els.slice(0, 6).map((e) => `${e.tagName}: ${(e.textContent ?? '').trim().slice(0, 70)}`));
    const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const tables = await page.locator('table').count();
    const rows = await page.locator('tbody tr, [data-row-id], [data-lead-id]').count();

    console.log(`\n===== ${url} =====`);
    console.log(`  headings: ${headings.join(' | ') || '(none)'}`);
    console.log(`  tables=${tables} rows=${rows}`);
    console.log(`  text: ${text.slice(0, 420)}`);
    if (errors.length) console.log(`  ERRORS: ${errors.slice(0, 4).join(' || ')}`);
    page.removeAllListeners('pageerror');
    page.removeAllListeners('console');
  }
});
