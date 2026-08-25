// EVERY EMPTY STATE THE REGISTER CAN REACH, PHOTOGRAPHED AND READ.
//
// An empty screen is often the correct and important answer on this product -
// a client view that returns nothing, a watchlist nobody has filled, a market
// whose source died in 2018 - and it is the state nobody designs. So each one
// is visited, its text is printed into the run log for a person to read, and
// the two properties that make an empty state useful rather than apologetic are
// asserted:
//
//   1. IT SAYS WHAT IS TRUE. When constraints are applied it lists them, one
//      per line, and every line is the control that removes it. The sentence it
//      replaced - "No projects match this view. Try All, or clear the geography
//      filter" - offered to clear a geography filter whether or not one was
//      applied, which is advice that is wrong more often than it is right.
//   2. IT IS NOT AN APOLOGY. No "sorry", no "oops", and no naming of a control
//      the screen does not have.
//
// The loading half of the same idea is here too: a query in flight must never
// leave a result on screen that reads as an answer.

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { walkthroughDir, walkthroughOut } from './artefacts';

const VIEWPORT = { width: 1920, height: 1080 };

interface Seen {
  name: string;
  url: string;
  text: string;
  constraints: string[];
}

// Words that turn a statement into an apology, and words that name a control
// that is not on the screen. Both were in the sentence this replaced.
const APOLOGIES = ['sorry', 'oops', 'unfortunately', 'whoops', 'failed to find'];

test('the register says what is true when it is empty', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const mode = testInfo.project.name;
  await page.setViewportSize(VIEWPORT);
  const seen: Seen[] = [];

  const cases: { name: string; url: string; expectConstraints: number; expectText?: RegExp }[] = [
    // A search nothing matches: one constraint, and the way out is to clear it.
    {
      name: 'search matches nothing',
      url: '/projects?view=all&country=any&q=zzzznomatch',
      expectConstraints: 1,
    },
    // A market that does not exist, under a country and a stage. The register
    // fails these closed on purpose - an unresolvable facet returns the empty
    // set rather than the parent's rows - so this is the empty state that
    // proves the failing-closed is visible rather than silent.
    {
      name: 'a market nothing matches, inside a country and a stage',
      url: '/projects?view=all&country=United+States&region=California&market=Atlantis&stage=approved',
      expectConstraints: 4,
    },
    // A view with nothing in it. The view is the only constraint, so the lead
    // sentence has to say what the view MEANS and how a project gets into it -
    // "no project satisfies this" over a line reading "view / Client ready" is
    // true and useless.
    {
      name: 'a view nobody has filled',
      url: '/projects?view=client_ready&country=any',
      expectConstraints: 1,
      expectText: /marked client ready/i,
    },
    // A period nothing arrived in.
    {
      name: 'a period nothing arrived in',
      url: '/projects?view=all&country=any&period=m:2019-01&axis=arrived',
      expectConstraints: 1,
    },
  ];

  for (const c of cases) {
    await page.goto(c.url, { waitUntil: 'domcontentloaded' });
    const empty = page.getByTestId('register-empty');
    await expect(empty, `${c.name}: the register was not empty`).toBeVisible({ timeout: 120_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200);

    const text = ((await empty.textContent()) ?? '').replace(/\s+/g, ' ').trim();
    const constraints = await empty
      .locator('[data-empty-constraint]')
      .evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()));
    seen.push({ name: c.name, url: c.url, text, constraints });
    console.log(`[${mode}] ${c.name}\n    ${text}`);

    expect(
      constraints.length,
      `${c.name}: the empty state lists ${constraints.length} constraints, expected ${c.expectConstraints}`
    ).toBe(c.expectConstraints);
    if (c.expectText) {
      expect(text, `${c.name}: the empty state does not say what the state means`).toMatch(
        c.expectText
      );
    }
    for (const word of APOLOGIES) {
      expect(text.toLowerCase(), `${c.name}: the empty state apologises ("${word}")`).not.toContain(
        word
      );
    }
    // Every listed constraint carries the control that removes it.
    if (constraints.length > 0) {
      const buttons = await empty.locator('[data-empty-constraint] button').count();
      expect(
        buttons,
        `${c.name}: ${constraints.length} constraints listed, ${buttons} of them removable`
      ).toBe(constraints.length);
    }
  }

  if (mode === 'light') {
    await page.goto(cases[1].url, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('register-empty')).toBeVisible({ timeout: 120_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200);
    mkdirSync(path.join('e2e', 'shots', mode), { recursive: true });
    await page.screenshot({
      path: path.join('e2e', 'shots', mode, '09-register-empty.png'),
      animations: 'disabled',
    });
    mkdirSync(walkthroughDir(), { recursive: true });
    writeFileSync(walkthroughOut('empty-states.json'), JSON.stringify(seen, null, 2));
  }

  // ---- AND THE WAY OUT WORKS. -------------------------------------------
  //
  // A listed constraint whose control does not remove it is worse than no
  // control, and this screen has shipped that shape before: a filter that
  // reached the URL and stopped one line short of the query.
  await page.goto('/projects?view=all&country=any&q=zzzznomatch', {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByTestId('register-empty')).toBeVisible({ timeout: 120_000 });
  await page.locator('[data-empty-constraint="search"] button').click();
  await expect(page.locator('[data-row-id]').first()).toBeVisible({ timeout: 60_000 });
  console.log(`[${mode}] clearing the search from the empty state brought the register back`);
});

// A LOADING STATE THAT COULD BE MISTAKEN FOR AN ANSWER IS A DEFECT.
//
// Every query on the register carries `placeholderData: (prev) => prev`, so the
// list never blinks empty while a filter resolves. That is right, and it means
// the rows on screen during a filter change are the PREVIOUS filter's answer.
// Shown at full fidelity under a chip that has already changed, they read as
// the answer - which is indistinguishable from a control that did nothing.
//
// This asserts the register says so: the rows dim and the count stops printing
// a number while the query is in flight.
test('a query in flight never leaves an answer on screen', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize(VIEWPORT);
  await page.goto('/projects?view=all&country=any', { waitUntil: 'domcontentloaded' });
  const pager = page.getByTestId('pager-total');
  await expect(pager).toBeVisible({ timeout: 120_000 });
  await expect.poll(async () => await pager.getAttribute('data-total'), { timeout: 120_000 }).not.toBeNull();

  const scroller = page.getByTestId('register-scroll');
  await expect(scroller).not.toHaveAttribute('data-settling', 'true');

  // Open the filter panel and press a venue. The chip changes instantly; the
  // rows cannot.
  const toggle = page.getByTestId('filter-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(page.getByTestId('filter-panel')).toBeVisible({ timeout: 30_000 });
  const value = await page.locator('[data-venue]').nth(1).getAttribute('data-venue');
  expect(value, 'no venue value to press').toBeTruthy();

  // Catch the in-flight state. Polling for it rather than sleeping, because how
  // long the query takes is not this test's business - only that the screen
  // says so while it does.
  let sawSettling = false;
  let sawNoNumber = false;
  const watch = (async () => {
    for (let i = 0; i < 200 && !(sawSettling && sawNoNumber); i++) {
      if ((await scroller.getAttribute('data-settling')) === 'true') sawSettling = true;
      if ((await pager.getAttribute('data-total')) === null) sawNoNumber = true;
      await page.waitForTimeout(10);
    }
  })();
  await page.locator(`[data-venue="${value}"]`).first().click();
  await watch;

  console.log(
    `while the venue filter resolved: rows marked stale = ${sawSettling}, count withheld = ${sawNoNumber}`
  );
  expect(
    sawSettling,
    'the previous filter\'s rows were shown at full fidelity while the new query was in flight'
  ).toBe(true);
  expect(sawNoNumber, 'the pager printed a count for a query that had not answered').toBe(true);

  // And it settles: the mark comes off, and the number comes back.
  await expect.poll(async () => await pager.getAttribute('data-total'), { timeout: 60_000 }).not.toBeNull();
  await expect(scroller).not.toHaveAttribute('data-settling', 'true');
});
