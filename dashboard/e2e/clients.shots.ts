// CLIENT INTAKE, DRIVEN THROUGH THE REAL UI.
//
// Not a fixture insert. The brief's acceptance test is that a client can be
// created through the intake form and that the scope preview shows live counts,
// and neither is demonstrated by writing a row with the service key: the form,
// the facet-backed market chips, the resolver and the preview query all have to
// work together.
//
// IDEMPOTENT BY NAME. The client is created only if it is not already there, so
// running the captures twice does not leave two Simtecs behind. Nothing is
// deleted - this project does not hard delete - so a stale test client is
// reused rather than removed.

import { test, expect } from '@playwright/test';
import path from 'node:path';

const CLIENT_NAME = 'Simtec Attractions';

test('client intake and scope preview', async ({ page }, testInfo) => {
  const mode = testInfo.project.name;
  const shot = (name: string) =>
    page.screenshot({
      path: path.join('e2e', 'shots', mode, `09-${name}.png`),
      animations: 'disabled',
      fullPage: true,
    });

  await page.goto('/clients', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('header').first()).toBeVisible({ timeout: 120_000 });
  await page.evaluate(() => document.fonts.ready);

  // WAIT FOR THE LIST TO ANSWER BEFORE DECIDING WHETHER TO CREATE.
  //
  // This is what produced eight identical Simtecs: the visibility check ran
  // while the clients query was still in flight, saw nothing, and onboarded the
  // client again on every run. Either the table or the empty-state message has
  // to be on screen before the question can be answered honestly.
  await expect(
    page.locator('[data-client-id]').first().or(page.getByText('No clients yet'))
  ).toBeVisible({ timeout: 60_000 });

  const existing = page.locator(`text=${CLIENT_NAME}`).first();
  const alreadyThere = await existing.isVisible().catch(() => false);

  if (!alreadyThere) {
    await page.getByTestId('new-client').click();
    await expect(page.getByTestId('intake-form')).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('client-name').fill(CLIENT_NAME);
    await page.getByPlaceholder('Name').first().fill('Dana Reyes');
    await page.getByPlaceholder('Email').first().fill('dana.reyes@example.com');
    await page.getByPlaceholder('Role').first().fill('Head of Development');

    // THE PREVIEW BEFORE ANY SCOPE IS CHOSEN. An empty scope is no constraint,
    // so this must show the whole pipeline rather than zero.
    await expect
      .poll(async () => await page.getByTestId('preview-projects').textContent(), { timeout: 60_000 })
      .not.toBe('--');
    const wideOpen = Number(await page.getByTestId('preview-projects').textContent());
    expect(wideOpen, 'an unconstrained scope matched nothing').toBeGreaterThan(0);

    // Narrow it: two markets and one stage. Two markets is deliberate - it is
    // the multi-value case the resolver cannot push to the server, so it
    // exercises the post-filter path and its disclosure.
    await page.locator('[data-scope-option="Clark County"]').click();
    await page.locator('[data-scope-option="Las Vegas"]').click();
    await page.locator('[data-scope-option="filed"]').click();
    await page.getByTestId('scope-watch-terms').fill('Simtec, OCVibe');

    await expect
      .poll(async () => Number(await page.getByTestId('preview-projects').textContent()), { timeout: 60_000 })
      .toBeLessThan(wideOpen);
    const narrowed = Number(await page.getByTestId('preview-projects').textContent());
    console.log(`scope preview: unconstrained ${wideOpen} -> two markets and one stage ${narrowed}`);
    expect(narrowed, 'the narrowed scope matched nothing').toBeGreaterThan(0);

    await shot('intake-scoped');
    await page.getByTestId('intake-save').click();
  }

  // The list, with the client on it.
  await expect(page.locator(`text=${CLIENT_NAME}`).first()).toBeVisible({ timeout: 60_000 });
  await shot('clients-list');

  // The detail, with the scope card and its live preview.
  await page.locator(`text=${CLIENT_NAME}`).first().click();
  await expect(page.getByTestId('scope-card')).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => await page.getByTestId('preview-projects').first().textContent(), { timeout: 60_000 })
    .not.toBe('--');
  await page.evaluate(() => document.fonts.ready);

  const projects = await page.getByTestId('preview-projects').first().textContent();
  const records = await page.getByTestId('preview-records').first().textContent();
  const fresh = await page.getByTestId('preview-new').first().textContent();
  console.log(`client detail preview: ${projects} projects, ${records} records, ${fresh} new in 30 days`);
  expect(Number(projects), 'the saved scope matches nothing').toBeGreaterThan(0);

  // THE DELIVERY HISTORY, WITH ROWS IN IT. Asserting the section is visible
  // proves only that the heading rendered; an empty history and a broken one
  // look identical from outside. This waits for actual rows and shoots the
  // section on its own, so what is being claimed is what is in the picture.
  const history = page.getByTestId('delivery-history');
  await expect(history).toBeVisible();
  await expect
    .poll(async () => await history.locator('li').count(), { timeout: 60_000 })
    .toBeGreaterThan(0);
  const rows = await history.locator('li').count();
  const first = (await history.locator('li').first().innerText()).replace(/\s+/g, ' ');
  console.log(`delivery history: ${rows} row(s). most recent: ${first}`);
  await history.scrollIntoViewIfNeeded();
  await history.screenshot({ path: path.join('e2e', 'shots', mode, '11-delivery-history.png') });
  await shot('client-detail');
});
