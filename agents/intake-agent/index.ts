// Intake agent — reads inbound mail to hello@philipkwong.com, classifies each
// message with Claude Sonnet, drafts a reply, and queues everything in Supabase
// for MANUAL review. Nothing is ever sent automatically.
//
// Run with: npm run intake   (needs .env.local, credentials.json, token.json)
//
// Auth: OAuth2 against the Gmail API. credentials.json is the OAuth client
// (downloaded from Google Cloud Console). On first run, if token.json is absent,
// the agent prints a consent URL, you paste back the code, and the resulting
// token is saved to token.json. Both files are gitignored.

import fs from 'node:fs';
import readline from 'node:readline';
import Anthropic from '@anthropic-ai/sdk';
import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';
import { supabaseAdmin } from '../../lib/supabase-admin';

// Derive the client type from googleapis itself — importing OAuth2Client from
// google-auth-library directly picks up a different copy of the package than the
// one google.gmail() expects, which TypeScript treats as incompatible.
type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

const AGENT_NAME = 'intake-agent';
const MAILBOX = 'hello@philipkwong.com';

// Read-only is all we need: we never modify the mailbox. Idempotency comes from
// keying each lead on the Gmail message id, not from marking messages read.
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

const CREDENTIALS_PATH = process.env.GMAIL_CREDENTIALS_PATH ?? './credentials.json';
const TOKEN_PATH = process.env.GMAIL_TOKEN_PATH ?? './token.json';

// Most recent unread inbox messages to scan per run.
const MAX_MESSAGES = 25;

// Transactional senders are skipped before any Sonnet call — they are never
// prospects. Entries ending in "@" match the start of the address (local-part
// prefixes); the rest match the sender's domain (including subdomains).
const TRANSACTIONAL_SENDERS = [
  'noreply@',
  'no-reply@',
  'notifications@',
  'mailer@',
  'apolloemails.com',
  'apollo.io',
  'calendly.com',
  'formspree.io',
  'mailchimp.com',
];

type Classification = 'INTERESTED' | 'NEEDS_MORE_INFO' | 'NOT_INTERESTED';

const SCORE_BY_CLASSIFICATION: Record<Classification, number> = {
  INTERESTED: 90,
  NEEDS_MORE_INFO: 60,
  NOT_INTERESTED: 10,
};

interface ParsedEmail {
  id: string;
  subject: string;
  sender: string;
  body: string;
}

interface ClassifiedEmail {
  classification: Classification;
  reason: string;
  jurisdiction: string | null;
}

// Anthropic() reads ANTHROPIC_API_KEY from the environment automatically.
const anthropic = new Anthropic();

// ── Gmail auth ────────────────────────────────────────────

interface OAuthCredentials {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
}

// credentials.json may store the client under "installed" (desktop) or "web".
function readOAuthCredentials(): OAuthCredentials {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      `Gmail credentials not found at ${CREDENTIALS_PATH}. Download the OAuth client JSON from Google Cloud Console and save it there (or set GMAIL_CREDENTIALS_PATH).`
    );
  }
  const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const block = raw.installed ?? raw.web;
  if (!block?.client_id || !block?.client_secret) {
    throw new Error(`Malformed credentials.json — expected an "installed" or "web" OAuth client.`);
  }
  return {
    client_id: block.client_id,
    client_secret: block.client_secret,
    redirect_uris: block.redirect_uris ?? ['urn:ietf:wg:oauth:2.0:oob'],
  };
}

// Console-based consent flow used the first time (no token.json yet).
async function promptForToken(client: OAuth2Client): Promise<void> {
  const authUrl = client.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
  console.log('\nAuthorize this app by visiting:\n' + authUrl + '\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const code = await new Promise<string>((resolve) => {
    rl.question('Paste the authorization code here: ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });

  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log(`Saved Gmail token to ${TOKEN_PATH}`);
}

async function authorize(): Promise<OAuth2Client> {
  const creds = readOAuthCredentials();
  const client = new google.auth.OAuth2(creds.client_id, creds.client_secret, creds.redirect_uris[0]);

  // Persist refreshed access tokens as they roll over.
  client.on('tokens', (tokens) => {
    try {
      const existing = fs.existsSync(TOKEN_PATH) ? JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')) : {};
      fs.writeFileSync(TOKEN_PATH, JSON.stringify({ ...existing, ...tokens }, null, 2));
    } catch (err) {
      console.error('Could not persist refreshed token:', err);
    }
  });

  if (fs.existsSync(TOKEN_PATH)) {
    client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')));
    console.log(`Loaded Gmail token from ${TOKEN_PATH}`);
  } else {
    console.log('No token.json found — starting one-time OAuth consent flow.');
    await promptForToken(client);
  }

  return client;
}

// ── Gmail reading ─────────────────────────────────────────

// Pull the bare address out of a From header like `Name <addr@domain>`.
function emailAddress(sender: string): string {
  const angle = sender.match(/<([^>]+)>/);
  return (angle ? angle[1] : sender).trim().toLowerCase();
}

// True if the sender is a known transactional source we skip before classifying.
function isTransactionalSender(sender: string): boolean {
  const address = emailAddress(sender);
  const domain = address.split('@')[1] ?? '';
  return TRANSACTIONAL_SENDERS.some((pattern) =>
    pattern.endsWith('@')
      ? address.startsWith(pattern)
      : domain === pattern || domain.endsWith(`.${pattern}`)
  );
}

function headerValue(headers: gmail_v1.Schema$MessagePartHeader[], name: string): string {
  const found = headers.find((h) => (h.name ?? '').toLowerCase() === name.toLowerCase());
  return found?.value ?? '';
}

// Walk the MIME tree and return the first text/plain body, falling back to
// text/html (tags stripped) so we always have something to classify.
function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return '';

  const decode = (data?: string | null): string =>
    data ? Buffer.from(data, 'base64url').toString('utf8') : '';

  const walk = (part: gmail_v1.Schema$MessagePart, mime: string): string | null => {
    if (part.mimeType === mime && part.body?.data) return decode(part.body.data);
    for (const child of part.parts ?? []) {
      const hit = walk(child, mime);
      if (hit) return hit;
    }
    return null;
  };

  const plain = walk(payload, 'text/plain');
  if (plain) return plain.trim();

  const html = walk(payload, 'text/html');
  if (html) return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  // Single-part message: body sits directly on the payload.
  return decode(payload.body?.data).trim();
}

async function fetchUnread(gmail: gmail_v1.Gmail): Promise<ParsedEmail[]> {
  const list = await gmail.users.messages.list({
    userId: 'me',
    q: 'is:unread in:inbox',
    maxResults: MAX_MESSAGES,
  });

  const messages = list.data.messages ?? [];
  console.log(`Found ${messages.length} unread message(s) in inbox`);

  const parsed: ParsedEmail[] = [];
  for (const ref of messages) {
    if (!ref.id) continue;
    const full = await gmail.users.messages.get({ userId: 'me', id: ref.id, format: 'full' });
    const headers = full.data.payload?.headers ?? [];
    parsed.push({
      id: ref.id,
      subject: headerValue(headers, 'Subject') || '(no subject)',
      sender: headerValue(headers, 'From') || '(unknown sender)',
      body: extractBody(full.data.payload),
    });
  }
  return parsed;
}

// ── Claude Sonnet: classify + draft ───────────────────────

const SONNET_MODEL = 'claude-sonnet-4-6';

function textOf(response: Anthropic.Message): string {
  const block = response.content[0];
  return block && block.type === 'text' ? block.text : '';
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = (fenced ? fenced[1] : text).trim();
  const first = body.indexOf('{');
  const last = body.lastIndexOf('}');
  if (first !== -1 && last > first) body = body.slice(first, last + 1);
  return body;
}

const CLASSIFY_PROMPT = `You triage inbound email for Philip Kwong, a regulatory compliance and corporate strategy consultant (Vancouver / Bangkok). His services: regulatory compliance, QMS architecture, licensing pathways, corporate strategy, market entry, commercialization, AI automation, and professional web presence for regulated businesses.

Classify the email below as exactly one of:
- INTERESTED — the sender wants to engage, hire, or seriously explore working with Philip.
- NEEDS_MORE_INFO — a genuine prospect, but more detail/clarification is needed before it can move forward.
- NOT_INTERESTED — spam, irrelevant, a sales pitch to Philip, a rejection, or otherwise not a viable lead.

Also extract the jurisdiction (country/province/region) the sender's need relates to, if mentioned, else null.

Respond in JSON only. No preamble, no markdown.
{
  "classification": "INTERESTED | NEEDS_MORE_INFO | NOT_INTERESTED",
  "reason": "one sentence",
  "jurisdiction": "extracted jurisdiction or null"
}

Email:`;

const VALID: Classification[] = ['INTERESTED', 'NEEDS_MORE_INFO', 'NOT_INTERESTED'];

async function classifyEmail(email: ParsedEmail): Promise<ClassifiedEmail> {
  const response = await anthropic.messages.create({
    model: SONNET_MODEL,
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: `${CLASSIFY_PROMPT}\nFrom: ${email.sender}\nSubject: ${email.subject}\n\n${email.body}`,
      },
    ],
  });

  try {
    const parsed = JSON.parse(extractJson(textOf(response)));
    const classification: Classification = VALID.includes(parsed.classification)
      ? parsed.classification
      : 'NEEDS_MORE_INFO';
    return {
      classification,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      jurisdiction: parsed.jurisdiction && parsed.jurisdiction !== 'null' ? parsed.jurisdiction : null,
    };
  } catch {
    console.error(`Classification parse failed for "${email.subject.slice(0, 50)}" — defaulting to NEEDS_MORE_INFO`);
    return { classification: 'NEEDS_MORE_INFO', reason: 'Parse error', jurisdiction: null };
  }
}

// Fixed acknowledgement reply — identical for every classification. Sonnet is
// used only for classification/scoring, never for drafting replies. The draft
// still queues as pending for manual review; nothing is sent automatically.
function draftResponse(email: ParsedEmail): string {
  return `Subject: Re: ${email.subject}

Thank you for your email. A member of our team will be in touch with you within 24 hours.

Philip Kwong
Principal
philipkwong.com
hello@philipkwong.com`;
}

// ── Supabase persistence ──────────────────────────────────

// Each Gmail message maps to a stable, unique URL so re-runs upsert rather than
// duplicate. The leads table requires url to be NOT NULL and UNIQUE.
function leadUrl(messageId: string): string {
  return `gmail://message/${messageId}`;
}

interface PersistResult {
  written: boolean;
  skipped: boolean;
}

async function persist(email: ParsedEmail, classified: ClassifiedEmail, draft: string): Promise<PersistResult> {
  const url = leadUrl(email.id);

  // Skip messages we have already drafted a response for (idempotent re-runs).
  const { data: existing } = await supabaseAdmin
    .from('leads')
    .select('id, outreach_drafted')
    .eq('url', url)
    .maybeSingle();

  if (existing?.outreach_drafted) {
    console.log(`  ↳ already processed (lead ${existing.id}) — skipping`);
    return { written: false, skipped: true };
  }

  const score = SCORE_BY_CLASSIFICATION[classified.classification];

  const { data: lead, error: leadError } = await supabaseAdmin
    .from('leads')
    .upsert(
      {
        source: AGENT_NAME,
        url,
        title: email.subject,
        raw_content: email.body,
        score,
        score_reason: `${classified.classification}: ${classified.reason}`,
        status: 'new',
        jurisdiction: classified.jurisdiction,
        outreach_drafted: true,
      },
      { onConflict: 'url' }
    )
    .select('id')
    .single();

  if (leadError || !lead) {
    console.error(`  ↳ lead write failed: ${leadError?.message ?? 'no row returned'}`);
    return { written: false, skipped: false };
  }
  console.log(`  ↳ wrote lead ${lead.id} (score ${score})`);

  const { error: outreachError } = await supabaseAdmin.from('outreach').insert({
    lead_id: lead.id,
    draft_content: draft,
    status: 'pending', // queued for manual review — never auto-sent
  });

  if (outreachError) {
    console.error(`  ↳ outreach write failed: ${outreachError.message}`);
    return { written: false, skipped: false };
  }
  console.log(`  ↳ queued draft reply in outreach (pending review)`);

  return { written: true, skipped: false };
}

// ── Run ───────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log(`Intake agent starting — monitoring ${MAILBOX}...`);

  await supabaseAdmin
    .from('agents')
    .update({ status: 'running', last_run: new Date().toISOString() })
    .eq('name', AGENT_NAME);

  try {
    const auth = await authorize();
    const gmail = google.gmail({ version: 'v1', auth });

    const emails = await fetchUnread(gmail);

    let written = 0;
    let skippedTransactional = 0;
    let skippedNotInterested = 0;
    for (const email of emails) {
      console.log(`\nProcessing: "${email.subject}" from ${email.sender}`);

      // Pre-classification filter: transactional senders are never prospects.
      // Skip them entirely — no Sonnet call, no Supabase record.
      if (isTransactionalSender(email.sender)) {
        console.log(`  ↳ transactional sender — skipped (no classification, not persisted)`);
        skippedTransactional++;
        continue;
      }

      const classified = await classifyEmail(email);
      console.log(`  ↳ classified ${classified.classification} — ${classified.reason}`);
      if (classified.jurisdiction) console.log(`  ↳ jurisdiction: ${classified.jurisdiction}`);

      // Only real prospects are persisted. NOT_INTERESTED is logged and dropped.
      if (classified.classification === 'NOT_INTERESTED') {
        console.log(`  ↳ NOT_INTERESTED — logged only, not persisted`);
        skippedNotInterested++;
        continue;
      }

      const draft = draftResponse(email);
      console.log(`  ↳ queued fixed acknowledgement reply`);

      const result = await persist(email, classified, draft);
      if (result.written) written++;
    }

    console.log(
      `\nDone. Queued ${written} new lead(s) + draft(s) for manual review. ` +
        `Skipped ${skippedTransactional} transactional, ${skippedNotInterested} NOT_INTERESTED.`
    );

    await supabaseAdmin
      .from('agents')
      .update({ status: 'idle', leads_found: written, error: null })
      .eq('name', AGENT_NAME);
  } catch (error) {
    console.error('Intake agent failed:', error);
    await supabaseAdmin
      .from('agents')
      .update({ status: 'error', error: String(error) })
      .eq('name', AGENT_NAME);
    process.exitCode = 1;
  }
}

run();
