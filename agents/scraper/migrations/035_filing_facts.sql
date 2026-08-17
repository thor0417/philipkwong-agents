-- 035: WHAT A FILING STATES ABOUT ITSELF, READ OUT OF ITS OWN DOCUMENT.
--
-- BLOCKING. Run this in the Supabase SQL editor before anything can store what
-- filing-facts reads. Nothing in this repo runs DDL.
--
-- WHY IT EXISTS. Measured 2026-08-17 over 155 readable documents in seven
-- jurisdictions: the material a client document is missing is not in press, and
-- it is not in the attachments we skip. It is in the staff reports we ALREADY
-- FETCH, ALREADY PARSE TO TEXT, and read for three contact labels and nothing
-- else. The documents the extractor drops as drawings carry a median of 1,035
-- characters against 9,583 for the ones it opens, and every content signal is
-- LESS common in them.
--
-- Over 18 unique Clark County agenda sheets, the reader verifies:
--
--   staff recommendation    100%      land use plan        100%
--   TAB/CAC town board      100%      APN                  100%
--   site acreage             89%      project type          67%
--   zone                     61%      floor area by use     56%
--   conditions of approval   72%      parking required/provided  50%
--   site address             50%      storeys and height    44% each
--   held to <date>           50%      cross streets / town  39%
--   commission action        28%      next hearing          22%
--
-- WHY A COLUMN AND NOT raw_content, the same argument migration 034 made and it
-- still holds: raw_content is READ BY THE SYSTEM. recordStage derives a stage
-- from it, project-naming derives a NAME from it, and the two-tier gate decides
-- admission on it. Appending a conditions list and a parcel number to it would
-- silently re-stage, re-name and re-gate the corpus.
--
--   filing_facts        the array of {kind, label, display, value, line, group}.
--                       display is verbatim from the document and is verified to
--                       appear in it, and in the line stored beside it, before
--                       any write.
--   filing_read_at      when the document was last read, so a re-read can be
--                       scheduled rather than repeated on every run.
--   filing_form         which form was recognised ('clark-agenda-sheet'), or the
--                       reason none was. A NAMED negative: "this county
--                       publishes a form we do not read" and "we have not tried"
--                       are different facts about our coverage.
--
-- NOTHING PRINTS FROM THIS YET. The columns exist so the reader can be run and
-- its output inspected against the documents. What reaches a client document is
-- a separate decision, taken after the numbers above are read.
--
-- IDEMPOTENT. Safe to run twice.

alter table public.leads add column if not exists filing_facts   jsonb;
alter table public.leads add column if not exists filing_read_at timestamptz;
alter table public.leads add column if not exists filing_form    text;

comment on column public.leads.filing_facts is
  'Array of {kind, label, display, value, line, group} read out of the record''s own primary document. label is the word the DOCUMENT used. display is verbatim and is verified to appear both in the document and in the line stored beside it. Never a party: contacts are owned by sources/contact-labels.';
comment on column public.leads.filing_form is
  'The document form recognised, e.g. clark-agenda-sheet, or a named negative: no-document, unreadable-scan, form-not-supported.';

-- Re-read scheduling reads this, and it is the only access pattern: "records
-- with a document that have never been read, or were read before X".
create index if not exists leads_filing_read_at_idx
  on public.leads (filing_read_at nulls first)
  where has_primary_document = true;
