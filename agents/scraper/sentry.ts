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

// A lane wrote nothing when it normally writes something. This is the Granicus
// failure, stated as a rule.
export function captureEmptyLane(lane: string, written: number, trailingAverage: number): void {
  if (!sentryEnabled) return;
  if (written > 0 || trailingAverage <= 0) return;
  Sentry.captureMessage(`Lane "${lane}" wrote 0 rows (trailing average ${trailingAverage})`, {
    level: 'error',
    tags: { lane, kind: 'empty-lane' },
    extra: { written, trailingAverage },
  });
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
