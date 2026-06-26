-- Scraper engine rebuild: new lead columns + indexes.
-- Idempotent. Safe to run repeatedly.

alter table leads add column if not exists industry text;
alter table leads add column if not exists module text;
alter table leads add column if not exists company text;
alter table leads add column if not exists contact_email text;
alter table leads add column if not exists deadline timestamp with time zone;
alter table leads add column if not exists value_estimate text;
alter table leads add column if not exists location text;
alter table leads add column if not exists website_status text;

create index if not exists idx_leads_module on leads(module);
create index if not exists idx_leads_industry on leads(industry);
