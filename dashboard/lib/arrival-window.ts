// WHEN A PROJECT COUNTS AS NEW. The window, and nothing else.
//
// SPLIT OUT SO A CHECK CAN READ IT WITHOUT READING THE DATABASE. This lived in
// lib/projects, which imports lib/supabase, which throws at module load without
// NEXT_PUBLIC_SUPABASE_URL - so the audit that verifies the window could not
// import the window it verifies. The alternative was a second copy of the number
// inside the test, which is the thing that drifts: a window changed in one place
// and asserted in another is a test that passes against a rule nobody runs.
//
// Same reason sources/legistar-jurisdictions was split from sources/legistar.
//
// THIS FILE MUST IMPORT NOTHING.

// NEW IS A TIME WINDOW, NOT A STATE.
//
// It read `status = 'new'` and returned 235 of 235, because nothing has ever
// been triaged through that column: New and All were two views over one
// predicate, and the one that promised to show what arrived showed everything.
//
// SEVEN DAYS, matching the weekly cadence the product is built around, so New
// answers "what arrived since the last report". A project ages out on its own
// and nothing has to be clicked, which is the other half of the fix: a view that
// empties only when somebody triages is a view that never empties.
//
// STATUS IS UNTOUCHED. It is triage and a dismissal tombstone, and the fact that
// it currently means nothing is a separate question from this one.
export const NEW_WINDOW_DAYS = 7;

/**
 * The window's lower bound, as the ISO instant the query filters on.
 *
 * IT READS created_at, WHICH IS NOT first_seen. created_at is the row's insert
 * time; first_seen is written once as the OLDEST CAPTURE DATE AMONG THE
 * PROJECT'S RECORDS, so it answers "how old is the oldest thing behind this"
 * rather than "when did this show up". Measured 2026-08-21: they disagree on 135
 * of 235 register rows, widest gap 27 days. 2565 Park Plaza museum was created
 * 2026-08-19 carrying first_seen 2026-07-23, so a seven-day window on first_seen
 * would have hidden it on the day it arrived.
 *
 * And neither is published_date. A 2024 filing captured yesterday is new to us
 * and old to the world; this view is about us.
 *
 * FLOORED TO THE DAY, AND THAT IS NOT COSMETIC. Every query on the register is
 * keyed on the CONTENTS of its query object, so a boundary computed from
 * Date.now() would differ on every render, change the key, and refetch forever.
 * A day-floored boundary is stable for as long as the tab is open, which is also
 * the honest granularity for a view answering "what arrived since the last
 * report" on a weekly cadence.
 */
export function newWindowSince(now: Date = new Date()): string {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(midnight - NEW_WINDOW_DAYS * 86_400_000).toISOString();
}
