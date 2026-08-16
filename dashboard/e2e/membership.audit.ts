// THE MEMBERSHIP GATE, END TO END.
//
// Migration 033 is applied, so buildReport keeps only projects marked
// `included` for a client. For weeks that meant every client document covered 0
// projects however wide the scope, because `proposeProjects` existed with
// nothing calling it and no screen could confirm anything. A gate with no door
// is not a gate.
//
// This walks the whole path on the real UI and the real database:
//
//   1. Opening a client PROPOSES. The scope resolves, the axes that matched are
//      recorded with each row, and nothing is overwritten on a second open.
//   2. C CONFIRMS and X EXCLUDES, from the row and from the pane, and pressing
//      the same one again returns the project to `proposed`. Every direction is
//      a write; nothing is deleted.
//   3. The client bar states the three counts and what they mean for the
//      document.
//
// IT LEAVES THE DATABASE AS IT FOUND IT. Every project it touches is put back
// to `proposed` at the end, including on failure, because a confirmation this
// audit invented is a project in a client's document that nobody chose.

import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const VIEWPORT = { width: 1920, height: 1080 };

type Page = import('@playwright/test').Page;

async function openClientView(page: Page): Promise<{ id: string; name: string }> {
  await page.setViewportSize(VIEWPORT);
  await page.goto('/projects', { waitUntil: 'domcontentloaded' });
  const client = page.locator('[data-client-view]').last();
  await expect(client, 'the rail offers no client view to open').toBeVisible({ timeout: 120_000 });
  const id = (await client.getAttribute('data-client-view')) ?? '';
  const name = ((await client.textContent()) ?? '').replace(/client$/i, '').trim();
  await client.click();
  await expect(page.getByTestId('client-scope-bar')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-row-id]').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  return { id, name };
}

/** The bar's three counts, read off the text rather than off the database. */
async function counts(page: Page): Promise<{ proposed: number; included: number; excluded: number }> {
  const text = ((await page.getByTestId('client-counts').textContent()) ?? '').replace(/\s+/g, ' ');
  const n = (label: string) => Number(new RegExp(`(\\d+) ${label}`).exec(text)?.[1] ?? '-1');
  return { proposed: n('proposed'), included: n('confirmed'), excluded: n('excluded') };
}

test('opening a client proposes, and the register can confirm', async ({ page }) => {
  test.setTimeout(600_000);
  const touched: string[] = [];
  const out: Record<string, unknown> = {};

  try {
    // ---- 1. OPENING PROPOSES. ---------------------------------------------
    const client = await openClientView(page);
    const rows = await page
      .locator('[data-row-id]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-row-id') ?? ''));
    const first = await counts(page);
    console.log(`${client.name}: ${rows.length} rows on the page`);
    console.log(
      `  after opening: ${first.proposed} proposed, ${first.included} confirmed, ${first.excluded} excluded`
    );
    out.afterOpening = first;

    expect(
      first.proposed + first.included + first.excluded,
      'opening the client proposed nothing, so the scope never reached the membership table'
    ).toBeGreaterThan(0);

    // EVERY ROW ON THE PAGE HAS A MEMBERSHIP ROW BEHIND IT. A proposal that
    // covers some of the list is worse than none: the gap is invisible and the
    // document is short by exactly the projects nobody was asked about.
    expect(
      first.proposed + first.included + first.excluded,
      'the membership table holds fewer rows than the client view lists'
    ).toBeGreaterThanOrEqual(rows.length);

    // ---- 2. A SECOND OPEN CHANGES NOTHING. --------------------------------
    //
    // proposeProjects runs on every open, which is only safe because it cannot
    // overwrite a decision. If this drifts, an excluded project silently
    // returns to the document the next time somebody opens the client.
    await openClientView(page);
    const second = await counts(page);
    console.log(
      `  after a second open: ${second.proposed} proposed, ${second.included} confirmed, ${second.excluded} excluded`
    );
    expect(second, 'opening the client a second time changed the membership').toEqual(first);

    // ---- 3. C CONFIRMS. ---------------------------------------------------
    const target = rows[0];
    touched.push(target);
    await page.locator(`[data-row-id="${target}"]`).click();
    await page.keyboard.press('c');
    await expect(
      page.locator(`[data-row-id="${target}"] [data-membership="included"]`),
      'C did not mark the row confirmed'
    ).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => (await counts(page)).included, { timeout: 30_000 })
      .toBe(first.included + 1);
    console.log(`  C on ${target} -> confirmed`);

    // The pane agrees with the row, because they read one map rather than two.
    await expect(page.getByTestId('detail-membership-state')).toContainText('Confirmed', {
      timeout: 30_000,
    });

    // ---- 4. C AGAIN IS THE WAY BACK. --------------------------------------
    await page.keyboard.press('c');
    await expect
      .poll(async () => (await counts(page)).included, { timeout: 30_000 })
      .toBe(first.included);
    console.log(`  C again -> back to proposed`);

    // ---- 5. X EXCLUDES, AND FROM THE PANE TOO. ----------------------------
    await page.keyboard.press('x');
    await expect(
      page.locator(`[data-row-id="${target}"] [data-membership="excluded"]`),
      'X did not mark the row excluded'
    ).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => (await counts(page)).excluded, { timeout: 30_000 })
      .toBe(first.excluded + 1);
    console.log(`  X on ${target} -> excluded`);

    await page.getByTestId('detail-confirm').click();
    await expect
      .poll(async () => (await counts(page)).included, { timeout: 30_000 })
      .toBe(first.included + 1);
    console.log(`  Confirm in the pane -> confirmed, from excluded, without a delete`);

    // ---- 6. THE BAR SAYS WHAT IT MEANS FOR THE DOCUMENT. ------------------
    const line = ((await page.getByTestId('client-document-line').textContent()) ?? '').trim();
    console.log(`  the bar says: ${line}`);
    out.documentLine = line;
    expect(line, 'the client bar does not say what the confirmed set means').toMatch(
      /document would cover \d+ of the \d+ confirmed/
    );

    mkdirSync('e2e/shots/walkthrough', { recursive: true });
    writeFileSync('e2e/shots/walkthrough/membership-audit.json', JSON.stringify(out, null, 2));
  } finally {
    // ---- PUT IT BACK. ------------------------------------------------------
    //
    // In a finally, so a failed assertion above does not leave a project
    // confirmed for a paying client because a test said so.
    for (const id of touched) {
      await page.locator(`[data-row-id="${id}"]`).click().catch(() => {});
      const state = await page
        .getByTestId('detail-membership-state')
        .textContent()
        .catch(() => '');
      if (/^Confirmed/.test((state ?? '').trim())) {
        await page.getByTestId('detail-confirm').click().catch(() => {});
      } else if (/^Excluded/.test((state ?? '').trim())) {
        await page.getByTestId('detail-exclude').click().catch(() => {});
      }
      // POLL, DO NOT WAIT AND READ. A fixed pause followed by one read is the
      // stale-result defect this brief spent a part on: the first run of this
      // block printed "Confirmed. This project will appear in their document"
      // for a row the database had already put back to proposed, because the
      // read beat the invalidation. A cleanup that reports its own success
      // wrongly is worse than one that does not report at all.
      await expect
        .poll(
          async () =>
            ((await page.getByTestId('detail-membership-state').textContent().catch(() => '')) ?? '')
              .trim()
              .slice(0, 8),
          { timeout: 30_000 }
        )
        .toBe('Proposed');
      console.log(`  restored ${id}: back to proposed`);
    }
  }
});
