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

// Contacts read out of a matter's own documents. Every field is null unless the
// document states it; nothing here is inferred.
export interface DocumentContacts {
  presented_by: string | null;
  applicant: string | null;
  representative: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  // Verbatim labeled block, for the provenance note in raw_content.
  block: string;
  documentName: string;
  documentUrl: string;
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

// ---- contact-block extraction ----------------------------------------------
// Labels as government documents actually print them. Order within a group is
// preference order: the first label present wins the field.
const OWNER_LABELS = ['OWNER', 'PROPERTY OWNER', 'APPLICANT', 'PETITIONER', 'DEVELOPER', 'SUBDIVIDER'];
const REP_LABELS = ['CONTACT', 'REPRESENTATIVE', 'AGENT', 'ATTORNEY', 'APPLICANT REPRESENTATIVE', 'AUTHORIZED AGENT'];
const PRESENTER_LABELS = ['PRESENTED BY', 'PREPARED BY', 'REQUESTED BY', 'SPONSOR', 'SUBMITTED BY', 'STAFF CONTACT'];

const MAX_VALUE_CHARS = 200;

// A contact value that carries a mailing address ENDS at the zip code. Without
// this, a block printed immediately above an all-caps heading (a resolution
// title, a notice banner) runs on into it, because that heading carries neither
// a blank line nor a label to stop at. Applied only when a zip is present.
const ZIP_END = /\b[A-Z]{2}\.?\s+\d{5}(-\d{4})?\b/;

function clipAtZip(value: string): string {
  const m = value.match(ZIP_END);
  return m && m.index !== undefined ? value.slice(0, m.index + m[0].length) : value;
}

function tidy(value: string): string | null {
  const t = clipAtZip(value.replace(/\s+/g, ' ')).replace(/[.,;:\s]+$/, '').trim();
  if (t.length < 2) return null;
  if (/^(n\/?a|none|tbd|unknown|same)$/i.test(t)) return null;
  return t.slice(0, MAX_VALUE_CHARS);
}

// The value printed after `LABEL:`, running until the next labeled line, a blank
// line, or the end of the document.
export function labeledValue(text: string, label: string): string | null {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const re = new RegExp(`\\b${esc}\\s*:\\s*([\\s\\S]{0,400}?)(?=\\n[ \\t]*[A-Z][A-Z0-9 /&()-]{2,}\\s*:|\\n[ \\t]*\\n|$)`, 'i');
  const m = text.match(re);
  return m ? tidy(m[1]) : null;
}

// Clark County (and other counties using the same agenda-sheet form) print the
// owner in the heading rather than as a labeled field:
//   APP. NUMBER/OWNER/DESCRIPTION OF REQUEST
//   UC-26-0219-KULIK RIVER CAPITAL, LLC:
export function headingOwner(text: string): string | null {
  const m = text.match(/OWNER[^\n]*\n\s*[A-Z]{1,5}-\d{2}-[\dA-Z]+\s*-\s*([^:\n]{2,120}):/);
  return m ? tidy(m[1]) : null;
}

// ---- attribution guard ------------------------------------------------------
// A mailbox that belongs to an agency or to a bulk-notification list, never to
// the party. Hosts first (a government or district domain is never the
// applicant's), then generic mailbox names that are departmental by definition.
const AGENCY_HOST = /(\.gov$|\.gov\.|\.us$|\.mil$|snhd\.org$|cleanwaterteam\.com$|lasairport\.com$|airport|county|city|district|clerk)/i;
const BULK_MAILBOX = /^(info|no-?reply|donotreply|do-?not-?reply|clerk|agenda|agendas|notice|notices|planning|permits|zoning|records|webmaster|admin|contact|support|mail)$/i;

export function isPartyEmail(email: string): boolean {
  const [local, host] = email.toLowerCase().split('@');
  if (!local || !host) return false;
  if (AGENCY_HOST.test(host)) return false;
  if (BULK_MAILBOX.test(local)) return false;
  return true;
}

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE_RE = /\(?\b\d{3}\)?[\s.-]?\d{3}[.-]\d{4}\b/;

// Contact detail is read ONLY from the party's own block, so an agency mailbox
// printed elsewhere in the staff report can never be attributed to the party.
function contactFromBlocks(...blocks: (string | null)[]): { email: string | null; phone: string | null } {
  let email: string | null = null;
  let phone: string | null = null;
  for (const b of blocks) {
    if (!b) continue;
    if (!email) {
      const m = b.match(EMAIL_RE);
      if (m && isPartyEmail(m[0])) email = m[0];
    }
    if (!phone) {
      const m = b.match(PHONE_RE);
      if (m) phone = m[0].trim();
    }
  }
  return { email, phone };
}

// Pull the owner / applicant / representative / presenter out of one document's
// text. Returns null when the document carries no labeled party at all.
export function contactsFromText(text: string): Omit<DocumentContacts, 'documentName' | 'documentUrl'> | null {
  // Collapse intra-line runs (PDF text is space-padded) but keep line structure,
  // which is what the label patterns key on.
  const norm = text.replace(/[ \t ]+/g, ' ');

  const owner = headingOwner(norm);
  let ownerLabel: string | null = null;
  let ownerValue: string | null = null;
  for (const l of OWNER_LABELS) {
    const v = labeledValue(norm, l);
    if (v) {
      ownerLabel = l;
      ownerValue = v;
      break;
    }
  }

  let repValue: string | null = null;
  let repLabel: string | null = null;
  for (const l of REP_LABELS) {
    const v = labeledValue(norm, l);
    if (v) {
      repLabel = l;
      repValue = v;
      break;
    }
  }

  let presenter: string | null = null;
  let presenterLabel: string | null = null;
  for (const l of PRESENTER_LABELS) {
    const v = labeledValue(norm, l);
    if (v) {
      presenterLabel = l;
      presenter = v;
      break;
    }
  }

  // The heading owner is the party of record; a labeled APPLICANT alongside it is
  // the filing agent, which is kept verbatim in the block rather than overwriting
  // the party. With no heading owner, the labeled value IS the party.
  const applicant = owner ?? ownerValue;
  if (!applicant && !repValue && !presenter) return null;

  // A representative represents SOMEONE. When a document prints a CONTACT but
  // names no owner or applicant at all, that contact is the issuing agency's own
  // routing contact (a Metro grant form's "CONTACT: <staffer> <extension>"), not
  // an outside party's representative, so it is not promoted to the
  // representative field. It stays in the block below, labeled as the document
  // printed it, so nothing is lost and nothing is misattributed.
  const representative = applicant ? repValue : null;

  const { email, phone } = contactFromBlocks(ownerValue, representative, presenter);

  const block = [
    owner ? `OWNER (heading): ${owner}` : null,
    ownerValue && ownerLabel ? `${ownerLabel}: ${ownerValue}` : null,
    repValue && repLabel ? `${repLabel}: ${repValue}` : null,
    presenter && presenterLabel ? `${presenterLabel}: ${presenter}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    presented_by: presenter,
    applicant,
    representative,
    contact_email: email,
    contact_phone: phone,
    block,
  };
}

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
    return Array.isArray(data) ? (data as LegistarAttachment[]) : [];
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
