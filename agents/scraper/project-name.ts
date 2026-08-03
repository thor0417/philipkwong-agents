// PROJECT NAMES EXTRACTED FROM TRADE PRESS, so the intelligence lane can cluster
// at all.
//
// THE GAP THIS CLOSES. 391 of 410 intelligence records carry no project, which is
// 82 percent of them and most of the Inbox. They are not failing the clusterer's
// rules; they are invisible to all four of them. Trade press names a project and
// carries no case number, no applicant field and no street address, so the case,
// entity and site signals find nothing, and the target signal only fires for the
// five projects somebody has already written into targets.ts.
//
// That last point is the important one. Without a name signal, the register can
// only ever contain projects we already knew about, and a market with no
// government coverage can never appear in it at all. This is the only mechanism
// by which the register learns a project it was not told about.
//
// THE EXTRACTION, and why it is this and not something cleverer. A headline names
// a project in exactly one reliable way: a run of capitalised words. So the
// method is
//
//   1. strip the publisher's chrome (trailing ellipsis, " - Source Name",
//      " | Publisher", a leading "[PDF]"),
//   2. take every run of capitalised tokens, allowing lowercase connectives
//      (of, the, at, and, de, la) INSIDE a run but never at its edges,
//   3. reject the runs that cannot identify a project, per the guards below,
//   4. cluster on what survives, within a market.
//
// It reads the TITLE only. The body is the article, and an article about the
// Gold Eagle Casino mentions six other operators; the headline does not.
//
// THE GUARDS ARE THE DESIGN. Every one of them was written before the rule was
// measured, and each exists because the alternative is a false merge, which is
// worse than the miss it prevents:
//
//   NEVER AN OPERATOR OR BRAND ALONE. Marriott, Hilton, Accor, IHG, Disney,
//   Universal and Merlin name a PORTFOLIO. Two records both saying "Hilton" are
//   not the same project and usually not even the same continent. But a brand
//   inside a longer name is fine and often necessary - "Warner Bros World Abu
//   Dhabi" is one specific park - so the test is whether the phrase is ENTIRELY
//   brand tokens, not whether it contains one.
//
//   NEVER A PLACE ALONE. Saudi Arabia and Orlando are markets, not projects.
//   This is the Russell Road and Platinum Triangle lesson for the third time: a
//   place says where a project is, not which project it is. Same shape of test -
//   entirely place tokens is refused, a place inside a longer name is kept,
//   because "Ras El Hekma" and "Greater Sentosa" are how those projects are
//   actually named.
//
//   NEVER SOLELY GENERIC. "Theme Park", "Integrated Resort", "Master Plan" and
//   "Feasibility Study" are categories. Every market has several.
//
//   AT LEAST TWO WORDS. One capitalised word is a brand, a city or a sentence
//   start, and almost never a project.
//
//   NEVER ACROSS MARKETS. Enforced by the caller, which scopes the signal key by
//   market exactly as the case, entity and site signals are scoped.
//
// A phrase must therefore be multi-word AND not-entirely-brand AND
// not-entirely-place AND not-entirely-generic. Mixtures pass, which is the point:
// real project names are brand-plus-place ("Disney Abu Dhabi"), place-plus-generic
// ("Sentosa Master Plan" - though see MIN_DISTINCT below) or wholly distinctive
// ("Qiddiya", "Ningaloo").

// WHICH RECORDS THE NAME SIGNAL IS ALLOWED TO TOUCH, and why it is only one.
//
// This rule exists for trade press and must never run on a government record.
// That is not caution, it is a measurement. Applied to the whole 1320-record
// corpus the extraction produced 332 multi-record name keys, and the largest
// were all procedural boilerplate joining records that are definitively
// different projects:
//
//   "design review"                 17 Clark County records across 9 projects
//   "bill no"                       13 Las Vegas records across 7 projects
//   "a resolution"                  12 Nashville records across 6 projects
//   "public hearing"                12 Las Vegas records across 9 projects
//   "cr commercial resort zone"     11 Clark County records across 5 projects
//   "item no"                       11 Anaheim records across 5 projects
//   "liquor license"                10 Phoenix records across 5 projects
//   "development agreement"         10 Clark County records across 6 projects
//   "dod vka"                       18 Czech and Slovak natural-gas tenders
//
// Every one of those is a false merge, and several would have destroyed
// clustering that already works. A government title is a procedural instrument
// with a case number; the case, entity and site signals read it correctly and
// this one cannot. Trade press is the opposite: no case number, no applicant
// field, no address, and a headline that names the project.
//
// So the signal is scoped to the stream it was built for. The vocabulary guards
// below are defence in depth behind this line, not instead of it.
export const NAME_SIGNAL_STREAMS = new Set(['intelligence']);

export function nameSignalApplies(stream: string | null | undefined): boolean {
  return NAME_SIGNAL_STREAMS.has(stream ?? '');
}

// ---- Vocabulary --------------------------------------------------------------

// Words that describe a CATEGORY of development. A phrase made only of these
// names a class, not a project.
const GENERIC = new Set([
  'resort', 'resorts', 'hotel', 'hotels', 'motel', 'project', 'projects',
  'development', 'developments', 'developer', 'park', 'parks', 'casino',
  'casinos', 'theme', 'water', 'waterpark', 'entertainment', 'city', 'centre',
  'center', 'complex', 'master', 'masterplan', 'plan', 'plans', 'planning',
  'study', 'studies', 'feasibility', 'tourism', 'tourist', 'attraction',
  'attractions', 'venue', 'venues', 'arena', 'stadium', 'zoo', 'aquarium',
  'museum', 'district', 'village', 'island', 'islands', 'bay', 'beach', 'world',
  'land', 'group', 'holdings', 'properties', 'property', 'company', 'corporation',
  'corp', 'international', 'global', 'new', 'phase', 'site', 'design', 'designs',
  'construction', 'board', 'authority', 'ministry', 'department', 'council',
  'request', 'proposal', 'proposals', 'rfp', 'rfq', 'pdf', 'news', 'media',
  'update', 'updates', 'announces', 'announced', 'reveals', 'unveils', 'launches',
  'integrated', 'mixed', 'use', 'leisure', 'recreation', 'recreational',
  'hospitality', 'gaming', 'expansion', 'redevelopment', 'renovation', 'marina',
  'golf', 'spa', 'lodge', 'cabin', 'apartments', 'residential', 'commercial',
  'retail', 'office', 'mall', 'centre', 'convention', 'conference', 'exhibition',
  'sports', 'resort', 'waterfront', 'coastal', 'eco', 'luxury', 'boutique',
  'the', 'and', 'for', 'of', 'at', 'in', 'on', 'to', 'a', 'an', 'is', 'are',
  'with', 'by', 'from', 'its', 'it', 'as', 'be', 'has', 'have', 'will',
  'billion', 'million', 'bn', 'm', 'us', 'au', 'set', 'first', 'second', 'third',
  'north', 'south', 'east', 'west', 'central', 'upper', 'lower', 'greater',
  'inc', 'llc', 'lp', 'llp', 'ltd', 'plc', 'sa', 'nv', 'bv', 'gmbh', 'pty',
  // GOVERNMENT PROCEDURAL BOILERPLATE. Defence in depth only - the real
  // protection is that this rule never runs on a government record at all (see
  // NAME_SIGNAL_STREAMS) - but these are here because the corpus-wide test that
  // established the need for that scoping produced merges on exactly these
  // phrases, and a future caller that widens the scope should hit a wall rather
  // than a cliff. Measured: "design review" joined 17 Clark County records
  // across 9 different projects, "bill no" 13 across 7, "a resolution" 12
  // across 6, "public hearing" 12 across 9, "liquor license" 10 across 5.
  'bill', 'no', 'resolution', 'ordinance', 'hearing', 'public', 'review',
  'application', 'applications', 'permit', 'permits', 'waiver', 'waivers',
  'standards', 'license', 'licence', 'zone', 'zoning', 'overlay', 'agreement',
  'item', 'items', 'abeyance', 'holdover', 'renotification', 'variance',
  'tentative', 'map', 'entitlement', 'entitlements', 'ord', 'sdr', 'gpa',
  'amendment', 'amendments', 'consultancy', 'services', 'service', 'general',
  'specific', 'environs', 'airport', 'commercial', 'principal', 'outdoor',
  'storage', 'driveway', 'geometrics', 'acres', 'acre', 'lot', 'lots',
  'district', 'districts', 'ae', 'cr', 'uc', 'ws', 'zc', 'tm', 'et', 'ar',
]);

// Operators, brands and portfolio owners. A phrase made only of these names a
// company, not a project.
const BRAND = new Set([
  'marriott', 'hilton', 'accor', 'ihg', 'intercontinental', 'hyatt', 'wyndham',
  'radisson', 'sheraton', 'westin', 'ritz', 'carlton', 'regis', 'waldorf',
  'astoria', 'kempinski', 'rotana', 'jumeirah', 'shangri', 'la', 'mandarin',
  'oriental', 'fairmont', 'sofitel', 'novotel', 'ibis', 'raffles', 'banyan',
  'tree', 'aman', 'anantara', 'minor', 'montage', 'auberge', 'rosewood',
  'peninsula', 'dorchester', 'hoteles', 'melia', 'barcelo', 'riu', 'iberostar',
  'disney', 'disneyland', 'universal', 'merlin', 'seaworld', 'legoland',
  'cedar', 'fair', 'six', 'flags', 'busch', 'gardens', 'warner', 'bros',
  'brothers', 'paramount', 'sony', 'netflix', 'mattel', 'hasbro', 'lionsgate',
  'nickelodeon', 'dreamworks', 'pixar', 'marvel', 'lego',
  'mgm', 'caesars', 'wynn', 'sands', 'venetian', 'bellagio', 'bally', 'ballys',
  'hard', 'rock', 'genting', 'melco', 'galaxy', 'sjm', 'aquis', 'crown', 'star',
  'vici', 'blackstone', 'brookfield', 'kkr', 'club', 'med', 'clubmed',
  'four', 'seasons', 'hilton', 'marriott', 'legends', 'asf', 'openaire',
  'atlantis', 'emaar', 'damac', 'nakheel', 'aldar', 'majid', 'futtaim',
  // 'discovery' caught by the first false-merge test: "Warner Bros Discovery"
  // is the corporate parent, and the token kept the phrase alive after the
  // other three words were recognised as brand.
  //
  // 'sphere' is deliberately NOT here. Sphere Entertainment is an operator, but
  // "Sphere Abu Dhabi" is one specific announced venue and was the single best
  // merge the first test produced (3 records, all the same project). The market
  // scope already separates it from the Las Vegas Sphere, which is what a brand
  // stoplist would otherwise be doing.
  'discovery',
]);

// Places: countries, regions and the city names that appear as markets. A phrase
// made only of these names a geography.
const PLACE = new Set([
  'united', 'states', 'america', 'usa', 'canada', 'mexico', 'brazil', 'chile',
  'argentina', 'colombia', 'peru', 'panama', 'jamaica', 'bahamas', 'cayman',
  'dominican', 'republic', 'cuba', 'barbados', 'trinidad', 'tobago',
  'kingdom', 'britain', 'england', 'scotland', 'wales', 'ireland', 'france',
  'spain', 'portugal', 'italy', 'germany', 'netherlands', 'belgium', 'austria',
  'switzerland', 'sweden', 'norway', 'denmark', 'finland', 'iceland', 'poland',
  'czechia', 'hungary', 'romania', 'bulgaria', 'greece', 'turkey', 'croatia',
  'serbia', 'albania', 'montenegro', 'malta', 'cyprus', 'estonia', 'latvia',
  'lithuania', 'slovakia', 'slovenia', 'moldova', 'georgia', 'armenia',
  'azerbaijan', 'kazakhstan', 'kyrgyzstan', 'uzbekistan', 'mongolia', 'russia',
  'saudi', 'arabia', 'emirates', 'uae', 'dubai', 'abu', 'dhabi', 'sharjah',
  'ajman', 'fujairah', 'ras', 'khaimah', 'qatar', 'doha', 'kuwait', 'bahrain',
  'oman', 'muscat', 'jordan', 'lebanon', 'israel', 'egypt', 'cairo', 'morocco',
  'tunisia', 'algeria', 'libya', 'sudan', 'kenya', 'tanzania', 'uganda',
  'rwanda', 'ethiopia', 'ghana', 'nigeria', 'senegal', 'cameroon', 'zambia',
  'zimbabwe', 'botswana', 'namibia', 'mozambique', 'malawi', 'mauritius',
  'seychelles', 'maldives', 'india', 'pakistan', 'bangladesh', 'nepal',
  'lanka', 'china', 'japan', 'korea', 'taiwan', 'kong', 'macau', 'macao',
  'singapore', 'malaysia', 'indonesia', 'thailand', 'vietnam', 'cambodia',
  'laos', 'philippines', 'myanmar', 'brunei', 'australia', 'zealand', 'fiji',
  'papua', 'guinea', 'tonga', 'samoa', 'vanuatu',
  'queensland', 'victoria', 'nsw', 'sydney', 'melbourne', 'brisbane', 'perth',
  'adelaide', 'canberra', 'darwin', 'hobart', 'gold', 'coast', 'cairns',
  'london', 'manchester', 'birmingham', 'liverpool', 'glasgow', 'edinburgh',
  'bedford', 'hartlepool', 'douglas', 'milton', 'chicago', 'orlando', 'miami',
  'york', 'angeles', 'francisco', 'vegas', 'anaheim', 'dallas', 'houston',
  'austin', 'phoenix', 'denver', 'seattle', 'boston', 'atlanta', 'nashville',
  'oakland', 'antonio', 'diego', 'jose', 'portland', 'detroit', 'cleveland',
  'cheyenne', 'wyoming', 'arkansas', 'little', 'rock', 'palm', 'beaches',
  'battleford', 'saskatchewan', 'alberta', 'ontario', 'quebec', 'columbia',
  'toronto', 'vancouver', 'montreal', 'calgary', 'ottawa', 'winnipeg',
  'jeddah', 'riyadh', 'diriyah', 'neom', 'red', 'sea', 'mecca', 'medina',
  'bishkek', 'yiti', 'sentosa', 'hekma', 'montrose', 'pigeon', 'forge',
  'county', 'city', 'state', 'province', 'region', 'territory', 'national',
  // Sub-city districts that read as distinctive tokens but are addresses. 'yas'
  // was caught by the first false-merge test: "Yas Island" is the Abu Dhabi
  // leisure district holding Ferrari World, Warner Bros World, Yas Waterworld
  // and the proposed Sphere, so clustering on it would merge four unrelated
  // parks into one project. Exactly the Russell Road failure in another market.
  'yas', 'saadiyat', 'palm', 'jumeira', 'jbr', 'downtown', 'marina',
  // 'las' caught by the second false-merge test. 'vegas' was already here, but
  // 'las' was not, so "Las Vegas" scored one distinctive token and grouped three
  // unrelated Las Vegas stories under the city's own name - a place-alone merge,
  // which is the guard this list exists to enforce. The same trap applies to the
  // other article-like leaders in place names.
  'las', 'san', 'santa', 'los', 'el', 'al', 'ras', 'abu', 'ras', 'new', 'port',
  'saint', 'st', 'fort', 'lake', 'mount', 'cape', 'isle',
]);

// A phrase must contain at least this many words.
const MIN_WORDS = 2;

// AND at least this many tokens that are none of generic / brand / place. This is
// the strict half of the rule and it was added after measuring: "not entirely X"
// alone let through phrases like "Saudi Entertainment Ventures" (a company),
// "Greater Sentosa Master Plan" (a place plus a category) and "Dallas Mavericks
// Arena" - each a mixture of place and generic words with nothing of its own.
// Requiring one genuinely distinctive token is what separates "Ras El Hekma" from
// "Red Sea Project".
export const MIN_DISTINCT = 1;

// Connectives allowed INSIDE a capitalised run without breaking it.
const CONNECTIVE = new Set(['of', 'the', 'at', 'and', 'de', 'del', 'la', 'le', 'el', 'van', 'von', 'für', 'da', 'do']);

// ---- Extraction --------------------------------------------------------------

// Strip the publisher's chrome a search result carries.
export function stripChrome(title: string): string {
  let t = title.replace(/\s+/g, ' ').trim();
  t = t.replace(/^\[[^\]]{1,12}\]\s*/, '');           // "[PDF] "
  t = t.replace(/\s*[.…]{2,}\s*$/, '');                // trailing ellipsis
  t = t.replace(/\s*[|]\s*[^|]{0,60}$/, '');           // " | Publisher"
  t = t.replace(/\s+-\s+[A-Z][^-]{0,50}$/, '');        // " - Source Name"
  return t.trim();
}

function words(phrase: string): string[] {
  return phrase
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// Is a token distinctive - not a category word, not a brand, not a place?
function isDistinctive(w: string): boolean {
  if (w.length < 3) return false;
  if (/^\d+$/.test(w)) return false;
  return !GENERIC.has(w) && !BRAND.has(w) && !PLACE.has(w);
}

export interface NameCandidate {
  phrase: string;
  // Normalised clustering key.
  key: string;
  distinct: string[];
}

// Every capitalised run in the title that survives the guards.
export function extractProjectNames(title: string | null | undefined): NameCandidate[] {
  if (!title) return [];
  const clean = stripChrome(title);
  // An ALL-CAPS title carries no capitalisation signal at all, so every word
  // would look like a proper noun. Fall back to treating the whole line as one
  // candidate and let the guards judge it.
  const allCaps = clean === clean.toUpperCase() && /[A-Z]{3}/.test(clean);
  const runs: string[] = [];

  if (allCaps) {
    runs.push(clean);
  } else {
    const toks = clean.split(/\s+/);
    let cur: string[] = [];
    for (const raw of toks) {
      const t = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9']+$/g, '');
      if (!t) {
        if (cur.length) runs.push(cur.join(' '));
        cur = [];
        continue;
      }
      const capitalised = /^[A-Z]/.test(t);
      const connective = CONNECTIVE.has(t.toLowerCase());
      if (capitalised || (connective && cur.length > 0)) {
        cur.push(t);
      } else {
        if (cur.length) runs.push(cur.join(' '));
        cur = [];
      }
    }
    if (cur.length) runs.push(cur.join(' '));
  }

  const out: NameCandidate[] = [];
  const seen = new Set<string>();
  for (const run of runs) {
    // Trim connectives off the edges: "Plans for New Gold Coast" must not keep
    // a dangling "for".
    const ws = words(run).filter((w) => w.length > 0);
    while (ws.length && CONNECTIVE.has(ws[0])) ws.shift();
    while (ws.length && CONNECTIVE.has(ws[ws.length - 1])) ws.pop();
    if (ws.length < MIN_WORDS) continue;

    const distinct = ws.filter(isDistinctive);
    if (distinct.length < MIN_DISTINCT) continue;
    // Entirely brand, entirely place, or entirely generic - each refused.
    if (ws.every((w) => BRAND.has(w))) continue;
    if (ws.every((w) => PLACE.has(w))) continue;
    if (ws.every((w) => GENERIC.has(w))) continue;

    const key = ws.join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ phrase: run.trim(), key, distinct });
  }
  return out;
}
