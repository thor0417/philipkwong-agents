// THE INBOX MUST DRAIN.
//
// The claim this file exists to test is one sentence: a triaged item leaves and
// the count is the honest remainder. That is the whole difference between an
// Inbox and yet another list, and it cannot be checked by reading the code -
// the count is a server-side exact count re-read after a write, so the only
// proof is to triage real records and watch the number fall by the number
// triaged.
//
// IT PUTS THE RECORDS BACK. Twenty dismissals is twenty judgements nobody made,
// and this corpus is what client documents are generated from, so the ids of
// everything dismissed here are written to inbox-drain.json and restored by
//
//     npm run inbox:restore
//
// immediately afterwards. Draining and restoring proves the mechanism exactly
// and leaves the data as it was found. Both numbers are reported.

import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

const TRIAGE = 20;

test('the inbox drains', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto('/inbox', { waitUntil: 'domcontentloaded' });

  const totalEl = page.getByTestId('inbox-total');
  await expect(totalEl).toBeVisible({ timeout: 120_000 });
  await expect
    .poll(async () => (await totalEl.textContent())?.trim(), { timeout: 120_000 })
    .not.toBe('--');
  const start = Number((await totalEl.textContent())?.replace(/[^0-9]/g, ''));
  console.log(`inbox at start: ${start}`);
  expect(start, 'the inbox is already empty, so there is nothing to drain').toBeGreaterThan(TRIAGE);

  const dismissed: string[] = [];
  for (let i = 0; i < TRIAGE; i++) {
    const card = page.getByTestId('inbox-record');
    await expect(card).toBeVisible({ timeout: 60_000 });
    const id = await card.getAttribute('data-record-id');
    expect(id, 'the record on screen has no id').toBeTruthy();
    dismissed.push(id as string);

    await page.keyboard.press('e');
    // The record on screen must CHANGE, not merely the count. A screen that
    // decrements a number while showing the same record has not triaged
    // anything.
    await expect
      .poll(
        async () => await page.getByTestId('inbox-record').getAttribute('data-record-id'),
        { timeout: 60_000 }
      )
      .not.toBe(id);
  }

  await expect
    .poll(async () => Number((await totalEl.textContent())?.replace(/[^0-9]/g, '')), {
      timeout: 120_000,
    })
    .toBe(start - TRIAGE);
  const after = Number((await totalEl.textContent())?.replace(/[^0-9]/g, ''));
  console.log(`inbox after ${TRIAGE} triaged: ${after}  (fell by ${start - after})`);

  const session = await page.getByTestId('inbox-triaged').textContent();
  console.log(`session counter: ${session?.trim()}`);

  mkdirSync('e2e/shots/walkthrough', { recursive: true });
  writeFileSync(
    'e2e/shots/walkthrough/inbox-drain.json',
    JSON.stringify({ start, after, triaged: TRIAGE, dismissed }, null, 2)
  );

  expect(new Set(dismissed).size, 'the same record was triaged twice').toBe(TRIAGE);
  expect(after, 'the count did not fall by what was triaged').toBe(start - TRIAGE);
  console.log('\nRESTORE THESE with: npm run inbox:restore');
});
