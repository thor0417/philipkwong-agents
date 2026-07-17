-- 013: two-object model (Phase 1). Every GLI lead is either a deadline-bound
-- OPPORTUNITY (a tender/RFP/EOI/feasibility solicitation) or a PROJECT EVENT
-- (announcement, government record, planning approval, construction milestone,
-- trade-press coverage). The distinction drives liveness:
--   object_type    'opportunity' | 'project_event', set at write time by the
--                  deadline rule (a source submission deadline -> opportunity).
--   milestone_date the MAX FUTURE date (2026-2035) parsed from the lead text
--                  ("opening 2028", "completion 2027", scheduled hearing dates).
--                  A project with a future milestone is always LIVE, never purged.
-- Idempotent. Run in the Supabase SQL editor before the object-model backfill.
alter table leads add column if not exists object_type text;
alter table leads add column if not exists milestone_date text;

create index if not exists idx_leads_object_type on leads(object_type);
