// CAN A BRIEF BE STARTED FROM THE PROJECT PAGE, WITHOUT EDITING A URL?
//
// The composer held the chosen project in local state, so the only way to
// compose a brief for a known project was to open the composer and find it
// again in a dropdown of everything in scope. Moving the project into the URL
// is what makes the project page's action possible at all, and URL wiring is
// exactly the kind of thing that breaks silently: the page still loads, the
// composer still works, and it quietly composes for the wrong scope.
//
// So this walks the path a person walks - register, project, action - and
// asserts on what the composer is actually set to afterwards, not on the URL it
// was handed.

import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { REFERRAL_SECTION_IDS } from '../lib/report-sections';
import { walkthroughDir, walkthroughOut } from './artefacts';

test('the project page starts a referral brief for that project', async ({ page }) => {
  const out: Record<string, unknown> = {};

  // The register opens a project by selecting a row and pressing Enter, not by
  // a link, so that is what this does. Reaching the project page by URL would
  // skip the navigation and test less than it appears to.
  await page.goto('/projects', { waitUntil: 'domcontentloaded' });
  const firstRow = page.getByTestId('register-row').first();
  await expect(firstRow).toBeVisible({ timeout: 120_000 });
  const projectId = (await firstRow.getAttribute('data-row-id')) ?? '';
  expect(projectId, 'no project row on the register to start from').not.toBe('');
  await firstRow.click();
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/project\//, { timeout: 60_000 });

  const action = page.getByTestId('project-referral-brief');
  await expect(action).toBeVisible({ timeout: 60_000 });
  const projectName = (await page.locator('h1').first().textContent())?.trim();
  console.log(`project: ${projectName} (${projectId})`);
  out.project = { id: projectId, name: projectName };

  await action.click();
  await page.waitForURL(/\/reports\?/, { timeout: 60_000 });
  console.log(`landed on: ${page.url()}`);
  out.url = page.url();

  // THE COMPOSER OPENS ON THAT PROJECT. Asserted on the select's value rather
  // than on the query string, because the query string being right is not the
  // claim - the claim is that the document is scoped to this matter.
  const picker = page.getByTestId('report-project');
  await expect(picker).toBeVisible({ timeout: 120_000 });
  await expect
    .poll(async () => await picker.inputValue(), { timeout: 60_000 })
    .toBe(projectId);
  const selected = (await picker.locator('option:checked').textContent())?.trim();
  console.log(`composer project: ${selected}`);
  out.composerSelection = selected;

  // And with the referral section set rather than the market-report default.
  const sections = await page
    .locator('[data-section]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-section')));
  console.log(`sections: ${sections.join(', ')}`);
  out.sections = sections;
  // THE JULY STRUCTURE, in order. The two assessment sections are seeded even
  // though they render nothing until Philip writes commentary: their presence in
  // this list is what puts a commentary box in front of him for each.
  //
  // 'cover' USED TO BE FIRST AND WAS THE MARKET REPORT'S COVER. It printed
  // "GEOGRAPHY one project", "1 is described in full, selected by significance"
  // and a period the brief does not apply, on every referral this button
  // produced. 'referral-cover' replaces it. The conditions of approval and the
  // press are now sections of their own, and the press sits AFTER the people: it
  // was a subsection of the project block, so fifteen headlines pushed the
  // parties onto page 3 of a three-page brief.
  //
  // READ FROM REFERRAL_SECTION_IDS RATHER THAN RETYPED, and this file is why the
  // rule is worth stating. The list existed in THREE places - the section set,
  // the shots harness and here - and adding referral-coverage to the set left
  // both copies claiming seven. This one failed, which is what a test is for.
  // The other passed while photographing a brief with no coverage note, which is
  // the failure its own comment was written to prevent.
  //
  // The claim being made is that the preset seeds THE REFERRAL SET IN ITS ORDER.
  // A retyped copy cannot make that claim; it can only assert that the preset
  // matches a list somebody typed twice.
  expect(sections, 'the referral preset did not seed the section list').toEqual(
    REFERRAL_SECTION_IDS
  );
  // AND THE DOCUMENT IS NOT TITLED AS A MARKET REPORT. Same defect, one field
  // along: the title was a fixed string whatever the mode.
  await expect(page.getByTestId('report-title-input')).toHaveValue('Project Referral Brief');

  await expect
    .poll(async () => await page.getByTestId('preview-projects-count').textContent(), { timeout: 60_000 })
    .not.toContain('--');
  const count = await page.getByTestId('preview-projects-count').textContent();
  console.log(`preview: ${count}`);
  out.previewProjects = count;
  expect(count, 'a referral brief covering more than one project is not a referral brief')
    .toContain('1 projects');

  mkdirSync(walkthroughDir(), { recursive: true });
  writeFileSync(walkthroughOut('referral-audit.json'), JSON.stringify(out, null, 2));
});
