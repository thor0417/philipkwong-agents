-- 008: development_category on GLI leads. GLI is not leisure-only; development
-- opportunity spans the full spectrum (Leisure/Attractions, Smart City/Urban,
-- Mixed-Use/Real Estate, Infrastructure, Hospitality/Tourism, Other/Uncategorized).
-- The scraper tags this on write (agents/scraper/development-category.ts); the
-- dashboard derives it on read as a fallback for any untagged rows. Idempotent.
--
-- Run this before the next scrape, else GLI writes fail on the unknown column.
-- Backfill existing rows with:
--   node --env-file=.env.local --import tsx agents/scraper/migrations/backfill-development-category.ts
alter table leads add column if not exists development_category text;
create index if not exists idx_leads_development_category on leads(development_category);
