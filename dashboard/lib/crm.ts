// Presentation helpers for the CRM (deals / contacts / activities).
// Deals carry their own fields, but score/source/title fall back to the linked
// lead when the deal does not set them. See DealWithRelations in types.ts.

import { STAGES } from './types';
import type { DealWithRelations } from './types';

const STAGE_LABELS: Record<string, string> = Object.fromEntries(
  STAGES.map((s) => [s.value, s.label])
);

// "Active" = still in play. Won/lost deals drop out of pipeline value.
export const ACTIVE_STAGES: string[] = STAGES.map((s) => s.value).filter(
  (v) => v !== 'won' && v !== 'lost'
);

export function stageLabel(stage: string | null): string {
  if (!stage) return '—';
  return STAGE_LABELS[stage] ?? stage;
}

// Score lives on the originating lead, not the deal.
export function dealScore(deal: DealWithRelations): number | null {
  return deal.leads?.score ?? null;
}

export function dealSource(deal: DealWithRelations): string | null {
  return deal.source ?? deal.leads?.source ?? null;
}

export function dealCompany(deal: DealWithRelations): string {
  return deal.contacts?.company || deal.contacts?.name || '—';
}

const SOURCE_LABELS: Record<string, string> = {
  canadabuys: 'CanadaBuys',
  adzuna: 'Adzuna BC',
  formspree: 'Contact Form',
  gmail: 'Inbound Email',
  pharmacy_campaign: 'Pharmacy Campaign',
};

export function sourceLabel(source: string | null): string {
  if (!source) return '—';
  return SOURCE_LABELS[source] ?? source;
}

export type ScoreTier = 'hot' | 'warm' | 'cold';

export function scoreTier(score: number): ScoreTier {
  if (score >= 80) return 'hot';
  if (score >= 60) return 'warm';
  return 'cold';
}

// CAD, no decimals. Returns '—' when no estimate is set.
export function formatCurrency(value: number | null): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(value);
}

// Deterministic YYYY-MM-DD (avoids server/client hydration drift).
export function formatDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '—';
}

// Whole days between an ISO timestamp and now. Used for "days in stage".
export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000));
}

// A next-action date is overdue if it is strictly before today.
export function isOverdue(iso: string | null): boolean {
  if (!iso) return false;
  const due = new Date(iso).getTime();
  if (Number.isNaN(due)) return false;
  return due < Date.now();
}
