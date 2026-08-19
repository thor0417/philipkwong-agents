-- 038: projects.name_source may say 'manual'. Blocking, run before the next
-- clustering run, though nothing breaks if it is late: this migration changes a
-- COMMENT and nothing else. The column is plain text and carries no CHECK
-- constraint, so 'manual' already stores. What is wrong today is the comment,
-- which enumerates the vocabulary and would leave the next reader believing
-- 'manual' is a stray value somebody typed.
--
-- WHY. name_source answers WHICH RULE PRODUCED projects.name. After a hand
-- rename every automatic answer to that question is false: manual_overrides held
-- 'name' back on every clustering run and name_source was not held with it, so
-- the column went on reporting the rule the correction had REPLACED. RDXNWP was
-- renamed to Spring Valley Ice Rink and name_source still read 'applicant', of a
-- name that appears in no applicant field.
--
-- The identical pair, summary and summary_source, has been held together in
-- project-write since it was written. This half was missed.
--
-- 'manual' IS NOT PROVISIONAL, and that is the point. isProvisionalName is false
-- for it, so a project renamed off a provisional title becomes printable to a
-- client - which is the reason one is renamed by hand at all. A rule that still
-- withheld it would make the correction useless.
--
-- Idempotent. Run in the Supabase SQL editor. No DDL is ever run from code.

comment on column projects.name_source is
  'Which naming rule produced projects.name: target, source, programme, '
  'applicant, site or title. Or ''manual'', which is not a rule but Philip: a '
  'hand-rename, protected by manual_overrides.name, and never written by any '
  'clustering run. Null means the row predates the column. A name sourced from '
  'a title is a cleaned agenda line and should be treated as provisional '
  'wherever it is shown to a client; a manual one never is.';

-- What it looks like afterwards.
select
  coalesce(name_source, '(null)') as name_source,
  count(*)                        as projects,
  count(*) filter (where manual_overrides ? 'name') as hand_named
from projects
where module = 'gli' and status <> 'dismissed'
group by 1
order by 2 desc;
