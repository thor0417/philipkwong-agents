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
  const rejected = new Map<string, number>();
  for (const r of rows) {
    const raw = String(r.raw_content ?? '');
    const hasEmail = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(raw);
    const hasPhone = /\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]\d{4}/.test(raw);
    if (!hasEmail && !hasPhone) continue;

    const already = String(r.contact_email ?? '').trim() || String(r.contact_phone ?? '').trim();
    const protectedFields = overriddenFields(r.manual_overrides);
    if (protectedFields.has('contact_email') || protectedFields.has('contact_phone')) {
      rejected.set('protected by an override', (rejected.get('protected by an override') ?? 0) + 1);
      continue;
    }

    const hit = extractContact(raw);
    if (!hit) {
      rejected.set(
        'no contact attributed to a named person',
        (rejected.get('no contact attributed to a named person') ?? 0) + 1
      );
      continue;
    }
    if (already) {
      rejected.set('already stored', (rejected.get('already stored') ?? 0) + 1);
      continue;
    }
    hits.push({ id: String(r.id), source: String(r.source), ...hit });
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
  for (const h of hits) {
    const patch: Record<string, unknown> = {};
    if (h.email) patch.contact_email = h.email;
    if (h.phone) patch.contact_phone = h.phone;
    // contact_name is only set where the record had none; an existing one is the
    // adapter's own reading and is not overwritten by this pass.
    const { data: cur } = await supabaseAdmin.from('leads').select('contact_name').eq('id', h.id).single();
    if (!String(cur?.contact_name ?? '').trim()) patch.contact_name = h.person;
    const { error } = await supabaseAdmin.from('leads').update(patch).eq('id', h.id);
    if (error) {
      console.error(`   write failed for ${h.id}: ${error.message}`);
      continue;
    }
    written++;
  }
  console.log(`\nwritten: ${written} of ${hits.length}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
