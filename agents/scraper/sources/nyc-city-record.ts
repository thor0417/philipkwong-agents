// NEW YORK CITY, LAYER TWO: the City Record, the city's legal notice of record.
//
// Every NYC agency publishes its statutory notices here: City Planning
// Commission and Board of Standards and Appeals hearings, Landmarks
// Preservation Commission calendars, Franchise and Concession Review Committee
// meetings, and city property dispositions. It is the layer that carries a
// HEARING DATE, which no other New York source in this system does.
//
// Dataset dg92-zbpx, refreshed daily (rowsUpdatedAt 2026-08-05, probed
// 2026-08-09; newest notice 2026-08-05). This is the live New York source.
//
// ---------------------------------------------------------------------------
// FILTERING AT THE QUERY, NOT AFTER
// ---------------------------------------------------------------------------
//
// The dataset is 1,099,194 rows and 962,000 of them are "Changes in Personnel"
// - individual civil-service appointments. Paging that to filter it locally
// would be a million rows fetched to keep nine thousand. So the section filter
// is a $where clause and the whole personnel and procurement bulk never leaves
// the server.
//
// Section distribution, measured 2026-08-09:
//
//   Changes in Personnel              961,995   excluded (civil-service appointments)
//   Procurement                       105,183   excluded (contract solicitations/awards)
//   Contract Award Hearings            10,506   excluded (awards, not land use)
//   Public Hearings and Meetings        8,941   KEPT
//   Special Materials                   8,147   excluded (see below)
//   Agency Rules                        3,063   excluded (rulemaking)
//   Public Comment on Contract Awards     961   excluded
//   Property Disposition                  243   KEPT
//   Court Notices                         155   excluded
//
// The two kept sections total 9,184 rows and are the land use layer:
// 'Public Hearings and Meetings' is where CPC, BSA, LPC and FCRC publish their
// hearing calendars, and 'Property Disposition' is where the city advertises
// disposing of its own real property.
//
// 'Special Materials' (8,147) was considered and excluded: it carries CEQR
// determinations published as legal notices, which is the same layer
// sources/nyc-ceqr reads directly and in a structured form. Taking it here as
// well would roughly double capture in exchange for duplicates of records this
// system already has from a better source.
//
// ---------------------------------------------------------------------------
// WHAT PROPERTY DISPOSITION ACTUALLY NAMES
// ---------------------------------------------------------------------------
//
// It names the AGENCY and the SITE, not a buyer. Measured over the section:
// a disposition notice is published BEFORE a counterparty is selected ("FOR
// ACQUISITION - portions of Block 3264, Lot 20", an EDC solar-lease RFP naming
// three Bronx sites), so there is no named buyer to capture at this stage - the
// buyer appears later, in the procurement award stream this adapter excludes.
// So these rows are a SITE-level early signal, which is still worth having
// (block and lot identify the parcel years before an entitlement is filed), but
// the "city land sale with a named buyer" shape does not exist in this section.
//
// The section is also polluted by a recurring NYPD notice of pending
// destruction of seized tobacco products, republished quarterly. It carries no
// leisure or land use vocabulary, so the gate rejects it without needing a
// special case.

import type { NormalizedLead } from './types';
import { gateDecide, admissionLabel } from '../gate-decide';
import { bypassHits } from '../targets';
import { NycCityRecordRowSchema, parseRecords, type NycCityRecordRowParsed } from './schemas';
import { sodaFetchAll, sodaScalar, soqlTimestamp } from './socrata';

export const NYC_CITY_RECORD_DATASET = 'dg92-zbpx';
export const NYC_CITY_RECORD_MARKET = 'New York City';

// The sections this adapter reads. Kept as data so the run report can state
// exactly which categories were selected rather than leaving it to be read out
// of a SoQL string.
export const LAND_USE_SECTIONS = ['Public Hearings and Meetings', 'Property Disposition'] as const;

// THE ONE PLACE A CITY RECORD URL IS BUILT. Verified live: RequestDetail
// resolves to a "Notice Details" page carrying the notice text.
export function cityRecordUrl(requestId: string): string | null {
  const id = String(requestId ?? '').trim();
  // A City Record request id is a numeric string (a date-stamped sequence like
  // 20260729001, and older short forms). Anything else cannot address a page.
  if (!/^\d{6,20}$/.test(id)) return null;
  return `https://a856-cityrecord.nyc.gov/RequestDetail/${id}`;
}

// document_links arrives as a Socrata URL object whose value may hold SEVERAL
// comma-separated links with HTML-escaped ampersands. The first usable one is
// the notice's own document.
function primaryDocument(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const url = (raw as Record<string, unknown>).url;
  if (typeof url !== 'string' || !url) return null;
  const first = url.replace(/&amp;/g, '&').split(',')[0].trim();
  try {
    return new URL(first).protocol.startsWith('http') ? first : null;
  } catch {
    return null;
  }
}

// Strip the HTML the long description fields carry, so the gate judges words
// rather than markup and the stored record reads as text.
function stripHtml(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;| /g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    // Socrata carries a stray 0x1a where the source had a smart quote.
    .replace(//g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const isoDay = (v: string | null | undefined): string | null => {
  if (!v || Number.isNaN(Date.parse(v))) return null;
  return v.slice(0, 10);
};

const DEFAULT_SINCE = '2023-01-01';

function sinceSetting(): string | null {
  const raw = (process.env.NYC_CITY_RECORD_SINCE ?? DEFAULT_SINCE).trim();
  if (raw.toLowerCase() === 'all') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : DEFAULT_SINCE;
}

function whereClause(since: string | null): string {
  const sections = LAND_USE_SECTIONS.map((s) => `'${s}'`).join(',');
  const base = `section_name in (${sections})`;
  return since ? `${base} AND start_date > ${soqlTimestamp(since)}` : base;
}

export interface CityRecordStats {
  fetched: number;
  schemaRejected: number;
  gateAdmitted: number;
  gateRejected: number;
  bypassHits: number;
  unparsableId: number;
  written: number;
  pages: number;
  complete: boolean;
  error: string | null;
  newestNoticeDate: string | null;
  // THE CALENDAR NUMBER. How many notices carry a hearing date still in the
  // future, which is what decides whether a calendar screen is buildable.
  futureHearings: number;
  futureHearingsBySection: Record<string, number>;
  withEventDate: number;
  withDocument: number;
  perSection: Record<string, number>;
  rejectReasons: Record<string, number>;
  admittedSamples: string[];
  rejectedSamples: string[];
}

export const cityRecordStats: CityRecordStats = {
  fetched: 0,
  schemaRejected: 0,
  gateAdmitted: 0,
  gateRejected: 0,
  bypassHits: 0,
  unparsableId: 0,
  written: 0,
  pages: 0,
  complete: true,
  error: null,
  newestNoticeDate: null,
  futureHearings: 0,
  futureHearingsBySection: {},
  withEventDate: 0,
  withDocument: 0,
  perSection: {},
  rejectReasons: {},
  admittedSamples: [],
  rejectedSamples: [],
};

function resetStats(): void {
  Object.assign(cityRecordStats, {
    fetched: 0,
    schemaRejected: 0,
    gateAdmitted: 0,
    gateRejected: 0,
    bypassHits: 0,
    unparsableId: 0,
    written: 0,
    pages: 0,
    complete: true,
    error: null,
    newestNoticeDate: null,
    futureHearings: 0,
    futureHearingsBySection: {},
    withEventDate: 0,
    withDocument: 0,
    perSection: {},
    rejectReasons: {},
    admittedSamples: [],
    rejectedSamples: [],
  });
}

// The text the gate judges: the notice's own subject plus its description. The
// description is where a hearing notice actually names the project, because the
// title is frequently just "City Planning Commission Public Hearing".
function gateTextOf(r: NycCityRecordRowParsed, description: string): string {
  return [r.short_title, description, r.agency_name, r.type_of_notice_description, r.building_name]
    .filter(Boolean)
    .join(' ');
}

export async function scrapeNycCityRecord(): Promise<NormalizedLead[]> {
  resetStats();
  const since = sinceSetting();
  const where = whereClause(since);

  const newest = await sodaScalar(NYC_CITY_RECORD_DATASET, 'max(start_date)', where);
  cityRecordStats.newestNoticeDate = isoDay(newest);

  const result = await sodaFetchAll({
    dataset: NYC_CITY_RECORD_DATASET,
    where,
    // request_id is unique and stable, so it is a safe paging order.
    order: 'request_id',
  });
  cityRecordStats.pages = result.pages;
  cityRecordStats.complete = result.complete;
  cityRecordStats.error = result.error;
  if (!result.complete) {
    console.warn(`NYC City Record: PARTIAL harvest after ${result.pages} pages (${result.error}).`);
  }

  const { records } = parseRecords(NycCityRecordRowSchema, result.rows, {
    source: 'nyc-city-record',
    endpoint: `resource/${NYC_CITY_RECORD_DATASET}`,
  });
  cityRecordStats.fetched = result.rows.length;
  cityRecordStats.schemaRejected = result.rows.length - records.length;

  const leads: NormalizedLead[] = [];
  const seen = new Set<string>();
  const todayIso = new Date().toISOString().slice(0, 10);

  for (const r of records) {
    const section = r.section_name ?? '(unknown)';
    cityRecordStats.perSection[section] = (cityRecordStats.perSection[section] ?? 0) + 1;

    const eventDay = isoDay(r.event_date);
    if (eventDay) cityRecordStats.withEventDate++;
    // Counted over EVERY fetched notice, not just the gate-admitted ones,
    // because the question the count answers is about the source's capability,
    // not about this vertical's slice of it.
    if (eventDay && eventDay > todayIso) {
      cityRecordStats.futureHearings++;
      cityRecordStats.futureHearingsBySection[section] =
        (cityRecordStats.futureHearingsBySection[section] ?? 0) + 1;
    }

    const url = cityRecordUrl(r.request_id);
    if (!url) {
      cityRecordStats.unparsableId++;
      continue;
    }

    const description = stripHtml(r.additional_description_1).slice(0, 2000);
    const title = stripHtml(r.short_title).slice(0, 200);
    const gateText = gateTextOf(r, description);

    const decision = gateDecide({
      source: 'nyc-city-record',
      market: NYC_CITY_RECORD_MARKET,
      key: url,
      title,
      gate_text: gateText,
      bypass_mode: 'all',
    });

    if (!decision.admitted) {
      cityRecordStats.gateRejected++;
      cityRecordStats.rejectReasons[decision.reason] =
        (cityRecordStats.rejectReasons[decision.reason] ?? 0) + 1;
      if (cityRecordStats.rejectedSamples.length < 10) {
        cityRecordStats.rejectedSamples.push(`[${section}] ${title} :: ${description.slice(0, 110)}`);
      }
      continue;
    }
    cityRecordStats.gateAdmitted++;
    if (cityRecordStats.admittedSamples.length < 10) {
      cityRecordStats.admittedSamples.push(`[${section}] ${title} :: ${description.slice(0, 110)}`);
    }
    if (decision.bypass) cityRecordStats.bypassHits++;
    if (seen.has(url)) continue;
    seen.add(url);

    const doc = primaryDocument(r.document_links);
    if (doc) cityRecordStats.withDocument++;

    const published = isoDay(r.start_date);
    const hits = [...new Set(bypassHits(gateText).map((h) => h.term))];
    const address = [r.building_name, r.street_address_1, r.city, r.zip_code].filter(Boolean).join(', ');

    leads.push({
      title,
      url,
      raw_content: [
        `NYC City Record notice: ${title}`,
        `Request id: ${r.request_id}`,
        `Section: ${section}`,
        r.agency_name ? `Agency: ${r.agency_name}` : '',
        r.type_of_notice_description ? `Notice type: ${r.type_of_notice_description}` : '',
        r.category_description ? `Category: ${r.category_description}` : '',
        // The hearing date is written as a bare ISO date on purpose: it is what
        // the object-model milestone parser reads, and it is the reason this
        // source exists in the system.
        eventDay ? `Hearing / meeting date: ${eventDay}` : '',
        published ? `Published in the City Record: ${published}` : '',
        // end_date (the notice's last publication day) is deliberately NOT
        // written as an ISO date. It is routinely months ahead and carries no
        // client meaning, and the milestone parser takes the MAX future date in
        // the text - so emitting it would let a printing schedule outrank a real
        // hearing date as the record's milestone.
        r.due_date && isoDay(r.due_date) ? `Response due: ${isoDay(r.due_date)}` : '',
        address ? `Address: ${address}` : '',
        r.vendor_name ? `Vendor / counterparty: ${r.vendor_name}` : '',
        r.contact_name ? `Contact: ${r.contact_name}` : '',
        description ? `Notice: ${description}` : '',
        `Gate: ${admissionLabel(decision)}`,
        hits.length ? `Target-term hits: ${hits.join(', ')}` : '',
        doc ? `Notice document: ${doc}` : '',
        `Notice page: ${url}`,
      ]
        .filter(Boolean)
        .join('\n'),
      company: r.agency_name ?? null,
      location: NYC_CITY_RECORD_MARKET,
      // A hearing is a MILESTONE, not a submission deadline. Setting it as a
      // deadline would make the record an Opportunity that dies the day the
      // hearing passes; a government record is always a project event.
      deadline: null,
      published_date: published ? new Date(`${published}T00:00:00Z`).toISOString() : null,
      value_estimate: null,
      source: 'nyc-city-record',
      source_type: 'Public Notice',
      applicant: r.vendor_name ?? null,
      action_sought: r.type_of_notice_description ?? null,
      primary_document_url: doc ?? url,
      has_primary_document: Boolean(doc),
    });
  }

  cityRecordStats.written = leads.length;
  console.log(
    `NYC City Record: ${cityRecordStats.fetched} rows fetched over ${cityRecordStats.pages} pages` +
      ` -> ${cityRecordStats.schemaRejected} schema-rejected -> ${cityRecordStats.gateAdmitted} gate-admitted` +
      ` / ${cityRecordStats.gateRejected} gate-rejected -> ${leads.length} leads` +
      ` | ${cityRecordStats.withEventDate} carry a hearing date, ${cityRecordStats.futureHearings} of them still in the future` +
      ` | newest notice ${cityRecordStats.newestNoticeDate}`
  );
  return leads;
}
