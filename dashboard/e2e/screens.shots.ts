// THE CAPTURE RUN.
//
// One entry per screen. Each part of the dashboard rebuild adds its route here,
// and every route is captured in both light and dark by the two Playwright
// projects. Output lands in e2e/shots/<mode>/<name>.png, which is gitignored:
// these are proof, regenerated on demand, not source.
//
// Run with:  npm run shots

import { test, expect } from '@playwright/test';
import path from 'node:path';

type Screen = {
  name: string;
  path: string;
  // Something that must be on the page before the shutter opens. Without this
  // the capture races Next's dev compile and photographs a spinner.
  ready: string;
  fullPage?: boolean;
  // Ceiling on visible accent-coloured elements. The design rule is that the
  // accent marks the single most important thing in a view, so a product screen
  // gets a small number and exceeding it fails the run. The catalogue at /design
  // is the stated exception: it has to show every accent state side by side.
  accentBudget?: number;
};

const SCREENS: Screen[] = [
  {
    name: '01-design-system',
    path: '/design',
    ready: 'text=Design system',
    fullPage: true,
    accentBudget: Infinity,
  },
  // Today reads top to bottom, so it is captured full-page: cropping it at the
  // fold would hide exactly the sections the screen is judged on.
  {
    name: '03-today',
    path: '/today',
    ready: 'h1',
    fullPage: true,
    // Measured at 1: the active nav item, and nothing else. Accenting every
    // project name put this at 23, which is a page with no emphasis at all.
    // Held at 3 so a future section cannot quietly reintroduce the flood.
    accentBudget: 3,
  },
  // The Register: rail, list, detail. Not fullPage, because the shell owns the
  // viewport and each pane scrolls inside it, so a full-page capture would just
  // be the same 900px.
  {
    name: '02-register',
    path: '/register',
    ready: 'header',
    // The active nav item, the selected stage chip, the active rail view, and
    // the selected row's edge. Anything above this is a flood.
    accentBudget: 8,
  },
  // The record table, moved from /register. Still the pre-rebuild screen, so
  // its accent debt is unchanged and held where it was measured.
  {
    name: '04-records',
    path: '/records',
    ready: 'header',
    // A RATCHET ON KNOWN DEBT, not an approval. This screen is the pre-rebuild
    // Register: every "active" state in it (filter chips, geo chips, delta
    // buttons, triage views, tab counts) paints the accent, which is exactly
    // the incoherence Part 4 exists to fix. The number is set to what is there
    // today so the run is honest and so it cannot get WORSE while Part 4 is
    // pending. Part 4 must bring it to single digits.
    accentBudget: 38,
  },
];

for (const screen of SCREENS) {
  test(screen.name, async ({ page }, testInfo) => {
    const mode = testInfo.project.name; // 'light' | 'dark'

    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => consoleErrors.push(String(e)));

    await page.goto(screen.path, { waitUntil: 'domcontentloaded' });
    await expect(page.locator(screen.ready).first()).toBeVisible({ timeout: 60_000 });

    // Web fonts are the whole point of the type system; capturing before they
    // resolve photographs the Georgia fallback and proves nothing.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState('networkidle').catch(() => {});

    // Prove the licensed faces actually rendered rather than silently falling
    // back. A screenshot cannot tell the difference; this can.
    const fontsLoaded = await page.evaluate(() =>
      ['PP Neue York Display', 'PP Neue York'].every((f) =>
        document.fonts.check(`16px "${f}"`)
      )
    );
    expect(fontsLoaded, 'PP Neue York did not load; the page is in fallback serif').toBe(true);

    // THE ACCENT BUDGET, ENFORCED. Counts visible elements painting the accent
    // as text or fill. Reads the token from the document rather than a literal,
    // so it follows the palette into dark mode where the accent is a different
    // colour. This is the one design rule that can be checked mechanically, and
    // it is the one most easily lost as screens grow.
    const accent = await page.evaluate(() => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      // Resolve the token to the rgb() form getComputedStyle returns.
      const probe = document.createElement('span');
      probe.style.color = raw;
      document.body.appendChild(probe);
      const target = getComputedStyle(probe).color;
      probe.remove();

      const hits: string[] = [];
      const counted = new Set<Element>();
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        const paintsText = cs.color === target && (el.textContent ?? '').trim().length > 0;
        const paintsFill = cs.backgroundColor === target;
        if (!paintsText && !paintsFill) continue;

        // Count what a person SEES, not what the DOM contains. An accented nav
        // item is one mark even though it is a link wrapping two spans that
        // both inherit the colour; counting nodes would make every component
        // look like a violation in proportion to how carefully it was built.
        let inherited = false;
        for (let p = el.parentElement; p; p = p.parentElement) {
          if (counted.has(p)) {
            inherited = true;
            break;
          }
        }
        counted.add(el);
        if (inherited) continue;
        hits.push(`${el.tagName.toLowerCase()}.${el.className}`.slice(0, 60));
      }
      return { target, count: hits.length, sample: hits.slice(0, 12) };
    });

    console.log(`  [${mode}] ${screen.name}: accent ${accent.target} on ${accent.count} elements`);
    const budget = screen.accentBudget ?? 3;
    if (accent.count > budget) {
      console.log(`    over budget (${budget}). first offenders: ${accent.sample.join(', ')}`);
    }
    expect(
      accent.count,
      `Accent used on ${accent.count} elements, budget ${budget}. ` +
        `The accent marks the single most important thing in a view. Offenders: ${accent.sample.join(', ')}`
    ).toBeLessThanOrEqual(budget);

    await page.screenshot({
      path: path.join('e2e', 'shots', mode, `${screen.name}.png`),
      fullPage: screen.fullPage ?? false,
      animations: 'disabled',
    });

    // Console errors are not fatal to a screenshot, but they should never be
    // invisible either.
    if (consoleErrors.length) {
      console.log(`  [${mode}] ${screen.name} console errors:`);
      for (const e of consoleErrors.slice(0, 5)) console.log(`    ${e}`);
    }
  });
}
