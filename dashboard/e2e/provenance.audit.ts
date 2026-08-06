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
