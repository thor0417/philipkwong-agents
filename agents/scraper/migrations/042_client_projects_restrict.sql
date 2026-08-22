-- 042: A CONFIRMATION IS NOT COLLATERAL. STOP THE CASCADE.
--
-- BLOCKING. Run this in the Supabase SQL editor. Nothing in this repo runs DDL.
--
-- WHAT WENT WRONG, MEASURED.
--
-- Migration 033 declared:
--
--     project_id uuid not null references public.projects(id) on delete cascade
--
-- and the orphan sweep in agents/scraper/migrations/backfill-projects.ts is the
-- only hard delete in this system. Put together, deleting an empty project shell
-- did not ORPHAN Philip's confirmation. It ERASED it: no tombstone, no line in
-- the removal log, and nothing anywhere on disk that enumerates a confirmed set
-- to reconstruct it from - the audit artefacts carry counts only.
--
-- On 2026-08-21 the Legistar backfill re-keyed three projects (Athletics StadCo,
-- Tropicana Land resort, 215 And Windmill Lane). The sweep deleted the shells
-- they left behind. JKR's confirmed count went from 116 - recorded on disk in
-- dashboard/e2e/shots/walkthrough/client-view-audit.json at commits 7554f0f and
-- fc6caea - to 115, and the document it would generate from 111 projects to 110.
-- WHICH confirmation was lost is not recoverable. All three projects came back
-- the next morning as 'proposed', written by scope-resolution.
--
-- The cascade is worse for an 'excluded' row, and 033's own header says why:
-- "An excluded row is a TOMBSTONE, not a deletion. Deleting it would let the
-- next scope resolution re-propose the same project, and the operator would be
-- asked the same question forever with no record that they had already answered
-- it." The cascade did exactly that, silently.
--
-- WHY RESTRICT AND NOT SOMETHING CLEVERER.
--
-- The sweep now reads client_projects before it deletes and keeps any project a
-- client holds a row for, whatever the status and whoever wrote it. That is the
-- fix; this is the backstop. With the sweep guard in place NOTHING SHOULD EVER
-- HIT THIS CONSTRAINT, and that is the point of it: if a future write path grows
-- its own delete and forgets the guard, the database refuses the delete and the
-- run fails loudly, instead of a client's confirmed membership disappearing and
-- being noticed a week later as a project missing from a brief.
--
-- A trigger that copied the row to an archive table was considered and rejected:
-- it makes the deletion succeed, which is the behaviour that caused this. The
-- correct answer to "delete a project a client has confirmed" is no.
--
-- ON THE CLIENT SIDE THE CASCADE STAYS. Deleting a CLIENT should still remove
-- its membership rows: they mean nothing without the client, and no judgement of
-- Philip's is lost, because the judgement was about that client's document.
--
-- IF THIS FAILS TO APPLY, a project referenced by client_projects has already
-- been deleted and the rows are orphaned rather than cascaded - which cannot
-- happen under the current cascade, but check before forcing anything:
--
--     select cp.project_id, count(*)
--       from public.client_projects cp
--       left join public.projects p on p.id = cp.project_id
--      where p.id is null
--      group by 1;
--
-- Expected: zero rows. verify-curation asserts the same thing on every run.

alter table public.client_projects
  drop constraint if exists client_projects_project_id_fkey;

alter table public.client_projects
  add constraint client_projects_project_id_fkey
  foreign key (project_id) references public.projects(id)
  on delete restrict;

-- Re-assert the client-side cascade unchanged, so this file fully describes the
-- table's referential behaviour rather than half of it.
alter table public.client_projects
  drop constraint if exists client_projects_client_id_fkey;

alter table public.client_projects
  add constraint client_projects_client_id_fkey
  foreign key (client_id) references public.clients(id)
  on delete cascade;

-- Read it back after running:
--
--     select conname,
--            confdeltype   -- 'r' = restrict, 'c' = cascade
--       from pg_constraint
--      where conrelid = 'public.client_projects'::regclass
--        and contype = 'f'
--      order by conname;
--
-- Expected exactly two rows:
--     client_projects_client_id_fkey    c
--     client_projects_project_id_fkey   r
