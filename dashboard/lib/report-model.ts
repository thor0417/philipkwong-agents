// THE DOCUMENT MODEL, AND THE PROVENANCE RULE.
//
// WHY THE DOCUMENTS ARE TRUSTED. A client reading one of these has to be able to
// tell three things apart at a glance:
//
//   [RECORD]      this is in a filing we captured, and here is the link
//   [PRESS]       this was reported somewhere, and here is who reported it
//   [ASSESSMENT]  this is Philip's read. It is not in any document.
//
// Blur those and the whole product is worthless: an assessment presented as a
// finding is a claim the client cannot check, and one wrong one destroys the
// credibility of the twenty that were right.
//
// ENFORCED IN CODE, NOT BY PROMPT OR BY CONVENTION.
//
// Three mechanisms, each closing a different hole:
//
//   1. THE TYPE. Every Line carries `provenance`. There is no default and the
//      field is not optional, so a section that emits a line without deciding
//      what kind of line it is does not compile.
//
//   2. THE CONSTRUCTOR. Commentary is the dangerous case - it is free text
//      Philip types, and it is the one thing that is never in a record. It can
//      only be built through commentaryLines(), which stamps ASSESSMENT itself.
//      A caller cannot pass a provenance to it, so commentary cannot be
//      mislabelled even deliberately.
//
//   3. THE GATE. assertProvenance() walks the whole document immediately before
//      rendering and throws on any line whose provenance is not one of the
//      three, and on any RECORD or PRESS line with no source. The renderer is
//      never reached with an unlabelled line, and generation fails loudly rather
//      than emitting a document that looks fine and is not.
//
// The third exists because the first two can be defeated by a cast, and this
// codebase does cast at the PostgREST boundary. The gate does not care how a
// line was constructed.

export const PROVENANCE = ['RECORD', 'PRESS', 'ASSESSMENT'] as const;
export type Provenance = (typeof PROVENANCE)[number];

export interface Line {
  provenance: Provenance;
  text: string;
  // Where a RECORD or PRESS line came from. Required for those two by
  // assertProvenance: a record the client cannot open is not a record, it is a
  // claim.
  source?: string;
  sourceLabel?: string;
  // Optional trailing metadata, printed dimmed: a date, a market, a stage.
  meta?: string;
}

export interface Section {
  id: string;
  title: string;
  // What the section is, printed under the heading in the document itself so a
  // reader knows what they are looking at.
  lede?: string;
  lines: Line[];
  // Philip's commentary on this section. Always ASSESSMENT; see below.
  commentary: Line[];
  // Set when a section had nothing to say. Rendered as an explicit statement
  // rather than omitted: a missing section and an empty one mean different
  // things, and silently dropping one is how a report implies coverage it does
  // not have.
  emptyNote?: string;
}

export interface DocumentScopeStatement {
  // Printed on the cover, always. A report scoped to Nevada says so.
  geography: string;
  period: string;
  pipeline: string;
  filters: string[];
  // True when the period has not closed, so the document is not reproducible.
  periodOpen: boolean;
}

export interface ReportDocument {
  title: string;
  brandName: string;
  addressee: string;
  clientName: string | null;
  generatedAt: string;
  scope: DocumentScopeStatement;
  sections: Section[];
  projectCount: number;
  recordCount: number;
}

/**
 * The ONLY way to build commentary.
 *
 * Takes text and returns ASSESSMENT lines. There is deliberately no provenance
 * parameter: a caller cannot mark Philip's own writing as a record, and does not
 * have to remember to mark it as an assessment either.
 */
export function commentaryLines(text: string | null | undefined): Line[] {
  const t = String(text ?? '').trim();
  if (!t) return [];
  return t
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ provenance: 'ASSESSMENT' as const, text: p }));
}

/**
 * A captured filing. RECORD requires a link, because the point of the label is
 * that the client can go and read it.
 */
export function recordLine(text: string, source: string, sourceLabel?: string, meta?: string): Line {
  return { provenance: 'RECORD', text, source, sourceLabel, meta };
}

/** Something reported elsewhere. Same requirement: name who reported it. */
export function pressLine(text: string, source: string, sourceLabel?: string, meta?: string): Line {
  return { provenance: 'PRESS', text, source, sourceLabel, meta };
}

export class ProvenanceError extends Error {}

/**
 * THE GATE. Throws unless every line in the document is properly labelled and
 * sourced.
 *
 * Called by the generation route before rendering, so a defect stops the
 * document rather than shipping inside it. The error names the section and the
 * text, because "provenance error" with no location is not actionable.
 */
export function assertProvenance(doc: ReportDocument): void {
  const valid = new Set<string>(PROVENANCE);
  for (const section of doc.sections) {
    const all = [...section.lines, ...section.commentary];
    for (const line of all) {
      if (!valid.has(line.provenance as string)) {
        throw new ProvenanceError(
          `Unlabelled line in section "${section.id}": ${JSON.stringify(line.text).slice(0, 120)}`
        );
      }
      if ((line.provenance === 'RECORD' || line.provenance === 'PRESS') && !line.source) {
        throw new ProvenanceError(
          `${line.provenance} line with no source in section "${section.id}": ` +
            JSON.stringify(line.text).slice(0, 120)
        );
      }
    }
    // Commentary that is not an assessment is the specific defect the brief
    // names: a generator that can emit an assessment without labelling it.
    for (const line of section.commentary) {
      if (line.provenance !== 'ASSESSMENT') {
        throw new ProvenanceError(
          `Commentary in section "${section.id}" is labelled ${line.provenance}, not ASSESSMENT.`
        );
      }
    }
  }
}

/** Counts by provenance, for the preview and the coverage note. */
export function provenanceTally(doc: ReportDocument): Record<Provenance, number> {
  const out: Record<Provenance, number> = { RECORD: 0, PRESS: 0, ASSESSMENT: 0 };
  for (const s of doc.sections) {
    for (const l of [...s.lines, ...s.commentary]) out[l.provenance]++;
  }
  return out;
}

// A page holds roughly this many lines at the document's type size, measured
// against the existing renderer's A4 layout. Used for the composer's page
// estimate, which is deliberately called an estimate.
const LINES_PER_PAGE = 34;

export function estimatePages(doc: ReportDocument): number {
  let lines = 6; // the cover
  for (const s of doc.sections) {
    lines += 3 + s.lines.length * 2 + s.commentary.length * 2 + (s.emptyNote ? 1 : 0);
  }
  return Math.max(1, Math.ceil(lines / LINES_PER_PAGE));
}

/** "1 project, 4 records" - the basis line, pluralised. */
export function basisLine(projects: number, records: number): string {
  return `${projects} project${projects === 1 ? '' : 's'}, ${records} record${records === 1 ? '' : 's'}`;
}
