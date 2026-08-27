-- 044: a market on source_health. What the run recorded, per place.
--
-- BLOCKING. Standing rule 5: migrations are printed for Philip to run, never run
-- from code. Nothing in this repository executes DDL.
--
-- WHY THIS EXISTS. Brief S item 2 asked what it would take for a generation to
-- refuse, or to state, that a market's capture failed. Measured 2026-08-25:
-- source_health holds 111 rows across 27 units and 4 run days, and its columns
-- are unit, lane, fetched, kept, run_at. There is no market anywhere.
--
-- THE UNITS CANNOT STAND IN FOR ONE. They are adapter or source names:
--
--   adapter:legistar     ONE row covering Clark County, Nashville, Oakland,
--                        Broward County, Phoenix, Yonkers and Westchester -
--                        464 records behind a single verdict.
--   adapter:anaheim-agendas    happens to name a market
--   adapter:lasvegas-agendas   happens to name a market, and fetched 0 on its
--                        last run, which nothing outside the health screen saw.
--
-- So "did Nashville's capture fail on the last run" is not answerable today, and
-- the document path cannot ask it. That is the whole gap.
--
-- WHAT THE COLUMN IS FOR, AND WHAT IT IS NOT. It records the market a set of
-- kept records belongs to, so a client document can say "the last run kept
-- nothing for Nashville" with a date beside it. It is NOT a claim that a fetch
-- failed: a fetch is not market-attributed until its records are parsed, and a
-- scoped run legitimately touches some markets and not others. The reader in
-- dashboard/lib/report-build compares a market's newest run against the newest
-- run overall for exactly that reason - a market absent from the latest run
-- while present in earlier ones is the signal, and a market absent from all of
-- them is a market nobody has captured, which is a different sentence.
--
-- NULLABLE ON PURPOSE. Every existing row predates this column and cannot be
-- back-filled: adapter:legistar's 464 records were never attributed to a market
-- at write time and inventing an attribution now would be fabrication. Old rows
-- keep market NULL and the reader treats NULL as "this row cannot speak for any
-- market", never as zero.

alter table if exists public.source_health
  add column if not exists market text;

-- The read is always "latest run for this market", so the index is on both.
create index if not exists idx_source_health_market_run
  on public.source_health (market, run_at desc);

comment on column public.source_health.market is
  'The market a run''s kept records belong to. NULL on rows written before migration 044, and on any unit that is not market-attributed. NULL means "cannot speak for a market", never zero.';
