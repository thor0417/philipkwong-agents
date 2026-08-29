-- 047: a delivery row that changes without saying so is the defect one layer down.
--
-- BLOCKING. Standing rule 5: migrations are printed for Philip to run, never run
-- from code. Nothing in this repository executes DDL.
--
-- WHY THIS EXISTS. Twenty-two delivered documents were published under the name
-- of the client who received them (see 046 for the mechanism and the counts).
-- They have to be corrected, and the obvious correction - update the 22 rows to
-- say 'Philip Kwong' - is the same class of error one level down: the permanent
-- record of what was actually sent would quietly become a record of what we
-- wish had been sent, and nothing anywhere would say a correction happened.
--
-- So brand_name is never touched. It keeps saying 'JKR & Associates', because
-- that is what was printed. These four columns record that we know, what it said
-- before, when we corrected it, and what the correction actually was.
--
-- WHY A NOTE RATHER THAN A FLAG. The correction is not a reprint and must not
-- read as one:
--
--   THE ORIGINAL FILES WERE NEVER STORED. deliveries.file_path holds a
--   FILENAME, not a path - documents are streamed to the browser and nothing is
--   kept server-side - so the original bytes cannot be corrected. A new document
--   has to be built over the same scope.
--
--   AND THE CORPUS HAS MOVED. A document built today over July 2026 contains
--   records captured since August. The reissue is a NEW document over the same
--   scope and period window, and the note says exactly that rather than letting
--   a reader assume otherwise.
--
--   AND THE PERIOD TOKEN WOULD HAVE LIED. Most of the 22 stored a RELATIVE
--   token: 'last-month', 'this-month'. Re-resolving one today gives a different
--   window and therefore a different document, while looking like a faithful
--   reissue. period_start and period_end are stored absolute on the row and are
--   what the rebuild uses; the token is a label. Same shape as every other
--   defect here - a label read as the thing it names.

-- ---- THE COLUMNS -----------------------------------------------------------

alter table public.deliveries add column if not exists corrected_at timestamptz;
alter table public.deliveries add column if not exists corrected_from_brand text;
alter table public.deliveries add column if not exists correction_note text;

-- The reissue's own delivery row points back at the row it supersedes, so the
-- chain reads in both directions. Null on every row that is not a reissue.
alter table public.deliveries
  add column if not exists correction_of uuid references public.deliveries(id);

comment on column public.deliveries.corrected_at is
  'When this delivery was recorded as needing correction. brand_name is NEVER rewritten: it is the record of what was printed.';
comment on column public.deliveries.corrected_from_brand is
  'The brand this document actually went out under, copied here when the correction is recorded so the fact survives even if brand_name is ever touched.';
comment on column public.deliveries.correction_note is
  'What the correction was, in a sentence a reader can act on. States that a reissue is a new document over the same scope rather than a reprint.';
comment on column public.deliveries.correction_of is
  'On a reissue row: the delivery it supersedes. Null on an original.';

-- Finding the corrected set later should not be a table scan of a text column.
create index if not exists idx_deliveries_corrected
  on public.deliveries (corrected_at)
  where corrected_at is not null;

-- ---- READ IT BACK. Standing rule 11. ---------------------------------------
--
-- Expect four rows from the first select, and 22 rows / 0 corrected from the
-- second until `APPLY=1 npx tsx scripts/reissue-misbranded.ts --out=...` runs.

select column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'deliveries'
   and column_name in ('corrected_at', 'corrected_from_brand', 'correction_note', 'correction_of')
 order by column_name;

select brand_name,
       count(*)                                    as rows,
       count(*) filter (where corrected_at is not null) as corrected
  from public.deliveries
 group by brand_name
 order by rows desc;
-- EXPECT, before the script runs:  Philip Kwong 1668 / 0 corrected
--                                  JKR & Associates 22 / 0 corrected
-- EXPECT, after:                   JKR & Associates 22 / 22 corrected,
--                                  and brand_name STILL reading JKR & Associates.
