// THE REGISTER AT 1920x1080, WHICH IS THE SIZE IT IS ACTUALLY USED AT.
//
//   npx playwright test e2e/register-layout.shots.ts --project=light
//
// The existing shot suite screenshots at the Playwright default viewport, which
// is why a layout that consumes half a 1080p screen in filter chips passed
// every check while being unusable. A screenshot at the wrong size is not
// evidence about the right one.
//
// IT MEASURES RATHER THAN ONLY CAPTURING. A picture proves nothing on its own -
// somebody has to look at it, and nobody looks at a passing test. So this also
// asserts the two things that were actually wrong:
//
//   1. THE TABLE STARTS IN THE TOP THIRD. The chip block had grown to five
//      wrapped rows and pushed the first project below the fold.
//   2. EVERY HEADER SITS OVER ITS OWN COLUMN. The row grid declared six tracks
//      while rendering seven cells, so the last column fell into an implicit
//      track: LAST ACTIVITY rendered rotated at the far left and its values
//      wrapped under the checkbox.
//
// The row is deliberately TWO LINES - the project name and, under it, the one
// line saying what the project is. That is what set the row height, it is
// wanted, and the assertions below are written to keep it: the check is that
// the header aligns and the table starts high, not that the row is short.

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const OUT = path.join('e2e', 'shots', 'layout');
const VIEWPORT = { width: 1920, height: 1080 };

test('register layout at 1920x1080', async ({ page }, testInfo) => {
  const tag = process.env.SHOT_TAG ?? 'after';
  await page.setViewportSize(VIEWPORT);
  await page.goto('/register', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('register-venue-chips')).toBeVisible({ timeout: 120_000 });
  await page.evaluate(() => document.fonts.ready);
  // Let the facet counts settle so the chips are at their real width.
  await page.waitForTimeout(2500);

  mkdirSync(OUT, { recursive: true });
  await page.screenshot({
    path: path.join(OUT, `register-1920x1080-${tag}.png`),
    animations: 'disabled',
  });

  // ---- 1. The table must start in the top third. --------------------------
  const head = page.locator('[data-testid="register-head-row"]').first();
  const box = await head.boundingBox();
  const headTop = box?.y ?? Number.POSITIVE_INFINITY;
  console.log(`[${tag}] header row top: ${Math.round(headTop)}px of ${VIEWPORT.height}`);

  // ---- 2. Every header sits over its own column. --------------------------
  const cols = await page.locator('[data-testid="register-head-row"] > *').evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { text: (e.textContent ?? '').trim().slice(0, 14), x: Math.round(r.x), w: Math.round(r.width) };
    })
  );
  console.log(`[${tag}] header cells: ${JSON.stringify(cols)}`);

  const firstRow = await page.locator('[data-testid="register-row"]').first().evaluateAll((els) =>
    els.flatMap((e) =>
      [...e.children].map((c) => {
        const r = c.getBoundingClientRect();
        return { x: Math.round(r.x), w: Math.round(r.width) };
      })
    )
  );
  console.log(`[${tag}] first row cells: ${JSON.stringify(firstRow)}`);

  if (tag === 'after') {
    expect(headTop, 'the table must start in the top third of the screen').toBeLessThan(
      VIEWPORT.height / 3
    );
    // A collapsed column is a zero-or-near-zero width one.
    for (const c of cols) {
      expect(c.w, `header "${c.text}" has collapsed`).toBeGreaterThan(20);
    }
    // Header and row must agree column for column.
    expect(firstRow.length, 'row renders a different number of cells than the header').toBe(
      cols.length
    );
    for (let i = 0; i < cols.length; i++) {
      expect(Math.abs(cols[i].x - firstRow[i].x), `column ${i} ("${cols[i].text}") is misaligned`).toBeLessThan(3);
    }
    // The two-line row is the point, not a regression: assert both lines render.
    const nameLines = page.locator('[data-testid="register-row"]').first().locator('[data-row-name], [data-row-summary]');
    expect(await nameLines.count(), 'the project row must keep both its lines').toBeGreaterThanOrEqual(2);
  }
});

// EXPANDING THE OVERFLOW MUST REACH THE OVERFLOW.
//
// The collapsed chip row is `flex-wrap: nowrap; overflow: hidden`, which is what
// holds three filter groups to three lines. Those two properties stayed on when
// "+16 more" expanded the group, so the extra chips were laid out on one
// unbroken line and clipped at the container's edge: twenty venue values, five
// reachable, and the control that promised the other fifteen was the control
// that hid them. The "less" button went off the same edge, so the state could
// not be left either.
//
// A screenshot cannot catch this - the clipped chips simply are not in the
// picture, and the picture looks fine. This measures each chip against its
// container.
test('the venue chip overflow opens rather than clipping', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.goto('/register', { waitUntil: 'domcontentloaded' });
  const row = page.getByTestId('register-venue-chips');
  await expect(row).toBeVisible({ timeout: 120_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(2500);

  const collapsed = await row.locator('[data-venue]').count();
  const more = row.getByRole('button', { name: /^\+\d+ more$/ });
  await expect(more, 'the venue row did not overflow, so there is nothing to test').toBeVisible({
    timeout: 30_000,
  });
  const promised = Number(((await more.textContent()) ?? '').replace(/[^0-9]/g, ''));
  await more.click();

  await expect(row.getByRole('button', { name: 'less' })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(300);

  const expanded = await row.locator('[data-venue]').count();
  console.log(`venue chips: ${collapsed} collapsed, +${promised} promised, ${expanded} expanded`);
  expect(
    expanded,
    `"+${promised} more" expanded the row to ${expanded} chips, not the ${collapsed + promised} it promised`
  ).toBe(collapsed + promised);

  // EVERY chip inside the container it was expanded into, and the way back out
  // reachable too. Right edge, because that is the one the clip happened at.
  const clipped = await row.evaluate((el) => {
    const bounds = el.getBoundingClientRect();
    return [...el.querySelectorAll('button')]
      .map((b) => ({ text: (b.textContent ?? '').trim().slice(0, 24), r: b.getBoundingClientRect() }))
      .filter((c) => c.r.right > bounds.right + 1 || c.r.left < bounds.left - 1)
      .map((c) => c.text);
  });
  expect(clipped, `chips laid out beyond the row they were expanded into: ${clipped.join(', ')}`).toEqual([]);
});
