// THE DEFAULT-DENY GATE OVER EVERY API ROUTE.
//
// The point of this file is not to protect the three routes that exist today —
// each of those also checks for itself. The point is that route number four
// cannot ship unauthenticated. The matcher below covers /api/:path*, so a new
// handler is behind authentication the moment the file is created, whether or
// not its author remembers to add a check.
//
// This is why the guard lives here rather than only in the handlers: an audit
// found /api/send-email and /api/run-agent both holding the service-role key
// with no caller check at all. That was not a decision anyone made; it was a
// default. This inverts the default.
//
// DEFENCE IN DEPTH, NOT A SUBSTITUTE. The route handlers still call
// requireUser(). Middleware can be bypassed by matcher misconfiguration, and a
// handler invoked directly (a test, a future internal call) gets no middleware
// at all. Two independent checks, both failing closed.
//
// Runs on the Edge runtime, so it uses fetch-based Supabase auth only — no
// Node built-ins, no service-role key. The token is verified against Supabase,
// not merely read.

import { NextResponse, type NextRequest } from 'next/server';
import { authenticate } from '@/lib/api-auth';

export async function middleware(request: NextRequest) {
  const result = await authenticate(request);
  if (result.ok) return NextResponse.next();

  return NextResponse.json(
    { error: result.error },
    {
      status: result.status,
      // Tell a browser client how to authenticate rather than leaving it to
      // guess at a bare 401.
      headers: { 'WWW-Authenticate': 'Bearer realm="philipkwong-dashboard"' },
    }
  );
}

export const config = {
  // Every API route, present and future. Deliberately NOT an allowlist of the
  // routes that exist today: an allowlist is exactly the thing that lets the
  // next route ship open.
  matcher: ['/api/:path*'],
};
