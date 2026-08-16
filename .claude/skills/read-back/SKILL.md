---
name: read-back
description: Generate a document and read it as the recipient. Use whenever the report builder, referral brief, report sections, report entries, report model, people extraction, party or contact layer, project summaries, or project naming has been touched, and before claiming any document-related work is done.
---

# Read it back as the recipient

A document that has not been generated and read is not verified, whatever the
tests say. Every acceptance failure in this project traces to this step being
skipped: the suite was green, the document was wrong, and nobody had looked at
one.

## 1. Generate at least two

A market report and one referral brief. They fail differently - the report fails
on aggregation and coverage, the brief fails on a single project's parties and
sentences.

```bash
cd dashboard
npm run start > /tmp/prod.log 2>&1 &
npx playwright test e2e/report.shots.ts --project=light
# documents land in dashboard/e2e/shots/documents/
```

If the composer is gated (see the membership note in `gate`), generate the
INTERNAL report - no client selected - so there is a document to read at all,
and say in the report that the client path was gated and why.

## 2. Paste three things, verbatim

- the cover, in full
- one complete project entry, including its PEOPLE section
- the coverage note

Verbatim. Not a summary of them, not a description of what they contain. The
defects this catches are in the wording, and a summary is where the wording goes
to hide.

## 3. Now read as the recipient, not as the builder

The builder reads for whether the code did what it was told. The recipient reads
a document about their market from someone they are paying. Answer each of these
in one line, with the evidence:

1. **Does every stage change match what the records say?** A project printed as
   "approved" whose newest filing is an application is a claim about a public
   body's decision.
2. **Does any entry report a project as anonymous whose parties we hold?** Cross
   the entry against the project's people. "No parties identified" over a filing
   naming an applicant is the worst sentence this system can print.
3. **Does any description sentence describe something other than the project?**
   The classic shape: the sentence describes the applicant's other business, the
   agenda item's procedural wrapper, or the street rather than the site.
4. **Does any record line fail to read as a sentence?** Truncated titles,
   doubled punctuation, a case number where a name should be, ALL CAPS company
   names, a line ending mid-clause.
5. **Is any party printed twice?** Under two roles, two spellings, or once as a
   person and once as their firm.

## 4. Say what you would not send

End with the sentence a person would actually say: would Philip send this
document, unedited, to someone paying for it? If not, name the entry and the
line. "It generated successfully" is not an answer to that question.
