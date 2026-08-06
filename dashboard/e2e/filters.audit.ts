// THE FILTERING AUDIT.
//
// Every Register filter is applied through the real UI and the resulting total
// is read off the pager, which prints the server's count. A filter that changes
// nothing shows up here as an unchanged number, which is the entire point: a
// control that looks like it works and returns the same set is worse than no
// control, and that cannot be caught by reading code.
//
// Totals come from the pager line ("1-50 of 184"), which is populated from the
// PostgREST exact count, not from the rows on screen. So this measures the
// SERVER's answer, not a client-side slice of it.

import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

type Row = {
  filter: string;
  url: string;
  filtersOn: string;
  before: number | null;
  after: number | null;
  changed: string;
};

async function totalFor(page: import('@playwright/test').Page, url: string): Promise<number> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const pager = page.getByTestId('pager-total');
  await expect(pager).toBeVisible({ timeout: 120_000 });
  // data-total is ABSENT while the query is in flight and present once the
  // server has answered, so waiting for it to exist is waiting for a real
  // count. Reading it eagerly returned 0 for every filter, which would have
  // been reported as "every filter returns nothing" - a false alarm produced
  // entirely by the measuring instrument.
  await expect
    .poll(async () => await pager.getAttribute('data-total'), { timeout: 120_000 })
    .not.toBeNull();
  return Number(await pager.getAttribute('data-total'));
}

test('register filtering audit', async ({ page }) => {
  const results: Row[] = [];
  // THE BASELINE IS THE CLEARED REGISTER, not the default one. The Register now
  // opens on the United States, so '/register?view=all' is itself a filtered
  // view: measuring the country filter against it would compare United States
  // with United States and report the geography filter as doing nothing. Every
  // single-axis case below therefore carries country=any, so exactly one filter
  // is under test at a time.
  const BASE = '/register?view=all&country=any';

  const baseline = await totalFor(page, BASE);
  expect(baseline, 'baseline returned no count').toBeGreaterThan(0);

  // Real values pulled from the live facets, so the audit cannot test a value
  // that does not exist and call the resulting zero a pass.
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-row-id]').first()).toBeVisible({ timeout: 120_000 });

  // Read the stage chips by their data-stage attribute, NOT by scraping button
  // text. Scraping picked up "New" from the rail's view list on the first
  // attempt and reported the stage filter as returning zero, which looked like
  // a broken filter and was actually a broken test.
  const stages = (
    await page.locator('[data-stage]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-stage')).filter((v): v is string => !!v && v !== 'all')
    )
  ).slice(0, 3);
  expect(stages.length, 'no stage chips rendered').toBeGreaterThan(0);

  const cases: { filter: string; url: string; filtersOn: string }[] = [
    { filter: 'View: New', url: '/register?view=new&country=any', filtersOn: "projects.status = 'new'" },
    {
      filter: 'View: Watchlist',
      url: '/register?view=watchlist&country=any',
      filtersOn: "projects.watch = true AND status <> 'dismissed'",
    },
    {
      filter: 'View: Client ready',
      url: '/register?view=client_ready&country=any',
      filtersOn: "projects.status = 'client_ready'",
    },
    { filter: 'View: Trash', url: '/register?view=trash&country=any', filtersOn: "projects.status = 'dismissed'" },
    ...stages.map((st) => ({
      filter: `Stage chip: ${st}`,
      url: `/register?view=all&country=any&stage=${encodeURIComponent(st)}`,
      filtersOn: 'projects.stage =',
    })),
    {
      // THE DEFAULT ITSELF, measured. No country parameter at all, which is how
      // the Register opens: it must return fewer than the cleared baseline, or
      // the default is not being applied.
      filter: 'Geography default (no parameter)',
      url: '/register?view=all',
      filtersOn: "projects.country = 'United States' by default",
    },
    {
      filter: 'Geography L1: United States',
      url: '/register?view=all&country=United+States',
      filtersOn: 'projects.country =',
    },
    {
      filter: 'Geography L2: California',
      url: '/register?view=all&country=United+States&region=California',
      filtersOn: 'projects.country = AND projects.region_state =',
    },
    {
      filter: 'Geography L3: Anaheim',
      url: '/register?view=all&country=United+States&region=California&market=Anaheim',
      filtersOn: 'country = AND region_state = AND market =',
    },
    {
      filter: 'Search: "resort"',
      url: '/register?view=all&country=any&q=resort',
      filtersOn: 'ilike over name, primary_applicant, primary_representative',
    },
    // Saved views: each must move the number, or it is a control that lies.
    {
      filter: 'Saved view: Anaheim',
      url: '/register?view=all&saved=anaheim&country=United+States&region=California&market=Anaheim',
      filtersOn: 'country + region_state + market',
    },
    {
      filter: 'Saved view: Approved, anywhere',
      url: '/register?view=all&saved=approved&country=any&stage=approved',
      filtersOn: "projects.stage = 'approved'",
    },
    {
      filter: 'Saved view: Hearing scheduled',
      url: '/register?view=all&saved=hearing&country=any&stage=hearing+scheduled',
      filtersOn: "projects.stage = 'hearing scheduled'",
    },
    {
      filter: 'Search: "zzzznomatch"',
      url: '/register?view=all&country=any&q=zzzznomatch',
      filtersOn: 'same three columns; proves the search is not ignored',
    },
  ];

  for (const c of cases) {
    const after = await totalFor(page, c.url);
    results.push({
      ...c,
      before: baseline,
      after,
      changed: after === baseline ? 'NO CHANGE' : 'changed',
    });
    console.log(
      `${c.filter.padEnd(34)} ${String(baseline).padStart(5)} -> ${String(after).padStart(5)}  ${
        after === baseline ? '*** UNCHANGED ***' : ''
      }`
    );
  }

  // THE DEFAULT MUST BE CLEARABLE. Opening on the United States is only
  // acceptable if All countries genuinely removes it, so both numbers are read
  // through the real UI and compared.
  const defaulted = await totalFor(page, '/register?view=all');
  const cleared = await totalFor(page, '/register?view=all&country=any');
  console.log(
    `${'Default US vs cleared'.padEnd(34)} ${String(defaulted).padStart(5)} -> ${String(cleared).padStart(5)}`
  );
  expect(defaulted, 'the United States default is not being applied').toBeLessThan(cleared);
  expect(cleared, 'clearing the country filter did not restore the global set').toBe(baseline);

  // Sorting must NOT change the count: it reorders the same set. A sort that
  // changes the total is a filter pretending to be a sort.
  const sorted = await totalFor(page, '/register?view=all&country=any&sort=name&dir=asc');
  console.log(`${'Sort by name (control)'.padEnd(34)} ${String(baseline).padStart(5)} -> ${String(sorted).padStart(5)}`);
  expect(sorted, 'sorting changed the result count, so it is filtering').toBe(baseline);

  mkdirSync('e2e/shots/walkthrough', { recursive: true });
  writeFileSync(
    'e2e/shots/walkthrough/filter-audit.json',
    JSON.stringify(
      { baseline, defaultGeography: defaulted, clearedGeography: cleared, results, sortControl: sorted },
      null,
      2
    )
  );
});
