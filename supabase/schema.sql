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

-- ── Row Level Security ────────────────────────────────────

alter table leads enable row level security;
alter table outreach enable row level security;
alter table agents enable row level security;

drop policy if exists "Authenticated full access" on leads;
drop policy if exists "Authenticated full access" on outreach;
drop policy if exists "Authenticated full access" on agents;

create policy "Authenticated full access" on leads
  for all using (auth.role() = 'authenticated');

create policy "Authenticated full access" on outreach
  for all using (auth.role() = 'authenticated');

create policy "Authenticated full access" on agents
  for all using (auth.role() = 'authenticated');

-- Note: the upwork-scraper writes with the SERVICE ROLE key, which bypasses
-- RLS entirely, so the agent does not need a policy. These policies govern the
-- dashboard, which connects with the anon key as an authenticated user.
