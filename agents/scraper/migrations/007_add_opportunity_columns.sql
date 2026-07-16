-- 007: GLI Tier 1 opportunity lane columns. Biddable leisure / tourism advisory
-- solicitations (feasibility, master plan, market study, operator selection) are
-- captured on legitimacy into the GLI opportunity stream: module 'gli',
-- lead_type 'tender', stream 'opportunity'. Idempotent.
--
--  - stream: lane sub-tag within a module. 'opportunity' marks a Tier 1 biddable
--    solicitation (vs. the GLI news lane, which leaves stream null).
--  - published_date: the source's publication date (ISO text) where the source
--    exposes it (TED, IADB); null otherwise. Distinct from deadline.
alter table leads add column if not exists stream text;
alter table leads add column if not exists published_date text;
create index if not exists idx_leads_stream on leads(stream);
