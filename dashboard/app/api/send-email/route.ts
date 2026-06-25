// Gmail send route — approves an outreach draft and sends it.
//
// POST { outreach_id, deal_id, contact_id, to, subject, body }
//   1. Refreshes a Gmail access token from credentials.json + token.json
//      (the same OAuth client the intake agent uses, in the repo root).
//   2. Sends the email via the Gmail REST API from hello@philipkwong.com.
//   3. Marks the outreach row sent and logs an email_sent activity.
//
// Runs server-side only (Node runtime) — the service role key never reaches the
// browser. credentials.json / token.json are gitignored; on Vercel point
// GMAIL_CREDENTIALS_PATH / GMAIL_TOKEN_PATH at where you mount them.

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

export const runtime = 'nodejs';

const SENDER = 'Philip Kwong <hello@philipkwong.com>';

// Default to the agents repo root, one level up from the dashboard cwd.
const CREDENTIALS_PATH =
  process.env.GMAIL_CREDENTIALS_PATH ?? path.join('..', 'credentials.json');
const TOKEN_PATH = process.env.GMAIL_TOKEN_PATH ?? path.join('..', 'token.json');

interface SendBody {
  outreach_id?: string;
  deal_id?: string | null;
  contact_id?: string | null;
  to?: string;
  subject?: string;
  body?: string;
}

function readOAuthClient(): { client_id: string; client_secret: string } {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(`credentials.json not found at ${CREDENTIALS_PATH}`);
  }
  const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const block = raw.installed ?? raw.web;
  if (!block?.client_id || !block?.client_secret) {
    throw new Error('Malformed credentials.json — expected "installed" or "web".');
  }
  return { client_id: block.client_id, client_secret: block.client_secret };
}

function readRefreshToken(): string {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(`token.json not found at ${TOKEN_PATH}`);
  }
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  if (!token.refresh_token) {
    throw new Error('token.json has no refresh_token — re-run the OAuth flow.');
  }
  return token.refresh_token as string;
}

// Exchange the long-lived refresh token for a short-lived access token.
async function getAccessToken(): Promise<string> {
  const { client_id, client_secret } = readOAuthClient();
  const refresh_token = readRefreshToken();

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id,
      client_secret,
      refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(
      `Token refresh failed: ${data.error_description || data.error || res.status}`
    );
  }
  return data.access_token as string;
}

// Build an RFC 2822 message and base64url-encode it for the Gmail API.
function buildRawMessage(to: string, subject: string, body: string): string {
  const headers = [
    `From: ${SENDER}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
  ];
  const mime = `${headers.join('\r\n')}\r\n\r\n${body}`;
  return Buffer.from(mime)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function adminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for the send route.'
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(request: Request) {
  let payload: SendBody;
  try {
    payload = (await request.json()) as SendBody;
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { outreach_id, deal_id, contact_id, to, subject, body } = payload;
  if (!outreach_id || !to || !subject || !body) {
    return Response.json(
      { error: 'outreach_id, to, subject and body are required.' },
      { status: 400 }
    );
  }

  // 1. Send via Gmail.
  try {
    const accessToken = await getAccessToken();
    const raw = buildRawMessage(to, subject, body);
    const res = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw }),
      }
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const message =
        data?.error?.message || `Gmail send failed (${res.status}).`;
      return Response.json({ error: message }, { status: 502 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gmail send failed.';
    return Response.json({ error: message }, { status: 500 });
  }

  // 2. Record the send. A Gmail failure already returned above, so a Supabase
  //    error here is reported but the email did go out.
  try {
    const supabase = adminClient();
    const now = new Date().toISOString();

    await supabase
      .from('outreach')
      .update({ status: 'sent', sent_at: now })
      .eq('id', outreach_id);

    await supabase.from('activities').insert({
      deal_id: deal_id ?? null,
      contact_id: contact_id ?? null,
      type: 'email_sent',
      direction: 'outbound',
      subject,
      content: body,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Sent, but failed to record.';
    return Response.json({ ok: true, warning: message }, { status: 200 });
  }

  return Response.json({ ok: true });
}
