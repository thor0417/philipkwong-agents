// A NEW YORK CITY PLANNING COMMISSION REPORT, READ FOR THE THREE THINGS IT
// STATES UNAMBIGUOUSLY.
//
// New York is the largest market in the corpus and every New York project
// carries ZERO conditions, while one Clark County project carries 51 - because
// Legistar attaches staff reports and we read them. This is the New York
// equivalent, and it is reachable: a CPC report is published at
// nyc.gov/assets/planning/download/pdf/about/cpc/<ULURP>.pdf, and 13 of the 28
// ULURP numbers the corpus holds return one.
//
// ---------------------------------------------------------------------------
// IT DOES NOT READ CONDITIONS, AND THAT IS A DECISION RATHER THAN AN OMISSION.
// ---------------------------------------------------------------------------
//
// Measured: the Clark conditions extractor, run over three real CPC reports,
// returns 0, 5 and 0 conditions - and the 5 are an accident of one report
// containing a literal "CONDITIONS:" line. It keys on CONDITIONS OF APPROVAL
// headings, bullet characters and a CLOSED LIST OF EIGHT CLARK COUNTY
// DEPARTMENT NAMES. A CPC report has none of those.
//
// The two documents are not the same kind of document. Clark publishes an
// ADMINISTRATIVE CHECKLIST - departments, bullets, numbered conditions. New
// York publishes a LEGAL RESOLUTION - RESOLVED clauses and obligations in
// prose, 8 occurrences of "shall" across 163 pages. Reading the second needs a
// reader for legal resolutions, which is its own build and would also reach any
// other jurisdiction that publishes decisions that way. It is NOT a New York
// special case bolted onto this one. See the golden case
// a-legal-resolution-is-not-an-administrative-checklist.
//
// ---------------------------------------------------------------------------
// WHAT IT DOES READ, AND WHY ONLY THESE.
// ---------------------------------------------------------------------------
//
// Three anchors, each read off real reports BEFORE a pattern was written, then
// run over seven of them. Result: applicant 7 of 7, decision 7 of 7, vote 5 of 7
// - the two without a vote fact record no exception, which is a different
// statement from an unread vote and is why nothing is emitted for them.
//
//   IN THE MATTER OF an application submitted by <X> pursuant to
//   The above resolution (<number>), duly adopted by the City Planning
//     Commission | the CPC on <date> (Calendar No. N)
//   Commissioner, VOTING NO | ABSTAINING | RECUSED | ABSENT
//
// AND THE ONE I REFUSED. "In Favor" appears in every report and is NOT the
// Commission's vote: in 250108 it is public testimony ("in favor of the
// application and 11 in opposition"), and in 230070 it is the COMMUNITY BOARD's
// vote ("in favor, none opposed and none abstaining"). Taking either and
// printing it as the Commission's decision is a label read as the thing it
// names, which is the defect this repo has paid for most often. The vote fact
// below is built only from the exception markers, which appear nowhere else.
//
// THE APPLICANT IS NOT ALWAYS A PRIVATE PARTY, and the reader cannot tell. Of
// the seven: five are private (TSG Coney Island Entertainment Holdco LLC,
// Queens Future LLC, BR-2012 Realty LLC, GO Quay LLC, Queens Development Group
// LLC), one is a public authority (The Port Authority of New York and New
// Jersey) and one is a city agency (the New York City Department of City
// Planning). The report states no type, and applicant_type is published by ZAP
// alone - so anything written to the applicant column arrives UNGATED and would
// print an agency as a party to approach. That is the defect gated out of
// presented_by this afternoon, and it must not come back through this door.
// Whether the applicant is written at all is a decision for the capture path,
// not for this reader; readCpcReport reports what the document says and stops.

import { tidyLine, type FilingFact } from './core';

/** True when the text is a City Planning Commission report. */
export function isCpcReport(text: string): boolean {
  return (
    /CITY PLANNING COMMISSION/i.test(text) &&
    /IN THE MATTER OF\s+an application submitted by/i.test(text)
  );
}

// The applicant, from the first line of the matter. The name runs to
// "pursuant to", which every report uses - it is the Charter citation that
// follows the party in a ULURP application.
const APPLICANT_RE =
  /IN THE MATTER OF\s+an application submitted by\s+([\s\S]{3,180}?)\s+pursuant to\b/i;

// The decision, with its date and calendar number. Anchored on the resolution's
// own filing sentence rather than on the word RESOLVED, which opens several
// clauses in the same document.
// THE COMMISSION ABBREVIATES ITSELF, and one report in seven does. 250224 reads
// "duly adopted by the CPC on September 3, 2025" where the other six spell it
// out, so a pattern keyed on the full name silently returned nothing for it -
// the missing-entry-deletes shape the nyc-records header list warns about.
//
// THE CAPTURED GROUP IS THE DISPLAY, AND IT MUST BE VERBATIM. verifyFilingFacts
// refuses any fact whose `display` is not a substring of the document and of its
// own `line` - the guard that makes a client able to check a value against the
// filing. A first version built the display from parts ("adopted May 7, 2025
// (Calendar No. 10)") and would have been rejected by it, correctly: a
// reassembled string is not a quotation. So group 2 spans the document's own
// words from "adopted" to the closing parenthesis.
const DECISION_RE =
  /The above resolution\s*\(([^)]{6,24})\)[,\s]*duly (adopted by the (?:City Planning Commission|CPC) on\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}\s*\(Calendar No\.\s*\d+\))/i;

// The exception markers. Each is a literal the report uses ONLY in the
// Commission's own vote block.
//
// ABSENT IS HERE AND IT IS NOT DISSENT. A commissioner who did not vote is
// recorded the same way one who voted no is, and leaving it out both undercounts
// the block and - worse - made the extracted LINE start at an unrelated
// "Commissioner," earlier in the name list. The label below says exceptions
// rather than dissent for the same reason: absent is not a vote against.
const EXCEPTION_RE = /Commissioner,\s*(VOTING NO|ABSTAINING|RECUSED|ABSENT)/gi;

/** What a CPC report states about its applicant, its decision and its vote. */
export interface CpcReading {
  /**
   * The applicant as the report names it. Goes to the record's `applicant`
   * column rather than to a fact, because the party layer reads that column and
   * a party is not a figure.
   */
  applicant: string | null;
  facts: FilingFact[];
}

export function readCpcReport(rawText: string): CpcReading {
  if (!isCpcReport(rawText)) return { applicant: null, facts: [] };
  // The report is a PDF text layer: a name is broken across lines and padded.
  // Flattened for matching only; every `display` below is taken from the
  // flattened text and is a verbatim substring of it.
  const flat = rawText.replace(/\s+/g, ' ').trim();
  const facts: FilingFact[] = [];

  const applicantHit = APPLICANT_RE.exec(flat);
  const applicant = applicantHit ? tidyLine(applicantHit[1]) : null;

  const decision = DECISION_RE.exec(flat);
  if (decision) {
    facts.push({
      kind: 'commission_action',
      // The document's own words, not ours. It is a Commission action in the
      // same sense Clark's COUNTY COMMISSION ACTION is, so it shares the kind
      // and prints in the same block.
      label: 'City Planning Commission action',
      display: tidyLine(decision[2]),
      value: null,
      line: tidyLine(decision[0]),
    });
  }

  // A vote fact ONLY where the Commission's own dissent markers appear. No
  // marker means the resolution carried without recorded dissent, which is a
  // different statement from "we did not find a vote" - so nothing is emitted
  // rather than a guess either way.
  const hits = [...flat.matchAll(EXCEPTION_RE)];
  if (hits.length > 0) {
    const counts = new Map<string, number>();
    for (const h of hits) {
      const k = h[1].toUpperCase();
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    // ANCHORED ON THE FIRST MARKER, not on the first "Commissioner," in the
    // document. The name list above the block contains that string several
    // times, so anchoring there produced a `line` that began in the middle of
    // an unrelated roll call and did not contain the fact it was evidence for.
    const first = hits[0].index ?? 0;
    const lastHit = hits[hits.length - 1];
    const end = (lastHit.index ?? first) + lastHit[0].length;
    // VERBATIM, FOR THE SAME REASON THE DECISION IS. The counts are a reading of
    // the block and go in `value`; the DISPLAY is the block itself, so a reader
    // checking the fact meets the document's own words and the names in them.
    const span = tidyLine(flat.slice(first, Math.min(end, first + 320)));
    facts.push({
      kind: 'the_vote',
      label: 'Commissioners recorded as an exception on the vote',
      display: span,
      value: hits.length,
      // Bounded, because a CPC report's text layer runs the vote block straight
      // into a map's stray labels - "44 TH BLVD. ST. 45 TH ST." - and a reader
      // checking the fact should meet the vote, not the diagram.
      line: span,
    });
  }

  return { applicant, facts };
}
