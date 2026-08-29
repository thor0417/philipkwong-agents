-- 049: the fourth column. leads.industry stops saying 'gli'.
--
-- BLOCKING. Standing rule 5: migrations are printed for Philip to run, never run
-- from code.
--
-- ***** DEPENDS ON 048. RUN IT AFTER, NEVER BEFORE. *****
--
-- The statements below match on `module`, and until 048 has run every one of
-- these rows still carries module 'gli'. Run this first and both statements
-- match nothing, report 0, and look like a clean no-op over a column that is
-- still wrong.
--
-- ---- WHY THIS IS A DEFECT AND NOT A TIDY-UP -------------------------------
--
-- leads.industry has TWO writers for the live pipeline, and they agreed only by
-- coincidence:
--
--   gli.ts:844          industry: GLI_MODULE           derived from the key
--   government.ts:256   industry: GOVERNMENT_MODULE    derived from the key
--   opportunity.ts:153  industry: OPPORTUNITY_MODULE   derived from the key
--   orchestrator.ts:584 industry: p.profile.name       profiles.ts, LITERAL 'gli'
--   orchestrator.ts:763 industry: profile.name         same
--
-- Four writers for one identity, three deriving and one typing it. That is the
-- same shape as dashboard/lib/pipelines.ts hardcoding 'gli' while the agent side
-- derived it, one column over.
--
-- IT WAS LATENT UNTIL STEP 4 ARMED IT. While the key was 'gli' both sides
-- produced 'gli' and nothing showed. The moment LIVE_PIPELINE_STORAGE_KEY became
-- 'hospitality', the three lane writers would have started emitting
-- 'hospitality' and the orchestrator would have gone on emitting 'gli', down a
-- column nothing reconciles.
--
-- MEASURED IN THE WINDOW, before any run: 1,904 rows carry industry 'gli' and
-- ZERO carry 'hospitality'. Nothing ran between the flip and the fix, so no row
-- is contaminated and this migration has one clean job rather than two.
--
-- THE WRITER IS ALREADY FIXED, in the commit that prints this: profiles.ts
-- derives the name from the shared key, and verify:pipelines now FAILS THE GATE
-- if a profile writing to the live pipeline names an industry different from its
-- module. Without that, the next run would write 'gli' straight back and this
-- migration would have to be run again forever.
--
-- ---- THE 1,904 IS NOT 1,902, AND THE TWO EXTRA ARE A SEPARATE DEFECT ------
--
-- leads.module holds 'gli' on 1,902 rows. leads.industry holds it on 1,904. The
-- two extra are NOT a writer disagreement. Traced 2026-08-29:
--
--   module='compliance', industry='gli', source 'clark-tab', stream
--   'government', lead_type 'record', first seen 2026-08-11, both titled
--   "3. UC-25-0762-SKY HI, LLC: USE PERMIT for cannabis esta..."
--
-- migrations/park-compliance-and-dismiss.ts:144 parked them by writing
-- `{ module: 'compliance', project_id: null, cluster_reason: null }` and never
-- touched `industry`. A migration that moved one half of a two-column identity
-- and left the other, which is this same family again.
--
-- So they must NOT be swept into 'hospitality' by a blanket
-- `where industry = 'gli'`: that would give a compliance record a hospitality
-- industry and make it worse than it is now. They get their own statement,
-- setting industry to the module they actually carry.

begin;

-- ---- BEFORE ---------------------------------------------------------------

select module, industry, count(*)
  from public.leads
 where industry = 'gli' or module = 'hospitality'
 group by module, industry
 order by count(*) desc;
-- EXPECT, after 048 and before this file:
--   module 'hospitality', industry 'gli'  -> 1902
--   module 'compliance',  industry 'gli'  ->    2

-- ---- 1. THE LIVE PIPELINE'S OWN ROWS --------------------------------------
--
-- Scoped on module, not on industry alone, so it can only touch rows that are
-- actually hospitality.

update public.leads
   set industry = 'hospitality'
 where industry = 'gli'
   and module = 'hospitality';   -- expect 1902

-- ---- 2. THE TWO THE PARK MIGRATION LEFT BEHIND ----------------------------
--
-- Their module says compliance and their industry says gli. Neither value is
-- 'hospitality' and neither should become it. This makes industry agree with
-- the module the row already carries.
--
-- If you would rather leave them and look at them by hand, skip this statement:
-- statement 1 does not touch them either way, and they will show up in the
-- read-back below as the only remaining industry 'gli'.

update public.leads
   set industry = 'compliance'
 where industry = 'gli'
   and module = 'compliance';    -- expect 2

-- ---- READ IT BACK BEFORE COMMITTING. Standing rule 11. --------------------
--
-- EXPECT: no row anywhere carries industry 'gli'. 1902 carry 'hospitality'.
-- The consulting-era industries must be UNCHANGED: fuel_tenders 281,
-- feasibility 119, general_consulting 29, healthcare_pharma 26, null 23,
-- financial_services 16, technology_ai 8, signals 2, ethanol_gulf 1,
-- food_beverage_hospitality 1. If any of those moved, roll back.

select industry, count(*) from public.leads group by industry order by count(*) desc;

-- AND THE INVARIANT THE GATE NOW ENFORCES IN CODE, checked in the data: no row
-- of the live pipeline may carry an industry that is not its module.
-- EXPECT zero rows.

select module, industry, count(*)
  from public.leads
 where module = 'hospitality'
   and industry is distinct from 'hospitality'
 group by module, industry;

commit;

-- ---- THE INVERSE, if the read-back is wrong -------------------------------
--
-- begin;
-- update public.leads set industry = 'gli' where industry = 'hospitality' and module = 'hospitality';
-- update public.leads set industry = 'gli' where industry = 'compliance'  and module = 'compliance'
--   and source = 'clark-tab' and title like '3. UC-25-0762-SKY HI, LLC%';
-- commit;
--
-- The second inverse is narrowed on purpose: 'compliance' industry rows that
-- were never 'gli' must not be dragged back with them.
