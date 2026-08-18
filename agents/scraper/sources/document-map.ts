// THE DOCUMENT MAP. PER STATE: WHICH PORTAL, WHICH DOCUMENT TYPE, WHICH LABELS.
//
// THE OUTPUT OF THE EXPLORATION IS THIS FILE, NOT A CORPUS. A pass that fetches
// documents produces bytes and stops being useful the moment they are stale.
// A pass that produces a MAP - the portal, the document that carries the parties,
// the URL shape that reaches it, and the labels inside it - turns the reader into
// configuration, and then the state is done and we stop exploring it.
//
// So a state moves through exactly three states of its own:
//
//   UNMAPPED    we do not know which document carries the parties.
//   MAPPED      portal, document type, URL shape and label set are all written
//               down here, with the measurement behind each. A reader is now a
//               config entry rather than an investigation.
//   CONFIGURED  a reader consumes this entry. Nothing more is explored.
//
// A state that is MAPPED and not yet CONFIGURED is work anyone can pick up. A
// state that is CONFIGURED and unmapped is the dangerous one, because it looks
// finished: see california below, where the adapter has been running for months
// and has never opened a document.

export type MapStatus = 'unmapped' | 'mapped' | 'configured';

export interface DocumentSource {
  /** What the portal is called by the people who run it. */
  portal: string;
  /** The document type that carries what we are after. */
  document: string;
  /**
   * How to reach it. A TEMPLATE with the identifier named, never a stored URL:
   * every signed URL in this lane expires, and a stored one rots silently.
   */
  urlShape: string;
  /** Which identifier the shape is keyed on, and where we get it. */
  keyedOn: string;
  /** What it yields, and what it does not. Measured, with the numbers. */
  yields: string;
  /**
   * How a value is terminated in this document. The single most important field
   * here: it decides what an extractor can possibly be.
   *
   *   'flattened'  side-by-side form fields join with NO separator, so a value
   *                ends only where the next LABEL begins. The label set IS the
   *                extractor and a label missing from it deletes a field.
   *   'lines'      the label is alone on its line and the value follows it. No
   *                colon. A colon-keyed pattern is blind to this entirely.
   *   'prose'      neither; there are no fields to read.
   */
  shape: 'flattened' | 'lines' | 'prose';
  /** Every label seen, enumerated from real documents. Never guessed. */
  labels: string[];
  /** Where in the document, because a front-pages read misses the back. */
  where: string;
}

export interface StateMap {
  state: string;
  status: MapStatus;
  sources: DocumentSource[];
  /** What is still unknown. Empty only when status is 'configured'. */
  open: string[];
}

// ---- OFFICIALS, EVERYWHERE, ALWAYS ------------------------------------------
//
// Not per state, because the rule is not about a state. A public official who
// receives, signs, chairs or votes on an application is not a party to it.
// Hillary Semel is MOEC's Director and appears on every CEQR submission in New
// York City: reading her as a party would put one official on ninety projects.
//
// Enforced two ways in every reader that consumes this map. BY KEY, because only
// an applicant label may produce a party, so no signature block, letterhead,
// addressee line or title block is ever read. AND BY NAME, below, so that a
// future label change cannot reach them silently. The by-name refusals are
// COUNTED and reported, never dropped quietly.
export const NEVER_A_PARTY = [
  'Hillary Semel', 'Hilary Semel',        // MOEC Director, receives every CEQR submission
  'Kevin D. Kim', 'Kevin Kim',            // SBS Commissioner
  'Daniel Garodnick',                     // DCP Director, CPC Chair
  'Vanessa Gibson', 'Vanessa L. Gibson',  // Bronx Borough President
  'Joseph Russo',                         // Community Board
  'S. Lenard',                            // Community Board
];

export const DOCUMENT_MAP: StateMap[] = [
  {
    state: 'New York',
    // ONE PROBE FROM MAPPED. The portal, the document, the URL shape and the
    // label set are all measured. What is open is the identifier mapping, and
    // that is the last thing between this and configured.
    status: 'mapped',
    sources: [
      {
        // FIRST, BECAUSE IT COSTS NOTHING AND COVERS EVERYTHING. Found by asking
        // the Socrata catalog what is published instead of guessing dataset ids.
        portal: 'NYC Open Data, ZAP Project Data (hgx4-8ukb)',
        document: 'none - it is a published field, not a document',
        urlShape: 'https://data.cityofnewyork.us/resource/hgx4-8ukb.json?project_id={zapProjectId}',
        keyedOn: 'the ZAP project id we already store on every nyc-zap record, e.g. 2024K0444',
        yields:
          'THE APPLICANT, ON 39 OF 39 ZAP PROJECTS. 100%, measured 2026-08-18. Individuals where ' +
          'the applicant is one (Judy Gallent, Eugene Travers, Javier Martinez, Boris Abramov) and ' +
          'entities where it is not (Watershore Views LLC, MSG Arena, LLC, GO Quay LLC). ' +
          'It also carries applicant_type, Private or Other Public Agency, which implements the ' +
          'officials rule at the source: a Private applicant is by definition not a public ' +
          'official acting in their office. ' +
          'Compare the two document routes below: 10 projects from CPC reports, 1 from CEQR ' +
          'Access. NO PDF IS FETCHED, so the 217-seconds-per-document cost does not apply at all.',
        shape: 'prose',
        labels: ['project_id', 'primary_applicant', 'applicant_type', 'ulurp_non', 'ulurp_numbers', 'project_status', 'borough', 'community_district'],
        where: 'one JSON row per project. Every one of our 39 ZAP projects is present in it.',
      },
      {
        portal: 'NYC Department of City Planning (ULURP / CPC)',
        document: 'City Planning Commission report',
        urlShape: 'https://www.nyc.gov/assets/planning/download/pdf/about/cpc/{ulurp6}.pdf',
        keyedOn:
          'the bare six-digit ULURP application number, no suffix: 250085, not 250085MMX. ' +
          'Measured: the suffixed form 404s.',
        yields:
          'THE NAMED INDIVIDUALS, and it is the only document type that carries them. ' +
          'Measured 2026-08-18: 17 of 33 ULURP numbers held in the corpus return a PDF (52%), ' +
          'across 10 distinct projects - Willets Point, Monitor Point, Port Authority Bus ' +
          'Terminal, The Coney, Long Island City Rezoning, Queens Future, 1400 Story Avenue. ' +
          'The 16 that 404 are applications that have not reached a CPC report. ' +
          'Compare CEQR Access, which holds exactly ONE such document across 63 projects.',
        shape: 'flattened',
        labels: [
          // Enumerated from Bally's 250085.pdf. The three that may produce a
          // party are first; the rest exist because in flattened text they are
          // the only thing that can terminate a value.
          'Applicant', "Applicant's Administrator", "Applicant's Primary Contact",
          'Project Name', 'Application #', 'Borough', 'CEQR Number',
          'Validated Community Districts', 'Docket Description', 'Public Hearing Location',
          'Date of Public Hearing', 'Date of Vote', 'In Favor', 'Against', 'Abstaining',
          'RECOMMENDATION', 'CONSIDERATION', 'Certification Date', 'Date', 'Vote Location',
        ],
        where:
          'APPENDED AT THE BACK, not the front. Measured on 250085.pdf, 41 pages: the Borough ' +
          'President Recommendation is on page 23 (54% of the text) and the Community/Borough ' +
          'Board Recommendations on pages 37, 38 and 39 (93%). A front-pages cap misses every ' +
          'one and misses them silently, reporting a zero that reads as a fact about the corpus. ' +
          'Read the whole document. ' +
          "The apostrophe in Applicant's is U+2019, not ASCII; matched on ASCII, two of the " +
          'three party labels never fire.',
      },
      {
        portal: 'NYC CEQR Access (a002-ceqraccess.nyc.gov)',
        document: 'Draft Scope of Work, cover page',
        urlShape:
          'search /ceqr/ by CEQR number, follow Details?data=..&signature=.., then ' +
          '/Handlers/ProjectFile.ashx?file={base64 path}&signature=..',
        keyedOn: 'the CEQR number, e.g. 24DME011X',
        yields:
          'THE APPLICANT ENTITY and THE CONSULTANT, never the individuals. Measured: ' +
          'Bally\'s cover names "Bally\'s New York Operating Company, LLC" and "Langan ' +
          'Engineering... 21 Penn Plaza". 32 draft scopes across 17 of 63 projects.',
        shape: 'lines',
        labels: ['Applicant', 'Lead Agency', 'Prepared By', 'CEQR NUMBER'],
        where:
          'PAGE 1. These labels carry NO COLON - the label is alone on its line and the value ' +
          'follows - so a colon-keyed detector is structurally blind to them and reports zero. ' +
          'Two shapes in one corpus: this one and the flattened CPC form above.',
      },
      {
        portal: 'NYC CEQR Access',
        document: 'Lead agency letter',
        urlShape: 'as above',
        keyedOn: 'the CEQR number',
        yields:
          'IDENTITY AND GEOGRAPHY ONLY, NEVER A PARTY, and this is a settled negative rather ' +
          'than an untested one. The most common document type in the lane - 71 documents ' +
          'across 45 of 63 projects - and read four of them: the only names in one are the ' +
          'commissioner who signs and the MOEC director who receives. Both are officials. ' +
          'Do not fetch these for parties.',
        shape: 'prose',
        labels: ['Re', 'CEQR Number'],
        where: 'letterhead and addressee block, pages 1-2',
      },
    ],
    open: [
      'THE IDENTIFIER MAPPING IS SOLVED AND THE CEILING WAS SOMETHING ELSE. hgx4-8ukb carries ' +
      'ulurp_numbers keyed on project_id, and all 39 of our ZAP projects are in it. From the ' +
      'source: 28 distinct ULURP numbers, against 33 recovered by regex over prose - so the ' +
      'regex was OVER-recovering, not under. The real ceiling is that 12 of the 39 are ' +
      'Non-ULURP actions (chair certifications and the like), and a Non-ULURP action has no CPC ' +
      'report BY DEFINITION. 27 are ULURP, 17 carry numbers. That is the denominator, and no ' +
      'amount of identifier work moves it.',
      '17 of 63 CEQR projects return no Details link from the CEQR Access search. All 17 are ' +
      'PRESENT in the gezn-7mgk dataset with a published url, so this is our search path ' +
      'failing, not a dataset gap.',
    ],
  },
  {
    state: 'California',
    // CONFIGURED AND UNMAPPED, WHICH IS THE DANGEROUS COMBINATION. The adapter
    // has been running for months and looks finished on every dashboard.
    status: 'unmapped',
    sources: [
      {
        portal: 'CEQAnet (ceqanet.lci.ca.gov)',
        document: 'unknown - the adapter has never opened one',
        urlShape: 'unknown',
        keyedOn: 'the SCH number, which the adapter already holds for every record',
        yields:
          'UNMEASURED. CEQAnet is configured, captured and clustered, and not one of its ' +
          'documents has ever been fetched or read. It is the exact position New York was in ' +
          'before this pass: a live lane whose parties are all still inside PDFs nobody opened.',
        shape: 'prose',
        labels: [],
        where: 'unknown',
      },
    ],
    open: [
      'THE NEXT MAP, AND NOT THIS WEEK. Logged here so it is a scheduled piece of work rather ' +
      'than a thing someone rediscovers. The New York pass is the template: probe the portal, ' +
      'find the document type that carries the parties, establish the URL shape and the key, ' +
      'enumerate the labels from real documents, and record where in the document they sit.',
    ],
  },
];

/** The states we could read documents for today, and the ones we could not. */
export function mapSummary(): string {
  return DOCUMENT_MAP.map(
    (m) => `${m.state}: ${m.status}, ${m.sources.length} source${m.sources.length === 1 ? '' : 's'}, ${m.open.length} open`
  ).join('\n');
}
