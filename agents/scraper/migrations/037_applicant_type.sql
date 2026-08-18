-- 037: THE APPLICANT'S TYPE, AS A COLUMN THE DOCUMENT LAYER CAN READ.
--
-- BLOCKING. Run this in the Supabase SQL editor. Nothing in this repo runs DDL.
--
-- WHY IT EXISTS. ZAP publishes applicant_type beside primary_applicant, and the
-- nyc-zap adapter already captures both - but it writes the type into
-- raw_content as the prose line "Applicant type: Private". Nothing can query
-- that, and the report layer never selects raw_content at all: it runs to 20,000
-- characters and no document prints it, so RECORD_COLUMNS deliberately excludes
-- it. The value is in the corpus and is unreachable from the one layer that
-- needs it.
--
-- WHAT IT IS FOR. A public agency applicant is a TRUE FACT about a project and
-- is not a party in the sense a referral brief means: somebody to call about a
-- development. Measured 2026-08-18 over the 39 live nyc-zap records:
--
--   Private               30
--   Other Public Agency    7
--   DCP                    2
--
-- Those 9 are EDC, HPD, the Department of Citywide Administrative Services and
-- the Department of City Planning, sitting in `applicant` and printing as named
-- parties today.
--
-- THE VALUE IS KEPT AND THE PRINT IS GATED. Nulling `applicant` would delete a
-- true fact from the register to fix a display rule. The officials rule is about
-- what a DOCUMENT prints, never about what the corpus holds. So the type is
-- stored, and lib/people declines to name a public-agency applicant as a party
-- while the record keeps it.
--
-- NOT INFERRED FROM THE NAME. "EDC - Economic Development Corporation for NYC"
-- looks like an agency and "Queens Future, LLC" does not, but a name-shape rule
-- is exactly the defect this repo already has a golden case for - a label read
-- as the thing it names. The source states the type; we store what it states.
--
-- NULL IS THE HONEST DEFAULT. Every source other than ZAP publishes no applicant
-- type at all, and null means "the source did not say", never "private".
--
-- IDEMPOTENT. Safe to run twice.

alter table public.leads add column if not exists applicant_type text;

comment on column public.leads.applicant_type is
  'The applicant''s type as the SOURCE states it, e.g. ZAP''s Private / Other Public Agency / DCP. Never inferred from the name. NULL means the source did not say, not that the applicant is private. Read by the document layer to decide whether an applicant is printed as a named party; the applicant column itself is never nulled on account of it.';

-- The document layer filters on it per record, alongside project_id.
create index if not exists leads_applicant_type_idx
  on public.leads (applicant_type)
  where applicant_type is not null;
