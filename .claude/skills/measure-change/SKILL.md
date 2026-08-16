---
name: measure-change
description: Cost a gate, taxonomy, exclusion or naming rule before it ships. Use before changing any gate term, exclusion list, junk filter, venue rule, development-category rule, name-shape rule, clustering signal or scope-matching rule - anything that decides what enters the corpus, what a project is called, or what a document may print.
---

# Measure the change before it ships

A rule change is a claim about the whole corpus. Run it over the corpus and read
what it actually does before anyone commits to it.

## 1. Run it without writing

Every measurement harness here reads and reports; none of them writes unless told
to. Use the dry path:

```bash
npm run gate:measure          # precision and recall over the labelled corpus
npm run gate:terms            # what a term change admits and rejects
npm run corpus:snapshot       # the frozen corpus the numbers are taken against
npm run names:audit           # what a naming rule would rename
npm run verify:curation       # what the exclusion set currently holds out
```

If the rule has no harness, write the dry run first. A rule applied to find out
what it does is a rule that has already been applied.

## 2. Report PER MARKET, not per corpus

This is the whole point and it is where this step earns its keep. A corpus
average hides a market-specific harm: a mixed-use gate change measured as a small
net gain, and per market it helped New York and strictly harmed Anaheim.

For each covered market, report:

| market | live records/projects before | after | added | removed |

Twelve markets with a column of zeroes is a useful answer. One market losing a
fifth of its corpus inside a net-positive total is the answer that matters.

## 3. Name anything real it would remove

Not the count. The rows. Title, market, and one line on why it was captured, for
every record or project the change drops. If the list is long, name the ten with
the highest significance and say how many more there are.

This is the step that saved twenty-eight real records from the exclusion set and
stopped the ampersand fold destroying three companies. Both were net-positive by
the aggregate and both were wrong.

## 4. Precision and recall, before and after

`npm run gate:measure`, both sides, with the labelled corpus named and the label
count stated. A precision gain paid for with recall is a decision, not an
improvement, and it cannot be taken without both numbers.

## 5. Then STOP

Report the cost and stop. Nothing applies until Philip has read it.

Do not apply the change and offer to revert. Do not apply it to one market as a
trial. Do not describe the measurement and then implement in the same pass
because the numbers looked good. The output of this skill is a table and a list
of names, and the next thing that happens is Philip reading them.
