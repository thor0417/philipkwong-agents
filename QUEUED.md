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
4. **The weekly cadence.**

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

## 3. THE TWO CLIENT-FACING REGEXES

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
