// THE REGISTER'S DEFAULT IS THE CORPUS, NOT AN EQUALITY ON ONE COUNTRY.
//
// WHAT HAPPENED. `lib/corpus-scope` declares which countries this system is for
// and says, at length, that AN UNRESOLVED COUNTRY IS NOT A FOREIGN ONE: the
// check fails OPEN on null, because dropping on unknown discards real US
// coverage to enforce a rule about foreign coverage. Every reader in the agent
// runtime obeys it - the intelligence lane, the snapshot, nine diagnostics.
//
// The dashboard obeyed it nowhere. The register opened on
// `country = 'United States'`, which is the predicate the corpus snapshot has
// been labelling WRONG in its own reconciliation block since 2026-08-19, in
// these words: "Equality drops every project whose country did not resolve, and
// an unresolved country is not a foreign one. Use inCorpusScope."
//
// Measured 2026-08-21, before the fix: 5 of the register's 235 projects carried
// a null country and were absent from the default view. They are not foreign.
// They are UMusic Hotel Austin, Sacramento lodging growth, a California street
// address, and two more, all captured by the press lane with no country parsed.
// And this is the screen a project is CONFIRMED on, so a project that cannot be
// seen is a project that cannot be confirmed, and one that is never confirmed
// can never reach a client document. The membership gate is downstream of this
// list.
//
// WHY THIS FILE EXISTS SEPARATELY FROM filters.audit. That audit reads counts
// through the pager, which is the right instrument for "does this filter do
// anything" and the wrong one for "does it drop the right rows". Its old
// assertion was `defaulted < cleared`, which the equality satisfied and the
// correct predicate does not - a test that could only pass while the defect was
// present. The number that settles it is the count of unresolved-country
// projects in the database, so this file reads the database.
//
// NON-VACUOUS BY CONSTRUCTION. If the corpus ever holds no unresolved-country
// project, the gap is legitimately zero and there is nothing to assert; that
// state is reported rather than passed over in silence, because a guard that
// quietly stops guarding is the thing standing rule 7 is about.

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { CORPUS_COUNTRIES } from '../../lib/corpus-scope';
import { walkthroughOut } from './artefacts';

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

const ARTIFACT = walkthroughOut('corpus-scope-audit.json');

async function totalFor(page: import('@playwright/test').Page, url: string): Promise<number> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const pager = page.getByTestId('pager-total');
  await expect(pager).toBeVisible({ timeout: 120_000 });
  // data-total is ABSENT while the query is in flight and present once the
  // server has answered. Reading it eagerly returns 0 for every filter, which
  // reads as "every filter returns nothing" - a false alarm produced entirely
  // by the measuring instrument. Same wait as filters.audit, same reason.
  await expect
    .poll(async () => await pager.getAttribute('data-total'), { timeout: 120_000 })
    .not.toBeNull();
  return Number(await pager.getAttribute('data-total'));
}

test('the register default admits a project whose country did not resolve', async ({ page }) => {
  test.setTimeout(600_000);

  // ---- THE DATABASE, WHICH IS WHAT THE SCREEN IS MEASURED AGAINST ----------
  //
  // The register population: the live pipeline, minus the dismissal tombstone.
  // Deliberately NOT narrowed by country here - that is the axis under test.
  const { data: rows, error } = await admin
    .from('projects')
    .select('id,name,country')
    .eq('module', 'gli')
    .neq('status', 'dismissed')
    .limit(5000);
  if (error) throw new Error(`corpus scope audit read failed: ${error.message}`);

  const all = rows ?? [];
  const covered = new Set(CORPUS_COUNTRIES.map((c) => c.toLowerCase()));
  const unresolved = all.filter((r) => !r.country);
  const inCovered = all.filter((r) => !!r.country && covered.has(String(r.country).trim().toLowerCase()));
  const foreign = all.filter((r) => !!r.country && !covered.has(String(r.country).trim().toLowerCase()));

  console.log(`\n===== CORPUS SCOPE ON THE REGISTER =====`);
  console.log(`  register population        ${all.length}`);
  console.log(`  country in ${CORPUS_COUNTRIES.join(', ').padEnd(14)}  ${inCovered.length}`);
  console.log(`  country unresolved (null)  ${unresolved.length}`);
  console.log(`  country resolved foreign   ${foreign.length}`);
  for (const r of unresolved.slice(0, 10)) console.log(`    unresolved: ${r.name}`);

  // ---- THE SCREEN ---------------------------------------------------------
  const defaulted = await totalFor(page, '/projects?view=all');
  const explicitUs = await totalFor(
    page,
    `/projects?view=all&country=${encodeURIComponent(CORPUS_COUNTRIES[0])}`
  );
  const cleared = await totalFor(page, '/projects?view=all&country=any');

  console.log(`\n  default (no country param) ${defaulted}`);
  console.log(`  explicit ${CORPUS_COUNTRIES[0].padEnd(18)} ${explicitUs}`);
  console.log(`  cleared (country=any)      ${cleared}`);

  mkdirSync(dirname(ARTIFACT), { recursive: true });
  writeFileSync(
    ARTIFACT,
    JSON.stringify(
      {
        about:
          'The register default is corpus scope, not an equality on one country. ' +
          'An unresolved country is not a foreign one; see lib/corpus-scope.',
        corpusCountries: CORPUS_COUNTRIES,
        database: {
          registerPopulation: all.length,
          predicate: "projects WHERE module = 'gli' AND status <> 'dismissed'",
          inCoveredCountry: inCovered.length,
          countryUnresolved: unresolved.length,
          countryResolvedForeign: foreign.length,
          unresolvedNames: unresolved.map((r) => r.name),
        },
        screen: {
          default: { count: defaulted, predicate: 'country IS NULL OR country IN (corpus)' },
          explicitCountry: { count: explicitUs, predicate: `country = '${CORPUS_COUNTRIES[0]}'` },
          cleared: { count: cleared, predicate: 'no country filter' },
        },
      },
      null,
      2
    )
  );

  // ---- WHAT MUST HOLD -----------------------------------------------------

  // The default is exactly the corpus: covered countries plus the unresolved.
  expect(
    defaulted,
    'the register default is not the corpus: it should hold every covered-country project plus every project whose country did not resolve'
  ).toBe(inCovered.length + unresolved.length);

  // The explicit pick is still an equality, and still excludes the unresolved.
  expect(
    explicitUs,
    `an explicit pick of ${CORPUS_COUNTRIES[0]} should be a plain equality on that country`
  ).toBe(inCovered.length);

  // THE GAP IS THE WHOLE POINT, and it is asserted as a number rather than as
  // an inequality so that a default which quietly narrows again cannot pass.
  if (unresolved.length === 0) {
    console.log(
      '\n  NOTE: the corpus currently holds no project with an unresolved country, so the gap ' +
        'this guard exists for is legitimately zero. The guard is not asserting anything today.'
    );
  } else {
    expect(
      defaulted - explicitUs,
      `${unresolved.length} projects carry no resolved country and the default must show every one of them`
    ).toBe(unresolved.length);
  }

  // Clearing must still widen to everything, or the default is not clearable.
  expect(cleared, 'clearing the country filter did not return the whole register').toBe(all.length);
});
