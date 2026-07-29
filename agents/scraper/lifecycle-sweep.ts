// LIFECYCLE SWEEP. Re-evaluate stored leads against the passage of time.
//
// WHY THIS EXISTS. lifecycle was written once, at capture, and never revisited:
// opportunity.ts sets `lifecycle: closed ? 'expired' : 'active'` from the
// deadline as it stood the day the row was scraped. A tender captured while open
// therefore stays 'active' for ever, including after it closes.
//
// The dashboard has an Active / Archive split driven entirely by this column, so
// the consequence was visible: three tenders whose deadlines had passed - Crew
// accommodation in Toronto (2026-07-20), the World Bank modernization
// consultancy (2026-07-21), and Senior Credit Officer (2026-07-23) - were still
// sitting in the Active view on 2026-07-29, indistinguishable from the three
// that are genuinely open. All 808 GLI rows read 'active' and the Archive view
// was empty.
//
// The re-evaluation logic already existed, in migrations/retag-dead-expired.ts.
// It had simply never been wired to anything: a one-off script someone has to
// remember to run, for a condition that arrives on its own schedule. That is the
// failure mode, not the arithmetic. It now runs on every orchestrator pass, so a
// deadline passing is noticed within a day instead of never.
//
// THIS WRITES LIFECYCLE, NEVER STATUS. status is Philip's triage column
// (new / watchlist / client_ready / dismissed) and no scrape path may touch it.
// lifecycle is the scraper's factual axis (active / expired / dead). A row
// already classified on that axis is never churned. Nothing is deleted and
// nothing leaves the corpus; an expired row moves from the Active view to the
// Archive view, both of which are views.

import { supabaseAdmin } from '../../lib/supabase-admin';
import { selectAllPaged } from './page-select';
import { isDeadNotice } from './classify';
import type { NormalizedLead } from './sources/types';

interface Row {
  id: string;
  lifecycle: string | null;
  deadline: string | null;
  title: string | null;
  raw_content: string | null;
  source: string | null;
}

export interface LifecycleSweepResult {
  scanned: number;
  expired: number;
  dead: number;
  alreadyClassified: number;
  failed: number;
  complete: boolean;
  // Every row the sweep moved, so the run log can show WHICH ones and not just
  // how many. A silent count is what let this sit unnoticed in the first place.
  moved: { id: string; title: string; from: string; to: string; deadline: string | null }[];
}

const EMPTY: LifecycleSweepResult = {
  scanned: 0, expired: 0, dead: 0, alreadyClassified: 0, failed: 0, complete: false, moved: [],
};

export async function sweepLifecycle(
  now: number = Date.now(),
  opts: { dry?: boolean } = {}
): Promise<LifecycleSweepResult> {
  const { rows, complete } = await selectAllPaged<Row>(
    'leads',
    'id, lifecycle, deadline, title, raw_content, source',
    (q: unknown) => q,
    'lifecycle-sweep'
  );
  // A partial read would classify an arbitrary first slice and report success,
  // which is the exact class of quiet wrongness this sweep exists to remove.
  if (!complete) {
    console.error('Lifecycle sweep: read was partial; skipping rather than sweeping a slice of the table.');
    return { ...EMPTY, scanned: rows.length };
  }

  const out: LifecycleSweepResult = { ...EMPTY, scanned: rows.length, complete: true, moved: [] };

  for (const r of rows) {
    // Never churn a row already classified on the lifecycle axis.
    if (r.lifecycle && r.lifecycle !== 'active') {
      out.alreadyClassified++;
      continue;
    }
    const isDead = isDeadNotice({
      title: r.title ?? '',
      raw_content: r.raw_content ?? '',
      source: r.source ?? '',
    } as NormalizedLead);
    // Only a row carrying a real deadline can expire. A project event has none,
    // so it can never fall out of the Active view on this branch.
    const isExpired = !!r.deadline && new Date(r.deadline).getTime() < now;
    const next = isDead ? 'dead' : isExpired ? 'expired' : null;
    if (!next || r.lifecycle === next) continue;

    out.moved.push({
      id: r.id,
      title: (r.title ?? '').replace(/\s+/g, ' ').slice(0, 70),
      from: r.lifecycle ?? '(null)',
      to: next,
      deadline: r.deadline,
    });

    if (!opts.dry) {
      const { error } = await supabaseAdmin.from('leads').update({ lifecycle: next }).eq('id', r.id);
      if (error) {
        console.error(`Lifecycle sweep: update failed for ${r.id}: ${error.message}`);
        out.failed++;
        out.moved.pop();
        continue;
      }
    }
    if (next === 'dead') out.dead++;
    else out.expired++;
  }
  return out;
}

export function printLifecycleSweep(r: LifecycleSweepResult): void {
  if (!r.complete) {
    console.log('Lifecycle sweep: SKIPPED (partial read).');
    return;
  }
  console.log(
    `Lifecycle sweep: ${r.scanned} rows scanned, ${r.expired} newly expired, ${r.dead} newly dead, ` +
      `${r.alreadyClassified} already classified${r.failed ? `, ${r.failed} failed` : ''}.`
  );
  for (const m of r.moved) {
    console.log(`   ${m.from} -> ${m.to}   deadline=${(m.deadline ?? '-').slice(0, 10)}   "${m.title}"`);
  }
}
