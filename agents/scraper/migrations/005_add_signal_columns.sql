-- 005: signals lane (Part B, LATAM/Caribbean development-project origination).
-- Private-developer pre-tender signals (land acquisition, incentive approvals,
-- development/environmental applications) captured on legitimacy, not fit-scored.
-- Idempotent.
alter table leads add column if not exists signal_type text;
alter table leads add column if not exists signal_date date;
alter table leads add column if not exists regulator text;
alter table leads add column if not exists project_description text;
create index if not exists idx_leads_signal_type on leads(signal_type);
