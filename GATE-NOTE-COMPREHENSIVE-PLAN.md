# THE 'COMPREHENSIVE PLAN' GATE HOLE. LOGGED, NOT FIXED.

Logged 2026-09-07, from Philip, before item 3. Written to the repo the moment it
was said, per the standing rule that a thing defined in chat and not on disk
vanishes. See `[[brief-must-be-on-disk]]`.

## The claim, verbatim

> 'comprehensive plan' was removed from the gate and the LLM's free-text path let
> it back in, so the same 71 Broward rows will return on the next capture. Do not
> fix it now. Note it, and when item 4 runs, report whether they came back. If
> they did, that is the gate change to make and it gets costed across every market
> first.

## Why it is not being fixed now

Two reasons, and the second is the one that matters.

**The fresh run is the measurement.** Item 4 runs both lanes over the same
sources that produced those 71 rows. Whether they come back is a fact the run
will state, and a gate change made before it would be a change nobody can prove
was needed.

**And a gate change is costed across every market first.** Standing rule 2, and
it has been paid twice: a mixed-use gate change helped New York and strictly
harmed Anaheim. 'comprehensive plan' is a Broward-shaped term and the markets it
would also touch are not known until they are counted.

## What was tombstoned, so the return can be counted

The cleanout of 2026-09-07 tombstoned 88 live projects, 72 of them Broward, of
which **71 are the housekeeping rows that build no entry at all**. Broward went
from 84 live projects to 12. Every one carries
`status = 'dismissed'` and a dated `notes` line naming the reason.

**NOTHING IS DELETED, WHICH IS WHAT MAKES THIS COUNTABLE.** The tombstoned rows
are still in the table with their project keys and their attached records. If the
next capture re-admits the same matters, they will either resurrect those rows or
create new ones beside them, and both are visible. A hard delete would have made
the return indistinguishable from a first arrival.

## What item 4 must report

1. How many Broward records the government lane admitted, against 23 on the
   2026-09-02 run.
2. How many of them carry 'comprehensive plan' or a variant in the title.
3. Whether any tombstoned project came back to `status = 'new'`, and by which
   path - a resurrection of the same row, or a new project row for the same
   matter.
4. Which gate path admitted them: `governmentGate` in `lib/taxonomy.ts`, or the
   LLM free-text path. Those are different fixes and only one of them is a term
   list.

## And the thing to check before believing the premise

The claim is that the term was removed from the gate and the LLM path let it back
in. Both halves are checkable in the tree and neither has been checked yet:

- is 'comprehensive plan' absent from `GOV_GATE_OUT_OF_VERTICAL` today;
- does the LLM free-text path bypass `governmentGate` rather than run after it.

If the second is false the premise is wrong and the 71 came from somewhere else.
That check costs nothing and is done as part of item 4 rather than assumed.
