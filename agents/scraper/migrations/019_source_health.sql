-- 019: source_health. What each source produced on each run.
--
-- WHY. The zero-write alarm needs a baseline, and it had none: the old call
-- passed the CURRENT run's own dedupe count as its own "trailing average", so a
-- dead lane compared itself against zero and the guard suppressed the alert.
-- A baseline has to come from history, and history has to be stored somewhere.
--
-- One row per source per run. `unit` is usually a source name ('legistar',
-- 'clark-tab') but may be finer where the failure is finer: the CFTOD extractor
-- writes one row per board packet, because the packet is the thing that stopped
-- working while the source as a whole looked healthy.
--
-- The alarm reads the last 5 runs per unit and alerts when a unit that used to
-- keep records keeps none. Until this table exists the alarm still fires on the
-- two rules that need no history (fetched nothing, or fetched something and kept
-- nothing) - it simply cannot tell a new source from a broken one.
--
-- Idempotent. Run in the Supabase SQL editor. No DDL is ever run from code.
create table if not exists source_health (
  id uuid primary key default gen_random_uuid(),
  unit text not null,
  lane text not null,
  fetched integer not null default 0,
  kept integer not null default 0,
  run_at timestamp with time zone not null default now()
);

-- The alarm's only query: recent rows for a unit, newest first.
create index if not exists idx_source_health_unit on source_health(unit, run_at desc);
create index if not exists idx_source_health_lane on source_health(lane, run_at desc);

-- Same policy as every other table: the scraper writes with the service-role
-- key and bypasses RLS; the dashboard reads as an authenticated user.
alter table source_health enable row level security;
drop policy if exists "Authenticated full access" on source_health;
create policy "Authenticated full access" on source_health
  for all using (auth.role() = 'authenticated');
