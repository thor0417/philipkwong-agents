-- 026: DELIVERIES. What was sent, to whom, covering what, when.
--
-- WHY THIS IS NOT A LOG FILE. It is the commercial record and the legal one. A
-- client asks "did you tell us about the Skyline TIF resolution in July" and
-- the answer has to be a row, not a memory of a chat session. A retainer
-- dispute turns on exactly which period a document covered and what its scope
-- excluded.
--
-- SCOPE IS STORED AS JSONB, resolved, not as a client_scope reference. The
-- client's stored scope is editable and WILL change; the scope a document was
-- generated under cannot be allowed to change with it, or the record silently
-- rewrites history. A report generated with a one-off override - this month,
-- Nevada only - is also not the client's scope at all, and there would be
-- nothing to point the reference at.
--
-- BRAND_NAME AND ADDRESSEE ARE COPIED HERE for the same reason: what the
-- document actually said, not what the client record says today.
--
-- PROJECT_COUNT AND RECORD_COUNT are the document's own totals. They make "the
-- April report covered 31 projects" answerable without regenerating it, and a
-- period where the count collapses is a coverage failure worth seeing.
--
-- CLIENT_ID IS NULLABLE and on delete set null. A referral brief or an internal
-- document has no client, and deleting a client must not erase the record that
-- they were sent something.
--
-- Idempotent. Run in the Supabase SQL editor. No DDL is ever run from code.

create table if not exists deliveries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete set null,
  document_type text not null,
  scope jsonb,
  brand_name text,
  addressee text,
  generated_at timestamp with time zone default now(),
  period_start date,
  period_end date,
  project_count integer,
  record_count integer,
  file_path text,
  delivery_status text default 'generated',
  notes text
);

create index if not exists idx_deliveries_client on deliveries(client_id, generated_at desc);

alter table deliveries enable row level security;
drop policy if exists "Authenticated full access" on deliveries;
create policy "Authenticated full access" on deliveries
  for all using (auth.role() = 'authenticated');
