-- 028: PROJECT SUMMARY. One line saying what the project actually is.
--
-- WHY. A project name is derived from its best available identifier, which is
-- often an address or an applicant, so the register is full of rows whose name
-- says where something is and nothing about what it is. "Busters Marine Bronx
-- Marina" gives no indication that its records concern a joint public hearing
-- for an outdoor cafe concession in WNYC Transmitter Park. "2510 Coney Island
-- Avenue Rezoning" does not say it is an eleven-storey mixed-use building.
--
-- The name answers "which one". The summary answers "what is it", and a
-- register that cannot answer the second is a list of addresses.
--
-- TWO COLUMNS, NOT ONE, because how a sentence was produced changes how much it
-- can be trusted and therefore what may be done with it.
--
--   summary         the sentence itself.
--   summary_source  'derived' | 'generated' | 'manual'
--
--     derived    lifted from the record's own words - a ZAP project brief, a
--                CEQR project description, the "relative to:" clause of an FCRC
--                notice. This is a quotation, trimmed, and it is the preferred
--                form: the filing already contains the sentence.
--     generated  written by a model from the record text because no source
--                sentence was usable. Factual only: what is sought and for
--                what. No assessment, no adjectives, no speculation.
--     manual     Philip wrote it. Never recomputed, never overwritten. This is
--                enforced by manual_overrides (the same mechanism that protects
--                name, stage and venue_type), and the column exists so the
--                register can SHOW that a human wrote this one.
--
-- The distinction is not decoration: a generated line is a model's reading of a
-- document and a derived line is the document. A client-facing surface that
-- cannot tell them apart cannot decide which to quote.
--
-- WHY NOT A VIEW. The summary is expensive to produce (the generated ones cost
-- a model call) and is read on every register row, every detail pane, every
-- project page and every report line. Recomputing it per read would make the
-- register's cost scale with how often it is looked at.
--
-- NULL IS AN ANSWER, and the derivation must leave it null rather than emit a
-- sentence it cannot support. A project whose only record is a meeting agenda
-- has nothing honest to say about what it is.
--
-- Idempotent. Run in the Supabase SQL editor. No DDL is ever run from code.

alter table projects add column if not exists summary text;
alter table projects add column if not exists summary_source text;

-- The vocabulary is closed. A value outside it means a writer invented one.
alter table projects drop constraint if exists projects_summary_source_check;
alter table projects add constraint projects_summary_source_check
  check (summary_source is null or summary_source in ('derived', 'generated', 'manual'));

-- A summary without a provenance, or a provenance without a summary, is a row
-- that cannot be rendered honestly. Kept as a check rather than left to the
-- writers, because there are three of them (the clusterer, the backfill and the
-- dashboard's manual edit) and they will not stay in agreement on their own.
alter table projects drop constraint if exists projects_summary_pairing_check;
alter table projects add constraint projects_summary_pairing_check
  check ((summary is null) = (summary_source is null));

comment on column projects.summary is
  'One line: what is being sought and for what. Never an assessment.';
comment on column projects.summary_source is
  'derived (quoted from the filing) | generated (model, factual) | manual (Philip wrote it; never recomputed)';
