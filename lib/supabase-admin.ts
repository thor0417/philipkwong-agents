// Server-side Supabase client for agents.
// Uses the SERVICE ROLE key — bypasses RLS. Never import this into the dashboard
// or any code that ships to the browser.

import { createClient } from '@supabase/supabase-js';

// Accept either name for the project URL — the dashboard env uses the
// NEXT_PUBLIC_ prefix, and the same value is fine here.
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error(
    'Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) or SUPABASE_SERVICE_ROLE_KEY. Set them in .env.local.'
  );
}

export const supabaseAdmin = createClient(url, serviceKey, {
  auth: { persistSession: false },
});
