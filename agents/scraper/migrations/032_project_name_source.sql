-- 032: projects.name_source. Which rule produced a project's name.
--
-- WHY. ClusteredProject has carried name_source since naming was written, and
-- deriveProjectName sets it on every cluster run. projectRow has never included
-- it, and the column has never existed, so the value is computed and dropped
-- roughly 319 times per run. Measured: 319 of 319 projects report null.
--
-- WHAT IT COSTS US. The register cannot show how confident a name is. These are
-- indistinguishable today:
--
--   "OCVibe"                                   the project's actual name
--   "Buona Vita resort"                        an applicant plus a venue word
--                                              that no record supports
--   "REFRIGERATION SUPPLIES DISTRIBUTOR:       a cleaned agenda line
--    DESIGN REVIEW for a proposed"
--
-- A client document prints all three the same way. With the source stored, a
-- name derived from a target term can be printed plainly, and a name derived
-- from a title can be marked as provisional or suppressed.
--
-- VALUES. The NameSource union in agents/scraper/project-naming: 'target',
-- 'applicant', 'site', 'title'. Text rather than an enum, because the naming
-- rules are still moving and an enum makes adding one a migration.
--
-- NULL means the row predates this column, never that the name has no source.
--
-- Idempotent. Run in the Supabase SQL editor. No DDL is ever run from code.

alter table projects add column if not exists name_source text;

comment on column projects.name_source is
  'Which naming rule produced projects.name: target, applicant, site or title. '
  'Written by the clusterer on every run. Null means the row predates the '
  'column. A name sourced from a title is a cleaned agenda line and should be '
  'treated as provisional wherever it is shown to a client.';

-- What it looks like afterwards. with_source reads 0 until the next cluster run.
select
  count(*)                                      as projects_total,
  count(*) filter (where name_source is not null) as with_source
from projects;
