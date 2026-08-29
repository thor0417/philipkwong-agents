# BRIEF U. EVERYTHING LEFT.

Received 2026-08-29. Written to the repo before starting, per the standing rule
that a brief defined in chat and not on disk vanishes.

This is the whole outstanding list in one brief. Work through it top to bottom.
Confirm each numbered item before the next, but do not wait on me for anything
inside an item unless it says so.

## Standing rules

Measure before you build. A rule ships with the count behind it and the cost
per market stated. Ask what a source publishes as a FIELD before opening a PDF.
Read the body, not the status code. Never fabricate: a URL you cannot source
from an adapter or a named statewide register is not evidence, and a NONE on an
invented URL is fabrication with a status code attached. Nothing is silently
absent. Sweep for the shape before the fix is committed. State the cap beside
any figure from a capped read. NPM_EXIT from the captured line on every gate.
Migrations are printed, never run from code.

Do not run a git commit while a Playwright suite is live. The pre-commit hook
rebuilds `.next` under the running server and tears the bundle. It has already
cost one twenty-minute cycle.

---

## 1. THE SCORECARD PROBE, FIXED AND RE-RUN

The probe ran from a clean US egress and then refused its own results, which was
right. Four faults, three of them breaking the rule the workflow's own header
states.

Fix all four before re-running:

- The Matters query was broken and answered anyway. Fix the URL encoding.
- The body-name pattern matched a person rather than a body. Make it unable to.
- Five invented URLs produced five recorded findings: Anaheim L2 NONE, Anaheim
  L4 NONE, NYC L9 NONE and two L8 BLOCKED. Remove every URL that is not already
  in an adapter or a named statewide register. If a layer has no sourceable
  URL, it prints NEEDS-NAVIGATION.
- The classifier called a 39-byte page DOC because it only rejects thin pages
  when scripts are present. A page with no scripts and no text is not a
  document.

Then re-run on the hosted runner and fill the 90 cells. Nine scored markets,
two deferred, two withdrawn, all already written into MARKET-CHECKLIST.md.

Every cell carries its evidence. A cell you cannot evidence is
NEEDS-NAVIGATION, never a guess.

---

## 2. VERIFY:STALENESS COMES OUT OF THE PRE-PUSH HOOK

Six runs, five different markets, every time HTTP 0 against feeds that answer
200 on the adjacent run. It is measuring this machine's connection and it
blocks releases. It cost a twenty-minute cycle today with production down.

It is the same finding as scorecard rule 1 arriving through the gate instead of
the grid: a network verdict recorded from a developer's connection is a fact
about the developer.

Move it to the hosted runner, where a dead-feed verdict is admissible. Keep it
as a check, remove it from the blocking hook, and state in the file why.

---

## 3. THE PRE-COMMIT HOOK REBUILDING UNDER A RUNNING SERVER

Documented in CLAUDE.md and it still fires. It tore a Playwright run today.

Report what it would take for the hook to refuse rather than tear: detect the
listening server and fail with the reason, or build somewhere else. Then fix
it. A documented trap that keeps firing is not documented enough.

---

## 4. THE READERS THAT ADD PROJECTS

This is the work that changes what a reader sees. Brief T ranked it and the
egress question has since closed, so items 2 and 4 are no longer blocked.

In this order, each measured before and after:

  1. Legistar attachment PDF reader. 19 projects off zero, 47 PDFs already on
     disk, no fetch needed.
  2. Las Vegas PrimeGov. 22 projects. Reachable from the runner.
  3. Anaheim Granicus. 9 projects. Reachable from the runner.
  4. Phoenix. 20 projects. Genuine fetch gap, 1 document across 42 records.

Report per reader: records read, facts extracted, projects moved off zero, and
whether any of it reaches the market standard. None of these emits a condition
today and I expect that to stay true; say so plainly if it does.

---

## 5. CLEAN OUT WHAT WILL NEVER MAKE IT

The register holds 416 live projects and 45 are hospitality developments.
Brief Q's audit classified every one. Use that classification.

Report first, change nothing:

- how many live projects are instruments rather than projects
- how many are developments outside the vertical
- how many are municipal housekeeping that cleared the gate on a word
- how many build no entry at all, which was 76 and unmeasured

Then propose the removal. Tombstone, never delete: lifecycle marked, reason
recorded, nothing leaves the corpus.

Two constraints. A gate change gets costed across every market before it ships,
because a rule that helps one market and strips another has already happened
twice. And re-run the holdings buckets after, so the quality gain is a number
rather than a claim.

---

## 6. A FRESH RUN

Both lanes, full capture, after 4 and 5.

`npm run scrape:government` then `npm run scrape:all`. Government first.

Snapshot with a label before and after. Then the movement report: new projects,
new records on existing projects, stage changes, per-source volume against the
last run, and the emit ledger.

Then judge what arrived, using the same buckets as item 5, so I can see whether
the new arrivals are better than the last batch. Paste the twenty strongest by
name.

---

## 7. THE WEEKLY CADENCE

The last item in Brief S and the last thing before this is a product.

GitHub Actions. Four secrets. The smallest version that could run next Monday,
not the complete one.

Report before building: the cycle in order from capture to a file in an inbox,
where each step exists and where it does not, what decides which clients get a
document, what a week with nothing to report should send, and where an alarm
lands when nobody is watching.

Then build it.

---

## WHAT DONE LOOKS LIKE

The grid is filled with evidence on every cell. The gate stops failing on my
wifi. Four readers have run and the register says how many projects each moved.
The junk is tombstoned with a count. A fresh capture has run and been judged.
And a document arrives on Monday that I did not trigger.

Item 7 is the one that matters. Everything above it is what makes it worth
receiving.
