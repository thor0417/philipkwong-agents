-- 020: PROJECT EVENTS. The register's memory of change.
--
-- WHY. Stage is RECOMPUTED on every backfill, so a project that moved from
-- filed to approved this week is today indistinguishable from one approved a
-- year ago. The most valuable question on a Monday - what moved - is
-- unanswerable, and it is unanswerable permanently, because every run
-- overwrites the only evidence that anything changed.
--
-- This table is the fix and it is append-only. A row is never updated and never
-- deleted. That is the whole value: a history that can be rewritten is not a
-- history, and the moment anything in the codebase updates a row here the table
-- stops being trustworthy for every question it exists to answer.
--
-- actor is 'system' or 'philip', so an automated recompute and a hand decision
-- stay distinguishable forever. Without it, "approved" from the clusterer and
-- "approved" because Philip said so would look identical a year from now, and
-- only one of those is evidence.
--
-- lead_id carries the record that TRIGGERED the change, which is what makes
-- "approved by this filing" answerable rather than merely "approved on this
-- date". It is nullable because not every event has a triggering record: a
-- rename does not, a project_created does not.
--
-- from_value / to_value are text rather than typed columns because the same
-- table carries stage changes, renames, status changes and watch toggles. detail
-- is jsonb for anything a specific event type needs that the fixed columns
-- cannot express.
--
-- Idempotent. Run in the Supabase SQL editor. No DDL is ever run from code.

create table if not exists project_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  module text not null default 'gli',
  event_type text not null,
  occurred_at timestamp with time zone not null default now(),
  actor text not null default 'system',
  from_value text,
  to_value text,
  lead_id uuid references leads(id),
  detail jsonb,
  created_at timestamp with time zone default now()
);

-- One project's history, newest first. The Project History query.
create index if not exists idx_project_events_project on project_events(project_id, occurred_at desc);

-- All events of a type in a period. The What Moved query (event_type =
-- 'stage_changed').
create index if not exists idx_project_events_type on project_events(event_type, occurred_at desc);

-- Everything recent in one pipeline. The What Came In and Watchlist queries.
create index if not exists idx_project_events_recent on project_events(module, occurred_at desc);

-- IDEMPOTENCY IS ENFORCED IN THE DATABASE, not only in the emitter.
--
-- Re-running the backfill must not duplicate events, and a guard that lives only
-- in TypeScript is a guard that a future caller forgets. This unique index makes
-- a duplicate emission a no-op at the database level: the emitter inserts with
-- on conflict do nothing, so re-running is safe however it is called.
--
-- The identity of an event is (project, type, when, from, to). Two genuinely
-- distinct events of the same type on the same project at the same instant with
-- the same values do not exist - that is the same event observed twice.
--
-- coalesce, because a null in a unique index does not compare equal to another
-- null in Postgres, which would let unlimited duplicates of any event with a
-- null from_value through. That is most of them.
create unique index if not exists idx_project_events_identity
  on project_events(
    project_id,
    event_type,
    occurred_at,
    coalesce(from_value, ''),
    coalesce(to_value, '')
  );

-- Same policy as every other table in supabase/schema.sql: the scraper writes
-- with the service-role key and bypasses RLS; the dashboard reads as an
-- authenticated user. Without a policy, RLS-enabled means the dashboard sees
-- nothing - the exact gap migration 018 existed to close for projects.
alter table project_events enable row level security;

drop policy if exists "Authenticated full access" on project_events;

create policy "Authenticated full access" on project_events
  for all using (auth.role() = 'authenticated');
