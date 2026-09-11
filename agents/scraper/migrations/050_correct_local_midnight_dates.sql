-- =====================================================================
--  050. THE DATES THAT ARE THIS MACHINE'S MIDNIGHT, NOT THE PUBLISHER'S.
--
--  PRINTED FOR PHILIP TO RUN. BLOCKING. Standing rule 5: no DDL or bulk
--  correction runs from code. Run it in the Supabase SQL editor, read the
--  verification block at the end, and only then commit.
--
--  WHAT HAPPENED. Every adapter that read a source date through `new Date(s)`
--  parsed a ZONELESS value in the runtime's local zone. On this machine, UTC+7,
--  "December 15, 2025" became 2025-12-14T17:00:00Z. The date part is what a
--  client document prints, what bestDate sorts on, and what a period bound is
--  compared against, so the whole corpus captured here reads a day early.
--  The writers were fixed on 2026-09-11 (agents/scraper/sources/source-date.ts,
--  golden case `a-meeting-date-that-is-the-machines-midnight`). THIS FILE IS THE
--  OTHER HALF: the rows already stored.
--
--  MEASURED 2026-09-11 by agents/scraper/diagnostics/date-shift-cost.ts, paged
--  to exhaustion, no cap:
--
--    leads.published_date at 17:00:00Z            1,204   (821 undismissed)
--    project_events.occurred_at at 17:00:00Z      1,021
--      of those, whose lead is one of the 1,204     768
--      of those, carrying no lead_id                250
--      of those, whose lead is NOT shifted            3   <- NOT TOUCHED, see below
--    projects.last_activity at 17:00:00Z            319
--    leads.deadline to move                           0   <- see the TED note
--
--  THE SOURCE LIST IS NOT DECORATION. A clock test alone would have corrupted a
--  real deadline: the one `leads.deadline` value at 17:00:00Z belongs to a TED
--  notice - "Spain, Natural gas" - and TED publishes an explicit +00:00 offset,
--  so five in the afternoon UTC is what the publisher actually said. It is
--  excluded by source and stays exactly as it is. Every source named below
--  publishes a DATE, or a naive datetime, and none of them can mean 17:00 UTC.
--
--  THE THREE EVENTS THIS DOES NOT TOUCH are record_attached rows dated
--  2026-12-31T17:00:00Z whose lead is published 2026-01-01. Their date does not
--  come from their lead and nothing here can say where it does come from, so
--  they are left alone and reported rather than swept along. They are also
--  FUTURE-DATED, which is a separate question for whoever picks it up.
--
--  WHY BOTH TABLES MOVE IN ONE ACT. project_events dedupes on an identity that
--  includes occurred_at. Correct a lead date without correcting the event it
--  already produced and the next event pass inserts a SECOND event for the same
--  filing, one day apart, and a client document prints both.
--
--  IT IS SAFE TO RUN TWICE. Every predicate is "the clock reads 17:00:00Z", and
--  a corrected row reads 00:00:00Z. A second run matches nothing.
--
--  WHAT IT COSTS, PER MARKET, undismissed rows whose printed date moves:
--    Clark County 301 of 349      Broward County 98 of 98    Anaheim 75 of 78
--    (no market) 127 of 366       New York City 51 of 188    Phoenix 40 of 43
--    Nashville 40 of 40           Las Vegas 16 of 66         San Antonio 14 of 14
--    Oakland 14 of 14             and 35 further markets holding 1 to 6 rows each.
--  17 of those rows cross a MONTH boundary, which is the boundary a monthly
--  client document is scoped by. 232 projects change their latest-activity day.
--  NO project crosses the 12-month liveness floor: the correction only ever moves
--  a date forward, so nothing can drop out of the register on it.
-- =====================================================================

BEGIN;

-- THE SESSION'S TIMEZONE DECIDES WHAT A ZONELESS TEXT VALUE MEANS, which is the
-- same defect one layer down: `'2026-01-01'::timestamptz` is read in the SESSION
-- zone, so on a non-UTC session a date-only row would land at 17:00 and be
-- swept up by the predicate below. Pinned, and every predicate additionally
-- requires the stored text to carry an explicit Z.
SET LOCAL TIME ZONE 'UTC';

-- ---------------------------------------------------------------------
-- 1. The leads whose stored date is this machine's midnight.
--    Captured FIRST, because step 3 has to know which leads were shifted
--    after step 2 has already corrected them.
-- ---------------------------------------------------------------------
CREATE TEMP TABLE shifted_leads ON COMMIT DROP AS
SELECT id
  FROM leads
 WHERE source IN ('legistar', 'gli_serper', 'worldbank', 'agenda-portal', 'nyc-zap', 'iadb')
   AND published_date IS NOT NULL
   AND published_date LIKE '%Z'
   AND ((published_date)::timestamptz AT TIME ZONE 'UTC')::time = '17:00:00';

-- EXPECT 1204. If this is not 1204, stop and re-run the cost diagnostic before
-- going further: the corpus has moved since this file was written.
SELECT count(*) AS leads_to_correct FROM shifted_leads;

-- ---------------------------------------------------------------------
-- 2. leads.published_date. A TEXT column (migration 007), so the value is
--    rebuilt in the exact shape toISOString produces and the column has
--    always held: 2025-12-15T00:00:00.000Z
-- ---------------------------------------------------------------------
UPDATE leads
   SET published_date = to_char(
         ((published_date)::timestamptz + interval '7 hours') AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
       )
 WHERE id IN (SELECT id FROM shifted_leads);

-- ---------------------------------------------------------------------
-- 3. project_events.occurred_at, for the events that inherited the shift.
--    An event with no lead_id was dated from a project-level date, which
--    was itself derived from these leads.
-- ---------------------------------------------------------------------
UPDATE project_events
   SET occurred_at = occurred_at + interval '7 hours'
 WHERE (occurred_at AT TIME ZONE 'UTC')::time = '17:00:00'
   AND (lead_id IS NULL OR lead_id IN (SELECT id FROM shifted_leads));

-- ---------------------------------------------------------------------
-- 4. projects.last_activity, which is bestDate carried onto the project.
--    The next clustering run recomputes it anyway; correcting it here stops
--    the register from sorting differently from its own records in the
--    meantime.
-- ---------------------------------------------------------------------
UPDATE projects
   SET last_activity = last_activity + interval '7 hours'
 WHERE last_activity IS NOT NULL
   AND (last_activity AT TIME ZONE 'UTC')::time = '17:00:00';

-- ---------------------------------------------------------------------
-- 5. READ IT BACK BEFORE COMMITTING. Standing rule 11: a thing is done when
--    it has been read back, not when it has been described.
--
--    EXPECTED, all four zero:
-- ---------------------------------------------------------------------
SELECT 'leads still at local midnight' AS check, count(*) AS should_be_zero
  FROM leads
 WHERE source IN ('legistar', 'gli_serper', 'worldbank', 'agenda-portal', 'nyc-zap', 'iadb')
   AND published_date IS NOT NULL
   AND published_date LIKE '%Z'
   AND ((published_date)::timestamptz AT TIME ZONE 'UTC')::time = '17:00:00'
UNION ALL
SELECT 'events still at local midnight', count(*)
  FROM project_events
 WHERE (occurred_at AT TIME ZONE 'UTC')::time = '17:00:00'
   AND lead_id IS NULL
UNION ALL
SELECT 'projects still at local midnight', count(*)
  FROM projects
 WHERE last_activity IS NOT NULL
   AND (last_activity AT TIME ZONE 'UTC')::time = '17:00:00'
UNION ALL
SELECT 'the TED deadline, untouched (expect 1)', count(*)
  FROM leads
 WHERE deadline IS NOT NULL
   AND (deadline AT TIME ZONE 'UTC')::time = '17:00:00';

-- The three record_attached events this deliberately leaves alone. EXPECT 3.
SELECT 'events left alone (expect 3)' AS check, count(*)
  FROM project_events
 WHERE (occurred_at AT TIME ZONE 'UTC')::time = '17:00:00'
   AND lead_id IS NOT NULL;

-- One spot check a human can read. Anaheim's Planning Commission met on Monday
-- 15 December 2025 and the city publishes that agenda as 12/15/2025.
-- EXPECT every row to start 2025-12-15.
SELECT published_date, left(title, 60) AS title
  FROM leads
 WHERE market LIKE 'Anaheim%'
   AND published_date LIKE '2025-12-1%'
 ORDER BY published_date
 LIMIT 10;

COMMIT;
