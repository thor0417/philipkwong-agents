// Shared types and helpers for the branded GLI PDF report. The client builds the
// payload from the currently visible, filtered leads and POSTs it to
// /api/gli-report, which renders the PDF (so the report matches exactly what the
// user sees). No @react-pdf import here, so this stays usable on the client.

import type { GLILead } from './types';

export interface ReportLead {
  title: string;
  developmentCategory: string;
  venueType: string;
  signalType: string;
  // Pass 4 government (Tier 2) fields. Empty string when absent (never fabricated);
  // the report renders players and the primary-document link only where present, so
  // the deliverable reads as intelligence, not a link list.
  sourceType: string;
  applicant: string;
  presentedBy: string;
  representative: string;
  actionSought: string;
  primaryDocumentUrl: string;
  stream: string;
  // Jurisdiction on government rows; location elsewhere (same underlying field).
  location: string;
  // Stream-appropriate date (deadline for opportunities, publication/document
  // date otherwise), YYYY-MM-DD or '' when the row is undated.
  date: string;
  sourceDomain: string;
  url: string;
}

export interface ReportScope {
  streamLabel: string;
  streamKey: string;
  category: string; // 'all' or a development category
  venue: string; // 'all' or a venue_type
  location: string; // free-text location filter
  includesStale: boolean; // whether closed/older records are included
  view?: string; // 'active' | 'archive'
  generatedDate: string; // YYYY-MM-DD
  focusLabel?: string; // preset label, when a focus preset is active
}

export interface ReportPayload {
  scope: ReportScope;
  leads: ReportLead[];
}

function host(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Build the POST payload from the visible, filtered leads.
export function buildReportPayload(leads: GLILead[], scope: ReportScope): ReportPayload {
  const rows: ReportLead[] = leads.map((l) => {
    const iso = l.stream === 'opportunity' ? l.deadline : l.published_date;
    return {
      title: l.title ?? '',
      developmentCategory: l.development_category ?? 'Other',
      venueType: l.venue_type ?? '',
      signalType: l.signal_type ?? '',
      sourceType: l.source_type ?? '',
      applicant: l.applicant ?? '',
      presentedBy: l.presented_by ?? '',
      representative: l.representative ?? '',
      actionSought: l.action_sought ?? '',
      primaryDocumentUrl: l.primary_document_url ?? '',
      stream: l.stream ?? '',
      location: l.location ?? '',
      date: iso ? iso.slice(0, 10) : '',
      sourceDomain: host(l.url),
      url: l.url ?? '',
    };
  });
  return { scope, leads: rows };
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function gliReportFilename(streamKey: string, category: string, isoDate: string): string {
  const cat = category && category !== 'all' ? slug(category) : 'all';
  return `gli_${slug(streamKey)}_${cat}_${isoDate}.pdf`;
}
