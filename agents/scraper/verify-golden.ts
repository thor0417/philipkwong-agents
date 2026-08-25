// THE GOLDEN SET. Every case here is a defect that has already happened.
//
// Standing rule 7: a defect produces a permanent rule and a golden case, not a
// one-time cleanup. This is where the cases live and this is what runs them.
//
// TWO KINDS OF CASE, AND THE SECOND ONE IS THE POINT.
//
//   guard: "inline"      the runner asserts it here, in process. No database,
//                        no browser, no network - so this whole file runs in
//                        under a second and can sit in a pre-commit hook.
//
//   guard: {file,needle} the invariant is ALREADY asserted somewhere, and the
//                        case points at it rather than restating it. The runner
//                        checks that the assertion is still there.
//
// Why the second kind exists at all. Nine of these sixteen were already covered
// by the Playwright audits and the exclusion audit, and duplicating them here
// would mean two statements of one rule that can drift apart - which is the
// shape of half the defects in the list below. But an assertion nobody points at
// can be deleted, renamed or commented out during a refactor and nothing says a
// rule stopped being enforced. So the case owns the RULE and the pointer owns
// the PROOF, and this file fails if the proof goes missing.
//
// The pointer is matched on a distinctive string from the assertion's own
// message rather than on a line number, because line numbers move on every edit
// and a guard that fails on unrelated edits is a guard that gets deleted.

import { readFileSync, readdirSync } from 'node:fs';
import { bestTargetForClustering } from './targets';
import { bestDate, clusterRecords, type ClusterRecord } from './cluster';
import { deriveProjectName } from './project-naming';
import { classifyVenueType, governmentGate, provenStage } from '../../lib/taxonomy';
import { resolveGeography } from '../../lib/geography';
import { inCorpusScope } from '../../lib/corpus-scope';
import { isCoveredMarket } from '../../lib/coverage';
import { deriveLeadDates } from './lead-date';
import {
  extractPressFacts, verifyNoInvention, attributionTerms, factsForEntry,
} from './press-facts';
import { contactsFromText } from './sources/contact-labels';
import { readFilingFacts, verifyFilingFacts } from './filing-facts';
import { readNycFacts } from './readers/nyc-records';

const CASES_FILE = 'agents/scraper/fixtures/golden.jsonl';

interface GoldenCase {
  id: string;
  shape: string;
  added: string;
  input: string;
  assertion: string;
  origin?: string;
  // 'pending' is the acceptance test for a defect that has NEVER been fixed.
  // It runs, it reports what the system does today, and it does not fail the
  // gate - because there is nothing to regress from yet.
  guard: 'inline' | 'pending' | { file: string; needle: string };
  // Required on a pending case: the roadmap item that closes it. A pending case
  // with nowhere to be closed is a known issue with better manners.
  closedBy?: string;
}

interface Result {
  id: string;
  ok: boolean;
  detail: string;
  // A pending case that has started passing. The fix has landed and the case
  // should be promoted to a real guard.
  promote?: boolean;
}

// ---- THE INLINE CASES -------------------------------------------------------
//
// One function per case, keyed by id. A case whose id has no function here is a
// failure, not a skip: a golden case that quietly does not run is worse than no
// case at all, because the list says it is covered.

const INLINE: Record<string, () => string | null> = {
  // Returns null on pass, or the reason it failed.

  'one-foreign-record-carries-a-whole-project-into-another-market': () => {
    // PENDING. Reports what the code does today and does not fail the gate.
    //
    // A market scope matches a project on ANY of its records, so a single record
    // whose market is not the project's puts the WHOLE project into that other
    // market's document, geography subheading and all. What would close it is a
    // weight or a threshold on that match; this looks for one.
    const src = readFileSync('dashboard/lib/report-build.ts', 'utf8');
    if (/foreign record|records in that market|marketMatchThreshold/i.test(src)) return null;
    return 'a market scope still matches on any single record, so one mis-clustered record carries an entire project into the document of another market';
  },

  'a-recommendation-read-as-the-decision': () => {
    // PENDING. Reports what the entry does today and does not fail the gate.
    //
    // The stage ladder takes the MOST ADVANCED proven stage; the entry prints
    // the FIRST decision fact it finds. Two different questions, one page, and
    // nothing reconciles them. What would close it is a rule about which body's
    // action IS the decision - so the check looks for any sign that one exists.
    const src = readFileSync('dashboard/lib/report-entry.ts', 'utf8');
    if (/decision.{0,40}reconcil|reconcil.{0,40}decision/i.test(src)) return null;
    return 'report-entry prints the first decision fact and never compares it with the stage; 18 of the 32 projects that print a decision print one that disagrees';
  },

  'a-listing-page-stored-as-the-document': () => {
    // PENDING. Reports what the corpus does today and does not fail the gate.
    //
    // primary_document_url is read as "the document behind this record" - the
    // entry cites it in place of the record page for exactly that reason - and
    // for three markets it holds a page that LISTS documents. Closing it needs a
    // predicate that can tell one from the other; this looks for one.
    const here = readdirSync('lib').filter((f) => f.endsWith('.ts'));
    const anySplit = here.some((f) => {
      const t = readFileSync('lib/' + f, 'utf8');
      return /isDocumentUrl|isListingPage|documentVsListing/.test(t);
    });
    if (anySplit) return null;
    return 'nothing anywhere distinguishes a fetched file from a page that lists files; 299 of 579 records holding a primary_document_url point at a portal or viewer page and none of those is a file';
  },

  'a-tracked-artefact-written-by-two-projects': () => {
    // The light and dark capture projects both match /\.shots\.ts/, so every
    // file with that suffix runs TWICE against one filesystem. Two of the
    // directories a test can write are COMMITTED, and a write to a committed
    // path that resolves the same in both projects is two processes calling
    // saveAs on one file. The convention that prevents it is either a mode
    // guard around the write or a destination that carries the mode; this
    // checks that no .shots.ts has drifted off it.
    const DIR = 'dashboard/e2e';
    const dual = readdirSync(DIR).filter((f) => f.endsWith('.shots.ts'));
    if (dual.length === 0) {
      return `no .shots.ts under ${DIR}: the capture projects' testMatch has moved and this case is reading nothing`;
    }

    // And the helper must still be the thing that separates them.
    const helper = readFileSync(`${DIR}/artefacts.ts`, 'utf8');
    if (!helper.includes("mode === 'light' ? 'documents' : 'documents-dark'")) {
      return 'e2e/artefacts.ts no longer sends dark to a documents directory of its own';
    }

    const bad: string[] = [];
    for (const file of dual) {
      const text = readFileSync(`${DIR}/${file}`, 'utf8');

      // walkthrough/ has ONE destination for both projects, so the only
      // defence there is not writing it twice.
      if (/walkthroughOut\(|walkthroughDir\(/.test(text) && !text.includes("mode === 'light'")) {
        bad.push(
          `${file} writes the committed walkthrough directory from both capture projects and carries no mode guard`
        );
      }

      // documents/ separates by mode instead, which only works if the mode is
      // the thing that reaches it.
      for (const m of text.matchAll(/documentsDir\(([^)]*)\)/g)) {
        if (!/\bmode\b/.test(m[1])) {
          bad.push(
            `${file} calls documentsDir(${m[1]}) without the mode, so light and dark resolve to one path`
          );
        }
      }
    }
    return bad.length > 0 ? bad.join('; ') : null;
  },

  'a-watched-target-sharded-by-a-market-column-the-press-lane-fills': () => {
    const rec = (market: string | null, url: string): ClusterRecord =>
      ({
        market,
        stream: 'intelligence',
        source: 'gli_serper',
        status: 'new',
        published_date: '2026-07-01',
        url,
        title: 'Walt Disney World files for a new resort hotel',
        raw_content: 'Walt Disney World filing, reported.',
      }) as ClusterRecord;
    const keysOf = (rs: ClusterRecord[]): string[] =>
      clusterRecords(rs, { now: Date.parse('2026-08-23T00:00:00Z') })
        .projects.map((p) => p.project_key)
        .filter((k) => k.startsWith('target:'));

    // 1. VENUE NAMES ARE NOT MARKETS, so neither may mint a shard. These are the
    //    real stored strings: 'Walt Disney World', 'Disneyland', 'Disneyland
    //    Resort' each held a project of its own.
    const venueNames = keysOf([
      rec('Walt Disney World', 'https://x/a'),
      rec('Disneyland Resort', 'https://x/b'),
      rec('Disneyland', 'https://x/c'),
    ]);
    if (venueNames.length > 0) {
      return `venue names still mint target keys: ${venueNames.join(' | ')}`;
    }

    // 2. A NULL MARKET IS NOT A MARKET EITHER. Two of the eight shards were
    //    named "Disney / CFTOD ((unknown market))" with a date appended, because
    //    the disambiguator had nothing else to tell them apart with.
    const noMarket = keysOf([rec(null, 'https://x/d'), rec(null, 'https://x/e')]);
    if (noMarket.length > 0) {
      return `a null market still mints a target key: ${noMarket.join(' | ')}`;
    }

    // 3. A RETIRED MARKET IS NOT A COVERED ONE. 'Lake Buena Vista' left the
    //    table on 2026-08-21 and its shard survived the retirement.
    const retired = keysOf([rec('Lake Buena Vista', 'https://x/f')]);
    if (retired.length > 0) {
      return `a retired market still mints a target key: ${retired.join(' | ')}`;
    }

    // 4. AND THE HALF THAT MATTERS MORE: the two real members of the portfolio
    //    still separate. This is what perMarket is FOR, and a fix that merged
    //    Anaheim into the Florida district would be worse than the defect.
    const real = keysOf([
      rec('Anaheim', 'https://x/g'),
      rec('Central Florida Tourism Oversight District', 'https://x/h'),
    ]);
    if (real.length !== 2) {
      return `the two covered markets no longer separate: ${real.join(' | ') || '(no target key at all)'}`;
    }
    return null;
  },

  'a-planning-document-admitting-a-county-s-whole-agenda': () => {
    // CLOSED 2026-08-23. A real Broward title, verbatim. It names no venue, and
    // the term that used to admit it is gone from GOV_GATE_STRONG.
    const broward =
      'MOTION TO ENACT Ordinance adopting a Small-Scale amendment to the Broward County Land ' +
      'Use Plan map (PC 25-5), located in the City of Weston (Commission District 1), as an ' +
      'amendment to the Broward County Comprehensive Plan, the title of which is as follows: ' +
      'AN ORDINANCE OF BROWARD COUNTY, FLORIDA, ADOPTING A SMALL-SCALE AMENDMENT TO THE ' +
      'BROWARD COUNTY COMPREHENSIVE PLAN; AMENDING THE BROWARD COUNTY LAND USE PLAN WITHIN ' +
      'THE CITY OF WESTON; AND PROVIDING FOR SEVERABILITY AND AN EFFECTIVE DATE.';
    const v = governmentGate(broward, 'Broward County');
    if (v.matched) {
      return (
        `a Broward land-use-plan housekeeping item is still admitted as '${v.reason}' on ` +
        `strong=[${v.strongHits.join('|')}] action=[${v.actionHits.join('|')}]`
      );
    }
    // AND THE CONTROL, WHICH IS THE HALF THAT MATTERS. A term removal that also
    // silenced the real Broward filings would be a worse defect than the one it
    // fixed. Five Broward candidates survive on a genuine venue noun and this is
    // one of them; if it stops matching, the removal went too far.
    const realVenue = governmentGate(
      'MOTION TO ACKNOWLEDGE AND FILE Office of the County Auditor Follow-up Review of Audit of ' +
        'Central Broward Regional Park and Stadium - Report No. 26-01.',
      'Broward County'
    );
    if (!realVenue.matched) {
      return 'the removal also silenced a Broward record that names a real venue (stadium)';
    }
    return null;
  },

  'new-york-conditions-are-in-a-document-we-do-not-hold': () => {
    // PENDING. Two candidate documents, and the check asserts that NEITHER is
    // reachable yet rather than that conditions are missing - "New York has no
    // conditions" is the symptom and this case is about the cause.
    const council = readFileSync('agents/scraper/sources/legistar-jurisdictions.ts', 'utf8');
    // A CLIENT ENTRY, not a mention. The first version of this check matched the
    // string 'nyc' anywhere in the file and passed on a COMMENT, which is the
    // same defect class the golden set exists for.
    const readsNycCouncil = /client:\s*'(?:nyc|newyorkcity|nyccouncil)[a-z]*'/i.test(council);
    const acris = readFileSync('agents/scraper/diagnostics/cpc-gain.ts', 'utf8');
    const readsAcris = /acris/i.test(acris);
    if (readsNycCouncil && readsAcris) return null;
    const open: string[] = [];
    if (!readsNycCouncil) open.push('no New York City Legistar jurisdiction is configured, so the Council approval resolution is unreachable');
    if (!readsAcris) open.push('nothing probes ACRIS, so the restrictive declaration is unreachable');
    return open.join('; ');
  },

  'the-press-lane-writes-venue-names-into-the-market-column': () => {
    // PENDING, AND DELIBERATELY NOT GUARDED BY THE SHARD FIX. That fix stopped
    // ONE reader trusting the column; it did not make the column right. This
    // check asserts the column is still wrong, so the case cannot be quietly
    // considered closed by the guard that went in beside it.
    //
    // Pure, so it names the shape rather than counting the corpus: the lane
    // writes lead.location / the article's place straight through, and nothing
    // in the write path consults the covered-market table.
    const src = readFileSync('agents/scraper/gli.ts', 'utf8');
    const resolves = /isCoveredMarket|coveredMarket\(/.test(src);
    if (resolves) return null;
    return (
      'the intelligence lane still writes its market without consulting the covered-market table. ' +
      'Measured 2026-08-23: 143 of 194 live press records (74%) carry a market that is not a market, ' +
      'against 1 of 799 government records (0%), over 182 distinct non-market strings.'
    );
  },

  'a-market-claimed-on-a-feed-we-read-and-capture-nothing-from': () => {
    // PENDING. Nothing in the tree compares a covered market's newest CAPTURED
    // document against its feed's newest PUBLISHED matter, so the check that
    // would catch Yonkers cannot be pointed at. Both existing checks read one
    // side only.
    if (!isCoveredMarket('Yonkers')) return null;
    const cov = readFileSync('lib/coverage.ts', 'utf8');
    const stale = readFileSync('agents/scraper/verify-staleness.ts', 'utf8');
    if (/captureLag|capturedVsPublished|CAPTURE_LAG/.test(cov + stale)) return null;
    return (
      'Yonkers is claimed and no check reads both sides: verify:staleness probes the feed, ' +
      'verify:coverage-table reads the corpus, and neither compares what a feed published ' +
      'against what we captured from it.'
    );
  },

  'a-project-with-no-records-keeps-a-live-stage': () => {
    // PENDING. Pure: the rule is that nothing recomputes a stage downward when
    // the last record leaves, so the check asserts no such path exists rather
    // than counting the register.
    const cluster = readFileSync('agents/scraper/cluster.ts', 'utf8');
    const write = readFileSync('agents/scraper/project-write.ts', 'utf8');
    if (/zero[- ]record|emptied|hasRecords|no live records/i.test(cluster + write)) return null;
    return (
      'nothing recomputes a stage when a project loses its last record; measured 2026-08-23 at 71 Broward ' +
      'projects holding zero live records and still reading hearing scheduled, approved, filed or stalled'
    );
  },

  'a-failed-page-reads-as-an-exhausted-feed': () => {
    // The rule lives in one file and the assertion points at it, but the SHAPE
    // is worth asserting here too: a fetch helper that cannot say "I failed"
    // makes every caller guess.
    const src = readFileSync('agents/scraper/sources/legistar.ts', 'utf8');
    const open: string[] = [];
    if (!/Promise<T\[\] \| null>/.test(src)) {
      open.push('fetchJson no longer distinguishes a failed request from an empty feed');
    }
    if (!/stopped: 'fetch-failed'/.test(src)) {
      open.push('the paging loop no longer records that it stopped on a failed page');
    }
    if (!/TRUNCATED: A PAGE REQUEST FAILED/.test(src)) {
      open.push('a truncated read no longer says so in the run report');
    }
    return open.length ? open.join('; ') : null;
  },

  'a-freshness-figure-quoted-off-a-placeholder-date': () => {
    // CLOSED 2026-08-23. The real Phoenix record, whose only date is the clerk's
    // end-of-year filler. Judged against a FIXED now, so the case does not
    // silently start passing for the wrong reason as the date recedes.
    const now = Date.parse('2026-08-23T00:00:00Z');
    const lead = (published: string) =>
      ({
        source: 'legistar',
        url: 'https://phoenix.legistar.com/gateway.aspx?M=l&ID=1',
        title: 'Liquor License - AC Hotel Biltmore - District 6',
        raw_content: 'Government record (Legistar Matter): Jurisdiction: Phoenix, AZ',
        published_date: published,
        first_seen: '2026-08-01',
      }) as unknown as Parameters<typeof deriveLeadDates>[0];

    const placeholder = deriveLeadDates(lead('2026-12-31'), 'government', now);
    if (placeholder.published_date === '2026-12-31') {
      return `a placeholder 130 days ahead is still taken as a published date (${placeholder.date_source})`;
    }

    // AND THE TWO CONTROLS, which are why the constant is 30 and not 7. Both of
    // these are real dates from the corpus and both must survive.
    const nashville = deriveLeadDates(lead('2026-08-31'), 'government', now); // +8d
    if (nashville.published_date !== '2026-08-31') {
      return 'a real hearing date nine days ahead was refused as a placeholder';
    }
    const clark = deriveLeadDates(lead('2026-08-25'), 'government', now); // +2d
    if (clark.published_date !== '2026-08-25') {
      return 'a real hearing date two days ahead was refused as a placeholder';
    }
    return null;
  },

  'hudson-yards-district-term': () => {
    // The record that caused it: a Port Authority Bus Terminal matter that
    // mentions the district and nothing else.
    const t = bestTargetForClustering(
      'Port Authority Bus Terminal replacement, a project in the hudson yards area of Manhattan.'
    );
    if (t === null) return null;
    return `a district term alone identified "${t.name}"`;
  },

  'stage-above-approved-needs-proof': () => {
    // ALL FILINGS. The borrowed-record rule this case guards is about WHICH
    // filing, not about press; press is now capped at 'filed' before this runs.
    const evidence = [
      { stage: 'filed' as const, attributed: false, isFiling: true },
      { stage: 'filed' as const, attributed: false, isFiling: true },
      { stage: 'approved' as const, attributed: false, isFiling: true },
      // The borrowed one: neither on the project's own site nor said twice.
      { stage: 'under construction' as const, attributed: false, isFiling: true },
    ];
    const { stage, refused } = provenStage(evidence);
    if (stage === 'under construction') {
      return 'one unattributed, uncorroborated record advanced the project to under construction';
    }
    if (refused === null) return 'the refusal was not reported, so nothing can say what was withheld';
    // And the control: attribute it and it must be allowed through.
    const allowed = provenStage([
      ...evidence.slice(0, 3),
      { stage: 'under construction' as const, attributed: true, isFiling: true },
    ]);
    if (allowed.stage !== 'under construction') {
      return 'an ATTRIBUTED record was also refused, so the rule is not a proof requirement, it is a ceiling';
    }
    return null;
  },

  // PRESS CANNOT PROMOTE. The eight filings say filed; the fifteen press reports
  // say approved. The stage is what the filings support, and the press reading
  // is carried out separately so an entry can print it and attribute it.
  'press-cannot-promote-a-stage': () => {
    const filings = Array.from({ length: 8 }, () => ({
      stage: 'filed' as const, attributed: true, isFiling: true,
    }));
    const press = Array.from({ length: 15 }, () => ({
      stage: 'approved' as const, attributed: false, isFiling: false,
    }));
    const r = provenStage([...filings, ...press]);
    if (r.stage !== 'filed') {
      return `fifteen press reports promoted the project to ${r.stage}; no filing states it`;
    }
    if (r.pressReported !== 'approved') {
      return 'the press reading was discarded rather than separated, so the entry cannot state it';
    }
    // And the control: one FILING saying approved, attributed, must be allowed.
    const withFiling = provenStage([
      ...filings,
      { stage: 'approved' as const, attributed: true, isFiling: true },
    ]);
    if (withFiling.stage !== 'approved') {
      return 'an attributed FILING was refused, so the rule is a ceiling rather than a source requirement';
    }
    return null;
  },

  'title-outranks-body': () => {
    const body =
      'Cumulative projects considered in this EIR include ocvibe and the surrounding area. ' +
      'The disneylandforward project is analysed below.';
    const t = bestTargetForClustering(body, { title: 'DisneylandForward Project' });
    if (!t) return 'the record clustered to nothing at all';
    if (/ocvibe/i.test(t.name)) return `the body outvoted the title: got "${t.name}"`;
    if (!/disney/i.test(t.name)) return `expected the title's target, got "${t.name}"`;
    return null;
  },

  'dateless-record-is-not-activity': () => {
    const d = bestDate({
      url: 'https://example.invalid/post',
      title: 'A post with no date on it',
      first_seen: '2026-08-10T00:00:00Z',
    });
    if (d === null) return null;
    return `a record with no source date reported ${d} as its activity date`;
  },

  'venue-word-needs-a-record': () => {
    // Records that never say "resort", under a project whose rolled-up venue
    // type is Integrated Resort.
    const records = [
      {
        url: 'https://example.invalid/1',
        title: 'Design review for a 12 storey building at 500 North Casino Center Drive',
        raw_content: 'Design review for a twelve storey building with parking below grade.',
        applicant: 'Kulik River Capital, LLC',
      },
      {
        url: 'https://example.invalid/2',
        title: 'Use permit at 500 North Casino Center Drive',
        raw_content: 'Use permit for the same site.',
        applicant: 'Kulik River Capital, LLC',
      },
    ];
    const name = deriveProjectName({
      targetName: null,
      records,
      venueType: 'Integrated Resort',
      siteKeysByRecord: [['500 north casino center drive'], ['500 north casino center drive']],
    });
    if (/\bresort\b/i.test(name.name)) {
      return `named "${name.name}" from a venue word no record uses`;
    }
    return null;
  },

  'zoning-code-is-not-a-venue': () => {
    const text =
      'USE PERMIT to allow a daycare and school in a CR (Commercial Resort) Zone, ' +
      'with WAIVERS OF DEVELOPMENT STANDARDS to 1) allow a trash enclosure.';
    const v = classifyVenueType(text);
    if (v === null) return null;
    return `a zoning district classified as venue_type "${v}"`;
  },

  // PENDING. Not fixed. See the Lane A note in nyc-ceqr-documents.
  //
  // OFFLINE, DELIBERATELY. The defect is a live-host behaviour and this suite is
  // the pre-commit gate: 9 seconds, no database, no network. So the check asserts
  // on the CODE rather than on the city's server - that nyc-ceqr still takes the
  // dataset's URL as given and still verifies it on status alone. That is exactly
  // the condition that has to change for the case to close, and it is knowable
  // without a request.
  //
  // The measurement itself is in the case's origin and was taken by hand on
  // 2026-08-18: three of three published ProjectDetail URLs returned HTTP 200
  // with "Page Not Found - Error Code 404" in the body.
  // OPEN. The gate exists and reaches one column on one source; this reports how
  // much of the shape it does not reach. Source-text only: the golden runner
  // takes no database, and the corpus numbers this case records were measured by
  // agents/scraper/diagnostics/agency-party-probe.ts on 2026-08-18.
  'an-agency-reaches-a-document-through-more-than-the-applicant-column': () => {
    const people = readFileSync('dashboard/lib/people.ts', 'utf8');
    const open: string[] = [];
    // The gate is keyed on the applicant column alone, by design: it is the only
    // column any source states a type for. presented_by carries 97 of the 113
    // agency-shaped strings on live attached records, and nothing gates it.
    if (/push\(nameablePresenter|nameablePresenter\(/.test(people) === false) {
      open.push('presented_by is still pushed ungated: 97 live records, and no source states a type for it');
    }
    // A second source publishing a type is what would make a real fix possible.
    // Until then the gate covers nyc-zap and nothing else.
    const adapters = readFileSync('agents/scraper/sources/nyc-zap.ts', 'utf8');
    if (!/applicant_type:/.test(adapters)) {
      open.push('nyc-zap no longer writes applicant_type: the gate has no input at all');
    }
    if (open.length === 0) {
      return null;
    }
    return open.join('; ') + ' (82 projects touched, 71 of them New York City)';
  },

  // OPEN. A manual event that repeats is refused by the database and dropped on
  // the floor. Source-text only, like the two above: the runner takes no
  // database, and the corpus number in this case's origin - 6 watch events in
  // the whole table, one add/remove pair per project ever - was read by hand on
  // 2026-08-19.
  //
  // TWO CONDITIONS, AND BOTH MUST CHANGE. The insert has to carry something that
  // makes a repeat distinguishable from a duplicate, and recordManualEvent has
  // to stop treating a refused write as nothing worth mentioning. Either alone
  // leaves the trail incomplete: a unique index that still collides silently is
  // the state today, and a loud failure on an index that refuses every repeat is
  // just a noisier version of the same gap.
  'a-manual-event-that-repeats-is-refused-and-not-recorded': () => {
    const events = readFileSync('dashboard/lib/project-events.ts', 'utf8');
    const open: string[] = [];
    // recordManualEvent logs and returns. A caller cannot tell a recorded event
    // from a refused one, so nothing upstream can retry or report.
    if (/Never rethrown/.test(events) || !/throw/.test(events.split('recordManualEvent')[1] ?? '')) {
      open.push('recordManualEvent still swallows a failed insert to console.error');
    }
    // The identity the database enforces is idx_project_events_dedupe, which is
    // in no migration file in this repo: it was applied by hand. Until a printed
    // migration replaces it, nothing in the tree describes what the constraint
    // actually is.
    const migrations = readFileSync('agents/scraper/migrations/023_project_events_identity.sql', 'utf8');
    if (!/dedupe/.test(migrations)) {
      open.push('idx_project_events_dedupe is enforced by the database and declared in no migration');
    }
    return open.length ? open.join('; ') : null;
  },

  'a-project-named-after-a-street-takes-the-street-s-venue': () => {
    // PENDING, AND THE OBVIOUS FIX IS THE ONE THAT WAS MEASURED AND REJECTED.
    // A blanket street-name neutraliser cleared 82 records across nine markets
    // and took real venues with it, because a place names its streets after its
    // landmarks. So this reports the shape rather than demanding that rule.
    //
    // SOURCE-LEVEL, because verify:fast has no database. It asks whether any
    // narrower mechanism has landed, so the case closes itself when one does.
    const tax = readFileSync('lib/taxonomy.ts', 'utf8');
    const hasNarrowRule = /SITE_ADDRESS_SPAN|streetNamedVenue|titleOnlyStreet|address span/i.test(tax);
    if (hasNarrowRule) return null;
    return (
      'a venue noun inside a street name still sets venue_type, and where name_source is ' +
      "'site' it sets the project name too; 3 projects print it twice (1555 S Casino Center " +
      'Drive, 500 North Casino Center Drive, 163 At Casino Drive), 20 records affected'
    );
  },

  'a-trade-press-article-is-not-a-project': () => {
    // PENDING AND DELIBERATELY OPEN. The decision is whether the intelligence
    // gate should refuse a press item carrying no place and no party, and that
    // rule has to be COSTED across the press lane before it ships (standing rule
    // 2), because the same shape describes a real project we have not placed yet.
    //
    // SOURCE-LEVEL, because verify:fast has no database. It reports whether the
    // gate has grown a rule of this kind, so the case closes itself the day one
    // lands rather than waiting for someone to remember this file.
    const gate = readFileSync('lib/taxonomy.ts', 'utf8');
    const hasPlacelessRule =
      /placeless|no place and no party|articleNotProject|isTradePress/i.test(gate);
    if (hasPlacelessRule) return null;
    return (
      'the intelligence gate still admits a press item that names no place and no party; ' +
      'measured 2026-08-21 at 2 live projects and 4 records'
    );
  },

  'a-client-scope-naming-a-country-drops-the-unresolved-ones': () => {
    // PENDING BY DECISION, not by neglect. Philip reviewed this on 2026-08-21
    // and left it: a client scope naming a country is the CLIENT saying what
    // they bought, which lib/corpus-scope itself separates from the system
    // saying what it covers. Reach is 0 of 5 today. It is recorded so that the
    // day a client scope does name a country, the question is already written
    // down rather than rediscovered.
    //
    // SOURCE-LEVEL, because verify:fast runs with no database and no network,
    // and because agents may not import dashboard code - the split is one way.
    // So this reports the SHAPE that is still there rather than the rows it
    // would drop.
    const clients = readFileSync('dashboard/lib/clients.ts', 'utf8');
    const open: string[] = [];
    // The country axis goes to `loose`, which applyProjectFilters renders as an
    // ilike. ilike on a NULL column is NULL, so the row is excluded: exactly
    // the register's old DEFAULT_COUNTRY behaviour, on the client axis.
    if (/axis\(countries, 'country'\)/.test(clients)) {
      open.push(
        "resolveScope still routes a scope's country through the loose ilike axis, which excludes a null country"
      );
    }
    // If the register ever regressed to an equality default, the two would be
    // wrong together and this case would be the wrong place to read about it.
    const projects = readFileSync('dashboard/lib/projects.ts', 'utf8');
    if (!/countryInScope/.test(projects)) {
      open.push('the REGISTER default is no longer corpus scope either, which is a regression rather than this case');
    }
    return open.length ? open.join('; ') : null;
  },

  'a-200-is-not-a-live-page': () => {
    const src = readFileSync('agents/scraper/sources/nyc-ceqr.ts', 'utf8');
    const verifiesBody = /Page Not Found|Error Code 404|bodyLooksLikeAnError|soft.?404/i.test(src);
    const usesDetailsRoute = /ceqr\/Details/.test(src);
    if (verifiesBody && usesDetailsRoute) return null;
    const missing: string[] = [];
    if (!usesDetailsRoute) missing.push('nyc-ceqr still uses the dataset ProjectDetail URL, which is a dead route');
    if (!verifiesBody) missing.push('its fetch-verification still checks the status only, and this host serves errors as 200');
    return missing.join('; ');
  },

  // CLOSED 2026-08-18. Was pending; see the case's origin for the branch.
  'a-place-name-is-not-a-country-code': () => {
    const wrong: string[] = [];
    // A PLACE NAME IS NOT A CODE. Every one of these is a real place in the
    // corpus, and every one used to resolve to a country chosen by its leading
    // two letters.
    const places: [string, string | null][] = [
      ['Georgia', 'Georgia'],          // the country, not the US state
      ['Fiji', 'Fiji'],                // was Finland
      ['Malawi', 'Malawi'],            // was Morocco
      ['Chad', 'Chad'],                // was Switzerland
      ['Zambia', 'Zambia'],            // was South Africa
      ['Gambia, The', 'Gambia'],       // was Thailand
      ['Bronx', 'United States'],      // was Brazil
      // AUSTIN IS NOT AUSTRALIA, AND IT IS NOT A COVERED MARKET EITHER. null is
      // the honest answer: unresolved, and admitted by the US-only rule, which
      // is the same treatment Fort Wayne gets.
      ['Austin', null],
    ];
    for (const [place, want] of places) {
      const got = resolveGeography(place).country;
      if (got !== want) wrong.push(`${place} -> ${got ?? 'null'} (should be ${want ?? 'null'})`);
    }
    // AND THE OTHER HALF: every genuine code string still resolves. A fix that
    // stopped reading codes would pass the list above and break the lane it was
    // written for.
    const codes: [string, string][] = [
      ['CZ010, CZE', 'Czechia'],
      ['ROU', 'Romania'],
      ['FIN', 'Finland'],
      ['HUN, HU322', 'Hungary'],
      ['HRZZZ, HRV', 'Croatia'],       // extra-regio: a real NUTS code with no digit
      ['Chicago, Illinois, USA', 'United States'],
    ];
    for (const [code, want] of codes) {
      const got = resolveGeography(code).country;
      if (got !== want) wrong.push(`${code} -> ${got ?? 'null'} (should be ${want})`);
    }
    return wrong.length ? wrong.join('; ') : null;
  },

  'press-stays-inside-the-corpus-countries': () => {
    if (inCorpusScope('Saudi Arabia')) return 'a resolved foreign country was admitted';
    if (!inCorpusScope('United States')) return 'the United States was refused';
    // The one that is easy to "fix" wrongly. Null must pass.
    if (!inCorpusScope(null)) {
      return 'an unresolved country was treated as foreign, which discards US coverage';
    }
    if (!inCorpusScope('  united states  ')) return 'case and whitespace defeat the check';
    return null;
  },

  'a-figure-not-in-the-article-never-appears': () => {
    const body =
      'The Clark County Zoning Commission has approved a proposal from Kulik River Capital ' +
      'for the resort, which would add 752 rooms if it is built. ' +
      'Operators have committed US$20 billion across the Strip over the last decade.';

    const facts = extractPressFacts(body);
    const rooms = facts.find((f) => f.kind === 'rooms');
    if (!rooms) return 'the room count printed in the article was not extracted';
    if (!body.includes(rooms.display)) return 'the extracted display string is not in the article';
    if (!rooms.sentence.includes('Kulik River')) {
      return 'the fact does not carry the sentence it came from';
    }

    // The guard must refuse a value the text never printed.
    let threw = false;
    try {
      verifyNoInvention([{ kind: 'rooms', display: '999 rooms', value: 999, sentence: '' }], body);
    } catch {
      threw = true;
    }
    if (!threw) return 'verifyNoInvention accepted a figure absent from the article';

    // Attribution: the project's own figure stays, the Strip-wide one does not.
    const terms = attributionTerms('Heart Hotel / Kulik River', 'Kulik River Capital, LLC');
    const entry = factsForEntry(facts, terms);
    if (!entry.some((f) => f.kind === 'rooms')) return 'the attributed room count was dropped';
    if (entry.some((f) => f.display.includes('20 billion'))) {
      return 'a figure about the wider market reached the project entry';
    }
    return null;
  },

  'a-figure-is-quoted-from-the-sentence-printed-beside-it': () => {
    // A single run longer than the sentence cap, with the figure past the cut.
    // This is the real shape: a press release whose navigation furniture and
    // headline arrive as one unbroken line before the article starts.
    const body =
      'Back To News Press Releases Press Releases ' +
      'OCVIBE and Award-Winning Art and Design Studio, FUTUREFORMS, Unveil a new work '.repeat(6) +
      'on the 100-acre district in Anaheim.';

    const facts = extractPressFacts(body);
    const acres = facts.find((f) => f.kind === 'acres');
    if (!acres) return 'the site figure printed in the article was not extracted';
    if (!acres.sentence.includes(acres.display)) {
      return `the sentence stored for "${acres.display}" does not contain it`;
    }
    // EVERY fact, not just this one. The cap applies to all kinds.
    const unquoted = facts.filter((f) => !f.sentence.includes(f.display));
    if (unquoted.length) {
      return `${unquoted.length} fact(s) carry a sentence that does not contain them`;
    }

    // And the writer's guard must refuse one, rather than leaving it to the
    // document to notice.
    let threw = false;
    try {
      verifyNoInvention(
        [{ kind: 'acres', display: '100-acre', value: 100, sentence: 'A sentence without it.' }],
        body
      );
    } catch {
      threw = true;
    }
    if (!threw) {
      return 'verifyNoInvention accepted a figure its own sentence does not contain';
    }
    return null;
  },

  'the-government-mover-is-not-the-party': () => {
    // The real shape, as Clark County prints it on a Redevelopment Agency sheet:
    // the only labelled name in the document is the officer who brought it.
    const moverOnly = [
      'CLARK COUNTY REDEVELOPMENT AGENCY AGENDA ITEM',
      'PETITIONER: Denis Cederburg, Director of Public Works',
      '',
      'RECOMMENDATION: Approve and authorize the Chair to sign Supplemental No. 8.',
    ].join('\n');

    const a = contactsFromText(moverOnly);
    if (!a) return 'a document naming a petitioner yielded no contact block at all';
    if (a.applicant !== null) {
      return `a county officer was stored as the applicant: "${a.applicant}"`;
    }
    if (!a.presented_by || !a.presented_by.includes('Cederburg')) {
      return 'the petitioner was dropped instead of being kept as the presenter';
    }

    // And the control: where the document DOES name a party, the party wins and
    // the petitioner cannot displace it.
    const both = [
      'APP. NUMBER/OWNER/DESCRIPTION OF REQUEST',
      'APPLICANT: GREYSTONE NEVADA, LLC',
      '',
      'PETITIONER: Jennifer Ammennan, Deputy Director, Department of Comprehensive Planning',
    ].join('\n');
    const b = contactsFromText(both);
    if (!b) return 'a document naming both a party and a petitioner yielded nothing';
    if (!b.applicant || !b.applicant.includes('GREYSTONE')) {
      return `the real applicant was lost; got "${b.applicant}"`;
    }
    if (b.applicant.includes('Ammennan')) return 'the petitioner overwrote the applicant';
    return null;
  },

  'a-condition-is-not-split-by-a-department-it-mentions': () => {
    // The real form: a heading glued to the tail of the wrapped bullet above it,
    // and a department named inside a condition of a different department.
    const sheet = [
      '07/22/26 PC AGENDA SHEET',
      'APP. NUMBER/OWNER/DESCRIPTION OF REQUEST',
      'RELATED INFORMATION:',
      'PRELIMINARY STAFF CONDITIONS:',
      'Comprehensive Planning',
      '• Applicant is advised within 4 years from the approval date a final map',
      '  must be recorded or it will expire.',
      'Public Works - Development Review',
      '• Drainage study and compliance;',
      '• Applicant to coordinate with Public Works - Development Review for all',
      '  driveways on Las Vegas Boulevard;',
      '• Execute a License and Maintenance Agreement for any non-standard',
      '  improvements within the right-of-way. Fire Prevention Bureau',
      '• Provide a Fire Apparatus Access Road in accordance with Section 503.',
      'TAB/CAC: Paradise - approval.',
    ].join('\n');

    const facts = readFilingFacts(sheet);
    verifyFilingFacts(facts, sheet);
    const conds = facts.filter((f) => f.kind === 'condition');
    // Five bullets in, five conditions out. The count is asserted because the
    // two failure modes this case guards both change it: a swallowed heading
    // merges two, and a wrongly split condition makes six.
    if (conds.length !== 5) {
      return `expected 5 conditions, got ${conds.length}: ${conds.map((c) => c.display.slice(0, 30)).join(' | ')}`;
    }

    // THE DEFECT: a department named inside a condition must not cut it.
    const coordinate = conds.find((c) => c.display.startsWith('Applicant to coordinate'));
    if (!coordinate) return 'the coordination condition was lost entirely';
    if (!coordinate.display.includes('Las Vegas Boulevard')) {
      return `the condition was truncated at a department it mentions: "${coordinate.display}"`;
    }
    if (coordinate.group !== 'Public Works - Development Review') {
      return `wrong department: "${coordinate.group}"`;
    }

    // THE OTHER HALF: a real heading glued to a wrapped bullet must still split.
    const fire = conds.find((c) => c.display.startsWith('Provide a Fire Apparatus'));
    if (!fire) return 'the condition after a glued heading was lost';
    if (fire.group !== 'Fire Prevention Bureau') {
      return `a heading glued to the previous bullet was not split off; got group "${fire.group}"`;
    }
    const licence = conds.find((c) => c.display.startsWith('Execute a License'));
    if (licence && /Fire Prevention Bureau/.test(licence.display)) {
      return 'the heading was left inside the condition above it';
    }
    return null;
  },

  'a-field-list-with-a-hole-deletes-a-field': () => {
    // NEWLINE-SEPARATED, which is what real raw_content is and what a
    // single-line synthetic hid: the value cannot cross the break, so the
    // next-label lookahead is the only way the match can close.
    const zap = [
      'NYC land use application (ZAP / ULURP): Willets Point Phase II',
      'ULURP numbers: 240092ZSQ; N240093ZRQ',
      'CEQR number: 23DME005Q',
      'CEQR type: Type I',
      'CEQR lead agency: DME',
      'Actions: ZS; ZR',
      'Approved: 2024-04-11',
    ].join('\n');

    const facts = readNycFacts(zap);
    const type = facts.find((f) => f.kind === 'nyc_ceqr_type');
    if (!type) return 'the CEQR type label was carried and no fact was read from it';
    if (type.display !== 'Type I') {
      return `the value ran past its own field: "${type.display}"`;
    }
    // The neighbours must be unharmed by the boundary that closes this one.
    const num = facts.find((f) => f.kind === 'nyc_ceqr_number');
    if (num?.display !== '23DME005Q') return `CEQR number read as "${num?.display}"`;
    const agency = facts.find((f) => f.kind === 'nyc_agency');
    if (agency?.display !== 'DME') return `lead agency read as "${agency?.display}"`;
    const approved = facts.find((f) => f.kind === 'nyc_approved');
    if (approved?.display !== '2024-04-11') return `approved read as "${approved?.display}"`;
    return null;
  },

  'junk-never-enters': () => {
    // Each carries real entitlement vocabulary, which is exactly why they used
    // to get in: the gate was reading the instrument, not the subject.
    const cases: [string, string][] = [
      ['daycare', 'USE PERMIT for a daycare in a mixed use zone, site plan attached'],
      ['elementary school', 'Site plan review for an elementary school, conditional use permit'],
      ['place of worship', 'Conditional use permit for a place of worship, site plan amendment'],
      ['medical office', 'Use permit for a medical office building, development standards waiver'],
      ['self-storage', 'Site plan for a self-storage facility, mixed use overlay'],
      ['car wash', 'Use permit for a car wash, design review'],
      ['distribution center', 'Site plan approval for a distribution center'],
      ['trash enclosure', 'Waiver of development standards to allow a trash enclosure'],
      ['cell tower', 'Conditional use permit for a cell tower and equipment shelter'],
    ];
    const admitted = cases.filter(([, text]) => governmentGate(text).matched).map(([term]) => term);
    if (admitted.length === 0) return null;
    return `admitted ${admitted.length} out-of-vertical matters: ${admitted.join(', ')}`;
  },
};

// ---- RUN --------------------------------------------------------------------

function loadCases(): GoldenCase[] {
  return readFileSync(CASES_FILE, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((l, i) => {
      try {
        return JSON.parse(l) as GoldenCase;
      } catch (e) {
        throw new Error(`${CASES_FILE} line ${i + 1} is not JSON: ${(e as Error).message}`);
      }
    });
}

function runPointer(c: GoldenCase & { guard: { file: string; needle: string } }): Result {
  let text: string;
  try {
    text = readFileSync(c.guard.file, 'utf8');
  } catch {
    return {
      id: c.id,
      ok: false,
      detail: `the file that proves this case is gone: ${c.guard.file}`,
    };
  }
  if (!text.includes(c.guard.needle)) {
    return {
      id: c.id,
      ok: false,
      detail:
        `${c.guard.file} no longer contains the assertion this case points at. ` +
        `Either the rule stopped being enforced, or the assertion was reworded and ` +
        `this case needs its needle updated - decide which, do not just update it.`,
    };
  }
  return { id: c.id, ok: true, detail: `proved by ${c.guard.file}` };
}

async function main(): Promise<void> {
  const cases = loadCases();
  const results: Result[] = [];

  console.log('===== THE GOLDEN SET =====');
  console.log(`${cases.length} cases, every one a defect that has already happened.\n`);

  const seen = new Set<string>();
  for (const c of cases) {
    if (seen.has(c.id)) {
      results.push({ id: c.id, ok: false, detail: 'duplicate id' });
      continue;
    }
    seen.add(c.id);

    if (c.guard === 'inline' || c.guard === 'pending') {
      const fn = INLINE[c.id];
      if (!fn) {
        // NOT A SKIP. A case listed as covered and not run is a case that lies.
        results.push({
          id: c.id,
          ok: false,
          detail: 'declared inline but no check is implemented for this id',
        });
        continue;
      }
      let failure: string | null;
      try {
        failure = fn();
      } catch (e) {
        failure = `threw: ${(e as Error).message}`;
      }
      if (c.guard === 'pending') {
        // A PENDING CASE RUNS AND NEVER FAILS THE GATE. It is the acceptance
        // test for a defect that has never been fixed, so there is nothing to
        // regress from - and a red gate nobody can turn green is a gate that
        // gets bypassed. The one hard requirement is that it names the work
        // that closes it; a pending case with nowhere to go is a known issue
        // with better manners.
        if (!c.closedBy) {
          results.push({
            id: c.id,
            ok: false,
            detail: 'pending with no closedBy: name the work that closes it',
          });
          continue;
        }
        results.push({
          id: c.id,
          ok: true,
          detail: failure ?? 'PASSES NOW',
          promote: failure === null,
        });
        continue;
      }
      results.push({
        id: c.id,
        ok: failure === null,
        detail: failure ?? 'asserted here',
      });
    } else {
      results.push(runPointer(c as GoldenCase & { guard: { file: string; needle: string } }));
    }
  }

  const byId = new Map(cases.map((c) => [c.id, c]));
  for (const r of results) {
    const c = byId.get(r.id)!;
    const pending = c.guard === 'pending';
    const mark = !r.ok ? 'FAIL' : pending ? 'OPEN' : 'ok  ';
    console.log(`${mark} ${r.id.padEnd(38)} ${c.shape}`);
    if (!r.ok) {
      console.log(`       ${c.assertion}`);
      console.log(`       -> ${r.detail}`);
    }
  }

  // ---- THE OPEN CASES, SAID LOUDLY. -----------------------------------------
  //
  // Standing rule 3 applied to the golden set: a defect recorded and not yet
  // guarded must not be quieter than one that is.
  const open = results.filter((r) => byId.get(r.id)!.guard === 'pending');
  if (open.length > 0) {
    console.log(`\n  ${'#'.repeat(70)}`);
    console.log(`  #  ${open.length} OPEN CASE${open.length === 1 ? '' : 'S'}: recorded defects that are NOT fixed.`);
    console.log('  #  They run and report. They do not fail the gate, because there is');
    console.log('  #  nothing to regress from until the fix lands.');
    for (const r of open) {
      const c = byId.get(r.id)!;
      console.log('  #');
      console.log(`  #  ${c.id}`);
      console.log(`  #    want : ${c.assertion}`);
      console.log(`  #    today: ${r.detail}`);
      console.log(`  #    closed by: ${c.closedBy}`);
      if (r.promote) {
        console.log('  #    *** THIS NOW PASSES. Change its guard to "inline" and it becomes');
        console.log('  #        a real guard. A case that has passed may never go back.');
      }
    }
    console.log(`  ${'#'.repeat(70)}`);
  }

  const failed = results.filter((r) => !r.ok);
  const inline = results.filter((r) => byId.get(r.id)!.guard === 'inline').length;
  const pointed = results.filter((r) => typeof byId.get(r.id)!.guard === 'object').length;
  console.log(
    `\n${results.length - failed.length - open.length} of ${results.length - open.length} guarded cases hold. ` +
      `${inline} asserted here, ${pointed} pointed at an existing suite, ${open.length} open.`
  );

  if (failed.length > 0) {
    console.log(
      `\nFAIL: ${failed.length} golden case${failed.length === 1 ? '' : 's'} broken. ` +
        `Each one is a defect that has already reached a client document once.`
    );
    process.exitCode = 1;
    return;
  }
  console.log('\nPASS: every recorded defect is still guarded.');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
