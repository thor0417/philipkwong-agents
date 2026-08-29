// Legistar attachment depth: the contact block inside the staff report.
//
// WHY. A Legistar Matter's own fields carry a title, a file number, and a body -
// no people. The people are one level down, in the matter's ATTACHMENTS: the
// staff report / agenda sheet names the owner of record, the filing agent, and
// the representative who will present the item. That is the difference between
// "Kulik River Capital, LLC filed a use permit" and "Nancy Amundsen of Brown,
// Brown & Premsrirut, 520 S. 4th Street, Las Vegas is the contact path" - the
// proof case this module was built from.
//
// ONE adapter serves EVERY Legistar jurisdiction, the same replication principle
// as the matter lane itself: webapi.legistar.com/v1/{client}/Matters/{id}/
// Attachments is public and keyless everywhere. Documents whose names read as
// drawings (maps, elevations, exhibit sets) are skipped unread; the rest are
// fetched in priority order and the first one carrying a labeled contact block
// wins.
//
// ATTRIBUTION RULE (hard). A phone or email is attributed to a party ONLY when it
// sits inside that party's own labeled block. Staff reports are full of agency
// contacts - the health district's plan-review mailbox, the airport's airspace
// mailbox, the water reclamation district's POC address - and those belong to the
// agency, never to the applicant. When the record carries no contact detail for
// the party, the fields stay null. That is the correct answer, not a gap to fill.
//
// Every failure degrades to null: an unreachable API, an unparseable PDF, or a
// document with no contact block costs the matter its depth, never the run.

import { fetchPdfPages } from './pdf-agenda';
import { LegistarAttachmentSchema, parseRecords } from './schemas';
import { contactsFromText, type DocumentContacts } from './contact-labels';

const BASE = 'https://webapi.legistar.com/v1';
const UA = 'philipkwong-agents/1.0 (+scraper)';

// Documents fetched per matter before giving up on finding a contact block.
const MAX_DOCS_PER_MATTER = Number(process.env.LEGISTAR_ATTACHMENT_DOCS ?? '3');
// Set LEGISTAR_ATTACHMENTS=0 to run the matter lane without attachment depth.
const ENABLED = process.env.LEGISTAR_ATTACHMENTS !== '0';

export interface LegistarAttachment {
  MatterAttachmentId?: number;
  MatterAttachmentName?: string;
  MatterAttachmentHyperlink?: string;
}


// ---- document selection -----------------------------------------------------
// Names that read as drawings rather than prose. A map or elevation set extracts
// to a few hundred characters of street labels and carries no contact block, so
// fetching it is pure cost.
const DRAWING_NAME = /(color[_ ]?merged|\bmaps?\b|exhibit|elevation|drawing|site\s*plan|landscape|render|photo|survey|plat\b|aerial)/i;

// ---- AND WHY THE DRAWING WORD IS NOT ENOUGH ON ITS OWN ----------------------
//
// `exhibit` means DRAWING in Clark County and ATTACHED DOCUMENT in Broward
// County, and this one regex was asked to speak for both. Broward names its
// prose documents `Exhibit 1 - Proposed Ordinance`, so the blocklist threw away
// exactly what the reader wants, on that word, and Broward held 0 documents
// against 97 records while Clark held 245 against 303 on the same adapter.
// A label read as the thing it names, again.
//
// So a name is a drawing when it carries a drawing word AND CARRIES NO PROSE
// NOUN. Every noun below names a thing that is READ rather than looked at.
//
// COSTED PER MARKET BEFORE SHIPPING, standing rule 2, over the newest 60 matters
// with the first 25 checked for attachments in each of the seven configured
// Legistar jurisdictions (cap stated; npm run diag:attachment-cost re-runs it):
//
//   jurisdiction              attachments   kept now   kept after
//   Clark County, NV                   35         28           28
//   Nashville, TN                       9          7            7
//   Phoenix, AZ                        19         19           19
//   Oakland, CA                        16         16           16
//   Yonkers, NY                         2          2            2
//   Westchester County, NY             38         38           38
//   Broward County, FL                 34          7           22
//
// +15 in Broward, +0 everywhere else, and all four of Clark's
// `UC-26-0303_Color_Merged.pdf` drawing sets are still stripped. The rule that
// helps one market and strips another has happened twice in this repository;
// this one costs nothing in any market measured.
const PROSE_NOUN =
  /(ordinance|resolution|agreement|\breport\b|memo|letter|application|justification|contract|amendment|estimate|analysis|staff|minutes|correspondence|petition|covenant|declaration)/i;

/** A name is a drawing only when it reads as one AND names nothing that is read. */
export function isDrawingName(name: string): boolean {
  return DRAWING_NAME.test(name) && !PROSE_NOUN.test(name);
}

// Names that read as the staff report / agenda sheet / application, most
// specific first. Clark County prefixes the staff report with its agenda item
// number ("11 26-0219-072226.pdf"), which the leading-digits rule catches.
//
// THE LAST FIVE ARE BROWARD'S VOCABULARY and they are not only Broward's.
// Measured in the same pass, attachments reaching a priority pattern:
// Clark 13 -> 16, Nashville 1 -> 6, Broward 0 -> 14. Broward names nothing
// "staff report", so without these its survivors ranked last and competed on an
// arbitrary ordering against MAX_DOCS_PER_MATTER.
const DOC_PRIORITY: RegExp[] = [
  /staff\s*report/i,
  /agenda\s*sheet/i,
  /^\d+[\s_-]/,
  /application/i,
  /justification/i,
  /\breport\b/i,
  /letter/i,
  /memo/i,
  /ordinance/i,
  /resolution/i,
  /agreement/i,
  /amendment\s*report/i,
  /business\s*impact/i,
];

export function rankAttachments(list: LegistarAttachment[]): LegistarAttachment[] {
  const usable = list.filter((a) => {
    const name = a.MatterAttachmentName ?? '';
    return !!a.MatterAttachmentHyperlink && !isDrawingName(name);
  });
  const rank = (a: LegistarAttachment): number => {
    const name = a.MatterAttachmentName ?? '';
    const i = DOC_PRIORITY.findIndex((re) => re.test(name));
    return i === -1 ? DOC_PRIORITY.length : i;
  };
  return usable.sort((a, b) => rank(a) - rank(b));
}

// The label rules live in sources/contact-labels, which imports nothing so the
// golden set can assert on them without credentials. Re-exported here because
// the lane is where callers already look for them.
export {
  labeledValue, headingOwner, isPartyEmail, contactsFromText,
} from './contact-labels';
export type { DocumentContacts } from './contact-labels';

// ---- per-jurisdiction telemetry --------------------------------------------
export interface AttachmentStats {
  mattersProcessed: number;
  attachmentsListed: number;
  attachmentsFetched: number;
  contactsExtracted: number;
}
let stats: Record<string, AttachmentStats> = {};
export function lastAttachmentStats(): Record<string, AttachmentStats> {
  return stats;
}
export function resetAttachmentStats(): void {
  stats = {};
}
function bump(jurisdiction: string, field: keyof AttachmentStats, by = 1): void {
  stats[jurisdiction] ??= { mattersProcessed: 0, attachmentsListed: 0, attachmentsFetched: 0, contactsExtracted: 0 };
  stats[jurisdiction][field] += by;
}

async function listAttachments(client: string, matterId: number): Promise<LegistarAttachment[]> {
  try {
    const res = await fetch(`${BASE}/${client}/Matters/${matterId}/Attachments`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    // An attachment with no hyperlink cannot be fetched, so the schema requires
    // one and the rest are skipped rather than half-processed.
    return parseRecords(LegistarAttachmentSchema, data, {
      source: `legistar:${client}`,
      endpoint: `Matters/${matterId}/Attachments`,
      quiet: true,
    }).records as LegistarAttachment[];
  } catch {
    return [];
  }
}

/**
 * WHAT A MATTER'S DOCUMENTS YIELDED. Two answers, deliberately separate.
 *
 * THE DEFECT THIS TYPE EXISTS FOR. legistar.ts wrote
 *
 *     primary_document_url: c?.documentUrl ?? null,
 *     has_primary_document: !!c,
 *
 * where `c` was the contact block. So on EVERY Legistar jurisdiction,
 * `has_primary_document` recorded "the contact reader succeeded", not "this
 * record has a primary document". A matter could have its staff report listed,
 * fetched and parsed and still record `false`, because the document named no
 * owner, applicant or representative in the label format contact-labels
 * recognises. The document was read; the fact that we hold it was discarded.
 *
 * One write site, SEVEN jurisdictions: Clark, Nashville, Phoenix, Oakland,
 * Yonkers, Westchester and Broward. Every document count for all seven was an
 * understatement of unknown size, and Phoenix at 1 document per 42 records was
 * the most suspicious of them - its documents are liquor-licence data sheets,
 * which carry no applicant contact block in any format.
 *
 * "Broward has 0 documents" was therefore never a statement about Broward. It
 * was a statement about how many Broward attachments contained a Clark-shaped
 * contact block.
 */
export interface MatterDocuments {
  /** The contact block, or null when a document was read and named no party. */
  contacts: DocumentContacts | null;
  /** The first document actually FETCHED, whatever it did or did not name. */
  documentUrl: string | null;
  documentName: string | null;
  /** How many of this matter's documents were fetched and parsed. */
  fetched: number;
}

/**
 * The documents for one matter. Null only when nothing was listed or nothing
 * could be fetched - which is the honest meaning of "this matter has no
 * document we hold".
 */
export async function matterDocuments(
  client: string,
  matterId: number,
  jurisdictionLabel: string
): Promise<MatterDocuments | null> {
  if (!ENABLED) return null;
  bump(jurisdictionLabel, 'mattersProcessed');
  const list = await listAttachments(client, matterId);
  bump(jurisdictionLabel, 'attachmentsListed', list.length);
  if (list.length === 0) return null;

  let firstUrl: string | null = null;
  let firstName: string | null = null;
  let fetched = 0;

  for (const doc of rankAttachments(list).slice(0, MAX_DOCS_PER_MATTER)) {
    const url = doc.MatterAttachmentHyperlink as string;
    const pages = await fetchPdfPages(url);
    if (!pages || pages.length === 0) continue;
    bump(jurisdictionLabel, 'attachmentsFetched');
    fetched += 1;
    // THE FIRST DOCUMENT FETCHED IS THE PRIMARY ONE, whether or not it names a
    // party. This is the line the whole defect turned on.
    if (!firstUrl) {
      firstUrl = url;
      firstName = doc.MatterAttachmentName ?? '(unnamed)';
    }
    const found = contactsFromText(pages.join('\n'));
    if (!found) continue;
    bump(jurisdictionLabel, 'contactsExtracted');
    return {
      contacts: { ...found, documentName: doc.MatterAttachmentName ?? '(unnamed)', documentUrl: url },
      documentUrl: firstUrl,
      documentName: firstName,
      fetched,
    };
  }
  if (fetched === 0) return null;
  // Documents were read and none named a party. That is a record WITH a primary
  // document and WITHOUT contacts, and those are different facts.
  return { contacts: null, documentUrl: firstUrl, documentName: firstName, fetched };
}

/**
 * The contact block alone. Kept for callers that only want the parties;
 * `matterDocuments` is what a writer should use, because only it can tell
 * "no document" from "a document that named nobody".
 */
export async function matterContacts(
  client: string,
  matterId: number,
  jurisdictionLabel: string
): Promise<DocumentContacts | null> {
  return (await matterDocuments(client, matterId, jurisdictionLabel))?.contacts ?? null;
}

// The provenance block appended to a record's raw_content. The source document is
// named so any contact can be traced back to the page it came from.
export function contactProvenance(c: DocumentContacts): string {
  return [
    '',
    '--- contacts from the matter documents ---',
    c.block,
    `Source document: ${c.documentName}`,
    `Document URL: ${c.documentUrl}`,
    c.contact_email || c.contact_phone
      ? `Party contact detail: ${[c.contact_email, c.contact_phone].filter(Boolean).join(' / ')} (read from the party's own block).`
      : "No phone or email for the party in the record (agency contact detail in the document belongs to the agency, never to the party).",
  ].join('\n');
}
