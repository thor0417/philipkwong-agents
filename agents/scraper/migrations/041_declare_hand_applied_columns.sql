-- 041: declare the ten columns that exist and were never written down.
--
-- CHANGES NOTHING AT RUNTIME. Every statement is `add column if not exists` and
-- every column already exists, so running this is a no-op against THIS database.
-- The point is the next database, and the next reader.
--
-- WHY. agents/scraper/diagnostics/schema-drift.ts compared the repo's migration
-- set against the live schema in both directions. These ten are read by the
-- code on every run and declared by nothing:
--
--   leads.lifecycle          drives the Archive view and the lifecycle sweep
--   leads.market             the geography axis every filter and report uses
--   leads.country            corpus scope: the US-only rule reads this
--   leads.region_state       the middle geography rung
--   leads.source_tier        primary vs secondary source, read by the gate
--   leads.manual_overrides   Philip's corrections, protected from the clusterer
--   leads.status_changed_at  when a record was triaged; 481 rows carry it
--   projects.significance    the register's DEFAULT SORT
--   projects.significance_detail       why that number is what it is
--   projects.significance_computed_at  when it was last computed
--
-- A migration set that does not describe the database is not documentation, it
-- is fiction that happens to be adjacent to the truth. Nobody could rebuild this
-- database from this repo, and nobody could tell which columns are load-bearing
-- from reading the migrations - projects.significance orders every register page
-- and appears in no migration at all.
--
-- THE TYPES BELOW CAME FROM information_schema, NOT FROM SAMPLE VALUES.
--
-- The first draft of this file inferred each type from one stored value, because
-- PostgREST exposes no type information and this project has no SQL RPC. Across
-- the ten columns here that method was WRONG ONCE, on significance:
--
--   significance       sampled 88   -> guessed integer   -> IS numeric
--
-- and it also could not see a DEFAULT at all:
--
--   lifecycle          sampled "active"  -> guessed text with no default
--                      -> IS text DEFAULT 'active'::text
--
-- A fresh database built from the guessed version would have had an integer
-- where this one has a numeric, and no default where this one has one. Both are
-- silent here, because `add column if not exists` does not check the type or the
-- default against an existing column - it simply does nothing.
--
-- So the verification query at the bottom is not a formality, it is the only
-- step that checked this file against the thing it claims to describe, and it
-- caught the one error. Its output, 2026-08-19:
--
--   leads.country                     text                      nullable  NULL
--   leads.lifecycle                   text                      nullable  'active'::text
--   leads.manual_overrides            jsonb                     nullable  NULL
--   leads.market                      text                      nullable  NULL
--   leads.region_state                text                      nullable  NULL
--   leads.source_tier                 text                      nullable  NULL
--   leads.status_changed_at           timestamp with time zone  nullable  NULL
--   projects.significance             numeric                   nullable  NULL
--   projects.significance_computed_at timestamp with time zone  nullable  NULL
--   projects.significance_detail      jsonb                     nullable  NULL
--
-- ALL TEN ARE VERIFIED. Nothing in this file is a guess.
--
-- CORRECTED IN PLACE rather than superseded by a 042, because this file is a
-- DECLARATION OF WHAT EXISTS rather than a change to it. A 042 correcting a 041
-- that never altered anything would leave two files describing one column and
-- the reader deciding which is current.
--
-- significance is numeric even though the scorer rounds to a whole number in
-- 0..100 (Math.round, MAX_SCORE 100). The column is wider than its writer; that
-- is what is there, so that is what this says.
--
-- HOW THIS FILE REACHED TEN COLUMNS, because the count moved twice and each move
-- came from someone checking rather than from a tool being believed:
--
--   6   the first audit run. It read only select strings typed INLINE.
--   9   after probing the column lists the code holds in CONSTANTS -
--       PROJECT_COLUMNS and friends - which is where significance_detail,
--       significance_computed_at and source_tier were hiding.
--   10  after the audit itself was taught to resolve those constants, which
--       immediately surfaced leads.status_changed_at: written by gli.ts and two
--       migrations beside every status write, carried on 481 rows, declared
--       nowhere.
--
-- The first two numbers were wrong and were believed at the time. That is the
-- argument for the verification query rather than for a better guess.
--
-- Idempotent. Run in the Supabase SQL editor. No DDL is ever run from code.

alter table leads    add column if not exists lifecycle text default 'active';
alter table leads    add column if not exists market text;
alter table leads    add column if not exists country text;
alter table leads    add column if not exists region_state text;
alter table leads    add column if not exists source_tier text;
alter table leads    add column if not exists manual_overrides jsonb;
alter table leads    add column if not exists status_changed_at timestamp with time zone;

alter table projects add column if not exists significance numeric;
alter table projects add column if not exists significance_detail jsonb;
alter table projects add column if not exists significance_computed_at timestamp with time zone;

comment on column leads.lifecycle is
  'active | expired | dead | retired. Re-evaluated by the lifecycle sweep on '
  'every run; drives the dashboard Archive view. Declared retrospectively in 041.';
comment on column leads.source_tier is
  'primary | secondary. Whether the record came from the body that issued it or '
  'from somebody reporting it. Declared retrospectively in 041.';
comment on column leads.status_changed_at is
  'When this record was last triaged by hand. Written beside every status write '
  'and owned by Philip, never by the clusterer. Declared retrospectively in 041.';
comment on column leads.manual_overrides is
  'Fields Philip has corrected by hand, as {field: true}. The clusterer re-sends '
  'the stored value for any field named here and never its own. Declared '
  'retrospectively in 041.';
comment on column projects.significance is
  'The register default sort, 0..100, computed by agents/scraper/significance. '
  'A project carrying significance in manual_overrides keeps a pinned score and '
  'the model is not consulted. Declared retrospectively in 041.';

-- VERIFICATION. Run twice on 2026-08-19. The first run corrected significance to
-- numeric and found the default on lifecycle; the second settled
-- status_changed_at. Both outputs are quoted in the header. Kept in the file so
-- a later reader can re-run it rather than trust this one.
select table_name, column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public'
   and (
     (table_name = 'leads'    and column_name in
       ('lifecycle','market','country','region_state','source_tier','manual_overrides',
        'status_changed_at'))
     or
     (table_name = 'projects' and column_name in
       ('significance','significance_detail','significance_computed_at'))
   )
 order by table_name, column_name;
