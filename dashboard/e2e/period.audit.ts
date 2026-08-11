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

    // NEITHER AXIS IS A PARTITION ANY MORE, AND THAT IS THE POINT.
    //
    // Arrived used to be one: it read projects.first_seen, every project has
    // exactly one, so the weeks summed to the month exactly and this asserted
    // equality. That equality was the arithmetic signature of the bug. Reading a
    // single date per project is what made "arrived in August" mean "this
    // project's OLDEST record was captured in August", so a project first seen
    // in July that gained eleven August filings did not arrive in August and
    // vanished from the month.
    //
    // Arrived now means "gained a record captured in this period", resolved
    // through the records the way Moved resolves through events. A project that
    // gained records in two different weeks belongs to both, so the sum is
    // greater than or equal to the month for both axes now.
    //
    // WHAT THE ASSERTION STILL CATCHES IS THE THING IT WAS WRITTEN FOR. A sum
    // BELOW the month means a project fell inside July and inside none of
    // July's weeks, which is exactly the inclusive-bound and timezone class of
    // bug this audit exists for. That check is unchanged; only the claim that
    // the axis partitions is gone, because it is no longer true and asserting it
    // would pin the defect in place.
    expect(
      summed,
      `a project fell in July but in none of July's weeks on the ${axis} axis`
    ).toBeGreaterThanOrEqual(month);
    // And no single week may exceed the month it is inside.
    for (const w of weeks) {
      expect(w.count, `${w.token} holds more projects than the whole of July`).toBeLessThanOrEqual(month);
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

// HALF A RANGE MUST NOT BECOME A ONE-DAY RANGE.
//
// The custom-range inputs used to fall back to the value just typed for the
// other end, so picking a start date while the end was empty produced a period
// exactly one day long. That is how a generated report came to cover a single
// day, with every section reading "no filing in this period" and a basis line
// of 0 records. The operator picked a start date and got a document about one
// Tuesday, and nothing on the screen said so.
//
// Driven through the composer because that is the screen where the damage was
// done, and asserted on the bounds the control prints rather than on the token,
// so the test fails if the display and the resolution ever disagree.
test('picking one end of a custom range does not collapse it to a day', async ({ page }) => {
  await page.goto('/reports', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('report-client')).toBeVisible({ timeout: 120_000 });

  // A start with no end. The end must become a real later date, not the start.
  await page.getByTestId('period-from').fill('2026-07-01');
  await expect
    .poll(async () => await page.getByTestId('period-bounds').textContent(), { timeout: 30_000 })
    .toContain('2026-07-01');
  const startOnly = (await page.getByTestId('period-bounds').textContent()) ?? '';
  console.log(`start only  -> ${startOnly.trim()}`);
  expect(startOnly, 'a start date with no end collapsed the period to one day').toContain(' to ');
  const [, endDay] = startOnly.split(' to ');
  expect(
    (endDay ?? '').trim(),
    'a start date with no end produced a period ending on the start date'
  ).not.toBe('2026-07-01');

  // An end with no start. Reload so the range is empty again.
  await page.goto('/reports', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('report-client')).toBeVisible({ timeout: 120_000 });
  await page.getByTestId('period-to').fill('2026-07-31');
  await expect
    .poll(async () => await page.getByTestId('period-bounds').textContent(), { timeout: 30_000 })
    .toContain('2026-07-31');
  const endOnly = (await page.getByTestId('period-bounds').textContent()) ?? '';
  console.log(`end only    -> ${endOnly.trim()}`);
  const [startDay] = endOnly.split(' to ');
  expect(
    (startDay ?? '').trim(),
    'an end date with no start produced a period beginning on the end date'
  ).not.toBe('2026-07-31');
});
