-- Migration 018: row-level security policy for projects.
--
-- THIS IS REQUIRED FOR THE REGISTER TO SHOW ANYTHING. It is a gap in the Part A
-- schema, found by probing the live database rather than by reading the SQL.
--
-- RLS is ENABLED on projects (Supabase enables it on new tables), but Part A
-- created no policy. RLS enabled with no policy denies everything to everyone
-- except the service role, so:
--   - the scraper is fine, because it writes with the service-role key, which
--     bypasses RLS entirely - which is exactly why the backfill succeeded and
--     the gap did not announce itself;
--   - the dashboard connects with the anon key as an authenticated user, so the
--     register reads ZERO projects and looks like a clustering failure rather
--     than a permissions one.
--
-- Verified against the live database before writing this: signed out, a select
-- on projects returned 0 rows and an insert failed with "new row violates
-- row-level security policy for table projects".
--
-- The policy matches every other table in supabase/schema.sql exactly, so
-- projects is governed the same way leads is. Idempotent.

alter table projects enable row level security;

drop policy if exists "Authenticated full access" on projects;

create policy "Authenticated full access" on projects
  for all using (auth.role() = 'authenticated');
