// THE SCREEN AUDIT. Every route, visited, with the console and the network
// watched.
//
// Read only: it clicks nothing that writes. The point is to find what is broken
// before a demo, not to exercise the write paths the shot harnesses already do.
//
// A screen "renders" here if its own primary content appears. A screen that
// paints its chrome and then shows nothing is a screen that looks fine in a
// screenshot and is empty in front of a client, so each entry names the selector
// that has to be present.

import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

interface ScreenResult {
  name: string;
  url: string;
  ok: boolean;
  primary: string;
  rows: number | null;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  notes: string[];
}

// THE PRIMARY SELECTOR IS PER SCREEN AND `h1` WAS A COPY-PASTE DEFAULT.
//
// Three screens were reported as "does not render", each after waiting the full
// twenty seconds: Records, Legacy pipeline and Legacy GLI. All three render
// correctly in a browser. None of the three contains an `<h1>`.
//
// Records and /pipeline put their identity in the shell's top bar rather than in
// a page heading, and /gli is a redirect INTO /records, so it inherited the same
// missing element. The audit was therefore not measuring the screens at all: it
// was waiting for a tag that has never existed on them, and reporting its own
// wrong question as their failure. Three FAILED lines that named nothing real
// are worse than no audit, because they train the reader to skip the output.
//
// Every entry below now names the screen's OWN primary content - the thing that
// has to be on the page for the screen to be doing its job - and no entry uses a
// selector the screen does not actually contain.
const SCREENS: { name: string; url: string; primary: string; rowSel?: string }[] = [
  { name: 'Today', url: '/today', primary: 'h1', rowSel: 'li' },
  { name: 'Register', url: '/register', primary: '[data-testid="pager-total"]', rowSel: '[data-row-id]' },
  // The record table itself. It renders its own empty row when a filter matches
  // nothing, so this asserts the table exists without asserting the corpus does.
  { name: 'Records', url: '/records', primary: '[data-testid="records-pager-total"]', rowSel: 'tbody tr' },
  { name: 'Reports', url: '/reports', primary: '[data-testid="report-client"]', rowSel: '[data-section]' },
  { name: 'Clients', url: '/clients', primary: 'h1', rowSel: '[data-client-id]' },
  { name: 'Design system', url: '/design', primary: 'h1', rowSel: 'section' },
  // The retired lanes. Its body renders only once the session check and the load
  // have both finished, which is exactly the condition worth probing.
  { name: 'Legacy pipeline', url: '/pipeline', primary: '[data-testid="pipeline-body"]', rowSel: '[data-lead-id]' },
  // /gli is a redirect into /records and has been since the rename, so it is
  // audited on what it lands on rather than on what it used to be.
  { name: 'Legacy GLI', url: '/gli', primary: '[data-testid="records-pager-total"]', rowSel: 'tbody tr' },
  { name: 'Projects (legacy route)', url: '/projects', primary: '[data-testid="pager-total"]', rowSel: '[data-row-id]' },
];

test('every screen renders', async ({ page }) => {
  // Nine screens plus two detail routes, each with its own network round trips.
  test.setTimeout(600_000);
  const results: ScreenResult[] = [];

  for (const s of SCREENS) {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    const notes: string[] = [];

    const onConsole = (m: import('@playwright/test').ConsoleMessage) => {
      if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
    };
    const onPageError = (e: Error) => pageErrors.push(String(e.message).slice(0, 200));
    const onResponse = (r: import('@playwright/test').Response) => {
      if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url().slice(0, 150)}`);
    };
    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    page.on('response', onResponse);

    let ok = true;
    let rows: number | null = null;
    try {
      await page.goto(s.url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      // 20s, not 60: a screen that has not painted its primary content in twenty
      // seconds is a finding, and three of those must not exhaust the run.
      await expect(page.locator(s.primary).first()).toBeVisible({ timeout: 20_000 });
      // Give the client-side queries a chance to answer before counting rows;
      // a count taken during the fetch reports every screen as empty.
      await page.waitForTimeout(2500);
      if (s.rowSel) rows = await page.locator(s.rowSel).count();
      const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
      for (const marker of ['Loading...', 'unreadable', 'failed', 'Application error', 'undefined']) {
        if (bodyText.includes(marker)) notes.push(`body contains "${marker}"`);
      }
      if (rows === 0) notes.push('primary list rendered zero rows');
    } catch (e) {
      ok = false;
      notes.push(`did not render: ${String(e).slice(0, 160)}`);
    }

    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    page.off('response', onResponse);

    results.push({ name: s.name, url: s.url, ok, primary: s.primary, rows, consoleErrors, pageErrors, failedRequests, notes });

    console.log(
      `${s.name.padEnd(24)} ${ok ? 'RENDERS' : 'FAILED '} rows=${String(rows ?? '-').padStart(4)}  ` +
        `console=${consoleErrors.length} pageerr=${pageErrors.length} http4xx5xx=${failedRequests.length}` +
        (notes.length ? `  | ${notes.join('; ')}` : '')
    );
    for (const e of consoleErrors.slice(0, 3)) console.log(`      console: ${e}`);
    for (const e of pageErrors.slice(0, 3)) console.log(`      pageerror: ${e}`);
    for (const e of failedRequests.slice(0, 4)) console.log(`      http: ${e}`);
  }

  // The detail routes need an id, taken from the live data rather than hardcoded.
  await page.goto('/register?country=any', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-row-id]').first()).toBeVisible({ timeout: 30_000 });
  const projectId = await page.locator('[data-row-id]').first().getAttribute('data-row-id');

  for (const [name, url, primary] of [
    ['Project detail', `/project/${projectId}`, 'h1'],
    ['Clients detail', '/clients', 'h1'],
  ] as const) {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 200)));
    page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    // WAIT FOR THE HEADING, THEN JUDGE IT. isVisible() samples the DOM at the
    // instant domcontentloaded fires, which is before the client component has
    // rendered anything, and the 2500ms wait that followed came too late to
    // help. Both of these screens were reported FAILED while rendering
    // correctly in the browser.
    const visible = await page
      .locator(primary)
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    console.log(`${name.padEnd(24)} ${visible ? 'RENDERS' : 'FAILED '} console=${consoleErrors.length} pageerr=${pageErrors.length}`);
    for (const e of [...consoleErrors, ...pageErrors].slice(0, 3)) console.log(`      ${e}`);
    results.push({ name, url, ok: visible, primary, rows: null, consoleErrors, pageErrors, failedRequests: [], notes: [] });
  }

  mkdirSync('e2e/shots/walkthrough', { recursive: true });
  writeFileSync('e2e/shots/walkthrough/screens-audit.json', JSON.stringify(results, null, 2));
});
