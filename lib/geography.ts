// STORED GEOGRAPHY. One resolver, used by every stream and every write path.
//
// Geography is resolved ONCE, at write time, into three indexed columns
// (country, region_state, market) and is never derived at read time. That is a
// scale decision, not a style one: the dashboard navigates 25 markets by
// counting rows per level in the database, and a read-time derivation would mean
// loading the table to count it.
//
// The three levels, and what each means:
//   country      the sovereign state, spelled out ("United States", not "USA")
//   region_state the state / province / emirate ("Nevada", "Ontario", "Dubai")
//   market       the local market: a city, a county, or a named district
//
// PARTIAL RESOLUTION IS A RESULT, NOT A FAILURE. A record that resolves only to
// a country keeps country set and the lower levels null. It is never dropped and
// never hidden; it appears in a labelled bucket at the level it reached.
//
// The input strings are what the sources actually produce, surveyed over the
// stored corpus before this was written:
//   "Las Vegas, NV"                      US city + state code       (government)
//   "Clark County, NV"                   US county + state code     (government)
//   "Chicago, Illinois, USA"             US city + state + country  (intelligence)
//   "Abu Dhabi, United Arab Emirates"    city + country             (intelligence)
//   "Saudi Arabia"                       country only               (intelligence)
//   "Toronto, ON"                        Canadian city + province   (legacy)
//   "CZ010, CZE" / "ROU" / "FIN"         NUTS region + ISO3 code    (legacy TED)
//   "Regional" / "00" / "EC4M8AY"        unresolvable               (legacy)

export interface Geography {
  country: string | null;
  region_state: string | null;
  market: string | null;
}

export const UNRESOLVED: Geography = { country: null, region_state: null, market: null };

const US = 'United States';
const CANADA = 'Canada';

// US states and DC, by postal code and by name.
const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  PR: 'Puerto Rico',
};
const US_STATE_NAMES = new Set(Object.values(US_STATES).map((s) => s.toLowerCase()));

const CA_PROVINCES: Record<string, string> = {
  AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador', NS: 'Nova Scotia', NT: 'Northwest Territories',
  NU: 'Nunavut', ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec',
  SK: 'Saskatchewan', YT: 'Yukon',
};
const CA_PROVINCE_NAMES = new Set(Object.values(CA_PROVINCES).map((s) => s.toLowerCase()));

// ISO 3166 alpha-3 to country name, for the legacy TED rows, plus alpha-2 for the
// NUTS prefixes those rows carry ("CZ010, CZE").
const ISO3: Record<string, string> = {
  ALB: 'Albania', ARE: 'United Arab Emirates', ARG: 'Argentina', AUS: 'Australia',
  AUT: 'Austria', AZE: 'Azerbaijan', BEL: 'Belgium', BGR: 'Bulgaria', BHR: 'Bahrain',
  BHS: 'Bahamas', BRA: 'Brazil', CAN: 'Canada', CHE: 'Switzerland', CHN: 'China',
  CPV: 'Cabo Verde', CYM: 'Cayman Islands', CYP: 'Cyprus', CZE: 'Czechia',
  DEU: 'Germany', DNK: 'Denmark', DOM: 'Dominican Republic', EGY: 'Egypt',
  ESP: 'Spain', EST: 'Estonia', FIN: 'Finland', FRA: 'France', GBR: 'United Kingdom',
  GRC: 'Greece', HRV: 'Croatia', HUN: 'Hungary', IDN: 'Indonesia', IND: 'India',
  IRL: 'Ireland', ISL: 'Iceland', ITA: 'Italy', JAM: 'Jamaica', JPN: 'Japan',
  KAZ: 'Kazakhstan', KEN: 'Kenya', KGZ: 'Kyrgyzstan', KOR: 'South Korea',
  KWT: 'Kuwait', LTU: 'Lithuania', LUX: 'Luxembourg', LVA: 'Latvia', MAR: 'Morocco',
  MEX: 'Mexico', MLT: 'Malta', MYS: 'Malaysia', NLD: 'Netherlands', NOR: 'Norway',
  NZL: 'New Zealand', OMN: 'Oman', PHL: 'Philippines', POL: 'Poland', PRT: 'Portugal',
  QAT: 'Qatar', ROU: 'Romania', RWA: 'Rwanda', SAU: 'Saudi Arabia', SGP: 'Singapore',
  SLV: 'El Salvador', SOM: 'Somalia', SRB: 'Serbia', SVK: 'Slovakia', SVN: 'Slovenia',
  SWE: 'Sweden', THA: 'Thailand', TUR: 'Turkey', USA: US, VNM: 'Vietnam',
  ZAF: 'South Africa',
  ARM: 'Armenia', BGD: 'Bangladesh', BIH: 'Bosnia and Herzegovina', BWA: 'Botswana',
  CHL: 'Chile', CIV: 'Ivory Coast', CMR: 'Cameroon', COL: 'Colombia',
  CRI: 'Costa Rica', DMA: 'Dominica', ETH: 'Ethiopia', GEO: 'Georgia',
  GHA: 'Ghana', GTM: 'Guatemala', ISR: 'Israel', JOR: 'Jordan', KHM: 'Cambodia',
  LAO: 'Laos', LBN: 'Lebanon', LKA: 'Sri Lanka', MDA: 'Moldova', MDV: 'Maldives',
  MKD: 'North Macedonia', MNE: 'Montenegro', MNG: 'Mongolia', MOZ: 'Mozambique',
  MUS: 'Mauritius', MWI: 'Malawi', NAM: 'Namibia', NGA: 'Nigeria', NPL: 'Nepal',
  PAK: 'Pakistan', PAN: 'Panama', PER: 'Peru', PNG: 'Papua New Guinea',
  SEN: 'Senegal', TON: 'Tonga', TTO: 'Trinidad and Tobago', TZA: 'Tanzania',
  UGA: 'Uganda', URY: 'Uruguay', UZB: 'Uzbekistan', ZMB: 'Zambia', ZWE: 'Zimbabwe',
};
const ISO2_TO_ISO3: Record<string, string> = {
  AE: 'ARE', AL: 'ALB', AT: 'AUT', AU: 'AUS', AZ: 'AZE', BE: 'BEL', BG: 'BGR',
  BH: 'BHR', BR: 'BRA', CA: 'CAN', CH: 'CHE', CN: 'CHN', CY: 'CYP', CZ: 'CZE',
  DE: 'DEU', DK: 'DNK', EE: 'EST', EG: 'EGY', EL: 'GRC', ES: 'ESP', FI: 'FIN',
  FR: 'FRA', GR: 'GRC', HR: 'HRV', HU: 'HUN', IE: 'IRL', IN: 'IND', IS: 'ISL',
  IT: 'ITA', JP: 'JPN', KE: 'KEN', KR: 'KOR', KW: 'KWT', LT: 'LTU', LU: 'LUX',
  LV: 'LVA', MA: 'MAR', MT: 'MLT', MX: 'MEX', MY: 'MYS', NL: 'NLD', NO: 'NOR',
  NZ: 'NZL', OM: 'OMN', PH: 'PHL', PL: 'POL', PT: 'PRT', QA: 'QAT', RO: 'ROU',
  RS: 'SRB', SA: 'SAU', SE: 'SWE', SG: 'SGP', SI: 'SVN', SK: 'SVK', TH: 'THA',
  TR: 'TUR', UK: 'GBR', GB: 'GBR', US: 'USA', VN: 'VNM', ZA: 'ZAF',
};

// Country names as sources write them, including the aliases they use.
const COUNTRY_ALIASES: Record<string, string> = {
  usa: US, 'u.s.a.': US, 'u.s.': US, us: US, 'united states of america': US,
  uae: 'United Arab Emirates', 'u.a.e.': 'United Arab Emirates',
  uk: 'United Kingdom', 'u.k.': 'United Kingdom', 'great britain': 'United Kingdom',
  england: 'United Kingdom', scotland: 'United Kingdom', wales: 'United Kingdom',
  'northern ireland': 'United Kingdom',
  'korea, republic of': 'South Korea', 'republic of korea': 'South Korea',
  'somalia, federal republic of': 'Somalia',
  'cape verde': 'Cabo Verde', 'czech republic': 'Czechia',
  'the bahamas': 'Bahamas', 'the netherlands': 'Netherlands',
  'kingdom of saudi arabia': 'Saudi Arabia', ksa: 'Saudi Arabia',
  'hong kong': 'Hong Kong', macau: 'Macau', macao: 'Macau',
  // Formal names the development banks and UN portals use.
  "lao people's democratic republic": 'Laos', 'lao pdr': 'Laos',
  'kyrgyz republic': 'Kyrgyzstan', 'republic of moldova': 'Moldova',
  "cote d'ivoire": 'Ivory Coast', "côte d'ivoire": 'Ivory Coast',
  'viet nam': 'Vietnam', 'russian federation': 'Russia',
  'syrian arab republic': 'Syria', 'united republic of tanzania': 'Tanzania',
  'iran, islamic republic of': 'Iran', 'egypt, arab republic of': 'Egypt',
  'macedonia': 'North Macedonia', 'swaziland': 'Eswatini',
  'east timor': 'Timor-Leste', 'burma': 'Myanmar',
};
const KNOWN_COUNTRIES = new Set<string>([
  ...Object.values(ISO3),
  'Hong Kong', 'Macau', 'Bahamas', 'Barbados', 'Belize', 'Bermuda', 'Chile',
  'Colombia', 'Costa Rica', 'Ecuador', 'Fiji', 'Ghana', 'Guyana', 'Israel',
  'Jordan', 'Lebanon', 'Maldives', 'Mauritius', 'Monaco', 'Montenegro',
  'Nigeria', 'Panama', 'Peru', 'Seychelles', 'Sri Lanka', 'Tanzania', 'Trinidad and Tobago',
  'Uganda', 'Uruguay', 'Zambia', 'Zimbabwe',
  // Added from the backfill's unresolved list: every one of these appeared as a
  // location string the resolver could not name. A country table is just data,
  // and an unresolved row is a row that cannot be navigated to.
  'Afghanistan', 'Algeria', 'Angola', 'Antigua and Barbuda', 'Argentina', 'Armenia',
  'Bangladesh', 'Benin', 'Bhutan', 'Bolivia', 'Bosnia and Herzegovina', 'Botswana',
  'Brunei', 'Burkina Faso', 'Burundi', 'Cambodia', 'Cameroon', 'Chad', 'Comoros',
  'Cuba', 'Djibouti', 'Dominica', 'Eritrea', 'Eswatini', 'Ethiopia', 'Gabon',
  'Gambia', 'Georgia', 'Grenada', 'Guatemala', 'Guinea', 'Haiti', 'Honduras',
  'Iraq', 'Ivory Coast', 'Kiribati', 'Kosovo', 'Laos', 'Lesotho', 'Liberia',
  'Libya', 'Liechtenstein', 'Madagascar', 'Malawi', 'Mali', 'Mauritania',
  'Micronesia', 'Moldova', 'Mongolia', 'Mozambique', 'Namibia', 'Nepal',
  'Nicaragua', 'Niger', 'North Macedonia', 'Pakistan', 'Palau', 'Papua New Guinea',
  'Paraguay', 'Rwanda', 'Saint Kitts and Nevis', 'Saint Lucia',
  'Saint Vincent and the Grenadines', 'Samoa', 'San Marino', 'Senegal',
  'Sierra Leone', 'Solomon Islands', 'South Sudan', 'Sudan', 'Suriname',
  'Tajikistan', 'Timor-Leste', 'Togo', 'Tonga', 'Tunisia', 'Turkmenistan',
  'Tuvalu', 'Ukraine', 'Uzbekistan', 'Vanuatu', 'Venezuela', 'Yemen',
]);

// Sub-national regions that sources write as if they were countries. Mapping
// them keeps an emirate or a special administrative region at the right level.
const REGION_OF_COUNTRY: Record<string, { country: string; region: string }> = {
  dubai: { country: 'United Arab Emirates', region: 'Dubai' },
  'abu dhabi': { country: 'United Arab Emirates', region: 'Abu Dhabi' },
  sharjah: { country: 'United Arab Emirates', region: 'Sharjah' },
  'ras al khaimah': { country: 'United Arab Emirates', region: 'Ras Al Khaimah' },
  ajman: { country: 'United Arab Emirates', region: 'Ajman' },
  fujairah: { country: 'United Arab Emirates', region: 'Fujairah' },
  'umm al quwain': { country: 'United Arab Emirates', region: 'Umm Al Quwain' },
};

// US sub-state regions that sources name instead of a city. They resolve to
// their state and keep the regional name as the market, because that is the
// market as the source knows it (SFWMD files against "South Florida", not a
// city).
const US_SUBREGIONS: Record<string, string> = {
  'south florida': 'Florida',
  'central florida': 'Florida',
  'north florida': 'Florida',
  'southwest florida': 'Florida',
  'southern california': 'California',
  'northern california': 'California',
  'southern nevada': 'Nevada',
  'northern nevada': 'Nevada',
};

// Metro names that stand in for a province or state. Canadian job and tender
// sources write "Burnaby, Greater Vancouver" with no province at all.
const METRO_REGIONS: Record<string, { country: string; region: string }> = {
  'greater vancouver': { country: CANADA, region: 'British Columbia' },
  'greater toronto': { country: CANADA, region: 'Ontario' },
  'greater montreal': { country: CANADA, region: 'Quebec' },
  'new york city': { country: US, region: 'New York' },
};

// Jurisdictions THIS SYSTEM configures, named without a state because the source
// is the jurisdiction itself ("City of Anaheim" from the Anaheim agenda portal).
// Every entry is a market the lanes are pointed at, so this is configuration
// echoed back, not geographic guesswork.
const CONFIGURED_JURISDICTIONS: Record<string, { region: string; market: string }> = {
  'city of anaheim': { region: 'California', market: 'Anaheim' },
  anaheim: { region: 'California', market: 'Anaheim' },
  'city of huntington beach': { region: 'California', market: 'Huntington Beach' },
  'huntington beach': { region: 'California', market: 'Huntington Beach' },
  'city of las vegas': { region: 'Nevada', market: 'Las Vegas' },
  'las vegas': { region: 'Nevada', market: 'Las Vegas' },
  orlando: { region: 'Florida', market: 'Orlando' },
  kissimmee: { region: 'Florida', market: 'Kissimmee' },
  'altamonte springs': { region: 'Florida', market: 'Altamonte Springs' },
  'bonita springs': { region: 'Florida', market: 'Bonita Springs' },
  'lake buena vista': { region: 'Florida', market: 'Lake Buena Vista' },
  miami: { region: 'Florida', market: 'Miami' },
  atlanta: { region: 'Georgia', market: 'Atlanta' },
  nashville: { region: 'Tennessee', market: 'Nashville' },
  phoenix: { region: 'Arizona', market: 'Phoenix' },
  'san antonio': { region: 'Texas', market: 'San Antonio' },
  oakland: { region: 'California', market: 'Oakland' },
  // Downstate New York. Yonkers and Westchester are separate markets because an
  // entitlement is filed with one of them and not the other, the same reason
  // Las Vegas the city and Clark County the county are not merged.
  yonkers: { region: 'New York', market: 'Yonkers' },
  'city of yonkers': { region: 'New York', market: 'Yonkers' },
  'westchester county': { region: 'New York', market: 'Westchester County' },
  westchester: { region: 'New York', market: 'Westchester County' },
  // NEW YORK CITY IS ONE MARKET, NOT FIVE. See MARKET_ALIASES below for why the
  // boroughs fold into it. Listed here so the market string is produced by
  // configuration rather than by whatever a press headline happened to say:
  // three of the five NYC rows in the corpus carried market 'New York City'
  // with region_state null, because they arrived through the free-text path
  // and never met a configured jurisdiction.
  'new york city': { region: 'New York', market: 'New York City' },
  'city of new york': { region: 'New York', market: 'New York City' },
  nyc: { region: 'New York', market: 'New York City' },
  // The boroughs resolve here as well as in MARKET_ALIASES because the two
  // paths answer different questions. The alias table normalises a market that
  // has already been identified; this table resolves a BARE jurisdiction
  // string, which is what a press dateline gives us ("Queens"). Both are
  // needed: without this entry "Queens" resolved to nothing at all, which is
  // how one of the five NYC records ended up outside the city entirely.
  manhattan: { region: 'New York', market: 'New York City' },
  brooklyn: { region: 'New York', market: 'New York City' },
  queens: { region: 'New York', market: 'New York City' },
  bronx: { region: 'New York', market: 'New York City' },
  'the bronx': { region: 'New York', market: 'New York City' },
  'staten island': { region: 'New York', market: 'New York City' },
};

// Market aliases: distinct strings that name ONE market. Kept deliberately short
// and obvious. Jurisdictions that are genuinely distinct (Las Vegas the city vs
// Clark County the county) are NOT merged, because an entitlement is filed with
// one of them and not the other.
const MARKET_ALIASES: Record<string, string> = {
  'las vegas strip': 'Las Vegas',
  'the strip': 'Las Vegas',
  'south florida': 'South Florida',
  // THE FIVE BOROUGHS ARE ONE MARKET, and this is the one place the decision is
  // recorded. It is not obviously right - Manhattan and Staten Island are not
  // one property market by any professional reading - and it is chosen anyway,
  // for two reasons that are about the product rather than about geography.
  //
  // A market is what a client SELECTS. client_scopes.markets holds strings a
  // person ticks in the intake form, and "New York City" is the thing a client
  // asks to be covered for. Five borough rows would make the city itself
  // unselectable: a scope naming New York City would match nothing while five
  // scopes named after boroughs matched everything, which is precisely the
  // silently-empty scope the preview exists to prevent.
  //
  // And the corpus already disagrees with itself. Five NYC records arrived
  // under three different market strings - 'New York City', 'Manhattan',
  // 'Queens' - so without a fold the city is already fragmented across markets
  // no client will ever tick.
  //
  // Reversing this later is a data migration, not a config change, so it is
  // written down rather than left to be inferred. If NYC ever earns per-borough
  // coverage, the entitlement source (ZAP) carries a `borough` column and the
  // split can be driven from it.
  manhattan: 'New York City',
  brooklyn: 'New York City',
  queens: 'New York City',
  'the bronx': 'New York City',
  bronx: 'New York City',
  'staten island': 'New York City',
  'new york, ny': 'New York City',
  'new york city, ny': 'New York City',
};

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();
const titleish = (s: string): string => clean(s).replace(/\s*,\s*$/, '');

// Strings that carry no geography at all.
const NOISE = /^(regional|global|worldwide|various|multiple|n\/?a|none|unknown|tbd|00|[0-9]+)$/i;

function countryFromName(raw: string): string | null {
  const k = clean(raw).toLowerCase();
  if (!k) return null;
  if (COUNTRY_ALIASES[k]) return COUNTRY_ALIASES[k];
  for (const c of KNOWN_COUNTRIES) if (c.toLowerCase() === k) return c;
  return null;
}

// ---- A PLACE NAME IS NOT A CODE, AND THE NAME TABLE GOES FIRST -------------
//
// ONE DEFECT, EIGHT INSTANCES, ALL THE SAME SHAPE: a place name matched against
// a country or NUTS code by its LEADING CHARACTERS.
//
//   Austin -> AU -> Australia          Zambia -> ZA -> South Africa
//   Fiji   -> FI -> Finland            Malawi -> MA -> Morocco
//   Chad   -> CH -> Switzerland        Gambia, The -> TH -> Thailand
//   Bronx  -> BR -> Brazil             Georgia -> the US state, not the country
//
// THE BRANCH THAT DID IT was not the one the earlier Bronx fix patched. It is
// `parts.every(codeLike)`, the legacy TED path, and it fires on a SINGLE-WORD
// place name because one word trivially satisfies "every". The Bronx fix put a
// configured-jurisdiction lookup in front of it, which is why Bronx and Queens
// resolve today and Austin still does not: Austin is not a market we cover, so
// no table rescued it.
//
// THE FIX IS THE SHAPE OF A REAL CODE, NOT A LIST OF EXCLUSIONS. Measured
// against the pattern that was there:
//
//   Austin Fiji Chad Zambia Malawi Gambia The Queens Bronx   all codeLike=true
//   CZ010 PL637 HU322                                        codeLike=true
//   US GB                                                    codeLike=FALSE
//
// The old pattern accepted every one of those words and REJECTED the two-letter
// ISO2 codes it was supposedly there for. A real identifier is one of exactly
// three things and nothing else:
//
//   ISO2   exactly two letters                       US, GB
//   ISO3   exactly three letters                     CZE, ROU, FIN
//   NUTS   two letters then 1-3 more CONTAINING A DIGIT   CZ010, PL637, HU322
//
// The digit is what separates a region code from an English word. Every real
// NUTS code in this corpus carries one; no place name does.
//
// AND THE NAME TABLE IS CONSULTED FIRST regardless, so a token that names a
// country can never be read as a code even if it were code-shaped.
const ISO2 = /^[A-Z]{2}$/;
const ISO3_SHAPE = /^[A-Z]{3}$/;
// The digit is what separates a region code from an English word - with ONE
// standard exception. NUTS marks "extra-regio", the rest of a country outside
// any named region, as ZZZ: HRZZZ, DEZZZ, ESZZZ, BEZZZ are all real and carry no
// digit. Measured: requiring a digit lost 6 live records across four countries.
// ZZZ is admitted by name rather than by loosening the shape, because it is one
// literal and any other all-letter suffix is a word.
const NUTS = /^[A-Z]{2}(?:ZZZ|(?=[0-9A-Z]{1,3}$)[0-9A-Z]*[0-9][0-9A-Z]*)$/;

export function looksLikeCode(raw: string): boolean {
  const k = clean(raw).toUpperCase();
  return ISO2.test(k) || ISO3_SHAPE.test(k) || NUTS.test(k);
}

// "CZE" -> Czechia; "CZ010" -> Czechia (NUTS region code, country from prefix).
function countryFromCode(raw: string): string | null {
  const k = clean(raw).toUpperCase();
  // THE NAME TABLE FIRST. "Chad" is a country before it is CH + AD.
  if (countryFromName(raw)) return null;
  if (!looksLikeCode(k)) return null;
  if (ISO3_SHAPE.test(k) && ISO3[k]) return ISO3[k];
  if (NUTS.test(k)) {
    const iso3 = ISO2_TO_ISO3[k.slice(0, 2)];
    if (iso3 && ISO3[iso3]) return ISO3[iso3];
  }
  if (ISO2.test(k) && ISO2_TO_ISO3[k]) return ISO3[ISO2_TO_ISO3[k]];
  return null;
}

function marketName(raw: string): string | null {
  const m = titleish(raw);
  if (!m || NOISE.test(m)) return null;
  const alias = MARKET_ALIASES[m.toLowerCase()];
  return alias ?? m;
}

// The resolver. `countryHint` is an ISO alpha-2 some adapters already carry on
// the lead; it is used only when the location string cannot name a country.
export function resolveGeography(
  location: string | null | undefined,
  countryHint?: string | null
): Geography {
  const hintCountry = countryHint ? countryFromCode(countryHint) ?? countryFromName(countryHint) : null;
  const raw = clean(String(location ?? ''));
  if (!raw || NOISE.test(raw)) {
    return hintCountry ? { country: hintCountry, region_state: null, market: null } : { ...UNRESOLVED };
  }

  // A JURISDICTION THIS SYSTEM CONFIGURES IS NEVER REINTERPRETED AS A CODE.
  //
  // This lookup also happens further down, and it has to happen HERE as well,
  // because the code-shaped branches below get first refusal on a bare single
  // token and one of them was claiming a borough.
  //
  // Measured, not theorised: "Bronx" resolved to BRAZIL. The NUTS region-code
  // pattern is two letters followed by one to four alphanumerics ("CZ010",
  // "PL637"), and "BRONX" satisfies it - BR + ONX - so countryFromCode read the
  // BR prefix as Brazil and returned before the jurisdiction table was ever
  // consulted. 17 New York City records landed with country 'Brazil' and a null
  // market on the first scoped NYC run.
  //
  // "Queens" is the same shape (QU + EENS) and escaped only because QU is not
  // an assigned country code. That is luck, not a rule, so the fix is placed
  // where it covers every configured jurisdiction rather than special-casing
  // the one that happened to collide.
  const configuredFirst = CONFIGURED_JURISDICTIONS[raw.toLowerCase()];
  if (configuredFirst) {
    return { country: US, region_state: configuredFirst.region, market: configuredFirst.market };
  }

  const parts = raw.split(',').map(clean).filter(Boolean);
  if (parts.length === 0) return hintCountry ? { country: hintCountry, region_state: null, market: null } : { ...UNRESOLVED };

  // A legacy TED string: the last segment is an ISO3 code AND every earlier
  // segment is a NUTS region code. The "every earlier segment" test matters,
  // because "Chicago, Illinois, USA" also ends in a three-letter country code
  // and must NOT be treated as a code string: it has a state and a market in it.
  const last = parts[parts.length - 1];
  // The same shape test the code lookup uses. See looksLikeCode: a word is not
  // a code, and this branch used to fire on any single word because one word
  // trivially satisfies `every`.
  const codeLike = looksLikeCode;
  if (parts.every(codeLike)) {
    // The ISO3 code is not always last: sources also write "HUN, HU322" and
    // "PL637, POL, PL417". Any segment that is a country code names the country.
    const iso3 = parts.map((p) => p.toUpperCase()).find((p) => /^[A-Z]{3}$/.test(p) && ISO3[p]);
    if (iso3) return { country: ISO3[iso3], region_state: null, market: null };
    const fromNuts = parts.map(countryFromCode).find(Boolean);
    if (fromNuts) return { country: fromNuts, region_state: null, market: null };
  }
  if (parts.length === 1) {
    const codeOnly = countryFromCode(parts[0]);
    if (codeOnly && looksLikeCode(parts[0])) {
      return { country: codeOnly, region_state: null, market: null };
    }
  }

  // ---- A BARE TOKEN THAT IS BOTH A COUNTRY AND A US STATE IS THE COUNTRY ----
  //
  // "Georgia" on its own is the country. "Atlanta, Georgia" is the state, and it
  // has two segments, so the state scan below still gets it. The rule is narrow
  // on purpose: one segment, and the name is in both tables.
  if (parts.length === 1) {
    const asCountry = countryFromName(parts[0]);
    if (asCountry && US_STATE_NAMES.has(parts[0].toLowerCase())) {
      return { country: asCountry, region_state: null, market: null };
    }
  }

  // Scan for a US state or Canadian province anywhere in the string. Government
  // records are "City, ST"; intelligence records are "City, State, USA".
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const up = p.toUpperCase();
    const low = p.toLowerCase();
    let region: string | null = null;
    let country: string | null = null;
    if (US_STATES[up]) {
      region = US_STATES[up];
      country = US;
    } else if (US_STATE_NAMES.has(low)) {
      region = Object.values(US_STATES).find((s) => s.toLowerCase() === low) ?? null;
      country = US;
    } else if (CA_PROVINCES[up]) {
      region = CA_PROVINCES[up];
      country = CANADA;
    } else if (CA_PROVINCE_NAMES.has(low)) {
      region = Object.values(CA_PROVINCES).find((s) => s.toLowerCase() === low) ?? null;
      country = CANADA;
    }
    if (region && country) {
      const market = i > 0 ? marketName(parts[i - 1]) : null;
      return { country, region_state: region, market };
    }
  }

  // A named US sub-state region ("South Florida").
  const sub = US_SUBREGIONS[raw.toLowerCase()];
  if (sub) return { country: US, region_state: sub, market: marketName(raw) };

  // A metro name standing in for a province ("Burnaby, Greater Vancouver").
  const metro = METRO_REGIONS[last.toLowerCase()];
  if (metro) {
    const market = parts.length > 1 ? marketName(parts[parts.length - 2]) : marketName(last);
    return { country: metro.country, region_state: metro.region, market };
  }

  // A jurisdiction this system is configured to capture, named on its own.
  const configured = CONFIGURED_JURISDICTIONS[raw.toLowerCase()];
  if (configured) {
    return { country: US, region_state: configured.region, market: configured.market };
  }

  // "City, Country" or "Country". The last segment is tried first, then any
  // other segment, because sources also write "Somalia, Federal Republic of",
  // where the country is the FIRST segment and the rest is constitutional form.
  const named = countryFromName(last) ?? parts.map(countryFromName).find(Boolean) ?? null;
  if (named) {
    let market = parts.length > 1 ? marketName(parts[parts.length - 2]) : null;
    // The country can be named in any segment ("Somalia, Federal Republic of"),
    // so the segment before the last is not always a market. Never let a market
    // repeat its own country.
    if (market && market.toLowerCase() === named.toLowerCase()) market = null;
    // A city that is itself an emirate / region keeps its level.
    const asRegion = market ? REGION_OF_COUNTRY[market.toLowerCase()] : undefined;
    if (asRegion && asRegion.country === named) {
      return { country: named, region_state: asRegion.region, market };
    }
    return { country: named, region_state: null, market };
  }

  // A bare emirate or region written as if it were the whole location.
  const asRegion = REGION_OF_COUNTRY[last.toLowerCase()];
  if (asRegion) {
    return { country: asRegion.country, region_state: asRegion.region, market: marketName(last) };
  }

  // Nothing named a country. Fall back to the adapter's hint, keeping the market
  // when the string still names a place.
  if (hintCountry) return { country: hintCountry, region_state: null, market: marketName(parts[0]) };
  return { ...UNRESOLVED };
}

// The row fields to spread into any leads write. One call, every write path.
export function geographyFields(
  location: string | null | undefined,
  countryHint?: string | null
): Geography {
  return resolveGeography(location, countryHint);
}
