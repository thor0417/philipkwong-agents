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

-- Notes column for existing leads tables created before this column was added.
alter table leads add column if not exists notes text;

-- ── CRM tables (contacts / deals / activities) ────────────
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
