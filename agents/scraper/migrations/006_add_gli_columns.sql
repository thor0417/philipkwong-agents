-- 006: GLI lane (Grant Leisure International) columns. Leisure / attraction /
-- hospitality / gaming / cultural venue opportunities from the Google CSE
-- source, tagged with a venue_type and signal_type and (when exposed) contact
-- details. Idempotent.
--
-- signal_type already exists from 005 (reused here with GLI's venue-signal
-- vocabulary; module 'gli' scopes it) and contact_email exists from 001; both
-- are re-declared add-if-not-exists for a self-contained migration.
alter table leads add column if not exists venue_type text;
alter table leads add column if not exists signal_type text;
alter table leads add column if not exists contact_name text;
alter table leads add column if not exists contact_phone text;
create index if not exists idx_leads_venue_type on leads(venue_type);
