-- 012: date provenance for best-available-date filtering (Brief 1).
--
-- 87% of opportunity leads are undated because the sources do not publish a date
-- in their feeds. The fix is a best-available-date strategy, not naive capture:
--   1. capture the real date wherever the source provides one (deadline /
--      published_date, set by the adapters);
--   2. derive a date from the lead's own text where possible (parsed);
--   3. record when WE first saw the lead, which always exists (first_seen);
--   4. filter on the best of those, and visibly flag genuinely unknown dates.
--
-- first_seen: when this row was first written. Defaults to now() so existing rows
-- get an honest floor at migration time (we do not know their true first-seen).
-- date_source: provenance of the date we filter on --
--   'source'     = a real date the source exposed (deadline / published_date)
--   'parsed'     = extracted from the lead's title / raw_content
--   'first_seen' = no source or parsed date; first_seen is the best available
--   null         = genuinely unknown (pre-backfill)
-- Idempotent. Run in the Supabase SQL editor BEFORE the next GLI scrape or the
-- date backfill (the scraper writes date_source, so the column must exist first).
alter table leads add column if not exists first_seen timestamp with time zone default now();
alter table leads add column if not exists date_source text;

create index if not exists idx_leads_date_source on leads(date_source);
