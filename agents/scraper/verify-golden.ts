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

const CASES_FILE = 'agents/scraper/fixtures/golden.jsonl';

interface GoldenCase {
  id: string;
  shape: string;
  added: string;
  input: string;
  assertion: string;
  origin?: string;
  guard: 'inline' | { file: string; needle: string };
}

interface Result {
  id: string;
  ok: boolean;
  detail: string;
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

    if (c.guard === 'inline') {
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
    const mark = r.ok ? 'ok  ' : 'FAIL';
    console.log(`${mark} ${r.id.padEnd(38)} ${c.shape}`);
    if (!r.ok) {
      console.log(`       ${c.assertion}`);
      console.log(`       -> ${r.detail}`);
    }
  }

  const failed = results.filter((r) => !r.ok);
  const inline = results.filter((r) => byId.get(r.id)!.guard === 'inline').length;
  console.log(
    `\n${results.length - failed.length} of ${results.length} hold. ` +
      `${inline} asserted here, ${results.length - inline} pointed at an existing suite.`
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
