-- 048: the pipeline has one name. module 'gli' becomes module 'hospitality'.
--
-- BLOCKING. Standing rule 5: migrations are printed for Philip to run, never run
-- from code. Nothing in this repository executes DDL or this UPDATE.
--
-- THIS IS STEP 3 OF FIVE, AND THE ORDER IS THE WHOLE SAFETY ARGUMENT.
--
--   1. DONE. One import-free lib/pipeline-id.ts read by BOTH packages.
--      dashboard/lib/pipelines.ts:32 used to declare its own hardcoded 'gli'
--      while the agent side derived it, so the two packages could disagree
--      about the name of the thing every register query is scoped to - and only
--      the dashboard deploys to Vercel. The four E2E audits that hardcoded
--      .eq('module', 'gli') go through the shared key as part of this step, not
--      later, because they are the checks that would have caught the rest.
--   2. DONE. Every READER accepts both values, through hospitalityModuleValues()
--      and isHospitalityModule(). Every WRITER still writes exactly one. After
--      step 2 the data may move at any moment, in either order, with either half
--      of the tree deployed, and neither package breaks.
--   3. THIS FILE. Yours to run.
--   4. Flip the constant so writers emit 'hospitality'.
--   5. Remove the tolerance. BLOCKED ON THIS FILE: removing it before this runs
--      would scope every reader to a value 4,256 rows do not carry, and an empty
--      register does not look like a broken deploy, it looks like a quiet week.
--
-- ---- WHAT IT TOUCHES, MEASURED 2026-08-29 ---------------------------------
--
-- Exact server-side counts, distincts paged and uncapped (npm run
-- diag:pipeline-values re-runs all of it):
--
--     leads.module           'gli'  1,902   of 2,410
--     projects.module        'gli'    424   of   424
--     project_events.module  'gli'  1,930   of 1,930
--                                  -------
--                                    4,256 rows
--
--   leads.module distinct: gli 1902, fuel 282, feasibility 119,
--     general_consulting 29, healthcare_pharma 26, null 23,
--     financial_services 16, technology_ai 8, compliance 2, signals 2,
--     food_beverage_hospitality 1
--
-- No table carries 267 module rows; if you have seen that number it was a
-- different question. Nothing outside these three tables stores the value:
-- client_scopes.pipeline_id already reads 'hospitality' on both client rows.
--
-- ---- WHY THIS IS NOT MIGRATION 024 ----------------------------------------
--
-- 024 is a DIFFERENT migration and stays quarantined. It adds a foreign-keyed
-- pipeline_id column and backfills it through a CASE that names three module
-- values and silently collapses four others - including `compliance`, which has
-- had its own pipelines row since 2026-08-12. Every compliance record would be
-- filed under legacy consulting, the foreign key would not complain because
-- `consulting` is a real row, and nothing would report it. That mapping is worth
-- re-measuring exactly once, on the day a second vertical is real. This file
-- renames a value and adds no structure, so it does not inherit that problem.
--
-- ---- REVERSIBLE, BY INVERTING IT ------------------------------------------
--
-- No other column is touched and no row is created or removed. The inverse is
-- the same three statements with the two values swapped. It is at the bottom of
-- this file, commented out.

begin;

-- ---- BEFORE. Read this first and keep it. ---------------------------------

select 'leads' as tbl, module, count(*) from public.leads          group by module
union all
select 'projects',      module, count(*) from public.projects       group by module
union all
select 'project_events', module, count(*) from public.project_events group by module
 order by 1, 3 desc;

-- ---- THE RENAME -----------------------------------------------------------
--
-- Each statement reports its own row count. Compare each against the figure in
-- the comment. A HIGHER number means a capture ran between the measurement above
-- and this run and wrote more rows under the old key, which is harmless - the
-- statement still moves exactly the rows that carry 'gli'. A LOWER number means
-- someone has already run part of this, and you should stop and read the BEFORE
-- output rather than continue.

update public.leads          set module = 'hospitality' where module = 'gli';  -- expect 1902
update public.projects       set module = 'hospitality' where module = 'gli';  -- expect  424
update public.project_events set module = 'hospitality' where module = 'gli';  -- expect 1930

-- ---- READ IT BACK BEFORE COMMITTING. Standing rule 11. --------------------
--
-- EXPECT: zero rows carrying 'gli' anywhere, and 1902 / 424 / 1930 carrying
-- 'hospitality'. The other module values must be UNCHANGED - fuel 282,
-- feasibility 119, general_consulting 29, healthcare_pharma 26, null 23,
-- financial_services 16, technology_ai 8, compliance 2, signals 2,
-- food_beverage_hospitality 1. If any of those moved, roll back: this statement
-- touched something it should not have.

select 'leads' as tbl, module, count(*) from public.leads          group by module
union all
select 'projects',      module, count(*) from public.projects       group by module
union all
select 'project_events', module, count(*) from public.project_events group by module
 order by 1, 3 desc;

-- AND THE LIVE MISMATCH, WHICH IS THE REASON THIS MATTERS. Before this runs, a
-- client scope resolves to 'hospitality' and the corpus is stored under 'gli',
-- so this join returns ZERO over a register of 424 projects. After it runs it
-- must return the projects.
--
-- EXPECT: two rows, one per client scope, each with a non-zero count.

select s.pipeline_id,
       count(p.id) as projects_the_scope_can_see
  from public.client_scopes s
  left join public.projects p
    on p.module = s.pipeline_id
   and p.status <> 'dismissed'
 group by s.pipeline_id;

commit;

-- ---- THE INVERSE, if the read-back is wrong -------------------------------
--
-- begin;
-- update public.leads          set module = 'gli' where module = 'hospitality';
-- update public.projects       set module = 'gli' where module = 'hospitality';
-- update public.project_events set module = 'gli' where module = 'hospitality';
-- commit;

-- ---- AND ONE THING THE RENAME REPORT DID NOT COUNT ------------------------
--
-- REPORTED, NOT INCLUDED ABOVE, because it is a different column and a
-- different decision. `leads.industry` also carries 'gli', on 1,904 rows -
-- measured 2026-08-29, paged and uncapped:
--
--   gli 1904, fuel_tenders 281, feasibility 119, general_consulting 29,
--   healthcare_pharma 26, null 23, financial_services 16, technology_ai 8,
--   signals 2, ethanol_gulf 1, food_beverage_hospitality 1
--
-- It is 1,904 and not 1,902 because it has TWO writers that disagree: gli.ts
-- writes `industry: GLI_MODULE`, derived from the shared key, while the
-- orchestrator writes `industry: profile.name` and profiles.ts names the lane
-- profile 'gli' as a literal. So two rows carry industry 'gli' with some other
-- module.
--
-- `industry` is a display and grouping column - it is what the run report tallies
-- as writtenPerIndustry - and nothing scopes a client document by it. Renaming
-- it is therefore cosmetic rather than load-bearing, and it is NOT in the
-- statements above because widening a migration past what was asked for is how a
-- migration acquires a defect nobody measured. If you want it, it is one more
-- statement and the profile literal in profiles.ts has to move to the shared key
-- in the same commit, or the next run writes 'gli' straight back:
--
--   update public.leads set industry = 'hospitality' where industry = 'gli';  -- 1904
