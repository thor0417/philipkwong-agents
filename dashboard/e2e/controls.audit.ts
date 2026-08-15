// THE CONTROL AUDIT. Does each control do what its label says?
//
// Read only. Nothing here writes: the register's dismiss and watch keys are
// deliberately not pressed, because an audit that bins a project every time it
// runs is not an audit.
//
// The test for a filter is a NUMBER BEFORE AND AFTER. A control that looks
// applied and returns the same set is the failure this project keeps finding,
// and it cannot be caught by reading code.

import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

test('controls do what they say', async ({ page }) => {
  test.setTimeout(600_000);
  const out: Record<string, unknown> = {};

  // ---- TODAY: what each section actually says ------------------------------
  await page.goto('/today', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(4000);
  const sections: Record<string, string> = {};
  for (const h of await page.locator('h2').all()) {
    const title = (await h.textContent())?.trim() ?? '';
    const body = await h.evaluate((el) => {
      const sec = el.closest('section');
      return sec ? (sec as HTMLElement).innerText.replace(/\s+/g, ' ').slice(0, 320) : '';
    });
    sections[title] = body;
  }
  console.log('\n===== TODAY SECTIONS =====');
  for (const [k, v] of Object.entries(sections)) console.log(`  [${k}] ${v}`);
  out.today = sections;

  // Today's period control: does changing it change what is shown?
  const todayCounts: Record<string, number> = {};
  for (const token of ['7d', '30d', 'm:2026-07', 'm:2026-01']) {
    await page.goto(`/today?period=${encodeURIComponent(token)}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1')).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(3500);
    todayCounts[token] = await page.locator('li').count();
  }
  console.log('\n===== TODAY PERIOD =====');
  for (const [k, v] of Object.entries(todayCounts)) console.log(`  period=${k.padEnd(12)} list items=${v}`);
  out.todayPeriod = todayCounts;

  // ---- RECORDS: its own filters --------------------------------------------
  await page.goto('/records', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const recordsBase = await page.locator('tbody tr').count();
  const chips = await page
    .locator('button')
    .evaluateAll((els) =>
      els
        .map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim())
        .filter((t) => t && t.length < 40)
        .slice(0, 40)
    );
  console.log('\n===== RECORDS =====');
  console.log(`  rows with default filters: ${recordsBase}`);
  console.log(`  controls on screen: ${chips.join(' | ').slice(0, 600)}`);
  out.records = { rows: recordsBase, controls: chips };

  // ---- REGISTER: every control, measured -----------------------------------
  async function total(url: string): Promise<number> {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const pager = page.getByTestId('pager-total');
    await expect(pager).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => await pager.getAttribute('data-total'), { timeout: 60_000 }).not.toBeNull();
    return Number(await pager.getAttribute('data-total'));
  }

  const B = '/projects?view=all&country=any';
  const baseline = await total(B);
  const cases: [string, string][] = [
    ['baseline (all, any country)', B],
    ['view=new', `${B}&view=new`],
    ['view=watchlist', '/projects?view=watchlist&country=any'],
    ['view=client_ready', '/projects?view=client_ready&country=any'],
    ['view=trash', '/projects?view=trash&country=any'],
    ['stage=filed', `${B}&stage=filed`],
    ['stage=approved', `${B}&stage=approved`],
    ['stage=dormant', `${B}&stage=dormant`],
    ['country default (absent)', '/projects?view=all'],
    ['country=United States', '/projects?view=all&country=United+States'],
    ['region=Nevada', '/projects?view=all&country=United+States&region=Nevada'],
    ['market=Las Vegas', '/projects?view=all&country=United+States&region=Nevada&market=Las+Vegas'],
    ['q=resort', `${B}&q=resort`],
    ['q=zzzznomatch', `${B}&q=zzzznomatch`],
    ['period=m:2026-07 arrived', `${B}&period=m:2026-07&axis=arrived`],
    ['period=m:2026-07 moved', `${B}&period=m:2026-07&axis=moved`],
    ['period=m:2019-01 arrived', `${B}&period=m:2019-01&axis=arrived`],
    ['period=m:2019-01 moved', `${B}&period=m:2019-01&axis=moved`],
    ['bucket=week (must not filter)', `${B}&bucket=week`],
    ['bucket=month (must not filter)', `${B}&bucket=month`],
    ['sort=name (must not filter)', `${B}&sort=name&dir=asc`],
    ['page=2 (must not change total)', `${B}&page=2`],
    ['nonsense param', `${B}&banana=1`],
    ['nonsense stage value', `${B}&stage=notastage`],
    ['nonsense market value', '/projects?view=all&country=United+States&market=Atlantis'],
    // The other two record-matched axes, which this audit never measured. Venue
    // and category reached the register on 10 August and were never listed here,
    // so a broken one had nowhere to show up.
    ['nonsense venue value', `${B}&venue=Notavenue`],
    ['nonsense category value', `${B}&category=Notacategory`],
    ['venue=Hotel', `${B}&venue=Hotel`],
    ['category=Hospitality/Tourism', `${B}&category=${encodeURIComponent('Hospitality/Tourism')}`],
    // L2 and L3 adjacent in the table, because the number that matters is the
    // difference between them and it took a person comparing two rows by eye to
    // see that there was not one.
    ['region=California (L2)', '/projects?view=all&country=United+States&region=California'],
    [
      'market=Anaheim (L3, must be < L2)',
      '/projects?view=all&country=United+States&region=California&market=Anaheim',
    ],
  ];

  console.log('\n===== REGISTER CONTROLS =====');
  const registerResults: { label: string; url: string; total: number; verdict: string }[] = [];
  const byLabel = new Map<string, number>();
  for (const [label, url] of cases) {
    const t = await total(url);
    let verdict = t === baseline ? 'UNCHANGED' : 'changed';
    if (/must not/.test(label)) verdict = t === baseline ? 'correct (unchanged)' : 'FILTERS WHEN IT SHOULD NOT';
    if (/nonsense/.test(label)) verdict = t === baseline ? 'FAILS OPEN (returns everything)' : t === 0 ? 'fails closed (0)' : `partial (${t})`;
    registerResults.push({ label, url, total: t, verdict });
    byLabel.set(label, t);
    console.log(`  ${label.padEnd(32)} ${String(t).padStart(5)}   ${verdict}`);
  }
  out.register = { baseline, results: registerResults };

  // The expectations over these numbers run at the very END of this file, after
  // the artifact is written. See the note there.

  // ---- KEYBOARD: the non-destructive keys ----------------------------------
  console.log('\n===== KEYBOARD =====');
  await page.goto('/projects?country=any', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-row-id]').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  const keyboard: Record<string, string> = {};

  await page.keyboard.press('j');
  await page.waitForTimeout(800);
  const afterJ = await page.locator('aside[aria-label="Project detail"]').isVisible().catch(() => false);
  keyboard['J opens the detail pane'] = afterJ ? 'works' : 'DEAD';

  const firstSelected = await page.locator('[class*="rowSelected"]').first().getAttribute('data-row-id');
  await page.keyboard.press('j');
  await page.waitForTimeout(700);
  const secondSelected = await page.locator('[class*="rowSelected"]').first().getAttribute('data-row-id');
  keyboard['J moves the selection'] = firstSelected !== secondSelected ? 'works' : 'DEAD';

  await page.keyboard.press('k');
  await page.waitForTimeout(700);
  const backSelected = await page.locator('[class*="rowSelected"]').first().getAttribute('data-row-id');
  keyboard['K moves back'] = backSelected === firstSelected ? 'works' : 'DEAD';

  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  const afterEsc = await page.locator('aside[aria-label="Project detail"]').isVisible().catch(() => false);
  keyboard['Escape closes the pane'] = afterEsc ? 'DEAD' : 'works';

  // Typing in the search box must not trigger the shortcuts.
  await page.locator('input[aria-label="Search projects"]').fill('jkw');
  await page.waitForTimeout(500);
  const paneAfterTyping = await page.locator('aside[aria-label="Project detail"]').isVisible().catch(() => false);
  keyboard['typing j/k/w in search does not trigger shortcuts'] = paneAfterTyping ? 'BROKEN' : 'works';

  for (const [k, v] of Object.entries(keyboard)) console.log(`  ${k.padEnd(52)} ${v}`);
  out.keyboard = keyboard;

  // ---- REPORTS: the client dropdown ----------------------------------------
  await page.goto('/reports', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('report-client')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(3000);
  const options = await page.getByTestId('report-client').locator('option').allTextContents();
  const simtecs = options.filter((o) => o.includes('Simtec')).length;
  console.log('\n===== REPORTS CLIENT DROPDOWN =====');
  console.log(`  options: ${JSON.stringify(options)}`);
  console.log(`  Simtec entries: ${simtecs}`);
  out.reportsClientOptions = options;

  // ---- THE ARTIFACT IS WRITTEN BEFORE ANYTHING IS JUDGED. ------------------
  //
  // It used to be written last, so a failing run produced no file at all - and
  // the run where the numbers matter most is the failing one. Measuring and
  // judging are separate jobs and the file belongs to the first of them.
  mkdirSync('e2e/shots/walkthrough', { recursive: true });
  writeFileSync('e2e/shots/walkthrough/controls-audit.json', JSON.stringify(out, null, 2));

  // ---- THE VERDICTS ARE NOW ASSERTIONS. ------------------------------------
  //
  // THIS FILE PRINTED THE REGRESSION AND PASSED. `market=Atlantis` was recorded
  // as "partial (254)" - a market that does not exist returning every project in
  // the United States - and "partial" is a word, not a test, so the run was
  // green. `region=Nevada 71` and `market=Las Vegas 71` sat four lines apart in
  // the same output and nothing compared them.
  //
  // A verdict string is a description. What a description is for is being read,
  // and nobody read it. These are the same statements as expectations.
  expect(simtecs, 'the client dropdown still shows duplicates').toBe(1);

  for (const label of [
    'nonsense stage value',
    'nonsense market value',
    'nonsense venue value',
    'nonsense category value',
  ]) {
    expect(
      byLabel.get(label),
      `${label} did not fail closed; a value nothing matches must return the empty set, never the parent's rows`
    ).toBe(0);
  }

  const l2 = byLabel.get('region=California (L2)') ?? 0;
  const l3 = byLabel.get('market=Anaheim (L3, must be < L2)') ?? 0;
  expect(l2, 'California returned nothing, so the L2/L3 comparison proves nothing').toBeGreaterThan(0);
  expect(l3, 'Anaheim returned nothing').toBeGreaterThan(0);
  expect(
    l3,
    `Anaheim returned ${l3} and California returned ${l2}: the market filter is answering its parent's question`
  ).toBeLessThan(l2);

  for (const label of ['venue=Hotel', 'category=Hospitality/Tourism']) {
    const t = byLabel.get(label) ?? 0;
    expect(t, `${label} returned nothing`).toBeGreaterThan(0);
    expect(t, `${label} returned the whole register, so it is not filtering`).toBeLessThan(baseline);
  }
});
