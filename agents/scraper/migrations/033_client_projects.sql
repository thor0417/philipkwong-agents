-- 033: CONFIRMED CLIENT MEMBERSHIP.
--
-- BLOCKING. Run this in the Supabase SQL editor before the membership gate can
-- do anything. Nothing in this repo runs DDL.
--
-- WHY IT EXISTS. A client's scope is a query, and a query is a PROPOSAL. It says
-- "these 40 projects look like Simtec's", and it is right most of the time and
-- wrong in a way nobody can see: a market spelled differently, a venue type that
-- means something else in this jurisdiction, a project that matches on paper and
-- would embarrass everyone in a document. Today the proposal IS the document -
-- whatever the scope resolves to at generation time is what gets printed, and
-- there is no step between the query and the client.
--
-- This is that step. The scope proposes; Philip confirms; only what he confirmed
-- can be printed.
--
-- THREE STATUSES, AND THE THIRD IS THE POINT.
--
--   proposed  the scope matched it and nobody has looked yet
--   included  Philip confirmed it. The ONLY status a report may print.
--   excluded  Philip looked and said no
--
-- An excluded row is a TOMBSTONE, not a deletion. Deleting it would let the next
-- scope resolution re-propose the same project, and the operator would be asked
-- the same question forever with no record that they had already answered it.
-- Nothing in this system is hard deleted and this is a case where the reason is
-- mechanical rather than sentimental.
--
-- WHO AND WHEN, because a confirmation nobody can date is not much of a
-- confirmation. set_by is free text rather than a foreign key into auth.users:
-- this is a single-operator system today, a scope sweep will want to write
-- 'sweep' or 'scope-resolution', and a NOT NULL reference to a users table would
-- make that impossible without inventing a service user.

create table if not exists public.client_projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null default 'proposed'
    check (status in ('proposed', 'included', 'excluded')),
  -- Which scope axes matched, at the moment the row was proposed. Stored rather
  -- than recomputed, because it is the ANSWER TO "why is this in my report" and
  -- the scope it was matched against may have been edited since.
  matched_axes text[] not null default '{}',
  set_by text,
  set_at timestamptz,
  created_at timestamptz not null default now()
);

-- ONE ROW PER CLIENT AND PROJECT. Without this a re-proposal adds a second row
-- and the project is simultaneously proposed and excluded, which the report gate
-- would have to break a tie on. It must not be possible to be in two states.
create unique index if not exists client_projects_client_project_idx
  on public.client_projects (client_id, project_id);

-- The report gate reads (client_id, status); the client view reads client_id.
create index if not exists client_projects_status_idx
  on public.client_projects (client_id, status);

alter table public.client_projects enable row level security;

-- Same policy shape as clients and client_scopes: authenticated users read and
-- write, the service role bypasses. Written as drop-then-create so re-running
-- this file is safe.
drop policy if exists "client_projects readable by authenticated" on public.client_projects;
create policy "client_projects readable by authenticated"
  on public.client_projects for select
  to authenticated
  using (true);

drop policy if exists "client_projects writable by authenticated" on public.client_projects;
create policy "client_projects writable by authenticated"
  on public.client_projects for all
  to authenticated
  using (true)
  with check (true);
