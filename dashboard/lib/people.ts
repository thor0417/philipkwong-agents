// WHO IS INVOLVED, SAID ONCE.
//
// Parties were printed inside every record line, so a project with six filings
// named its applicant six times and a reader had to notice a name repeating in
// order to learn who was behind it. The July standard does the opposite: it
// names each party once, with the role it holds, before the filings.
//
// ONE IMPLEMENTATION. The report, the referral brief, the register detail pane
// and the project page all read this, because four surfaces that each assemble
// their own list of people will eventually disagree about who is on a project,
// and the one a client sees is the one nobody re-reads.
//
// ---- WHAT A ROLE MAY BE ------------------------------------------------------
//
// ONLY WHAT A COLUMN SAYS. leads carries applicant, representative, presented_by
// and contact_name, so those are the four roles this can emit. The July document
// also names owners, awardees, architects and lead agencies, and those came from
// a person reading the filing text. Deriving them here would mean inferring a
// role from prose, and a wrong role on a named individual in a client document
// is exactly the failure the brief forbids. Where the corpus gains those columns
// this list grows; until then the absence is honest.
//
// ---- WHAT A NAME MAY BE ------------------------------------------------------
//
// Nothing is invented, completed or corrected. A party is the stored string,
// cleaned of the mailing address the sources staple to it and deshouted, and
// nothing else. Two parties merge only when their names normalise to the same
// thing.

import type { Project, TimelineRecord } from './projects';
import { isFiling } from './report-model';

type ScopedRecord = TimelineRecord & { project_id?: string | null; market?: string | null };

export interface PartyContact {
  email: string | null;
  phone: string | null;
}

export interface ProjectParty {
  /** The person or organisation, as the record writes it. */
  name: string;
  /** The firm, where the record gives one alongside a personal name. */
  firm: string | null;
  /**
   * The office address the record states, verbatim. A contact path in its own
   * right: for most parties in this corpus it is the ONLY one the filing gives,
   * and it was previously split off and thrown away. Never completed or
   * corrected.
   */
  address: string | null;
  /** Every role this party holds, in the words the columns use. */
  roles: string[];
  provenance: 'RECORD' | 'PRESS';
  /** The record that names them, so the claim can be checked. */
  sourceUrl: string;
  sourceLabel: string;
  /** The date of the record naming them, where it carries one. */
  date: string | null;
  /** How many of the project's records name this party. */
  mentions: number;
  /**
   * Contact detail the RECORD holds. Null when it holds none, which the
   * renderers state rather than omit: 24 of the 33 records carrying a named
   * individual carry no way to reach them, and silence there reads as
   * "we did not bother to print it".
   */
  contact: PartyContact | null;
  /**
   * Cross-market history, from company_projects. Null unless the companies
   * layer actually holds other projects for this party.
   */
  alsoOn: string | null;
  /**
   * The other spellings folded into this one, so a merge can be checked rather
   * than trusted. Empty when nothing was merged.
   */
  mergedFrom: string[];
}

// The roles this can emit, and the column each comes from. Ordered as a reader
// wants them: who wants it, who speaks for them, who put it on the agenda, who
// to call.
const ROLE_APPLICANT = 'applicant';
const ROLE_REPRESENTATIVE = 'representative';
const ROLE_PRESENTER = 'presented by';
const ROLE_CONTACT = 'contact named in the record';
const ROLE_ORDER = [ROLE_APPLICANT, ROLE_REPRESENTATIVE, ROLE_PRESENTER, ROLE_CONTACT];

// Words printed in capitals that are not acronyms of two letters. Used only to
// choose between two spellings of the same name.
function shoutedWordCount(v: string): number {
  return v.split(/\s+/).filter((w) => w.length > 2 && w === w.toUpperCase() && /[A-Z]{3}/.test(w)).length;
}

function tidy(s: string | null | undefined): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

// Sources staple a mailing address to a representative:
// "NANCY AMUNDSEN, BROWN, BROWN, & PREMSRIRUT, 520 S. 4TH STREET, LAS VEGAS, NV
// 89101". Everything from the first street-address-looking component onward is a
// postal detail, not a party.
const ADDRESS_START = /,\s*(?=\d+\s+[NSEW]?\.?\s*\w|(?:suite|ste\.?|floor|fl\.?|p\.?o\.?\s*box)\b)/i;

function properCase(name: string): string {
  return name
    .split(' ')
    .map((w) =>
      w.length <= 3 && w === w.toUpperCase() && /^[A-Z.&]+$/.test(w)
        ? w
        : /^[A-Z][a-z]/.test(w)
          ? w
          : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    )
    .join(' ');
}

/**
 * The postal address stapled to a party string, verbatim, or null.
 *
 * cleanPartyName cuts it off so the NAME is a name; this keeps the other half
 * rather than discarding it. "NANCY AMUNDSEN, BROWN, BROWN, & PREMSRIRUT, 520
 * S. 4TH STREET, LAS VEGAS, NV 89101" gives a name, a firm and an office, and
 * the office is how a letter reaches her.
 */
export function addressOf(raw: string | null | undefined): string | null {
  const s = tidy(raw);
  if (!s) return null;
  const parts = s.split(ADDRESS_START);
  if (parts.length < 2) return null;
  const address = s.slice(parts[0].length).replace(/^[,;\s]+/, '').trim();
  return address.length >= 6 ? address : null;
}

export function cleanPartyName(raw: string | null | undefined): string | null {
  let s = tidy(raw);
  if (!s) return null;
  s = s.split(ADDRESS_START)[0].replace(/[,;\s]+$/, '');
  if (s.length < 2) return null;
  return s === s.toUpperCase() ? properCase(s) : s;
}

/** Two spellings of one party. Case, punctuation and spacing are not identity. */
export function normaliseParty(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// ---- ONE BODY, SPELLED THREE WAYS -------------------------------------------
//
// Metropolitan Park printed seven parties that were three institutions:
//
//   Department of Housing Preservation and Development
//   Housing Preservation and Development
//   NYC Department of Housing Preservation and Development
//
// all one agency, and NYCEDC twice under two spellings. A reader notices the
// repetition before they notice the content, so the section reads as a list
// nobody checked rather than as a counterparty map.
//
// The qualifiers a government body's name picks up and drops between filings are
// the whole cause. They are stripped from the FRONT, repeatedly, because they
// stack: "NYC Department of Housing Preservation and Development" carries two.
const LEADING_QUALIFIER =
  /^(?:the |nyc |new york city |city of |county of |town of |village of |borough of |state of |department of |dept of |office of |bureau of |division of |board of )/;

/**
 * The body a name refers to, with its qualifiers removed.
 *
 * Deliberately NOT an acronym expander. "HPD" and "Housing Preservation and
 * Development" are the same agency to a person and identical to nothing a
 * machine can check without a lookup table, and a wrong merge here silently
 * deletes a party from a client document.
 */
export function institutionKey(name: string): string {
  let s = normaliseParty(name);
  for (let i = 0; i < 4; i++) {
    const next = s.replace(LEADING_QUALIFIER, '');
    if (next === s) break;
    s = next.trim();
  }
  return s;
}

// A NAME THAT LISTS SEVERAL BODIES IS NOT ONE BODY.
//
// "New York City Economic Development Corporation, Queens Development Group,
// LLC, and CFG Stadium Group, LLC" names three parties in one string. Folding it
// into NYCEDC would delete the other two, which is the one thing a merge must
// never do. Two or more company markers in a single string means the string is a
// list, and a list is never merged with anything.
const COMPANY_SUFFIX_TOKEN = /\b(llc|l\.l\.c|inc|incorporated|ltd|limited|lp|llp|plc|corp|corporation|company)\b/gi;

export function namesSeveralBodies(name: string): boolean {
  return (name.match(COMPANY_SUFFIX_TOKEN) ?? []).length >= 2;
}

// Below this a folded key is too generic to be identity. "development" would
// merge half the register.
const MIN_KEY_WORDS = 2;
const MIN_KEY_CHARS = 12;

export function mergeableKey(name: string): string | null {
  if (namesSeveralBodies(name)) return null;
  const key = institutionKey(name);
  if (key.length < MIN_KEY_CHARS) return null;
  if (key.split(' ').length < MIN_KEY_WORDS) return null;
  return key;
}

// A PERSON AND THEIR FIRM, SPLIT ONLY WHERE THE SHAPE IS UNAMBIGUOUS.
//
// "Nancy Amundsen, Brown, Brown, & Premsrirut" is a person at a firm and reads
// far better split. "Brown, Brown, & Premsrirut" is one firm whose name contains
// commas, and splitting it would invent a person called Brown.
//
// So the split happens only when the first comma-separated segment looks like a
// personal name: two or three words, each starting with a capital, none of them
// a company marker. Everything else is left whole, which is the safe direction.
const COMPANY_MARKER =
  /\b(llc|l\.l\.c|inc|incorporated|ltd|limited|lp|llp|plc|corp|corporation|company|co|group|partners|holdings|associates|trust|authority|district|department|city|county|commission|board)\b/i;

// A BARE LEGAL SUFFIX IS PART OF THE COMPANY'S NAME, NOT A FIRM BEHIND IT.
// "Kulik River Capital, LLC" split into a person called Kulik River Capital at a
// firm called LLC, which is nonsense presented with a straight face.
const BARE_SUFFIX = /^(l\.?l\.?c|inc|incorporated|ltd|limited|l\.?p|l\.?l\.?p|plc|corp|corporation|co|s\.?a|n\.?v|gmbh|pty|pte)\.?$/i;

function splitNameAndFirm(full: string): { name: string; firm: string | null } {
  const comma = full.indexOf(',');
  if (comma === -1) return { name: full, firm: null };
  const head = full.slice(0, comma).trim();
  const tail = full.slice(comma + 1).trim();
  if (!tail) return { name: full, firm: null };
  // "Something, LLC" is one company. Never split it.
  if (BARE_SUFFIX.test(tail.replace(/[.,]$/, ''))) return { name: full, firm: null };
  const words = head.split(/\s+/);
  const looksPersonal =
    words.length >= 2 &&
    words.length <= 3 &&
    words.every((w) => /^[A-Z][A-Za-z'.-]*$/.test(w)) &&
    !COMPANY_MARKER.test(head);
  return looksPersonal ? { name: head, firm: tail } : { name: full, firm: null };
}

interface Accum {
  display: string;
  address: string | null;
  mergedFrom: string[];
  roles: Set<string>;
  isFiling: boolean;
  url: string;
  label: string;
  date: string | null;
  mentions: number;
  email: string | null;
  phone: string | null;
}

function host(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Every party on a project, once, with the roles the records give them.
 *
 * Pure: no fetching, so the report builder, the register pane and the project
 * page all get the same answer from the same records. Cross-market history is
 * layered on separately by withPartyHistory, because it needs the companies
 * table and not every caller has it.
 */
export function buildParties(project: Project, records: ScopedRecord[]): ProjectParty[] {
  const byKey = new Map<string, Accum>();

  const add = (
    raw: string | null | undefined,
    role: string,
    r: ScopedRecord,
    contact?: { email: string | null; phone: string | null }
  ): void => {
    const cleaned = cleanPartyName(raw);
    if (!cleaned) return;
    const key = normaliseParty(cleaned);
    if (!key) return;
    const filing = isFiling(r.source, r.source_type, r.stream);
    const date = r.published_date ? r.published_date.slice(0, 10) : null;
    const prior = byKey.get(key);
    if (!prior) {
      byKey.set(key, {
        display: cleaned,
        address: addressOf(raw),
        mergedFrom: [],
        roles: new Set([role]),
        isFiling: filing,
        url: r.url,
        label: r.source ?? host(r.url) ?? 'source',
        date,
        mentions: 1,
        email: contact?.email ?? null,
        phone: contact?.phone ?? null,
      });
      return;
    }
    prior.roles.add(role);
    prior.mentions++;
    // Two spellings that normalise to one key arrive here, and the first seen
    // used to keep the display. "ANN Pierce" beat "Ann Pierce" by arriving
    // first, which is not a reason.
    if (
      cleaned.toLowerCase() === prior.display.toLowerCase() &&
      shoutedWordCount(cleaned) < shoutedWordCount(prior.display)
    ) {
      prior.display = cleaned;
    }
    // A FILING OUTRANKS PRESS as the citation. If any record naming this party
    // is a government filing, that is the one worth pointing the reader at.
    if (filing && !prior.isFiling) {
      prior.isFiling = true;
      prior.url = r.url;
      prior.label = r.source ?? host(r.url) ?? 'source';
      prior.date = date;
    }
    // Contact detail is kept wherever it was found; a later record with none
    // must not erase it.
    prior.email = prior.email ?? contact?.email ?? null;
    prior.phone = prior.phone ?? contact?.phone ?? null;
    prior.address = prior.address ?? addressOf(raw);
  };

  for (const r of records) {
    if (!r.url) continue;
    add(r.applicant, ROLE_APPLICANT, r);
    add(r.representative, ROLE_REPRESENTATIVE, r);
    add(r.presented_by, ROLE_PRESENTER, r);
    // The contact block is one group of columns, so the detail belongs to the
    // person the block names and to nobody else. Where that person is already
    // the representative, the two merge and the detail rides along.
    add(r.contact_name, ROLE_CONTACT, r, {
      email: tidy(r.contact_email) || null,
      phone: tidy(r.contact_phone) || null,
    });
  }

  // ONE PARTY, ONE ENTRY, EVEN WHEN THE COLUMNS SPELL THEM DIFFERENTLY.
  //
  // representative held "Nancy Amundsen, Brown, Brown, & Premsrirut" while
  // contact_name held "Nancy Amundsen", so she appeared twice: once with her
  // firm and once with the contact detail. Two rows for one person is exactly
  // what a people section exists to stop.
  //
  // The shorter spelling is folded into the longer where it is a whole-word
  // prefix of it, which is the shape "person" versus "person, firm" always
  // takes. A one-word prefix is refused: "Brown" must not be absorbed into
  // "Brown, Brown & Premsrirut".
  const keys = [...byKey.keys()].sort((a, b) => b.length - a.length);
  for (const shortKey of [...keys].reverse()) {
    const short = byKey.get(shortKey);
    if (!short || shortKey.split(' ').length < 2) continue;
    const longKey = keys.find(
      (k) =>
        k !== shortKey &&
        k.length > shortKey.length &&
        k.startsWith(`${shortKey} `) &&
        // A LIST IS NEVER A LONGER SPELLING OF ITS FIRST MEMBER.
        // "Anaheim Real Estate Partners, LLC" is a prefix of "Anaheim Real
        // Estate Partners, LLC, TS Anaheim, LLC and FCD, LLC (OCVIBE)", and
        // folding the one into the other loses the fact that some filings name
        // the single applicant and others name all three.
        !namesSeveralBodies(byKey.get(k)?.display ?? '')
    );
    if (!longKey) continue;
    const long = byKey.get(longKey);
    if (!long) continue;
    for (const role of short.roles) long.roles.add(role);
    long.mentions += short.mentions;
    long.mergedFrom.push(short.display, ...short.mergedFrom);
    long.email = long.email ?? short.email;
    long.phone = long.phone ?? short.phone;
    long.address = long.address ?? short.address;
    if (short.isFiling && !long.isFiling) {
      long.isFiling = true;
      long.url = short.url;
      long.label = short.label;
      long.date = short.date;
    }
    byKey.delete(shortKey);
  }

  // ---- THE SAME BODY UNDER DIFFERENT QUALIFIERS --------------------------
  //
  // Run after the prefix pass, on what survives it. The longest spelling wins
  // the display, because "NYC Department of Housing Preservation and
  // Development" is the one a reader can look up, and every folded spelling is
  // recorded so the merge can be checked.
  // WHICH SPELLING SURVIVES. The fullest one, but a SHOUTED spelling loses to a
  // properly cased one of the same length: "ANN Pierce" and "Ann Pierce" are the
  // same person and only one of them is her name.
  // CASE ONLY DECIDES BETWEEN CASE-VARIANTS OF THE SAME NAME. Penalising capitals
  // in general threw away the useful qualifier: "NYC Department of Housing
  // Preservation and Development" lost to "Department of Housing Preservation
  // and Development" because NYC reads as shouting. Between two spellings of
  // DIFFERENT text the fuller one always wins; between "ANN Pierce" and "Ann
  // Pierce" the properly cased one does.
  const shoutedWords = (v: string) =>
    v.split(/\s+/).filter((w) => w.length > 2 && w === w.toUpperCase() && /[A-Z]{3}/.test(w)).length;
  const betterDisplay = (a: string, b: string): number =>
    a.toLowerCase() === b.toLowerCase() ? shoutedWords(a) - shoutedWords(b) : b.length - a.length;

  const byInstitution = new Map<string, string>();
  for (const key of [...byKey.keys()].sort((a, b) =>
    betterDisplay(byKey.get(a)!.display, byKey.get(b)!.display)
  )) {
    const acc = byKey.get(key);
    if (!acc) continue;
    const folded = mergeableKey(acc.display);
    if (!folded) continue;
    const winnerKey = byInstitution.get(folded);
    if (winnerKey === undefined) {
      byInstitution.set(folded, key);
      continue;
    }
    const winner = byKey.get(winnerKey);
    if (!winner) continue;
    for (const r of acc.roles) winner.roles.add(r);
    winner.mentions += acc.mentions;
    winner.email = winner.email ?? acc.email;
    winner.phone = winner.phone ?? acc.phone;
    winner.address = winner.address ?? acc.address;
    winner.mergedFrom.push(acc.display, ...acc.mergedFrom);
    if (acc.isFiling && !winner.isFiling) {
      winner.isFiling = true;
      winner.url = acc.url;
      winner.label = acc.label;
      winner.date = acc.date;
    }
    byKey.delete(key);
  }

  const out: ProjectParty[] = [...byKey.values()].map((a) => {
    const { name, firm } = splitNameAndFirm(a.display);
    return {
      name,
      firm,
      roles: [...a.roles].sort((x, y) => ROLE_ORDER.indexOf(x) - ROLE_ORDER.indexOf(y)),
      provenance: a.isFiling ? ('RECORD' as const) : ('PRESS' as const),
      sourceUrl: a.url,
      sourceLabel: a.label,
      date: a.date,
      mentions: a.mentions,
      address: a.address,
      contact: a.email || a.phone ? { email: a.email, phone: a.phone } : null,
      alsoOn: null,
      mergedFrom: [...new Set(a.mergedFrom)],
    };
  });

  // Most-cited first within the leading role, so the party a reader is looking
  // for is at the top rather than wherever the query happened to put it.
  return out.sort(
    (x, y) =>
      ROLE_ORDER.indexOf(x.roles[0]) - ROLE_ORDER.indexOf(y.roles[0]) ||
      y.mentions - x.mentions ||
      x.name.localeCompare(y.name)
  );
}

/**
 * THE HONEST NEGATIVE, AT PROJECT LEVEL.
 *
 * A project whose records name nobody says so in a sentence rather than showing
 * an empty heading. Which of the two it is depends on what the sources publish,
 * so the sentence names the reason it can see: records exist and none of them
 * carries a party.
 */
export function noPartiesNote(records: ScopedRecord[]): string {
  const n = records.length;
  if (n === 0) return 'No records are attached to this project, so no party is named.';
  return (
    `No party is named in ${n === 1 ? 'the record' : `any of the ${n} records`} captured for this ` +
    `project. The filings identify the matter but not who is behind it.`
  );
}

/**
 * A record's parties, MINUS the ones the project already names at the top.
 *
 * The point of the people section is that a reader learns who is involved once.
 * Repeating the same applicant on all six record lines is what it replaces. So a
 * record line keeps a party only where it DIFFERS from the project's primary
 * pair - which is the case the July standard prints, an entitlement where the
 * owner is not the applicant.
 */
export function distinctRecordParties(
  r: ScopedRecord,
  project: Project
): { name: string; role: string }[] {
  const primary = new Set(
    [project.primary_applicant, project.primary_representative]
      .map((v) => cleanPartyName(v))
      .filter((v): v is string => !!v)
      .map(normaliseParty)
  );
  const out: { name: string; role: string }[] = [];
  const push = (raw: string | null | undefined, role: string): void => {
    const cleaned = cleanPartyName(raw);
    if (!cleaned) return;
    const key = normaliseParty(cleaned);
    if (primary.has(key)) return;
    if (out.some((p) => normaliseParty(p.name) === key)) return;
    const { name, firm } = splitNameAndFirm(cleaned);
    out.push({ name: firm ? `${name}, ${firm}` : name, role });
  };
  push(r.applicant, ROLE_APPLICANT);
  push(r.representative, ROLE_REPRESENTATIVE);
  push(r.presented_by, ROLE_PRESENTER);
  return out;
}

/**
 * Cross-market history, layered on from the companies table.
 *
 * `index` maps a normalised party name to the other projects that party is
 * attached to. Built by the caller because it needs a query; absent, every
 * alsoOn stays null and nothing is claimed.
 */
export interface PartyHistory {
  /** Projects OTHER than the one being described. */
  projects: { market: string | null; role: string | null }[];
}

export function withPartyHistory(
  parties: ProjectParty[],
  index: Map<string, PartyHistory>
): ProjectParty[] {
  return parties.map((p) => {
    const h = index.get(normaliseParty(p.firm ? `${p.name}, ${p.firm}` : p.name)) ?? index.get(normaliseParty(p.name));
    if (!h || h.projects.length === 0) return p;
    // Counted per market and per role, and phrased from those counts only.
    const byMarket = new Map<string, number>();
    for (const x of h.projects) byMarket.set(x.market ?? 'unresolved markets', (byMarket.get(x.market ?? 'unresolved markets') ?? 0) + 1);
    const role = h.projects.find((x) => x.role)?.role ?? null;
    const parts = [...byMarket.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([m, n]) => `${n} in ${m}`);
    const total = h.projects.length;
    return {
      ...p,
      alsoOn:
        `Also ${role ? `${role} on ` : 'on '}${total} other ` +
        `${total === 1 ? 'project' : 'projects'} in our register: ${parts.join(', ')}.`,
    };
  });
}
