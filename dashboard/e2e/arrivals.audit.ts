// NEW IS A TIME WINDOW, AND IT IS NOT THE SAME VIEW AS ALL.
//
// It read `status = 'new'` and returned 235 of 235, because nothing has ever
// been triaged through that column. Two chips, one predicate, and the one that
// promised to show what arrived showed the whole register. This asserts the
// three things that make it a real view.
//
//   1. NEW IS A STRICT SUBSET OF ALL. If the two ever return the same count
//      again, the window has stopped binding and the old defect is back.
//   2. IT IS ORDERED BY WHEN, NOT BY SIGNIFICANCE. Measured 2026-08-21, the 23
//      projects that arrived inside seven days ranked 11th to 147th by
//      significance and were scattered over three pages. A view answering "what
//      is new" ordered by anything but time is the same list again.
//   3. IT MATCHES THE DATABASE ON created_at, not on first_seen. first_seen is
//      the oldest CAPTURE date among a project's records and disagrees with
//      created_at on 135 of 235 rows, widest gap 27 days, so a window on it
//      would hide projects on the day they arrived.
//
// THE GUARD FOR THE ONE THING THAT WOULD MAKE THIS VIEW LIE is at the bottom:
// a project_key change writes a NEW row with a fresh created_at, and an old
// project would reappear as new. Nothing records a key change, so the check is
// on its footprint - a duplicate (name, market) pair, or a key collision.

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { NEW_WINDOW_DAYS, newWindowSince } from '../lib/arrival-window';

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

const env = {
  ...readEnvFile(resolve(process.cwd(), '..', '.env.local')),
  ...readEnvFile(resolve(process.cwd(), '.env.local')),
  ...process.env,
} as Record<string, string>;

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function totalFor(page: import('@playwright/test').Page, url: string): Promise<number> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const pager = page.getByTestId('pager-total');
  await expect(pager).toBeVisible({ timeout: 120_000 });
  await expect
    .poll(async () => await pager.getAttribute('data-total'), { timeout: 120_000 })
    .not.toBeNull();
  return Number(await pager.getAttribute('data-total'));
}

test('New is a window on when a project arrived, not a state nobody sets', async ({ page }) => {
  test.setTimeout(600_000);

  const since = newWindowSince();
  console.log(`\n===== NEW = ${NEW_WINDOW_DAYS} DAYS =====`);
  console.log(`window opens at ${since}`);

  // ---- THE DATABASE ------------------------------------------------------
  const { data: rows, error } = await admin
    .from('projects')
    .select('id,name,market,project_key,created_at,first_seen,significance')
    .eq('module', 'gli')
    .neq('status', 'dismissed')
    .limit(5000);
  if (error) throw new Error(`arrivals audit read failed: ${error.message}`);
  const all = rows ?? [];
  const arrived = all.filter((p) => p.created_at && String(p.created_at) >= since);
  const byFirstSeen = all.filter((p) => p.first_seen && String(p.first_seen) >= since);

  console.log(`register population        ${all.length}`);
  console.log(`arrived on created_at      ${arrived.length}`);
  console.log(`would-be on first_seen     ${byFirstSeen.length}   (the wrong column, for comparison)`);

  // ---- THE SCREEN --------------------------------------------------------
  const newTotal = await totalFor(page, '/projects?view=new&country=any');
  const allTotal = await totalFor(page, '/projects?view=all&country=any');
  console.log(`screen: New ${newTotal}   All ${allTotal}`);

  expect(newTotal, 'New does not match the database on created_at').toBe(arrived.length);

  // THE DEFECT THIS VIEW EXISTS TO END. Stated as its own assertion so that a
  // regression reads as "New and All are the same view again" rather than as an
  // off-by-some count.
  expect(
    newTotal,
    'New and All return the same count, so New is not a window - it is All under another name, which is the defect this view replaced'
  ).toBeLessThan(allTotal);

  // ---- ORDERED BY WHEN ----------------------------------------------------
  await page.goto('/projects?view=new&country=any', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-row-id]').first()).toBeVisible({ timeout: 120_000 });
  const ids = await page
    .locator('[data-row-id]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-row-id') ?? ''));
  const created = new Map(all.map((p) => [p.id, String(p.created_at ?? '')]));
  const shown = ids.map((id) => created.get(id) ?? '').filter(Boolean);
  console.log(`rows on page one: ${shown.length}, newest ${shown[0]?.slice(0, 10)}, oldest ${shown[shown.length - 1]?.slice(0, 10)}`);

  const descending = shown.every((d, i) => i === 0 || shown[i - 1] >= d);
  expect(
    descending,
    'New is not ordered newest first, so the newest arrivals are not the ones on screen'
  ).toBe(true);

  // ---- THE GUARD ----------------------------------------------------------
  //
  // created_at means "when this appeared to us" only while a project keeps ONE
  // row. The clusterer upserts on (module, project_key) and never writes
  // created_at, so a re-run preserves it - but a project whose derived KEY
  // changes gets a new row, a fresh created_at, and reappears in this view as an
  // arrival it is not. Nothing in the schema records a key change, so this
  // checks the footprint one would leave.
  //
  // Measured 2026-08-21: 235 rows, 235 distinct keys, 0 duplicate (name, market)
  // pairs, and 0 orphaned project_events. It has never happened. The guard is
  // here because the day it does, this view starts lying quietly.
  const keys = new Set(all.map((p) => p.project_key));
  expect(
    keys.size,
    'two live projects share a project_key, so the clusterer identity is not unique and created_at cannot mean arrival'
  ).toBe(all.length);

  const seen = new Map<string, string>();
  const collisions: string[] = [];
  for (const p of all) {
    const k = `${String(p.name).trim().toLowerCase()}||${String(p.market ?? '').toLowerCase()}`;
    if (seen.has(k)) collisions.push(`${p.name} (${p.market ?? 'no market'})`);
    else seen.set(k, p.id);
  }
  console.log(`key uniqueness: ${keys.size} keys / ${all.length} rows | name+market collisions: ${collisions.length}`);
  expect(
    collisions,
    'the same project appears twice under different keys, which is what a re-key looks like and what would make New show an old project as new'
  ).toEqual([]);
});
