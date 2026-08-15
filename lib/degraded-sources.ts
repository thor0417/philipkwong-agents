// THE KNOWN-DEGRADED REGISTER.
//
// IN ROOT lib/ AND IMPORT-FREE, for the same reason lib/dead-feeds is: it is
// read by the scraper AND by the dashboard's Health screen, and a mirrored copy
// would drift with the divergence landing in what a client is told about a
// market. See the note on HealthVerdict below for why it could not stay in
// agents/scraper.
//
// An alarm that fires every day for a condition nobody intends to fix this week
// is not an alarm. It is a training exercise in ignoring alarms, and it costs
// more than silence would, because it buries the one alert that is new.
//
// Measured: 194 alarm events in a week, attributed to two documented failures
// that have not changed since the day they were diagnosed. Checking them against
// a live run found that only ONE of the two is still real - Las Vegas PrimeGov
// is still behind Cloudflare (HTTP 403), while Anaheim's hosts have recovered
// and are not alerting at all. See the note below the register.
//
// That is the second argument for writing conditions down with a date: an
// unwritten one cannot be checked, and this one had already expired.
//
// So a degraded source is DECLARED here, with four things:
//
//   1. the health unit it applies to, exactly as the lane names it
//   2. why it is degraded, in a sentence a reader can act on
//   3. the date the condition was recorded, so staleness is visible
//   4. THE CONDITION UNDER WHICH IT ALERTS AGAIN
//
// The fourth is the one that makes this safe. A suppression with no expiry is
// how a source dies twice: once when it breaks, and once when it quietly starts
// working differently and nobody hears about it. So an entry does not say "stay
// quiet about this unit". It says "I expect exactly this failure; tell me the
// moment it is anything else."
//
// Concretely: an entry declares the verdict it expects while the condition
// holds. If the observed verdict matches, the run report and the Health surface
// still show it - it is never hidden, only de-escalated - and no alarm is
// paged. If the observed verdict is ANYTHING else, including recovery, that is
// news and the alarm fires. A source that starts returning records after
// being dead is exactly the case the brief names, and it alerts.
//
// NOTHING HERE SUPPRESSES A NEW FAILURE. Only the named unit, only the named
// verdict.

// THE VERDICT TYPE LIVES HERE NOW, AND health.ts RE-EXPORTS IT.
//
// The dependency was the other way round and it is why this file could not be
// read by the dashboard: agents/scraper/health.ts imports lib/supabase-admin,
// which carries the SERVICE ROLE KEY. A dashboard component reaching for the
// degraded register would have pulled that key's module into a browser bundle,
// which is the one thing CLAUDE.md says never to do.
//
// So the register moved to root lib/ and became import-free, exactly like
// lib/dead-feeds - the two files answer neighbouring questions and now live
// beside each other. health.ts still owns everything that COMPUTES a verdict;
// it simply no longer owns the name of one.
export type HealthVerdict =
  // Produced records. Nothing to say.
  | 'ok'
  // Fetched nothing at all. Total death: the source is unreachable, blocked, or
  // returning an empty document. Loudest.
  | 'no-fetch'
  // Fetched records and kept none, against a history of keeping some. The
  // Granicus and CFTOD failure.
  | 'zero-kept'
  // Fetched and kept nothing, with no history to compare against. Reported at a
  // lower level: it may simply be a new source, or a genuinely quiet week.
  | 'zero-no-baseline';

export interface DegradedSource {
  // The health unit this covers, as the lane names it ('adapter:lasvegas-
  // agendas', 'source:legistar'). Matched exactly unless `prefix` is set, which
  // exists for units that carry a document title (the CFTOD packet extractor
  // registers one unit per packet).
  unit: string;
  prefix?: boolean;
  // Why it is degraded. A sentence, not a code.
  reason: string;
  // When the condition was recorded. ISO date, so an entry that has sat here for
  // a year is visibly a year old.
  recorded: string;
  // THE EXPECTED FAILURE. While the unit produces exactly this verdict, the
  // condition is unchanged and no alarm is raised. Any other verdict - better
  // or worse - is a change, and a change alerts.
  expect: HealthVerdict;
  // What would make this alert again, in plain words, for the run report.
  alertsAgainWhen: string;
}

// ORDER IS IRRELEVANT; each entry stands alone.
export const DEGRADED_SOURCES: DegradedSource[] = [
  {
    unit: 'adapter:lasvegas-agendas',
    reason:
      'City of Las Vegas PrimeGov is behind Cloudflare. The public JSON API at ' +
      'lasvegas.primegov.com returns an interstitial challenge rather than the ' +
      'meeting list, so the adapter lists zero meetings and fetches nothing. ' +
      'Diagnosed and written up in sources/lasvegas; not fixable without a ' +
      'headless browser, which is the same call already made for MERX.',
    recorded: '2026-08-03',
    expect: 'no-fetch',
    alertsAgainWhen:
      'PrimeGov returns any meeting at all - the challenge has lifted or a ' +
      'route around it exists, and the lane should be believed again.',
  },
  {
    // Matched as a prefix: the extractor names its unit after the document, and
    // the year in the title changes annually.
    unit: 'cftod-pdf:CFTOD Notice of',
    prefix: true,
    reason:
      'CFTOD publishes an annual "Notice of Regular Board Meetings" alongside ' +
      'its board packets. It is a one-page calendar of meeting dates and ' +
      'contains no board items at all, so the extractor correctly keeps zero ' +
      'from it. This is not a degraded source; it is a document with nothing in ' +
      'it to keep, and it is registered because the alarm cannot tell the ' +
      'difference and pages every run for a correct outcome.',
    recorded: '2026-08-03',
    expect: 'zero-no-baseline',
    alertsAgainWhen:
      'the notice ever yields an item (its format changed and it now carries ' +
      'board business), or it stops being fetched at all.',
  },
];

// ANAHEIM IS DELIBERATELY NOT REGISTERED, and this note is why.
//
// The brief named Anaheim's two unreachable agenda hosts as one of the two
// conditions driving the alert volume. That condition has RESOLVED, and
// registering it would have written down something that is no longer true.
//
// Measured on a read-only government run, 2026-08-03:
//   Anaheim: 50 meetings listed, 50 read, 0 with no reachable document -> 64
//   item/meeting leads
//   documents read by host: local.anaheim.net 28, anaheim.granicus.com 22,
//   www.anaheim.net 15
//
// local.anaheim.net is not merely reachable, it is the LARGEST document host of
// the three. records.anaheim.net served nothing, but no meeting needed it.
// meetingsUnreachable was zero, so the adapter's verdict is 'ok' and there is
// nothing here to suppress.
//
// Had it been registered anyway, the recovery check would have fired a
// stale-entry alert on every run - swapping one daily false alarm for another.

export interface DegradedMatch {
  entry: DegradedSource;
  // True when the observed verdict is the one the entry expects, so this is the
  // known condition and the alarm stays quiet.
  asExpected: boolean;
}

// The register entry covering a unit, if any.
export function degradedEntry(unit: string): DegradedSource | null {
  for (const d of DEGRADED_SOURCES) {
    if (d.prefix ? unit.startsWith(d.unit) : unit === d.unit) return d;
  }
  return null;
}

// Should this finding raise an alarm? A registered unit producing exactly the
// verdict its entry expects is the known condition: reported, not paged.
// Everything else pages, including a registered unit that has RECOVERED, because
// the register is then wrong and someone has to remove the entry.
export function suppressesAlert(unit: string, verdict: HealthVerdict): DegradedMatch | null {
  const entry = degradedEntry(unit);
  if (!entry) return null;
  const asExpected = verdict === entry.expect;
  return { entry, asExpected };
}

// How long an entry has been sitting here, in days, for the run report. An entry
// nobody has revisited in months is itself a finding.
export function ageInDays(entry: DegradedSource, now: Date = new Date()): number | null {
  const t = Date.parse(entry.recorded);
  if (Number.isNaN(t)) return null;
  return Math.floor((now.getTime() - t) / 86400000);
}
