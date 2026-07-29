-- philipkwong-agents — Supabase schema
-- Run this whole file in the Supabase SQL editor (one paste).
-- Corrected from the v1.0 spec (the original outreach RLS policy had a syntax error).

-- ── Tables ────────────────────────────────────────────────

create table if not exists leads (
  id uuid default gen_random_uuid() primary key,
  source text not null,
  url text unique not null,
  title text,
  raw_content text,
  score integer,
  score_reason text,
  status text default 'new',
  jurisdiction text,
  budget text,
  notes text,
  next_action text,
  next_action_date timestamp with time zone,
  date_found timestamp with time zone default now(),
  outreach_drafted boolean default false,
  outreach_approved boolean default false,
  outreach_sent boolean default false
);

create table if not exists outreach (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid references leads(id),
  draft_content text,
  status text default 'pending',
  sent_at timestamp with time zone,
  reply_received boolean default false,
  created_at timestamp with time zone default now()
);

create table if not exists agents (
  id uuid default gen_random_uuid() primary key,
  name text not null unique,
  last_run timestamp with time zone,
  leads_found integer default 0,
  status text default 'idle',
  error text,
  created_at timestamp with time zone default now()
);

-- Columns added to leads after initial creation (idempotent for existing DBs).
alter table leads add column if not exists notes text;
alter table leads add column if not exists next_action text;
alter table leads add column if not exists next_action_date timestamp with time zone;

-- ── CRM tables (contacts / deals / activities) ────────────
--
-- NOT DEPLOYED. These three tables are declared here and DO NOT EXIST in the
-- database. Verified 2026-07-29: contacts, deals and activities each return
-- PGRST205 "Could not find the table in the schema cache". This file has
-- therefore been describing a database that is not the database.
--
-- Nothing needs them. The pipeline is driven by `leads`, not by `deals` - the
-- claim below is from spec v1.0 and was never true of what was built. No code
-- path creates a contact or a deal. The one live reference, an activities
-- insert in dashboard/app/api/send-email/route.ts, was writing to a table that
-- does not exist and failing silently on every send, because a supabase-js
-- query resolves with an { error } field rather than throwing and the error was
-- never read. That insert is gone; `outreach` already records the send.
--
-- They are LEFT IN THE FILE, not deleted, because this is the spec's data model
-- and the CRM may still be built. Running this script creates them - the
-- statements are correct and idempotent - which is the intended way to adopt
-- them. Until something reads them, creating them would add three empty tables
-- and three RLS policies to maintain for no reader.
--
-- ORIGINAL INTENT (spec v1.0, not the current system):
-- The pipeline is driven by `deals`. A deal optionally links to a `lead`
-- (for the original score/source) and to a `contact` (the person).

create table if not exists contacts (
  id uuid default gen_random_uuid() primary key,
  name text,
  email text,
  phone text,
  company text,
  role text,
  source text,
  notes text,
  created_at timestamp with time zone default now()
);

create table if not exists deals (
  id uuid default gen_random_uuid() primary key,
  contact_id uuid references contacts(id),
  lead_id uuid references leads(id),
  title text not null,
  stage text default 'new_lead',
  value_estimate numeric,
  source text,
  service_tier text,
  notes text,
  next_action text,
  next_action_date timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists activities (
  id uuid default gen_random_uuid() primary key,
  deal_id uuid references deals(id),
  contact_id uuid references contacts(id),
  type text not null,
  direction text,
  subject text,
  content text,
  created_at timestamp with time zone default now()
);

-- ── Seed agent records (idempotent) ───────────────────────

insert into agents (name, status) values
  ('lead-scraper', 'idle'),
  ('indeed-scraper', 'idle'),
  ('merx-scraper', 'idle'),
  ('outreach-drafter', 'idle'),
  ('pricing-agent', 'idle'),
  ('intake-agent', 'idle'),
  ('geo-content-agent', 'idle')
on conflict (name) do nothing;

-- The source was renamed upwork-scraper -> lead-scraper. Drop the stale row so
-- re-running this file leaves the agents table showing only lead-scraper.
delete from agents where name = 'upwork-scraper';

-- ── Row Level Security ────────────────────────────────────

alter table leads enable row level security;
alter table outreach enable row level security;
alter table agents enable row level security;
alter table contacts enable row level security;
alter table deals enable row level security;
alter table activities enable row level security;

drop policy if exists "Authenticated full access" on leads;
drop policy if exists "Authenticated full access" on outreach;
drop policy if exists "Authenticated full access" on agents;
drop policy if exists "Authenticated full access" on contacts;
drop policy if exists "Authenticated full access" on deals;
drop policy if exists "Authenticated full access" on activities;

create policy "Authenticated full access" on leads
  for all using (auth.role() = 'authenticated');

create policy "Authenticated full access" on outreach
  for all using (auth.role() = 'authenticated');

create policy "Authenticated full access" on agents
  for all using (auth.role() = 'authenticated');

create policy "Authenticated full access" on contacts
  for all using (auth.role() = 'authenticated');

create policy "Authenticated full access" on deals
  for all using (auth.role() = 'authenticated');

create policy "Authenticated full access" on activities
  for all using (auth.role() = 'authenticated');

-- Note: the lead-scraper writes with the SERVICE ROLE key, which bypasses
-- RLS entirely, so the agent does not need a policy. These policies govern the
-- dashboard, which connects with the anon key as an authenticated user.
