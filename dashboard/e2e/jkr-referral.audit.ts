// A REFERRAL BRIEF, BUILT AS THE CLIENT WE ACTUALLY SEND DOCUMENTS TO.
//
// THE HOLE THIS FILLS, AND HOW IT WAS FOUND. Every document test in this suite
// runs as Simtec Attractions - report.shots, client-scope.audit,
// report-scope.audit, scope-match.audit and clients.shots all name it, four of
// them through a CLIENT_NAME constant. One file names JKR & Associates,
// jkr-august.audit, and it selects a client and a period and never selects a
// project, so it builds a market report and stops.
//
// So no test has ever built a referral brief as JKR, and JKR is the client whose
// addressee is a real person we send briefs to. A crash shipped through 71 green
// tests because of it:
//
//   TypeError: Cannot read properties of undefined (reading 'market')
//     at placeOf (lib/report-build.ts:677)
//     at buildReport (lib/report-build.ts:817)
//
// AND IT IS NOT ABOUT THE CLIENT, which is why this test is written the way it
// is. The discriminator is the MEMBERSHIP GATE: a selected project that is not
// `included` for the selected client is filtered out of `projects`, leaving the
// array empty while projectId is still set. Simtec throws on the same project.
// JKR merely reaches it constantly - 127 of its rows are not included, 119 of
// them live with records - because the picker offers projects the gate refuses.
//
// So the test walks the picker and requires BOTH states to be reachable and
// survivable: a project the gate keeps, and a project the gate drops. It stops
// as soon as it has seen both rather than probing a fixed number of options - a
// harness that slices a list the product controls is testing its own window, and
// this suite has already paid for that once.

import { test, expect } from '@playwright/test';
import { REFERRAL_SECTION_IDS } from '../lib/report-sections';

const CLIENT_NAME = 'JKR & Associates';

test('a referral brief builds as JKR, whether or not the gate keeps the project', async ({ page }) => {
  test.setTimeout(600_000);

  await page.goto('/reports', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('report-client')).toBeVisible({ timeout: 120_000 });
  await page.getByTestId('report-client').selectOption({ label: CLIENT_NAME });
  await expect
    .poll(async () => await page.getByTestId('preview-projects-count').textContent(), { timeout: 120_000 })
    .not.toContain('--');

  const picker = page.getByTestId('report-project');
  const options = await picker.locator('option').all();
  console.log(`${CLIENT_NAME}: ${options.length - 1} projects offered by the picker`);

  let kept: { value: string; label: string } | null = null;
  let dropped: { value: string; label: string } | null = null;
  let probed = 0;

  for (const option of options.slice(1)) {
    if (kept && dropped) break;
    const value = await option.getAttribute('value');
    if (!value) continue;
    const label = ((await option.textContent()) ?? '').trim();
    probed++;
    await picker.selectOption(value);
    await expect
      .poll(async () => await page.getByTestId('preview-projects-count').textContent(), { timeout: 120_000 })
      .not.toContain('--');

    // THE CRASH GUARD, AND IT IS THE POINT OF THE FILE. Whatever the gate does,
    // the preview must not throw. This element exists only when buildReport
    // rejected.
    const failure = page.getByTestId('preview-failed');
    expect(
      await failure.count(),
      `the preview threw building ${label}: ${((await failure.textContent().catch(() => '')) ?? '').slice(0, 200)}`
    ).toBe(0);

    const projects = Number(
      ((await page.getByTestId('preview-projects-count').textContent()) ?? '').replace(/\D/g, '')
    );
    if (projects > 0 && !kept) kept = { value, label };
    if (projects === 0 && !dropped) dropped = { value, label };
  }

  console.log(`  probed ${probed} of ${options.length - 1} before both states were seen`);
  console.log(`  kept:    ${kept?.label ?? '(none found)'}`);
  console.log(`  dropped: ${dropped?.label ?? '(none found)'}`);

  expect(kept, 'no project this client has confirmed has anything to brief on').not.toBeNull();
  expect(
    dropped,
    'the picker offered no project the membership gate drops, so the state this test exists for was not reached'
  ).not.toBeNull();

  // ---- THE DROPPED ONE STILL PRODUCES A DOCUMENT, AND IT SAYS WHY -----------
  //
  // A crash is not the worst failure available here. A document that builds and
  // says "Nothing else was withheld" over a matter the gate removed is worse,
  // because it is wrong rather than absent. So the assertion is on the sentence,
  // not merely on the absence of the error.
  await picker.selectOption(dropped!.value);
  await expect
    .poll(async () => await page.getByTestId('preview-projects-count').textContent(), { timeout: 120_000 })
    .not.toContain('--');
  for (const id of ['cover', 'moved', 'headlines', 'categories', 'hearings', 'watchlist', 'coverage']) {
    const remove = page.locator(`[data-section="${id}"] button`);
    if (await remove.count()) await remove.click();
  }
  for (const id of REFERRAL_SECTION_IDS) {
    const add = page.locator(`[data-add-section="${id}"]`);
    if (await add.count()) await add.click();
  }
  await expect
    .poll(async () => await page.getByTestId('preview-projects-count').textContent(), { timeout: 120_000 })
    .not.toContain('--');
  expect(await page.getByTestId('preview-failed').count(), 'the referral section set threw').toBe(0);

  const body = ((await page.getByTestId('report-preview').textContent()) ?? '').replace(/\s+/g, ' ');
  expect(
    body,
    'the brief withheld the whole matter and did not say so'
  ).toContain('not been confirmed as part of');
  console.log('  withheld brief states the membership reason');

  // ---- AND THE KEPT ONE IS A REAL BRIEF -------------------------------------
  await picker.selectOption(kept!.value);
  await expect
    .poll(async () => await page.getByTestId('preview-projects-count').textContent(), { timeout: 120_000 })
    .not.toContain('--');
  expect(await page.getByTestId('preview-failed').count(), 'the kept project threw').toBe(0);
  await expect(page.getByTestId('report-preview')).toBeVisible({ timeout: 120_000 });
  const records = Number(
    ((await page.getByTestId('preview-records-count').textContent()) ?? '').replace(/\D/g, '')
  );
  console.log(`  kept brief: ${records} records`);
});
