// DOES THE DOCUMENT MATCH THE SCOPE PRINTED ON ITS COVER?
//
// The composer printed venue, category and stream on the cover and offered no
// way to set them, and the generator resolved a scope whose stream axis it
// silently ignored. Both halves of that are the same defect: a document whose
// stated scope and actual contents are produced by different code.
//
// THE TEST IS AN EQUALITY, NOT A DECREASE. "The count went down" only proves
// something was removed. This asserts the composer's number equals the number
// of projects the database holds under exactly that constraint, which is the
// only way to show that what came out is what the cover claims - no out-of-
// scope project surviving, no in-scope project dropped.
//
// Read only. It narrows this report in the composer, which is state that dies
// with the page; it never writes a scope.

import { test, expect } from '@playwright/test';
import { isProvisionalName } from '../lib/taxonomy';
import { deadFeedForMarket } from '../../lib/dead-feeds';
import { streamLabel } from '../lib/streams';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { walkthroughDir, walkthroughOut } from './artefacts';

const CLIENT_NAME = 'Simtec Attractions';
const PERIOD = 'm:2026-07';

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

test('the three axes the composer used to drop', async ({ page }) => {
  test.setTimeout(600_000);

  const env = {
    ...readEnvFile(resolve(process.cwd(), '..', '.env.local')),
    ...readEnvFile(resolve(process.cwd(), '.env.local')),
    ...process.env,
  } as Record<string, string>;
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // The client's stored scope, so the expected numbers are computed against
  // what the composer actually inherited rather than against an assumption.
  const { data: clients } = await admin.from('clients').select('id,name').eq('name', CLIENT_NAME);
  const clientId = clients?.[0]?.id as string;
  expect(clientId, `${CLIENT_NAME} is not on the clients table`).toBeTruthy();
  const { data: scopes } = await admin.from('client_scopes').select('*').eq('client_id', clientId);
  const scope = scopes![0];
  const markets: string[] = scope.markets ?? [];
  const stages: string[] = scope.stages ?? [];
  const venues: string[] = scope.venue_types ?? [];
  const categories: string[] = scope.development_categories ?? [];
  console.log(
    `\n  stored scope: markets=${markets.length} stages=${JSON.stringify(stages)} ` +
      `venues=${JSON.stringify(venues)} categories=${JSON.stringify(categories)}`
  );

  // Every project the stored scope covers, with the axes under test, read
  // straight from the database. `dormant` is dropped because the composer
  // excludes dormant projects by default.
  const { data: rows } = await admin
    .from('projects')
    .select('id,market,stage,development_category,venue_type,record_count,name_source')
    .eq('module', 'gli')
    .neq('status', 'dismissed')
    .limit(3000);
  const fold = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

  // MARKET, VENUE AND CATEGORY MATCH ON ANY OF A PROJECT'S RECORDS.
  //
  // Each of those project columns is a mode over the project's records, so
  // matching the column asks whether the project's most common value matches
  // rather than whether the project has any record that does. That is a
  // commercial defect, not a cosmetic one: the scope decides what a paying
  // client is covered for, and Top Gun Las Vegas is filed as a Family
  // Entertainment Center while its records also name Casino/Gaming.
  //
  // So the expected numbers here are computed the way the scope now resolves.
  // Computing them from the mode column would make this audit agree with the
  // defect and disagree with the fix.
  const facetsByProject = new Map<string, { market: Set<string>; venue: Set<string>; category: Set<string> }>();
  const allIds = (rows ?? []).map((r) => r.id as string);
  for (let i = 0; i < allIds.length; i += 150) {
    const { data: recs } = await admin
      .from('leads')
      .select('project_id,market,venue_type,development_category')
      .in('project_id', allIds.slice(i, i + 150))
      .neq('status', 'dismissed');
    for (const r of recs ?? []) {
      const id = r.project_id as string;
      if (!facetsByProject.has(id)) {
        facetsByProject.set(id, { market: new Set(), venue: new Set(), category: new Set() });
      }
      const f = facetsByProject.get(id)!;
      if (r.market) f.market.add(fold(r.market));
      if (r.venue_type) f.venue.add(fold(r.venue_type));
      if (r.development_category) f.category.add(fold(r.development_category));
    }
  }
  const anyOf = (id: string, key: 'market' | 'venue' | 'category', values: string[]) =>
    values.length === 0 || values.map(fold).some((v) => facetsByProject.get(id)?.[key].has(v));

  // EVERY STORED AXIS, not the two this audit first knew about. Leaving venue
  // out produced an "expected" of 37 against a correct 4 and read as the filter
  // being broken - the audit lying about the code rather than the other way
  // round, which is the more dangerous direction.
  // ---- AND THE FOURTH: CONFIRMED MEMBERSHIP ---------------------------------
  //
  // The fourth harness in this repo to reconstruct a client's scope without the
  // membership gate, after exclusion-audit, scripts/client-reports and
  // client-scope.audit. A scope PROPOSES and only a confirmed project may be
  // printed, so a composer that applies the gate and a reconstruction that does
  // not will always disagree.
  //
  // NULL IS NOT AN EMPTY SET. An absent table means confirmation is not switched
  // on and nothing is subtracted; an empty set means nothing is confirmed and
  // the document is legitimately empty. See lib/client-projects.
  //
  // Applied to BOTH filters below. byMode exists to compare mode-column matching
  // against record matching, and that comparison is only about facets - so both
  // sides have to differ in the facet rule and in nothing else.
  const { data: confirmedRows } = await admin
    .from('client_projects')
    .select('project_id')
    .eq('client_id', clientId)
    .eq('status', 'included');
  const confirmedIds = confirmedRows ? new Set(confirmedRows.map((r) => r.project_id as string)) : null;
  const isConfirmed = (id: string) => confirmedIds === null || confirmedIds.has(id);
  console.log(`  confirmed membership: ${confirmedIds ? `${confirmedIds.size} projects` : 'gate not applied'}`);

  const inScope = (rows ?? []).filter(
    (r) =>
      anyOf(r.id as string, 'market', markets) &&
      (stages.length === 0 || stages.map(fold).includes(fold(r.stage))) &&
      anyOf(r.id as string, 'venue', venues) &&
      anyOf(r.id as string, 'category', categories) &&
      fold(r.stage) !== 'dormant' &&
      // THE TWO RULES THE COMPOSER APPLIES AND THIS QUERY DID NOT. A hollow
      // project has nothing to cite and a project with no published name is
      // excluded from every client document - both stated in the coverage note,
      // both invisible to a raw scope query. Applied here so the audit keeps
      // testing whether the SCOPE leaks rather than re-discovering two rules it
      // is not about.
      (r.record_count ?? 0) > 0 &&
      !isProvisionalName(r.name_source as string | null) &&
      // AND THE THIRD: a market whose source has stopped publishing is held out
      // of every client document, stated in the coverage note. Same reason as
      // the two above - this audit is about whether the SCOPE leaks, not about
      // re-discovering the document rules.
      !deadFeedForMarket(r.market as string | null) &&
      // AND THE FOURTH, confirmed membership. See above.
      isConfirmed(r.id as string)
  );
  console.log(`  database says the stored scope covers ${inScope.length} projects`);

  // AND THE FIX IS ASSERTED, not merely relied on. Matching the records can only
  // ever find MORE projects than matching the one mode column, because every
  // project whose mode matches also has a record carrying that value. If these
  // two are equal for every axis the scope constrains, the record matching is
  // not doing anything.
  const byMode = (rows ?? []).filter(
    (r) =>
      (markets.length === 0 || markets.map(fold).includes(fold(r.market))) &&
      (stages.length === 0 || stages.map(fold).includes(fold(r.stage))) &&
      (venues.length === 0 || venues.map(fold).includes(fold(r.venue_type))) &&
      (categories.length === 0 || categories.map(fold).includes(fold(r.development_category))) &&
      fold(r.stage) !== 'dormant' &&
      // THE SAME TWO DOCUMENT RULES as inScope above. This comparison is about
      // ONE thing - whether matching a project's records finds more than
      // matching its mode column - so both sides must differ in that and in
      // nothing else. Leaving them off here made the mode side larger and the
      // assertion failed on an inequality that was never about facets.
      (r.record_count ?? 0) > 0 &&
      !isProvisionalName(r.name_source as string | null) &&
      // AND THE THIRD: a market whose source has stopped publishing is held out
      // of every client document, stated in the coverage note. Same reason as
      // the two above - this audit is about whether the SCOPE leaks, not about
      // re-discovering the document rules.
      !deadFeedForMarket(r.market as string | null) &&
      // AND THE FOURTH, confirmed membership. See above.
      isConfirmed(r.id as string)
  );
  console.log(
    `  matching the mode column would cover ${byMode.length}; matching any record covers ` +
      `${inScope.length} (+${inScope.length - byMode.length})`
  );
  expect(
    inScope.length,
    'matching any record found FEWER projects than matching the mode column, which is impossible'
  ).toBeGreaterThanOrEqual(byMode.length);

  // Which lanes each in-scope project holds a record in.
  const streamsByProject = new Map<string, Set<string>>();
  const ids = inScope.map((r) => r.id as string);
  for (let i = 0; i < ids.length; i += 150) {
    const { data: leads } = await admin
      .from('leads')
      .select('project_id,stream')
      .in('project_id', ids.slice(i, i + 150))
      .neq('status', 'dismissed');
    for (const l of leads ?? []) {
      if (!l.project_id || !l.stream) continue;
      if (!streamsByProject.has(l.project_id)) streamsByProject.set(l.project_id, new Set());
      streamsByProject.get(l.project_id)!.add(l.stream);
    }
  }

  await page.goto('/reports', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('report-client')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('report-client').selectOption({ label: CLIENT_NAME });
  await page.getByTestId('period-month').selectOption(PERIOD);

  async function settled(): Promise<{ projects: number; filters: string }> {
    await expect
      .poll(async () => await page.getByTestId('preview-projects-count').textContent(), { timeout: 60_000 })
      .not.toContain('--');
    const t = await page.getByTestId('preview-projects-count').textContent();
    const filters = (await page.locator('[data-scope-value="Filters"]').textContent()) ?? '';
    return { projects: Number((t ?? '').replace(/\D/g, '')), filters: filters.trim() };
  }

  const base = await settled();
  console.log(`  composer baseline: ${base.projects} projects | cover filters: ${base.filters}`);
  expect(base.projects, 'the stored scope matched nothing').toBe(inScope.length);

  const out: Record<string, unknown> = { baseline: base };
  // Which axes actually cut the set. Asserted once at the end rather than per
  // axis: see the note in narrow().
  const reduced: string[] = [];

  // ---- ONE AXIS AT A TIME. Each chip is toggled on, measured, toggled off, so
  // the axes cannot mask one another.
  async function narrow(axis: 'category' | 'venue' | 'stream', value: string, expected: number) {
    const chip = page.locator(`[data-testid="report-${axis}-chips"] [data-report-option="${value}"]`);
    await expect(chip, `the composer offers no ${axis} chip for ${value}`).toHaveCount(1);
    await chip.click();
    const after = await settled();
    console.log(
      `  ${axis} = ${value.padEnd(22)} -> ${String(after.projects).padStart(3)} projects (database: ${expected}) | cover: ${after.filters}`
    );
    // NEVER MORE THAN THE BASELINE, AND EXACTLY WHAT THE DATABASE SAYS.
    //
    // This asserted a STRICT reduction on every axis, which is a claim about the
    // data rather than about the composer. With the membership gate live,
    // Simtec's confirmed set is 5 projects and all 5 are Hospitality/Tourism, so
    // narrowing to that category correctly removes nothing and the test failed
    // on a composer that was working - the chip was applied, the cover said so,
    // and the count matched the database exactly.
    //
    // A narrowing that legitimately changes nothing is not a defect. A chip that
    // does nothing IS, and that is caught by the two assertions that follow: the
    // count must equal the database's own answer for that axis, and the cover
    // must name the narrowing. Those are the real guards; the inequality was a
    // proxy for them that happened to hold while the corpus was larger.
    //
    // The whole-run guard below still requires that at least one axis reduced,
    // so a composer that ignores every chip cannot pass by having each axis
    // individually excused.
    expect(after.projects, `narrowing by ${axis} produced MORE than the baseline`).toBeLessThanOrEqual(base.projects);
    expect(after.projects, `${axis}=${value} did not match the database exactly`).toBe(expected);
    if (after.projects < base.projects) reduced.push(`${axis}=${value}`);
    // THE COVER HAS TO SAY SO. A document that quietly narrowed is the same
    // defect as one that quietly did not.
    //
    // The cover states the narrowing in the words the PRODUCT uses, which for a
    // stream is not the stored id: 'opportunity' is written and "Tenders and
    // RFPs" is printed (lib/streams). Asserting on the raw id would pin the
    // cover to the database's vocabulary and fail the moment a label is made
    // readable - which is exactly what happened. So the expected text is the
    // label where one exists, and the assertion is otherwise unchanged.
    const shown = axis === 'stream' ? streamLabel(value) : value;
    expect(after.filters.toLowerCase(), 'the cover does not state the narrowing').toContain(
      shown.toLowerCase()
    );
    out[`${axis}:${value}`] = { shown: after.projects, expected, filters: after.filters };
    await chip.click();
    await settled();
  }

  // The per-axis expectations are record-based for the same reason the baseline
  // is: narrowing by a category now asks whether a project has any record in it.
  const CATEGORY = 'Hospitality/Tourism';
  await narrow(
    'category',
    CATEGORY,
    inScope.filter((r) => anyOf(r.id as string, 'category', [CATEGORY])).length
  );

  // The venue chip must come from what the composer offers, which a stored
  // venue constraint narrows to that constraint. Picking the commonest venue
  // among the in-scope projects guarantees the narrowing is a real subset
  // rather than a no-op or an empty one.
  // Counted over the RECORDS, so the chosen venue is the one the composer will
  // now actually match the most projects on.
  const venueCounts = new Map<string, number>();
  for (const r of inScope) {
    for (const v of facetsByProject.get(r.id as string)?.venue ?? []) {
      venueCounts.set(v, (venueCounts.get(v) ?? 0) + 1);
    }
  }
  // facetsByProject holds folded values; the chip is labelled with the canonical
  // spelling, so map back through the stored scope's own list.
  const canonicalVenue = new Map(venues.map((v) => [fold(v), v]));
  const topVenueFolded = [...venueCounts.entries()]
    .filter(([v]) => canonicalVenue.has(v))
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  const VENUE = topVenueFolded ? canonicalVenue.get(topVenueFolded) : undefined;
  expect(VENUE, 'no in-scope project carries a venue type to narrow by').toBeTruthy();
  await narrow('venue', VENUE!, inScope.filter((r) => anyOf(r.id as string, 'venue', [VENUE!])).length);

  // Both lanes, because they answer different questions: 'intelligence' shows
  // the axis narrowing to a real subset, and 'opportunity' shows it landing on
  // an honest zero rather than falling back to everything. A filter that fails
  // open is the one this project keeps finding.
  for (const STREAM of ['intelligence', 'opportunity']) {
    await narrow(
      'stream',
      STREAM,
      inScope.filter((r) => streamsByProject.get(r.id as string)?.has(STREAM)).length
    );
  }

  // ---- AT LEAST ONE AXIS MUST HAVE CUT THE SET ------------------------------
  //
  // The per-axis assertion no longer demands a strict reduction, because a
  // narrowing can legitimately change nothing when every confirmed project
  // shares the value. This is what stops that concession from letting a
  // composer that ignores EVERY chip pass: across four narrowings - a category,
  // a venue and two streams - at least one has to have removed something, or
  // the chips are not being applied at all.
  console.log(`  axes that actually reduced the set: ${reduced.length ? reduced.join(', ') : 'NONE'}`);
  out.reduced = reduced;
  expect(
    reduced.length,
    'no axis reduced the report at all, so the composer is not applying its chips'
  ).toBeGreaterThan(0);

  mkdirSync(walkthroughDir(), { recursive: true });
  writeFileSync(walkthroughOut('report-scope-audit.json'), JSON.stringify(out, null, 2));
});
