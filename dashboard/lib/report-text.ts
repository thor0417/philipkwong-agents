// THE DOCUMENT AS TEXT, so it can be read without opening a PDF.
//
// One renderer per medium is fine; two DOCUMENTS is not. This takes the same
// ReportDocument the PDF renderer takes and prints the same content in the same
// order, so what is verified here is the document that would be sent rather than
// a summary of it. Nothing is computed: every value printed is read off the
// model, which is the property that makes this usable as a check.
//
// It renders the group subheading, the provenance tags, the people block and the
// contact lines, because those are the parts a reader of a client document
// actually inspects and therefore the parts a check has to cover.

import type { Entry, ReportDocument, Line, Section } from './report-model';
import { basisLine, evidenceAdds, suppressRepeatedSources } from './report-model';

// hideSource is set when the line above carried the same citation. See
// suppressRepeatedSources: a citation is printed when it CHANGES.
function lineText(l: Line, hideSource = false): string {
  const meta = l.meta ? `  (${l.meta})` : '';
  const src =
    l.source && !hideSource ? `\n           ${l.sourceLabel ?? ''} ${l.source}`.trimEnd() : '';
  return `  [${l.provenance}] ${l.text}${meta}${src}`;
}

// THE EVIDENCE LINE, ONLY WHERE IT IS EVIDENCE. Moved to report-model beside
// the entry types, because this file and the referral section builder each held
// a copy and the copies disagreed about "in a CR (Commercial Resort) Zone" under
// "Zone: CR (Commercial Resort)". See evidenceAdds there for what the test is
// now and why the old string-equality version passed that case.

function entryText(e: Entry): string {
  const out: string[] = [];
  out.push(`#### ${e.name}${e.meta ? `  -  ${e.meta}` : ''}`);
  if (e.summary) {
    out.push(`  ${e.summary.text}`);
    out.push(`     quoted from the filing: ${e.summary.url}`);
  }
  if (e.assembled) out.push(`  ${e.assembled}`);
  // SCALE BEFORE PEOPLE, AND BEFORE THE FILINGS. It is the first thing a reader
  // asks and it used to be the last thing the document said, if it said it at
  // all. The heading names the provenance in words as well as in tags, because
  // the difference between what a filing states and what a publication reported
  // is the difference this whole document is organised around.
  // THE FILINGS' OWN FIGURES FIRST. Where a county staff report and a newspaper
  // both give a room count, the reader should meet the staff report first: it is
  // the stronger evidence and it is the half a client can act on.
  if (e.stated.length) {
    out.push('  WHAT THE FILINGS STATE');
    for (const f of e.stated) {
      out.push(`    [RECORD] ${f.label}: ${f.display}`);
      if (evidenceAdds(f.label, f.display, f.sentence)) out.push(`             "${f.sentence}"`);
      out.push(`             ${f.sourceLabel}: ${f.url}`);
    }
    if (e.statedHeld > 0) {
      out.push(
        `    ${e.statedHeld} further stated figure${e.statedHeld === 1 ? '' : 's'} ` +
          `held back to keep this block readable.`
      );
    }
  }
  if (e.scale.length) {
    out.push('  SCALE, AS REPORTED IN THE PRESS');
    for (const f of e.scale) {
      out.push(`    [PRESS] ${f.label}: ${f.display}`);
      // The sentence the publication printed, because the label cannot say what
      // an amount was for and the sentence can.
      out.push(`             "${f.sentence}"`);
      out.push(`             ${f.sourceLabel}: ${f.url}`);
    }
    if (e.scaleHeld > 0) {
      out.push(
        `    ${e.scaleHeld} further reported figure${e.scaleHeld === 1 ? '' : 's'} ` +
          `held back to keep this block readable.`
      );
    }
  }
  if (e.people.length) {
    out.push('  THE PEOPLE');
    for (const p of e.people) {
      out.push(`    [${p.provenance}] ${p.name} - ${p.roles.join(', ')}`);
      if (p.firm) out.push(`             ${p.firm}`);
      if (p.address) out.push(`             ${p.address}`);
      out.push(
        `             ${
          p.contact
            ? [p.contact.email, p.contact.phone].filter(Boolean).join(', ')
            : 'No phone or email in the record.'
        }`
      );
      if (p.alsoOn) out.push(`             ${p.alsoOn}`);
      if (p.mergedFrom.length) out.push(`             also filed as: ${p.mergedFrom.join('; ')}`);
      out.push(`             named in: ${p.sourceLabel} ${p.sourceUrl}`);
    }
  }
  if (e.noPeopleNote) out.push(`  THE PEOPLE\n    ${e.noPeopleNote}`);
  if (e.peopleWithheldNote) out.push(`    ${e.peopleWithheldNote}`);
  for (const r of e.records) {
    const date = r.date ?? 'no date in the record';
    const ref = r.reference ? ` ${r.reference}.` : '';
    const figs = r.figures.length ? ` Figures: ${r.figures.join(', ')}.` : '';
    const lang = r.language ? ` [${r.language}]` : '';
    const players = r.players.length
      ? ` Players: ${r.players.map((p) => `${p.name} (${p.role})`).join('; ')}.`
      : '';
    out.push(`  - [${r.provenance}] ${date}.${ref} ${r.text}.${figs}${players}${lang}`);
    out.push(`      ${r.sourceLabel}: ${r.url}`);
    if (r.contact) out.push(`      ${r.contact}`);
  }
  return out.join('\n');
}

function sectionText(sec: Section): string {
  const out: string[] = [];
  out.push('');
  out.push(`## ${sec.title}`);
  if (sec.lede) out.push(`_${sec.lede}_`);
  for (const l of sec.lines) out.push(lineText(l));
  for (const d of sec.derived ?? []) out.push(`
  ${d}`);
  for (const sub of sec.subsections ?? []) {
    out.push('');
    out.push(`#### ${sub.title}`);
    // A citation is printed when it changes, never twice in a row.
    const repeats = suppressRepeatedSources(sub.lines);
    sub.lines.forEach((l, i) => out.push(lineText(l, repeats[i])));
    if (sub.emptyNote) out.push(`  ${sub.emptyNote}`);
  }
  let lastGroup: string | null | undefined;
  for (const e of sec.entries ?? []) {
    if (e.group && e.group !== lastGroup) out.push(`\n### ${e.group}`);
    lastGroup = e.group;
    out.push('');
    out.push(entryText(e));
  }
  if (sec.emptyNote) out.push(`\n  ${sec.emptyNote}`);
  if (sec.commentary.length) {
    out.push('\n  ASSESSMENT');
    for (const l of sec.commentary) out.push(`    ${l.text}`);
  }
  return out.join('\n');
}

export function renderDocumentText(doc: ReportDocument): string {
  const out: string[] = [];
  out.push(`# ${doc.brandName}`);
  out.push(`## ${doc.title}`);
  out.push(`Prepared for ${doc.addressee || '(no addressee)'}`);
  out.push('');
  if (doc.scope.matter) out.push(`Matter     ${doc.scope.matter}`);
  out.push(`Geography  ${doc.scope.geography}`);
  out.push(`Period     ${doc.scope.period}`);
  out.push(`Pipeline   ${doc.scope.pipeline}`);
  out.push(`Filters    ${doc.scope.filters.length ? doc.scope.filters.join(' | ') : 'none'}`);
  out.push(`Basis      ${basisLine(doc.projectCount, doc.recordCount)}`);
  if (doc.scope.periodOpen) {
    out.push(
      'This period has not closed. Regenerating this report later will cover more than it does now.'
    );
  }
  out.push('');
  out.push(
    'Provenance legend. This report separates three kinds of statement so the reader can weigh ' +
      'each. [RECORD] marks facts drawn from the government filings we captured, each with the link ' +
      'to the filing itself. [PRESS] marks facts reported in the press or otherwise beyond our ' +
      'filing record. [ASSESSMENT] marks our own read, offered as judgment rather than as fact.'
  );
  for (const sec of doc.sections) out.push(sectionText(sec));
  return out.join('\n');
}
