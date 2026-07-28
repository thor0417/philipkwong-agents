// Sentry for the dashboard. No DSN, no Sentry: everything below is a no-op when
// NEXT_PUBLIC_SENTRY_DSN is unset, so a local run needs no configuration and no
// key is ever written down.
import * as Sentry from '@sentry/nextjs';

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

// Scrubbing, matching the scraper's rules: no keys, no tokens, and no row
// payloads. The dashboard holds an anon key and a user session, and neither
// belongs in an error report.
const SECRET_KEY_PATTERN = /(supabase|anon|apikey|authorization|bearer|token|password|secret|dsn|access_token|refresh_token)/i;
const CONTENT_FIELDS = /^(raw_content|title|notes|rows|records|payload|data)$/i;
const REDACTED = '[redacted]';

function scrub(input: unknown, depth = 0): unknown {
  if (depth > 6 || input == null) return input;
  if (Array.isArray(input)) return input.slice(0, 20).map((v) => scrub(v, depth + 1));
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(k) || CONTENT_FIELDS.test(k)) out[k] = REDACTED;
      else out[k] = scrub(v, depth + 1);
    }
    return out;
  }
  if (typeof input === 'string' && /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/.test(input)) {
    return REDACTED;
  }
  return input;
}

export function register(): void {
  if (!DSN) return;
  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.extra) event.extra = scrub(event.extra) as typeof event.extra;
      if (event.contexts) event.contexts = scrub(event.contexts) as typeof event.contexts;
      if (event.request?.headers) event.request.headers = scrub(event.request.headers) as Record<string, string>;
      if (event.request?.cookies) delete event.request.cookies;
      return event;
    },
  });
}

export const onRequestError = Sentry.captureRequestError;
