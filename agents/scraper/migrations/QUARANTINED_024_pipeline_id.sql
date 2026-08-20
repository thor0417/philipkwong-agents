-- =====================================================================
--  QUARANTINED 2026-08-19. DO NOT RUN.
--
--  Renamed from 024_pipeline_id.sql. It was never applied, and it must not
--  be applied as written. The schema-drift audit
--  (agents/scraper/diagnostics/schema-drift.ts) found it: pipeline_id exists
--  on none of the three tables, while the repo has claimed since 2026-08-03
--  that it does.
--
--  IT WOULD NOT FAIL. THAT IS THE PROBLEM. `pipelines` exists and holds
--  hospitality, fuel, consulting, signals and compliance, so the NOT NULL and
--  the foreign key below would both hold and the migration would report
--  success.
--
--  WHAT IT WOULD DO. leads.module holds SEVEN distinct values today:
--
--     compliance   feasibility   financial_services   food_beverage_hospitality
--     fuel         general_consulting                 gli
--
--  The CASE below names three of them. The other four collapse to
--  'consulting', INCLUDING compliance, which has had its own pipelines row
--  since 2026-08-12. Every compliance record would be filed under legacy
--  consulting, the foreign key would not complain because 'consulting' is a
--  real row, and nothing would report it.
--
--  A migration that fails is recoverable. One that runs and mis-files is the
--  shape this repo keeps paying for.
--
--  TO REVIVE IT: rewrite the CASE against the module values that exist at that
--  time, not the ones that existed when it was written, and re-measure first.
--  The file is kept rather than deleted because the DESIGN is still right -
--  pipeline_id foreign-keyed to pipelines - and only the mapping is stale.
-- =====================================================================

-- 024: pipeline_id, foreign-keyed to pipelines. The safe half of the module
-- migration.
--
-- TWO OPTIONS, AND WHY THIS IS THE SECOND ONE.
--
--   (a) rename module -> pipeline_id. One step, no redundancy, and it breaks
--       every query in both packages at the same instant. There is no state in
--       which old code and new data coexist, so a rollback means another
--       migration and a redeploy.
--
--   (b) ADD pipeline_id, backfill it, foreign-key it, and leave module in place
--       as deprecated. Reversible at every point: until code reads the new
--       column, dropping it changes nothing.
--
-- This is (b). module is NOT dropped here and should not be dropped for at
-- least one full release after every reader has moved.
--
-- ---- THE MAPPING IS BIGGER THAN THREE VALUES --------------------------------
--
-- Measured over the live corpus before writing this. leads.module holds TEN
-- distinct values, not the three the pipeline registry seeds:
--
--   gli                        890
--   fuel                       282
--   feasibility                100
--   general_consulting          29
--   healthcare_pharma           26
--   (null)                      23
--   financial_services          16
--   technology_ai                8
--   signals                      2
--   food_beverage_hospitality    1
--                             ----
--                             1377
--
-- A foreign key added naively would have failed on 204 rows. Six of those
-- values are consulting-era practice areas from before the hospitality pipeline
-- existed, and 23 rows carry no module at all (adzuna job postings and
-- intake-agent emails that predate the column). They map to `consulting`, which
-- is exactly what that pipeline is named.
--
-- The FK is added ONLY after the backfill, and NOT VALID is deliberately not
-- used: if a value cannot be mapped, this migration should fail loudly here
-- rather than leave the constraint unenforced and the problem undiscovered.
--
-- Idempotent. Run in the Supabase SQL editor. No DDL is ever run from code.

begin;

alter table leads          add column if not exists pipeline_id text;
alter table projects       add column if not exists pipeline_id text;
alter table project_events add column if not exists pipeline_id text;

-- Backfill. Every distinct value is listed; anything unmapped, including null,
-- goes to consulting, which is where the pre-hospitality corpus belongs.
update leads set pipeline_id = case module
    when 'gli'    then 'hospitality'
    when 'fuel'   then 'fuel'
    when 'signals' then 'signals'
    else 'consulting'
  end
  where pipeline_id is null;

update projects set pipeline_id = case module
    when 'gli'    then 'hospitality'
    when 'fuel'   then 'fuel'
    when 'signals' then 'signals'
    else 'consulting'
  end
  where pipeline_id is null;

update project_events set pipeline_id = case module
    when 'gli'    then 'hospitality'
    when 'fuel'   then 'fuel'
    when 'signals' then 'signals'
    else 'consulting'
  end
  where pipeline_id is null;

alter table leads          alter column pipeline_id set not null;
alter table projects       alter column pipeline_id set not null;
alter table project_events alter column pipeline_id set not null;

alter table leads
  drop constraint if exists leads_pipeline_id_fkey,
  add  constraint leads_pipeline_id_fkey
       foreign key (pipeline_id) references pipelines(id);

alter table projects
  drop constraint if exists projects_pipeline_id_fkey,
  add  constraint projects_pipeline_id_fkey
       foreign key (pipeline_id) references pipelines(id);

alter table project_events
  drop constraint if exists project_events_pipeline_id_fkey,
  add  constraint project_events_pipeline_id_fkey
       foreign key (pipeline_id) references pipelines(id);

-- Every scoped read filters on this column, so it is indexed the way module is.
create index if not exists idx_leads_pipeline          on leads(pipeline_id);
create index if not exists idx_projects_pipeline       on projects(pipeline_id);
create index if not exists idx_project_events_pipeline on project_events(pipeline_id, occurred_at desc);

commit;

-- AFTER THIS RUNS, one line changes in each package and nothing else:
--   agents/scraper/pipelines.ts   storageKeyFor() returns the id unchanged
--   dashboard/lib/pipelines.ts    LIVE_PIPELINE_STORAGE_KEY = 'hospitality'
-- and the scoping column name moves from `module` to `pipeline_id`. Both are
-- single constants precisely so this step is small.
