// SCHEMAS AT THE BOUNDARY. Every external response a scraper parses is validated
// here before anything downstream touches it.
//
// WHY THIS EXISTS. Two failures have already cost real time, and both were shape
// changes that ran silently:
//   - Granicus stopped serving agendas inline. The lane followed the redirect,
//     got a JavaScript shell, reduced it to 34 characters, matched nothing, and
//     reported "18 agendas fetched" with zero leads written.
//   - Legistar's public viewer ids diverged from its API ids, so every detail URL
//     built from an API id rendered "Invalid parameters!".
// Neither threw. Both looked like a quiet week.
//
// THE CONTRACT, applied by parseRecords below:
//   1. A record that fails its schema is SKIPPED, never written half-understood.
//   2. One malformed record never fails the run.
//   3. Every rejection is counted and its reason recorded: source, endpoint, and
//      the exact field path that failed.
//   4. The counts are reported per run, per source, so a source drifting is
//      visible the day it happens rather than a week later.

import { z } from 'zod';
import { logger } from '../logger';
import { captureSchemaDrift } from '../sentry';

// ---- Legistar (webapi.legistar.com) -----------------------------------------
// Only MatterId is truly required: the adapter tolerates a missing title by
// falling back through name and file, and that tolerance is deliberate. What it
// cannot tolerate is a missing or non-numeric id, because every public URL is
// built from it.
export const LegistarMatterSchema = z.object({
  MatterId: z.number().int().positive(),
  MatterGuid: z.string().optional(),
  MatterFile: z.string().nullish(),
  MatterName: z.string().nullish(),
  MatterTitle: z.string().nullish(),
  MatterTypeName: z.string().nullish(),
  MatterStatusName: z.string().nullish(),
  MatterBodyName: z.string().nullish(),
  MatterIntroDate: z.string().nullish(),
  MatterAgendaDate: z.string().nullish(),
});
export type LegistarMatterParsed = z.infer<typeof LegistarMatterSchema>;

export const LegistarEventSchema = z.object({
  EventId: z.number().int().positive(),
  EventGuid: z.string().optional(),
  EventBodyName: z.string().nullish(),
  EventDate: z.string().nullish(),
  EventLocation: z.string().nullish(),
  EventComment: z.string().nullish(),
});
export type LegistarEventParsed = z.infer<typeof LegistarEventSchema>;

// An attachment without a hyperlink cannot be fetched, so the link is required.
export const LegistarAttachmentSchema = z.object({
  MatterAttachmentId: z.number().int().optional(),
  MatterAttachmentName: z.string().nullish(),
  MatterAttachmentHyperlink: z.string().url(),
});
export type LegistarAttachmentParsed = z.infer<typeof LegistarAttachmentSchema>;

// ---- Serper (google.serper.dev) ---------------------------------------------
// A result with no link or no title is unusable as a lead.
export const SerperOrganicSchema = z.object({
  title: z.string().min(1),
  link: z.string().url(),
  snippet: z.string().nullish(),
  date: z.string().nullish(),
});
export type SerperOrganicParsed = z.infer<typeof SerperOrganicSchema>;

// ---- CEQAnet (ceqanet.lci.ca.gov) -------------------------------------------
// Rows are scraped from schema.org microdata; the SCH number is the record's
// identity and its URL is built from it.
export const CeqanetRowSchema = z.object({
  sch: z.string().min(1),
  title: z.string().min(1),
  documentType: z.string().nullish(),
  leadAgency: z.string().nullish(),
  received: z.string().nullish(),
});
export type CeqanetRowParsed = z.infer<typeof CeqanetRowSchema>;

// ---- SFWMD (ArcGIS REST feature service) ------------------------------------
// ArcGIS wraps every record in { attributes: {...} }. That envelope is the part
// most likely to change silently, so it is validated explicitly.
export const SfwmdFeatureSchema = z.object({
  attributes: z.record(z.string(), z.unknown()),
});
export type SfwmdFeatureParsed = z.infer<typeof SfwmdFeatureSchema>;

// ---- PrimeGov (Las Vegas) ---------------------------------------------------
// documentList carries the template id the HTML agenda URL is built from.
export const PrimeGovDocumentSchema = z.object({
  templateId: z.number().int(),
  templateName: z.string(),
  compileOutputType: z.number().int().nullish(),
});
export const PrimeGovMeetingSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  dateTime: z.string().nullish(),
  date: z.string().nullish(),
  documentList: z.array(PrimeGovDocumentSchema).default([]),
});
export type PrimeGovMeetingParsed = z.infer<typeof PrimeGovMeetingSchema>;

// ---- Granicus (Anaheim ViewPublisher) ---------------------------------------
// Granicus serves HTML, so the boundary here is the PARSED row rather than a
// JSON payload. Validating it still catches the failure that actually happened:
// a listing that yields rows with no usable agenda link or no parseable date.
export const GranicusMeetingSchema = z.object({
  body: z.string().min(1),
  dateIso: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'not a parseable date'),
  agendaUrl: z.string().url(),
  viewerUrls: z.array(z.string().url()).min(1),
});
export type GranicusMeetingParsed = z.infer<typeof GranicusMeetingSchema>;

// ---- the parse harness ------------------------------------------------------

export interface ParseReport {
  source: string;
  endpoint: string;
  parsed: number;
  rejected: number;
  // The first three distinct rejection reasons, each naming the failing field.
  reasons: string[];
}

// Every report from the current run, so a lane can print its own and the run can
// print all of them. Reset per run by resetParseReports().
let reports: ParseReport[] = [];

export function resetParseReports(): void {
  reports = [];
}
export function allParseReports(): ParseReport[] {
  return reports;
}

// A compact, readable description of what failed and where: the field path plus
// the reason, e.g. "MatterId: expected number, received undefined".
function describe(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'unknown validation failure';
  const path = issue.path.length ? issue.path.join('.') : '(root)';
  return `${path}: ${issue.message}`;
}

// Validate a batch at the boundary. Returns only the records that passed, and
// records the telemetry. Never throws.
export function parseRecords<T>(
  schema: z.ZodType<T>,
  rows: unknown[],
  ctx: { source: string; endpoint: string; quiet?: boolean }
): { records: T[]; report: ParseReport } {
  const records: T[] = [];
  const reasons: string[] = [];
  let rejected = 0;

  for (const row of rows) {
    const result = schema.safeParse(row);
    if (result.success) {
      records.push(result.data);
      continue;
    }
    rejected++;
    const reason = describe(result.error);
    if (!reasons.includes(reason) && reasons.length < 3) reasons.push(reason);
  }

  const report: ParseReport = {
    source: ctx.source,
    endpoint: ctx.endpoint,
    parsed: records.length,
    rejected,
    reasons,
  };
  reports.push(report);

  if (rejected > 0 && !ctx.quiet) {
    // Structured: a source drifting is the event the observability phase alerts
    // on, so it carries fields rather than a sentence.
    logger.warn(
      { event: 'schema.rejected', source: ctx.source, endpoint: ctx.endpoint, rejected, total: rows.length, reasons },
      `${ctx.source} rejected ${rejected} of ${rows.length} records from ${ctx.endpoint}`
    );
  }
  // A rejection RATE above the threshold means the shape has probably changed,
  // which is the alert worth waking someone for.
  captureSchemaDrift(ctx.source, ctx.endpoint, records.length, rejected, reasons);
  return { records, report };
}

// Validate a single value at the boundary; null when it fails.
export function parseOne<T>(
  schema: z.ZodType<T>,
  row: unknown,
  ctx: { source: string; endpoint: string }
): T | null {
  const { records } = parseRecords(schema, [row], ctx);
  return records[0] ?? null;
}

export function printParseReports(label = 'Schema validation'): void {
  const withRejects = reports.filter((r) => r.rejected > 0);
  const totalParsed = reports.reduce((a, r) => a + r.parsed, 0);
  const totalRejected = reports.reduce((a, r) => a + r.rejected, 0);
  console.log(
    `${label}: ${totalParsed} records parsed, ${totalRejected} rejected by schema across ${reports.length} boundaries.`
  );
  for (const r of withRejects) {
    console.log(`    ${r.source} (${r.endpoint}): ${r.parsed} parsed / ${r.rejected} rejected`);
    for (const reason of r.reasons) console.log(`        ${reason}`);
  }
}
