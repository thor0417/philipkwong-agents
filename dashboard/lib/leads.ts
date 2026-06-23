// Presentation helpers for leads. The scraper packs structured fields
// (contracting entity / company / closing date) into the raw_content header
// block — there are no dedicated columns for them — so the dashboard parses
// them back out here. See agents/lead-scraper/{canadabuys,adzuna}.ts for the
// exact shape written.

import type { Lead } from './types';

// Human labels for the raw source slugs stored on each lead.
const SOURCE_LABELS: Record<string, string> = {
  canadabuys: 'CanadaBuys Federal Tender',
  adzuna: 'Adzuna BC',
};

export function sourceLabel(source: string | null): string {
  if (!source) return '—';
  return SOURCE_LABELS[source] ?? source;
}

// raw_content begins with a "Key: value" header block, one per line, ending at
// the first blank line (the free-text description follows). Parse only that
// block so description prose can't clobber a real field.
function parseHeader(raw: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const line of raw.split('\n')) {
    if (line.trim() === '') break;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key && value) out[key] = value;
  }
  return out;
}

// Contracting entity (tenders) or company (job postings).
export function leadOrg(lead: Lead): string {
  const header = parseHeader(lead.raw_content);
  return header['contracting entity'] || header['company'] || '—';
}

// Closing date — tenders only; job postings have none. Normalize whatever
// date-ish token appears to YYYY-MM-DD, else show the raw value.
export function leadClosing(lead: Lead): string {
  const header = parseHeader(lead.raw_content);
  const value = header['closes'];
  if (!value) return '—';
  const m = value.match(/(\d{4})[-/](\d{2})[-/](\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : value;
}

// Deterministic YYYY-MM-DD (avoids server/client hydration drift).
export function formatDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '—';
}

export type ScoreTier = 'hot' | 'warm' | 'cold';

export function scoreTier(score: number): ScoreTier {
  if (score >= 80) return 'hot';
  if (score >= 60) return 'warm';
  return 'cold';
}

// Lead lifecycle. Values are what we persist to leads.status; labels are shown.
export const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'reviewing', label: 'Reviewing' },
  { value: 'outreach_sent', label: 'Outreach Sent' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
];

const STATUS_VALUES = new Set(STATUS_OPTIONS.map((o) => o.value));

// Map a stored status onto a known option, defaulting unknown/null to 'new'.
export function normalizeStatus(status: string | null): string {
  return status && STATUS_VALUES.has(status) ? status : 'new';
}
