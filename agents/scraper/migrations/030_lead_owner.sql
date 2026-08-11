-- 030: leads.owner. The party a filing names as owning the site.
--
-- WHY THIS ONE AND NOT THE OTHER THREE. Four roles were proposed - owner,
-- architect, awardee and lead agency. Measured across the corpus first, and
-- three of them are schema for data that does not exist:
--
--   ARCHITECT   0 labelled hits anywhere. 8 bare mentions in 411 records, of
--               which 5 are firm-shaped, and one of those is an agenda item
--               titled "Celebrating Las Vegas Architecture". No jurisdiction
--               publishes a design team in what we fetch. The architect is on
--               the stamped plan set, which is a different capability.
--   AWARDEE     1 hit, corpus-wide.
--   LEAD AGENCY 74 hits, and every one of them duplicates presented_by, which
--               is already filled on 45 of 46 CEQR records with exactly that
--               value. A column that restates a column we already render is
--               schema debt.
--
--   OWNER       18 hits, all agenda-portal / Las Vegas, and NOT duplicated by
--               any column we hold. "OWNER: DENTAL TRAINING CENTER & DIGITAL
--               LAB, INC." is the site owner on an entitlement whose applicant
--               is somebody else, which is exactly the distinction the July
--               standard prints and we currently cannot.
--
-- WHAT IT IS FOR. An entitlement filed by a developer on land somebody else
-- owns has two commercially different parties, and today they collapse into
-- one. The people section can name both once this exists.
--
-- NULLABLE, AND NULL MEANS THE RECORD DID NOT SAY. It does not mean the
-- applicant owns the site. Nothing infers an owner from an applicant, from a
-- firm name, or from an address.
--
-- Idempotent. Run in the Supabase SQL editor. No DDL is ever run from code.

alter table leads add column if not exists owner text;

comment on column leads.owner is
  'The party a filing names as owning the site, verbatim from an OWNER label. '
  'Null means the record did not state one, never that the applicant owns it. '
  'Populated by agents/scraper/migrations/backfill-owner.ts and by the '
  'government lane on write.';

-- Only where a value exists, so the index stays small: 18 of ~1,700 rows carry
-- one today, and a full index would be almost entirely nulls.
create index if not exists leads_owner_idx on leads (owner) where owner is not null;

-- What it looks like afterwards. Both should read 0 before the backfill runs.
select
  count(*)                                as leads_total,
  count(*) filter (where owner is not null) as with_owner
from leads;
