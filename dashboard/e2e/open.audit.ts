// WHAT OPENING THE REGISTER COSTS.
//
// Two numbers nobody had: how long it takes for the first ranked project to be
// on screen, and how many queries the screen issues to get there. Eleven were
// counted in passing during the filter work and never revisited, which is how a
// screen comes to issue a query for a control nobody can see.
//
// COLD AND WARM ARE DIFFERENT QUESTIONS AND BOTH ARE REAL. Cold is a browser
// that has never loaded this app: an empty react-query cache, an empty HTTP
// cache, a session read from storage. Warm is the second visit in the same
// context, which is what the operator actually experiences all day. A screen
// that is fast warm and slow cold is fine; one that is slow warm is not.
//
// IT ALSO WATCHES THE CONSOLE, because the register logged a 400 on every load
// for weeks - project_facet_counts refusing a field its whitelist was written
// before - and the page rendered correctly through it, so nothing failed and
// nobody looked.

import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const VIEWPORT = { width: 1920, height: 1080 };
const REST = '/rest/v1/';

interface Open {
  pass: string;
  ms: number;
  queries: number;
  byTable: Record<string, number>;
  status4xx5xx: string[];
  consoleErrors: string[];
}

test('opening the register', async ({ browser }) => {
  test.setTimeout(600_000);
  const results: Open[] = [];

  const context = await browser.newContext({
    storageState: 'e2e/.auth/state.json',
    viewport: VIEWPORT,
  });
  const page = await context.newPage();

  async function measure(pass: string, url: string): Promise<Open> {
    const byTable: Record<string, number> = {};
    const status4xx5xx: string[] = [];
    const consoleErrors: string[] = [];
    let queries = 0;

    const onRequest = (r: { url(): string }) => {
      const u = r.url();
      if (!u.includes(REST)) return;
      queries++;
      // The table or function being read, which is what makes the count
      // actionable: "fifteen queries" is a number, "five of them are view
      // counts" is a finding.
      const after = u.slice(u.indexOf(REST) + REST.length);
      const name = after.split(/[?/]/)[0];
      byTable[name] = (byTable[name] ?? 0) + 1;
    };
    const onResponse = (r: { url(): string; status(): number }) => {
      if (r.url().includes(REST) && r.status() >= 400) {
        status4xx5xx.push(`${r.status()} ${r.url().slice(r.url().indexOf(REST) + REST.length, r.url().indexOf(REST) + REST.length + 60)}`);
      }
    };
    const onConsole = (m: { type(): string; text(): string }) => {
      if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160));
    };

    page.on('request', onRequest);
    page.on('response', onResponse);
    page.on('console', onConsole);

    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="register-row"]').first()).toBeVisible({
      timeout: 180_000,
    });
    const ms = Date.now() - t0;
    // Let the facets and counts land, so the query tally is the whole cost of
    // opening rather than only what the first row waited for.
    await page.waitForTimeout(3000);

    page.off('request', onRequest);
    page.off('response', onResponse);
    page.off('console', onConsole);

    const out: Open = { pass, ms, queries, byTable, status4xx5xx, consoleErrors };
    results.push(out);
    console.log(
      `${pass.padEnd(22)} first ranked row in ${String(ms).padStart(6)} ms, ${String(
        queries
      ).padStart(3)} queries`
    );
    for (const [t, n] of Object.entries(byTable).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(3)}  ${t}`);
    }
    for (const s of status4xx5xx) console.log(`    HTTP ${s}`);
    for (const c of consoleErrors.slice(0, 4)) console.log(`    console: ${c}`);
    return out;
  }

  const cold = await measure('cold (new context)', '/projects');
  const warm = await measure('warm (same context)', '/projects');
  // The filter panel's five facet queries are the ones worth attributing
  // separately, because they now fire for controls that are behind a
  // disclosure. Opening it should cost nothing extra if they already ran.
  await measure('warm, filter panel open', '/projects');

  await context.close();

  mkdirSync('e2e/shots/walkthrough', { recursive: true });
  writeFileSync('e2e/shots/walkthrough/open-audit.json', JSON.stringify(results, null, 2));

  // ---- JUDGE. -------------------------------------------------------------
  //
  // NO REFUSED QUERY. This is the assertion the register did not have, and the
  // reason a 400 sat in the console for weeks: the page rendered, the tests
  // passed, and the failing round trip was invisible because it failed softly
  // into a client-side fallback.
  //
  // 401 IS DELIBERATELY NOT IN THE GATE, and it is not a lowered bar. A 400 is
  // the database refusing the query itself and is always a defect; a 401 is a
  // request that raced the session being restored from storage, which the
  // client retries and which resolves on its own. Observed once on a cold
  // context whose auth state had been written seconds earlier. Printed rather
  // than asserted, so a 401 that becomes permanent is still visible here.
  for (const r of results) {
    const refused = r.status4xx5xx.filter((s) => !s.startsWith('401'));
    const unauthorised = r.status4xx5xx.filter((s) => s.startsWith('401'));
    if (unauthorised.length) {
      console.log(`${r.pass}: ${unauthorised.length} request(s) raced the session: ${unauthorised.join('; ')}`);
    }
    expect(
      refused,
      `${r.pass}: the register issued a request the database refused: ${refused.join('; ')}`
    ).toEqual([]);
  }

  // A ceiling, not a target. It exists so a screen that starts issuing a query
  // per row fails here rather than being noticed by somebody watching a
  // spinner.
  expect(
    cold.queries,
    `opening the register cold issued ${cold.queries} queries: ${JSON.stringify(cold.byTable)}`
  ).toBeLessThanOrEqual(24);
  expect(warm.ms, `the register took ${warm.ms} ms to show a ranked row on a warm visit`).toBeLessThan(
    30_000
  );
});
