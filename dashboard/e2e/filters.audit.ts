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

type Page = import('@playwright/test').Page;

/**
 * EVERY PROJECT ID A FILTER RETURNS, walked across its pages.
 *
 * A COUNT IS NOT A SET, and comparing counts is what let the regression
 * through: L3 Anaheim returned 27 and L2 California returned 27, both "changed"
 * against a global baseline of 267, and the two numbers being the same number
 * meant nothing to an audit that only ever looked at one of them at a time.
 * Anaheim is inside California, so its rows must be a subset of California's
 * rows - and a subset is a statement about ids, not about totals.
 */
async function idsFor(page: Page, url: string): Promise<Set<string>> {
  const total = await totalFor(page, url);
  const pages = Math.max(1, Math.ceil(total / 50));
  const ids = new Set<string>();
  for (let p = 1; p <= pages; p++) {
    if (p > 1) await totalFor(page, `${url}&page=${p}`);
    const onPage = await page
      .locator('[data-row-id]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-row-id') ?? ''));
    for (const id of onPage) if (id) ids.add(id);
  }
  return ids;
}

/** Ids in the child that its parent does not hold. Empty means "is a subset". */
function escapees(child: Set<string>, parent: Set<string>): string[] {
  return [...child].filter((id) => !parent.has(id));
}

/**
 * The chips rendered for an axis, with the count each one prints.
 *
 * The count is read off the END OF THE BUTTON'S TEXT rather than out of a class
 * name. Selecting on `[class*="chipCount"]` matched nothing and every chip came
 * back as zero, which this audit would have reported as "no venue chip has any
 * projects" - a broken instrument describing itself as a finding, which is the
 * failure the stage chips already taught this file once. A chip renders its
 * label and then its number, so the number is the trailing digits.
 */
async function chipsOf(
  page: Page,
  attr: 'venue' | 'category'
): Promise<{ value: string; count: number; text: string }[]> {
  const raw = await page.locator(`[data-${attr}]`).evaluateAll((els, a: string) =>
    els.map((e) => {
      const text = (e.textContent ?? '').replace(/\s+/g, ' ').trim();
      const m = text.match(/(\d+)$/);
      return { value: e.getAttribute(`data-${a}`) ?? '', count: m ? Number(m[1]) : 0, text };
    }), attr);
  return raw.filter((c) => c.value && c.value !== 'all');
}

/**
 * Open the press-only geography tree.
 *
 * The country / region / market tree is now behind a collapsed node: covered
 * markets are their own section and everywhere else is press coverage, because
 * showing the two as one list is how a market name reaches a client's cover page
 * on the strength of one headline. The tree itself is unchanged and this audit
 * still tests it, so it opens it first.
 *
 * Idempotent: already-open is a no-op, so it can be called before every read.
 */
async function openGeographyTree(page: Page): Promise<void> {
  const toggle = page.getByTestId('press-coverage-toggle');
  await expect(toggle).toBeVisible({ timeout: 120_000 });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(page.locator('[data-country]').first()).toBeVisible({ timeout: 30_000 });
}

/**
 * Open the filter panel.
 *
 * Stage, venue and category were three rows of chips above the list and are now
 * one disclosure: thirty-four controls above the first ranked project is
 * thirty-four decisions handed to the operator before any work is visible, and
 * the honest consequence was that none of them got made. The chips themselves
 * are unchanged and this audit still tests them, so it opens them first.
 *
 * Idempotent, like openGeographyTree: already-open is a no-op.
 */
async function openFilters(page: Page): Promise<void> {
  const toggle = page.getByTestId('filter-toggle');
  await expect(toggle).toBeVisible({ timeout: 120_000 });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(page.getByTestId('filter-panel')).toBeVisible({ timeout: 30_000 });
}

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
  test.setTimeout(900_000);
  const results: Row[] = [];
  // THE BASELINE IS THE CLEARED REGISTER, not the default one. The Register now
  // opens on the United States, so '/projects?view=all' is itself a filtered
  // view: measuring the country filter against it would compare United States
  // with United States and report the geography filter as doing nothing. Every
  // single-axis case below therefore carries country=any, so exactly one filter
  // is under test at a time.
  const BASE = '/projects?view=all&country=any';

  const baseline = await totalFor(page, BASE);
  expect(baseline, 'baseline returned no count').toBeGreaterThan(0);

  // Real values pulled from the live facets, so the audit cannot test a value
  // that does not exist and call the resulting zero a pass.
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-row-id]').first()).toBeVisible({ timeout: 120_000 });
  await openFilters(page);

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
    { filter: 'View: New', url: '/projects?view=new&country=any', filtersOn: "projects.status = 'new'" },
    {
      filter: 'View: Watchlist',
      url: '/projects?view=watchlist&country=any',
      filtersOn: "projects.watch = true AND status <> 'dismissed'",
    },
    {
      filter: 'View: Client ready',
      url: '/projects?view=client_ready&country=any',
      filtersOn: "projects.status = 'client_ready'",
    },
    { filter: 'View: Trash', url: '/projects?view=trash&country=any', filtersOn: "projects.status = 'dismissed'" },
    ...stages.map((st) => ({
      filter: `Stage chip: ${st}`,
      url: `/projects?view=all&country=any&stage=${encodeURIComponent(st)}`,
      filtersOn: 'projects.stage =',
    })),
    {
      // THE DEFAULT ITSELF, measured. No country parameter at all, which is how
      // the Register opens: it must return fewer than the cleared baseline, or
      // the default is not being applied.
      filter: 'Geography default (no parameter)',
      url: '/projects?view=all',
      filtersOn: "projects.country = 'United States' by default",
    },
    {
      filter: 'Geography L1: United States',
      url: '/projects?view=all&country=United+States',
      filtersOn: 'projects.country =',
    },
    {
      filter: 'Geography L2: California',
      url: '/projects?view=all&country=United+States&region=California',
      filtersOn: 'projects.country = AND projects.region_state =',
    },
    {
      filter: 'Geography L3: Anaheim',
      url: '/projects?view=all&country=United+States&region=California&market=Anaheim',
      filtersOn: 'country = AND region_state = AND market =',
    },
    {
      filter: 'Search: "resort"',
      url: '/projects?view=all&country=any&q=resort',
      filtersOn: 'ilike over name, primary_applicant, primary_representative',
    },
    // Saved views: each must move the number, or it is a control that lies.
    {
      filter: 'Saved view: Anaheim',
      url: '/projects?view=all&saved=anaheim&country=United+States&region=California&market=Anaheim',
      filtersOn: 'country + region_state + market',
    },
    {
      filter: 'Saved view: Approved, anywhere',
      url: '/projects?view=all&saved=approved&country=any&stage=approved',
      filtersOn: "projects.stage = 'approved'",
    },
    {
      filter: 'Saved view: Hearing scheduled',
      url: '/projects?view=all&saved=hearing&country=any&stage=hearing+scheduled',
      filtersOn: "projects.stage = 'hearing scheduled'",
    },
    {
      filter: 'Search: "zzzznomatch"',
      url: '/projects?view=all&country=any&q=zzzznomatch',
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
  const defaulted = await totalFor(page, '/projects?view=all');
  const cleared = await totalFor(page, '/projects?view=all&country=any');
  console.log(
    `${'Default US vs cleared'.padEnd(34)} ${String(defaulted).padStart(5)} -> ${String(cleared).padStart(5)}`
  );
  expect(defaulted, 'the United States default is not being applied').toBeLessThan(cleared);
  expect(cleared, 'clearing the country filter did not restore the global set').toBe(baseline);

  // Sorting must NOT change the count: it reorders the same set. A sort that
  // changes the total is a filter pretending to be a sort.
  const sorted = await totalFor(page, '/projects?view=all&country=any&sort=name&dir=asc');
  console.log(`${'Sort by name (control)'.padEnd(34)} ${String(baseline).padStart(5)} -> ${String(sorted).padStart(5)}`);
  expect(sorted, 'sorting changed the result count, so it is filtering').toBe(baseline);

  // ---- THE HIERARCHY. A NARROWER FILTER RETURNS A STRICT SUBSET. ------------
  //
  // THIS IS THE ASSERTION THE AUDIT DID NOT HAVE, and its absence is why a
  // regression that broke the market filter entirely was recorded here as
  // sixteen rows of "changed" and shipped.
  //
  // Every row above compares one filter against the GLOBAL baseline. That
  // catches a filter that does nothing at all. It cannot catch a filter that
  // does its PARENT's job: L3 Anaheim returning all 27 of California is not the
  // baseline's 267, so it read as "changed" and passed, while the register was
  // showing an operator every project in the state under a filter naming one
  // city. The relationship that means something is between a level and the
  // level above it, and it has to be checked on ids rather than on counts.
  // MEASURE EVERYTHING, THEN JUDGE, AND WRITE THE ARTIFACT IN BETWEEN.
  //
  // Assertions used to sit inside these loops, so the first failure ended the
  // run and no artifact was written at all - the one moment the numbers are
  // most worth having is the moment the old shape threw them away. Every
  // measurement below is collected, the artifact is written, and the
  // expectations run last against what was collected.
  const hierarchy: {
    chain: string;
    region: string;
    market: string;
    levels: { label: string; url: string; size: number }[];
    l1: number;
    l2: number;
    l3: number;
    l2Escapees: number;
    l3Escapees: number;
    verdict: string;
  }[] = [];

  console.log('\n===== GEOGRAPHY HIERARCHY =====');
  const l1Url = '/projects?view=all&country=United+States';
  const l1 = await idsFor(page, l1Url);

  for (const region of ['California', 'Nevada']) {
    const l2Url = `${l1Url}&region=${encodeURIComponent(region)}`;
    // The market is read off the rail rather than hardcoded, so the audit
    // cannot test a market the corpus no longer holds and call the resulting
    // equality a pass.
    await page.goto(l2Url, { waitUntil: 'domcontentloaded' });
    await openGeographyTree(page);
    await expect(page.locator('[data-market]').first()).toBeVisible({ timeout: 120_000 });
    const marketNodes = await page
      .locator('[data-market]')
      .evaluateAll((els) =>
        els.map((e) => ({
          value: e.getAttribute('data-market') ?? '',
          projects: Number(e.getAttribute('data-projects') ?? '0'),
        }))
      );
    const top = marketNodes.filter((m) => m.projects > 0).sort((a, b) => b.projects - a.projects)[0];
    expect(top, `${region} rail offered no market with projects`).toBeTruthy();

    const l2 = await idsFor(page, l2Url);
    const l3Url = `${l2Url}&market=${encodeURIComponent(top.value)}`;
    const l3 = await idsFor(page, l3Url);

    const l2Escapees = escapees(l2, l1);
    const l3Escapees = escapees(l3, l2);
    console.log(
      `  ${region.padEnd(12)} L1 ${l1.size} > L2 ${l2.size} > L3 ${l3.size} (${top.value})`
    );

    hierarchy.push({
      chain: `United States > ${region} > ${top.value}`,
      region,
      market: top.value,
      levels: [
        { label: 'L1 United States', url: l1Url, size: l1.size },
        { label: `L2 ${region}`, url: l2Url, size: l2.size },
        { label: `L3 ${top.value}`, url: l3Url, size: l3.size },
      ],
      l1: l1.size,
      l2: l2.size,
      l3: l3.size,
      l2Escapees: l2Escapees.length,
      l3Escapees: l3Escapees.length,
      verdict:
        l3.size === l2.size
          ? 'L3 EQUALS L2: the market filter is not being applied'
          : l3Escapees.length || l2Escapees.length
            ? 'NOT A SUBSET'
            : 'strict subset at every level',
    });
  }

  // ---- "ALL" MUST MEAN ALL. ------------------------------------------------
  //
  // "All venues" read 203 while "All stages" read 267, on the same unfiltered
  // register. Sixty-four projects carry no venue type - and, measured, no record
  // of theirs names one either - so a quarter of the register was missing from
  // that axis with nothing on the screen saying so and nothing to click for it.
  //
  // Each row's "All" chip is now the whole axis, and the axis carries an
  // explicit node for the projects with no value on it. This asserts the first
  // half, per row, against the register's own total. It catches the same gap
  // opening on any axis, including stage, which measures zero missing today and
  // is one null away from the identical defect.
  console.log('\n===== EVERY "ALL" CHIP IS THE WHOLE REGISTER =====');
  const allChips: { axis: string; all: number }[] = [];
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('pager-total')).toBeVisible({ timeout: 120_000 });
  await openFilters(page);
  for (const attr of ['stage', 'venue', 'category'] as const) {
    // WAIT FOR A REAL FACET VALUE, not merely for a second chip.
    //
    // "All venues" and "No venue type" are both rendered from state that exists
    // before the facet query answers - the first from an empty count map, the
    // second from its own count query - so a poll for "more than one chip" is
    // satisfied on the first paint. Read then, All shows 0 named + 64 unnamed
    // and this audit reports 64 against a register of 267: the instrument's own
    // race, printed as a finding about the product.
    await expect
      .poll(
        async () =>
          await page
            .locator(`[data-${attr}]`)
            .evaluateAll(
              (els, a: string) =>
                els.filter((e) => {
                  const v = e.getAttribute(`data-${a}`);
                  return v && v !== 'all' && v !== '__none__';
                }).length,
              attr
            ),
        { timeout: 120_000 }
      )
      .toBeGreaterThan(0);
    const all = Number(
      await page
        .locator(`[data-${attr}="all"]`)
        .first()
        .evaluate((e) => (e.textContent ?? '').replace(/[^0-9]/g, ''))
    );
    console.log(`  ${attr.padEnd(9)} All = ${String(all).padStart(4)}   register = ${baseline}`);
    allChips.push({ axis: attr, all });
  }

  // AND THE NODE OPENS. A count with no route to it is the same silent gap one
  // step later, so the "no value" chip is followed to its list.
  const noValue: { axis: string; total: number }[] = [];
  for (const attr of ['venue', 'category'] as const) {
    const total = await totalFor(page, `${BASE}&${attr}=__none__`);
    console.log(`  ${attr.padEnd(9)} no value -> ${total} projects`);
    noValue.push({ axis: attr, total });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('pager-total')).toBeVisible({ timeout: 120_000 });
    await openFilters(page);
  }

  // ---- THE RAIL MUST COUNT WHAT CLICKING IT RETURNS. -----------------------
  //
  // The market node's number used to come off projects.market, which is a MODE
  // over the project's records, while clicking it resolves through the records.
  // Two questions, one row. Measured 2026-08-15, before the fix:
  //
  //   Las Vegas       rail 32, click 33
  //   Oakland         rail  5, click  4
  //   Orange County   rail  0, click  1     <- a node over a reachable project
  //   Willets Point   rail  0, click  1     <- the same
  //   Yonkers         rail  1, click  0     <- a node promising one, returning none
  //
  // Equality, not a direction. A direction was the right call for the venue and
  // category CHIPS, where the two numbers are deliberately different questions
  // pending a decision; here the number and the click are the same question and
  // there is nothing left to decide.
  console.log('\n===== THE RAIL COUNTS WHAT THE CLICK RETURNS =====');
  const railRows: { region: string; market: string; rail: number; click: number }[] = [];
  for (const region of ['California', 'Nevada', 'New York']) {
    const regionUrl = `${l1Url}&region=${encodeURIComponent(region)}`;
    await page.goto(regionUrl, { waitUntil: 'domcontentloaded' });
    await openGeographyTree(page);
    await expect(page.locator('[data-market]').first()).toBeVisible({ timeout: 120_000 });
    const nodes = await page
      .locator('[data-market]')
      .evaluateAll((els) =>
        els.map((e) => ({
          value: e.getAttribute('data-market') ?? '',
          projects: Number(e.getAttribute('data-projects') ?? '0'),
        }))
      );
    for (const n of nodes) {
      const click = await totalFor(page, `${regionUrl}&market=${encodeURIComponent(n.value)}`);
      console.log(
        `  ${region.padEnd(12)} ${n.value.padEnd(44)} rail ${String(n.projects).padStart(4)}  click ${String(
          click
        ).padStart(4)}${n.projects === click ? '' : '   <-- DISAGREE'}`
      );
      railRows.push({ region, market: n.value, rail: n.projects, click });
    }
  }

  // ---- A VALUE NOTHING MATCHES RETURNS NOTHING. ----------------------------
  //
  // FAILING OPEN IS THE DANGEROUS DIRECTION and it is the one this axis failed
  // in. market=Atlantis returned all 254 projects in the United States: a filter
  // naming a market that does not exist, answering with the parent set in full.
  // The same shape reaches a client as a scope narrowed to one market and a
  // document covering every project under their name.
  //
  // Zero is the only acceptable answer. An empty register is visibly empty; a
  // register that quietly widened is not visibly anything.
  console.log('\n===== UNMATCHED VALUES MUST RETURN ZERO =====');
  const unmatched: { axis: string; url: string; total: number }[] = [];
  for (const [axis, param] of [
    ['market', 'market=Atlantis'],
    ['venue', 'venue=Notavenue'],
    ['category', 'category=Notacategory'],
  ] as const) {
    const url = `/projects?view=all&country=United+States&${param}`;
    const t = await totalFor(page, url);
    console.log(`  ${axis.padEnd(10)} ${param.padEnd(26)} -> ${t}`);
    unmatched.push({ axis, url, total: t });
  }

  // ---- VENUE AND CATEGORY, THE SAME WAY. -----------------------------------
  //
  // Both were added to the register on 10 August and neither was ever measured
  // here. They were broken on the click path from the day they landed and fully
  // broken from the day the record match landed, and no row in this file would
  // have said so.
  //
  // THE CHIP COUNT AND THE TOTAL ARE ALLOWED TO DISAGREE, IN ONE DIRECTION. A
  // chip counts projects whose venue_type COLUMN matches - a mode over the
  // project's records - while the list matches any record. So the total is at
  // or above the chip, never below it, because every project whose mode matches
  // also holds a record carrying the value. The gap is printed per value: it is
  // the number Philip is deciding the chip's meaning with.
  console.log('\n===== VENUE AND CATEGORY =====');
  const axisRows: {
    axis: string;
    value: string;
    chipCount: number;
    total: number;
    gap: number;
    escapees: number;
  }[] = [];
  const baselineIds = await idsFor(page, BASE);

  for (const attr of ['venue', 'category'] as const) {
    await totalFor(page, BASE);
    await openFilters(page);
    // WAIT FOR MORE THAN ONE CHIP, not for the first one.
    //
    // "All venues" is rendered from an empty facet result, so it exists on the
    // first paint while the facet query is still in flight. Waiting for it and
    // then reading the row returned exactly one chip, counting zero, and this
    // audit reported "no venue chip has any projects" - the instrument's own
    // race described as a finding about the corpus. The real chips arrive with
    // the facet answer, so the wait is for the second one.
    await expect
      .poll(async () => await page.locator(`[data-${attr}]`).count(), { timeout: 120_000 })
      .toBeGreaterThan(1);
    const chips = (await chipsOf(page, attr)).filter((c) => c.count > 0).slice(0, 3);
    expect(chips.length, `no ${attr} chips with a count rendered`).toBeGreaterThan(0);

    for (const chip of chips) {
      const url = `${BASE}&${attr}=${encodeURIComponent(chip.value)}`;
      const ids = await idsFor(page, url);
      const out = escapees(ids, baselineIds);
      console.log(
        `  ${attr.padEnd(9)} ${chip.value.padEnd(30)} chip ${String(chip.count).padStart(4)} -> list ${String(
          ids.size
        ).padStart(4)}  gap ${ids.size - chip.count >= 0 ? '+' : ''}${ids.size - chip.count}`
      );
      axisRows.push({
        axis: attr,
        value: chip.value,
        chipCount: chip.count,
        total: ids.size,
        gap: ids.size - chip.count,
        escapees: out.length,
      });
    }
  }

  mkdirSync('e2e/shots/walkthrough', { recursive: true });
  writeFileSync(
    'e2e/shots/walkthrough/filter-audit.json',
    JSON.stringify(
      {
        baseline,
        defaultGeography: defaulted,
        clearedGeography: cleared,
        results,
        sortControl: sorted,
        hierarchy,
        unmatched,
        venueAndCategory: axisRows,
        allChips,
        noValueNodes: noValue,
        railVersusClick: railRows,
      },
      null,
      2
    )
  );

  // ---- NOW JUDGE WHAT WAS MEASURED. ----------------------------------------
  for (const h of hierarchy) {
    expect(
      h.l2Escapees,
      `${h.region} returned ${h.l2Escapees} projects the United States does not hold`
    ).toBe(0);
    expect(
      h.l3Escapees,
      `${h.market} returned ${h.l3Escapees} projects ${h.region} does not hold`
    ).toBe(0);
    expect(h.l2, `${h.region} is not strictly narrower than the United States`).toBeLessThan(h.l1);
    // THE ONE THAT WOULD HAVE CAUGHT IT. Equality here is the whole regression:
    // the market filter contributed nothing and the list answered the region.
    expect(
      h.l3,
      `market=${h.market} returned exactly ${h.region}'s ${h.l2} projects, so the market filter is not being applied`
    ).toBeLessThan(h.l2);
    expect(h.l3, `market=${h.market} returned nothing at all`).toBeGreaterThan(0);
  }

  for (const a of allChips) {
    expect(
      a.all,
      `"All" on the ${a.axis} row counts ${a.all} against a register of ${baseline}. ` +
        `An "All" that is not all is a silent gap: ${baseline - a.all} projects are missing from that axis ` +
        `and the row offers no route to them.`
    ).toBe(baseline);
  }

  for (const n of noValue) {
    expect(
      n.total,
      `the ${n.axis} row's "no value" node returned ${n.total}. It exists because that set is not empty; ` +
        `a node counting projects it cannot open is the gap it was added to close.`
    ).toBeGreaterThan(0);
    expect(
      n.total,
      `the ${n.axis} row's "no value" node returned the whole register`
    ).toBeLessThan(baseline);
  }

  for (const r of railRows) {
    expect(
      r.rail,
      `the rail shows ${r.rail} for ${r.market} and clicking it returns ${r.click}. ` +
        `A navigation tree that hides a reachable result, or promises one it cannot produce, is not navigation.`
    ).toBe(r.click);
  }

  for (const u of unmatched) {
    expect(
      u.total,
      `${u.url} returned ${u.total} projects; an unresolvable ${u.axis} must return the empty set, not the parent's rows`
    ).toBe(0);
  }

  for (const r of axisRows) {
    expect(r.total, `${r.axis}=${r.value} returned nothing`).toBeGreaterThan(0);
    expect(
      r.total,
      `${r.axis}=${r.value} returned all ${baseline} projects, the whole unfiltered register, so the filter is not being applied`
    ).toBeLessThan(baseline);
    expect(
      r.escapees,
      `${r.axis}=${r.value} returned ${r.escapees} projects the unfiltered register does not hold`
    ).toBe(0);
    // Direction, not equality. Below the chip would mean the record match is
    // finding FEWER projects than the mode column, which is impossible.
    expect(
      r.total,
      `${r.axis}=${r.value} returned ${r.total}, below its chip's ${r.chipCount}; matching any record cannot find fewer projects than matching the mode column`
    ).toBeGreaterThanOrEqual(r.chipCount);
  }
});

// ---- CLICKING A CHIP MUST REQUERY. -----------------------------------------
//
// EVERY ROW ABOVE ARRIVES BY URL, AND THAT IS THE GAP THIS TEST CLOSES.
// `page.goto` mounts the screen with the filter already in hand, so the query
// is built once, correctly, from state that never changes afterwards. It cannot
// tell you what happens when an operator CLICKS - which is how the register is
// actually used, and which is where all three axes were dead.
//
// The failure was one missing entry in a useMemo dependency array. The filter
// reached the URL, reached React state, reached its own record query and
// reached the id list; the object those ids are spread into was simply never
// rebuilt, so the query key never changed, so react-query served the previous
// answer from cache and no request was issued at all. Everything looked applied
// except the rows.
//
// So this measures the two things a URL test cannot: that a request goes out,
// and that the number lands where arriving by URL says it should.
test('clicking a filter chip requeries the list', async ({ page }) => {
  test.setTimeout(600_000);

  const axes: { axis: string; from: string; attr: string; pick: 'chip' | 'market' }[] = [
    { axis: 'venue', from: '/projects?view=all&country=any', attr: 'venue', pick: 'chip' },
    { axis: 'category', from: '/projects?view=all&country=any', attr: 'category', pick: 'chip' },
    {
      axis: 'market',
      from: '/projects?view=all&country=United+States&region=California',
      attr: 'market',
      pick: 'market',
    },
  ];

  const rows: {
    axis: string;
    value: string;
    before: number;
    expected: number;
    afterClick: number;
    requests: number;
  }[] = [];

  console.log('\n===== CLICK, NOT NAVIGATE =====');
  for (const a of axes) {
    await page.goto(a.from, { waitUntil: 'domcontentloaded' });
    const pager = page.getByTestId('pager-total');
    await expect(pager).toBeVisible({ timeout: 120_000 });
    await expect.poll(async () => await pager.getAttribute('data-total'), { timeout: 120_000 }).not.toBeNull();
    // The market controls live in the press-only tree, which is collapsed; the
    // venue and category chips live in the filter panel, which is too.
    if (a.pick === 'market') await openGeographyTree(page);
    else await openFilters(page);
    const before = Number(await pager.getAttribute('data-total'));

    // A real value, taken off the screen the click will happen on.
    const candidates = await page
      .locator(`[data-${a.attr}]`)
      .evaluateAll((els, attr: string) =>
        els
          .map((e) => ({
            value: e.getAttribute(`data-${attr}`) ?? '',
            projects: Number(e.getAttribute('data-projects') ?? '1'),
          }))
          .filter((c) => c.value && c.value !== 'all' && c.projects > 0),
        a.attr
      );
    expect(candidates.length, `no ${a.axis} control rendered to click`).toBeGreaterThan(0);
    const value = candidates[0].value;

    // What arriving by URL says this filter is worth. Measured first, so the
    // click has a number to be wrong against.
    const byUrl = await totalFor(page, `${a.from}&${a.axis}=${encodeURIComponent(value)}`);
    // Back to the unfiltered screen, and click it this time.
    await page.goto(a.from, { waitUntil: 'domcontentloaded' });
    await expect(pager).toBeVisible({ timeout: 120_000 });
    await expect.poll(async () => await pager.getAttribute('data-total'), { timeout: 120_000 }).not.toBeNull();
    if (a.pick === 'market') await openGeographyTree(page);
    else await openFilters(page);

    let requests = 0;
    const count = (r: { url(): string }) => {
      if (r.url().includes('/rest/v1/projects')) requests++;
    };
    page.on('request', count);
    await page.locator(`[data-${a.attr}="${value}"]`).first().click();

    // The URL must carry it, and then the list must catch up to it.
    await expect
      .poll(async () => new URL(page.url()).searchParams.get(a.axis), { timeout: 30_000 })
      .toBe(value);
    let landed = -1;
    try {
      await expect
        .poll(async () => Number(await pager.getAttribute('data-total')), { timeout: 60_000 })
        .toBe(byUrl);
      landed = byUrl;
    } catch {
      landed = Number(await pager.getAttribute('data-total'));
    }
    page.off('request', count);

    console.log(
      `  ${a.axis.padEnd(9)} ${value.padEnd(26)} ${before} --click--> ${landed} (by url ${byUrl}), ${requests} project queries`
    );
    rows.push({ axis: a.axis, value, before, expected: byUrl, afterClick: landed, requests });
  }

  mkdirSync('e2e/shots/walkthrough', { recursive: true });
  writeFileSync('e2e/shots/walkthrough/filter-click-audit.json', JSON.stringify({ rows }, null, 2));

  // ---- JUDGE LAST, so a failing axis still leaves the other two measured. ---
  for (const r of rows) {
    // If the by-URL number equals the unfiltered one the axis is already dead on
    // the URL path, and there is nothing left for the click to be wrong about.
    // That is a finding, not a bad fixture: measured against the code this test
    // was written for, venue=Museum by URL returned all 267 projects.
    expect(
      r.expected,
      `${r.axis}=${r.value} by URL returns ${r.expected}, exactly what no filter returns: the axis is not applied even by URL`
    ).not.toBe(r.before);
    expect(
      r.requests,
      `clicking the ${r.axis} control issued no project query at all: the query key did not change, so react-query answered from cache`
    ).toBeGreaterThan(0);
    expect(
      r.afterClick,
      `clicking ${r.axis}=${r.value} left the list showing ${r.afterClick}; the same filter by URL returns ${r.expected}`
    ).toBe(r.expected);
  }
});
