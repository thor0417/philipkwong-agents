// CLIENT WATCH TERMS REACH THE CAPTURE LAYER, demonstrated rather than asserted.
//
//   node --env-file=.env.local --import tsx agents/scraper/verify-client-watch-terms.ts
//
// THE CLAIM: a term a client names in their scope becomes a query the
// intelligence lane issues, exempt from the curated-domain allowlist, so their
// stated interest changes what the system COLLECTS rather than only what it
// shows them.
//
// Why this needs a test rather than a comment. The chain has four links - the
// intake form writes client_scopes.watch_terms, the run primes them,
// watchTerms() merges them with the target list, watchQueries() groups them into
// searches - and three of those links are invisible from any screen. If the
// priming call is dropped from an entrypoint, nothing breaks, nothing errors,
// and the lane simply searches less. That failure is silent by construction,
// which is exactly the kind this project writes tests for.
//
// No searches are issued. This asserts the QUERIES that would be, which is the
// part that can regress; issuing them would cost money and prove less.

import { pathToFileURL } from 'node:url';
import { primeClientWatchTerms, usableWatchTerm, __setClientWatchTerms } from './client-watch-terms';
import { watchTerms, watchQueries } from './sources/serper';

let pass = 0;
let fail = 0;

function check(label: string, got: unknown, expected: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}`);
  if (!ok) console.log(`       got=${JSON.stringify(got)} exp=${JSON.stringify(expected)}`);
}

async function main(): Promise<void> {
  console.log('===== CLIENT WATCH TERMS -> CAPTURE LAYER =====\n');

  // ---- 1. UNPRIMED IS UNCHANGED --------------------------------------------
  // The state every run was in before clients existed, and the state a test or
  // an un-updated entrypoint is in now.
  __setClientWatchTerms([]);
  const targetsOnly = watchTerms();
  console.log(`  target terms alone: ${targetsOnly.length}`);
  check('an unprimed run searches the target terms', targetsOnly.length > 0, true);

  // ---- 2. A CLIENT TERM JOINS THE PASS -------------------------------------
  //
  // The terms below are deliberately NOT already targets. The first version of
  // this test used 'Simtec' and 'Kulik River Capital' and failed, which looked
  // like a broken merge and was the merge working: both are already in
  // targets.ts, so the case-insensitive dedup kept the target's spelling and the
  // exact-case assertion missed it. A test that cannot tell "already covered"
  // from "dropped" is not measuring the thing it claims to.
  const NOVEL = ['Harrow Leisure Group', 'Pinebrook Waterpark'];
  __setClientWatchTerms(NOVEL);
  const merged = watchTerms();
  check('a client term is searched', merged.includes(NOVEL[0]), true);
  check('and so is the second', merged.includes(NOVEL[1]), true);
  check('the target terms survive', merged.length, targetsOnly.length + 2);

  // ---- 3. THE QUERIES ACTUALLY CARRY IT ------------------------------------
  // The merge is worth nothing if the query builder does not see it, and the
  // query builder is the last link before the network.
  const queries = watchQueries();
  const carrying = queries.filter((q) => q.includes(`"${NOVEL[0]}"`));
  console.log(`  ${queries.length} watch queries, ${carrying.length} carrying the client term`);
  check('the client term reaches an issued query, quoted', carrying.length, 1);
  check('and that query carries no site: restriction', /(^|\s)site:/.test(carrying[0] ?? ''), false);

  // ---- 4. A DUPLICATE COSTS NOTHING ----------------------------------------
  // A client naming a project already watched must not buy a second identical
  // search under a different capitalisation.
  const firstTarget = targetsOnly[0];
  __setClientWatchTerms([firstTarget.toUpperCase()]);
  check('a duplicated term is not searched twice', watchTerms().length, targetsOnly.length);

  // ---- 5. THE TWO SHAPES THAT MUST NOT BE SEARCHED -------------------------
  check('a two-character term is refused', usableWatchTerm('LV'), false);
  // A company name and a surname are the same shape, so no rule separates them.
  // The earlier attempt dropped Simtec, OCVibe and CFTOD to catch Kwong; see
  // client-watch-terms.ts for why that trade is the wrong way round.
  check('a real company name is allowed', usableWatchTerm('Simtec'), true);
  check('a distinctive single token is allowed', usableWatchTerm('OCVibe'), true);
  check('an acronym is allowed', usableWatchTerm('CFTOD'), true);
  check('a multi-word term is allowed', usableWatchTerm('Kulik River Capital'), true);

  // ---- 6. THE LIVE SCOPES --------------------------------------------------
  // Reads what the clients have actually asked for today.
  const priming = await primeClientWatchTerms();
  if (priming.error) {
    console.log(`\n  client_scopes unreadable: ${priming.error}`);
    fail++;
  } else {
    console.log(`\n  live: ${priming.terms.length} term(s) from ${priming.scopes} scope(s)`);
    for (const t of priming.terms) console.log(`    ${t}`);
    const live = watchQueries();
    check('the live scopes contribute at least one term', priming.terms.length > 0, true);
    for (const t of priming.terms) {
      // Case-insensitively: a term already watched under another spelling is
      // covered, which is the dedup doing its job rather than a miss.
      const found = live.some((q) => q.toLowerCase().includes(`"${t.toLowerCase()}"`));
      check(`"${t}" is in a query this run would issue`, found, true);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
