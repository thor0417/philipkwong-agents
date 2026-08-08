// ERROR TRACKING. Sentry for the scraper.
//
// The argument is two silent failures in one week: Granicus stopped serving
// agendas inline and the lane reported success while writing nothing, and
// Legistar's viewer ids diverged from its API ids. Neither threw, so neither
// would have arrived here on its own. That is why the explicit captures below
// exist alongside the unhandled-error hook: the failures that matter here are
// quiet ones, and they have to be looked for deliberately.
//
// NO DSN, NO SENTRY. Everything is a no-op when SENTRY_DSN is unset, so a local
// run needs no configuration and no key is ever written down. The DSN is read
// from the environment; there is no fallback and no hardcoded value.

import * as Sentry from '@sentry/node';

const DSN = process.env.SENTRY_DSN;
export const sentryEnabled = !!DSN;

// ---- scrubbing ---------------------------------------------------------------
// What must never leave this machine: the service-role key (it bypasses RLS),
// every source API key, and the row payloads themselves, which are
// client-identifying research. Sentry is told about failures, never about
// content.
const SECRET_KEY_PATTERN =
  /(SUPABASE_SERVICE_ROLE_KEY|SUPABASE_URL|ANTHROPIC_API_KEY|SERPER_API_KEY|SAM_GOV_API_KEY|ADZUNA_APP_(ID|KEY)|CAREERJET_API_KEY|JOOBLE_API_KEY|RAPIDAPI_KEY|REED_API_KEY|GOOGLE_SEARCH_API_KEY|SENTRY_DSN|NEXT_PUBLIC_SUPABASE_ANON_KEY|apikey|authorization|bearer|token|password|secret)/i;

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

// The exact options initSentry uses. Exported so a verification run can build a
// client with the SAME beforeSend and a logging transport, and therefore show
// what genuinely leaves this machine rather than what a separate copy of the
// scrubber would have produced.
export function sentryOptions(): Sentry.NodeOptions {
  return {
    dsn: DSN,
    // SENTRY_DEBUG=1 makes the SDK log the envelope it sends and the ingest
    // response, which is how delivery is verified without opening the web UI.
    debug: process.env.SENTRY_DEBUG === '1',
    environment: process.env.NODE_ENV ?? 'development',
    // No performance traces: this is error tracking, and traces would carry
    // request URLs with keys in them.
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.extra) event.extra = scrubDeep(event.extra) as typeof event.extra;
      if (event.contexts) event.contexts = scrubDeep(event.contexts) as typeof event.contexts;
      if (event.tags) event.tags = scrubDeep(event.tags) as typeof event.tags;
      if (event.request?.headers) event.request.headers = scrubDeep(event.request.headers) as Record<string, string>;
      // Environment variables are never useful here and always dangerous.
      delete event.contexts?.runtime;
      return event;
    },
  };
}

export function initSentry(): void {
  if (!DSN) return;
  Sentry.init(sentryOptions());
}

// ---- explicit captures -------------------------------------------------------
// The failures that matter are the quiet ones, so they are reported explicitly
// rather than waiting for a throw.

// A lane or a source produced nothing.
//
// THE GUARD USED TO BE INVERTED. It read `if (written > 0 || trailingAverage <=
// 0) return;` with the current run's own dedupe count passed as the trailing
// average, so a lane that died completely had trailingAverage = 0 and the alarm
// returned early. It could only fire when a lane matched records and failed to
// write them. A total death - the one case it was built for - was silent, which
// is why Las Vegas went dead unnoticed.
//
// The rule now:
//   fetched 0                       -> TOTAL DEATH. Loudest. The source is
//                                      unreachable, blocked, or serving an empty
//                                      document, and no history is needed to
//                                      know that is wrong.
//   fetched > 0, kept 0, has history -> zero-kept. Something upstream changed
//                                      shape and the filter now rejects
//                                      everything.
//   fetched > 0, kept 0, no history  -> reported at warning. It may be a new
//                                      source or a quiet week; still surfaced,
//                                      never swallowed.
//
// Absence of a baseline NEVER suppresses an alert. That was the original defect.
export function captureDeadSource(f: {
  unit: string;
  lane: string;
  fetched: number;
  kept: number;
  baseline: number | null;
  verdict: 'no-fetch' | 'zero-kept' | 'zero-no-baseline';
}): void {
  if (!sentryEnabled) return;

  const level: Sentry.SeverityLevel =
    f.verdict === 'no-fetch' ? 'fatal' : f.verdict === 'zero-kept' ? 'error' : 'warning';

  const summary =
    f.verdict === 'no-fetch'
      ? `Source "${f.unit}" fetched nothing (total death)`
      : f.verdict === 'zero-kept'
        ? `Source "${f.unit}" fetched ${f.fetched} and kept 0 (usually keeps ${f.baseline?.toFixed(1)})`
        : `Source "${f.unit}" kept 0 with no baseline yet`;

  Sentry.captureMessage(summary, {
    level,
    tags: { lane: f.lane, unit: f.unit, kind: 'dead-source', verdict: f.verdict },
    extra: { fetched: f.fetched, kept: f.kept, baseline: f.baseline },
  });
}

// A source on the known-degraded register has started working again.
//
// This is the condition that makes the register safe to have. A suppression with
// no way to expire is how a source dies twice - once when it breaks, and once
// when it quietly changes behaviour while nobody is listening. So recovery is an
// EVENT, not a silence: the entry in agents/scraper/degraded-sources is now
// wrong, and somebody has to delete it.
//
// Reported at 'info'. Nothing is broken; the register is simply out of date.
export function captureDegradedRecovery(f: {
  unit: string;
  lane: string;
  fetched: number;
  kept: number;
  recordedOn: string;
}): void {
  if (!sentryEnabled) return;
  Sentry.captureMessage(
    `Known-degraded source "${f.unit}" is producing again (kept ${f.kept}); its register entry is stale`,
    {
      level: 'info',
      tags: { lane: f.lane, unit: f.unit, kind: 'degraded-recovery' },
      extra: { fetched: f.fetched, kept: f.kept, recordedOn: f.recordedOn },
    }
  );
}

// Whole-lane version, for the case where a lane writes nothing at all. Kept
// separate from the per-source check because a lane can be healthy in aggregate
// while one source inside it is dead, and the reverse.
//
// `sourcesRun` is the guard against paging for an empty selection: a scoped run
// whose markets no adapter covers runs nothing, writes nothing, and is not a
// failure. reportRunHealth returns before calling this in that case; the
// parameter exists so a future caller cannot reintroduce the page by forgetting.
export function captureEmptyLane(
  lane: string,
  fetched: number,
  written: number,
  sourcesRun = 1
): void {
  if (!sentryEnabled) return;
  if (written > 0) return;
  if (sourcesRun === 0) return;
  const totalDeath = fetched === 0;
  Sentry.captureMessage(
    totalDeath
      ? `Lane "${lane}" fetched nothing and wrote nothing (total death)`
      : `Lane "${lane}" fetched ${fetched} and wrote 0`,
    {
      level: totalDeath ? 'fatal' : 'error',
      tags: { lane, kind: 'empty-lane', verdict: totalDeath ? 'no-fetch' : 'zero-write' },
      extra: { fetched, written },
    }
  );
}

// A source is drifting: enough records failed their schema that the shape has
// probably changed.
const SCHEMA_REJECT_THRESHOLD = Number(process.env.SENTRY_SCHEMA_THRESHOLD ?? '0.25');

export function captureSchemaDrift(
  source: string,
  endpoint: string,
  parsed: number,
  rejected: number,
  reasons: string[]
): void {
  if (!sentryEnabled) return;
  const total = parsed + rejected;
  if (total === 0) return;
  const rate = rejected / total;
  if (rate < SCHEMA_REJECT_THRESHOLD) return;
  Sentry.captureMessage(`Schema drift: ${source} rejected ${Math.round(rate * 100)}% of ${endpoint}`, {
    level: 'error',
    tags: { source, endpoint, kind: 'schema-drift' },
    extra: { parsed, rejected, rate, reasons: reasons.slice(0, 3) },
  });
}

// A write failed. The URL identifies the record; the row body never travels.
export function captureWriteFailure(url: string, message: string): void {
  if (!sentryEnabled) return;
  Sentry.captureMessage('Lead write failed', {
    level: 'error',
    tags: { kind: 'write-failure' },
    extra: { url, message },
  });
}

export function captureError(err: unknown, context: Record<string, unknown> = {}): void {
  if (!sentryEnabled) return;
  Sentry.captureException(err, { extra: scrubDeep(context) as Record<string, unknown> });
}

// Flush before the process exits, or queued events are lost.
export async function flushSentry(ms = 3000): Promise<void> {
  if (!sentryEnabled) return;
  await Sentry.flush(ms);
}

// Exported for the scrubbing test: proves what leaves the machine.
export const __scrubForTest = scrubDeep;
