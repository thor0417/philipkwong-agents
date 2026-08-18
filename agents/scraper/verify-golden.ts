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

import { readFileSync } from 'node:fs';
import { bestTargetForClustering } from './targets';
import { bestDate } from './cluster';
import { deriveProjectName } from './project-naming';
import { classifyVenueType, governmentGate, provenStage } from '../../lib/taxonomy';
import { resolveGeography } from '../../lib/geography';
import { inCorpusScope } from '../../lib/corpus-scope';
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
    const evidence = [
      { stage: 'filed' as const, attributed: false },
      { stage: 'filed' as const, attributed: false },
      { stage: 'approved' as const, attributed: false },
      // The borrowed one: neither on the project's own site nor said twice.
      { stage: 'under construction' as const, attributed: false },
    ];
    const { stage, refused } = provenStage(evidence);
    if (stage === 'under construction') {
      return 'one unattributed, uncorroborated record advanced the project to under construction';
    }
    if (refused === null) return 'the refusal was not reported, so nothing can say what was withheld';
    // And the control: attribute it and it must be allowed through.
    const allowed = provenStage([
      ...evidence.slice(0, 3),
      { stage: 'under construction' as const, attributed: true },
    ]);
    if (allowed.stage !== 'under construction') {
      return 'an ATTRIBUTED record was also refused, so the rule is not a proof requirement, it is a ceiling';
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
