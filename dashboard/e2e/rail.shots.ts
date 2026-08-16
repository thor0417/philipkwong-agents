// THE RAIL, AT 1920x1080, LIGHT AND DARK.
//
// The navigation is the deliverable of this brief, so it is photographed at the
// size it is used at and in both modes - capturing only light would mean the
// dark palette shipped unlooked-at, which is the retrofit the design system was
// written to avoid.
//
// IT ALSO MEASURES, because a picture proves nothing on its own and nobody looks
// at a passing test. Two numbers:
//
//   1. THE RAIL'S OWN CONTENTS. Five primary destinations, Records gone, and no
//      entry pointing at a route that does not exist.
//   2. HOW MANY DECISIONS SIT ABOVE THE FIRST RANKED ROW. Part 1's seventh
//      defect is not fixed in this brief - it is Brief M's target - so it is
//      MEASURED here and printed, which is what makes it a target rather than
//      an impression.

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const VIEWPORT = { width: 1920, height: 1080 };

test('the rail', async ({ page }, testInfo) => {
  const mode = testInfo.project.name; // 'light' | 'dark'
  test.setTimeout(300_000);
  await page.setViewportSize(VIEWPORT);
  await page.goto('/projects', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-row-id]').first()).toBeVisible({ timeout: 120_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(2500);

  mkdirSync(path.join('e2e', 'shots', mode), { recursive: true });
  await page.screenshot({
    path: path.join('e2e', 'shots', mode, '05-rail-1920x1080.png'),
    animations: 'disabled',
  });

  // ---- 1. WHAT THE RAIL OFFERS -------------------------------------------
  const nav = await page.locator('nav a').evaluateAll((els) =>
    els.map((e) => ({
      label: (e.textContent ?? '').trim(),
      href: e.getAttribute('href') ?? '',
    }))
  );
  console.log(`[${mode}] rail: ${nav.map((n) => n.label).join(' | ')}`);

  const hrefs = nav.map((n) => n.href);
  expect(hrefs, 'Records is still a destination').not.toContain('/records');
  for (const want of ['/today', '/projects', '/clients', '/players', '/reports']) {
    expect(hrefs, `the rail has no ${want}`).toContain(want);
  }
  for (const want of ['/inbox', '/health']) {
    expect(hrefs, `the rail has no ${want}`).toContain(want);
  }

  // Every rail entry must lead somewhere. A greyed-out row for a screen that
  // does not exist is a promise the product has not kept.
  for (const n of nav) {
    const res = await page.request.get(n.href);
    expect(res.status(), `${n.label} -> ${n.href} answered ${res.status()}`).toBeLessThan(400);
  }

  // ---- 2. DECISIONS ABOVE THE FIRST RANKED ROW ---------------------------
  //
  // Counted as CONTROLS a person has to read and skip past, not as pixels: every
  // interactive element that sits above the top of the first project row, plus
  // the rail's own, which is a column the eye crosses on the way in.
  //
  // BROKEN DOWN BY ZONE, because the total on its own cannot be acted on. Brief
  // L printed 47 and the honest next question was "47 of what" - the rail is a
  // column the operator learned once and stopped reading, and the filter block
  // above the list is read on every visit. Those are not the same cost, and a
  // single number let the cheap half hide behind the expensive one.
  //
  // ROWS PER VIEWPORT IS THE OTHER HALF OF THE SAME MEASUREMENT. Pushing the
  // first row up is only worth something if rows arrive in the space it frees,
  // so the harness counts how many whole rows the scroll container can show
  // without being scrolled.
  const measured = await page.evaluate(() => {
    const firstRow = document.querySelector('[data-testid="register-row"]');
    const top = firstRow?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY;
    const controls = [...document.querySelectorAll('button, input, select, a')].filter((el) => {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top < top;
    });
    const zoneOf = (el: Element): string => {
      if (el.closest('nav[aria-label="Primary"]')) return 'rail';
      if (el.closest('header')) return 'topbar';
      return 'screen';
    };
    const byZone: Record<string, number> = {};
    for (const el of controls) byZone[zoneOf(el)] = (byZone[zoneOf(el)] ?? 0) + 1;
    const rows = new Set(
      controls.map((el) => Math.round(el.getBoundingClientRect().top / 8) * 8)
    );
    // The screen's own rows only. The rail is a column, not a stack of rows the
    // list has to start below, so counting its entries as "rows above the first
    // result" overstates the vertical cost by the height of the rail.
    const screenRows = new Set(
      controls
        .filter((el) => zoneOf(el) === 'screen')
        .map((el) => Math.round(el.getBoundingClientRect().top / 8) * 8)
    );

    const scroller = document.querySelector('[data-testid="register-scroll"]');
    const rowEl = firstRow as HTMLElement | null;
    const rowH = rowEl?.getBoundingClientRect().height ?? 0;
    const head = document.querySelector('[data-testid="register-head-row"]');
    const headH = head?.getBoundingClientRect().height ?? 0;
    const visibleH = scroller ? scroller.getBoundingClientRect().height - headH : 0;
    const rowsPerViewport = rowH > 0 ? Math.floor(visibleH / rowH) : 0;

    return {
      firstRowTop: Math.round(top),
      controls: controls.length,
      rows: rows.size,
      screenControls: byZone.screen ?? 0,
      railControls: byZone.rail ?? 0,
      topbarControls: byZone.topbar ?? 0,
      screenRows: screenRows.size,
      rowHeight: Math.round(rowH),
      rowsPerViewport,
    };
  });

  console.log(
    `[${mode}] first ranked row at y=${measured.firstRowTop} of ${VIEWPORT.height}. ` +
      `${measured.controls} controls above it, on ${measured.rows} distinct rows.`
  );
  console.log(
    `[${mode}]   of those: ${measured.screenControls} on the screen itself ` +
      `(${measured.screenRows} rows), ${measured.railControls} in the rail, ` +
      `${measured.topbarControls} in the top bar.`
  );
  console.log(
    `[${mode}]   row height ${measured.rowHeight}px, ` +
      `${measured.rowsPerViewport} whole rows visible without scrolling.`
  );

  if (mode === 'light') {
    mkdirSync('e2e/shots/walkthrough', { recursive: true });
    writeFileSync(
      'e2e/shots/walkthrough/rail-measure.json',
      JSON.stringify({ nav, ...measured }, null, 2)
    );
  }

  // NOT ASSERTED, DELIBERATELY. This brief moves the navigation; layout and
  // density are Brief M. Printing it without a threshold is the honest state:
  // the number is the target, and inventing a limit here would fail the run on
  // work nobody has been asked to do yet.
});
