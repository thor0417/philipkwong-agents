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
  await page.goto('/projects', { waitUntil: 'domcontentloaded' });
  // The filter axes are behind a disclosure now, so the thing to wait for is
  // the list itself rather than a chip row that is no longer on the screen.
  await expect(page.locator('[data-testid="register-row"]').first()).toBeVisible({
    timeout: 120_000,
  });
  await page.evaluate(() => document.fonts.ready);
  // Let the facet counts settle so the toolbar is at its real width.
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

// PROJECTS OPENS RANKED, AND SAYS WHICH NAMES IT DID NOT READ.
//
// Nine weighted signals are computed and stored with their breakdown, and for a
// while none of it reached the view Philip lives in: the list opened on last
// activity, so a dormant street-address filing outranked a multi-billion casino
// bid. And 39 of 267 projects are excluded from every client document because
// their name is a cleaned agenda line rather than a name anything published -
// an exclusion that was stated in the detail pane, which is opened one project
// at a time, and nowhere a person scanning the list could see it.
test('projects opens ranked, with unread names marked', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.goto('/projects', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="register-row"]').first()).toBeVisible({
    timeout: 120_000,
  });
  await page.waitForTimeout(2000);

  // The Sig cell is the third child of the row: checkbox, name, significance.
  const scores = await page
    .locator('[data-testid="register-row"]')
    .evaluateAll((rows) =>
      rows.map((r) => {
        const cell = r.children[2];
        const t = (cell?.textContent ?? '').trim();
        return t === '--' ? null : Number(t);
      })
    );
  console.log(`page 1 significance: ${scores.slice(0, 12).join(', ')}`);
  expect(scores.length, 'no rows to judge the ordering on').toBeGreaterThan(1);
  expect(scores.filter((s) => s === null).length, 'a row rendered no significance at all').toBe(0);
  for (let i = 1; i < scores.length; i++) {
    expect(
      scores[i]!,
      `row ${i} scores ${scores[i]} under row ${i - 1}'s ${scores[i - 1]}: the default order is not significance`
    ).toBeLessThanOrEqual(scores[i - 1]!);
  }

  // THE RANK MUST BE READABLE AS WELL AS ORDERED. The score is set on the ink
  // ladder in four bands cut where the corpus divides, because 91/88/80 on their
  // own are a number nobody knows the scale of - measured, four fifths of the
  // register sits between 10 and 50. Page one is the top of a
  // significance-sorted list, so the bands here must run downwards and must not
  // all be the same.
  const bands = await page
    .locator('[data-testid="register-row"] [data-band]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-band') ?? ''));
  const order = ['top', 'high', 'mid', 'low', 'none'];
  console.log(`page 1 bands: ${bands.slice(0, 12).join(', ')}`);
  expect(new Set(bands).size, 'every score on page one is in the same band').toBeGreaterThan(1);
  for (let i = 1; i < bands.length; i++) {
    expect(
      order.indexOf(bands[i]),
      `row ${i} is banded "${bands[i]}" under row ${i - 1}'s "${bands[i - 1]}", so the banding does not follow the score`
    ).toBeGreaterThanOrEqual(order.indexOf(bands[i - 1]));
  }

  const marked = await page.locator('[data-held-unnamed]').count();
  const rows = scores.length;
  console.log(`page 1: ${rows} rows, ${marked} with a name we did not read`);
  // The mark must exist SOMEWHERE - a predicate that excludes 39 projects from
  // every client document and marks none of them is the invisible exclusion this
  // was added to end. It is asserted over the whole register rather than page one,
  // because a page-one assertion would depend on where the provisional ones rank.
  const anywhere = await page.goto('/projects?country=any&sort=name&dir=asc');
  expect(anywhere?.ok() ?? true).toBeTruthy();
  await expect(page.locator('[data-testid="register-row"]').first()).toBeVisible({
    timeout: 60_000,
  });
  await page.waitForTimeout(2000);
  let seen = 0;
  for (let p = 1; p <= 6 && seen === 0; p++) {
    if (p > 1) {
      await page.goto(`/projects?country=any&sort=name&dir=asc&page=${p}`, {
        waitUntil: 'domcontentloaded',
      });
      await expect(page.locator('[data-testid="register-row"]').first()).toBeVisible({
        timeout: 60_000,
      });
      await page.waitForTimeout(1500);
    }
    seen = await page.locator('[data-held-unnamed]').count();
  }
  expect(seen, 'no row anywhere is marked as carrying a name we did not read').toBeGreaterThan(0);

  // AND THE TWO REASONS ARE ONE MARK. A row held out for both its market and
  // its name must show one tag carrying both, not two boxes in two columns.
  // Measured 2026-08-16: 39 unnamed, 6 frozen, exactly 1 both.
  const doubled = await page
    .locator('[data-testid="register-row"]')
    .evaluateAll((rows) =>
      rows.filter((r) => r.querySelectorAll('[data-testid="row-held"]').length > 1).length
    );
  expect(doubled, 'a row is carrying more than one held-out mark').toBe(0);
});

// THE FILTER IS ONE CONTROL, AND WHAT IS APPLIED IS NEVER BEHIND IT.
//
// Three labelled chip rows became one disclosure. That trade is only acceptable
// under two conditions, and this asserts both, because a screenshot can show
// neither:
//
//   1. NOTHING IS CLIPPED INSIDE THE PANEL. The rows this replaced were
//      `nowrap; overflow: hidden` and capped at five values, so venue offered
//      five of its twenty and "+16 more" laid the rest out on one unbroken line
//      that ran off the container's right edge - the control that promised the
//      other fifteen was the control that hid them. The panel wraps, and every
//      chip has to sit inside it.
//   2. THE ACTIVE SELECTION SURVIVES THE COLLAPSE. A filter that is applied and
//      invisible is strictly worse than five rows of chips, because the
//      operator is then reading a narrowed list with nothing on screen saying
//      it is narrowed. So a filter is chosen inside the panel, the panel is
//      closed, and the selection must still be readable on the row.
test('the filter panel holds every value, and the selection outlives it', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.goto('/projects', { waitUntil: 'domcontentloaded' });
  const toggle = page.getByTestId('filter-toggle');
  await expect(toggle).toBeVisible({ timeout: 120_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(2500);

  // Closed, the three axes are not on the screen at all.
  expect(
    await page.locator('[data-venue]').count(),
    'venue chips are on screen while the filter is collapsed'
  ).toBe(0);

  await toggle.click();
  const panel = page.getByTestId('filter-panel');
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-venue]').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);

  const counts: Record<string, number> = {};
  for (const attr of ['stage', 'venue', 'category'] as const) {
    counts[attr] = await panel.locator(`[data-${attr}]`).count();
  }
  console.log(
    `filter panel: ${counts.stage} stage, ${counts.venue} venue, ${counts.category} category chips`
  );
  // Venue is the axis the cap was hurting: twenty values, five reachable.
  expect(counts.venue, 'the panel is still capping the venue axis').toBeGreaterThan(6);

  const clipped = await panel.evaluate((el) => {
    const bounds = el.getBoundingClientRect();
    return [...el.querySelectorAll('button')]
      .map((b) => ({ text: (b.textContent ?? '').trim().slice(0, 24), r: b.getBoundingClientRect() }))
      .filter((c) => c.r.right > bounds.right + 1 || c.r.left < bounds.left - 1)
      .map((c) => c.text);
  });
  expect(clipped, `chips laid out beyond the panel holding them: ${clipped.join(', ')}`).toEqual([]);

  // ---- 2. Pick one, close the panel, and look for it on the row. -----------
  const chosen = await panel
    .locator('[data-venue]')
    .nth(1)
    .getAttribute('data-venue');
  expect(chosen, 'the venue axis rendered no real value to choose').toBeTruthy();
  await panel.locator(`[data-venue="${chosen}"]`).first().click();
  await expect
    .poll(async () => new URL(page.url()).searchParams.get('venue'), { timeout: 30_000 })
    .toBe(chosen);

  // Escape closes the panel without touching the selection.
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden({ timeout: 10_000 });

  const active = page.locator('[data-active-filter="venue"]');
  await expect(active, 'the applied venue filter is not stated anywhere once the panel closes').toBeVisible({
    timeout: 10_000,
  });
  const shown = ((await active.textContent()) ?? '').replace(/\s+/g, ' ').trim();
  console.log(`collapsed, the row still states: "${shown}"`);
  expect(shown, `the active chip reads "${shown}" and does not name ${chosen}`).toContain(chosen!);

  // And pressing it removes the filter, which is the only way back out now that
  // the row has no "All venues" chip on it.
  await active.click();
  await expect
    .poll(async () => new URL(page.url()).searchParams.get('venue'), { timeout: 30_000 })
    .toBeNull();
});
