-- 029: project_created events carry the date the project was created.
--
-- WHY. The event backfill dated project_created at the project's first_seen,
-- which is the OLDEST capture date among that project's records. So a project
-- created on 9 August out of filings first captured in July emitted a
-- "project_created" event dated 23 July, and did not appear under the register's
-- Moved axis for the month it was created in.
--
-- THIS IS NOT REWRITING HISTORY, IT IS UNDOING AN INVENTED VALUE. first_seen was
-- never a record of when the project was created; the backfill chose it because
-- it was the best date available at the time and said so. The projects row has
-- carried a real created_at all along, so this restores a known-true value.
--
-- MEASURED BEFORE RUNNING, on the corpus of 2026-08-11:
--
--   project_created events                    272
--   rows this changes                         272
--   projects with a null created_at            0   (none are skipped)
--   projects under Moved / August, before     151
--   projects under Moved / August, after      165
--
-- and the three named cases move from absent to present:
--
--   Top Gun Las Vegas        created 2026-08-09, event dated 2026-07-27
--   Resorts World Aqueduct   created 2026-08-09, event dated 2026-07-23
--   Sphere Abu Dhabi         created 2026-08-03, event dated 2026-07-23
--
-- IDEMPOTENT. The WHERE clause means a second run updates nothing. Run in the
-- Supabase SQL editor. No DDL is ever run from code, and this is not DDL, but it
-- is a bulk mutation of 272 rows and is yours to run rather than the agent's.
--
-- REVERSIBLE, in the sense that matters: nothing is deleted and no row is added.
-- The pre-change value is recoverable for any row from projects.first_seen,
-- which is what produced it.
--
-- NOT CHANGED HERE, deliberately: record_attached stays dated at the record's
-- own date, and party_identified at the record that names the party. Those are
-- statements about when a thing happened in the world, which is what the Moved
-- axis means, and they are already true.

begin;

-- What will change, before it changes. Read this first.
select
  count(*) filter (where e.occurred_at is distinct from p.created_at) as rows_to_change,
  count(*)                                                            as project_created_rows,
  count(*) filter (where p.created_at is null)                        as skipped_null_created_at
from project_events e
join projects p on p.id = e.project_id
where e.event_type = 'project_created';

update project_events e
set
  occurred_at = p.created_at,
  detail = coalesce(e.detail, '{}'::jsonb)
           || jsonb_build_object(
                'occurred_at_corrected_from', e.occurred_at,
                'occurred_at_corrected_reason',
                'backfilled to projects.first_seen; restored to projects.created_at (migration 029)'
              )
from projects p
where p.id = e.project_id
  and e.event_type = 'project_created'
  and p.created_at is not null
  and e.occurred_at is distinct from p.created_at;

-- And after. rows_to_change must now be 0.
select
  count(*) filter (where e.occurred_at is distinct from p.created_at) as rows_still_wrong,
  count(*)                                                            as project_created_rows
from project_events e
join projects p on p.id = e.project_id
where e.event_type = 'project_created';

commit;
