// Run-agent route — triggers a scraper/intake run from the dashboard.
//
// POST { name }  →  spawns `npm run <script>` in the agents repo root.
//
// This works when the dashboard server is a long-lived process (local `next
// dev` / `next start`). It does NOT work on Vercel's serverless functions,
// which cannot spawn background npm processes — run those agents on a host or
// scheduler instead.

import { createClient } from '@supabase/supabase-js';
import { spawn } from 'node:child_process';
import path from 'node:path';

export const runtime = 'nodejs';

// Only these agents have a runnable script; the rest are deferred (CLAUDE.md).
const SCRIPTS: Record<string, string> = {
  'lead-scraper': 'scrape:leads',
  'intake-agent': 'intake',
};

// Agents repo root, one level up from the dashboard cwd.
const REPO_ROOT = process.env.AGENTS_REPO_ROOT ?? path.join(process.cwd(), '..');

function adminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function setStatus(name: string, status: string, error?: string | null) {
  const supabase = adminClient();
  if (!supabase) return;
  const patch: Record<string, unknown> = { status, error: error ?? null };
  if (status !== 'running') patch.last_run = new Date().toISOString();
  await supabase.from('agents').update(patch).eq('name', name);
}

export async function POST(request: Request) {
  let name: string | undefined;
  try {
    ({ name } = (await request.json()) as { name?: string });
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!name || !(name in SCRIPTS)) {
    return Response.json(
      { error: `Agent "${name}" is not runnable from the dashboard.` },
      { status: 400 }
    );
  }

  const script = SCRIPTS[name];
  await setStatus(name, 'running');

  // Fire-and-forget. npm is npm.cmd on Windows, so go through the shell.
  const child = spawn('npm', ['run', script], {
    cwd: REPO_ROOT,
    shell: true,
    stdio: 'ignore',
    detached: false,
  });

  child.on('error', (err) => {
    void setStatus(name as string, 'error', err.message);
  });
  child.on('exit', (code) => {
    void setStatus(name as string, code === 0 ? 'idle' : 'error',
      code === 0 ? null : `Exited with code ${code}`);
  });

  return Response.json({ ok: true, started: name, script });
}
