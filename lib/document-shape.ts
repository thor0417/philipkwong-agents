// IS THIS A FETCHED FILE, OR A PAGE THAT LISTS FILES?
//
// IMPORT-FREE, and read across the package split by both packages, for the same
// reason lib/dead-feeds and lib/junk-domains are: a mirrored copy is a copy that
// goes stale, and the stale half decides what a client is told.
//
// THE DEFECT IT ANSWERS. Golden case `a-listing-page-stored-as-the-document`,
// opened 2026-08-25 and measured over 2,410 records paged to exhaustion: 579
// undismissed records carry a `primary_document_url`, and 299 of them point at a
// page rather than a file. Clark County's 245 are real files - `.pdf` on
// www.clarkcountynv.gov and clark.legistar1.com - and 169 of those produced
// filing facts. Las Vegas's 45 are all `lasvegas.primegov.com/Portal/Meeting`
// and are 27 DISTINCT meetings, so the pile that read as "45 unread documents we
// already hold" is 27 meeting pages and no documents at all, and the work it
// needs is a fetch rather than a reader. That inverted the build order for Las
// Vegas on first reading, which is the measured harm: a cost model that counts a
// viewer page as a staff report.
//
// AND ONE HALF OF THAT CENSUS IS CORRECTED HERE, BY PROBE RATHER THAN BY
// READING THE URL. The census said Anaheim's stored values are all
// AgendaViewer.php pages and that not one of the 299 is a file. Both hold for
// the population it read - every stored value - and neither holds for the 26
// records whose has_primary_document is actually TRUE. Fetched 2026-09-02:
// Anaheim's 21 are `DocumentViewer.php?file=<name>.pdf`, which answers 200 with
// application/pdf and the magic bytes %PDF-1.7; New York City Record's 5 are
// `Search/GetFile?...DocumentID=N`, which answers 200 with a .docx. Both are
// files. The census inferred from the host and the path; this file probed. Where
// they disagree the probe wins, which is the same rule as reading the body
// rather than the status code.
//
// THREE ANSWERS, NOT TWO, AND THAT IS THE WHOLE DISCIPLINE HERE. A URL we cannot
// classify is `unknown`, never quietly counted as either. Two answers would make
// every new portal shape read as a file the day it appeared, which is the same
// failure one level down: a default standing in for a measurement.
//
// THIS FILE DECIDES NOTHING ABOUT CAPTURE. It does not gate a write and it does
// not change what any adapter stores. The larger question the golden case
// leaves open - whether an adapter should write a listing page into a column
// named `primary_document_url` at all - changes what Anaheim, Las Vegas and New
// York report as held, and standing rule 2 says that gets costed per market
// before it ships. This is the cheap half: a predicate that lets a measurement
// report the two separately, so the cost model stops lying.

export type DocumentShape = 'file' | 'listing' | 'unknown';

// Extensions that are a document rather than a page. Checked against the PATH
// only: a query string routinely carries a `.pdf` inside a redirect parameter,
// and that is a page ABOUT a file rather than the file.
const FILE_EXTENSION = /\.(pdf|docx?|rtf|txt|xlsx?|pptx?|csv)$/i;

// Endpoints that SERVE a file without naming one in the path. Each is here
// because it was observed serving bytes, never because the name reads like a
// download.
const FILE_ENDPOINT: RegExp[] = [
  // Legistar's attachment host. Every value is <guid>.pdf, so FILE_EXTENSION
  // already covers it; kept explicit because the host is the stable half.
  /^https?:\/\/[a-z0-9-]+\.legistar1?\.com\/[^?]*\/attachments\//i,
  // Legistar's View.ashx serves the attachment bytes directly with an id.
  /^https?:\/\/[a-z0-9-]+\.legistar\.com\/View\.ashx\?/i,
  // GRANICUS DOCUMENTVIEWER, WHICH NAMES ONE FILE IN ITS QUERY. Distinct from
  // AgendaViewer below, which frames a meeting. PROBED 2026-09-02, not assumed:
  //   DocumentViewer.php?file=anaheim_c1a553ce....pdf&view=1
  //   -> HTTP 200, application/pdf, 223,046 bytes, magic %PDF-1.7
  // All 21 Anaheim records holding a document carry this shape. The 2026-08-25
  // census that called Anaheim's 75 stored values listing pages was reading a
  // WIDER population - every stored value, not the 21 the flag is true for -
  // and both statements are correct about their own population.
  /^https?:\/\/[a-z0-9-]+\.granicus\.com\/(DocumentViewer|MetaViewer)\.php\?[^\s]*file=/i,
  /^https?:\/\/[a-z0-9-]+\.granicus\.com\/(DocumentViewer|MetaViewer)\.php\?[^\s]*meta_id=\d+/i,
  // NYC CITY RECORD's file endpoint. PROBED 2026-09-02:
  //   Search/GetFile?...&DocumentID=37610
  //   -> HTTP 200, 42,028 bytes, magic PK, content-type
  //      application/vnd.openxmlformats-officedocument.wordprocessingml.document
  //
  // AND IT IS A .DOCX, WHICH IS THE FINDING. It is a real file and it is NOT a
  // PDF, so `fetchPdfPages` - the only document reader in this tree - cannot
  // open it. A City Record record counted as "a document we hold" is a document
  // nothing here can read. That is a separate defect from this file's question
  // and it is recorded rather than fixed here.
  /^https?:\/\/a856-cityrecord\.nyc\.gov\/Search\/GetFile\?/i,
  // CIVICPLUS DOCUMENTCENTER, which serves one file behind a numeric id and a
  // human-readable slug carrying no extension. PROBED 2026-09-02:
  //   www.anaheim.net/DocumentCenter/View/66931/Planning-Commission-Action-...
  //   -> HTTP 200, application/pdf, 213,940 bytes, magic %PDF-1.7
  // The remaining 7 of Anaheim's 21. Anaheim publishes through two hosts and
  // both serve files; only the Granicus AGENDA viewer is a page.
  /^https?:\/\/[a-z0-9.-]+\/DocumentCenter\/View\/\d+/i,
  // CIVICPLUS AGENDACENTER's ViewFile route. PROBED 2026-09-02:
  //   www.anaheim.net/AgendaCenter/ViewFile/Minutes/_06152026-1751
  //   -> HTTP 200, application/pdf, 213,688 bytes, magic %PDF-1.6
  // ViewFile serves the file; the AgendaCenter index one path segment up does
  // not, and is not matched here.
  /^https?:\/\/[a-z0-9.-]+\/AgendaCenter\/ViewFile\//i,
];

// Pages that LIST or FRAME documents. Every one of these was measured holding a
// value in `primary_document_url` in the 2026-08-25 census.
const LISTING_PAGE: RegExp[] = [
  // Granicus AGENDA viewer, which frames a meeting rather than naming a file.
  // Distinct from DocumentViewer above, and the distinction is one probe: an
  // AgendaViewer url answers text/html, a DocumentViewer url answers a pdf.
  /^https?:\/\/[a-z0-9-]+\.granicus\.com\/AgendaViewer\.php\?/i,
  /^https?:\/\/[a-z0-9-]+\.granicus\.com\/(GeneratedAgenda|MediaPlayer)\.php\?/i,
  // PrimeGov meeting portal. Las Vegas's 45, which are 27 distinct meetings.
  /^https?:\/\/[a-z0-9-]+\.primegov\.com\/Portal\/Meeting\?/i,
  /^https?:\/\/[a-z0-9-]+\.primegov\.com\/(Public|Portal)\//i,
  // Legistar's own record pages. The index that links to the staff report, not
  // the staff report.
  /^https?:\/\/[a-z0-9-]+\.legistar\.com\/(gateway\.aspx|LegislationDetail|MeetingDetail|Legislation|Calendar)/i,
  // New York City planning application pages.
  /^https?:\/\/zap-api\.planning\.nyc\.gov\//i,
  /^https?:\/\/(www\.)?nyc\.gov\//i,
  /^https?:\/\/a002-ceqraccess\.nyc\.gov\//i,
  // CEQAnet record pages.
  /^https?:\/\/ceqanet\.(opr|lci)\.ca\.gov\/(Project|Search)/i,
];

/**
 * What a stored `primary_document_url` actually points at.
 *
 * ORDER MATTERS AND THE LISTING TEST RUNS FIRST. A portal page can end in a
 * path segment that looks like a file, and a page that is known to be a page is
 * a page whatever its path spells.
 */
export function documentShape(url: string | null | undefined): DocumentShape {
  if (!url) return 'unknown';
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return 'unknown';
  for (const re of LISTING_PAGE) if (re.test(u)) return 'listing';
  for (const re of FILE_ENDPOINT) if (re.test(u)) return 'file';
  // The path only. A `.pdf` inside a query string is a redirect parameter.
  const path = u.split('?')[0].split('#')[0];
  if (FILE_EXTENSION.test(path)) return 'file';
  return 'unknown';
}

/** True only for a value we can say IS a fetched file. */
export function isFetchedFile(url: string | null | undefined): boolean {
  return documentShape(url) === 'file';
}

/**
 * The sentence a measurement prints beside a document count, so the two are
 * never separated. Standing rule 3: nothing is silently absent, and a count of
 * "documents" that silently includes 299 index pages is the same defect wearing
 * a number.
 */
export function documentShapeNote(counts: { file: number; listing: number; unknown: number }): string {
  const total = counts.file + counts.listing + counts.unknown;
  if (total === 0) return '';
  const parts = [`${counts.file} are fetched files`];
  if (counts.listing > 0) parts.push(`${counts.listing} are pages that LIST documents rather than documents`);
  if (counts.unknown > 0) parts.push(`${counts.unknown} could not be classified either way`);
  return `Of ${total} records holding a document url, ${parts.join(', ')}.`;
}
