-- ============================================================================
-- PROPOSED. DO NOT RUN. This file is the Part 8 deliverable: the shape that
-- would separate a universal pattern from its welded-on specific instance. It
-- is deliberately unnumbered so it cannot be mistaken for a ready migration,
-- and nothing in the codebase reads any of these tables.
--
-- It is printed rather than applied because moving this data out of TypeScript
-- is a change to how the SYSTEM IS CONFIGURED, not a bug fix, and it should be
-- decided on its own rather than smuggled in behind a foundations brief.
-- ============================================================================
--
-- WHAT THE AUDIT FOUND. Eight places where a jurisdiction, project or party
-- name lives in code. Three are genuinely bespoke and should STAY in code; five
-- are a universal pattern with a specific instance welded on, and those are the
-- ones below.
--
-- STAYING IN CODE, and why:
--   CFTOD structural headers (pdf-agenda)   parser vocabulary bound to one
--                                           document FORMAT, not to a market
--   Clark County civic-venue regex          near-universal US civic wording
--                                           that happens to have been found in
--                                           Clark County
--   Anaheim Spanish fiscal terms            bound to a jurisdiction's PUBLISHING
--                                           LANGUAGE; a table would add
--                                           indirection without removing a
--                                           commit when the wording changes
--
-- Each of those is a parser detail. Putting a regex in a table does not make it
-- config; it makes it a regex that is harder to find.

-- ---------------------------------------------------------------------------
-- 1. MARKETS. Replaces lib/geography's CONFIGURED_JURISDICTIONS (17 entries),
-- US_SUBREGIONS (8), METRO_REGIONS (4) and MARKET_ALIASES (3), plus the
-- jurisdiction lists inside sources/legistar and sources/govdocs.
--
-- This is the table that answers the eleventh-market question. Today adding
-- Tampa needs two code changes; with this it needs two INSERTs.
--
-- pipeline_id, because a market belongs to a line of business: the hospitality
-- pipeline watches Clark County, a future pipeline would watch somewhere else,
-- and run scoping should not offer markets that the active pipeline has no
-- source for.
-- ---------------------------------------------------------------------------
create table if not exists markets (
  id            text primary key,              -- 'clark-county-nv'
  label         text not null,                 -- 'Clark County, NV'  (what adapters emit)
  pipeline_id   text not null references pipelines(id),
  country       text not null,
  region_state  text,                          -- 'Nevada'
  -- A market that stands in for a region when a source names no state
  -- ("Burnaby, Greater Vancouver"). Replaces METRO_REGIONS.
  metro_of      text references markets(id),
  active        boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamp with time zone default now()
);

-- Replaces MARKET_ALIASES and the CONFIGURED_JURISDICTIONS synonyms ('city of
-- anaheim' and 'anaheim' are one market; 'Las Vegas Strip' is Las Vegas).
-- Separate rows rather than an array column so an alias can be added without
-- rewriting the market, and so run scoping can match on it directly.
create table if not exists market_aliases (
  market_id  text not null references markets(id),
  alias      text not null,
  primary key (market_id, alias)
);

-- Which adapter reaches a market, and how. Replaces DEFAULT_JURISDICTIONS in
-- sources/legistar (6 rows) and the jurisdictionLabel field in GOV_DOCUMENTS.
--
-- `config` is jsonb because each adapter needs a different key: Legistar needs
-- its client subdomain, an agenda portal needs a ViewPublisher URL, CEQAnet
-- needs a LeadAgency query string. A column per adapter would be a column per
-- adapter forever.
create table if not exists market_sources (
  market_id  text not null references markets(id),
  source     text not null,                    -- 'legistar', 'agenda-portal'
  config     jsonb not null default '{}'::jsonb, -- {"client": "clark"}
  active     boolean not null default true,
  -- Why this market is watched. DEFAULT_JURISDICTIONS carries this today as a
  -- `reason` field and it is worth more than the row it sits on: it is the only
  -- record of why anyone pointed a lane here.
  reason     text,
  primary key (market_id, source)
);

-- ---------------------------------------------------------------------------
-- 2. CASE RULES. Replaces CASE_RULES in agents/scraper/cluster.ts (5 rules,
-- 12 patterns). The RULE is universal - "a recurring matter identifier, per
-- jurisdiction" - and the patterns are irreducibly per-market.
--
-- Patterns as text, compiled at load. This is the entry in this file I am least
-- sure about: a regex in a database is a regex nobody can grep for, and these
-- were each derived by measurement against real filings. The honest tradeoff is
-- that market eleven needs a case rule, and today that is a commit.
-- ---------------------------------------------------------------------------
create table if not exists case_rules (
  id          uuid primary key default gen_random_uuid(),
  market_id   text not null references markets(id),
  label       text not null,
  patterns    text[] not null,
  active      boolean not null default true,
  created_at  timestamp with time zone default now()
);

-- ---------------------------------------------------------------------------
-- 3. WATCH TARGETS. Replaces TARGETS in agents/scraper/targets.ts, including
-- DISNEY_GEOGRAPHIC, weakForClustering and districtTerms - which are not three
-- concepts but ONE: a term, and how strongly it may be used.
--
-- That is the insight worth keeping from the audit. Today those live as three
-- separate structures (a bypass array, a weak array, a district array, plus a
-- module-level Set), and every consumer has to know all four. As rows they are
-- one table with a `kind`, and a consumer asks for the kinds it trusts.
-- ---------------------------------------------------------------------------
create table if not exists watch_targets (
  id            uuid primary key default gen_random_uuid(),
  pipeline_id   text not null references pipelines(id),
  name          text not null,                 -- 'Heart Hotel / Kulik River'
  -- True when the target names a PORTFOLIO rather than one project, so it
  -- clusters per market (Disney is the case: Anaheim, CFTOD and SFWMD are three
  -- different projects sharing a corporate parent).
  per_market    boolean not null default false,
  market_names  jsonb,                         -- {"Anaheim": "Disneyland Resort"}
  active        boolean not null default true,
  created_at    timestamp with time zone default now()
);

create table if not exists target_terms (
  target_id  uuid not null references watch_targets(id),
  term       text not null,
  -- bypass      admits a record through the gate AND can claim it for the target
  -- search      reporting only, never admits             (searchOnly today)
  -- weak        admits nothing on its own, cannot claim   (weakForClustering)
  -- district    claims normally, refused on fiscal/ballot (districtTerms)
  -- geographic  the source's own address, not a signal    (DISNEY_GEOGRAPHIC)
  kind       text not null,
  primary key (target_id, term, kind)
);

-- ============================================================================
-- WHAT THIS DOES NOT FIX, stated so the shape is not oversold.
--
-- Adding an eleventh market that is NOT on an already-supported portal still
-- needs a new ADAPTER: several hundred lines, its own health unit, its own gate
-- wiring. No table here removes that, and it is the real cost of market eleven.
--
-- These tables also do nothing for the two failures the isolation test found in
-- lib/taxonomy: the gate vocabulary and the venue taxonomy are single global
-- constants with no pipeline dimension. A second LINE OF BUSINESS needs its own
-- of both, and that is a larger change than market config.
-- ============================================================================
