-- 031: leads.query_term and leads.query_scope. Which search produced a record.
--
-- WHY. The intelligence lane issues 22 sector queries and a watch pass, and
-- stored nothing about which one returned any given record. Measured over the
-- 490 records we hold, that means:
--
--   * no term can be retired, because none can be shown to have produced
--     nothing;
--   * no term can be defended, because none can be shown to have produced
--     anything;
--   * the only split recoverable after the fact is sector-vs-watch, and only
--     because the sector pass is site-restricted, so an off-curated host could
--     not have come from it.
--
-- Seven of the 22 terms appear to have produced zero records and six appear to
-- have produced a covered-market record, but both figures are a PROXY computed
-- by matching a term's words against a record's text. They are not evidence,
-- and this migration is what replaces them with evidence.
--
-- WHAT GOES IN THEM.
--
--   query_term   the search string as issued, verbatim, e.g.
--                'casino development' or the OR-group of a watch batch.
--   query_scope  which pass and which slice, e.g. 'sector:batch 3/5' or
--                'watch:group 2/13'. The domain batch matters because a
--                site:-batched query puts ten domains in competition with each
--                other, so a term's yield is not separable from the batch it
--                ran in.
--
-- NULL means the record predates this column or came from a lane that does not
-- search. It never means the record had no query.
--
-- Idempotent. Run in the Supabase SQL editor. No DDL is ever run from code.

alter table leads add column if not exists query_term text;
alter table leads add column if not exists query_scope text;

comment on column leads.query_term is
  'The search string that returned this record, verbatim as issued. Null for '
  'records not produced by a search lane, or captured before 2026-08-12.';

comment on column leads.query_scope is
  'Which pass and slice issued the query: sector:batch n/N or watch:group n/N. '
  'The batch is recorded because site:-batched domains compete inside a query.';

-- Small: only the search lanes populate these, and most of the corpus is
-- government records that never will.
create index if not exists leads_query_term_idx on leads (query_term) where query_term is not null;

-- What it looks like afterwards. Both read 0 until the next intelligence run.
select
  count(*)                                     as leads_total,
  count(*) filter (where query_term is not null) as with_query
from leads;
