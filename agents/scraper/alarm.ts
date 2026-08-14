// THE ALARMS. What has to be shouted about when a lane goes quiet.
//
// This file replaces agents/scraper/sentry.ts. The Sentry trial lapsed and
// there is one operator, so an UNSEEN error is not the failure mode this system
// has: the failure mode is a lane that reports success while writing nothing,
// and that is caught by looking at the run - which is exactly what these
// functions now do, through the structured logger, at the same severities.
//
// WHAT DID NOT CHANGE, and this is the point of the file existing at all. Every
// alarm the scraper raised, it still raises, from the same call site, with the
// same fields and the same escalation:
//
//   fetched 0                        fatal    total death
//   fetched > 0, kept 0, baseline    error    something upstream changed shape
//   fetched > 0, kept 0, no baseline warn     surfaced, never swallowed
//   a lane writing nothing at all    fatal/error
//   a degraded source recovering     info     the register entry is now stale
//   schema drift over the threshold  error
//   a write refused                  error
//
// The zero-write alarm's guard history is preserved in captureEmptyLane's
// successor below, because it is the one that was wrong once and the reasoning
// is what stops it being wrong again.
//
// WHY THE SCRUBBER SURVIVED A REMOVAL THAT WAS ABOUT NOT SENDING ANYTHING
// ANYWHERE. A log line is not private by being local. LOG_JSON=1 exists so
// these lines can be shipped, and the day they are is not the day to discover
// that the service-role key was in one of them. The rule is the same rule it
// always was: report the failure, never the content.

import { logger } from './logger';

// What must never appear in a log line: the service-role key (it bypasses RLS),
// every source API key, and the row payloads themselves, which are
// client-identifying research.
const SECRET_KEY_PATTERN =
  /(SUPABASE_SERVICE_ROLE_KEY|SUPABASE_URL|ANTHROPIC_API_KEY|SERPER_API_KEY|SAM_GOV_API_KEY|ADZUNA_APP_(ID|KEY)|CAREERJET_API_KEY|JOOBLE_API_KEY|RAPIDAPI_KEY|REED_API_KEY|GOOGLE_SEARCH_API_KEY|NEXT_PUBLIC_SUPABASE_ANON_KEY|apikey|authorization|bearer|token|password|secret)/i;

// Values that look like a credential regardless of the key they arrived under:
// a JWT, or a long opaque string.
const SECRET_VALUE_PATTERN = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b|\b[A-Za-z0-9_-]{40,}\b/;

// Fields that carry captured record content rather than diagnostics.
const CONTENT_FIELDS = /^(raw_content|title|notes|snippet|body|html|text|rows|records|payload|data)$/i;

const REDACTED = '[redacted]';

function scrubValue(key: string, value: unknown): unknown {
  if (SECRET_KEY_PATTERN.test(key)) return REDACTED;
  if (CONTENT_FIELDS.test(key)) return REDACTED;
  if (typeof value === 'string') {
    if (SECRET_VALUE_PATTERN.test(value)) return REDACTED;
    // A URL can carry a key in its query string.
    if (/[?&](api_?key|key|token|apikey)=/i.test(value)) {
      return value.replace(/([?&](?:api_?key|key|token|apikey)=)[^&]*/gi, `$1${REDACTED}`);
    }
    return value.length > 500 ? `${value.slice(0, 500)}...[truncated]` : value;
  }
  return value;
}

function scrubDeep(input: unknown, depth = 0): unknown {
  if (depth > 6 || input == null) return input;
  if (Array.isArray(input)) return input.slice(0, 20).map((v) => scrubDeep(v, depth + 1));
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      const scrubbed = scrubValue(k, v);
      out[k] = scrubbed === v && typeof v === 'object' ? scrubDeep(v, depth + 1) : scrubbed;
    }
    return out;
  }
  return input;
}

export type AlarmLevel = 'fatal' | 'error' | 'warn' | 'info';

// pino has no 'fatal' distinct from its own fatal level, and it does have one,
// so the mapping is direct. Kept as a function rather than inlined because the
// level a finding deserves is decided by the caller and asserted by the tests.
function emit(level: AlarmLevel, kind: string, msg: string, fields: Record<string, unknown>): void {
  const payload = { kind, ...(scrubDeep(fields) as Record<string, unknown>) };
  if (level === 'fatal') logger.fatal(payload, msg);
  else if (level === 'error') logger.error(payload, msg);
  else if (level === 'warn') logger.warn(payload, msg);
  else logger.info(payload, msg);
}

/**
 * A lane or a source produced nothing.
 *
 * THE GUARD USED TO BE INVERTED. It read `if (written > 0 || trailingAverage <=
 * 0) return;` with the current run's own dedupe count passed as the trailing
 * average, so a lane that died completely had trailingAverage = 0 and the alarm
 * returned early. It could only fire when a lane matched records and failed to
 * write them. A total death - the one case it was built for - was silent, which
 * is why Las Vegas went dead unnoticed.
 *
 * Absence of a baseline NEVER suppresses an alert. That was the original defect.
 */
export function alarmDeadSource(f: {
  unit: string;
  lane: string;
  fetched: number;
  kept: number;
  baseline: number | null;
  verdict: 'no-fetch' | 'zero-kept' | 'zero-no-baseline';
}): void {
  const level: AlarmLevel =
    f.verdict === 'no-fetch' ? 'fatal' : f.verdict === 'zero-kept' ? 'error' : 'warn';
  const summary =
    f.verdict === 'no-fetch'
      ? `Source "${f.unit}" fetched nothing (total death)`
      : f.verdict === 'zero-kept'
        ? `Source "${f.unit}" fetched ${f.fetched} and kept 0 (usually keeps ${f.baseline?.toFixed(1)})`
        : `Source "${f.unit}" kept 0 with no baseline yet`;
  emit(level, 'dead-source', summary, {
    lane: f.lane,
    unit: f.unit,
    verdict: f.verdict,
    fetched: f.fetched,
    kept: f.kept,
    baseline: f.baseline,
  });
}

/**
 * A source on the known-degraded register has started working again.
 *
 * This is the condition that makes the register safe to have. A suppression with
 * no way to expire is how a source dies twice - once when it breaks, and once
 * when it quietly changes behaviour while nobody is listening. So recovery is an
 * EVENT, not a silence: the entry in agents/scraper/degraded-sources is now
 * wrong, and somebody has to delete it.
 */
export function alarmDegradedRecovery(f: {
  unit: string;
  lane: string;
  fetched: number;
  kept: number;
  recordedOn: string;
}): void {
  emit(
    'info',
    'degraded-recovery',
    `Known-degraded source "${f.unit}" is producing again (kept ${f.kept}); its register entry is stale`,
    { lane: f.lane, unit: f.unit, fetched: f.fetched, kept: f.kept, recordedOn: f.recordedOn }
  );
}

/**
 * THE ZERO-WRITE ALARM. A lane wrote nothing at all.
 *
 * Kept separate from the per-source check because a lane can be healthy in
 * aggregate while one source inside it is dead, and the reverse.
 *
 * `sourcesRun` is the guard against paging for an empty selection: a scoped run
 * whose markets no adapter covers runs nothing, writes nothing, and is not a
 * failure. reportRunHealth returns before calling this in that case; the
 * parameter exists so a future caller cannot reintroduce the false alarm by
 * forgetting.
 */
export function alarmEmptyLane(lane: string, fetched: number, written: number, sourcesRun = 1): void {
  if (written > 0) return;
  if (sourcesRun === 0) return;
  const totalDeath = fetched === 0;
  emit(
    totalDeath ? 'fatal' : 'error',
    'empty-lane',
    totalDeath
      ? `Lane "${lane}" fetched nothing and wrote nothing (total death)`
      : `Lane "${lane}" fetched ${fetched} and wrote 0`,
    { lane, verdict: totalDeath ? 'no-fetch' : 'zero-write', fetched, written }
  );
}

// A source is drifting: enough records failed their schema that the shape has
// probably changed.
const SCHEMA_REJECT_THRESHOLD = Number(process.env.SCHEMA_DRIFT_THRESHOLD ?? '0.25');

export function alarmSchemaDrift(
  source: string,
  endpoint: string,
  parsed: number,
  rejected: number,
  reasons: string[]
): void {
  const total = parsed + rejected;
  if (total === 0) return;
  const rate = rejected / total;
  if (rate < SCHEMA_REJECT_THRESHOLD) return;
  emit(
    'error',
    'schema-drift',
    `Schema drift: ${source} rejected ${Math.round(rate * 100)}% of ${endpoint}`,
    { source, endpoint, parsed, rejected, rate, reasons: reasons.slice(0, 3) }
  );
}

/** A write failed. The URL identifies the record; the row body never travels. */
export function alarmWriteFailure(url: string, message: string): void {
  emit('error', 'write-failure', 'Lead write failed', { url, message });
}

export function alarmError(err: unknown, context: Record<string, unknown> = {}): void {
  emit('error', 'unhandled', err instanceof Error ? err.message : String(err), {
    ...context,
    stack: err instanceof Error ? err.stack : undefined,
  });
}

// Exported for the scrubbing test: proves what reaches a log line.
export const __scrubForTest = scrubDeep;
