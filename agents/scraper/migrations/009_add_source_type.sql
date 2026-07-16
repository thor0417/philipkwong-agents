-- 009: source_type on government (Tier 2) leads. Classifies the government record
-- document type against the canonical SOURCE_TYPES (lib/taxonomy.ts): Council
-- Agenda, Planning/Zoning Minutes, Staff Report, Comprehensive Plan, Plan
-- Amendment, Special District Document, Budget Document, Other. Idempotent.
-- Run in the Supabase SQL editor before the next government scrape.
alter table leads add column if not exists source_type text;
create index if not exists idx_leads_source_type on leads(source_type);
