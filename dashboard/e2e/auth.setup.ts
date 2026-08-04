// AUTHENTICATION FOR THE CAPTURE RUN.
//
// Screenshots of a login page prove nothing, so this signs in for real. It does
// so WITHOUT a password: the service-role key mints a one-time magic-link token
// for an existing user, that token is exchanged for a session, and the session
// is handed to the browser through the app's own code path.
//
// WHY NOT WRITE localStorage DIRECTLY. That means hardcoding auth-js's storage
// key and value format, which is an internal detail that has changed across
// releases. Instead the session is handed over as a URL fragment and the app's
// real Supabase client consumes it via detectSessionInUrl, persisting it in
// whatever shape that version of auth-js wants. The setup then asserts a session
// actually landed, so a format change fails loudly here rather than silently
// producing a folder of login screens.
//
// SECRETS. The service-role key is read from the gitignored root .env.local at
// run time, is used only in this Node process, and never reaches the browser
// context. The saved session state is gitignored.

import { test as setup, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const STATE_PATH = 'e2e/.auth/state.json';

// Minimal .env parser. dotenv is not a dependency of this project and this
// brief is not the place to add one.
function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

setup('authenticate', async ({ page, context }) => {
  const dashEnv = readEnvFile(resolve(process.cwd(), '.env.local'));
  const rootEnv = readEnvFile(resolve(process.cwd(), '..', '.env.local'));
  const env = { ...rootEnv, ...dashEnv, ...process.env } as Record<string, string>;

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
        'Expected them in dashboard/.env.local.'
    );
  }
  if (!serviceKey) {
    throw new Error(
      'Missing SUPABASE_SERVICE_ROLE_KEY (expected in the root .env.local). ' +
        'It is needed to mint a session without a password. Alternatively set ' +
        'E2E_EMAIL and E2E_PASSWORD to sign in through the form instead.'
    );
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anon = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Which account. An explicit E2E_EMAIL wins; otherwise the first user on the
  // project, because this project has exactly one operator.
  async function resolveEmail(): Promise<string> {
    if (env.E2E_EMAIL) return env.E2E_EMAIL;
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (error) throw new Error(`Could not list users: ${error.message}`);
    const first = data.users[0]?.email;
    if (!first) {
      throw new Error(
        'No users exist on this Supabase project, so there is no account to ' +
          'screenshot as. Create one in the Supabase dashboard first.'
      );
    }
    return first;
  }
  const email = await resolveEmail();

  // Mint a one-time token for that user, then redeem it for a real session.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkError) throw new Error(`generateLink failed for ${email}: ${linkError.message}`);

  const tokenHash = link.properties?.hashed_token;
  if (!tokenHash) throw new Error('generateLink returned no hashed_token.');

  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'email',
  });
  if (verifyError) throw new Error(`verifyOtp failed: ${verifyError.message}`);

  const session = verified.session;
  if (!session) throw new Error('verifyOtp returned no session.');

  // Hand the session to the browser as a fragment and let the app's own client
  // persist it. /login is the landing spot deliberately: it is the one route
  // that renders immediately and does not redirect on mount, so the client has
  // time to consume the fragment before anything navigates away.
  const fragment = new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: String(session.expires_in ?? 3600),
    token_type: 'bearer',
    type: 'magiclink',
  }).toString();

  await page.goto(`/login#${fragment}`);

  // Assert the handover actually worked. Without this the run would happily
  // produce a folder of login screens and call it done.
  await expect
    .poll(
      async () =>
        page.evaluate(() =>
          Object.keys(window.localStorage).some(
            (k) => k.startsWith('sb-') && k.includes('auth-token')
          )
        ),
      {
        message:
          'Supabase never persisted a session. The fragment handover may have ' +
          'broken with an auth-js upgrade; check detectSessionInUrl.',
        timeout: 20_000,
      }
    )
    .toBe(true);

  // And prove it end to end: the app itself must agree we are signed in rather
  // than bouncing to /login.
  await page.goto('/pipeline');
  await expect
    .poll(() => new URL(page.url()).pathname, {
      message: 'Signed-in session did not survive a navigation to /pipeline.',
      timeout: 20_000,
    })
    .not.toBe('/login');

  mkdirSync(dirname(STATE_PATH), { recursive: true });
  await context.storageState({ path: STATE_PATH });
  console.log(`  authenticated as ${email}`);
});
