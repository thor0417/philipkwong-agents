// MOVED TO root lib/degraded-sources.ts.
//
// The register is read by the dashboard's Health screen as well as by the
// scraper, and this module could not be imported from there: it took its
// verdict type from ./health, which imports lib/supabase-admin and therefore
// the SERVICE ROLE KEY. Rather than mirror the register into dashboard/lib and
// let two copies of "which sources are known to be broken" drift apart, it went
// to root lib/ beside lib/dead-feeds, which answers the neighbouring question
// and is import-free for the same reason.
//
// This file stays as the scraper's door onto it, so every existing import path
// in agents/ is unchanged.

export type {
  DegradedSource,
  DegradedMatch,
  HealthVerdict,
} from '../../lib/degraded-sources';
export {
  DEGRADED_SOURCES,
  degradedEntry,
  suppressesAlert,
  ageInDays,
} from '../../lib/degraded-sources';
