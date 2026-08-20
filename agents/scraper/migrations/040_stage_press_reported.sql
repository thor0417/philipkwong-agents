-- 040: projects.stage_press_reported. What the PRESS says the stage is, when
-- that is further along than any captured filing supports.
--
-- BLOCKING for the entry line only. The stage rule itself is already live and
-- does not need this: Heart Hotel / Kulik River reads 'filed' today, which is
-- what its filings support. This column is how a document says the other half.
--
-- WHY A COLUMN AND NOT A DERIVATION. provenStage decides this while clustering,
-- from every record on the project and the ladder vocabulary in lib/taxonomy.
-- The report renders in the dashboard, which is a separate package and keeps a
-- 249-line hand mirror of that 1400-line file. Re-deriving the answer there
-- would mean copying STAGE_ACTION_TERMS and recordStage into the mirror, and a
-- mirrored copy is a copy that goes stale - which is the defect this repo has
-- already paid for more than once. The fact is a property of the project, so it
-- is stored on the project.
--
-- WHAT GOES IN IT. A ladder stage, or null. Null means the press says nothing
-- more than the filings do, which is the case for 137 of the 138 live projects.
-- It is NEVER the project's stage: projects.stage is what our captured filings
-- support and nothing else writes it.
--
-- Heart Hotel / Kulik River is the one project that gets a value today:
-- stage 'filed', stage_press_reported 'approved', from fifteen publications
-- against eight filings that show holdover applications, a staff recommendation
-- OF approval, and a hearing held to 07/22/26.
--
-- Written by the clusterer on every run, like stage itself, and held back by
-- manual_overrides.stage exactly as stage is - the two move together or a hand
-- correction would be contradicted by a press line the reader trusts equally.
--
-- Idempotent. Run in the Supabase SQL editor. No DDL is ever run from code.

alter table projects add column if not exists stage_press_reported text;

comment on column projects.stage_press_reported is
  'The ladder stage the NON-FILING records support, when it is further along '
  'than any captured filing supports. Null when the press says nothing more, '
  'which is the normal case. Never the project stage: projects.stage is what '
  'the filings support. An entry prints both and attributes each, so a reader '
  'can tell what a government body did from what a publication reported.';

-- What it looks like afterwards. Reads 0 until the next clustering run.
select
  count(*)                                                as live_projects,
  count(*) filter (where stage_press_reported is not null) as with_a_press_stage
from projects
where module = 'gli' and status <> 'dismissed' and stage <> 'dormant';
