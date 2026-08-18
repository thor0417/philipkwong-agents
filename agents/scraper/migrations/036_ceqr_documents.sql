-- 036: THE CEQR DOCUMENT INVENTORY. WHAT NEW YORK PUBLISHES BEHIND EACH REVIEW.
--
-- BLOCKING. Run this in the Supabase SQL editor. Nothing in this repo runs DDL.
--
-- WHY IT EXISTS. nyc-ceqr reads two Socrata datasets and gets six columns and a
-- milestone date. This is what those columns POINT AT: the environmental review
-- documents themselves. Measured 2026-08-18 over the 63 distinct CEQR numbers
-- the corpus holds, walked through the CEQR Access search:
--
--   detail pages reached          46 of 63   (73%)
--   documents found              330         median 3 per project, max 33
--
--   lead_agency_letter            71 docs, 45 projects   71%   pdf
--   det_significance              43        38            60%   pdf
--   eas                           43        39            62%   pdf, 1 zip
--   draft_eis                     40        15            24%   25 pdf, 15 zip
--   final_eis                     35        15            24%   19 pdf, 16 zip
--   draft_scope                   32        17            27%   pdf
--   technical_memo                27        11            17%   pdf
--   findings                      22        10            16%   pdf
--   final_scope                   16        15            24%   14 pdf, 2 zip
--
--   readable as they are         296 of 330
--   needing an unzip step         34
--
-- WHAT IS KNOWN TO BE MISSING FROM THAT TABLE. kindFromPath types a document by
-- the directory between the CEQR number and the filename, and a document filed
-- at the project ROOT has no such directory. Those are the City Planning
-- Commission reports, and they are the only documents that carry the named
-- individuals: "Applicant:" and "Applicant's Administrator:" appear on the
-- Borough President and Community Board recommendation forms appended to the
-- back of a CPC report, and nowhere in a draft scope or an EAS. The kind column
-- therefore has to be able to hold 'unfiled' and that is not a defect in the
-- schema; it is the highest-value kind and it is named rather than bucketed.
--
-- WHY ceqr AND NOT lead_id. The CEQR number is the project's identity across
-- every New York lane - it is what the ZAP cross-reference already joins on - and
-- a document exists whether or not we happen to hold a record for its project.
-- Keying on a lead would make the inventory a property of our capture rather
-- than of the city's.
--
-- WHY stored_path IS THE IDENTITY AND url IS NOT. Every document URL is signed:
--
--   /Handlers/ProjectFile.ashx?file=<base64 of the path>&signature=<sha>
--
-- The signature is issued per search session and does not survive. stored_path
-- is the server-side path the base64 decodes to and is stable, so it carries the
-- unique constraint and url is stored as CAPTURED rather than as canonical.
--
-- Two things about that path, both measured rather than assumed. The base64 is
-- not padded to a multiple of four, so it decodes to the path plus one stray
-- byte, and reading the extension off the raw decode types every archive as
-- "zip5" - which is how a first census reported 2 documents needing an unzip
-- step when the answer is 34. And ../Handlers/ resolves ABOVE the application:
-- /Handlers/ returns the PDF, /ceqr/Handlers/ returns the site's 500 page.
--
-- NOTHING PRINTS FROM THIS. The inventory exists so a reader can be pointed at
-- it and its output inspected against the documents. What reaches a client
-- document is a separate decision, taken after that.
--
-- IDEMPOTENT. Safe to run twice.

create table if not exists public.ceqr_documents (
  id            uuid primary key default gen_random_uuid(),
  -- The project's identity, e.g. '24DCP129K'. Joins to nyc-ceqr records and to
  -- the ZAP cross-reference.
  ceqr          text not null,
  -- The city's own name for the document, which is its filename without the
  -- extension. Never a title we composed.
  label         text not null,
  -- Read off the directory in stored_path. 'unfiled' means the document sits at
  -- the project root, which is where the CPC reports are.
  kind          text not null,
  -- 'pdf', 'zip'. Lower-cased, no dot, read from the path and never the label:
  -- the final scope of work carries '.zip' inside its NAME.
  extension     text,
  stored_path   text not null,
  -- Signed and expiring. Captured, not canonical. See the header.
  url           text not null,
  -- The date in the filename, which is the only date these documents carry.
  -- Null rather than guessed when the digits are not a real date: a document
  -- dated by a misread filename is worse than one with no date, because
  -- milestone order is what a reader would use it for.
  doc_date      date,
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  -- Set when a reader has been run over it, so a second pass skips what it has
  -- already read rather than re-downloading a 90MB archive. A NAMED negative in
  -- read_failure: "this is a zip and we have no unzip step" and "we have not
  -- tried" are different facts about our coverage.
  read_at       timestamptz,
  read_failure  text,
  constraint ceqr_documents_path_unique unique (stored_path)
);

comment on table public.ceqr_documents is
  'One row per document per CEQR project, from CEQR Access. Identity is stored_path: the url is signed per session and expires. kind is read from the directory in stored_path, and ''unfiled'' means the project root, which is where the City Planning Commission reports are.';
comment on column public.ceqr_documents.url is
  'Captured, not canonical. Signed per search session; re-derive by walking the search again rather than trusting a stored one.';
comment on column public.ceqr_documents.read_failure is
  'Why a document has not been read: needs-unzip, above-size-ceiling, not-a-pdf, http-500. A named negative, never null-as-untried.';

-- The two access patterns, and only these two: everything for one project, and
-- everything of one kind across projects.
create index if not exists ceqr_documents_ceqr_idx on public.ceqr_documents (ceqr);
create index if not exists ceqr_documents_kind_idx on public.ceqr_documents (kind);

-- Re-read scheduling: "documents never read, or read before X". Same shape as
-- the leads_filing_read_at_idx migration 035 added, for the same reason.
create index if not exists ceqr_documents_read_at_idx
  on public.ceqr_documents (read_at nulls first);
