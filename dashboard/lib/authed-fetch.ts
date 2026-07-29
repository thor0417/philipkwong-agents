'use client';

// THE CLIENT HALF OF API AUTHENTICATION.
//
// Every call to /api/* must carry the caller's Supabase session, because the
// routes behind it hold the service-role key and now refuse anonymous requests
// (lib/api-auth.ts, middleware.ts).
//
// The session lives in localStorage, not a cookie, so the browser does not
// attach it on its own — it has to be read and sent explicitly. This helper is
// the single place that happens, so a call site cannot forget the header and
// discover it as a 401 in production.

import { supabase } from './supabase';

// fetch() with the current session's access token attached.
//
// Throws when there is no session rather than sending the request without one:
// a 401 from the server is the correct outcome, but failing here gives the
// caller a clearer message and saves a round trip.
export async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const { data, error } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (error || !token) {
    throw new Error('Your session has expired. Sign in again.');
  }

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
