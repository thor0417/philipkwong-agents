-- 045: the two clients become weekly, and become due.
--
-- BLOCKING. Standing rule 5: printed for Philip to run, never run from code.
-- This one is DML rather than DDL and it is handled the same way, because it
-- changes what the system will mail to a paying client and that is not a thing
-- any script here gets to decide on its own.
--
-- WHY THIS EXISTS. Brief S item 5. Measured 2026-08-27, both client rows in
-- full:
--
--   JKR & Associates     status=active   cadence=monthly   next_delivery=null
--   Simtec Attractions   status=active   cadence=monthly   next_delivery=null
--
-- Migration 025 line 39 said "CADENCE AND NEXT_DELIVERY are what a scheduled
-- agent will later read". That agent is the weekly cadence, and it reads:
--
--   due  =  status = 'active'  AND  next_delivery <= today
--
-- Against the values above that query returns nothing, forever. Not because the
-- rule is wrong but because a null next_delivery is never due and a monthly
-- cadence is correct to skip three Mondays in four. So a weekly run against
-- today's rows would ship, exit green, and mail nobody, which is the worst of
-- the available outcomes: a cadence that looks alive and delivers nothing.
--
-- A NULL NEXT_DELIVERY MEANS NEVER DUE, AND THAT IS DELIBERATE. The other
-- reading, null means always due, turns one missing value into every client
-- being mailed every week. Null stays "not scheduled" and this migration is how
-- a client becomes scheduled: explicitly, by name, one row at a time.
--
-- 2026-08-31 IS THE FIRST MONDAY AFTER THIS WAS WRITTEN. 2026-08-27 is a
-- Thursday. The weekly workflow runs 01:00 UTC Monday, which is 08:00 Bangkok,
-- so next_delivery on the 31st is due on the first run rather than one week
-- after it. On generation the cadence advances the date by seven days; this
-- migration only sets the starting point.
--
-- SAFE TO RUN TWICE. Both statements set absolute values rather than advancing
-- anything, so a second run is a no-op rather than a client jumping a week.
-- Matched by exact name because `clients` has had duplicate rows before, which
-- is what agents/scraper/migrations/dedupe-clients.ts exists for: a name match
-- that hits two rows is a signal to stop and look, and the read-back at the
-- bottom is how you see it.

update public.clients
   set cadence = 'weekly',
       next_delivery = date '2026-08-31'
 where name = 'JKR & Associates'
   and status = 'active';

update public.clients
   set cadence = 'weekly',
       next_delivery = date '2026-08-31'
 where name = 'Simtec Attractions'
   and status = 'active';

-- READ IT BACK. Standing rule 11: a thing is done when it has been read back,
-- not when it has been described. Expect exactly two rows, both weekly, both
-- 2026-08-31. Three or more rows means the duplicate-client problem is back and
-- the cadence must not be switched on until it is resolved.

select name,
       organisation,
       status,
       cadence,
       next_delivery,
       brand_name,
       addressee
  from public.clients
 where name in ('JKR & Associates', 'Simtec Attractions')
 order by name;

-- AND THE QUERY THE CADENCE ITSELF WILL RUN, so you can see what Monday sends
-- before Monday. Expect the same two rows on or after 2026-08-31, and zero rows
-- before it.

select name, cadence, next_delivery
  from public.clients
 where status = 'active'
   and next_delivery is not null
   and next_delivery <= current_date
 order by name;
