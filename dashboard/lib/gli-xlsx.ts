// Branded XLSX export for the GLI page (replaces the plain CSV). A cover/summary
// sheet with Philip Kwong / GLI branding and breakdowns, and a styled data sheet:
// burnt-orange header band, bold white frozen header, section rows per signal
// type, alternating shading, auto-fit widths, and clickable URL hyperlinks.
// Exports exactly the currently visible, filtered rows (Active/Archive respected).
// Uses the locked canonical venue_type values as stored on each lead.

import ExcelJS from 'exceljs';
import type { GLILead } from './types';
import { GLI_SIGNAL_ORDER } from './types';

const ACCENT = 'FFB34700';
const HEADER_TEXT = 'FFFFFFFF';
const INK = 'FF0A0A0A';
const SECTION_FILL = 'FFF0EFEC';
const ALT_FILL = 'FFFAFAF9';
const HAIRLINE = 'FFD7D3CD';

export interface XlsxScope {
  streamLabel: string;
  view: string; // Active | Archive
  category: string; // 'all' or a category
  market: string; // location filter or 'Global'
  dateRange: string;
  generatedDate: string;
  focusLabel?: string;
}

function host(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
function leadDate(l: GLILead): string {
  const iso = l.stream === 'opportunity' ? l.deadline : l.published_date;
  return iso ? iso.slice(0, 10) : '';
}

interface Col {
  header: string;
  get: (l: GLILead) => string;
  hyperlink?: boolean;
  width: number;
}

const BASE_COLS: Col[] = [
  { header: 'Category', get: (l) => l.development_category ?? 'Other', width: 20 },
  { header: 'Venue Type', get: (l) => l.venue_type ?? '', width: 22 },
  { header: 'Signal Type', get: (l) => l.signal_type ?? '', width: 20 },
  { header: 'Title', get: (l) => l.title ?? '', width: 60 },
  { header: 'Location', get: (l) => l.location ?? '', width: 24 },
  { header: 'Date', get: leadDate, width: 12 },
  { header: 'Source', get: (l) => host(l.url), width: 22 },
  { header: 'URL', get: (l) => l.url ?? '', hyperlink: true, width: 44 },
];
const OPTIONAL_COLS: Col[] = [
  { header: 'Doc Type', get: (l) => l.source_type ?? '', width: 20 },
  { header: 'Presented By', get: (l) => l.presented_by ?? '', width: 22 },
  { header: 'Applicant', get: (l) => l.applicant ?? '', width: 22 },
  { header: 'Representative', get: (l) => l.representative ?? '', width: 22 },
  { header: 'Action Sought', get: (l) => l.action_sought ?? '', width: 40 },
  { header: 'Primary Document', get: (l) => l.primary_document_url ?? '', hyperlink: true, width: 44 },
  { header: 'Contact Name', get: (l) => l.contact_name ?? '', width: 22 },
  { header: 'Contact Email', get: (l) => l.contact_email ?? '', width: 28 },
  { header: 'Contact Phone', get: (l) => l.contact_phone ?? '', width: 18 },
];

function countBy(rows: GLILead[], key: (l: GLILead) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r) || 'Unclassified';
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function groupBySignal(rows: GLILead[]): { label: string; items: GLILead[] }[] {
  const rank = (s: string) => {
    const i = (GLI_SIGNAL_ORDER as readonly string[]).indexOf(s);
    return i < 0 ? GLI_SIGNAL_ORDER.length : i;
  };
  const m = new Map<string, GLILead[]>();
  for (const l of rows) {
    const k = l.signal_type || 'Unclassified';
    const b = m.get(k);
    if (b) b.push(l);
    else m.set(k, [l]);
  }
  return [...m.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([label, items]) => ({ label, items }));
}

export async function buildGliWorkbook(leads: GLILead[], scope: XlsxScope): Promise<Blob> {
  // Drop optional columns that are entirely empty in this export.
  const cols = [
    ...BASE_COLS,
    ...OPTIONAL_COLS.filter((c) => leads.some((l) => c.get(l).trim() !== '')),
  ];
  const ncols = cols.length;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Philip Kwong / GLI';

  // ---- Cover / summary sheet ----
  const cover = wb.addWorksheet('Summary');
  cover.getColumn(1).width = 26;
  cover.getColumn(2).width = 60;
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
  section('Breakdown by category', countBy(leads, (l) => l.development_category ?? 'Other'));
  section('Breakdown by signal type', countBy(leads, (l) => l.signal_type ?? 'Unclassified'));
  section('Breakdown by venue type', countBy(leads, (l) => l.venue_type ?? 'Unclassified'));

  // ---- Data sheet ----
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
  for (const g of groupBySignal(leads)) {
    // Section header row per signal type, merged across the sheet.
    const sec = ws.addRow([`${g.label.toUpperCase()}  (${g.items.length})`]);
    ws.mergeCells(sec.number, 1, sec.number, ncols);
    const sc = sec.getCell(1);
    sc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECTION_FILL } };
    sc.font = { name: 'Arial', bold: true, color: { argb: INK } };
    sc.border = { top: { style: 'thin', color: { argb: INK } } };

    for (const lead of g.items) {
      const row = ws.addRow(cols.map((c) => (c.hyperlink ? '' : c.get(lead))));
      row.alignment = { vertical: 'top', wrapText: false };
      cols.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        cell.font = { name: 'Arial', size: 10, color: { argb: INK } };
        cell.border = { bottom: { style: 'hair', color: { argb: HAIRLINE } } };
        if (alt) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ALT_FILL } };
        if (c.hyperlink) {
          const url = c.get(lead);
          if (url) {
            cell.value = { text: url, hyperlink: url };
            cell.font = { name: 'Arial', size: 10, color: { argb: ACCENT }, underline: true };
          }
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
