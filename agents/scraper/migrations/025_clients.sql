-- 025: CLIENTS, CONTACTS AND SCOPES. The service, rather than the tool.
--
-- WHY. Everything up to here is an internal instrument: Philip looks at the
-- register and knows what matters. A client never sees the register. They
-- receive a document, on a cadence, addressed to them, covering the ground they
-- pay for. None of that is written down anywhere - the scope lives in Philip's
-- head, the addressee is retyped each time, and there is no record of who
-- received what.
--
-- THE DESIGN POINT THAT MATTERS: A SCOPE MUST RESOLVE TO A QUERY.
--
-- "Simtec wants ride and attraction projects at design or procurement stage in
-- the Strip corridor" is a sentence. As a note in a CRM it is unexecutable: a
-- human has to read it and remember what it meant. Every column on
-- client_scopes is instead a filter the system ALREADY applies to projects and
-- leads - the same countries, regions, markets, streams, development
-- categories, venue types and stages the Register filters on - so a scope
-- resolves to a result set that can be counted before a report is written.
--
-- That is what makes the scope preview possible, and the scope preview is what
-- stops an empty report being discovered by the client rather than by Philip.
--
-- ARRAYS, NOT SINGLE VALUES. A client is rarely interested in exactly one
-- market or one stage. text[] holds "Las Vegas and Clark County", and an empty
-- or null array means "no constraint on this axis" rather than "matches
-- nothing" - the resolver reads it that way, and an all-null scope is the whole
-- pipeline rather than an empty set.
--
-- ONE SCOPE PER PIPELINE, SEVERAL PER CLIENT. pipeline_id is not nullable
-- because a scope with no pipeline cannot be resolved: the pipelines hold
-- different record shapes. A client interested in both GLI and consulting work
-- holds two scopes, which is also how their report can cover both and say which
-- is which.
--
-- WATCH TERMS ARE NOT A REPORT FILTER. They are standing capture instructions:
-- a term a client names becomes something the intelligence lane searches for,
-- so their interest changes what is collected rather than only what is shown.
--
-- CADENCE AND NEXT_DELIVERY are what a scheduled agent will later read. Stored
-- now, deliberately, so the schedule is a property of the client rather than of
-- a cron expression nobody can see.
--
-- BRAND_NAME AND ADDRESSEE live on the client because they are the client's,
-- not the generator's. A hardcoded brand in a template is how one client's
-- document goes out with another client's name on it.
--
-- Idempotent. Run in the Supabase SQL editor. No DDL is ever run from code.

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  organisation text,
  status text default 'active',
  brand_name text,
  addressee text,
  cadence text default 'monthly',
  next_delivery date,
  notes text,
  created_at timestamp with time zone default now()
);

create table if not exists client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  name text not null,
  email text,
  role text,
  primary_contact boolean default false,
  created_at timestamp with time zone default now()
);

create table if not exists client_scopes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  pipeline_id text not null,
  countries text[],
  regions text[],
  markets text[],
  streams text[],
  development_categories text[],
  venue_types text[],
  stages text[],
  watch_terms text[],
  notes text,
  created_at timestamp with time zone default now()
);

create index if not exists idx_client_contacts_client on client_contacts(client_id);
create index if not exists idx_client_scopes_client on client_scopes(client_id);

-- RLS matching every other table in this schema. Enabled with no policy denies
-- everything to the dashboard's anon-key session while the service role sails
-- through, which is a gap that hides itself: the agents keep working and only
-- the screen is empty.
alter table clients enable row level security;
drop policy if exists "Authenticated full access" on clients;
create policy "Authenticated full access" on clients
  for all using (auth.role() = 'authenticated');

alter table client_contacts enable row level security;
drop policy if exists "Authenticated full access" on client_contacts;
create policy "Authenticated full access" on client_contacts
  for all using (auth.role() = 'authenticated');

alter table client_scopes enable row level security;
drop policy if exists "Authenticated full access" on client_scopes;
create policy "Authenticated full access" on client_scopes
  for all using (auth.role() = 'authenticated');
