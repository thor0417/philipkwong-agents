-- 021: PIPELINES. One row per line of business.
--
-- WHY. `module` is a bare string on every row and 'gli' is doing three jobs at
-- once: it names the hospitality pipeline, it is the default in half a dozen
-- function signatures, and it sits alongside retired 'fuel' and 'consulting'
-- rows that nothing distinguishes except convention. Every query, view, report
-- and delivery has to scope to a line of business, and today that scoping is a
-- string literal repeated in ~20 files.
--
-- A registry makes the set of pipelines DATA. Retiring one becomes a row update
-- with a reason attached, rather than a comment in a TypeScript file that a
-- reader has to find. Adding one becomes an insert.
--
-- brand_name and brand_logo exist because a delivery is branded: the hospitality
-- pipeline goes out as JKR & Associates. That is a property of the pipeline, not
-- of the dashboard, and hardcoding it into a component is how a second pipeline
-- ends up needing a component change.
--
-- retired_reason is not decoration. 'fuel' was closed for a specific, findable
-- reason and that reason is worth more than the boolean beside it.
--
-- id is TEXT rather than uuid on purpose: it is the value already stored in
-- leads.module and projects.module, so the foreign key in migration 022 can be
-- added without rewriting a single existing row.
--
-- Idempotent. Run in the Supabase SQL editor. No DDL is ever run from code.

create table if not exists pipelines (
  id text primary key,
  name text not null,
  short_name text not null,
  brand_name text,
  brand_logo text,
  active boolean default true,
  retired_reason text,
  sort_order integer default 0,
  created_at timestamp with time zone default now()
);

insert into pipelines (id, name, short_name, brand_name, sort_order) values
  ('hospitality', 'Hospitality and Entertainment', 'Hospitality', 'JKR & Associates', 1)
on conflict (id) do nothing;

insert into pipelines (id, name, short_name, active, retired_reason, sort_order) values
  ('fuel', 'Fuel', 'Fuel', false, 'Closed July 2026: counterparty layer not verifiable', 90),
  ('consulting', 'Legacy consulting', 'Consulting', false, 'Superseded', 91)
on conflict (id) do nothing;

-- THE MIGRATION ROW. Every existing record carries module 'gli', and 'gli' means
-- hospitality. Rather than rewrite ~1,400 rows in this migration - which would
-- be a data change hiding inside a schema change, and irreversible without a
-- backup - 'gli' is registered as a pipeline id in its own right and marked as
-- the legacy alias of hospitality.
--
-- Migration 022 adds the foreign key; the alias is what lets it be added without
-- touching a single stored row. The rename of the DATA is a separate, reversible
-- step reported on its own.
insert into pipelines (id, name, short_name, brand_name, active, retired_reason, sort_order) values
  ('gli', 'Hospitality and Entertainment (legacy id)', 'Hospitality', 'JKR & Associates', true,
   'Legacy alias of hospitality; retained so existing rows keep a valid foreign key', 2)
on conflict (id) do nothing;

alter table pipelines enable row level security;

drop policy if exists "Authenticated full access" on pipelines;

create policy "Authenticated full access" on pipelines
  for all using (auth.role() = 'authenticated');
