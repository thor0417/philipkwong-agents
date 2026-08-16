---
name: sweep
description: Find every instance of a defect's shape before fixing the one. Use immediately after any defect, bug, wrong value or wrong label is identified, and before writing the fix.
---

# Sweep for the shape, then fix

A defect is an instance of a shape. Fixing the instance leaves the shape, and the
shape reappears somewhere nobody was looking. Six defects last month were the
same shape, found separately, weeks apart: a label read as the thing it names.

## 1. Name the shape in one sentence, generalised past the instance

Not "Hudson Yards absorbed the Port Authority Bus Terminal". That is the
instance. The shape is: **a records-level identifier that names a DISTRICT is
being used as if it named a PROJECT.**

The generalisation is the whole value of this step. Written too specifically it
finds nothing; written as the shape it finds the other five.

## 2. Search for every other place the shape could exist

Both halves, and the second is the one that gets skipped:

- **The code.** Every other site that reads the same kind of value the same way.
- **The corpus.** Every row that currently carries the wrong value because the
  shape has already fired there. A fix that leaves the bad rows in place is a
  fix that has changed nothing a client can see.

**Run the search in a subagent.** Ten greps and forty file excerpts are exactly
the intermediate results that should not be in the main conversation; what comes
back is the list.

## 3. Report the list BEFORE fixing anything

The shape, the instances found, and for each: file and line, or row count and
market. Then fix, and say which instances the fix covers and which it does not.

## Shapes already recorded here

Recognise these; a new defect is usually one of them again.

- a district name read as a project name
- a zoning code read as a venue
- a capture date read as an event date
- a verdict read as a decision
- an applicant's company name read as a venue word
- a representative read as the subject of a matter
- a period scope applied to a property of the project
- a label read as the thing it names (the general form of the six above)
- a stale read that beats an invalidation and reports the previous value as
  current (the pager, the audit cleanup, and the client bar have each done this)
- an "All" that is not all, because it sums the named values and omits the nulls
- a filter that fails OPEN and returns the parent set instead of the empty set

## Adding to this list

A shape found here is worth more than the fix. Append it above, and add its
golden case to `agents/scraper/fixtures/golden.jsonl` per standing rule 7.
