# QUEUED. MEASURED, NOT SHIPPED.

Work that has a number behind it and has deliberately not been built. Each entry
states what was measured, what it would cost, what decides it, and where it sits
in the order. A thing agreed in conversation and not written here vanishes.

Last updated 2026-09-12.

---

## THE ORDER, AS IT STANDS

1. **The fresh run.** Unblocked: migration 050 applied 2026-09-12 and the corpus
   read back correct.
2. **The two client-facing regexes**, costed per market. Moved ahead of the
   cadence by Philip on 2026-09-12, because both are things a reader sees and
   neither has ever worked.
3. **The body-read gate for Legistar markets**, costed per market.
4. **The weekly cadence**, which entries 3 and 4 below both make sharper: it is
   the run nobody watches.

---

## 1. THE BODY-READ GATE FOR LEGISTAR MARKETS

**Queued 2026-09-12. To be costed AFTER the fresh run, per Philip.**

**What was measured.** `BRIEF-U-READER-4-PHOENIX.md`. A Phoenix rezoning title is
a case number and a cross street - "Amend City Code - Ordinance Adoption -
Rezoning Application Z-79-26-8 - Approximately 100 Feet ..." - so a hotel PUD and
a warehouse rezoning are the same string to `governmentGate`, which judges the
title. Over the newest 1,000 Phoenix matters, 49 are entitlement-shaped and all
49 were opened:

| | |
|---|---:|
| admitted on the TITLE alone | **3** |
| admitted once the BODY is read | **21** |
| reachable ONLY through the body | **18** |
| genuinely hospitality, read by hand | **3** |

**The number to beat: 21 admitted to reach 3.** The three are a General Plan
Amendment to facilitate a hotel, `Z-87-E-03-2 Plaza Companies Hospitality PUD`,
and a rezoning proposing a grocery store with a banquet hall. None is in the
corpus; they never arrived.

**The risk is the Broward shape.** The 18 body-only admissions are the same false
positives a venue regex found in those bodies: a parking ratio reading
"Restaurant: 1 space per 50 square feet", an adjacent golf course, the
`GC (Golf Course District)` a site is being rezoned FROM, and a half-inch REBAR.
Broward is the precedent: a Clark field set pointed at Broward fired
`land_use_plan` on 63 of 86 documents, 73%, and extracted sentence fragments.

**What decides it.** `npm run gate:measure` over the labelled corpus with bodies
included, plus the per-market admitted count before and after. Standing rule 2: a
rule that helps one market and strips another has already happened twice. The
per-market half is not optional here, because the cost is borne by Broward and
Clark, which publish long documents, while the gain is Phoenix's.

**What it is not.** It is not a reader. Phoenix's documents, once admitted, are
staff reports with an acreage, a location and a request, which the existing field
sets already read.

---

## 2. PHOENIX'S TWENTY LIQUOR-LICENCE PROJECTS

**Queued 2026-09-12. A cleanout question, not a reader question.**

**The count: 20 of Phoenix's 20 live projects are liquor licences.** Measured
2026-09-11 by `agents/scraper/diagnostics/reader-four-probe.ts`, NPM_EXIT=0.

Their names read like the vertical and the register treats them as projects:

```
  AC Hotel By Marriott City North and Element Hotel City North    Cambria Hotel Downtown Phoenix
  Aloft Hotel Phoenix Airport                                     AC Hotel Biltmore
  Fire N Ice Hotel            Fire N Ice Arena                    Hotel Embarque
  Denu Hotel & Spa            Arena Sports Grill                  Arizona Coliseum
  Children's Museum of Phoenix                                    Shemer Art Center museum
  Hospitality United          Laveen Baseline                     Halle Properties
  TSMC Arizona                CivicGroup                          Pennrose
  Grand Canyon University     Tohono O'odham Nation Tribal 2025 Gaming Grants
```

Every one is a `License - Liquor` matter. The project is the licence, not the
hotel. Brief Q's judge bucketed 18 of the 20 as instruments and was right.

**Philip's read, 2026-09-12: a licence for a named new hotel is a LATE SIGNAL,
not entitlement intelligence.** That is the disposition to apply.

**What is not yet decided.** Whether they are tombstoned, kept with a lifecycle
that says what they are, or kept and excluded from documents. All three are
defensible and they differ in what a client sees:

- tombstoning removes 20 of Phoenix's 20 live projects and leaves the market
  holding nothing, which a client document then has to state.
- a lifecycle keeps the signal and stops it ranking as a development.

**What decides it.** The same cleanout machinery Brief U item 5 used, run over
these 20 with the buckets re-read, and the holdings count re-run after so the
quality change is a number. Nothing is hard deleted: standing rule 6.

**Note for whoever picks it up.** Phoenix carries 0 records with a filing fact
and 0 contacts, and `verify:market-standard` reads Phoenix 20 live, 20 party, 0
facts, 0 conditions, 0 decision. Removing the 20 does not lose a fact, because
there are none to lose.

---

## 3. A PAGE-LEVEL RETRY FOR LEGISTAR

**Queued 2026-09-12, from the fresh run.**

**What was measured.** The government lane took THREE passes to complete, with no
code change between them:

| pass | Legistar jurisdictions in |
|---|---|
| 1 | **0 of 7** - every Matters request timed out |
| 2 | 4 of 7 |
| 3 | **7 of 7**, zero timeouts, Clark pulling 427 matters over 3 pages |

Hand-run, the adapter's exact query answers in 2.6 to 3.8 seconds against a 30
second timeout (`clark 200, 336,797b, 3.84s`). It is the connection, not the
query.

**The cost of not fixing it.** Pass 1 lost seven markets and roughly 123 records.
The run reported it correctly - `*** TRUNCATED ***`, `PARTIAL HARVEST`, and a
`TOTAL DEATH` alarm against a baseline of 123 - and then stopped. **Nothing
retries.** I noticed and re-ran three times by hand. On a Monday, under the
weekly cadence, nobody does that: the job finishes green, `PARTIAL HARVEST` sits
in the middle of a long report, and the week is silently short.

**What decides it.** Whether a page-level retry belongs in `fetchJson` for this
adapter or in the lane around it, and how many attempts before the honest
`incomplete` verdict is the right answer rather than a cover for a dead feed.
The existing behaviour must survive: a feed that is genuinely dead still has to
report `PARTIAL HARVEST` rather than retry forever.

---

## 4. SERPER CREDITS AS A MONITORED PREREQUISITE

**Queued 2026-09-12, from the fresh run. Philip's to top up; the check is ours.**

`npm run scrape:all` on 2026-09-12 wrote nothing:

```
Serper "...": failed: HTTP 400 - Not enough credits     (every query)
TOTAL DEATH  fetched nothing  adapter:serper  [fetched 0, kept 0, usually 731.7]
```

**Serper is the only active source in that half of the run** - `Fetched per
source: 0 serper` - so feasibility, TED CPV, GLI Tier 1 and the fuel module all
reported zero behind it.

**The failure presents as `NPM_EXIT=0`.** The alarms fired; the exit code did
not. A weekly job would look green.

**What decides it.** Whether the prerequisite check that already runs before the
weekly capture - the six required secrets - should also cost one Serper call and
refuse the run with a named reason when the account has no credit. That is the
same shape as checking the secrets: a prerequisite that is cheaper to test than
to discover.

---

## 5. THE TWO CLIENT-FACING REGEXES

**Queued 2026-09-11, promoted ahead of the cadence 2026-09-12.** Golden case
`a-control-character-inside-a-regex`, guard `pending`.

Both carry a literal backspace where a `\b` was meant, so both have never fired.

**`dashboard/lib/people.ts:439`** reads `/\x08([a-z])\s(?=[a-z]\x08)/g` where
`/\b([a-z])\s(?=[a-z]\b)/g` was meant. It folds a run of single letters so "u s"
becomes "us" and two spellings of one body merge. The file's own comment says 11
bodies are written more than one way, 9 of them already fold, and exactly two are
still split - Walt Disney Parks and Resorts, and FirstFlight Heliports d/b/a
against dba. **The measurement is how many parties merge and whether any merge is
wrong.** A merge that joins two different bodies is the failure to look for.

**`dashboard/lib/report-entry.ts:1314`** reads
`/\x08(inc|llc|l l c|lp|llp|corp|co|company|ltd|dpc|pc|the)\x08/g`, the suffix
stripper inside `dropCircularPrefix`'s key. It has never stripped a suffix, so
the rule that removes a company name repeated at the start of its own summary
fires less often than written. **The measurement is how many summaries change in
a generated document, read back as the recipient.** Repairing it makes the rule
fire MORE, so the risk is a prefix dropped that was not circular.

**Both change what a client document prints**, so standing rule 2 applies and the
read-back skill is the check.
