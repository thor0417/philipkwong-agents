// CSV export for the GLI page. Exports exactly the currently visible, filtered
// rows (the caller passes derived.visibleLeads), so what the user sees is what
// they export. Pure data helpers; the page handles the browser download.

import type { GLILead } from './types';

// Bare domain from a url (leading www. stripped), or '' when absent/unparseable.
function host(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// The stream-appropriate date: deadline for opportunities, publication/document
// date otherwise. Trimmed to YYYY-MM-DD.
function leadDate(l: GLILead): string {
  const iso = l.stream === 'opportunity' ? l.deadline : l.published_date;
  return iso ? iso.slice(0, 10) : '';
}

// RFC-4180 cell: always quoted, embedded quotes doubled. Guards commas, quotes,
// and newlines in titles/content.
function cell(value: string | null | undefined): string {
  const s = value == null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

const HEADERS = [
  'title',
  'development_category',
  'venue_type',
  'signal_type',
  'stream',
  'location',
  'date',
  'source_domain',
  'url',
  'contact_name',
  'contact_email',
  'contact_phone',
];

export function buildGliCsv(leads: GLILead[]): string {
  const rows = leads.map((l) =>
    [
      l.title,
      l.development_category ?? 'Other/Uncategorized',
      l.venue_type,
      l.signal_type,
      l.stream,
      l.location,
      leadDate(l),
      host(l.url),
      l.url,
      l.contact_name,
      l.contact_email,
      l.contact_phone,
    ]
      .map(cell)
      .join(',')
  );
  // CRLF line endings for spreadsheet compatibility.
  return [HEADERS.join(','), ...rows].join('\r\n');
}

// Slug for the filename: lowercase, non-alphanumerics collapsed to a single dash.
function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// Filename encoding the filter context and date, e.g.
// gli_opportunity_leisure-attractions_2026-07-16.csv.
export function gliExportFilename(streamKey: string, category: string, isoDate: string): string {
  const cat = category && category !== 'all' ? slug(category) : 'all';
  return `gli_${slug(streamKey)}_${cat}_${isoDate}.csv`;
}
