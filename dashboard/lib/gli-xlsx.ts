// Branded, stream-specific XLSX export for the GLI page (replaces the plain CSV).
// Two sheets: a Summary/cover sheet with Philip Kwong / GLI branding, scope, and
// breakdowns; and a styled Leads sheet with a burnt-orange header band, bold white
// frozen header, section rows (by signal type, or by source type on the government
// stream), alternating shading, sensible widths, real clickable hyperlinks, and a
// DATE UNKNOWN marker for undated rows. Columns are chosen per stream and any
// column empty across the filtered set is dropped. Exports exactly the currently
// visible, filtered rows (Active/Archive respected). Pass 4 government intelligence
// (source type, jurisdiction, players, action sought, primary document) is carried
// so a partner reads it as intelligence, not a link list.

import ExcelJS from 'exceljs';
import type { GLILead } from './types';
import { GLI_SIGNAL_ORDER } from './types';

const ACCENT = 'FFB34700';
const HEADER_TEXT = 'FFFFFFFF';
const INK = 'FF0A0A0A';
const SECTION_FILL = 'FFF0EFEC';
const ALT_FILL = 'FFFAFAF9';
const HAIRLINE = 'FFD7D3CD';

const DATE_UNKNOWN = 'DATE UNKNOWN';

export interface XlsxScope {
  streamKey: string; // 'opportunity' | 'intelligence' | 'government'
  streamLabel: string;
  view: string; // Active | Archive
  category: string; // 'all' or a category
  market: string; // location filter or 'Global'
  dateRange: string;
  generatedDate: string;
  focusLabel?: string;
}

function host(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// The stream-appropriate date, YYYY-MM-DD, or the DATE UNKNOWN marker when the row
// carries no usable date (deadline for opportunities, publication/document date
// otherwise). Matches how the table badges undated rows.
function leadDate(l: GLILead, streamKey: string): string {
  const iso = streamKey === 'opportunity' ? l.deadline : l.published_date;
  return iso ? iso.slice(0, 10) : DATE_UNKNOWN;
}

// Government rows carry Pass 4 players; a single "Applicant or Presented By"
// column prefers the named applicant, then the presenter.
function applicantOrPresenter(l: GLILead): string {
  return (l.applicant ?? '').trim() || (l.presented_by ?? '').trim();
}

interface Col {
  header: string;
  get: (l: GLILead) => string; // display text
  link?: (l: GLILead) => string; // when set and non-empty, the cell is a hyperlink
  width: number;
}

// Stream-specific column sets. Category and Title lead; the Source column renders
// the host as a clickable link to the record; government adds jurisdiction, the
// player fields, action sought, and a distinct Primary Document link.
function columnsFor(streamKey: string): Col[] {
  const category: Col = { header: 'Category', get: (l) => l.development_category ?? 'Other', width: 20 };
  const title: Col = { header: 'Title', get: (l) => l.title ?? '', width: 58 };
  const source: Col = { header: 'Source', get: (l) => host(l.url), link: (l) => l.url ?? '', width: 30 };

  if (streamKey === 'opportunity') {
    return [
      category,
      { header: 'Signal', get: (l) => l.signal_type ?? '', width: 20 },
      title,
      { header: 'Location', get: (l) => l.location ?? '', width: 26 },
      { header: 'Deadline', get: (l) => leadDate(l, 'opportunity'), width: 14 },
      source,
    ];
  }
  if (streamKey === 'government') {
    return [
      category,
      { header: 'Source Type', get: (l) => l.source_type ?? '', width: 22 },
      title,
      { header: 'Jurisdiction', get: (l) => l.location ?? '', width: 30 },
      { header: 'Applicant or Presented By', get: applicantOrPresenter, width: 26 },
      { header: 'Action Sought', get: (l) => l.action_sought ?? '', width: 42 },
      { header: 'Date', get: (l) => leadDate(l, 'government'), width: 14 },
      source,
      {
        header: 'Primary Document',
        get: (l) => host(l.primary_document_url) || (l.primary_document_url ? 'Primary document' : ''),
        link: (l) => l.primary_document_url ?? '',
        width: 30,
      },
    ];
  }
  // intelligence
  return [
    category,
    { header: 'Venue', get: (l) => l.venue_type ?? '', width: 22 },
    title,
    { header: 'Location', get: (l) => l.location ?? '', width: 26 },
    { header: 'Published', get: (l) => leadDate(l, 'intelligence'), width: 14 },
    source,
  ];
}

// A column earns its place only if some visible row fills it (text or link).
function columnHasData(col: Col, rows: GLILead[]): boolean {
  return rows.some((l) => (col.link ? col.link(l).trim() !== '' : col.get(l).trim() !== ''));
}

function countBy(rows: GLILead[], key: (l: GLILead) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r).trim() || 'Unclassified';
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

// Section grouping: government reads by source type, the other streams by signal
// type. Signal groups keep the canonical GLI order; source-type groups sort by size.
function groupField(streamKey: string): (l: GLILead) => string {
  return streamKey === 'government'
    ? (l) => (l.source_type ?? '').trim() || 'Unclassified'
    : (l) => (l.signal_type ?? '').trim() || 'Unclassified';
}

function groupRows(rows: GLILead[], streamKey: string): { label: string; items: GLILead[] }[] {
  const key = groupField(streamKey);
  const m = new Map<string, GLILead[]>();
  for (const l of rows) {
    const k = key(l);
    const b = m.get(k);
    if (b) b.push(l);
    else m.set(k, [l]);
  }
  const entries = [...m.entries()];
  if (streamKey === 'government') {
    entries.sort((a, b) => b[1].length - a[1].length);
  } else {
    const rank = (s: string) => {
      const i = (GLI_SIGNAL_ORDER as readonly string[]).indexOf(s);
      return i < 0 ? GLI_SIGNAL_ORDER.length : i;
    };
    entries.sort((a, b) => rank(a[0]) - rank(b[0]));
  }
  return entries.map(([label, items]) => ({ label, items }));
}

export async function buildGliWorkbook(leads: GLILead[], scope: XlsxScope): Promise<Blob> {
  const streamKey = scope.streamKey;
  const cols = columnsFor(streamKey).filter((c) => columnHasData(c, leads));
  const ncols = cols.length;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Philip Kwong / GLI';

  // ---- Summary / cover sheet ----
  const cover = wb.addWorksheet('Summary');
  cover.getColumn(1).width = 30;
  cover.getColumn(2).width = 62;
  const title = cover.addRow(['Philip Kwong / Grant Leisure International']);
  title.font = { name: 'Arial', bold: true, size: 16, color: { argb: INK } };
  const sub = cover.addRow([scope.focusLabel ?? 'GLI Development Intelligence']);
  sub.font = { name: 'Arial', bold: true, size: 12, color: { argb: ACCENT } };
  cover.addRow([]);
  const meta: [string, string][] = [
    ['Stream', scope.streamLabel],
    ['View', scope.view],
    ['Category', scope.category !== 'all' ? scope.category : 'All categories'],
    ['Market', scope.market],
    ['Date range', scope.dateRange],
    ['Generated', scope.generatedDate],
    ['Total leads', String(leads.length)],
  ];
  for (const [k, v] of meta) {
    const r = cover.addRow([k, v]);
    r.getCell(1).font = { name: 'Arial', bold: true, color: { argb: INK } };
  }
  const section = (heading: string, rows: [string, number][]) => {
    cover.addRow([]);
    const h = cover.addRow([heading]);
    h.font = { name: 'Arial', bold: true, color: { argb: ACCENT } };
    for (const [k, v] of rows) cover.addRow([k, v]);
  };
  section('Breakdown by development category', countBy(leads, (l) => l.development_category ?? 'Other'));
  // The second breakdown mirrors the sheet's section grouping: signal type for
  // opportunity/intelligence, source type for government.
  if (streamKey === 'government') {
    section('Breakdown by source type', countBy(leads, (l) => l.source_type ?? 'Unclassified'));
  } else {
    section('Breakdown by signal type', countBy(leads, (l) => l.signal_type ?? 'Unclassified'));
  }

  // ---- Leads sheet ----
  const ws = wb.addWorksheet('Leads', { views: [{ state: 'frozen', ySplit: 1 }] });
  cols.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
  });
  const header = ws.addRow(cols.map((c) => c.header));
  header.height = 20;
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT } };
    cell.font = { name: 'Arial', bold: true, color: { argb: HEADER_TEXT } };
    cell.alignment = { vertical: 'middle' };
    cell.border = { bottom: { style: 'thin', color: { argb: ACCENT } } };
  });

  let alt = false;
  for (const g of groupRows(leads, streamKey)) {
    // Section header row per group, merged across the sheet.
    const sec = ws.addRow([`${g.label.toUpperCase()}  (${g.items.length})`]);
    ws.mergeCells(sec.number, 1, sec.number, ncols);
    const sc = sec.getCell(1);
    sc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECTION_FILL } };
    sc.font = { name: 'Arial', bold: true, color: { argb: INK } };
    sc.border = { top: { style: 'thin', color: { argb: INK } } };

    for (const lead of g.items) {
      const row = ws.addRow(cols.map((c) => c.get(lead)));
      row.alignment = { vertical: 'top', wrapText: false };
      cols.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        cell.font = { name: 'Arial', size: 10, color: { argb: INK } };
        cell.border = { bottom: { style: 'hair', color: { argb: HAIRLINE } } };
        if (alt) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ALT_FILL } };
        if (c.link) {
          const url = c.link(lead);
          const text = c.get(lead);
          if (url) {
            cell.value = { text: text || url, hyperlink: url };
            cell.font = { name: 'Arial', size: 10, color: { argb: ACCENT }, underline: true };
          }
        }
        if (c.get(lead) === DATE_UNKNOWN) {
          cell.font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF8A8A8A' } };
        }
      });
      alt = !alt;
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function gliXlsxFilename(streamKey: string, category: string, isoDate: string): string {
  const cat = category && category !== 'all' ? slug(category) : 'all';
  return `gli_${slug(streamKey)}_${cat}_${isoDate}.xlsx`;
}
