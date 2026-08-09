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

// ---- New York City / Socrata (data.cityofnewyork.us) ------------------------
//
// Three datasets, one rule each about what is genuinely required. The rule is
// always the same question: without this field, can the record be given an
// identity and a URL a client can open? If not, it is rejected rather than
// written half-understood.
//
// Socrata returns every column as a JSON string, and OMITS a column entirely
// when its value is null rather than sending null. So every optional field is
// `.nullish()` and nothing may be `.default()`-ed into existence.

// ZAP / ULURP. project_id is the identity AND the thing the public portal URL
// is built from, so it is the one required field. Everything else, including
// the project name, is tolerated missing.
export const NycZapRowSchema = z.object({
  project_id: z.string().min(1),
  project_name: z.string().nullish(),
  project_brief: z.string().nullish(),
  project_status: z.string().nullish(),
  public_status: z.string().nullish(),
  ulurp_non: z.string().nullish(),
  actions: z.string().nullish(),
  ulurp_numbers: z.string().nullish(),
  ceqr_number: z.string().nullish(),
  ceqr_type: z.string().nullish(),
  ceqr_leadagency: z.string().nullish(),
  primary_applicant: z.string().nullish(),
  applicant_type: z.string().nullish(),
  borough: z.string().nullish(),
  community_district: z.string().nullish(),
  cc_district: z.string().nullish(),
  current_milestone: z.string().nullish(),
  current_milestone_date: z.string().nullish(),
  app_filed_date: z.string().nullish(),
  noticed_date: z.string().nullish(),
  certified_referred: z.string().nullish(),
  approval_date: z.string().nullish(),
  completed_date: z.string().nullish(),
});
export type NycZapRowParsed = z.infer<typeof NycZapRowSchema>;

// City Record Online. request_id is the record's identity and the only part of
// the public URL that varies; a notice with no title cannot be presented to a
// client, so short_title is required too.
export const NycCityRecordRowSchema = z.object({
  request_id: z.string().min(1),
  short_title: z.string().min(1),
  start_date: z.string().nullish(),
  end_date: z.string().nullish(),
  event_date: z.string().nullish(),
  due_date: z.string().nullish(),
  agency_name: z.string().nullish(),
  section_name: z.string().nullish(),
  type_of_notice_description: z.string().nullish(),
  category_description: z.string().nullish(),
  additional_description_1: z.string().nullish(),
  // A Socrata URL column, which arrives as an object rather than a string. It
  // is declared here rather than left out because zod STRIPS unknown keys: an
  // undeclared field is not merely unvalidated, it is deleted, so the notice's
  // own document link would vanish between the boundary and the adapter.
  document_links: z.object({ url: z.string().nullish(), description: z.string().nullish() }).nullish(),
  vendor_name: z.string().nullish(),
  contact_name: z.string().nullish(),
  building_name: z.string().nullish(),
  street_address_1: z.string().nullish(),
  city: z.string().nullish(),
  zip_code: z.string().nullish(),
});
export type NycCityRecordRowParsed = z.infer<typeof NycCityRecordRowSchema>;

// CEQR project. The dataset ships its own per-project URL, which is the whole
// reason this adapter does not have to construct one, so the url is required
// and validated as a URL. The CEQR number is the cross-reference key to ZAP.
export const NycCeqrProjectSchema = z.object({
  ceqr: z.string().min(1),
  project_name: z.string().nullish(),
  project_description: z.string().nullish(),
  borough: z.string().nullish(),
  lead_agency: z.string().nullish(),
  url: z.string().url(),
});
export type NycCeqrProjectParsed = z.infer<typeof NycCeqrProjectSchema>;

// CEQR milestone. Dates live in this separate dataset, so a milestone with no
// date carries no information this lane can use.
export const NycCeqrMilestoneSchema = z.object({
  ceqr: z.string().min(1),
  milestone_name: z.string().nullish(),
  milestone_date: z.string().min(1),
});
export type NycCeqrMilestoneParsed = z.infer<typeof NycCeqrMilestoneSchema>;

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
