// Re-tag: mark stored leads that are already awarded/dead or expired so they
// drop out of the actionable set, matching the write-path rules. Sets
// lifecycle='dead' for notices matching the dead terms (awarded/cancelled/
// withdrawn/superseded/award or intent notice) and lifecycle='expired' for leads
// whose deadline has passed. Dead takes precedence.
//
// THE LOGIC MOVED. It now lives in agents/scraper/lifecycle-sweep.ts and runs on
// EVERY orchestrator pass, which is the whole point: this was a one-off script
// someone had to remember to run, for a condition that arrives on its own
// schedule. It was never wired to anything, so three tenders closed and nothing
// noticed - the dashboard's Archive view sat empty while all 808 GLI rows read
// 'active'.
//
// This entry point is kept because running it by hand is still useful and the
// run books reference it. It delegates, so the manual path and the automatic
// path cannot drift apart.
//
// It writes LIFECYCLE, never status. status is Philip's triage column
// (new / watchlist / client_ready / dismissed) and no scrape or migration path
// may touch it; lifecycle is the scraper's factual axis (active/expired/dead).
// Only rewrites rows still at lifecycle 'active' (or null), so a row already
// classified is not churned.
//
// Run:      node --env-file=.env.local --import tsx agents/scraper/migrations/retag-dead-expired.ts
// DRY_RUN=1 reports what would move without writing.

import { sweepLifecycle, printLifecycleSweep } from '../lifecycle-sweep';

async function main(): Promise<void> {
  const dry = process.env.DRY_RUN === '1';
  if (dry) console.log('(DRY_RUN=1: nothing will be written)');
  const result = await sweepLifecycle(Date.now(), { dry });
  printLifecycleSweep(result);
  if (!result.complete) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
