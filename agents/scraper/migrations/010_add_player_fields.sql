-- 010: player fields on government (Tier 2) leads. Local-government records name
-- the people and entities: who presented, the applicant/developer, the
-- consultant/representative, and the specific approval or action sought. These
-- are DATA fields, extracted lightly from the record text and left null when
-- absent (never fabricated). Idempotent. Run before the next government scrape.
alter table leads add column if not exists presented_by text;
alter table leads add column if not exists applicant text;
alter table leads add column if not exists representative text;
alter table leads add column if not exists action_sought text;
