-- 039: drop idx_project_events_dedupe. BLOCKING, and the capture run is held
-- until it has been run.
--
-- WHAT IS WRONG. project_events carries TWO unique indexes. This repo declares
-- exactly one of them - idx_project_events_identity, migrations 020 and 023 -
-- and the database also enforces idx_project_events_dedupe, which appears in no
-- migration file, in no schema dump, and nowhere in the tree. It was applied by
-- hand and nothing describes what it constrains.
--
-- WHAT IT DOES. It omits occurred_at from the identity of an event, so a second
-- event of the same type on the same project with the same from, to and lead is
-- refused however long afterwards it happens. That is not a duplicate. It is
-- the same thing happening twice, which is what an audit trail is for.
--
-- Inferred rather than read, because there is no SQL RPC on this project and
-- this file is the reason the inference is being retired. Every observation is
-- consistent with it: 911 rows hold 911 distinct
-- (project_id, event_type, from_value, to_value, lead_id) keys, no coarse key
-- has ever repeated, and a repeat watch toggle minutes after the first returns
-- 23505 naming this index while watch_added and watch_removed both stored.
--
-- WHAT IT COST. Three live projects carry a stage today that their event trail
-- cannot reach, because the return transition collided with one already stored:
--
--   Heart Hotel / Kulik River   last event ends 'stalled',            now approved
--   Hudson Yards / Western Rail Yard  last event ends 'under construction', now dormant
--   Disneyland Resort           last event ends 'under construction', now approved
--
-- Those three are NOT backfilled. A reconstructed event dated from the record
-- that probably caused it is a fact we asserted, not one the system observed,
-- and this table is the audit trail. The hole is stated in GLI-ROADMAP.md by
-- name. A stated hole beats a plausible fill.
--
-- Every watch toggle after the first pair per project has also been refused
-- since 2026-08-04: 6 watch events are stored and the harness alone writes 8
-- per run.
--
-- WHY DROPPING IT IS SAFE. idx_project_events_identity is STRICTLY WEAKER: it
-- constrains the same five columns plus occurred_at, so every pair of rows the
-- dedupe index considers distinct is still distinct under it. No existing row
-- can conflict, and nothing that is stored today becomes insertable twice.
-- Idempotency is not lost - re-running a backfill derives the same occurred_at
-- for the same event and is still refused.
--
-- AFTER RUNNING, paste the output of the second statement. It is the only way
-- what this index constrained gets onto the record rather than staying an
-- inference, and it is worth having before the index is gone. Run the SELECT
-- FIRST if you want the definition captured.
--
-- Idempotent. Run in the Supabase SQL editor. No DDL is ever run from code.

-- 1. FIRST, so the definition is on the record before it is dropped.
select indexname, indexdef
from pg_indexes
where tablename = 'project_events'
order by indexname;

-- 2. Then drop it. The identity index stays and becomes the only one.
begin;

drop index if exists idx_project_events_dedupe;

-- Recreated only if absent, so a database that never had 023 applied still
-- ends this migration with the identity this repo declares.
create unique index if not exists idx_project_events_identity
  on project_events(
    project_id,
    event_type,
    occurred_at,
    coalesce(from_value, ''),
    coalesce(to_value, ''),
    coalesce(lead_id::text, '')
  );

commit;

-- 3. What it looks like afterwards. One unique index, and it is the declared one.
select indexname, indexdef
from pg_indexes
where tablename = 'project_events'
order by indexname;
