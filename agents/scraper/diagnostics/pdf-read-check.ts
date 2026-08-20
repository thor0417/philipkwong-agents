// READ-ONLY. THE FOUR READ CHECKS, RUN AGAINST THE PDF A CLIENT RECEIVES.
//
//   node --import tsx agents/scraper/diagnostics/pdf-read-check.ts <file.pdf>...
//
// Nothing is written. THIS EXISTS BECAUSE THE MARKDOWN IS NOT THE DOCUMENT.
// Every check run through generate.ts --text is a check on report-text, and all
// four defects found on the Heart Hotel brief were in the OTHER renderer. The
// footer is the clearest case: report-text prints it once as a header line and
// @react-pdf repeats it `fixed` on every page, so "one project" appeared six
// times in the artefact and zero times in the file that was checked.
//
// So the tags are read out of the PDF's own text layer. doc-pdf renders
// [RECORD] / [PRESS] / [ASSESSMENT] immediately before the line it belongs to,
// which makes the nearest PRECEDING tag the provenance of any text found - the
// same association a reader makes with their eyes.

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const FUNCTION_TAIL =
  /\s(on|in|at|for|to|of|with|by|from|as|and|or|the|a|an|its|his|her|their|that|which|into|over|after|before|near|amid|about)\.?$/i;
const PRESS_CAP = 5;

interface Segment {
  tag: string;
  text: string;
}

/** Every [TAG] and the text that follows it, up to the next tag. */
function segments(text: string): Segment[] {
  const out: Segment[] = [];
  const re = /\[(RECORD|PRESS|ASSESSMENT)\]/g;
  const hits: { tag: string; at: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) hits.push({ tag: m[1], at: m.index, end: re.lastIndex });
  for (let i = 0; i < hits.length; i++) {
    out.push({
      tag: hits[i].tag,
      text: text.slice(hits[i].end, hits[i + 1]?.at ?? text.length).replace(/\s+/g, ' ').trim(),
    });
  }
  return out;
}

async function main(): Promise<void> {
  const files = process.argv.slice(2).filter((a) => a.endsWith('.pdf'));
  if (!files.length) {
    console.error('give me one or more .pdf paths');
    process.exit(1);
  }
  const pdf = (await import('pdf-parse/lib/pdf-parse.js')).default;

  let totals = { placeholder: 0, pressContact: 0, fragments: 0, overCap: 0 };

  for (const f of files) {
    const buf = await readFile(f);
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      console.log(`${basename(f)}  NOT A PDF`);
      continue;
    }
    const parsed = await pdf(buf);
    const text = String(parsed.text ?? '');
    const pages = Number(parsed.numpages ?? 0);
    const segs = segments(text);

    // 0. IS THE FOOTER EVEN IN THE TEXT LAYER? A zero on check 1 means nothing
    //    if the footer never reached the string being searched. The brand is in
    //    the footer and nowhere else on an inside page, so its count should
    //    equal the page count. Printed, not assumed.
    const brandHits = (text.match(/JKR & Associates/g) ?? []).length;

    // 1. THE PLACEHOLDER, ANYWHERE, INCLUDING EVERY PAGE FOOTER.
    const placeholder = (text.match(/one project/gi) ?? []).length;

    // 2. "Contact:" WHERE THE NEAREST PRECEDING TAG IS [PRESS].
    const pressContact = segs.filter((s) => s.tag === 'PRESS' && /\bContact:/.test(s.text)).length;

    // 3. A RECORD LINE ENDING MID-WORD. The line is the segment's first
    //    sentence-ish run; a cut we marked ends in "..." and is not counted,
    //    because a marked cut is the fix rather than the defect.
    const fragments = segs.filter((s) => {
      if (s.tag === 'ASSESSMENT') return false;
      const head = s.text.split(/\s{2,}|https?:\/\//)[0].trim();
      if (!head || head.endsWith('...')) return false;
      return FUNCTION_TAIL.test(head.replace(/[.\s]+$/, ' ' + (head.match(/(\w+)\.?\s*$/)?.[1] ?? '')));
    }).length;

    // 3b. And the plain form: the exact shapes that reached a brief.
    const knownFragments = (text.match(/Development Site On\b|Zoning \.\.\. -|approved for failed \.\.\./g) ?? [])
      .length;

    // 4. PRESS ROWS INSIDE THE PRESS SECTION.
    // THE BOUNDARY IS A NAMED HEADING, NOT A SHAPE. The first cut of this looked
    // for "a line that looks like a heading" and cut the Heart Hotel block after
    // two rows when it holds five - so it reported "0 over the cap" from a block
    // it could not see the end of, which is the fourth anatomy of the day
    // wearing a diagnostic's clothes. Caught by counting the tags by hand
    // against the PDF's own text before believing the number.
    //
    // The total is printed alongside, so a boundary that goes wrong again shows
    // up as a discrepancy instead of as a clean result.
    const head = text.indexOf('Reported beyond our record');
    let pressRows = 0;
    if (head >= 0) {
      const after = text.slice(head + 'Reported beyond our record'.length);
      const end = after.search(/What this brief does not cover|Coverage note/);
      pressRows = segments(end > 0 ? after.slice(0, end) : after).filter((s) => s.tag === 'PRESS').length;
    }
    const pressTotal = segs.filter((s) => s.tag === 'PRESS').length;
    const overCap = Math.max(0, pressRows - PRESS_CAP);

    totals.placeholder += placeholder;
    totals.pressContact += pressContact;
    totals.fragments += fragments + knownFragments;
    totals.overCap += overCap;

    console.log(
      `${basename(f).padEnd(34)} pages=${String(pages).padStart(2)}  footer=${brandHits}  ` +
        `"one project"=${placeholder}  press-Contact=${pressContact}  ` +
        `fragments=${fragments + knownFragments}  press-block=${pressRows}/${PRESS_CAP} (over ${overCap})  [PRESS] in doc=${pressTotal}`
    );
  }

  console.log('');
  console.log('-'.repeat(96));
  console.log(`  "one project" anywhere, incl. footers: ${totals.placeholder}`);
  console.log(`  "Contact:" on a press row:             ${totals.pressContact}`);
  console.log(`  record lines ending mid-word:          ${totals.fragments}`);
  console.log(`  press rows over the cap:               ${totals.overCap}`);
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
