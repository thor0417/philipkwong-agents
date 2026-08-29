-- 046: a client is a recipient and never a publisher. Drop the brand columns.
--
-- BLOCKING. Standing rule 5: migrations are printed for Philip to run, never run
-- from code. Nothing in this repository executes DDL.
--
-- WHY THIS EXISTS. dashboard/app/(app)/reports/page.tsx resolved a document's
-- cover brand as:
--
--     const brandName = brandOverride || client?.brand_name || 'Philip Kwong';
--
-- Three sources in precedence order, with the operator's own name winning only
-- when the first two were empty. clients.brand_name for JKR & Associates held
-- 'JKR & Associates', so JKR's document was branded by JKR, to JKR - the
-- publisher and the recipient the same name. Simtec carries null and fell
-- through to the operator, which is why it survived six weeks: the defect only
-- bit the client who happened to have a brand recorded.
--
-- MEASURED 2026-08-29 over the WHOLE deliveries table, paged, no cap:
--
--     1,690 rows      1,668 'Philip Kwong'      22 'JKR & Associates'
--
-- Twenty-two delivered documents carry a client's name as their publisher. All
-- 22 went to JKR & Associates, addressed to Keith Robertson: 20 market
-- intelligence reports between 2026-08-08 and 2026-08-16, and 2 project referral
-- briefs on 2026-08-19 and 2026-08-20. (BRAND-REPORT.md said 21 from a capped
-- read of the first 1,000 of 1,690 rows, and stated the cap. The uncapped answer
-- is 22.)
--
-- WHY THE COLUMN GOES RATHER THAN THE VALUE. Blanking it leaves a loaded gun:
-- any future code that reads a column called brand_name on a client row will do
-- the wrong thing, and it will look reasonable while doing it. The edit control
-- was labelled "Brand name on documents", which is a promise the product should
-- stop making. The bug class is removed by removing the field.
--
-- EVERY READER IS ALREADY GONE, in the commit that prints this:
--
--     reports/page.tsx          brandName = OPERATOR, and the override input is
--                               DELETED rather than cleared
--     clients/page.tsx          the create form no longer collects it
--     client/[id]/page.tsx      the edit control is removed
--     lib/clients.ts            dropped from the Client type and from
--                               CLIENT_COLUMNS, so the select does not ask for it
--     scripts/generate.ts       --brand flag and DEFAULT_BRAND both removed
--     scripts/client-reports.ts reads OPERATOR
--     scripts/exclusion-audit.ts three fixtures read OPERATOR
--     lib/report-build.ts       THROWS if a brand reaches it that is not the
--                               operator's, naming the recipient-derivation case
--
-- Run 1 and 2 in either order. Nothing reads either column.

-- ---- 1. THE CLIENT COLUMN. This is the one that shipped 22 documents. -------

alter table public.clients drop column if exists brand_name;

-- ---- 2. THE PIPELINE COLUMNS -----------------------------------------------
--
-- pipelines.brand_name held 'JKR & Associates' on the hospitality row - a CLIENT
-- name on the row for the pipeline that serves several of them - and
-- dashboard/lib/brand.ts built every records-export delivery line from it as
-- "Philip Kwong / JKR & Associates". That reached the export's cover, its page
-- footer and the workbook's own file metadata, for whoever ran the export.
--
-- BRAND-REPORT.md proposed blanking these and dropping them in a later migration
-- "once no reader remains". No reader remains as of this commit, so both
-- statements are here. They are separate from statement 1 on purpose: if you
-- would rather keep the columns for now, run 1 and skip 2 - nothing reads them
-- either way, and the 22 documents are fixed by 1 alone.
--
-- brand_logo goes with it. jkr-logo.png in the repo root is a CLIENT's logo and
-- does not belong on the operator's document either.

update public.pipelines set brand_name = null, brand_logo = null;

alter table public.pipelines drop column if exists brand_name;
alter table public.pipelines drop column if exists brand_logo;

-- ---- 3. deliveries.brand_name STAYS, and that is deliberate ----------------
--
-- It is the record of what was actually printed on a document that left the
-- building. Dropping it would erase the only evidence that the 22 happened, and
-- standing rule 6 says nothing is hard deleted. It is written from
-- lib/operator.ts now, so it cannot take a client's name again.

-- ---- READ IT BACK. Standing rule 11. ---------------------------------------
--
-- Expect: no rows from the first (both columns gone from information_schema),
-- and the second returns the two clients with no brand column to show.

select table_name, column_name
  from information_schema.columns
 where table_schema = 'public'
   and column_name in ('brand_name', 'brand_logo')
 order by table_name, column_name;
-- EXPECT exactly one row: deliveries / brand_name.

select name, status, addressee, cadence, next_delivery
  from public.clients
 order by name;
-- EXPECT two rows, JKR & Associates and Simtec Attractions, and no brand column.

-- NOTE for anyone re-running an old migration by hand: 045's read-back select
-- names brand_name on public.clients and will now fail. 045 has already been
-- applied; it is a record of what was run, not a script to run again.
