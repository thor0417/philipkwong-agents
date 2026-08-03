-- 023: correct the project_events uniqueness identity to include lead_id.
--
-- MIGRATION 020'S INDEX WAS WRONG AND THIS IS THE FIX. It identified an event by
-- (project_id, event_type, occurred_at, from_value, to_value). For every event
-- type that carries a record, that is too coarse: two DIFFERENT records
-- attaching to one project on the same date with the same cluster_reason are
-- identical under those five columns, and they are not one event - they are two
-- records joining a project.
--
-- Measured, which is how it was caught. Deriving the recoverable history over
-- the stored corpus produced 712 events and collapsed 89 of them:
--
--   364 record_attached derived, 275 distinct under the 020 index
--
-- Losing 89 of 364 attachments would have silently gutted the query that makes
-- "approved by this filing" answerable, and it would have done so quietly, since
-- a collapsed duplicate looks exactly like a correctly-deduplicated one.
--
-- lead_id is nullable and cast to text inside coalesce for the same reason
-- from_value and to_value already are: a null does not compare equal to another
-- null in a Postgres unique index, so without the coalesce every event with no
-- triggering record - project_created, stage_changed, renamed - would duplicate
-- freely, which is the opposite failure.
--
-- SAFE TO RUN AGAINST A POPULATED TABLE. The new index is strictly WEAKER than
-- the old one: everything the old index considered distinct is still distinct,
-- so no existing row can conflict. Dropping and recreating in one transaction
-- means there is no window where duplicates could be inserted.
--
-- NOT REQUIRED ON THE CURRENT LIVE DATABASE, verified by probe rather than
-- assumed. Against the applied schema, two rows sharing all five original
-- columns and differing only by lead_id are BOTH ACCEPTED, and a row identical
-- in all six is rejected with 23505 - which is exactly this migration's
-- semantics. All 712 backfilled events stored with 0 rejections. So this is a
-- no-op here.
--
-- It is kept, and migration 020 is corrected alongside it, because a FRESH
-- environment built from the original 020 would get the five-column index and
-- would silently collapse those 89 attachments. Reproducibility is the point of
-- keeping migrations in the repo at all.
--
-- Idempotent. Run in the Supabase SQL editor. No DDL is ever run from code.

begin;

drop index if exists idx_project_events_identity;

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
