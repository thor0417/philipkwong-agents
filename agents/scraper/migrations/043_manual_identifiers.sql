-- 043: manual_identifiers on projects. A hand-supplied identifier gets a home.
--
-- BLOCKING. Standing rule 5: migrations are printed for Philip to run, never run
-- from code. Nothing in this repository executes DDL.
--
-- WHY THIS EXISTS. Four routes into a project's own documents are opened by an
-- identifier that a person can find in ninety seconds and a scraper cannot
-- derive. Philip has already done this by hand for a ULURP number and nothing
-- recorded it, so it had to be done again. The membership cascade of 2026-08-22
-- is the same lesson one table over: curation with no home is curation that gets
-- destroyed, and WHICH curation was lost is not recoverable afterwards.
--
-- THE FOUR KEYS, WEIGHTED BY WHAT THEY ARE MEASURED TO BE WORTH (2026-08-23):
--
--   sch     CEQAnet. TWO projects on the identifier route, measured. The agency
--           route returns 657 Anaheim filings with 251 parcel numbers and has no
--           join to our projects, so a hand-supplied SCH is the ONLY way those
--           fields reach a project. Highest value per entry of the four.
--   apn     Clark County parses these already: 88 of 143 Nevada projects carry
--           one. Every other state carries ZERO. A hand-supplied APN is how a
--           project outside Nevada reaches an assessor at all.
--   sunbiz  Florida's registry publishes officers and a registered agent free.
--           UNPROBED against our 8 Florida applicant entities; the key exists so
--           the probe has somewhere to put its answer.
--   ulurp   EXHAUSTED as a gain route: all 28 numbers the corpus holds are
--           already published by ZAP as a field, all 13 reachable reports have
--           already been read, and 0 projects would gain a party or a decision.
--           It is here because a number Philip finds for a project ZAP does NOT
--           publish is still worth keeping, and because leaving one key out of a
--           four-key map invites a fifth column later.
--
-- SHAPE. A json object, keys from the four above, values strings. Not four
-- columns: the set will change, and a column per identifier means a migration
-- per source. Not an array: an identifier without a name is a string nobody can
-- route on.
--
--   {"sch": "2023100503", "apn": "234-161-04", "sunbiz": "L19000282957"}
--
-- COLUMN DISCIPLINE, IDENTICAL TO status. It joins PROJECT_OWNED_BY_USER in
-- agents/scraper/project-write, so every clustering payload has it stripped
-- before the write. No scrape path writes it on any row, ever. That is enforced
-- in code and asserted by verify-naming's owned-columns check, not left to care.
--
-- IT IS NOT manual_overrides AND MUST NOT BE FOLDED INTO IT. manual_overrides
-- answers "which derived fields may the clusterer not recompute" - it is a set of
-- FIELD NAMES protecting values the system also produces. manual_identifiers
-- holds values the system CANNOT produce at all. Folding the second into the
-- first would make "the clusterer must not recompute the SCH" a sentence about a
-- field the clusterer has never heard of.

alter table projects
  add column if not exists manual_identifiers jsonb;

comment on column projects.manual_identifiers is
  'Hand-supplied identifiers that open a document route: {sch, apn, sunbiz, ulurp}. '
  'Written only by a person, never by a scrape path (see PROJECT_OWNED_BY_USER in '
  'agents/scraper/project-write). Values are strings exactly as the source issues them.';

-- Read back, so the migration proves itself rather than reporting its own success:
--
--   select column_name, data_type
--     from information_schema.columns
--    where table_name = 'projects' and column_name = 'manual_identifiers';
--
--   -- expect exactly one row: manual_identifiers | jsonb
