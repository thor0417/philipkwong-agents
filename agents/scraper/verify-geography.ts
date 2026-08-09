// GEOGRAPHY RESOLUTION, pinned by example.
//
//   node --import tsx agents/scraper/verify-geography.ts
//
// THE CLAIM: a location string resolves to the same three levels every time,
// and a jurisdiction this system configures is never reinterpreted as
// something else.
//
// WHY THIS EXISTS. resolveGeography reads several shapes out of one string -
// "City, ST", "City, State, USA", a bare country name, and the legacy TED code
// strings ("CZ010, CZE", "HUN, HU322"). Those shapes are recognised by pattern,
// and patterns overlap.
//
// The overlap was not hypothetical. The NUTS region-code pattern is two letters
// followed by one to four alphanumerics, and "BRONX" satisfies it: BR + ONX.
// The BR prefix resolved to Brazil, and the code branch ran BEFORE the
// configured-jurisdiction table was consulted, so the Bronx was in South
// America. It reached production and was caught only by a per-market count
// diff on the first scoped New York run - 17 records with a null market.
//
// "Queens" is the same shape (QU + EENS) and survived only because QU is not an
// assigned country code. A rule that holds by luck is the thing a test is for.

import { pathToFileURL } from 'node:url';
import { resolveGeography } from '../../lib/geography';

let pass = 0;
let fail = 0;

function check(input: string, expected: [string | null, string | null, string | null]): void {
  const g = resolveGeography(input);
  const got: [string | null, string | null, string | null] = [g.country, g.region_state, g.market];
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (ok) {
    pass++;
  } else {
    fail++;
    console.error(`  FAIL ${JSON.stringify(input)}`);
    console.error(`       expected ${JSON.stringify(expected)}`);
    console.error(`       got      ${JSON.stringify(got)}`);
  }
}

const US = 'United States';

function main(): void {
  console.log('Geography resolution:');

  // The five boroughs fold to one market. See lib/geography MARKET_ALIASES for
  // why New York City is not five markets.
  check('Bronx', [US, 'New York', 'New York City']);
  check('The Bronx', [US, 'New York', 'New York City']);
  check('Queens', [US, 'New York', 'New York City']);
  check('Manhattan', [US, 'New York', 'New York City']);
  check('Brooklyn', [US, 'New York', 'New York City']);
  check('Staten Island', [US, 'New York', 'New York City']);
  check('New York City', [US, 'New York', 'New York City']);

  // Downstate New York is NOT folded into the city: an entitlement is filed
  // with Yonkers or with Westchester, not with both.
  check('Yonkers', [US, 'New York', 'Yonkers']);
  check('Westchester County', [US, 'New York', 'Westchester County']);

  // Other configured jurisdictions.
  check('Anaheim', [US, 'California', 'Anaheim']);
  check('Las Vegas', [US, 'Nevada', 'Las Vegas']);

  // US city + state, and the intelligence lane's three-part form.
  check('Las Vegas, NV', [US, 'Nevada', 'Las Vegas']);
  check('Clark County, NV', [US, 'Nevada', 'Clark County']);
  check('Chicago, Illinois, USA', [US, 'Illinois', 'Chicago']);

  // The legacy TED code strings the code branches exist to serve. These are
  // what the Bronx fix must not break.
  check('CZ010, CZE', ['Czechia', null, null]);
  check('ROU', ['Romania', null, null]);
  check('FIN', ['Finland', null, null]);
  check('HUN, HU322', ['Hungary', null, null]);
  check('PL637, POL, PL417', ['Poland', null, null]);
  check('USA', [US, null, null]);

  // International shapes.
  check('Abu Dhabi, United Arab Emirates', ['United Arab Emirates', 'Abu Dhabi', 'Abu Dhabi']);
  check('Saudi Arabia', ['Saudi Arabia', null, null]);
  check('Toronto, ON', ['Canada', 'Ontario', 'Toronto']);
  check('Burnaby, Greater Vancouver', ['Canada', 'British Columbia', 'Burnaby']);

  // A named US sub-state region keeps its own name as the market.
  check('South Florida', [US, 'Florida', 'South Florida']);

  // Strings carrying no geography at all resolve to nothing, and are never
  // dropped or guessed at.
  check('Regional', [null, null, null]);
  check('00', [null, null, null]);

  console.log(`\n${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
