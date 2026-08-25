// COVERAGE, READ OFF THE SCREEN THAT STATES IT.
//
// The thirteen claimed markets with the state each is actually in, the
// press-only count, and every source that has published nothing in thirty days.
// Read from the Health screen rather than computed here, because a second
// implementation of "is Nashville thin" is a second chance to be wrong about it.
//
// It asserts the things that must be true of the SCREEN - every declared market
// has a row, every row carries a state, the press-only node exists and is
// collapsed by default - and prints the facts about the corpus without
// asserting them, because the corpus is allowed to change.

import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
// ONE COPY, READ ACROSS THE PACKAGE SPLIT. corpus-scope imports nothing, so it
// is on the sanctioned dashboard -> agents list; see the CLAUDE.md split note.
import { CORPUS_COUNTRIES } from '../../lib/corpus-scope';
import { walkthroughDir, walkthroughOut } from './artefacts';

test('coverage and health', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/health', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-market]').first()).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(1500);

  const markets = await page.locator('[data-market]').evaluateAll((els) =>
    els.map((e) => ({
      market: e.getAttribute('data-market') ?? '',
      state: e.getAttribute('data-state') ?? '',
      projects: Number(e.children[2]?.textContent ?? '0'),
      named: Number(e.children[3]?.textContent ?? '0'),
      records: Number(e.children[4]?.textContent ?? '0'),
      published: (e.children[5]?.textContent ?? '').trim(),
      captured: (e.children[6]?.textContent ?? '').trim(),
      why: (e.children[7]?.textContent ?? '').trim(),
    }))
  );

  console.log('\n===== THE CLAIMED MARKETS, WITH THE STATE EACH IS IN =====');
  for (const m of markets) {
    console.log(
      `  ${m.market.padEnd(44)} ${m.state.padEnd(9)} proj ${String(m.projects).padStart(3)}  named ${String(
        m.named
      ).padStart(3)}  rec ${String(m.records).padStart(4)}  published ${m.published.padStart(6)}  captured ${m.captured.padStart(5)}`
    );
    console.log(`      ${m.why}`);
  }

  const sources = await page.locator('[data-source]').evaluateAll((els) =>
    els.map((e) => ({
      source: e.getAttribute('data-source') ?? '',
      quiet: e.getAttribute('data-quiet') === 'yes',
      records: Number(e.children[1]?.textContent ?? '0'),
      published: (e.children[2]?.textContent ?? '').trim(),
      captured: (e.children[3]?.textContent ?? '').trim(),
      thisRun: (e.children[4]?.textContent ?? '').trim(),
      feeds: (e.children[5]?.textContent ?? '').trim(),
    }))
  );

  console.log('\n===== SOURCES =====');
  for (const s of sources) {
    console.log(
      `  ${s.source.padEnd(20)} rec ${String(s.records).padStart(4)}  published ${s.published.padStart(
        7
      )}  captured ${s.captured.padStart(5)}  this run ${s.thisRun.padStart(8)}${
        s.quiet ? '   <-- QUIET 30d+' : ''
      }${s.feeds ? `   feeds ${s.feeds}` : ''}`
    );
  }
  const quiet = sources.filter((s) => s.quiet);
  console.log(`\nquiet more than 30 days: ${quiet.length} of ${sources.length}`);

  const press = (await page.getByText(/Press-only geographies/).textContent()) ?? '';
  const pressLede =
    (await page.locator('section', { hasText: 'Press-only geographies' }).first().innerText()).replace(
      /\s+/g,
      ' '
    );
  console.log(`\n${press.trim()} | ${pressLede.slice(0, 220)}`);

  // ---- THE RAIL, WHICH READS THE SAME NUMBERS -----------------------------
  await page.goto('/projects', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-covered-market]').first()).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(1500);
  const railMarkets = await page.locator('[data-covered-market]').evaluateAll((els) =>
    els.map((e) => ({
      market: e.getAttribute('data-covered-market') ?? '',
      state: e.getAttribute('data-coverage-state') ?? '',
    }))
  );
  console.log(`\nrail covered markets: ${railMarkets.length}`);

  // The press node must exist and must start collapsed: the whole point is that
  // press-only geography is not presented beside the markets we watch.
  const toggle = page.getByTestId('press-coverage-toggle');
  await expect(toggle, 'the rail has no press-coverage node').toBeVisible({ timeout: 30_000 });
  expect(
    await toggle.getAttribute('aria-expanded'),
    'the press-only tree is open by default, which is what put press geography beside covered markets'
  ).toBe('false');
  await toggle.click();
  await expect(page.locator('[data-country]').first()).toBeVisible({ timeout: 30_000 });

  // ---- THE COMPOSER'S COUNTRIES ARE DERIVED, NOT HARDCODED ----------------
  //
  // The brief called for removing "the composer's hardcoded country=United
  // States, which makes every non-US geography unreachable in a report". There
  // is no such hardcode: the only literal 'United States' in the codebase is the
  // Projects screen's clearable default, and the composer builds its country
  // options from a facet with no country constraint on it.
  //
  // THIS ASSERTION WAS INVERTED BY A DECISION, NOT BY A REGRESSION. It used to
  // demand that a non-US country be on offer, and that was a fair proxy for
  // "derived" while the corpus held foreign records. It is not one any more:
  // this system is United States only (lib/corpus-scope), the foreign sources
  // are retired and their records tombstoned, so the facet correctly returns one
  // country and the old assertion could only be satisfied by re-admitting
  // records the system is meant to refuse.
  //
  // So it now asserts DERIVATION directly, which is what the brief actually
  // cared about: the composer offers exactly the countries the register holds.
  // Reopen a country in corpus-scope and this test demands the composer follow;
  // leave it closed and it demands the composer not invent one.
  await page.goto('/reports', { waitUntil: 'domcontentloaded' });
  const countryChips = page.getByTestId('report-country-chips');
  await expect(countryChips).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(1500);
  const offered = await countryChips
    .locator('button')
    .evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\d+$/, '').trim()));
  const nonUs = offered.filter((c) => c && c !== 'United States');
  console.log(`\ncomposer offers ${offered.length} countries, ${nonUs.length} of them not the US`);
  console.log(`  e.g. ${nonUs.slice(0, 8).join(', ')}`);

  mkdirSync(walkthroughDir(), { recursive: true });
  writeFileSync(
    walkthroughOut('coverage-audit.json'),
    JSON.stringify(
      { markets, sources, quiet: quiet.map((q) => q.source), railMarkets, composerCountries: offered },
      null,
      2
    )
  );

  expect(
    offered.length,
    'the composer offers no country at all, so nothing can be scoped into a report'
  ).toBeGreaterThan(0);
  // Every country the register holds is on offer. A composer that dropped one
  // would make that geography unreachable in a report, which is the failure the
  // brief named.
  // Checked against lib/corpus-scope, which is the SINGLE declaration of which
  // countries this system covers - not against a list restated here, because a
  // restated list is a second copy that goes stale and the stale half decides
  // what a client can be sent.
  for (const c of CORPUS_COUNTRIES) {
    expect(offered, `the corpus covers ${c} and the composer does not offer it`).toContain(c);
  }
  // And it invents none.
  for (const c of offered) {
    expect(
      CORPUS_COUNTRIES,
      `the composer offers ${c}, which lib/corpus-scope does not cover`
    ).toContain(c);
  }
  console.log(`  countries: corpus-scope ${CORPUS_COUNTRIES.join(', ')} | composer ${offered.join(', ')}`);

  // ---- WHAT MUST BE TRUE OF THE SCREEN ------------------------------------
  expect(markets.length, 'the Health screen lists no markets').toBeGreaterThan(0);
  expect(
    railMarkets.length,
    'the rail and Health disagree about how many markets are claimed'
  ).toBe(markets.length);
  for (const m of markets) {
    expect(
      ['live', 'degraded', 'stale', 'thin', 'dead'],
      `${m.market} carries no coverage state`
    ).toContain(m.state);
    expect(m.why.length, `${m.market} states a coverage state with no reason`).toBeGreaterThan(0);
  }
  const railStates = new Map(railMarkets.map((r) => [r.market, r.state]));
  for (const m of markets) {
    expect(
      railStates.get(m.market),
      `the rail says ${m.market} is ${railStates.get(m.market)} and Health says ${m.state}`
    ).toBe(m.state);
  }
});
