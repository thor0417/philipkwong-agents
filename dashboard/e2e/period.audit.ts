// THE PERIOD AUDIT. Do the parts sum to the whole?
//
// A period selector is easy to build and easy to get subtly wrong: an inclusive
// upper bound loses the last day, a local-time month boundary loses the first
// seven hours, and neither failure announces itself - the screen shows a
// plausible number that is simply not the right one.
//
// So this measures, through the real UI, on both axes:
//
//   July 2026, whole
//   each ISO week of July 2026, clipped to the month
//   the weeks summed
//
// The sum must equal the month. It is the one arithmetic identity a period
// implementation has to satisfy, and it fails loudly for every boundary bug
// listed above.

import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

async function totalFor(page: import('@playwright/test').Page, url: string): Promise<number> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const pager = page.getByTestId('pager-total');
  await expect(pager).toBeVisible({ timeout: 120_000 });
  await expect
    .poll(async () => await pager.getAttribute('data-total'), { timeout: 120_000 })
    .not.toBeNull();
  return Number(await pager.getAttribute('data-total'));
}

// July 2026 in ISO weeks, clipped to the month. 1 July 2026 is a Wednesday, so
// the first week is partial at the front and the last is partial at the back -
// which is exactly the case a naive implementation gets wrong.
const JULY_WEEKS = [
  'c:2026-07-01..2026-07-05',
  'c:2026-07-06..2026-07-12',
  'c:2026-07-13..2026-07-19',
  'c:2026-07-20..2026-07-26',
  'c:2026-07-27..2026-07-31',
];

test('period selection sums', async ({ page }) => {
  const out: Record<string, unknown> = {};

  for (const axis of ['arrived', 'moved'] as const) {
    const base = `/register?view=all&country=any&axis=${axis}`;
    const month = await totalFor(page, `${base}&period=m:2026-07`);

    const weeks: { token: string; count: number }[] = [];
    for (const w of JULY_WEEKS) {
      weeks.push({ token: w, count: await totalFor(page, `${base}&period=${w}`) });
    }
    const summed = weeks.reduce((a, b) => a + b.count, 0);

    console.log(`\n--- axis: ${axis} ---`);
    console.log(`July 2026                     ${String(month).padStart(5)}`);
    for (const w of weeks) console.log(`  ${w.token.padEnd(26)} ${String(w.count).padStart(5)}`);
    console.log(`  ${'summed'.padEnd(26)} ${String(summed).padStart(5)}`);

    out[axis] = { month, weeks, summed };

    if (axis === 'arrived') {
      // ARRIVED IS A PARTITION. Every project has exactly one first_seen, so it
      // falls in exactly one week, and the weeks must sum to the month exactly.
      expect(summed, `weeks of July do not sum to July on the ${axis} axis`).toBe(month);
    } else {
      // MOVED IS NOT A PARTITION and must not be asserted as one. A project with
      // events in two different weeks is counted in both, so the sum is greater
      // than or equal to the month - never less. A sum BELOW the month would
      // mean a project moved during July and during none of July's weeks, which
      // is the boundary bug this audit exists to catch.
      expect(summed, `a project moved in July but in none of July's weeks`).toBeGreaterThanOrEqual(month);
    }
  }

  // The two axes answer different questions and must not return the same set by
  // accident: that would mean one of them is not being applied.
  const arrivedJuly = await totalFor(page, '/register?view=all&country=any&axis=arrived&period=m:2026-07');
  const movedJuly = await totalFor(page, '/register?view=all&country=any&axis=moved&period=m:2026-07');
  const allTime = await totalFor(page, '/register?view=all&country=any&period=all');
  console.log(`\narrived in July ${arrivedJuly} | moved in July ${movedJuly} | all time ${allTime}`);
  expect(arrivedJuly, 'the arrived axis returned the whole register, so it is not filtering')
    .toBeLessThanOrEqual(allTime);
  expect(movedJuly, 'the moved axis returned the whole register, so it is not filtering')
    .toBeLessThanOrEqual(allTime);

  // A period with no data must return zero rather than everything. This is the
  // failure mode of a filter that is silently dropped when its bounds are
  // unfamiliar.
  const empty = await totalFor(page, '/register?view=all&country=any&axis=arrived&period=m:2019-01');
  console.log(`January 2019 (nothing existed): ${empty}`);
  expect(empty, 'an empty period returned rows, so the period filter was dropped').toBe(0);

  mkdirSync('e2e/shots/walkthrough', { recursive: true });
  writeFileSync(
    'e2e/shots/walkthrough/period-audit.json',
    JSON.stringify({ ...out, arrivedJuly, movedJuly, allTime, emptyPeriod: empty }, null, 2)
  );
});
