// READ-ONLY. WHICH JURISDICTIONS IN OUR FIVE STATES RUN LEGISTAR, AND WHICH OF
// THEM WE CAPTURE.
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/platform-census.ts [--state=NV]
//
// Nothing is written and nothing is scraped: this asks each candidate client for
// ONE page of one endpoint and reports whether it answered. It is the same
// endpoint verify-staleness uses, for the same reason - the Legistar Web API is
// the thing our adapter actually reads, so a jurisdiction that answers it is a
// jurisdiction a config row would reach.
//
// A NEGATIVE HERE IS "NO SLUG WE TRIED ANSWERED", NOT "NOT ON LEGISTAR".
//
// Legistar client codes are not derivable from a place name - Clark County is
// 'clark', Westchester County is 'westchestercountyny' - so this probes a
// candidate list and cannot prove absence. Every unanswered candidate is
// reported as unconfirmed rather than as a negative, because reporting a guess
// as a finding is how a census becomes fiction. The confirmed ones are exactly
// as good as an HTTP 200 on a real endpoint, which is what they are.
//
// WHY LEGISTAR FIRST. It is the wire: a matter appears on the API within days of
// being filed, where a PDF agenda adapter reads whatever the clerk posted and a
// document adapter reads one file. The platform decides the lag, so the platform
// is the first sort key.

import { DEFAULT_JURISDICTIONS } from '../sources/legistar-jurisdictions';

const BASE = 'https://webapi.legistar.com/v1';
const arg = (k: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').split('=')[1] ?? '';
const ONLY = arg('state').toUpperCase();

interface Candidate {
  /** The Legistar client code to probe. */
  client: string;
  place: string;
  state: 'NV' | 'CA' | 'AZ' | 'FL' | 'NY';
  /** Why this place is on the list at all. Population alone is not a reason. */
  why: string;
}

// THE CANDIDATE LIST. Places in our five states big enough, or leisure-heavy
// enough, to be worth a row - with the client code Legistar is most likely to
// use for them. Codes follow the observed convention: bare place name, place
// plus state where the bare name collides, 'countyname' + state for counties.
const CANDIDATES: Candidate[] = [
  // ---- NEVADA ----
  { client: 'clark', place: 'Clark County', state: 'NV', why: 'Strip-adjacent entitlement. CONFIGURED.' },
  { client: 'lasvegas', place: 'City of Las Vegas', state: 'NV', why: 'Downtown and the non-county Strip fringe; we read it by PDF agenda today.' },
  { client: 'cityofnorthlasvegas', place: 'North Las Vegas', state: 'NV', why: 'Apex industrial and resort-adjacent land.' },
  { client: 'northlasvegas', place: 'North Las Vegas (alt code)', state: 'NV', why: 'Alternate slug for the same city.' },
  { client: 'henderson', place: 'Henderson', state: 'NV', why: 'Second-largest NV city; Lake Las Vegas, Water Street redevelopment.' },
  { client: 'reno', place: 'Reno', state: 'NV', why: 'Casino market in its own right.' },
  { client: 'cityofreno', place: 'Reno (alt code)', state: 'NV', why: 'Alternate slug.' },
  { client: 'sparksnv', place: 'Sparks', state: 'NV', why: 'Nugget casino, Legends outlet district.' },
  { client: 'washoecounty', place: 'Washoe County', state: 'NV', why: 'County layer around Reno and Sparks.' },

  // ---- CALIFORNIA ----
  { client: 'oakland', place: 'Oakland', state: 'CA', why: 'Coliseum site, waterfront. CONFIGURED.' },
  { client: 'anaheim', place: 'Anaheim', state: 'CA', why: 'OCVibe, Disneyland, Platinum Triangle. We read it by PDF agenda today.' },
  { client: 'sanfrancisco', place: 'San Francisco', state: 'CA', why: 'Convention, hotel and entertainment core.' },
  { client: 'sfgov', place: 'San Francisco (alt code)', state: 'CA', why: 'Alternate slug.' },
  { client: 'sandiego', place: 'San Diego', state: 'CA', why: 'Convention centre, Gaslamp, Seaport Village redevelopment.' },
  { client: 'longbeach', place: 'Long Beach', state: 'CA', why: 'Queen Mary, convention centre, aquarium.' },
  { client: 'sanjose', place: 'San Jose', state: 'CA', why: 'Arena and downtown entertainment district.' },
  { client: 'sacramento', place: 'Sacramento', state: 'CA', why: 'Golden 1 arena district, Railyards.' },
  { client: 'santaana', place: 'Santa Ana', state: 'CA', why: 'Orange County seat, adjacent to Anaheim.' },
  { client: 'garden-grove', place: 'Garden Grove', state: 'CA', why: 'Resort district on the Anaheim boundary; hotel corridor.' },
  { client: 'gardengrove', place: 'Garden Grove (alt code)', state: 'CA', why: 'Alternate slug.' },
  { client: 'ocgov', place: 'Orange County', state: 'CA', why: 'County layer for Anaheim, Garden Grove, Santa Ana.' },
  { client: 'orangecountyca', place: 'Orange County (alt code)', state: 'CA', why: 'Alternate slug.' },
  { client: 'lacity', place: 'Los Angeles', state: 'CA', why: 'Convention centre, stadium district, 2028 Olympic venues.' },
  { client: 'losangeles', place: 'Los Angeles (alt code)', state: 'CA', why: 'Alternate slug.' },
  { client: 'lacounty', place: 'Los Angeles County', state: 'CA', why: 'County layer.' },
  { client: 'pasadena', place: 'Pasadena', state: 'CA', why: 'Rose Bowl.' },
  { client: 'inglewood', place: 'Inglewood', state: 'CA', why: 'SoFi Stadium, Intuit Dome, Hollywood Park.' },
  { client: 'chula-vista', place: 'Chula Vista', state: 'CA', why: 'Bayfront resort and convention project.' },
  { client: 'chulavista', place: 'Chula Vista (alt code)', state: 'CA', why: 'Alternate slug.' },

  // ---- ARIZONA ----
  { client: 'phoenix', place: 'Phoenix', state: 'AZ', why: 'CONFIGURED.' },
  { client: 'tucson', place: 'Tucson', state: 'AZ', why: 'Second AZ market; convention and hotel pipeline.' },
  { client: 'mesa', place: 'Mesa', state: 'AZ', why: 'Spring training, Bell Bank Park.' },
  { client: 'tempe', place: 'Tempe', state: 'AZ', why: 'Entertainment district, arena proposals, Mill Avenue.' },
  { client: 'scottsdale', place: 'Scottsdale', state: 'AZ', why: 'Resort and golf capital of the state.' },
  { client: 'chandleraz', place: 'Chandler', state: 'AZ', why: 'Wild Horse Pass corridor.' },
  { client: 'glendaleaz', place: 'Glendale', state: 'AZ', why: 'State Farm Stadium, Desert Diamond casino, Westgate.' },
  { client: 'maricopa', place: 'Maricopa County', state: 'AZ', why: 'County layer over Phoenix, Mesa, Tempe, Scottsdale, Glendale.' },
  { client: 'maricopacounty', place: 'Maricopa County (alt code)', state: 'AZ', why: 'Alternate slug.' },

  // ---- FLORIDA ----
  { client: 'miamidade', place: 'Miami-Dade County', state: 'FL', why: 'CONFIGURED, and declared a dead feed (last matter 2018).' },
  { client: 'miamifl', place: 'City of Miami', state: 'FL', why: 'Known: answers 200 on a TEST instance holding 6 matters.' },
  { client: 'miami', place: 'City of Miami (alt code)', state: 'FL', why: 'Alternate slug.' },
  { client: 'orlando', place: 'Orlando', state: 'FL', why: 'Convention corridor, I-Drive, sports district. We read one govdoc today.' },
  { client: 'cityoforlando', place: 'Orlando (alt code)', state: 'FL', why: 'Alternate slug.' },
  { client: 'orangecountyfl', place: 'Orange County FL', state: 'FL', why: 'The county Disney and Universal sit in. We read one govdoc today.' },
  { client: 'ocfl', place: 'Orange County FL (alt code)', state: 'FL', why: 'Alternate slug.' },
  { client: 'osceola', place: 'Osceola County', state: 'FL', why: 'Celebration, Margaritaville, the 192 corridor.' },
  { client: 'osceolafl', place: 'Osceola County (alt code)', state: 'FL', why: 'Alternate slug.' },
  { client: 'kissimmee', place: 'Kissimmee', state: 'FL', why: 'Hotel corridor south of Disney.' },
  { client: 'tampagov', place: 'Tampa', state: 'FL', why: 'Water Street, convention centre, stadium.' },
  { client: 'tampa', place: 'Tampa (alt code)', state: 'FL', why: 'Alternate slug.' },
  { client: 'hillsborough', place: 'Hillsborough County', state: 'FL', why: 'County layer over Tampa.' },
  { client: 'jacksonville', place: 'Jacksonville', state: 'FL', why: 'Stadium of the Future, Shipyards.' },
  { client: 'coj', place: 'Jacksonville (alt code)', state: 'FL', why: 'Alternate slug.' },
  { client: 'stpete', place: 'St Petersburg', state: 'FL', why: 'Historic Gas Plant / Rays stadium district.' },
  { client: 'fortlauderdale', place: 'Fort Lauderdale', state: 'FL', why: 'Convention centre and hotel expansion.' },
  { client: 'broward', place: 'Broward County', state: 'FL', why: 'County layer; convention centre owner.' },
  { client: 'browardcounty', place: 'Broward County (alt code)', state: 'FL', why: 'Alternate slug.' },
  { client: 'pbcgov', place: 'Palm Beach County', state: 'FL', why: 'Resort and convention market.' },

  // ---- NEW YORK ----
  { client: 'nyc', place: 'New York City Council', state: 'NY', why: 'KNOWN 403 on every endpoint. Probed to record that it still is.' },
  { client: 'yonkersny', place: 'Yonkers', state: 'NY', why: 'MGM Empire City. CONFIGURED.' },
  { client: 'westchestercountyny', place: 'Westchester County', state: 'NY', why: 'Rye Playland. CONFIGURED.' },
  { client: 'buffalo', place: 'Buffalo', state: 'NY', why: 'Waterfront, stadium, Seneca casino adjacency.' },
  { client: 'buffalony', place: 'Buffalo (alt code)', state: 'NY', why: 'Alternate slug.' },
  { client: 'rochesterny', place: 'Rochester', state: 'NY', why: 'Downtown redevelopment.' },
  { client: 'syracuseny', place: 'Syracuse', state: 'NY', why: 'Aquarium and stadium district.' },
  { client: 'albanyny', place: 'Albany', state: 'NY', why: 'Convention centre, state capital.' },
  { client: 'nassaucountyny', place: 'Nassau County', state: 'NY', why: 'Las Vegas Sands / Nassau Coliseum casino bid site.' },
  { client: 'hempsteadny', place: 'Town of Hempstead', state: 'NY', why: 'The town the Coliseum site sits in.' },
  { client: 'suffolkcountyny', place: 'Suffolk County', state: 'NY', why: 'Long Island leisure corridor.' },
  { client: 'newrochelleny', place: 'New Rochelle', state: 'NY', why: 'Downtown overlay, hotel pipeline.' },
  { client: 'whiteplainsny', place: 'White Plains', state: 'NY', why: 'Westchester commercial core.' },
  { client: 'mountvernonny', place: 'Mount Vernon', state: 'NY', why: 'Adjacent to Yonkers.' },
];

interface Probe {
  c: Candidate;
  ok: boolean;
  status: number | string;
  matters: number | null;
  latest: string | null;
  /** Days between the newest matter's date and today, where one is readable. */
  lagDays: number | null;
}

async function probe(c: Candidate, now: number): Promise<Probe> {
  // ONE PAGE, NEWEST FIRST. Enough to answer "does this answer, and is it live",
  // and deliberately not enough to be a scrape.
  const url =
    `${BASE}/${c.client}/Matters?$top=5&$orderby=MatterLastModifiedUtc+desc`;
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { c, ok: false, status: res.status, matters: null, latest: null, lagDays: null };
    const rows = (await res.json()) as { MatterLastModifiedUtc?: string; MatterIntroDate?: string }[];
    if (!Array.isArray(rows)) return { c, ok: false, status: 'not an array', matters: null, latest: null, lagDays: null };
    const dates = rows
      .map((r) => r.MatterLastModifiedUtc ?? r.MatterIntroDate ?? null)
      .filter((d): d is string => !!d)
      .sort();
    const latest = dates[dates.length - 1] ?? null;
    const t = latest ? Date.parse(latest) : NaN;
    return {
      c,
      ok: true,
      status: res.status,
      matters: rows.length,
      latest: latest ? latest.slice(0, 10) : null,
      lagDays: Number.isNaN(t) ? null : Math.round((now - t) / 86_400_000),
    };
  } catch (e) {
    return { c, ok: false, status: String(e).slice(0, 40), matters: null, latest: null, lagDays: null };
  }
}

async function main(): Promise<void> {
  const configured = new Set(DEFAULT_JURISDICTIONS.map((j) => j.client));
  const list = ONLY ? CANDIDATES.filter((c) => c.state === ONLY) : CANDIDATES;
  const now = Date.now();

  // Sequential, at a walking pace. This is somebody else's public API and the
  // census is not urgent.
  const results: Probe[] = [];
  for (const c of list) {
    results.push(await probe(c, now));
    await new Promise((r) => setTimeout(r, 350));
  }

  const live = results.filter((r) => r.ok);
  const dead = results.filter((r) => !r.ok);

  console.log('='.repeat(104));
  console.log(`LEGISTAR CENSUS over ${list.length} candidate client codes in ${ONLY || 'NV, CA, AZ, FL, NY'}`);
  console.log('='.repeat(104));
  console.log(`  answered the Web API: ${live.length}`);
  console.log(`  did not answer:       ${dead.length}   (a slug we tried, not a proof of absence)`);
  console.log(`  configured by us:     ${DEFAULT_JURISDICTIONS.length} jurisdictions, of which ` +
    `${live.filter((r) => configured.has(r.c.client)).length} are in this candidate list and answered`);
  console.log('');
  console.log('CONFIRMED LIVE, newest matter first');
  console.log('  state  captured  client                   latest      lag  place');
  console.log('  ' + '-'.repeat(98));
  for (const r of live.sort((a, b) => (a.lagDays ?? 1e9) - (b.lagDays ?? 1e9))) {
    console.log(
      `  ${r.c.state.padEnd(6)} ${(configured.has(r.c.client) ? 'YES' : '-').padEnd(9)} ` +
        `${r.c.client.padEnd(24)} ${(r.latest ?? '-').padEnd(11)} ${String(r.lagDays ?? '-').padStart(4)}  ${r.c.place}`
    );
  }
  // ---- THE SECOND PROBE, AND IT IS THE ONE THAT MAKES A NEGATIVE MEAN ANYTHING
  //
  // The Web API answering 500 has two completely different causes and the status
  // code cannot tell them apart: the slug is wrong, or the slug is right and the
  // Web API is switched off for that client. Those lead to opposite conclusions -
  // "find the real slug" against "this jurisdiction is not reachable by config" -
  // so the census asks the second question rather than guessing.
  //
  // {client}.legistar.com is the PUBLIC PORTAL, which every Legistar customer
  // has whether or not the API is enabled. A portal that loads over a slug whose
  // API refuses is a jurisdiction on Legistar that our adapter cannot read.
  //
  // ---- AND THE STATUS CODE IS NOT THE ANSWER EITHER ------------------------
  //
  // *.legistar.com IS A WILDCARD. Every subdomain resolves and every one answers
  // HTTP 200, invented ones included: this probe returned 200 for 'gardengrove'
  // AND 'garden-grove', for 'osceolafl', for 'buffalony' - slugs made up to test
  // exactly this. A status check would have reported all 54 unanswered
  // candidates as "on Legistar with the API switched off", which is fiction with
  // a number attached.
  //
  // THE BODY SEPARATES THEM CLEANLY. A real portal serves ~190KB of Legistar
  // markup with the jurisdiction's name in the <title>. The wildcard serves
  // NINETEEN BYTES: "Invalid parameters!". So the test is the body, and the
  // threshold is not a judgement call.
  //
  // This is the golden case a-200-is-not-a-live-page, on a different host, found
  // by probing slugs that could not possibly exist. A verification that cannot
  // fail is not a verification.
  console.log('');
  console.log('NO ANSWER FROM THE WEB API, AND WHETHER THE PUBLIC PORTAL EXISTS');
  console.log('  state  client                   api    portal   place');
  console.log('  ' + '-'.repeat(90));
  for (const r of dead.sort((a, b) => a.c.state.localeCompare(b.c.state))) {
    let portal = 'no';
    try {
      const res = await fetch(`https://${r.c.client}.legistar.com/Calendar.aspx`, {
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      });
      const body = await res.text();
      // The wildcard's answer, verbatim and complete.
      const wildcard = body.trim() === 'Invalid parameters!';
      const looksLegistar = /ctl00_|Legistar|CalendarControl\.css/.test(body);
      portal = !res.ok
        ? `no ${res.status}`
        : wildcard
          ? 'no (wildcard)'
          : looksLegistar
            ? `YES ${Math.round(body.length / 1024)}kb`
            : `no (${body.length}b, not Legistar)`;
    } catch {
      portal = 'no (dns)';
    }
    await new Promise((x) => setTimeout(x, 250));
    console.log(
      `  ${r.c.state.padEnd(6)} ${r.c.client.padEnd(24)} ${String(r.status).padEnd(6)} ` +
        `${portal.padEnd(8)} ${r.c.place}`
    );
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
