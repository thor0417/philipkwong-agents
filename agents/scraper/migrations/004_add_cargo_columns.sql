-- 004: cargo-scale experiment bucket. Flags cargo-scale fuel demand, captures a
-- stated volume, and tags national-oil-company / state buyers. Idempotent.
alter table leads add column if not exists is_cargo boolean default false;
alter table leads add column if not exists volume_estimate text;
alter table leads add column if not exists sector text;
create index if not exists idx_leads_is_cargo on leads(is_cargo);
