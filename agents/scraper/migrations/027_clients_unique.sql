-- 027: A CLIENT IS UNIQUE BY NAME AND ORGANISATION.
--
-- WHY. Eight identical "Simtec Attractions" rows accumulated, one per
-- verification run, because nothing refused the second write. The harness had a
-- race in it - it asked whether the client was already on screen before the
-- query answered - but that is not the defect worth fixing here. A bug in a
-- test should cost a wasted run, not a corrupted client list, and the same
-- double-submit is one impatient double-click away in the real intake form.
--
-- A UNIQUE INDEX ON (name, organisation) WOULD NOT HAVE STOPPED IT, and that is
-- the whole reason this is an expression index. In Postgres two NULLs are
-- distinct, so with organisation NULL - which it was on all eight rows - a
-- plain unique constraint permits unlimited duplicates. The one shape the
-- constraint most needs to catch is exactly the shape it would have missed.
--
-- coalesce() folds NULL and empty to the same value. lower(trim()) folds case
-- and stray whitespace, because "Simtec Attractions" and "simtec attractions "
-- are one client and a constraint that lets both in has not prevented anything
-- a person would call a duplicate.
--
-- THIS WILL FAIL IF DUPLICATES REMAIN. Run migrations/dedupe-clients.ts first
-- (CLIENTS_APPLY=1). That is deliberate: a constraint that silently skipped
-- creation because the data violated it would leave the table unprotected while
-- appearing to be protected.
--
-- Idempotent. Run in the Supabase SQL editor. No DDL is ever run from code.

create unique index if not exists idx_clients_identity
  on clients (lower(trim(name)), lower(coalesce(trim(organisation), '')));
