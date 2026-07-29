// SERVER-SIDE AUTHENTICATION FOR API ROUTES.
//
// WHY THIS EXISTS. /api/send-email and /api/run-agent both hold the SUPABASE
// SERVICE ROLE KEY, which bypasses row-level security entirely, and neither
// checked who was calling. /api/send-email accepts an arbitrary `to`, `subject`
// and `body` and sends the message from Philip's Gmail account: unauthenticated,
// it is an open mail relay on his professional identity. /api/run-agent spawns
// scraper processes, so it is an unauthenticated way to run up an API bill.
//
// WHY A BEARER TOKEN AND NOT A COOKIE. The dashboard's Supabase client
// (lib/supabase.ts) uses the library default, which persists the session in
// localStorage. There is no Supabase auth cookie to read, so a cookie-reading
// guard would reject every legitimate request while still admitting none of the
// illegitimate ones. The caller sends the session's access token explicitly (see
// lib/authed-fetch.ts) and this module verifies it.
//
// THE TOKEN IS VERIFIED, NOT MERELY PRESENT. auth.getUser(token) asks Supabase
// to validate the signature and expiry and return the user. A guard that only
// checked for the presence of an Authorization header would be satisfied by
// `Authorization: Bearer anything`.

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export interface AuthedUser {
  id: string;
  email: string | null;
}

export type AuthResult =
  | { ok: true; user: AuthedUser }
  | { ok: false; status: 401 | 500; error: string };

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? request.headers.get('Authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

// Verify the caller holds a valid Supabase session. Returns the user, or the
// status and message to reject with.
//
// FAILS CLOSED. If the Supabase URL or anon key is missing from the environment
// the answer is 500 and the request is refused, never allowed through: a
// misconfigured deployment must not silently become an open endpoint again.
export async function authenticate(request: Request): Promise<AuthResult> {
  if (!url || !anonKey) {
    return { ok: false, status: 500, error: 'Auth is not configured on this deployment.' };
  }

  const token = bearerToken(request);
  if (!token) {
    return { ok: false, status: 401, error: 'Authentication required.' };
  }

  // The ANON key here, never the service role: this call is only asking
  // Supabase to validate the caller's own token.
  const supabase = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return { ok: false, status: 401, error: 'Invalid or expired session.' };
  }

  return { ok: true, user: { id: data.user.id, email: data.user.email ?? null } };
}

// The 401/500 JSON response, shared so every route rejects identically.
export function authFailureResponse(result: Extract<AuthResult, { ok: false }>): Response {
  return Response.json({ error: result.error }, { status: result.status });
}

// Convenience for a route handler: returns null when the caller is authorised,
// or the Response to return when they are not.
export async function requireUser(request: Request): Promise<Response | null> {
  const result = await authenticate(request);
  return result.ok ? null : authFailureResponse(result);
}
