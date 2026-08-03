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
