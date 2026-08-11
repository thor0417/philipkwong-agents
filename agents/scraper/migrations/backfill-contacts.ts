// EXTRACT THE CONTACT DETAIL THE RECORDS ALREADY CARRY.
//
//   npm run contacts:backfill           dry run
//   APPLY=1 npm run contacts:backfill   write
//
// 21 emails and 13 phones sit in raw_content with the contact columns empty. All
// of them are in text we already fetched, so this needs no new capability and no
// DDL.
//
// ---- WHY THIS IS NOT "MATCH AN EMAIL AND STORE IT" ---------------------------
//
// It nearly was, and the preview is what stopped it. The regex-only candidates
// are mostly NOT contacts:
//
//   23344106549@nycbp.webex.com      a Webex meeting join code
//   +1-646-992-2010                  a Webex dial-in number
//   testimony@brooklynbp.nyc.gov     a testimony submission mailbox
//   fcrc@mocs.nyc.gov                a testimony mailbox
//   ask@rgb.nyc.gov                  a general public enquiry inbox
//   cityclerk@anaheim.net            the clerk's line for agenda accessibility
//
// "Contact: 23344106549@nycbp.webex.com" in a client document is worse than the
// honest negative, because the negative is true and that is not. A contact path
// is what makes a party actionable rather than merely discovered, and a wrong
// one is worse than none.
//
// SO A CONTACT IS ONLY TAKEN WHERE THE RECORD ATTRIBUTES IT TO A NAMED PERSON.
// The text must carry a labelled contact role, a personal name, and the detail,
// within one span. Those three together are the record saying "this is who to
// ask"; an email on its own is only the record saying "this address exists".
//
// Nothing is inferred from a firm name, a domain, or a naming convention.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { overriddenFields } from '../write-guard';

const APPLY = process.env.APPLY === '1';

// The labels a jurisdiction uses to name the person who answers questions.
// Every one of these was read off a real record in this corpus.
//
// CASE IS SPELLED OUT RATHER THAN FLAGGED. These patterns cannot carry the `i`
// flag, because `i` also makes the NAME pattern's [a-z] match capitals, and that
// is what let "Project Planner: Lisandro Orozco LOrozco@anaheim.net" parse as a
// person called "Lisandro Orozco LOrozc" with the address "o@anaheim.net". The
// label is the only part that needs case tolerance, so it carries its own.
const CONTACT_LABEL =
  '(?:[Pp]roject\\s+[Pp]lanner|[Cc]ase\\s+[Pp]lanner|[Pp]lanner|[Ss]taff\\s+[Cc]ontact|' +
  '[Cc]ontact\\s+[Pp]erson|[Cc]ontact|[Ss]ecretary|[Cc]ounty\\s+[Ll]iaison|[Ll]iaison|' +
  '[Pp]roject\\s+[Mm]anager|[Pp]repared\\s+[Bb]y|' +
  '[Ff]or\\s+questions[^.]{0,40}?contact)';

// A personal name: two or three words, each a capital followed by LOWER CASE.
//
// The lower-case requirement is what stops the pattern eating an address:
// "Project Planner: Lisandro Orozco LOrozco@anaheim.net" matched
// "Lisandro Orozco LOrozc" as the name and left "o@anaheim.net" as the email,
// because LOrozco starts with two capitals and the old pattern allowed it.
//
// A hyphenated surname is one word. `[a-z'\-]+` ended a name at the hyphen and
// stored "Corina Lozada-" for Corina Lozada-Smith, which is a person's name cut
// in half and is not her name.
// `[a-z']*` allowed ZERO lower-case letters, so the bare "L" of "LOrozco" was a
// valid name word and the name came out "Lisandro Orozco L". A name word is a
// capital followed by at least one lower-case letter.
const NAME_WORD = "[A-Z][a-z']+(?:-[A-Z]?[a-z']+)*";
// The middle initial must not be the first letter of an email address. Without
// the lookahead, " LOrozco@anaheim.net" offered its "L" as an initial and the
// name came out "Lisandro Orozco L".
const PERSON = `(${NAME_WORD}(?:\\s+[A-Z]\\.?(?![A-Za-z]))?(?:\\s+${NAME_WORD}){1,2})`;

// The address must END at the address. Without the lookahead the Canadian
// tender's "Andre.Champagne@dcc-cdc.gc.caBidding and Documents are available"
// stored an address with the next word glued on, because the source carries no
// space there.
const EMAIL_RE = '([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,6})(?![A-Za-z])';
const PHONE_RE = '(\\(?\\d{3}\\)?[\\s.\\-]?\\d{3}[\\s.\\-]\\d{4})';

// Words that are never a person, however capitalised. "please contact our office
// at (718) 264-7895" produced a contact called "our office at", and "by
// contacting the office by phone" produced one called "ing the office".
const NOT_A_PERSON_NAME =
  /\b(office|department|division|bureau|clerk|commission|board|council|city|county|construction|canada|authority|corporation|company|team|staff|committee|agency|the|our|your|this|please|contact)\b/i;

// LABEL, then a name, then the detail, inside one span. The span is bounded so a
// label at the top of a page cannot claim an address at the bottom of it.
const SPAN = '[^A-Za-z0-9]{0,4}\\s*';
const GAP = '[\\s\\S]{0,60}?';

const EMAIL_AFTER_NAME = new RegExp(`${CONTACT_LABEL}${SPAN}${PERSON}${GAP}${EMAIL_RE}`);
const PHONE_AFTER_NAME = new RegExp(`${CONTACT_LABEL}${SPAN}${PERSON}${GAP}${PHONE_RE}`);
// "please contact Trisha R. Gonzalez, Housing Development Coordinator II, at
// tgonzalez@oaklandca.gov" - the label precedes the name in prose.
const PROSE_EMAIL = new RegExp(`[Cc]ontact\\s+${PERSON}[^.]{0,80}?at\\s+${EMAIL_RE}`);

// Addresses that are a facility, not a person. Checked against the ADDRESS, not
// against the surrounding prose, so a real contact in a record that also carries
// a Webex link is still taken.
const NOT_A_PERSON_ADDRESS =
  /(webex|zoom|teams|gotomeeting|^testimony@|^info@|^ask@|^cityclerk@|^clerk@|^cityhall@|^help@|^support@|^noreply@|^no-reply@|^contact@|^comments@|^publiccomment)/i;

// Numbers that are a meeting, not a telephone. A Webex access code is nine or
// ten digits printed in threes and is indistinguishable from a phone number by
// shape alone, so the shape is not what decides it.
const MEETING_NUMBER_CONTEXT =
  /(access\s+code|meeting\s+(?:number|id)|join\s+by|dial\s+in|webinar|passcode|conference\s+id)/i;

export interface ContactHit {
  id: string;
  source: string;
  person: string;
  email: string | null;
  phone: string | null;
  sentence: string;
  // Where the same record also carries a CONTACT block, the block names the firm
  // and the office and the labelled sentence usually does not. Storing only the
  // person there threw away an address the record had printed.
  blockName?: string;
}

// The block as the record states it: person, firm, office, in that order, and
// nothing added. Null where the record printed no block.
export function blockName(block: ReturnType<typeof extractContactBlock>): string | null {
  if (!block) return null;
  return [block.person, block.firm, block.address].filter(Boolean).join(', ');
}

// Whether the stored name and the block name the same party in a different
// order. Clark County prints "KAEMPFER CROWELL, JENNIFER LAZOVICH" where the
// adapter stored "Jennifer Lazovich, Kaempfer Crowell", and neither is a
// continuation of the other. Every word of the stored name appearing in the
// block is the test; it is the same party, so the block's address belongs to
// it. The STORED NAME IS NOT REWRITTEN, only the address is appended.
export function samePartyReordered(stored: string, person: string, firm: string | null): boolean {
  const words = (v: string) =>
    v
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3);
  const mine = words(stored);
  if (mine.length < 2) return false;
  const theirs = new Set(words([person, firm].filter(Boolean).join(' ')));
  return mine.every((w) => theirs.has(w));
}

// Whether `fuller` is the value already stored with more of the same record
// after it. Case and spacing are the two readings' formatting, not a difference
// of party, so neither decides this; anything that is not a continuation is
// somebody else's reading and is left alone.
export function completes(stored: string, fuller: string): boolean {
  const flat = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const a = flat(stored);
  const b = flat(fuller);
  return a.length > 0 && b.length > a.length && b.startsWith(a);
}

function windowAround(raw: string, needle: string): string {
  const at = raw.indexOf(needle);
  if (at < 0) return '';
  return raw.slice(Math.max(0, at - 160), at + needle.length + 40).replace(/\s+/g, ' ').trim();
}

/** The contact a record attributes to a named person, or null. */
export function extractContact(raw: string): Omit<ContactHit, 'id' | 'source'> | null {
  if (!raw) return null;

  let person: string | null = null;
  let email: string | null = null;
  let phone: string | null = null;

  const em = EMAIL_AFTER_NAME.exec(raw) ?? PROSE_EMAIL.exec(raw);
  if (em) {
    const candidate = em[2];
    if (!NOT_A_PERSON_ADDRESS.test(candidate)) {
      person = em[1].trim();
      email = candidate;
    }
  }

  const ph = PHONE_AFTER_NAME.exec(raw);
  if (ph) {
    const candidate = ph[2];
    const context = windowAround(raw, candidate);
    // A number sitting inside meeting-joining instructions is a conference code.
    if (!MEETING_NUMBER_CONTEXT.test(context)) {
      person = person ?? ph[1].trim();
      // Only when it belongs to the SAME person the email did, or when there was
      // no email at all. Two different people's details must not be merged into
      // one contact block.
      if (!email || ph[1].trim() === person) phone = candidate;
    }
  }

  if (!person || (!email && !phone)) return null;
  // A trailing preposition is the prose pattern's tail, not part of the name:
  // "please contact Corina Lozada at corina.lozada@..." captured "Corina Lozada at".
  person = person.replace(/\s+(at|on|via|by|for)$/i, '').trim();
  // The last gate. A "name" carrying an institutional word is the pattern having
  // matched a sentence rather than a person, and a wrong name attached to a real
  // address is worse than storing neither.
  if (NOT_A_PERSON_NAME.test(person)) return null;
  if (person.split(/\s+/).length < 2) return null;
  return { person, email, phone, sentence: windowAround(raw, email ?? phone ?? '') };
}

// ---- THE CLARK COUNTY CONTACT BLOCK -----------------------------------------
//
// A second shape entirely, and the most valuable one in the corpus. Clark County
// prints a full contact block on its zoning items:
//
//   CONTACT: NANCY AMUNDSEN, BROWN, BROWN, & PREMSRIRUT, 520 S. 4TH STREET,
//   LAS VEGAS, NV 89101
//   CONTACT: LENNAR, ATTN: PARKER SIECK, 6385 S. RAINBOW BOULEVARD, SUITE 300
//   CONTACT: HOLLAND & HART LLP, 5470 KIETZKE LANE #100, RENO, NV 89511
//
// 29 of the 32 labelled blocks in Legistar are Clark County and 15 carry no
// stored contact at all. These are the land-use attorneys and consultants who
// carried the entitlement, which is the warm door into a project, and they were
// being dropped for two reasons that have nothing to do with whether they are
// real: the block is in block capitals, and it carries a postal address rather
// than an email, so the person-plus-detail extractor above refuses it.
//
// A NAME WITH NO EMAIL IS STILL A NAMED CONTACT. The honest negative on the
// contact detail is already printed by the report; refusing the NAME as well
// throws away the party because we cannot phone them.
const CONTACT_BLOCK = /CONTACT:\s*([^\n\r]{4,160})/i;
const ATTN = /\bATTN:?\s*([A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){1,2})/i;
// Where the postal address starts. Same rule the report layer uses.
const BLOCK_ADDRESS = /,\s*(?=\d+\s+[NSEW]?\.?\s*\w|(?:suite|ste\.?|floor|fl\.?|p\.?o\.?\s*box|#)\b)/i;

/**
 * The party a "CONTACT:" block names, with the firm where it gives one.
 *
 * Returns the block's own words. A block naming only an organisation returns
 * that organisation: the record says it is the contact, and saying so is not the
 * same as claiming a person.
 */
export function extractContactBlock(
  raw: string
): { person: string; firm: string | null; address: string | null; phone: string | null } | null {
  const m = CONTACT_BLOCK.exec(raw);
  if (!m) return null;
  const whole = m[1].replace(/\s+(?:Source document|Document URL)\b[\s\S]*$/i, '').trim();
  const cut = whole.split(BLOCK_ADDRESS);
  let block = cut[0].replace(/[,;\s]+$/, '').trim();
  // "CONTACT: Alan Enzo 862-8400" - the number is a telephone the record
  // printed, not part of the name. Taken off the name and kept as the record
  // states it, seven digits and all; nothing supplies a missing area code.
  const trailingPhone = /\s+(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]\d{4}|\d{3}[.\-]\d{4})$/.exec(block);
  const phone = trailingPhone ? trailingPhone[1].trim() : null;
  if (trailingPhone) block = block.slice(0, trailingPhone.index).replace(/[,;\s]+$/, '').trim();
  // THE ADDRESS IS KEPT, VERBATIM. It was split off and thrown away, and an
  // office address is a contact path in its own right: it is how a letter
  // reaches the land-use attorney who carried the entitlement, and for most of
  // these parties it is the ONLY path the record gives. Stored exactly as the
  // record states it, never completed, corrected or geocoded.
  const address = cut.length > 1 ? whole.slice(cut[0].length).replace(/^[,;\s]+/, '').trim() : null;
  if (block.length < 4) return null;

  // "LENNAR, ATTN: PARKER SIECK" - the addressee is the person, the leading
  // segment is the firm.
  const attn = ATTN.exec(block);
  if (attn) {
    const firm = block.slice(0, attn.index).replace(/[,;\s]+$/, '').trim();
    return { person: attn[1].trim(), firm: firm || null, address, phone };
  }

  const parts = block.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const head = parts[0];
  const words = head.split(/\s+/);
  // A personal name: two or three words, no company marker. Checked against the
  // shape rather than the case, because the whole block is capitalised.
  const looksPersonal =
    words.length >= 2 &&
    words.length <= 3 &&
    !NOT_A_PERSON_NAME.test(head) &&
    !/\b(llc|inc|ltd|lp|llp|plc|corp|company|group|services|consulting|associates|partners|holdings|academy|school|church|properties|realty|development)\b/i.test(head);
  if (looksPersonal) {
    return { person: head, firm: parts.slice(1).join(', ') || null, address, phone };
  }
  // Otherwise the block names an organisation, which is what it says.
  return { person: block, firm: null, address, phone };
}

async function main(): Promise<void> {
  const rows: Record<string, unknown>[] = [];
  for (let f = 0; ; f += 500) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id,source,raw_content,contact_name,contact_email,contact_phone,manual_overrides,status')
      .neq('status', 'dismissed')
      .range(f, f + 499);
    if (error) throw new Error(`read failed: ${error.message}`);
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if ((data ?? []).length < 500) break;
  }
  console.log(`records scanned: ${rows.length}`);

  const hits: ContactHit[] = [];
  // Blocks that name a contact but carry no email or phone. A name with no way
  // to reach it is still a named party, and the report already prints the
  // honest negative about the detail.
  const nameOnly: { id: string; source: string; person: string; firm: string | null; address: string | null; phone: string | null }[] = [];
  const rejected = new Map<string, number>();
  for (const r of rows) {
    const raw = String(r.raw_content ?? '');
    const hasEmail = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(raw);
    const hasPhone = /\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]\d{4}/.test(raw);
    // A CONTACT block is a named party with an office whether or not the record
    // prints an email or a phone anywhere. Gating the whole pass on a detail
    // being present dropped every block in a record that had none.
    const hasBlock = extractContactBlock(raw) !== null;
    if (!hasEmail && !hasPhone && !hasBlock) continue;

    const already = String(r.contact_email ?? '').trim() || String(r.contact_phone ?? '').trim();
    const protectedFields = overriddenFields(r.manual_overrides);
    if (protectedFields.has('contact_email') || protectedFields.has('contact_phone')) {
      rejected.set('protected by an override', (rejected.get('protected by an override') ?? 0) + 1);
      continue;
    }

    const hit = extractContact(raw);
    const block = extractContactBlock(raw);
    const haveName = String(r.contact_name ?? '').trim();

    const verbatim = blockName(block);

    if (hit && !already) {
      hits.push({ id: String(r.id), source: String(r.source), ...hit, blockName: verbatim ?? undefined });
      continue;
    }
    if (block && verbatim) {
      // EXTENDING OUR OWN EARLIER WRITE IS NOT OVERWRITING AN ADAPTER'S.
      // The first pass stored name and firm and dropped the address. Where the
      // stored value is the head of the fuller block, this is the same party
      // with the office added, so it is safe to complete.
      // The same party in the other order: keep the stored name, add the office.
      const reordered =
        !!haveName &&
        !!block.address &&
        !completes(haveName, verbatim) &&
        samePartyReordered(haveName, block.person, block.firm) &&
        !haveName.includes(block.address);
      if (!haveName || completes(haveName, verbatim) || reordered) {
        nameOnly.push({
          id: String(r.id),
          source: String(r.source),
          // A reordered match keeps the name the record already carries.
          person: reordered ? haveName : block.person,
          firm: reordered ? null : block.firm,
          address: block.address,
          phone: block.phone,
        });
        continue;
      }
    }
    if (already || haveName) {
      rejected.set('already stored', (rejected.get('already stored') ?? 0) + 1);
      continue;
    }
    rejected.set(
      'no contact attributed to a named person',
      (rejected.get('no contact attributed to a named person') ?? 0) + 1
    );
  }

  const bySource = new Map<string, { email: number; phone: number }>();
  for (const h of hits) {
    if (!bySource.has(h.source)) bySource.set(h.source, { email: 0, phone: 0 });
    if (h.email) bySource.get(h.source)!.email++;
    if (h.phone) bySource.get(h.source)!.phone++;
  }
  console.log(`\nCONTACTS GAINED PER SOURCE`);
  for (const [s, g] of [...bySource.entries()].sort((a, b) => b[1].email + b[1].phone - (a[1].email + a[1].phone))) {
    console.log(`   ${s.padEnd(20)} email ${String(g.email).padStart(3)}   phone ${String(g.phone).padStart(3)}`);
  }
  console.log(`   ${'TOTAL'.padEnd(20)} email ${String(hits.filter((h) => h.email).length).padStart(3)}   phone ${String(hits.filter((h) => h.phone).length).padStart(3)}`);

  console.log(`\nWHY THE REST ARE NOT TAKEN`);
  for (const [why, n] of [...rejected.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(n).padStart(4)}  ${why}`);
  }

  const nameBySource = new Map<string, number>();
  for (const h of nameOnly) nameBySource.set(h.source, (nameBySource.get(h.source) ?? 0) + 1);
  console.log(`\nCONTACT NAMES GAINED FROM A "CONTACT:" BLOCK (no email or phone in it)`);
  for (const [src, n] of [...nameBySource.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${src.padEnd(20)} ${String(n).padStart(3)}`);
  }
  console.log(`   ${'TOTAL'.padEnd(20)} ${String(nameOnly.length).padStart(3)}`);
  for (const h of nameOnly.slice(0, 12)) {
    console.log(`      ${h.person}${h.firm ? `  (${h.firm})` : ''}${h.address ? `  @ ${h.address}` : ''}${h.phone ? `  tel ${h.phone}` : ''}`);
  }

  console.log(`\nEXAMPLES, WITH THE SENTENCE EACH CAME FROM`);
  for (const h of hits.slice(0, 12)) {
    console.log(`\n   [${h.source}] ${h.person}`);
    console.log(`      ${[h.email, h.phone].filter(Boolean).join('  |  ')}`);
    console.log(`      "...${h.sentence}..."`);
  }

  if (!APPLY) {
    console.log(`\nNothing was written. APPLY=1 to write.`);
    return;
  }
  let written = 0;
  for (const h of nameOnly) {
    const { data: row } = await supabaseAdmin.from('leads').select('contact_phone').eq('id', h.id).single();
    const storedPhone = String(row?.contact_phone ?? '').trim();
    const { error } = await supabaseAdmin
      .from('leads')
      .update({
        contact_name: [h.person, h.firm, h.address].filter(Boolean).join(', '),
        // A telephone the block printed, as it printed it, and only where the
        // record carries none. A stored number is the adapter's reading.
        ...(h.phone && !storedPhone ? { contact_phone: h.phone } : {}),
      })
      .eq('id', h.id);
    if (error) {
      console.error(`   name write failed for ${h.id}: ${error.message}`);
      continue;
    }
    written++;
  }
  for (const h of hits) {
    const patch: Record<string, unknown> = {};
    if (h.email) patch.contact_email = h.email;
    if (h.phone) patch.contact_phone = h.phone;
    // The block, where the record printed one, because it carries the firm and
    // the office the labelled sentence does not.
    const name = h.blockName ?? h.person;
    // contact_name is only set where the record had none, or where what is
    // stored is the head of this same value; an existing one is the adapter's
    // own reading and is not overwritten by this pass.
    const { data: cur } = await supabaseAdmin.from('leads').select('contact_name').eq('id', h.id).single();
    const stored = String(cur?.contact_name ?? '').trim();
    if (!stored || completes(stored, name)) patch.contact_name = name;
    const { error } = await supabaseAdmin.from('leads').update(patch).eq('id', h.id);
    if (error) {
      console.error(`   write failed for ${h.id}: ${error.message}`);
      continue;
    }
    written++;
  }
  // Both passes write, so the denominator is both. Counting only the labelled
  // hits printed "8 of 0" on a run whose work was all contact blocks.
  console.log(`\nwritten: ${written} of ${hits.length + nameOnly.length}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
