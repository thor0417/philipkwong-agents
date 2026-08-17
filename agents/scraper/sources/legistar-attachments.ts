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
// Names that read as the staff report / agenda sheet / application, most
// specific first. Clark County prefixes the staff report with its agenda item
// number ("11 26-0219-072226.pdf"), which the leading-digits rule catches.
const DOC_PRIORITY: RegExp[] = [
  /staff\s*report/i,
  /agenda\s*sheet/i,
  /^\d+[\s_-]/,
  /application/i,
  /justification/i,
  /\breport\b/i,
  /letter/i,
  /memo/i,
];

export function rankAttachments(list: LegistarAttachment[]): LegistarAttachment[] {
  const usable = list.filter((a) => {
    const name = a.MatterAttachmentName ?? '';
    return !!a.MatterAttachmentHyperlink && !DRAWING_NAME.test(name);
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

// The contact block for one matter, or null when its documents carry none.
export async function matterContacts(
  client: string,
  matterId: number,
  jurisdictionLabel: string
): Promise<DocumentContacts | null> {
  if (!ENABLED) return null;
  bump(jurisdictionLabel, 'mattersProcessed');
  const list = await listAttachments(client, matterId);
  bump(jurisdictionLabel, 'attachmentsListed', list.length);
  if (list.length === 0) return null;

  for (const doc of rankAttachments(list).slice(0, MAX_DOCS_PER_MATTER)) {
    const url = doc.MatterAttachmentHyperlink as string;
    const pages = await fetchPdfPages(url);
    if (!pages || pages.length === 0) continue;
    bump(jurisdictionLabel, 'attachmentsFetched');
    const found = contactsFromText(pages.join('\n'));
    if (!found) continue;
    bump(jurisdictionLabel, 'contactsExtracted');
    return { ...found, documentName: doc.MatterAttachmentName ?? '(unnamed)', documentUrl: url };
  }
  return null;
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
