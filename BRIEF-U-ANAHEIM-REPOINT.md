# ANAHEIM. THE PLANNING COMMISSION REPOINTED, THE DECISION READ.

Built 2026-09-11. `npm run verify` NPM_EXIT=0. Nothing written to the corpus: the
capture is measured dry and runs in the fresh run, which waits on migration 050.

The measurement this builds on is `BRIEF-U-READER-3-ANAHEIM.md`.

---

## 0. WHAT WAS BUILT

**The lane.** `agents/scraper/sources/anaheim-agendacenter.ts`, wired into the
government adapter table as `anaheim-agendacenter`. It reads
`www.anaheim.net/AgendaCenter`, which answers 200 from this machine, takes the
Planning Commission category id **from the index rather than hardcoding it**, and
lists two calendar years.

**The Council half is untouched.** The Granicus lane still reads Anaheim City
Council and still reports `kept 0` here, correctly: all 51 blocked records are
Council items, Council is not published on AgendaCenter at all, and the weekly
hosted runner remains the only path to it.

**The decision.** Two fields added to `readers/anaheim-agenda.ts`:
`commission_action` and `the_vote`, both `DECISION_FACT_KINDS`.

---

## 1. THE VOCABULARY PASS, BEFORE THE READER

`agents/scraper/diagnostics/anaheim-action-vocab.ts`, NPM_EXIT=0, over every
Planning Commission document the city published in 2025 and 2026.

**Anaheim files each meeting twice and only the second carries a decision.**

| | count | titled ACTION AGENDA | carrying a vote |
|---|---:|---:|---:|
| `Agenda` (the programme) | **44** | 0 | 0 |
| `Minutes` (not minutes) | **33** | **33** | 31 |

The file filed under Minutes opens `CITY OF ANAHEIM PLANNING COMMISSION ACTION
AGENDA` and carries the roll call, the motion and the vote. 33 of the 44 dates
publish one.

**Per pattern, across the 33:**

```
Approved Resolution No. PCyyyy-nnn     29 docs   45 hits
VOTE: n-n(-n)                          31 docs   56 hits
MOTION: (a/b)                          31 docs   57 hits
Continued to <date>                     1 doc     1 hit
Withdrawn                               1 doc     1 hit
Denied / Received and filed             0         0
FP: bare "approval" anywhere           29 docs   75 hits
FP: bare "Approved" anywhere           30 docs   50 hits
```

**65 `ITEM NO.` blocks, 55 carrying a vote.** The action sits immediately before
the `MOTION:` line in every one of them, which is why the reader keys on that
structure rather than on the wording. The wording is not fixed:

```
Approved Resolution No. PC2025-004.
Approved Resolution Nos. PC2025-007 and PC2025-008.
Recommended City Council approval and approved Resolution No. PC2025-005.
Approved Resolution No. PC2025-011 as amended, revising condition number 56...
Approved continuance to a date certain of January 27, 2025.
Recommended City Council approval of DEV2024-00068.
```

**The vote values are all real votes**: 7-0 x27, 6-0 x12, 5-0 x9, 6-1 x3, 4-2,
5-1, 5-1-1, 6-0-1. Nothing that could be a page number.

## 2. THE READER, OVER BOTH SHAPES

| | documents | facts | `commission_action` | `the_vote` | CONDITIONS |
|---|---:|---:|---:|---:|---:|
| ACTION AGENDA | 33 | **486** | **51** | **52** | 0 |
| AGENDA | 44 | 338 | **0** | **0** | 0 |

The reader tells the two apart, so an agenda can never report a decision it has
not seen. The agenda column reproduces the 338 facts measured independently in
the reader 3 probe, which is the cross-check that says both harnesses are reading
the same corpus.

**Conditions stay at zero and no Anaheim document contains one.** The corpus
count is unchanged: 1,474, every one Clark's.

## 3. THE CAPTURE, MEASURED DRY

`agents/scraper/diagnostics/anaheim-agendacenter-dry.ts`, NPM_EXIT=0. The adapter
runs for real and writes nothing.

```
  meetings listed          : 44      (33 with an action agenda, 11 agenda only)
  documents read           : 44
  refused as another body  : 0
  unreadable               : 0
  ITEM LEADS THE GATE KEPT : 16
  already in the corpus    : 0       NEW records: 16
```

The gate admits 16 of the 55 items, which is the gate working: the other 39 are
churches, townhouse tracts, car washes and minor land divisions. Through the
reader, per record, exactly as the write path does it:

```
  records reached   6 of 16      facts 42
  DECISION facts    12           scheme facts 12      CONDITIONS 0
  kinds: application_no 6, site_acreage 6, case_planner 6,
         commission_action 6, the_vote 6, environmental 5,
         site_address 4, cross_streets 2, resolution 1
```

**Anaheim holds 0 records carrying a decision today. This lane brings 6.**

Six is a small number and it is the honest one: only the items that pass the
government gate AND carry a development application number the reader can scope
to are counted. A record carrying a decision is still not a project clearing the
criterion, because it has to cluster onto one first, and that happens in the
fresh run.

**The cost to every other market is zero by construction**: a new adapter under a
new source name, no gate term changed, no taxonomy touched. The one shared file
that moved is `agenda-portal.ts`, and the field added there is optional and
defaults to the current behaviour.

## 4. ONE MEETING, ONE IDENTITY

`leads.url` is the primary key. Anaheim publishes the agenda before a meeting and
the action agenda after it, so capturing both under their own urls would file one
hearing as two records, one of them without the vote, and the weekly cadence
would do it every time.

`MeetingRef.identityUrl` is the fix: the Anaheim lane keys an item on the
**meeting**, so the action agenda updates the item the agenda already captured
and moves `primary_document_url` onto the document that carries the decision.
Optional, defaulting to `agendaUrl`, so Las Vegas and the Granicus lane are
unchanged.

## 5. FOUND, NOT ASKED ABOUT, AND THE BIGGEST THING IN THIS PASS

**A written-out `\b` became a literal backspace in four places, two of them in
code that prints to clients.**

It started as my own defect: two diagnostics were patched through a tool that
wrote the `\b` of a regex as ASCII 0x08, so
`/\x08(VOTE|Motion carried|AYES|NOES)\x08/` could never match. The reader 3 probe
reported **0 of 44 agendas carrying vote language** and that figure was
committed. Re-measured after the repair, the 0 is correct - the agendas genuinely
carry no vote - so the conclusion held and the evidence for it had not existed.

Swept for the four characters a mangled escape produces (BEL, BS, VT, FF) across
every `.ts` and `.tsx` under `agents/`, `lib/` and `dashboard/lib`. **Two hits,
neither mine, both client-facing:**

- **`dashboard/lib/people.ts:439`** reads `/\x08([a-z])\s(?=[a-z]\x08)/g` where
  `/\b([a-z])\s(?=[a-z]\b)/g` was meant. It is the pass that folds a run of
  single letters so "u s" becomes "us" and two spellings of Walt Disney Parks and
  Resorts merge. **It has never fired.** The file's own comment says exactly two
  bodies are still split, and this is why.
- **`dashboard/lib/report-entry.ts:1314`** reads
  `/\x08(inc|llc|l l c|lp|llp|corp|co|company|ltd|dpc|pc|the)\x08/g`, the suffix
  stripper inside `dropCircularPrefix`'s key. **It has never stripped a suffix**,
  so the rule that removes a company name repeated at the start of its own
  summary fires less often than it was written to.

**Neither is repaired here.** Both change what a client document prints, standing
rule 2 says that is costed per market first, and changing it in the middle of an
Anaheim capture is how an unrelated regression gets attributed to the wrong
change. Golden case `a-control-character-inside-a-regex`, guard `pending`,
`closedBy` naming the measurement each needs.

**And the control characters that are deliberate are named so the rule does not
get turned off:** `company-hygiene.ts` and `http.ts` both carry literal 0x00-0x1f
inside character classes that exist to match control characters,
`nyc-city-record.ts` replaces a literal 0x1a left by a smart quote, and
`document-shape.ts` quotes the zip magic bytes in a comment. A blanket rule flags
all four.

## 6. THE OTHER DEFECT, CAUGHT BEFORE IT PRINTED

The action pattern first read `(?:Approved|Recommended|Denied|...)` with no
leading word boundary, and on the 2025-01-27 action agenda it matched inside
**"CEQA does not apply to disapproved projects"**, storing the commission's
action as `approved projects. Approved Resolution No. PC2025-003.`

The substring is the **negation** of the match. Golden case
`a-negation-read-as-its-opposite`, guarded, asserting the real sentence.

## 7. WHAT IS LEFT

- **The fresh run** captures these 16 records. It waits on migration 050.
- **The market standard** moves when those records cluster. Anaheim reads 11
  party, 2 facts, 0 decision today; this lane is the first Anaheim decision the
  corpus has ever held, and whether it clears the criterion is a fact about
  clustering that can only be measured after the run.
- **The two dashboard regexes** need their costed pass.
