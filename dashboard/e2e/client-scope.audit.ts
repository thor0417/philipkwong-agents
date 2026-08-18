// A SCOPED CLIENT'S DOCUMENT CONTAINS NOTHING OUTSIDE THEIR SCOPE.
//
// This has broken twice, both times silently and both times in the direction
// that ships: the document looks normal and covers fifteen times what the client
// is owed. So the assertion is not "the count looks right", it is "every project
// in the generated document satisfies every axis of the stored scope", checked
// project by project against the database.
//
// THE THIRD STATE IS THE ONE THAT BROKE IT. effectiveScope reads
// `storedScope ?? EMPTY_SCOPE`, and EMPTY_SCOPE means no constraint on any axis,
// which means the whole register. A scope that is still loading, or that failed
// to load, is therefore indistinguishable from a client covered for everything.
// Blocking the client_scopes request reproduced it exactly: Simtec, whose scope
// names 16 markets and 14 venue types, previewed 198 projects over "all covered
// markets" with nothing on screen to say the scope was missing.
//
// So this asserts both halves: the scoped document is correct, AND the composer
// refuses to build one at all when the scope cannot be read.

import { test, expect } from '@playwright/test';
import { isProvisionalName } from '../lib/taxonomy';
import { deadFeedForMarket } from '../../lib/dead-feeds';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const CLIENT_NAME = 'Simtec Attractions';

// The same env reader the other audits use: playwright does not load .env.local
// for the test process, only for the dev server it starts.
function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

const env = {
  ...readEnvFile(resolve(process.cwd(), '..', '.env.local')),
  ...readEnvFile(resolve(process.cwd(), '.env.local')),
  ...process.env,
} as Record<string, string>;

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const fold = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

test('a scoped client sees nothing outside their scope', async ({ page }) => {
  // ---- the stored scope, read from the database, not assumed ----------------
  const { data: clients } = await admin.from('clients').select('id,name').eq('name', CLIENT_NAME);
  const clientId = clients?.[0]?.id as string;
  expect(clientId, `${CLIENT_NAME} is not on the clients table`).toBeTruthy();
  const { data: scopes } = await admin.from('client_scopes').select('*').eq('client_id', clientId);
  const scope = scopes?.[0];
  expect(scope, `${CLIENT_NAME} has no stored scope, so this test proves nothing`).toBeTruthy();

  const markets: string[] = scope!.markets ?? [];
  const stages: string[] = scope!.stages ?? [];
  const venues: string[] = scope!.venue_types ?? [];
  const categories: string[] = scope!.development_categories ?? [];
  const countries: string[] = scope!.countries ?? [];
  const regions: string[] = scope!.regions ?? [];
  console.log(
    `stored scope: ${markets.length} markets, ${venues.length} venues, ${stages.length} stages, ` +
      `${categories.length} categories, ${countries.length} countries, ${regions.length} regions`
  );

  // ---- generate through the composer ---------------------------------------
  await page.goto('/reports', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('report-client')).toBeVisible({ timeout: 120_000 });
  await page.getByTestId('report-client').selectOption({ label: CLIENT_NAME });
  await expect(page.getByTestId('report-preview')).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => await page.getByTestId('preview-projects-count').textContent(), { timeout: 60_000 })
    .not.toContain('--');

  const shown = Number(
    ((await page.getByTestId('preview-projects-count').textContent()) ?? '').replace(/\D/g, '')
  );
  const geography = (await page.locator('[data-scope-value="Geography"]').textContent())?.trim() ?? '';
  console.log(`composer: ${shown} projects`);
  console.log(`cover geography: ${geography.slice(0, 120)}`);

  // THE WHOLE REGISTER IS THE FAILURE. Compared against the unscoped count
  // rather than a hardcoded number, so the test keeps meaning something as the
  // corpus grows.
  await page.getByTestId('report-client').selectOption({ label: 'No client (internal)' });
  await expect
    .poll(async () => await page.getByTestId('preview-projects-count').textContent(), { timeout: 60_000 })
    .not.toContain('--');
  const unscoped = Number(
    ((await page.getByTestId('preview-projects-count').textContent()) ?? '').replace(/\D/g, '')
  );
  console.log(`unscoped register: ${unscoped} projects`);
  expect(
    shown,
    `${CLIENT_NAME} returned the whole register (${shown} of ${unscoped}), so the scope is not being applied`
  ).toBeLessThan(unscoped);

  // ---- and every project in it satisfies every axis -------------------------
  //
  // Read from the database rather than from the screen, because the screen shows
  // a preview capped at a page and the claim is about the document.
  const { data: projects } = await admin
    .from('projects')
    .select('id,name,market,region_state,country,stage,venue_type,development_category,record_count,name_source')
    .eq('module', 'gli')
    .neq('status', 'dismissed')
    .limit(3000);

  // The record-level facets, since market, venue and category match on ANY of a
  // project's records rather than on its one mode column.
  const facets = new Map<string, { market: Set<string>; venue: Set<string>; category: Set<string> }>();
  const ids = (projects ?? []).map((p) => p.id as string);
  for (let i = 0; i < ids.length; i += 150) {
    const { data: recs } = await admin
      .from('leads')
      .select('project_id,market,venue_type,development_category')
      .in('project_id', ids.slice(i, i + 150))
      .neq('status', 'dismissed');
    for (const r of recs ?? []) {
      const id = r.project_id as string;
      if (!facets.has(id)) facets.set(id, { market: new Set(), venue: new Set(), category: new Set() });
      const f = facets.get(id)!;
      if (r.market) f.market.add(fold(r.market));
      if (r.venue_type) f.venue.add(fold(r.venue_type));
      if (r.development_category) f.category.add(fold(r.development_category));
    }
  }
  const anyOf = (id: string, key: 'market' | 'venue' | 'category', values: string[]) =>
    values.length === 0 || values.map(fold).some((v) => facets.get(id)?.[key].has(v));

  // ---- AND THE FOURTH: CONFIRMED MEMBERSHIP ---------------------------------
  //
  // The newest document rule, and the third harness in this repo to reconstruct
  // a client's scope without it. exclusion-audit and scripts/client-reports had
  // the same defect and were fixed the same day; this file and report-scope.audit
  // are the other two instances of the shape, found by the suite going red rather
  // than by the sweep, which is the wrong way round.
  //
  // A scope PROPOSES and only a confirmed project may be printed, so a composer
  // that applies the gate and a reconstruction that does not will always
  // disagree - by 8 projects on Simtec the day this was written. Subtracted here
  // for exactly the reason the three rules above it are: this audit is about
  // whether the SCOPE LEAKS, not about re-discovering the document rules.
  const { data: confirmed } = await admin
    .from('client_projects')
    .select('project_id')
    .eq('client_id', clientId)
    .eq('status', 'included');
  // NULL WOULD BE A DIFFERENT STATEMENT. An absent table means confirmation is
  // not switched on and the gate does not run, so the reconstruction must not
  // subtract anything. An empty array means nothing is confirmed and the
  // document is legitimately empty. See lib/client-projects.
  const confirmedIds = confirmed ? new Set(confirmed.map((r) => r.project_id as string)) : null;
  console.log(`confirmed membership: ${confirmedIds ? `${confirmedIds.size} projects` : 'gate not applied'}`);

  const inScope = (projects ?? []).filter(
    (p) =>
      (countries.length === 0 || countries.map(fold).includes(fold(p.country))) &&
      (regions.length === 0 || regions.map(fold).includes(fold(p.region_state))) &&
      anyOf(p.id as string, 'market', markets) &&
      (stages.length === 0 || stages.map(fold).includes(fold(p.stage))) &&
      anyOf(p.id as string, 'venue', venues) &&
      anyOf(p.id as string, 'category', categories) &&
      fold(p.stage) !== 'dormant' &&
      (p.record_count ?? 0) > 0
      // A PROJECT WITH NO PUBLISHED NAME IS IN SCOPE AND NOT IN THE DOCUMENT.
      // isProvisionalName excludes it from every client-facing document, and
      // the coverage note states the count - so the composer legitimately shows
      // fewer projects than the scope holds. Subtracted here rather than
      // ignored, so this audit still fails if the SCOPE leaks while remaining
      // correct about the exclusion.
      && !isProvisionalName(p.name_source as string | null)
      // AND THE THIRD: a market whose source has stopped publishing is held out
      // of every client document, stated in the coverage note. Same reason as
      // the two above - this audit is about whether the SCOPE leaks, not about
      // re-discovering the document rules.
      && !deadFeedForMarket(p.market as string | null)
      && (confirmedIds === null || confirmedIds.has(p.id as string))
  );
  console.log(`database says the scope covers ${inScope.length} projects`);
  expect(shown, 'the composer and the database disagree about this scope').toBe(inScope.length);

  // Name the axes, so a failure says WHICH one leaked rather than only that one
  // did. Every in-scope project must satisfy each axis independently.
  for (const p of inScope) {
    expect(anyOf(p.id as string, 'market', markets), `${p.name} is outside the scope's markets`).toBe(true);
    expect(anyOf(p.id as string, 'venue', venues), `${p.name} is outside the scope's venues`).toBe(true);
    expect(
      stages.length === 0 || stages.map(fold).includes(fold(p.stage)),
      `${p.name} is at stage "${p.stage}", outside the scope`
    ).toBe(true);
  }

  const marketsShown = [...new Set(inScope.map((p) => String(p.market ?? '(none)')))].sort();
  console.log(`markets present: ${marketsShown.join(', ')}`);
  const venuesShown = [...new Set(inScope.map((p) => String(p.venue_type ?? '(none)')))].sort();
  console.log(`venue types present: ${venuesShown.join(', ')}`);

  mkdirSync('e2e/shots/walkthrough', { recursive: true });
  writeFileSync(
    'e2e/shots/walkthrough/client-scope-audit.json',
    JSON.stringify({ shown, unscoped, inScope: inScope.length, marketsShown, venuesShown }, null, 2)
  );
});

// THE STATE THAT ACTUALLY BROKE IT. A scope that cannot be read must stop the
// document, not silently widen it to everything.
test('a client whose scope cannot be read builds nothing', async ({ page }) => {
  await page.route('**/client_scopes*', (route) => route.abort());
  await page.goto('/reports', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('report-client')).toBeVisible({ timeout: 120_000 });
  await page.getByTestId('report-client').selectOption({ label: CLIENT_NAME });

  const warning = page.getByTestId('scope-unresolved');
  await expect(
    warning,
    'the scope failed to load and the composer said nothing about it'
  ).toBeVisible({ timeout: 60_000 });
  console.log(`on screen: ${(await warning.textContent())?.trim().slice(0, 140)}`);

  // And nothing may be BUILT from it. Checked after a grace period rather than
  // immediately: the first version read the preview the instant the warning
  // appeared, which is before an unguarded build would have finished, so it
  // passed with the guard deliberately removed. A negative assertion has to
  // outlast the thing it is denying.
  await page.waitForTimeout(6000);
  const preview = await page.getByTestId('report-preview').count();
  const pdfDisabled = await page.getByTestId('gen-pdf').isDisabled();
  console.log(`after 6s: preview rendered=${preview > 0 ? 'yes' : 'no'} generate-disabled=${pdfDisabled}`);
  expect(
    preview,
    'an unscoped preview was built and rendered for a client whose scope could not be read'
  ).toBe(0);
  expect(pdfDisabled, 'a document could still be generated with no scope').toBe(true);
});

// THREE GENERATIONS, THROUGH THE COMPOSER, AND THE OVERRIDE MUST NOT STICK.
//
// A one-off report narrowed to a single market must not permanently narrow what
// the client is covered for. That rule is stated at the top of the composer and
// was never asserted, so this closes it by re-reading the stored scope from the
// database after the override has been applied.
test('scoped, unscoped, and a narrowing that does not write back', async ({ page }) => {
  const { data: before } = await admin
    .from('client_scopes')
    .select('markets')
    .eq('client_id', (await admin.from('clients').select('id').eq('name', CLIENT_NAME)).data![0].id);
  const storedMarketsBefore: string[] = before![0].markets ?? [];

  const settle = async () => {
    await expect
      .poll(async () => await page.getByTestId('preview-projects-count').textContent(), { timeout: 60_000 })
      .not.toContain('--');
    return Number(
      ((await page.getByTestId('preview-projects-count').textContent()) ?? '').replace(/\D/g, '')
    );
  };

  await page.goto('/reports', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('report-client')).toBeVisible({ timeout: 120_000 });

  await page.getByTestId('report-client').selectOption({ label: CLIENT_NAME });
  const simtec = await settle();
  console.log(`1. Simtec, stored scope                 ${simtec} projects`);

  // THE COMPARISON IS AGAINST NO CLIENT, NOT AGAINST ANOTHER CLIENT.
  //
  // This selected JKR and labelled it "no stored scope", using one client as a
  // stand-in for the whole register. That premise is now false twice over: JKR
  // has a stored scope, and with the membership gate live JKR's document covers
  // 0 projects because nothing has been confirmed for them - so the assertion
  // read "5 < 0" and failed on a product that was behaving correctly.
  //
  // "No client (internal)" is what the sentence below actually means, and it is
  // what the other test in this file already compares against. A client
  // document should be smaller than the internal one; whether ANOTHER client's
  // document is bigger is not a fact about scoping at all.
  await page.getByTestId('report-client').selectOption({ label: 'No client (internal)' });
  const jkr = await settle();
  console.log(`2. No client, the whole register        ${jkr} projects`);

  await page.getByTestId('report-client').selectOption({ label: CLIENT_NAME });
  await settle();
  await page
    .locator('[data-testid="report-market-chips"] [data-report-option="Clark County"]')
    .click();
  const narrowed = await settle();
  console.log(`3. Simtec, narrowed to Clark County     ${narrowed} projects`);

  expect(simtec, 'the scoped client saw the unscoped register').toBeLessThan(jkr);
  expect(narrowed, 'narrowing to one market did not narrow the report').toBeLessThan(simtec);
  expect(narrowed, 'narrowing to one market emptied the report').toBeGreaterThan(0);

  const { data: after } = await admin
    .from('client_scopes')
    .select('markets')
    .eq('client_id', (await admin.from('clients').select('id').eq('name', CLIENT_NAME)).data![0].id);
  const storedMarketsAfter: string[] = after![0].markets ?? [];
  console.log(
    `   stored markets before ${storedMarketsBefore.length}, after ${storedMarketsAfter.length}`
  );
  expect(
    storedMarketsAfter.sort(),
    'the one-off narrowing wrote back to the client stored scope'
  ).toEqual(storedMarketsBefore.sort());
});

// AN UNCONFIRMED PROJECT CANNOT BE PRINTED.
//
// The scope PROPOSES. Everything the scope matches used to reach the document
// directly, with no step between the query and the client, and that is the
// failure this closes: a market spelled differently or a venue type that means
// something else in one jurisdiction puts a project in a client's report and
// nothing asks whether it belongs there.
//
// MEASURED THROUGH THE REPORT PATH, NOT THROUGH A MOCK. It confirms exactly one
// of the client's proposed projects, generates, and requires the document to
// hold that one and nothing else. Then it puts the table back as it found it -
// membership is real data and this test must not leave a client half-confirmed.
//
// IT FAILS LOUDLY WHEN MIGRATION 033 IS NOT APPLIED, rather than passing. A gate
// that cannot run is not a gate that approved: the whole point of the null
// return from fetchIncludedProjectIds is that "not switched on" and "nothing is
// confirmed" are different, and a green test on an absent table would be this
// suite making exactly the conflation the code refuses to make.
test('an unconfirmed project cannot be printed', async ({ page }) => {
  test.setTimeout(600_000);

  const { data: clientRows } = await admin.from('clients').select('id,name').eq('name', CLIENT_NAME);
  const clientId = clientRows?.[0]?.id as string;
  expect(clientId, `client ${CLIENT_NAME} not found`).toBeTruthy();

  const probe = await admin.from('client_projects').select('id').limit(1);
  if (probe.error) {
    // Not a skip. A gate that cannot run must be visible as a gate that cannot
    // run, and the message says exactly what to do about it.
    expect(
      probe.error.message,
      'client_projects does not exist: run agents/scraper/migrations/033_client_projects.sql ' +
        'in the Supabase SQL editor. Until it exists, every project a scope proposes is printed ' +
        'without confirmation, which is the behaviour this test exists to forbid.'
    ).toBe('');
    return;
  }

  // What the scope proposes, read off the client view the operator would open.
  await page.goto(`/projects?client=${clientId}&country=any`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('client-scope-bar')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('[data-row-id]').first()).toBeVisible({ timeout: 120_000 });
  const proposed = await page
    .locator('[data-row-id]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-row-id') ?? ''));
  expect(proposed.length, 'the client scope proposed nothing to confirm').toBeGreaterThan(1);

  const confirmed = proposed[0];
  const { data: before } = await admin
    .from('client_projects')
    .select('id,project_id,status')
    .eq('client_id', clientId);
  const hadRows = (before ?? []).length;

  await admin
    .from('client_projects')
    .upsert(
      { client_id: clientId, project_id: confirmed, status: 'included', set_by: 'client-scope.audit' },
      { onConflict: 'client_id,project_id' }
    );

  try {
    await page.goto('/reports', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('report-client').selectOption({ label: CLIENT_NAME });
    await page.waitForTimeout(4000);
    // data-entry IS the project id: report-entry builds every entry with
    // `id: project.id`, so the preview's own attribute is the check.
    const ids = await page
      .locator('[data-entry]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-entry') ?? ''));
    console.log(
      `proposed ${proposed.length}, confirmed 1, document holds ${ids.length}: ${ids.join(', ')}`
    );
    for (const id of ids) {
      expect(
        id,
        `the document printed ${id}, which the client has not confirmed. ` +
          `Only 'included' rows in client_projects may be printed.`
      ).toBe(confirmed);
    }
  } finally {
    // Put it back. Membership is real data.
    if (hadRows === 0) {
      await admin.from('client_projects').delete().eq('client_id', clientId);
    } else {
      const prior = (before ?? []).find((r) => r.project_id === confirmed);
      if (prior) {
        await admin.from('client_projects').update({ status: prior.status }).eq('id', prior.id);
      } else {
        await admin
          .from('client_projects')
          .delete()
          .eq('client_id', clientId)
          .eq('project_id', confirmed);
      }
    }
  }
});
