// THE INBOX MUST DRAIN.
//
// The claim this file exists to test is one sentence: a triaged item leaves and
// the count is the honest remainder. That is the whole difference between an
// Inbox and yet another list, and it cannot be checked by reading the code -
// the count is a server-side exact count re-read after a write, so the only
// proof is to triage real records and watch the number fall by the number
// triaged.
//
// IT PUTS THE RECORDS BACK, ITSELF, IN THE TEST. Twenty dismissals is twenty
// judgements nobody made, and this corpus is what client documents are generated
// from.
//
// THAT USED TO BE A SEPARATE COMMAND AND IT LEAKED. Measured 2026-08-18: 160 real
// records sat dismissed across seven revisions of inbox-drain.json because
// `npm run inbox:restore` is manual and nobody ran it, and the ids of all but the
// last twenty survived only in git history - this file is overwritten each run.
//
// So the restore is part of the test now, and its success is asserted. The ids
// are still written to inbox-drain.json and scripts/inbox-restore still exists,
// because a run killed halfway through still needs a way back. Both numbers are
// reported.

import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const TRIAGE = 20;

test('the inbox drains', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto('/inbox', { waitUntil: 'domcontentloaded' });

  const totalEl = page.getByTestId('inbox-total');
  await expect(totalEl).toBeVisible({ timeout: 120_000 });
  await expect
    .poll(async () => (await totalEl.textContent())?.trim(), { timeout: 120_000 })
    .not.toBe('--');
  const start = Number((await totalEl.textContent())?.replace(/[^0-9]/g, ''));
  console.log(`inbox at start: ${start}`);
  expect(start, 'the inbox is already empty, so there is nothing to drain').toBeGreaterThan(TRIAGE);

  const dismissed: string[] = [];
  for (let i = 0; i < TRIAGE; i++) {
    const card = page.getByTestId('inbox-record');
    await expect(card).toBeVisible({ timeout: 60_000 });
    const id = await card.getAttribute('data-record-id');
    expect(id, 'the record on screen has no id').toBeTruthy();
    dismissed.push(id as string);

    await page.keyboard.press('e');
    // The record on screen must CHANGE, not merely the count. A screen that
    // decrements a number while showing the same record has not triaged
    // anything.
    await expect
      .poll(
        async () => await page.getByTestId('inbox-record').getAttribute('data-record-id'),
        { timeout: 60_000 }
      )
      .not.toBe(id);
  }

  await expect
    .poll(async () => Number((await totalEl.textContent())?.replace(/[^0-9]/g, '')), {
      timeout: 120_000,
    })
    .toBe(start - TRIAGE);
  const after = Number((await totalEl.textContent())?.replace(/[^0-9]/g, ''));
  console.log(`inbox after ${TRIAGE} triaged: ${after}  (fell by ${start - after})`);

  const session = await page.getByTestId('inbox-triaged').textContent();
  console.log(`session counter: ${session?.trim()}`);

  mkdirSync('e2e/shots/walkthrough', { recursive: true });
  writeFileSync(
    'e2e/shots/walkthrough/inbox-drain.json',
    JSON.stringify({ start, after, triaged: TRIAGE, dismissed }, null, 2)
  );

  // ---- PUT THEM BACK, HERE, BEFORE ANY ASSERTION CAN FAIL ------------------
  //
  // THE RESTORE WAS A SEPARATE COMMAND AND NOBODY EVER RAN IT. Measured
  // 2026-08-18: 160 real records sat dismissed across seven revisions of the
  // drain file, every one of them a judgement nobody made, and the ids of all
  // but the last twenty existed only in git history because this file is
  // overwritten each run. Four runs in one afternoon took eighty more.
  //
  // A TEST THAT MUTATES REAL DATA AND RELIES ON SOMEONE REMEMBERING TO UNDO IT
  // WILL LEAK AGAIN. The old note on scripts/inbox-restore argued the opposite -
  // that a teardown which fails leaves the corpus wrong and the run green - and
  // that argument is right about a TEARDOWN and wrong about this. A teardown
  // runs after the assertions and is skipped when one throws, which is exactly
  // when the corpus most needs putting back.
  //
  // So the restore runs HERE: after the measurements are taken, before any
  // assertion can throw, and its success is itself asserted. The run cannot go
  // green on a corpus this test damaged, and it cannot go red without having
  // repaired it first.
  //
  // scripts/inbox-restore stays: the ids are still written to disk, and a run
  // killed halfway through still needs a way back.
  const restored = await restore(dismissed);
  console.log(`restored ${restored} of ${dismissed.length} dismissed records to 'new'`);

  expect(new Set(dismissed).size, 'the same record was triaged twice').toBe(TRIAGE);
  expect(after, 'the count did not fall by what was triaged').toBe(start - TRIAGE);
  // THE REPAIR IS ASSERTED, not hoped for. A restore that silently did nothing
  // would leave the leak where it was and the suite would still be green.
  expect(restored, 'the audit did not put back everything it dismissed').toBe(dismissed.length);
});

/**
 * Return every id to status 'new'. Uses the service role directly rather than
 * the UI: the point is to undo a mutation, and driving the screen to undo it
 * would be a second thing that can fail.
 */
async function restore(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  // ---- THE SERVICE KEY IS IN THE ROOT .env.local, NOT THE DASHBOARD'S -------
  //
  // Playwright loads the dashboard's env, which carries the anon key only - the
  // service role key bypasses RLS and is deliberately never shipped to a browser
  // bundle, so it lives one directory up. The first run of this restore threw on
  // exactly that and left the twenty records dismissed, which is the failure it
  // was written to prevent.
  //
  // So the root file is read HERE rather than the key being copied into the
  // dashboard's env, because a second copy of a service key is a second place to
  // leak it from. Parsed rather than dotenv'd: this needs one name out of one
  // file and must not depend on load order.
  //
  // THE URL IS READ OUT OF THE FILE TOO, AND THAT IS THE WHOLE BUG THIS BLOCK
  // ONCE HAD. The key was looked up in the environment AND in the file; the url
  // was looked up in the environment only, and `npx playwright test` sets
  // neither - the dashboard's env is loaded by Next at runtime, not into the
  // test process. So `url` was null, the guard fired, and the message it threw
  // named the KEY, which was sitting in the file exactly where it was supposed
  // to be. Two runs were diagnosed against the wrong variable before the message
  // was made to name the one that is actually absent.
  //
  // The root file spells it NEXT_PUBLIC_SUPABASE_URL. Both spellings are tried
  // because the agent runtime and the dashboard disagree about the name and
  // this test has to work under either.
  const url =
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    readRootEnv('SUPABASE_URL') ??
    readRootEnv('NEXT_PUBLIC_SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? readRootEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    // NAME THE ONE THAT IS MISSING. A guard that reports the wrong variable
    // sends the next reader to look for a value that is already there.
    const missing = [!url ? 'the Supabase URL' : null, !key ? 'SUPABASE_SERVICE_ROLE_KEY' : null]
      .filter(Boolean)
      .join(' and ');
    throw new Error(
      `inbox restore cannot find ${missing} in the environment or in ../.env.local, ` +
        'and refuses to leave records dismissed. Run npm run inbox:restore from the repo root.'
    );
  }
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await db.from('leads').update({ status: 'new' }).in('id', ids);
  if (error) throw new Error(`inbox restore failed: ${error.message}`);
  const { data } = await db.from('leads').select('id').in('id', ids).eq('status', 'new');
  return (data ?? []).length;
}

/** One name out of the repo root's .env.local. Returns null when absent. */
function readRootEnv(name: string): string | null {
  for (const candidate of ['../.env.local', '.env.local']) {
    try {
      const text = readFileSync(candidate, 'utf8');
      // NO REGEX. A pattern built in a template literal has to escape its own
      // backslashes, `\\s` becomes the letter s if it does not, and the failure
      // is silent: the lookup returns null and the caller reports a missing key
      // that is sitting in the file. That happened here twice. Splitting on the
      // first '=' has no escaping to get wrong.
      for (const line of text.split(/\r?\n/)) {
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        if (line.slice(0, eq).trim() !== name) continue;
        const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        if (value) return value;
      }
    } catch { /* try the next candidate */ }
  }
  return null;
}
