-- =====================================================================
--  050. THE DATES THAT ARE THIS MACHINE'S MIDNIGHT, NOT THE PUBLISHER'S.
--
--  APPLIED 2026-09-12. It ran, it errored, and the error was not what it
--  looked like: every row it was meant to move had already moved. The counts
--  are read back in the verification block at the foot of this file and the
--  results of that read-back are recorded here. RE-RUNNING IT IS A NO-OP,
--  because every predicate is "the clock reads 17:00:00Z" and no row does.
--
--  WHAT FAILED, AND WHY IT IS REWRITTEN. The first version built a TEMP TABLE
--  `shifted_leads` and had three later statements read it. The Supabase SQL
--  editor answered
--
--      ERROR: 42P01: relation "shifted_leads" does not exist
--
--  A temp table lives in ONE SESSION and `ON COMMIT DROP` destroys it at the
--  first commit. A SQL editor over a pooled connection guarantees neither: a
--  statement can land on a different backend, and a commit between statements
--  takes the table with it. The migration was therefore relying on something
--  the place it runs does not promise. It is rewritten below with NO temp
--  table, NO transaction block and NO cross-statement state: every statement
--  stands alone and can be pasted and run on its own.
--
--  I CANNOT SAY FROM HERE WHICH STATEMENT RAISED THE ERROR, and the honest
--  version is that the data settles what matters and the mechanism is
--  inference. What the data settles: all three updates applied, once each,
--  with the right result. What it does not: whether the editor ran the failing
--  SELECT before or after them.
--
--  THE READ-BACK, 2026-09-12, agents/scraper/diagnostics/date-shift-cost.ts
--  and a direct query, both NPM_EXIT=0:
--
--    leads.published_date at 17:00:00Z     1,204 -> 0
--      and 00:00:00Z                         366 -> 1,570   (366 + 1,204, exact)
--    project_events.occurred_at at 17:00Z   1,021 -> 3       (the 3 named below)
--    projects.last_activity at 17:00:00Z      319 -> 0
--    leads.deadline at 17:00:00Z                1 -> 1       (TED, excluded on purpose)
--
--  APPLIED ONCE, NOT TWICE: a second +7h would leave rows at 07:00:00Z and
--  there are none. The arithmetic closes exactly.
--
--  AND THE SPOT CHECK A HUMAN CAN READ. Anaheim's Planning Commission meets on
--  a MONDAY and its City Council on a TUESDAY. Before the correction every
--  stored Planning Commission record fell on a Sunday and every Council record
--  on a Monday. After it:
--
--    Planning Commission   Mon 17
--    City Council          Tue 57, Mon 1, Wed 2, Fri 1   (the four are special
--                                                         meetings, not errors)
--
--  The 15 December 2025 Planning Commission agenda, which the city publishes as
--  12/15/2025, now reads 2025-12-15 in the corpus. It read 2025-12-14 before.
--
--  ---------------------------------------------------------------------
--  WHAT IT WAS FOR
--  ---------------------------------------------------------------------
--
--  Every adapter that read a source date through `new Date(s)` parsed a
--  ZONELESS value in the runtime's local zone. On the machine that captured
--  this corpus, UTC+7, "December 15, 2025" became 2025-12-14T17:00:00Z. The
--  date part is what a client document prints, what bestDate sorts on, and what
--  a period bound is compared against. The writers were fixed on 2026-09-11
--  (agents/scraper/sources/source-date.ts, golden case
--  `a-meeting-date-that-is-the-machines-midnight`); this file was the other
--  half, the rows already stored.
--
--  THE SOURCE LIST IS NOT DECORATION. The one `leads.deadline` value at
--  17:00:00Z belongs to a TED notice - "Spain, Natural gas" - and TED publishes
--  an explicit +00:00, so five in the afternoon UTC is what the publisher
--  actually said. A clock-only predicate would have corrupted a real deadline.
--  It is excluded by source and still reads 2026-07-13T17:00:00+00:00.
--
--  THE THREE EVENTS THIS DELIBERATELY LEAVES are record_attached rows dated
--  2026-12-31T17:00:00Z whose lead is published 2026-01-01. Read back after the
--  run, they are Phoenix liquor licences - Aloft Hotel Phoenix Airport, AC Hotel
--  Biltmore, and an Off-Track Pari-Mutuel Wagering Permit for Arena. Their
--  occurred_at is a YEAR after their lead's date, so it does not come from the
--  lead and nothing here can say where it does come from. Left alone and
--  reported rather than swept along.
--
--  ---------------------------------------------------------------------
--  THE ORDER MATTERS AND IT IS THE ONLY THING THAT DOES
--  ---------------------------------------------------------------------
--
--  Statement 1 identifies its events THROUGH the leads that are still at
--  17:00:00Z. Statement 3 is what moves those leads. So 1 runs before 3, and
--  running 3 first would make 1 unable to find anything - which is a silent
--  half-correction rather than an error, and is exactly why the first version
--  used a temp table. Numbered, and each statement says what it depends on.
--
--  Each statement is independently safe to re-run: all three match nothing once
--  they have run.
--
--  NO SESSION TIMEZONE IS SET, because a pooled statement cannot rely on one.
--  Every predicate casts explicitly and every leads predicate additionally
--  requires the stored text to carry a `Z`, so `'2026-01-01'::timestamptz`,
--  which a session zone WOULD change, can never be matched.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. project_events.occurred_at.
--    RUN FIRST. It finds its events through leads that are still at
--    17:00:00Z, which statement 3 is about to change.
--    Expected: 1,018 rows. Ran 2026-09-12, leaving 3 (see the header).
-- ---------------------------------------------------------------------
UPDATE project_events
   SET occurred_at = occurred_at + interval '7 hours'
 WHERE (occurred_at AT TIME ZONE 'UTC')::time = '17:00:00'
   AND (
     lead_id IS NULL
     OR lead_id IN (
       SELECT id
         FROM leads
        WHERE source IN ('legistar', 'gli_serper', 'worldbank', 'agenda-portal', 'nyc-zap', 'iadb')
          AND published_date IS NOT NULL
          AND published_date LIKE '%Z'
          AND ((published_date)::timestamptz AT TIME ZONE 'UTC')::time = '17:00:00'
     )
   );


-- ---------------------------------------------------------------------
-- 2. projects.last_activity. Depends on nothing; order is free.
--    It is bestDate carried onto the project, and the next clustering run
--    recomputes it anyway. Correcting it here stops the register from
--    sorting differently from its own records in the meantime.
--    Expected: 319 rows. Ran 2026-09-12.
-- ---------------------------------------------------------------------
UPDATE projects
   SET last_activity = last_activity + interval '7 hours'
 WHERE last_activity IS NOT NULL
   AND (last_activity AT TIME ZONE 'UTC')::time = '17:00:00';


-- ---------------------------------------------------------------------
-- 3. leads.published_date. RUN LAST, after statement 1.
--    A TEXT column (migration 007), so the value is rebuilt in the exact
--    shape toISOString produces and the column has always held:
--    2025-12-15T00:00:00.000Z
--    Expected: 1,204 rows. Ran 2026-09-12.
-- ---------------------------------------------------------------------
UPDATE leads
   SET published_date = to_char(
         ((published_date)::timestamptz + interval '7 hours') AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
       )
 WHERE source IN ('legistar', 'gli_serper', 'worldbank', 'agenda-portal', 'nyc-zap', 'iadb')
   AND published_date IS NOT NULL
   AND published_date LIKE '%Z'
   AND ((published_date)::timestamptz AT TIME ZONE 'UTC')::time = '17:00:00';


-- =====================================================================
--  THE READ-BACK. Standing rule 11: a thing is done when it has been read
--  back, not when it has been described. Run these after the three above.
--  Each stands alone.
--
--  RESULTS ON 2026-09-12, recorded here so the next reader does not have to
--  re-run them to know what happened: 0, 0, 0, 1, 3.
-- =====================================================================

-- EXPECT 0.
SELECT count(*) AS leads_still_at_local_midnight
  FROM leads
 WHERE source IN ('legistar', 'gli_serper', 'worldbank', 'agenda-portal', 'nyc-zap', 'iadb')
   AND published_date IS NOT NULL
   AND published_date LIKE '%Z'
   AND ((published_date)::timestamptz AT TIME ZONE 'UTC')::time = '17:00:00';

-- EXPECT 0.
SELECT count(*) AS project_dated_events_still_at_local_midnight
  FROM project_events
 WHERE (occurred_at AT TIME ZONE 'UTC')::time = '17:00:00'
   AND lead_id IS NULL;

-- EXPECT 0.
SELECT count(*) AS projects_still_at_local_midnight
  FROM projects
 WHERE last_activity IS NOT NULL
   AND (last_activity AT TIME ZONE 'UTC')::time = '17:00:00';

-- EXPECT 1. The TED deadline, untouched on purpose.
SELECT count(*) AS ted_deadline_untouched
  FROM leads
 WHERE deadline IS NOT NULL
   AND (deadline AT TIME ZONE 'UTC')::time = '17:00:00';

-- EXPECT 3. The record_attached events left alone on purpose.
SELECT count(*) AS events_left_alone
  FROM project_events
 WHERE (occurred_at AT TIME ZONE 'UTC')::time = '17:00:00'
   AND lead_id IS NOT NULL;

-- THE HUMAN CHECK. Anaheim's Planning Commission met on Monday 15 December
-- 2025 and the city publishes that agenda as 12/15/2025.
-- EXPECT the ITEM NO. rows to read 2025-12-15. They do.
SELECT published_date, left(title, 60) AS title
  FROM leads
 WHERE market LIKE 'Anaheim%'
   AND published_date LIKE '2025-12-1%'
 ORDER BY published_date
 LIMIT 10;
