-- 011: primary-document fields for source-chaining (trade press to primary
-- document) in the intelligence lane, and for the government document adapter.
-- primary_document_url is the resolved primary source (a .gov / official district
-- document); has_primary_document is true only when a real file was fetched.
-- Idempotent. Run before the next intelligence or government scrape.
alter table leads add column if not exists primary_document_url text;
alter table leads add column if not exists has_primary_document boolean default false;
