// THE NAVIGATION, DECLARED ONCE.
//
// The rail and the command palette are the same navigation in two forms, so
// they read the same list. A screen added here appears in both, and cannot
// appear in one and not the other.
//
// Nothing unbuilt is listed. A greyed-out row for a screen that does not exist
// is a promise the product has not kept, and it costs a click to discover that.

export interface NavItem {
  label: string;
  href: string;
  /** Keywords the command palette matches on beyond the label. */
  keywords?: string[];
  /** Shown in the palette to say what the screen is for. */
  hint?: string;
}

export interface NavSection {
  /** Null for the primary group, which needs no heading. */
  label: string | null;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  {
    label: null,
    items: [
      {
        label: 'Today',
        href: '/today',
        keywords: ['home', 'moved', 'new', 'digest', 'landing'],
        hint: 'What happened while you were away.',
      },
      {
        label: 'Projects',
        href: '/projects',
        // "register" stays a keyword: it is what this screen was called, and the
        // palette is the one place a name people already have in their heads
        // must keep working.
        keywords: ['register', 'triage', 'watchlist', 'stage', 'significance', 'ranked'],
        hint: 'Every project, ranked by significance.',
      },
      // RECORDS IS NOT A DESTINATION.
      //
      // It was three stream tabs - Opportunities, Intelligence, Government -
      // over 1,500 raw rows. Those three name the LANE that captured a row,
      // which is a fact about our plumbing rather than about the subject, and
      // browsing raw records is not a thing anybody does: a project's records
      // are its timeline, read in order, beside everything else about the same
      // site. The provenance those tabs carried is now a label on the timeline
      // row ([RECORD], [PRESS], [TENDER]) and the one genuinely useful thing the
      // screen did - finding a single document by case reference, title or url -
      // is in the command palette, which is search rather than browse.
      //
      // The route survives at /records. It is not in the rail and not in the
      // palette, so it is not somewhere to end up by accident, and /gli still
      // forwards into it.
      // CLIENTS SITS ABOVE REPORTS BECAUSE THAT IS THE ORDER OF THE WORK. A
      // report is generated FOR a client and FROM their scope; a rail that puts
      // the document first suggests the document is the thing being composed,
      // when what is being composed is a client's coverage.
      {
        label: 'Clients',
        href: '/clients',
        keywords: ['client', 'scope', 'retainer', 'cadence', 'delivery', 'contacts', 'intake'],
        hint: 'Who the work is for, and what they are covered for.',
      },
      {
        label: 'Reports',
        href: '/reports',
        keywords: ['report', 'compose', 'document', 'pdf', 'csv', 'xlsx', 'generate', 'brief', 'deliver'],
        hint: 'Compose and generate a client document.',
      },
    ],
  },
  // THE SECOND GROUP IS THE WORK THE SYSTEM OWES YOU, rather than the work you
  // do. Both of these are piles that should be empty and are not, and both were
  // invisible: 585 records attached to nothing, and nineteen sources that have
  // gone quiet without anything saying so.
  {
    label: null,
    items: [
      {
        label: 'Inbox',
        href: '/inbox',
        keywords: ['unattached', 'untriaged', 'orphan', 'attach', 'triage', 'backlog'],
        hint: 'Records attached to no project. It empties.',
      },
    ],
  },
  {
    label: 'Reference',
    items: [
      {
        label: 'Design system',
        href: '/design',
        keywords: ['tokens', 'colour', 'type', 'components'],
        hint: 'Every token and component, both modes.',
      },
      {
        label: 'Legacy pipeline',
        href: '/pipeline',
        keywords: ['fuel', 'consulting', 'archive'],
        // Its lanes were retired on 2026-07-29; the rows are frozen but intact.
        hint: 'Retired lanes. Frozen, kept for reference.',
      },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV.flatMap((s) => s.items);

/** The nav entry a path belongs to, longest match first so /project/x resolves. */
export function activeHref(pathname: string): string | null {
  const matches = NAV_ITEMS.map((i) => i.href)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length);
  return matches[0] ?? null;
}
