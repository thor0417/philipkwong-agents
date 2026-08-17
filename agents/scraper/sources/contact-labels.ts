// THE LABELS A GOVERNMENT DOCUMENT USES TO INTRODUCE A PARTY, AND THE RULES FOR
// READING THEM. Nothing else.
//
// THIS FILE IMPORTS NOTHING, and that is the point of it existing.
// verify-golden asserts on contactsFromText, and it must be runnable with no
// credentials at all - it sits in the pre-commit hook. Importing
// sources/legistar-attachments for it pulled in pdf-agenda and supabase-admin
// transitively and the whole golden set died on a missing key, which is the
// same failure that split sources/legistar-jurisdictions out of the lane.
//
// The alternative was a second copy of the label lists inside the test, which is
// the thing that drifts: a label added to the lane and not to the check is a
// label nobody guards, and the defect this file was split out to guard was
// precisely a wrong label.

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

// ---- contact-block extraction ----------------------------------------------
// Labels as government documents actually print them. Order within a group is
// preference order: the first label present wins the field.
// PETITIONER IS NOT AN OWNER LABEL, AND IT WAS ONE.
//
// Clark County's Board and Redevelopment Agency agendas print the officer who
// BRINGS an item to the body as its petitioner:
//
//   PETITIONER: Shani J. Coleman, Director of Operations
//   PETITIONER: Denis Cederburg, Director of Public Works
//   PETITIONER: Jennifer Ammennan, Deputy Director, Department of Comprehensive Planning
//
// Read as an owner label, that stored a county officer as the APPLICANT on a
// development matter, and it reached client documents: "[RECORD] Denis
// Cederburg - applicant" under 163 At Casino Drive, with a link to a county
// document. A named party with a role the record does not give them is the one
// failure standing rule 1 exists to prevent.
//
// MEASURED BEFORE MOVING IT. Every stored record the label produced - all 7 -
// is a county officer. Not one is a real applicant, so moving it costs nothing
// that was ever right. It moves to the PRESENTER group rather than being deleted
// because that is what the word means here: a petitioner petitions the body, and
// "who brought this item" is worth keeping when it is labelled as that.
//
// IT IS LAST IN THE PRESENTER GROUP. A document that also prints PRESENTED BY or
// REQUESTED BY has said who presents it in plainer words, and those win.
const OWNER_LABELS = ['OWNER', 'PROPERTY OWNER', 'APPLICANT', 'DEVELOPER', 'SUBDIVIDER'];
const REP_LABELS = ['CONTACT', 'REPRESENTATIVE', 'AGENT', 'ATTORNEY', 'APPLICANT REPRESENTATIVE', 'AUTHORIZED AGENT'];
const PRESENTER_LABELS = ['PRESENTED BY', 'PREPARED BY', 'REQUESTED BY', 'SPONSOR', 'SUBMITTED BY', 'STAFF CONTACT', 'PETITIONER'];

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
