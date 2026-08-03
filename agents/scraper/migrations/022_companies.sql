-- 022: COMPANIES. Parties as entities rather than strings.
--
-- WHY. applicant, representative, presented_by and owner are free text on the
-- lead row, so three questions a partner brief is built from cannot be asked at
-- all:
--
--   every project this developer has filed
--   what else this architect designed
--   which entitlements this attorney has carried
--
-- "KULIK RIVER CAPITAL, LLC" and "Kulik River Capital LLC" are the same company
-- and two different strings, so even counting is wrong before the question is
-- asked. The clusterer already knows how to fold those together
-- (normalizeEntity, legal-suffix stripping, fuzzy matching); this table gives
-- the result somewhere to live.
--
-- normalized_name is the identity and is UNIQUE. name is what a human sees, kept
-- as the source spells it.
--
-- ROLE IS ON THE LINK, NOT ON THE COMPANY. The same firm is an applicant on one
-- project and the representative on another, and Kaempfer Crowell is a
-- representative on four unrelated sites. A company_type on the company row
-- would force one answer for all of them; role on company_projects lets both be
-- true. The unique index is on (company, project, role) for exactly that reason:
-- one company may hold two roles on one project, and that is not a duplicate.
--
-- manual_overrides and notes match the curation contract every other table
-- follows: they belong to Philip and no automated path writes them.
--
-- Idempotent. Run in the Supabase SQL editor. No DDL is ever run from code.

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null,
  company_type text,
  notes text,
  manual_overrides jsonb,
  first_seen timestamp with time zone default now(),
  last_activity timestamp with time zone,
  created_at timestamp with time zone default now()
);

create unique index if not exists idx_companies_normalized on companies(normalized_name);
create index if not exists idx_companies_activity on companies(last_activity desc);

create table if not exists company_projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  project_id uuid not null references projects(id),
  role text not null,
  first_seen timestamp with time zone default now(),
  created_at timestamp with time zone default now()
);

-- One company may hold several roles on one project (applicant AND owner), so
-- role is part of the identity. Re-running the backfill is then a no-op.
create unique index if not exists idx_company_project_role
  on company_projects(company_id, project_id, role);

-- "who is on this project", the reverse of the three questions above.
create index if not exists idx_company_projects_project on company_projects(project_id);

alter table companies enable row level security;
drop policy if exists "Authenticated full access" on companies;
create policy "Authenticated full access" on companies
  for all using (auth.role() = 'authenticated');

alter table company_projects enable row level security;
drop policy if exists "Authenticated full access" on company_projects;
create policy "Authenticated full access" on company_projects
  for all using (auth.role() = 'authenticated');
