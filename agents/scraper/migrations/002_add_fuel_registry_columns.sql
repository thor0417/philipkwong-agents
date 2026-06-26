-- Fuel module addendum: tender/registry typing + registry/cross-ref columns.
-- Idempotent. Safe to run repeatedly.

alter table leads add column if not exists lead_type text;
alter table leads add column if not exists license_type text;
alter table leads add column if not exists port text;
alter table leads add column if not exists region text;
alter table leads add column if not exists matched_counterparty boolean default false;

create index if not exists idx_leads_lead_type on leads(lead_type);
