---
name: gate
description: Run the full verification gate before any commit. Use whenever a change is ready to commit, when about to run git commit, or when asked whether the suite is green, whether anything is red, or whether it is safe to push.
---

# The gate

Six suites. Each one runs on its own line and its exit code is read on its own
line. Never chain them with `&&` into one command and never pipe the whole thing
into `tail` without `pipefail`: a verify piped to tail has produced a false green
here twice, because the exit code reported was tail's.

Run from the repository root.

```bash
set -o pipefail

# 1. Root: typecheck plus every scraper suite.
npm run verify; echo "ROOT=$?"

# 2. Dashboard typecheck, separately from the build.
cd dashboard && npx tsc --noEmit; echo "DASH_TS=$?"

# 3. Dashboard build. Separately, because a green typecheck and a red build
#    have happened on the same tree.
npm run build 2>&1 | tail -5; echo "DASH_BUILD=$?"

# 4. The full Playwright suite. Needs a server on :3000. Prefer a production
#    server (npm run start) over `npm run dev`: this repo lives inside OneDrive,
#    which locks .next/types and makes long dev-server runs fail with EBUSY in
#    ways that look like product defects.
npm run start > /tmp/prod.log 2>&1 &
npx playwright test 2>&1 | tail -40; echo "SHOTS=$?"

# 5. Does every generated document state what it withheld.
npm run audit:exclusions; echo "EXCLUSIONS=$?"

# 6. Is any configured jurisdiction reading a dead feed.
cd .. && npm run verify:staleness; echo "STALENESS=$?"
```

## Report the real exit code of each

Print the six numbers. Not "all green" - the numbers. A suite whose output
scrolled past is a suite nobody read.

## A suite that has been failing for several sessions is not a known issue

It is an ungated gate. Report it as RED, with the count, and say what makes it
red. Do not carry it forward as background noise, do not describe it as
pre-existing without also giving the number, and never let "it was already
failing" stand in for a decision about whether to ship.

If a failure is genuinely not caused by the change in hand, prove it rather than
asserting it: stash the change, rebuild, re-run the failing suite, and report
that it still fails. Attribution by argument is not attribution.

## Known standing reds, with their cause

These are red on purpose and the cause is data, not code. Check them against this
list before diagnosing anything:

- Six client-document tests (`report.shots` x2 modes, `client-scope.audit` x2,
  `report-scope.audit`, `scope-match.audit`) fail whenever `client_projects`
  holds no `included` row. The membership gate is refusing an unconfirmed set,
  which is the gate working. `select status, count(*) from client_projects
  group by 1` before treating any of them as a regression.

## Before the commit itself

`tsc --noEmit` clean and `npm run build` passing, gated separately. One commit
per component. Push, then confirm the ref with `git rev-parse HEAD` and
`git rev-parse origin/main` and show that they match.
