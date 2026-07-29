-- 016: PROJECTS. The clustered entity: one row per real-world project.
--
-- WHY. The dashboard shows records; the business thinks in projects. OCVibe is
-- seven records, Heart Hotel is three Clark County filings, CFTOD is a 2045 plan
-- plus board items. Today a human reassembles those by hand, which is how the
-- July report was produced. At 25 markets that is impossible: clustering is what
-- makes the record count irrelevant, turning ~20,000 records into ~1,500
-- browsable projects with stage and geography.
--
-- A lead belongs to AT MOST ONE project (leads.project_id, nullable). Null is a
-- first-class state, not a failure: an unclustered record lives in the Inbox and
-- is never hidden and never deleted. cluster_reason records WHY a lead joined
-- (target / case-family / entity / site / manual), so every attachment is
-- auditable and a false merge can be traced to the rule that made it.
--
-- project_key is the deterministic identity the clusterer computes (unique per
-- module). Re-running the clusterer must land on the same key for the same real
-- project, or every run would create duplicates.
--
-- Idempotent. Run in the Supabase SQL editor. No DDL is ever run from code.
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  module text not null default 'gli',
  name text not null,
  project_key text not null,
  country text,
  region_state text,
  market text,
  stage text default 'filed',
  development_category text,
  venue_type text,
  status text default 'new',
  watch boolean default false,
  notes text,
  manual_overrides jsonb,
  first_seen timestamp with time zone default now(),
  last_activity timestamp with time zone,
  next_milestone text,
  record_count integer default 0,
  primary_applicant text,
  primary_representative text,
  created_at timestamp with time zone default now()
);

create unique index if not exists idx_projects_key on projects(module, project_key);
create index if not exists idx_projects_market on projects(country, region_state, market);
create index if not exists idx_projects_stage on projects(stage);
create index if not exists idx_projects_status on projects(status);
create index if not exists idx_projects_activity on projects(last_activity desc);

-- The join: a lead belongs to at most one project.
alter table leads add column if not exists project_id uuid references projects(id);
alter table leads add column if not exists cluster_reason text;
create index if not exists idx_leads_project on leads(project_id);
