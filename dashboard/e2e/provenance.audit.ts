// THE PROVENANCE GATE, EXERCISED.
//
// The claim is that a generator CANNOT emit an assessment without labelling it.
// A claim of that shape is only worth anything if someone has tried to break it,
// so this does exactly that: it constructs the documents a careless or
// malicious caller would produce and asserts that each is refused.
//
// Runs in Node with no browser, because the gate is a pure function and driving
// a page to test it would only make the failure slower to read.

import { test, expect } from '@playwright/test';
import {
  assertProvenance,
  commentaryLines,
  provenanceTally,
  ProvenanceError,
  recordLine,
  type ReportDocument,
} from '../lib/report-model';
import { isFiling } from '../lib/report-sections';

function docWith(sections: ReportDocument['sections']): ReportDocument {
  return {
    title: 'T',
    brandName: 'B',
    addressee: 'A',
    clientName: null,
    generatedAt: '2026-08-06T00:00:00.000Z',
    scope: { geography: 'Nevada', period: 'July 2026', pipeline: 'hospitality', filters: [], periodOpen: false },
    sections,
    projectCount: 1,
    recordCount: 1,
  };
}

test('an assessment cannot be emitted unlabelled', async () => {
  // 1. THE HAPPY PATH still passes, or the gate is just refusing everything.
  const good = docWith([
    {
      id: 'headlines',
      title: 'Headline finds',
      lines: [recordLine('A filing exists', 'https://example.gov/item/1', 'legistar')],
      commentary: commentaryLines('I think this one matters most.'),
    },
  ]);
  expect(() => assertProvenance(good)).not.toThrow();
  expect(provenanceTally(good)).toEqual({ RECORD: 1, PRESS: 0, ASSESSMENT: 1 });

  // 2. A LINE WITH NO PROVENANCE AT ALL. This is what a hand-built section
  // object looks like when someone forgets, and what a JSON body from an
  // untrusted caller can always look like.
  const untagged = docWith([
    {
      id: 'headlines',
      title: 'Headline finds',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lines: [{ text: 'The Strip parcel will trade this quarter' } as any],
      commentary: [],
    },
  ]);
  expect(() => assertProvenance(untagged)).toThrow(ProvenanceError);
  expect(() => assertProvenance(untagged)).toThrow(/Unlabelled line in section "headlines"/);

  // 3. AN ASSESSMENT DRESSED AS A RECORD. The dangerous one: Philip's opinion,
  // relabelled so it reads as documented fact. Refused because a RECORD must
  // carry a source the client can open.
  const dressed = docWith([
    {
      id: 'headlines',
      title: 'Headline finds',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lines: [{ provenance: 'RECORD', text: 'This developer is overextended' } as any],
      commentary: [],
    },
  ]);
  expect(() => assertProvenance(dressed)).toThrow(/RECORD line with no source/);

  // 4. COMMENTARY RELABELLED. Even with a source attached, commentary claiming
  // to be a record is refused by the commentary-specific check.
  const laundered = docWith([
    {
      id: 'headlines',
      title: 'Headline finds',
      lines: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      commentary: [{ provenance: 'RECORD', text: 'My read is that this stalls', source: 'https://x' } as any],
    },
  ]);
  expect(() => assertProvenance(laundered)).toThrow(/Commentary in section "headlines" is labelled RECORD/);

  // 5. THE CONSTRUCTOR CANNOT BE TALKED OUT OF IT. commentaryLines takes text
  // and nothing else, so there is no argument that would produce a non
  // ASSESSMENT line from it.
  const lines = commentaryLines('Paragraph one.\n\nParagraph two.');
  expect(lines).toHaveLength(2);
  expect(lines.every((l) => l.provenance === 'ASSESSMENT')).toBe(true);

  // 6. PRESS NEEDS A SOURCE TOO. "Reported elsewhere" with no elsewhere named is
  // an assessment wearing a different hat.
  const unsourcedPress = docWith([
    {
      id: 'headlines',
      title: 'Headline finds',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lines: [{ provenance: 'PRESS', text: 'Reported widely' } as any],
      commentary: [],
    },
  ]);
  expect(() => assertProvenance(unsourcedPress)).toThrow(/PRESS line with no source/);
});

// THE RECORD/PRESS RULE ITSELF, pinned.
//
// The assessment gate above stops us LAUNDERING an opinion as a fact. This test
// covers the other half: whether a fact is described as the right KIND of fact.
// It had no test, and the failure it was missing is the one that reached client
// documents - 328 of 778 government-stream records rendered as [PRESS], because
// the rule was a list of source names rather than a reading of the data.
test('a filing is decided by stream, not by whether its adapter was remembered', async () => {
  // 1. A GOVERNMENT RECORD IS A RECORD, INCLUDING FROM AN ADAPTER NOBODY LISTED.
  // These three are the New York sources, and the bug in full: real filings
  // from zap.planning.nyc.gov, a002-ceqraccess.nyc.gov and
  // a856-cityrecord.nyc.gov, described to a client as press.
  for (const source of ['nyc-zap', 'nyc-ceqr', 'nyc-city-record']) {
    expect(isFiling(source, 'Planning Application', 'government')).toBe(true);
  }
  // And an adapter that does not exist yet, which is the actual point: the rule
  // must not need to be told.
  expect(isFiling('some-future-city-portal', null, 'government')).toBe(true);

  // 2. AN OPPORTUNITY IS A FILING. A tender notice is a document.
  expect(isFiling('brand-new-tender-portal', null, 'opportunity')).toBe(true);

  // 3. INTELLIGENCE IS NOT, AND CANNOT BE ARGUED INTO IT. This is the asymmetry
  // the rule exists to protect: telling a client a document exists that they
  // can go and read, when it does not, is the expensive error. Note the source
  // here IS in the legacy list and the source_type matches the filing regex -
  // the stream still refuses it.
  expect(isFiling('legistar', 'Council Agenda', 'intelligence')).toBe(false);
  expect(isFiling('gli_serper', null, 'intelligence')).toBe(false);

  // 4. NO STREAM STILL HAS TO EARN IT. 487 legacy rows carry no stream; they
  // fall back to the source list rather than defaulting to RECORD.
  expect(isFiling('tedeu', null, null)).toBe(true);
  expect(isFiling('unknown-source', null, null)).toBe(false);
  expect(isFiling('unknown-source', 'Tender Notice', null)).toBe(true);

  // 5. THE TENDER PORTALS THE AUDIT FOUND. 41 null-stream rows, all filings.
  for (const source of ['tenderned', 'austender', 'ungm', 'gebiz']) {
    expect(isFiling(source, null, null)).toBe(true);
  }

  // 6. JOB BOARDS STAY PRESS. An employer advertising a role is evidence a
  // project exists; it is not a document the client can go and read.
  for (const source of ['adzuna', 'careerjet', 'jooble', 'reed']) {
    expect(isFiling(source, null, null)).toBe(false);
  }
});
