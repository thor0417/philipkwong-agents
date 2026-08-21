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
  // ---- POLL, DO NOT WAIT AND READ -------------------------------------------
  //
  // This was `waitForTimeout(2500)`, which is the fixed-pause-then-read defect
  // this same file names forty lines further down and fixes in its revert loop.
  // The scope bar appears as soon as the client is open; the ROW LIST is a
  // separate query and is still showing the PREVIOUS view's rows until it
  // settles. The caller's first act is to count [data-row-id].
  //
  // MEASURED. Run alone this audit reads 45 rows and passes in 38s. Run in
  // sequence behind the other walkthrough audits - one worker, one browser, a
  // loaded machine - it read FIFTY, which is exactly the register's page size:
  // the unscoped list it was still showing. The membership counts were identical
  // in both (31 proposed, 5 confirmed, 10 excluded = 46), so 46 >= 50 failed and
  // the push was refused on a harness race rather than on anything in the tree.
  //
  // Same family as the referral preview: a fixed pause is a bet on how long
  // something takes, and it is a bet the suite loses under load. The list is
  // polled until two consecutive reads agree instead, which is a statement about
  // the list having stopped changing rather than a guess about the clock.
  let previous = -1;
  await expect
    .poll(
      async () => {
        const n = await page.locator('[data-row-id]').count();
        const settled = n > 0 && n === previous;
        previous = n;
        return settled;
      },
      { timeout: 120_000, intervals: [500] }
    )
    .toBe(true);
  return { id, name };
}

/**
 * ONE ROW'S MEMBERSHIP, READ OFF THE REGISTER. A proposed row renders no mark at
 * all - only a decision shows - so the absence of the mark is the third state.
 *
 * ONE DOM READ, AND THAT IS THE WHOLE POINT. This used to COUNT the mark and
 * then READ its attribute:
 *
 *     if ((await mark.count()) === 0) return 'proposed';
 *     const v = await mark.first().getAttribute('data-membership');
 *
 * which is a check-then-use across a re-render, and it turned the full suite red
 * at random. count() said 1; the register re-rendered underneath - the client
 * view calls proposeProjects on open AND on window focus, and eleven queries are
 * settling - and getAttribute then waited out its ENTIRE 15s action timeout on
 * an element that had legitimately gone. Run alone this file passes; it failed
 * once in a full run and passed the next, which is the signature.
 *
 * ABSENCE IS A REAL STATE HERE, so a read that BLOCKS ON PRESENCE turns the
 * third state into a failure. That is what made the old shape wrong rather than
 * merely racy: waiting for the mark to come back is waiting for a thing that
 * correctly is not there. evaluateAll resolves against whatever is in the DOM at
 * that instant and returns [] rather than waiting, so this cannot block and
 * cannot throw - which is why no caller needs a .catch() around it any more, and
 * three of them used to have one while the fourth, the one that failed, did not.
 *
 * The row's own presence is the CALLER's precondition, not this function's: a
 * row that has not rendered is not "proposed", and the one caller that reads a
 * state cold asserts the row first rather than letting absence answer for it.
 */
async function memberState(
  page: Page,
  id: string
): Promise<'proposed' | 'included' | 'excluded'> {
  const marks = await page
    .locator(`[data-row-id="${id}"] [data-membership]`)
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-membership')));
  const v = marks[0];
  return v === 'included' || v === 'excluded' ? v : 'proposed';
}

/** The bar's three counts, read off the text rather than off the database. */
async function counts(page: Page): Promise<{ proposed: number; included: number; excluded: number }> {
  const text = ((await page.getByTestId('client-counts').textContent()) ?? '').replace(/\s+/g, ' ');
  const n = (label: string) => Number(new RegExp(`(\\d+) ${label}`).exec(text)?.[1] ?? '-1');
  return { proposed: n('proposed'), included: n('confirmed'), excluded: n('excluded') };
}

test('opening a client proposes, and the register can confirm', async ({ page }) => {
  test.setTimeout(600_000);
  const touched: { id: string; was: 'proposed' | 'included' | 'excluded' }[] = [];
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
    //
    // REMEMBER THE STARTING STATE AND PUT IT BACK, rather than assuming one.
    //
    // This test took rows[0] and asserted C raised the confirmed count by one.
    // That held for as long as the membership table held no decisions, and it
    // stopped holding the day Simtec's were made: the first row WAS one of the
    // confirmed five, C correctly toggled it back to proposed, the count went
    // 5 -> 4, and the test failed.
    //
    // WORSE THAN A FAILING TEST, IT CHANGED A REAL DECISION. The cleanup below
    // restored every touched row to Proposed - right when the row began
    // proposed, wrong when it did not - so the run left Heart Hotel, a project
    // confirmed for a paying client, sitting at proposed.
    //
    // Choosing an undecided row instead is not enough either: Simtec's fifteen
    // are now all decided, so there would be none to choose. The only rule that
    // holds whatever the table contains is to read the row's state, work from
    // it, and restore it exactly.
    const target = rows[0];
    // THE ROW BEFORE ITS STATE. memberState reads the DOM as it stands and
    // reports "proposed" when no mark is there, which is right for a proposed
    // row and wrong for a row that has not rendered. The two are the same shape
    // and opposite meanings, and this is the one place a state is read cold, so
    // the row is asserted rather than assumed.
    await expect(page.locator(`[data-row-id="${target}"]`)).toHaveCount(1, { timeout: 30_000 });
    const startState = await memberState(page, target);
    touched.push({ id: target, was: startState });
    console.log(`  target ${target} starts ${startState}`);

    // Normalise to proposed so the assertions below can be written as deltas.
    // Every step is itself a write the register performs, so nothing is skipped
    // by doing this - it is the same C and X the test is here to exercise.
    if (startState !== 'proposed') {
      await page.locator(`[data-row-id="${target}"]`).click();
      await page.keyboard.press(startState === 'included' ? 'c' : 'x');
      await expect
        .poll(async () => memberState(page, target), { timeout: 30_000 })
        .toBe('proposed');
      console.log(`  normalised ${target} to proposed for the run`);
    }
    // The baseline the deltas are measured from, AFTER normalising.
    const base = await counts(page);

    await page.locator(`[data-row-id="${target}"]`).click();
    await page.keyboard.press('c');
    await expect(
      page.locator(`[data-row-id="${target}"] [data-membership="included"]`),
      'C did not mark the row confirmed'
    ).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => (await counts(page)).included, { timeout: 30_000 })
      .toBe(base.included + 1);
    console.log(`  C on ${target} -> confirmed`);

    // The pane agrees with the row, because they read one map rather than two.
    await expect(page.getByTestId('detail-membership-state')).toContainText('Confirmed', {
      timeout: 30_000,
    });

    // ---- 4. C AGAIN IS THE WAY BACK. --------------------------------------
    await page.keyboard.press('c');
    await expect
      .poll(async () => (await counts(page)).included, { timeout: 30_000 })
      .toBe(base.included);
    console.log(`  C again -> back to proposed`);

    // ---- 5. X EXCLUDES, AND FROM THE PANE TOO. ----------------------------
    await page.keyboard.press('x');
    await expect(
      page.locator(`[data-row-id="${target}"] [data-membership="excluded"]`),
      'X did not mark the row excluded'
    ).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => (await counts(page)).excluded, { timeout: 30_000 })
      .toBe(base.excluded + 1);
    console.log(`  X on ${target} -> excluded`);

    await page.getByTestId('detail-confirm').click();
    await expect
      .poll(async () => (await counts(page)).included, { timeout: 30_000 })
      .toBe(base.included + 1);
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
    //
    // RESTORED TO WHAT IT WAS, not to a hardcoded Proposed. The old version
    // always drove the row to Proposed, which silently un-confirmed Heart Hotel
    // the first time this test ran against a client whose membership had been
    // decided. The starting state is captured above and put back here.
    for (const { id, was } of touched) {
      await page.locator(`[data-row-id="${id}"]`).click().catch(() => {});
      for (let attempt = 0; attempt < 4; attempt++) {
        const now = await memberState(page, id);
        if (now === was) break;
        // C and X are each their own way back, so one press moves one step:
        // whatever the row currently is, press the key that leaves it at `was`.
        if (now === 'included') await page.keyboard.press('c').catch(() => {});
        else if (now === 'excluded') await page.keyboard.press('x').catch(() => {});
        else await page.keyboard.press(was === 'included' ? 'c' : 'x').catch(() => {});
        // POLL, DO NOT WAIT AND READ. A fixed pause followed by one read is the
        // stale-result defect this brief spent a part on: the first run of this
        // block reported success for a row the database had already changed,
        // because the read beat the invalidation. A cleanup that reports its own
        // success wrongly is worse than one that does not report at all.
        await expect
          .poll(async () => memberState(page, id), { timeout: 15_000 })
          .not.toBe(now);
      }
      const final = await memberState(page, id);
      expect(final, `cleanup left ${id} at ${final}, not the ${was} it started as`).toBe(was);
      console.log(`  restored ${id}: back to ${was}`);
    }
  }
});
